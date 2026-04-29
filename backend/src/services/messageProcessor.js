/**
 * Message Processor
 * Handles inbound WhatsApp messages: saves to DB, runs workflow, sends reply.
 */

const Business = require('../models/Business');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Order = require('../models/Order');
const { sendTextMessage, markAsRead, normalizePhone } = require('../services/whatsapp');
const { decrypt } = require('../utils/tokenCrypto');
const { processRestaurantMessage } = require('../workflows/restaurant');

/**
 * Get or create conversation for a customer
 */
async function getOrCreateConversation(businessId, customerWaId, profileName) {
  let conv = await Conversation.findOne({ business_id: businessId, customer_wa_id: customerWaId });
  if (!conv) {
    conv = await Conversation.create({
      business_id: businessId,
      customer_wa_id: customerWaId,
      profile_name: profileName,
      status: 'open',
      ai_enabled: true,
    });
  } else if (profileName && !conv.profile_name) {
    conv.profile_name = profileName;
    await conv.save();
  }
  return conv;
}

/**
 * Save inbound message to DB (idempotent by meta_message_id)
 */
async function saveInboundMessage(businessId, conversationId, waMsg, senderWaId) {
  const existing = await Message.findOne({ meta_message_id: waMsg.id });
  if (existing) return existing;

  const type = waMsg.type || 'text';
  const msg = await Message.create({
    business_id: businessId,
    conversation_id: conversationId,
    meta_message_id: waMsg.id,
    direction: 'inbound',
    message_type: type,
    text_body: waMsg.text?.body || waMsg.interactive?.button_reply?.title || waMsg.interactive?.list_reply?.title,
    media_id: waMsg.image?.id || waMsg.audio?.id || waMsg.video?.id || waMsg.document?.id,
    media_mime_type: waMsg.image?.mime_type || waMsg.audio?.mime_type,
    location: waMsg.location,
    interactive_reply: waMsg.interactive,
    sender_wa_id: senderWaId,
    status: 'delivered',
    raw_payload: waMsg,
  });

  return msg;
}

/**
 * Save outbound message to DB
 */
async function saveOutboundMessage(businessId, conversationId, text, metaResponse) {
  return Message.create({
    business_id: businessId,
    conversation_id: conversationId,
    meta_message_id: metaResponse?.messages?.[0]?.id,
    direction: 'outbound',
    message_type: 'text',
    text_body: text,
    status: 'sent',
    is_ai_generated: true,
  });
}

/**
 * Create confirmed order from workflow result
 */
async function createConfirmedOrder(business, conversation, orderData) {
  const order = await Order.create({
    business_id: business._id,
    conversation_id: conversation._id,
    customer_wa_id: conversation.customer_wa_id,
    customer_name: orderData.customer_name || conversation.profile_name,
    customer_phone: conversation.customer_wa_id,
    items: orderData.items,
    subtotal: orderData.subtotal,
    delivery_fee: orderData.delivery_fee,
    total: orderData.total,
    order_type: orderData.order_type,
    address: orderData.address,
    notes: orderData.notes,
    payment_method: orderData.payment_method || 'cash',
    status: 'confirmed',
    confirmed_at: new Date(),
    status_history: [{ status: 'confirmed', changed_at: new Date() }],
  });
  return order;
}

/**
 * Main message processor - called async after webhook 200 OK
 */
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
      await Message.findOneAndUpdate(
        { meta_message_id: status.id },
        { status: status.status },
      ).catch(() => {});
    }

    if (!messages.length) return;

    // Find business by phoneNumberId
    const business = await Business.findOne({ wa_phone_number_id: phoneNumberId }).select('+wa_access_token');
    if (!business) {
      console.warn(`No business found for phone_number_id: ${phoneNumberId}`);
      return;
    }
    if (business.status !== 'active') return;

    // Decrypt token for use in this processing cycle only
    let accessToken;
    try {
      accessToken = decrypt(business.wa_access_token);
    } catch (decErr) {
      console.error(`Failed to decrypt token for business ${business._id}:`, decErr.message);
      return;
    }
    if (!accessToken) {
      console.warn(`Business ${business._id} has no WhatsApp access token configured`);
      return;
    }

    for (const waMsg of messages) {
      const contact = contacts.find(c => c.wa_id === waMsg.from) || {};
      const customerWaId = normalizePhone(waMsg.from);
      const profileName = contact.profile?.name;

      // Mark read
      await markAsRead(phoneNumberId, accessToken, waMsg.id);

      // Get/create conversation
      const conversation = await getOrCreateConversation(business._id, customerWaId, profileName);

      // Save inbound message
      await saveInboundMessage(business._id, conversation._id, waMsg, customerWaId);

      // Update conversation metadata
      conversation.last_message_at = new Date();
      conversation.unread_count = (conversation.unread_count || 0) + 1;

      // If human takeover - don't auto-reply
      if (!conversation.ai_enabled || conversation.status === 'human_takeover') {
        await conversation.save();
        continue;
      }

      // Get message text
      const customerText = waMsg.text?.body
        || waMsg.interactive?.button_reply?.title
        || waMsg.interactive?.list_reply?.title
        || '';

      if (!customerText) {
        await conversation.save();
        continue;
      }

      // Run workflow based on business type
      let workflowResult = null;
      if (business.business_type === 'restaurant') {
        workflowResult = await processRestaurantMessage(business, conversation, customerText);
      } else {
        // Generic fallback for non-restaurant
        workflowResult = {
          reply: business.ai_config?.greeting_message || 'كيف أقدر أساعدك؟',
          stateUpdate: {},
          action: 'NONE',
        };
      }

      // Apply state updates
      if (workflowResult.stateUpdate) {
        Object.assign(conversation, workflowResult.stateUpdate);
        if (workflowResult.stateUpdate.workflow_data) {
          conversation.workflow_data = workflowResult.stateUpdate.workflow_data;
          conversation.markModified('workflow_data');
        }
      }

      await conversation.save();

      // Create order if confirmed
      if (workflowResult.action === 'CONFIRM_ORDER' && workflowResult.orderData) {
        await createConfirmedOrder(business, conversation, workflowResult.orderData).catch(console.error);
      }

      // Send reply
      if (workflowResult.reply) {
        try {
          const metaResponse = await sendTextMessage(
            phoneNumberId,
            accessToken,
            customerWaId,
            workflowResult.reply,
          );
          await saveOutboundMessage(business._id, conversation._id, workflowResult.reply, metaResponse);
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
