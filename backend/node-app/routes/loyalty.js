const express = require('express');
const mongoose = require('mongoose');
const LoyaltyLedger = require('../models/LoyaltyLedger');
const LoyaltyBalance = require('../models/LoyaltyBalance');
const { authMiddleware } = require('../middleware/auth');
const { supportsTransactions, isTransactionUnsupportedError } = require('../utils/mongoFeatures');

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

const getNonExpiredPoints = async (userId, session) => {
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
  ]).session(session);

  return Math.max(0, summary?.total || 0);
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

router.get('/balance', authMiddleware, async (req, res) => {
  try {
    let pointsAvailable = 0;

    const txnAvailable = await supportsTransactions();
    if (txnAvailable) {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();
        pointsAvailable = await getNonExpiredPoints(req.userId, session);
        await upsertBalance(req.userId, pointsAvailable, session);
        await session.commitTransaction();
      } catch (error) {
        await session.abortTransaction().catch(() => {});
        if (isTransactionUnsupportedError(error)) {
          // Topology changed mid-flight — fall back below.
          pointsAvailable = await getNonExpiredPoints(req.userId, null);
          await upsertBalance(req.userId, pointsAvailable, null);
        } else {
          throw error;
        }
      } finally {
        await session.endSession().catch(() => {});
      }
    } else {
      pointsAvailable = await getNonExpiredPoints(req.userId, null);
      await upsertBalance(req.userId, pointsAvailable, null);
    }

    res.json({
      pointsAvailable,
      jdValue: pointsAvailable / 100
    });
  } catch (error) {
    console.error('Get loyalty balance error:', error);
    res.status(500).json({ error: 'Failed to get loyalty balance' });
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
