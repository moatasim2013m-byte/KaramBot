'use strict';

/**
 * The once-a-day account chores of the join campaign (docs/panels/spec.md, shiftSweeper runSweep):
 *
 *  - invite expiry: a join link that ran out unused writes AccountEvent invite_expired, so the
 *    board says «انتهت صلاحية الرابط — أعد إرساله» instead of a card that just sits there;
 *  - the 14-day backstop: a shop connected that long without a first reply to a customer has its
 *    free month started anyway (decisions-2026-10-08.md #4), written once as trial_started;
 *  - free-month reminders, 3 days before the end and on the day, to SHIFT (notifyShift) and to the
 *    owner (from the shop's own number, like its other alerts), once each per contract. They ask
 *    the owner to pay, so they wait for the morning (REMIND_FROM_HOUR, Amman time): the sweep runs
 *    the other chores just after midnight and these on its first sweep from 09:00.
 *
 * (The owner_alert template poll, a Graph read per shop, runs from shiftSweeper.sweepDaily on the
 * sweep's time budget, not here.)
 *
 * Run by shiftSweeper.sweepDaily once a day per instance. Every Cloud Run instance runs its own
 * sweep, so two can run these chores within the same minute; reading the AccountEvent rows first
 * cannot stop that (both read before either writes). So each item is claimed before anything is
 * written or sent: claimOnce compare-and-sets a mark in the shop's ai_config, and only the instance
 * whose write lands goes on. The AccountEvent rows (each names the link or the contract it was
 * written for) stay the record, and also skip items handled before the marks existed. Reads are
 * bounded by a look-back window, so a deploy does not wake up months-old invites or contracts.
 * Each chore's failure is counted and the others still run; nothing here throws.
 */

const prisma = require('../config/prisma');
const plans = require('../config/plans');
const platformSettings = require('./platformSettings');
const accountEvents = require('./accountEvents');
const alerts = require('./alerts');
const jsonb = require('../db/jsonb');

const DAY_MS = 24 * 60 * 60 * 1000;
// Links that expired within this window are recorded; older ones were before this code existed.
const INVITE_LOOKBACK_MS = 8 * DAY_MS;
// The «on the day» reminder still goes out when a sweep day was missed, but not for a free month
// that ended long ago.
const ENDED_GRACE_MS = 2 * DAY_MS;
const REMIND_AHEAD_DAYS = 3;
// The earliest Amman hour a reminder is sent: a payment message at midnight is not one an owner
// should wake up to, and SHIFT acts on its alert in the morning anyway.
const REMIND_FROM_HOUR = 9;
// The claim marks, in ai_config under this key. Marks older than this are dropped when another is
// written: the AccountEvent rows keep the history, the marks only need to outlive the race.
const CLAIMS_KEY = 'account_chores';
const CLAIM_KEEP_MS = 60 * DAY_MS;
const CLAIM_TRIES = 3;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Claim one chore item (`mark`, e.g. «trial_reminder:sub1:3») for this instance, atomically: a
 * compare-and-set of ai_config.account_chores against what was just read, so of two instances that
 * read the same value only one write lands. False when the item was already claimed, the shop is
 * gone, or the writes kept losing to other marks being added at the same moment.
 */
async function claimOnce(businessId, mark, now) {
  for (let i = 0; i < CLAIM_TRIES; i += 1) {
    const row = await prisma.business.findUnique({ where: { id: businessId }, select: { ai_config: true } });
    if (!row) return false;
    const current = isPlainObject(row.ai_config) && isPlainObject(row.ai_config[CLAIMS_KEY]) ? row.ai_config[CLAIMS_KEY] : null;
    if (current && current[mark]) return false;
    const next = { [mark]: new Date(now).toISOString() };
    for (const [k, at] of Object.entries(current || {})) {
      if (now.getTime() - new Date(at).getTime() <= CLAIM_KEEP_MS) next[k] = at;
    }
    if (await jsonb.casBusinessConfig(businessId, CLAIMS_KEY, current, next)) return true;
  }
  return false;
}

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
    if (!(await claimOnce(r.user.business_id, `invite_expired:${r.id}`, now))) continue;
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
    if (!(await claimOnce(s.business_id, `trial_started:${s.id}`, now))) continue;
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
const ammanHour = (d) => new Date(new Date(d).getTime() + AMMAN_OFFSET_MS).getUTCHours();

/** Whether it is late enough in the Amman day to send the free-month reminders. */
function remindersDue(now) {
  return ammanHour(now) >= REMIND_FROM_HOUR;
}

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
    // Claimed before anything is sent: another instance running this same minute must not send it
    // too (owner and SHIFT would each get it twice).
    if (!(await claimOnce(s.business_id, `trial_reminder:${s.id}:${kind}`, now))) continue;
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

/**
 * The day's chores. Resolves with counts per chore; never throws. The reminders run only when
 * `reminders` says so (by default: from REMIND_FROM_HOUR, Amman time); `trial_reminders` is null
 * when they did not run.
 */
async function runAccountsDaily(now = new Date(), { reminders } = {}) {
  const at = new Date(now);
  const remind = reminders === undefined ? remindersDue(at) : Boolean(reminders);
  const out = { invites_expired: 0, trials_started: 0, trial_reminders: remind ? 0 : null, errors: 0 };

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
    if (remind) {
      try {
        out.trial_reminders = (await remindTrials(contracts, at)).reminded;
      } catch (err) {
        out.errors += 1;
        console.warn(`[accountsDaily] trial reminders failed: ${err.message}`);
      }
    }
  } catch (err) {
    out.errors += 1;
    console.warn(`[accountsDaily] trial contracts not read: ${err.message}`);
  }
  return out;
}

/** The reminders alone, for the sweep's first run from REMIND_FROM_HOUR. Never throws. */
async function runTrialReminders(now = new Date()) {
  const at = new Date(now);
  try {
    return { trial_reminders: (await remindTrials(await trialContracts(at), at)).reminded, errors: 0 };
  } catch (err) {
    console.warn(`[accountsDaily] trial reminders failed: ${err.message}`);
    return { trial_reminders: 0, errors: 1 };
  }
}

module.exports = {
  runAccountsDaily, runTrialReminders, remindersDue, reminderKind, claimOnce, INVITE_LOOKBACK_MS, REMIND_FROM_HOUR, CLAIMS_KEY,
};
