/**
 * Making logins under Migration 2 (phone login): an owner with only a mobile, an email-only login
 * as before, and neither email nor mobile ever shared by two people, whichever route made them.
 * Activation for a phone-only owner shows the number masked and ends in a login by mobile.
 *
 * Signing in itself is in phoneLogin.test.js (split for the /api/auth rate limiter).
 */
require('./setup');

jest.mock('axios');
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('./helpers/fakeDb').getFakeDb();
const app = require('../src/app');

let nonce = 0;
const as = (userId) => ({ Authorization: `Bearer ${jwt.sign({ id: userId, n: (nonce += 1) }, process.env.JWT_SECRET)}` });

let HASH;
beforeAll(async () => { HASH = await bcrypt.hash('correct-horse-1', 4); });

beforeEach(() => {
  db.reset();
  db.seed({
    businesses: [{ id: 'b1', name: 'مخبز الريان', business_type: 'generic', slug: 'rayyan' }],
    users: [
      { id: 'u_admin', name: 'SHIFT', email: 'ops@shifts-ai.com', role: 'platform_admin', password: HASH },
      { id: 'u_owner', name: 'أبو خالد', email: null, phone: '962791234567', role: 'business_owner', business_id: 'b1', password: HASH },
      { id: 'u_staff', name: 'سارة', email: 'Sara@Rayyan.jo', role: 'staff', business_id: 'b1', password: HASH },
    ],
  });
});

const login = (body) => request(app).post('/api/auth/login').send(body);

describe('POST /api/admin/accounts/:id/users', () => {
  const create = (body) => request(app).post('/api/admin/accounts/b1/users').set(as('u_admin')).send(body);

  test('an owner can be made with only a mobile, stored normalized', async () => {
    const res = await create({ name: 'أم علي', phone: '078 123 4567' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: null, phone: '962781234567' });
    expect(db.store.users.find((u) => u.id === res.body.user.id).active).toBe(false);
  });

  test('an email-only login still works as before', async () => {
    const res = await create({ name: 'Ahmad', email: 'Ahmad@Clinic.jo' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'ahmad@clinic.jo', phone: null });
  });

  test('neither one is refused, and so is a mobile that is not one', async () => {
    expect((await create({ name: 'x' })).status).toBe(400);
    expect((await create({ name: 'x', phone: '06 461 2345' })).status).toBe(400);
    expect((await create({ name: 'x', email: 'not-an-email' })).status).toBe(400);
  });

  test('a mobile that already signs someone in is refused, however it is typed', async () => {
    const res = await create({ name: 'x', phone: '+962 79 123 4567' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('رقم الموبايل هذا مستخدم لحساب آخر');
  });

  test('a taken email is still refused', async () => {
    const res = await create({ name: 'x', email: 'ops@shifts-ai.com' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('هذا البريد مستخدم مسبقًا');
  });
});

describe('POST /api/auth/register', () => {
  const register = (userId, body) => request(app).post('/api/auth/register').set(as(userId)).send(body);

  test('a staff login can be made with a mobile and no email', async () => {
    const res = await register('u_admin', {
      name: 'Ali', phone: '0771234567', password: 'long-password-1', role: 'staff', business_id: 'b1',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: null, phone: '962771234567' });
  });

  test('a duplicate mobile or email is a 409, not a Prisma error', async () => {
    const byPhone = await register('u_admin', { name: 'x', phone: '0791234567', password: 'long-password-1', business_id: 'b1' });
    expect(byPhone.status).toBe(409);
    const byEmail = await register('u_admin', { name: 'x', email: 'OPS@shifts-ai.com', password: 'long-password-1', business_id: 'b1' });
    expect(byEmail.status).toBe(409);
  });

  test('neither email nor mobile is refused', async () => {
    expect((await register('u_admin', { name: 'x', password: 'long-password-1', business_id: 'b1' })).status).toBe(400);
  });

  // The owner's staff path is /api/team/invite (seats, «السجل», invite by link). Through here an
  // owner added active staff past the plan's seats with a password they typed themselves.
  test('a shop owner is sent to «الفريق», and no user is made', async () => {
    const before = db.store.users.length;
    const res = await register('u_owner', { name: 'علي', phone: '0771234567', password: 'long-password-1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('أضف أعضاء فريقك من صفحة «الفريق»');
    expect(db.store.users).toHaveLength(before);
  });
});

describe('activation for a phone-only owner', () => {
  const token = 'tok_'.padEnd(40, 'a');
  const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

  beforeEach(() => {
    db.store.users.find((u) => u.id === 'u_owner').active = false;
    db.seed({
      userActivations: [{
        id: 'act1', user_id: 'u_owner', token_hash: sha(token), expires_at: new Date(Date.now() + 3600e3),
        used_at: null, created_by: 'u_admin',
      }],
    });
  });

  test('lookup shows the number masked, never whole', async () => {
    const res = await request(app).post('/api/auth/activate/lookup').send({ token });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: null, phone_masked: '+962 7•• ••• 567' });
    expect(JSON.stringify(res.body)).not.toContain('962791234567');
  });

  test('redeeming signs in, and the new password then works with the mobile', async () => {
    const res = await request(app).post('/api/auth/activate').send({ token, password: 'my-new-password' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 'u_owner', email: null, phone: '962791234567' });
    expect((await login({ login: '0791234567', password: 'my-new-password' })).status).toBe(200);
  });
});

// «غيّر كلمة المرور» in «الإعدادات › حسابي»: an owner no longer asks SHIFT for a reset link.
describe('POST /api/auth/password', () => {
  const change = (body, userId = 'u_owner') => request(app).post('/api/auth/password').set(as(userId)).send(body);

  test('the current password is checked, the new one is set, and the new token signs in', async () => {
    const res = await change({ current: 'correct-horse-1', next: 'new-password-22' });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    const owner = db.store.users.find((u) => u.id === 'u_owner');
    expect(await bcrypt.compare('new-password-22', owner.password)).toBe(true);
    expect(owner.sessions_valid_from).toBeInstanceOf(Date);

    expect((await login({ login: '0791234567', password: 'new-password-22' })).status).toBe(200);
    expect((await login({ login: '0791234567', password: 'correct-horse-1' })).status).toBe(401);
  });

  test('a wrong current password, a short new one, or no session change nothing', async () => {
    const before = db.store.users.find((u) => u.id === 'u_owner').password;
    const wrong = await change({ current: 'nope', next: 'new-password-22' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe('كلمة المرور الحالية غير صحيحة');
    expect((await change({ current: 'correct-horse-1', next: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/auth/password').send({ current: 'correct-horse-1', next: 'new-password-22' })).status).toBe(401);
    expect(db.store.users.find((u) => u.id === 'u_owner').password).toBe(before);
  });
});
