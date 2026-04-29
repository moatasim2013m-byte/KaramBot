const express = require('express');
const router = express.Router();
const { authenticate, requireRole, attachBusinessId } = require('../middleware/auth');
const Business = require('../models/Business');

router.use(authenticate);

// GET /api/businesses - list (platform_admin) or own (owner)
router.get('/', async (req, res) => {
  try {
    const query = req.user.role === 'platform_admin' ? {} : { _id: req.user.business_id };
    const businesses = await Business.find(query).select('-wa_access_token');
    res.json({ businesses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/:id
router.get('/:id', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'platform_admin';
    const filter = { _id: req.params.id };
    if (!isAdmin) filter._id = req.user.business_id; // enforce own business

    const biz = await Business.findOne(filter).select('-wa_access_token');
    if (!biz) return res.status(404).json({ error: 'Business not found' });
    res.json({ business: biz });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/businesses - create (platform_admin only)
router.post('/', requireRole('platform_admin'), async (req, res) => {
  try {
    const biz = await Business.create(req.body);
    res.status(201).json({ business: biz });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/businesses/:id - update settings
router.patch('/:id', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'platform_admin';
    if (!isAdmin && req.user.business_id?.toString() !== req.params.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Never allow token update via this route (dedicated secure endpoint needed)
    delete req.body.wa_access_token;

    const biz = await Business.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }).select('-wa_access_token');
    if (!biz) return res.status(404).json({ error: 'Business not found' });
    res.json({ business: biz });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/businesses/:id/token - update WhatsApp token (owner/admin only)
router.patch('/:id/token', requireRole('platform_admin', 'business_owner'), async (req, res) => {
  try {
    if (req.user.role !== 'platform_admin' && req.user.business_id?.toString() !== req.params.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { wa_access_token } = req.body;
    if (!wa_access_token) return res.status(400).json({ error: 'wa_access_token required' });

    await Business.findByIdAndUpdate(req.params.id, { wa_access_token });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
