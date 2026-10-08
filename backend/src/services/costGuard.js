/**
 * The cost guard: how many bot replies and media reads a shop may spend, and what happens past
 * that (docs/panels/spec.md P1; decisions-2026-10-08.md 6 and 7).
 *
 * Every AI reply and every voice note, photo or video read costs SHIFT money, and a free-month
 * shop pays nothing for either. Three limits:
 *   - a monthly reply cap per shop: Subscription.ai_replies_month (the plan it was sold on), else
 *     PlatformSetting ai_limits.reply_month_default;
 *   - a daily media-read cap per shop: ai_limits.media_day_default;
 *   - a daily ceiling across every customer shop: ai_limits.platform_day_ceiling.
 *
 * Hard during the free month (the bot stops and the shop's staff take the chats), soft for paying
 * shops (the bot keeps answering and SHIFT is told), as decision 6 says. A shop with no contract
 * at all is one of the hand-wired shops that predate contracts: it is treated as paying, because
 * silencing a live customer's bot on deploy is worse than an overspend SHIFT hears about. At the
 * platform ceiling free-month shops stop first (ceiling_policy 'trials_first'); 'all' stops
 * everyone.
 *
 * SHIFT's own number (business_type 'shift') and the internal rows are never limited: the sales
 * bot is how SHIFT sells, and its replies are not a customer's cost.
 *
 * Counts are read from the messages table (no counter column to drift) and cached in-process for
 * 60 s, so the guard is one cheap read per shop per minute on the hot path. A cache can let a shop
 * run a minute past its cap on one instance; that is the price of not counting on every message.
 * Periods are Amman days and months.
 *
 * The guard fails open: if a count cannot be read, the bot answers. A database hiccup must not
 * silence every shop at once.
 */

const prisma = require('../config/prisma');
const platformSettings = require('./platformSettings');
const accountEvents = require('./accountEvents');
const { DEFAULT_PLAN } = require('../config/plans');

const CACHE_MS = 60 * 1000;
const TIME_ZONE = 'Asia/Amman';
const MEDIA_TYPES = ['audio', 'video', 'image'];
const WARN_RATIO = 0.8;

// ─── Amman periods ─────────────────────────────────────────────────────────

const ammanParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function partsOf(now) {
  const out = {};
  for (const p of ammanParts.formatToParts(new Date(now))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

// Amman's offset from UTC at `now`, read from the time-zone database rather than assumed, so a
// return of DST would not move every period by an hour.
function offsetMs(now) {
  const p = partsOf(now);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wall - Math.floor(new Date(now).getTime() / 1000) * 1000) / 60000) * 60000;
}

/** 'YYYY-MM-DD' of `now` in Amman. */
function ammanDay(now = new Date()) {
  const p = partsOf(now);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** 'YYYY-MM' of `now` in Amman. */
function ammanMonth(now = new Date()) {
  return ammanDay(now).slice(0, 7);
}

/** Midnight in Amman that began `now`'s day, as a Date. */
function dayStart(now = new Date()) {
  const p = partsOf(now);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - offsetMs(now));
}

/** The 1st of `now`'s month, midnight in Amman. */
function monthStart(now = new Date()) {
  const p = partsOf(now);
  return new Date(Date.UTC(p.year, p.month - 1, 1) - offsetMs(now));
}

// ─── cached counts ─────────────────────────────────────────────────────────

const cache = new Map(); // key → { at, value }

async function cached(key, read, now) {
  const hit = cache.get(key);
  const t = new Date(now).getTime();
  if (hit && t - hit.at < CACHE_MS && t >= hit.at) return hit.value;
  const value = await read();
  cache.set(key, { at: t, value });
  return value;
}

function clearCache() {
  cache.clear();
  memo.clear();
}

/** Bot replies (outbound, is_ai_generated) this shop sent since the 1st, Amman time. */
async function monthlyAiReplies(businessId, { now = new Date() } = {}) {
  return cached(`month:${businessId}:${ammanMonth(now)}`, () => prisma.message.count({
    where: { business_id: businessId, direction: 'outbound', is_ai_generated: true, created_at: { gte: monthStart(now) } },
  }), now);
}

/** Voice notes, photos and videos customers sent this shop since midnight, Amman time. */
async function mediaReadsToday(businessId, { now = new Date() } = {}) {
  return cached(`media:${businessId}:${ammanDay(now)}`, () => prisma.message.count({
    where: { business_id: businessId, direction: 'inbound', message_type: { in: MEDIA_TYPES }, created_at: { gte: dayStart(now) } },
  }), now);
}

// The customer shops: not SHIFT's own number, not the internal test rows.
async function customerShopIds() {
  const rows = await prisma.business.findMany({
    where: { is_internal: false, business_type: { not: 'shift' } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Bot replies across every customer shop since midnight, Amman time. */
async function platformAiRepliesToday({ now = new Date() } = {}) {
  return cached(`platform:${ammanDay(now)}`, async () => {
    const ids = await customerShopIds();
    if (!ids.length) return 0;
    return prisma.message.count({
      where: { business_id: { in: ids }, direction: 'outbound', is_ai_generated: true, created_at: { gte: dayStart(now) } },
    });
  }, now);
}

/**
 * A bot reply was just saved: bump the cached counts so this instance does not wait out the cache
 * to see it. The next read from the database replaces the estimate.
 */
function noteReply(businessId, { now = new Date() } = {}) {
  for (const key of [`month:${businessId}:${ammanMonth(now)}`, `platform:${ammanDay(now)}`]) {
    const hit = cache.get(key);
    if (hit) hit.value += 1;
  }
}

// ─── limits ────────────────────────────────────────────────────────────────

/** SHIFT's own number and the internal rows: never limited. */
function isExempt(business) {
  return !business || business.is_internal === true || business.business_type === 'shift';
}

function positive(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * The live Karam Bot contract: the newest one not cancelled. Only the bot's own solution counts:
 * a newer website or automation contract in 'trial' must not make a paying bot shop's cap hard,
 * and a newer paid one must not make a free-month bot look paid.
 */
async function contractFor(businessId) {
  return prisma.subscription.findFirst({
    where: { business_id: businessId, solution: DEFAULT_PLAN.solution, status: { not: 'cancelled' } },
    orderBy: { created_at: 'desc' },
    select: { status: true, ai_replies_month: true },
  });
}

/**
 * The limits that apply to one shop. `contract` may be passed when the caller already read it.
 * @returns {Promise<{replyMonth:number, mediaDay:number, platformDay:number, policy:string, trial:boolean}>}
 */
async function limitsFor(businessId, { contract } = {}) {
  const [limits, sub] = await Promise.all([
    platformSettings.get('ai_limits'),
    contract !== undefined ? contract : contractFor(businessId),
  ]);
  return {
    replyMonth: positive(sub && sub.ai_replies_month) || positive(limits.reply_month_default) || DEFAULT_PLAN.ai_replies_month,
    mediaDay: positive(limits.media_day_default) || DEFAULT_PLAN.media_reads_day,
    platformDay: positive(limits.platform_day_ceiling) || null,
    policy: limits.ceiling_policy === 'all' ? 'all' : 'trials_first',
    trial: Boolean(sub && sub.status === 'trial'),
  };
}

// ─── once-per-period events ────────────────────────────────────────────────

// Which events this instance already knows were written, so a shop past 80% does not cost a
// lookup on every message for the rest of the month. Another instance may write the same event
// once more in a race; a duplicate log line is the cheaper failure.
const memo = new Set();

const fmt = (n) => Number(n).toLocaleString('en-US');

async function oncePerPeriod({ businessId, type, since, memoKey, data, alert }) {
  if (memo.has(memoKey)) return false;
  const existing = await prisma.accountEvent.findFirst({
    where: { business_id: businessId, type, created_at: { gte: since } },
    select: { id: true },
  });
  memo.add(memoKey);
  if (existing) return false;
  await accountEvents.record({ businessId, actorKind: 'system', type, data });
  // Required here, not at the top: alerts.js reaches whatsapp.js, which the message path's tests
  // replace; a late require keeps this module loadable on its own.
  Promise.resolve(require('./alerts').notifyShift({ businessId, ...alert })).catch(() => {});
  return true;
}

async function noteMonthly(business, used, limits, now) {
  const cap = limits.replyMonth;
  const month = ammanMonth(now);
  const since = monthStart(now);
  if (used >= cap) {
    await oncePerPeriod({
      businessId: business.id, type: 'cap_reached', since, memoKey: `${business.id}:cap_reached:${month}`,
      data: { used, cap, month, trial: limits.trial },
      alert: {
        reason: 'cap_reached', shopName: business.name || '',
        summary: limits.trial
          ? `وصل حد ردود الشهر (${fmt(used)} / ${fmt(cap)}) — البوت يحوّل الزبائن للفريق`
          : `وصل حد ردود الشهر (${fmt(used)} / ${fmt(cap)}) — اشتراك مدفوع، البوت مستمر`,
      },
    });
  }
  if (used >= Math.ceil(cap * WARN_RATIO)) {
    await oncePerPeriod({
      businessId: business.id, type: 'cap_80', since, memoKey: `${business.id}:cap_80:${month}`,
      data: { used, cap, month },
      alert: { reason: 'cap_80', shopName: business.name || '', summary: `استهلك 80% من ردود الشهر (${fmt(used)} / ${fmt(cap)})` },
    });
  }
}

async function notePlatformCeiling(used, ceiling, now) {
  const day = ammanDay(now);
  await oncePerPeriod({
    businessId: null, type: 'platform_ceiling', since: dayStart(now), memoKey: `platform_ceiling:${day}`,
    data: { used, ceiling, day },
    alert: {
      reason: 'platform_ceiling', shopName: 'المنصة',
      summary: `بلغت ردود البوت اليوم سقف المنصة (${fmt(used)} / ${fmt(ceiling)}) — ردود التجارب متوقفة حتى منتصف الليل`,
    },
  });
}

// ─── the decision ──────────────────────────────────────────────────────────

/**
 * May this shop's bot spend on this message?
 *
 * kind 'reply' (an AI reply) or 'media' (read a voice note, photo or video, then reply). The
 * current inbound message is already stored, so for 'media' today's count includes it.
 *
 * @returns {Promise<{ok: boolean, reason: null|'monthly_cap'|'media_cap'|'platform_ceiling', soft?: boolean}>}
 *   ok false: do not read or reply; the shop's staff take it. ok true with a reason: over a limit
 *   but allowed (a paying shop), and SHIFT has been told.
 */
async function allow(business, kind = 'reply', { now = new Date() } = {}) {
  if (isExempt(business)) return { ok: true, reason: null };
  try {
    // The contract changes a few times a year; it is cached with the counts.
    const contract = await cached(`contract:${business.id}`, () => contractFor(business.id), now);
    const limits = await limitsFor(business.id, { contract });
    const [used, platformUsed, mediaUsed] = await Promise.all([
      monthlyAiReplies(business.id, { now }),
      limits.platformDay ? platformAiRepliesToday({ now }) : 0,
      kind === 'media' ? mediaReadsToday(business.id, { now }) : 0,
    ]);

    await noteMonthly(business, used, limits, now);
    const ceilingHit = Boolean(limits.platformDay) && platformUsed >= limits.platformDay;
    if (ceilingHit) await notePlatformCeiling(platformUsed, limits.platformDay, now);

    const hard = limits.trial;
    const verdict = (reason, stop) => (stop ? { ok: false, reason } : { ok: true, reason, soft: true });

    if (used >= limits.replyMonth) return verdict('monthly_cap', hard);
    if (ceilingHit) return verdict('platform_ceiling', hard || limits.policy === 'all');
    // The message being read is counted, so the cap's own number is still allowed.
    if (kind === 'media' && mediaUsed > limits.mediaDay) return verdict('media_cap', hard);
    return { ok: true, reason: null };
  } catch (err) {
    console.error(`[costGuard] check failed business=${business && business.id}, allowing: ${err.message}`);
    return { ok: true, reason: null };
  }
}

/**
 * The admin overview's «ردود الشهر» for many shops at once, in two grouped reads.
 * `contracts` maps business id → the live Karam Bot Subscription row (with ai_replies_month);
 * rows of other solutions are ignored, as contractFor does.
 * @returns {Promise<Map<string, {ai_replies_month:number, cap:number, media_today:number}>>}
 */
async function fleetUsage(businessIds, { contracts = new Map(), now = new Date() } = {}) {
  const out = new Map();
  if (!businessIds.length) return out;
  // The counts are the point of this screen; an unreadable setting falls back to the plan's cap.
  const limits = await platformSettings.get('ai_limits').catch(() => ({}));
  const [replies, media] = await Promise.all([
    prisma.message.groupBy({
      by: ['business_id'],
      where: { business_id: { in: businessIds }, direction: 'outbound', is_ai_generated: true, created_at: { gte: monthStart(now) } },
      _count: { _all: true },
    }),
    prisma.message.groupBy({
      by: ['business_id'],
      where: { business_id: { in: businessIds }, direction: 'inbound', message_type: { in: MEDIA_TYPES }, created_at: { gte: dayStart(now) } },
      _count: { _all: true },
    }),
  ]);
  const count = (rows) => new Map((rows || []).map((r) => [r.business_id, (r._count && r._count._all) || 0]));
  const repliesBy = count(replies);
  const mediaBy = count(media);
  for (const id of businessIds) {
    const found = contracts.get(id);
    const sub = found && (!found.solution || found.solution === DEFAULT_PLAN.solution) ? found : null;
    out.set(id, {
      ai_replies_month: repliesBy.get(id) || 0,
      cap: positive(sub && sub.ai_replies_month) || positive(limits.reply_month_default) || DEFAULT_PLAN.ai_replies_month,
      media_today: mediaBy.get(id) || 0,
    });
  }
  return out;
}

module.exports = {
  allow,
  monthlyAiReplies,
  mediaReadsToday,
  platformAiRepliesToday,
  limitsFor,
  fleetUsage,
  noteReply,
  isExempt,
  ammanDay,
  ammanMonth,
  dayStart,
  monthStart,
  clearCache,
  CACHE_MS,
  WARN_RATIO,
  BOT_SOLUTION: DEFAULT_PLAN.solution,
};
