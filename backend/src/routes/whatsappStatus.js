const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, attachBusinessId, requireRole } = require('../middleware/auth');
const accountEvents = require('../services/accountEvents');
const alerts = require('../services/alerts');
const platformSettings = require('../services/platformSettings');
const { connectionState, agentState, lifecycle } = require('../services/accountHealth');
const { dryRun } = require('../services/dryRun');
const { dayStart } = require('../services/costGuard');
const account = require('./account');
// The payment wording lives in one place (no dates: the «30 أيلول» copies read as a missed
// deadline once October came).
const {
  PAYMENT_METHOD_OWNER_SHORT, PAYMENT_METHOD_OWNER_LONG, WHATSAPP_MANAGER_URL, paymentNotice,
} = require('../config/metaNotices');

/**
 * Whether owners may connect WhatsApp themselves (PlatformSetting es_owner_enabled, off until the
 * first attended live signup, G1, has passed). A failed read is «no»: the checklist then says SHIFT
 * connects the number, which is the safe and, until G1, the true answer.
 */
async function ownerConnectEnabled() {
  try {
    return platformSettings.isOn(await platformSettings.get('es_owner_enabled'));
  } catch (err) {
    return false;
  }
}

/**
 * What is left before this account's bot is genuinely working, in the order it has to happen.
 *
 * Every step is derived from something we store — none is a box the customer ticks, because a
 * ticked box drifts from reality and this list is the one place they look to answer «هل يعمل؟».
 * `blocked_by` names whose move it is: ours, theirs, or nobody's (waiting on a customer to write).
 */
function buildSetup({
  business, connection, paymentOk, paymentClaimed = false, knowledgeCount, lastInbound, ownerConnect = false,
}) {
  const isRestaurant = business.business_type === 'restaurant';
  const isClinic = business.business_type === 'clinic';

  const knowledgeStep = isRestaurant
    ? { key: 'menu', label: 'أضف أصناف القائمة وأسعارها', where: '/menu', owner: 'you' }
    : isClinic
      ? { key: 'services', label: 'أضف خدمات العيادة والأطباء', where: '/clinic', owner: 'you' }
      // «البوت» is where the knowledge is taught (P3); /settings no longer holds it.
      : { key: 'knowledge', label: 'عرّف البوت على منشأتك — الدوام وأهم الأسئلة', where: '/bot', owner: 'you' };

  const steps = [
    // Once owners may connect themselves, this is their step with a button («اربط واتساب»);
    // until then it is SHIFT's, and saying so keeps the owner from hunting for a button that is
    // not there.
    ownerConnect
      ? {
        key: 'connected',
        label: 'ربط رقم واتساب منشأتك',
        done: connection.state === 'ok' || connection.state === 'degraded',
        owner: 'you',
        action: 'connect',
        hint: 'اضغط «اربط واتساب» وأكمل الخطوات في نافذة فيسبوك — نحو 10 دقائق.',
      }
      : {
        key: 'connected',
        label: 'ربط رقم واتساب منشأتك',
        done: connection.state === 'ok' || connection.state === 'degraded',
        owner: 'shift',
        hint: 'فريق شِفت يربط الرقم معك — لا شيء عليك هنا.',
      },
    // The owner's «أضفت البطاقة» is enough to move on (decisions-2026-10-08.md #9); SHIFT confirms
    // it later, and a Meta 131042 refusal turns it red whatever either side said.
    paymentOk !== true && paymentClaimed
      ? {
        key: 'payment',
        label: paymentNotice('claimed', 'owner', 'short'),
        done: true,
        owner: 'you',
        hint: paymentNotice('claimed', 'owner', 'long'),
        url: WHATSAPP_MANAGER_URL,
      }
      : {
        key: 'payment',
        label: PAYMENT_METHOD_OWNER_SHORT,
        done: paymentOk === true,
        owner: 'you',
        action: paymentOk === true ? undefined : 'payment_claim',
        hint: PAYMENT_METHOD_OWNER_LONG,
        url: WHATSAPP_MANAGER_URL,
      },
    {
      ...knowledgeStep,
      done: knowledgeCount > 0,
      hint: 'بدونها يرد البوت بالترحيب فقط ولا يجيب عن أي سؤال.',
    },
    {
      key: 'first_message',
      label: 'أول رسالة من زبون',
      done: Boolean(lastInbound),
      owner: 'nobody',
      hint: 'تظهر تلقائيًا عندما يراسلك أول زبون. جرّب أنت من رقم آخر.',
    },
  ];

  const remaining = steps.filter((s) => !s.done);
  // «next» is only ever something someone can actually do. When all that is left is a customer
  // writing in, there is no next move — offering it as one would read like a task the owner is
  // failing to complete, and the honest line is that their side is finished.
  const next = remaining.find((s) => s.owner === 'you') || remaining.find((s) => s.owner === 'shift') || null;
  return {
    steps,
    done: remaining.length === 0,
    next,
    waiting_for_first_message: remaining.length > 0 && !next,
  };
}


/**
 * «هل واتسابي موصول؟» — for the customer.
 *
 * Two personas walked the real dashboard and both scored it 4/10 for one reason: nothing
 * told a paying customer whether the WhatsApp they pay for is connected. That card was
 * admin-only. This answers the same question, from the same functions the fleet view uses,
 * scoped by attachBusinessId to the caller's own business and nothing else.
 *
 * Read-only. Connecting, retrying and tokens stay on the admin side.
 */
router.use(authenticate, attachBusinessId);

// Plain language for a business owner, not a state machine. Each message says what is true
// and what, if anything, they can do about it themselves.
function explain(connection, agent, onboarding, contract, { ownerConnect = false, hasNumber = true } = {}) {
  // A shop with no number yet whose owner can connect it: the move is theirs, not «SHIFT is on it».
  if (ownerConnect && !hasNumber) {
    return { tone: 'warn', title: 'واتساب غير مربوط بعد', body: 'اضغط «اربط واتساب» وأكمل الخطوات في نافذة فيسبوك. جهّز الهاتف الذي فيه شريحة رقم المحل.', action: 'connect' };
  }
  if (connection.state === 'ok' && agent.state === 'ok') {
    return { tone: 'good', title: 'واتساب موصول والبوت يرد', body: 'كل رسالة تصل رقمك يجيب عليها الوكيل. تجد المحادثات في «المحادثات».', action: null };
  }
  if (connection.state === 'ok' && agent.state === 'unknown') {
    return { tone: 'good', title: 'واتساب موصول — بانتظار أول رسالة', body: 'الرقم مربوط والبوت جاهز. لم يراسلك أحد بعد؛ أول محادثة ستظهر في «المحادثات».', action: null };
  }
  // A generic shop with nothing entered answers every question with its greeting: connected and
  // "working", yet useless. agentState marks it degraded (customers still get a greeting); keyed
  // on the label, not the state, so a change of severity there cannot hide this message. The fix
  // is theirs, not SHIFT's.
  if (connection.state === 'ok' && agent.label === 'بدون معلومات') {
    return { tone: 'warn', title: 'البوت بدون معلومات', body: 'البوت يرد بالترحيب فقط لأنه لا يعرف شيئًا عن منشأتك بعد. أضف الدوام وأهم الأسئلة وأجوبتها.', action: 'knowledge' };
  }
  if (connection.state === 'ok' && agent.state === 'down') {
    return { tone: 'bad', title: 'واتساب موصول لكن البوت لا يرد', body: `آخر رسالة من زبون لم يُرد عليها${agent.sub ? ` منذ ${agent.sub}` : ''}. تواصل مع شِفت الآن.`, action: 'contact' };
  }
  // The bot was paused on purpose (ai_config.enabled === false: SHIFT's PATCH
  // /api/admin/accounts/:id/bot, or the owner's own switch). Messages still arrive and the
  // conversations are flagged, so the owner must know to answer by hand. Not «غير معروفة».
  if (agent.state === 'paused') {
    return { tone: 'warn', title: 'البوت موقوف مؤقتًا', body: 'الرد الآلي موقوف مؤقتًا. الرسائل تصلك وتجدها في «المحادثات» — رد على زبائنك بنفسك، أو تواصل مع شِفت.', action: 'contact' };
  }
  if (connection.state === 'idle' || agent.state === 'idle') {
    return { tone: 'warn', title: 'الوكيل موقوف', body: 'الرد الآلي متوقف يدويًا. الرسائل تصل لكن لا يجيب عليها أحد إلا فريقك.', action: null };
  }
  if (onboarding && onboarding.step === 'done' && !onboarding.payment_method_ok && onboarding.payment_method_claimed_at) {
    return { tone: 'warn', title: paymentNotice('claimed', 'owner', 'short'), body: paymentNotice('claimed', 'owner', 'long'), action: null };
  }
  if (onboarding && onboarding.step === 'done' && !onboarding.payment_method_ok) {
    return { tone: 'warn', title: 'واتساب موصول — تبقّى طريقة الدفع', body: PAYMENT_METHOD_OWNER_LONG, action: 'payment' };
  }
  if (connection.state === 'degraded' || connection.state === 'down' || connection.state === 'unknown') {
    return { tone: 'warn', title: 'واتساب غير موصول بعد', body: 'فريق شِفت يعمل على ربط رقمك. لن يصل البوت أي رسالة حتى يكتمل الربط — ستجد الحالة هنا «موصول» عندما يتم.', action: 'contact' };
  }
  return { tone: 'warn', title: 'الحالة غير معروفة', body: 'تواصل مع شِفت للتأكد.', action: 'contact' };
}

router.get('/', async (req, res) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.businessId },
      select: {
        id: true, name: true, status: true, business_type: true,
        wa_phone_number_id: true, wa_business_account_id: true, wa_access_token: true, ai_config: true,
        wa_display_phone: true, wa_verified_name: true,
      },
    });
    if (!business) return res.status(404).json({ error: 'لا يوجد حساب' });

    // Whichever knowledge this business type actually uses: a menu, a service list, or the
    // facts its owner entered. Counting the wrong one would tell a restaurant it is ready.
    const knowledgeCount = business.business_type === 'restaurant'
      ? await prisma.menuItem.count({ where: { business_id: business.id } })
      : business.business_type === 'clinic'
        ? await prisma.service.count({ where: { business_id: business.id } })
        : await prisma.businessKnowledge.count({ where: { business_id: business.id, active: true } });

    // The same inputs the admin overview and account page read, so the owner's card and SHIFT's
    // fleet row cannot disagree about whether the bot is answering. The agent is judged on its own
    // newest reply: last_outbound_at is also stamped by staff sends and stored alerts, and an
    // owner covering by hand for a dead bot must still see «البوت لا يرد — تواصل مع شِفت».
    const [onboarding, latest, aiReply, contract] = await Promise.all([
      prisma.whatsappOnboarding.findFirst({
        where: { business_id: business.id },
        orderBy: { created_at: 'desc' },
        // payment_blocked_at so connectionState can say a Meta 131042 refusal (it reads it), and
        // revoked_at so the home page can say «أعد الربط» rather than a generic «غير موصول».
        select: {
          step: true, payment_method_ok: true, payment_method_claimed_at: true, payment_blocked_at: true,
          revoked_at: true, meta_name_status: true, meta_quality_rating: true,
        },
      }),
      prisma.conversation.aggregate({ where: { business_id: business.id }, _max: { last_inbound_at: true, last_outbound_at: true } }),
      prisma.message.aggregate({ where: { business_id: business.id, direction: 'outbound', is_ai_generated: true }, _max: { created_at: true } }),
      prisma.subscription.findFirst({
        where: { business_id: business.id, status: { not: 'cancelled' } },
        orderBy: { created_at: 'desc' },
        select: { solution: true, plan_name: true, status: true, amount_jod: true, billing_cycle: true, next_due_at: true },
      }),
    ]);

    const ownerConnect = await ownerConnectEnabled();
    const panel = await homeNumbers(business.id);
    // A shop wired by hand has no onboarding row: its owner's «أضفت البطاقة» is kept as the event.
    const paymentClaimed = onboarding
      ? Boolean(onboarding.payment_method_claimed_at)
      : Boolean(business.wa_phone_number_id) && await handWiredClaim(business.id);
    const lastInbound = latest._max.last_inbound_at;
    const lastOutbound = latest._max.last_outbound_at;
    const lastAiReply = aiReply._max.created_at;
    const connection = connectionState(business, onboarding);
    // knowledgeCount lets agentState say «بدون معلومات» for a generic shop with nothing entered;
    // without it that state could never show and the card said «يرد».
    const agent = agentState(business, lastInbound, lastAiReply, knowledgeCount);

    res.json({
      connection,
      agent,
      lifecycle: lifecycle(business, onboarding),
      payment_method_ok: onboarding ? onboarding.payment_method_ok : null,
      last_inbound_at: lastInbound,
      last_outbound_at: lastOutbound,
      contract: contract ? {
        solution: contract.solution, plan_name: contract.plan_name, status: contract.status,
        amount_jod: Number(contract.amount_jod), billing_cycle: contract.billing_cycle, next_due_at: contract.next_due_at,
      } : null,
      payment_method_claimed: paymentClaimed,
      // The two states the home page's status line leads with, as plain booleans: the connection
      // ended on Meta's side (reconnect), or Meta refused the bot's replies over payment (131042).
      revoked: Boolean(onboarding && onboarding.revoked_at),
      payment_blocked: Boolean(onboarding && onboarding.payment_blocked_at),
      // «رقم المحل» and «الاسم الذي يراه زبائنك» as Meta shows them, never the ids behind them.
      // name_status and quality_rating are Meta's words (APPROVED, GREEN…); the page says them in Arabic.
      number: {
        display: business.wa_display_phone || null,
        verified_name: business.wa_verified_name || null,
        name_status: onboarding ? onboarding.meta_name_status || null : null,
        quality_rating: onboarding ? onboarding.meta_quality_rating || null : null,
      },
      ...panel,
      explain: explain(connection, agent, onboarding, contract, { ownerConnect, hasNumber: Boolean(business.wa_phone_number_id) }),
      setup: buildSetup({
        business,
        connection,
        paymentOk: onboarding ? onboarding.payment_method_ok : null,
        paymentClaimed,
        knowledgeCount,
        lastInbound,
        ownerConnect,
      }),
      // Never the token, never the raw Meta identifiers: the customer needs the state, not the plumbing.
    });
  } catch (err) {
    console.error('[whatsapp/status] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * The home page's numbers (docs/panels/spec.md «الرئيسية»): the plan banner, «هذا الشهر», «اليوم»
 * and how many «ما عرف يجاوب» questions are open. «اليوم» starts at midnight in Amman, whatever
 * the server's clock zone. Best effort as a block: the connection card above is what this route is
 * for, and a failed count must not take it down, so each part answers null when it cannot be read.
 */
async function homeNumbers(businessId) {
  const out = { plan: null, usage: null, today: null, gaps_open: null };
  try {
    const contract = await account.contractOf(businessId);
    out.plan = account.planView(contract);
    out.usage = await account.usageView(businessId, contract);
  } catch (err) {
    console.error(`[whatsapp/status] plan not read business=${businessId}: ${err.message}`);
  }
  try {
    const since = dayStart(new Date());
    const now = new Date();
    const [inbound, aiRows, waiting] = await Promise.all([
      // «زبائن راسلوك»: conversations a customer wrote in today.
      prisma.conversation.count({ where: { business_id: businessId, last_inbound_at: { gte: since } } }),
      // «ردّ عليهم البوت»: of those, the ones the bot answered — conversations, not messages.
      prisma.message.findMany({
        where: { business_id: businessId, direction: 'outbound', is_ai_generated: true, created_at: { gte: since } },
        select: { conversation_id: true },
        distinct: ['conversation_id'],
      }),
      // «بانتظارك»: the inbox's own «بانتظارك» filter (needs_attention, not snoozed).
      prisma.conversation.count({
        where: { AND: [{ business_id: businessId, needs_attention: true }, { OR: [{ snoozed_until: null }, { snoozed_until: { lte: now } }] }] },
      }),
    ]);
    out.today = { inbound, ai_replies: new Set(aiRows.map((r) => r.conversation_id)).size, waiting };
  } catch (err) {
    console.error(`[whatsapp/status] today not read business=${businessId}: ${err.message}`);
  }
  try {
    out.gaps_open = await prisma.accountEvent.count({ where: { business_id: businessId, type: 'bot_handoff', resolved_at: null } });
  } catch (err) {
    console.error(`[whatsapp/status] gaps not read business=${businessId}: ${err.message}`);
  }
  return out;
}

/** Whether the owner of a shop with no onboarding row said «أضفت البطاقة». False when unreadable. */
async function handWiredClaim(businessId) {
  try {
    return Boolean(await prisma.accountEvent.findFirst({
      where: { business_id: businessId, type: 'payment_claimed' }, select: { id: true },
    }));
  } catch (err) {
    return false;
  }
}

/**
 * «جرّب البوت»: the customer types what a customer would, and sees what the bot would say —
 * through the real workflow, with nothing sent and nothing saved. `state` from the previous
 * reply is passed back to continue the same exchange.
 */
router.post('/test', async (req, res) => {
  const text = String(req.body?.message || '').trim();
  if (!text) return res.status(400).json({ error: 'اكتب رسالة للتجربة' });
  if (text.length > 500) return res.status(400).json({ error: 'الرسالة طويلة' });
  const state = req.body?.state && typeof req.body.state === 'object' ? req.body.state : {};

  try {
    const business = await prisma.business.findUnique({
      where: { id: req.businessId },
      select: { id: true, name: true, business_type: true, ai_config: true, policies: true, currency: true, language_default: true, opening_hours: true, timezone: true },
    });
    if (!business) return res.status(404).json({ error: 'لا يوجد حساب' });
    if (business.business_type === 'shift') return res.status(400).json({ error: 'التجربة غير متاحة لهذا الحساب' });

    res.json(await dryRun(business, text, state));
  } catch (err) {
    console.error('[whatsapp/status/test] failed:', err.message);
    res.status(502).json({ error: `تعذّر توليد الرد: ${err.message}` });
  }
});

/**
 * «أضفت البطاقة»: the owner says they added a payment card in WhatsApp Manager (spec step 8).
 * Meta gives a Tech Provider no way to read it, so this is a statement, recorded with who made it
 * and when; SHIFT confirms it with PATCH /api/admin/accounts/:id/payment-method after seeing the
 * card. The first claim's time is kept: pressing again does not move it. Owner only: it is about
 * the shop's money at Meta.
 */
router.post('/payment-method-claim', requireRole('business_owner'), async (req, res) => {
  try {
    const onboarding = await prisma.whatsappOnboarding.findFirst({
      where: { business_id: req.businessId },
      orderBy: { created_at: 'desc' },
      select: { id: true, payment_method_ok: true, payment_method_claimed_at: true },
    });
    if (!onboarding) {
      // A shop SHIFT wired by hand («متقدم», typed ids) has a live number and no onboarding row to
      // hold the claim. Its owner is still right to say it: the claim is kept as the event, and
      // SHIFT is told, instead of answering «اربط واتساب أولًا» for a bot already answering.
      const business = await prisma.business.findUnique({
        where: { id: req.businessId }, select: { name: true, wa_phone_number_id: true },
      });
      if (!business || !business.wa_phone_number_id) {
        return res.status(409).json({ error: 'اربط واتساب أولًا، ثم أضف بطاقة الدفع لدى Meta.' });
      }
      const earlier = await prisma.accountEvent.findFirst({
        where: { business_id: req.businessId, type: 'payment_claimed' },
        orderBy: { created_at: 'asc' },
        select: { created_at: true },
      });
      let claimedAt = earlier ? earlier.created_at : null;
      if (!claimedAt) {
        claimedAt = new Date();
        await accountEvents.record({
          businessId: req.businessId, actorUserId: req.user.id, actorKind: 'owner', type: 'payment_claimed', data: { no_onboarding: true },
        });
        await tellShiftClaimed(req.businessId, business.name);
      }
      return res.json({
        payment_method_claimed_at: claimedAt,
        payment_method_ok: false,
        notice: paymentNotice('claimed', 'owner', 'short'),
      });
    }

    let claimedAt = onboarding.payment_method_claimed_at;
    if (!claimedAt) {
      claimedAt = new Date();
      // Only while unclaimed, so two taps at once record one claim and one event.
      const { count } = await prisma.whatsappOnboarding.updateMany({
        where: { id: onboarding.id, payment_method_claimed_at: null },
        data: { payment_method_claimed_at: claimedAt },
      });
      if (count) {
        await accountEvents.record({
          businessId: req.businessId, actorUserId: req.user.id, actorKind: 'owner', type: 'payment_claimed', data: {},
        });
        if (!onboarding.payment_method_ok) await tellShiftClaimed(req.businessId);
      }
    }
    const state = onboarding.payment_method_ok ? null : 'claimed';
    res.json({
      payment_method_claimed_at: claimedAt,
      payment_method_ok: Boolean(onboarding.payment_method_ok),
      notice: state ? paymentNotice(state, 'owner', 'short') : null,
    });
  } catch (err) {
    console.error('[whatsapp/status/payment-method-claim] failed:', err.message);
    res.status(500).json({ error: 'تعذّر الحفظ، حاول مرة أخرى' });
  }
});

/**
 * SHIFT is the one who confirms a claimed card (it looks in WhatsApp Manager), so a new claim is
 * an alert, not something to find by opening each account. Best effort: the claim is saved.
 */
async function tellShiftClaimed(businessId, shopName = '') {
  try {
    await alerts.notifyShift({
      reason: 'payment_claimed',
      businessId,
      shopName,
      summary: 'قال صاحب المحل إنه أضاف بطاقة الدفع لدى Meta — راجعها في WhatsApp Manager ثم اضغط «رأيت البطاقة — أكّد»',
    });
  } catch (err) {
    console.error(`[whatsapp/status/payment-method-claim] SHIFT alert failed business=${businessId}: ${err.message}`);
  }
}

module.exports = router;
// For the panel contract tests (setupControlsContract.test.js): the checklist and the card's words.
module.exports.buildSetup = buildSetup;
module.exports.explain = explain;
