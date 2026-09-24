/**
 * Handover: an admin creates the customer's login, the customer sets their own password.
 *
 * What these tests defend is mostly what must NOT happen — a link that works twice, outlives
 * its welcome, reveals which accounts exist, or attaches a user to the wrong business.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  user: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  business: { findUnique: jest.fn() },
  userActivation: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  adminAccessLog: { create: jest.fn() },
  $transaction: jest.fn(),
}));

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const activation = require('../src/services/activation');
const app = require('../src/app');

const ADMIN = { id: 'admin1', name: 'A', email: 'a@shifts-ai.com', role: 'platform_admin', business_id: null, active: true };
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: 'admin1' }, process.env.JWT_SECRET)}` });
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

// findUnique serves two callers — authenticate() looks up by id, the route checks an email —
// so the mock answers by ARGUMENT. Ordered mocks leaked between tests whenever a route
// returned early and left a queued value unconsumed.
let signedInAs = ADMIN;
let emailTakenBy = null;
let tx;

beforeEach(() => {
  jest.clearAllMocks();
  signedInAs = ADMIN;
  emailTakenBy = null;
  prisma.user.findUnique.mockImplementation(({ where }) =>
    Promise.resolve(where?.email !== undefined ? emailTakenBy : signedInAs));
  prisma.userActivation.updateMany.mockResolvedValue({ count: 0 });
  prisma.userActivation.create.mockResolvedValue({ id: 'act1' });
  prisma.adminAccessLog.create.mockResolvedValue({ id: 'log1' });
  // issue() writes both statements in one transaction, so the spies live here where a test
  // can inspect what was actually persisted.
  tx = {
    userActivation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({}) },
    user: { update: jest.fn() },
  };
  prisma.$transaction.mockImplementation((fn) => fn(tx));
});

describe('creating a customer login', () => {
  beforeEach(() => {
    prisma.business.findUnique.mockResolvedValue({ id: 'b1', name: 'عيادة النور' });
    prisma.user.create.mockImplementation(({ data }) => Promise.resolve({ id: 'u9', ...data }));
  });

  test('the business comes from the URL, never the body', async () => {
    const res = await request(app).post('/api/admin/accounts/b1/users').set(auth())
      .send({ name: 'د. أحمد', email: 'ahmad@clinic.jo', business_id: 'SOMEONE_ELSE' });

    expect(res.status).toBe(201);
    expect(prisma.user.create.mock.calls[0][0].data.business_id).toBe('b1');
  });

  test('the new account starts inactive, with a password nobody knows', async () => {
    await request(app).post('/api/admin/accounts/b1/users').set(auth())
      .send({ name: 'د. أحمد', email: 'ahmad@clinic.jo' });

    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.active).toBe(false);
    expect(data.role).toBe('business_owner');
    expect(data.password).toMatch(/^\$2[aby]\$/);   // a real bcrypt hash of random bytes
  });

  test('a platform_admin cannot be minted from an account screen', async () => {
    const res = await request(app).post('/api/admin/accounts/b1/users').set(auth())
      .send({ name: 'x', email: 'x@y.jo', role: 'platform_admin' });
    expect(res.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test('a duplicate email is refused rather than hijacking the existing user', async () => {
    emailTakenBy = { id: 'existing' };
    const res = await request(app).post('/api/admin/accounts/b1/users').set(auth())
      .send({ name: 'x', email: 'taken@y.jo' });
    expect(res.status).toBe(409);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test('the response carries a link, and the listing never carries a token', async () => {
    const res = await request(app).post('/api/admin/accounts/b1/users').set(auth())
      .send({ name: 'د. أحمد', email: 'ahmad@clinic.jo' });

    expect(res.body.activation_path).toMatch(/^\/activate#[\w-]{20,}$/);
    // Only the hash is persisted, never the token itself.
    const stored = tx.userActivation.create.mock.calls[0][0].data.token_hash;
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.activation_path).not.toContain(stored);
  });

  test('a business user cannot create logins for anyone', async () => {
    signedInAs = { ...ADMIN, role: 'business_owner', business_id: 'b1' };
    const res = await request(app).post('/api/admin/accounts/b1/users').set(auth()).send({ name: 'x', email: 'x@y.jo' });
    expect(res.status).toBe(403);
  });
});

describe('issuing a link', () => {
  test('an earlier unused invitation is retired, so only one key is live', async () => {
    const tx = {
      userActivation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((fn) => fn(tx));
    await activation.issue('u9', 'admin1');
    expect(tx.userActivation.updateMany.mock.calls[0][0].where).toMatchObject({ user_id: 'u9', used_at: null });
  });

  test('revoking kills every outstanding link for a user', async () => {
    prisma.userActivation.updateMany.mockResolvedValue({ count: 2 });
    const killed = await activation.revoke('u9');
    expect(killed).toBe(2);
    expect(prisma.userActivation.updateMany.mock.calls[0][0]).toMatchObject({
      where: { user_id: 'u9', used_at: null },
    });
  });
});

describe('redeeming a link', () => {
  const future = () => new Date(Date.now() + 3600 * 1000);
  const user = { id: 'u9', name: 'د. أحمد', email: 'ahmad@clinic.jo', active: false, business_id: 'b1' };

  test('a valid link reveals only who it is for', async () => {
    prisma.userActivation.findUnique.mockResolvedValue({ id: 'act1', user_id: 'u9', used_at: null, expires_at: future(), user });
    const res = await request(app).post('/api/auth/activate/lookup').send({ token: 'sometoken' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'د. أحمد', email: 'ahmad@clinic.jo', expires_at: expect.any(String) });
  });

  test('an unknown link answers exactly like a used one', async () => {
    prisma.userActivation.findUnique.mockResolvedValue(null);
    const unknown = await request(app).post('/api/auth/activate/lookup').send({ token: 'nope' });

    prisma.userActivation.findUnique.mockResolvedValue({ id: 'act1', user_id: 'u9', used_at: new Date(), expires_at: future(), user });
    const used = await request(app).post('/api/auth/activate/lookup').send({ token: 'used' });

    expect(unknown.status).toBe(used.status);
    expect(unknown.body).toEqual(used.body);   // nothing distinguishes them
  });

  test('an expired link is refused', async () => {
    prisma.userActivation.findUnique.mockResolvedValue({
      id: 'act1', user_id: 'u9', used_at: null, expires_at: new Date(Date.now() - 1000), user,
    });
    const res = await request(app).post('/api/auth/activate/lookup').send({ token: 'old' });
    expect(res.status).toBe(404);
  });

  test('setting a password spends the link and signs the customer in', async () => {
    prisma.userActivation.findUnique.mockResolvedValue({ id: 'act1', user_id: 'u9', used_at: null, expires_at: future(), user });
    const tx = {
      userActivation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: { update: jest.fn().mockResolvedValue(user) },
    };
    prisma.$transaction.mockImplementation((fn) => fn(tx));

    const res = await request(app).post('/api/auth/activate').send({ token: 'good', password: 'a-long-enough-one' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();                       // signed in immediately
    const written = tx.user.update.mock.calls[0][0].data;
    expect(written.active).toBe(true);
    expect(written.password).toMatch(/^\$2[aby]\$/);
    expect(written.last_login).toBeInstanceOf(Date);          // the checklist reads this
    expect(written.sessions_valid_from).toBeInstanceOf(Date); // older sessions die here
  });

  test('the same link cannot be redeemed twice, even in a race', async () => {
    prisma.userActivation.findUnique.mockResolvedValue({ id: 'act1', user_id: 'u9', used_at: null, expires_at: future(), user });
    const tx = {
      userActivation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },  // someone else won
      user: { update: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn) => fn(tx));

    const res = await request(app).post('/api/auth/activate').send({ token: 'good', password: 'a-long-enough-one' });

    expect(res.status).toBe(404);
    expect(tx.user.update).not.toHaveBeenCalled();   // no password was set
  });

  test('a short password is refused before the token is spent', async () => {
    const res = await request(app).post('/api/auth/activate').send({ token: 'good', password: 'short' });
    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('what the security review found — regression guards', () => {
  test('the link carries its token in the fragment, so no server logs it', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 'b1', name: 'عيادة النور' });
    prisma.user.create.mockImplementation(({ data }) => Promise.resolve({ id: 'u9', ...data }));

    const res = await request(app).post('/api/admin/accounts/b1/users').set(auth())
      .send({ name: 'د. أحمد', email: 'ahmad@clinic.jo' });

    // A path segment is written verbatim by morgan and by Cloud Run's request log; a fragment
    // is never transmitted at all.
    expect(res.body.activation_path.startsWith('/activate#')).toBe(true);
    expect(res.body.activation_path).not.toMatch(/\/activate\/[^#]/);
  });

  test('staff cannot mint a link for a login the customer already uses', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u9', name: 'د. أحمد', email: 'a@b.jo', role: 'business_owner',
      active: true, last_login: new Date(),     // the customer holds this account
    });

    const res = await request(app).post('/api/admin/accounts/b1/users/u9/invite').set(auth());

    expect(res.status).toBe(409);
    expect(prisma.userActivation.create).not.toHaveBeenCalled();
  });

  test('a login that was never used can still be re-invited, and the issuance is recorded', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u9', name: 'د. أحمد', email: 'a@b.jo', role: 'business_owner',
      active: false, last_login: null,
    });
    const res = await request(app).post('/api/admin/accounts/b1/users/u9/invite').set(auth());

    expect(res.status).toBe(200);
    expect(prisma.adminAccessLog.create.mock.calls[0][0].data.action).toBe('user_invite');
  });
});
