/**
 * billingAlertLoop.test.js — the billing alert must not feed itself.
 *
 * Live incident, 2026-10-02: the owner's brother received 67 identical «واتساب موقف الإرسال»
 * alerts in two minutes, 24 then 39 a minute and climbing. A billing alert is itself a WhatsApp
 * message, so it failed for the very reason it was reporting; Meta posted a failed status for it;
 * that raised another alert. The staff number was also in alert_wa_numbers, so each alert was
 * additionally reported as a customer («العميل: Osaid (+9715…)»), doubling the fan-out.
 *
 * Real messageProcessor + the in-memory fakeDb; axios mocked (no network).
 */

require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');

const axios = require('axios');
const db = require('./helpers/fakeDb').getFakeDb();
const alerts = require('../src/services/alerts');
const replyBatcher = require('../src/services/replyBatcher');
const { processInboundMessage } = require('../src/services/messageProcessor');
const { encrypt } = require('../src/utils/tokenCrypto');

const PNID = 'pnid_billing';
const CUSTOMER = '962791111111';
const OWNER = '962796381676';
const BROTHER = '971557657948';
const BILLING_ERROR_CODE = 131042;
const T0 = new Date();

let sendStaffAlert;

function seed() {
  db.seed({
    businesses: [{
      id: 'biz_shift',
      name: 'SHIFT',
      business_type: 'shift',
      status: 'active',
      wa_phone_number_id: PNID,
      wa_access_token: encrypt('tok'),
      ai_config: { alert_wa_numbers: [OWNER, BROTHER] },
    }],
  });
}

const statusEntry = (status) => ({
  changes: [{
    value: {
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: PNID },
      statuses: [status],
    },
  }],
});

const failed = (id, recipient) => ({
  id, status: 'failed', recipient_id: recipient,
  errors: [{ code: BILLING_ERROR_CODE, title: 'payment method missing' }],
});

async function deliverStatus(status) {
  await processInboundMessage(statusEntry(status), { persisted: { business: null, items: [] } });
  await new Promise((r) => setImmediate(r));
}

const billingAlerts = () => sendStaffAlert.mock.calls.filter((c) => c[0].reason === 'billing');

beforeEach(() => {
  db.reset();
  db.clock.set(T0);
  jest.restoreAllMocks();
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.out' }] } });
  delete process.env.STAFF_ALERT_WEBHOOK_URL;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  sendStaffAlert = jest.spyOn(alerts, 'sendStaffAlert').mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
  seed();
});

afterEach(() => {
  replyBatcher.cancelAll?.();
});

test('a real customer whose message was refused alerts the team once', async () => {
  db.seed({
    conversations: [{ id: 'conv_cust', business_id: 'biz_shift', customer_wa_id: CUSTOMER, status: 'open', ai_enabled: true }],
    messages: [{
      id: 'm1', business_id: 'biz_shift', conversation_id: 'conv_cust', direction: 'outbound',
      meta_message_id: 'wamid.cust1', status: 'sent',
    }],
  });

  await deliverStatus(failed('wamid.cust1', CUSTOMER));

  expect(billingAlerts()).toHaveLength(1);
  const conv = db.store.conversations.find((c) => c.id === 'conv_cust');
  expect(conv.metadata.billing_blocked_at).toBeTruthy();
});

test('a staff alert that fails does not raise another one', async () => {
  // The loop. The alert row is stamped kind: 'staff_alert' by alerts.js.
  db.seed({
    conversations: [{ id: 'conv_staff', business_id: 'biz_shift', customer_wa_id: BROTHER, status: 'open', ai_enabled: true }],
    messages: [{
      id: 'm_alert', business_id: 'biz_shift', conversation_id: 'conv_staff', direction: 'outbound',
      meta_message_id: 'wamid.alert1', status: 'sent',
      raw_payload: { kind: 'staff_alert', reason: 'billing' },
    }],
  });

  await deliverStatus(failed('wamid.alert1', BROTHER));

  expect(billingAlerts()).toHaveLength(0);
});

test('a staff number is never reported as a customer', async () => {
  // The other half: even a non-alert message to a staff number must not produce «العميل: …».
  db.seed({
    conversations: [{ id: 'conv_staff2', business_id: 'biz_shift', customer_wa_id: BROTHER, status: 'open', ai_enabled: true }],
    messages: [{
      id: 'm_plain', business_id: 'biz_shift', conversation_id: 'conv_staff2', direction: 'outbound',
      meta_message_id: 'wamid.plain1', status: 'sent',
    }],
  });

  await deliverStatus(failed('wamid.plain1', BROTHER));

  expect(billingAlerts()).toHaveLength(0);
});

test('a status with no row of its own still cannot alert about a staff number', async () => {
  // The recipient-lookup path: an unknown wamid locates the conversation by recipient.
  db.seed({
    conversations: [{ id: 'conv_staff3', business_id: 'biz_shift', customer_wa_id: BROTHER, status: 'open', ai_enabled: true }],
  });

  await deliverStatus(failed('wamid.unknown', BROTHER));

  expect(billingAlerts()).toHaveLength(0);
});

test('every later refusal in the same conversation carries the banner but does not alert again', async () => {
  // A missing payment method is a standing condition: 67 refusals are one piece of news.
  db.seed({
    conversations: [{ id: 'conv_cust2', business_id: 'biz_shift', customer_wa_id: CUSTOMER, status: 'open', ai_enabled: true }],
    messages: [
      { id: 'a1', business_id: 'biz_shift', conversation_id: 'conv_cust2', direction: 'outbound', meta_message_id: 'wamid.a1', status: 'sent' },
      { id: 'a2', business_id: 'biz_shift', conversation_id: 'conv_cust2', direction: 'outbound', meta_message_id: 'wamid.a2', status: 'sent' },
      { id: 'a3', business_id: 'biz_shift', conversation_id: 'conv_cust2', direction: 'outbound', meta_message_id: 'wamid.a3', status: 'sent' },
    ],
  });

  await deliverStatus(failed('wamid.a1', CUSTOMER));
  await deliverStatus(failed('wamid.a2', CUSTOMER));
  await deliverStatus(failed('wamid.a3', CUSTOMER));

  expect(billingAlerts()).toHaveLength(1);
  expect(db.store.conversations.find((c) => c.id === 'conv_cust2').metadata.billing_blocked_at).toBeTruthy();
});
