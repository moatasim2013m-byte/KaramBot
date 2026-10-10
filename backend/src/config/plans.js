/**
 * The plan SHIFT sells, in one place (docs/panels/decisions-2026-10-08.md, decision 5).
 *
 * No Plan table: ten shops on one plan do not need one. A contract copies the terms it was sold on
 * (planSnapshot) onto its Subscription row, so changing a number here later never silently
 * rewrites a deal a shop already agreed to. The price is the one the sales bot already quotes
 * (workflows/shift/objectives.js); the two must change together.
 *
 * The free-month numbers here are the plan's own. PlatformSetting `campaign` can override them for
 * a campaign without a deploy, so callers pass its trial_days / backstop_days / trial_starts in;
 * these are only the fallback.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_PLAN = Object.freeze({
  solution: 'karam_bot',
  name: 'باقة كرم بوت',
  price_jod: 19.99,
  billing_cycle: 'monthly',
  ai_replies_month: 1000,
  seats: 3,
  // Free month: 30 days, starting at the first real AI reply to a non-staff number, or
  // trial_backstop_days after connecting, whichever comes first (decision 4). The backstop stops a
  // shop that never goes live from holding a free month open forever.
  trial_days: 30,
  trial_backstop_days: 14,
  media_reads_day: 30,
});

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * DAY_MS);
}

/** The columns a Subscription copies from the plan when it is created. */
function planSnapshot(plan = DEFAULT_PLAN) {
  return {
    solution: plan.solution,
    plan_name: plan.name,
    amount_jod: plan.price_jod,
    billing_cycle: plan.billing_cycle,
    ai_replies_month: plan.ai_replies_month,
    seats: plan.seats,
  };
}

/**
 * When the free month ends.
 *
 * With trialStarts 'first_reply' (the default) and no first reply yet, the answer is the latest the
 * trial can end (connect + backstop + trial days). The went_live hook calls this again with
 * firstReplyAt, which can only bring the date earlier, so a stored trial_ends_at is never later
 * than the shop's real one.
 * Jordan has had no DST since 2022, so whole days in milliseconds are whole days in Amman.
 */
function trialEndsAt({
  connectedAt,
  firstReplyAt = null,
  trialDays = DEFAULT_PLAN.trial_days,
  backstopDays = DEFAULT_PLAN.trial_backstop_days,
  trialStarts = 'first_reply',
} = {}) {
  if (!connectedAt) throw new TypeError('trialEndsAt needs connectedAt');
  let start = new Date(connectedAt);
  if (trialStarts !== 'connect') {
    const backstop = addDays(connectedAt, backstopDays);
    start = firstReplyAt && new Date(firstReplyAt) < backstop ? new Date(firstReplyAt) : backstop;
  }
  return addDays(start, trialDays);
}

/**
 * `data` for prisma.subscription.create: a free-month contract on the plan's terms. The first
 * payment falls due when the free month ends.
 */
function trialSubscriptionData({
  businessId,
  createdBy = 'system',
  connectedAt = new Date(),
  firstReplyAt = null,
  campaign = null,
  plan = DEFAULT_PLAN,
  trialDays = plan.trial_days,
  backstopDays = plan.trial_backstop_days,
  trialStarts = 'first_reply',
} = {}) {
  if (!businessId) throw new TypeError('trialSubscriptionData needs businessId');
  const ends = trialEndsAt({ connectedAt, firstReplyAt, trialDays, backstopDays, trialStarts });
  return {
    business_id: businessId,
    ...planSnapshot(plan),
    status: 'trial',
    starts_at: new Date(connectedAt),
    trial_ends_at: ends,
    next_due_at: ends,
    campaign,
    created_by: createdBy,
  };
}

module.exports = { DEFAULT_PLAN, planSnapshot, trialEndsAt, trialSubscriptionData };
