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
  connectionState, agentState, lifecycle, minutesSince, isWaiting, isHandoffWaiting, shortDuration,
  QUIET_HOURS, UNANSWERED_MINUTES, UNANSWERED_MAX_HOURS, HANDOFF_MINUTES, PAYMENT_UNCONFIRMED_HOURS,
  WORKFLOW_TYPES,
} = require('../services/accountHealth');
const { dryRun } = require('../services/dryRun');
const { refresh: refreshMetaStatus, metaAttention } = require('../services/metaStatus');
const { paymentNotice, WHATSAPP_MANAGER_URL } = require('../config/metaNotices');
const accountEvents = require('../services/accountEvents');
const costGuard = require('../services/costGuard');
const jsonb = require('../db/jsonb');

// The waiting and handoff lists are read row by row; this caps a pathological day rather than
// shaping a normal one (ten shops have tens of open threads, not thousands).
const WAITING_SCAN_LIMIT = 2000;

/** The staff member behind an admin action, for AccountEvent rows. Never throws. */
const shiftEvent = (req, businessId, type, data = {}) =>
  accountEvents.record({ businessId, actorUserId: req.user?.id || null, actorKind: 'shift', type, data });

router.get('/overview', async (req, res) => {
  try {
    // SHIFT's own number and the -sim test shops are real rows that would otherwise inflate the
    // totals and fill the queue with our own traffic. Hidden by default, and said so.
    const includeInternal = ['1', 'true'].includes(String(req.query.include_internal || ''));
    const businessWhere = includeInternal ? {} : { is_internal: false };

    const [businesses, onboardings, hiddenInternal] = await Promise.all([
      prisma.business.findMany({
        where: businessWhere,
        select: {
          id: true, name: true, status: true, business_type: true, is_internal: true,
          wa_phone_number_id: true, wa_business_account_id: true, connected_at: true,
          wa_access_token: true, ai_config: true, created_at: true, updated_at: true,
        },
        orderBy: { created_at: 'asc' },
      }),
      prisma.whatsappOnboarding.findMany({
        select: {
          business_id: true, step: true, payment_method_ok: true,
          payment_method_claimed_at: true, payment_blocked_at: true, registered_at: true,
          last_error: true, last_error_at: true, updated_at: true,
          meta_quality_rating: true, meta_throughput: true, meta_number_status: true,
          meta_name_status: true, meta_review_status: true, meta_checked_at: true,
        },
      }),
      includeInternal ? 0 : prisma.business.count({ where: { is_internal: true } }),
    ]);

    const businessIds = businesses.map((b) => b.id);
    const inShown = { business_id: { in: businessIds } };
    const onboardingByBusiness = new Map(onboardings.filter((o) => o.business_id).map((o) => [o.business_id, o]));

    // The live contract per account: what they bought and whether it is paid. A cancelled one
    // is not "the contract" any more, so the newest non-cancelled row wins.
    const subs = await prisma.subscription.findMany({
      where: { status: { not: 'cancelled' }, ...inShown },
      orderBy: { created_at: 'desc' },
      select: { business_id: true, solution: true, plan_name: true, status: true, amount_jod: true, billing_cycle: true, next_due_at: true, starts_at: true, ai_replies_month: true },
    });
    const contractByBusiness = new Map();
    for (const sub of subs) if (!contractByBusiness.has(sub.business_id)) contractByBusiness.set(sub.business_id, sub);
    const DUE_SOON_DAYS = 7;

    // «ردود الشهر»: the cost guard's own counts and caps (services/costGuard.js), so the number on
    // this screen is the one the bot is held to. Unreadable usage is left out, not shown as zero.
    let usageByBusiness = new Map();
    try {
      usageByBusiness = await costGuard.fleetUsage(businessIds, { contracts: contractByBusiness });
    } catch (err) {
      console.error('[admin/overview] usage not read:', err.message);
    }

    // One grouped query rather than a query per account: this screen is opened often.
    // last_message_at moves on ANY message, including the customer's own, so it cannot tell "the
    // agent replied" from "the customer wrote". The newest reply is the per-business maximum of
    // Conversation.last_outbound_at — the same column the account page reads, so the two screens
    // can no longer disagree. It replaces a groupBy over the whole messages table.
    const convAgg = await prisma.conversation.groupBy({
      by: ['business_id'],
      where: inShown,
      _max: { last_inbound_at: true, last_message_at: true, last_outbound_at: true },
      _count: { _all: true },
      _sum: { unread_count: true },
    });
    const convByBusiness = new Map(convAgg.map((c) => [c.business_id, c]));

    // Whether the AGENT answers is read from the agent's own replies, not from last_outbound_at:
    // staff inbox sends, /ingest and stored staff alerts stamp that column too, so a dead bot
    // whose owner covers by hand (or whose handoff alert was just stored) would read «يرد»
    // (review 2026-10-08). last_outbound_at stays what the per-conversation waiting rules read.
    // Served by the (business_id, created_at) index.
    const aiReplyAgg = await prisma.message.groupBy({
      by: ['business_id'],
      where: { ...inShown, direction: 'outbound', is_ai_generated: true },
      _max: { created_at: true },
    });
    const aiReplyByBusiness = new Map(aiReplyAgg.map((m) => [m.business_id, m._max.created_at]));

    // A per-business maximum hides a single neglected thread behind a busy one, so waiting
    // customers are counted per conversation. Bounded by the 24-hour window and a row cap, and
    // only the four columns the rule reads; the comparison of two columns is done here because
    // Prisma cannot express coalesce(last_outbound_at, epoch) in a where.
    const now = Date.now();
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

    // Handed to the shop's team and left there.
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

    // A generic account with no knowledge entered greets and stops; the fleet view should say so.
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

    const totals = { onboarding: 0, active: 0, inactive: 0, suspended: 0 };
    const attention = [];
    const accounts = [];

    for (const b of businesses) {
      const onboarding = onboardingByBusiness.get(b.id) || null;
      const conv = convByBusiness.get(b.id) || null;
      const lastInbound = conv?._max?.last_inbound_at || null;
      const lastOutbound = conv?._max?.last_outbound_at || null;
      const lastAiReply = aiReplyByBusiness.get(b.id) || null;
      const lastActivity = conv?._max?.last_message_at || null;
      const waiting = waitingByBusiness.get(b.id) || { count: 0, oldest: null };
      const handoff = handoffByBusiness.get(b.id) || { count: 0, oldest: null };
      const knowledgeCount = knowledgeByBusiness.get(b.id) || 0;

      const bucket = lifecycle(b, onboarding);
      totals[bucket] += 1;

      const connection = connectionState(b, onboarding);
      const agent = agentState(b, lastInbound, lastAiReply, knowledgeCount);

      const contract = contractByBusiness.get(b.id) || null;
      const dueInDays = contract?.next_due_at ? Math.ceil((new Date(contract.next_due_at) - Date.now()) / 86400000) : null;

      accounts.push({
        id: b.id,
        name: b.name,
        business_type: b.business_type,
        is_internal: Boolean(b.is_internal),
        lifecycle: bucket,
        contract: contract ? {
          solution: contract.solution,
          plan_name: contract.plan_name,
          status: contract.status,
          amount_jod: Number(contract.amount_jod),
          billing_cycle: contract.billing_cycle,
          next_due_at: contract.next_due_at,
          due_in_days: dueInDays,
        } : null,
        status: b.status,
        connection,
        agent,
        bot_enabled: b.ai_config?.enabled !== false,
        usage: usageByBusiness.get(b.id) || null,
        conversations: conv?._count?._all || 0,
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

      // ── Attention queue ────────────────────────────────────────────────────
      // Only rules we can actually evaluate. A queue padded with signals we cannot
      // measure would be noise, and noise in this position is worse than an empty list.
      const push = (severity, category, message, since) =>
        attention.push({ business_id: b.id, business_name: b.name, severity, category, message, since });

      if (onboarding?.last_error) {
        push('critical', 'onboarding_error', `تعثّر التوصيل: ${onboarding.last_error}`.slice(0, 160), onboarding.last_error_at);
      }
      // A paused bot is silent on purpose: its waiting customers are the shop team's to answer,
      // and the pause itself is visible on the account.
      if (waiting.count > 0 && agent.state !== 'paused') {
        const since = shortDuration(minutesSince(waiting.oldest));
        push('critical', 'unanswered', waiting.count === 1
          ? `زبون ينتظر ردًا منذ ${since}`
          : `${waiting.count} زبائن ينتظرون ردًا — أقدمهم منذ ${since}`, waiting.oldest);
      }
      if (handoff.count > 0) {
        push('warning', 'handoff_waiting', handoff.count === 1
          ? 'محادثة محوّلة لفريق المحل بلا رد منذ أكثر من ساعة'
          : `${handoff.count} محادثات محوّلة لفريق المحل بلا رد منذ أكثر من ساعة`, handoff.oldest);
      }
      // Softened: before a number is connected there is nothing for the bot to answer yet, so an
      // empty knowledge base is a setup step, not an incident.
      if (b.wa_phone_number_id && !WORKFLOW_TYPES.includes(b.business_type) && knowledgeCount === 0) {
        push('warning', 'no_knowledge', 'لم تُدخل معلومات المحل — البوت يرحّب فقط', b.connected_at || b.created_at);
      }
      if (connection.state === 'down' && !b.wa_access_token) {
        push('critical', 'connection', 'الحساب بدون رمز وصول — لن تصل الرسائل', b.updated_at);
      }
      if (onboarding && onboarding.step !== 'done') {
        push('warning', 'onboarding_incomplete', `التوصيل لم يكتمل — ${onboarding.step}`, onboarding.updated_at);
      }
      // ── Payment method at Meta ────────────────────────────────────────────
      // Meta refusing a send with 131042 is the only evidence there is; everything short of that
      // is a confirmation nobody has made yet, and it waits 48 h after connecting before nagging.
      // The wording is config/metaNotices.js, shared with the account page and the owner's panel.
      if (onboarding?.payment_blocked_at) {
        push('critical', 'payment_blocked', paymentNotice('blocked', 'staff', 'short'), onboarding.payment_blocked_at);
      } else if (onboarding && onboarding.step === 'done' && !onboarding.payment_method_ok) {
        // connected_at is new (Migration 1); a shop connected before it has the onboarding times.
        const connectedAt = b.connected_at || onboarding.registered_at || onboarding.updated_at;
        if (connectedAt && minutesSince(connectedAt) > PAYMENT_UNCONFIRMED_HOURS * 60) {
          const claimed = Boolean(onboarding.payment_method_claimed_at);
          push('warning', 'payment_unconfirmed',
            `${paymentNotice(claimed ? 'claimed' : 'missing', 'staff', 'short')} — منذ ${shortDuration(minutesSince(connectedAt))}`,
            connectedAt);
        }
      }
      // Meta's own view of the account, from the last refresh.
      for (const m of metaAttention(onboarding)) push(m.severity, m.category, m.message, onboarding.meta_checked_at);

      // ── Monthly reply cap ──────────────────────────────────────────────────
      // SHIFT's own rows are never capped, so they never earn these.
      const usage = usageByBusiness.get(b.id);
      if (usage && usage.cap > 0 && !costGuard.isExempt(b)) {
        const shown = `(${usage.ai_replies_month.toLocaleString('en-US')} / ${usage.cap.toLocaleString('en-US')})`;
        if (usage.ai_replies_month >= usage.cap) {
          push('warning', 'cap_reached', contract?.status === 'trial'
            ? `وصل حد ردود الشهر ${shown} — البوت يحوّل الزبائن للفريق`
            : `وصل حد ردود الشهر ${shown} — اشتراك مدفوع، البوت مستمر`, null);
        } else if (usage.ai_replies_month >= Math.ceil(usage.cap * costGuard.WARN_RATIO)) {
          push('warning', 'cap_80', `استهلك 80% من ردود الشهر ${shown}`, null);
        }
      }

      // ── Money ──────────────────────────────────────────────────────────────
      if (contract?.status === 'past_due') {
        push('critical', 'past_due', `دفعة متأخرة — ${Number(contract.amount_jod)} د.أ`, contract.next_due_at);
      } else if (contract && dueInDays !== null && dueInDays < 0) {
        push('warning', 'overdue', `تجاوز موعد الدفع بـ ${Math.abs(dueInDays)} يوم — ${Number(contract.amount_jod)} د.أ`, contract.next_due_at);
      } else if (contract && dueInDays !== null && dueInDays <= DUE_SOON_DAYS) {
        push('info', 'due_soon', `دفعة مستحقة خلال ${dueInDays} يوم — ${Number(contract.amount_jod)} د.أ`, contract.next_due_at);
      }
      // An active, connected account with nothing sold against it is either a trial nobody
      // recorded or revenue nobody is collecting; both are worth a look, neither is an alarm.
      // Internal rows (SHIFT's own, the -sim shops) never have a contract and never will.
      if (!contract && bucket === 'active' && !b.is_internal) {
        push('info', 'no_contract', 'لا يوجد عقد مسجّل لهذا الحساب', b.created_at);
      }

      if (bucket === 'active' && lastActivity && minutesSince(lastActivity) > QUIET_HOURS * 60) {
        push('info', 'quiet', `لا نشاط منذ ${Math.round(minutesSince(lastActivity) / 60 / 24)} يوم`, lastActivity);
      }
    }

    const RANK = { critical: 0, warning: 1, info: 2 };
    attention.sort((a, b) => (RANK[a.severity] - RANK[b.severity]) || (new Date(a.since || 0) - new Date(b.since || 0)));

    res.json({
      generated_at: new Date().toISOString(),
      totals,
      attention,
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
    res.status(500).json({ error: err.message });
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
    if (wasEnabled === enabled) return res.json({ enabled, changed: false });

    const { ok } = await jsonb.patchJson('businesses', business.id, 'ai_config', { enabled });
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

router.get('/accounts/:id/conversations', async (req, res) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true },
    });
    if (!business) return res.status(404).json({ error: 'لا يوجد حساب بهذا المعرّف' });

    await recordAccess(req, business.id, 'workspace_list');

    const conversations = await prisma.conversation.findMany({
      where: { business_id: business.id },
      orderBy: { last_message_at: 'desc' },
      take: 30,
      select: {
        id: true, customer_wa_id: true, profile_name: true, status: true,
        last_message_at: true, last_inbound_at: true, unread_count: true, ai_enabled: true,
      },
    });

    res.json({ business, conversations, read_only: true });
  } catch (err) {
    console.error('[admin/workspace] failed:', err.message);
    res.status(500).json({ error: err.message });
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

    const messages = await prisma.message.findMany({
      where: { conversation_id: conversation.id },
      orderBy: { created_at: 'asc' },
      take: 200,
      select: {
        id: true, direction: true, message_type: true, text_body: true,
        status: true, created_at: true, sender_wa_id: true,
        // Whether the agent or a human wrote it is the whole question when a reply looks wrong.
        is_ai_generated: true,
      },
    });

    res.json({ conversation, messages, read_only: true });
  } catch (err) {
    console.error('[admin/workspace-thread] failed:', err.message);
    res.status(500).json({ error: err.message });
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A customer's people only. platform_admin is never created from an account screen.
const CUSTOMER_ROLES = ['business_owner', 'manager', 'staff'];

router.get('/accounts/:id/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { business_id: req.params.id },
      select: { id: true, name: true, email: true, role: true, active: true, last_login: true, created_at: true },
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
  const email = String(req.body?.email || '').trim().toLowerCase();
  const role = String(req.body?.role || 'business_owner');

  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'بريد إلكتروني غير صالح' });
  if (!CUSTOMER_ROLES.includes(role)) return res.status(400).json({ error: 'صلاحية غير مسموحة' });

  try {
    const business = await prisma.business.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
    if (!business) return res.status(404).json({ error: 'لا يوجد حساب بهذا المعرّف' });

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) return res.status(409).json({ error: 'هذا البريد مستخدم مسبقًا' });

    // A password is required by the schema, so one is set that nobody knows and nobody can use:
    // the account is unusable until the activation link is redeemed.
    const unusable = await bcryptAdmin.hash(crypto.randomBytes(32).toString('hex'), 12);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: unusable,
        role,
        business_id: business.id, // from the URL, never the body
        active: false,            // becomes active when they set a password
      },
      select: { id: true, name: true, email: true, role: true },
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
      select: { id: true, name: true, email: true, role: true, active: true, last_login: true },
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

  try {
    // Scoped to the account in the URL: a subscription id from another tenant is not found.
    const existing = await prisma.subscription.findFirst({ where: { id: req.params.sid, business_id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: 'لا يوجد اشتراك بهذا المعرّف في هذا الحساب' });

    const row = await prisma.subscription.update({ where: { id: existing.id }, data, include: { payments: { orderBy: { paid_at: 'desc' } } } });
    await shiftEvent(req, req.params.id, 'contract_updated', {
      subscription_id: existing.id, changed: Object.keys(data), status: row.status,
    });
    res.json({ subscription: publicSubscription(row) });
  } catch (err) {
    console.error('[admin/subscriptions/update] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Record a payment. A past_due subscription that gets paid returns to active and its due date advances. */
router.post('/accounts/:id/subscriptions/:sid/payments', async (req, res) => {
  const b = req.body || {};
  const amount = money(b.amount_jod);
  const method = String(b.method || '');
  const paidAt = dateOrNull(b.paid_at) || new Date();
  if (amount === null || amount === 0) return res.status(400).json({ error: 'المبلغ غير صالح' });
  if (!METHODS.includes(method)) return res.status(400).json({ error: 'طريقة الدفع غير معروفة' });
  if (!validDate(paidAt)) return res.status(400).json({ error: 'تاريخ الدفع غير صالح' });

  try {
    const sub = await prisma.subscription.findFirst({ where: { id: req.params.sid, business_id: req.params.id } });
    if (!sub) return res.status(404).json({ error: 'لا يوجد اشتراك بهذا المعرّف في هذا الحساب' });

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
      if (sub.status === 'past_due') advance.status = 'active';
      if (sub.billing_cycle !== 'one_time') advance.next_due_at = nextDue(sub.next_due_at || paidAt, sub.billing_cycle);
      return tx.subscription.update({ where: { id: sub.id }, data: advance, include: { payments: { orderBy: { paid_at: 'desc' } } } });
    });
    // After the commit rather than inside it: a failed log write inside a Postgres transaction
    // would abort the payment it describes.
    await shiftEvent(req, sub.business_id, 'payment_recorded', {
      subscription_id: sub.id, amount_jod: amount, method, paid_at: paidAt.toISOString(),
      reference: b.reference ? String(b.reference).slice(0, 120) : null,
    });
    res.status(201).json({ subscription: publicSubscription(row) });
  } catch (err) {
    console.error('[admin/payments] failed:', err.message);
    res.status(500).json({ error: err.message });
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
