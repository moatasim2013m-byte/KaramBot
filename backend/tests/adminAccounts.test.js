/**
 * «زبون جديد» and the join link (docs/panels/spec.md P2, steps 1–4 and 11).
 *
 * SHIFT creates a shop with a name, a sector and the owner's mobile, and gets one link to send from
 * its own WhatsApp. What these defend: the shop, the owner and the link are made together or not at
 * all; no free month is taken by an unused invite; one mobile is one owner; a link is reissued or
 * cancelled only while the owner has not signed in; the owner's first open tells SHIFT once; and
 * the board puts each shop in the stage its stored data says, with the reason it is waiting.
 *
 * Real routes on the in-memory fakeDb; nothing is sent (notifyShift is spied).
 */
require('./setup');

jest.mock('axios');
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('./helpers/fakeDb').getFakeDb();
const alerts = require('../src/services/alerts');
const platformSettings = require('../src/services/platformSettings');
const app = require('../src/app');

let nonce = 0;
const as = (userId) => ({ Authorization: `Bearer ${jwt.sign({ id: userId, n: (nonce += 1) }, process.env.JWT_SECRET)}` });
const ADMIN = () => as('u_admin');
// The routes read the real clock (link expiry, time in stage), so the seeds are relative to it.
const T0 = new Date();
const HOUR = 3600 * 1000;

const form = (over = {}) => ({
  name: 'مطعم الشام', sector: 'restaurant', owner_name: 'أبو خالد الشامي', owner_phone: '0791234567', city: 'إربد', ...over,
});
const tokenOf = (joinUrl) => joinUrl.split('#')[1];
const events = (type) => db.store.accountEvents.filter((e) => e.type === type);

let notify;

beforeEach(() => {
  db.reset();
  db.clock.set(T0);
  platformSettings.clearCache();
  delete process.env.APP_ORIGIN;
  jest.restoreAllMocks();
  notify = jest.spyOn(alerts, 'notifyShift').mockResolvedValue(null);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  db.seed({
    users: [
      { id: 'u_admin', name: 'معتصم', role: 'platform_admin', business_id: null },
      { id: 'u_staff', role: 'staff', business_id: 'biz_other' },
    ],
    businesses: [{ id: 'biz_other', name: 'صيدلية النور', slug: 'noor', business_type: 'generic' }],
  });
});

describe('POST /api/admin/accounts', () => {
  test('one shop, one inactive owner, one 7-day link, the log, and no free month yet', async () => {
    const res = await request(app).post('/api/admin/accounts').set(ADMIN()).send(form({ owner_email: 'Abu@Sham.jo' }));

    expect(res.status).toBe(201);
    const biz = db.store.businesses.find((b) => b.id === res.body.account_id);
    expect(biz).toMatchObject({
      name: 'مطعم الشام', business_type: 'restaurant', sector: 'restaurant', city: 'إربد',
      owner_phone: '962791234567', source: 'invite', wa_phone_number_id: null,
    });
    // An Arabic-only name leaves nothing Latin: the slug is made up on the server.
    expect(biz.slug).toMatch(/^shop-[a-z]{6}$/);
    // The owner's mobile is where the shop's own alerts go, and the bot starts with a greeting.
    expect(biz.ai_config.alert_wa_numbers).toEqual(['962791234567']);
    expect(biz.ai_config.greeting_message).toContain('مطعم الشام');

    const owner = db.store.users.find((u) => u.business_id === biz.id);
    expect(owner).toMatchObject({
      name: 'أبو خالد الشامي', role: 'business_owner', phone: '962791234567', email: 'abu@sham.jo', active: false,
    });
    expect(owner.password).toMatch(/^\$2[aby]\$12\$/); // set, and unusable

    const [link] = db.store.userActivations.filter((a) => a.user_id === owner.id);
    expect(Math.abs(link.expires_at.getTime() - T0.getTime() - 168 * HOUR)).toBeLessThan(60 * 1000);
    expect(link.created_by).toBe('u_admin');
    expect(res.body.invite_expires_at).toBe(link.expires_at.toISOString());

    expect(db.store.subscriptions).toHaveLength(0);
    expect(events('invite_created')).toEqual([expect.objectContaining({
      business_id: biz.id, actor_kind: 'shift', actor_user_id: 'u_admin',
    })]);
    // The token is a password: never in the log.
    expect(JSON.stringify(db.store.accountEvents)).not.toContain(tokenOf(res.body.join_url));
  });

  test('the link opens /join on the app, and the WhatsApp message is the spec\'s, to the owner\'s mobile', async () => {
    const res = await request(app).post('/api/admin/accounts').set(ADMIN()).send(form());

    expect(res.body.join_url).toMatch(/^https:\/\/app\.shifts-ai\.com\/join#[\w-]{40,}$/);
    const wa = new URL(res.body.wa_share_url);
    expect(wa.origin + wa.pathname).toBe('https://wa.me/962791234567');
    const text = wa.searchParams.get('text');
    expect(text).toBe(res.body.share_text);
    expect(text).toBe(`مرحبًا أبو خالد، هذا رابط تفعيل كرم بوت لمطعم الشام: ${res.body.join_url} — صالح 7 أيام ويستغرق نحو 10 دقائق. `
      + 'جهّز: الهاتف الذي فيه شريحة رقم المحل، وحساب فيسبوك، وبطاقة دفع لرسوم واتساب لدى Meta.');
  });

  test.each([
    ['clinic', 'clinic'], ['pharmacy', 'generic'], ['salon', 'generic'], ['clothing', 'generic'], ['shop', 'generic'], ['other', 'generic'],
  ])('sector %s runs the %s workflow', async (sector, type) => {
    const res = await request(app).post('/api/admin/accounts').set(ADMIN())
      .send(form({ sector, owner_phone: `07${Math.floor(70000000 + Math.random() * 9999999)}` }));
    expect(res.status).toBe(201);
    expect(db.store.businesses.find((b) => b.id === res.body.account_id)).toMatchObject({ sector, business_type: type });
  });

  test('a Latin name keeps a readable slug', async () => {
    const res = await request(app).post('/api/admin/accounts').set(ADMIN()).send(form({ name: 'Sham Cafe' }));
    expect(db.store.businesses.find((b) => b.id === res.body.account_id).slug).toBe('sham-cafe');
  });

  test.each([
    [{ name: ' ' }, 'اكتب اسم المحل'],
    [{ sector: 'bank' }, 'اختر نوع النشاط'],
    [{ owner_name: '' }, 'اكتب اسم صاحب المحل'],
    [{ owner_phone: '065551234' }, 'موبايل صاحب المحل غير صحيح — اكتبه هكذا: 07XXXXXXXX'], // a landline cannot log in
    [{ owner_email: 'not-an-email' }, 'البريد الإلكتروني غير صحيح'],
  ])('%j is refused in Arabic and nothing is written', async (over, error) => {
    const res = await request(app).post('/api/admin/accounts').set(ADMIN()).send(form(over));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error });
    expect(db.store.businesses).toHaveLength(1);
  });

  test('a mobile that already signs in somewhere is a 409 naming that shop, and nothing is written', async () => {
    db.seed({ users: [{ id: 'u_noor', role: 'business_owner', business_id: 'biz_other', phone: '962791234567' }] });
    const res = await request(app).post('/api/admin/accounts').set(ADMIN()).send(form({ owner_phone: '+962 79 123 4567' }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('هذا الموبايل مسجّل لحساب صيدلية النور');
    expect(db.store.businesses).toHaveLength(1);
    expect(db.store.userActivations).toHaveLength(0);
  });

  test('a failure half way leaves no shop and no owner behind', async () => {
    db.failNext('accountEvent.create', new Error('db down'));
    const res = await request(app).post('/api/admin/accounts').set(ADMIN()).send(form());
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('تعذّر إنشاء الحساب، حاول مرة أخرى');
    expect(db.store.businesses).toHaveLength(1);
    expect(db.store.users.filter((u) => u.role === 'business_owner')).toHaveLength(0);
    expect(db.store.userActivations).toHaveLength(0);
  });

  test('only SHIFT creates shops', async () => {
    const res = await request(app).post('/api/admin/accounts').set(as('u_staff')).send(form());
    expect(res.status).toBe(403);
    expect(db.store.businesses).toHaveLength(1);
  });
});

describe('the owner opens the link', () => {
  async function created() {
    const res = await request(app).post('/api/admin/accounts').set(ADMIN()).send(form());
    return { id: res.body.account_id, token: tokenOf(res.body.join_url) };
  }

  test('lookup greets the shop and the owner, masks the mobile, and SHIFT hears of the first open only', async () => {
    const { id, token } = await created();

    const res = await request(app).post('/api/auth/activate/lookup').send({ token });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      shop_name: 'مطعم الشام', owner_first_name: 'أبو خالد', sector: 'restaurant', business_type: 'restaurant',
      phone_masked: '+962 7•• ••• 567', role: 'business_owner', connected: false,
    });
    expect(JSON.stringify(res.body)).not.toContain('791234567');

    await new Promise((r) => setImmediate(r));
    expect(events('join_opened')).toEqual([expect.objectContaining({ business_id: id, actor_kind: 'owner' })]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'join_opened', businessId: id, summary: 'أبو خالد فتح رابط مطعم الشام',
    }));

    // A reload says nothing new.
    await request(app).post('/api/auth/activate/lookup').send({ token });
    await new Promise((r) => setImmediate(r));
    expect(events('join_opened')).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  test('choosing a password signs the owner in with the complete user and logs password_set', async () => {
    const { id, token } = await created();
    const res = await request(app).post('/api/auth/activate').send({ token, password: 'a-long-password' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      role: 'business_owner', business_id: id, business_type: 'restaurant', business_name: 'مطعم الشام', phone: '962791234567',
    });
    expect(events('password_set')).toEqual([expect.objectContaining({ business_id: id, actor_kind: 'owner' })]);

    // And they can now sign in with their mobile.
    const login = await request(app).post('/api/auth/login').send({ login: '0791234567', password: 'a-long-password' });
    expect(login.status).toBe(200);
  });

  test('a staff invite opening /activate does not alert SHIFT', async () => {
    db.seed({ users: [{ id: 'u_new_staff', role: 'staff', business_id: 'biz_other', active: false }] });
    const { token } = await require('../src/services/activation').issue('u_new_staff', 'u_admin');
    await request(app).post('/api/auth/activate/lookup').send({ token });
    await new Promise((r) => setImmediate(r));
    expect(notify).not.toHaveBeenCalled();
    expect(events('join_opened')).toHaveLength(0);
  });
});

describe('reissue, cancel and «أرسل على واتساب»', () => {
  async function created() {
    const res = await request(app).post('/api/admin/accounts').set(ADMIN()).send(form());
    return { id: res.body.account_id, token: tokenOf(res.body.join_url) };
  }

  test('a new link kills the old one', async () => {
    const { id, token } = await created();
    const res = await request(app).post(`/api/admin/accounts/${id}/join-link`).set(ADMIN());
    expect(res.status).toBe(200);
    expect(res.body.account_id).toBe(id);
    expect(res.body.wa_share_url).toMatch(/^https:\/\/wa\.me\/962791234567\?text=/);

    expect((await request(app).post('/api/auth/activate/lookup').send({ token })).status).toBe(404);
    expect((await request(app).post('/api/auth/activate/lookup').send({ token: tokenOf(res.body.join_url) })).status).toBe(200);
    expect(events('invite_created').map((e) => e.data.reissued || false)).toEqual([false, true]);
  });

  test('once the owner signed in, neither a new link nor a cancel is possible', async () => {
    const { id, token } = await created();
    await request(app).post('/api/auth/activate').send({ token, password: 'a-long-password' });

    const reissue = await request(app).post(`/api/admin/accounts/${id}/join-link`).set(ADMIN());
    expect(reissue.status).toBe(409);
    expect(reissue.body.error).toContain('فعّل حسابه');
    const cancel = await request(app).delete(`/api/admin/accounts/${id}/invite`).set(ADMIN());
    expect(cancel.status).toBe(409);
    expect(db.store.users.find((u) => u.business_id === id).active).toBe(true);
  });

  test('«ألغِ الدعوة» kills the link, keeps the owner inactive, and is logged', async () => {
    const { id, token } = await created();
    const res = await request(app).delete(`/api/admin/accounts/${id}/invite`).set(ADMIN());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, revoked: 1 });
    expect((await request(app).post('/api/auth/activate').send({ token, password: 'a-long-password' })).status).toBe(404);
    expect(events('invite_cancelled')).toHaveLength(1);
  });

  test('invite_shared is the only event the screen may write', async () => {
    const { id } = await created();
    const ok = await request(app).post(`/api/admin/accounts/${id}/events`).set(ADMIN()).send({ type: 'invite_shared' });
    expect(ok.status).toBe(201);
    expect(events('invite_shared')).toEqual([expect.objectContaining({ business_id: id, actor_user_id: 'u_admin' })]);

    const bad = await request(app).post(`/api/admin/accounts/${id}/events`).set(ADMIN()).send({ type: 'went_live' });
    expect(bad.status).toBe(400);
    expect(events('went_live')).toHaveLength(0);
    expect((await request(app).post('/api/admin/accounts/nope/events').set(ADMIN()).send({ type: 'invite_shared' })).status).toBe(404);
  });

  test('the routes next to these on /api/admin/accounts still reach admin.js', async () => {
    const { id } = await created();
    const res = await request(app).get(`/api/admin/accounts/${id}/users`).set(ADMIN());
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
  });
});

describe('GET /api/admin/onboarding', () => {
  const DAY = 24 * HOUR;
  const ago = (ms) => new Date(T0.getTime() - ms);

  function seedBoard() {
    db.seed({
      businesses: [
        // Link created two days ago, shared, never opened: stuck.
        { id: 'b_sent', name: 'محل جود', business_type: 'generic', wa_phone_number_id: null, owner_phone: '962790000001', created_at: ago(2 * DAY) },
        // Owner signed in yesterday; closed Meta's window at the number check.
        { id: 'b_conn', name: 'صالون ريم', business_type: 'generic', wa_phone_number_id: null, created_at: ago(3 * DAY) },
        // Connected, no card.
        { id: 'b_card', name: 'مطعم الشام', business_type: 'restaurant', wa_phone_number_id: 'P_card', connected_at: ago(2 * HOUR) },
        // Connected, card claimed, nothing taught.
        { id: 'b_teach', name: 'صيدلية الحياة', business_type: 'generic', wa_phone_number_id: 'P_teach', connected_at: ago(3 * HOUR) },
        // Taught, waiting for a customer.
        { id: 'b_wait', name: 'عيادة سما', business_type: 'generic', wa_phone_number_id: 'P_wait', connected_at: ago(4 * HOUR) },
        { id: 'b_live', name: 'محل الورد', business_type: 'generic', wa_phone_number_id: 'P_live', connected_at: ago(5 * DAY), went_live_at: ago(DAY) },
        // Not customers.
        { id: 'b_shift', name: 'شِفت', business_type: 'shift', is_internal: true },
        { id: 'b_sim', name: 'sim', business_type: 'generic', is_internal: true },
      ],
      users: [
        { id: 'o_sent', name: 'سامر علي', role: 'business_owner', business_id: 'b_sent', active: false },
        { id: 'o_conn', name: 'أم ريم', role: 'business_owner', business_id: 'b_conn', active: true, last_login: ago(DAY + HOUR) },
      ],
      userActivations: [
        { user_id: 'o_sent', token_hash: 'h1', expires_at: new Date(T0.getTime() + 5 * DAY), created_by: 'u_admin' },
      ],
      whatsappOnboardings: [
        { business_id: 'b_card', app_id: 'a', meta_business_id: 'm', waba_id: 'W1', phone_number_id: 'P_card', step: 'done' },
        { business_id: 'b_teach', app_id: 'a', meta_business_id: 'm', waba_id: 'W2', phone_number_id: 'P_teach', step: 'done', payment_method_claimed_at: ago(HOUR) },
        { business_id: 'b_wait', app_id: 'a', meta_business_id: 'm', waba_id: 'W3', phone_number_id: 'P_wait', step: 'done', payment_method_ok: true },
        // An orphan and a PARTNER_ADDED nobody matched.
        { business_id: null, app_id: 'a', meta_business_id: 'm', waba_id: 'W9', phone_number_id: 'P9', step: 'registered' },
      ],
      businessKnowledge: [{ business_id: 'b_wait', kind: 'hours', content: 'كل يوم', active: true, created_at: ago(HOUR) }],
      accountEvents: [
        { business_id: 'b_sent', actor_kind: 'shift', actor_user_id: 'u_admin', type: 'invite_created', created_at: ago(2 * DAY) },
        { business_id: 'b_sent', actor_kind: 'shift', actor_user_id: 'u_admin', type: 'invite_shared', created_at: ago(2 * DAY - HOUR) },
        { business_id: 'b_conn', actor_kind: 'owner', type: 'password_set', created_at: ago(DAY + HOUR) },
        { business_id: 'b_conn', actor_kind: 'owner', type: 'es_started', data: { session_id: 'S1' }, created_at: ago(DAY) },
        {
          business_id: 'b_conn', actor_kind: 'owner', type: 'es_cancelled',
          data: { source: 'browser', current_step: 'PHONE_NUMBER_VERIFICATION', session_id: 'S1' }, created_at: ago(DAY - 60000),
        },
        { business_id: 'b_card', actor_kind: 'shift', actor_user_id: 'u_admin', type: 'es_connected', data: {}, created_at: ago(2 * HOUR) },
        { business_id: null, actor_kind: 'meta', type: 'partner_added_unmatched', data: { waba_id: 'W8' } },
      ],
    });
  }

  test('each shop is in the stage its data says, internal rows are left out, and the stuck ones say why', async () => {
    seedBoard();
    const res = await request(app).get('/api/admin/onboarding').set(ADMIN());
    expect(res.status).toBe(200);

    const where = Object.fromEntries(res.body.columns.flatMap((c) => c.cards.map((card) => [card.account_id, c.stage])));
    expect(where).toEqual({
      b_sent: 'invite_sent', b_conn: 'connecting', b_card: 'awaiting_card', b_teach: 'teaching',
      b_wait: 'awaiting_first_customer', b_live: 'live',
      // biz_other: a hand-wired shop with a number and no owner record of a card: past the invite.
      biz_other: 'awaiting_card',
    });
    expect(res.body.columns.map((c) => c.label_ar)).toEqual(['أُرسل الرابط', 'يربط واتساب', 'بانتظار البطاقة', 'يعلّم البوت', 'بانتظار أول زبون', 'يعمل']);

    const card = (id) => res.body.columns.flatMap((c) => c.cards).find((c) => c.account_id === id);
    expect(card('b_sent')).toMatchObject({ owner_first_name: 'سامر', owner_phone: '962790000001', stuck: true, reason_ar: 'لم يفتح الرابط بعد', opened: false });
    expect(card('b_conn')).toMatchObject({
      owner_first_name: 'أم ريم', stuck: true, reason_ar: 'توقف عند: التحقق من الرقم', last_es_step_ar: 'توقف عند: التحقق من الرقم',
    });
    expect(card('b_card')).toMatchObject({ stuck: false, reason_ar: 'لم يضف بطاقة الدفع لدى Meta', last_es_step_ar: null });
    expect(card('b_teach')).toMatchObject({ payment_claimed: true, reason_ar: 'لم يضف معلومات للبوت بعد' });
    expect(card('b_live')).toMatchObject({ stuck: false, reason_ar: null });
    expect(res.body.orphans_count).toBe(2);
  });

  test('the Meta attempts read in Arabic, with who started them and Meta\'s session id', async () => {
    seedBoard();
    const res = await request(app).get('/api/admin/onboarding').set(ADMIN());
    const [connected, cancelled, started] = res.body.attempts;
    expect(connected).toMatchObject({ account_id: 'b_card', name: 'مطعم الشام', started_by_ar: 'شِفت: معتصم', result: 'connected', result_ar: 'اكتمل' });
    expect(cancelled).toMatchObject({
      account_id: 'b_conn', started_by_ar: 'الزبون', result: 'cancelled', step_ar: 'التحقق من الرقم', session_id: 'S1', error_ar: null,
    });
    expect(started).toMatchObject({ result: 'started', session_id: 'S1' });
    // English constants from Meta never reach the screen.
    expect(JSON.stringify(res.body.attempts)).not.toContain('PHONE_NUMBER_VERIFICATION');
  });

  test('an expired link and a link opened but not used say so; the owner button state changes the connect reason', async () => {
    seedBoard();
    db.store.userActivations[0].expires_at = ago(HOUR);
    db.seed({ accountEvents: [{ business_id: 'b_conn', actor_kind: 'shift', type: 'es_connected', created_at: ago(HOUR) }] });
    await platformSettings.set('es_owner_enabled', true, 'u_admin');

    const res = await request(app).get('/api/admin/onboarding').set(ADMIN());
    const card = (id) => res.body.columns.flatMap((c) => c.cards).find((c) => c.account_id === id);
    expect(card('b_sent').reason_ar).toBe('انتهت صلاحية الرابط — أعد إرساله');
    // The newest attempt connected (the number was later lost): nothing «stopped».
    expect(card('b_conn').reason_ar).toBe('لم يضغط «اربط واتساب» بعد');
  });

  test('SHIFT only', async () => {
    const res = await request(app).get('/api/admin/onboarding').set(as('u_staff'));
    expect(res.status).toBe(403);
  });
});
