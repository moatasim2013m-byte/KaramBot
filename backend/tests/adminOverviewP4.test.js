/**
 * «اليوم» (GET /api/admin/overview), the P4 additions: the platform strip, the join funnel (the
 * board's own stage derivation), the money line, «آخر ما حصل», the fleet columns and the full
 * attention item shape. And that it stays bounded: one query per signal however many shops, never
 * one per shop, with the internal rows out of the funnel and the money.
 *
 * The rules themselves are pinned one by one in operatorAttention.test.js; here the route's reads.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  business: { findMany: jest.fn(), count: jest.fn() },
  whatsappOnboarding: { findMany: jest.fn() },
  conversation: { groupBy: jest.fn(), findMany: jest.fn() },
  message: { groupBy: jest.fn(), count: jest.fn() },
  subscription: { findMany: jest.fn() },
  businessKnowledge: { groupBy: jest.fn(), findMany: jest.fn() },
  user: { findUnique: jest.fn(), findMany: jest.fn() },
  userActivation: { findMany: jest.fn() },
  accountEvent: { findMany: jest.fn(), groupBy: jest.fn() },
  platformSetting: { findMany: jest.fn() },
  payment: { groupBy: jest.fn() },
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const app = require('../src/app');
const platformSettings = require('../src/services/platformSettings');
const costGuard = require('../src/services/costGuard');

const ADMIN = { id: 'admin1', name: 'معتصم الأحمد', email: 'a@shifts-ai.com', role: 'platform_admin', business_id: null, active: true };
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: 'admin1' }, process.env.JWT_SECRET)}` });
const H = 3600000;
const D = 24 * H;
const ago = (ms) => new Date(Date.now() - ms);
const ahead = (ms) => new Date(Date.now() + ms);

const biz = (over = {}) => ({
  id: 'b1', name: 'مطعم الشام', status: 'active', business_type: 'restaurant', is_internal: false,
  wa_phone_number_id: 'P1', wa_business_account_id: 'W1', wa_access_token: 'enc', connected_at: ago(10 * D),
  went_live_at: ago(5 * D), ai_config: {}, created_at: ago(20 * D), updated_at: ago(D),
  sector: 'restaurant', city: 'إربد', owner_phone: '962791234567', wa_display_phone: '+962 7 9123 4567', wa_verified_name: 'مطعم الشام',
  ...over,
});

function mockDb({ businesses, onboardings = [], subs = [], owners = [], invites = [], events = [], settings = [], repliesToday = 0, payments = [], recent = null }) {
  const pick = (where = {}) => businesses.filter((b) => (where.is_internal === undefined || b.is_internal === where.is_internal));
  prisma.business.findMany.mockImplementation(({ where = {} } = {}) => Promise.resolve(where.id ? businesses : pick(where)));
  prisma.business.count.mockImplementation(({ where }) => Promise.resolve(businesses.filter((b) => b.is_internal === where.is_internal).length));
  prisma.whatsappOnboarding.findMany.mockImplementation(({ where }) => Promise.resolve(
    where.business_id === null ? [] : onboardings.filter((o) => where.business_id.in.includes(o.business_id)),
  ));
  prisma.subscription.findMany.mockImplementation(({ where }) => Promise.resolve(subs.filter((s) => where.business_id.in.includes(s.business_id))));
  prisma.conversation.groupBy.mockResolvedValue([]);
  prisma.conversation.findMany.mockResolvedValue([]);
  prisma.message.groupBy.mockResolvedValue([]);
  prisma.message.count.mockResolvedValue(repliesToday);
  prisma.businessKnowledge.groupBy.mockResolvedValue([]);
  prisma.businessKnowledge.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockImplementation(({ where }) => Promise.resolve(
    where.role ? owners.filter((o) => where.business_id.in.includes(o.business_id)) : [{ id: 'admin1', name: ADMIN.name }],
  ));
  prisma.userActivation.findMany.mockResolvedValue(invites);
  prisma.accountEvent.findMany.mockImplementation(({ where, take }) => {
    if (where.business_id === null) return Promise.resolve([]);
    if (take === 15) return Promise.resolve(recent || events.slice(0, 15));
    return Promise.resolve(events.filter((e) => where.business_id.in.includes(e.business_id)));
  });
  prisma.accountEvent.groupBy.mockResolvedValue([]);
  prisma.platformSetting.findMany.mockResolvedValue(settings);
  prisma.payment.groupBy.mockResolvedValue(payments);
}

const get = (q = '') => request(app).get(`/api/admin/overview${q}`).set(auth());

beforeEach(() => {
  jest.clearAllMocks();
  platformSettings.clearCache();
  costGuard.clearCache();
  prisma.user.findUnique.mockResolvedValue(ADMIN);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('the platform strip: provider down within 15 minutes, today\'s replies against the ceiling, the connect switch', async () => {
  mockDb({
    businesses: [biz()],
    onboardings: [{ business_id: 'b1', step: 'done', payment_method_ok: true }],
    settings: [
      { key: 'provider_status', value: { provider: 'gemini', kind: 'quota', last_seen: ago(5 * 60000).toISOString() } },
      { key: 'ai_limits', value: { platform_day_ceiling: 500 } },
      { key: 'es_owner_enabled', value: true },
    ],
    repliesToday: 500,
  });
  const res = await get();
  expect(res.status).toBe(200);
  expect(res.body.platform).toMatchObject({
    provider: { ok: false, kind: 'quota' }, replies_today: 500, ceiling: 500, self_connect: 'invite',
  });
  const platformRows = res.body.attention.filter((a) => a.account_id === null).map((a) => a.rule);
  expect(platformRows).toEqual(expect.arrayContaining(['provider_down', 'platform_ceiling']));
  expect(res.body.attention.find((a) => a.rule === 'provider_down')).toMatchObject({ severity: 'critical', name: 'المنصة' });
});

test('a quiet platform reads ok, and the switch closed by default', async () => {
  mockDb({ businesses: [biz()], onboardings: [{ business_id: 'b1', step: 'done', payment_method_ok: true }] });
  const res = await get();
  expect(res.body.platform).toMatchObject({ provider: { ok: true, since: null }, replies_today: 0, ceiling: 2000, self_connect: 'closed' });
});

test('the funnel uses the board\'s stages, adds paused, and leaves internal rows out', async () => {
  mockDb({
    businesses: [
      biz({ id: 'live' }),
      biz({ id: 'card', went_live_at: null }),
      biz({ id: 'invited', wa_phone_number_id: null, went_live_at: null, connected_at: null }),
      biz({ id: 'paused', ai_config: { enabled: false } }),
      biz({ id: 'sim', is_internal: true }),
    ],
    onboardings: [
      { business_id: 'live', step: 'done', payment_method_ok: true },
      { business_id: 'card', step: 'done', payment_method_ok: false },
      { business_id: 'paused', step: 'done', payment_method_ok: true },
    ],
    owners: [{ id: 'o1', business_id: 'invited', name: 'أبو خالد', phone: '962790000001', active: false, last_login: null }],
    invites: [{ user_id: 'o1', expires_at: ahead(5 * D), created_at: ago(D) }],
  });
  const res = await get('?include_internal=1');
  expect(res.body.funnel).toEqual({
    invite_sent: 1, connecting: 0, awaiting_card: 1, teaching: 0, awaiting_first_customer: 0, live: 1, paused: 1,
  });
  const byId = Object.fromEntries(res.body.accounts.map((a) => [a.id, a]));
  expect(byId.card).toMatchObject({ stage: 'awaiting_card', stage_ar: 'بانتظار البطاقة', whatsapp: { state: 'card_unconfirmed' } });
  expect(byId.paused).toMatchObject({ stage: 'paused', stage_ar: 'موقوف مؤقتًا', bot: { state: 'paused' } });
  expect(byId.invited.owner).toMatchObject({ first_name: 'أبو خالد', phone: '962790000001', signed_in: false, state: 'invited' });
  expect(byId.invited.owner.label_ar).toMatch(/^الدعوة تنتهي بعد/);
  expect(byId.invited.conversations_7d).toBeNull(); // «—» when not connected
});

test('the money line: free month, paid, unstarted, due this week and overdue, customers only', async () => {
  mockDb({
    businesses: [biz({ id: 'a' }), biz({ id: 'b' }), biz({ id: 'c' }), biz({ id: 'd' }), biz({ id: 'sim', is_internal: true })],
    onboardings: [],
    subs: [
      { id: 's1', business_id: 'a', solution: 'karam_bot', status: 'trial', amount_jod: 19.99, trial_ends_at: ahead(10 * D), next_due_at: ahead(10 * D) },
      { id: 's2', business_id: 'b', solution: 'karam_bot', status: 'active', amount_jod: 19.99, next_due_at: ahead(3 * D) },
      { id: 's3', business_id: 'c', solution: 'karam_bot', status: 'past_due', amount_jod: 25, next_due_at: ago(9 * D) },
      { id: 's4', business_id: 'sim', solution: 'karam_bot', status: 'past_due', amount_jod: 999, next_due_at: ago(9 * D) },
    ],
  });
  const res = await get('?include_internal=1');
  expect(res.body.money).toEqual({ trial: 1, paid: 1, unstarted: 1, due_this_week_jod: 19.99, overdue_jod: 25 });
});

test('«آخر ما حصل»: the 15 newest events, in Arabic, with the shop and who did it', async () => {
  mockDb({
    businesses: [biz()],
    recent: [
      { id: 'e2', business_id: 'b1', actor_kind: 'shift', actor_user_id: 'admin1', type: 'payment_recorded', data: { amount_jod: 19.99, method: 'cliq' }, created_at: ago(H) },
      { id: 'e1', business_id: 'b1', actor_kind: 'owner', actor_user_id: null, type: 'es_connected', data: {}, created_at: ago(2 * H) },
    ],
  });
  const res = await get();
  expect(res.body.recent_events).toEqual([
    expect.objectContaining({ id: 'e2', business_name: 'مطعم الشام', actor_ar: 'شِفت (معتصم)', type: 'payment_recorded', text_ar: 'سُجّلت دفعة 19.99 د.أ (كليك)' }),
    expect.objectContaining({ id: 'e1', actor_ar: 'صاحب المحل', text_ar: 'رُبط واتساب' }),
  ]);
  const recentCall = prisma.accountEvent.findMany.mock.calls.find(([a]) => a.take === 15)[0];
  expect(recentCall.where).toEqual({ business_id: { in: ['b1'] } });
});

test('every attention item carries the contract\'s fields and a fix button; «راسله» opens WhatsApp in Arabic', async () => {
  mockDb({
    businesses: [biz({ connected_at: ago(3 * D), went_live_at: null })],
    onboardings: [{ business_id: 'b1', step: 'done', payment_method_ok: false, registered_at: ago(3 * D) }],
    owners: [{ id: 'o1', business_id: 'b1', name: 'أبو خالد الشامي', phone: '962791234567', active: true, last_login: ago(D) }],
    subs: [{ id: 's1', business_id: 'b1', solution: 'karam_bot', status: 'active', amount_jod: 19.99, next_due_at: ahead(20 * D) }],
  });
  const res = await get();
  const item = res.body.attention.find((a) => a.rule === 'payment_unconfirmed');
  expect(item).toMatchObject({
    rule: 'payment_unconfirmed', severity: 'warning', account_id: 'b1', name: 'مطعم الشام',
    action: { kind: 'confirm_card', label_ar: 'أكّد البطاقة' },
  });
  expect(item.text_ar).toMatch(/[ء-ي]/);
  expect(item.since).toBeTruthy();
  for (const a of res.body.attention) {
    expect(Object.keys(a)).toEqual(expect.arrayContaining(['rule', 'severity', 'account_id', 'name', 'text_ar', 'since', 'action']));
  }
});

test('bounded: the same number of queries for one shop as for twenty', async () => {
  const count = () => Object.values(prisma).reduce((n, model) => n + Object.values(model).reduce((m, fn) => m + (fn.mock ? fn.mock.calls.length : 0), 0), 0);
  mockDb({ businesses: [biz()] });
  await get();
  const one = count();

  jest.clearAllMocks();
  platformSettings.clearCache();
  costGuard.clearCache();
  prisma.user.findUnique.mockResolvedValue(ADMIN);
  mockDb({ businesses: Array.from({ length: 20 }, (_, i) => biz({ id: `b${i}` })) });
  await get();
  expect(count()).toBe(one);
});

test('one unreadable signal costs that signal, not the page', async () => {
  mockDb({ businesses: [biz()] });
  prisma.accountEvent.findMany.mockRejectedValue(new Error('relation "account_events" does not exist'));
  prisma.payment.groupBy.mockRejectedValue(new Error('down'));
  const res = await get();
  expect(res.status).toBe(200);
  expect(res.body.recent_events).toEqual([]);
  expect(res.body.accounts).toHaveLength(1);
});
