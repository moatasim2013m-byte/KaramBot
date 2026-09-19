/**
 * The eval replay on Claude: every scenario through the real SHIFT pipeline with AI_PROVIDER=anthropic and
 * the harness's scripted Anthropic client (scripts/eval-shift.js#fakes.anthropic) — so the request path in
 * src/ai/anthropic.js, not the Gemini one, produces every reply. Then the failover end to end: Claude out of
 * credit → Gemini answers the same turn and staff get one ai_failure alert; both out → the fallback line.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios', () => require('../scripts/eval-shift').fakes.axios);
jest.mock('@google/generative-ai', () => require('../scripts/eval-shift').fakes.gemini);
jest.mock('@anthropic-ai/sdk', () => require('../scripts/eval-shift').fakes.anthropic);
jest.mock('../src/services/googleCalendar', () => require('../scripts/eval-shift').fakes.calendar);

const scenarios = require('../scripts/eval/scenarios');
const evalShift = require('../scripts/eval-shift');
const provider = require('../src/ai/provider');

jest.setTimeout(60000);

const saved = {};
const KEYS = ['AI_PROVIDER', 'AI_FALLBACK_PROVIDER', 'ANTHROPIC_API_KEY'];

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.AI_PROVIDER = 'anthropic';
  process.env.ANTHROPIC_API_KEY = 'eval_key';
  delete process.env.AI_FALLBACK_PROVIDER;
  evalShift.state.anthropicError = null;
  provider._resetProviderState();
});

afterEach(() => {
  evalShift.state.anthropicError = null;
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const creditError = () => Object.assign(
  new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'),
  { status: 400 },
);

describe('eval replay on Claude (AI_PROVIDER=anthropic)', () => {
  test.each(scenarios.ALL.map((s) => [String(s.id), s.title, s]))('scenario %s — %s', async (id, title, scenario) => {
    const r = await evalShift.runScenario(scenario, { mode: 'replay', quiet: true });
    const report = [
      ...r.gateFailures.map((f) => `${f.gate} turn ${f.turn === null ? '-' : f.turn + 1}: ${f.detail}`),
      ...r.stateFailures,
    ];
    expect(report).toEqual([]);
    // Every model call went to Claude, with the cached static prompt and no forbidden parameter.
    for (const call of evalShift.state.modelCalls) {
      expect(call.provider).toBe('anthropic');
      expect(call.params.model).toBe('claude-sonnet-5');
      expect(call.params.system[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(call.params).not.toHaveProperty('temperature');
      expect(call.params.messages.map((m) => m.role)).toEqual(['user']);
    }
  });
});

describe('failover end to end', () => {
  test('Claude out of credit: Gemini answers every turn, one owner alert, the scenario still passes', async () => {
    process.env.AI_FALLBACK_PROVIDER = 'gemini';
    evalShift.state.anthropicError = creditError;
    const r = await evalShift.runScenario(scenarios.byId(1), { mode: 'replay', quiet: true });
    expect([...r.gateFailures, ...r.stateFailures]).toEqual([]);
    const calls = evalShift.state.modelCalls;
    // One Claude call (the cooldown sends the later turns straight to Gemini), the rest Gemini.
    expect(calls.filter((c) => c.provider === 'anthropic')).toHaveLength(1);
    expect(calls.filter((c) => c.provider !== 'anthropic').length).toBeGreaterThan(0);
    await new Promise((resolve) => setImmediate(resolve));
    const texts = evalShift.state.alertPosts.map((a) => a.payload.text);
    const providerAlerts = texts.filter((t) => t.includes('رصيد Claude خلص — البوت شغّال على Gemini'));
    expect(providerAlerts).toHaveLength(1);
    expect(evalShift.state.alertPosts.find((a) => a.payload.text.includes('رصيد Claude')).payload.reason).toBe('ai_failure');
  });

  test('both out of credit: the fallback line is sent once and staff hear about both providers', async () => {
    process.env.AI_FALLBACK_PROVIDER = 'gemini';
    evalShift.state.anthropicError = creditError;
    const s = JSON.parse(JSON.stringify(scenarios.byId(12)));
    delete s.turns[0].expect.aiCalls; // Claude + Gemini: two calls for the first reply, by design
    s.turns[2].model = [{ __throw: '[402 Payment Required] Your prepayment credits are depleted.' }];
    const r = await evalShift.runScenario(s, { mode: 'replay', quiet: true });
    expect([...r.gateFailures, ...r.stateFailures]).toEqual([]);
    const last = r.transcript.turns[2];
    expect(last.outbound).toHaveLength(1);
    expect(last.outbound[0].text).toContain('تأخر ردّي شوي');
    await new Promise((resolve) => setImmediate(resolve));
    const texts = evalShift.state.alertPosts.map((a) => a.payload.text).join('\n');
    expect(texts).toContain('رصيد Claude خلص — البوت شغّال على Gemini');
    expect(texts).toContain('رصيد Gemini خلص — ما في مزوّد بديل شغّال');
  });
});
