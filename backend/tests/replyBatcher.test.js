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

  test('15. send keeps failing → retried until reply_failures = 3, one alert, then it stops', async () => {
    whatsapp.sendText.mockImplementation(async () => failSend('rejected'));
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');

    expect((await batcher.runBatch(conv.id)).outcome).toBe('failed');
    expect(convRow(conv.id).metadata.reply_failures).toBe(1);
    expect(batcher.hasPendingTimer(conv.id)).toBe(true);

    // Each rescheduled run fires on a 0 ms timer; drive them until the counter stops moving.
    for (let i = 0; i < 20 && convRow(conv.id).metadata.reply_failures < 3; i++) {
      await jest.advanceTimersByTimeAsync(1);
      await settle();
    }
    await jest.advanceTimersByTimeAsync(1000);
    await settle();

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
    const { biz, conv } = seedShift();
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
    expect(body).toContain('علّقت شوي');
    expect(buttons).toHaveLength(3);
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

  test('13. ambiguous send → row ambiguous, inbound answered, alert, no retry', async () => {
    whatsapp.sendText.mockImplementation(async () => failSend('ambiguous'));
    const { conv } = seedShift();
    const a = seedInbound(conv, 'مرحبا');

    const r = await batcher.runBatch(conv.id);
    await settle();

    expect(r).toEqual({ outcome: 'ambiguous', sent: 1 });
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    expect(botOutbound(conv)[0].status).toBe('ambiguous');
    expect(botOutbound(conv)[0].meta_message_id).toBeNull();
    expect(row(a.id).status).toBe('answered');
    expect(alertReasons()).toEqual(['ambiguous_send']);
    expect(batcher.hasPendingTimer(conv.id)).toBe(false);
  });

  test('14. retryable 5xx → exactly one immediate retry', async () => {
    whatsapp.sendText
      .mockImplementationOnce(async () => failSend('server', true))
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
    shift.processShiftBatch.mockImplementation(async (business, conversation, batch, opts) => {
      expect(opts.deadlineAt - opts.now.getTime()).toBe(18000);
      await opts.onRetry();
      return textResult();
    });
    await batcher.runBatch(conv.id);
    await settle();
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

// ─── messageProcessor SHIFT path (§7.2) ──────────────────────────────────────

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

  test('persistInbound keeps delivered for restaurant and external-mode SHIFT', async () => {
    seedBusiness({ business_type: 'restaurant', wa_phone_number_id: 'pnid_rest' });
    seedBusiness({ wa_phone_number_id: 'pnid_ext', ai_config: { reply_mode: 'external' } });
    await persistInbound(entryFor('pnid_rest', { id: 'wamid.r1', type: 'text', text: { body: 'hi' } }));
    await persistInbound(entryFor('pnid_ext', { id: 'wamid.e1', type: 'text', text: { body: 'hi' } }));
    expect(inboundRows().map((m) => m.status)).toEqual(['delivered', 'delivered']);
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

  test('a status webhook reconciles the oldest ambiguous send; billing failures raise the banner', async () => {
    const biz = seedBusiness();
    const [conv] = db.seed({ conversations: [{ business_id: biz.id, customer_wa_id: CUSTOMER, last_inbound_at: new Date() }] }).conversations;
    const [amb] = db.seed({
      messages: [{ business_id: biz.id, conversation_id: conv.id, direction: 'outbound', status: 'ambiguous', raw_payload: { kind: 'reply' } }],
    }).messages;

    const statusEntry = (status) => ({ changes: [{ value: { metadata: { phone_number_id: 'pnid_shift' }, statuses: [status] } }] });
    await processInboundMessage(statusEntry({ id: 'wamid.late', status: 'delivered', recipient_id: CUSTOMER }));
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
