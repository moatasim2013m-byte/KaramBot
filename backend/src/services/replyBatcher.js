/**
 * Reply batcher for the SHIFT number (pr1-contracts §7.1).
 *
 * Customers write in bursts («مرحبا» / «عندي كافيه» / «متى نحكي؟»). Answering each fragment on its own
 * cost one AI call per line and produced replies that ignored the next line. Instead every inbound row
 * is saved as `received`, a per-conversation quiet-window timer collects the burst, and one run answers
 * all `received` rows together.
 *
 * Reliability rules this file owns:
 * - One run per conversation across instances: a jsonb lease with DB now() (safe behind PgBouncer).
 * - Never double-send: an intent row (`sending`) is written before the Graph call and carries
 *   `batch_key` / `batch_ids`, so a run that sent but crashed before committing is recovered, not resent.
 * - Never silent: rows stay `received` until an outbound covering them went out (or was ambiguous);
 *   failures are counted and the sweeper retries orphans.
 * - State before send: acks may only state what is already persisted («سجّلت طلبك…»).
 */

const crypto = require('crypto');
const prisma = require('../config/prisma');
const jsonb = require('../db/jsonb');
const whatsapp = require('./whatsapp');
const alerts = require('./alerts');
const shift = require('../workflows/shift');
const lead = require('../workflows/shift/lead');
const { isWithinServiceWindow, REPLY_WINDOW_MARGIN_MS } = require('../utils/serviceWindow');
const { decrypt } = require('../utils/tokenCrypto');
const sseEmitter = require('../utils/sseEmitter');

const LEASE_TTL_MS = 60000;
const AI_DEADLINE_MS = 18000;
const HUMAN_ACTIVE_MS = 30 * 60 * 1000;
const MAX_BATCH = 20;
const MAX_REPLY_FAILURES = 3;
const HOT_LEAD_SCORE = 6;

// Outbound kinds that answer the inbound rows listed in their batch_ids (notes and opt-out acks do not).
const COVERING_KINDS = ['reply', 'fallback', 'handoff', 'button', 'media'];
// Outcomes after which an immediate re-run would only repeat the same decision.
const NO_RESCHEDULE = new Set(['lease_busy', 'awaiting_staff', 'skipped', 'window_closed']);

const timers = new Map(); // conversationId → { timer, firstAt }

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
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
  const tail = s.replace(/[\s\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f]+$/u, '');
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
  const until = conversation.metadata && conversation.metadata.human_active_until;
  if (until && toMs(until) > nowMs) return true;
  if (lastStaffOutbound && lastStaffOutbound.created_at
    && nowMs - toMs(lastStaffOutbound.created_at) < HUMAN_ACTIVE_MS) return true;
  return false;
}

// ─── Timers (in-memory, per instance; the sweeper covers a lost instance) ────

function scheduleReply(conversationId, { text = '', reason = 'inbound' } = {}) {
  if (!conversationId) return;
  const existing = timers.get(conversationId);
  const nowMs = Date.now();
  let delay;
  let firstAt;

  if (reason === 'inbound') {
    firstAt = existing ? existing.firstAt : nowMs;
    const cap = parseInt(process.env.SHIFT_BATCH_CAP_MS, 10) || 10000;
    delay = Math.min(quietWindowMs(text), Math.max(0, firstAt + cap - nowMs));
  } else {
    // A pending inbound timer fires within the cap and collects the same rows; replacing it with
    // an immediate run would cut the customer's burst in half.
    if (existing) return;
    firstAt = nowMs;
    delay = 0;
  }

  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    timers.delete(conversationId);
    runBatch(conversationId).catch((err) => {
      console.error(`[batcher] run failed conversation=${conversationId}:`, err && err.message);
    });
  }, delay);
  if (timer && typeof timer.unref === 'function') timer.unref();
  timers.set(conversationId, { timer, firstAt });
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

async function markRows(ids, status) {
  if (!ids.length) return;
  await prisma.message.updateMany({
    where: { id: { in: ids }, status: 'received' },
    data: { status },
  });
}

async function lastStaffOutbound(conversationId) {
  return prisma.message.findFirst({
    where: { conversation_id: conversationId, direction: 'outbound', sent_by_user_id: { not: null } },
    orderBy: { created_at: 'desc' },
  });
}

// Outbound rows written since the batch started. `gte`, not `gt`: an outbound stamped in the same
// millisecond as the first inbound must still count.
async function outboundSince(conversationId, batch) {
  if (!batch.length) return [];
  return prisma.message.findMany({
    where: { conversation_id: conversationId, direction: 'outbound', created_at: { gte: batch[0].created_at } },
    orderBy: { created_at: 'asc' },
  });
}

/** Step 4: a previous run sent a reply for some of these rows but died before marking them answered. */
async function recoverCovered(conversationId, batch) {
  const recent = await outboundSince(conversationId, batch);
  const covered = new Set();
  for (const row of recent) {
    const payload = row.raw_payload || {};
    if (!COVERING_KINDS.includes(payload.kind) || row.status === 'failed') continue;
    if (Array.isArray(payload.batch_ids)) payload.batch_ids.forEach((id) => covered.add(id));
  }
  const done = batch.filter((m) => covered.has(m.id)).map((m) => m.id);
  if (done.length) {
    await prisma.message.updateMany({
      where: { id: { in: done }, status: 'received' },
      data: { status: 'answered' },
    });
    console.log(`[batcher] recovered ${done.length} row(s) already answered conversation=${conversationId}`);
  }
  return batch.filter((m) => !covered.has(m.id));
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

async function runBatch(conversationId, { now = () => new Date() } = {}) {
  const clock = typeof now === 'function' ? now : () => new Date(now);
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
    await rescheduleIfPending(conversationId, report.outcome);
  }
  return { outcome: report.outcome, sent: report.sent };
}

// Rows that arrived after the freshness check (or beyond MAX_BATCH) get their own run.
async function rescheduleIfPending(conversationId, outcome) {
  try {
    const rest = await collectBatch(conversationId);
    if (!rest.length) return;
    if (outcome === 'failed') {
      const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
      if (((conv && conv.metadata && conv.metadata.reply_failures) || 0) >= MAX_REPLY_FAILURES) return;
    }
    scheduleReply(conversationId, { reason: 'reschedule' });
  } catch (err) {
    console.error(`[batcher] reschedule check failed conversation=${conversationId}: ${err.message}`);
  }
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
  for (;;) {
    await jsonb.renewLease(id, token, LEASE_TTL_MS);
    const newest = batch[batch.length - 1];
    const onRetry = async () => {
      await jsonb.renewLease(id, token, LEASE_TTL_MS);
      // Re-post the typing indicator: attempt 2 can take another 8 s.
      Promise.resolve()
        .then(() => whatsapp.markAsRead(business.wa_phone_number_id, accessToken, newest.meta_message_id, { typing: true }))
        .catch(() => {});
    };
    const startedAt = clock();
    result = await shift.processShiftBatch(business, conv, batch, {
      now: startedAt,
      deadlineAt: startedAt.getTime() + AI_DEADLINE_MS,
      onRetry,
    });

    // Freshness: a reply that ignores a line the customer sent meanwhile reads as not listening.
    // Regenerate once with the larger batch; a later line gets its own run (reschedule).
    const fresh = await collectBatch(id);
    const known = new Set(batch.map((m) => m.id));
    if (regenerations === 0 && result && result.kind !== 'fallback' && fresh.some((m) => !known.has(m.id))) {
      batch = fresh;
      regenerations = 1;
      conv = (await prisma.conversation.findUnique({ where: { id } })) || conv;
      continue;
    }
    break;
  }

  if (!result || !Array.isArray(result.messages) || !result.messages.length) {
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

  const report = await deliverResult({ business, conversation: conv2, result, batch, leaseToken: token, now: clock() });
  const sent = report.parts.filter((p) => p.status === 'sent' || p.status === 'ambiguous').length;
  let outcome = report.outcome;
  if (outcome === 'state_failed') outcome = 'failed';
  if (outcome === 'deduped') outcome = 'recovered';
  if (outcome === 'sent' && result.kind === 'fallback') outcome = 'fallback';
  return { outcome, sent, noRetry: report.noRetry };
}

// ─── deliverResult ───────────────────────────────────────────────────────────

function pickState(stateUpdate) {
  const out = {};
  for (const key of ['status', 'current_state']) {
    if (stateUpdate && stateUpdate[key] !== undefined) out[key] = stateUpdate[key];
  }
  return out;
}

function validParts(result) {
  const list = result && Array.isArray(result.messages) ? result.messages : [];
  return list.filter((p) => p && typeof p.text === 'string' && p.text.trim());
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

async function sendPart(business, accessToken, to, part) {
  const interactive = part.type === 'interactive' && Array.isArray(part.buttons) && part.buttons.length > 0;
  const send = () => (interactive
    ? whatsapp.sendInteractiveButtons(business.wa_phone_number_id, accessToken, to, part.text, part.buttons)
    : whatsapp.sendText(business.wa_phone_number_id, accessToken, to, part.text));
  let res = await send();
  if (res && !res.ok && res.retryable) {
    console.warn(`[batcher] retrying send once reason=${res.reason}`);
    res = await send();
  }
  return res || { ok: false, id: null, error: 'no send result', reason: 'rejected', code: null, retryable: false };
}

/**
 * Persist the result's state, send its parts, then commit the inbound rows.
 * Also used by messageProcessor (buttons, opt-out) and the sweeper (notes, batch = []).
 */
async function deliverResult({
  business, conversation, result, batch = [], leaseToken = null, windowMarginMs = REPLY_WINDOW_MARGIN_MS,
  inboundStatus = 'answered', now = new Date(),
} = {}) {
  const conv = conversation;
  const id = conv.id;
  const parts = [];
  const batchIds = batch.map((m) => m.id);

  if (leaseToken && !(await jsonb.renewLease(id, leaseToken, LEASE_TTL_MS))) {
    console.warn(`[batcher] lease lost before send conversation=${id} — another run owns it`);
    return { outcome: 'lease_lost', parts };
  }

  if (!isWithinServiceWindow(conv.last_inbound_at, now, { marginMs: windowMarginMs })) {
    await markRows(batchIds, 'skipped');
    console.warn(`[batcher] window closed conversation=${id} — not sending`);
    return { outcome: 'window_closed', parts };
  }

  const messages = validParts(result);
  if (!messages.length) {
    console.error(`[batcher] nothing to send conversation=${id} kind=${result && result.kind}`);
    return { outcome: 'failed', parts, noRetry: true };
  }

  const accessToken = decryptToken(business);
  if (!accessToken) return { outcome: 'failed', parts, noRetry: true };

  // State before send.
  let leadSave = null;
  try {
    const stateData = pickState(result.stateUpdate);
    if (Object.keys(stateData).length) {
      await prisma.conversation.update({ where: { id }, data: stateData });
    }
    if (result.workflowDataPatch && Object.keys(result.workflowDataPatch).length) {
      await jsonb.patchJson('conversations', id, 'workflow_data', result.workflowDataPatch);
    }
    if (result.leadPatch) {
      const meta = result.leadMeta || { source: 'model', msgId: null, at: now.toISOString(), inboundText: '' };
      leadSave = await lead.saveLead(id, result.leadPatch, meta);
      if (!leadSave || !leadSave.ok) console.warn(`[batcher] lead not saved conversation=${id}`);
    }
  } catch (err) {
    console.error(`[batcher] state write failed conversation=${id} — not sending: ${err.message}`);
    await countFailure(business, conv, now);
    return { outcome: 'state_failed', parts };
  }

  const existing = await outboundSince(id, batch);
  const newestId = batch.length ? batch[batch.length - 1].id : null;

  for (let i = 0; i < messages.length; i++) {
    const part = messages[i];
    const batchKey = newestId ? `${newestId}:${i}` : null;
    // A failed row did not reach the customer, so it must not block the retry of the same batch.
    if (batchKey && existing.some((m) => m.raw_payload && m.raw_payload.batch_key === batchKey && m.status !== 'failed')) {
      parts.push({ index: i, status: 'deduped', reason: null, id: null });
      continue;
    }

    const interactive = part.type === 'interactive' && Array.isArray(part.buttons) && part.buttons.length > 0;
    let intent;
    try {
      intent = await prisma.message.create({
        data: {
          business_id: business.id,
          conversation_id: id,
          direction: 'outbound',
          message_type: interactive ? 'interactive' : 'text',
          text_body: interactive ? `${part.text}\n${part.buttons.map((b) => `[${b.title}]`).join(' ')}` : part.text,
          status: 'sending',
          is_ai_generated: true,
          raw_payload: {
            kind: result.kind,
            batch_key: batchKey,
            part_index: i,
            batch_ids: batchIds,
            buttons: interactive ? part.buttons : null,
          },
        },
      });
    } catch (err) {
      // No intent row, no send: an unrecorded send could never be deduplicated.
      console.error(`[batcher] intent row failed conversation=${id}: ${err.message}`);
      parts.push({ index: i, status: 'failed', reason: 'db', id: null });
      continue;
    }

    const res = await sendPart(business, accessToken, conv.customer_wa_id, part);
    const status = res.ok ? 'sent' : res.reason === 'ambiguous' ? 'ambiguous' : 'failed';
    const data = res.ok
      ? { status: 'sent', meta_message_id: res.id }
      : status === 'ambiguous'
        ? { status: 'ambiguous' }
        : { status: 'failed', raw_payload: { ...intent.raw_payload, error: res.error, reason: res.reason, code: res.code } };
    try {
      await prisma.message.update({ where: { id: intent.id }, data });
    } catch (err) {
      if (res.ok && err && err.code === 'P2002') {
        // The status webhook already attached this wamid elsewhere; keep the row's status truthful.
        await prisma.message.update({ where: { id: intent.id }, data: { status: 'sent' } }).catch(() => {});
      } else {
        console.error(`[batcher] intent row update failed conversation=${id}: ${err.message}`);
      }
    }
    parts.push({ index: i, status, reason: res.reason || null, id: res.id || null });
  }

  const delivered = parts.filter((p) => p.status === 'sent' || p.status === 'ambiguous');
  const covered = delivered.length > 0 || parts.some((p) => p.status === 'deduped');

  if (!covered) {
    await countFailure(business, conv, now, { billing: parts.some((p) => p.reason === 'billing') });
    return { outcome: 'failed', parts };
  }

  try {
    if (batchIds.length) {
      await prisma.message.updateMany({
        where: { id: { in: batchIds }, status: { in: ['received', 'awaiting_staff'] } },
        data: { status: inboundStatus },
      });
    }
    await prisma.conversation.update({ where: { id }, data: { last_message_at: now } });
    await jsonb.patchJson('conversations', id, 'metadata', { reply_failures: 0 });
  } catch (err) {
    // The reply is out; the next run's recovery pass marks the rows from batch_ids without resending.
    console.error(`[batcher] commit failed conversation=${id}: ${err.message}`);
  }

  // A fully deduplicated delivery already alerted in the run that sent it.
  if (delivered.length) {
    if (delivered.some((p) => p.status === 'ambiguous')) {
      fireAlert('ambiguous_send', business, conv, 'انقطع الإرسال وما بنعرف إذا وصل — راجع المحادثة', now);
    }
    if (result.alert && result.alert.reason) {
      fireAlert(result.alert.reason, business, conv, result.alert.summary, now);
    }
    if (leadSave && leadSave.ok && (leadSave.lead?.score || 0) >= HOT_LEAD_SCORE && (leadSave.previousScore || 0) < HOT_LEAD_SCORE) {
      fireAlert('hot_lead', business, conv, `score ${leadSave.lead.score}`, now);
    }
    sseEmitter.emit(`business:${business.id}`, { type: 'new_message', conversationId: id, businessId: business.id });
  }

  const outcome = parts.some((p) => p.status === 'sent')
    ? 'sent'
    : parts.some((p) => p.status === 'ambiguous') ? 'ambiguous' : 'deduped';
  return { outcome, parts };
}

module.exports = {
  LEASE_TTL_MS,
  AI_DEADLINE_MS,
  HUMAN_ACTIVE_MS,
  MAX_BATCH,
  MAX_REPLY_FAILURES,
  quietWindowMs,
  isShiftReplyAllowed,
  isHumanActive,
  scheduleReply,
  hasPendingTimer,
  collectBatch,
  runBatch,
  deliverResult,
  cancel,
  cancelAll,
};
