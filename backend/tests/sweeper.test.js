/**
 * services/shiftSweeper.js (pr1-contracts §8.1): the never-silent safety net.
 * One in-memory DB backs Prisma and db/jsonb, so the atomic claims behave as in production.
 * The batcher (built by another slice) and staff alerts are mocked: these tests pin what the
 * sweeper decides, not how a note is sent.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('../src/services/replyBatcher', () => ({
  scheduleReply: jest.fn(),
  deliverResult: jest.fn(),
  isShiftReplyAllowed: jest.fn(),
}));
jest.mock('../src/services/alerts', () => ({
  sendStaffAlert: jest.fn(),
  alertChannelConfigured: jest.fn(),
}));

const replyBatcher = require('../src/services/replyBatcher');
const alerts = require('../src/services/alerts');
const acks = require('../src/workflows/shift/acks');
const { NOTE_WINDOW_MARGIN_MS } = require('../src/utils/serviceWindow');
const { runSweep, getShiftStatus, lastSweep, isCloser } = require('../src/services/shiftSweeper');
const db = require('./helpers/fakeDb').getFakeDb();

// Monday 14 Sep 2026, 11:00 in Amman — inside the default team hours (Sun–Thu 9–18).
const NOW = new Date('2026-09-14T08:00:00Z');
// Monday 20:00 in Amman — after hours.
const AFTER_HOURS = new Date('2026-09-14T17:00:00Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const before = (ms, base = NOW) => new Date(base.getTime() - ms);

const BIZ = 'biz_shift';

function seedBusiness(overrides = {}) {
  db.seed({
    businesses: [{
      id: BIZ, name: 'SHIFT', business_type: 'shift', status: 'active', ai_config: {},
      wa_phone_number_id: 'PNID', ...overrides,
    }],
  });
}

function seedConversation(overrides = {}) {
  const [conv] = db.seed({
    conversations: [{
      business_id: BIZ, customer_wa_id: '962791111111', status: 'open',
      last_inbound_at: before(5 * HOUR), last_message_at: before(5 * HOUR), ...overrides,
    }],
  }).conversations;
  return conv;
}

function seedMessage(overrides = {}) {
  const [msg] = db.seed({
    messages: [{ business_id: BIZ, direction: 'inbound', message_type: 'text', status: 'answered', ...overrides }],
  }).messages;
  return msg;
}

function storedConversation(id) {
  return db.store.conversations.find((c) => c.id === id);
}

function alertsFor(reason) {
  return alerts.sendStaffAlert.mock.calls.map(([arg]) => arg).filter((a) => a.reason === reason);
}

function notesOf(kind) {
  return replyBatcher.deliverResult.mock.calls.map(([arg]) => arg).filter((a) => a.result.kind === kind);
}

beforeEach(() => {
  db.reset();
  jest.clearAllMocks();
  replyBatcher.deliverResult.mockResolvedValue({ outcome: 'sent', parts: [] });
  replyBatcher.isShiftReplyAllowed.mockReturnValue(true);
  alerts.sendStaffAlert.mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
  alerts.alertChannelConfigured.mockReturnValue(false);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  delete process.env.SHIFT_BOT_LIVE;
  delete process.env.SHIFT_TEST_NUMBERS;
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.SHIFT_BOT_LIVE;
  delete process.env.SHIFT_TEST_NUMBERS;
});

describe('isCloser', () => {
  test('short thanks without a question are closers', () => {
    expect(isCloser('تمام شكرًا')).toBe(true);
    expect(isCloser('ok thanks')).toBe(true);
    expect(isCloser('  تمام  ')).toBe(true);
  });

  test('questions, longer messages and empty text are not', () => {
    expect(isCloser('تمام؟')).toBe(false);
    expect(isCloser('ok?')).toBe(false);
    expect(isCloser('طيب متى رح تحكوني')).toBe(false);
    expect(isCloser('')).toBe(false);
    expect(isCloser(null)).toBe(false);
  });
});

describe('1. orphaned batches', () => {
  test('received inbound older than 30 s → scheduleReply(reason sweep); younger → not', async () => {
    seedBusiness();
    const old = seedConversation({ customer_wa_id: '962790000001' });
    const fresh = seedConversation({ customer_wa_id: '962790000002' });
    seedMessage({ conversation_id: old.id, status: 'received', created_at: before(31 * 1000) });
    seedMessage({ conversation_id: old.id, status: 'received', created_at: before(40 * 1000) });
    seedMessage({ conversation_id: fresh.id, status: 'received', created_at: before(10 * 1000) });

    const report = await runSweep({ now: NOW });

    expect(replyBatcher.scheduleReply).toHaveBeenCalledTimes(1);
    expect(replyBatcher.scheduleReply).toHaveBeenCalledWith(old.id, { reason: 'sweep' });
    expect(report.orphans).toBe(1);
  });

  test('reply_failures ≥ 3 → skipped', async () => {
    seedBusiness();
    const conv = seedConversation({ metadata: { reply_failures: 3 } });
    seedMessage({ conversation_id: conv.id, status: 'received', created_at: before(5 * MIN) });

    const report = await runSweep({ now: NOW });

    expect(replyBatcher.scheduleReply).not.toHaveBeenCalled();
    expect(report.orphans).toBe(0);
  });

  // PR1 review (round 2): the oldest-100-rows query ran before the reply_failures filter, so rows of
  // conversations that gave up hid a newer orphan (e.g. one whose timer died with an instance).
  test('100+ received rows on conversations that gave up do not starve a new orphan', async () => {
    seedBusiness();
    for (let i = 0; i < 35; i += 1) {
      const conv = seedConversation({
        customer_wa_id: `96279${String(i).padStart(7, '0')}`,
        last_inbound_at: before(3 * HOUR), last_message_at: before(3 * HOUR), metadata: { reply_failures: 3 },
      });
      for (let j = 0; j < 3; j += 1) {
        seedMessage({ conversation_id: conv.id, status: 'received', created_at: before(3 * HOUR + j * 1000 + i * 10 * 1000) });
      }
    }
    const fresh = seedConversation({ customer_wa_id: '962799999999', last_inbound_at: before(MIN), last_message_at: before(MIN) });
    seedMessage({ conversation_id: fresh.id, status: 'received', created_at: before(MIN) });

    const report = await runSweep({ now: NOW });

    expect(replyBatcher.scheduleReply).toHaveBeenCalledTimes(1);
    expect(replyBatcher.scheduleReply).toHaveBeenCalledWith(fresh.id, { reason: 'sweep' });
    expect(report.orphans).toBe(1);
  });

  test('a conversation that gave up and whose 24 h window closed: its rows are skipped, not kept as orphans', async () => {
    seedBusiness();
    const closed = seedConversation({ customer_wa_id: '962790000011', last_inbound_at: before(25 * HOUR), metadata: { reply_failures: 3 } });
    const open = seedConversation({ customer_wa_id: '962790000012', last_inbound_at: before(2 * HOUR), metadata: { reply_failures: 3 } });
    const a = seedMessage({ conversation_id: closed.id, status: 'received', created_at: before(25 * HOUR) });
    const b = seedMessage({ conversation_id: open.id, status: 'received', created_at: before(2 * HOUR) });

    await runSweep({ now: NOW });

    const status = (id) => db.store.messages.find((m) => m.id === id).status;
    expect(status(a.id)).toBe('skipped');
    expect(status(b.id)).toBe('received');
    expect(replyBatcher.scheduleReply).not.toHaveBeenCalled();
  });

  test('other business types are never swept', async () => {
    seedBusiness({ business_type: 'restaurant' });
    const conv = seedConversation();
    seedMessage({ conversation_id: conv.id, status: 'received', created_at: before(5 * MIN) });

    await runSweep({ now: NOW });
    expect(replyBatcher.scheduleReply).not.toHaveBeenCalled();
  });
});

describe('2. SLA note', () => {
  function seedPending(needsTeam = {}, extra = {}) {
    return seedConversation({
      status: 'pending',
      workflow_data: {
        needs_team: {
          reason: 'quote', summary: 'عيادة أسنان', at: before(16 * MIN).toISOString(),
          resolved_at: null, sla_note_sent_at: null, claimed_at: null, claimed_by: null, ...needsTeam,
        },
        ...extra,
      },
    });
  }

  test('16 team-minutes, no staff outbound → one note + alert, claim stored', async () => {
    seedBusiness();
    const conv = seedPending();

    const report = await runSweep({ now: NOW });

    const notes = notesOf('sla_note');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ batch: [], windowMarginMs: NOTE_WINDOW_MARGIN_MS, now: NOW });
    expect(notes[0].conversation.id).toBe(conv.id);
    expect(notes[0].result).toEqual({
      kind: 'sla_note', action: 'NONE', messages: [{ type: 'text', text: acks.slaNote('ar') }],
      stateUpdate: {}, workflowDataPatch: {}, leadPatch: null, needsTeam: null, alert: null,
    });
    expect(alertsFor('sla_breached')).toHaveLength(1);
    expect(report.sla_notes).toBe(1);
    expect(storedConversation(conv.id).workflow_data.needs_team.sla_note_sent_at).toEqual(expect.any(String));
    // Siblings of the claimed key survive.
    expect(storedConversation(conv.id).workflow_data.needs_team.reason).toBe('quote');

    await runSweep({ now: new Date(NOW.getTime() + MIN) });
    expect(notesOf('sla_note')).toHaveLength(1);
    expect(alertsFor('sla_breached')).toHaveLength(1);
  });

  test('a call request with the time already noted → staff alert only, no «write me a time» note', async () => {
    seedBusiness();
    const conv = seedPending({ reason: 'meeting', summary: 'بكرا بين 10 و12' }, {
      lead: { name: 'محمد', business_name: 'زيتون', preferred_time: { text: 'بكرا بين 10 و12' } },
    });

    const report = await runSweep({ now: NOW });

    expect(notesOf('sla_note')).toHaveLength(0);
    expect(alertsFor('sla_breached')).toHaveLength(1);
    expect(report.sla_notes).toBe(0);
    expect(storedConversation(conv.id).workflow_data.needs_team.sla_note_sent_at).toEqual(expect.any(String));

    await runSweep({ now: new Date(NOW.getTime() + MIN) });
    expect(alertsFor('sla_breached')).toHaveLength(1);
  });

  test('English lead gets the English note', async () => {
    seedBusiness();
    seedPending({}, { lead: { language: 'en' } });
    await runSweep({ now: NOW });
    expect(notesOf('sla_note')[0].result.messages[0].text).toBe(acks.slaNote('en'));
  });

  test('no lead language: the note follows the customer\'s newest text', async () => {
    seedBusiness();
    const conv = seedPending();
    seedMessage({ conversation_id: conv.id, text_body: 'Hi, can I get a quote for my clinic?', created_at: before(20 * MIN) });
    await runSweep({ now: NOW });
    expect(notesOf('sla_note')[0].result.messages[0].text).toBe(acks.slaNote('en'));
  });

  test('two concurrent runSweep calls → one note', async () => {
    seedBusiness();
    seedPending();

    const [a, b] = await Promise.all([runSweep({ now: NOW }), runSweep({ now: NOW })]);

    expect(notesOf('sla_note')).toHaveLength(1);
    expect([a.skipped, b.skipped]).toContain('already_running');
  });

  test('the DB claim is once-only even when the in-process guard does not apply', async () => {
    seedBusiness();
    const conv = seedPending();
    const jsonb = require('../src/db/jsonb');
    const path = ['needs_team', 'sla_note_sent_at'];
    const claims = await Promise.all([
      jsonb.claimFlag('conversations', conv.id, 'workflow_data', path),
      jsonb.claimFlag('conversations', conv.id, 'workflow_data', path),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);

    await runSweep({ now: NOW });
    expect(notesOf('sla_note')).toHaveLength(0);
  });

  test('after hours → no note', async () => {
    seedBusiness();
    seedPending({ at: before(3 * HOUR, AFTER_HOURS).toISOString() });
    await runSweep({ now: AFTER_HOURS });
    expect(notesOf('sla_note')).toHaveLength(0);
    expect(alertsFor('sla_breached')).toHaveLength(0);
  });

  test('fewer than 15 team-minutes (overnight does not count) → no note', async () => {
    seedBusiness();
    // Thursday 17:55 Amman → Sunday 09:05 Amman = 10 team-minutes.
    seedPending({ at: '2026-09-17T14:55:00Z' });
    await runSweep({ now: new Date('2026-09-20T06:05:00Z') });
    expect(notesOf('sla_note')).toHaveLength(0);
  });

  test('staff outbound since the request → no note', async () => {
    seedBusiness();
    db.seed({ users: [{ id: 'user_1', name: 'رنا', business_id: BIZ }] });
    const conv = seedPending();
    seedMessage({
      conversation_id: conv.id, direction: 'outbound', status: 'sent', sent_by_user_id: 'user_1',
      created_at: before(5 * MIN),
    });
    await runSweep({ now: NOW });
    expect(notesOf('sla_note')).toHaveLength(0);
  });

  test('opted out → no note', async () => {
    seedBusiness();
    seedPending({}, { marketing_opted_out_at: before(HOUR).toISOString() });
    await runSweep({ now: NOW });
    expect(notesOf('sla_note')).toHaveLength(0);
  });

  test('ai_failure needs_team → no note', async () => {
    seedBusiness();
    seedPending({ reason: 'ai_failure' });
    await runSweep({ now: NOW });
    expect(notesOf('sla_note')).toHaveLength(0);
  });

  test('resolved needs_team → no note', async () => {
    seedBusiness();
    seedPending({ resolved_at: before(MIN).toISOString() });
    await runSweep({ now: NOW });
    expect(notesOf('sla_note')).toHaveLength(0);
  });

  test('D1 gate closed for this customer → no customer note', async () => {
    seedBusiness();
    seedPending();
    replyBatcher.isShiftReplyAllowed.mockReturnValue(false);
    await runSweep({ now: NOW });
    expect(notesOf('sla_note')).toHaveLength(0);
  });
});

describe('3. awaiting-staff note', () => {
  function seedTakeover() {
    db.seed({ users: [{ id: 'user_1', name: 'رنا', business_id: BIZ }] });
    return seedConversation({ status: 'human_takeover', ai_enabled: false, assigned_staff_id: 'user_1' });
  }

  test('question 11 min old → one note with the staff name; a second sweep → none', async () => {
    seedBusiness();
    const conv = seedTakeover();
    const q = seedMessage({
      conversation_id: conv.id, status: 'awaiting_staff', text_body: 'طيب وينكم؟', created_at: before(11 * MIN),
    });

    const report = await runSweep({ now: NOW });

    const notes = notesOf('awaiting_note');
    expect(notes).toHaveLength(1);
    expect(notes[0].result.messages[0].text).toBe(acks.awaitingStaffNote({ staffName: 'رنا', lang: 'ar' }));
    expect(notes[0]).toMatchObject({ batch: [], windowMarginMs: NOTE_WINDOW_MARGIN_MS });
    expect(alertsFor('awaiting_staff')).toHaveLength(1);
    expect(report.awaiting_notes).toBe(1);
    expect(storedConversation(conv.id).metadata.awaiting_note_for).toBe(q.id);
    // The rows stay awaiting_staff until a staff member replies.
    expect(db.store.messages.find((m) => m.id === q.id).status).toBe('awaiting_staff');

    await runSweep({ now: new Date(NOW.getTime() + MIN) });
    expect(notesOf('awaiting_note')).toHaveLength(1);
  });

  test('a new silence after another staff reply → note again', async () => {
    seedBusiness();
    const conv = seedTakeover();
    seedMessage({ conversation_id: conv.id, status: 'awaiting_staff', text_body: 'في حدا؟', created_at: before(40 * MIN) });
    await runSweep({ now: NOW });
    expect(notesOf('awaiting_note')).toHaveLength(1);

    const later = new Date(NOW.getTime() + 30 * MIN);
    seedMessage({
      conversation_id: conv.id, direction: 'outbound', status: 'sent', sent_by_user_id: 'user_1',
      created_at: before(20 * MIN, later),
    });
    seedMessage({
      conversation_id: conv.id, status: 'awaiting_staff', text_body: 'طيب والسعر كم؟', created_at: before(12 * MIN, later),
    });
    await runSweep({ now: later });

    expect(notesOf('awaiting_note')).toHaveLength(2);
    expect(alertsFor('awaiting_staff')).toHaveLength(2);
  });

  test('rows answered by a later staff reply are not a silence', async () => {
    seedBusiness();
    const conv = seedTakeover();
    seedMessage({ conversation_id: conv.id, status: 'awaiting_staff', text_body: 'في حدا؟', created_at: before(30 * MIN) });
    seedMessage({
      conversation_id: conv.id, direction: 'outbound', status: 'sent', sent_by_user_id: 'user_1', created_at: before(20 * MIN),
    });
    await runSweep({ now: NOW });
    expect(notesOf('awaiting_note')).toHaveLength(0);
  });

  test('closers only → none', async () => {
    seedBusiness();
    const conv = seedTakeover();
    seedMessage({ conversation_id: conv.id, status: 'awaiting_staff', text_body: 'تمام شكرًا', created_at: before(15 * MIN) });
    seedMessage({ conversation_id: conv.id, status: 'awaiting_staff', text_body: 'ok', created_at: before(14 * MIN) });
    await runSweep({ now: NOW });
    expect(notesOf('awaiting_note')).toHaveLength(0);
    expect(alertsFor('awaiting_staff')).toHaveLength(0);
  });

  test('younger than 10 min or after hours → none', async () => {
    seedBusiness();
    const conv = seedTakeover();
    seedMessage({ conversation_id: conv.id, status: 'awaiting_staff', text_body: 'وينكم؟', created_at: before(5 * MIN) });
    await runSweep({ now: NOW });
    seedMessage({
      conversation_id: conv.id, status: 'awaiting_staff', text_body: 'وينكم؟', created_at: before(20 * MIN, AFTER_HOURS),
    });
    await runSweep({ now: AFTER_HOURS });
    expect(notesOf('awaiting_note')).toHaveLength(0);
  });

  test('no assigned staff → «الفريق»', async () => {
    seedBusiness();
    const conv = seedConversation({ status: 'open' });
    seedMessage({ conversation_id: conv.id, status: 'awaiting_staff', text_body: 'متى بتردوا؟', created_at: before(11 * MIN) });
    await runSweep({ now: NOW });
    expect(notesOf('awaiting_note')[0].result.messages[0].text).toBe(acks.awaitingStaffNote({ lang: 'ar' }));
  });
});

describe('4. window closing', () => {
  test('pending conversation 23 h after the last inbound → flag + alert once', async () => {
    seedBusiness();
    const last = before(23 * HOUR);
    const conv = seedConversation({ status: 'pending', last_inbound_at: last });

    const report = await runSweep({ now: NOW });

    const meta = storedConversation(conv.id).metadata;
    expect(meta.window_flag_for).toBe(last.toISOString());
    expect(meta.window_closing_at).toBe(new Date(last.getTime() + 24 * HOUR).toISOString());
    expect(alertsFor('window_closing')).toHaveLength(1);
    expect(report.window_flags).toBe(1);
    // No customer message for a closing window.
    expect(replyBatcher.deliverResult).not.toHaveBeenCalled();

    await runSweep({ now: new Date(NOW.getTime() + MIN) });
    expect(alertsFor('window_closing')).toHaveLength(1);
  });

  test('open conversation with an awaiting_staff inbound is eligible; without one it is not', async () => {
    seedBusiness();
    const withRow = seedConversation({ customer_wa_id: '962790000001', last_inbound_at: before(23 * HOUR) });
    const without = seedConversation({ customer_wa_id: '962790000002', last_inbound_at: before(23 * HOUR) });
    seedMessage({ conversation_id: withRow.id, status: 'awaiting_staff', text_body: 'تمام', created_at: before(23 * HOUR) });

    await runSweep({ now: NOW });

    expect(alertsFor('window_closing').map((a) => a.conversation.id)).toEqual([withRow.id]);
    expect(storedConversation(without.id).metadata.window_flag_for).toBeUndefined();
  });

  test('outside the 22–24 h band → nothing', async () => {
    seedBusiness();
    seedConversation({ customer_wa_id: '962790000001', status: 'pending', last_inbound_at: before(21 * HOUR) });
    seedConversation({ customer_wa_id: '962790000002', status: 'pending', last_inbound_at: before(25 * HOUR) });
    await runSweep({ now: NOW });
    expect(alertsFor('window_closing')).toHaveLength(0);
  });
});

describe('5. ambiguous sends', () => {
  test('ambiguous for 11 min → ambiguous_unreconciled + alert once; 5 min → untouched', async () => {
    seedBusiness();
    const conv = seedConversation();
    const old = seedMessage({
      conversation_id: conv.id, direction: 'outbound', status: 'ambiguous', text_body: 'أهلًا', created_at: before(11 * MIN),
    });
    const young = seedMessage({
      conversation_id: conv.id, direction: 'outbound', status: 'ambiguous', text_body: 'أهلًا', created_at: before(5 * MIN),
    });

    const report = await runSweep({ now: NOW });

    expect(db.store.messages.find((m) => m.id === old.id).status).toBe('ambiguous_unreconciled');
    expect(db.store.messages.find((m) => m.id === young.id).status).toBe('ambiguous');
    expect(alertsFor('ambiguous_send')).toHaveLength(1);
    expect(alertsFor('ambiguous_send')[0].conversation.id).toBe(conv.id);
    expect(report.ambiguous_alerts).toBe(1);
    // Never re-sends.
    expect(replyBatcher.deliverResult).not.toHaveBeenCalled();
    expect(replyBatcher.scheduleReply).not.toHaveBeenCalled();

    await runSweep({ now: new Date(NOW.getTime() + MIN) });
    expect(alertsFor('ambiguous_send')).toHaveLength(1);
  });

  test('a send left at `sending` for 3 min (process died mid-send) → ambiguous_unreconciled + alert once; 30 s → untouched', async () => {
    seedBusiness();
    const conv = seedConversation();
    const dead = seedMessage({
      conversation_id: conv.id, direction: 'outbound', status: 'sending', text_body: 'رسالتك وصلت', created_at: before(3 * MIN),
      raw_payload: { kind: 'awaiting_note', batch_ids: [] },
    });
    const live = seedMessage({
      conversation_id: conv.id, direction: 'outbound', status: 'sending', text_body: 'أهلًا', created_at: before(30 * 1000),
    });

    const report = await runSweep({ now: NOW });

    expect(db.store.messages.find((m) => m.id === dead.id).status).toBe('ambiguous_unreconciled');
    expect(db.store.messages.find((m) => m.id === live.id).status).toBe('sending');
    expect(alertsFor('ambiguous_send')).toHaveLength(1);
    expect(report.ambiguous_alerts).toBe(1);
    expect(replyBatcher.deliverResult).not.toHaveBeenCalled();

    await runSweep({ now: new Date(NOW.getTime() + MIN) });
    expect(alertsFor('ambiguous_send')).toHaveLength(1);
  });
});

describe('6. inbound without outbound', () => {
  test('inbound 3 min old with no outbound → alert once', async () => {
    seedBusiness();
    const conv = seedConversation({ last_inbound_at: before(3 * MIN) });
    const inb = seedMessage({ conversation_id: conv.id, status: 'skipped', text_body: 'مرحبا', created_at: before(3 * MIN) });

    const report = await runSweep({ now: NOW });

    expect(alertsFor('inbound_without_outbound')).toHaveLength(1);
    expect(storedConversation(conv.id).metadata.unanswered_alert_for).toBe(inb.id);
    expect(report.unanswered_alerts).toBe(1);

    await runSweep({ now: new Date(NOW.getTime() + MIN) });
    expect(alertsFor('inbound_without_outbound')).toHaveLength(1);
  });

  test('a failed or never-recorded outbound does not count as an answer', async () => {
    seedBusiness();
    const failed = seedConversation({ customer_wa_id: '962790000011', last_inbound_at: before(5 * MIN) });
    seedMessage({ conversation_id: failed.id, status: 'received', text_body: 'مرحبا', created_at: before(5 * MIN) });
    seedMessage({ conversation_id: failed.id, direction: 'outbound', status: 'failed', text_body: 'أهلًا', created_at: before(4 * MIN) });
    const sending = seedConversation({ customer_wa_id: '962790000012', last_inbound_at: before(5 * MIN) });
    seedMessage({ conversation_id: sending.id, status: 'received', text_body: 'مرحبا', created_at: before(5 * MIN) });
    // Younger than the stale-send threshold, so step 5 has not flagged it yet.
    seedMessage({ conversation_id: sending.id, direction: 'outbound', status: 'sending', text_body: 'أهلًا', created_at: before(90 * 1000) });

    await runSweep({ now: NOW });
    expect(alertsFor('inbound_without_outbound').map((a) => a.conversation.id).sort()).toEqual([failed.id, sending.id].sort());
  });

  test("fires with reply_mode 'external' and with the bot gate closed", async () => {
    process.env.SHIFT_BOT_LIVE = '0';
    seedBusiness({ ai_config: { reply_mode: 'external' } });
    replyBatcher.isShiftReplyAllowed.mockReturnValue(false);
    const conv = seedConversation({ last_inbound_at: before(3 * MIN) });
    seedMessage({ conversation_id: conv.id, status: 'skipped', text_body: 'مرحبا', created_at: before(3 * MIN) });

    await runSweep({ now: NOW });
    expect(alertsFor('inbound_without_outbound')).toHaveLength(1);
  });

  test('an outbound after the inbound, a reaction, awaiting_staff, or < 2 min → no alert', async () => {
    seedBusiness();
    const answered = seedConversation({ customer_wa_id: '962790000001', last_inbound_at: before(5 * MIN) });
    seedMessage({ conversation_id: answered.id, text_body: 'مرحبا', created_at: before(5 * MIN) });
    seedMessage({ conversation_id: answered.id, direction: 'outbound', status: 'sent', text_body: 'أهلًا', created_at: before(4 * MIN) });

    const reaction = seedConversation({ customer_wa_id: '962790000002', last_inbound_at: before(5 * MIN) });
    seedMessage({ conversation_id: reaction.id, message_type: 'reaction', status: 'skipped', created_at: before(5 * MIN) });

    const awaiting = seedConversation({ customer_wa_id: '962790000003', last_inbound_at: before(5 * MIN) });
    seedMessage({ conversation_id: awaiting.id, status: 'awaiting_staff', text_body: 'وين؟', created_at: before(5 * MIN) });

    const young = seedConversation({ customer_wa_id: '962790000004', last_inbound_at: before(MIN) });
    seedMessage({ conversation_id: young.id, status: 'received', text_body: 'مرحبا', created_at: before(MIN) });

    await runSweep({ now: NOW });
    expect(alertsFor('inbound_without_outbound')).toHaveLength(0);
  });
});

describe('runSweep', () => {
  test('overlapping call → already_running; lastSweep records the finished one', async () => {
    seedBusiness();
    const first = runSweep({ now: NOW });
    const second = await runSweep({ now: NOW });
    expect(second.skipped).toBe('already_running');
    const report = await first;
    expect(report.skipped).toBeUndefined();
    expect(lastSweep()).toEqual({ at: NOW.toISOString(), report });
  });

  test('a failing step is reported, never thrown, and later steps still run', async () => {
    seedBusiness();
    const conv = seedConversation({ status: 'pending', last_inbound_at: before(23 * HOUR) });
    db.failNext('message.findMany', new Error('db down'));

    const report = await runSweep({ now: NOW });

    expect(report.errors.some((e) => e.includes('db down'))).toBe(true);
    expect(alertsFor('window_closing').map((a) => a.conversation.id)).toEqual([conv.id]);
  });

  test('report shape', async () => {
    const report = await runSweep({ now: NOW });
    expect(report).toEqual({
      orphans: 0, sla_notes: 0, awaiting_notes: 0, window_flags: 0, ambiguous_alerts: 0, unanswered_alerts: 0, errors: [],
    });
  });
});

describe('getShiftStatus', () => {
  test('no active SHIFT business → workflow inactive', async () => {
    seedBusiness({ business_type: 'restaurant' });
    await expect(getShiftStatus({ now: NOW })).resolves.toEqual({ workflow_active: false, business: null });
  });

  test('shape and counts', async () => {
    process.env.SHIFT_TEST_NUMBERS = '962796381676, 962790000009';
    alerts.alertChannelConfigured.mockReturnValue(true);
    seedBusiness({ ai_config: { test_numbers: ['962796381676'] } });
    const conv = seedConversation({ status: 'pending' });
    seedMessage({ conversation_id: conv.id, status: 'received', created_at: before(2 * MIN) });
    seedMessage({ conversation_id: conv.id, status: 'received', created_at: before(10 * 1000) });
    seedMessage({ conversation_id: conv.id, status: 'awaiting_staff', created_at: before(MIN) });
    seedMessage({ conversation_id: conv.id, direction: 'outbound', status: 'ambiguous', created_at: before(20 * MIN) });
    seedMessage({ conversation_id: conv.id, direction: 'outbound', status: 'ambiguous_unreconciled', created_at: before(3 * MIN) });

    const status = await getShiftStatus({ now: NOW });

    expect(status).toEqual({
      business: { id: BIZ, name: 'SHIFT' },
      workflow_active: true,
      reply_mode: null,
      bot_live: true,
      test_numbers_count: 2,
      alert_channel_configured: true,
      model: expect.any(String),
      graph_version: 'v24.0',
      last_inbound_at: before(10 * 1000).toISOString(),
      last_outbound_at: before(3 * MIN).toISOString(),
      pending: 1,
      awaiting_staff: 1,
      received_backlog: 1,
      ambiguous: 2,
      sweep: lastSweep(),
      now: NOW.toISOString(),
    });
  });

  test("SHIFT_BOT_LIVE=0 or reply_mode 'external' → workflow inactive", async () => {
    seedBusiness({ ai_config: { reply_mode: 'external' } });
    let status = await getShiftStatus({ now: NOW });
    expect(status).toMatchObject({ workflow_active: false, reply_mode: 'external', bot_live: true });

    db.reset();
    seedBusiness();
    process.env.SHIFT_BOT_LIVE = '0';
    status = await getShiftStatus({ now: NOW });
    expect(status).toMatchObject({ workflow_active: false, reply_mode: null, bot_live: false });
  });
});
