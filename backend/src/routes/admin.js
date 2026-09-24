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

// Silence longer than this on an otherwise live account is worth a look.
const QUIET_HOURS = 48;
// An inbound with nothing sent after it: the customer is waiting.
const UNANSWERED_MINUTES = 15;

const minutesSince = (d) => (d ? (Date.now() - new Date(d).getTime()) / 60000 : null);

/**
 * Three states that fail independently, so they are never collapsed into one badge:
 * the account, its WhatsApp connection, and the agent.
 */
function connectionState(business, onboarding) {
  if (!business.wa_phone_number_id) return { state: 'unknown', label: 'غير معروف' };
  if (onboarding && onboarding.step !== 'done') {
    return { state: 'degraded', label: 'قيد التوصيل', sub: onboarding.step };
  }
  if (!business.wa_access_token) return { state: 'down', label: 'بدون رمز وصول' };
  if (onboarding && !onboarding.payment_method_ok) {
    // Meta stops delivering service messages — the agent's replies — without a payment method
    // on file from 1 October 2026, so this is a countdown, not a cosmetic gap.
    return { state: 'degraded', label: 'بدون طريقة دفع — مهلة 30 أيلول' };
  }
  return { state: 'ok', label: 'متصل' };
}

const WORKFLOW_TYPES = ['restaurant', 'clinic', 'shift'];

function agentState(business, lastInbound, lastOutbound) {
  if (business.ai_config?.enabled === false) return { state: 'idle', label: 'موقوف يدويًا' };
  // No workflow means production answers a fixed greeting and never calls a model. That is not
  // a working agent, however recently something was sent.
  if (!WORKFLOW_TYPES.includes(business.business_type)) {
    return { state: 'down', label: 'بدون مسار عمل', sub: business.business_type || 'غير محدد' };
  }
  if (!lastInbound) return { state: 'unknown', label: 'لا توجد رسائل بعد' };
  const waiting = minutesSince(lastInbound);
  const answered = lastOutbound && new Date(lastOutbound) >= new Date(lastInbound);
  if (!answered && waiting > UNANSWERED_MINUTES) {
    return { state: 'down', label: 'رسالة بدون رد', sub: `${Math.round(waiting)} د` };
  }
  return { state: 'ok', label: 'يرد' };
}

/** Which lifecycle bucket an account sits in — onboarding is a state, not a status flag. */
function lifecycle(business, onboarding) {
  if (business.status === 'suspended') return 'suspended';
  if (onboarding && onboarding.step !== 'done') return 'onboarding';
  if (!business.wa_phone_number_id || !business.wa_access_token) return 'onboarding';
  return business.status === 'active' ? 'active' : 'inactive';
}

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

      accounts.push({
        id: b.id,
        name: b.name,
        business_type: b.business_type,
        lifecycle: bucket,
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
 * Ask the MODEL a question with this account's persona, and send nothing.
 *
 * Deliberately narrow, and named accordingly: this does NOT run the account's workflow. A
 * `generic` account answers production traffic with a fixed greeting and never calls a model,
 * yet this endpoint would return a fluent reply for it — so treating a green result here as
 * proof the account is ready would certify a dead bot. It answers one question only: can we
 * reach the model with this account's configuration.
 */
router.post('/accounts/:id/test-message', async (req, res) => {
  const text = String(req.body?.message || '').trim();
  if (!text) return res.status(400).json({ error: 'اكتب رسالة للتجربة' });
  if (text.length > 500) return res.status(400).json({ error: 'الرسالة طويلة' });

  try {
    const business = await prisma.business.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, business_type: true, ai_config: true, currency: true, language_default: true },
    });
    if (!business) return res.status(404).json({ error: 'لا يوجد حساب بهذا المعرّف' });

    const { generateAIReply } = require('../ai/provider');
    const personality = business.ai_config?.personality || '';
    const greeting = business.ai_config?.greeting_message || '';
    const systemPrompt = [
      `أنت مساعد واتساب لمنشأة اسمها «${business.name}».`,
      personality && `الشخصية: ${personality}`,
      greeting && `رسالة الترحيب المعتمدة: ${greeting}`,
      'أجب بالعربية، بإيجاز، كما تجيب العميل على واتساب.',
    ].filter(Boolean).join('\n');

    const started = Date.now();
    const reply = await generateAIReply(systemPrompt, text, []);
    const ms = Date.now() - started;

    // Stated in the payload so the UI cannot quietly present this as a readiness check.
    const WORKFLOW_TYPES = ['restaurant', 'clinic', 'shift'];
    res.json({
      sent: false,
      scope: 'model_only',
      runs_workflow: false,
      reply: typeof reply === 'string' ? reply : (reply?.text || JSON.stringify(reply)),
      latency_ms: ms,
      ai_enabled: business.ai_config?.enabled !== false,
      has_workflow: WORKFLOW_TYPES.includes(business.business_type),
    });
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

module.exports = router;
