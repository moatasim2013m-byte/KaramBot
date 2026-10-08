/**
 * costGuard: what a shop's bot may spend (docs/panels/spec.md P1; decisions 6 and 7).
 *
 * The properties defended here: periods are Amman days and months; only a shop's own bot replies
 * count; the free month is a hard stop and a paying (or contract-less, hand-wired) shop is never
 * silenced; free-month shops stop first at the platform ceiling; SHIFT's own number is never
 * limited; 80% and 100% are each logged and told to SHIFT once a period; a database failure lets
 * the bot answer.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('../src/services/alerts', () => ({ notifyShift: jest.fn() }));

const db = require('./helpers/fakeDb').getFakeDb();
const alerts = require('../src/services/alerts');
const platformSettings = require('../src/services/platformSettings');
const guard = require('../src/services/costGuard');

// 2026-10-15 12:00 in Amman (UTC+3).
const NOW = new Date('2026-10-15T09:00:00Z');
const MIN = 60 * 1000;

function shop(over = {}) {
  return db.seed({ businesses: [{ id: 'shop', name: 'صيدلية النور', business_type: 'generic', ...over }] }).businesses[0];
}

function conv(businessId = 'shop') {
  return db.seed({ conversations: [{ business_id: businessId, customer_wa_id: `9627${Math.random().toString().slice(2, 10)}` }] }).conversations[0];
}

// n bot replies (or other messages) for a shop at `at`.
function messages(n, { businessId = 'shop', at = NOW, direction = 'outbound', ai = true, type = 'text' } = {}) {
  const c = conv(businessId);
  const rows = Array.from({ length: n }, () => ({
    business_id: businessId, conversation_id: c.id, direction, is_ai_generated: ai, message_type: type,
    status: 'sent', created_at: new Date(at),
  }));
  db.seed({ messages: rows });
}

function contract(over = {}) {
  db.seed({
    subscriptions: [{
      business_id: 'shop', solution: 'karam_bot', status: 'trial', amount_jod: 19.99, billing_cycle: 'monthly',
      starts_at: new Date('2026-10-01'), created_by: 'system', ai_replies_month: 1000, ...over,
    }],
  });
}

function limits(value) {
  db.seed({ platformSettings: [{ key: 'ai_limits', value }] });
  platformSettings.clearCache();
}

const events = (type) => db.store.accountEvents.filter((e) => e.type === type);

beforeEach(() => {
  db.reset();
  db.clock.set(NOW);
  guard.clearCache();
  platformSettings.clearCache();
  alerts.notifyShift.mockReset().mockResolvedValue(null);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('Amman periods', () => {
  test('a day and a month start at midnight in Amman, not UTC', () => {
    // 21:30 UTC on 31 Oct is 00:30 on 1 Nov in Amman.
    const late = new Date('2026-10-31T21:30:00Z');
    expect(guard.ammanDay(late)).toBe('2026-11-01');
    expect(guard.ammanMonth(late)).toBe('2026-11');
    expect(guard.dayStart(late).toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(guard.monthStart(late).toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(guard.monthStart(NOW).toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });
});

describe('counts', () => {
  test('monthly replies: this shop\'s bot replies since the 1st, Amman time', async () => {
    shop();
    shop({ id: 'other' });
    messages(3);
    messages(2, { at: '2026-09-30T20:59:00Z' }); // 23:59 on 30 Sep in Amman: last month
    messages(1, { at: '2026-09-30T21:01:00Z' }); // 00:01 on 1 Oct: this month
    messages(4, { ai: false }); // staff sends
    messages(5, { direction: 'inbound', ai: false });
    messages(7, { businessId: 'other' });
    expect(await guard.monthlyAiReplies('shop', { now: NOW })).toBe(4);
  });

  test('media today: voice notes, photos and videos since midnight; documents do not count', async () => {
    shop();
    messages(2, { direction: 'inbound', ai: false, type: 'audio' });
    messages(1, { direction: 'inbound', ai: false, type: 'image' });
    messages(1, { direction: 'inbound', ai: false, type: 'video' });
    messages(3, { direction: 'inbound', ai: false, type: 'document' });
    messages(4, { direction: 'inbound', ai: false, type: 'image', at: '2026-10-14T20:00:00Z' }); // yesterday 23:00
    expect(await guard.mediaReadsToday('shop', { now: NOW })).toBe(4);
  });

  test('platform today: customer shops only, never SHIFT\'s own number or the internal rows', async () => {
    shop();
    shop({ id: 'shift', business_type: 'shift', is_internal: true });
    shop({ id: 'sim', business_type: 'generic', is_internal: true });
    messages(3);
    messages(50, { businessId: 'shift' });
    messages(9, { businessId: 'sim' });
    messages(2, { at: '2026-10-14T12:00:00Z' });
    expect(await guard.platformAiRepliesToday({ now: NOW })).toBe(3);
  });

  test('counts are cached for 60 s, and a reply this instance saved is added at once', async () => {
    shop();
    messages(2);
    expect(await guard.monthlyAiReplies('shop', { now: NOW })).toBe(2);
    messages(5);
    expect(await guard.monthlyAiReplies('shop', { now: new Date(NOW.getTime() + 30 * 1000) })).toBe(2);
    guard.noteReply('shop', { now: NOW });
    expect(await guard.monthlyAiReplies('shop', { now: new Date(NOW.getTime() + 30 * 1000) })).toBe(3);
    expect(await guard.monthlyAiReplies('shop', { now: new Date(NOW.getTime() + 61 * 1000) })).toBe(7);
  });
});

describe('allow', () => {
  test('under every limit: allowed, nothing logged', async () => {
    const b = shop();
    contract();
    messages(10);
    expect(await guard.allow(b, 'reply', { now: NOW })).toEqual({ ok: true, reason: null });
    expect(db.store.accountEvents).toHaveLength(0);
    expect(alerts.notifyShift).not.toHaveBeenCalled();
  });

  test('free month at the cap: the bot stops (hard)', async () => {
    const b = shop();
    contract({ status: 'trial', ai_replies_month: 20 });
    messages(20);
    expect(await guard.allow(b, 'reply', { now: NOW })).toEqual({ ok: false, reason: 'monthly_cap' });
  });

  test('a paying shop at the cap keeps answering (soft) and SHIFT is told', async () => {
    const b = shop();
    contract({ status: 'active', ai_replies_month: 20 });
    messages(25);
    expect(await guard.allow(b, 'reply', { now: NOW })).toEqual({ ok: true, reason: 'monthly_cap', soft: true });
    expect(events('cap_reached')).toHaveLength(1);
    expect(alerts.notifyShift).toHaveBeenCalledWith(expect.objectContaining({ reason: 'cap_reached', businessId: 'shop' }));
  });

  test('a newer website or automation trial never makes a paying bot shop\'s cap hard (P1 review)', async () => {
    const b = shop();
    contract({ status: 'active', ai_replies_month: 20, created_at: new Date('2026-10-01') });
    contract({ solution: 'website', status: 'trial', ai_replies_month: null, created_at: new Date('2026-10-10') });
    messages(25);
    expect(await guard.allow(b, 'reply', { now: NOW })).toEqual({ ok: true, reason: 'monthly_cap', soft: true });
  });

  test('a newer paid non-bot contract never makes a free-month bot shop look paid (P1 review)', async () => {
    const b = shop();
    contract({ status: 'trial', ai_replies_month: 20, created_at: new Date('2026-10-01') });
    contract({ solution: 'automation', status: 'active', ai_replies_month: 5000, created_at: new Date('2026-10-10') });
    messages(20);
    expect(await guard.allow(b, 'reply', { now: NOW })).toEqual({ ok: false, reason: 'monthly_cap' });
  });

  test('a hand-wired shop with no contract is never silenced by the cap', async () => {
    const b = shop();
    limits({ reply_month_default: 5 });
    messages(9);
    expect(await guard.allow(b, 'reply', { now: NOW })).toMatchObject({ ok: true, reason: 'monthly_cap', soft: true });
  });

  test('the cap is the contract\'s own number, then PlatformSetting ai_limits, then the plan', async () => {
    shop();
    expect((await guard.limitsFor('shop')).replyMonth).toBe(1000);
    limits({ reply_month_default: 300 });
    expect((await guard.limitsFor('shop')).replyMonth).toBe(300);
    contract({ ai_replies_month: 50 });
    expect((await guard.limitsFor('shop')).replyMonth).toBe(50);
    // A cancelled contract is not the contract.
    db.store.subscriptions[0].status = 'cancelled';
    expect((await guard.limitsFor('shop')).replyMonth).toBe(300);
  });

  test('80% and the cap are each logged and told to SHIFT once a month', async () => {
    const b = shop();
    contract({ status: 'trial', ai_replies_month: 10 });
    messages(8);
    await guard.allow(b, 'reply', { now: NOW });
    await guard.allow(b, 'reply', { now: NOW });
    expect(events('cap_80')).toHaveLength(1);
    expect(events('cap_80')[0].data).toMatchObject({ used: 8, cap: 10, month: '2026-10' });
    expect(events('cap_reached')).toHaveLength(0);
    expect(alerts.notifyShift).toHaveBeenCalledTimes(1);
    expect(alerts.notifyShift.mock.calls[0][0]).toMatchObject({ reason: 'cap_80', summary: 'استهلك 80% من ردود الشهر (8 / 10)' });

    messages(2);
    guard.clearCache(); // a new instance: the log, not the memo, says 80% was already told
    await guard.allow(b, 'reply', { now: new Date(NOW.getTime() + 2 * MIN) });
    expect(events('cap_80')).toHaveLength(1);
    expect(events('cap_reached')).toHaveLength(1);
    expect(alerts.notifyShift).toHaveBeenCalledTimes(2);
    expect(alerts.notifyShift.mock.calls[1][0].summary).toContain('البوت يحوّل الزبائن للفريق');

    // Next month starts clean.
    const nov = new Date('2026-11-02T09:00:00Z');
    db.clock.set(nov);
    messages(9, { at: nov });
    await guard.allow(b, 'reply', { now: nov });
    expect(events('cap_80')).toHaveLength(2);
  });

  test('platform ceiling: free-month shops stop first, paying shops carry on', async () => {
    const trial = shop();
    const paid = shop({ id: 'paid', name: 'مطعم' });
    contract({ status: 'trial' });
    db.seed({ subscriptions: [{ business_id: 'paid', solution: 'karam_bot', status: 'active', amount_jod: 19.99, starts_at: NOW, created_by: 'x' }] });
    limits({ platform_day_ceiling: 5 });
    messages(3);
    messages(2, { businessId: 'paid' });

    expect(await guard.allow(trial, 'reply', { now: NOW })).toEqual({ ok: false, reason: 'platform_ceiling' });
    expect(await guard.allow(paid, 'reply', { now: NOW })).toEqual({ ok: true, reason: 'platform_ceiling', soft: true });
    expect(events('platform_ceiling')).toHaveLength(1);
    expect(events('platform_ceiling')[0].business_id).toBeNull();
    expect(alerts.notifyShift).toHaveBeenCalledWith(expect.objectContaining({ reason: 'platform_ceiling' }));
  });

  test('ceiling_policy all: everyone stops at the ceiling', async () => {
    const paid = shop();
    contract({ status: 'active' });
    limits({ platform_day_ceiling: 2, ceiling_policy: 'all' });
    messages(2);
    expect(await guard.allow(paid, 'reply', { now: NOW })).toEqual({ ok: false, reason: 'platform_ceiling' });
  });

  test('daily media cap: the message being read is counted, so the cap itself is allowed', async () => {
    const b = shop();
    contract({ status: 'trial' });
    limits({ media_day_default: 3 });
    messages(3, { direction: 'inbound', ai: false, type: 'audio' });
    expect(await guard.allow(b, 'media', { now: NOW })).toEqual({ ok: true, reason: null });
    guard.clearCache();
    messages(1, { direction: 'inbound', ai: false, type: 'image' });
    expect(await guard.allow(b, 'media', { now: NOW })).toEqual({ ok: false, reason: 'media_cap' });
    // Text still gets an answer.
    expect(await guard.allow(b, 'reply', { now: NOW })).toEqual({ ok: true, reason: null });
  });

  test('SHIFT\'s own number and the internal rows are never limited, and nothing is read for them', async () => {
    const shift = shop({ id: 'shift', business_type: 'shift' });
    const sim = shop({ id: 'sim', is_internal: true });
    const count = jest.spyOn(db.prisma.message, 'count');
    expect(await guard.allow(shift, 'reply', { now: NOW })).toEqual({ ok: true, reason: null });
    expect(await guard.allow(sim, 'media', { now: NOW })).toEqual({ ok: true, reason: null });
    expect(count).not.toHaveBeenCalled();
  });

  test('a failed count lets the bot answer', async () => {
    const b = shop();
    contract({ status: 'trial', ai_replies_month: 1 });
    messages(5);
    db.failNext('message.count', new Error('db down'));
    expect(await guard.allow(b, 'reply', { now: NOW })).toEqual({ ok: true, reason: null });
  });
});
