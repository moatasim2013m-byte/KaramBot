/**
 * webhookPersistRetry.test.js — D12 regressions from the PR1 review.
 *
 * The webhook saves inbound messages before answering 200. When that save overruns
 * WEBHOOK_PERSIST_BUDGET_MS, or fails part-way, the route answers 500 and Meta retries — but the
 * message may already be stored, so the retry sees a duplicate. These tests pin that every tenant
 * still processes the message exactly once: the external tenant forwards it, restaurant and generic
 * tenants reply, SHIFT answers an opt-out.
 *
 * Real express app, real messageProcessor, in-memory fakeDb, axios mocked (no network), real timers.
 */

require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');
jest.mock('../src/workflows/restaurant', () => ({
  processRestaurantMessage: jest.fn(async () => ({ reply: 'أهلا! شو بتحب تطلب؟', stateUpdate: {}, action: 'NONE' })),
}));

const crypto = require('crypto');
const request = require('supertest');
const axios = require('axios');
const db = require('./helpers/fakeDb').getFakeDb();
const app = require('../src/app');
const batcher = require('../src/services/replyBatcher');
const { processRestaurantMessage } = require('../src/workflows/restaurant');
const { encrypt } = require('../src/utils/tokenCrypto');

const FORWARD_URL = 'https://hook.example.test/forward';
const CUSTOMER = '962790000001';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function payload(pnid, id, body = 'بدي أطلب') {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba_1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: pnid },
          contacts: [{ wa_id: CUSTOMER, profile: { name: 'زبون' } }],
          messages: [{ id, from: CUSTOMER, timestamp: '1', type: 'text', text: { body } }],
        },
      }],
    }],
  };
}

function post(body) {
  const raw = JSON.stringify(body);
  const sig = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(Buffer.from(raw)).digest('hex');
  return request(app)
    .post('/api/whatsapp/webhook')
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', sig)
    .send(raw);
}

const forwards = () => axios.post.mock.calls.filter(([url]) => url === FORWARD_URL);
// Customer-facing Graph text sends (read receipts excluded).
const textSends = () => axios.post.mock.calls
  .filter(([url, p]) => /\/messages$/.test(url) && p && p.type === 'text')
  .map(([, p]) => p.text.body);
const inbound = () => db.store.messages.filter((m) => m.direction === 'inbound');

function seedBusiness(fields) {
  return db.seed({
    businesses: [{ status: 'active', wa_access_token: encrypt('tok'), ai_config: {}, ...fields }],
  }).businesses[0];
}

// The first inbound insert is slow (a cold DB) but succeeds.
function slowFirstInsert(ms = 200) {
  const realCreate = db.prisma.message.create;
  let slow = true;
  jest.spyOn(db.prisma.message, 'create').mockImplementation(async (args) => {
    if (slow && args?.data?.direction === 'inbound') {
      slow = false;
      await wait(ms);
    }
    return realCreate(args);
  });
}

beforeEach(() => {
  db.reset();
  delete process.env.SHIFT_BOT_LIVE;
  process.env.WEBHOOK_PERSIST_BUDGET_MS = '50';
  axios.post.mockReset();
  let out = 0;
  axios.post.mockImplementation(async (url) => {
    if (url === FORWARD_URL) return { status: 200, data: {} };
    out += 1;
    return { status: 200, data: { messages: [{ id: `wamid.out${out}` }], success: true } };
  });
  processRestaurantMessage.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  batcher.cancelAll();
  delete process.env.WEBHOOK_PERSIST_BUDGET_MS;
  jest.restoreAllMocks();
});

describe('a slow persist answered 500, then Meta retries', () => {
  test('external-mode tenant: forwarded to Make exactly once', async () => {
    seedBusiness({ name: 'My Restaurant', business_type: 'restaurant', wa_phone_number_id: 'pnid_ext', ai_config: { reply_mode: 'external', forward_url: FORWARD_URL } });
    slowFirstInsert();
    const body = payload('pnid_ext', 'wamid.slow1');

    expect((await post(body)).status).toBe(500);
    await wait(300); // the in-flight persist finishes and this delivery processes it
    expect(inbound()).toHaveLength(1);
    expect(forwards()).toHaveLength(1);

    expect((await post(body)).status).toBe(200);
    await wait(100);
    expect(forwards()).toHaveLength(1);
    expect(forwards()[0][1]).toEqual(body.entry[0].changes[0].value);
  });

  test('in-house restaurant: the workflow runs exactly once', async () => {
    seedBusiness({ name: 'Rest', business_type: 'restaurant', wa_phone_number_id: 'pnid_rest' });
    slowFirstInsert();
    const body = payload('pnid_rest', 'wamid.slow2');

    expect((await post(body)).status).toBe(500);
    await wait(300);
    expect((await post(body)).status).toBe(200);
    await wait(100);

    expect(processRestaurantMessage).toHaveBeenCalledTimes(1);
    expect(textSends()).toEqual(['أهلا! شو بتحب تطلب؟']);
  });

  test('generic tenant: the greeting is sent exactly once', async () => {
    seedBusiness({ name: 'Gen', business_type: 'generic', wa_phone_number_id: 'pnid_gen', ai_config: { greeting_message: 'كيف بقدر أساعدك؟' } });
    slowFirstInsert();
    const body = payload('pnid_gen', 'wamid.slow3', 'مرحبا');

    expect((await post(body)).status).toBe(500);
    await wait(300);
    expect((await post(body)).status).toBe(200);
    await wait(100);

    expect(textSends()).toEqual(['كيف بقدر أساعدك؟']);
  });

  test('SHIFT: an opt-out saved by the slow delivery is still answered, once', async () => {
    seedBusiness({ name: 'SHIFT', business_type: 'shift', wa_phone_number_id: 'pnid_shift' });
    slowFirstInsert();
    const body = payload('pnid_shift', 'wamid.slow4', 'إيقاف');

    expect((await post(body)).status).toBe(500);
    await wait(300);
    expect((await post(body)).status).toBe(200);
    await wait(100);

    expect(textSends()).toEqual(['تمام، أوقفت المتابعة. إذا احتجتنا إحنا هون.']);
    expect(inbound().map((m) => m.status)).toEqual(['skipped']);
  });
});

describe('a persist that saved the message but failed on the counters', () => {
  test('external-mode tenant: the retry forwards it once and counts it once', async () => {
    seedBusiness({ name: 'My Restaurant', business_type: 'restaurant', wa_phone_number_id: 'pnid_ext', ai_config: { reply_mode: 'external', forward_url: FORWARD_URL } });
    db.failNext('conversation.update', Object.assign(new Error('transient'), { code: 'P1001' }));
    const body = payload('pnid_ext', 'wamid.half1');

    expect((await post(body)).status).toBe(500);
    await wait(50);
    expect(inbound()).toHaveLength(1);
    expect(forwards()).toHaveLength(0);

    expect((await post(body)).status).toBe(200);
    await wait(50);
    expect(forwards()).toHaveLength(1);
    expect(db.store.conversations[0].unread_count).toBe(1);

    // A further duplicate delivery changes nothing.
    expect((await post(body)).status).toBe(200);
    await wait(50);
    expect(forwards()).toHaveLength(1);
    expect(db.store.conversations[0].unread_count).toBe(1);
  });
});

// The first conversation counter update is slow (a cold DB) but succeeds.
function slowFirstCounters(ms = 300) {
  const realUpdate = db.prisma.conversation.update;
  let slow = true;
  jest.spyOn(db.prisma.conversation, 'update').mockImplementation(async (args) => {
    if (slow && args?.data?.unread_count) {
      slow = false;
      await wait(ms);
    }
    return realUpdate(args);
  });
}

describe('a persist that stopped before claiming the message', () => {
  test('external-mode tenant: the retry claims it and forwards it once', async () => {
    seedBusiness({ name: 'Ext', business_type: 'restaurant', wa_phone_number_id: 'pnid_ext', ai_config: { reply_mode: 'external', forward_url: FORWARD_URL } });
    // The claim statement itself fails: the row is saved but still `persisting`.
    db.failNext('message.updateMany', Object.assign(new Error('transient'), { code: 'P1001' }));
    const body = payload('pnid_ext', 'wamid.claim1');

    expect((await post(body)).status).toBe(500);
    await wait(50);
    expect(inbound().map((m) => m.status)).toEqual(['persisting']);
    expect(forwards()).toHaveLength(0);

    expect((await post(body)).status).toBe(200);
    await wait(50);
    expect(inbound().map((m) => m.status)).toEqual(['delivered']);
    expect(forwards()).toHaveLength(1);
    expect(db.store.conversations[0].unread_count).toBe(1);
  });
});

// Review finding (PR1 round 2): a retry used to count as "recovered" whenever last_inbound_at was
// older than the stored message, a read-then-act check that two live deliveries could both pass.
describe('two deliveries of one message racing', () => {
  test('a Meta retry while the slow delivery is still in its counter update: forwarded and counted once', async () => {
    seedBusiness({ name: 'Ext', business_type: 'restaurant', wa_phone_number_id: 'pnid_ext', ai_config: { reply_mode: 'external', forward_url: FORWARD_URL } });
    slowFirstCounters();
    const body = payload('pnid_ext', 'wamid.race1');

    expect((await post(body)).status).toBe(500);
    // Meta retries while delivery 1 is still stuck on the counters.
    expect((await post(body)).status).toBe(200);
    await wait(500);
    expect(inbound()).toHaveLength(1);
    expect(forwards()).toHaveLength(1);
    expect(db.store.conversations[0].unread_count).toBe(1);
  });

  test('in-house restaurant: the same race runs the workflow once', async () => {
    seedBusiness({ name: 'Rest', business_type: 'restaurant', wa_phone_number_id: 'pnid_rest' });
    slowFirstCounters();
    const body = payload('pnid_rest', 'wamid.race_rest');

    expect((await post(body)).status).toBe(500);
    expect((await post(body)).status).toBe(200);
    await wait(500);
    expect(processRestaurantMessage).toHaveBeenCalledTimes(1);
    expect(textSends()).toEqual(['أهلا! شو بتحب تطلب؟']);
  });

  test('two simultaneous deliveries of the same message forward once', async () => {
    seedBusiness({ name: 'Ext', business_type: 'restaurant', wa_phone_number_id: 'pnid_ext', ai_config: { reply_mode: 'external', forward_url: FORWARD_URL } });
    process.env.WEBHOOK_PERSIST_BUDGET_MS = '4000';
    const body = payload('pnid_ext', 'wamid.race2');
    const [r1, r2] = await Promise.all([post(body), post(body)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    await wait(200);
    expect(inbound()).toHaveLength(1);
    expect(forwards()).toHaveLength(1);
  });

  test('SHIFT opt-out: a retry during slow counters sends the ack once', async () => {
    seedBusiness({ name: 'SHIFT', business_type: 'shift', wa_phone_number_id: 'pnid_shift' });
    slowFirstCounters();
    const body = payload('pnid_shift', 'wamid.race3', 'إيقاف');

    expect((await post(body)).status).toBe(500);
    expect((await post(body)).status).toBe(200);
    await wait(600);
    expect(textSends()).toEqual(['تمام، أوقفت المتابعة. إذا احتجتنا إحنا هون.']);
  });

  test('counter updates landing out of order never move last_inbound_at back, and a later duplicate is not processed', async () => {
    seedBusiness({ name: 'Ext', business_type: 'restaurant', wa_phone_number_id: 'pnid_ext', ai_config: { reply_mode: 'external', forward_url: FORWARD_URL } });
    process.env.WEBHOOK_PERSIST_BUDGET_MS = '2000';
    const forwardsOf = (id) => forwards().filter(([, v]) => v?.messages?.[0]?.id === id);

    // Seed the conversation so both deliveries share it.
    expect((await post(payload('pnid_ext', 'wamid.first', 'أهلا'))).status).toBe(200);
    await wait(50);

    // A's counter update is delayed so it lands after B's.
    slowFirstCounters(100);
    // supertest only sends on then(); start both now so they overlap.
    const pA = post(payload('pnid_ext', 'wamid.A', 'أ')).then((r) => r);
    await wait(10); // B's message row is created strictly after A's
    const pB = post(payload('pnid_ext', 'wamid.B', 'ب')).then((r) => r);
    expect((await pA).status).toBe(200);
    expect((await pB).status).toBe(200);
    await wait(50);
    expect(forwardsOf('wamid.A')).toHaveLength(1);
    expect(forwardsOf('wamid.B')).toHaveLength(1);

    const conv = db.store.conversations[0];
    const rowB = db.store.messages.find((m) => m.meta_message_id === 'wamid.B');
    expect(new Date(conv.last_inbound_at).getTime()).toBe(new Date(rowB.created_at).getTime());
    expect(conv.unread_count).toBe(3);

    // Meta redelivers B (at-least-once).
    expect((await post(payload('pnid_ext', 'wamid.B', 'ب'))).status).toBe(200);
    await wait(50);
    expect(forwardsOf('wamid.B')).toHaveLength(1);
  });
});

describe('one webhook entry with two messages from the same customer', () => {
  test('restaurant: the second message is processed from the state the first one wrote', async () => {
    seedBusiness({ name: 'Rest', business_type: 'restaurant', wa_phone_number_id: 'pnid_rest' });
    process.env.WEBHOOK_PERSIST_BUDGET_MS = '4000';
    processRestaurantMessage
      .mockImplementationOnce(async () => ({ reply: 'تمام', stateUpdate: { current_state: 'COLLECTING_ITEMS', workflow_data: { cart: ['pizza'] } }, action: 'NONE' }))
      .mockImplementationOnce(async (business, conversation) => ({ reply: `عندك ${conversation.workflow_data.cart.length}`, stateUpdate: {}, action: 'NONE' }));
    const body = payload('pnid_rest', 'wamid.two1', 'بيتزا');
    body.entry[0].changes[0].value.messages.push({ id: 'wamid.two2', from: CUSTOMER, timestamp: '2', type: 'text', text: { body: 'كمان' } });

    expect((await post(body)).status).toBe(200);
    await wait(100);

    expect(processRestaurantMessage).toHaveBeenCalledTimes(2);
    expect(processRestaurantMessage.mock.calls[1][1]).toMatchObject({ current_state: 'COLLECTING_ITEMS', workflow_data: { cart: ['pizza'] } });
    expect(textSends()).toEqual(['تمام', 'عندك 1']);
  });
});
