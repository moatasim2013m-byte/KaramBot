/**
 * Loyalty earn policy — Phase 3.
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
 *     points_per_jd: number,           // used when earn_mode === 'per_jd'
 *     fixed_points_per_visit: number   // used when earn_mode === 'per_visit'
 *   }
 */

const Settings = require('../models/Settings');

const SETTINGS_KEY = 'loyalty_earn_policy';

const DEFAULT_POLICY = Object.freeze({
  enabled: true,
  earn_mode: 'per_jd',
  points_per_jd: 1,
  fixed_points_per_visit: 10
});

const VALID_EARN_MODES = new Set(['per_jd', 'per_visit']);

const sanitisePolicy = (raw) => {
  const value = raw && typeof raw === 'object' ? raw : {};

  const enabled = value.enabled === undefined ? DEFAULT_POLICY.enabled : !!value.enabled;

  const earn_mode = VALID_EARN_MODES.has(value.earn_mode)
    ? value.earn_mode
    : DEFAULT_POLICY.earn_mode;

  const ppjRaw = Number(value.points_per_jd);
  const points_per_jd = Number.isFinite(ppjRaw) && ppjRaw >= 0
    ? ppjRaw
    : DEFAULT_POLICY.points_per_jd;

  const fppvRaw = Number(value.fixed_points_per_visit);
  const fixed_points_per_visit = Number.isFinite(fppvRaw) && fppvRaw >= 0
    ? fppvRaw
    : DEFAULT_POLICY.fixed_points_per_visit;

  return { enabled, earn_mode, points_per_jd, fixed_points_per_visit };
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
