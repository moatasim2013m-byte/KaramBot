const express = require('express');
const router = express.Router();
const { authenticate, attachBusinessId } = require('../middleware/auth');
const Order = require('../models/Order');

router.use(authenticate, attachBusinessId);

const VALID_STATUSES = ['draft', 'awaiting_confirmation', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'];

// GET /api/orders
router.get('/', async (req, res) => {
  try {
    const { status, date, page = 1, limit = 50 } = req.query;
    const query = { business_id: req.businessId };
    if (status) query.status = status;
    if (date) {
      const d = new Date(date);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      query.created_at = { $gte: d, $lt: next };
    }

    const orders = await Order.find(query)
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);
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

    const orders = await Order.find({
      business_id: req.businessId,
      created_at: { $gte: start },
      status: { $nin: ['draft'] },
    }).sort({ created_at: -1 });

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
    const order = await Order.findOne({ _id: req.params.id, business_id: req.businessId });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/orders/:id/status - update order status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, notes } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Valid: ${VALID_STATUSES.join(', ')}` });
    }

    const order = await Order.findOne({ _id: req.params.id, business_id: req.businessId });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    order.status = status;
    if (notes) order.notes = notes;
    order.status_history.push({ status, changed_at: new Date(), changed_by: req.user._id });
    await order.save();

    res.json({ order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
