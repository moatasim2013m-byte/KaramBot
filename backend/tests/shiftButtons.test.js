require('./setup');

// Nothing here touches the DB; the mock only keeps lead.js from building a real PrismaClient.
jest.mock('../src/config/prisma', () => ({}));

const hours = require('../src/workflows/shift/hours');
const acks = require('../src/workflows/shift/acks');
const {
  parseSlotId, isShiftButtonId, slotOffers, handleButton, assertButtons, SLOT_OFFER_TTL_MS,
} = require('../src/workflows/shift/buttons');
const { isOptOutCommand, normalizeCommand, optOutResult } = require('../src/workflows/shift/optout');
const { detectHumanRequest, normalizeArabic } = require('../src/workflows/shift/handoff');

const TH = hours.DEFAULT_TEAM_HOURS;
const amman = (s) => new Date(`${s}+03:00`);
const business = { id: 'b1', ai_config: {} };
const MON_11 = amman('2026-09-14T11:00:00');
const TUE_SLOT = 'slot:2026-09-15T10:00+03:00/12:00';

function conv(workflowData = {}, fields = {}) {
  return { id: 'c1', status: 'open', current_state: 'fit', workflow_data: workflowData, ...fields };
}

function summary(offers) {
  return offers.map((o) => [o.id, o.title]);
}

describe('slotOffers — fixture table', () => {
  test('Mon 11:00 → today afternoon, tomorrow morning, other', () => {
    expect(summary(slotOffers(TH, MON_11))).toEqual([
      ['slot:2026-09-14T16:00+03:00/18:00', 'اليوم 4–6'],
      [TUE_SLOT, 'بكرا 10–12'],
      ['slot:other', 'وقت ثاني'],
    ]);
  });

  test('Mon 15:30 → tomorrow morning and afternoon', () => {
    expect(summary(slotOffers(TH, amman('2026-09-14T15:30:00'))).slice(0, 2)).toEqual([
      [TUE_SLOT, 'بكرا 10–12'],
      ['slot:2026-09-15T16:00+03:00/18:00', 'بكرا 4–6'],
    ]);
  });

  test('Thu 11:00 → today afternoon and Sunday morning', () => {
    expect(summary(slotOffers(TH, amman('2026-09-17T11:00:00'))).slice(0, 2)).toEqual([
      ['slot:2026-09-17T16:00+03:00/18:00', 'اليوم 4–6'],
      ['slot:2026-09-20T10:00+03:00/12:00', 'الأحد 10–12'],
    ]);
  });

  test('Thu 16:00 → Sunday morning and afternoon', () => {
    expect(slotOffers(TH, amman('2026-09-17T16:00:00')).map((o) => o.title)).toEqual(['الأحد 10–12', 'الأحد 4–6', 'وقت ثاني']);
  });

  test('Fri 10:00 → Sunday morning and afternoon', () => {
    expect(slotOffers(TH, amman('2026-09-18T10:00:00')).map((o) => o.title)).toEqual(['الأحد 10–12', 'الأحد 4–6', 'وقت ثاني']);
  });

  test('Sat 12:00 → Sunday is tomorrow', () => {
    expect(slotOffers(TH, amman('2026-09-19T12:00:00')).map((o) => o.title)).toEqual(['بكرا 10–12', 'بكرا 4–6', 'وقت ثاني']);
  });

  test('Mon 11:00 with Tuesday closed → Wednesday', () => {
    const offers = slotOffers({ ...TH, closures: ['2026-09-15'] }, MON_11);
    expect(summary(offers).slice(0, 2)).toEqual([
      ['slot:2026-09-14T16:00+03:00/18:00', 'اليوم 4–6'],
      ['slot:2026-09-16T10:00+03:00/12:00', 'الأربعاء 10–12'],
    ]);
  });

  test('Mon 11:00 in English', () => {
    expect(slotOffers(TH, MON_11, 'en').map((o) => o.title)).toEqual(['Today 4–6 pm', 'Tomorrow 10–12', 'Another time']);
  });

  test('assertButtons passes for every title the default hours produce', () => {
    expect(() => assertButtons()).not.toThrow();
  });
});

describe('slot ids', () => {
  test('parseSlotId round-trips with slotOffers', () => {
    for (const offer of slotOffers(TH, MON_11).slice(0, 2)) {
      const p = parseSlotId(offer.id);
      expect(`slot:${p.dateKey}T${p.startHm}${p.offset}/${p.endHm}`).toBe(offer.id);
      expect(p.end.getTime()).toBeGreaterThan(p.start.getTime());
    }
    const p = parseSlotId(TUE_SLOT);
    expect(p.start.toISOString()).toBe('2026-09-15T07:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-09-15T09:00:00.000Z');
    expect(parseSlotId('slot:other')).toEqual({ other: true });
    expect(parseSlotId('slot:2026-09-15T12:00+03:00/10:00')).toBeNull();
    expect(parseSlotId('lead_talk')).toBeNull();
  });

  test('isShiftButtonId', () => {
    expect(isShiftButtonId('lead_talk')).toBe(true);
    expect(isShiftButtonId('slot:other')).toBe(true);
    expect(isShiftButtonId(TUE_SLOT)).toBe(true);
    expect(isShiftButtonId('CONFIRM_ORDER')).toBe(false);
    expect(isShiftButtonId('slot:tomorrow')).toBe(false);
    expect(isShiftButtonId(undefined)).toBe(false);
  });
});

describe('handleButton', () => {
  const offers = (issuedAt) => [{ id: TUE_SLOT, title: 'بكرا 10–12', issued_at: issuedAt }];

  test('slot tap with name and business → capture', () => {
    const wd = { lead: { name: 'محمد', business_name: 'كافيه زيتون', version: 2 }, slot_offers: offers(MON_11.toISOString()) };
    const r = handleButton(TUE_SLOT, { business, conversation: conv(wd), now: MON_11, lang: 'ar', messageId: 'w1' });
    expect(r.kind).toBe('button');
    expect(r.action).toBe('CAPTURE_TIME');
    expect(r.stateUpdate).toEqual({ status: 'pending', current_state: 'captured' });
    expect(r.workflowDataPatch.needs_team.reason).toBe('meeting');
    expect(r.alert.reason).toBe('meeting');
    expect(r.messages[0].text).toContain('بكرا بين 10 و12 (الثلاثاء 15/9)');
    expect(r.messages[0].text).toContain('سجّلت طلب مكالمة: محمد، كافيه زيتون، بكرا بين 10 و12 (الثلاثاء 15/9) بتوقيت عمّان');
    expect(r.leadPatch.preferred_time).toEqual({
      text: 'بكرا بين 10 و12 (الثلاثاء 15/9)',
      start: '2026-09-15T07:00:00.000Z',
      end: '2026-09-15T09:00:00.000Z',
      tz: 'Asia/Amman',
      slot_id: TUE_SLOT,
    });
    expect(r.leadMeta).toEqual({ source: 'button', msgId: 'w1', at: MON_11.toISOString(), inboundText: '' });
  });

  test('slot tap without both → captureAsk with the privacy line', () => {
    const wd = { lead: { name: 'محمد', sector: 'restaurant' }, slot_offers: offers(MON_11.toISOString()) };
    const r = handleButton(TUE_SLOT, { business, conversation: conv(wd), now: MON_11, lang: 'ar', messageId: 'w1' });
    expect(r.messages[0].text).toBe(acks.captureAsk({ nameKnown: true, businessKnown: false, sector: 'restaurant', lang: 'ar' }));
    expect(r.messages[0].text).toContain('اسم المطعم؟');
    expect(r.messages[0].text).toContain('shifts-ai.com/privacy');
    expect(r.workflowDataPatch.capture_pending).toEqual({ slot_id: TUE_SLOT, time_text: null, at: MON_11.toISOString() });
    expect(r.stateUpdate).toEqual({ current_state: 'close' });
    expect(r.leadPatch.preferred_time.slot_id).toBe(TUE_SLOT);
    expect(r.alert).toBeNull();
  });

  test('an offer issued 13 h ago is expired', () => {
    const issued = new Date(MON_11.getTime() - 13 * 60 * 60 * 1000).toISOString();
    expect(13 * 60 * 60 * 1000).toBeGreaterThan(SLOT_OFFER_TTL_MS);
    const r = handleButton(TUE_SLOT, { business, conversation: conv({ slot_offers: offers(issued) }), now: MON_11, lang: 'ar' });
    expect(r.messages[0].text).toBe('الخيار هاد قديم — أي يوم ووقت بناسبك هلأ؟');
    expect(r.workflowDataPatch.capture_pending).toEqual({ slot_id: null, time_text: null, at: MON_11.toISOString() });
    expect(r.leadPatch).toBeNull();
  });

  test('a window that already ended is expired', () => {
    const r = handleButton('slot:2026-09-13T10:00+03:00/12:00', { business, conversation: conv({}), now: MON_11, lang: 'ar' });
    expect(r.messages[0].text).toBe(acks.expiredSlot('ar'));
  });

  test('slot:other asks for a time and stores capture_pending', () => {
    const r = handleButton('slot:other', { business, conversation: conv({}), now: MON_11, lang: 'ar' });
    expect(r.messages).toEqual([{ type: 'text', text: 'تمام — أي يوم وساعة بتريحك؟' }]);
    expect(r.workflowDataPatch.capture_pending).toEqual({ slot_id: 'other', time_text: null, at: MON_11.toISOString() });
    expect(r.stateUpdate).toEqual({ current_state: 'close' });
    const locked = handleButton('slot:other', { business, conversation: conv({}, { current_state: 'handoff', status: 'pending' }), now: MON_11, lang: 'ar' });
    expect(locked.stateUpdate).toEqual({});
    // Staff resolved or released the handoff: the stage moves on again.
    const released = handleButton('slot:other', { business, conversation: conv({}, { current_state: 'handoff', status: 'open' }), now: MON_11, lang: 'ar' });
    expect(released.stateUpdate).toEqual({ current_state: 'close' });
  });

  test('lead_talk → handoff without buttons', () => {
    const r = handleButton('lead_talk', { business, conversation: conv({}), now: MON_11, lang: 'ar' });
    expect(r.kind).toBe('handoff');
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].type).toBe('text');
    expect(r.messages[0].text.startsWith('ولا يهمك.\n\n')).toBe(true);
    expect(r.stateUpdate).toEqual({ status: 'pending', current_state: 'handoff' });
    expect(r.alert).toEqual({ reason: 'handoff', summary: 'ضغط زر «احكي مع الفريق»' });
  });

  test('unknown id → null', () => {
    expect(handleButton('CONFIRM_ORDER', { business, conversation: conv({}), now: MON_11 })).toBeNull();
  });
});

describe('opt-out commands (§5.8)', () => {
  test.each(['إيقاف', 'ايقاف', 'stop', 'STOP', 'Unsubscribe', 'لا تبعتولي', 'لا تبعتولي شي', 'مش مهتم.', 'مش مهتم!', 'وقف بعت رسايل', 'وقفوا الرسائل'])(
    'positive: %s', (text) => expect(isOptOutCommand(text)).toBe(true),
  );

  test.each(['مش مهتم بالولاء بس بكرم', 'ما بتوقف الرسائل بالليل', 'one-stop shop', 'لا تبعتولي الأسعار هلأ', 'بدي أوقف الموظف', 'stop the bot from replying at night', ''])(
    'negative: %s', (text) => expect(isOptOutCommand(text)).toBe(false),
  );

  test('normalizeCommand strips trailing punctuation', () => {
    expect(normalizeCommand('  إيقاف!! ')).toBe('ايقاف');
  });

  test('optOutResult shape', () => {
    const r = optOutResult({ conversation: conv({}), lang: 'ar', now: MON_11 });
    expect(r).toEqual({
      kind: 'optout',
      action: 'OPT_OUT',
      messages: [{ type: 'text', text: acks.optOut('ar') }],
      stateUpdate: { current_state: 'closed' },
      workflowDataPatch: { marketing_opted_out_at: MON_11.toISOString(), followups: [], capture_pending: null },
      leadPatch: null,
      leadMeta: null,
      needsTeam: null,
      alert: null,
    });
  });
});

describe('human request patterns (§5.7)', () => {
  test.each(['بدي أحكي مع إنسان', 'بدي احكي مع حدا من الفريق', 'حوّلني لموظف', 'وين الموظف؟', 'بدي المدير', 'بدي صاحب الشركة', 'خليني أحكي مع شخص', 'I want to talk to a human', 'can I speak with someone'])(
    'positive: %s', (text) => expect(detectHumanRequest(text)).toBe(true),
  );

  test.each(['عندي موظفة بترد', 'زبايني بحبوا يحكوا مع شخص', 'بدي أحكي مع زباين أكثر', 'موظف', 'مش راضي أحكي مع بوت', 'the bot can talk to customers', 'one-stop shop'])(
    'negative: %s', (text) => expect(detectHumanRequest(text)).toBe(false),
  );

  // The customer checking with their own side first (the «بحكيك» objection) or asking for the site:
  // not a request for someone from SHIFT, so the model decides.
  test.each([
    'خليني أحكي مع المدير وبرجعلك',
    'بدي أحكي مع صاحب الشركة تبعي قبل ما أقرر',
    'خليني احكي مع الفريق تبعي',
    'حوّلني على الموقع',
    'I need to talk to the owner first, then I will get back to you',
  ])('own side or the site, not a handoff: %s', (text) => expect(detectHumanRequest(text)).toBe(false));

  test.each(['بدي احكي مع حدا من الفريق قبل ما ادفع', 'بدي احكي مع حدا عندي سؤال عن الاسعار', 'حوّلني على موظف'])(
    'still a request with more words around it: %s', (text) => expect(detectHumanRequest(text)).toBe(true),
  );

  test('normalizeArabic', () => {
    expect(normalizeArabic('  حوّلني   إلى  مستشفى ')).toBe('حولني الي مستشفي');
  });
});
