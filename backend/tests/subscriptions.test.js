/**
 * Contracts and payments: what a customer bought, recorded by staff, scoped to the account
 * in the URL and never to an id the request supplies.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  user: { findUnique: jest.fn() },
  business: { findUnique: jest.fn() },
  subscription: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  payment: { create: jest.fn() },
  $transaction: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const app = require('../src/app');

const ADMIN = { id: 'admin1', name: 'A', email: 'a@shifts-ai.com', role: 'platform_admin', business_id: null, active: true };
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: 'admin1' }, process.env.JWT_SECRET)}` });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(ADMIN);
  prisma.business.findUnique.mockResolvedValue({ id: 'b1' });
  prisma.subscription.create.mockImplementation(({ data }) => Promise.resolve({ id: 's1', ...data, payments: [] }));
});

describe('creating a contract', () => {
  test('records the solution, terms and a next due date one cycle out', async () => {
    const res = await request(app).post('/api/admin/accounts/b1/subscriptions').set(auth())
      .send({ solution: 'karam_bot', amount_jod: '120', billing_cycle: 'monthly', starts_at: '2026-09-01' });

    expect(res.status).toBe(201);
    const data = prisma.subscription.create.mock.calls[0][0].data;
    expect(data.business_id).toBe('b1');
    expect(data.amount_jod).toBe(120);
    expect(new Date(data.next_due_at).toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(data.created_by).toBe('admin1');
  });

  test('the business is the one in the URL, whatever the body says', async () => {
    await request(app).post('/api/admin/accounts/b1/subscriptions').set(auth())
      .send({ solution: 'automation', amount_jod: 50, business_id: 'OTHER' });
    expect(prisma.subscription.create.mock.calls[0][0].data.business_id).toBe('b1');
  });

  test('a one-time deal has no next due date', async () => {
    await request(app).post('/api/admin/accounts/b1/subscriptions').set(auth())
      .send({ solution: 'website', amount_jod: 900, billing_cycle: 'one_time' });
    expect(prisma.subscription.create.mock.calls[0][0].data.next_due_at).toBeNull();
  });

  test('an unknown solution or a bad amount is refused', async () => {
    let res = await request(app).post('/api/admin/accounts/b1/subscriptions').set(auth()).send({ solution: 'magic', amount_jod: 10 });
    expect(res.status).toBe(400);
    res = await request(app).post('/api/admin/accounts/b1/subscriptions').set(auth()).send({ solution: 'karam_bot', amount_jod: 'lots' });
    expect(res.status).toBe(400);
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  test('a business user cannot record contracts', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...ADMIN, role: 'business_owner', business_id: 'b1' });
    const res = await request(app).post('/api/admin/accounts/b1/subscriptions').set(auth()).send({ solution: 'karam_bot', amount_jod: 10 });
    expect(res.status).toBe(403);
  });
});

describe('recording a payment', () => {
  const sub = { id: 's1', business_id: 'b1', status: 'past_due', billing_cycle: 'monthly', next_due_at: new Date('2026-09-01'), amount_jod: 120 };

  test('a payment on a past_due contract makes it active again and moves the due date on', async () => {
    prisma.subscription.findFirst.mockResolvedValue(sub);
    const tx = { payment: { create: jest.fn().mockResolvedValue({}) }, subscription: { update: jest.fn().mockResolvedValue({ ...sub, status: 'active', payments: [] }) } };
    prisma.$transaction.mockImplementation((fn) => fn(tx));

    const res = await request(app).post('/api/admin/accounts/b1/subscriptions/s1/payments').set(auth())
      .send({ amount_jod: 120, method: 'cliq', paid_at: '2026-09-24', reference: 'CLQ-88' });

    expect(res.status).toBe(201);
    expect(tx.payment.create.mock.calls[0][0].data).toMatchObject({ business_id: 'b1', amount_jod: 120, method: 'cliq', reference: 'CLQ-88', recorded_by: 'admin1' });
    const advance = tx.subscription.update.mock.calls[0][0].data;
    expect(advance.status).toBe('active');
    expect(new Date(advance.next_due_at).toISOString().slice(0, 10)).toBe('2026-10-01');
  });

  test("a subscription id from another account is simply not found", async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);   // scoped by business_id in the query
    const res = await request(app).post('/api/admin/accounts/b1/subscriptions/someone-elses/payments').set(auth())
      .send({ amount_jod: 10, method: 'cash' });
    expect(res.status).toBe(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('an unknown method or a zero amount is refused before anything is written', async () => {
    prisma.subscription.findFirst.mockResolvedValue(sub);
    let res = await request(app).post('/api/admin/accounts/b1/subscriptions/s1/payments').set(auth()).send({ amount_jod: 10, method: 'crypto' });
    expect(res.status).toBe(400);
    res = await request(app).post('/api/admin/accounts/b1/subscriptions/s1/payments').set(auth()).send({ amount_jod: 0, method: 'cash' });
    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('changing a contract', () => {
  test('cancelling stamps when, and is scoped to the account', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ id: 's1' });
    prisma.subscription.update.mockResolvedValue({ id: 's1', business_id: 'b1', status: 'cancelled', amount_jod: 120, payments: [] });
    const res = await request(app).patch('/api/admin/accounts/b1/subscriptions/s1').set(auth()).send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(prisma.subscription.findFirst.mock.calls[0][0].where).toMatchObject({ id: 's1', business_id: 'b1' });
    expect(prisma.subscription.update.mock.calls[0][0].data.cancelled_at).toBeInstanceOf(Date);
  });
});
