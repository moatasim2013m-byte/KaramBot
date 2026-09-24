/**
 * A password change ends the sessions that predate it — but not the one it just created.
 *
 * JWT `iat` is whole seconds, truncated. sessions_valid_from keeps milliseconds and is stamped
 * in the same second, just before the new token is signed. Compared naively, the token a
 * customer receives on activation reads as OLDER than their own password change, and every
 * request after it answers 401. That shipped, and this file is why it cannot ship again.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({ user: { findUnique: jest.fn() }, business: { findUnique: jest.fn() } }));

const jwt = require('jsonwebtoken');
const prisma = require('../src/config/prisma');
const { authenticate } = require('../src/middleware/auth');

const CHANGED_AT = new Date('2026-09-24T10:00:00.750Z');
const changedSecond = Math.floor(CHANGED_AT.getTime() / 1000);

function runAuth(iatSeconds) {
  const token = jwt.sign({ id: 'u1', iat: iatSeconds }, process.env.JWT_SECRET);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = { statusCode: null, status(c) { this.statusCode = c; return this; }, json() { return this; } };
  let nexted = false;
  return authenticate(req, res, () => { nexted = true; }).then(() => ({ res, nexted }));
}

beforeEach(() => {
  prisma.user.findUnique.mockResolvedValue({
    id: 'u1', role: 'business_owner', business_id: 'b1', active: true, sessions_valid_from: CHANGED_AT,
  });
  prisma.business.findUnique.mockResolvedValue({ business_type: 'clinic' });
});

test('the token issued in the same second as the change is honoured', async () => {
  const { nexted } = await runAuth(changedSecond);   // 10:00:00 vs 10:00:00.750
  expect(nexted).toBe(true);
});

test('a token from before the change is refused', async () => {
  const { res, nexted } = await runAuth(changedSecond - 60);
  expect(nexted).toBe(false);
  expect(res.statusCode).toBe(401);
});

test('a token from the second before the change is refused too', async () => {
  const { nexted } = await runAuth(changedSecond - 1);   // 09:59:59.999 at most — still earlier
  expect(nexted).toBe(false);
});

test('a token issued after the change is honoured', async () => {
  const { nexted } = await runAuth(changedSecond + 5);
  expect(nexted).toBe(true);
});

test('a user with no recorded change is never affected', async () => {
  prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'staff', business_id: 'b1', active: true, sessions_valid_from: null });
  const { nexted } = await runAuth(changedSecond - 100000);
  expect(nexted).toBe(true);
});
