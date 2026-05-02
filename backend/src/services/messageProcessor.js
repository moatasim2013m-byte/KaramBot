/**
 * Message Processor
 * Handles inbound WhatsApp messages: saves to DB, runs workflow, sends reply.
 */

const prisma = require('../config/prisma');
const { sendTextMessage, markAsRead, normalizePhone } = require('../services/whatsapp');
const { decrypt } = require('../utils/tokenCrypto');
const { isWithinServiceWindow } = require('../utils/serviceWindow');
const { processRestaurantMessage } = require('../workflows/restaurant');
const { processClinicMessage } = require('../workflows/clinic');
const sseEmitter = require('../utils/sseEmitter');

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
    conv = await prisma.conversation.create({
      data: {
        business_id: businessId,
        customer_wa_id: customerWaId,
        profile_name: profileName || null,
        status: 'open',
        ai_enabled: true,
      },
    });
  } else if (profileName && !conv.profile_name) {
    conv = await prisma.conversation.update({
      where: { id: conv.id },
      data: { profile_name: profileName },
    });
  }
  return conv;
}

async function saveInboundMessage(businessId, conversationId, waMsg, senderWaId) {
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
        status: 'delivered',
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


async function processInboundMessage(entry) {
  try {
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    if (!value) return;

    const phoneNumberId = value.metadata?.phone_number_id;
    const contacts = value.contacts || [];
    const messages = value.messages || [];
    const statuses = value.statuses || [];

    // Handle status updates
    for (const status of statuses) {
      await prisma.message.updateMany({
        where: { meta_message_id: status.id },
        data: { status: status.status },
      }).catch(() => {});
    }

    if (!messages.length) return;

    const business = await prisma.business.findFirst({
      where: { wa_phone_number_id: phoneNumberId },
      select: {
        id: true, name: true, business_type: true, status: true,
        currency: true, wa_phone_number_id: true, wa_access_token: true,
        ai_config: true, policies: true,
      },
    });
    if (!business) {
      console.warn(`No business found for phone_number_id: ${phoneNumberId}`);
      return;
    }
    if (business.status !== 'active') return;

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

    for (const waMsg of messages) {
      const contact = contacts.find(c => c.wa_id === waMsg.from) || {};
      const customerWaId = normalizePhone(waMsg.from);
      const profileName = contact.profile?.name;

      await markAsRead(phoneNumberId, accessToken, waMsg.id);

      let conversation = await getOrCreateConversation(business.id, customerWaId, profileName);

      const { created } = await saveInboundMessage(business.id, conversation.id, waMsg, customerWaId);
      if (!created) {
        console.log(`Duplicate webhook for meta_message_id=${waMsg.id} — skipping reprocess`);
        continue;
      }

      const now = new Date();
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          last_message_at: now,
          last_inbound_at: now,
          unread_count: { increment: 1 },
        },
      });

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

module.exports = { processInboundMessage };
