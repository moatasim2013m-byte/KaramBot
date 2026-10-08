'use strict';

/**
 * «يعمل»: the first AI reply a shop's bot delivered to a real customer (docs/panels/spec.md step 10).
 *
 * It is the last column on the onboarding board, and, with the campaign's default trial_starts
 * 'first_reply', the moment the free month starts (decisions-2026-10-08.md #4): a shop that
 * connected but has not yet answered anyone has not had its free month yet.
 *
 * "A real customer" leaves out the shop's own staff numbers (ai_config.alert_wa_numbers, which
 * holds the owner's mobile from «زبون جديد»): an owner trying the bot from their own phone is a
 * test, not a customer. SHIFT's own number and the internal (-sim) rows are left out.
 *
 * Business.went_live_at is set once (updateMany where it is still null), so two replies at once,
 * or two instances, record it once, and only that winner writes the event and alerts SHIFT.
 * Never throws: it runs right after a reply went out, which must not be undone or failed by it.
 */

const prisma = require('../config/prisma');
const plans = require('../config/plans');
const platformSettings = require('./platformSettings');
const accountEvents = require('./accountEvents');
const alerts = require('./alerts');

function isStaffNumber(business, waId) {
  const list = business?.ai_config?.alert_wa_numbers;
  if (!Array.isArray(list) || !waId) return false;
  const want = String(waId).replace(/\D/g, '');
  return list.some((n) => String(n ?? '').replace(/\D/g, '') === want);
}

/** Whether this reply could be a shop's first live one; cheap, no query. */
function candidate(business, customerWaId) {
  if (!business || !business.id) return false;
  if (business.went_live_at) return false;
  if (business.is_internal || business.business_type === 'shift') return false;
  return !isStaffNumber(business, customerWaId);
}

/**
 * The free month now that the first reply is known. plans.trialEndsAt can only bring the end
 * earlier than the backstop date stored at connect, so a stored date never moves later. Only a
 * contract still on its trial is touched: a paying shop's dates are SHIFT's.
 */
async function startTrialClock(business, firstReplyAt) {
  const sub = await prisma.subscription.findFirst({
    where: { business_id: business.id, status: 'trial' },
    orderBy: { created_at: 'desc' },
    select: { id: true, starts_at: true, trial_ends_at: true, next_due_at: true },
  });
  if (!sub) return null;
  const campaign = (await platformSettings.get('campaign').catch(() => null)) || {};
  const connectedAt = business.connected_at || sub.starts_at;
  if (!connectedAt) return null;
  const ends = plans.trialEndsAt({
    connectedAt,
    firstReplyAt,
    ...(Number.isFinite(campaign.trial_days) ? { trialDays: campaign.trial_days } : {}),
    ...(Number.isFinite(campaign.backstop_days) ? { backstopDays: campaign.backstop_days } : {}),
    ...(['first_reply', 'connect'].includes(campaign.trial_starts) ? { trialStarts: campaign.trial_starts } : {}),
  });
  if (sub.trial_ends_at && new Date(sub.trial_ends_at) <= ends) return sub.trial_ends_at;
  // The first payment falls due when the free month ends, so the due date follows it while it
  // still equals the old end (nobody set it by hand).
  const followDue = !sub.next_due_at || !sub.trial_ends_at
    || new Date(sub.next_due_at).getTime() === new Date(sub.trial_ends_at).getTime();
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { trial_ends_at: ends, ...(followDue ? { next_due_at: ends } : {}) },
  });
  return ends;
}

/**
 * Call after an AI reply was sent to `customerWaId`. Resolves true when this reply made the shop
 * live. Never throws.
 */
async function noteAiReply(business, customerWaId, { now = new Date() } = {}) {
  try {
    if (!candidate(business, customerWaId)) return false;
    const at = new Date(now);
    const { count } = await prisma.business.updateMany({
      where: { id: business.id, went_live_at: null },
      data: { went_live_at: at },
    });
    // The in-memory row is reused for the rest of this batch; no second query for its next reply.
    business.went_live_at = business.went_live_at || at;
    if (!count) return false;

    let trialEndsAt = null;
    try {
      trialEndsAt = await startTrialClock(business, at);
    } catch (err) {
      console.error(`[wentLive] trial clock not started for business=${business.id}: ${err.message}`);
    }
    await accountEvents.record({
      businessId: business.id, actorKind: 'system', type: 'went_live',
      data: { trial_ends_at: trialEndsAt },
    });
    await alerts.notifyShift({
      reason: 'went_live',
      businessId: business.id,
      shopName: business.name || '',
      summary: `${business.name || 'المحل'} يعمل — أول رد للبوت على زبون`,
    });
    return true;
  } catch (err) {
    console.error(`[wentLive] business=${business && business.id}: ${err.message}`);
    return false;
  }
}

module.exports = { noteAiReply, candidate, startTrialClock };
