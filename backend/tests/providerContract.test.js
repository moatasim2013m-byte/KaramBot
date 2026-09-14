/**
 * Pins the legacy (restaurant / clinic) Gemini call shape, so the SHIFT options added to
 * ai/provider.js can never change what those tenants send.
 */
require('./setup');

const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({ generateContent: mockGenerateContent }));
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({ getGenerativeModel: mockGetGenerativeModel })),
}));

const {
  generateValidatedAIReply,
  validateAIResult,
  resolveModel,
  DEFAULT_GEMINI_MODEL,
  CORRECTION_PROMPT,
} = require('../src/ai/provider');

const reply = (text) => ({ response: { text: () => text } });

describe('legacy Gemini call contract', () => {
  let errorSpy;

  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGetGenerativeModel.mockClear();
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_TEXT_MODE;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.GEMINI_MODEL;
  });

  test('1. model params are exactly {model} and the prompt is one concatenated string', async () => {
    mockGenerateContent.mockResolvedValue(reply('{"reply":"أهلا","action":"NONE"}'));

    const result = await generateValidatedAIReply('SYSTEM', 'بدي برغر');

    expect(result).toEqual(expect.objectContaining({ reply: 'أهلا', action: 'NONE' }));
    expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);
    expect(mockGetGenerativeModel.mock.calls[0]).toEqual([{ model: 'gemini-3.6-flash' }]);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(mockGenerateContent.mock.calls[0]).toEqual(['SYSTEM\n\nرسالة العميل: بدي برغر']);
  });

  test('2. GEMINI_MODEL overrides the default, and the default is no longer gemini-2.0-flash', async () => {
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.6-flash');
    expect(resolveModel()).not.toBe('gemini-2.0-flash');

    process.env.GEMINI_MODEL = 'gemini-custom';
    expect(resolveModel()).toBe('gemini-custom');
    mockGenerateContent.mockResolvedValue(reply('{"reply":"ok"}'));
    await generateValidatedAIReply('S', 'U');
    expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-custom' });
  });

  test('3. JSON inside a ```json fence is parsed', async () => {
    mockGenerateContent.mockResolvedValue(reply('هاي الرد:\n```json\n{"reply":"تمام","action":"SHOW_MENU","extracted_items":[]}\n```'));
    const result = await generateValidatedAIReply('S', 'U');
    expect(result.reply).toBe('تمام');
    expect(result.action).toBe('SHOW_MENU');
  });

  test('4. invalid then valid → two calls, the second ends with CORRECTION_PROMPT', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(reply('مش JSON'))
      .mockResolvedValueOnce(reply('{"reply":"تمام"}'));

    const result = await generateValidatedAIReply('S', 'U');

    expect(result.reply).toBe('تمام');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    const second = mockGenerateContent.mock.calls[1][0];
    expect(typeof second).toBe('string');
    expect(second.endsWith(CORRECTION_PROMPT)).toBe(true);
    expect(second).toBe(`S\n\nرسالة العميل: U\n\n${CORRECTION_PROMPT}`);
  });

  test('5. both attempts invalid → null', async () => {
    mockGenerateContent.mockResolvedValue(reply('{"action":"NONE"}'));
    expect(await generateValidatedAIReply('S', 'U')).toBeNull();
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  test('6. first call throws → null with no retry', async () => {
    mockGenerateContent.mockRejectedValue(new Error('boom'));
    expect(await generateValidatedAIReply('S', 'U')).toBeNull();
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  test('7. a 404 model error surfaces as null and is logged', async () => {
    const err = Object.assign(new Error('[404 Not Found] models/gemini-x is not found'), { status: 404 });
    mockGenerateContent.mockRejectedValue(err);
    expect(await generateValidatedAIReply('S', 'U')).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join(' ')).toContain('404');
  });

  test('8. legacy validateAIResult rules still hold', () => {
    expect(validateAIResult({ reply: 'x', action: 'MAKE_COFFEE' })).toEqual(expect.objectContaining({ valid: false }));
    expect(validateAIResult({ reply: 'x', action: 'ADD_ITEM', extracted_items: 'burger' }).valid).toBe(false);
    expect(validateAIResult({ reply: 'x', action: 'HANDOFF_TO_HUMAN', extracted_items: [] }).valid).toBe(true);
    expect(validateAIResult(null).valid).toBe(false);
    expect(validateAIResult({ reply: '  ' }).valid).toBe(false);
  });
});
