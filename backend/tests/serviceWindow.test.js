require('./setup');
const {
  isWithinServiceWindow,
  windowClosesAt,
  TWENTY_FOUR_HOURS_MS,
  REPLY_WINDOW_MARGIN_MS,
  NOTE_WINDOW_MARGIN_MS,
} = require('../src/utils/serviceWindow');

describe('isWithinServiceWindow', () => {
  const NOW = new Date('2025-06-01T12:00:00Z');

  test('returns false when lastInboundAt is null', () => {
    expect(isWithinServiceWindow(null, NOW)).toBe(false);
  });

  test('returns false when lastInboundAt is undefined', () => {
    expect(isWithinServiceWindow(undefined, NOW)).toBe(false);
  });

  test('returns false when lastInboundAt is an invalid date string', () => {
    expect(isWithinServiceWindow('not-a-date', NOW)).toBe(false);
  });

  test('returns true when message was 1 hour ago', () => {
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
    expect(isWithinServiceWindow(oneHourAgo, NOW)).toBe(true);
  });

  test('returns true when message was exactly at the boundary (24h ago)', () => {
    const exactly24hAgo = new Date(NOW.getTime() - TWENTY_FOUR_HOURS_MS);
    expect(isWithinServiceWindow(exactly24hAgo, NOW)).toBe(true);
  });

  test('returns false when message was 25 hours ago', () => {
    const twentyFiveHoursAgo = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
    expect(isWithinServiceWindow(twentyFiveHoursAgo, NOW)).toBe(false);
  });

  test('returns true when lastInboundAt is a future timestamp (tolerant)', () => {
    const future = new Date(NOW.getTime() + 10000);
    expect(isWithinServiceWindow(future, NOW)).toBe(true);
  });

  test('accepts ISO string as lastInboundAt', () => {
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    expect(isWithinServiceWindow(oneHourAgo, NOW)).toBe(true);
  });

  test('accepts timestamp number as lastInboundAt', () => {
    const oneHourAgo = NOW.getTime() - 60 * 60 * 1000;
    expect(isWithinServiceWindow(oneHourAgo, NOW)).toBe(true);
  });

  test('returns false exactly one millisecond past the window', () => {
    const justOutside = new Date(NOW.getTime() - TWENTY_FOUR_HOURS_MS - 1);
    expect(isWithinServiceWindow(justOutside, NOW)).toBe(false);
  });
});

describe('isWithinServiceWindow — margin and injectable clock', () => {
  const NOW = new Date('2025-06-01T12:00:00Z');
  const hoursAgo = (h) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

  test('margin constants', () => {
    expect(REPLY_WINDOW_MARGIN_MS).toBe(60 * 1000);
    expect(NOTE_WINDOW_MARGIN_MS).toBe(30 * 60 * 1000);
  });

  test('a 30 min margin excludes a message from 23 h 45 m ago', () => {
    const last = hoursAgo(23.75);
    expect(isWithinServiceWindow(last, NOW)).toBe(true);
    expect(isWithinServiceWindow(last, NOW, { marginMs: NOTE_WINDOW_MARGIN_MS })).toBe(false);
  });

  test('a 30 min margin still allows 23 h 30 m exactly', () => {
    expect(isWithinServiceWindow(hoursAgo(23.5), NOW, { marginMs: NOTE_WINDOW_MARGIN_MS })).toBe(true);
  });

  test('the reply margin keeps a message from 23 h 40 m ago answerable', () => {
    expect(isWithinServiceWindow(hoursAgo(23 + 40 / 60), NOW, { marginMs: REPLY_WINDOW_MARGIN_MS })).toBe(true);
  });

  test('future timestamps stay inside with a margin', () => {
    expect(isWithinServiceWindow(new Date(NOW.getTime() + 5000), NOW, { marginMs: NOTE_WINDOW_MARGIN_MS })).toBe(true);
  });

  test('null stays outside with a margin', () => {
    expect(isWithinServiceWindow(null, NOW, { marginMs: REPLY_WINDOW_MARGIN_MS })).toBe(false);
  });

  test('now as a function returning a Date', () => {
    const clock = jest.fn(() => NOW);
    expect(isWithinServiceWindow(hoursAgo(1), clock)).toBe(true);
    expect(isWithinServiceWindow(hoursAgo(25), clock)).toBe(false);
    expect(clock).toHaveBeenCalled();
  });

  test('now as a function returning epoch ms, and now as a number', () => {
    expect(isWithinServiceWindow(hoursAgo(1), () => NOW.getTime())).toBe(true);
    expect(isWithinServiceWindow(hoursAgo(25), NOW.getTime())).toBe(false);
  });
});

describe('windowClosesAt', () => {
  test('returns lastInboundAt + 24 h', () => {
    const last = '2025-06-01T12:00:00.000Z';
    expect(windowClosesAt(last).toISOString()).toBe('2025-06-02T12:00:00.000Z');
    expect(windowClosesAt(new Date(last))).toBeInstanceOf(Date);
  });

  test('accepts a Postgres jsonb timestamp string', () => {
    expect(windowClosesAt('2026-09-14T08:00:00.123456+00:00').toISOString()).toBe('2026-09-15T08:00:00.123Z');
  });

  test('returns null for null or invalid input', () => {
    expect(windowClosesAt(null)).toBeNull();
    expect(windowClosesAt(undefined)).toBeNull();
    expect(windowClosesAt('not-a-date')).toBeNull();
  });
});
