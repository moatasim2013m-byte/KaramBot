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
const { mergeLead, extractCustomerNumbers } = require('./lead');
const { SHIFT_ACTIONS, MODEL_STAGES, FLAG_REASONS } = require('./actions');
const { SITE_HOST } = require('../../config/site');

const NEEDS_TEAM_PRIORITY = { person: 5, complaint: 5, meeting: 4, quote: 3, demo: 2, unknown: 1, ai_failure: 0 };
const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker'];
const TEXT_LIMIT = 4096;
const INTERACTIVE_LIMIT = 1024;
const LOCKED_STAGES = ['handoff', 'captured'];
const MEDIA_MENTION_RE = /صوت|صورة|فيديو|ملف|ملصق|voice|image|photo|video|file|sticker/i;

function priorityOf(reason) {
  return Object.prototype.hasOwnProperty.call(NEEDS_TEAM_PRIORITY, reason) ? NEEDS_TEAM_PRIORITY[reason] : NEEDS_TEAM_PRIORITY.unknown;
}

/** The stored needs_team is replaced only when missing, resolved, or of strictly lower priority. */
function mergeNeedsTeam(existing, next) {
  if (!next) return null;
  if (!existing || typeof existing !== 'object' || existing.resolved_at) return next;
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

function nextStage(current, proposed, action) {
  if (action === 'OPT_OUT' || action === 'NOT_NOW') return 'closed';
  if (action === 'HANDOFF_TO_HUMAN') return 'handoff';
  if (action === 'CAPTURE_TIME') return 'captured';
  // Once handed off or captured, only staff /release moves the stage.
  if (LOCKED_STAGES.includes(current)) return undefined;
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

function captureResult(ctx, { preferredTime, timeText, modelLine, leadPatch } = {}) {
  const c = fillCtx(ctx);
  const at = c.now.toISOString();
  const patch = {
    ...(leadPatch || {}),
    preferred_time: preferredTime || leadPatch?.preferred_time || { text: timeText },
  };
  const lead = mergeLead(c.wd.lead || {}, patch, modelLeadMeta(c)).lead;
  const when = preferredTime?.start
    ? acks.windowText(preferredTime, c.now, preferredTime.tz || c.teamHours.tz, c.lang)
    : (timeText || preferredTimeText(preferredTime) || '');
  const needs = mergeNeedsTeam(c.wd.needs_team, needsTeamEntry('meeting', when, at));
  const ack = acks.captureAck({ name: lead.name, businessName: lead.business_name, when, lang: c.lang });

  return emptyResult({
    kind: 'reply',
    action: 'CAPTURE_TIME',
    messages: [textMessage(modelLine, ack)],
    stateUpdate: { status: 'pending', current_state: 'captured' },
    workflowDataPatch: {
      capture_pending: null,
      bot_turns: (c.wd.bot_turns || 0) + 1,
      ...(needs && { needs_team: needs }),
    },
    leadPatch: patch,
    leadMeta: modelLeadMeta(c),
    needsTeam: needs,
    alert: { reason: 'meeting', summary: when },
  });
}

function aiFailureResult(c) {
  const at = c.now.toISOString();
  const withButtons = !['handoff', 'captured', 'closed'].includes(c.conversation.current_state) && c.offers.length > 0;
  const needs = mergeNeedsTeam(c.wd.needs_team, needsTeamEntry('ai_failure', c.joinedText.slice(0, 200), at));
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
    alert: { reason: 'ai_failure', summary: c.joinedText.slice(0, 200) },
  });
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
  let leadPatch = cleanLeadPatch(aiResult.lead, c);
  const leadMeta = modelLeadMeta(c);

  let modelLine = reply;
  const mediaMessage = c.batchMessages.find((m) => MEDIA_TYPES.includes(m.message_type) && !m.text_body);
  const hasText = c.batchMessages.some((m) => m.text_body);
  if (mediaMessage && hasText && modelLine && !MEDIA_MENTION_RE.test(modelLine)) {
    modelLine = `${acks.mediaPrefix(mediaMessage.message_type, c.lang)}\n${modelLine}`;
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
  if (wd.capture_pending && !['OPT_OUT', 'NOT_NOW', 'HANDOFF_TO_HUMAN'].includes(action)) {
    const cp = wd.capture_pending;
    const storedSlot = cp.slot_id && cp.slot_id !== 'other' && lead.preferred_time?.slot_id === cp.slot_id
      ? lead.preferred_time
      : null;
    const timeText = cp.time_text || preferredTimeText(aiResult.lead?.preferred_time) || preferredTimeText(args.time_text);
    if (storedSlot) {
      return finish(captureResult(c, { preferredTime: storedSlot, modelLine: null, leadPatch }));
    }
    if (timeText) {
      return finish(captureResult(c, { timeText, modelLine: null, leadPatch: { ...(leadPatch || {}), preferred_time: timeText } }));
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
      const needs = mergeNeedsTeam(wd.needs_team, needsTeamEntry(reason, summary, at));
      const stateUpdate = stateWith({ status: 'pending', current_state: nextStage(stage, aiResult.stage, action) });
      if (!needs) {
        // Already on the team's list with an equal or higher priority: no second ack, no second alert.
        return finish(emptyResult({ action, messages: [textMessage(modelLine)], stateUpdate }));
      }
      return finish(emptyResult({
        action,
        messages: [textMessage(modelLine, acks.flagAck(reason === 'quote' ? 'quote' : 'other', { teamHours: c.teamHours, lang: c.lang }))],
        stateUpdate,
        workflowDataPatch: { needs_team: needs },
        needsTeam: needs,
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
      if (timeText) leadPatch = { ...(leadPatch || {}), preferred_time: timeText };
      const preview = mergeLead(lead, leadPatch || {}, leadMeta).lead;
      if (timeText && (preview.name || preview.business_name)) {
        return finish(captureResult(c, { timeText, modelLine, leadPatch }));
      }
      const text = /[؟?]/.test(modelLine)
        ? modelLine
        : acks.captureAsk({ nameKnown: !!preview.name, businessKnown: !!preview.business_name, sector: preview.sector, lang: c.lang });
      return finish(emptyResult({
        action,
        messages: [textMessage(text)],
        stateUpdate: LOCKED_STAGES.includes(stage) ? {} : { current_state: 'close' },
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
      const stateUpdate = stateWith({ current_state: nextStage(stage, aiResult.stage, 'NONE') });
      const kept = sanitizeButtons(aiResult.buttons, c.offers);
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
  captureResult,
  toWorkflowResult,
  compose,
};
