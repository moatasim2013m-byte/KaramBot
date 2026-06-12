/**
 * Ingest API tests — external automations reporting outbound replies.
 */

require('./setup');
process.env.INGEST_API_KEY = 'test_ingest_key';

// ─── Mock: Prisma (in-memory store) ───────────────────────────────────────────
jest.mock('../src/config/prisma', () => {
  const BIZ = {
    id: 'biz_ext_id', name: 'External Biz', slug: 'external-biz',
    business_type: 'restaurant', status: 'active',
    wa_phone_number_id: '33333333333',
    ai_config: { reply_mode: 'external', forward_url: 'https://hook.example.test/x' },
    policies: {},
  };
  const CONV = {
    id: 'conv_ext_id', business_id: 'biz_ext_id',
    customer_wa_id: '971500000003', profile_name: 'Test Customer',
    status: 'open', ai_enabled: true, last_inbound_at: null,
  };

  const messages = [];
  const orders = [];

  return {
    __BIZ: BIZ,
    __CONV: CONV,
    __messages: messages,
    __orders: orders,

    business: {
      findFirst: jest.fn(({ where } = {}) =>
        Promise.resolve(where?.wa_phone_number_id === BIZ.wa_phone_number_id ? BIZ : null),
      ),
    },
    conversation: {
      findFirst: jest.fn(({ where } = {}) =>
        Promise.resolve(
          where?.business_id === CONV.business_id && where?.customer_wa_id === CONV.customer_wa_id
            ? CONV
            : null,
        ),
      ),
      create: jest.fn(({ data } = {}) =>
        Promise.resolve({ id: 'conv_created_id', ...data }),
      ),
      update: jest.fn(({ data } = {}) => Promise.resolve({ ...CONV, ...data })),
    },
    message: {
      create: jest.fn(({ data } = {}) => {
        const msg = { id: `msg_${messages.length + 1}`, ...data };
        messages.push(msg);
        return Promise.resolve(msg);
      }),
      findUnique: jest.fn(() => Promise.resolve(null)),
      updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
    order: {
      create: jest.fn(({ data } = {}) => {
        const order = { id: `order_${orders.length + 1}`, ...data };
        orders.push(order);
        return Promise.resolve(order);
      }),
    },
    $disconnect: jest.fn(() => Promise.resolve()),
  };
});

const request = require('supertest');
const app = require('../src/app');
const mockPrisma = jest.requireMock('../src/config/prisma');

const KEY = 'test_ingest_key';
const PHONE = mockPrisma.__BIZ.wa_phone_number_id;
const CUSTOMER = mockPrisma.__CONV.customer_wa_id;

describe('POST /api/ingest/outbound', () => {
  beforeEach(() => {
    mockPrisma.__messages.length = 0;
    mockPrisma.__orders.length = 0;
  });

  test('rejects requests without the ingest key', async () => {
    const res = await request(app)
      .post('/api/ingest/outbound')
      .send({ phone_number_id: PHONE, to: CUSTOMER, text: 'hi' });
    expect(res.status).toBe(401);
  });

  test('rejects requests with a wrong ingest key', async () => {
    const res = await request(app)
      .post('/api/ingest/outbound')
      .set('x-ingest-key', 'wrong')
      .send({ phone_number_id: PHONE, to: CUSTOMER, text: 'hi' });
    expect(res.status).toBe(401);
  });

  test('requires phone_number_id, to and text', async () => {
    const res = await request(app)
      .post('/api/ingest/outbound')
      .set('x-ingest-key', KEY)
      .send({ phone_number_id: PHONE });
    expect(res.status).toBe(400);
  });

  test('404 for unknown phone_number_id', async () => {
    const res = await request(app)
      .post('/api/ingest/outbound')
      .set('x-ingest-key', KEY)
      .send({ phone_number_id: '999', to: CUSTOMER, text: 'hi' });
    expect(res.status).toBe(404);
  });

  test('records an outbound message on an existing conversation', async () => {
    const res = await request(app)
      .post('/api/ingest/outbound')
      .set('x-ingest-key', KEY)
      .send({ phone_number_id: PHONE, to: CUSTOMER, text: 'أهلاً! شو حابب تطلب؟' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.order_id).toBeNull();

    expect(mockPrisma.__messages).toHaveLength(1);
    const msg = mockPrisma.__messages[0];
    expect(msg.direction).toBe('outbound');
    expect(msg.is_ai_generated).toBe(true);
    expect(msg.conversation_id).toBe(mockPrisma.__CONV.id);
    expect(mockPrisma.__orders).toHaveLength(0);
  });

  test('creates a confirmed order when the reply contains the confirm keyword', async () => {
    const text = 'تمام! طلبك اتأكد: ٢ شاورما دجاج، المجموع ٤ دنانير';
    const res = await request(app)
      .post('/api/ingest/outbound')
      .set('x-ingest-key', KEY)
      .send({ phone_number_id: PHONE, to: CUSTOMER, text });

    expect(res.status).toBe(200);
    expect(res.body.order_id).toBe('order_1');

    expect(mockPrisma.__orders).toHaveLength(1);
    const order = mockPrisma.__orders[0];
    expect(order.status).toBe('confirmed');
    expect(order.notes).toBe(text);
    expect(order.customer_wa_id).toBe(CUSTOMER);
  });
});
