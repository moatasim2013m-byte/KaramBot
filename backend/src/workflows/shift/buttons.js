/**
 * SHIFT reply buttons: the call-slot offers and what a tap does. Deterministic — no AI, no DB.
 *
 * A slot id carries its own window (`slot:2026-09-15T10:00+03:00/12:00`), so a tap can be honoured
 * even when the stored offer list was overwritten by a later message; it is only refused when the
 * window has passed or the offer is older than SLOT_OFFER_TTL_MS.
 *
 * PR2 ids (contract §9.1) route sector picks, samples, role-play controls, consent and nudge answers.
 * Every text a tap sends is server copy (acks, assets, roleplay), so taps never reach the model or the
 * validators; their honesty is pinned by unit tests instead.
 */

const acks = require('./acks');
const hours = require('./hours');
const handoff = require('./handoff');
const assets = require('./assets');
const roleplay = require('./roleplay');
const validators = require('./validators');
// PR3: `book:<iso>` and the booking controls are routable ids, answered by booking.js (async, calendar).
const booking = require('./booking');

const SLOT_OFFER_TTL_MS = 12 * 60 * 60 * 1000;
const SLOT_ID_RE = /^slot:(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})([+-]\d{2}:\d{2})\/(\d{2}:\d{2})$/;
const PR2_ID_RE = /^(sector:(clinic|restaurant|store|other)|sample_roleplay:(clinic|restaurant|store|other)|sample_page:(clinic|restaurant|store|other)|sample_image:(clinic|restaurant|store|other)|send_sample_now|quote_written|lead_call|end_roleplay|roleplay_continue|followup_yes|followup_no|nudge_not_now)$/;
const MAX_TITLE = 20;
const MAX_ROW_TITLE = 24;
const MAX_ROW_DESCRIPTION = 72;
const MAX_HEADER = 60;
// Offer "today afternoon" only before this local time; later it is too close to be useful.
const TODAY_CUTOFF_MINUTES = 15 * 60;
const CONSENT_DELAY_MS = 2 * 24 * 60 * 60 * 1000;
// An idle-ended example can be picked up again from the resume nudge within this long.
const ROLEPLAY_RESUME_MS = 60 * 60 * 1000;
const STAFF_TASKS_CAP = 20;
// Taps that offer or open a sample, role-play or call count as fresh interest (msgs_since_interest).
const INTEREST_TAP_RE = /^(slot:|sample_|send_sample_now|lead_call|roleplay_continue)/;
// While the team's request is open the bot is a concierge: these taps get the concierge line only.
const LOCKED_REFUSED_RE = /^(sector:|sample_|send_sample_now|end_roleplay|roleplay_continue|lead_call)/;

// Discovery question 1 as fixed copy: a sector tap must not wait for the model (eval #2).
const DISCOVERY_Q1 = {
  ar: 'مين بيرد على رسائل واتساب عندكم حاليًا؟',
  en: 'Who answers your WhatsApp messages today?',
};
const CONSENT_TASK_SUMMARY = 'موافقة متابعة بعد يومين';
const QUOTE_TASK_SUMMARY = 'طلب عرض مكتوب (زر)';

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
  if (typeof id !== 'string') return false;
  return id === 'lead_talk' || id === 'slot:other' || SLOT_ID_RE.test(id) || PR2_ID_RE.test(id) || booking.isBookingId(id);
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

// Same rule as results.isStageLocked (not required here: results.js requires this module at load time).
function stageLocked(conversation) {
  return ['handoff', 'captured'].includes(conversation?.current_state) && conversation?.status === 'pending';
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

function toIso(value) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

/** The consent as the design stores it: exact wording, answer, time, message id and what it allows. */
function consentRecord({ answer, text, msgId = null, now = new Date() } = {}) {
  return {
    text,
    answer,
    at: toIso(now),
    msg_id: msgId ?? null,
    scope: { channel: 'whatsapp', when: '+2d', max: 1 },
  };
}

function staffTask(kind, summary, now = new Date(), dueAt = now) {
  return { kind, summary: String(summary || '').slice(0, 200), due_at: toIso(dueAt), at: toIso(now), done_at: null };
}

/** Producers append to staff_tasks (read, append, cap, write whole — contract §1.3). */
function appendStaffTask(wd, task) {
  const list = Array.isArray(wd.staff_tasks) ? wd.staff_tasks : [];
  return list.concat([task]).slice(-STAFF_TASKS_CAP);
}

function sampleSector(value) {
  return assets.SAMPLE_SECTORS.includes(value) ? value : 'other';
}

/** A complete roleplay object (§1.3), spread from the stored one so keys other producers add survive. */
function roleplayObject(prev, fields) {
  return {
    ...(prev && typeof prev === 'object' ? prev : {}),
    active: false,
    sector: null,
    business_name: null,
    facts: [],
    started_at: null,
    last_turn_at: null,
    turns: 0,
    setup_asks: 0,
    ended_at: null,
    end_reason: null,
    ...fields,
  };
}

function samplesSent(wd) {
  const prev = wd.samples_sent && typeof wd.samples_sent === 'object' ? wd.samples_sent : {};
  return { image: null, page: null, accepted_at: null, ...prev };
}

function text(t) {
  return { type: 'text', text: t };
}

function isVetted(ctx, sector) {
  if (ctx.vetted instanceof Set) return ctx.vetted.has(sector);
  return assets.isVetted(ctx.business, sector);
}

// ─── PR2 tap handlers ────────────────────────────────────────────────────────

/** The role-play setup ask (role-play on) or the sector page + its follow-up (role-play off). */
function sampleRoleplayResult(sector, c) {
  const { wd, lang, at } = c;
  if (!c.roleplayOn) return samplePageResult(sector, c);
  if (roleplay.isActive(wd)) {
    // Already inside the example: a stale card tap must not reset it.
    return buttonResult({ messages: [text(acks.roleplayContinue(lang))] });
  }
  const samples = samplesSent(wd);
  return buttonResult({
    messages: [text(roleplay.setupAsk(sector, lang))],
    stateUpdate: { current_state: 'roleplay_setup' },
    workflowDataPatch: {
      roleplay: roleplayObject(wd.roleplay, { sector, setup_asks: 1 }),
      samples_sent: { ...samples, accepted_at: samples.accepted_at || at },
    },
  });
}

function samplePageResult(sector, c) {
  const { wd, lang } = c;
  return buttonResult({
    messages: [assets.pagePart(sector, lang), assets.pageFollowUp(sector, lang, { roleplayOn: c.roleplayOn })],
    workflowDataPatch: { samples_sent: { ...samplesSent(wd), page: sector } },
  });
}

function sampleImageResult(sector, c) {
  const { wd, lang, lead } = c;
  if (!isVetted(c, sector)) return sampleRoleplayResult(sector, c);
  return buttonResult({
    messages: [assets.imagePart(sector, lang, { sectorText: lead.sector_text })],
    workflowDataPatch: { samples_sent: { ...samplesSent(wd), image: sector } },
  });
}

function sendSampleNowResult(c) {
  const { wd, lang, lead, at } = c;
  const sector = sampleSector(lead.sector);
  if (!isVetted(c, sector)) return sampleRoleplayResult(sector, c);
  const samples = samplesSent(wd);
  if (samples.image === sector) {
    return buttonResult({ messages: [text(acks.sampleAlreadySent(lang))] });
  }
  return buttonResult({
    messages: [assets.sampleCard(sector, lang, { sectorText: lead.sector_text, roleplayOn: c.roleplayOn })],
    stateUpdate: { current_state: 'sample' },
    workflowDataPatch: { samples_sent: { ...samples, image: sector, accepted_at: samples.accepted_at || at } },
  });
}

function sectorResult(sector, c) {
  const { lang, at, messageId } = c;
  const leadMeta = { source: 'button', msgId: messageId, at, inboundText: '', trusted: ['sector'] };
  if (sector === 'other') {
    return buttonResult({
      messages: [text(acks.sectorTextAsk(lang))],
      stateUpdate: { current_state: 'discovery' },
      workflowDataPatch: { awaiting_sector_text: true },
      leadPatch: { sector: 'other' },
      leadMeta,
    });
  }
  return buttonResult({
    messages: [text(`${acks.sectorAck(sector, lang)}\n${lang === 'en' ? DISCOVERY_Q1.en : DISCOVERY_Q1.ar}`)],
    stateUpdate: { current_state: 'discovery' },
    // The fixed line is discovery question 1: counted, so the objective moves to question 2.
    workflowDataPatch: { questions_asked: (Number(c.wd.questions_asked) || 0) + 1 },
    leadPatch: { sector },
    leadMeta,
  });
}

function quoteWrittenResult(c) {
  const { wd, lang, at, teamHours } = c;
  // Lazy: results.js requires this module at load time.
  const { mergeNeedsTeam, needsTeamEntry } = require('./results');
  const candidate = needsTeamEntry('quote', QUOTE_TASK_SUMMARY, at);
  const needs = mergeNeedsTeam(wd.needs_team, candidate);
  const quoteAck = `${acks.quoteWrittenLead(lang)}\n\n${acks.flagAck('quote', { teamHours, lang })}`;
  if (!needs) {
    // A request of equal or higher priority is already open: no second alert. A quote already on the
    // list is still true to repeat; anything else gets the concierge line, never a new «سجّلت».
    const already = wd.needs_team?.reason === 'quote';
    return buttonResult({
      messages: [text(already ? quoteAck : validators.stageFallback('handoff', lang))],
      stateUpdate: { status: 'pending' },
      needsTeamCandidate: candidate,
    });
  }
  return buttonResult({
    action: 'FLAG_FOR_TEAM',
    messages: [text(quoteAck)],
    stateUpdate: { status: 'pending' },
    workflowDataPatch: { needs_team: needs },
    needsTeam: needs,
    needsTeamCandidate: candidate,
    alert: { reason: 'quote', summary: QUOTE_TASK_SUMMARY },
  });
}

function leadCallResult(c) {
  const { lang, at, now, teamHours } = c;
  // PR3: the batcher passes the calendar's free slots when booking is on; otherwise PR2's windows.
  const offers = (Array.isArray(c.offers) && c.offers.length ? c.offers : slotOffers(teamHours, now, lang)).slice(0, 3);
  return buttonResult({
    messages: [{
      type: 'interactive',
      text: `${acks.callChoiceLead(lang)} ${acks.slotsBody(lang)}`,
      buttons: offers.map((o) => ({ id: o.id, title: o.title })),
      serverButtons: true,
    }],
    stateUpdate: { current_state: 'close' },
    workflowDataPatch: { slot_offers: offers.map((o) => ({ id: o.id, title: o.title, issued_at: at })) },
  });
}

function endRoleplayResult(c) {
  const { wd, lang, now, conversation } = c;
  const rp = wd.roleplay && typeof wd.roleplay === 'object' ? wd.roleplay : null;
  const ran = !!(rp && rp.started_at);
  if (!ran) {
    // Nothing was played: no «كان مثال توضيحي» line about an example that never happened.
    const inSetup = conversation.current_state === 'roleplay_setup';
    return buttonResult({
      messages: [text(validators.stageFallback('close', lang))],
      stateUpdate: inSetup ? { current_state: 'close' } : {},
      workflowDataPatch: inSetup && rp ? { roleplay: roleplay.endState(rp, 'done', now) } : {},
    });
  }
  const reopen = rp.active === true || rp.end_reason === 'idle';
  return buttonResult({
    messages: [text(roleplay.endLine(rp.sector, lang))],
    stateUpdate: { current_state: 'close' },
    workflowDataPatch: reopen ? { roleplay: roleplay.endState(rp, 'done', now) } : {},
  });
}

function roleplayContinueResult(c) {
  const { wd, lang, now, at, lead } = c;
  const rp = wd.roleplay && typeof wd.roleplay === 'object' ? wd.roleplay : null;
  if (!c.roleplayOn) return samplePageResult(sampleSector(rp?.sector || lead.sector), c);
  if (roleplay.isActive(wd)) {
    return buttonResult({ messages: [text(acks.roleplayContinue(lang))], stateUpdate: { current_state: 'roleplay' } });
  }
  const endedMs = rp && rp.ended_at ? new Date(rp.ended_at).getTime() : NaN;
  // The resume nudge promised «ضايل كم سؤال»: its tap resumes the stored facts whenever it came.
  const fromResumeNudge = !!(wd.nudge && wd.nudge.kind === 'roleplay_resume' && wd.nudge.sent_at);
  if (rp && rp.end_reason === 'idle' && rp.started_at
    && (fromResumeNudge || (Number.isFinite(endedMs) && now.getTime() - endedMs < ROLEPLAY_RESUME_MS))) {
    return buttonResult({
      messages: [text(acks.roleplayContinue(lang))],
      stateUpdate: { current_state: 'roleplay' },
      workflowDataPatch: { roleplay: { ...rp, active: true, last_turn_at: at, ended_at: null, end_reason: null } },
    });
  }
  const sector = sampleSector(rp?.sector || lead.sector);
  return buttonResult({
    messages: [text(roleplay.setupAsk(sector, lang))],
    stateUpdate: { current_state: 'roleplay_setup' },
    workflowDataPatch: { roleplay: roleplayObject(rp, { sector, setup_asks: 1 }) },
  });
}

function followupResult(answer, c) {
  const { wd, lang, now, messageId, locked } = c;
  const consent = consentRecord({ answer, text: acks.consentAsk(lang), msgId: messageId, now });
  // PR1 mergeLead keeps only known lead keys, so consent is stored beside the lead (contract §14 #7).
  if (answer === 'yes') {
    const due = new Date(now.getTime() + CONSENT_DELAY_MS);
    return buttonResult({
      messages: [text(acks.consentYes(lang))],
      workflowDataPatch: {
        lead_consent: consent,
        // The promise in consentYes is kept by staff: a task, not a bot send (G13).
        staff_tasks: appendStaffTask(wd, staffTask('followup_consent', CONSENT_TASK_SUMMARY, now, due)),
        nudge: null,
      },
      alert: { reason: 'needs_team', summary: CONSENT_TASK_SUMMARY },
    });
  }
  return buttonResult({
    messages: [text(acks.consentNo(lang))],
    stateUpdate: locked ? {} : { current_state: 'closed' },
    workflowDataPatch: { lead_consent: consent, followups: [], nudge: null },
  });
}

function nudgeNotNowResult(c) {
  const { lang, at, locked } = c;
  return buttonResult({
    action: 'NOT_NOW',
    messages: [text(acks.notNow(lang))],
    stateUpdate: locked ? {} : { current_state: 'closed' },
    workflowDataPatch: { not_now_at: at, followups: [], capture_pending: null, nudge: null },
  });
}

function pr2Result(id, c) {
  if (c.locked && LOCKED_REFUSED_RE.test(id)) {
    return buttonResult({ messages: [text(validators.stageFallback('handoff', c.lang))] });
  }
  const [head, arg] = id.split(':');
  switch (head) {
    case 'sector': return sectorResult(arg, c);
    case 'sample_roleplay': return sampleRoleplayResult(arg, c);
    case 'sample_page': return samplePageResult(arg, c);
    case 'sample_image': return sampleImageResult(arg, c);
    case 'send_sample_now': return sendSampleNowResult(c);
    case 'quote_written': return quoteWrittenResult(c);
    case 'lead_call': return leadCallResult(c);
    case 'end_roleplay': return endRoleplayResult(c);
    case 'roleplay_continue': return roleplayContinueResult(c);
    case 'followup_yes': return followupResult('yes', c);
    case 'followup_no': return followupResult('no', c);
    case 'nudge_not_now': return nudgeNotNowResult(c);
    default: return null;
  }
}

// Taps that belong to the example itself; any other tap is out of character and ends a live one (§3.2).
const ROLEPLAY_TAP_RE = /^(end_roleplay|roleplay_continue|sample_roleplay:)/;
const ROLEPLAY_STAGE_LIST = ['roleplay_setup', 'roleplay'];

/**
 * Review r2 #12: a tap on a slot, «احكي مع الفريق», «مش هلأ», a sector or a quote leaves the example. The live
 * object is ended with the tap (handoff / optout / done), and a stage still on the example moves to close,
 * so the next message is never answered in character while a real request is open.
 */
function endingRoleplay(id, result, c) {
  if (!roleplay.isActive(c.wd) || ROLEPLAY_TAP_RE.test(id)) return result;
  const patch = result.workflowDataPatch || {};
  if ('roleplay' in patch) return result;
  const reason = id === 'lead_talk' ? 'handoff' : ['nudge_not_now', 'followup_no'].includes(id) ? 'optout' : 'done';
  const out = { ...result, workflowDataPatch: { ...patch, roleplay: roleplay.endState(c.wd.roleplay, reason, c.now) } };
  const stage = result.stateUpdate?.current_state ?? c.conversation.current_state;
  if (ROLEPLAY_STAGE_LIST.includes(stage) && !c.locked) out.stateUpdate = { ...(result.stateUpdate || {}), current_state: 'close' };
  return out;
}

/** Every tap result records itself in last_bot (the sweeper plans nudges from it) — contract §9.1. */
function withLastBot(id, result, conversation, now) {
  const stage = result.stateUpdate?.current_state ?? conversation.current_state ?? null;
  const repaired = validators.repairNextStep(result, null, { stage, now }).result;
  const patch = { ...repaired.workflowDataPatch, last_bot: { ...repaired.workflowDataPatch.last_bot, button_id: id } };
  if (INTEREST_TAP_RE.test(id)) patch.msgs_since_interest = 0;
  return { ...result, workflowDataPatch: patch };
}

function handleButton(id, ctx = {}) {
  // Booking taps need the calendar (async): replyBatcher.answerTaps sends them to booking.handleBookingTap.
  if (!isShiftButtonId(id) || booking.isBookingId(id)) return null;
  const { business = { ai_config: {} }, conversation = { workflow_data: {} }, now = new Date(), messageId = null } = ctx;
  const wd = conversation.workflow_data || {};
  const lead = wd.lead || {};
  const lang = ctx.lang || acks.pickLanguage(lead, '');
  const teamHours = hours.resolveTeamHours(business.ai_config);
  const at = now.toISOString();
  const c = {
    ...ctx, business, conversation, now, messageId, wd, lead, lang, teamHours, at,
    roleplayOn: typeof ctx.roleplayOn === 'boolean' ? ctx.roleplayOn : roleplay.roleplayEnabled(),
    locked: stageLocked(conversation),
  };
  const r = routeButton(id, c);
  return r ? withLastBot(id, endingRoleplay(id, r, c), conversation, now) : null;
}

function routeButton(id, c) {
  const { business, conversation, now, messageId, wd, lead, lang, teamHours, at } = c;
  if (PR2_ID_RE.test(id)) return pr2Result(id, c);

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

// ─── boot-time guard ─────────────────────────────────────────────────────────

function checkTitle(title, max, where) {
  const n = codePoints(String(title == null ? '' : title).trim());
  if (n < 1 || n > max) throw new Error(`shift buttons: ${where} title "${title}" is ${n} code points (max ${max})`);
}

function checkId(id, where) {
  if (!isShiftButtonId(id)) throw new Error(`shift buttons: ${where} has an unroutable id "${id}"`);
}

function checkPartButtons(part, where) {
  if (!part || typeof part !== 'object') return;
  for (const b of Array.isArray(part.buttons) ? part.buttons : []) {
    checkTitle(b.title, MAX_TITLE, where);
    checkId(b.id, where);
  }
  if (part.type === 'cta_url') checkTitle(part.displayText, MAX_TITLE, `${where} displayText`);
  if (part.header && part.header.type === 'text') checkTitle(part.header.text, MAX_HEADER, `${where} header`);
  if (part.footer !== undefined) checkTitle(part.footer, MAX_HEADER, `${where} footer`);
  if (part.fallback) checkPartButtons(part.fallback, `${where} fallback`);
}

// followups.js is a Layer-2 sibling that may be absent in a partial build; only its absence is tolerated.
function loadFollowups() {
  try {
    return require('./followups');
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes('./followups')) return null;
    throw err;
  }
}

const NUDGE_KINDS = ['stage', 'sample_touch', 'sample', 'roleplay_resume', 'close_declined', 'no_contact'];

function nudgeParts(followups, sector, lang) {
  if (!followups || typeof followups.nudgePart !== 'function') return [];
  const out = [];
  for (const kind of NUDGE_KINDS) {
    const conversation = {
      id: 'assert', status: 'open', current_state: kind === 'sample' || kind === 'sample_touch' ? 'sample' : 'fit',
      workflow_data: {
        lead: { sector, name: 'X', business_name: 'X', need: ['X'] },
        roleplay: { active: false, sector, business_name: 'X', end_reason: 'idle' },
        samples_sent: { image: null, page: null, accepted_at: null },
      },
    };
    let part = null;
    try {
      part = followups.nudgePart(conversation, { kind, stage: conversation.current_state }, lang);
    } catch (err) {
      // A shape this synthetic conversation does not satisfy is not a title violation.
      part = null;
    }
    if (part) out.push([kind, part]);
  }
  return out;
}

/**
 * Boot-time guard: every title the bot can put on a button, list row or CTA fits WhatsApp's limits and
 * every id routes back to handleButton. Slot titles are walked over a fortnight in 30-minute steps; the
 * static PR2 copy (sector list, consent, sample cards in both role-play modes, pages, nudges) in both
 * languages. Throws on the first violation.
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

  // PR3 booking offers: every 30-minute start over a fortnight, both languages, plus the fixed controls.
  for (let step = 0; step < 14 * 48; step++) {
    const at = new Date(base + step * 30 * 60 * 1000);
    for (const lang of ['ar', 'en']) {
      const title = booking.offerTitle(at, new Date(base), th.tz, lang);
      checkTitle(title, MAX_TITLE, 'booking offer');
      checkId(booking.bookId(at), 'booking offer');
    }
  }
  for (const b of booking.staticButtons()) {
    checkTitle(b.title, MAX_TITLE, 'booking');
    checkId(b.id, 'booking');
  }

  const followups = loadFollowups();
  if (followups && typeof followups.staticTitles === 'function') {
    for (const title of followups.staticTitles()) checkTitle(title, MAX_TITLE, 'nudge');
  }
  for (const lang of ['ar', 'en']) {
    checkTitle(acks.sectorListLabel(lang), MAX_TITLE, 'sector list label');
    checkTitle(acks.sectorListSectionTitle(lang), MAX_ROW_TITLE, 'sector list section');
    for (const row of acks.sectorListRows(lang)) {
      checkTitle(row.title, MAX_ROW_TITLE, 'sector list row');
      if (row.description !== undefined) checkTitle(row.description, MAX_ROW_DESCRIPTION, 'sector list row description');
      checkId(row.id, 'sector list row');
    }
    for (const b of acks.consentButtons(lang)) {
      checkTitle(b.title, MAX_TITLE, 'consent');
      checkId(b.id, 'consent');
    }
    for (const sector of assets.SAMPLE_SECTORS) {
      for (const roleplayOn of [true, false]) {
        checkPartButtons(assets.sampleCard(sector, lang, { roleplayOn }), `sample card ${sector}/${lang}`);
      }
      checkPartButtons(assets.pagePart(sector, lang), `page ${sector}/${lang}`);
      for (const [kind, part] of nudgeParts(followups, sector, lang)) checkPartButtons(part, `nudge ${kind}/${sector}/${lang}`);
    }
  }
}

module.exports = {
  SLOT_OFFER_TTL_MS,
  SLOT_ID_RE,
  PR2_ID_RE,
  DISCOVERY_Q1,
  parseSlotId,
  isShiftButtonId,
  slotOffers,
  handleButton,
  consentRecord,
  staffTask,
  roleplayObject,
  samplesSent,
  assertButtons,
  stageLocked,
  endingRoleplay,
};
