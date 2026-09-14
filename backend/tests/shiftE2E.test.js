/**
 * shiftE2E.test.js — PR1 end to end through the real express app.
 *
 * Signed webhook → routes/whatsapp (persist before 200) → messageProcessor → replyBatcher (quiet
 * window on jest fake timers) → workflows/shift → ai/provider → services/whatsapp → axios.
 * Only the edges are fake: the DB is the in-memory fakeDb, Gemini is a mocked SDK and axios is a
 * jest mock, so nothing reaches the network. Everything in between is the production code.
 */

require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');

const mockGenerateContent = jest.fn();
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({ generateContent: mockGenerateContent }),
  })),
}));

const crypto = require('crypto');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const db = require('./helpers/fakeDb').getFakeDb();
const app = require('../src/app');
const batcher = require('../src/services/replyBatcher');
const acks = require('../src/workflows/shift/acks');
const { encrypt } = require('../src/utils/tokenCrypto');

const SHIFT_PNID = 'pnid_shift';
const EXTERNAL_PNID = 'pnid_external';
const FORWARD_URL = 'https://hook.example.test/forward';
const CUSTOMER = '962790000001';
// Monday 10:00 in Amman: inside the default team hours, so slot offers exist.
const START = new Date('2026-09-14T07:00:00.000Z');

let wamidSeq = 0;
let outSeq = 0;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sign(raw) {
  return 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(Buffer.from(raw)).digest('hex');
}

function inboundPayload({ pnid = SHIFT_PNID, from = CUSTOMER, text, id }) {
  wamidSeq += 1;
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba_1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: pnid },
          contacts: [{ wa_id: from, profile: { name: 'زبون' } }],
          messages: [{
            id: id || `wamid.in${wamidSeq}`,
            from,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: text },
          }],
        },
      }],
    }],
  };
}

function postWebhook(payload, target = app) {
  const raw = JSON.stringify(payload);
  return request(target)
    .post('/api/whatsapp/webhook')
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', sign(raw))
    .send(raw);
}

// setImmediate is left real, so this drains the post-response work (fakeDb calls are all promise-based).
async function settle(rounds = 30) {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

async function advance(ms) {
  await jest.advanceTimersByTimeAsync(ms);
  await settle();
}

function modelReply(obj) {
  return { response: { text: () => JSON.stringify(obj), usageMetadata: {}, candidates: [{ finishReason: 'STOP' }] } };
}

// Customer-facing Graph sends (read receipts and forwards excluded).
function sends() {
  return axios.post.mock.calls
    .filter(([url, payload]) => /\/messages$/.test(url) && payload && ['text', 'interactive'].includes(payload.type))
    .map(([, payload]) => payload);
}

function sendText(payload) {
  return payload.type === 'text' ? payload.text.body : payload.interactive.body.text;
}

function conversationOf(customer = CUSTOMER) {
  return db.store.conversations.find((c) => c.customer_wa_id === customer);
}

function inboundRows(customer = CUSTOMER) {
  const conv = conversationOf(customer);
  return conv ? db.store.messages.filter((m) => m.conversation_id === conv.id && m.direction === 'inbound') : [];
}

function botRows(customer = CUSTOMER) {
  const conv = conversationOf(customer);
  return conv ? db.store.messages.filter((m) => m.conversation_id === conv.id && m.direction === 'outbound' && m.is_ai_generated) : [];
}

function seedShiftBusiness(aiConfig = {}) {
  return db.seed({
    businesses: [{
      name: 'SHIFT', business_type: 'shift', status: 'active', wa_phone_number_id: SHIFT_PNID,
      wa_access_token: encrypt('shift_token'), ai_config: aiConfig,
    }],
  }).businesses[0];
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(START);
  db.reset();
  wamidSeq = 0;
  outSeq = 0;
  delete process.env.SHIFT_BOT_LIVE;
  delete process.env.SHIFT_TEST_NUMBERS;
  delete process.env.STAFF_ALERT_WEBHOOK_URL;
  delete process.env.WEBHOOK_PERSIST_BUDGET_MS;

  axios.post.mockReset();
  axios.post.mockImplementation(async (url) => {
    if (url === FORWARD_URL) return { status: 200, data: {} };
    outSeq += 1;
    return { status: 200, data: { messages: [{ id: `wamid.out${outSeq}` }] } };
  });
  mockGenerateContent.mockReset();
  mockGenerateContent.mockResolvedValue(modelReply({
    reply: 'أهلين فيك! شو نوع منشأتك؟', action: 'NONE', stage: 'discovery',
  }));

  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  batcher.cancelAll();
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete process.env.SHIFT_BOT_LIVE;
  delete process.env.SHIFT_TEST_NUMBERS;
});

// ─── Scenarios ───────────────────────────────────────────────────────────────

describe('SHIFT bot end to end', () => {
  test('(a) three texts 1 s apart → one AI call with all three, one outbound send', async () => {
    seedShiftBusiness();
    const lines = ['مرحبا', 'عندي كافيه', 'بإربد'];

    for (let i = 0; i < lines.length; i++) {
      const res = await postWebhook(inboundPayload({ text: lines[i] }));
      expect(res.status).toBe(200);
      await settle();
      if (i < lines.length - 1) await advance(1000);
    }

    // Every row is saved as `received` and nothing has been answered inside the quiet window.
    expect(inboundRows().map((m) => m.status)).toEqual(['received', 'received', 'received']);
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(sends()).toHaveLength(0);

    await advance(4000); // the last short fragment's 4 s window

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const request1 = mockGenerateContent.mock.calls[0][0];
    const userText = request1.contents[0].parts[0].text;
    for (const line of lines) expect(userText).toContain(line);

    expect(sends()).toHaveLength(1);
    expect(sendText(sends()[0])).toBe('أهلين فيك! شو نوع منشأتك؟');
    expect(inboundRows().map((m) => m.status)).toEqual(['answered', 'answered', 'answered']);
    expect(botRows()).toHaveLength(1);
    expect(botRows()[0].status).toBe('sent');
    expect(batcher.hasPendingTimer(conversationOf().id)).toBe(false);
  });

  test('(b) a duplicate webhook retry → no second reply', async () => {
    seedShiftBusiness();
    const payload = inboundPayload({ text: 'كم سعر الخدمة؟' });

    expect((await postWebhook(payload)).status).toBe(200);
    await settle();
    await advance(5000);
    expect(sends()).toHaveLength(1);

    // Meta retries the same wamid (e.g. our 200 was lost).
    expect((await postWebhook(payload)).status).toBe(200);
    await settle();
    await advance(15000);

    expect(inboundRows()).toHaveLength(1);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(sends()).toHaveLength(1);
    expect(botRows()).toHaveLength(1);
  });

  test('(c) «بدي أحكي مع إنسان» → handoff ack, pending, AI stays on, next question still answered', async () => {
    seedShiftBusiness();

    await postWebhook(inboundPayload({ text: 'بدي أحكي مع إنسان' }));
    await settle();
    await advance(5000);

    // Tier-1 handoff is deterministic: no model call.
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(sends()).toHaveLength(1);
    expect(sendText(sends()[0]).startsWith(acks.handoffLead('ar'))).toBe(true);

    let conv = conversationOf();
    expect(conv.status).toBe('pending');
    expect(conv.current_state).toBe('handoff');
    expect(conv.ai_enabled).toBe(true);
    expect(conv.workflow_data.handoff.requested_at).toBeTruthy();
    expect(conv.workflow_data.needs_team.reason).toBe('person');

    mockGenerateContent.mockResolvedValue(modelReply({ reply: 'الباقات بتبدأ من 25 دينار بالشهر.', action: 'NONE' }));
    await advance(60000);
    await postWebhook(inboundPayload({ text: 'طيب كم الأسعار عندكم؟' }));
    await settle();
    await advance(5000);

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(sends()).toHaveLength(2);
    expect(sendText(sends()[1])).toBe('الباقات بتبدأ من 25 دينار بالشهر.');
    conv = conversationOf();
    expect(conv.ai_enabled).toBe(true);
    expect(inboundRows().every((m) => m.status === 'answered')).toBe(true);
  });

  test('(d) AI rejects twice → exactly one fallback, pending, needs_team.ai_failure', async () => {
    seedShiftBusiness();
    mockGenerateContent
      .mockRejectedValueOnce(new Error('503 overloaded'))
      .mockRejectedValueOnce(new Error('503 overloaded'));

    await postWebhook(inboundPayload({ text: 'شو بتقدموا للمطاعم؟' }));
    await settle();
    await advance(5000);

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(sends()).toHaveLength(1);
    expect(sendText(sends()[0])).toBe(acks.aiFailure('ar', { withButtons: sends()[0].type === 'interactive' }));
    expect(botRows()).toHaveLength(1);
    expect(botRows()[0].raw_payload.kind).toBe('fallback');

    const conv = conversationOf();
    expect(conv.status).toBe('pending');
    expect(conv.workflow_data.needs_team.reason).toBe('ai_failure');
    expect(conv.ai_enabled).toBe(true);
    expect(inboundRows()[0].status).toBe('answered');

    // No retry storm afterwards.
    await advance(30000);
    expect(sends()).toHaveLength(1);
  });

  test('(e) staff send from the Inbox, then a customer message within 30 min → no AI reply, awaiting_staff', async () => {
    const biz = seedShiftBusiness();
    const [user] = db.seed({ users: [{ name: 'رنا', role: 'business_admin', business_id: biz.id }] }).users;
    const [conv] = db.seed({
      conversations: [{ business_id: biz.id, customer_wa_id: CUSTOMER, last_inbound_at: START, last_message_at: START }],
    }).conversations;
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);

    const sent = await request(app)
      .post(`/api/inbox/conversations/${conv.id}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'أهلين، معك رنا من فريق شِفت' });
    expect(sent.status).toBe(200);
    expect(sends()).toHaveLength(1);
    expect(conversationOf().metadata.human_active_until).toBeTruthy();

    await advance(10 * 60 * 1000);
    await postWebhook(inboundPayload({ text: 'تمام، كم السعر؟' }));
    await settle();
    await advance(5000);

    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(sends()).toHaveLength(1);
    expect(inboundRows().map((m) => m.status)).toEqual(['awaiting_staff']);
    expect(botRows()).toHaveLength(0);
  });

  test('(f) persist failure → webhook 500, nothing saved or sent; the retry is saved', async () => {
    seedShiftBusiness();
    db.failNext('conversation.findFirst', Object.assign(new Error('db down'), { code: 'P1001' }));
    const payload = inboundPayload({ text: 'مرحبا' });

    const res = await postWebhook(payload);
    expect(res.status).toBe(500);
    await settle();
    await advance(15000);
    expect(db.store.messages).toHaveLength(0);
    expect(sends()).toHaveLength(0);

    const retry = await postWebhook(payload);
    expect(retry.status).toBe(200);
    expect(inboundRows()).toHaveLength(1);
  });

  test('(g) external-mode tenant → inbound saved before 200, forwarded after, no send', async () => {
    db.seed({
      businesses: [{
        name: 'My Restaurant', business_type: 'restaurant', status: 'active', wa_phone_number_id: EXTERNAL_PNID,
        wa_access_token: encrypt('ext_token'), ai_config: { reply_mode: 'external', forward_url: FORWARD_URL },
      }],
    });
    const events = [];
    // Record the moment the HTTP response is written, and what the DB held at that moment.
    const target = (req, res) => {
      const end = res.end;
      res.end = function patchedEnd(...args) {
        events.push({ event: 'response', saved: db.store.messages.length });
        return end.apply(this, args);
      };
      app(req, res);
    };
    axios.post.mockImplementation(async (url) => {
      events.push({ event: url === FORWARD_URL ? 'forward' : 'graph' });
      return { status: 200, data: {} };
    });

    const payload = inboundPayload({ pnid: EXTERNAL_PNID, text: 'بدي أطلب بيتزا' });
    const res = await postWebhook(payload, target);
    expect(res.status).toBe(200);
    await settle();
    await advance(15000);

    expect(events).toEqual([{ event: 'response', saved: 1 }, { event: 'forward' }]);
    expect(axios.post).toHaveBeenCalledWith(FORWARD_URL, payload.entry[0].changes[0].value, { timeout: 10000 });
    expect(db.store.messages[0].status).toBe('delivered');
    expect(sends()).toHaveLength(0);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  test('(h) SHIFT_BOT_LIVE=0 → a normal number is saved without a reply; a test number is answered', async () => {
    process.env.SHIFT_BOT_LIVE = '0';
    process.env.SHIFT_TEST_NUMBERS = '962796381676';
    seedShiftBusiness();
    const TESTER = '962796381676';

    await postWebhook(inboundPayload({ from: CUSTOMER, text: 'مرحبا' }));
    await postWebhook(inboundPayload({ from: TESTER, text: 'مرحبا' }));
    await settle();
    await advance(5000);

    expect(inboundRows(CUSTOMER).map((m) => m.status)).toEqual(['skipped']);
    expect(botRows(CUSTOMER)).toHaveLength(0);

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(sends()).toHaveLength(1);
    expect(sends()[0].to).toBe(TESTER);
    expect(inboundRows(TESTER).map((m) => m.status)).toEqual(['answered']);
  });
});
