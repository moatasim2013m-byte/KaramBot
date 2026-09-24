/**
 * Multi-tenant isolation.
 *
 * Since Embedded Signup, every customer's WABA delivers to the same callback URL, so
 * an event is only this business's when BOTH the phone number id and the WABA it
 * arrived on match. These tests are the proof that a mismatch is dropped rather than
 * delivered to whoever happens to hold the number id.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  business: { findFirst: jest.fn() },
  conversation: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  message: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
  whatsappOnboarding: { findFirst: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
}));

const prisma = require('../src/config/prisma');
const { persistInbound } = require('../src/services/messageProcessor');

const ACME = {
  id: 'biz_acme', name: 'Acme', status: 'active', business_type: 'restaurant',
  wa_phone_number_id: 'PHONE_SHARED', wa_business_account_id: 'WABA_ACME', ai_config: {},
};

const entry = (wabaId, phoneNumberId) => ({
  id: wabaId,
  changes: [{
    field: 'messages',
    value: {
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ wa_id: '962790000000', profile: { name: 'Customer' } }],
      messages: [{ id: 'wamid.1', from: '962790000000', type: 'text', text: { body: 'مرحبا' }, timestamp: '1780000000' }],
    },
  }],
});

beforeEach(() => jest.clearAllMocks());

test('a message on the business\'s own WABA is accepted', async () => {
  prisma.business.findFirst.mockResolvedValue(ACME);
  prisma.message.findUnique.mockResolvedValue(null); // not a Meta retry
  prisma.$transaction.mockImplementation(async (fn) => fn({
    message: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'm1' }) },
    conversation: { update: jest.fn().mockResolvedValue({ id: 'conv_1' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  }));
  prisma.conversation.findFirst.mockResolvedValue({ id: 'conv_1', customer_wa_id: '962790000000', profile_name: 'Customer' });

  const out = await persistInbound(entry('WABA_ACME', 'PHONE_SHARED'));
  expect(out.business?.id).toBe('biz_acme');
});

test('the same number id arriving on another WABA is dropped, not delivered', async () => {
  // The dangerous shape: Acme's row is what a number-only lookup finds, but the event
  // came from a different customer's WhatsApp Business Account.
  prisma.business.findFirst.mockResolvedValue(ACME);

  const out = await persistInbound(entry('WABA_SOMEONE_ELSE', 'PHONE_SHARED'));

  expect(out.business).toBeNull();
  expect(out.items).toEqual([]);
  expect(prisma.$transaction).not.toHaveBeenCalled(); // nothing was written to Acme's inbox
});

test('a business with no WABA recorded still works (numbers onboarded before Embedded Signup)', async () => {
  prisma.business.findFirst.mockResolvedValue({ ...ACME, wa_business_account_id: null });
  prisma.message.findUnique.mockResolvedValue(null); // not a Meta retry
  prisma.$transaction.mockImplementation(async (fn) => fn({
    message: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'm1' }) },
    conversation: { update: jest.fn().mockResolvedValue({ id: 'conv_1' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  }));
  prisma.conversation.findFirst.mockResolvedValue({ id: 'conv_1', customer_wa_id: '962790000000', profile_name: 'Customer' });

  const out = await persistInbound(entry('WABA_ANY', 'PHONE_SHARED'));
  expect(out.business?.id).toBe('biz_acme');
});

test('an unknown number id belongs to nobody', async () => {
  prisma.business.findFirst.mockResolvedValue(null);
  const out = await persistInbound(entry('WABA_ACME', 'PHONE_UNKNOWN'));
  expect(out.business).toBeNull();
  expect(out.items).toEqual([]);
});
