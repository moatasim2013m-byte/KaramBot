'use strict';

/**
 * SHIFT sales-call booking in Google Calendar (PR3 design §Flow).
 *
 * Karam offers real free 30-minute slots from the team's calendar, books the one the customer taps, and
 * lets the customer change or cancel it. Everything here is deterministic server logic run under the reply
 * lease (never the model), and every result goes through the batcher's deliverResult, so the booking is
 * persisted in workflow_data before «ثبّتنا» is sent (D17, D26).
 *
 * Honesty rules this file owns:
 * - «ثبّتنا» / "booked" only after the calendar accepted the event (or a retry found it) — the batcher then
 *   persists `workflow_data.booking` before it sends the confirmation.
 * - Whenever the calendar is unconfigured, disabled (SHIFT_BOOKING=0) or unreachable, the PR1/PR2 "call
 *   request" applies unchanged: window offers, «سجّلت طلب مكالمة — طلب مش موعد مؤكد», needs_team, alert.
 * - A change or cancel that the calendar refused is passed to the team, and the customer is told the current
 *   booking stays as it is until the team confirms.
 *
 * Offers use `slot_offers` (PR1 key) with ids `book:<startISO>` next to PR1's `slot:other` («وقت ثاني»).
 */

const crypto = require('crypto');
const calendar = require('../../services/googleCalendar');
const hours = require('./hours');
const acks = require('./acks');
const validators = require('./validators');
const calendly = require('./calendly');

const DEFAULT_SLOT_MINUTES = 30;
const DEFAULT_MIN_LEAD_MINUTES = 120;
const DEFAULT_HORIZON_DAYS = 5;
const OFFER_TTL_MS = 12 * 60 * 60 * 1000;
// A tap on a slot whose offer list was overwritten is still honoured when it is at least this far ahead.
const TAP_MIN_LEAD_MS = 30 * 60 * 1000;
// A slot from a current offer can still be booked until this close to its start.
const TAP_OFFER_LEAD_MS = 15 * 60 * 1000;
const BUSY_CACHE_MS = 60 * 1000;
const EVENT_ID_LENGTH = 26;
const HISTORY_CAP = 10;
const MAX_TITLE = 20;
const INTENT_MAX_WORDS = 15;
const ACTIVE_STATUSES = ['booked', 'rescheduled'];
const BOOK_ID_RE = /^book:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/;
const CONTROL_IDS = ['book_ok', 'book_change', 'book_cancel', 'book_seeyou'];
const TEMPLATE_NAME = 'shift_call_reminder';
const DETAILS_TASK = 'booking_details';

// Template quick replies arrive as `type: 'button'` messages with the button text (and our payload).
const TEMPLATE_REPLIES = {
  book_seeyou: ['تمام، بشوفكم', 'تمام بشوفكم', 'see you then'],
  book_change: ['بدي أغيّر الموعد', 'بدي اغير الموعد', 'بدي أغير الموعد', 'change the time'],
};

let busyCache = null; // { key, fromMs, toMs, atMs, busy }

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function toMs(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  return Date.parse(v);
}

function isEn(lang) {
  return lang === 'en';
}

function codePoints(s) {
  return Array.from(String(s)).length;
}

// ─── configuration ───────────────────────────────────────────────────────────

function positiveInt(v, min, max) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Env overrides take precedence over ai_config.calendar (design §Configuration). */
function bookingConfig(business, env = process.env) {
  const cfg = business && business.ai_config && typeof business.ai_config.calendar === 'object' && business.ai_config.calendar
    ? business.ai_config.calendar
    : {};
  const salesCalendarId = str(env.SHIFT_SALES_CALENDAR_ID) || str(cfg.sales_calendar_id);
  const fromEnv = String(env.SHIFT_BUSY_CALENDAR_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const fromCfg = Array.isArray(cfg.busy_calendar_ids) ? cfg.busy_calendar_ids.map(str).filter(Boolean) : [];
  const listed = fromEnv.length ? fromEnv : fromCfg;
  // The sales calendar is always read: without it the bot could not see its own bookings and would double-book.
  const busyCalendarIds = salesCalendarId ? Array.from(new Set([salesCalendarId, ...listed])) : [];
  return {
    configured: !!salesCalendarId,
    enabled: !!salesCalendarId && env.SHIFT_BOOKING !== '0',
    salesCalendarId,
    busyCalendarIds,
    slotMinutes: positiveInt(env.SHIFT_SLOT_MINUTES, 15, 120) || positiveInt(cfg.slot_minutes, 15, 120) || DEFAULT_SLOT_MINUTES,
    minLeadMinutes: positiveInt(cfg.min_lead_minutes, 0, 7 * 24 * 60) ?? DEFAULT_MIN_LEAD_MINUTES,
    horizonDays: positiveInt(cfg.horizon_days, 1, 30) || DEFAULT_HORIZON_DAYS,
  };
}

function resetBusyCache() {
  busyCache = null;
}

// ─── slots ───────────────────────────────────────────────────────────────────

function minutesToHm(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Every slot of `slotMinutes` inside team hours, on the next `horizonDays` team days that still have one,
 * starting no sooner than `minLeadMinutes` from now. Friday/Saturday (not team days by default) and closures
 * are skipped by hours.isTeamDay; times are Amman wall-clock times converted with Intl (no server local time).
 */
function candidateSlots(teamHours, now = new Date(), { slotMinutes = DEFAULT_SLOT_MINUTES, minLeadMinutes = DEFAULT_MIN_LEAD_MINUTES, horizonDays = DEFAULT_HORIZON_DAYS } = {}) {
  const th = teamHours || hours.DEFAULT_TEAM_HOURS;
  const fromM = hours.hmToMinutes(th.from);
  const toM = hours.hmToMinutes(th.to);
  const earliest = toMs(now) + minLeadMinutes * 60000;
  const today = hours.localParts(now, th.tz).dateKey;
  const out = [];
  let days = 0;
  for (let i = 0; i <= 31 && days < horizonDays; i++) {
    const dateKey = hours.addDays(today, i);
    if (!hours.isTeamDay(th, dateKey)) continue;
    const daySlots = [];
    for (let m = fromM; m + slotMinutes <= toM; m += slotMinutes) {
      const start = hours.zonedDate(dateKey, minutesToHm(m), th.tz);
      if (start.getTime() < earliest) continue;
      daySlots.push({ start, end: new Date(start.getTime() + slotMinutes * 60000), dateKey });
    }
    if (!daySlots.length) continue;
    days += 1;
    out.push(...daySlots);
  }
  return out;
}

function overlaps(slot, busy) {
  const s = toMs(slot.start);
  const e = toMs(slot.end);
  return (Array.isArray(busy) ? busy : []).some((b) => toMs(b.start) < e && toMs(b.end) > s);
}

function freeSlots(slots, busy) {
  return slots.filter((slot) => !overlaps(slot, busy));
}

/** The first free slot, and the first free slot on a later day (else the next one), in time order. */
function pickOffers(free, count = 2) {
  if (!free.length) return [];
  const first = free[0];
  const later = free.find((s) => s.dateKey !== first.dateKey) || free[1];
  return [first, later].filter(Boolean).slice(0, count).sort((a, b) => toMs(a.start) - toMs(b.start));
}

/** A slot start from the team's grid inside team hours on a team day (a forged or stale id is refused). */
function isGridSlot(teamHours, start, slotMinutes) {
  const th = teamHours;
  const p = hours.localParts(start, th.tz);
  const fromM = hours.hmToMinutes(th.from);
  const toM = hours.hmToMinutes(th.to);
  const d = new Date(start);
  return d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0 && hours.isTeamDay(th, p.dateKey)
    && p.minutes >= fromM && p.minutes + slotMinutes <= toM && (p.minutes - fromM) % slotMinutes === 0;
}

// ─── wording ─────────────────────────────────────────────────────────────────

function periodAr(hh) {
  if (hh < 12) return 'الصبح';
  if (hh < 15) return 'الظهر';
  if (hh < 18) return 'العصر';
  return 'المسا';
}

function clockText(parts, lang) {
  const h12 = parts.hh % 12 || 12;
  const clock = `${h12}:${String(parts.mm).padStart(2, '0')}`;
  return isEn(lang) ? `${clock} ${parts.hh >= 12 ? 'pm' : 'am'}` : `${clock} ${periodAr(parts.hh)}`;
}

/** {day, time} of a start in the team's zone: «بكرا» / «الأربعاء 16/9» and «10:30 الصبح» (en: "10:30 am"). */
function whenParts(start, now, tz, lang) {
  const zone = tz || hours.DEFAULT_TEAM_HOURS.tz;
  const p = hours.localParts(start, zone);
  const word = hours.dayWord(p.dateKey, now, zone, lang);
  const [, mo, d] = p.dateKey.split('-').map(Number);
  const weekday = (isEn(lang) ? hours.WEEKDAYS_EN : hours.WEEKDAYS_AR)[p.weekday];
  const day = word === weekday ? `${weekday} ${d}/${mo}` : word;
  return { day, time: clockText(p, lang) };
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function offerTitle(start, now, tz, lang) {
  const p = hours.localParts(start, tz);
  const word = hours.dayWord(p.dateKey, now, tz, lang);
  const day = isEn(lang) ? capitalize(word) : word;
  const full = `${day} ${clockText(p, lang)}`;
  if (codePoints(full) <= MAX_TITLE) return full;
  const h12 = p.hh % 12 || 12;
  return Array.from(`${day} ${h12}:${String(p.mm).padStart(2, '0')}`).slice(0, MAX_TITLE).join('');
}

function otherTitle(lang) {
  return isEn(lang) ? 'Another time' : 'وقت ثاني';
}

function bookId(start) {
  return `book:${new Date(start).toISOString()}`;
}

function parseBookId(id) {
  const m = typeof id === 'string' ? BOOK_ID_RE.exec(id) : null;
  if (!m) return null;
  const start = new Date(m[1]);
  return Number.isNaN(start.getTime()) ? null : start;
}

function isBookingId(id) {
  return typeof id === 'string' && (CONTROL_IDS.includes(id) || BOOK_ID_RE.test(id));
}

const TEXTS = {
  booked: {
    ar: ({ day, time }) => `ثبّتنا مكالمتك مع فريق شِفت: ${day} الساعة ${time} بتوقيت عمّان. رح نذكّرك قبلها.`,
    en: ({ day, time }) => `Your call with the SHIFT team is booked: ${day} at ${time} Amman time. We'll remind you before it.`,
  },
  rescheduled: {
    ar: ({ day, time }) => `غيّرنا موعد مكالمتك مع فريق شِفت: صار ${day} الساعة ${time} بتوقيت عمّان. رح نذكّرك قبلها.`,
    en: ({ day, time }) => `Your call with the SHIFT team is moved: now ${day} at ${time} Amman time. We'll remind you before it.`,
  },
  cancelled: {
    ar: () => 'لغيت المكالمة. إذا حبيت نرتّب وقت ثاني احكيلي.',
    en: () => "I've cancelled the call. If you'd like another time, just tell me.",
  },
};

function detailsAsk({ nameKnown, businessKnown, lang }) {
  if (nameKnown && businessKnown) return '';
  if (isEn(lang)) {
    if (nameKnown) return "And what's your business name, so the team is ready?";
    if (businessKnown) return "And what's your name, so the team is ready?";
    return "And what's your name and your business name, so the team is ready?";
  }
  if (nameKnown) return 'وشو اسم المحل عشان الفريق يكون جاهز؟';
  if (businessKnown) return 'وشو اسمك عشان الفريق يكون جاهز؟';
  return 'وشو اسمك واسم المحل عشان الفريق يكون جاهز؟';
}

function confirmButtons(lang) {
  return isEn(lang)
    ? [{ id: 'book_ok', title: 'OK' }, { id: 'book_change', title: 'Change time' }, { id: 'book_cancel', title: 'Cancel call' }]
    : [{ id: 'book_ok', title: 'تمام' }, { id: 'book_change', title: 'غيّر الموعد' }, { id: 'book_cancel', title: 'ألغِ المكالمة' }];
}

function cancelAskButtons(lang) {
  return isEn(lang)
    ? [{ id: 'book_cancel', title: 'Cancel call' }, { id: 'book_ok', title: 'Keep it' }]
    : [{ id: 'book_cancel', title: 'ألغِ المكالمة' }, { id: 'book_ok', title: 'خليها' }];
}

function reminderButtons(lang) {
  return isEn(lang)
    ? [{ id: 'book_seeyou', title: 'See you then' }, { id: 'book_change', title: 'Change the time' }]
    : [{ id: 'book_seeyou', title: 'تمام، بشوفكم' }, { id: 'book_change', title: 'بدي أغيّر الموعد' }];
}

const LINES = {
  slotTaken: { ar: 'هاد الوقت انحجز هلأ.', en: 'That time was just taken.' },
  expired: { ar: 'الخيار هاد قديم.', en: 'That option is out of date.' },
  changeLead: { ar: 'أكيد.', en: 'Sure.' },
  noSlots: {
    ar: 'ما لقيت وقت فاضي قريب عند الفريق. أي يوم ووقت بناسبك؟',
    en: "I couldn't find a free time with the team soon. Which day and time suit you?",
  },
  noBooking: {
    ar: 'ما في مكالمة محجوزة حاليًا. إذا بتحب نرتّب وحدة احكيلي.',
    en: "There's no call booked right now. If you'd like one, just tell me.",
  },
  okNoBooking: { ar: 'تمام 👍', en: 'Great 👍' },
};

function line(key, lang) {
  return isEn(lang) ? LINES[key].en : LINES[key].ar;
}

function okAck({ day, time }, lang) {
  return isEn(lang)
    ? `Great 👍 talk to you ${day} at ${time} Amman time.`
    : `تمام 👍 منحكي معك ${day} الساعة ${time} بتوقيت عمّان.`;
}

function cancelAsk({ day, time }, lang) {
  return isEn(lang)
    ? `Do you want me to cancel your call ${day} at ${time}?`
    : `أكيد بدك نلغي مكالمتك ${day} الساعة ${time}؟`;
}

// The calendar refused a change: the team gets the request, the customer keeps the current booking.
function changeRelayed({ day, time }, current, lang) {
  return isEn(lang)
    ? `I couldn't move the call right now — I've passed your request for ${day} at ${time} to the team. Your current call (${current.day} at ${current.time}) stays as it is until they confirm with you here.`
    : `ما قدرت أغيّر الموعد هلأ — وصّلت طلبك (${day} الساعة ${time}) للفريق، وموعدك الحالي (${current.day} الساعة ${current.time}) بضل زي ما هو لحد ما يأكدوا معك هون.`;
}

function cancelRelayed(lang) {
  return isEn(lang)
    ? "I couldn't cancel the call right now — I've passed your request to the team and they'll confirm with you here."
    : 'ما قدرت ألغي المكالمة هلأ — وصّلت طلب الإلغاء للفريق وبيأكدوا معك هون.';
}

function changeUnavailable(current, lang) {
  return isEn(lang)
    ? `I can't load the free times right now. Which day and time suit you? I'll pass it to the team — your current call (${current.day} at ${current.time}) stays until they confirm.`
    : `ما قدرت أجيب الأوقات الفاضية هلأ. أي يوم ووقت بناسبك؟ بوصّله للفريق، وموعدك الحالي (${current.day} الساعة ${current.time}) بضل لحد ما يأكدوا.`;
}

function reminderText(kind, parts, lang) {
  if (kind === 'h1') {
    return isEn(lang)
      ? `Reminder: your call with the SHIFT team is in an hour, at ${parts.time} Amman time. If you need to change it, tell me.`
      : `تذكير: مكالمتك مع فريق شِفت كمان ساعة، الساعة ${parts.time} بتوقيت عمّان. إذا بدك تغيّر الموعد احكيلي.`;
  }
  return isEn(lang)
    ? `Reminder: your call with the SHIFT team is ${parts.day} at ${parts.time} Amman time. If you need to change it, tell me.`
    : `تذكير: مكالمتك مع فريق شِفت ${parts.day} الساعة ${parts.time} بتوقيت عمّان. إذا بدك تغيّر الموعد احكيلي.`;
}

// ─── state helpers ───────────────────────────────────────────────────────────

function activeBooking(wd, now = new Date()) {
  const b = wd && wd.booking && typeof wd.booking === 'object' ? wd.booking : null;
  if (!b || !ACTIVE_STATUSES.includes(b.status) || !b.event_id) return null;
  return toMs(b.end) > toMs(now) ? b : null;
}

/**
 * A PR1/PR2 call REQUEST with no calendar event behind it: a time the customer gave (lead.preferred_time)
 * or a slot tap still waiting for one (capture_pending). Owner phone test 2026-09-17: such a conversation
 * sits at `captured`/`pending`, and before this it could never be turned into a real booking — «بدي أغيّر
 * الموعد» fell through to the model, which improvised a time and re-sent the old request ack.
 */
function callRequestOpen(wd) {
  if (!wd || typeof wd !== 'object') return false;
  const lead = wd.lead && typeof wd.lead === 'object' ? wd.lead : {};
  const pt = lead.preferred_time;
  const hasTime = typeof pt === 'string' ? !!pt.trim() : !!(pt && typeof pt === 'object' && Object.keys(pt).length);
  return hasTime || !!(wd.capture_pending && typeof wd.capture_pending === 'object');
}

/**
 * The `captured` stage blocks sales steps while the team's request is open (concierge), but it must not
 * block the calendar: with booking on and no event yet, the customer may still turn their old request into
 * a real booking. `handoff` and `closed` stay locked.
 */
function calendarOpenAt(business, conversation, now = new Date(), env = process.env) {
  const stage = conversation && conversation.current_state;
  if (stage !== 'captured') return false;
  if (!bookingConfig(business, env).enabled) return false;
  return !activeBooking((conversation && conversation.workflow_data) || {}, now);
}

/** An event id Google accepts (base32hex, 5–1024 chars), derived so a retry of the same booking reuses it. */
function eventIdFor(conversationId, startIso, seq = 1) {
  const digest = crypto.createHash('sha256').update(`${conversationId}|${startIso}|${seq}`).digest();
  const alphabet = '0123456789abcdefghijklmnopqrstuv';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return `sh${out}`.slice(0, EVENT_ID_LENGTH);
}

function inboxUrl() {
  return (process.env.SHIFT_INBOX_URL || '').trim() || 'https://app.shifts-ai.com/inbox';
}

const SECTOR_AR = { clinic: 'عيادة', restaurant: 'مطعم/كافيه', store: 'متجر إلكتروني', other: 'نشاط آخر' };

function cut(s, max) {
  const chars = Array.from(String(s || ''));
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}

function eventSummary(conversation, lead) {
  const who = str(lead.business_name) || str(conversation.profile_name) || str(lead.name) || '';
  return cut(`مكالمة شِفت — ${who ? `${who} ` : ''}(+${conversation.customer_wa_id})`, 200);
}

/** The lead card staff read in the calendar. Customer-typed values are cut; nothing is trusted as a link. */
function eventDescription(conversation, lead) {
  const rows = [
    ['الاسم', lead.name],
    ['المنشأة', lead.business_name],
    ['القطاع', [SECTOR_AR[lead.sector] || lead.sector, lead.sector_text].filter(Boolean).join(' — ')],
    ['الاحتياج', Array.isArray(lead.need) ? lead.need.join('، ') : lead.need],
    ['المصدر', lead.source && typeof lead.source === 'object' ? [lead.source.type, lead.source.attribution].filter(Boolean).join(' · ') : null],
    ['واتساب', `+${conversation.customer_wa_id}`],
    ['الملف الشخصي', conversation.profile_name],
  ].filter(([, v]) => str(typeof v === 'string' ? v : '') !== '');
  return [
    ...rows.map(([k, v]) => `${k}: ${cut(v, 300)}`),
    '',
    `Inbox: ${inboxUrl()}`,
    `conversation=${conversation.id}`,
  ].join('\n');
}

function eventBody({ id, start, end, tz, business, conversation, lead }) {
  return {
    id,
    summary: eventSummary(conversation, lead),
    description: eventDescription(conversation, lead),
    start: { dateTime: new Date(start).toISOString(), timeZone: tz },
    end: { dateTime: new Date(end).toISOString(), timeZone: tz },
    extendedProperties: { private: { conversationId: String(conversation.id), businessId: String(business.id) } },
    reminders: { useDefault: true },
  };
}

// ─── results ─────────────────────────────────────────────────────────────────

function baseResult(fields) {
  return {
    kind: 'button',
    action: 'BOOKING',
    messages: [],
    stateUpdate: {},
    workflowDataPatch: {},
    leadPatch: null,
    leadMeta: null,
    needsTeam: null,
    alert: null,
    ...fields,
  };
}

function text(t) {
  return { type: 'text', text: t };
}

function locked(conversation) {
  return ['handoff', 'captured'].includes(conversation?.current_state) && conversation?.status === 'pending';
}

/** last_bot for a deterministic result (the nudge planner and objectives read it). */
function withLastBot(result, { conversation, now, id = null }) {
  const stage = result.stateUpdate?.current_state ?? conversation?.current_state ?? null;
  const repaired = validators.repairNextStep(result, null, { stage, now }).result;
  if (!id) return repaired;
  return { ...repaired, workflowDataPatch: { ...repaired.workflowDataPatch, last_bot: { ...repaired.workflowDataPatch.last_bot, button_id: id } } };
}

function offersPart(body, offers) {
  return { type: 'interactive', text: body, buttons: offers.map((o) => ({ id: o.id, title: o.title })), serverButtons: true };
}

function offersPatch(offers, at) {
  return { slot_offers: offers.map((o) => ({ id: o.id, title: o.title, issued_at: at })) };
}

async function busyBetween(cfg, fromMs, toMsValue, now, { fresh = false } = {}) {
  const key = cfg.busyCalendarIds.join(',');
  const nowValue = toMs(now);
  if (!fresh && busyCache && busyCache.key === key && nowValue - busyCache.atMs >= 0 && nowValue - busyCache.atMs < BUSY_CACHE_MS
    && busyCache.fromMs <= fromMs && busyCache.toMs >= toMsValue) {
    return { ok: true, busy: busyCache.busy };
  }
  const r = await calendar.freeBusy({ timeMin: new Date(fromMs), timeMax: new Date(toMsValue), calendarIds: cfg.busyCalendarIds, now });
  if (r.ok && !fresh) busyCache = { key, fromMs, toMs: toMsValue, atMs: nowValue, busy: r.busy };
  return r;
}

/**
 * The two free slots to offer plus «وقت ثاني», or {ok:false} (unconfigured, disabled, calendar down, no free
 * slot) — the caller then keeps PR2's window offers.
 */
async function bookingOffers({ business, now = new Date(), lang = 'ar', teamHours, config, exclude = null } = {}) {
  const cfg = config || bookingConfig(business);
  if (!cfg.enabled) return { ok: false, reason: 'disabled' };
  const th = teamHours || hours.resolveTeamHours(business && business.ai_config);
  const slots = candidateSlots(th, now, cfg);
  if (!slots.length) return { ok: false, reason: 'no_slots' };
  const fb = await busyBetween(cfg, toMs(slots[0].start), toMs(slots[slots.length - 1].end), now);
  if (!fb.ok) return { ok: false, reason: 'calendar', error: fb.error };
  const busy = exclude ? [...fb.busy, exclude] : fb.busy;
  const picked = pickOffers(freeSlots(slots, busy));
  if (!picked.length) return { ok: false, reason: 'no_free_slots' };
  const offers = picked.map((s) => ({ id: bookId(s.start), title: offerTitle(s.start, now, th.tz, lang) }));
  offers.push({ id: 'slot:other', title: otherTitle(lang) });
  return { ok: true, offers };
}

/** bookingOffers bounded by `ms`: a slow calendar answer counts as unavailable ({ok:false, reason:'timeout'}). */
async function offersWithin(ms, args) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  try {
    return await Promise.race([
      bookingOffers(args).catch((err) => ({ ok: false, reason: 'error', error: { kind: 'error', message: err && err.message } })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function tapContext(ctx = {}) {
  const business = ctx.business || { ai_config: {} };
  const conversation = ctx.conversation || { workflow_data: {} };
  const now = ctx.now instanceof Date ? ctx.now : new Date(ctx.now || Date.now());
  const wd = conversation.workflow_data || {};
  const lead = wd.lead || {};
  const lang = ctx.lang || acks.pickLanguage(lead, '');
  const teamHours = hours.resolveTeamHours(business.ai_config);
  return {
    ...ctx, business, conversation, now, wd, lead, lang, teamHours,
    at: now.toISOString(), config: ctx.config || bookingConfig(business), locked: locked(conversation),
    // Calendly mode: the personalised booking link (null in in-chat mode).
    link: ctx.link !== undefined ? ctx.link : calendly.linkFor(business, conversation, lang),
  };
}

function meetingNeeds(c, summary) {
  // Lazy: results.js requires buttons.js, which requires this module.
  const { mergeNeedsTeam, needsTeamEntry } = require('./results');
  const existing = c.wd.needs_team;
  const entry = needsTeamEntry('meeting', summary, c.at);
  const needs = mergeNeedsTeam(existing, entry);
  let needsTeamMerge = null;
  if (!needs && existing && existing.reason === 'meeting' && !existing.resolved_at && existing.summary !== entry.summary) {
    const match = { reason: 'meeting', at: existing.at };
    if ('resolved_at' in existing) match.resolved_at = null;
    if ('claimed_at' in existing) match.claimed_at = null;
    needsTeamMerge = { match, patch: { summary: entry.summary }, entry };
  }
  return { needs, entry, needsTeamMerge };
}

function preferredTimeOf(c, start, end, id) {
  return {
    text: acks.windowText({ start, end }, c.now, c.teamHours.tz, c.lang),
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    tz: c.teamHours.tz,
    slot_id: id,
  };
}

/**
 * The PR1/PR2 call request for a slot the calendar could not book (disabled, unreachable, insert refused):
 * «سجّلت طلب مكالمة … طلب مش موعد مؤكد», needs_team meeting and a staff alert. Never «ثبّتنا».
 */
function requestResult(c, { start, end, id, alertReason = 'booking_failed', why = '' }) {
  const { captureResult } = require('./results');
  const preferredTime = preferredTimeOf(c, start, end, id);
  const leadPatch = { preferred_time: preferredTime };
  const r = captureResult({ business: c.business, conversation: c.conversation, now: c.now, lang: c.lang, teamHours: c.teamHours },
    { preferredTime, leadPatch });
  const summary = `${preferredTime.text}${why ? ` — ${why}` : ''}`.slice(0, 200);
  return {
    ...r,
    kind: 'button',
    stateUpdate: c.locked ? { status: 'pending' } : r.stateUpdate,
    leadMeta: { source: 'button', msgId: c.messageId ?? null, at: c.at, inboundText: '', trusted: ['preferred_time'] },
    alert: { reason: alertReason, summary },
  };
}

function expiredResult(c, offers) {
  if (offers && offers.length) {
    return baseResult({
      messages: [offersPart(`${line('expired', c.lang)} ${acks.slotsBody(c.lang)}`, offers)],
      workflowDataPatch: offersPatch(offers, c.at),
    });
  }
  return baseResult({
    messages: [text(acks.expiredSlot(c.lang))],
    workflowDataPatch: { capture_pending: { slot_id: null, time_text: null, at: c.at } },
  });
}

function bookingHistory(prev, entry) {
  const list = prev && Array.isArray(prev.history) ? prev.history : [];
  return list.concat([entry]).slice(-HISTORY_CAP);
}

function successResult(c, { start, end, id, event, previous, seq, rescheduled, existed }) {
  const startIso = new Date(start).toISOString();
  const endIso = new Date(end).toISOString();
  const when = whenParts(start, c.now, c.teamHours.tz, c.lang);
  const status = rescheduled ? 'rescheduled' : 'booked';
  const nameKnown = !!str(c.lead.name);
  const businessKnown = !!str(c.lead.business_name);
  const ask = detailsAsk({ nameKnown, businessKnown, lang: c.lang });
  const confirmation = (isEn(c.lang) ? TEXTS[status].en : TEXTS[status].ar)(when);
  const booking = {
    event_id: event.id,
    calendar_id: previous && rescheduled ? previous.calendar_id : c.config.salesCalendarId,
    start: startIso,
    end: endIso,
    tz: c.teamHours.tz,
    status,
    booked_at: previous && rescheduled ? previous.booked_at : c.at,
    ...(rescheduled && { rescheduled_at: c.at }),
    seq,
    offer_id: id,
    source_msg_id: c.messageId ?? null,
    lang: c.lang,
    reminders: {},
    details_pending: !(nameKnown && businessKnown),
    details_missing: [!nameKnown && 'name', !businessKnown && 'business_name'].filter(Boolean),
    history: bookingHistory(previous, { status, start: startIso, at: c.at, ...(existed && { existed: true }) }),
  };
  const summary = `${rescheduled ? 'تغيّر موعد المكالمة' : 'مكالمة محجوزة'}: ${acks.windowText({ start, end }, c.now, c.teamHours.tz, 'ar')}`;
  const { needs, entry, needsTeamMerge } = meetingNeeds(c, summary);
  return baseResult({
    action: rescheduled ? 'RESCHEDULE_CALL' : 'BOOK_CALL',
    messages: [{ type: 'interactive', text: ask ? `${confirmation}\n\n${ask}` : confirmation, buttons: confirmButtons(c.lang), serverButtons: true }],
    stateUpdate: { status: 'pending', ...(c.locked && c.conversation.current_state !== 'captured' ? {} : { current_state: 'captured' }) },
    workflowDataPatch: {
      booking,
      slot_offers: [],
      capture_pending: null,
      nudge: null,
      ...(needs && { needs_team: needs }),
    },
    leadPatch: { preferred_time: preferredTimeOf(c, start, end, id) },
    // _prov.preferred_time.source = 'booking' (design §Flow 2): the calendar holds this time.
    leadMeta: { source: 'booking', msgId: c.messageId ?? null, at: c.at, inboundText: '', trusted: ['preferred_time'] },
    needsTeam: needs,
    needsTeamCandidate: entry,
    needsTeamMerge,
    alert: {
      reason: rescheduled ? 'booking_rescheduled' : 'booking_booked',
      summary: `${summary}${previous && rescheduled ? ` (كان ${acks.windowText({ start: previous.start, end: previous.end }, c.now, c.teamHours.tz, 'ar')})` : ''}`,
    },
  });
}

function reconfirmResult(c, current) {
  const when = whenParts(current.start, c.now, c.teamHours.tz, c.lang);
  const confirmation = (isEn(c.lang) ? TEXTS[current.status].en : TEXTS[current.status].ar)(when);
  const ask = detailsAsk({ nameKnown: !!str(c.lead.name), businessKnown: !!str(c.lead.business_name), lang: c.lang });
  return baseResult({
    action: current.status === 'rescheduled' ? 'RESCHEDULE_CALL' : 'BOOK_CALL',
    messages: [{ type: 'interactive', text: ask ? `${confirmation}\n\n${ask}` : confirmation, buttons: confirmButtons(c.lang), serverButtons: true }],
  });
}

/** The event already on the calendar at this start (a retry whose persist failed), or null. */
async function ownEventAt(c, eventIds, start) {
  for (const eventId of eventIds.filter(Boolean)) {
    const calId = c.wd.booking && c.wd.booking.event_id === eventId ? c.wd.booking.calendar_id : c.config.salesCalendarId;
    const got = await calendar.getEvent(calId, eventId, { now: c.now });
    const ev = got.ok ? got.event : null;
    if (ev && ev.status !== 'cancelled' && ev.start && toMs(ev.start.dateTime) === toMs(start)) return ev;
  }
  return null;
}

async function slotTakenResult(c, start, end) {
  const fresh = await bookingOffers({ business: c.business, now: c.now, lang: c.lang, teamHours: c.teamHours, config: c.config, exclude: { start, end } });
  if (fresh.ok) {
    return baseResult({
      messages: [offersPart(`${line('slotTaken', c.lang)} ${acks.slotsBody(c.lang)}`, fresh.offers)],
      workflowDataPatch: offersPatch(fresh.offers, c.at),
    });
  }
  return baseResult({
    messages: [text(`${line('slotTaken', c.lang)} ${acks.slotOther(c.lang)}`)],
    workflowDataPatch: { capture_pending: { slot_id: 'other', time_text: null, at: c.at }, slot_offers: [] },
  });
}

async function bookTap(id, c) {
  // An old slot button tapped over a Calendly booking: that booking is changed in Calendly, never here.
  const onFile = activeBooking(c.wd, c.now);
  if (isCalendlyBooking(onFile)) return calendlyChange(c, onFile);
  const start = parseBookId(id);
  const cfg = c.config;
  const end = new Date(start.getTime() + cfg.slotMinutes * 60000);
  const nowMs = c.now.getTime();
  const offer = Array.isArray(c.wd.slot_offers) ? c.wd.slot_offers.find((o) => o && o.id === id) : null;
  const issuedMs = offer && offer.issued_at ? toMs(offer.issued_at) : NaN;
  const stale = (offer && nowMs - issuedMs > OFFER_TTL_MS) || start.getTime() - nowMs < (offer ? TAP_OFFER_LEAD_MS : TAP_MIN_LEAD_MS)
    || !isGridSlot(c.teamHours, start, cfg.slotMinutes);

  if (!cfg.enabled) {
    // Booking was switched off after these buttons went out: the tap is a call request, as in PR2.
    if (end.getTime() <= nowMs) return expiredResult(c, null);
    return requestResult(c, { start, end, id, alertReason: 'meeting', why: 'الحجز بالتقويم موقف (SHIFT_BOOKING)' });
  }
  if (stale) {
    const fresh = await bookingOffers({ business: c.business, now: c.now, lang: c.lang, teamHours: c.teamHours, config: cfg });
    return expiredResult(c, fresh.ok ? fresh.offers : null);
  }

  const current = activeBooking(c.wd, c.now);
  if (current && toMs(current.start) === start.getTime()) {
    // The same tap again (its confirmation was not delivered and the row came back): the same confirmation,
    // no second calendar write. Any other tap on the booked time gets the short ack.
    if (current.source_msg_id && current.source_msg_id === c.messageId) return reconfirmResult(c, current);
    return baseResult({ messages: [text(okAck(whenParts(start, c.now, c.teamHours.tz, c.lang), c.lang))] });
  }
  const seq = current ? Number(current.seq) || 1 : (Number(c.wd.booking && c.wd.booking.seq) || 0) + 1;
  const newId = eventIdFor(c.conversation.id, start.toISOString(), seq);

  // Re-check this one slot, never from the cache: someone may have taken it since the offer.
  const fb = await calendar.freeBusy({ timeMin: start, timeMax: end, calendarIds: cfg.busyCalendarIds, now: c.now });
  if (!fb.ok) {
    if (current) return relayChange(c, current, { start, end, id, why: `calendar ${fb.error.kind}` });
    return requestResult(c, { start, end, id, why: `التقويم ما رد (${fb.error.kind})` });
  }
  if (overlaps({ start, end }, fb.busy)) {
    const own = await ownEventAt(c, [current && current.event_id, newId,
      current && eventIdFor(c.conversation.id, start.toISOString(), seq + 1)], start);
    if (!own) return slotTakenResult(c, start, end);
    resetBusyCache();
    return successResult(c, { start, end, id, event: own, previous: current, seq, rescheduled: !!current, existed: true });
  }

  if (current) {
    const patched = await calendar.patchEvent(current.calendar_id, current.event_id, {
      start: { dateTime: start.toISOString(), timeZone: c.teamHours.tz },
      end: { dateTime: end.toISOString(), timeZone: c.teamHours.tz },
    }, { now: c.now });
    if (patched.ok) {
      resetBusyCache();
      return successResult(c, { start, end, id, event: patched.event || { id: current.event_id }, previous: current, seq, rescheduled: true });
    }
    if (patched.error.kind !== 'notFound') return relayChange(c, current, { start, end, id, why: `patch ${patched.error.kind}` });
    // Staff deleted the event in the calendar: book the new time as a fresh event.
  }

  const insertSeq = current ? seq + 1 : seq;
  const eventId = current ? eventIdFor(c.conversation.id, start.toISOString(), insertSeq) : newId;
  const inserted = await calendar.insertEvent(cfg.salesCalendarId, eventBody({
    id: eventId, start, end, tz: c.teamHours.tz, business: c.business, conversation: c.conversation, lead: c.lead,
  }), { now: c.now });
  if (!inserted.ok) {
    if (current) return relayChange(c, current, { start, end, id, why: `insert ${inserted.error.kind}` });
    return requestResult(c, { start, end, id, why: `التقويم رفض الحجز (${inserted.error.kind})` });
  }
  resetBusyCache();
  return successResult(c, {
    start, end, id, event: inserted.event && inserted.event.id ? inserted.event : { id: eventId },
    previous: current, seq: insertSeq, rescheduled: !!current, existed: inserted.existed,
  });
}

/** A change the calendar did not take: the team gets it; the booking and its reminders stay as they are. */
function relayChange(c, current, { start, end, why }) {
  const requested = whenParts(start, c.now, c.teamHours.tz, c.lang);
  const was = whenParts(current.start, c.now, c.teamHours.tz, c.lang);
  const summary = `طلب تغيير المكالمة إلى ${acks.windowText({ start, end }, c.now, c.teamHours.tz, 'ar')} — ${why}`.slice(0, 200);
  const { needs, entry, needsTeamMerge } = meetingNeeds(c, summary);
  return baseResult({
    messages: [text(changeRelayed(requested, was, c.lang))],
    stateUpdate: { status: 'pending' },
    workflowDataPatch: {
      booking: { ...current, change_requested: { start: new Date(start).toISOString(), at: c.at, why } },
      slot_offers: [],
      ...(needs && { needs_team: needs }),
    },
    needsTeam: needs,
    needsTeamCandidate: entry,
    needsTeamMerge,
    alert: { reason: 'booking_change_request', summary },
  });
}

// ─── Calendly (owner decision 2026-09-19) ───────────────────────────────────

const STAFF_TASKS_CAP = 20;

function isCalendlyBooking(b) {
  return !!(b && b.source === 'calendly');
}

function withStaffTask(c, kind, summary) {
  const list = Array.isArray(c.wd.staff_tasks) ? c.wd.staff_tasks : [];
  return list.concat([{ kind, summary: String(summary).slice(0, 200), due_at: c.at, at: c.at, done_at: null }]).slice(-STAFF_TASKS_CAP);
}

function linkResult(c, { kind = 'book', line = '', body, action = 'BOOKING_LINK', url, fields = {} } = {}) {
  const part = calendly.linkPart({ url: url || (c.link && c.link.url), lang: c.lang, kind, line, body });
  return baseResult({ action, messages: [part], ...fields, workflowDataPatch: { slot_offers: [], ...(fields.workflowDataPatch || {}) } });
}

/**
 * «بدي أغيّر الموعد» / [غيّر الموعد] with Calendly: a Calendly booking gets its own reschedule link. Without that
 * link (or for a booking the bot made in the calendar itself) the main link goes out and the team gets a task
 * to cancel the old one. Nothing is said to have changed: only the sweep, seeing the new event, confirms.
 */
function calendlyChange(c, current) {
  if (isCalendlyBooking(current) && current.reschedule_url) {
    return linkResult(c, { kind: 'reschedule', url: current.reschedule_url, action: 'BOOKING_CHANGE' });
  }
  // In-chat mode never moves a Calendly booking in the calendar itself: the main link still applies.
  const link = c.link || (isCalendlyBooking(current) ? calendly.linkFor(c.business, c.conversation, c.lang, { force: true }) : null);
  if (!link) {
    if (!isCalendlyBooking(current)) return null;
    const whenAr = acks.windowText({ start: current.start, end: current.end }, c.now, current.tz || c.teamHours.tz, 'ar');
    const summary = `العميل بدو يغيّر موعد مكالمة Calendly (${whenAr}) — ما في رابط: غيّروه من Calendly`;
    return baseResult({
      action: 'BOOKING_CHANGE',
      messages: [text(calendly.statusLine('changeRelay', c.lang))],
      stateUpdate: { status: 'pending' },
      workflowDataPatch: {
        booking: { ...current, change_requested: { start: null, at: c.at, why: 'calendly_no_link' } },
        staff_tasks: withStaffTask(c, 'change_calendly', summary),
      },
      alert: { reason: 'booking_change_request', summary: summary.slice(0, 200) },
    });
  }
  if (!current) return linkResult(c, { kind: 'book', line: line('changeLead', c.lang) });
  const whenAr = acks.windowText({ start: current.start, end: current.end }, c.now, current.tz || c.teamHours.tz, 'ar');
  const summary = `العميل بدو يغيّر موعد المكالمة (${whenAr}) — انبعتله رابط Calendly؛ ألغوا الموعد القديم لما يحجز الجديد`;
  return linkResult(c, {
    url: link.url,
    kind: 'book',
    body: calendly.statusLine('changeNoUrl', c.lang),
    action: 'BOOKING_CHANGE',
    fields: {
      workflowDataPatch: {
        booking: { ...current, change_requested: { start: null, at: c.at, why: 'calendly_link' } },
        staff_tasks: withStaffTask(c, 'cancel_old_booking', summary),
      },
      alert: { reason: 'booking_change_request', summary: summary.slice(0, 200) },
    },
  });
}

/** Cancel with Calendly: the booking's own cancel link; without one, the team cancels it (never «لغيت»). */
function calendlyCancel(c, current) {
  if (current.cancel_url) return linkResult(c, { kind: 'cancel', url: current.cancel_url, action: 'BOOKING_CANCEL_LINK' });
  const whenAr = acks.windowText({ start: current.start, end: current.end }, c.now, current.tz || c.teamHours.tz, 'ar');
  const summary = `طلب إلغاء مكالمة Calendly (${whenAr}) — ما في رابط إلغاء بالحدث: ألغوها من Calendly`;
  const { needs, entry, needsTeamMerge } = meetingNeeds(c, summary);
  return baseResult({
    action: 'CANCEL_CALL',
    messages: [text(calendly.statusLine('cancelNoUrl', c.lang))],
    stateUpdate: { status: 'pending' },
    workflowDataPatch: {
      booking: { ...current, cancel_requested_at: c.at },
      staff_tasks: withStaffTask(c, 'cancel_calendly', summary),
      ...(needs && { needs_team: needs }),
    },
    needsTeam: needs,
    needsTeamCandidate: entry,
    needsTeamMerge,
    alert: { reason: 'booking_change_request', summary: summary.slice(0, 200) },
  });
}

/** Only the link has gone out (Calendly mode): nothing is booked. */
function linkPending(wd, now) {
  const l = wd && wd.booking_link;
  return !!(l && l.sent_at) && !activeBooking(wd, now);
}

async function changeTap(c) {
  const current = activeBooking(c.wd, c.now);
  if (c.link || isCalendlyBooking(current)) {
    const r = calendlyChange(c, current);
    if (r) return r;
  }
  const fresh = await bookingOffers({ business: c.business, now: c.now, lang: c.lang, teamHours: c.teamHours, config: c.config });
  if (fresh.ok) {
    return baseResult({
      action: 'BOOKING_CHANGE',
      messages: [offersPart(`${line('changeLead', c.lang)} ${acks.slotsBody(c.lang)}`, fresh.offers)],
      workflowDataPatch: offersPatch(fresh.offers, c.at),
    });
  }
  if (!current) {
    return baseResult({
      messages: [text(fresh.reason === 'no_free_slots' ? line('noSlots', c.lang) : acks.slotOther(c.lang))],
      workflowDataPatch: { capture_pending: { slot_id: 'other', time_text: null, at: c.at } },
    });
  }
  const was = whenParts(current.start, c.now, c.teamHours.tz, c.lang);
  const summary = `العميل بدو يغيّر موعد المكالمة (${acks.windowText({ start: current.start, end: current.end }, c.now, c.teamHours.tz, 'ar')}) — الأوقات ما انجابت: ${fresh.reason}`;
  return baseResult({
    action: 'BOOKING_CHANGE',
    messages: [text(changeUnavailable(was, c.lang))],
    workflowDataPatch: { booking: { ...current, change_requested: { start: null, at: c.at, why: fresh.reason } } },
    alert: { reason: 'booking_change_request', summary: summary.slice(0, 200) },
  });
}

async function cancelTap(c) {
  const current = activeBooking(c.wd, c.now);
  if (!current) return baseResult({ messages: [text(line('noBooking', c.lang))] });
  // A Calendly booking is cancelled in Calendly (deleting its calendar event would leave Calendly's booking on).
  if (isCalendlyBooking(current)) return calendlyCancel(c, current);
  const del = await calendar.deleteEvent(current.calendar_id, current.event_id, { now: c.now });
  const whenAr = acks.windowText({ start: current.start, end: current.end }, c.now, c.teamHours.tz, 'ar');
  if (!del.ok) {
    const summary = `طلب إلغاء المكالمة (${whenAr}) — التقويم ما رد (${del.error.kind})`;
    const { needs, entry, needsTeamMerge } = meetingNeeds(c, summary);
    return baseResult({
      action: 'CANCEL_CALL',
      messages: [text(cancelRelayed(c.lang))],
      stateUpdate: { status: 'pending' },
      workflowDataPatch: { booking: { ...current, cancel_requested_at: c.at }, ...(needs && { needs_team: needs }) },
      needsTeam: needs,
      needsTeamCandidate: entry,
      needsTeamMerge,
      alert: { reason: 'booking_change_request', summary },
    });
  }
  resetBusyCache();
  const nt = c.wd.needs_team;
  const meetingOpen = !!(nt && nt.reason === 'meeting' && !nt.resolved_at);
  const otherOpen = !!(nt && !nt.resolved_at && nt.reason !== 'meeting');
  const result = baseResult({
    action: 'CANCEL_CALL',
    messages: [text((isEn(c.lang) ? TEXTS.cancelled.en : TEXTS.cancelled.ar)())],
    // Another open request (a quote, a person) keeps the conversation on the team's list.
    stateUpdate: otherOpen ? {} : { status: 'open', ...(c.conversation.current_state === 'captured' ? { current_state: 'close' } : {}) },
    workflowDataPatch: {
      booking: {
        ...current, status: 'cancelled', cancelled_at: c.at, reminders: current.reminders || {},
        history: bookingHistory(current, { status: 'cancelled', start: current.start, at: c.at }),
      },
      slot_offers: [],
    },
    alert: { reason: 'booking_cancelled', summary: `انلغت المكالمة: ${whenAr}` },
  });
  if (meetingOpen) {
    const match = { reason: 'meeting', at: nt.at };
    if ('resolved_at' in nt) match.resolved_at = null;
    result.needsTeamMerge = { match, patch: { resolved_at: c.at, resolved_by: 'booking_cancelled' }, entry: null };
  }
  return result;
}

function okTap(c) {
  const current = activeBooking(c.wd, c.now);
  if (!current) return baseResult({ messages: [text(line('okNoBooking', c.lang))] });
  return baseResult({ messages: [text(okAck(whenParts(current.start, c.now, c.teamHours.tz, c.lang), c.lang))] });
}

/**
 * A booking tap (`book:<iso>`, book_ok, book_change, book_cancel, book_seeyou), answered under the lease.
 * Resolves to a WorkflowResult for deliverResult, or null for an id this module does not own.
 */
async function handleBookingTap(id, ctx = {}) {
  if (!isBookingId(id)) return null;
  const c = tapContext(ctx);
  let result;
  if (id === 'book_ok' || id === 'book_seeyou') result = okTap(c);
  else if (id === 'book_change') result = await changeTap(c);
  else if (id === 'book_cancel') result = await cancelTap(c);
  else result = await bookTap(id, c);
  return withLastBot(result, { conversation: c.conversation, now: c.now, id });
}

// ─── text intents while a booking exists ─────────────────────────────────────

const AR = '\\u0621-\\u064A\\u066E-\\u06D3';
const NEGATION_RE = /(?:^|\s)(?:ما|مش|لا|مو|بلاش ما|don't|do not|dont|not|no need to)\s*(?:بدي|بدنا|رح|تـ?)?\s*$/i;
const CANCEL_RE = new RegExp(`(?<![${AR}])(?:ألغي|الغي|ألغِ|الغِ|نلغي|يلغي|إلغاء|الغاء|ألغوا|الغوا|كنسل|كنسلها)(?![${AR}])|\\bcancel(?:led|ling)?\\b`, 'i');
const CHANGE_OBJECT = '(?:ال)?(?:موعد|وقت|مكالمة|ساعة|يوم)';
const CHANGE_RE = new RegExp([
  `(?<![${AR}])(?:غيّر|غير|أغيّر|أغير|اغيّر|اغير|نغيّر|نغير|تغيير|أأجل|اأجل|أجّل|أجل|اجل|نأجل|نأجّل|ناجل|تأجيل)\\s+${CHANGE_OBJECT}(?![${AR}])`,
  `(?<![${AR}])(?:وقت|موعد)\\s+(?:ثاني|تاني|غير|آخر|اخر)(?![${AR}])`,
  `(?<![${AR}])(?:مش|ما)\\s+(?:رح\\s+)?(?:أقدر|اقدر|بقدر|قادر)(?![${AR}])`,
  `(?<![${AR}])بدي\\s+(?:أغيّر|أغير|اغير|اغيّر|أأجل|اأجل)(?![${AR}])`,
  '\\b(?:reschedul\\w*|postpone\\w*)\\b',
  "\\bchange (?:the |my |our )?(?:time|call|appointment|meeting|date|it)\\b",
  "\\b(?:can'?t|cannot|won'?t|will not) make it\\b",
  '\\b(?:another|a different) time\\b',
].join('|'), 'i');

/**
 * Round-2 review #12: «شً عل موعدنا» was answered with «العفو أستاذ معتصم، وأهلاً وسهلاً بك بأي وقت 👋».
 * A question about the appointment is a lookup, not small talk: it is answered from the record.
 */
/**
 * «بدي احجز» / «وين الرابط» while something is already on file. 2026-09-20, live: a customer with a booked
 * call asked to book again; shouldOfferCalendar withholds book_link once a booking exists, so the model was
 * asked to offer a link it had no button for and answered «رابط الحجز بيوصلك من الفريق مباشرة» — a process
 * that does not exist. The record answers this, not the model: booked → the booking and its buttons, link
 * sent but not used → the link again.
 */
const BOOK_RE = new RegExp([
  `(?<![${AR}])(?:بدي|بدنا|بحب|حاب|ممكن|بقدر)\\s*(?:أحجز|احجز|نحجز|أحجزلي|احجزلي)(?![${AR}])`,
  `(?<![${AR}])(?:أحجز|احجز|حجز)(?:لي|لنا|لك)?\\s*(?:موعد|مكالمة|وقت)(?![${AR}])`,
  `(?<![${AR}])(?:وين|فين|أين|ابعتلي|ابعثلي|بعتلي|أرسل|ارسل|عطيني|أعطيني)\\s*(?:لي)?\\s*(?:ال)?رابط(?![${AR}])`,
  `(?<![${AR}])(?:ال)?رابط\\s*(?:ال)?(?:حجز|موعد)(?![${AR}])`,
  '\\b(?:book|booking)\\b',
  "\\b(?:where(?:'s| is)?|send me|give me) (?:the )?link\\b",
].join('|'), 'i');

const STATUS_RE = new RegExp([
  `(?<![${AR}])(?:شو|إيش|ايش|وين|كيف|متى|إمتى|امتى|شً)\\s*(?:صار|وصل|عن|على|عل|مع|أخبار|اخبار|في)?\\s*(?:ال|ب|بال|ل|لل|عن|في)?\\s*(?:موعد|موعدنا|موعدي|مكالمة|المكالمة|مكالمتنا|مكالمتي|الحجز|حجزي)(?![${AR}])`,
  `(?<![${AR}])(?:ال)?(?:موعد|موعدنا|موعدي|مكالمة|المكالمة|مكالمتنا|مكالمتي|الحجز|حجزي)\\s*(?:هو|كان|صار)?\\s*(?:متى|إمتى|امتى|امته|كم|وين)(?![${AR}])`,
  `(?<![${AR}])(?:أكدلي|اكدلي|ذكّرني|ذكرني|فكرني)\\s*(?:ب)?(?:ال)?(?:موعد|المكالمة|الحجز)(?![${AR}])`,
  '\\bwhen (?:is|was) (?:my|our|the) (?:call|appointment|meeting|booking)\\b',
  '\\bwhat(?:\'s| is| about) (?:my|our|the) (?:call|appointment|meeting|booking)\\b',
  '\\bany update on (?:my|our|the) (?:call|appointment|meeting|booking|request)\\b',
  '\\b(?:confirm|remind me of) (?:my|our|the) (?:call|appointment|booking)\\b',
].join('|'), 'i');

function negatedAt(s, index) {
  return NEGATION_RE.test(s.slice(Math.max(0, index - 12), index));
}

/**
 * 'cancel' | 'change' | null for the customer's text while a booking — or a call request with no event
 * yet — exists. Short messages only: a long message that happens to contain «ألغي» goes to the model,
 * which answers as a concierge. `requestOpen: false` (handoff, closed) keeps a request out of this path.
 */
function textIntent(texts, wd, now = new Date(), { requestOpen = true, linkOpen = false } = {}) {
  const onFile = !!activeBooking(wd, now) || (requestOpen && callRequestOpen(wd));
  // Calendly mode: a status question is answered from the record even with nothing on file (the link goes
  // out again), and a change after the link was sent gets the link again — never the model's own times.
  if (!onFile && !linkOpen) return null;
  const s = (Array.isArray(texts) ? texts : [texts]).filter((t) => typeof t === 'string').join('\n').trim();
  if (!s || s.split(/\s+/).length > INTENT_MAX_WORDS) return null;
  if (!onFile) {
    if (STATUS_RE.test(s)) return 'status';
    const change = CHANGE_RE.exec(s);
    if (linkPending(wd, now) && change && !negatedAt(s, change.index)) return 'change';
    // The link went out and was not used yet: asking for it again gets the same link, never a new promise.
    if (linkPending(wd, now) && BOOK_RE.test(s)) return 'change';
    return null;
  }
  const cancel = CANCEL_RE.exec(s);
  if (cancel && !negatedAt(s, cancel.index)) return 'cancel';
  const change = CHANGE_RE.exec(s);
  if (change && !negatedAt(s, change.index)) return 'change';
  if (STATUS_RE.test(s)) return 'status';
  // Booking again what is already booked: the record says what they have, with change and cancel beside it.
  // Only a booking with an event on the calendar — a call REQUEST with no event yet is still booked the
  // normal way (slots in-chat, the link in Calendly mode), so it stays with the model.
  if (activeBooking(wd, now) && BOOK_RE.test(s)) return 'status';
  return null;
}

const STATUS_TEXTS = {
  booked: {
    ar: ({ day, time }) => `مكالمتك مع فريق شِفت محجوزة: ${day} الساعة ${time} بتوقيت عمّان. رح نذكّرك قبلها.`,
    en: ({ day, time }) => `Your call with the SHIFT team is booked for ${day} at ${time} Amman time. We'll remind you before it.`,
  },
  request: {
    ar: (when) => `طلب مكالمتك عند الفريق${when ? `: ${when} بتوقيت عمّان` : ''} — طلب، مش موعد مؤكد لسه. بتحب أعرضلك أقرب أوقات الفريق لنثبّته؟`,
    en: (when) => `Your call request is with the team${when ? `: ${when} Amman time` : ''} — a request, not a confirmed booking yet. Would you like the team's nearest times so we can fix it?`,
  },
  none: {
    ar: 'ما في موعد ولا طلب مكالمة مسجّل حاليًا. بتحب نرتّب وحدة؟',
    en: "There's no appointment or call request on file right now. Would you like to arrange one?",
  },
};

/**
 * «شو عن موعدنا؟» answered from state (#12): the absolute day and Amman time of a REAL booking, or the
 * stored request said plainly to be a request. Never the model's memory of an old chat line (#11).
 */
function statusResult(ctx) {
  const c = tapContext(ctx);
  const current = activeBooking(c.wd, c.now);
  if (!current && c.link) return withLastBot({ ...calendlyStatus(c), kind: 'reply' }, { conversation: c.conversation, now: c.now });
  if (current) {
    const when = whenParts(current.start, c.now, current.tz || c.teamHours.tz, c.lang);
    return withLastBot(baseResult({
      kind: 'reply',
      action: 'BOOKING_STATUS',
      messages: [{ type: 'interactive', text: STATUS_TEXTS.booked[isEn(c.lang) ? 'en' : 'ar'](when), buttons: confirmButtons(c.lang), serverButtons: true }],
    }), { conversation: c.conversation, now: c.now });
  }
  if (callRequestOpen(c.wd)) {
    // The stored request's own absolute time when it has one; its free text is never replayed as a date.
    const pt = c.lead.preferred_time;
    const start = pt && typeof pt === 'object' ? pt.start : null;
    const when = start ? (({ day, time }) => `${day} الساعة ${time}`)(whenParts(start, c.now, c.teamHours.tz, c.lang)) : '';
    const enWhen = start ? (({ day, time }) => `${day} at ${time}`)(whenParts(start, c.now, c.teamHours.tz, c.lang)) : '';
    return withLastBot(baseResult({
      kind: 'reply',
      action: 'BOOKING_STATUS',
      messages: [{ type: 'text', text: STATUS_TEXTS.request[isEn(c.lang) ? 'en' : 'ar'](isEn(c.lang) ? enWhen : when) }],
    }), { conversation: c.conversation, now: c.now });
  }
  return withLastBot(baseResult({
    kind: 'reply',
    action: 'BOOKING_STATUS',
    messages: [{ type: 'text', text: isEn(c.lang) ? STATUS_TEXTS.none.en : STATUS_TEXTS.none.ar }],
  }), { conversation: c.conversation, now: c.now });
}

/**
 * Nothing booked, Calendly mode: say what is on file — a request, a link already sent, or nothing — and send
 * the link (again). The link is never described as a booking.
 */
function calendlyStatus(c) {
  let lead;
  if (callRequestOpen(c.wd)) {
    const pt = c.lead.preferred_time;
    const start = pt && typeof pt === 'object' ? pt.start : null;
    const w = start ? whenParts(start, c.now, c.teamHours.tz, c.lang) : null;
    lead = calendly.statusLine('request', c.lang, w ? (isEn(c.lang) ? `${w.day} at ${w.time}` : `${w.day} الساعة ${w.time}`) : '');
  } else if (linkPending(c.wd, c.now)) {
    lead = calendly.statusLine('linkOnly', c.lang);
  } else {
    lead = calendly.statusLine('none', c.lang);
  }
  return linkResult(c, { kind: 'book', line: lead, action: 'BOOKING_STATUS' });
}

/**
 * «بدي ألغي» with only a call request on file (no calendar event): the request is stopped, honestly and
 * without pretending a booking existed, and the team's meeting entry is resolved so nobody chases it.
 */
function cancelRequestResult(c) {
  const lead = c.lead || {};
  const pt = lead.preferred_time;
  const when = typeof pt === 'string' ? pt : (pt && typeof pt === 'object' && pt.text) || '';
  const nt = c.wd.needs_team;
  const meetingOpen = !!(nt && nt.reason === 'meeting' && !nt.resolved_at);
  const otherOpen = !!(nt && !nt.resolved_at && nt.reason !== 'meeting');
  const result = baseResult({
    kind: 'reply',
    action: 'CANCEL_CALL',
    messages: [text(isEn(c.lang)
      ? "OK, I've stopped the call request. If you'd like to arrange another time, just tell me."
      : 'تمام، أوقفت طلب المكالمة. إذا حبيت نرتّب وقت ثاني احكيلي.')],
    // Another open request (a quote, a person) keeps the conversation on the team's list.
    stateUpdate: otherOpen ? {} : { status: 'open', ...(c.conversation.current_state === 'captured' ? { current_state: 'close' } : {}) },
    workflowDataPatch: {
      capture_pending: null, slot_offers: [], nudge: null, call_request_cancelled_at: c.at,
    },
    alert: { reason: 'call_request_cancelled', summary: `انلغى طلب المكالمة${when ? `: ${when}` : ''}`.slice(0, 200) },
  });
  if (meetingOpen) {
    const match = { reason: 'meeting', at: nt.at };
    if ('resolved_at' in nt) match.resolved_at = null;
    result.needsTeamMerge = { match, patch: { resolved_at: c.at, resolved_by: 'request_cancelled' }, entry: null };
  }
  return result;
}

/** «بدي ألغي» → a confirmation with [ألغِ المكالمة][خليها]: a typed word never deletes a booking by itself. */
function cancelAskResult(ctx) {
  const c = tapContext(ctx);
  const current = activeBooking(c.wd, c.now);
  if (!current && callRequestOpen(c.wd)) {
    return withLastBot(cancelRequestResult(c), { conversation: c.conversation, now: c.now });
  }
  if (current && isCalendlyBooking(current)) {
    const cr = calendlyCancel(c, current);
    return withLastBot({ ...cr, kind: 'reply', workflowDataPatch: { ...cr.workflowDataPatch, nudge: null } }, { conversation: c.conversation, now: c.now });
  }
  const r = current
    ? baseResult({
      kind: 'reply',
      action: 'BOOKING_CANCEL_ASK',
      messages: [{ type: 'interactive', text: cancelAsk(whenParts(current.start, c.now, c.teamHours.tz, c.lang), c.lang), buttons: cancelAskButtons(c.lang), serverButtons: true }],
      workflowDataPatch: { nudge: null },
    })
    : baseResult({ kind: 'reply', messages: [text(line('noBooking', c.lang))] });
  return withLastBot(r, { conversation: c.conversation, now: c.now });
}

async function changeTextResult(ctx) {
  const c = tapContext(ctx);
  const r = await changeTap(c);
  return withLastBot({ ...r, kind: 'reply', workflowDataPatch: { ...r.workflowDataPatch, nudge: null } }, { conversation: c.conversation, now: c.now });
}

/** A template quick reply (`type: 'button'`) → the booking control id it stands for, or null. */
function templateReplyId(message) {
  if (!message || message.message_type !== 'button') return null;
  const raw = message.raw_payload && message.raw_payload.button ? message.raw_payload.button : {};
  const payload = str(raw.payload);
  if (payload === 'book_change' || payload === 'book_seeyou') return payload;
  const norm = (v) => str(v).toLowerCase().replace(/[.!؟?]+$/, '').replace(/\s+/g, ' ');
  const t = norm(raw.text || message.text_body);
  if (!t) return null;
  for (const [id, variants] of Object.entries(TEMPLATE_REPLIES)) {
    if (variants.some((v) => norm(v) === t)) return id;
  }
  return null;
}

// ─── reminders ───────────────────────────────────────────────────────────────

const D1_MS = 24 * 60 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;

function madeAtMs(b) {
  return toMs(b.rescheduled_at || b.booked_at);
}

/**
 * What the sweeper owes this booking now: {due: 'd1'|'h1'|null, late: ['d1']?}. d1 only for a booking made more
 * than 24 h before the call; a d1 the sweeper could not send before the last hour is skipped as late (the h1
 * reminder covers it). Cancelled, past and already-settled reminders owe nothing.
 */
function reminderDue(b, now = new Date()) {
  const out = { due: null, late: [] };
  if (!b || !ACTIVE_STATUSES.includes(b.status)) return out;
  const nowMs = toMs(now);
  const startMs = toMs(b.start);
  if (!Number.isFinite(startMs) || nowMs >= startMs) return out;
  const reminders = b.reminders && typeof b.reminders === 'object' ? b.reminders : {};
  const made = madeAtMs(b);
  const d1Eligible = Number.isFinite(made) && made <= startMs - D1_MS;
  if (d1Eligible && !reminders.d1) {
    if (nowMs >= startMs - H1_MS) out.late.push('d1');
    else if (nowMs >= startMs - D1_MS) out.due = 'd1';
  }
  if (!out.due && !reminders.h1 && nowMs >= startMs - H1_MS && Number.isFinite(made) && made < startMs - H1_MS) out.due = 'h1';
  return out;
}

function reminderLang(wd, b) {
  const l = wd && wd.lead && wd.lead.language;
  if (l === 'en' || l === 'ar') return l;
  return b && b.lang === 'en' ? 'en' : 'ar';
}

/** Free-form reminder inside the 24 h window (with the same two choices as the template). */
function reminderPart(kind, b, now, lang) {
  const parts = whenParts(b.start, now, b.tz, lang);
  return { type: 'interactive', text: reminderText(kind, parts, lang), buttons: reminderButtons(lang), serverButtons: true };
}

/** The approved-template reminder outside the window: body params [dayText, timeText], two quick replies. */
function templatePart(kind, b, now, lang) {
  const parts = whenParts(b.start, now, b.tz, lang);
  const dayText = kind === 'h1' ? (isEn(lang) ? 'today' : 'اليوم') : parts.day;
  return {
    type: 'template',
    name: TEMPLATE_NAME,
    language: isEn(lang) ? 'en' : 'ar',
    bodyParams: [dayText, parts.time],
    quickReplyPayloads: ['book_seeyou', 'book_change'],
    text: reminderText(kind, parts, lang),
  };
}

// ─── the model's view ────────────────────────────────────────────────────────

/** One system line for the user turn while a booking exists (design §7). */
function contextLine(wd, now = new Date(), { linkMode = false } = {}) {
  const b = wd && wd.booking && typeof wd.booking === 'object' ? wd.booking : null;
  if (linkMode && linkPending(wd, now) && !(b && b.start && activeBooking(wd, now))) {
    return 'الحجز: انبعتله رابط الحجز بس لسه ما حجز — ما في موعد. لا تقل إنه محجوز ولا تذكر أوقاتًا؛ إذا طلب مكالمة قل «ببعتلك رابط الحجز» والنظام يبعته.';
  }
  if (!b || !b.start) return null;
  const when = whenParts(b.start, now, b.tz, 'ar');
  const state = activeBooking(wd, now) ? b.status : (b.status === 'cancelled' ? 'cancelled' : 'past');
  if (linkMode || isCalendlyBooking(b)) {
    return `الحجز: مكالمة ${when.day} الساعة ${when.time} (${state}). الحجز والتغيير والإلغاء بيصيروا برابط الحجز اللي يبعته النظام فقط — لا تؤكد ولا تغيّر ولا تلغي موعدًا بنفسك ولا تقل «ثبّتنا» أو «موعدك مؤكد»؛ إذا طلب تغيير أو إلغاء قل إنه بيقدر يضغط «غيّر الموعد» أو «ألغِ المكالمة».`;
  }
  return `الحجز: مكالمة ${when.day} الساعة ${when.time} (${state}). الحجز والتغيير والإلغاء يعملها النظام بالأزرار فقط — لا تؤكد ولا تغيّر ولا تلغي موعدًا بنفسك ولا تقل «ثبّتنا» أو «موعدك مؤكد»؛ إذا طلب تغيير أو إلغاء قل إنه يقدر يضغط «غيّر الموعد» أو «ألغِ المكالمة».`;
}

/** Every static button title this module can send (boot-time guard). */
function staticButtons() {
  const out = [];
  for (const lang of ['ar', 'en']) {
    out.push(...confirmButtons(lang), ...cancelAskButtons(lang), ...reminderButtons(lang), { id: 'slot:other', title: otherTitle(lang) });
  }
  return out;
}

// ─── event details after the name arrives (design §3) ────────────────────────

/**
 * The confirmation asked for the name/business: once the lead has them, the event summary and description are
 * patched. Best effort — the booking itself is already on the calendar.
 */
async function syncEventDetails({ business, conversation, lead, now = new Date(), patchBooking }) {
  const b = activeBooking(conversation && conversation.workflow_data, now);
  // Calendly owns its event's summary and description (with the invitee's cancel / reschedule links).
  if (b && isCalendlyBooking(b)) return { ok: false, reason: 'not_needed' };
  const missing = b && Array.isArray(b.details_missing) ? b.details_missing : ['name', 'business_name'];
  // Only a field the event did not have yet is worth a calendar write.
  const gained = missing.filter((field) => lead && str(lead[field]));
  if (!b || !b.details_pending || !gained.length) return { ok: false, reason: 'not_needed' };
  const r = await calendar.patchEvent(b.calendar_id, b.event_id, {
    summary: eventSummary(conversation, lead),
    description: eventDescription(conversation, lead),
  }, { now });
  if (!r.ok) return { ok: false, reason: r.error.kind };
  const stillMissing = missing.filter((field) => !str(lead[field]));
  const complete = stillMissing.length === 0;
  if (typeof patchBooking === 'function') {
    await patchBooking({ details_pending: !complete, details_missing: stillMissing, details_synced_at: new Date(now).toISOString() },
      { event_id: b.event_id, start: b.start });
  }
  void business;
  return { ok: true, complete };
}

module.exports = {
  DEFAULT_SLOT_MINUTES,
  DEFAULT_MIN_LEAD_MINUTES,
  DEFAULT_HORIZON_DAYS,
  OFFER_TTL_MS,
  TEMPLATE_NAME,
  DETAILS_TASK,
  BOOK_ID_RE,
  CONTROL_IDS,
  bookingConfig,
  resetBusyCache,
  candidateSlots,
  freeSlots,
  pickOffers,
  isGridSlot,
  offerTitle,
  whenParts,
  bookId,
  parseBookId,
  isBookingId,
  eventIdFor,
  eventBody,
  bookingOffers,
  offersWithin,
  handleBookingTap,
  textIntent,
  cancelAskResult,
  changeTextResult,
  statusResult,
  templateReplyId,
  activeBooking,
  callRequestOpen,
  calendarOpenAt,
  reminderDue,
  reminderLang,
  reminderPart,
  templatePart,
  reminderText,
  contextLine,
  staticButtons,
  confirmButtons,
  syncEventDetails,
  linkPending,
  isCalendlyBooking,
  TEXTS,
};
