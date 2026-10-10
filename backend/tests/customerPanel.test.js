/**
 * The customer panel's own APIs (docs/panels/spec.md, P3): «الفريق», «ما عرف يجاوب», «الاشتراك»,
 * «التقارير», the owner's pause switch, and the role checks on the menu, clinic and reports APIs.
 *
 * What they must hold to:
 *  - every read and write is the caller's own shop (attachBusinessId), whatever a body or query says;
 *  - the owner manages, the manager reads, staff see none of it (and none of the money);
 *  - seats come from the contract's snapshot, else the plan's default, and a full shop is told so
 *    in Arabic;
 *  - a gap is answered once (a faq row, then closed) or dismissed, and only within its own shop;
 *  - /billing never shows recorded_by.
 *
 * Real routes and middleware over the in-memory fakeDb. fakeDb has no Payment model, so this file
 * adds one backed by the same store pattern.
 */
require('./setup');

jest.mock('../src/config/prisma', () => {
  const fake = require('./helpers/fakeDb').getFakeDb();
  // Payments live only here: a list the test fills and a findMany honouring where/select/orderBy.
  fake.payments = [];
  fake.prisma.payment = {
    findMany: jest.fn(async ({ where = {}, select, orderBy } = {}) => {
      let rows = fake.payments.filter((p) => !where.business_id || p.business_id === where.business_id);
      if (orderBy && orderBy.paid_at === 'desc') rows = [...rows].sort((a, b) => b.paid_at - a.paid_at);
      return rows.map((p) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, p[k]])) : { ...p }));
    }),
  };
  return fake.prisma;
});
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('./helpers/fakeDb').getFakeDb();
const app = require('../src/app');
const costGuard = require('../src/services/costGuard');
const platformSettings = require('../src/services/platformSettings');

const as = (userId) => ({ Authorization: `Bearer ${jwt.sign({ id: userId }, process.env.JWT_SECRET)}` });
const T0 = new Date('2026-10-08T09:00:00Z'); // 12:00 in Amman
const DAY = 24 * 3600 * 1000;

function seedShops({ contract } = {}) {
  db.seed({
    businesses: [
      { id: 'b1', name: 'صيدلية النور', business_type: 'generic', ai_config: { greeting_message: 'أهلًا' } },
      { id: 'b2', name: 'مطعم الشام', business_type: 'restaurant' },
    ],
    users: [
      { id: 'admin', role: 'platform_admin', business_id: null },
      { id: 'owner', name: 'أبو خالد', role: 'business_owner', business_id: 'b1', phone: '962791000001' },
      { id: 'manager', name: 'سارة', role: 'manager', business_id: 'b1', last_login: T0 },
      { id: 'staff', name: 'علي', role: 'staff', business_id: 'b1' },
      { id: 'owner2', role: 'business_owner', business_id: 'b2' },
      { id: 'staff2', role: 'staff', business_id: 'b2' },
    ],
  });
  if (contract !== null) {
    db.seed({
      subscriptions: [{
        id: 'sub1', business_id: 'b1', solution: 'karam_bot', plan_name: 'باقة كرم بوت', status: 'trial', amount_jod: 19.99,
        billing_cycle: 'monthly', starts_at: T0,
        // From the real clock: the plan card counts days left from now, not from the fake clock.
        trial_ends_at: new Date(Date.now() + 18 * DAY - 3600 * 1000), next_due_at: new Date(Date.now() + 18 * DAY), ai_replies_month: 1000, seats: 3, created_by: 'system', ...contract,
      }],
    });
  }
}

beforeEach(() => {
  db.reset();
  db.payments.length = 0;
  costGuard.clearCache();
  platformSettings.clearCache();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

// ─── «الفريق» ────────────────────────────────────────────────────────────────

describe('GET /api/team', () => {
  test('the owner sees their own shop only, with statuses and the seats meter', async () => {
    seedShops();
    db.seed({
      users: [{ id: 'pending', role: 'staff', business_id: 'b1', active: false }, { id: 'gone', role: 'staff', business_id: 'b1', active: false }],
      userActivations: [{ user_id: 'pending', token_hash: 'h1', expires_at: new Date(Date.now() + DAY), created_by: 'owner', used_at: null }],
    });
    const res = await request(app).get('/api/team?businessId=b2').set(as('owner'));
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.members.map((m) => [m.id, m]));
    expect(Object.keys(byId).sort()).toEqual(['gone', 'manager', 'owner', 'pending', 'staff']);
    expect(byId.pending.status).toBe('pending');
    expect(byId.gone.status).toBe('disabled');
    expect(byId.owner.status).toBe('active');
    expect(byId.owner).not.toHaveProperty('password');
    // owner, manager, staff, pending: a disabled member frees their seat.
    expect(res.body).toMatchObject({ seats_used: 4, seats: 3 });
  });

  test('a manager may read it; staff may not', async () => {
    seedShops();
    expect((await request(app).get('/api/team').set(as('manager'))).status).toBe(200);
    expect((await request(app).get('/api/team').set(as('staff'))).status).toBe(403);
  });
});

describe('POST /api/team/invite', () => {
  const invite = (who, body) => request(app).post('/api/team/invite').set(as(who)).send(body);

  test('creates an inactive member with the chosen role, a /activate link, a wa.me share and user_added', async () => {
    seedShops({ contract: { seats: 5 } });
    const res = await invite('owner', { name: 'ليلى', phone: '0795551234', role: 'manager', business_id: 'b2' });
    expect(res.status).toBe(201);
    expect(res.body.join_url).toMatch(/^https:\/\/app\.shifts-ai\.com\/activate#[\w-]{20,}$/);
    expect(res.body.wa_share_url).toMatch(/^https:\/\/wa\.me\/962795551234\?text=/);
    expect(decodeURIComponent(res.body.wa_share_url)).toContain(res.body.join_url);

    const member = db.store.users.find((u) => u.phone === '962795551234');
    // A manager really is a manager, in the caller's shop, whatever the body named.
    expect(member).toMatchObject({ role: 'manager', business_id: 'b1', active: false, email: null });
    expect(db.store.userActivations.filter((a) => a.user_id === member.id && !a.used_at)).toHaveLength(1);
    expect(db.store.accountEvents).toEqual([expect.objectContaining({
      business_id: 'b1', actor_kind: 'owner', actor_user_id: 'owner', type: 'user_added', data: { user_id: member.id, role: 'manager' },
    })]);
  });

  test('a full shop is refused in Arabic, from the contract\'s seats', async () => {
    seedShops(); // owner, manager, staff = 3 of 3
    const res = await invite('owner', { name: 'ليلى', phone: '0795551234', role: 'staff' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('وصلت لعدد المستخدمين في باقتك — تواصل مع شِفت');
    expect(db.store.users.find((u) => u.phone === '962795551234')).toBeUndefined();
  });

  test('with no contract the plan\'s default (3) applies', async () => {
    seedShops({ contract: null });
    db.store.users.find((u) => u.id === 'staff').active = false; // disabled, no link: frees a seat
    const ok = await invite('owner', { name: 'ليلى', phone: '0795551234', role: 'staff' });
    expect(ok.status).toBe(201);
    const full = await invite('owner', { name: 'سامي', phone: '0795551235', role: 'staff' });
    expect(full.status).toBe(409);
  });

  test('a mobile already in use, a bad mobile and an unknown role are refused', async () => {
    seedShops({ contract: { seats: 10 } });
    expect((await invite('owner', { name: 'x', phone: '0791000001', role: 'staff' })).body.error).toBe('رقم الموبايل هذا مستخدم لحساب آخر');
    expect((await invite('owner', { name: 'x', phone: '12345', role: 'staff' })).status).toBe(400);
    expect((await invite('owner', { name: 'x', phone: '0795551234', role: 'business_owner' })).status).toBe(400);
    expect((await invite('owner', { name: 'x', phone: '0795551234', role: 'platform_admin' })).status).toBe(400);
  });

  // invite_ttl_days is SHIFT's setting (1–30): only 7 used to read right, «صالح 3 يوم» otherwise.
  test.each([
    [7, 'صالح 7 أيام.'], [1, 'صالح يومًا واحدًا.'], [2, 'صالح يومين.'], [3, 'صالح 3 أيام.'], [15, 'صالح 15 يومًا.'],
  ])('the invite text counts %i days in Arabic', async (days, phrase) => {
    seedShops({ contract: { seats: 10 } });
    db.seed({ platformSettings: [{ key: 'invite_ttl_days', value: days }] });
    const res = await invite('owner', { name: 'ليلى', phone: '0795551234', role: 'staff' });
    expect(res.status).toBe(201);
    expect(res.body.share_text.endsWith(phrase)).toBe(true);
    expect(res.body.share_text).not.toMatch(/\d+ يوم\b/);
  });

  test('only the owner invites', async () => {
    seedShops({ contract: { seats: 10 } });
    expect((await invite('manager', { name: 'x', phone: '0795551234', role: 'staff' })).status).toBe(403);
    expect((await invite('staff', { name: 'x', phone: '0795551234', role: 'staff' })).status).toBe(403);
  });
});

describe('PATCH /api/team/:id', () => {
  const patch = (who, id, body) => request(app).patch(`/api/team/${id}`).set(as(who)).send(body);

  test('changes a role and writes role_changed', async () => {
    seedShops();
    const res = await patch('owner', 'staff', { role: 'manager' });
    expect(res.status).toBe(200);
    expect(db.store.users.find((u) => u.id === 'staff').role).toBe('manager');
    expect(db.store.accountEvents).toEqual([expect.objectContaining({
      type: 'role_changed', business_id: 'b1', actor_kind: 'owner', data: { user_id: 'staff', from: 'staff', to: 'manager' },
    })]);
  });

  test('deactivating revokes any link', async () => {
    seedShops();
    db.seed({ userActivations: [{ user_id: 'staff', token_hash: 'h', expires_at: new Date(Date.now() + DAY), created_by: 'owner' }] });
    const res = await patch('owner', 'staff', { active: false });
    expect(res.status).toBe(200);
    expect(db.store.users.find((u) => u.id === 'staff').active).toBe(false);
    expect(db.store.userActivations[0].used_at).not.toBeNull();
    expect(db.store.accountEvents.map((e) => e.type)).toEqual(['user_deactivated']);
  });

  test('cannot touch the owner, themselves, another shop\'s member, or grant platform_admin', async () => {
    seedShops();
    expect((await patch('owner', 'owner', { role: 'staff' })).status).toBe(403);
    expect((await patch('owner', 'owner2', { active: false })).status).toBe(404);
    expect((await patch('owner', 'staff', { role: 'platform_admin' })).status).toBe(400);
    expect((await patch('owner', 'staff', { role: 'business_owner' })).status).toBe(400);
    expect((await patch('manager', 'staff', { role: 'manager' })).status).toBe(403);
    expect(db.store.users.find((u) => u.id === 'owner2').active).toBe(true);
    expect(db.store.accountEvents).toHaveLength(0);
  });

  test('reactivating needs a free seat, and someone who never signed in gets a link instead', async () => {
    seedShops();
    db.seed({ users: [{ id: 'old', role: 'staff', business_id: 'b1', active: false, last_login: T0 }] });
    expect((await patch('owner', 'old', { active: true })).status).toBe(409); // 3 of 3
    db.seed({ users: [{ id: 'never', role: 'staff', business_id: 'b1', active: false }] });
    const never = await patch('owner', 'never', { active: true });
    expect(never.status).toBe(409);
    expect(never.body.error).toMatch(/لم يفعّل حسابه/);
  });
});

describe('POST /api/team/:id/resend', () => {
  test('a pending member gets a new link; the old one stops working', async () => {
    seedShops();
    db.seed({
      users: [{ id: 'p', role: 'staff', business_id: 'b1', active: false, phone: '962795550000' }],
      userActivations: [{ id: 'a_old', user_id: 'p', token_hash: 'old', expires_at: new Date(Date.now() - DAY), created_by: 'owner' }],
    });
    db.store.users.find((u) => u.id === 'staff').active = false; // keep a seat free for the check below
    const res = await request(app).post('/api/team/p/resend').set(as('owner'));
    expect(res.status).toBe(200);
    expect(res.body.join_url).toMatch(/\/activate#/);
    expect(db.store.userActivations.find((a) => a.id === 'a_old').used_at).not.toBeNull();
    expect(db.store.userActivations.filter((a) => a.user_id === 'p' && !a.used_at)).toHaveLength(1);
  });

  test('refused for someone who already signs in', async () => {
    seedShops();
    expect((await request(app).post('/api/team/manager/resend').set(as('owner'))).status).toBe(409);
  });
});

// ─── «ما عرف يجاوب» ──────────────────────────────────────────────────────────

describe('knowledge gaps', () => {
  function seedGaps() {
    seedShops();
    return db.seed({
      accountEvents: [
        { id: 'g1', business_id: 'b1', actor_kind: 'system', type: 'bot_handoff', data: { question: 'هل عندكم توصيل لحوارة؟', conversation_id: 'c1' } },
        { id: 'g2', business_id: 'b1', actor_kind: 'system', type: 'bot_handoff', data: { question: 'تفتحون الجمعة؟', conversation_id: 'c2' }, resolved_at: T0 },
        { id: 'g3', business_id: 'b2', actor_kind: 'system', type: 'bot_handoff', data: { question: 'سر مطعم الشام', conversation_id: 'c3' } },
        { id: 'e1', business_id: 'b1', actor_kind: 'owner', type: 'payment_claimed', data: {} },
      ],
    });
  }

  test('lists the open handoffs of the caller\'s shop only, for the owner and the manager', async () => {
    seedGaps();
    for (const who of ['owner', 'manager']) {
      const res = await request(app).get('/api/knowledge/gaps?businessId=b2').set(as(who));
      expect(res.status).toBe(200);
      expect(res.body.gaps).toEqual([{ id: 'g1', question: 'هل عندكم توصيل لحوارة؟', at: expect.any(String), conversation_id: 'c1' }]);
    }
    expect((await request(app).get('/api/knowledge/gaps').set(as('staff'))).status).toBe(403);
  });

  test('answering creates a faq and closes the gap, once', async () => {
    seedGaps();
    const res = await request(app).post('/api/knowledge/gaps/g1/answer').set(as('owner')).send({ answer: 'نعم، بدينارين' });
    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({ business_id: 'b1', kind: 'faq', question: 'هل عندكم توصيل لحوارة؟', content: 'نعم، بدينارين' });
    expect(db.store.accountEvents.find((e) => e.id === 'g1').resolved_at).not.toBeNull();
    expect(db.store.accountEvents.find((e) => e.type === 'knowledge_added')).toMatchObject({ business_id: 'b1', actor_kind: 'owner' });

    const again = await request(app).post('/api/knowledge/gaps/g1/answer').set(as('owner')).send({ answer: 'مرة ثانية' });
    expect(again.status).toBe(404);
    expect(db.store.businessKnowledge).toHaveLength(1);
    expect((await request(app).get('/api/knowledge/gaps').set(as('owner'))).body.gaps).toEqual([]);
  });

  test('a category files it under that kind; an unknown one is refused', async () => {
    seedGaps();
    expect((await request(app).post('/api/knowledge/gaps/g1/answer').set(as('manager')).send({ answer: 'x', category: 'nope' })).status).toBe(400);
    const res = await request(app).post('/api/knowledge/gaps/g1/answer').set(as('manager')).send({ answer: 'نوصل لكل إربد', category: 'policy' });
    expect(res.body.item).toMatchObject({ kind: 'policy', question: null });
  });

  test('another shop\'s gap, or something that is not a gap, cannot be answered or dismissed', async () => {
    seedGaps();
    expect((await request(app).post('/api/knowledge/gaps/g3/answer').set(as('owner')).send({ answer: 'x' })).status).toBe(404);
    expect((await request(app).post('/api/knowledge/gaps/e1/answer').set(as('owner')).send({ answer: 'x' })).status).toBe(404);
    expect((await request(app).delete('/api/knowledge/gaps/g3').set(as('owner'))).status).toBe(404);
    expect(db.store.accountEvents.find((e) => e.id === 'g3').resolved_at).toBeNull();
    expect(db.store.businessKnowledge).toHaveLength(0);
  });

  test('dismissing closes it without teaching anything', async () => {
    seedGaps();
    const res = await request(app).delete('/api/knowledge/gaps/g1').set(as('owner'));
    expect(res.status).toBe(200);
    expect(db.store.accountEvents.find((e) => e.id === 'g1').resolved_at).not.toBeNull();
    expect(db.store.businessKnowledge).toHaveLength(0);
  });

  test('an empty answer is refused', async () => {
    seedGaps();
    expect((await request(app).post('/api/knowledge/gaps/g1/answer').set(as('owner')).send({ answer: '  ' })).status).toBe(400);
  });
});

// ─── «الاشتراك» ───────────────────────────────────────────────────────────────

describe('GET /api/account/billing', () => {
  test('plan, meters, payments without recorded_by, instructions, late policy and the Meta fees line', async () => {
    seedShops();
    db.payments.push(
      { id: 'p1', business_id: 'b1', subscription_id: 'sub1', amount_jod: 19.99, paid_at: new Date('2026-09-01'), method: 'cliq', reference: 'R1', note: 'سرّي', recorded_by: 'admin' },
      { id: 'p2', business_id: 'b2', subscription_id: 'x', amount_jod: 50, paid_at: new Date('2026-09-02'), method: 'cash', reference: null, recorded_by: 'admin' },
    );
    await platformSettings.set('payment_instructions', { cliq_alias: 'SHIFTAI', iban: '', holder: 'شِفت' });

    const res = await request(app).get('/api/account/billing?businessId=b2').set(as('owner'));
    expect(res.status).toBe(200);
    expect(res.body.plan).toMatchObject({ name: 'باقة كرم بوت', price_jod: 19.99, status: 'trial', trial_days_left: 18 });
    expect(res.body.usage).toEqual({ ai_replies_month: 0, cap: 1000, seats_used: 3, seats: 3 });
    expect(res.body.payments).toEqual([{ paid_at: '2026-09-01T00:00:00.000Z', amount_jod: 19.99, method: 'cliq', reference: 'R1' }]);
    expect(JSON.stringify(res.body)).not.toMatch(/recorded_by|سرّي|admin/);
    expect(res.body.payment_instructions).toEqual({ cliq_alias: 'SHIFTAI', iban: '', holder: 'شِفت' });
    expect(res.body.late_policy).toEqual({ grace_days: 7 });
    expect(res.body.meta_fees_line).toMatch(/Meta/);
  });

  test('no contract reads «none» with the plan\'s published price; unset instructions are empty strings', async () => {
    seedShops({ contract: null });
    const res = await request(app).get('/api/account/billing').set(as('owner'));
    expect(res.body.plan).toMatchObject({ status: 'none', price_jod: 19.99, trial_days_left: null });
    expect(res.body.payment_instructions).toEqual({ cliq_alias: '', iban: '', holder: '' });
  });

  test('owner only', async () => {
    seedShops();
    for (const who of ['manager', 'staff', 'admin']) {
      expect((await request(app).get('/api/account/billing').set(as(who))).status).toBe(403);
    }
  });
});

// ─── «التقارير» ───────────────────────────────────────────────────────────────

describe('GET /api/reports/summary', () => {
  test('per Amman day: conversations, bot and team replies; handoffs and the top questions', async () => {
    seedShops();
    const today = new Date(); // the report counts back from the real now
    const yesterday = new Date(today.getTime() - DAY);
    db.seed({
      messages: [
        { business_id: 'b1', conversation_id: 'c1', direction: 'inbound', created_at: today },
        { business_id: 'b1', conversation_id: 'c1', direction: 'inbound', created_at: today },
        { business_id: 'b1', conversation_id: 'c2', direction: 'inbound', created_at: today },
        { business_id: 'b1', conversation_id: 'c1', direction: 'outbound', is_ai_generated: true, created_at: today },
        { business_id: 'b1', conversation_id: 'c2', direction: 'outbound', sent_by_user_id: 'staff', created_at: today },
        // A stored alert: outbound, not the bot, not a person.
        { business_id: 'b1', conversation_id: 'c9', direction: 'outbound', created_at: today },
        { business_id: 'b1', conversation_id: 'c3', direction: 'inbound', created_at: yesterday },
        { business_id: 'b2', conversation_id: 'x', direction: 'inbound', created_at: today },
        { business_id: 'b1', conversation_id: 'old', direction: 'inbound', created_at: new Date(today.getTime() - 40 * DAY) },
      ],
      accountEvents: [
        { business_id: 'b1', actor_kind: 'system', type: 'bot_handoff', data: { question: 'تفتحون الجمعة؟' }, created_at: today },
        { business_id: 'b1', actor_kind: 'system', type: 'bot_handoff', data: { question: 'تفتحون  الجمعة' }, created_at: yesterday, resolved_at: today },
        { business_id: 'b1', actor_kind: 'system', type: 'bot_handoff', data: { question: 'بتوصلوا؟' }, created_at: today },
        { business_id: 'b2', actor_kind: 'system', type: 'bot_handoff', data: { question: 'سر' }, created_at: today },
      ],
    });
    const res = await request(app).get('/api/reports/summary?days=7').set(as('manager'));
    expect(res.status).toBe(200);
    expect(res.body.per_day).toHaveLength(7);
    const last = res.body.per_day[6];
    expect(last).toEqual({ date: costGuard.ammanDay(today), conversations: 2, bot_replies: 1, team_replies: 1 });
    expect(res.body.per_day[5]).toMatchObject({ date: costGuard.ammanDay(yesterday), conversations: 1 });
    expect(res.body.handoffs).toBe(3);
    expect(res.body.top_gaps[0]).toEqual({ question: 'تفتحون الجمعة؟', count: 2 });
    expect(res.body.top_gaps).toHaveLength(2);
  });

  test('30 days on request; anything else is 7', async () => {
    seedShops();
    expect((await request(app).get('/api/reports/summary?days=30').set(as('owner'))).body.per_day).toHaveLength(30);
    expect((await request(app).get('/api/reports/summary?days=365').set(as('owner'))).body.per_day).toHaveLength(7);
  });
});

// ─── role checks on the menu, clinic and reports APIs ───────────────────────

describe('role checks', () => {
  test.each([
    ['get', '/api/reports/summary'],
    ['get', '/api/reports/daily'],
    ['get', '/api/menu/categories'],
    ['post', '/api/menu/items'],
    ['get', '/api/clinic/services'],
    ['post', '/api/clinic/doctors'],
  ])('staff are refused %s %s', async (method, path) => {
    seedShops();
    expect((await request(app)[method](path).set(as('staff')).send({})).status).toBe(403);
  });

  test('staff keep the clinic\'s appointments (they work «المواعيد» from /orders)', async () => {
    seedShops();
    const res = await request(app).get('/api/clinic/appointments').set(as('staff'));
    expect(res.status).not.toBe(403);
  });
});

// ─── the owner's pause switch ──────────────────────────────────────────────────

describe('PATCH /api/businesses/:id — «البوت يرد على الزبائن»', () => {
  const pause = (who, enabled, id = 'b1') => request(app).patch(`/api/businesses/${id}`).set(as(who)).send({ ai_config: { enabled } });
  // fakeDb's jsonb patches conversations only: businesses.ai_config is merged here the same way.
  const patchBusinesses = () => jest.spyOn(require('../src/db/jsonb'), 'patchJson').mockImplementation(async (table, id, col, patch, { remove = [] } = {}) => {
    const b = db.store.businesses.find((x) => x.id === id);
    const next = { ...b.ai_config };
    for (const k of remove) delete next[k];
    b.ai_config = { ...next, ...patch };
    return { ok: true, count: 1 };
  });

  test('the owner pauses and resumes; each change is logged once with the owner as actor', async () => {
    seedShops();
    const sent = patchBusinesses();

    const off = await pause('owner', false);
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ enabled: false, changed: true });
    expect(sent).toHaveBeenCalledWith('businesses', 'b1', 'ai_config', { enabled: false, paused_by: 'owner' });
    expect(db.store.businesses.find((b) => b.id === 'b1').ai_config).toEqual({ greeting_message: 'أهلًا', enabled: false, paused_by: 'owner' });

    expect((await pause('owner', false)).body.changed).toBe(false); // a repeated tap logs nothing
    await pause('owner', true);
    expect(db.store.accountEvents.map((e) => [e.type, e.actor_kind, e.actor_user_id])).toEqual([
      ['bot_paused', 'owner', 'owner'], ['bot_resumed', 'owner', 'owner'],
    ]);
  });

  test('SHIFT\'s pause cannot be lifted from the owner\'s switch; SHIFT\'s resume frees it again', async () => {
    seedShops();
    patchBusinesses();
    const paused = await request(app).patch('/api/admin/accounts/b1/bot').set(as('admin')).send({ enabled: false, reason: 'تأخر الدفع' });
    expect(paused.status).toBe(200);
    const b1 = () => db.store.businesses.find((b) => b.id === 'b1');
    expect(b1().ai_config).toMatchObject({ enabled: false, paused_by: 'shift' });

    const res = await pause('owner', true);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('أوقف فريق شِفت البوت — تواصل معهم لإعادة تشغيله');
    expect(b1().ai_config.enabled).toBe(false);
    // A repeated pause from the owner does not relabel it as theirs.
    await pause('owner', false);
    expect(b1().ai_config.paused_by).toBe('shift');
    expect((await pause('owner', true)).status).toBe(403);

    await request(app).patch('/api/admin/accounts/b1/bot').set(as('admin')).send({ enabled: true });
    expect(b1().ai_config).not.toHaveProperty('paused_by');
    await pause('owner', false);
    expect((await pause('owner', true)).status).toBe(200);
    expect(b1().ai_config.enabled).toBe(true);
  });

  test('a SHIFT pause from before the marker is recognised from the log', async () => {
    seedShops();
    db.store.businesses.find((b) => b.id === 'b1').ai_config = { enabled: false };
    db.seed({ accountEvents: [{ id: 'p1', business_id: 'b1', actor_kind: 'shift', type: 'bot_paused', data: { reason: 'x' }, created_at: T0 }] });
    expect((await pause('owner', true)).status).toBe(403);
    expect(db.store.businesses.find((b) => b.id === 'b1').ai_config.enabled).toBe(false);
  });

  test('a manager, staff, another shop\'s owner, or a non-boolean are refused', async () => {
    seedShops();
    expect((await pause('manager', false)).status).toBe(403);
    expect((await pause('staff', false)).status).toBe(403);
    expect((await pause('owner2', false)).status).toBe(403);
    expect((await pause('owner', 'false')).status).toBe(400);
    expect(db.store.accountEvents).toHaveLength(0);
  });
});
