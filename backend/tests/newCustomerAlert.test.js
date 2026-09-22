/**
 * The new_customer alert: one message to the team the first time a number writes,
 * and never again for that number.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  business: { findFirst: jest.fn() },
  conversation: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  message: { create: jest.fn(), findUnique: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../src/services/alerts', () => ({
  sendStaffAlert: jest.fn().mockResolvedValue({}),
  ALERT_REASONS: ['new_customer'],
  ALERT_LABELS: {},
}));

const prisma = require('../src/config/prisma');
const alerts = require('../src/services/alerts');
const { persistInbound } = require('../src/services/messageProcessor');

const BUSINESS = {
  id: 'biz_1', name: 'SHIFT', status: 'active', business_type: 'restaurant',
  wa_phone_number_id: 'PHONE_1', wa_business_account_id: 'WABA_1', ai_config: {},
};

const entry = () => ({
  id: 'WABA_1',
  changes: [{
    field: 'messages',
    value: {
      metadata: { phone_number_id: 'PHONE_1' },
      contacts: [{ wa_id: '971557657948', profile: { name: 'أخوي' } }],
      messages: [{ id: 'wamid.1', from: '971557657948', type: 'text', text: { body: 'مرحبا بدي أسأل' }, timestamp: '1790000000' }],
    },
  }],
});

function txOk() {
  prisma.message.findUnique.mockResolvedValue(null);
  prisma.$transaction.mockImplementation(async (fn) => fn({
    message: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'm1' }) },
    conversation: { update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.business.findFirst.mockResolvedValue(BUSINESS);
  txOk();
});

test('a number writing for the first time alerts the team once', async () => {
  prisma.conversation.findFirst.mockResolvedValue(null);           // never seen before
  prisma.conversation.create.mockResolvedValue({ id: 'conv_1', customer_wa_id: '971557657948', profile_name: 'أخوي' });

  await persistInbound(entry());
  await new Promise((r) => setImmediate(r)); // the alert is fired, not awaited

  expect(alerts.sendStaffAlert).toHaveBeenCalledTimes(1);
  const call = alerts.sendStaffAlert.mock.calls[0][0];
  expect(call.reason).toBe('new_customer');
  expect(call.business.id).toBe('biz_1');
  expect(call.summary).toBe('مرحبا بدي أسأل');   // what they actually said
});

test('a customer who already has a conversation does not alert again', async () => {
  prisma.conversation.findFirst.mockResolvedValue({
    id: 'conv_1', customer_wa_id: '971557657948', profile_name: 'أخوي',
  });

  await persistInbound(entry());
  await new Promise((r) => setImmediate(r));

  expect(alerts.sendStaffAlert).not.toHaveBeenCalled();
});

test('the delivery that lost the create race does not alert', async () => {
  // Two webhook deliveries for a new customer race; the loser gets P2002 and finds the row.
  prisma.conversation.findFirst
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ id: 'conv_1', customer_wa_id: '971557657948' });
  prisma.conversation.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));

  await persistInbound(entry());
  await new Promise((r) => setImmediate(r));

  expect(alerts.sendStaffAlert).not.toHaveBeenCalled();
});

test('a failing alert never breaks the message pipeline', async () => {
  prisma.conversation.findFirst.mockResolvedValue(null);
  prisma.conversation.create.mockResolvedValue({ id: 'conv_1', customer_wa_id: '971557657948' });
  alerts.sendStaffAlert.mockRejectedValue(new Error('whatsapp down'));

  const out = await persistInbound(entry());
  await new Promise((r) => setImmediate(r));

  expect(out.business.id).toBe('biz_1');   // the message was still saved
  expect(out.items.length).toBe(1);
});
