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
const platformSettings = require('../src/services/platformSettings');
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
      // Already live: these tests are about the shop's alerts, and a first reply would add SHIFT's
      // went_live alert (wentLive.test.js).
      went_live_at: new Date('2026-09-01T00:00:00Z'),
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
  platformSettings.clearCache();
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

// Lets the fire-and-forget notifyShift chain (several awaits) and the provider_status write settle.
async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) await new Promise((r) => setImmediate(r));
}

const SHIFT_PNID = 'pnid_shift_own';
const SHIFT_STAFF = '962790000009';

function seedShift() {
  db.seed({
    businesses: [{
      id: 'biz_shift', name: 'شِفت', slug: 'shift', business_type: 'shift', status: 'active', is_internal: true,
      wa_phone_number_id: SHIFT_PNID, wa_access_token: encrypt('shift_tok'),
      ai_config: { alert_wa_numbers: [SHIFT_STAFF] },
    }],
    // SHIFT's staff member wrote to SHIFT's number within the day, so the alert goes as free text.
    conversations: [{ id: 'conv_shift_staff', business_id: 'biz_shift', customer_wa_id: SHIFT_STAFF, status: 'open', ai_enabled: true, last_inbound_at: T0 }],
  });
}

function providerOutage() {
  db.seed({ businessKnowledge: [{ business_id: 'biz_wf', kind: 'hours', content: 'من ٩ صباحاً', active: true }] });
  provider.generateValidatedAIReply.mockImplementation(async (_sys, _msg, _hist, opts) => {
    opts.onProviderIssue({ provider: 'gemini', kind: 'billing', next: 'anthropic', summary: 'رصيد Gemini خلص — البوت شغّال على Claude' });
    return { reply: 'من ٩ صباحاً', action: 'NONE' }; // the fallback provider answered
  });
}

test('a provider out of credits alerts SHIFT, not the shop that happened to hit it', async () => {
  // provider.js throttles this to once an hour across every shop, so the one alert used to go to
  // whichever owner's customer wrote first: a random shop was told SHIFT's credits ran out.
  seedBusiness();
  providerOutage();
  const notifyShift = jest.spyOn(alerts, 'notifyShift').mockResolvedValue(null);

  await deliver('شو أوقات الدوام؟');
  await settle();

  expect(reasonsSent()).not.toContain('ai_failure'); // nothing to the shop's numbers
  expect(notifyShift).toHaveBeenCalledTimes(1);
  const arg = notifyShift.mock.calls[0][0];
  expect(arg).toEqual({
    reason: 'provider_down', businessId: 'biz_wf', shopName: 'صيدلية', summary: 'رصيد Gemini خلص — البوت شغّال على Claude',
  });
  // The customer's question is nowhere in it.
  expect(JSON.stringify(arg)).not.toContain('أوقات الدوام');
});

test('the outage is recorded in provider_status for the operator panel', async () => {
  seedBusiness();
  providerOutage();
  jest.spyOn(alerts, 'notifyShift').mockResolvedValue(null);

  await deliver('شو أوقات الدوام؟');
  await settle();

  const row = db.store.platformSettings.find((r) => r.key === 'provider_status');
  expect(row.value).toEqual({ provider: 'gemini', kind: 'billing', last_seen: expect.any(String) });
  expect(Number.isNaN(Date.parse(row.value.last_seen))).toBe(false);
});

test('SHIFT\'s own sales bot hitting the outage first records provider_status too (review 2026-10-08)', async () => {
  // provider.js hands the hourly issue to whichever callback hit it first; SHIFT's number is the
  // busiest, and its callback used to write nothing here, so the outage never showed.
  seedShift();
  jest.spyOn(alerts, 'sendStaffAlert').mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
  const { providerIssueAlert } = require('../src/workflows/shift');
  const shiftBiz = db.store.businesses.find((b) => b.id === 'biz_shift');
  providerIssueAlert({ business: shiftBiz, conversation: { id: 'c1' } })({ provider: 'anthropic', kind: 'auth', summary: 'مفتاح Claude مرفوض' });
  await settle();

  const row = db.store.platformSettings.find((r) => r.key === 'provider_status');
  expect(row.value).toEqual({ provider: 'anthropic', kind: 'auth', last_seen: expect.any(String) });
  // Its own alert still goes as before.
  expect(alerts.sendStaffAlert).toHaveBeenCalledWith(expect.objectContaining({ reason: 'ai_failure' }));
});

test('end to end: the WhatsApp alert leaves from SHIFT\'s number to SHIFT staff, never to the owner', async () => {
  seedShift();
  seedBusiness();
  providerOutage();

  await deliver('شو أوقات الدوام؟');
  await settle();

  const sends = axios.post.mock.calls.filter(([url]) => /\/messages$/.test(String(url)));
  const toShift = sends.filter(([url, body]) => String(url).includes(SHIFT_PNID) && body.to === SHIFT_STAFF);
  expect(toShift).toHaveLength(1);
  expect(JSON.stringify(toShift[0][1])).toContain('صيدلية');
  expect(JSON.stringify(toShift[0][1])).not.toContain('أوقات الدوام');
  // The owner's number got the customer's answer path only, never an outage alert.
  expect(sends.some(([, body]) => body.to === OWNER)).toBe(false);
});

test('the shop\'s conversation still answers on the fallback provider', async () => {
  seedBusiness();
  providerOutage();
  jest.spyOn(alerts, 'notifyShift').mockResolvedValue(null);

  await deliver('شو أوقات الدوام؟');

  const sent = db.store.messages.filter((m) => m.direction === 'outbound' && m.business_id === 'biz_wf');
  expect(sent.map((m) => m.text_body)).toContain('من ٩ صباحاً');
});

test('when no provider answers, the conversation is handed to the shop\'s staff as before', async () => {
  // The handover alert is the shop's signal; only the provider-outage alarm moved to SHIFT.
  seedBusiness();
  db.seed({ businessKnowledge: [{ business_id: 'biz_wf', kind: 'hours', content: 'من ٩ صباحاً', active: true }] });
  jest.spyOn(alerts, 'notifyShift').mockResolvedValue(null);
  provider.generateValidatedAIReply.mockImplementation(async (_sys, _msg, _hist, opts) => {
    opts.onProviderIssue({ provider: 'gemini', kind: 'billing', next: null, summary: 'رصيد Gemini خلص' });
    return null;
  });

  await deliver('شو أوقات الدوام؟');

  expect(reasonsSent()).toContain('ai_failure'); // the handover, from the workflow's result
  const conv = db.store.conversations.find((c) => c.business_id === 'biz_wf');
  expect(conv.status).toBe('human_takeover');
  expect(alerts.notifyShift).toHaveBeenCalledWith(expect.objectContaining({ reason: 'provider_down' }));
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
