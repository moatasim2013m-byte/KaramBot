/**
 * The plan SHIFT sells (config/plans.js) and the free-month contract built from it.
 *
 * The numbers are the decisions doc's (docs/panels/decisions-2026-10-08.md #4 and #5) and the price
 * is the one the sales bot quotes, so these pin them: changing one should be a decision, not a typo.
 * A Subscription copies the terms it was sold on, so a later change never rewrites a deal.
 */
require('./setup');

const { DEFAULT_PLAN, planSnapshot, trialEndsAt, trialSubscriptionData } = require('../src/config/plans');

const DAY = 24 * 60 * 60 * 1000;
const CONNECTED = new Date('2026-10-10T09:00:00Z');
const days = (n, from = CONNECTED) => new Date(from.getTime() + n * DAY);

describe('the default plan', () => {
  test('carries the decided terms', () => {
    expect(DEFAULT_PLAN).toEqual({
      solution: 'karam_bot',
      name: 'باقة كرم بوت',
      price_jod: 19.99,
      billing_cycle: 'monthly',
      ai_replies_month: 1000,
      seats: 3,
      trial_days: 30,
      trial_backstop_days: 14,
      media_reads_day: 30,
    });
  });

  test('cannot be changed at run time', () => {
    expect(Object.isFrozen(DEFAULT_PLAN)).toBe(true);
  });

  test('the price is the one the sales bot quotes', () => {
    const source = require('fs').readFileSync(require.resolve('../src/workflows/shift/objectives'), 'utf8');
    expect(source).toContain(`${DEFAULT_PLAN.price_jod} دينار بالشهر`);
  });
});

describe('planSnapshot', () => {
  test('copies the terms a contract keeps', () => {
    expect(planSnapshot()).toEqual({
      solution: 'karam_bot', plan_name: 'باقة كرم بوت', amount_jod: 19.99, billing_cycle: 'monthly',
      ai_replies_month: 1000, seats: 3,
    });
  });

  test('takes another plan', () => {
    const custom = { ...DEFAULT_PLAN, name: 'باقة خاصة', price_jod: 30, ai_replies_month: 3000, seats: 5 };
    expect(planSnapshot(custom)).toMatchObject({ plan_name: 'باقة خاصة', amount_jod: 30, ai_replies_month: 3000, seats: 5 });
  });
});

describe('trialEndsAt', () => {
  test('first reply before the backstop: 30 days from the first reply', () => {
    const firstReplyAt = days(3);
    expect(trialEndsAt({ connectedAt: CONNECTED, firstReplyAt })).toEqual(days(33));
  });

  test('no reply yet: the latest it can end, connect + 14 + 30 days', () => {
    expect(trialEndsAt({ connectedAt: CONNECTED })).toEqual(days(44));
  });

  test('a first reply after the backstop does not move the start later', () => {
    expect(trialEndsAt({ connectedAt: CONNECTED, firstReplyAt: days(20) })).toEqual(days(44));
  });

  test("trial_starts 'connect' starts the month at connect", () => {
    expect(trialEndsAt({ connectedAt: CONNECTED, firstReplyAt: days(3), trialStarts: 'connect' })).toEqual(days(30));
  });

  test('a campaign can override the lengths', () => {
    expect(trialEndsAt({ connectedAt: CONNECTED, trialDays: 60, backstopDays: 7 })).toEqual(days(67));
  });

  test('accepts ISO strings', () => {
    expect(trialEndsAt({ connectedAt: CONNECTED.toISOString(), firstReplyAt: days(1).toISOString() })).toEqual(days(31));
  });

  test('needs connectedAt', () => {
    expect(() => trialEndsAt({})).toThrow(TypeError);
  });
});

describe('trialSubscriptionData', () => {
  test('a free-month contract on the plan terms, first payment due when it ends', () => {
    const data = trialSubscriptionData({ businessId: 'b1', createdBy: 'u1', connectedAt: CONNECTED, campaign: 'irbid-2026-10' });
    expect(data).toEqual({
      business_id: 'b1',
      solution: 'karam_bot',
      plan_name: 'باقة كرم بوت',
      amount_jod: 19.99,
      billing_cycle: 'monthly',
      ai_replies_month: 1000,
      seats: 3,
      status: 'trial',
      starts_at: CONNECTED,
      trial_ends_at: days(44),
      next_due_at: days(44),
      campaign: 'irbid-2026-10',
      created_by: 'u1',
    });
  });

  test('defaults: created by the system, no campaign', () => {
    const data = trialSubscriptionData({ businessId: 'b1', connectedAt: CONNECTED });
    expect(data.created_by).toBe('system');
    expect(data.campaign).toBeNull();
  });

  test('with a first reply the month runs from it', () => {
    const data = trialSubscriptionData({ businessId: 'b1', connectedAt: CONNECTED, firstReplyAt: days(2) });
    expect(data.trial_ends_at).toEqual(days(32));
  });

  test('needs a business', () => {
    expect(() => trialSubscriptionData({ connectedAt: CONNECTED })).toThrow(TypeError);
  });
});
