'use strict';

/**
 * Inbox v2 — the API behind the inbox ported from Peekaboo (docs/inbox-v2-port-plan.md).
 *
 * Mounted at /api/inbox/v2 beside the current /api/inbox, which keeps serving today's page until the
 * new one replaces it.
 *
 * Every route is keyed by conversation id and every query carries req.businessId (attachBusinessId:
 * an owner gets their own business; platform_admin must name one). The Peekaboo inbox this comes from
 * had no tenant scoping at all — it keyed everything by phone number — so nothing here is copied as is.
 *
 * Two of Peekaboo's own lessons are kept on purpose:
 * - Reading a thread never marks it read. Peekaboo found that a thread left open in a background tab
 *   silently "read" everything that arrived; KaramBot's /api/inbox has that bug. Reads are explicit
 *   (POST /conversations/:id/read), sent by the page only while it is visible.
 * - The thread opens on its newest page (fixed in /api/inbox by #48 too).
 */

const express = require('express');
const router = express.Router();
const { authenticate, attachBusinessId } = require('../middleware/auth');
const prisma = require('../config/prisma');

router.use(authenticate, attachBusinessId);

// ─── limits ───────────────────────────────────────────────────────────────────

const LIST_MAX = 50;
const THREAD_MAX = 100;
const SEARCH_MAX = 80;
const LABEL_MAX = 30;
const LABELS_PER_CONVERSATION = 10;
const NOTES_MAX = 2000;
const CUSTOM_LABEL_MAX = 60;
const PREVIEW_MAX = 120;
const SNOOZE_MAX_DAYS = 90;

const STATUSES = ['open', 'pending', 'resolved', 'human_takeover'];
const FILTERS = ['all', 'unread', 'mine', 'unassigned', 'attention', 'snoozed', 'resolved'];

// ─── helpers ──────────────────────────────────────────────────────────────────

function clampInt(value, fallback, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function validDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function findScoped(req) {
  return prisma.conversation.findFirst({ where: { id: req.params.id, business_id: req.businessId } });
}

/** Run `fn` on the caller's conversation, or answer 404 — the same answer for "not yours" as for "absent". */
function withConversation(fn) {
  return async (req, res) => {
    try {
      const conv = await findScoped(req);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });
      return await fn(req, res, conv);
    } catch (err) {
      console.error(`[inboxV2] ${req.method} ${req.path} failed: ${err.message}`);
      return res.status(500).json({ error: 'Inbox request failed' });
    }
  };
}

function preview(message) {
  if (!message) return null;
  const text = typeof message.text_body === 'string' ? message.text_body.replace(/\s+/g, ' ').trim() : '';
  return {
    text: text.slice(0, PREVIEW_MAX),
    type: message.message_type || 'text',
    direction: message.direction,
    at: message.created_at,
    is_ai_generated: !!message.is_ai_generated,
  };
}

/**
 * Normalise labels the way staff type them: trimmed, single-spaced, case-insensitively unique, short.
 * Returns null for anything that is not a list, so a bad request is refused rather than half-applied.
 */
function normalizeLabels(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const label = raw.replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= LABELS_PER_CONVERSATION) break;
  }
  return out;
}

/** The where clause for a list filter. Snoozed conversations stay out of every view but their own. */
function filterWhere(filter, { businessId, userId, now }) {
  const notSnoozed = { OR: [{ snoozed_until: null }, { snoozed_until: { lte: now } }] };
  switch (filter) {
    case 'unread':
      return { AND: [{ business_id: businessId, unread_count: { gt: 0 } }, notSnoozed] };
    case 'mine':
      return { AND: [{ business_id: businessId, assigned_staff_id: userId }, notSnoozed] };
    case 'unassigned':
      return { AND: [{ business_id: businessId, assigned_staff_id: null, status: { not: 'resolved' } }, notSnoozed] };
    case 'attention':
      return { AND: [{ business_id: businessId, needs_attention: true }, notSnoozed] };
    case 'snoozed':
      return { business_id: businessId, snoozed_until: { gt: now } };
    case 'resolved':
      return { business_id: businessId, status: 'resolved' };
    case 'all':
    default:
      return { AND: [{ business_id: businessId, status: { not: 'resolved' } }, notSnoozed] };
  }
}

async function latestMessages(conversationIds) {
  // One small indexed read per conversation: a page is at most LIST_MAX rows, and reading every
  // message of every listed thread to find the newest would be far worse on a 300-message thread.
  const rows = await Promise.all(conversationIds.map((id) => prisma.message.findFirst({
    where: { conversation_id: id },
    orderBy: { created_at: 'desc' },
  })));
  return new Map(conversationIds.map((id, i) => [id, rows[i]]));
}

function shapeConversation(conv, last) {
  return {
    id: conv.id,
    customer_wa_id: conv.customer_wa_id,
    profile_name: conv.profile_name,
    custom_label: conv.custom_label,
    display_name: conv.custom_label || conv.profile_name || conv.customer_wa_id,
    status: conv.status,
    ai_enabled: conv.ai_enabled,
    unread_count: conv.unread_count,
    last_message_at: conv.last_message_at,
    last_inbound_at: conv.last_inbound_at,
    last_staff_read_at: conv.last_staff_read_at,
    labels: Array.isArray(conv.labels) ? conv.labels : [],
    snoozed_until: conv.snoozed_until,
    needs_attention: conv.needs_attention,
    attention_reason: conv.attention_reason,
    attention_at: conv.attention_at,
    assigned_staff_id: conv.assigned_staff_id,
    assigned_staff: conv.assigned_staff ? { id: conv.assigned_staff_id, name: conv.assigned_staff.name } : null,
    current_state: conv.current_state,
    last_message: preview(last),
    // What the current inbox shows on SHIFT's rows: an open request to the team, and who the lead is.
    team_request: openTeamRequest(conv),
    lead: leadSummary(conv),
  };
}

function openTeamRequest(conv) {
  const nt = conv.workflow_data && conv.workflow_data.needs_team;
  if (!nt || typeof nt !== 'object' || nt.resolved_at) return null;
  return { reason: nt.reason || null, summary: typeof nt.summary === 'string' ? nt.summary.slice(0, 160) : null, at: nt.at || null };
}

function leadSummary(conv) {
  const lead = conv.workflow_data && conv.workflow_data.lead;
  if (!lead || typeof lead !== 'object') return null;
  const pick = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : null);
  const out = { name: pick(lead.name), business_name: pick(lead.business_name), sector_text: pick(lead.sector_text), interest: pick(lead.interest) };
  return Object.values(out).some(Boolean) ? out : null;
}

// ─── list ─────────────────────────────────────────────────────────────────────

/**
 * GET /conversations?filter=&label=&search=&cursor=&limit=
 *
 * Newest activity first. `cursor` is the `next_cursor` of the previous page («<ISO>|<id>»): keyset
 * pagination, so a conversation that moves while staff scroll is neither skipped nor shown twice the
 * way an offset would.
 */
router.get('/conversations', async (req, res) => {
  try {
    const filter = FILTERS.includes(req.query.filter) ? req.query.filter : 'all';
    const limit = clampInt(req.query.limit, 30, LIST_MAX);
    const now = new Date();
    const and = [filterWhere(filter, { businessId: req.businessId, userId: req.user.id, now })];

    if (typeof req.query.label === 'string' && req.query.label.trim()) {
      and.push({ labels: { has: req.query.label.trim().slice(0, LABEL_MAX) } });
    }
    if (typeof req.query.search === 'string') {
      const q = req.query.search.trim().slice(0, SEARCH_MAX);
      if (q) {
        and.push({ OR: [
          { profile_name: { contains: q, mode: 'insensitive' } },
          { custom_label: { contains: q, mode: 'insensitive' } },
          { customer_wa_id: { contains: q.replace(/\D/g, '') || q } },
        ] });
      }
    }
    if (typeof req.query.cursor === 'string' && req.query.cursor.includes('|')) {
      const [iso, id] = req.query.cursor.split('|');
      const at = validDate(iso);
      if (!at || !id) return res.status(400).json({ error: 'invalid cursor' });
      and.push({ OR: [
        { last_message_at: { lt: at } },
        { AND: [{ last_message_at: at }, { id: { lt: id } }] },
      ] });
    }

    const rows = await prisma.conversation.findMany({
      where: { AND: and },
      orderBy: [{ last_message_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { assigned_staff: { select: { name: true } } },
    });
    const page = rows.slice(0, limit);
    const last = await latestMessages(page.map((c) => c.id));
    const tail = page[page.length - 1];
    res.json({
      conversations: page.map((c) => shapeConversation(c, last.get(c.id))),
      next_cursor: rows.length > limit && tail ? `${new Date(tail.last_message_at).toISOString()}|${tail.id}` : null,
      filter,
    });
  } catch (err) {
    console.error(`[inboxV2] list failed: ${err.message}`);
    res.status(500).json({ error: 'Inbox request failed' });
  }
});

/** GET /stats — the counts behind each filter tab. */
router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const ctx = { businessId: req.businessId, userId: req.user.id, now };
    const counts = await Promise.all(FILTERS.map((f) => prisma.conversation.count({ where: filterWhere(f, ctx) })));
    res.json(Object.fromEntries(FILTERS.map((f, i) => [f, counts[i]])));
  } catch (err) {
    console.error(`[inboxV2] stats failed: ${err.message}`);
    res.status(500).json({ error: 'Inbox request failed' });
  }
});

/** GET /staff-list — who a conversation can be assigned to: active users of this business. */
router.get('/staff-list', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { business_id: req.businessId, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, role: true },
    });
    res.json({ staff: users });
  } catch (err) {
    console.error(`[inboxV2] staff-list failed: ${err.message}`);
    res.status(500).json({ error: 'Inbox request failed' });
  }
});

// ─── one conversation ─────────────────────────────────────────────────────────

router.get('/conversations/:id', withConversation(async (req, res, conv) => {
  const full = await prisma.conversation.findFirst({
    where: { id: conv.id, business_id: req.businessId },
    include: { assigned_staff: { select: { name: true } } },
  });
  const last = await latestMessages([conv.id]);
  res.json({ conversation: { ...shapeConversation(full, last.get(conv.id)), workflow_data: full.workflow_data } });
}));

/**
 * GET /conversations/:id/messages?before=&limit=
 *
 * The newest page, oldest-first for display; `before` gives the page just above it. Quoted replies
 * are resolved in one extra read, and only within this conversation.
 */
router.get('/conversations/:id/messages', withConversation(async (req, res, conv) => {
  const limit = clampInt(req.query.limit, 50, THREAD_MAX);
  const where = { conversation_id: conv.id };
  if (req.query.before !== undefined) {
    const before = validDate(req.query.before);
    if (!before) return res.status(400).json({ error: 'invalid before' });
    where.created_at = { lt: before };
  }
  const rows = (await prisma.message.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: limit + 1,
    include: { sent_by_user: { select: { name: true } } },
  }));
  const hasOlder = rows.length > limit;
  const messages = rows.slice(0, limit).reverse();

  const quotedIds = [...new Set(messages.map((m) => m.reply_to_message_id).filter(Boolean))];
  const quoted = quotedIds.length
    ? await prisma.message.findMany({ where: { conversation_id: conv.id, meta_message_id: { in: quotedIds } } })
    : [];
  const byWamid = new Map(quoted.map((q) => [q.meta_message_id, q]));

  res.json({
    messages: messages.map((m) => ({
      id: m.id,
      meta_message_id: m.meta_message_id,
      direction: m.direction,
      message_type: m.message_type,
      text_body: m.text_body,
      media_id: m.media_id,
      media_mime_type: m.media_mime_type,
      interactive_reply: m.interactive_reply,
      location: m.location,
      status: m.status,
      is_ai_generated: m.is_ai_generated,
      sent_by: m.sent_by_user ? { id: m.sent_by_user_id, name: m.sent_by_user.name } : null,
      created_at: m.created_at,
      delivered_at: m.delivered_at,
      read_at: m.read_at,
      failed_at: m.failed_at,
      error_code: m.error_code,
      error_message: m.error_message,
      reactions: Array.isArray(m.reactions) ? m.reactions : [],
      kind: m.raw_payload && typeof m.raw_payload.kind === 'string' ? m.raw_payload.kind : null,
      reply_to: m.reply_to_message_id
        ? (() => {
          const q = byWamid.get(m.reply_to_message_id);
          return { meta_message_id: m.reply_to_message_id, text: q ? (q.text_body || '') : '', message_type: q ? q.message_type : null, direction: q ? q.direction : null };
        })()
        : null,
    })),
    has_older: hasOlder,
  });
}));

/** POST /conversations/:id/read — explicit, sent by the page only while it is visible. */
router.post('/conversations/:id/read', withConversation(async (req, res, conv) => {
  const now = new Date();
  await prisma.conversation.update({ where: { id: conv.id }, data: { unread_count: 0, last_staff_read_at: now } });
  res.json({ ok: true, last_staff_read_at: now });
}));

router.post('/conversations/:id/labels', withConversation(async (req, res, conv) => {
  const labels = normalizeLabels(req.body && req.body.labels);
  if (labels === null) return res.status(400).json({ error: 'labels must be a list' });
  await prisma.conversation.update({ where: { id: conv.id }, data: { labels } });
  res.json({ ok: true, labels });
}));

/** POST /conversations/:id/snooze { until } — null wakes it now. */
router.post('/conversations/:id/snooze', withConversation(async (req, res, conv) => {
  const raw = req.body ? req.body.until : undefined;
  let until = null;
  if (raw !== null && raw !== undefined) {
    until = validDate(raw);
    const now = Date.now();
    if (!until || until.getTime() <= now) return res.status(400).json({ error: 'until must be a future time' });
    if (until.getTime() > now + SNOOZE_MAX_DAYS * 24 * 3600 * 1000) {
      return res.status(400).json({ error: `snooze is at most ${SNOOZE_MAX_DAYS} days` });
    }
  }
  await prisma.conversation.update({ where: { id: conv.id }, data: { snoozed_until: until } });
  res.json({ ok: true, snoozed_until: until });
}));

router.post('/conversations/:id/contact-notes', withConversation(async (req, res, conv) => {
  const notes = req.body ? req.body.notes : undefined;
  if (notes !== null && typeof notes !== 'string') return res.status(400).json({ error: 'notes must be text' });
  if (typeof notes === 'string' && notes.length > NOTES_MAX) {
    return res.status(400).json({ error: `notes are at most ${NOTES_MAX} characters` });
  }
  const value = typeof notes === 'string' && notes.trim() ? notes : null;
  await prisma.conversation.update({ where: { id: conv.id }, data: { contact_notes: value } });
  res.json({ ok: true, contact_notes: value });
}));

/** POST /conversations/:id/contact-label { label } — what staff call this contact; null clears it. */
router.post('/conversations/:id/contact-label', withConversation(async (req, res, conv) => {
  const label = req.body ? req.body.label : undefined;
  if (label !== null && typeof label !== 'string') return res.status(400).json({ error: 'label must be text' });
  const value = typeof label === 'string' ? label.replace(/\s+/g, ' ').trim().slice(0, CUSTOM_LABEL_MAX) || null : null;
  await prisma.conversation.update({ where: { id: conv.id }, data: { custom_label: value } });
  res.json({ ok: true, custom_label: value });
}));

/**
 * POST /conversations/:id/assign { user_id } — null unassigns. The assignee must be an active user of
 * THIS business: otherwise one tenant could hand a conversation to another tenant's staff member.
 */
router.post('/conversations/:id/assign', withConversation(async (req, res, conv) => {
  const userId = req.body ? req.body.user_id : undefined;
  if (userId !== null && typeof userId !== 'string') return res.status(400).json({ error: 'user_id must be an id or null' });
  if (userId) {
    const user = await prisma.user.findFirst({ where: { id: userId, business_id: req.businessId, active: true } });
    if (!user) return res.status(400).json({ error: 'not a member of this business' });
  }
  await prisma.conversation.update({ where: { id: conv.id }, data: { assigned_staff_id: userId || null } });
  res.json({ ok: true, assigned_staff_id: userId || null });
}));

/**
 * POST /conversations/:id/status { status }. `human_takeover` is left to the existing takeover route,
 * which also stops the bot and parks pending replies; here it would only change a label.
 */
router.post('/conversations/:id/status', withConversation(async (req, res, conv) => {
  const status = req.body ? req.body.status : undefined;
  if (!STATUSES.includes(status) || status === 'human_takeover') {
    return res.status(400).json({ error: 'status must be open, pending or resolved' });
  }
  const data = { status };
  // Resolving clears the attention flag: there is nothing left to attend to.
  if (status === 'resolved') Object.assign(data, { needs_attention: false, attention_reason: null, attention_at: null });
  await prisma.conversation.update({ where: { id: conv.id }, data });
  res.json({ ok: true, status });
}));

router.post('/conversations/:id/attention/clear', withConversation(async (req, res, conv) => {
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { needs_attention: false, attention_reason: null, attention_at: null },
  });
  res.json({ ok: true });
}));

module.exports = router;
module.exports._internals = { normalizeLabels, filterWhere, FILTERS };
