/**
 * SHIFT sweeper — the "never silent" safety net (design §7, pr1-contracts §8.1).
 *
 * Triggered every minute by Cloud Scheduler (POST /api/internal/sweep) and by an in-process
 * setInterval. Both can fire together and several Cloud Run instances can run at once, so every
 * customer note and staff alert is claimed atomically in the DB (claimFlag / claimValue / a status
 * transition) before it is sent: a concurrent sweep loses the claim and does nothing.
 *
 * The sweeper never generates AI replies itself: orphaned batches are handed back to the
 * batcher, and the only customer-visible texts are the two fixed notes from acks.js.
 */

const prisma = require('../config/prisma');
const jsonb = require('../db/jsonb');
const replyBatcher = require('./replyBatcher');
const { resolveTeamHours, isWithinTeamHours, teamMinutesBetween } = require('../workflows/shift/hours');
const { slaNote, awaitingStaffNote, pickLanguage } = require('../workflows/shift/acks');
const { sendStaffAlert, alertChannelConfigured } = require('./alerts');
const { NOTE_WINDOW_MARGIN_MS, windowClosesAt } = require('../utils/serviceWindow');
const { resolveModel } = require('../ai/provider');
const { graphVersion } = require('./whatsapp');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const ORPHAN_AGE_MS = 30 * 1000;
const ORPHAN_LIMIT = 100;
const MAX_REPLY_FAILURES = 3;
const SLA_TEAM_MINUTES = 15;
const AWAITING_AGE_MS = 10 * MINUTE_MS;
const AWAITING_LIMIT = 200;
const AMBIGUOUS_AGE_MS = 10 * MINUTE_MS;
const AMBIGUOUS_LIMIT = 200;
// Flag the window while staff can still reply for free (22–24 h after the last inbound).
const WINDOW_FLAG_FROM_MS = 22 * HOUR_MS;
const WINDOW_FLAG_TO_MS = 24 * HOUR_MS;
// Inbound-without-outbound: older than a batch plus an AI deadline, recent enough to still matter.
const UNANSWERED_MIN_AGE_MS = 2 * MINUTE_MS;
const UNANSWERED_MAX_AGE_MS = 60 * MINUTE_MS;
const BACKLOG_AGE_MS = 60 * 1000;

let running = false;
let last = { at: null, report: null };

function emptyReport() {
  return {
    orphans: 0, sla_notes: 0, awaiting_notes: 0, window_flags: 0,
    ambiguous_alerts: 0, unanswered_alerts: 0, errors: [],
  };
}

function lastSweep() {
  return { at: last.at, report: last.report };
}

/** «تمام شكرًا», «ok thanks»: ≤ 3 words without a question. Empty text (media) is not a closer. */
function isCloser(text) {
  if (typeof text !== 'string') return false;
  const s = text.trim();
  if (!s || /[?؟]/.test(s)) return false;
  return s.split(/\s+/).filter(Boolean).length <= 3;
}

function ago(now, ms) {
  return new Date(now.getTime() - ms);
}

function workflowData(conv) {
  return conv && conv.workflow_data && typeof conv.workflow_data === 'object' ? conv.workflow_data : {};
}

function metadataOf(conv) {
  return conv && conv.metadata && typeof conv.metadata === 'object' ? conv.metadata : {};
}

function langFor(conv) {
  return pickLanguage(workflowData(conv).lead || {}, '');
}

function testNumbers(business, env = process.env) {
  const fromConfig = Array.isArray(business?.ai_config?.test_numbers) ? business.ai_config.test_numbers : [];
  const fromEnv = String(env.SHIFT_TEST_NUMBERS || '').split(',');
  return new Set([...fromConfig, ...fromEnv].map((n) => String(n ?? '').replace(/\D/g, '')).filter(Boolean));
}

// Customer notes obey the same D1 gate as bot replies: save-only mode must not start talking
// to customers through the sweeper.
function notesAllowed(business, conv) {
  return replyBatcher.isShiftReplyAllowed(business, conv.customer_wa_id);
}

function noteResult(kind, text) {
  return {
    kind,
    action: 'NONE',
    messages: [{ type: 'text', text }],
    stateUpdate: {},
    workflowDataPatch: {},
    leadPatch: null,
    needsTeam: null,
    alert: null,
  };
}

async function deliverNote({ business, conversation, kind, text, now }) {
  return replyBatcher.deliverResult({
    business,
    conversation,
    result: noteResult(kind, text),
    batch: [],
    windowMarginMs: NOTE_WINDOW_MARGIN_MS,
    now,
  });
}

// One failing conversation must not stop the rest of the step.
async function each(report, label, items, fn) {
  for (const item of items) {
    try {
      await fn(item);
    } catch (err) {
      report.errors.push(`${label}: ${err.message}`);
      console.error(`[sweep] ${label} failed:`, err.message);
    }
  }
}

function newestStaffOutbound(conversationId, extraWhere = {}) {
  return prisma.message.findFirst({
    where: { conversation_id: conversationId, direction: 'outbound', sent_by_user_id: { not: null }, ...extraWhere },
    orderBy: { created_at: 'desc' },
  });
}

// ─── 1. Orphaned batches ─────────────────────────────────────────────────────

async function sweepOrphans(business, now, report) {
  const rows = await prisma.message.findMany({
    where: { business_id: business.id, direction: 'inbound', status: 'received', created_at: { lt: ago(now, ORPHAN_AGE_MS) } },
    orderBy: { created_at: 'asc' },
    take: ORPHAN_LIMIT,
  });
  const ids = [...new Set(rows.map((m) => m.conversation_id))];
  await each(report, `orphans ${business.id}`, ids, async (convId) => {
    const conv = await prisma.conversation.findUnique({ where: { id: convId } });
    if (!conv) return;
    // After three failed deliveries a retry every minute only repeats the failure; staff were alerted.
    if (Number(metadataOf(conv).reply_failures) >= MAX_REPLY_FAILURES) return;
    replyBatcher.scheduleReply(convId, { reason: 'sweep' });
    report.orphans += 1;
  });
}

// ─── 2. SLA note for an unclaimed needs_team ─────────────────────────────────

async function sweepSlaNotes(business, teamHours, now, report) {
  if (!isWithinTeamHours(teamHours, now)) return;
  const convs = await prisma.conversation.findMany({ where: { business_id: business.id, status: 'pending' } });
  await each(report, `sla ${business.id}`, convs, async (conv) => {
    const wd = workflowData(conv);
    const nt = wd.needs_team;
    if (!nt || nt.resolved_at || nt.sla_note_sent_at || nt.reason === 'ai_failure' || wd.marketing_opted_out_at) return;
    if (!nt.at || teamMinutesBetween(teamHours, new Date(nt.at), now) < SLA_TEAM_MINUTES) return;
    if (!notesAllowed(business, conv)) return;
    const staff = await newestStaffOutbound(conv.id, { created_at: { gt: new Date(nt.at) } });
    if (staff) return;

    const claimed = await jsonb.claimFlag('conversations', conv.id, 'workflow_data', ['needs_team', 'sla_note_sent_at']);
    if (!claimed) return;
    report.sla_notes += 1;
    const delivery = await deliverNote({ business, conversation: conv, kind: 'sla_note', text: slaNote(langFor(conv)), now });
    await sendStaffAlert({
      reason: 'sla_breached', business, conversation: conv, now,
      summary: `${nt.reason}${nt.summary ? ` — ${nt.summary}` : ''} (note: ${delivery?.outcome || 'unknown'})`,
    });
  });
}

// ─── 3. Note while the customer waits for a staff member ────────────────────

async function sweepAwaitingNotes(business, teamHours, now, report) {
  if (!isWithinTeamHours(teamHours, now)) return;
  const rows = await prisma.message.findMany({
    where: { business_id: business.id, direction: 'inbound', status: 'awaiting_staff', created_at: { lt: ago(now, AWAITING_AGE_MS) } },
    orderBy: { created_at: 'asc' },
    take: AWAITING_LIMIT,
  });
  const byConv = new Map();
  for (const row of rows) {
    if (!byConv.has(row.conversation_id)) byConv.set(row.conversation_id, []);
    byConv.get(row.conversation_id).push(row);
  }

  await each(report, `awaiting ${business.id}`, [...byConv.entries()], async ([convId, awaiting]) => {
    const lastStaff = await newestStaffOutbound(convId);
    // Only messages the staff member has not answered yet form the current silence.
    const since = lastStaff ? new Date(lastStaff.created_at).getTime() : null;
    const silence = awaiting.filter((m) => since === null || new Date(m.created_at).getTime() > since);
    if (!silence.length || silence.every((m) => isCloser(m.text_body))) return;

    const conv = await prisma.conversation.findUnique({ where: { id: convId } });
    if (!conv || !notesAllowed(business, conv)) return;

    // Keyed by the first message of the silence: once per silence, again after the next staff reply.
    const claimed = await jsonb.claimValue('conversations', convId, 'metadata', 'awaiting_note_for', silence[0].id);
    if (!claimed) return;
    report.awaiting_notes += 1;

    let staffName = null;
    if (conv.assigned_staff_id) {
      const user = await prisma.user.findUnique({ where: { id: conv.assigned_staff_id }, select: { name: true } });
      staffName = user?.name || null;
    }
    const text = awaitingStaffNote({ staffName, lang: langFor(conv) });
    const delivery = await deliverNote({ business, conversation: conv, kind: 'awaiting_note', text, now });
    await sendStaffAlert({
      reason: 'awaiting_staff', business, conversation: conv, now,
      summary: `${silence.length} message(s) waiting${staffName ? ` for ${staffName}` : ''} (note: ${delivery?.outcome || 'unknown'})`,
    });
  });
}

// ─── 4. 24 h window about to close on a conversation staff still owe ─────────

async function sweepWindowFlags(business, now, report) {
  const convs = await prisma.conversation.findMany({
    where: {
      business_id: business.id,
      last_inbound_at: { gte: ago(now, WINDOW_FLAG_TO_MS), lte: ago(now, WINDOW_FLAG_FROM_MS) },
    },
  });
  await each(report, `window ${business.id}`, convs, async (conv) => {
    let eligible = conv.status === 'pending' || conv.status === 'human_takeover';
    if (!eligible) {
      const waiting = await prisma.message.count({
        where: { conversation_id: conv.id, direction: 'inbound', status: 'awaiting_staff' },
      });
      eligible = waiting > 0;
    }
    if (!eligible) return;

    const lastInbound = new Date(conv.last_inbound_at);
    const claimed = await jsonb.claimValue('conversations', conv.id, 'metadata', 'window_flag_for', lastInbound.toISOString());
    if (!claimed) return;
    const closesAt = windowClosesAt(lastInbound);
    await jsonb.patchJson('conversations', conv.id, 'metadata', { window_closing_at: closesAt.toISOString() });
    report.window_flags += 1;
    await sendStaffAlert({
      reason: 'window_closing', business, conversation: conv, now,
      summary: `closes at ${closesAt.toISOString()}`,
    });
  });
}

// ─── 5. Sends that never got a wamid or a status webhook ─────────────────────

async function sweepAmbiguous(business, now, report) {
  const rows = await prisma.message.findMany({
    where: { business_id: business.id, direction: 'outbound', status: 'ambiguous', created_at: { lt: ago(now, AMBIGUOUS_AGE_MS) } },
    orderBy: { created_at: 'asc' },
    take: AMBIGUOUS_LIMIT,
  });
  await each(report, `ambiguous ${business.id}`, rows, async (row) => {
    // The status transition is the once-only claim. Never re-send: the customer may already have it.
    const { count } = await prisma.message.updateMany({
      where: { id: row.id, status: 'ambiguous' },
      data: { status: 'ambiguous_unreconciled' },
    });
    if (count !== 1) return;
    report.ambiguous_alerts += 1;
    const conv = await prisma.conversation.findUnique({ where: { id: row.conversation_id } });
    await sendStaffAlert({
      reason: 'ambiguous_send', business, conversation: conv || { id: row.conversation_id }, now,
      summary: (row.text_body || '').slice(0, 200),
    });
  });
}

// ─── 6. Inbound with no outbound after it (any mode, any gate) ───────────────

async function sweepUnanswered(business, now, report) {
  const convs = await prisma.conversation.findMany({
    where: {
      business_id: business.id,
      last_inbound_at: { gte: ago(now, UNANSWERED_MAX_AGE_MS), lte: ago(now, UNANSWERED_MIN_AGE_MS) },
    },
  });
  await each(report, `unanswered ${business.id}`, convs, async (conv) => {
    const inb = await prisma.message.findFirst({
      where: { conversation_id: conv.id, direction: 'inbound' },
      orderBy: { created_at: 'desc' },
    });
    // Reactions need no answer; awaiting_staff has its own note and alert.
    if (!inb || inb.message_type === 'reaction' || inb.status === 'awaiting_staff') return;
    const outbound = await prisma.message.findFirst({
      where: { conversation_id: conv.id, direction: 'outbound', created_at: { gte: inb.created_at } },
      orderBy: { created_at: 'desc' },
    });
    if (outbound) return;

    const claimed = await jsonb.claimValue('conversations', conv.id, 'metadata', 'unanswered_alert_for', inb.id);
    if (!claimed) return;
    report.unanswered_alerts += 1;
    await sendStaffAlert({
      reason: 'inbound_without_outbound', business, conversation: conv, now,
      summary: (inb.text_body || `[${inb.message_type}]`).slice(0, 200),
    });
  });
}

// ─── run ─────────────────────────────────────────────────────────────────────

const STEPS = [
  ['orphans', (b, th, now, r) => sweepOrphans(b, now, r)],
  ['sla_notes', sweepSlaNotes],
  ['awaiting_notes', sweepAwaitingNotes],
  ['window_flags', (b, th, now, r) => sweepWindowFlags(b, now, r)],
  ['ambiguous', (b, th, now, r) => sweepAmbiguous(b, now, r)],
  ['unanswered', (b, th, now, r) => sweepUnanswered(b, now, r)],
];

async function runSweep({ now = new Date() } = {}) {
  // Scheduler and setInterval can overlap inside one instance; the DB claims cover other instances.
  if (running) return { skipped: 'already_running', ...emptyReport() };
  running = true;
  const report = emptyReport();
  try {
    let businesses = [];
    try {
      businesses = await prisma.business.findMany({ where: { business_type: 'shift', status: 'active' } });
    } catch (err) {
      report.errors.push(`businesses: ${err.message}`);
    }

    for (const business of businesses) {
      const teamHours = resolveTeamHours(business.ai_config);
      for (const [name, step] of STEPS) {
        try {
          await step(business, teamHours, now, report);
        } catch (err) {
          report.errors.push(`${name} ${business.id}: ${err.message}`);
          console.error(`[sweep] ${name} failed for ${business.id}:`, err.message);
        }
      }
    }
    last = { at: new Date(now).toISOString(), report };
    return report;
  } finally {
    running = false;
  }
}

async function getShiftStatus({ now = new Date() } = {}) {
  const [business] = await prisma.business.findMany({ where: { business_type: 'shift', status: 'active' } });
  if (!business) return { workflow_active: false, business: null };

  const aiConfig = business.ai_config || {};
  const botLive = process.env.SHIFT_BOT_LIVE !== '0';
  const newest = (direction) => prisma.message.findFirst({
    where: { business_id: business.id, direction },
    orderBy: { created_at: 'desc' },
  });
  const [lastIn, lastOut, pending, awaitingStaff, receivedBacklog, ambiguous] = await Promise.all([
    newest('inbound'),
    newest('outbound'),
    prisma.conversation.count({ where: { business_id: business.id, status: 'pending' } }),
    prisma.message.count({ where: { business_id: business.id, direction: 'inbound', status: 'awaiting_staff' } }),
    prisma.message.count({
      where: { business_id: business.id, direction: 'inbound', status: 'received', created_at: { lt: ago(now, BACKLOG_AGE_MS) } },
    }),
    prisma.message.count({
      where: { business_id: business.id, direction: 'outbound', status: { in: ['ambiguous', 'ambiguous_unreconciled'] } },
    }),
  ]);
  const iso = (row) => (row && row.created_at ? new Date(row.created_at).toISOString() : null);

  return {
    business: { id: business.id, name: business.name },
    workflow_active: business.status === 'active' && aiConfig.reply_mode !== 'external' && botLive,
    reply_mode: aiConfig.reply_mode ?? null,
    bot_live: botLive,
    test_numbers_count: testNumbers(business).size,
    alert_channel_configured: alertChannelConfigured(business),
    model: resolveModel(),
    graph_version: graphVersion(),
    last_inbound_at: iso(lastIn),
    last_outbound_at: iso(lastOut),
    pending,
    awaiting_staff: awaitingStaff,
    received_backlog: receivedBacklog,
    ambiguous,
    sweep: lastSweep(),
    now: new Date(now).toISOString(),
  };
}

module.exports = { runSweep, getShiftStatus, lastSweep, isCloser };
