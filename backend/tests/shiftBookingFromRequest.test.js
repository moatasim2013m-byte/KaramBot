/**
 * shiftBookingFromRequest.test.js — the owner's phone test of 17 Sep 2026, with booking live.
 *
 * The conversation was left at current_state='captured' / status='pending' by a PR2-era call REQUEST
 * (workflow_data.lead.preferred_time set, workflow_data.booking null). The owner wrote «بدي اغير الموعد»,
 * «بعد ساعه», «حكيتلك بعد ساعتين اليوم». The bot never offered a calendar slot and never created an event:
 * it improvised «شو اليوم والوقت الجديد؟» five times, invented «الساعة 12:00 تقريبًا», appended its own
 * «أي يوم ووقت بناسبك؟» under the model's question, and stored «اليوم بعد ساعتين» as a confirmed time.
 *
 * Every case here is that transcript, in Arabic and in English. The calendar client, the model and the DB
 * are mocked; nothing reaches the network.
 */
require('./setup');

jest.mock('../src/ai/provider', () => ({ generateValidatedAIReply: jest.fn() }));
jest.mock('../src/config/prisma', () => ({ message: { findMany: jest.fn(async () => []) } }));
jest.mock('../src/services/googleCalendar', () => ({
  freeBusy: jest.fn(),
  getEvent: jest.fn(),
  insertEvent: jest.fn(),
  patchEvent: jest.fn(),
  deleteEvent: jest.fn(),
}));

const { generateValidatedAIReply } = require('../src/ai/provider');
const calendar = require('../src/services/googleCalendar');
const { processShiftBatch } = require('../src/workflows/shift');
const { toWorkflowResult } = require('../src/workflows/shift/results');
const booking = require('../src/workflows/shift/booking');
const buttons = require('../src/workflows/shift/buttons');
const acks = require('../src/workflows/shift/acks');
const hours = require('../src/workflows/shift/hours');
const validators = require('../src/workflows/shift/validators');
const { mergeLead } = require('../src/workflows/shift/lead');

const CAL = 'sales@group.calendar.google.com';
// Monday 14 Sep 2026, 10:00 Amman — inside team hours, so both PR2 windows and calendar slots exist.
const MON_10 = new Date('2026-09-14T07:00:00.000Z');
const TODAY_1PM = '2026-09-14T10:00:00.000Z';
const TOMORROW_9AM = '2026-09-15T06:00:00.000Z';
const BIZ = { id: 'biz1', name: 'SHIFT', ai_config: {} };
const OFFERS_AR = buttons.slotOffers(hours.DEFAULT_TEAM_HOURS, MON_10, 'ar');

beforeEach(() => {
  for (const fn of Object.values(calendar)) fn.mockReset();
  generateValidatedAIReply.mockReset();
  booking.resetBusyCache();
  process.env.SHIFT_SALES_CALENDAR_ID = CAL;
  delete process.env.SHIFT_BOOKING;
  delete process.env.SHIFT_BUSY_CALENDAR_IDS;
  calendar.freeBusy.mockResolvedValue({ ok: true, busy: [] });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.SHIFT_SALES_CALENDAR_ID;
  delete process.env.SHIFT_BOOKING;
});

/** The conversation as production left it: a captured call REQUEST, no calendar event. */
function requestConv({ lang = 'ar', stage = 'captured', status = 'pending', wd = {} } = {}) {
  const lead = lang === 'en'
    ? { name: 'Sam', business_name: 'Peekaboo', language: 'en', preferred_time: { text: 'tomorrow 10–12' }, version: 3 }
    : { name: 'معتصم', business_name: 'بيكابو', preferred_time: { text: 'بكرا 10–12' }, version: 3 };
  return {
    id: 'conv1',
    status,
    current_state: stage,
    customer_wa_id: '962790000001',
    profile_name: 'معتصم',
    workflow_data: {
      lead,
      bot_turns: 6,
      needs_team: { reason: 'meeting', summary: 'بكرا 10–12', at: MON_10.toISOString(), resolved_at: null, claimed_at: null, sla_note_sent_at: null },
      ...wd,
    },
  };
}

function batch(texts) {
  return texts.map((t, i) => ({ id: `m${i + 1}`, direction: 'inbound', message_type: 'text', text_body: t }));
}

const run = (conversation, texts) => processShiftBatch(BIZ, conversation, batch(texts), { now: MON_10 });

const partText = (p) => String(p.text || '');
const buttonIds = (p) => (Array.isArray(p.buttons) ? p.buttons.map((b) => b.id) : []);

/** §5.8 and the transcript: one question per message, never the model's ask plus the server's. */
function expectOneQuestion(r) {
  for (const p of r.messages) expect(validators.countQuestions(partText(p))).toBeLessThanOrEqual(1);
}

/** Real calendar slots, not PR2's window offers. */
function expectSlotButtons(part) {
  expect(part.type).toBe('interactive');
  const ids = buttonIds(part);
  expect(ids.filter((id) => id.startsWith('book:')).length).toBeGreaterThan(0);
  expect(ids[ids.length - 1]).toBe('slot:other');
  expect(ids.some((id) => id.startsWith('slot:2'))).toBe(false);
}

// ─── the intents a captured request must answer ──────────────────────────────

describe('textIntent with a captured call request and no calendar event', () => {
  const requestWd = () => requestConv().workflow_data;

  test.each([
    ['بدي اغير الموعد', 'change'],
    ['بدي أغيّر الموعد', 'change'],
    ['ممكن نغيّر الموعد؟', 'change'],
    ['بدي ألغي المكالمة', 'cancel'],
    ['please cancel the call', 'cancel'],
    ['Can we reschedule?', 'change'],
    ['ما بدي ألغي', null],
    ['شو بتعملوا للمطاعم؟', null],
  ])('%s → %s', (text, expected) => {
    expect(booking.textIntent([text], requestWd(), MON_10)).toBe(expected);
  });

  test('a pending slot tap («وقت ثاني») counts as a request too; nothing open → no intent', () => {
    expect(booking.textIntent(['بدي أغيّر الموعد'], { capture_pending: { slot_id: 'other', time_text: null, at: MON_10.toISOString() } }, MON_10)).toBe('change');
    expect(booking.textIntent(['بدي أغيّر الموعد'], { lead: { name: 'معتصم' } }, MON_10)).toBeNull();
    expect(booking.textIntent(['بدي أغيّر الموعد'], {}, MON_10)).toBeNull();
  });

  test('requestOpen:false (handoff / closed) keeps the request out of the deterministic path', () => {
    expect(booking.textIntent(['بدي أغيّر الموعد'], requestWd(), MON_10, { requestOpen: false })).toBeNull();
  });
});

describe('«بدي اغير الموعد» on a captured request', () => {
  test('AR: the calendar\'s free slots, no model call, no improvised question', async () => {
    const r = await run(requestConv(), ['بدي اغير الموعد']);
    expect(generateValidatedAIReply).not.toHaveBeenCalled();
    expect(r.messages).toHaveLength(1);
    expect(partText(r.messages[0])).toBe(`أكيد. ${acks.slotsBody('ar')}`);
    expectSlotButtons(r.messages[0]);
    expect(r.workflowDataPatch.slot_offers.map((o) => o.id)).toEqual(buttonIds(r.messages[0]));
    expectOneQuestion(r);
    // Nothing is claimed about a booking that does not exist.
    expect(partText(r.messages[0])).not.toMatch(/ثبّتنا|غيّرنا|لغيت/);
    expect(r.workflowDataPatch.booking).toBeUndefined();
  });

  test('EN: the same, in English', async () => {
    const r = await run(requestConv({ lang: 'en' }), ['I want to change the time']);
    expect(generateValidatedAIReply).not.toHaveBeenCalled();
    expect(partText(r.messages[0])).toBe(`Sure. ${acks.slotsBody('en')}`);
    expectSlotButtons(r.messages[0]);
    expectOneQuestion(r);
  });

  test('the calendar is unreachable → PR2 behaviour: the day/time ask, nothing invented', async () => {
    calendar.freeBusy.mockResolvedValue({ ok: false, error: { kind: 'network' } });
    const r = await run(requestConv(), ['بدي اغير الموعد']);
    expect(r.messages[0].type).toBe('text');
    expect(partText(r.messages[0])).toBe(acks.slotOther('ar'));
    expect(r.workflowDataPatch.capture_pending).toMatchObject({ slot_id: 'other' });
    expect(r.alert).toBeNull();
    expectOneQuestion(r);
  });

  test('SHIFT_BOOKING=0 → the same PR2 ask, no calendar call', async () => {
    process.env.SHIFT_BOOKING = '0';
    const r = await run(requestConv(), ['بدي اغير الموعد']);
    expect(calendar.freeBusy).not.toHaveBeenCalled();
    expect(partText(r.messages[0])).toBe(acks.slotOther('ar'));
    expectOneQuestion(r);
  });

  test('handoff and closed stay locked: the model answers, no slot buttons', async () => {
    generateValidatedAIReply.mockResolvedValue({
      reply: 'الفريق بيرجعلك.', action: 'NONE', action_args: {}, stage: 'handoff', next_step: 'confirmed', buttons: [], lead: {},
    });
    for (const stage of ['handoff', 'closed']) {
      generateValidatedAIReply.mockClear();
      const r = await run(requestConv({ stage, status: 'pending' }), ['بدي اغير الموعد']);
      expect(generateValidatedAIReply).toHaveBeenCalled();
      for (const p of r.messages) expect(buttonIds(p).some((id) => id.startsWith('book:'))).toBe(false);
    }
  });

  test('a role-play example is never interrupted by the booking path', async () => {
    process.env.SHIFT_ROLEPLAY = '1';
    generateValidatedAIReply.mockResolvedValue({
      reply: 'تمام، بغيّرلك الطلب.', action: 'NONE', action_args: {}, stage: 'roleplay', next_step: 'question', buttons: [], lead: {},
    });
    const rp = {
      active: true, sector: 'restaurant', business_name: 'مطعم الساحة', facts: [], started_at: MON_10.toISOString(),
      last_turn_at: MON_10.toISOString(), turns: 1, setup_asks: 1, ended_at: null, end_reason: null,
    };
    const r = await run(requestConv({ stage: 'roleplay', status: 'open', wd: { roleplay: rp } }), ['بدي اغير الموعد']);
    expect(generateValidatedAIReply).toHaveBeenCalled();
    for (const p of r.messages) expect(buttonIds(p).some((id) => id.startsWith('book:'))).toBe(false);
    delete process.env.SHIFT_ROLEPLAY;
  });
});

describe('«بدي ألغي» on a captured request', () => {
  test('AR: an honest cancel of the request, the team\'s meeting entry resolved, no calendar call', async () => {
    const r = await run(requestConv(), ['بدي ألغي']);
    expect(generateValidatedAIReply).not.toHaveBeenCalled();
    expect(calendar.deleteEvent).not.toHaveBeenCalled();
    expect(partText(r.messages[0])).toBe('تمام، أوقفت طلب المكالمة. إذا حبيت نرتّب وقت ثاني احكيلي.');
    expect(partText(r.messages[0])).not.toContain('ما في مكالمة محجوزة');
    expect(r.stateUpdate).toMatchObject({ status: 'open', current_state: 'close' });
    expect(r.workflowDataPatch.capture_pending).toBeNull();
    expect(r.workflowDataPatch.needs_team).toBeUndefined();
    expect(r.needsTeamMerge).toMatchObject({ match: { reason: 'meeting' }, patch: { resolved_at: MON_10.toISOString() }, entry: null });
    expectOneQuestion(r);
  });

  test('EN: the English line, and another open request keeps the conversation pending', async () => {
    const wd = { needs_team: { reason: 'quote', summary: 'عرض سعر', at: MON_10.toISOString(), resolved_at: null, claimed_at: null, sla_note_sent_at: null } };
    const r = await run(requestConv({ lang: 'en', wd }), ['cancel the call please']);
    expect(partText(r.messages[0])).toBe("OK, I've stopped the call request. If you'd like to arrange another time, just tell me.");
    expect(r.stateUpdate.status).toBeUndefined();
    expect(r.needsTeamMerge).toBeFalsy();
  });
});

describe('a slot tapped from the captured request', () => {
  test('the event is created and the confirmation is the booked one', async () => {
    calendar.insertEvent.mockImplementation(async (cal, event) => ({ ok: true, event: { id: event.id, status: 'confirmed' } }));
    const r = await booking.handleBookingTap(`book:${TOMORROW_9AM}`, {
      business: BIZ,
      conversation: requestConv({ wd: { slot_offers: [{ id: `book:${TOMORROW_9AM}`, title: 'بكرا 9:00 الصبح', issued_at: MON_10.toISOString() }] } }),
      now: MON_10,
      lang: 'ar',
      messageId: 'm9',
    });
    expect(calendar.insertEvent).toHaveBeenCalledTimes(1);
    expect(partText(r.messages[0]).startsWith('ثبّتنا مكالمتك مع فريق شِفت: بكرا الساعة 9:00 الصبح')).toBe(true);
    expect(r.workflowDataPatch.booking).toMatchObject({ start: TOMORROW_9AM, status: 'booked' });
    expect(r.stateUpdate).toMatchObject({ status: 'pending', current_state: 'captured' });
  });
});

describe('«بدي أحكي معكم» / «احجزلي» on a captured request', () => {
  const agree = (reply, lang = 'ar') => ({
    reply, action: 'CAPTURE_TIME', action_args: {}, stage: lang === 'en' ? 'close' : 'close', next_step: 'buttons', buttons: [], lead: {},
  });

  test('AR: the captured stage no longer blocks the calendar — book: buttons, nothing stored', async () => {
    generateValidatedAIReply.mockResolvedValue(agree('تمام، بنرتّب مكالمة.'));
    const r = await run(requestConv(), ['بدي أحكي معكم']);
    const last = r.messages[r.messages.length - 1];
    expectSlotButtons(last);
    expect(r.action).not.toBe('CAPTURE_TIME');
    expect(r.capture).toBeFalsy();
    expectOneQuestion(r);
  });

  test('EN: «book me in» → the same slots', async () => {
    generateValidatedAIReply.mockResolvedValue(agree("Sure, let's set it up.", 'en'));
    const r = await run(requestConv({ lang: 'en' }), ['book me in']);
    expectSlotButtons(r.messages[r.messages.length - 1]);
    expectOneQuestion(r);
  });

  test('handoff stays locked: no slot buttons even with booking on', async () => {
    generateValidatedAIReply.mockResolvedValue(agree('تمام.'));
    const r = await run(requestConv({ stage: 'handoff' }), ['بدي أحكي معكم']);
    for (const p of r.messages) expect(buttonIds(p).some((id) => id.startsWith('book:'))).toBe(false);
  });
});

// ─── one question per message (transcript 07:51–07:58) ───────────────────────

describe('the server ask and the model ask never both go out', () => {
  const ctxFor = (over = {}) => ({
    business: BIZ,
    conversation: { id: 'c1', status: 'open', current_state: 'close', workflow_data: { lead: { name: 'معتصم', business_name: 'بيكابو', version: 1 }, bot_turns: 5 } },
    batchMessages: batch(['بدي أغير الموعد']),
    now: MON_10,
    lang: 'ar',
    offers: OFFERS_AR,
    ...over,
  });

  test('the model asked for a day and time and the server adds slot buttons → the model\'s question goes', () => {
    const r = toWorkflowResult({
      reply: 'شو اليوم والوقت الجديد اللي يناسبك نغيّر الموعد إله؟',
      action: 'CAPTURE_TIME', action_args: {}, stage: 'close', next_step: 'buttons', buttons: [], lead: {},
    }, ctxFor());
    const last = r.messages[r.messages.length - 1];
    expect(validators.countQuestions(partText(last))).toBeLessThanOrEqual(1);
    expect(partText(last)).not.toContain('شو اليوم والوقت الجديد');
    expect(buttonIds(last)).toEqual(OFFERS_AR.slice(0, 3).map((o) => o.id));
  });

  test('no offers to show → exactly one ask, never the model\'s plus «أي يوم ووقت بناسبك؟»', () => {
    const r = toWorkflowResult({
      reply: 'شو اليوم والوقت الجديد اللي يناسبك؟',
      action: 'CAPTURE_TIME', action_args: {}, stage: 'close', next_step: 'question', buttons: [], lead: {},
    }, ctxFor({ offers: [] }));
    const text = partText(r.messages[r.messages.length - 1]);
    expect(validators.countQuestions(text)).toBe(1);
    expect(text.includes('شو اليوم والوقت الجديد') && text.includes(acks.callTimeAsk('ar'))).toBe(false);
  });
});

// ─── the same ask, five times (transcript 07:51:22 → 07:58:37) ───────────────

describe('the same question is never sent twice unanswered', () => {
  const askCtx = ({ offers = OFFERS_AR, lastAsk, texts = ['اه'] } = {}) => ({
    business: BIZ,
    conversation: {
      id: 'c1', status: 'open', current_state: 'close',
      workflow_data: { lead: { name: 'معتصم', business_name: 'بيكابو', version: 1 }, bot_turns: 5, ...(lastAsk ? { last_ask: lastAsk } : {}) },
    },
    batchMessages: batch(texts),
    now: MON_10,
    lang: 'ar',
    offers,
  });
  const ask = (reply) => ({ reply, action: 'NONE', action_args: {}, stage: 'close', next_step: 'question', buttons: [], lead: {} });

  test('the first ask is recorded in workflow_data', () => {
    const r = toWorkflowResult(ask('شو اليوم والوقت الجديد اللي يناسبك؟'), askCtx());
    expect(r.workflowDataPatch.last_ask).toMatchObject({ key: 'time', count: 1 });
  });

  test('a near-identical repeat becomes the deterministic next step: the calendar\'s slots', () => {
    const r = toWorkflowResult(
      ask('شو اليوم والوقت الجديد اللي بناسبك نغيّر الموعد إله؟'),
      askCtx({ lastAsk: { key: 'time', count: 1, at: MON_10.toISOString() } }),
    );
    const last = r.messages[r.messages.length - 1];
    expect(buttonIds(last)).toEqual(OFFERS_AR.slice(0, 3).map((o) => o.id));
    expect(partText(last)).not.toContain('شو اليوم والوقت الجديد');
    expect(validators.countQuestions(partText(last))).toBeLessThanOrEqual(1);
  });

  test('no slots to offer: the server ask at most twice, then the team takes it', () => {
    const second = toWorkflowResult(
      ask('شو اليوم والوقت الجديد اللي بناسبك؟'),
      askCtx({ offers: [], lastAsk: { key: 'time', count: 1, at: MON_10.toISOString() } }),
    );
    expect(partText(second.messages[0])).toContain(acks.callTimeAsk('ar'));
    expect(validators.countQuestions(partText(second.messages[0]))).toBe(1);
    expect(second.workflowDataPatch.last_ask).toMatchObject({ key: 'time', count: 2 });
    expect(second.needsTeam).toBeFalsy();

    const third = toWorkflowResult(
      ask('شو اليوم والوقت الجديد اللي بناسبك؟'),
      askCtx({ offers: [], lastAsk: { key: 'time', count: 2, at: MON_10.toISOString() } }),
    );
    expect(validators.countQuestions(partText(third.messages[0]))).toBe(0);
    expect(third.needsTeamCandidate).toMatchObject({ reason: 'meeting' });
    expect(third.workflowDataPatch.last_ask).toBeNull();
  });

  test('a genuinely new question is never suppressed', () => {
    const r = toWorkflowResult(
      ask('شو نوع شغلك بالضبط؟'),
      askCtx({ offers: [], lastAsk: { key: 'time', count: 2, at: MON_10.toISOString() } }),
    );
    expect(partText(r.messages[0])).toContain('شو نوع شغلك بالضبط؟');
    expect(r.workflowDataPatch.last_ask).toMatchObject({ count: 1 });
  });
});

// ─── vague and referential times (transcript 07:52 and 07:59) ────────────────

describe('a vague or referential time is never stored as the call time', () => {
  const vagueCtx = ({ texts, offers = null, lang = 'ar' } = {}) => ({
    business: BIZ,
    conversation: requestConv({ stage: 'close', status: 'open' }),
    batchMessages: batch(texts),
    now: MON_10,
    lang,
    offers: offers || [
      { id: `book:${TODAY_1PM}`, title: 'اليوم 1:00 الظهر' },
      { id: `book:${TOMORROW_9AM}`, title: 'بكرا 9:00 الصبح' },
      { id: 'slot:other', title: 'وقت ثاني' },
    ],
  });

  test.each([
    ['حكيتلك بعد ساعتين اليوم', 'اليوم بعد ساعتين'],
    ['بعد ساعه', 'بعد ساعة'],
    ['بكره نفس الوقت', 'بكره نفس الوقت'],
  ])('«%s» → slots to tap, nothing stored', (customerText, modelTime) => {
    const r = toWorkflowResult({
      reply: 'تمام.', action: 'CAPTURE_TIME', action_args: { time_text: modelTime }, stage: 'close', next_step: 'buttons', buttons: [], lead: { preferred_time: modelTime },
    }, vagueCtx({ texts: [customerText] }));
    expect(r.action).not.toBe('CAPTURE_TIME');
    expect(r.capture).toBeFalsy();
    const saved = mergeLead({}, r.leadPatch || {}, r.leadMeta || { source: 'model', inboundText: '' }).lead;
    expect(saved.preferred_time).toBeUndefined();
    expect(r.alert).toBeNull();
    const last = r.messages[r.messages.length - 1];
    expect(buttonIds(last).some((id) => id.startsWith('book:'))).toBe(true);
    expect(validators.countQuestions(partText(last))).toBeLessThanOrEqual(1);
  });

  test('EN: "in an hour" is not a time either', () => {
    const r = toWorkflowResult({
      reply: 'Sure.', action: 'CAPTURE_TIME', action_args: { time_text: 'in an hour' }, stage: 'close', next_step: 'buttons', buttons: [], lead: {},
    }, vagueCtx({ texts: ['can we talk in an hour'], lang: 'en' }));
    expect(r.action).not.toBe('CAPTURE_TIME');
    expect(r.capture).toBeFalsy();
  });

  test('with the calendar off, a vague time is still not stored — the day/time ask instead', () => {
    process.env.SHIFT_BOOKING = '0';
    const r = toWorkflowResult({
      reply: 'تمام.', action: 'CAPTURE_TIME', action_args: { time_text: 'اليوم بعد ساعتين' }, stage: 'close', next_step: 'question', buttons: [], lead: {},
    }, vagueCtx({ texts: ['حكيتلك بعد ساعتين اليوم'], offers: [] }));
    expect(r.capture).toBeFalsy();
    const saved = mergeLead({}, r.leadPatch || {}, r.leadMeta || { source: 'model', inboundText: '' }).lead;
    expect(saved.preferred_time).toBeUndefined();
    expect(validators.countQuestions(partText(r.messages[0]))).toBe(1);
  });

  test('the customer\'s own clock time is still stored when booking is off (PR2 behaviour)', () => {
    process.env.SHIFT_BOOKING = '0';
    const r = toWorkflowResult({
      reply: 'تمام.', action: 'CAPTURE_TIME', action_args: { time_text: 'بكرا الساعة 5' }, stage: 'close', next_step: 'confirmed', buttons: [], lead: {},
    }, vagueCtx({ texts: ['طيب بكرا الساعة 5'], offers: [] }));
    expect(r.action).toBe('CAPTURE_TIME');
    expect(r.capture).toBeTruthy();
    expect(r.leadPatch.preferred_time).toBe('بكرا الساعة 5');
  });
});

// ─── an invented clock time (transcript 07:52:25) ────────────────────────────

describe('the digit guard and a clock time the customer never said', () => {
  test('«نرتّب الموعد اليوم الساعة 12:00 تقريبًا» is invented when the customer only said «بعد ساعه»', () => {
    const blocks = validators.checkDigits('تمام، نرتّب الموعد اليوم الساعة 12:00 تقريباً.', { batchTexts: ['بعد ساعه'] });
    expect(blocks.map((b) => b.code)).toContain('digits');
  });

  test('a clock time the customer wrote, or one the server offered, passes', () => {
    expect(validators.checkDigits('تمام، نرتّب المكالمة اليوم الساعة 12:00.', { batchTexts: ['بنفع الساعة 12؟'] })).toEqual([]);
    expect(validators.checkDigits('بنرتّب المكالمة بكرا الساعة 9:00 الصبح.', {
      batchTexts: ['بدي أحكي معكم'],
      offers: [{ id: `book:${TOMORROW_9AM}`, title: 'بكرا 9:00 الصبح' }],
    })).toEqual([]);
  });

  test('the team\'s hours are not an appointment time', () => {
    expect(validators.checkDigits('الفريق موجود من 9 الصبح لـ 6 المسا.', { batchTexts: ['متى بتشتغلوا؟'] })).toEqual([]);
  });
});

// ─── a voice note beside text (transcript 07:59:53) ──────────────────────────

describe('a batch of a voice note and a text', () => {
  test('one clean notice about the voice note, and the model never restates it', () => {
    const rows = [
      { id: 'm1', direction: 'inbound', message_type: 'audio', text_body: null },
      { id: 'm2', direction: 'inbound', message_type: 'text', text_body: 'بدي أغير الموعد' },
    ];
    const r = toWorkflowResult({
      reply: 'تمام أستاذ معتصم، بلاحظ الرسالة الصوتية وصلتك بالنص. رح أحط الموعد الجديد بالحسبان.',
      action: 'NONE', action_args: {}, stage: 'close', next_step: 'confirmed', buttons: [], lead: {},
    }, {
      business: BIZ,
      conversation: { id: 'c1', status: 'open', current_state: 'close', workflow_data: { lead: { name: 'معتصم', version: 1 }, bot_turns: 5 } },
      batchMessages: rows,
      now: MON_10,
      lang: 'ar',
      offers: OFFERS_AR,
    });
    const text = partText(r.messages[0]);
    const notice = acks.mediaPrefix('audio', 'ar');
    expect(text.startsWith(notice)).toBe(true);
    expect(text.split('الرسالة الصوتية').length - 1).toBeLessThanOrEqual(1);
    expect(text).not.toContain('وصلتك بالنص');
    expect(text).toContain('رح أحط الموعد الجديد بالحسبان');
  });
});
