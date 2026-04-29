const express = require('express');
const router = express.Router();
const { authenticate, requireRole, attachBusinessId } = require('../middleware/auth');
const User = require('../models/User');

router.use(authenticate, attachBusinessId);

// GET /api/staff - list staff for a business
router.get('/', requireRole('platform_admin', 'business_owner', 'manager'), async (req, res) => {
  try {
    const query = req.user.role === 'platform_admin'
      ? {}
      : { business_id: req.businessId };

    const users = await User.find(query).select('-password').sort({ created_at: -1 });
    res.json({ staff: users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/staff/:id - update staff (toggle active, change role)
router.patch('/:id', requireRole('platform_admin', 'business_owner'), async (req, res) => {
  try {
    const { active, role } = req.body;
    const update = {};
    if (active !== undefined) update.active = active;
    if (role) update.role = role;

    const user = await User.findOneAndUpdate(
      { _id: req.params.id, business_id: req.businessId },
      update,
      { new: true },
    ).select('-password');

    if (!user) return res.status(404).json({ error: 'Staff member not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
