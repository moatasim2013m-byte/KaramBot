/**
 * Every HANDOFF_TO_HUMAN from the restaurant and clinic workflows says why (handoff_kind), so
 * «ما عرف يجاوب» lists only the questions the model gave up on (docs/panels/spec.md, P3):
 * 'keyword' for the owner's own escalation words, 'model' when the model hands over, 'ai_failure'
 * when it produced nothing usable or threw. The generic workflow's are in genericWorkflow.test.js.
 */
require('./setup');

// Every table the workflows read answers empty: an empty menu and an empty service list. The
// owner's notes (businessKnowledge) answer whatever mockKnowledge says.
let mockKnowledge = async () => [];
jest.mock('../src/config/prisma', () => new Proxy({}, {
  get: (_t, table) => ({
    findMany: table === 'businessKnowledge' ? (...a) => mockKnowledge(...a) : async () => [],
    findFirst: async () => null, findUnique: async () => null, count: async () => 0,
  }),
}));
jest.mock('../src/ai/provider', () => ({ generateValidatedAIReply: jest.fn() }));

const { generateValidatedAIReply } = require('../src/ai/provider');
const { processRestaurantMessage } = require('../src/workflows/restaurant');
const { processClinicMessage } = require('../src/workflows/clinic');

const business = (type, over = {}) => ({
  id: 'b1', name: 'محل', business_type: type, currency: 'JOD', policies: {}, opening_hours: [],
  ai_config: { handoff_keywords: ['موظف'] }, ...over,
});
const conv = () => ({ id: 'c1', ai_enabled: true, current_state: null, workflow_data: {} });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe.each([
  ['restaurant', processRestaurantMessage],
  ['clinic', processClinicMessage],
])('%s', (type, run) => {
  test('the owner\'s keyword is a keyword handoff, and the model is never asked', async () => {
    const out = await run(business(type), conv(), 'بدي موظف');
    expect(out).toMatchObject({ action: 'HANDOFF_TO_HUMAN', handoff_kind: 'keyword' });
    expect(generateValidatedAIReply).not.toHaveBeenCalled();
  });

  test('the model handing over is a model handoff', async () => {
    generateValidatedAIReply.mockResolvedValue({ reply: 'لحظة', action: 'HANDOFF_TO_HUMAN' });
    const out = await run(business(type), conv(), 'عندكم مواقف سيارات؟');
    expect(out).toMatchObject({ action: 'HANDOFF_TO_HUMAN', handoff_kind: 'model' });
  });

  test('no usable answer, or a thrown error, is an ai_failure handoff', async () => {
    generateValidatedAIReply.mockResolvedValue(null);
    expect(await run(business(type), conv(), 'سؤال')).toMatchObject({ action: 'HANDOFF_TO_HUMAN', handoff_kind: 'ai_failure' });
    generateValidatedAIReply.mockRejectedValue(new Error('boom'));
    expect(await run(business(type), conv(), 'سؤال')).toMatchObject({ action: 'HANDOFF_TO_HUMAN', handoff_kind: 'ai_failure' });
  });

  test('an ordinary answer carries no handoff_kind', async () => {
    generateValidatedAIReply.mockResolvedValue({ reply: 'أهلًا', action: 'NONE' });
    const out = await run(business(type), conv(), 'مرحبا');
    expect(out.action).toBe('NONE');
    expect(out.handoff_kind).toBeUndefined();
  });
});

// «علّم البوت الجواب» saves a BusinessKnowledge row for every shop type. A restaurant's or a
// clinic's bot must read it, or the owner is told the bot learned something it never sees.
describe('a taught answer reaches the restaurant and clinic prompts', () => {
  afterEach(() => { mockKnowledge = async () => []; });
  test.each([
    ['restaurant', processRestaurantMessage],
    ['clinic', processClinicMessage],
  ])('%s', async (type, run) => {
    mockKnowledge = async () => [{ kind: 'faq', question: 'هل عندكم توصيل لحوارة؟', content: 'نعم، بدينارين' }];
    generateValidatedAIReply.mockResolvedValue({ reply: 'نعم', action: 'NONE' });
    await run(business(type), conv(), 'توصلون لحوارة؟');
    const prompt = generateValidatedAIReply.mock.calls[0][0];
    expect(prompt).toContain('س: هل عندكم توصيل لحوارة؟');
    expect(prompt).toContain('ج: نعم، بدينارين');
  });

  test('a failed knowledge read still answers from the menu', async () => {
    mockKnowledge = async () => { throw new Error('db down'); };
    generateValidatedAIReply.mockResolvedValue({ reply: 'أهلًا', action: 'NONE' });
    const out = await processRestaurantMessage(business('restaurant'), conv(), 'مرحبا');
    expect(out.action).toBe('NONE');
    expect(out.reply).toBe('أهلًا');
  });
});
