/**
 * SHIFT options of ai/provider.js: per-workflow actions, sanitised buttons, stage repair,
 * JSON mode + systemInstruction + thinking budget, the 25 s deadline split and the usage log.
 */
require('./setup');

const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({ generateContent: mockGenerateContent }));
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({ getGenerativeModel: mockGetGenerativeModel })),
}));

const { generateValidatedAIReply, validateAIResult, VALID_ACTIONS } = require('../src/ai/provider');

const SHIFT_ACTIONS = ['NONE', 'FLAG_FOR_TEAM', 'CAPTURE_TIME', 'HANDOFF_TO_HUMAN', 'OPT_OUT'];
const STAGES = ['opening', 'discovery', 'fit', 'objection', 'close', 'captured', 'handoff', 'closed'];

const reply = (obj, extra = {}) => ({
  response: {
    text: () => (typeof obj === 'string' ? obj : JSON.stringify(obj)),
    ...extra,
  },
});
const never = () => new Promise(() => {});

let logSpy;

beforeEach(() => {
  mockGenerateContent.mockReset();
  mockGetGenerativeModel.mockClear();
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_TEXT_MODE;
  delete process.env.GEMINI_MAX_OUTPUT_TOKENS;
  delete process.env.GEMINI_THINKING_LEVEL;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete process.env.GEMINI_TEXT_MODE;
  delete process.env.GEMINI_MAX_OUTPUT_TOKENS;
  delete process.env.GEMINI_THINKING_LEVEL;
});

describe('validation options', () => {
  test('1. a validActions array replaces the default set', async () => {
    expect(validateAIResult({ reply: 'x', action: 'FLAG_FOR_TEAM' }).valid).toBe(false);
    expect(validateAIResult({ reply: 'x', action: 'FLAG_FOR_TEAM' }, SHIFT_ACTIONS).valid).toBe(true);
    expect(validateAIResult({ reply: 'x', action: 'SHOW_MENU' }, SHIFT_ACTIONS).valid).toBe(false);
    expect(validateAIResult({ reply: 'x', action: 'FLAG_FOR_TEAM' }, new Set(SHIFT_ACTIONS)).valid).toBe(true);
    expect(VALID_ACTIONS.has('FLAG_FOR_TEAM')).toBe(false);

    mockGenerateContent.mockResolvedValue(reply({ reply: 'تمام', action: 'CAPTURE_TIME' }));
    const result = await generateValidatedAIReply('S', 'U', [], { validActions: SHIFT_ACTIONS });
    expect(result.action).toBe('CAPTURE_TIME');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  test('2. extra fields are accepted', () => {
    const r = { reply: 'x', action: 'NONE', stage: 'fit', lead: { city: 'إربد' }, action_args: { reason: 'quote' }, foo: 1 };
    expect(validateAIResult(r, SHIFT_ACTIONS, { stages: STAGES }).valid).toBe(true);
    expect(r.foo).toBe(1);
    expect(r.lead).toEqual({ city: 'إربد' });
    expect(r.action_args).toEqual({ reason: 'quote' });
  });

  test('3. a 21-code-point button title is dropped without a retry', async () => {
    const buttons = [
      { id: 'lead_talk', title: 'احكي مع الفريق' },
      { id: 'too_long', title: 'ا'.repeat(21) },
      { id: 'slot:2026-09-14T16:00+03:00/18:00', title: 'اليوم 4–6' },
    ];
    mockGenerateContent.mockResolvedValue(reply({ reply: 'تمام', action: 'NONE', buttons }));

    const result = await generateValidatedAIReply('S', 'U', [], { validActions: SHIFT_ACTIONS, jsonMode: true });

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(result.buttons).toEqual([buttons[0], buttons[2]]);
  });

  test('sanitising keeps at most 3 valid buttons and drops bad ids', () => {
    const r = {
      reply: 'x',
      buttons: [
        { id: '', title: 'فاضي' },
        { id: 'a', title: 'أ' },
        { id: 'a', title: 'مكرر' },
        { id: 'x'.repeat(257), title: 'طويل' },
        { id: 'b', title: 'ب' },
        { id: 'c', title: 'ج' },
        { id: 'd', title: 'د' },
        'nope',
      ],
    };
    expect(validateAIResult(r).valid).toBe(true);
    expect(r.buttons.map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });

  test('4. buttons that are not an array become [], lead/action_args non-objects become {}', () => {
    const r = { reply: 'x', buttons: 'yes', lead: 'محمد', action_args: [1] };
    expect(validateAIResult(r, SHIFT_ACTIONS).valid).toBe(true);
    expect(r.buttons).toEqual([]);
    expect(r.lead).toEqual({});
    expect(r.action_args).toEqual({});
  });

  test('5. an invalid action gets one correction retry', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(reply({ reply: 'تمام', action: 'SHOW_MENU' }))
      .mockResolvedValueOnce(reply({ reply: 'تمام', action: 'NONE' }));

    const result = await generateValidatedAIReply('S', 'U', [], {
      validActions: SHIFT_ACTIONS, correctionPrompt: 'CORRECT', jsonMode: true, systemInstruction: true,
    });

    expect(result.action).toBe('NONE');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(mockGenerateContent.mock.calls[1][0].contents[0].parts[0].text).toBe('U\n\nCORRECT');
  });

  test('6. an invalid stage twice → the result is returned without stage', async () => {
    mockGenerateContent.mockResolvedValue(reply({ reply: 'تمام', action: 'NONE', stage: 'dancing', next_step: 'ask_name' }));

    const result = await generateValidatedAIReply('S', 'U', [], {
      validActions: SHIFT_ACTIONS, stages: STAGES, nextSteps: ['ask_name'], jsonMode: true,
    });

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(result).not.toBeNull();
    expect(result.reply).toBe('تمام');
    expect(result).not.toHaveProperty('stage');
    expect(result.next_step).toBe('ask_name');
  });

  test('invalid stage twice in deadline mode is also repaired', async () => {
    mockGenerateContent.mockResolvedValue(reply({ reply: 'تمام', next_step: 'nope' }));
    const result = await generateValidatedAIReply('S', 'U', [], {
      nextSteps: ['ask_name'], jsonMode: true, deadlineAt: Date.now() + 25000,
    });
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(result.reply).toBe('تمام');
    expect(result).not.toHaveProperty('next_step');
  });
});

describe('SHIFT call shape', () => {
  const schema = { type: 'object', properties: { reply: { type: 'string' } } };

  test('7. systemInstruction + JSON mode + responseSchema, user turn in contents', async () => {
    mockGenerateContent.mockResolvedValue(reply({ reply: 'أهلًا' }));

    const result = await generateValidatedAIReply('SYSTEM', 'رسالة 1\nرسالة 2', [], {
      jsonMode: true, systemInstruction: true, responseSchema: schema, validActions: SHIFT_ACTIONS,
    });

    expect(result.reply).toBe('أهلًا');
    expect(mockGetGenerativeModel).toHaveBeenCalledWith({
      model: 'gemini-3.6-flash',
      systemInstruction: 'SYSTEM',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.4,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: 'minimal' },
        responseSchema: schema,
      },
    });
    const [request, requestOpts] = mockGenerateContent.mock.calls[0];
    expect(request).toEqual({ contents: [{ role: 'user', parts: [{ text: 'رسالة 1\nرسالة 2' }] }] });
    expect(requestOpts).toEqual({ timeout: expect.any(Number) });
  });

  test('8. GEMINI_TEXT_MODE=1 → no systemInstruction, prompt concatenated into the user turn', async () => {
    process.env.GEMINI_TEXT_MODE = '1';
    mockGenerateContent.mockResolvedValue(reply({ reply: 'أهلًا' }));

    await generateValidatedAIReply('SYSTEM', 'مرحبا', [], { jsonMode: true, systemInstruction: true, responseSchema: schema });

    const params = mockGetGenerativeModel.mock.calls[0][0];
    expect(params).not.toHaveProperty('systemInstruction');
    expect(params.generationConfig.responseMimeType).toBe('application/json');
    expect(mockGenerateContent.mock.calls[0][0].contents[0].parts[0].text).toBe('SYSTEM\n\nرسائل العميل:\nمرحبا');
  });

  // gemini-3.x spends hidden thinking tokens from maxOutputTokens: with the old 600 cap every SHIFT
  // reply finished MAX_TOKENS with a truncated body and fell back (production, 2026-09-15).
  describe('thinking budget (constants read at module load)', () => {
    const loadProvider = () => {
      let mod;
      jest.isolateModules(() => { mod = require('../src/ai/provider'); });
      return mod;
    };
    const generationConfig = async (provider) => {
      mockGenerateContent.mockResolvedValue(reply({ reply: 'أهلًا' }));
      await provider.generateValidatedAIReply('SYSTEM', 'مرحبا', [], { jsonMode: true, systemInstruction: true });
      return mockGetGenerativeModel.mock.calls[0][0].generationConfig;
    };

    test('default: maxOutputTokens 2048 and thinkingLevel minimal', async () => {
      const config = await generationConfig(loadProvider());
      expect(config.maxOutputTokens).toBe(2048);
      expect(config.thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
    });

    test('GEMINI_THINKING_LEVEL=off omits thinkingConfig entirely', async () => {
      process.env.GEMINI_THINKING_LEVEL = 'off';
      const config = await generationConfig(loadProvider());
      expect(config).not.toHaveProperty('thinkingConfig');
      expect(config.maxOutputTokens).toBe(2048);
      expect(config.responseMimeType).toBe('application/json');
    });

    test('GEMINI_THINKING_LEVEL passes another level through', async () => {
      process.env.GEMINI_THINKING_LEVEL = 'low';
      const config = await generationConfig(loadProvider());
      expect(config.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    });

    test('GEMINI_MAX_OUTPUT_TOKENS overrides the cap; a non-number falls back to 2048', async () => {
      process.env.GEMINI_MAX_OUTPUT_TOKENS = '4096';
      expect((await generationConfig(loadProvider())).maxOutputTokens).toBe(4096);

      mockGetGenerativeModel.mockClear();
      process.env.GEMINI_MAX_OUTPUT_TOKENS = 'lots';
      expect((await generationConfig(loadProvider())).maxOutputTokens).toBe(2048);
    });

    test('the legacy path gets no generationConfig at all', async () => {
      process.env.GEMINI_THINKING_LEVEL = 'high';
      process.env.GEMINI_MAX_OUTPUT_TOKENS = '4096';
      const provider = loadProvider();
      mockGenerateContent.mockResolvedValue(reply({ reply: 'x' }));
      await provider.generateValidatedAIReply('S', 'U');
      expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-3.6-flash' });
    });
  });

  test('JSON mode parses bare JSON first and falls back to the fence extractor', async () => {
    mockGenerateContent.mockResolvedValue(reply('```json\n{"reply":"من الفنس"}\n```'));
    const result = await generateValidatedAIReply('S', 'U', [], { jsonMode: true });
    expect(result.reply).toBe('من الفنس');
  });
});

describe('deadline mode', () => {
  test('9. attempt 1 gets min(15 s, remaining), attempt 2 the remainder, total ≤ 25 s', async () => {
    jest.useFakeTimers();
    const start = Date.now();
    mockGenerateContent.mockImplementation(never);

    const promise = generateValidatedAIReply('S', 'U', [], {
      jsonMode: true, systemInstruction: true, deadlineAt: start + 25000,
    });

    await jest.advanceTimersByTimeAsync(0);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(mockGenerateContent.mock.calls[0][1]).toEqual({ timeout: 15000 });

    // still on attempt 1 just before its 15 s budget runs out
    await jest.advanceTimersByTimeAsync(14999);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(mockGenerateContent.mock.calls[1][1]).toEqual({ timeout: 10000 });

    await jest.advanceTimersByTimeAsync(10000);
    await expect(promise).resolves.toBeNull();
    expect(Date.now() - start).toBeLessThanOrEqual(25000);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  test('attempt 1 is capped by the remaining time when the deadline is near', async () => {
    jest.useFakeTimers();
    mockGenerateContent.mockImplementation(never);
    const promise = generateValidatedAIReply('S', 'U', [], { jsonMode: true, deadlineAt: Date.now() + 6000 });
    await jest.advanceTimersByTimeAsync(0);
    expect(mockGenerateContent.mock.calls[0][1]).toEqual({ timeout: 6000 });
    await jest.advanceTimersByTimeAsync(6000);
    await expect(promise).resolves.toBeNull();
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  test('10. onRetry is awaited before attempt 2, and a thrown attempt gets no correction prompt', async () => {
    const order = [];
    mockGenerateContent
      .mockImplementationOnce(async () => { order.push('attempt1'); throw new Error('503'); })
      .mockImplementationOnce(async () => { order.push('attempt2'); return reply({ reply: 'تمام' }); });
    const onRetry = jest.fn(async () => {
      await new Promise((r) => setImmediate(r));
      order.push('onRetry');
    });

    const result = await generateValidatedAIReply('S', 'U', [], {
      jsonMode: true, systemInstruction: true, deadlineAt: Date.now() + 25000, onRetry, correctionPrompt: 'CORRECT',
    });

    expect(result.reply).toBe('تمام');
    expect(order).toEqual(['attempt1', 'onRetry', 'attempt2']);
    expect(mockGenerateContent.mock.calls[1][0].contents[0].parts[0].text).toBe('U');
  });

  test('onRetry errors are swallowed', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(reply('not json'))
      .mockResolvedValueOnce(reply({ reply: 'تمام' }));
    const result = await generateValidatedAIReply('S', 'U', [], {
      jsonMode: true, systemInstruction: true, deadlineAt: Date.now() + 25000, correctionPrompt: 'CORRECT',
      onRetry: () => { throw new Error('lease lost'); },
    });
    expect(result.reply).toBe('تمام');
    // attempt 1 answered badly, so the retry carries the correction prompt
    expect(mockGenerateContent.mock.calls[1][0].contents[0].parts[0].text).toBe('U\n\nCORRECT');
  });

  test('11. remaining < 1.5 s after attempt 1 → no retry, null', async () => {
    jest.useFakeTimers();
    mockGenerateContent.mockImplementation(never);
    const onRetry = jest.fn();

    const promise = generateValidatedAIReply('S', 'U', [], {
      jsonMode: true, deadlineAt: Date.now() + 16000, onRetry,
    });
    await jest.advanceTimersByTimeAsync(15000);

    await expect(promise).resolves.toBeNull();
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  test('12. retrySystemPrompt is used on attempt 2', async () => {
    mockGenerateContent
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(reply({ reply: 'تمام' }));

    await generateValidatedAIReply('FULL', 'U', [], {
      jsonMode: true, systemInstruction: true, deadlineAt: Date.now() + 25000, retrySystemPrompt: 'SHORT',
    });

    expect(mockGetGenerativeModel.mock.calls[0][0].systemInstruction).toBe('FULL');
    expect(mockGetGenerativeModel.mock.calls[1][0].systemInstruction).toBe('SHORT');
  });
});

describe('usage log', () => {
  const usageLines = () => logSpy.mock.calls
    .map((c) => c[0])
    .filter((line) => typeof line === 'string' && line.startsWith('[ai] '))
    .map((line) => JSON.parse(line.slice(5)));

  test('13. one line per attempt with model, ms, in, out, thoughts, finish, conv, attempt, ok', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(reply('garbage', {
        usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 40, thoughtsTokenCount: 570 },
        candidates: [{ finishReason: 'STOP' }],
      }))
      .mockRejectedValueOnce(new Error('boom'));

    const result = await generateValidatedAIReply('S', 'U', [], {
      jsonMode: true, systemInstruction: true, deadlineAt: Date.now() + 25000, conversationId: 'conv_1',
    });

    expect(result).toBeNull();
    const lines = usageLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({
      model: 'gemini-3.6-flash', ms: expect.any(Number), in: 1200, out: 40, thoughts: 570, finish: 'STOP', conv: 'conv_1', attempt: 1, ok: true,
    });
    expect(lines[1]).toEqual(expect.objectContaining({
      model: 'gemini-3.6-flash', in: null, out: null, thoughts: null, finish: null, conv: 'conv_1', attempt: 2, ok: false,
    }));
  });

  test('the legacy path logs too', async () => {
    mockGenerateContent.mockResolvedValue(reply({ reply: 'x' }));
    await generateValidatedAIReply('S', 'U');
    expect(usageLines()).toEqual([expect.objectContaining({ attempt: 1, ok: true, conv: null })]);
  });
});
