/**
 * replyBatcher.test.js — pr1-contracts §7.1 / §10 (L3a).
 *
 * The real batcher runs against the in-memory fakeDb (Prisma + jsonb share one store), so leases,
 * status transitions and jsonb siblings behave like production. WhatsApp, alerts and the SHIFT
 * workflow are mocked: these tests are about when the batcher sends, not what the model says.
 * The last block drives the real messageProcessor SHIFT path through the same fakes.
 */

require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('../src/services/whatsapp', () => ({
  sendText: jest.fn(),
  sendInteractiveButtons: jest.fn(),
  // PR2 shapes (image header, list, CTA URL, image) go through sendStructured (§10.2 #2).
  sendStructured: jest.fn(),
  // The real summary (§4.3): the intent rows must show what the Inbox shows.
  partSummary: jest.fn((...args) => jest.requireActual('../src/services/whatsapp').partSummary(...args)),
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

const db = require('./helpers/fakeDb').getFakeDb();
const whatsapp = require('../src/services/whatsapp');
const alerts = require('../src/services/alerts');
const shift = require('../src/workflows/shift');
const { toWorkflowResult } = require('../src/workflows/shift/results');
const acks = require('../src/workflows/shift/acks');
const batcher = require('../src/services/replyBatcher');
const { persistInbound, processInboundMessage } = require('../src/services/messageProcessor');

const CUSTOMER = '962790000001';
const HOUR = 60 * 60 * 1000;
let seq = 0;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function seedShift({ business = {}, conversation = {} } = {}) {
  const [biz] = db.seed({
    businesses: [{
      name: 'SHIFT', business_type: 'shift', status: 'active', wa_phone_number_id: 'pnid_shift',
      // No colons → tokenCrypto.decrypt returns it as-is.
      wa_access_token: 'plain_test_token', ai_config: {}, ...business,
    }],
  }).businesses;
  const [conv] = db.seed({
    conversations: [{
      business_id: biz.id, customer_wa_id: CUSTOMER, last_inbound_at: new Date(), ...conversation,
    }],
  }).conversations;
  return { biz, conv };
}

function seedInbound(conv, text, { ageMs = 5000, ...fields } = {}) {
  seq += 1;
  return db.seed({
    messages: [{
      business_id: conv.business_id, conversation_id: conv.id, direction: 'inbound', status: 'received',
      message_type: 'text', text_body: text, meta_message_id: `wamid.in${seq}`,
      created_at: new Date(Date.now() - ageMs), ...fields,
    }],
  }).messages[0];
}

function textResult(text = 'أهلًا! شو نوع منشأتك؟', extra = {}) {
  return {
    kind: 'reply', action: 'NONE', messages: [{ type: 'text', text }],
    stateUpdate: { current_state: 'discovery' }, workflowDataPatch: { bot_turns: 1 },
    leadPatch: null, leadMeta: null, needsTeam: null, alert: null, ...extra,
  };
}

const okSend = () => {
  seq += 1;
  return { ok: true, id: `wamid.out${seq}`, error: null, reason: null, code: null, httpStatus: 200, retryable: false };
};
const failSend = (reason, retryable = false) => ({
  ok: false, id: null, error: `send ${reason}`, reason, code: reason === 'billing' ? 131042 : null,
  httpStatus: reason === 'server' ? 503 : null, retryable,
});

const row = (id) => db.store.messages.find((m) => m.id === id);
const convRow = (id) => db.store.conversations.find((c) => c.id === id);
const botOutbound = (conv) => db.store.messages.filter((m) => m.conversation_id === conv.id
  && m.direction === 'outbound' && !m.sent_by_user_id);
const alertReasons = () => alerts.sendStaffAlert.mock.calls.map(([a]) => a.reason);

// Let every queued promise settle (works with fake timers, which never fake native promises).
async function settle(ticks = 300) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}
async function until(predicate, ticks = 5000) {
  for (let i = 0; i < ticks; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('condition not reached');
}

beforeEach(() => {
  db.reset();
  jest.clearAllMocks();
  delete process.env.SHIFT_BOT_LIVE;
  delete process.env.SHIFT_TEST_NUMBERS;
  delete process.env.SHIFT_BATCH_QUIET_MS;
  delete process.env.SHIFT_BATCH_CAP_MS;
  whatsapp.sendText.mockReset().mockImplementation(async () => okSend());
  whatsapp.sendInteractiveButtons.mockReset().mockImplementation(async () => okSend());
  whatsapp.sendStructured.mockReset().mockImplementation(async () => okSend());
  delete process.env.SHIFT_MEDIA;
  delete process.env.SHIFT_ROLEPLAY;
  whatsapp.markAsRead.mockReset().mockResolvedValue(true);
  alerts.sendStaffAlert.mockReset().mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
  shift.processShiftBatch.mockReset().mockImplementation(async () => textResult());
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  batcher.cancelAll();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ─── Pure rules ──────────────────────────────────────────────────────────────

describe('quietWindowMs (test 2)', () => {
  test('question → 1.5 s, short line → 4 s, otherwise 2.5 s', () => {
    expect(batcher.quietWindowMs('متى نحكي؟')).toBe(1500);
    expect(batcher.quietWindowMs('can we talk?  ')).toBe(1500);
    expect(batcher.quietWindowMs('متى نحكي؟ 🙏')).toBe(1500);
    expect(batcher.quietWindowMs('عندي كافيه صغير بإربد وبدي أعرف كيف بتشتغل الخدمة')).toBe(1500);
    expect(batcher.quietWindowMs('بإربد')).toBe(4000);
    expect(batcher.quietWindowMs('')).toBe(4000);
    expect(batcher.quietWindowMs('عندي كافيه صغير بإربد كمان')).toBe(2500);
  });

  test('SHIFT_BATCH_QUIET_MS scales every window', () => {
    const env = { SHIFT_BATCH_QUIET_MS: '1000' };
    expect(batcher.quietWindowMs('؟', env)).toBe(600);
    expect(batcher.quietWindowMs('مرحبا', env)).toBe(1600);
    expect(batcher.quietWindowMs('one two three four five', env)).toBe(1000);
  });
});

describe('isShiftReplyAllowed (D1)', () => {
  const biz = (ai_config = {}) => ({ ai_config });

  test('unset or any value but "0" is live; external mode never replies', () => {
    expect(batcher.isShiftReplyAllowed(biz(), CUSTOMER, {})).toBe(true);
    expect(batcher.isShiftReplyAllowed(biz(), CUSTOMER, { SHIFT_BOT_LIVE: '1' })).toBe(true);
    expect(batcher.isShiftReplyAllowed(biz({ reply_mode: 'external' }), CUSTOMER, {})).toBe(false);
  });

  test('"0" → only ai_config.test_numbers ∪ SHIFT_TEST_NUMBERS', () => {
    expect(batcher.isShiftReplyAllowed(biz(), CUSTOMER, { SHIFT_BOT_LIVE: '0' })).toBe(false);
    expect(batcher.isShiftReplyAllowed(biz({ test_numbers: [CUSTOMER] }), CUSTOMER, { SHIFT_BOT_LIVE: '0' })).toBe(true);
    expect(batcher.isShiftReplyAllowed(biz(), `+${CUSTOMER}`, { SHIFT_BOT_LIVE: '0', SHIFT_TEST_NUMBERS: ' ,+962 79 000 0001' })).toBe(true);
    expect(batcher.isShiftReplyAllowed(biz({ test_numbers: ['962700000000'] }), CUSTOMER, { SHIFT_BOT_LIVE: '0', SHIFT_TEST_NUMBERS: '' })).toBe(false);
  });
});

describe('isHumanActive', () => {
  const now = new Date('2026-09-14T08:00:00Z');
  const open = { status: 'open', ai_enabled: true, metadata: {} };

  test('takeover, AI off, human_active_until in the future, or a staff send inside 30 min', () => {
    expect(batcher.isHumanActive(open, null, now)).toBe(false);
    expect(batcher.isHumanActive({ ...open, status: 'human_takeover' }, null, now)).toBe(true);
    expect(batcher.isHumanActive({ ...open, ai_enabled: false }, null, now)).toBe(true);
    expect(batcher.isHumanActive({ ...open, metadata: { human_active_until: '2026-09-14T08:10:00.000Z' } }, null, now)).toBe(true);
    expect(batcher.isHumanActive({ ...open, metadata: { human_active_until: '2026-09-14T07:59:00+00:00' } }, null, now)).toBe(false);
    expect(batcher.isHumanActive(open, { created_at: new Date(now.getTime() - 5 * 60000) }, now)).toBe(true);
    expect(batcher.isHumanActive(open, { created_at: new Date(now.getTime() - 31 * 60000) }, now)).toBe(false);
  });

  test('after «إرجاع للبوت» (released_at) a staff send from before the release no longer counts', () => {
    const staff = { created_at: new Date(now.getTime() - 10 * 60000) };
    const released = { ...open, metadata: { human_active_until: null, released_at: new Date(now.getTime() - 5 * 60000).toISOString() } };
    expect(batcher.isHumanActive(released, staff, now)).toBe(false);
    // A staff message after the release keeps the bot quiet again.
    expect(batcher.isHumanActive(released, { created_at: new Date(now.getTime() - 60000) }, now)).toBe(true);
  });
});

// ─── Timers ──────────────────────────────────────────────────────────────────

describe('scheduleReply', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });

  test('1. three fragments inside the window → one run, one AI call, one outbound', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبًا… عندي كافيه زيتون… متى نحكي؟', { ageMs: 0 });
    batcher.scheduleReply(conv.id, { text: a.text_body }); // 1.5 s
    await jest.advanceTimersByTimeAsync(800);
    const b = seedInbound(conv, 'بإربد', { ageMs: 0 });
    batcher.scheduleReply(conv.id, { text: b.text_body }); // reset: 4 s
    await jest.advanceTimersByTimeAsync(800);
    const c = seedInbound(conv, 'الاسم: محمد', { ageMs: 0 });
    batcher.scheduleReply(conv.id, { text: c.text_body }); // reset: 4 s → fires at 5.6 s

    await jest.advanceTimersByTimeAsync(3999);
    await settle();
    expect(shift.processShiftBatch).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    await until(() => [a, b, c].every((m) => row(m.id).status === 'answered'));

    expect(shift.processShiftBatch.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(shift.processShiftBatch.mock.calls.length).toBeLessThanOrEqual(2);
    expect(shift.processShiftBatch.mock.calls[0][2].map((m) => m.id)).toEqual([a.id, b.id, c.id]);
    expect(botOutbound(conv)).toHaveLength(1);
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    expect(batcher.hasPendingTimer(conv.id)).toBe(false);
  });

  test('2. quiet windows 1.5 / 2.5 / 4 s', async () => {
    const cases = [['متى نحكي؟', 1500], ['عندي كافيه صغير بإربد كمان', 2500], ['بإربد', 4000]];
    for (const [text, ms] of cases) {
      const id = `conv_${ms}`;
      batcher.scheduleReply(id, { text });
      await jest.advanceTimersByTimeAsync(ms - 1);
      expect(batcher.hasPendingTimer(id)).toBe(true);
      await jest.advanceTimersByTimeAsync(1);
      expect(batcher.hasPendingTimer(id)).toBe(false);
    }
  });

  test('2. the 10 s cap from the first fragment wins over a reset window', async () => {
    const id = 'conv_cap';
    for (let i = 0; i < 4; i++) {
      batcher.scheduleReply(id, { text: 'تمام' }); // 4 s each, at t = 0, 3, 6, 9 s
      if (i < 3) await jest.advanceTimersByTimeAsync(3000);
    }
    await jest.advanceTimersByTimeAsync(999); // t = 9.999 s
    expect(batcher.hasPendingTimer(id)).toBe(true);
    await jest.advanceTimersByTimeAsync(1); // t = 10 s
    expect(batcher.hasPendingTimer(id)).toBe(false);
  });

  test('cancel clears one conversation; a sweep does not cut a pending inbound window', async () => {
    batcher.scheduleReply('c1', { text: 'بإربد' });
    batcher.scheduleReply('c2', { text: 'بإربد' });
    batcher.scheduleReply('c1', { reason: 'sweep' });
    await jest.advanceTimersByTimeAsync(10);
    expect(batcher.hasPendingTimer('c1')).toBe(true);
    batcher.cancel('c1');
    expect(batcher.hasPendingTimer('c1')).toBe(false);
    expect(batcher.hasPendingTimer('c2')).toBe(true);
  });

  test('15. send keeps failing → not retried at once; later runs count up to 3, one alert, then it stops', async () => {
    whatsapp.sendText.mockImplementation(async () => failSend('rejected'));
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');

    expect((await batcher.runBatch(conv.id)).outcome).toBe('failed');
    expect(convRow(conv.id).metadata.reply_failures).toBe(1);
    // No 0 ms retry inside the same outage: the rows stay received and the sweeper paces the next try.
    expect(batcher.hasPendingTimer(conv.id)).toBe(false);
    await jest.advanceTimersByTimeAsync(1000);
    await settle();
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);

    // Two sweeper-driven retries (a minute apart in production).
    for (let i = 0; i < 2; i++) {
      batcher.scheduleReply(conv.id, { reason: 'sweep' });
      await jest.advanceTimersByTimeAsync(1);
      await settle();
    }

    expect(convRow(conv.id).metadata.reply_failures).toBe(3);
    expect(batcher.hasPendingTimer(conv.id)).toBe(false);
    expect(whatsapp.sendText).toHaveBeenCalledTimes(3);
    expect(alertReasons().filter((r) => r === 'reply_failures')).toHaveLength(1);
    expect(row(a.id).status).toBe('received');
    expect(botOutbound(conv).every((m) => m.status === 'failed')).toBe(true);
  });
});

// ─── runBatch ────────────────────────────────────────────────────────────────

describe('runBatch', () => {
  test('3. a newer inbound during generation → exactly one regeneration with the larger batch', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    let b;
    shift.processShiftBatch
      .mockImplementationOnce(async () => {
        b = seedInbound(conv, 'عندي عيادة', { ageMs: 0 });
        return textResult('نسخة قديمة');
      })
      .mockImplementationOnce(async () => textResult('أهلًا! عيادة شو تخصصها؟'));

    const r = await batcher.runBatch(conv.id);

    expect(r).toEqual({ outcome: 'sent', sent: 1 });
    expect(shift.processShiftBatch).toHaveBeenCalledTimes(2);
    expect(shift.processShiftBatch.mock.calls[1][2].map((m) => m.id)).toEqual([a.id, b.id]);
    const out = botOutbound(conv);
    expect(out).toHaveLength(1);
    expect(out[0].text_body).toBe('أهلًا! عيادة شو تخصصها؟');
    expect(out[0].raw_payload.batch_ids).toEqual([a.id, b.id]);
    expect(out[0].raw_payload.batch_key).toBe(`${b.id}:0`);
    expect(row(a.id).status).toBe('answered');
    expect(row(b.id).status).toBe('answered');
  });

  test('4. a third fragment after the regeneration → sent, then rescheduled and answered', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    let b;
    let c;
    shift.processShiftBatch
      .mockImplementationOnce(async () => { b = seedInbound(conv, 'عندي مطعم', { ageMs: 0 }); return textResult('1'); })
      .mockImplementationOnce(async () => { c = seedInbound(conv, 'بعمّان', { ageMs: 0 }); return textResult('2'); })
      .mockImplementationOnce(async () => textResult('3'));

    const r = await batcher.runBatch(conv.id);
    expect(r.outcome).toBe('sent');
    expect(row(a.id).status).toBe('answered');
    expect(row(b.id).status).toBe('answered');
    expect(row(c.id).status).toBe('received');
    expect(batcher.hasPendingTimer(conv.id)).toBe(true);

    for (let i = 0; i < 100 && row(c.id).status !== 'answered'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(row(c.id).status).toBe('answered');
    expect(shift.processShiftBatch).toHaveBeenCalledTimes(3);
    expect(shift.processShiftBatch.mock.calls[2][2].map((m) => m.id)).toEqual([c.id]);
    expect(botOutbound(conv).map((m) => m.text_body)).toEqual(['2', '3']);
  });

  test('5. lease contention → lease_busy, no AI call, no send', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    await db.jsonb.acquireLease(conv.id, 'another-instance', 60000);

    expect(await batcher.runBatch(conv.id)).toEqual({ outcome: 'lease_busy', sent: 0 });
    expect(shift.processShiftBatch).not.toHaveBeenCalled();
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(row(a.id).status).toBe('received');
    expect(convRow(conv.id).metadata.lease_token).toBe('another-instance');
  });

  test('the lease is released after a run', async () => {
    const { conv } = seedShift();
    seedInbound(conv, 'مرحبا');
    await batcher.runBatch(conv.id);
    expect(convRow(conv.id).metadata.lease_token).toBeUndefined();
    expect(convRow(conv.id).metadata.reply_failures).toBe(0);
  });

  test('6. AI failure → exactly one fallback outbound, pending, ai_enabled untouched', async () => {
    // Mid-conversation with no call time chosen: the fallback carries the slot buttons.
    const { biz, conv } = seedShift({ conversation: { current_state: 'discovery', workflow_data: { bot_turns: 2 } } });
    const a = seedInbound(conv, 'بدي أعرف أكثر');
    shift.processShiftBatch.mockImplementation(async (business, conversation, batch, { now }) => {
      seedInbound(conv, 'وكمان سؤال', { ageMs: 0 }); // must not trigger a regeneration after a fallback
      return toWorkflowResult(null, { business, conversation, batchMessages: batch, now });
    });

    const r = await batcher.runBatch(conv.id);
    batcher.cancelAll();
    await settle();

    expect(r).toEqual({ outcome: 'fallback', sent: 1 });
    expect(shift.processShiftBatch).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    const [, , to, body, buttons] = whatsapp.sendInteractiveButtons.mock.calls[0];
    expect(to).toBe(CUSTOMER);
    expect(body).toBe(acks.aiFailure('ar', { withButtons: true }));
    expect(buttons).toHaveLength(3);
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    const out = botOutbound(conv);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: 'sent', message_type: 'interactive', is_ai_generated: true });
    expect(out[0].raw_payload.kind).toBe('fallback');
    const c = convRow(conv.id);
    expect(c.status).toBe('pending');
    expect(c.ai_enabled).toBe(true);
    expect(c.workflow_data.needs_team.reason).toBe('ai_failure');
    expect(c.workflow_data.slot_offers).toHaveLength(3);
    expect(row(a.id).status).toBe('answered');
    expect(alertReasons()).toEqual(['ai_failure']);
    expect(alerts.sendStaffAlert.mock.calls[0][0].business.id).toBe(biz.id);
  });

  test('6b. AI failure on the very first message → one plain-text fallback, no slot buttons', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    shift.processShiftBatch.mockImplementation(async (business, conversation, batch, { now }) =>
      toWorkflowResult(null, { business, conversation, batchMessages: batch, now }));

    const r = await batcher.runBatch(conv.id);
    batcher.cancelAll();
    await settle();

    expect(r).toEqual({ outcome: 'fallback', sent: 1 });
    expect(whatsapp.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendText.mock.calls[0][2]).toBe(CUSTOMER);
    expect(whatsapp.sendText.mock.calls[0][3]).toBe(acks.aiFailure('ar', { withButtons: false }));
    const out = botOutbound(conv);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: 'sent', message_type: 'text', is_ai_generated: true });
    expect(out[0].raw_payload.kind).toBe('fallback');
    const c = convRow(conv.id);
    expect(c.status).toBe('pending');
    expect(c.ai_enabled).toBe(true);
    expect(c.workflow_data.needs_team.reason).toBe('ai_failure');
    expect(c.workflow_data.slot_offers).toBeUndefined();
    expect(row(a.id).status).toBe('answered');
    expect(alertReasons()).toEqual(['ai_failure']);
  });

  describe('7. human active → rows awaiting_staff, no AI, no send', () => {
    test('staff outbound 5 minutes ago', async () => {
      const { conv } = seedShift();
      db.seed({ users: [{ id: 'staff_1', name: 'رنا' }] });
      db.seed({
        messages: [{
          business_id: conv.business_id, conversation_id: conv.id, direction: 'outbound', status: 'sent',
          text_body: 'أهلين، معك رنا', sent_by_user_id: 'staff_1', created_at: new Date(Date.now() - 5 * 60000),
        }],
      });
      const a = seedInbound(conv, 'تمام');
      expect((await batcher.runBatch(conv.id)).outcome).toBe('awaiting_staff');
      expect(row(a.id).status).toBe('awaiting_staff');
      expect(shift.processShiftBatch).not.toHaveBeenCalled();
      expect(whatsapp.sendText).not.toHaveBeenCalled();
      expect(batcher.hasPendingTimer(conv.id)).toBe(false);
    });

    test('metadata.human_active_until in the future', async () => {
      const { conv } = seedShift({ conversation: { metadata: { human_active_until: new Date(Date.now() + 10 * 60000).toISOString() } } });
      const a = seedInbound(conv, 'تمام');
      expect((await batcher.runBatch(conv.id)).outcome).toBe('awaiting_staff');
      expect(row(a.id).status).toBe('awaiting_staff');
      expect(whatsapp.sendText).not.toHaveBeenCalled();
    });

    test('status human_takeover', async () => {
      const { conv } = seedShift({ conversation: { status: 'human_takeover', ai_enabled: false } });
      const a = seedInbound(conv, 'وينكم؟');
      expect((await batcher.runBatch(conv.id)).outcome).toBe('awaiting_staff');
      expect(row(a.id).status).toBe('awaiting_staff');
      expect(shift.processShiftBatch).not.toHaveBeenCalled();
    });
  });

  test('8. a staff send lands during generation → nothing sent, rows awaiting_staff', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'عندي سؤال عن الحجوزات');
    shift.processShiftBatch.mockImplementation(async () => {
      db.seed({ users: [{ id: 'staff_2', name: 'سامي' }] });
      db.seed({
        messages: [{
          business_id: conv.business_id, conversation_id: conv.id, direction: 'outbound', status: 'sent',
          text_body: 'أهلين، بجاوبك هلأ', sent_by_user_id: 'staff_2', created_at: new Date(),
        }],
      });
      return textResult();
    });

    expect((await batcher.runBatch(conv.id)).outcome).toBe('awaiting_staff');
    expect(row(a.id).status).toBe('awaiting_staff');
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(botOutbound(conv)).toHaveLength(0);
  });

  test('9. window already closed → skipped rows, no AI call', async () => {
    const { conv } = seedShift({ conversation: { last_inbound_at: new Date(Date.now() - 25 * HOUR) } });
    const a = seedInbound(conv, 'مرحبا', { ageMs: 25 * HOUR });
    expect((await batcher.runBatch(conv.id)).outcome).toBe('window_closed');
    expect(row(a.id).status).toBe('skipped');
    expect(shift.processShiftBatch).not.toHaveBeenCalled();
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });

  test('9. window closes while generating → checked again at send time', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    shift.processShiftBatch.mockImplementation(async () => {
      await db.prisma.conversation.update({ where: { id: conv.id }, data: { last_inbound_at: new Date(Date.now() - (24 * HOUR - 30000)) } });
      return textResult();
    });
    expect((await batcher.runBatch(conv.id)).outcome).toBe('window_closed');
    expect(row(a.id).status).toBe('skipped');
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(botOutbound(conv)).toHaveLength(0);
  });

  test('10. SHIFT_BOT_LIVE=0 → skipped, but a test number is answered', async () => {
    process.env.SHIFT_BOT_LIVE = '0';
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    expect((await batcher.runBatch(conv.id)).outcome).toBe('skipped');
    expect(row(a.id).status).toBe('skipped');
    expect(shift.processShiftBatch).not.toHaveBeenCalled();

    db.reset();
    const { conv: testConv } = seedShift({ business: { ai_config: { test_numbers: [CUSTOMER] } } });
    const b = seedInbound(testConv, 'مرحبا');
    expect((await batcher.runBatch(testConv.id)).outcome).toBe('sent');
    expect(row(b.id).status).toBe('answered');
  });

  test('a non-SHIFT or inactive business never gets a bot reply', async () => {
    const { conv } = seedShift({ business: { business_type: 'restaurant' } });
    const a = seedInbound(conv, 'مرحبا');
    expect((await batcher.runBatch(conv.id)).outcome).toBe('skipped');
    expect(row(a.id).status).toBe('skipped');
  });

  test('11. state is persisted and the intent row is `sending` before the Graph call', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'بدي عرض سعر، أنا محمد');
    shift.processShiftBatch.mockImplementation(async () => textResult('تمام، سجّلت طلب العرض', {
      action: 'FLAG_FOR_TEAM',
      stateUpdate: { status: 'pending', current_state: 'discovery' },
      workflowDataPatch: { needs_team: { reason: 'quote', summary: 'عرض سعر', at: new Date().toISOString(), resolved_at: null } },
      leadPatch: { name: 'محمد' },
      leadMeta: { source: 'model', msgId: a.id, at: new Date().toISOString(), inboundText: a.text_body },
      alert: { reason: 'quote', summary: 'عرض سعر' },
    }));
    let seenAtSend = null;
    whatsapp.sendText.mockImplementation(async () => {
      const c = convRow(conv.id);
      seenAtSend = {
        intents: botOutbound(conv).map((m) => ({ status: m.status, key: m.raw_payload.batch_key, ids: m.raw_payload.batch_ids })),
        status: c.status,
        needsTeam: c.workflow_data.needs_team?.reason,
        name: c.workflow_data.lead?.name,
      };
      return okSend();
    });

    const r = await batcher.runBatch(conv.id);
    await settle();

    expect(r.outcome).toBe('sent');
    expect(seenAtSend).toEqual({
      intents: [{ status: 'sending', key: `${a.id}:0`, ids: [a.id] }],
      status: 'pending',
      needsTeam: 'quote',
      name: 'محمد',
    });
    expect(botOutbound(conv)[0].status).toBe('sent');
    expect(botOutbound(conv)[0].meta_message_id).toMatch(/^wamid\.out/);
    expect(convRow(conv.id).workflow_data.lead.version).toBe(1);
    expect(convRow(conv.id).ai_enabled).toBe(true);
    expect(alertReasons()).toEqual(['quote']);
  });

  test('12. send ok but commit throws → the next run recovers the rows without a second send', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    db.failNext('message.updateMany', Object.assign(new Error('connection lost'), { code: 'P1001' }));

    const first = await batcher.runBatch(conv.id);
    batcher.cancelAll();
    expect(first.outcome).toBe('sent');
    expect(row(a.id).status).toBe('received');

    const second = await batcher.runBatch(conv.id);
    expect(second).toEqual({ outcome: 'recovered', sent: 0 });
    expect(row(a.id).status).toBe('answered');
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    expect(shift.processShiftBatch).toHaveBeenCalledTimes(1);
    expect(botOutbound(conv)).toHaveLength(1);
  });

  test('13. ambiguous send → row ambiguous, inbound unconfirmed (D18: not answered), no alert yet, no retry', async () => {
    whatsapp.sendText.mockImplementation(async () => failSend('ambiguous'));
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');

    const r = await batcher.runBatch(conv.id);
    await settle();

    expect(r).toEqual({ outcome: 'ambiguous', sent: 1 });
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    expect(botOutbound(conv)[0].status).toBe('ambiguous');
    expect(botOutbound(conv)[0].meta_message_id).toBeNull();
    expect(row(a.id).status).toBe('unconfirmed');
    // Staff hear of it only if it stays unconfirmed (reconcileUnconfirmedIntents escalates).
    expect(alertReasons()).toEqual([]);
    expect(batcher.hasPendingTimer(conv.id)).toBe(false);
  });

  test('14. an error proving the request never left (retryable) → exactly one immediate retry', async () => {
    whatsapp.sendText
      .mockImplementationOnce(async () => failSend('network', true))
      .mockImplementationOnce(async () => okSend());
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');

    expect((await batcher.runBatch(conv.id)).outcome).toBe('sent');
    expect(whatsapp.sendText).toHaveBeenCalledTimes(2);
    expect(botOutbound(conv)).toHaveLength(1);
    expect(botOutbound(conv)[0].status).toBe('sent');
    expect(row(a.id).status).toBe('answered');
  });

  test('15. billing failure → billing_blocked_at and a billing alert, rows stay received', async () => {
    whatsapp.sendText.mockImplementation(async () => failSend('billing'));
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');

    const r = await batcher.runBatch(conv.id);
    batcher.cancelAll();
    await settle();

    expect(r.outcome).toBe('failed');
    const c = convRow(conv.id);
    expect(typeof c.metadata.billing_blocked_at).toBe('string');
    expect(c.metadata.reply_failures).toBe(1);
    expect(alertReasons()).toEqual(['billing']);
    expect(row(a.id).status).toBe('received');
    expect(botOutbound(conv)[0].status).toBe('failed');
    expect(botOutbound(conv)[0].raw_payload).toMatchObject({ reason: 'billing', code: 131042 });
  });

  test('16. a state write that throws → nothing is sent, the failure is counted', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    db.failNext('jsonb.patchJson', new Error('jsonb write failed'));

    const r = await batcher.runBatch(conv.id);
    batcher.cancelAll();

    expect(r.outcome).toBe('failed');
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(botOutbound(conv)).toHaveLength(0);
    expect(row(a.id).status).toBe('received');
    expect(convRow(conv.id).metadata.reply_failures).toBe(1);
  });

  test('17. clock skew: rows with out-of-order created_at are both in the batch', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'أول رسالة', { ageMs: 2000 });
    const b = seedInbound(conv, 'ثاني رسالة', { ageMs: 6000 }); // inserted later, stamped earlier

    expect((await batcher.runBatch(conv.id)).outcome).toBe('sent');
    expect(shift.processShiftBatch.mock.calls[0][2].map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    expect(row(a.id).status).toBe('answered');
    expect(row(b.id).status).toBe('answered');
  });

  test('19. the customer opts out while the reply is generating → no send, rows skipped', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'بدي أعرف الأسعار');
    shift.processShiftBatch.mockImplementation(async () => {
      await db.jsonb.patchJson('conversations', conv.id, 'workflow_data', { marketing_opted_out_at: new Date().toISOString() });
      return textResult();
    });

    expect((await batcher.runBatch(conv.id)).outcome).toBe('skipped');
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(row(a.id).status).toBe('skipped');
  });

  test('an undecryptable token → failed without a retry loop, rows stay received', async () => {
    const { conv } = seedShift({ business: { wa_access_token: 'bad:enc:token' } });
    const a = seedInbound(conv, 'مرحبا');
    expect((await batcher.runBatch(conv.id)).outcome).toBe('failed');
    expect(batcher.hasPendingTimer(conv.id)).toBe(false);
    expect(row(a.id).status).toBe('received');
    expect(shift.processShiftBatch).not.toHaveBeenCalled();
  });

  test('onRetry renews the lease and re-posts the typing indicator', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    let budgetMs;
    shift.processShiftBatch.mockImplementation(async (business, conversation, batch, opts) => {
      budgetMs = opts.deadlineAt - opts.now.getTime();
      await opts.onRetry();
      return textResult();
    });
    await batcher.runBatch(conv.id);
    await settle();
    // 25 s: live Gemini latency reached 12–17 s (2026-09-15), so the old 18 s cut good replies off.
    expect(budgetMs).toBe(25000);
    expect(whatsapp.markAsRead).toHaveBeenCalledWith('pnid_shift', 'plain_test_token', a.meta_message_id, { typing: true });
  });
});

// ─── deliverResult ───────────────────────────────────────────────────────────

describe('deliverResult', () => {
  test('18. dedupes on batch_key: an earlier non-failed outbound for the same batch is not resent', async () => {
    const { biz, conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    db.seed({
      messages: [{
        business_id: biz.id, conversation_id: conv.id, direction: 'outbound', status: 'sent', is_ai_generated: true,
        text_body: 'أهلًا', raw_payload: { kind: 'reply', batch_key: `${a.id}:0`, batch_ids: [] }, created_at: new Date(),
      }],
    });

    const report = await batcher.deliverResult({ business: biz, conversation: convRow(conv.id), result: textResult(), batch: [row(a.id)] });

    expect(report.outcome).toBe('deduped');
    expect(report.parts).toEqual([{ index: 0, status: 'deduped', reason: null, id: null }]);
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(botOutbound(conv)).toHaveLength(1);
    expect(row(a.id).status).toBe('answered');
  });

  test('a failed outbound with the same batch_key does not block the retry', async () => {
    const { biz, conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    db.seed({
      messages: [{
        business_id: biz.id, conversation_id: conv.id, direction: 'outbound', status: 'failed',
        raw_payload: { kind: 'reply', batch_key: `${a.id}:0`, batch_ids: [a.id] }, created_at: new Date(),
      }],
    });

    const report = await batcher.deliverResult({ business: biz, conversation: convRow(conv.id), result: textResult(), batch: [row(a.id)] });
    expect(report.outcome).toBe('sent');
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
  });

  test('a lost lease → nothing written, nothing sent', async () => {
    const { biz, conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    await db.jsonb.acquireLease(conv.id, 'someone-else', 60000);
    const report = await batcher.deliverResult({
      business: biz, conversation: convRow(conv.id), result: textResult(), batch: [row(a.id)], leaseToken: 'mine',
    });
    expect(report).toEqual({ outcome: 'lease_lost', parts: [] });
    expect(convRow(conv.id).current_state).toBeNull();
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });

  test('a note (batch = []) uses the given window margin and touches no inbound row', async () => {
    const { biz, conv } = seedShift({ conversation: { last_inbound_at: new Date(Date.now() - 23.75 * HOUR) } });
    const a = seedInbound(conv, 'مرحبا', { status: 'awaiting_staff' });
    const note = { ...textResult('رسالتك وصلت، الفريق بيكمّل معك هون.'), kind: 'awaiting_note', stateUpdate: {}, workflowDataPatch: {} };

    const closed = await batcher.deliverResult({ business: biz, conversation: convRow(conv.id), result: note, windowMarginMs: 30 * 60000 });
    expect(closed.outcome).toBe('window_closed');

    const sent = await batcher.deliverResult({ business: biz, conversation: convRow(conv.id), result: note });
    expect(sent.outcome).toBe('sent');
    expect(botOutbound(conv)[0].raw_payload).toMatchObject({ kind: 'awaiting_note', batch_key: null, batch_ids: [] });
    expect(row(a.id).status).toBe('awaiting_staff');
  });

  test('a score crossing 6 fires hot_lead once', async () => {
    const { biz, conv } = seedShift({
      conversation: { workflow_data: { needs_team: { reason: 'quote' }, lead: { version: 1, score: 3, business_name: 'زيتون', _prov: {} } } },
    });
    const a = seedInbound(conv, 'بكرا الساعة 10');
    const result = textResult('تمام', { leadPatch: { preferred_time: 'بكرا الساعة 10' }, leadMeta: { source: 'model', msgId: a.id, at: new Date().toISOString(), inboundText: a.text_body } });

    await batcher.deliverResult({ business: biz, conversation: convRow(conv.id), result, batch: [row(a.id)] });
    await settle();

    expect(convRow(conv.id).workflow_data.lead.score).toBeGreaterThanOrEqual(6);
    expect(alertReasons()).toEqual(['hot_lead']);
  });
});

// ─── PR1 review regressions ──────────────────────────────────────────────────

describe('sends left at `sending` (crash or unrecorded result)', () => {
  function seedStaleSending(conv, batchIds, { ageMs = 4 * 60 * 1000, key } = {}) {
    return db.seed({
      messages: [{
        business_id: conv.business_id, conversation_id: conv.id, direction: 'outbound', status: 'sending',
        message_type: 'text', text_body: 'أهلًا! شو نوع منشأتك؟', is_ai_generated: true,
        created_at: new Date(Date.now() - ageMs),
        raw_payload: { kind: 'reply', batch_key: key || `${batchIds[batchIds.length - 1]}:0`, part_index: 0, batch_ids: batchIds, buttons: null },
      }],
    }).messages[0];
  }

  test('process killed mid-send → the next run flags the row ambiguous, never resends, never calls it answered', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا', { ageMs: 5 * 60 * 1000 });
    const stale = seedStaleSending(conv, [a.id]);

    const r = await batcher.runBatch(conv.id);
    await settle();

    expect(r).toEqual({ outcome: 'recovered', sent: 0 });
    expect(row(stale.id).status).toBe('ambiguous');
    // GPT-6 #3: it may never have reached Graph; reconcileUnconfirmedIntents settles it after 2 min.
    expect(row(a.id).status).toBe('unconfirmed');
    expect(alertReasons()).toEqual([]);
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(shift.processShiftBatch).not.toHaveBeenCalled();
  });

  test('definite 400 whose status update fails twice → next run flags it instead of silently answering', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا', { ageMs: 5 * 60 * 1000 });
    whatsapp.sendText.mockReset().mockResolvedValueOnce(failSend('rejected'));
    const blip = () => Object.assign(new Error('connection lost'), { code: 'P1001' });
    db.failNext('message.update', blip());
    db.failNext('message.update', blip());

    const first = await batcher.runBatch(conv.id);
    batcher.cancelAll();
    expect(first.outcome).toBe('failed');
    expect(row(a.id).status).toBe('received');
    expect(botOutbound(conv).map((m) => m.status)).toEqual(['sending']);

    alerts.sendStaffAlert.mockClear();
    const second = await batcher.runBatch(conv.id);
    await settle();
    expect(second).toEqual({ outcome: 'recovered', sent: 0 });
    expect(botOutbound(conv).map((m) => m.status)).toEqual(['ambiguous']);
    expect(row(a.id).status).toBe('unconfirmed');
    expect(alertReasons()).toEqual([]);
  });

  test('one DB blip on the status update is retried: the failure is recorded and the next run resends', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا', { ageMs: 5 * 60 * 1000 });
    whatsapp.sendText.mockReset()
      .mockResolvedValueOnce(failSend('rejected'))
      .mockImplementation(async () => okSend());
    db.failNext('message.update', Object.assign(new Error('connection lost'), { code: 'P1001' }));

    expect((await batcher.runBatch(conv.id)).outcome).toBe('failed');
    batcher.cancelAll();
    expect(botOutbound(conv).map((m) => m.status)).toEqual(['failed']);

    expect((await batcher.runBatch(conv.id)).outcome).toBe('sent');
    expect(whatsapp.sendText).toHaveBeenCalledTimes(2);
    expect(row(a.id).status).toBe('answered');
  });

  test('deliverResult under the lease flags a same-batch_key `sending` row; without a lease it only dedupes', async () => {
    const { biz, conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا', { ageMs: 5 * 60 * 1000 });
    const stale = seedStaleSending(conv, [a.id]);

    const plain = await batcher.deliverResult({ business: biz, conversation: convRow(conv.id), result: textResult(), batch: [row(a.id)] });
    await settle();
    expect(plain.parts).toEqual([{ index: 0, status: 'deduped', reason: null, id: null }]);
    expect(row(stale.id).status).toBe('sending');
    // Deduplicated against an unconfirmed intent: waiting for its confirmation, not answered.
    expect(row(a.id).status).toBe('unconfirmed');
    expect(alertReasons()).toEqual([]);

    row(a.id).status = 'received';
    await db.jsonb.acquireLease(conv.id, 'tok_1');
    const leased = await batcher.deliverResult({
      business: biz, conversation: convRow(conv.id), result: textResult(), batch: [row(a.id)], leaseToken: 'tok_1',
    });
    await settle();
    expect(leased.outcome).toBe('deduped');
    expect(row(stale.id).status).toBe('ambiguous');
    expect(alertReasons()).toEqual([]);
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });
});

describe('button taps and a running batch', () => {
  function tapRow(conv, id = 'slot:other', title = 'وقت ثاني') {
    seq += 1;
    return db.seed({
      messages: [{
        business_id: conv.business_id, conversation_id: conv.id, direction: 'inbound', status: 'received',
        message_type: 'interactive', text_body: title, meta_message_id: `wamid.tap${seq}`,
        interactive_reply: { type: 'button_reply', button_reply: { id, title } }, created_at: new Date(),
      }],
    }).messages[0];
  }

  test('a tap during generation is answered first; the text is regenerated from the post-tap state', async () => {
    const { conv } = seedShift({ conversation: { current_state: 'fit' } });
    const text = seedInbound(conv, 'طيب بس قديش السعر؟');
    let tap;
    let tapRun;
    shift.processShiftBatch
      .mockImplementationOnce(async () => {
        tap = tapRow(conv);
        // messageProcessor runs the tap at once; the generating run holds the lease.
        tapRun = await batcher.runBatch(conv.id);
        return textResult('نسخة قبل الضغطة', { stateUpdate: { current_state: 'fit' } });
      })
      .mockImplementationOnce(async () => textResult('الأسعار حسب الحجم — أي يوم بناسبك؟', { stateUpdate: {} }));

    const r = await batcher.runBatch(conv.id);

    expect(tapRun.outcome).toBe('lease_busy');
    expect(r).toEqual({ outcome: 'sent', sent: 2 });
    expect(whatsapp.sendText.mock.calls.map((c) => c[3])).toEqual(['تمام — أي يوم وساعة بتريحك؟', 'الأسعار حسب الحجم — أي يوم بناسبك؟']);
    // The second generation saw the tap's state and only the text row.
    const [, convSeen, batchSeen] = shift.processShiftBatch.mock.calls[1];
    expect(convSeen.workflow_data.capture_pending).toMatchObject({ slot_id: 'other' });
    expect(convSeen.current_state).toBe('close');
    expect(batchSeen.map((m) => m.id)).toEqual([text.id]);
    expect(convRow(conv.id).current_state).toBe('close');
    expect(row(tap.id).status).toBe('answered');
    expect(row(text.id).status).toBe('answered');
    expect(botOutbound(conv).map((m) => m.raw_payload.kind)).toEqual(['button', 'reply']);
  });

  test('a tap and a text in one batch: the tap is answered deterministically, the text goes to the model', async () => {
    const { conv } = seedShift({ conversation: { current_state: 'fit' } });
    const text = seedInbound(conv, 'وكمان عندي سؤال');
    const tap = tapRow(conv);

    const r = await batcher.runBatch(conv.id);

    expect(r).toEqual({ outcome: 'sent', sent: 2 });
    expect(shift.processShiftBatch).toHaveBeenCalledTimes(1);
    expect(shift.processShiftBatch.mock.calls[0][2].map((m) => m.id)).toEqual([text.id]);
    expect(whatsapp.sendText.mock.calls[0][3]).toBe('تمام — أي يوم وساعة بتريحك؟');
    expect(row(tap.id).status).toBe('answered');
  });

  test('a tap alone never calls the model', async () => {
    const { conv } = seedShift();
    const tap = tapRow(conv);
    expect(await batcher.runBatch(conv.id)).toEqual({ outcome: 'sent', sent: 1 });
    expect(shift.processShiftBatch).not.toHaveBeenCalled();
    expect(row(tap.id).status).toBe('answered');
  });
});

describe('release to the bot', () => {
  test('after /release a staff outbound from 10 min earlier does not park the next message', async () => {
    const { conv } = seedShift({
      conversation: {
        status: 'open', ai_enabled: true, assigned_staff_id: null,
        metadata: { human_active_until: null, released_at: new Date(Date.now() - 60000).toISOString() },
      },
    });
    db.seed({
      messages: [{
        business_id: conv.business_id, conversation_id: conv.id, direction: 'outbound', status: 'sent',
        message_type: 'text', text_body: 'تمام، برجعك للمساعد', sent_by_user_id: 'u_staff',
        created_at: new Date(Date.now() - 10 * 60 * 1000),
      }],
    });
    const a = seedInbound(conv, 'طيب كم السعر؟');

    const r = await batcher.runBatch(conv.id);

    expect(r.outcome).toBe('sent');
    expect(shift.processShiftBatch).toHaveBeenCalledTimes(1);
    expect(row(a.id).status).toBe('answered');
  });
});

// ─── messageProcessor SHIFT path (§7.2) ──────────────────────────────────────

// PR1 review (round 2): writes other actors make while the model is generating must survive the delivery.
describe('writes made while the model generates', () => {
  const captureAi = { reply: 'تمام.', action: 'CAPTURE_TIME', action_args: { time_text: 'الساعة 5' }, lead: {} };

  function seedCaptured() {
    const oldAt = new Date(Date.now() - 3 * HOUR).toISOString();
    const { biz, conv } = seedShift({
      conversation: {
        status: 'pending', current_state: 'captured',
        workflow_data: {
          lead: { name: 'أبو خالد', business_name: 'كافيه زيتون', preferred_time: { text: 'بكرا الساعة 4' }, version: 1 },
          needs_team: {
            reason: 'meeting', summary: 'بكرا الساعة 4', at: oldAt,
            resolved_at: null, sla_note_sent_at: null, claimed_at: null, claimed_by: null,
          },
          bot_turns: 3,
        },
      },
    });
    seedInbound(conv, 'خليها الساعة 5');
    return { biz, conv, oldAt };
  }

  test('a new call time keeps the SLA claim the sweeper made meanwhile', async () => {
    const { biz, conv, oldAt } = seedCaptured();
    shift.processShiftBatch.mockImplementation(async (business, conversation, batch, { now }) => {
      // The sweeper's exact write during generation.
      expect(await db.jsonb.claimFlag('conversations', conv.id, 'workflow_data', ['needs_team', 'sla_note_sent_at'])).toBe(true);
      return toWorkflowResult(captureAi, { business: biz, conversation, batchMessages: batch, now });
    });

    expect((await batcher.runBatch(conv.id)).outcome).toBe('sent');

    const nt = convRow(conv.id).workflow_data.needs_team;
    expect(nt.summary).toContain('5');
    expect(nt.at).toBe(oldAt);
    // Without it the next sweep would send a second SLA note and a duplicate sla_breached alert.
    expect(nt.sla_note_sent_at).toEqual(expect.any(String));
  });

  test('a request staff resolved meanwhile comes back as a fresh request with the new time', async () => {
    const { biz, conv, oldAt } = seedCaptured();
    shift.processShiftBatch.mockImplementation(async (business, conversation, batch, { now }) => {
      // PATCH /conversations/:id/lead {needs_team_resolved:true}, as inbox.js writes it.
      await db.jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'needs_team', { resolved_at: new Date().toISOString() });
      await db.prisma.conversation.update({ where: { id: conv.id }, data: { status: 'open' } });
      return toWorkflowResult(captureAi, { business: biz, conversation, batchMessages: batch, now });
    });

    expect((await batcher.runBatch(conv.id)).outcome).toBe('sent');

    const c = convRow(conv.id);
    // Not the old item with its resolution wiped (which the SLA sweep would flag at once).
    expect(c.workflow_data.needs_team).toMatchObject({ reason: 'meeting', resolved_at: null, sla_note_sent_at: null });
    expect(c.workflow_data.needs_team.summary).toContain('5');
    expect(c.workflow_data.needs_team.at).not.toBe(oldAt);
    expect(c.status).toBe('pending');
  });

  test('a staff claim during generation: the regeneration a tap forces does not answer the tap', async () => {
    const { conv } = seedShift();
    seedInbound(conv, 'مرحبا');
    shift.processShiftBatch.mockImplementationOnce(async () => {
      db.store.conversations.find((c) => c.id === conv.id).status = 'human_takeover';
      db.store.conversations.find((c) => c.id === conv.id).ai_enabled = false;
      seedInbound(conv, 'وقت ثاني', {
        ageMs: 0, message_type: 'interactive',
        interactive_reply: { type: 'button_reply', button_reply: { id: 'slot:other', title: 'وقت ثاني' } },
      });
      return textResult();
    });

    expect((await batcher.runBatch(conv.id)).outcome).toBe('awaiting_staff');
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(convRow(conv.id).status).toBe('human_takeover');
  });

  test('a delivery never writes status over a staff claim', async () => {
    const { biz, conv } = seedShift({ conversation: { status: 'human_takeover' } });
    const a = seedInbound(conv, 'متى بتحكوني؟');
    await batcher.deliverResult({
      business: biz, conversation: { ...convRow(conv.id), status: 'open' },
      result: textResult('تمام', { stateUpdate: { status: 'pending', current_state: 'captured' } }), batch: [row(a.id)],
    });
    expect(convRow(conv.id).status).toBe('human_takeover');
  });

  test('a handoff whose ack could not be sent still alerts staff (the retry sees it as already open)', async () => {
    whatsapp.sendText.mockImplementation(async () => failSend('rejected'));
    const { biz, conv } = seedShift();
    const a = seedInbound(conv, 'بدي احكي مع حدا');
    const result = {
      ...textResult('ولا يهمك.'), kind: 'handoff', action: 'HANDOFF_TO_HUMAN',
      stateUpdate: { status: 'pending', current_state: 'handoff' },
      needsTeam: { reason: 'person' }, alert: { reason: 'handoff', summary: 'بدي احكي مع حدا' },
    };
    const report = await batcher.deliverResult({ business: biz, conversation: convRow(conv.id), result, batch: [row(a.id)] });
    await settle();
    expect(report.outcome).toBe('failed');
    expect(alertReasons().filter((r) => r === 'handoff')).toHaveLength(1);
  });
});

// ─── GPT-6 external review (decisions D17–D26) ───────────────────────────────

describe('GPT-6 #2: lease and human-state fencing right before Graph (D20)', () => {
  // Runs `mutate` right after the batcher's workflow_data write, i.e. after every earlier check.
  function afterStateWrite(mutate) {
    const real = db.jsonb.patchJson;
    jest.spyOn(db.jsonb, 'patchJson').mockImplementation(async (...args) => {
      const r = await real(...args);
      if (args[2] === 'workflow_data') mutate();
      return r;
    });
  }

  test('a staff claim committed after the state writes → no Graph call, rows awaiting_staff, intent cancelled', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'بدي عرض سعر');
    afterStateWrite(() => Object.assign(convRow(conv.id), { status: 'human_takeover', ai_enabled: false }));

    const r = await batcher.runBatch(conv.id);

    expect(r).toEqual({ outcome: 'awaiting_staff', sent: 0 });
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(row(a.id).status).toBe('awaiting_staff');
    expect(botOutbound(conv).map((m) => m.status)).toEqual(['cancelled']);
  });

  test('a staff pause (human_active_until) written after the state writes → no Graph call', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    afterStateWrite(() => {
      convRow(conv.id).metadata = { ...convRow(conv.id).metadata, human_active_until: new Date(Date.now() + 30 * 60000).toISOString() };
    });

    expect((await batcher.runBatch(conv.id)).outcome).toBe('awaiting_staff');
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(row(a.id).status).toBe('awaiting_staff');
  });

  test('another worker took the lease during the state writes → no Graph call, rows left `received` for it', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    afterStateWrite(() => {
      convRow(conv.id).metadata = { ...convRow(conv.id).metadata, lease_token: 'other', reply_lease_until: new Date(Date.now() + 60000).toISOString() };
    });

    expect((await batcher.runBatch(conv.id)).outcome).toBe('lease_lost');
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(row(a.id).status).toBe('received');
    expect(convRow(conv.id).metadata.lease_token).toBe('other');
  });

  test('a failed renewal while the model retries ends the run before any write or send', async () => {
    const { conv } = seedShift();
    seedInbound(conv, 'مرحبا');
    shift.processShiftBatch.mockImplementation(async (business, conversation, batch, opts) => {
      convRow(conv.id).metadata = { ...convRow(conv.id).metadata, reply_lease_until: new Date(Date.now() - 1000).toISOString() };
      await opts.onRetry();
      return textResult('رد', { stateUpdate: { current_state: 'fit' } });
    });

    expect((await batcher.runBatch(conv.id)).outcome).toBe('lease_lost');
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(convRow(conv.id).current_state).toBeNull();
  });
});

describe('GPT-6 #3/#4: an unconfirmed send never counts as an answer (D17/D18)', () => {
  const MIN = 60 * 1000;
  const later = (ms) => new Date(Date.now() + ms);

  test('the intent row id is sent as biz_opaque_callback_data', async () => {
    const { conv } = seedShift();
    seedInbound(conv, 'مرحبا');
    await batcher.runBatch(conv.id);
    const [intent] = botOutbound(conv);
    expect(whatsapp.sendText.mock.calls[0][4]).toEqual({ callbackData: intent.id });
  });

  test('#4: an ambiguous 5xx is not retried; #3: its rows are `unconfirmed`, not answered', async () => {
    whatsapp.sendText.mockImplementation(async () => ({ ...failSend('ambiguous'), httpStatus: 502 }));
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');

    const r = await batcher.runBatch(conv.id);

    expect(r.outcome).toBe('ambiguous');
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    expect(botOutbound(conv)[0]).toMatchObject({ status: 'ambiguous', meta_message_id: null });
    expect(row(a.id).status).toBe('unconfirmed');
    expect(batcher.hasPendingTimer(conv.id)).toBe(false);
  });

  test('#3: a `sending` intent left by a run that died before Graph → rows unconfirmed, never answered nor resent', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا', { ageMs: 60 * 1000 });
    const [dead] = db.seed({
      messages: [{
        business_id: conv.business_id, conversation_id: conv.id, direction: 'outbound', status: 'sending',
        text_body: 'أهلًا', is_ai_generated: true, created_at: new Date(Date.now() - 30000),
        raw_payload: { kind: 'reply', batch_key: `${a.id}:0`, part_index: 0, batch_ids: [a.id], buttons: null },
      }],
    }).messages;

    expect(await batcher.runBatch(conv.id)).toEqual({ outcome: 'recovered', sent: 0 });
    expect(row(a.id).status).toBe('unconfirmed');
    expect(row(dead.id).status).toBe('ambiguous');
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });

  test('reconcile after 2 min: the rows go back to `received` once and a new send answers them', async () => {
    whatsapp.sendText.mockReset()
      .mockImplementationOnce(async () => failSend('ambiguous'))
      .mockImplementation(async () => okSend());
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    await batcher.runBatch(conv.id);

    expect(await batcher.reconcileUnconfirmedIntents({ now: later(1 * MIN) })).toMatchObject({ requeued: 0, escalated: 0 });
    expect(row(a.id).status).toBe('unconfirmed');

    expect(await batcher.reconcileUnconfirmedIntents({ now: later(3 * MIN) })).toMatchObject({ requeued: 1, escalated: 0 });
    batcher.cancelAll();
    expect(row(a.id).status).toBe('received');
    expect(botOutbound(conv)[0].status).toBe('ambiguous_unreconciled');

    expect((await batcher.runBatch(conv.id)).outcome).toBe('sent');
    expect(row(a.id).status).toBe('answered');
    expect(whatsapp.sendText).toHaveBeenCalledTimes(2);
    expect(botOutbound(conv).map((m) => m.raw_payload.batch_key)).toEqual([`${a.id}:0`, `${a.id}:0`]);
  });

  test('a second unconfirmed send for the same batch key → awaiting_staff, needs_team unsent_reply, pending, alert', async () => {
    whatsapp.sendText.mockImplementation(async () => failSend('ambiguous'));
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');

    await batcher.runBatch(conv.id);
    await batcher.reconcileUnconfirmedIntents({ now: later(3 * MIN) });
    batcher.cancelAll();
    await batcher.runBatch(conv.id);
    expect(row(a.id).status).toBe('unconfirmed');

    const report = await batcher.reconcileUnconfirmedIntents({ now: later(6 * MIN) });
    await settle();

    expect(report).toMatchObject({ requeued: 0, escalated: 1 });
    expect(row(a.id).status).toBe('awaiting_staff');
    const c = convRow(conv.id);
    expect(c.status).toBe('pending');
    expect(c.workflow_data.needs_team).toMatchObject({ reason: 'unsent_reply', resolved_at: null });
    expect(alertReasons()).toEqual(['unsent_reply']);
    expect(whatsapp.sendText).toHaveBeenCalledTimes(2);
    // A later sweep does not escalate or requeue it again.
    expect(await batcher.reconcileUnconfirmedIntents({ now: later(9 * MIN) })).toMatchObject({ requeued: 0, escalated: 0 });
  });

  test('a requeued intent confirmed late still used the batch key\'s budget', async () => {
    whatsapp.sendText.mockImplementation(async () => failSend('ambiguous'));
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    await batcher.runBatch(conv.id);
    await batcher.reconcileUnconfirmedIntents({ now: later(3 * MIN) });
    batcher.cancelAll();
    await batcher.runBatch(conv.id);
    const [first] = botOutbound(conv);
    // The first send's `delivered` arrives only now; the rows it covers are answered by it.
    await batcher.applyIntentStatus({ intentId: first.id, wamid: 'wamid.late1', status: 'delivered' });
    row(a.id).status = 'unconfirmed';

    expect(await batcher.reconcileUnconfirmedIntents({ now: later(6 * MIN) })).toMatchObject({ requeued: 0, escalated: 1 });
  });

  describe('rows stranded `unconfirmed` by a crash mid-settlement', () => {
    function seedStranded(conv, intentFields, payload = {}) {
      const a = seedInbound(conv, 'مرحبا', { ageMs: 10 * MIN, status: 'unconfirmed', updated_at: new Date(Date.now() - 6 * MIN) });
      const [intent] = db.seed({
        messages: [{
          business_id: conv.business_id, conversation_id: conv.id, direction: 'outbound', text_body: 'أهلًا',
          is_ai_generated: true, created_at: new Date(Date.now() - 9 * MIN), meta_message_id: 'wamid.s1',
          raw_payload: { kind: 'reply', batch_key: `${a.id}:0`, part_index: 0, batch_ids: [a.id], inbound_status: 'answered', ...payload },
          ...intentFields,
        }],
      }).messages;
      return { a, intent };
    }

    test('D19 crash: rows moved for a failed send, its intent still `sent` → requeued once, intent failed', async () => {
      const { conv } = seedShift();
      const { a, intent } = seedStranded(conv, { status: 'sent' });

      expect(await batcher.reconcileUnconfirmedIntents({ now: new Date() })).toMatchObject({ requeued: 1, escalated: 0 });
      batcher.cancelAll();
      expect(row(a.id).status).toBe('received');
      expect(row(intent.id)).toMatchObject({ status: 'failed', raw_payload: expect.objectContaining({ settled: 'requeued' }) });
      // The requeued run is not deduplicated against the failed intent: the customer gets a reply.
      expect((await batcher.runBatch(conv.id)).outcome).toBe('sent');
      expect(row(a.id).status).toBe('answered');
    });

    test('settleUndelivered crashed after its escalate claim → rows handed to staff with unsent_reply', async () => {
      const { conv } = seedShift();
      const { a } = seedStranded(conv, { status: 'ambiguous_unreconciled', meta_message_id: null }, { settled: 'escalated' });

      expect(await batcher.reconcileUnconfirmedIntents({ now: new Date() })).toMatchObject({ requeued: 0, escalated: 1 });
      await settle();
      expect(row(a.id).status).toBe('awaiting_staff');
      expect(convRow(conv.id).workflow_data.needs_team).toMatchObject({ reason: 'unsent_reply' });
      expect(alertReasons()).toEqual(['unsent_reply']);
      expect(await batcher.reconcileUnconfirmedIntents({ now: new Date() })).toMatchObject({ requeued: 0, escalated: 0 });
    });

    test('rows touched less than 5 min ago, or still covered by an unconfirmed send, are left alone', async () => {
      const { conv } = seedShift();
      const { a } = seedStranded(conv, { status: 'sent' });
      row(a.id).updated_at = new Date(Date.now() - 2 * MIN);
      expect(await batcher.reconcileUnconfirmedIntents({ now: new Date() })).toMatchObject({ requeued: 0, escalated: 0 });
      expect(row(a.id).status).toBe('unconfirmed');
    });
  });

  test('dispatchIntent: dedupe, callback data, and a retry that the pre-send check refuses', async () => {
    const { biz, conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    whatsapp.sendText.mockReset().mockImplementationOnce(async () => {
      // The request never left (retryable), and staff claim before the retry.
      Object.assign(convRow(conv.id), { status: 'human_takeover', ai_enabled: false });
      return failSend('network', true);
    });

    const r = await batcher.dispatchIntent({
      business: biz, conversation: convRow(conv.id), kind: 'button', parts: [{ type: 'text', text: 'تمام' }],
      batchIds: [a.id], batchKey: a.id, precheck: { humanGuard: true },
    });

    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    expect(r.outcome).toBe('failed');
    expect(r.parts[0]).toMatchObject({ status: 'failed', reason: 'network' });
    expect(row(r.parts[0].intentId)).toMatchObject({ status: 'failed', raw_payload: expect.objectContaining({ kind: 'button', batch_key: `${a.id}:0` }) });
    expect(row(a.id).status).toBe('received');

    // A confirmed intent for the same key is never sent twice; the rows take its outcome.
    Object.assign(convRow(conv.id), { status: 'open', ai_enabled: true });
    whatsapp.sendText.mockImplementation(async () => okSend());
    const sent = await batcher.dispatchIntent({
      business: biz, conversation: convRow(conv.id), kind: 'button', parts: [{ type: 'text', text: 'تمام' }],
      batchIds: [a.id], batchKey: a.id, since: a.created_at,
    });
    expect(sent.outcome).toBe('sent');
    expect(whatsapp.sendText.mock.calls[1][4]).toEqual({ callbackData: sent.parts[0].intentId });
    const again = await batcher.dispatchIntent({
      business: biz, conversation: convRow(conv.id), kind: 'button', parts: [{ type: 'text', text: 'تمام' }],
      batchIds: [a.id], batchKey: a.id, since: a.created_at,
    });
    expect(again.outcome).toBe('deduped');
    expect(whatsapp.sendText).toHaveBeenCalledTimes(2);
    expect(row(a.id).status).toBe('answered');
  });

  test('an echoed sent/delivered status for the intent id confirms it: wamid stored, rows answered', async () => {
    whatsapp.sendText.mockImplementation(async () => failSend('ambiguous'));
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    await batcher.runBatch(conv.id);
    const [intent] = botOutbound(conv);

    expect(await batcher.applyIntentStatus({ intentId: intent.id, wamid: 'wamid.echo', status: 'delivered' })).toMatchObject({ matched: true });
    expect(row(intent.id)).toMatchObject({ status: 'delivered', meta_message_id: 'wamid.echo' });
    expect(row(a.id).status).toBe('answered');
    // A late `sent` never moves a delivered row back.
    await batcher.applyIntentStatus({ intentId: intent.id, wamid: 'wamid.echo', status: 'sent' });
    expect(row(intent.id).status).toBe('delivered');
    expect(await batcher.applyIntentStatus({ intentId: 'nope', wamid: 'wamid.x', status: 'sent' })).toMatchObject({ matched: false });
  });
});

describe('GPT-6 #5: opt-out, reactions and taps from durable `received` rows (D23)', () => {
  test('a STOP row still `received` (the instance died first) → deterministic opt-out, fixed ack, no AI', async () => {
    const { conv } = seedShift();
    const hello = seedInbound(conv, 'مرحبا', { ageMs: 8000 });
    const stop = seedInbound(conv, 'إيقاف');
    let atSend = null;
    whatsapp.sendText.mockImplementation(async () => {
      atSend = {
        optedOut: convRow(conv.id).workflow_data.marketing_opted_out_at,
        stopStatus: row(stop.id).status,
        intents: botOutbound(conv).map((m) => [m.status, m.raw_payload.kind]),
      };
      return okSend();
    });

    const r = await batcher.runBatch(conv.id);

    expect(r.sent).toBe(1);
    expect(shift.processShiftBatch).not.toHaveBeenCalled();
    expect(whatsapp.sendText.mock.calls[0][3]).toBe('تمام، أوقفت المتابعة. إذا احتجتنا إحنا هون.');
    // State and the ack's intent are persisted while the command row is still `received`.
    expect(atSend).toEqual({ optedOut: expect.any(String), stopStatus: 'received', intents: [['sending', 'optout']] });
    expect([row(hello.id).status, row(stop.id).status]).toEqual(['skipped', 'skipped']);
    expect(convRow(conv.id).current_state).toBe('closed');
  });

  test('the opt-out state write fails → nothing sent, rows stay `received`; the next run completes it', async () => {
    const { conv } = seedShift();
    const stop = seedInbound(conv, 'stop');
    db.failNext('jsonb.patchJson', new Error('jsonb down'));

    expect((await batcher.runBatch(conv.id)).outcome).toBe('failed');
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(row(stop.id).status).toBe('received');

    await batcher.runBatch(conv.id);
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    expect(row(stop.id).status).toBe('skipped');
    expect(typeof convRow(conv.id).workflow_data.marketing_opted_out_at).toBe('string');
  });

  test('a STOP row found after the 24 h window closed → the opt-out is still stored, no ack is sent', async () => {
    const { conv } = seedShift({ conversation: { last_inbound_at: new Date(Date.now() - 25 * HOUR) } });
    const stop = seedInbound(conv, 'إيقاف', { ageMs: 25 * HOUR });

    expect((await batcher.runBatch(conv.id)).outcome).toBe('window_closed');
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(shift.processShiftBatch).not.toHaveBeenCalled();
    expect(row(stop.id).status).toBe('skipped');
    expect(typeof convRow(conv.id).workflow_data.marketing_opted_out_at).toBe('string');
    expect(convRow(conv.id).current_state).toBe('closed');
  });

  test('a reaction row left `received` is skipped without an AI call or a send', async () => {
    const { conv } = seedShift();
    const r = seedInbound(conv, null, { message_type: 'reaction' });
    await batcher.runBatch(conv.id);
    expect(row(r.id).status).toBe('skipped');
    expect(shift.processShiftBatch).not.toHaveBeenCalled();
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });

  test('a STOP arriving while the model generates → no sales reply, the opt-out is handled in the same run', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'بدي أعرف الأسعار');
    let stop;
    shift.processShiftBatch.mockImplementation(async () => {
      stop = seedInbound(conv, 'إيقاف', { ageMs: 0 });
      return textResult('الأسعار حسب الحجم');
    });

    await batcher.runBatch(conv.id);

    expect(whatsapp.sendText.mock.calls.map((c) => c[3])).toEqual(['تمام، أوقفت المتابعة. إذا احتجتنا إحنا هون.']);
    expect([row(a.id).status, row(stop.id).status]).toEqual(['skipped', 'skipped']);
  });
});

describe('GPT-6 #9: one debounce across instances, one fallback per burst (D25)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });

  test('a run before metadata.batch_due_at does nothing and re-arms for the deadline', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا', { ageMs: 0 });
    convRow(conv.id).metadata = { batch_due_at: new Date(Date.now() + 3000).toISOString() };

    expect(await batcher.runBatch(conv.id)).toEqual({ outcome: 'not_due', sent: 0 });
    expect(shift.processShiftBatch).not.toHaveBeenCalled();
    expect(batcher.hasPendingTimer(conv.id)).toBe(true);

    await jest.advanceTimersByTimeAsync(2999);
    await settle();
    expect(shift.processShiftBatch).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await until(() => row(a.id).status === 'answered');
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
  });

  test('touchBatchDue arms this instance by the DB deadline; a later fragment on another instance pushes it', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا', { ageMs: 0 });
    expect(await batcher.touchBatchDue(conv.id, 1500)).toMatchObject({ delayMs: 1500 });
    expect(convRow(conv.id).metadata.batch_due_at).toEqual(expect.any(String));

    await jest.advanceTimersByTimeAsync(1000);
    // Instance B saved the next fragment and pushed the shared deadline (its own timer is elsewhere).
    const b = seedInbound(conv, 'عندي عيادة', { ageMs: 0 });
    await db.jsonb.touchBatchDue(conv.id, 2500, 10000);

    await jest.advanceTimersByTimeAsync(500); // A's timer fires early → reschedules
    await settle();
    expect(shift.processShiftBatch).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(2000);
    await until(() => row(b.id).status === 'answered');
    expect(shift.processShiftBatch).toHaveBeenCalledTimes(1);
    expect(shift.processShiftBatch.mock.calls[0][2].map((m) => m.id)).toEqual([a.id, b.id]);
  });

  test('AI failure: the fallback covers every fragment received before dispatch; no second fallback', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'بدي أعرف أكثر', { ageMs: 0 });
    let b;
    let c;
    shift.processShiftBatch.mockImplementation(async (business, conversation, batch, { now }) => {
      b = seedInbound(conv, 'عن الحجوزات', { ageMs: 0 });
      c = seedInbound(conv, 'وكمان الأسعار', { ageMs: 0 });
      return toWorkflowResult(null, { business, conversation, batchMessages: batch, now });
    });

    const r = await batcher.runBatch(conv.id);
    await jest.advanceTimersByTimeAsync(100);
    await settle();

    expect(r.outcome).toBe('fallback');
    expect(shift.processShiftBatch).toHaveBeenCalledTimes(1);
    expect(botOutbound(conv)).toHaveLength(1);
    expect(botOutbound(conv)[0].raw_payload.batch_ids).toEqual([a.id, b.id, c.id]);
    expect([a, b, c].map((m) => row(m.id).status)).toEqual(['answered', 'answered', 'answered']);
    expect(batcher.hasPendingTimer(conv.id)).toBe(false);
  });
});

describe('GPT-6 #12: capture acks from what was persisted (D26)', () => {
  const acks = require('../src/workflows/shift/acks');
  const leadModule = require('../src/workflows/shift/lead');
  const captureAi = { reply: 'تمام.', action: 'CAPTURE_TIME', action_args: { time_text: 'الساعة 5' }, lead: {} };

  function seedLead() {
    const { biz, conv } = seedShift({
      conversation: { current_state: 'close', workflow_data: { lead: { name: 'محمد', business_name: 'زيتون', version: 1 }, bot_turns: 2 } },
    });
    const a = seedInbound(conv, 'خليها الساعة 5');
    return { biz, conv, a };
  }

  test('staff set the call time while the model generated → «passed to the team», staff time kept, request stored', async () => {
    const { biz, conv } = seedLead();
    shift.processShiftBatch.mockImplementation(async (business, conversation, batch, { now }) => {
      await leadModule.saveLead(conv.id, { preferred_time: 'بكرا الساعة 10' }, { source: 'staff', msgId: null, at: now.toISOString(), inboundText: '' });
      // The result was computed from the conversation as read before the staff edit.
      return toWorkflowResult(captureAi, { business: biz, conversation, batchMessages: batch, now });
    });

    expect((await batcher.runBatch(conv.id)).outcome).toBe('sent');

    const text = whatsapp.sendText.mock.calls[0][3];
    expect(text).toContain(acks.captureRelayed({ when: 'الساعة 5', lang: 'ar' }));
    expect(text).not.toContain('سجّلت طلب مكالمة');
    const wd = convRow(conv.id).workflow_data;
    expect(wd.lead.preferred_time.text).toBe('بكرا الساعة 10');
    expect(wd.requested_time_change).toMatchObject({ text: 'الساعة 5' });
  });

  test('a lead save that fails aborts the capture ack: nothing sent, rows stay `received`, failure counted', async () => {
    const { conv, a } = seedLead();
    shift.processShiftBatch.mockImplementation(async (business, conversation, batch, { now }) => (
      toWorkflowResult(captureAi, { business, conversation, batchMessages: batch, now })));
    jest.spyOn(leadModule, 'saveLead').mockResolvedValue({ ok: false, lead: null, changed: [] });

    expect((await batcher.runBatch(conv.id)).outcome).toBe('failed');
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(row(a.id).status).toBe('received');
    expect(convRow(conv.id).metadata.reply_failures).toBe(1);
  });
});

describe('GPT-6 #7 re-verification: a status that races the POST (D19)', () => {
  const MIN = 60 * 1000;
  const later = (ms) => new Date(Date.now() + ms);
  const statusEntry = (status) => ({ changes: [{ value: { metadata: { phone_number_id: 'pnid_shift' }, statuses: [status] } }] });
  const failedFor = (intentId, wamid = 'wamid.accepted') => statusEntry({
    id: wamid, status: 'failed', recipient_id: CUSTOMER, biz_opaque_callback_data: intentId, errors: [{ code: 131000 }],
  });
  afterEach(() => batcher.cancelAll());

  test('`failed` processed while the POST is in flight → its wamid does not make it `sent`; rows requeued, a new send answers', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    whatsapp.sendText.mockImplementationOnce(async (pnid, token, to, text, { callbackData }) => {
      await processInboundMessage(failedFor(callbackData));
      return { ...okSend(), id: 'wamid.accepted' };
    });

    expect((await batcher.runBatch(conv.id)).outcome).toBe('failed');
    batcher.cancelAll();
    const [first] = botOutbound(conv);
    expect(first).toMatchObject({ status: 'failed', meta_message_id: 'wamid.accepted' });
    expect(first.raw_payload.settled).toBe('requeued');
    expect(row(a.id).status).toBe('received');

    expect((await batcher.runBatch(conv.id)).outcome).toBe('sent');
    expect(row(a.id).status).toBe('answered');
    expect(botOutbound(conv).map((m) => m.status)).toEqual(['failed', 'sent']);
  });

  test('`failed` processed after the wamid was recorded but before the commit → the rows take its requeue', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    const real = db.prisma.message.updateMany;
    let injected = false;
    jest.spyOn(db.prisma.message, 'updateMany').mockImplementation(async (args) => {
      if (!injected && args && args.data && args.data.status === 'answered') {
        injected = true;
        const [intent] = botOutbound(conv);
        expect(intent.status).toBe('sent');
        await processInboundMessage(failedFor(intent.id, intent.meta_message_id));
      }
      return real.call(db.prisma.message, args);
    });

    await batcher.runBatch(conv.id);

    expect(injected).toBe(true);
    const [intent] = botOutbound(conv);
    expect(intent.status).toBe('failed');
    expect(intent.raw_payload.settled).toBe('requeued');
    expect(row(a.id).status).toBe('received');
  });

  test('a second failure for the requeued batch arriving mid-POST → awaiting_staff + unsent_reply, not answered', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    whatsapp.sendText.mockImplementation(async (pnid, token, to, text, { callbackData }) => {
      await processInboundMessage(failedFor(callbackData, `wamid.acc${callbackData}`));
      return { ...okSend(), id: `wamid.acc${callbackData}` };
    });

    await batcher.runBatch(conv.id);
    batcher.cancelAll();
    await batcher.runBatch(conv.id);
    await settle();

    expect(row(a.id).status).toBe('awaiting_staff');
    expect(botOutbound(conv).map((m) => [m.status, m.raw_payload.settled])).toEqual([['failed', 'requeued'], ['failed', 'escalated']]);
    expect(convRow(conv.id)).toMatchObject({ status: 'pending', workflow_data: { needs_team: { reason: 'unsent_reply' } } });
    expect(alertReasons()).toContain('unsent_reply');
  });

  test('`delivered` echoed while the POST is in flight stays `delivered` (never regresses to sent)', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    whatsapp.sendText.mockImplementationOnce(async (pnid, token, to, text, { callbackData }) => {
      await processInboundMessage(statusEntry({ id: 'wamid.echo', status: 'delivered', recipient_id: CUSTOMER, biz_opaque_callback_data: callbackData }));
      return { ...okSend(), id: 'wamid.echo' };
    });

    expect((await batcher.runBatch(conv.id)).outcome).toBe('sent');
    expect(botOutbound(conv)[0]).toMatchObject({ status: 'delivered', meta_message_id: 'wamid.echo' });
    expect(row(a.id).status).toBe('answered');
  });

  test('an echoed `sent` beats an ambiguous POST result → the part is confirmed, rows answered', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    whatsapp.sendText.mockImplementationOnce(async (pnid, token, to, text, { callbackData }) => {
      await processInboundMessage(statusEntry({ id: 'wamid.echo', status: 'sent', recipient_id: CUSTOMER, biz_opaque_callback_data: callbackData }));
      return failSend('ambiguous');
    });

    expect((await batcher.runBatch(conv.id)).outcome).toBe('sent');
    expect(botOutbound(conv)[0]).toMatchObject({ status: 'sent', meta_message_id: 'wamid.echo' });
    expect(row(a.id).status).toBe('answered');
  });

  test('refused before Graph after another worker marked the intent ambiguous → cancelled, rows back to received at once', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');
    const realCheck = db.jsonb.preSendCheck;
    jest.spyOn(db.jsonb, 'preSendCheck').mockImplementationOnce(async (...args) => {
      // Worker B took the expired lease; its recoverCovered flipped this `sending` intent and parked the row.
      const [intent] = botOutbound(conv);
      intent.status = 'ambiguous';
      row(a.id).status = 'unconfirmed';
      convRow(conv.id).metadata = { ...convRow(conv.id).metadata, lease_token: 'worker_b', reply_lease_until: new Date(Date.now() + 60000).toISOString() };
      return realCheck(...args);
    });

    expect(await batcher.runBatch(conv.id)).toEqual({ outcome: 'lease_lost', sent: 0 });
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(botOutbound(conv).map((m) => m.status)).toEqual(['cancelled']);
    expect(row(a.id).status).toBe('received');
    expect(batcher.hasPendingTimer(conv.id)).toBe(true);
    batcher.cancelAll();

    // Worker B is done; the next run answers without waiting for reconcile or spending the retry budget.
    const meta = { ...convRow(conv.id).metadata };
    delete meta.lease_token;
    delete meta.reply_lease_until;
    convRow(conv.id).metadata = meta;
    expect((await batcher.runBatch(conv.id)).outcome).toBe('sent');
    expect(row(a.id).status).toBe('answered');
    expect(await batcher.reconcileUnconfirmedIntents({ now: later(3 * MIN) })).toMatchObject({ requeued: 0, escalated: 0, unreconciled: 0 });
  });

  test('an opt-out ack unconfirmed twice is dropped: row skipped, no team request, not pending, ambiguous_send alert', async () => {
    whatsapp.sendText.mockImplementation(async () => failSend('ambiguous'));
    const { conv } = seedShift();
    const stop = seedInbound(conv, 'إيقاف');

    await batcher.runBatch(conv.id);
    expect(row(stop.id).status).toBe('unconfirmed');
    expect(await batcher.reconcileUnconfirmedIntents({ now: later(3 * MIN) })).toMatchObject({ requeued: 1 });
    batcher.cancelAll();
    await batcher.runBatch(conv.id);
    expect(row(stop.id).status).toBe('unconfirmed');

    const report = await batcher.reconcileUnconfirmedIntents({ now: later(6 * MIN) });
    await settle();

    expect(report).toMatchObject({ requeued: 0, escalated: 0, unreconciled: 1 });
    expect(row(stop.id).status).toBe('skipped');
    const c = convRow(conv.id);
    expect(c.status).not.toBe('pending');
    expect(c.workflow_data.needs_team).toBeUndefined();
    expect(typeof c.workflow_data.marketing_opted_out_at).toBe('string');
    expect(alertReasons()).toEqual(['ambiguous_send']);
    expect(whatsapp.sendText).toHaveBeenCalledTimes(2);
    expect(botOutbound(conv).map((m) => m.raw_payload.settled)).toEqual(['requeued', 'dropped']);
  });
});

describe('GPT-6 #13 re-verification: a team request and its pending status are one write (D27)', () => {
  const { needsTeamEntry } = require('../src/workflows/shift/results');
  const OLD_AT = '2026-09-15T08:00:00.000Z';

  function seedQuotePending() {
    const oldReq = needsTeamEntry('quote', 'سعر', OLD_AT);
    const { biz, conv } = seedShift({ conversation: { status: 'pending', workflow_data: { needs_team: oldReq } } });
    const a = seedInbound(conv, 'بدي احكي مع حدا');
    return { biz, conv, a, oldReq };
  }
  function handoff(newReq) {
    return {
      kind: 'handoff', action: 'HANDOFF_TO_HUMAN', messages: [{ type: 'text', text: 'وصلت طلبك للفريق' }],
      stateUpdate: { status: 'pending', current_state: 'handoff' }, workflowDataPatch: { needs_team: newReq, bot_turns: 1 },
      needsTeam: newReq, needsTeamCandidate: newReq, alert: null,
    };
  }
  const resolveOld = (conv, oldReq) => db.jsonb.resolveNeedsTeam(conv.id, { match: { reason: oldReq.reason, at: oldReq.at }, resolvedAt: new Date().toISOString() });

  test('staff resolve the old request just before the bot writes → the new request is recorded, pending', async () => {
    const { biz, conv, a, oldReq } = seedQuotePending();
    const newReq = needsTeamEntry('person', 'بدو شخص', new Date().toISOString());
    const real = db.jsonb.writeConversationState;
    jest.spyOn(db.jsonb, 'writeConversationState').mockImplementation(async (...args) => {
      expect(await resolveOld(conv, oldReq)).toBe(true);
      return real(...args);
    });

    const r = await batcher.deliverResult({ business: biz, conversation: convRow(conv.id), result: handoff(newReq), batch: [a], now: new Date() });

    expect(r.outcome).toBe('sent');
    const c = convRow(conv.id);
    expect(c.workflow_data.needs_team).toMatchObject({ reason: 'person', at: newReq.at, resolved_at: null });
    expect(c).toMatchObject({ status: 'pending', current_state: 'handoff' });
    expect(c.workflow_data.bot_turns).toBe(1);
  });

  test('staff resolve the old request right after the bot writes → the resolve no longer matches, pending stays', async () => {
    const { biz, conv, a, oldReq } = seedQuotePending();
    const newReq = needsTeamEntry('person', 'بدو شخص', new Date().toISOString());
    const real = db.jsonb.writeConversationState;
    let resolved = null;
    jest.spyOn(db.jsonb, 'writeConversationState').mockImplementation(async (...args) => {
      const out = await real(...args);
      resolved = await resolveOld(conv, oldReq);
      return out;
    });

    await batcher.deliverResult({ business: biz, conversation: convRow(conv.id), result: handoff(newReq), batch: [a], now: new Date() });

    expect(resolved).toBe(false);
    const c = convRow(conv.id);
    expect(c.workflow_data.needs_team).toMatchObject({ reason: 'person', resolved_at: null });
    expect(c.status).toBe('pending');
  });

  test('stale copy: an equal-priority request staff resolved while the model generated → the new one is recorded', async () => {
    const { biz, conv, a, oldReq } = seedQuotePending();
    const now = new Date();
    // Computed from the conversation as read before the model call: the quote is still open there, so
    // the new quote request is "already on the list" (no needs_team in the patch).
    const result = toWorkflowResult(
      { reply: 'أكيد، بنبعتلك عرض مفصّل', action: 'FLAG_FOR_TEAM', action_args: { reason: 'quote', summary: 'عرض لفرعين' } },
      { business: biz, conversation: { ...convRow(conv.id) }, batchMessages: [a], now },
    );
    expect(result.needsTeam).toBeNull();
    expect(await resolveOld(conv, oldReq)).toBe(true);
    expect(convRow(conv.id).status).toBe('open');

    await batcher.deliverResult({ business: biz, conversation: convRow(conv.id), result, batch: [a], now });

    const c = convRow(conv.id);
    expect(c.status).toBe('pending');
    expect(c.workflow_data.needs_team).toMatchObject({ reason: 'quote', summary: 'عرض لفرعين', at: now.toISOString(), resolved_at: null });
  });

  test('an equal-priority request still open at write time is kept as it is (its SLA claim fields too)', async () => {
    const { biz, conv, a, oldReq } = seedQuotePending();
    convRow(conv.id).workflow_data.needs_team.sla_note_attempt = 1;
    const result = toWorkflowResult(
      { reply: 'أكيد', action: 'FLAG_FOR_TEAM', action_args: { reason: 'quote', summary: 'ثاني' } },
      { business: biz, conversation: { ...convRow(conv.id) }, batchMessages: [a], now: new Date() },
    );

    await batcher.deliverResult({ business: biz, conversation: convRow(conv.id), result, batch: [a], now: new Date() });

    expect(convRow(conv.id).workflow_data.needs_team).toMatchObject({ reason: 'quote', at: oldReq.at, summary: 'سعر', sla_note_attempt: 1 });
    expect(convRow(conv.id).status).toBe('pending');
  });

  test('a staff claim made before the write → nothing written, nothing sent, rows awaiting_staff', async () => {
    const { biz, conv, a } = seedQuotePending();
    convRow(conv.id).status = 'human_takeover';
    convRow(conv.id).ai_enabled = false;
    const newReq = needsTeamEntry('person', 'بدو شخص', new Date().toISOString());

    const r = await batcher.deliverResult({ business: biz, conversation: convRow(conv.id), result: handoff(newReq), batch: [a], now: new Date() });

    expect(r.outcome).toBe('awaiting_staff');
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(convRow(conv.id).workflow_data.needs_team.reason).toBe('quote');
    expect(convRow(conv.id).status).toBe('human_takeover');
    expect(row(a.id).status).toBe('awaiting_staff');
  });
});

describe('messageProcessor with the SHIFT number', () => {
  function entryFor(pnid, waMsg) {
    return {
      changes: [{
        value: {
          metadata: { phone_number_id: pnid },
          contacts: [{ wa_id: waMsg.from || CUSTOMER, profile: { name: 'محمد' } }],
          messages: [{ from: CUSTOMER, timestamp: '1', ...waMsg }],
        },
      }],
    };
  }

  function seedBusiness(fields = {}) {
    return db.seed({
      businesses: [{
        business_type: 'shift', status: 'active', wa_phone_number_id: 'pnid_shift', wa_access_token: 'plain_test_token',
        ai_config: {}, ...fields,
      }],
    }).businesses[0];
  }

  const inboundRows = () => db.store.messages.filter((m) => m.direction === 'inbound');

  test('persistInbound saves SHIFT rows as received with counters; retries are idempotent', async () => {
    seedBusiness();
    const entry = entryFor('pnid_shift', { id: 'wamid.p1', type: 'text', text: { body: 'مرحبا' } });

    const first = await persistInbound(entry);
    expect(first.items).toHaveLength(1);
    expect(first.items[0].created).toBe(true);
    expect(first.items[0].message.status).toBe('received');
    expect(first.items[0].conversation.unread_count).toBe(1);
    expect(first.items[0].conversation.last_inbound_at).toBeInstanceOf(Date);

    const retry = await persistInbound(entry);
    expect(retry.items[0].created).toBe(false);
    expect(inboundRows()).toHaveLength(1);
    expect(db.store.conversations).toHaveLength(1);
    expect(db.store.conversations[0].unread_count).toBe(1);
  });

  test('persistInbound saves restaurant and external-mode SHIFT rows as processing; delivered once handled (D24)', async () => {
    seedBusiness({ business_type: 'restaurant', wa_phone_number_id: 'pnid_rest' });
    seedBusiness({ wa_phone_number_id: 'pnid_ext', ai_config: { reply_mode: 'external' } });
    await persistInbound(entryFor('pnid_rest', { id: 'wamid.r1', type: 'text', text: { body: 'hi' } }));
    const ext = entryFor('pnid_ext', { id: 'wamid.e1', type: 'text', text: { body: 'hi' } });
    const persisted = await persistInbound(ext);
    // Until the forward/workflow ran, a crash leaves them visible to reprocessStuckInbound.
    expect(inboundRows().map((m) => m.status)).toEqual(['processing', 'processing']);

    await processInboundMessage(ext, { persisted });
    expect(inboundRows().map((m) => m.status)).toEqual(['processing', 'delivered']);
  });

  test('persistInbound throws on a DB error (the webhook answers 500)', async () => {
    seedBusiness();
    db.failNext('message.create', Object.assign(new Error('db down'), { code: 'P1001' }));
    await expect(persistInbound(entryFor('pnid_shift', { id: 'wamid.x', type: 'text', text: { body: 'مرحبا' } })))
      .rejects.toThrow('db down');
  });

  test('a text message is marked read, queued for the batcher, and not answered inline', async () => {
    seedBusiness();
    const entry = entryFor('pnid_shift', { id: 'wamid.t1', type: 'text', text: { body: 'مرحبا' } });
    const persisted = await persistInbound(entry);
    await processInboundMessage(entry, { persisted });

    const conv = db.store.conversations[0];
    expect(whatsapp.markAsRead).toHaveBeenCalledWith('pnid_shift', 'plain_test_token', 'wamid.t1', { typing: true });
    expect(batcher.hasPendingTimer(conv.id)).toBe(true);
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(inboundRows()[0].status).toBe('received');
  });

  test('an opt-out command is answered at once, queued rows are skipped, the timer is cancelled', async () => {
    seedBusiness();
    const hello = entryFor('pnid_shift', { id: 'wamid.o1', type: 'text', text: { body: 'مرحبا' } });
    await processInboundMessage(hello, { persisted: await persistInbound(hello) });
    const conv = db.store.conversations[0];
    expect(batcher.hasPendingTimer(conv.id)).toBe(true);

    const stop = entryFor('pnid_shift', { id: 'wamid.o2', type: 'text', text: { body: 'إيقاف' } });
    await processInboundMessage(stop, { persisted: await persistInbound(stop) });

    expect(batcher.hasPendingTimer(conv.id)).toBe(false);
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendText.mock.calls[0][3]).toBe('تمام، أوقفت المتابعة. إذا احتجتنا إحنا هون.');
    expect(inboundRows().map((m) => m.status)).toEqual(['skipped', 'skipped']);
    const c = convRow(conv.id);
    expect(typeof c.workflow_data.marketing_opted_out_at).toBe('string');
    expect(c.current_state).toBe('closed');
  });

  test('a SHIFT button tap is answered deterministically with state saved first', async () => {
    seedBusiness();
    const tap = entryFor('pnid_shift', {
      id: 'wamid.b1', type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'slot:other', title: 'وقت ثاني' } },
    });
    await processInboundMessage(tap, { persisted: await persistInbound(tap) });

    const conv = db.store.conversations[0];
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendText.mock.calls[0][3]).toBe('تمام — أي يوم وساعة بتريحك؟');
    expect(convRow(conv.id).workflow_data.capture_pending).toMatchObject({ slot_id: 'other' });
    expect(inboundRows()[0].status).toBe('answered');
    expect(botOutbound(conv)[0].raw_payload.kind).toBe('button');
    expect(batcher.hasPendingTimer(conv.id)).toBe(false);
  });

  test('an unsupported message (view-once media) is queued for a reply, not skipped', async () => {
    seedBusiness();
    const entry = entryFor('pnid_shift', { id: 'wamid.u1', type: 'unsupported', errors: [{ code: 131051 }] });
    await processInboundMessage(entry, { persisted: await persistInbound(entry) });
    expect(inboundRows()[0].status).toBe('received');
    expect(batcher.hasPendingTimer(db.store.conversations[0].id)).toBe(true);
  });

  test('a media caption is saved as the text body for SHIFT only', async () => {
    seedBusiness();
    seedBusiness({ business_type: 'restaurant', wa_phone_number_id: 'pnid_rest' });
    const image = { type: 'image', image: { id: 'media1', mime_type: 'image/jpeg', caption: 'هاد نظامنا الحالي، بتقدروا تربطوا عليه؟' } };
    await persistInbound(entryFor('pnid_shift', { id: 'wamid.c1', ...image }));
    await persistInbound(entryFor('pnid_rest', { id: 'wamid.c2', ...image }));
    expect(inboundRows().map((m) => m.text_body)).toEqual(['هاد نظامنا الحالي، بتقدروا تربطوا عليه؟', null]);
  });

  test('no typing indicator when the bot will not answer: save-only mode or a staff-held conversation', async () => {
    process.env.SHIFT_BOT_LIVE = '0';
    seedBusiness();
    const gated = entryFor('pnid_shift', { id: 'wamid.ty1', type: 'text', text: { body: 'مرحبا' } });
    await processInboundMessage(gated, { persisted: await persistInbound(gated) });
    expect(whatsapp.markAsRead).toHaveBeenLastCalledWith('pnid_shift', 'plain_test_token', 'wamid.ty1', { typing: false });

    delete process.env.SHIFT_BOT_LIVE;
    db.store.conversations[0].status = 'human_takeover';
    const held = entryFor('pnid_shift', { id: 'wamid.ty2', type: 'text', text: { body: 'في حدا؟' } });
    await processInboundMessage(held, { persisted: await persistInbound(held) });
    expect(whatsapp.markAsRead).toHaveBeenLastCalledWith('pnid_shift', 'plain_test_token', 'wamid.ty2', { typing: false });
  });

  test('a persist whose counter update failed keeps nothing; the retry saves, counts and processes it once (D24)', async () => {
    seedBusiness();
    const entry = entryFor('pnid_shift', { id: 'wamid.h1', type: 'text', text: { body: 'مرحبا' } });
    db.failNext('conversation.update', Object.assign(new Error('transient'), { code: 'P1001' }));

    const err = await persistInbound(entry).catch((e) => e);
    expect(err.message).toBe('transient');
    expect(err.persisted.items).toEqual([]);
    // One transaction: the insert was rolled back with the counters, so Meta's retry is not a duplicate.
    expect(inboundRows()).toHaveLength(0);

    const retry = await persistInbound(entry);
    expect(retry.items[0]).toMatchObject({ created: true, claimed: true });
    expect(db.store.conversations[0].unread_count).toBe(1);
    await processInboundMessage(entry, { persisted: retry });
    expect(batcher.hasPendingTimer(db.store.conversations[0].id)).toBe(true);

    // A later duplicate of a completed persist is not processed again.
    batcher.cancelAll();
    const dup = await persistInbound(entry);
    expect(dup.items[0]).toMatchObject({ created: false, claimed: false });
    expect(db.store.conversations[0].unread_count).toBe(1);
  });

  test('a failure on one message still hands back the messages saved before it', async () => {
    seedBusiness();
    const entry = {
      changes: [{
        value: {
          metadata: { phone_number_id: 'pnid_shift' },
          contacts: [{ wa_id: CUSTOMER, profile: { name: 'محمد' } }],
          messages: [
            { from: CUSTOMER, id: 'wamid.m1', type: 'text', text: { body: 'مرحبا' } },
            { from: CUSTOMER, id: 'wamid.m2', type: 'text', text: { body: 'عندي عيادة' } },
          ],
        },
      }],
    };
    const realCreate = db.prisma.message.create;
    let calls = 0;
    jest.spyOn(db.prisma.message, 'create').mockImplementation(async (args) => {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error('db down'), { code: 'P1001' });
      return realCreate(args);
    });
    const err = await persistInbound(entry).catch((e) => e);
    expect(err.persisted.items.map((i) => i.waMsg.id)).toEqual(['wamid.m1']);
  });

  test('a status is not attached to an old ambiguous row while a newer send still waits for its wamid', async () => {
    const biz = seedBusiness();
    const [conv] = db.seed({ conversations: [{ business_id: biz.id, customer_wa_id: CUSTOMER, last_inbound_at: new Date() }] }).conversations;
    const [amb] = db.seed({
      messages: [{
        business_id: biz.id, conversation_id: conv.id, direction: 'outbound', status: 'ambiguous',
        raw_payload: { kind: 'reply' }, created_at: new Date(Date.now() - 60000),
      }],
    }).messages;
    db.seed({
      messages: [{ business_id: biz.id, conversation_id: conv.id, direction: 'outbound', status: 'sending', raw_payload: { kind: 'reply' } }],
    });
    const statusEntry = (status) => ({ changes: [{ value: { metadata: { phone_number_id: 'pnid_shift' }, statuses: [status] } }] });

    await processInboundMessage(statusEntry({ id: 'wamid.newer', status: 'sent', recipient_id: CUSTOMER }));
    expect(row(amb.id)).toMatchObject({ meta_message_id: null, status: 'ambiguous' });

    // Nor a status stamped long after the ambiguous send.
    const sendingRow = db.store.messages.find((m) => m.status === 'sending');
    sendingRow.status = 'sent';
    sendingRow.meta_message_id = 'wamid.known';
    await processInboundMessage(statusEntry({
      id: 'wamid.later', status: 'sent', recipient_id: CUSTOMER, timestamp: String(Math.floor((Date.now() + 10 * 60000) / 1000)),
    }));
    expect(row(amb.id).status).toBe('ambiguous');
  });

  test('a button tap while staff is active → awaiting_staff, no reply', async () => {
    seedBusiness();
    db.seed({
      conversations: [{
        business_id: db.store.businesses[0].id, customer_wa_id: CUSTOMER, status: 'human_takeover', ai_enabled: false,
      }],
    });
    const tap = entryFor('pnid_shift', {
      id: 'wamid.b2', type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'lead_talk', title: 'احكي مع الفريق' } },
    });
    await processInboundMessage(tap, { persisted: await persistInbound(tap) });
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(inboundRows()[0].status).toBe('awaiting_staff');
  });

  test('SHIFT_BOT_LIVE=0 → a non-test number is saved as skipped and never queued', async () => {
    process.env.SHIFT_BOT_LIVE = '0';
    seedBusiness();
    const entry = entryFor('pnid_shift', { id: 'wamid.g1', type: 'text', text: { body: 'مرحبا' } });
    await processInboundMessage(entry, { persisted: await persistInbound(entry) });
    expect(inboundRows()[0].status).toBe('skipped');
    expect(batcher.hasPendingTimer(db.store.conversations[0].id)).toBe(false);
  });

  test('a reaction is skipped; a referral is saved as an inferred ctwa source', async () => {
    seedBusiness();
    const reaction = entryFor('pnid_shift', { id: 'wamid.rx', type: 'reaction', reaction: { emoji: '👍', message_id: 'wamid.x' } });
    await processInboundMessage(reaction, { persisted: await persistInbound(reaction) });
    expect(inboundRows()[0].status).toBe('skipped');

    const ad = entryFor('pnid_shift', {
      id: 'wamid.ad', type: 'text', text: { body: 'مرحبا، شفت الإعلان' },
      referral: { source_url: 'https://fb.me/x', source_type: 'ad', source_id: '123', headline: 'كرم', ctwa_clid: 'clid', extra: 'dropped' },
    });
    await processInboundMessage(ad, { persisted: await persistInbound(ad) });
    const lead = db.store.conversations[0].workflow_data.lead;
    expect(lead.source).toEqual({
      type: 'ctwa', confidence: 'inferred',
      referral: { source_url: 'https://fb.me/x', source_type: 'ad', source_id: '123', headline: 'كرم', ctwa_clid: 'clid' },
    });
    expect(lead._prov.source.confirmed).toBe(false);
  });

  test('a status webhook confirms an ambiguous send by its echoed callback id; billing failures raise the banner', async () => {
    const biz = seedBusiness();
    const [conv] = db.seed({ conversations: [{ business_id: biz.id, customer_wa_id: CUSTOMER, last_inbound_at: new Date() }] }).conversations;
    const [amb] = db.seed({
      messages: [{ business_id: biz.id, conversation_id: conv.id, direction: 'outbound', status: 'ambiguous', raw_payload: { kind: 'reply' } }],
    }).messages;

    const statusEntry = (status) => ({ changes: [{ value: { metadata: { phone_number_id: 'pnid_shift' }, statuses: [status] } }] });
    // D17: without the echoed id the recipient alone matches nothing.
    await processInboundMessage(statusEntry({ id: 'wamid.other', status: 'delivered', recipient_id: CUSTOMER }));
    expect(row(amb.id)).toMatchObject({ meta_message_id: null, status: 'ambiguous' });

    await processInboundMessage(statusEntry({ id: 'wamid.late', status: 'delivered', recipient_id: CUSTOMER, biz_opaque_callback_data: amb.id }));
    expect(row(amb.id)).toMatchObject({ meta_message_id: 'wamid.late', status: 'delivered' });

    await processInboundMessage(statusEntry({
      id: 'wamid.late', status: 'failed', recipient_id: CUSTOMER, errors: [{ code: 131042, title: 'Business eligibility payment issue' }],
    }));
    await settle();
    expect(row(amb.id).status).toBe('failed');
    expect(typeof convRow(conv.id).metadata.billing_blocked_at).toBe('string');
    expect(alertReasons()).toEqual(['billing']);
  });
});

// ─── PR2: structured parts, fallbacks, multi-part fencing, media (contract §10.2) ──

describe('PR2 parts through the intent protocol (§10.2)', () => {
  const assets = require('../src/workflows/shift/assets');
  const acksMod = require('../src/workflows/shift/acks');
  const roleplayMod = require('../src/workflows/shift/roleplay');
  const media = require('../src/workflows/shift/media');

  const partsResult = (messages, extra = {}) => textResult('x', { messages, ...extra });
  const lastArg = (args) => args[args.length - 1];

  function tap(conv, id, title) {
    seq += 1;
    return db.seed({
      messages: [{
        business_id: conv.business_id, conversation_id: conv.id, direction: 'inbound', status: 'received',
        message_type: 'interactive', text_body: title, meta_message_id: `wamid.tap2_${seq}`,
        interactive_reply: { type: 'button_reply', button_reply: { id, title } }, created_at: new Date(),
      }],
    }).messages[0];
  }

  test('sample card → cta_url → follow-up: three intent rows, each written before its Graph call and sent as its callback data', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'أي أوريني');
    const card = assets.sampleCard('restaurant', 'ar', { roleplayOn: true });
    const page = assets.pagePart('restaurant', 'ar');
    // The follow-up's 1 s delay is covered by its own test below.
    const follow = { ...assets.pageFollowUp('restaurant', 'ar', { roleplayOn: true }), delayMs: 0 };
    shift.processShiftBatch.mockImplementation(async () => partsResult([card, page, follow]));
    const seen = [];
    const record = async (...args) => {
      const { callbackData } = lastArg(args);
      seen.push({ id: callbackData, status: row(callbackData) && row(callbackData).status, rows: botOutbound(conv).length });
      return okSend();
    };
    whatsapp.sendStructured.mockImplementation(record);
    whatsapp.sendText.mockImplementation(record);

    const r = await batcher.runBatch(conv.id);

    expect(r).toEqual({ outcome: 'sent', sent: 3 });
    const intents = botOutbound(conv);
    expect(intents.map((m) => m.raw_payload.batch_key)).toEqual([`${a.id}:0`, `${a.id}:1`, `${a.id}:2`]);
    expect(seen).toEqual(intents.map((m, i) => ({ id: m.id, status: 'sending', rows: i + 1 })));
    expect(intents.map((m) => m.status)).toEqual(['sent', 'sent', 'sent']);
    // The image-header card and the CTA URL are PR2 shapes; the plain follow-up keeps PR1's sendText.
    expect(whatsapp.sendStructured.mock.calls.map((c) => c[3])).toEqual([card, page]);
    expect(whatsapp.sendText.mock.calls[0][3]).toBe(follow.text);
    expect(whatsapp.sendInteractiveButtons).not.toHaveBeenCalled();
    // §4.3 summaries and the raw_payload fields staff see; metadata is never stored.
    expect(intents[0]).toMatchObject({
      message_type: 'interactive',
      text_body: `[صورة] ${card.text}\n[جرّبه كزبون] [افتح صفحة المطاعم] [احكي مع الفريق]`,
    });
    expect(intents[0].raw_payload).toMatchObject({ part_type: 'interactive', image_link: card.header.image.link, buttons: card.buttons });
    expect(intents[1]).toMatchObject({ message_type: 'interactive', text_body: `${page.text}\n[${page.displayText}] ${page.url}` });
    expect(intents[1].raw_payload).toMatchObject({ part_type: 'cta_url', url: page.url });
    expect(intents[2]).toMatchObject({ message_type: 'text', text_body: follow.text });
    for (const m of intents) expect(JSON.stringify(m.raw_payload)).not.toMatch(/modelLine|"ack"|"fallback"|serverButtons|delayMs/);
    expect(row(a.id).status).toBe('answered');
  });

  test('list and image parts: summaries, rows and image link on the intent rows', async () => {
    const { conv } = seedShift();
    seedInbound(conv, 'مرحبا');
    const list = acksMod.sectorListPart('ar', {});
    const image = assets.imagePart('clinic', 'ar');
    const imageEn = assets.imagePart('store', 'en');
    shift.processShiftBatch.mockImplementation(async () => partsResult([list, image, imageEn]));

    await batcher.runBatch(conv.id);

    const [l, i, e] = botOutbound(conv);
    expect(l).toMatchObject({ message_type: 'interactive', text_body: `${list.text}\n[اختر القطاع]: عيادة · مطعم أو كافيه · متجر إلكتروني · نشاط آخر` });
    expect(l.raw_payload.rows.map((r) => r.id)).toEqual(['sector:clinic', 'sector:restaurant', 'sector:store', 'sector:other']);
    expect(i).toMatchObject({ message_type: 'image', text_body: `[صورة] ${image.text}` });
    expect(i.raw_payload).toMatchObject({ part_type: 'image', image_link: image.image.link });
    expect(e.text_body).toBe(`[image] ${imageEn.text}`);
    expect(whatsapp.sendStructured.mock.calls.map((c) => c[3].type)).toEqual(['list', 'image', 'image']);
  });

  test('an image header Graph rejects (400) → a `:fb` intent row and one send of the same buttons without the header', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'أي');
    const card = assets.sampleCard('clinic', 'ar', { roleplayOn: true });
    shift.processShiftBatch.mockImplementation(async () => partsResult([card]));
    whatsapp.sendStructured.mockReset()
      .mockImplementationOnce(async () => ({ ...failSend('rejected'), code: 131009, httpStatus: 400 }))
      .mockImplementationOnce(async () => okSend());

    const r = await batcher.runBatch(conv.id);

    expect(r).toEqual({ outcome: 'sent', sent: 1 });
    expect(whatsapp.sendStructured).toHaveBeenCalledTimes(2);
    const [first, second] = botOutbound(conv);
    expect(first).toMatchObject({ status: 'failed' });
    expect(first.raw_payload).toMatchObject({ batch_key: `${a.id}:0`, reason: 'rejected' });
    expect(second.raw_payload).toMatchObject({ batch_key: `${a.id}:0:fb`, fallback_of: first.id, batch_ids: [a.id] });
    expect(second.status).toBe('sent');
    expect(second.text_body.startsWith('[صورة]')).toBe(false);
    const [, , , sentPart, opts] = whatsapp.sendStructured.mock.calls[1];
    expect(sentPart.header).toBeUndefined();
    expect(sentPart.buttons).toEqual(card.buttons);
    expect(opts).toEqual({ callbackData: second.id });
    expect(row(a.id).status).toBe('answered');
  });

  test('an ambiguous first part → no fallback and no immediate retry (D18)', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'أي');
    shift.processShiftBatch.mockImplementation(async () => partsResult([assets.sampleCard('clinic', 'ar', { roleplayOn: true })]));
    whatsapp.sendStructured.mockImplementation(async () => failSend('ambiguous'));

    await batcher.runBatch(conv.id);

    expect(whatsapp.sendStructured).toHaveBeenCalledTimes(1);
    expect(botOutbound(conv).map((m) => m.status)).toEqual(['ambiguous']);
    expect(row(a.id).status).toBe('unconfirmed');
  });

  test('the fence fails before part 2 → one send, the rows are covered, part 2 is never created', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'بدي أشوف');
    shift.processShiftBatch.mockImplementation(async () => partsResult([{ type: 'text', text: 'الجزء الأول' }, { type: 'text', text: 'الجزء الثاني' }]));
    whatsapp.sendText.mockImplementation(async () => {
      // A staff claim lands between the two parts.
      Object.assign(convRow(conv.id), { status: 'human_takeover', ai_enabled: false });
      return okSend();
    });

    const r = await batcher.runBatch(conv.id);

    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ outcome: 'sent', sent: 1 });
    expect(botOutbound(conv).map((m) => m.text_body)).toEqual(['الجزء الأول']);
    expect(row(a.id).status).toBe('answered');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('part skipped after fence'));
  });

  test('a later part waits its delayMs before its pre-send check', async () => {
    const { conv } = seedShift();
    seedInbound(conv, 'تمام');
    shift.processShiftBatch.mockImplementation(async () => partsResult([{ type: 'text', text: 'أول' }, { type: 'text', text: 'ثاني', delayMs: 150 }]));
    const at = [];
    whatsapp.sendText.mockImplementation(async () => {
      at.push(Date.now());
      return okSend();
    });

    await batcher.runBatch(conv.id);

    expect(at).toHaveLength(2);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(140);
  });

  test('at most three parts of the five known types are sent', async () => {
    const { conv } = seedShift();
    seedInbound(conv, 'تمام');
    shift.processShiftBatch.mockImplementation(async () => partsResult([
      { type: 'video', text: 'غير معروف' },
      { type: 'text', text: 'واحد' },
      { type: 'text', text: '   ' },
      { type: 'text', text: 'اثنين' },
      { type: 'text', text: 'ثلاثة' },
      { type: 'text', text: 'أربعة' },
    ]));

    await batcher.runBatch(conv.id);

    expect(whatsapp.sendText.mock.calls.map((c) => c[3])).toEqual(['واحد', 'اثنين', 'ثلاثة']);
    expect(whatsapp.sendStructured).not.toHaveBeenCalled();
  });

  test('media enrichment runs only with SHIFT_MEDIA=1; its transcript is saved on the row and reaches the workflow', async () => {
    const spy = jest.spyOn(media, 'enrichBatch');
    const off = seedShift();
    seedInbound(off.conv, null, { message_type: 'audio', media_id: 'media-0', raw_payload: { id: 'wamid.v0', type: 'audio' } });
    await batcher.runBatch(off.conv.id);
    expect(spy).not.toHaveBeenCalled();

    process.env.SHIFT_MEDIA = '1';
    const { conv } = seedShift();
    const voice = seedInbound(conv, null, { message_type: 'audio', media_id: 'media-1', raw_payload: { id: 'wamid.v1', type: 'audio' } });
    const shiftMedia = { type: 'audio', text: 'عندي مطعم بإربد', status: 'ok', at: new Date().toISOString(), ms: 5 };
    spy.mockImplementation(async (business, token, batch) => ({
      batch: batch.map((m) => (m.id === voice.id ? { ...m, shift_media: shiftMedia } : m)),
      updates: [{ id: voice.id, shift_media: shiftMedia }],
    }));
    shift.processShiftBatch.mockClear();

    await batcher.runBatch(conv.id);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe('plain_test_token');
    expect(row(voice.id).raw_payload).toEqual({ id: 'wamid.v1', type: 'audio', shift_media: shiftMedia });
    expect(shift.processShiftBatch.mock.calls[0][2][0].shift_media).toEqual(shiftMedia);
    expect(row(voice.id).status).toBe('answered');
  });

  test('a skipped_reply result (role-play switched off, «خلص») sends nothing, applies its patch and answers the row', async () => {
    const { conv } = seedShift({
      conversation: { current_state: 'roleplay', workflow_data: { roleplay: { active: true, sector: 'restaurant', turns: 2 } } },
    });
    const a = seedInbound(conv, 'خلص');
    shift.processShiftBatch.mockImplementation(async () => ({
      kind: 'skipped_reply', action: 'END_ROLEPLAY', messages: [],
      stateUpdate: { current_state: 'close' },
      workflowDataPatch: { roleplay: { active: false, sector: 'restaurant', turns: 2, end_reason: 'disabled' }, nudge: null },
      leadPatch: null, leadMeta: null, needsTeam: null, alert: null,
    }));

    const r = await batcher.runBatch(conv.id);

    expect(r).toEqual({ outcome: 'skipped_reply', sent: 0 });
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(whatsapp.sendStructured).not.toHaveBeenCalled();
    expect(shift.toWorkflowResult).not.toHaveBeenCalled();
    expect(botOutbound(conv)).toHaveLength(0);
    expect(convRow(conv.id).current_state).toBe('close');
    expect(convRow(conv.id).workflow_data.roleplay).toMatchObject({ active: false, end_reason: 'disabled' });
    expect(row(a.id).status).toBe('answered');
  });

  test('«إيقاف» during a role-play ends the example (optout) and clears the planned nudge (§10.3)', async () => {
    const { conv } = seedShift({
      conversation: {
        current_state: 'roleplay',
        workflow_data: { roleplay: { active: true, sector: 'restaurant', turns: 2 }, nudge: { kind: 'stage', due_at: new Date().toISOString() } },
      },
    });
    seedInbound(conv, 'إيقاف');

    await batcher.runBatch(conv.id);

    const wd = convRow(conv.id).workflow_data;
    expect(wd.marketing_opted_out_at).toBeTruthy();
    expect(wd.roleplay).toMatchObject({ active: false, end_reason: 'optout', turns: 2 });
    expect(wd.nudge).toBeNull();
    expect(shift.processShiftBatch).not.toHaveBeenCalled();
  });

  test('a PR2 tap is answered with the tap\'s language and the role-play flag', async () => {
    const on = seedShift();
    tap(on.conv, 'sample_roleplay:clinic', 'Try it as a customer');
    await batcher.runBatch(on.conv.id);
    expect(whatsapp.sendText.mock.calls[0][3]).toBe(roleplayMod.setupAsk('clinic', 'en'));
    expect(convRow(on.conv.id).current_state).toBe('roleplay_setup');

    process.env.SHIFT_ROLEPLAY = '0';
    whatsapp.sendText.mockClear();
    const off = seedShift();
    tap(off.conv, 'sample_roleplay:clinic', 'Try it as a customer');
    await batcher.runBatch(off.conv.id);
    const [, , , pagePart] = whatsapp.sendStructured.mock.calls[0];
    expect(pagePart).toMatchObject({ type: 'cta_url' });
    expect(pagePart.url).toContain('/en/clinics');
    expect(shift.processShiftBatch).not.toHaveBeenCalled();
  });
});

// ─── Review round 1 ──────────────────────────────────────────────────────────

describe('review r1-7: "already sent" flags are only trusted when the send may have arrived', () => {
  const shiftAcks = require('../src/workflows/shift/acks');

  function tapRow(conv, id, title) {
    seq += 1;
    return db.seed({
      messages: [{
        business_id: conv.business_id, conversation_id: conv.id, direction: 'inbound', status: 'received',
        message_type: 'interactive', text_body: title, meta_message_id: `wamid.tap${seq}`,
        interactive_reply: { type: 'button_reply', button_reply: { id, title } }, created_at: new Date(),
      }],
    }).messages[0];
  }

  const failAll = () => {
    whatsapp.sendStructured.mockImplementation(async () => failSend('rate_limit', true));
    whatsapp.sendInteractiveButtons.mockImplementation(async () => failSend('rate_limit', true));
    whatsapp.sendText.mockImplementation(async () => failSend('rate_limit', true));
  };
  const okAll = () => {
    whatsapp.sendStructured.mockReset().mockImplementation(async () => okSend());
    whatsapp.sendInteractiveButtons.mockReset().mockImplementation(async () => okSend());
    whatsapp.sendText.mockReset().mockImplementation(async () => okSend());
  };

  test('send_sample_now: the card send fails → the rerun sends the card again, not «المثال وصلك فوق 👆»', async () => {
    const { conv } = seedShift({
      business: { ai_config: { samples_vetted: ['restaurant'] } },
      conversation: { current_state: 'fit', workflow_data: { lead: { sector: 'restaurant' } } },
    });
    const tap = tapRow(conv, 'send_sample_now', 'ابعت مثال');
    failAll();

    const first = await batcher.runBatch(conv.id);
    expect(first.outcome).toBe('failed');
    expect(row(tap.id).status).toBe('received');
    // State before send (D17): the flag is stored although nothing arrived.
    expect(convRow(conv.id).workflow_data.samples_sent.image).toBe('restaurant');

    okAll();
    await batcher.runBatch(conv.id);

    expect(whatsapp.sendText.mock.calls.map((c) => c[3])).not.toContain(shiftAcks.sampleAlreadySent('ar'));
    const [, , , card] = whatsapp.sendStructured.mock.calls[0];
    expect(card.header).toMatchObject({ type: 'image' });
    expect(row(tap.id).status).toBe('answered');
    expect(convRow(conv.id).workflow_data.samples_sent.image).toBe('restaurant');
  });

  test('a card that arrived keeps the pointer on a second tap', async () => {
    const { conv } = seedShift({
      business: { ai_config: { samples_vetted: ['restaurant'] } },
      conversation: { current_state: 'fit', workflow_data: { lead: { sector: 'restaurant' } } },
    });
    tapRow(conv, 'send_sample_now', 'ابعت مثال');
    await batcher.runBatch(conv.id);
    expect(whatsapp.sendStructured).toHaveBeenCalledTimes(1);

    tapRow(conv, 'send_sample_now', 'ابعت مثال');
    await batcher.runBatch(conv.id);
    expect(whatsapp.sendStructured).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendText.mock.calls.map((c) => c[3])).toContain(shiftAcks.sampleAlreadySent('ar'));
  });

  test('deliveredView withdraws only on evidence: flags with no intent rows at all are kept', async () => {
    const { conv } = seedShift({
      conversation: {
        workflow_data: {
          samples_sent: { image: 'clinic' }, disclosed_at: new Date().toISOString(),
          roleplay: { active: true, sector: 'clinic', business_name: 'عيادة', started_at: new Date().toISOString() },
        },
      },
    });
    const view = await batcher.deliveredView(convRow(conv.id));
    expect(view.workflow_data.samples_sent.image).toBe('clinic');
    expect(view.workflow_data.disclosed_at).toBeTruthy();
    expect(view.workflow_data.roleplay.start_undelivered).toBeUndefined();
  });

  test('minor: an English [No] tap with no stored language is answered in English', async () => {
    const { conv } = seedShift({ conversation: { current_state: 'close', workflow_data: { lead: { sector: 'store' } } } });
    tapRow(conv, 'followup_no', 'No');

    await batcher.runBatch(conv.id);

    expect(whatsapp.sendText.mock.calls[0][3]).toBe(shiftAcks.consentNo('en'));
  });
});

describe('review round 2 (batcher)', () => {
  const assets = require('../src/workflows/shift/assets');
  const roleplayMod = require('../src/workflows/shift/roleplay');
  const statusEntry = (status) => ({ changes: [{ value: { metadata: { phone_number_id: 'pnid_shift' }, statuses: [status] } }] });
  const failedStatus = (intent, code = 131053) => statusEntry({
    id: intent.meta_message_id, status: 'failed', recipient_id: CUSTOMER, biz_opaque_callback_data: intent.id,
    errors: [{ code, title: 'Media upload error' }],
  });
  const headerless = () => whatsapp.sendStructured.mock.calls.map((c) => c[3]).filter((p) => p.type === 'interactive' && !p.header);

  describe('r2 #8: an image Graph accepted and then failed to fetch still gets its header-less fallback', () => {
    test('card only: 200, then a failed 131053 status → the fallback goes out as its own intent; the row stays answered', async () => {
      const { conv } = seedShift();
      const a = seedInbound(conv, 'ابعت مثال');
      const card = assets.sampleCard('clinic', 'ar', { roleplayOn: true });
      shift.processShiftBatch.mockImplementation(async () => textResult('x', { messages: [card] }));

      expect((await batcher.runBatch(conv.id)).outcome).toBe('sent');
      const [first] = botOutbound(conv);
      expect(first.raw_payload.fallback_part).toEqual({ type: 'interactive', text: card.text, footer: card.footer, buttons: card.buttons });

      await processInboundMessage(failedStatus(first));
      batcher.cancelAll();

      expect(headerless()).toHaveLength(1);
      expect(headerless()[0]).toMatchObject({ text: card.text, footer: card.footer, buttons: card.buttons });
      const fb = botOutbound(conv).find((m) => m.id !== first.id);
      expect(fb.raw_payload).toMatchObject({ fallback_of: first.id, batch_key: `${first.raw_payload.batch_key}:fb:0` });
      expect(fb.raw_payload.fallback_part).toBeUndefined();
      expect(row(first.id).status).toBe('failed');
      expect(row(a.id).status).toBe('answered');
      expect(alertReasons()).not.toContain('unsent_reply');

      // A repeated webhook for the same failure sends nothing more.
      await processInboundMessage(failedStatus({ ...first, status: 'sent' }));
      expect(headerless()).toHaveLength(1);
    });

    test('[line, card]: the card fails after acceptance → the fallback is sent, not lost as «covered»', async () => {
      const { conv } = seedShift();
      seedInbound(conv, 'بدي أشوف مثال');
      const card = assets.sampleCard('restaurant', 'ar', { roleplayOn: true });
      shift.processShiftBatch.mockImplementation(async () => textResult('x', { messages: [{ type: 'text', text: 'هاي مثال:' }, card] }));

      await batcher.runBatch(conv.id);
      const cardIntent = botOutbound(conv).find((m) => m.raw_payload.part_index === 1);
      await processInboundMessage(failedStatus(cardIntent));
      batcher.cancelAll();

      expect(headerless()).toHaveLength(1);
      expect(row(cardIntent.id).status).toBe('failed');
    });

    test('a failure a header-less resend cannot fix (131047, window) takes the normal D19 path', async () => {
      const { conv } = seedShift();
      const a = seedInbound(conv, 'ابعت مثال');
      shift.processShiftBatch.mockImplementation(async () => textResult('x', { messages: [assets.sampleCard('clinic', 'ar', { roleplayOn: true })] }));

      await batcher.runBatch(conv.id);
      const [first] = botOutbound(conv);
      await processInboundMessage(failedStatus(first, 131047));
      batcher.cancelAll();

      expect(headerless()).toHaveLength(0);
      expect(row(a.id).status).toBe('received');
    });
  });

  test('minor: a delayed follow-up is not sent when the part it hangs on failed for good', async () => {
    const { conv } = seedShift();
    const a = seedInbound(conv, 'ابعتلي الصفحة');
    whatsapp.sendStructured.mockImplementation(async () => failSend('rejected'));
    shift.processShiftBatch.mockImplementation(async () => textResult('x', {
      messages: [assets.pagePart('restaurant', 'ar'), assets.pageFollowUp('restaurant', 'ar', { roleplayOn: true })],
    }));

    const report = await batcher.runBatch(conv.id);

    expect(report.outcome).toBe('failed');
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(row(a.id).status).toBe('received');
  });

  test('r2 #0: the end note after a silent idle end that never arrived is said again on the rerun (deliveredView)', async () => {
    const announcedAt = new Date(Date.now() - 60 * 1000);
    const { conv } = seedShift({
      conversation: {
        current_state: 'close',
        workflow_data: {
          roleplay: {
            active: false, sector: 'restaurant', business_name: 'مطعم الساحة', started_at: new Date(Date.now() - HOUR).toISOString(),
            ended_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), end_reason: 'idle', end_announced_at: announcedAt.toISOString(),
          },
        },
      },
    });
    db.seed({
      messages: [{
        business_id: conv.business_id, conversation_id: conv.id, direction: 'outbound', status: 'failed', is_ai_generated: true,
        message_type: 'text', text_body: `${roleplayMod.endNote('restaurant', 'ar')}\n\nتمام.`, created_at: new Date(announcedAt.getTime() + 500),
        raw_payload: { kind: 'reply', batch_key: 'k:0', part_index: 0, batch_ids: [] },
      }],
    });

    const view = await batcher.deliveredView(convRow(conv.id));
    expect(view.workflow_data.roleplay.end_announced_at).toBeNull();
    expect(roleplayMod.endUnannounced(view.workflow_data.roleplay, new Date())).toBe(true);
    expect(convRow(conv.id).workflow_data.roleplay.end_announced_at).toBe(announcedAt.toISOString());
  });
});

