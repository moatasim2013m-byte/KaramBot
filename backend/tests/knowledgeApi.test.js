/**
 * The knowledge API: an owner edits their own, an admin must name the account, and an id from
 * another tenant is not found — the same scoping rule as every other tenant route.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  user: { findUnique: jest.fn() },
  businessKnowledge: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const app = require('../src/app');

const OWNER = { id: 'u1', name: 'O', email: 'o@x.jo', role: 'business_owner', business_id: 'b1', active: true };
const ADMIN = { id: 'a1', name: 'A', email: 'a@shifts-ai.com', role: 'platform_admin', business_id: null, active: true };
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: 'u1' }, process.env.JWT_SECRET)}` });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(OWNER);
  prisma.businessKnowledge.count.mockResolvedValue(0);
  prisma.businessKnowledge.create.mockImplementation(({ data }) => Promise.resolve({ id: 'k1', ...data }));
  prisma.businessKnowledge.findMany.mockResolvedValue([]);
});

test('an owner writes to their own business, whatever the query asks for', async () => {
  const res = await request(app).post('/api/knowledge?businessId=SOMEONE_ELSE').set(auth())
    .send({ kind: 'hours', content: 'السبت–الخميس 9–9' });

  expect(res.status).toBe(201);
  expect(prisma.businessKnowledge.create.mock.calls[0][0].data.business_id).toBe('b1');
});

test('a platform_admin must name the account', async () => {
  prisma.user.findUnique.mockResolvedValue(ADMIN);
  const res = await request(app).get('/api/knowledge').set(auth());
  expect(res.status).toBe(400);
});

test('a platform_admin editing a named account is scoped to it', async () => {
  prisma.user.findUnique.mockResolvedValue(ADMIN);
  await request(app).post('/api/knowledge?businessId=b7').set(auth()).send({ kind: 'fact', content: 'x' });
  expect(prisma.businessKnowledge.create.mock.calls[0][0].data.business_id).toBe('b7');
});

test('an id belonging to another business is not found', async () => {
  prisma.businessKnowledge.findFirst.mockResolvedValue(null);   // scoped by business_id in the query
  const res = await request(app).patch('/api/knowledge/k-other').set(auth()).send({ content: 'مسروق' });
  expect(res.status).toBe(404);
  expect(prisma.businessKnowledge.update).not.toHaveBeenCalled();
});

test('a question is required for an FAQ, and empty content is refused', async () => {
  let res = await request(app).post('/api/knowledge').set(auth()).send({ kind: 'faq', content: 'جواب بلا سؤال' });
  expect(res.status).toBe(400);
  res = await request(app).post('/api/knowledge').set(auth()).send({ kind: 'fact', content: '   ' });
  expect(res.status).toBe(400);
  expect(prisma.businessKnowledge.create).not.toHaveBeenCalled();
});

test('an unknown kind is refused', async () => {
  const res = await request(app).post('/api/knowledge').set(auth()).send({ kind: 'whatever', content: 'x' });
  expect(res.status).toBe(400);
});

test('the item cap stops a paste loop from growing the prompt forever', async () => {
  prisma.businessKnowledge.count.mockResolvedValue(200);
  const res = await request(app).post('/api/knowledge').set(auth()).send({ kind: 'fact', content: 'x' });
  expect(res.status).toBe(409);
});

test('staff of a business cannot edit its knowledge — owners and managers only', async () => {
  prisma.user.findUnique.mockResolvedValue({ ...OWNER, role: 'staff' });
  const res = await request(app).post('/api/knowledge').set(auth()).send({ kind: 'fact', content: 'x' });
  expect(res.status).toBe(403);
});
