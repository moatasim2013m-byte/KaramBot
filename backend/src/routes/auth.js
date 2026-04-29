const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');

function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!user.active) return res.status(403).json({ error: 'Account is inactive' });

    user.last_login = new Date();
    await user.save();

    const token = signToken(user._id);
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        business_id: user.business_id,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/register (platform_admin creates business users)
router.post('/register', authenticate, async (req, res) => {
  try {
    // Only platform_admin or business_owner can create users
    if (!['platform_admin', 'business_owner'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { name, email, password, role, business_id } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, password required' });

    // business_owner can only create staff/manager for their own business
    const targetBusinessId = req.user.role === 'platform_admin' ? business_id : req.user.business_id;
    const targetRole = req.user.role === 'platform_admin' ? (role || 'staff') : 'staff';

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    const user = await User.create({ name, email, password, role: targetRole, business_id: targetBusinessId });
    res.status(201).json({ id: user._id, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json({
    id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    business_id: req.user.business_id,
  });
});

module.exports = router;
