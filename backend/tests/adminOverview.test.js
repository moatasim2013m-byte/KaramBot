/**
 * The platform overview's states.
 *
 * The rule these tests defend: an account is only shown as healthy when we have evidence
 * that it is. Missing telemetry reads as `unknown`, never as green, and the attention queue
 * carries only rules we can actually evaluate — and only true ones: the stale rule this file
 * used to defend counted every answered thread as waiting.
 *
 * Conversations are given as rows and the Prisma mock answers groupBy and findMany from them
 * with the route's own `where`, so the database half of each rule (the 15-minute and 24-hour
 * bounds, status, ai_enabled) is exercised along with the half done in JavaScript.
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
const { PAYMENT_NOTICES } = require('../src/config/metaNotices');

const ADMIN = { id: 'u1', name: 'Admin', email: 'a@b.c', role: 'platform_admin', business_id: null, active: true };
const token = () => jwt.sign({ id: 'u1' }, process.env.JWT_SECRET);

const biz = (over = {}) => ({
  id: 'b1', name: 'مطعم الشام', status: 'active', business_type: 'restaurant', is_internal: false,
  wa_phone_number_id: 'PHONE', wa_business_account_id: 'WABA', connected_at: null,
  wa_access_token: 'enc', ai_config: {}, created_at: new Date('2026-09-01'), updated_at: new Date('2026-09-20'),
  ...over,
});

const minsAgo = (m) => new Date(Date.now() - m * 60000);

const conversation = (over = {}) => ({
  business_id: 'b1', status: 'open', ai_enabled: true, unread_count: 0,
  last_message_at: minsAgo(1), last_inbound_at: null, last_outbound_at: null,
  needs_attention: false, attention_at: null,
  ...over,
});

// ── A small evaluator for the where clauses the route sends ─────────────────
function matchField(value, cond) {
  if (cond === null || typeof cond !== 'object' || cond instanceof Date) {
    return cond instanceof Date ? value && new Date(value).getTime() === cond.getTime() : value === cond;
  }
  if ('in' in cond && !cond.in.includes(value)) return false;
  if ('not' in cond && value === cond.not) return false;
  if ('lt' in cond && !(value && new Date(value) < cond.lt)) return false;
  if ('gt' in cond && !(value && new Date(value) > cond.gt)) return false;
  return true;
}
const matches = (row, where = {}) => Object.entries(where).every(([k, cond]) => matchField(row[k], cond));

function groupConversations(rows, { where, _max, _count, _sum }) {
  const groups = new Map();
  for (const r of rows.filter((c) => matches(c, where))) {
    if (!groups.has(r.business_id)) groups.set(r.business_id, []);
    groups.get(r.business_id).push(r);
  }
  return [...groups].map(([business_id, list]) => {
    const out = { business_id };
    if (_max) {
      out._max = {};
      for (const f of Object.keys(_max)) {
        const vals = list.map((r) => r[f]).filter(Boolean);
        out._max[f] = vals.length ? new Date(Math.max(...vals.map((v) => new Date(v).getTime()))) : null;
      }
    }
    if (_count) out._count = { _all: list.length };
    if (_sum) out._sum = { unread_count: list.reduce((s, r) => s + (r.unread_count || 0), 0) };
    return out;
  });
}

function mockDb({ businesses, onboardings = [], conversations = [], subs = [], knowledge = [], hidden = 0 }) {
  prisma.business.findMany.mockImplementation(({ where = {} } = {}) =>
    Promise.resolve(businesses.filter((b) => matches(b, where))));
  prisma.business.count.mockResolvedValue(hidden);
  prisma.whatsappOnboarding.findMany.mockResolvedValue(onboardings);
  prisma.subscription.findMany.mockResolvedValue(subs);
  prisma.businessKnowledge.groupBy.mockResolvedValue(knowledge);
  prisma.conversation.groupBy.mockImplementation((args) => Promise.resolve(groupConversations(conversations, args)));
  prisma.conversation.findMany.mockImplementation(({ where, take }) =>
    Promise.resolve(conversations.filter((c) => matches(c, where)).slice(0, take)));
}

const get = (q = '') => request(app).get(`/api/admin/overview${q}`).set('Authorization', `Bearer ${token()}`);
const ready = (over = {}) => [{ business_id: 'b1', step: 'done', payment_method_ok: true, last_error: null, updated_at: new Date(), ...over }];
const categories = (res) => res.body.attention.map((a) => a.category);

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
    onboardings: ready(),
    conversations: [conversation({ last_inbound_at: minsAgo(5), last_outbound_at: minsAgo(4) })],
    // A healthy account also has something sold against it; without a contract the
    // fleet view rightly points that out, which is a different test.
    subs: [{ business_id: 'b1', solution: 'karam_bot', status: 'active', amount_jod: 120, billing_cycle: 'monthly',
      next_due_at: new Date(Date.now() + 20 * 86400000), starts_at: new Date('2026-09-01') }],
  });

  const res = await get();
  expect(res.status).toBe(200);
  const a = res.body.accounts[0];
  expect(a.lifecycle).toBe('active');
  expect(a.connection.state).toBe('ok');
  expect(a.agent.state).toBe('ok');
  expect(a.bot_enabled).toBe(true);
  expect(res.body.totals.active).toBe(1);
  expect(res.body.attention).toEqual([]);   // nothing to do is the normal case
});

test('the agent state is read from Conversation.last_outbound_at, not a scan of every message', async () => {
  const replied = minsAgo(4);
  mockDb({ businesses: [biz()], onboardings: ready(), conversations: [conversation({ last_inbound_at: minsAgo(5), last_outbound_at: replied })] });
  const res = await get();
  expect(prisma.message.groupBy).not.toHaveBeenCalled();
  expect(res.body.accounts[0].last_outbound_at).toBe(replied.toISOString());
  const aggregate = prisma.conversation.groupBy.mock.calls.find(([a]) => a._max)[0];
  expect(aggregate._max.last_outbound_at).toBe(true);
});

test('an account with no messages yet reads as unknown, never healthy', async () => {
  mockDb({ businesses: [biz()], onboardings: ready() });
  const res = await get();
  expect(res.body.accounts[0].agent.state).toBe('unknown');
});

describe('the waiting rule: a customer wrote after the last reply, 15 minutes to 24 hours ago', () => {
  const run = async (rows) => {
    mockDb({ businesses: [biz()], onboardings: ready(), conversations: rows });
    return get();
  };

  test('an answered thread is not waiting, however old its last inbound', async () => {
    // The bug this replaces: inbound 3 hours ago, answered a minute later, counted as waiting.
    const res = await run([conversation({ last_inbound_at: minsAgo(180), last_outbound_at: minsAgo(179) })]);
    expect(res.body.accounts[0].unanswered_conversations).toBe(0);
    expect(categories(res)).not.toContain('unanswered');
  });

  test('a thread never answered at all is waiting (coalesce to epoch)', async () => {
    const res = await run([conversation({ last_inbound_at: minsAgo(25), last_outbound_at: null })]);
    expect(res.body.accounts[0].unanswered_conversations).toBe(1);
    const item = res.body.attention.find((a) => a.category === 'unanswered');
    expect(item.severity).toBe('critical');
    expect(item.message).toBe('زبون ينتظر ردًا منذ 25 د');
  });

  test('an inbound after the last reply is waiting', async () => {
    const res = await run([conversation({ last_inbound_at: minsAgo(40), last_outbound_at: minsAgo(90) })]);
    expect(res.body.accounts[0].unanswered_conversations).toBe(1);
    expect(res.body.accounts[0].agent.state).toBe('down');
  });

  test('a resolved (closed) thread is not waiting', async () => {
    const res = await run([conversation({ status: 'closed', last_inbound_at: minsAgo(40) })]);
    expect(res.body.accounts[0].unanswered_conversations).toBe(0);
  });

  test('a pending thread counts like an open one', async () => {
    const res = await run([conversation({ status: 'pending', last_inbound_at: minsAgo(40) })]);
    expect(res.body.accounts[0].unanswered_conversations).toBe(1);
  });

  test('a thread the team took over (bot off for it) is not the bot leaving a customer waiting', async () => {
    const res = await run([conversation({ ai_enabled: false, last_inbound_at: minsAgo(40) })]);
    expect(res.body.accounts[0].unanswered_conversations).toBe(0);
  });

  test('the 15-minute boundary: 14 minutes is not yet waiting, 16 is', async () => {
    let res = await run([conversation({ last_inbound_at: minsAgo(14) })]);
    expect(res.body.accounts[0].unanswered_conversations).toBe(0);
    res = await run([conversation({ last_inbound_at: minsAgo(16) })]);
    expect(res.body.accounts[0].unanswered_conversations).toBe(1);
  });

  test('past 24 hours it leaves the queue', async () => {
    const res = await run([conversation({ last_inbound_at: minsAgo(25 * 60) })]);
    expect(res.body.accounts[0].unanswered_conversations).toBe(0);
  });

  test('a neglected thread is not hidden behind a busy one, and several are counted', async () => {
    const res = await run([
      conversation({ last_inbound_at: minsAgo(2), last_outbound_at: minsAgo(1) }),
      conversation({ last_inbound_at: minsAgo(400), last_outbound_at: minsAgo(500) }),
      conversation({ last_inbound_at: minsAgo(90) }),
    ]);
    expect(res.body.accounts[0].agent.state).toBe('ok');           // the account overall is answering
    expect(res.body.accounts[0].unanswered_conversations).toBe(2); // but two customers are waiting
    const item = res.body.attention.find((a) => a.category === 'unanswered');
    expect(item.message).toBe('2 زبائن ينتظرون ردًا — أقدمهم منذ 7 س');
  });

  test('the query is bounded and asks only for the columns the rule reads', async () => {
    await run([]);
    const call = prisma.conversation.findMany.mock.calls.find(([a]) => a.where.ai_enabled === true)[0];
    expect(call.take).toBeGreaterThan(0);
    expect(call.where.last_inbound_at.lt).toBeInstanceOf(Date);
    expect(call.where.last_inbound_at.gt).toBeInstanceOf(Date);
    expect(call.where.status).toEqual({ in: ['open', 'pending'] });
    expect(Object.keys(call.select).sort()).toEqual(['ai_enabled', 'business_id', 'last_inbound_at', 'last_outbound_at', 'status']);
  });
});

describe('handoff_waiting: handed to the team more than an hour ago and not answered since', () => {
  const run = async (rows) => {
    mockDb({ businesses: [biz()], onboardings: ready(), conversations: rows });
    return get();
  };

  test('flagged 90 minutes ago with nothing sent since is a warning', async () => {
    const res = await run([
      conversation({ needs_attention: true, attention_at: minsAgo(90), last_outbound_at: minsAgo(95) }),
      conversation({ needs_attention: true, attention_at: minsAgo(120) }),
    ]);
    const item = res.body.attention.find((a) => a.category === 'handoff_waiting');
    expect(item.severity).toBe('warning');
    expect(item.message).toBe('2 محادثات محوّلة لفريق المحل بلا رد منذ أكثر من ساعة');
    expect(res.body.accounts[0].handoff_waiting).toBe(2);
  });

  test('a reply after the handoff, or a handoff under an hour old, is not listed', async () => {
    const res = await run([
      conversation({ needs_attention: true, attention_at: minsAgo(90), last_outbound_at: minsAgo(30) }),
      conversation({ needs_attention: true, attention_at: minsAgo(30) }),
      conversation({ needs_attention: true, attention_at: minsAgo(300), status: 'closed' }),
    ]);
    expect(categories(res)).not.toContain('handoff_waiting');
  });
});

describe('internal accounts', () => {
  const shift = biz({ id: 'shift1', name: 'شِفت', business_type: 'shift', is_internal: true });
  const sim = biz({ id: 'sim1', name: 'noor-clinic-sim', business_type: 'clinic', is_internal: true });

  test("SHIFT's own row and the -sim shops are hidden from the accounts, totals and queue, and counted", async () => {
    mockDb({
      businesses: [biz(), shift, sim],
      onboardings: ready(),
      conversations: [conversation({ business_id: 'shift1', last_inbound_at: minsAgo(40) })],
      hidden: 2,
    });
    const res = await get();
    expect(res.body.accounts.map((a) => a.id)).toEqual(['b1']);
    expect(res.body.totals.active + res.body.totals.onboarding).toBe(1);
    expect(res.body.attention.some((a) => a.business_id === 'shift1')).toBe(false);
    expect(res.body.hidden_internal_count).toBe(2);
    expect(prisma.business.findMany.mock.calls[0][0].where).toEqual({ is_internal: false });
    // Their conversations are not even read.
    const waitingCall = prisma.conversation.findMany.mock.calls[0][0];
    expect(waitingCall.where.business_id).toEqual({ in: ['b1'] });
  });

  test('?include_internal=1 shows them, tagged', async () => {
    mockDb({ businesses: [biz(), shift], onboardings: ready() });
    const res = await get('?include_internal=1');
    expect(res.body.accounts.map((a) => a.id)).toEqual(['b1', 'shift1']);
    expect(res.body.accounts[1].is_internal).toBe(true);
    expect(res.body.include_internal).toBe(true);
    expect(prisma.business.count).not.toHaveBeenCalled();
  });

  test('an internal row is never asked for a contract, whatever its type', async () => {
    mockDb({ businesses: [biz({ is_internal: true, business_type: 'generic' })], onboardings: ready() });
    const res = await get('?include_internal=1');
    expect(categories(res)).not.toContain('no_contract');
  });
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
  expect(categories(res)).toContain('onboarding_incomplete');
});

describe('the payment method at Meta', () => {
  test('connected more than 48 hours without a confirmed card is a warning, in the shared wording', async () => {
    mockDb({ businesses: [biz({ connected_at: minsAgo(3 * 24 * 60) })], onboardings: ready({ payment_method_ok: false }) });
    const res = await get();
    expect(res.body.accounts[0].connection.state).toBe('degraded');
    expect(res.body.accounts[0].connection.label).toBe(PAYMENT_NOTICES.missing.staff.short);
    const item = res.body.attention.find((a) => a.category === 'payment_unconfirmed');
    expect(item.severity).toBe('warning');
    expect(item.message).toBe(`${PAYMENT_NOTICES.missing.staff.short} — منذ 3 يوم`);
    // The dated rule it replaces is gone.
    expect(JSON.stringify(res.body)).not.toMatch(/تشرين|أيلول/);
  });

  test('says when the owner claims to have added it', async () => {
    mockDb({
      businesses: [biz({ connected_at: minsAgo(3 * 24 * 60) })],
      onboardings: ready({ payment_method_ok: false, payment_method_claimed_at: minsAgo(60) }),
    });
    const res = await get();
    expect(res.body.attention.find((a) => a.category === 'payment_unconfirmed').message)
      .toContain(PAYMENT_NOTICES.claimed.staff.short);
  });

  test('inside the first 48 hours it waits', async () => {
    mockDb({ businesses: [biz({ connected_at: minsAgo(60) })], onboardings: ready({ payment_method_ok: false }) });
    expect(categories(await get())).not.toContain('payment_unconfirmed');
  });

  test('a shop connected before connected_at existed falls back to its onboarding time', async () => {
    mockDb({ businesses: [biz()], onboardings: ready({ payment_method_ok: false, registered_at: minsAgo(5 * 24 * 60), updated_at: minsAgo(5 * 24 * 60) }) });
    expect(categories(await get())).toContain('payment_unconfirmed');
  });

  test('a Meta 131042 refusal is critical and overrides the confirmation', async () => {
    mockDb({ businesses: [biz()], onboardings: ready({ payment_method_ok: true, payment_blocked_at: minsAgo(10) }) });
    const res = await get();
    const item = res.body.attention.find((a) => a.category === 'payment_blocked');
    expect(item).toMatchObject({ severity: 'critical', message: PAYMENT_NOTICES.blocked.staff.short });
    expect(res.body.accounts[0].connection.state).toBe('down');
    expect(categories(res)).not.toContain('connection'); // it has a token; this is not that
  });
});

test('an account with no access token cannot receive, and is not called active', async () => {
  mockDb({ businesses: [biz({ wa_access_token: null })] });
  const res = await get();
  expect(res.body.accounts[0].connection.state).toBe('down');
  expect(res.body.accounts[0].lifecycle).toBe('onboarding');
  expect(categories(res)).toContain('connection');
});

test('critical items sort above warnings', async () => {
  mockDb({
    businesses: [biz({ connected_at: minsAgo(4000) }), biz({ id: 'b2', name: 'عيادة النور', wa_access_token: null })],
    onboardings: ready({ payment_method_ok: false }),
  });
  const res = await get();
  expect(res.body.attention[0].severity).toBe('critical');
});

test('signals we do not collect are declared, not silently absent', async () => {
  mockDb({ businesses: [biz()] });
  const res = await get();
  expect(res.body.unavailable).toContain('config_change_actor');
  expect(res.body.unavailable).not.toContain('meta_quality_rating');
  // throughput is a sending rate, not the messaging tier — one does not stand in for the other,
  // so the tier stays declared as not collected.
  expect(res.body.unavailable).toContain('messaging_tier');
});

test("Meta's own view of an account travels with it, with the time it was read", async () => {
  const checked = new Date('2026-09-27T09:00:00Z');
  mockDb({
    businesses: [biz()],
    onboardings: ready({
      meta_quality_rating: 'GREEN', meta_throughput: 'STANDARD', meta_number_status: 'CONNECTED',
      meta_name_status: 'DECLINED', meta_review_status: 'APPROVED', meta_checked_at: checked,
    }),
  });
  const res = await get();
  expect(res.body.accounts[0].meta).toMatchObject({ quality_rating: 'GREEN', number_status: 'CONNECTED', name_status: 'DECLINED' });
  // A declined display name means customers see a bare number where a business name should be.
  expect(res.body.attention.some((a) => a.category === 'meta_name' && a.severity === 'warning')).toBe(true);
});

test('a customer message is not mistaken for a reply', async () => {
  // The trap: last_message_at moves when the CUSTOMER writes. An account with no outbound
  // at all must never read as answering.
  mockDb({
    businesses: [biz()],
    onboardings: ready(),
    conversations: [conversation({ last_inbound_at: minsAgo(30), last_message_at: minsAgo(30), unread_count: 3 })],
  });
  const res = await get();
  expect(res.body.accounts[0].agent.state).toBe('down');
  expect(res.body.accounts[0].last_outbound_at).toBeNull();
});

describe('a paused bot', () => {
  test('reads as paused, not as broken, and its waiting customers are not an incident', async () => {
    mockDb({
      businesses: [biz({ ai_config: { enabled: false } })],
      onboardings: ready(),
      conversations: [conversation({ last_inbound_at: minsAgo(40) })],
    });
    const res = await get();
    expect(res.body.accounts[0].agent).toMatchObject({ state: 'paused', label: 'موقوف مؤقتًا' });
    expect(res.body.accounts[0].bot_enabled).toBe(false);
    expect(categories(res)).not.toContain('unanswered');
  });
});

describe('no_knowledge, softened', () => {
  test('a connected generic shop with nothing entered is a warning, not critical', async () => {
    mockDb({
      businesses: [biz({ business_type: 'generic' })],
      onboardings: ready(),
      conversations: [conversation({ last_inbound_at: minsAgo(5), last_outbound_at: minsAgo(4) })],
    });
    const res = await get();
    expect(res.body.accounts[0].agent.state).toBe('degraded');
    const item = res.body.attention.find((a) => a.category === 'no_knowledge');
    expect(item).toMatchObject({ severity: 'warning', message: 'لم تُدخل معلومات المحل — البوت يرحّب فقط' });
  });

  test('before a number is connected it is not raised at all', async () => {
    mockDb({ businesses: [biz({ business_type: 'generic', wa_phone_number_id: null })] });
    expect(categories(await get())).not.toContain('no_knowledge');
  });

  test('a shop with knowledge entered is not flagged', async () => {
    mockDb({ businesses: [biz({ business_type: 'generic' })], onboardings: ready(), knowledge: [{ business_id: 'b1', _count: { _all: 3 } }] });
    expect(categories(await get())).not.toContain('no_knowledge');
  });
});

describe('contracts on the fleet view', () => {
  const daysFromNow = (d) => new Date(Date.now() + d * 86400000);
  const contract = (over = {}) => ({
    business_id: 'b1', solution: 'karam_bot', plan_name: null, status: 'active',
    amount_jod: 120, billing_cycle: 'monthly', next_due_at: daysFromNow(20), starts_at: new Date('2026-09-01'), ...over,
  });

  test('an account shows what it bought, with the amount', async () => {
    mockDb({ businesses: [biz()], onboardings: ready(), subs: [contract()] });
    const res = await get();
    expect(res.body.accounts[0].contract).toMatchObject({ solution: 'karam_bot', amount_jod: 120, status: 'active' });
    expect(categories(res)).not.toContain('no_contract');
  });

  test('an active account with nothing sold against it is pointed out', async () => {
    mockDb({ businesses: [biz()], onboardings: ready(), subs: [] });
    const res = await get();
    expect(res.body.accounts[0].contract).toBeNull();
    expect(res.body.attention.some((a) => a.category === 'no_contract' && a.severity === 'info')).toBe(true);
  });

  test('a shift-type row that is not marked internal is treated like any other account', async () => {
    // is_internal, not business_type, is what exempts a row now.
    mockDb({ businesses: [biz({ business_type: 'shift' })], onboardings: ready(), subs: [] });
    expect(categories(await get())).toContain('no_contract');
  });

  test('a payment due within a week is a heads-up; past its date it is a warning; past_due is critical', async () => {
    mockDb({ businesses: [biz()], onboardings: ready(), subs: [contract({ next_due_at: daysFromNow(3) })] });
    expect((await get()).body.attention.find((a) => a.category === 'due_soon')?.severity).toBe('info');

    mockDb({ businesses: [biz()], onboardings: ready(), subs: [contract({ next_due_at: daysFromNow(-4) })] });
    expect((await get()).body.attention.find((a) => a.category === 'overdue')?.severity).toBe('warning');

    mockDb({ businesses: [biz()], onboardings: ready(), subs: [contract({ status: 'past_due' })] });
    expect((await get()).body.attention.find((a) => a.category === 'past_due')?.severity).toBe('critical');
  });

  test('a cancelled contract does not count as the contract', async () => {
    mockDb({ businesses: [biz()], onboardings: ready(), subs: [contract({ status: 'cancelled' })] });
    // the route already excludes cancelled rows in its query; the mock returns what the query would
    prisma.subscription.findMany.mockResolvedValue([]);
    const res = await get();
    expect(res.body.accounts[0].contract).toBeNull();
  });
});

describe('accountHealth.isWaiting, the rule itself', () => {
  const { isWaiting, isHandoffWaiting } = require('../src/services/accountHealth');
  const NOW = new Date('2026-10-08T12:00:00Z').getTime();
  const at = (m) => new Date(NOW - m * 60000);

  test('exactly 15 minutes is not yet waiting; a second more is', () => {
    expect(isWaiting(conversation({ last_inbound_at: at(15) }), NOW)).toBe(false);
    expect(isWaiting(conversation({ last_inbound_at: new Date(NOW - 15 * 60000 - 1000) }), NOW)).toBe(true);
  });

  test('an outbound at the same instant as the inbound counts as answered', () => {
    expect(isWaiting(conversation({ last_inbound_at: at(30), last_outbound_at: at(30) }), NOW)).toBe(false);
  });

  test('a handoff answered after it was raised is done', () => {
    expect(isHandoffWaiting(conversation({ needs_attention: true, attention_at: at(90), last_outbound_at: at(80) }), NOW)).toBe(false);
    expect(isHandoffWaiting(conversation({ needs_attention: true, attention_at: at(90), last_outbound_at: at(100) }), NOW)).toBe(true);
  });
});
