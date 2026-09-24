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
  connectionState, agentState, lifecycle, minutesSince, QUIET_HOURS, UNANSWERED_MINUTES,
} = require('../services/accountHealth');
const { dryRun } = require('../services/dryRun');

router.get('/overview', async (req, res) => {
  try {
    const [businesses, onboardings] = await Promise.all([
      prisma.business.findMany({
        select: {
          id: true, name: true, status: true, business_type: true,
          wa_phone_number_id: true, wa_business_account_id: true,
          wa_access_token: true, ai_config: true, created_at: true, updated_at: true,
        },
        orderBy: { created_at: 'asc' },
      }),
      prisma.whatsappOnboarding.findMany({
        select: {
          business_id: true, step: true, payment_method_ok: true,
          last_error: true, last_error_at: true, updated_at: true,
        },
      }),
    ]);

    const onboardingByBusiness = new Map(onboardings.filter((o) => o.business_id).map((o) => [o.business_id, o]));

    // The live contract per account: what they bought and whether it is paid. A cancelled one
    // is not "the contract" any more, so the newest non-cancelled row wins.
    const subs = await prisma.subscription.findMany({
      where: { status: { not: 'cancelled' } },
      orderBy: { created_at: 'desc' },
      select: { business_id: true, solution: true, plan_name: true, status: true, amount_jod: true, billing_cycle: true, next_due_at: true, starts_at: true },
    });
    const contractByBusiness = new Map();
    for (const sub of subs) if (!contractByBusiness.has(sub.business_id)) contractByBusiness.set(sub.business_id, sub);
    const DUE_SOON_DAYS = 7;

    // One grouped query rather than a query per account: this screen is opened often.
    const convAgg = await prisma.conversation.groupBy({
      by: ['business_id'],
      _max: { last_inbound_at: true, last_message_at: true },
      _count: { _all: true },
      _sum: { unread_count: true },
    });
    const convByBusiness = new Map(convAgg.map((c) => [c.business_id, c]));

    // last_message_at moves on ANY message, including the customer's own, so it cannot tell
    // "the agent replied" from "the customer wrote". The only honest signal for a reply is the
    // newest OUTBOUND message, asked for separately.
    // Only the AGENT's replies count. A human answering by hand also writes outbound rows, so
    // counting those reports "agent: ok" for a bot that has been dead for a week while the owner
    // covers for it — the exact failure this screen exists to catch.
    const outboundAgg = await prisma.message.groupBy({
      by: ['business_id'],
      where: { direction: 'outbound', is_ai_generated: true },
      _max: { created_at: true },
    });
    const outboundByBusiness = new Map(outboundAgg.map((m) => [m.business_id, m._max.created_at]));

    // A per-business maximum hides a single neglected thread behind a busy one, so unanswered
    // conversations are counted individually.
    const stale = await prisma.conversation.findMany({
      where: { last_inbound_at: { lt: new Date(Date.now() - UNANSWERED_MINUTES * 60000) }, status: { not: 'closed' } },
      select: { business_id: true, last_inbound_at: true },
    });
    const staleByBusiness = new Map();
    for (const c of stale) staleByBusiness.set(c.business_id, (staleByBusiness.get(c.business_id) || 0) + 1);

    const openAgg = await prisma.conversation.groupBy({
      by: ['business_id'],
      where: { status: 'open' },
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
      const lastOutbound = outboundByBusiness.get(b.id) || null;
      const lastActivity = conv?._max?.last_message_at || null;

      const bucket = lifecycle(b, onboarding);
      totals[bucket] += 1;

      const connection = connectionState(b, onboarding);
      const agent = agentState(b, lastInbound, lastOutbound);

      const contract = contractByBusiness.get(b.id) || null;
      const dueInDays = contract?.next_due_at ? Math.ceil((new Date(contract.next_due_at) - Date.now()) / 86400000) : null;

      accounts.push({
        id: b.id,
        name: b.name,
        business_type: b.business_type,
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
        conversations: conv?._count?._all || 0,
        unanswered_conversations: staleByBusiness.get(b.id) || 0,
        open_conversations: openByBusiness.get(b.id) || 0,
        unread: conv?._sum?.unread_count || 0,
        last_inbound_at: lastInbound,
        last_outbound_at: lastOutbound,
        last_activity_at: lastActivity,
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
      if (agent.state === 'down' && agent.label === 'بدون مسار عمل') {
        push('critical', 'no_workflow', 'الحساب بلا مسار عمل — يرد بترحيب ثابت فقط', b.created_at);
      } else if (agent.state === 'down') {
        push('critical', 'unanswered', `رسالة بدون رد منذ ${agent.sub}`, lastInbound);
      }
      const staleCount = staleByBusiness.get(b.id) || 0;
      if (staleCount > 0 && agent.state !== 'down') {
        // One busy conversation can hide a neglected one behind a per-account maximum.
        push('warning', 'stale_threads', `${staleCount} محادثة بانتظار رد`, lastInbound);
      }
      if (connection.state === 'down') {
        push('critical', 'connection', 'الحساب بدون رمز وصول — لن تصل الرسائل', b.updated_at);
      }
      if (onboarding && onboarding.step !== 'done') {
        push('warning', 'onboarding_incomplete', `التوصيل لم يكتمل — ${onboarding.step}`, onboarding.updated_at);
      }
      if (onboarding && onboarding.step === 'done' && !onboarding.payment_method_ok) {
        // Not a warning any more: without a card, Meta stops delivering service messages —
        // the bot's own replies — from 1 October 2026.
        push('critical', 'payment_method', 'لا توجد طريقة دفع — الوكيل سيتوقف عن الرد من 1 تشرين الأول', onboarding.updated_at);
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
      if (!contract && bucket === 'active' && b.business_type !== 'shift') {
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
      // Stated rather than implied: these need per-WABA Graph calls we do not make yet.
      unavailable: ['meta_quality_rating', 'messaging_tier', 'config_change_actor'],
    });
  } catch (err) {
    console.error('[admin/overview] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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

    const [inbound, outbound, conversations] = await Promise.all([
      prisma.conversation.aggregate({ where: { business_id: business.id }, _max: { last_inbound_at: true } }),
      prisma.message.aggregate({ where: { business_id: business.id, direction: 'outbound' }, _max: { created_at: true } }),
      prisma.conversation.count({ where: { business_id: business.id } }),
    ]);

    const lastInbound = inbound._max.last_inbound_at;
    const lastOutbound = outbound._max.created_at;

    // The checklist is derived, never stored: a stored "done" drifts from reality the moment
    // someone changes a token by hand.
    const checklist = [
      { step: 'number', label: 'رقم واتساب مرتبط', done: Boolean(business.wa_phone_number_id) },
      { step: 'waba', label: 'حساب واتساب للأعمال', done: Boolean(business.wa_business_account_id) },
      { step: 'token', label: 'رمز وصول محفوظ', done: Boolean(business.wa_access_token) },
      { step: 'registered', label: 'الرقم مُسجَّل لدى Meta', done: onboarding ? onboarding.step === 'done' : null },
      { step: 'payment', label: 'طريقة دفع مضافة', done: onboarding ? onboarding.payment_method_ok : null },
      { step: 'greeting', label: 'رسالة ترحيب مضبوطة', done: Boolean(business.ai_config?.greeting_message) },
      { step: 'owner_login', label: 'حساب دخول لصاحب المنشأة', done: Boolean(anyOwner) },
      { step: 'owner_signed_in', label: 'صاحب المنشأة دخل فعليًا', done: Boolean(signedInOwner) },
      { step: 'first_message', label: 'أول رسالة واردة', done: Boolean(lastInbound) },
      { step: 'first_reply', label: 'أول رد من الوكيل', done: Boolean(lastOutbound) },
    ];

    res.json({
      account: {
        ...business,
        // Never send the token itself to a browser; whether one exists is the useful fact.
        wa_access_token: undefined,
        has_token: Boolean(business.wa_access_token),
        connection: connectionState(business, onboarding),
        agent: agentState(business, lastInbound, lastOutbound),
        lifecycle: lifecycle(business, onboarding),
        last_inbound_at: lastInbound,
        last_outbound_at: lastOutbound,
        conversations,
      },
      onboarding: onboarding ? {
        id: onboarding.id,
        step: onboarding.step,
        payment_method_ok: onboarding.payment_method_ok,
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
    res.status(201).json({ subscription: publicSubscription(row) });
  } catch (err) {
    console.error('[admin/payments] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
