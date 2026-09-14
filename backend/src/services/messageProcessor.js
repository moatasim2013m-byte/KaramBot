/**
 * Message Processor
 * Handles inbound WhatsApp messages: saves to DB, runs workflow, sends reply.
 *
 * Two phases (decision D12): persistInbound runs before the webhook answers 200, so a message Meta
 * delivered is never lost when the instance dies; processInboundMessage runs after the response and
 * does the slow work (AI, sends). SHIFT replies go through the reply batcher instead of answering
 * each message on its own.
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
const { isOptOutCommand, optOutResult } = require('../workflows/shift/optout');
const { isShiftButtonId, handleButton } = require('../workflows/shift/buttons');
const { pickLanguage } = require('../workflows/shift/acks');
const { saveLead } = require('../workflows/shift/lead');
const sseEmitter = require('../utils/sseEmitter');

const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker'];
// Nothing to answer: WhatsApp system notices, reactions and message types the Cloud API can't show us.
const SHIFT_SKIP_TYPES = ['reaction', 'unsupported', 'system', 'ephemeral'];
const REFERRAL_KEYS = ['source_url', 'source_id', 'source_type', 'headline', 'body', 'ctwa_clid'];
const BILLING_ERROR_CODE = 131042;

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

async function saveInboundMessage(businessId, conversationId, waMsg, senderWaId, status = 'delivered') {
  if (waMsg?.id) {
    const existing = await prisma.message.findUnique({
      where: { meta_message_id: waMsg.id },
    });
    if (existing) return { created: false, msg: existing };
  }

  const type = waMsg.type || 'text';
  try {
    const msg = await prisma.message.create({
      data: {
        business_id: businessId,
        conversation_id: conversationId,
        meta_message_id: waMsg.id || null,
        direction: 'inbound',
        message_type: type,
        text_body: waMsg.text?.body || waMsg.interactive?.button_reply?.title || waMsg.interactive?.list_reply?.title || null,
        media_id: waMsg.image?.id || waMsg.audio?.id || waMsg.video?.id || waMsg.document?.id || null,
        media_mime_type: waMsg.image?.mime_type || waMsg.audio?.mime_type || null,
        location: waMsg.location || null,
        interactive_reply: waMsg.interactive || null,
        sender_wa_id: senderWaId,
        status,
        raw_payload: waMsg,
      },
    });
    return { created: true, msg };
  } catch (err) {
    // Prisma unique constraint error code
    if (err && err.code === 'P2002') {
      const existing = await prisma.message.findUnique({
        where: { meta_message_id: waMsg.id },
      });
      return { created: false, msg: existing };
    }
    throw err;
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
 * Throws on any DB error so the route can answer 500 and Meta retries. Idempotent under retries:
 * the unique meta_message_id dedupes the message, and a retry after a half-finished persist repairs
 * last_inbound_at.
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

  // D5: only SHIFT rows enter the batcher's queue; every other tenant keeps 'delivered'.
  const inboundStatus = business.business_type === 'shift' && business.ai_config?.reply_mode !== 'external'
    ? 'received'
    : 'delivered';
  const contacts = value.contacts || [];
  const items = [];

  for (const waMsg of messages) {
    const contact = contacts.find(c => c.wa_id === waMsg.from) || {};
    const customerWaId = normalizePhone(waMsg.from);
    let conversation = await getOrCreateConversation(business.id, customerWaId, contact.profile?.name);
    const { created, msg } = await saveInboundMessage(business.id, conversation.id, waMsg, customerWaId, inboundStatus);

    if (created) {
      const now = new Date();
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { last_message_at: now, last_inbound_at: now, unread_count: { increment: 1 } },
      });
    } else if (msg?.created_at && conversation.last_inbound_at < msg.created_at) {
      // A retry after a persist that saved the message but not the counters.
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { last_inbound_at: msg.created_at },
      });
    }

    items.push({ waMsg, contact, customerWaId, conversation, message: msg, created });
  }

  return { business, items };
}

/**
 * Delivery statuses. A SHIFT send that timed out has no wamid (status `ambiguous`); the first status
 * webhook for that customer tells us what happened to it.
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
    const updated = await prisma.message.updateMany({
      where: { meta_message_id: status.id },
      data: { status: status.status },
    }).catch(() => {});

    try {
      const unmatched = !!updated && updated.count === 0;
      const billing = status.status === 'failed' && status.errors?.[0]?.code === BILLING_ERROR_CODE;
      if (!unmatched && !billing) continue;
      const biz = await shiftBusiness();
      if (!biz) continue;
      const conv = await prisma.conversation.findFirst({
        where: { business_id: biz.id, customer_wa_id: normalizePhone(status.recipient_id) },
      });
      if (!conv) continue;

      if (unmatched) {
        const amb = await prisma.message.findFirst({
          where: { conversation_id: conv.id, direction: 'outbound', status: 'ambiguous' },
          orderBy: { created_at: 'asc' },
        });
        if (amb) {
          try {
            await prisma.message.update({
              where: { id: amb.id },
              data: { meta_message_id: status.id, status: status.status },
            });
          } catch (err) {
            if (!err || err.code !== 'P2002') throw err;
          }
        }
      }

      if (billing) {
        await jsonb.patchJson('conversations', conv.id, 'metadata', { billing_blocked_at: new Date().toISOString() });
        Promise.resolve(alerts.sendStaffAlert({
          reason: 'billing', business: biz, conversation: conv, summary: 'واتساب رفض رسالة — لازم تنضاف طريقة دفع',
        })).catch(() => {});
      }
    } catch (err) {
      console.error(`[status] SHIFT reconcile failed for ${status.id}:`, err.message);
    }
  }
}

/** The SHIFT number: answer buttons and opt-outs at once, hand everything else to the batcher. */
async function processShiftItem(business, accessToken, item) {
  const { waMsg, customerWaId } = item;
  const msg = item.message;
  const conv = item.conversation;
  const text = msg.text_body || '';
  const lang = pickLanguage(conv.workflow_data?.lead || {}, text);
  const now = new Date();
  const phoneNumberId = business.wa_phone_number_id;

  // Typing only for the first fragment: later ones already have a batch on its way.
  await markAsRead(phoneNumberId, accessToken, waMsg.id, { typing: !replyBatcher.hasPendingTimer(conv.id) });
  sseEmitter.emit(`business:${business.id}`, {
    type: 'new_message',
    conversationId: conv.id,
    businessId: business.id,
  });

  if (!replyBatcher.isShiftReplyAllowed(business, customerWaId)) {
    await prisma.message.update({ where: { id: msg.id }, data: { status: 'skipped' } });
    return;
  }

  if (SHIFT_SKIP_TYPES.includes(waMsg.type)) {
    await prisma.message.update({ where: { id: msg.id }, data: { status: 'skipped' } });
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

  if (waMsg.type === 'text' && isOptOutCommand(text)) {
    replyBatcher.cancel(conv.id);
    // Whatever else is queued is not answered by a sales reply after «إيقاف».
    await prisma.message.updateMany({
      where: { conversation_id: conv.id, direction: 'inbound', status: 'received' },
      data: { status: 'skipped' },
    });
    await replyBatcher.deliverResult({
      business,
      conversation: conv,
      result: optOutResult({ conversation: conv, lang, now }),
      batch: [msg],
      inboundStatus: 'skipped',
    });
    return;
  }

  const buttonId = waMsg.interactive?.button_reply?.id || waMsg.interactive?.list_reply?.id;
  if (isShiftButtonId(buttonId)) {
    const lastStaff = await prisma.message.findFirst({
      where: { conversation_id: conv.id, direction: 'outbound', sent_by_user_id: { not: null } },
      orderBy: { created_at: 'desc' },
    });
    if (replyBatcher.isHumanActive(conv, lastStaff, now)) {
      await prisma.message.update({ where: { id: msg.id }, data: { status: 'awaiting_staff' } });
      return;
    }
    const result = handleButton(buttonId, { business, conversation: conv, now, lang, messageId: msg.id });
    if (result) {
      await replyBatcher.deliverResult({ business, conversation: conv, result, batch: [msg] });
      return;
    }
  }

  // Text, media and unknown taps join the batch; processShiftBatch renders media placeholders.
  replyBatcher.scheduleReply(conv.id, { text });
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

    // External reply mode: an outside automation (e.g. Make + Voiceflow) owns
    // the conversation. KaramBot stores inbound messages for the Inbox and
    // forwards the payload untouched; replies are reported back by the
    // automation via POST /api/ingest/outbound.
    if (business.ai_config?.reply_mode === 'external') {
      let anyCreated = false;
      for (const item of items) {
        if (!item.created) continue;
        anyCreated = true;
        sseEmitter.emit(`business:${business.id}`, {
          type: 'new_message',
          conversationId: item.conversation.id,
          businessId: business.id,
        });
      }

      const forwardUrl = business.ai_config?.forward_url;
      if (anyCreated && forwardUrl) {
        try {
          // Forward the unwrapped change `value` (messages/contacts/metadata at
          // top level) — matches what Make's WhatsApp trigger used to output, so
          // existing {{1.messages[]...}} mappings keep working behind a custom
          // webhook trigger.
          await axios.post(forwardUrl, value, { timeout: 10000 });
        } catch (fwdErr) {
          console.error(`Forward to external webhook failed for business ${business.id}:`, fwdErr.message);
        }
      } else if (anyCreated && !forwardUrl) {
        console.warn(`Business ${business.id} is in external reply_mode but has no ai_config.forward_url`);
      }
      return;
    }

    let accessToken;
    try {
      accessToken = decrypt(business.wa_access_token);
    } catch (decErr) {
      console.error(`Failed to decrypt token for business ${business.id}:`, decErr.message);
      return;
    }
    if (!accessToken) {
      console.warn(`Business ${business.id} has no WhatsApp access token configured`);
      return;
    }

    if (business.business_type === 'shift') {
      for (const item of items) {
        if (!item.created) {
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

    for (const item of items) {
      const { waMsg, customerWaId } = item;

      await markAsRead(phoneNumberId, accessToken, waMsg.id);

      if (!item.created) {
        console.log(`Duplicate webhook for meta_message_id=${waMsg.id} — skipping reprocess`);
        continue;
      }

      let conversation = item.conversation;

      if (!conversation.ai_enabled || conversation.status === 'human_takeover') {
        continue;
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
          continue;
        } else if (['image', 'audio', 'video', 'document', 'sticker'].includes(msgType)) {
          const mediaReply = 'عذراً، لا يمكننا معالجة الصور أو الملفات أو الرسائل الصوتية حالياً. يرجى إرسال طلبك كنص، أو اكتب "موظف" للتحدث مع موظف خدمة العملاء.';
          if (!canSendAutoReply(business, conversation, 'media-not-supported reply')) continue;
          try {
            const metaResponse = await sendTextMessage(phoneNumberId, accessToken, customerWaId, mediaReply);
            await saveOutboundMessage(business.id, conversation.id, mediaReply, metaResponse);
          } catch (sendErr) {
            console.error('Failed to send media-not-supported reply:', sendErr.message);
          }
          continue;
        } else {
          continue;
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
        if (!canSendAutoReply(business, conversation, 'workflow auto-reply')) continue;
        try {
          const metaResponse = await sendTextMessage(phoneNumberId, accessToken, customerWaId, workflowResult.reply);
          await saveOutboundMessage(business.id, conversation.id, workflowResult.reply, metaResponse);
        } catch (sendErr) {
          console.error('Failed to send WhatsApp message:', sendErr.message);
        }
      }
    }
  } catch (err) {
    console.error('processInboundMessage error:', err);
  }
}

module.exports = { persistInbound, processInboundMessage, MEDIA_TYPES };
