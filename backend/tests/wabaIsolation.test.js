/**
 * Multi-tenant isolation.
 *
 * Since Embedded Signup, every customer's WABA delivers to the same callback URL, so
 * an event is only this business's when BOTH the phone number id and the WABA it
 * arrived on match. These tests are the proof that a mismatch is dropped rather than
 * delivered to whoever happens to hold the number id.
 *
 * The last group covers the second half of that rule: SHIFT runs two Meta apps, each on
 * its own endpoint with its own secret, and neither may act on the other's numbers.
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
const { persistInbound, processInboundMessage } = require('../src/services/messageProcessor');

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

// ---------------------------------------------------------------------------
// Which endpoint the event arrived on
// ---------------------------------------------------------------------------

const { embeddedSignupAppId } = require('../src/utils/metaSecrets');

const SHIFT_APP = embeddedSignupAppId();
const KARAMBOT_APP = '1495884938739328';
const OTHER_OLD_APP = '780691577862636'; // a real one: an older app still owning a hand-wired number

// The predicates the endpoints really pass, lifted from the route modules rather than
// restated here: a copy that drifted from production would leave these tests green.
const routerArgs = (mod) => {
  jest.resetModules();
  const calls = [];
  jest.doMock('../src/routes/whatsapp', () => ({ createWebhookRouter: (opts) => { calls.push(opts); return {}; } }));
  require(mod);
  jest.dontMock('../src/routes/whatsapp');
  expect(calls).toHaveLength(1);
  return calls[0];
};
const shiftRoute = routerArgs('../src/routes/shiftWhatsapp');
const legacyRoute = routerArgs('../src/routes/legacyWhatsapp');
const shiftEndpoint = { servesApp: shiftRoute.servesApp, endpoint: shiftRoute.label };
const legacyEndpoint = { servesApp: legacyRoute.servesApp, endpoint: legacyRoute.label };

test('the endpoints under test are the real ones', () => {
  expect(shiftEndpoint.endpoint).toBe('shift');
  expect(legacyEndpoint.endpoint).toBe('karambot');
  expect(typeof shiftEndpoint.servesApp).toBe('function');
  expect(typeof legacyEndpoint.servesApp).toBe('function');
  // The two must disagree about the Tech Provider app and agree about everything else.
  expect(shiftEndpoint.servesApp(SHIFT_APP)).toBe(true);
  expect(legacyEndpoint.servesApp(SHIFT_APP)).toBe(false);
  expect(shiftEndpoint.servesApp(KARAMBOT_APP)).toBe(false);
  expect(legacyEndpoint.servesApp(KARAMBOT_APP)).toBe(true);
  expect(legacyEndpoint.servesApp(OTHER_OLD_APP)).toBe(true);
});

// Lets a delivery through to the DB so an accepted case is distinguishable from a dropped one.
function allowWrite() {
  prisma.message.findUnique.mockResolvedValue(null); // not a Meta retry
  prisma.$transaction.mockImplementation(async (fn) => fn({
    message: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'm1' }) },
    conversation: { update: jest.fn().mockResolvedValue({ id: 'conv_1' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  }));
  prisma.conversation.findFirst.mockResolvedValue({ id: 'conv_1', customer_wa_id: '962790000000', profile_name: 'Customer' });
}

const arrives = (at, wa_app_id) => {
  prisma.business.findFirst.mockResolvedValue({ ...ACME, wa_app_id });
  return persistInbound(entry('WABA_ACME', 'PHONE_SHARED'), at);
};

test('an Embedded Signup customer is accepted on the Tech Provider endpoint', async () => {
  allowWrite();
  const out = await arrives(shiftEndpoint, SHIFT_APP);
  expect(out.business?.id).toBe('biz_acme');
});

test('an Embedded Signup customer is NOT reachable from the legacy endpoint', async () => {
  // The shape a leaked legacy secret would exploit: a correctly signed delivery to the old
  // endpoint, naming a customer who belongs to the Tech Provider app.
  const out = await arrives(legacyEndpoint, SHIFT_APP);
  expect(out.business).toBeNull();
  expect(out.items).toEqual([]);
  expect(prisma.$transaction).not.toHaveBeenCalled(); // nothing reached their inbox
});

test('a hand-wired number is NOT reachable from the Tech Provider endpoint', async () => {
  const out = await arrives(shiftEndpoint, KARAMBOT_APP);
  expect(out.business).toBeNull();
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

test('a hand-wired number on an older app still works on the legacy endpoint', async () => {
  // The legacy side is not one app: pinning it to the Karambot id would have muted this number.
  allowWrite();
  const out = await arrives(legacyEndpoint, OTHER_OLD_APP);
  expect(out.business?.id).toBe('biz_acme');
});

test('a number with no owning app recorded is let through, as before', async () => {
  // Covers rows that predate the column and the window before completeOnboarding links
  // a new customer's business row.
  allowWrite();
  const out = await arrives(shiftEndpoint, null);
  expect(out.business?.id).toBe('biz_acme');
});

test('a caller that names no endpoint is not blocked (scripts, sweeps, tests)', async () => {
  prisma.business.findFirst.mockResolvedValue({ ...ACME, wa_app_id: SHIFT_APP });
  allowWrite();
  const out = await persistInbound(entry('WABA_ACME', 'PHONE_SHARED'));
  expect(out.business?.id).toBe('biz_acme');
});

// ---------------------------------------------------------------------------
// Delivery receipts are held to the same rules
// ---------------------------------------------------------------------------
//
// findStatusRow matches a wamid across the whole message table, so without an ownership
// check a receipt arriving on one endpoint could settle a send that belongs to the other.

const statusEntry = (wabaId, phoneNumberId) => ({
  id: wabaId,
  changes: [{
    field: 'messages',
    value: {
      metadata: { phone_number_id: phoneNumberId },
      statuses: [{ id: 'wamid.out1', status: 'delivered', recipient_id: '962790000000' }],
    },
  }],
});

test('a receipt for an Embedded Signup customer is refused on the legacy endpoint', async () => {
  prisma.business.findFirst.mockResolvedValue({ ...ACME, wa_app_id: SHIFT_APP });

  await processInboundMessage(statusEntry('WABA_ACME', 'PHONE_SHARED'), legacyEndpoint);

  // The row lookup never happened, so no message row could be settled.
  expect(prisma.message.findUnique).not.toHaveBeenCalled();
});

test('a receipt on the endpoint that owns the number is handled', async () => {
  prisma.business.findFirst.mockResolvedValue({ ...ACME, wa_app_id: SHIFT_APP });
  prisma.message.findUnique.mockResolvedValue(null); // matches no row; handleStatuses still looked

  await processInboundMessage(statusEntry('WABA_ACME', 'PHONE_SHARED'), shiftEndpoint);

  expect(prisma.message.findUnique).toHaveBeenCalledWith({ where: { meta_message_id: 'wamid.out1' } });
});

test('a receipt arriving on the wrong WABA is refused', async () => {
  prisma.business.findFirst.mockResolvedValue({ ...ACME, wa_app_id: null });

  await processInboundMessage(statusEntry('WABA_SOMEONE_ELSE', 'PHONE_SHARED'), legacyEndpoint);

  expect(prisma.message.findUnique).not.toHaveBeenCalled();
});

test('a receipt for a number that matches no business behaves as before', async () => {
  // Not a mismatch, so nothing new refuses it: handleStatuses still gets its chance.
  prisma.business.findFirst.mockResolvedValue(null);
  prisma.message.findUnique.mockResolvedValue(null);

  await processInboundMessage(statusEntry('WABA_ACME', 'PHONE_UNKNOWN'), legacyEndpoint);

  expect(prisma.message.findUnique).toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// A delivery that names no number
// ---------------------------------------------------------------------------
//
// Prisma drops an undefined condition, so `where: { wa_phone_number_id: undefined }` is
// `where: {}` — it returns whichever business comes first. These two lock the behaviour
// that guards against: never route to that business, and never let it decide a receipt.

const noNumber = (payload) => ({
  id: 'WABA_ACME',
  changes: [{ field: 'messages', value: { ...payload } }], // no metadata at all
});

test('a message with no phone_number_id is routed to nobody', async () => {
  // The dangerous shape: findFirst would return a business even though nothing was asked for.
  prisma.business.findFirst.mockResolvedValue(ACME);
  allowWrite();

  const out = await persistInbound(noNumber({
    contacts: [{ wa_id: '962790000000', profile: { name: 'Customer' } }],
    messages: [{ id: 'wamid.1', from: '962790000000', type: 'text', text: { body: 'مرحبا' } }],
  }), legacyEndpoint);

  expect(out.business).toBeNull();
  expect(prisma.business.findFirst).not.toHaveBeenCalled(); // never even asked
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

test('a receipt with no phone_number_id is handled, not judged by an unrelated business', async () => {
  // Refusing here would drop an authentic receipt, so the check stands aside instead.
  prisma.business.findFirst.mockResolvedValue({ ...ACME, wa_app_id: SHIFT_APP });
  prisma.message.findUnique.mockResolvedValue(null);

  await processInboundMessage(noNumber({
    statuses: [{ id: 'wamid.out1', status: 'delivered', recipient_id: '962790000000' }],
  }), legacyEndpoint);

  expect(prisma.business.findFirst).not.toHaveBeenCalled();
  expect(prisma.message.findUnique).toHaveBeenCalled(); // handleStatuses still ran
});

test('a receipt whose owner lookup fails is handled, and the failure is logged', async () => {
  // The lookup is a security check; if it breaks, that must be visible rather than silent.
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  prisma.business.findFirst.mockRejectedValue(new Error('db down'));
  prisma.message.findUnique.mockResolvedValue(null);

  await processInboundMessage(statusEntry('WABA_ACME', 'PHONE_SHARED'), legacyEndpoint);

  expect(prisma.message.findUnique).toHaveBeenCalled();
  expect(err).toHaveBeenCalledWith(expect.stringContaining('owner lookup failed'), 'db down');
  err.mockRestore();
});
