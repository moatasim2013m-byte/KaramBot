/**
 * The late-payment pause in the message path (services/latePolicy.js; decisions-2026-10-08.md #8):
 * «the bot pauses; the inbox and alerts keep working». A shop the daily sweep paused for a late
 * payment still has every message stored, alerted and put in front of its team, and its bot asks
 * no AI and sends nothing. When the payment lifts the pause, the same shop's bot answers again.
 * Real messageProcessor, replyBatcher and generic workflow over the in-memory fakeDb, mocked as
 * botPauseGates.test.js does.
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
// The real module (inboxUrl, the storeAlert path), with the one sender the inbound path calls mocked.
jest.mock('../src/services/alerts', () => ({
  ...jest.requireActual('../src/services/alerts'),
  sendStaffAlert: jest.fn(),
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
const provider = require('../src/ai/provider');
const newMessageAlert = require('../src/services/newMessageAlert');
const batcher = require('../src/services/replyBatcher');
const platformSettings = require('../src/services/platformSettings');
const costGuard = require('../src/services/costGuard');
const { persistInbound, processInboundMessage } = require('../src/services/messageProcessor');
const { applyLatePolicy, liftLatePause } = require('../src/services/latePolicy');

const CUSTOMER = '962791111111';
const OWNER = '962796381676';
const PNID = 'pnid_late';

const T_NOW = new Date();
const D = 24 * 3600000;

function patchBusinesses() {
  const real = db.jsonb.patchJson.bind(db.jsonb);
  jest.spyOn(db.jsonb, 'patchJson').mockImplementation(async (table, id, column, patch, opts = {}) => {
    if (table !== 'businesses') return real(table, id, column, patch, opts);
    const row = db.store.businesses.find((b) => b.id === id);
    if (!row) return { ok: false, count: 0 };
    const next = { ...(row[column] || {}) };
    for (const k of opts.remove || []) delete next[k];
    Object.assign(next, JSON.parse(JSON.stringify(patch)));
    row[column] = next;
    return { ok: true, count: 1 };
  });
}

let seq = 0;
function entry(body) {
  seq += 1;
  return {
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: PNID },
        contacts: [{ wa_id: CUSTOMER, profile: { name: 'محمد' } }],
        messages: [{ id: `wamid.late${seq}`, from: CUSTOMER, timestamp: '1', type: 'text', text: { body } }],
      },
    }],
  };
}
async function deliver(body) {
  const e = entry(body);
  const persisted = await persistInbound(e);
  await processInboundMessage(e, { persisted });
  await Promise.all(newMessageAlert.notifyNewMessages.mock.results.map((r) => r.value));
}

const inbound = () => db.store.messages.filter((m) => m.direction === 'inbound');
const outbound = () => db.store.messages.filter((m) => m.direction === 'outbound');
const conversation = () => db.store.conversations.find((c) => c.customer_wa_id === CUSTOMER);

beforeEach(() => {
  patchBusinesses();
  db.reset();
  db.clock.set(T_NOW);
  platformSettings.clearCache();
  costGuard.clearCache();
  seq = 0;
  whatsapp.sendTextMessage.mockReset().mockResolvedValue({ messages: [{ id: 'wamid.reply' }] });
  whatsapp.markAsRead.mockReset().mockResolvedValue(true);
  alerts.sendStaffAlert.mockReset().mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
  provider.generateValidatedAIReply.mockReset().mockResolvedValue({ reply: 'أكيد، البنادول متوفر.', action: 'NONE' });
  jest.spyOn(newMessageAlert, 'notifyNewMessages');
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  db.seed({
    businesses: [{
      id: 'biz_late', name: 'صيدلية النور', business_type: 'generic', status: 'active', wa_phone_number_id: PNID,
      wa_access_token: 'plain_test_token', ai_config: { alert_wa_numbers: [OWNER] },
    }],
    businessKnowledge: [{ business_id: 'biz_late', kind: 'fact', content: 'عندنا بنادول', active: true }],
    subscriptions: [{
      id: 's1', business_id: 'biz_late', solution: 'karam_bot', status: 'active', amount_jod: 19.99, billing_cycle: 'monthly',
      starts_at: new Date(T_NOW.getTime() - 60 * D), next_due_at: new Date(T_NOW.getTime() - 9 * D), created_by: 'admin1',
    }],
  });
});

afterEach(() => {
  batcher.cancelAll();
  jest.restoreAllMocks();
});

test('paused for a late payment: the message is stored, alerted and handed to the team; no AI, nothing sent', async () => {
  expect((await applyLatePolicy(T_NOW)).paused).toBe(1);

  await deliver('عندكم بنادول؟');

  expect(inbound()).toHaveLength(1);
  expect(inbound()[0].status).toBe('delivered');
  expect(conversation()).toMatchObject({ needs_attention: true, attention_reason: 'bot_paused', unread_count: 1 });
  expect(alerts.sendStaffAlert.mock.calls.map(([a]) => a.reason)).toEqual(['new_message']);
  expect(provider.generateValidatedAIReply).not.toHaveBeenCalled();
  expect(whatsapp.sendTextMessage).not.toHaveBeenCalled();
  expect(outbound()).toHaveLength(0);
});

test('once the payment lifts the pause, the same shop\'s bot answers again', async () => {
  await applyLatePolicy(T_NOW);
  // The payment route leaves the contract active and due a month on; only then is the pause lifted.
  Object.assign(db.store.subscriptions.find((s) => s.id === 's1'), { status: 'active', next_due_at: new Date(T_NOW.getTime() + 21 * D) });
  expect(await liftLatePause('biz_late', { actorUserId: 'admin1', now: T_NOW })).toBe(true);

  await deliver('عندكم بنادول؟');

  expect(provider.generateValidatedAIReply).toHaveBeenCalledTimes(1);
  expect(whatsapp.sendTextMessage).toHaveBeenCalledWith(PNID, 'plain_test_token', CUSTOMER, 'أكيد، البنادول متوفر.');
  expect(outbound()).toHaveLength(1);
});
