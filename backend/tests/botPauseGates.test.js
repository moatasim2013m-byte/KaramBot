/**
 * botPauseGates.test.js — P0 «أساس آمن ونظيف» in the message path (docs/panels/spec.md).
 *
 *  - Inbox and alerts are kept for paused and suspended shops at all four gates: persistInbound stores
 *    a message whatever Business.status is, processInboundMessage and reprocessStuckInbound alert staff
 *    for every status but a closed account, and only an active shop's bot answers.
 *  - «أوقف البوت مؤقتًا» is real: ai_config.enabled === false sends nothing, reads no media and asks no
 *    AI; the conversation joins the inbox's attention list instead. Unset still answers, as it always has.
 *  - Conversation.last_outbound_at is stamped wherever an outbound row is saved, and never moves back.
 *
 * Real messageProcessor, replyBatcher, newMessageAlert and generic workflow over the in-memory fakeDb.
 * WhatsApp, the AI provider, the media reader, the SHIFT workflow and the alert sender are mocked, so
 * nothing reaches the network.
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
const shift = require('../src/workflows/shift');
const provider = require('../src/ai/provider');
const media = require('../src/workflows/shift/media');
const sseEmitter = require('../src/utils/sseEmitter');
const newMessageAlert = require('../src/services/newMessageAlert');
const batcher = require('../src/services/replyBatcher');
const { markOutbound } = require('../src/services/lastOutbound');
const { persistInbound, processInboundMessage, reprocessStuckInbound } = require('../src/services/messageProcessor');

const CUSTOMER = '962791111111';
const OWNER = '962796381676';
const PNID = 'pnid_gates';
const MIN = 60 * 1000;
// The 24 h service window reads the real clock, so the fake one starts from it (newMessageAlert.test.js).
const T0 = new Date();
let seq = 0;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function seedShop({ ai_config = {}, ...fields } = {}) {
  const [biz] = db.seed({
    businesses: [{
      id: 'biz_shop', name: 'صيدلية النور', business_type: 'generic', status: 'active', wa_phone_number_id: PNID,
      // No colons → tokenCrypto.decrypt returns it as-is.
      wa_access_token: 'plain_test_token', ai_config: { alert_wa_numbers: [OWNER], ...ai_config }, ...fields,
    }],
    businessKnowledge: [{ business_id: 'biz_shop', kind: 'fact', content: 'عندنا بنادول', active: true }],
  }).businesses;
  return biz;
}

function entry(waMsg) {
  seq += 1;
  return {
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: PNID },
        contacts: [{ wa_id: CUSTOMER, profile: { name: 'محمد' } }],
        messages: [{ id: `wamid.g${seq}`, from: CUSTOMER, timestamp: '1', type: 'text', ...waMsg }],
      },
    }],
  };
}

const text = (body) => ({ type: 'text', text: { body } });

// Both phases, as the webhook route runs them; then let the fire-and-forget alert finish.
async function deliver(waMsg) {
  const e = entry(waMsg);
  const persisted = await persistInbound(e);
  await processInboundMessage(e, { persisted });
  await alertsSettled();
  return persisted;
}

const notifySpy = () => newMessageAlert.notifyNewMessages;
async function alertsSettled() {
  await Promise.all(notifySpy().mock.results.map((r) => r.value));
}

const inboundRows = () => db.store.messages.filter((m) => m.direction === 'inbound');
const outboundRows = () => db.store.messages.filter((m) => m.direction === 'outbound');
const conversation = () => db.store.conversations.find((c) => c.customer_wa_id === CUSTOMER);
const alertReasons = () => alerts.sendStaffAlert.mock.calls.map(([a]) => a.reason);
const newMessageEvents = () => sseEmitter.emit.mock.calls.filter(([, ev]) => ev && ev.type === 'new_message');

beforeEach(() => {
  db.reset();
  db.clock.set(T0);
  jest.clearAllMocks();
  seq = 0;
  delete process.env.SHIFT_BOT_LIVE;
  delete process.env.SHIFT_TEST_NUMBERS;
  whatsapp.sendText.mockReset().mockImplementation(async () => {
    seq += 1;
    return { ok: true, id: `wamid.sent${seq}`, error: null, reason: null, code: null, httpStatus: 200, retryable: false };
  });
  whatsapp.sendInteractiveButtons.mockReset().mockImplementation(async () => ({ ok: true, id: `wamid.btn${++seq}` }));
  whatsapp.sendStructured.mockReset().mockImplementation(async () => ({ ok: true, id: `wamid.st${++seq}` }));
  whatsapp.sendTextMessage.mockReset().mockResolvedValue({ messages: [{ id: 'wamid.reply' }] });
  whatsapp.markAsRead.mockReset().mockResolvedValue(true);
  alerts.sendStaffAlert.mockReset().mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
  shift.processShiftBatch.mockReset().mockImplementation(async () => ({
    kind: 'reply', action: 'NONE', messages: [{ type: 'text', text: 'أهلين!' }], stateUpdate: {}, workflowDataPatch: {},
  }));
  provider.generateValidatedAIReply.mockReset().mockResolvedValue({ reply: 'أكيد، البنادول متوفر.', action: 'NONE' });
  media.mediaEnabled.mockReturnValue(true);
  media.readForTenant.mockReset().mockResolvedValue({ type: 'image', status: 'ok', text: 'علبة بنادول', at: 'x', ms: 1 });
  jest.spyOn(newMessageAlert, 'notifyNewMessages');
  jest.spyOn(sseEmitter, 'emit');
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  batcher.cancelAll();
  jest.restoreAllMocks();
});

// ─── Suspended and inactive shops: inbox and alerts kept, no bot ─────────────

describe('a shop that is not active still gets its messages and alerts', () => {
  test('suspended: the message is stored, counted, alerted and pushed to the inbox, but never answered', async () => {
    seedShop({ status: 'suspended' });

    const { items } = await deliver(text('عندكم بنادول؟'));

    expect(items).toHaveLength(1);
    expect(inboundRows()).toHaveLength(1);
    // Stored already settled: no sweep has anything to re-run.
    expect(inboundRows()[0]).toMatchObject({ text_body: 'عندكم بنادول؟', status: 'delivered' });
    expect(conversation()).toMatchObject({ unread_count: 1, profile_name: 'محمد' });
    expect(conversation().last_inbound_at).toEqual(T0);

    expect(alertReasons()).toEqual(['new_message']);
    expect(newMessageEvents()).toHaveLength(1);

    expect(provider.generateValidatedAIReply).not.toHaveBeenCalled();
    expect(whatsapp.sendTextMessage).not.toHaveBeenCalled();
    expect(whatsapp.markAsRead).not.toHaveBeenCalled();
    expect(outboundRows()).toHaveLength(0);
  });

  test('switched back on later, the messages it received while suspended are not answered by a sweep', async () => {
    seedShop({ status: 'suspended' });
    await deliver(text('مرحبا'));
    db.store.businesses[0].status = 'active';

    await reprocessStuckInbound({ olderThanMs: 0, now: new Date(T0.getTime() + 10 * MIN) });

    expect(provider.generateValidatedAIReply).not.toHaveBeenCalled();
    expect(outboundRows()).toHaveLength(0);
    expect(inboundRows()[0].status).toBe('delivered');
  });

  test('inactive is treated the same; only a closed account is stored without an alert', async () => {
    seedShop({ status: 'inactive' });
    await deliver(text('مرحبا'));
    expect(inboundRows()).toHaveLength(1);
    expect(alertReasons()).toEqual(['new_message']);

    db.reset();
    db.clock.set(T0);
    alerts.sendStaffAlert.mockClear();
    seedShop({ status: 'closed' });
    await deliver(text('مرحبا'));
    expect(inboundRows()).toHaveLength(1);
    expect(alerts.sendStaffAlert).not.toHaveBeenCalled();
    expect(provider.generateValidatedAIReply).not.toHaveBeenCalled();
  });

  test('an external-mode shop that is suspended is stored and alerted, and nothing is forwarded', async () => {
    const axios = require('axios');
    seedShop({ status: 'suspended', ai_config: { reply_mode: 'external', forward_url: 'https://hook.example.test/fwd' } });
    await deliver(text('hi'));
    expect(inboundRows()[0].status).toBe('delivered');
    expect(alertReasons()).toEqual(['new_message']);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('a suspended SHIFT business: stored `skipped`, alerted, and never queued for the batcher', async () => {
    seedShop({ business_type: 'shift', status: 'suspended' });
    await deliver(text('كم سعر البوت؟'));

    expect(inboundRows()[0].status).toBe('skipped');
    expect(alertReasons()).toEqual(['new_message']);
    expect(conversation().metadata.batch_due_at).toBeUndefined();
    expect(batcher.hasPendingTimer(conversation().id)).toBe(false);
    expect(shift.processShiftBatch).not.toHaveBeenCalled();
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });

  test('reprocessStuckInbound: a stuck row of a shop suspended since is alerted and closed, not answered', async () => {
    const biz = seedShop({ status: 'suspended' });
    const [conv] = db.seed({ conversations: [{ business_id: biz.id, customer_wa_id: CUSTOMER, last_inbound_at: T0 }] }).conversations;
    const [stuck] = db.seed({
      messages: [{
        business_id: biz.id, conversation_id: conv.id, direction: 'inbound', status: 'processing', message_type: 'text',
        text_body: 'وينكم؟', sender_wa_id: CUSTOMER, meta_message_id: 'wamid.stuck', created_at: new Date(T0.getTime() - 3 * MIN),
        raw_payload: { id: 'wamid.stuck', from: CUSTOMER, type: 'text', text: { body: 'وينكم؟' } },
      }],
    }).messages;

    const report = await reprocessStuckInbound({ now: T0 });
    await alertsSettled();

    expect(report.reprocessed).toBe(1);
    expect(db.store.messages.find((m) => m.id === stuck.id).status).toBe('delivered');
    expect(alertReasons()).toEqual(['new_message']);
    expect(provider.generateValidatedAIReply).not.toHaveBeenCalled();
    expect(outboundRows()).toHaveLength(0);
  });

  test('reprocessStuckInbound: an active shop\'s row whose delivery died before its alert is alerted and answered', async () => {
    seedShop();
    await persistInbound(entry(text('مرحبا'))); // stored, then the instance died: no alert, no reply
    expect(alerts.sendStaffAlert).not.toHaveBeenCalled();

    await reprocessStuckInbound({ now: new Date(T0.getTime() + 3 * MIN) });
    await alertsSettled();

    expect(alertReasons()).toEqual(['new_message']);
    expect(provider.generateValidatedAIReply).toHaveBeenCalledTimes(1);
    expect(inboundRows()[0].status).toBe('delivered');
  });

  test('reprocessStuckInbound of an active shop alerts once: the original delivery\'s alert is not repeated', async () => {
    seedShop();
    const e = entry(text('مرحبا'));
    await persistInbound(e); // delivered, then its instance died before processing
    const row = inboundRows()[0];
    // That delivery did reach its alert before dying.
    await newMessageAlert.notifyNewMessages(db.store.businesses[0], [{
      waMsg: e.changes[0].value.messages[0], customerWaId: CUSTOMER, conversation: conversation(), message: row, claimed: true,
    }]);
    expect(alertReasons()).toEqual(['new_message']);

    await reprocessStuckInbound({ now: new Date(T0.getTime() + 3 * MIN) });
    await alertsSettled();

    expect(alertReasons()).toEqual(['new_message']);
    expect(provider.generateValidatedAIReply).toHaveBeenCalledTimes(1);
    expect(db.store.messages.find((m) => m.id === row.id).status).toBe('delivered');
  });
});

// ─── «أوقف البوت مؤقتًا»: ai_config.enabled === false ─────────────────────────

describe('a paused bot (ai_config.enabled false)', () => {
  test('a text is stored, alerted and flagged for staff; nothing is sent and no AI is asked', async () => {
    seedShop({ ai_config: { enabled: false } });

    await deliver(text('عندكم بنادول؟'));

    expect(inboundRows()).toHaveLength(1);
    expect(inboundRows()[0].status).toBe('delivered');
    expect(conversation()).toMatchObject({ needs_attention: true, attention_reason: 'bot_paused' });
    expect(conversation().attention_at).toEqual(inboundRows()[0].created_at);
    expect(alertReasons()).toEqual(['new_message']);
    expect(newMessageEvents().length).toBeGreaterThanOrEqual(1);

    expect(provider.generateValidatedAIReply).not.toHaveBeenCalled();
    expect(whatsapp.sendTextMessage).not.toHaveBeenCalled();
    expect(outboundRows()).toHaveLength(0);
  });

  test('a photo is not read and the «send it as text» reply is not sent either', async () => {
    seedShop({ ai_config: { enabled: false } });

    await deliver({ type: 'image', image: { id: 'media1', mime_type: 'image/jpeg', caption: 'عندكم هاد؟' } });

    expect(media.readForTenant).not.toHaveBeenCalled();
    expect(provider.generateValidatedAIReply).not.toHaveBeenCalled();
    expect(whatsapp.sendTextMessage).not.toHaveBeenCalled();
    expect(conversation()).toMatchObject({ needs_attention: true, attention_reason: 'bot_paused' });
  });

  test('a burst is one wait aged from its first message; after staff answer, the next message is a new wait', async () => {
    seedShop({ ai_config: { enabled: false } });

    await deliver(text('مرحبا'));
    db.clock.advance(MIN);
    await deliver(text('في حدا؟'));
    expect(conversation().attention_at).toEqual(T0);

    // Staff answered from the inbox, then the customer wrote again.
    await markOutbound(conversation().id, new Date(T0.getTime() + 2 * MIN));
    db.clock.set(new Date(T0.getTime() + 3 * MIN));
    await deliver(text('طيب شكرا، وكم السعر؟'));

    expect(conversation()).toMatchObject({ needs_attention: true, attention_reason: 'bot_paused' });
    expect(conversation().attention_at).toEqual(new Date(T0.getTime() + 3 * MIN));
    expect(provider.generateValidatedAIReply).not.toHaveBeenCalled();
  });

  test('a reaction does not put the conversation in front of staff', async () => {
    seedShop({ ai_config: { enabled: false } });
    await deliver({ type: 'reaction', reaction: { message_id: 'wamid.x', emoji: '👍' } });
    expect(inboundRows()).toHaveLength(1);
    expect(conversation().needs_attention).toBe(false);
  });

  test('a conversation staff already took over is not flagged again', async () => {
    const biz = seedShop({ ai_config: { enabled: false } });
    db.seed({ conversations: [{ business_id: biz.id, customer_wa_id: CUSTOMER, status: 'human_takeover', ai_enabled: false }] });
    await deliver(text('مرحبا'));
    expect(conversation().needs_attention).toBe(false);
    expect(provider.generateValidatedAIReply).not.toHaveBeenCalled();
  });

  test('unset or true still answers, exactly as before; the reply stamps last_outbound_at', async () => {
    for (const aiConfig of [{}, { enabled: true }]) {
      db.reset();
      db.clock.set(T0);
      provider.generateValidatedAIReply.mockClear();
      whatsapp.sendTextMessage.mockClear();
      seedShop({ ai_config: aiConfig });

      await deliver(text('عندكم بنادول؟'));

      expect(provider.generateValidatedAIReply).toHaveBeenCalledTimes(1);
      expect(whatsapp.sendTextMessage).toHaveBeenCalledWith(PNID, 'plain_test_token', CUSTOMER, 'أكيد، البنادول متوفر.');
      expect(outboundRows()).toHaveLength(1);
      expect(conversation().needs_attention).toBe(false);
      expect(conversation().last_outbound_at).toEqual(outboundRows()[0].created_at);
    }
  });

  test('the media-not-supported reply of an active bot stamps last_outbound_at too', async () => {
    seedShop();
    media.mediaEnabled.mockReturnValue(false);
    await deliver({ type: 'document', document: { id: 'doc1', mime_type: 'application/pdf' } });
    expect(whatsapp.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(conversation().last_outbound_at).toEqual(outboundRows()[0].created_at);
  });
});

// ─── SHIFT's own sales bot ───────────────────────────────────────────────────

describe('SHIFT business', () => {
  test('its usual config (no enabled flag) is unaffected: queued for the batcher with a read receipt', async () => {
    seedShop({ business_type: 'shift', ai_config: { alert_wa_numbers: [OWNER] } });

    await deliver(text('مرحبا، كم سعر البوت؟'));

    expect(inboundRows()[0].status).toBe('received');
    expect(typeof conversation().metadata.batch_due_at).toBe('string');
    expect(batcher.hasPendingTimer(conversation().id)).toBe(true);
    expect(whatsapp.markAsRead).toHaveBeenCalledTimes(1);
    expect(conversation().needs_attention).toBe(false);
    expect(alertReasons()).toEqual(['new_message']);
  });

  test('a bot reply sent through the batcher stamps last_outbound_at', async () => {
    const biz = seedShop({ business_type: 'shift' });
    const [conv] = db.seed({ conversations: [{ business_id: biz.id, customer_wa_id: CUSTOMER, last_inbound_at: new Date() }] }).conversations;
    db.seed({
      messages: [{
        business_id: biz.id, conversation_id: conv.id, direction: 'inbound', status: 'received', message_type: 'text',
        text_body: 'كم السعر؟', meta_message_id: 'wamid.q1', sender_wa_id: CUSTOMER, created_at: new Date(Date.now() - 5000),
      }],
    });
    const before = Date.now();

    expect((await batcher.runBatch(conv.id)).outcome).toBe('sent');

    expect(shift.processShiftBatch).toHaveBeenCalledTimes(1);
    const stamped = db.store.conversations.find((c) => c.id === conv.id).last_outbound_at;
    expect(stamped).toBeInstanceOf(Date);
    expect(stamped.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test('paused: stored `skipped`, flagged for the team, and the batcher never answers it', async () => {
    seedShop({ business_type: 'shift', ai_config: { enabled: false } });

    await deliver(text('مرحبا'));

    expect(inboundRows()[0].status).toBe('skipped');
    expect(conversation()).toMatchObject({ needs_attention: true, attention_reason: 'bot_paused' });
    expect(batcher.hasPendingTimer(conversation().id)).toBe(false);
    expect(await batcher.runBatch(conversation().id)).toMatchObject({ sent: 0 });
    expect(shift.processShiftBatch).not.toHaveBeenCalled();
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });

  test('isShiftReplyAllowed: only an explicit enabled:false pauses', () => {
    expect(batcher.isShiftReplyAllowed({ ai_config: {} }, CUSTOMER, {})).toBe(true);
    expect(batcher.isShiftReplyAllowed({ ai_config: { enabled: true } }, CUSTOMER, {})).toBe(true);
    expect(batcher.isShiftReplyAllowed({ ai_config: { enabled: null } }, CUSTOMER, {})).toBe(true);
    expect(batcher.isShiftReplyAllowed({ ai_config: { enabled: false } }, CUSTOMER, {})).toBe(false);
    expect(batcher.isShiftReplyAllowed({ ai_config: { enabled: false, test_numbers: [CUSTOMER] } }, CUSTOMER, { SHIFT_BOT_LIVE: '0' })).toBe(false);
  });
});

// ─── last_outbound_at ────────────────────────────────────────────────────────

describe('markOutbound', () => {
  function seedConversation(fields = {}) {
    const biz = seedShop();
    return db.seed({ conversations: [{ business_id: biz.id, customer_wa_id: CUSTOMER, ...fields }] }).conversations[0];
  }

  test('sets the time, moves forward, and never moves back (sends can commit out of order)', async () => {
    const conv = seedConversation();
    const t1 = new Date(T0.getTime() + MIN);

    expect(await markOutbound(conv.id, t1)).toBe(true);
    expect(conversation().last_outbound_at).toEqual(t1);

    expect(await markOutbound(conv.id, T0)).toBe(false);
    expect(conversation().last_outbound_at).toEqual(t1);

    const t2 = new Date(T0.getTime() + 2 * MIN);
    expect(await markOutbound(conv.id, t2.toISOString())).toBe(true);
    expect(conversation().last_outbound_at).toEqual(t2);
  });

  test('no time (or an unreadable one) means now; no conversation is a no-op', async () => {
    const conv = seedConversation();
    const before = Date.now();
    expect(await markOutbound(conv.id)).toBe(true);
    expect(conversation().last_outbound_at.getTime()).toBeGreaterThanOrEqual(before);
    expect(await markOutbound(null, T0)).toBe(false);
  });

  test('a database error is logged and swallowed: the message has already been sent', async () => {
    const conv = seedConversation();
    db.failNext('conversation.updateMany', new Error('db down'));
    await expect(markOutbound(conv.id, T0)).resolves.toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[last_outbound] not stamped'));
  });

  test('a staff alert stored in the staff member\'s own thread stamps that thread', async () => {
    const realAlerts = jest.requireActual('../src/services/alerts');
    const biz = seedShop();
    const [staffConv] = db.seed({ conversations: [{ business_id: biz.id, customer_wa_id: OWNER, last_inbound_at: new Date() }] }).conversations;
    whatsapp.sendText.mockResolvedValue({ ok: true, id: 'wamid.alert' });

    await realAlerts.sendStaffAlert({
      reason: 'handoff', business: db.store.businesses[0], conversation: { id: 'c_x', customer_wa_id: CUSTOMER, profile_name: 'محمد' }, summary: 'بدو موظف',
    });

    const stored = outboundRows().find((m) => m.conversation_id === staffConv.id);
    expect(stored).toBeTruthy();
    expect(db.store.conversations.find((c) => c.id === staffConv.id).last_outbound_at).toEqual(stored.created_at);
  });
});
