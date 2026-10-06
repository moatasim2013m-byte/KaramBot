// Timestamps for the staff WhatsApp inbox.
//
// Arabic-first and RTL, with Arabic weekday/month names and the Arabic ص/م
// meridiem — but ASCII digits. Every formatter here used to run through a bare
// `ar-JO`, whose CLDR default numbering system is `arab`, so a message sent at
// 10:28 in the morning was stamped «١٠:٢٨ ص». The owner read that as "1.28",
// asked why an hour-old message from his wife was timed to the small hours,
// and there was nothing wrong with the timestamp at all — only with the shape
// of the glyphs. Every other number the panel shows (prices, counts, the
// attendance clock) is already Latin; the inbox clock was the one holdout.
//
// Digits are requested through the `-u-nu-latn` locale extension, which is
// honoured far more widely than the ES2020 `numberingSystem` option, and the
// result is normalised anyway so a build with a stripped-down ICU still cannot
// leak Arabic-Indic digits back in.
//
// Times render in the viewer's own timezone, the way WhatsApp itself does —
// deliberately NOT pinned to Asia/Amman. Everyone reading this panel is on
// venue time; someone abroad wants their own clock, not a silent Amman one.
//
// Pure functions — no React, no DOM — so they are testable with plain node
// (frontend/__tests__/inboxTime.smoke.cjs).

// `ar-JO` keeps Arabic words and RTL punctuation ordering; `-u-nu-latn` swaps
// the digits for 0-9.
const AR_LATN = 'ar-JO-u-nu-latn';

const ARABIC_INDIC = /[٠-٩۰-۹]/g;

/**
 * Arabic-Indic (٠١٢…) and Eastern Arabic-Indic (۰۱۲…) digits → ASCII.
 * The belt to `-u-nu-latn`'s braces: an engine that ignores the extension
 * still hands back something the owner can read.
 */
export const toLatinDigits = (value) => String(value ?? '').replace(
  ARABIC_INDIC,
  (ch) => String(ch.charCodeAt(0) >= 0x06f0 ? ch.charCodeAt(0) - 0x06f0 : ch.charCodeAt(0) - 0x0660)
);

// A timestamp we cannot parse renders as nothing, not as "Invalid Date".
const parse = (ts) => {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
};

const sameDay = (a, b) => a.toDateString() === b.toDateString();

/** "10:28 ص" — the wall clock, for message bubbles and delivery receipts. */
export const formatClock = (ts) => {
  const d = parse(ts);
  if (!d) return '';
  return toLatinDigits(d.toLocaleTimeString(AR_LATN, { hour: '2-digit', minute: '2-digit' }));
};

/** "22/8/2026" — a bare date, for the older end of every scale below. */
export const formatDate = (ts) => {
  const d = parse(ts);
  if (!d) return '';
  return toLatinDigits(d.toLocaleDateString(AR_LATN, { day: 'numeric', month: 'numeric', year: 'numeric' }));
};

/**
 * Conversation-list timestamp, WhatsApp rules: clock time for today, then
 * «أمس», then the weekday for the last week, then a plain date — never the
 * "منذ N د" relative style.
 */
export const formatListTime = (ts) => {
  const d = parse(ts);
  if (!d) return '';
  const now = new Date();
  if (sameDay(d, now)) return formatClock(d);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'أمس';
  if ((now - d) / 86400000 < 7) return d.toLocaleDateString(AR_LATN, { weekday: 'long' });
  return formatDate(d);
};

/** The «اليوم» / «أمس» / «السبت، 22 آب» divider between days in a thread. */
export const formatDaySeparator = (ts) => {
  const d = parse(ts);
  if (!d) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return 'اليوم';
  if (sameDay(d, yesterday)) return 'أمس';
  return toLatinDigits(d.toLocaleDateString(AR_LATN, { weekday: 'long', day: 'numeric', month: 'long' }));
};

/** "منذ 12 د" — the relative style, used in search hits rather than the list. */
export const getRelativeTime = (ts) => {
  const msgTime = parse(ts);
  if (!msgTime) return '';
  const diffSecs = Math.floor((new Date() - msgTime) / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffSecs < 60) return 'الآن';
  if (diffMins < 60) return `منذ ${diffMins} د`;
  if (diffHours < 24) return `منذ ${diffHours} س`;
  if (diffDays < 7) return `منذ ${diffDays} يوم`;
  return formatDate(msgTime);
};
