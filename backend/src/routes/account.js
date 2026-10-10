const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, attachBusinessId, requireRole } = require('../middleware/auth');
const platformSettings = require('../services/platformSettings');
const costGuard = require('../services/costGuard');
const { DEFAULT_PLAN } = require('../config/plans');
const { META_FEES_LINE } = require('../config/metaNotices');

/**
 * «الاشتراك» for the shop owner (docs/panels/spec.md, P3), and the plan and usage numbers the home
 * page («الرئيسية») shows from GET /api/whatsapp/status. Both read them from here, so the banner on
 * the home page and the plan card on /billing cannot disagree about how many free days are left.
 *
 * Read-only. Payments are recorded by SHIFT (admin.js); the owner tells SHIFT about one over
 * WhatsApp. recorded_by and notes are SHIFT's bookkeeping and never leave this file.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const PLAN_STATUSES = ['trial', 'active', 'past_due', 'paused'];
const MAX_PAYMENTS = 50;

const positive = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : null);

/** The shop's current contract on the bot plan, or null for the hand-wired shops that predate contracts. */
async function contractOf(businessId) {
  return prisma.subscription.findFirst({
    where: { business_id: businessId, solution: DEFAULT_PLAN.solution, status: { not: 'cancelled' } },
    orderBy: { created_at: 'desc' },
    select: {
      id: true, plan_name: true, status: true, amount_jod: true, trial_ends_at: true, next_due_at: true,
      ai_replies_month: true, seats: true,
    },
  });
}

/**
 * The plan card. With no contract the status is 'none' and the price is the plan's published one,
 * so the page can still say what the plan costs instead of «0 د.أ».
 */
function planView(contract, now = new Date()) {
  if (!contract) {
    return {
      name: DEFAULT_PLAN.name, price_jod: DEFAULT_PLAN.price_jod, status: 'none',
      trial_days_left: null, trial_ends_at: null, next_due_at: null,
    };
  }
  const status = PLAN_STATUSES.includes(contract.status) ? contract.status : 'none';
  let trialDaysLeft = null;
  if (status === 'trial' && contract.trial_ends_at) {
    // Rounded up: on the last afternoon of the free month the owner still has «يوم واحد», not 0.
    trialDaysLeft = Math.max(0, Math.ceil((new Date(contract.trial_ends_at).getTime() - new Date(now).getTime()) / DAY_MS));
  }
  return {
    name: contract.plan_name || DEFAULT_PLAN.name,
    price_jod: contract.amount_jod !== null && contract.amount_jod !== undefined ? Number(contract.amount_jod) : DEFAULT_PLAN.price_jod,
    status,
    trial_days_left: trialDaysLeft,
    trial_ends_at: contract.trial_ends_at || null,
    next_due_at: contract.next_due_at || null,
  };
}

/** Seats a shop may fill: the contract's snapshot, else the plan's default (never the live default for a signed deal). */
function seatsOf(contract) {
  return positive(contract && contract.seats) || DEFAULT_PLAN.seats;
}

/**
 * Who takes a seat: everyone active, and everyone invited who has not signed in yet (an unused
 * link). A disabled member frees theirs. The owner counts: «المستخدمون 2 من 3» includes them.
 */
async function seatsUsed(businessId) {
  const users = await prisma.user.findMany({
    where: { business_id: businessId, role: { not: 'platform_admin' } },
    select: { id: true, active: true },
  });
  const inactive = users.filter((u) => !u.active).map((u) => u.id);
  let pending = 0;
  if (inactive.length) {
    const links = await prisma.userActivation.findMany({
      where: { user_id: { in: inactive }, used_at: null },
      select: { user_id: true },
    });
    pending = new Set(links.map((l) => l.user_id)).size;
  }
  return users.filter((u) => u.active).length + pending;
}

/**
 * The meters: bot replies this month (Amman), its cap, and the seats. The reply count is the cost
 * guard's own (same cache, same definition), so «312 من 1,000» is the number the cap is enforced on.
 */
async function usageView(businessId, contract) {
  const [used, limits, seatsTaken] = await Promise.all([
    costGuard.monthlyAiReplies(businessId),
    costGuard.limitsFor(businessId, { contract: contract || null }),
    seatsUsed(businessId),
  ]);
  return {
    ai_replies_month: used,
    cap: limits.replyMonth,
    seats_used: seatsTaken,
    seats: seatsOf(contract),
  };
}

/** PlatformSetting payment_instructions, always three strings: the card stays hidden while they are empty. */
async function paymentInstructions() {
  const v = (await platformSettings.get('payment_instructions')) || {};
  const str = (x) => (typeof x === 'string' ? x.trim() : '');
  return { cliq_alias: str(v.cliq_alias), iban: str(v.iban), holder: str(v.holder) };
}

async function latePolicy() {
  const v = (await platformSettings.get('late_policy')) || {};
  const days = Number(v.grace_days);
  return { grace_days: Number.isFinite(days) && days >= 0 ? Math.round(days) : 7 };
}

const router = express.Router();

// The shop's money is the owner's: managers and staff never see the plan or the payments.
router.use(authenticate, requireRole('business_owner'), attachBusinessId);

router.get('/billing', async (req, res) => {
  try {
    const contract = await contractOf(req.businessId);
    const [usage, payments, instructions, late] = await Promise.all([
      usageView(req.businessId, contract),
      prisma.payment.findMany({
        where: { business_id: req.businessId },
        orderBy: { paid_at: 'desc' },
        take: MAX_PAYMENTS,
        // Never recorded_by or note: those are SHIFT's, not the shop's.
        select: { paid_at: true, amount_jod: true, method: true, reference: true },
      }),
      paymentInstructions(),
      latePolicy(),
    ]);
    res.json({
      plan: planView(contract),
      usage,
      payments: payments.map((p) => ({
        paid_at: p.paid_at, amount_jod: Number(p.amount_jod), method: p.method, reference: p.reference || '',
      })),
      payment_instructions: instructions,
      late_policy: late,
      meta_fees_line: META_FEES_LINE,
    });
  } catch (err) {
    console.error(`[account/billing] failed business=${req.businessId}: ${err.message}`);
    res.status(500).json({ error: 'تعذّر تحميل الاشتراك، حاول مرة أخرى' });
  }
});

module.exports = router;
// Shared with GET /api/whatsapp/status (the home page) and routes/team.js (the seats meter).
module.exports.contractOf = contractOf;
module.exports.planView = planView;
module.exports.usageView = usageView;
module.exports.seatsOf = seatsOf;
module.exports.seatsUsed = seatsUsed;
module.exports.latePolicy = latePolicy;
