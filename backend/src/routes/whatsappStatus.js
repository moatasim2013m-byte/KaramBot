const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, attachBusinessId } = require('../middleware/auth');
const { connectionState, agentState, lifecycle } = require('../services/accountHealth');
const { dryRun } = require('../services/dryRun');

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
function explain(connection, agent, onboarding, contract) {
  if (connection.state === 'ok' && agent.state === 'ok') {
    return { tone: 'good', title: 'واتساب موصول والبوت يرد', body: 'كل رسالة تصل رقمك يجيب عليها الوكيل. تجد المحادثات في «المحادثات».', action: null };
  }
  if (connection.state === 'ok' && agent.state === 'unknown') {
    return { tone: 'good', title: 'واتساب موصول — بانتظار أول رسالة', body: 'الرقم مربوط والبوت جاهز. لم يراسلك أحد بعد؛ أول محادثة ستظهر في «المحادثات».', action: null };
  }
  if (connection.state === 'ok' && agent.state === 'down') {
    return { tone: 'bad', title: 'واتساب موصول لكن البوت لا يرد', body: `آخر رسالة من زبون لم يُرد عليها${agent.sub ? ` منذ ${agent.sub}` : ''}. تواصل مع شِفت الآن.`, action: 'contact' };
  }
  if (connection.state === 'idle' || agent.state === 'idle') {
    return { tone: 'warn', title: 'الوكيل موقوف', body: 'الرد الآلي متوقف يدويًا. الرسائل تصل لكن لا يجيب عليها أحد إلا فريقك.', action: null };
  }
  if (onboarding && onboarding.step === 'done' && !onboarding.payment_method_ok) {
    return { tone: 'warn', title: 'واتساب موصول — تبقّى طريقة الدفع', body: 'أضف طريقة دفع في WhatsApp Manager قبل 30 أيلول، وإلا يتوقف البوت عن الرد على زبائنك من 1 تشرين الأول. هذه خطوة عندك أنت لا عند شِفت.', action: 'payment' };
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
      },
    });
    if (!business) return res.status(404).json({ error: 'لا يوجد حساب' });

    const [onboarding, inbound, outbound, contract] = await Promise.all([
      prisma.whatsappOnboarding.findFirst({ where: { business_id: business.id }, orderBy: { created_at: 'desc' }, select: { step: true, payment_method_ok: true } }),
      prisma.conversation.aggregate({ where: { business_id: business.id }, _max: { last_inbound_at: true } }),
      prisma.message.aggregate({ where: { business_id: business.id, direction: 'outbound', is_ai_generated: true }, _max: { created_at: true } }),
      prisma.subscription.findFirst({
        where: { business_id: business.id, status: { not: 'cancelled' } },
        orderBy: { created_at: 'desc' },
        select: { solution: true, plan_name: true, status: true, amount_jod: true, billing_cycle: true, next_due_at: true },
      }),
    ]);

    const lastInbound = inbound._max.last_inbound_at;
    const lastOutbound = outbound._max.created_at;
    const connection = connectionState(business, onboarding);
    const agent = agentState(business, lastInbound, lastOutbound);

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
      explain: explain(connection, agent, onboarding, contract),
      // Never the token, never the raw Meta identifiers: the customer needs the state, not the plumbing.
    });
  } catch (err) {
    console.error('[whatsapp/status] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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

module.exports = router;
