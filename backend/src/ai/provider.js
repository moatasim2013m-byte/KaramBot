/**
 * AI Provider Adapter
 * Supports Gemini, Claude (Anthropic) and OpenAI. Switch via AI_PROVIDER env var; AI_FALLBACK_PROVIDER names a
 * second provider the SAME turn moves to when the first fails in a way retrying it will not fix (credits
 * exhausted, key rejected, model not found, a 400, persistent overload, or a timeout with deadline left).
 *
 * Two call paths share this file:
 *  - legacy (restaurant / clinic): no opts — one concatenated prompt, 15 s timeout, one
 *    correction retry. Pinned by tests/providerContract.test.js; do not change its shape.
 *  - SHIFT: opts turn on JSON mode, systemInstruction, an absolute deadline split across two
 *    attempts, per-workflow actions and stage/next_step enums.
 */

const { callAnthropic, DEFAULT_ANTHROPIC_MODEL } = require('./anthropic');
const { classifyProviderError, FATAL_KINDS, SWITCH_KINDS } = require('./errors');

const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
const LEGACY_TIMEOUT_MS = 15000;
// gemini-3.x spends hidden "thinking" tokens from maxOutputTokens. A 600-token cap was used up by
// thinking alone (finish=MAX_TOKENS, 6–59 visible tokens) and every SHIFT reply fell back — 2026-09-15.
const SHIFT_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 2048;
// 'minimal' measured 4.6–8.2 s with complete JSON; set GEMINI_THINKING_LEVEL=off to omit the field.
const SHIFT_THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL || 'minimal';
const DEFAULT_FIRST_ATTEMPT_MS = 15000;
// A RETRY that has not answered in 10 s is hung like the attempt before it: measured over 126 real calls
// (the two 2026-09-17 re-runs) a successful retry came back in 2.2–9.5 s, while every failure sat at the
// cap exactly. Capping the retry lower is what makes room for a third chance inside the same deadline.
const RETRY_ATTEMPT_MS = Number(process.env.GEMINI_RETRY_ATTEMPT_MS) || 10000;
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
        // `thinkingOff` / `maxOutputTokens` are set by the retry after a MAX_TOKENS finish: the model spent
        // the whole budget thinking and returned nothing usable, so the next attempt gets room and no
        // hidden thinking (clinic/glm-5.3 turn 2, 2026-09-17: two MAX_TOKENS finishes, a dead turn).
        const cap = opts.maxOutputTokens || SHIFT_MAX_OUTPUT_TOKENS;
        params.generationConfig = { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: cap };
        if (SHIFT_THINKING_LEVEL !== 'off' && !opts.thinkingOff) params.generationConfig.thinkingConfig = { thinkingLevel: SHIFT_THINKING_LEVEL };
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
    const finishReason = response?.candidates?.[0]?.finishReason ?? null;
    if (typeof opts.onFinish === 'function') {
      try {
        opts.onFinish(finishReason);
      } catch (cbErr) {
        console.warn('[ai] onFinish failed:', cbErr.message);
      }
    }
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

// ─── providers, health and failover ──────────────────────────────────────────

const PROVIDERS = ['gemini', 'anthropic', 'openai'];
const PROVIDER_KEYS = { gemini: 'GEMINI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' };
const PROVIDER_LABELS = { gemini: 'Gemini', anthropic: 'Claude', openai: 'OpenAI' };

function primaryProvider() {
  return process.env.AI_PROVIDER || 'gemini';
}

/** The configured fallback, if it is a different known provider with a key; else null. */
function fallbackProvider() {
  const fb = (process.env.AI_FALLBACK_PROVIDER || '').trim().toLowerCase();
  if (!fb || fb === 'none' || !PROVIDERS.includes(fb) || fb === primaryProvider()) return null;
  return process.env[PROVIDER_KEYS[fb]] ? fb : null;
}

function modelOf(provider) {
  if (provider === 'anthropic') return process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  if (provider === 'openai') return 'gpt-4o-mini';
  return resolveModel();
}

// A provider that failed with billing / auth / model-not-found is skipped by later turns for a while, so
// every turn does not first pay a doomed call. It is tried again after the cooldown (credits topped up).
const envMs = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const downUntil = new Map();
const lastIssueAlertAt = new Map();

function markDown(provider) {
  downUntil.set(provider, Date.now() + envMs('AI_PROVIDER_COOLDOWN_MS', 5 * 60 * 1000));
}

function isDown(provider) {
  return (downUntil.get(provider) || 0) > Date.now();
}

function issueSummary(provider, kind, next) {
  const name = PROVIDER_LABELS[provider] || provider;
  let what;
  if (kind === 'billing') what = `رصيد ${name} خلص`;
  else if (kind === 'auth') what = `مفتاح ${name} مرفوض`;
  else what = `موديل ${name} غير متاح (${modelOf(provider)})`;
  const then = next
    ? `البوت شغّال على ${PROVIDER_LABELS[next] || next}`
    : 'ما في مزوّد بديل شغّال — البوت عم يبعت رسالة الاعتذار';
  return `${what} — ${then}`;
}

/**
 * A billing / auth / model failure the owner must hear about before the other provider runs out too:
 * logged every time, and handed to opts.onProviderIssue (the SHIFT workflow turns it into an ai_failure
 * staff alert) at most once per hour per provider.
 */
function reportProviderIssue(provider, kind, next, err, opts) {
  const summary = issueSummary(provider, kind, next);
  console.error(`[ai] provider_issue ${JSON.stringify({ provider, kind, next: next || null, status: (err && err.status) ?? null, conv: opts.conversationId || null })}`);
  const now = Date.now();
  const last = lastIssueAlertAt.get(provider);
  if (last !== undefined && now - last < envMs('AI_PROVIDER_ALERT_MS', 60 * 60 * 1000)) return;
  if (typeof opts.onProviderIssue !== 'function') return;
  lastIssueAlertAt.set(provider, now);
  try {
    const out = opts.onProviderIssue({ provider, kind, next: next || null, summary });
    if (out && typeof out.catch === 'function') out.catch((cbErr) => console.warn('[ai] onProviderIssue failed:', cbErr && cbErr.message));
  } catch (cbErr) {
    console.warn('[ai] onProviderIssue failed:', cbErr.message);
  }
}

/** Where a turn starts: the primary, unless it is cooling down after a hard failure and the fallback is not. */
function startProvider() {
  const primary = primaryProvider();
  const fb = fallbackProvider();
  return fb && isDown(primary) && !isDown(fb) ? fb : primary;
}

function otherProvider(provider) {
  const primary = primaryProvider();
  const fb = fallbackProvider();
  if (!fb) return null;
  return provider === primary ? fb : primary;
}

function _resetProviderState() {
  downUntil.clear();
  lastIssueAlertAt.clear();
  require('./anthropic')._resetAnthropicState();
}

/**
 * Main AI call — routes to correct provider (opts.provider overrides AI_PROVIDER for one call).
 */
async function generateAIReply(systemPrompt, userMessage, history = [], opts = {}) {
  opts = opts || {};
  const provider = opts.provider || primaryProvider();
  try {
    if (provider === 'openai') return await callOpenAI(systemPrompt, userMessage, history);
    if (provider === 'anthropic') return await callAnthropic(systemPrompt, userMessage, opts);
    return await callGemini(systemPrompt, userMessage, opts);
  } catch (err) {
    const blocked = err.blocked || (provider === 'anthropic' ? null : blockReasonOfError(err));
    if (blocked) {
      err.blocked = blocked;
      console.warn(`[ai] blocked ${JSON.stringify({ provider, reason: blocked, conv: opts.conversationId || null, attempt: opts.attempt || 1 })}`);
      throw err;
    }
    console.error(`[AI][${provider}] Call failed:`, err.message);
    throw err;
  }
}

/**
 * Legacy path (restaurant / clinic): one call, and — only when AI_FALLBACK_PROVIDER is set — the same call
 * once on the fallback when the first provider failed in a way retrying it would not fix.
 */
async function legacyCall(systemPrompt, userMessage, history, callOpts) {
  const provider = startProvider();
  try {
    return await generateAIReply(systemPrompt, userMessage, history, { ...callOpts, provider });
  } catch (err) {
    const other = otherProvider(provider);
    if (err.blocked || !other) throw err;
    const kind = classifyProviderError(err, provider);
    if (FATAL_KINDS.includes(kind)) {
      markDown(provider);
      reportProviderIssue(provider, kind, other, err, callOpts);
    }
    if (![...SWITCH_KINDS, 'transient', 'timeout'].includes(kind)) throw err;
    console.warn(`[AI] failover ${provider} → ${other} (${kind})`);
    return generateAIReply(systemPrompt, userMessage, history, { ...callOpts, provider: other });
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
    cacheSystem: opts.cacheSystem,
    onProviderIssue: opts.onProviderIssue,
  };
  for (const key of Object.keys(callOpts)) if (callOpts[key] === undefined) delete callOpts[key];

  if (typeof opts.deadlineAt === 'number') {
    return deadlineReply(systemPrompt, userMessage, history, opts, { validActions, correctionPrompt, enums, callOpts });
  }

  // First attempt
  let raw;
  try {
    raw = await legacyCall(systemPrompt, userMessage, history, { ...callOpts, attempt: 1 });
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
    raw = await legacyCall(systemPrompt, correctionMessage, history, { ...callOpts, attempt: 2 });
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
 * Deadline mode (SHIFT): one absolute deadline shared by the whole reply, spent over a few attempts.
 *
 * Measured on the six 2026-09-17 simulations (64 real Gemini calls, 11 failures = 17%):
 *   - 7 of the 11 were `503 Service Unavailable — high demand`, returned in 0.4–1.3 s. The old code
 *     spent one of its two attempts on each, and one conversation burned BOTH attempts on two 503s
 *     inside 0.94 s and then answered «تأخر ردّي» with 24 s of deadline still unused.
 *   - 4 were true aborts at the per-attempt cap (15 s, then 10 s for the retry).
 *   - successful calls: p50 5.3 s, p90 12.1 s, max 14.2 s — so the 15 s first cap is right, and
 *     lowering it would abort healthy calls; the tail is prompt-size bound (p90 7.6 s at ~4k prompt
 *     tokens vs 12.5 s at ~6k), which is why a retry after a TIMEOUT resends a shrunk turn.
 *
 * So: a transient upstream failure (5xx / 429 / socket) is not an attempt — it is retried at once,
 * as often as the deadline allows, and the fallback is only reached when no retry fits any more.
 */
const TRANSIENT_BACKOFF_MS = 250;
const envInt = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const MAX_TRANSIENT_RETRIES = envInt('GEMINI_MAX_TRANSIENT_RETRIES', 4);
// Real answers the model gets per reply. Two, as before — except after an attempt that timed out:
// then a third is allowed if the deadline still holds one, because silence is the worst answer and a
// hung socket says nothing about the next call. A badly-formed answer still gets its one correction.
const BASE_ATTEMPTS = 2;
// Never below BASE_ATTEMPTS: a timeout must not be able to REDUCE what the reply is allowed.
const MAX_ATTEMPTS = Math.max(BASE_ATTEMPTS, envInt('GEMINI_MAX_ATTEMPTS', 3));

// Failover: a turn moves to the fallback provider after this many transient failures in a row on one
// provider (a persistent 5xx / 529), and after a timeout only if at least this much deadline is left.
const FAILOVER_AFTER_TRANSIENT = Math.max(1, envInt('AI_FAILOVER_AFTER_TRANSIENT', 2));
const FAILOVER_MIN_MS = envInt('AI_FAILOVER_MIN_MS', 4000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function deadlineReply(systemPrompt, userMessage, history, opts, { validActions, correctionPrompt, enums, callOpts }) {
  const remaining = () => opts.deadlineAt - Date.now();
  const firstAttemptMs = opts.firstAttemptMs || DEFAULT_FIRST_ATTEMPT_MS;
  const tag = opts.conversationId ? ` conv=${opts.conversationId}` : '';

  let attempts = 0;          // model answers (or timeouts) so far — transient failures do not count
  let transientRetries = 0;
  let invalidCount = 0;
  // Sticky: once the model has answered badly the correction prompt rides every later attempt, even
  // if a 503 or a timeout came in between.
  let answeredBadly = false;
  let lastFailure = null;    // 'invalid' | 'timeout' | 'transient' | 'error'
  let sawTimeout = false;
  // The model used the whole output budget on hidden thinking and produced no parsable JSON.
  let sawTokenLimit = false;
  const onFinish = (reason) => { if (reason === 'MAX_TOKENS') sawTokenLimit = true; };
  const maxAttempts = () => (sawTimeout ? MAX_ATTEMPTS : BASE_ATTEMPTS);

  // Failover state for this turn. A provider that failed with billing / auth / not_found / a 400 is out for
  // the rest of the turn (retrying it cannot help); a timeout or persistent overload moves the turn over
  // but leaves the provider usable if the other one then fails hard.
  let provider = startProvider();
  const outForTurn = new Set();
  let providerTransient = 0;
  const alternative = () => {
    const other = otherProvider(provider);
    return other && !outForTurn.has(other) ? other : null;
  };
  const switchTo = (next, why) => {
    console.warn(`[AI] failover ${provider} → ${next} (${why})${tag}`);
    provider = next;
    providerTransient = 0;
  };

  while (attempts < maxAttempts()) {
    if (attempts > 0 || transientRetries > 0) {
      if (remaining() < MIN_RETRY_MS) break;
      if (typeof opts.onRetry === 'function') {
        try {
          await opts.onRetry();
        } catch (err) {
          console.warn(`[AI] onRetry failed${tag}:`, err.message);
        }
      }
      if (lastFailure === 'transient' || lastFailure === 'error') await sleep(TRANSIENT_BACKOFF_MS);
      // onRetry renews the lease and re-posts the typing indicator; both cost time. If they used up what
      // was left there is no attempt to make, and the customer must not be shown a typing dot for nothing.
      if (remaining() < MIN_RETRY_MS) break;
    }
    if (remaining() <= 0) break;

    attempts += 1;
    // Everything left goes to the last attempt we are allowed; before that, one attempt may not eat
    // the whole deadline (attempt 1 = 15 s of 25 s, attempt 2 = the 10 s that remain).
    // The first attempt gets the full cap — healthy calls reach 14.7 s and none of them should be thrown
    // away — and a retry gets less, so a third chance still fits when both hang.
    const cap = attempts === 1 ? firstAttemptMs : RETRY_ATTEMPT_MS;
    const attemptMs = attempts >= maxAttempts() ? remaining() : Math.min(cap, remaining());
    if (attemptMs <= 0) break;

    // The correction prompt only helps when the model answered badly, not when it timed out. A retry
    // after a timeout resends the shrunk turn instead: half the prompt is roughly half the latency.
    let message = userMessage;
    if (answeredBadly) message = `${userMessage}\n\n${correctionPrompt}`;
    else if (sawTimeout && opts.retryUserMessage) message = opts.retryUserMessage;
    const system = attempts > 1 && opts.retrySystemPrompt ? opts.retrySystemPrompt : systemPrompt;

    // After a MAX_TOKENS finish, thinking off and double the room: the same call with the same budget
    // would run out the same way.
    const budgetOpts = sawTokenLimit
      ? { thinkingOff: true, tokenLimitHit: true, maxOutputTokens: (Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 2048) * 2 }
      : {};
    try {
      const raw = await generateAIReply(system, message, history, {
        ...callOpts, ...budgetOpts, onFinish, attemptMs, attempt: attempts, provider,
      });
      const parsed = parseModelJSON(raw, opts.jsonMode);
      const validation = validateAIResult(parsed, validActions, enums);
      if (validation.valid) return parsed;
      invalidCount += 1;
      answeredBadly = true;
      lastFailure = 'invalid';
      console.warn(`[AI] attempt ${attempts} invalid (${validation.reason})${tag}`);
      // One correction prompt, as before: a model that answered badly twice will not answer well next.
      if (invalidCount >= 2 || attempts >= maxAttempts() || remaining() < MIN_RETRY_MS) {
        const repaired = validation.repairable && repairResult(parsed, validActions, enums);
        if (repaired) return repaired;
        if (invalidCount >= 2) break;
      }
    } catch (err) {
      // A refusal is not a slow answer: a correction prompt will not change it.
      if (reportBlocked(err, opts)) return null;
      const kind = classifyProviderError(err, provider);
      console.error(`[AI] attempt ${attempts} ${provider} ${kind}${tag}:`, err.message);
      if (SWITCH_KINDS.includes(kind)) {
        // Retrying the same provider cannot fix it. It cost milliseconds, not an answer: not an attempt.
        attempts -= 1;
        lastFailure = kind;
        outForTurn.add(provider);
        const next = alternative();
        if (FATAL_KINDS.includes(kind)) {
          markDown(provider);
          reportProviderIssue(provider, kind, next, err, opts);
        }
        if (!next) break;
        switchTo(next, kind);
      } else if (kind === 'timeout') {
        lastFailure = 'timeout';
        sawTimeout = true;
        const next = alternative();
        if (next && remaining() >= FAILOVER_MIN_MS) switchTo(next, 'timeout');
      } else if (kind === 'transient' && transientRetries < MAX_TRANSIENT_RETRIES) {
        // Not an attempt: it failed upstream in milliseconds and the deadline is untouched.
        transientRetries += 1;
        providerTransient += 1;
        attempts -= 1;
        lastFailure = kind;
        // Persistent overload on this provider: the next try goes to the other one.
        const next = providerTransient >= FAILOVER_AFTER_TRANSIENT ? alternative() : null;
        if (next) switchTo(next, 'transient');
      } else {
        lastFailure = kind;
        const next = kind === 'transient' ? alternative() : null;
        if (next) switchTo(next, 'transient');
      }
    }
  }

  console.error(`[AI] all attempts failed${tag} (attempts=${attempts} transient=${transientRetries} left=${Math.max(0, remaining())}ms) for message: "${String(userMessage).slice(0, 50)}"`);
  return null;
}

module.exports = {
  generateAIReply,
  generateValidatedAIReply,
  extractJSON,
  validateAIResult,
  resolveModel,
  primaryProvider,
  fallbackProvider,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_ANTHROPIC_MODEL,
  _resetProviderState,
  VALID_ACTIONS,
  CORRECTION_PROMPT,
};
