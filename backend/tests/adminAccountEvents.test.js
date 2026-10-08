/**
 * The real pause, and the account log written by the operator's existing actions.
 *
 * «تفعيل الذكاء الاصطناعي» used to be a checkbox inside the whole ai_config save: no reason, no
 * record, and a stale form could switch a paused bot back on. PATCH /accounts/:id/bot is the one
 * switch now. Every admin action that changes an account leaves an AccountEvent — and never a
 * secret in it: no activation link, no access token, no setting's value.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  user: { findUnique: jest.fn(), create: jest.fn(), findFirst: jest.fn() },
  business: { findUnique: jest.fn(), update: jest.fn() },
  subscription: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  payment: { create: jest.fn() },
  whatsappOnboarding: { findFirst: jest.fn(), update: jest.fn() },
  conversation: { aggregate: jest.fn(), count: jest.fn() },
  message: { aggregate: jest.fn() },
  businessKnowledge: { count: jest.fn() },
  adminAccessLog: { create: jest.fn() },
  accountEvent: { create: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../src/db/jsonb', () => ({ patchJson: jest.fn() }));
jest.mock('../src/services/activation', () => ({
  issue: jest.fn().mockResolvedValue({ token: 'SECRET-ACTIVATION-TOKEN', expires_in_hours: 168 }),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const jsonb = require('../src/db/jsonb');
const app = require('../src/app');

const ADMIN = { id: 'admin1', name: 'A', email: 'a@shifts-ai.com', role: 'platform_admin', business_id: null, active: true };
const OWNER = { id: 'owner1', name: 'O', email: 'o@shop.jo', role: 'business_owner', business_id: 'b1', active: true };
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: 'x' }, process.env.JWT_SECRET)}` });

const events = () => prisma.accountEvent.create.mock.calls.map(([a]) => a.data);
const lastEvent = () => events()[events().length - 1];

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockImplementation(({ where }) => Promise.resolve(where.email ? null : ADMIN));
  prisma.business.findUnique.mockResolvedValue({ id: 'b1', name: 'صيدلية الريان', ai_config: { greeting_message: 'أهلًا' } });
  prisma.accountEvent.create.mockImplementation(({ data }) => Promise.resolve({ id: 'ev1', ...data }));
  prisma.adminAccessLog.create.mockResolvedValue({ id: 'log1' });
  jsonb.patchJson.mockResolvedValue({ ok: true, count: 1 });
});

describe('PATCH /api/admin/accounts/:id/bot', () => {
  const patch = (body) => request(app).patch('/api/admin/accounts/b1/bot').set(auth()).send(body);

  test('pausing needs a reason, and nothing changes without one', async () => {
    const res = await patch({ enabled: false });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('اكتب سبب إيقاف البوت');
    expect(jsonb.patchJson).not.toHaveBeenCalled();
    expect(prisma.accountEvent.create).not.toHaveBeenCalled();
  });

  test('enabled must be a real boolean', async () => {
    expect((await patch({ enabled: 'false', reason: 'x' })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
  });

  test('a pause sets only ai_config.enabled, in Postgres, and records bot_paused with the reason', async () => {
    const res = await patch({ enabled: false, reason: 'تأخر الدفع' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, changed: true });
    expect(jsonb.patchJson).toHaveBeenCalledWith('businesses', 'b1', 'ai_config', { enabled: false });
    expect(lastEvent()).toMatchObject({
      business_id: 'b1', actor_user_id: 'admin1', actor_kind: 'shift', type: 'bot_paused', data: { reason: 'تأخر الدفع' },
    });
  });

  test('resuming records bot_resumed; a reason is optional', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 'b1', ai_config: { enabled: false } });
    const res = await patch({ enabled: true });
    expect(res.status).toBe(200);
    expect(jsonb.patchJson).toHaveBeenCalledWith('businesses', 'b1', 'ai_config', { enabled: true });
    expect(lastEvent()).toMatchObject({ type: 'bot_resumed', data: {} });
  });

  test('pausing a paused bot changes nothing and logs nothing', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 'b1', ai_config: { enabled: false } });
    const res = await patch({ enabled: false, reason: 'مرة ثانية' });
    expect(res.body).toEqual({ enabled: false, changed: false });
    expect(jsonb.patchJson).not.toHaveBeenCalled();
    expect(prisma.accountEvent.create).not.toHaveBeenCalled();
  });

  test('an unknown account is a 404', async () => {
    prisma.business.findUnique.mockResolvedValue(null);
    expect((await patch({ enabled: false, reason: 'x' })).status).toBe(404);
  });

  test('a shop owner cannot reach it', async () => {
    prisma.user.findUnique.mockResolvedValue(OWNER);
    expect((await patch({ enabled: false, reason: 'x' })).status).toBe(403);
    expect(jsonb.patchJson).not.toHaveBeenCalled();
  });

  test('a log write that fails does not undo the pause', async () => {
    prisma.accountEvent.create.mockRejectedValue(new Error('db down'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await patch({ enabled: false, reason: 'صيانة' });
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(jsonb.patchJson).toHaveBeenCalled();
  });
});

describe('the account page reads the same input as the overview', () => {
  test('agent state from Conversation.last_outbound_at, the pause and the shared payment wording', async () => {
    const { PAYMENT_NOTICES } = require('../src/config/metaNotices');
    prisma.business.findUnique.mockResolvedValue({
      id: 'b1', name: 'x', business_type: 'restaurant', status: 'active', wa_phone_number_id: 'P',
      wa_access_token: 'enc', ai_config: { enabled: false }, created_at: new Date(), updated_at: new Date(),
    });
    prisma.whatsappOnboarding.findFirst.mockResolvedValue({ id: 'o1', step: 'done', payment_method_ok: false, payment_method_claimed_at: null });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.conversation.aggregate.mockResolvedValue({ _max: { last_inbound_at: new Date(), last_outbound_at: new Date() } });
    prisma.conversation.count.mockResolvedValue(3);
    prisma.businessKnowledge.count.mockResolvedValue(0);

    const res = await request(app).get('/api/admin/accounts/b1').set(auth());
    expect(res.status).toBe(200);
    expect(prisma.message.aggregate).not.toHaveBeenCalled();
    expect(prisma.conversation.aggregate.mock.calls[0][0]._max).toEqual({ last_inbound_at: true, last_outbound_at: true });
    expect(res.body.account.agent).toMatchObject({ state: 'paused', label: 'موقوف مؤقتًا' });
    expect(res.body.account.bot_enabled).toBe(false);
    expect(res.body.onboarding.payment_notice).toEqual({
      state: 'missing', short: PAYMENT_NOTICES.missing.staff.short, long: PAYMENT_NOTICES.missing.staff.long,
      whatsapp_manager_url: expect.stringMatching(/^https:\/\/business\.facebook\.com\//),
    });
  });
});

describe('events from the existing admin actions', () => {
  test('creating a login records user_added — never the activation link', async () => {
    prisma.user.create.mockResolvedValue({ id: 'u9', name: 'أبو خالد', email: 'k@shop.jo', role: 'business_owner' });
    const res = await request(app).post('/api/admin/accounts/b1/users').set(auth())
      .send({ name: 'أبو خالد', email: 'k@shop.jo' });
    expect(res.status).toBe(201);
    expect(lastEvent()).toMatchObject({ business_id: 'b1', actor_kind: 'shift', type: 'user_added', data: { user_id: 'u9', role: 'business_owner' } });
    expect(JSON.stringify(events())).not.toContain('SECRET-ACTIVATION-TOKEN');
  });

  test('reissuing a link records invite_created, reissued', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u9', role: 'business_owner', active: false, last_login: null });
    const res = await request(app).post('/api/admin/accounts/b1/users/u9/invite').set(auth());
    expect(res.status).toBe(200);
    expect(lastEvent()).toMatchObject({ type: 'invite_created', data: { user_id: 'u9', reissued: true } });
    expect(JSON.stringify(events())).not.toContain('SECRET-ACTIVATION-TOKEN');
  });

  test('creating and updating a contract are both logged, the update with the changed fields', async () => {
    prisma.subscription.create.mockImplementation(({ data }) => Promise.resolve({ id: 's1', ...data, payments: [] }));
    await request(app).post('/api/admin/accounts/b1/subscriptions').set(auth())
      .send({ solution: 'karam_bot', amount_jod: 19.99 });
    expect(lastEvent()).toMatchObject({ type: 'contract_created', data: { subscription_id: 's1', solution: 'karam_bot', amount_jod: 19.99 } });

    prisma.subscription.findFirst.mockResolvedValue({ id: 's1' });
    prisma.subscription.update.mockResolvedValue({ id: 's1', status: 'paused', amount_jod: 19.99, payments: [] });
    await request(app).patch('/api/admin/accounts/b1/subscriptions/s1').set(auth()).send({ status: 'paused', notes: 'سافر' });
    expect(lastEvent()).toMatchObject({ type: 'contract_updated', data: { subscription_id: 's1', changed: ['status', 'notes'], status: 'paused' } });
  });

  test('a payment is logged after it commits', async () => {
    const sub = { id: 's1', business_id: 'b1', status: 'active', billing_cycle: 'monthly', next_due_at: new Date('2026-11-01'), amount_jod: 19.99 };
    prisma.subscription.findFirst.mockResolvedValue(sub);
    const order = [];
    const tx = {
      payment: { create: jest.fn(() => { order.push('payment'); return Promise.resolve({}); }) },
      subscription: { update: jest.fn().mockResolvedValue({ ...sub, payments: [] }) },
    };
    prisma.$transaction.mockImplementation(async (fn) => { const out = await fn(tx); order.push('commit'); return out; });
    prisma.accountEvent.create.mockImplementation(({ data }) => { order.push('event'); return Promise.resolve(data); });

    const res = await request(app).post('/api/admin/accounts/b1/subscriptions/s1/payments').set(auth())
      .send({ amount_jod: 19.99, method: 'cliq', reference: 'CLQ-1' });
    expect(res.status).toBe(201);
    expect(order).toEqual(['payment', 'commit', 'event']);
    expect(lastEvent()).toMatchObject({ type: 'payment_recorded', data: { subscription_id: 's1', amount_jod: 19.99, method: 'cliq', reference: 'CLQ-1' } });
  });

  test('confirming and removing the payment method at Meta are both logged', async () => {
    prisma.whatsappOnboarding.findFirst.mockResolvedValue({ id: 'o1' });
    prisma.whatsappOnboarding.update.mockResolvedValue({ payment_method_ok: true });
    await request(app).patch('/api/admin/accounts/b1/payment-method').set(auth()).send({ payment_method_ok: true });
    expect(lastEvent()).toMatchObject({ type: 'payment_confirmed', business_id: 'b1' });
    await request(app).patch('/api/admin/accounts/b1/payment-method').set(auth()).send({ payment_method_ok: false });
    expect(lastEvent()).toMatchObject({ type: 'payment_confirmation_removed' });
  });

  test('a settings save records which keys changed and none of their values', async () => {
    prisma.business.update.mockResolvedValue({ id: 'b1' });
    const res = await request(app).patch('/api/businesses/b1').set(auth()).send({
      name: 'صيدلية الريان الجديدة',
      ai_config: { greeting_message: 'مرحبا بكم', alert_wa_numbers: ['0796381676'] },
      policies: { delivery_fee: 1.5 },
    });
    expect(res.status).toBe(200);
    const ev = lastEvent();
    expect(ev).toMatchObject({ type: 'settings_changed', actor_kind: 'shift', business_id: 'b1' });
    expect(ev.data).toEqual({ keys: ['name'], ai_config_keys: ['greeting_message', 'alert_wa_numbers'], policies_keys: ['delivery_fee'] });
    expect(JSON.stringify(ev)).not.toMatch(/مرحبا|0796381676|962796381676|الجديدة/);
  });

  test("an owner's own save is logged as the owner", async () => {
    prisma.user.findUnique.mockResolvedValue(OWNER);
    const res = await request(app).patch('/api/businesses/b1').set(auth()).send({ ai_config: { greeting_message: 'هلا' } });
    expect(res.status).toBe(200);
    expect(lastEvent()).toMatchObject({ type: 'settings_changed', actor_kind: 'owner', actor_user_id: 'owner1', data: { ai_config_keys: ['greeting_message'] } });
  });

  test('a token set by hand is logged without the token', async () => {
    prisma.business.update.mockResolvedValue({ id: 'b1' });
    const res = await request(app).patch('/api/businesses/b1/token').set(auth()).send({ wa_access_token: 'EAAGsecretsecretsecretsecretsecret123' });
    expect(res.status).toBe(200);
    expect(lastEvent()).toMatchObject({ type: 'token_set', actor_kind: 'shift', business_id: 'b1' });
    expect(JSON.stringify(events())).not.toContain('EAAG');
  });
});
