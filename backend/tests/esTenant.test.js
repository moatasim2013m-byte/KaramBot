/**
 * Embedded Signup tenant binding (docs/panels/spec.md, «Must be true before ES opens to customers»).
 *
 * Every customer's signup goes through the same endpoints, so which account a request may touch
 * has to come from who is asking: the owner's session, or the URL of SHIFT's admin mirror. Never
 * the body or the query. The previous routes trusted a body business_id, resumed any onboarding
 * by id, wrote browser errors onto whichever row held a phone id, and upserted onto another
 * shop's row by phone number. These tests are the proof that none of that is reachable any more,
 * run through the real app (its mounts and middleware order) on the in-memory database.
 */
require('./setup');

jest.mock('axios');
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
// After a connect the owner_alert template goes to the new WABA (ownerAlertTemplate.test.js covers
// it); stubbed here so these tests keep reading exactly the connect flow's own Graph calls and log.
jest.mock('../src/services/ownerAlertTemplate', () => ({ submitAfterConnect: jest.fn(async () => 'skipped') }));

const axios = require('axios');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('./helpers/fakeDb').getFakeDb();
const settings = require('../src/services/platformSettings');
const { encrypt, decrypt } = require('../src/utils/tokenCrypto');
const { embeddedSignupAppId } = require('../src/utils/metaSecrets');
const app = require('../src/app');

const APP = embeddedSignupAppId();
const OWNER_BASE = '/api/whatsapp/embedded-signup';
const adminBase = (id) => `/api/admin/accounts/${id}/embedded-signup`;

const PHONE_A = '100000000000001';
const WABA_A = '200000000000001';
const PHONE_A2 = '100000000000011';
const PHONE_B = '100000000000002';
const WABA_B = '200000000000002';
const PHONE_C = '100000000000003';
const WABA_C = '200000000000003';
const PHONE_ORPHAN = '100000000000009';
const PHONE_SHIFT = '100000000000099';
const WABA_ORPHAN = '200000000000009';
const PORTFOLIO = '300000000000001';

// Shaped like real Meta tokens, so a leak would also be caught by accountEvents' redaction.
const TOKEN_B = `EAAB${'b'.repeat(40)}`;
const TOKEN_C = `EAAC${'c'.repeat(40)}`;
const TOKEN_ORPHAN = `EAAO${'o'.repeat(40)}`;
const TOKEN_NEW = `EAAN${'n'.repeat(40)}`;

const CLOSED_AR = 'الربط الذاتي متوقف مؤقتًا';

let nonce = 0;
// A fresh token per request: the real app's apiLimiter counts per Authorization header, 100 a
// minute, and this suite sends more than that as one user.
const as = (userId) => ({ Authorization: `Bearer ${jwt.sign({ id: userId, n: (nonce += 1) }, process.env.JWT_SECRET)}` });

const OWNER_A = as.bind(null, 'u_owner_a');
const OWNER_B = as.bind(null, 'u_owner_b');
const ADMIN = as.bind(null, 'u_admin');

function seedWorld() {
  db.seed({
    businesses: [
      { id: 'biz_a', name: 'صيدلية النور', slug: 'a', wa_phone_number_id: null },
      {
        id: 'biz_b', name: 'صالون ريم', slug: 'b', wa_phone_number_id: PHONE_B,
        wa_business_account_id: WABA_B, wa_access_token: encrypt(TOKEN_B), wa_app_id: APP,
      },
      { id: 'biz_c', name: 'محل جود', slug: 'c', wa_phone_number_id: null },
      // SHIFT's own sales bot: a number wired by hand, with no signup row at all.
      {
        id: 'biz_shift', name: 'شِفت', slug: 'shift', business_type: 'shift', is_internal: true,
        wa_phone_number_id: PHONE_SHIFT, wa_business_account_id: '200000000000099',
      },
    ],
    users: [
      { id: 'u_owner_a', role: 'business_owner', business_id: 'biz_a' },
      { id: 'u_owner_b', role: 'business_owner', business_id: 'biz_b' },
      { id: 'u_staff_a', role: 'staff', business_id: 'biz_a' },
      { id: 'u_manager_a', role: 'manager', business_id: 'biz_a' },
      { id: 'u_admin', role: 'platform_admin', business_id: null, email: 'ops@shifts-ai.com' },
    ],
    whatsappOnboardings: [
      {
        id: 'onb_b', business_id: 'biz_b', app_id: APP, meta_business_id: '300000000000002',
        waba_id: WABA_B, phone_number_id: PHONE_B, step: 'subscribed',
        access_token_enc: encrypt(TOKEN_B), session_id: 'sess_b', last_error: 'register failed: (code 133005)',
      },
      // C's signup got as far as the token; its number is not on C's Business row yet.
      {
        id: 'onb_c', business_id: 'biz_c', app_id: APP, meta_business_id: '300000000000003',
        waba_id: WABA_C, phone_number_id: PHONE_C, step: 'token_exchanged',
        access_token_enc: encrypt(TOKEN_C), session_id: 'sess_c',
      },
      // A signup no business owns (the old admin flow allowed one): only SHIFT may attach it.
      {
        id: 'onb_orphan', business_id: null, app_id: APP, meta_business_id: '300000000000009',
        waba_id: WABA_ORPHAN, phone_number_id: PHONE_ORPHAN, step: 'registered',
        access_token_enc: encrypt(TOKEN_ORPHAN),
      },
    ],
  });
}

function openOwnerButton() {
  db.seed({ platformSettings: [{ key: 'es_owner_enabled', value: true }] });
  settings.clearCache();
}

// Meta answers every call: the code exchange, the ownership proof (debug_token, the WABA's
// numbers, /me), subscribed_apps and /register. `grant` is what the token covers.
const ALL_WABAS = [WABA_A, WABA_B, WABA_C, WABA_ORPHAN];
const ALL_PHONES = [PHONE_A, PHONE_A2, PHONE_B, PHONE_C, PHONE_ORPHAN, PHONE_SHIFT];
function metaAccepts({ token = TOKEN_NEW, wabas = ALL_WABAS, phones = ALL_PHONES } = {}) {
  axios.get.mockImplementation(async (url) => {
    if (url.endsWith('/oauth/access_token')) return { data: { access_token: token } };
    if (url.endsWith('/debug_token')) {
      return { data: { data: { is_valid: true, granular_scopes: [
        { scope: 'whatsapp_business_messaging', target_ids: wabas },
        { scope: 'whatsapp_business_management', target_ids: wabas },
      ] } } };
    }
    if (url.endsWith('/phone_numbers')) return { data: { data: phones.map((id) => ({ id })) } };
    if (url.endsWith('/me')) return { data: { client_business_id: PORTFOLIO, id: '999' } };
    throw new Error(`unexpected GET ${url}`);
  });
  axios.post.mockResolvedValue({ data: { success: true } });
}
const codeExchanges = () => axios.get.mock.calls.filter(([url]) => url.endsWith('/oauth/access_token'));

const metaCalls = () => axios.get.mock.calls.length + axios.post.mock.calls.length;
// Businesses and onboardings as stored, to prove a refused request changed nothing.
const snapshot = () => JSON.stringify({ b: db.store.businesses, o: db.store.whatsappOnboardings });
const onboarding = (id) => db.store.whatsappOnboardings.find((r) => r.id === id);
const business = (id) => db.store.businesses.find((r) => r.id === id);
const eventsOf = (businessId) => db.store.accountEvents.filter((e) => e.business_id === businessId);

const exchangeBody = (over = {}) => ({
  code: 'CODE30S', waba_id: WABA_A, phone_number_id: PHONE_A, meta_business_id: PORTFOLIO, session_id: 'sess_a', ...over,
});

beforeEach(() => {
  db.reset();
  settings.clearCache();
  axios.get.mockReset();
  axios.post.mockReset();
  // metaStatus.refresh runs after every connect and reads Meta with fetch: never the network here.
  global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: { message: 'offline in tests' } }) }));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  seedWorld();
});
afterEach(() => { jest.restoreAllMocks(); delete global.fetch; });

const OWNER_ROUTES = [
  ['get', '/config'],
  ['get', '/status'],
  ['post', '/exchange'],
  ['post', '/retry'],
  ['post', '/events'],
];

describe('the owner router stays closed until G1 (es_owner_enabled)', () => {
  test('every owner route answers 503 while the switch is off, and nothing reaches Meta', async () => {
    metaAccepts();
    const before = snapshot();
    for (const [method, path] of OWNER_ROUTES) {
      const res = await request(app)[method](`${OWNER_BASE}${path}`).set(OWNER_A()).send(exchangeBody());
      expect([path, res.status, res.body.error]).toEqual([path, 503, CLOSED_AR]);
    }
    expect(metaCalls()).toBe(0);
    expect(snapshot()).toBe(before);
    expect(db.store.accountEvents).toEqual([]);
  });

  test('once open, /config carries the Arabic locale and no secret', async () => {
    openOwnerButton();
    const res = await request(app).get(`${OWNER_BASE}/config`).set(OWNER_A());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      app_id: APP, config_id: expect.any(String), graph_version: expect.any(String), locale: 'ar_AR',
      // P5: the «رقم المحل الحالي» option is offered only once SHIFT switches coexistence on.
      coexistence: false,
    });
    expect(JSON.stringify(res.body)).not.toContain(process.env.SHIFT_ES_APP_SECRET);
  });
});

describe('only the shop owner', () => {
  test.each([
    ['staff', 'u_staff_a'],
    ['manager', 'u_manager_a'],
    // SHIFT connects through the admin mirror, where the account is in the URL.
    ['platform_admin', 'u_admin'],
  ])('%s gets 403 on every owner route, and nothing is written', async (role, userId) => {
    openOwnerButton();
    metaAccepts();
    const before = snapshot();
    for (const [method, path] of OWNER_ROUTES) {
      const res = await request(app)[method](`${OWNER_BASE}${path}`).set(as(userId)).send(exchangeBody());
      expect([path, res.status]).toEqual([path, 403]);
    }
    expect(metaCalls()).toBe(0);
    expect(snapshot()).toBe(before);
    expect(db.store.accountEvents).toEqual([]);
  });

  test('no session, no access', async () => {
    openOwnerButton();
    const res = await request(app).get(`${OWNER_BASE}/status`);
    expect(res.status).toBe(401);
  });
});

describe('the business comes from the session, never the request', () => {
  beforeEach(openOwnerButton);

  test('a business_id in the body or the query is refused with 400, even the caller\'s own', async () => {
    metaAccepts();
    const before = snapshot();
    const attempts = [
      request(app).post(`${OWNER_BASE}/exchange`).set(OWNER_A()).send(exchangeBody({ business_id: 'biz_a' })),
      request(app).post(`${OWNER_BASE}/exchange`).set(OWNER_A()).send(exchangeBody({ business_id: 'biz_b' })),
      request(app).post(`${OWNER_BASE}/exchange`).set(OWNER_A()).send(exchangeBody({ businessId: 'biz_b' })),
      request(app).post(`${OWNER_BASE}/retry`).set(OWNER_A()).send({ business_id: 'biz_b' }),
      request(app).post(`${OWNER_BASE}/events`).set(OWNER_A()).send({ event: 'CANCEL', business_id: 'biz_b' }),
      request(app).get(`${OWNER_BASE}/status?business_id=biz_b`).set(OWNER_A()),
      request(app).get(`${OWNER_BASE}/status?businessId=biz_b`).set(OWNER_A()),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('business_id_not_allowed');
      expect(res.body.message).toMatch(/[؀-ۿ]/);
    }
    expect(metaCalls()).toBe(0);
    expect(snapshot()).toBe(before);
    expect(db.store.accountEvents).toEqual([]);
  });

  test('owner A cannot read B\'s onboarding, whatever it names', async () => {
    for (const url of [`${OWNER_BASE}/status`, `${OWNER_BASE}/status?phone_number_id=${PHONE_B}`]) {
      const res = await request(app).get(url).set(OWNER_A());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'not_started', onboarding: null }); // B's row is not A's answer
    }
  });

  test('owner A cannot retry B\'s onboarding', async () => {
    metaAccepts();
    const before = snapshot();

    const own = await request(app).post(`${OWNER_BASE}/retry`).set(OWNER_A()).send({ id: 'onb_b' });
    expect(own.status).toBe(404); // the row retried is A's own, and A has none
    expect(own.body.error).toBe('no_onboarding');

    // The old route took the onboarding id from the URL. It no longer exists.
    const byId = await request(app).post(`${OWNER_BASE}/onb_b/retry`).set(OWNER_A()).send({});
    expect(byId.status).toBe(404);

    expect(metaCalls()).toBe(0);
    expect(snapshot()).toBe(before);
  });

  test('owner B reads and resumes only its own, and sees no ids, token or PIN', async () => {
    const status = await request(app).get(`${OWNER_BASE}/status`).set(OWNER_B());
    expect(status.status).toBe(200);
    expect(status.body.onboarding).toMatchObject({ step: 'subscribed', connected: false, failed: true });

    metaAccepts();
    const retried = await request(app).post(`${OWNER_BASE}/retry`).set(OWNER_B()).send({ pin: '123456' });
    expect(retried.status).toBe(200);
    expect(retried.body.status).toBe('connected');

    // Only /register was left, on B's own number, with the PIN B supplied.
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toMatch(new RegExp(`/${PHONE_B}/register$`));
    expect(body.pin).toBe('123456');
    expect(onboarding('onb_b').step).toBe('done');
    expect(decrypt(onboarding('onb_b').pin_enc)).toBe('123456');

    for (const res of [status, retried]) {
      const json = JSON.stringify(res.body);
      for (const hidden of [PHONE_B, WABA_B, 'onb_b', 'biz_b', TOKEN_B, 'access_token', '"pin', '123456', '133005']) {
        expect(json).not.toContain(hidden);
      }
    }
    expect(eventsOf('biz_b').map((e) => [e.type, e.actor_kind, e.actor_user_id]))
      .toEqual([['es_connected', 'owner', 'u_owner_b']]);
  });

  test('a PIN that is not 6 digits is refused before Meta is called', async () => {
    const res = await request(app).post(`${OWNER_BASE}/retry`).set(OWNER_B()).send({ pin: '12ab' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_pin');
    expect(metaCalls()).toBe(0);
  });
});

describe('browser events are written to the caller\'s own account', () => {
  beforeEach(openOwnerButton);

  test('an error naming another shop\'s number is logged on A and never touches B\'s row', async () => {
    const before = snapshot();
    const res = await request(app).post(`${OWNER_BASE}/events`).set(OWNER_A()).send({
      event: 'CANCEL', current_step: 'PHONE_NUMBER_VERIFICATION', error_message: 'رقم غير صالح',
      error_code: '524126', session_id: 'sess_meta_1', phone_number_id: PHONE_B,
    });
    expect(res.status).toBe(200);
    expect(snapshot()).toBe(before); // B's last_error and session are as they were

    expect(eventsOf('biz_b')).toEqual([]);
    const [event] = eventsOf('biz_a');
    expect(event).toMatchObject({
      type: 'es_failed', actor_kind: 'owner', actor_user_id: 'u_owner_a',
      data: {
        source: 'browser', event: 'CANCEL', current_step: 'PHONE_NUMBER_VERIFICATION',
        error_message: 'رقم غير صالح', error_code: '524126', session_id: 'sess_meta_1',
      },
    });
    expect(JSON.stringify(event.data)).not.toContain(PHONE_B);
  });

  test('a plain CANCEL is es_cancelled, an ERROR is es_failed, anything else is refused', async () => {
    await request(app).post(`${OWNER_BASE}/events`).set(OWNER_A()).send({ event: 'CANCEL', current_step: 'WABA_SELECTION' });
    await request(app).post(`${OWNER_BASE}/events`).set(OWNER_A()).send({ event: 'ERROR' });
    const bad = await request(app).post(`${OWNER_BASE}/events`).set(OWNER_A()).send({ event: 'FINISH' });

    expect(bad.status).toBe(400);
    expect(eventsOf('biz_a').map((e) => e.type)).toEqual(['es_cancelled', 'es_failed']);
  });
});

describe('a number that belongs to another shop is refused before anything is written', () => {
  beforeEach(openOwnerButton);

  test.each([
    ['linked to another Business', PHONE_B, 'business'],
    ['wired by hand to another Business (SHIFT\'s live bot), with no signup row', PHONE_SHIFT, 'business'],
    ['held by another business\'s signup', PHONE_C, 'onboarding'],
    ['held by a signup no business owns', PHONE_ORPHAN, 'unattached_onboarding'],
  ])('a number %s: 409, Meta never called, nothing written, es_conflict on the caller', async (label, phone, heldBy) => {
    metaAccepts();
    const before = snapshot();

    const res = await request(app).post(`${OWNER_BASE}/exchange`).set(OWNER_A())
      .send(exchangeBody({ phone_number_id: phone }));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'number_taken', status: 'failed', message: expect.stringMatching(/[؀-ۿ]/) });
    expect(metaCalls()).toBe(0); // not even the code exchange: subscribed_apps and /register never ran
    expect(snapshot()).toBe(before);

    const events = db.store.accountEvents;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      business_id: 'biz_a', type: 'es_conflict', actor_kind: 'owner', actor_user_id: 'u_owner_a',
      data: { phone_number_id: phone, waba_id: WABA_A, held_by: heldBy },
    });
    // Neither the response nor A's log names the shop that holds the number.
    for (const other of ['biz_b', 'biz_c', 'biz_shift', 'onb_b', 'onb_c', 'onb_orphan']) {
      expect(JSON.stringify(res.body)).not.toContain(other);
      expect(JSON.stringify(events[0])).not.toContain(other);
    }
  });

  test('the other shop\'s stored token is never reused for the caller', async () => {
    // The takeover the phone-keyed upsert allowed: name a row past token_exchanged and the resume
    // skips the code and runs on the stored token. Refused before it gets there.
    metaAccepts();
    await request(app).post(`${OWNER_BASE}/exchange`).set(OWNER_A()).send(exchangeBody({ phone_number_id: PHONE_C }));
    expect(onboarding('onb_c')).toMatchObject({ business_id: 'biz_c', step: 'token_exchanged', session_id: 'sess_c' });
    expect(decrypt(onboarding('onb_c').access_token_enc)).toBe(TOKEN_C);
    expect(business('biz_a').wa_phone_number_id).toBeNull();
  });
});

describe('a clean connect binds to the caller\'s business', () => {
  beforeEach(openOwnerButton);

  test('the owner\'s signup creates the owner\'s row and links the owner\'s Business only', async () => {
    metaAccepts();
    const res = await request(app).post(`${OWNER_BASE}/exchange`).set(OWNER_A()).send(exchangeBody());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('connected');
    expect(res.body.onboarding).toMatchObject({ step: 'done', connected: true, payment: { state: 'missing' } });
    for (const hidden of [PHONE_A, WABA_A, 'biz_a', TOKEN_NEW, 'access_token']) {
      expect(JSON.stringify(res.body)).not.toContain(hidden);
    }

    const rows = db.store.whatsappOnboardings.filter((r) => r.business_id === 'biz_a');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      phone_number_id: PHONE_A, waba_id: WABA_A, meta_business_id: PORTFOLIO, step: 'done',
      started_by_user_id: 'u_owner_a', session_id: 'sess_a',
    });
    expect(business('biz_a')).toMatchObject({ wa_phone_number_id: PHONE_A, wa_business_account_id: WABA_A, wa_app_id: APP });
    expect(decrypt(business('biz_a').wa_access_token)).toBe(TOKEN_NEW);
    // B, C and the orphan are exactly as seeded.
    expect(business('biz_b').wa_phone_number_id).toBe(PHONE_B);
    expect(onboarding('onb_b').step).toBe('subscribed');
    expect(onboarding('onb_orphan').business_id).toBeNull();

    expect(eventsOf('biz_a').map((e) => [e.type, e.actor_kind, e.actor_user_id]))
      .toEqual([['es_connected', 'owner', 'u_owner_a']]);
  });

  test('a signup on a new number re-points the shop\'s own row and starts it over', async () => {
    metaAccepts();
    await request(app).post(`${OWNER_BASE}/exchange`).set(OWNER_A()).send(exchangeBody());
    const first = db.store.whatsappOnboardings.find((r) => r.business_id === 'biz_a');

    metaAccepts({ token: `EAAS${'s'.repeat(40)}` });
    const res = await request(app).post(`${OWNER_BASE}/exchange`).set(OWNER_A())
      .send(exchangeBody({ phone_number_id: PHONE_A2, code: 'SECOND' }));

    expect(res.status).toBe(200);
    const rows = db.store.whatsappOnboardings.filter((r) => r.business_id === 'biz_a');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0]).toMatchObject({ phone_number_id: PHONE_A2, step: 'done' });
    // The new number got a fresh exchange, not the old number's token.
    expect(codeExchanges().at(-1)[1].params.code).toBe('SECOND');
    expect(decrypt(rows[0].access_token_enc)).toBe(`EAAS${'s'.repeat(40)}`);
    expect(business('biz_a').wa_phone_number_id).toBe(PHONE_A2);
  });

  test('a failed exchange writes no row, answers in Arabic, and logs es_failed', async () => {
    axios.get.mockRejectedValue({ response: { status: 400, data: { error: { message: 'Invalid verification code format.', code: 100 } } } });

    const res = await request(app).post(`${OWNER_BASE}/exchange`).set(OWNER_A()).send(exchangeBody());

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: 'onboarding_failed', error_code: 100, resumable: false, onboarding: null });
    // Nothing the browser named was written before Meta proved it (review 2026-10-08).
    expect(db.store.whatsappOnboardings.filter((r) => r.business_id === 'biz_a')).toEqual([]);
    expect(res.body.message).toMatch(/[؀-ۿ]/); // the owner gets words, not the Graph message
    expect(JSON.stringify(res.body)).not.toMatch(/Invalid verification|biz_|onb_/);
    expect(axios.post).not.toHaveBeenCalled();

    const [event] = eventsOf('biz_a');
    expect(event).toMatchObject({
      type: 'es_failed', actor_kind: 'owner',
      data: { stage: 'exchange', step: null, error_code: 100, phone_number_id: PHONE_A },
    });
  });

  test('missing or malformed ids are refused before the code is spent', async () => {
    metaAccepts();
    for (const body of [
      exchangeBody({ code: '' }),
      exchangeBody({ waba_id: 'abc' }),
      exchangeBody({ finish_event: 'CANCEL' }),
      exchangeBody({ phone_number_id: '../../me' }),
      exchangeBody({ meta_business_id: 'not-a-portfolio' }),
    ]) {
      const res = await request(app).post(`${OWNER_BASE}/exchange`).set(OWNER_A()).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('missing_fields');
    }
    expect(metaCalls()).toBe(0);
    expect(db.store.whatsappOnboardings.filter((r) => r.business_id === 'biz_a')).toEqual([]);
  });
});

describe('the admin mirror binds to the account in the URL', () => {
  test('SHIFT connects a shop while the owner button is closed, and is recorded as the actor', async () => {
    metaAccepts();
    const res = await request(app).post(`${adminBase('biz_a')}/exchange`).set(ADMIN()).send(exchangeBody());

    expect(res.status).toBe(200);
    // Staff see the step, never the token, and no Meta id (the contract: display_phone only).
    expect(res.body).toMatchObject({ status: 'connected', onboarding: { step: 'done' } });
    for (const hidden of [TOKEN_NEW, PHONE_A, WABA_A]) expect(JSON.stringify(res.body)).not.toContain(hidden);

    const row = db.store.whatsappOnboardings.find((r) => r.business_id === 'biz_a');
    expect(row).toMatchObject({ phone_number_id: PHONE_A, started_by_user_id: 'u_admin' });
    expect(business('biz_a').wa_phone_number_id).toBe(PHONE_A);
    expect(eventsOf('biz_a').map((e) => [e.type, e.actor_kind, e.actor_user_id]))
      .toEqual([['es_connected', 'shift', 'u_admin']]);
  });

  test('config answers on its own admin path, with the Arabic locale', async () => {
    const res = await request(app).get('/api/admin/embedded-signup/config').set(ADMIN());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ app_id: APP, locale: 'ar_AR' });
  });

  test('retry and status act on the URL\'s account', async () => {
    metaAccepts();
    const retried = await request(app).post(`${adminBase('biz_b')}/retry`).set(ADMIN()).send({ pin: '654321' });
    expect(retried.status).toBe(200);
    expect(axios.post.mock.calls[0][0]).toMatch(new RegExp(`/${PHONE_B}/register$`));
    expect(onboarding('onb_b').step).toBe('done');
    expect(eventsOf('biz_b').map((e) => [e.type, e.actor_kind, e.actor_user_id]))
      .toEqual([['es_connected', 'shift', 'u_admin']]);

    const status = await request(app).get(`${adminBase('biz_c')}/status`).set(ADMIN());
    expect(status.body).toMatchObject({ status: 'in_progress', onboarding: { step: 'token_exchanged' } });
    for (const hidden of [TOKEN_C, PHONE_C, WABA_C]) expect(JSON.stringify(status.body)).not.toContain(hidden);
  });

  test('a number on another shop is refused here too, with SHIFT as the actor', async () => {
    metaAccepts();
    const before = snapshot();
    const res = await request(app).post(`${adminBase('biz_a')}/exchange`).set(ADMIN())
      .send(exchangeBody({ phone_number_id: PHONE_B }));
    expect(res.status).toBe(409);
    expect(metaCalls()).toBe(0);
    expect(snapshot()).toBe(before);
    expect(eventsOf('biz_a')[0]).toMatchObject({ type: 'es_conflict', actor_kind: 'shift', actor_user_id: 'u_admin' });
  });

  test('events land on the URL\'s account with SHIFT as the actor', async () => {
    const res = await request(app).post(`${adminBase('biz_c')}/events`).set(ADMIN()).send({ event: 'CANCEL', current_step: 'WABA_SELECTION' });
    expect(res.status).toBe(200);
    expect(eventsOf('biz_c')).toEqual([
      expect.objectContaining({ type: 'es_cancelled', actor_kind: 'shift', actor_user_id: 'u_admin' }),
    ]);
  });

  test('a business_id in the body is refused here too', async () => {
    metaAccepts();
    const res = await request(app).post(`${adminBase('biz_a')}/exchange`).set(ADMIN())
      .send(exchangeBody({ business_id: 'biz_b' }));
    expect(res.status).toBe(400);
    expect(metaCalls()).toBe(0);
  });

  test('an account that does not exist is a 404 on every route, and nothing is written', async () => {
    metaAccepts();
    const before = snapshot();
    for (const [method, path] of OWNER_ROUTES.filter(([, p]) => p !== '/config')) {
      const res = await request(app)[method](`${adminBase('biz_nope')}${path}`).set(ADMIN()).send(exchangeBody());
      expect([path, res.status]).toEqual([path, 404]);
    }
    expect(metaCalls()).toBe(0);
    expect(snapshot()).toBe(before);
    expect(db.store.accountEvents).toEqual([]);
  });

  test.each([
    ['business_owner', 'u_owner_a'],
    ['staff', 'u_staff_a'],
  ])('a %s cannot use the mirror, not even for their own account', async (role, userId) => {
    for (const url of ['/api/admin/embedded-signup/config', `${adminBase('biz_a')}/status`]) {
      const res = await request(app).get(url).set(as(userId));
      expect([url, res.status]).toEqual([url, 403]);
    }
  });
});

describe('the rest of the app is where it was', () => {
  test('admin.js still answers under /api/admin/accounts/:id, and still refuses shop users', async () => {
    // admin.js's own 404 wording: the request went past the mirror's mounts into admin.js.
    const missing = await request(app).get('/api/admin/accounts/biz_nope').set(ADMIN());
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'لا يوجد حساب بهذا المعرّف' });

    const owner = await request(app).get('/api/admin/accounts/biz_a').set(OWNER_A());
    expect(owner.status).toBe(403);
  });

  test('the webhook verification next to the owner router is untouched', async () => {
    const res = await request(app).get('/api/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN, 'hub.challenge': '42' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('42');
  });
});

describe('the browser\'s ids are proven by Meta before anything is written (review 2026-10-08)', () => {
  beforeEach(openOwnerButton);

  test('a bad code naming another shop\'s fresh number leaves no row holding it, and B can still connect it', async () => {
    axios.get.mockRejectedValue({ response: { status: 400, data: { error: { message: 'Invalid code', code: 100 } } } });
    const res = await request(app).post(`${OWNER_BASE}/exchange`).set(OWNER_A())
      .send(exchangeBody({ code: 'x', waba_id: WABA_A, phone_number_id: PHONE_A2 }));
    expect(res.status).toBe(502);
    expect(db.store.whatsappOnboardings.some((r) => r.phone_number_id === PHONE_A2)).toBe(false);

    // The real owner of the number (SHIFT connecting C through the mirror here) is not blocked.
    metaAccepts();
    const ok = await request(app).post(`${adminBase('biz_c')}/exchange`).set(ADMIN())
      .send(exchangeBody({ waba_id: WABA_C, phone_number_id: PHONE_A2 }));
    expect(ok.status).toBe(200);
    expect(business('biz_c').wa_phone_number_id).toBe(PHONE_A2);
    expect(eventsOf('biz_c').map((e) => e.type)).not.toContain('es_conflict');
  });

  test.each([
    ['a WABA the token was not granted', { wabas: [WABA_C] }, 'waba_not_granted'],
    ['a number that is not on the granted WABA', { phones: [PHONE_C] }, 'number_not_on_waba'],
  ])('%s: 403, nothing written, no subscribe or register, es_ownership_mismatch on the caller', async (label, grant, detail) => {
    metaAccepts(grant);
    const before = snapshot();

    const res = await request(app).post(`${OWNER_BASE}/exchange`).set(OWNER_A()).send(exchangeBody());

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'es_ownership_mismatch', status: 'failed', message: expect.stringMatching(/[؀-ۿ]/) });
    expect(snapshot()).toBe(before);
    expect(axios.post).not.toHaveBeenCalled();
    expect(eventsOf('biz_a')).toEqual([expect.objectContaining({
      type: 'es_ownership_mismatch', actor_kind: 'owner',
      data: expect.objectContaining({ waba_id: WABA_A, phone_number_id: PHONE_A, detail }),
    })]);
  });

  test('the portfolio id stored is Meta\'s /me answer, not the browser\'s', async () => {
    metaAccepts();
    const res = await request(app).post(`${OWNER_BASE}/exchange`).set(OWNER_A())
      .send(exchangeBody({ meta_business_id: '300000000000777' }));
    expect(res.status).toBe(200);
    expect(db.store.whatsappOnboardings.find((r) => r.business_id === 'biz_a').meta_business_id).toBe(PORTFOLIO);
  });
});
