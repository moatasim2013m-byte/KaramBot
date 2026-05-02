const express = require('express');
const router = express.Router();
const { authenticate, attachBusinessId } = require('../middleware/auth');
const prisma = require('../config/prisma');
const { sendTextMessage } = require('../services/whatsapp');
const { decrypt } = require('../utils/tokenCrypto');
const { isWithinServiceWindow } = require('../utils/serviceWindow');
const sseEmitter = require('../utils/sseEmitter');

const MAX_SEARCH_LEN = 80;

router.use(authenticate, attachBusinessId);

// GET /api/inbox/conversations
router.get('/conversations', async (req, res) => {
  try {
    const { status, search, page = 1, limit = 30, date_from, date_to } = req.query;
    const where = { business_id: req.businessId };
    if (status) where.status = status;
    if (typeof search === 'string') {
      const trimmed = search.trim().slice(0, MAX_SEARCH_LEN);
      if (trimmed) {
        where.OR = [
          { profile_name: { contains: trimmed, mode: 'insensitive' } },
          { customer_wa_id: { contains: trimmed } },
        ];
      }
    }
    if (date_from || date_to) {
      where.last_message_at = {};
      if (date_from) where.last_message_at.gte = new Date(date_from);
      if (date_to) where.last_message_at.lte = new Date(date_to);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [convs, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { last_message_at: 'desc' },
        skip,
        take: parseInt(limit),
        include: {
          assigned_staff: { select: { name: true } },
        },
      }),
      prisma.conversation.count({ where }),
    ]);

    res.json({ conversations: convs, total, page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inbox/conversations/:id/messages
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const { before, limit = 50 } = req.query;
    const where = { conversation_id: conv.id };
    if (before) where.created_at = { lt: new Date(before) };

    const messages = await prisma.message.findMany({
      where,
      orderBy: { created_at: 'asc' },
      take: parseInt(limit),
      include: { sent_by_user: { select: { name: true } } },
    });

    await prisma.conversation.update({
      where: { id: conv.id },
      data: { unread_count: 0 },
    });

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

    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    if (!isWithinServiceWindow(conv.last_inbound_at)) {
      return res.status(409).json({
        error: 'Cannot send free-form WhatsApp message outside the 24-hour service window. Use an approved template message.',
      });
    }

    const business = await prisma.business.findUnique({
      where: { id: req.businessId },
      select: { id: true, wa_phone_number_id: true, wa_access_token: true },
    });
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

    const msg = await prisma.message.create({
      data: {
        business_id: req.businessId,
        conversation_id: conv.id,
        meta_message_id: metaResponse?.messages?.[0]?.id || null,
        direction: 'outbound',
        message_type: 'text',
        text_body: text,
        status: 'sent',
        sent_by_user_id: req.user.id,
        is_ai_generated: false,
      },
    });

    await prisma.conversation.update({
      where: { id: conv.id },
      data: { last_message_at: new Date() },
    });

    res.json({ message: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inbox/conversations/:id/takeover
router.post('/conversations/:id/takeover', async (req, res) => {
  try {
    const existing = await prisma.conversation.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!existing) return res.status(404).json({ error: 'Conversation not found' });

    const conv = await prisma.conversation.update({
      where: { id: req.params.id },
      data: {
        ai_enabled: false,
        status: 'human_takeover',
        assigned_staff_id: req.user.id,
      },
    });
    res.json({ conversation: conv });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inbox/conversations/:id/enable-ai
router.post('/conversations/:id/enable-ai', async (req, res) => {
  try {
    const existing = await prisma.conversation.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!existing) return res.status(404).json({ error: 'Conversation not found' });

    const conv = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { ai_enabled: true, status: 'open', assigned_staff_id: null },
    });
    res.json({ conversation: conv });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inbox/conversations/:id/resolve
router.post('/conversations/:id/resolve', async (req, res) => {
  try {
    const existing = await prisma.conversation.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!existing) return res.status(404).json({ error: 'Conversation not found' });

    const conv = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { status: 'resolved' },
    });
    res.json({ conversation: conv });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inbox/stats
router.get('/stats', async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [open, humanTakeover, pending, todayOrders] = await Promise.all([
      prisma.conversation.count({ where: { business_id: req.businessId, status: 'open' } }),
      prisma.conversation.count({ where: { business_id: req.businessId, status: 'human_takeover' } }),
      prisma.conversation.count({ where: { business_id: req.businessId, status: 'pending' } }),
      prisma.order.count({
        where: { business_id: req.businessId, created_at: { gte: todayStart } },
      }),
    ]);
    res.json({ open, human_takeover: humanTakeover, pending, today_orders: todayOrders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inbox/updates - SSE endpoint with EventEmitter for real-time push
// Accepts auth token via ?token= query param (EventSource doesn't support headers)
router.get('/updates', async (req, res) => {
  // Authenticate via query param token when Authorization header is absent
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }

  // Run auth middleware inline
  const jwt = require('jsonwebtoken');
  const prisma = require('../config/prisma');
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, name: true, email: true, role: true, business_id: true, active: true },
    });
    if (!user || !user.active) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;

    // attachBusinessId logic
    if (user.role !== 'platform_admin' && user.business_id) {
      req.businessId = user.business_id;
    } else if (req.query.businessId) {
      req.businessId = req.query.businessId;
    }
    if (user.role === 'platform_admin' && !req.businessId) {
      return res.status(400).json({ error: 'platform_admin must supply businessId' });
    }
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Heartbeat every 30s to keep connection alive through proxies
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000);

  const onEvent = async (event) => {
    try {
      if (event.type === 'new_message') {
        const [open, humanTakeover] = await Promise.all([
          prisma.conversation.count({ where: { business_id: req.businessId, status: 'open' } }),
          prisma.conversation.count({ where: { business_id: req.businessId, status: 'human_takeover' } }),
        ]);
        send({ type: 'stats', data: { open, human_takeover: humanTakeover } });
        send({ type: 'new_message', conversationId: event.conversationId });
      }
    } catch { /* ignore errors in SSE stream */ }
  };

  const channel = `business:${req.businessId}`;
  sseEmitter.on(channel, onEvent);

  // Send initial stats immediately on connect
  prisma.conversation.count({ where: { business_id: req.businessId, status: 'open' } })
    .then(async (open) => {
      const humanTakeover = await prisma.conversation.count({ where: { business_id: req.businessId, status: 'human_takeover' } });
      send({ type: 'stats', data: { open, human_takeover: humanTakeover } });
    }).catch(() => {});

  req.on('close', () => {
    clearInterval(heartbeat);
    sseEmitter.off(channel, onEvent);
  });
});

module.exports = router;
