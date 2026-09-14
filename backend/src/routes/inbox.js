const express = require('express');
const router = express.Router();
const { authenticate, attachBusinessId } = require('../middleware/auth');
const prisma = require('../config/prisma');
const { sendTextMessage, sendText } = require('../services/whatsapp');
const { decrypt } = require('../utils/tokenCrypto');
const { isWithinServiceWindow } = require('../utils/serviceWindow');
const sseEmitter = require('../utils/sseEmitter');
const { patchJson } = require('../db/jsonb');
const { saveLead } = require('../workflows/shift/lead');
const { claimAck, pickLanguage } = require('../workflows/shift/acks');
const { STAGES } = require('../workflows/shift/actions');

const MAX_SEARCH_LEN = 80;

// A staff message (or claim ack) keeps the bot quiet this long, so it never talks over a person.
const HUMAN_ACTIVE_MS = 30 * 60 * 1000;

// Lead fields staff may edit from the Inbox card. `need` is a list; `preferred_time` is free text.
const EDITABLE_LEAD_STRINGS = ['name', 'business_name', 'sector', 'sector_text', 'city', 'budget_note', 'language', 'interest'];
const EDITABLE_LEAD_FIELDS = [...EDITABLE_LEAD_STRINGS, 'need', 'preferred_time'];

router.use(authenticate, attachBusinessId);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function findScopedConversation(req) {
  return prisma.conversation.findFirst({
    where: { id: req.params.id, business_id: req.businessId },
  });
}

async function countStats(businessId) {
  const [open, humanTakeover, pending, awaitingStaff] = await Promise.all([
    prisma.conversation.count({ where: { business_id: businessId, status: 'open' } }),
    prisma.conversation.count({ where: { business_id: businessId, status: 'human_takeover' } }),
    prisma.conversation.count({ where: { business_id: businessId, status: 'pending' } }),
    prisma.message.count({ where: { business_id: businessId, direction: 'inbound', status: 'awaiting_staff' } }),
  ]);
  return { open, human_takeover: humanTakeover, pending, awaiting_staff: awaitingStaff };
}

/**
 * Validate and shape a staff lead edit. Returns { patch } or { field } naming the first bad key.
 * `preferred_time` arrives as the text staff typed; the lead stores it as {text}.
 */
function parseLeadEdit(lead) {
  const patch = {};
  for (const [key, value] of Object.entries(lead)) {
    if (!EDITABLE_LEAD_FIELDS.includes(key)) return { field: key };
    if (key === 'need') {
      const list = Array.isArray(value) ? value : [value];
      if (!list.every((v) => typeof v === 'string')) return { field: key };
      patch.need = list;
    } else if (key === 'preferred_time') {
      if (typeof value !== 'string') return { field: key };
      patch.preferred_time = { text: value };
    } else {
      if (typeof value !== 'string') return { field: key };
      patch[key] = value;
    }
  }
  return { patch };
}

// GET /api/inbox/conversations
router.get('/conversations', async (req, res) => {
  try {
    const { status, search, page = 1, limit = 30, date_from, date_to, needs_team, stage } = req.query;
    const where = { business_id: req.businessId };
    if (status) where.status = status;
    // «يحتاج الفريق» filter: every needs_team event moves the conversation to pending.
    if (needs_team === '1' || needs_team === 'true') where.status = 'pending';
    if (stage) {
      if (!STAGES.includes(stage)) return res.status(400).json({ error: 'invalid stage' });
      where.current_state = stage;
    }
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

    // The «بانتظار الموظف» badge is decoration: a failed count must not hide the whole list.
    const awaitingByConv = new Map();
    if (convs.length) {
      try {
        const awaiting = await prisma.message.findMany({
          where: { conversation_id: { in: convs.map((c) => c.id) }, direction: 'inbound', status: 'awaiting_staff' },
          select: { conversation_id: true },
        });
        for (const row of awaiting) {
          awaitingByConv.set(row.conversation_id, (awaitingByConv.get(row.conversation_id) || 0) + 1);
        }
      } catch (err) {
        console.warn('[inbox] awaiting_staff count failed:', err.message);
      }
    }

    // Array.prototype.sort is stable, so the last_message_at order survives inside each group.
    const conversations = convs
      .map((c) => ({ ...c, awaiting_staff: awaitingByConv.get(c.id) || 0 }))
      .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));

    res.json({ conversations, total, page: parseInt(page) });
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

    // The message is already on the customer's phone, so bookkeeping failures are logged, never
    // returned as an error (staff would resend). human_active_until keeps the SHIFT bot quiet while
    // staff are talking; awaiting_staff rows are now answered by this send. `received` rows are left
    // for the batcher, which re-checks human activity before it replies.
    try {
      await patchJson('conversations', conv.id, 'metadata', {
        human_active_until: new Date(Date.now() + HUMAN_ACTIVE_MS).toISOString(),
      });
      await prisma.message.updateMany({
        where: { conversation_id: conv.id, direction: 'inbound', status: 'awaiting_staff' },
        data: { status: 'answered' },
      });
    } catch (err) {
      console.error('[inbox] post-send bookkeeping failed:', conv.id, err.message);
    }

    res.json({ message: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/inbox/conversations/:id/lead - staff edits the lead card / marks the team request done
router.patch('/conversations/:id/lead', async (req, res) => {
  try {
    const { lead, version, needs_team_resolved: needsTeamResolved } = req.body || {};
    if (lead !== undefined && !isPlainObject(lead)) {
      return res.status(400).json({ error: 'invalid field', field: 'lead' });
    }
    if (version !== undefined && !Number.isInteger(version)) {
      return res.status(400).json({ error: 'invalid field', field: 'version' });
    }
    const parsed = lead ? parseLeadEdit(lead) : { patch: {} };
    if (parsed.field) return res.status(400).json({ error: 'invalid field', field: parsed.field });

    const conv = await findScopedConversation(req);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const now = new Date().toISOString();

    if (Object.keys(parsed.patch).length) {
      // Staff edits are version-checked: a concurrent bot write returns 409 and the card reloads,
      // instead of one side silently overwriting the other.
      const options = version === undefined ? {} : { expectedVersion: version };
      const r = await saveLead(conv.id, parsed.patch, { source: 'staff', msgId: null, at: now, inboundText: '' }, options);
      if (r.conflict || !r.ok) return res.status(409).json({ error: 'version_conflict', lead: r.lead });
    }

    const needsTeam = conv.workflow_data?.needs_team;
    if (needsTeamResolved === true && needsTeam) {
      await patchJson('conversations', conv.id, 'workflow_data', {
        needs_team: { ...needsTeam, resolved_at: needsTeam.resolved_at || now },
      });
      if (conv.status === 'pending') {
        await prisma.conversation.update({ where: { id: conv.id }, data: { status: 'open' } });
      }
    }

    const conversation = await prisma.conversation.findUnique({ where: { id: conv.id } });
    res.json({ conversation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inbox/conversations/:id/claim - a staff member takes the conversation from the bot
router.post('/conversations/:id/claim', async (req, res) => {
  try {
    const conv = await findScopedConversation(req);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    if (conv.status === 'human_takeover') {
      if (conv.assigned_staff_id !== req.user.id) return res.status(409).json({ error: 'already_claimed' });
      // Idempotent: a double click must not send the customer a second «استلم طلبك».
      return res.json({ conversation: conv, ack: 'skipped' });
    }

    const wd = conv.workflow_data || {};
    const now = new Date();

    await prisma.conversation.update({
      where: { id: conv.id },
      data: { status: 'human_takeover', ai_enabled: false, assigned_staff_id: req.user.id },
    });
    await patchJson('conversations', conv.id, 'workflow_data', {
      stage_before_takeover: conv.current_state ?? null,
      ...(wd.needs_team && {
        needs_team: { ...wd.needs_team, claimed_at: now.toISOString(), claimed_by: req.user.id },
      }),
    });

    // The claim ack tells a waiting SHIFT customer a person has it. A failed ack never fails the claim.
    let ack = 'skipped';
    const business = await prisma.business.findUnique({ where: { id: req.businessId } });
    if (business?.business_type === 'shift' && isWithinServiceWindow(conv.last_inbound_at)) {
      ack = 'failed';
      try {
        const accessToken = decrypt(business.wa_access_token);
        if (!accessToken) throw new Error('WhatsApp token not configured');
        const text = claimAck({ staffName: req.user.name, lang: pickLanguage(wd.lead || {}, '') });
        const sent = await sendText(business.wa_phone_number_id, accessToken, conv.customer_wa_id, text);
        if (sent.ok) {
          await prisma.message.create({
            data: {
              business_id: req.businessId,
              conversation_id: conv.id,
              direction: 'outbound',
              message_type: 'text',
              text_body: text,
              status: 'sent',
              meta_message_id: sent.id,
              sent_by_user_id: req.user.id,
              is_ai_generated: false,
              raw_payload: { kind: 'claim_ack' },
            },
          });
          await patchJson('conversations', conv.id, 'metadata', {
            human_active_until: new Date(now.getTime() + HUMAN_ACTIVE_MS).toISOString(),
          });
          ack = 'sent';
        } else {
          console.warn('[inbox] claim ack not sent:', conv.id, sent.reason, sent.error);
        }
      } catch (err) {
        console.error('[inbox] claim ack failed:', conv.id, err.message);
      }
    }

    const conversation = await prisma.conversation.findUnique({ where: { id: conv.id } });
    res.json({ conversation, ack });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inbox/conversations/:id/release - hand the conversation back to the bot
router.post('/conversations/:id/release', async (req, res) => {
  try {
    const conv = await findScopedConversation(req);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const wd = conv.workflow_data || {};
    await prisma.conversation.update({
      where: { id: conv.id },
      data: {
        status: 'open',
        ai_enabled: true,
        assigned_staff_id: null,
        current_state: wd.stage_before_takeover ?? conv.current_state,
      },
    });
    await patchJson('conversations', conv.id, 'workflow_data', { stage_before_takeover: null });
    await patchJson('conversations', conv.id, 'metadata', { human_active_until: null });

    const conversation = await prisma.conversation.findUnique({ where: { id: conv.id } });
    res.json({ conversation });
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

    const [stats, todayOrders] = await Promise.all([
      countStats(req.businessId),
      prisma.order.count({
        where: { business_id: req.businessId, created_at: { gte: todayStart } },
      }),
    ]);
    res.json({ ...stats, today_orders: todayOrders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inbox/updates - SSE endpoint with EventEmitter for real-time push
router.get('/updates', async (req, res) => {
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
        send({ type: 'stats', data: await countStats(req.businessId) });
        send({ type: 'new_message', conversationId: event.conversationId });
      }
    } catch { /* ignore errors in SSE stream */ }
  };

  const channel = `business:${req.businessId}`;
  sseEmitter.on(channel, onEvent);

  // Send initial stats immediately on connect
  countStats(req.businessId)
    .then((stats) => send({ type: 'stats', data: stats }))
    .catch(() => {});

  req.on('close', () => {
    clearInterval(heartbeat);
    sseEmitter.off(channel, onEvent);
  });
});

module.exports = router;
