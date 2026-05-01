const express = require('express');
const router = express.Router();
const { authenticate, requireRole, attachBusinessId } = require('../middleware/auth');
const prisma = require('../config/prisma');

router.use(authenticate, attachBusinessId);

// GET /api/staff
router.get('/', requireRole('platform_admin', 'business_owner', 'manager'), async (req, res) => {
  try {
    const where = req.user.role === 'platform_admin' ? {} : { business_id: req.businessId };
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, name: true, email: true, role: true,
        business_id: true, active: true, last_login: true,
        created_at: true, updated_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
    res.json({ staff: users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/staff/:id
router.patch('/:id', requireRole('platform_admin', 'business_owner'), async (req, res) => {
  try {
    const { active, role } = req.body;
    const data = {};
    if (active !== undefined) data.active = active;
    if (role) data.role = role;

    const where = req.user.role === 'platform_admin'
      ? { id: req.params.id }
      : { id: req.params.id, business_id: req.businessId };

    const existing = await prisma.user.findFirst({ where });
    if (!existing) return res.status(404).json({ error: 'Staff member not found' });

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: {
        id: true, name: true, email: true, role: true,
        business_id: true, active: true, last_login: true,
        created_at: true, updated_at: true,
      },
    });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
