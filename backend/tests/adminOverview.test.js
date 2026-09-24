/**
 * The platform overview's states.
 *
 * The rule these tests defend: an account is only shown as healthy when we have evidence
 * that it is. Missing telemetry reads as `unknown`, never as green, and the attention queue
 * carries only rules we can actually evaluate.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  business: { findMany: jest.fn() },
  whatsappOnboarding: { findMany: jest.fn() },
  conversation: { groupBy: jest.fn(), findMany: jest.fn() },
  message: { groupBy: jest.fn() },
  user: { findUnique: jest.fn() },
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const app = require('../src/app');

const ADMIN = { id: 'u1', name: 'Admin', email: 'a@b.c', role: 'platform_admin', business_id: null, active: true };
const token = () => jwt.sign({ id: 'u1' }, process.env.JWT_SECRET);

const biz = (over = {}) => ({
  id: 'b1', name: 'مطعم الشام', status: 'active', business_type: 'restaurant',
  wa_phone_number_id: 'PHONE', wa_business_account_id: 'WABA',
  wa_access_token: 'enc', ai_config: {}, created_at: new Date('2026-09-01'), updated_at: new Date('2026-09-20'),
  ...over,
});

const minsAgo = (m) => new Date(Date.now() - m * 60000);

function mockDb({ businesses, onboardings = [], conv = [], open = [], outbound = [], stale = [] }) {
  prisma.business.findMany.mockResolvedValue(businesses);
  prisma.whatsappOnboarding.findMany.mockResolvedValue(onboardings);
  prisma.message.groupBy.mockResolvedValue(outbound);
  prisma.conversation.findMany.mockResolvedValue(stale);
  prisma.conversation.groupBy
    .mockResolvedValueOnce(conv)   // totals aggregate
    .mockResolvedValueOnce(open);  // open conversations
}

const get = () => request(app).get('/api/admin/overview').set('Authorization', `Bearer ${token()}`);

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(ADMIN);
});

test('a business user cannot reach the platform overview', async () => {
  prisma.user.findUnique.mockResolvedValue({ ...ADMIN, role: 'business_owner', business_id: 'b1' });
  const res = await get();
  expect(res.status).toBe(403);
});

test('a healthy account is active, connected and answering', async () => {
  mockDb({
    businesses: [biz()],
    onboardings: [{ business_id: 'b1', step: 'done', payment_method_ok: true, last_error: null, last_error_at: null, updated_at: new Date() }],
    conv: [{ business_id: 'b1', _max: { last_inbound_at: minsAgo(5), last_message_at: minsAgo(4) }, _count: { _all: 9 }, _sum: { unread_count: 0 } }],
    outbound: [{ business_id: 'b1', _max: { created_at: minsAgo(4) } }],
    open: [{ business_id: 'b1', _count: { _all: 2 } }],
  });

  const res = await get();
  expect(res.status).toBe(200);
  const a = res.body.accounts[0];
  expect(a.lifecycle).toBe('active');
  expect(a.connection.state).toBe('ok');
  expect(a.agent.state).toBe('ok');
  expect(res.body.totals.active).toBe(1);
  expect(res.body.attention).toEqual([]);   // nothing to do is the normal case
});

test('an account with no messages yet reads as unknown, never healthy', async () => {
  mockDb({ businesses: [biz()], onboardings: [{ business_id: 'b1', step: 'done', payment_method_ok: true, updated_at: new Date() }] });
  const res = await get();
  expect(res.body.accounts[0].agent.state).toBe('unknown');
});

test('an unanswered customer is critical, with how long they have waited', async () => {
  mockDb({
    businesses: [biz()],
    onboardings: [{ business_id: 'b1', step: 'done', payment_method_ok: true, updated_at: new Date() }],
    // inbound 40 minutes ago; the last outbound predates it, so nobody answered
    conv: [{ business_id: 'b1', _max: { last_inbound_at: minsAgo(40), last_message_at: minsAgo(40) }, _count: { _all: 1 }, _sum: { unread_count: 1 } }],
    outbound: [{ business_id: 'b1', _max: { created_at: minsAgo(90) } }],
  });

  const res = await get();
  expect(res.body.accounts[0].agent.state).toBe('down');
  const item = res.body.attention.find((x) => x.category === 'unanswered');
  expect(item.severity).toBe('critical');
});

test('an unfinished signup is onboarding, not active, and says which step', async () => {
  mockDb({
    businesses: [biz()],
    onboardings: [{ business_id: 'b1', step: 'subscribed', payment_method_ok: false, updated_at: new Date() }],
  });
  const res = await get();
  expect(res.body.accounts[0].lifecycle).toBe('onboarding');
  expect(res.body.accounts[0].connection.state).toBe('degraded');
  expect(res.body.totals.onboarding).toBe(1);
  expect(res.body.attention.some((a) => a.category === 'onboarding_incomplete')).toBe(true);
});

test('a finished signup without a payment method warns — sending is blocked', async () => {
  mockDb({
    businesses: [biz()],
    onboardings: [{ business_id: 'b1', step: 'done', payment_method_ok: false, updated_at: new Date() }],
  });
  const res = await get();
  expect(res.body.accounts[0].connection.state).toBe('degraded');
  expect(res.body.attention.some((a) => a.category === 'payment_method')).toBe(true);
});

test('an account with no access token cannot receive, and is not called active', async () => {
  mockDb({ businesses: [biz({ wa_access_token: null })] });
  const res = await get();
  expect(res.body.accounts[0].connection.state).toBe('down');
  expect(res.body.accounts[0].lifecycle).toBe('onboarding');
});

test('critical items sort above warnings', async () => {
  mockDb({
    businesses: [biz(), biz({ id: 'b2', name: 'عيادة النور', wa_access_token: null })],
    onboardings: [{ business_id: 'b1', step: 'done', payment_method_ok: false, updated_at: new Date() }],
  });
  const res = await get();
  expect(res.body.attention[0].severity).toBe('critical');
});

test('signals we do not collect are declared, not silently absent', async () => {
  mockDb({ businesses: [biz()] });
  const res = await get();
  expect(res.body.unavailable).toContain('meta_quality_rating');
});

test('a customer message is not mistaken for a reply', async () => {
  // The trap: last_message_at moves when the CUSTOMER writes. An account with no outbound
  // at all must never read as answering.
  mockDb({
    businesses: [biz()],
    onboardings: [{ business_id: 'b1', step: 'done', payment_method_ok: true, updated_at: new Date() }],
    conv: [{ business_id: 'b1', _max: { last_inbound_at: minsAgo(30), last_message_at: minsAgo(30) }, _count: { _all: 3 }, _sum: { unread_count: 3 } }],
    outbound: [],   // nothing ever sent
  });

  const res = await get();
  expect(res.body.accounts[0].agent.state).toBe('down');
  expect(res.body.accounts[0].last_outbound_at).toBeNull();
});

describe('an account cannot look healthy when it is not', () => {
  test('a human answering by hand is not the agent working', async () => {
    // Manual replies write outbound rows too; only the agent's own replies may count.
    mockDb({
      businesses: [biz()],
      onboardings: [{ business_id: 'b1', step: 'done', payment_method_ok: true, updated_at: new Date() }],
      conv: [{ business_id: 'b1', _max: { last_inbound_at: minsAgo(30), last_message_at: minsAgo(28) }, _count: { _all: 4 }, _sum: { unread_count: 0 } }],
      outbound: [],   // groupBy filters is_ai_generated: true, so a hand-typed reply is absent
    });
    const res = await get();
    expect(res.body.accounts[0].agent.state).toBe('down');
  });

  test('an account with no workflow is down, whatever it last sent', async () => {
    // `generic` answers production with a fixed greeting and never calls a model.
    mockDb({
      businesses: [biz({ business_type: 'generic' })],
      onboardings: [{ business_id: 'b1', step: 'done', payment_method_ok: true, updated_at: new Date() }],
      conv: [{ business_id: 'b1', _max: { last_inbound_at: minsAgo(5), last_message_at: minsAgo(4) }, _count: { _all: 2 }, _sum: { unread_count: 0 } }],
      outbound: [{ business_id: 'b1', _max: { created_at: minsAgo(4) } }],
    });
    const res = await get();
    expect(res.body.accounts[0].agent.state).toBe('down');
    expect(res.body.attention.some((a) => a.category === 'no_workflow')).toBe(true);
  });

  test('a neglected thread is not hidden behind a busy one', async () => {
    mockDb({
      businesses: [biz()],
      onboardings: [{ business_id: 'b1', step: 'done', payment_method_ok: true, updated_at: new Date() }],
      conv: [{ business_id: 'b1', _max: { last_inbound_at: minsAgo(2), last_message_at: minsAgo(1) }, _count: { _all: 9 }, _sum: { unread_count: 1 } }],
      outbound: [{ business_id: 'b1', _max: { created_at: minsAgo(1) } }],
      stale: [{ business_id: 'b1', last_inbound_at: minsAgo(400) }, { business_id: 'b1', last_inbound_at: minsAgo(90) }],
    });
    const res = await get();
    expect(res.body.accounts[0].agent.state).toBe('ok');           // the account overall is answering
    expect(res.body.accounts[0].unanswered_conversations).toBe(2); // but two customers are waiting
    expect(res.body.attention.some((a) => a.category === 'stale_threads')).toBe(true);
  });
});
