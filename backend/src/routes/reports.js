const express = require('express');
const router = express.Router();
const { authenticate, attachBusinessId } = require('../middleware/auth');
const prisma = require('../config/prisma');

router.use(authenticate, attachBusinessId);

// ─── Daily Report ─────────────────────────────────────────────────────────────

// GET /api/reports/daily?date=YYYY-MM-DD  (defaults to today)
router.get('/daily', async (req, res) => {
  try {
    const dateStr = req.query.date;
    const start = dateStr ? new Date(dateStr) : new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const orders = await prisma.order.findMany({
      where: {
        business_id: req.businessId,
        created_at: { gte: start, lt: end },
        NOT: { status: { in: ['draft', 'cancelled'] } },
      },
    });

    const totalRevenue = orders.reduce((s, o) => s + (o.total || 0), 0);
    const byStatus = {};
    const itemCounts = {};

    for (const order of orders) {
      byStatus[order.status] = (byStatus[order.status] || 0) + 1;
      for (const item of order.items || []) {
        const key = item.name_ar || item.menu_item_id;
        if (!itemCounts[key]) itemCounts[key] = { name_ar: key, count: 0, revenue: 0 };
        itemCounts[key].count += item.quantity || 1;
        itemCounts[key].revenue += item.item_total || 0;
      }
    }

    const topItems = Object.values(itemCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    res.json({
      date: start.toISOString().split('T')[0],
      total_orders: orders.length,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      by_status: byStatus,
      top_items: topItems,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Weekly Report ────────────────────────────────────────────────────────────

// GET /api/reports/weekly?end_date=YYYY-MM-DD  (defaults to today)
router.get('/weekly', async (req, res) => {
  try {
    const endDateStr = req.query.end_date;
    const end = endDateStr ? new Date(endDateStr) : new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);

    const orders = await prisma.order.findMany({
      where: {
        business_id: req.businessId,
        created_at: { gte: start, lte: end },
        NOT: { status: { in: ['draft', 'cancelled'] } },
      },
      orderBy: { created_at: 'asc' },
    });

    // Build daily breakdown
    const dailyMap = {};
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split('T')[0];
      dailyMap[key] = { date: key, orders: 0, revenue: 0, cancelled: 0 };
    }

    for (const order of orders) {
      const key = new Date(order.created_at).toISOString().split('T')[0];
      if (!dailyMap[key]) continue;
      dailyMap[key].orders++;
      dailyMap[key].revenue += order.total || 0;
    }

    const days = Object.values(dailyMap).map(d => ({
      ...d,
      revenue: Math.round(d.revenue * 100) / 100,
    }));

    const totalRevenue = days.reduce((s, d) => s + d.revenue, 0);
    const totalOrders = days.reduce((s, d) => s + d.orders, 0);

    // Item popularity across the week
    const itemCounts = {};
    for (const order of orders) {
      for (const item of order.items || []) {
        const key = item.name_ar || item.menu_item_id;
        if (!itemCounts[key]) itemCounts[key] = { name_ar: key, count: 0, revenue: 0 };
        itemCounts[key].count += item.quantity || 1;
        itemCounts[key].revenue += item.item_total || 0;
      }
    }

    const topItems = Object.values(itemCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    res.json({
      start_date: start.toISOString().split('T')[0],
      end_date: end.toISOString().split('T')[0],
      total_orders: totalOrders,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      days,
      top_items: topItems,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
