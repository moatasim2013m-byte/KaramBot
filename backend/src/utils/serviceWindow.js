'use strict';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Determine whether a WhatsApp conversation is still inside the
 * 24-hour customer service window.
 *
 * @param {Date|string|number|null|undefined} lastInboundAt
 *        Timestamp of the most recent inbound message from the customer.
 * @param {Date} [now=new Date()] Current time (injectable for testing).
 * @returns {boolean} true if still within the 24h service window.
 */
function isWithinServiceWindow(lastInboundAt, now = new Date()) {
  if (lastInboundAt === null || lastInboundAt === undefined) {
    return false;
  }

  const last = lastInboundAt instanceof Date
    ? lastInboundAt
    : new Date(lastInboundAt);

  if (Number.isNaN(last.getTime())) {
    return false;
  }

  const diff = now.getTime() - last.getTime();

  // Future timestamps: treat as within window.
  if (diff < 0) {
    return true;
  }

  return diff <= TWENTY_FOUR_HOURS_MS;
}

module.exports = { isWithinServiceWindow, TWENTY_FOUR_HOURS_MS };
