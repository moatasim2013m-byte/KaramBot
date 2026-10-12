/**
 * Two doors into one panel (config/surfaces).
 *
 * SHIFT — the platform admin and SHIFT's own shop team — signs in at karambots.com; customer shops
 * sign in at app.shifts-ai.com. What these defend: the right password on the wrong door gets no
 * session, only a pointer home; a session opened on the wrong door is not served; a wrong password
 * says nothing more on either door; a request whose door cannot be told (run.app, localhost, tests)
 * is never locked out; and invite and activation links open on the shop's own door.
 *
 * Real routes on the in-memory fakeDb.
 */
require('./setup');
// As on Cloud Run: both doors are allowed origins (app.js reads this once, when it loads).
process.env.CORS_ORIGINS = 'https://karambots.com,https://app.shifts-ai.com,https://app.shifts-ai.store';

jest.mock('axios');
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('./helpers/fakeDb').getFakeDb();
const { surfaceOf, homeSurface } = require('../src/config/surfaces');
const app = require('../src/app');

let nonce = 0;
const as = (userId) => ({ Authorization: `Bearer ${jwt.sign({ id: userId, n: (nonce += 1) }, process.env.JWT_SECRET)}` });

const OPERATOR = { Origin: 'https://karambots.com' };
const CUSTOMER = { Origin: 'https://app.shifts-ai.com' };

let HASH;
beforeAll(async () => { HASH = await bcrypt.hash('correct-horse-1', 4); });

beforeEach(() => {
  db.reset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  db.seed({
    businesses: [
      { id: 'b_shift', name: 'SHIFT AI & Automation', business_type: 'shift', slug: 'shift' },
      { id: 'b1', name: 'مخبز الريان', business_type: 'generic', slug: 'rayyan' },
    ],
    users: [
      { id: 'u_admin', name: 'معتصم', email: 'ops@shifts-ai.com', role: 'platform_admin', business_id: 'b_shift', password: HASH, active: true },
      { id: 'u_shift_staff', name: 'ريم', email: 'reem@shifts-ai.com', role: 'staff', business_id: 'b_shift', password: HASH, active: true },
      { id: 'u_owner', name: 'أبو خالد', phone: '962791234567', role: 'business_owner', business_id: 'b1', password: HASH, active: true },
    ],
  });
});

const login = (headers, body) => request(app).post('/api/auth/login').set(headers).send(body);
const ADMIN = { login: 'ops@shifts-ai.com', password: 'correct-horse-1' };
const OWNER = { login: '0791234567', password: 'correct-horse-1' };

describe('which door a request came through', () => {
  const req = (headers) => ({ headers });

  test('Origin first, then the forwarded host, then Host; anything else is unknown', () => {
    expect(surfaceOf(req({ origin: 'https://karambots.com' }))).toBe('operator');
    expect(surfaceOf(req({ origin: 'https://www.karambots.com' }))).toBe('operator');
    expect(surfaceOf(req({ origin: 'https://app.shifts-ai.com' }))).toBe('customer');
    expect(surfaceOf(req({ origin: 'https://app.shifts-ai.store' }))).toBe('customer');
    // app.shifts-ai.com reaches Cloud Run through Firebase, which rewrites Host to run.app.
    expect(surfaceOf(req({ host: 'karambot-xyz-ew.a.run.app', 'x-forwarded-host': 'app.shifts-ai.com' }))).toBe('customer');
    expect(surfaceOf(req({ host: 'karambots.com:443' }))).toBe('operator');
    expect(surfaceOf(req({ host: 'karambot-xyz-ew.a.run.app' }))).toBeNull();
    expect(surfaceOf(req({ host: 'localhost:5000', origin: 'http://localhost:5173' }))).toBeNull();
    expect(surfaceOf(req({}))).toBeNull();
  });

  test("SHIFT's admins and SHIFT's own shop team belong to karambots.com, every other shop to the app", () => {
    expect(homeSurface({ role: 'platform_admin', business_type: null })).toBe('operator');
    expect(homeSurface({ role: 'staff', business_type: 'shift' })).toBe('operator');
    expect(homeSurface({ role: 'business_owner', business_type: 'shift' })).toBe('operator');
    expect(homeSurface({ role: 'business_owner', business_type: 'generic' })).toBe('customer');
    expect(homeSurface({ role: 'manager', business_type: 'restaurant' })).toBe('customer');
  });
});

describe('POST /api/auth/login', () => {
  test('SHIFT on karambots.com and a shop on the app sign in as before', async () => {
    const a = await login(OPERATOR, ADMIN);
    expect(a.status).toBe(200);
    expect(a.body.token).toEqual(expect.any(String));
    const o = await login(CUSTOMER, OWNER);
    expect(o.status).toBe(200);
    expect(o.body.user).toMatchObject({ role: 'business_owner', business_id: 'b1' });
  });

  test('the admin on the customers\' door gets no session, only where to go', async () => {
    const res = await login(CUSTOMER, ADMIN);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: expect.stringContaining('karambots.com'), code: 'WRONG_SURFACE', home_url: 'https://karambots.com/login',
    });
    expect(res.body.token).toBeUndefined();
    // Not counted as a sign-in either.
    expect(db.store.users.find((u) => u.id === 'u_admin').last_login).toBeFalsy();
  });

  test("SHIFT's own shop team is sent to karambots.com too", async () => {
    const res = await login(CUSTOMER, { login: 'reem@shifts-ai.com', password: 'correct-horse-1' });
    expect(res.status).toBe(403);
    expect(res.body.home_url).toBe('https://karambots.com/login');
  });

  test('a shop owner on karambots.com is sent to the app', async () => {
    const res = await login(OPERATOR, OWNER);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'WRONG_SURFACE', home_url: 'https://app.shifts-ai.com/login' });
    expect(res.body.error).toContain('app.shifts-ai.com');
    expect(res.body.token).toBeUndefined();
  });

  test('a wrong password on the wrong door says only that the login failed', async () => {
    const res = await login(CUSTOMER, { ...ADMIN, password: 'nope-nope-1' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBeUndefined();
    expect(res.body.home_url).toBeUndefined();
  });

  test('a door that cannot be told apart locks nobody out', async () => {
    expect((await login({ Host: 'karambot-xyz-ew.a.run.app' }, OWNER)).status).toBe(200);
    expect((await login({}, ADMIN)).status).toBe(200);
  });
});

describe('a session on the wrong door', () => {
  test('is answered 403 WRONG_SURFACE with the way home, both ways', async () => {
    const admin = await request(app).get('/api/auth/me').set(as('u_admin')).set({ 'X-Forwarded-Host': 'app.shifts-ai.com' });
    expect(admin.status).toBe(403);
    expect(admin.body).toMatchObject({ code: 'WRONG_SURFACE', home_url: 'https://karambots.com/login' });

    const owner = await request(app).get('/api/auth/me').set(as('u_owner')).set({ Host: 'karambots.com' });
    expect(owner.status).toBe(403);
    expect(owner.body).toMatchObject({ code: 'WRONG_SURFACE', home_url: 'https://app.shifts-ai.com/login' });
  });

  test('on its own door, or an unknown one, it is served', async () => {
    expect((await request(app).get('/api/auth/me').set(as('u_admin')).set({ Host: 'karambots.com' })).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(as('u_owner')).set(CUSTOMER)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(as('u_owner'))).status).toBe(200);
  });

  test("the admin API is not served on the customers' door", async () => {
    const res = await request(app).get('/api/admin/overview').set(as('u_admin')).set(CUSTOMER);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('WRONG_SURFACE');
  });
});

describe('links open on the shop\'s own door', () => {
  const addUser = (shop) => request(app).post(`/api/admin/accounts/${shop}/users`).set(as('u_admin'))
    .send({ name: 'سلمى', phone: '0795550000', role: 'staff' });

  test("a user added to SHIFT's own shop activates on karambots.com", async () => {
    const res = await addUser('b_shift');
    expect(res.status).toBe(201);
    expect(res.body.activation_url).toMatch(/^https:\/\/karambots\.com\/activate#[\w-]{20,}$/);
  });

  test("a user added to a customer shop activates on the app", async () => {
    const res = await addUser('b1');
    expect(res.status).toBe(201);
    expect(res.body.activation_url).toMatch(/^https:\/\/app\.shifts-ai\.com\/activate#[\w-]{20,}$/);
    expect(res.body.activation_url.endsWith(res.body.activation_path)).toBe(true);
  });

  test('a login reset opens on the shop\'s own door', async () => {
    const shift = await request(app).post('/api/admin/accounts/b_shift/users/u_shift_staff/reset').set(as('u_admin'));
    expect(shift.status).toBe(200);
    expect(shift.body.join_url).toMatch(/^https:\/\/karambots\.com\/activate#/);
    const shop = await request(app).post('/api/admin/accounts/b1/users/u_owner/reset').set(as('u_admin'));
    expect(shop.status).toBe(200);
    expect(shop.body.join_url).toMatch(/^https:\/\/app\.shifts-ai\.com\/join#/);
  });

  test('a reissued invite carries its absolute link too', async () => {
    const added = await addUser('b_shift');
    const res = await request(app).post(`/api/admin/accounts/b_shift/users/${added.body.user.id}/invite`).set(as('u_admin'));
    expect(res.status).toBe(200);
    expect(res.body.activation_url).toMatch(/^https:\/\/karambots\.com\/activate#/);
  });

  test("SHIFT's own team invites from «الفريق» open on karambots.com", async () => {
    db.seed({ users: [{ id: 'u_shift_owner', name: 'SHIFT', email: 'owner@shifts-ai.com', role: 'business_owner', business_id: 'b_shift', password: HASH, active: true }] });
    const res = await request(app).post('/api/team/invite').set(as('u_shift_owner'))
      .send({ name: 'ليلى', phone: '0795551234', role: 'staff' });
    expect(res.status).toBe(201);
    expect(res.body.join_url).toMatch(/^https:\/\/karambots\.com\/activate#/);
  });
});

describe("the admin in SHIFT's own shop panel", () => {
  test('a shop page with no businessId opens the admin\'s own shop', async () => {
    const res = await request(app).get('/api/team').set(as('u_admin')).set(OPERATOR);
    expect(res.status).toBe(200);
    expect(res.body.members.map((m) => m.id)).toEqual(expect.arrayContaining(['u_shift_staff']));
    expect(res.body.members.map((m) => m.id)).not.toContain('u_owner');
  });

  test('an owner-only action is open to the admin, in its own shop', async () => {
    const res = await request(app).post('/api/team/invite').set(as('u_admin')).set(OPERATOR)
      .send({ name: 'ليلى', phone: '0795551234', role: 'staff' });
    expect(res.status).toBe(201);
    expect(db.store.users.find((u) => u.phone === '962795551234')).toMatchObject({ business_id: 'b_shift' });
  });

  test('an admin with no shop still has to name one', async () => {
    db.store.users.find((u) => u.id === 'u_admin').business_id = null;
    const res = await request(app).get('/api/team').set(as('u_admin')).set(OPERATOR);
    expect(res.status).toBe(400);
  });
});

