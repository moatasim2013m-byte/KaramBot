/**
 * calendlyChat.test.js — Calendly mode in the chat (owner decision 2026-09-19).
 *
 * Every path that offered `book:` slot buttons sends ONE cta_url with the personalised Calendly link instead:
 * a booking intent (agreeing to a call, «متى نحكي؟»), a captured free-text time, a blocked invented
 * appointment, a status question with nothing booked, a change request with nothing booked, the «مكالمة» tap.
 * Change / cancel of a Calendly booking send its stored reschedule / cancel URL. The link is never a booking:
 * the claim validators still block «ثبّتنا» when only the link went out. 'inchat' keeps PR3's slots.
 * The model, the calendar client and the DB are mocked; nothing reaches the network.
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
  listEvents: jest.fn(),
}));

const { generateValidatedAIReply } = require('../src/ai/provider');
const calendar = require('../src/services/googleCalendar');
const { processShiftBatch } = require('../src/workflows/shift');
const booking = require('../src/workflows/shift/booking');
const buttons = require('../src/workflows/shift/buttons');
const calendly = require('../src/workflows/shift/calendly');
const context = require('../src/workflows/shift/context');
const promptAr = require('../src/workflows/shift/prompt.ar');
const validators = require('../src/workflows/shift/validators');

const CAL = 'sales@group.calendar.google.com';
const URL_BASE = 'https://calendly.com/shift-ai/30min';
const MON_10 = new Date('2026-09-14T07:00:00.000Z');
const TOMORROW_9AM = '2026-09-15T06:00:00.000Z';
const CANCEL = 'https://calendly.com/cancellations/AAAA';
const RESCHED = 'https://calendly.com/reschedulings/AAAA';
const LINK_BIZ = { id: 'biz1', name: 'SHIFT', ai_config: { calendly_url: URL_BASE } };
const INCHAT_BIZ = { id: 'biz1', name: 'SHIFT', ai_config: { calendly_url: URL_BASE, booking_mode: 'inchat' } };

beforeEach(() => {
  for (const fn of Object.values(calendar)) fn.mockReset();
  generateValidatedAIReply.mockReset();
  booking.resetBusyCache();
  process.env.SHIFT_SALES_CALENDAR_ID = CAL;
  calendar.freeBusy.mockResolvedValue({ ok: true, busy: [] });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.SHIFT_SALES_CALENDAR_ID;
});

function conv({ stage = 'discovery', status = 'open', wd = {}, lead = { name: 'معتصم', business_name: 'بيكابو', version: 2 } } = {}) {
  return {
    id: 'conv1', status, current_state: stage, customer_wa_id: '962790000001', profile_name: 'معتصم',
    workflow_data: { lead, bot_turns: 3, ...wd },
  };
}

function calendlyBooking(extra = {}) {
  return {
    event_id: 'calev1', calendar_id: CAL, start: TOMORROW_9AM, end: '2026-09-15T06:30:00.000Z', tz: 'Asia/Amman',
    status: 'booked', booked_at: MON_10.toISOString(), seq: 1, lang: 'ar', reminders: {}, history: [],
    source: 'calendly', cancel_url: CANCEL, reschedule_url: RESCHED, ...extra,
  };
}

const batch = (texts) => texts.map((t, i) => ({ id: `m${i + 1}`, direction: 'inbound', message_type: 'text', text_body: t }));
const run = (c, texts, biz = LINK_BIZ) => processShiftBatch(biz, c, batch(texts), { now: MON_10 });
const model = (fields) => ({ reply: '', action: 'NONE', action_args: {}, buttons: [], lead: {}, stage: 'close', next_step: 'buttons', ...fields });
const ctas = (r) => r.messages.filter((p) => p.type === 'cta_url');
const allButtonIds = (r) => r.messages.flatMap((p) => (Array.isArray(p.buttons) ? p.buttons.map((b) => b.id) : []));
const text = (r) => r.messages.map((p) => String(p.text || '')).join('\n');

function expectOneLink(r, { kind = 'book' } = {}) {
  const list = ctas(r);
  expect(list).toHaveLength(1);
  const part = list[0];
  expect(part.bookingLink).toEqual({ kind });
  expect(part.displayText).toBe(calendly.displayText(kind, 'ar'));
  expect(allButtonIds(r).some((id) => id.startsWith('book:') || id.startsWith('slot:'))).toBe(false);
  return part;
}

function expectPersonalLink(part) {
  const u = new URL(part.url);
  expect(u.origin + u.pathname).toBe(URL_BASE);
  expect(u.searchParams.get('a1')).toBe('+962790000001');
  expect(u.searchParams.get('name')).toBe('معتصم');
  expect(u.searchParams.get('utm_source')).toBe('whatsapp');
  expect(u.searchParams.get('utm_campaign')).toBe('karam');
}

describe('replaced slot-offer paths (calendly mode)', () => {
  test('booking intent: agreeing to a call without a time → one cta_url, no calendar lookup', async () => {
    generateValidatedAIReply.mockResolvedValue(model({ reply: 'تمام.', action: 'CAPTURE_TIME', action_args: {} }));
    const r = await run(conv({ stage: 'close' }), ['طيب يلا نحكي']);
    const part = expectOneLink(r);
    expectPersonalLink(part);
    expect(part.text).toContain(calendly.bodyText('book', 'ar'));
    expect(calendar.freeBusy).not.toHaveBeenCalled();
    expect(r.workflowDataPatch.slot_offers).toBeUndefined();
  });

  test('«متى نحكي؟»: the model picks the book_link «button» → the CTA', async () => {
    generateValidatedAIReply.mockResolvedValue(model({ reply: 'أكيد، ببعتلك رابط الحجز.', buttons: [{ id: 'book_link', title: 'احجز موعدك' }] }));
    const r = await run(conv({ stage: 'close' }), ['متى نحكي؟']);
    const part = expectOneLink(r);
    expect(part.text.startsWith('أكيد، ببعتلك رابط الحجز.')).toBe(true);
  });

  test('an explicit time request the model answered with text only: the validators inject the CTA, not slots', async () => {
    generateValidatedAIReply.mockResolvedValue(model({ reply: 'أكيد.', stage: 'close' }));
    const r = await run(conv({ stage: 'close' }), ['بدي مكالمة']);
    expectOneLink(r);
  });

  test('a captured free-text time: an honest request ack, then the link (never book: slots)', async () => {
    generateValidatedAIReply.mockResolvedValue(model({ reply: 'تمام.', action: 'CAPTURE_TIME', action_args: { time_text: 'بكرا الساعة 11' }, stage: 'captured' }));
    const r = await run(conv({ stage: 'close' }), ['خلينا نحكي بكرا الساعة 11']);
    expect(r.action).toBe('CAPTURE_TIME');
    expect(text(r)).toMatch(/طلب/);
    expectOneLink(r);
  });

  test('a blocked invented appointment is replaced by the link', async () => {
    generateValidatedAIReply.mockResolvedValue(model({ reply: 'أقرب موعد متوفر هو الأربعاء الساعة 10:00 الصبح.', stage: 'close' }));
    const r = await run(conv({ stage: 'close' }), ['تمام']);
    expectOneLink(r);
    expect(text(r)).not.toContain('الأربعاء');
  });

  test('a status question with nothing booked: said plainly, and the link', async () => {
    const r = await run(conv(), ['متى موعدنا؟']);
    expect(generateValidatedAIReply).not.toHaveBeenCalled();
    const part = expectOneLink(r);
    expect(part.text).toContain('ما في موعد محجوز حاليًا.');
  });

  test('status when only the link was sent: «بعتتلك رابط الحجز، بس لسه ما في موعد محجوز» and the link again', async () => {
    const r = await run(conv({ wd: { booking_link: { sent_at: MON_10.toISOString(), count: 1 } } }), ['شو صار بموعدنا؟']);
    const part = expectOneLink(r);
    expect(part.text).toContain('بعتتلك رابط الحجز، بس لسه ما في موعد محجوز.');
    expect(part.text).not.toMatch(/محجوزة|ثبّتنا/);
  });

  test('status with a call request open: a request, not a booking, plus the link', async () => {
    const c = conv({ stage: 'captured', status: 'pending', lead: { name: 'معتصم', preferred_time: { text: 'بكرا 10–12' }, version: 2 } });
    const part = expectOneLink(await run(c, ['متى موعدنا؟']));
    expect(part.text).toMatch(/طلب، مش موعد مؤكد/);
  });

  test('a change request with nothing booked (only the link sent): the link again', async () => {
    const r = await run(conv({ wd: { booking_link: { sent_at: MON_10.toISOString(), count: 1 } } }), ['بدي أغيّر الموعد']);
    expect(generateValidatedAIReply).not.toHaveBeenCalled();
    expectOneLink(r);
  });

  test('a change request with only a call request on file: the link', async () => {
    const c = conv({ stage: 'captured', status: 'pending', lead: { name: 'معتصم', preferred_time: { text: 'بكرا 10–12' }, version: 2 } });
    expectOneLink(await run(c, ['بدي أغيّر الموعد']));
  });

  test('the «مكالمة» tap (lead_call) gets the link', () => {
    const r = buttons.handleButton('lead_call', { business: LINK_BIZ, conversation: conv(), now: MON_10, lang: 'ar' });
    const part = expectOneLink(r);
    expectPersonalLink(part);
  });
});

describe('a Calendly booking on record', () => {
  test('status: unchanged — the absolute day and Amman time from the same record', async () => {
    const r = await run(conv({ stage: 'captured', status: 'pending', wd: { booking: calendlyBooking() } }), ['متى موعدنا؟']);
    expect(text(r)).toContain('مكالمتك مع فريق شِفت محجوزة');
    expect(ctas(r)).toHaveLength(0);
  });

  test('change → its reschedule URL as «غيّر الموعد»; nothing claimed to have changed', async () => {
    const r = await run(conv({ stage: 'captured', status: 'pending', wd: { booking: calendlyBooking() } }), ['بدي أغيّر الموعد']);
    const part = expectOneLink(r, { kind: 'reschedule' });
    expect(part.url).toBe(RESCHED);
    expect(part.text).toContain('موعدك الحالي بضل زي ما هو');
    expect(r.workflowDataPatch.booking).toBeUndefined();
    expect(calendar.patchEvent).not.toHaveBeenCalled();
  });

  test('the [غيّر الموعد] tap does the same', async () => {
    const r = await booking.handleBookingTap('book_change', { business: LINK_BIZ, conversation: conv({ wd: { booking: calendlyBooking() } }), now: MON_10, lang: 'ar' });
    expect(expectOneLink(r, { kind: 'reschedule' }).url).toBe(RESCHED);
  });

  test('change without a reschedule URL: the main link and a staff task to cancel the old one', async () => {
    const r = await booking.handleBookingTap('book_change', {
      business: LINK_BIZ, conversation: conv({ wd: { booking: calendlyBooking({ reschedule_url: null }) } }), now: MON_10, lang: 'ar',
    });
    const part = expectOneLink(r);
    expectPersonalLink(part);
    expect(part.text).toContain('الموعد القديم بضل لحد ما يلغيه الفريق');
    expect(r.workflowDataPatch.staff_tasks.map((t) => t.kind)).toEqual(['cancel_old_booking']);
    expect(r.alert.reason).toBe('booking_change_request');
  });

  test('cancel («بدي ألغي») → its cancel URL as «ألغِ الموعد»; the calendar event is never deleted by the bot', async () => {
    const r = await run(conv({ stage: 'captured', status: 'pending', wd: { booking: calendlyBooking() } }), ['بدي ألغي المكالمة']);
    const part = expectOneLink(r, { kind: 'cancel' });
    expect(part.url).toBe(CANCEL);
    expect(text(r)).not.toMatch(/لغيت|ألغيت/);
    expect(calendar.deleteEvent).not.toHaveBeenCalled();
  });

  test('the [ألغِ المكالمة] tap without a cancel URL: the team is asked, the customer is not told it is cancelled', async () => {
    const r = await booking.handleBookingTap('book_cancel', {
      business: LINK_BIZ, conversation: conv({ wd: { booking: calendlyBooking({ cancel_url: null }) } }), now: MON_10, lang: 'ar',
    });
    expect(ctas(r)).toHaveLength(0);
    expect(text(r)).toContain('وصّلت طلب الإلغاء للفريق');
    expect(r.workflowDataPatch.booking.status).toBe('booked');
    expect(r.workflowDataPatch.staff_tasks.map((t) => t.kind)).toEqual(['cancel_calendly']);
    expect(calendar.deleteEvent).not.toHaveBeenCalled();
  });

  test('after a revert to in-chat, a Calendly booking is still changed through its own link (never patched)', async () => {
    const r = await booking.handleBookingTap('book_change', { business: INCHAT_BIZ, conversation: conv({ wd: { booking: calendlyBooking() } }), now: MON_10, lang: 'ar' });
    expect(expectOneLink(r, { kind: 'reschedule' }).url).toBe(RESCHED);
    const tap = await booking.handleBookingTap('book:2026-09-16T06:00:00.000Z', { business: INCHAT_BIZ, conversation: conv({ wd: { booking: calendlyBooking() } }), now: MON_10, lang: 'ar' });
    expect(ctas(tap)).toHaveLength(1);
    expect(calendar.patchEvent).not.toHaveBeenCalled();
    expect(calendar.insertEvent).not.toHaveBeenCalled();
  });

  test('an in-chat booking in calendly mode: change → main link + staff task; cancel still deletes the bot’s own event', async () => {
    const own = calendlyBooking({ event_id: 'shown1', source: undefined, cancel_url: undefined, reschedule_url: undefined });
    const change = await booking.handleBookingTap('book_change', { business: LINK_BIZ, conversation: conv({ wd: { booking: own } }), now: MON_10, lang: 'ar' });
    expectOneLink(change);
    expect(change.workflowDataPatch.staff_tasks[0].kind).toBe('cancel_old_booking');
    calendar.deleteEvent.mockResolvedValue({ ok: true });
    const cancel = await booking.handleBookingTap('book_cancel', { business: LINK_BIZ, conversation: conv({ wd: { booking: own } }), now: MON_10, lang: 'ar' });
    expect(calendar.deleteEvent).toHaveBeenCalledWith(CAL, 'shown1', expect.anything());
    expect(cancel.workflowDataPatch.booking.status).toBe('cancelled');
  });

  test('syncEventDetails never patches a Calendly event (Calendly owns its description)', async () => {
    const r = await booking.syncEventDetails({
      business: LINK_BIZ, conversation: conv({ wd: { booking: calendlyBooking({ details_pending: true, details_missing: ['name'] }) } }),
      lead: { name: 'x' }, now: MON_10,
    });
    expect(r).toEqual({ ok: false, reason: 'not_needed' });
    expect(calendar.patchEvent).not.toHaveBeenCalled();
  });
});

describe('the link is never a booking', () => {
  const vctx = (extra = {}) => ({
    lang: 'ar', stage: 'close', attempt: 1, bookingEnabled: true, bookingLink: { url: URL_BASE, lang: 'ar' },
    booking: null, batchTexts: ['تمام'], offers: [calendly.linkOffer('ar')], allowedButtonIds: ['book_link'], ...extra,
  });
  const reply = (line) => ({ kind: 'reply', action: 'NONE', messages: [{ type: 'text', text: line, modelLine: line }], workflowDataPatch: {} });

  test.each([
    'ثبّتنا موعدك يوم الأربعاء',
    'حجزتلك المكالمة',
    "You're booked for Wednesday",
    'بعتتلك الرابط وموعدك مؤكد',
  ])('with only the link sent, «%s» is blocked', (line) => {
    const v = validators.validateResult(reply(line), vctx());
    expect(v.verdict).toBe('regenerate');
  });

  test('«ببعتلك رابط الحجز» passes', () => {
    expect(validators.validateResult(reply('أكيد، ببعتلك رابط الحجز.'), vctx()).verdict).toBe('ok');
  });

  test('an invented time is blocked in calendly mode, and the hint points at the link', () => {
    const v = validators.validateResult(reply('أقرب موعد متوفر هو الأربعاء الساعة 10 الصبح.'), vctx());
    expect(v.verdict).toBe('regenerate');
    expect(v.hint).toContain('رابط الحجز');
  });

  test('the model context says the link was sent and nothing is booked', () => {
    const line = booking.contextLine({ booking_link: { sent_at: MON_10.toISOString() } }, MON_10, { linkMode: true });
    expect(line).toContain('لسه ما حجز');
    expect(line).toContain('لا تقل إنه محجوز');
  });
});

describe('prompt', () => {
  test('the calendly static prompt has no slot-button instructions and allows «ببعتلك رابط الحجز»', () => {
    const p = promptAr.buildStaticPrompt({ sector: 'clinic', bookingMode: 'calendly' });
    expect(p).not.toContain('أزرار الوقت');
    expect(p).toContain('ببعتلك رابط الحجز');
    expect(p).toContain('إرسال الرابط مش حجز');
    expect(promptAr.buildStaticPrompt({ sector: 'clinic' })).toContain('أزرار الوقت');
  });

  test('the user turn tells the model the link books, and the only offer is book_link', () => {
    const turn = context.buildUserTurn({
      business: LINK_BIZ, conversation: conv({ stage: 'close' }), batchMessages: batch(['متى نحكي؟']), history: [], now: MON_10,
      lang: 'ar', offers: [calendly.linkOffer('ar')], bookingLinkMode: true, stage: 'close',
    });
    expect(turn).toContain('الحجز بالرابط');
    expect(turn).toContain('book_link «احجز موعدك»');
    expect(turn).not.toContain('أزرار الوقت');
  });
});

describe("booking_mode 'inchat' keeps PR3's slots", () => {
  test('agreeing to a call offers real book: slots, no CTA', async () => {
    generateValidatedAIReply.mockResolvedValue(model({ reply: 'تمام.', action: 'CAPTURE_TIME', action_args: {} }));
    const r = await run(conv({ stage: 'close' }), ['طيب يلا نحكي'], INCHAT_BIZ);
    expect(ctas(r)).toHaveLength(0);
    expect(allButtonIds(r).some((id) => id.startsWith('book:'))).toBe(true);
  });
});
