/**
 * SHIFT Sales Assistant Workflow
 *
 * Answers prospects who message SHIFT's own WhatsApp number (usually from an ad or the site).
 * processShiftBatch takes every customer message the batcher collected, decides whether the AI is
 * needed at all (media-only batches and explicit "I want a person" requests are answered
 * deterministically), and returns one WorkflowResult. It never writes to the DB and never sends:
 * the batcher persists the state first and only then delivers the messages.
 */

const { generateValidatedAIReply } = require('../../ai/provider');
const prisma = require('../../config/prisma');
const acks = require('./acks');
const hours = require('./hours');
const handoff = require('./handoff');
const buttons = require('./buttons');
const { buildSystemPrompt, formatHistory, SHIFT_KNOWLEDGE } = require('./prompt');
const { toWorkflowResult, isStageLocked, MEDIA_TYPES } = require('./results');
const {
  SHIFT_ACTIONS, CORRECTION_PROMPT, RESPONSE_SCHEMA, MODEL_STAGES, NEXT_STEPS,
} = require('./actions');

const HISTORY_LIMIT = 12;
const STAFF_ALERT_KIND = 'staff_alert';
const RETRY_HISTORY = 6;
// 25 s: live Gemini latency reached 12–17 s on 2026-09-15; the typing indicator covers the wait.
const AI_DEADLINE_MS = Number(process.env.SHIFT_AI_DEADLINE_MS) || 25000;

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

function batchLine(message, lang = 'ar') {
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

function buildCtx(business, conversation, batchMessages, now) {
  const wd = conversation.workflow_data || {};
  const lead = wd.lead || {};
  const joinedText = batchMessages.map((m) => m.text_body || '').join('\n');
  const lang = acks.pickLanguage(lead, joinedText);
  const teamHours = hours.resolveTeamHours(business.ai_config);
  const offers = buttons.slotOffers(teamHours, now, lang);
  const newest = batchMessages[batchMessages.length - 1] || null;
  return { business, conversation, batchMessages, now, lang, teamHours, offers, newest, joinedText };
}

/** Steps 3 and 5–7 of the contract: tier-1 handoff, prompt, model call, result. */
async function answer(ctx, history, { deadlineAt, onRetry } = {}) {
  const { business, conversation, batchMessages, now, lang, offers, joinedText } = ctx;

  if (handoff.detectHumanRequest(joinedText)) {
    // The line is fixed («ولا يهمك.»), so the ack must not wait up to 25 s for the model.
    return handoff.buildHandoff({
      ...ctx,
      reason: 'person',
      tier: 1,
      summary: joinedText.slice(0, 200),
      modelLine: acks.handoffLead(lang),
    });
  }

  const userMessage = batchMessages.map((m) => batchLine(m, lang)).join('\n');
  const promptOpts = { now, offers, stage: conversation.current_state, stageLocked: isStageLocked(conversation), lang };
  const systemPrompt = buildSystemPrompt(business, formatHistory(history), promptOpts);
  const retrySystemPrompt = buildSystemPrompt(business, formatHistory(history.slice(-RETRY_HISTORY)), promptOpts);

  const aiResult = await generateValidatedAIReply(systemPrompt, userMessage, [], {
    validActions: SHIFT_ACTIONS,
    correctionPrompt: CORRECTION_PROMPT,
    responseSchema: RESPONSE_SCHEMA,
    jsonMode: true,
    systemInstruction: true,
    deadlineAt: deadlineAt ?? now.getTime() + AI_DEADLINE_MS,
    retrySystemPrompt,
    onRetry,
    stages: MODEL_STAGES,
    nextSteps: NEXT_STEPS,
    conversationId: conversation.id,
  });
  if (!aiResult) console.error(`[shift] AI failed for conversation=${conversation.id} — sending the fallback`);
  return toWorkflowResult(aiResult, ctx);
}

async function processShiftBatch(business, conversation, batchMessages, { now = new Date(), deadlineAt, onRetry } = {}) {
  let ctx = null;
  try {
    const batch = Array.isArray(batchMessages) ? batchMessages : [];
    ctx = buildCtx(business, conversation, batch, now);
    const wd = conversation.workflow_data || {};

    if (batch.length > 0 && batch.every(isMediaOnly)) {
      return {
        kind: 'media',
        action: 'MEDIA',
        messages: [{ type: 'text', text: acks.media(batch[0].message_type, ctx.lang) }],
        stateUpdate: {},
        workflowDataPatch: { bot_turns: (wd.bot_turns || 0) + 1 },
        leadPatch: null,
        leadMeta: null,
        needsTeam: null,
        alert: null,
      };
    }

    let history = [];
    if (!handoff.detectHumanRequest(ctx.joinedText)) {
      const batchIds = new Set(batch.map((m) => m.id).filter(Boolean));
      const recent = await prisma.message.findMany({
        where: { conversation_id: conversation.id },
        orderBy: { created_at: 'desc' },
        take: HISTORY_LIMIT + batch.length,
        select: { id: true, direction: true, text_body: true, message_type: true, raw_payload: true },
      });
      // A staff alert sent to a team member's own chat quotes other customers' names and words: it
      // never belongs in the model's context (nor does it read as something SHIFT told this person).
      history = recent
        .filter((m) => !batchIds.has(m.id) && m.raw_payload?.kind !== STAFF_ALERT_KIND)
        .slice(0, HISTORY_LIMIT)
        .reverse();
    }

    return await answer(ctx, history, { deadlineAt, onRetry });
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
  SHIFT_KNOWLEDGE,
  SHIFT_ACTIONS,
  HISTORY_LIMIT,
};
