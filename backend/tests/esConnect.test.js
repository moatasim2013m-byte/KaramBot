/**
 * connectFromCode: from the 30-second code to a live, filled-in shop (docs/panels/spec.md P1).
 *
 * Run through the real app and the in-memory database, with Meta answering from the assumed
 * fixtures in tests/fixtures/esAssumed.js (G1 replaces them with recorded ones). What it proves:
 * every FINISH_* event and a missing FINISH still connect; a number Meta did not settle keeps the
 * token so the customer never redoes the popup; coexistence is never registered; a reconnect
 * re-exchanges instead of keeping a dead token; the profile fills itself from Meta; the free month
 * is created once, at connect; and the answers follow the panels' contract in Arabic with no ids.
 * Tenant binding itself is esTenant.test.js.
 */
require('./setup');

jest.mock('axios');
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const axios = require('axios');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('./helpers/fakeDb').getFakeDb();
const settings = require('../src/services/platformSettings');
const alerts = require('../src/services/alerts');
const { encrypt, decrypt } = require('../src/utils/tokenCrypto');
const { embeddedSignupAppId } = require('../src/utils/metaSecrets');
const { ERRORS_AR, ensureTrialSubscription } = require('../src/services/embeddedSignup');
const fx = require('./fixtures/esAssumed');
const app = require('../src/app');

const { IDS } = fx;
const APP = embeddedSignupAppId();
const OWNER_BASE = '/api/whatsapp/embedded-signup';
const adminBase = (id) => `/api/admin/accounts/${id}/embedded-signup`;
const TOKEN_2 = `EAAK${'y'.repeat(60)}`;

let nonce = 0;
const as = (userId) => ({ Authorization: `Bearer ${jwt.sign({ id: userId, n: (nonce += 1) }, process.env.JWT_SECRET)}` });
const ADMIN = () => as('u_admin');
const OWNER = () => as('u_owner');

const CONTRACT_KEYS = ['step', 'display_phone', 'verified_name', 'name_status', 'quality_rating', 'payment',
  'last_error_ar', 'needs_pin', 'failed_step'];

/**
 * Meta, answering from the fixtures. `numbers` is what GET /{waba}/phone_numbers lists, `wabas`
 * what the token was granted; `register` / `exchange` can be made to fail.
 */
function meta({
  token = fx.TOKEN, wabas = [IDS.WABA], numbers = [fx.number()], exchange = null, register = null,
} = {}) {
  axios.get.mockImplementation(async (url) => {
    if (url.endsWith('/oauth/access_token')) {
      if (exchange) throw exchange;
      return { data: fx.tokenExchange(token) };
    }
    if (url.endsWith('/debug_token')) return { data: fx.debugToken({ wabas }) };
    if (url.endsWith('/phone_numbers')) return { data: fx.phoneNumbers(numbers) };
    if (url.endsWith('/me')) return { data: fx.me() };
    throw new Error(`unexpected GET ${url}`);
  });
  axios.post.mockImplementation(async (url) => {
    if (url.endsWith('/register') && register) throw register;
    return { data: { success: true } };
  });
}
const gets = (suffix) => axios.get.mock.calls.filter(([url]) => url.endsWith(suffix));
const posts = (suffix) => axios.post.mock.calls.filter(([url]) => url.endsWith(suffix));

const business = (id = 'biz_sham') => db.store.businesses.find((b) => b.id === id);
const onboardingOf = (businessId = 'biz_sham') => db.store.whatsappOnboardings.find((r) => r.business_id === businessId);
const eventsOf = (businessId = 'biz_sham') => db.store.accountEvents.filter((e) => e.business_id === businessId);
const subscriptionsOf = (businessId = 'biz_sham') => db.store.subscriptions.filter((s) => s.business_id === businessId);

// What the browser posts: the code plus the FINISH payload's data, as ConnectWhatsApp sends it.
const bodyFrom = (message, over = {}) => ({
  code: 'AQD_code_30s',
  finish_event: message?.event ?? null,
  waba_id: message?.data?.waba_id,
  phone_number_id: message?.data?.phone_number_id,
  meta_business_id: message?.data?.business_id,
  session_id: 'meta-session-1',
  ...over,
});

let notify;
beforeEach(() => {
  db.reset();
  settings.clearCache();
  axios.get.mockReset();
  axios.post.mockReset();
  // metaStatus.refresh reads Meta with fetch; here it answers for the connected number.
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () => (url.includes('fields=account_review_status')
      ? { account_review_status: 'APPROVED', id: IDS.WABA }
      : { ...fx.number(), name_status: 'PENDING_REVIEW', status: 'CONNECTED' }),
  }));
  notify = jest.spyOn(alerts, 'notifyShift').mockResolvedValue(null);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  db.seed({
    businesses: [
      { id: 'biz_sham', name: 'مطعم الشام', slug: 'sham', wa_phone_number_id: null, owner_phone: '962791234567' },
      { id: 'biz_other', name: 'صالون ريم', slug: 'reem', wa_phone_number_id: IDS.PHONE_2, wa_business_account_id: '104900000000009' },
    ],
    users: [
      { id: 'u_admin', role: 'platform_admin', business_id: null, email: 'ops@shifts-ai.com' },
      { id: 'u_owner', role: 'business_owner', business_id: 'biz_sham' },
    ],
  });
});
afterEach(() => { jest.restoreAllMocks(); delete global.fetch; });

describe('a clean FINISH fills the shop\'s profile from Meta', () => {
  test('number, Meta name, portfolio, token and connect time land on the Business row', async () => {
    meta();
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finish()));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('connected');
    expect(business()).toMatchObject({
      wa_phone_number_id: IDS.PHONE,
      wa_business_account_id: IDS.WABA,
      wa_app_id: APP,
      wa_display_phone: '+962 7 9123 4567',
      wa_verified_name: 'مطعم الشام',
      meta_business_id: IDS.PORTFOLIO,
      name: 'مطعم الشام', // the operator's name for the shop is never overwritten
    });
    expect(business().connected_at).toBeInstanceOf(Date);
    expect(decrypt(business().wa_access_token)).toBe(fx.TOKEN);

    // Exchange first, then the proof, then subscribe and register: in that order.
    const order = [...axios.get.mock.calls, ...axios.post.mock.calls].map(([url]) => url.split('/').pop());
    expect(order).toEqual(['access_token', 'debug_token', 'phone_numbers', 'me', 'subscribed_apps', 'register']);

    // metaStatus.refresh ran right after, so the Meta panel is never empty.
    expect(global.fetch).toHaveBeenCalled();
    expect(onboardingOf()).toMatchObject({ meta_name_status: 'PENDING_REVIEW', meta_quality_rating: 'GREEN', finish_event: 'FINISH', step: 'done' });
  });

  test('the answer follows the contract, in Arabic, with the number as Meta shows it and no ids', async () => {
    meta();
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finish()));
    for (const key of CONTRACT_KEYS) expect(res.body.onboarding).toHaveProperty(key);
    expect(res.body.onboarding).toMatchObject({
      step: 'done', display_phone: '+962 7 9123 4567', verified_name: 'مطعم الشام', name_status: 'PENDING_REVIEW',
      quality_rating: 'GREEN', payment: { confirmed: false, claimed: false, blocked: false },
      last_error_ar: null, needs_pin: false, failed_step: null,
    });
    const json = JSON.stringify(res.body);
    for (const hidden of [IDS.PHONE, IDS.WABA, IDS.PORTFOLIO, fx.TOKEN, 'access_token', 'biz_sham']) {
      expect(json).not.toContain(hidden);
    }
  });

  test('es_connected is logged with SHIFT as the actor, and SHIFT is told «customer_connected»', async () => {
    meta();
    await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finish()));
    expect(eventsOf().map((e) => [e.type, e.actor_kind, e.actor_user_id])).toEqual([['es_connected', 'shift', 'u_admin']]);
    expect(eventsOf()[0].data).toMatchObject({ waba_id: IDS.WABA, phone_number_id: IDS.PHONE, finish_event: 'FINISH' });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'customer_connected', businessId: 'biz_sham', summary: expect.stringContaining('+962 7 9123 4567'),
    }));
  });
});

describe('the free month is created once, at connect', () => {
  test('a trial on the plan\'s terms and the campaign, with no subscription before the connect', async () => {
    expect(subscriptionsOf()).toEqual([]); // nothing at invite time
    meta();
    await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finish()));

    const subs = subscriptionsOf();
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      solution: 'karam_bot', status: 'trial', amount_jod: 19.99, ai_replies_month: 1000, seats: 3, campaign: 'irbid-2026-10',
    });
    // trial_starts 'first_reply': until the first reply, the latest the free month can end
    // (connect + 14-day backstop + 30 days).
    const days = (subs[0].trial_ends_at - business().connected_at) / 86400000;
    expect(Math.round(days)).toBe(44);
  });

  test('a reconnect, a retry or a direct second call never adds a second one', async () => {
    meta();
    await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finish()));
    meta({ token: TOKEN_2 });
    await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finish(), { code: 'second' }));
    await request(app).post(`${adminBase('biz_sham')}/retry`).set(ADMIN()).send({});
    const again = await ensureTrialSubscription('biz_sham');
    expect(again.created).toBe(false);
    expect(subscriptionsOf()).toHaveLength(1);
  });

  test('the campaign setting decides the free-month rules', async () => {
    db.seed({ platformSettings: [{ key: 'campaign', value: { slug: 'irbid-2026-11', trial_days: 30, trial_starts: 'connect' } }] });
    settings.clearCache();
    meta();
    await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finish()));
    const [sub] = subscriptionsOf();
    expect(sub.campaign).toBe('irbid-2026-11');
    expect(Math.round((sub.trial_ends_at - business().connected_at) / 86400000)).toBe(30);
  });
});

describe('every FINISH event connects, and a missing number is found on the server', () => {
  test('FINISH_ONLY_WABA with no phone_number_id: the WABA\'s single number is used', async () => {
    meta();
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finishOnlyWaba()));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('connected');
    expect(business().wa_phone_number_id).toBe(IDS.PHONE);
    expect(onboardingOf().finish_event).toBe('FINISH_ONLY_WABA');
  });

  test('no FINISH at all: the token\'s only WABA and its only number', async () => {
    meta();
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN())
      .send({ code: 'AQD_code_30s', finish_event: null });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('connected');
    expect(business()).toMatchObject({ wa_phone_number_id: IDS.PHONE, wa_business_account_id: IDS.WABA });
  });

  test('a WABA with no number yet: needs_number, the token and WABA kept, Meta not touched further', async () => {
    meta({ numbers: [] });
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finishOnlyWaba()));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'needs_number', onboarding: { last_error_ar: ERRORS_AR.needs_number } });
    const row = onboardingOf();
    expect(row).toMatchObject({ waba_id: IDS.WABA, phone_number_id: null, step: 'token_exchanged', needs_operator: false });
    expect(decrypt(row.access_token_enc)).toBe(fx.TOKEN);
    expect(axios.post).not.toHaveBeenCalled();
    expect(business().wa_phone_number_id).toBeNull();
    expect(subscriptionsOf()).toEqual([]);
    expect(eventsOf().map((e) => e.type)).toEqual(['es_failed']);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ reason: 'needs_operator' }));
  });

  test('several numbers and none named: needs_operator, and SHIFT finishes without a second popup', async () => {
    const numbers = [fx.number(), fx.number({ id: '109900000000003', display: '+962 7 9000 0003', name: 'فرع ٢' })];
    meta({ numbers });
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send({ code: 'c', finish_event: 'FINISH_ONLY_WABA' });
    expect(res.body.status).toBe('needs_operator');
    expect(res.body.onboarding.last_error_ar).toBe(ERRORS_AR.needs_operator);
    const row = onboardingOf();
    expect(row).toMatchObject({ phone_number_id: null, needs_operator: true });

    // «أكمل الربط»: the list to pick from, then the pick. The stored token does it all.
    const list = await request(app).get(`/api/admin/onboardings/${row.id}/numbers`).set(ADMIN());
    expect(list.body.numbers.map((n) => n.display_phone)).toEqual(['+962 7 9123 4567', '+962 7 9000 0003']);
    const done = await request(app).post(`/api/admin/onboardings/${row.id}/complete`).set(ADMIN()).send({ phone_number_id: IDS.PHONE });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('connected');
    expect(business()).toMatchObject({ wa_phone_number_id: IDS.PHONE, wa_display_phone: '+962 7 9123 4567' });
    expect(gets('/oauth/access_token')).toHaveLength(1); // the customer's one code, never a second
    expect(subscriptionsOf()).toHaveLength(1);
  });

  test('a reconnect with several numbers keeps the shop\'s own one', async () => {
    meta();
    await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finish()));
    meta({ token: TOKEN_2, numbers: [fx.number({ id: '109900000000003' }), fx.number()] });
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send({ code: 'again', finish_event: null });
    expect(res.body.status).toBe('connected');
    expect(business().wa_phone_number_id).toBe(IDS.PHONE);
  });

  test('a FINISH that is not a FINISH is refused before the code is spent', async () => {
    meta();
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finish(), { finish_event: 'CANCEL' }));
    expect(res.status).toBe(400);
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe('a number on the WhatsApp Business app (coexistence, off in October)', () => {
  test('subscribed but never registered, nothing linked, needs_operator, SHIFT told', async () => {
    meta();
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finishCoexistence()));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'needs_operator', onboarding: { last_error_ar: ERRORS_AR.coexistence } });
    expect(posts('/subscribed_apps')).toHaveLength(1);
    expect(posts('/register')).toHaveLength(0);
    expect(onboardingOf()).toMatchObject({ phone_number_id: IDS.PHONE, step: 'subscribed', needs_operator: true });
    expect(business().wa_phone_number_id).toBeNull(); // the bot does not answer the owner's app chats
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ reason: 'needs_operator' }));

    // A retry does not register it either.
    axios.post.mockClear();
    const retried = await request(app).post(`${adminBase('biz_sham')}/retry`).set(ADMIN()).send({});
    expect(retried.body.status).toBe('needs_operator');
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('a number already on another shop is refused before anything is written', () => {
  test('even when the server found the number itself', async () => {
    meta({ numbers: [fx.number({ id: IDS.PHONE_2 })] });
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finishOnlyWaba()));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'number_taken', status: 'failed', message: ERRORS_AR.number_taken });
    expect(db.store.whatsappOnboardings).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled();
    expect(business('biz_other').wa_phone_number_id).toBe(IDS.PHONE_2);
    expect(eventsOf().map((e) => e.type)).toEqual(['es_conflict']);
  });
});

describe('reconnect re-exchanges instead of keeping a dead token', () => {
  test('a done row of the same shop is reset to the new token and runs again', async () => {
    meta();
    await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finish()));
    const first = onboardingOf();

    meta({ token: TOKEN_2 });
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finish(), { code: 'fresh' }));
    expect(res.body.status).toBe('connected');
    const row = onboardingOf();
    expect(row.id).toBe(first.id);
    expect(decrypt(row.access_token_enc)).toBe(TOKEN_2);
    expect(decrypt(business().wa_access_token)).toBe(TOKEN_2);
    expect(posts('/subscribed_apps')).toHaveLength(2);
  });

  test('a row Meta removed (revoked) comes back to life with the fresh code', async () => {
    db.seed({
      whatsappOnboardings: [{
        id: 'onb_old', business_id: 'biz_sham', app_id: APP, meta_business_id: IDS.PORTFOLIO, waba_id: IDS.WABA,
        phone_number_id: IDS.PHONE, step: 'done', access_token_enc: encrypt('EAAdead'), pin_enc: encrypt('123123'),
        revoked_at: new Date('2026-10-01'), revoked_reason: 'partner_removed',
      }],
    });
    const before = await request(app).get(`${adminBase('biz_sham')}/status`).set(ADMIN());
    expect(before.body).toMatchObject({ status: 'failed', onboarding: { last_error_ar: ERRORS_AR.revoked } });

    meta({ token: TOKEN_2 });
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finish()));
    expect(res.body.status).toBe('connected');
    expect(onboardingOf()).toMatchObject({ id: 'onb_old', revoked_at: null, revoked_reason: null, step: 'done' });
    expect(decrypt(onboardingOf().access_token_enc)).toBe(TOKEN_2);
    // The PIN Meta accepted before is reused, so two-step verification is not reset under them.
    expect(posts('/register')[0][1].pin).toBe('123123');
  });
});

describe('failures read as what to do next, in Arabic', () => {
  test('an expired code: «انتهت مهلة الموافقة»', async () => {
    meta({ exchange: fx.codeExpired() });
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finish()));
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ status: 'failed', message: ERRORS_AR.code_expired, error_code: 100, onboarding: null });
    expect(res.body.detail).toContain('expired'); // SHIFT's mirror also gets Meta's words
  });

  test('a PIN mismatch asks for the shop\'s PIN, survives a reload, and the retry with it connects', async () => {
    meta({ register: fx.pinMismatch() });
    db.seed({ platformSettings: [{ key: 'es_owner_enabled', value: true }] });
    settings.clearCache();

    const res = await request(app).post(`${OWNER_BASE}/exchange`).set(OWNER()).send(bodyFrom(fx.finish()));
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({
      status: 'failed', needs_pin: true, message: ERRORS_AR.pin_mismatch,
      onboarding: { needs_pin: true, failed_step: 'register', last_error_ar: ERRORS_AR.pin_mismatch },
    });
    expect(res.body).not.toHaveProperty('detail'); // the owner never gets Meta's English
    expect(JSON.stringify(res.body)).not.toMatch(/Two step|PIN Mismatch/);

    const reloaded = await request(app).get(`${OWNER_BASE}/status`).set(OWNER());
    expect(reloaded.body).toMatchObject({ status: 'failed', onboarding: { needs_pin: true, step: 'subscribed' } });

    axios.get.mockClear();
    axios.post.mockClear();
    meta();
    const retried = await request(app).post(`${OWNER_BASE}/retry`).set(OWNER()).send({ pin: '246802' });
    expect(retried.body.status).toBe('connected');
    expect(posts('/register')[0][1].pin).toBe('246802');
    expect(gets('/oauth/access_token')).toHaveLength(0); // the stored token, no new popup
    expect(eventsOf().map((e) => e.type)).toEqual(['es_failed', 'es_connected']);
    expect(eventsOf().every((e) => e.actor_kind === 'owner')).toBe(true);
  });
});

describe('the browser\'s launch is logged', () => {
  test('LAUNCHED writes es_started on the caller\'s account', async () => {
    const res = await request(app).post(`${adminBase('biz_sham')}/events`).set(ADMIN()).send({ event: 'LAUNCHED' });
    expect(res.status).toBe(200);
    expect(eventsOf().map((e) => [e.type, e.actor_kind])).toEqual([['es_started', 'shift']]);
  });
});

describe('what the P1 review found', () => {
  const WABA_B = '104900000000077';

  test('no FINISH and two WABAs granted: a failure asking for a new popup, never «SHIFT will finish», nothing stored', async () => {
    meta({ wabas: [IDS.WABA, WABA_B] });
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send({ code: 'c', finish_event: null });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: 'waba_unresolved', status: 'failed', message: ERRORS_AR.waba_unresolved, onboarding: null, resumable: false });
    expect(res.body.message).not.toMatch(/لا داعي|سيُكمل فريق شِفت/);
    expect(db.store.whatsappOnboardings).toEqual([]);
    expect(eventsOf().map((e) => [e.type, e.data.reason])).toEqual([['es_failed', 'waba_unresolved']]);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ reason: 'connect_failed', businessId: 'biz_sham' }));
  });

  test('the same on a connected shop leaves its live row alone and does not call it needs_operator', async () => {
    meta();
    await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finish()));
    meta({ token: TOKEN_2, wabas: [IDS.WABA, WABA_B] });
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send({ code: 'again', finish_event: null });
    expect(res.status).toBe(422);
    expect(res.body.status).toBe('failed');
    expect(onboardingOf()).toMatchObject({ step: 'done', revoked_at: null });
    expect(decrypt(onboardingOf().access_token_enc)).toBe(fx.TOKEN);
  });

  test('SHIFT\'s connect_failed alert names the stage in Arabic, never the code\'s key', async () => {
    meta({ register: Object.assign(new Error('boom'), { response: { data: { error: { message: 'Internal', code: 9999 } } } }) });
    await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finish()));
    const alert = notify.mock.calls.map(([p]) => p).find((p) => p.reason === 'connect_failed');
    expect(alert.summary).toMatch(/^توقف الربط عند: /);
    expect(alert.summary).not.toMatch(/[A-Za-z]/);
  });

  test('SHIFT\'s needs_operator alert sends it to the panel that exists, «ربط بدون حساب»', async () => {
    const numbers = [fx.number(), fx.number({ id: '109900000000003', display: '+962 7 9000 0003', name: 'فرع ٢' })];
    meta({ numbers });
    await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send({ code: 'c', finish_event: 'FINISH_ONLY_WABA' });
    const alert = notify.mock.calls.map(([p]) => p).find((p) => p.reason === 'needs_operator');
    expect(alert.summary).toContain('«ربط بدون حساب»');
    expect(alert.summary).not.toContain('ربط بدون رقم');
  });

  test('a shop that was already answering customers gets no free month when SHIFT reconnects it', async () => {
    db.seed({
      conversations: [{ id: 'c_old', business_id: 'biz_sham', customer_wa_id: '962790000001' }],
      messages: [{
        business_id: 'biz_sham', conversation_id: 'c_old', direction: 'outbound', is_ai_generated: true,
        text_body: 'أهلًا', status: 'sent', created_at: new Date('2026-09-01'),
      }],
    });
    meta();
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finish()));
    expect(res.body.status).toBe('connected');
    expect(subscriptionsOf()).toEqual([]);
    expect(eventsOf().map((e) => e.type)).toEqual(expect.arrayContaining(['es_connected', 'trial_skipped']));
  });

  test('a revoked row says so (revoked: true), so the panel can show its own red state', async () => {
    db.seed({
      whatsappOnboardings: [{
        id: 'onb_rev', business_id: 'biz_sham', app_id: APP, meta_business_id: IDS.PORTFOLIO, waba_id: IDS.WABA,
        phone_number_id: IDS.PHONE, step: 'done', access_token_enc: encrypt('EAAdead'), revoked_at: new Date('2026-10-01'),
      }],
    });
    const res = await request(app).get(`${adminBase('biz_sham')}/status`).set(ADMIN());
    expect(res.body).toMatchObject({ status: 'failed', onboarding: { revoked: true, last_error_ar: ERRORS_AR.revoked } });
  });
});
