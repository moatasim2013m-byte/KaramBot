const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, requireRole } = require('../middleware/auth');

/**
 * Platform operations for SHIFT staff.
 *
 * This answers one question — are our customer accounts working — and deliberately not
 * "what are their customers saying". Conversation content belongs to the business that
 * owns it; the read-only inspection view is a separate, audited route.
 *
 * Every state here is derived from something we actually store. Where a signal needs a
 * Graph call we do not make yet (Meta's quality rating, messaging tier), the answer is
 * `unknown` — never a green light we did not earn.
 */
router.use(authenticate, requireRole('platform_admin'));

const {
  connectionState, agentState, lifecycle, isWaiting, isHandoffWaiting,
  UNANSWERED_MINUTES, UNANSWERED_MAX_HOURS, HANDOFF_MINUTES,
  whatsappColumn, botColumn, subscriptionColumn, shopAttention, platformAttention, providerDown, sortAttention,
} = require('../services/accountHealth');
const { dryRun } = require('../services/dryRun');
const { refresh: refreshMetaStatus, metaAttention } = require('../services/metaStatus');
const { paymentNotice, WHATSAPP_MANAGER_URL } = require('../config/metaNotices');
const accountEvents = require('../services/accountEvents');
const costGuard = require('../services/costGuard');
const jsonb = require('../db/jsonb');
const platformSettings = require('../services/platformSettings');
const labels = require('../config/eventLabels');
const { firstName } = require('../utils/names');
const adminAccounts = require('./adminAccounts');
const latePolicy = require('../services/latePolicy');

// The waiting and handoff lists are read row by row; this caps a pathological day rather than
// shaping a normal one (ten shops have tens of open threads, not thousands).
const WAITING_SCAN_LIMIT = 2000;

/** The staff member behind an admin action, for AccountEvent rows. Never throws. */
const shiftEvent = (req, businessId, type, data = {}) =>
  accountEvents.record({ businessId, actorUserId: req.user?.id || null, actorKind: 'shift', type, data });

/**
 * A signal the overview can live without. The screen is opened every morning; one unreadable
 * signal (a new table missing on a stale database, a slow count) must cost that signal, not the
 * whole page, and the log says which one.
 */
async function soft(label, read, fallback) {
  try {
    return await read();
  } catch (err) {
    console.warn(`[admin/overview] ${label} not read: ${err.message}`);
    return fallback;
  }
}

// Event types the overview's rules read beyond the board's own (adminAccounts.BOARD_TYPES).
const OVERVIEW_EVENT_TYPES = ['meta_restriction', 'went_live', 'partner_removed'];
const RECENT_EVENTS = 15;
const EMPTY_STAGE_INPUTS = { ownerOf: new Map(), inviteOf: new Map(), eventsOf: new Map(), knowledgeOf: new Map(), ownerConnect: false };
// The «مسار الانضمام» strip, in the board's order, plus the paused shops.
const FUNNEL = ['invite_sent', 'connecting', 'awaiting_card', 'teaching', 'awaiting_first_customer', 'live', 'paused'];
const FUNNEL_OF = { invite_opened: 'invite_sent', invite_expired: 'invite_sent', suspended: 'paused' };

/**
 * The fleet table's stage: the board's stage (adminAccounts.deriveCard, the same derivation), with
 * what the board does not show as a column: a paused bot or a suspended account, and an invite
 * that was opened or ran out.
 */
function fleetStage(business, board, invite, now) {
  if (business.status === 'suspended') return 'suspended';
  if (business.wa_phone_number_id && business.ai_config?.enabled === false) return 'paused';
  if (board.stage === 'invite_sent') {
    if (invite && new Date(invite.expires_at).getTime() < now) return 'invite_expired';
    if (board.card.opened) return 'invite_opened';
  }
  return board.stage;
}

/** «صاحب المحل»: first name, mobile and whether they can get in. */
function ownerColumn(business, owner, invite, now) {
  if (!owner) return null;
  const signedIn = Boolean(owner.last_login);
  let state = 'no_invite';
  let label = 'لا توجد دعوة';
  if (signedIn && owner.active) { state = 'signed_in'; label = '✓ دخل'; }
  else if (signedIn && !owner.active) { state = 'disabled'; label = 'معطّل'; }
  else if (invite && new Date(invite.expires_at).getTime() < now) { state = 'invite_expired'; label = 'انتهت الدعوة'; }
  else if (invite) {
    const left = Math.max(1, Math.ceil((new Date(invite.expires_at).getTime() - now) / 86400000));
    state = 'invited';
    label = `الدعوة تنتهي بعد ${labels.days(left)}`;
  }
  return {
    first_name: firstName(owner.name),
    phone: owner.phone || business.owner_phone || null,
    signed_in: signedIn,
    active: Boolean(owner.active),
    invite_expires_at: invite && !signedIn ? invite.expires_at : null,
    state,
    label_ar: label,
  };
}

/** {rule, …} from accountHealth → the item the panel renders, with the fix button. */
function attentionItem(i, business, owner) {
  const action = labels.actionFor(i.rule);
  const phone = (owner && owner.phone) || (business && business.owner_phone) || null;
  if (action.kind === 'message_owner' && phone) {
    action.url = `https://wa.me/${phone}?text=${encodeURIComponent(labels.ownerLine(i.rule, owner && owner.first_name))}`;
  }
  return {
    rule: i.rule,
    severity: i.severity,
    account_id: business ? business.id : null,
    name: business ? business.name : 'المنصة',
    text_ar: i.text_ar,
    since: i.since || null,
    action,
    ...(i.ref ? { ref: i.ref } : {}),
    // The names this list had before the spec's (the account page's own list still reads them).
    business_id: business ? business.id : null,
    business_name: business ? business.name : 'المنصة',
    category: i.category || i.rule,
    message: i.text_ar,
  };
}

/** An AccountEvent as «آخر ما حصل» and «السجل» show it. */
function eventRow(e, { businessName, actorName }) {
  return {
    id: e.id,
    at: e.created_at,
    business_id: e.business_id || null,
    business_name: businessName || null,
    actor_ar: labels.actorText(e.actor_kind, actorName ? firstName(actorName) : null),
    type: e.type,
    text_ar: labels.eventText(e),
  };
}

async function namesOf(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await soft('actor names', () => prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }), []);
  return new Map(rows.map((u) => [u.id, u.name]));
}

router.get('/overview', async (req, res) => {
  try {
    // SHIFT's own number and the -sim test shops are real rows that would otherwise inflate the
    // totals and fill the queue with our own traffic. Hidden by default, and said so.
    const includeInternal = ['1', 'true'].includes(String(req.query.include_internal || ''));
    const businessWhere = includeInternal ? {} : { is_internal: false };
    const nowDate = new Date();
    const now = nowDate.getTime();

    const [businesses, hiddenInternal] = await Promise.all([
      prisma.business.findMany({
        where: businessWhere,
        select: {
          id: true, name: true, status: true, business_type: true, is_internal: true,
          wa_phone_number_id: true, wa_business_account_id: true, connected_at: true, went_live_at: true,
          wa_access_token: true, ai_config: true, created_at: true, updated_at: true,
          sector: true, city: true, owner_phone: true, wa_display_phone: true, wa_verified_name: true,
        },
        orderBy: { created_at: 'asc' },
      }),
      includeInternal ? 0 : prisma.business.count({ where: { is_internal: true } }),
    ]);

    const businessIds = businesses.map((b) => b.id);
    const inShown = { business_id: { in: businessIds } };
    const onboardings = await prisma.whatsappOnboarding.findMany({
      where: { business_id: { in: businessIds } },
      select: {
        id: true, business_id: true, step: true, payment_method_ok: true, payment_method_marked_at: true,
        payment_method_claimed_at: true, payment_blocked_at: true, registered_at: true,
        needs_operator: true, revoked_at: true, revoked_reason: true, detached_at: true,
        last_error: true, last_error_at: true, updated_at: true,
        meta_quality_rating: true, meta_throughput: true, meta_number_status: true,
        meta_name_status: true, meta_review_status: true, meta_checked_at: true,
      },
    });
    const onboardingByBusiness = new Map();
    for (const o of onboardings) if (o.business_id && businessIds.includes(o.business_id)) onboardingByBusiness.set(o.business_id, o);

    // The live contract per account: the newest non-cancelled row.
    const subs = await prisma.subscription.findMany({
      where: { status: { not: 'cancelled' }, ...inShown },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, business_id: true, solution: true, plan_name: true, status: true, amount_jod: true, billing_cycle: true,
        next_due_at: true, starts_at: true, trial_ends_at: true, ai_replies_month: true,
      },
    });
    const contractByBusiness = new Map();
    for (const sub of subs) if (!contractByBusiness.has(sub.business_id)) contractByBusiness.set(sub.business_id, sub);
    // The cap and the free month follow the Karam Bot contract alone (costGuard.contractFor).
    const botContractByBusiness = new Map();
    for (const sub of subs) {
      if (sub.solution === costGuard.BOT_SOLUTION && !botContractByBusiness.has(sub.business_id)) botContractByBusiness.set(sub.business_id, sub);
    }
    const trialSubIds = [...botContractByBusiness.values()].filter((s) => s.status === 'trial').map((s) => s.id).filter(Boolean);

    // «ردود الشهر»: the cost guard's own counts and caps, so the number here is the one the bot is
    // held to. Unreadable usage is left out, not shown as zero.
    const usageByBusiness = await soft('usage', () => costGuard.fleetUsage(businessIds, { contracts: botContractByBusiness }), new Map());

    // One grouped query rather than a query per account. The newest reply is the per-business
    // maximum of Conversation.last_outbound_at, which replaced a groupBy over the messages table.
    const convAgg = await prisma.conversation.groupBy({
      by: ['business_id'],
      where: inShown,
      _max: { last_inbound_at: true, last_message_at: true, last_outbound_at: true },
      _count: { _all: true },
      _sum: { unread_count: true },
    });
    const convByBusiness = new Map(convAgg.map((c) => [c.business_id, c]));

    // Whether the AGENT answers is read from the agent's own replies: staff sends and stored
    // alerts stamp last_outbound_at too (review 2026-10-08). Served by (business_id, created_at).
    const aiReplyAgg = await prisma.message.groupBy({
      by: ['business_id'],
      where: { ...inShown, direction: 'outbound', is_ai_generated: true },
      _max: { created_at: true },
    });
    const aiReplyByBusiness = new Map(aiReplyAgg.map((m) => [m.business_id, m._max.created_at]));

    // A per-business maximum hides a neglected thread behind a busy one, so waiting customers are
    // counted per conversation, bounded by the 24-hour window and a row cap.
    const waitingRows = await prisma.conversation.findMany({
      where: {
        ...inShown,
        status: { in: ['open', 'pending'] },
        ai_enabled: true,
        last_inbound_at: {
          lt: new Date(now - UNANSWERED_MINUTES * 60000),
          gt: new Date(now - UNANSWERED_MAX_HOURS * 3600000),
        },
      },
      select: { business_id: true, status: true, ai_enabled: true, last_inbound_at: true, last_outbound_at: true },
      take: WAITING_SCAN_LIMIT,
    });
    const waitingByBusiness = new Map();
    for (const c of waitingRows) {
      if (!isWaiting(c, now)) continue;
      const w = waitingByBusiness.get(c.business_id) || { count: 0, oldest: null };
      w.count += 1;
      if (!w.oldest || new Date(c.last_inbound_at) < new Date(w.oldest)) w.oldest = c.last_inbound_at;
      waitingByBusiness.set(c.business_id, w);
    }

    const handoffRows = await prisma.conversation.findMany({
      where: {
        ...inShown,
        status: { in: ['open', 'pending'] },
        needs_attention: true,
        attention_at: { lt: new Date(now - HANDOFF_MINUTES * 60000) },
      },
      select: { business_id: true, status: true, needs_attention: true, attention_at: true, last_outbound_at: true },
      take: WAITING_SCAN_LIMIT,
    });
    const handoffByBusiness = new Map();
    for (const c of handoffRows) {
      if (!isHandoffWaiting(c, now)) continue;
      const h = handoffByBusiness.get(c.business_id) || { count: 0, oldest: null };
      h.count += 1;
      if (!h.oldest || new Date(c.attention_at) < new Date(h.oldest)) h.oldest = c.attention_at;
      handoffByBusiness.set(c.business_id, h);
    }

    const knowledgeAgg = await prisma.businessKnowledge.groupBy({
      by: ['business_id'], where: { active: true, ...inShown }, _count: { _all: true },
    });
    const knowledgeByBusiness = new Map(knowledgeAgg.map((k) => [k.business_id, k._count._all]));

    const openAgg = await prisma.conversation.groupBy({
      by: ['business_id'],
      where: { status: 'open', ...inShown },
      _count: { _all: true },
    });
    const openByBusiness = new Map(openAgg.map((c) => [c.business_id, c._count._all]));

    // ── The P4 signals: one query each, for every shop at once ─────────────
    // The board's own inputs (owners, links, events, knowledge), so «مسار الانضمام» and the board
    // put a shop in the same stage.
    const campaignShops = businesses.filter((b) => !b.is_internal && b.business_type !== 'shift' && b.status !== 'closed');
    const [stageInputs, settings, repliesToday, conv7Agg, lastEventAgg, trialPayments, recentRaw, orphanRows, unmatchedRows] = await Promise.all([
      soft('stage inputs', () => adminAccounts.loadStageInputs(businesses, { extraTypes: OVERVIEW_EVENT_TYPES }), EMPTY_STAGE_INPUTS),
      soft('platform settings', () => platformSettings.getAll(), {}),
      soft('replies today', () => costGuard.platformAiRepliesToday({ now: nowDate }), null),
      // «محادثات 7 أيام»: conversations with a customer message in the last week.
      soft('conversations 7d', () => prisma.conversation.groupBy({
        by: ['business_id'], where: { ...inShown, last_inbound_at: { gte: new Date(now - 7 * 86400000) } }, _count: { _all: true },
      }), []),
      soft('last event', () => prisma.accountEvent.groupBy({ by: ['business_id'], where: inShown, _max: { created_at: true } }), []),
      // trial_ending: «لا دفعة مسجّلة» on the free-month contract.
      trialSubIds.length ? soft('trial payments', () => prisma.payment.groupBy({
        by: ['subscription_id'], where: { subscription_id: { in: trialSubIds } }, _count: { _all: true },
      }), []) : [],
      soft('recent events', () => prisma.accountEvent.findMany({
        where: inShown, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], take: RECENT_EVENTS,
      }), []),
      // Connections that belong to nobody: an onboarding row with no shop, not detached on purpose.
      soft('orphans', () => prisma.whatsappOnboarding.findMany({
        where: { business_id: null, detached_at: null }, select: { id: true, business_id: true, detached_at: true, created_at: true }, take: 50,
      }), []),
      soft('unmatched partners', () => prisma.accountEvent.findMany({
        where: { business_id: null, type: 'partner_added_unmatched', resolved_at: null },
        select: { id: true, business_id: true, type: true, resolved_at: true, created_at: true }, take: 50,
      }), []),
    ]);
    const conv7ByBusiness = new Map((conv7Agg || []).map((c) => [c.business_id, (c._count && c._count._all) || 0]));
    const lastEventByBusiness = new Map((lastEventAgg || []).map((e) => [e.business_id, e._max && e._max.created_at]));
    const paidSubs = new Set((trialPayments || []).filter((p) => (p._count && p._count._all) > 0).map((p) => p.subscription_id));

    const totals = { onboarding: 0, active: 0, inactive: 0, suspended: 0 };
    const funnel = Object.fromEntries(FUNNEL.map((s) => [s, 0]));
    const money = { trial: 0, paid: 0, unstarted: 0, due_this_week_jod: 0, overdue_jod: 0 };
    const attention = [];
    const accounts = [];
    const cents = (v) => Math.round(Number(v || 0) * 100);
    let dueWeekCents = 0;
    let overdueCents = 0;

    for (const b of businesses) {
      const onboarding = onboardingByBusiness.get(b.id) || null;
      const conv = convByBusiness.get(b.id) || null;
      const lastInbound = conv?._max?.last_inbound_at || null;
      const lastOutbound = conv?._max?.last_outbound_at || null;
      const lastAiReply = aiReplyByBusiness.get(b.id) || null;
      const lastMessage = conv?._max?.last_message_at || null;
      const lastEvent = lastEventByBusiness.get(b.id) || null;
      const lastActivity = [lastMessage, lastEvent].filter(Boolean).sort((x, y) => new Date(y) - new Date(x))[0] || null;
      const waiting = waitingByBusiness.get(b.id) || { count: 0, oldest: null };
      const handoff = handoffByBusiness.get(b.id) || { count: 0, oldest: null };
      const knowledgeCount = knowledgeByBusiness.get(b.id) || 0;
      const events = stageInputs.eventsOf.get(b.id) || [];
      const ownerRow = stageInputs.ownerOf.get(b.id) || null;
      const invite = ownerRow ? stageInputs.inviteOf.get(b.id) || null : null;

      const bucket = lifecycle(b, onboarding);
      totals[bucket] += 1;

      const connection = connectionState(b, onboarding);
      const agent = agentState(b, lastInbound, lastAiReply, knowledgeCount);
      const contract = contractByBusiness.get(b.id) || null;
      const botContract = botContractByBusiness.get(b.id) || null;
      const usage = usageByBusiness.get(b.id) || null;
      const dueInDays = contract?.next_due_at ? Math.ceil((new Date(contract.next_due_at) - now) / 86400000) : null;

      const board = adminAccounts.stageOf(b, onboarding, stageInputs, nowDate);
      const stage = fleetStage(b, board, invite, now);
      const owner = ownerColumn(b, ownerRow, invite, now);
      const isCampaign = campaignShops.includes(b);
      if (isCampaign) funnel[FUNNEL_OF[stage] || stage] += 1;

      // Money counts customers only, whatever the internal toggle shows.
      if (!b.is_internal) {
        if (!contract) money.unstarted += 1;
        else if (contract.status === 'trial') money.trial += 1;
        else if (contract.status === 'active') money.paid += 1;
        if (contract && ['trial', 'active', 'past_due'].includes(contract.status) && contract.next_due_at) {
          const due = new Date(contract.next_due_at).getTime();
          if (contract.status === 'past_due' || due < now) overdueCents += cents(contract.amount_jod);
          else if (due - now <= 7 * 86400000) dueWeekCents += cents(contract.amount_jod);
        } else if (contract && contract.status === 'past_due') {
          overdueCents += cents(contract.amount_jod);
        }
      }

      accounts.push({
        id: b.id,
        name: b.name,
        business_type: b.business_type,
        sector: b.sector || null,
        city: b.city || null,
        display_phone: b.wa_display_phone || null,
        verified_name: b.wa_verified_name || null,
        is_internal: Boolean(b.is_internal),
        lifecycle: bucket,
        stage,
        stage_ar: labels.STAGE_AR[stage],
        stage_since: board.card.since,
        whatsapp: whatsappColumn(b, onboarding, events),
        bot: botColumn(agent, { usage, trial: botContract?.status === 'trial' }),
        subscription: subscriptionColumn(contract, { connected: Boolean(b.wa_phone_number_id), now }),
        trial_ends_at: botContract?.trial_ends_at || null,
        owner,
        contract: contract ? {
          solution: contract.solution,
          plan_name: contract.plan_name,
          status: contract.status,
          amount_jod: Number(contract.amount_jod),
          billing_cycle: contract.billing_cycle,
          next_due_at: contract.next_due_at,
          trial_ends_at: contract.trial_ends_at || null,
          due_in_days: dueInDays,
        } : null,
        status: b.status,
        connection,
        agent,
        bot_enabled: b.ai_config?.enabled !== false,
        usage,
        conversations: conv?._count?._all || 0,
        conversations_7d: b.wa_phone_number_id ? conv7ByBusiness.get(b.id) || 0 : null,
        unanswered_conversations: waiting.count,
        handoff_waiting: handoff.count,
        open_conversations: openByBusiness.get(b.id) || 0,
        unread: conv?._sum?.unread_count || 0,
        last_inbound_at: lastInbound,
        last_outbound_at: lastOutbound,
        last_ai_reply_at: lastAiReply,
        last_activity_at: lastActivity,
        meta: onboarding ? {
          quality_rating: onboarding.meta_quality_rating,
          throughput: onboarding.meta_throughput,
          number_status: onboarding.meta_number_status,
          name_status: onboarding.meta_name_status,
          review_status: onboarding.meta_review_status,
          checked_at: onboarding.meta_checked_at,
        } : null,
        config_changed_at: b.updated_at,
        created_at: b.created_at,
      });

      // ── Attention queue: only rules we can evaluate (services/accountHealth.shopAttention) ──
      const items = shopAttention({
        business: b,
        onboarding,
        events,
        owner: ownerRow,
        invite,
        agent,
        bucket,
        waiting,
        handoff,
        knowledgeCount,
        usage,
        contract,
        botContract,
        trialPaid: Boolean(botContract && paidSubs.has(botContract.id)),
        metaItems: metaAttention(onboarding),
        lastActivity: lastMessage,
        exempt: costGuard.isExempt(b),
        paymentText: (state) => paymentNotice(state, 'staff', 'short'),
        now,
      });
      for (const i of items) attention.push(attentionItem(i, b, owner));
    }

    // ── The platform ───────────────────────────────────────────────────────
    const aiLimits = settings.ai_limits || {};
    const ceiling = Number(aiLimits.platform_day_ceiling) > 0 ? Number(aiLimits.platform_day_ceiling) : null;
    const provider = settings.provider_status || null;
    const down = providerDown(provider, now);
    const unattached = (orphanRows || []).filter((o) => !o.business_id && !o.detached_at);
    const unmatched = (unmatchedRows || []).filter((e) => !e.business_id && !e.resolved_at);
    for (const i of platformAttention({
      providerStatus: provider,
      repliesToday,
      ceiling,
      orphans: [...unattached.map((o) => ({ id: o.id, created_at: o.created_at })), ...unmatched.map((e) => ({ id: e.id, created_at: e.created_at }))],
      now,
    })) attention.push(attentionItem(i, null, null));
    sortAttention(attention);

    money.due_this_week_jod = dueWeekCents / 100;
    money.overdue_jod = overdueCents / 100;

    // «آخر ما حصل»: the 15 newest events across the shops shown, in Arabic.
    const nameOf = new Map(businesses.map((b) => [b.id, b.name]));
    const actorNames = await namesOf((recentRaw || []).map((e) => e.actor_user_id));
    const recentEvents = (recentRaw || []).map((e) => eventRow(e, {
      businessName: nameOf.get(e.business_id), actorName: actorNames.get(e.actor_user_id),
    }));

    res.json({
      generated_at: nowDate.toISOString(),
      platform: {
        provider: {
          ok: !down,
          kind: down ? provider.kind || null : null,
          provider: provider ? provider.provider || null : null,
          since: down ? provider.last_seen : null,
        },
        replies_today: Number.isFinite(repliesToday) ? repliesToday : null,
        ceiling,
        ceiling_ratio: ceiling && Number.isFinite(repliesToday) ? Math.round((repliesToday / ceiling) * 100) / 100 : null,
        self_connect: platformSettings.isOn(settings.es_owner_enabled) ? 'invite' : 'closed',
      },
      funnel,
      money,
      totals,
      attention,
      recent_events: recentEvents,
      accounts,
      include_internal: includeInternal,
      hidden_internal_count: hiddenInternal,
      // Quality, throughput, number status and display-name status are read per account with its
      // own business token (metaStatus.refresh). Still not collected: the messaging tier — which
      // is a limit on conversations, not the sending rate `throughput` reports, so one does not
      // stand in for the other — and who changed a configuration. The payment method is knowable
      // only by asking a human, which is why it is a recorded confirmation rather than a field.
      unavailable: ['messaging_tier', 'config_change_actor'],
    });
  } catch (err) {
    console.error('[admin/overview] failed:', err.message);
    res.status(500).json({ error: 'تعذّر تحميل «اليوم»' });
  }
});

/** blocked > confirmed (null) > claimed > missing: which payment notice an onboarding row earns. */
function paymentState(onboarding) {
  if (!onboarding) return null;
  if (onboarding.payment_blocked_at) return 'blocked';
  if (onboarding.payment_method_ok) return null;
  return onboarding.payment_method_claimed_at ? 'claimed' : 'missing';
}

/**
 * One account, in depth: the three states, the onboarding checklist, and what is still
 * missing. Conversation content is deliberately absent — that is the audited inspection
 * route, not this one.
 */
router.get('/accounts/:id', async (req, res) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, name: true, slug: true, business_type: true, status: true,
        wa_phone_number_id: true, wa_business_account_id: true, wa_access_token: true,
        wa_app_id: true, ai_config: true, created_at: true, updated_at: true,
      },
    });
    if (!business) return res.status(404).json({ error: 'لا يوجد حساب بهذا المعرّف' });

    const onboarding = await prisma.whatsappOnboarding.findFirst({
      where: { business_id: business.id },
      orderBy: { created_at: 'desc' },
    });

    // Whether anyone on the customer's side can actually get in — the step that decides
    // whether what was sold has been handed over.
    const signedInOwner = await prisma.user.findFirst({
      where: { business_id: business.id, role: 'business_owner', last_login: { not: null } },
      select: { id: true },
    });
    const anyOwner = await prisma.user.findFirst({
      where: { business_id: business.id, role: 'business_owner' },
      select: { id: true },
    });

    // The same inputs the overview reads, so the fleet row and this page cannot show two
    // different agent states for one shop: the agent's state from its own newest reply, never
    // from last_outbound_at, which staff sends and stored alerts also stamp.
    const [latest, aiReply, conversations] = await Promise.all([
      prisma.conversation.aggregate({
        where: { business_id: business.id }, _max: { last_inbound_at: true, last_outbound_at: true },
      }),
      prisma.message.aggregate({
        where: { business_id: business.id, direction: 'outbound', is_ai_generated: true }, _max: { created_at: true },
      }),
      prisma.conversation.count({ where: { business_id: business.id } }),
    ]);

    const lastInbound = latest._max.last_inbound_at;
    const lastOutbound = latest._max.last_outbound_at;
    const lastAiReply = aiReply._max.created_at;
    const knowledgeCount = await prisma.businessKnowledge.count({ where: { business_id: business.id, active: true } });

    // The checklist is derived, never stored: a stored "done" drifts from reality the moment
    // someone changes a token by hand.
    const checklist = [
      { step: 'number', label: 'رقم واتساب مرتبط', done: Boolean(business.wa_phone_number_id) },
      { step: 'waba', label: 'حساب واتساب للأعمال', done: Boolean(business.wa_business_account_id) },
      { step: 'token', label: 'رمز وصول محفوظ', done: Boolean(business.wa_access_token) },
      { step: 'registered', label: 'الرقم مُسجَّل لدى Meta', done: onboarding ? onboarding.step === 'done' : null },
      { step: 'payment', label: 'طريقة دفع مضافة', done: onboarding ? onboarding.payment_method_ok : null },
      { step: 'greeting', label: 'رسالة ترحيب مضبوطة', done: Boolean(business.ai_config?.greeting_message) },
      // Only meaningful where the knowledge is not a menu or a service list.
      ...(['restaurant', 'clinic', 'shift'].includes(business.business_type) ? [] : [
        { step: 'knowledge', label: 'معلومات المنشأة مُدخلة', done: knowledgeCount > 0 },
      ]),
      { step: 'owner_login', label: 'حساب دخول لصاحب المنشأة', done: Boolean(anyOwner) },
      { step: 'owner_signed_in', label: 'صاحب المنشأة دخل فعليًا', done: Boolean(signedInOwner) },
      { step: 'first_message', label: 'أول رسالة واردة', done: Boolean(lastInbound) },
      { step: 'first_reply', label: 'أول رد من الوكيل', done: Boolean(lastAiReply) },
    ];

    res.json({
      account: {
        ...business,
        // Never send the token itself to a browser; whether one exists is the useful fact.
        wa_access_token: undefined,
        has_token: Boolean(business.wa_access_token),
        connection: connectionState(business, onboarding),
        agent: agentState(business, lastInbound, lastAiReply, knowledgeCount),
        knowledge_count: knowledgeCount,
        bot_enabled: business.ai_config?.enabled !== false,
        lifecycle: lifecycle(business, onboarding),
        last_inbound_at: lastInbound,
        last_outbound_at: lastOutbound,
        last_ai_reply_at: lastAiReply,
        conversations,
      },
      onboarding: onboarding ? {
        id: onboarding.id,
        step: onboarding.step,
        payment_method_ok: onboarding.payment_method_ok,
        payment_method_marked_by: onboarding.payment_method_marked_by,
        payment_method_marked_at: onboarding.payment_method_marked_at,
        payment_method_claimed_at: onboarding.payment_method_claimed_at,
        payment_blocked_at: onboarding.payment_blocked_at,
        // The sentence the account page shows, from the one server copy (config/metaNotices.js).
        payment_notice: paymentState(onboarding) && {
          state: paymentState(onboarding),
          short: paymentNotice(paymentState(onboarding), 'staff', 'short'),
          long: paymentNotice(paymentState(onboarding), 'staff', 'long'),
          whatsapp_manager_url: WHATSAPP_MANAGER_URL,
        },
        meta: {
          quality_rating: onboarding.meta_quality_rating,
          throughput: onboarding.meta_throughput,
          number_status: onboarding.meta_number_status,
          name_status: onboarding.meta_name_status,
          review_status: onboarding.meta_review_status,
          checked_at: onboarding.meta_checked_at,
        },
        waba_id: onboarding.waba_id,
        phone_number_id: onboarding.phone_number_id,
        last_error: onboarding.last_error,
        last_error_at: onboarding.last_error_at,
        token_exchanged_at: onboarding.token_exchanged_at,
        subscribed_at: onboarding.subscribed_at,
        registered_at: onboarding.registered_at,
      } : null,
      checklist,
    });
  } catch (err) {
    console.error('[admin/account] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Ask this account's agent a question through its REAL workflow, and send nothing.
 *
 * Formerly this built its own prompt and called the model directly, so a `generic` account —
 * fixed greeting in production, no model call — came back fluent here. It now runs the same
 * dispatch the webhook uses, with `has_workflow: false` said plainly when there is none.
 */
router.post('/accounts/:id/test-message', async (req, res) => {
  const text = String(req.body?.message || '').trim();
  if (!text) return res.status(400).json({ error: 'اكتب رسالة للتجربة' });
  if (text.length > 500) return res.status(400).json({ error: 'الرسالة طويلة' });
  const state = req.body?.state && typeof req.body.state === 'object' ? req.body.state : {};

  try {
    const business = await prisma.business.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, business_type: true, ai_config: true, policies: true, currency: true, language_default: true, opening_hours: true, timezone: true },
    });
    if (!business) return res.status(404).json({ error: 'لا يوجد حساب بهذا المعرّف' });

    const out = await dryRun(business, text, state);
    res.json({ ...out, ai_enabled: business.ai_config?.enabled !== false });
  } catch (err) {
    console.error('[admin/test-message] failed:', err.message);
    res.status(502).json({ error: `تعذّر توليد الرد: ${err.message}` });
  }
});

/**
 * Pause or resume this shop's bot.
 *
 * The «تفعيل الذكاء الاصطناعي» checkbox this replaces wrote ai_config.enabled from inside a whole
 * ai_config save, so a stale form could switch a paused bot back on, and nothing recorded why it
 * was off. Here the switch is its own call, the reason for a pause is required, and both
 * directions leave an AccountEvent the account's log and the owner can read later.
 *
 * Only ai_config.enabled changes, patched in Postgres, so the shop's other settings are untouched.
 * The inbox and the new-message alerts keep working while paused: that is the point of a pause.
 */
router.patch('/accounts/:id/bot', async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'حدّد هل البوت يعمل أم موقوف' });
  }
  const enabled = req.body.enabled;
  const reason = String(req.body?.reason || '').trim().slice(0, 300);
  if (!enabled && !reason) return res.status(400).json({ error: 'اكتب سبب إيقاف البوت' });

  try {
    const business = await prisma.business.findUnique({
      where: { id: req.params.id }, select: { id: true, ai_config: true },
    });
    if (!business) return res.status(404).json({ error: 'لا يوجد حساب بهذا المعرّف' });

    const wasEnabled = business.ai_config?.enabled !== false;
    // Pressing «أوقف» twice must not write two pauses into the log.
    // Except over the owner's own pause: SHIFT's pause then takes it over, or the owner's switch
    // could lift what SHIFT just asked to stay off.
    const takesOverOwnerPause = !enabled && business.ai_config?.paused_by === 'owner';
    if (wasEnabled === enabled && !takesOverOwnerPause) return res.json({ enabled, changed: false });

    // paused_by marks the pause as SHIFT's, so the owner's switch on /bot cannot lift it; resuming
    // clears it (and the late policy's pause_reason), and the owner may pause and resume again.
    const { ok } = enabled
      ? await jsonb.patchJson('businesses', business.id, 'ai_config', { enabled }, { remove: ['paused_by', 'pause_reason'] })
      : await jsonb.patchJson('businesses', business.id, 'ai_config', { enabled, paused_by: 'shift' });
    if (!ok) return res.status(404).json({ error: 'لا يوجد حساب بهذا المعرّف' });

    await shiftEvent(req, business.id, enabled ? 'bot_resumed' : 'bot_paused', reason ? { reason } : {});
    res.json({ enabled, changed: true });
  } catch (err) {
    console.error('[admin/bot] failed:', err.message);
    res.status(500).json({ error: 'تعذّر تغيير حالة البوت' });
  }
});

/**
 * The inspection hatch.
 *
 * SHIFT sells a bot's replies, so when an owner says "it quoted the wrong price", the health
 * table is useless — it shows the agent answering, because it is, wrongly. The only thing
 * that answers the question is what the bot actually said.
 *
 * So staff can read a customer's threads, and every read is written to admin_access_logs
 * first. Read-only: there is no send, no claim, no takeover on these routes. The cost of not
 * having this is worse — support asking owners for their passwords, with no record at all.
 */
async function recordAccess(req, businessId, action, conversationId = null) {
  try {
    await prisma.adminAccessLog.create({
      data: {
        admin_user_id: req.user.id,
        admin_email: req.user.email || '',
        business_id: businessId,
        conversation_id: conversationId,
        action,
      },
    });
  } catch (err) {
    // The log is the point of the feature: if it cannot be written, the read does not happen.
    throw new Error(`could not record admin access: ${err.message}`);
  }
}

// The thread view shows the newest messages, oldest first: the recent wrong answer is the reason
// anyone opens it (it used to show the oldest 200, so that answer could be missing).
const THREAD_LIMIT = 200;
const LIST_LIMIT = 30;
const SEARCH_LIMIT = 50;
const MEDIA_LABEL = {
  audio: '[رسالة صوتية]', voice: '[رسالة صوتية]', image: '[صورة]', video: '[فيديو]',
  document: '[ملف]', sticker: '[ملصق]', location: '[موقع]', contacts: '[جهة اتصال]',
};

/**
 * What a message said, for a reader: its text, or for a voice note, photo or video the transcript
 * the bot read it with (messageProcessor.readTenantMedia stores it in raw_payload.shift_media), or
 * its label when it was never read. The raw webhook payload itself never leaves this function.
 */
function inspectedMessage(m) {
  const media = m.raw_payload && typeof m.raw_payload === 'object' ? m.raw_payload.shift_media : null;
  const transcript = media && typeof media.text === 'string' && media.text.trim() ? media.text.trim() : null;
  const label = MEDIA_LABEL[m.message_type] || null;
  let author = 'customer';
  if (m.direction === 'outbound') author = m.is_ai_generated ? 'bot' : 'staff';
  return {
    id: m.id,
    direction: m.direction,
    message_type: m.message_type,
    text_body: m.text_body,
    display_text: transcript ? `${label || '[مرفق]'} ${transcript}` : (m.text_body || label || ''),
    transcript,
    status: m.status,
    created_at: m.created_at,
    sender_wa_id: m.sender_wa_id,
    // Whether the agent or a human wrote it is the whole question when a reply looks wrong.
    is_ai_generated: m.is_ai_generated,
    author,
    author_ar: { customer: 'الزبون', bot: 'البوت', staff: 'موظف' }[author],
  };
}

router.get('/accounts/:id/conversations', async (req, res) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true },
    });
    if (!business) return res.status(404).json({ error: 'لا يوجد حساب بهذا المعرّف' });

    // «ابحث برقم الزبون أو اسمه». Digits are matched against the number in any form typed
    // (‎+962 7…, 07…); anything else against the WhatsApp profile name.
    const search = String(req.query.search || '').trim().slice(0, 60);
    const where = { business_id: business.id };
    if (search) {
      const digits = search.replace(/[^\d٠-٩]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
      const local = digits.startsWith('0') ? digits.slice(1) : digits;
      where.OR = [
        { profile_name: { contains: search, mode: 'insensitive' } },
        ...(local.length >= 3 ? [{ customer_wa_id: { contains: local } }] : []),
      ];
    }

    await recordAccess(req, business.id, search ? 'workspace_search' : 'workspace_list');

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: { last_message_at: 'desc' },
      take: search ? SEARCH_LIMIT : LIST_LIMIT,
      select: {
        id: true, customer_wa_id: true, profile_name: true, status: true,
        last_message_at: true, last_inbound_at: true, unread_count: true, ai_enabled: true,
      },
    });

    res.json({ business, conversations, search: search || null, read_only: true });
  } catch (err) {
    console.error('[admin/workspace] failed:', err.message);
    res.status(500).json({ error: 'تعذّر تحميل المحادثات' });
  }
});

router.get('/accounts/:id/conversations/:conversationId', async (req, res) => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.conversationId, business_id: req.params.id },
      select: { id: true, customer_wa_id: true, profile_name: true, status: true, ai_enabled: true },
    });
    if (!conversation) return res.status(404).json({ error: 'لا توجد محادثة بهذا المعرّف' });

    await recordAccess(req, req.params.id, 'workspace_thread', conversation.id);

    // Newest 200, then put back in reading order.
    const newest = await prisma.message.findMany({
      where: { conversation_id: conversation.id },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: THREAD_LIMIT,
      select: {
        id: true, direction: true, message_type: true, text_body: true,
        status: true, created_at: true, sender_wa_id: true, is_ai_generated: true, raw_payload: true,
      },
    });
    const messages = [...newest].reverse().map(inspectedMessage);

    res.json({ conversation, messages, truncated: newest.length >= THREAD_LIMIT, read_only: true });
  } catch (err) {
    console.error('[admin/workspace-thread] failed:', err.message);
    res.status(500).json({ error: 'تعذّر تحميل المحادثة' });
  }
});

/**
 * Handing over what was sold.
 *
 * Closing a deal used to end with a customer who had no way in: the API to create their owner
 * existed, but nothing called it with a business, so the practical path was a shell script.
 * These three routes are the missing handover — and the business is always taken from the URL,
 * never from the request body, so an admin cannot attach a user to the wrong account by typo.
 */
const bcryptAdmin = require('bcryptjs');
const activation = require('../services/activation');
const { normalizeEmail, normalizeLoginPhone, loginTaken, LOGIN_TAKEN_ERROR } = require('../utils/login');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A customer's people only. platform_admin is never created from an account screen.
const CUSTOMER_ROLES = ['business_owner', 'manager', 'staff'];

router.get('/accounts/:id/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { business_id: req.params.id },
      select: { id: true, name: true, email: true, phone: true, role: true, active: true, last_login: true, created_at: true },
      orderBy: { created_at: 'asc' },
    });

    const pending = await prisma.userActivation.findMany({
      where: { user_id: { in: users.map((u) => u.id) }, used_at: null, expires_at: { gt: new Date() } },
      select: { user_id: true, expires_at: true },
    });
    const pendingByUser = new Map(pending.map((p) => [p.user_id, p.expires_at]));

    res.json({
      users: users.map((u) => ({
        ...u,
        // Never the token — only whether one is outstanding.
        invitation_pending_until: pendingByUser.get(u.id) || null,
        has_signed_in: Boolean(u.last_login),
      })),
    });
  } catch (err) {
    console.error('[admin/users] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Create a login for this account's owner and return a one-time link to send them. */
router.post('/accounts/:id/users', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  // An owner signs in with their mobile, an email, or both (Migration 2). Either one that is
  // given must be valid: a typo here is an account nobody can sign in to.
  const email = normalizeEmail(req.body?.email);
  const rawPhone = req.body?.phone;
  const phone = rawPhone ? normalizeLoginPhone(rawPhone) : null;
  const role = String(req.body?.role || 'business_owner');

  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'بريد إلكتروني غير صالح' });
  if (rawPhone && !phone) return res.status(400).json({ error: 'رقم الموبايل غير صحيح' });
  if (!email && !phone) return res.status(400).json({ error: 'أدخل رقم الموبايل أو البريد الإلكتروني' });
  if (!CUSTOMER_ROLES.includes(role)) return res.status(400).json({ error: 'صلاحية غير مسموحة' });

  try {
    const business = await prisma.business.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
    if (!business) return res.status(404).json({ error: 'لا يوجد حساب بهذا المعرّف' });

    const taken = await loginTaken({ email, phone });
    if (taken) return res.status(409).json({ error: LOGIN_TAKEN_ERROR[taken] });

    // A password is required by the schema, so one is set that nobody knows and nobody can use:
    // the account is unusable until the activation link is redeemed.
    const unusable = await bcryptAdmin.hash(crypto.randomBytes(32).toString('hex'), 12);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        password: unusable,
        role,
        business_id: business.id, // from the URL, never the body
        active: false,            // becomes active when they set a password
      },
      select: { id: true, name: true, email: true, phone: true, role: true },
    });

    await recordAccess(req, business.id, 'user_created', null);
    const { token, expires_in_hours } = await activation.issue(user.id, req.user.id);
    // Who and which role, never the link: the token in it is a password.
    await shiftEvent(req, business.id, 'user_added', { user_id: user.id, role: user.role });

    res.status(201).json({
      user,
      business: { id: business.id, name: business.name },
      activation_path: `/activate#${token}`,
      expires_in_hours,
    });
  } catch (err) {
    console.error('[admin/create-user] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Re-issue a link — for one that expired, or when the customer never received it. */
router.post('/accounts/:id/users/:userId/invite', async (req, res) => {
  try {
    const user = await prisma.user.findFirst({
      where: { id: req.params.userId, business_id: req.params.id },
      // Scoped to the account in the URL, so a user id from another tenant is simply not found.
      select: { id: true, name: true, email: true, phone: true, role: true, active: true, last_login: true },
    });
    if (!user) return res.status(404).json({ error: 'لا يوجد مستخدم بهذا المعرّف في هذا الحساب' });

    // A re-invite is for a login that was never used. Once the customer holds the account, a
    // fresh link would let SHIFT staff set their password and sign in as them — the exact thing
    // this whole flow exists to make impossible. A genuinely locked-out owner is recovered
    // deliberately: deactivate the login first, which revokes and records, then invite again.
    if (user.active && user.last_login) {
      return res.status(409).json({
        error: 'هذا الحساب مُفعَّل ويستخدمه العميل. لإعادة ضبطه: عطّل الحساب أولًا ثم أرسل دعوة جديدة.',
      });
    }

    await recordAccess(req, req.params.id, 'user_invite', null);
    const { token, expires_in_hours } = await activation.issue(user.id, req.user.id);
    await shiftEvent(req, req.params.id, 'invite_created', { user_id: user.id, role: user.role, reissued: true });
    res.json({ user, activation_path: `/activate#${token}`, expires_in_hours });
  } catch (err) {
    console.error('[admin/reinvite] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * «الدخول»: switch a login off or on, or change its role.
 *
 * Mirrors the owner's own team route (routes/team.js PATCH /:id) with SHIFT as the actor, minus
 * the seat limit: SHIFT may lend a seat. Switching a login off takes its outstanding link with it
 * and ends its sessions, or whoever holds either walks straight back in. A login that never chose
 * a password cannot be switched on (it would read «فعّال» and still be unable to sign in); its
 * way in is a new link. The shop's only owner keeps the owner role: demoting them would leave a
 * shop nobody can run. Deactivating them is allowed, because it is the first step of a reset.
 */
router.patch('/accounts/:id/users/:userId', async (req, res) => {
  const body = req.body || {};
  const data = {};
  if (body.role !== undefined) {
    if (!CUSTOMER_ROLES.includes(body.role)) return res.status(400).json({ error: 'صلاحية غير مسموحة' });
    data.role = body.role;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return res.status(400).json({ error: 'حدّد هل الدخول فعّال أم معطّل' });
    data.active = body.active;
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'لا يوجد تغيير' });

  try {
    const user = await prisma.user.findFirst({
      where: { id: req.params.userId, business_id: req.params.id },
      select: { id: true, name: true, role: true, active: true, last_login: true },
    });
    if (!user) return res.status(404).json({ error: 'لا يوجد مستخدم بهذا المعرّف في هذا الحساب' });

    if (data.active === true && !user.active && !user.last_login) {
      return res.status(409).json({ error: 'لم يختر هذا المستخدم كلمة مرور بعد — أرسل له رابطًا جديدًا بدل التفعيل' });
    }
    if (data.role && data.role !== 'business_owner' && user.role === 'business_owner') {
      const otherOwners = await prisma.user.count({
        where: { business_id: req.params.id, role: 'business_owner', active: true, id: { not: user.id } },
      });
      if (!otherOwners) return res.status(409).json({ error: 'هذا صاحب المحل الوحيد — عيّن صاحبًا آخر قبل تغيير دوره' });
    }

    await recordAccess(req, req.params.id, 'user_updated');
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: data.active === false ? { ...data, sessions_valid_from: new Date() } : data,
        select: { id: true, name: true, phone: true, email: true, role: true, active: true, last_login: true },
      });
      if (data.active === false) await activation.revoke(user.id, tx);
      const actor = { businessId: req.params.id, actorUserId: req.user.id, actorKind: 'shift' };
      if (data.role && data.role !== user.role) {
        await tx.accountEvent.create({ data: accountEvents.toRow({ ...actor, type: 'role_changed', data: { user_id: user.id, from: user.role, to: data.role } }) });
      }
      if (typeof data.active === 'boolean' && data.active !== user.active) {
        await tx.accountEvent.create({ data: accountEvents.toRow({ ...actor, type: data.active ? 'user_reactivated' : 'user_deactivated', data: { user_id: user.id } }) });
      }
      return updated;
    });
    res.json({ user: row });
  } catch (err) {
    console.error('[admin/users/update] failed:', err.message);
    res.status(500).json({ error: 'تعذّر تعديل المستخدم' });
  }
});

/**
 * «إعادة ضبط الدخول»: a locked-out owner (lost phone, forgotten password, a login someone else
 * got hold of). In one transaction: the login is switched off, every session it holds ends, its
 * old links die and a new one is made. It opens on /join for an owner and /activate for the
 * team, like their first invitation. Audited twice: the access log (who at SHIFT did it) and the
 * shop's own «السجل» (login_reset). The link is returned once, for SHIFT to send, and never stored
 * or logged: the token in it is a password.
 */
router.post('/accounts/:id/users/:userId/reset', async (req, res) => {
  try {
    const business = await prisma.business.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, owner_phone: true } });
    if (!business) return res.status(404).json({ error: 'لا يوجد حساب بهذا المعرّف' });
    const user = await prisma.user.findFirst({
      where: { id: req.params.userId, business_id: business.id },
      select: { id: true, name: true, phone: true, role: true, active: true },
    });
    if (!user) return res.status(404).json({ error: 'لا يوجد مستخدم بهذا المعرّف في هذا الحساب' });
    if (!CUSTOMER_ROLES.includes(user.role)) return res.status(403).json({ error: 'لا يمكن إعادة ضبط هذا الحساب من هنا' });

    // The record comes first: if it cannot be written, the reset does not happen.
    await recordAccess(req, business.id, 'user_reset');
    const ttlDays = await adminAccounts.inviteTtlDays();
    const link = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { active: false, sessions_valid_from: new Date() } });
      const revoked = await activation.revoke(user.id, tx);
      const issued = await activation.issue(user.id, req.user.id, { ttlHours: ttlDays * 24, client: tx });
      await tx.accountEvent.create({
        data: accountEvents.toRow({
          businessId: business.id, actorUserId: req.user.id, actorKind: 'shift', type: 'login_reset',
          data: { user_id: user.id, role: user.role, revoked, was_active: user.active, expires_at: issued.expires_at },
        }),
      });
      return issued;
    });

    const path = user.role === 'business_owner' ? 'join' : 'activate';
    const joinUrl = `${adminAccounts.appOrigin()}/${path}#${link.token}`;
    const greeting = firstName(user.name) ? `مرحبًا ${firstName(user.name)}` : 'مرحبًا';
    const text = `${greeting}، هذا رابط جديد للدخول إلى كرم بوت ${adminAccounts.forShop(business.name)}: ${joinUrl} — `
      + `صالح ${labels.days(ttlDays)}. اختر منه كلمة مرور جديدة. الرابط القديم لم يعد يعمل.`;
    const phone = user.phone || (user.role === 'business_owner' ? business.owner_phone : null);
    res.json({
      user: { id: user.id, name: user.name, role: user.role, active: false },
      join_url: joinUrl,
      wa_share_url: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : null,
      share_text: text,
      expires_at: link.expires_at,
    });
  } catch (err) {
    console.error('[admin/users/reset] failed:', err.message);
    res.status(500).json({ error: 'تعذّر إعادة ضبط الدخول' });
  }
});

/**
 * «السجل» and «آخر ما حصل»: AccountEvents newest first, in Arabic. With business_id, one shop's
 * log, with SHIFT's reads of its conversations (admin_access_logs) merged in, so every look at a
 * shop's data shows up next to what changed. Without it, the fleet's feed (customer shops only:
 * the internal rows stay hidden, as everywhere on this panel). `before` pages by time.
 */
router.get('/events', async (req, res) => {
  const businessId = req.query.business_id ? String(req.query.business_id) : null;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const beforeRaw = req.query.before ? new Date(String(req.query.before)) : null;
  const before = beforeRaw && !Number.isNaN(beforeRaw.getTime()) ? beforeRaw : null;
  const timeWhere = before ? { created_at: { lt: before } } : {};

  try {
    let scope;
    if (businessId) {
      scope = { business_id: businessId };
    } else {
      const shops = await prisma.business.findMany({ where: { is_internal: false }, select: { id: true } });
      scope = { business_id: { in: shops.map((b) => b.id) } };
    }
    const [events, access] = await Promise.all([
      prisma.accountEvent.findMany({
        where: { ...scope, ...timeWhere },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      businessId ? prisma.adminAccessLog.findMany({
        where: { business_id: businessId, ...timeWhere },
        orderBy: { created_at: 'desc' },
        take: limit,
      }) : [],
    ]);

    const businessIds = [...new Set([...events.map((e) => e.business_id), ...access.map((a) => a.business_id)].filter(Boolean))];
    const nameOf = new Map(businessIds.length
      ? (await prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true } })).map((b) => [b.id, b.name])
      : []);
    const actorNames = await namesOf([...events.map((e) => e.actor_user_id), ...access.map((a) => a.admin_user_id)]);

    const rows = [
      ...events.map((e) => eventRow(e, { businessName: nameOf.get(e.business_id), actorName: actorNames.get(e.actor_user_id) })),
      ...access.map((a) => ({
        id: `access_${a.id}`,
        at: a.created_at,
        business_id: a.business_id,
        business_name: nameOf.get(a.business_id) || null,
        actor_ar: labels.actorText('shift', actorNames.get(a.admin_user_id) ? firstName(actorNames.get(a.admin_user_id)) : null),
        type: 'admin_access',
        text_ar: labels.accessText(a.action),
      })),
    ].sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, limit);

    res.json({ events: rows, next_before: rows.length === limit ? rows[rows.length - 1].at : null });
  } catch (err) {
    console.error('[admin/events] failed:', err.message);
    res.status(500).json({ error: 'تعذّر تحميل السجل' });
  }
});

/**
 * Contracts.
 *
 * A signed customer is a subscription row: which solution, on what terms, since when, and
 * what has been paid against it. Payments are recorded by staff with the transfer or CliQ
 * reference — the record you would reconcile a bank statement against. No gateway: Stripe
 * does not serve Jordan, and ten contracts do not justify integrating one that does.
 */
const SOLUTIONS = ['karam_bot', 'automation', 'website', 'custom'];
const SUB_STATUSES = ['trial', 'active', 'past_due', 'paused', 'cancelled'];
const CYCLES = ['monthly', 'quarterly', 'yearly', 'one_time'];
const METHODS = ['bank_transfer', 'cliq', 'cash', 'card', 'other'];

const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const dateOrNull = (v) => (v ? new Date(v) : null);
const validDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());

/** Advance a due date by one billing cycle. one_time has no next date. */
function nextDue(from, cycle) {
  if (!from || cycle === 'one_time') return null;
  const d = new Date(from);
  if (cycle === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (cycle === 'quarterly') d.setMonth(d.getMonth() + 3);
  else if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return d;
}

function publicSubscription(row) {
  const paid = (row.payments || []).reduce((sum, p) => sum + Number(p.amount_jod), 0);
  return {
    id: row.id,
    business_id: row.business_id,
    solution: row.solution,
    plan_name: row.plan_name,
    status: row.status,
    amount_jod: Number(row.amount_jod),
    billing_cycle: row.billing_cycle,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    next_due_at: row.next_due_at,
    trial_ends_at: row.trial_ends_at || null,
    ai_replies_month: row.ai_replies_month ?? null,
    cancelled_at: row.cancelled_at,
    notes: row.notes,
    total_paid_jod: Math.round(paid * 100) / 100,
    payments: (row.payments || []).map((p) => ({
      id: p.id, amount_jod: Number(p.amount_jod), paid_at: p.paid_at, method: p.method,
      reference: p.reference, note: p.note, recorded_by: p.recorded_by,
    })),
    created_at: row.created_at,
  };
}

router.get('/accounts/:id/subscriptions', async (req, res) => {
  try {
    const rows = await prisma.subscription.findMany({
      where: { business_id: req.params.id },
      include: { payments: { orderBy: { paid_at: 'desc' } } },
      orderBy: { created_at: 'desc' },
    });
    res.json({ subscriptions: rows.map(publicSubscription) });
  } catch (err) {
    console.error('[admin/subscriptions] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/accounts/:id/subscriptions', async (req, res) => {
  const b = req.body || {};
  const solution = String(b.solution || '');
  const cycle = String(b.billing_cycle || 'monthly');
  const status = String(b.status || 'active');
  const amount = money(b.amount_jod);
  const startsAt = dateOrNull(b.starts_at) || new Date();

  if (!SOLUTIONS.includes(solution)) return res.status(400).json({ error: 'الحل غير معروف' });
  if (!CYCLES.includes(cycle)) return res.status(400).json({ error: 'دورة الفوترة غير صالحة' });
  if (!SUB_STATUSES.includes(status)) return res.status(400).json({ error: 'الحالة غير صالحة' });
  if (amount === null) return res.status(400).json({ error: 'المبلغ غير صالح' });
  if (!validDate(startsAt)) return res.status(400).json({ error: 'تاريخ البداية غير صالح' });

  try {
    const business = await prisma.business.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!business) return res.status(404).json({ error: 'لا يوجد حساب بهذا المعرّف' });

    const row = await prisma.subscription.create({
      data: {
        business_id: business.id, // from the URL, never the body
        solution,
        plan_name: b.plan_name ? String(b.plan_name).slice(0, 120) : null,
        status,
        amount_jod: amount,
        billing_cycle: cycle,
        starts_at: startsAt,
        ends_at: dateOrNull(b.ends_at),
        next_due_at: b.next_due_at ? dateOrNull(b.next_due_at) : nextDue(startsAt, cycle),
        notes: b.notes ? String(b.notes).slice(0, 2000) : null,
        created_by: req.user.id,
      },
      include: { payments: true },
    });
    await shiftEvent(req, business.id, 'contract_created', {
      subscription_id: row.id, solution, status, amount_jod: amount, billing_cycle: cycle,
    });
    res.status(201).json({ subscription: publicSubscription(row) });
  } catch (err) {
    console.error('[admin/subscriptions/create] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/accounts/:id/subscriptions/:sid', async (req, res) => {
  const b = req.body || {};
  const data = {};
  if (b.status !== undefined) {
    if (!SUB_STATUSES.includes(b.status)) return res.status(400).json({ error: 'الحالة غير صالحة' });
    data.status = b.status;
    if (b.status === 'cancelled') data.cancelled_at = new Date();
  }
  if (b.plan_name !== undefined) data.plan_name = b.plan_name ? String(b.plan_name).slice(0, 120) : null;
  if (b.amount_jod !== undefined) {
    const amount = money(b.amount_jod);
    if (amount === null) return res.status(400).json({ error: 'المبلغ غير صالح' });
    data.amount_jod = amount;
  }
  if (b.next_due_at !== undefined) data.next_due_at = dateOrNull(b.next_due_at);
  if (b.ends_at !== undefined) data.ends_at = dateOrNull(b.ends_at);
  if (b.notes !== undefined) data.notes = b.notes ? String(b.notes).slice(0, 2000) : null;
  // «الحد الشهري للردود» and «نهاية الشهر المجاني» on the contract tab. null on the cap means the
  // platform default (costGuard reads Subscription.ai_replies_month first, then ai_limits).
  if (b.ai_replies_month !== undefined) {
    const cap = b.ai_replies_month === null || b.ai_replies_month === '' ? null : Number(b.ai_replies_month);
    if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > 1000000)) {
      return res.status(400).json({ error: 'الحد الشهري للردود يجب أن يكون رقمًا صحيحًا موجبًا' });
    }
    data.ai_replies_month = cap;
  }
  if (b.trial_ends_at !== undefined) {
    const ends = dateOrNull(b.trial_ends_at);
    if (ends && !validDate(ends)) return res.status(400).json({ error: 'تاريخ نهاية الشهر المجاني غير صالح' });
    data.trial_ends_at = ends;
  }

  try {
    // Scoped to the account in the URL: a subscription id from another tenant is not found.
    const existing = await prisma.subscription.findFirst({
      where: { id: req.params.sid, business_id: req.params.id },
      select: { id: true, trial_ends_at: true, next_due_at: true },
    });
    if (!existing) return res.status(404).json({ error: 'لا يوجد اشتراك بهذا المعرّف في هذا الحساب' });
    // A free month's first payment is due when it ends; when the due date was following the old
    // end (as wentLive sets it), it follows the new one, unless a due date was sent with it.
    if (data.trial_ends_at && b.next_due_at === undefined && existing.trial_ends_at && existing.next_due_at
      && new Date(existing.next_due_at).getTime() === new Date(existing.trial_ends_at).getTime()) {
      data.next_due_at = data.trial_ends_at;
    }

    const row = await prisma.subscription.update({ where: { id: existing.id }, data, include: { payments: { orderBy: { paid_at: 'desc' } } } });
    await shiftEvent(req, req.params.id, 'contract_updated', {
      subscription_id: existing.id, changed: Object.keys(data), status: row.status,
    });
    // Set back to active by hand (a payment arranged outside the panel): the late pause goes too.
    const botResumed = data.status === 'active'
      ? await latePolicy.liftLatePause(req.params.id, { actorUserId: req.user.id, reason: 'contract_active' })
      : false;
    res.json({ subscription: publicSubscription(row), bot_resumed: botResumed });
  } catch (err) {
    console.error('[admin/subscriptions/update] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * How many whole billing cycles a payment completes, in cents so 19.99 + 19.99 is exactly two.
 *
 * Every payment on a contract counts toward one running total, and the due date moves one cycle
 * each time that total crosses another multiple of the price. A partial payment (10 of 19.99)
 * therefore moves nothing; the rest of it (9.99) moves the date one cycle; 40 at once moves two.
 * The old rule advanced a full cycle on any amount, so 5 JD bought a month (admin.js:712-748).
 */
function cyclesCompleted(priorPaid, amount, price) {
  const cents = (v) => Math.round(Number(v || 0) * 100);
  const p = cents(price);
  if (p <= 0) return 0;
  return Math.floor((cents(priorPaid) + cents(amount)) / p) - Math.floor(cents(priorPaid) / p);
}

/** Advance a due date by `n` billing cycles. */
function advanceDue(from, cycle, n) {
  let d = from;
  for (let i = 0; i < n && d; i += 1) d = nextDue(d, cycle);
  return d;
}

/**
 * Record a payment.
 *
 * A free-month contract becomes «فعّال» with its first payment, whatever the amount: the shop has
 * started paying. A past_due one becomes active once the late cycle is fully paid. The due date
 * moves only by the cycles the running total completes (cyclesCompleted). A bot the late policy
 * paused comes back on when the contract is no longer past_due (services/latePolicy.js).
 */
router.post('/accounts/:id/subscriptions/:sid/payments', async (req, res) => {
  const b = req.body || {};
  const amount = money(b.amount_jod);
  const method = String(b.method || '');
  const paidAt = dateOrNull(b.paid_at) || new Date();
  if (amount === null || amount === 0) return res.status(400).json({ error: 'المبلغ غير صالح' });
  if (!METHODS.includes(method)) return res.status(400).json({ error: 'طريقة الدفع غير معروفة' });
  if (!validDate(paidAt)) return res.status(400).json({ error: 'تاريخ الدفع غير صالح' });

  try {
    const sub = await prisma.subscription.findFirst({
      where: { id: req.params.sid, business_id: req.params.id },
      include: { payments: { select: { amount_jod: true } } },
    });
    if (!sub) return res.status(404).json({ error: 'لا يوجد اشتراك بهذا المعرّف في هذا الحساب' });

    const priorPaid = (sub.payments || []).reduce((sum, p) => sum + Number(p.amount_jod || 0), 0);
    const cycles = sub.billing_cycle === 'one_time' ? 0 : cyclesCompleted(priorPaid, amount, sub.amount_jod);

    const row = await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          subscription_id: sub.id,
          business_id: sub.business_id,
          amount_jod: amount,
          paid_at: paidAt,
          method,
          reference: b.reference ? String(b.reference).slice(0, 120) : null,
          note: b.note ? String(b.note).slice(0, 500) : null,
          recorded_by: req.user.id,
        },
      });
      const advance = {};
      if (sub.status === 'trial') advance.status = 'active';
      else if (sub.status === 'past_due' && cycles > 0) advance.status = 'active';
      if (cycles > 0) advance.next_due_at = advanceDue(sub.next_due_at || paidAt, sub.billing_cycle, cycles);
      return tx.subscription.update({ where: { id: sub.id }, data: advance, include: { payments: { orderBy: { paid_at: 'desc' } } } });
    });
    // After the commit rather than inside it: a failed log write inside a Postgres transaction
    // would abort the payment it describes.
    await shiftEvent(req, sub.business_id, 'payment_recorded', {
      subscription_id: sub.id, amount_jod: amount, method, paid_at: paidAt.toISOString(),
      reference: b.reference ? String(b.reference).slice(0, 120) : null,
      cycles, partial: cycles === 0 && sub.billing_cycle !== 'one_time',
    });
    const botResumed = row && row.status !== 'past_due'
      ? await latePolicy.liftLatePause(sub.business_id, { actorUserId: req.user.id, reason: 'payment_recorded' })
      : false;
    res.status(201).json({ subscription: publicSubscription(row), cycles_paid: cycles, bot_resumed: botResumed });
  } catch (err) {
    console.error('[admin/payments] failed:', err.message);
    res.status(500).json({ error: 'تعذّر تسجيل الدفعة' });
  }
});

/** Ask Meta what it currently says about this account's number. */
router.post('/accounts/:id/meta/refresh', async (req, res) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.params.id },
      select: { id: true, wa_business_account_id: true, wa_phone_number_id: true, wa_access_token: true },
    });
    if (!business) return res.status(404).json({ error: 'لا يوجد حساب بهذا المعرّف' });
    res.json({ meta: await refreshMetaStatus(business) });
  } catch (err) {
    console.error('[admin/meta-refresh] failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

/**
 * Confirm — or un-confirm — that the customer has a payment method on file.
 *
 * Meta will not tell us, and an account without one has its service messages refused: the bot
 * goes silent. So this is a deliberate human statement, recorded with who made it (on the row and
 * as an AccountEvent), rather than a box that drifts quietly out of date.
 */
router.patch('/accounts/:id/payment-method', async (req, res) => {
  // Deliberately strict: `{}` would otherwise silently revoke a confirmation and erase who made
  // it, and the string "false" would confirm one. This field is a person's statement about money.
  if (typeof req.body?.payment_method_ok !== 'boolean') {
    return res.status(400).json({ error: 'payment_method_ok يجب أن يكون true أو false' });
  }
  const ok = req.body.payment_method_ok;
  try {
    const onboarding = await prisma.whatsappOnboarding.findFirst({
      where: { business_id: req.params.id }, orderBy: { created_at: 'desc' }, select: { id: true },
    });
    if (!onboarding) return res.status(404).json({ error: 'لا يوجد سجل توصيل لهذا الحساب' });

    const row = await prisma.whatsappOnboarding.update({
      where: { id: onboarding.id },
      data: {
        payment_method_ok: ok,
        payment_method_marked_by: ok ? req.user.email || req.user.id : null,
        payment_method_marked_at: ok ? new Date() : null,
      },
      select: { payment_method_ok: true, payment_method_marked_by: true, payment_method_marked_at: true },
    });
    await shiftEvent(req, req.params.id, ok ? 'payment_confirmed' : 'payment_confirmation_removed', {});
    res.json(row);
  } catch (err) {
    console.error('[admin/payment-method] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.cyclesCompleted = cyclesCompleted;
module.exports.attentionItem = attentionItem;
module.exports.fleetStage = fleetStage;
