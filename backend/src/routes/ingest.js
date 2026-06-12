/**
 * Ingest API
 * Lets an external automation (e.g. Make + Voiceflow) report the replies it
 * sends, so conversations in the Inbox show both sides and confirmed orders
 * are tracked in KaramBot even when the bot brain lives outside.
 *
 * Auth: shared secret in the `x-ingest-key` header (INGEST_API_KEY env var).
 */

const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const sseEmitter = require('../utils/sseEmitter');

function requireIngestKey(req, res, next) {
  const configured = process.env.INGEST_API_KEY;
  if (!configured) {
    return res.status(503).json({ error: 'Ingest API not configured (INGEST_API_KEY missing)' });
  }
  if (req.headers['x-ingest-key'] !== configured) {
    return res.status(401).json({ error: 'Invalid ingest key' });
  }
  next();
}

// POST /api/ingest/outbound
// Body: { phone_number_id, to, text, meta_message_id? }
router.post('/outbound', requireIngestKey, async (req, res) => {
  try {
    const { phone_number_id, to, text, meta_message_id } = req.body;
    if (!phone_number_id || !to || !text) {
      return res.status(400).json({ error: 'phone_number_id, to and text are required' });
    }

    const business = await prisma.business.findFirst({
      where: { wa_phone_number_id: String(phone_number_id) },
      select: { id: true, policies: true },
    });
    if (!business) {
      return res.status(404).json({ error: 'No business found for this phone_number_id' });
    }

    const customerWaId = String(to).replace(/\D/g, '');
    let conversation = await prisma.conversation.findFirst({
      where: { business_id: business.id, customer_wa_id: customerWaId },
    });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          business_id: business.id,
          customer_wa_id: customerWaId,
          status: 'open',
          ai_enabled: true,
        },
      });
    }

    let message;
    try {
      message = await prisma.message.create({
        data: {
          business_id: business.id,
          conversation_id: conversation.id,
          meta_message_id: meta_message_id || null,
          direction: 'outbound',
          message_type: 'text',
          text_body: text,
          status: 'sent',
          is_ai_generated: true,
        },
      });
    } catch (err) {
      // Duplicate delivery from the automation — idempotent success
      if (err && err.code === 'P2002') {
        return res.json({ success: true, duplicate: true });
      }
      throw err;
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { last_message_at: new Date() },
    });

    // Order tracking: the external bot signals a confirmed order with a
    // keyword in its reply (Voiceflow uses "طلبك اتأكد"). Configurable per
    // business via policies.order_confirm_keyword.
    let order = null;
    const confirmKeyword = business.policies?.order_confirm_keyword || 'طلبك اتأكد';
    if (text.includes(confirmKeyword)) {
      order = await prisma.order.create({
        data: {
          business_id: business.id,
          conversation_id: conversation.id,
          customer_wa_id: customerWaId,
          customer_name: conversation.profile_name || null,
          customer_phone: customerWaId,
          items: [],
          notes: text,
          status: 'confirmed',
          confirmed_at: new Date(),
          status_history: {
            create: [{ status: 'confirmed', changed_at: new Date(), changed_by: null }],
          },
        },
      });
    }

    sseEmitter.emit(`business:${business.id}`, {
      type: 'new_message',
      conversationId: conversation.id,
      businessId: business.id,
    });

    res.json({ success: true, message_id: message.id, order_id: order ? order.id : null });
  } catch (err) {
    console.error('ingest/outbound error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
