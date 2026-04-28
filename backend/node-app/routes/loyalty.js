const express = require('express');
const mongoose = require('mongoose');
const LoyaltyLedger = require('../models/LoyaltyLedger');
const LoyaltyBalance = require('../models/LoyaltyBalance');
const { authMiddleware } = require('../middleware/auth');
const { supportsTransactions, isTransactionUnsupportedError } = require('../utils/mongoFeatures');
const { computeAvailablePoints } = require('../utils/loyaltyBalance');
const { getLoyaltyEarnPolicy } = require('../utils/loyaltySettings');
const { previewRedemptionForUser } = require('../utils/loyaltyRedemption');

const router = express.Router();

const DUPLICATE_KEY_CODE = 11000;

const addMonths = (date, months) => {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
};

const toObjectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  return new mongoose.Types.ObjectId(value);
};

// Legacy alias — kept so existing internal callers in this file keep working.
// Phase 9.5: balance truth lives in utils/loyaltyBalance.computeAvailablePoints.
const getNonExpiredPoints = async (userId /* , session */) => {
  const { points } = await computeAvailablePoints(userId);
  return points;
};

const upsertBalance = async (userId, pointsAvailable, session) => {
  return LoyaltyBalance.findOneAndUpdate(
    { userId },
    {
      $set: {
        pointsAvailable,
        updatedAt: new Date()
      }
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      session
    }
  );
};

async function awardPoints(userId, points, reason, refType, refId) {
  const numericPoints = Number(points);
  if (!Number.isFinite(numericPoints) || numericPoints <= 0) {
    throw new Error('Points must be a positive number');
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const expiresAt = addMonths(new Date(), 12);
    const [ledgerEntry] = await LoyaltyLedger.create([
      {
        userId,
        pointsDelta: numericPoints,
        reason,
        refType,
        refId,
        expiresAt
      }
    ], { session });

    const currentPoints = await getNonExpiredPoints(userId, session);
    const balance = await upsertBalance(userId, currentPoints, session);

    await session.commitTransaction();
    return { ledgerEntry, balance };
  } catch (error) {
    await session.abortTransaction();

    if (error?.code === DUPLICATE_KEY_CODE) {
      const duplicateError = new Error('Loyalty points already awarded for this reference');
      duplicateError.code = 'LOYALTY_DUPLICATE_REFERENCE';
      throw duplicateError;
    }

    throw error;
  } finally {
    await session.endSession();
  }
}

async function redeemPoints(userId, pointsToRedeem, refType, refId) {
  const numericPoints = Number(pointsToRedeem);
  if (!Number.isFinite(numericPoints) || numericPoints <= 0) {
    throw new Error('Points to redeem must be a positive number');
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const availablePoints = await getNonExpiredPoints(userId, session);
    if (availablePoints < numericPoints) {
      const balanceError = new Error('Insufficient loyalty points');
      balanceError.code = 'LOYALTY_INSUFFICIENT_POINTS';
      throw balanceError;
    }

    const [ledgerEntry] = await LoyaltyLedger.create([
      {
        userId,
        pointsDelta: -numericPoints,
        reason: 'Points redemption',
        refType,
        refId,
        expiresAt: null
      }
    ], { session });

    const updatedPoints = availablePoints - numericPoints;
    if (updatedPoints < 0) {
      const nonNegativeError = new Error('Loyalty balance cannot be negative');
      nonNegativeError.code = 'LOYALTY_NEGATIVE_BALANCE';
      throw nonNegativeError;
    }

    const balance = await upsertBalance(userId, updatedPoints, session);

    await session.commitTransaction();
    return { ledgerEntry, balance };
  } catch (error) {
    await session.abortTransaction();

    if (error?.code === DUPLICATE_KEY_CODE) {
      const duplicateError = new Error('Points already redeemed for this reference');
      duplicateError.code = 'LOYALTY_DUPLICATE_REFERENCE';
      throw duplicateError;
    }

    throw error;
  } finally {
    await session.endSession();
  }
}

// Read-only — Phase 4: never opens a Mongo session/transaction.
// The cached LoyaltyBalance row is a write-side optimisation; reads compute
// the truth straight from the ledger so this endpoint stays available on
// standalone Mongo (no replica set) without any fallback machinery.
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    const pointsAvailable = await getNonExpiredPoints(req.userId, null);
    // Phase 6 — include the minimum redemption policy fields parents need
    // to decide whether the UI should show the redemption section. Kept
    // in a nested `redemption` block to preserve the legacy response
    // shape (tests / older clients read `pointsAvailable` + `jdValue`).
    let redemption = null;
    try {
      const policy = await getLoyaltyEarnPolicy();
      redemption = {
        enabled: !!(policy.enabled && policy.redemption_enabled),
        loyalty_enabled: !!policy.enabled,
        redemption_enabled: !!policy.redemption_enabled,
        redeem_min_points: policy.redeem_min_points,
        redeem_max_jd_per_booking: policy.redeem_max_jd_per_booking,
        points_per_jd_redeem: policy.points_per_jd_redeem
      };
    } catch (_) {
      // Policy load failure must not break the balance response.
      redemption = null;
    }
    res.json({
      pointsAvailable,
      jdValue: pointsAvailable / 100,
      redemption
    });
  } catch (error) {
    console.error('Get loyalty balance error:', error);
    res.status(500).json({ error: 'Failed to get loyalty balance' });
  }
});

// Phase 6 — parent-facing redemption preview. Used by the checkout UI
// to show the exact discount / points-to-spend pair before the user
// commits. Never writes. Never throws on validation failures — they
// come back as `{ ok:false, reason }` with a safe reason code.
router.get('/redemption-preview', authMiddleware, async (req, res) => {
  try {
    const amountJd = Number(req.query.amount_jd);
    const pointsRequested = Number(req.query.points || 0);
    const useMax = String(req.query.use_max || '').toLowerCase() === 'true';

    if (!Number.isFinite(amountJd) || amountJd <= 0) {
      return res.status(400).json({ error: 'amount_jd must be a positive number' });
    }

    const preview = await previewRedemptionForUser({
      userId: req.userId,
      amountJd,
      pointsRequested: Number.isFinite(pointsRequested) ? pointsRequested : 0,
      useMax
    });
    res.json(preview);
  } catch (error) {
    console.error('Loyalty redemption preview error:', error);
    res.status(500).json({ error: 'Failed to preview loyalty redemption' });
  }
});

router.get('/history', authMiddleware, async (req, res) => {
  try {
    const history = await LoyaltyLedger.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ history });
  } catch (error) {
    console.error('Get loyalty history error:', error);
    res.status(500).json({ error: 'Failed to get loyalty history' });
  }
});

router.awardPoints = awardPoints;
router.redeemPoints = redeemPoints;

module.exports = router;
