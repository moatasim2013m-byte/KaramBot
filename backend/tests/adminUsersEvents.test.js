/**
 * The customer page's «الدخول», «السجل» and «فحص المحادثات» (docs/panels/spec.md P4), over the
 * in-memory database:
 *
 *  - PATCH /api/admin/accounts/:id/users/:userId switches a login off (its links and sessions go
 *    with it) or changes its role, scoped to the shop in the URL, logged as SHIFT;
 *  - POST …/reset deactivates, revokes, issues one new link, and is audited twice (the access log
 *    and login_reset), and the link itself is never stored in either;
 *  - GET /api/admin/events reads AccountEvents and SHIFT's reads of the shop, merged, in Arabic;
 *  - the inspection thread is the newest 200 messages in reading order, with transcripts and who
 *    wrote each reply, and the list can be searched.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('./helpers/fakeDb').getFakeDb();
const app = require('../src/app');
const platformSettings = require('../src/services/platformSettings');

const auth = (id = 'admin1') => ({ Authorization: `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}` });
const MIN = 60000;
const T0 = new Date('2026-10-20T09:00:00Z');

function seed() {
  db.seed({
    businesses: [
      { id: 'b1', name: 'مطعم الشام', owner_phone: '962791234567' },
      { id: 'b2', name: 'صيدلية الريان' },
      { id: 'sim', name: 'تجريبي', is_internal: true },
    ],
    users: [
      { id: 'admin1', name: 'معتصم الأحمد', email: 'm@shifts-ai.com', role: 'platform_admin', business_id: null, active: true },
      { id: 'owner1', name: 'أبو خالد الشامي', phone: '962791234567', role: 'business_owner', business_id: 'b1', active: true, last_login: new Date(T0.getTime() - 60 * MIN) },
      { id: 'staff1', name: 'سامر', phone: '962781112223', role: 'staff', business_id: 'b1', active: true, last_login: new Date(T0.getTime() - 60 * MIN) },
      { id: 'fresh1', name: 'ليلى', phone: '962771234567', role: 'manager', business_id: 'b1', active: false, last_login: null },
      { id: 'other1', name: 'غريب', role: 'business_owner', business_id: 'b2', active: true },
    ],
    userActivations: [{ id: 'act_old', user_id: 'staff1', token_hash: 'h', expires_at: new Date(T0.getTime() + 86400000), used_at: null, created_by: 'admin1' }],
  });
}

beforeEach(() => {
  db.reset();
  db.clock.set(T0);
  platformSettings.clearCache();
  seed();
});

const user = (id) => db.store.users.find((u) => u.id === id);
const eventsOf = (type) => db.store.accountEvents.filter((e) => e.type === type);
const accessLog = () => db.store.adminAccessLogs.map((a) => a.action);

describe('PATCH /api/admin/accounts/:id/users/:userId', () => {
  const patch = (userId, body, bizId = 'b1') => request(app).patch(`/api/admin/accounts/${bizId}/users/${userId}`).set(auth()).send(body);

  test('switching a login off ends its sessions and kills its links, logged as SHIFT', async () => {
    const res = await patch('staff1', { active: false });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 'staff1', active: false });
    expect(user('staff1').sessions_valid_from).toBeTruthy();
    expect(db.store.userActivations.find((a) => a.id === 'act_old').used_at).toBeTruthy();
    expect(eventsOf('user_deactivated')[0]).toMatchObject({ business_id: 'b1', actor_kind: 'shift', actor_user_id: 'admin1', data: { user_id: 'staff1' } });
    expect(accessLog()).toContain('user_updated');
  });

  test('a role change is logged with from and to', async () => {
    const res = await patch('staff1', { role: 'manager' });
    expect(res.body.user.role).toBe('manager');
    expect(eventsOf('role_changed')[0].data).toEqual({ user_id: 'staff1', from: 'staff', to: 'manager' });
  });

  test('the only owner keeps the owner role; a login with no password cannot be switched on', async () => {
    expect((await patch('owner1', { role: 'staff' })).status).toBe(409);
    expect(user('owner1').role).toBe('business_owner');
    const res = await patch('fresh1', { active: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/رابطًا جديدًا/);
  });

  test('no platform_admin role from here, a user of another shop is not found, and nothing at all is a 400', async () => {
    expect((await patch('staff1', { role: 'platform_admin' })).status).toBe(400);
    expect((await patch('other1', { active: false })).status).toBe(404);
    expect(user('other1').active).toBe(true);
    expect((await patch('staff1', {})).status).toBe(400);
    expect((await patch('staff1', { active: 'false' })).status).toBe(400);
  });
});

describe('POST /api/admin/accounts/:id/users/:userId/reset', () => {
  const reset = (userId, bizId = 'b1') => request(app).post(`/api/admin/accounts/${bizId}/users/${userId}/reset`).set(auth()).send({});

  test('deactivates, revokes, issues one new /join link for the owner, and is audited without the link', async () => {
    db.seed({ userActivations: [{ id: 'act_owner', user_id: 'owner1', token_hash: 'h2', expires_at: new Date(T0.getTime() + 86400000), used_at: null, created_by: 'admin1' }] });
    const res = await reset('owner1');
    expect(res.status).toBe(200);
    expect(res.body.join_url).toMatch(/^https:\/\/app\.shifts-ai\.com\/join#[\w-]{20,}$/);
    expect(res.body.wa_share_url).toMatch(/^https:\/\/wa\.me\/962791234567\?text=/);
    expect(decodeURIComponent(res.body.wa_share_url)).toContain('مرحبًا أبو خالد');
    expect(res.body.share_text).toContain('لمطعم الشام');

    expect(user('owner1')).toMatchObject({ active: false });
    expect(user('owner1').sessions_valid_from).toBeTruthy();
    const live = db.store.userActivations.filter((a) => a.user_id === 'owner1' && !a.used_at);
    expect(live).toHaveLength(1);
    expect(db.store.userActivations.find((a) => a.id === 'act_owner').used_at).toBeTruthy();

    expect(accessLog()).toEqual(['user_reset']);
    const [logged] = eventsOf('login_reset');
    expect(logged).toMatchObject({ business_id: 'b1', actor_kind: 'shift', actor_user_id: 'admin1', data: { user_id: 'owner1', role: 'business_owner', revoked: 1, was_active: true } });
    const token = res.body.join_url.split('#')[1];
    expect(JSON.stringify(db.store.accountEvents)).not.toContain(token);
    expect(JSON.stringify(db.store.adminAccessLogs)).not.toContain(token);
  });

  test('a team member gets an /activate link', async () => {
    const res = await reset('staff1');
    expect(res.body.join_url).toMatch(/\/activate#/);
    expect(res.body.wa_share_url).toMatch(/wa\.me\/962781112223/);
  });

  test('if the reset cannot be recorded, it does not happen', async () => {
    db.failNext('adminAccessLog.create');
    const res = await reset('owner1');
    expect(res.status).toBe(500);
    expect(user('owner1').active).toBe(true);
    expect(eventsOf('login_reset')).toHaveLength(0);
  });

  test('scoped to the shop in the URL; owners cannot reach it', async () => {
    expect((await reset('other1')).status).toBe(404);
    const res = await request(app).post('/api/admin/accounts/b1/users/staff1/reset').set(auth('owner1')).send({});
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/events', () => {
  function seedLog() {
    db.seed({
      accountEvents: [
        { id: 'e1', business_id: 'b1', actor_kind: 'owner', actor_user_id: 'owner1', type: 'password_set', data: {}, created_at: new Date(T0.getTime() - 30 * MIN) },
        { id: 'e2', business_id: 'b1', actor_kind: 'shift', actor_user_id: 'admin1', type: 'bot_paused', data: { reason: 'late_payment' }, created_at: new Date(T0.getTime() - 10 * MIN) },
        { id: 'e3', business_id: 'b2', actor_kind: 'system', type: 'went_live', data: {}, created_at: new Date(T0.getTime() - 5 * MIN) },
        { id: 'e4', business_id: 'sim', actor_kind: 'system', type: 'went_live', data: {}, created_at: new Date(T0.getTime() - 1 * MIN) },
      ],
      adminAccessLogs: [
        { id: 'l1', admin_user_id: 'admin1', admin_email: 'm@shifts-ai.com', business_id: 'b1', conversation_id: 'c1', action: 'workspace_thread', created_at: new Date(T0.getTime() - 20 * MIN) },
      ],
    });
  }

  test('one shop: its events and SHIFT\'s reads, merged newest first, in Arabic with who did it', async () => {
    seedLog();
    const res = await request(app).get('/api/admin/events?business_id=b1').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.events.map((e) => e.id)).toEqual(['e2', 'access_l1', 'e1']);
    expect(res.body.events[0]).toMatchObject({ business_name: 'مطعم الشام', actor_ar: 'شِفت (معتصم)', text_ar: 'أُوقف البوت مؤقتًا — السبب: تأخر الدفع' });
    expect(res.body.events[1]).toMatchObject({ type: 'admin_access', actor_ar: 'شِفت (معتصم)', text_ar: 'قرأ محادثة (قراءة فقط)' });
    expect(res.body.events[2]).toMatchObject({ actor_ar: 'صاحب المحل (أبو خالد)', text_ar: 'اختار صاحب المحل كلمة المرور' });
  });

  test('the fleet feed leaves the internal rows out; before= and limit= page it', async () => {
    seedLog();
    let res = await request(app).get('/api/admin/events').set(auth());
    expect(res.body.events.map((e) => e.id)).toEqual(['e3', 'e2', 'e1']);
    res = await request(app).get('/api/admin/events?limit=1').set(auth());
    expect(res.body.events.map((e) => e.id)).toEqual(['e3']);
    res = await request(app).get(`/api/admin/events?before=${encodeURIComponent(res.body.next_before)}`).set(auth());
    expect(res.body.events.map((e) => e.id)).toEqual(['e2', 'e1']);
  });
});

describe('«فحص المحادثات»', () => {
  function seedThread(n) {
    db.seed({ conversations: [{ id: 'c1', business_id: 'b1', customer_wa_id: '962790001111', profile_name: 'محمد' }] });
    const rows = [];
    for (let i = 0; i < n; i += 1) {
      rows.push({
        id: `m${String(i).padStart(3, '0')}`, business_id: 'b1', conversation_id: 'c1',
        direction: i % 2 ? 'outbound' : 'inbound', is_ai_generated: i % 4 === 1, text_body: `رسالة ${i}`,
        created_at: new Date(T0.getTime() - (n - i) * MIN),
      });
    }
    db.seed({ messages: rows });
  }

  test('the newest 200 messages, in reading order, each reply tagged البوت or موظف', async () => {
    seedThread(230);
    const res = await request(app).get('/api/admin/accounts/b1/conversations/c1').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(200);
    expect(res.body.truncated).toBe(true);
    // The oldest 30 are left out; the newest is last.
    expect(res.body.messages[0].id).toBe('m030');
    expect(res.body.messages[199].id).toBe('m229');
    const times = res.body.messages.map((m) => new Date(m.created_at).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(res.body.messages.find((m) => m.id === 'm029')).toBeUndefined();
    const authors = new Set(res.body.messages.map((m) => `${m.direction}:${m.is_ai_generated}:${m.author_ar}`));
    expect([...authors].sort()).toEqual(['inbound:false:الزبون', 'outbound:false:موظف', 'outbound:true:البوت'].sort());
    expect(accessLog()).toEqual(['workspace_thread']);
  });

  test('a voice note shows the transcript the bot read; the raw webhook payload never leaves', async () => {
    db.seed({
      conversations: [{ id: 'c1', business_id: 'b1', customer_wa_id: '962790001111' }],
      messages: [
        { id: 'v1', business_id: 'b1', conversation_id: 'c1', direction: 'inbound', message_type: 'audio', text_body: null, created_at: new Date(T0.getTime() - 2 * MIN), raw_payload: { from: '962790001111', shift_media: { type: 'audio', status: 'ok', text: 'بدي وجبة شاورما' } } },
        { id: 'p1', business_id: 'b1', conversation_id: 'c1', direction: 'inbound', message_type: 'image', text_body: null, created_at: new Date(T0.getTime() - MIN), raw_payload: {} },
      ],
    });
    const res = await request(app).get('/api/admin/accounts/b1/conversations/c1').set(auth());
    expect(res.body.messages[0]).toMatchObject({ transcript: 'بدي وجبة شاورما', display_text: '[رسالة صوتية] بدي وجبة شاورما' });
    expect(res.body.messages[1]).toMatchObject({ transcript: null, display_text: '[صورة]' });
    expect(JSON.stringify(res.body)).not.toContain('raw_payload');
  });

  test('search by the customer\'s name or number, in any form; recorded as a search', async () => {
    db.seed({
      conversations: [
        { id: 'c1', business_id: 'b1', customer_wa_id: '962790001111', profile_name: 'محمد' },
        { id: 'c2', business_id: 'b1', customer_wa_id: '962785550000', profile_name: 'سارة' },
        { id: 'c3', business_id: 'b2', customer_wa_id: '962790001111', profile_name: 'محمد' },
      ],
    });
    let res = await request(app).get('/api/admin/accounts/b1/conversations?search=0790001111').set(auth());
    expect(res.body.conversations.map((c) => c.id)).toEqual(['c1']);
    res = await request(app).get(`/api/admin/accounts/b1/conversations?search=${encodeURIComponent('سارة')}`).set(auth());
    expect(res.body.conversations.map((c) => c.id)).toEqual(['c2']);
    expect(accessLog()).toEqual(['workspace_search', 'workspace_search']);
  });
});
