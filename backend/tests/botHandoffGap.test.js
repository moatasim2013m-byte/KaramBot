/**
 * botHandoffGap.test.js — «ما عرف يجاوب» is fed from the live message path (docs/panels/spec.md P3).
 *
 *  - The model handing a chat to a person records one open bot_handoff {question, conversation_id},
 *    and the customer still gets the handover reply and the owner still gets the alert.
 *  - An owner's handoff keyword and a provider failure hand over the same way but record nothing:
 *    neither is a question the owner could teach the bot.
 *  - An ordinary answer records nothing and is sent exactly as before.
 *
 * The same harness as costGuardGate.test.js: the real messageProcessor and generic workflow over the
 * in-memory fakeDb, with WhatsApp, the AI provider and the alert senders mocked.
 */

require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');
jest.mock('../src/services/whatsapp', () => ({
  sendText: jest.fn(),
  sendInteractiveButtons: jest.fn(),
  sendStructured: jest.fn(),
  sendTemplate: jest.fn(),
  partSummary: jest.fn(() => ''),
  sendTextMessage: jest.fn(),
  markAsRead: jest.fn(),
  normalizePhone: jest.fn((p) => (p ? String(p).replace(/\D/g, '') : p)),
}));
jest.mock('../src/services/alerts', () => ({
  ...jest.requireActual('../src/services/alerts'),
  sendStaffAlert: jest.fn(),
  notifyShift: jest.fn(),
}));
jest.mock('../src/workflows/shift', () => ({
  processShiftBatch: jest.fn(),
  toWorkflowResult: jest.fn(),
}));
jest.mock('../src/ai/provider', () => ({ generateValidatedAIReply: jest.fn(), generateAIReply: jest.fn(), resolveModel: () => 'gemini-test' }));
jest.mock('../src/workflows/shift/media', () => ({
  mediaEnabled: jest.fn(() => true),
  readForTenant: jest.fn(),
  enrichBatch: jest.fn(async (b, t, batch) => ({ batch, updates: [] })),
}));

const db = require('./helpers/fakeDb').getFakeDb();
const whatsapp = require('../src/services/whatsapp');
const alerts = require('../src/services/alerts');
const shift = require('../src/workflows/shift');
const provider = require('../src/ai/provider');
const media = require('../src/workflows/shift/media');
const batcher = require('../src/services/replyBatcher');
const costGuard = require('../src/services/costGuard');
const platformSettings = require('../src/services/platformSettings');
const { persistInbound, processInboundMessage } = require('../src/services/messageProcessor');

const CUSTOMER = '962791111111';
const OWNER = '962796381676';
const PNID = 'pnid_guard';
const T0 = new Date();
let seq = 0;

function seedShop({ ai_config = {}, contract = { status: 'trial', ai_replies_month: 3 }, usedThisMonth = 0, ...fields } = {}) {
  const [biz] = db.seed({
    businesses: [{
      id: 'biz_shop', name: 'صيدلية النور', business_type: 'generic', status: 'active', wa_phone_number_id: PNID,
      wa_access_token: 'plain_test_token', ai_config: { alert_wa_numbers: [OWNER], ...ai_config }, ...fields,
    }],
    businessKnowledge: [{ business_id: 'biz_shop', kind: 'fact', content: 'عندنا بنادول', active: true }],
  }).businesses;
  if (contract) {
    db.seed({
      subscriptions: [{
        business_id: biz.id, solution: 'karam_bot', amount_jod: 19.99, billing_cycle: 'monthly', starts_at: T0, created_by: 'system', ...contract,
      }],
    });
  }
  if (usedThisMonth) {
    const [c] = db.seed({ conversations: [{ business_id: biz.id, customer_wa_id: '962700000000' }] }).conversations;
    db.seed({
      messages: Array.from({ length: usedThisMonth }, () => ({
        business_id: biz.id, conversation_id: c.id, direction: 'outbound', is_ai_generated: true, status: 'sent', created_at: T0,
      })),
    });
  }
  return biz;
}

function seedOnboarding() {
  db.seed({ whatsappOnboardings: [{ business_id: 'biz_shop', app_id: 'app', meta_business_id: 'mb', waba_id: 'W1', phone_number_id: PNID, step: 'done' }] });
}

function entry(waMsg, from = CUSTOMER) {
  seq += 1;
  return {
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: PNID },
        contacts: [{ wa_id: from, profile: { name: 'محمد' } }],
        messages: [{ id: `wamid.cg${seq}`, from, timestamp: '1', type: 'text', ...waMsg }],
      },
    }],
  };
}

const text = (body) => ({ type: 'text', text: { body } });

async function deliver(waMsg, from) {
  const e = entry(waMsg, from);
  const persisted = await persistInbound(e);
  await processInboundMessage(e, { persisted });
  return persisted;
}

const conversation = (wa = CUSTOMER) => db.store.conversations.find((c) => c.customer_wa_id === wa);
const outboundTo = (wa = CUSTOMER) => {
  const c = conversation(wa);
  return db.store.messages.filter((m) => m.direction === 'outbound' && c && m.conversation_id === c.id);
};
const graphError = (code) => Object.assign(new Error('Request failed'), { response: { status: 400, data: { error: { code, message: 'refused' } } } });

beforeEach(() => {
  db.reset();
  db.clock.set(T0);
  jest.clearAllMocks();
  seq = 0;
  costGuard.clearCache();
  platformSettings.clearCache();
  whatsapp.sendTextMessage.mockReset().mockResolvedValue({ messages: [{ id: 'wamid.reply' }] });
  whatsapp.markAsRead.mockReset().mockResolvedValue(true);
  alerts.sendStaffAlert.mockReset().mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
  alerts.notifyShift.mockReset().mockResolvedValue(null);
  shift.processShiftBatch.mockReset().mockResolvedValue({
    kind: 'reply', action: 'NONE', messages: [{ type: 'text', text: 'أهلين!' }], stateUpdate: {}, workflowDataPatch: {},
  });
  provider.generateValidatedAIReply.mockReset().mockResolvedValue({ reply: 'أكيد، البنادول متوفر.', action: 'NONE' });
  media.mediaEnabled.mockReturnValue(true);
  media.readForTenant.mockReset().mockResolvedValue({ type: 'image', status: 'ok', text: 'علبة بنادول', at: 'x', ms: 1 });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  batcher.cancelAll();
  jest.restoreAllMocks();
});

const gaps = () => db.store.accountEvents.filter((e) => e.type === 'bot_handoff');
// record() is not awaited in the message path (the reply must not wait on the log).
const settle = () => new Promise((r) => setImmediate(r));

describe('the model gives up on a question', () => {
  test('one open bot_handoff with the question and the conversation; the customer and owner are still served', async () => {
    seedShop({ usedThisMonth: 0 });
    provider.generateValidatedAIReply.mockResolvedValue({ reply: 'رح أحوّلك لموظف', action: 'HANDOFF_TO_HUMAN' });
    await deliver(text('بتوصلوا لحوارة؟'));
    await settle();

    expect(gaps()).toHaveLength(1);
    expect(gaps()[0]).toMatchObject({
      business_id: 'biz_shop', actor_kind: 'system', resolved_at: null,
      data: { question: 'بتوصلوا لحوارة؟', conversation_id: conversation().id },
    });
    expect(whatsapp.sendTextMessage).toHaveBeenCalledWith(PNID, 'plain_test_token', CUSTOMER, 'رح أحوّلك لموظف');
    expect(conversation()).toMatchObject({ ai_enabled: false, status: 'human_takeover' });
  });

  test('a very long question is cut, not stored whole', async () => {
    seedShop({ usedThisMonth: 0 });
    provider.generateValidatedAIReply.mockResolvedValue({ reply: 'لحظة', action: 'HANDOFF_TO_HUMAN' });
    await deliver(text('س'.repeat(2000)));
    await settle();
    expect(gaps()[0].data.question.length).toBe(500);
  });
});

describe('handovers that are not gaps', () => {
  test('the owner\'s own keyword hands over and records nothing', async () => {
    seedShop({ usedThisMonth: 0, ai_config: { handoff_keywords: ['موظف'] } });
    await deliver(text('بدي موظف'));
    await settle();
    expect(conversation()).toMatchObject({ status: 'human_takeover' });
    expect(gaps()).toHaveLength(0);
  });

  test('a provider failure hands over and records nothing', async () => {
    seedShop({ usedThisMonth: 0 });
    provider.generateValidatedAIReply.mockResolvedValue(null);
    await deliver(text('عندكم بنادول؟'));
    await settle();
    expect(conversation()).toMatchObject({ status: 'human_takeover' });
    expect(gaps()).toHaveLength(0);
  });

  test('an ordinary answer is sent as before and records nothing', async () => {
    seedShop({ usedThisMonth: 0 });
    await deliver(text('عندكم بنادول؟'));
    await settle();
    expect(whatsapp.sendTextMessage).toHaveBeenCalledWith(PNID, 'plain_test_token', CUSTOMER, 'أكيد، البنادول متوفر.');
    expect(gaps()).toHaveLength(0);
  });

  test('a failed log write never stops the handover reply', async () => {
    seedShop({ usedThisMonth: 0 });
    provider.generateValidatedAIReply.mockResolvedValue({ reply: 'رح أحوّلك لموظف', action: 'HANDOFF_TO_HUMAN' });
    db.failNext('accountEvent.create');
    await deliver(text('بتوصلوا؟'));
    await settle();
    expect(whatsapp.sendTextMessage).toHaveBeenCalledWith(PNID, 'plain_test_token', CUSTOMER, 'رح أحوّلك لموظف');
  });
});
