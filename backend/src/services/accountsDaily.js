'use strict';

/**
 * The once-a-day account chores of the join campaign (docs/panels/spec.md, shiftSweeper runSweep):
 *
 *  - invite expiry: a join link that ran out unused writes AccountEvent invite_expired, so the
 *    board says «انتهت صلاحية الرابط — أعد إرساله» instead of a card that just sits there;
 *  - the 14-day backstop: a shop connected that long without a first reply to a customer has its
 *    free month started anyway (decisions-2026-10-08.md #4), written once as trial_started;
 *  - free-month reminders, 3 days before the end and on the day, to SHIFT (notifyShift) and to the
 *    owner (from the shop's own number, like its other alerts), once each per contract;
 *  - the owner_alert template poll (ownerAlertTemplate.pollPending).
 *
 * Run by shiftSweeper.sweepDaily on the first sweep of each Amman day. Every chore is idempotent
 * through AccountEvent rows (each names the link or the contract it was written for), so a second
 * instance running the same day, or a retry, writes and sends nothing twice. Reads are bounded by
 * a look-back window, so a deploy does not wake up months-old invites or contracts. Each chore's
 * failure is counted and the others still run; nothing here throws.
 */

const prisma = require('../config/prisma');
const plans = require('../config/plans');
const platformSettings = require('./platformSettings');
const accountEvents = require('./accountEvents');
const alerts = require('./alerts');
const ownerAlertTemplate = require('./ownerAlertTemplate');

const DAY_MS = 24 * 60 * 60 * 1000;
// Links that expired within this window are recorded; older ones were before this code existed.
const INVITE_LOOKBACK_MS = 8 * DAY_MS;
// The «on the day» reminder still goes out when a sweep day was missed, but not for a free month
// that ended long ago.
const ENDED_GRACE_MS = 2 * DAY_MS;
const REMIND_AHEAD_DAYS = 3;

async function eventsOf(type, businessIds) {
  if (!businessIds.length) return [];
  return prisma.accountEvent.findMany({
    where: { type, business_id: { in: businessIds } },
    select: { business_id: true, data: true },
  });
}

const dataKey = (e, field) => (e && e.data && e.data[field] != null ? String(e.data[field]) : null);

/** Day/month in Amman time («15/10»): no month names, which read differently in Jordan and the Gulf. */
function shortDate(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Amman', day: 'numeric', month: 'numeric' }).format(new Date(d));
}

async function expireInvites(now) {
  const out = { expired: 0 };
  const rows = await prisma.userActivation.findMany({
    where: { used_at: null, expires_at: { lt: now, gte: new Date(now.getTime() - INVITE_LOOKBACK_MS) } },
    select: {
      id: true, user_id: true, expires_at: true,
      user: { select: { id: true, role: true, business_id: true, last_login: true } },
    },
  });
  // Owners' join links only, and only for someone who never got in: a link left over after the
  // owner signed in some other way is not a lost invite.
  const lost = rows.filter((r) => r.user && r.user.role === 'business_owner' && r.user.business_id && !r.user.last_login);
  const seen = new Set((await eventsOf('invite_expired', [...new Set(lost.map((r) => r.user.business_id))]))
    .map((e) => dataKey(e, 'activation_id')));
  for (const r of lost) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const ok = await accountEvents.record({
      businessId: r.user.business_id, actorKind: 'system', type: 'invite_expired',
      data: { activation_id: r.id, user_id: r.user_id, expires_at: r.expires_at },
    });
    if (ok) out.expired += 1;
  }
  return out;
}

async function trialContracts(now) {
  const subs = await prisma.subscription.findMany({
    where: { status: 'trial' },
    select: {
      id: true, business_id: true, starts_at: true, trial_ends_at: true, next_due_at: true,
    },
  });
  if (!subs.length) return { subs: [], shops: new Map() };
  const shops = await prisma.business.findMany({
    where: { id: { in: [...new Set(subs.map((s) => s.business_id))] } },
    select: {
      id: true, name: true, status: true, business_type: true, is_internal: true, owner_phone: true,
      connected_at: true, went_live_at: true, wa_phone_number_id: true, wa_access_token: true, ai_config: true,
    },
  });
  const byId = new Map(shops.filter((b) => !b.is_internal && b.business_type !== 'shift' && b.status !== 'closed').map((b) => [b.id, b]));
  return { subs: subs.filter((s) => byId.has(s.business_id)), shops: byId, now };
}

/**
 * The backstop: connected `backstop_days` ago and still no first reply. trial_ends_at was stored at
 * connect as the latest the free month can end (connect + backstop + trial days); this records
 * that it has started, and fills the date for a contract made without one.
 */
async function startBackstopTrials({ subs, shops }, now, campaign) {
  const out = { started: 0 };
  const backstopDays = Number.isFinite(campaign.backstop_days) ? campaign.backstop_days : plans.DEFAULT_PLAN.trial_backstop_days;
  const due = subs.filter((s) => {
    const shop = shops.get(s.business_id);
    const connectedAt = shop && (shop.connected_at || s.starts_at);
    return shop && !shop.went_live_at && connectedAt
      && new Date(connectedAt).getTime() + backstopDays * DAY_MS <= now.getTime();
  });
  const seen = new Set((await eventsOf('trial_started', [...new Set(due.map((s) => s.business_id))])).map((e) => dataKey(e, 'subscription_id')));
  for (const s of due) {
    if (seen.has(s.id)) continue;
    const shop = shops.get(s.business_id);
    let ends = s.trial_ends_at;
    if (!ends) {
      ends = plans.trialEndsAt({
        connectedAt: shop.connected_at || s.starts_at,
        backstopDays,
        ...(Number.isFinite(campaign.trial_days) ? { trialDays: campaign.trial_days } : {}),
        ...(['first_reply', 'connect'].includes(campaign.trial_starts) ? { trialStarts: campaign.trial_starts } : {}),
      });
      await prisma.subscription.update({
        where: { id: s.id },
        data: { trial_ends_at: ends, ...(s.next_due_at ? {} : { next_due_at: ends }) },
      });
      s.trial_ends_at = ends;
    }
    const ok = await accountEvents.record({
      businessId: s.business_id, actorKind: 'system', type: 'trial_started',
      data: { subscription_id: s.id, reason: 'backstop', trial_ends_at: ends },
    });
    if (ok) out.started += 1;
  }
  return out;
}

// Jordan is UTC+3 all year (no DST since 2022), so an Amman calendar day is a whole UTC+3 day.
const AMMAN_OFFSET_MS = 3 * 60 * 60 * 1000;
const ammanDayNumber = (d) => Math.floor((new Date(d).getTime() + AMMAN_OFFSET_MS) / DAY_MS);

/**
 * Which reminder is due, by Amman calendar day: 3 when the free month ends in one to three days,
 * 0 when it ends today (or ended within the grace, for a sweep day that was missed), else null.
 */
function reminderKind(endsAt, now) {
  if (!endsAt) return null;
  const end = new Date(endsAt);
  const days = ammanDayNumber(end) - ammanDayNumber(now);
  if (days < 0) return now.getTime() - end.getTime() <= ENDED_GRACE_MS ? 0 : null;
  if (days === 0) return 0;
  return days <= REMIND_AHEAD_DAYS ? REMIND_AHEAD_DAYS : null;
}

async function remindTrials({ subs, shops }, now) {
  const out = { reminded: 0 };
  const due = subs.map((s) => ({ s, kind: reminderKind(s.trial_ends_at, now) })).filter((x) => x.kind !== null);
  const seen = new Set((await eventsOf('trial_reminder', [...new Set(due.map((x) => x.s.business_id))]))
    .map((e) => `${dataKey(e, 'subscription_id')}:${dataKey(e, 'days')}`));
  for (const { s, kind } of due) {
    if (seen.has(`${s.id}:${kind}`)) continue;
    const shop = shops.get(s.business_id);
    // Recorded before sending: a crash after a send would otherwise send it again tomorrow.
    const ok = await accountEvents.record({
      businessId: s.business_id, actorKind: 'system', type: 'trial_reminder',
      data: { subscription_id: s.id, days: kind, trial_ends_at: s.trial_ends_at },
    });
    if (!ok) continue;
    out.reminded += 1;
    const when = shortDate(s.trial_ends_at);
    await alerts.notifyShift({
      reason: 'trial_ending',
      businessId: shop.id,
      shopName: shop.name,
      summary: kind === 0
        ? `الفترة المجانية لـ${shop.name} تنتهي اليوم (${when}) — تواصل معه بخصوص الدفع`
        : `الفترة المجانية لـ${shop.name} تنتهي خلال ${REMIND_AHEAD_DAYS} أيام (${when})`,
    });
    // The owner hears it from their own shop's number, like the bot's other alerts. Skipped
    // quietly when the shop has no number or its alert template is not approved yet.
    if (shop.wa_phone_number_id && shop.wa_access_token) {
      await alerts.sendStaffAlert({
        reason: 'trial_reminder',
        business: shop,
        conversation: { id: null, profile_name: shop.name, customer_wa_id: null },
        summary: kind === 0
          ? `تنتهي الفترة المجانية اليوم (${when}). ليستمر البوت بالرد، ادفع الاشتراك من صفحة «الاشتراك» أو راسل شِفت.`
          : `تنتهي الفترة المجانية خلال ${REMIND_AHEAD_DAYS} أيام (${when}). تفاصيل الدفع في صفحة «الاشتراك».`,
        now,
      });
    }
  }
  return out;
}

/** The day's chores. Resolves with counts per chore; never throws. */
async function runAccountsDaily(now = new Date()) {
  const out = { invites_expired: 0, trials_started: 0, trial_reminders: 0, templates: null, errors: 0 };
  const at = new Date(now);

  try {
    out.invites_expired = (await expireInvites(at)).expired;
  } catch (err) {
    out.errors += 1;
    console.warn(`[accountsDaily] invite expiry failed: ${err.message}`);
  }

  try {
    const campaign = (await platformSettings.get('campaign').catch(() => null)) || {};
    const contracts = await trialContracts(at);
    try {
      out.trials_started = (await startBackstopTrials(contracts, at, campaign)).started;
    } catch (err) {
      out.errors += 1;
      console.warn(`[accountsDaily] trial backstop failed: ${err.message}`);
    }
    try {
      out.trial_reminders = (await remindTrials(contracts, at)).reminded;
    } catch (err) {
      out.errors += 1;
      console.warn(`[accountsDaily] trial reminders failed: ${err.message}`);
    }
  } catch (err) {
    out.errors += 1;
    console.warn(`[accountsDaily] trial contracts not read: ${err.message}`);
  }

  try {
    out.templates = await ownerAlertTemplate.pollPending({ now: at });
  } catch (err) {
    out.errors += 1;
    console.warn(`[accountsDaily] owner alert template poll failed: ${err.message}`);
  }
  return out;
}

module.exports = { runAccountsDaily, reminderKind, INVITE_LOOKBACK_MS };
