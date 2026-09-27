/**
 * What Meta says about a number, and the one thing it will not say.
 *
 * The fleet view used to declare quality rating and throughput «unavailable». They are
 * available per account with that account's own business token. The payment method is not —
 * Meta refuses primary_funding_id — and a flag nothing could set meant every account showed as
 * unpaid forever, on the one deadline that matters this week.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  user: { findUnique: jest.fn() },
  business: { findUnique: jest.fn() },
  whatsappOnboarding: { findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const { encrypt } = require('../src/utils/tokenCrypto');
const { refresh, metaAttention } = require('../src/services/metaStatus');
const app = require('../src/app');

const ADMIN = { id: 'a1', name: 'A', email: 'admin@shifts-ai.com', role: 'platform_admin', business_id: null, active: true };
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: 'a1' }, process.env.JWT_SECRET)}` });

const business = (over = {}) => ({
  id: 'b1', wa_business_account_id: 'WABA1', wa_phone_number_id: 'PN1', wa_access_token: encrypt('tok'), ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(ADMIN);
  prisma.whatsappOnboarding.updateMany.mockResolvedValue({ count: 1 });
  global.fetch = jest.fn();
});
afterEach(() => { delete global.fetch; });

const ok = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

describe('reading Meta', () => {
  test('stores the number\'s own health, keyed to the right number', async () => {
    global.fetch
      .mockReturnValueOnce(ok({ account_review_status: 'APPROVED' }))
      .mockReturnValueOnce(ok({ data: [
        { id: 'PN_OTHER', quality_rating: 'RED', status: 'FLAGGED', name_status: 'APPROVED' },
        { id: 'PN1', display_phone_number: '+962 7 7678 8972', quality_rating: 'GREEN', throughput: { level: 'STANDARD' }, status: 'CONNECTED', name_status: 'DECLINED' },
      ] }));

    const out = await refresh(business());

    // The account may hold more than one number; ours is the one that matters.
    expect(out.meta_quality_rating).toBe('GREEN');
    expect(out.meta_number_status).toBe('CONNECTED');
    expect(out.meta_name_status).toBe('DECLINED');
    expect(out.meta_throughput).toBe('STANDARD');
    expect(out.meta_review_status).toBe('APPROVED');
    expect(prisma.whatsappOnboarding.updateMany.mock.calls[0][0].where).toEqual({ business_id: 'b1' });
  });

  test('a Graph error is reported in its own words, not as a stack', async () => {
    global.fetch.mockReturnValue(Promise.resolve({ ok: false, json: () => Promise.resolve({ error: { message: 'You do not have permission' } }) }));
    await expect(refresh(business())).rejects.toThrow('You do not have permission');
  });

  test('an account with no token or no WABA fails before calling Meta', async () => {
    await expect(refresh(business({ wa_access_token: null }))).rejects.toThrow(/رمز وصول/);
    await expect(refresh(business({ wa_business_account_id: null }))).rejects.toThrow(/حساب واتساب/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('what Meta says becomes attention', () => {
  test('a red rating is critical, a yellow one is a warning', () => {
    expect(metaAttention({ meta_quality_rating: 'RED' })[0]).toMatchObject({ severity: 'critical', category: 'meta_quality' });
    expect(metaAttention({ meta_quality_rating: 'YELLOW' })[0]).toMatchObject({ severity: 'warning' });
    expect(metaAttention({ meta_quality_rating: 'GREEN' })).toEqual([]);
  });

  test('a number Meta no longer calls CONNECTED is critical', () => {
    expect(metaAttention({ meta_number_status: 'RESTRICTED' })[0]).toMatchObject({ severity: 'critical', category: 'meta_number' });
    expect(metaAttention({ meta_number_status: 'CONNECTED' })).toEqual([]);
  });

  test('a declined display name is raised — the customer sees a bare number', () => {
    const item = metaAttention({ meta_name_status: 'DECLINED' })[0];
    expect(item).toMatchObject({ severity: 'warning', category: 'meta_name' });
  });

  test('nothing checked yet raises nothing', () => {
    expect(metaAttention(null)).toEqual([]);
    expect(metaAttention({})).toEqual([]);
  });
});

describe('confirming the payment method', () => {
  test('records who said so and when', async () => {
    prisma.whatsappOnboarding.findFirst.mockResolvedValue({ id: 'onb1' });
    prisma.whatsappOnboarding.update.mockImplementation(({ data }) => Promise.resolve(data));

    const res = await request(app).patch('/api/admin/accounts/b1/payment-method').set(auth())
      .send({ payment_method_ok: true });

    expect(res.status).toBe(200);
    const data = prisma.whatsappOnboarding.update.mock.calls[0][0].data;
    expect(data.payment_method_ok).toBe(true);
    expect(data.payment_method_marked_by).toBe('admin@shifts-ai.com');
    expect(data.payment_method_marked_at).toBeInstanceOf(Date);
  });

  test('taking it back clears who said so, rather than leaving a stale name', async () => {
    prisma.whatsappOnboarding.findFirst.mockResolvedValue({ id: 'onb1' });
    prisma.whatsappOnboarding.update.mockImplementation(({ data }) => Promise.resolve(data));

    await request(app).patch('/api/admin/accounts/b1/payment-method').set(auth()).send({ payment_method_ok: false });

    const data = prisma.whatsappOnboarding.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ payment_method_ok: false, payment_method_marked_by: null, payment_method_marked_at: null });
  });

  test('a business user cannot confirm it for anyone', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...ADMIN, role: 'business_owner', business_id: 'b1' });
    const res = await request(app).patch('/api/admin/accounts/b1/payment-method').set(auth()).send({ payment_method_ok: true });
    expect(res.status).toBe(403);
  });
});
