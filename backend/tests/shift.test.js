require('./setup');

jest.mock('../src/ai/provider', () => ({ generateValidatedAIReply: jest.fn() }));
jest.mock('../src/config/prisma', () => ({ message: { findMany: jest.fn() } }));

const { generateValidatedAIReply } = require('../src/ai/provider');
const prisma = require('../src/config/prisma');
const {
  processShiftMessage, buildSystemPrompt, formatHistory, toWorkflowResult, HANDOFF_REPLY,
} = require('../src/workflows/shift');

const business = { id: 'b1', name: 'SHIFT AI & Automation', ai_config: {} };
const conversation = { id: 'c1' };

describe('SHIFT workflow — prompt', () => {
  test('carries the product knowledge and the no-prices rule', () => {
    const p = buildSystemPrompt(business, '');
    expect(p).toContain('كرم بوت');
    expect(p).toContain('https://shifts-ai.store');
    expect(p).toContain('لا تذكر أسعارًا');
    expect(p).toContain('HANDOFF_TO_HUMAN');
  });

  test('formats history oldest first and skips empty bodies', () => {
    const text = formatHistory([
      { direction: 'inbound', text_body: 'مرحبا' },
      { direction: 'outbound', text_body: null },
      { direction: 'outbound', text_body: 'أهلًا' },
    ]);
    expect(text).toBe('العميل: مرحبا\nشِفت: أهلًا');
  });
});

describe('SHIFT workflow — results', () => {
  test('NONE keeps AI on', () => {
    const r = toWorkflowResult({ reply: ' أهلًا ', action: 'NONE' });
    expect(r).toEqual({ reply: 'أهلًا', stateUpdate: {}, action: 'NONE' });
  });

  test('HANDOFF_TO_HUMAN turns AI off for the conversation', () => {
    const r = toWorkflowResult({ reply: 'سيتواصل معك الفريق', action: 'HANDOFF_TO_HUMAN' });
    expect(r.stateUpdate).toEqual({ ai_enabled: false, status: 'human_takeover' });
    expect(r.reply).toBe('سيتواصل معك الفريق');
  });

  test('AI failure hands off with the fixed reply', () => {
    const r = toWorkflowResult(null);
    expect(r.action).toBe('HANDOFF_TO_HUMAN');
    expect(r.reply).toBe(HANDOFF_REPLY);
  });
});

describe('SHIFT workflow — processShiftMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sends prior turns (not the current message) as history', async () => {
    prisma.message.findMany.mockResolvedValue([
      { direction: 'inbound', text_body: 'كم السعر؟' },      // current message, newest
      { direction: 'outbound', text_body: 'أهلًا بك في شِفت' },
      { direction: 'inbound', text_body: 'مرحبا' },
    ]);
    generateValidatedAIReply.mockResolvedValue({ reply: 'يعتمد على المنتجات. ما نوع منشأتك؟', action: 'NONE' });

    const r = await processShiftMessage(business, conversation, 'كم السعر؟');

    const [prompt, userMessage] = generateValidatedAIReply.mock.calls[0];
    expect(userMessage).toBe('كم السعر؟');
    expect(prompt).toContain('العميل: مرحبا\nشِفت: أهلًا بك في شِفت');
    expect(prompt).not.toContain('العميل: كم السعر؟');
    expect(r.action).toBe('NONE');
  });
});
