/**
 * workflowAlerts.test.js — a customer's own business finally hears from its bot.
 *
 * services/alerts.js has carried `handoff`, `ai_failure`, `needs_team` and `billing` for a while,
 * but every caller was SHIFT's own sales bot. A customer's business got one alert —
 * `new_message` — so when its bot handed a conversation to a human, failed, or had its messages
 * refused by WhatsApp for want of a payment method, the owner was told nothing.
 *
 * Real messageProcessor + workflows on the in-memory fakeDb; axios mocked (no network).
 */

require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');
jest.mock('../src/ai/provider', () => ({
  generateValidatedAIReply: jest.fn(),
  generateAIReply: jest.fn(),
}));

const axios = require('axios');
const db = require('./helpers/fakeDb').getFakeDb();
const alerts = require('../src/services/alerts');
const provider = require('../src/ai/provider');
const replyBatcher = require('../src/services/replyBatcher');
const { persistInbound, processInboundMessage } = require('../src/services/messageProcessor');
const { encrypt } = require('../src/utils/tokenCrypto');

const PNID = 'pnid_wfalerts';
const CUSTOMER = '962791111111';
const OWNER = '962796381676';
const BILLING_ERROR_CODE = 131042;
const T0 = new Date();

let seq = 0;
let sendStaffAlert;

function seedBusiness(aiConfig = {}, extra = {}) {
  return db.seed({
    businesses: [{
      id: 'biz_wf',
      name: 'صيدلية',
      business_type: 'generic',
      status: 'active',
      wa_phone_number_id: PNID,
      wa_access_token: encrypt('tok'),
      ai_config: { alert_wa_numbers: [OWNER], ...aiConfig },
      ...extra,
    }],
  }).businesses[0];
}

const entry = (body) => ({
  changes: [{
    value: {
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: PNID },
      contacts: [{ wa_id: CUSTOMER, profile: { name: 'محمد' } }],
      messages: [{ id: `wamid.w${++seq}`, from: CUSTOMER, timestamp: '1', type: 'text', text: { body } }],
    },
  }],
});

const statusEntry = (status) => ({
  changes: [{
    value: {
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: PNID },
      statuses: [status],
    },
  }],
});

// Drives the real inbound path, then lets the fire-and-forget alert settle.
async function deliver(body) {
  const e = entry(body);
  const persisted = await persistInbound(e);
  await processInboundMessage(e, { persisted });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

const reasonsSent = () => sendStaffAlert.mock.calls.map((c) => c[0].reason);

beforeEach(() => {
  db.reset();
  db.clock.set(T0);
  seq = 0;
  jest.restoreAllMocks();
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.out1' }] } });
  provider.generateValidatedAIReply.mockReset();
  delete process.env.STAFF_ALERT_WEBHOOK_URL;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  sendStaffAlert = jest.spyOn(alerts, 'sendStaffAlert').mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
});

afterEach(() => {
  replyBatcher.cancelAll?.();
});

test('the bot handing a conversation to a human alerts the owner', async () => {
  seedBusiness({ handoff_keywords: ['موظف'] });

  await deliver('بدي موظف');

  expect(reasonsSent()).toContain('handoff');
  const call = sendStaffAlert.mock.calls.find((c) => c[0].reason === 'handoff')[0];
  expect(call.business.id).toBe('biz_wf');
  expect(call.conversation).toBeTruthy();
  expect(call.summary).toContain('موظف'); // what the customer actually wrote
});

test('a model failure is reported as a fault, not as a lead', async () => {
  // The owner must be able to tell "a customer asked for me" from "your bot is broken".
  seedBusiness();
  db.seed({ businessKnowledge: [{ business_id: 'biz_wf', kind: 'hours', content: 'من ٩ صباحاً', active: true }] });
  provider.generateValidatedAIReply.mockResolvedValue(null); // invalid output twice

  await deliver('شو أوقات الدوام؟');

  expect(reasonsSent()).toContain('ai_failure');
  expect(reasonsSent()).not.toContain('handoff');
});

test('WhatsApp refusing a message for a missing payment method alerts that business', async () => {
  // Previously gated to SHIFT's own row: a customer whose delivery had stopped heard nothing.
  seedBusiness();
  // The alert belongs to the conversation of the failed send, so one has to exist.
  db.seed({ conversations: [{ id: 'conv_wf', business_id: 'biz_wf', customer_wa_id: CUSTOMER, status: 'open', ai_enabled: true }] });

  const e = statusEntry({
    id: 'wamid.out1', status: 'failed', recipient_id: CUSTOMER,
    errors: [{ code: BILLING_ERROR_CODE, title: 'payment method missing' }],
  });
  await processInboundMessage(e, { persisted: { business: null, items: [] } });
  await new Promise((r) => setImmediate(r));

  expect(reasonsSent()).toContain('billing');
});

test('a failing alert does not break the reply', async () => {
  seedBusiness({ handoff_keywords: ['موظف'] });
  sendStaffAlert.mockRejectedValue(new Error('alert channel down'));

  await expect(deliver('بدي موظف')).resolves.toBeUndefined();

  const sent = db.store.messages.filter((m) => m.direction === 'outbound');
  expect(sent.length).toBeGreaterThan(0);
  expect(sent.some((m) => m.text_body && m.text_body.includes('موظف'))).toBe(true);
});

test('an alert that never settles does not hold up the reply', async () => {
  // The real guarantee: not "the rejection was caught" but "the reply does not wait". An
  // implementation that awaited sendStaffAlert would pass the test above and fail this one.
  seedBusiness({ handoff_keywords: ['موظف'] });
  let release;
  sendStaffAlert.mockImplementation(() => new Promise((r) => { release = r; }));

  await deliver('بدي موظف');

  expect(sendStaffAlert).toHaveBeenCalled();
  // The customer was answered while the alert was still in flight.
  const sent = db.store.messages.filter((m) => m.direction === 'outbound');
  expect(sent.length).toBeGreaterThan(0);
  release({ webhook: 'skipped', whatsapp: [] });
});

test('a provider out of credits reaches the owner as a fault', async () => {
  // ai/provider.js hands this to the onProviderIssue callback the workflows now pass; it
  // throttles to once an hour per provider, so it cannot flood the owner's phone.
  seedBusiness();
  db.seed({ businessKnowledge: [{ business_id: 'biz_wf', kind: 'hours', content: 'من ٩ صباحاً', active: true }] });
  provider.generateValidatedAIReply.mockImplementation(async (_sys, _msg, _hist, opts) => {
    opts.onProviderIssue({ provider: 'gemini', kind: 'quota', summary: 'رصيد مزوّد الذكاء خلص' });
    return { reply: 'من ٩ صباحاً', action: 'NONE' }; // the fallback provider answered
  });

  await deliver('شو أوقات الدوام؟');

  expect(reasonsSent()).toContain('ai_failure');
  const call = sendStaffAlert.mock.calls.find((c) => c[0].reason === 'ai_failure')[0];
  expect(call.summary).toContain('رصيد');
  expect(call.business.id).toBe('biz_wf');
});

test('a staff alert that fails to deliver does not raise another alert', async () => {
  // Otherwise an unpaid account would have its billing alert fail, alert about that failure,
  // fail again, and keep going for as long as it stayed unpaid.
  seedBusiness();
  db.seed({
    conversations: [{ id: 'conv_staff', business_id: 'biz_wf', customer_wa_id: OWNER, status: 'open', ai_enabled: true }],
    messages: [{
      id: 'm_alert', business_id: 'biz_wf', conversation_id: 'conv_staff', direction: 'outbound',
      meta_message_id: 'wamid.alert1', status: 'sent', raw_payload: { kind: 'staff_alert', reason: 'billing' },
    }],
  });

  const e = statusEntry({
    id: 'wamid.alert1', status: 'failed', recipient_id: OWNER,
    errors: [{ code: BILLING_ERROR_CODE, title: 'payment method missing' }],
  });
  await processInboundMessage(e, { persisted: { business: null, items: [] } });
  await new Promise((r) => setImmediate(r));

  expect(reasonsSent()).not.toContain('billing');
});

test('an ordinary answered message raises no handoff or fault alert', async () => {
  seedBusiness();
  db.seed({ businessKnowledge: [{ business_id: 'biz_wf', kind: 'hours', content: 'من ٩ صباحاً', active: true }] });
  provider.generateValidatedAIReply.mockResolvedValue({ reply: 'من ٩ صباحاً', action: 'NONE' });

  await deliver('شو أوقات الدوام؟');

  expect(reasonsSent()).not.toContain('handoff');
  expect(reasonsSent()).not.toContain('ai_failure');
});
