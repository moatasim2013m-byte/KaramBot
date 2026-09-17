/**
 * AI Provider Adapter
 * Supports Gemini and OpenAI. Switch via AI_PROVIDER env var.
 *
 * Two call paths share this file:
 *  - legacy (restaurant / clinic): no opts — one concatenated prompt, 15 s timeout, one
 *    correction retry. Pinned by tests/providerContract.test.js; do not change its shape.
 *  - SHIFT: opts turn on JSON mode, systemInstruction, an absolute deadline split across two
 *    attempts, per-workflow actions and stage/next_step enums.
 */

const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
const LEGACY_TIMEOUT_MS = 15000;
// gemini-3.x spends hidden "thinking" tokens from maxOutputTokens. A 600-token cap was used up by
// thinking alone (finish=MAX_TOKENS, 6–59 visible tokens) and every SHIFT reply fell back — 2026-09-15.
const SHIFT_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 2048;
// 'minimal' measured 4.6–8.2 s with complete JSON; set GEMINI_THINKING_LEVEL=off to omit the field.
const SHIFT_THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL || 'minimal';
const DEFAULT_FIRST_ATTEMPT_MS = 15000;
// Below this there is no point starting a second attempt: the model p50 alone is longer.
const MIN_RETRY_MS = 1500;

function resolveModel() {
  return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

// Promise.race that also clears its timer, so a finished call leaves no pending handle.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Gemini timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function logUsage(fields) {
  console.log('[ai] ' + JSON.stringify(fields));
}

// A generation the model refused (safety, recitation, a blocked prompt) is not a slow one: the customer
// must not be told the reply was delayed (owner phone test 2026-09-15, 16:14). The reason travels on the
// error as `blocked`, and the caller answers deterministically instead of retrying.
const BLOCK_FINISH_REASONS = ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'];
const BLOCKED_ERROR_RE = /blocked|safety|prohibited|recitation|blocklist/i;

function blockReasonOf(response) {
  const feedback = response && response.promptFeedback;
  if (feedback && feedback.blockReason) return String(feedback.blockReason);
  const finish = response && response.candidates && response.candidates[0] && response.candidates[0].finishReason;
  return finish && BLOCK_FINISH_REASONS.includes(String(finish)) ? String(finish) : null;
}

/** The SDK throws «Text not available. Candidate was blocked due to SAFETY» for a refused candidate. */
function blockReasonOfError(err) {
  const message = (err && err.message) || '';
  if (!BLOCKED_ERROR_RE.test(message)) return null;
  const named = BLOCK_FINISH_REASONS.find((r) => message.toUpperCase().includes(r));
  return named || 'BLOCKED';
}

function blockedError(reason) {
  const err = new Error(`blocked:${reason}`);
  err.blocked = reason;
  return err;
}

async function callGemini(systemPrompt, userMessage, opts = {}) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = resolveModel();
  const legacy = !opts.jsonMode && !opts.systemInstruction && opts.attemptMs === undefined;
  const attemptMs = opts.attemptMs === undefined ? LEGACY_TIMEOUT_MS : Math.max(0, opts.attemptMs);

  const started = Date.now();
  let response = null;
  let ok = false;
  try {
    let request;
    let geminiModel;
    if (legacy) {
      geminiModel = genAI.getGenerativeModel({ model });
      request = geminiModel.generateContent(`${systemPrompt}\n\nرسالة العميل: ${userMessage}`);
    } else {
      const params = { model };
      // GEMINI_TEXT_MODE=1 is a prompt-shape rollback: same SDK and JSON mode, but the
      // prompt rides in the user turn in case systemInstruction misbehaves on a model.
      const useSystemInstruction = opts.systemInstruction && process.env.GEMINI_TEXT_MODE !== '1';
      if (useSystemInstruction) params.systemInstruction = systemPrompt;
      if (opts.jsonMode) {
        params.generationConfig = { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: SHIFT_MAX_OUTPUT_TOKENS };
        if (SHIFT_THINKING_LEVEL !== 'off') params.generationConfig.thinkingConfig = { thinkingLevel: SHIFT_THINKING_LEVEL };
        if (opts.responseSchema) params.generationConfig.responseSchema = opts.responseSchema;
      }
      geminiModel = genAI.getGenerativeModel(params);
      let text;
      if (useSystemInstruction) text = userMessage;
      else if (opts.systemInstruction) text = `${systemPrompt}\n\nرسائل العميل:\n${userMessage}`;
      else text = `${systemPrompt}\n\nرسالة العميل: ${userMessage}`;
      request = geminiModel.generateContent(
        { contents: [{ role: 'user', parts: [{ text }] }] },
        { timeout: attemptMs },
      );
    }
    // The SDK timeout aborts the fetch; the JS race also covers a mocked or hung SDK.
    const result = await withTimeout(Promise.resolve(request), attemptMs);
    response = result && result.response;
    const blocked = blockReasonOf(response);
    if (blocked) throw blockedError(blocked);
    let text;
    try {
      text = response.text();
    } catch (err) {
      const reason = blockReasonOfError(err);
      if (reason) throw blockedError(reason);
      throw err;
    }
    ok = true;
    return text;
  } finally {
    const usage = (response && response.usageMetadata) || {};
    logUsage({
      model,
      ms: Date.now() - started,
      in: usage.promptTokenCount ?? null,
      out: usage.candidatesTokenCount ?? null,
      thoughts: usage.thoughtsTokenCount ?? null,
      finish: response?.candidates?.[0]?.finishReason ?? null,
      conv: opts.conversationId || null,
      attempt: opts.attempt || 1,
      ok,
    });
  }
}

async function callOpenAI(systemPrompt, userMessage, history = []) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    temperature: 0.5,
    max_tokens: 600,
  });

  return response.choices[0].message.content;
}

/**
 * Main AI call — routes to correct provider
 */
async function generateAIReply(systemPrompt, userMessage, history = [], opts = {}) {
  const provider = process.env.AI_PROVIDER || 'gemini';
  try {
    if (provider === 'openai') return await callOpenAI(systemPrompt, userMessage, history);
    return await callGemini(systemPrompt, userMessage, opts || {});
  } catch (err) {
    const blocked = err.blocked || blockReasonOfError(err);
    if (blocked) {
      err.blocked = blocked;
      console.warn(`[ai] blocked ${JSON.stringify({ reason: blocked, conv: opts.conversationId || null, attempt: opts.attempt || 1 })}`);
      throw err;
    }
    console.error(`[AI][${provider}] Call failed:`, err.message);
    throw err;
  }
}

/**
 * Extract JSON from AI text response.
 * Tries markdown code block first, then bare object.
 */
function extractJSON(text) {
  if (!text) return null;
  try {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/) ||
                  text.match(/(\{[\s\S]*\})/);
    const jsonStr = match ? (match[1] || match[0]) : text;
    return JSON.parse(jsonStr.trim());
  } catch {
    return null;
  }
}

// JSON mode returns bare JSON; the fence/regex extractor stays as the fallback.
function parseModelJSON(text, jsonMode) {
  if (jsonMode && typeof text === 'string') {
    try {
      return JSON.parse(text);
    } catch {
      // fall through
    }
  }
  return extractJSON(text);
}

const VALID_ACTIONS = new Set([
  'NONE', 'SHOW_MENU', 'ADD_ITEM', 'REMOVE_ITEM',
  'ASK_ORDER_TYPE', 'ASK_ADDRESS', 'SHOW_SUMMARY',
  'CONFIRM_ORDER', 'HANDOFF_TO_HUMAN', 'CANCEL_ORDER',
  'ASK_CLARIFYING_QUESTION',
]);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const hasValue = (set, value) => (set instanceof Set ? set.has(value) : Array.from(set || []).includes(value));

// Buttons, lead and action_args are cleaned in place rather than failing validation: a bad
// button title must never cost an 25 s retry or silence the reply.
function sanitiseResult(result) {
  const seen = new Set();
  result.buttons = (Array.isArray(result.buttons) ? result.buttons : [])
    .filter((b) => isPlainObject(b)
      && typeof b.id === 'string' && b.id.length > 0 && b.id.length <= 256
      && typeof b.title === 'string' && Array.from(b.title).length >= 1 && Array.from(b.title).length <= 20
      // Meta rejects the whole message on a duplicate id, so keep the first only.
      && !seen.has(b.id) && seen.add(b.id))
    .slice(0, 3)
    .map((b) => ({ id: b.id, title: b.title }));
  if (!isPlainObject(result.lead)) result.lead = {};
  if (!isPlainObject(result.action_args)) result.action_args = {};
}

/**
 * Validate parsed AI result against required schema.
 * Returns { valid: true } or { valid: false, reason: string, repairable?: boolean }
 */
function validateAIResult(result, validActions = VALID_ACTIONS, { stages, nextSteps } = {}) {
  if (!result || typeof result !== 'object') {
    return { valid: false, reason: 'Result is not an object' };
  }
  if (typeof result.reply !== 'string' || result.reply.trim().length === 0) {
    return { valid: false, reason: 'Missing or empty reply string' };
  }
  sanitiseResult(result);
  const actions = validActions || VALID_ACTIONS;
  if (result.action && !hasValue(actions, result.action)) {
    return { valid: false, reason: `Unknown action: ${result.action}` };
  }
  if (result.extracted_items !== undefined && !Array.isArray(result.extracted_items)) {
    return { valid: false, reason: 'extracted_items must be an array' };
  }
  // stage / next_step are advisory (the server owns transitions), so a wrong value can be
  // dropped instead of discarding a good reply.
  if (stages && result.stage != null && !hasValue(stages, result.stage)) {
    return { valid: false, reason: `Unknown stage: ${result.stage}`, repairable: true };
  }
  if (nextSteps && result.next_step != null && !hasValue(nextSteps, result.next_step)) {
    return { valid: false, reason: `Unknown next_step: ${result.next_step}`, repairable: true };
  }
  return { valid: true };
}

// Drop the invalid advisory enums; returns the result if that makes it valid, else null.
function repairResult(result, validActions, enums) {
  if (!isPlainObject(result)) return null;
  if (enums.stages && result.stage != null && !hasValue(enums.stages, result.stage)) delete result.stage;
  if (enums.nextSteps && result.next_step != null && !hasValue(enums.nextSteps, result.next_step)) delete result.next_step;
  return validateAIResult(result, validActions, enums).valid ? result : null;
}

const CORRECTION_PROMPT = `يجب أن يكون ردك JSON فقط بهذا الشكل بالضبط، بدون أي نص إضافي:
{"reply":"نص الرد هنا","action":"NONE","extracted_items":[]}

الأكشن يجب أن يكون أحد هذه القيم فقط:
NONE, SHOW_MENU, ADD_ITEM, REMOVE_ITEM, ASK_ORDER_TYPE, ASK_ADDRESS, SHOW_SUMMARY, CONFIRM_ORDER, HANDOFF_TO_HUMAN, CANCEL_ORDER

أعد المحاولة الآن.`;

/**
 * Call AI with automatic retry on invalid JSON.
 * If second attempt also fails, returns null (caller must handle gracefully).
 * Never throws.
 */
/** A refused generation: the caller is told through opts.onBlocked and the attempt is not repeated. */
function reportBlocked(err, opts) {
  const reason = (err && err.blocked) || null;
  if (!reason) return false;
  if (typeof opts.onBlocked === 'function') {
    try {
      opts.onBlocked(reason);
    } catch (cbErr) {
      console.warn('[ai] onBlocked failed:', cbErr.message);
    }
  }
  return true;
}

async function generateValidatedAIReply(systemPrompt, userMessage, history = [], opts = {}) {
  opts = opts || {};
  const validActions = opts.validActions || VALID_ACTIONS;
  const correctionPrompt = opts.correctionPrompt || CORRECTION_PROMPT;
  const enums = { stages: opts.stages, nextSteps: opts.nextSteps };
  const callOpts = {
    jsonMode: opts.jsonMode,
    responseSchema: opts.responseSchema,
    systemInstruction: opts.systemInstruction,
    conversationId: opts.conversationId,
  };
  for (const key of Object.keys(callOpts)) if (callOpts[key] === undefined) delete callOpts[key];

  if (typeof opts.deadlineAt === 'number') {
    return deadlineReply(systemPrompt, userMessage, history, opts, { validActions, correctionPrompt, enums, callOpts });
  }

  // First attempt
  let raw;
  try {
    raw = await generateAIReply(systemPrompt, userMessage, history, { ...callOpts, attempt: 1 });
  } catch (err) {
    if (reportBlocked(err, opts)) return null;
    console.error('AI first call failed:', err.message);
    return null;
  }

  let parsed = parseModelJSON(raw, opts.jsonMode);
  let validation = validateAIResult(parsed, validActions, enums);

  if (validation.valid) return parsed;

  console.warn(`AI response invalid (${validation.reason}), retrying with correction prompt...`);

  // Second attempt with correction
  try {
    const correctionMessage = `${userMessage}\n\n${correctionPrompt}`;
    raw = await generateAIReply(systemPrompt, correctionMessage, history, { ...callOpts, attempt: 2 });
    parsed = parseModelJSON(raw, opts.jsonMode);
    validation = validateAIResult(parsed, validActions, enums);
    if (validation.valid) return parsed;
    const repaired = validation.repairable && repairResult(parsed, validActions, enums);
    if (repaired) return repaired;
    console.error('AI second attempt also invalid:', validation.reason, '| Raw:', raw?.slice(0, 200));
  } catch (err) {
    if (reportBlocked(err, opts)) return null;
    console.error('AI retry failed:', err.message);
  }

  console.error(`[AI] Both attempts failed for message: "${String(userMessage).slice(0, 50)}"`);
  return null; // caller must trigger human handoff
}

/**
 * Deadline mode (SHIFT): one absolute deadline shared by at most two attempts, so the
 * customer never waits past it for a reply or the fallback.
 */
async function deadlineReply(systemPrompt, userMessage, history, opts, { validActions, correctionPrompt, enums, callOpts }) {
  const remaining = () => opts.deadlineAt - Date.now();
  const firstAttemptMs = opts.firstAttemptMs || DEFAULT_FIRST_ATTEMPT_MS;
  const tag = opts.conversationId ? ` conv=${opts.conversationId}` : '';

  // The correction prompt only helps when the model answered badly, not when it timed out.
  let firstInvalid = false;
  try {
    const attemptMs = Math.min(firstAttemptMs, remaining());
    if (attemptMs <= 0) throw new Error('deadline already passed');
    const raw = await generateAIReply(systemPrompt, userMessage, history, { ...callOpts, attemptMs, attempt: 1 });
    const parsed = parseModelJSON(raw, opts.jsonMode);
    const validation = validateAIResult(parsed, validActions, enums);
    if (validation.valid) return parsed;
    firstInvalid = true;
    console.warn(`[AI] attempt 1 invalid (${validation.reason})${tag}`);
  } catch (err) {
    // A refusal is not a slow answer: a correction prompt will not change it.
    if (reportBlocked(err, opts)) return null;
    console.error(`[AI] attempt 1 failed${tag}:`, err.message);
  }

  if (remaining() < MIN_RETRY_MS) {
    console.error(`[AI] no time left for a retry${tag}`);
    return null;
  }

  if (typeof opts.onRetry === 'function') {
    try {
      await opts.onRetry();
    } catch (err) {
      console.warn(`[AI] onRetry failed${tag}:`, err.message);
    }
  }

  try {
    const attemptMs = remaining();
    if (attemptMs <= 0) throw new Error('deadline passed before retry');
    const message = firstInvalid ? `${userMessage}\n\n${correctionPrompt}` : userMessage;
    const raw = await generateAIReply(opts.retrySystemPrompt || systemPrompt, message, history,
      { ...callOpts, attemptMs, attempt: 2 });
    const parsed = parseModelJSON(raw, opts.jsonMode);
    const validation = validateAIResult(parsed, validActions, enums);
    if (validation.valid) return parsed;
    const repaired = validation.repairable && repairResult(parsed, validActions, enums);
    if (repaired) return repaired;
    console.error(`[AI] attempt 2 invalid (${validation.reason})${tag} | Raw:`, raw?.slice(0, 200));
  } catch (err) {
    if (reportBlocked(err, opts)) return null;
    console.error(`[AI] attempt 2 failed${tag}:`, err.message);
  }

  console.error(`[AI] Both attempts failed${tag} for message: "${String(userMessage).slice(0, 50)}"`);
  return null;
}

module.exports = {
  generateAIReply,
  generateValidatedAIReply,
  extractJSON,
  validateAIResult,
  resolveModel,
  DEFAULT_GEMINI_MODEL,
  VALID_ACTIONS,
  CORRECTION_PROMPT,
};
