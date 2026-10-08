/**
 * The join campaign's daily chores (services/accountsDaily.js, run by shiftSweeper.sweepDaily):
 * invite expiry, the 14-day free-month backstop, and the free-month reminders 3 days before the end
 * and on the day. Each is written once (AccountEvent), so a second run the same day, or another
 * instance, repeats nothing; old invites and contracts are not woken up; SHIFT's own and internal
 * rows are left alone.
 */
require('./setup');

jest.mock('axios');
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const db = require('./helpers/fakeDb').getFakeDb();
const alerts = require('../src/services/alerts');
const platformSettings = require('../src/services/platformSettings');
const { runAccountsDaily, reminderKind } = require('../src/services/accountsDaily');
const { sweepDaily, resetDaily } = require('../src/services/shiftSweeper');

const DAY = 24 * 3600 * 1000;
// 2026-10-15 09:00 in Amman.
const NOW = new Date('2026-10-15T06:00:00Z');
const at = (days) => new Date(NOW.getTime() + days * DAY);
const events = (type) => db.store.accountEvents.filter((e) => e.type === type);

let notify;
let staffAlert;

beforeEach(() => {
  db.reset();
  db.clock.set(NOW);
  platformSettings.clearCache();
  resetDaily();
  jest.restoreAllMocks();
  notify = jest.spyOn(alerts, 'notifyShift').mockResolvedValue(null);
  staffAlert = jest.spyOn(alerts, 'sendStaffAlert').mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('invite expiry', () => {
  function seedInvites() {
    db.seed({
      businesses: [{ id: 'b1', name: 'محل جود', wa_phone_number_id: null }, { id: 'b2', name: 'صالون', wa_phone_number_id: null }],
      users: [
        { id: 'o1', role: 'business_owner', business_id: 'b1', active: false },
        { id: 'o2', role: 'business_owner', business_id: 'b2', active: true, last_login: at(-3) },
        { id: 's1', role: 'staff', business_id: 'b1', active: false },
      ],
      userActivations: [
        { id: 'a_expired', user_id: 'o1', token_hash: 'h1', expires_at: at(-0.5), created_by: 'x' },
        { id: 'a_live', user_id: 'o1', token_hash: 'h2', expires_at: at(2), created_by: 'x' },
        { id: 'a_used', user_id: 'o1', token_hash: 'h3', expires_at: at(-1), used_at: at(-2), created_by: 'x' },
        { id: 'a_ancient', user_id: 'o1', token_hash: 'h4', expires_at: at(-40), created_by: 'x' },
        // The owner got in another way; their leftover link is not a lost invite.
        { id: 'a_signed_in', user_id: 'o2', token_hash: 'h5', expires_at: at(-1), created_by: 'x' },
        { id: 'a_staff', user_id: 's1', token_hash: 'h6', expires_at: at(-1), created_by: 'x' },
      ],
    });
  }

  test('an owner\'s unused link that ran out is logged once', async () => {
    seedInvites();
    const out = await runAccountsDaily(NOW);
    expect(out.invites_expired).toBe(1);
    expect(events('invite_expired')).toEqual([expect.objectContaining({
      business_id: 'b1', actor_kind: 'system', data: expect.objectContaining({ activation_id: 'a_expired', user_id: 'o1' }),
    })]);

    expect((await runAccountsDaily(at(1))).invites_expired).toBe(0);
    expect(events('invite_expired')).toHaveLength(1);
  });
});

describe('the free month', () => {
  function seedTrial({ connectedDaysAgo = 3, endsInDays = 20, wentLive = null, extra = {} } = {}) {
    db.seed({
      businesses: [{
        id: 'b1', name: 'مطعم الشام', business_type: 'restaurant', wa_access_token: 'enc', connected_at: at(-connectedDaysAgo),
        went_live_at: wentLive, owner_phone: '962791234567', ai_config: { alert_wa_numbers: ['962791234567'] }, ...extra,
      }],
      subscriptions: [{
        id: 'sub1', business_id: 'b1', solution: 'karam_bot', status: 'trial', amount_jod: 19.99, billing_cycle: 'monthly',
        starts_at: at(-connectedDaysAgo), trial_ends_at: endsInDays === null ? null : at(endsInDays),
        next_due_at: endsInDays === null ? null : at(endsInDays), created_by: 'system',
      }],
    });
  }

  test('14 days after connect with no first reply, the free month has started: logged once', async () => {
    seedTrial({ connectedDaysAgo: 15, endsInDays: 29 });
    expect((await runAccountsDaily(NOW)).trials_started).toBe(1);
    expect(events('trial_started')).toEqual([expect.objectContaining({
      business_id: 'b1', data: expect.objectContaining({ subscription_id: 'sub1', reason: 'backstop' }),
    })]);
    expect((await runAccountsDaily(at(1))).trials_started).toBe(0);
  });

  test('a contract made without an end date gets the backstop one', async () => {
    seedTrial({ connectedDaysAgo: 15, endsInDays: null });
    await runAccountsDaily(NOW);
    const sub = db.store.subscriptions[0];
    expect(sub.trial_ends_at).toEqual(at(-15 + 14 + 30));
    expect(sub.next_due_at).toEqual(sub.trial_ends_at);
  });

  test('a shop that went live, or connected recently, is not a backstop', async () => {
    seedTrial({ connectedDaysAgo: 15, wentLive: at(-10) });
    expect((await runAccountsDaily(NOW)).trials_started).toBe(0);
    db.reset();
    seedTrial({ connectedDaysAgo: 5 });
    expect((await runAccountsDaily(NOW)).trials_started).toBe(0);
  });

  test('3 days before the end: SHIFT and the owner are told, once', async () => {
    seedTrial({ endsInDays: 2.5 });
    expect((await runAccountsDaily(NOW)).trial_reminders).toBe(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'trial_ending', businessId: 'b1', summary: expect.stringContaining('تنتهي خلال 3 أيام'),
    }));
    expect(staffAlert).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'trial_reminder', business: expect.objectContaining({ id: 'b1' }), summary: expect.stringContaining('الاشتراك'),
    }));

    await runAccountsDaily(at(0.5)); // the same contract, later the same day
    expect(notify).toHaveBeenCalledTimes(1);
  });

  test('on the day it ends: the second reminder, once', async () => {
    seedTrial({ endsInDays: 0.3 });
    db.seed({ accountEvents: [{ business_id: 'b1', actor_kind: 'system', type: 'trial_reminder', data: { subscription_id: 'sub1', days: 3 } }] });
    await runAccountsDaily(NOW);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].summary).toContain('تنتهي اليوم');
    expect(events('trial_reminder').map((e) => e.data.days)).toEqual([3, 0]);
    await runAccountsDaily(NOW);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  test('far from the end, long ended, paying, internal or SHIFT: no reminder', async () => {
    seedTrial({ endsInDays: 10 });
    await runAccountsDaily(NOW);
    db.reset();
    seedTrial({ endsInDays: -10 });
    await runAccountsDaily(NOW);
    db.reset();
    seedTrial({ endsInDays: 1, extra: { is_internal: true } });
    await runAccountsDaily(NOW);
    db.reset();
    seedTrial({ endsInDays: 1, extra: { business_type: 'shift' } });
    await runAccountsDaily(NOW);
    expect(notify).not.toHaveBeenCalled();
    expect(staffAlert).not.toHaveBeenCalled();
  });

  test('a shop with no number yet still tells SHIFT, and nothing is sent from a number it lacks', async () => {
    seedTrial({ endsInDays: 2, extra: { wa_phone_number_id: null, wa_access_token: null } });
    await runAccountsDaily(NOW);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(staffAlert).not.toHaveBeenCalled();
  });

  test('reminderKind counts Amman calendar days', () => {
    // 23:30 Amman the night before the end at 01:00: «today» is tomorrow, so this is the 3-day one.
    const late = new Date('2026-10-15T20:30:00Z');
    expect(reminderKind(new Date('2026-10-15T22:00:00Z'), late)).toBe(3);
    expect(reminderKind(new Date('2026-10-15T20:45:00Z'), late)).toBe(0);
    expect(reminderKind(new Date('2026-10-19T20:45:00Z'), late)).toBe(null);
    expect(reminderKind(null, late)).toBe(null);
  });
});

test('the sweep runs the chores once a day, with its other daily work', async () => {
  db.seed({
    businesses: [{ id: 'b1', name: 'محل جود', wa_phone_number_id: null }],
    users: [{ id: 'o1', role: 'business_owner', business_id: 'b1', active: false }],
    userActivations: [{ id: 'a1', user_id: 'o1', token_hash: 'h1', expires_at: at(-0.5), created_by: 'x' }],
  });
  const first = await sweepDaily(NOW);
  expect(first.accounts).toMatchObject({ invites_expired: 1, errors: 0 });
  expect(await sweepDaily(new Date(NOW.getTime() + 60 * 1000))).toBeNull();
  expect(events('invite_expired')).toHaveLength(1);
});
