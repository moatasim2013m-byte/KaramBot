'use strict';

const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const costGuard = require('../services/costGuard');
const { isLatePause } = require('../services/latePolicy');
const labels = require('../config/eventLabels');

/**
 * «الاشتراكات والدفعات» (docs/panels/spec.md; GET /api/admin/billing): money across every customer
 * shop, recorded by hand (CliQ, bank transfer, cash). What is due, what came in, whose free month
 * ends. Payments themselves are recorded on the account routes (POST
 * /api/admin/accounts/:id/subscriptions/:sid/payments), so there is one way in and one set of rules.
 *
 * Each shop's row is its live contract: the newest Karam Bot contract not cancelled, else its
 * newest other contract. What is still owed on it counts every payment ever made against it, the
 * same running total the payment route moves the due date by, so a half-paid month shows the
 * half that is left, not the whole price again and not zero.
 *
 * Reads are one query per signal for the whole fleet (contracts, payment totals, last payments,
 * this month's takings, usage). SHIFT's own rows and the internal test rows are left out.
 */

const router = express.Router();
router.use(authenticate, requireRole('platform_admin'));

const DAY_MS = 24 * 60 * 60 * 1000;
const ENDS_SOON_DAYS = 7;
const cents = (v) => Math.round(Number(v || 0) * 100);
const fromCents = (c) => Math.round(c) / 100;

/** What is still owed on the current cycle: the price less what the running total carries over. */
function dueCents(contract, paidCents) {
  const price = cents(contract.amount_jod);
  if (price <= 0) return 0;
  if (contract.billing_cycle === 'one_time') return Math.max(price - paidCents, 0);
  return price - (paidCents % price);
}

router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const t = now.getTime();
    const shops = await prisma.business.findMany({
      where: { is_internal: false, business_type: { not: 'shift' }, status: { not: 'closed' } },
      select: { id: true, name: true, sector: true, status: true, ai_config: true, wa_phone_number_id: true },
      orderBy: { created_at: 'asc' },
    });
    const ids = shops.map((b) => b.id);
    if (!ids.length) {
      return res.json({ totals: { expected_month_jod: 0, collected_month_jod: 0, overdue_jod: 0, in_trial: 0 }, rows: [] });
    }

    const subs = await prisma.subscription.findMany({
      where: { business_id: { in: ids }, status: { not: 'cancelled' } },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, business_id: true, solution: true, plan_name: true, status: true, amount_jod: true, billing_cycle: true,
        starts_at: true, trial_ends_at: true, next_due_at: true, ai_replies_month: true,
      },
    });
    const liveOf = new Map();
    const botOf = new Map();
    for (const s of subs) {
      if (s.solution === costGuard.BOT_SOLUTION && !botOf.has(s.business_id)) botOf.set(s.business_id, s);
      if (!liveOf.has(s.business_id)) liveOf.set(s.business_id, s);
    }
    for (const [id, s] of botOf) liveOf.set(id, s);
    const liveIds = [...liveOf.values()].map((s) => s.id);

    const monthStart = costGuard.monthStart(now);
    const nextMonthStart = costGuard.monthStart(new Date(monthStart.getTime() + 32 * DAY_MS));
    const [paidAgg, lastPayments, collected, usage] = await Promise.all([
      liveIds.length ? prisma.payment.groupBy({
        by: ['subscription_id'], where: { subscription_id: { in: liveIds } }, _sum: { amount_jod: true },
      }) : [],
      liveIds.length ? prisma.payment.findMany({
        where: { subscription_id: { in: liveIds } },
        orderBy: [{ paid_at: 'desc' }, { created_at: 'desc' }],
        distinct: ['subscription_id'],
        select: { subscription_id: true, amount_jod: true, paid_at: true, method: true, reference: true },
      }) : [],
      prisma.payment.aggregate({
        where: { business_id: { in: ids }, paid_at: { gte: monthStart, lt: nextMonthStart } },
        _sum: { amount_jod: true },
      }),
      costGuard.fleetUsage(ids, { contracts: botOf, now }).catch((err) => {
        console.warn(`[admin/billing] usage not read: ${err.message}`);
        return new Map();
      }),
    ]);
    const paidOf = new Map((paidAgg || []).map((p) => [p.subscription_id, cents(p._sum && p._sum.amount_jod)]));
    const lastOf = new Map((lastPayments || []).map((p) => [p.subscription_id, p]));

    let expectedCents = cents(collected && collected._sum && collected._sum.amount_jod);
    const collectedCents = expectedCents;
    let overdueCents = 0;
    let inTrial = 0;

    const rows = shops.map((shop) => {
      const c = liveOf.get(shop.id) || null;
      const last = c ? lastOf.get(c.id) : null;
      const u = usage.get(shop.id) || null;
      const base = {
        account_id: shop.id,
        name: shop.name,
        sector: shop.sector || null,
        bot_paused_for_late: isLatePause(shop.ai_config),
        usage: u ? { ai_replies_month: u.ai_replies_month, cap: u.cap } : null,
      };
      if (!c) {
        return {
          ...base, subscription_id: null, status: 'none', status_ar: labels.SUBSCRIPTION_STATUS_AR.none,
          amount_jod: null, billing_cycle: null, trial_ends_at: null, next_due_at: null, due_jod: null,
          late_days: 0, ends_within_7d: false, last_payment: null, no_contract: true,
        };
      }
      const due = c.next_due_at ? new Date(c.next_due_at).getTime() : null;
      const billing = ['trial', 'active', 'past_due'].includes(c.status);
      const owed = billing ? dueCents(c, paidOf.get(c.id) || 0) : 0;
      const late = billing && (c.status === 'past_due' || (due !== null && due < t));
      if (c.status === 'trial') inTrial += 1;
      // Expected this month: what came in, plus every cycle that falls due before the month ends
      // (an overdue one included: it is still this month's money to chase).
      if (billing && due !== null && due < nextMonthStart.getTime()) expectedCents += owed;
      if (late) overdueCents += owed;
      const endsAt = c.status === 'trial' ? (c.trial_ends_at || c.next_due_at) : null;
      return {
        ...base,
        subscription_id: c.id,
        solution: c.solution,
        plan_name: c.plan_name,
        status: c.status,
        status_ar: late ? labels.SUBSCRIPTION_STATUS_AR.past_due : (labels.SUBSCRIPTION_STATUS_AR[c.status] || c.status),
        amount_jod: Number(c.amount_jod),
        billing_cycle: c.billing_cycle,
        trial_ends_at: c.trial_ends_at || null,
        next_due_at: c.next_due_at,
        due_jod: billing ? fromCents(owed) : null,
        late_days: late && due !== null && due < t ? Math.ceil((t - due) / DAY_MS) : 0,
        ends_within_7d: Boolean(endsAt) && new Date(endsAt).getTime() >= t && new Date(endsAt).getTime() - t <= ENDS_SOON_DAYS * DAY_MS,
        last_payment: last ? {
          paid_at: last.paid_at,
          amount_jod: Number(last.amount_jod),
          method: last.method,
          method_ar: labels.PAYMENT_METHOD_AR[last.method] || labels.PAYMENT_METHOD_AR.other,
          reference: last.reference || null,
        } : null,
        no_contract: false,
      };
    });

    res.json({
      totals: {
        expected_month_jod: fromCents(expectedCents),
        collected_month_jod: fromCents(collectedCents),
        overdue_jod: fromCents(overdueCents),
        in_trial: inTrial,
      },
      rows,
    });
  } catch (err) {
    console.error(`[admin/billing] failed: ${err.message}`);
    res.status(500).json({ error: 'تعذّر تحميل الاشتراكات والدفعات' });
  }
});

module.exports = router;
module.exports.dueCents = dueCents;
