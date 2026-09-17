/**
 * SHIFT Sales Assistant Workflow
 *
 * Answers prospects who message SHIFT's own WhatsApp number (usually from an ad or the site).
 * processShiftBatch takes every customer message the batcher collected, decides whether the AI is
 * needed at all (media-only batches, a role-play exit and explicit "I want a person" requests are
 * answered deterministically), and returns one WorkflowResult. It never writes to the DB and never
 * sends: the batcher persists the state first and only then delivers the messages.
 *
 * PR2 (contract §10.1): prompt v2 (static system prompt + dynamic user turn), the site pre-fill, the
 * role-play sandbox and the validators. A model reply is checked before it can reach the customer;
 * a blocked reply is regenerated once with a hint when the deadline allows, and otherwise only the
 * model's line is replaced by a fixed stage line — state, acks and team alerts are always kept.
 * `SHIFT_PROMPT_V1=1` keeps PR1's prompt and action set (D2); the validators still run.
 */

const { generateValidatedAIReply } = require('../../ai/provider');
const prisma = require('../../config/prisma');
const acks = require('./acks');
const hours = require('./hours');
const handoff = require('./handoff');
const buttons = require('./buttons');
const roleplay = require('./roleplay');
const validators = require('./validators');
const prefillParser = require('./prefill');
const assets = require('./assets');
const context = require('./context');
const booking = require('./booking');
const objectives = require('./objectives');
const promptAr = require('./prompt.ar');
const { mergeLead } = require('./lead');
const { buildSystemPrompt, formatHistory, SHIFT_KNOWLEDGE } = require('./prompt');
const {
  toWorkflowResult, roleplayEndResult, isStageLocked, compose, MEDIA_TYPES, blockedReplyResult, slotOfferResult,
} = require('./results');
const { SHIFT_ACTIONS, NEXT_STEPS, actionSetFor } = require('./actions');

const HISTORY_LIMIT = 12;
const STAFF_ALERT_KIND = 'staff_alert';
const RETRY_HISTORY = 6;
// 30 s: attempt 1 is capped at 15 s, so 25 s left a hung first attempt only 10 s for the retry and two
// of the six 2026-09-17 sims spent the whole budget on two aborts and answered «تأخر ردّي». 30 s gives
// the retry a full 15 s (on a shrunk turn). Healthy calls are unaffected — p50 5.3 s, p90 12.1 s.
const AI_DEADLINE_MS = Number(process.env.SHIFT_AI_DEADLINE_MS) || 30000;
// Attempt B only when a whole model call still fits before the batch deadline (§10.1 step 10).
const MIN_REGENERATE_MS = 4000;
const VALIDATOR_BLOCKS_MAX = 20;
// Results the validators never see: fixed server text (§10.1 step 9, contract §14 #11).
const UNVALIDATED_KINDS = ['fallback', 'handoff', 'button', 'optout', 'media', 'skipped_reply'];
// Logged repairs that are not a block worth a weekly review.
const INFO_CODES = ['split', 'next_step'];
const ROLEPLAY_STAGES = ['roleplay_setup', 'roleplay'];
const OUT_OF_CHARACTER_ACTIONS = ['END_ROLEPLAY', 'HANDOFF_TO_HUMAN', 'OPT_OUT', 'NOT_NOW'];
const SECTOR_IDS = ['sector:clinic', 'sector:restaurant', 'sector:store', 'sector:other'];
// Outbound rows that never reached the customer (a first reply whose send failed is not an earlier reply).
const UNDELIVERED_STATUSES = ['failed', 'cancelled', 'ambiguous_unreconciled'];
// PR3: the calendar lookup runs before the model call and inside its deadline; a slow Google answer must not
// eat the reply's time. Past this budget the PR2 window offers are used.
const OFFERS_BUDGET_MS = 3000;
const QUESTION_ABOUT_NAME_RE = /اسم|name|المحل|المطعم|العيادة|المتجر|المنشأة|الشركة|business/i;

const MEDIA_PLACEHOLDERS = {
  ar: {
    audio: '[رسالة صوتية]', image: '[صورة]', video: '[فيديو]', document: '[ملف]', sticker: '[ملصق]', location: '[موقع]',
    unsupported: '[رسالة]',
  },
  en: {
    audio: '[voice note]', image: '[image]', video: '[video]', document: '[file]', sticker: '[sticker]', location: '[location]',
    unsupported: '[message]',
  },
};

function shiftMediaOf(message) {
  const sm = message && (message.shift_media || (message.raw_payload && message.raw_payload.shift_media));
  return sm && typeof sm === 'object' ? sm : null;
}

function batchLine(message, lang = 'ar') {
  // A transcribed voice note or image (SHIFT_MEDIA=1) is rendered by context.js, which also strips
  // header-like lines from the transcript.
  if (shiftMediaOf(message)?.status === 'ok') return context.batchLine(message, lang);
  const placeholders = MEDIA_PLACEHOLDERS[lang === 'en' ? 'en' : 'ar'];
  const text = message && typeof message.text_body === 'string' ? message.text_body : '';
  const type = message && message.message_type;
  // A captioned photo or file: the model should know the words came with an attachment.
  if (text) return MEDIA_TYPES.includes(type) && placeholders[type] ? `${placeholders[type]} ${text}` : text;
  return placeholders[type] || '';
}

function isMediaOnly(message) {
  return MEDIA_TYPES.includes(message.message_type) && !message.text_body;
}

function mediaEnabled() {
  return process.env.SHIFT_MEDIA === '1';
}

/** What the customer actually wrote or said: text bodies and transcripts (validators, language). */
function customerTexts(batchMessages) {
  const out = [];
  for (const m of batchMessages) {
    if (typeof m.text_body === 'string' && m.text_body.trim()) out.push(m.text_body);
    const sm = shiftMediaOf(m);
    if (sm && sm.status === 'ok' && typeof sm.text === 'string' && sm.text.trim()) out.push(sm.text);
  }
  return out;
}

function buildCtx(business, conversation, batchMessages, now) {
  const wd = conversation.workflow_data || {};
  const lead = wd.lead || {};
  const joinedText = batchMessages.map((m) => m.text_body || '').join('\n');
  const batchTexts = customerTexts(batchMessages);
  // §14 #10: the newest message decides, so a switch to English mid-conversation is honoured.
  const lang = validators.expectedLanguage(batchTexts, lead);
  const teamHours = hours.resolveTeamHours(business.ai_config);
  const offers = buttons.slotOffers(teamHours, now, lang);
  const newest = batchMessages[batchMessages.length - 1] || null;
  return {
    business,
    conversation,
    batchMessages,
    now,
    lang,
    teamHours,
    offers,
    newest,
    joinedText,
    batchTexts,
    roleplayOn: roleplay.roleplayEnabled(),
    vetted: assets.vettedSectors(business),
    v1: process.env.SHIFT_PROMPT_V1 === '1',
    mediaRows: batchMessages,
  };
}

function plainResult(fields) {
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

// ─── the validator loop ──────────────────────────────────────────────────────

function partButtonIds(part) {
  const ids = [];
  if (!part) return ids;
  for (const b of Array.isArray(part.buttons) ? part.buttons : []) if (b && b.id) ids.push(b.id);
  for (const s of Array.isArray(part.sections) ? part.sections : []) {
    for (const r of (s && Array.isArray(s.rows) ? s.rows : [])) if (r && r.id) ids.push(r.id);
  }
  return ids;
}

/**
 * §5.8: two questions pass only as the compound name + business ask («شو اسمك؟ واسم المحل؟»). Every
 * question must be about the name or the business: «اسمك واسم المطعم؟ وأي وقت بناسبك؟» is still trimmed.
 */
function isCompoundAsk(line) {
  const s = String(line || '');
  if (!validators.COMPOUND_ASK_RE.test(s)) return false;
  const questions = s.split(/[؟?]/).slice(0, -1).map((q) => q.split(/[.!\n]/).pop());
  return questions.length > 0 && questions.every((q) => QUESTION_ABOUT_NAME_RE.test(q));
}

function previewLead(lead, r) {
  if (!r.leadPatch) return lead;
  try {
    return mergeLead(lead, r.leadPatch, r.leadMeta || { source: 'model', inboundText: '' }).lead || lead;
  } catch (err) {
    return lead;
  }
}

/** `vctx` for validators.validateResult (§10.1). */
function buildVctx(r, ctx, { attempt, history, ai }) {
  const { conversation, batchMessages } = ctx;
  const wd = conversation.workflow_data || {};
  const wdp = r.workflowDataPatch || {};
  const lead = { ...previewLead(wd.lead || {}, r) };
  const estimates = wdp.site_estimates || wd.site_estimates || lead.site_estimates
    || (ctx.prefill && ctx.prefill.siteEstimates) || [];
  lead.site_estimates = Array.isArray(estimates) ? estimates : [];

  const patchedRoleplay = wdp.roleplay && typeof wdp.roleplay === 'object' ? wdp.roleplay : null;
  const locked = isStageLocked(conversation);
  // A live object outside the example's stage is stale: results ends it, and its reply is out of character.
  const liveInWd = roleplay.isActive(wd) && ROLEPLAY_STAGES.includes(conversation.current_state) && !locked;
  // A turn that just hit the turn cap still wrote its line inside the example (arithmetic closure, no
  // guard c). The debrief of END_ROLEPLAY, a handoff, «مش هلأ» or an opt-out is SHIFT's Karam speaking out
  // of character: every guard applies, and «سجّلتلك مكالمة» there is a false claim (review r1-1). A result
  // that ended the object any other way (a stale example, the note after a silent idle end) is too.
  const outOfCharacter = OUT_OF_CHARACTER_ACTIONS.includes(r.action);
  const roleplayActive = !outOfCharacter && (patchedRoleplay
    ? patchedRoleplay.active === true || (liveInWd && patchedRoleplay.end_reason === 'turns')
    : liveInWd);
  const facts = (patchedRoleplay && patchedRoleplay.facts) || (wd.roleplay && wd.roleplay.facts) || [];
  const stage = (r.stateUpdate && r.stateUpdate.current_state) ?? conversation.current_state;

  const allowed = new Set(context.allowedButtons({
    stage: conversation.current_state,
    locked,
    roleplayActive: liveInWd,
    offers: ctx.offers,
    lead: wd.lead || {},
    wd,
    lang: ctx.lang,
  }).map((b) => b.id));
  // results builds the consent buttons for the stage it moves to (close/sample), not the one it read.
  if (!locked && context.consentAllowed({ stage, wd })) acks.consentButtons(ctx.lang).forEach((b) => allowed.add(b.id));
  for (const part of r.messages || []) {
    // Server-built parts (samples, the sector list) carry their own fixed ids.
    if (part && (part.serverButtons || part.type === 'list')) partButtonIds(part).forEach((id) => allowed.add(id));
    if (part && part.fallback) partButtonIds(part.fallback).forEach((id) => allowed.add(id));
    if (part && part.type === 'list') SECTOR_IDS.forEach((id) => allowed.add(id));
  }

  const modelLines = (r.messages || []).map((p) => p && p.modelLine).filter(Boolean);
  // A time the customer already gave (capture in progress or done) needs no slot buttons on top of it.
  const timeGiven = r.action === 'CAPTURE_TIME' || !!(wdp.capture_pending && wdp.capture_pending.time_text);
  const leadCallTap = batchMessages.some((m) => {
    const reply = m.interactive_reply;
    const id = reply && ((reply.button_reply && reply.button_reply.id) || (reply.list_reply && reply.list_reply.id));
    return id === 'lead_call';
  });

  // Round-2 review #2/#11: with booking on, only the server names a day and a time. A stored booking is
  // the one true appointment; anything else the model puts on the table is invented.
  const active = booking.activeBooking(wd, ctx.now);
  const whenText = (start, tz) => {
    const w = booking.whenParts(start, ctx.now, tz, ctx.lang);
    return `${w.day} ${w.time}`;
  };
  const bookingWhen = active && active.start ? whenText(active.start, active.tz) : null;
  // A stored REQUEST only grounds a day through its absolute start — never through its free text (#11).
  const pt = lead.preferred_time;
  const requestStart = pt && typeof pt === 'object' && pt.start ? pt.start : null;

  return {
    attempt,
    lang: ctx.lang,
    stage,
    action: r.action,
    bookingEnabled: booking.bookingConfig(ctx.business).enabled,
    // Whether we had ALREADY introduced ourselves before this turn — results sets disclosed_at on the
    // very turn the intro goes out, so `disclosed` alone would strip the first introduction (#8).
    disclosedBefore: (() => {
      if (!wd.disclosed_at) return false;
      const gap = objectives.gapHoursFrom(wd, [], ctx.now);
      return !(gap !== null && gap >= 24);
    })(),
    booking: active ? { when: bookingWhen, status: active.status } : null,
    requestWhen: requestStart ? whenText(requestStart, (pt && pt.tz) || undefined) : null,
    roleplayActive,
    disclosed: !!(wd.disclosed_at || wdp.disclosed_at),
    batchTexts: ctx.batchTexts,
    customerHistoryTexts: history
      .filter((m) => m.direction === 'inbound' && typeof m.text_body === 'string')
      .map((m) => m.text_body)
      .slice(-HISTORY_LIMIT),
    lead,
    roleplayFacts: Array.isArray(facts) ? facts : [],
    roleplayTexts: roleplayActive ? roleplayTexts(ctx, history, patchedRoleplay || wd.roleplay) : [],
    allowedButtonIds: allowed,
    offers: ctx.offers,
    stageLocked: locked,
    explicitTimeRequest: !timeGiven && (leadCallTap || ctx.batchTexts.some((t) => validators.EXPLICIT_TIME_RE.test(t))),
    compoundAskAllowed: stage === 'roleplay_setup' || modelLines.some(isCompoundAsk),
    conversationId: conversation.id,
    now: ctx.now,
    modelNextStep: ai && ai.next_step,
    exclamations: wd.exclamations,
  };
}

/** What the customer wrote since the example started, newest first (the arithmetic closure's quantities). */
function roleplayTexts(ctx, history, rp) {
  const startedMs = rp && rp.started_at ? Date.parse(rp.started_at) : NaN;
  const earlier = Number.isFinite(startedMs)
    ? history
      .filter((m) => m.direction === 'inbound' && typeof m.text_body === 'string' && m.created_at
        && new Date(m.created_at).getTime() >= startedMs)
      .map((m) => m.text_body)
      .reverse()
    : [];
  return [...ctx.batchTexts.slice().reverse(), ...earlier];
}

function blockEntry(v, attempt, now) {
  const codes = Array.from(new Set((v.blocks || []).map((b) => b.code).filter((c) => !INFO_CODES.includes(c))));
  return codes.length ? { at: now.toISOString(), codes, attempt } : null;
}

function withBlocks(result, entries, wd) {
  const list = entries.filter(Boolean);
  if (!list.length) return result;
  const prev = Array.isArray(wd.validator_blocks) ? wd.validator_blocks : [];
  return {
    ...result,
    workflowDataPatch: { ...(result.workflowDataPatch || {}), validator_blocks: [...prev, ...list].slice(-VALIDATOR_BLOCKS_MAX) },
  };
}

/**
 * The batcher re-renders a capture ack from `capture` with the lead saveLead stored (D26), so the model
 * line it carries must be the validated one, never the raw model output.
 */
function syncCapture(result, original) {
  if (!result.capture || !Array.isArray(result.messages) || !result.messages.length) return result;
  const head = result.messages[0];
  const ack = original && original.messages && original.messages[0] && original.messages[0].ack;
  let line = String(head.text || '');
  // A capture part always carries its ack as metadata when a model line is shown with it; with no ack
  // metadata the part is the ack alone («Sam, Noor Boutique» answered with no question), and taking its
  // text as the model line would make the batcher print the ack twice.
  if (!ack) line = '';
  else if (line.endsWith(ack)) line = line.slice(0, line.length - ack.length).trim();
  else if (ack && line.trim() === ack.trim()) line = '';
  else if (ack) line = head.modelLine || '';
  const capture = { ...result.capture, modelLine: line || null };
  if (line && head.modelLine) capture.modelReply = head.modelLine;
  else delete capture.modelReply;
  return { ...result, capture };
}

function toTextPart(part) {
  const out = { type: 'text', text: part.text };
  for (const k of ['ack', 'delayMs']) if (part[k] !== undefined) out[k] = part[k];
  return out;
}

/**
 * §10.1 step 11: the model's words are replaced by the fixed stage line; server segments stay. A part
 * whose server line comes first (the role-play start line) keeps that line alone — a second, generic
 * line after it would read as part of the example.
 */
function fallbackResult(r, ctx, stage) {
  const wd = ctx.conversation.workflow_data || {};
  const disclosed = !!(wd.disclosed_at || (r.workflowDataPatch && r.workflowDataPatch.disclosed_at));
  const sector = (wd.roleplay && wd.roleplay.sector) || (wd.lead && wd.lead.sector) || undefined;
  const line = validators.stageFallback(stage, ctx.lang, { disclosed, sector });
  let usedLine = false;
  const messages = (r.messages || []).map((original) => {
    if (!original || !original.modelLine) return original;
    let part = { ...original };
    const ack = part.ack || '';
    const text = String(part.text || '');
    // The server line alone when it comes first (the role-play start line), when the fallback line would
    // repeat it (the setup ask), or for the role-play debrief (the end line already asks the close question).
    const ackAlone = ack && ((text.startsWith(ack) && text !== ack) || line.trim() === ack.trim() || r.action === 'END_ROLEPLAY');
    if (ackAlone) {
      part.text = ack;
    } else {
      const idx = text.indexOf(part.modelLine);
      part.text = idx >= 0
        ? `${text.slice(0, idx)}${line}${text.slice(idx + part.modelLine.length)}`.trim()
        : compose(line, ack);
      usedLine = true;
    }
    delete part.modelLine;
    // Buttons the model chose go with its line; server parts (samples, the sector list) keep theirs.
    if (part.type === 'interactive' && !part.serverButtons) part = toTextPart(part);
    return part;
  });
  const out = { ...r, messages, workflowDataPatch: { ...(r.workflowDataPatch || {}) } };
  if (usedLine && stage === 'opening' && !disclosed) out.workflowDataPatch.disclosed_at = ctx.now.toISOString();
  if (out.capture) {
    out.capture = { ...out.capture, modelLine: usedLine ? line : null };
    delete out.capture.modelReply;
  }
  return out;
}

/**
 * A tier-2 handoff keeps its fixed ack and needs no second model call (the customer asked for a person),
 * but the model's own first line is still the model's words: an invented price or a denial there would
 * reach the customer unchecked. One content pass; a blocked line becomes the fixed handoff line.
 */
function checkedHandoff(r, ctx, history, ai, prior = []) {
  const wd = ctx.conversation.workflow_data || {};
  if (!(r.messages || []).some((p) => p && p.modelLine)) return withBlocks(r, prior, wd);
  const v = validators.validateResult(r, buildVctx(r, ctx, { attempt: 2, history, ai }));
  if (v.verdict === 'ok') return withBlocks(v.result, prior, wd);
  console.warn(`[shift] handoff model line blocked conversation=${ctx.conversation.id}`);
  const entry = blockEntry(v, 2, ctx.now);
  const messages = r.messages.map((original) => {
    if (!original || !original.modelLine) return original;
    const line = original.ack ? acks.handoffLead(ctx.lang) : validators.stageFallback('handoff', ctx.lang);
    const text = String(original.text || '');
    const idx = text.indexOf(original.modelLine);
    const part = { ...original, text: idx >= 0 ? `${text.slice(0, idx)}${line}${text.slice(idx + original.modelLine.length)}` : compose(line, original.ack) };
    delete part.modelLine;
    return part;
  });
  return withBlocks({ ...r, messages }, [...prior, entry], wd);
}

// A transcribed voice note saying «بدي أحكي مع إنسان» is the same request as the typed words.
function wantsPerson(ctx) {
  return handoff.detectHumanRequest(ctx.joinedText) || handoff.detectHumanRequest(ctx.batchTexts.join('\n'));
}

// ─── prompt and model call ───────────────────────────────────────────────────

function promptFor(ctx, history, hint) {
  const { business, conversation, batchMessages, now, lang, offers } = ctx;
  const wd = conversation.workflow_data || {};
  if (ctx.v1) {
    const promptOpts = { now, offers, stage: conversation.current_state, stageLocked: isStageLocked(conversation), lang };
    const userMessage = batchMessages.map((m) => batchLine(m, lang)).join('\n');
    return {
      system: buildSystemPrompt(business, formatHistory(history), promptOpts),
      retrySystem: buildSystemPrompt(business, formatHistory(history.slice(-RETRY_HISTORY)), promptOpts),
      user: hint ? `${userMessage}\n\n# ملاحظة من النظام\n${hint}` : userMessage,
    };
  }
  // The static prompt is per sector only (cache-eligible); everything that changes is in the user turn.
  // provider.js has no retry user-turn option (and is frozen for PR2), so the retry resends this turn.
  const turnOpts = {
    business,
    conversation,
    batchMessages,
    history,
    now,
    lang,
    offers,
    prefill: ctx.prefill || null,
    hint: hint || undefined,
    // A re-run of the first reply to a site message is still the first reply the customer receives.
    firstReply: ctx.prefillRerun ? true : undefined,
  };
  return {
    system: promptAr.buildStaticPrompt({ sector: (wd.lead && wd.lead.sector) || undefined }),
    retrySystem: undefined,
    user: context.buildUserTurn(turnOpts),
    // Only used when an attempt timed out: the same turn on half the history, because prompt size is
    // what the latency tracks (sims 2026-09-17: p90 7.6 s at ~4k tokens vs 12.5 s at ~6k).
    retryUser: context.buildUserTurn({ ...turnOpts, historyTurns: RETRY_HISTORY }),
  };
}

async function callModel(ctx, history, { deadlineAt, onRetry, onBlocked, hint, firstAttemptMs }) {
  const set = actionSetFor();
  const prompt = promptFor(ctx, history, hint);
  const opts = {
    validActions: set.actions,
    correctionPrompt: set.correctionPrompt,
    responseSchema: set.schema,
    jsonMode: true,
    systemInstruction: true,
    deadlineAt,
    onRetry,
    stages: set.stages,
    nextSteps: NEXT_STEPS,
    conversationId: ctx.conversation.id,
  };
  if (onBlocked) opts.onBlocked = onBlocked;
  if (prompt.retrySystem) opts.retrySystemPrompt = prompt.retrySystem;
  if (prompt.retryUser && prompt.retryUser !== prompt.user) opts.retryUserMessage = prompt.retryUser;
  if (firstAttemptMs) opts.firstAttemptMs = firstAttemptMs;
  return generateValidatedAIReply(prompt.system, prompt.user, [], opts);
}

/**
 * Round-2 review #6: «انت بوت ولا انسان جاوبني واضح» went unanswered twice — the digit guard stripped the
 * competitor-price sentence with it and the stage fallback («ما بدي أعطيك جواب مش دقيق…») took its place.
 * The honest line is owed whatever else the validators remove, so it is added back here, at the one point
 * every reply passes through.
 */
const MAX_PARTS = 3;
const IDENTITY_TEXT_MAX = 4096;

function ensureIdentityAnswer(result, ctx) {
  // A handoff is included: «خليني احكي مع إنسان واضح، إنت بوت ولا لأ؟» asks both things at once, and the
  // transfer alone leaves the question hanging (sim round 2c, hostile/glm-5.3 turn 5).
  if (!result) return result;
  if (!(ctx.batchTexts || []).some(validators.isIdentityQuestion)) return result;
  const honest = validators.HONEST_IDENTITY[ctx.lang === 'en' ? 'en' : 'ar'];
  // A capture is re-rendered by the batcher from `capture.modelLine`, not from `messages`.
  if (result.capture && !validators.isHonestIdentity(result.capture.modelLine)) {
    const line = result.capture.modelLine;
    result = { ...result, capture: { ...result.capture, modelLine: line ? `${honest}\n\n${line}` : honest } };
    delete result.capture.modelReply;
  }
  const messages = result.messages || [];
  if (messages.some((m) => m && validators.isHonestIdentity(m.text))) return result;
  // A plain text part can carry it; an interactive body has its own tight limit, so the line goes in
  // front as a message of its own while there is room for one.
  const idx = messages.findIndex((m) => m && m.type === 'text' && typeof m.text === 'string' && m.text.trim());
  if (idx >= 0 && Array.from(`${honest}\n\n${messages[idx].text}`).length <= IDENTITY_TEXT_MAX) {
    const next = messages.slice();
    next[idx] = { ...messages[idx], text: `${honest}\n\n${messages[idx].text}`.trim() };
    return { ...result, messages: next };
  }
  if (messages.length < MAX_PARTS) return { ...result, messages: [{ type: 'text', text: honest }, ...messages] };
  // Three parts already: the honest answer becomes a plain first part of its own. A fresh object, so a
  // list's `sections` or an interactive's `buttons` do not travel with a part that no longer has them.
  const next = messages.slice();
  next[0] = { type: 'text', text: honest };
  return { ...result, messages: next };
}

/**
 * Steps 4 and 7–11 of §10.1: tier-1 handoff, prompt, model call, validators.
 *
 * The identity guarantee is applied to `capture.modelLine` too: for a CAPTURE_TIME the batcher rebuilds
 * the parts from `result.capture` after the lead is saved, so a line injected into `messages` alone would
 * be thrown away — and «إنت بوت ولا إنسان؟» sent in the same batch as a time would go unanswered, which
 * is the failure #6 exists to prevent.
 */
async function answer(ctx, history, opts = {}) {
  return ensureIdentityAnswer(await answerInner(ctx, history, opts), ctx);
}

async function answerInner(ctx, history, { deadlineAt, onRetry } = {}) {
  const { business, conversation, now, lang, joinedText } = ctx;
  const wd = conversation.workflow_data || {};

  if (wantsPerson(ctx)) {
    // The line is fixed («ولا يهمك.»), so the ack must not wait up to 25 s for the model.
    const r = handoff.buildHandoff({
      ...ctx,
      reason: 'person',
      tier: 1,
      summary: joinedText.slice(0, 200),
      modelLine: acks.handoffLead(lang),
    });
    if (roleplay.isActive(wd)) {
      r.workflowDataPatch = { ...(r.workflowDataPatch || {}), roleplay: roleplay.endState(wd.roleplay, 'handoff', now) };
    }
    return r;
  }

  const deadline = deadlineAt ?? now.getTime() + AI_DEADLINE_MS;
  // A generation the model refused is not a slow one: it never gets the «تأخر ردّي» line (2026-09-15).
  let blockedReason = null;
  const onBlocked = (reason) => { blockedReason = reason; };
  const ai = await callModel(ctx, history, { deadlineAt: deadline, onRetry, onBlocked });
  if (!ai && blockedReason) {
    console.warn(`[shift] model refused to generate conversation=${conversation.id} reason=${blockedReason}`);
    return blockedReplyResult(ctx, blockedReason);
  }
  if (!ai) console.error(`[shift] AI failed for conversation=${conversation.id} — sending the fallback`);
  const r = toWorkflowResult(ai, ctx);
  if (ai && r.kind === 'handoff') return checkedHandoff(r, ctx, history, ai);
  if (!ai || UNVALIDATED_KINDS.includes(r.kind)) return r;

  const entries = [];
  const v = validators.validateResult(r, buildVctx(r, ctx, { attempt: 1, history, ai }));
  entries.push(blockEntry(v, 1, now));
  if (v.verdict === 'ok') return withBlocks(syncCapture(v.result, r), entries, wd);

  let base = r;
  const remaining = deadline - Date.now();
  if (v.verdict === 'regenerate' && remaining >= MIN_REGENERATE_MS) {
    console.warn(`[shift] regenerating conversation=${conversation.id} codes=${(v.hint || '').split('\n').length}`);
    const ai2 = await callModel(ctx, history, { deadlineAt: deadline, onRetry, hint: v.hint, firstAttemptMs: remaining });
    const r2 = ai2 ? toWorkflowResult(ai2, ctx) : null;
    if (r2 && r2.kind !== 'fallback') {
      // A regenerated handoff carries the model's words too: the same content pass as attempt A.
      if (r2.kind === 'handoff') return checkedHandoff(r2, ctx, history, ai2, entries);
      if (UNVALIDATED_KINDS.includes(r2.kind)) return withBlocks(r2, entries, wd);
      const v2 = validators.validateResult(r2, buildVctx(r2, ctx, { attempt: 2, history, ai: ai2 }));
      entries.push(blockEntry(v2, 2, now));
      if (v2.verdict === 'ok') return withBlocks(syncCapture(v2.result, r2), entries, wd);
      if (r2.action === r.action) base = r2;
    }
  }

  // Round-2 review #2: an invented appointment is not answered with a generic line — it is answered with
  // the real slots. Silence about the diary while the customer is asking for a time is what made the
  // model improvise one in the first place.
  const blockedCodes = new Set(entries.flatMap((e) => (e && e.codes) || []));
  if (blockedCodes.has('appointment_time')) {
    const offer = slotOfferResult(ctx, base);
    if (offer) {
      console.warn(`[shift] invented appointment replaced by the real slots conversation=${conversation.id}`);
      return withBlocks(offer, entries, wd);
    }
  }

  // Never silent (G4): the result keeps its state, acks and alerts; only the model's line goes.
  const stage = (base.stateUpdate && base.stateUpdate.current_state) ?? conversation.current_state;
  const fb = fallbackResult(base, ctx, stage);
  const vf = validators.validateResult(fb, buildVctx(fb, ctx, { attempt: 2, history, ai: null }));
  console.warn(`[shift] validator fallback conversation=${conversation.id} stage=${stage}`);
  return withBlocks(syncCapture(vf.result, fb), entries, wd);
}

// ─── entry points ────────────────────────────────────────────────────────────

/** §10.1 step 3, SHIFT_ROLEPLAY=0 with an example still live: it ends as a server event. */
function disabledRoleplayView(conversation, now) {
  const wd = conversation.workflow_data || {};
  const ended = roleplay.endState(wd.roleplay, 'disabled', now);
  const stage = ROLEPLAY_STAGES.includes(conversation.current_state) ? 'close' : conversation.current_state;
  return { ended, stage, conversation: { ...conversation, current_state: stage, workflow_data: { ...wd, roleplay: ended } } };
}

function withEndedRoleplay(result, view, originalStage) {
  const out = { ...result, workflowDataPatch: { ...(result.workflowDataPatch || {}) }, stateUpdate: { ...(result.stateUpdate || {}) } };
  if (!('roleplay' in out.workflowDataPatch)) out.workflowDataPatch.roleplay = view.ended;
  if (out.stateUpdate.current_state === undefined && view.stage !== originalStage) out.stateUpdate.current_state = view.stage;
  return out;
}

async function loadHistory(conversation, batch) {
  const batchIds = new Set(batch.map((m) => m.id).filter(Boolean));
  const recent = await prisma.message.findMany({
    where: { conversation_id: conversation.id },
    orderBy: { created_at: 'desc' },
    take: HISTORY_LIMIT + batch.length,
    select: {
      id: true, direction: true, text_body: true, message_type: true, raw_payload: true,
      created_at: true, is_ai_generated: true, sent_by_user_id: true, status: true,
    },
  });
  // A staff alert sent to a team member's own chat quotes other customers' names and words: it
  // never belongs in the model's context (nor does it read as something SHIFT told this person).
  return recent
    .filter((m) => !batchIds.has(m.id) && m.raw_payload?.kind !== STAFF_ALERT_KIND)
    .slice(0, HISTORY_LIMIT)
    .reverse();
}

/** Customer lines in the loaded history, with transcripts (the role-play facts are checked against them). */
function historyCustomerTexts(history) {
  const out = [];
  for (const m of history) {
    if (m.direction !== 'inbound') continue;
    if (typeof m.text_body === 'string' && m.text_body.trim()) out.push(m.text_body);
    const sm = shiftMediaOf(m);
    if (sm && sm.status === 'ok' && typeof sm.text === 'string' && sm.text.trim()) out.push(sm.text);
  }
  return out;
}

/** A pre-fill run 1 already recorded for this same opening message: this run re-answers it. */
function isPrefillRerun(ctx) {
  const wd = ctx.conversation.workflow_data || {};
  const first = ctx.batchMessages[0];
  return !!(first && first.id && wd.prefill && wd.prefill.msg_id && wd.prefill.msg_id === first.id);
}

/**
 * §10.1 step 5: the site's composed message, only as the conversation's opening message. A re-run of that
 * first reply (its send failed and the burst came back) is still the opening: run 1's state and its
 * undelivered outbound rows do not count (review minor).
 */
function prefillFor(ctx, history) {
  const wd = ctx.conversation.workflow_data || {};
  const first = ctx.batchMessages[0];
  if (!first) return null;
  if (!isPrefillRerun(ctx) && (wd.prefill || wd.bot_turns || wd.last_bot || wd.last_outbound_at)) return null;
  if (history.some((m) => m.direction === 'outbound' && !UNDELIVERED_STATUSES.includes(m.status))) return null;
  if (!prefillParser.isPrefill(first.text_body)) return null;
  try {
    return prefillParser.parsePrefill(first.text_body);
  } catch (err) {
    console.error(`[shift] pre-fill parse failed conversation=${ctx.conversation.id}: ${err.message}`);
    return null;
  }
}

/**
 * A `captured` conversation with only a call request is not locked against the calendar (owner phone test
 * 2026-09-17): the customer may still turn that request into a real booking. `handoff` and `closed` are.
 */
function calendarUnlocked(ctx) {
  return booking.calendarOpenAt(ctx.business, ctx.conversation, ctx.now);
}

function shouldOfferCalendar(ctx) {
  const conv = ctx.conversation;
  const wd = conv.workflow_data || {};
  if (!booking.bookingConfig(ctx.business).enabled) return false;
  if (roleplay.isActive(wd) || ROLEPLAY_STAGES.includes(conv.current_state)) return false;
  if (isStageLocked(conv) && !calendarUnlocked(ctx)) return false;
  if (conv.current_state === 'closed') return false;
  return !booking.activeBooking(wd, ctx.now) && !wantsPerson(ctx);
}

async function processShiftBatch(business, conversation, batchMessages, { now = new Date(), deadlineAt, onRetry } = {}) {
  let ctx = null;
  try {
    const batch = Array.isArray(batchMessages) ? batchMessages : [];
    ctx = buildCtx(business, conversation, batch, now);
    const wd = conversation.workflow_data || {};

    // One transcript is enough for the model path: the rows it could not read get «بقرأ النص بس» from
    // mediaPrefixFor, and a paid-for transcript is never thrown away over a sticker beside it.
    const transcribed = mediaEnabled() && batch.some((m) => shiftMediaOf(m)?.status === 'ok');
    if (batch.length > 0 && batch.every(isMediaOnly) && !transcribed) {
      return plainResult({
        kind: 'media',
        action: 'MEDIA',
        messages: [{ type: 'text', text: acks.media(batch[0].message_type, ctx.lang) }],
        workflowDataPatch: { bot_turns: (wd.bot_turns || 0) + 1 },
      });
    }

    // §10.1 step 3: role-play exits need no model.
    const exitOnly = batch.length === 1 && roleplay.isExit(batch[0].text_body || '');
    let view = null;
    if (roleplay.isActive(wd)) {
      if (!ctx.roleplayOn) {
        view = disabledRoleplayView(conversation, now);
        if (exitOnly) {
          return plainResult({
            kind: 'skipped_reply',
            action: 'END_ROLEPLAY',
            stateUpdate: view.stage !== conversation.current_state ? { current_state: view.stage } : {},
            workflowDataPatch: { roleplay: view.ended, nudge: null },
          });
        }
        ctx = { ...ctx, conversation: view.conversation };
      } else if (exitOnly) {
        return roleplayEndResult(ctx);
      }
    }

    // PR3: «بدي ألغي المكالمة» / «ممكن نغيّر الموعد؟» while a call is booked is deterministic (no model): a
    // cancel is confirmed with buttons first, a change gets the calendar's free slots.
    if (!roleplay.isActive(ctx.conversation.workflow_data || {}) && !wantsPerson(ctx)) {
      // A call request with no event yet is answered here too (2026-09-17), but never from `handoff` or
      // `closed`: those stages belong to the team and to the opt-out.
      const requestOpen = !['handoff', 'closed'].includes(ctx.conversation.current_state);
      const intent = booking.textIntent(ctx.batchTexts, ctx.conversation.workflow_data || {}, now, { requestOpen });
      if (intent === 'cancel') return booking.cancelAskResult({ ...ctx, messageId: ctx.newest && ctx.newest.id });
      if (intent === 'change') return await booking.changeTextResult({ ...ctx, messageId: ctx.newest && ctx.newest.id });
      // «شو عن موعدنا؟» is a lookup, not small talk (round-2 review #12): it is answered from the record,
      // with the absolute day and Amman time, and it says whether that record is a booking or a request.
      if (intent === 'status') return booking.statusResult({ ...ctx, messageId: ctx.newest && ctx.newest.id });
    }
    // PR3: when a call can be booked, the offers are the calendar's free slots (`book:<iso>`). Unconfigured,
    // SHIFT_BOOKING=0 or a calendar error keeps PR2's window offers and their "request" semantics.
    if (shouldOfferCalendar(ctx)) {
      const cal = await booking.offersWithin(OFFERS_BUDGET_MS, { business, now, lang: ctx.lang, teamHours: ctx.teamHours });
      if (cal.ok) ctx.offers = cal.offers;
    }

    let history = [];
    if (!wantsPerson(ctx)) history = await loadHistory(conversation, batch);
    ctx.customerHistoryTexts = historyCustomerTexts(history);
    ctx.prefill = prefillFor(ctx, history);
    ctx.prefillRerun = !!ctx.prefill && isPrefillRerun(ctx);

    const result = await answer(ctx, history, { deadlineAt, onRetry });
    return view ? withEndedRoleplay(result, view, conversation.current_state) : result;
  } catch (err) {
    console.error('[shift]', conversation?.id, err && err.message);
    try {
      return toWorkflowResult(null, ctx || { business, conversation, batchMessages: Array.isArray(batchMessages) ? batchMessages : [], now });
    } catch (fallbackErr) {
      // Last resort: even a broken ctx must not leave the customer without a reply.
      console.error('[shift] fallback failed', fallbackErr && fallbackErr.message);
      return toWorkflowResult(null, {});
    }
  }
}

/** One-message wrapper kept for the existing test and for scripts. */
async function processShiftMessage(business, conversation, customerText) {
  const now = new Date();
  const batch = [{ id: null, direction: 'inbound', message_type: 'text', text_body: customerText }];
  let ctx = null;
  try {
    ctx = buildCtx(business, conversation, batch, now);
    // The current inbound message is already saved; take the turns before it as history.
    const recent = await prisma.message.findMany({
      where: { conversation_id: conversation.id },
      orderBy: { created_at: 'desc' },
      take: HISTORY_LIMIT + 1,
      select: { direction: true, text_body: true },
    });
    const history = recent.slice(1).reverse();
    ctx.customerHistoryTexts = historyCustomerTexts(history);
    ctx.prefill = prefillFor(ctx, history);
    return await answer(ctx, history, { deadlineAt: now.getTime() + AI_DEADLINE_MS });
  } catch (err) {
    console.error('[shift]', conversation?.id, err && err.message);
    return toWorkflowResult(null, ctx || { business, conversation, batchMessages: batch, now });
  }
}

module.exports = {
  processShiftBatch,
  processShiftMessage,
  batchLine,
  buildSystemPrompt,
  formatHistory,
  toWorkflowResult,
  actionSetFor,
  SHIFT_KNOWLEDGE,
  SHIFT_ACTIONS,
  HISTORY_LIMIT,
  AI_DEADLINE_MS,
  MIN_REGENERATE_MS,
};
