/**
 * tokenHealth: is a shop's stored WhatsApp token still good (debug_token is_valid), and what an
 * invalid one does: revoked_at with revoked_reason 'token_invalid', AccountEvent token_invalid and
 * one alert to SHIFT per revocation. A token found valid again lifts only this module's own
 * revocation. Graph is mocked (axios); no token is ever logged or stored in an event.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');
jest.mock('../src/services/alerts', () => ({ notifyShift: jest.fn() }));

const axios = require('axios');
const db = require('./helpers/fakeDb').getFakeDb();
const alerts = require('../src/services/alerts');
const tokenHealth = require('../src/services/tokenHealth');

const NOW = new Date('2026-10-15T03:00:00Z');

function shop({ onboarding = {}, ...over } = {}) {
  const [b] = db.seed({
    businesses: [{ id: 'shop', name: 'صيدلية النور', business_type: 'generic', wa_access_token: 'plain_test_token', wa_business_account_id: 'WABA1', ...over }],
  }).businesses;
  if (onboarding) {
    db.seed({ whatsappOnboardings: [{ business_id: 'shop', app_id: 'app', meta_business_id: 'mb', waba_id: 'WABA1', phone_number_id: 'PN1', step: 'done', ...onboarding }] });
  }
  return b;
}

const onboarding = () => db.store.whatsappOnboardings[0];
const events = (type) => db.store.accountEvents.filter((e) => e.type === type);
const graphError = (code) => Object.assign(new Error('Request failed'), { response: { status: 400, data: { error: { code, message: 'Error validating access token' } } } });

beforeEach(() => {
  db.reset();
  db.clock.set(NOW);
  axios.get.mockReset();
  alerts.notifyShift.mockReset().mockResolvedValue(null);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('graphCode / isTokenInvalid', () => {
  test('reads the code from an axios error, a SendResult or a number', () => {
    expect(tokenHealth.graphCode(graphError(190))).toBe(190);
    expect(tokenHealth.graphCode({ ok: false, code: 131042 })).toBe(131042);
    expect(tokenHealth.graphCode(190)).toBe(190);
    expect(tokenHealth.graphCode(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBeNull();
    expect(tokenHealth.graphCode(null)).toBeNull();
    expect(tokenHealth.isTokenInvalid(graphError(190))).toBe(true);
    expect(tokenHealth.isTokenInvalid(graphError(131042))).toBe(false);
  });
});

describe('check', () => {
  test('a valid token: stamped, nothing else', async () => {
    const b = shop();
    axios.get.mockResolvedValue({ data: { data: { is_valid: true } } });
    expect(await tokenHealth.check(b, { now: NOW })).toEqual({ status: 'valid' });
    expect(onboarding().token_checked_at).toEqual(NOW);
    expect(onboarding().revoked_at).toBeNull();
    expect(alerts.notifyShift).not.toHaveBeenCalled();
    const [url, { params }] = axios.get.mock.calls[0];
    expect(url).toMatch(/\/debug_token$/);
    expect(params.input_token).toBe('plain_test_token');
  });

  test('is_valid false: revoked as token_invalid, logged, SHIFT told once', async () => {
    const b = shop();
    axios.get.mockResolvedValue({ data: { data: { is_valid: false } } });
    expect(await tokenHealth.check(b, { now: NOW })).toEqual({ status: 'invalid' });
    expect(onboarding()).toMatchObject({ revoked_at: NOW, revoked_reason: 'token_invalid', token_checked_at: NOW });
    expect(events('token_invalid')).toHaveLength(1);
    expect(events('token_invalid')[0]).toMatchObject({ business_id: 'shop', actor_kind: 'meta', data: { source: 'daily_check' } });
    expect(JSON.stringify(db.store.accountEvents)).not.toContain('plain_test_token');
    expect(alerts.notifyShift).toHaveBeenCalledWith(expect.objectContaining({ reason: 'partner_removed', businessId: 'shop' }));

    // The next day's check, still invalid: no second alert.
    await tokenHealth.check(b, { now: new Date(NOW.getTime() + 86400000) });
    expect(events('token_invalid')).toHaveLength(1);
    expect(alerts.notifyShift).toHaveBeenCalledTimes(1);
  });

  test('asked with the token itself, a 190 refusal means invalid', async () => {
    const b = shop();
    axios.get.mockRejectedValue(graphError(190));
    expect((await tokenHealth.check(b, { now: NOW })).status).toBe('invalid');
    expect(onboarding().revoked_reason).toBe('token_invalid');
  });

  test('Meta unreachable: unknown, stamped (so the day is not retried every minute), nothing revoked', async () => {
    const b = shop();
    axios.get.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));
    expect(await tokenHealth.check(b, { now: NOW })).toMatchObject({ status: 'unknown' });
    expect(onboarding().token_checked_at).toEqual(NOW);
    expect(onboarding().revoked_at).toBeNull();
    expect(alerts.notifyShift).not.toHaveBeenCalled();
  });

  test('valid again lifts a token_invalid revocation, never one Meta reported as partner_removed', async () => {
    const b = shop({ onboarding: { revoked_at: NOW, revoked_reason: 'token_invalid' } });
    axios.get.mockResolvedValue({ data: { data: { is_valid: true } } });
    await tokenHealth.check(b, { now: NOW });
    expect(onboarding()).toMatchObject({ revoked_at: null, revoked_reason: null });

    db.reset();
    const removed = shop({ onboarding: { revoked_at: NOW, revoked_reason: 'partner_removed' } });
    await tokenHealth.check(removed, { now: NOW });
    expect(onboarding()).toMatchObject({ revoked_reason: 'partner_removed' });
  });

  test('no stored token: unknown, no Graph call', async () => {
    const b = shop({ wa_access_token: null });
    expect((await tokenHealth.check(b, { now: NOW })).status).toBe('unknown');
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe('markInvalid (error 190 on a send)', () => {
  test('a shop wired by hand (no onboarding row) is logged and told at most once a day', async () => {
    const b = shop({ onboarding: null });
    expect(await tokenHealth.markInvalid(b, { source: 'send', now: NOW })).toBe(true);
    expect(await tokenHealth.markInvalid(b, { source: 'send', now: new Date(NOW.getTime() + 3600000) })).toBe(false);
    expect(events('token_invalid')).toHaveLength(1);
    expect(alerts.notifyShift).toHaveBeenCalledTimes(1);
  });

  test('never throws', async () => {
    const b = shop();
    db.failNext('whatsappOnboarding.findUnique', new Error('db down'));
    await expect(tokenHealth.markInvalid(b, { now: NOW })).resolves.toBe(false);
  });
});
