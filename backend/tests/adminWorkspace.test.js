/**
 * The inspection hatch is an exception, so it has to stay accountable:
 * read-only, and never readable without a record of who read it.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  business: { findUnique: jest.fn(), findMany: jest.fn() },
  conversation: { findMany: jest.fn(), findFirst: jest.fn() },
  message: { findMany: jest.fn() },
  adminAccessLog: { create: jest.fn() },
  user: { findUnique: jest.fn(), findFirst: jest.fn() },
  subscription: { findMany: jest.fn().mockResolvedValue([]) },
  businessKnowledge: { groupBy: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const app = require('../src/app');

const ADMIN = { id: 'u1', name: 'Admin', email: 'admin@shifts-ai.com', role: 'platform_admin', business_id: null, active: true };
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: 'u1' }, process.env.JWT_SECRET)}` });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(ADMIN);
  prisma.business.findUnique.mockResolvedValue({ id: 'b1', name: 'مطعم الشام' });
  prisma.adminAccessLog.create.mockResolvedValue({ id: 'log1' });
  prisma.conversation.findMany.mockResolvedValue([]);
});

test('reading a customer\'s conversations records who read them', async () => {
  const res = await request(app).get('/api/admin/accounts/b1/conversations').set(auth());

  expect(res.status).toBe(200);
  expect(res.body.read_only).toBe(true);
  const logged = prisma.adminAccessLog.create.mock.calls[0][0].data;
  expect(logged).toMatchObject({
    admin_user_id: 'u1', admin_email: 'admin@shifts-ai.com',
    business_id: 'b1', action: 'workspace_list',
  });
});

test('opening a thread records the conversation too', async () => {
  prisma.conversation.findFirst.mockResolvedValue({ id: 'c1', customer_wa_id: '9627', profile_name: 'أحمد' });
  prisma.message.findMany.mockResolvedValue([
    { id: 'm1', direction: 'outbound', text_body: 'أهلاً', is_ai_generated: true, created_at: new Date() },
  ]);

  const res = await request(app).get('/api/admin/accounts/b1/conversations/c1').set(auth());

  expect(res.status).toBe(200);
  const logged = prisma.adminAccessLog.create.mock.calls[0][0].data;
  expect(logged.action).toBe('workspace_thread');
  expect(logged.conversation_id).toBe('c1');
  // Who wrote it is the point of looking.
  expect(res.body.messages[0].is_ai_generated).toBe(true);
});

test('if the access cannot be recorded, the conversations are not returned', async () => {
  prisma.adminAccessLog.create.mockRejectedValue(new Error('db down'));

  const res = await request(app).get('/api/admin/accounts/b1/conversations').set(auth());

  expect(res.status).toBe(500);
  expect(res.body.conversations).toBeUndefined();
  expect(prisma.conversation.findMany).not.toHaveBeenCalled();
});

test('a business user cannot reach the inspection routes at all', async () => {
  prisma.user.findUnique.mockResolvedValue({ ...ADMIN, role: 'business_owner', business_id: 'b1' });
  const res = await request(app).get('/api/admin/accounts/b1/conversations').set(auth());
  expect(res.status).toBe(403);
  expect(prisma.adminAccessLog.create).not.toHaveBeenCalled();
});

test('a thread from another business is not reachable by id alone', async () => {
  prisma.conversation.findFirst.mockResolvedValue(null); // scoped by business_id in the query
  const res = await request(app).get('/api/admin/accounts/b1/conversations/other').set(auth());
  expect(res.status).toBe(404);
});

test('the inspection routes offer no way to write', async () => {
  for (const [method, path] of [
    ['post', '/api/admin/accounts/b1/conversations/c1/send'],
    ['post', '/api/admin/accounts/b1/conversations/c1/takeover'],
    ['patch', '/api/admin/accounts/b1/conversations/c1'],
  ]) {
    const res = await request(app)[method](path).set(auth()).send({ text: 'hi' });
    expect(res.status).toBe(404);
  }
});
