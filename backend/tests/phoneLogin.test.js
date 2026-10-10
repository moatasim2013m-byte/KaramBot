/**
 * Phone login (Migration 2, decisions-2026-10-08.md #3): a shop owner signs in with their mobile,
 * email becomes optional.
 *
 * What these defend: every user who signs in with an email today still does, byte for byte; a
 * mobile typed any of the ways people type it finds the same owner; nobody can learn from the form
 * which numbers have an account; and two people can never share an email or a mobile, whichever
 * route created them.
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
const { parseLogin, normalizeLoginPhone, maskPhone } = require('../src/utils/login');
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

// The routes that create logins, and activation, are in phoneLoginCreate.test.js: /api/auth sits
// behind a 20-per-15-minutes limiter per process, and one file cannot make more calls than that.

describe('what a login names', () => {
  test("'@' means email, anything else is a Jordanian mobile", () => {
    expect(parseLogin(' Ops@Shifts-AI.com ')).toEqual({ kind: 'email', email: 'ops@shifts-ai.com' });
    expect(parseLogin('0791234567')).toEqual({ kind: 'phone', phone: '962791234567' });
    expect(parseLogin('٠٧٩١٢٣٤٥٦٧')).toEqual({ kind: 'phone', phone: '962791234567' });
    expect(parseLogin('+962 79 123 4567')).toEqual({ kind: 'phone', phone: '962791234567' });
    expect(parseLogin('hello')).toBeNull();
    expect(parseLogin('')).toBeNull();
  });

  test('only a mobile is a login: a landline would be an account nobody can reach', () => {
    expect(normalizeLoginPhone('064612345')).toBeNull();
    expect(normalizeLoginPhone('00962781234567')).toBe('962781234567');
  });

  test('the masked number shows only its last three digits', () => {
    expect(maskPhone('962791234567')).toBe('+962 7•• ••• 567');
    expect(maskPhone(null)).toBeNull();
  });
});

describe('POST /api/auth/login', () => {
  test('the old {email, password} body still signs in, so an open tab survives the deploy', async () => {
    const res = await login({ email: 'ops@shifts-ai.com', password: 'correct-horse-1' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 'u_admin', email: 'ops@shifts-ai.com', phone: null });
    expect(jwt.verify(res.body.token, process.env.JWT_SECRET).id).toBe('u_admin');
  });

  test('an email stored with capitals is found as typed and lower-cased', async () => {
    expect((await login({ login: 'Sara@Rayyan.jo', password: 'correct-horse-1' })).status).toBe(200);
    // Lower-cased is how every new email is stored, so the form need not remember the capitals.
    db.store.users.find((u) => u.id === 'u_staff').email = 'sara@rayyan.jo';
    expect((await login({ login: 'SARA@rayyan.jo', password: 'correct-horse-1' })).status).toBe(200);
  });

  test.each(['0791234567', '+962791234567', '00962 79 123 4567', '٠٧٩١٢٣٤٥٦٧'])(
    'an owner with no email signs in with the mobile typed as %s',
    async (typed) => {
      const res = await login({ login: typed, password: 'correct-horse-1' });
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({
        id: 'u_owner', email: null, phone: '962791234567', role: 'business_owner', business_name: 'مخبز الريان',
      });
    },
  );

  test('`login` wins over `email` when a client sends both', async () => {
    const res = await login({ login: '0791234567', email: 'ops@shifts-ai.com', password: 'correct-horse-1' });
    expect(res.body.user.id).toBe('u_owner');
  });

  test('an unknown number and a wrong password answer the same Arabic sentence', async () => {
    const unknown = await login({ login: '0799999999', password: 'correct-horse-1' });
    const wrong = await login({ login: '0791234567', password: 'nope-nope-nope' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error).toBe(wrong.body.error);
    expect(unknown.body.error).toMatch(/[؀-ۿ]/);
  });

  test('a phone login never matches a user by NULL email, nor an email login a NULL phone', async () => {
    // The fake throws, as Prisma does, if a unique where carries null: this proves no path asks.
    expect((await login({ login: 'garbage', password: 'correct-horse-1' })).status).toBe(401);
    expect((await login({ login: '@', password: 'correct-horse-1' })).status).toBe(401);
  });

  test('missing fields are refused in Arabic', async () => {
    const res = await login({ password: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[؀-ۿ]/);
  });

  test('an inactive owner is told so only after the right password', async () => {
    db.store.users.find((u) => u.id === 'u_owner').active = false;
    expect((await login({ login: '0791234567', password: 'wrong-wrong-1' })).status).toBe(401);
    expect((await login({ login: '0791234567', password: 'correct-horse-1' })).status).toBe(403);
  });
});

describe('GET /api/auth/me', () => {
  test('a phone-only owner gets their phone and a null email, not an error', async () => {
    const res = await request(app).get('/api/auth/me').set(as('u_owner'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'u_owner', email: null, phone: '962791234567' });
  });
});
