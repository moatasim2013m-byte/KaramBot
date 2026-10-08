const express = require('express');
const router = express.Router();
const { authenticate, attachBusinessId, requireRole } = require('../middleware/auth');
const prisma = require('../config/prisma');
const { ammanDay, dayStart } = require('../services/costGuard');

// «التقارير» is the owner's and the manager's (docs/panels/spec.md, P3). The page was already
// hidden from staff; the API now says the same, so a staff session cannot read the shop's revenue.
router.use(authenticate, attachBusinessId, requireRole('platform_admin', 'business_owner', 'manager'));

// ─── Summary, every business type ────────────────────────────────────────────

const SUMMARY_DAYS = [7, 30];
const TOP_GAPS = 5;
// A ceiling on rows read for one report: a month of a busy shop is a few thousand messages. Past
// it the oldest days undercount rather than the request reading without bound.
const MAX_ROWS = 50000;
const DAY_MS = 24 * 60 * 60 * 1000;

// The same question asked twice with different spacing or a trailing «؟» is one question.
function questionKey(q) {
  return String(q || '').replace(/[\s\u200f\u200e]+/g, ' ').replace(/[؟?!.،,]+$/g, '').trim().toLowerCase();
}

/**
 * GET /api/reports/summary?days=7|30
 *
 * Per Amman day: conversations a customer wrote in, the bot's replies and the team's replies; the
 * handoffs and the questions the bot most often could not answer. Counted from messages and the
 * bot_handoff events, so it works the same for a pharmacy as for a restaurant (the daily and weekly
 * reports below are about orders only).
 *
 * «handoffs» counts the bot_handoff events: the chats the model gave up on. A customer's own
 * keyword and a provider failure are not stored as events, so they are not in this number.
 */
router.get('/summary', async (req, res) => {
  const days = SUMMARY_DAYS.includes(Number(req.query.days)) ? Number(req.query.days) : 7;
  try {
    const now = new Date();
    // Midnight Amman, (days - 1) days back: today is the last of the `days` days.
    const start = dayStart(new Date(now.getTime() - (days - 1) * DAY_MS));
    const [messages, handoffs] = await Promise.all([
      prisma.message.findMany({
        where: { business_id: req.businessId, created_at: { gte: start } },
        select: { conversation_id: true, direction: true, is_ai_generated: true, sent_by_user_id: true, created_at: true },
        orderBy: { created_at: 'desc' },
        take: MAX_ROWS,
      }),
      prisma.accountEvent.findMany({
        where: { business_id: req.businessId, type: 'bot_handoff', created_at: { gte: start } },
        select: { data: true, created_at: true },
        take: MAX_ROWS,
      }),
    ]);

    const perDay = new Map();
    for (let i = days - 1; i >= 0; i -= 1) {
      const date = ammanDay(new Date(now.getTime() - i * DAY_MS));
      if (!perDay.has(date)) perDay.set(date, { date, conversations: new Set(), bot_replies: 0, team_replies: 0 });
    }
    for (const m of messages) {
      const day = perDay.get(ammanDay(m.created_at));
      if (!day) continue;
      if (m.direction === 'inbound') day.conversations.add(m.conversation_id);
      else if (m.is_ai_generated) day.bot_replies += 1;
      // A person on the team, not an alert or a template the system stored as outbound.
      else if (m.sent_by_user_id) day.team_replies += 1;
    }

    const counts = new Map();
    for (const e of handoffs) {
      const q = e.data && typeof e.data.question === 'string' ? e.data.question.trim() : '';
      if (!q) continue;
      const key = questionKey(q);
      const hit = counts.get(key) || { question: q, count: 0 };
      hit.count += 1;
      counts.set(key, hit);
    }

    res.json({
      days,
      per_day: [...perDay.values()].map((d) => ({
        date: d.date, conversations: d.conversations.size, bot_replies: d.bot_replies, team_replies: d.team_replies,
      })),
      handoffs: handoffs.length,
      top_gaps: [...counts.values()].sort((a, b) => b.count - a.count).slice(0, TOP_GAPS),
    });
  } catch (err) {
    console.error(`[reports/summary] failed business=${req.businessId}: ${err.message}`);
    res.status(500).json({ error: 'تعذّر تحميل التقرير' });
  }
});

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
