/**
 * The owner's checklist once the join link exists (docs/panels/spec.md P2): «ربط واتساب» becomes
 * the owner's own step with a button only when PlatformSetting es_owner_enabled is on (until then it
 * truthfully stays SHIFT's), and «أضفت البطاقة» (POST /api/whatsapp/status/payment-method-claim)
 * records the owner's statement once, for their own business only.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  user: { findUnique: jest.fn() },
  business: { findUnique: jest.fn() },
  whatsappOnboarding: { findFirst: jest.fn(), updateMany: jest.fn() },
  conversation: { aggregate: jest.fn() },
  message: { aggregate: jest.fn() },
  subscription: { findFirst: jest.fn() },
  menuItem: { count: jest.fn() },
  service: { count: jest.fn() },
  businessKnowledge: { count: jest.fn() },
  platformSetting: { findMany: jest.fn() },
  accountEvent: { create: jest.fn() },
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const platformSettings = require('../src/services/platformSettings');
const { paymentNotice } = require('../src/config/metaNotices');
const app = require('../src/app');

const OWNER = { id: 'u1', name: 'O', email: null, phone: '962791234567', role: 'business_owner', business_id: 'b1', active: true };
const MANAGER = { ...OWNER, id: 'u2', role: 'manager' };
let signedIn = OWNER;
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: signedIn.id }, process.env.JWT_SECRET)}` });

function setup({ hasNumber = true, onboarding = null, esOwner = false } = {}) {
  platformSettings.clearCache();
  prisma.platformSetting.findMany.mockResolvedValue(esOwner ? [{ key: 'es_owner_enabled', value: true }] : []);
  prisma.user.findUnique.mockImplementation(async () => signedIn);
  prisma.business.findUnique.mockResolvedValue({
    id: 'b1', name: 'صيدلية', status: 'active', business_type: 'generic',
    wa_phone_number_id: hasNumber ? 'PN' : null, wa_business_account_id: hasNumber ? 'W' : null, wa_access_token: hasNumber ? 'enc' : null, ai_config: {},
  });
  prisma.whatsappOnboarding.findFirst.mockResolvedValue(onboarding);
  prisma.whatsappOnboarding.updateMany.mockResolvedValue({ count: 1 });
  prisma.conversation.aggregate.mockResolvedValue({ _max: { last_inbound_at: null, last_outbound_at: null } });
  prisma.message.aggregate.mockResolvedValue({ _max: { created_at: null } });
  prisma.subscription.findFirst.mockResolvedValue(null);
  prisma.businessKnowledge.count.mockResolvedValue(0);
  prisma.accountEvent.create.mockImplementation(async ({ data }) => ({ id: 'e1', ...data }));
}

beforeEach(() => {
  jest.clearAllMocks();
  signedIn = OWNER;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('the connect step', () => {
  test('while owners cannot connect yet, it stays SHIFT\'s, with no button', async () => {
    setup({ hasNumber: false });
    const res = await request(app).get('/api/whatsapp/status').set(auth());
    const step = res.body.setup.steps.find((s) => s.key === 'connected');
    expect(step).toMatchObject({ owner: 'shift', done: false });
    expect(step.action).toBeUndefined();
    expect(res.body.explain.action).not.toBe('connect');
  });

  test('with es_owner_enabled it is the owner\'s next step, with «اربط واتساب»', async () => {
    setup({ hasNumber: false, esOwner: true });
    const res = await request(app).get('/api/whatsapp/status').set(auth());
    const step = res.body.setup.steps.find((s) => s.key === 'connected');
    expect(step).toMatchObject({ owner: 'you', action: 'connect', done: false });
    expect(res.body.setup.next.key).toBe('connected');
    expect(res.body.explain).toMatchObject({ action: 'connect', title: 'واتساب غير مربوط بعد' });
  });

  test('a failed settings read keeps the safe answer: SHIFT connects', async () => {
    setup({ hasNumber: false });
    prisma.platformSetting.findMany.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/whatsapp/status').set(auth());
    expect(res.body.setup.steps.find((s) => s.key === 'connected').owner).toBe('shift');
  });
});

describe('«أضفت البطاقة»', () => {
  test('the claim is stored once, logged as the owner, and the checklist moves on to the next step', async () => {
    setup({ onboarding: { id: 'onb1', step: 'done', payment_method_ok: false, payment_method_claimed_at: null } });
    const res = await request(app).post('/api/whatsapp/status/payment-method-claim').set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ payment_method_ok: false, notice: paymentNotice('claimed', 'owner', 'short') });
    const update = prisma.whatsappOnboarding.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'onb1', payment_method_claimed_at: null });
    expect(update.data.payment_method_claimed_at).toBeInstanceOf(Date);
    expect(prisma.accountEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      business_id: 'b1', actor_user_id: 'u1', actor_kind: 'owner', type: 'payment_claimed',
    }) });
    // Scoped to the caller's own business, whatever was sent.
    expect(prisma.whatsappOnboarding.findFirst.mock.calls[0][0].where).toEqual({ business_id: 'b1' });

    // The checklist: claimed is enough to continue (decision 9), shown as waiting for SHIFT.
    prisma.whatsappOnboarding.findFirst.mockResolvedValue({ step: 'done', payment_method_ok: false, payment_method_claimed_at: new Date() });
    const status = await request(app).get('/api/whatsapp/status').set(auth());
    expect(status.body.setup.steps.find((s) => s.key === 'payment')).toMatchObject({ done: true, label: paymentNotice('claimed', 'owner', 'short') });
    expect(status.body.payment_method_claimed).toBe(true);
    expect(status.body.explain.title).toBe(paymentNotice('claimed', 'owner', 'short'));
  });

  test('pressing again keeps the first time and writes nothing new', async () => {
    const first = new Date('2026-10-09T10:00:00Z');
    setup({ onboarding: { id: 'onb1', step: 'done', payment_method_ok: false, payment_method_claimed_at: first } });
    const res = await request(app).post('/api/whatsapp/status/payment-method-claim').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.payment_method_claimed_at).toBe(first.toISOString());
    expect(prisma.whatsappOnboarding.updateMany).not.toHaveBeenCalled();
    expect(prisma.accountEvent.create).not.toHaveBeenCalled();
  });

  test('before WhatsApp is connected there is no card to claim', async () => {
    setup({ onboarding: null });
    const res = await request(app).post('/api/whatsapp/status/payment-method-claim').set(auth());
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('اربط واتساب أولًا');
  });

  test('only the owner says it', async () => {
    signedIn = MANAGER;
    setup({ onboarding: { id: 'onb1', step: 'done', payment_method_ok: false, payment_method_claimed_at: null } });
    const res = await request(app).post('/api/whatsapp/status/payment-method-claim').set(auth());
    expect(res.status).toBe(403);
    expect(prisma.whatsappOnboarding.updateMany).not.toHaveBeenCalled();
  });
});
