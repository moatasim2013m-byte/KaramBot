/**
 * PR2 contract §5.15 — deterministic output validators. Pure module: no DB, no SDK, no network.
 */

const v = require('../src/workflows/shift/validators');
const acks = require('../src/workflows/shift/acks');
const { SITE_HOST } = require('../src/config/site');

const OLD_HOST = ['shifts-ai', 'store'].join('.');
const SLOT_A = 'slot:2026-09-16T10:00+03:00/12:00';
const OFFERS = [{ id: SLOT_A, title: 'بكرا 10–12' }, { id: 'slot:other', title: 'وقت ثاني' }];

let warnSpy;
let logSpy;
beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
  logSpy.mockRestore();
});

const textPart = (modelLine, ack) => ({
  type: 'text', text: [modelLine, ack].filter(Boolean).join('\n\n'), modelLine, ...(ack ? { ack } : {}),
});
const reply = (messages, extra = {}) => ({
  kind: 'reply', action: 'NONE', messages, stateUpdate: {}, workflowDataPatch: {}, leadPatch: null, ...extra,
});
const baseCtx = (extra = {}) => ({
  attempt: 1, lang: 'ar', stage: 'discovery', action: 'NONE', roleplayActive: false, disclosed: true, disclosedBefore: true,
  batchTexts: ['مرحبا'], customerHistoryTexts: [], lead: {}, roleplayFacts: [], allowedButtonIds: new Set(),
  offers: [], stageLocked: false, explicitTimeRequest: false, compoundAskAllowed: false, now: new Date('2026-09-15T09:00:00Z'),
  ...extra,
});

describe('digit guard (§5.3)', () => {
  const budget = { batchTexts: ['ميزانيتي 50 دينار'] };
  const calc = { lead: { site_estimates: [{ value: '40', unit: 'msgs_per_day' }, { value: '180', unit: 'jod_per_month' }] } };
  const roleplay = { roleplayActive: true, roleplayFacts: ['شاورما 3 دنانير', 'برجر 4'], batchTexts: ['بدي 2 شاورما و1 برجر'] };

  const fixtures = [
    [1, 'باقتنا حوالي 50 دينار بالشهر.', {}, true],
    [2, 'بتبدأ من خمسين دينار.', {}, true],
    [3, 'اشتراكنا 50 دينار.', budget, true],
    [4, 'ميزانيتك 50 دينار، بس اشتراكنا 50 دينار.', budget, true],
    [5, 'تمام، ميزانيتك 50 دينار — رقمك إنت وبنحطه بالحسبان.', budget, false],
    [6, 'الحاسبة قدّرت ~40 رسالة باليوم و~180 دينار بالشهر — تقدير مبني على أرقامك.', calc, false],
    [7, 'الحاسبة قدّرت 250 دينار بالشهر.', calc, true],
    [8, 'الفريق بيرد ضمن الدوام، والرد عادة خلال الساعة 11 الصبح.', {}, false],
    [9, 'تذكير الاشتراك بيوصل قبل 24 ساعة من التجديد.', {}, false],
    [10, 'شاورما عدد 2 بـ3 دنانير وبرجر عدد 1 بـ4 — المجموع 10 دنانير حسب أسعارك.', roleplay, false],
    [11, 'المجموع 10 دنانير.', roleplay, true],
    [12, 'المجموع 50 دينار حسب أسعارك.', roleplay, true],
    [13, 'خصم 20% لأول شهر.', {}, true],
    [14, 'الحملة بتوصل لـ3 فروع.', {}, false],
    [15, 'كتبت "ميزانيتي 50 دينار"، صح؟', budget, false],
    [16, 'Our package is 30 JD a month.', { lang: 'en' }, true],
    [17, 'سعر الاشتراك ٥٠ دينار', {}, true],
  ];

  test.each(fixtures)('fixture %i: %s', (n, line, ctx, blocked) => {
    const blocks = v.checkDigits(line, ctx);
    expect(blocks.length > 0).toBe(blocked);
    for (const b of blocks) expect(b.code).toBe('digits');
  });

  test('fixture 4 blocks only the second clause', () => {
    expect(v.checkDigits('ميزانيتك 50 دينار، بس اشتراكنا 50 دينار.', budget)).toEqual([{ code: 'digits', detail: '50' }]);
  });

  test('a price in a time slot still blocks («الساعة 5 بسعر 20 دينار»)', () => {
    expect(v.checkDigits('الساعة 5 بسعر 20 دينار', {}).map((b) => b.detail)).toEqual(expect.arrayContaining(['20']));
  });

  test('findNumbers: digits and words with values; «آلاف» has none', () => {
    expect(v.findNumbers('بخمسين و 1,200 وآلاف').map((n) => [n.raw, n.value])).toEqual([['بخمسين', 50], ['1,200', 1200], ['وآلاف', null]]);
    expect(v.findNumbers('twenty half').map((n) => n.value)).toEqual([20, 0.5]);
  });

  test('allowedNumberSet canonicalises «1,200» and Arabic-Indic digits', () => {
    const set = v.allowedNumberSet({ lead: { customer_numbers: ['1,200'] }, batchTexts: ['ميزانيتي ٣٠٠'] });
    expect(set.has('1200')).toBe(true);
    expect(set.has('300')).toBe(true);
  });

  test('claimContextNumbers finds only numbers near a claim keyword', () => {
    expect(v.claimContextNumbers('عندي 3 فروع بمناطق مختلفة، وسعرنا 50 دينار').map((n) => n.raw)).toEqual(['50']);
  });
});

describe('guarantee / over-claim (§5.4)', () => {
  test.each(['الهدف مضمون: ما يضيع أي طلب', 'عملاؤنا مبسوطين', 'أغلب البوتات بتزعج'])('guarantee blocks: %s', (line) => {
    expect(v.checkGuarantee(line)).toHaveLength(1);
  });
  test('over-claim blocks «نفس اللي بنركّبه على رقمك»', () => {
    expect(v.checkOverclaim('نفس اللي بنركّبه على رقمك')).toHaveLength(1);
  });
  test.each(['الهدف ما يضيع طلب', 'ما عندي أسماء عملاء أشاركها', 'نفس اللي بنركّبه على رقمك، بس هون بمعلومات شِفت', 'نفس محرّك كرم اللي بنركّبه عندك'])('passes: %s', (line) => {
    expect(v.checkGuarantee(line)).toEqual([]);
    expect(v.checkOverclaim(line)).toEqual([]);
  });
});

describe('claimed action (§5.5)', () => {
  test.each(['سجّلت طلبك', 'بسجّلها كسؤال للفريق', 'حجزتلك بكرا 10', 'بعثت العرض', "I've booked you for tomorrow"])('blocks: %s', (line) => {
    expect(v.checkClaimedAction(line, {})).not.toHaveLength(0);
  });
  test.each(['ما حجزت شي', 'ما سجّلت أي طلب', 'بحطها بأسئلة الفريق', 'بلاحظ', "I haven't booked anything", 'انبعثت'])('passes: %s', (line) => {
    expect(v.checkClaimedAction(line, {})).toEqual([]);
  });
  test('off while role-play is active', () => {
    expect(v.checkClaimedAction('حجزتلك طاولة', { roleplayActive: true })).toEqual([]);
    expect(v.checkClaimedAction('حجزتلك طاولة', { roleplayActive: false })).toHaveLength(1);
  });
  test('«لما» is not a negation', () => {
    expect(v.checkClaimedAction('لما سجلت طلبك', {})).toHaveLength(1);
  });
});

describe('human claim / identity (§5.6)', () => {
  test.each(['إنت بني آدم ولا بوت؟', 'هاد بوت؟', 'انت روبوت ولا شو', 'are you a bot?'])('identity question: %s', (t) => {
    expect(v.isIdentityQuestion(t)).toBe(true);
  });
  test.each(['بدي بوت يرد على الزباين', 'I want a one-stop bot', 'bdi bot yrod', 'هاد الإشي الي بدي ياه'])('not an identity question: %s', (t) => {
    expect(v.isIdentityQuestion(t)).toBe(false);
  });

  test('«أنا موظف بشِفت» is a human claim; «أنا مش موظف، أنا مساعد شِفت الذكي» is not', () => {
    expect(v.checkHumanClaim('أنا موظف بشِفت')).toHaveLength(1);
    expect(v.checkHumanClaim('أنا مش موظف، أنا مساعد شِفت الذكي')).toEqual([]);
    expect(v.checkHumanClaim("I'm a real person")).toHaveLength(1);
  });

  test('human claim → the line is replaced with HONEST_IDENTITY, verdict ok', () => {
    const r = v.validateResult(reply([textPart('أنا موظف بشِفت، كيف بقدر أساعدك؟')]), baseCtx());
    expect(r.verdict).toBe('ok');
    expect(r.result.messages[0].text).toBe(v.HONEST_IDENTITY.ar);
    expect(r.result.messages[0].modelLine).toBe(v.HONEST_IDENTITY.ar);
    expect(r.blocks.map((b) => b.code)).toContain('human_claim');
    expect(r.hint).toBeNull();
  });

  test('identity question answered without disclosure → regenerate (1), replaced (2)', () => {
    const ctx = baseCtx({ batchTexts: ['هاد بوت؟'] });
    const first = v.validateResult(reply([textPart('أهلين، كيف بقدر أساعدك؟')]), ctx);
    expect(first.verdict).toBe('regenerate');
    expect(first.hint).toBe(v.hintFor('identity', 'ar'));
    const second = v.validateResult(reply([textPart('أهلين، كيف بقدر أساعدك؟')]), { ...ctx, attempt: 2 });
    expect(second.verdict).toBe('ok');
    expect(second.result.messages[0].text).toBe(v.HONEST_IDENTITY.ar);
    const honest = v.validateResult(reply([textPart('أي، أنا كرم، مساعد شِفت الذكي. بتحب أحولك لشخص؟')]), ctx);
    expect(honest.verdict).toBe('ok');
  });

  test('HONEST_IDENTITY passes every content check in its own language', () => {
    for (const lang of ['ar', 'en']) {
      const r = v.validateResult(reply([textPart(v.HONEST_IDENTITY[lang])]), baseCtx({ lang, batchTexts: ['are you a bot?'] }));
      expect(r.verdict).toBe('ok');
      expect(r.result.messages[0].text).toBe(v.HONEST_IDENTITY[lang]);
    }
    expect(v.HONEST_IDENTITY.en).not.toMatch(/[ء-ي]/);
  });
});

describe('Markdown and links (§5.7)', () => {
  test('stripMarkdown', () => {
    expect(v.stripMarkdown('## عنوان\n- **مهم** جدا\n1. _أول_ `code` [الموقع](https://x.io)\n\n\n\nآخر'))
      .toBe('عنوان\nمهم جدا\nأول code الموقع https://x.io\n\nآخر');
    expect(v.stripMarkdown('utm_source_x and 2*3*4')).toBe('utm_source_x and 2*3*4');
  });

  test('old host rewritten to SITE_HOST with the path kept', () => {
    const r = v.filterLinks(`${OLD_HOST}/privacy`);
    expect(r.text).toBe(`${SITE_HOST}/privacy`);
    expect(r.text).toBe('shifts-ai.com/privacy');
    expect(r.events[0].code).toBe('link');
  });

  test('disallowed paths and hosts are removed with one adjacent space', () => {
    expect(v.filterLinks('شوف https://shifts-ai.com/pricing هون').text).toBe('شوف هون');
    expect(v.filterLinks('كلمنا wa.me/962791234567 هون').text).toBe('كلمنا هون');
    expect(v.filterLinks('https://evil.example.com').text).toBe('');
    expect(v.filterLinks(`${OLD_HOST}/pricing`).text).toBe('');
  });

  test('utm-only query kept; any other query dropped; trailing punctuation stays outside', () => {
    expect(v.filterLinks('https://shifts-ai.com/en/clinics?utm_source=x').text).toBe('https://shifts-ai.com/en/clinics?utm_source=x');
    expect(v.filterLinks('shifts-ai.com/restaurants?ref=abc').text).toBe('shifts-ai.com/restaurants');
    expect(v.filterLinks('التفاصيل: shifts-ai.com/privacy.').text).toBe('التفاصيل: shifts-ai.com/privacy.');
  });

  test('in validateResult: Markdown repaired silently; a line that is only a bad link → regenerate', () => {
    const md = v.validateResult(reply([textPart('**أهلين** بالمطعم')]), baseCtx());
    expect(md.verdict).toBe('ok');
    expect(md.result.messages[0].text).toBe('أهلين بالمطعم');
    const link = v.validateResult(reply([textPart('https://example.com/x')]), baseCtx());
    expect(link.verdict).toBe('regenerate');
    expect(link.hint).toBe(`لا تكتب أي رابط غير ${SITE_HOST} وصفحاته المسموحة.`);
  });
});

describe('questions (§5.8)', () => {
  test('countQuestions ignores quoted text', () => {
    expect(v.countQuestions('كتبت «شو السعر؟» صح؟')).toBe(1);
  });

  test('trimQuestions keeps statements and the last question', () => {
    expect(v.trimQuestions('شو نوع شغلك؟ وين موقعك؟ ومين بيرد عندكم؟')).toBe('ومين بيرد عندكم؟');
    expect(v.trimQuestions('تمام. بس أكّدلي اسمك واسم المطعم؟ (التفاصيل: shifts-ai.com/privacy) وأي وقت بناسبك؟'))
      .toBe('تمام. (التفاصيل: shifts-ai.com/privacy) وأي وقت بناسبك؟');
  });

  test('two questions → trimmed (no regenerate)', () => {
    const line = 'تمام. بس أكّدلي اسمك واسم المطعم؟ وأي وقت بناسبك؟';
    const r = v.validateResult(reply([textPart(line)]), baseCtx());
    expect(r.verdict).toBe('ok');
    expect(r.result.messages[0].text).toBe('تمام. وأي وقت بناسبك؟');
    expect(r.blocks.map((b) => b.code)).toContain('questions');
  });

  test('two questions allowed for a compound ask and in roleplay_setup', () => {
    const line = 'شو اسمك؟ وشو اسم المطعم؟';
    expect(v.validateResult(reply([textPart(line)]), baseCtx({ compoundAskAllowed: true })).result.messages[0].text).toBe(line);
    expect(v.validateResult(reply([textPart(line)]), baseCtx({ stage: 'roleplay_setup' })).result.messages[0].text).toBe(line);
  });

  test('three questions → regenerate on attempt 1, trimmed on attempt 2', () => {
    const line = 'شو نوع شغلك؟ وين موقعك؟ ومين بيرد عندكم؟';
    const first = v.validateResult(reply([textPart(line)]), baseCtx());
    expect(first.verdict).toBe('regenerate');
    expect(first.hint).toBe('سؤال واحد بس بآخر الرد.');
    const second = v.validateResult(reply([textPart(line)]), baseCtx({ attempt: 2 }));
    expect(second.verdict).toBe('ok');
    expect(second.result.messages[0].text).toBe('ومين بيرد عندكم؟');
  });

  test('a question in the server ack wins over the model question', () => {
    const ack = acks.captureAsk({ lang: 'ar', sector: 'restaurant' });
    const r = v.validateResult(reply([textPart('حلو كتير. شو نوع المطعم؟', ack)]), baseCtx());
    expect(r.result.messages[0].text).toBe(`حلو كتير.\n\n${ack}`);
    expect(v.countQuestions(r.result.messages[0].text)).toBe(1);
  });
});

describe('buttons (§5.9)', () => {
  const allowed = new Set(['sample_yes', 'lead_talk', SLOT_A, 'slot:other']);
  const interactive = (buttons, extra = {}) => ({ type: 'interactive', text: 'بتحب؟', modelLine: 'بتحب؟', buttons, ...extra });

  test('a 21-cp title and an id outside the allow-list are dropped; slot titles come from the server', () => {
    const { part } = v.sanitizeButtons(interactive([
      { id: 'sample_yes', title: 'أ'.repeat(21) },
      { id: 'evil', title: 'اضغط' },
      { id: 'lead_talk', title: 'احكي مع الفريق' },
      { id: SLOT_A, title: 'model title' },
      { id: 'lead_talk', title: 'مكرر' },
    ]), baseCtx({ allowedButtonIds: allowed, offers: OFFERS }));
    expect(part.buttons).toEqual([{ id: 'lead_talk', title: 'احكي مع الفريق' }, { id: SLOT_A, title: 'بكرا 10–12' }]);
  });

  test('all dropped → text part with the metadata kept', () => {
    const { part } = v.sanitizeButtons(interactive([{ id: 'evil', title: 'x' }], { ack: 'a', delayMs: 1000 }), baseCtx({ allowedButtonIds: allowed }));
    expect(part).toEqual({ type: 'text', text: 'بتحب؟', modelLine: 'بتحب؟', ack: 'a', delayMs: 1000 });
  });

  test.each([
    ['role-play', { roleplayActive: true }],
    ['handoff stage', { stage: 'handoff' }],
    ['locked stage', { stageLocked: true }],
    ['END_ROLEPLAY action', { action: 'END_ROLEPLAY' }],
  ])('none in %s', (_, extra) => {
    const { part } = v.sanitizeButtons(interactive([{ id: 'lead_talk', title: 'احكي مع الفريق' }]), baseCtx({ allowedButtonIds: allowed, ...extra }));
    expect(part.type).toBe('text');
    expect(part.buttons).toBeUndefined();
  });

  test('serverButtons parts are exempt from rule 1 only', () => {
    const card = interactive([{ id: 'sample_yes', title: 'أكيد' }, { id: 'nope', title: 'لا' }], { serverButtons: true });
    const { part } = v.sanitizeButtons(card, baseCtx({ allowedButtonIds: allowed, stage: 'handoff' }));
    expect(part.type).toBe('interactive');
    expect(part.buttons).toEqual([{ id: 'sample_yes', title: 'أكيد' }]);
  });

  test('list rows: allow-listed, ≤ 24 cp, empty list → text', () => {
    const list = {
      type: 'list', text: 'شو نوع شغلك؟', buttonLabel: 'اختار', sections: [{ title: 's', rows: [
        { id: 'sector:clinic', title: 'عيادة' }, { id: 'sector:bad', title: 'x' }, { id: 'sector:store', title: 'م'.repeat(25) }] }],
    };
    const ids = new Set(['sector:clinic', 'sector:store']);
    expect(v.sanitizeButtons(list, baseCtx({ allowedButtonIds: ids })).part.sections[0].rows).toEqual([{ id: 'sector:clinic', title: 'عيادة' }]);
    expect(v.sanitizeButtons(list, baseCtx({ allowedButtonIds: new Set() })).part.type).toBe('text');
  });

  test('slot injection on «متى نحكي؟» in opening', () => {
    const ctx = baseCtx({ stage: 'opening', batchTexts: ['متى نحكي؟'], explicitTimeRequest: undefined, offers: OFFERS, allowedButtonIds: allowed });
    const r = v.validateResult(reply([textPart('أكيد، الفريق بيحب يحكي معك.')]), ctx);
    const part = r.result.messages[0];
    expect(part.type).toBe('interactive');
    expect(part.buttons).toEqual(OFFERS);
    expect(part.text).toBe(`أكيد، الفريق بيحب يحكي معك.\n${acks.slotsBody('ar')}`);
    expect(r.result.workflowDataPatch.last_bot.next_step).toBe('buttons');
  });

  test('no slot injection in discovery, in role-play or when locked', () => {
    for (const extra of [{ stage: 'discovery' }, { stage: 'close', roleplayActive: true }, { stage: 'close', stageLocked: true }]) {
      const r = v.validateResult(reply([textPart('أكيد.')]), baseCtx({ explicitTimeRequest: true, offers: OFFERS, allowedButtonIds: allowed, ...extra }));
      expect(r.result.messages[0].type).toBe('text');
    }
  });

  test('dangling colon → offers injected when buttons are allowed', () => {
    const r = v.validateResult(reply([textPart('أقرب أوقات الفريق:')]), baseCtx({ stage: 'close', offers: OFFERS, allowedButtonIds: allowed }));
    expect(r.result.messages[0]).toMatchObject({ type: 'interactive', text: 'أقرب أوقات الفريق:', buttons: OFFERS });
    expect(r.blocks.map((b) => b.code)).toContain('dangling_colon');
  });

  test('dangling colon → the slots body line becomes slotOther when buttons are not allowed', () => {
    const r = v.validateResult(reply([textPart(`تمام.\n${acks.slotsBody('ar')}`)]), baseCtx({ stage: 'captured', offers: OFFERS, allowedButtonIds: allowed }));
    expect(r.result.messages[0].text).toBe(`تمام.\n${acks.slotOther('ar')}`);
  });

  test('dangling colon → trailing colon replaced with a full stop otherwise', () => {
    const r = v.validateResult(reply([textPart('هاي أهم الميزات:')]), baseCtx());
    expect(r.result.messages[0].text).toBe('هاي أهم الميزات.');
  });
});

describe('Arabizi and language mirror (§5.10)', () => {
  test.each([
    ['mar7aba, 3ndi salon 7ela2a b irbid, bdi bot yrod 3al zabayen bil lail', true, 'ar'],
    ['kam el se3er?', true, 'ar'],
    ['tamam jarebni', true, 'ar'],
    ['Can we speak tomorrow after 4?', false, 'en'],
    ['I run a Shopify store, can you check stock and track Aramex deliveries?', false, 'en'],
    ['Our B2B shop sends mp3 files, call at 5pm', false, 'en'],
    ['Sam, Noor Boutique', false, 'en'],
    ['عندي مطعم وبدي POS و Loyalty', false, 'ar'],
  ])('%s', (text, arabizi, lang) => {
    expect(v.isArabizi(text)).toBe(arabizi);
    expect(v.languageOf(text)).toBe(lang);
  });

  test('languageOf: fewer than 3 letters → null', () => {
    expect(v.languageOf('👍')).toBeNull();
    expect(v.languageOf('ok')).toBeNull();
  });

  test('expectedLanguage follows the newest message with a language, then the lead, then ar', () => {
    expect(v.expectedLanguage(['مرحبا', 'Can we talk in English?'], { language: 'ar' })).toBe('en');
    expect(v.expectedLanguage(['Hello there', '👍'], {})).toBe('en');
    expect(v.expectedLanguage(['👍'], { language: 'en' })).toBe('en');
    expect(v.expectedLanguage([], null)).toBe('ar');
  });

  test('an English model line to an Arabizi customer → language block', () => {
    const ctx = baseCtx({ lang: v.expectedLanguage(['kam el se3er?'], {}), batchTexts: ['kam el se3er?'] });
    const r = v.validateResult(reply([textPart('Sure, here are the details')]), ctx);
    expect(r.verdict).toBe('regenerate');
    expect(r.blocks.map((b) => b.code)).toContain('language');
    expect(r.hint).toBe('ردّ بلغة آخر رسالة من العميل: العربية بالحروف العربية.');
  });

  test('an Arabic model line to an English customer → language block; product tokens do not count', () => {
    const r = v.validateResult(reply([textPart('أكيد، هاي التفاصيل')]), baseCtx({ lang: 'en', batchTexts: ['Hello there'] }));
    expect(r.verdict).toBe('regenerate');
    expect(r.hint).toBe('ردّ بلغة آخر رسالة من العميل: English.');
    const mixed = v.validateResult(reply([textPart('كرم بيشتغل مع POS و Loyalty و Shopify و Zapier')]), baseCtx());
    expect(mixed.verdict).toBe('ok');
  });
});

describe('length split (§5.11)', () => {
  test('≤ 650 cp or role-play → one piece', () => {
    expect(v.splitText('أ'.repeat(650))).toHaveLength(1);
    expect(v.splitText('أ'.repeat(900), 650, { roleplayActive: true })).toHaveLength(1);
  });

  test('900 cp with \\n\\n at 400 → 400 + 498', () => {
    const [a, b] = v.splitText(`${'a'.repeat(400)}\n\n${'b'.repeat(498)}`);
    expect([a.length, b.length]).toEqual([400, 498]);
  });

  test('900 cp, no newline, sentence end at 610 → cut at 611', () => {
    const text = `${'x '.repeat(305)}.${' y'.repeat(144)}`.replace(/ \./, 'x.');
    const end = text.indexOf('.');
    expect(end).toBe(610);
    const [head] = v.splitText(text);
    expect(Array.from(head)).toHaveLength(611);
  });

  test('code points, not UTF-16 units; last space when nothing else', () => {
    const text = `${'😀'.repeat(300)} ${'😀'.repeat(400)}`;
    const [head, tail] = v.splitText(text);
    expect(Array.from(head)).toHaveLength(300);
    expect(Array.from(tail)).toHaveLength(400);
  });

  test('in a result: model line on the head, ack and buttons on the tail', () => {
    const allowed = new Set(['lead_talk']);
    // Varied filler: a hundred copies of one word is a stutter now, and the stutter guard collapses it.
    const modelLine = `${Array.from({ length: 100 }, (_, i) => `ك${String(i).padStart(3, '0')}`).join(' ')} تمام.`;
    const ack = 'أ'.repeat(300);
    const part = { type: 'interactive', text: `${modelLine}\n\n${ack}`, modelLine, ack, buttons: [{ id: 'lead_talk', title: 'احكي مع الفريق' }] };
    const r = v.validateResult(reply([part]), baseCtx({ allowedButtonIds: allowed, stage: 'fit' }));
    expect(r.result.messages).toHaveLength(2);
    expect(r.result.messages[0]).toEqual({ type: 'text', text: modelLine, modelLine });
    expect(r.result.messages[1]).toMatchObject({ type: 'interactive', text: ack, ack, buttons: [{ id: 'lead_talk', title: 'احكي مع الفريق' }] });
    expect(r.result.messages[1].modelLine).toBeUndefined();
  });
});

describe('next_step (§5.12)', () => {
  const at = new Date('2026-09-15T09:00:00Z');
  test.each([
    ['OPT_OUT', [{ type: 'text', text: 'تمام؟' }], 'terminal'],
    ['NOT_NOW', [{ type: 'text', text: 'تمام' }], 'terminal'],
    ['NONE', [{ type: 'interactive', text: 'x', buttons: [{ id: 'a', title: 'b' }] }], 'buttons'],
    ['NONE', [{ type: 'list', text: 'x', sections: [{ rows: [{ id: 'a', title: 'b' }] }] }], 'buttons'],
    ['NONE', [{ type: 'text', text: 'شو نوع شغلك؟' }], 'question'],
    ['NONE', [{ type: 'text', text: 'كتبت «شو السعر؟»' }], 'confirmed'],
    ['NONE', [{ type: 'text', text: 'تمام.' }], 'confirmed'],
  ])('%s %j → %s', (action, messages, expected) => {
    const r = v.repairNextStep({ action, messages, workflowDataPatch: { x: 1 } }, null, { stage: 'fit', now: at });
    expect(r.next_step).toBe(expected);
    expect(r.result.workflowDataPatch).toEqual({ x: 1, last_bot: { stage: 'fit', next_step: expected, at: at.toISOString(), action } });
  });

  test('a disagreeing model value is logged as next_step, never a block', () => {
    const r = v.validateResult(reply([textPart('تمام.')]), baseCtx({ modelNextStep: 'question' }));
    expect(r.verdict).toBe('ok');
    expect(r.blocks).toContainEqual({ code: 'next_step', detail: 'question->confirmed' });
  });

  test('exclamations are counted into workflowDataPatch, never blocking', () => {
    const r = v.validateResult(reply([textPart('أهلين! تمام!')]), baseCtx({ exclamations: 2 }));
    expect(r.verdict).toBe('ok');
    expect(r.result.workflowDataPatch.exclamations).toBe(4);
    expect(logSpy).toHaveBeenCalledWith('[validators] exclamations', expect.objectContaining({ n: 2 }));
  });
});

describe('stageFallback (§5.13)', () => {
  const stages = ['opening', 'discovery', 'fit', 'sample', 'objection', 'close', 'roleplay_setup', 'roleplay', 'captured', 'handoff', 'closed', 'weird'];

  test('no digits, ≤ 1 question, no Arabic in en, «هون» never «هنا»', () => {
    for (const stage of stages) {
      for (const disclosed of [true, false]) {
        const ar = v.stageFallback(stage, 'ar', { disclosed, sector: 'clinic' });
        const en = v.stageFallback(stage, 'en', { disclosed, sector: 'clinic' });
        for (const s of [ar, en]) {
          expect(s).not.toMatch(/[0-9٠-٩]/);
          expect(v.countQuestions(s)).toBeLessThanOrEqual(1);
        }
        expect(en).not.toMatch(/[ء-ي]/);
        expect(ar).not.toContain('هنا');
      }
    }
  });

  test('SITE_HOST only in opening when not disclosed', () => {
    expect(v.stageFallback('opening', 'ar', { disclosed: false })).toContain(SITE_HOST);
    expect(v.stageFallback('opening', 'en', { disclosed: false })).toContain(SITE_HOST);
    for (const stage of stages) {
      expect(v.stageFallback(stage, 'ar', { disclosed: true })).not.toContain(SITE_HOST);
      if (stage !== 'opening') expect(v.stageFallback(stage, 'ar', { disclosed: false })).not.toContain(SITE_HOST);
    }
  });

  test('table rows', () => {
    expect(v.stageFallback('opening', 'ar')).toBe('عشان أفيدك صح: مين بيرد على رسائل واتساب عندكم حاليًا؟');
    expect(v.stageFallback('close', 'ar')).toBe('إذا بتحب، منكمّل هون، أو بطلبلك مكالمة قصيرة مع الفريق — أيهم أريح إلك؟');
    expect(v.stageFallback('roleplay_setup', 'ar', { sector: 'store' })).toBe('عشان أصير كرم تبعك: اسم المتجر ومنتجين بأسعارهم ومناطق التوصيل؟');
    expect(v.stageFallback('handoff', 'en')).toBe("Your request is on the team's list, and I'm here for any question about Karam or SHIFT.");
  });

  test('every fallback line passes the content validators', () => {
    for (const stage of stages.filter((s) => s !== 'roleplay_setup')) {
      for (const lang of ['ar', 'en']) {
        const r = v.validateResult(reply([textPart(v.stageFallback(stage, lang, { disclosed: false }))]), baseCtx({ lang, stage: 'discovery' }));
        expect(r.verdict).toBe('ok');
      }
    }
  });
});

// ─── round-2 review ──────────────────────────────────────────────────────────

describe('round 2 #2/#10/#11 — an appointment the server never made', () => {
  const booked = { bookingEnabled: true, offers: [{ id: 'book:a', title: 'اليوم 12:30 الظهر' }, { id: 'book:b', title: 'الأحد 9:00 الصبح' }] };

  test('an invented diary is blocked even when the customer typed the same hour', () => {
    // «الدوام من ١٠ الصبح ل ٨ المسا» made 10 an allowed number, so the digit guard let this through.
    const ctx = baseCtx({ ...booked, batchTexts: ['الدوام من ١٠ الصبح ل ٨ المسا'] });
    expect(v.checkDigits('أقرب موعد متوفر هو الأحد الساعة 10:00 الصبح', ctx)).toEqual([]);
    expect(v.checkAppointmentTime('أقرب موعد متوفر هو الأحد الساعة 10:00 الصبح', ctx))
      .toEqual([{ code: 'appointment_time', detail: expect.any(String) }]);
  });

  test('a booking claim outside a real booking is blocked', () => {
    expect(v.checkAppointmentTime('تمام دكتورة رنا، تثبّت موعد بكرا الساعة 11 الصبح.', baseCtx(booked)))
      .toEqual([{ code: 'appointment_time', detail: expect.any(String) }]);
  });

  test('#10 a call at a named time for a request that is not a booking is blocked', () => {
    expect(v.checkAppointmentTime('وبيحكوا معك اتصال بكرا بين 10 و12 لتحديد الوقت بالضبط.', baseCtx(booked)))
      .toHaveLength(1);
  });

  test('#11 the stored booking\'s own time passes, a replayed one does not', () => {
    const withBooking = baseCtx({ ...booked, booking: { when: 'الأحد 20/9 9:00 الصبح', status: 'booked' } });
    expect(v.checkAppointmentTime('موعدك هو الأحد الساعة 9:00 الصبح.', withBooking)).toEqual([]);
    expect(v.checkAppointmentTime('بتابع معك الموعد بكرا بين 10 و12.', withBooking)).toHaveLength(1);
  });

  test('the team\'s own offered slots and ordinary talk about a call pass', () => {
    expect(v.checkAppointmentTime('أقرب أوقات الفريق: اليوم 12:30 الظهر.', baseCtx(booked))).toEqual([]);
    expect(v.checkAppointmentTime('بتحب نرتب مكالمة قصيرة مع الفريق؟', baseCtx(booked))).toEqual([]);
  });

  test('inside the example, and with booking off, nothing is blocked', () => {
    expect(v.checkAppointmentTime('بثبتلك موعد بكرا الساعة 11.', baseCtx({ ...booked, roleplayActive: true }))).toEqual([]);
    expect(v.checkAppointmentTime('بثبتلك موعد بكرا الساعة 11.', baseCtx({ bookingEnabled: false }))).toEqual([]);
  });
});

describe('round 2 #8 — one introduction per conversation', () => {
  const intro = 'أنا كرم، مساعد شِفت الذكي (shifts-ai.com) — نفس محرّك كرم اللي بنركّبه عندك، بس هون بمعلومات شِفت.';

  test('a repeat intro is removed, the rest of the line stays', () => {
    const r = v.validateResult(reply([textPart(`${intro} ممتاز! أقرب أوقات الفريق.`)]), baseCtx({ disclosedBefore: true }));
    expect(r.result.messages[0].text).toBe('ممتاز! أقرب أوقات الفريق.');
    expect(r.blocks.map((b) => b.code)).toContain('repeat_intro');
  });

  test('the first introduction is never stripped', () => {
    const r = v.validateResult(reply([textPart(`${intro} شو نوع شغلك؟`)]), baseCtx({ disclosedBefore: false }));
    expect(r.result.messages[0].text).toContain('أنا كرم');
    expect(r.blocks.map((b) => b.code)).not.toContain('repeat_intro');
  });

  test('the honest identity answer is never stripped as a repeat', () => {
    const ctx = baseCtx({ disclosedBefore: true, batchTexts: ['انت بوت ولا انسان'] });
    const r = v.validateResult(reply([textPart(v.HONEST_IDENTITY.ar)]), ctx);
    expect(r.result.messages[0].text).toBe(v.HONEST_IDENTITY.ar);
  });
});

describe('round 2 #14 — SHIFT did not build the model', () => {
  test.each([
    'ورا كرم محرك ذكاء اصطناعي طورته شركة شِفت.',
    'المحرك تبعنا، طوّرناه بشِفت.',
    'هاد نموذج تبعنا.',
  ])('%s is replaced by the approved wording', (line) => {
    const r = v.validateResult(reply([textPart(line)]), baseCtx());
    expect(r.blocks.map((b) => b.code)).toContain('training_claim');
    expect(r.result.messages[0].text).toContain('بشتغل على نموذج ذكاء اصطناعي');
  });

  test('the approved intro still passes', () => {
    const line = 'نفس محرّك كرم اللي بنركّبه عندك، بس هون بمعلومات شِفت.';
    expect(v.checkTrainingClaim(line)).toEqual([]);
  });
});

describe('round 2 #17 — a repeated phrase', () => {
  test('«حقك علي حقك علينا» loses the first copy', () => {
    const r = v.validateResult(reply([textPart('حقك علي حقك علينا، منرتبها مع الفريق.')]), baseCtx());
    expect(r.result.messages[0].text).toBe('حقك علينا، منرتبها مع الفريق.');
    expect(r.blocks.map((b) => b.code)).toContain('stutter');
  });

  test('two different phrases that merely rhyme are left alone', () => {
    for (const line of ['بدك قهوة بدك شاي؟', 'أهلًا وسهلًا فيك.', 'تمام تمام، منكمل.']) {
      expect(v.dedupeStutter(line)).toBe(line);
    }
  });
});

describe('verdict matrix (§5.1)', () => {
  test('a digits block on attempt 1 → regenerate; on attempt 2 → fallback', () => {
    const r1 = v.validateResult(reply([textPart('باقتنا حوالي 50 دينار بالشهر.')]), baseCtx());
    expect(r1.verdict).toBe('regenerate');
    expect(r1.hint).toBe(v.hintFor('digits'));
    const r2 = v.validateResult(reply([textPart('باقتنا حوالي 50 دينار بالشهر.')]), baseCtx({ attempt: 2 }));
    expect(r2.verdict).toBe('fallback');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[validators\] .*"digits"/));
  });

  test('hints are joined for two codes, one line each', () => {
    const r = v.validateResult(reply([textPart('باقتنا 50 دينار ومضمونة.')]), baseCtx());
    expect(r.verdict).toBe('regenerate');
    expect(r.hint.split('\n')).toEqual([v.hintFor('digits'), v.hintFor('guarantee')]);
  });

  test('guarantee and over-claim share one hint line', () => {
    const r = v.validateResult(reply([textPart('مضمون، ونفس اللي بنركّبه على رقمك')]), baseCtx());
    expect(r.hint.split('\n')).toHaveLength(1);
  });

  test('server-only parts (no modelLine) skip content checks: a true «سجّلت» ack is never blocked', () => {
    const ack = acks.flagAck('quote', { lang: 'ar' });
    const r = v.validateResult(reply([{ type: 'text', text: ack, ack }]), baseCtx());
    expect(r.verdict).toBe('ok');
    expect(r.result.messages[0].text).toBe(ack);
  });

  test('the input result is never mutated', () => {
    const input = reply([textPart('**باقتنا** 50 دينار بالشهر: شو رأيك؟ وين موقعك؟ ومين بيرد؟')]);
    const copy = JSON.parse(JSON.stringify(input));
    v.validateResult(input, baseCtx({ attempt: 2 }));
    expect(input).toEqual(copy);
  });

  test('non-reply kinds get content checks only', () => {
    const r = v.validateResult({ kind: 'handoff', action: 'HANDOFF_TO_HUMAN', messages: [{ type: 'text', text: 'تمام: ', modelLine: 'تمام: ' }], workflowDataPatch: {} }, baseCtx());
    expect(r.result.workflowDataPatch.last_bot).toBeUndefined();
  });

  test('CODES lists every code the validators emit', () => {
    expect(v.CODES).toEqual(['markdown', 'digits', 'guarantee', 'overclaim', 'claimed_action', 'human_claim', 'identity',
      'questions', 'buttons', 'dangling_colon', 'split', 'link', 'language', 'next_step', 'training_claim',
      'appointment_time', 'repeat_intro', 'stutter']);
  });

  test('the old host literal never appears in validator output', () => {
    const r = v.validateResult(reply([textPart(`التفاصيل على ${OLD_HOST}/privacy`)]), baseCtx());
    expect(r.result.messages[0].text).toBe('التفاصيل على shifts-ai.com/privacy');
    expect(r.verdict).toBe('ok');
  });
});

describe('integration pass — a declined call is not a time request', () => {
  test('EXPLICIT_TIME_RE ignores negated asks', () => {
    for (const t of ['ما بدي مكالمة', 'مش بدي موعد هلأ', "don't call me"]) expect(v.EXPLICIT_TIME_RE.test(t)).toBe(false);
    for (const t of ['بدي مكالمة', 'call me tomorrow', 'متى نحكي؟']) expect(v.EXPLICIT_TIME_RE.test(t)).toBe(true);
  });

  test('the role-play closure takes quantities from earlier example turns (vctx.roleplayTexts)', () => {
    const facts = ['شاورما 3 دنانير', 'برجر 4'];
    const base = { roleplayActive: true, roleplayFacts: facts, batchTexts: ['أنا أبو أحمد، أكّد'] };
    expect(v.allowedNumberSet(base).has('10')).toBe(false);
    expect(v.allowedNumberSet({ ...base, roleplayTexts: ['أنا أبو أحمد، أكّد', 'بدي 2 شاورما و1 برجر'] }).has('10')).toBe(true);
  });
});

// ─── Review round 1 ──────────────────────────────────────────────────────────

describe('review r1-2: the digit guard catches Jordanian number forms, price words and statistics', () => {
  const AR = [
    'الاشتراك بخمسطعش دينار بالشهر.',
    'الباقة بخمسمية دينار بالسنة.',
    'ألفين دينار بالسنة',
    'الاشتراك بدينارين باليوم بس.',
    'أول شهرين ببلاش.',
    'التكلفة 35 وبس.',
    'بـ 50 دولار بتبلش.',
    'رسوم التركيب 150 مرة وحدة.',
    'كرم بيرد على 95 بالمية من الرسائل.',
    'بيوفر عليك تسعين بالمية',
    'التركيب بياخد 3 أيام.',
    'في تجربة مجانية لمدة 14 يوم.',
    'أكثر من 200 مطعم بعمّان شغالين على كرم.',
    'اشتراك المطاعم الصغيرة عادة بيكون حوالي 40',
  ];
  const EN = [
    'It costs 35 dinars a month.',
    'Plans start at $50.',
    'It is 25 a month.',
    'Setup takes 3 days.',
    'You get a 14-day free trial.',
    'We have over 200 happy customers.',
  ];

  test.each(AR)('blocks (ar): %s', (line) => {
    const r = v.validateResult(reply([textPart(line)]), baseCtx());
    expect(r.verdict).toBe('regenerate');
    expect(r.blocks.map((b) => b.code)).toContain('digits');
  });

  test.each(EN)('blocks (en): %s', (line) => {
    const r = v.validateResult(reply([textPart(line)]), baseCtx({ lang: 'en', batchTexts: ['hello'] }));
    expect(r.verdict).toBe('regenerate');
    expect(r.blocks.map((b) => b.code)).toContain('digits');
  });

  test.each([
    'بتحب يتواصل معك الفريق بعد يومين؟',
    'ما بيضيع ولا واحد من زباينك بالليل.',
    'الرد خلال نص ساعة بالكثير.',
    'الفريق بيرد ضمن الدوام، والرد عادة خلال الساعة 11 الصبح.',
    'كرم بيرد 24 ساعة باليوم.',
  ])('still passes: %s', (line) => {
    expect(v.checkDigits(line, baseCtx())).toEqual([]);
  });

  test('«بالمية» is a percent word, not the number 100; «مية» inside «خمسمية» is not 100 either', () => {
    expect(v.findNumbers('95 بالمية').map((n) => n.value)).toEqual([95]);
    expect(v.findNumbers('بخمسمية').map((n) => n.value)).toEqual([500]);
  });

  test('«الساعة 50» / "at 50" is not a clock time', () => {
    expect(v.checkDigits('Plans start at 50 a month.', { lang: 'en' }).map((b) => b.detail)).toEqual(['50']);
  });

  test('the business-statistics keywords are off inside the example («طاولة لـ4 بالمطعم»)', () => {
    expect(v.checkDigits('عندنا طاولة لـ4 أشخاص بالمطعم.', { roleplayActive: true, roleplayFacts: [], batchTexts: [] })).toEqual([]);
  });
});

describe('review r1-3: denials of being a bot and made-up staff personas', () => {
  test.each(['انت حقيقي؟', 'بحكي مع برنامج؟', 'هل الرد آلي؟', 'is this automated?', 'are you ChatGPT?'])('identity question: %s', (q) => {
    expect(v.isIdentityQuestion(q)).toBe(true);
  });

  test.each(['هاد السعر حقيقي؟', 'بدي بوت يرد على الزباين', 'is this price real?'])('not an identity question: %s', (q) => {
    expect(v.isIdentityQuestion(q)).toBe(false);
  });

  test.each([
    ['انت حقيقي؟', 'أكيد حقيقي 😄 معك سامر من فريق شِفت.', 'ar'],
    ['is this automated?', 'Nope, not a bot — Sam here from the team.', 'en'],
    ['are you a bot?', "No, I'm not an AI assistant, I'm Sam from the SHIFT team.", 'en'],
  ])('after «%s» the denial «%s» becomes the honest identity line', (q, line, lang) => {
    for (const attempt of [1, 2]) {
      const r = v.validateResult(reply([textPart(line)]), baseCtx({ lang, batchTexts: [q], attempt }));
      expect(r.result.messages[0].text).toBe(v.HONEST_IDENTITY[lang]);
      expect(r.blocks.map((b) => b.code)).toContain('human_claim');
    }
  });

  test.each(["I'm not an AI, I'm Sam.", 'لا، مش بوت، معك سامر من الفريق.', 'مش برنامج 😄 أنا من فريق شِفت.', 'أهلين، معك فريق شِفت.'])(
    'human claim without a question: %s', (line) => {
      expect(v.checkHumanClaim(line)).toHaveLength(1);
    },
  );

  test.each([
    'كرم مش بوت عادي، بيفهم سؤال الزبون.',
    'بيتواصل معك حدا من الفريق ضمن الدوام.',
    'بحوّلك وبيحكي معك الفريق.',
  ])('not a human claim: %s', (line) => {
    expect(v.checkHumanClaim(line)).toEqual([]);
  });

  test('a negated disclosure is not honest; the honest lines are', () => {
    expect(v.checkIdentity("I'm not an AI assistant.", { batchTexts: ['are you a bot?'] })).toHaveLength(1);
    expect(v.checkHumanClaim(v.HONEST_IDENTITY.ar)).toEqual([]);
    expect(v.checkHumanClaim(v.HONEST_IDENTITY.en)).toEqual([]);
    expect(v.checkIdentity(v.HONEST_IDENTITY.en, { batchTexts: ['are you a bot?'] })).toEqual([]);
  });
});

describe('review r1-4: everyday past and passive claimed actions', () => {
  test.each([
    ['ar', 'أبلغت الفريق وبيتواصلوا معك.'],
    ['ar', 'تم تسجيل طلبك، والفريق رح يتصل فيك بكرا الساعة 11.'],
    ['ar', 'ثبّتت موعدك بكرا الساعة 11.'],
    ['ar', 'حطيت اسمك عند الفريق.'],
    ['ar', 'أرسلتلك العرض على الإيميل.'],
    ['en', "I've passed your details to the team, they will call you tomorrow at 11."],
    ['en', "You're booked for tomorrow at 11."],
  ])('[%s] blocks: %s', (lang, line) => {
    const r = v.validateResult(reply([textPart(line)]), baseCtx({ lang, batchTexts: [lang === 'en' ? 'hello' : 'مرحبا'] }));
    expect(r.blocks.map((b) => b.code)).toContain('claimed_action');
    expect(r.verdict).toBe('regenerate');
  });

  test.each([
    'كرم بيرد على زبائنك بلغتهم، عربي أو إنجليزي. بدك أوريك مثال؟',
    'كل طلب بينحفظ بسجل واضح للفريق.',
  ])('minor: no false claim on «%s»', (line) => {
    expect(v.checkClaimedAction(line, {})).toEqual([]);
  });
});

describe('review r1-5: invented client and market claims', () => {
  test.each([
    'أغلب زبائننا مبسوطين.',
    'عملاءنا مبسوطين من كرم.',
    'معظم الزباين اللي جربوه ضلوا معنا.',
    'كثير مطاعم بإربد بتستخدم كرم هلأ.',
    'زباينّا بالعيادات صاروا ما يضيعوا ولا موعد.',
    'أكيد رح يرفع مبيعاتك.',
    'Many restaurants in Amman already use Karam.',
  ])('blocks: %s', (line) => {
    expect(v.checkGuarantee(line)).toHaveLength(1);
    const lang = /[A-Za-z]/.test(line) ? 'en' : 'ar';
    const r = v.validateResult(reply([textPart(line)]), baseCtx({ lang, batchTexts: [lang === 'en' ? 'hello' : 'مرحبا'] }));
    expect(r.verdict).toBe('regenerate');
  });

  test('inside the example Karam may speak of «زباينا» as the prospect\'s business', () => {
    expect(v.checkGuarantee('كل زباينا بيحبوا الشاورما عنا.', { roleplayActive: true })).toEqual([]);
    expect(v.checkGuarantee('كل زباينا بيحبوا الشاورما عنا.', { roleplayActive: false })).toHaveLength(1);
  });

  test('a hedged goal is not a guarantee', () => {
    expect(v.checkGuarantee('الهدف إنه يساعدك ما تخسر طلبات بالليل.')).toEqual([]);
  });
});

describe('review minors: questions, links, body limit, language', () => {
  test.each(['شو نوع شغلك؟🙂 ومين بيرد عندكم؟', 'شو نوع شغلك؟وين موقعك؟'])('two questions with no space after the mark are trimmed: %s', (line) => {
    const r = v.validateResult(reply([textPart(line)]), baseCtx({ attempt: 2 }));
    expect(v.countQuestions(r.result.messages[0].text)).toBe(1);
  });

  test('a link on an unlisted TLD is removed', () => {
    const r = v.filterLinks('للتفاصيل شوف صفحتنا linktr.ee/shiftsai وبتلاقي كل إشي عن كرم.');
    expect(r.text).not.toContain('linktr.ee');
    expect(v.filterLinks('عبّي forms.gle/abc').text).not.toContain('forms.gle');
    expect(v.filterLinks(`شوف ${SITE_HOST}/restaurants`).events).toEqual([]);
  });

  test('a removed link leaves no dangling colon, so no slot buttons appear under it', () => {
    const line = 'شوف تفاصيل الباقات هون: https://calendly.com/shift';
    const r = v.validateResult(reply([textPart(line)]), baseCtx({ stage: 'close', offers: OFFERS, allowedButtonIds: new Set(OFFERS.map((o) => o.id)) }));
    expect(r.result.messages).toHaveLength(1);
    expect(r.result.messages[0].type).toBe('text');
    expect(r.result.messages[0].text).toBe('شوف تفاصيل الباقات هون.');
  });

  test('slot injection on a long reply keeps every interactive body within 1024 characters, with a text fallback', () => {
    const long = `Sure, here is how it works.\n\n${'Karam answers your customers any time of day and keeps every conversation organised for the team. '.repeat(18)}When would suit you?`;
    const offers = [{ id: 'slot:a', title: 'Today 4-6' }, { id: 'slot:other', title: 'Another time' }];
    const r = v.validateResult(reply([textPart(long)]), baseCtx({
      lang: 'en', stage: 'close', batchTexts: ['when can we talk?'], explicitTimeRequest: true, offers, allowedButtonIds: new Set(offers.map((o) => o.id)),
    }));
    expect(r.verdict).toBe('ok');
    const buttonsPart = r.result.messages.find((m) => m.type === 'interactive');
    expect(buttonsPart).toBeDefined();
    for (const m of r.result.messages) {
      if (m.type === 'interactive') expect(Array.from(m.text).length).toBeLessThanOrEqual(1024);
    }
    expect(buttonsPart.fallback).toEqual({ type: 'text', text: buttonsPart.text });
    expect(r.result.messages.map((m) => m.text).join('\n\n').replace(/\s+/g, ' ')).toContain('Karam answers your customers');
    expect(r.result.messages.length).toBeLessThanOrEqual(3);
  });

  test('expectedLanguage: a short English tap title with nothing stored is English; Arabic stays Arabic', () => {
    expect(v.expectedLanguage(['No'], {})).toBe('en');
    expect(v.expectedLanguage(['Hi'], {})).toBe('en');
    expect(v.expectedLanguage(['لا'], {})).toBe('ar');
    expect(v.expectedLanguage(['No'], { language: 'ar' })).toBe('ar');
    expect(v.expectedLanguage(['11'], {})).toBe('ar');
  });
});

describe('review round 2 (validators)', () => {
  describe('r2 #3: identity questions and human-claim denials outside the first regex list', () => {
    test.each(['are u a bot?', 'r u human?', 'انت بشر؟', 'بوت؟', 'is this AI?'])('isIdentityQuestion detects %s', (q) => {
      expect(v.isIdentityQuestion(q)).toBe(true);
    });

    test.each([
      'Nope, real human here',
      "No, I'm a person",
      'Hi, I am Karam, a real member of the SHIFT team.',
      'لا، إنسان حقيقي 😊',
      'أنا بشر مثلك',
    ])('checkHumanClaim flags %s', (line) => {
      expect(v.checkHumanClaim(line).length).toBeGreaterThan(0);
    });

    test.each([
      'لا، أنا مش إنسان — أنا كرم، مساعد شِفت الذكي.',
      'إذا بتحب تحكي مع شخص حقيقي من الفريق بحوّلك هلأ.',
      'If you would rather talk to a real person from the team, I can transfer you now.',
      v.HONEST_IDENTITY.ar,
      v.HONEST_IDENTITY.en,
    ])('an honest line or a transfer offer is not a claim: %s', (line) => {
      expect(v.checkHumanClaim(line)).toEqual([]);
    });

    test('a denial answering «انت بشر؟» is rewritten to the honest line', () => {
      const r = v.validateResult(reply([textPart('لا، إنسان حقيقي 😊')]), baseCtx({ batchTexts: ['انت بشر؟'] }));
      expect(r.result.messages[0].text).toBe(v.HONEST_IDENTITY.ar);
      expect(r.blocks.map((b) => b.code)).toContain('human_claim');
    });
  });

  describe('r2 #4: plural, passive and scheduling claims of an action', () => {
    test.each([
      ['سجلنا طلبك', 'ar'],
      ['رفعت طلبك للفريق', 'ar'],
      ['خبّرت الفريق', 'ar'],
      ['تم تأكيد موعدك', 'ar'],
      ['أكدتلك الموعد', 'ar'],
      ['موعدك مثبت بكرا', 'ar'],
      ['الفريق رح يكلمك بكرا الساعة 4', 'ar'],
      ['حطيتك على قائمة الفريق', 'ar'],
      ['أرسلنا لك العرض على الإيميل', 'ar'],
      ["I've arranged a call with the team", 'en'],
      ['Your call is set for tomorrow at 11.', 'en'],
      ['Your appointment is confirmed.', 'en'],
    ])('%s is a claimed action on a NONE reply', (line, lang) => {
      expect(v.checkClaimedAction(line, { roleplayActive: false })).not.toEqual([]);
      const r = v.validateResult(reply([textPart(line)]), baseCtx({ lang, batchTexts: [lang === 'en' ? 'hi' : 'مرحبا'] }));
      expect(r.blocks.some((b) => b.code === 'claimed_action')).toBe(true);
    });

    test.each([
      'الفريق رح يتواصل معك بعد ما تختار الوقت.',
      'بعد ما يتم تأكيد الموعد من الفريق بيوصلك إشعار.',
      'ما سجلنا إشي لسا — بدك أطلبلك مكالمة؟',
    ])('not a claim: %s', (line) => {
      expect(v.checkClaimedAction(line, { roleplayActive: false })).toEqual([]);
    });
  });

  describe('r2 #5: invented statistics, multipliers and setup durations', () => {
    test.each([
      ['ar', 'بترتفع مبيعاتك ٣ أضعاف'],
      ['ar', 'المطاعم اللي بتستخدم كرم بتضاعف طلباتها مرتين'],
      ['ar', 'كرم بيرد على 95 من كل 100 رسالة'],
      ['ar', 'كرم بيرد خلال 3 ثواني على أي رسالة'],
      ['ar', 'التفعيل بياخد 48 ساعة من التوقيع'],
      ['en', 'Setup usually takes 48 hours.'],
      ['ar', 'مئات المطاعم بتستخدم كرم'],
      ['ar', 'كثير من أصحاب المحلات بيستخدموه'],
      ['ar', 'الأغلبية بيشوفوا نتيجة من أول شهر'],
    ])('[%s] %s is not ok', (lang, line) => {
      const r = v.validateResult(reply([textPart(line)]), baseCtx({ lang, batchTexts: [lang === 'en' ? 'hello' : 'مرحبا'] }));
      expect(r.verdict).not.toBe('ok');
    });

    test.each([
      'بيوصل الزبون تذكير قبل 24 ساعة من الموعد.',
      'الفريق متاح الساعة 4 بعد الظهر.',
      'كرم بيرد بالليل كمان.',
    ])('a reminder time, a clock time or a plain line still passes: %s', (line) => {
      expect(v.validateResult(reply([textPart(line)]), baseCtx()).verdict).toBe('ok');
    });
  });

  describe('r2 #6: a customer\'s guessed price is never affirmed through the attribution or quote exemptions', () => {
    const guess = (extra = {}) => baseCtx({ stage: 'objection', batchTexts: ['يعني بتكلف شي 50 دينار بالشهر؟'], ...extra });

    test('the first attempt is blocked, and the hint no longer invites the marker as a way through', () => {
      const r = v.validateResult(reply([textPart('أي، حوالي 50 دينار بالشهر')]), guess());
      expect(r.verdict).toBe('regenerate');
      expect(r.hint).toMatch(/ميزانيتك/);
      expect(r.hint).toMatch(/أي\/نعم/);
    });

    test.each([
      ['أي، رقمك 50 دينار بالشهر بيغطي الاشتراك.', {}],
      ['Yes, like you mentioned 50 JD a month works.', { lang: 'en', batchTexts: ['so it costs around 50 JD a month?'] }],
      ['أي، «50 دينار بالشهر» تقريبًا', {}],
    ])('%s is blocked on attempt 2', (line, extra) => {
      const c = guess({ attempt: 2, ...extra });
      expect(v.checkDigits(line, c)).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'digits' })]));
      expect(v.validateResult(reply([textPart(line)]), c).verdict).toBe('fallback');
    });

    test('a neutral echo of the customer\'s own number still passes', () => {
      expect(v.checkDigits('كتبت «50 دينار بالشهر» — هاد رقمك إنت، والسعر الفعلي بيحدده الفريق.', guess())).toEqual([]);
    });
  });

  describe('r2 #7: an either/or question split over two marks keeps both options', () => {
    test.each([
      ['بتحب أوريك مثال؟ ولا بتفضّل نحكي مع الفريق؟', 'ar', 'بتحب أوريك مثال، ولا بتفضّل نحكي مع الفريق؟'],
      ['بدك ردود بس؟ ولا طلبات وحجوزات كمان؟', 'ar', 'بدك ردود بس، ولا طلبات وحجوزات كمان؟'],
      ['Would you like to see an example? Or talk to the team?', 'en', 'Would you like to see an example, or talk to the team?'],
    ])('%s', (line, lang, expected) => {
      const r = v.validateResult(reply([textPart(line)]), baseCtx({ lang, batchTexts: [lang === 'en' ? 'hello' : 'مرحبا'] }));
      expect(r.verdict).toBe('ok');
      expect(r.result.messages[0].text).toBe(expected);
      expect(r.result.messages[0].modelLine).toBe(expected);
    });
  });

  describe('minors', () => {
    test.each([
      'شوف shifts-ai.com/pricing أو bit.ly/karam',
      'تفاصيل أكثر على shifts-ai.com.evil.io/restaurants',
    ])('a line left dangling by a removed link regenerates: %s', (line) => {
      const r = v.validateResult(reply([textPart(line)]), baseCtx());
      expect(r.verdict).toBe('regenerate');
      expect(r.blocks).toEqual(expect.arrayContaining([{ code: 'link', detail: 'dangling_after_removal' }]));
    });

    test.each(['shifts-ai.com.evil.de', 'x.ru/offer', 'shift-offers.ru', 'karam.fun', 'EVIL.CN', '1.2.3.4/x'])('the link filter removes %s', (host) => {
      const out = v.filterLinks(`افتح ${host} هلأ`);
      expect(out.text).toBe('افتح هلأ');
      expect(out.events).toHaveLength(1);
    });

    test('the site and its allowed pages are still kept', () => {
      expect(v.filterLinks(`شوف ${SITE_HOST}/restaurants.`)).toEqual({ text: `شوف ${SITE_HOST}/restaurants.`, events: [] });
    });

    test.each(['بطلبلك مكالمة 15 دقيقة مع الفريق — أيهم أريح إلك؟', 'I can request a 15-minute call with the team.'])('D9: the call length is never named: %s', (line) => {
      expect(v.checkDigits(line, baseCtx())).toEqual([expect.objectContaining({ code: 'digits', detail: '15' })]);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// Owner phone test, 15 Sep 2026: two claims the bot made about itself and about a customer's system.

describe('the model is not trained by SHIFT (16:12:20)', () => {
  test.each([
    'أنا نموذج ذكاء اصطناعي مدرب خصيصًا كوكيل لخدمة العملاء وأتمتة الأعمال في شِفت.',
    'أنا مدرّب خصيصاً على شغل شِفت.',
    'إحنا درّبنا النموذج على بيانات شِفت.',
    'طوّرناه بأنفسنا بشِفت.',
    "I'm a custom-trained AI agent for SHIFT.",
    'We trained the model on our own data.',
  ])('«%s» is blocked', (line) => {
    expect(v.checkTrainingClaim(line).map((b) => b.code)).toEqual(['training_claim']);
  });

  test.each([
    'نفس محرّك كرم اللي بنركّبه عندك، بس بمعلومات شِفت.',
    'بشتغل على نموذج ذكاء اصطناعي، ومعلوماتي من شِفت.',
    'أنا كرم، مساعد شِفت الذكي.',
    'The same Karam engine we set up at your place, but running on SHIFT\'s information.',
  ])('«%s» passes', (line) => {
    expect(v.checkTrainingClaim(line)).toEqual([]);
  });

  test('the claim is replaced by the approved wording, and the rest of the line stays', () => {
    const line = 'أنا نموذج ذكاء اصطناعي مدرب خصيصًا كوكيل لخدمة العملاء في شِفت. كيف بقدر أساعدك؟';
    const r = v.validateResult(reply([textPart(line)]), baseCtx());
    const text = r.result.messages[0].text;
    expect(text).toContain('بشتغل على نموذج ذكاء اصطناعي، ومعلوماتي من شِفت.');
    expect(text).not.toContain('مدرب خصيص');
    expect(text).toContain('كيف بقدر أساعدك؟');
    expect(r.blocks.map((b) => b.code)).toContain('training_claim');
  });

  test('the English replacement', () => {
    const r = v.validateResult(reply([textPart("I'm a custom-trained AI agent for SHIFT. How can I help?")]), baseCtx({ lang: 'en' }));
    expect(r.result.messages[0].text).toContain('I run on an AI model, and my information comes from SHIFT.');
    expect(r.result.messages[0].text).not.toMatch(/custom-trained/i);
  });
});

describe('integrating a system nobody at SHIFT has seen (16:42:04)', () => {
  const nexus = { batchTexts: ['إحنا عنا نظام nexus للمخزون'] };

  test('naming the customer\'s system as connectable is an over-claim', () => {
    expect(v.checkOverclaim('بنقدر نربط نظام nexus مع الواتساب أو التقويمات أو أي نظام ثاني.', baseCtx(nexus))
      .map((b) => b.code)).toEqual(['overclaim']);
    expect(v.checkOverclaim('We can connect Nexus to WhatsApp and your calendars.', baseCtx(nexus))
      .map((b) => b.code)).toEqual(['overclaim']);
  });

  test('the generic statement and the honest check with the team stay allowed', () => {
    expect(v.checkOverclaim('بنعمل ربط مخصص حسب النظام، والفريق بيتأكد إذا نظامك بيسمح بالربط.', baseCtx(nexus))).toEqual([]);
    expect(v.checkOverclaim('بنقدر نربط كرم مع واتساب وجوجل كاليندر.', baseCtx(nexus))).toEqual([]);
    // Round-2 review #13: a categorical «بنقدر نربط النظام» is the same promise whether or not the
    // customer named the system, so this one is blocked now too.
    expect(v.checkOverclaim('بنقدر نربط نظام nexus مع الواتساب.', baseCtx()))
      .toEqual([{ code: 'overclaim', detail: 'integration:categorical' }]);
    expect(v.checkOverclaim('أكيد بنقدر نربط الكاش ونقاط البيع مع النظام لتتبع المبيعات والمخزون.', baseCtx()))
      .toEqual([{ code: 'overclaim', detail: 'integration:categorical' }]);
    expect(v.checkOverclaim('شِفت بتعمل أتمتة مخصّصة، والفريق بيتأكد إذا نظامك بيسمح بالربط.', baseCtx())).toEqual([]);
  });

  test('the whole reply is regenerated, never sent as it is', () => {
    const r = v.validateResult(reply([textPart('أكيد، بنقدر نربط نظام nexus مع الواتساب.')]), baseCtx(nexus));
    expect(r.verdict).toBe('regenerate');
    expect(r.blocks.map((b) => b.code)).toContain('overclaim');
  });
});
