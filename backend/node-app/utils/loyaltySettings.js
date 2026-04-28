/**
 * Loyalty earn policy — Phase 3 + Phase 9.4 guardrails.
 *
 * Reads the `loyalty_earn_policy` row from the existing Settings collection
 * and returns a normalised, safe-default policy object.
 *
 * No DB write happens here. If the row is missing, the defaults are used —
 * i.e. loyalty earn is enabled by default at 1 point per JD, exactly as
 * specified in Phase 3.
 *
 * Shape stored under Settings.value:
 *   {
 *     enabled: true | false,
 *     earn_mode: 'per_jd' | 'per_visit',
 *     points_per_jd: number,               // used when earn_mode === 'per_jd'
 *     fixed_points_per_visit: number,      // used when earn_mode === 'per_visit'
 *
 *     // Phase 9.4 — financial guardrails.
 *     // Defaults to safe bounded values when absent.
 *     max_points_per_award: number,        // hard cap on any single award
 *     max_points_per_day: number,          // hard cap on user earns per UTC day
 *     redeem_min_points: number,           // minimum balance to initiate a redemption
 *     redeem_max_jd_per_booking: number    // max JD discount any one booking can redeem
 *   }
 */

const Settings = require('../models/Settings');

const SETTINGS_KEY = 'loyalty_earn_policy';

const DEFAULT_POLICY = Object.freeze({
  enabled: true,
  earn_mode: 'per_jd',
  points_per_jd: 1,
  fixed_points_per_visit: 10,
  // Phase 9.4 guardrails
  max_points_per_award: 100,
  max_points_per_day: 200,
  redeem_min_points: 50,
  redeem_max_jd_per_booking: 10
});

const VALID_EARN_MODES = new Set(['per_jd', 'per_visit']);

// Normalise a single non-negative number field, falling back to its default
// when absent, not a number, or negative. Shared by every guardrail field.
const nonNegativeNumber = (raw, defaultValue) => {
  const num = Number(raw);
  return Number.isFinite(num) && num >= 0 ? num : defaultValue;
};

const sanitisePolicy = (raw) => {
  const value = raw && typeof raw === 'object' ? raw : {};

  const enabled = value.enabled === undefined ? DEFAULT_POLICY.enabled : !!value.enabled;

  const earn_mode = VALID_EARN_MODES.has(value.earn_mode)
    ? value.earn_mode
    : DEFAULT_POLICY.earn_mode;

  const points_per_jd = nonNegativeNumber(value.points_per_jd, DEFAULT_POLICY.points_per_jd);
  const fixed_points_per_visit = nonNegativeNumber(value.fixed_points_per_visit, DEFAULT_POLICY.fixed_points_per_visit);

  const max_points_per_award = nonNegativeNumber(value.max_points_per_award, DEFAULT_POLICY.max_points_per_award);
  const max_points_per_day = nonNegativeNumber(value.max_points_per_day, DEFAULT_POLICY.max_points_per_day);
  const redeem_min_points = nonNegativeNumber(value.redeem_min_points, DEFAULT_POLICY.redeem_min_points);
  const redeem_max_jd_per_booking = nonNegativeNumber(value.redeem_max_jd_per_booking, DEFAULT_POLICY.redeem_max_jd_per_booking);

  return {
    enabled,
    earn_mode,
    points_per_jd,
    fixed_points_per_visit,
    max_points_per_award,
    max_points_per_day,
    redeem_min_points,
    redeem_max_jd_per_booking
  };
};

const getLoyaltyEarnPolicy = async () => {
  try {
    const doc = await Settings.findOne({ key: SETTINGS_KEY }).lean();
    if (!doc) return { ...DEFAULT_POLICY };
    return sanitisePolicy(doc.value);
  } catch (error) {
    // Never let settings errors break check-in. Fall back to defaults.
    console.warn('[loyaltySettings] read failed, using defaults:', error?.message);
    return { ...DEFAULT_POLICY };
  }
};

/**
 * Compute the integer points to award for a given booking amount under the
 * given policy. Returns 0 if disabled or amount is invalid.
 */
const computePointsForAmount = (policy, amountJd) => {
  if (!policy || !policy.enabled) return 0;

  if (policy.earn_mode === 'per_visit') {
    return Math.max(0, Math.round(Number(policy.fixed_points_per_visit) || 0));
  }

  // per_jd
  const amount = Number(amountJd);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const points = amount * (Number(policy.points_per_jd) || 0);
  return Math.max(0, Math.round(points));
};

module.exports = {
  SETTINGS_KEY,
  DEFAULT_POLICY,
  getLoyaltyEarnPolicy,
  computePointsForAmount
};
