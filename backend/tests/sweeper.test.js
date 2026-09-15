/**
 * services/shiftSweeper.js (pr1-contracts §8.1): the never-silent safety net.
 * One in-memory DB backs Prisma and db/jsonb, so the atomic claims behave as in production.
 * The batcher (built by another slice) and staff alerts are mocked: these tests pin what the
 * sweeper decides, not how a note is sent. The dispatchIntent mock writes the intent row a real
 * dispatch writes first, because the sweeper's crash recovery (GPT-6 #11) looks for it.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('../src/services/replyBatcher', () => ({
  scheduleReply: jest.fn(),
  deliverResult: jest.fn(),
  dispatchIntent: jest.fn(),
  reconcileUnconfirmedIntents: jest.fn(),
  isShiftReplyAllowed: jest.fn(),
  // The real rule: the sweeper must agree with the batcher on when a person is talking.
  isHumanActive: jest.fn((...args) => jest.requireActual('../src/services/replyBatcher').isHumanActive(...args)),
}));
// D24: owned by the processor slice; the sweeper only has to call it every run.
jest.mock('../src/services/messageProcessor', () => ({
  reprocessStuckInbound: jest.fn(),
}));
jest.mock('../src/services/alerts', () => ({
  sendStaffAlert: jest.fn(),
  alertChannelConfigured: jest.fn(),
}));

const replyBatcher = require('../src/services/replyBatcher');
const messageProcessor = require('../src/services/messageProcessor');
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

function statusOf(id) {
  return db.store.messages.find((m) => m.id === id).status;
}

function alertsFor(reason) {
  return alerts.sendStaffAlert.mock.calls.map(([arg]) => arg).filter((a) => a.reason === reason);
}

function notesOf(kind) {
  return replyBatcher.dispatchIntent.mock.calls.map(([arg]) => arg).filter((a) => a.kind === kind);
}

// What dispatchIntent does before Graph: an outbound intent row carrying `${batchKey}:0`.
async function fakeDispatch({ business, conversation, kind, parts, batchKey }) {
  const [row] = db.seed({
    messages: [{
      business_id: business.id, conversation_id: conversation.id, direction: 'outbound', status: 'sent',
      text_body: parts[0].text, is_ai_generated: true,
      raw_payload: { kind, batch_key: batchKey ? `${batchKey}:0` : null, part_index: 0, batch_ids: [] },
    }],
  }).messages;
  return { outcome: 'sent', parts: [{ index: 0, status: 'sent', reason: null, id: 'wamid.note', intentId: row.id }] };
}

const at = (ms) => new Date(NOW.getTime() + ms);

beforeEach(() => {
  db.reset();
  jest.clearAllMocks();
  replyBatcher.deliverResult.mockResolvedValue({ outcome: 'sent', parts: [] });
  replyBatcher.dispatchIntent.mockImplementation(fakeDispatch);
  replyBatcher.reconcileUnconfirmedIntents.mockResolvedValue({ requeued: 0, escalated: 0, unreconciled: 0, errors: [] });
  messageProcessor.reprocessStuckInbound.mockResolvedValue({ reprocessed: 0 });
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

  // GPT-6 #10 / D22: word count is not a closer test — «price please» is a request in two words.
  test('short requests are not closers', () => {
    expect(isCloser('price please')).toBe(false);
    expect(isCloser('كم السعر')).toBe(false);
    expect(isCloser('بدي عرض')).toBe(false);
    expect(isCloser('وينكم')).toBe(false);
    expect(isCloser('تمام بس كم السعر')).toBe(false);
  });

  test('the explicit phrase list, with spelling variants, emoji and repeats', () => {
    for (const text of ['شكراً', 'شكرا جزيلا', 'مشكور 🙏', 'يعطيك العافية', 'الله يعطيك العافيه', '👍', '👍🏽',
      'OK', 'Okay, thanks!', 'thank you', 'تسلم', 'تمام تمام', 'شكراااا', 'تمام 👌']) {
      expect([text, isCloser(text)]).toEqual([text, true]);
    }
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

describe('1a. temporary staff pause expired (D22, GPT-6 #10)', () => {
  function seedStaff() {
    db.seed({ users: [{ id: 'user_1', name: 'رنا', business_id: BIZ }] });
  }

  test('pause over and nobody claimed the conversation → its awaiting rows go back to received and a run is scheduled', async () => {
    seedBusiness();
    seedStaff();
    // Staff wrote at 10:00 without taking over; the customer asked at 10:05; nobody answered.
    const conv = seedConversation({ metadata: { human_active_until: before(5 * MIN).toISOString() } });
    seedMessage({ conversation_id: conv.id, direction: 'outbound', status: 'sent', sent_by_user_id: 'user_1', created_at: before(35 * MIN) });
    const q = seedMessage({ conversation_id: conv.id, status: 'awaiting_staff', text_body: 'price please', created_at: before(30 * MIN) });

    const report = await runSweep({ now: NOW });

    expect(statusOf(q.id)).toBe('received');
    expect(replyBatcher.scheduleReply).toHaveBeenCalledWith(conv.id, { reason: 'sweep' });
    expect(report.pause_requeued).toBe(1);
    // Answered by the bot now, not told to keep waiting.
    expect(notesOf('awaiting_note')).toHaveLength(0);
  });

  test('pause still running, a staff message under 30 min old, claimed, or AI off → rows stay awaiting_staff', async () => {
    seedBusiness();
    seedStaff();
    const paused = seedConversation({ customer_wa_id: '962790000031', metadata: { human_active_until: at(10 * MIN).toISOString() } });
    const talking = seedConversation({ customer_wa_id: '962790000032' });
    seedMessage({ conversation_id: talking.id, direction: 'outbound', status: 'sent', sent_by_user_id: 'user_1', created_at: before(10 * MIN) });
    const claimed = seedConversation({ customer_wa_id: '962790000033', status: 'human_takeover', ai_enabled: false, assigned_staff_id: 'user_1' });
    const aiOff = seedConversation({ customer_wa_id: '962790000034', ai_enabled: false });
    const rows = [paused, talking, claimed, aiOff].map((c) => seedMessage({
      conversation_id: c.id, status: 'awaiting_staff', text_body: 'وينكم؟', created_at: before(5 * MIN),
    }));

    const report = await runSweep({ now: NOW });

    expect(rows.map((r) => statusOf(r.id))).toEqual(['awaiting_staff', 'awaiting_staff', 'awaiting_staff', 'awaiting_staff']);
    expect(report.pause_requeued).toBe(0);
    expect(replyBatcher.scheduleReply).not.toHaveBeenCalled();
  });

  test('rows handed to staff because the bot reply stayed unconfirmed (D18) are not requeued', async () => {
    seedBusiness();
    const conv = seedConversation({ status: 'pending' });
    const escalated = seedMessage({ conversation_id: conv.id, status: 'awaiting_staff', text_body: 'مرحبا', created_at: before(20 * MIN) });
    seedMessage({
      conversation_id: conv.id, direction: 'outbound', status: 'ambiguous_unreconciled', is_ai_generated: true, created_at: before(19 * MIN),
      raw_payload: { kind: 'reply', batch_key: `${escalated.id}:0`, batch_ids: [escalated.id], settled: 'escalated' },
    });

    await runSweep({ now: NOW });

    expect(statusOf(escalated.id)).toBe('awaiting_staff');
    expect(replyBatcher.scheduleReply).not.toHaveBeenCalled();
  });

  test('rows handed to staff after a second `failed` status (D19, intent left `failed`) are not requeued', async () => {
    seedBusiness();
    const conv = seedConversation({ status: 'pending' });
    const escalated = seedMessage({ conversation_id: conv.id, status: 'awaiting_staff', text_body: 'مرحبا', created_at: before(20 * MIN) });
    seedMessage({
      conversation_id: conv.id, direction: 'outbound', status: 'failed', is_ai_generated: true, created_at: before(19 * MIN),
      raw_payload: { kind: 'reply', batch_key: `${escalated.id}:0`, batch_ids: [escalated.id], settled: 'escalated' },
    });

    await runSweep({ now: NOW });

    expect(statusOf(escalated.id)).toBe('awaiting_staff');
    expect(replyBatcher.scheduleReply).not.toHaveBeenCalled();
  });

  test('200+ rows parked in a claimed chat do not hide a newer conversation whose pause ended', async () => {
    seedBusiness();
    seedStaff();
    const held = seedConversation({ customer_wa_id: '962790000041', status: 'human_takeover', ai_enabled: false, assigned_staff_id: 'user_1' });
    for (let i = 0; i < 205; i += 1) {
      seedMessage({ conversation_id: held.id, status: 'awaiting_staff', text_body: `سؤال ${i}`, created_at: before(3 * HOUR - i * 1000) });
    }
    const expired = seedConversation({ customer_wa_id: '962790000042', metadata: { human_active_until: before(MIN).toISOString() } });
    const q = seedMessage({ conversation_id: expired.id, status: 'awaiting_staff', text_body: 'وينكم؟', created_at: before(20 * MIN) });

    await runSweep({ now: NOW });

    expect(statusOf(q.id)).toBe('received');
  });

  test('D1 gate closed for this customer → not requeued (the batcher would only skip them)', async () => {
    seedBusiness();
    replyBatcher.isShiftReplyAllowed.mockReturnValue(false);
    const conv = seedConversation();
    const q = seedMessage({ conversation_id: conv.id, status: 'awaiting_staff', text_body: 'وينكم؟', created_at: before(40 * MIN) });
    await runSweep({ now: NOW });
    expect(statusOf(q.id)).toBe('awaiting_staff');
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

  const storedNeedsTeam = (id) => storedConversation(id).workflow_data.needs_team;

  test('16 team-minutes, no staff outbound → one note through dispatchIntent + alert, claim stored', async () => {
    seedBusiness();
    const conv = seedPending();
    const requestAt = conv.workflow_data.needs_team.at;

    const report = await runSweep({ now: NOW });

    const notes = notesOf('sla_note');
    expect(notes).toHaveLength(1);
    // D17/D21: an intent tied to this request, behind the pre-send check (a claim made meanwhile stops it).
    expect(notes[0]).toMatchObject({
      kind: 'sla_note', parts: [{ type: 'text', text: acks.slaNote('ar') }], batchIds: [],
      batchKey: `sla_note:quote:${requestAt}`, since: new Date(requestAt), now: NOW,
      precheck: { humanGuard: true, optedOutSince: new Date(requestAt) },
    });
    expect(notes[0].conversation.id).toBe(conv.id);
    expect(replyBatcher.deliverResult).not.toHaveBeenCalled();
    expect(alertsFor('sla_breached')).toHaveLength(1);
    expect(report.sla_notes).toBe(1);
    expect(storedNeedsTeam(conv.id)).toMatchObject({
      reason: 'quote', at: requestAt, sla_note_sent_at: NOW.toISOString(), sla_note_attempt: 1, sla_note_done_at: NOW.toISOString(),
    });

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
    expect(notesOf('sla_note')[0].parts[0].text).toBe(acks.slaNote('en'));
  });

  test('no lead language: the note follows the customer\'s newest text', async () => {
    seedBusiness();
    const conv = seedPending();
    seedMessage({ conversation_id: conv.id, text_body: 'Hi, can I get a quote for my clinic?', created_at: before(20 * MIN) });
    await runSweep({ now: NOW });
    expect(notesOf('sla_note')[0].parts[0].text).toBe(acks.slaNote('en'));
  });

  test('two concurrent runSweep calls → one note', async () => {
    seedBusiness();
    seedPending();

    const [a, b] = await Promise.all([runSweep({ now: NOW }), runSweep({ now: NOW })]);

    expect(notesOf('sla_note')).toHaveLength(1);
    expect([a.skipped, b.skipped]).toContain('already_running');
  });

  // Another instance's sweep read the same unclaimed request and claimed it first.
  test('a sweep holding a stale unclaimed copy loses the claim (compare-and-set on the stored entry)', async () => {
    seedBusiness();
    const conv = seedPending();
    const stale = JSON.parse(JSON.stringify(storedConversation(conv.id)));
    Object.assign(storedConversation(conv.id).workflow_data.needs_team, { sla_note_sent_at: before(30 * 1000).toISOString(), sla_note_attempt: 1 });
    jest.spyOn(db.prisma.conversation, 'findMany').mockImplementationOnce(async () => [stale]);

    await runSweep({ now: NOW });

    expect(notesOf('sla_note')).toHaveLength(0);
    expect(alertsFor('sla_breached')).toHaveLength(0);
    expect(storedNeedsTeam(conv.id)).toMatchObject({ sla_note_attempt: 1, sla_note_sent_at: before(30 * 1000).toISOString() });
  });

  // GPT-6 #11: the old sweep must not mark the NEW request's note as sent while acting on the old one.
  test('the request was replaced between the read and the claim → no note, the new request is untouched', async () => {
    seedBusiness();
    const conv = seedPending();
    const stale = JSON.parse(JSON.stringify(storedConversation(conv.id)));
    storedConversation(conv.id).workflow_data.needs_team = {
      reason: 'person', summary: 'بدو حدا', at: before(MIN).toISOString(), resolved_at: null, sla_note_sent_at: null, claimed_at: null, claimed_by: null,
    };
    jest.spyOn(db.prisma.conversation, 'findMany').mockImplementationOnce(async () => [stale]);

    await runSweep({ now: NOW });

    expect(notesOf('sla_note')).toHaveLength(0);
    expect(storedNeedsTeam(conv.id)).toEqual({
      reason: 'person', summary: 'بدو حدا', at: before(MIN).toISOString(), resolved_at: null, sla_note_sent_at: null, claimed_at: null, claimed_by: null,
    });
  });

  test('a sweep that dies after its claim and before the intent row → reclaimed after 2 min, exactly one note', async () => {
    seedBusiness();
    const conv = seedPending();
    replyBatcher.dispatchIntent.mockRejectedValueOnce(new Error('instance killed'));

    const first = await runSweep({ now: NOW });
    expect(first.errors.some((e) => e.includes('instance killed'))).toBe(true);
    expect(alertsFor('sla_breached')).toHaveLength(0);
    expect(storedNeedsTeam(conv.id)).toMatchObject({ sla_note_sent_at: NOW.toISOString(), sla_note_attempt: 1 });
    expect(storedNeedsTeam(conv.id).sla_note_done_at).toBeUndefined();

    // Inside the claim's 2 minutes another sweep may still be working on it.
    await runSweep({ now: at(MIN) });
    expect(notesOf('sla_note')).toHaveLength(1);

    await runSweep({ now: at(3 * MIN) });
    expect(notesOf('sla_note')).toHaveLength(2);
    expect(db.store.messages.filter((m) => m.raw_payload && m.raw_payload.kind === 'sla_note')).toHaveLength(1);
    expect(alertsFor('sla_breached')).toHaveLength(1);
    expect(storedNeedsTeam(conv.id)).toMatchObject({ sla_note_attempt: 2, sla_note_done_at: at(3 * MIN).toISOString() });

    await runSweep({ now: at(10 * MIN) });
    expect(notesOf('sla_note')).toHaveLength(2);
    expect(alertsFor('sla_breached')).toHaveLength(1);
  });

  test('a sweep that dies after the intent row was written → the reclaim finishes the bookkeeping and never sends again', async () => {
    seedBusiness();
    const conv = seedPending();
    replyBatcher.dispatchIntent.mockImplementationOnce(async (args) => {
      await fakeDispatch(args);
      throw new Error('instance killed after dispatch');
    });

    await runSweep({ now: NOW });
    await runSweep({ now: at(3 * MIN) });

    expect(notesOf('sla_note')).toHaveLength(1);
    expect(alertsFor('sla_breached')).toHaveLength(1);
    expect(storedNeedsTeam(conv.id).sla_note_done_at).toBe(at(3 * MIN).toISOString());
  });

  test("a claim written by PR1's first sweeper (no attempt counter) counts as handled", async () => {
    seedBusiness();
    seedPending({ sla_note_sent_at: before(20 * MIN).toISOString() });
    await runSweep({ now: NOW });
    expect(notesOf('sla_note')).toHaveLength(0);
    expect(alertsFor('sla_breached')).toHaveLength(0);
  });

  test('24 h window closing within the note margin → no note, staff still alerted', async () => {
    seedBusiness();
    seedPending({}, {});
    const conv = db.store.conversations[0];
    conv.last_inbound_at = before(24 * HOUR - NOTE_WINDOW_MARGIN_MS + MIN);
    await runSweep({ now: NOW });
    expect(notesOf('sla_note')).toHaveLength(0);
    expect(alertsFor('sla_breached')).toHaveLength(1);
    expect(alertsFor('sla_breached')[0].summary).toContain('window_closed');
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

describe('2b/3b. note dispatch is fenced on the claim (takeover after NOTE_CLAIM_TTL_MS)', () => {
  test('SLA note: the pre-send check carries the request and attempt; a claim lost meanwhile → no alert, no done mark', async () => {
    seedBusiness();
    const requestAt = before(16 * MIN).toISOString();
    const conv = seedConversation({
      status: 'pending',
      workflow_data: { needs_team: { reason: 'quote', summary: 's', at: requestAt, resolved_at: null, sla_note_sent_at: null, claimed_at: null, claimed_by: null } },
    });
    replyBatcher.dispatchIntent.mockImplementationOnce(async (args) => {
      expect(args.precheck.claim).toEqual([
        { column: 'workflow_data', path: ['needs_team', 'at'], value: requestAt },
        { column: 'workflow_data', path: ['needs_team', 'sla_note_attempt'], value: 1 },
      ]);
      // Another sweep took the claim over while this one stalled; the real pre-send check refuses.
      storedConversation(conv.id).workflow_data.needs_team.sla_note_attempt = 2;
      return { outcome: 'aborted', parts: [{ index: 0, status: 'aborted', reason: 'precheck', id: null, intentId: 'x' }] };
    });

    await runSweep({ now: NOW });

    expect(alertsFor('sla_breached')).toHaveLength(0);
    expect(storedConversation(conv.id).workflow_data.needs_team.sla_note_done_at).toBeUndefined();
  });

  test('SLA note refused for another reason (staff claimed) while the claim is still ours → alert and done mark as before', async () => {
    seedBusiness();
    const conv = seedConversation({
      status: 'pending',
      workflow_data: { needs_team: { reason: 'quote', summary: 's', at: before(16 * MIN).toISOString(), resolved_at: null, sla_note_sent_at: null, claimed_at: null, claimed_by: null } },
    });
    replyBatcher.dispatchIntent.mockResolvedValueOnce({ outcome: 'aborted', parts: [] });

    await runSweep({ now: NOW });

    expect(alertsFor('sla_breached')).toHaveLength(1);
    expect(storedConversation(conv.id).workflow_data.needs_team.sla_note_done_at).toBe(NOW.toISOString());
  });

  test('awaiting note: fenced on awaiting_note_for and on an opt-out during the silence; a lost claim → no alert', async () => {
    seedBusiness();
    db.seed({ users: [{ id: 'user_1', name: 'رنا', business_id: BIZ }] });
    const conv = seedConversation({ status: 'human_takeover', ai_enabled: false, assigned_staff_id: 'user_1' });
    const q = seedMessage({ conversation_id: conv.id, status: 'awaiting_staff', text_body: 'وينكم؟', created_at: before(11 * MIN) });
    replyBatcher.dispatchIntent.mockImplementationOnce(async (args) => {
      expect(args.precheck).toEqual({
        humanGuard: false,
        optedOutSince: new Date(q.created_at),
        claim: [{ column: 'metadata', path: ['awaiting_note_for'], value: `${q.id}#1` }],
      });
      storedConversation(conv.id).metadata = { ...storedConversation(conv.id).metadata, awaiting_note_for: `${q.id}#2` };
      return { outcome: 'aborted', parts: [] };
    });

    await runSweep({ now: NOW });

    expect(alertsFor('awaiting_staff')).toHaveLength(0);
    expect(storedConversation(conv.id).metadata.awaiting_note_done_for).toBeUndefined();
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
    expect(notes[0].parts).toEqual([{ type: 'text', text: acks.awaitingStaffNote({ staffName: 'رنا', lang: 'ar' }) }]);
    // Sent while staff hold the conversation (humanGuard off), tied to this silence.
    expect(notes[0]).toMatchObject({ batchIds: [], batchKey: `awaiting_note:${q.id}`, precheck: { humanGuard: false } });
    expect(alertsFor('awaiting_staff')).toHaveLength(1);
    expect(report.awaiting_notes).toBe(1);
    expect(storedConversation(conv.id).metadata).toMatchObject({ awaiting_note_for: `${q.id}#1`, awaiting_note_done_for: q.id });
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

  // GPT-6 #10: «price please» used to be silenced as a ≤ 3-word closer.
  test('a short request is not a closer → note', async () => {
    seedBusiness();
    const conv = seedTakeover();
    seedMessage({ conversation_id: conv.id, status: 'awaiting_staff', text_body: 'price please', created_at: before(15 * MIN) });
    await runSweep({ now: NOW });
    expect(notesOf('awaiting_note')).toHaveLength(1);
  });

  test('a sweep that dies after its claim → reclaimed after 2 min, one note', async () => {
    seedBusiness();
    const conv = seedTakeover();
    const q = seedMessage({ conversation_id: conv.id, status: 'awaiting_staff', text_body: 'وينكم؟', created_at: before(11 * MIN) });
    replyBatcher.dispatchIntent.mockRejectedValueOnce(new Error('instance killed'));

    await runSweep({ now: NOW });
    await runSweep({ now: at(MIN) });
    expect(notesOf('awaiting_note')).toHaveLength(1);
    expect(alertsFor('awaiting_staff')).toHaveLength(0);

    await runSweep({ now: at(3 * MIN) });
    await runSweep({ now: at(4 * MIN) });
    expect(notesOf('awaiting_note')).toHaveLength(2);
    expect(db.store.messages.filter((m) => m.raw_payload && m.raw_payload.kind === 'awaiting_note')).toHaveLength(1);
    expect(alertsFor('awaiting_staff')).toHaveLength(1);
    expect(storedConversation(conv.id).metadata).toMatchObject({ awaiting_note_for: `${q.id}#2`, awaiting_note_done_for: q.id });
  });

  test("a claim written by PR1's first sweeper (bare row id) counts as handled", async () => {
    seedBusiness();
    const conv = seedTakeover();
    const q = seedMessage({ conversation_id: conv.id, status: 'awaiting_staff', text_body: 'وينكم؟', created_at: before(30 * MIN) });
    storedConversation(conv.id).metadata = { awaiting_note_for: q.id };
    await runSweep({ now: NOW });
    expect(notesOf('awaiting_note')).toHaveLength(0);
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

  test('no assigned staff (a staff pause still running) → «الفريق»', async () => {
    seedBusiness();
    const conv = seedConversation({ status: 'open', metadata: { human_active_until: at(15 * MIN).toISOString() } });
    seedMessage({ conversation_id: conv.id, status: 'awaiting_staff', text_body: 'متى بتردوا؟', created_at: before(11 * MIN) });
    await runSweep({ now: NOW });
    expect(notesOf('awaiting_note')[0].parts[0].text).toBe(acks.awaitingStaffNote({ lang: 'ar' }));
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
    // The staff pause keeps the row parked (otherwise step 1a hands it back to the bot first).
    const withRow = seedConversation({ customer_wa_id: '962790000001', last_inbound_at: before(23 * HOUR), metadata: { human_active_until: at(10 * MIN).toISOString() } });
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

describe('5. unconfirmed intents (D18)', () => {
  test('every run hands unconfirmed intents to the batcher protocol, per SHIFT business, and reports its counts', async () => {
    seedBusiness();
    replyBatcher.reconcileUnconfirmedIntents.mockResolvedValue({ requeued: 2, escalated: 1, unreconciled: 3, errors: ['i1: boom'] });

    const report = await runSweep({ now: NOW });

    expect(replyBatcher.reconcileUnconfirmedIntents).toHaveBeenCalledTimes(1);
    expect(replyBatcher.reconcileUnconfirmedIntents).toHaveBeenCalledWith({ now: NOW, businessId: BIZ });
    expect(report).toMatchObject({ unconfirmed_requeued: 2, unconfirmed_escalated: 1, ambiguous_alerts: 3 });
    expect(report.errors).toContain(`unconfirmed ${BIZ}: i1: boom`);
  });

  test('the sweeper no longer flips old ambiguous or sending intents itself (their inbound rows would stay unconfirmed)', async () => {
    seedBusiness();
    const conv = seedConversation();
    const old = seedMessage({ conversation_id: conv.id, direction: 'outbound', status: 'ambiguous', text_body: 'أهلًا', created_at: before(11 * MIN) });
    const dead = seedMessage({ conversation_id: conv.id, direction: 'outbound', status: 'sending', text_body: 'أهلًا', created_at: before(3 * MIN) });

    await runSweep({ now: NOW });

    expect(statusOf(old.id)).toBe('ambiguous');
    expect(statusOf(dead.id)).toBe('sending');
    expect(alertsFor('ambiguous_send')).toHaveLength(0);
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
    // Younger than the 2 min after which reconcileUnconfirmedIntents settles it.
    seedMessage({ conversation_id: sending.id, direction: 'outbound', status: 'sending', text_body: 'أهلًا', created_at: before(90 * 1000) });
    // Refused by the pre-send check: it never left the server.
    const cancelled = seedConversation({ customer_wa_id: '962790000013', last_inbound_at: before(5 * MIN) });
    seedMessage({ conversation_id: cancelled.id, status: 'received', text_body: 'مرحبا', created_at: before(5 * MIN) });
    seedMessage({ conversation_id: cancelled.id, direction: 'outbound', status: 'cancelled', text_body: 'أهلًا', created_at: before(4 * MIN) });

    await runSweep({ now: NOW });
    expect(alertsFor('inbound_without_outbound').map((a) => a.conversation.id).sort()).toEqual([failed.id, sending.id, cancelled.id].sort());
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

    const awaiting = seedConversation({ customer_wa_id: '962790000003', last_inbound_at: before(5 * MIN), metadata: { human_active_until: at(20 * MIN).toISOString() } });
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
      stuck_inbound: { reprocessed: 0 }, unconfirmed_requeued: 0, unconfirmed_escalated: 0, ambiguous_alerts: 0,
      pause_requeued: 0, orphans: 0, sla_notes: 0, awaiting_notes: 0, window_flags: 0, unanswered_alerts: 0, errors: [],
    });
  });

  test('D24: stuck non-SHIFT inbound is re-processed once per run, even with no SHIFT business', async () => {
    seedBusiness({ business_type: 'restaurant' });
    const report = await runSweep({ now: NOW });
    expect(messageProcessor.reprocessStuckInbound).toHaveBeenCalledTimes(1);
    expect(messageProcessor.reprocessStuckInbound).toHaveBeenCalledWith({ olderThanMs: 2 * MIN, now: NOW });
    expect(report.stuck_inbound).toEqual({ reprocessed: 0 });
    expect(replyBatcher.reconcileUnconfirmedIntents).not.toHaveBeenCalled();
  });

  test('a failing reprocessStuckInbound is reported and the SHIFT steps still run', async () => {
    seedBusiness();
    messageProcessor.reprocessStuckInbound.mockRejectedValue(new Error('processor down'));
    const report = await runSweep({ now: NOW });
    expect(report.errors).toContain('stuck_inbound: processor down');
    expect(replyBatcher.reconcileUnconfirmedIntents).toHaveBeenCalledTimes(1);
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
    seedMessage({ conversation_id: conv.id, status: 'unconfirmed', created_at: before(3 * MIN) });
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
      unconfirmed: 1,
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
