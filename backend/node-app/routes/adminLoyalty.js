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
const User = require('../models/User');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const {
  SETTINGS_KEY: LOYALTY_SETTINGS_KEY,
  DEFAULT_POLICY,
  getLoyaltyEarnPolicy
} = require('../utils/loyaltySettings');

const router = express.Router();

router.use(authMiddleware, adminMiddleware);

const VALID_EARN_MODES = new Set(['per_jd', 'per_visit']);

const sanitisePayload = (raw) => {
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

module.exports = router;
