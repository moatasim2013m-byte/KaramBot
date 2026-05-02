require('./setup');
const { isWithinServiceWindow, TWENTY_FOUR_HOURS_MS } = require('../src/utils/serviceWindow');

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
