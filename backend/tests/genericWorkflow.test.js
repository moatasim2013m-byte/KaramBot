/**
 * The agent for a business that is neither a restaurant nor a clinic.
 *
 * Before this, every other type fell through to a fixed greeting with no model call: SHIFT
 * could sell to four sectors and serve two. These tests hold the new workflow to the promise
 * that makes it safe to switch on — it answers from what the owner entered, and refuses
 * rather than inventing.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({ businessKnowledge: { findMany: jest.fn() } }));
jest.mock('../src/ai/provider', () => ({ generateValidatedAIReply: jest.fn() }));

const prisma = require('../src/config/prisma');
const { generateValidatedAIReply } = require('../src/ai/provider');
const { processGenericMessage } = require('../src/workflows/generic');
const { runWorkflow } = require('../src/services/dryRun');

const business = (over = {}) => ({
  id: 'b1', name: 'صيدلية النور', business_type: 'generic',
  ai_config: { greeting_message: 'أهلاً بك' }, opening_hours: [], ...over,
});
const conv = (over = {}) => ({ id: 'c1', ai_enabled: true, current_state: 'IDLE', workflow_data: {}, ...over });

const knowledge = [
  { id: 'k1', kind: 'hours', question: null, content: 'السبت–الخميس 9ص–9م، الجمعة مغلق' },
  { id: 'k2', kind: 'faq', question: 'بتوصلوا؟', content: 'نعم، داخل إربد خلال ساعة، التوصيل بدينار' },
];

beforeEach(() => jest.clearAllMocks());

test('with nothing entered it greets, says so, and never calls the model', async () => {
  prisma.businessKnowledge.findMany.mockResolvedValue([]);
  const out = await processGenericMessage(business(), conv(), 'بتوصلوا؟');
  expect(out.reply).toBe('أهلاً بك');
  expect(out.knowledge_empty).toBe(true);
  expect(generateValidatedAIReply).not.toHaveBeenCalled();
});

test('the owner\'s knowledge reaches the model, grouped and labelled', async () => {
  prisma.businessKnowledge.findMany.mockResolvedValue(knowledge);
  generateValidatedAIReply.mockResolvedValue({ reply: 'نعم، منوصّل داخل إربد خلال ساعة.', action: 'NONE' });

  const out = await processGenericMessage(business(), conv(), 'بتوصلوا؟');

  const [systemPrompt, customerText] = generateValidatedAIReply.mock.calls[0];
  expect(customerText).toBe('بتوصلوا؟');
  expect(systemPrompt).toContain('صيدلية النور');
  expect(systemPrompt).toContain('أوقات العمل');
  expect(systemPrompt).toContain('السبت–الخميس 9ص–9م');
  expect(systemPrompt).toContain('س: بتوصلوا؟');
  expect(out.reply).toBe('نعم، منوصّل داخل إربد خلال ساعة.');
});

test('the prompt forbids inventing, and forbids promising a booking it cannot make', async () => {
  prisma.businessKnowledge.findMany.mockResolvedValue(knowledge);
  generateValidatedAIReply.mockResolvedValue({ reply: 'x', action: 'NONE' });
  await processGenericMessage(business(), conv(), 'كم السعر؟');
  const prompt = generateValidatedAIReply.mock.calls[0][0];
  expect(prompt).toContain('لا تخترع');
  expect(prompt).toMatch(/لا تَعِد بحجز أو طلب/);
});

test('only active knowledge is read', async () => {
  prisma.businessKnowledge.findMany.mockResolvedValue(knowledge);
  generateValidatedAIReply.mockResolvedValue({ reply: 'x', action: 'NONE' });
  await processGenericMessage(business(), conv(), 'مرحبا');
  expect(prisma.businessKnowledge.findMany.mock.calls[0][0].where).toMatchObject({ business_id: 'b1', active: true });
});

test('the owner\'s handoff words win before anything is generated', async () => {
  const out = await processGenericMessage(
    business({ ai_config: { handoff_keywords: ['موظف'], greeting_message: 'أهلاً' } }),
    conv(), 'بدي أحكي مع موظف',
  );
  expect(out.action).toBe('HANDOFF_TO_HUMAN');
  expect(out.stateUpdate).toMatchObject({ ai_enabled: false, status: 'human_takeover' });
  expect(generateValidatedAIReply).not.toHaveBeenCalled();
  expect(prisma.businessKnowledge.findMany).not.toHaveBeenCalled();
});

test('a model failure hands the customer to a human rather than guessing', async () => {
  prisma.businessKnowledge.findMany.mockResolvedValue(knowledge);
  generateValidatedAIReply.mockResolvedValue(null);
  const out = await processGenericMessage(business(), conv(), 'سؤال');
  expect(out.action).toBe('HANDOFF_TO_HUMAN');
  expect(out.stateUpdate.ai_enabled).toBe(false);
});

test('the model asking for a human is honoured and the conversation is handed over', async () => {
  prisma.businessKnowledge.findMany.mockResolvedValue(knowledge);
  generateValidatedAIReply.mockResolvedValue({ reply: 'رح أحوّلك لموظف', action: 'HANDOFF_TO_HUMAN' });
  const out = await processGenericMessage(business(), conv(), 'بدي أحجز');
  expect(out.action).toBe('HANDOFF_TO_HUMAN');
  expect(out.reply).toBe('رح أحوّلك لموظف');
});

test('a paused agent says nothing at all', async () => {
  const out = await processGenericMessage(business(), conv({ ai_enabled: false }), 'مرحبا');
  expect(out.reply).toBeNull();
  expect(generateValidatedAIReply).not.toHaveBeenCalled();
});

describe('the shared dispatch', () => {
  test('a store, a pharmacy and an unknown type all reach the generic workflow now', async () => {
    prisma.businessKnowledge.findMany.mockResolvedValue(knowledge);
    generateValidatedAIReply.mockResolvedValue({ reply: 'جواب', action: 'NONE' });

    for (const type of ['store', 'generic', 'other', 'pharmacy']) {
      generateValidatedAIReply.mockClear();
      const out = await runWorkflow(business({ business_type: type }), conv(), 'سؤال');
      expect(generateValidatedAIReply).toHaveBeenCalled();   // a real model call, not a greeting
      expect(out.reply).toBe('جواب');
    }
  });
});
