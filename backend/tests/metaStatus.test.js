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
  business: { findUnique: jest.fn(), update: jest.fn() },
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
  test('reads our number by its id, so another number\'s health can never be stored', async () => {
    global.fetch
      .mockReturnValueOnce(ok({ account_review_status: 'APPROVED' }))
      .mockReturnValueOnce(ok({ id: 'PN1', display_phone_number: '+962 7 7678 8972', quality_rating: 'GREEN', throughput: { level: 'STANDARD' }, status: 'CONNECTED', name_status: 'DECLINED' }));

    const out = await refresh(business());

    // Asked for by id — not a list we then pick from, which could return a different number.
    const numberCall = global.fetch.mock.calls.map(([u]) => u).find((u) => u.includes('PN1'));
    expect(numberCall).toContain('/PN1?fields=');
    expect(global.fetch.mock.calls.some(([u]) => u.includes('/phone_numbers'))).toBe(false);

    expect(out.meta_quality_rating).toBe('GREEN');
    expect(out.meta_number_status).toBe('CONNECTED');
    expect(out.meta_name_status).toBe('DECLINED');
    expect(out.meta_throughput).toBe('STANDARD');
    expect(out.meta_review_status).toBe('APPROVED');
    expect(prisma.whatsappOnboarding.updateMany.mock.calls[0][0].where).toEqual({ business_id: 'b1' });
  });

  test('with no number configured, one number is unambiguous and several are not', async () => {
    // Exactly one: that is theirs.
    global.fetch
      .mockReturnValueOnce(ok({ account_review_status: 'APPROVED' }))
      .mockReturnValueOnce(ok({ data: [{ id: 'PN9', quality_rating: 'GREEN', status: 'CONNECTED' }] }));
    let out = await refresh(business({ wa_phone_number_id: null }));
    expect(out.meta_quality_rating).toBe('GREEN');

    // Several, and we do not know which: unknown beats guessing the first one.
    global.fetch.mockClear();
    global.fetch
      .mockReturnValueOnce(ok({ account_review_status: 'APPROVED' }))
      .mockReturnValueOnce(ok({ data: [
        { id: 'PN_A', quality_rating: 'RED', status: 'RESTRICTED' },
        { id: 'PN_B', quality_rating: 'GREEN', status: 'CONNECTED' },
      ] }));
    out = await refresh(business({ wa_phone_number_id: null }));
    expect(out.meta_quality_rating).toBeNull();
    expect(out.meta_number_status).toBeNull();
    // The account-level answer is still worth storing.
    expect(out.meta_review_status).toBe('APPROVED');
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

describe('a payment decision must be stated, not inferred', () => {
  beforeEach(() => prisma.whatsappOnboarding.findFirst.mockResolvedValue({ id: 'onb1' }));

  test('an empty body does not silently revoke a confirmation', async () => {
    const res = await request(app).patch('/api/admin/accounts/b1/payment-method').set(auth()).send({});
    expect(res.status).toBe(400);
    expect(prisma.whatsappOnboarding.update).not.toHaveBeenCalled();
  });

  test('the string "false" does not confirm one', async () => {
    const res = await request(app).patch('/api/admin/accounts/b1/payment-method').set(auth())
      .send({ payment_method_ok: 'false' });
    expect(res.status).toBe(400);
    expect(prisma.whatsappOnboarding.update).not.toHaveBeenCalled();
  });
});

describe('when Meta no longer knows the configured number', () => {
  test('the account-level answer is still stored, and the problem is named', async () => {
    // The by-id read fails; the WABA read succeeds. Losing both would trade a wrong answer for
    // no answer, which is not an improvement.
    global.fetch
      .mockReturnValueOnce(ok({ account_review_status: 'APPROVED' }))
      .mockReturnValueOnce(Promise.resolve({ ok: false, json: () => Promise.resolve({ error: { message: 'Unsupported get request. Object does not exist' } }) }));

    const out = await refresh(business());

    expect(out.meta_review_status).toBe('APPROVED');   // kept
    expect(out.meta_quality_rating).toBeNull();        // genuinely unknown
    expect(out.meta_number_status).toBeNull();
    expect(out.number_error).toContain('does not exist');
    expect(prisma.whatsappOnboarding.updateMany).toHaveBeenCalled();
  });

  test('an account holding no numbers at all stores nulls, not an error', async () => {
    global.fetch
      .mockReturnValueOnce(ok({ account_review_status: 'APPROVED' }))
      .mockReturnValueOnce(ok({ data: [] }));

    const out = await refresh(business({ wa_phone_number_id: null }));

    expect(out.meta_review_status).toBe('APPROVED');
    expect(out.meta_quality_rating).toBeNull();
    expect(out.number_error).toBeNull();
  });

  test('a failure on the ACCOUNT read still fails the refresh — that one is not optional', async () => {
    global.fetch.mockReturnValue(Promise.resolve({ ok: false, json: () => Promise.resolve({ error: { message: 'Invalid OAuth access token' } }) }));
    await expect(refresh(business())).rejects.toThrow('Invalid OAuth access token');
  });
});

describe('a hung Graph read gives up (P1 review)', () => {
  test('every Meta read carries a deadline, so the daily sweep cannot wait on it for minutes', async () => {
    const { GRAPH_TIMEOUT_MS } = require('../src/services/metaStatus');
    global.fetch
      .mockReturnValueOnce(ok({ account_review_status: 'APPROVED' }))
      .mockReturnValueOnce(ok({ id: 'PN1', quality_rating: 'GREEN', status: 'CONNECTED' }));
    await refresh(business());
    expect(global.fetch).toHaveBeenCalledTimes(2);
    for (const [, opts] of global.fetch.mock.calls) {
      expect(opts.signal).toBeInstanceOf(AbortSignal);
    }
    expect(GRAPH_TIMEOUT_MS).toBeLessThanOrEqual(15000);
  });
});
