/**
 * «المعرفة» on SHIFT's customer page: a platform_admin edits a shop's knowledge, menu and clinic
 * services by naming the shop (?businessId=), through the same routes the owner uses
 * (middleware/auth.attachBusinessId). Without a named shop the request is refused rather than run
 * unscoped; an owner's ?businessId= is ignored. SHIFT's knowledge edits read as SHIFT's in the log.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  user: { findUnique: jest.fn() },
  business: { findUnique: jest.fn() },
  businessKnowledge: { count: jest.fn(), create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
  category: { create: jest.fn(), findMany: jest.fn() },
  menuItem: { findFirst: jest.fn(), update: jest.fn() },
  service: { findMany: jest.fn(), create: jest.fn() },
  accountEvent: { create: jest.fn() },
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const app = require('../src/app');

const ADMIN = { id: 'admin1', name: 'م', email: 'a@shifts-ai.com', role: 'platform_admin', business_id: null, active: true };
const OWNER = { id: 'owner1', name: 'أبو خالد', role: 'business_owner', business_id: 'b1', active: true };
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: 'x' }, process.env.JWT_SECRET)}` });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(ADMIN);
  prisma.business.findUnique.mockResolvedValue({ business_type: 'generic' });
  prisma.businessKnowledge.count.mockResolvedValue(0);
  prisma.businessKnowledge.create.mockImplementation(({ data }) => Promise.resolve({ id: 'k1', ...data }));
  prisma.category.create.mockImplementation(({ data }) => Promise.resolve({ id: 'cat1', ...data }));
  prisma.service.findMany.mockResolvedValue([]);
  prisma.accountEvent.create.mockImplementation(({ data }) => Promise.resolve({ id: 'e1', ...data }));
});

test('SHIFT adds knowledge to the shop it names, logged as SHIFT\'s', async () => {
  const res = await request(app).post('/api/knowledge?businessId=b7').set(auth()).send({ kind: 'hours', content: 'من 9 للـ 11', business_id: 'OTHER' });
  expect(res.status).toBe(201);
  expect(prisma.businessKnowledge.create.mock.calls[0][0].data.business_id).toBe('b7');
  expect(prisma.accountEvent.create.mock.calls[0][0].data).toMatchObject({
    business_id: 'b7', actor_kind: 'shift', actor_user_id: 'admin1', type: 'knowledge_added', data: { kind: 'hours' },
  });
  expect(require('../src/config/eventLabels').eventText({ type: 'knowledge_added', data: { kind: 'hours' } })).toBe('أضاف معلومة: الدوام');
});

test('SHIFT edits the menu and reads the services of the shop it names', async () => {
  await request(app).post('/api/menu/categories?businessId=b7').set(auth()).send({ name_ar: 'مشاوي', business_id: 'OTHER' });
  expect(prisma.category.create.mock.calls[0][0].data.business_id).toBe('b7');
  await request(app).get('/api/clinic/services?businessId=b8').set(auth());
  expect(prisma.service.findMany.mock.calls[0][0].where).toEqual({ business_id: 'b8' });
});

test('without a named shop SHIFT is refused, never served every shop', async () => {
  const res = await request(app).get('/api/clinic/services').set(auth());
  expect(res.status).toBe(400);
  expect(prisma.service.findMany).not.toHaveBeenCalled();
});

test('an owner\'s ?businessId= is ignored: their own shop, logged as the owner', async () => {
  prisma.user.findUnique.mockResolvedValue(OWNER);
  await request(app).post('/api/knowledge?businessId=b7').set(auth()).send({ kind: 'fact', content: 'عندنا توصيل' });
  expect(prisma.businessKnowledge.create.mock.calls[0][0].data.business_id).toBe('b1');
  expect(prisma.accountEvent.create.mock.calls[0][0].data).toMatchObject({ business_id: 'b1', actor_kind: 'owner' });
});

describe('every change to what the bot quotes is in the shop\'s «السجل», with who made it', () => {
  const { eventText } = require('../src/config/eventLabels');
  const logged = () => prisma.accountEvent.create.mock.calls.map(([a]) => a.data);

  test('SHIFT edits and removes knowledge', async () => {
    prisma.businessKnowledge.findFirst.mockResolvedValue({ id: 'k1', kind: 'hours' });
    prisma.businessKnowledge.update.mockImplementation(({ data }) => Promise.resolve({ id: 'k1', kind: 'hours', ...data }));
    prisma.businessKnowledge.delete.mockResolvedValue({});
    expect((await request(app).patch('/api/knowledge/k1?businessId=b7').set(auth()).send({ content: 'من 10 للـ 12' })).status).toBe(200);
    expect((await request(app).delete('/api/knowledge/k1?businessId=b7').set(auth())).status).toBe(200);
    expect(logged()).toEqual([
      expect.objectContaining({ business_id: 'b7', actor_kind: 'shift', actor_user_id: 'admin1', type: 'knowledge_updated', data: { knowledge_id: 'k1', kind: 'hours', changed: ['content'] } }),
      expect.objectContaining({ business_id: 'b7', actor_kind: 'shift', type: 'knowledge_removed', data: { knowledge_id: 'k1', kind: 'hours' } }),
    ]);
    expect(eventText(logged()[0])).toBe('عدّل معلومة: الدوام');
    expect(eventText(logged()[1])).toBe('حذف معلومة: الدوام');
  });

  test('a menu price SHIFT changes reads in Arabic, with the item and the new price', async () => {
    prisma.menuItem.findFirst.mockResolvedValue({ id: 'i1', business_id: 'b7' });
    prisma.menuItem.update.mockImplementation(({ data }) => Promise.resolve({ id: 'i1', name_ar: 'شاورما', ...data }));
    const res = await request(app).patch('/api/menu/items/i1?businessId=b7').set(auth()).send({ price: 3.5 });
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ name_ar: 'شاورما' });
    const [ev] = logged();
    expect(ev).toMatchObject({
      business_id: 'b7', actor_kind: 'shift', actor_user_id: 'admin1', type: 'menu_changed',
      data: { what: 'items', action: 'updated', id: 'i1', name: 'شاورما', price: 3.5 },
    });
    expect(eventText(ev)).toBe('عدّل صنف «شاورما» في القائمة');
  });

  test('a menu category added, and a clinic service; a refused write logs nothing', async () => {
    await request(app).post('/api/menu/categories?businessId=b7').set(auth()).send({ name_ar: 'مشاوي' });
    expect(logged()[0]).toMatchObject({ type: 'menu_changed', data: { what: 'categories', action: 'added', name: 'مشاوي' } });
    prisma.menuItem.findFirst.mockResolvedValue(null);
    expect((await request(app).patch('/api/menu/items/nope?businessId=b7').set(auth()).send({ price: 1 })).status).toBe(404);
    expect(logged()).toHaveLength(1);
    expect(eventText({ type: 'clinic_changed', data: { what: 'services', action: 'removed' } })).toBe('حذف خدمة في خدمات العيادة');
  });

  test('a clinic\'s appointments are bookings, not catalogue: not logged as clinic_changed', async () => {
    const { recordCatalogChange } = require('../src/middleware/recordCatalogChange');
    const mw = recordCatalogChange('clinic_changed', { skip: (r) => r.path.startsWith('/appointments') });
    const json = jest.fn();
    const res = { statusCode: 201, json };
    const next = jest.fn();
    mw({ method: 'POST', path: '/appointments', businessId: 'b7', user: ADMIN }, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.json).toBe(json);
  });
});
