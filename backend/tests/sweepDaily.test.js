/**
 * The sweeper's once-a-day step (shiftSweeper.sweepDaily, docs/panels/spec.md P1): Meta's view of
 * the number (metaStatus.refresh) and the debug_token is_valid check (tokenHealth) for every
 * connected customer shop, on the first sweep of each Amman day. SHIFT's own number, the internal
 * rows, closed accounts and shops without a number or token are left alone; a shop another
 * instance already checked today (token_checked_at) is skipped; one shop's failure does not stop
 * the rest. Graph is mocked (axios), metaStatus is mocked.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');
jest.mock('../src/services/metaStatus', () => ({ refresh: jest.fn(), metaAttention: jest.fn(() => []) }));
jest.mock('../src/services/alerts', () => ({
  ...jest.requireActual('../src/services/alerts'),
  sendStaffAlert: jest.fn(),
  notifyShift: jest.fn(),
}));

const axios = require('axios');
const db = require('./helpers/fakeDb').getFakeDb();
const metaStatus = require('../src/services/metaStatus');
const alerts = require('../src/services/alerts');
const { sweepDaily, resetDaily, runSweep } = require('../src/services/shiftSweeper');

// 2026-10-15 00:05 in Amman.
const NOW = new Date('2026-10-14T21:05:00Z');

function seed() {
  db.seed({
    businesses: [
      { id: 'shop1', name: 'صيدلية', business_type: 'generic', wa_access_token: 'tok1', wa_business_account_id: 'W1' },
      { id: 'shop2', name: 'مطعم', business_type: 'restaurant', wa_access_token: 'tok2', wa_business_account_id: null },
      { id: 'shift', name: 'SHIFT', business_type: 'shift', wa_access_token: 'tok3', wa_business_account_id: 'W3' },
      { id: 'sim', name: 'sim', business_type: 'generic', is_internal: true, wa_access_token: 'tok4' },
      { id: 'closed', name: 'مغلق', business_type: 'generic', status: 'closed', wa_access_token: 'tok5' },
      { id: 'unwired', name: 'جديد', business_type: 'generic', wa_phone_number_id: null, wa_access_token: null },
    ],
    whatsappOnboardings: [
      { business_id: 'shop1', app_id: 'a', meta_business_id: 'm', waba_id: 'W1', phone_number_id: 'P1', step: 'done' },
    ],
  });
}

const checkedTokens = () => axios.get.mock.calls.map(([, { params }]) => params.input_token);

beforeEach(() => {
  db.reset();
  db.clock.set(NOW);
  resetDaily();
  jest.clearAllMocks();
  metaStatus.refresh.mockReset().mockResolvedValue({});
  axios.get.mockReset().mockResolvedValue({ data: { data: { is_valid: true } } });
  alerts.notifyShift.mockReset().mockResolvedValue(null);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('checks every connected customer shop once, and stamps token_checked_at', async () => {
  seed();
  const out = await sweepDaily(NOW);

  expect(out).toMatchObject({ date: '2026-10-15', shops: 2, skipped: 0, meta_refreshed: 1, token_valid: 2, errors: 0 });
  expect(checkedTokens().sort()).toEqual(['tok1', 'tok2']);
  // shop2 has no WABA id: nothing for Meta to report on the number.
  expect(metaStatus.refresh).toHaveBeenCalledTimes(1);
  expect(metaStatus.refresh.mock.calls[0][0].id).toBe('shop1');
  expect(db.store.whatsappOnboardings[0].token_checked_at).toEqual(NOW);
});

test('runs once per Amman day', async () => {
  seed();
  await sweepDaily(NOW);
  expect(await sweepDaily(new Date(NOW.getTime() + 60 * 1000))).toBeNull();
  expect(await sweepDaily(new Date('2026-10-15T20:59:00Z'))).toBeNull(); // 23:59 the same day

  const next = await sweepDaily(new Date('2026-10-15T21:01:00Z')); // 00:01 the next day
  expect(next).toMatchObject({ date: '2026-10-16' });
  expect(axios.get).toHaveBeenCalledTimes(4);
});

test('a shop another instance already checked today is skipped', async () => {
  seed();
  db.store.whatsappOnboardings[0].token_checked_at = new Date(NOW.getTime() - 60 * 1000); // 00:04 today
  const out = await sweepDaily(NOW);
  expect(out).toMatchObject({ shops: 1, skipped: 1 });
  expect(checkedTokens()).toEqual(['tok2']);
});

test('an invalid token is recorded; a failed Meta refresh does not stop the token check or the next shop', async () => {
  seed();
  metaStatus.refresh.mockRejectedValue(new Error('graph 500'));
  axios.get.mockImplementation(async (url, { params }) => ({ data: { data: { is_valid: params.input_token !== 'tok1' } } }));

  const out = await sweepDaily(NOW);
  expect(out).toMatchObject({ errors: 1, token_invalid: 1, token_valid: 1 });
  expect(db.store.whatsappOnboardings[0]).toMatchObject({ revoked_reason: 'token_invalid' });
  expect(db.store.accountEvents.filter((e) => e.type === 'token_invalid')).toHaveLength(1);
});

test('runSweep carries the step in its report, and a failed shop list is retried next minute', async () => {
  seed();
  db.failNext('business.findMany', new Error('db down'));
  const first = await runSweep({ now: NOW });
  expect(first.errors.some((e) => e.startsWith('daily: db down'))).toBe(true);
  expect(first.daily).toBeNull();

  const second = await runSweep({ now: new Date(NOW.getTime() + 60 * 1000) });
  expect(second.daily).toMatchObject({ shops: 2 });
});
