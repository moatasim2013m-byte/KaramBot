/**
 * «هل واتسابي موصول؟» for the customer: their own business only, the same answer the fleet
 * view gives, in words a business owner can act on.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  user: { findUnique: jest.fn() },
  business: { findUnique: jest.fn() },
  whatsappOnboarding: { findFirst: jest.fn() },
  conversation: { aggregate: jest.fn() },
  message: { aggregate: jest.fn() },
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
}

const get = () => request(app).get('/api/whatsapp/status').set(auth());

beforeEach(() => jest.clearAllMocks());

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
