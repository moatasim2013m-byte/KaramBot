'use strict';

/**
 * «أوقات الدوام» and «رسالة خارج الدوام» from /bot, enforced on the message path.
 *
 * Both were saved for every shop and read by nothing but the generic prompt, so a restaurant
 * marked «مغلق» on Friday kept taking orders and its closed message was never sent.
 *
 * Opt-in by design: hours are enforced only when the owner has also written an out-of-hours
 * message. The /bot editor saves its default 09:00–21:00 rows with any save of «طريقة الرد», and a
 * shop that only edited its greeting must not find its bot silent at night. Rows in any other
 * shape (SHIFT's older numeric days) are not understood, so they never close a shop either.
 */

// The /bot editor's row keys, in its order. getDay() order (Sunday = 0) is mapped below.
const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const WEEKDAY_EN = {
  Saturday: 'السبت', Sunday: 'الأحد', Monday: 'الاثنين', Tuesday: 'الثلاثاء',
  Wednesday: 'الأربعاء', Thursday: 'الخميس', Friday: 'الجمعة',
};
const DEFAULT_TZ = 'Asia/Amman';

/** 'HH:MM' → minutes after midnight, or null. */
function minutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/** The shop's local weekday (Arabic) and minute of day. */
function localNow(now, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || DEFAULT_TZ, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    // A bad timezone string on the row: Amman, where every SHIFT shop is.
    return localNow(now, DEFAULT_TZ);
  }
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { day: WEEKDAY_EN[get('weekday')], minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** The editor's rows by day; null when the hours are not in its shape. */
function rowsByDay(openingHours) {
  if (!Array.isArray(openingHours)) return null;
  const byDay = new Map();
  for (const r of openingHours) {
    if (r && typeof r === 'object' && DAYS.includes(r.day)) byDay.set(r.day, r);
  }
  return byDay.size ? byDay : null;
}

/**
 * true/false when the hours say, null when they cannot (no rows, the day missing, a bad time).
 * A close at or before the open runs past midnight (12:00–01:00, 18:00–00:00), so yesterday's
 * row can still hold the shop open in the small hours. open === close is open all day.
 */
function isOpenAt(openingHours, now = new Date(), timeZone = DEFAULT_TZ) {
  const byDay = rowsByDay(openingHours);
  if (!byDay) return null;
  const { day, minute } = localNow(now, timeZone);
  const today = byDay.get(day);
  if (!today) return null;

  const yesterday = byDay.get(DAYS[(DAYS.indexOf(day) + DAYS.length - 1) % DAYS.length]);
  if (yesterday && !yesterday.closed) {
    const yo = minutes(yesterday.open);
    const yc = minutes(yesterday.close);
    if (yo !== null && yc !== null && yc < yo && minute < yc) return true;
  }

  if (today.closed) return false;
  const o = minutes(today.open);
  const c = minutes(today.close);
  if (o === null || c === null) return null;
  if (o === c) return true;
  if (c > o) return minute >= o && minute < c;
  return minute >= o; // runs past midnight: the rest is tomorrow's small hours
}

/** The message to send instead of a reply, or null when the bot should answer as usual. */
function outOfHoursMessage(business, now = new Date()) {
  const text = String(business?.ai_config?.out_of_hours_message || '').trim();
  if (!text) return null;
  return isOpenAt(business.opening_hours, now, business.timezone) === false ? text : null;
}

module.exports = { outOfHoursMessage, isOpenAt, DAYS };
