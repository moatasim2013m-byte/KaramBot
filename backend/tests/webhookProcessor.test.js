/**
 * webhookProcessor.test.js — the GPT-6 review decisions that live in messageProcessor.
 *
 *  - D24 (#1): persistInbound writes the row and the conversation counters in one transaction; non-SHIFT rows
 *    are `processing` until their forward/workflow ran, and reprocessStuckInbound re-runs a crashed one once.
 *  - D17 (#8): a status webhook reconciles only by the echoed biz_opaque_callback_data or an exact wamid.
 *  - D19 (#7): a `failed` status on a covering intent requeues its rows once, then hands them to staff.
 *  - D23 (#5): opt-outs, reactions and taps are handled by the leased worker from durable `received` rows.
 *
 * Real messageProcessor + replyBatcher over the in-memory fakeDb. WhatsApp, alerts, axios and the SHIFT AI
 * workflow are mocked, so nothing reaches the network.
 */

require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');
jest.mock('../src/services/whatsapp', () => ({
  sendText: jest.fn(),
  sendInteractiveButtons: jest.fn(),
  sendTextMessage: jest.fn(),
  markAsRead: jest.fn(),
  normalizePhone: jest.fn((p) => (p ? String(p).replace(/\D/g, '') : p)),
}));
jest.mock('../src/services/alerts', () => ({
  sendStaffAlert: jest.fn(),
  alertChannelConfigured: jest.fn(() => false),
  ALERT_REASONS: [],
}));
jest.mock('../src/workflows/shift', () => ({
  processShiftBatch: jest.fn(),
  toWorkflowResult: jest.fn(),
}));
jest.mock('../src/workflows/restaurant', () => ({
  processRestaurantMessage: jest.fn(async () => ({ reply: 'أهلا! شو بتحب تطلب؟', stateUpdate: {}, action: 'NONE' })),
}));

const axios = require('axios');
const db = require('./helpers/fakeDb').getFakeDb();
const whatsapp = require('../src/services/whatsapp');
const alerts = require('../src/services/alerts');
const shift = require('../src/workflows/shift');
const { processRestaurantMessage } = require('../src/workflows/restaurant');
const batcher = require('../src/services/replyBatcher');
const { persistInbound, processInboundMessage, reprocessStuckInbound } = require('../src/services/messageProcessor');

const CUSTOMER = '962790000001';
const FORWARD_URL = 'https://hook.example.test/forward';
const OPT_OUT_ACK = 'تمام، أوقفت المتابعة. إذا احتجتنا إحنا هون.';
const MIN = 60 * 1000;
let seq = 0;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function entryFor(pnid, waMsg) {
  return {
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: pnid },
        contacts: [{ wa_id: CUSTOMER, profile: { name: 'محمد' } }],
        messages: [{ from: CUSTOMER, timestamp: '1', ...waMsg }],
      },
    }],
  };
}

function statusEntry(pnid, status) {
  return { changes: [{ value: { metadata: { phone_number_id: pnid }, statuses: [{ recipient_id: CUSTOMER, ...status }] } }] };
}

function seedBusiness(fields = {}) {
  return db.seed({
    businesses: [{
      business_type: 'shift', status: 'active', wa_phone_number_id: 'pnid_shift',
      // No colons → tokenCrypto.decrypt returns it as-is.
      wa_access_token: 'plain_test_token', ai_config: {}, ...fields,
    }],
  }).businesses[0];
}

function seedConversation(biz, fields = {}) {
  return db.seed({
    conversations: [{ business_id: biz.id, customer_wa_id: CUSTOMER, last_inbound_at: new Date(), ...fields }],
  }).conversations[0];
}

function seedInbound(conv, fields = {}) {
  seq += 1;
  return db.seed({
    messages: [{
      business_id: conv.business_id, conversation_id: conv.id, direction: 'inbound', message_type: 'text',
      text_body: 'كم السعر؟', meta_message_id: `wamid.in${seq}`, sender_wa_id: CUSTOMER, status: 'answered',
      created_at: new Date(Date.now() - 3 * MIN), ...fields,
    }],
  }).messages[0];
}

// A bot send the batcher recorded (dispatchIntent's row shape).
function seedIntent(conv, batchIds, fields = {}, payload = {}) {
  seq += 1;
  return db.seed({
    messages: [{
      business_id: conv.business_id, conversation_id: conv.id, direction: 'outbound', message_type: 'text',
      text_body: 'الباقات بتبدأ من…', status: 'sent', is_ai_generated: true, meta_message_id: `wamid.out${seq}`,
      created_at: new Date(Date.now() - 2 * MIN),
      raw_payload: {
        kind: 'reply', batch_key: `${batchIds[batchIds.length - 1] || 'none'}:0`, part_index: 0, batch_ids: batchIds,
        buttons: null, inbound_status: 'answered', ...payload,
      },
      ...fields,
    }],
  }).messages[0];
}

const row = (id) => db.store.messages.find((m) => m.id === id);
const convRow = (id) => db.store.conversations.find((c) => c.id === id);
const inboundRows = () => db.store.messages.filter((m) => m.direction === 'inbound');
const alertReasons = () => alerts.sendStaffAlert.mock.calls.map(([a]) => a.reason);
const forwards = () => axios.post.mock.calls.filter(([url]) => url === FORWARD_URL);

/**
 * The fakeDb's interactive $transaction rolls back like Postgres (D24 relies on it). This wrapper only adds
 * `inTx()`: whether the caller is inside a transaction callback.
 */
let txDepth = 0;
const inTx = () => txDepth > 0;
function withRollback() {
  const real = db.prisma.$transaction;
  jest.spyOn(db.prisma, '$transaction').mockImplementation(async (arg, options) => {
    if (typeof arg !== 'function') return real.call(db.prisma, arg, options);
    txDepth += 1;
    try {
      return await real.call(db.prisma, arg, options);
    } finally {
      txDepth -= 1;
    }
  });
}

beforeEach(() => {
  db.reset();
  jest.clearAllMocks();
  txDepth = 0;
  delete process.env.SHIFT_BOT_LIVE;
  whatsapp.sendText.mockReset().mockImplementation(async () => {
    seq += 1;
    return { ok: true, id: `wamid.sent${seq}`, error: null, reason: null, code: null, httpStatus: 200, retryable: false };
  });
  whatsapp.sendInteractiveButtons.mockReset().mockImplementation(async () => ({ ok: true, id: `wamid.btn${++seq}` }));
  whatsapp.sendTextMessage.mockReset().mockResolvedValue({ messages: [{ id: 'wamid.rest' }] });
  whatsapp.markAsRead.mockReset().mockResolvedValue(true);
  alerts.sendStaffAlert.mockReset().mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
  shift.processShiftBatch.mockReset().mockImplementation(async () => ({
    kind: 'reply', action: 'NONE', messages: [{ type: 'text', text: 'أهلين!' }], stateUpdate: {}, workflowDataPatch: {},
  }));
  axios.post.mockReset().mockResolvedValue({ status: 200, data: {} });
  processRestaurantMessage.mockClear();
  withRollback();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  batcher.cancelAll();
  jest.restoreAllMocks();
});

// ─── D24 / GPT-6 #1 ──────────────────────────────────────────────────────────

describe('D24 — persistInbound is atomic', () => {
  test('the message row and the conversation counters are written inside one $transaction', async () => {
    seedBusiness();
    const writes = [];
    const realCreate = db.prisma.message.create;
    const realUpdate = db.prisma.conversation.update;
    jest.spyOn(db.prisma.message, 'create').mockImplementation(async (a) => { writes.push(['message.create', inTx()]); return realCreate(a); });
    jest.spyOn(db.prisma.conversation, 'update').mockImplementation(async (a) => { writes.push(['conversation.update', inTx()]); return realUpdate(a); });

    const { items } = await persistInbound(entryFor('pnid_shift', { id: 'wamid.a1', type: 'text', text: { body: 'مرحبا' } }));

    expect(items[0]).toMatchObject({ created: true, claimed: true });
    expect(items[0].conversation.unread_count).toBe(1);
    expect(writes).toEqual([['message.create', true], ['conversation.update', true]]);
  });

  test('a U+0000 in the message or contact name is dropped before insert (Postgres rejects it; found on real PG)', async () => {
    seedBusiness();
    const NUL = String.fromCharCode(0);
    const entry = entryFor('pnid_shift', { id: 'wamid.nul1', type: 'text', text: { body: `مر${NUL}حبا` } });
    entry.changes[0].value.contacts[0].profile.name = `محمد${NUL}`;
    const { items } = await persistInbound(entry);
    expect(items[0]).toMatchObject({ created: true, claimed: true });
    expect(inboundRows()[0].text_body).toBe('مرحبا');
    expect(inboundRows()[0].raw_payload.text.body).toBe('مرحبا');
    expect(db.store.conversations[0].profile_name).toBe('محمد');
    // Meta's original payload is untouched (an external-mode forward sends it as received).
    expect(entry.changes[0].value.messages[0].text.body).toContain(NUL);
  });

  test('counters fail → the insert rolls back with them; the retry saves, counts and processes the message once', async () => {
    seedBusiness();
    const entry = entryFor('pnid_shift', { id: 'wamid.a2', type: 'text', text: { body: 'مرحبا' } });
    db.failNext('conversation.update', Object.assign(new Error('transient'), { code: 'P1001' }));

    const err = await persistInbound(entry).catch((e) => e);
    expect(err.message).toBe('transient');
    expect(err.persisted.items).toEqual([]);
    // Nothing half-written: no row a retry would mistake for a completed persist.
    expect(inboundRows()).toHaveLength(0);

    const retry = await persistInbound(entry);
    expect(retry.items[0]).toMatchObject({ created: true, claimed: true });
    expect(db.store.conversations[0].unread_count).toBe(1);
    await processInboundMessage(entry, { persisted: retry });
    expect(inboundRows().map((m) => m.status)).toEqual(['received']);
    expect(batcher.hasPendingTimer(db.store.conversations[0].id)).toBe(true);

    const dup = await persistInbound(entry);
    expect(dup.items[0]).toMatchObject({ created: false, claimed: false });
    expect(db.store.conversations[0].unread_count).toBe(1);
  });

  test('SHIFT rows set the shared quiet deadline (batch_due_at) when queued', async () => {
    seedBusiness();
    const entry = entryFor('pnid_shift', { id: 'wamid.a3', type: 'text', text: { body: 'مرحبا' } });
    await processInboundMessage(entry, { persisted: await persistInbound(entry) });
    const conv = db.store.conversations[0];
    expect(typeof conv.metadata.batch_due_at).toBe('string');
    expect(new Date(conv.metadata.batch_due_at).getTime()).toBeGreaterThan(Date.now());
    expect(batcher.hasPendingTimer(conv.id)).toBe(true);
  });

  test('restaurant: the row is `processing` until the workflow ran, then `delivered`', async () => {
    seedBusiness({ business_type: 'restaurant', wa_phone_number_id: 'pnid_rest' });
    const entry = entryFor('pnid_rest', { id: 'wamid.r1', type: 'text', text: { body: 'بدي بيتزا' } });
    const persisted = await persistInbound(entry);
    expect(inboundRows().map((m) => m.status)).toEqual(['processing']);

    await processInboundMessage(entry, { persisted });
    expect(processRestaurantMessage).toHaveBeenCalledTimes(1);
    expect(inboundRows().map((m) => m.status)).toEqual(['delivered']);
  });

  test('external mode: `processing` until the forward was attempted, then `delivered` (even when the forward fails)', async () => {
    seedBusiness({ business_type: 'restaurant', wa_phone_number_id: 'pnid_ext', ai_config: { reply_mode: 'external', forward_url: FORWARD_URL } });
    axios.post.mockRejectedValueOnce(new Error('Make down'));
    const entry = entryFor('pnid_ext', { id: 'wamid.e1', type: 'text', text: { body: 'hi' } });
    const persisted = await persistInbound(entry);
    expect(inboundRows().map((m) => m.status)).toEqual(['processing']);

    await processInboundMessage(entry, { persisted });
    expect(forwards()).toHaveLength(1);
    expect(inboundRows().map((m) => m.status)).toEqual(['delivered']);
  });

  test('a duplicate delivery never marks the other delivery\'s `processing` row delivered', async () => {
    seedBusiness({ business_type: 'restaurant', wa_phone_number_id: 'pnid_ext', ai_config: { reply_mode: 'external', forward_url: FORWARD_URL } });
    const entry = entryFor('pnid_ext', { id: 'wamid.e2', type: 'text', text: { body: 'hi' } });
    await persistInbound(entry); // delivery 1 persisted, then its instance died
    const dup = await persistInbound(entry);
    await processInboundMessage(entry, { persisted: dup });
    expect(forwards()).toHaveLength(0);
    expect(inboundRows().map((m) => m.status)).toEqual(['processing']);
  });
});

describe('D24 — reprocessStuckInbound', () => {
  test('restaurant: a row left `processing` is re-run once after 2 minutes, never before, never twice', async () => {
    seedBusiness({ business_type: 'restaurant', wa_phone_number_id: 'pnid_rest' });
    const entry = entryFor('pnid_rest', { id: 'wamid.s1', type: 'text', text: { body: 'بدي بيتزا' } });
    await persistInbound(entry); // the instance died before processInboundMessage

    let report = await reprocessStuckInbound({ now: new Date(Date.now() + 60 * 1000) });
    expect(report.reprocessed).toBe(0);
    expect(processRestaurantMessage).not.toHaveBeenCalled();

    report = await reprocessStuckInbound({ now: new Date(Date.now() + 3 * MIN) });
    expect(report.reprocessed).toBe(1);
    expect(processRestaurantMessage).toHaveBeenCalledTimes(1);
    expect(processRestaurantMessage.mock.calls[0][2]).toBe('بدي بيتزا');
    expect(whatsapp.sendTextMessage).toHaveBeenCalledWith('pnid_rest', 'plain_test_token', CUSTOMER, 'أهلا! شو بتحب تطلب؟');
    expect(inboundRows().map((m) => m.status)).toEqual(['delivered']);

    report = await reprocessStuckInbound({ now: new Date(Date.now() + 10 * MIN) });
    expect(report.reprocessed).toBe(0);
    expect(processRestaurantMessage).toHaveBeenCalledTimes(1);
  });

  test('external mode: the rebuilt change value is forwarded once', async () => {
    seedBusiness({ business_type: 'restaurant', wa_phone_number_id: 'pnid_ext', ai_config: { reply_mode: 'external', forward_url: FORWARD_URL } });
    const entry = entryFor('pnid_ext', { id: 'wamid.s2', type: 'text', text: { body: 'بدي أطلب' } });
    await persistInbound(entry);

    const report = await reprocessStuckInbound({ now: new Date(Date.now() + 3 * MIN) });
    expect(report.reprocessed).toBe(1);
    expect(forwards()).toHaveLength(1);
    const value = forwards()[0][1];
    expect(value.metadata.phone_number_id).toBe('pnid_ext');
    expect(value.messages).toEqual(entry.changes[0].value.messages);
    expect(value.contacts[0]).toMatchObject({ wa_id: CUSTOMER, profile: { name: 'محمد' } });
    expect(inboundRows().map((m) => m.status)).toEqual(['delivered']);
  });

  test('a re-run that itself dies is not retried again: it is given up and logged', async () => {
    seedBusiness({ business_type: 'restaurant', wa_phone_number_id: 'pnid_rest' });
    await persistInbound(entryFor('pnid_rest', { id: 'wamid.s3', type: 'text', text: { body: 'x' } }));
    processRestaurantMessage.mockImplementationOnce(async () => { throw new Error('instance died mid-run'); });

    const first = await reprocessStuckInbound({ now: new Date(Date.now() + 3 * MIN) });
    expect(first.errors).toHaveLength(1);
    expect(inboundRows().map((m) => m.status)).toEqual(['reprocessing']);

    const later = await reprocessStuckInbound({ now: new Date(Date.now() + 10 * MIN) });
    expect(later.reprocessed).toBe(0);
    expect(later.gaveUp).toBe(1);
    expect(processRestaurantMessage).toHaveBeenCalledTimes(1);
    expect(inboundRows().map((m) => m.status)).toEqual(['delivered']);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('gave up'));
  });
});

// ─── D17 / GPT-6 #8 ──────────────────────────────────────────────────────────

describe('D17 — statuses reconcile only by the echoed intent id or an exact wamid', () => {
  test('no callback data: an unknown wamid is never attached to an ambiguous send by recipient or time', async () => {
    const biz = seedBusiness();
    const conv = seedConversation(biz);
    const waiting = seedInbound(conv, { status: 'unconfirmed' });
    const amb = seedIntent(conv, [waiting.id], { status: 'ambiguous', meta_message_id: null, created_at: new Date() });

    // e.g. the delivery status of a staff claim ack whose row is not written yet.
    await processInboundMessage(statusEntry('pnid_shift', { id: 'wamid.claimack', status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)) }));

    expect(row(amb.id)).toMatchObject({ meta_message_id: null, status: 'ambiguous' });
    expect(row(waiting.id).status).toBe('unconfirmed');
  });

  test('echoed biz_opaque_callback_data confirms exactly that intent: wamid attached, its rows answered', async () => {
    const biz = seedBusiness();
    const conv = seedConversation(biz);
    const waiting = seedInbound(conv, { status: 'unconfirmed' });
    const other = seedIntent(conv, [], { status: 'ambiguous', meta_message_id: null }, { kind: 'sla_note' });
    const amb = seedIntent(conv, [waiting.id], { status: 'ambiguous', meta_message_id: null });

    await processInboundMessage(statusEntry('pnid_shift', { id: 'wamid.echo', status: 'delivered', biz_opaque_callback_data: amb.id }));

    expect(row(amb.id)).toMatchObject({ meta_message_id: 'wamid.echo', status: 'delivered' });
    expect(row(waiting.id).status).toBe('answered');
    expect(row(other.id)).toMatchObject({ meta_message_id: null, status: 'ambiguous' });
  });

  test('an exact wamid still updates staff sends and never moves a bot intent backwards', async () => {
    const biz = seedBusiness();
    const conv = seedConversation(biz);
    const [staff] = db.seed({
      messages: [{ business_id: biz.id, conversation_id: conv.id, direction: 'outbound', status: 'sent', meta_message_id: 'wamid.staff', sent_by_user_id: 'u1' }],
    }).messages;
    const intent = seedIntent(conv, [], { status: 'read', meta_message_id: 'wamid.bot' });

    await processInboundMessage(statusEntry('pnid_shift', { id: 'wamid.staff', status: 'delivered' }));
    await processInboundMessage(statusEntry('pnid_shift', { id: 'wamid.bot', status: 'delivered' }));

    expect(row(staff.id).status).toBe('delivered');
    expect(row(intent.id).status).toBe('read');
  });
});

// ─── D19 / GPT-6 #7 ──────────────────────────────────────────────────────────

describe('D19 — a failed status on a covering intent', () => {
  test('first failure → its answered rows go back to `received` once and a run is scheduled', async () => {
    const biz = seedBusiness();
    const conv = seedConversation(biz);
    const q = seedInbound(conv);
    const intent = seedIntent(conv, [q.id]);

    await processInboundMessage(statusEntry('pnid_shift', {
      id: intent.meta_message_id, status: 'failed', biz_opaque_callback_data: intent.id, errors: [{ code: 131026, title: 'Message undeliverable' }],
    }));

    expect(row(q.id).status).toBe('received');
    expect(row(intent.id).status).toBe('failed');
    expect(row(intent.id).raw_payload).toMatchObject({ settled: 'requeued', status_error: { code: 131026 } });
    expect(batcher.hasPendingTimer(conv.id)).toBe(true);
    expect(alertReasons()).toEqual([]);
  });

  test('the same failure webhook twice settles once', async () => {
    const biz = seedBusiness();
    const conv = seedConversation(biz);
    const q = seedInbound(conv);
    const intent = seedIntent(conv, [q.id]);
    const failed = statusEntry('pnid_shift', { id: intent.meta_message_id, status: 'failed', biz_opaque_callback_data: intent.id });

    await processInboundMessage(failed);
    batcher.cancelAll();
    row(q.id).status = 'answered'; // the requeued run answered it
    await processInboundMessage(failed);

    expect(row(q.id).status).toBe('answered');
    expect(batcher.hasPendingTimer(conv.id)).toBe(false);
  });

  test('a second failure for the same batch → awaiting_staff, needs_team unsent_reply, alert', async () => {
    const biz = seedBusiness();
    const conv = seedConversation(biz);
    const q = seedInbound(conv);
    const key = `${q.id}:0`;
    seedIntent(conv, [q.id], { status: 'failed', created_at: new Date(Date.now() - 5 * MIN) }, { batch_key: key, settled: 'requeued' });
    const retry = seedIntent(conv, [q.id], {}, { batch_key: key });

    await processInboundMessage(statusEntry('pnid_shift', { id: retry.meta_message_id, status: 'failed', biz_opaque_callback_data: retry.id }));

    expect(row(q.id).status).toBe('awaiting_staff');
    expect(convRow(conv.id).workflow_data.needs_team.reason).toBe('unsent_reply');
    expect(convRow(conv.id).status).toBe('pending');
    await new Promise((resolve) => setImmediate(resolve));
    expect(alertReasons()).toEqual(['unsent_reply']);
  });

  test('matched by exact wamid (no callback data) it is handled the same way', async () => {
    const biz = seedBusiness();
    const conv = seedConversation(biz);
    const q = seedInbound(conv);
    const intent = seedIntent(conv, [q.id]);

    await processInboundMessage(statusEntry('pnid_shift', { id: intent.meta_message_id, status: 'failed' }));

    expect(row(q.id).status).toBe('received');
    expect(row(intent.id).status).toBe('failed');
  });

  test('another part of the same reply was delivered → no requeue (the customer has an answer)', async () => {
    const biz = seedBusiness();
    const conv = seedConversation(biz);
    const q = seedInbound(conv);
    seedIntent(conv, [q.id], { status: 'delivered' }, { batch_key: `${q.id}:0` });
    const part2 = seedIntent(conv, [q.id], {}, { batch_key: `${q.id}:1`, part_index: 1 });

    await processInboundMessage(statusEntry('pnid_shift', { id: part2.meta_message_id, status: 'failed', biz_opaque_callback_data: part2.id }));

    expect(row(q.id).status).toBe('answered');
    expect(row(part2.id).status).toBe('failed');
    expect(batcher.hasPendingTimer(conv.id)).toBe(false);
  });

  test('a note (no inbound rows) is only marked failed; billing keeps its banner and alert', async () => {
    const biz = seedBusiness();
    const conv = seedConversation(biz);
    const note = seedIntent(conv, [], {}, { kind: 'sla_note', inbound_status: 'answered' });

    await processInboundMessage(statusEntry('pnid_shift', {
      id: note.meta_message_id, status: 'failed', biz_opaque_callback_data: note.id, errors: [{ code: 131042 }],
    }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(row(note.id).status).toBe('failed');
    expect(typeof convRow(conv.id).metadata.billing_blocked_at).toBe('string');
    expect(alertReasons()).toEqual(['billing']);
  });
});

// ─── D23 / GPT-6 #5 ──────────────────────────────────────────────────────────

describe('D23 — deterministic rows go to the leased worker', () => {
  test('an opt-out is answered under the conversation lease; queued rows are skipped only after its state is saved', async () => {
    seedBusiness();
    const hello = entryFor('pnid_shift', { id: 'wamid.o1', type: 'text', text: { body: 'مرحبا' } });
    await processInboundMessage(hello, { persisted: await persistInbound(hello) });
    const acquire = jest.spyOn(db.jsonb, 'acquireLease');

    const stop = entryFor('pnid_shift', { id: 'wamid.o2', type: 'text', text: { body: 'إيقاف' } });
    await processInboundMessage(stop, { persisted: await persistInbound(stop) });

    expect(acquire).toHaveBeenCalled();
    expect(whatsapp.sendText.mock.calls.map((c) => c[3])).toEqual([OPT_OUT_ACK]);
    expect(inboundRows().map((m) => m.status)).toEqual(['skipped', 'skipped']);
    expect(typeof convRow(db.store.conversations[0].id).workflow_data.marketing_opted_out_at).toBe('string');
    expect(shift.processShiftBatch).not.toHaveBeenCalled();
  });

  test('an opt-out whose state write fails stays `received` (never skipped before it is durable)', async () => {
    seedBusiness();
    const stop = entryFor('pnid_shift', { id: 'wamid.o3', type: 'text', text: { body: 'إيقاف' } });
    const persisted = await persistInbound(stop);
    db.failNext('jsonb.patchJson', new Error('db blip'));

    await processInboundMessage(stop, { persisted });

    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(inboundRows().map((m) => m.status)).toEqual(['received']);
  });

  test('a reaction is skipped by the worker without cutting a pending burst short', async () => {
    seedBusiness();
    const hello = entryFor('pnid_shift', { id: 'wamid.x1', type: 'text', text: { body: 'مرحبا' } });
    await processInboundMessage(hello, { persisted: await persistInbound(hello) });
    const conv = db.store.conversations[0];
    const due = conv.metadata.batch_due_at;

    const reaction = entryFor('pnid_shift', { id: 'wamid.x2', type: 'reaction', reaction: { emoji: '👍', message_id: 'wamid.x' } });
    await processInboundMessage(reaction, { persisted: await persistInbound(reaction) });

    expect(convRow(conv.id).metadata.batch_due_at).toBe(due);
    expect(shift.processShiftBatch).not.toHaveBeenCalled();
    expect(batcher.hasPendingTimer(conv.id)).toBe(true);
    expect(inboundRows().map((m) => m.status)).toEqual(['received', 'received']);
  });
});
