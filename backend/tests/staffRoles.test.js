/**
 * A tenant may manage its own people and nothing above them.
 *
 * PATCH /api/staff/:id took `role` straight from the body, so a business_owner could set
 * their own row to platform_admin and reach every other customer's account — one request
 * from tenant to platform. That predates the handover work and was found reviewing it.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  user: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  userActivation: { updateMany: jest.fn() },
  $transaction: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const app = require('../src/app');

const OWNER = { id: 'owner1', name: 'O', email: 'o@clinic.jo', role: 'business_owner', business_id: 'b1', active: true };
const ADMIN = { id: 'admin1', name: 'A', email: 'a@shifts-ai.com', role: 'platform_admin', business_id: null, active: true };
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: 'x' }, process.env.JWT_SECRET)}` });

let tx;
beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findFirst.mockResolvedValue({ id: 'target', business_id: 'b1' });
  tx = { user: { update: jest.fn().mockResolvedValue({ id: 'target' }) }, userActivation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
  prisma.$transaction.mockImplementation((fn) => fn(tx));
});

test('a business owner cannot promote anyone to platform_admin', async () => {
  prisma.user.findUnique.mockResolvedValue(OWNER);

  const res = await request(app).patch('/api/staff/target').set(auth())
    .send({ role: 'platform_admin' });

  expect(res.status).toBe(403);
  expect(tx.user.update).not.toHaveBeenCalled();
});

test('a business owner cannot promote THEMSELVES', async () => {
  prisma.user.findUnique.mockResolvedValue(OWNER);
  prisma.user.findFirst.mockResolvedValue({ id: 'owner1', business_id: 'b1' });

  const res = await request(app).patch('/api/staff/owner1').set(auth())
    .send({ role: 'platform_admin' });

  expect(res.status).toBe(403);
});

test('a business owner can still manage their own roles', async () => {
  prisma.user.findUnique.mockResolvedValue(OWNER);
  const res = await request(app).patch('/api/staff/target').set(auth()).send({ role: 'manager' });
  expect(res.status).toBe(200);
  expect(tx.user.update.mock.calls[0][0].data.role).toBe('manager');
});

test('a platform_admin may still grant platform_admin', async () => {
  prisma.user.findUnique.mockResolvedValue(ADMIN);
  const res = await request(app).patch('/api/staff/target?businessId=b1').set(auth())
    .send({ role: 'platform_admin' });
  expect(res.status).toBe(200);
});

test('disabling a login also kills any invitation still in flight', async () => {
  // Otherwise whoever holds the link redeems it later and comes back in with active:true —
  // the lockout undone by the person being locked out.
  prisma.user.findUnique.mockResolvedValue(OWNER);

  const res = await request(app).patch('/api/staff/target').set(auth()).send({ active: false });

  expect(res.status).toBe(200);
  expect(tx.userActivation.updateMany.mock.calls[0][0].where).toMatchObject({
    user_id: 'target', used_at: null,
  });
});

test('enabling a login does not touch invitations', async () => {
  prisma.user.findUnique.mockResolvedValue(OWNER);
  await request(app).patch('/api/staff/target').set(auth()).send({ active: true });
  expect(tx.userActivation.updateMany).not.toHaveBeenCalled();
});
