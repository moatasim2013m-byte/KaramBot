/**
 * «هل واتسابي موصول؟» for the customer: their own business only, the same answer the fleet
 * view gives, in words a business owner can act on.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  user: { findUnique: jest.fn(), findMany: jest.fn() },
  userActivation: { findMany: jest.fn() },
  business: { findUnique: jest.fn() },
  whatsappOnboarding: { findFirst: jest.fn() },
  conversation: { aggregate: jest.fn(), count: jest.fn() },
  message: { aggregate: jest.fn(), count: jest.fn(), findMany: jest.fn() },
  accountEvent: { count: jest.fn() },
  platformSetting: { findMany: jest.fn() },
  subscription: { findFirst: jest.fn() },
  menuItem: { count: jest.fn() },
  service: { count: jest.fn() },
  businessKnowledge: { count: jest.fn() },
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const app = require('../src/app');
const { PAYMENT_METHOD_OWNER_LONG, PAYMENT_METHOD_OWNER_SHORT, WHATSAPP_MANAGER_URL } = require('../src/config/metaNotices');
const costGuard = require('../src/services/costGuard');
const platformSettings = require('../src/services/platformSettings');

const OWNER = { id: 'u1', name: 'O', email: 'o@clinic.jo', role: 'business_owner', business_id: 'b1', active: true };
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: 'u1' }, process.env.JWT_SECRET)}` });
const minsAgo = (m) => new Date(Date.now() - m * 60000);

const biz = (over = {}) => ({
  id: 'b1', name: 'عيادة النور', status: 'active', business_type: 'clinic',
  wa_phone_number_id: 'PN', wa_business_account_id: 'WABA', wa_access_token: 'enc', ai_config: {}, ...over,
});

// aiReply: the bot's own newest reply; unless a test says otherwise, the last outbound was the bot's.
function setup({ business = biz(), onboarding = { step: 'done', payment_method_ok: true }, inbound = null, outbound = null, aiReply, contract = null, knowledge = 0 } = {}) {
  prisma.message.aggregate.mockResolvedValue({ _max: { created_at: aiReply === undefined ? outbound : aiReply } });
  prisma.user.findUnique.mockResolvedValue(OWNER);
  prisma.business.findUnique.mockResolvedValue(business);
  prisma.whatsappOnboarding.findFirst.mockResolvedValue(onboarding);
  prisma.conversation.aggregate.mockResolvedValue({ _max: { last_inbound_at: inbound, last_outbound_at: outbound } });
  prisma.subscription.findFirst.mockResolvedValue(contract);
  prisma.menuItem.count.mockResolvedValue(knowledge);
  prisma.service.count.mockResolvedValue(knowledge);
  prisma.businessKnowledge.count.mockResolvedValue(knowledge);
  // The home page's numbers (P3): quiet defaults unless a test sets them.
  prisma.user.findMany.mockResolvedValue([{ id: 'u1', active: true }]);
  prisma.userActivation.findMany.mockResolvedValue([]);
  prisma.conversation.count.mockResolvedValue(0);
  prisma.message.count.mockResolvedValue(0);
  prisma.message.findMany.mockResolvedValue([]);
  prisma.accountEvent.count.mockResolvedValue(0);
  prisma.platformSetting.findMany.mockResolvedValue([]);
}

const get = () => request(app).get('/api/whatsapp/status').set(auth());

beforeEach(() => {
  jest.clearAllMocks();
  costGuard.clearCache();
  platformSettings.clearCache();
});

test('a business owner sees only their own business, whatever the query says', async () => {
  setup();
  const res = await request(app).get('/api/whatsapp/status?businessId=SOMEONE_ELSE').set(auth());
  expect(res.status).toBe(200);
  expect(prisma.business.findUnique.mock.calls[0][0].where).toEqual({ id: 'b1' });
});

test('connected and answering reads as good news', async () => {
  setup({ inbound: minsAgo(10), outbound: minsAgo(9) });
  const res = await get();
  expect(res.body.connection.state).toBe('ok');
  expect(res.body.agent.state).toBe('ok');
  expect(res.body.explain.tone).toBe('good');
  expect(res.body.explain.action).toBeNull();
});

test('connected with nobody having written yet is still good news, and says so', async () => {
  setup();
  const res = await get();
  expect(res.body.explain.tone).toBe('good');
  expect(res.body.explain.title).toContain('بانتظار أول رسالة');
});

test('a customer left without a reply is the one case that says call SHIFT now', async () => {
  setup({ inbound: minsAgo(40), outbound: minsAgo(90) });
  const res = await get();
  expect(res.body.agent.state).toBe('down');
  expect(res.body.explain.tone).toBe('bad');
  expect(res.body.explain.action).toBe('contact');
});

test('a missing payment method is the one action the customer can take themselves', async () => {
  setup({ onboarding: { step: 'done', payment_method_ok: false } });
  const res = await get();
  expect(res.body.connection.state).toBe('degraded');
  expect(res.body.explain.action).toBe('payment');
  // One wording, from config/metaNotices.js, with no deadline in it: «قبل 30 أيلول» read as a
  // missed date once October came.
  expect(res.body.explain.body).toBe(PAYMENT_METHOD_OWNER_LONG);
  const step = res.body.setup.steps.find((x) => x.key === 'payment');
  expect(step).toMatchObject({ label: PAYMENT_METHOD_OWNER_SHORT, hint: PAYMENT_METHOD_OWNER_LONG, url: WHATSAPP_MANAGER_URL });
  // This route's own copy. (connection.label comes from services/accountHealth.js.)
  expect(JSON.stringify([res.body.explain, res.body.setup])).not.toMatch(/أيلول|تشرين/);
});

test('a generic shop with nothing entered reads «بدون معلومات», and the fix is theirs', async () => {
  // knowledgeCount now reaches agentState; before, this state could never show and the card
  // said the bot was answering while it only ever sent the greeting.
  setup({ business: biz({ business_type: 'generic' }), knowledge: 0, inbound: minsAgo(3), outbound: minsAgo(2) });
  const res = await get();
  expect(res.body.agent).toMatchObject({ state: 'degraded', label: 'بدون معلومات' });
  expect(res.body.explain).toMatchObject({ tone: 'warn', action: 'knowledge' });
});

test('a bot SHIFT paused says so, and tells the owner to answer by hand', async () => {
  // agentState's 'paused' (admin PATCH /accounts/:id/bot) must not fall through to «غير معروفة».
  setup({ business: biz({ ai_config: { enabled: false } }), inbound: minsAgo(40), outbound: minsAgo(90) });
  const res = await get();
  expect(res.body.agent).toMatchObject({ state: 'paused', label: 'موقوف مؤقتًا' });
  expect(res.body.explain).toMatchObject({ tone: 'warn', title: 'البوت موقوف مؤقتًا', action: 'contact' });
});

test('the agent is judged on its own replies, as the admin overview does', async () => {
  setup({ inbound: minsAgo(40), outbound: minsAgo(30) });
  const res = await get();
  expect(res.body.agent.state).toBe('ok');
  expect(prisma.message.aggregate.mock.calls[0][0].where).toEqual({ business_id: 'b1', direction: 'outbound', is_ai_generated: true });
});

test('an owner covering by hand for a dead bot still sees «البوت لا يرد» (review 2026-10-08)', async () => {
  // The owner (or a stored alert) answered after the customer; the bot has not replied since before.
  setup({ inbound: minsAgo(40), outbound: minsAgo(30), aiReply: minsAgo(300) });
  const res = await get();
  expect(res.body.agent.state).toBe('down');
  expect(res.body.explain).toMatchObject({ tone: 'bad', action: 'contact' });
});

test('a generic shop with knowledge answering is good news', async () => {
  setup({ business: biz({ business_type: 'generic' }), knowledge: 4, inbound: minsAgo(3), outbound: minsAgo(2) });
  const res = await get();
  expect(res.body.agent.state).toBe('ok');
  expect(res.body.explain.tone).toBe('good');
});

test('not connected yet says SHIFT is on it, and that no message will arrive until then', async () => {
  setup({ business: biz({ wa_access_token: null }), onboarding: null });
  const res = await get();
  expect(res.body.connection.state).toBe('down');
  expect(res.body.explain.title).toContain('غير موصول');
  expect(res.body.explain.action).toBe('contact');
});

test('the contract is shown, never the token or the Meta identifiers', async () => {
  setup({ contract: { solution: 'karam_bot', plan_name: null, status: 'active', amount_jod: 120, billing_cycle: 'monthly', next_due_at: new Date() } });
  const res = await get();
  expect(res.body.contract).toMatchObject({ solution: 'karam_bot', amount_jod: 120 });
  const text = JSON.stringify(res.body);
  expect(text).not.toContain('wa_access_token');
  expect(text).not.toContain('WABA');
  expect(text).not.toContain('"PN"');
});

test('a user with no business is refused, not shown someone else', async () => {
  prisma.user.findUnique.mockResolvedValue({ ...OWNER, business_id: null });
  const res = await get();
  expect(res.status).toBe(403);
  expect(prisma.business.findUnique).not.toHaveBeenCalled();
});

describe('the setup guide the customer follows', () => {
  test('a brand-new account: nothing done, and the next move is theirs', async () => {
    setup({ business: biz({ business_type: 'generic', wa_access_token: null }), onboarding: null, knowledge: 0 });
    const { setup: s } = (await get()).body;

    expect(s.done).toBe(false);
    expect(s.steps.map((x) => x.key)).toEqual(['connected', 'payment', 'knowledge', 'first_message']);
    expect(s.steps.every((x) => !x.done)).toBe(true);
    // Connection is ours to do; the first thing THEY can act on is the payment method.
    expect(s.steps[0].owner).toBe('shift');
    expect(s.next.key).toBe('payment');
  });

  test('a fully set-up account has no guide left to show', async () => {
    setup({ inbound: minsAgo(5), outbound: minsAgo(4), knowledge: 3 });
    const { setup: s } = (await get()).body;
    expect(s.done).toBe(true);
    expect(s.next).toBeNull();
  });

  test('a restaurant is asked for its menu, a clinic for its services', async () => {
    setup({ business: biz({ business_type: 'restaurant' }), knowledge: 0 });
    let { setup: s } = (await get()).body;
    expect(s.steps[2].key).toBe('menu');
    expect(s.steps[2].where).toBe('/menu');

    setup({ business: biz({ business_type: 'clinic' }), knowledge: 0 });
    ({ setup: s } = (await get()).body);
    expect(s.steps[2].key).toBe('services');
  });

  test('a restaurant with a menu is not told to enter knowledge it does not use', async () => {
    // Counting the wrong table would tell a restaurant with a full menu that it is not ready.
    setup({ business: biz({ business_type: 'restaurant' }), knowledge: 12 });
    const { setup: s } = (await get()).body;
    expect(prisma.menuItem.count).toHaveBeenCalled();
    expect(prisma.businessKnowledge.count).not.toHaveBeenCalled();
    expect(s.steps[2].done).toBe(true);
  });

  test('waiting on a customer to write is nobody\'s task, and not presented as one', async () => {
    setup({ onboarding: { step: 'done', payment_method_ok: true }, knowledge: 2 });
    const { setup: s } = (await get()).body;
    const first = s.steps.find((x) => x.key === 'first_message');
    expect(first.done).toBe(false);
    expect(first.owner).toBe('nobody');
    // Nothing anyone can do about it, so there is no «next» at all — their side is finished.
    expect(s.next).toBeNull();
    expect(s.waiting_for_first_message).toBe(true);
    expect(s.done).toBe(false);
  });

  test('an unconfirmed payment method is not treated as done', async () => {
    setup({ onboarding: { step: 'done', payment_method_ok: false }, knowledge: 2, inbound: minsAgo(3) });
    const { setup: s } = (await get()).body;
    expect(s.steps.find((x) => x.key === 'payment').done).toBe(false);
    expect(s.done).toBe(false);
  });
});

describe('the home page numbers (P3)', () => {
  const trial = (over = {}) => ({
    solution: 'karam_bot', plan_name: 'باقة كرم بوت', status: 'trial', amount_jod: 19.99, billing_cycle: 'monthly',
    trial_ends_at: new Date(Date.now() + 18 * 86400000 - 3600000), next_due_at: new Date(Date.now() + 18 * 86400000),
    ai_replies_month: 1000, seats: 3, ...over,
  });

  test('number, plan, usage, today and open gaps, for the caller\'s own shop', async () => {
    setup({
      business: biz({ wa_display_phone: '+962 7 9123 4567', wa_verified_name: 'عيادة النور' }),
      onboarding: { step: 'done', payment_method_ok: true, meta_name_status: 'APPROVED', meta_quality_rating: 'GREEN' },
      contract: trial(),
    });
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', active: true }, { id: 'u2', active: false }, { id: 'u3', active: false }]);
    prisma.userActivation.findMany.mockResolvedValue([{ user_id: 'u2' }]);
    prisma.message.count.mockResolvedValue(312);
    prisma.conversation.count.mockResolvedValueOnce(14).mockResolvedValueOnce(2);
    prisma.message.findMany.mockResolvedValue([{ conversation_id: 'c1' }, { conversation_id: 'c2' }, { conversation_id: 'c1' }]);
    prisma.accountEvent.count.mockResolvedValue(3);

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.number).toEqual({ display: '+962 7 9123 4567', verified_name: 'عيادة النور', name_status: 'APPROVED', quality_rating: 'GREEN' });
    expect(res.body.plan).toMatchObject({ name: 'باقة كرم بوت', price_jod: 19.99, status: 'trial', trial_days_left: 18 });
    expect(res.body.usage).toEqual({ ai_replies_month: 312, cap: 1000, seats_used: 2, seats: 3 });
    expect(res.body.today).toEqual({ inbound: 14, ai_replies: 2, waiting: 2 });
    expect(res.body.gaps_open).toBe(3);

    // Every count is this shop's, and «اليوم» starts at midnight in Amman.
    const since = costGuard.dayStart(new Date());
    expect(prisma.conversation.count.mock.calls[0][0].where).toEqual({ business_id: 'b1', last_inbound_at: { gte: since } });
    expect(prisma.message.findMany.mock.calls[0][0].where).toMatchObject({ business_id: 'b1', is_ai_generated: true, created_at: { gte: since } });
    expect(prisma.accountEvent.count.mock.calls[0][0].where).toEqual({ business_id: 'b1', type: 'bot_handoff', resolved_at: null });
    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ business_id: 'b1' });
  });

  test('a paid, late shop and one with no contract', async () => {
    setup({ contract: trial({ status: 'past_due', trial_ends_at: null }) });
    expect((await get()).body.plan).toMatchObject({ status: 'past_due', trial_days_left: null });
    setup({ contract: null });
    expect((await get()).body.plan).toMatchObject({ status: 'none', price_jod: 19.99 });
  });

  test('a failed count leaves its card empty and the connection card standing', async () => {
    setup({ inbound: minsAgo(10), outbound: minsAgo(9) });
    prisma.conversation.count.mockRejectedValue(new Error('db down'));
    prisma.accountEvent.count.mockRejectedValue(new Error('db down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.today).toBeNull();
    expect(res.body.gaps_open).toBeNull();
    expect(res.body.explain.tone).toBe('good');
    console.error.mockRestore();
  });

  // The home page's status line leads with these two (frontend panelView.statusLine). Before the P3
  // merge the route selected neither column, so a revoked or 131042-blocked shop read «غير موصول».
  test('revoked at Meta and payment-blocked are said as booleans, never as the Meta ids', async () => {
    setup();
    let res = await get();
    expect(res.body).toMatchObject({ revoked: false, payment_blocked: false });
    expect(prisma.whatsappOnboarding.findFirst.mock.calls[0][0].select).toMatchObject({ revoked_at: true, payment_blocked_at: true });

    setup({ onboarding: { step: 'done', payment_method_ok: true, payment_blocked_at: minsAgo(5) } });
    res = await get();
    expect(res.body.payment_blocked).toBe(true);
    expect(res.body.connection.state).toBe('down');

    setup({ onboarding: { step: 'done', payment_method_ok: true, revoked_at: minsAgo(5) } });
    expect((await get()).body.revoked).toBe(true);

    setup({ onboarding: null });
    expect((await get()).body).toMatchObject({ revoked: false, payment_blocked: false });
  });

  test('a generic shop is sent to «البوت» to teach it', async () => {
    setup({ business: biz({ business_type: 'generic' }), knowledge: 0 });
    const { setup: s } = (await get()).body;
    expect(s.steps.find((x) => x.key === 'knowledge').where).toBe('/bot');
  });
});
