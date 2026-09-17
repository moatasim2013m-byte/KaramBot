/**
 * Reply batcher for the SHIFT number (pr1-contracts §7.1).
 *
 * Customers write in bursts («مرحبا» / «عندي كافيه» / «متى نحكي؟»). Answering each fragment on its own
 * cost one AI call per line and produced replies that ignored the next line. Instead every inbound row
 * is saved as `received`, a per-conversation quiet window collects the burst, and one run answers all
 * `received` rows together.
 *
 * Reliability rules this file owns:
 * - One run per conversation across instances: a jsonb lease with DB now() (safe behind PgBouncer).
 *   The lease is only ever renewed while unexpired, and every Graph call is preceded by ONE conditional
 *   statement re-checking lease ownership and human state (D20): a stalled worker or a staff claim
 *   made after the last check can never be talked over.
 * - Send-intent protocol (D17): every bot/system outbound is an intent row (`sending`) written before
 *   the Graph call; its id travels as `biz_opaque_callback_data` and comes back in status webhooks.
 * - At most once, never silent (D18): Graph has no idempotency key, so an unknown outcome is not
 *   resent at once. Its rows wait as `unconfirmed`; a confirmation (wamid or echoed status) answers
 *   them, and after 2 minutes without one reconcileUnconfirmedIntents requeues them once, then hands
 *   them to staff (`awaiting_staff` + needs_team `unsent_reply` + alert).
 * - State before send: acks may only state what is persisted («سجّلت طلبك…»), built from what the
 *   writes returned (D26).
 * - Deterministic rows (opt-out, reactions, button taps) are handled here from durable `received` rows,
 *   under the lease (D23), so a crash is recovered with the same logic and never by the AI.
 * - The burst's quiet deadline is shared in `metadata.batch_due_at` (D25): a timer or sweep that fires
 *   early on any instance waits for it.
 */

const crypto = require('crypto');
const prisma = require('../config/prisma');
const jsonb = require('../db/jsonb');
const whatsapp = require('./whatsapp');
const alerts = require('./alerts');
const shift = require('../workflows/shift');
const { mergeNeedsTeam, needsTeamEntry, renderCaptureAck, NEEDS_TEAM_PRIORITY } = require('../workflows/shift/results');
const lead = require('../workflows/shift/lead');
const { isShiftButtonId, handleButton } = require('../workflows/shift/buttons');
const booking = require('../workflows/shift/booking');
const { isOptOutCommand, optOutResult } = require('../workflows/shift/optout');
const { pickLanguage } = require('../workflows/shift/acks');
const roleplay = require('../workflows/shift/roleplay');
const media = require('../workflows/shift/media');
const { expectedLanguage } = require('../workflows/shift/validators');
const { vettedSectors } = require('../workflows/shift/assets');
const { isWithinServiceWindow, REPLY_WINDOW_MARGIN_MS } = require('../utils/serviceWindow');
const { decrypt } = require('../utils/tokenCrypto');
const sseEmitter = require('../utils/sseEmitter');
const { SITE_HOST } = require('../config/site');

const LEASE_TTL_MS = 60000;
// 30 s: attempt 1 is capped at 15 s, so 25 s left a hung first attempt only 10 s for the retry and two
// of the six 2026-09-17 sims spent the whole budget on two aborts and answered «تأخر ردّي». 30 s gives
// the retry a full 15 s (on a shrunk turn). Healthy calls are unaffected — p50 5.3 s, p90 12.1 s.
const AI_DEADLINE_MS = Number(process.env.SHIFT_AI_DEADLINE_MS) || 30000;
const HUMAN_ACTIVE_MS = 30 * 60 * 1000;
const MAX_BATCH = 20;
const MAX_REPLY_FAILURES = 3;
const HOT_LEAD_SCORE = 6;
// A tap arriving while the model generates forces another generation, bounded so taps cannot loop a run.
const MAX_REGENERATIONS = 3;
const AMBIGUOUS_SUMMARY = 'انقطع الإرسال وما بنعرف إذا وصل — راجع المحادثة';
const UNSENT_SUMMARY = 'رد البوت ما تأكد وصوله مرتين — العميل ممكن يكون بدون رد';

// D18: an intent with neither a wamid nor an echoed status after this is treated as not delivered.
const UNCONFIRMED_AFTER_MS = 2 * 60 * 1000;
// Requeues allowed per batch key before the rows are handed to staff.
const UNCONFIRMED_RETRIES = 1;
const RECONCILE_LIMIT = 200;
// Inbound `unconfirmed` rows untouched this long, with no unconfirmed intent left to settle them, were
// stranded by a crash mid-settlement (rescueStrandedUnconfirmed).
const STRANDED_AFTER_MS = 5 * 60 * 1000;
// A deadline this close is "now": avoids a 3 ms re-arm loop from clock rounding.
const DUE_TOLERANCE_MS = 25;
// PR2 (contract §1.4 / §10.2): a result has 1–3 parts of these types; a later part may wait up to
// 1.5 s (the sample page follow-up) before its own pre-send check.
const MAX_PARTS = 3;
// PR3: `template` (a booking reminder outside the 24 h window) is only ever sent by the sweeper through
// dispatchIntent; results never carry one.
const PART_TYPES = ['text', 'interactive', 'list', 'cta_url', 'image', 'template'];
const MAX_PART_DELAY_MS = 1500;
// Graph definitely refused the part: its `fallback` (e.g. the same buttons without an image header) is
// sent once. Never after `ambiguous` — the original may have arrived.
const FALLBACK_REASONS = ['rejected', 'invalid_payload'];
// Media transcription that took this much of the lease renews it before the model call (§10.2 #1).
const MEDIA_RENEW_AFTER_MS = 20000;

// Inbound rows whose covering send has not been confirmed yet. Not `received` (a run would answer them
// again) and not `answered` (the customer may have nothing).
const UNCONFIRMED = 'unconfirmed';
// Intent statuses that prove, or are treated as proving, nothing reached the customer: they never block
// a new intent for the same batch key.
const UNDELIVERED = ['failed', 'ambiguous_unreconciled', 'cancelled'];
// Graph returned a wamid, or a status webhook echoed one of these.
const CONFIRMED = ['sent', 'delivered', 'read'];
const STATUS_RANK = { sent: 1, delivered: 2, read: 3 };

// Outbound kinds that answer the inbound rows listed in their batch_ids (notes do not). An opt-out ack
// covers its command row, which ends `skipped` instead of `answered`.
const COVERING_KINDS = ['reply', 'fallback', 'handoff', 'button', 'media'];
const ACK_KINDS = [...COVERING_KINDS, 'optout'];
// WhatsApp notices and reactions: nothing to answer.
const SKIP_TYPES = ['reaction', 'system', 'ephemeral'];
// Outcomes after which an immediate re-run would only repeat the same decision. A failed delivery
// (throttled, Meta 5xx, billing) is not retried at once either: three back-to-back attempts would all
// land inside the same outage. The rows stay `received` and the sweeper retries them a minute apart.
const NO_RESCHEDULE = new Set(['lease_busy', 'lease_lost', 'not_due', 'awaiting_staff', 'skipped', 'window_closed', 'failed']);

const timers = new Map(); // conversationId → { timer, firstAt }
const inFlight = new Set(); // runs and deliveries a shutdown waits for
let stopping = false;

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
}

function batchCapMs() {
  return parseInt(process.env.SHIFT_BATCH_CAP_MS, 10) || 10000;
}

// ─── Pure rules ──────────────────────────────────────────────────────────────

/**
 * How long to wait for the next fragment. A question or a long message is usually complete; a
 * two-word line («بإربد») usually has more coming.
 */
function quietWindowMs(text, env = process.env) {
  const base = parseInt(env.SHIFT_BATCH_QUIET_MS, 10) || 2500;
  const s = String(text || '').trim();
  const words = s.split(/\s+/).filter(Boolean);
  const tail = s.replace(/[\s\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]+$/u, '');
  if (/[?؟]$/.test(tail) || words.length >= 8) return Math.round(base * 0.6);
  if (words.length <= 4) return Math.round(base * 1.6);
  return base;
}

/** D1: SHIFT_BOT_LIVE unset = live; '0' = save-only except test numbers. External mode never replies. */
function isShiftReplyAllowed(business, customerWaId, env = process.env) {
  const aiConfig = (business && business.ai_config) || {};
  if (aiConfig.reply_mode === 'external') return false;
  if (env.SHIFT_BOT_LIVE !== '0') return true;
  const fromConfig = Array.isArray(aiConfig.test_numbers) ? aiConfig.test_numbers : [];
  const fromEnv = String(env.SHIFT_TEST_NUMBERS || '').split(',');
  const testNumbers = new Set([...fromConfig, ...fromEnv].map(digits).filter(Boolean));
  return testNumbers.has(digits(customerWaId));
}

/** A person from the team is (or just was) talking to this customer: the bot stays quiet. */
function isHumanActive(conversation, lastStaffOutbound, now = new Date()) {
  if (!conversation) return false;
  const nowMs = toMs(now);
  if (conversation.status === 'human_takeover' || conversation.ai_enabled === false) return true;
  const metadata = conversation.metadata || {};
  if (metadata.human_active_until && toMs(metadata.human_active_until) > nowMs) return true;
  // «إرجاع للبوت» stamps released_at: staff messages sent before it no longer keep the bot quiet.
  const released = metadata.released_at ? toMs(metadata.released_at) : null;
  if (lastStaffOutbound && lastStaffOutbound.created_at
    && !(released !== null && toMs(lastStaffOutbound.created_at) <= released)
    && nowMs - toMs(lastStaffOutbound.created_at) < HUMAN_ACTIVE_MS) return true;
  return false;
}

/** A tap on one of the bot's own buttons (slot offers, «احكي مع الفريق»). */
function tapButtonId(message) {
  // PR3: a quick reply on the reminder template («بدي أغيّر الموعد» / "See you then") is a booking control.
  const templateReply = booking.templateReplyId(message);
  if (templateReply) return templateReply;
  const reply = message && message.interactive_reply;
  const id = reply && ((reply.button_reply && reply.button_reply.id) || (reply.list_reply && reply.list_reply.id));
  return isShiftButtonId(id) ? id : null;
}

function isSkipRow(message) {
  return !!message && SKIP_TYPES.includes(message.message_type);
}

function isOptOutRow(message) {
  return !!message && message.message_type === 'text' && isOptOutCommand(message.text_body || '');
}

// ─── Timers (in-memory, per instance; batch_due_at and the sweeper cover other instances) ──

function armTimer(conversationId, delay) {
  if (!conversationId || stopping) return;
  const existing = timers.get(conversationId);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    timers.delete(conversationId);
    runBatch(conversationId).catch((err) => {
      console.error(`[batcher] run failed conversation=${conversationId}:`, err && err.message);
    });
  }, Math.max(0, delay));
  if (timer && typeof timer.unref === 'function') timer.unref();
  timers.set(conversationId, { timer, firstAt: existing ? existing.firstAt : Date.now() });
}

function scheduleReply(conversationId, { text = '', reason = 'inbound' } = {}) {
  // While shutting down the rows stay `received`; another instance's sweeper picks them up.
  if (!conversationId || stopping) return;
  const existing = timers.get(conversationId);
  const nowMs = Date.now();

  if (reason === 'inbound') {
    const firstAt = existing ? existing.firstAt : nowMs;
    armTimer(conversationId, Math.min(quietWindowMs(text), Math.max(0, firstAt + batchCapMs() - nowMs)));
    return;
  }
  // A pending inbound timer fires within the cap and collects the same rows; replacing it with an
  // immediate run would cut the customer's burst in half.
  if (existing) return;
  armTimer(conversationId, 0);
}

/**
 * D25 / GPT-6 #9: record a new fragment's quiet deadline in the DB (shared by every instance) and arm
 * this instance's timer for it. The processor calls this for each SHIFT inbound it queues.
 * Resolves to {dueAt, delayMs} or null (no such conversation). DB errors propagate.
 */
async function touchBatchDue(conversationId, quietMs) {
  if (!conversationId) return null;
  const due = await jsonb.touchBatchDue(conversationId, quietMs, batchCapMs());
  if (due) armTimer(conversationId, due.delayMs);
  return due;
}

function hasPendingTimer(conversationId) {
  return timers.has(conversationId);
}

function cancel(conversationId) {
  const entry = timers.get(conversationId);
  if (entry) clearTimeout(entry.timer);
  timers.delete(conversationId);
}

function cancelAll() {
  for (const entry of timers.values()) clearTimeout(entry.timer);
  timers.clear();
}

function track(promise) {
  inFlight.add(promise);
  promise.then(() => inFlight.delete(promise), () => inFlight.delete(promise));
  return promise;
}

/**
 * SIGTERM (deploy, scale-in): stop starting runs and wait for the ones mid-send, so an intent row is
 * not left at `sending`. Cloud Run kills the process 10 s after SIGTERM, hence the budget.
 */
async function shutdown(timeoutMs = 8000) {
  stopping = true;
  cancelAll();
  if (!inFlight.size) return true;
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
  const done = Promise.allSettled([...inFlight]).then(() => true);
  const drained = await Promise.race([done, timeout]);
  clearTimeout(timer);
  return drained;
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

// Status-based, not time-based: two rows whose created_at are out of order (clock skew between
// instances) are both still `received`, so both are answered.
async function collectBatch(conversationId) {
  return prisma.message.findMany({
    where: { conversation_id: conversationId, direction: 'inbound', status: 'received' },
    orderBy: { created_at: 'asc' },
    take: MAX_BATCH,
  });
}

// Returns how many rows moved.
async function markRows(ids, status, from = ['received']) {
  if (!ids.length) return 0;
  const r = await prisma.message.updateMany({
    where: { id: { in: ids }, status: { in: from } },
    data: { status },
  });
  return (r && r.count) || 0;
}

async function lastStaffOutbound(conversationId) {
  return prisma.message.findFirst({
    where: { conversation_id: conversationId, direction: 'outbound', sent_by_user_id: { not: null } },
    orderBy: { created_at: 'desc' },
  });
}

// Outbound rows written since `since`. `gte`, not `gt`: an outbound stamped in the same millisecond as
// the first inbound must still count.
async function outboundSince(conversationId, since) {
  if (!since) return [];
  return prisma.message.findMany({
    where: { conversation_id: conversationId, direction: 'outbound', created_at: { gte: since } },
    orderBy: { created_at: 'asc' },
  });
}

// ─── delivered facts (review r1-7) ───────────────────────────────────────────

const DELIVERED_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const ROLEPLAY_START_RE = /^\s*(?:مثال توضيحي 🎭|Illustrative example 🎭)/;
// The end note in front of the first reply after a silent idle end (results.withEndNote).
const ROLEPLAY_END_NOTE_RE = /^\s*\((?:كان مثال توضيحي|That was an illustrative example)/;

/**
 * State is written before the send (D17), so "the sample was sent", "the example started" and "Karam
 * introduced himself" are recorded even when that send then failed and the rows went back to `received`.
 * A rerun must not trust those flags: before a workflow reads the conversation, each one is checked
 * against the outbound intent rows, and a flag with no row that may have reached the customer is taken
 * out of the in-memory view (never written back). The rerun then sends the card again instead of
 * «المثال وصلك فوق 👆», and an example whose start line never arrived gets that line with its first turn.
 */
async function deliveredView(conv, now = new Date()) {
  const wd = conv && conv.workflow_data && typeof conv.workflow_data === 'object' ? conv.workflow_data : null;
  if (!wd) return conv;
  const samples = wd.samples_sent && typeof wd.samples_sent === 'object' ? wd.samples_sent : null;
  const rp = wd.roleplay && wd.roleplay.active === true && wd.roleplay.started_at ? wd.roleplay : null;
  const checkImage = !!(samples && samples.image);
  const checkPage = !!(samples && samples.page);
  const checkDisclosed = !!wd.disclosed_at;
  const announced = wd.roleplay && wd.roleplay.active !== true && wd.roleplay.end_reason === 'idle' && wd.roleplay.end_announced_at
    ? wd.roleplay
    : null;
  if (!checkImage && !checkPage && !rp && !checkDisclosed && !announced) return conv;
  let rows;
  try {
    rows = await outboundSince(conv.id, new Date(toMs(now) - DELIVERED_LOOKBACK_MS));
  } catch (err) {
    console.error(`[batcher] delivered view failed conversation=${conv.id}: ${err.message}`);
    return conv;
  }
  const payload = (m) => m.raw_payload || {};
  // A flag is withdrawn only on evidence: an intent that carried it failed, and none that carried it may
  // have arrived (a header-less fallback of the card counts as the card).
  const undelivered = (match) => {
    const carried = (rows || []).filter(match);
    return carried.some((m) => UNDELIVERED.includes(m.status)) && !carried.some((m) => !UNDELIVERED.includes(m.status));
  };
  const next = { ...wd };
  let changed = false;
  if (checkImage && undelivered((m) => (payload(m).image_link && String(payload(m).image_link).includes(samples.image))
    || payload(m).fallback_of)) {
    next.samples_sent = { ...(next.samples_sent || samples), image: null };
    changed = true;
  }
  if (checkPage && undelivered((m) => payload(m).part_type === 'cta_url')) {
    next.samples_sent = { ...(next.samples_sent || samples), page: null };
    changed = true;
  }
  if (rp) {
    const startedMs = toMs(rp.started_at) - 5000;
    if (undelivered((m) => toMs(m.created_at) >= startedMs && ROLEPLAY_START_RE.test(m.text_body || ''))) {
      next.roleplay = { ...rp, start_undelivered: true };
      changed = true;
    }
  }
  if (announced) {
    // The note that told the customer the example had ended never arrived: the rerun says it again.
    const atMs = toMs(announced.end_announced_at) - 5000;
    if (undelivered((m) => toMs(m.created_at) >= atMs && ROLEPLAY_END_NOTE_RE.test(m.text_body || ''))) {
      next.roleplay = { ...announced, end_announced_at: null };
      changed = true;
    }
  }
  if (checkDisclosed && undelivered((m) => typeof m.text_body === 'string' && m.text_body.includes(SITE_HOST))) {
    next.disclosed_at = null;
    changed = true;
  }
  return changed ? { ...conv, workflow_data: next } : conv;
}

function inboundStatusOf(payload) {
  return payload.inbound_status || (payload.kind === 'optout' ? 'skipped' : 'answered');
}

/**
 * Before answering: rows an earlier run already sent something for. A confirmed intent (wamid) means
 * the commit after the send failed: mark the rows as that send left them. A `sending`/`ambiguous`
 * intent may or may not have reached the customer (GPT-6 #3): never resend it and never call it an
 * answer — its rows wait as `unconfirmed` for the status webhook or reconcileUnconfirmedIntents.
 * A `sending` row seen by the lease holder belongs to a run that died mid-send; it becomes `ambiguous`.
 */
async function recoverCovered(conversationId, batch) {
  if (!batch.length) return batch;
  const recent = await outboundSince(conversationId, batch[0].created_at);
  const done = new Map();
  const pending = new Set();
  const dead = [];
  for (const row of recent) {
    const payload = row.raw_payload || {};
    if (!ACK_KINDS.includes(payload.kind) || !Array.isArray(payload.batch_ids)) continue;
    if (CONFIRMED.includes(row.status)) {
      payload.batch_ids.forEach((id) => done.set(id, inboundStatusOf(payload)));
    } else if (row.status === 'sending' || row.status === 'ambiguous') {
      if (row.status === 'sending') dead.push(row.id);
      payload.batch_ids.forEach((id) => pending.add(id));
    }
  }
  if (dead.length) {
    const { count } = await prisma.message.updateMany({ where: { id: { in: dead }, status: 'sending' }, data: { status: 'ambiguous' } });
    if (count) console.warn(`[batcher] ${count} send(s) left at sending by an earlier run conversation=${conversationId} — ambiguous`);
  }
  const byStatus = new Map();
  for (const m of batch) {
    const status = done.get(m.id) || (pending.has(m.id) ? UNCONFIRMED : null);
    if (!status) continue;
    if (!byStatus.has(status)) byStatus.set(status, []);
    byStatus.get(status).push(m.id);
  }
  for (const [status, ids] of byStatus) await markRows(ids, status);
  if (byStatus.size) console.log(`[batcher] recovered rows already sent for conversation=${conversationId}`);
  return batch.filter((m) => !done.has(m.id) && !pending.has(m.id));
}

function decryptToken(business) {
  try {
    return decrypt(business.wa_access_token) || null;
  } catch (err) {
    console.error(`[batcher] token decrypt failed business=${business.id}: ${err.message}`);
    return null;
  }
}

// Alerts are best effort and must never hold up or break the reply path.
function fireAlert(reason, business, conversation, summary, now) {
  Promise.resolve()
    .then(() => alerts.sendStaffAlert({ reason, business, conversation, summary: summary || '', now }))
    .catch((err) => console.error(`[batcher] alert ${reason} failed: ${err && err.message}`));
}

// ─── runBatch ────────────────────────────────────────────────────────────────

function runBatch(conversationId, options) {
  return track(runBatchLeased(conversationId, options));
}

/**
 * D25: ms until the burst's shared deadline, capped (a skewed clock must not park a customer), 0 when
 * due or unset. Read before taking the lease so an early timer does not churn it.
 */
async function msUntilDue(conversationId, clock) {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  const due = conv && conv.metadata && conv.metadata.batch_due_at;
  if (!due) return 0;
  const wait = toMs(due) - clock().getTime();
  return Number.isFinite(wait) && wait > DUE_TOLERANCE_MS ? Math.min(wait, batchCapMs()) : 0;
}

async function runBatchLeased(conversationId, { now = () => new Date() } = {}) {
  const clock = typeof now === 'function' ? now : () => new Date(now);
  const wait = await msUntilDue(conversationId, clock);
  if (wait > 0) {
    armTimer(conversationId, wait);
    return { outcome: 'not_due', sent: 0 };
  }

  const token = crypto.randomUUID();
  if (!(await jsonb.acquireLease(conversationId, token, LEASE_TTL_MS))) {
    return { outcome: 'lease_busy', sent: 0 };
  }

  let report = { outcome: 'failed', sent: 0 };
  let mayReschedule = true;
  try {
    report = await runLeased(conversationId, token, clock);
    if (report.noRetry) mayReschedule = false;
  } catch (err) {
    console.error(`[batcher] runBatch error conversation=${conversationId}:`, err && err.message);
    // A thrown DB error would most likely throw again at once; the sweeper retries the orphan in 30 s.
    mayReschedule = false;
  } finally {
    try {
      await jsonb.releaseLease(conversationId, token);
    } catch (err) {
      console.error(`[batcher] releaseLease failed conversation=${conversationId}: ${err.message}`);
    }
  }

  if (mayReschedule && !NO_RESCHEDULE.has(report.outcome)) {
    await rescheduleIfPending(conversationId);
  }
  return { outcome: report.outcome, sent: report.sent };
}

// Rows that arrived after the freshness check (or beyond MAX_BATCH) get their own run.
async function rescheduleIfPending(conversationId) {
  try {
    const rest = await collectBatch(conversationId);
    if (!rest.length) return;
    scheduleReply(conversationId, { reason: 'reschedule' });
  } catch (err) {
    console.error(`[batcher] reschedule check failed conversation=${conversationId}: ${err.message}`);
  }
}

/**
 * D23 / GPT-6 #5: an opt-out command from a durable `received` row, under the run's lease. deliver
 * persists the opt-out state and creates the ack's intent before the command row leaves `received`;
 * only then is everything else queued skipped (no sales reply follows «إيقاف»). A failed state write
 * leaves every row `received`, so the retry takes this same path — never the AI.
 */
async function handleOptOut({ id, token, business, conv, batch, stop, clock }) {
  cancel(id);
  const now = clock();
  const wd = conv.workflow_data || {};
  const lang = pickLanguage(wd.lead || {}, stop.text_body || '');
  const result = optOutResult({ conversation: conv, lang, now });
  if (roleplay.isActive(wd)) {
    // §10.3: «إيقاف» mid-example ends the example and whatever nudge was planned for it.
    result.workflowDataPatch = { ...result.workflowDataPatch, roleplay: roleplay.endState(wd.roleplay, 'optout', now), nudge: null };
  }
  const report = await deliverResult({
    business, conversation: conv, result, batch: [stop], leaseToken: token, inboundStatus: 'skipped', now,
  });
  if (['state_failed', 'lease_lost'].includes(report.outcome)) {
    return { outcome: runOutcome(report), sent: 0, noRetry: report.noRetry };
  }
  // The opt-out is persisted: rows queued with it are not answered by a sales reply.
  await markRows(batch.filter((m) => m.id !== stop.id).map((m) => m.id), 'skipped');
  return { outcome: runOutcome(report), sent: countDelivered(report), noRetry: report.noRetry };
}

async function runLeased(id, token, clock) {
  let conv = await prisma.conversation.findUnique({ where: { id } });
  if (!conv) return { outcome: 'no_batch', sent: 0 };
  const business = await prisma.business.findUnique({ where: { id: conv.business_id } });
  let batch = await collectBatch(id);
  if (!batch.length) return { outcome: 'no_batch', sent: 0 };

  if (!business || business.business_type !== 'shift' || business.status !== 'active'
    || !isShiftReplyAllowed(business, conv.customer_wa_id)) {
    await markRows(batch.map((m) => m.id), 'skipped');
    return { outcome: 'skipped', sent: 0 };
  }

  batch = await recoverCovered(id, batch);
  if (!batch.length) return { outcome: 'recovered', sent: 0 };

  // D23: reactions and WhatsApp notices need no answer; an opt-out is answered before anything else,
  // whatever the human state (the customer's «إيقاف» must be recorded even during a takeover).
  const skip = batch.filter(isSkipRow);
  if (skip.length) {
    await markRows(skip.map((m) => m.id), 'skipped');
    batch = batch.filter((m) => !isSkipRow(m));
    if (!batch.length) return { outcome: 'skipped', sent: 0 };
  }
  const stop = batch.find(isOptOutRow);
  if (stop) return handleOptOut({ id, token, business, conv, batch, stop, clock });

  if (isHumanActive(conv, await lastStaffOutbound(id), clock())) {
    await markRows(batch.map((m) => m.id), 'awaiting_staff');
    return { outcome: 'awaiting_staff', sent: 0 };
  }

  if (!isWithinServiceWindow(conv.last_inbound_at, clock(), { marginMs: REPLY_WINDOW_MARGIN_MS })) {
    await markRows(batch.map((m) => m.id), 'skipped');
    return { outcome: 'window_closed', sent: 0 };
  }

  const accessToken = decryptToken(business);
  if (!accessToken) {
    // Rows stay `received`; retrying cannot fix a token, and the sweeper alerts on the silence.
    return { outcome: 'failed', sent: 0, noRetry: true };
  }

  let result = null;
  let regenerations = 0;
  let tapsSent = 0;
  for (;;) {
    // D20: a run that cannot renew no longer owns the conversation; whatever it computed is stale.
    if (!(await jsonb.renewLease(id, token, LEASE_TTL_MS))) return { outcome: 'lease_lost', sent: tapsSent };

    // A regeneration re-reads the conversation: staff may have claimed it while the model generated,
    // and a tap answered now would talk over the claim ack.
    if (regenerations > 0 && isHumanActive(conv, await lastStaffOutbound(id), clock())) {
      await markRows(batch.map((m) => m.id), 'awaiting_staff');
      return { outcome: 'awaiting_staff', sent: tapsSent };
    }

    // Taps first, one at a time, each from the conversation as the previous delivery left it; the
    // text rows are then generated from that state, so no reply computed before a tap follows it.
    const taps = await answerTaps({ id, token, business, clock, batch, conv });
    if (taps.stop) return { ...taps.stop, sent: tapsSent + taps.sent };
    tapsSent += taps.sent;
    if (taps.answered.size) {
      batch = batch.filter((m) => !taps.answered.has(m.id));
      conv = (await prisma.conversation.findUnique({ where: { id } })) || conv;
      if (!batch.length) return { outcome: 'sent', sent: tapsSent };
    }

    if (media.mediaEnabled()) {
      const enriched = await enrichMedia({ id, token, business, accessToken, batch, clock });
      if (enriched.leaseLost) return { outcome: 'lease_lost', sent: tapsSent };
      batch = enriched.batch;
    }

    const newest = batch[batch.length - 1];
    let leaseLost = false;
    const onRetry = async () => {
      if (!(await jsonb.renewLease(id, token, LEASE_TTL_MS))) {
        leaseLost = true;
        return;
      }
      // Re-post the typing indicator: attempt 2 can take another 8 s.
      Promise.resolve()
        .then(() => whatsapp.markAsRead(business.wa_phone_number_id, accessToken, newest.meta_message_id, { typing: true }))
        .catch(() => {});
    };
    const startedAt = clock();
    result = await shift.processShiftBatch(business, await deliveredView(conv, startedAt), batch, {
      now: startedAt,
      deadlineAt: startedAt.getTime() + AI_DEADLINE_MS,
      onRetry,
    });
    if (leaseLost) return { outcome: 'lease_lost', sent: tapsSent };

    // Freshness: a reply that ignores a line the customer sent meanwhile reads as not listening.
    // Regenerate once with the larger batch; a later line gets its own run (reschedule). A tap always
    // regenerates (up to MAX_REGENERATIONS): it may change the stage this result was computed from.
    const fresh = await collectBatch(id);
    const known = new Set(batch.map((m) => m.id));
    const added = fresh.filter((m) => !known.has(m.id) && !isSkipRow(m));
    const lateStop = added.find(isOptOutRow);
    if (lateStop) {
      // «إيقاف» while the model generated: the reply computed before it is never sent.
      return handleOptOut({ id, token, business, conv, batch: fresh, stop: lateStop, clock });
    }
    const tapArrived = added.some((m) => tapButtonId(m));
    if (added.length && result && result.kind !== 'fallback'
      && (regenerations === 0 || (tapArrived && regenerations < MAX_REGENERATIONS))) {
      batch = fresh.filter((m) => !isSkipRow(m));
      regenerations += 1;
      conv = (await prisma.conversation.findUnique({ where: { id } })) || conv;
      continue;
    }
    break;
  }

  const skippedReply = !!result && result.kind === 'skipped_reply';
  if (!skippedReply && (!result || !Array.isArray(result.messages) || !result.messages.length)) {
    console.error(`[batcher] workflow returned no messages conversation=${id} — using the fallback`);
    result = shift.toWorkflowResult(null, { business, conversation: conv, batchMessages: batch, now: clock() });
  }

  // Step 9: staff may have replied, or the customer opted out, while the model was generating.
  const conv2 = (await prisma.conversation.findUnique({ where: { id } })) || conv;
  if (isHumanActive(conv2, await lastStaffOutbound(id), clock())) {
    await markRows(batch.map((m) => m.id), 'awaiting_staff');
    return { outcome: 'awaiting_staff', sent: 0 };
  }
  const optedOutAt = conv2.workflow_data && conv2.workflow_data.marketing_opted_out_at;
  if (optedOutAt && result.kind !== 'optout' && toMs(optedOutAt) > toMs(batch[0].created_at)) {
    await markRows(batch.map((m) => m.id), 'skipped');
    return { outcome: 'skipped', sent: 0 };
  }

  if (skippedReply) return applySkippedReply(id, token, result, batch);

  if (result.kind === 'fallback') {
    // D25 / GPT-6 #9: the generic «تأخر ردّي شوي» answers the whole burst. Fragments that arrived after
    // generation started join it now; leaving them to a rescheduled run would send a second fallback.
    const known = new Set(batch.map((m) => m.id));
    const extra = (await collectBatch(id)).filter((m) => !known.has(m.id) && !isSkipRow(m) && !tapButtonId(m) && !isOptOutRow(m));
    if (extra.length) batch = [...batch, ...extra].sort((x, y) => toMs(x.created_at) - toMs(y.created_at));
  }

  const report = await deliverResult({ business, conversation: conv2, result, batch, leaseToken: token, now: clock() });
  const sent = tapsSent + countDelivered(report);
  let outcome = runOutcome(report);
  if (outcome === 'sent' && result.kind === 'fallback') outcome = 'fallback';
  return { outcome, sent, noRetry: report.noRetry };
}

/**
 * §10.2 #1 (SHIFT_MEDIA=1): transcribe voice notes and read images before the model call. The result is
 * saved on the row (raw_payload.shift_media), so a regeneration or a later run never pays for it twice.
 * Best effort: a failed save or a thrown enrichment leaves PR1's placeholder behaviour.
 */
async function enrichMedia({ id, token, business, accessToken, batch, clock }) {
  const started = Date.now();
  let out;
  try {
    out = await media.enrichBatch(business, accessToken, batch, { now: clock() });
  } catch (err) {
    console.error(`[batcher] media enrichment failed conversation=${id}: ${err && err.message}`);
    return { batch };
  }
  for (const update of (out && Array.isArray(out.updates) ? out.updates : [])) {
    const original = batch.find((m) => m.id === update.id);
    try {
      await prisma.message.update({
        where: { id: update.id },
        data: { raw_payload: { ...((original && original.raw_payload) || {}), shift_media: update.shift_media } },
      });
    } catch (err) {
      console.error(`[batcher] shift_media not saved message=${update.id}: ${err.message}`);
    }
  }
  if (Date.now() - started > MEDIA_RENEW_AFTER_MS && !(await jsonb.renewLease(id, token, LEASE_TTL_MS))) {
    return { batch, leaseLost: true };
  }
  return { batch: out && Array.isArray(out.batch) ? out.batch : batch };
}

/**
 * §10.2 #7: SHIFT_ROLEPLAY=0 ended a live example and the customer's only message was «خلص». Nothing is
 * sent (a sandbox shutdown is a server event, not a question); the patch is applied and the row answered.
 */
async function applySkippedReply(id, token, result, batch) {
  if (!(await jsonb.renewLease(id, token, LEASE_TTL_MS))) return { outcome: 'lease_lost', sent: 0 };
  try {
    const stateData = pickState(result.stateUpdate);
    if (Object.keys(stateData).length) await prisma.conversation.update({ where: { id }, data: stateData });
    if (result.workflowDataPatch && Object.keys(result.workflowDataPatch).length) {
      await mustPatch(id, 'workflow_data', result.workflowDataPatch);
    }
  } catch (err) {
    console.error(`[batcher] skipped reply state write failed conversation=${id}: ${err.message}`);
    return { outcome: 'failed', sent: 0 };
  }
  await markRows(batch.map((m) => m.id), 'answered');
  console.log(`[batcher] role-play ended without a reply conversation=${id}`);
  return { outcome: 'skipped_reply', sent: 0 };
}

function countDelivered(report) {
  return report.parts.filter((p) => p.status === 'sent' || p.status === 'ambiguous').length;
}

function runOutcome(report) {
  if (report.outcome === 'state_failed') return 'failed';
  if (report.outcome === 'deduped') return 'recovered';
  return report.outcome;
}

/**
 * Answer the batch's button taps deterministically, under the run's lease. A tap handleButton cannot
 * read stays in the batch as text. Returns the ids answered, or `stop` when a delivery did not cover
 * its tap (the tap stays `received` and the run ends like any failed delivery).
 */
async function answerTaps({ id, token, business, clock, batch, conv }) {
  const answered = new Set();
  let sent = 0;
  let current = conv;
  for (const message of batch) {
    const buttonId = tapButtonId(message);
    if (!buttonId) continue;
    if (answered.size) current = (await prisma.conversation.findUnique({ where: { id } })) || current;
    const now = clock();
    const view = await deliveredView(current, now);
    // The title the customer tapped is in the language the bot offered it in (§14 #10).
    const lang = expectedLanguage([message.text_body || ''], (current.workflow_data && current.workflow_data.lead) || {});
    let result;
    if (booking.isBookingId(buttonId)) {
      // PR3: calendar calls (freeBusy re-check, insert/patch/delete) under this run's lease, then the same
      // deliverResult: the booking is persisted before «ثبّتنا» is sent.
      result = await booking.handleBookingTap(buttonId, { business, conversation: view, now, lang, messageId: message.id });
      if (!(await jsonb.renewLease(id, token, LEASE_TTL_MS))) {
        return { answered, sent, stop: { outcome: 'lease_lost', sent: 0, noRetry: true } };
      }
    } else {
      // «مكالمة» offers the calendar's free slots when booking is on (PR2's windows otherwise).
      const offers = buttonId === 'lead_call' ? await calendarOffers(business, now, lang) : undefined;
      result = handleButton(buttonId, {
        business, conversation: view, now, lang, messageId: message.id,
        roleplayOn: roleplay.roleplayEnabled(), vetted: vettedSectors(business), offers,
      });
    }
    if (!result) continue;
    const report = await deliverResult({ business, conversation: current, result, batch: [message], leaseToken: token, now });
    sent += countDelivered(report);
    const calendarWrite = result.workflowDataPatch && result.workflowDataPatch.booking && ['BOOK_CALL', 'RESCHEDULE_CALL', 'CANCEL_CALL'].includes(result.action);
    if (calendarWrite && ['state_failed', 'awaiting_staff', 'skipped', 'lease_lost', 'window_closed'].includes(report.outcome)) {
      // The calendar already changed but the conversation did not record it (a staff claim, a DB error): staff
      // must reconcile by hand, or the tap's retry will (the event id is derived from the booking).
      fireAlert('booking_failed', business, current, `التقويم تغيّر بس المحادثة ما سجّلت (${result.action}, ${report.outcome}) — راجع التقويم`, now);
    }
    if (!['sent', 'ambiguous', 'deduped'].includes(report.outcome)) {
      return { answered, sent, stop: { outcome: runOutcome(report), sent: 0, noRetry: report.noRetry } };
    }
    answered.add(message.id);
  }
  return { answered, sent, stop: null };
}

async function calendarOffers(business, now, lang) {
  try {
    const r = await booking.offersWithin(3000, { business, now, lang });
    return r.ok ? r.offers : undefined;
  } catch (err) {
    console.error(`[batcher] calendar offers failed business=${business.id}: ${err.message}`);
    return undefined;
  }
}

// ─── dispatchIntent: the one way a bot/system message reaches Graph ─────────

function partKind(part) {
  return part.type === 'interactive' && Array.isArray(part.buttons) && part.buttons.length > 0;
}

/**
 * PR1's two shapes: plain text (an `interactive` part left without buttons goes out as text, as in PR1)
 * and reply buttons with no header or footer. Their Graph payloads and Inbox summaries are identical
 * through PR1's senders and through whatsapp.sendStructured (§4.2: "keep PR1's shapes"), so they keep
 * PR1's functions; every other shape (image header, list, CTA URL, image) goes through sendStructured.
 */
function isPr1Shape(part) {
  if (part.type === 'text') return true;
  if (part.type !== 'interactive') return false;
  return !partKind(part) || (!part.header && !part.footer);
}

async function sendPart(business, accessToken, to, part, callbackData) {
  const options = { callbackData };
  const pnid = business.wa_phone_number_id;
  if (!isPr1Shape(part)) return whatsapp.sendStructured(pnid, accessToken, to, part, options);
  return partKind(part)
    ? whatsapp.sendInteractiveButtons(pnid, accessToken, to, part.text, part.buttons, options)
    : whatsapp.sendText(pnid, accessToken, to, part.text, options);
}

// Arabic letters decide the image mark in the summary («[صورة]» / "[image]").
function partLang(part) {
  const text = [part.text, part.displayText, part.buttonLabel].filter((s) => typeof s === 'string').join(' ');
  return /[ء-ي]/.test(text) ? 'ar' : 'en';
}

/** §10.2 #3: the intent row's message_type / text_body — what the Inbox thread shows for the part. */
function summarizePart(part) {
  if (isPr1Shape(part)) {
    return partKind(part)
      ? { message_type: 'interactive', text_body: `${part.text}\n${part.buttons.map((b) => `[${b.title}]`).join(' ')}` }
      : { message_type: 'text', text_body: part.text };
  }
  return whatsapp.partSummary(part, partLang(part));
}

/** raw_payload fields that let staff and the eval harness see what the part carried (never modelLine/ack). */
function partPayload(part) {
  const out = { part_type: part.type, buttons: partKind(part) ? part.buttons : null };
  if (part.type === 'list') {
    out.rows = (part.sections || []).flatMap((s) => (s && Array.isArray(s.rows) ? s.rows : []))
      .map((r) => ({ id: r.id, title: r.title }));
  }
  if (part.type === 'cta_url') out.url = part.url;
  const link = part.type === 'image' ? part.image && part.image.link : part.header && part.header.type === 'image' && part.header.image && part.header.image.link;
  if (link) out.image_link = link;
  // Review r2 #8: Graph usually accepts an image given by link and reports the fetch failure later in a
  // `failed` status webhook. The fallback is stored so failIntent can still send it then.
  if (link && part.fallback && typeof part.fallback === 'object') out.fallback_part = storableFallback(part.fallback);
  return out;
}

function storableFallback(fallback) {
  const copy = JSON.parse(JSON.stringify(fallback));
  delete copy.modelLine;
  delete copy.ack;
  delete copy.fallback;
  // Validator and sender hints only: the stored part is sent as it is, never validated again.
  delete copy.serverButtons;
  delete copy.delayMs;
  return copy;
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// Intent statuses Graph's own answer may still overwrite.
const OPEN_INTENT = ['sending', 'ambiguous'];

/**
 * Record Graph's answer on the intent and return the status the row ends with (null when it could not
 * be written). Only over `sending`/`ambiguous`: Meta does not order a status webhook after the POST's
 * response, so the webhook may already have settled the row. An echoed delivered/read must not regress
 * to `sent`, and a `failed` status failIntent settled (D19, retry budget spent) must not become `sent`
 * — its rows would then be marked answered with nothing left to settle them (GPT-6 #7). A wamid the
 * row lacks is still attached.
 */
async function recordOutcome(intent, res) {
  const data = res.ok
    ? { status: 'sent', meta_message_id: res.id }
    : res.reason === 'ambiguous'
      ? { status: 'ambiguous' }
      : { status: 'failed', raw_payload: { ...intent.raw_payload, error: res.error, reason: res.reason, code: res.code } };
  const open = { id: intent.id, status: { in: OPEN_INTENT } };
  const stored = async () => {
    const row = await prisma.message.findUnique({ where: { id: intent.id } }).catch(() => null);
    return row ? row.status : null;
  };
  // One retry: a row left at `sending` is later treated as unconfirmed even when the send surely failed.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await prisma.message.update({ where: open, data });
      return data.status;
    } catch (err) {
      if (err && err.code === 'P2025') {
        // Settled by a status webhook first. Keep its status; attach the wamid if it has none.
        if (res.ok && res.id) {
          await prisma.message.updateMany({ where: { id: intent.id, meta_message_id: null }, data: { meta_message_id: res.id } })
            .catch(() => {});
        }
        return stored();
      }
      if (res.ok && err && err.code === 'P2002') {
        // The status webhook already attached this wamid elsewhere; keep the row's status truthful.
        await prisma.message.update({ where: open, data: { status: 'sent' } }).catch(() => {});
        return stored();
      }
      if (attempt === 2) console.error(`[batcher] intent row update failed intent=${intent.id}: ${err.message}`);
    }
  }
  return null;
}

/**
 * GPT-6 #7: failIntent can settle a part between recordOutcome and the commit that marks its rows
 * answered (it moved the rows while they were still `received`). When no part of this dispatch is
 * confirmed any more, the rows take the decision it recorded on the intent (raw_payload.settled).
 */
async function resettleAfterCommit(id, sentIntentIds, batchIds, inboundStatus) {
  const rows = await prisma.message.findMany({ where: { id: { in: sentIntentIds } } });
  if (!rows.length || rows.some((m) => CONFIRMED.includes(m.status))) return;
  const settled = rows.map((m) => m.raw_payload && m.raw_payload.settled).find(Boolean);
  if (settled === 'requeued') {
    await markRows(batchIds, 'received', [inboundStatus]);
    scheduleReply(id, { reason: 'sweep' });
  } else if (settled === 'escalated') {
    await markRows(batchIds, 'awaiting_staff', [inboundStatus]);
  }
  if (settled) console.warn(`[batcher] a sent part failed before its commit conversation=${id} → ${settled}`);
}

/**
 * The pre-send check refused before Graph was ever called for this intent: it is `cancelled`, including
 * when another worker's recoverCovered already flipped it to `ambiguous` (it had to assume a dead run
 * may have sent). Otherwise the rows that worker parked as `unconfirmed` would wait 2 minutes for
 * reconcile and spend the D18 retry budget on a send that never happened. Rows no other open intent
 * covers go back to `received` for a new run.
 */
async function cancelUnsent(id, intent, batchIds, since) {
  try {
    const { count } = await prisma.message.updateMany({
      where: { id: intent.id, status: { in: OPEN_INTENT } },
      data: { status: 'cancelled' },
    });
    if (!count || !batchIds.length) return;
    const covered = new Set();
    for (const m of await outboundSince(id, since)) {
      const p = m.raw_payload || {};
      if (m.id !== intent.id && OPEN_INTENT.includes(m.status) && ACK_KINDS.includes(p.kind) && Array.isArray(p.batch_ids)) {
        p.batch_ids.forEach((rowId) => covered.add(rowId));
      }
    }
    const free = batchIds.filter((rowId) => !covered.has(rowId));
    if (free.length && (await markRows(free, 'received', [UNCONFIRMED]))) scheduleReply(id, { reason: 'sweep' });
  } catch (err) {
    console.error(`[batcher] cancel intent failed intent=${intent.id}: ${err.message}`);
  }
}

/**
 * D17/D18/D20: send `parts` as intent rows. For each part: dedupe on `${batchKey}:${i}` → create the
 * intent (`sending`) → ONE conditional pre-send statement (jsonb.preSendCheck with `precheck`) → Graph
 * with the intent id as biz_opaque_callback_data → record the result. A failed pre-send check cancels
 * the intent and aborts the remaining parts. Only an error that proves Graph never got the request
 * (`retryable`) is retried at once, after the check again.
 *
 * Inbound rows in `batchIds` then move: a confirmed part → `inboundStatus`; otherwise an ambiguous
 * part → `unconfirmed` (settled by applyIntentStatus or reconcileUnconfirmedIntents).
 *
 * @param {object} args
 * @param {object} args.business       business row (wa_phone_number_id, wa_access_token)
 * @param {object} args.conversation   conversation row (id, customer_wa_id)
 * @param {string} [args.token]        decrypted WhatsApp access token (decrypted from business when absent)
 * @param {string} args.kind           raw_payload.kind (reply|fallback|handoff|button|media|optout|sla_note|…)
 * @param {Array}  args.parts          [{type:'text'|'interactive', text, buttons?}]
 * @param {string[]} [args.batchIds]   inbound rows this send answers
 * @param {string|null} [args.batchKey] dedupe base; part i uses `${batchKey}:${i}`
 * @param {object|false} [args.precheck] {leaseToken, humanGuard, optedOutSince} for jsonb.preSendCheck; false skips it
 * @param {string} [args.inboundStatus] status of batchIds rows once confirmed ('answered' | 'skipped')
 * @param {Date}   [args.since]        oldest created_at an earlier intent of this batch can have
 * @param {string} [args.sentByUserId] a staff member's message (the Inbox claim ack): written on the intent
 *                                     row itself, so no window exists where it reads as a bot message
 * @param {Date}   [args.now]
 * @returns {Promise<{outcome:'sent'|'ambiguous'|'failed'|'deduped'|'aborted', parts:Array}>}
 */
async function dispatchIntent({
  business, conversation, token = null, kind, parts = [], batchIds = [], batchKey = null,
  precheck = {}, inboundStatus = 'answered', since = null, sentByUserId = null, now = new Date(), extraPayload = null,
} = {}) {
  const id = conversation.id;
  const report = [];
  const accessToken = token || decryptToken(business);
  if (!accessToken) return { outcome: 'failed', parts: report, noToken: true };

  const existing = batchKey ? await outboundSince(id, since || new Date(toMs(now) - 24 * 60 * 60 * 1000)) : [];
  const check = () => (precheck === false ? true : jsonb.preSendCheck(id, precheck || {}));
  let aborted = false;
  const findDuplicate = (key) => key && existing.find((m) => m.raw_payload && m.raw_payload.batch_key === key && !UNDELIVERED.includes(m.status));
  const dedupe = async (i, duplicate) => {
    if (duplicate.status === 'sending' && precheck && precheck.leaseToken) {
      // Under the lease a `sending` row is a dead run's: it may have gone out, so it is unconfirmed.
      await prisma.message.updateMany({ where: { id: duplicate.id, status: 'sending' }, data: { status: 'ambiguous' } });
    }
    report.push({ index: i, status: 'deduped', reason: null, id: null, intentId: duplicate.id, confirmed: CONFIRMED.includes(duplicate.status) });
  };
  const createIntent = async (part, i, key, extra = {}) => {
    const summary = summarizePart(part);
    return prisma.message.create({
      data: {
        business_id: business.id,
        conversation_id: id,
        direction: 'outbound',
        message_type: summary.message_type,
        text_body: summary.text_body,
        status: 'sending',
        is_ai_generated: !sentByUserId,
        ...(sentByUserId && { sent_by_user_id: sentByUserId }),
        raw_payload: {
          kind,
          batch_key: key,
          part_index: i,
          batch_ids: batchIds,
          ...partPayload(part),
          inbound_status: inboundStatus,
          ...extra,
        },
      },
    });
  };
  // D20 check right before every Graph call; only a `retryable` refusal is retried at once.
  const send = async (intent, part) => {
    let res = null;
    for (let attempt = 1; attempt <= 2 && !aborted; attempt++) {
      if (!(await check())) {
        aborted = true;
        break;
      }
      res = await sendPart(business, accessToken, conversation.customer_wa_id, part, intent.id);
      if (!res || res.ok || !res.retryable || attempt === 2) break;
      console.warn(`[batcher] retrying send once reason=${res.reason}`);
    }
    return res;
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const key = batchKey ? `${batchKey}:${i}` : null;
    const duplicate = findDuplicate(key);
    if (duplicate) {
      await dedupe(i, duplicate);
      continue;
    }

    if (i > 0) {
      // §10.2 #4: a later part waits its delay, then passes the same fence as part 0 (the check renews
      // the lease) before its intent row even exists. The parts already sent cover the batch.
      const delay = Math.min(Math.max(Number(part.delayMs) || 0, 0), MAX_PART_DELAY_MS);
      if (delay) await sleep(delay);
      if (!(await check())) {
        aborted = true;
        report.push({ index: i, status: 'aborted', reason: 'precheck', id: null, intentId: null });
        console.warn(`[batcher] part skipped after fence conversation=${id} kind=${kind} part=${i}`);
        break;
      }
    }

    let intent;
    try {
      intent = await createIntent(part, i, key, extraPayload || {});
    } catch (err) {
      // No intent row, no send: an unrecorded send could never be correlated or deduplicated.
      console.error(`[batcher] intent row failed conversation=${id}: ${err.message}`);
      report.push({ index: i, status: 'failed', reason: 'db', id: null, intentId: null });
      continue;
    }

    let res = await send(intent, part);
    if (!aborted && res && !res.ok && FALLBACK_REASONS.includes(res.reason) && part.fallback && typeof part.fallback === 'object') {
      // §10.2 #2: Graph definitely refused this shape (an image header, say). The refusal is recorded on
      // its intent, and the fallback is its own intent row with its own fence check, sent once.
      await recordOutcome(intent, res);
      console.warn(`[batcher] part refused (${res.reason}) conversation=${id} — sending its fallback`);
      const fbKey = key ? `${key}:fb` : null;
      const fbDuplicate = findDuplicate(fbKey);
      if (fbDuplicate) {
        await dedupe(i, fbDuplicate);
        continue;
      }
      try {
        intent = await createIntent(part.fallback, i, fbKey, { fallback_of: intent.id });
      } catch (err) {
        console.error(`[batcher] fallback intent row failed conversation=${id}: ${err.message}`);
        report.push({ index: i, status: 'failed', reason: res.reason, id: null, intentId: intent.id });
        continue;
      }
      res = await send(intent, part.fallback);
    }
    if (aborted && !res) {
      await cancelUnsent(id, intent, batchIds, since || intent.created_at);
      report.push({ index: i, status: 'aborted', reason: 'precheck', id: null, intentId: intent.id });
      console.warn(`[batcher] pre-send check failed conversation=${id} kind=${kind} — not sending`);
      break;
    }
    res = res || { ok: false, id: null, error: 'no send result', reason: 'rejected', code: null, retryable: false };
    const stored = await recordOutcome(intent, res);
    let status = res.ok ? 'sent' : res.reason === 'ambiguous' ? 'ambiguous' : 'failed';
    let reason = res.reason || null;
    // The status webhook got there first: its answer is the truth about this part.
    if (CONFIRMED.includes(stored)) status = 'sent';
    else if (UNDELIVERED.includes(stored) && status !== 'failed') {
      status = 'failed';
      reason = 'status_failed';
    }
    report.push({ index: i, status, reason, id: res.id || null, intentId: intent.id });
    // A retry that was itself refused by the pre-send check still recorded the first attempt's result.
    if (aborted) break;
    // A delayed follow-up hangs on this part («لما ترجع…» after the page link): with the part gone for good
    // it would point at nothing, and a sent follow-up would count as the answer (review minor).
    if (status === 'failed' && parts.slice(i + 1).some((p) => p && Number(p.delayMs) > 0)) {
      console.warn(`[batcher] part ${i} failed conversation=${id} kind=${kind} — its follow-up is not sent`);
      break;
    }
  }

  const confirmed = report.some((p) => p.status === 'sent' || (p.status === 'deduped' && p.confirmed));
  const unconfirmed = report.some((p) => p.status === 'ambiguous' || (p.status === 'deduped' && !p.confirmed));
  try {
    if (batchIds.length && confirmed) {
      await markRows(batchIds, inboundStatus, ['received', 'awaiting_staff', UNCONFIRMED]);
      if (!report.some((p) => p.status === 'deduped' && p.confirmed)) {
        await resettleAfterCommit(id, report.filter((p) => p.status === 'sent').map((p) => p.intentId), batchIds, inboundStatus);
      }
    } else if (batchIds.length && unconfirmed) {
      await markRows(batchIds, UNCONFIRMED);
    }
    if (report.some((p) => p.status === 'sent' || p.status === 'ambiguous')) {
      await prisma.conversation.update({ where: { id }, data: { last_message_at: now } });
    }
  } catch (err) {
    // The send is recorded on its intent; the next run's recoverCovered settles the rows without resending.
    console.error(`[batcher] commit failed conversation=${id}: ${err.message}`);
  }

  let outcome;
  if (report.some((p) => p.status === 'sent')) outcome = 'sent';
  else if (report.some((p) => p.status === 'ambiguous')) outcome = 'ambiguous';
  else if (report.some((p) => p.status === 'aborted')) outcome = 'aborted';
  else if (report.length && report.every((p) => p.status === 'deduped')) outcome = 'deduped';
  else outcome = 'failed';
  return { outcome, parts: report };
}

// ─── An accepted image that failed later (review r2 #8) ──────────────────────

// Failures a header-less resend cannot fix: the window, billing, the recipient, rate limits, the account.
const NON_MEDIA_FAILURE_CODES = [131047, 131042, 131026, 131050, 131049, 130472, 131031, 131056, 131048, 130429, 368];

/**
 * A `failed` status for a part sent with an image (a card's image header, a sector image) whose intent stored
 * its fallback: send that fallback now, as its own intent (`${batch_key}:fb`, deduplicated) behind the same
 * pre-send fence. For messageProcessor.failIntent, before it requeues or calls the part covered.
 * Returns dispatchIntent's report, or null when no fallback applies.
 */
async function sendMediaFallback(intent, { now = new Date(), errorCode = null } = {}) {
  const payload = (intent && intent.raw_payload) || {};
  const part = payload.fallback_part;
  if (!part || typeof part !== 'object' || !payload.image_link || payload.fallback_of) return null;
  if (errorCode !== null && errorCode !== undefined && NON_MEDIA_FAILURE_CODES.includes(Number(errorCode))) return null;
  const conv = await prisma.conversation.findUnique({ where: { id: intent.conversation_id } });
  const business = conv ? await prisma.business.findUnique({ where: { id: intent.business_id } }) : null;
  if (!conv || !business) return null;
  if (!isWithinServiceWindow(conv.last_inbound_at, now, { marginMs: REPLY_WINDOW_MARGIN_MS })) return null;
  console.warn(`[batcher] image part failed after Graph accepted it intent=${intent.id} — sending its fallback`);
  return dispatchIntent({
    business,
    conversation: conv,
    kind: payload.kind,
    parts: [part],
    batchIds: Array.isArray(payload.batch_ids) ? payload.batch_ids : [],
    batchKey: payload.batch_key ? `${payload.batch_key}:fb` : null,
    precheck: {
      humanGuard: COVERING_KINDS.includes(payload.kind),
      // A sales card computed before «إيقاف» must not follow it, not even as its fallback.
      optedOutSince: payload.kind === 'optout' ? null : intent.created_at,
    },
    inboundStatus: inboundStatusOf(payload),
    since: new Date(toMs(intent.created_at) - 60 * 1000),
    extraPayload: { fallback_of: intent.id },
    now,
  });
}

// ─── Settling unconfirmed intents (D18) ──────────────────────────────────────

/**
 * An echoed status for an intent (status webhook `biz_opaque_callback_data`, or the wamid Graph
 * returned). Only sent/delivered/read confirm: the rows it covers become answered (or skipped for an
 * opt-out ack). Never moves a status backwards. For the processor's handleStatuses.
 * @returns {Promise<{matched: boolean, intent?: object}>}
 */
async function applyIntentStatus({ intentId, wamid = null, status } = {}) {
  if (!intentId || !CONFIRMED.includes(status)) return { matched: false };
  const intent = await prisma.message.findUnique({ where: { id: String(intentId) } });
  if (!intent || intent.direction !== 'outbound') return { matched: false };

  const data = {};
  if ((STATUS_RANK[status] || 0) > (STATUS_RANK[intent.status] || 0)) data.status = status;
  if (wamid && !intent.meta_message_id) data.meta_message_id = wamid;
  if (Object.keys(data).length) {
    try {
      await prisma.message.update({ where: { id: intent.id }, data });
    } catch (err) {
      if (!err || err.code !== 'P2002') throw err;
      if (data.status) await prisma.message.update({ where: { id: intent.id }, data: { status: data.status } });
    }
  }
  const payload = intent.raw_payload || {};
  if (Array.isArray(payload.batch_ids) && payload.batch_ids.length) {
    // `received`: the run died before moving them, or they were requeued and not answered yet.
    await markRows(payload.batch_ids, inboundStatusOf(payload), [UNCONFIRMED, 'received']);
  }
  return { matched: true, intent: { ...intent, ...data } };
}

async function requeuesFor(intent) {
  const key = intent.raw_payload && intent.raw_payload.batch_key;
  if (!key) return 0;
  // Any status: a requeued intent confirmed late (now `delivered`) still used this key's budget.
  const rows = await prisma.message.findMany({
    where: { conversation_id: intent.conversation_id, direction: 'outbound', is_ai_generated: true },
  });
  return rows.filter((m) => m.id !== intent.id && m.raw_payload && m.raw_payload.batch_key === key
    && m.raw_payload.settled === 'requeued').length;
}

async function escalateUnsent(intent, conv, business, now, rowIds = null) {
  const batchIds = rowIds || intent.raw_payload.batch_ids;
  await markRows(batchIds, 'awaiting_staff', [UNCONFIRMED, 'received']);
  if (conv) {
    const entry = needsTeamEntry('unsent_reply', `${UNSENT_SUMMARY}: ${(intent.text_body || '').slice(0, 120)}`, now.toISOString());
    const next = mergeNeedsTeam(conv.workflow_data && conv.workflow_data.needs_team, entry);
    if (next) await jsonb.patchJson('conversations', conv.id, 'workflow_data', { needs_team: next });
    // Never over a staff claim: the Inbox shows a claimed conversation as the claimer's.
    await prisma.conversation.updateMany({ where: { id: conv.id, status: { not: 'human_takeover' } }, data: { status: 'pending' } });
  }
  fireAlert('unsent_reply', business, conv || { id: intent.conversation_id }, UNSENT_SUMMARY, now);
}

/**
 * Treat one intent without a confirmation as not delivered. Returns what happened, or null when
 * another sweep claimed it first. Reusable for a `failed` status webhook (D19).
 *  - no inbound rows to answer (a note)     → `ambiguous_unreconciled` + ambiguous_send alert
 *  - first time for its batch key            → rows back to `received`, a run is scheduled
 *  - its batch key was already requeued once → rows `awaiting_staff`, needs_team unsent_reply, alert
 *  - same, for an opt-out ack                → `dropped`: rows `skipped`, ambiguous_send alert. The
 *    opt-out is already stored; staff must not be asked to answer «إيقاف», and the awaiting-staff note
 *    must never reach a customer who just opted out.
 * Options (failIntent, D19): `claimFrom` — statuses the claim may start from (a failed status can
 * arrive while the POST is in flight, or after recordOutcome wrote `sent`); `reclaimAnswered` — rows the
 * batcher marked answered after failIntent moved them are taken back too (GPT-6 #7).
 */
async function settleUndelivered(intent, { now = new Date(), claimFrom = null, reclaimAnswered = false } = {}) {
  const payload = intent.raw_payload || {};
  const batchIds = Array.isArray(payload.batch_ids) ? payload.batch_ids : [];
  let decision = 'unreconciled';
  if (batchIds.length) {
    const spent = (await requeuesFor(intent)) >= UNCONFIRMED_RETRIES;
    decision = !spent ? 'requeued' : payload.kind === 'optout' ? 'dropped' : 'escalated';
  }

  // The status transition is the once-only claim across sweeps and instances (never from its own target).
  const { count } = await prisma.message.updateMany({
    where: { id: intent.id, status: claimFrom ? { in: claimFrom } : intent.status },
    data: { status: 'ambiguous_unreconciled', raw_payload: { ...payload, settled: decision, settled_at: now.toISOString() } },
  });
  if (count !== 1) return null;
  if (reclaimAnswered) await markRows(batchIds, UNCONFIRMED, ['answered']);

  const conv = await prisma.conversation.findUnique({ where: { id: intent.conversation_id } });
  const business = await prisma.business.findUnique({ where: { id: intent.business_id } });
  if (decision === 'unreconciled') {
    fireAlert('ambiguous_send', business, conv || { id: intent.conversation_id }, (intent.text_body || AMBIGUOUS_SUMMARY).slice(0, 200), now);
  } else if (decision === 'dropped') {
    await markRows(batchIds, 'skipped', [UNCONFIRMED, 'received']);
    fireAlert('ambiguous_send', business, conv || { id: intent.conversation_id }, (intent.text_body || AMBIGUOUS_SUMMARY).slice(0, 200), now);
  } else if (decision === 'requeued') {
    await markRows(batchIds, 'received', [UNCONFIRMED]);
    scheduleReply(intent.conversation_id, { reason: 'sweep' });
  } else {
    await escalateUnsent(intent, conv, business, now);
  }
  console.warn(`[batcher] unconfirmed intent=${intent.id} conversation=${intent.conversation_id} → ${decision}`);
  return decision;
}

/**
 * D18 sweep step: every `sending`/`ambiguous` intent older than 2 minutes without a confirmation.
 * @returns {Promise<{requeued, escalated, unreconciled, errors: string[]}>}
 */
async function reconcileUnconfirmedIntents({ now = new Date(), businessId = null } = {}) {
  const report = { requeued: 0, escalated: 0, unreconciled: 0, errors: [] };
  const rows = await prisma.message.findMany({
    where: {
      direction: 'outbound',
      status: { in: ['sending', 'ambiguous'] },
      created_at: { lt: new Date(toMs(now) - UNCONFIRMED_AFTER_MS) },
      ...(businessId && { business_id: businessId }),
    },
    orderBy: { created_at: 'asc' },
    take: RECONCILE_LIMIT,
  });
  for (const row of rows) {
    try {
      const decision = await settleUndelivered(row, { now });
      // An opt-out ack given up on is counted with the other unreconciled sends (ambiguous_send alert).
      if (decision) report[decision === 'dropped' ? 'unreconciled' : decision] += 1;
    } catch (err) {
      report.errors.push(`${row.id}: ${err.message}`);
      console.error(`[batcher] reconcile failed intent=${row.id}: ${err.message}`);
    }
  }
  await rescueStrandedUnconfirmed({ now, businessId, report });
  return report;
}

/**
 * Inbound rows can be left `unconfirmed` with no unconfirmed intent that would ever settle them:
 *  - D19: messageProcessor moves the rows of a `failed` send to `unconfirmed`, then crashes before
 *    settleUndelivered claims that send (its intent still reads `sent`, and Meta never re-sends the status);
 *  - settleUndelivered claimed an intent (`ambiguous_unreconciled` + `settled`) and crashed before moving rows.
 * After STRANDED_AFTER_MS without a change they are finished here with the same decision rules, so a
 * customer message never waits forever as «الرد غير مؤكد». Adds to `report.requeued` / `report.escalated`.
 */
async function rescueStrandedUnconfirmed({ now, businessId, report }) {
  const stranded = await prisma.message.findMany({
    where: {
      direction: 'inbound',
      status: UNCONFIRMED,
      updated_at: { lt: new Date(toMs(now) - STRANDED_AFTER_MS) },
      ...(businessId && { business_id: businessId }),
    },
    orderBy: { created_at: 'asc' },
    take: RECONCILE_LIMIT,
  });
  const byConv = new Map();
  for (const m of stranded) {
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id).push(m);
  }

  for (const [convId, rows] of byConv) {
    try {
      const ids = new Set(rows.map((m) => m.id));
      const covering = (await outboundSince(convId, rows[0].created_at))
        .filter((m) => m.raw_payload && ACK_KINDS.includes(m.raw_payload.kind) && Array.isArray(m.raw_payload.batch_ids)
          && m.raw_payload.batch_ids.some((id) => ids.has(id)));
      // A send still without a confirmation settles these rows itself (the loop above, in a later sweep).
      if (covering.some((m) => m.status === 'sending' || m.status === 'ambiguous')) continue;

      const newest = covering[covering.length - 1];
      const confirmed = [...covering].reverse().find((m) => CONFIRMED.includes(m.status));
      if (confirmed) {
        // Only the D19 path leaves rows `unconfirmed` under a confirmed send: Meta reported it failed.
        const decision = await settleUndelivered(confirmed, { now });
        if (decision) {
          await prisma.message.updateMany({ where: { id: confirmed.id, status: 'ambiguous_unreconciled' }, data: { status: 'failed' } });
          if (report[decision] !== undefined) report[decision] += 1;
        }
        continue;
      }

      const settled = newest && newest.raw_payload.settled;
      const rowIds = [...ids];
      if (settled === 'dropped') {
        // An opt-out ack given up on: the command is recorded, nothing is left to answer or hand over.
        await prisma.message.updateMany({ where: { id: { in: rowIds }, status: UNCONFIRMED }, data: { status: 'skipped' } });
        continue;
      }
      if (settled === 'escalated') {
        // The row transition is the once-only claim across concurrent sweeps.
        const { count } = await prisma.message.updateMany({ where: { id: { in: rowIds }, status: UNCONFIRMED }, data: { status: 'awaiting_staff' } });
        if (!count) continue;
        const conv = await prisma.conversation.findUnique({ where: { id: convId } });
        const business = await prisma.business.findUnique({ where: { id: rows[0].business_id } });
        await escalateUnsent(newest, conv, business, now, rowIds);
        report.escalated += 1;
      } else {
        // `requeued`, or nothing on record: the customer has no confirmed answer and none is on its way.
        const { count } = await prisma.message.updateMany({ where: { id: { in: rowIds }, status: UNCONFIRMED }, data: { status: 'received' } });
        if (!count) continue;
        scheduleReply(convId, { reason: 'sweep' });
        report.requeued += 1;
      }
      console.warn(`[batcher] stranded unconfirmed rows conversation=${convId} → ${settled === 'escalated' ? 'escalated' : 'requeued'}`);
    } catch (err) {
      report.errors.push(`stranded ${convId}: ${err.message}`);
      console.error(`[batcher] stranded rescue failed conversation=${convId}: ${err.message}`);
    }
  }
}

// ─── deliverResult ───────────────────────────────────────────────────────────

function pickState(stateUpdate) {
  const out = {};
  for (const key of ['status', 'current_state']) {
    if (stateUpdate && stateUpdate[key] !== undefined) out[key] = stateUpdate[key];
  }
  return out;
}

// §10.2 #5: a part is sendable when its type is known and its Inbox summary is not empty; at most 3.
function validParts(messages) {
  const list = (Array.isArray(messages) ? messages : [])
    // PR1 callers always typed their parts; an untyped part with text is still PR1's text part.
    .map((p) => (p && !p.type && typeof p.text === 'string' ? { ...p, type: 'text' } : p));
  return list.filter((p) => {
    if (!p || !PART_TYPES.includes(p.type)) return false;
    if (isPr1Shape(p)) return typeof p.text === 'string' && !!p.text.trim();
    const summary = whatsapp.partSummary(p, partLang(p));
    return !!(summary && typeof summary.text_body === 'string' && summary.text_body.trim());
  }).slice(0, MAX_PARTS);
}

async function countFailure(business, conv, now, { billing = false } = {}) {
  let n = null;
  try {
    n = await jsonb.incrementCounter('conversations', conv.id, 'metadata', 'reply_failures');
  } catch (err) {
    console.error(`[batcher] reply_failures increment failed conversation=${conv.id}: ${err.message}`);
  }
  if (billing) {
    try {
      await jsonb.patchJson('conversations', conv.id, 'metadata', { billing_blocked_at: now.toISOString() });
    } catch (err) {
      console.error(`[batcher] billing_blocked_at write failed conversation=${conv.id}: ${err.message}`);
    }
    // Every time: nothing reaches any customer until someone fixes the payment method.
    fireAlert('billing', business, conv, 'واتساب رفض الإرسال — لازم تنضاف طريقة دفع', now);
  }
  if (n === MAX_REPLY_FAILURES) {
    fireAlert('reply_failures', business, conv, 'رد البوت فشل 3 مرات ووقفت المحاولات التلقائية — العميل بدون رد', now);
  }
  return n;
}

/**
 * A new time for the meeting already on the team's list: merge the summary into needs_team as stored
 * now. When the entry changed while the model was generating (staff resolved it), it is decided again
 * on the fresh entry — a resolved request plus a new time is a new request.
 */
async function applyNeedsTeamMerge(id, { match, patch, entry }) {
  if (await jsonb.mergeObjectKey('conversations', id, 'workflow_data', 'needs_team', patch, { match })) return;
  const fresh = await prisma.conversation.findUnique({ where: { id } });
  const next = mergeNeedsTeam(fresh && fresh.workflow_data && fresh.workflow_data.needs_team, entry);
  if (next) await mustPatch(id, 'workflow_data', { needs_team: next });
}

// D20: a conditional write that matched no row means the state the ack describes was not stored.
async function mustPatch(id, column, patch) {
  const r = await jsonb.patchJson('conversations', id, column, patch);
  if (r && r.ok === false) throw new Error(`${column} write matched no row`);
}

/**
 * Why a pre-send check refused, so the rows end in the right place: a lost lease leaves them to the
 * new owner; staff holding the conversation → `awaiting_staff`; an opt-out → `skipped`.
 */
async function explainAbort(id, { leaseToken, batchIds, now }) {
  const c = await prisma.conversation.findUnique({ where: { id } });
  if (!c) return 'aborted';
  const meta = c.metadata || {};
  if (leaseToken && (meta.lease_token !== leaseToken || !(toMs(meta.reply_lease_until) > toMs(now)))) return 'lease_lost';
  if (c.status === 'human_takeover' || c.ai_enabled === false
    || (meta.human_active_until && toMs(meta.human_active_until) > toMs(now))) {
    await markRows(batchIds, 'awaiting_staff');
    return 'awaiting_staff';
  }
  if (c.workflow_data && c.workflow_data.marketing_opted_out_at) {
    await markRows(batchIds, 'skipped');
    return 'skipped';
  }
  return 'aborted';
}

/**
 * PR3 design §3: the booking confirmation asked for the name / business; once saveLead stored them, the
 * calendar event is patched with the lead card. Never in the reply path: best effort, logged.
 */
function syncBookingDetails(business, conv, storedLead, now) {
  const b = conv && conv.workflow_data && conv.workflow_data.booking;
  if (!b || !b.details_pending) return;
  track(Promise.resolve()
    .then(() => booking.syncEventDetails({
      business,
      conversation: conv,
      lead: storedLead,
      now,
      patchBooking: (patch, match) => jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'booking', patch, { match }),
    }))
    .then((r) => { if (r && r.ok) console.log(`[batcher] booking event details updated conversation=${conv.id}`); })
    .catch((err) => console.error(`[batcher] booking details sync failed conversation=${conv.id}: ${err && err.message}`)));
}

/**
 * Persist the result's state, then send its parts through dispatchIntent.
 * Also used by runBatch for button taps and opt-outs, by messageProcessor (opt-out) and by the sweeper
 * (notes, batch = []).
 * `humanGuard` (default: the result answers customer rows) makes the pre-send check refuse while staff
 * hold the conversation; notes to a waiting customer and the opt-out ack are sent regardless.
 */
function deliverResult(args) {
  return track(deliver(args));
}

async function deliver({
  business, conversation, result, batch = [], leaseToken = null, windowMarginMs = REPLY_WINDOW_MARGIN_MS,
  inboundStatus = 'answered', now = new Date(), humanGuard, optedOutSince,
} = {}) {
  const conv = conversation;
  const id = conv.id;
  const batchIds = batch.map((m) => m.id);
  const rpPatch = result && result.workflowDataPatch && result.workflowDataPatch.roleplay;
  if (rpPatch && typeof rpPatch === 'object' && 'start_undelivered' in rpPatch) {
    // deliveredView's in-memory marker is never stored.
    const { start_undelivered: _marker, ...stored } = rpPatch;
    result = { ...result, workflowDataPatch: { ...result.workflowDataPatch, roleplay: stored } };
  }
  const guardHumans = humanGuard === undefined ? COVERING_KINDS.includes(result && result.kind) : !!humanGuard;

  if (leaseToken && !(await jsonb.renewLease(id, leaseToken, LEASE_TTL_MS))) {
    console.warn(`[batcher] lease lost before send conversation=${id} — another run owns it`);
    return { outcome: 'lease_lost', parts: [] };
  }

  if (!isWithinServiceWindow(conv.last_inbound_at, now, { marginMs: windowMarginMs })) {
    if (result && result.kind === 'optout') {
      // D23: «إيقاف» is recorded even when its ack can no longer be sent, and the command row leaves
      // `received` only once it is (a failed write keeps it for the retry, never for the AI).
      try {
        const stateData = pickState(result.stateUpdate);
        if (Object.keys(stateData).length) await prisma.conversation.update({ where: { id }, data: stateData });
        if (result.workflowDataPatch && Object.keys(result.workflowDataPatch).length) {
          await mustPatch(id, 'workflow_data', result.workflowDataPatch);
        }
      } catch (err) {
        console.error(`[batcher] opt-out state write failed conversation=${id}: ${err.message}`);
        return { outcome: 'state_failed', parts: [] };
      }
    }
    await markRows(batchIds, 'skipped');
    console.warn(`[batcher] window closed conversation=${id} — not sending`);
    return { outcome: 'window_closed', parts: [] };
  }

  let messages = validParts(result && result.messages);
  if (!messages.length) {
    console.error(`[batcher] nothing to send conversation=${id} kind=${result && result.kind}`);
    return { outcome: 'failed', parts: [], noRetry: true };
  }

  const accessToken = decryptToken(business);
  if (!accessToken) return { outcome: 'failed', parts: [], noRetry: true };

  // State before send.
  let leadSave = null;
  try {
    const stateData = pickState(result.stateUpdate);
    if (stateData.status) {
      // D27 / GPT-6 #13: status, current_state, workflow_data and the team request in ONE statement,
      // with needs_team merged against what is stored now. Never over a staff claim made after this
      // result was computed: the Inbox would show the claimed conversation as pending and let a second
      // person claim it. No row = claimed: do not send.
      const patch = { ...(result.workflowDataPatch || {}) };
      const candidate = result.needsTeamCandidate || result.needsTeam || patch.needs_team || null;
      if (candidate) delete patch.needs_team;
      const written = await jsonb.writeConversationState(id, {
        status: stateData.status,
        currentState: stateData.current_state,
        patch,
        needsTeam: candidate,
        priorities: NEEDS_TEAM_PRIORITY,
        defaultPriority: NEEDS_TEAM_PRIORITY.unknown,
      });
      if (!written.ok) {
        const outcome = await explainAbort(id, { leaseToken, batchIds, now });
        console.warn(`[batcher] state write refused conversation=${id} (${outcome}) — not sending`);
        return { outcome: outcome === 'aborted' ? 'state_failed' : outcome, parts: [] };
      }
    } else {
      if (Object.keys(stateData).length) await prisma.conversation.update({ where: { id }, data: stateData });
      if (result.workflowDataPatch && Object.keys(result.workflowDataPatch).length) {
        await mustPatch(id, 'workflow_data', result.workflowDataPatch);
      }
    }
    if (result.needsTeamMerge) await applyNeedsTeamMerge(id, result.needsTeamMerge);
    if (result.leadPatch) {
      const meta = result.leadMeta || { source: 'model', msgId: null, at: now.toISOString(), inboundText: '' };
      leadSave = await lead.saveLead(id, result.leadPatch, meta);
      if (!leadSave || !leadSave.ok) console.warn(`[batcher] lead not saved conversation=${id}`);
      // Not for a booking result itself: its conversation copy predates the booking it writes.
      else if (!(result.workflowDataPatch && result.workflowDataPatch.booking)) syncBookingDetails(business, conv, leadSave.lead, now);
    }
    if (result.capture) {
      // D26 / GPT-6 #12: the ack names what saveLead stored, not the pre-write preview; a save that
      // failed stores nothing the ack could name.
      if (!leadSave || !leadSave.ok || !leadSave.lead) throw new Error('lead save failed — capture ack withheld');
      const rendered = renderCaptureAck(result.capture, leadSave.lead);
      messages = validParts(rendered.messages);
      await mustPatch(id, 'workflow_data', rendered.relayed ? rendered.workflowDataPatch : { requested_time_change: null });
    }
  } catch (err) {
    console.error(`[batcher] state write failed conversation=${id} — not sending: ${err.message}`);
    await countFailure(business, conv, now);
    return { outcome: 'state_failed', parts: [] };
  }

  const dispatch = await dispatchIntent({
    business,
    conversation: conv,
    token: accessToken,
    kind: result.kind,
    parts: messages,
    batchIds,
    batchKey: batch.length ? batch[batch.length - 1].id : null,
    precheck: {
      leaseToken,
      humanGuard: guardHumans,
      // A sales reply computed before «إيقاف» must not follow it. A batch-less send (a nudge) passes its own.
      optedOutSince: optedOutSince !== undefined ? optedOutSince
        : result.kind !== 'optout' && batch.length ? batch[0].created_at : null,
    },
    inboundStatus,
    since: batch.length ? batch[0].created_at : null,
    now,
  });
  const parts = dispatch.parts.map(({ index, status, reason, id: wamid }) => ({ index, status, reason, id: wamid }));

  if (dispatch.outcome === 'aborted') {
    const outcome = await explainAbort(id, { leaseToken, batchIds, now });
    return { outcome: outcome === 'aborted' ? 'failed' : outcome, parts };
  }

  const delivered = parts.filter((p) => p.status === 'sent' || p.status === 'ambiguous');
  const covered = delivered.length > 0 || parts.some((p) => p.status === 'deduped');

  if (!covered) {
    await countFailure(business, conv, now, { billing: parts.some((p) => p.reason === 'billing') });
    // The team request is saved even though the ack did not go out, and the retry will see it as
    // already open (no second alert): tell staff now, or they only hear of it from the SLA sweep.
    if (result.alert && result.alert.reason && (result.needsTeam || result.kind === 'handoff')) {
      fireAlert(result.alert.reason, business, conv, result.alert.summary, now);
    }
    return { outcome: 'failed', parts };
  }

  try {
    await jsonb.patchJson('conversations', id, 'metadata', { reply_failures: 0 });
  } catch (err) {
    console.error(`[batcher] reply_failures reset failed conversation=${id}: ${err.message}`);
  }

  // A fully deduplicated delivery already alerted in the run that sent it. An ambiguous send alerts
  // nobody yet: reconcileUnconfirmedIntents escalates it if it stays unconfirmed (D18).
  if (delivered.length) {
    if (result.alert && result.alert.reason) {
      fireAlert(result.alert.reason, business, conv, result.alert.summary, now);
    }
    if (leadSave && leadSave.ok && (leadSave.lead?.score || 0) >= HOT_LEAD_SCORE && (leadSave.previousScore || 0) < HOT_LEAD_SCORE) {
      fireAlert('hot_lead', business, conv, `score ${leadSave.lead.score}`, now);
    }
    sseEmitter.emit(`business:${business.id}`, { type: 'new_message', conversationId: id, businessId: business.id });
  }

  return { outcome: dispatch.outcome, parts };
}

module.exports = {
  LEASE_TTL_MS,
  AI_DEADLINE_MS,
  HUMAN_ACTIVE_MS,
  MAX_BATCH,
  MAX_REPLY_FAILURES,
  UNCONFIRMED_AFTER_MS,
  quietWindowMs,
  isShiftReplyAllowed,
  isHumanActive,
  tapButtonId,
  scheduleReply,
  touchBatchDue,
  hasPendingTimer,
  collectBatch,
  runBatch,
  deliverResult,
  deliveredView,
  dispatchIntent,
  sendMediaFallback,
  applyIntentStatus,
  settleUndelivered,
  reconcileUnconfirmedIntents,
  cancel,
  cancelAll,
  shutdown,
};
