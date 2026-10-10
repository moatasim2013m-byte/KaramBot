/**
 * Coexistence on the message path (docs/panels/spec.md P5): when the owner answers a customer from
 * the WhatsApp Business app, the bot does not answer underneath them in that chat — and nothing
 * else about the live bot changes. With coexistence off (the default), an echo is dropped and the
 * bot answers exactly as before.
 *
 * Real messageProcessor, generic workflow and coexistence service over the in-memory fakeDb, set up
 * like botPauseGates.test.js: WhatsApp, the AI provider, media and the alert sender are mocked.
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
  partSummary: jest.fn((...args) => jest.requireActual('../src/services/whatsapp').partSummary(...args)),
  sendTextMessage: jest.fn(),
  markAsRead: jest.fn(),
  normalizePhone: jest.fn((p) => (p ? String(p).replace(/\D/g, '') : p)),
}));
jest.mock('../src/services/alerts', () => ({
  ...jest.requireActual('../src/services/alerts'),
  sendStaffAlert: jest.fn(),
  notifyShift: jest.fn(),
}));
jest.mock('../src/workflows/shift', () => ({ processShiftBatch: jest.fn(), toWorkflowResult: jest.fn() }));
jest.mock('../src/ai/provider', () => ({ generateValidatedAIReply: jest.fn(), generateAIReply: jest.fn(), resolveModel: () => 'gemini-test' }));
jest.mock('../src/workflows/shift/media', () => ({
  mediaEnabled: jest.fn(() => true),
  readForTenant: jest.fn(),
  enrichBatch: jest.fn(async (b, t, batch) => ({ batch, updates: [] })),
}));

const db = require('./helpers/fakeDb').getFakeDb();
const whatsapp = require('../src/services/whatsapp');
const alerts = require('../src/services/alerts');
const provider = require('../src/ai/provider');
const settings = require('../src/services/platformSettings');
const coexistence = require('../src/services/coexistence');
const batcher = require('../src/services/replyBatcher');
const { persistInbound, processInboundMessage } = require('../src/services/messageProcessor');
const cx = require('./fixtures/coexAssumed');

const PNID = 'pnid_coex';
const WABA = 'waba_coex';
const CUSTOMER = cx.CUSTOMER;
const OTHER_CUSTOMER = '962797777777';
const HOUR = 60 * 60 * 1000;
// The 24 h service window and the owner hold read the real clock.
const T0 = new Date();
let seq = 0;

function seedShop() {
  db.seed({
    businesses: [{
      id: 'biz_coex', name: 'محمص أبو أحمد', business_type: 'generic', status: 'active',
      wa_phone_number_id: PNID, wa_business_account_id: WABA, wa_access_token: 'plain_test_token', ai_config: {},
    }],
    businessKnowledge: [{ business_id: 'biz_coex', kind: 'fact', content: 'عندنا قهوة عربية', active: true }],
  });
}

function switchOn() {
  db.seed({ platformSettings: [{ key: 'coexistence', value: { enabled: true } }] });
  settings.clearCache();
}

function inbound(from, body) {
  seq += 1;
  return {
    id: WABA,
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: PNID },
        contacts: [{ wa_id: from, profile: { name: 'زبون' } }],
        messages: [{ id: `wamid.in${seq}`, from, timestamp: '1', type: 'text', text: { body } }],
      },
    }],
  };
}

async function deliver(from, body) {
  const e = inbound(from, body);
  const persisted = await persistInbound(e);
  await processInboundMessage(e, { persisted });
}

// The owner's reply from the app, `agoMs` before now.
async function ownerReplied({ to = CUSTOMER, agoMs = 0, id } = {}) {
  seq += 1;
  const d = cx.echo({ id: id || `wamid.echo${seq}`, to, phone: PNID, waba: WABA, timestamp: Math.floor((Date.now() - agoMs) / 1000) });
  return coexistence.handleEchoes(d.entry[0], d.entry[0].changes[0]);
}

const conv = (wa) => db.store.conversations.find((c) => c.customer_wa_id === wa);
const botRows = () => db.store.messages.filter((m) => m.direction === 'outbound' && m.is_ai_generated);

beforeEach(() => {
  db.reset();
  db.clock.set(T0);
  settings.clearCache();
  jest.clearAllMocks();
  seq = 0;
  whatsapp.sendTextMessage.mockReset().mockImplementation(async () => ({ messages: [{ id: `wamid.reply${++seq}` }] }));
  whatsapp.markAsRead.mockReset().mockResolvedValue(true);
  alerts.sendStaffAlert.mockReset().mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
  provider.generateValidatedAIReply.mockReset().mockResolvedValue({ reply: 'أهلًا، القهوة متوفرة.', action: 'NONE' });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  seedShop();
});

afterEach(() => {
  batcher.cancelAll();
  jest.restoreAllMocks();
});

describe('coexistence off (the default): nothing changes', () => {
  test('an echo is dropped, and the bot answers that customer as before', async () => {
    const out = await ownerReplied();
    expect(out).toMatchObject({ stored: 0, refused: true });
    expect(db.store.messages).toHaveLength(0);

    await deliver(CUSTOMER, 'عندكم قهوة؟');
    expect(provider.generateValidatedAIReply).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendTextMessage).toHaveBeenCalledWith(PNID, 'plain_test_token', CUSTOMER, 'أهلًا، القهوة متوفرة.');
    expect(botRows()).toHaveLength(1);
    expect(conv(CUSTOMER).metadata[coexistence.HOLD_KEY]).toBeUndefined();
  });
});

describe('coexistence on', () => {
  beforeEach(switchOn);

  test('with no echo the bot answers as before', async () => {
    await deliver(CUSTOMER, 'عندكم قهوة؟');
    expect(provider.generateValidatedAIReply).toHaveBeenCalledTimes(1);
    expect(botRows()).toHaveLength(1);
  });

  test('the owner just replied from the app: the echo is the shop\'s message, and the bot stays quiet in that chat only', async () => {
    const out = await ownerReplied();
    expect(out).toEqual({ stored: 1 });

    const echoRow = db.store.messages.find((m) => m.meta_message_id === `wamid.echo${seq}`);
    expect(echoRow).toMatchObject({
      business_id: 'biz_coex', direction: 'outbound', is_ai_generated: false, sent_by_user_id: null,
      status: 'sent', text_body: 'أهلين، الطلب جاهز', raw_payload: { source: 'owner_app' },
    });
    expect(conv(CUSTOMER).last_outbound_at).toEqual(echoRow.created_at);
    expect(new Date(conv(CUSTOMER).metadata[coexistence.HOLD_KEY]).getTime())
      .toBe(echoRow.created_at.getTime() + coexistence.OWNER_HOLD_MS);

    await deliver(CUSTOMER, 'تمام، بمرّ بعد ساعة');
    expect(provider.generateValidatedAIReply).not.toHaveBeenCalled();
    expect(whatsapp.sendTextMessage).not.toHaveBeenCalled();
    // The customer's message is stored for the inbox all the same.
    expect(db.store.messages.filter((m) => m.direction === 'inbound')).toHaveLength(1);

    // Another customer of the same shop still gets the bot.
    await deliver(OTHER_CUSTOMER, 'عندكم قهوة؟');
    expect(provider.generateValidatedAIReply).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendTextMessage).toHaveBeenCalledWith(PNID, 'plain_test_token', OTHER_CUSTOMER, 'أهلًا، القهوة متوفرة.');
  });

  test('once the hold has passed, the bot answers that customer again', async () => {
    await ownerReplied({ agoMs: coexistence.OWNER_HOLD_MS + HOUR });
    await deliver(CUSTOMER, 'عندكم قهوة؟');
    expect(provider.generateValidatedAIReply).toHaveBeenCalledTimes(1);
    expect(botRows()).toHaveLength(1);
  });

  test('an older echo arriving late does not shorten a newer hold', async () => {
    await ownerReplied({ agoMs: 0 });
    const held = conv(CUSTOMER).metadata[coexistence.HOLD_KEY];
    await ownerReplied({ agoMs: coexistence.OWNER_HOLD_MS + HOUR });
    expect(conv(CUSTOMER).metadata[coexistence.HOLD_KEY]).toBe(held);
  });

  test('the bot\'s own send coming back as an echo changes nothing: it never silences the bot', async () => {
    await deliver(CUSTOMER, 'عندكم قهوة؟');
    const sent = botRows()[0];
    expect(sent.meta_message_id).toBeTruthy();

    const out = await ownerReplied({ id: sent.meta_message_id });
    expect(out).toEqual({ stored: 0 });
    expect(conv(CUSTOMER).metadata[coexistence.HOLD_KEY]).toBeUndefined();

    await deliver(CUSTOMER, 'وقديش السعر؟');
    expect(provider.generateValidatedAIReply).toHaveBeenCalledTimes(2);
  });

  test('a repeated echo delivery is stored once', async () => {
    await ownerReplied({ id: 'wamid.same' });
    await ownerReplied({ id: 'wamid.same' });
    expect(db.store.messages.filter((m) => m.meta_message_id === 'wamid.same')).toHaveLength(1);
  });
});
