/**
 * WhatsApp 24-hour customer service window helper.
 *
 * Meta only allows free-form outbound messages within 24 hours of the
 * customer's last inbound message. Outside that window, only approved
 * message templates may be sent.
 *
 * This helper answers a single question:
 *   "Is this conversation still inside the 24-hour service window?"
 */

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * @param {Date|string|number|null|undefined} lastInboundAt
 * @param {Date} [now=new Date()]
 * @returns {boolean}
 */
function isWithinServiceWindow(lastInboundAt, now = new Date()) {
  if (lastInboundAt === null || lastInboundAt === undefined) {
    return false;
  }

  const last = lastInboundAt instanceof Date ? lastInboundAt : new Date(lastInboundAt);
  if (Number.isNaN(last.getTime())) {
    return false;
  }

  const diffMs = now.getTime() - last.getTime();

  // Future timestamps (clock skew, test fixtures) are treated as within window.
  if (diffMs < 0) {
    return true;
  }

  return diffMs <= TWENTY_FOUR_HOURS_MS;
}

module.exports = { isWithinServiceWindow, TWENTY_FOUR_HOURS_MS };
