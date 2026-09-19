'use strict';

/**
 * Calendly booking for SHIFT sales calls (owner decision 2026-09-19: link-only booking).
 *
 * Two halves, both pure (no DB, no network):
 *
 * 1. The link. `ai_config.booking_mode: 'calendly' | 'inchat'` with `ai_config.calendly_url`. Calendly mode is
 *    the default whenever a valid calendly_url is set; 'inchat' keeps PR3's slot buttons. Everywhere the bot
 *    used to offer `book:` slots it now sends ONE WhatsApp `cta_url` message with a personalised link
 *    (name, a1 = +962… WhatsApp number, utm_source=whatsapp, utm_campaign=karam). Sending the link is never a
 *    booking: only services/calendlySync.js, after it sees the event on the sales calendar, stores one.
 *    Inside the offer plumbing (ctx.offers, the allowed-button list, validators' slot injection) the link is
 *    the single pseudo offer LINK_ID; every site that would render slot buttons renders the CTA instead, and
 *    normalizeLinkParts() is the last-resort net before sending.
 *
 * 2. Detection. Calendly writes each booking into the connected Google calendar (the same SHIFT_SALES_CALENDAR_ID
 *    the bot books into). parseEvent() reads those events tolerantly — nobody has seen the exact description
 *    Calendly writes yet, so shapeSummary() logs which fields were found (never their values) — and
 *    planActions() pairs a cancel with a create for the same conversation into a reschedule.
 */

const hours = require('./hours');

const LINK_ID = 'book_link';
const MODES = ['calendly', 'inchat'];
const DISPLAY = {
  book: { ar: 'احجز موعدك', en: 'Book a time' },
  reschedule: { ar: 'غيّر الموعد', en: 'Change time' },
  cancel: { ar: 'ألغِ الموعد', en: 'Cancel call' },
};
const BODY = {
  book: {
    ar: 'اختار الوقت اللي بناسبك من هون، وأول ما تحجز بوصلك تأكيد على الواتساب.',
    en: "Pick the time that suits you here — as soon as you book, you'll get a confirmation on WhatsApp.",
  },
  reschedule: {
    ar: 'بتقدر تغيّر موعد المكالمة من هون، وأول ما يتغيّر بوصلك تأكيد على الواتساب. لحد هداك الوقت موعدك الحالي بضل زي ما هو.',
    en: "You can move the call here — once it's changed you'll get a confirmation on WhatsApp. Until then your current time stays as it is.",
  },
  cancel: {
    ar: 'بتقدر تلغي المكالمة من هون. لحد ما تلغيها بضل موعدك زي ما هو.',
    en: 'You can cancel the call here. Until you do, your call stays as it is.',
  },
};

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function isEn(lang) {
  return lang === 'en';
}

function toMs(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  return Date.parse(v);
}

// ─── configuration ───────────────────────────────────────────────────────────

function validUrl(raw) {
  const s = str(raw);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && /(^|\.)calendly\.com$/i.test(u.hostname) ? u.toString() : null;
  } catch (err) {
    return null;
  }
}

/**
 * {mode, url}: 'calendly' when a valid https calendly.com URL is configured and booking_mode is not
 * 'inchat'; otherwise 'inchat' (PR3's slots). A booking_mode of 'calendly' without a usable URL falls back to
 * 'inchat' — the bot never sends a broken link.
 */
function settings(business) {
  const cfg = (business && business.ai_config && typeof business.ai_config === 'object') ? business.ai_config : {};
  const url = validUrl(cfg.calendly_url);
  const wanted = MODES.includes(cfg.booking_mode) ? cfg.booking_mode : null;
  const mode = url && wanted !== 'inchat' ? 'calendly' : 'inchat';
  return { mode, url, configuredMode: wanted };
}

function isLinkMode(business) {
  return settings(business).mode === 'calendly';
}

// ─── the link ────────────────────────────────────────────────────────────────

function linkOffer(lang) {
  return { id: LINK_ID, title: isEn(lang) ? DISPLAY.book.en : DISPLAY.book.ar };
}

function isLinkOffers(offers) {
  return Array.isArray(offers) && offers.some((o) => o && o.id === LINK_ID);
}

/** The personalised link: name (when the lead's name is known), a1 = +<WhatsApp number>, UTM tags. */
function personalUrl(baseUrl, { name, phone } = {}) {
  const u = new URL(baseUrl);
  const n = str(name);
  if (n) u.searchParams.set('name', Array.from(n).slice(0, 80).join(''));
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits) u.searchParams.set('a1', `+${digits}`);
  u.searchParams.set('utm_source', 'whatsapp');
  u.searchParams.set('utm_campaign', 'karam');
  return u.toString();
}

/** Everything a site needs to render the CTA for this conversation, or null outside Calendly mode. */
function linkFor(business, conversation, lang, { force = false } = {}) {
  const s = settings(business);
  // `force`: a Calendly booking needs its link even after a revert to in-chat mode.
  if (!s.url || (s.mode !== 'calendly' && !force)) return null;
  const wd = (conversation && conversation.workflow_data) || {};
  const lead = wd.lead || {};
  return {
    url: personalUrl(s.url, { name: lead.name, phone: conversation && conversation.customer_wa_id }),
    lang: isEn(lang) ? 'en' : 'ar',
  };
}

function bodyText(kind, lang) {
  const row = BODY[kind] || BODY.book;
  return isEn(lang) ? row.en : row.ar;
}

function displayText(kind, lang) {
  const row = DISPLAY[kind] || DISPLAY.book;
  return isEn(lang) ? row.en : row.ar;
}

function joinText(line, body) {
  const a = str(line);
  const b = str(body);
  if (!a) return b;
  if (!b) return a;
  return `${a}\n\n${b}`;
}

/**
 * ONE WhatsApp interactive `cta_url` message. `line` (the model's words or a server lead-in) goes above
 * the body. The plain-text fallback carries the same words and the URL, for when Graph refuses the shape.
 * `bookingLink` marks the part so the batcher records booking_link.sent_at when it goes out.
 */
function linkPart({ url, lang = 'ar', kind = 'book', line = '', body } = {}) {
  const text = joinText(line, body === undefined ? bodyText(kind, lang) : body);
  const part = {
    type: 'cta_url',
    text,
    displayText: displayText(kind, lang),
    url,
    serverButtons: true,
    bookingLink: { kind },
    fallback: { type: 'text', text: `${text}\n${url}` },
  };
  if (line) part.ack = str(body === undefined ? bodyText(kind, lang) : body);
  return part;
}

function isLinkPart(part) {
  return !!(part && part.type === 'cta_url' && part.bookingLink);
}

/**
 * booking_link as it stands after this result goes out: when the link (or a reschedule/cancel link) was
 * sent. Kept beside `booking`, never inside it: a reply that wrote the whole `booking` key could otherwise
 * overwrite a booking the sweep stored a moment earlier.
 */
function linkRecord(prev, kind, at) {
  const p = prev && typeof prev === 'object' ? prev : {};
  return {
    first_sent_at: p.first_sent_at || at,
    sent_at: at,
    count: (Number(p.count) || 0) + 1,
    kind,
  };
}

/** The result with workflowDataPatch.booking_link set when one of its parts is the booking link. */
function stampLink(result, wd, now = new Date()) {
  if (!result || !Array.isArray(result.messages)) return result;
  const part = result.messages.find(isLinkPart);
  if (!part) return result;
  const at = new Date(now).toISOString();
  return {
    ...result,
    workflowDataPatch: {
      ...(result.workflowDataPatch || {}),
      booking_link: linkRecord((wd || {}).booking_link, part.bookingLink.kind || 'book', at),
    },
  };
}

/**
 * Last-resort net: a reply-button part carrying the LINK_ID pseudo offer (a path that built slot buttons
 * from ctx.offers without knowing about Calendly) goes out as the CTA instead. A body ending on the slot
 * lead-in («أقرب أوقات الفريق:») loses it: the link's own body replaces it.
 */
const SLOT_LEAD_RE = /\s*(?:أقرب أوقات الفريق:|The team's nearest times:)\s*$/;

function normalizeLinkParts(result, link) {
  if (!result || !Array.isArray(result.messages)) return result;
  let changed = false;
  const messages = result.messages.map((p) => {
    if (!p || p.type !== 'interactive' || !Array.isArray(p.buttons) || !p.buttons.some((b) => b && b.id === LINK_ID)) return p;
    changed = true;
    const line = String(p.text || '').replace(SLOT_LEAD_RE, '').trim();
    if (!link || !link.url) return { type: 'text', text: line || bodyText('book', 'ar') };
    const out = linkPart({ url: link.url, lang: link.lang, kind: 'book', line });
    if (p.modelLine !== undefined) out.modelLine = p.modelLine;
    return out;
  });
  if (!changed) return result;
  const wdp = { ...(result.workflowDataPatch || {}) };
  // The pseudo offer is not a slot: nothing was offered that a tap could book.
  if (Array.isArray(wdp.slot_offers)) wdp.slot_offers = wdp.slot_offers.filter((o) => o && o.id !== LINK_ID);
  return { ...result, messages, workflowDataPatch: wdp };
}

// ─── absolute day and time (confirmations sent by the sweep) ─────────────────

function periodAr(hh) {
  if (hh < 12) return 'الصبح';
  if (hh < 15) return 'الظهر';
  if (hh < 18) return 'العصر';
  return 'المسا';
}

/** {day: «الأربعاء 16/9», time: «10:30 الصبح»} — never «بكرا»: a message sent later must still be right. */
function absoluteWhen(start, tz, lang) {
  const zone = tz || hours.DEFAULT_TEAM_HOURS.tz;
  const p = hours.localParts(start, zone);
  const [, mo, d] = p.dateKey.split('-').map(Number);
  const weekday = (isEn(lang) ? hours.WEEKDAYS_EN : hours.WEEKDAYS_AR)[p.weekday];
  const h12 = p.hh % 12 || 12;
  const clock = `${h12}:${String(p.mm).padStart(2, '0')}`;
  return {
    day: `${weekday} ${d}/${mo}`,
    time: isEn(lang) ? `${clock} ${p.hh >= 12 ? 'pm' : 'am'}` : `${clock} ${periodAr(p.hh)}`,
  };
}

const NOTICE = {
  booked: {
    ar: ({ day, time }) => `ثبّتنا مكالمتك مع فريق شِفت: ${day} الساعة ${time} بتوقيت عمّان. رح نذكّرك قبلها.`,
    en: ({ day, time }) => `Your call with the SHIFT team is booked: ${day} at ${time} Amman time. We'll remind you before it.`,
  },
  rescheduled: {
    ar: ({ day, time }) => `وصلنا تغيير الموعد: صارت مكالمتك مع فريق شِفت ${day} الساعة ${time} بتوقيت عمّان. رح نذكّرك قبلها.`,
    en: ({ day, time }) => `Got your change: your call with the SHIFT team is now ${day} at ${time} Amman time. We'll remind you before it.`,
  },
  cancelled: {
    ar: ({ day, time }) => `وصلنا إلغاء مكالمتك (${day} الساعة ${time}). إذا حبيت نرتّب وقت ثاني احكيلي.`,
    en: ({ day, time }) => `Your call (${day} at ${time}) is cancelled. If you'd like another time, just tell me.`,
  },
};

function noticeText(kind, start, tz, lang) {
  const row = NOTICE[kind] || NOTICE.booked;
  return (isEn(lang) ? row.en : row.ar)(absoluteWhen(start, tz, lang));
}

// ─── status / change / cancel wording ────────────────────────────────────────

const STATUS = {
  linkOnly: {
    ar: 'بعتتلك رابط الحجز، بس لسه ما في موعد محجوز.',
    en: "I sent you the booking link, but nothing is booked yet.",
  },
  none: {
    ar: 'ما في موعد محجوز حاليًا.',
    en: "There's no call booked right now.",
  },
  request: {
    ar: (when) => `طلب مكالمتك عند الفريق${when ? `: ${when} بتوقيت عمّان` : ''} — طلب، مش موعد مؤكد لسه.`,
    en: (when) => `Your call request is with the team${when ? `: ${when} Amman time` : ''} — a request, not a confirmed booking yet.`,
  },
  changeNoUrl: {
    ar: 'اختار الوقت الجديد من هون، وأول ما تحجزه بوصلك تأكيد. الموعد القديم بضل لحد ما يلغيه الفريق.',
    en: "Pick the new time here — once you book it you'll get a confirmation. Your old time stays until the team cancels it.",
  },
  changeRelay: {
    ar: 'ما قدرت أغيّر الموعد من هون — وصّلت طلبك للفريق، وموعدك الحالي بضل زي ما هو لحد ما يأكدوا معك هون.',
    en: "I couldn't move the call from here — I've passed your request to the team, and your current call stays as it is until they confirm with you here.",
  },
  cancelNoUrl: {
    ar: 'ما قدرت ألغي المكالمة من هون — وصّلت طلب الإلغاء للفريق وبيأكدوا معك هون.',
    en: "I couldn't cancel the call from here — I've passed your request to the team and they'll confirm with you here.",
  },
};

function statusLine(key, lang, arg) {
  const row = STATUS[key];
  const v = isEn(lang) ? row.en : row.ar;
  return typeof v === 'function' ? v(arg) : v;
}

// ─── parsing a Google event written by Calendly ─────────────────────────────

const CANCEL_URL_RE = /https?:\/\/(?:www\.)?calendly\.com\/cancellations\/[A-Za-z0-9_-]+/i;
const RESCHEDULE_URL_RE = /https?:\/\/(?:www\.)?calendly\.com\/reschedulings\/[A-Za-z0-9_-]+/i;
const CALENDLY_RE = /calendly\.com/i;
const URL_ANY_RE = /https?:\/\/[^\s<>"')]+/gi;
const PHONE_LABEL_RE = /(phone|mobile|whats\s*app|\bwa\b|\btel\b|cell|number|رقم|هاتف|جوال|موبايل|واتس|تلفون|تليفون)/i;
const NAME_LABEL_RE = /^\s*(?:invitee(?:\s*name)?|name|full\s*name|الاسم|اسمك|اسم العميل)\s*[:：]\s*(.+)$/i;
const EMAIL_LABEL_RE = /^\s*(?:invitee\s*email|email|e-mail|البريد(?:\s*الإلكتروني)?|الايميل|الإيميل)\s*[:：]\s*(\S+@\S+)\s*$/i;
const CANDIDATE_RE = /(?:\+|00)?\d[\d \t\-.()/]{5,22}\d/g;

/** Arabic-Indic and Persian digits → ASCII; bidi marks and NBSP → plain. */
function westernDigits(s) {
  return String(s == null ? '' : s)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0))
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[   ]/g, ' ')
    .replace(/[‐-―−]/g, '-')
    .replace(/＋/g, '+');
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/gi, '&');
}

/** Google stores the description as HTML or as text; either way → plain lines (an <a>'s href is kept). */
function plainText(description) {
  const raw = String(description == null ? '' : description);
  const html = /<[a-z][^>]*>/i.test(raw);
  let s = raw;
  if (html) {
    s = s
      .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => `${inner.replace(/<[^>]+>/g, '')} ${href}`)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '');
  }
  return { text: decodeEntities(s).replace(/\r\n?/g, '\n'), html };
}

/**
 * A phone number in any of the forms customers type → international digits (962…), or null.
 * +962 / 00962 / 962 keep their country code (a stray trunk 0 after it is dropped); 07XXXXXXXX and
 * 7XXXXXXXX are Jordanian mobiles; other + / 00 numbers are kept as they are (8–15 digits).
 */
function normalizePhone(raw) {
  let s = westernDigits(raw).trim();
  if (!s) return null;
  let intl = false;
  s = s.replace(/[\s\-.()/]/g, '');
  if (s.startsWith('+')) {
    intl = true;
    s = s.slice(1);
  } else if (s.startsWith('00')) {
    intl = true;
    s = s.slice(2);
  }
  if (!/^\d+$/.test(s)) return null;
  let d = s;
  if (d.startsWith('9620')) d = `962${d.slice(4)}`;
  if (!intl && !d.startsWith('962')) {
    if (/^07\d{8}$/.test(d)) d = `962${d.slice(1)}`;
    else if (/^7\d{8}$/.test(d)) d = `962${d}`;
    else return null;
  }
  if (d.length < 8 || d.length > 15) return null;
  if (d.startsWith('962') && !/^962\d{8,9}$/.test(d)) return null;
  return d;
}

function phonesIn(line) {
  const out = [];
  for (const m of westernDigits(line).matchAll(CANDIDATE_RE)) {
    const n = normalizePhone(m[0]);
    if (n) out.push(n);
  }
  return out;
}

/** {phone, labelled}: a labelled line first («WhatsApp: …», «رقم الواتساب: …», a label alone above it), then anywhere. */
function findPhone(text) {
  const noUrls = String(text || '').replace(URL_ANY_RE, ' ');
  const lines = noUrls.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const colon = line.search(/[:：]/);
    const label = colon >= 0 ? line.slice(0, colon) : line;
    if (!PHONE_LABEL_RE.test(label)) continue;
    const here = phonesIn(colon >= 0 ? line.slice(colon + 1) : line);
    if (here.length) return { phone: here[0], labelled: true };
    // «WhatsApp number:» with the answer on the next line.
    const next = lines[i + 1] || '';
    const below = phonesIn(next);
    if (below.length) return { phone: below[0], labelled: true };
  }
  const any = lines.flatMap(phonesIn);
  return any.length ? { phone: any[0], labelled: false } : { phone: null, labelled: false };
}

function inviteeAttendee(event) {
  const list = Array.isArray(event && event.attendees) ? event.attendees : [];
  return list.find((a) => a && !a.organizer && !a.self && !a.resource) || null;
}

function eventTime(value) {
  if (!value || typeof value !== 'object') return null;
  const v = value.dateTime || null;
  const ms = v ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function isCalendlyEvent(event) {
  if (!event || typeof event !== 'object') return false;
  const hay = [event.description, event.location, event.iCalUID, event.source && event.source.url]
    .filter((v) => typeof v === 'string').join('\n');
  return CALENDLY_RE.test(hay);
}

/** The bot's own events carry extendedProperties.private.conversationId/businessId (booking.eventBody). */
function isOwnEvent(event) {
  const priv = event && event.extendedProperties && event.extendedProperties.private;
  return !!(priv && (priv.conversationId || priv.businessId));
}

/**
 * Everything the sync needs from one event. Tolerant: any field may be missing; a cancelled event from an
 * incremental list usually has only id, status and updated.
 */
function parseEvent(event) {
  const ev = event && typeof event === 'object' ? event : {};
  const { text, html } = plainText(ev.description);
  const location = typeof ev.location === 'string' ? ev.location : '';
  const all = `${text}\n${location}`;
  const cancel = CANCEL_URL_RE.exec(all);
  const reschedule = RESCHEDULE_URL_RE.exec(all);
  const phone = findPhone(all);
  const attendee = inviteeAttendee(ev);
  let name = attendee && str(attendee.displayName) ? str(attendee.displayName) : null;
  let email = attendee && str(attendee.email) ? str(attendee.email) : null;
  for (const line of text.split('\n')) {
    if (!name) {
      const m = NAME_LABEL_RE.exec(line);
      if (m && str(m[1]) && !/@/.test(m[1])) name = str(m[1]).slice(0, 120);
    }
    if (!email) {
      const m = EMAIL_LABEL_RE.exec(line);
      if (m) email = m[1];
    }
  }
  return {
    id: typeof ev.id === 'string' ? ev.id : null,
    status: ev.status === 'cancelled' ? 'cancelled' : (ev.status || 'confirmed'),
    updated: typeof ev.updated === 'string' ? ev.updated : null,
    created: typeof ev.created === 'string' ? ev.created : null,
    start: eventTime(ev.start),
    end: eventTime(ev.end),
    tz: (ev.start && ev.start.timeZone) || null,
    phone: phone.phone,
    phoneLabelled: phone.labelled,
    name,
    email,
    cancelUrl: cancel ? cancel[0] : null,
    rescheduleUrl: reschedule ? reschedule[0] : null,
    calendly: isCalendlyEvent(ev),
    own: isOwnEvent(ev),
    html,
    descriptionLength: typeof ev.description === 'string' ? ev.description.length : 0,
    attendeeCount: Array.isArray(ev.attendees) ? ev.attendees.length : 0,
  };
}

/** What was found, never what it said: logged for every Calendly event so the first real one verifies the parser. */
function shapeSummary(parsed) {
  const p = parsed || {};
  return {
    status: p.status || null,
    phone: !!p.phone,
    phone_labelled: !!p.phoneLabelled,
    cancel_url: !!p.cancelUrl,
    reschedule_url: !!p.rescheduleUrl,
    attendees: p.attendeeCount || 0,
    invitee_name: !!p.name,
    invitee_email: !!p.email,
    start: !!p.start,
    html: !!p.html,
    description_length: p.descriptionLength || 0,
  };
}

// ─── name-only matching ──────────────────────────────────────────────────────

const NAME_MATCH_WINDOW_MS = 48 * 60 * 60 * 1000;

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (x.length < 3 || y.length < 3) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && ` ${long} `.includes(` ${short} `);
}

/**
 * Conversations a phone-less Calendly booking might belong to: a link sent within 48 h before the booking
 * and a name that matches. Only a single candidate is returned (staff are asked; nothing is confirmed).
 */
function nameCandidates(convs, parsed, now = new Date()) {
  if (!parsed || !parsed.name) return [];
  const bookedMs = toMs(parsed.created || now);
  return (Array.isArray(convs) ? convs : []).filter((c) => {
    const wd = (c && c.workflow_data) || {};
    const link = wd.booking_link;
    const sentMs = link && link.sent_at ? toMs(link.sent_at) : NaN;
    if (!Number.isFinite(sentMs) || sentMs > bookedMs + 5 * 60 * 1000 || bookedMs - sentMs > NAME_MATCH_WINDOW_MS) return false;
    const lead = wd.lead || {};
    return [lead.name, c.profile_name].some((n) => namesMatch(n, parsed.name));
  });
}

// ─── planning one sweep ──────────────────────────────────────────────────────

const ACTIVE = ['booked', 'rescheduled'];

function storedBooking(conv) {
  const wd = (conv && conv.workflow_data) || {};
  return wd.booking && typeof wd.booking === 'object' ? wd.booking : null;
}

/**
 * items: [{event, parsed, conv, match: 'phone'|'event'|'name'|null, candidates?}] for one sweep, in list order.
 * → actions: {type: 'booked'|'rescheduled'|'moved'|'cancelled'|'refresh'|'low_confidence'|'unmatched', …}.
 * Calendly reschedules by cancelling the old event and creating a new one: a cancel of a conversation's
 * stored event plus a create for the same conversation in the same sweep is ONE reschedule. An item whose
 * state is already stored produces nothing (idempotent across sweeps).
 */
function planActions(items) {
  const creates = [];
  const cancels = [];
  const out = [];
  const sorted = (Array.isArray(items) ? items : []).slice()
    .sort((a, b) => (toMs(a.parsed.updated) || 0) - (toMs(b.parsed.updated) || 0));
  for (const item of sorted) {
    const { parsed, conv } = item;
    if (parsed.status === 'cancelled') {
      const b = storedBooking(conv);
      if (!conv || !b || b.event_id !== parsed.id || !ACTIVE.includes(b.status)) continue;
      cancels.push(item);
      continue;
    }
    if (!parsed.start || !parsed.end) continue;
    if (!conv) {
      if (item.match === 'name' && item.candidate) out.push({ type: 'low_confidence', ...item, conv: item.candidate });
      else out.push({ type: 'unmatched', ...item });
      continue;
    }
    const b = storedBooking(conv);
    if (b && b.event_id === parsed.id && ACTIVE.includes(b.status)) {
      if (toMs(b.start) !== toMs(parsed.start)) out.push({ type: 'moved', ...item, previous: b });
      else if ((!b.cancel_url && parsed.cancelUrl) || (!b.reschedule_url && parsed.rescheduleUrl)) out.push({ type: 'refresh', ...item, previous: b });
      continue;
    }
    creates.push(item);
  }
  const pairedCancels = new Set();
  for (const item of creates) {
    const cancel = cancels.find((c) => c.conv && item.conv && c.conv.id === item.conv.id && !pairedCancels.has(c));
    if (cancel) {
      pairedCancels.add(cancel);
      out.push({ type: 'rescheduled', ...item, previous: storedBooking(cancel.conv), cancelled: cancel.parsed });
      continue;
    }
    out.push({ type: 'booked', ...item, previous: storedBooking(item.conv) });
  }
  for (const c of cancels) if (!pairedCancels.has(c)) out.push({ type: 'cancelled', ...c, previous: storedBooking(c.conv) });
  return out;
}

module.exports = {
  LINK_ID,
  DISPLAY,
  BODY,
  NAME_MATCH_WINDOW_MS,
  settings,
  isLinkMode,
  linkOffer,
  isLinkOffers,
  personalUrl,
  linkFor,
  linkPart,
  isLinkPart,
  bodyText,
  displayText,
  stampLink,
  linkRecord,
  normalizeLinkParts,
  absoluteWhen,
  noticeText,
  statusLine,
  westernDigits,
  plainText,
  normalizePhone,
  findPhone,
  parseEvent,
  shapeSummary,
  isCalendlyEvent,
  isOwnEvent,
  namesMatch,
  nameCandidates,
  planActions,
};
