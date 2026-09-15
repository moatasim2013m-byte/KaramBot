require('./setup');

const hours = require('../src/workflows/shift/hours');
const acks = require('../src/workflows/shift/acks');

const TH = hours.DEFAULT_TEAM_HOURS;
const amman = (s) => new Date(`${s}+03:00`);
const MON_11 = amman('2026-09-14T11:00:00');
const ARABIC = /[؀-ۿ]/;

describe('segments', () => {
  test('hours and contact segments are omitted when unset', () => {
    expect(acks.hoursSegment(null, 'ar')).toBe('');
    expect(acks.contactSegment(undefined, 'ar')).toBe('');
    expect(acks.contactSegment({}, 'en')).toBe('');
    const noSegments = acks.handoffAck({ now: MON_11, lang: 'ar' });
    expect(noSegments).toBe('سجّلت طلبك بقائمة الفريق مع ملخص محادثتنا — لسه ما استلمه حدا، وبيردوا عليك هون ضمن الدوام. لو احتجت أي شي بالوقت هذا أنا هون.');
    expect(noSegments).not.toMatch(/undefined|\(\)|\s\./);
    expect(acks.flagAck('quote', { lang: 'ar' })).toContain('ضمن الدوام. لحد ما يردوا');
  });

  test('hours and contact segments when set', () => {
    expect(acks.hoursSegment(TH, 'ar')).toBe(' (الأحد–الخميس 9–6)');
    expect(acks.hoursSegment(TH, 'en')).toBe(' (Sun–Thu 9 am–6 pm)');
    expect(acks.contactSegment({ phone: '0776788972', email: 'hello@x.com' }, 'ar')).toBe(' للاستعجال: 0776788972 أو hello@x.com.');
    expect(acks.contactSegment({ phone: '0776788972', email: 'hello@x.com' }, 'en')).toBe(' For urgent matters: 0776788972 or hello@x.com.');
    expect(acks.contactSegment({ email: 'hello@x.com' }, 'ar')).toBe(' للاستعجال: hello@x.com.');
  });

  test('in-hours handoff ack with both segments', () => {
    expect(acks.handoffAck({ teamHours: TH, contact: { phone: '0776788972' }, now: MON_11, lang: 'ar' })).toBe(
      'سجّلت طلبك بقائمة الفريق مع ملخص محادثتنا — لسه ما استلمه حدا، وبيردوا عليك هون ضمن الدوام (الأحد–الخميس 9–6). للاستعجال: 0776788972. لو احتجت أي شي بالوقت هذا أنا هون.',
    );
  });

  test('hoursLabel for non-contiguous days and half hours', () => {
    expect(hours.hoursLabel({ ...TH, days: [0, 2, 4], from: '09:30', to: '17:00' }, 'ar')).toBe('الأحد، الثلاثاء، الخميس 9:30–5');
    expect(hours.hoursLabel({ ...TH, days: [6, 0, 1, 2, 3] }, 'en')).toBe('Sat–Wed 9 am–6 pm');
  });
});

describe('after-hours opening words', () => {
  test.each([
    ['2026-09-17T20:00:00', 'يوم الأحد الصبح', 'on Sunday morning'],
    ['2026-09-14T07:30:00', 'اليوم الساعة 9', 'today at 9 am'],
    ['2026-09-14T19:00:00', 'بكرا الصبح', 'tomorrow morning'],
  ])('%s', (local, ar, en) => {
    const now = amman(local);
    expect(hours.isWithinTeamHours(TH, now)).toBe(false);
    expect(acks.handoffAck({ teamHours: TH, now, lang: 'ar' })).toContain(`وبيردوا عليك هون ${ar} مع بداية الدوام إن شاء الله.`);
    expect(acks.handoffAck({ teamHours: TH, now, lang: 'en' })).toContain(`they'll reply here ${en} when the working day starts.`);
  });
});

describe('captureRelayed (D26)', () => {
  test('says the new time was passed to the team, never that it was noted', () => {
    const ar = acks.captureRelayed({ when: 'الخميس الساعة 5', lang: 'ar' });
    expect(ar).toContain('الخميس الساعة 5');
    expect(ar).toContain('للفريق');
    expect(ar).not.toContain('سجّلت');
    expect(acks.captureRelayed({ when: 'Thursday 5 pm', lang: 'en' })).toMatch(/passed .*to the team/i);
    expect(acks.captureRelayed({ lang: 'ar' })).not.toContain('undefined');
  });
});

describe('captureAck', () => {
  test('all segments', () => {
    expect(acks.captureAck({ name: 'محمد', businessName: 'كافيه زيتون', when: 'بكرا بين 10 و12 (الثلاثاء 15/9)', lang: 'ar' })).toBe(
      'سجّلت طلب مكالمة: محمد، كافيه زيتون، بكرا بين 10 و12 (الثلاثاء 15/9) بتوقيت عمّان — طلب مش موعد مؤكد، الفريق بيأكد الساعة بالضبط معك هون. إذا بتفضّل اتصال بدل الرسائل، اكتبلي.',
    );
  });

  test('no name or business prints no «، » artefacts', () => {
    const text = acks.captureAck({ when: 'بكرا الساعة 5', lang: 'ar' });
    expect(text.startsWith('سجّلت طلب مكالمة: بكرا الساعة 5 بتوقيت عمّان — ')).toBe(true);
    expect(text).not.toMatch(/،\s*،|:\s*،|undefined|null/);
    const onlyBusiness = acks.captureAck({ businessName: 'عيادة النور', when: 'الأحد', lang: 'ar' });
    expect(onlyBusiness).toContain('سجّلت طلب مكالمة: عيادة النور، الأحد بتوقيت عمّان');
    expect(acks.captureAck({ lang: 'en' })).toMatch(/^Call request noted — a request/);
  });
});

describe('windowText', () => {
  test('tomorrow in both languages', () => {
    const slot = { start: amman('2026-09-15T10:00:00'), end: amman('2026-09-15T12:00:00') };
    expect(acks.windowText(slot, MON_11, 'Asia/Amman', 'ar')).toBe('بكرا بين 10 و12 (الثلاثاء 15/9)');
    expect(acks.windowText(slot, MON_11, 'Asia/Amman', 'en')).toBe('tomorrow between 10 and 12 (Tuesday 15/9)');
  });

  test('today afternoon in English adds pm', () => {
    const slot = { start: amman('2026-09-14T16:00:00').toISOString(), end: amman('2026-09-14T18:00:00').toISOString() };
    expect(acks.windowText(slot, MON_11, 'Asia/Amman', 'en')).toBe('today between 4 and 6 pm (Monday 14/9)');
  });
});

describe('English outputs contain no Arabic script', () => {
  test('every function', () => {
    const outputs = [
      acks.hoursSegment(TH, 'en'),
      acks.contactSegment({ phone: '0776788972', email: 'a@b.c' }, 'en'),
      acks.windowText({ start: amman('2026-09-20T10:00:00'), end: amman('2026-09-20T12:00:00') }, MON_11, 'Asia/Amman', 'en'),
      acks.handoffLead('en'),
      acks.handoffAck({ teamHours: TH, contact: { phone: '1' }, now: MON_11, lang: 'en' }),
      acks.handoffAck({ teamHours: TH, now: amman('2026-09-17T20:00:00'), lang: 'en' }),
      acks.handoffRepeat('en'),
      acks.flagAck('quote', { teamHours: TH, lang: 'en' }),
      acks.flagAck('demo', { teamHours: TH, lang: 'en' }),
      acks.captureAck({ when: 'tomorrow', lang: 'en' }),
      acks.captureRelayed({ when: 'Thursday 5 pm', lang: 'en' }),
      acks.captureAsk({ lang: 'en', sector: 'clinic' }),
      acks.captureAsk({ nameKnown: true, lang: 'en' }),
      acks.captureAsk({ businessKnown: true, lang: 'en' }),
      acks.slotOther('en'),
      acks.expiredSlot('en'),
      acks.aiFailure('en', { withButtons: true }),
      acks.aiFailure('en'),
      acks.optOut('en'),
      acks.notNow('en'),
      acks.claimAck({ lang: 'en' }),
      acks.claimAck({ staffName: 'Sam', lang: 'en' }),
      acks.slaNote('en'),
      acks.awaitingStaffNote({ lang: 'en' }),
      ...['audio', 'image', 'video', 'document', 'sticker'].map((t) => acks.media(t, 'en')),
      ...['audio', 'image', 'video', 'document', 'sticker'].map((t) => acks.mediaPrefix(t, 'en')),
      acks.purposeLine('en'),
      acks.slotsBody('en'),
    ];
    for (const text of outputs) {
      expect(typeof text).toBe('string');
      expect(text).not.toMatch(ARABIC);
      expect(text).not.toMatch(/undefined|null/);
    }
  });
});

describe('fixed Arabic strings', () => {
  test('a sample of the table', () => {
    expect(acks.handoffLead('ar')).toBe('ولا يهمك.');
    expect(acks.media('audio', 'ar')).toBe('وصلتني رسالتك الصوتية 🙏 هون بالمحادثة بقرأ النص بس — ممكن تكتبلي المطلوب بسطر؟');
    expect(acks.media('video', 'ar')).toBe('وصلني الفيديو 🙏 هون بالمحادثة بقرأ النص بس — ممكن تكتبلي المطلوب بسطر؟');
    expect(acks.mediaPrefix('audio', 'ar')).toBe('وصلتني رسالتك الصوتية كمان 🙏 هون بقرأ النص بس.');
    expect(acks.claimAck({ staffName: 'رنا', lang: 'ar' })).toBe('استلم طلبك رنا وبيكمّل معك هون.');
    expect(acks.claimAck({ lang: 'ar' })).toBe('استلم طلبك واحد من الفريق وبيكمّل معك هون.');
    expect(acks.awaitingStaffNote({ lang: 'ar' })).toBe('رسالتك وصلت، الفريق بيكمّل معك هون.');
    expect(acks.captureAsk({ lang: 'ar', sector: 'clinic' })).toBe('تمام. بس أكّدلي اسمك واسم العيادة؟ (بنستخدم اللي بتكتبه عشان نرد عليك ونرتّب متابعة الفريق — التفاصيل: shifts-ai.com/privacy)');
    expect(acks.captureAsk({ businessKnown: true, lang: 'ar' })).toBe('تمام. بس أكّدلي اسمك؟ (بنستخدم اللي بتكتبه عشان نرد عليك ونرتّب متابعة الفريق — التفاصيل: shifts-ai.com/privacy)');
  });
});

describe('pickLanguage', () => {
  test('lead.language wins', () => {
    expect(acks.pickLanguage({ language: 'en' }, 'مرحبا')).toBe('en');
  });

  test('English → en', () => {
    expect(acks.pickLanguage({}, 'Hi, I run a dental clinic and want a WhatsApp bot')).toBe('en');
  });

  test('Arabizi → ar', () => {
    expect(acks.pickLanguage({}, 'mar7aba 3ndi salon')).toBe('ar');
    expect(acks.pickLanguage(null, 'shu el se3er?')).toBe('ar');
    expect(acks.pickLanguage({}, '3ndi 2 far3')).toBe('ar');
  });

  // A time, an ordinal or B2B puts a digit next to a letter without being Arabizi.
  test.each([
    'Hi, can we talk tomorrow at 5pm?',
    'Is 2pm ok?',
    '10:30am works for me',
    'We are a B2B store, 3 branches',
    'see you on the 3rd',
    'I want to speak to someone at 2pm',
  ])('English with digits next to letters → en: %s', (text) => {
    expect(acks.pickLanguage({}, text)).toBe('en');
  });

  test('mixed Arabic + POS → ar', () => {
    expect(acks.pickLanguage({}, 'عندي مطعم وبدي أربط POS')).toBe('ar');
  });

  test('no letters → ar', () => {
    expect(acks.pickLanguage({}, '👍 5')).toBe('ar');
  });
});

describe('hours helpers', () => {
  test('resolveTeamHours falls back per key', () => {
    expect(hours.resolveTeamHours(undefined)).toEqual(TH);
    expect(hours.resolveTeamHours({ team_hours: { days: [6, 0], from: 'nine', tz: 'Mars/Base', closures: ['2026-09-15', 'x'] } }))
      .toEqual({ days: [0, 6], from: '09:00', to: '18:00', tz: 'Asia/Amman', closures: ['2026-09-15'] });
    expect(hours.resolveTeamHours({ team_hours: { from: '19:00', to: '10:00' } })).toMatchObject({ from: '09:00', to: '18:00' });
  });

  test('localParts, zonedDate, formatLocal', () => {
    expect(hours.localParts(MON_11, 'Asia/Amman')).toEqual({ dateKey: '2026-09-14', hh: 11, mm: 0, minutes: 660, weekday: 1, offset: '+03:00' });
    expect(hours.localParts(new Date('2026-09-14T00:30:00Z'), 'UTC').offset).toBe('+00:00');
    expect(hours.zonedDate('2026-09-15', '10:00', 'Asia/Amman').toISOString()).toBe('2026-09-15T07:00:00.000Z');
    expect(hours.formatLocal(MON_11, 'Asia/Amman', 'ar')).toBe('الاثنين 14/9 11:00');
    expect(hours.formatLocal(MON_11, 'Asia/Amman', 'en')).toBe('Monday 14/9 11:00');
  });

  test('nextOpening and teamMinutesBetween', () => {
    expect(hours.nextOpening(TH, amman('2026-09-17T20:00:00'))).toMatchObject({ dateKey: '2026-09-20', relation: 'later' });
    // 17:50 → 18:00 Monday plus 09:00 → 09:10 Tuesday.
    expect(hours.teamMinutesBetween(TH, amman('2026-09-14T17:50:00'), amman('2026-09-15T09:10:00'))).toBe(20);
    expect(hours.teamMinutesBetween(TH, amman('2026-09-17T18:00:00'), amman('2026-09-20T08:00:00'))).toBe(0);
  });
});
