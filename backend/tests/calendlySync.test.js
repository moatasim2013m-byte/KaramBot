/**
 * calendlySync.test.js — the sweep step that turns Calendly events on the sales calendar into bookings.
 *
 * The real sweeper step, calendlySync and replyBatcher.dispatchIntent over the in-memory DB; only the calendar
 * list call, Graph (axios) and staff alerts are mocked. Pins: phone match → PR3 booking record (source
 * calendly, cancel/reschedule URLs) + confirmation inside the window only + booking_booked alert; idempotent
 * across sweeps; cancel + create in one sweep = one reschedule; cancel; unmatched and name-only bookings are
 * staff alerts only; the bot's own and non-Calendly events are skipped; the cursor; a list failure never
 * throws; the logged shape carries no PII; reminders work for a Calendly booking.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');
jest.mock('../src/services/alerts', () => ({
  sendStaffAlert: jest.fn(async () => ({ webhook: 'skipped', whatsapp: [] })),
  alertChannelConfigured: jest.fn(() => false),
}));
jest.mock('../src/services/googleCalendar', () => ({
  listEvents: jest.fn(),
  freeBusy: jest.fn(),
  getEvent: jest.fn(),
  insertEvent: jest.fn(),
  patchEvent: jest.fn(),
  deleteEvent: jest.fn(),
}));
jest.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: jest.fn() }));

const axios = require('axios');
const alerts = require('../src/services/alerts');
const calendar = require('../src/services/googleCalendar');
const hours = require('../src/workflows/shift/hours');
const { STEPS } = require('../src/services/shiftSweeper');
const calendlySync = require('../src/services/calendlySync');
const { encrypt } = require('../src/utils/tokenCrypto');
const db = require('./helpers/fakeDb').getFakeDb();

const BIZ = 'biz_shift';
const CUSTOMER = '962790000777';
const CAL_ID = 'sales@group.calendar.google.com';
const URL_BASE = 'https://calendly.com/shift-ai/30min';
const CANCEL = 'https://calendly.com/cancellations/AAAA-1111';
const RESCHED = 'https://calendly.com/reschedulings/AAAA-1111';
const NOW = new Date('2026-09-19T10:00:00.000Z'); // Saturday 13:00 Amman
const TEAM_HOURS = hours.resolveTeamHours({});
const calendlyStep = STEPS.find(([name]) => name === 'calendly')[1];
const bookingsStep = STEPS.find(([name]) => name === 'bookings')[1];

function report() {
  return {
    reminders_sent: 0, reminders_skipped: 0, reminders_failed: 0, bookings_passed: 0,
    calendly_booked: 0, calendly_rescheduled: 0, calendly_cancelled: 0, calendly_unmatched: 0, calendly_errors: 0, errors: [],
  };
}

function seedBusiness(cfg = {}) {
  return db.seed({
    businesses: [{
      id: BIZ, name: 'SHIFT', business_type: 'shift', status: 'active',
      ai_config: { calendly_url: URL_BASE, ...cfg },
      wa_phone_number_id: 'PNID', wa_access_token: encrypt('tok'),
    }],
  }).businesses[0];
}

function seedConv({ lastInbound = new Date(NOW.getTime() - 60 * 60e3), wd = {}, ...rest } = {}) {
  return db.seed({
    conversations: [{
      business_id: BIZ, customer_wa_id: CUSTOMER, profile_name: 'Sara', status: 'open', current_state: 'close', ai_enabled: true,
      last_inbound_at: lastInbound, last_message_at: lastInbound,
      workflow_data: {
        lead: { name: 'Sara Haddad', language: 'ar', version: 1 },
        booking_link: { first_sent_at: '2026-09-19T09:00:00.000Z', sent_at: '2026-09-19T09:00:00.000Z', count: 1, kind: 'book' },
        ...wd,
      },
      metadata: {},
      ...rest,
    }],
  }).conversations[0];
}

function calendlyEvent(fields = {}) {
  return {
    id: 'calev1',
    status: 'confirmed',
    updated: '2026-09-19T09:55:00.000Z',
    created: '2026-09-19T09:55:00.000Z',
    start: { dateTime: '2026-09-21T10:00:00+03:00', timeZone: 'Asia/Amman' },
    end: { dateTime: '2026-09-21T10:30:00+03:00', timeZone: 'Asia/Amman' },
    attendees: [{ email: 'owner@shift.test', organizer: true, self: true }, { email: 'sara@example.com', displayName: 'Sara Haddad' }],
    description: `Event Name: 30 Minute Meeting\nWhatsApp number: +962 79 000 0777\n\nCancel: ${CANCEL}\nReschedule: ${RESCHED}\n\nPowered by Calendly.com`,
    ...fields,
  };
}

function listReturns(...pages) {
  calendar.listEvents.mockReset();
  if (!pages.length) pages = [[]];
  for (const p of pages) calendar.listEvents.mockResolvedValueOnce({ ok: true, events: p, nextPageToken: null });
  calendar.listEvents.mockResolvedValue({ ok: true, events: [], nextPageToken: null });
}

const stored = (id) => db.store.conversations.find((c) => c.id === id);
const graphSends = () => axios.post.mock.calls.filter(([url]) => /\/messages$/.test(url)).map(([, p]) => p);
const alertReasons = () => alerts.sendStaffAlert.mock.calls.map(([a]) => a.reason);
const bodyOf = (p) => (p.type === 'text' ? p.text.body : p.interactive.body.text);

let business;
let wamid = 0;

async function sweep(now = NOW) {
  const fresh = db.store.businesses.find((b) => b.id === BIZ);
  const r = report();
  await calendlyStep(fresh, TEAM_HOURS, now, r);
  return r;
}

beforeEach(() => {
  db.reset();
  jest.clearAllMocks();
  wamid = 0;
  axios.post.mockImplementation(async (url) => {
    if (/\/messages$/.test(url)) {
      wamid += 1;
      return { status: 200, data: { messages: [{ id: `wamid.cal${wamid}` }] } };
    }
    return { status: 200, data: {} };
  });
  process.env.SHIFT_SALES_CALENDAR_ID = CAL_ID;
  delete process.env.CALENDLY_SYNC;
  business = seedBusiness();
  listReturns();
});

afterAll(() => {
  delete process.env.SHIFT_SALES_CALENDAR_ID;
});

describe('enabledFor', () => {
  test('needs a Calendly URL and the sales calendar; CALENDLY_SYNC=0 stops it', () => {
    expect(calendlySync.enabledFor(business)).toBe(true);
    expect(calendlySync.enabledFor({ ai_config: {} })).toBe(false);
    expect(calendlySync.enabledFor(business, { CALENDLY_SYNC: '0', SHIFT_SALES_CALENDAR_ID: CAL_ID })).toBe(false);
    expect(calendlySync.enabledFor(business, {})).toBe(false);
  });

  test('not configured: the step never lists the calendar', async () => {
    db.reset();
    business = seedBusiness({ calendly_url: null });
    await sweep();
    expect(calendar.listEvents).not.toHaveBeenCalled();
  });
});

describe('a new Calendly booking matched by phone', () => {
  test('stored in the PR3 record shape, confirmed on WhatsApp inside the window, staff alerted', async () => {
    const conv = seedConv();
    listReturns([calendlyEvent()]);
    const r = await sweep();
    expect(r.calendly_booked).toBe(1);

    const wd = stored(conv.id).workflow_data;
    expect(wd.booking).toMatchObject({
      event_id: 'calev1', calendar_id: CAL_ID, start: '2026-09-21T07:00:00.000Z', end: '2026-09-21T07:30:00.000Z',
      tz: 'Asia/Amman', status: 'booked', source: 'calendly', cancel_url: CANCEL, reschedule_url: RESCHED,
      reminders: {}, details_pending: false, booked_at: '2026-09-19T09:55:00.000Z', seq: 1,
    });
    expect(wd.booking.history).toEqual([{ status: 'booked', start: '2026-09-21T07:00:00.000Z', at: NOW.toISOString(), source: 'calendly', event_id: 'calev1' }]);
    expect(wd.needs_team).toMatchObject({ reason: 'meeting' });
    expect(stored(conv.id)).toMatchObject({ status: 'pending', current_state: 'captured' });

    const sends = graphSends();
    expect(sends).toHaveLength(1);
    expect(bodyOf(sends[0])).toBe('ثبّتنا مكالمتك مع فريق شِفت: الاثنين 21/9 الساعة 10:00 الصبح بتوقيت عمّان. رح نذكّرك قبلها.');
    expect(sends[0].interactive.action.buttons.map((b) => b.reply.id)).toEqual(['book_ok', 'book_change', 'book_cancel']);
    expect(alertReasons()).toEqual(['booking_booked']);
  });

  test('idempotent: the same event listed again (overlap, re-delivery) sends and alerts nothing more', async () => {
    const conv = seedConv();
    listReturns([calendlyEvent()], [calendlyEvent()], [calendlyEvent({ updated: '2026-09-19T10:01:00.000Z' })]);
    await sweep();
    await sweep(new Date(NOW.getTime() + 60e3));
    await sweep(new Date(NOW.getTime() + 120e3));
    expect(graphSends()).toHaveLength(1);
    expect(alertReasons()).toEqual(['booking_booked']);
    expect(stored(conv.id).workflow_data.booking.history).toHaveLength(1);
  });

  test('two sweeps at once: one confirmation, one alert', async () => {
    seedConv();
    calendar.listEvents.mockReset();
    calendar.listEvents.mockResolvedValue({ ok: true, events: [calendlyEvent()], nextPageToken: null });
    const fresh = db.store.businesses.find((b) => b.id === BIZ);
    await Promise.all([calendlyStep(fresh, TEAM_HOURS, NOW, report()), calendlySync.syncBusiness(fresh, { now: NOW })]);
    expect(graphSends()).toHaveLength(1);
    expect(alertReasons()).toEqual(['booking_booked']);
  });

  test('window closed: the booking and the alert, no WhatsApp message (Calendly emails them)', async () => {
    const conv = seedConv({ lastInbound: new Date(NOW.getTime() - 30 * 3600e3) });
    listReturns([calendlyEvent()]);
    await sweep();
    expect(stored(conv.id).workflow_data.booking.status).toBe('booked');
    expect(graphSends()).toHaveLength(0);
    expect(alertReasons()).toEqual(['booking_booked']);
  });

  test('staff hold the conversation: the booking is recorded, the bot says nothing', async () => {
    const conv = seedConv({ status: 'human_takeover' });
    listReturns([calendlyEvent()]);
    await sweep();
    expect(stored(conv.id).workflow_data.booking.event_id).toBe('calev1');
    expect(stored(conv.id).status).toBe('human_takeover');
    expect(graphSends()).toHaveLength(0);
    expect(alertReasons()).toEqual(['booking_booked']);
  });

  test('an English lead gets the English confirmation', async () => {
    seedConv({ wd: { lead: { name: 'Sara', language: 'en', version: 1 } } });
    listReturns([calendlyEvent()]);
    await sweep();
    expect(bodyOf(graphSends()[0])).toBe("Your call with the SHIFT team is booked: Monday 21/9 at 10:00 am Amman time. We'll remind you before it.");
  });

  test('the phone in 07… form with Arabic-Indic digits still matches', async () => {
    const conv = seedConv();
    listReturns([calendlyEvent({ description: 'رقم الواتساب: ٠٧٩٠٠٠٠٧٧٧\nPowered by Calendly.com' })]);
    await sweep();
    expect(stored(conv.id).workflow_data.booking).toMatchObject({ event_id: 'calev1', cancel_url: null, reschedule_url: null });
    // Missing URLs are named in the staff alert.
    expect(alerts.sendStaffAlert.mock.calls[0][0].summary).toContain('روابط الإلغاء/التغيير مش موجودة');
  });

  test("the bot's own events and non-Calendly events are skipped", async () => {
    const conv = seedConv();
    listReturns([
      calendlyEvent({ id: 'shown1', extendedProperties: { private: { conversationId: 'c1', businessId: BIZ } } }),
      { id: 'lunch', status: 'confirmed', updated: '2026-09-19T09:00:00.000Z', start: { dateTime: '2026-09-21T12:00:00+03:00' }, end: { dateTime: '2026-09-21T13:00:00+03:00' }, description: 'team lunch 0790000777' },
    ]);
    await sweep();
    expect(stored(conv.id).workflow_data.booking).toBeUndefined();
    expect(alertReasons()).toEqual([]);
  });

  test('the logged shape summary carries no PII', async () => {
    seedConv();
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    listReturns([calendlyEvent()]);
    await sweep();
    const lines = log.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('[calendly] event shape'));
    log.mockRestore();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0].replace('[calendly] event shape ', ''))).toMatchObject({ phone: true, cancel_url: true, reschedule_url: true, attendees: 2 });
    for (const secret of ['0777', 'Sara', 'sara@', 'AAAA']) expect(lines[0]).not.toContain(secret);
  });
});

describe('reschedule and cancel', () => {
  const current = {
    event_id: 'calev1', calendar_id: CAL_ID, start: '2026-09-21T07:00:00.000Z', end: '2026-09-21T07:30:00.000Z', tz: 'Asia/Amman',
    status: 'booked', booked_at: '2026-09-19T08:00:00.000Z', seq: 1, reminders: {}, source: 'calendly', cancel_url: CANCEL,
    reschedule_url: RESCHED, history: [{ status: 'booked', start: '2026-09-21T07:00:00.000Z', at: '2026-09-19T08:00:00.000Z' }],
  };

  test('cancel + create for the same phone in one sweep = ONE reschedule', async () => {
    const conv = seedConv({ current_state: 'captured', status: 'pending', wd: { booking: current } });
    listReturns([
      { id: 'calev1', status: 'cancelled', updated: '2026-09-19T09:58:00.000Z' },
      calendlyEvent({
        id: 'calev2', updated: '2026-09-19T09:58:01.000Z',
        start: { dateTime: '2026-09-22T12:00:00+03:00' }, end: { dateTime: '2026-09-22T12:30:00+03:00' },
        description: `WhatsApp: 0790000777\nCancel: https://calendly.com/cancellations/BBBB\nReschedule: https://calendly.com/reschedulings/BBBB\ncalendly.com`,
      }),
    ]);
    const r = await sweep();
    expect(r).toMatchObject({ calendly_rescheduled: 1, calendly_cancelled: 0, calendly_booked: 0 });
    const b = stored(conv.id).workflow_data.booking;
    expect(b).toMatchObject({
      event_id: 'calev2', status: 'rescheduled', start: '2026-09-22T09:00:00.000Z', booked_at: current.booked_at,
      rescheduled_at: NOW.toISOString(), previous_event_id: 'calev1', seq: 2, cancel_url: 'https://calendly.com/cancellations/BBBB',
    });
    expect(b.history.map((h) => h.status)).toEqual(['booked', 'rescheduled']);
    expect(alertReasons()).toEqual(['booking_rescheduled']);
    const sends = graphSends();
    expect(sends).toHaveLength(1);
    expect(bodyOf(sends[0])).toContain('وصلنا تغيير الموعد: صارت مكالمتك مع فريق شِفت الثلاثاء 22/9 الساعة 12:00 الظهر');

    // The next sweep sees both again (overlap): nothing more.
    listReturns([{ id: 'calev1', status: 'cancelled', updated: '2026-09-19T09:58:00.000Z' }, calendlyEvent({ id: 'calev2', updated: '2026-09-19T09:58:01.000Z', start: { dateTime: '2026-09-22T12:00:00+03:00' }, end: { dateTime: '2026-09-22T12:30:00+03:00' } })]);
    await sweep(new Date(NOW.getTime() + 60e3));
    expect(graphSends()).toHaveLength(1);
    expect(alertReasons()).toEqual(['booking_rescheduled']);
  });

  test('an event moved in place (same id, new start) is a reschedule with fresh reminders', async () => {
    const conv = seedConv({ wd: { booking: { ...current, reminders: { d1: { sent_at: 'x' } } } } });
    listReturns([calendlyEvent({ start: { dateTime: '2026-09-23T10:00:00+03:00' }, end: { dateTime: '2026-09-23T10:30:00+03:00' } })]);
    await sweep();
    expect(stored(conv.id).workflow_data.booking).toMatchObject({ event_id: 'calev1', status: 'rescheduled', start: '2026-09-23T07:00:00.000Z', reminders: {} });
    expect(alertReasons()).toEqual(['booking_rescheduled']);
  });

  test('a cancel alone: booking cancelled, meeting resolved, staff alerted, customer told (window open)', async () => {
    const conv = seedConv({
      current_state: 'captured', status: 'pending',
      wd: { booking: current, needs_team: { reason: 'meeting', summary: 'x', at: '2026-09-19T08:00:00.000Z', resolved_at: null, claimed_at: null } },
    });
    listReturns([{ id: 'calev1', status: 'cancelled', updated: '2026-09-19T09:58:00.000Z' }]);
    const r = await sweep();
    expect(r.calendly_cancelled).toBe(1);
    const row = stored(conv.id);
    expect(row.workflow_data.booking).toMatchObject({ event_id: 'calev1', status: 'cancelled', cancelled_by: 'calendly', cancelled_at: NOW.toISOString() });
    expect(row.workflow_data.needs_team.resolved_at).toBe(NOW.toISOString());
    expect(row).toMatchObject({ status: 'open', current_state: 'close' });
    expect(alertReasons()).toEqual(['booking_cancelled']);
    expect(bodyOf(graphSends()[0])).toBe('وصلنا إلغاء مكالمتك (الاثنين 21/9 الساعة 10:00 الصبح). إذا حبيت نرتّب وقت ثاني احكيلي.');

    listReturns([{ id: 'calev1', status: 'cancelled', updated: '2026-09-19T09:58:00.000Z' }]);
    await sweep(new Date(NOW.getTime() + 60e3));
    expect(graphSends()).toHaveLength(1);
    expect(alertReasons()).toEqual(['booking_cancelled']);
  });

  test('a cancelled event that is not a stored Calendly booking is ignored (the bot deletes its own events)', async () => {
    const conv = seedConv({ wd: { booking: { ...current, source: undefined } } });
    listReturns([{ id: 'calev1', status: 'cancelled', updated: '2026-09-19T09:58:00.000Z' }]);
    await sweep();
    expect(stored(conv.id).workflow_data.booking.status).toBe('booked');
    expect(alertReasons()).toEqual([]);
  });

  test('a Calendly booking made over an active in-chat booking: booked, staff told to cancel the old one', async () => {
    const conv = seedConv({ wd: { booking: { ...current, event_id: 'shbot1', source: undefined, cancel_url: undefined } } });
    listReturns([calendlyEvent({ id: 'calev9', start: { dateTime: '2026-09-22T12:00:00+03:00' }, end: { dateTime: '2026-09-22T12:30:00+03:00' } })]);
    await sweep();
    const wd = stored(conv.id).workflow_data;
    expect(wd.booking).toMatchObject({ event_id: 'calev9', status: 'booked', previous_event_id: 'shbot1' });
    expect(wd.staff_tasks.map((t) => t.kind)).toEqual(['calendly_duplicate']);
    expect(alerts.sendStaffAlert.mock.calls[0][0].summary).toContain('عنده موعد ثاني');
  });
});

describe('bookings not tied to a conversation by phone', () => {
  test('unmatched (a website booking): a staff alert only, once across sweeps', async () => {
    listReturns([calendlyEvent({ description: 'WhatsApp: +962 78 123 4567\nPowered by Calendly.com' })]);
    const r = await sweep();
    expect(r.calendly_unmatched).toBe(1);
    expect(alertReasons()).toEqual(['calendly_unmatched']);
    expect(graphSends()).toHaveLength(0);
    expect(db.store.conversations).toHaveLength(0);
    listReturns([calendlyEvent({ description: 'WhatsApp: +962 78 123 4567\nPowered by Calendly.com' })]);
    await sweep(new Date(NOW.getTime() + 60e3));
    expect(alertReasons()).toEqual(['calendly_unmatched']);
  });

  test('no phone, the name matches a conversation that got the link within 48 h: a low-confidence alert, NOT a booking', async () => {
    const conv = seedConv({ customer_wa_id: '962799999999' });
    listReturns([calendlyEvent({ description: 'Powered by Calendly.com' })]);
    await sweep();
    expect(stored(conv.id).workflow_data.booking).toBeUndefined();
    expect(alertReasons()).toEqual(['calendly_check']);
    expect(alerts.sendStaffAlert.mock.calls[0][0].conversation.id).toBe(conv.id);
    expect(graphSends()).toHaveLength(0);
  });
});

describe('cursor and failures', () => {
  test('first run lists the last 24 h; the cursor is stored and the next list overlaps it', async () => {
    await sweep();
    const first = calendar.listEvents.mock.calls[0];
    expect(first[0]).toBe(CAL_ID);
    expect(first[1]).toMatchObject({ showDeleted: true, singleEvents: true });
    expect(new Date(first[1].updatedMin).toISOString()).toBe(new Date(NOW.getTime() - 24 * 3600e3).toISOString());
    expect(db.store.businesses[0].ai_config.calendly_sync.cursor).toBe(NOW.toISOString());
    // The owner's own config keys are untouched.
    expect(db.store.businesses[0].ai_config.calendly_url).toBe(URL_BASE);

    const later = new Date(NOW.getTime() + 60e3);
    await sweep(later);
    const second = calendar.listEvents.mock.calls[1];
    expect(new Date(second[1].updatedMin).toISOString()).toBe(new Date(NOW.getTime() - calendlySync.OVERLAP_MS).toISOString());
    expect(db.store.businesses[0].ai_config.calendly_sync.cursor).toBe(later.toISOString());
  });

  test('a list failure never throws, counts an error and keeps the cursor', async () => {
    calendar.listEvents.mockReset();
    calendar.listEvents.mockResolvedValue({ ok: false, error: { kind: 'auth', status: 403 } });
    const r = await sweep();
    expect(r.calendly_errors).toBe(1);
    expect(db.store.businesses[0].ai_config.calendly_sync).toBeUndefined();
  });

  test('a thrown calendar error is contained too', async () => {
    calendar.listEvents.mockReset();
    calendar.listEvents.mockRejectedValue(new Error('boom'));
    const r = await sweep();
    expect(r.calendly_errors).toBe(1);
  });

  test('a failed event keeps the cursor before it, so the next sweep retries it', async () => {
    const conv = seedConv();
    listReturns([calendlyEvent()]);
    db.failNext('jsonb.patchJson', new Error('db down'));
    const r = await sweep();
    expect(r.calendly_errors).toBe(1);
    expect(db.store.businesses[0].ai_config.calendly_sync.cursor).toBe('2026-09-19T09:55:00.000Z');
    listReturns([calendlyEvent()]);
    await sweep(new Date(NOW.getTime() + 60e3));
    expect(stored(conv.id).workflow_data.booking.event_id).toBe('calev1');
    expect(alertReasons()).toEqual(['booking_booked']);
  });
});

describe('reminders for a Calendly booking', () => {
  test('the bookings step sends the d1 reminder for source calendly exactly as for in-chat bookings', async () => {
    const conv = seedConv({ lastInbound: new Date('2026-09-20T06:00:00.000Z') });
    listReturns([calendlyEvent({ created: '2026-09-19T08:00:00.000Z' })]);
    await sweep();
    const d1At = new Date('2026-09-20T07:05:00.000Z');
    const r = report();
    await bookingsStep(db.store.businesses[0], TEAM_HOURS, d1At, r);
    expect(r.reminders_sent).toBe(1);
    expect(stored(conv.id).workflow_data.booking.reminders.d1).toMatchObject({ via: 'text' });
  });
});
