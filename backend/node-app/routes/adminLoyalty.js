/**
 * Admin loyalty routes — Phase 4.
 *
 * Read/write endpoints for:
 *   - Loyalty earn policy settings (loyalty_earn_policy row in Settings)
 *   - Global loyalty ledger view (admin oversight)
 *
 * Strict admin-only. Read paths never use Mongo transactions so they remain
 * available on standalone Mongo (dev) without fallbacks.
 *
 * Phase 4 explicitly excludes redemption — only earn policy + visibility.
 */

const express = require('express');
const mongoose = require('mongoose');
const Settings = require('../models/Settings');
const LoyaltyLedger = require('../models/LoyaltyLedger');
const LoyaltyBalance = require('../models/LoyaltyBalance');
const User = require('../models/User');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const {
  SETTINGS_KEY: LOYALTY_SETTINGS_KEY,
  DEFAULT_POLICY,
  getLoyaltyEarnPolicy
} = require('../utils/loyaltySettings');
const { reconcileAllUsers, reconcileUserBalance, computeAvailablePoints } = require('../utils/loyaltyBalance');

const router = express.Router();

router.use(authMiddleware, adminMiddleware);

const VALID_EARN_MODES = new Set(['per_jd', 'per_visit']);

const nonNegativeNumber = (raw, defaultValue) => {
  const num = Number(raw);
  return Number.isFinite(num) && num >= 0 ? num : defaultValue;
};

const sanitisePayload = (raw) => {
  const value = raw && typeof raw === 'object' ? raw : {};

  const enabled = value.enabled === undefined ? DEFAULT_POLICY.enabled : !!value.enabled;

  const earn_mode = VALID_EARN_MODES.has(value.earn_mode)
    ? value.earn_mode
    : DEFAULT_POLICY.earn_mode;

  const points_per_jd = nonNegativeNumber(value.points_per_jd, DEFAULT_POLICY.points_per_jd);
  const fixed_points_per_visit = nonNegativeNumber(value.fixed_points_per_visit, DEFAULT_POLICY.fixed_points_per_visit);

  // Phase 9.4 guardrails — sanitise alongside earn fields so admin PUT can
  // update them in the same payload. Defaults applied on missing/invalid.
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

// GET /api/admin/loyalty/settings — current earn policy.
router.get('/settings', async (req, res) => {
  try {
    const policy = await getLoyaltyEarnPolicy();
    res.json({ settings: policy, defaults: DEFAULT_POLICY });
  } catch (error) {
    console.error('Get loyalty settings error:', error);
    res.status(500).json({ error: 'Failed to get loyalty settings' });
  }
});

// PUT /api/admin/loyalty/settings — replace the full policy row.
router.put('/settings', async (req, res) => {
  try {
    const next = sanitisePayload(req.body);
    await Settings.findOneAndUpdate(
      { key: LOYALTY_SETTINGS_KEY },
      { $set: { key: LOYALTY_SETTINGS_KEY, value: next, updated_at: new Date() } },
      { upsert: true, new: true }
    );
    res.json({ settings: next });
  } catch (error) {
    console.error('Update loyalty settings error:', error);
    res.status(500).json({ error: 'Failed to update loyalty settings' });
  }
});

// GET /api/admin/loyalty/ledger — paginated ledger view.
// Query: page (1-based), limit (default 25, max 100), userId (optional filter).
router.get('/ledger', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const rawLimit = parseInt(req.query.limit, 10) || 25;
    const limit = Math.min(100, Math.max(1, rawLimit));
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.userId && mongoose.Types.ObjectId.isValid(req.query.userId)) {
      filter.userId = new mongoose.Types.ObjectId(req.query.userId);
    }

    const [entries, total] = await Promise.all([
      LoyaltyLedger.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      LoyaltyLedger.countDocuments(filter)
    ]);

    const userIds = [...new Set(entries.map(e => e.userId?.toString()).filter(Boolean))];
    const users = await User.find({ _id: { $in: userIds } })
      .select('name email phone')
      .lean();
    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    const items = entries.map((entry) => {
      const u = userMap.get(entry.userId?.toString()) || null;
      return {
        id: entry._id?.toString(),
        userId: entry.userId?.toString(),
        user: u
          ? {
              id: u._id?.toString(),
              name: u.name || '',
              email: u.email || '',
              phone: u.phone || ''
            }
          : null,
        pointsDelta: entry.pointsDelta,
        reason: entry.reason || '',
        refType: entry.refType,
        refId: entry.refId?.toString?.() || String(entry.refId || ''),
        expiresAt: entry.expiresAt,
        createdAt: entry.createdAt
      };
    });

    res.json({
      items,
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit))
    });
  } catch (error) {
    console.error('Get loyalty ledger error:', error);
    res.status(500).json({ error: 'Failed to get loyalty ledger' });
  }
});

// Phase 9.5 — POST /api/admin/loyalty/reconcile
// Admin-triggered full reconcile. Recomputes LoyaltyBalance for every user
// that has any ledger activity, from ledger truth. Idempotent. Reports any
// detected drift (cached pointsAvailable differing from computed truth).
router.post('/reconcile', async (req, res) => {
  try {
    const result = await reconcileAllUsers();
    console.log('LOYALTY_RECONCILE_ADMIN', {
      scanned: result.scanned,
      corrected: result.corrected,
      negative_ledger_users: result.negative_ledger_users
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('Loyalty reconcile failed:', error);
    res.status(500).json({ error: 'Failed to reconcile loyalty balances' });
  }
});

// Phase 9.5 — GET /api/admin/loyalty/user/:userId
// Admin audit surface: shows cached balance side-by-side with ledger truth
// for a single user. Useful to investigate disputed balances without
// triggering a write.
router.get('/user/:userId', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    const userId = new mongoose.Types.ObjectId(req.params.userId);
    const [cached, truth] = await Promise.all([
      LoyaltyBalance.findOne({ userId }).lean(),
      computeAvailablePoints(userId)
    ]);
    res.json({
      userId: req.params.userId,
      cached_points: cached?.pointsAvailable || 0,
      cached_updated_at: cached?.updatedAt || null,
      ledger_points: truth.points,
      ledger_raw_sum: truth.raw,
      drift: truth.points - (cached?.pointsAvailable || 0),
      negative_ledger: truth.raw < 0
    });
  } catch (error) {
    console.error('Loyalty user audit failed:', error);
    res.status(500).json({ error: 'Failed to read user loyalty audit' });
  }
});

module.exports = router;
