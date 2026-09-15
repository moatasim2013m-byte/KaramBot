/**
 * shiftE2E.test.js — PR1 and PR2 end to end through the real express app.
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
// The model parameters of every call (system instruction, response schema): the prompt path is observable.
const mockModelParams = [];
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: (params) => {
      mockModelParams.push(params);
      return { generateContent: mockGenerateContent };
    },
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
  mockModelParams.length = 0;
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

    // PR2 validators (G1): an invented price is never sent. The reply is regenerated once with a hint;
    // the same price again → the concierge stage line replaces the model's words, still one reply.
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(sends()).toHaveLength(2);
    expect(sendText(sends()[1])).toBe(require('../src/workflows/shift/validators').stageFallback('handoff', 'ar'));
    expect(sendText(sends()[1])).not.toContain('25');
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

  test('(i) a slot tap while the model is generating → confirmation first, no stale reply, captured state kept', async () => {
    const TUE_SLOT = 'slot:2026-09-15T10:00+03:00/12:00';
    const business = seedShiftBusiness();
    db.seed({
      conversations: [{
        business_id: business.id, customer_wa_id: CUSTOMER, status: 'open', ai_enabled: true, current_state: 'close',
        last_inbound_at: START, last_message_at: START,
        workflow_data: {
          lead: { name: 'أحمد', business_name: 'كافيه النخيل' },
          slot_offers: [{ id: TUE_SLOT, title: 'بكرا 10–12', issued_at: START.toISOString() }],
        },
      }],
    });

    // The first model call hangs until released; later calls answer from whatever state they are given.
    let release;
    mockGenerateContent
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValue(modelReply({ reply: 'الباقات حسب حجم المحل، والفريق بيوضحلك بالمكالمة.', action: 'NONE', stage: 'close' }));

    await postWebhook(inboundPayload({ text: 'طيب بس قديش السعر؟' }));
    await settle();
    await advance(5000); // quiet window passes, the batch starts generating
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);

    const tap = inboundPayload({ text: 'x' });
    tap.entry[0].changes[0].value.messages[0] = {
      ...tap.entry[0].changes[0].value.messages[0],
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: TUE_SLOT, title: 'بكرا 10–12' } },
    };
    delete tap.entry[0].changes[0].value.messages[0].text;
    await postWebhook(tap);
    await settle();
    // The running batch holds the conversation: the tap waits for it instead of racing it.
    expect(sends()).toHaveLength(0);

    release(modelReply({ reply: 'الباقات بتبدأ من 25 دينار بالشهر. أي وقت بناسبك نحكي؟', action: 'NONE', stage: 'close' }));
    await settle();
    await advance(100);

    const texts = sends().map(sendText);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain('سجّلت طلب مكالمة: أحمد، كافيه النخيل');
    expect(texts[1]).toBe('الباقات حسب حجم المحل، والفريق بيوضحلك بالمكالمة.');
    expect(texts.join('\n')).not.toContain('أي وقت بناسبك نحكي؟');
    const conv = conversationOf();
    expect(conv.current_state).toBe('captured');
    expect(conv.status).toBe('pending');
    expect(conv.workflow_data.lead.preferred_time.slot_id).toBe(TUE_SLOT);
    expect(inboundRows().map((m) => m.status)).toEqual(['answered', 'answered']);
  });

  test('(j) staff claim, reply, «إرجاع للبوت» → the customer\'s next message is answered by the bot', async () => {
    const biz = seedShiftBusiness();
    const [user] = db.seed({ users: [{ name: 'رنا', role: 'business_admin', business_id: biz.id }] }).users;
    const [conv] = db.seed({
      conversations: [{ business_id: biz.id, customer_wa_id: CUSTOMER, last_inbound_at: START, last_message_at: START }],
    }).conversations;
    const auth = `Bearer ${jwt.sign({ id: user.id }, process.env.JWT_SECRET)}`;

    expect((await request(app).post(`/api/inbox/conversations/${conv.id}/claim`).set('Authorization', auth)).status).toBe(200);
    expect((await request(app).post(`/api/inbox/conversations/${conv.id}/send`).set('Authorization', auth)
      .send({ text: 'أهلين، معك رنا' })).status).toBe(200);
    await advance(5 * 60 * 1000);
    expect((await request(app).post(`/api/inbox/conversations/${conv.id}/release`).set('Authorization', auth)).status).toBe(200);
    const staffSends = sends().length;

    await advance(5 * 60 * 1000); // still inside 30 min of the staff message
    await postWebhook(inboundPayload({ text: 'طيب كم السعر؟' }));
    await settle();
    await advance(5000);

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(sends()).toHaveLength(staffSends + 1);
    expect(inboundRows().map((m) => m.status)).toEqual(['answered']);
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

// ─── GPT-6 review decisions D17–D24, end to end ──────────────────────────────
//
// Same real app and fakes as above. The sweeper is run the way Cloud Scheduler runs it, once a minute
// (runSweep with the faked clock). An instance that "dies" is modelled by a promise that never settles
// (its code never continues, its lease simply expires) or, where only a throw can stop the code, a throw.

describe('reliability decisions end to end (D17–D24)', () => {
  const { runSweep } = require('../src/services/shiftSweeper');
  const sseEmitter = require('../src/utils/sseEmitter');
  const MIN = 60 * 1000;
  const QUESTION = 'كم السعر؟'; // ends in «؟»: a 1.5 s quiet window
  const REPLY = 'أهلين فيك! شو نوع منشأتك؟'; // the default model reply (beforeEach)
  const ALERT_URL = 'https://alerts.example.test/hook';

  const reports = [];
  async function sweep() {
    const report = await runSweep({ now: new Date() });
    reports.push(report);
    await advance(100); // timers the sweep armed at 0 ms (requeues, orphans) run now
    return report;
  }
  // One sweep a minute until `untilMs` after START.
  async function sweepEveryMinuteUntil(untilMs) {
    while (Date.now() + MIN <= START.getTime() + untilMs) {
      await advance(MIN);
      await sweep();
    }
  }
  const total = (key) => reports.reduce((n, r) => n + (r[key] || 0), 0);
  const replySends = () => sends().filter((p) => sendText(p) === REPLY);
  const graph502 = () => Object.assign(new Error('Request failed with status code 502'), {
    request: {}, response: { status: 502, data: '<html>Bad Gateway</html>' },
  });
  const statusWebhook = (status) => ({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba_1',
      changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: SHIFT_PNID }, statuses: [status] } }],
    }],
  });
  function seedStaffConversation() {
    const biz = seedShiftBusiness();
    const [user] = db.seed({ users: [{ name: 'رنا', role: 'business_admin', business_id: biz.id }] }).users;
    const [conv] = db.seed({
      conversations: [{ business_id: biz.id, customer_wa_id: CUSTOMER, last_inbound_at: START, last_message_at: START }],
    }).conversations;
    return { biz, conv, auth: `Bearer ${jwt.sign({ id: user.id }, process.env.JWT_SECRET)}` };
  }

  beforeEach(() => {
    reports.length = 0;
  });
  afterEach(() => {
    delete process.env.STAFF_ALERT_WEBHOOK_URL;
  });

  test('(i) crash after the intent row, before Graph → after 2 min the sweeper requeues once, exactly one reply', async () => {
    seedShiftBusiness();
    // The instance dies right before its pre-send check: the intent stays `sending`, the lease is never released.
    jest.spyOn(db.jsonb, 'preSendCheck').mockImplementationOnce(() => new Promise(() => {}));

    await postWebhook(inboundPayload({ text: QUESTION }));
    await settle();
    await advance(2000);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(sends()).toHaveLength(0);
    expect(botRows().map((m) => m.status)).toEqual(['sending']);

    await sweepEveryMinuteUntil(6 * MIN);

    expect(total('unconfirmed_requeued')).toBe(1);
    expect(total('unconfirmed_escalated')).toBe(0);
    expect(replySends()).toHaveLength(1);
    expect(sends()).toHaveLength(1);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2); // the requeued rows are generated again
    expect(inboundRows().map((m) => m.status)).toEqual(['answered']);
    const [dead, sent] = botRows();
    expect(dead).toMatchObject({ status: 'ambiguous_unreconciled', raw_payload: expect.objectContaining({ settled: 'requeued' }) });
    expect(sent.status).toBe('sent');
    // The send carried its own intent id for status correlation (D17).
    expect(sends()[0].biz_opaque_callback_data).toBe(sent.id);
  });

  test('(ii) Graph 502 → no immediate retry, nothing answered; the echoed status webhook later marks it answered', async () => {
    seedShiftBusiness();
    axios.post.mockImplementation(async (url, payload) => {
      if (payload && ['text', 'interactive'].includes(payload.type)) throw graph502();
      return { status: 200, data: {} };
    });

    await postWebhook(inboundPayload({ text: QUESTION }));
    await settle();
    await advance(2000);

    expect(sends()).toHaveLength(1); // GPT-6 #4: a 5xx is ambiguous, never POSTed again at once
    const [intent] = botRows();
    expect(intent).toMatchObject({ status: 'ambiguous', meta_message_id: null });
    expect(inboundRows().map((m) => m.status)).toEqual(['unconfirmed']);
    expect(sends()[0].biz_opaque_callback_data).toBe(intent.id);

    await advance(40 * 1000);
    const res = await postWebhook(statusWebhook({
      id: 'wamid.accepted', status: 'delivered', recipient_id: CUSTOMER,
      timestamp: String(Math.floor(Date.now() / 1000)), biz_opaque_callback_data: intent.id,
    }));
    expect(res.status).toBe(200);
    await settle();

    expect(botRows()[0]).toMatchObject({ status: 'delivered', meta_message_id: 'wamid.accepted' });
    expect(inboundRows().map((m) => m.status)).toEqual(['answered']);

    // Confirmed: the 2-minute rule has nothing to settle.
    await sweepEveryMinuteUntil(5 * MIN);
    expect(total('unconfirmed_requeued') + total('unconfirmed_escalated')).toBe(0);
    expect(sends()).toHaveLength(1);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  test('(iii) no echoed status within 2 min, twice → awaiting_staff + needs_team.unsent_reply, never a third send', async () => {
    process.env.STAFF_ALERT_WEBHOOK_URL = ALERT_URL;
    seedShiftBusiness();
    axios.post.mockImplementation(async (url, payload) => {
      if (payload && ['text', 'interactive'].includes(payload.type)) throw graph502();
      return { status: 200, data: {} };
    });

    await postWebhook(inboundPayload({ text: QUESTION }));
    await settle();
    await advance(2000);
    expect(replySends()).toHaveLength(1);

    // Before the awaiting-staff note (10 min) and the SLA note (15 team minutes) could add sends of their own.
    await sweepEveryMinuteUntil(9 * MIN);

    expect(total('unconfirmed_requeued')).toBe(1);
    expect(total('unconfirmed_escalated')).toBe(1);
    expect(replySends()).toHaveLength(2);
    expect(sends()).toHaveLength(2);
    expect(inboundRows().map((m) => m.status)).toEqual(['awaiting_staff']);
    const conv = conversationOf();
    expect(conv.status).toBe('pending');
    expect(conv.ai_enabled).toBe(true);
    expect(conv.workflow_data.needs_team).toMatchObject({ reason: 'unsent_reply', resolved_at: null });
    const alertsSent = axios.post.mock.calls.filter(([url]) => url === ALERT_URL).map(([, body]) => body.reason);
    expect(alertsSent.filter((r) => r === 'unsent_reply')).toHaveLength(1);
    // The pause step does not hand escalated rows back to the bot.
    expect(total('pause_requeued')).toBe(0);
  });

  test('(iv) staff claim while the model generates → the bot\'s reply is never sent', async () => {
    const { conv, auth } = seedStaffConversation();
    let release;
    mockGenerateContent.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));

    await postWebhook(inboundPayload({ text: QUESTION }));
    await settle();
    await advance(2000);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);

    const claim = await request(app).post(`/api/inbox/conversations/${conv.id}/claim`).set('Authorization', auth);
    expect(claim.status).toBe(200);
    expect(claim.body.ack).toBe('sent');

    release(modelReply({ reply: 'الباقات بتبدأ من 25 دينار.', action: 'NONE' }));
    await settle();
    await advance(5000);

    const texts = sends().map(sendText);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toBe(acks.claimAck({ staffName: 'رنا', lang: 'ar' }));
    expect(texts).not.toContain('الباقات بتبدأ من 25 دينار.');
    expect(inboundRows().map((m) => m.status)).toEqual(['awaiting_staff']);
    // The claim ack is the staff member's own intent row, confirmed by its wamid.
    const [ack] = db.store.messages.filter((m) => m.direction === 'outbound');
    expect(ack).toMatchObject({ status: 'sent', is_ai_generated: false, raw_payload: expect.objectContaining({ kind: 'claim_ack' }) });
    expect(ack.sent_by_user_id).toBeTruthy();
  });

  test('(iv-b) a claim committed after the bot\'s last human check but before Graph → the pre-send check stops it (D20/D21)', async () => {
    const { conv, auth } = seedStaffConversation();
    const realPreSendCheck = db.jsonb.preSendCheck;
    jest.spyOn(db.jsonb, 'preSendCheck').mockImplementationOnce(async (...args) => {
      // Staff click «استلام» in the gap between the bot's state write and its Graph call.
      const claim = await request(app).post(`/api/inbox/conversations/${conv.id}/claim`).set('Authorization', auth);
      expect(claim.status).toBe(200);
      return realPreSendCheck(...args);
    });

    await postWebhook(inboundPayload({ text: QUESTION }));
    await settle();
    await advance(5000);

    const texts = sends().map(sendText);
    expect(texts).toEqual([acks.claimAck({ staffName: 'رنا', lang: 'ar' })]);
    expect(botRows().map((m) => m.status)).toEqual(['cancelled']);
    expect(inboundRows().map((m) => m.status)).toEqual(['awaiting_staff']);
  });

  test('(v) staff send, customer asks at +5 min, pause expires at +30 → the sweeper requeues and the bot answers', async () => {
    const { conv, auth } = seedStaffConversation();
    const staff = await request(app).post(`/api/inbox/conversations/${conv.id}/send`).set('Authorization', auth)
      .send({ text: 'أهلين، معك رنا من فريق شِفت' });
    expect(staff.status).toBe(200);

    await advance(5 * MIN);
    await postWebhook(inboundPayload({ text: QUESTION }));
    await settle();
    await advance(2000);
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(inboundRows().map((m) => m.status)).toEqual(['awaiting_staff']);

    await advance(MIN);
    await sweep(); // +6 min: still paused
    expect(inboundRows().map((m) => m.status)).toEqual(['awaiting_staff']);

    jest.setSystemTime(new Date(START.getTime() + 30 * MIN + 30 * 1000));
    await sweep(); // the pause is over and nobody claimed the conversation

    expect(total('pause_requeued')).toBe(1);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(replySends()).toHaveLength(1);
    expect(sends()).toHaveLength(2); // the staff message, then the bot
    expect(inboundRows().map((m) => m.status)).toEqual(['answered']);
  });

  test('(vi) a `failed` status webhook for an answered batch → exactly one requeue', async () => {
    seedShiftBusiness();
    await postWebhook(inboundPayload({ text: QUESTION }));
    await settle();
    await advance(2000);
    expect(inboundRows().map((m) => m.status)).toEqual(['answered']);
    const [first] = botRows();
    expect(first).toMatchObject({ status: 'sent', meta_message_id: expect.any(String) });

    await advance(20 * 1000);
    const failed = statusWebhook({
      id: first.meta_message_id, status: 'failed', recipient_id: CUSTOMER, biz_opaque_callback_data: first.id,
      errors: [{ code: 131000, title: 'Something went wrong' }],
    });
    expect((await postWebhook(failed)).status).toBe(200);
    await settle();
    await advance(100);

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(replySends()).toHaveLength(2);
    expect(inboundRows().map((m) => m.status)).toEqual(['answered']);
    expect(botRows()[0]).toMatchObject({
      status: 'failed',
      raw_payload: expect.objectContaining({ settled: 'requeued', status_error: { code: 131000, title: 'Something went wrong' } }),
    });

    // Meta repeats the same status: already settled, nothing requeued again.
    await postWebhook(failed);
    await settle();
    await advance(5000);
    await sweepEveryMinuteUntil(4 * MIN);
    expect(replySends()).toHaveLength(2);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  test('(vii) STOP on an instance that dies before handling it → the sweeper applies the deterministic opt-out, no AI', async () => {
    seedShiftBusiness();
    let receipts = 0;
    const defaultImpl = axios.post.getMockImplementation();
    axios.post.mockImplementation(async (url, payload) => {
      // The first read receipt never returns: this instance is gone before it reaches the batcher.
      if (payload && payload.status === 'read' && receipts++ === 0) return new Promise(() => {});
      return defaultImpl(url, payload);
    });

    expect((await postWebhook(inboundPayload({ text: 'STOP' }))).status).toBe(200);
    await settle();
    await advance(20 * 1000);
    expect(inboundRows().map((m) => m.status)).toEqual(['received']);
    expect(sends()).toHaveLength(0);

    await advance(15 * 1000);
    await sweep();

    expect(total('orphans')).toBe(1);
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(sends()).toHaveLength(1);
    expect([acks.optOut('ar'), acks.optOut('en')]).toContain(sendText(sends()[0]));
    expect(inboundRows().map((m) => m.status)).toEqual(['skipped']);
    const conv = conversationOf();
    expect(typeof conv.workflow_data.marketing_opted_out_at).toBe('string');
    expect(botRows().map((m) => [m.raw_payload.kind, m.status])).toEqual([['optout', 'sent']]);

    await sweepEveryMinuteUntil(4 * MIN);
    expect(sends()).toHaveLength(1);
  });

  test('(viii) external tenant: crash after the row is claimed, before the forward → forwarded once by the sweeper', async () => {
    db.seed({
      businesses: [{
        name: 'My Restaurant', business_type: 'restaurant', status: 'active', wa_phone_number_id: EXTERNAL_PNID,
        wa_access_token: encrypt('ext_token'), ai_config: { reply_mode: 'external', forward_url: FORWARD_URL },
      }],
    });
    // The first thing forwardExternal does after the 200; a throw here stands in for the instance dying.
    jest.spyOn(sseEmitter, 'emit').mockImplementationOnce(() => { throw new Error('instance died'); });
    const forwards = () => axios.post.mock.calls.filter(([url]) => url === FORWARD_URL);

    const payload = inboundPayload({ pnid: EXTERNAL_PNID, text: 'بدي أطلب بيتزا' });
    expect((await postWebhook(payload)).status).toBe(200);
    await settle();
    await advance(MIN);
    expect(db.store.messages.map((m) => m.status)).toEqual(['processing']);
    expect(forwards()).toHaveLength(0);

    await advance(MIN + 1000);
    await sweep();

    expect(forwards()).toHaveLength(1);
    const [, forwarded] = forwards()[0];
    expect(forwarded.metadata.phone_number_id).toBe(EXTERNAL_PNID);
    expect(forwarded.messages[0]).toMatchObject({ id: payload.entry[0].changes[0].value.messages[0].id, text: { body: 'بدي أطلب بيتزا' } });
    expect(db.store.messages.map((m) => m.status)).toEqual(['delivered']);
    expect(reports[0].stuck_inbound).toMatchObject({ reprocessed: 1, gaveUp: 0 });

    await sweepEveryMinuteUntil(6 * MIN);
    expect(forwards()).toHaveLength(1);
    expect(sends()).toHaveLength(0);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  test('(ix) D19 out of order: `failed` status processed while the Graph POST is in flight → requeued once, answered by a second send', async () => {
    // Meta does not order the status webhook after the POST's response. The failed status settles the
    // intent first; the POST's wamid must not turn it back into `sent` and the rows into `answered`
    // (GPT-6 #7 re-verification: the customer stayed silent with the retry budget spent).
    seedShiftBusiness();
    let releasePost;
    let callback;
    const defaultImpl = axios.post.getMockImplementation();
    axios.post.mockImplementation((url, payload) => {
      if (!callback && payload && payload.type === 'text') {
        callback = payload.biz_opaque_callback_data;
        return new Promise((resolve) => {
          releasePost = () => resolve({ status: 200, data: { messages: [{ id: 'wamid.accepted' }] } });
        });
      }
      return defaultImpl(url, payload);
    });

    await postWebhook(inboundPayload({ text: QUESTION }));
    await settle();
    await advance(2000);
    expect(callback).toBe(botRows()[0].id);
    expect(botRows()[0].status).toBe('sending');

    await postWebhook(statusWebhook({
      id: 'wamid.accepted', status: 'failed', recipient_id: CUSTOMER, biz_opaque_callback_data: callback, errors: [{ code: 131000 }],
    }));
    await settle();
    releasePost();
    await settle();

    const [first] = botRows();
    expect(first).toMatchObject({ status: 'failed', meta_message_id: 'wamid.accepted' });
    expect(first.raw_payload.settled).toBe('requeued');
    expect(inboundRows().map((m) => m.status)).toEqual(['received']);
    expect(replySends()).toHaveLength(1);

    // The requeue armed a run while the first one still held the lease; it answers once that run is over.
    await advance(3000);
    expect(replySends()).toHaveLength(2);
    await sweepEveryMinuteUntil(8 * MIN);
    expect(replySends()).toHaveLength(2);
    expect(botRows().map((m) => [m.raw_payload.kind, m.status])).toEqual([['reply', 'failed'], ['reply', 'sent']]);
    expect(inboundRows().map((m) => m.status)).toEqual(['answered']);
    expect(conversationOf().status).not.toBe('pending');
  });

  test('(x) a sweep stalled past the note claim TTL and taken over does not send the SLA note a second time', async () => {
    // Instance A claims the SLA note (attempt 1) and stalls before its intent row; instance B takes the
    // claim over after NOTE_CLAIM_TTL_MS and sends. A's pre-send check is fenced on the claim.
    const biz = seedShiftBusiness();
    const openedAt = new Date(START.getTime() - 30 * MIN);
    const { needsTeamEntry } = require('../src/workflows/shift/results');
    const [conv] = db.seed({
      conversations: [{
        business_id: biz.id, customer_wa_id: CUSTOMER, status: 'pending', last_inbound_at: openedAt, last_message_at: openedAt,
        workflow_data: { needs_team: needsTeamEntry('person', 'بدو شخص', openedAt.toISOString()) },
      }],
    }).conversations;
    db.seed({ messages: [{ business_id: biz.id, conversation_id: conv.id, direction: 'inbound', status: 'answered', text_body: 'بدي شخص', created_at: openedAt }] });
    const noteSends = () => sends().filter((p) => [acks.slaNote('ar'), acks.slaNote('en')].includes(sendText(p)));

    let sweepB;
    // A second instance: its own sweeper, batcher and processor modules over the same fakeDb and axios mock.
    jest.isolateModules(() => {
      sweepB = require('../src/services/shiftSweeper').runSweep;
    });
    const realCreate = db.prisma.message.create;
    let release;
    let held = false;
    jest.spyOn(db.prisma.message, 'create').mockImplementation(async (args) => {
      if (!held && args && args.data && args.data.raw_payload && args.data.raw_payload.kind === 'sla_note') {
        held = true;
        await new Promise((resolve) => { release = resolve; });
      }
      return realCreate.call(db.prisma.message, args);
    });

    const sweepA = runSweep({ now: new Date() });
    for (let i = 0; i < 200 && !held; i++) await settle(1);
    expect(held).toBe(true);

    jest.setSystemTime(new Date(START.getTime() + 3 * MIN));
    await sweepB({ now: new Date() });
    expect(noteSends()).toHaveLength(1);
    expect(conversationOf().workflow_data.needs_team).toMatchObject({ sla_note_attempt: 2 });

    release();
    await sweepA;
    await settle();
    expect(noteSends()).toHaveLength(1);
    const notes = botRows().filter((m) => m.raw_payload.kind === 'sla_note');
    expect(notes.map((m) => m.status).sort()).toEqual(['cancelled', 'sent']);
  });
});

// ─── PR2 sales quality, end to end ───────────────────────────────────────────
//
// Same real app and fakes. The model is scripted per turn; everything between the signed webhook and the
// mocked Graph POST is production code: pre-fill parsing, prompt v2, results, validators, the role-play
// sandbox, the part sender with its intent rows (D17) and the sweeper's nudge step.

describe('PR2 sales quality end to end', () => {
  const hours = require('../src/workflows/shift/hours');
  const buttons = require('../src/workflows/shift/buttons');
  const roleplay = require('../src/workflows/shift/roleplay');
  const validators = require('../src/workflows/shift/validators');
  const { SHIFT_KNOWLEDGE } = require('../src/workflows/shift/prompt');
  const { runSweep } = require('../src/services/shiftSweeper');
  const PR2_ENV = ['SHIFT_PROMPT_V1', 'SHIFT_ROLEPLAY', 'SHIFT_SAMPLES_VETTED', 'SHIFT_NUDGES', 'SHIFT_MEDIA'];
  const ARABIC = /[ء-ي]/;
  const OFFERS = buttons.slotOffers(hours.resolveTeamHours({}), START, 'ar');
  const INTRO = 'أهلًا وسهلًا، أنا كرم، مساعد شِفت الذكي (shifts-ai.com) — نفس محرّك كرم اللي بنركّبه على رقم مطعمك، بس هون بمعلومات شِفت.';

  beforeEach(() => {
    for (const k of PR2_ENV) delete process.env[k];
  });
  afterEach(() => {
    for (const k of PR2_ENV) delete process.env[k];
  });

  function script(...replies) {
    for (const r of replies) mockGenerateContent.mockResolvedValueOnce(modelReply({ next_step: 'question', action_args: {}, buttons: [], lead: {}, ...r }));
  }

  function seedConversation(business, fields = {}) {
    return db.seed({
      conversations: [{
        business_id: business.id, customer_wa_id: CUSTOMER, status: 'open', ai_enabled: true,
        last_inbound_at: START, last_message_at: START, ...fields,
      }],
    }).conversations[0];
  }

  /** One customer message through the signed webhook and the quiet window; returns the Graph sends it caused. */
  async function say(text, { wait = 5000 } = {}) {
    const before = sends().length;
    const res = await postWebhook(inboundPayload({ text }));
    expect(res.status).toBe(200);
    await settle();
    await advance(wait);
    return sends().slice(before);
  }

  const userTurn = (call) => mockGenerateContent.mock.calls[call][0].contents[0].parts[0].text;
  const outboundRows = () => db.store.messages.filter((m) => m.direction === 'outbound');

  test('site pre-fill «مرحبًا شِفت 👋 عندي مطعم أو كافيه…» → lead seeded from the template, one reply opening with the canonical intro', async () => {
    seedShiftBusiness();
    const PREFILL = 'مرحبًا شِفت 👋 عندي مطعم أو كافيه. أحتاج: ردود واتساب، الحجوزات والمواعيد. الاسم: محمد. الهاتف: 0791234567. متى نحكي؟';
    script({ reply: `${INTRO} أقرب أوقات الفريق:`, stage: 'close', next_step: 'buttons', buttons: OFFERS.map((o) => ({ id: o.id, title: o.title })), lead: { interest: 'hot' } });

    const parts = await say(PREFILL);

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    // Prompt v2: the static prompt is the system instruction, the pre-fill travels in the user turn.
    expect(mockModelParams[0].systemInstruction).toContain('# الصدق');
    expect(userTurn(0)).toContain('مطعم أو كافيه');
    expect(parts).toHaveLength(1);
    expect(sendText(parts[0]).startsWith(INTRO)).toBe(true);
    expect(parts[0].type).toBe('interactive');
    expect(parts[0].interactive.action.buttons.map((b) => b.reply.id)).toEqual(OFFERS.map((o) => o.id));
    expect(parts[0].biz_opaque_callback_data).toBe(botRows()[0].id);

    const conv = conversationOf();
    const lead = conv.workflow_data.lead;
    expect(lead).toMatchObject({ sector: 'restaurant', name: 'محمد', source: { type: 'site' } });
    expect(lead.need).toEqual(expect.arrayContaining(['ردود واتساب', 'الحجوزات والمواعيد']));
    expect(lead.sector_text).toBeUndefined();
    expect((lead.customer_numbers || []).map(String)).not.toContain('0791234567');
    expect(conv.workflow_data.prefill).toMatchObject({ lang: 'ar', truncated: false });
    expect(conv.workflow_data.disclosed_at).toBeTruthy();
    expect(inboundRows().map((m) => m.status)).toEqual(['answered']);
  });

  test('«جرّبني» → setup ask → facts → an order total «حسب أسعارك» from the closure → «خلص» → debrief; no order is created', async () => {
    const business = seedShiftBusiness();
    seedConversation(business, {
      current_state: 'fit',
      workflow_data: { lead: { sector: 'restaurant', need: ['الطلبات بالليل'], version: 1 }, bot_turns: 3, disclosed_at: START.toISOString() },
    });

    // 1. The model proposes the setup; the server appends the fixed ask.
    script({ reply: 'أكيد، خلّيني أصير كرم تبع مطعمك.', stage: 'roleplay_setup', next_step: 'confirmed' });
    const t1 = await say('جرّبني');
    expect(t1).toHaveLength(1);
    expect(sendText(t1[0])).toBe(`أكيد، خلّيني أصير كرم تبع مطعمك.\n\n${roleplay.setupAsk('restaurant', 'ar')}`);
    expect(conversationOf().current_state).toBe('roleplay_setup');

    // 2. The facts → START_ROLEPLAY → the labelled start line.
    const FACTS = ['شاورما 3 دنانير', 'برجر 4', 'توصيل داخل إربد'];
    script({ reply: 'أهلًا فيك بمطعم الساحة، شو بتحب تطلب؟', action: 'START_ROLEPLAY', action_args: { sector: 'restaurant', business_name: 'مطعم الساحة', facts: FACTS }, stage: 'roleplay_setup' });
    const t2 = await say('مطعم الساحة، شاورما 3 دنانير، برجر 4، توصيل داخل إربد');
    expect(t2).toHaveLength(1);
    expect(sendText(t2[0]).startsWith(roleplay.startLine('مطعم الساحة', 'ar'))).toBe(true);
    expect(conversationOf().current_state).toBe('roleplay');

    // 3. In character: 10 is not a number the customer typed, but 2×3 + 1×4 with «حسب أسعارك» passes.
    const total = 'شاورما عدد 2 بـ3 دنانير وبرجر عدد 1 بـ4 — المجموع 10 دنانير حسب أسعارك. بتأكد الطلب؟';
    script({ reply: total, stage: 'sample' });
    const t3 = await say('بدي 2 شاورما و1 برجر');
    expect(t3).toHaveLength(1);
    expect(t3[0].type).toBe('text');
    expect(sendText(t3[0])).toBe(total);
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);

    // 4. «خلص» → the fixed debrief, no model call, no buttons.
    const t4 = await say('خلص');
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    expect(t4).toHaveLength(1);
    expect(t4[0].type).toBe('text');
    expect(sendText(t4[0])).toBe(roleplay.endLine('restaurant', 'ar'));

    const conv = conversationOf();
    expect(conv.current_state).toBe('close');
    expect(conv.workflow_data.roleplay).toMatchObject({ active: false, end_reason: 'done', business_name: 'مطعم الساحة' });
    expect(conv.workflow_data.lead.business_name).toBe('مطعم الساحة');
    expect(conv.workflow_data.lead.name).toBeUndefined();
    expect(conv.status).toBe('open');
    expect(db.store.orders).toHaveLength(0);
    expect(inboundRows().every((m) => m.status === 'answered')).toBe(true);
  });

  test('SEND_SAMPLE for a vetted sector → one image-header interactive sent through its own intent row', async () => {
    const business = seedShiftBusiness({ samples_vetted: ['restaurant'] });
    seedConversation(business, {
      current_state: 'fit',
      workflow_data: { lead: { sector: 'restaurant', version: 1 }, bot_turns: 3, disclosed_at: START.toISOString() },
    });
    script({ reply: 'تمام، هاد مثال على مطعم.', action: 'SEND_SAMPLE', action_args: { sector: 'restaurant' }, stage: 'sample', next_step: 'buttons' });

    const parts = await say('أي أوريني');

    const cards = parts.filter((p) => p.type === 'interactive' && p.interactive.header && p.interactive.header.type === 'image');
    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card.interactive.header.image.link).toMatch(/^https:\/\/shifts-ai\.com\/assets\/samples\/restaurant-square-v1\.png$/);
    expect(card.interactive.body.text.startsWith('مثال توضيحي')).toBe(true);
    expect(card.interactive.action.buttons.map((b) => b.reply.id)).toEqual(['sample_roleplay:restaurant', 'sample_page:restaurant', 'lead_talk']);
    // D17: the intent row exists before the Graph call and its id rides as callback data.
    const intent = outboundRows().find((m) => m.id === card.biz_opaque_callback_data);
    expect(intent).toBeTruthy();
    expect(intent).toMatchObject({ status: 'sent', is_ai_generated: true });
    expect(intent.raw_payload).toMatchObject({ part_type: 'interactive', image_link: card.interactive.header.image.link });
    for (const p of parts) expect(outboundRows().some((m) => m.id === p.biz_opaque_callback_data)).toBe(true);

    const conv = conversationOf();
    expect(conv.current_state).toBe('sample');
    expect(conv.workflow_data.samples_sent).toMatchObject({ image: 'restaurant' });
  });

  test('SEND_SAMPLE for an unvetted sector → the role-play setup ask instead of an image', async () => {
    const business = seedShiftBusiness();
    seedConversation(business, {
      current_state: 'fit',
      workflow_data: { lead: { sector: 'clinic', version: 1 }, bot_turns: 3, disclosed_at: START.toISOString() },
    });
    script({ reply: 'تمام.', action: 'SEND_SAMPLE', action_args: { sector: 'clinic' }, stage: 'sample', next_step: 'buttons' });

    const parts = await say('أي أوريني');

    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('text');
    expect(sendText(parts[0])).toBe(`تمام.\n\n${roleplay.setupAsk('clinic', 'ar')}`);
    expect(axios.post.mock.calls.some(([, p]) => p && p.interactive && p.interactive.header && p.interactive.header.type === 'image')).toBe(false);
    const conv = conversationOf();
    expect(conv.current_state).toBe('roleplay_setup');
    expect(conv.workflow_data.roleplay).toMatchObject({ active: false, sector: 'clinic', setup_asks: 1 });
    expect(conv.workflow_data.samples_sent.image).toBeFalsy();
  });

  test('the model inventing «50 دينار» → one regeneration, then the stage fallback; the price is never sent', async () => {
    const business = seedShiftBusiness();
    seedConversation(business, {
      current_state: 'objection',
      workflow_data: { lead: { sector: 'restaurant', version: 1 }, bot_turns: 2, disclosed_at: START.toISOString() },
    });
    const invented = { reply: 'الاشتراك عنا 50 دينار بالشهر، بتحب نبلش؟', stage: 'objection' };
    script(invented, invented);

    const parts = await say('طيب كم الاشتراك تقريبًا؟');

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(userTurn(1)).toContain(validators.hintFor('digits', 'ar'));
    expect(parts).toHaveLength(1);
    expect(sendText(parts[0])).toBe(validators.stageFallback('objection', 'ar'));
    expect(axios.post.mock.calls.map(([, p]) => JSON.stringify(p || {})).join('\n')).not.toMatch(/50|خمسين/);
    const conv = conversationOf();
    expect(conv.workflow_data.validator_blocks.map((b) => [b.codes, b.attempt])).toEqual([[['digits'], 1], [['digits'], 2]]);
    expect(inboundRows().map((m) => m.status)).toEqual(['answered']);
  });

  test('«are you a bot?» with a dodging model → the honest identity line', async () => {
    seedShiftBusiness();
    const dodge = { reply: "I'm here to help with anything you need about SHIFT. What kind of business do you run?", stage: 'opening' };
    script(dodge, dodge);

    const parts = await say('are you a bot?');

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(parts).toHaveLength(1);
    expect(sendText(parts[0])).toBe(validators.HONEST_IDENTITY.en);
    expect(sendText(parts[0])).toMatch(/AI assistant/);
  });

  test('an Arabizi opener → an English model line is blocked and the Arabic reply goes out; lead.language = ar', async () => {
    seedShiftBusiness();
    script(
      { reply: "Hi! I'm Karam, SHIFT's AI assistant (shifts-ai.com). Who answers your salon's messages at night?", stage: 'opening' },
      { reply: 'أهلًا وسهلًا، أنا كرم، مساعد شِفت الذكي (shifts-ai.com). مين بيرد على رسائل الصالون بالليل حاليًا؟', stage: 'discovery', lead: { sector: 'other', sector_text: 'صالون حلاقة', city: 'إربد' } },
    );

    const parts = await say('mar7aba, 3ndi salon 7ela2a b irbid, bdi bot yrod 3al zabayen bil lail');

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(userTurn(1)).toContain(validators.hintFor('language', 'ar'));
    expect(parts).toHaveLength(1);
    expect(sendText(parts[0])).toMatch(ARABIC);
    expect(sendText(parts[0])).not.toMatch(/Karam|Hi!/);
    expect(conversationOf().workflow_data.lead).toMatchObject({ language: 'ar', sector: 'other', sector_text: 'صالون حلاقة' });
  });

  test('an English customer → English reply and the /en sector page on shifts-ai.com (role-play off, no vetted image)', async () => {
    process.env.SHIFT_ROLEPLAY = '0';
    seedShiftBusiness();
    script({
      reply: "Hi, I'm Karam, SHIFT's AI assistant (shifts-ai.com). Here's our restaurants page with a full ordering simulation.",
      action: 'SEND_SAMPLE', action_args: { sector: 'restaurant' }, stage: 'sample', next_step: 'buttons',
      lead: { sector: 'restaurant', language: 'en' },
    });

    const parts = await say('Hi, I run a restaurant in Amman. Can you show me an example?');

    expect(parts.length).toBeGreaterThanOrEqual(1);
    for (const p of parts) expect(JSON.stringify(p)).not.toMatch(ARABIC);
    const cta = parts.find((p) => p.type === 'interactive' && p.interactive.type === 'cta_url');
    expect(cta).toBeTruthy();
    expect(cta.interactive.action.parameters.url).toMatch(/^https:\/\/shifts-ai\.com\/en\/restaurants\?/);
    const allText = axios.post.mock.calls.map(([, p]) => JSON.stringify(p || {})).join('\n');
    expect(allText).not.toContain(['shifts-ai', 'store'].join('.'));
    expect(sendText(parts[0])).toContain("SHIFT's AI assistant");
    expect(conversationOf().workflow_data.samples_sent).toMatchObject({ page: 'restaurant' });
  });

  test('SHIFT_PROMPT_V1=1 → the PR1 prompt path: PR1 system prompt, PR1 schema, the batch as the user turn', async () => {
    process.env.SHIFT_PROMPT_V1 = '1';
    seedShiftBusiness();
    script({ reply: 'أهلين فيك! شو نوع منشأتك؟', stage: 'discovery' });

    const parts = await say('مرحبا، بدي أعرف عن كرم');

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const params = mockModelParams[mockModelParams.length - 1];
    expect(params.systemInstruction).toContain(SHIFT_KNOWLEDGE.split('\n')[0]);
    expect(params.systemInstruction).not.toContain('# الصدق');
    expect(params.generationConfig.responseSchema.required).toEqual(['reply', 'action']);
    expect(params.generationConfig.responseSchema.properties.action.enum).toEqual(require('../src/workflows/shift/actions').SHIFT_ACTIONS_V1);
    expect(userTurn(0)).toBe('مرحبا، بدي أعرف عن كرم');
    expect(parts).toHaveLength(1);
    expect(sendText(parts[0])).toBe('أهلين فيك! شو نوع منشأتك؟');
  });

  test('a silent prospect gets exactly one nudge from the sweeper, inside the window and at a friendly hour', async () => {
    const business = seedShiftBusiness();
    seedConversation(business, {
      current_state: 'discovery',
      workflow_data: { lead: { name: 'سامي', sector: 'restaurant', need: ['الطلبات بالليل'], version: 1 }, bot_turns: 2, disclosed_at: START.toISOString() },
    });
    script({ reply: 'عشان طلبات الليل: كرم بيرد من المنيو وبياخد الطلب والمطعم مسكّر. بدك أوريك مثال؟', stage: 'fit' });
    await say('بتضيع علينا طلبات بالليل');
    expect(sends()).toHaveLength(1);
    const reportOf = [];
    const sweepAt = async (iso) => {
      jest.setSystemTime(new Date(iso));
      reportOf.push(await runSweep({ now: new Date() }));
      await advance(100);
    };

    // Monday 10:00 + 20 h = Tuesday 06:00 Amman: not friendly yet, and the plan is due at 09:00.
    await sweepAt('2026-09-14T07:05:00.000Z');
    const nudge = conversationOf().workflow_data.nudge;
    expect(nudge).toMatchObject({ kind: 'stage', sent_at: null, dropped_at: null });
    expect(new Date(nudge.due_at).toISOString()).toBe('2026-09-15T06:00:00.000Z'); // Tue 09:00 Amman
    await sweepAt('2026-09-15T03:00:00.000Z'); // Tue 06:00 Amman
    expect(sends()).toHaveLength(1);

    await sweepAt('2026-09-15T06:05:00.000Z'); // Tue 09:05 Amman, window closes at 10:00
    expect(sends()).toHaveLength(2);
    const sent = sends()[1];
    expect(hours.localParts(new Date(), 'Asia/Amman').minutes).toBeGreaterThanOrEqual(9 * 60);
    expect(sendText(sent)).toContain('أستاذ سامي');
    expect(sendText(sent)).not.toMatch(/واتساب ما بيسمحلنا|النافذة/);
    expect(sent.interactive.action.buttons.map((b) => b.reply.id)).toEqual(['sample_roleplay:restaurant', 'send_sample_now', 'nudge_not_now']);
    const row = outboundRows().find((m) => m.id === sent.biz_opaque_callback_data);
    expect(row).toMatchObject({ status: 'sent' });
    expect(row.raw_payload.kind).toBe('nudge');

    await sweepAt('2026-09-15T06:20:00.000Z');
    await sweepAt('2026-09-15T06:40:00.000Z');
    expect(sends()).toHaveLength(2);
    const conv = conversationOf();
    expect(conv.workflow_data.nudges_sent).toBe(1);
    expect(conv.workflow_data.nudge.sent_at).toBeTruthy();
    expect(reportOf.reduce((n, r) => n + (r.nudges_sent || 0), 0)).toBe(1);
  });
});
