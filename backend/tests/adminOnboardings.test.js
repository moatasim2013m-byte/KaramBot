/**
 * Signups SHIFT finishes by hand: /api/admin/onboardings (docs/panels/spec.md, «ربط بدون حساب»).
 *
 * The orphans list, attaching an orphan to a shop, and «أكمل الربط» for a row Meta left without a
 * number. Only platform_admin reaches it; a number that belongs to another shop is refused here
 * as everywhere; a connected shop is never replaced by accident.
 */
require('./setup');

jest.mock('axios');
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const axios = require('axios');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('./helpers/fakeDb').getFakeDb();
const alerts = require('../src/services/alerts');
const { encrypt } = require('../src/utils/tokenCrypto');
const fx = require('./fixtures/esAssumed');
const app = require('../src/app');

const { IDS } = fx;
const BASE = '/api/admin/onboardings';
let nonce = 0;
const as = (userId) => ({ Authorization: `Bearer ${jwt.sign({ id: userId, n: (nonce += 1) }, process.env.JWT_SECRET)}` });
const ADMIN = () => as('u_admin');

const WABA_ORPHAN = '104900000000101';
const PHONE_ORPHAN = '109900000000101';
const WABA_WAIT = '104900000000102';

const row = (id) => db.store.whatsappOnboardings.find((r) => r.id === id);
const business = (id) => db.store.businesses.find((b) => b.id === id);

function metaListsNumbers(numbers) {
  axios.get.mockImplementation(async (url) => {
    if (url.endsWith('/phone_numbers')) return { data: fx.phoneNumbers(numbers) };
    throw new Error(`unexpected GET ${url}`);
  });
  axios.post.mockResolvedValue({ data: { success: true } });
}

beforeEach(() => {
  db.reset();
  axios.get.mockReset();
  axios.post.mockReset();
  global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: { message: 'offline in tests' } }) }));
  jest.spyOn(alerts, 'notifyShift').mockResolvedValue(null);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  db.seed({
    businesses: [
      { id: 'biz_new', name: 'صيدلية النور', slug: 'noor', wa_phone_number_id: null },
      { id: 'biz_wait', name: 'محل جود', slug: 'jood', wa_phone_number_id: null },
      { id: 'biz_live', name: 'صالون ريم', slug: 'reem', wa_phone_number_id: '109900000000555', wa_business_account_id: '104900000000555' },
    ],
    users: [
      { id: 'u_admin', role: 'platform_admin', business_id: null },
      { id: 'u_owner', role: 'business_owner', business_id: 'biz_new' },
    ],
    whatsappOnboardings: [
      // An old admin signup no business owns, already registered with Meta.
      {
        id: 'onb_orphan', business_id: null, app_id: '1065272896256103', meta_business_id: IDS.PORTFOLIO,
        waba_id: WABA_ORPHAN, phone_number_id: PHONE_ORPHAN, step: 'registered', access_token_enc: encrypt(fx.TOKEN),
        created_at: new Date('2026-10-05'),
      },
      // A signup whose WABA had two numbers: the token and WABA kept, the number not chosen.
      {
        id: 'onb_wait', business_id: 'biz_wait', app_id: '1065272896256103', meta_business_id: IDS.PORTFOLIO,
        waba_id: WABA_WAIT, phone_number_id: null, needs_operator: true, step: 'token_exchanged',
        access_token_enc: encrypt(fx.TOKEN), finish_event: 'FINISH_ONLY_WABA', created_at: new Date('2026-10-06'),
      },
      // An old number of a shop, detached by a number change: history, not an orphan.
      {
        id: 'onb_detached', business_id: null, app_id: '1065272896256103', meta_business_id: IDS.PORTFOLIO,
        waba_id: '104900000000103', phone_number_id: '109900000000103', step: 'done', detached_at: new Date('2026-10-02'),
      },
    ],
    accountEvents: [
      {
        id: 'ev_unmatched', business_id: null, actor_kind: 'meta', type: 'partner_added_unmatched',
        data: { event: 'PARTNER_ADDED', waba_id: '104900000000104', owner_business_id: '880000000000104' },
        created_at: new Date('2026-10-07'),
      },
      // Arrived before the exchange wrote its row: no longer an orphan.
      {
        id: 'ev_raced', business_id: null, actor_kind: 'meta', type: 'partner_added_unmatched',
        data: { event: 'PARTNER_ADDED', waba_id: WABA_WAIT }, created_at: new Date('2026-10-06'),
      },
    ],
  });
});
afterEach(() => { jest.restoreAllMocks(); delete global.fetch; });

describe('the orphans list', () => {
  test('orphans, rows waiting for a number and unmatched PARTNER_ADDED, newest first; no history, no token', async () => {
    const res = await request(app).get(`${BASE}/orphans`).set(ADMIN());
    expect(res.status).toBe(200);
    expect(res.body.orphans.map((o) => [o.id, o.kind, o.needs])).toEqual([
      ['ev_unmatched', 'partner_added', 'attach'],
      ['onb_wait', 'onboarding', 'number'],
      ['onb_orphan', 'onboarding', 'attach'],
    ]);
    for (const o of res.body.orphans) {
      for (const key of ['id', 'display_phone', 'verified_name', 'waba_id', 'created_at', 'kind']) expect(o).toHaveProperty(key);
    }
    expect(res.body.orphans[1]).toMatchObject({ business_id: 'biz_wait', business_name: 'محل جود', waba_id: WABA_WAIT });
    expect(JSON.stringify(res.body)).not.toMatch(/EAAJ|access_token/);
  });

  test('only SHIFT', async () => {
    for (const [method, url] of [['get', `${BASE}/orphans`], ['post', `${BASE}/onb_orphan/attach`], ['post', `${BASE}/onb_wait/complete`]]) {
      const res = await request(app)[method](url).set(as('u_owner')).send({ business_id: 'biz_new', phone_number_id: '1' });
      expect([url, res.status]).toEqual([url, 403]);
    }
    expect(row('onb_orphan').business_id).toBeNull();
  });
});

describe('attach', () => {
  test('a registered orphan is linked to the shop at once: number, token, trial and log', async () => {
    const res = await request(app).post(`${BASE}/onb_orphan/attach`).set(ADMIN()).send({ business_id: 'biz_new' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('connected');
    expect(row('onb_orphan')).toMatchObject({ business_id: 'biz_new', step: 'done', started_by_user_id: 'u_admin' });
    expect(business('biz_new')).toMatchObject({ wa_phone_number_id: PHONE_ORPHAN, wa_business_account_id: WABA_ORPHAN });
    expect(db.store.subscriptions.filter((s) => s.business_id === 'biz_new')).toHaveLength(1);
    expect(db.store.accountEvents.filter((e) => e.business_id === 'biz_new').map((e) => [e.type, e.actor_kind]))
      .toEqual([['es_connected', 'shift']]);
    expect(JSON.stringify(res.body)).not.toContain(PHONE_ORPHAN);
  });

  test('a shop already live is not replaced unless SHIFT says so', async () => {
    const refused = await request(app).post(`${BASE}/onb_orphan/attach`).set(ADMIN()).send({ business_id: 'biz_live' });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('business_connected');
    expect(business('biz_live').wa_phone_number_id).toBe('109900000000555');

    const replaced = await request(app).post(`${BASE}/onb_orphan/attach`).set(ADMIN()).send({ business_id: 'biz_live', replace: true });
    expect(replaced.status).toBe(200);
    expect(business('biz_live').wa_phone_number_id).toBe(PHONE_ORPHAN);
  });

  test('a number another shop already uses is refused, and nothing moves', async () => {
    db.store.businesses.find((b) => b.id === 'biz_live').wa_phone_number_id = PHONE_ORPHAN;
    const res = await request(app).post(`${BASE}/onb_orphan/attach`).set(ADMIN()).send({ business_id: 'biz_new' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('number_taken');
    expect(row('onb_orphan').business_id).toBeNull();
  });

  test('an unmatched PARTNER_ADDED is marked handled and noted on the shop', async () => {
    const res = await request(app).post(`${BASE}/ev_unmatched/attach`).set(ADMIN()).send({ business_id: 'biz_new' });
    expect(res.status).toBe(200);
    expect(db.store.accountEvents.find((e) => e.id === 'ev_unmatched').resolved_at).toBeInstanceOf(Date);
    expect(db.store.accountEvents.find((e) => e.business_id === 'biz_new')).toMatchObject({
      type: 'partner_added_matched', actor_kind: 'shift', data: { waba_id: '104900000000104' },
    });
    const list = await request(app).get(`${BASE}/orphans`).set(ADMIN());
    expect(list.body.orphans.map((o) => o.id)).not.toContain('ev_unmatched');
  });

  test('a row that already has a shop, an unknown id and a missing business_id are refused', async () => {
    expect((await request(app).post(`${BASE}/onb_wait/attach`).set(ADMIN()).send({ business_id: 'biz_new' })).status).toBe(409);
    expect((await request(app).post(`${BASE}/nope/attach`).set(ADMIN()).send({ business_id: 'biz_new' })).status).toBe(404);
    expect((await request(app).post(`${BASE}/onb_orphan/attach`).set(ADMIN()).send({})).status).toBe(400);
  });
});

describe('«أكمل الربط» (complete)', () => {
  test('the number must be on the customer\'s WABA', async () => {
    metaListsNumbers([fx.number({ id: '109900000000201' }), fx.number({ id: '109900000000202' })]);
    const res = await request(app).post(`${BASE}/onb_wait/complete`).set(ADMIN()).send({ phone_number_id: '109900000000999' });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/[؀-ۿ]/);
    expect(row('onb_wait').phone_number_id).toBeNull();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('a picked number is subscribed, registered and linked with the stored token', async () => {
    metaListsNumbers([fx.number({ id: '109900000000201', display: '+962 7 9555 0201' }), fx.number({ id: '109900000000202' })]);
    const res = await request(app).post(`${BASE}/onb_wait/complete`).set(ADMIN()).send({ phone_number_id: '109900000000201' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('connected');
    expect(axios.post.mock.calls.map(([url]) => url.split('/').pop())).toEqual(['subscribed_apps', 'register']);
    expect(business('biz_wait')).toMatchObject({ wa_phone_number_id: '109900000000201', wa_display_phone: '+962 7 9555 0201' });
    expect(row('onb_wait')).toMatchObject({ needs_operator: false, step: 'done' });
  });

  test('a coexistence row is not registered from here', async () => {
    db.store.whatsappOnboardings.find((r) => r.id === 'onb_wait').finish_event = 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';
    const res = await request(app).post(`${BASE}/onb_wait/complete`).set(ADMIN()).send({ phone_number_id: '109900000000201' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('coexistence');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('a malformed number id is refused before Meta is asked', async () => {
    const res = await request(app).post(`${BASE}/onb_wait/complete`).set(ADMIN()).send({ phone_number_id: '../me' });
    expect(res.status).toBe(400);
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe('what the P1 review found', () => {
  test('an unattached row shows its number and Meta name, read with its own stored token', async () => {
    metaListsNumbers([fx.number({ id: PHONE_ORPHAN, display: '+962 7 9555 0101', name: 'صيدلية قديمة' })]);
    const res = await request(app).get(`${BASE}/orphans`).set(ADMIN());
    const o = res.body.orphans.find((x) => x.id === 'onb_orphan');
    expect(o).toMatchObject({ display_phone: '+962 7 9555 0101', verified_name: 'صيدلية قديمة' });
    expect(JSON.stringify(res.body)).not.toMatch(/EAAJ|access_token/);
  });

  test('a number a Business row still carries needs no Meta call; a failed Meta read still lists the row', async () => {
    db.store.businesses.push({ id: 'biz_hand', name: 'محل', slug: 'hand', wa_phone_number_id: PHONE_ORPHAN, wa_display_phone: '+962 7 9555 0101', wa_verified_name: 'محل' });
    let res = await request(app).get(`${BASE}/orphans`).set(ADMIN());
    expect(res.body.orphans.find((x) => x.id === 'onb_orphan').display_phone).toBe('+962 7 9555 0101');
    expect(axios.get).not.toHaveBeenCalled();

    db.store.businesses.pop();
    axios.get.mockRejectedValue(new Error('graph down'));
    res = await request(app).get(`${BASE}/orphans`).set(ADMIN());
    expect(res.status).toBe(200);
    expect(res.body.orphans.find((x) => x.id === 'onb_orphan')).toMatchObject({ display_phone: null, phone_number_id: PHONE_ORPHAN });
  });

  test('«أكمل الربط» on a row that has a number points to a place that exists, not a «حاول مرة أخرى» button', async () => {
    db.store.whatsappOnboardings.find((r) => r.id === 'onb_wait').phone_number_id = '109900000000777';
    db.store.whatsappOnboardings.find((r) => r.id === 'onb_wait').needs_operator = false;
    const res = await request(app).post(`${BASE}/onb_wait/complete`).set(ADMIN()).send({ phone_number_id: '109900000000777' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('has_number');
    expect(res.body.message).not.toContain('حاول مرة أخرى');
    expect(res.body.message).toContain('«الحالة»');
  });
});
