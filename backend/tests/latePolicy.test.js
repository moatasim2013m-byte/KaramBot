/**
 * The late-payment policy (decisions-2026-10-08.md #8; services/latePolicy.js), run by the daily
 * sweep: `late_policy.grace_days` after next_due_at with nothing paid, the Karam Bot contract turns
 * past_due and the bot pauses as SHIFT's, with pause_reason 'late_payment'. Idempotent (a second
 * sweep, or a second instance, writes nothing), recorded as AccountEvents, never applied to SHIFT's
 * own number or the internal rows, and lifted when a payment brings the contract back.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');
jest.mock('../src/services/metaStatus', () => ({ refresh: jest.fn(), metaAttention: jest.fn(() => []) }));
jest.mock('../src/services/alerts', () => ({
  ...jest.requireActual('../src/services/alerts'),
  sendStaffAlert: jest.fn(),
  notifyShift: jest.fn(),
}));

const axios = require('axios');
const db = require('./helpers/fakeDb').getFakeDb();
const platformSettings = require('../src/services/platformSettings');
const { applyLatePolicy, liftLatePause, isLatePause } = require('../src/services/latePolicy');
const { sweepDaily, resetDaily } = require('../src/services/shiftSweeper');

const NOW = new Date('2026-10-20T07:00:00Z');
const D = 24 * 3600000;
const daysAgo = (n) => new Date(NOW.getTime() - n * D);

const sub = (over) => ({
  solution: 'karam_bot', status: 'active', amount_jod: 19.99, billing_cycle: 'monthly',
  starts_at: daysAgo(60), created_by: 'admin1', ...over,
});

function seed() {
  db.seed({
    businesses: [
      { id: 'late', name: 'مطعم متأخر', business_type: 'restaurant', ai_config: { greeting_message: 'أهلًا' } },
      { id: 'grace', name: 'في المهلة', business_type: 'generic' },
      { id: 'trial', name: 'تجربة انتهت', business_type: 'generic' },
      { id: 'shift', name: 'SHIFT', business_type: 'shift' },
      { id: 'sim', name: 'sim', business_type: 'generic', is_internal: true },
      { id: 'owner_paused', name: 'أوقفه صاحبه', business_type: 'generic', ai_config: { enabled: false, paused_by: 'owner' } },
    ],
    subscriptions: [
      sub({ id: 's_late', business_id: 'late', next_due_at: daysAgo(8) }),
      sub({ id: 's_grace', business_id: 'grace', next_due_at: daysAgo(6) }),
      sub({ id: 's_trial', business_id: 'trial', status: 'trial', trial_ends_at: daysAgo(9), next_due_at: daysAgo(9) }),
      sub({ id: 's_shift', business_id: 'shift', next_due_at: daysAgo(30) }),
      sub({ id: 's_sim', business_id: 'sim', next_due_at: daysAgo(30) }),
      sub({ id: 's_owner', business_id: 'owner_paused', next_due_at: daysAgo(10) }),
    ],
  });
}

const biz = (id) => db.store.businesses.find((b) => b.id === id);
const subOf = (id) => db.store.subscriptions.find((s) => s.id === id);
const events = (type) => db.store.accountEvents.filter((e) => e.type === type);

/**
 * fakeDb's jsonb patches conversations only; businesses.ai_config is patched the same way here (a
 * top-level merge after the removals, as `(col - keys) || patch` does in Postgres).
 */
function patchBusinesses() {
  const real = db.jsonb.patchJson.bind(db.jsonb);
  jest.spyOn(db.jsonb, 'patchJson').mockImplementation(async (table, id, column, patch, opts = {}) => {
    if (table !== 'businesses') return real(table, id, column, patch, opts);
    const row = db.store.businesses.find((b) => b.id === id);
    if (!row) return { ok: false, count: 0 };
    const next = { ...(row[column] || {}) };
    for (const k of opts.remove || []) delete next[k];
    Object.assign(next, JSON.parse(JSON.stringify(patch)));
    row[column] = next;
    return { ok: true, count: 1 };
  });
}

beforeEach(() => {
  patchBusinesses();
  db.reset();
  db.clock.set(NOW);
  platformSettings.clearCache();
  resetDaily();
  jest.clearAllMocks();
  axios.get.mockReset().mockResolvedValue({ data: { data: { is_valid: true } } });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('past the grace days: past_due and the bot paused as SHIFT\'s, with the reason, both logged', async () => {
  seed();
  const out = await applyLatePolicy(NOW);

  // The owner's shop was already off: it is not counted (or logged) as paused a second time.
  expect(out).toMatchObject({ grace_days: 7, marked_past_due: 3, paused: 2, errors: 0 });
  expect(subOf('s_late').status).toBe('past_due');
  expect(biz('late').ai_config).toMatchObject({ greeting_message: 'أهلًا', enabled: false, paused_by: 'shift', pause_reason: 'late_payment' });
  expect(isLatePause(biz('late').ai_config)).toBe(true);
  // A free month that ended unpaid is late the same way.
  expect(subOf('s_trial').status).toBe('past_due');
  expect(isLatePause(biz('trial').ai_config)).toBe(true);
  // The owner's own pause becomes SHIFT's, so their switch cannot lift it while they owe, and the
  // pause it covers is kept for the payment to put back.
  expect(biz('owner_paused').ai_config).toMatchObject({
    paused_by: 'shift', pause_reason: 'late_payment', prior_pause: { paused_by: 'owner', pause_reason: null },
  });
  expect(events('bot_paused').some((e) => e.business_id === 'owner_paused')).toBe(false);

  expect(events('late_policy_applied').find((e) => e.business_id === 'late')).toMatchObject({
    actor_kind: 'system', data: { subscription_id: 's_late', from: 'active', grace_days: 7 },
  });
  expect(events('bot_paused').find((e) => e.business_id === 'late').data).toMatchObject({ reason: 'late_payment', subscription_id: 's_late' });
});

test('within the grace days nothing happens', async () => {
  seed();
  await applyLatePolicy(NOW);
  expect(subOf('s_grace').status).toBe('active');
  expect(biz('grace').ai_config.enabled).toBeUndefined();
});

test('SHIFT\'s own number and the internal rows are never touched', async () => {
  seed();
  await applyLatePolicy(NOW);
  expect(subOf('s_shift').status).toBe('active');
  expect(subOf('s_sim').status).toBe('active');
  expect(biz('shift').ai_config.enabled).toBeUndefined();
  expect(biz('sim').ai_config.enabled).toBeUndefined();
  expect(db.store.accountEvents.some((e) => ['shift', 'sim'].includes(e.business_id))).toBe(false);
});

test('idempotent: a second run writes nothing, and a bot SHIFT resumed by hand stays on for that due date', async () => {
  seed();
  await applyLatePolicy(NOW);
  const logged = db.store.accountEvents.length;

  expect(await applyLatePolicy(new Date(NOW.getTime() + 60000))).toMatchObject({ marked_past_due: 0, paused: 0 });
  expect(db.store.accountEvents).toHaveLength(logged);

  // SHIFT agrees to wait and switches the bot back on by hand: tomorrow's sweep leaves it.
  const { paused_by: _by, pause_reason: _why, ...rest } = biz('late').ai_config;
  biz('late').ai_config = { ...rest, enabled: true };
  expect((await applyLatePolicy(new Date(NOW.getTime() + D))).paused).toBe(0);
  expect(biz('late').ai_config.enabled).toBe(true);
});

test('the grace days come from late_policy', async () => {
  seed();
  await platformSettings.set('late_policy', { grace_days: 5 }, null);
  await applyLatePolicy(NOW);
  expect(subOf('s_grace').status).toBe('past_due');
});

test('a newer live contract decides, not an old one left behind', async () => {
  db.seed({
    businesses: [{ id: 'resigned', name: 'عاد واشترك' }],
    subscriptions: [
      sub({ id: 'old', business_id: 'resigned', next_due_at: daysAgo(40), created_at: daysAgo(90) }),
      sub({ id: 'new', business_id: 'resigned', next_due_at: new Date(NOW.getTime() + 20 * D), created_at: daysAgo(5) }),
    ],
  });
  await applyLatePolicy(NOW);
  expect(subOf('old').status).toBe('active');
  expect(biz('resigned').ai_config.enabled).toBeUndefined();
});

/** What the payment route leaves behind once the late cycle is paid: active, due a month on. */
const paidUp = (id) => Object.assign(subOf(id), { status: 'active', next_due_at: new Date(NOW.getTime() + 22 * D) });

test('liftLatePause lifts only the late policy\'s pause', async () => {
  seed();
  await applyLatePolicy(NOW);
  // Still owed: nothing is lifted.
  expect(await liftLatePause('late', { actorUserId: 'admin1', now: NOW })).toBe(false);
  expect(biz('late').ai_config.enabled).toBe(false);
  paidUp('s_late');
  expect(await liftLatePause('late', { actorUserId: 'admin1', now: NOW })).toBe(true);
  expect(biz('late').ai_config).toMatchObject({ greeting_message: 'أهلًا', enabled: true });
  expect(biz('late').ai_config.paused_by).toBeUndefined();
  expect(biz('late').ai_config.pause_reason).toBeUndefined();
  expect(events('bot_resumed')[0]).toMatchObject({ business_id: 'late', actor_kind: 'shift', data: { reason: 'payment_recorded' } });

  db.seed({ businesses: [{ id: 'manual', name: 'أوقفته شِفت', ai_config: { enabled: false, paused_by: 'shift' } }] });
  expect(await liftLatePause('manual')).toBe(false);
  expect(biz('manual').ai_config.enabled).toBe(false);
});

test('the daily sweep runs it once a day', async () => {
  seed();
  const first = await sweepDaily(NOW);
  expect(first.late).toMatchObject({ marked_past_due: 3, paused: 2 });
  expect(await sweepDaily(new Date(NOW.getTime() + 60000))).toBeNull();
});

test('an owner\'s pause the late policy covered comes back with the payment: the bot stays off', async () => {
  seed();
  await applyLatePolicy(NOW);
  paidUp('s_owner');
  expect(await liftLatePause('owner_paused', { actorUserId: 'admin1', now: NOW })).toBe(false);
  expect(biz('owner_paused').ai_config).toMatchObject({ enabled: false, paused_by: 'owner' });
  expect(biz('owner_paused').ai_config.pause_reason).toBeUndefined();
  expect(biz('owner_paused').ai_config.prior_pause).toBeUndefined();
  expect(events('bot_resumed')).toHaveLength(0);
});

test('a pause SHIFT made by hand before the shop went late stays after the payment', async () => {
  db.seed({
    businesses: [{ id: 'hand', name: 'أوقفته شِفت', ai_config: { enabled: false, paused_by: 'shift' } }],
    subscriptions: [sub({ id: 's_hand', business_id: 'hand', next_due_at: daysAgo(10) })],
  });
  await applyLatePolicy(NOW);
  expect(isLatePause(biz('hand').ai_config)).toBe(true);
  paidUp('s_hand');
  expect(await liftLatePause('hand', { actorUserId: 'admin1', now: NOW })).toBe(false);
  expect(biz('hand').ai_config).toMatchObject({ enabled: false, paused_by: 'shift' });
  expect(biz('hand').ai_config.pause_reason).toBeUndefined();
  expect(biz('hand').ai_config.prior_pause).toBeUndefined();
});

test('a payment on another contract, or a few dinars that leave the free month late, lift nothing', async () => {
  seed();
  db.seed({ subscriptions: [sub({ id: 's_web', business_id: 'late', solution: 'website', status: 'active', next_due_at: new Date(NOW.getTime() + 20 * D), created_at: daysAgo(1) })] });
  await applyLatePolicy(NOW);
  // The website contract is paid and active; the Karam Bot one is still past_due.
  expect(await liftLatePause('late', { actorUserId: 'admin1', now: NOW })).toBe(false);
  expect(isLatePause(biz('late').ai_config)).toBe(true);

  // The free month turned «فعّال» on a partial payment, its due date still past the grace days.
  Object.assign(subOf('s_trial'), { status: 'active' });
  expect(await liftLatePause('trial', { actorUserId: 'admin1', now: NOW })).toBe(false);
  expect(isLatePause(biz('trial').ai_config)).toBe(true);
});
