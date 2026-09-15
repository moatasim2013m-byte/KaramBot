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

let running = false;
let last = { at: null, report: null };

function emptyReport() {
  return {
    stuck_inbound: null, unconfirmed_requeued: 0, unconfirmed_escalated: 0, ambiguous_alerts: 0,
    pause_requeued: 0, orphans: 0, sla_notes: 0, awaiting_notes: 0, window_flags: 0, unanswered_alerts: 0, errors: [],
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
    let eligible = conv.status === 'pending' || conv.status === 'human_takeover';
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

async function getShiftStatus({ now = new Date() } = {}) {
  const [business] = await prisma.business.findMany({ where: { business_type: 'shift', status: 'active' } });
  if (!business) return { workflow_active: false, business: null };

  const aiConfig = business.ai_config || {};
  const botLive = process.env.SHIFT_BOT_LIVE !== '0';
  const newest = (direction) => prisma.message.findFirst({
    where: { business_id: business.id, direction },
    orderBy: { created_at: 'desc' },
  });
  const [lastIn, lastOut, pending, awaitingStaff, receivedBacklog, unconfirmed, ambiguous] = await Promise.all([
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
  ]);
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
    sweep: lastSweep(),
    now: new Date(now).toISOString(),
  };
}

module.exports = { runSweep, getShiftStatus, lastSweep, isCloser };
