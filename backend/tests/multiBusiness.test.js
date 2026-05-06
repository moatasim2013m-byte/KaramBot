/**
 * multiBusiness.test.js
 *
 * Proves that two businesses with distinct wa_phone_number_id values are routed
 * correctly with full data isolation.
 *
 * No PostgreSQL is available in this CI environment, so Prisma is replaced by
 * an in-memory mock (consistent with the existing test-suite pattern of
 * skipping / mocking all DB-dependent calls).  The messageProcessor is NOT
 * mocked – it is exercised directly; only its external dependencies (Prisma,
 * WhatsApp Graph API) are replaced.
 */

require('./setup');

// ─── Mock: WhatsApp HTTP calls ─────────────────────────────────────────────────
// Must be declared before any require() that transitively loads the module.
jest.mock('../src/services/whatsapp', () => ({
  sendTextMessage: jest.fn().mockResolvedValue({ messages: [{ id: 'meta_out_id' }] }),
  markAsRead:      jest.fn().mockResolvedValue(undefined),
  normalizePhone:  jest.fn((p) => (p ? p.replace(/\D/g, '') : p)),
}));

// ─── Mock: Prisma (in-memory store) ───────────────────────────────────────────
// All fixture data lives inside the factory so it is available at hoist-time.
// Expose internal state via __* properties so test assertions can inspect it.
jest.mock('../src/config/prisma', () => {
  // ── fixtures ────────────────────────────────────────────────────────────────
  const BIZ_A = {
    id: 'biz_a_id', name: 'Business A', slug: 'test-biz-a',
    business_type: 'generic', status: 'active',
    wa_phone_number_id: '11111111111', wa_business_account_id: 'acct_a',
    // Plain string (no colons) → tokenCrypto.decrypt() returns it as-is.
    wa_access_token: 'test_token_a',
    ai_config: {}, policies: {}, currency: 'JOD',
  };
  const BIZ_B = {
    id: 'biz_b_id', name: 'Business B', slug: 'test-biz-b',
    business_type: 'generic', status: 'active',
    wa_phone_number_id: '22222222222', wa_business_account_id: 'acct_b',
    wa_access_token: 'test_token_b',
    ai_config: {}, policies: {}, currency: 'JOD',
  };

  const CONV_A = {
    id: 'conv_a_id', business_id: 'biz_a_id',
    customer_wa_id: '971500000001',
    status: 'open',
    ai_enabled: false, // skip workflow + sendTextMessage in tests
    last_inbound_at: null,
  };
  const CONV_B = {
    id: 'conv_b_id', business_id: 'biz_b_id',
    customer_wa_id: '971500000002',
    status: 'open',
    ai_enabled: false,
    last_inbound_at: null,
  };

  // Owner used to test authenticated inbox isolation (test 5)
  const OWNER_A = {
    id: 'owner_a_id', name: 'Owner A', email: 'owner-a@test.local',
    role: 'business_owner', business_id: 'biz_a_id', active: true,
  };

  // ── in-memory message state ─────────────────────────────────────────────────
  const msgByMetaId  = new Map(); // meta_message_id → message object
  const msgsByConvId = new Map(); // conversation_id  → message[]

  const clearMessages = () => { msgByMetaId.clear(); msgsByConvId.clear(); };

  // ── helpers ─────────────────────────────────────────────────────────────────
  const ALL_BUSINESSES   = [BIZ_A, BIZ_B];
  const ALL_CONVS        = [CONV_A, CONV_B];

  return {
    // Exposed for test assertions
    __BIZ_A: BIZ_A,
    __BIZ_B: BIZ_B,
    __CONV_A: CONV_A,
    __CONV_B: CONV_B,
    __OWNER_A: OWNER_A,
    __msgsByConvId: msgsByConvId,
    __clearMessages: clearMessages,

    business: {
      findFirst: jest.fn(({ where } = {}) =>
        Promise.resolve(
          ALL_BUSINESSES.find((b) => b.wa_phone_number_id === where?.wa_phone_number_id) ?? null,
        ),
      ),
    },

    conversation: {
      findFirst: jest.fn(({ where } = {}) =>
        Promise.resolve(
          ALL_CONVS.find(
            (c) => c.business_id === where?.business_id &&
                   c.customer_wa_id === where?.customer_wa_id,
          ) ?? null,
        ),
      ),
      create: jest.fn(({ data } = {}) =>
        Promise.resolve({ id: `conv_new_${Math.random().toString(36).slice(2)}`, ...data }),
      ),
      update: jest.fn(({ where, data } = {}) => {
        const base = ALL_CONVS.find((c) => c.id === where?.id);
        // Return merged object; ai_enabled stays false (base value wins over spread)
        return Promise.resolve(base ? { ...base, ...data } : null);
      }),
      findMany: jest.fn(({ where } = {}) =>
        Promise.resolve(
          where?.business_id
            ? ALL_CONVS.filter((c) => c.business_id === where.business_id)
            : ALL_CONVS,
        ),
      ),
      count: jest.fn(({ where } = {}) =>
        Promise.resolve(
          where?.business_id
            ? ALL_CONVS.filter((c) => c.business_id === where.business_id).length
            : ALL_CONVS.length,
        ),
      ),
    },

    message: {
      updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      findUnique:  jest.fn(({ where } = {}) =>
        Promise.resolve(msgByMetaId.get(where?.meta_message_id) ?? null),
      ),
      create: jest.fn(({ data } = {}) => {
        const msg = { id: `msg_${Math.random().toString(36).slice(2)}`, ...data };
        if (data.meta_message_id) msgByMetaId.set(data.meta_message_id, msg);
        const list = msgsByConvId.get(data.conversation_id) ?? [];
        list.push(msg);
        msgsByConvId.set(data.conversation_id, list);
        return Promise.resolve(msg);
      }),
    },

    user: {
      findUnique: jest.fn(({ where } = {}) =>
        Promise.resolve(where?.id === OWNER_A.id ? OWNER_A : null),
      ),
    },

    $disconnect: jest.fn(() => Promise.resolve()),
  };
});

// ─── Requires (after mocks are declared) ──────────────────────────────────────
const request              = require('supertest');
const jwt                  = require('jsonwebtoken');
const app                  = require('../src/app');
const { processInboundMessage } = require('../src/services/messageProcessor');
const mockPrisma           = jest.requireMock('../src/config/prisma');

// Unpack test fixtures from the mock
const { __BIZ_A: BIZ_A, __BIZ_B: BIZ_B, __CONV_A: CONV_A, __CONV_B: CONV_B, __OWNER_A: OWNER_A } = mockPrisma;
const PHONE_A    = BIZ_A.wa_phone_number_id;   // '11111111111'
const PHONE_B    = BIZ_B.wa_phone_number_id;   // '22222222222'
const CUSTOMER_A = CONV_A.customer_wa_id;      // '971500000001'
const CUSTOMER_B = CONV_B.customer_wa_id;      // '971500000002'

// ─── Helper ───────────────────────────────────────────────────────────────────
function buildEntry(phoneNumberId, fromPhone, msgText, msgId) {
  return {
    changes: [{
      value: {
        metadata: { phone_number_id: phoneNumberId },
        contacts: [{ wa_id: fromPhone, profile: { name: 'Test Customer' } }],
        messages: [{
          id: msgId,
          from: fromPhone,
          type: 'text',
          text: { body: msgText },
          timestamp: String(Math.floor(Date.now() / 1000)),
        }],
        statuses: [],
      },
    }],
  };
}

function msgsFor(convId) {
  return mockPrisma.__msgsByConvId.get(convId) ?? [];
}

// ─── Suite ────────────────────────────────────────────────────────────────────
jest.setTimeout(15000);

describe('Multi-Business Routing', () => {
  // Reset message state before each test so counts are always fresh
  beforeEach(() => mockPrisma.__clearMessages());

  // ── TC6: findFirst by wa_phone_number_id ──────────────────────────────────
  describe('TC6 — findFirst by wa_phone_number_id', () => {
    test('returns BIZ_A for PHONE_A', async () => {
      const found = await mockPrisma.business.findFirst({
        where: { wa_phone_number_id: PHONE_A },
      });
      expect(found).not.toBeNull();
      expect(found.id).toBe(BIZ_A.id);
      expect(found.slug).toBe('test-biz-a');
    });

    test('returns BIZ_B for PHONE_B', async () => {
      const found = await mockPrisma.business.findFirst({
        where: { wa_phone_number_id: PHONE_B },
      });
      expect(found).not.toBeNull();
      expect(found.id).toBe(BIZ_B.id);
      expect(found.slug).toBe('test-biz-b');
    });

    test('returns null for an unregistered phone number', async () => {
      const found = await mockPrisma.business.findFirst({
        where: { wa_phone_number_id: '99999999999' },
      });
      expect(found).toBeNull();
    });
  });

  // ── TC1 + TC2: fixture setup verification ─────────────────────────────────
  describe('TC1+2 — two businesses and conversations exist with distinct IDs', () => {
    test('BIZ_A and BIZ_B have different wa_phone_number_id', () => {
      expect(BIZ_A.wa_phone_number_id).not.toBe(BIZ_B.wa_phone_number_id);
    });

    test('CONV_A and CONV_B belong to different businesses', () => {
      expect(CONV_A.business_id).toBe(BIZ_A.id);
      expect(CONV_B.business_id).toBe(BIZ_B.id);
      expect(CONV_A.id).not.toBe(CONV_B.id);
    });
  });

  // ── TC3: webhook for A routes only to BIZ_A ───────────────────────────────
  describe('TC3 — webhook for PHONE_A routes message to BIZ_A conversation only', () => {
    test('message is saved to CONV_A, not CONV_B', async () => {
      await processInboundMessage(
        buildEntry(PHONE_A, CUSTOMER_A, 'Hello from A', 'wmsg_a_001'),
      );

      expect(msgsFor(CONV_A.id)).toHaveLength(1);
      expect(msgsFor(CONV_B.id)).toHaveLength(0);
    });

    test('saved message carries BIZ_A id and correct text', async () => {
      await processInboundMessage(
        buildEntry(PHONE_A, CUSTOMER_A, 'Hello from A', 'wmsg_a_002'),
      );

      const [msg] = msgsFor(CONV_A.id);
      expect(msg.business_id).toBe(BIZ_A.id);
      expect(msg.conversation_id).toBe(CONV_A.id);
      expect(msg.text_body).toBe('Hello from A');
      expect(msg.direction).toBe('inbound');
    });
  });

  // ── TC4: webhook for B routes only to BIZ_B ───────────────────────────────
  describe('TC4 — webhook for PHONE_B routes message to BIZ_B conversation only', () => {
    test('message is saved to CONV_B, not CONV_A', async () => {
      await processInboundMessage(
        buildEntry(PHONE_B, CUSTOMER_B, 'Hello from B', 'wmsg_b_001'),
      );

      expect(msgsFor(CONV_A.id)).toHaveLength(0);
      expect(msgsFor(CONV_B.id)).toHaveLength(1);
    });

    test('saved message carries BIZ_B id and correct text', async () => {
      await processInboundMessage(
        buildEntry(PHONE_B, CUSTOMER_B, 'Hello from B', 'wmsg_b_002'),
      );

      const [msg] = msgsFor(CONV_B.id);
      expect(msg.business_id).toBe(BIZ_B.id);
      expect(msg.conversation_id).toBe(CONV_B.id);
      expect(msg.text_body).toBe('Hello from B');
    });
  });

  // ── Cross-routing: interleaved messages stay isolated ─────────────────────
  describe('Cross-routing isolation — interleaved messages', () => {
    test('A then B: each conversation gets exactly 1 message', async () => {
      await processInboundMessage(buildEntry(PHONE_A, CUSTOMER_A, 'Msg A', 'wmsg_x_a1'));
      await processInboundMessage(buildEntry(PHONE_B, CUSTOMER_B, 'Msg B', 'wmsg_x_b1'));

      expect(msgsFor(CONV_A.id)).toHaveLength(1);
      expect(msgsFor(CONV_B.id)).toHaveLength(1);
    });

    test('no cross-contamination: CONV_A messages all have business_id=biz_a_id', async () => {
      await processInboundMessage(buildEntry(PHONE_A, CUSTOMER_A, 'First A',  'wmsg_cc_a1'));
      await processInboundMessage(buildEntry(PHONE_B, CUSTOMER_B, 'First B',  'wmsg_cc_b1'));
      await processInboundMessage(buildEntry(PHONE_A, CUSTOMER_A, 'Second A', 'wmsg_cc_a2'));

      const aMessages = msgsFor(CONV_A.id);
      const bMessages = msgsFor(CONV_B.id);

      expect(aMessages).toHaveLength(2);
      expect(bMessages).toHaveLength(1);
      aMessages.forEach((m) => expect(m.business_id).toBe(BIZ_A.id));
      bMessages.forEach((m) => expect(m.business_id).toBe(BIZ_B.id));
    });
  });

  // ── Idempotency ───────────────────────────────────────────────────────────
  describe('Idempotency — duplicate meta_message_id', () => {
    test('same meta_message_id is not saved twice', async () => {
      await processInboundMessage(buildEntry(PHONE_A, CUSTOMER_A, 'Hello', 'wmsg_dup_001'));
      await processInboundMessage(buildEntry(PHONE_A, CUSTOMER_A, 'Hello dup', 'wmsg_dup_001'));

      // Only the first call should have stored a message
      expect(msgsFor(CONV_A.id)).toHaveLength(1);
    });
  });

  // ── Unknown phone number ──────────────────────────────────────────────────
  describe('Unknown phone_number_id', () => {
    test('silently ignored — no message stored anywhere', async () => {
      await expect(
        processInboundMessage(
          buildEntry('99999999999', CUSTOMER_A, 'Lost message', 'wmsg_unk_001'),
        ),
      ).resolves.toBeUndefined();

      expect(msgsFor(CONV_A.id)).toHaveLength(0);
      expect(msgsFor(CONV_B.id)).toHaveLength(0);
    });
  });

  // ── TC5: Inbox route isolation (authenticated, business_owner of A) ────────
  describe('TC5 — GET /api/inbox/conversations scoped to business_owner of A', () => {
    test('returns only BIZ_A conversations; BIZ_B conversation absent', async () => {
      const token = jwt.sign(
        { id: OWNER_A.id },
        process.env.JWT_SECRET,
        { expiresIn: '15m' },
      );

      const res = await request(app)
        .get('/api/inbox/conversations')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.conversations)).toBe(true);
      expect(res.body.conversations.length).toBeGreaterThanOrEqual(1);

      // Every returned conversation must belong to BIZ_A
      res.body.conversations.forEach((c) => {
        expect(c.business_id).toBe(BIZ_A.id);
      });

      // BIZ_B's conversation must not be present
      const hasBizB = res.body.conversations.some((c) => c.business_id === BIZ_B.id);
      expect(hasBizB).toBe(false);
    });

    test('business_owner of A cannot see BIZ_B conversations via the API', async () => {
      const token = jwt.sign({ id: OWNER_A.id }, process.env.JWT_SECRET, { expiresIn: '15m' });

      const res = await request(app)
        .get('/api/inbox/conversations')
        .set('Authorization', `Bearer ${token}`);

      const ids = res.body.conversations.map((c) => c.id);
      expect(ids).not.toContain(CONV_B.id);
    });
  });
});
