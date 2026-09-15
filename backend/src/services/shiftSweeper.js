/**
 * SHIFT sweeper — the "never silent" safety net (design §7, pr1-contracts §8.1).
 *
 * Triggered every minute by Cloud Scheduler (POST /api/internal/sweep) and by an in-process
 * setInterval. Both can fire together and several Cloud Run instances can run at once, so every
 * customer note and staff alert is claimed atomically in the DB (a compare-and-set on the stored
 * request, claimValue, or a status transition) before it is sent: a concurrent sweep loses the claim
 * and does nothing.
 *
 * GPT-6 #11: a claim is not a completed note. It names the request it was taken for, records when,
 * and the note itself is a send intent (replyBatcher.dispatchIntent) keyed by that request. A sweep
 * that died between its claim and the intent row leaves a claim older than NOTE_CLAIM_TTL_MS with no
 * intent: the next sweep takes it over. When the intent row exists, the note is never sent again.
 *
 * The sweeper never generates AI replies itself: orphaned batches are handed back to the
 * batcher, and the only customer-visible texts are the two fixed notes from acks.js.
 */

const prisma = require('../config/prisma');
const jsonb = require('../db/jsonb');
const replyBatcher = require('./replyBatcher');
const { resolveTeamHours, isWithinTeamHours, teamMinutesBetween } = require('../workflows/shift/hours');
const { slaNote, awaitingStaffNote, pickLanguage } = require('../workflows/shift/acks');
const { sendStaffAlert, alertChannelConfigured } = require('./alerts');
const { NOTE_WINDOW_MARGIN_MS, windowClosesAt, isWithinServiceWindow } = require('../utils/serviceWindow');
const { resolveModel } = require('../ai/provider');
const { graphVersion } = require('./whatsapp');
// PR2 (contract §11.1): the idle role-play and single-nudge steps. All pure decision modules.
const followups = require('../workflows/shift/followups');
const roleplay = require('../workflows/shift/roleplay');
const { staffTask } = require('../workflows/shift/buttons');
const { expectedLanguage } = require('../workflows/shift/validators');
// PR3: sales-call booking reminders (d1 / h1) and the call-time-passed bookkeeping.
const booking = require('../workflows/shift/booking');

const MINUTE_MS = 60 * 1000;
// A claimed note with no intent row after this belongs to a sweep that died: another may take it over.
const NOTE_CLAIM_TTL_MS = 2 * MINUTE_MS;
// D24: non-SHIFT rows still `processing` after this are re-processed by the message processor.
const STUCK_INBOUND_AGE_MS = 2 * MINUTE_MS;
const PAUSE_REQUEUE_LIMIT = 200;
const HOUR_MS = 60 * MINUTE_MS;
const ORPHAN_AGE_MS = 30 * 1000;
const ORPHAN_LIMIT = 100;
// Pages of `received` rows one sweep reads; each page excludes every conversation already seen.
const ORPHAN_MAX_PAGES = 10;
const MAX_REPLY_FAILURES = 3;
const SLA_TEAM_MINUTES = 15;
const AWAITING_AGE_MS = 10 * MINUTE_MS;
const AWAITING_LIMIT = 200;
// Flag the window while staff can still reply for free (22–24 h after the last inbound).
const WINDOW_FLAG_FROM_MS = 22 * HOUR_MS;
const WINDOW_FLAG_TO_MS = 24 * HOUR_MS;
// Inbound-without-outbound: older than a batch plus an AI deadline, recent enough to still matter.
const UNANSWERED_MIN_AGE_MS = 2 * MINUTE_MS;
const UNANSWERED_MAX_AGE_MS = 60 * MINUTE_MS;
const BACKLOG_AGE_MS = 60 * 1000;
// PR2: a role-play setup nobody answered for this long is abandoned like an idle role-play.
const ROLEPLAY_SETUP_IDLE_MS = roleplay.ROLEPLAY_IDLE_MS;
const ROLEPLAY_STAGES = ['roleplay', 'roleplay_setup'];
const NUDGE_LOOKBACK_MS = 24 * HOUR_MS;
// A live example outside its stage is only left behind by a recent write (a tap, a half-applied sweep).
const ROLEPLAY_STALE_LOOKBACK_MS = 48 * HOUR_MS;
const STAFF_TASKS_CAP = 20;
// Outbound rows that never reached the customer do not make "the newest message is ours" true.
const UNDELIVERED_OUTBOUND = ['failed', 'cancelled', 'ambiguous_unreconciled'];
const SKIPPED_INBOUND_TYPES = ['reaction', 'system', 'ephemeral'];
const WINDOW_TASK_SUMMARY = 'النافذة مسكّرة — اتصل';
// Bookings are at most ~5 team days ahead; a reschedule can push one further. Conversations with a message in
// this span are scanned (workflow_data has no JSON-path filter in Prisma).
const BOOKING_LOOKBACK_MS = 14 * 24 * HOUR_MS;
// The call is over this long after its end: its meeting request resolves itself.
const BOOKING_PASSED_AFTER_MS = 15 * MINUTE_MS;
const REMINDER_KINDS = ['d1', 'h1'];

let running = false;
let last = { at: null, report: null };

function emptyReport() {
  return {
    stuck_inbound: null, unconfirmed_requeued: 0, unconfirmed_escalated: 0, ambiguous_alerts: 0,
    pause_requeued: 0, orphans: 0, sla_notes: 0, awaiting_notes: 0, window_flags: 0, unanswered_alerts: 0,
    roleplay_idle: 0, nudges_sent: 0, nudges_dropped: 0,
    reminders_sent: 0, reminders_skipped: 0, reminders_failed: 0, bookings_passed: 0, errors: [],
  };
}

function lastSweep() {
  return { at: last.at, report: last.report };
}

/*
 * D22 / GPT-6 #10: a closer is a message made only of thanks / acknowledgement phrases. Word count is
 * not a test («price please», «كم السعر» are requests in two words), so anything outside this list
 * earns the customer a note: a needless «رسالتك وصلت» costs less than a silence.
 * Stored normalised (see normaliseCloserText): no hamza forms, ة → ه, ى → ي, no tashkeel, lower case.
 */
const CLOSER_PHRASES = [
  'شكرا', 'شكرا جزيلا', 'شكرا كتير', 'شكرا كثير', 'مشكور', 'مشكوره', 'مشكورين', 'مشكورة',
  'يعطيك العافيه', 'يعطيكم العافيه', 'الله يعطيك العافيه', 'الله يعطيكم العافيه', 'تسلم', 'تسلمي', 'تسلمو', 'تسلموا',
  'الله يسلمك', 'جزاك الله خير', 'جزاك الله خيرا', 'بارك الله فيك', 'تمام', 'ماشي', 'اوكي', 'اوك', 'حاضر', 'ممتاز',
  'ان شاء الله', 'انشالله', 'ok', 'okay', 'okey', 'k', 'thanks', 'thank you', 'thanks a lot', 'thank you so much', 'thx',
  'ty', 'great', 'perfect', 'cool', 'noted', 'got it', 'sure', 'alright', 'fine',
  '👍', '🙏', '👌', '❤', '🌹', '💐', '😊', '🙂', '🤝', '✅',
];
const CLOSER_EMOJI_RE = /(👍|🙏|👌|❤|🌹|💐|😊|🙂|🤝|✅)/gu;

function normaliseCloserText(text) {
  return String(text)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // tashkeel, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u{1F3FB}-\u{1F3FF}\uFE0F\u200D]/gu, '') // skin tones, variation selectors, joiners
    .replace(CLOSER_EMOJI_RE, ' $1 ')
    .replace(/[.,!،؛;:~…\-_"'()]+/g, ' ')
    .replace(/(\p{L})\1{2,}/gu, '$1') // «شكراااا», «okkk»
    .replace(/\s+/g, ' ')
    .trim();
}

const CLOSER_RE = (() => {
  const alternatives = [...new Set(CLOSER_PHRASES.map(normaliseCloserText))]
    .sort((a, b) => b.length - a.length)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(`^(?:${alternatives})(?: (?:${alternatives}))*$`, 'u');
})();

/** «تمام شكرًا», «ok thanks», «👍»: only closing phrases, no question. Empty text (media) is not a closer. */
function isCloser(text) {
  if (typeof text !== 'string') return false;
  if (/[?؟]/.test(text)) return false;
  const s = normaliseCloserText(text);
  return !!s && CLOSER_RE.test(s);
}

function ago(now, ms) {
  return new Date(now.getTime() - ms);
}

function toMs(value) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function workflowData(conv) {
  return conv && conv.workflow_data && typeof conv.workflow_data === 'object' ? conv.workflow_data : {};
}

function metadataOf(conv) {
  return conv && conv.metadata && typeof conv.metadata === 'object' ? conv.metadata : {};
}

// The lead's language, else the customer's newest text: an English prospect gets an English note.
async function langFor(conv) {
  const lead = workflowData(conv).lead || {};
  if (lead.language) return pickLanguage(lead, '');
  const newest = await prisma.message.findFirst({
    where: { conversation_id: conv.id, direction: 'inbound', text_body: { not: null } },
    orderBy: { created_at: 'desc' },
  });
  return pickLanguage(lead, (newest && newest.text_body) || '');
}

function testNumbers(business, env = process.env) {
  const fromConfig = Array.isArray(business?.ai_config?.test_numbers) ? business.ai_config.test_numbers : [];
  const fromEnv = String(env.SHIFT_TEST_NUMBERS || '').split(',');
  return new Set([...fromConfig, ...fromEnv].map((n) => String(n ?? '').replace(/\D/g, '')).filter(Boolean));
}

// Customer notes obey the same D1 gate as bot replies: save-only mode must not start talking
// to customers through the sweeper.
function notesAllowed(business, conv) {
  return replyBatcher.isShiftReplyAllowed(business, conv.customer_wa_id);
}

/**
 * D17/D21: a note is a send intent keyed by the request it answers (`${batchKey}:0` dedupes it), sent
 * only after the protocol's pre-send check. Returns the delivery outcome for the staff alert; a thrown
 * error leaves the claim to be taken over (GPT-6 #11).
 */
async function sendNote({ business, conversation, kind, text, batchKey, since, precheck, now }) {
  // Notes stop 30 min before the 24 h window closes, so staff still have time to answer for free.
  if (!isWithinServiceWindow(conversation.last_inbound_at, now, { marginMs: NOTE_WINDOW_MARGIN_MS })) return 'window_closed';
  const dispatch = await replyBatcher.dispatchIntent({
    business, conversation, kind, parts: [{ type: 'text', text }], batchIds: [], batchKey, precheck, since, now,
  });
  return dispatch.outcome;
}

// Any intent for this note, whatever became of it: once one exists the note may have been sent.
async function noteIntentExists(conversationId, batchKey, since) {
  const rows = await prisma.message.findMany({
    where: { conversation_id: conversationId, direction: 'outbound', created_at: { gte: since } },
  });
  return rows.some((m) => m.raw_payload && m.raw_payload.batch_key === `${batchKey}:0`);
}

// One failing conversation must not stop the rest of the step.
async function each(report, label, items, fn) {
  for (const item of items) {
    try {
      await fn(item);
    } catch (err) {
      report.errors.push(`${label}: ${err.message}`);
      console.error(`[sweep] ${label} failed:`, err.message);
    }
  }
}

function newestStaffOutbound(conversationId, extraWhere = {}) {
  return prisma.message.findFirst({
    where: { conversation_id: conversationId, direction: 'outbound', sent_by_user_id: { not: null }, ...extraWhere },
    orderBy: { created_at: 'desc' },
  });
}

// ─── 0. Sends without a confirmation (D18) ───────────────────────────────────

/**
 * `sending`/`ambiguous` intents older than 2 minutes are settled by the batcher's protocol: rows
 * requeued once, then handed to staff (needs_team unsent_reply). The sweeper never flips them itself.
 */
async function sweepUnconfirmed(business, now, report) {
  const r = await replyBatcher.reconcileUnconfirmedIntents({ now, businessId: business.id });
  report.unconfirmed_requeued += r.requeued || 0;
  report.unconfirmed_escalated += r.escalated || 0;
  report.ambiguous_alerts += r.unreconciled || 0;
  for (const e of r.errors || []) report.errors.push(`unconfirmed ${business.id}: ${e}`);
}

// ─── 1a. A temporary staff pause expired (D22) ───────────────────────────────

// Inbound rows the batcher handed to staff after its reply stayed unconfirmed twice (D18/D19): they
// wait for a person even when nobody holds the conversation, so the pause step must not requeue them.
// A D19 escalation leaves its intent `failed` (the processor restores it after settling), a D18 one
// `ambiguous_unreconciled`: both carry raw_payload.settled.
async function escalatedRowIds(conversationId) {
  const intents = await prisma.message.findMany({
    where: { conversation_id: conversationId, direction: 'outbound', status: { in: ['ambiguous_unreconciled', 'failed'] } },
  });
  const ids = new Set();
  for (const m of intents) {
    const p = m.raw_payload || {};
    if (p.settled === 'escalated' && Array.isArray(p.batch_ids)) p.batch_ids.forEach((id) => ids.add(id));
  }
  return ids;
}

/**
 * GPT-6 #10: a staff message pauses the bot for 30 min without taking the conversation. Messages the
 * batcher parked meanwhile would wait for a person forever; once the pause is over and nobody claimed
 * the conversation, they go back to `received` and the batcher answers them. The batcher re-checks the
 * human state before it replies (and again right before Graph), so a claim made after this read only
 * parks them again.
 */
async function sweepExpiredPauses(business, now, report) {
  // Paged by conversation like the orphan step: rows of long staff-held chats stay awaiting_staff and
  // must not hide a newer conversation whose pause just ended.
  const seen = new Set();
  for (let page = 0; page < ORPHAN_MAX_PAGES; page += 1) {
    const rows = await prisma.message.findMany({
      where: {
        business_id: business.id, direction: 'inbound', status: 'awaiting_staff',
        ...(seen.size && { conversation_id: { notIn: [...seen] } }),
      },
      orderBy: { created_at: 'asc' },
      take: PAUSE_REQUEUE_LIMIT,
    });
    const convIds = [...new Set(rows.map((m) => m.conversation_id))];
    convIds.forEach((id) => seen.add(id));
    await requeueExpiredPauses(business, convIds, now, report);
    if (rows.length < PAUSE_REQUEUE_LIMIT) break;
  }
}

async function requeueExpiredPauses(business, convIds, now, report) {
  await each(report, `pause ${business.id}`, convIds, async (convId) => {
    const conv = await prisma.conversation.findUnique({ where: { id: convId } });
    // Save-only / external: the batcher would only mark them skipped; keep them visible for staff.
    if (!conv || !notesAllowed(business, conv)) return;
    if (replyBatcher.isHumanActive(conv, await newestStaffOutbound(convId), now)) return;
    const keep = await escalatedRowIds(convId);
    const { count } = await prisma.message.updateMany({
      where: {
        conversation_id: convId, direction: 'inbound', status: 'awaiting_staff',
        ...(keep.size && { id: { notIn: [...keep] } }),
      },
      data: { status: 'received' },
    });
    if (!count) return;
    report.pause_requeued += count;
    replyBatcher.scheduleReply(convId, { reason: 'sweep' });
  });
}

// ─── 1. Orphaned batches ─────────────────────────────────────────────────────

/**
 * Also the retry pacing for failed deliveries: the batcher does not retry a failed send at once, so
 * each sweep (a minute apart) is the next attempt, up to MAX_REPLY_FAILURES.
 *
 * Paged by conversation: rows of conversations that gave up (three failures) stay `received`, and a
 * plain "oldest 100 rows" would let them hide a newer orphan for good. Each page excludes every
 * conversation already looked at, so it always brings at least one new one.
 */
async function sweepOrphans(business, now, report) {
  const seen = new Set();
  for (let page = 0; page < ORPHAN_MAX_PAGES; page += 1) {
    const rows = await prisma.message.findMany({
      where: {
        business_id: business.id,
        direction: 'inbound',
        status: 'received',
        created_at: { lt: ago(now, ORPHAN_AGE_MS) },
        ...(seen.size && { conversation_id: { notIn: [...seen] } }),
      },
      orderBy: { created_at: 'asc' },
      take: ORPHAN_LIMIT,
    });
    const ids = [...new Set(rows.map((m) => m.conversation_id))];
    ids.forEach((id) => seen.add(id));
    await each(report, `orphans ${business.id}`, ids, async (convId) => {
      const conv = await prisma.conversation.findUnique({ where: { id: convId } });
      if (!conv) return;
      if (Number(metadataOf(conv).reply_failures) >= MAX_REPLY_FAILURES) {
        // Gave up after three failures; staff were alerted. Once the 24 h window has closed the rows
        // can never be answered for free, so they stop being orphans instead of piling up.
        if (!isWithinServiceWindow(conv.last_inbound_at, now)) {
          await prisma.message.updateMany({
            where: { conversation_id: convId, direction: 'inbound', status: 'received' },
            data: { status: 'skipped' },
          });
        }
        return;
      }
      replyBatcher.scheduleReply(convId, { reason: 'sweep' });
      report.orphans += 1;
    });
    if (rows.length < ORPHAN_LIMIT) break;
  }
}

// ─── 2. SLA note for an unclaimed needs_team ─────────────────────────────────

/**
 * The claim lives inside the request it is for: a compare-and-set on needs_team matching its
 * `at`/`reason` and the claim fields as read. A request replaced meanwhile fails the match, so an old
 * sweep can never mark a newer request's note as sent (GPT-6 #11).
 * needs_team fields: sla_note_sent_at (claim time of the latest attempt), sla_note_attempt,
 * sla_note_done_at (note dispatched or deliberately skipped, alert sent).
 */
async function claimSlaNote(conv, nt, now) {
  const match = { at: nt.at, reason: nt.reason };
  // Absent keys cannot be matched by @>; every entry from needsTeamEntry carries them as null.
  if ('sla_note_sent_at' in nt) match.sla_note_sent_at = nt.sla_note_sent_at ?? null;
  if (nt.sla_note_attempt !== undefined) match.sla_note_attempt = nt.sla_note_attempt;
  if ('resolved_at' in nt) match.resolved_at = null;
  if ('claimed_at' in nt) match.claimed_at = null;
  const attempt = (Number(nt.sla_note_attempt) || 0) + 1;
  const claimed = await jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'needs_team',
    { sla_note_sent_at: now.toISOString(), sla_note_attempt: attempt }, { match });
  return claimed ? attempt : null;
}

// The SLA note claim is still this sweep's: same request, same attempt.
async function ownsSlaClaim(conversationId, nt, attempt) {
  const fresh = await prisma.conversation.findUnique({ where: { id: conversationId } });
  const stored = workflowData(fresh).needs_team;
  return !!stored && stored.at === nt.at && stored.reason === nt.reason && Number(stored.sla_note_attempt) === attempt;
}

async function sweepSlaNotes(business, teamHours, now, report) {
  if (!isWithinTeamHours(teamHours, now)) return;
  const convs = await prisma.conversation.findMany({ where: { business_id: business.id, status: 'pending' } });
  await each(report, `sla ${business.id}`, convs, async (conv) => {
    const wd = workflowData(conv);
    const nt = wd.needs_team;
    if (!nt || nt.resolved_at || nt.sla_note_done_at || nt.reason === 'ai_failure' || wd.marketing_opted_out_at) return;
    // PR3: a call booked in the calendar needs no «not picked up yet» note or SLA alert: the time is confirmed.
    if (nt.reason === 'meeting' && booking.activeBooking(wd, now)) return;
    // Claimed by PR1's first sweeper, which had no attempt counter: its claim meant the note was handled.
    if (nt.sla_note_sent_at && nt.sla_note_attempt === undefined) return;
    // Another sweep is on it (or died less than NOTE_CLAIM_TTL_MS ago).
    if (nt.sla_note_sent_at && now.getTime() - toMs(nt.sla_note_sent_at) < NOTE_CLAIM_TTL_MS) return;
    if (!nt.at || teamMinutesBetween(teamHours, new Date(nt.at), now) < SLA_TEAM_MINUTES) return;
    if (!notesAllowed(business, conv)) return;
    const staff = await newestStaffOutbound(conv.id, { created_at: { gt: new Date(nt.at) } });
    if (staff) return;

    const attempt = await claimSlaNote(conv, nt, now);
    if (!attempt) return;
    const batchKey = `sla_note:${nt.reason}:${nt.at}`;
    const since = new Date(nt.at);
    // A call request with a time already noted: the note's «write me a time» would re-ask a fact the
    // customer confirmed, and the call may well be tomorrow. Staff still get the alert.
    const timeNoted = nt.reason === 'meeting' && !!(wd.lead && wd.lead.preferred_time);
    let outcome = 'skipped';
    if (!timeNoted) {
      if (attempt > 1 && await noteIntentExists(conv.id, batchKey, since)) {
        // The sweep that died had already written the intent: finish its bookkeeping, never resend.
        outcome = 'already_dispatched';
      } else {
        outcome = await sendNote({
          business, conversation: conv, kind: 'sla_note', text: slaNote(await langFor(conv)), batchKey, since, now,
          // «not picked up yet» is false once staff claim or write: the pre-send check refuses then.
          // The claim is part of the same check: a sweep that stalled past NOTE_CLAIM_TTL_MS and was
          // taken over (the other sweep sent the note) must not send it a second time.
          precheck: {
            humanGuard: true,
            optedOutSince: since,
            claim: [
              { column: 'workflow_data', path: ['needs_team', 'at'], value: nt.at },
              { column: 'workflow_data', path: ['needs_team', 'sla_note_attempt'], value: attempt },
            ],
          },
        });
        if (outcome === 'aborted' && !(await ownsSlaClaim(conv.id, nt, attempt))) return;
        if (outcome !== 'window_closed') report.sla_notes += 1;
      }
    }
    // Alert before the done mark: a crash in between repeats the staff alert, never the customer note.
    await sendStaffAlert({
      reason: 'sla_breached', business, conversation: conv, now,
      summary: `${nt.reason}${nt.summary ? ` — ${nt.summary}` : ''} (note: ${outcome})`,
    });
    await jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'needs_team',
      { sla_note_done_at: now.toISOString() }, { match: { at: nt.at, reason: nt.reason } });
  });
}

// ─── 3. Note while the customer waits for a staff member ────────────────────

/**
 * Once per silence (keyed by its first row), reclaimable. metadata.awaiting_note_for holds
 * `${rowId}#${attempt}`: claimValue lets exactly one of the sweeps that read the same state write the
 * same next value. The claim time is written just before, so a live claim always has one; a sweep that
 * crashed leaves it to age past NOTE_CLAIM_TTL_MS. awaiting_note_done_for marks the silence finished.
 * Returns the attempt number, or null when this sweep must not act.
 */
async function claimAwaitingNote(conv, rowId, now) {
  const meta = metadataOf(conv);
  if (meta.awaiting_note_done_for === rowId) return null;
  const stored = typeof meta.awaiting_note_for === 'string' ? meta.awaiting_note_for : '';
  let attempt = 1;
  if (stored === rowId) return null; // PR1's first sweeper: a bare id meant the note was handled.
  if (stored.startsWith(`${rowId}#`)) {
    const claimedAt = meta.awaiting_note_claimed_at ? toMs(meta.awaiting_note_claimed_at) : NaN;
    if (Number.isFinite(claimedAt) && now.getTime() - claimedAt < NOTE_CLAIM_TTL_MS) return null;
    attempt = (parseInt(stored.slice(rowId.length + 1), 10) || 1) + 1;
  }
  await jsonb.patchJson('conversations', conv.id, 'metadata', { awaiting_note_claimed_at: now.toISOString() });
  const claimed = await jsonb.claimValue('conversations', conv.id, 'metadata', 'awaiting_note_for', `${rowId}#${attempt}`);
  return claimed ? attempt : null;
}

async function sweepAwaitingNotes(business, teamHours, now, report) {
  if (!isWithinTeamHours(teamHours, now)) return;
  const rows = await prisma.message.findMany({
    where: { business_id: business.id, direction: 'inbound', status: 'awaiting_staff', created_at: { lt: ago(now, AWAITING_AGE_MS) } },
    orderBy: { created_at: 'asc' },
    take: AWAITING_LIMIT,
  });
  const byConv = new Map();
  for (const row of rows) {
    if (!byConv.has(row.conversation_id)) byConv.set(row.conversation_id, []);
    byConv.get(row.conversation_id).push(row);
  }

  await each(report, `awaiting ${business.id}`, [...byConv.entries()], async ([convId, awaiting]) => {
    const lastStaff = await newestStaffOutbound(convId);
    // Only messages the staff member has not answered yet form the current silence.
    const since = lastStaff ? new Date(lastStaff.created_at).getTime() : null;
    const silence = awaiting.filter((m) => since === null || new Date(m.created_at).getTime() > since);
    if (!silence.length || silence.every((m) => isCloser(m.text_body))) return;

    const conv = await prisma.conversation.findUnique({ where: { id: convId } });
    if (!conv || !notesAllowed(business, conv)) return;

    const attempt = await claimAwaitingNote(conv, silence[0].id, now);
    if (!attempt) return;
    const batchKey = `awaiting_note:${silence[0].id}`;
    const silenceStart = new Date(silence[0].created_at);

    let staffName = null;
    if (conv.assigned_staff_id) {
      const user = await prisma.user.findUnique({ where: { id: conv.assigned_staff_id }, select: { name: true } });
      staffName = user?.name || null;
    }
    let outcome;
    if (attempt > 1 && await noteIntentExists(convId, batchKey, silenceStart)) {
      outcome = 'already_dispatched';
    } else {
      const claimValue = `${silence[0].id}#${attempt}`;
      outcome = await sendNote({
        business, conversation: conv, kind: 'awaiting_note', text: awaitingStaffNote({ staffName, lang: await langFor(conv) }),
        batchKey,
        since: silenceStart,
        // The customer is waiting for the person who holds the conversation: no human guard. Nothing
        // after an opt-out during this silence, and only while this sweep still holds the claim.
        precheck: {
          humanGuard: false,
          optedOutSince: silenceStart,
          claim: [{ column: 'metadata', path: ['awaiting_note_for'], value: claimValue }],
        },
        now,
      });
      if (outcome === 'aborted') {
        const fresh = await prisma.conversation.findUnique({ where: { id: convId } });
        // Taken over by another sweep: the note, alert and done mark are its to finish.
        if (metadataOf(fresh).awaiting_note_for !== claimValue) return;
      }
      report.awaiting_notes += 1;
    }
    await sendStaffAlert({
      reason: 'awaiting_staff', business, conversation: conv, now,
      summary: `${silence.length} message(s) waiting${staffName ? ` for ${staffName}` : ''} (note: ${outcome})`,
    });
    await jsonb.patchJson('conversations', convId, 'metadata', { awaiting_note_done_for: silence[0].id });
  });
}

// ─── 4. 24 h window about to close on a conversation staff still owe ─────────

async function sweepWindowFlags(business, now, report) {
  const convs = await prisma.conversation.findMany({
    where: {
      business_id: business.id,
      last_inbound_at: { gte: ago(now, WINDOW_FLAG_TO_MS), lte: ago(now, WINDOW_FLAG_FROM_MS) },
    },
  });
  await each(report, `window ${business.id}`, convs, async (conv) => {
    const wdw = workflowData(conv);
    // PR3: pending only because of a booked call → staff owe no message before the window closes.
    const bookedOnly = conv.status === 'pending' && wdw.needs_team && wdw.needs_team.reason === 'meeting'
      && !wdw.needs_team.resolved_at && !!booking.activeBooking(wdw, now);
    let eligible = (conv.status === 'pending' && !bookedOnly) || conv.status === 'human_takeover';
    if (!eligible) {
      const waiting = await prisma.message.count({
        where: { conversation_id: conv.id, direction: 'inbound', status: 'awaiting_staff' },
      });
      eligible = waiting > 0;
    }
    if (!eligible) return;

    const lastInbound = new Date(conv.last_inbound_at);
    const claimed = await jsonb.claimValue('conversations', conv.id, 'metadata', 'window_flag_for', lastInbound.toISOString());
    if (!claimed) return;
    const closesAt = windowClosesAt(lastInbound);
    await jsonb.patchJson('conversations', conv.id, 'metadata', { window_closing_at: closesAt.toISOString() });
    report.window_flags += 1;
    await sendStaffAlert({
      reason: 'window_closing', business, conversation: conv, now,
      summary: `closes at ${closesAt.toISOString()}`,
    });
  });
}

// ─── 6. Inbound with no outbound after it (any mode, any gate) ───────────────

async function sweepUnanswered(business, now, report) {
  const convs = await prisma.conversation.findMany({
    where: {
      business_id: business.id,
      last_inbound_at: { gte: ago(now, UNANSWERED_MAX_AGE_MS), lte: ago(now, UNANSWERED_MIN_AGE_MS) },
    },
  });
  await each(report, `unanswered ${business.id}`, convs, async (conv) => {
    const inb = await prisma.message.findFirst({
      where: { conversation_id: conv.id, direction: 'inbound' },
      orderBy: { created_at: 'desc' },
    });
    // Reactions need no answer; awaiting_staff has its own note and alert.
    if (!inb || inb.message_type === 'reaction' || inb.status === 'awaiting_staff') return;
    // SHIFT_ROLEPLAY=0 ended a live example on this «خلص» with no reply, by design (§10.2 #7).
    const rp = workflowData(conv).roleplay;
    if (rp && rp.end_reason === 'disabled' && toMs(rp.ended_at) >= toMs(inb.created_at)) return;
    // A failed send, one never recorded, one the pre-send check cancelled, or one D18 treated as
    // undelivered did not answer the customer.
    const outbound = await prisma.message.findFirst({
      where: {
        conversation_id: conv.id, direction: 'outbound', created_at: { gte: inb.created_at },
        status: { notIn: ['failed', 'sending', 'cancelled', 'ambiguous_unreconciled'] },
      },
      orderBy: { created_at: 'desc' },
    });
    if (outbound) return;

    const claimed = await jsonb.claimValue('conversations', conv.id, 'metadata', 'unanswered_alert_for', inb.id);
    if (!claimed) return;
    report.unanswered_alerts += 1;
    await sendStaffAlert({
      reason: 'inbound_without_outbound', business, conversation: conv, now,
      summary: (inb.text_body || `[${inb.message_type}]`).slice(0, 200),
    });
  });
}

// ─── 7. Idle role-play (PR2, contract §3.2 / §11.1) ─────────────────────────

// A reply run holds the lease, or the customer has written and a batch is due: the conversation is not
// idle, whatever the stored timestamps say, and a silent end now would race the answer.
async function replyInFlight(conv, now) {
  const leaseUntil = metadataOf(conv).reply_lease_until;
  if (leaseUntil && toMs(leaseUntil) > now.getTime()) return true;
  const waiting = await prisma.message.count({
    where: { conversation_id: conv.id, direction: 'inbound', status: 'received' },
  });
  return waiting > 0;
}

// The newest activity of a setup (no role-play object timestamp exists before START_ROLEPLAY).
function setupActivityMs(conv) {
  const wd = workflowData(conv);
  const times = [conv.last_inbound_at, wd.last_bot && wd.last_bot.at, wd.roleplay && wd.roleplay.last_turn_at]
    .map((v) => (v ? toMs(v) : NaN))
    .filter(Number.isFinite);
  return times.length ? Math.max(...times) : NaN;
}

/**
 * Silent: nothing is sent. An active role-play idle for 15 min (or any active one once SHIFT_ROLEPLAY=0)
 * ends with end_reason idle|disabled, and a setup nobody answered for 15 min is abandoned; both move the
 * stage to `close`. A live object whose stage already left the example (review r2 #12) ends as `done`.
 *
 * The role-play object is ended first, conditional on the one read (still active, same last turn), and the
 * stage moves after, conditional on the stage read: a failure between the two leaves an ended example in a
 * `roleplay` stage (answered as close), never a live example outside it that no sweep selects again.
 */
async function sweepRoleplayIdle(business, teamHours, now, report) {
  const convs = await prisma.conversation.findMany({
    where: {
      business_id: business.id,
      OR: [
        { current_state: { in: ROLEPLAY_STAGES } },
        { last_message_at: { gte: ago(now, ROLEPLAY_STALE_LOOKBACK_MS) } },
      ],
    },
  });
  const enabled = roleplay.roleplayEnabled();
  await each(report, `roleplay_idle ${business.id}`, convs, async (conv) => {
    const wd = workflowData(conv);
    const rp = wd.roleplay && typeof wd.roleplay === 'object' ? wd.roleplay : null;
    const active = roleplay.isActive(wd);
    const inStage = ROLEPLAY_STAGES.includes(conv.current_state);
    if (!inStage && !active) return;

    let reason = null;
    if (active && !inStage) {
      reason = 'done';
    } else if (active) {
      if (!enabled) reason = 'disabled';
      else if (roleplay.isIdle(rp, now)) reason = 'idle';
    } else if (conv.current_state === 'roleplay_setup') {
      const last = setupActivityMs(conv);
      if (!enabled) reason = 'disabled';
      else if (!Number.isFinite(last) || now.getTime() - last >= ROLEPLAY_SETUP_IDLE_MS) reason = 'idle';
    }
    if (!reason) return;
    if (await replyInFlight(conv, now)) return;

    // A setup that never started has no example to end: its object stays as it is (inactive), so the
    // roleplay_resume nudge, which follows only an example that ran and went idle, is not offered.
    if (active) {
      const match = { active: true };
      if (rp.last_turn_at) match.last_turn_at = rp.last_turn_at;
      const ended = await jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'roleplay',
        { active: false, ended_at: now.toISOString(), end_reason: reason }, { match });
      if (!ended) return;
      // The nudge planned before the example went idle (if any) is cleared, so the next sweep plans the
      // resume nudge for the same silence.
      if (wd.nudge && !wd.nudge.sent_at) await jsonb.patchJson('conversations', conv.id, 'workflow_data', { nudge: null });
    }
    if (inStage) {
      const { count } = await prisma.conversation.updateMany({
        where: { id: conv.id, current_state: conv.current_state },
        data: { current_state: 'close' },
      });
      if (!count && !active) return;
    }
    report.roleplay_idle += 1;
  });
}

// ─── 8. The single in-window nudge (PR2, contract §8.3 / §11.1) ─────────────

async function newestInboundRow(conversationId) {
  return prisma.message.findFirst({
    where: { conversation_id: conversationId, direction: 'inbound', message_type: { notIn: SKIPPED_INBOUND_TYPES } },
    orderBy: { created_at: 'desc' },
  });
}

async function newestDeliveredOutbound(conversationId) {
  return prisma.message.findFirst({
    where: { conversation_id: conversationId, direction: 'outbound', status: { notIn: UNDELIVERED_OUTBOUND } },
    orderBy: { created_at: 'desc' },
  });
}

/** Read, append, cap at 20, write whole (contract §1.3). A lost append under a race is acceptable. */
async function appendStaffTask(conversationId, task) {
  const fresh = await prisma.conversation.findUnique({ where: { id: conversationId } });
  const list = Array.isArray(workflowData(fresh).staff_tasks) ? workflowData(fresh).staff_tasks : [];
  await jsonb.patchJson('conversations', conversationId, 'workflow_data', {
    staff_tasks: list.concat([task]).slice(-STAFF_TASKS_CAP),
  });
}

/**
 * The nudge could not go out before the window closes: the team gets a call task and a
 * `window_closing` alert, once per silence (claimed on the inbound the nudge followed).
 */
async function flagWindowDrop(business, conv, nudge, now) {
  const claimed = await jsonb.claimValue('conversations', conv.id, 'metadata', 'nudge_drop_for', nudge.for_inbound_id);
  if (!claimed) return;
  await appendStaffTask(conv.id, staffTask('window_closed', WINDOW_TASK_SUMMARY, now, now));
  const closesAt = windowClosesAt(nudge.for_inbound_at || conv.last_inbound_at);
  await sendStaffAlert({
    reason: 'window_closing', business, conversation: conv, now,
    summary: `nudge dropped (window)${closesAt ? ` — closes at ${closesAt.toISOString()}` : ''}`,
  });
}

// Settle an unsent nudge as dropped, only while it is still the same unsent, undropped nudge.
function markDropped(conv, nudge, reason, now) {
  return jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'nudge',
    { dropped_at: now.toISOString(), drop_reason: reason },
    { match: { for_inbound_id: nudge.for_inbound_id, sent_at: null, dropped_at: null } });
}

const DELIVERED_OUTCOMES = ['sent', 'ambiguous', 'deduped'];

async function sweepNudges(business, teamHours, now, report) {
  if (!followups.nudgesEnabled()) return;
  const convs = await prisma.conversation.findMany({
    where: { business_id: business.id, last_inbound_at: { gte: ago(now, NUDGE_LOOKBACK_MS) } },
  });
  await each(report, `nudges ${business.id}`, convs, async (conv) => {
    if (conv.status === 'human_takeover' || !notesAllowed(business, conv)) return;
    const lastInbound = await newestInboundRow(conv.id);
    if (!lastInbound) return;
    // Sample flags as delivered, not as written before the send (D17): a card that failed is not «sent», so
    // the 2 h sample touch is planned instead of the 20 h stage nudge (review minor).
    const view = await replyBatcher.deliveredView(conv, now);
    const wd = workflowData(view);

    // Plan: no nudge yet, or the stored one belongs to an older silence.
    let nudge = wd.nudge && typeof wd.nudge === 'object' ? wd.nudge : null;
    if (!nudge || nudge.for_inbound_id !== lastInbound.id) {
      const outbound = await newestDeliveredOutbound(conv.id);
      const newestMessage = outbound && toMs(outbound.created_at) > toMs(lastInbound.created_at) ? outbound : lastInbound;
      const planned = followups.planNudge({ conversation: view, lastInbound, lastBot: wd.last_bot, now, newestMessage });
      if (planned) {
        await jsonb.patchJson('conversations', conv.id, 'workflow_data', { nudge: planned });
        nudge = planned;
        if (planned.dropped_at) {
          report.nudges_dropped += 1;
          if (planned.drop_reason === 'window') await flagWindowDrop(business, conv, planned, now);
          return;
        }
      }
    }
    if (!nudge) return;

    const convWithNudge = { ...view, workflow_data: { ...wd, nudge } };
    const staff = await newestStaffOutbound(conv.id);
    const due = followups.dueDecision(nudge, convWithNudge, now, { newestInbound: lastInbound, newestStaffOutbound: staff });
    if (due.decision === 'wait' || due.reason === 'settled' || due.reason === 'none') return;

    if (due.decision === 'drop') {
      if (!(await markDropped(conv, nudge, due.reason, now))) return;
      report.nudges_dropped += 1;
      if (due.reason === 'window') await flagWindowDrop(business, conv, nudge, now);
      return;
    }

    // Send: claimed before the send, so two sweeps never both deliver; a failed send is not retried.
    const claimed = await jsonb.claimValue('conversations', conv.id, 'metadata', 'nudge_sent_for', nudge.for_inbound_id);
    if (!claimed) return;
    const lang = expectedLanguage([lastInbound.text_body || ''], wd.lead || {});
    const part = followups.nudgePart(convWithNudge, nudge, lang);
    const sentAt = now.toISOString();
    const delivery = await replyBatcher.deliverResult({
      business,
      conversation: conv,
      result: {
        kind: 'nudge',
        action: 'NUDGE',
        messages: [part],
        stateUpdate: {},
        workflowDataPatch: { nudge: { ...nudge, sent_at: sentAt }, nudges_sent: (Number(wd.nudges_sent) || 0) + 1 },
        leadPatch: null,
        needsTeam: null,
        alert: null,
      },
      batch: [],
      windowMarginMs: NOTE_WINDOW_MARGIN_MS,
      // A staff member who stepped in after the plan owns the conversation: the pre-send check refuses.
      humanGuard: true,
      // «إيقاف» stored after the silence this nudge follows: the pre-send check refuses (review minor).
      optedOutSince: nudge.for_inbound_at || lastInbound.created_at,
      now,
    });
    const outcome = delivery && delivery.outcome;
    if (DELIVERED_OUTCOMES.includes(outcome)) {
      report.nudges_sent += 1;
      return;
    }
    // Not delivered: record why, over whatever the state write stored, so the Inbox and the next sweep
    // see a settled nudge instead of one that looks due forever (its claim is already spent).
    const reason = outcome === 'window_closed' ? 'window' : outcome === 'awaiting_staff' ? 'staff' : 'send_failed';
    await jsonb.patchJson('conversations', conv.id, 'workflow_data', {
      nudge: { ...nudge, sent_at: null, dropped_at: now.toISOString(), drop_reason: reason },
    });
    report.nudges_dropped += 1;
    if (reason === 'window') await flagWindowDrop(business, conv, nudge, now);
  });
}

// ─── 9. Booking reminders (PR3 design §5) ────────────────────────────────────

function reminderKey(kind) {
  return `booking_reminder_${kind}`;
}

/**
 * Settle one reminder on the booking it was for (same event, same start): the value replaces
 * `booking.reminders[kind]` inside the stored reminders, read fresh so a sibling kind is kept.
 */
async function settleReminder(convId, b, kind, value) {
  const fresh = await prisma.conversation.findUnique({ where: { id: convId } });
  const stored = workflowData(fresh).booking;
  if (!stored || stored.event_id !== b.event_id || stored.start !== b.start) return false;
  const reminders = stored.reminders && typeof stored.reminders === 'object' ? stored.reminders : {};
  return jsonb.mergeObjectKey('conversations', convId, 'workflow_data', 'booking',
    { reminders: { ...reminders, [kind]: value } }, { match: { event_id: b.event_id, start: b.start } });
}

/**
 * Once per (event, start, kind), reclaimable like the awaiting note: metadata.booking_reminder_<kind> holds
 * `${event_id}|${start}#${attempt}`. A claim younger than NOTE_CLAIM_TTL_MS belongs to a live sweep; an older
 * one whose sweep died is taken over, and its intent row (if any) is never sent again. A reschedule changes the
 * start, so the new time is claimed afresh. Returns {attempt, value} or null.
 */
async function claimReminder(conv, b, kind, now) {
  const meta = metadataOf(conv);
  const key = reminderKey(kind);
  const base = `${b.event_id}|${b.start}`;
  const stored = typeof meta[key] === 'string' ? meta[key] : '';
  let attempt = 1;
  if (stored.startsWith(`${base}#`)) {
    const claimedAt = meta[`${key}_claimed_at`] ? toMs(meta[`${key}_claimed_at`]) : NaN;
    if (Number.isFinite(claimedAt) && now.getTime() - claimedAt < NOTE_CLAIM_TTL_MS) return null;
    attempt = (parseInt(stored.slice(base.length + 1), 10) || 1) + 1;
  }
  await jsonb.patchJson('conversations', conv.id, 'metadata', { [`${key}_claimed_at`]: now.toISOString() });
  const value = `${base}#${attempt}`;
  return (await jsonb.claimValue('conversations', conv.id, 'metadata', key, value)) ? { attempt, value } : null;
}

async function sendReminder(business, conv, b, kind, now, report) {
  const wd = workflowData(conv);
  const at = now.toISOString();
  if (wd.marketing_opted_out_at) {
    if (await settleReminder(conv.id, b, kind, { skipped: 'opted_out', at })) report.reminders_skipped += 1;
    return;
  }
  // A staff member holds the conversation (and may have changed the call by hand): no bot reminder.
  if (conv.status === 'human_takeover') {
    if (await settleReminder(conv.id, b, kind, { skipped: 'staff', at })) report.reminders_skipped += 1;
    return;
  }
  // D1 save-only: no bot message, not even a reminder (staff see the booking in the calendar).
  if (!notesAllowed(business, conv)) return;

  const claim = await claimReminder(conv, b, kind, now);
  if (!claim) return;
  const batchKey = `booking_reminder:${kind}:${b.event_id}:${b.start}`;
  const madeAt = new Date(toMs(b.rescheduled_at || b.booked_at) - MINUTE_MS);
  if (claim.attempt > 1 && await noteIntentExists(conv.id, batchKey, madeAt)) {
    // The sweep that died had written the intent: it may have been sent; never send it twice.
    await settleReminder(conv.id, b, kind, { sent_at: at, via: 'recovered' });
    return;
  }

  const lang = booking.reminderLang(wd, b);
  // Inside the window a free-form message; outside it only the approved template may be sent.
  const inWindow = isWithinServiceWindow(conv.last_inbound_at, now, { marginMs: NOTE_WINDOW_MARGIN_MS });
  const part = inWindow ? booking.reminderPart(kind, b, now, lang) : booking.templatePart(kind, b, now, lang);
  const dispatch = await replyBatcher.dispatchIntent({
    business,
    conversation: conv,
    kind: 'booking_reminder',
    parts: [part],
    batchIds: [],
    batchKey,
    since: madeAt,
    // The customer asked for this call; the reminder goes out while nobody has claimed the conversation, never
    // after an opt-out stored since the booking, and only while this sweep still holds the claim.
    precheck: {
      humanGuard: false,
      optedOutSince: b.booked_at || null,
      claim: [{ column: 'metadata', path: [reminderKey(kind)], value: claim.value }],
    },
    now,
  });
  const outcome = dispatch && dispatch.outcome;
  const via = inWindow ? 'text' : 'template';
  if (DELIVERED_OUTCOMES.includes(outcome)) {
    const sentPart = (dispatch.parts || []).find((p) => p.intentId);
    await settleReminder(conv.id, b, kind, { sent_at: at, via, intent_id: sentPart ? sentPart.intentId : null });
    report.reminders_sent += 1;
    return;
  }
  if (outcome === 'aborted') {
    const fresh = await prisma.conversation.findUnique({ where: { id: conv.id } });
    // Taken over by another sweep: the send and the settle are its to finish.
    if (metadataOf(fresh)[reminderKey(kind)] !== claim.value) return;
    await settleReminder(conv.id, b, kind, { skipped: 'precheck', at });
    report.reminders_skipped += 1;
    return;
  }
  const reason = ((dispatch && dispatch.parts) || []).map((p) => p.reason).find(Boolean) || (dispatch && dispatch.noToken ? 'no_token' : 'failed');
  if (!inWindow && ['template', 'billing'].includes(reason)) {
    // Not approved yet, paused, or no payment method: skipped (never retried), flagged, staff told once per booking.
    await settleReminder(conv.id, b, kind, { skipped: reason, at });
    await jsonb.patchJson('conversations', conv.id, 'metadata', { reminder_blocked: { kind, reason, at, event_id: b.event_id } });
    report.reminders_skipped += 1;
    if (await jsonb.claimValue('conversations', conv.id, 'metadata', 'reminder_blocked_alert_for', b.event_id)) {
      await sendStaffAlert({
        reason: 'reminder_blocked', business, conversation: conv, now,
        summary: `${kind}: ${reason === 'billing' ? 'واتساب بدو طريقة دفع' : 'القالب shift_call_reminder مش معتمد أو موقوف'} — المكالمة ${b.start}`,
      });
    }
    return;
  }
  await settleReminder(conv.id, b, kind, { failed: reason, at });
  report.reminders_failed += 1;
}

async function sweepBookings(business, teamHours, now, report) {
  const convs = await prisma.conversation.findMany({
    where: { business_id: business.id, last_message_at: { gte: ago(now, BOOKING_LOOKBACK_MS) } },
  });
  await each(report, `bookings ${business.id}`, convs, async (conv) => {
    const wd = workflowData(conv);
    const b = wd.booking && typeof wd.booking === 'object' ? wd.booking : null;
    if (!b || !b.event_id || !['booked', 'rescheduled'].includes(b.status)) return;
    const at = now.toISOString();

    if (!b.passed_at && now.getTime() >= toMs(b.end) + BOOKING_PASSED_AFTER_MS) {
      const marked = await jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'booking',
        { passed_at: at }, { match: { event_id: b.event_id, start: b.start, status: b.status } });
      if (!marked) return;
      report.bookings_passed += 1;
      const nt = wd.needs_team;
      // The call time passed: its meeting request is done (staff can still reopen the conversation).
      if (nt && nt.reason === 'meeting' && !nt.resolved_at) {
        await jsonb.resolveNeedsTeam(conv.id, { match: { reason: 'meeting', at: nt.at }, resolvedAt: at });
      }
      return;
    }

    const due = booking.reminderDue(b, now);
    for (const kind of due.late) {
      if (await settleReminder(conv.id, b, kind, { skipped: 'late', at })) report.reminders_skipped += 1;
    }
    if (!due.due) return;
    // Re-read after a late settle so the send sees the reminders as stored.
    const current = due.late.length ? (await prisma.conversation.findUnique({ where: { id: conv.id } })) || conv : conv;
    const fresh = workflowData(current).booking;
    if (!fresh || fresh.event_id !== b.event_id || fresh.start !== b.start) return;
    await sendReminder(business, current, fresh, due.due, now, report);
  });
}

// ─── run ─────────────────────────────────────────────────────────────────────

// Order matters: settled or un-paused rows are back to `received` before the orphan step schedules
// runs, and before the awaiting note would tell a customer the bot is about to answer to keep waiting.
const STEPS = [
  ['unconfirmed', (b, th, now, r) => sweepUnconfirmed(b, now, r)],
  ['expired_pauses', (b, th, now, r) => sweepExpiredPauses(b, now, r)],
  ['orphans', (b, th, now, r) => sweepOrphans(b, now, r)],
  ['sla_notes', sweepSlaNotes],
  ['awaiting_notes', sweepAwaitingNotes],
  ['window_flags', (b, th, now, r) => sweepWindowFlags(b, now, r)],
  ['unanswered', (b, th, now, r) => sweepUnanswered(b, now, r)],
  // PR2: idle role-plays end before the nudge step, so a just-ended example can get its resume nudge.
  ['roleplay_idle', sweepRoleplayIdle],
  ['nudges', sweepNudges],
  // PR3: booking reminders and passed calls.
  ['bookings', sweepBookings],
];

/**
 * D24: restaurant, clinic and external-mode rows claimed as `processing` whose forward/workflow never
 * finished. Not per SHIFT business: those tenants have no SHIFT row. Required lazily: the processor
 * loads the whole webhook path, which the status route and the tests of the other steps do not need.
 */
async function sweepStuckInbound(now) {
  const { reprocessStuckInbound } = require('./messageProcessor');
  return reprocessStuckInbound({ olderThanMs: STUCK_INBOUND_AGE_MS, now });
}

async function runSweep({ now = new Date() } = {}) {
  // Scheduler and setInterval can overlap inside one instance; the DB claims cover other instances.
  if (running) return { skipped: 'already_running', ...emptyReport() };
  running = true;
  const report = emptyReport();
  try {
    try {
      report.stuck_inbound = await sweepStuckInbound(now);
    } catch (err) {
      report.errors.push(`stuck_inbound: ${err.message}`);
      console.error('[sweep] stuck_inbound failed:', err.message);
    }

    let businesses = [];
    try {
      businesses = await prisma.business.findMany({ where: { business_type: 'shift', status: 'active' } });
    } catch (err) {
      report.errors.push(`businesses: ${err.message}`);
    }

    for (const business of businesses) {
      const teamHours = resolveTeamHours(business.ai_config);
      for (const [name, step] of STEPS) {
        try {
          await step(business, teamHours, now, report);
        } catch (err) {
          report.errors.push(`${name} ${business.id}: ${err.message}`);
          console.error(`[sweep] ${name} failed for ${business.id}:`, err.message);
        }
      }
    }
    last = { at: new Date(now).toISOString(), report };
    return report;
  } finally {
    running = false;
  }
}

/** PR3 status fields: calendar configuration, upcoming bookings and reminder outcomes (recent conversations). */
async function bookingStatus(business, now) {
  const cfg = booking.bookingConfig(business);
  const convs = await prisma.conversation.findMany({
    where: { business_id: business.id, last_message_at: { gte: ago(now, BOOKING_LOOKBACK_MS) } },
  });
  const reminders = { d1_sent: 0, h1_sent: 0, template_sent: 0, skipped: 0, template_blocked: 0, failed: 0 };
  let upcoming = 0;
  for (const c of convs) {
    const b = workflowData(c).booking;
    if (!b || typeof b !== 'object') continue;
    if (booking.activeBooking(workflowData(c), now) && toMs(b.start) > now.getTime()) upcoming += 1;
    for (const kind of REMINDER_KINDS) {
      const r = b.reminders && b.reminders[kind];
      if (!r) continue;
      if (r.sent_at) {
        reminders[`${kind}_sent`] += 1;
        if (r.via === 'template') reminders.template_sent += 1;
      } else if (r.skipped) {
        reminders.skipped += 1;
        if (r.skipped === 'template' || r.skipped === 'billing') reminders.template_blocked += 1;
      } else if (r.failed) {
        reminders.failed += 1;
      }
    }
  }
  return {
    calendar_configured: cfg.configured,
    booking_enabled: cfg.enabled,
    bookings_upcoming: upcoming,
    reminders,
  };
}

async function getShiftStatus({ now = new Date() } = {}) {
  const [business] = await prisma.business.findMany({ where: { business_type: 'shift', status: 'active' } });
  if (!business) return { workflow_active: false, business: null };

  const aiConfig = business.ai_config || {};
  const botLive = process.env.SHIFT_BOT_LIVE !== '0';
  const newest = (direction) => prisma.message.findFirst({
    where: { business_id: business.id, direction },
    orderBy: { created_at: 'desc' },
  });
  const [lastIn, lastOut, pending, awaitingStaff, receivedBacklog, unconfirmed, ambiguous, convs] = await Promise.all([
    newest('inbound'),
    newest('outbound'),
    prisma.conversation.count({ where: { business_id: business.id, status: 'pending' } }),
    prisma.message.count({ where: { business_id: business.id, direction: 'inbound', status: 'awaiting_staff' } }),
    prisma.message.count({
      where: { business_id: business.id, direction: 'inbound', status: 'received', created_at: { lt: ago(now, BACKLOG_AGE_MS) } },
    }),
    // D18: customer messages whose covering reply has no confirmation yet.
    prisma.message.count({ where: { business_id: business.id, direction: 'inbound', status: 'unconfirmed' } }),
    prisma.message.count({
      where: { business_id: business.id, direction: 'outbound', status: { in: ['ambiguous', 'ambiguous_unreconciled'] } },
    }),
    // PR2 counters live in workflow_data (no JSON-path filters allowed): recent conversations, counted in JS.
    prisma.conversation.findMany({
      where: { business_id: business.id, last_message_at: { gte: ago(now, 2 * NUDGE_LOOKBACK_MS) } },
    }),
  ]);
  const nudgesPending = convs.filter((c) => {
    const n = workflowData(c).nudge;
    return !!(n && typeof n === 'object' && !n.sent_at && !n.dropped_at);
  }).length;
  const roleplaysActive = convs.filter((c) => roleplay.isActive(workflowData(c))).length;
  const bookingStats = await bookingStatus(business, now);
  const iso = (row) => (row && row.created_at ? new Date(row.created_at).toISOString() : null);

  return {
    business: { id: business.id, name: business.name },
    workflow_active: business.status === 'active' && aiConfig.reply_mode !== 'external' && botLive,
    reply_mode: aiConfig.reply_mode ?? null,
    bot_live: botLive,
    test_numbers_count: testNumbers(business).size,
    alert_channel_configured: alertChannelConfigured(business),
    model: resolveModel(),
    graph_version: graphVersion(),
    last_inbound_at: iso(lastIn),
    last_outbound_at: iso(lastOut),
    pending,
    awaiting_staff: awaitingStaff,
    received_backlog: receivedBacklog,
    unconfirmed,
    ambiguous,
    nudges_pending: nudgesPending,
    roleplays_active: roleplaysActive,
    ...bookingStats,
    sweep: lastSweep(),
    now: new Date(now).toISOString(),
  };
}

module.exports = { runSweep, getShiftStatus, lastSweep, isCloser, STEPS };
