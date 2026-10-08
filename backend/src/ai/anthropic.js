/**
 * Claude (Anthropic Messages API) for ai/provider.js — same contract as callGemini: resolves to the model's
 * text, throws on failure, throws a `blocked` error on a refusal, reports the finish through opts.onFinish
 * (normalised: `max_tokens` → 'MAX_TOKENS', so the deadline loop's token-limit retry works unchanged) and
 * writes one `[ai]` usage line per call.
 *
 * Request shape (Claude Opus 5.5 by default since 2026-10-08 — owner: «use something really smart»):
 *  - no temperature / top_p / top_k (non-default values 400), no budget_tokens (400), no assistant prefill (400)
 *  - thinking: {type:'disabled'} is a 400 on Opus 5.5, Sonnet 5.5 and Fable 5.x. Opus 5.5 and Fable always
 *    think ({type:'adaptive'}; effort is the only control). Sonnet 5.5 turns thinking off with
 *    {type:'between_tools'} (effort high or below only). Older models keep ANTHROPIC_THINKING=off →
 *    {type:'disabled'}; adaptive → {type:'adaptive'} everywhere.
 *  - output_config.effort: ANTHROPIC_EFFORT (default 'low': measured on the challenge exam, 2026-10-08)
 *  - fallbacks:'default' (beta server-side-fallback-2026-07-01): if a safety classifier wrongly declines a
 *    turn, the API re-runs it on Anthropic's recommended fallback model inside the same call, instead of the
 *    customer getting nothing. A whole-chain refusal still arrives as stop_reason 'refusal'.
 *  - output_config.format: the SHIFT responseSchema converted to a JSON schema (structured outputs), when
 *    ANTHROPIC_STRUCTURED is not '0'. A 400 on the schema turns it off for this process and the same turn
 *    is resent once without it (the prompt still asks for JSON only, and the parser takes it from there).
 *  - system: one text block, the static prompt, with a cache_control breakpoint on it. Everything that
 *    changes per turn (dates, stage, lead, history) is in the user message, after the breakpoint.
 *  - the SDK's own retries are off (maxRetries: 0): provider.js owns retry, deadline and failover.
 */

const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
// Thinking is part of every Opus 5.5 answer, so a restaurant/clinic reply needs more than the 15 s a
// thinking-off Sonnet did.
const LEGACY_TIMEOUT_MS = 30000;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Models that cannot run without thinking at all (`disabled` and `between_tools` are both 400s).
const ALWAYS_THINKING_RE = /^claude-(?:opus-5-5|fable-5|mythos-5)/;
// Sonnet 5.5: `disabled` is a 400; its thinking-off setting is `between_tools`, at effort high or below.
const BETWEEN_TOOLS_RE = /^claude-sonnet-5-5/;
const BETWEEN_TOOLS_EFFORTS = ['low', 'medium', 'high'];
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

function alwaysThinks(model) {
  return ALWAYS_THINKING_RE.test(String(model || ''));
}

/** The request's thinking field when thinking is meant to be off, for this model and effort. */
function thinkingOffFor(model, effort) {
  if (alwaysThinks(model)) return { type: 'adaptive' };
  if (BETWEEN_TOOLS_RE.test(String(model || ''))) {
    return BETWEEN_TOOLS_EFFORTS.includes(effort) ? { type: 'between_tools' } : { type: 'adaptive' };
  }
  return { type: 'disabled' };
}

const envInt = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

function anthropicConfig(env = process.env) {
  const model = env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  const thinking = alwaysThinks(model) || env.ANTHROPIC_THINKING === 'adaptive' ? 'adaptive' : 'off';
  const effort = EFFORTS.includes(env.ANTHROPIC_EFFORT) ? env.ANTHROPIC_EFFORT : 'low';
  // A SHIFT reply is ~150–600 output tokens of Arabic JSON (the new tokenizer counts ~30% more than older
  // Claude models). 2048 leaves 3× room with thinking off. Thinking spends from the same budget even though
  // its text is not returned, so a thinking model gets room for both: a cap sized for the reply alone would
  // cut the reply off.
  const maxTokens = envInt('ANTHROPIC_MAX_TOKENS', thinking === 'adaptive' ? 16000 : 2048);
  return {
    model,
    thinking,
    effort,
    maxTokens,
    structured: env.ANTHROPIC_STRUCTURED !== '0',
    // Server-side fallback on a classifier refusal: on unless ANTHROPIC_FALLBACKS=0.
    fallbacks: env.ANTHROPIC_FALLBACKS !== '0',
  };
}

// ─── structured outputs: Gemini responseSchema → JSON schema ─────────────────
//
// Structured outputs need additionalProperties:false on every object and reject maxItems (beyond 0/1),
// string length and numeric bounds; `format: 'enum'` is Gemini-only.
//
// Every property is listed in `required`, and Gemini's `nullable` is dropped rather than turned into
// anyOf [T, null]. Structured outputs cap how many parameters may be union-typed, and on this API an
// optional property counts as one union just as `anyOf` does: the SHIFT schema's 24 fields 400 as
// "too many parameters with union types (21)" when nullable, and as "Schema is too complex" when merely
// optional. Required-everything is the only shape it accepts, and it costs nothing downstream — the model
// writes "" for what it does not know, which lead.js (isEmpty/pickObject) and normalizeActionArgs already
// treat exactly as a missing field.

const converted = new WeakMap();

function toClaudeSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (converted.has(schema)) return converted.get(schema);
  const out = convertNode(schema);
  converted.set(schema, out);
  return out;
}

function convertNode(node) {
  const type = String(node.type || '').toLowerCase();
  let out;
  if (type === 'object') {
    const properties = {};
    for (const key of Object.keys(node.properties || {})) properties[key] = convertNode(node.properties[key]);
    out = { type: 'object', properties, additionalProperties: false };
    const keys = Object.keys(properties);
    if (keys.length) out.required = keys;
  } else if (type === 'array') {
    out = { type: 'array', items: node.items ? convertNode(node.items) : {} };
  } else {
    out = { type: type || 'string' };
    if (Array.isArray(node.enum)) out.enum = [...node.enum];
  }
  if (node.description) out.description = node.description;
  return out;
}

// Once the API has rejected the schema, stop sending it (this process): a schema that 400s would 400 on
// every turn, and every one of them would pay a failover.
let structuredRejected = false;
// Same for the fallback opt-in: if the API ever refuses the parameter, the turn goes out without it.
let fallbacksRejected = false;

// ─── client ──────────────────────────────────────────────────────────────────

function loadSdk() {
  return require('@anthropic-ai/sdk');
}

// Built per call, like the Gemini client: construction is cheap and a key rotation applies at once.
function getClient() {
  const sdk = loadSdk();
  const Anthropic = sdk.Anthropic || sdk.default || sdk;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
}

function blockedError(reason) {
  const err = new Error(`blocked:${reason}`);
  err.blocked = reason;
  return err;
}

function timeoutError(ms) {
  return new Error(`Claude timeout after ${ms}ms`);
}

/**
 * The exact params sent to messages.create — exported for the request-shape tests.
 * `legacy` (restaurant / clinic): plain text, no JSON contract.
 */
function buildRequest(systemPrompt, userMessage, opts = {}, cfg = anthropicConfig()) {
  const legacy = !opts.jsonMode && !opts.systemInstruction && opts.attemptMs === undefined;
  // A model that always thinks never gets thinking off — not even on the token-limit retry (a 400).
  const thinkingOff = cfg.thinking === 'off' || !!opts.thinkingOff;
  // After a max_tokens finish the retry gets twice the room (and thinking off where the model allows it).
  const maxTokens = opts.tokenLimitHit ? cfg.maxTokens * 2 : cfg.maxTokens;
  const systemBlock = { type: 'text', text: String(systemPrompt || '') };
  if (opts.cacheSystem !== false) systemBlock.cache_control = { type: 'ephemeral' };
  const text = legacy ? `رسالة العميل: ${userMessage}` : String(userMessage);
  const params = {
    model: cfg.model,
    max_tokens: maxTokens,
    system: [systemBlock],
    messages: [{ role: 'user', content: text }],
    thinking: thinkingOff ? thinkingOffFor(cfg.model, cfg.effort) : { type: 'adaptive' },
    output_config: { effort: cfg.effort },
  };
  if (opts.jsonMode && opts.responseSchema && cfg.structured && !structuredRejected) {
    params.output_config.format = { type: 'json_schema', schema: toClaudeSchema(opts.responseSchema) };
  }
  if (cfg.fallbacks && !fallbacksRejected) {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = 'default';
  }
  return params;
}

function textOf(message) {
  const blocks = Array.isArray(message && message.content) ? message.content : [];
  return blocks.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
}

function logUsage(fields) {
  console.log('[ai] ' + JSON.stringify(fields));
}

async function callAnthropic(systemPrompt, userMessage, opts = {}) {
  const cfg = anthropicConfig();
  const attemptMs = opts.attemptMs === undefined ? LEGACY_TIMEOUT_MS : Math.max(0, opts.attemptMs);
  const client = getClient();
  let params = buildRequest(systemPrompt, userMessage, opts, cfg);

  const started = Date.now();
  let message = null;
  let ok = false;
  let error = null;
  try {
    const send = async (p, ms) => {
      const controller = new AbortController();
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(timeoutError(attemptMs));
        }, ms);
      });
      try {
        // The SDK timeout aborts the request; the JS race also covers a mocked or hung client.
        const endpoint = p.betas && client.beta && client.beta.messages ? client.beta.messages : client.messages;
        const request = endpoint.create(p, { timeout: Math.max(1, ms), maxRetries: 0, signal: controller.signal });
        return await Promise.race([Promise.resolve(request), timeout]);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      message = await send(params, attemptMs);
    } catch (err) {
      // Two request features the API could refuse wholesale. Either way the same turn is resent once
      // without it (for this process), rather than every turn paying a failover for a 400.
      const sdk = loadSdk();
      const badRequest = typeof sdk.BadRequestError === 'function' && err instanceof sdk.BadRequestError
        && !/credit balance/i.test(String(err.message));
      if (badRequest && params.fallbacks && /fallback/i.test(String(err.message))) {
        fallbacksRejected = true;
        console.error(`[ai] Claude rejected the fallback opt-in — sending without it from now on: ${String(err.message).slice(0, 300)}`);
      } else if (badRequest && params.output_config && params.output_config.format
        && /schema|output_config|format/i.test(String(err.message))) {
        structuredRejected = true;
        console.error(`[ai] Claude rejected the structured-output schema — JSON by prompt from now on: ${String(err.message).slice(0, 300)}`);
      } else {
        throw err;
      }
      params = buildRequest(systemPrompt, userMessage, opts, cfg);
      const left = attemptMs - (Date.now() - started);
      if (left < 1000) throw err;
      message = await send(params, left);
    }

    const stop = message && message.stop_reason;
    // Checked before the content is read: a refused turn's text (if any) must not reach the customer.
    if (stop === 'refusal') throw blockedError('REFUSAL');
    const text = textOf(message);
    ok = true;
    return text;
  } catch (err) {
    error = err;
    throw err;
  } finally {
    const usage = (message && message.usage) || {};
    const stop = (message && message.stop_reason) || null;
    if (typeof opts.onFinish === 'function') {
      try {
        opts.onFinish(stop === 'max_tokens' ? 'MAX_TOKENS' : stop);
      } catch (cbErr) {
        console.warn('[ai] onFinish failed:', cbErr.message);
      }
    }
    logUsage({
      provider: 'anthropic',
      model: cfg.model,
      ms: Date.now() - started,
      in: usage.input_tokens ?? null,
      out: usage.output_tokens ?? null,
      cache_read: usage.cache_read_input_tokens ?? null,
      cache_write: usage.cache_creation_input_tokens ?? null,
      finish: stop,
      thinking: params.thinking.type,
      effort: cfg.effort,
      // Which model actually answered: differs from `model` only when a fallback served the turn.
      ...(message && message.model && message.model !== cfg.model ? { served_by: message.model } : {}),
      structured: !!(params.output_config && params.output_config.format),
      conv: opts.conversationId || null,
      attempt: opts.attempt || 1,
      ok,
      ...(error && !ok ? { status: error.status ?? null } : {}),
    });
  }
}

function _resetAnthropicState() {
  structuredRejected = false;
  fallbacksRejected = false;
}

module.exports = {
  callAnthropic,
  buildRequest,
  anthropicConfig,
  toClaudeSchema,
  textOf,
  DEFAULT_ANTHROPIC_MODEL,
  alwaysThinks,
  thinkingOffFor,
  _resetAnthropicState,
};
