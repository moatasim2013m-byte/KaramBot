const express = require('express');
const router = express.Router();
const { authenticate, requireRole, attachBusinessId } = require('../middleware/auth');
const prisma = require('../config/prisma');
const activation = require('../services/activation');

// A tenant may manage its own people and nothing above them. Without this list, a
// business_owner could PATCH their own row to platform_admin and reach every other account.
const CUSTOMER_ROLES = ['business_owner', 'manager', 'staff'];

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
    if (role) {
      if (req.user.role !== 'platform_admin' && !CUSTOMER_ROLES.includes(role)) {
        return res.status(403).json({ error: 'صلاحية غير مسموحة' });
      }
      data.role = role;
    }

    const where = req.user.role === 'platform_admin'
      ? { id: req.params.id }
      : { id: req.params.id, business_id: req.businessId };

    const existing = await prisma.user.findFirst({ where });
    if (!existing) return res.status(404).json({ error: 'Staff member not found' });

    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: req.params.id },
        data,
        select: {
          id: true, name: true, email: true, role: true,
          business_id: true, active: true, last_login: true,
          created_at: true, updated_at: true,
        },
      });
      // Disabling an account must take any invitation with it. Otherwise whoever holds an
      // outstanding link redeems it later and comes back in with active set true again —
      // making the only lockout control reversible by the person being locked out.
      if (active === false) await activation.revoke(req.params.id, tx);
      return updated;
    });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
