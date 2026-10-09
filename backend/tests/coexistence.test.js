/**
 * Coexistence (docs/panels/spec.md P5; decisions-2026-10-08.md #10): a shop's existing WhatsApp
 * Business app number, linked to Karam Bot without leaving the owner's phone. Built and OFF.
 *
 * What these prove, through the real app and the in-memory database with Meta answering from the
 * assumed fixtures (tests/fixtures/esAssumed.js, coexAssumed.js — G1 replaces both):
 *   - off (the default): the connect is exactly as before (subscribed, never registered,
 *     needs_operator, SHIFT told), no sync is made, the config offers nothing, and the three
 *     webhook fields store nothing;
 *   - on: no /register, the number is linked, both smb_app_data syncs are made in order, a failure
 *     is retried by the sweep (not every minute), SHIFT hears once at 20 h, and the row is closed
 *     after 72 h; a removed number is not synced until Meta reconnects it;
 *   - switching it on takes the typed Arabic confirmation; switching it off does not;
 *   - echoes, history and contacts reach only the shop whose number, WABA and Meta app they
 *     arrived on (the rule of wabaIsolation.test.js), and history is imported once per wamid.
 * The bot staying quiet after the owner's own reply is coexistenceMessagePath.test.js.
 */
require('./setup');

jest.mock('axios');
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('../src/services/ownerAlertTemplate', () => ({ submitAfterConnect: jest.fn(async () => 'skipped') }));

const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('./helpers/fakeDb').getFakeDb();
const settings = require('../src/services/platformSettings');
const alerts = require('../src/services/alerts');
const coexistence = require('../src/services/coexistence');
const { encrypt } = require('../src/utils/tokenCrypto');
const { embeddedSignupAppId } = require('../src/utils/metaSecrets');
const { ERRORS_AR, completeOnboarding } = require('../src/services/embeddedSignup');
const { handleAccountUpdate } = require('../src/services/accountUpdate');
const { COEXISTENCE_CONFIRM } = require('../src/routes/adminPlatform');
const fx = require('./fixtures/esAssumed');
const cx = require('./fixtures/coexAssumed');
const app = require('../src/app');

const { IDS } = fx;
const APP = embeddedSignupAppId();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const T0 = new Date('2026-11-02T08:00:00.000Z');

let nonce = 0;
const as = (userId) => ({ Authorization: `Bearer ${jwt.sign({ id: userId, n: (nonce += 1) }, process.env.JWT_SECRET)}` });
const ADMIN = () => as('u_admin');
const adminBase = (id) => `/api/admin/accounts/${id}/embedded-signup`;

/** Meta, from the fixtures. `sync` answers each smb_app_data call in turn (an Error is thrown). */
let syncAnswers = [];
function meta({ subscribe = null } = {}) {
  axios.get.mockImplementation(async (url) => {
    if (url.endsWith('/oauth/access_token')) return { data: fx.tokenExchange() };
    if (url.endsWith('/debug_token')) return { data: fx.debugToken() };
    if (url.endsWith('/phone_numbers')) return { data: fx.phoneNumbers([fx.number()]) };
    if (url.endsWith('/me')) return { data: fx.me() };
    throw new Error(`unexpected GET ${url}`);
  });
  axios.post.mockImplementation(async (url) => {
    if (url.endsWith('/subscribed_apps') && subscribe) {
      const err = subscribe;
      subscribe = null;
      throw err;
    }
    if (url.endsWith('/smb_app_data')) {
      const next = syncAnswers.length ? syncAnswers.shift() : cx.syncAccepted();
      if (next instanceof Error) throw next;
      return { data: next };
    }
    return { data: { success: true } };
  });
}
const posts = (suffix) => axios.post.mock.calls.filter(([url]) => url.endsWith(suffix));
const syncCalls = () => posts('/smb_app_data').map(([url, body]) => ({ url, body }));

const business = (id = 'biz_sham') => db.store.businesses.find((b) => b.id === id);
const onboardingOf = (businessId = 'biz_sham') => db.store.whatsappOnboardings.find((r) => r.business_id === businessId);
const events = (type, businessId = 'biz_sham') => db.store.accountEvents.filter((e) => e.type === type && e.business_id === businessId);
const bodyFrom = (message) => ({ code: 'AQD_code_30s', finish_event: message.event, waba_id: message.data.waba_id, session_id: 'meta-session-1' });

function switchOn() {
  db.seed({ platformSettings: [{ key: 'coexistence', value: { enabled: true } }] });
  settings.clearCache();
}
// The fake clock and the sweep's `now` move together, so the log's created_at matches the sweep.
function at(ms) {
  const d = new Date(T0.getTime() + ms);
  db.clock.set(d);
  return d;
}

let notify;
beforeEach(() => {
  db.reset();
  at(0);
  settings.clearCache();
  axios.get.mockReset();
  axios.post.mockReset();
  syncAnswers = [];
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () => (url.includes('fields=account_review_status')
      ? { account_review_status: 'APPROVED', id: IDS.WABA }
      : { ...fx.number(), name_status: 'APPROVED', status: 'CONNECTED' }),
  }));
  notify = jest.spyOn(alerts, 'notifyShift').mockResolvedValue(null);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  db.seed({
    businesses: [
      { id: 'biz_sham', name: 'مطعم الشام', slug: 'sham', wa_phone_number_id: null, owner_phone: '962791234567' },
      { id: 'biz_other', name: 'صالون ريم', slug: 'reem', wa_phone_number_id: IDS.PHONE_2, wa_business_account_id: '104900000000009', wa_app_id: APP },
    ],
    users: [{ id: 'u_admin', role: 'platform_admin', business_id: null, email: 'ops@shifts-ai.com' }],
  });
});
afterEach(() => { jest.restoreAllMocks(); delete global.fetch; });

// ─── Off ─────────────────────────────────────────────────────────────────────

describe('off (the default): the old behaviour, untouched', () => {
  test('the setting is off out of the box and the connect screen is not offered the option', async () => {
    expect(await coexistence.isEnabled()).toBe(false);
    const res = await request(app).get('/api/admin/embedded-signup/config').set(ADMIN());
    expect(res.body.coexistence).toBe(false);
  });

  test('a coexistence finish is subscribed, never registered, never synced, and goes to SHIFT', async () => {
    meta();
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finishCoexistence()));
    expect(res.body).toMatchObject({ status: 'needs_operator', onboarding: { last_error_ar: ERRORS_AR.coexistence, coexistence: false } });
    expect(posts('/register')).toHaveLength(0);
    expect(posts('/smb_app_data')).toHaveLength(0);
    expect(business().wa_phone_number_id).toBeNull();
    expect(events('coex_sync_started')).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ reason: 'needs_operator' }));
  });

  test('SHIFT cannot finish such a row by hand while it is off', async () => {
    meta();
    await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finishCoexistence()));
    await expect(completeOnboarding({ onboardingId: onboardingOf().id, phoneNumberId: IDS.PHONE }))
      .rejects.toMatchObject({ code: 'coexistence', status: 409 });
  });

  test('the sweep step is one empty read', async () => {
    expect(await coexistence.sweepSyncs(at(HOUR))).toEqual({ open: 0, retried: 0, completed: 0, alerted: 0, given_up: 0 });
    expect(axios.post).not.toHaveBeenCalled();
  });
});

// ─── On: the connect and the 24-hour syncs ──────────────────────────────────

describe('on: connect without /register, then both syncs', () => {
  beforeEach(switchOn);

  test('the config offers it', async () => {
    const res = await request(app).get('/api/admin/embedded-signup/config').set(ADMIN());
    expect(res.body.coexistence).toBe(true);
  });

  test('linked without /register; contacts then history asked for at once; the obligation is closed', async () => {
    meta();
    const res = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finishCoexistence()));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'connected', onboarding: { coexistence: true, last_error_ar: null } });
    expect(posts('/register')).toHaveLength(0);
    expect(business()).toMatchObject({ wa_phone_number_id: IDS.PHONE, wa_business_account_id: IDS.WABA, wa_app_id: APP });
    expect(onboardingOf()).toMatchObject({ step: 'done', needs_operator: false, finish_event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' });

    const order = axios.post.mock.calls.map(([url]) => url.split('/').pop());
    expect(order).toEqual(['subscribed_apps', 'smb_app_data', 'smb_app_data']);
    expect(syncCalls()).toEqual([
      { url: expect.stringMatching(new RegExp(`/${IDS.PHONE}/smb_app_data$`)), body: { messaging_product: 'whatsapp', sync_type: 'smb_app_state_sync' } },
      { url: expect.stringMatching(new RegExp(`/${IDS.PHONE}/smb_app_data$`)), body: { messaging_product: 'whatsapp', sync_type: 'history' } },
    ]);
    // The business token, never the app's.
    expect(posts('/smb_app_data')[0][2].headers.Authorization).toBe(`Bearer ${fx.TOKEN}`);

    const [started] = events('coex_sync_started');
    expect(started.data).toMatchObject({ phone_number_id: IDS.PHONE, waba_id: IDS.WABA });
    // Meta's 24 hours, from the moment of the connect.
    expect(Math.abs(new Date(started.data.due_by).getTime() - (Date.now() + coexistence.SYNC_DEADLINE_MS))).toBeLessThan(MIN);
    expect(started.resolved_at).toBeInstanceOf(Date);
    expect(events('coex_sync_done').map((e) => e.data.sync_type)).toEqual(['smb_app_state_sync', 'history']);
    expect(events('es_connected')).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain(IDS.PHONE);

    // Nothing left for the sweep.
    axios.post.mockClear();
    expect((await coexistence.sweepSyncs(at(30 * MIN))).open).toBe(0);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('a failed history sync is retried by the sweep, not before ten minutes, and only the missing one', async () => {
    meta();
    syncAnswers = [cx.syncAccepted(), cx.syncRefused()];
    await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finishCoexistence()));
    expect(events('coex_sync_failed')).toEqual([expect.objectContaining({ data: expect.objectContaining({ sync_type: 'history', error_code: 131000 }) })]);
    expect(events('coex_sync_started')[0].resolved_at).toBeNull();

    axios.post.mockClear();
    let report = await coexistence.sweepSyncs(at(5 * MIN));
    expect(report).toMatchObject({ open: 1, retried: 0 });
    expect(axios.post).not.toHaveBeenCalled();

    report = await coexistence.sweepSyncs(at(11 * MIN));
    expect(report).toMatchObject({ open: 1, retried: 1, completed: 1 });
    expect(syncCalls().map((c) => c.body.sync_type)).toEqual(['history']);
    expect(events('coex_sync_started')[0].resolved_at).toBeInstanceOf(Date);
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ summary: expect.stringContaining('مزامنة') }));
  });

  test('history is never asked for before the contacts sync has gone through', async () => {
    meta();
    syncAnswers = [cx.syncRefused()];
    await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finishCoexistence()));
    expect(syncCalls().map((c) => c.body.sync_type)).toEqual(['smb_app_state_sync']);
  });

  test('still not done at 20 hours: SHIFT is told once, in Arabic; after 72 hours the sweep stops', async () => {
    meta();
    syncAnswers = Array.from({ length: 200 }, () => cx.syncRefused());
    await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finishCoexistence()));
    notify.mockClear();

    await coexistence.sweepSyncs(at(19 * HOUR));
    expect(notify).not.toHaveBeenCalled();

    const report = await coexistence.sweepSyncs(at(20 * HOUR + MIN));
    expect(report.alerted).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    const [alert] = notify.mock.calls[0];
    expect(alert).toMatchObject({ reason: 'needs_operator', businessId: 'biz_sham' });
    expect(alert.summary).toMatch(/مزامنة/);
    // Arabic, and no Meta id in it (the brand name «Meta» is how the rest of SHIFT's alerts say it).
    expect(alert.summary.replace(/Meta/g, '')).not.toMatch(/[A-Za-z0-9]{6,}/);
    expect(events('coex_sync_late')).toHaveLength(1);

    await coexistence.sweepSyncs(at(21 * HOUR));
    expect(notify).toHaveBeenCalledTimes(1);

    axios.post.mockClear();
    const last = await coexistence.sweepSyncs(at(73 * HOUR));
    expect(last.given_up).toBe(1);
    expect(axios.post).not.toHaveBeenCalled();
    expect(events('coex_sync_started')[0].resolved_at).toBeInstanceOf(Date);
    expect((await coexistence.sweepSyncs(at(74 * HOUR))).open).toBe(0);
  });

  test('a subscribe that failed at connect is resumed without /register, and the syncs start then', async () => {
    meta({ subscribe: Object.assign(new Error('boom'), { response: { data: { error: { message: 'busy', code: 2 } } } }) });
    const first = await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finishCoexistence()));
    expect(first.body.status).toBe('failed');
    expect(posts('/smb_app_data')).toHaveLength(0);

    const res = await request(app).post(`${adminBase('biz_sham')}/retry`).set(ADMIN()).send({});
    expect(res.body.status).toBe('connected');
    expect(posts('/register')).toHaveLength(0);
    expect(syncCalls().map((c) => c.body.sync_type)).toEqual(['smb_app_state_sync', 'history']);
  });

  test('a row left for SHIFT while it was off can be finished once it is on', async () => {
    db.reset();
    at(0);
    db.seed({
      businesses: [{ id: 'biz_sham', name: 'مطعم الشام', slug: 'sham', wa_phone_number_id: null }],
      whatsappOnboardings: [{
        id: 'onb_coex', business_id: 'biz_sham', app_id: APP, meta_business_id: IDS.PORTFOLIO, waba_id: IDS.WABA,
        phone_number_id: IDS.PHONE, finish_event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', needs_operator: true,
        step: 'subscribed', access_token_enc: encrypt(fx.TOKEN),
      }],
    });
    switchOn();
    meta();
    const out = await completeOnboarding({ onboardingId: 'onb_coex', phoneNumberId: IDS.PHONE });
    expect(out.status).toBe('connected');
    expect(posts('/register')).toHaveLength(0);
    expect(business().wa_phone_number_id).toBe(IDS.PHONE);
    expect(syncCalls()).toHaveLength(2);
  });

  test('ACCOUNT_OFFBOARDED (the 14-day rule, a new phone) stops the retries; ACCOUNT_RECONNECTED resumes them', async () => {
    meta();
    syncAnswers = [cx.syncRefused()];
    await request(app).post(`${adminBase('biz_sham')}/exchange`).set(ADMIN()).send(bodyFrom(fx.finishCoexistence()));

    const off = fx.accountEvent('ACCOUNT_OFFBOARDED');
    await handleAccountUpdate(off.entry[0], off.entry[0].changes[0]);
    expect(onboardingOf().revoked_at).toBeInstanceOf(Date);
    expect(events('partner_removed')).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ reason: 'partner_removed' }));

    axios.post.mockClear();
    await coexistence.sweepSyncs(at(15 * MIN));
    expect(axios.post).not.toHaveBeenCalled();

    const back = fx.accountEvent('ACCOUNT_RECONNECTED');
    await handleAccountUpdate(back.entry[0], back.entry[0].changes[0]);
    expect(onboardingOf().revoked_at).toBeNull();
    await coexistence.sweepSyncs(at(30 * MIN));
    expect(syncCalls().map((c) => c.body.sync_type)).toEqual(['smb_app_state_sync', 'history']);
  });
});

// ─── The switch ──────────────────────────────────────────────────────────────

describe('«إعدادات المنصة»: switching it on takes the typed sentence', () => {
  const patch = (body) => request(app).patch('/api/admin/platform-settings').set(ADMIN()).send(body);
  const stored = () => (db.store.platformSettings.find((r) => r.key === 'coexistence') || {}).value;

  test.each([
    ['no confirmation', undefined],
    ['the wrong sentence', 'نعم'],
  ])('%s: refused in Arabic, nothing stored', async (_, confirm) => {
    const res = await patch({ key: 'coexistence', value: { enabled: true }, confirm });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(COEXISTENCE_CONFIRM);
    expect(stored()).toBeUndefined();
    expect(await coexistence.isEnabled()).toBe(false);
  });

  test('the sentence switches it on, logged; switching it off needs nothing', async () => {
    const on = await patch({ key: 'coexistence', value: { enabled: true }, confirm: `  ${COEXISTENCE_CONFIRM} ` });
    expect(on.status).toBe(200);
    expect(stored()).toEqual({ enabled: true });
    expect(await coexistence.isEnabled()).toBe(true);
    expect(db.store.accountEvents.filter((e) => e.type === 'platform_setting_changed')).toHaveLength(1);

    const off = await patch({ key: 'coexistence', value: { enabled: false } });
    expect(off.status).toBe(200);
    expect(stored()).toEqual({ enabled: false });
  });

  test('a value that is not a yes or no is refused', async () => {
    const res = await patch({ key: 'coexistence', value: { enabled: 'yes' }, confirm: COEXISTENCE_CONFIRM });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[ء-ي]/);
  });
});

// ─── The webhook fields ─────────────────────────────────────────────────────

const SHIFT_HOOK = '/api/shift/whatsapp/webhook';
const LEGACY_HOOK = '/api/whatsapp/webhook';
function post(path, payload) {
  const raw = JSON.stringify(payload);
  const secret = path === SHIFT_HOOK ? process.env.SHIFT_ES_APP_SECRET : process.env.META_APP_SECRET;
  const sig = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  return request(app).post(path).set('Content-Type', 'application/json').set('x-hub-signature-256', sig).send(raw);
}
// history and contacts are handled beside the 200; wait for them to land.
async function settled() {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));
}
const msgsOf = (businessId) => db.store.messages.filter((m) => m.business_id === businessId);

describe('webhook fields', () => {
  beforeEach(() => {
    const shop = business();
    Object.assign(shop, { wa_phone_number_id: IDS.PHONE, wa_business_account_id: IDS.WABA, wa_app_id: APP, wa_access_token: encrypt(fx.TOKEN) });
  });

  test('off: an echo, a history chunk and the contacts store nothing', async () => {
    for (const payload of [cx.echo(), cx.history(), cx.stateSync()]) {
      expect((await post(SHIFT_HOOK, payload)).status).toBe(200);
    }
    await settled();
    expect(db.store.messages).toHaveLength(0);
    expect(db.store.conversations).toHaveLength(0);
  });

  describe('on', () => {
    beforeEach(switchOn);

    test('an echo is stored as the shop\'s message, once per wamid, through the Tech Provider endpoint', async () => {
      expect((await post(SHIFT_HOOK, cx.echo())).status).toBe(200);
      expect((await post(SHIFT_HOOK, cx.echo())).status).toBe(200); // Meta's retry
      expect(msgsOf('biz_sham')).toEqual([expect.objectContaining({
        meta_message_id: 'wamid.ECHO1', direction: 'outbound', is_ai_generated: false, text_body: 'أهلين، الطلب جاهز',
      })]);
      const conv = db.store.conversations.find((c) => c.business_id === 'biz_sham');
      expect(conv.customer_wa_id).toBe(cx.CUSTOMER);
      expect(conv.last_outbound_at).toEqual(new Date(1791460800 * 1000));
      expect(conv.unread_count).toBe(0);
    });

    test('a failed echo save answers 500 so Meta retries (a lost echo is a chat the bot talks over)', async () => {
      db.failNext('message.create', new Error('db down'));
      expect((await post(SHIFT_HOOK, cx.echo())).status).toBe(500);
      expect((await post(SHIFT_HOOK, cx.echo())).status).toBe(200);
      expect(msgsOf('biz_sham')).toHaveLength(1);
    });

    test('history is imported once per wamid, settled, without opening the 24-hour window or the waiting list', async () => {
      await post(SHIFT_HOOK, cx.history());
      await settled();
      await post(SHIFT_HOOK, cx.history()); // the same chunk again
      await settled();
      const out = await coexistence.handleHistory(cx.history().entry[0], cx.history().entry[0].changes[0]);
      expect(out).toEqual({ imported: 0, skipped: 2 });

      const rows = msgsOf('biz_sham');
      expect(rows.map((m) => [m.meta_message_id, m.direction, m.status])).toEqual([
        ['wamid.H1', 'inbound', 'delivered'],
        ['wamid.H2', 'outbound', 'delivered'],
      ]);
      expect(rows.every((m) => m.is_ai_generated === false)).toBe(true);
      expect(rows[0].created_at).toEqual(new Date(1788000000 * 1000));
      const conv = db.store.conversations.find((c) => c.business_id === 'biz_sham');
      expect(conv).toMatchObject({ unread_count: 0, last_inbound_at: null, last_outbound_at: null, needs_attention: false });
      expect(conv.last_message_at).toEqual(new Date((1788000000 + 60) * 1000));
    });

    test('history the owner declined to share is on the log, with nothing imported', async () => {
      const d = cx.historyDeclined();
      await coexistence.handleHistory(d.entry[0], d.entry[0].changes[0]);
      expect(events('coex_history_unavailable')).toEqual([expect.objectContaining({ data: { error_code: 2593109 } })]);
      expect(db.store.messages).toHaveLength(0);
    });

    test('the contacts sync is counted, nothing stored', async () => {
      const d = cx.stateSync();
      expect(await coexistence.handleStateSync(d.entry[0], d.entry[0].changes[0])).toEqual({ count: 2 });
      expect(db.store.messages).toHaveLength(0);
    });

    describe('no delivery reaches another shop (wabaIsolation.test.js\'s rule)', () => {
      test('this shop\'s number on another WABA is dropped', async () => {
        await post(SHIFT_HOOK, cx.echo({ waba: '104900000000777' }));
        await post(SHIFT_HOOK, cx.history({ waba: '104900000000777' }));
        await settled();
        expect(db.store.messages).toHaveLength(0);
      });

      test('another shop\'s number arriving on this shop\'s WABA is dropped', async () => {
        await post(SHIFT_HOOK, cx.echo({ phone: IDS.PHONE_2 }));
        await post(SHIFT_HOOK, cx.history({ phone: IDS.PHONE_2 }));
        await settled();
        expect(db.store.messages).toHaveLength(0);
        expect(db.store.conversations).toHaveLength(0);
      });

      test('the legacy endpoint cannot act on a Tech Provider number', async () => {
        expect((await post(LEGACY_HOOK, cx.echo())).status).toBe(200);
        await post(LEGACY_HOOK, cx.history());
        await settled();
        expect(db.store.messages).toHaveLength(0);
      });

      test('a number no shop holds is dropped', async () => {
        await post(SHIFT_HOOK, cx.echo({ phone: '109900000000999' }));
        expect(db.store.messages).toHaveLength(0);
      });

      test('each shop gets only its own: the other shop\'s own echo lands on it alone', async () => {
        await post(SHIFT_HOOK, cx.echo({ phone: IDS.PHONE_2, waba: '104900000000009', id: 'wamid.REEM' }));
        expect(msgsOf('biz_other')).toHaveLength(1);
        expect(msgsOf('biz_sham')).toHaveLength(0);
      });
    });
  });
});

// ─── The owner's copy ────────────────────────────────────────────────────────

describe('the 14-day rule, the owner hold and 20 mps, in the owner\'s words', () => {
  const fs = require('fs');
  const path = require('path');
  const screen = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/whatsapp/ConnectWhatsApp.jsx'), 'utf8');

  test.each(Object.entries(coexistence.NOTICE_AR))('the connect screen shows the server\'s %s sentence word for word', (_, sentence) => {
    expect(screen).toContain(sentence);
  });

  test('the hold the copy promises is the hold the bot keeps (two hours)', () => {
    expect(coexistence.NOTICE_AR.owner_hold).toContain('ساعتين');
    expect(coexistence.OWNER_HOLD_MS).toBe(2 * HOUR);
    expect(coexistence.NOTICE_AR.inactivity).toContain('14');
  });

  test('the connect screen asks Meta for the app flow only behind the server\'s switch', () => {
    const sdk = fs.readFileSync(path.join(__dirname, '../../frontend/src/utils/facebookSdk.js'), 'utf8');
    expect(sdk).toContain(`'${coexistence.FEATURE_TYPE}'`);
    expect(screen).toMatch(/mode === 'coexistence' && Boolean\(config\?\.coexistence\)/);
  });
});
