/**
 * The owner_alert template submitted to each newly connected shop's WABA (services/ownerAlertTemplate.js).
 *
 * Without an approved template a handoff alert to an owner outside 24 h is skipped, so a quiet shop's
 * owner never heard a customer ask for a person. What these defend: the payload Meta accepts (UTILITY,
 * three variables, the body not ending on one); alert_template named only once Meta approved it, and
 * never over a template already set; a template already on the WABA read instead of failing; the
 * daily poll; and that nothing here throws or ever stores the token. Graph is mocked (axios).
 */
require('./setup');

jest.mock('axios');
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const axios = require('axios');
const db = require('./helpers/fakeDb').getFakeDb();
const { encrypt } = require('../src/utils/tokenCrypto');
const oat = require('../src/services/ownerAlertTemplate');
const { ALERT_TEMPLATE_BODY } = require('../src/services/alerts');

const TOKEN = 'EAAG' + 'x'.repeat(40);
const shop = () => db.store.businesses.find((b) => b.id === 'biz1');

function seed(over = {}) {
  db.seed({
    businesses: [{
      id: 'biz1', name: 'مطعم الشام', business_type: 'restaurant', wa_business_account_id: 'WABA1',
      wa_access_token: encrypt(TOKEN), ai_config: { alert_wa_numbers: ['962791234567'] }, ...over,
    }],
  });
}

beforeEach(() => {
  db.reset();
  axios.post.mockReset();
  axios.get.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('the template Meta reviews: UTILITY, Arabic, the staff alert\'s three variables, not ending on one', () => {
  const p = oat.templatePayload();
  expect(p).toMatchObject({ name: 'owner_alert', language: 'ar', category: 'UTILITY' });
  const body = p.components[0].text;
  expect(body.match(/\{\{\d\}\}/g)).toEqual(['{{1}}', '{{2}}', '{{3}}']);
  expect(body).toMatch(/^[^{]/);
  expect(body).toMatch(/[^}]$/);
  // Same slots, in the same order, as the staff alert alerts.js fills.
  expect(ALERT_TEMPLATE_BODY.match(/\{\{\d\}\}/g)).toEqual(['{{1}}', '{{2}}', '{{3}}']);
  expect(p.components[0].example.body_text[0]).toHaveLength(3);
});

test('after connect it is submitted with the shop\'s own token and remembered as pending', async () => {
  seed();
  axios.post.mockResolvedValue({ data: { id: 'T1', status: 'PENDING', category: 'UTILITY' } });

  expect(await oat.submitAfterConnect('biz1')).toBe('pending');
  const [url, body, opts] = axios.post.mock.calls[0];
  expect(url).toMatch(/\/WABA1\/message_templates$/);
  expect(body.name).toBe('owner_alert');
  expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);

  expect(shop().ai_config.owner_alert_template).toMatchObject({ name: 'owner_alert', language: 'ar', id: 'T1', status: 'PENDING' });
  // Not approved yet: a send through it would fail, so it is not named.
  expect(shop().ai_config.alert_template).toBeUndefined();
  expect(JSON.stringify(shop().ai_config)).not.toContain(TOKEN);
  expect(JSON.stringify(db.store.accountEvents)).not.toContain(TOKEN);
});

test('approved at once: alert_template is set and logged', async () => {
  seed();
  axios.post.mockResolvedValue({ data: { id: 'T1', status: 'APPROVED' } });
  expect(await oat.submitAfterConnect('biz1')).toBe('approved');
  expect(shop().ai_config.alert_template).toEqual({ name: 'owner_alert', language: 'ar' });
  expect(shop().ai_config.alert_wa_numbers).toEqual(['962791234567']);
  expect(db.store.accountEvents.map((e) => e.type)).toEqual(['owner_alert_template_approved']);
});

test('already on the WABA (a reconnect): its status is read instead of failing', async () => {
  seed();
  axios.post.mockRejectedValue({ response: { data: { error: { code: 100, error_subcode: 2388024, message: 'exists' } } } });
  axios.get.mockResolvedValue({ data: { data: [{ id: 'T0', name: 'owner_alert', language: 'ar', status: 'APPROVED' }] } });
  expect(await oat.submitAfterConnect('biz1')).toBe('approved');
  expect(shop().ai_config.alert_template).toEqual({ name: 'owner_alert', language: 'ar' });
});

test('a template already set (SHIFT\'s staff_alert, or set by hand) is never replaced, and nothing is submitted', async () => {
  seed({ ai_config: { alert_template: { name: 'staff_alert', language: 'ar' } } });
  expect(await oat.submitAfterConnect('biz1')).toBe('skipped');
  expect(axios.post).not.toHaveBeenCalled();
});

test('SHIFT\'s own and internal rows, and a shop without WABA or token, are skipped', async () => {
  seed({ business_type: 'shift' });
  expect(await oat.submitAfterConnect('biz1')).toBe('skipped');
  db.reset();
  seed({ wa_business_account_id: null });
  expect(await oat.submitAfterConnect('biz1')).toBe('skipped');
  expect(axios.post).not.toHaveBeenCalled();
});

test('Meta refusing is logged without the token and never throws', async () => {
  seed();
  axios.post.mockRejectedValue({ response: { data: { error: { code: 200, message: `bad ${TOKEN}` } } }, message: 'x' });
  expect(await oat.submitAfterConnect('biz1')).toBe('failed');
  expect(db.store.accountEvents.map((e) => e.type)).toEqual(['owner_alert_template_failed']);
  expect(JSON.stringify(db.store.accountEvents)).not.toContain(TOKEN);
  expect(await oat.submitAfterConnect('nope')).toBe('skipped');
});

test('the daily poll names it once Meta approves, and leaves rejected ones alone', async () => {
  seed({ ai_config: { owner_alert_template: { name: 'owner_alert', language: 'ar', id: 'T1', status: 'PENDING' } } });
  db.seed({
    businesses: [{
      id: 'biz2', name: 'رفض', business_type: 'generic', wa_business_account_id: 'WABA2', wa_access_token: encrypt(TOKEN),
      ai_config: { owner_alert_template: { name: 'owner_alert', language: 'ar', status: 'REJECTED' } },
    }],
  });
  axios.get.mockResolvedValueOnce({ data: { data: [{ id: 'T1', name: 'owner_alert', language: 'ar', status: 'PENDING' }] } });
  expect(await oat.pollPending()).toEqual({ checked: 1, approved: 0, errors: 0, deferred: 0 });
  expect(shop().ai_config.alert_template).toBeUndefined();

  axios.get.mockResolvedValueOnce({ data: { data: [{ id: 'T1', name: 'owner_alert', language: 'ar', status: 'APPROVED' }] } });
  expect(await oat.pollPending()).toEqual({ checked: 1, approved: 1, errors: 0, deferred: 0 });
  expect(shop().ai_config.alert_template).toEqual({ name: 'owner_alert', language: 'ar' });
  expect(axios.get.mock.calls.every(([url]) => url.includes('/WABA1/'))).toBe(true);

  // Named now: nothing left to poll.
  expect(await oat.pollPending()).toEqual({ checked: 0, approved: 0, errors: 0, deferred: 0 });
});
