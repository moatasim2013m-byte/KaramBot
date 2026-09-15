/**
 * Turns the model's validated JSON (or null on AI failure) into a WorkflowResult.
 *
 * The model writes the conversational line; the server decides state and appends every factual ack
 * («سجّلت طلبك…») itself, so the customer is never told something happened that did not. Nothing
 * here writes to the DB — the batcher persists the state first and only then sends.
 */

const acks = require('./acks');
const hours = require('./hours');
const handoff = require('./handoff');
const buttons = require('./buttons');
const { mergeLead, extractCustomerNumbers, normalize } = require('./lead');
const { SHIFT_ACTIONS, MODEL_STAGES, FLAG_REASONS } = require('./actions');
const { SITE_HOST } = require('../../config/site');

// unsent_reply (D18): the bot's reply to the customer could not be confirmed twice, so the customer may
// have nothing at all — more urgent than any request the customer made.
const NEEDS_TEAM_PRIORITY = { unsent_reply: 6, person: 5, complaint: 5, meeting: 4, quote: 3, demo: 2, unknown: 1, ai_failure: 0 };
// `unsupported` (view-once media, polls…) is answered like media: the bot cannot read it either.
const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker', 'unsupported'];
const TEXT_LIMIT = 4096;
const INTERACTIVE_LIMIT = 1024;
const LOCKED_STAGES = ['handoff', 'captured'];
// The reply already tells the customer the bot reads text only. Naming the attachment («شفت الصورة»)
// is not that: it may be the model pretending it saw it.
const TEXT_ONLY_RE = /بقرأ النص بس|بقرا النص بس|read text only|only read text/i;

function priorityOf(reason) {
  return Object.prototype.hasOwnProperty.call(NEEDS_TEAM_PRIORITY, reason) ? NEEDS_TEAM_PRIORITY[reason] : NEEDS_TEAM_PRIORITY.unknown;
}

/**
 * The stored needs_team is replaced only when missing, resolved, claimed, or of strictly lower
 * priority. A claimed entry belongs to a finished takeover: the bot only runs again after «إرجاع
 * للبوت», so a new request must start fresh (its own SLA note, not the earlier staff member's claim).
 */
function mergeNeedsTeam(existing, next) {
  if (!next) return null;
  if (!existing || typeof existing !== 'object' || existing.resolved_at || existing.claimed_at) return next;
  return priorityOf(existing.reason) < priorityOf(next.reason) ? next : null;
}

function needsTeamEntry(reason, summary, at) {
  return {
    reason,
    summary: String(summary || '').slice(0, 200),
    at,
    resolved_at: null,
    sla_note_sent_at: null,
    claimed_at: null,
    claimed_by: null,
  };
}

function sanitizeButtons(list, offers) {
  if (!Array.isArray(list) || !Array.isArray(offers)) return [];
  const out = [];
  for (const b of list) {
    const offer = b && offers.find((o) => o.id === b.id);
    if (!offer || out.some((o) => o.id === offer.id)) continue;
    out.push({ id: offer.id, title: offer.title });
    if (out.length === 3) break;
  }
  return out;
}

/**
 * Handed off or captured with the team's request still open (pending): the bot answers as a concierge
 * and only staff move the stage on. Once staff resolve or release it the conversation is open again
 * and continues like any other, so a prospect who comes back is not stuck at «تحويل» for good.
 */
function isStageLocked(conversation) {
  return !!conversation && LOCKED_STAGES.includes(conversation.current_state) && conversation.status === 'pending';
}

function nextStage(current, proposed, action, locked = LOCKED_STAGES.includes(current)) {
  if (action === 'OPT_OUT' || action === 'NOT_NOW') return 'closed';
  if (action === 'HANDOFF_TO_HUMAN') return 'handoff';
  if (action === 'CAPTURE_TIME') return 'captured';
  if (locked) return undefined;
  if (MODEL_STAGES.includes(proposed) && proposed !== 'closed') return proposed;
  if (!current) return 'opening';
  return undefined;
}

function cutCodePoints(s, max) {
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('') : s;
}

/** `[modelLine, ack]` joined by a blank line; over the limit the model line is cut, never the ack. */
function compose(modelLine, ack, limit = TEXT_LIMIT) {
  const tail = ack || '';
  let line = modelLine || '';
  if (line && tail) {
    const room = limit - Array.from(tail).length - 2;
    line = room > 0 ? cutCodePoints(line, room).trim() : '';
  } else if (line) {
    line = cutCodePoints(line, limit);
  }
  return [line, cutCodePoints(tail, limit)].filter(Boolean).join('\n\n');
}

function textMessage(modelLine, ack) {
  return { type: 'text', text: compose(modelLine, ack, TEXT_LIMIT) };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function preferredTimeText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (isPlainObject(value) && typeof value.text === 'string') return value.text.trim() || null;
  return null;
}

function emptyResult(fields) {
  return {
    kind: 'reply',
    action: 'NONE',
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

/** Fill the optional ctx so toWorkflowResult can be called with the AI result alone (tests, scripts). */
function fillCtx(ctx = {}) {
  const business = ctx.business || { ai_config: {} };
  const conversation = ctx.conversation || { status: 'open', workflow_data: {} };
  const batchMessages = Array.isArray(ctx.batchMessages) ? ctx.batchMessages : [];
  const now = ctx.now instanceof Date ? ctx.now : new Date(ctx.now || Date.now());
  const wd = conversation.workflow_data || {};
  const joinedText = typeof ctx.joinedText === 'string'
    ? ctx.joinedText
    : batchMessages.map((m) => m.text_body || '').join('\n');
  const lang = ctx.lang || 'ar';
  const teamHours = ctx.teamHours || hours.resolveTeamHours(business.ai_config);
  const offers = Array.isArray(ctx.offers) ? ctx.offers : buttons.slotOffers(teamHours, now, lang);
  const newest = ctx.newest || batchMessages[batchMessages.length - 1] || null;
  return { ...ctx, business, conversation, batchMessages, now, lang, teamHours, offers, newest, joinedText, wd };
}

function modelLeadMeta(c) {
  return { source: 'model', msgId: c.newest?.id ?? null, at: c.now.toISOString(), inboundText: c.joinedText };
}

/** The stored call time is the one the customer asked for (a tapped slot by id/start, text otherwise). */
function isStoredTime(stored, requested) {
  if (!isPlainObject(stored) || !isPlainObject(requested)) return false;
  if (requested.slot_id) return stored.slot_id === requested.slot_id;
  if (requested.start) return stored.start === requested.start;
  return !!requested.text && normalize(stored.text || '') === normalize(requested.text);
}

/**
 * D26 / GPT-6 #12: the capture ack as the lead actually stands. The batcher calls this again with the
 * lead saveLead returned, so «سجّلت طلب مكالمة: الخميس 5» is only said when that time was stored. A
 * staff-owned time is never overwritten by the bot: the customer is told the new time was passed to
 * the team, and the request is kept in `requested_time_change` for staff (the lead card keeps theirs).
 */
function renderCaptureAck(capture, storedLead) {
  const lead = isPlainObject(storedLead) ? storedLead : {};
  const relayed = !isStoredTime(lead.preferred_time, capture.requested);
  const ack = relayed
    ? acks.captureRelayed({ when: capture.when, lang: capture.lang })
    : acks.captureAck({ name: lead.name, businessName: lead.business_name, when: capture.when, lang: capture.lang });
  return {
    relayed,
    messages: [textMessage(capture.modelLine, ack)],
    workflowDataPatch: relayed
      ? { requested_time_change: { text: capture.requested?.text || capture.when, at: capture.at } }
      : {},
  };
}

function captureResult(ctx, { preferredTime, timeText, modelLine, leadPatch } = {}) {
  const c = fillCtx(ctx);
  const at = c.now.toISOString();
  const patch = {
    ...(leadPatch || {}),
    preferred_time: preferredTime || leadPatch?.preferred_time || { text: timeText },
  };
  // The ack below names this time, so it must be stored even over an earlier confirmed one («خليها
  // الخميس» carries no correction word): the capture is the customer's explicit statement of it.
  const leadMeta = { ...modelLeadMeta(c), trusted: ['preferred_time'] };
  const lead = mergeLead(c.wd.lead || {}, patch, leadMeta).lead;
  // The requested time in its stored shape (a merge into an empty lead normalises it).
  const requested = mergeLead({}, { preferred_time: patch.preferred_time }, leadMeta).lead.preferred_time || null;
  const when = preferredTime?.start
    ? acks.windowText(preferredTime, c.now, preferredTime.tz || c.teamHours.tz, c.lang)
    : (timeText || preferredTimeText(preferredTime) || '');
  const existing = c.wd.needs_team;
  const entry = needsTeamEntry('meeting', when, at);
  const needs = mergeNeedsTeam(existing, entry);
  let needsTeamMerge = null;
  if (!needs && existing && existing.reason === 'meeting' && existing.summary !== entry.summary) {
    // Same request, new time: the team's item must show the time the customer was just told was noted.
    // Only the summary is merged, into needs_team as stored at write time: this copy was read before
    // the model call, and spreading it would wipe a flag the sweeper or staff set meanwhile.
    const match = { reason: 'meeting', at: existing.at };
    if ('resolved_at' in existing) match.resolved_at = null;
    if ('claimed_at' in existing) match.claimed_at = null;
    needsTeamMerge = { match, patch: { summary: entry.summary }, entry };
  }
  // A preview from the lead as read before the model call; the batcher re-renders it from `capture`
  // with the lead saveLead persisted, which is what the customer is told.
  const capture = { requested, when, lang: c.lang, modelLine: modelLine || null, at };
  const preview = renderCaptureAck(capture, lead);

  return emptyResult({
    kind: 'reply',
    action: 'CAPTURE_TIME',
    messages: preview.messages,
    stateUpdate: { status: 'pending', current_state: 'captured' },
    workflowDataPatch: {
      capture_pending: null,
      bot_turns: (c.wd.bot_turns || 0) + 1,
      ...(needs && { needs_team: needs }),
      ...preview.workflowDataPatch,
    },
    leadPatch: patch,
    leadMeta,
    needsTeam: needs,
    // D27: re-merged against needs_team as stored at write time (a request resolved meanwhile).
    needsTeamCandidate: entry,
    needsTeamMerge,
    capture,
    alert: { reason: 'meeting', summary: when },
  });
}

function aiFailureResult(c) {
  const at = c.now.toISOString();
  // Slot buttons only mid-conversation and only while no time is chosen: offering a call on a bare
  // «مرحبا», or again right after the customer tapped a slot, read as broken (owner test, 2026-09-15).
  const timeChosen = Boolean(c.wd.lead?.preferred_time || c.wd.capture_pending);
  const withButtons = !isStageLocked(c.conversation) && c.conversation.current_state !== 'closed'
    && c.offers.length > 0 && (c.wd.bot_turns || 0) > 0 && !timeChosen;
  const candidate = needsTeamEntry('ai_failure', c.joinedText.slice(0, 200), at);
  const needs = mergeNeedsTeam(c.wd.needs_team, candidate);
  const workflowDataPatch = { bot_turns: (c.wd.bot_turns || 0) + 1 };
  if (needs) workflowDataPatch.needs_team = needs;
  let message;
  if (withButtons) {
    message = { type: 'interactive', text: acks.aiFailure(c.lang, { withButtons: true }), buttons: c.offers.map((o) => ({ id: o.id, title: o.title })) };
    workflowDataPatch.slot_offers = c.offers.map((o) => ({ id: o.id, title: o.title, issued_at: at }));
  } else {
    message = { type: 'text', text: acks.aiFailure(c.lang, { withButtons: false }) };
  }
  return emptyResult({
    kind: 'fallback',
    action: 'AI_FAILURE',
    messages: [message],
    stateUpdate: { status: 'pending' },
    workflowDataPatch,
    needsTeam: needs,
    needsTeamCandidate: candidate,
    alert: { reason: 'ai_failure', summary: c.joinedText.slice(0, 200) },
  });
}

/** A pending capture's slot: over once its window has ended or the tap is older than an offer may be. */
function slotExpired(slot, capturePending, now) {
  const nowMs = now.getTime();
  const endMs = slot.end ? new Date(slot.end).getTime() : NaN;
  if (Number.isFinite(endMs) && endMs <= nowMs) return true;
  const atMs = capturePending.at ? new Date(capturePending.at).getTime() : NaN;
  return Number.isFinite(atMs) && nowMs - atMs > buttons.SLOT_OFFER_TTL_MS;
}

function firstLine(s) {
  return (s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
}

function cleanLeadPatch(lead, c) {
  const inRoleplay = ['roleplay_setup', 'roleplay'].includes(c.conversation.current_state);
  if (inRoleplay) return null;
  const out = {};
  if (isPlainObject(lead)) {
    for (const [k, v] of Object.entries(lead)) {
      if (v === null || v === undefined || v === '') continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[k] = v;
    }
  }
  if (Object.keys(out).length) return out;
  // An empty patch still lets saveLead record the numbers the customer typed (the PR2 digit guard).
  return extractCustomerNumbers(c.joinedText).length ? {} : null;
}

function stateWith(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) out[k] = v;
  return out;
}

function toWorkflowResult(aiResult, ctx) {
  const c = fillCtx(ctx);
  const reply = aiResult && typeof aiResult.reply === 'string' ? aiResult.reply.trim() : '';
  const action = aiResult && SHIFT_ACTIONS.includes(aiResult.action) ? aiResult.action : 'NONE';
  // An empty line is as silent as a failure; OPT_OUT/NOT_NOW have their own fixed text.
  if (!aiResult || (!reply && !['OPT_OUT', 'NOT_NOW', 'HANDOFF_TO_HUMAN'].includes(action))) {
    return aiFailureResult(c);
  }

  const at = c.now.toISOString();
  const wd = c.wd;
  const lead = wd.lead || {};
  const args = isPlainObject(aiResult.action_args) ? aiResult.action_args : {};
  const stage = c.conversation.current_state;
  const locked = isStageLocked(c.conversation);
  let leadPatch = cleanLeadPatch(aiResult.lead, c);
  const leadMeta = modelLeadMeta(c);

  let modelLine = reply;
  // D13: any attachment in the batch, captioned or not, gets the «I read text only» line — the model
  // only saw a placeholder and must not sound as if it looked at the photo or heard the voice note.
  const mediaMessage = c.batchMessages.find((m) => MEDIA_TYPES.includes(m.message_type));
  if (mediaMessage && modelLine && !TEXT_ONLY_RE.test(modelLine)) {
    const separateText = c.batchMessages.some((m) => m.text_body && !MEDIA_TYPES.includes(m.message_type));
    const prefix = acks.mediaPrefix(mediaMessage.message_type, c.lang, { captioned: !separateText && !!mediaMessage.text_body });
    modelLine = `${prefix}\n${modelLine}`;
  }

  const common = { bot_turns: (wd.bot_turns || 0) + 1 };
  const disclosed = /مساعد شِفت|SHIFT's AI assistant/.test(reply) && reply.includes(SITE_HOST);
  if (!wd.disclosed_at && disclosed) common.disclosed_at = at;

  const finish = (r) => ({
    ...r,
    workflowDataPatch: { ...r.workflowDataPatch, ...common },
    leadPatch: r.leadPatch ?? leadPatch,
    leadMeta: r.leadMeta || leadMeta,
  });

  // A slot was tapped (or «وقت ثاني») and the bot asked for the missing details: this batch completes it.
  // A team request of another kind (a written quote) is not an answer to that ask: it takes the FLAG
  // path and the capture stays pending for the next message. A question in the batch keeps the
  // model's answer above the ack — the customer asked something, and silence on it reads as ignoring.
  const flagsOther = action === 'FLAG_FOR_TEAM' && args.reason !== 'meeting';
  const answerLine = /[؟?]/.test(c.joinedText) ? modelLine : null;
  if (wd.capture_pending && !['OPT_OUT', 'NOT_NOW', 'HANDOFF_TO_HUMAN'].includes(action) && !flagsOther) {
    const cp = wd.capture_pending;
    const storedSlot = cp.slot_id && cp.slot_id !== 'other' && lead.preferred_time?.slot_id === cp.slot_id
      ? lead.preferred_time
      : null;
    const expired = !!storedSlot && slotExpired(storedSlot, cp, c.now);
    let timeText = cp.time_text || preferredTimeText(aiResult.lead?.preferred_time) || preferredTimeText(args.time_text);
    // An echo of the expired slot's own wording is not a new time.
    if (expired && timeText && normalize(timeText) === normalize(storedSlot.text || '')) timeText = null;
    if (storedSlot && !expired) {
      return finish(captureResult(c, { preferredTime: storedSlot, modelLine: answerLine, leadPatch }));
    }
    if (timeText) {
      return finish(captureResult(c, { timeText, modelLine: answerLine, leadPatch: { ...(leadPatch || {}), preferred_time: timeText } }));
    }
    if (storedSlot) {
      // The tapped window is over (or the tap is stale): the same rule handleButton applies at tap time.
      return finish(emptyResult({
        action: 'NONE',
        messages: [textMessage(answerLine, acks.expiredSlot(c.lang))],
        stateUpdate: locked ? {} : { current_state: 'close' },
        workflowDataPatch: { capture_pending: { slot_id: null, time_text: null, at } },
      }));
    }
  }

  switch (action) {
    case 'FLAG_FOR_TEAM': {
      const reason = FLAG_REASONS.includes(args.reason) ? args.reason : 'unknown';
      if (reason === 'meeting') {
        const preview = mergeLead(lead, leadPatch || {}, leadMeta).lead;
        const timeText = preferredTimeText(args.time_text) || preferredTimeText(preview.preferred_time);
        if (timeText && (preview.name || preview.business_name)) {
          const slot = preview.preferred_time?.start ? preview.preferred_time : undefined;
          return finish(captureResult(c, { preferredTime: slot, timeText, modelLine, leadPatch }));
        }
      }
      const summary = String(args.summary || c.joinedText).slice(0, 200);
      const candidate = needsTeamEntry(reason, summary, at);
      const needs = mergeNeedsTeam(wd.needs_team, candidate);
      const stateUpdate = stateWith({ status: 'pending', current_state: nextStage(stage, aiResult.stage, action, locked) });
      if (!needs) {
        // Already on the team's list with an equal or higher priority: no second ack, no second alert.
        // The candidate still goes to the write: if staff resolved that request meanwhile, this one is
        // recorded instead of leaving the conversation pending with nothing open (GPT-6 #13).
        return finish(emptyResult({ action, messages: [textMessage(modelLine)], stateUpdate, needsTeamCandidate: candidate }));
      }
      return finish(emptyResult({
        action,
        messages: [textMessage(modelLine, acks.flagAck(reason === 'quote' ? 'quote' : 'other', { teamHours: c.teamHours, lang: c.lang }))],
        stateUpdate,
        workflowDataPatch: { needs_team: needs },
        needsTeam: needs,
        needsTeamCandidate: candidate,
        alert: { reason: reason === 'quote' ? 'quote' : 'needs_team', summary },
      }));
    }

    case 'HANDOFF_TO_HUMAN': {
      if (handoff.isHandoffOpen(c.conversation)) {
        return finish(emptyResult({ kind: 'handoff', action, messages: [textMessage(modelLine || acks.handoffRepeat(c.lang))] }));
      }
      const r = handoff.buildHandoff({
        business: c.business,
        conversation: c.conversation,
        now: c.now,
        lang: c.lang,
        teamHours: c.teamHours,
        reason: args.reason === 'person' ? 'person' : 'complaint',
        tier: 2,
        summary: args.summary || c.joinedText,
        modelLine: firstLine(reply) || acks.handoffLead(c.lang),
      });
      return finish(r);
    }

    case 'CAPTURE_TIME': {
      const timeText = preferredTimeText(args.time_text) || preferredTimeText(aiResult.lead?.preferred_time);
      // Re-stating the stored time keeps the stored object (a tapped slot's start/end/slot_id).
      const sameTime = timeText && isPlainObject(lead.preferred_time)
        && normalize(lead.preferred_time.text || '') === normalize(timeText);
      if (timeText) leadPatch = { ...(leadPatch || {}), preferred_time: sameTime ? lead.preferred_time : timeText };
      const preview = mergeLead(lead, leadPatch || {}, leadMeta).lead;
      if (timeText && (preview.name || preview.business_name)) {
        const slot = sameTime && lead.preferred_time.start ? lead.preferred_time : undefined;
        return finish(captureResult(c, { preferredTime: slot, timeText, modelLine, leadPatch }));
      }
      const text = /[؟?]/.test(modelLine)
        ? modelLine
        : acks.captureAsk({ nameKnown: !!preview.name, businessKnown: !!preview.business_name, sector: preview.sector, lang: c.lang });
      return finish(emptyResult({
        action,
        messages: [textMessage(text)],
        stateUpdate: locked ? {} : { current_state: 'close' },
        workflowDataPatch: { capture_pending: { slot_id: null, time_text: timeText || null, at } },
      }));
    }

    case 'NOT_NOW':
      return finish(emptyResult({
        action,
        messages: [textMessage(modelLine || acks.notNow(c.lang))],
        stateUpdate: { current_state: 'closed' },
        workflowDataPatch: { not_now_at: at, followups: [], capture_pending: null },
      }));

    case 'OPT_OUT':
      return finish(emptyResult({
        kind: 'optout',
        action,
        messages: [textMessage(acks.optOut(c.lang))],
        stateUpdate: { current_state: 'closed' },
        workflowDataPatch: { marketing_opted_out_at: at, followups: [], capture_pending: null },
      }));

    default: {
      const stateUpdate = stateWith({ current_state: nextStage(stage, aiResult.stage, 'NONE', locked) });
      // Concierge while the team's request is open (design §3.1/§7.1): no slot buttons, no pitch.
      const kept = locked ? [] : sanitizeButtons(aiResult.buttons, c.offers);
      if (kept.length) {
        return finish(emptyResult({
          action: 'NONE',
          messages: [{ type: 'interactive', text: compose(modelLine || acks.slotsBody(c.lang), '', INTERACTIVE_LIMIT), buttons: kept }],
          stateUpdate,
          workflowDataPatch: { slot_offers: kept.map((o) => ({ ...o, issued_at: at })) },
        }));
      }
      return finish(emptyResult({ action: 'NONE', messages: [textMessage(modelLine)], stateUpdate }));
    }
  }
}

module.exports = {
  NEEDS_TEAM_PRIORITY,
  MEDIA_TYPES,
  mergeNeedsTeam,
  needsTeamEntry,
  sanitizeButtons,
  nextStage,
  isStageLocked,
  captureResult,
  renderCaptureAck,
  toWorkflowResult,
  compose,
};
