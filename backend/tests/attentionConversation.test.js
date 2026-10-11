/**
 * The urgent alert opens the exact waiting conversation.
 *
 * «زبون ينتظر ردًا» and «محادثة محوّلة لفريق المحل» used to carry no conversation, so the panels
 * guessed the newest thread the customer wrote last in — often not the one the alert was about.
 * Both items now carry conversation_id: the thread that has waited longest. Only the id: opening
 * it is still the audited read (adminWorkspace.test.js).
 *
 * The overview route over a Prisma mock that answers findMany from the route's own `where`, as
 * adminOverview.test.js does, plus accountHealth.shopAttention on its own.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  business: { findMany: jest.fn(), count: jest.fn() },
  whatsappOnboarding: { findMany: jest.fn() },
  conversation: { groupBy: jest.fn(), findMany: jest.fn() },
  message: { groupBy: jest.fn() },
  subscription: { findMany: jest.fn() },
  businessKnowledge: { groupBy: jest.fn() },
  user: { findUnique: jest.fn() },
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const app = require('../src/app');
const { shopAttention } = require('../src/services/accountHealth');

const ADMIN = { id: 'u1', name: 'Admin', email: 'a@b.c', role: 'platform_admin', business_id: null, active: true };
const get = () => request(app).get('/api/admin/overview').set('Authorization', `Bearer ${jwt.sign({ id: 'u1' }, process.env.JWT_SECRET)}`);
const minsAgo = (m) => new Date(Date.now() - m * 60000);

const biz = {
  id: 'b1', name: 'مطعم الشام', status: 'active', business_type: 'restaurant', is_internal: false,
  wa_phone_number_id: 'PHONE', wa_business_account_id: 'WABA', connected_at: null,
  wa_access_token: 'enc', ai_config: {}, created_at: new Date('2026-09-01'), updated_at: new Date('2026-09-20'),
};
const conversation = (over) => ({
  business_id: 'b1', status: 'open', ai_enabled: true, unread_count: 0,
  last_message_at: minsAgo(1), last_inbound_at: null, last_outbound_at: null,
  needs_attention: false, attention_at: null, ...over,
});

function matchField(value, cond) {
  if (cond === null || typeof cond !== 'object' || cond instanceof Date) return value === cond;
  if ('in' in cond && !cond.in.includes(value)) return false;
  if ('lt' in cond && !(value && new Date(value) < cond.lt)) return false;
  if ('gt' in cond && !(value && new Date(value) > cond.gt)) return false;
  return true;
}
const matches = (row, where = {}) => Object.entries(where).every(([k, cond]) => matchField(row[k], cond));
// What the route's select would return: only the columns it asked for.
const project = (row, select) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row);

function mockDb(conversations) {
  prisma.business.findMany.mockResolvedValue([biz]);
  prisma.business.count.mockResolvedValue(0);
  prisma.whatsappOnboarding.findMany.mockResolvedValue([{ business_id: 'b1', step: 'done', payment_method_ok: true, last_error: null, updated_at: new Date() }]);
  prisma.subscription.findMany.mockResolvedValue([]);
  prisma.businessKnowledge.groupBy.mockResolvedValue([]);
  prisma.message.groupBy.mockResolvedValue([]);
  prisma.conversation.groupBy.mockResolvedValue([]);
  prisma.conversation.findMany.mockImplementation(({ where, select, take }) =>
    Promise.resolve(conversations.filter((c) => matches(c, where)).slice(0, take).map((c) => project(c, select))));
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(ADMIN);
});

test('«unanswered» names the thread that has waited longest, not the newest', async () => {
  mockDb([
    conversation({ id: 'c_new', last_inbound_at: minsAgo(20) }),
    conversation({ id: 'c_old', last_inbound_at: minsAgo(90) }),
    conversation({ id: 'c_mid', last_inbound_at: minsAgo(40) }),
    // Answered: not waiting, however old.
    conversation({ id: 'c_done', last_inbound_at: minsAgo(300), last_outbound_at: minsAgo(299) }),
  ]);
  const res = await get();
  const item = res.body.attention.find((a) => a.rule === 'unanswered');
  expect(item).toMatchObject({ account_id: 'b1', conversation_id: 'c_old' });
});

test('«handoff_waiting» names the thread handed over longest ago', async () => {
  mockDb([
    conversation({ id: 'h_recent', needs_attention: true, attention_at: minsAgo(70), last_inbound_at: minsAgo(71), last_outbound_at: minsAgo(72) }),
    conversation({ id: 'h_oldest', needs_attention: true, attention_at: minsAgo(200), last_inbound_at: minsAgo(201), last_outbound_at: minsAgo(202) }),
  ]);
  const res = await get();
  const item = res.body.attention.find((a) => a.rule === 'handoff_waiting');
  expect(item).toMatchObject({ account_id: 'b1', conversation_id: 'h_oldest' });
});

test('items about no conversation carry no conversation_id', async () => {
  mockDb([]);
  const res = await get();
  expect(res.body.attention.length).toBeGreaterThan(0);
  for (const a of res.body.attention) expect(a).not.toHaveProperty('conversation_id');
});

describe('shopAttention', () => {
  const now = Date.now();
  const base = { business: { ...biz }, onboarding: null, events: [], now };

  test('passes the oldest thread through on both items', () => {
    const items = shopAttention({
      ...base,
      waiting: { count: 2, oldest: new Date(now - 60 * 60000), oldest_id: 'c1' },
      handoff: { count: 1, oldest: new Date(now - 120 * 60000), oldest_id: 'c2' },
    });
    expect(items.find((i) => i.rule === 'unanswered')).toMatchObject({ conversation_id: 'c1', category: 'unanswered' });
    expect(items.find((i) => i.rule === 'handoff_waiting')).toMatchObject({ conversation_id: 'c2', category: 'handoff_waiting' });
  });

  test('without an id (an older caller) the items are as before', () => {
    const items = shopAttention({ ...base, waiting: { count: 1, oldest: new Date(now - 30 * 60000) } });
    expect(items.find((i) => i.rule === 'unanswered')).not.toHaveProperty('conversation_id');
  });
});
