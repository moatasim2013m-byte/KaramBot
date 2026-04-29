const express = require('express');
const router = express.Router();
const { authenticate, attachBusinessId } = require('../middleware/auth');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Order = require('../models/Order');
const Business = require('../models/Business');
const { sendTextMessage } = require('../services/whatsapp');
const { decrypt } = require('../utils/tokenCrypto');

router.use(authenticate, attachBusinessId);

// GET /api/inbox/conversations
router.get('/conversations', async (req, res) => {
  try {
    const { status, search, page = 1, limit = 30 } = req.query;
    const query = { business_id: req.businessId };
    if (status) query.status = status;
    if (search) query.profile_name = new RegExp(search, 'i');

    const convs = await Conversation.find(query)
      .sort({ last_message_at: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('assigned_staff_id', 'name');

    const total = await Conversation.countDocuments(query);
    res.json({ conversations: convs, total, page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inbox/conversations/:id/messages
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const conv = await Conversation.findOne({ _id: req.params.id, business_id: req.businessId });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const { before, limit = 50 } = req.query;
    const query = { conversation_id: conv._id };
    if (before) query.created_at = { $lt: new Date(before) };

    const messages = await Message.find(query)
      .sort({ created_at: 1 })
      .limit(parseInt(limit))
      .populate('sent_by_user_id', 'name');

    // Reset unread count
    conv.unread_count = 0;
    await conv.save();

    res.json({ conversation: conv, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inbox/conversations/:id/send - staff manual reply
router.post('/conversations/:id/send', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });

    const conv = await Conversation.findOne({ _id: req.params.id, business_id: req.businessId });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const business = await Business.findById(req.businessId).select('+wa_access_token');
    if (!business) return res.status(404).json({ error: 'Business not found' });

    let accessToken;
    try {
      accessToken = decrypt(business.wa_access_token);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to decrypt WhatsApp token. Re-save via /token endpoint.' });
    }
    if (!accessToken) return res.status(500).json({ error: 'WhatsApp token not configured for this business' });

    const metaResponse = await sendTextMessage(
      business.wa_phone_number_id,
      accessToken,
      conv.customer_wa_id,
      text,
    );

    const msg = await Message.create({
      business_id: req.businessId,
      conversation_id: conv._id,
      meta_message_id: metaResponse?.messages?.[0]?.id,
      direction: 'outbound',
      message_type: 'text',
      text_body: text,
      status: 'sent',
      sent_by_user_id: req.user._id,
      is_ai_generated: false,
    });

    conv.last_message_at = new Date();
    await conv.save();

    res.json({ message: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inbox/conversations/:id/takeover
router.post('/conversations/:id/takeover', async (req, res) => {
  try {
    const conv = await Conversation.findOneAndUpdate(
      { _id: req.params.id, business_id: req.businessId },
      { ai_enabled: false, status: 'human_takeover', assigned_staff_id: req.user._id },
      { new: true },
    );
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ conversation: conv });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inbox/conversations/:id/enable-ai
router.post('/conversations/:id/enable-ai', async (req, res) => {
  try {
    const conv = await Conversation.findOneAndUpdate(
      { _id: req.params.id, business_id: req.businessId },
      { ai_enabled: true, status: 'open', assigned_staff_id: null },
      { new: true },
    );
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ conversation: conv });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inbox/conversations/:id/resolve
router.post('/conversations/:id/resolve', async (req, res) => {
  try {
    const conv = await Conversation.findOneAndUpdate(
      { _id: req.params.id, business_id: req.businessId },
      { status: 'resolved' },
      { new: true },
    );
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ conversation: conv });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inbox/stats
router.get('/stats', async (req, res) => {
  try {
    const [open, humanTakeover, pending, todayOrders] = await Promise.all([
      Conversation.countDocuments({ business_id: req.businessId, status: 'open' }),
      Conversation.countDocuments({ business_id: req.businessId, status: 'human_takeover' }),
      Conversation.countDocuments({ business_id: req.businessId, status: 'pending' }),
      Order.countDocuments({
        business_id: req.businessId,
        created_at: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      }),
    ]);
    res.json({ open, human_takeover: humanTakeover, pending, today_orders: todayOrders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inbox/updates - SSE polling endpoint
router.get('/updates', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const interval = setInterval(async () => {
    try {
      const stats = await getStats(req.businessId);
      send({ type: 'stats', data: stats });
    } catch {}
  }, 5000);

  req.on('close', () => clearInterval(interval));
});

async function getStats(businessId) {
  const [open, humanTakeover] = await Promise.all([
    Conversation.countDocuments({ business_id: businessId, status: 'open' }),
    Conversation.countDocuments({ business_id: businessId, status: 'human_takeover' }),
  ]);
  return { open, human_takeover: humanTakeover };
}

module.exports = router;
