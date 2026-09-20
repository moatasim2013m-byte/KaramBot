/**
 * shiftBooking.test.js — PR3 booking.js: candidate slots inside team hours, free-slot offers, book / reschedule /
 * cancel results with honest texts, text intents, template quick replies, reminder timing. The calendar client is
 * mocked; no network, no DB.
 */
require('./setup');

// lead.js (through results.js) must not build a real PrismaClient.
jest.mock('../src/config/prisma', () => ({}));
jest.mock('../src/services/googleCalendar', () => ({
  freeBusy: jest.fn(),
  getEvent: jest.fn(),
  insertEvent: jest.fn(),
  patchEvent: jest.fn(),
  deleteEvent: jest.fn(),
}));

const calendar = require('../src/services/googleCalendar');
const booking = require('../src/workflows/shift/booking');
const hours = require('../src/workflows/shift/hours');
const buttons = require('../src/workflows/shift/buttons');
const validators = require('../src/workflows/shift/validators');

const TH = hours.DEFAULT_TEAM_HOURS;
const MON_10 = new Date('2026-09-14T07:00:00.000Z'); // Monday 10:00 Amman
const CAL = 'sales@group.calendar.google.com';
const iso = (s) => new Date(s).toISOString();
const amman = (d) => {
  const p = hours.localParts(d, 'Asia/Amman');
  return `${p.dateKey} ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
};

beforeEach(() => {
  for (const fn of Object.values(calendar)) fn.mockReset();
  booking.resetBusyCache();
  process.env.SHIFT_SALES_CALENDAR_ID = CAL;
  delete process.env.SHIFT_BUSY_CALENDAR_IDS;
  delete process.env.SHIFT_BOOKING;
  delete process.env.SHIFT_SLOT_MINUTES;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.SHIFT_SALES_CALENDAR_ID;
  delete process.env.SHIFT_BUSY_CALENDAR_IDS;
  delete process.env.SHIFT_BOOKING;
});

// ─── configuration ───────────────────────────────────────────────────────────

describe('bookingConfig', () => {
  test('env overrides ai_config.calendar; the sales calendar is always read for busy times', () => {
    const business = { ai_config: { calendar: { sales_calendar_id: 'cfg-cal', busy_calendar_ids: ['cfg-busy'] } } };
    process.env.SHIFT_BUSY_CALENDAR_IDS = 'osaid@shifts-ai.com, ';
    const cfg = booking.bookingConfig(business);
    expect(cfg).toMatchObject({ configured: true, enabled: true, salesCalendarId: CAL, busyCalendarIds: [CAL, 'osaid@shifts-ai.com'], slotMinutes: 30, minLeadMinutes: 120, horizonDays: 5 });
  });

  test('ai_config only; busy defaults to the sales calendar', () => {
    delete process.env.SHIFT_SALES_CALENDAR_ID;
    const cfg = booking.bookingConfig({ ai_config: { calendar: { sales_calendar_id: 'cfg-cal' } } });
    expect(cfg).toMatchObject({ configured: true, enabled: true, salesCalendarId: 'cfg-cal', busyCalendarIds: ['cfg-cal'] });
  });

  test('no calendar id → unconfigured; SHIFT_BOOKING=0 → configured but disabled', () => {
    delete process.env.SHIFT_SALES_CALENDAR_ID;
    expect(booking.bookingConfig({ ai_config: {} })).toMatchObject({ configured: false, enabled: false });
    process.env.SHIFT_SALES_CALENDAR_ID = CAL;
    process.env.SHIFT_BOOKING = '0';
    expect(booking.bookingConfig({ ai_config: {} })).toMatchObject({ configured: true, enabled: false });
  });
});

// ─── slots ───────────────────────────────────────────────────────────────────

describe('candidate slots', () => {
  test('Monday 10:00: first slot 12:00 (2 h lead), 30-min steps inside 09:00–18:00, 5 team days', () => {
    const slots = booking.candidateSlots(TH, MON_10);
    expect(amman(slots[0].start)).toBe('2026-09-14 12:00');
    expect(amman(slots[1].start)).toBe('2026-09-14 12:30');
    const days = [...new Set(slots.map((s) => s.dateKey))];
    expect(days).toEqual(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-20']);
    expect(slots).toHaveLength(12 + 18 * 4);
    for (const s of slots) {
      const p = hours.localParts(s.start, TH.tz);
      expect(p.minutes).toBeGreaterThanOrEqual(9 * 60);
      expect(p.minutes + 30).toBeLessThanOrEqual(18 * 60);
      expect(s.end - s.start).toBe(30 * 60000);
    }
    expect(amman(slots[slots.length - 1].start)).toBe('2026-09-20 17:30');
  });

  test('lead time: Monday 16:30 → nothing left today, Tuesday 09:00 first', () => {
    const slots = booking.candidateSlots(TH, new Date('2026-09-14T13:30:00.000Z'));
    expect(amman(slots[0].start)).toBe('2026-09-15 09:00');
  });

  test('Thursday evening → Sunday 09:00; Friday and Saturday never offered', () => {
    const slots = booking.candidateSlots(TH, new Date('2026-09-17T16:00:00.000Z'));
    expect(amman(slots[0].start)).toBe('2026-09-20 09:00');
    expect(slots.some((s) => [5, 6].includes(hours.localParts(s.start, TH.tz).weekday))).toBe(false);
  });

  test('Friday noon → Sunday; a closure on Sunday → Monday', () => {
    expect(amman(booking.candidateSlots(TH, new Date('2026-09-18T09:00:00.000Z'))[0].start)).toBe('2026-09-20 09:00');
    const closed = hours.resolveTeamHours({ team_hours: { closures: ['2026-09-20'] } });
    const slots = booking.candidateSlots(closed, new Date('2026-09-17T16:00:00.000Z'));
    expect(amman(slots[0].start)).toBe('2026-09-21 09:00');
    expect(slots.some((s) => s.dateKey === '2026-09-20')).toBe(false);
  });

  test('custom team hours and slot length', () => {
    const th = hours.resolveTeamHours({ team_hours: { days: [6], from: '10:00', to: '12:00' } });
    const slots = booking.candidateSlots(th, new Date('2026-09-14T07:00:00.000Z'), { slotMinutes: 60, minLeadMinutes: 0, horizonDays: 1 });
    expect(slots.map((s) => amman(s.start))).toEqual(['2026-09-19 10:00', '2026-09-19 11:00']);
  });

  test('busy subtraction removes every slot a busy interval overlaps', () => {
    const slots = booking.candidateSlots(TH, new Date('2026-09-17T16:00:00.000Z'));
    const busy = [{ start: new Date('2026-09-20T06:00:00.000Z'), end: new Date('2026-09-20T07:15:00.000Z') }]; // Sun 09:00–10:15
    const free = booking.freeSlots(slots, busy);
    expect(amman(free[0].start)).toBe('2026-09-20 10:30');
    expect(free.length).toBe(slots.length - 3);
  });

  test('offers: the first free slot and the first free slot on a later day', () => {
    const free = booking.freeSlots(booking.candidateSlots(TH, MON_10), []);
    const picked = booking.pickOffers(free);
    expect(picked.map((s) => amman(s.start))).toEqual(['2026-09-14 12:00', '2026-09-15 09:00']);
  });

  test('grid check refuses off-grid, out-of-hours and weekend starts', () => {
    expect(booking.isGridSlot(TH, new Date('2026-09-15T06:30:00.000Z'), 30)).toBe(true); // Tue 09:30
    expect(booking.isGridSlot(TH, new Date('2026-09-15T06:40:00.000Z'), 30)).toBe(false);
    expect(booking.isGridSlot(TH, new Date('2026-09-15T15:00:00.000Z'), 30)).toBe(false); // 18:00
    expect(booking.isGridSlot(TH, new Date('2026-09-18T06:30:00.000Z'), 30)).toBe(false); // Friday
  });

  test('titles fit WhatsApp (≤ 20 code points) and read as Amman time', () => {
    expect(booking.offerTitle(new Date('2026-09-15T07:30:00.000Z'), MON_10, TH.tz, 'ar')).toBe('بكرا 10:30 الصبح');
    expect(booking.offerTitle(new Date('2026-09-17T09:00:00.000Z'), MON_10, TH.tz, 'ar')).toBe('الخميس 12:00 الظهر');
    expect(booking.offerTitle(new Date('2026-09-16T11:30:00.000Z'), MON_10, TH.tz, 'en')).toBe('Wednesday 2:30 pm');
    expect(() => buttons.assertButtons()).not.toThrow();
  });

  test('event id: base32hex, deterministic, different per sequence', () => {
    const a = booking.eventIdFor('conv1', '2026-09-15T07:30:00.000Z', 1);
    expect(a).toMatch(/^sh[0-9a-v]{24}$/);
    expect(booking.eventIdFor('conv1', '2026-09-15T07:30:00.000Z', 1)).toBe(a);
    expect(booking.eventIdFor('conv1', '2026-09-15T07:30:00.000Z', 2)).not.toBe(a);
  });
});

// ─── offers ──────────────────────────────────────────────────────────────────

describe('bookingOffers', () => {
  const business = { id: 'b1', ai_config: {} };

  test('two free slots + «وقت ثاني», busy times from every busy calendar, cached for a minute', async () => {
    process.env.SHIFT_BUSY_CALENDAR_IDS = 'osaid@shifts-ai.com';
    calendar.freeBusy.mockResolvedValue({ ok: true, busy: [{ start: new Date('2026-09-14T09:00:00Z'), end: new Date('2026-09-14T10:00:00Z') }] });
    const r = await booking.bookingOffers({ business, now: MON_10, lang: 'ar' });
    expect(r.ok).toBe(true);
    expect(r.offers).toEqual([
      { id: 'book:2026-09-14T10:00:00.000Z', title: 'اليوم 1:00 الظهر' },
      { id: 'book:2026-09-15T06:00:00.000Z', title: 'بكرا 9:00 الصبح' },
      { id: 'slot:other', title: 'وقت ثاني' },
    ]);
    expect(calendar.freeBusy.mock.calls[0][0]).toMatchObject({ calendarIds: [CAL, 'osaid@shifts-ai.com'] });
    await booking.bookingOffers({ business, now: new Date(MON_10.getTime() + 30000), lang: 'en' });
    expect(calendar.freeBusy).toHaveBeenCalledTimes(1);
  });

  test('freeBusy fails → {ok:false} (callers keep PR2 offers); disabled → no calendar call', async () => {
    calendar.freeBusy.mockResolvedValue({ ok: false, error: { kind: 'auth' } });
    expect(await booking.bookingOffers({ business, now: MON_10 })).toMatchObject({ ok: false, reason: 'calendar' });
    process.env.SHIFT_BOOKING = '0';
    calendar.freeBusy.mockClear();
    expect(await booking.bookingOffers({ business, now: MON_10 })).toMatchObject({ ok: false, reason: 'disabled' });
    expect(calendar.freeBusy).not.toHaveBeenCalled();
  });
});

// ─── taps ────────────────────────────────────────────────────────────────────

const BIZ = { id: 'biz1', ai_config: {} };
const SLOT = '2026-09-15T07:30:00.000Z'; // Tuesday 10:30 Amman
const SLOT_END = '2026-09-15T08:00:00.000Z';

function conv({ wd = {}, stage = 'close', status = 'open' } = {}) {
  return {
    id: 'conv1', status, current_state: stage, customer_wa_id: '962790000001', profile_name: 'أبو سامي',
    workflow_data: {
      lead: { sector: 'restaurant', need: ['الطلبات بالليل'], version: 3 },
      slot_offers: [{ id: `book:${SLOT}`, title: 'بكرا 10:30 الصبح', issued_at: MON_10.toISOString() }],
      bot_turns: 4,
      ...wd,
    },
  };
}

function tap(id, c, now = MON_10, lang = 'ar') {
  return booking.handleBookingTap(id, { business: BIZ, conversation: c, now, lang, messageId: 'm9' });
}

const activeWd = (extra = {}) => ({
  booking: {
    event_id: 'shold', calendar_id: CAL, start: SLOT, end: SLOT_END, tz: 'Asia/Amman', status: 'booked',
    booked_at: MON_10.toISOString(), seq: 1, reminders: { d1: { sent_at: 'x' } }, history: [{ status: 'booked', start: SLOT, at: MON_10.toISOString() }],
  },
  needs_team: { reason: 'meeting', summary: 'مكالمة محجوزة', at: MON_10.toISOString(), resolved_at: null, claimed_at: null, sla_note_sent_at: null },
  ...extra,
});

describe('book on tap', () => {
  test('free slot → event inserted with the client id and times, booking persisted in the patch, honest confirmation', async () => {
    calendar.freeBusy.mockResolvedValue({ ok: true, busy: [] });
    calendar.insertEvent.mockImplementation(async (cal, event) => ({ ok: true, event: { id: event.id, status: 'confirmed' }, existed: false }));

    const r = await tap(`book:${SLOT}`, conv());

    expect(calendar.freeBusy).toHaveBeenCalledWith(expect.objectContaining({ timeMin: new Date(SLOT), timeMax: new Date(SLOT_END), calendarIds: [CAL] }));
    const [calId, event] = calendar.insertEvent.mock.calls[0];
    expect(calId).toBe(CAL);
    expect(event).toMatchObject({
      id: booking.eventIdFor('conv1', SLOT, 1),
      summary: 'مكالمة شِفت — أبو سامي (+962790000001)',
      start: { dateTime: SLOT, timeZone: 'Asia/Amman' },
      end: { dateTime: SLOT_END, timeZone: 'Asia/Amman' },
      extendedProperties: { private: { conversationId: 'conv1', businessId: 'biz1' } },
      reminders: { useDefault: true },
    });
    expect(event.description).toContain('القطاع: مطعم/كافيه');
    expect(event.description).toContain('https://app.shifts-ai.com/inbox');

    expect(r.kind).toBe('button');
    expect(r.action).toBe('BOOK_CALL');
    const [part] = r.messages;
    expect(part.type).toBe('interactive');
    expect(part.text).toBe('ثبّتنا مكالمتك مع فريق شِفت: بكرا الساعة 10:30 الصبح بتوقيت عمّان. رح نذكّرك قبلها.\n\nوشو اسمك واسم المحل عشان الفريق يكون جاهز؟');
    expect(part.buttons.map((b) => b.id)).toEqual(['book_ok', 'book_change', 'book_cancel']);
    expect(r.workflowDataPatch.booking).toMatchObject({
      event_id: booking.eventIdFor('conv1', SLOT, 1), calendar_id: CAL, start: SLOT, end: SLOT_END, status: 'booked',
      booked_at: MON_10.toISOString(), reminders: {}, seq: 1, details_pending: true,
    });
    expect(r.stateUpdate).toEqual({ status: 'pending', current_state: 'captured' });
    expect(r.needsTeamCandidate).toMatchObject({ reason: 'meeting' });
    expect(r.workflowDataPatch.needs_team).toMatchObject({ reason: 'meeting' });
    expect(r.leadPatch.preferred_time).toMatchObject({ start: SLOT, end: SLOT_END, slot_id: `book:${SLOT}` });
    expect(r.leadMeta).toMatchObject({ source: 'booking', trusted: ['preferred_time'] });
    expect(r.alert).toMatchObject({ reason: 'booking_booked' });
    expect(r.workflowDataPatch.last_bot).toMatchObject({ next_step: 'buttons', button_id: `book:${SLOT}` });
  });

  test('name and business known → no follow-up question; English wording', async () => {
    calendar.freeBusy.mockResolvedValue({ ok: true, busy: [] });
    calendar.insertEvent.mockImplementation(async (cal, event) => ({ ok: true, event: { id: event.id } }));
    const c = conv({ wd: { lead: { name: 'Sam', business_name: 'Noor', language: 'en', version: 1 } } });
    const r = await tap(`book:${SLOT}`, c, MON_10, 'en');
    expect(r.messages[0].text).toBe("Your call with the SHIFT team is booked: tomorrow at 10:30 am Amman time. We'll remind you before it.");
    expect(r.workflowDataPatch.booking.details_pending).toBe(false);
    expect(calendar.insertEvent.mock.calls[0][1].summary).toBe('مكالمة شِفت — Noor (+962790000001)');
  });

  test('the event insert fails → the request ack + needs_team + alert, never «ثبّتنا»', async () => {
    calendar.freeBusy.mockResolvedValue({ ok: true, busy: [] });
    calendar.insertEvent.mockResolvedValue({ ok: false, error: { kind: 'auth' } });
    const r = await tap(`book:${SLOT}`, conv());
    const t = r.messages.map((p) => p.text).join('\n');
    expect(t).not.toContain('ثبّتنا');
    expect(t).toContain('سجّلت طلب مكالمة');
    expect(t).toContain('طلب مش موعد مؤكد');
    expect(r.workflowDataPatch.booking).toBeUndefined();
    expect(r.capture).toBeTruthy();
    expect(r.stateUpdate).toMatchObject({ status: 'pending' });
    expect(r.needsTeam).toMatchObject({ reason: 'meeting' });
    expect(r.alert.reason).toBe('booking_failed');
  });

  test('freeBusy fails at tap time → request semantics, no insert', async () => {
    calendar.freeBusy.mockResolvedValue({ ok: false, error: { kind: 'network' } });
    const r = await tap(`book:${SLOT}`, conv());
    expect(calendar.insertEvent).not.toHaveBeenCalled();
    expect(r.messages[0].text).toContain('سجّلت طلب مكالمة');
    expect(r.alert.reason).toBe('booking_failed');
  });

  test('the slot was taken between offer and tap → «هاد الوقت انحجز هلأ» + fresh slots, nothing inserted', async () => {
    calendar.freeBusy
      .mockResolvedValueOnce({ ok: true, busy: [{ start: new Date(SLOT), end: new Date(SLOT_END) }] })
      .mockResolvedValueOnce({ ok: true, busy: [{ start: new Date(SLOT), end: new Date(SLOT_END) }] });
    calendar.getEvent.mockResolvedValue({ ok: false, error: { kind: 'notFound' } });
    const r = await tap(`book:${SLOT}`, conv());
    expect(calendar.insertEvent).not.toHaveBeenCalled();
    const [part] = r.messages;
    expect(part.text).toBe('هاد الوقت انحجز هلأ. أقرب أوقات الفريق:');
    expect(part.buttons.map((b) => b.id)).not.toContain(`book:${SLOT}`);
    expect(part.buttons[part.buttons.length - 1].id).toBe('slot:other');
    expect(r.workflowDataPatch.slot_offers.map((o) => o.id)).toEqual(part.buttons.map((b) => b.id));
    expect(r.workflowDataPatch.booking).toBeUndefined();
    expect(r.alert).toBeNull();
  });

  test('a retry after the booking was inserted but not persisted → booked (the event is ours), no second insert', async () => {
    calendar.freeBusy.mockResolvedValue({ ok: true, busy: [{ start: new Date(SLOT), end: new Date(SLOT_END) }] });
    const id = booking.eventIdFor('conv1', SLOT, 1);
    calendar.getEvent.mockImplementation(async (cal, eventId) => (eventId === id
      ? { ok: true, event: { id, status: 'confirmed', start: { dateTime: SLOT } } }
      : { ok: false, error: { kind: 'notFound' } }));
    const r = await tap(`book:${SLOT}`, conv());
    expect(calendar.insertEvent).not.toHaveBeenCalled();
    expect(r.messages[0].text.startsWith('ثبّتنا')).toBe(true);
    expect(r.workflowDataPatch.booking).toMatchObject({ event_id: id, status: 'booked' });
  });

  test('the same tap again after its confirmation was not delivered → the same confirmation, no calendar call', async () => {
    const wd = activeWd({ slot_offers: [] });
    wd.booking.source_msg_id = 'm9';
    wd.lead = { name: 'سامي', business_name: 'بيكابو', version: 1 };
    const r = await tap(`book:${SLOT}`, conv({ stage: 'captured', status: 'pending', wd }));
    expect(calendar.freeBusy).not.toHaveBeenCalled();
    expect(calendar.insertEvent).not.toHaveBeenCalled();
    expect(r.messages[0].text).toBe('ثبّتنا مكالمتك مع فريق شِفت: بكرا الساعة 10:30 الصبح بتوقيت عمّان. رح نذكّرك قبلها.');
    expect(r.workflowDataPatch.booking).toBeUndefined();
    expect(r.alert).toBeNull();
    // A different message tapping the booked time → the short ack.
    const other = await booking.handleBookingTap(`book:${SLOT}`, { business: BIZ, conversation: conv({ wd }), now: MON_10, lang: 'ar', messageId: 'm10' });
    expect(other.messages[0].text.startsWith('تمام 👍')).toBe(true);
  });

  test('a slow calendar does not hold the reply: offersWithin gives up after its budget', async () => {
    calendar.freeBusy.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    const r = await booking.offersWithin(50, { business: BIZ, now: MON_10, lang: 'ar' });
    expect(r).toEqual({ ok: false, reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('an offer older than 12 h → out of date + fresh offers', async () => {
    calendar.freeBusy.mockResolvedValue({ ok: true, busy: [] });
    const later = new Date(MON_10.getTime() + 13 * 3600e3); // Monday 23:00
    const r = await tap(`book:${SLOT}`, conv(), later);
    expect(calendar.insertEvent).not.toHaveBeenCalled();
    expect(r.messages[0].text).toBe('الخيار هاد قديم. أقرب أوقات الفريق:');
    expect(r.messages[0].buttons.length).toBeGreaterThan(1);
  });

  test('SHIFT_BOOKING=0 after the buttons went out → the tap is a call request (no calendar call)', async () => {
    process.env.SHIFT_BOOKING = '0';
    const r = await tap(`book:${SLOT}`, conv());
    expect(calendar.freeBusy).not.toHaveBeenCalled();
    expect(r.messages[0].text).toContain('سجّلت طلب مكالمة');
    expect(r.messages[0].text).not.toContain('ثبّتنا');
  });
});

describe('reschedule and cancel', () => {
  const NEW = '2026-09-16T11:00:00.000Z'; // Wednesday 14:00
  const NEW_END = '2026-09-16T11:30:00.000Z';
  const withOffer = () => conv({ stage: 'captured', status: 'pending', wd: { ...activeWd(), slot_offers: [{ id: `book:${NEW}`, title: 'x', issued_at: MON_10.toISOString() }] } });

  test('a new slot while booked → the event is patched, status rescheduled, reminders reset', async () => {
    calendar.freeBusy.mockResolvedValue({ ok: true, busy: [] });
    calendar.patchEvent.mockResolvedValue({ ok: true, event: { id: 'shold' } });
    const r = await tap(`book:${NEW}`, withOffer());
    expect(calendar.insertEvent).not.toHaveBeenCalled();
    expect(calendar.patchEvent).toHaveBeenCalledWith(CAL, 'shold', {
      start: { dateTime: NEW, timeZone: 'Asia/Amman' }, end: { dateTime: NEW_END, timeZone: 'Asia/Amman' },
    }, expect.anything());
    expect(r.action).toBe('RESCHEDULE_CALL');
    expect(r.messages[0].text).toBe('غيّرنا موعد مكالمتك مع فريق شِفت: صار يوم الأربعاء 16/9 الساعة 2:00 الظهر بتوقيت عمّان. رح نذكّرك قبلها.\n\nوشو اسمك واسم المحل عشان الفريق يكون جاهز؟'.replace('يوم الأربعاء', 'الأربعاء'));
    expect(r.workflowDataPatch.booking).toMatchObject({
      event_id: 'shold', start: NEW, end: NEW_END, status: 'rescheduled', booked_at: MON_10.toISOString(),
      rescheduled_at: MON_10.toISOString(), reminders: {},
    });
    expect(r.workflowDataPatch.booking.history).toHaveLength(2);
    expect(r.needsTeamMerge).toMatchObject({ match: { reason: 'meeting' }, patch: { summary: expect.stringContaining('تغيّر موعد المكالمة') } });
    expect(r.alert.reason).toBe('booking_rescheduled');
  });

  test('the calendar refuses the move → the team gets the request; the current booking stays, no «غيّرنا»', async () => {
    calendar.freeBusy.mockResolvedValue({ ok: true, busy: [] });
    calendar.patchEvent.mockResolvedValue({ ok: false, error: { kind: 'server' } });
    const r = await tap(`book:${NEW}`, withOffer());
    expect(r.messages[0].text).toContain('ما قدرت أغيّر الموعد هلأ');
    expect(r.messages[0].text).toContain('بضل زي ما هو');
    expect(r.messages[0].text).not.toMatch(/غيّرنا|ثبّتنا/);
    expect(r.workflowDataPatch.booking).toMatchObject({ start: SLOT, status: 'booked', change_requested: { start: NEW } });
    expect(r.alert.reason).toBe('booking_change_request');
  });

  test('staff deleted the event in the calendar → the new time is inserted as a new event', async () => {
    calendar.freeBusy.mockResolvedValue({ ok: true, busy: [] });
    calendar.patchEvent.mockResolvedValue({ ok: false, error: { kind: 'notFound' } });
    calendar.insertEvent.mockImplementation(async (cal, event) => ({ ok: true, event: { id: event.id } }));
    const r = await tap(`book:${NEW}`, withOffer());
    expect(calendar.insertEvent.mock.calls[0][1].id).toBe(booking.eventIdFor('conv1', NEW, 2));
    expect(r.workflowDataPatch.booking).toMatchObject({ status: 'rescheduled', seq: 2, start: NEW });
  });

  test('cancel → the event is deleted, the booking kept as cancelled, the meeting request resolved, alert', async () => {
    calendar.deleteEvent.mockResolvedValue({ ok: true, alreadyGone: false });
    const r = await tap('book_cancel', conv({ stage: 'captured', status: 'pending', wd: activeWd() }));
    expect(calendar.deleteEvent).toHaveBeenCalledWith(CAL, 'shold', expect.anything());
    expect(r.messages[0].text).toBe('لغيت المكالمة. إذا حبيت نرتّب وقت ثاني احكيلي.');
    expect(r.workflowDataPatch.booking).toMatchObject({ event_id: 'shold', status: 'cancelled', cancelled_at: MON_10.toISOString() });
    expect(r.stateUpdate).toEqual({ status: 'open', current_state: 'close' });
    expect(r.needsTeamMerge).toMatchObject({ match: { reason: 'meeting' }, patch: { resolved_at: MON_10.toISOString() }, entry: null });
    expect(r.alert.reason).toBe('booking_cancelled');
  });

  test('cancel refused by the calendar → passed to the team, nothing claimed', async () => {
    calendar.deleteEvent.mockResolvedValue({ ok: false, error: { kind: 'network' } });
    const r = await tap('book_cancel', conv({ stage: 'captured', status: 'pending', wd: activeWd() }));
    expect(r.messages[0].text).toContain('ما قدرت ألغي المكالمة هلأ');
    expect(r.workflowDataPatch.booking).toMatchObject({ status: 'booked', cancel_requested_at: MON_10.toISOString() });
    expect(r.alert.reason).toBe('booking_change_request');
  });

  test('book_change → fresh slots; with the calendar down → a day/time ask that keeps the booking + alert', async () => {
    calendar.freeBusy.mockResolvedValueOnce({ ok: true, busy: [] });
    let r = await tap('book_change', conv({ stage: 'captured', status: 'pending', wd: activeWd() }));
    expect(r.messages[0].type).toBe('interactive');
    expect(r.messages[0].text).toBe('أكيد. أقرب أوقات الفريق:');
    expect(r.messages[0].buttons.every((b) => b.id.startsWith('book:') || b.id === 'slot:other')).toBe(true);

    booking.resetBusyCache();
    calendar.freeBusy.mockResolvedValueOnce({ ok: false, error: { kind: 'server' } });
    r = await tap('book_change', conv({ stage: 'captured', status: 'pending', wd: activeWd() }));
    expect(r.messages[0].type).toBe('text');
    expect(r.messages[0].text).toContain('ما قدرت أجيب الأوقات الفاضية هلأ');
    expect(r.alert.reason).toBe('booking_change_request');
  });

  test('book_ok / book_seeyou → a short ack naming the booked time; cancel without a booking → nothing to cancel', async () => {
    const r = await tap('book_seeyou', conv({ wd: activeWd() }));
    expect(r.messages[0].text).toBe('تمام 👍 منحكي معك بكرا الساعة 10:30 الصبح بتوقيت عمّان.');
    const none = await tap('book_cancel', conv());
    expect(none.messages[0].text).toContain('ما في مكالمة محجوزة');
    expect(calendar.deleteEvent).not.toHaveBeenCalled();
  });
});

// ─── text intents, template replies ──────────────────────────────────────────

describe('text intents while a booking exists', () => {
  const wd = activeWd();
  test.each([
    ['بدي ألغي المكالمة', 'cancel'],
    ['الغي الموعد لو سمحت', 'cancel'],
    ['please cancel the call', 'cancel'],
    ['ممكن نغيّر الموعد؟', 'change'],
    ['بدي وقت ثاني', 'change'],
    ['مش رح أقدر بكرا', 'change'],
    ['بدي أغيّر الموعد', 'change'],
    ['Can we reschedule?', 'change'],
    ["I can't make it tomorrow", 'change'],
    // Asking to book (or for the link) what is already booked is answered from the record: live on
    // 2026-09-20 it reached the model with no book_link button — book_link is withheld once a booking
    // exists — and the reply invented «رابط الحجز بيوصلك من الفريق مباشرة».
    ['بدي احجز', 'status'],
    ['احجزلي موعد', 'status'],
    ['تمام وين الرابط', 'status'],
    ['ابعتلي رابط الحجز', 'status'],
    ['I want to book', 'status'],
    ['where is the link', 'status'],
    ['ما بدي ألغي', null],
    ['تمام شكرًا', null],
    ['غير هيك كل شي تمام', null],
    ['شو بتعملوا للمطاعم؟', null],
  ])('%s → %s', (text, expected) => {
    expect(booking.textIntent([text], wd, MON_10)).toBe(expected);
  });

  test('a call request with no event yet is still booked the normal way, not answered from the record', () => {
    // callRequestOpen without an event: «بدي احجز» must keep reaching the slots / the link, not 'status'.
    const request = { lead: { preferred_time: { text: 'بكرا الساعة 10', start: null } } };
    expect(booking.textIntent(['بدي احجز'], request, MON_10)).toBeNull();
    expect(booking.textIntent(['book me in'], request, MON_10)).toBeNull();
  });

  test('no booking (or a cancelled one) → never an intent', () => {
    expect(booking.textIntent(['بدي ألغي المكالمة'], {}, MON_10)).toBeNull();
    expect(booking.textIntent(['بدي ألغي المكالمة'], { booking: { ...wd.booking, status: 'cancelled' } }, MON_10)).toBeNull();
  });

  test('a typed cancel asks first: [ألغِ المكالمة][خليها]', () => {
    const r = booking.cancelAskResult({ business: BIZ, conversation: conv({ wd }), now: MON_10, lang: 'ar' });
    expect(r.messages[0].text).toBe('أكيد بدك نلغي مكالمتك بكرا الساعة 10:30 الصبح؟');
    expect(r.messages[0].buttons.map((b) => b.id)).toEqual(['book_cancel', 'book_ok']);
    expect(r.alert).toBeNull();
  });
});

describe('template quick replies', () => {
  const row = (button, text) => ({ message_type: 'button', text_body: text, raw_payload: { type: 'button', button } });
  test('payload first, then the button text in both languages', () => {
    expect(booking.templateReplyId(row({ payload: 'book_change', text: 'بدي أغيّر الموعد' }))).toBe('book_change');
    expect(booking.templateReplyId(row({ text: 'بدي أغيّر الموعد' }))).toBe('book_change');
    expect(booking.templateReplyId(row({ text: 'Change the time' }))).toBe('book_change');
    expect(booking.templateReplyId(row({ text: 'تمام، بشوفكم' }))).toBe('book_seeyou');
    expect(booking.templateReplyId(row({ text: 'See you then' }))).toBe('book_seeyou');
    expect(booking.templateReplyId(row({ text: 'something else' }))).toBeNull();
    expect(booking.templateReplyId({ message_type: 'text', text_body: 'Change the time' })).toBeNull();
    expect(buttons.isShiftButtonId('book_seeyou')).toBe(true);
    expect(buttons.handleButton('book_change', {})).toBeNull();
  });
});

// ─── reminders ───────────────────────────────────────────────────────────────

describe('reminder timing', () => {
  const START = '2026-09-17T07:00:00.000Z'; // Thursday 10:00
  const b = (extra = {}) => ({ event_id: 'e', start: START, end: '2026-09-17T07:30:00.000Z', status: 'booked', booked_at: MON_10.toISOString(), reminders: {}, tz: 'Asia/Amman', ...extra });
  const at = (s) => new Date(s);

  test('d1 from 24 h before, h1 from 60 min before; nothing after the start or for a cancelled booking', () => {
    expect(booking.reminderDue(b(), at('2026-09-16T06:59:00Z')).due).toBeNull();
    expect(booking.reminderDue(b(), at('2026-09-16T07:00:00Z')).due).toBe('d1');
    expect(booking.reminderDue(b({ reminders: { d1: { sent_at: 'x' } } }), at('2026-09-17T05:59:00Z')).due).toBeNull();
    expect(booking.reminderDue(b({ reminders: { d1: { sent_at: 'x' } } }), at('2026-09-17T06:00:00Z')).due).toBe('h1');
    expect(booking.reminderDue(b({ reminders: { d1: { sent_at: 'x' }, h1: { sent_at: 'y' } } }), at('2026-09-17T06:30:00Z')).due).toBeNull();
    expect(booking.reminderDue(b(), at('2026-09-17T07:00:00Z')).due).toBeNull();
    expect(booking.reminderDue(b({ status: 'cancelled' }), at('2026-09-16T08:00:00Z')).due).toBeNull();
  });

  test('no d1 for a booking made less than 24 h before the call; a d1 missed until the last hour is late', () => {
    expect(booking.reminderDue(b({ booked_at: '2026-09-16T09:00:00Z' }), at('2026-09-16T10:00:00Z'))).toEqual({ due: null, late: [] });
    expect(booking.reminderDue(b(), at('2026-09-17T06:10:00Z'))).toEqual({ due: 'h1', late: ['d1'] });
    // A reschedule restarts the clock from rescheduled_at.
    expect(booking.reminderDue(b({ rescheduled_at: '2026-09-16T12:00:00Z' }), at('2026-09-16T13:00:00Z')).due).toBeNull();
  });

  test('template part: shift_call_reminder, [dayText, timeText], two quick replies; in-window part has buttons', () => {
    const now = at('2026-09-16T07:00:00Z');
    expect(booking.templatePart('d1', b(), now, 'ar')).toEqual({
      type: 'template', name: 'shift_call_reminder', language: 'ar', bodyParams: ['بكرا', '10:00 الصبح'],
      quickReplyPayloads: ['book_seeyou', 'book_change'],
      text: 'تذكير: مكالمتك مع فريق شِفت بكرا الساعة 10:00 الصبح بتوقيت عمّان. إذا بدك تغيّر الموعد احكيلي.',
    });
    expect(booking.templatePart('h1', b(), at('2026-09-17T06:00:00Z'), 'en').bodyParams).toEqual(['today', '10:00 am']);
    const part = booking.reminderPart('d1', b(), now, 'en');
    expect(part.text).toBe('Reminder: your call with the SHIFT team is tomorrow at 10:00 am Amman time. If you need to change it, tell me.');
    expect(part.buttons.map((x) => x.id)).toEqual(['book_seeyou', 'book_change']);
  });
});

describe('model honesty', () => {
  test('the claimed-action guard blocks booking claims in model lines', () => {
    for (const line of ['ثبّتنا مكالمتك بكرا', 'تمام، موعدك مؤكد', 'I have booked your call', 'Booked!', 'We confirmed your call for tomorrow', 'لغيت المكالمة', 'غيّرت موعدك للخميس']) {
      expect(validators.checkClaimedAction(line, {}).map((x) => x.code)).toContain('claimed_action');
    }
    for (const line of ['الفريق بيأكد الوقت معك', 'إذا بدك تغيّر الموعد اضغط «غيّر الموعد»', 'We are fully booked up this week']) {
      expect(validators.checkClaimedAction(line, {})).toEqual([]);
    }
  });

  test('the user-turn line says a booking exists and forbids confirming, moving or cancelling it', () => {
    const lineText = booking.contextLine(activeWd(), MON_10);
    expect(lineText).toContain('الحجز: مكالمة بكرا الساعة 10:30 الصبح (booked)');
    expect(lineText).toContain('لا تؤكد ولا تغيّر ولا تلغي');
    expect(booking.contextLine({}, MON_10)).toBeNull();
  });
});
