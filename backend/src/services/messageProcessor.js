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
const { runWorkflow } = require('./dryRun');
const { notifyWorkflowAlert } = require('./workflowAlerts');
const replyBatcher = require('./replyBatcher');
const alerts = require('./alerts');
const newMessageAlert = require('./newMessageAlert');
const jsonb = require('../db/jsonb');
const media = require('../workflows/shift/media');
const { isOptOutCommand } = require('../workflows/shift/optout');
const { saveLead } = require('../workflows/shift/lead');
const sseEmitter = require('../utils/sseEmitter');
const { markOutbound } = require('./lastOutbound');
const accountEvents = require('./accountEvents');
const costGuard = require('./costGuard');
const tokenHealth = require('./tokenHealth');
const wentLive = require('./wentLive');
const { outOfHoursMessage } = require('./openingHours');

const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker'];
// Nothing to answer: WhatsApp system notices and reactions. `unsupported` (view-once media, polls) is
// customer content, so it joins the batch and gets the media reply instead of silence.
const SHIFT_SKIP_TYPES = ['reaction', 'system', 'ephemeral'];
const REFERRAL_KEYS = ['source_url', 'source_id', 'source_type', 'headline', 'body', 'ctwa_clid'];
const BILLING_ERROR_CODE = 131042;
// Not something the customer wrote (newMessageAlert's SKIP_TYPES): never puts a conversation in front of staff.
const NO_ANSWER_TYPES = ['reaction', 'system', 'ephemeral', 'request_welcome'];
const BOT_PAUSED = 'bot_paused';
const BOT_LIMIT = 'bot_limit';
const OUT_OF_HOURS = 'out_of_hours';
// Sent at most once a day per conversation while the cost guard holds the bot (ai_config.limit_message
// overrides it). It promises a person, which is true: the conversation is on the staff's attention list.
// A «ما عرف يجاوب» row keeps the customer's question, cut so a pasted essay cannot bloat the log.
const MAX_GAP_QUESTION = 500;
const DEFAULT_LIMIT_MESSAGE = 'شكرًا لتواصلك معنا. وصلت رسالتك لفريقنا وسيرد عليك أحد الموظفين بأقرب وقت.';

/** The numbers staff alerts are sent TO. A conversation with one of them is a staff thread. */
function isStaffNumber(business, waId) {
  const list = business?.ai_config?.alert_wa_numbers;
  if (!Array.isArray(list) || !waId) return false;
  const want = String(waId).replace(/\D/g, '');
  return list.some((n) => String(n ?? '').replace(/\D/g, '') === want);
}

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
  currency: true, wa_phone_number_id: true, wa_access_token: true, wa_business_account_id: true,
  wa_app_id: true, ai_config: true, policies: true, is_internal: true,
  // went_live: read so a shop that is already live costs no query per reply (wentLive.candidate).
  went_live_at: true, connected_at: true,
  // «أوقات الدوام» are enforced on the message path (openingHours), and the generic prompt reads them.
  opening_hours: true, timezone: true,
};

function canSendAutoReply(business, conversation, label) {
  if (isWithinServiceWindow(conversation.last_inbound_at)) return true;
  console.warn(
    `[serviceWindow] Skipping ${label} outside 24h window — business=${business.id} conversation=${conversation.id}`,
  );
  return false;
}

/**
 * Returns the conversation, and sets `created` on it when this delivery is the one that
 * opened it. The conversation row is unique on (business_id, customer_wa_id), so a
 * successful insert is the only moment a number is new to this business.
 * The flag is attached to the returned object only; it is never written to the database.
 */
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
      if (conv) conv.created = true;
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
      // PR3 (SHIFT only): a template quick reply («بدي أغيّر الموعد») is `type: 'button'` with `button.text`.
      || (captions ? mediaCaption(waMsg) || waMsg.button?.text : null) || null,
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
  const msg = await prisma.message.create({
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
  await markOutbound(conversationId, msg && msg.created_at);
  costGuard.noteReply(businessId);
  return msg;
}

/**
 * «أوقف البوت مؤقتًا» (ai_config.enabled). Only an explicit false pauses: a business that never set
 * the flag has always had a bot that answers, and must keep it.
 */
function botPaused(business) {
  return business?.ai_config?.enabled === false;
}

/**
 * The bot will not answer, so this customer is waiting for a person: the conversation joins the
 * inbox's attention list. attention_at is when the customer wrote. It is kept while they are still
 * waiting, so a burst is one item aged from its first message, and moves once staff have answered
 * since, so the next message is a new wait. Best effort: the message is stored either way.
 */
async function flagForStaff(conversation, reason, at) {
  const since = conversation.attention_at ? new Date(conversation.attention_at).getTime() : NaN;
  const answered = !!conversation.last_outbound_at && new Date(conversation.last_outbound_at).getTime() >= since;
  if (conversation.needs_attention && Number.isFinite(since) && !answered) return conversation;
  try {
    return await prisma.conversation.update({
      where: { id: conversation.id },
      data: { needs_attention: true, attention_reason: reason, attention_at: at ? new Date(at) : new Date() },
    });
  } catch (err) {
    console.error(`[inbound] attention flag not set conversation=${conversation.id}: ${err.message}`);
    return conversation;
  }
}

/**
 * A paused bot leaves this customer to the shop's team: flag the conversation, unless it is not a
 * customer waiting. Reactions and system notices ask nothing. A staff number (alert_wa_numbers)
 * writing in is staff, often just replying to an alert to keep its 24 h window open for the free
 * ones, and its thread must not sit in «بانتظارك» beside real customers (review 2026-10-08).
 */
async function flagPausedWait(business, conversation, waMsg, customerWaId, at) {
  if (NO_ANSWER_TYPES.includes(waMsg && waMsg.type)) return;
  if (isStaffNumber(business, customerWaId || conversation.customer_wa_id)) return;
  await flagForStaff(conversation, BOT_PAUSED, at);
}

// The inbox refreshes the thread and the list as soon as a message is stored.
function emitNewMessages(business, items) {
  for (const item of items) {
    sseEmitter.emit(`business:${business.id}`, {
      type: 'new_message',
      conversationId: item.conversation.id,
      businessId: business.id,
    });
  }
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
/**
 * Whether this delivery may act on this business at all. Applied to inbound messages and to
 * delivery receipts alike, because a receipt mutates that tenant's message rows too.
 *
 * Two independent rules, both of which only ever refuse on a positive mismatch:
 *
 *  - The WABA. Since Embedded Signup one callback URL serves every customer's WABA, so the
 *    number id alone is no longer proof of ownership: a number is only this business's when
 *    the WABA it arrived on matches too.
 *  - The Meta app. Each endpoint trusts exactly one app secret, so a delivery that passed the
 *    Tech Provider app's signature check may not act on a hand-wired number, nor the other way
 *    round — one leaked app secret would otherwise reach every number in the database.
 *
 * Both fail open when the business has nothing recorded to compare against: numbers that
 * predate these columns, and the window between a new customer's subscription and the write
 * that links their business row (completeOnboarding), must keep working.
 */
function refusesDelivery(business, { wabaId, servesApp, endpoint, what }) {
  if (wabaId && business.wa_business_account_id && business.wa_business_account_id !== wabaId) {
    console.error(
      `[webhook] WABA mismatch — dropping ${what}: phone_number_id=${business.wa_phone_number_id} ` +
      `arrived on WABA ${wabaId} but business ${business.id} is registered to ${business.wa_business_account_id}`,
    );
    return true;
  }
  if (servesApp && business.wa_app_id && !servesApp(business.wa_app_id)) {
    console.error(
      `[webhook] app mismatch — dropping ${what}: phone_number_id=${business.wa_phone_number_id} ` +
      `arrived on the ${endpoint || 'unknown'} endpoint but business ${business.id} belongs to ` +
      `app ${business.wa_app_id}`,
    );
    return true;
  }
  return false;
}

async function persistInbound(entry, { servesApp, endpoint } = {}) {
  const value = entry?.changes?.[0]?.value;
  const messages = value?.messages || [];
  if (!value || !messages.length) return { business: null, items: [] };

  const phoneNumberId = value.metadata?.phone_number_id;
  // Prisma drops an undefined condition, so findFirst with no phone number id would return
  // whichever business happens to come first and hand it someone else's messages. A delivery
  // that names no number cannot be routed to anyone.
  if (!phoneNumberId) {
    console.warn('[webhook] delivery carries no phone_number_id — nothing to route it to');
    return { business: null, items: [] };
  }
  const wabaId = entry?.id ? String(entry.id) : null;
  const business = await prisma.business.findFirst({
    where: { wa_phone_number_id: phoneNumberId },
    select: BUSINESS_SELECT,
  });
  if (!business) {
    console.warn(`No business found for phone_number_id: ${phoneNumberId}`);
    return { business: null, items: [] };
  }
  if (refusesDelivery(business, { wabaId, servesApp, endpoint, what: 'message' })) {
    return { business: null, items: [] };
  }
  // D5: only SHIFT rows enter the batcher's queue. D24: every other tenant's row is `processing` until its
  // forward/workflow ran (then `delivered`, today's value), so a crash in between is visible and recoverable.
  const shiftRows = business.business_type === 'shift' && business.ai_config?.reply_mode !== 'external';
  // P0: a shop that is not 'active' (suspended, inactive) still has its messages stored, so they reach
  // the inbox and the new-message alert; only the bot stops. Until now they were dropped here, unsaved.
  // Its rows are stored already settled, with the value a non-active shop's rows end with anyway
  // (runLeased marks SHIFT rows `skipped`, reprocessStuckInbound marks the others `delivered`): no
  // sweep ever picks one up and answers it later, after the shop is switched back on.
  const active = business.status === 'active';
  let inboundStatus;
  if (!active) inboundStatus = shiftRows ? 'skipped' : 'delivered';
  else inboundStatus = shiftRows ? 'received' : PROCESSING;
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
        { captions: shiftRows });
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

  // Review r2 #8: an image Graph accepted and could not fetch (131053) — the header-less fallback the
  // synchronous path would have sent goes out now, before any requeue or «covered» decision.
  if (payload.fallback_part) {
    let fallback = null;
    try {
      fallback = await replyBatcher.sendMediaFallback({ ...intent, raw_payload: payload }, { now, errorCode: error?.code ?? null });
    } catch (err) {
      console.error(`[status] fallback send failed intent=${intent.id}: ${err.message}`);
    }
    if (fallback && ['sent', 'ambiguous', 'deduped'].includes(fallback.outcome)) {
      await markFailed();
      return 'fallback_sent';
    }
  }

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
 * A shop's WABA can no longer pay Meta (131042): stamp WhatsappOnboarding.payment_blocked_at and
 * tell SHIFT, once per block.
 *
 * The shop's own alert (reason 'billing') goes out from the shop's own number, which Meta is
 * refusing for this very reason, and the webhook is SHIFT's private channel that no longer carries
 * tenant reasons. Without this, nobody heard that the bot had gone silent, and the panels'
 * payment_blocked state (admin.js, accountHealth.js) had no writer and could never turn red.
 * notifyShift sends from SHIFT's own number and the webhook.
 *
 * The gate is the onboarding row itself: updateMany WHERE payment_blocked_at IS NULL wins once, so
 * two webhook deliveries racing make one alert. Returns true when the onboarding row decided
 * (whether or not this call was first), false when the shop has no onboarding row (a number wired
 * by hand), so the caller falls back to the conversation's own first-block gate.
 */
async function markPaymentBlocked(biz, now) {
  const onb = await prisma.whatsappOnboarding.findUnique({ where: { business_id: biz.id }, select: { id: true } });
  if (!onb) return false;
  const stamped = await prisma.whatsappOnboarding.updateMany({
    where: { id: onb.id, payment_blocked_at: null },
    data: { payment_blocked_at: now },
  });
  if (stamped.count > 0) await reportPaymentBlocked(biz);
  return true;
}

async function reportPaymentBlocked(biz) {
  await accountEvents.record({ businessId: biz.id, actorKind: 'meta', type: 'payment_blocked', data: { error_code: BILLING_ERROR_CODE } });
  Promise.resolve(alerts.notifyShift({
    reason: 'payment_blocked', businessId: biz.id, shopName: biz.name || '',
    summary: 'واتساب رفض ردود البوت (131042) — لازم الزبون يضيف طريقة دفع في WhatsApp Manager',
  })).catch(() => {});
}

/** A delivered message proves Meta is sending again: the red payment state ends (spec, payment_blocked). */
async function clearPaymentBlocked(biz) {
  await prisma.whatsappOnboarding.updateMany({
    where: { business_id: biz.id, payment_blocked_at: { not: null } },
    data: { payment_blocked_at: null },
  });
}

/**
 * Delivery statuses (D17/D19). A bot intent is confirmed through replyBatcher.applyIntentStatus (never
 * moves backwards, answers its rows); a failed one goes through failIntent. Every other row (staff sends,
 * restaurant/clinic replies) is updated by its exact wamid as before. A status that matches nothing is
 * left unmatched: reconcileUnconfirmedIntents settles the send it may belong to.
 */
async function handleStatuses(phoneNumberId, statuses) {
  let business;
  // Any business whose number this is. It used to return the row only when it was SHIFT's own,
  // which meant a customer whose messages WhatsApp had started refusing — for want of a payment
  // method on their WABA — was never told. That is the one delivery failure they must hear about.
  const statusBusiness = async () => {
    if (business === undefined) {
      business = await prisma.business.findFirst({
        where: { wa_phone_number_id: phoneNumberId },
        select: BUSINESS_SELECT,
      }).catch(() => null);
    }
    return business || null;
  };

  let paymentCleared = false;
  for (const status of statuses) {
    try {
      const now = new Date();
      const found = await findStatusRow(status);
      // Once per webhook call: a delivered send of this number lifts a 131042 block.
      if (!paymentCleared && status.status === 'delivered' && found && found.direction === 'outbound') {
        paymentCleared = true;
        const biz = await statusBusiness();
        if (biz && biz.business_type !== 'shift') await clearPaymentBlocked(biz);
      }
      if (isBotIntent(found) && CONFIRMED_STATUSES.includes(status.status)) {
        await replyBatcher.applyIntentStatus({ intentId: found.id, wamid: status.id || null, status: status.status });
      } else if (isBotIntent(found) && status.status === 'failed') {
        await failIntent(found, status, now);
      } else if (found && !isBotIntent(found)) {
        await prisma.message.updateMany({ where: { id: found.id }, data: { status: status.status } });
      }

      // A weekly follow-up Meta accepted and later failed (2026-10-06: Hanaa, 131042) was counted as
      // sent, so the series would have carried on to week 2 without week 1 ever arriving. It ends here.
      if (status.status === 'failed' && found && found.raw_payload && found.raw_payload.kind === 'weekly_followup' && found.conversation_id) {
        const code = status.errors?.[0]?.code;
        const fresh = await prisma.conversation.findUnique({ where: { id: found.conversation_id }, select: { workflow_data: true } });
        const wf = (fresh && fresh.workflow_data && fresh.workflow_data.weekly_followup) || {};
        // Only a failure of the LATEST send ends the series: a late report about week 1, arriving after
        // week 2 went out, must not stop a series that is working (second review, 2026-10-07).
        const lastSentMs = wf.last_sent_at ? new Date(wf.last_sent_at).getTime() : NaN;
        const isLatest = !Number.isFinite(lastSentMs) || new Date(found.created_at).getTime() >= lastSentMs - 5 * 60 * 1000;
        if (!wf.stopped && isLatest) {
          await jsonb.patchJson('conversations', found.conversation_id, 'workflow_data', {
            weekly_followup: { ...wf, stopped: code === BILLING_ERROR_CODE ? 'billing' : 'failed_delivery', stopped_at: now.toISOString(), failed_code: code || null },
          });
        }
      }

      const billing = status.status === 'failed' && status.errors?.[0]?.code === BILLING_ERROR_CODE;
      if (!billing) continue;
      // A billing alert is itself a WhatsApp message, so it fails for the very reason it is
      // reporting — and that failure used to raise another one. Owner's brother's phone,
      // 2026-10-02: 67 identical alerts in two minutes, 24 then 39 a minute and climbing, because
      // every alert spawned the next. Alert rows are stamped `kind: 'staff_alert'` by alerts.js.
      if (found?.raw_payload?.kind === 'staff_alert') continue;
      const biz = await statusBusiness();
      if (!biz) continue;
      // A shop's block is reported to SHIFT here, before the conversation lookups below can skip:
      // the shop's own alert cannot get out of a number Meta is refusing. SHIFT's own number keeps
      // its webhook, so it needs none of this.
      const tenant = biz.business_type !== 'shift';
      const onboardingDecided = tenant ? await markPaymentBlocked(biz, now) : true;
      // The banner belongs to the conversation of the failed send; the recipient only locates a
      // conversation for a status whose row is unknown — it never marks any message.
      const conv = found
        ? await prisma.conversation.findUnique({ where: { id: found.conversation_id } })
        : await prisma.conversation.findFirst({ where: { business_id: biz.id, customer_wa_id: normalizePhone(status.recipient_id) } });
      if (!conv) continue;
      // A staff number has a conversation of its own — alerts.js opens one to store what it sent.
      // It is not a customer, and «العميل: Osaid (+9715…)» about the person receiving the alert is
      // both wrong and the other half of the loop above.
      if (isStaffNumber(biz, conv.customer_wa_id)) continue;
      // A missing payment method is a standing condition, not an event. claimFlag sets the flag
      // only when it is still unset and says whether this call was the one that set it, so the
      // first refused message alerts and the rest only carry the banner. Two webhook deliveries
      // racing on the same conversation make exactly one winner.
      const firstBlock = await jsonb.claimFlag('conversations', conv.id, 'metadata', ['billing_blocked_at']);
      if (!firstBlock) continue;
      // A shop with no onboarding row (wired by hand): the conversation's first block tells SHIFT.
      if (!onboardingDecided) await reportPaymentBlocked(biz);
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
    // A paused bot is save-only too (isShiftReplyAllowed), but unlike the test-number mode a customer
    // is now waiting for the team. A conversation staff already hold needs no flag.
    if (botPaused(business) && !staffHolds(conv, now)) {
      await flagPausedWait(business, conv, waMsg, customerWaId, msg.created_at);
    }
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
  emitNewMessages(business, claimed);

  // «أوقف البوت مؤقتًا» covers the outside automation too: it is this shop's bot, and the panels
  // show it as paused. Nothing is forwarded; the messages are stored and the customers wait for
  // the team, as with a paused workflow. Both callers (the webhook and reprocessStuckInbound) pass
  // here, so neither can forward around the pause.
  if (botPaused(business)) {
    const now = new Date();
    for (const item of claimed) {
      if (item.conversation && !staffHolds(item.conversation, now)) {
        await flagPausedWait(business, item.conversation, item.waMsg, item.customerWaId, item.message && item.message.created_at);
      }
    }
    await markDelivered(claimed.map((item) => item.message.id));
    return;
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

const TENANT_MEDIA_LABEL = { audio: '[رسالة صوتية]', image: '[صورة]', video: '[فيديو]' };

/**
 * A customer business's bot reads a voice note, photo or video (owner, 2026-10-07: «must listen to audio
 * and see photos and videos and respond»), with the same reader as the SHIFT bot. Returns the text the
 * workflow should answer — the attachment's content under a label, plus the customer's caption — or ''
 * when media is off or it could not be read, and the old «send it as text» reply applies.
 */
async function readTenantMedia(business, accessToken, item, waMsg) {
  const row = item && item.message;
  if (!row || !media.mediaEnabled()) return '';
  let read = null;
  try {
    read = await media.readForTenant(business, accessToken, row, { now: new Date() });
  } catch (err) {
    console.error(`[media] tenant read failed business=${business.id}: ${err.message}`);
  }
  if (!read || read.status !== 'ok' || !read.text) return '';
  try {
    await prisma.message.update({
      where: { id: row.id },
      data: { raw_payload: { ...(row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {}), shift_media: read } },
    });
  } catch (err) {
    console.error(`[media] tenant transcript not saved message=${row.id}: ${err.message}`);
  }
  const caption = (waMsg.image && waMsg.image.caption) || (waMsg.video && waMsg.video.caption) || '';
  return [`${TENANT_MEDIA_LABEL[read.type] || '[مرفق]'}${caption ? ` ${caption}` : ''}`, read.text].join('\n');
}

/**
 * A tenant send Meta refused synchronously. Two refusals mean the bot has gone quiet for a reason
 * only SHIFT can see: 131042 (no payment method at Meta) gets the same treatment as the status
 * webhook's 131042 (handleStatuses), and 190 (the token is no longer valid) is recorded by
 * tokenHealth. Never throws: the caller is already handling a failed send.
 */
async function noteSendRefusal(business, conversation, err) {
  try {
    const code = tokenHealth.graphCode(err);
    if (code === tokenHealth.TOKEN_INVALID_CODE) {
      await tokenHealth.markInvalid(business, { source: 'send' });
      return;
    }
    if (code !== BILLING_ERROR_CODE || !business || business.business_type === 'shift') return;
    const decided = await markPaymentBlocked(business, new Date());
    if (!conversation || isStaffNumber(business, conversation.customer_wa_id)) return;
    // The conversation's first block, as in handleStatuses: one banner, one shop alert.
    const firstBlock = await jsonb.claimFlag('conversations', conversation.id, 'metadata', ['billing_blocked_at']);
    if (!firstBlock) return;
    if (!decided) await reportPaymentBlocked(business);
    Promise.resolve(alerts.sendStaffAlert({
      reason: 'billing', business, conversation, summary: 'واتساب رفض رسالة — لازم تنضاف طريقة دفع',
    })).catch(() => {});
  } catch (e) {
    console.error(`[send] refusal not recorded business=${business && business.id}: ${e.message}`);
  }
}

function limitMessage(business) {
  const custom = business?.ai_config?.limit_message;
  return typeof custom === 'string' && custom.trim() ? custom.trim().slice(0, 1000) : DEFAULT_LIMIT_MESSAGE;
}

/**
 * The cost guard said no (costGuard.allow): the bot neither reads nor replies, and the customer
 * becomes the shop staff's, exactly like a paused bot, with attention_reason 'bot_limit'. Unlike a
 * pause, the customer is told once a day that a person will answer, so a free-month shop past its
 * cap does not look dead. The day is claimed on the conversation (metadata.bot_limit_notice_day),
 * so two deliveries racing send one notice.
 *
 * The notice is stored with is_ai_generated false: it is not a bot answer, it must not count
 * against the cap that caused it, and it does not stamp last_outbound_at, which would read the
 * customer as answered and restart their wait on the attention list.
 */
async function holdForLimit(business, accessToken, conversation, item) {
  const { customerWaId } = item;
  if (isStaffNumber(business, customerWaId || conversation.customer_wa_id)) return;
  const flagged = await flagForStaff(conversation, BOT_LIMIT, item.message && item.message.created_at);
  emitNewMessages(business, [{ conversation: flagged || conversation }]);

  let claimed = false;
  try {
    claimed = await jsonb.claimValue('conversations', conversation.id, 'metadata', 'bot_limit_notice_day', costGuard.ammanDay());
  } catch (err) {
    console.error(`[costGuard] notice claim failed conversation=${conversation.id}: ${err.message}`);
  }
  if (!claimed || !canSendAutoReply(business, conversation, 'bot-limit notice')) return;

  const text = limitMessage(business);
  try {
    const metaResponse = await sendTextMessage(business.wa_phone_number_id, accessToken, customerWaId, text);
    await prisma.message.create({
      data: {
        business_id: business.id,
        conversation_id: conversation.id,
        meta_message_id: metaResponse?.messages?.[0]?.id || null,
        direction: 'outbound',
        message_type: 'text',
        text_body: text,
        status: 'sent',
        is_ai_generated: false,
      },
    });
  } catch (err) {
    console.error(`[costGuard] limit notice not sent conversation=${conversation.id}: ${err.message}`);
    await noteSendRefusal(business, conversation, err);
  }
}

/**
 * The shop is closed by its own «أوقات الدوام» and the owner wrote «رسالة خارج الدوام»: the bot takes
 * no order and books nothing, and the customer is the team's when they open, like holdForLimit.
 * The message goes once per conversation per Amman day (metadata.out_of_hours_notice_day), so a
 * customer writing five times at night is told once, and stored with is_ai_generated false for the
 * same reasons as the limit notice: not a bot answer, no cost, and the wait is not restarted.
 */
async function holdOutOfHours(business, accessToken, conversation, item, text) {
  const { customerWaId } = item;
  const flagged = await flagForStaff(conversation, OUT_OF_HOURS, item.message && item.message.created_at);
  emitNewMessages(business, [{ conversation: flagged || conversation }]);

  let claimed = false;
  try {
    claimed = await jsonb.claimValue('conversations', conversation.id, 'metadata', 'out_of_hours_notice_day', costGuard.ammanDay());
  } catch (err) {
    console.error(`[hours] notice claim failed conversation=${conversation.id}: ${err.message}`);
  }
  if (!claimed || !canSendAutoReply(business, conversation, 'out-of-hours message')) return;

  try {
    const metaResponse = await sendTextMessage(business.wa_phone_number_id, accessToken, customerWaId, text);
    await prisma.message.create({
      data: {
        business_id: business.id,
        conversation_id: conversation.id,
        meta_message_id: metaResponse?.messages?.[0]?.id || null,
        direction: 'outbound',
        message_type: 'text',
        text_body: text,
        status: 'sent',
        is_ai_generated: false,
      },
    });
  } catch (err) {
    console.error(`[hours] out-of-hours message not sent conversation=${conversation.id}: ${err.message}`);
    await noteSendRefusal(business, conversation, err);
  }
}

/** True when the shop may spend on this message; otherwise the conversation is held for staff. */
async function spendAllowed(business, accessToken, conversation, item, kind) {
  const verdict = await costGuard.allow(business, kind);
  if (verdict.ok) return true;
  console.warn(`[costGuard] business=${business.id} held (${verdict.reason}) conversation=${conversation.id}`);
  await holdForLimit(business, accessToken, conversation, item);
  return false;
}

const MEDIA_UNSUPPORTED_REPLY = 'عذراً، لا يمكننا معالجة الصور أو الملفات أو الرسائل الصوتية حالياً. يرجى إرسال طلبك كنص، أو اكتب "موظف" للتحدث مع موظف خدمة العملاء.';

async function sendMediaUnsupported(business, accessToken, conversation, customerWaId) {
  if (!canSendAutoReply(business, conversation, 'media-not-supported reply')) return;
  try {
    const metaResponse = await sendTextMessage(business.wa_phone_number_id, accessToken, customerWaId, MEDIA_UNSUPPORTED_REPLY);
    await saveOutboundMessage(business.id, conversation.id, MEDIA_UNSUPPORTED_REPLY, metaResponse);
  } catch (sendErr) {
    console.error('Failed to send media-not-supported reply:', sendErr.message);
    await noteSendRefusal(business, conversation, sendErr);
  }
}

async function runTenantWorkflow(business, accessToken, item, startConversation) {
  const { waMsg, customerWaId } = item;
  const phoneNumberId = business.wa_phone_number_id;
  let conversation = startConversation;

  if (!conversation.ai_enabled || conversation.status === 'human_takeover') {
    return;
  }

  // «أوقف البوت مؤقتًا»: nothing is sent, not even the «send it as text» media reply, and nothing is
  // read or asked of the AI (both cost money). The message is already stored; the customer now waits
  // for the shop's staff, so the conversation goes to their attention list.
  if (botPaused(business)) {
    await flagPausedWait(business, conversation, waMsg, customerWaId, item.message && item.message.created_at);
    emitNewMessages(business, [{ conversation }]);
    return;
  }

  // Closed by the owner's own hours, with a message written for it: that message, not a reply.
  // Before media is read or the AI asked, so a closed shop costs nothing. A reaction asks nothing,
  // and a staff number writing in is not a customer to tell the shop is closed.
  const closedText = outOfHoursMessage(business);
  if (closedText && !NO_ANSWER_TYPES.includes(waMsg.type)
    && !isStaffNumber(business, customerWaId || conversation.customer_wa_id)) {
    await holdOutOfHours(business, accessToken, conversation, item, closedText);
    return;
  }

  const msgType = waMsg.type || 'text';
  // Set once the cost guard has been asked, so a media read and the reply it feeds are one check.
  let guarded = false;
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
    } else if (['image', 'audio', 'video'].includes(msgType) && media.mediaEnabled()) {
      // Reading costs money, so the guard is asked first (the daily media cap and the reply caps).
      if (!(await spendAllowed(business, accessToken, conversation, item, 'media'))) return;
      guarded = true;
      // Read: the workflow answers what the customer sent, like a typed message (owner, 2026-10-07).
      customerText = await readTenantMedia(business, accessToken, item, waMsg);
      if (!customerText) {
        await sendMediaUnsupported(business, accessToken, conversation, customerWaId);
        return;
      }
    } else if (['image', 'audio', 'video', 'document', 'sticker'].includes(msgType)) {
      await sendMediaUnsupported(business, accessToken, conversation, customerWaId);
      return;
    } else {
      return;
    }
  }

  // The AI is not asked once the shop is over a hard limit (costGuard; SHIFT's own number is exempt).
  if (!guarded && !(await spendAllowed(business, accessToken, conversation, item, 'reply'))) return;

  // Shared with «جرّب البوت»: the dry run and production go through the same dispatch, so a
  // test reply is the reply a customer would get.
  const workflowResult = await runWorkflow(business, conversation, customerText);

  // The bot has stopped answering this conversation and a person has to take it. Alerting here
  // rather than inside each workflow means restaurant, clinic and generic cannot drift apart.
  // `alert_reason` lets a workflow say WHY it handed over — a technical failure reads differently
  // to the owner than a customer asking for a human.
  if (workflowResult.action === 'HANDOFF_TO_HUMAN') {
    notifyWorkflowAlert({
      reason: workflowResult.alert_reason || 'handoff',
      business,
      conversation,
      summary: customerText,
    });
    // «ما عرف يجاوب»: only a question the model gave up on is a gap the owner can teach. A keyword
    // the owner chose, or a provider failure, is not something an answer in «البوت» would fix.
    // Not awaited: record() never throws, and the customer's reply must not wait on the log.
    if (workflowResult.handoff_kind === 'model') {
      accountEvents.record({
        businessId: business.id,
        actorKind: 'system',
        type: 'bot_handoff',
        data: { question: String(customerText).slice(0, MAX_GAP_QUESTION), conversation_id: conversation.id },
      });
    }
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
      // The customer has just been promised a person. Until now nobody was told, so that promise
      // was only kept if someone happened to be watching the inbox.
      notifyWorkflowAlert({
        reason: 'needs_team', business, conversation,
        summary: `فشل تسجيل طلب — وُعد الزبون بتواصل فوري: ${orderErr && orderErr.message}`,
      });
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
      notifyWorkflowAlert({
        reason: 'needs_team', business, conversation,
        summary: `فشل تسجيل موعد — وُعد الزبون بتواصل فوري: ${apptErr && apptErr.message}`,
      });
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
      // The shop's first AI reply to a real customer: «يعمل» on the board, the free month's start.
      // Never throws, and is a no-op without a query once the shop is live.
      await wentLive.noteAiReply(business, customerWaId);
    } catch (sendErr) {
      console.error('Failed to send WhatsApp message:', sendErr.message);
      await noteSendRefusal(business, conversation, sendErr);
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

async function processInboundMessage(entry, { persisted, servesApp, endpoint } = {}) {
  try {
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    if (!value) return;

    const phoneNumberId = value.metadata?.phone_number_id;
    const messages = value.messages || [];
    const statuses = value.statuses || [];

    // Handle status updates. A receipt mutates the tenant's own message rows, so it is held to
    // the same ownership rules as an inbound message — findStatusRow matches a wamid across the
    // whole table, which on its own would let one endpoint settle another endpoint's sends.
    // A number that matches no business is left exactly as before: refused only on a mismatch.
    if (statuses.length) {
      // Only an identified owner can be refused. Without a phone number id there is nothing to
      // look up — and Prisma would drop the undefined condition and return an arbitrary business,
      // whose WABA and app would then decide a receipt that has nothing to do with it. A failed
      // lookup is logged rather than swallowed: it disables this check, so it must be visible.
      let owner = null;
      if (phoneNumberId) {
        owner = await prisma.business.findFirst({
          where: { wa_phone_number_id: phoneNumberId },
          select: BUSINESS_SELECT,
        }).catch((err) => {
          console.error(`[webhook] owner lookup failed for statuses on ${phoneNumberId}:`, err.message);
          return null;
        });
      }
      const refused = !!owner && refusesDelivery(owner, {
        wabaId: entry?.id ? String(entry.id) : null, servesApp, endpoint, what: 'status',
      });
      if (!refused) await handleStatuses(phoneNumberId, statuses);
    }

    if (!messages.length) return;

    // Legacy callers (scripts, tests) did not persist first.
    const { business, items } = persisted || await persistInbound(entry, { servesApp, endpoint });
    if (!business) return;

    // «رسالة جديدة من عميل» to staff (where configured), whatever the shop's status: a suspended shop
    // still hears from its customers. Not awaited and never rejects: the reply path below neither waits
    // for it nor fails with it.
    newMessageAlert.notifyNewMessages(business, items);

    // P0: the bot answers only for an active shop. The others' messages are stored (persistInbound) and
    // shown in the inbox; nothing is sent or read, and no forward goes to an outside automation.
    if (business.status !== 'active') {
      emitNewMessages(business, items.filter(needsProcessing));
      return;
    }

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

      // The delivery that died may never have reached its new-message alert. Staff hear about the
      // message whatever the shop's status; an alert that did go out is not repeated (its claim).
      if (business && conversation) newMessageAlert.notifyNewMessages(business, [item]);

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
