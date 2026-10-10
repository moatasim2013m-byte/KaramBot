'use strict';

/**
 * The late-payment policy (decisions-2026-10-08.md #8; docs/panels/spec.md «الاشتراكات والدفعات»):
 * `late_policy.grace_days` (7) after a Karam Bot contract's next_due_at with nothing paid, the
 * contract turns past_due and the shop's bot pauses. The inbox and the shop's alerts keep working:
 * the pause is ai_config.enabled = false, which the message path already honours without dropping
 * a single inbound message (P0). Recording a payment that brings the contract back lifts the pause.
 *
 * The pause is marked as SHIFT's (paused_by 'shift') with pause_reason 'late_payment', so:
 *  - the owner's own switch on /bot cannot lift it (routes/businesses.js pausedByShift);
 *  - a payment lifts only this pause, never one SHIFT made by hand for another reason;
 *  - the panels can say why («موقوف — تأخر الدفع»).
 * A bot that was already off (the owner's pause, or SHIFT's by hand) keeps who paused it and why in
 * ai_config.prior_pause, and a payment puts that pause back instead of switching the bot on: the
 * late policy would otherwise launder someone's deliberate «off» into one a payment undoes.
 * A payment lifts the pause only when the shop's live Karam Bot contract is no longer late (not
 * past_due, and its due date within the grace days): a payment on the shop's website contract, or
 * a few dinars that leave a free month still unpaid, do not buy back the bot, and since the claim
 * below would stop the sweep pausing it again for that due date, the check has to be here.
 *
 * Run once a day from shiftSweeper.sweepDaily. Idempotent: a contract already past_due is not
 * written again, and the pause is claimed once per contract and due date (accountsDaily.claimOnce),
 * so two Cloud Run instances sweeping the same minute pause and log it once, and a bot SHIFT
 * resumed by hand while the shop arranges payment is not paused again for that same due date.
 * SHIFT's own number and the internal rows are never touched: the sales bot is how SHIFT sells.
 * Never throws; each shop's failure is counted and the rest carry on.
 */

const prisma = require('../config/prisma');
const jsonb = require('../db/jsonb');
const platformSettings = require('./platformSettings');
const accountEvents = require('./accountEvents');
const { DEFAULT_PLAN } = require('../config/plans');

const DAY_MS = 24 * 60 * 60 * 1000;
const PAUSE_REASON = 'late_payment';
// The statuses a contract can be late in. A paused or cancelled contract is not billing.
const BILLING_STATUSES = ['trial', 'active', 'past_due'];
const MAX_GRACE_DAYS = 60;

const isExempt = (b) => !b || b.is_internal === true || b.business_type === 'shift';
const dayOf = (d) => new Date(d).toISOString().slice(0, 10);

async function graceDays() {
  try {
    const policy = await platformSettings.get('late_policy');
    const n = Number(policy && policy.grace_days);
    if (Number.isFinite(n)) return Math.min(Math.max(Math.round(n), 0), MAX_GRACE_DAYS);
  } catch (err) {
    console.warn(`[latePolicy] late_policy not read, using 7 days: ${err.message}`);
  }
  return 7;
}

/** Whether this shop's bot is paused by the late policy (and only by it). */
function isLatePause(aiConfig) {
  return Boolean(aiConfig) && aiConfig.enabled === false && aiConfig.paused_by === 'shift' && aiConfig.pause_reason === PAUSE_REASON;
}

/**
 * Apply the policy as of `now`. Returns counts: {grace_days, late, marked_past_due, paused, errors}.
 */
async function applyLatePolicy(now = new Date()) {
  const at = new Date(now);
  const out = { grace_days: null, late: 0, marked_past_due: 0, paused: 0, errors: 0 };
  try {
    const grace = await graceDays();
    out.grace_days = grace;
    const cutoff = new Date(at.getTime() - grace * DAY_MS);

    const subs = await prisma.subscription.findMany({
      where: { solution: DEFAULT_PLAN.solution, status: { in: BILLING_STATUSES }, next_due_at: { lt: cutoff } },
      orderBy: { created_at: 'desc' },
      select: { id: true, business_id: true, status: true, next_due_at: true, amount_jod: true, created_at: true },
    });
    if (!subs.length) return out;

    // Only a shop's live contract decides: a newer one (re-signed after a cancellation) wins.
    const live = await prisma.subscription.findMany({
      where: { business_id: { in: [...new Set(subs.map((s) => s.business_id))] }, solution: DEFAULT_PLAN.solution, status: { not: 'cancelled' } },
      orderBy: { created_at: 'desc' },
      select: { id: true, business_id: true },
    });
    const liveOf = new Map();
    for (const s of live) if (!liveOf.has(s.business_id)) liveOf.set(s.business_id, s.id);

    const shops = new Map((await prisma.business.findMany({
      where: { id: { in: [...new Set(subs.map((s) => s.business_id))] } },
      select: { id: true, name: true, status: true, is_internal: true, business_type: true, ai_config: true },
    })).map((b) => [b.id, b]));

    // Required here: accountsDaily reaches alerts.js and whatsapp.js, which the message path's
    // tests replace; a late require keeps this module loadable on its own.
    const { claimOnce } = require('./accountsDaily');

    for (const sub of subs) {
      const shop = shops.get(sub.business_id);
      if (!shop || isExempt(shop) || shop.status === 'closed') continue;
      if (liveOf.get(sub.business_id) !== sub.id) continue;
      out.late += 1;
      try {
        if (sub.status !== 'past_due') {
          // Conditional on the status read, so a payment recorded this same minute is not overwritten.
          const { count } = await prisma.subscription.updateMany({
            where: { id: sub.id, status: sub.status },
            data: { status: 'past_due' },
          });
          if (count) {
            out.marked_past_due += 1;
            await accountEvents.record({
              businessId: shop.id, actorKind: 'system', type: 'late_policy_applied',
              data: { subscription_id: sub.id, from: sub.status, next_due_at: sub.next_due_at, grace_days: grace },
            });
          }
        }
        if (isLatePause(shop.ai_config)) continue;
        // One pause per contract and due date. A bot SHIFT resumed by hand stays on until the
        // next due date passes its grace too.
        if (!(await claimOnce(shop.id, `late_pause:${sub.id}:${dayOf(sub.next_due_at)}`, at))) continue;
        const cfg = shop.ai_config || {};
        // Already off: the late pause still takes over (so the owner's switch cannot lift it while
        // they owe), but remembers the pause it covers, which liftLatePause puts back.
        const alreadyOff = cfg.enabled === false;
        const patch = { enabled: false, paused_by: 'shift', pause_reason: PAUSE_REASON };
        if (alreadyOff) patch.prior_pause = { paused_by: cfg.paused_by || null, pause_reason: cfg.pause_reason || null };
        const { ok } = await jsonb.patchJson('businesses', shop.id, 'ai_config', patch);
        if (!ok) continue;
        // A bot that was already off is not paused again: no second bot_paused in its log.
        if (alreadyOff) continue;
        out.paused += 1;
        await accountEvents.record({
          businessId: shop.id, actorKind: 'system', type: 'bot_paused',
          data: { reason: PAUSE_REASON, subscription_id: sub.id, grace_days: grace },
        });
      } catch (err) {
        out.errors += 1;
        console.warn(`[latePolicy] business=${sub.business_id} sub=${sub.id} failed: ${err.message}`);
      }
    }
  } catch (err) {
    out.errors += 1;
    console.warn(`[latePolicy] failed: ${err.message}`);
  }
  return out;
}

/**
 * Whether the shop's live Karam Bot contract is still late as of `now`: past_due, or its due date
 * older than the grace days. No live contract counts as not late (nothing left to owe on it).
 */
async function botContractLate(businessId, now) {
  const live = await prisma.subscription.findFirst({
    where: { business_id: businessId, solution: DEFAULT_PLAN.solution, status: { not: 'cancelled' } },
    orderBy: { created_at: 'desc' },
    select: { id: true, status: true, next_due_at: true },
  });
  if (!live) return false;
  if (live.status === 'past_due') return true;
  if (!BILLING_STATUSES.includes(live.status) || !live.next_due_at) return false;
  const cutoff = now.getTime() - (await graceDays()) * DAY_MS;
  return new Date(live.next_due_at).getTime() < cutoff;
}

/**
 * A payment brought the contract back: lift the late policy's pause, and only that pause (one SHIFT
 * made by hand, or the owner's own, stays: when the late pause covered one, that one comes back).
 * Lifts nothing while the shop's live Karam Bot contract is still late, whichever contract was paid.
 * Returns true when the bot was turned back on.
 * Never throws: the payment is already saved, and a failed resume is SHIFT's to press by hand.
 */
async function liftLatePause(businessId, { actorUserId = null, reason = 'payment_recorded', now = new Date() } = {}) {
  try {
    const shop = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, ai_config: true } });
    if (!shop || !isLatePause(shop.ai_config)) return false;
    if (await botContractLate(shop.id, new Date(now))) return false;
    const prior = shop.ai_config.prior_pause;
    if (prior && typeof prior === 'object') {
      // Back to the pause the late policy covered: still off, and still the owner's or SHIFT's.
      const back = { enabled: false };
      if (prior.paused_by) back.paused_by = prior.paused_by;
      if (prior.pause_reason) back.pause_reason = prior.pause_reason;
      const remove = ['prior_pause', ...['paused_by', 'pause_reason'].filter((k) => !(k in back))];
      await jsonb.patchJson('businesses', shop.id, 'ai_config', back, { remove });
      return false;
    }
    const { ok } = await jsonb.patchJson('businesses', shop.id, 'ai_config', { enabled: true }, { remove: ['paused_by', 'pause_reason', 'prior_pause'] });
    if (!ok) return false;
    await accountEvents.record({
      businessId: shop.id, actorUserId, actorKind: actorUserId ? 'shift' : 'system', type: 'bot_resumed', data: { reason },
    });
    return true;
  } catch (err) {
    console.warn(`[latePolicy] resume business=${businessId} failed: ${err.message}`);
    return false;
  }
}

module.exports = { applyLatePolicy, liftLatePause, isLatePause, PAUSE_REASON };
