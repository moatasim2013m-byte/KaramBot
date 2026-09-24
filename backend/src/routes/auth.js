const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
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

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true, name: true, email: true, role: true,
        business_id: true, active: true, password: true,
      },
    });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    if (!user.active) return res.status(403).json({ error: 'Account is inactive' });

    await prisma.user.update({
      where: { id: user.id },
      data: { last_login: new Date() },
    });

    const token = signToken(user.id);

    let business_type = null;
    if (user.business_id) {
      try {
        const business = await prisma.business.findUnique({
          where: { id: user.business_id },
          select: { business_type: true },
        });
        business_type = business ? business.business_type : null;
      } catch (e) {
        business_type = null;
      }
    }

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        business_id: user.business_id,
        business_type,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/register (platform_admin creates business users)
router.post('/register', authenticate, async (req, res) => {
  try {
    if (!['platform_admin', 'business_owner'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { name, email, password, role, business_id } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, password required' });

    const targetBusinessId = req.user.role === 'platform_admin' ? business_id : req.user.business_id;
    const targetRole = req.user.role === 'platform_admin' ? (role || 'staff') : 'staff';

    // A tenant user with no business is the shape that used to slip past request scoping,
    // and it is meaningless anyway: staff belong to a business. Only platform_admin may
    // exist without one.
    if (targetRole !== 'platform_admin' && !targetBusinessId) {
      return res.status(400).json({ error: 'business_id required for a non-admin user' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashed,
        role: targetRole,
        business_id: targetBusinessId || null,
      },
    });
    res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json({
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    business_id: req.user.business_id,
    business_type: req.user.business_type,
  });
});

/**
 * Redeeming an activation link. Public by necessity — the customer has no account yet — so it
 * is deliberately quiet: every failure answers the same way, whether the link never existed,
 * already got used, or expired. A link that leaked cannot be used to discover which customers
 * exist, and a valid one reveals only the name and email it was issued for.
 *
 * These two routes sit behind the same rate limiter as login (app.js mounts authLimiter on
 * /api/auth), so the token cannot be brute-forced by volume.
 */
const activation = require('../services/activation');

router.get('/activate/:token', async (req, res) => {
  const row = await activation.lookup(req.params.token);
  if (!row) return res.status(404).json({ error: 'الرابط غير صالح أو انتهت صلاحيته' });
  res.json({ name: row.user.name, email: row.user.email, expires_at: row.expires_at });
});

router.post('/activate', async (req, res) => {
  const { token, password } = req.body || {};
  // 10 is the floor a customer picks for themselves; the token is what carries the entropy.
  if (!password || String(password).length < 10) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 10 أحرف على الأقل' });
  }

  try {
    const user = await activation.consume(token, String(password), bcrypt);
    if (!user) return res.status(404).json({ error: 'الرابط غير صالح أو انتهت صلاحيته' });

    // Signed straight in: a customer who has just chosen a password should not be asked for it.
    const jwtToken = signToken(user.id);
    res.json({
      token: jwtToken,
      user: { id: user.id, name: user.name, email: user.email, business_id: user.business_id },
    });
  } catch (err) {
    // The race guard in consume() throws when two tabs redeem the same link at once.
    if (String(err.message).includes('already used')) {
      return res.status(404).json({ error: 'الرابط غير صالح أو انتهت صلاحيته' });
    }
    console.error('[auth/activate] failed:', err.message);
    res.status(500).json({ error: 'تعذّر تفعيل الحساب' });
  }
});

module.exports = router;
