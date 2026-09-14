/**
 * shiftRetryPacing.test.js — a failed delivery is retried by the sweeper, not at once.
 *
 * PR1 review (round 2): a failed send used to be rescheduled on a 0 ms timer, so a short Meta outage
 * (a rate limit, a 5xx) used all three attempts within milliseconds and nothing retried once it
 * cleared. The rows now stay `received` and each sweep (a minute apart) is the next attempt
 * (pr1-contracts §9.4: "rows stay received → SW orphan (≥30 s) → retry").
 *
 * Real batcher and real sweeper on the in-memory fakeDb; WhatsApp, alerts and the SHIFT workflow
 * mocked; fake timers. No network.
 */

require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('../src/services/whatsapp', () => ({
  sendText: jest.fn(),
  sendInteractiveButtons: jest.fn(),
  sendTextMessage: jest.fn(),
  markAsRead: jest.fn(),
  graphVersion: jest.fn(() => 'v21.0'),
  normalizePhone: jest.fn((p) => (p ? String(p).replace(/\D/g, '') : p)),
}));
jest.mock('../src/services/alerts', () => ({
  sendStaffAlert: jest.fn(),
  alertChannelConfigured: jest.fn(() => false),
  ALERT_REASONS: [],
}));
jest.mock('../src/workflows/shift', () => ({
  processShiftBatch: jest.fn(),
  toWorkflowResult: jest.fn(),
}));

const db = require('./helpers/fakeDb').getFakeDb();
const whatsapp = require('../src/services/whatsapp');
const alerts = require('../src/services/alerts');
const shift = require('../src/workflows/shift');
const batcher = require('../src/services/replyBatcher');
const { runSweep } = require('../src/services/shiftSweeper');

const CUSTOMER = '962790000001';

async function settle(ticks = 300) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

beforeEach(() => {
  db.reset();
  jest.clearAllMocks();
  delete process.env.SHIFT_BOT_LIVE;
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  alerts.sendStaffAlert.mockReset().mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
  whatsapp.markAsRead.mockReset().mockResolvedValue(true);
  shift.processShiftBatch.mockReset().mockImplementation(async () => ({
    kind: 'reply', action: 'NONE', messages: [{ type: 'text', text: 'أهلًا! شو نوع منشأتك؟' }],
    stateUpdate: {}, workflowDataPatch: null, leadPatch: null, leadMeta: null, needsTeam: null, alert: null,
  }));
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  batcher.cancelAll();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('a 60 s rate limit: one attempt during it, then the next sweep after it clears answers the customer', async () => {
  const [biz] = db.seed({
    businesses: [{
      name: 'SHIFT', business_type: 'shift', status: 'active', wa_phone_number_id: 'pnid_shift',
      wa_access_token: 'plain_test_token', ai_config: {},
    }],
  }).businesses;
  const start = Date.now();
  const [conv] = db.seed({
    conversations: [{ business_id: biz.id, customer_wa_id: CUSTOMER, last_inbound_at: new Date(start) }],
  }).conversations;
  const [inbound] = db.seed({
    messages: [{
      business_id: biz.id, conversation_id: conv.id, direction: 'inbound', status: 'received',
      message_type: 'text', text_body: 'كم سعر الاشتراك؟', meta_message_id: 'wamid.in1', created_at: new Date(start),
    }],
  }).messages;

  // Meta throttles (130429) for the first 60 s, then accepts.
  let seq = 0;
  const sendAttemptsAt = [];
  whatsapp.sendText.mockImplementation(async () => {
    sendAttemptsAt.push(Date.now() - start);
    if (Date.now() - start < 60000) {
      return { ok: false, id: null, error: 'rate limit', reason: 'rate_limit', code: 130429, httpStatus: 429, retryable: false };
    }
    seq += 1;
    return { ok: true, id: `wamid.out${seq}`, error: null, reason: null, code: null, httpStatus: 200, retryable: false };
  });

  await batcher.runBatch(conv.id);
  for (let i = 0; i < 20; i++) {
    await jest.advanceTimersByTimeAsync(1);
    await settle();
  }

  const conversation = () => db.store.conversations.find((c) => c.id === conv.id);
  // No back-to-back retries inside the outage.
  expect(conversation().metadata.reply_failures).toBe(1);
  expect(sendAttemptsAt).toHaveLength(1);
  expect(shift.processShiftBatch).toHaveBeenCalledTimes(1);
  expect(batcher.hasPendingTimer(conv.id)).toBe(false);

  // The throttle clears; the sweeper runs every minute.
  for (let minute = 1; minute <= 3; minute++) {
    await jest.advanceTimersByTimeAsync(60000);
    await runSweep({ now: new Date() });
    await jest.advanceTimersByTimeAsync(10);
    await settle();
  }

  expect(db.store.messages.find((m) => m.id === inbound.id).status).toBe('answered');
  expect(db.store.messages.some((m) => m.conversation_id === conv.id && m.direction === 'outbound' && m.status === 'sent')).toBe(true);
  expect(sendAttemptsAt).toHaveLength(2);
  expect(sendAttemptsAt[1]).toBeGreaterThanOrEqual(60000);
  expect(conversation().metadata.reply_failures).toBe(0);
  expect(alerts.sendStaffAlert.mock.calls.map(([a]) => a.reason)).not.toContain('reply_failures');
});

test('an outage that outlasts three sweeps stops at three attempts, alerts once, and leaves the rows received', async () => {
  const [biz] = db.seed({
    businesses: [{
      name: 'SHIFT', business_type: 'shift', status: 'active', wa_phone_number_id: 'pnid_shift',
      wa_access_token: 'plain_test_token', ai_config: {},
    }],
  }).businesses;
  const start = Date.now();
  const [conv] = db.seed({
    conversations: [{ business_id: biz.id, customer_wa_id: CUSTOMER, last_inbound_at: new Date(start) }],
  }).conversations;
  const [inbound] = db.seed({
    messages: [{
      business_id: biz.id, conversation_id: conv.id, direction: 'inbound', status: 'received',
      message_type: 'text', text_body: 'مرحبا', meta_message_id: 'wamid.in2', created_at: new Date(start),
    }],
  }).messages;
  whatsapp.sendText.mockResolvedValue({ ok: false, id: null, error: 'server', reason: 'server', code: 500, httpStatus: 500, retryable: false });

  await batcher.runBatch(conv.id);
  for (let minute = 1; minute <= 6; minute++) {
    await jest.advanceTimersByTimeAsync(60000);
    await runSweep({ now: new Date() });
    await jest.advanceTimersByTimeAsync(10);
    await settle();
  }

  expect(whatsapp.sendText).toHaveBeenCalledTimes(3);
  expect(db.store.conversations[0].metadata.reply_failures).toBe(3);
  expect(alerts.sendStaffAlert.mock.calls.filter(([a]) => a.reason === 'reply_failures')).toHaveLength(1);
  expect(db.store.messages.find((m) => m.id === inbound.id).status).toBe('received');
});
