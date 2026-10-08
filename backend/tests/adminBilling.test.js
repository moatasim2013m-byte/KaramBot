/**
 * «الاشتراكات والدفعات»: GET /api/admin/billing, and the payment rules it reports on
 * (POST /api/admin/accounts/:id/subscriptions/:sid/payments).
 *
 *  - a partial payment no longer moves the due date a whole cycle (admin.js:712-748 used to);
 *  - the first payment on a free month makes the contract «فعّال»;
 *  - what is still owed counts every payment on the contract, so half a month shows half;
 *  - a payment that brings a late contract back lifts the late policy's pause, and only that pause.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  user: { findUnique: jest.fn() },
  business: { findMany: jest.fn(), findUnique: jest.fn() },
  subscription: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  payment: { create: jest.fn(), groupBy: jest.fn(), findMany: jest.fn(), aggregate: jest.fn() },
  message: { groupBy: jest.fn().mockResolvedValue([]) },
  platformSetting: { findMany: jest.fn().mockResolvedValue([]) },
  accountEvent: { create: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../src/db/jsonb', () => ({ patchJson: jest.fn() }));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const jsonb = require('../src/db/jsonb');
const app = require('../src/app');
const { cyclesCompleted } = require('../src/routes/admin');
const { dueCents } = require('../src/routes/adminBilling');

const ADMIN = { id: 'admin1', name: 'A', email: 'a@shifts-ai.com', role: 'platform_admin', business_id: null, active: true };
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: 'admin1' }, process.env.JWT_SECRET)}` });
const D = 24 * 3600000;
const ago = (ms) => new Date(Date.now() - ms);
const ahead = (ms) => new Date(Date.now() + ms);
const events = () => prisma.accountEvent.create.mock.calls.map(([a]) => a.data);

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(ADMIN);
  prisma.accountEvent.create.mockImplementation(({ data }) => Promise.resolve({ id: 'ev', created_at: new Date(), ...data }));
  jsonb.patchJson.mockResolvedValue({ ok: true, count: 1 });
  prisma.business.findUnique.mockResolvedValue({ id: 'b1', ai_config: {} });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('the billing math', () => {
  test('a whole cycle per price crossed by the running total, in cents', () => {
    expect(cyclesCompleted(0, 10, 19.99)).toBe(0);
    expect(cyclesCompleted(10, 9.99, 19.99)).toBe(1);
    expect(cyclesCompleted(0, 19.99, 19.99)).toBe(1);
    expect(cyclesCompleted(0, 40, 19.99)).toBe(2);
    expect(cyclesCompleted(19.99, 19.99, 19.99)).toBe(1);
    expect(cyclesCompleted(0, 5, 0)).toBe(0);
  });

  test('what is owed on the current cycle', () => {
    const c = { amount_jod: 19.99, billing_cycle: 'monthly' };
    expect(dueCents(c, 0)).toBe(1999);
    expect(dueCents(c, 1000)).toBe(999);
    expect(dueCents(c, 1999)).toBe(1999); // that cycle is paid; the next one is owed in full
    expect(dueCents({ amount_jod: 900, billing_cycle: 'one_time' }, 90000)).toBe(0);
  });
});

describe('recording a payment', () => {
  // The route reads the contract first; latePolicy.liftLatePause then reads the shop's live Karam
  // Bot contract, which is this one as the payment left it unless `botLive` says otherwise.
  function withSub(sub, prior = [], botLive = null) {
    let latest = sub;
    prisma.subscription.findFirst.mockReset()
      .mockResolvedValueOnce({ ...sub, payments: prior })
      .mockImplementation(() => Promise.resolve(botLive || latest));
    const tx = {
      payment: { create: jest.fn().mockResolvedValue({}) },
      subscription: {
        update: jest.fn().mockImplementation(({ data }) => {
          latest = { ...sub, ...data };
          return Promise.resolve({ ...latest, payments: [] });
        }),
      },
    };
    prisma.$transaction.mockImplementation((fn) => fn(tx));
    return tx;
  }
  const pay = (body) => request(app).post('/api/admin/accounts/b1/subscriptions/s1/payments').set(auth()).send({ method: 'cliq', ...body });
  const due = new Date('2026-11-01T00:00:00Z');

  test('a partial payment leaves the due date where it is, and is logged as partial', async () => {
    const tx = withSub({ id: 's1', business_id: 'b1', status: 'active', billing_cycle: 'monthly', amount_jod: 19.99, next_due_at: due });
    const res = await pay({ amount_jod: 10 });
    expect(res.status).toBe(201);
    expect(res.body.cycles_paid).toBe(0);
    expect(tx.subscription.update.mock.calls[0][0].data).toEqual({});
    expect(events().find((e) => e.type === 'payment_recorded').data).toMatchObject({ amount_jod: 10, partial: true, cycles: 0 });
  });

  test('the rest of it completes the cycle and moves the date one month', async () => {
    const tx = withSub({ id: 's1', business_id: 'b1', status: 'active', billing_cycle: 'monthly', amount_jod: 19.99, next_due_at: due }, [{ amount_jod: 10 }]);
    await pay({ amount_jod: 9.99 });
    expect(new Date(tx.subscription.update.mock.calls[0][0].data.next_due_at).toISOString().slice(0, 10)).toBe('2026-12-01');
  });

  test('two months at once move it two months', async () => {
    const tx = withSub({ id: 's1', business_id: 'b1', status: 'active', billing_cycle: 'monthly', amount_jod: 19.99, next_due_at: due });
    await pay({ amount_jod: 39.98 });
    expect(new Date(tx.subscription.update.mock.calls[0][0].data.next_due_at).toISOString().slice(0, 10)).toBe('2027-01-01');
  });

  test('the first payment on a free month makes it active, even a partial one', async () => {
    let tx = withSub({ id: 's1', business_id: 'b1', status: 'trial', billing_cycle: 'monthly', amount_jod: 19.99, next_due_at: due, trial_ends_at: due });
    await pay({ amount_jod: 19.99 });
    expect(tx.subscription.update.mock.calls[0][0].data).toMatchObject({ status: 'active' });
    expect(new Date(tx.subscription.update.mock.calls[0][0].data.next_due_at).toISOString().slice(0, 10)).toBe('2026-12-01');

    tx = withSub({ id: 's1', business_id: 'b1', status: 'trial', billing_cycle: 'monthly', amount_jod: 19.99, next_due_at: due });
    await pay({ amount_jod: 5 });
    expect(tx.subscription.update.mock.calls[0][0].data).toEqual({ status: 'active' });
  });

  test('a late contract stays late on a partial payment, and its bot stays paused', async () => {
    const tx = withSub({ id: 's1', business_id: 'b1', status: 'past_due', billing_cycle: 'monthly', amount_jod: 19.99, next_due_at: ago(10 * D) });
    prisma.business.findUnique.mockResolvedValue({ id: 'b1', ai_config: { enabled: false, paused_by: 'shift', pause_reason: 'late_payment' } });
    const res = await pay({ amount_jod: 5 });
    expect(tx.subscription.update.mock.calls[0][0].data.status).toBeUndefined();
    expect(res.body.bot_resumed).toBe(false);
    expect(jsonb.patchJson).not.toHaveBeenCalled();
  });

  test('paying the late cycle makes it active and lifts the late pause, logged as SHIFT\'s', async () => {
    withSub({ id: 's1', business_id: 'b1', status: 'past_due', billing_cycle: 'monthly', amount_jod: 19.99, next_due_at: ago(10 * D) });
    prisma.business.findUnique.mockResolvedValue({ id: 'b1', ai_config: { enabled: false, paused_by: 'shift', pause_reason: 'late_payment' } });
    const res = await pay({ amount_jod: 19.99 });
    expect(res.body.bot_resumed).toBe(true);
    expect(jsonb.patchJson).toHaveBeenCalledWith('businesses', 'b1', 'ai_config', { enabled: true }, { remove: ['paused_by', 'pause_reason', 'prior_pause'] });
    expect(events().find((e) => e.type === 'bot_resumed')).toMatchObject({ actor_kind: 'shift', actor_user_id: 'admin1', data: { reason: 'payment_recorded' } });
  });

  test('a payment on the shop\'s website contract does not lift the late Karam Bot contract\'s pause', async () => {
    withSub(
      { id: 's1', business_id: 'b1', solution: 'website', status: 'active', billing_cycle: 'monthly', amount_jod: 50, next_due_at: due },
      [],
      { id: 'sbot', business_id: 'b1', solution: 'karam_bot', status: 'past_due', next_due_at: ago(10 * D) },
    );
    prisma.business.findUnique.mockResolvedValue({ id: 'b1', ai_config: { enabled: false, paused_by: 'shift', pause_reason: 'late_payment' } });
    const res = await pay({ amount_jod: 50 });
    expect(res.status).toBe(201);
    expect(res.body.bot_resumed).toBe(false);
    expect(jsonb.patchJson).not.toHaveBeenCalled();
  });

  test('a few dinars that turn a late free month «فعّال» do not buy the bot back', async () => {
    withSub({ id: 's1', business_id: 'b1', solution: 'karam_bot', status: 'trial', billing_cycle: 'monthly', amount_jod: 19.99, next_due_at: ago(10 * D) });
    prisma.business.findUnique.mockResolvedValue({ id: 'b1', ai_config: { enabled: false, paused_by: 'shift', pause_reason: 'late_payment' } });
    const res = await pay({ amount_jod: 5 });
    expect(res.body.subscription.status).toBe('active');
    expect(res.body.bot_resumed).toBe(false);
    expect(jsonb.patchJson).not.toHaveBeenCalled();
  });

  test('a pause SHIFT made by hand for another reason is not lifted by a payment', async () => {
    withSub({ id: 's1', business_id: 'b1', status: 'active', billing_cycle: 'monthly', amount_jod: 19.99, next_due_at: due });
    prisma.business.findUnique.mockResolvedValue({ id: 'b1', ai_config: { enabled: false, paused_by: 'shift' } });
    const res = await pay({ amount_jod: 19.99 });
    expect(res.body.bot_resumed).toBe(false);
    expect(jsonb.patchJson).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/billing', () => {
  function mockFleet() {
    prisma.business.findMany.mockResolvedValue([
      { id: 'a', name: 'مطعم الشام', sector: 'restaurant', status: 'active', ai_config: {} },
      { id: 'b', name: 'صيدلية الريان', sector: 'pharmacy', status: 'active', ai_config: { enabled: false, paused_by: 'shift', pause_reason: 'late_payment' } },
      { id: 'c', name: 'صالون ليلى', sector: 'salon', status: 'active', ai_config: {} },
      { id: 'd', name: 'محل جديد', sector: 'shop', status: 'active', ai_config: {} },
    ]);
    prisma.subscription.findMany.mockResolvedValue([
      { id: 'sa', business_id: 'a', solution: 'karam_bot', status: 'active', amount_jod: 19.99, billing_cycle: 'monthly', next_due_at: ahead(5 * D) },
      { id: 'sb', business_id: 'b', solution: 'karam_bot', status: 'past_due', amount_jod: 19.99, billing_cycle: 'monthly', next_due_at: ago(10 * D) },
      { id: 'sc', business_id: 'c', solution: 'karam_bot', status: 'trial', amount_jod: 19.99, billing_cycle: 'monthly', trial_ends_at: ahead(2 * D), next_due_at: ahead(2 * D) },
      // An older website contract does not replace the bot's.
      { id: 'sw', business_id: 'a', solution: 'website', status: 'active', amount_jod: 300, billing_cycle: 'one_time', next_due_at: null },
    ]);
    // b paid 10 of its late 19.99.
    prisma.payment.groupBy.mockResolvedValue([{ subscription_id: 'sb', _sum: { amount_jod: 10 } }, { subscription_id: 'sa', _sum: { amount_jod: 19.99 } }]);
    prisma.payment.findMany.mockResolvedValue([
      { subscription_id: 'sa', amount_jod: 19.99, paid_at: ago(25 * D), method: 'cliq', reference: 'CLQ-1' },
      { subscription_id: 'sb', amount_jod: 10, paid_at: ago(3 * D), method: 'cash', reference: null },
    ]);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount_jod: 10 } });
  }

  test('rows per shop with the live bot contract, what is owed, and the last payment in Arabic', async () => {
    mockFleet();
    const res = await request(app).get('/api/admin/billing').set(auth());
    expect(res.status).toBe(200);
    const row = Object.fromEntries(res.body.rows.map((r) => [r.account_id, r]));
    expect(row.a).toMatchObject({ subscription_id: 'sa', status: 'active', status_ar: 'فعّال', amount_jod: 19.99, due_jod: 19.99, late_days: 0 });
    expect(row.a.last_payment).toMatchObject({ method: 'cliq', method_ar: 'كليك', reference: 'CLQ-1' });
    expect(row.b).toMatchObject({ status: 'past_due', status_ar: 'متأخر', due_jod: 9.99, bot_paused_for_late: true });
    expect(row.b.late_days).toBeGreaterThanOrEqual(10);
    expect(row.c).toMatchObject({ status: 'trial', ends_within_7d: true, status_ar: 'فترة مجانية' });
    expect(row.d).toMatchObject({ status: 'none', status_ar: 'بدون عقد', no_contract: true });
    expect(row.a.usage).toEqual({ ai_replies_month: 0, cap: 1000 });
  });

  test('totals: collected this month, expected, overdue (net of the partial payment), in trial', async () => {
    mockFleet();
    const res = await request(app).get('/api/admin/billing').set(auth());
    expect(res.body.totals.collected_month_jod).toBe(10);
    expect(res.body.totals.overdue_jod).toBe(9.99);
    expect(res.body.totals.in_trial).toBe(1);
    // collected 10 + what falls due before the month ends (b's 9.99 at least).
    expect(res.body.totals.expected_month_jod).toBeGreaterThanOrEqual(19.99);
    // Customers only.
    expect(prisma.business.findMany.mock.calls[0][0].where).toMatchObject({ is_internal: false, business_type: { not: 'shift' } });
  });

  test('SHIFT only', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...ADMIN, role: 'business_owner', business_id: 'a' });
    expect((await request(app).get('/api/admin/billing').set(auth())).status).toBe(403);
  });
});
