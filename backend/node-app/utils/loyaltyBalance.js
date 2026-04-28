/**
 * Loyalty balance — Phase 9.5 single source of truth.
 *
 * Until Phase 9 there were two places computing "available points":
 *   - routes/loyalty.js → getNonExpiredPoints
 *   - utils/awardPoints.js → getNonExpiredPoints (duplicated definition)
 * Both used identical math but nothing enforced that they stayed in sync,
 * and the cached LoyaltyBalance row had no reconciliation path when earns
 * expired silently (expiresAt crosses `now` without any write happening).
 *
 * This module consolidates the rule so every read/write path derives
 * balance the same way, and exposes a reconcile helper that the cache
 * writers AND the admin/cron surfaces can call.
 *
 * Balance rule (append-only ledger is truth):
 *   available = sum of pointsDelta where
 *                 pointsDelta < 0  (redemptions always count, no expiry)
 *              OR expiresAt = null (non-expiring earns always count)
 *              OR expiresAt > now (earns not yet expired)
 *   clamped at zero (negative is always a bug — redemption outstripping
 *   available earn — and is logged by the reconciler).
 *
 * Reconciliation: computeAvailablePoints + upsertCachedBalance. This is
 * the ONLY writer of LoyaltyBalance.pointsAvailable going forward.
 */

const mongoose = require('mongoose');
const LoyaltyLedger = require('../models/LoyaltyLedger');
const LoyaltyBalance = require('../models/LoyaltyBalance');

const toObjectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  return new mongoose.Types.ObjectId(String(value));
};

/**
 * Read-only. Pure aggregation over the ledger. Never throws on standalone
 * Mongo; never opens a transaction.
 */
const computeAvailablePoints = async (userId) => {
  if (!userId) return { points: 0, raw: 0 };
  const now = new Date();
  const [summary] = await LoyaltyLedger.aggregate([
    { $match: { userId: toObjectId(userId) } },
    {
      $match: {
        $or: [
          { pointsDelta: { $lt: 0 } },
          { expiresAt: null },
          { expiresAt: { $gt: now } }
        ]
      }
    },
    { $group: { _id: null, total: { $sum: '$pointsDelta' } } }
  ]);
  const raw = summary?.total || 0;
  return { points: Math.max(0, raw), raw };
};

/**
 * Reconcile a single user's cached balance against ledger truth. Idempotent.
 * Returns { previous, current, drift, negativeLedger } so callers can log
 * any drift detected (useful in the cron reconciler).
 */
const reconcileUserBalance = async (userId) => {
  if (!userId) return { previous: 0, current: 0, drift: 0, negativeLedger: false };
  const { points, raw } = await computeAvailablePoints(userId);

  const cached = await LoyaltyBalance.findOne({ userId: toObjectId(userId) }).lean();
  const previous = cached?.pointsAvailable || 0;

  await LoyaltyBalance.findOneAndUpdate(
    { userId: toObjectId(userId) },
    { $set: { pointsAvailable: points, updatedAt: new Date() } },
    { upsert: true, setDefaultsOnInsert: true }
  );

  return {
    previous,
    current: points,
    drift: points - previous,
    negativeLedger: raw < 0
  };
};

/**
 * Reconcile every user who has any ledger activity. Used by the admin cron
 * and by the manual /admin/loyalty/reconcile endpoint. Returns aggregate
 * stats and the list of users whose cached balance drifted from truth.
 */
const reconcileAllUsers = async () => {
  const userIds = await LoyaltyLedger.distinct('userId');
  let scanned = 0;
  let corrected = 0;
  let negativeFound = 0;
  const drifts = [];

  for (const uid of userIds) {
    scanned += 1;
    const result = await reconcileUserBalance(uid);
    if (result.drift !== 0) {
      corrected += 1;
      drifts.push({
        userId: uid.toString(),
        previous: result.previous,
        current: result.current,
        drift: result.drift
      });
    }
    if (result.negativeLedger) negativeFound += 1;
  }

  return { scanned, corrected, negative_ledger_users: negativeFound, drifts };
};

module.exports = {
  computeAvailablePoints,
  reconcileUserBalance,
  reconcileAllUsers
};
