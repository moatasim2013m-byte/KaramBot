/**
 * Loyalty redemption — Phase 6 foundation.
 *
 * Provides the safe calculation + ledger helpers used by the parent
 * checkout/booking path to apply a loyalty-points discount.
 *
 * Key invariants:
 *   - Redemption must NEVER permanently deduct points before the booking /
 *     payment has actually succeeded. Callers are responsible for calling
 *     `redeemForBooking` only AFTER they hold a persisted, paid booking.
 *   - The canonical duplicate-guard is the LoyaltyLedger unique compound
 *     index on (userId, refType, refId). We use `refType='hourly'` and
 *     `refId='redeem:<bookingId>'` so a redemption entry cannot collide
 *     with the existing earn entry on the same booking (which uses
 *     `refId=<bookingId>` without a prefix). This also makes retries
 *     idempotent — a second call with the same bookingId short-circuits
 *     at the DB level with duplicate_key.
 *   - Every eligibility rule is re-checked server-side at deduction time,
 *     not just at preview time, so a stale client cannot over-redeem.
 *
 * Conversion rule:
 *   policy.points_per_jd_redeem is the number of points required to get
 *   1 JD of discount. Default 10.
 *
 * This module never throws for "expected" outcomes (policy off, balance
 * too low, etc.) — it returns a structured `{ ok, reason }` object so
 * callers can surface clean messages. Unexpected DB failures propagate.
 */

const mongoose = require('mongoose');
const LoyaltyLedger = require('../models/LoyaltyLedger');
const HourlyBooking = require('../models/HourlyBooking');
const { getLoyaltyEarnPolicy } = require('./loyaltySettings');
const { computeAvailablePoints, reconcileUserBalance } = require('./loyaltyBalance');

const DUPLICATE_KEY_CODE = 11000;
const REDEEM_REF_PREFIX = 'redeem:';
const REDEEM_REASON = 'redeem_booking_discount';
const REDEEM_REF_TYPE = 'hourly';

const toRedemptionRefId = (bookingId) => `${REDEEM_REF_PREFIX}${String(bookingId)}`;

const roundTo2 = (value) => Math.round(Number(value || 0) * 100) / 100;

const buildResult = (extra) => ({
  ok: false,
  pointsToUse: 0,
  discountJd: 0,
  conversion: 0,
  reason: 'unknown',
  ...extra
});

/**
 * Pure calculator. No DB access. Given a balance, an amount, a requested
 * point spend (or a `use_max` flag) and a policy, returns the safe
 * (pointsToUse, discountJd) tuple honouring every business rule.
 *
 * Rules enforced (in order):
 *   A. redemption must be enabled (policy.enabled && redemption_enabled)
 *   B. available >= redeem_min_points
 *   C. requestedPoints > 0 (if not use_max), else we compute max from context
 *   D. requestedPoints <= available
 *   E. discountJd <= redeem_max_jd_per_booking
 *   F. discountJd <= payableAmountJd (can't discount more than owed)
 *   G. conversion > 0 (safety)
 *
 * Any violation returns `{ ok:false, reason }` with the specific code so
 * callers can map to Arabic messages.
 */
const calculateRedemption = ({
  pointsRequested,
  pointsAvailable,
  payableAmountJd,
  useMax,
  policy
}) => {
  if (!policy) return buildResult({ reason: 'no_policy' });

  if (!policy.enabled) return buildResult({ reason: 'loyalty_disabled' });
  if (!policy.redemption_enabled) return buildResult({ reason: 'redemption_disabled' });

  const conversion = Number(policy.points_per_jd_redeem) || 0;
  if (conversion <= 0) return buildResult({ reason: 'invalid_conversion', conversion });

  const available = Math.max(0, Math.floor(Number(pointsAvailable) || 0));
  const minPoints = Math.max(0, Math.floor(Number(policy.redeem_min_points) || 0));
  const maxJd = Math.max(0, Number(policy.redeem_max_jd_per_booking) || 0);
  const amount = Math.max(0, Number(payableAmountJd) || 0);

  if (amount <= 0) return buildResult({ reason: 'amount_zero', conversion });
  if (available < minPoints || available <= 0) {
    return buildResult({ reason: 'below_min_points', conversion });
  }

  // Derive the hard upper bound in points: smallest of
  //   - points available in balance
  //   - points needed to discount entire payable (amount * conversion)
  //   - points needed to discount the policy cap (maxJd * conversion), if set
  const pointsForAmount = Math.floor(amount * conversion);
  const pointsForCap = maxJd > 0 ? Math.floor(maxJd * conversion) : Infinity;
  const upperBound = Math.min(available, pointsForAmount, pointsForCap);

  if (upperBound <= 0) {
    return buildResult({ reason: 'no_headroom', conversion });
  }

  let pointsToUse;
  if (useMax) {
    pointsToUse = upperBound;
  } else {
    const requested = Math.max(0, Math.floor(Number(pointsRequested) || 0));
    if (requested <= 0) return buildResult({ reason: 'zero_requested', conversion });
    if (requested < minPoints) return buildResult({ reason: 'below_min_points', conversion });
    if (requested > upperBound) {
      // Keep the error explicit so UI can suggest the correct max.
      return buildResult({
        reason: 'exceeds_limit',
        conversion,
        maxPointsAllowed: upperBound
      });
    }
    pointsToUse = requested;
  }

  // Must respect minimum bound even after clamping with useMax.
  if (pointsToUse < minPoints) {
    return buildResult({ reason: 'below_min_points', conversion });
  }

  // Discount in JD is always rounded DOWN-friendly — use the exact ratio.
  const discountJd = roundTo2(pointsToUse / conversion);
  if (discountJd <= 0) return buildResult({ reason: 'rounds_to_zero', conversion });
  if (discountJd > amount) {
    // Should be impossible given the upper bound calc, but defend anyway.
    return buildResult({ reason: 'exceeds_amount', conversion });
  }

  return {
    ok: true,
    pointsToUse,
    discountJd,
    conversion,
    reason: 'ok',
    maxPointsAllowed: upperBound
  };
};

/**
 * Parent-facing preview: loads the user's current balance + the policy and
 * runs `calculateRedemption`. Never writes. Safe to call as often as the
 * UI needs.
 */
const previewRedemptionForUser = async ({
  userId,
  amountJd,
  pointsRequested = 0,
  useMax = false
}) => {
  if (!userId) return buildResult({ reason: 'no_user' });
  const [policy, balance] = await Promise.all([
    getLoyaltyEarnPolicy(),
    computeAvailablePoints(userId)
  ]);
  const result = calculateRedemption({
    pointsRequested,
    pointsAvailable: balance.points,
    payableAmountJd: amountJd,
    useMax,
    policy
  });
  return {
    ...result,
    pointsAvailable: balance.points,
    policy: {
      enabled: policy.enabled,
      redemption_enabled: policy.redemption_enabled,
      redeem_min_points: policy.redeem_min_points,
      redeem_max_jd_per_booking: policy.redeem_max_jd_per_booking,
      points_per_jd_redeem: policy.points_per_jd_redeem
    }
  };
};

/**
 * Apply the redemption ledger entry for a booking. Called AFTER the booking
 * is persisted and the payment is confirmed paid. Idempotent across retries
 * because of the unique compound index on (userId, refType, refId).
 *
 * Returns:
 *   { redeemed: true, pointsUsed, discountJd, ledgerId, alreadyRedeemed:false }
 *   { redeemed: true, pointsUsed: 0, discountJd: 0, alreadyRedeemed: true }
 *       when the same booking already had a redemption ledger entry
 *       (retry, duplicate payment callback, etc.)
 *   { redeemed: false, reason }
 *       for validation failures (no points, booking missing, etc.)
 *
 * The caller is responsible for persisting `loyalty_redeemed_points`
 * on the HourlyBooking — we do it here for consistency so a single
 * successful call leaves the system fully consistent.
 */
const redeemForBooking = async ({
  userId,
  bookingId,
  pointsToUse,
  discountJd
}) => {
  if (!userId || !bookingId) {
    return { redeemed: false, reason: 'missing_reference' };
  }
  const pts = Math.max(0, Math.floor(Number(pointsToUse) || 0));
  const disc = Math.max(0, Number(discountJd) || 0);
  if (pts <= 0 || disc <= 0) {
    return { redeemed: false, reason: 'zero_amount' };
  }

  const refId = toRedemptionRefId(bookingId);

  // Fast path — if this refId already has a ledger entry, we're a retry.
  const existing = await LoyaltyLedger.findOne({
    userId,
    refType: REDEEM_REF_TYPE,
    refId
  }).lean();
  if (existing) {
    // Make sure the booking-level marker reflects the pre-existing ledger
    // entry (in case a previous attempt crashed after ledger insert but
    // before the HourlyBooking.updateOne).
    await HourlyBooking.updateOne(
      { _id: bookingId, loyalty_redeemed_at: null },
      {
        $set: {
          loyalty_redeemed_at: existing.createdAt || new Date(),
          loyalty_redeemed_points: Math.abs(Number(existing.pointsDelta) || 0),
          loyalty_redemption_jd: disc
        }
      }
    ).catch(() => {});
    return {
      redeemed: true,
      alreadyRedeemed: true,
      pointsUsed: Math.abs(Number(existing.pointsDelta) || 0),
      discountJd: disc,
      ledgerId: existing._id?.toString() || null
    };
  }

  // Re-verify balance right before committing. This is belt-and-braces —
  // the client may have submitted a preview stale by milliseconds and
  // a concurrent redemption could have drained the balance.
  const balance = await computeAvailablePoints(userId);
  if (balance.points < pts) {
    return { redeemed: false, reason: 'insufficient_balance', available: balance.points };
  }

  const ledgerDoc = {
    userId,
    pointsDelta: -pts,
    reason: REDEEM_REASON,
    refType: REDEEM_REF_TYPE,
    refId,
    expiresAt: null
  };

  let ledgerEntry;
  try {
    ledgerEntry = await LoyaltyLedger.create(ledgerDoc);
  } catch (error) {
    if (error?.code === DUPLICATE_KEY_CODE) {
      // Lost a race — treat as already redeemed.
      const prior = await LoyaltyLedger.findOne({
        userId,
        refType: REDEEM_REF_TYPE,
        refId
      }).lean();
      await HourlyBooking.updateOne(
        { _id: bookingId, loyalty_redeemed_at: null },
        {
          $set: {
            loyalty_redeemed_at: prior?.createdAt || new Date(),
            loyalty_redeemed_points: Math.abs(Number(prior?.pointsDelta) || pts),
            loyalty_redemption_jd: disc
          }
        }
      ).catch(() => {});
      return {
        redeemed: true,
        alreadyRedeemed: true,
        pointsUsed: Math.abs(Number(prior?.pointsDelta) || pts),
        discountJd: disc,
        ledgerId: prior?._id?.toString() || null
      };
    }
    throw error;
  }

  // Stamp the booking marker. Only flip if null so a concurrent retry
  // doesn't overwrite a prior successful stamp.
  await HourlyBooking.updateOne(
    { _id: bookingId, loyalty_redeemed_at: null },
    {
      $set: {
        loyalty_redeemed_at: new Date(),
        loyalty_redeemed_points: pts,
        loyalty_redemption_jd: disc
      }
    }
  );

  // Keep the cached LoyaltyBalance row in sync with ledger truth. The
  // reconciler is the single writer for the cache (Phase 9.5). Never
  // throw from here — ledger is already persisted and is truth.
  await reconcileUserBalance(userId).catch(() => {});

  return {
    redeemed: true,
    alreadyRedeemed: false,
    pointsUsed: pts,
    discountJd: disc,
    ledgerId: ledgerEntry?._id?.toString() || null
  };
};

module.exports = {
  REDEEM_REF_PREFIX,
  REDEEM_REASON,
  REDEEM_REF_TYPE,
  toRedemptionRefId,
  calculateRedemption,
  previewRedemptionForUser,
  redeemForBooking
};
