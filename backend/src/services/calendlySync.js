'use strict';

/**
 * Calendly booking detection — one step of the internal sweep (shiftSweeper STEPS, the endpoint Cloud
 * Scheduler already calls with INTERNAL_SWEEP_TOKEN, plus the in-process backup timer).
 *
 * Calendly is connected to the SHIFT sales calendar (SHIFT_SALES_CALENDAR_ID), so every Calendly booking is
 * a Google event there. Each run lists the events changed since the stored cursor (updatedMin, showDeleted,
 * singleEvents), skips the bot's own events (extendedProperties.private) and anything that is not
 * Calendly's, and turns the rest into the conversation's booking in PR3's record shape (status, event_id,
 * start/end, reminders, history) with source 'calendly' and the invitee's cancel / reschedule URLs.
 *
 * Honesty and safety:
 * - A booking exists only once its event is on the calendar. The link alone never made one.
 * - Idempotent: a conversation's stored booking already describing an event is not written again, and every
 *   side effect (staff alert, customer message) is claimed once per (event, status, start) in the
 *   conversation's metadata (`calendly_ev:<id>`). Customer messages are send intents keyed the same way.
 * - The customer is messaged only inside the 24 h window (Calendly's own email covers the rest).
 * - Never throws into the sweep; a failure here cannot touch message handling.
 * - Every Calendly event seen is logged as a PII-free shape summary so the first real booking verifies
 *   the parser.
 *
 * Cursor: businesses.ai_config.calendly_sync = {cursor, unmatched: [event ids already alerted]}, advanced with
 * a compare-and-set (jsonb.casBusinessConfig). Each list overlaps the previous one by OVERLAP_MS.
 */

const prisma = require('../config/prisma');
const jsonb = require('../db/jsonb');
const calendar = require('./googleCalendar');
const replyBatcher = require('./replyBatcher');
const { sendStaffAlert } = require('./alerts');
const { isWithinServiceWindow } = require('../utils/serviceWindow');
const calendly = require('../workflows/shift/calendly');
const booking = require('../workflows/shift/booking');
const acks = require('../workflows/shift/acks');
const hours = require('../workflows/shift/hours');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const STATE_KEY = 'calendly_sync';
// Each list starts this far before the cursor: Google's `updated` and our clock may disagree a little.
const OVERLAP_MS = 5 * MINUTE_MS;
// No cursor yet (first run): look this far back.
const FIRST_LOOKBACK_MS = 24 * HOUR_MS;
// A cursor older than this is not trusted (Google answers 410 for an updatedMin too far back).
const MAX_CURSOR_AGE_MS = 7 * 24 * HOUR_MS;
const MAX_PAGES = 5;
// Conversations whose stored booking a cancelled event may belong to (a booking can be weeks ahead).
const EVENT_LOOKUP_LOOKBACK_MS = 60 * 24 * HOUR_MS;
const NAME_LOOKBACK_MS = 3 * 24 * HOUR_MS;
const UNMATCHED_CAP = 200;
const HISTORY_CAP = 10;
const STAFF_TASKS_CAP = 20;
const REPLY_WINDOW_MARGIN_MS = 60 * 1000;
const DELIVERED = ['sent', 'ambiguous', 'deduped'];

function toMs(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  return Date.parse(v);
}

function workflowData(conv) {
  return conv && conv.workflow_data && typeof conv.workflow_data === 'object' ? conv.workflow_data : {};
}

function syncState(business) {
  const cfg = (business && business.ai_config) || {};
  const s = cfg[STATE_KEY];
  return s && typeof s === 'object' ? s : null;
}

/** Whether this business has Calendly detection to run: a Calendly URL and the sales calendar. */
function enabledFor(business, env = process.env) {
  if (env.CALENDLY_SYNC === '0') return false;
  const s = calendly.settings(business);
  return !!s.url && booking.bookingConfig(business, env).configured;
}

function claimKey(eventId) {
  return `calendly_ev:${eventId}`;
}

function claimValueOf(parsed) {
  return `${parsed.status}|${parsed.start || ''}`;
}

function emptyCounts() {
  return { listed: 0, calendly: 0, booked: 0, rescheduled: 0, cancelled: 0, unmatched: 0, low_confidence: 0, confirmations: 0, skipped_window: 0, errors: 0 };
}

// ─── listing ─────────────────────────────────────────────────────────────────

async function listChanged(calendarId, updatedMin, now) {
  const events = [];
  let pageToken = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const r = await calendar.listEvents(calendarId, { updatedMin, showDeleted: true, singleEvents: true, pageToken, now });
    if (!r.ok) return r;
    events.push(...r.events);
    if (!r.nextPageToken) return { ok: true, events, complete: true };
    pageToken = r.nextPageToken;
  }
  return { ok: true, events, complete: false };
}

// ─── matching ────────────────────────────────────────────────────────────────

async function conversationByPhone(business, phone) {
  if (!phone) return null;
  return prisma.conversation.findFirst({ where: { business_id: business.id, customer_wa_id: phone } });
}

async function recentConversations(business, now, lookbackMs) {
  return prisma.conversation.findMany({
    where: { business_id: business.id, last_message_at: { gte: new Date(now.getTime() - lookbackMs) } },
  });
}

/** Resolve every relevant event to {event, parsed, conv, match, candidate?}. */
async function resolveItems(business, events, now, counts) {
  const items = [];
  let byEvent = null;
  let recent = null;
  for (const event of events) {
    const parsed = calendly.parseEvent(event);
    if (!parsed.id || parsed.own) continue;
    if (parsed.status === 'cancelled') {
      // Cancelled events from an incremental list carry no description: they are known by the stored event id.
      if (!byEvent) {
        byEvent = new Map();
        for (const c of await recentConversations(business, now, EVENT_LOOKUP_LOOKBACK_MS)) {
          const b = workflowData(c).booking;
          if (b && b.event_id) byEvent.set(b.event_id, c);
        }
      }
      const conv = byEvent.get(parsed.id) || null;
      const b = conv && workflowData(conv).booking;
      if (!conv || !b || b.source !== 'calendly') continue;
      counts.calendly += 1;
      console.log(`[calendly] event shape ${JSON.stringify(calendly.shapeSummary(parsed))}`);
      items.push({ event, parsed, conv, match: 'event' });
      continue;
    }
    if (!parsed.calendly) continue;
    counts.calendly += 1;
    console.log(`[calendly] event shape ${JSON.stringify(calendly.shapeSummary(parsed))}`);
    const conv = await conversationByPhone(business, parsed.phone);
    if (conv) {
      items.push({ event, parsed, conv, match: 'phone' });
      continue;
    }
    // No phone match: a name-only match within 48 h of a link is low-confidence (staff decide).
    if (!recent) recent = await recentConversations(business, now, NAME_LOOKBACK_MS);
    // (Also when a phone was given but matches no conversation: a mistyped number is the likely story.)
    const candidates = calendly.nameCandidates(recent, parsed, now);
    items.push({ event, parsed, conv: null, match: candidates.length === 1 ? 'name' : null, candidate: candidates.length === 1 ? candidates[0] : null });
  }
  return items;
}

// ─── the booking record (PR3's shape) ────────────────────────────────────────

function history(prev, entry) {
  const list = prev && Array.isArray(prev.history) ? prev.history : [];
  return list.concat([entry]).slice(-HISTORY_CAP);
}

function leadLang(conv) {
  const wd = workflowData(conv);
  const l = wd.lead && wd.lead.language;
  if (l === 'en' || l === 'ar') return l;
  const b = wd.booking;
  return b && b.lang === 'en' ? 'en' : 'ar';
}

/**
 * The conversation's booking for a Calendly event. `previous` (a reschedule or a moved event) keeps
 * booked_at and the history; a new start gets fresh reminders (they are keyed on event id and start).
 */
function bookingRecord({ parsed, previous, rescheduled, conv, calendarId, tz, at }) {
  const status = rescheduled ? 'rescheduled' : 'booked';
  const createdMs = toMs(parsed.created);
  const bookedAt = Number.isFinite(createdMs) && createdMs <= toMs(at) ? new Date(createdMs).toISOString() : at;
  const keepReminders = previous && previous.event_id === parsed.id && toMs(previous.start) === toMs(parsed.start);
  return {
    event_id: parsed.id,
    calendar_id: calendarId,
    start: parsed.start,
    end: parsed.end,
    tz,
    status,
    booked_at: rescheduled && previous && previous.booked_at ? previous.booked_at : bookedAt,
    ...(rescheduled && { rescheduled_at: at }),
    seq: (Number(previous && previous.seq) || 0) + 1,
    offer_id: null,
    source_msg_id: null,
    lang: leadLang(conv),
    reminders: keepReminders ? (previous.reminders || {}) : {},
    // Never patched by the bot: Calendly owns this event's summary and description.
    details_pending: false,
    details_missing: [],
    source: 'calendly',
    cancel_url: parsed.cancelUrl || (keepReminders && previous.cancel_url) || null,
    reschedule_url: parsed.rescheduleUrl || (keepReminders && previous.reschedule_url) || null,
    calendly_updated: parsed.updated,
    ...(previous && previous.event_id && previous.event_id !== parsed.id && { previous_event_id: previous.event_id }),
    history: history(previous, { status, start: parsed.start, at, source: 'calendly', event_id: parsed.id }),
  };
}

// ─── side effects ────────────────────────────────────────────────────────────

async function claim(conv, parsed) {
  return jsonb.claimValue('conversations', conv.id, 'metadata', claimKey(parsed.id), claimValueOf(parsed));
}

/** The customer is told only inside the 24 h window, only when replies are allowed, never over staff. */
async function tellCustomer(business, conv, parsed, parts, kindLabel, now, counts) {
  if (!replyBatcher.isShiftReplyAllowed(business, conv.customer_wa_id)) return 'not_allowed';
  if (!isWithinServiceWindow(conv.last_inbound_at, now, { marginMs: REPLY_WINDOW_MARGIN_MS })) {
    counts.skipped_window += 1;
    return 'window_closed';
  }
  const dispatch = await replyBatcher.dispatchIntent({
    business,
    conversation: conv,
    kind: 'booking_confirm',
    parts,
    batchIds: [],
    batchKey: `calendly:${parsed.id}:${kindLabel}:${parsed.start || ''}`,
    since: new Date(now.getTime() - 7 * 24 * HOUR_MS),
    precheck: { humanGuard: true },
    now,
  });
  const outcome = dispatch && dispatch.outcome;
  if (DELIVERED.includes(outcome)) counts.confirmations += 1;
  return outcome;
}

async function alert(reason, business, conv, summary, now) {
  await sendStaffAlert({ reason, business, conversation: conv, summary: String(summary || '').slice(0, 300), now });
}

function whenAr(start, end, tz, now) {
  return acks.windowText({ start, end }, now, tz, 'ar');
}

function meetingEntry(summary, at) {
  // Lazy: results.js pulls in the whole reply pipeline.
  const { needsTeamEntry } = require('../workflows/shift/results');
  return needsTeamEntry('meeting', summary, at);
}

async function applyBooking(business, cfg, action, now, counts) {
  const { parsed, conv } = action;
  const at = now.toISOString();
  const tz = hours.resolveTeamHours(business.ai_config).tz;
  const rescheduled = action.type === 'rescheduled' || action.type === 'moved';
  const previous = action.previous && typeof action.previous === 'object' ? action.previous : null;
  const record = bookingRecord({ parsed, previous, rescheduled, conv, calendarId: cfg.salesCalendarId, tz, at });
  const summary = `${rescheduled ? 'تغيّر موعد المكالمة (Calendly)' : 'مكالمة محجوزة (Calendly)'}: ${whenAr(parsed.start, parsed.end, tz, now)}`;
  const stored = workflowData(conv).booking;
  if (!(stored && stored.event_id === record.event_id && stored.start === record.start && ['booked', 'rescheduled'].includes(stored.status))) {
    await jsonb.patchJson('conversations', conv.id, 'workflow_data', { booking: record, slot_offers: [], capture_pending: null, nudge: null });
    if (conv.status !== 'human_takeover') {
      const { NEEDS_TEAM_PRIORITY } = require('../workflows/shift/results');
      await jsonb.writeConversationState(conv.id, {
        status: 'pending',
        // A handoff stays the team's; anything else is a captured call.
        currentState: conv.current_state === 'handoff' ? undefined : 'captured',
        patch: {},
        needsTeam: meetingEntry(summary, at),
        priorities: NEEDS_TEAM_PRIORITY,
      });
    }
  }
  if (action.cancelled) await claim(conv, action.cancelled);
  if (!(await claim(conv, parsed))) return;
  counts[rescheduled ? 'rescheduled' : 'booked'] += 1;

  const other = previous && previous.event_id !== parsed.id && ['booked', 'rescheduled'].includes(previous.status)
    && toMs(previous.end) > now.getTime() && !action.cancelled;
  const was = rescheduled && previous && previous.start ? ` (كان ${whenAr(previous.start, previous.end, previous.tz || tz, now)})` : '';
  const note = other
    ? ` — عنده موعد ثاني ${previous.source === 'calendly' ? 'بـCalendly' : 'بالتقويم من البوت'} (${whenAr(previous.start, previous.end, previous.tz || tz, now)}) لسه قائم: راجعوه`
    : '';
  const urls = parsed.cancelUrl && parsed.rescheduleUrl ? '' : ' — روابط الإلغاء/التغيير مش موجودة بالحدث';
  await alert(rescheduled ? 'booking_rescheduled' : 'booking_booked', business, conv, `${summary}${was}${note}${urls}`, now);
  if (other) {
    await appendStaffTask(conv.id, {
      kind: 'calendly_duplicate', summary: `حجزين قائمين: راجعوا وألغوا القديم (${whenAr(previous.start, previous.end, previous.tz || tz, now)})`, at, due_at: at, done_at: null,
    });
  }

  const lang = leadLang(conv);
  const text = calendly.noticeText(rescheduled ? 'rescheduled' : 'booked', parsed.start, tz, lang);
  await tellCustomer(business, conv, parsed, [{ type: 'interactive', text, buttons: booking.confirmButtons(lang), serverButtons: true }],
    rescheduled ? 'rescheduled' : 'booked', now, counts);
}

async function applyRefresh(action) {
  const { parsed, conv, previous } = action;
  await jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'booking', {
    cancel_url: parsed.cancelUrl || previous.cancel_url || null,
    reschedule_url: parsed.rescheduleUrl || previous.reschedule_url || null,
    calendly_updated: parsed.updated,
  }, { match: { event_id: parsed.id, start: previous.start } });
}

async function applyCancel(business, action, now, counts) {
  const { parsed, conv, previous } = action;
  const at = now.toISOString();
  const tz = previous.tz || hours.resolveTeamHours(business.ai_config).tz;
  const merged = await jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'booking', {
    status: 'cancelled',
    cancelled_at: at,
    cancelled_by: 'calendly',
    history: history(previous, { status: 'cancelled', start: previous.start, at, source: 'calendly', event_id: parsed.id }),
  }, { match: { event_id: parsed.id, status: previous.status } });
  if (merged) {
    const nt = workflowData(conv).needs_team;
    if (nt && nt.reason === 'meeting' && !nt.resolved_at) {
      await jsonb.resolveNeedsTeam(conv.id, { match: { reason: 'meeting', at: nt.at }, resolvedAt: at });
    }
    if (conv.current_state === 'captured') {
      await prisma.conversation.updateMany({
        where: { id: conv.id, current_state: 'captured', status: { not: 'human_takeover' } },
        data: { current_state: 'close' },
      });
    }
  }
  if (!(await claim(conv, { ...parsed, start: previous.start }))) return;
  counts.cancelled += 1;
  await alert('booking_cancelled', business, conv, `انلغت المكالمة (Calendly): ${whenAr(previous.start, previous.end, tz, now)}`, now);
  const lang = leadLang(conv);
  await tellCustomer(business, conv, { ...parsed, start: previous.start },
    [{ type: 'text', text: calendly.noticeText('cancelled', previous.start, tz, lang) }], 'cancelled', now, counts);
}

async function appendStaffTask(conversationId, task) {
  const fresh = await prisma.conversation.findUnique({ where: { id: conversationId } });
  const list = Array.isArray(workflowData(fresh).staff_tasks) ? workflowData(fresh).staff_tasks : [];
  await jsonb.patchJson('conversations', conversationId, 'workflow_data', { staff_tasks: list.concat([task]).slice(-STAFF_TASKS_CAP) });
}

async function applyLowConfidence(business, action, now, counts) {
  const { parsed, conv } = action;
  if (!(await claim(conv, parsed))) return;
  counts.low_confidence += 1;
  const tz = hours.resolveTeamHours(business.ai_config).tz;
  await alert('calendly_check', business, conv,
    `حجز Calendly ${parsed.phone ? `برقم مختلف (+${parsed.phone})` : 'بدون رقم هاتف'}، الاسم بطابق هاي المحادثة (انبعتلها رابط الحجز): ${whenAr(parsed.start, parsed.end, tz, now)} — تأكدوا إنه نفس العميل؛ البوت ما أكد إشي`, now);
}

/** Once per event id, recorded in the business's sync state (no conversation to hold the claim). */
async function claimUnmatched(business, eventId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fresh = await prisma.business.findUnique({ where: { id: business.id } });
    const state = syncState(fresh) || {};
    const list = Array.isArray(state.unmatched) ? state.unmatched : [];
    if (list.includes(eventId)) return false;
    const next = { ...state, unmatched: list.concat([eventId]).slice(-UNMATCHED_CAP) };
    if (await jsonb.casBusinessConfig(business.id, STATE_KEY, syncState(fresh), next)) return true;
  }
  return false;
}

async function applyUnmatched(business, action, now, counts) {
  const { parsed } = action;
  if (!(await claimUnmatched(business, `${parsed.id}|${parsed.start}`))) return;
  counts.unmatched += 1;
  const tz = hours.resolveTeamHours(business.ai_config).tz;
  const who = parsed.name || parsed.email || '-';
  await alert('calendly_unmatched', business, { id: null, profile_name: who, customer_wa_id: parsed.phone || '-' },
    `حجز Calendly بدون محادثة واتساب مطابقة: ${whenAr(parsed.start, parsed.end, tz, now)}${parsed.phone ? '' : ' — ما في رقم بالحجز'}`, now);
}

async function applyAction(business, cfg, action, now, counts) {
  switch (action.type) {
    case 'booked':
    case 'rescheduled':
    case 'moved':
      return applyBooking(business, cfg, action, now, counts);
    case 'refresh':
      return applyRefresh(action);
    case 'cancelled':
      return applyCancel(business, action, now, counts);
    case 'low_confidence':
      return applyLowConfidence(business, action, now, counts);
    case 'unmatched':
      return applyUnmatched(business, action, now, counts);
    default:
      return null;
  }
}

// ─── the step ────────────────────────────────────────────────────────────────

function startFrom(state, now) {
  const cursorMs = state && state.cursor ? toMs(state.cursor) : NaN;
  if (!Number.isFinite(cursorMs) || now.getTime() - cursorMs > MAX_CURSOR_AGE_MS) return new Date(now.getTime() - FIRST_LOOKBACK_MS);
  return new Date(Math.min(cursorMs, now.getTime()) - OVERLAP_MS);
}

/**
 * One sync for one business. Returns the counts (also merged into the sweep report by the caller).
 * Never throws: every failure is logged and counted.
 */
async function syncBusiness(business, { now = new Date() } = {}) {
  const counts = emptyCounts();
  try {
    if (!enabledFor(business)) return { skipped: 'not_configured', ...counts };
    const cfg = booking.bookingConfig(business);
    const fresh = (await prisma.business.findUnique({ where: { id: business.id } })) || business;
    const state = syncState(fresh);
    const listStart = now;
    let listed = await listChanged(cfg.salesCalendarId, startFrom(state, now), now);
    if (!listed.ok && listed.error && listed.error.status === 410) {
      // updatedMin too long ago: start again from the first-run lookback.
      listed = await listChanged(cfg.salesCalendarId, new Date(now.getTime() - FIRST_LOOKBACK_MS), now);
    }
    if (!listed.ok) {
      counts.errors += 1;
      console.error(`[calendly] list failed business=${business.id} kind=${listed.error && listed.error.kind}`);
      return counts;
    }
    counts.listed = listed.events.length;
    const items = await resolveItems(business, listed.events, now, counts);
    const actions = calendly.planActions(items);
    let failedFrom = null;
    for (const action of actions) {
      try {
        await applyAction(business, cfg, action, now, counts);
      } catch (err) {
        counts.errors += 1;
        const u = toMs(action.parsed && action.parsed.updated);
        if (Number.isFinite(u)) failedFrom = failedFrom === null ? u : Math.min(failedFrom, u);
        console.error(`[calendly] ${action.type} failed business=${business.id}: ${err && err.message}`);
      }
    }
    // A failed event is listed again next time (the cursor stops just before it); an incomplete list too.
    let nextMs = listStart.getTime();
    if (failedFrom !== null) nextMs = Math.min(nextMs, failedFrom);
    if (!listed.complete) {
      const last = listed.events.map((e) => toMs(e && e.updated)).filter(Number.isFinite);
      if (last.length) nextMs = Math.min(nextMs, Math.max(...last));
    }
    const latest = syncState((await prisma.business.findUnique({ where: { id: business.id } })) || fresh);
    const prevCursorMs = latest && latest.cursor ? toMs(latest.cursor) : NaN;
    // Never move a cursor backwards past one another sweep advanced meanwhile (unless a failure needs a retry).
    if (!(Number.isFinite(prevCursorMs) && prevCursorMs >= nextMs && failedFrom === null)) {
      await jsonb.casBusinessConfig(business.id, STATE_KEY, latest, { ...(latest || {}), cursor: new Date(nextMs).toISOString() });
    }
    return counts;
  } catch (err) {
    counts.errors += 1;
    console.error(`[calendly] sync failed business=${business && business.id}: ${err && err.message}`);
    return counts;
  }
}

module.exports = {
  STATE_KEY,
  OVERLAP_MS,
  FIRST_LOOKBACK_MS,
  enabledFor,
  syncBusiness,
  bookingRecord,
  startFrom,
  claimKey,
};
