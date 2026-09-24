/**
 * calendly.test.js — the pure half of Calendly booking: configuration, the personalised link and its
 * cta_url part, the tolerant parser for events Calendly writes into the sales calendar (description shapes,
 * Arabic-Indic digits, +962 / 00962 / 07 forms, missing URLs), name-only matching and the reschedule pairing.
 */
require('./setup');

const calendly = require('../src/workflows/shift/calendly');

const URL_BASE = 'https://calendly.com/shift-ai/30min';
const business = (cfg = {}) => ({ id: 'b1', ai_config: cfg });

describe('settings', () => {
  test('calendly is the default when a calendly_url is set', () => {
    expect(calendly.settings(business({ calendly_url: URL_BASE }))).toMatchObject({ mode: 'calendly', url: URL_BASE });
    expect(calendly.isLinkMode(business({ calendly_url: URL_BASE, booking_mode: 'calendly' }))).toBe(true);
  });

  test("'inchat' wins over a configured URL: reverting is a config change", () => {
    expect(calendly.settings(business({ calendly_url: URL_BASE, booking_mode: 'inchat' })).mode).toBe('inchat');
  });

  test('no URL, a non-https or non-Calendly URL → in-chat (never a broken link)', () => {
    expect(calendly.settings(business({})).mode).toBe('inchat');
    expect(calendly.settings(business({ booking_mode: 'calendly' })).mode).toBe('inchat');
    expect(calendly.settings(business({ calendly_url: 'http://calendly.com/x' })).mode).toBe('inchat');
    expect(calendly.settings(business({ calendly_url: 'https://evil.example/calendly.com' })).mode).toBe('inchat');
    expect(calendly.settings(null).mode).toBe('inchat');
  });
});

describe('the link', () => {
  test('personalised: name, a1 in +962 form, utm tags', () => {
    const url = new URL(calendly.personalUrl(URL_BASE, { name: 'معتصم', phone: '962790000777' }));
    expect(url.origin + url.pathname).toBe(URL_BASE);
    expect(url.searchParams.get('name')).toBe('معتصم');
    expect(url.searchParams.get('a1')).toBe('+962790000777');
    expect(url.searchParams.get('utm_source')).toBe('whatsapp');
    expect(url.searchParams.get('utm_campaign')).toBe('karam');
  });

  test('no name when the lead has none', () => {
    const url = new URL(calendly.personalUrl(URL_BASE, { phone: '962790000777' }));
    expect(url.searchParams.has('name')).toBe(false);
  });

  test('linkFor reads the lead name and the conversation number; null outside calendly mode', () => {
    const conv = { customer_wa_id: '962790000777', workflow_data: { lead: { name: 'Sara' } } };
    const link = calendly.linkFor(business({ calendly_url: URL_BASE }), conv, 'en');
    expect(link.lang).toBe('en');
    expect(new URL(link.url).searchParams.get('name')).toBe('Sara');
    expect(calendly.linkFor(business({ calendly_url: URL_BASE, booking_mode: 'inchat' }), conv, 'ar')).toBeNull();
  });

  test('linkPart: one cta_url with the Arabic body and «احجز موعدك», plain-text fallback with the URL', () => {
    const part = calendly.linkPart({ url: `${URL_BASE}?a1=%2B962790000777`, lang: 'ar' });
    expect(part).toMatchObject({
      type: 'cta_url',
      text: 'اختار الوقت اللي بناسبك من هون، وأول ما تحجز بيوصلك تأكيد.',
      displayText: 'احجز موعدك',
      serverButtons: true,
      bookingLink: { kind: 'book' },
    });
    expect(part.fallback).toEqual({ type: 'text', text: `${part.text}\n${URL_BASE}?a1=%2B962790000777` });
  });

  test('English body and "Book a time"; reschedule / cancel labels', () => {
    expect(calendly.linkPart({ url: URL_BASE, lang: 'en' }).displayText).toBe('Book a time');
    expect(calendly.linkPart({ url: URL_BASE, lang: 'ar', kind: 'reschedule' }).displayText).toBe('غيّر الموعد');
    expect(calendly.linkPart({ url: URL_BASE, lang: 'ar', kind: 'cancel' }).displayText).toBe('ألغِ الموعد');
  });

  test('a model line goes above the body', () => {
    const part = calendly.linkPart({ url: URL_BASE, lang: 'ar', line: 'أكيد!' });
    expect(part.text.startsWith('أكيد!\n\n')).toBe(true);
  });

  test('stampLink records booking_link.sent_at and counts', () => {
    const now = new Date('2026-09-19T10:00:00Z');
    const r = calendly.stampLink({ messages: [calendly.linkPart({ url: URL_BASE })], workflowDataPatch: { x: 1 } },
      { booking_link: { first_sent_at: '2026-09-18T10:00:00.000Z', sent_at: '2026-09-18T10:00:00.000Z', count: 1 } }, now);
    expect(r.workflowDataPatch).toEqual({
      x: 1,
      booking_link: { first_sent_at: '2026-09-18T10:00:00.000Z', sent_at: now.toISOString(), count: 2, kind: 'book' },
    });
    const plain = { messages: [{ type: 'text', text: 'hi' }] };
    expect(calendly.stampLink(plain, {}, now)).toBe(plain);
  });

  test('normalizeLinkParts turns a leftover pseudo-offer button part into the CTA', () => {
    const link = { url: URL_BASE, lang: 'ar' };
    const r = calendly.normalizeLinkParts({
      messages: [{ type: 'interactive', text: 'تمام.\nأقرب أوقات الفريق:', buttons: [calendly.linkOffer('ar')] }],
      workflowDataPatch: { slot_offers: [{ id: 'book_link', title: 'احجز موعدك' }] },
    }, link);
    expect(r.messages[0].type).toBe('cta_url');
    expect(r.messages[0].text).toBe(`تمام.\n\n${calendly.bodyText('book', 'ar')}`);
    expect(r.workflowDataPatch.slot_offers).toEqual([]);
  });
});

describe('normalizePhone', () => {
  test.each([
    ['+962 79 000 0777', '962790000777'],
    ['00962790000777', '962790000777'],
    ['0790000777', '962790000777'],
    ['079-000-0777', '962790000777'],
    ['790000777', '962790000777'],
    ['+962 079 000 0777', '962790000777'],
    ['٠٧٩٠٠٠٠٧٧٧', '962790000777'],
    ['+٩٦٢ ٧٩ ٠٠٠ ٠٧٧٧', '962790000777'],
    ['۰۷۹۰۰۰۰۷۷۷', '962790000777'],
    ['‎+962 (79) 000-0777', '962790000777'],
    ['+966 50 123 4567', '966501234567'],
    ['962790000777', '962790000777'],
  ])('%s → %s', (raw, want) => {
    expect(calendly.normalizePhone(raw)).toBe(want);
  });

  test.each(['', '2026-09-20', '12345', 'abc', '0612345678', '+1', '96212'])('%s → null', (raw) => {
    expect(calendly.normalizePhone(raw)).toBeNull();
  });
});

const CANCEL = 'https://calendly.com/cancellations/AAAA-1111';
const RESCHED = 'https://calendly.com/reschedulings/AAAA-1111';

function calendlyEvent(fields = {}) {
  return {
    id: 'cal_ev_1',
    status: 'confirmed',
    updated: '2026-09-19T10:00:00.000Z',
    created: '2026-09-19T10:00:00.000Z',
    start: { dateTime: '2026-09-21T10:00:00+03:00', timeZone: 'Asia/Amman' },
    end: { dateTime: '2026-09-21T10:30:00+03:00', timeZone: 'Asia/Amman' },
    attendees: [{ email: 'owner@shift.test', organizer: true, self: true }, { email: 'sara@example.com', displayName: 'Sara Haddad' }],
    ...fields,
  };
}

describe('parseEvent', () => {
  // Live calendar, 2026-09-21: Calendly cancels by renaming the event. Google still reported
  // `status: "confirmed"` with the summary «Canceled: Test Karam and SHIFT AI & Automation», so the booking
  // stayed on file and the customer was reminded of a call they had cancelled.
  test.each([
    ['Canceled: Test Karam and SHIFT AI & Automation', 'cancelled'],
    ['Cancelled: Sara and SHIFT AI & Automation', 'cancelled'],
    ['ملغاة: Test Karam', 'cancelled'],
    ['Test Karam and SHIFT AI & Automation', 'confirmed'],
    ['Cancellation policy chat with SHIFT', 'confirmed'],
  ])('summary %s → status %s', (summary, expected) => {
    expect(calendly.parseEvent(calendlyEvent({ summary })).status).toBe(expected);
  });

  test("Google's own cancelled status still wins, and a renamed event keeps its phone and links", () => {
    expect(calendly.parseEvent(calendlyEvent({ status: 'cancelled' })).status).toBe('cancelled');
    const p = calendly.parseEvent(calendlyEvent({
      summary: 'Canceled: Test Karam and SHIFT AI & Automation',
      description: [`رقم الواتساب: +962 7 9638 1676`, `Cancel: ${CANCEL}`, `Reschedule: ${RESCHED}`].join('\n'),
    }));
    expect(p.status).toBe('cancelled');
    expect(p.phone).toBe('962796381676');
    expect(p.calendly).toBe(true);
  });

  test('plain-text description: labelled answer, both URLs, attendee name and email', () => {
    const p = calendly.parseEvent(calendlyEvent({
      description: [
        'Event Name: 30 Minute Meeting',
        '',
        'Location: This is a Google Meet web conference.',
        '',
        'Please share anything that will help prepare for our meeting.: clinic in Irbid',
        'رقم الواتساب: +962 79 000 0777',
        '',
        'Need to make changes to this event?',
        `Cancel: ${CANCEL}`,
        `Reschedule: ${RESCHED}`,
        '',
        'Powered by Calendly.com',
      ].join('\n'),
    }));
    expect(p).toMatchObject({
      id: 'cal_ev_1', status: 'confirmed', phone: '962790000777', phoneLabelled: true, name: 'Sara Haddad',
      email: 'sara@example.com', cancelUrl: CANCEL, rescheduleUrl: RESCHED, calendly: true, own: false,
      start: '2026-09-21T07:00:00.000Z', end: '2026-09-21T07:30:00.000Z',
    });
  });

  test('HTML description with <br> and <a href>, Arabic-Indic digits, label on its own line', () => {
    const p = calendly.parseEvent(calendlyEvent({
      attendees: [],
      description: `<b>Invitee:</b> سارة<br>WhatsApp number:<br>٠٧٩٠٠٠٠٧٧٧<br><br>Need to make changes?<br>`
        + `<a href="${CANCEL}">Cancel</a> <a href="${RESCHED}">Reschedule</a><br>Powered by Calendly.com`,
    }));
    expect(p.html).toBe(true);
    expect(p.phone).toBe('962790000777');
    expect(p.phoneLabelled).toBe(true);
    expect(p.name).toBe('سارة');
    expect(p.cancelUrl).toBe(CANCEL);
    expect(p.rescheduleUrl).toBe(RESCHED);
  });

  test('unlabelled 00962 number anywhere; digits inside the URLs are never taken for a phone', () => {
    const p = calendly.parseEvent(calendlyEvent({
      description: `Answer 1\n00962 79 000 0777\nhttps://calendly.com/cancellations/0790000999`,
    }));
    expect(p.phone).toBe('962790000777');
    expect(p.phoneLabelled).toBe(false);
  });

  test('missing URLs and no phone: every field is null, nothing throws', () => {
    const p = calendly.parseEvent(calendlyEvent({ description: 'Event Name: Call\nPowered by Calendly.com' }));
    expect(p).toMatchObject({ phone: null, cancelUrl: null, rescheduleUrl: null, calendly: true });
    expect(calendly.parseEvent({}).start).toBeNull();
    expect(calendly.parseEvent(null).id).toBeNull();
  });

  test('a phone-call location field counts', () => {
    const p = calendly.parseEvent(calendlyEvent({ description: 'Powered by Calendly.com', location: '+962790000777' }));
    expect(p.phone).toBe('962790000777');
  });

  test('a cancelled event from an incremental list (id and status only)', () => {
    const p = calendly.parseEvent({ id: 'cal_ev_1', status: 'cancelled', updated: '2026-09-19T11:00:00.000Z' });
    expect(p).toMatchObject({ id: 'cal_ev_1', status: 'cancelled', calendly: false, start: null });
  });

  test("the bot's own events are recognised by their private extended properties", () => {
    expect(calendly.isOwnEvent({ extendedProperties: { private: { conversationId: 'c1', businessId: 'b1' } } })).toBe(true);
    expect(calendly.isOwnEvent(calendlyEvent())).toBe(false);
    expect(calendly.isCalendlyEvent({ description: 'staff lunch' })).toBe(false);
  });

  test('shapeSummary carries booleans and counts only — no PII', () => {
    const p = calendly.parseEvent(calendlyEvent({ description: `WhatsApp: 0790000777\nCancel: ${CANCEL}` }));
    const s = calendly.shapeSummary(p);
    expect(s).toEqual({
      status: 'confirmed', phone: true, phone_labelled: true, cancel_url: true, reschedule_url: false, attendees: 2,
      invitee_name: true, invitee_email: true, start: true, html: false, description_length: p.descriptionLength,
    });
    const flat = JSON.stringify(s);
    for (const secret of ['0790000777', '962790000777', 'Sara', 'sara@example.com', 'AAAA-1111']) expect(flat).not.toContain(secret);
  });
});

describe('name-only matching', () => {
  const sentAt = '2026-09-19T09:00:00.000Z';
  const conv = (id, name, sent = sentAt) => ({ id, profile_name: null, workflow_data: { lead: { name }, booking_link: sent ? { sent_at: sent } : undefined } });

  test('a link sent within 48 h before the booking and a matching name', () => {
    const parsed = { name: 'Sara Haddad', created: '2026-09-19T10:00:00.000Z' };
    expect(calendly.nameCandidates([conv('c1', 'sara haddad'), conv('c2', 'Omar')], parsed).map((c) => c.id)).toEqual(['c1']);
  });

  test('no link, a link older than 48 h, or a different name → no candidate', () => {
    const parsed = { name: 'Sara Haddad', created: '2026-09-22T10:00:00.000Z' };
    expect(calendly.nameCandidates([conv('c1', 'Sara Haddad')], parsed)).toEqual([]);
    expect(calendly.nameCandidates([conv('c1', 'Sara Haddad', null)], { ...parsed, created: '2026-09-19T10:00:00.000Z' })).toEqual([]);
    expect(calendly.namesMatch('أحمد', 'محمد')).toBe(false);
    expect(calendly.namesMatch('سارة', 'ساره حداد')).toBe(true);
  });
});

describe('planActions', () => {
  const conv = (booking) => ({ id: 'c1', customer_wa_id: '962790000777', workflow_data: booking ? { booking } : {} });
  const parsedOf = (fields) => calendly.parseEvent(calendlyEvent(fields));
  const stored = { event_id: 'old_ev', status: 'booked', start: '2026-09-21T07:00:00.000Z', end: '2026-09-21T07:30:00.000Z', source: 'calendly' };

  test('new event matched by phone → booked', () => {
    const c = conv(null);
    const [a] = calendly.planActions([{ parsed: parsedOf({ id: 'new_ev' }), conv: c, match: 'phone' }]);
    expect(a.type).toBe('booked');
  });

  test('cancel of the stored event + create for the same conversation in one sweep → ONE reschedule', () => {
    const c = conv(stored);
    const actions = calendly.planActions([
      { parsed: parsedOf({ id: 'new_ev', updated: '2026-09-19T11:00:01.000Z', start: { dateTime: '2026-09-22T12:00:00+03:00' }, end: { dateTime: '2026-09-22T12:30:00+03:00' } }), conv: c, match: 'phone' },
      { parsed: calendly.parseEvent({ id: 'old_ev', status: 'cancelled', updated: '2026-09-19T11:00:00.000Z' }), conv: c, match: 'event' },
    ]);
    expect(actions.map((a) => a.type)).toEqual(['rescheduled']);
    expect(actions[0].previous.event_id).toBe('old_ev');
  });

  test('a cancel alone → cancelled; already cancelled → nothing (idempotent)', () => {
    const cancelled = calendly.parseEvent({ id: 'old_ev', status: 'cancelled' });
    expect(calendly.planActions([{ parsed: cancelled, conv: conv(stored), match: 'event' }]).map((a) => a.type)).toEqual(['cancelled']);
    expect(calendly.planActions([{ parsed: cancelled, conv: conv({ ...stored, status: 'cancelled' }), match: 'event' }])).toEqual([]);
  });

  test('the stored event unchanged → nothing; moved → moved; URLs gained → refresh', () => {
    const same = parsedOf({ id: 'old_ev', description: 'Powered by Calendly.com' });
    expect(calendly.planActions([{ parsed: same, conv: conv({ ...stored, cancel_url: null }), match: 'phone' }])).toEqual([]);
    const moved = parsedOf({ id: 'old_ev', start: { dateTime: '2026-09-23T10:00:00+03:00' }, end: { dateTime: '2026-09-23T10:30:00+03:00' } });
    expect(calendly.planActions([{ parsed: moved, conv: conv(stored), match: 'phone' }])[0].type).toBe('moved');
    const withUrls = parsedOf({ id: 'old_ev', description: `Cancel: ${CANCEL}` });
    expect(calendly.planActions([{ parsed: withUrls, conv: conv(stored), match: 'phone' }])[0].type).toBe('refresh');
  });

  test('no conversation → unmatched; a name-only candidate → low_confidence (never booked)', () => {
    const p = parsedOf({ id: 'web_ev' });
    expect(calendly.planActions([{ parsed: p, conv: null, match: null }])[0].type).toBe('unmatched');
    const cand = conv(null);
    const [a] = calendly.planActions([{ parsed: p, conv: null, match: 'name', candidate: cand }]);
    expect(a.type).toBe('low_confidence');
    expect(a.conv).toBe(cand);
  });
});

describe('absolute wording', () => {
  test('the confirmation names the weekday and date, never «بكرا»', () => {
    const text = calendly.noticeText('booked', '2026-09-21T07:00:00.000Z', 'Asia/Amman', 'ar');
    expect(text).toBe('ثبّتنا مكالمتك مع فريق شِفت: الاثنين 21/9 الساعة 10:00 الصبح بتوقيت عمّان. رح نذكّرك قبلها.');
    expect(calendly.noticeText('cancelled', '2026-09-21T07:00:00.000Z', 'Asia/Amman', 'en')).toBe(
      "Your call (Monday 21/9 at 10:00 am) is cancelled. If you'd like another time, just tell me.",
    );
  });
});
