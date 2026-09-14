/**
 * SHIFT reply buttons: the call-slot offers and what a tap does. Deterministic — no AI, no DB.
 *
 * A slot id carries its own window (`slot:2026-09-15T10:00+03:00/12:00`), so a tap can be honoured
 * even when the stored offer list was overwritten by a later message; it is only refused when the
 * window has passed or the offer is older than SLOT_OFFER_TTL_MS.
 */

const acks = require('./acks');
const hours = require('./hours');
const handoff = require('./handoff');

const SLOT_OFFER_TTL_MS = 12 * 60 * 60 * 1000;
const SLOT_ID_RE = /^slot:(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})([+-]\d{2}:\d{2})\/(\d{2}:\d{2})$/;
const MAX_TITLE = 20;
// Offer "today afternoon" only before this local time; later it is too close to be useful.
const TODAY_CUTOFF_MINUTES = 15 * 60;

function codePoints(s) {
  return Array.from(String(s)).length;
}

function parseSlotId(id) {
  if (id === 'slot:other') return { other: true };
  const m = typeof id === 'string' ? SLOT_ID_RE.exec(id) : null;
  if (!m) return null;
  const [, dateKey, startHm, offset, endHm] = m;
  const start = new Date(`${dateKey}T${startHm}:00${offset}`);
  const end = new Date(`${dateKey}T${endHm}:00${offset}`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
  return { dateKey, startHm, endHm, offset, start, end };
}

function isShiftButtonId(id) {
  return id === 'lead_talk' || id === 'slot:other' || (typeof id === 'string' && SLOT_ID_RE.test(id));
}

function minutesToHm(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function slotTitle(dateKey, window, now, tz, lang) {
  const word = hours.dayWord(dateKey, now, tz, lang);
  const [sh, sm] = [Math.floor(window[0] / 60), window[0] % 60];
  const [eh, em] = [Math.floor(window[1] / 60), window[1] % 60];
  const start = hours.hourLabel(sh, sm);
  const range = `${start}–${hours.hourLabel(eh, em)}${lang === 'en' && eh >= 13 ? ' pm' : ''}`;
  const day = lang === 'en' ? capitalize(word) : word;
  const title = `${day} ${range}`;
  // WhatsApp rejects titles over 20 code points; half-hour windows can get there, the start alone cannot.
  if (codePoints(title) <= MAX_TITLE) return title;
  return Array.from(`${day} ${start}`).slice(0, MAX_TITLE).join('');
}

function otherTitle(lang) {
  return lang === 'en' ? 'Another time' : 'وقت ثاني';
}

function slotOffers(teamHours, now = new Date(), lang = 'ar') {
  const th = teamHours || hours.DEFAULT_TEAM_HOURS;
  const tz = th.tz;
  const fromM = hours.hmToMinutes(th.from);
  const toM = hours.hmToMinutes(th.to);
  let morning = [fromM + 60, fromM + 180];
  let afternoon = [toM - 120, toM];
  if (morning[1] > afternoon[0]) {
    morning = [fromM, toM];
    afternoon = morning;
  }

  const local = hours.localParts(now, tz);
  const offers = [];
  const push = (dateKey, window) => {
    const startAt = hours.zonedDate(dateKey, minutesToHm(window[0]), tz);
    const offset = hours.localParts(startAt, tz).offset;
    const id = `slot:${dateKey}T${minutesToHm(window[0])}${offset}/${minutesToHm(window[1])}`;
    if (offers.some((o) => o.id === id)) return;
    offers.push({ id, title: slotTitle(dateKey, window, now, tz, lang) });
  };

  if (hours.isTeamDay(th, local.dateKey) && local.minutes < TODAY_CUTOFF_MINUTES && local.minutes < afternoon[0]) {
    push(local.dateKey, afternoon);
  }
  let next = null;
  for (let i = 1; i <= 14 && !next; i++) {
    const dateKey = hours.addDays(local.dateKey, i);
    if (hours.isTeamDay(th, dateKey)) next = dateKey;
  }
  if (next) {
    push(next, morning);
    if (offers.length < 2) push(next, afternoon);
  }
  offers.push({ id: 'slot:other', title: otherTitle(lang) });
  return offers;
}

function stageLocked(conversation) {
  return ['handoff', 'captured'].includes(conversation?.current_state);
}

function buttonResult(fields) {
  return {
    kind: 'button',
    action: 'BUTTON',
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

function handleButton(id, ctx = {}) {
  if (!isShiftButtonId(id)) return null;
  const { business = { ai_config: {} }, conversation = { workflow_data: {} }, now = new Date(), messageId = null } = ctx;
  const wd = conversation.workflow_data || {};
  const lead = wd.lead || {};
  const lang = ctx.lang || acks.pickLanguage(lead, '');
  const teamHours = hours.resolveTeamHours(business.ai_config);
  const at = now.toISOString();

  if (id === 'lead_talk') {
    return handoff.buildHandoff({
      business, conversation, now, lang, teamHours,
      reason: 'person', tier: 1, summary: 'ضغط زر «احكي مع الفريق»', modelLine: acks.handoffLead(lang),
    });
  }

  const parsed = parseSlotId(id);
  if (!parsed) return null;
  const closeState = stageLocked(conversation) ? {} : { current_state: 'close' };

  if (parsed.other) {
    return buttonResult({
      messages: [{ type: 'text', text: acks.slotOther(lang) }],
      stateUpdate: closeState,
      workflowDataPatch: { capture_pending: { slot_id: 'other', time_text: null, at } },
    });
  }

  const offer = Array.isArray(wd.slot_offers) ? wd.slot_offers.find((o) => o && o.id === id) : null;
  const nowMs = now.getTime();
  const issuedMs = offer && offer.issued_at ? new Date(offer.issued_at).getTime() : NaN;
  const expired = parsed.end.getTime() <= nowMs
    || (offer && nowMs - issuedMs > SLOT_OFFER_TTL_MS)
    || (!offer && parsed.start.getTime() <= nowMs);
  if (expired) {
    return buttonResult({
      messages: [{ type: 'text', text: acks.expiredSlot(lang) }],
      workflowDataPatch: { capture_pending: { slot_id: null, time_text: null, at } },
    });
  }

  const preferredTime = {
    text: acks.windowText(parsed, now, teamHours.tz, lang),
    start: parsed.start.toISOString(),
    end: parsed.end.toISOString(),
    tz: teamHours.tz,
    slot_id: id,
  };
  const leadPatch = { preferred_time: preferredTime };
  const leadMeta = { source: 'button', msgId: messageId, at, inboundText: '' };

  if (lead.name && lead.business_name) {
    // Lazy: results.js requires this module at load time.
    const { captureResult } = require('./results');
    const r = captureResult({ business, conversation, now, lang, teamHours }, { preferredTime, leadPatch });
    return { ...r, kind: 'button', leadMeta };
  }

  return buttonResult({
    messages: [{ type: 'text', text: acks.captureAsk({ nameKnown: !!lead.name, businessKnown: !!lead.business_name, sector: lead.sector, lang }) }],
    stateUpdate: closeState,
    workflowDataPatch: { capture_pending: { slot_id: id, time_text: null, at } },
    leadPatch,
    leadMeta,
  });
}

/**
 * Boot-time guard: every title slotOffers can produce with the default hours fits WhatsApp's 20
 * code points. Walks a fortnight in 30-minute steps, both languages.
 */
function assertButtons() {
  const th = hours.DEFAULT_TEAM_HOURS;
  const base = Date.UTC(2026, 8, 13, 0, 0);
  for (let step = 0; step < 14 * 48; step++) {
    const now = new Date(base + step * 30 * 60 * 1000);
    for (const lang of ['ar', 'en']) {
      for (const offer of slotOffers(th, now, lang)) {
        const n = codePoints(offer.title);
        if (n < 1 || n > MAX_TITLE) throw new Error(`shift buttons: title "${offer.title}" is ${n} code points`);
        if (!isShiftButtonId(offer.id)) throw new Error(`shift buttons: bad id "${offer.id}"`);
      }
    }
  }
}

module.exports = {
  SLOT_OFFER_TTL_MS,
  SLOT_ID_RE,
  parseSlotId,
  isShiftButtonId,
  slotOffers,
  handleButton,
  assertButtons,
};
