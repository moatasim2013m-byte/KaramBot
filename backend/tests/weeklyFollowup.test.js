/**
 * The October offer's weekly follow-up planner (workflows/shift/weeklyFollowup.js): who gets the next
 * template, when, and when the series ends for good.
 */
const wf = require('../src/workflows/shift/weeklyFollowup');

const DAY = 24 * 3600 * 1000;
// A Tuesday, 13:00 Amman — inside friendly hours.
const NOW = new Date('2026-10-13T13:00:00+03:00');
const ago = (d) => new Date(NOW.getTime() - d * DAY);
const conv = (fields = {}, wd = {}) => ({ id: 'c1', customer_wa_id: '962787573973', status: 'open', current_state: 'discovery', profile_name: 'anas awawdah', workflow_data: wd, ...fields });
const inbound = (daysAgo) => ({ created_at: ago(daysAgo) });

describe('plan', () => {
  test('a lead quiet for three days gets week 1', () => {
    expect(wf.plan({ conversation: conv(), lastInbound: inbound(3.1), now: NOW })).toEqual({ step: 1, template: 'karam_followup_w1' });
  });

  test('not before three days of silence', () => {
    expect(wf.plan({ conversation: conv(), lastInbound: inbound(2), now: NOW })).toEqual({ skip: 'too_soon' });
  });

  test('one a week after that, four at most', () => {
    const sent = (step, d) => conv({}, { weekly_followup: { step, last_sent_at: ago(d).toISOString() } });
    expect(wf.plan({ conversation: sent(1, 6), lastInbound: inbound(10), now: NOW })).toEqual({ skip: 'too_soon' });
    expect(wf.plan({ conversation: sent(1, 7), lastInbound: inbound(10), now: NOW })).toEqual({ step: 2, template: 'karam_followup_w2' });
    expect(wf.plan({ conversation: sent(3, 7), lastInbound: inbound(25), now: NOW })).toEqual({ step: 4, template: 'karam_followup_w4' });
    expect(wf.plan({ conversation: sent(4, 7), lastInbound: inbound(30), now: NOW })).toMatchObject({ skip: 'series_done', stop: true });
  });

  test('a reply after a follow-up ends the series — the bot has the conversation back', () => {
    const c = conv({}, { weekly_followup: { step: 1, last_sent_at: ago(8).toISOString() } });
    expect(wf.plan({ conversation: c, lastInbound: inbound(5), now: NOW })).toMatchObject({ skip: 'replied', stop: true });
  });

  test('never to someone who said no, opted out, is with the team, or booked', () => {
    const cases = [
      [conv({ current_state: 'closed' }), 'state_closed'],
      [conv({ current_state: 'captured' }), 'state_captured'],
      [conv({ current_state: 'handoff' }), 'state_handoff'],
      [conv({}, { marketing_opted_out_at: ago(1).toISOString() }), 'opted_out'],
      [conv({}, { booking: { status: 'booked' } }), 'booked'],
    ];
    for (const [c, reason] of cases) expect(wf.plan({ conversation: c, lastInbound: inbound(4), now: NOW })).toMatchObject({ skip: reason, stop: true });
    expect(wf.plan({ conversation: conv({ status: 'pending' }), lastInbound: inbound(4), now: NOW })).toEqual({ skip: 'status_pending' });
  });

  test('never to SHIFT\'s own staff numbers', () => {
    expect(wf.plan({ conversation: conv({ customer_wa_id: '962796381676' }), lastInbound: inbound(4), now: NOW, staffNumbers: ['962796381676'] }))
      .toEqual({ skip: 'staff' });
  });

  test('a series that was stopped stays stopped', () => {
    expect(wf.plan({ conversation: conv({}, { weekly_followup: { step: 2, stopped: 'replied' } }), lastInbound: inbound(20), now: NOW })).toEqual({ skip: 'replied' });
  });

  test('the offer ending, or all ten places taken, stops everyone', () => {
    expect(wf.plan({ conversation: conv(), lastInbound: inbound(4), now: new Date('2026-11-01T00:00:00+03:00') })).toEqual({ skip: 'offer_ended' });
    expect(wf.plan({ conversation: conv(), lastInbound: inbound(4), now: NOW, placesLeft: 0 })).toEqual({ skip: 'offer_full' });
  });

  test('outside friendly hours it waits', () => {
    const night = new Date('2026-10-13T23:30:00+03:00');
    expect(wf.plan({ conversation: conv(), lastInbound: inbound(4), now: night })).toEqual({ skip: 'quiet_hours' });
  });

  test('a conversation with no customer message, or a stale one, is left alone', () => {
    expect(wf.plan({ conversation: conv(), lastInbound: null, now: NOW })).toEqual({ skip: 'no_inbound' });
    expect(wf.plan({ conversation: conv(), lastInbound: inbound(40), now: NOW })).toEqual({ skip: 'too_old' });
  });
});

describe('the template part', () => {
  test('weeks 1–3 carry the real count of places left; week 4 only the name', () => {
    expect(wf.part({ conversation: conv(), step: 1, placesLeft: 10 })).toMatchObject({ type: 'template', name: 'karam_followup_w1', language: 'ar', bodyParams: ['anas awawdah', '10'] });
    expect(wf.part({ conversation: conv(), step: 4, placesLeft: 3 }).bodyParams).toEqual(['anas awawdah']);
  });

  test('the name: a given name first, then a plain profile name, else «صديقنا»', () => {
    expect(wf.nameFor(conv({}, { lead: { name: 'أنس' } }))).toBe('أنس');
    expect(wf.nameFor(conv({ profile_name: 'ɴᴀꜱꜱᴇʀ ᴀʟ.ꜱʜᴀɴɴᴀɢ' }))).toBe('صديقنا');
    expect(wf.nameFor(conv({ profile_name: 'aaldawd57@gmailcom' }))).toBe('صديقنا');
    expect(wf.nameFor(conv({ profile_name: 'علا الحايك' }))).toBe('علا الحايك');
    expect(wf.nameFor(conv({ profile_name: null }))).toBe('صديقنا');
  });
});

test('off unless SHIFT_WEEKLY_FOLLOWUPS=1', () => {
  expect(wf.enabled({})).toBe(false);
  expect(wf.enabled({ SHIFT_WEEKLY_FOLLOWUPS: '1' })).toBe(true);
});

describe('the template buttons, as they arrive', () => {
  const { isOptOutCommand } = require('../src/workflows/shift/optout');
  const { asksAboutOffer } = require('../src/workflows/shift/objectives');

  test('[إيقاف الرسائل] is an opt-out — it was not, before this', () => {
    expect(isOptOutCommand('إيقاف الرسائل')).toBe(true);
    expect(isOptOutCommand('ايقاف الرسايل')).toBe(true);
    expect(isOptOutCommand('مش هلأ')).toBe(false);
  });

  test('[احجزلي مكان] and «بدي أجرّب» are interest in the offer', () => {
    expect(asksAboutOffer(['احجزلي مكان'])).toBe(true);
    expect(asksAboutOffer(['بدي أجرّب'])).toBe(true);
  });
});
