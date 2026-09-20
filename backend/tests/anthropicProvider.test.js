/**
 * AI_PROVIDER=anthropic (Claude Sonnet 5) and AI_FALLBACK_PROVIDER failover, offline: both SDKs are mocked.
 * The Anthropic mock keeps the SDK's REAL error classes, so the classifier is tested against what the SDK
 * actually throws.
 *
 *   A. request shape       B. stop_reason       C. error classification       D. failover + alerts
 */
require('./setup');

const mockCreate = jest.fn();
const mockClientOpts = [];
jest.mock('@anthropic-ai/sdk', () => {
  const actual = jest.requireActual('@anthropic-ai/sdk');
  function FakeAnthropic(opts) {
    mockClientOpts.push(opts);
    this.messages = { create: (...args) => mockCreate(...args) };
  }
  for (const k of ['APIError', 'BadRequestError', 'AuthenticationError', 'PermissionDeniedError', 'NotFoundError',
    'RateLimitError', 'InternalServerError', 'APIConnectionError', 'APIConnectionTimeoutError', 'APIUserAbortError']) {
    FakeAnthropic[k] = actual[k];
  }
  return FakeAnthropic;
});

const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({ generateContent: mockGenerateContent }));
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({ getGenerativeModel: mockGetGenerativeModel })),
}));

const Anthropic = jest.requireActual('@anthropic-ai/sdk');
const provider = require('../src/ai/provider');
const { buildRequest, toClaudeSchema, anthropicConfig } = require('../src/ai/anthropic');
const { classifyAnthropic, classifyGeneric } = require('../src/ai/errors');
const { RESPONSE_SCHEMA, RESPONSE_SCHEMA_V1 } = require('../src/workflows/shift/actions');
const promptAr = require('../src/workflows/shift/prompt.ar');

const { generateValidatedAIReply, _resetProviderState } = provider;

const GOOD = { reply: 'أهلا فيك', action: 'NONE', stage: 'discovery', next_step: 'question' };
const USAGE = { input_tokens: 812, output_tokens: 96, cache_read_input_tokens: 5120, cache_creation_input_tokens: 0 };
const claudeMsg = (obj, extra = {}) => ({
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
  stop_reason: 'end_turn',
  usage: USAGE,
  ...extra,
});
const geminiReply = (obj) => ({
  response: { text: () => JSON.stringify(obj), usageMetadata: {}, candidates: [{ finishReason: 'STOP' }] },
});
const apiErr = (status, type, message) => Anthropic.APIError.generate(
  status, { type: 'error', error: { type, message } }, undefined, new Headers(),
);
const creditErr = () => apiErr(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.');
const gemini402 = () => Object.assign(
  new Error('[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: [402 Payment Required] Your prepayment credits are depleted.'),
  { status: 402 },
);
const never = () => new Promise(() => {});

const shiftOpts = (extra = {}) => ({
  validActions: ['NONE', 'FLAG_FOR_TEAM'],
  jsonMode: true,
  systemInstruction: true,
  responseSchema: RESPONSE_SCHEMA,
  deadlineAt: Date.now() + 30000,
  conversationId: 'conv_1',
  ...extra,
});

const ENV_KEYS = ['AI_PROVIDER', 'AI_FALLBACK_PROVIDER', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_THINKING',
  'ANTHROPIC_EFFORT', 'ANTHROPIC_MAX_TOKENS', 'ANTHROPIC_STRUCTURED', 'AI_PROVIDER_COOLDOWN_MS', 'AI_PROVIDER_ALERT_MS', 'GEMINI_API_KEY'];
const saved = {};
let logSpy;

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.AI_PROVIDER = 'anthropic';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.GEMINI_API_KEY = 'test_gemini_key';
  for (const k of ['AI_FALLBACK_PROVIDER', 'ANTHROPIC_MODEL', 'ANTHROPIC_THINKING', 'ANTHROPIC_EFFORT', 'ANTHROPIC_MAX_TOKENS',
    'ANTHROPIC_STRUCTURED', 'AI_PROVIDER_COOLDOWN_MS', 'AI_PROVIDER_ALERT_MS']) delete process.env[k];
  mockCreate.mockReset();
  mockClientOpts.length = 0;
  mockGenerateContent.mockReset();
  mockGetGenerativeModel.mockClear();
  _resetProviderState();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const walk = (node, fn, path = '$') => {
  if (!node || typeof node !== 'object') return;
  fn(node, path);
  for (const [k, v] of Object.entries(node)) walk(v, fn, `${path}.${k}`);
};

// ─── A. request shape ────────────────────────────────────────────────────────

describe('A. request shape', () => {
  test('A1. SHIFT call: claude-sonnet-5, cached system block, one user turn, thinking off, effort low, structured output', async () => {
    mockCreate.mockResolvedValue(claudeMsg(GOOD));
    const result = await generateValidatedAIReply('STATIC SYSTEM', 'USER TURN (dates, stage, lead)', [], shiftOpts());

    expect(result).toEqual(expect.objectContaining({ reply: 'أهلا فيك', action: 'NONE' }));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [params, reqOpts] = mockCreate.mock.calls[0];
    expect(params).toEqual({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      system: [{ type: 'text', text: 'STATIC SYSTEM', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'USER TURN (dates, stage, lead)' }],
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: toClaudeSchema(RESPONSE_SCHEMA) } },
    });
    for (const forbidden of ['temperature', 'top_p', 'top_k']) expect(params).not.toHaveProperty(forbidden);
    expect(JSON.stringify(params)).not.toContain('budget_tokens');
    expect(params.messages.every((m) => m.role === 'user')).toBe(true); // no assistant prefill
    expect(reqOpts.maxRetries).toBe(0);
    expect(reqOpts.timeout).toBeGreaterThan(0);
    expect(reqOpts.timeout).toBeLessThanOrEqual(15000);
    expect(reqOpts.signal).toBeDefined();
    expect(mockClientOpts[0]).toEqual({ apiKey: 'sk-ant-test', maxRetries: 0 });
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  test('A2. ANTHROPIC_MODEL / ANTHROPIC_THINKING=adaptive / ANTHROPIC_EFFORT / ANTHROPIC_MAX_TOKENS', () => {
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-5-test';
    process.env.ANTHROPIC_THINKING = 'adaptive';
    process.env.ANTHROPIC_EFFORT = 'medium';
    let p = buildRequest('S', 'U', { jsonMode: true, systemInstruction: true, attemptMs: 1000 });
    expect(p.model).toBe('claude-sonnet-5-test');
    expect(p.thinking).toEqual({ type: 'adaptive' });
    expect(p.output_config.effort).toBe('medium');
    expect(p.max_tokens).toBe(4096);
    process.env.ANTHROPIC_MAX_TOKENS = '3000';
    process.env.ANTHROPIC_EFFORT = 'bogus';
    p = buildRequest('S', 'U', { jsonMode: true, systemInstruction: true, attemptMs: 1000 });
    expect(p.max_tokens).toBe(3000);
    expect(p.output_config.effort).toBe('low');
    process.env.ANTHROPIC_THINKING = 'bogus';
    expect(anthropicConfig().thinking).toBe('off');
  });

  test('A3. the response schema fits structured outputs: additionalProperties:false and every property required, no maxItems / nullable / format / union', () => {
    for (const schema of [RESPONSE_SCHEMA, RESPONSE_SCHEMA_V1]) {
      const out = toClaudeSchema(schema);
      walk(out, (node, path) => {
        expect({ path, nullable: node.nullable }).toEqual({ path, nullable: undefined });
        expect({ path, format: node.format }).toEqual({ path, format: undefined });
        expect({ path, maxItems: node.maxItems }).toEqual({ path, maxItems: undefined });
        expect({ path, anyOf: node.anyOf }).toEqual({ path, anyOf: undefined });
        if (node.type === 'object') {
          expect({ path, ap: node.additionalProperties }).toEqual({ path, ap: false });
          // A union-typed parameter is what the API counts, and an optional property is one: every
          // property is required so the schema stays inside the cap (see toClaudeSchema).
          expect({ path, required: node.required }).toEqual({ path, required: Object.keys(node.properties) });
        }
      });
    }
    const out = toClaudeSchema(RESPONSE_SCHEMA);
    expect(out.properties.action).toEqual({ type: 'string', enum: RESPONSE_SCHEMA.properties.action.enum });
    expect(out.properties.lead.properties.city).toEqual({ type: 'string' });
    expect(out.properties.buttons.items.required).toEqual(['id', 'title']);
    // Deterministic: the same object every call, so the request bytes (and the schema cache) never vary.
    expect(toClaudeSchema(RESPONSE_SCHEMA)).toBe(out);
  });

  test('A4. ANTHROPIC_STRUCTURED=0 → no format (JSON by prompt + the existing parser, fenced JSON included)', async () => {
    process.env.ANTHROPIC_STRUCTURED = '0';
    mockCreate.mockResolvedValue(claudeMsg('```json\n' + JSON.stringify(GOOD) + '\n```'));
    const result = await generateValidatedAIReply('S', 'U', [], shiftOpts());
    expect(result.reply).toBe('أهلا فيك');
    expect(mockCreate.mock.calls[0][0].output_config).toEqual({ effort: 'low' });
  });

  test('A5. cacheSystem:false (prompt v1: date + history in the system prompt) → no cache_control', () => {
    const p = buildRequest('S', 'U', { jsonMode: true, systemInstruction: true, attemptMs: 1000, cacheSystem: false });
    expect(p.system).toEqual([{ type: 'text', text: 'S' }]);
  });

  test('A6. legacy (restaurant / clinic) call: plain text turn, no JSON schema', async () => {
    mockCreate.mockResolvedValue(claudeMsg('{"reply":"أهلا","action":"NONE"}'));
    const result = await generateValidatedAIReply('SYSTEM', 'بدي برغر');
    expect(result.reply).toBe('أهلا');
    const [params] = mockCreate.mock.calls[0];
    expect(params.messages).toEqual([{ role: 'user', content: 'رسالة العميل: بدي برغر' }]);
    expect(params.output_config).toEqual({ effort: 'low' });
    expect(params.system[0].text).toBe('SYSTEM');
  });

  test('A7. the cached prefix (the SHIFT static prompt) is byte-stable: no date, time or per-conversation data', () => {
    for (const sector of [undefined, 'clinic', 'restaurant', 'store', 'other']) {
      for (const bookingMode of ['inchat', 'calendly']) {
        const a = promptAr.buildStaticPrompt({ sector, bookingMode });
        const b = promptAr.buildStaticPrompt({ sector, bookingMode });
        expect(a).toBe(b);
        expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}/);
        expect(a).not.toMatch(/\{\{/);
        expect(a.length).toBeGreaterThan(4000); // well above the 1024-token cache minimum
      }
    }
  });

  test('A8. the [ai] usage line carries provider, tokens, cache read/write, ms, finish', async () => {
    mockCreate.mockResolvedValue(claudeMsg(GOOD));
    await generateValidatedAIReply('S', 'U', [], shiftOpts());
    const line = logSpy.mock.calls.map((c) => c[0]).find((l) => typeof l === 'string' && l.startsWith('[ai] '));
    const fields = JSON.parse(line.slice(5));
    expect(fields).toEqual(expect.objectContaining({
      provider: 'anthropic', model: 'claude-sonnet-5', in: 812, out: 96, cache_read: 5120, cache_write: 0,
      finish: 'end_turn', thinking: 'disabled', effort: 'low', structured: true, conv: 'conv_1', attempt: 1, ok: true,
    }));
    expect(typeof fields.ms).toBe('number');
  });
});

// ─── B. stop_reason ──────────────────────────────────────────────────────────

describe('B. stop_reason', () => {
  test('B1. max_tokens → the retry gets thinking off and twice the room, like Gemini MAX_TOKENS', async () => {
    process.env.ANTHROPIC_THINKING = 'adaptive';
    mockCreate
      .mockResolvedValueOnce(claudeMsg('{"reply":"أهلا ف', { stop_reason: 'max_tokens' }))
      .mockResolvedValueOnce(claudeMsg(GOOD));
    const result = await generateValidatedAIReply('S', 'U', [], shiftOpts());
    expect(result.reply).toBe('أهلا فيك');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[0][0]).toEqual(expect.objectContaining({ thinking: { type: 'adaptive' }, max_tokens: 4096 }));
    expect(mockCreate.mock.calls[1][0]).toEqual(expect.objectContaining({ thinking: { type: 'disabled' }, max_tokens: 8192 }));
  });

  test('B2. refusal → the blocked path (onBlocked, null), content not read, no retry, no failover', async () => {
    process.env.AI_FALLBACK_PROVIDER = 'gemini';
    mockCreate.mockResolvedValue(claudeMsg(GOOD, { stop_reason: 'refusal', stop_details: { category: null } }));
    const onBlocked = jest.fn();
    const onProviderIssue = jest.fn();
    const result = await generateValidatedAIReply('S', 'U', [], shiftOpts({ onBlocked, onProviderIssue }));
    expect(result).toBeNull();
    expect(onBlocked).toHaveBeenCalledWith('REFUSAL');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(onProviderIssue).not.toHaveBeenCalled();
  });

  test('B3. only text blocks are read (thinking blocks skipped)', async () => {
    process.env.ANTHROPIC_THINKING = 'adaptive';
    mockCreate.mockResolvedValue({
      content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: JSON.stringify(GOOD) }],
      stop_reason: 'end_turn',
      usage: USAGE,
    });
    expect((await generateValidatedAIReply('S', 'U', [], shiftOpts())).reply).toBe('أهلا فيك');
  });

  test('B4. a schema the API rejects: structured outputs off for the process, the same turn resent once without it', async () => {
    mockCreate
      .mockRejectedValueOnce(apiErr(400, 'invalid_request_error', 'output_config.format.schema: too many union types'))
      .mockResolvedValueOnce(claudeMsg(GOOD))
      .mockResolvedValueOnce(claudeMsg(GOOD));
    expect((await generateValidatedAIReply('S', 'U', [], shiftOpts())).reply).toBe('أهلا فيك');
    expect(mockCreate.mock.calls[0][0].output_config.format).toBeDefined();
    expect(mockCreate.mock.calls[1][0].output_config.format).toBeUndefined();
    await generateValidatedAIReply('S', 'U', [], shiftOpts());
    expect(mockCreate.mock.calls[2][0].output_config.format).toBeUndefined();
  });
});

// ─── C. classification ───────────────────────────────────────────────────────

describe('C. error classification', () => {
  const timeoutErr = new Anthropic.APIConnectionTimeoutError();
  const connErr = new Anthropic.APIConnectionError({ message: 'Connection error.' });
  test.each([
    ['400 credit balance too low', creditErr(), 'billing'],
    ['402 billing_error', apiErr(402, 'billing_error', 'Payment required'), 'billing'],
    ['401 authentication_error', apiErr(401, 'authentication_error', 'invalid x-api-key'), 'auth'],
    ['403 permission_error', apiErr(403, 'permission_error', 'not allowed'), 'auth'],
    ['404 not_found_error (model)', apiErr(404, 'not_found_error', 'model: claude-sonnet-9'), 'not_found'],
    ['400 other invalid_request_error', apiErr(400, 'invalid_request_error', 'messages: roles must alternate'), 'bad_request'],
    ['413 request_too_large', apiErr(413, 'request_too_large', 'too large'), 'bad_request'],
    ['429 rate_limit_error', apiErr(429, 'rate_limit_error', 'slow down'), 'transient'],
    ['500 api_error', apiErr(500, 'api_error', 'Internal'), 'transient'],
    ['529 overloaded_error', apiErr(529, 'overloaded_error', 'Overloaded'), 'transient'],
    ['SDK request timeout', timeoutErr, 'timeout'],
    ['connection error', connErr, 'transient'],
    ['our own race timeout', new Error('Claude timeout after 15000ms'), 'timeout'],
  ])('anthropic: %s → %s', (_, err, kind) => {
    expect(classifyAnthropic(err, Anthropic)).toBe(kind);
  });

  test.each([
    ['402 prepayment credits depleted (2026-09-19 outage)', gemini402(), 'billing'],
    ['402 by message only', new Error('[402 Payment Required] Your prepayment credits are depleted'), 'billing'],
    ['400 API key not valid', Object.assign(new Error('[400 Bad Request] API key not valid. Please pass a valid API key. [API_KEY_INVALID]'), { status: 400 }), 'auth'],
    ['403 permission denied', Object.assign(new Error('[403 Forbidden] PERMISSION_DENIED'), { status: 403 }), 'auth'],
    ['404 model', Object.assign(new Error('[404 Not Found] models/gemini-x is not found'), { status: 404 }), 'not_found'],
    ['400 bad request', Object.assign(new Error('[400 Bad Request] Invalid JSON payload'), { status: 400 }), 'bad_request'],
    ['503 high demand', Object.assign(new Error('[503 Service Unavailable] The model is overloaded'), { status: 503 }), 'transient'],
    ['429 quota', Object.assign(new Error('[429 Too Many Requests] Resource exhausted'), { status: 429 }), 'transient'],
    ['socket', new Error('fetch failed'), 'transient'],
    ['abort', new Error('Request aborted when fetching'), 'timeout'],
    ['our race timeout', new Error('Gemini timeout after 15000ms'), 'timeout'],
    ['unknown', new Error('boom'), 'error'],
  ])('gemini: %s → %s', (_, err, kind) => {
    expect(classifyGeneric(err)).toBe(kind);
  });
});

// ─── D. failover ─────────────────────────────────────────────────────────────

describe('D. failover within the deadline', () => {
  beforeEach(() => {
    process.env.AI_FALLBACK_PROVIDER = 'gemini';
  });

  test('D1. Claude out of credit → the same turn answered by Gemini, no fallback line, owner alerted', async () => {
    mockCreate.mockRejectedValue(creditErr());
    mockGenerateContent.mockResolvedValue(geminiReply(GOOD));
    const onProviderIssue = jest.fn();
    const onRetry = jest.fn();
    const result = await generateValidatedAIReply('S', 'U', [], shiftOpts({ onProviderIssue, onRetry }));
    expect(result.reply).toBe('أهلا فيك');
    expect(mockCreate).toHaveBeenCalledTimes(1); // a billing error is never retried on the same provider
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    // Gemini got the same turn, with the same system prompt and schema.
    expect(mockGetGenerativeModel.mock.calls[0][0].systemInstruction).toBe('S');
    expect(mockGetGenerativeModel.mock.calls[0][0].generationConfig.responseSchema).toBe(RESPONSE_SCHEMA);
    expect(mockGenerateContent.mock.calls[0][0].contents[0].parts[0].text).toBe('U');
    expect(onProviderIssue).toHaveBeenCalledTimes(1);
    expect(onProviderIssue.mock.calls[0][0]).toEqual({
      provider: 'anthropic', kind: 'billing', next: 'gemini', summary: 'رصيد Claude خلص — البوت شغّال على Gemini',
    });
  });

  test('D2. the reverse: Gemini primary with 402 prepayment depleted → Claude answers', async () => {
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_FALLBACK_PROVIDER = 'anthropic';
    mockGenerateContent.mockRejectedValue(gemini402());
    mockCreate.mockResolvedValue(claudeMsg(GOOD));
    const onProviderIssue = jest.fn();
    const result = await generateValidatedAIReply('S', 'U', [], shiftOpts({ onProviderIssue }));
    expect(result.reply).toBe('أهلا فيك');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(onProviderIssue.mock.calls[0][0].summary).toBe('رصيد Gemini خلص — البوت شغّال على Claude');
  });

  test('D3. both out of credit → null (the caller sends its fallback line once), each provider tried once', async () => {
    mockCreate.mockRejectedValue(creditErr());
    mockGenerateContent.mockRejectedValue(gemini402());
    const onProviderIssue = jest.fn();
    const started = Date.now();
    expect(await generateValidatedAIReply('S', 'U', [], shiftOpts({ onProviderIssue }))).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000); // no waiting out the deadline on a dead provider
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(onProviderIssue.mock.calls.map((c) => c[0].summary)).toEqual([
      'رصيد Claude خلص — البوت شغّال على Gemini',
      'رصيد Gemini خلص — ما في مزوّد بديل شغّال — البوت عم يبعت رسالة الاعتذار',
    ]);
  });

  test('D4. no fallback configured: a billing error is not retried on the same provider', async () => {
    delete process.env.AI_FALLBACK_PROVIDER;
    mockCreate.mockRejectedValue(creditErr());
    const onProviderIssue = jest.fn();
    expect(await generateValidatedAIReply('S', 'U', [], shiftOpts({ onProviderIssue }))).toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(onProviderIssue.mock.calls[0][0].summary).toBe('رصيد Claude خلص — ما في مزوّد بديل شغّال — البوت عم يبعت رسالة الاعتذار');
  });

  test('D5. fallback named but its key missing → no failover (validateEnv warned)', async () => {
    delete process.env.GEMINI_API_KEY;
    mockCreate.mockRejectedValue(creditErr());
    expect(await generateValidatedAIReply('S', 'U', [], shiftOpts())).toBeNull();
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  test('D6. a non-retryable 400 is not retried on Claude; it goes straight to Gemini, and no billing alert', async () => {
    mockCreate.mockRejectedValue(apiErr(400, 'invalid_request_error', 'messages: roles must alternate'));
    mockGenerateContent.mockResolvedValue(geminiReply(GOOD));
    const onProviderIssue = jest.fn();
    expect((await generateValidatedAIReply('S', 'U', [], shiftOpts({ onProviderIssue }))).reply).toBe('أهلا فيك');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(onProviderIssue).not.toHaveBeenCalled();
  });

  test('D7. auth 401 and model 404 fail over too, and alert', async () => {
    for (const [err, kind] of [[apiErr(401, 'authentication_error', 'invalid x-api-key'), 'auth'], [apiErr(404, 'not_found_error', 'model: x'), 'not_found']]) {
      _resetProviderState();
      mockCreate.mockReset().mockRejectedValue(err);
      mockGenerateContent.mockReset().mockResolvedValue(geminiReply(GOOD));
      const onProviderIssue = jest.fn();
      expect((await generateValidatedAIReply('S', 'U', [], shiftOpts({ onProviderIssue }))).reply).toBe('أهلا فيك');
      expect(onProviderIssue.mock.calls[0][0].kind).toBe(kind);
    }
  });

  test('D8. one transient 529 is retried on Claude and does not burn an attempt (the correction still fits)', async () => {
    mockCreate
      .mockRejectedValueOnce(apiErr(529, 'overloaded_error', 'Overloaded'))
      .mockResolvedValueOnce(claudeMsg('not json'))
      .mockResolvedValueOnce(claudeMsg(GOOD));
    const result = await generateValidatedAIReply('S', 'U', [], shiftOpts());
    expect(result.reply).toBe('أهلا فيك');
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  test('D9. persistent overload (529 twice) → the turn moves to Gemini', async () => {
    mockCreate.mockRejectedValue(apiErr(529, 'overloaded_error', 'Overloaded'));
    mockGenerateContent.mockResolvedValue(geminiReply(GOOD));
    const onProviderIssue = jest.fn();
    expect((await generateValidatedAIReply('S', 'U', [], shiftOpts({ onProviderIssue }))).reply).toBe('أهلا فيك');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(onProviderIssue).not.toHaveBeenCalled(); // overload is not the owner's to fix
  });

  test('D10. a Claude timeout with deadline left → Gemini gets the (shrunk) turn inside the same deadline', async () => {
    mockCreate.mockImplementation(never);
    mockGenerateContent.mockResolvedValue(geminiReply(GOOD));
    const started = Date.now();
    const result = await generateValidatedAIReply('S', 'U', [], shiftOpts({
      deadlineAt: started + 8000, firstAttemptMs: 300, retryUserMessage: 'U-short',
    }));
    expect(result.reply).toBe('أهلا فيك');
    expect(Date.now() - started).toBeLessThan(3000);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockGenerateContent.mock.calls[0][0].contents[0].parts[0].text).toBe('U-short');
  });

  test('D11. a timeout that leaves too little deadline stays on the same provider', async () => {
    mockCreate.mockImplementationOnce(never).mockResolvedValueOnce(claudeMsg(GOOD));
    const started = Date.now();
    const result = await generateValidatedAIReply('S', 'U', [], shiftOpts({ deadlineAt: started + 3500, firstAttemptMs: 300 }));
    expect(result.reply).toBe('أهلا فيك');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  test('D12. a provider that ran out of credit is skipped by the next turns (cooldown), then tried again', async () => {
    mockCreate.mockRejectedValue(creditErr());
    mockGenerateContent.mockResolvedValue(geminiReply(GOOD));
    await generateValidatedAIReply('S', 'U', [], shiftOpts());
    await generateValidatedAIReply('S', 'U', [], shiftOpts());
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);

    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 6 * 60 * 1000); // past the 5-minute cooldown
    mockCreate.mockReset().mockResolvedValue(claudeMsg(GOOD));
    await generateValidatedAIReply('S', 'U', [], shiftOpts({ deadlineAt: now + 6 * 60 * 1000 + 30000 }));
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('D13. the owner alert is throttled to once an hour per provider', async () => {
    process.env.AI_PROVIDER_COOLDOWN_MS = '0'; // every turn hits Claude again
    mockCreate.mockRejectedValue(creditErr());
    mockGenerateContent.mockResolvedValue(geminiReply(GOOD));
    const onProviderIssue = jest.fn();
    const t0 = Date.now();
    const clock = jest.spyOn(Date, 'now');
    clock.mockReturnValue(t0);
    for (let i = 0; i < 3; i += 1) await generateValidatedAIReply('S', 'U', [], shiftOpts({ onProviderIssue, deadlineAt: t0 + 30000 }));
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(onProviderIssue).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(t0 + 61 * 60 * 1000);
    await generateValidatedAIReply('S', 'U', [], shiftOpts({ onProviderIssue, deadlineAt: t0 + 61 * 60 * 1000 + 30000 }));
    expect(onProviderIssue).toHaveBeenCalledTimes(2);
  });

  test('D14. a throwing or rejecting onProviderIssue never breaks the reply', async () => {
    mockCreate.mockRejectedValue(creditErr());
    mockGenerateContent.mockResolvedValue(geminiReply(GOOD));
    const result = await generateValidatedAIReply('S', 'U', [], shiftOpts({ onProviderIssue: () => { throw new Error('x'); } }));
    expect(result.reply).toBe('أهلا فيك');
    _resetProviderState();
    const r2 = await generateValidatedAIReply('S', 'U', [], shiftOpts({ onProviderIssue: () => Promise.reject(new Error('y')) }));
    expect(r2.reply).toBe('أهلا فيك');
  });

  test('D15. legacy (restaurant / clinic) path fails over too, only when a fallback is configured', async () => {
    mockCreate.mockRejectedValue(apiErr(401, 'authentication_error', 'invalid x-api-key'));
    mockGenerateContent.mockResolvedValue({ response: { text: () => '{"reply":"أهلا","action":"NONE"}' } });
    expect((await generateValidatedAIReply('SYSTEM', 'بدي برغر')).reply).toBe('أهلا');
    expect(mockGenerateContent.mock.calls[0]).toEqual(['SYSTEM\n\nرسالة العميل: بدي برغر']);

    _resetProviderState();
    delete process.env.AI_FALLBACK_PROVIDER;
    mockGenerateContent.mockClear();
    expect(await generateValidatedAIReply('SYSTEM', 'بدي برغر')).toBeNull();
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});
