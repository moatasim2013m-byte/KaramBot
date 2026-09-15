/**
 * Message Processor
 * Handles inbound WhatsApp messages: saves to DB, runs workflow, sends reply.
 *
 * Two phases (decision D12): persistInbound runs before the webhook answers 200, so a message Meta
 * delivered is never lost when the instance dies; processInboundMessage runs after the response and
 * does the slow work (AI, sends). SHIFT replies go through the reply batcher instead of answering
 * each message on its own.
 *
 * Durability after the 200 (D24): the row and its conversation counters commit together, and a
 * non-SHIFT row stays `processing` until its forward/workflow ran, so reprocessStuckInbound can re-run
 * one whose instance died. SHIFT rows are `received`, and the batcher's sweeper owns those.
 */

const axios = require('axios');
const prisma = require('../config/prisma');
const { sendTextMessage, markAsRead, normalizePhone } = require('../services/whatsapp');
const { decrypt } = require('../utils/tokenCrypto');
const { isWithinServiceWindow } = require('../utils/serviceWindow');
const { processRestaurantMessage } = require('../workflows/restaurant');
const { processClinicMessage } = require('../workflows/clinic');
const replyBatcher = require('./replyBatcher');
const alerts = require('./alerts');
const jsonb = require('../db/jsonb');
const { isOptOutCommand } = require('../workflows/shift/optout');
const { saveLead } = require('../workflows/shift/lead');
const sseEmitter = require('../utils/sseEmitter');

const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker'];
// Nothing to answer: WhatsApp system notices and reactions. `unsupported` (view-once media, polls) is
// customer content, so it joins the batch and gets the media reply instead of silence.
const SHIFT_SKIP_TYPES = ['reaction', 'system', 'ephemeral'];
const REFERRAL_KEYS = ['source_url', 'source_id', 'source_type', 'headline', 'body', 'ctwa_clid'];
const BILLING_ERROR_CODE = 131042;

// D24: a non-SHIFT row whose forward/workflow has not finished. `reprocessing` = the one re-run is underway.
const PROCESSING = 'processing';
const REPROCESSING = 'reprocessing';
const STUCK_AFTER_MS = 2 * 60 * 1000;
const REPROCESS_LIMIT = 50;
// Short on purpose: it runs inside the webhook's 4 s budget and holds a pooled connection (PgBouncer).
const PERSIST_TX_OPTIONS = { maxWait: 2000, timeout: 4000 };

// Mirrors replyBatcher's COVERING_KINDS: the sends that answer the inbound rows in their batch_ids.
const COVERING_KINDS = ['reply', 'fallback', 'handoff', 'button', 'media'];
const CONFIRMED_STATUSES = ['sent', 'delivered', 'read'];
// Intents already known not to have reached the customer (or settled by a sweep).
const SETTLED_STATUSES = ['failed', 'ambiguous_unreconciled', 'cancelled'];

const BUSINESS_SELECT = {
  id: true, name: true, business_type: true, status: true,
  currency: true, wa_phone_number_id: true, wa_access_token: true,
  ai_config: true, policies: true,
};

function canSendAutoReply(business, conversation, label) {
  if (isWithinServiceWindow(conversation.last_inbound_at)) return true;
  console.warn(
    `[serviceWindow] Skipping ${label} outside 24h window — business=${business.id} conversation=${conversation.id}`,
  );
  return false;
}

async function getOrCreateConversation(businessId, customerWaId, profileName) {
  let conv = await prisma.conversation.findFirst({
    where: { business_id: businessId, customer_wa_id: customerWaId },
  });
  if (!conv) {
    try {
      conv = await prisma.conversation.create({
        data: {
          business_id: businessId,
          customer_wa_id: customerWaId,
          profile_name: profileName || null,
          status: 'open',
          ai_enabled: true,
        },
      });
    } catch (err) {
      // Two deliveries for a new customer can race on the (business_id, customer_wa_id) unique key.
      if (!err || err.code !== 'P2002') throw err;
      conv = await prisma.conversation.findFirst({
        where: { business_id: businessId, customer_wa_id: customerWaId },
      });
      if (!conv) throw err;
    }
  } else if (profileName && !conv.profile_name) {
    conv = await prisma.conversation.update({
      where: { id: conv.id },
      data: { profile_name: profileName },
    });
  }
  return conv;
}

/**
 * Postgres rejects U+0000 in text columns (22021) and in jsonb (22P05, "\u0000 cannot be converted to text").
 * One such character in a customer's message made its insert fail on every Meta retry, so the message was never
 * stored or answered (the in-memory test DB accepted it). Found by tests/integration/pg.test.js. The stored copy
 * drops the character; the forward of an external-mode payload still sends Meta's original `value`.
 */
const NUL_RE = new RegExp(String.fromCharCode(0), 'g');
function withoutNul(value) {
  if (typeof value === 'string') return value.includes(String.fromCharCode(0)) ? value.replace(NUL_RE, '') : value;
  if (Array.isArray(value)) return value.map(withoutNul);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[withoutNul(k)] = withoutNul(v);
    return out;
  }
  return value;
}

// A caption is what the customer typed with the photo/file («هاد نظامنا الحالي…»).
function mediaCaption(waMsg) {
  return waMsg.image?.caption || waMsg.video?.caption || waMsg.document?.caption || null;
}

function inboundData(businessId, conversationId, waMsg, senderWaId, status, { captions = false } = {}) {
  return {
    business_id: businessId,
    conversation_id: conversationId,
    meta_message_id: waMsg.id || null,
    direction: 'inbound',
    message_type: waMsg.type || 'text',
    text_body: waMsg.text?.body || waMsg.interactive?.button_reply?.title || waMsg.interactive?.list_reply?.title
      || (captions ? mediaCaption(waMsg) : null) || null,
    media_id: waMsg.image?.id || waMsg.audio?.id || waMsg.video?.id || waMsg.document?.id || null,
    media_mime_type: waMsg.image?.mime_type || waMsg.audio?.mime_type || null,
    location: waMsg.location || null,
    interactive_reply: waMsg.interactive || null,
    sender_wa_id: senderWaId,
    status,
    raw_payload: waMsg,
  };
}

/**
 * D24 / GPT-6 #1: the row and the conversation counters commit together or not at all. The delivery whose
 * transaction inserts the row owns its processing: a racing delivery's insert hits the unique
 * meta_message_id (P2002, which aborts its transaction) and treats the message as a duplicate. A crash, a
 * failed counter update or an unknown commit outcome therefore never leaves a stored row that a retry
 * would skip while its counters or processing are missing — the rollback removes it, or it is committed
 * `received` / `processing` and a sweep recovers it.
 * @returns {Promise<{created: boolean, msg: object|null, conversation: object|null}>}
 */
async function insertInbound(businessId, conversationId, waMsg, senderWaId, status, options) {
  if (waMsg?.id) {
    const existing = await prisma.message.findUnique({ where: { meta_message_id: waMsg.id } });
    if (existing) return { created: false, msg: existing, conversation: null };
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({ data: inboundData(businessId, conversationId, waMsg, senderWaId, status, options) });
      const at = msg.created_at ? new Date(msg.created_at) : new Date();
      // Never move last_inbound_at backwards: the deliveries of a burst can commit out of order.
      await tx.conversation.updateMany({
        where: { id: conversationId, OR: [{ last_inbound_at: null }, { last_inbound_at: { lt: at } }] },
        data: { last_message_at: at, last_inbound_at: at },
      });
      const conversation = await tx.conversation.update({
        where: { id: conversationId },
        data: { unread_count: { increment: 1 } },
      });
      return { created: true, msg, conversation };
    }, PERSIST_TX_OPTIONS);
  } catch (err) {
    if (!err || err.code !== 'P2002' || !waMsg?.id) throw err;
    const existing = await prisma.message.findUnique({ where: { meta_message_id: waMsg.id } });
    if (!existing) throw err;
    return { created: false, msg: existing, conversation: null };
  }
}

async function saveOutboundMessage(businessId, conversationId, text, metaResponse) {
  return prisma.message.create({
    data: {
      business_id: businessId,
      conversation_id: conversationId,
      meta_message_id: metaResponse?.messages?.[0]?.id || null,
      direction: 'outbound',
      message_type: 'text',
      text_body: text,
      status: 'sent',
      is_ai_generated: true,
    },
  });
}

async function createConfirmedOrder(business, conversation, orderData) {
  return prisma.order.create({
    data: {
      business_id: business.id,
      conversation_id: conversation.id,
      customer_wa_id: conversation.customer_wa_id,
      customer_name: orderData.customer_name || conversation.profile_name || null,
      customer_phone: conversation.customer_wa_id,
      items: orderData.items,
      subtotal: orderData.subtotal,
      delivery_fee: orderData.delivery_fee,
      total: orderData.total,
      order_type: orderData.order_type,
      address: orderData.address || null,
      notes: orderData.notes || null,
      payment_method: orderData.payment_method || 'cash',
      status: 'confirmed',
      confirmed_at: new Date(),
      status_history: {
        create: [{ status: 'confirmed', changed_at: new Date(), changed_by: null }],
      },
    },
  });
}

async function createConfirmedAppointment(business, conversation, appointmentData) {
  return prisma.$transaction(async (tx) => {
    const appt = await tx.appointment.create({
      data: {
        business_id: business.id,
        conversation_id: conversation.id,
        customer_wa_id: conversation.customer_wa_id,
        customer_name: appointmentData.customer_name || conversation.profile_name || null,
        customer_phone: appointmentData.customer_phone || conversation.customer_wa_id,
        doctor_id: appointmentData.doctor_id || null,
        service_id: appointmentData.service_id || null,
        slot_id: appointmentData.slot_id || null,
        scheduled_at: appointmentData.scheduled_at || null,
        notes: appointmentData.notes || null,
        status: 'confirmed',
      },
    });

    if (appointmentData.slot_id) {
      await tx.appointmentSlot.update({
        where: { id: appointmentData.slot_id },
        data: { is_booked: true },
      });
    }

    return appt;
  });
}


/**
 * Phase 1 (before the webhook returns 200): save every inbound message and the conversation counters.
 * Throws on any DB error so the route can answer 500 and Meta retries; the error carries the items
 * this delivery committed (`err.persisted`) so the route can still process them — Meta's retry finds
 * those already stored and skips them. Idempotent under retries: each message commits in its own
 * transaction (insertInbound), and only the delivery that inserted a row processes it (`claimed`).
 */
async function persistInbound(entry) {
  const value = entry?.changes?.[0]?.value;
  const messages = value?.messages || [];
  if (!value || !messages.length) return { business: null, items: [] };

  const phoneNumberId = value.metadata?.phone_number_id;
  const business = await prisma.business.findFirst({
    where: { wa_phone_number_id: phoneNumberId },
    select: BUSINESS_SELECT,
  });
  if (!business) {
    console.warn(`No business found for phone_number_id: ${phoneNumberId}`);
    return { business: null, items: [] };
  }
  if (business.status !== 'active') return { business, items: [] };

  // D5: only SHIFT rows enter the batcher's queue. D24: every other tenant's row is `processing` until its
  // forward/workflow ran (then `delivered`, today's value), so a crash in between is visible and recoverable.
  const shiftQueue = business.business_type === 'shift' && business.ai_config?.reply_mode !== 'external';
  const inboundStatus = shiftQueue ? 'received' : PROCESSING;
  const contacts = value.contacts || [];
  const items = [];

  let firstError = null;

  for (const original of messages) {
    try {
      const waMsg = withoutNul(original);
      const contact = withoutNul(contacts.find(c => c.wa_id === original.from) || {});
      const customerWaId = normalizePhone(waMsg.from);
      const found = await getOrCreateConversation(business.id, customerWaId, contact.profile?.name);
      const { created, msg, conversation } = await insertInbound(business.id, found.id, waMsg, customerWaId, inboundStatus,
        { captions: shiftQueue });
      items.push({
        waMsg, contact, customerWaId, conversation: conversation || found, message: msg, created, recovered: false, claimed: created,
      });
    } catch (err) {
      // Keep going: the messages that do save are processed even though the webhook answers 500.
      if (!firstError) firstError = err;
    }
  }

  if (firstError) {
    firstError.persisted = { business, items };
    throw firstError;
  }
  return { business, items };
}

// Claimed by this delivery: its transaction inserted the row. (Items built by older callers carry only
// `created`.)
function needsProcessing(item) {
  return item.claimed === undefined ? !!(item.created || item.recovered) : item.claimed;
}

// A row the batcher wrote through dispatchIntent (it always stamps raw_payload.kind).
function isBotIntent(message) {
  return !!message && message.direction === 'outbound' && !!message.raw_payload
    && typeof message.raw_payload.kind === 'string';
}

/**
 * D17 / GPT-6 #8: the row a status is about — the intent whose id Meta echoed in
 * biz_opaque_callback_data, else the row holding exactly this wamid. Never a guess from the recipient
 * or the time: a status for a send whose row is not written yet (a staff claim ack) would otherwise
 * mark an unrelated, possibly unsent bot reply delivered.
 */
async function findStatusRow(status) {
  const callbackId = typeof status.biz_opaque_callback_data === 'string' ? status.biz_opaque_callback_data : '';
  if (callbackId) {
    const intent = await prisma.message.findUnique({ where: { id: callbackId } });
    if (isBotIntent(intent)) return intent;
  }
  if (!status.id) return null;
  return prisma.message.findUnique({ where: { meta_message_id: status.id } });
}

const overlaps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.some((id) => b.includes(id));

/**
 * D19 / GPT-6 #7: Meta reports that a send Graph had accepted was not delivered. Its inbound rows were
 * marked answered when the wamid came back, so the customer may have nothing.
 *  - not a covering send (a note, an opt-out or claim ack): record `failed` only;
 *  - another covering send for the same rows was accepted (e.g. part 1 of the reply): the customer has
 *    an answer — record `failed` only;
 *  - otherwise the rows go back to `unconfirmed` and replyBatcher.settleUndelivered decides with the D18
 *    budget: requeue once, then awaiting_staff + needs_team unsent_reply + alert. When another covering
 *    send is still unresolved (sending/ambiguous), its own reconciliation settles the rows instead.
 * Rows move before the settle claim: a crash in between leaves them visibly `unconfirmed`, never
 * silently `answered`.
 */
async function failIntent(intent, status, now) {
  if (SETTLED_STATUSES.includes(intent.status)) return 'already_settled';
  const error = status.errors?.[0];
  const payload = {
    ...(intent.raw_payload || {}),
    ...(error && { status_error: { code: error.code ?? null, title: error.title || error.message || null } }),
  };
  // From any unsettled status, not the one read: the batcher's recordOutcome may write `sent` in between
  // (Meta does not order this webhook after the POST's response), and Meta's `failed` is the truth.
  const markFailed = () => prisma.message.updateMany({
    where: { id: intent.id, status: { notIn: SETTLED_STATUSES } },
    data: { status: 'failed', raw_payload: payload },
  });

  const batchIds = Array.isArray(payload.batch_ids) ? payload.batch_ids : [];
  if (!COVERING_KINDS.includes(payload.kind) || !batchIds.length || payload.inbound_status === 'skipped') {
    await markFailed();
    return 'failed';
  }

  const since = new Date(new Date(intent.created_at).getTime() - 24 * 60 * 60 * 1000);
  const others = (await prisma.message.findMany({
    where: { conversation_id: intent.conversation_id, direction: 'outbound', created_at: { gte: since } },
  })).filter((m) => m.id !== intent.id && isBotIntent(m) && COVERING_KINDS.includes(m.raw_payload.kind)
    && overlaps(m.raw_payload.batch_ids, batchIds));
  if (others.some((m) => CONFIRMED_STATUSES.includes(m.status))) {
    await markFailed();
    console.warn(`[status] send failed intent=${intent.id} but another part reached the customer — not requeued`);
    return 'covered';
  }

  await prisma.message.updateMany({
    where: { id: { in: batchIds }, direction: 'inbound', status: 'answered' },
    data: { status: 'unconfirmed' },
  });
  if (others.some((m) => m.status === 'sending' || m.status === 'ambiguous')) {
    await markFailed();
    return 'pending_sibling';
  }

  // GPT-6 #7: the intent may still be `sending` (POST in flight) or turn `sent` while this runs, and the
  // batcher may mark the rows answered after the move above. The claim accepts any unsettled status, and
  // settleUndelivered takes answered rows back after it; replyBatcher's commit re-checks the other order.
  const decision = await replyBatcher.settleUndelivered({ ...intent, raw_payload: payload }, {
    now, claimFrom: ['sending', 'ambiguous', ...CONFIRMED_STATUSES], reclaimAnswered: true,
  });
  // settleUndelivered stamps `ambiguous_unreconciled`; this send is known to have failed, and the Inbox
  // and status counts must not report it as ambiguous. raw_payload.settled keeps the decision.
  if (decision) {
    await prisma.message.updateMany({ where: { id: intent.id, status: 'ambiguous_unreconciled' }, data: { status: 'failed' } });
  }
  return decision || 'already_settled';
}

/**
 * Delivery statuses (D17/D19). A bot intent is confirmed through replyBatcher.applyIntentStatus (never
 * moves backwards, answers its rows); a failed one goes through failIntent. Every other row (staff sends,
 * restaurant/clinic replies) is updated by its exact wamid as before. A status that matches nothing is
 * left unmatched: reconcileUnconfirmedIntents settles the send it may belong to.
 */
async function handleStatuses(phoneNumberId, statuses) {
  let business;
  const shiftBusiness = async () => {
    if (business === undefined) {
      business = await prisma.business.findFirst({
        where: { wa_phone_number_id: phoneNumberId },
        select: BUSINESS_SELECT,
      }).catch(() => null);
    }
    return business && business.business_type === 'shift' ? business : null;
  };

  for (const status of statuses) {
    try {
      const now = new Date();
      const found = await findStatusRow(status);
      if (isBotIntent(found) && CONFIRMED_STATUSES.includes(status.status)) {
        await replyBatcher.applyIntentStatus({ intentId: found.id, wamid: status.id || null, status: status.status });
      } else if (isBotIntent(found) && status.status === 'failed') {
        await failIntent(found, status, now);
      } else if (found && !isBotIntent(found)) {
        await prisma.message.updateMany({ where: { id: found.id }, data: { status: status.status } });
      }

      const billing = status.status === 'failed' && status.errors?.[0]?.code === BILLING_ERROR_CODE;
      if (!billing) continue;
      const biz = await shiftBusiness();
      if (!biz) continue;
      // The banner belongs to the conversation of the failed send; the recipient only locates a
      // conversation for a status whose row is unknown — it never marks any message.
      const conv = found
        ? await prisma.conversation.findUnique({ where: { id: found.conversation_id } })
        : await prisma.conversation.findFirst({ where: { business_id: biz.id, customer_wa_id: normalizePhone(status.recipient_id) } });
      if (!conv) continue;
      await jsonb.patchJson('conversations', conv.id, 'metadata', { billing_blocked_at: now.toISOString() });
      Promise.resolve(alerts.sendStaffAlert({
        reason: 'billing', business: biz, conversation: conv, summary: 'واتساب رفض رسالة — لازم تنضاف طريقة دفع',
      })).catch(() => {});
    } catch (err) {
      console.error(`[status] handling failed for ${status.id}:`, err.message);
    }
  }
}

// «typing…» promises a reply; a conversation staff hold (or that just got a staff message) gets none.
function staffHolds(conv, now) {
  if (conv.status === 'human_takeover' || conv.ai_enabled === false) return true;
  const until = conv.metadata?.human_active_until;
  return !!until && new Date(until).getTime() > now.getTime();
}

/**
 * The SHIFT number: every answer comes from the batcher's leased worker (D23). Opt-outs, reactions and
 * button taps are not handled here: the worker reads them from their durable `received` rows, so a crash
 * anywhere before or during handling is recovered by the sweeper with the same deterministic logic,
 * never by the AI, and nothing is skipped before the opt-out state and its ack intent exist.
 */
async function processShiftItem(business, accessToken, item) {
  const { waMsg, customerWaId } = item;
  const msg = item.message;
  const conv = item.conversation;
  const text = msg.text_body || '';
  const now = new Date();
  const phoneNumberId = business.wa_phone_number_id;

  const allowed = replyBatcher.isShiftReplyAllowed(business, customerWaId);
  const skipType = SHIFT_SKIP_TYPES.includes(waMsg.type);
  // Typing only for the first fragment of a message the bot will answer: later ones already have a
  // batch on its way, and save-only mode or a staff-held conversation gets a plain read receipt.
  const typing = allowed && !skipType && !staffHolds(conv, now) && !replyBatcher.hasPendingTimer(conv.id);
  await markAsRead(phoneNumberId, accessToken, waMsg.id, { typing });
  sseEmitter.emit(`business:${business.id}`, {
    type: 'new_message',
    conversationId: conv.id,
    businessId: business.id,
  });

  if (!allowed) {
    // D1 save-only: nothing is ever sent, so there is no state to make durable first (runBatch would
    // reach the same `skipped` for a row left `received`).
    await prisma.message.update({ where: { id: msg.id }, data: { status: 'skipped' } });
    return;
  }

  if (skipType) {
    // A reaction must not end the customer's burst early: runBatch waits for batch_due_at when one is
    // pending, and otherwise skips the row now.
    await replyBatcher.runBatch(conv.id);
    return;
  }

  if (waMsg.referral) {
    // Click-to-WhatsApp ad: first touch wins, and it stays "inferred" until the customer confirms.
    const referral = {};
    for (const key of REFERRAL_KEYS) {
      if (waMsg.referral[key] !== undefined) referral[key] = waMsg.referral[key];
    }
    try {
      await saveLead(conv.id, { source: { type: 'ctwa', referral, confidence: 'inferred' } },
        { source: 'referral', msgId: msg.id, at: now.toISOString(), inboundText: '' });
    } catch (err) {
      console.error(`[shift] referral not saved conversation=${conv.id}:`, err.message);
    }
  }

  if ((waMsg.type === 'text' && isOptOutCommand(text)) || replyBatcher.tapButtonId(msg)) {
    // Answered now, through a run: the lease keeps it from racing a batch that is generating (that run
    // picks the row up in its freshness check), and the burst queued before it is due at once on every
    // instance (batch_due_at = now), as «إيقاف» or a tap closes it. jsonb directly, not
    // replyBatcher.touchBatchDue: that would also arm a timer racing this run.
    replyBatcher.cancel(conv.id);
    try {
      await jsonb.touchBatchDue(conv.id, 0, batchCapMs());
    } catch (err) {
      console.error(`[shift] batch_due_at not reset conversation=${conv.id}: ${err.message}`);
    }
    await replyBatcher.runBatch(conv.id);
    return;
  }

  // Text, media and unknown taps join the batch; processShiftBatch renders media placeholders. D25: the
  // quiet deadline is shared through the DB so another instance's timer or the sweeper waits for it too.
  try {
    await replyBatcher.touchBatchDue(conv.id, replyBatcher.quietWindowMs(text));
  } catch (err) {
    // The row is durable either way; a local timer still answers the burst, the sweeper if this dies.
    console.error(`[shift] batch_due_at not set conversation=${conv.id}: ${err.message}`);
    replyBatcher.scheduleReply(conv.id, { text });
  }
}

function batchCapMs() {
  return parseInt(process.env.SHIFT_BATCH_CAP_MS, 10) || 10000;
}

/**
 * D24: the forward/workflow for these rows has run (or was attempted — a failed forward or send is
 * logged, as before, not retried). Best effort: a failed write leaves the row `processing`, and the
 * one re-run of reprocessStuckInbound is preferable to aborting the other messages of this delivery.
 */
async function markDelivered(ids) {
  if (!ids.length) return;
  try {
    await prisma.message.updateMany({
      where: { id: { in: ids }, status: { in: [PROCESSING, REPROCESSING] } },
      data: { status: 'delivered' },
    });
  } catch (err) {
    console.error(`[inbound] delivered mark failed for ${ids.join(',')}: ${err.message}`);
  }
}

/**
 * External reply mode: an outside automation (e.g. Make + Voiceflow) owns the conversation. KaramBot
 * stores inbound messages for the Inbox and forwards the payload untouched; replies are reported back by
 * the automation via POST /api/ingest/outbound.
 */
async function forwardExternal(business, value, items) {
  const claimed = items.filter(needsProcessing);
  for (const item of claimed) {
    sseEmitter.emit(`business:${business.id}`, {
      type: 'new_message',
      conversationId: item.conversation.id,
      businessId: business.id,
    });
  }

  const forwardUrl = business.ai_config?.forward_url;
  if (claimed.length && forwardUrl) {
    try {
      // Forward the unwrapped change `value` (messages/contacts/metadata at
      // top level) — matches what Make's WhatsApp trigger used to output, so
      // existing {{1.messages[]...}} mappings keep working behind a custom
      // webhook trigger.
      await axios.post(forwardUrl, value, { timeout: 10000 });
    } catch (fwdErr) {
      console.error(`Forward to external webhook failed for business ${business.id}:`, fwdErr.message);
    }
  } else if (claimed.length && !forwardUrl) {
    console.warn(`Business ${business.id} is in external reply_mode but has no ai_config.forward_url`);
  }
  await markDelivered(claimed.map((item) => item.message.id));
}

/** Restaurant, clinic and generic tenants: today's workflow, one message at a time. */
async function processTenantItems(business, accessToken, items) {
  const phoneNumberId = business.wa_phone_number_id;
  const handled = new Set();
  for (const item of items) {
    await markAsRead(phoneNumberId, accessToken, item.waMsg.id);

    if (!needsProcessing(item)) {
      console.log(`Duplicate webhook for meta_message_id=${item.waMsg.id} — skipping reprocess`);
      continue;
    }

    let conversation = item.conversation;
    // The snapshot was taken before the earlier messages of this entry ran: a second message from
    // the same customer must see the cart or takeover the first one just wrote.
    if (handled.has(conversation.id)) {
      conversation = (await prisma.conversation.findUnique({ where: { id: conversation.id } })) || conversation;
    }
    handled.add(conversation.id);

    // A throw here aborts the rest of the delivery as before; those rows stay `processing` and are re-run
    // once by reprocessStuckInbound.
    await runTenantWorkflow(business, accessToken, item, conversation);
    await markDelivered([item.message.id]);
  }
}

async function runTenantWorkflow(business, accessToken, item, startConversation) {
  const { waMsg, customerWaId } = item;
  const phoneNumberId = business.wa_phone_number_id;
  let conversation = startConversation;

  if (!conversation.ai_enabled || conversation.status === 'human_takeover') {
    return;
  }

  const msgType = waMsg.type || 'text';
  let customerText = waMsg.text?.body
    || waMsg.interactive?.button_reply?.title
    || waMsg.interactive?.list_reply?.title
    || '';

  if (!customerText) {
    if (msgType === 'location' && waMsg.location) {
      const loc = waMsg.location;
      const parts = [loc.name, loc.address].filter(Boolean);
      customerText = parts.length ? parts.join(' - ') : `${loc.latitude},${loc.longitude}`;
    } else if (msgType === 'reaction') {
      return;
    } else if (['image', 'audio', 'video', 'document', 'sticker'].includes(msgType)) {
      const mediaReply = 'عذراً، لا يمكننا معالجة الصور أو الملفات أو الرسائل الصوتية حالياً. يرجى إرسال طلبك كنص، أو اكتب "موظف" للتحدث مع موظف خدمة العملاء.';
      if (!canSendAutoReply(business, conversation, 'media-not-supported reply')) return;
      try {
        const metaResponse = await sendTextMessage(phoneNumberId, accessToken, customerWaId, mediaReply);
        await saveOutboundMessage(business.id, conversation.id, mediaReply, metaResponse);
      } catch (sendErr) {
        console.error('Failed to send media-not-supported reply:', sendErr.message);
      }
      return;
    } else {
      return;
    }
  }

  let workflowResult = null;
  if (business.business_type === 'restaurant') {
    workflowResult = await processRestaurantMessage(business, conversation, customerText);
  } else if (business.business_type === 'clinic') {
    workflowResult = await processClinicMessage(business, conversation, customerText);
  } else {
    workflowResult = {
      reply: (business.ai_config?.greeting_message) || 'كيف أقدر أساعدك؟',
      stateUpdate: {},
      action: 'NONE',
    };
  }

  if (workflowResult.stateUpdate && Object.keys(workflowResult.stateUpdate).length > 0) {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: workflowResult.stateUpdate,
    });
  }

  if (workflowResult.action === 'CONFIRM_ORDER' && workflowResult.orderData) {
    try {
      await createConfirmedOrder(business, conversation, workflowResult.orderData);
    } catch (orderErr) {
      console.error(
        `Order creation failed for business=${business.id} conv=${conversation.id}:`,
        orderErr,
      );
      workflowResult.reply = 'عذراً، حصل خطأ أثناء تسجيل طلبك. سيتواصل معك أحد موظفينا فوراً لإتمام الطلب.';
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          ai_enabled: false,
          status: 'human_takeover',
          current_state: null,
        },
      });
    }
  }

  if (workflowResult.action === 'CONFIRM_APPOINTMENT' && workflowResult.appointmentData) {
    try {
      await createConfirmedAppointment(business, conversation, workflowResult.appointmentData);
    } catch (apptErr) {
      console.error(
        `Appointment creation failed for business=${business.id} conv=${conversation.id}:`,
        apptErr,
      );
      workflowResult.reply = 'عذراً، حصل خطأ أثناء تسجيل الموعد. سيتواصل معك أحد موظفينا فوراً.';
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          ai_enabled: false,
          status: 'human_takeover',
          current_state: null,
        },
      });
    }
  }

  // Emit SSE event for real-time dashboard updates
  sseEmitter.emit(`business:${business.id}`, {
    type: 'new_message',
    conversationId: conversation.id,
    businessId: business.id,
  });

  if (workflowResult.reply) {
    if (!canSendAutoReply(business, conversation, 'workflow auto-reply')) return;
    try {
      const metaResponse = await sendTextMessage(phoneNumberId, accessToken, customerWaId, workflowResult.reply);
      await saveOutboundMessage(business.id, conversation.id, workflowResult.reply, metaResponse);
    } catch (sendErr) {
      console.error('Failed to send WhatsApp message:', sendErr.message);
    }
  }
}

function decryptBusinessToken(business) {
  try {
    const token = decrypt(business.wa_access_token);
    if (!token) console.warn(`Business ${business.id} has no WhatsApp access token configured`);
    return token || null;
  } catch (decErr) {
    console.error(`Failed to decrypt token for business ${business.id}:`, decErr.message);
    return null;
  }
}

async function processInboundMessage(entry, { persisted } = {}) {
  try {
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    if (!value) return;

    const phoneNumberId = value.metadata?.phone_number_id;
    const messages = value.messages || [];
    const statuses = value.statuses || [];

    // Handle status updates
    if (statuses.length) await handleStatuses(phoneNumberId, statuses);

    if (!messages.length) return;

    // Legacy callers (scripts, tests) did not persist first.
    const { business, items } = persisted || await persistInbound(entry);
    if (!business || business.status !== 'active') return;

    if (business.ai_config?.reply_mode === 'external') {
      await forwardExternal(business, value, items);
      return;
    }

    const accessToken = decryptBusinessToken(business);
    if (!accessToken) {
      // Nothing can be sent without a token (as before); a SHIFT row stays `received` for the sweeper's
      // alert, and a tenant row is closed so it is not re-run for nothing.
      if (business.business_type !== 'shift') await markDelivered(items.filter(needsProcessing).map((i) => i.message.id));
      return;
    }

    if (business.business_type === 'shift') {
      for (const item of items) {
        if (!needsProcessing(item)) {
          console.log(`Duplicate webhook for meta_message_id=${item.waMsg.id} — skipping reprocess`);
          continue;
        }
        try {
          await processShiftItem(business, accessToken, item);
        } catch (err) {
          // The row stays `received`; the sweeper schedules it within a minute.
          console.error(`[shift] inbound handling failed for ${item.waMsg.id}:`, err.message);
        }
      }
      return;
    }

    await processTenantItems(business, accessToken, items);
  } catch (err) {
    console.error('processInboundMessage error:', err);
  }
}

// The change `value` Meta sent, rebuilt from the stored row for a forward re-run (display_phone_number
// was never stored and is omitted).
function rebuildValue(business, conversation, message) {
  return {
    messaging_product: 'whatsapp',
    metadata: { phone_number_id: business.wa_phone_number_id },
    contacts: [{ ...(conversation?.profile_name && { profile: { name: conversation.profile_name } }), wa_id: message.sender_wa_id }],
    messages: [message.raw_payload],
  };
}

/**
 * D24 sweep step (called by the sweeper): a non-SHIFT inbound row still `processing` after `olderThanMs`
 * belongs to a delivery whose instance died between the 200 and the end of its forward/workflow — Meta
 * will not redeliver it. Each is re-run once: `processing → reprocessing` is the once-only claim across
 * instances, then forward/workflow, then `delivered`. A row still `reprocessing` `olderThanMs` after its
 * claim died again: it is logged and closed as `delivered` rather than risking a third run (a workflow
 * that got as far as an order or a send would repeat it).
 * @returns {Promise<{reprocessed: number, gaveUp: number, errors: string[]}>}
 */
async function reprocessStuckInbound({ olderThanMs = STUCK_AFTER_MS, now = new Date() } = {}) {
  const report = { reprocessed: 0, gaveUp: 0, errors: [] };
  const cutoff = new Date(new Date(now).getTime() - olderThanMs);

  const abandoned = await prisma.message.findMany({
    where: { direction: 'inbound', status: REPROCESSING, updated_at: { lt: cutoff } },
    orderBy: { created_at: 'asc' },
    take: REPROCESS_LIMIT,
  });
  for (const message of abandoned) {
    const { count } = await prisma.message.updateMany({
      where: { id: message.id, status: REPROCESSING },
      data: { status: 'delivered' },
    });
    if (count !== 1) continue;
    report.gaveUp += 1;
    console.error(`[inbound] gave up on message=${message.id} business=${message.business_id} conversation=${message.conversation_id}`
      + ' — its forward/workflow re-run did not finish; check that the customer was answered');
  }

  const stuck = await prisma.message.findMany({
    where: { direction: 'inbound', status: PROCESSING, created_at: { lt: cutoff } },
    orderBy: { created_at: 'asc' },
    take: REPROCESS_LIMIT,
  });
  for (const message of stuck) {
    const { count } = await prisma.message.updateMany({
      where: { id: message.id, status: PROCESSING },
      data: { status: REPROCESSING },
    });
    if (count !== 1) continue;
    try {
      const business = await prisma.business.findUnique({ where: { id: message.business_id }, select: BUSINESS_SELECT });
      const conversation = await prisma.conversation.findUnique({ where: { id: message.conversation_id } });
      console.warn(`[inbound] re-running stuck message=${message.id} business=${message.business_id}`);
      const item = {
        waMsg: message.raw_payload || { id: message.meta_message_id, type: message.message_type },
        contact: {},
        customerWaId: message.sender_wa_id || conversation?.customer_wa_id,
        conversation,
        message,
        created: false,
        recovered: true,
        claimed: true,
      };

      if (!business || business.status !== 'active' || !conversation) {
        await markDelivered([message.id]);
      } else if (business.ai_config?.reply_mode === 'external') {
        await forwardExternal(business, rebuildValue(business, conversation, message), [item]);
      } else if (business.business_type === 'shift') {
        // The business left external mode since: the batcher answers it like any queued SHIFT row.
        await prisma.message.updateMany({ where: { id: message.id, status: REPROCESSING }, data: { status: 'received' } });
      } else {
        const accessToken = decryptBusinessToken(business);
        if (accessToken) await processTenantItems(business, accessToken, [item]);
        else await markDelivered([message.id]);
      }
      report.reprocessed += 1;
    } catch (err) {
      // Left `reprocessing`: the next sweep after olderThanMs gives it up and logs it.
      report.errors.push(`${message.id}: ${err.message}`);
      console.error(`[inbound] re-run failed message=${message.id}: ${err.message}`);
    }
  }
  return report;
}

module.exports = { persistInbound, processInboundMessage, reprocessStuckInbound, MEDIA_TYPES };
