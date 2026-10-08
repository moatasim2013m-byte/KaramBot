/**
 * costGuardGate.test.js — the cost guard in the tenant message path (docs/panels/spec.md P1;
 * decisions 6 and 7), and the two send refusals that only SHIFT can act on (131042, 190).
 *
 *  - Under its limits a shop's bot answers exactly as before.
 *  - A free-month shop at its cap reads nothing and asks no AI: the conversation joins the staff's
 *    attention list as 'bot_limit', and the customer gets one holding reply a day, which does not
 *    count against the cap. ai_config.limit_message replaces the default wording.
 *  - A paying shop over its cap keeps answering. SHIFT's own number never meets the guard.
 *  - A tenant send refused with 131042 marks the onboarding row payment-blocked and tells SHIFT;
 *    one refused with 190 revokes it as token_invalid.
 *
 * Real messageProcessor, generic workflow, costGuard and tokenHealth over the in-memory fakeDb;
 * WhatsApp, the AI provider, the media reader and the alert senders are mocked.
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
  partSummary: jest.fn(() => ''),
  sendTextMessage: jest.fn(),
  markAsRead: jest.fn(),
  normalizePhone: jest.fn((p) => (p ? String(p).replace(/\D/g, '') : p)),
}));
jest.mock('../src/services/alerts', () => ({
  ...jest.requireActual('../src/services/alerts'),
  sendStaffAlert: jest.fn(),
  notifyShift: jest.fn(),
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
const shift = require('../src/workflows/shift');
const provider = require('../src/ai/provider');
const media = require('../src/workflows/shift/media');
const batcher = require('../src/services/replyBatcher');
const costGuard = require('../src/services/costGuard');
const platformSettings = require('../src/services/platformSettings');
const { persistInbound, processInboundMessage } = require('../src/services/messageProcessor');

const CUSTOMER = '962791111111';
const OWNER = '962796381676';
const PNID = 'pnid_guard';
const T0 = new Date();
let seq = 0;

function seedShop({ ai_config = {}, contract = { status: 'trial', ai_replies_month: 3 }, usedThisMonth = 0, ...fields } = {}) {
  const [biz] = db.seed({
    businesses: [{
      id: 'biz_shop', name: 'صيدلية النور', business_type: 'generic', status: 'active', wa_phone_number_id: PNID,
      wa_access_token: 'plain_test_token', ai_config: { alert_wa_numbers: [OWNER], ...ai_config }, ...fields,
    }],
    businessKnowledge: [{ business_id: 'biz_shop', kind: 'fact', content: 'عندنا بنادول', active: true }],
  }).businesses;
  if (contract) {
    db.seed({
      subscriptions: [{
        business_id: biz.id, solution: 'karam_bot', amount_jod: 19.99, billing_cycle: 'monthly', starts_at: T0, created_by: 'system', ...contract,
      }],
    });
  }
  if (usedThisMonth) {
    const [c] = db.seed({ conversations: [{ business_id: biz.id, customer_wa_id: '962700000000' }] }).conversations;
    db.seed({
      messages: Array.from({ length: usedThisMonth }, () => ({
        business_id: biz.id, conversation_id: c.id, direction: 'outbound', is_ai_generated: true, status: 'sent', created_at: T0,
      })),
    });
  }
  return biz;
}

function seedOnboarding() {
  db.seed({ whatsappOnboardings: [{ business_id: 'biz_shop', app_id: 'app', meta_business_id: 'mb', waba_id: 'W1', phone_number_id: PNID, step: 'done' }] });
}

function entry(waMsg, from = CUSTOMER) {
  seq += 1;
  return {
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: PNID },
        contacts: [{ wa_id: from, profile: { name: 'محمد' } }],
        messages: [{ id: `wamid.cg${seq}`, from, timestamp: '1', type: 'text', ...waMsg }],
      },
    }],
  };
}

const text = (body) => ({ type: 'text', text: { body } });

async function deliver(waMsg, from) {
  const e = entry(waMsg, from);
  const persisted = await persistInbound(e);
  await processInboundMessage(e, { persisted });
  return persisted;
}

const conversation = (wa = CUSTOMER) => db.store.conversations.find((c) => c.customer_wa_id === wa);
const outboundTo = (wa = CUSTOMER) => {
  const c = conversation(wa);
  return db.store.messages.filter((m) => m.direction === 'outbound' && c && m.conversation_id === c.id);
};
const graphError = (code) => Object.assign(new Error('Request failed'), { response: { status: 400, data: { error: { code, message: 'refused' } } } });

beforeEach(() => {
  db.reset();
  db.clock.set(T0);
  jest.clearAllMocks();
  seq = 0;
  costGuard.clearCache();
  platformSettings.clearCache();
  whatsapp.sendTextMessage.mockReset().mockResolvedValue({ messages: [{ id: 'wamid.reply' }] });
  whatsapp.markAsRead.mockReset().mockResolvedValue(true);
  alerts.sendStaffAlert.mockReset().mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
  alerts.notifyShift.mockReset().mockResolvedValue(null);
  shift.processShiftBatch.mockReset().mockResolvedValue({
    kind: 'reply', action: 'NONE', messages: [{ type: 'text', text: 'أهلين!' }], stateUpdate: {}, workflowDataPatch: {},
  });
  provider.generateValidatedAIReply.mockReset().mockResolvedValue({ reply: 'أكيد، البنادول متوفر.', action: 'NONE' });
  media.mediaEnabled.mockReturnValue(true);
  media.readForTenant.mockReset().mockResolvedValue({ type: 'image', status: 'ok', text: 'علبة بنادول', at: 'x', ms: 1 });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  batcher.cancelAll();
  jest.restoreAllMocks();
});

describe('under its limits', () => {
  test('a free-month shop answers as before, and the reply counts', async () => {
    seedShop({ usedThisMonth: 1 });
    await deliver(text('عندكم بنادول؟'));

    expect(provider.generateValidatedAIReply).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendTextMessage).toHaveBeenCalledWith(PNID, 'plain_test_token', CUSTOMER, 'أكيد، البنادول متوفر.');
    expect(outboundTo()).toHaveLength(1);
    expect(outboundTo()[0].is_ai_generated).toBe(true);
    expect(conversation().needs_attention).toBe(false);
  });
});

describe('a free-month shop at its cap', () => {
  test('no AI, flagged bot_limit, one holding reply that does not count against the cap', async () => {
    seedShop({ usedThisMonth: 3 });
    await deliver(text('عندكم بنادول؟'));

    expect(provider.generateValidatedAIReply).not.toHaveBeenCalled();
    expect(conversation()).toMatchObject({ needs_attention: true, attention_reason: 'bot_limit' });
    expect(whatsapp.sendTextMessage).toHaveBeenCalledTimes(1);
    const [, , to, body] = whatsapp.sendTextMessage.mock.calls[0];
    expect(to).toBe(CUSTOMER);
    expect(body).toMatch(/سيرد عليك أحد الموظفين/);
    expect(outboundTo()).toHaveLength(1);
    expect(outboundTo()[0]).toMatchObject({ is_ai_generated: false, text_body: body });
    // Not an answer: the customer still reads as waiting.
    expect(conversation().last_outbound_at).toBeNull();
    expect(await costGuard.monthlyAiReplies('biz_shop')).toBe(3);
  });

  test('at most one holding reply per conversation per day', async () => {
    seedShop({ usedThisMonth: 3 });
    await deliver(text('مرحبا'));
    await deliver(text('في حدا؟'));
    await deliver(text('؟؟'));
    expect(whatsapp.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(provider.generateValidatedAIReply).not.toHaveBeenCalled();

    // The next Amman day, one more.
    db.store.conversations.find((c) => c.customer_wa_id === CUSTOMER).metadata.bot_limit_notice_day = '2000-01-01';
    await deliver(text('صباح الخير'));
    expect(whatsapp.sendTextMessage).toHaveBeenCalledTimes(2);
  });

  test('ai_config.limit_message replaces the default wording', async () => {
    seedShop({ usedThisMonth: 3, ai_config: { limit_message: 'أهلًا، سيتواصل معك فريق الصيدلية قريبًا.' } });
    await deliver(text('مرحبا'));
    expect(whatsapp.sendTextMessage.mock.calls[0][3]).toBe('أهلًا، سيتواصل معك فريق الصيدلية قريبًا.');
  });

  test('a voice note is not read', async () => {
    seedShop({ usedThisMonth: 3 });
    await deliver({ type: 'audio', audio: { id: 'media1', mime_type: 'audio/ogg' } });
    expect(media.readForTenant).not.toHaveBeenCalled();
    expect(provider.generateValidatedAIReply).not.toHaveBeenCalled();
    expect(conversation().attention_reason).toBe('bot_limit');
  });

  test('a staff number writing in gets no holding reply and joins no list', async () => {
    seedShop({ usedThisMonth: 3 });
    await deliver(text('تمام'), OWNER);
    expect(whatsapp.sendTextMessage).not.toHaveBeenCalled();
    expect(conversation(OWNER).needs_attention).toBe(false);
  });
});

describe('the daily media cap', () => {
  test('past it, a free-month shop holds the photo for staff; text is still answered', async () => {
    seedShop({ usedThisMonth: 0 });
    db.seed({ platformSettings: [{ key: 'ai_limits', value: { media_day_default: 1 } }] });
    platformSettings.clearCache();

    await deliver({ type: 'image', image: { id: 'img1', mime_type: 'image/jpeg' } });
    expect(media.readForTenant).toHaveBeenCalledTimes(1);
    costGuard.clearCache();
    await deliver({ type: 'image', image: { id: 'img2', mime_type: 'image/jpeg' } });
    expect(media.readForTenant).toHaveBeenCalledTimes(1);
    expect(conversation().attention_reason).toBe('bot_limit');

    await deliver(text('عندكم بنادول؟'));
    expect(provider.generateValidatedAIReply).toHaveBeenCalledTimes(2);
  });
});

describe('who the guard never stops', () => {
  test('a paying shop over its cap keeps answering, and SHIFT is told', async () => {
    seedShop({ usedThisMonth: 5, contract: { status: 'active', ai_replies_month: 3 } });
    await deliver(text('عندكم بنادول؟'));
    expect(provider.generateValidatedAIReply).toHaveBeenCalledTimes(1);
    expect(conversation().needs_attention).toBe(false);
    expect(db.store.accountEvents.map((e) => e.type)).toEqual(expect.arrayContaining(['cap_reached', 'cap_80']));
    expect(alerts.notifyShift).toHaveBeenCalledWith(expect.objectContaining({ reason: 'cap_reached' }));
  });

  test('SHIFT\'s own number never meets the guard', async () => {
    const allow = jest.spyOn(costGuard, 'allow');
    seedShop({ business_type: 'shift', usedThisMonth: 50 });
    await deliver(text('كم سعر البوت؟'));
    expect(allow).not.toHaveBeenCalled();
    expect(conversation().needs_attention).toBe(false);
  });

  test('a guard that cannot read its counts lets the bot answer', async () => {
    seedShop({ usedThisMonth: 3 });
    jest.spyOn(db.prisma.message, 'count').mockRejectedValue(new Error('db down'));
    await deliver(text('مرحبا'));
    expect(provider.generateValidatedAIReply).toHaveBeenCalledTimes(1);
  });
});

describe('send refusals only SHIFT can act on', () => {
  test('131042 on a reply: payment_blocked_at, AccountEvent payment_blocked, SHIFT told once', async () => {
    seedShop();
    seedOnboarding();
    whatsapp.sendTextMessage.mockRejectedValue(graphError(131042));
    await deliver(text('مرحبا'));
    await deliver(text('في حدا؟'));

    expect(db.store.whatsappOnboardings[0].payment_blocked_at).toBeInstanceOf(Date);
    expect(db.store.accountEvents.filter((e) => e.type === 'payment_blocked')).toHaveLength(1);
    expect(alerts.notifyShift.mock.calls.filter(([a]) => a.reason === 'payment_blocked')).toHaveLength(1);
  });

  test('190 on a reply: the onboarding row is revoked as token_invalid', async () => {
    seedShop();
    seedOnboarding();
    whatsapp.sendTextMessage.mockRejectedValue(graphError(190));
    await deliver(text('مرحبا'));

    expect(db.store.whatsappOnboardings[0]).toMatchObject({ revoked_reason: 'token_invalid' });
    expect(db.store.whatsappOnboardings[0].revoked_at).toBeInstanceOf(Date);
    expect(db.store.accountEvents.filter((e) => e.type === 'token_invalid')).toHaveLength(1);
    expect(alerts.notifyShift).toHaveBeenCalledWith(expect.objectContaining({ reason: 'partner_removed' }));
  });

  test('any other refusal changes nothing', async () => {
    seedShop();
    seedOnboarding();
    whatsapp.sendTextMessage.mockRejectedValue(graphError(131026));
    await deliver(text('مرحبا'));
    expect(db.store.whatsappOnboardings[0]).toMatchObject({ payment_blocked_at: null, revoked_at: null });
    expect(alerts.notifyShift).not.toHaveBeenCalled();
  });
});
