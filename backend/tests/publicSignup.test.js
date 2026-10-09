/**
 * «جرّب مجانًا» — public self-signup (docs/panels/spec.md P5; docs/panels/self-signup.md).
 *
 * The one route that makes a shop without SHIFT. What these defend: it is inert until the owner
 * opens it, and opening it needs a typed confirmation (and owner self-connect open); once open, a
 * bot's honeypot, the day's cap and one IP's burst are each refused in Arabic with nothing written;
 * a real signup is a shop (source self_signup, no number, no free month yet) with a signed-in
 * owner, on the board at «يربط واتساب», and SHIFT hears of it. The typed mobile is held nowhere
 * (no login, no owner number, no alert number) and the answer is the same for any mobile, until
 * a message carrying the code arrives on SHIFT's number from that very mobile (P5 review).
 *
 * Real routes on the in-memory fakeDb; nothing is sent (notifyShift is spied). Each test posts
 * from its own IP (X-Forwarded-For; app.js trusts one proxy hop), so the per-IP limiter is tested
 * on purpose in one place and does not leak between tests.
 */
require('./setup');

jest.mock('axios');
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const db = require('./helpers/fakeDb').getFakeDb();
const alerts = require('../src/services/alerts');
const platformSettings = require('../src/services/platformSettings');
const app = require('../src/app');

// bcrypt at cost 12 per signup: a few of them pass 5 s when the whole suite shares a slow machine.
jest.setTimeout(20000);

const T0 = new Date();
const DAY = 24 * 3600 * 1000;
let ipSeq = 0;
const nextIp = () => `203.0.113.${(ipSeq += 1) % 250}`;

let nonce = 0;
const ADMIN = () => ({ Authorization: `Bearer ${jwt.sign({ id: 'u_admin', n: (nonce += 1) }, process.env.JWT_SECRET)}` });

const form = (over = {}) => ({
  shop_name: 'صالون ريم', sector: 'salon', owner_name: 'ريم الخطيب', owner_phone: '0781234567',
  password: 'kalimat-sir-1', website: '', ...over,
});
const signup = (body, ip = nextIp()) => request(app).post('/api/public/signup').set('X-Forwarded-For', ip).send(body);
const openSignup = (cap = 5) => db.seed({ platformSettings: [{ key: 'self_signup', value: { enabled: true, daily_cap: cap } }] });
const created = () => db.store.accountEvents.filter((e) => e.type === 'business_created');

let notify;

beforeEach(() => {
  db.reset();
  db.clock.set(T0);
  platformSettings.clearCache();
  jest.restoreAllMocks();
  notify = jest.spyOn(alerts, 'notifyShift').mockResolvedValue(null);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  db.seed({
    users: [{ id: 'u_admin', name: 'معتصم', role: 'platform_admin', business_id: null }],
    businesses: [{ id: 'biz_other', name: 'صيدلية النور', slug: 'noor', business_type: 'generic', owner_phone: '962791111111' }],
  });
});

describe('off by default', () => {
  test('a POST is a 503 in Arabic and writes nothing; /config says closed', async () => {
    const res = await signup(form());
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('التسجيل عبر دعوة من شِفت فقط حاليًا.');
    expect(db.store.businesses).toHaveLength(1);
    expect(db.store.users).toHaveLength(1);
    expect(created()).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();

    const cfg = await request(app).get('/api/public/signup/config');
    expect(cfg.status).toBe(200);
    expect(cfg.body).toEqual({ enabled: false });
  });

  test('a stored row with only a daily cap is still closed', async () => {
    db.seed({ platformSettings: [{ key: 'self_signup', value: { daily_cap: 9 } }] });
    expect((await signup(form())).status).toBe(503);
  });
});

describe('open', () => {
  beforeEach(() => openSignup());

  test('a shop with no number and no free month, a signed-in owner, the log, and SHIFT told', async () => {
    const cfg = await request(app).get('/api/public/signup/config');
    expect(cfg.body).toEqual({ enabled: true });

    const res = await signup(form());
    expect(res.status).toBe(201);

    const biz = db.store.businesses.find((b) => b.id === res.body.user.business_id);
    expect(biz).toMatchObject({
      name: 'صالون ريم', sector: 'salon', business_type: 'generic', source: 'self_signup',
      owner_phone: null, wa_phone_number_id: null,
    });
    // Not proven yet: the typed mobile receives nothing.
    expect(biz.ai_config.alert_wa_numbers).toEqual([]);
    expect(res.body.verify.code).toMatch(/^\d{6}$/);
    expect(res.body.verify.text).toContain(res.body.verify.code);
    expect(biz.ai_config.greeting_message).toContain('صالون ريم');
    // The free month is made at connect, never at signup.
    expect(db.store.subscriptions).toHaveLength(0);

    const owner = db.store.users.find((u) => u.business_id === biz.id);
    expect(owner).toMatchObject({ name: 'ريم الخطيب', phone: null, role: 'business_owner', active: true });
    expect(await bcrypt.compare('kalimat-sir-1', owner.password)).toBe(true);

    // A session like /activate's, which the panel accepts.
    expect(res.body.user).toMatchObject({
      id: owner.id, role: 'business_owner', business_id: biz.id, business_type: 'generic', business_name: 'صالون ريم', phone: null,
    });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);

    expect(created()).toEqual([expect.objectContaining({
      business_id: biz.id, actor_user_id: owner.id, actor_kind: 'owner',
      data: expect.objectContaining({ source: 'self_signup', sector: 'salon' }),
    })]);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ reason: 'self_signup', businessId: biz.id, shopName: 'صالون ريم' }));
    expect(notify.mock.calls[0][0].summary).toMatch(/[ء-ي]/);
    expect(JSON.stringify(db.store.accountEvents)).not.toContain('kalimat-sir-1');
    // Only a hash of the code is kept, and SHIFT is not handed a mobile nobody proved.
    expect(JSON.stringify(db.store.accountEvents)).not.toContain(`"${res.body.verify.code}"`);
    expect(notify.mock.calls[0][0].phone).toBeUndefined();
  });

  test('the shop is on SHIFT\'s board, past the invite, at «يربط واتساب»', async () => {
    const res = await signup(form());
    const board = await request(app).get('/api/admin/onboarding').set(ADMIN());
    expect(board.status).toBe(200);
    const col = board.body.columns.find((c) => c.cards.some((card) => card.account_id === res.body.user.business_id));
    expect(col.stage).toBe('connecting');
    const card = col.cards.find((c) => c.account_id === res.body.user.business_id);
    expect(card).toMatchObject({ name: 'صالون ريم', source: 'self_signup' });
  });

  test('a filled honeypot is refused and nothing is written', async () => {
    const res = await signup(form({ website: 'http://spam.example' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[ء-ي]/);
    expect(db.store.businesses).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
  });

  test.each([
    [{ shop_name: '  ' }, 'اسم المحل'],
    [{ sector: 'casino' }, 'نوع النشاط'],
    [{ owner_name: '' }, 'اكتب اسمك'],
    [{ owner_phone: '065551234' }, 'رقم الموبايل'],
    [{ password: 'short' }, '10 أحرف'],
  ])('%j is refused in Arabic', async (over, words) => {
    const res = await signup(form(over));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(words);
    expect(db.store.businesses).toHaveLength(1);
  });

  test('a mobile already on Karam Bot answers exactly like a free one: the signup tells nobody who is a customer', async () => {
    const free = await signup(form({ owner_phone: '0781999999' }));
    // An invite shop's owner mobile, and a mobile that already signs in.
    db.seed({ users: [{ id: 'u_rana', name: 'رنا', role: 'business_owner', business_id: 'biz_other', phone: '962792222222' }] });
    const invited = await signup(form({ shop_name: 'صالون آخر', owner_phone: '0791111111' }));
    const signsIn = await signup(form({ shop_name: 'صالون ثالث', owner_phone: '+962 79 222 2222' }));
    for (const res of [free, invited, signsIn]) {
      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(['token', 'user', 'verify']);
    }
    // And nothing of theirs moved: the real owners keep their mobiles.
    expect(db.store.users.find((u) => u.id === 'u_rana').phone).toBe('962792222222');
    expect(db.store.businesses.find((b) => b.id === 'biz_other').owner_phone).toBe('962791111111');
  });

  test('the daily cap counts today\'s self-signups only, in Amman', async () => {
    platformSettings.clearCache();
    db.store.platformSettings.length = 0;
    openSignup(2);
    db.seed({
      accountEvents: [
        // Yesterday's, and an invite created today, do not count.
        { business_id: 'b_old', actor_kind: 'owner', type: 'business_created', data: { source: 'self_signup' }, created_at: new Date(T0.getTime() - 2 * DAY) },
        { business_id: 'biz_other', actor_kind: 'shift', type: 'business_created', data: { source: 'invite' }, created_at: T0 },
      ],
    });
    expect((await signup(form({ owner_phone: '0781000001' }))).status).toBe(201);
    expect((await signup(form({ owner_phone: '0781000002' }))).status).toBe(201);
    const third = await signup(form({ owner_phone: '0781000003' }));
    expect(third.status).toBe(429);
    expect(third.body.error).toContain('اكتملت تسجيلات اليوم');
    expect(db.store.businesses.filter((b) => b.source === 'self_signup')).toHaveLength(2);
  });

  test('one IP gets five tries in a quarter hour; another IP is not affected', async () => {
    const ip = '198.51.100.7';
    for (let i = 0; i < 5; i += 1) {
      const res = await signup(form({ password: 'short' }), ip);
      expect(res.status).toBe(400);
    }
    const blocked = await signup(form(), ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toContain('محاولات كثيرة');
    expect(db.store.businesses).toHaveLength(1);
    expect((await signup(form(), '198.51.100.8')).status).toBe(201);
  });

  test('closing it again closes the route at once', async () => {
    const off = await request(app).patch('/api/admin/platform-settings').set(ADMIN())
      .send({ key: 'self_signup', value: { enabled: false } });
    expect(off.status).toBe(200);
    expect((await signup(form())).status).toBe(503);
  });
});

describe('opening it from «إعدادات المنصة»', () => {
  const patch = (body) => request(app).patch('/api/admin/platform-settings').set(ADMIN()).send(body);
  const esOwner = (on) => db.seed({ platformSettings: [{ key: 'es_owner_enabled', value: on }] });

  test('refused while owner self-connect is closed: a self-signed shop could not go live alone', async () => {
    const res = await patch({ key: 'self_signup', value: { enabled: true }, confirm: 'افتح التسجيل العام' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('الربط الذاتي');
    expect(db.store.platformSettings.find((r) => r.key === 'self_signup')).toBeUndefined();
    expect((await signup(form())).status).toBe(503);
  });

  test('needs the typed Arabic confirmation; then the public route opens', async () => {
    esOwner(true);
    const without = await patch({ key: 'self_signup', value: { enabled: true } });
    expect(without.status).toBe(400);
    expect(without.body.error).toContain('افتح التسجيل العام');
    const wrong = await patch({ key: 'self_signup', value: { enabled: true }, confirm: 'نعم' });
    expect(wrong.status).toBe(400);
    expect(db.store.platformSettings.find((r) => r.key === 'self_signup')).toBeUndefined();

    const ok = await patch({ key: 'self_signup', value: { enabled: true }, confirm: ' افتح  التسجيل العام ' });
    expect(ok.status).toBe(200);
    expect(ok.body.value).toEqual({ enabled: true, daily_cap: 5 });
    expect((await signup(form())).status).toBe(201);

    // Already open: a new cap needs no confirmation.
    const cap = await patch({ key: 'self_signup', value: { daily_cap: 3 } });
    expect(cap.status).toBe(200);
    expect(cap.body.value).toEqual({ enabled: true, daily_cap: 3 });
  });

  test('the page is told the sentence to ask for', async () => {
    const res = await request(app).get('/api/admin/platform-settings').set(ADMIN());
    expect(res.body.confirm_to_enable).toMatchObject({ self_signup: 'افتح التسجيل العام' });
    expect(res.body.editable).toContain('self_signup');
  });
});

// ─── Proving the mobile (P5 review) ─────────────────────────────────────────

describe('proving the mobile from its own WhatsApp', () => {
  const SHIFT_BIZ = 'biz_shift';
  beforeEach(() => {
    openSignup();
    db.seed({ businesses: [{ id: SHIFT_BIZ, name: 'شِفت', slug: 'shift', business_type: 'shift', status: 'active' }] });
  });

  const as = (token) => ({ Authorization: `Bearer ${token}` });
  const verify = (token) => request(app).post('/api/public/signup/verify').set(as(token)).send({});
  // A message on SHIFT's number, as persistInbound stores it.
  let seq = 0;
  const arrives = (from, text, at = new Date(T0.getTime() + 60 * 1000)) => db.seed({
    messages: [{
      id: `m_in_${(seq += 1)}`, business_id: SHIFT_BIZ, conversation_id: 'c_shift', meta_message_id: `wamid.V${seq}`,
      direction: 'inbound', message_type: 'text', text_body: text, sender_wa_id: from, status: 'received', created_at: at,
    }],
  });
  const owner = (res) => db.store.users.find((u) => u.id === res.body.user.id);
  const shop = (res) => db.store.businesses.find((b) => b.id === res.body.user.business_id);

  test('the code sent from that mobile makes it the login, the owner number and the alert number', async () => {
    const res = await signup(form());
    expect((await verify(res.body.token)).body).toEqual({ verified: false });

    arrives('962781234567', res.body.verify.text);
    const ok = await verify(res.body.token);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ verified: true });
    expect(owner(res).phone).toBe('962781234567');
    expect(shop(res)).toMatchObject({ owner_phone: '962781234567' });
    expect(shop(res).ai_config.alert_wa_numbers).toEqual(['962781234567']);
    expect(db.store.accountEvents.some((e) => e.type === 'self_signup_verified' && e.business_id === shop(res).id)).toBe(true);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'self_signup', phone: '962781234567' }));

    // And the mobile now signs in.
    const login = await request(app).post('/api/auth/login').set('X-Forwarded-For', nextIp()).send({ login: '0781234567', password: 'kalimat-sir-1' });
    expect(login.status).toBe(200);
  });

  test('a squatter cannot prove someone else\'s mobile: the code from another number, or the wrong code, proves nothing', async () => {
    const res = await signup(form({ owner_phone: '0791111111' })); // the invite shop's owner
    arrives('962780000000', res.body.verify.text); // the squatter's own phone
    arrives('962791111111', 'رمز تأكيد كرم بوت: 000000'); // the real owner, chatting with the sales bot
    expect((await verify(res.body.token)).body).toEqual({ verified: false });
    expect(owner(res).phone).toBeNull();
    expect(shop(res).ai_config.alert_wa_numbers).toEqual([]);
    expect(db.store.businesses.find((b) => b.id === 'biz_other').owner_phone).toBe('962791111111');
  });

  test('a message from before the code was issued does not count', async () => {
    const res = await signup(form());
    arrives('962781234567', res.body.verify.text, new Date(T0.getTime() - 60 * 1000));
    expect((await verify(res.body.token)).body).toEqual({ verified: false });
  });

  test('Arabic-Indic digits are read as the code', async () => {
    const res = await signup(form());
    const arabic = res.body.verify.code.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
    arrives('962781234567', `رمز تأكيد كرم بوت: ${arabic}`);
    expect((await verify(res.body.token)).body).toMatchObject({ verified: true });
  });

  test('a mobile proven by its owner but already on another account: told so (they own it), nothing moved', async () => {
    db.seed({ users: [{ id: 'u_rana', name: 'رنا', role: 'business_owner', business_id: 'biz_other', phone: '962781234567' }] });
    const res = await signup(form());
    arrives('962781234567', res.body.verify.text);
    const out = await verify(res.body.token);
    expect(out.status).toBe(409);
    expect(out.body.error).toContain('مسجّل لحساب آخر');
    expect(owner(res).phone).toBeNull();
    expect(db.store.users.find((u) => u.id === 'u_rana').phone).toBe('962781234567');
  });

  test('a new code replaces the old one', async () => {
    const res = await signup(form());
    const fresh = await request(app).post('/api/public/signup/verify/code').set(as(res.body.token)).send({});
    expect(fresh.status).toBe(200);
    expect(fresh.body.code).toMatch(/^\d{6}$/);
    if (fresh.body.code !== res.body.verify.code) {
      arrives('962781234567', res.body.verify.text);
      expect((await verify(res.body.token)).body).toEqual({ verified: false });
    }
    arrives('962781234567', fresh.body.text);
    expect((await verify(res.body.token)).body).toMatchObject({ verified: true });
  });

  test('only a self-signup owner can use these steps', async () => {
    const token = jwt.sign({ id: 'u_admin' }, process.env.JWT_SECRET);
    const res = await verify(token);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/[ء-ي]/);
  });
});

describe('the /join page and the server agree on the proof', () => {
  const fs = require('fs');
  const path = require('path');
  const join = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/JoinPage.jsx'), 'utf8');
  const { codeText } = require('../src/routes/publicSignup');

  test('a signup goes to «أكّد رقمك» before connect, and the page fills in the sentence the server reads', () => {
    expect(join).toMatch(/setStep\('verify'\)/);
    expect(join).toContain("api.post('/public/signup/verify')");
    const sentence = codeText('123456').replace('123456', '');
    expect(join).toContain(`\`${sentence}\${code}\``);
  });
});

// P5 review: every P5 scope item the phase did not build is named, with its reason, where the owner
// reads what is left; and the switch is not flipped with no public way in.
describe('what P5 left for later is written down, not dropped', () => {
  const fs = require('fs');
  const path = require('path');
  const decisions = fs.readFileSync(path.join(__dirname, '../../docs/panels/decisions-2026-10-08.md'), 'utf8');

  test.each(['Menu from a photo', 'Weekly WhatsApp digest', 'Modeer-style assignment rule', 'Token metering'])(
    '%s is listed as deferred, with why',
    (item) => {
      const line = decisions.split('\n').find((l) => l.includes(item));
      expect(line).toBeDefined();
      expect(line.split('|').filter((c) => c.trim()).length).toBeGreaterThanOrEqual(3);
    },
  );

  test('the marketing-site link is an owner task, next to the switch it belongs with', () => {
    const owner = decisions.slice(decisions.indexOf('What still needs the owner'));
    expect(owner).toMatch(/«جرّب مجانًا» link on shifts-ai\.com/);
    expect(owner).toContain('marketing/deploy.py');
    expect(owner).toContain('self_signup');
  });
});
