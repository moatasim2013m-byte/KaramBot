const express = require('express');
const router = express.Router();
const { authenticate, attachBusinessId } = require('../middleware/auth');
const prisma = require('../config/prisma');

router.use(authenticate, attachBusinessId);

const VALID_STATUSES = ['draft', 'awaiting_confirmation', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'];

// GET /api/orders
router.get('/', async (req, res) => {
  try {
    const { status, date, page = 1, limit = 50 } = req.query;
    const where = { business_id: req.businessId };
    if (status) where.status = status;
    if (date) {
      const d = new Date(date);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      where.created_at = { gte: d, lt: next };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
        include: { status_history: { orderBy: { changed_at: 'asc' } } },
      }),
      prisma.order.count({ where }),
    ]);

    res.json({ orders, total, page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orders/today - quick dashboard view
router.get('/today', async (req, res) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const orders = await prisma.order.findMany({
      where: {
        business_id: req.businessId,
        created_at: { gte: start },
        NOT: { status: 'draft' },
      },
      orderBy: { created_at: 'desc' },
      include: { status_history: { orderBy: { changed_at: 'asc' } } },
    });

    const summary = {
      total_orders: orders.length,
      total_revenue: orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0),
      by_status: {},
    };
    for (const o of orders) {
      summary.by_status[o.status] = (summary.by_status[o.status] || 0) + 1;
    }

    res.json({ orders, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orders/:id
router.get('/:id', async (req, res) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
      include: { status_history: { orderBy: { changed_at: 'asc' } } },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/orders/:id/status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, notes } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Valid: ${VALID_STATUSES.join(', ')}` });
    }

    const existing = await prisma.order.findFirst({
      where: { id: req.params.id, business_id: req.businessId },
    });
    if (!existing) return res.status(404).json({ error: 'Order not found' });

    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: {
        status,
        ...(notes ? { notes } : {}),
        status_history: {
          create: {
            status,
            changed_at: new Date(),
            changed_by: req.user.id,
          },
        },
      },
      include: { status_history: { orderBy: { changed_at: 'asc' } } },
    });

    res.json({ order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
