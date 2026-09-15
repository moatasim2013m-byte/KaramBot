'use strict';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// A reply to a customer message only needs to land before Meta closes the window, so a
// minute of slack is enough. Sweeper notes are sent on our own schedule and may queue
// behind retries, so they stop half an hour early.
const REPLY_WINDOW_MARGIN_MS = 60 * 1000;
const NOTE_WINDOW_MARGIN_MS = 30 * 60 * 1000;

function toDate(value) {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// `now` may be a Date, epoch ms, or a function returning either (injectable clock).
function resolveNow(now) {
  const value = typeof now === 'function' ? now() : now;
  if (value === null || value === undefined) return new Date();
  return value instanceof Date ? value : new Date(value);
}

/**
 * Determine whether a WhatsApp conversation is still inside the
 * 24-hour customer service window.
 *
 * @param {Date|string|number|null|undefined} lastInboundAt
 *        Timestamp of the most recent inbound message from the customer.
 * @param {Date|number|Function} [now=new Date()] Current time (injectable for testing).
 * @param {{marginMs?: number}} [options] Treat the window as closing `marginMs` early.
 * @returns {boolean} true if still within the 24h service window.
 */
function isWithinServiceWindow(lastInboundAt, now = new Date(), options = {}) {
  const last = toDate(lastInboundAt);
  if (!last) {
    return false;
  }

  const marginMs = Number((options && options.marginMs) || 0);
  const diff = resolveNow(now).getTime() - last.getTime();

  // Future timestamps (clock skew between Meta, the DB and this instance): treat as within window.
  if (diff < 0) {
    return true;
  }

  return diff <= TWENTY_FOUR_HOURS_MS - marginMs;
}

/**
 * When Meta closes the free-form window for this conversation (lastInboundAt + 24 h).
 * @returns {Date|null}
 */
function windowClosesAt(lastInboundAt) {
  const last = toDate(lastInboundAt);
  return last ? new Date(last.getTime() + TWENTY_FOUR_HOURS_MS) : null;
}

module.exports = {
  isWithinServiceWindow,
  windowClosesAt,
  TWENTY_FOUR_HOURS_MS,
  REPLY_WINDOW_MARGIN_MS,
  NOTE_WINDOW_MARGIN_MS,
};
