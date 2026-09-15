const express = require('express');
const router = express.Router();
const { authenticate, attachBusinessId } = require('../middleware/auth');
const prisma = require('../config/prisma');
const { sendTextMessage } = require('../services/whatsapp');
const replyBatcher = require('../services/replyBatcher');
const { decrypt } = require('../utils/tokenCrypto');
const { isWithinServiceWindow } = require('../utils/serviceWindow');
const sseEmitter = require('../utils/sseEmitter');
const jsonb = require('../db/jsonb');
const { patchJson, mergeObjectKey } = jsonb;
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

/**
 * Hand a conversation back to the bot. released_at tells the batcher that staff messages sent before
 * it no longer mean "a person is talking" (otherwise the bot stays quiet for 30 min after the last
 * one), and messages parked for staff go back to the batcher's queue: the sweeper answers them.
 */
async function releaseToBot(conversationId) {
  await patchJson('conversations', conversationId, 'metadata', {
    human_active_until: null,
    released_at: new Date().toISOString(),
  });
  await prisma.message.updateMany({
    where: { conversation_id: conversationId, direction: 'inbound', status: 'awaiting_staff' },
    data: { status: 'received' },
  });
}

// The lead's language, else the customer's newest text: an English prospect gets an English ack.
async function customerLanguage(conv) {
  const lead = conv.workflow_data?.lead || {};
  if (lead.language) return pickLanguage(lead, '');
  const newest = await prisma.message.findFirst({
    where: { conversation_id: conv.id, direction: 'inbound', text_body: { not: null } },
    orderBy: { created_at: 'desc' },
  });
  return pickLanguage(lead, newest?.text_body || '');
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

    // D21 / GPT-6 #6: the pause is stored BEFORE Graph. A bot run that passed its human check a moment
    // ago re-checks human_active_until in its pre-send statement, so it cannot talk over this message.
    // A failed send keeps the pause: the staff member is mid-conversation and will retry, and when the
    // pause expires the sweeper hands parked messages back to the bot (D22).
    await patchJson('conversations', conv.id, 'metadata', {
      human_active_until: new Date(Date.now() + HUMAN_ACTIVE_MS).toISOString(),
    });

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
    // returned as an error (staff would resend). awaiting_staff rows are now answered by this send.
    // `received` rows are left for the batcher, which re-checks human activity before it replies.
    // The pause is renewed from the send time, and a staff reply clears the bot's «failed 3 times» flag:
    // the customer has been answered.
    try {
      await patchJson('conversations', conv.id, 'metadata', {
        human_active_until: new Date(Date.now() + HUMAN_ACTIVE_MS).toISOString(),
        reply_failures: 0,
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
      // D26: a time the customer asked for while staff owned preferred_time is shown on the lead card until
      // staff set the time themselves; their edit answers it.
      if (parsed.patch.preferred_time !== undefined && conv.workflow_data?.requested_time_change) {
        await jsonb.patchJson('conversations', conv.id, 'workflow_data', {}, { remove: ['requested_time_change'] });
      }
    }

    const needsTeam = conv.workflow_data?.needs_team;
    let resolved = false;
    if (needsTeamResolved === true && needsTeam && !needsTeam.resolved_at) {
      // D27 / GPT-6 #13: resolved_at and pending → open in one conditional statement, only on the request
      // staff were looking at. A newer one the bot recorded meanwhile (a handoff replacing a quote) keeps
      // its pending status, and a flag the sweeper set inside the entry stays.
      resolved = await jsonb.resolveNeedsTeam(conv.id, { match: { reason: needsTeam.reason, at: needsTeam.at }, resolvedAt: now });
    }

    const conversation = await prisma.conversation.findUnique({ where: { id: conv.id } });
    res.json({ conversation, needs_team_resolved: resolved });
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

    // Atomic: two staff clicking «استلام» together must not both send the customer an ack.
    const { count } = await prisma.conversation.updateMany({
      where: { id: conv.id, business_id: req.businessId, status: { not: 'human_takeover' } },
      data: { status: 'human_takeover', ai_enabled: false, assigned_staff_id: req.user.id },
    });
    if (count !== 1) {
      const current = await findScopedConversation(req);
      if (current && current.assigned_staff_id === req.user.id) return res.json({ conversation: current, ack: 'skipped' });
      return res.status(409).json({ error: 'already_claimed' });
    }
    await patchJson('conversations', conv.id, 'workflow_data', { stage_before_takeover: conv.current_state ?? null });
    if (wd.needs_team) {
      // Merged into the stored entry, not spread from the copy read above: keeps a sweeper claim
      // (sla_note_sent_at) written in between.
      await mergeObjectKey('conversations', conv.id, 'workflow_data', 'needs_team',
        { claimed_at: now.toISOString(), claimed_by: req.user.id });
    }

    // The claim ack tells a waiting SHIFT customer a person has it. A failed ack never fails the claim.
    let ack = 'skipped';
    const business = await prisma.business.findUnique({ where: { id: req.businessId } });
    if (business?.business_type === 'shift') {
      // D21 / GPT-6 #6: the takeover above and this pause are stored before any Graph call, so a bot run
      // that is about to send sees them in its pre-send check and stops.
      await patchJson('conversations', conv.id, 'metadata', {
        human_active_until: new Date(now.getTime() + HUMAN_ACTIVE_MS).toISOString(),
      });
    }
    if (business?.business_type === 'shift' && isWithinServiceWindow(conv.last_inbound_at)) {
      ack = 'failed';
      try {
        let accessToken = null;
        try {
          accessToken = decrypt(business.wa_access_token) || null;
        } catch (e) {
          accessToken = null;
        }
        if (!accessToken) throw new Error('WhatsApp token not configured');
        const text = claimAck({ staffName: req.user.name, lang: await customerLanguage(conv) });
        // D17: an intent row first, its id echoed by status webhooks. No human guard: the conversation is
        // ours now, which is exactly what the guard refuses. The row is the staff member's message from
        // the start (Inbox attribution, and it ends the customer's silence for the awaiting note).
        const dispatch = await replyBatcher.dispatchIntent({
          business, conversation: conv, token: accessToken, kind: 'claim_ack', sentByUserId: req.user.id,
          parts: [{ type: 'text', text }], batchIds: [], precheck: { humanGuard: false }, now,
        });
        if (dispatch.outcome === 'sent' || dispatch.outcome === 'ambiguous') {
          // `ambiguous`: Graph may have it; the status webhook or the reconcile sweep settles the intent.
          ack = dispatch.outcome;
        } else {
          console.warn('[inbox] claim ack not sent:', conv.id, dispatch.outcome, dispatch.parts[0] && dispatch.parts[0].reason);
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
    await releaseToBot(conv.id);

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

    await prisma.conversation.update({
      where: { id: req.params.id },
      data: { ai_enabled: true, status: 'open', assigned_staff_id: null },
    });
    await releaseToBot(req.params.id);
    const conv = await prisma.conversation.findUnique({ where: { id: req.params.id } });
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
