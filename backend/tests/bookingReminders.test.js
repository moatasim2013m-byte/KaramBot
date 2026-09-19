/**
 * bookingReminders.test.js — PR3 sweeper step `bookings`: d1 / h1 reminders for booked sales calls.
 *
 * The real sweeper step and the real replyBatcher.dispatchIntent (intent row → pre-send fence → Graph) over the
 * in-memory DB; only Graph (axios) and staff alerts are mocked. Pins: free-form inside the 24 h window vs the
 * approved template outside it, one send under two concurrent sweeps, the crash takeover, skips (cancelled,
 * opted out, past, staff), the template/billing refusal, and the passed-call bookkeeping.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');
jest.mock('../src/services/alerts', () => ({
  sendStaffAlert: jest.fn(async () => ({ webhook: 'skipped', whatsapp: [] })),
  alertChannelConfigured: jest.fn(() => false),
}));
jest.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: jest.fn() }));

const axios = require('axios');
const alerts = require('../src/services/alerts');
const hours = require('../src/workflows/shift/hours');
const { STEPS, getShiftStatus } = require('../src/services/shiftSweeper');
const { encrypt } = require('../src/utils/tokenCrypto');
const db = require('./helpers/fakeDb').getFakeDb();

const BIZ = 'biz_shift';
const CUSTOMER = '962791111111';
const START = '2026-09-17T07:00:00.000Z'; // Thursday 10:00 Amman
const END = '2026-09-17T07:30:00.000Z';
const BOOKED_AT = '2026-09-14T08:00:00.000Z'; // Monday
const D1_AT = new Date('2026-09-16T07:05:00.000Z'); // Wednesday 10:05
const H1_AT = new Date('2026-09-17T06:05:00.000Z'); // Thursday 09:05
const HOUR = 3600e3;

const step = STEPS.find(([name]) => name === 'bookings')[1];
const TEAM_HOURS = hours.resolveTeamHours({});

function report() {
  return { reminders_sent: 0, reminders_skipped: 0, reminders_failed: 0, bookings_passed: 0, errors: [] };
}

function seedBusiness() {
  return db.seed({
    businesses: [{
      id: BIZ, name: 'SHIFT', business_type: 'shift', status: 'active', ai_config: {},
      wa_phone_number_id: 'PNID', wa_access_token: encrypt('tok'),
    }],
  }).businesses[0];
}

function bookingOf(extra = {}) {
  return {
    event_id: 'shevent1', calendar_id: 'sales', start: START, end: END, tz: 'Asia/Amman', status: 'booked',
    booked_at: BOOKED_AT, seq: 1, reminders: {}, lang: 'ar', ...extra,
  };
}

function seedConv({ lastInbound, booking = bookingOf(), wd = {}, ...rest } = {}) {
  return db.seed({
    conversations: [{
      business_id: BIZ, customer_wa_id: CUSTOMER, status: 'pending', current_state: 'captured', ai_enabled: true,
      last_inbound_at: lastInbound, last_message_at: lastInbound,
      workflow_data: {
        lead: { name: 'سامي', business_name: 'مطعم الساحة', version: 2 },
        booking,
        needs_team: { reason: 'meeting', summary: 'مكالمة محجوزة', at: BOOKED_AT, resolved_at: null, claimed_at: null, sla_note_sent_at: null },
        ...wd,
      },
      metadata: {},
      ...rest,
    }],
  }).conversations[0];
}

const stored = (id) => db.store.conversations.find((c) => c.id === id);
const graphSends = () => axios.post.mock.calls.filter(([url]) => /\/messages$/.test(url)).map(([, p]) => p);
const intents = () => db.store.messages.filter((m) => m.direction === 'outbound');

let business;
let wamid = 0;

beforeEach(() => {
  db.reset();
  wamid = 0;
  axios.post.mockReset();
  axios.post.mockImplementation(async () => {
    wamid += 1;
    return { status: 200, data: { messages: [{ id: `wamid.r${wamid}` }] } };
  });
  alerts.sendStaffAlert.mockClear();
  delete process.env.SHIFT_BOT_LIVE;
  delete process.env.SHIFT_SALES_CALENDAR_ID;
  business = seedBusiness();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.SHIFT_SALES_CALENDAR_ID;
});

describe('d1 / h1 reminders', () => {
  test('inside the 24 h window → a free-form reminder through its own intent row (callback data), d1 settled', async () => {
    const conv = seedConv({ lastInbound: new Date(D1_AT.getTime() - 6 * HOUR) });
    const r = report();
    await step(business, TEAM_HOURS, D1_AT, r);

    const sends = graphSends();
    expect(sends).toHaveLength(1);
    expect(sends[0].type).toBe('interactive');
    expect(sends[0].interactive.body.text).toBe('تذكير: مكالمتك مع فريق شِفت بكرا الساعة 10:00 الصبح بتوقيت عمّان. إذا بدك تغيّر الموعد احكيلي.');
    expect(sends[0].interactive.action.buttons.map((b) => b.reply.id)).toEqual(['book_seeyou', 'book_change']);
    const [row] = intents();
    expect(sends[0].biz_opaque_callback_data).toBe(row.id);
    expect(row).toMatchObject({ status: 'sent', is_ai_generated: true });
    expect(row.raw_payload).toMatchObject({ kind: 'booking_reminder', batch_key: `booking_reminder:d1:shevent1:${START}:0`, batch_ids: [] });
    expect(stored(conv.id).workflow_data.booking.reminders.d1).toMatchObject({ via: 'text', sent_at: D1_AT.toISOString(), intent_id: row.id });
    expect(r.reminders_sent).toBe(1);

    // The next sweep owes nothing until the last hour.
    await step(business, TEAM_HOURS, new Date(D1_AT.getTime() + 10 * 60e3), report());
    expect(graphSends()).toHaveLength(1);
  });

  test('outside the window → the approved template with [dayText, timeText] and quick-reply payloads', async () => {
    const conv = seedConv({ lastInbound: new Date('2026-09-14T08:00:00Z') });
    await step(business, TEAM_HOURS, D1_AT, report());

    const [payload] = graphSends();
    const [row] = intents();
    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: CUSTOMER,
      type: 'template',
      biz_opaque_callback_data: row.id,
      template: {
        name: 'shift_call_reminder',
        language: { code: 'ar' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'بكرا' }, { type: 'text', text: '10:00 الصبح' }] },
          { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'book_seeyou' }] },
          { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'book_change' }] },
        ],
      },
    });
    expect(row.message_type).toBe('template');
    expect(row.text_body).toContain('[قالب shift_call_reminder]');
    expect(stored(conv.id).workflow_data.booking.reminders.d1).toMatchObject({ via: 'template' });
  });

  test('English lead → English template', async () => {
    seedConv({ lastInbound: new Date('2026-09-14T08:00:00Z'), wd: { lead: { language: 'en', version: 1 } } });
    await step(business, TEAM_HOURS, H1_AT, report());
    const [payload] = graphSends();
    expect(payload.template.language.code).toBe('en');
    expect(payload.template.components[0].parameters.map((p) => p.text)).toEqual(['today', '10:00 am']);
  });

  test('two concurrent sweeps → exactly one reminder', async () => {
    const conv = seedConv({ lastInbound: new Date(D1_AT.getTime() - HOUR) });
    const [a, b] = [report(), report()];
    await Promise.all([step(business, TEAM_HOURS, D1_AT, a), step(business, TEAM_HOURS, D1_AT, b)]);
    expect(graphSends()).toHaveLength(1);
    expect(a.reminders_sent + b.reminders_sent).toBe(1);
    expect(stored(conv.id).workflow_data.booking.reminders.d1.sent_at).toBeTruthy();
  });

  test('a sweep that died after writing the intent → the takeover never sends it again', async () => {
    const conv = seedConv({
      lastInbound: new Date(D1_AT.getTime() - HOUR),
      metadata: { booking_reminder_d1: `shevent1|${START}#1`, booking_reminder_d1_claimed_at: new Date(D1_AT.getTime() - 5 * 60e3).toISOString() },
    });
    db.seed({
      messages: [{
        business_id: BIZ, conversation_id: conv.id, direction: 'outbound', message_type: 'interactive', status: 'sending',
        is_ai_generated: true, text_body: 'تذكير', created_at: new Date(D1_AT.getTime() - 5 * 60e3),
        raw_payload: { kind: 'booking_reminder', batch_key: `booking_reminder:d1:shevent1:${START}:0`, batch_ids: [] },
      }],
    });
    await step(business, TEAM_HOURS, D1_AT, report());
    expect(graphSends()).toHaveLength(0);
    expect(stored(conv.id).workflow_data.booking.reminders.d1).toMatchObject({ via: 'recovered' });
  });

  test('a live claim of another sweep (younger than 2 min) → this sweep does nothing', async () => {
    const conv = seedConv({
      lastInbound: new Date(D1_AT.getTime() - HOUR),
      metadata: { booking_reminder_d1: `shevent1|${START}#1`, booking_reminder_d1_claimed_at: new Date(D1_AT.getTime() - 30e3).toISOString() },
    });
    await step(business, TEAM_HOURS, D1_AT, report());
    expect(graphSends()).toHaveLength(0);
    expect(stored(conv.id).workflow_data.booking.reminders.d1).toBeUndefined();
  });

  test('h1 in the last hour; a d1 that never went out is recorded as late, not sent', async () => {
    const conv = seedConv({ lastInbound: new Date(H1_AT.getTime() - HOUR) });
    const r = report();
    await step(business, TEAM_HOURS, H1_AT, r);
    const sends = graphSends();
    expect(sends).toHaveLength(1);
    expect(sends[0].interactive.body.text).toContain('كمان ساعة، الساعة 10:00 الصبح');
    const { reminders } = stored(conv.id).workflow_data.booking;
    expect(reminders.d1).toMatchObject({ skipped: 'late' });
    expect(reminders.h1).toMatchObject({ via: 'text' });
    expect(r).toMatchObject({ reminders_sent: 1, reminders_skipped: 1 });
  });

  test('a rescheduled booking gets its reminders again for the new time', async () => {
    const conv = seedConv({
      lastInbound: new Date(D1_AT.getTime() - HOUR),
      booking: bookingOf({ status: 'rescheduled', rescheduled_at: BOOKED_AT, reminders: {} }),
      metadata: { booking_reminder_d1: `shevent1|2026-09-16T07:00:00.000Z#1` },
    });
    await step(business, TEAM_HOURS, D1_AT, report());
    expect(graphSends()).toHaveLength(1);
    expect(stored(conv.id).metadata.booking_reminder_d1).toBe(`shevent1|${START}#1`);
  });
});

describe('skips', () => {
  test('cancelled booking, a call already started, save-only mode → nothing sent', async () => {
    seedConv({ lastInbound: new Date(D1_AT.getTime() - HOUR), booking: bookingOf({ status: 'cancelled' }) });
    await step(business, TEAM_HOURS, D1_AT, report());
    expect(graphSends()).toHaveLength(0);

    db.reset();
    business = seedBusiness();
    seedConv({ lastInbound: new Date('2026-09-17T06:40:00Z') });
    await step(business, TEAM_HOURS, new Date('2026-09-17T07:10:00Z'), report());
    expect(graphSends()).toHaveLength(0);

    db.reset();
    business = seedBusiness();
    process.env.SHIFT_BOT_LIVE = '0';
    seedConv({ lastInbound: new Date(D1_AT.getTime() - HOUR) });
    await step(business, TEAM_HOURS, D1_AT, report());
    expect(graphSends()).toHaveLength(0);
    delete process.env.SHIFT_BOT_LIVE;
  });

  test('an opted-out customer → skipped:opted_out; a staff takeover → skipped:staff', async () => {
    const out = seedConv({ lastInbound: new Date(D1_AT.getTime() - HOUR), wd: { marketing_opted_out_at: '2026-09-15T09:00:00Z' } });
    const r = report();
    await step(business, TEAM_HOURS, D1_AT, r);
    expect(graphSends()).toHaveLength(0);
    expect(stored(out.id).workflow_data.booking.reminders.d1).toMatchObject({ skipped: 'opted_out' });

    db.reset();
    business = seedBusiness();
    const staff = seedConv({ lastInbound: new Date(D1_AT.getTime() - HOUR), status: 'human_takeover' });
    await step(business, TEAM_HOURS, D1_AT, report());
    expect(graphSends()).toHaveLength(0);
    expect(stored(staff.id).workflow_data.booking.reminders.d1).toMatchObject({ skipped: 'staff' });
  });

  test('an opt-out stored after the read but before Graph → the pre-send fence refuses', async () => {
    const conv = seedConv({ lastInbound: new Date(D1_AT.getTime() - HOUR) });
    const original = db.jsonb.preSendCheck;
    db.jsonb.preSendCheck = async (...args) => {
      await db.jsonb.patchJson('conversations', conv.id, 'workflow_data', { marketing_opted_out_at: D1_AT.toISOString() });
      return original(...args);
    };
    try {
      await step(business, TEAM_HOURS, D1_AT, report());
    } finally {
      db.jsonb.preSendCheck = original;
    }
    expect(graphSends()).toHaveLength(0);
    expect(stored(conv.id).workflow_data.booking.reminders.d1).toMatchObject({ skipped: 'precheck' });
  });
});

describe('template refused', () => {
  const graphError = (code) => Object.assign(new Error('bad'), { request: {}, response: { status: 400, data: { error: { code, message: 'refused' } } } });

  test('not approved (132001) → skipped:template, Inbox flag, one staff alert per booking; no retry', async () => {
    axios.post.mockRejectedValue(graphError(132001));
    const conv = seedConv({ lastInbound: new Date('2026-09-14T08:00:00Z') });
    const r = report();
    await step(business, TEAM_HOURS, D1_AT, r);

    expect(graphSends()).toHaveLength(1);
    const c = stored(conv.id);
    expect(c.workflow_data.booking.reminders.d1).toMatchObject({ skipped: 'template' });
    expect(c.metadata.reminder_blocked).toMatchObject({ kind: 'd1', reason: 'template' });
    expect(alerts.sendStaffAlert).toHaveBeenCalledTimes(1);
    expect(alerts.sendStaffAlert.mock.calls[0][0].reason).toBe('reminder_blocked');
    expect(r.reminders_skipped).toBe(1);

    await step(business, TEAM_HOURS, new Date(D1_AT.getTime() + 5 * 60e3), report());
    expect(graphSends()).toHaveLength(1);

    // h1 refused again: skipped, but staff are not alerted a second time for this booking.
    await step(business, TEAM_HOURS, H1_AT, report());
    expect(graphSends()).toHaveLength(2);
    expect(stored(conv.id).workflow_data.booking.reminders.h1).toMatchObject({ skipped: 'template' });
    expect(alerts.sendStaffAlert).toHaveBeenCalledTimes(1);
  });

  test('no payment method (131042) → skipped:billing', async () => {
    axios.post.mockRejectedValue(graphError(131042));
    const conv = seedConv({ lastInbound: new Date('2026-09-14T08:00:00Z') });
    await step(business, TEAM_HOURS, D1_AT, report());
    expect(stored(conv.id).workflow_data.booking.reminders.d1).toMatchObject({ skipped: 'billing' });
  });

  test('any other refusal → failed, counted, not retried', async () => {
    axios.post.mockRejectedValue(graphError(131026));
    const conv = seedConv({ lastInbound: new Date('2026-09-14T08:00:00Z') });
    const r = report();
    await step(business, TEAM_HOURS, D1_AT, r);
    expect(stored(conv.id).workflow_data.booking.reminders.d1).toMatchObject({ failed: 'invalid_recipient' });
    expect(r.reminders_failed).toBe(1);
    expect(alerts.sendStaffAlert).not.toHaveBeenCalled();
  });
});

describe('team notes for a booked call', () => {
  test('no SLA note or SLA alert for the meeting request of a booked call; the window-closing flag is not raised', async () => {
    const [, slaStep] = STEPS.find(([name]) => name === 'sla_notes');
    const [, windowStep] = STEPS.find(([name]) => name === 'window_flags');
    const now = new Date('2026-09-15T08:00:00Z'); // Tuesday 11:00, team hours
    const conv = seedConv({ lastInbound: new Date(now.getTime() - 23 * HOUR) });
    await slaStep(business, TEAM_HOURS, now, { sla_notes: 0, errors: [] });
    await windowStep(business, TEAM_HOURS, now, { window_flags: 0, errors: [] });
    expect(graphSends()).toHaveLength(0);
    expect(alerts.sendStaffAlert).not.toHaveBeenCalled();
    expect(stored(conv.id).metadata.window_flag_for).toBeUndefined();

    // The same pending meeting without a booking (a PR2 call request) still gets both.
    db.reset();
    business = seedBusiness();
    seedConv({ lastInbound: new Date(now.getTime() - 23 * HOUR), booking: null, wd: { lead: { name: 'سامي', version: 1 } } });
    await slaStep(business, TEAM_HOURS, now, { sla_notes: 0, errors: [] });
    await windowStep(business, TEAM_HOURS, now, { window_flags: 0, errors: [] });
    expect(alerts.sendStaffAlert.mock.calls.map(([a]) => a.reason).sort()).toEqual(['sla_breached', 'window_closing']);
  });
});

describe('after the call and status', () => {
  test('15 min after the end → passed_at, the meeting request resolved, pending → open', async () => {
    const conv = seedConv({ lastInbound: new Date('2026-09-17T06:00:00Z') });
    const r = report();
    await step(business, TEAM_HOURS, new Date('2026-09-17T07:46:00Z'), r);
    const c = stored(conv.id);
    expect(c.workflow_data.booking.passed_at).toBe('2026-09-17T07:46:00.000Z');
    expect(c.workflow_data.needs_team.resolved_at).toBeTruthy();
    expect(c.status).toBe('open');
    expect(r.bookings_passed).toBe(1);
    expect(graphSends()).toHaveLength(0);
  });

  test('shift-status: calendar_configured, bookings_upcoming and reminder counters', async () => {
    process.env.SHIFT_SALES_CALENDAR_ID = 'sales';
    seedConv({ lastInbound: new Date('2026-09-15T08:00:00Z'), booking: bookingOf({ reminders: { d1: { sent_at: 'x', via: 'template' } } }) });
    db.seed({
      conversations: [{
        business_id: BIZ, customer_wa_id: '962792222222', status: 'open', last_message_at: new Date('2026-09-15T08:00:00Z'),
        workflow_data: { booking: bookingOf({ event_id: 'e2', status: 'cancelled', reminders: { d1: { skipped: 'template' } } }) },
      }],
    });
    const status = await getShiftStatus({ now: new Date('2026-09-15T09:00:00Z') });
    expect(status).toMatchObject({
      calendar_configured: true,
      booking_enabled: true,
      booking_mode: 'inchat',
      calendly_sync_enabled: false,
      calendly_sync_cursor: null,
      bookings_upcoming: 1,
      reminders: { d1_sent: 1, h1_sent: 0, template_sent: 1, skipped: 1, template_blocked: 1, failed: 0 },
    });
  });
});
