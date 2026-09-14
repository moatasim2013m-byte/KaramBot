/**
 * SHIFT team hours (decision D8) and the date helpers every ack and slot button relies on.
 *
 * Everything is computed in the team's time zone with Intl, never with the server's local time:
 * Cloud Run runs in UTC while the customer and the team read Amman time.
 */

const DEFAULT_TEAM_HOURS = { days: [0, 1, 2, 3, 4], from: '09:00', to: '18:00', tz: 'Asia/Amman', closures: [] };
const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 24 * 60 * 60 * 1000;

const formatters = new Map();
function formatterFor(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      timeZoneName: 'longOffset',
    }));
  }
  return formatters.get(tz);
}

function isValidTz(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    formatterFor(tz);
    return true;
  } catch (_) {
    return false;
  }
}

function hmToMinutes(hm) {
  const m = HM_RE.exec(hm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Per-key fallback: a half-filled or mistyped ai_config.team_hours still yields usable hours. */
function resolveTeamHours(aiConfig) {
  const raw = aiConfig && typeof aiConfig.team_hours === 'object' && aiConfig.team_hours ? aiConfig.team_hours : {};
  const days = Array.isArray(raw.days)
    ? Array.from(new Set(raw.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a, b) => a - b)
    : [];
  let from = typeof raw.from === 'string' && HM_RE.test(raw.from) ? raw.from : DEFAULT_TEAM_HOURS.from;
  let to = typeof raw.to === 'string' && HM_RE.test(raw.to) ? raw.to : DEFAULT_TEAM_HOURS.to;
  // An inverted or empty day would make every "within hours" check false; fall back as a pair.
  if (hmToMinutes(from) >= hmToMinutes(to)) {
    from = DEFAULT_TEAM_HOURS.from;
    to = DEFAULT_TEAM_HOURS.to;
  }
  return {
    days: days.length ? days : DEFAULT_TEAM_HOURS.days.slice(),
    from,
    to,
    tz: isValidTz(raw.tz) ? raw.tz : DEFAULT_TEAM_HOURS.tz,
    closures: Array.isArray(raw.closures) ? raw.closures.filter((c) => typeof c === 'string' && DATE_KEY_RE.test(c)) : [],
  };
}

function localParts(date, tz) {
  const parts = {};
  for (const p of formatterFor(tz).formatToParts(new Date(date))) parts[p.type] = p.value;
  const hh = Number(parts.hour) % 24;
  const mm = Number(parts.minute);
  const offsetMatch = /GMT([+-]\d{2}:\d{2})/.exec(parts.timeZoneName || '');
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hh,
    mm,
    minutes: hh * 60 + mm,
    weekday: SHORT_WEEKDAYS.indexOf(parts.weekday),
    offset: offsetMatch ? offsetMatch[1] : '+00:00',
  };
}

function offsetToMs(offset) {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000;
}

function splitDateKey(dateKey) {
  const [y, mo, d] = dateKey.split('-').map(Number);
  return { y, mo, d };
}

/** The instant at which the wall clock in `tz` reads `dateKey hm`. */
function zonedDate(dateKey, hm, tz) {
  const { y, mo, d } = splitDateKey(dateKey);
  const [h, mi] = hm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let at = guess - offsetToMs(localParts(guess, tz).offset);
  // Re-check once so a DST edge between the guess and the result lands on the right offset.
  const corrected = guess - offsetToMs(localParts(at, tz).offset);
  if (corrected !== at) at = corrected;
  return new Date(at);
}

function addDays(dateKey, n) {
  const { y, mo, d } = splitDateKey(dateKey);
  return new Date(Date.UTC(y, mo - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOf(dateKey) {
  const { y, mo, d } = splitDateKey(dateKey);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

function isTeamDay(th, dateKey) {
  return th.days.includes(weekdayOf(dateKey)) && !(th.closures || []).includes(dateKey);
}

function isWithinTeamHours(th, now = new Date()) {
  const p = localParts(now, th.tz);
  return isTeamDay(th, p.dateKey) && p.minutes >= hmToMinutes(th.from) && p.minutes < hmToMinutes(th.to);
}

function nextOpening(th, now = new Date()) {
  const nowMs = new Date(now).getTime();
  const today = localParts(now, th.tz).dateKey;
  for (let i = 0; i <= 14; i++) {
    const dateKey = addDays(today, i);
    if (!isTeamDay(th, dateKey)) continue;
    const at = zonedDate(dateKey, th.from, th.tz);
    if (at.getTime() <= nowMs) continue;
    return { at, dateKey, relation: i === 0 ? 'today' : i === 1 ? 'tomorrow' : 'later' };
  }
  return null;
}

function dayWord(dateKey, now, tz, lang = 'ar') {
  const today = localParts(now, tz).dateKey;
  if (dateKey === today) return lang === 'en' ? 'today' : 'اليوم';
  if (dateKey === addDays(today, 1)) return lang === 'en' ? 'tomorrow' : 'بكرا';
  return (lang === 'en' ? WEEKDAYS_EN : WEEKDAYS_AR)[weekdayOf(dateKey)];
}

/** 12-hour label without a leading zero; ":30" only when the minutes are not zero. */
function hourLabel(hh, mm = 0) {
  const h12 = hh % 12 || 12;
  return mm ? `${h12}:${String(mm).padStart(2, '0')}` : String(h12);
}

function hmLabel(hm, lang) {
  const [h, m] = hm.split(':').map(Number);
  const label = hourLabel(h, m);
  if (lang !== 'en') return label;
  return `${label} ${h >= 12 ? 'pm' : 'am'}`;
}

// A day list is a range when it is one contiguous run of weekdays (Saturday–Wednesday wraps too).
function contiguousStart(days) {
  if (days.length < 2 || days.length > 7) return null;
  const set = new Set(days);
  for (const start of days) {
    let ok = true;
    for (let i = 0; i < days.length; i++) {
      if (!set.has((start + i) % 7)) { ok = false; break; }
    }
    if (ok) return start;
  }
  return null;
}

function hoursLabel(th, lang = 'ar') {
  const names = lang === 'en' ? SHORT_WEEKDAYS : WEEKDAYS_AR;
  const days = th.days;
  const start = contiguousStart(days);
  let dayText;
  if (days.length === 1) dayText = names[days[0]];
  else if (start !== null) dayText = `${names[start]}–${names[(start + days.length - 1) % 7]}`;
  else dayText = days.map((d) => names[d]).join(lang === 'en' ? ', ' : '، ');
  return `${dayText} ${hmLabel(th.from, lang)}–${hmLabel(th.to, lang)}`;
}

function formatLocal(date, tz, lang = 'ar') {
  const p = localParts(date, tz);
  const { mo, d } = splitDateKey(p.dateKey);
  const weekday = (lang === 'en' ? WEEKDAYS_EN : WEEKDAYS_AR)[p.weekday];
  return `${weekday} ${d}/${mo} ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
}

/** Minutes of team hours inside [from, to]; scans at most 7 days so a stale timestamp stays cheap. */
function teamMinutesBetween(th, from, to) {
  const startMs = new Date(from).getTime();
  const endMs = Math.min(new Date(to).getTime(), startMs + 7 * DAY_MS);
  if (!(endMs > startMs)) return 0;
  let total = 0;
  const firstKey = localParts(startMs, th.tz).dateKey;
  for (let i = 0; i <= 8; i++) {
    const dateKey = addDays(firstKey, i);
    const open = zonedDate(dateKey, th.from, th.tz).getTime();
    if (open >= endMs) break;
    if (!isTeamDay(th, dateKey)) continue;
    const close = zonedDate(dateKey, th.to, th.tz).getTime();
    const overlap = Math.min(close, endMs) - Math.max(open, startMs);
    if (overlap > 0) total += overlap;
  }
  return Math.floor(total / 60000);
}

module.exports = {
  DEFAULT_TEAM_HOURS,
  WEEKDAYS_AR,
  WEEKDAYS_EN,
  resolveTeamHours,
  localParts,
  zonedDate,
  addDays,
  isTeamDay,
  isWithinTeamHours,
  nextOpening,
  dayWord,
  hoursLabel,
  hourLabel,
  hmToMinutes,
  formatLocal,
  teamMinutesBetween,
};
