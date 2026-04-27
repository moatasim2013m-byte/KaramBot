/**
 * Mongo transaction support detector — Phase 3 infra patch.
 *
 * Mongoose transactions require a replica set / mongos. In standalone-mongo
 * dev environments any startTransaction() call fails with:
 *   "Transaction numbers are only allowed on a replica set member or mongos"
 *
 * This helper probes once on first call and caches the result, so the rest
 * of the codebase can fall back to a non-transactional write path when
 * transactions are unavailable WITHOUT every caller having to re-implement
 * the detection.
 */

const mongoose = require('mongoose');

let cached = null;

const TRANSACTION_UNSUPPORTED_PATTERNS = [
  'Transaction numbers are only allowed',
  'IllegalOperation: Transaction',
  'requires replica set'
];

const isTransactionUnsupportedError = (error) => {
  const message = String(error?.message || error || '');
  return TRANSACTION_UNSUPPORTED_PATTERNS.some((p) => message.includes(p));
};

const supportsTransactions = async () => {
  if (cached !== null) return cached;
  if (mongoose.connection.readyState !== 1) {
    // Connection not ready — assume yes (will fall back at runtime if wrong).
    return true;
  }
  let session;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    await session.abortTransaction();
    cached = true;
  } catch (err) {
    if (isTransactionUnsupportedError(err)) {
      cached = false;
    } else {
      // Unknown error — be conservative and assume yes.
      cached = true;
    }
  } finally {
    if (session) await session.endSession().catch(() => {});
  }
  return cached;
};

module.exports = {
  supportsTransactions,
  isTransactionUnsupportedError
};
