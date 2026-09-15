/**
 * shift/prefill.js — the site's pre-filled first message (contract §6.4 fixtures).
 */
require('./setup');

// prefill requires lead.js for `normalize`; lead.js pulls the DB modules, which must never load for real.
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const { isPrefill, parsePrefill, stripEstimates, PREFILL_MAX_CHARS, SECTOR_WORDS, PRODUCT_NAME_TO_KEY, NEED_LABELS } = require('../src/workflows/shift/prefill');
const { extractCustomerNumbers, PRODUCT_KEYS, SECTORS } = require('../src/workflows/shift/lead');

const F1 = 'مرحبًا شِفت 👋 عندي كافيه زيتون. يهمّني: كرم بوت، نقاط الولاء. عندي ~40 رسالة/يوم وأخسر ~180 دينار/شهر حسب الحاسبة. متى نحكي؟ (المصدر: fb/karam-restaurants)';
const F3 = 'مرحبًا شِفت 👋 عندي مطعم أو كافيه. أحتاج: ردود واتساب، الحجوزات والمواعيد. الاسم: محمد. الهاتف: 0791234567. متى نحكي؟';
const F10 = "Hi SHIFT 👋 I run Noor Boutique. I'm interested in: Karam Bot. I get ~40 messages/day and lose ~180 JD/month according to the calculator. Name: Sam. When can we talk? (source: google)";

// core.js clampMsg: collapse spaces, cut at the last space before the limit, strip a trailing joiner, add «…».
function clampLikeSite(msg, max = 700) {
  const m = msg.replace(/\s+/g, ' ').trim();
  if (m.length <= max) return m;
  let cut = m.lastIndexOf(' ', max - 1);
  if (cut < max * 0.6) cut = max - 1;
  return `${m.slice(0, cut).replace(/[،,\s]+$/, '')}…`;
}

describe('isPrefill', () => {
  test.each([
    [F1, true],
    ['مرحبا شفت 👋 عندي عيادة.', true],
    ['مرحباً شِفت، أريد معرفة المزيد عن كرم بوت.', true],
    ['  Hi SHIFT, I\'d like to know more about Karam Bot.', true],
    ['مرحبا، عندي كافيه', false],
    ['مرحبا', false],
    ['Hi Shiftless', false],
    ['السلام عليكم شِفت', false],
    [undefined, false],
    [42, false],
  ])('%s → %s', (text, expected) => {
    expect(isPrefill(text)).toBe(expected);
  });
});

describe('contract fixtures (§6.4)', () => {
  test('1. full composed message', () => {
    const r = parsePrefill(F1);
    expect(r).toMatchObject({ kind: 'composed', lang: 'ar', truncated: false, wantsCall: true, wantsQuote: false, attribution: 'fb/karam-restaurants' });
    expect(r.leadPatch).toEqual({ business_name: 'كافيه زيتون', sector: 'restaurant', products: ['karam', 'loyalty'], language: 'ar' });
    expect(r.siteEstimates).toEqual([
      { value: '40', unit: 'msgs_per_day', source: 'site_calculator' },
      { value: '180', unit: 'jod_per_month', source: 'site_calculator' },
    ]);
    const [[start, end]] = r.estimateSpans;
    expect(F1.slice(start, end)).toBe('عندي ~40 رسالة/يوم وأخسر ~180 دينار/شهر حسب الحاسبة.');
  });

  test('2. the public href: sector only', () => {
    const r = parsePrefill('مرحبًا شِفت 👋 عندي عيادة. متى نحكي؟');
    expect(r.leadPatch).toEqual({ sector: 'clinic', language: 'ar' });
    expect(r.wantsCall).toBe(true);
    expect(r.siteEstimates).toEqual([]);
  });

  test('3. need labels and name; the phone line is excluded, sector_text absent', () => {
    const r = parsePrefill(F3);
    expect(r.leadPatch).toEqual({ sector: 'restaurant', need: ['ردود واتساب', 'الحجوزات والمواعيد'], name: 'محمد', language: 'ar' });
    expect(r.leadPatch).not.toHaveProperty('sector_text');
    expect(r.estimateSpans.map(([a, b]) => F3.slice(a, b))).toEqual(['الهاتف: 0791234567.']);
    const stripped = stripEstimates(F3, r);
    expect(stripped).not.toContain('0791234567');
    expect(stripped).toContain('الاسم: محمد.');
    expect(extractCustomerNumbers(stripped)).toEqual([]);
  });

  test('4. calculator only: no business name, commas removed', () => {
    const r = parsePrefill('مرحبًا شِفت 👋 عندي ~1,200 رسالة/يوم. متى نحكي؟');
    expect(r.leadPatch).toEqual({ language: 'ar' });
    expect(r.siteEstimates).toEqual([{ value: '1200', unit: 'msgs_per_day', source: 'site_calculator' }]);
  });

  test('5. roi_estimate with a sector word + descriptor', () => {
    const r = parsePrefill('مرحبًا شِفت، عندي عيادة أسنان. عندي ~40 رسالة/يوم وأخسر ~180 دينار/شهر حسب الحاسبة. متى نحكي؟');
    expect(r.kind).toBe('roi_estimate');
    expect(r.leadPatch).toEqual({ sector: 'clinic', sector_text: 'عيادة أسنان', language: 'ar' });
    expect(r.siteEstimates.map((e) => e.value)).toEqual(['40', '180']);
  });

  test('6. ask_about_product', () => {
    const r = parsePrefill('مرحبًا شِفت، أريد معرفة المزيد عن نقاط الولاء.');
    expect(r.kind).toBe('ask_about_product');
    expect(r.leadPatch).toEqual({ products: ['loyalty'], language: 'ar' });
    expect(r.wantsCall).toBe(false);
  });

  test('7. bundle_quote wants a quote', () => {
    const r = parsePrefill('مرحبًا شِفت، أريد عرض سعر لباقة من: كرم بوت، الحجوزات والمواعيد.');
    expect(r.kind).toBe('bundle_quote');
    expect(r.wantsQuote).toBe(true);
    expect(r.leadPatch.products).toEqual(['karam', 'bookings']);
  });

  test('8. builder_plan: sector from the business, pain and role as needs', () => {
    const r = parsePrefill('مرحبًا شِفت، أريد خطة كرم بوت لوكيل: موظف استقبال ذكي لـعيادة عبر واتساب. أكبر مشكلة: ردود بطيئة.');
    expect(r.kind).toBe('builder_plan');
    expect(r.leadPatch.sector).toBe('clinic');
    expect(r.leadPatch.need).toEqual(expect.arrayContaining(['ردود بطيئة', 'وكيل: موظف استقبال ذكي']));
    expect(r.leadPatch).not.toHaveProperty('business_name');
  });

  test('9. team_plan → karam', () => {
    const r = parsePrefill('مرحبًا شِفت، أريد فريق كرم بوت من: موظف الاستقبال الذكي، وكيل الحجوزات الذكي.');
    expect(r.kind).toBe('team_plan');
    expect(r.leadPatch).toEqual({ products: ['karam'], language: 'ar' });
  });

  test('10. English composed message', () => {
    const r = parsePrefill(F10);
    expect(r).toMatchObject({ kind: 'composed', lang: 'en', attribution: 'google', wantsCall: true });
    expect(r.leadPatch).toEqual({ business_name: 'Noor Boutique', sector: 'store', products: ['karam'], name: 'Sam', language: 'en' });
    expect(r.siteEstimates).toEqual([
      { value: '40', unit: 'msgs_per_day', source: 'site_calculator' },
      { value: '180', unit: 'jod_per_month', source: 'site_calculator' },
    ]);
  });

  test('11. English site label with an article', () => {
    expect(parsePrefill('Hi SHIFT 👋 I run a Clinic. When can we talk?').leadPatch).toEqual({ sector: 'clinic', language: 'en' });
  });

  test('12. a 700-char composed message cut with «…» and its attribution dropped', () => {
    const labels = NEED_LABELS.ar.slice(0, 5);
    const needs = Array.from({ length: 30 }, (_, i) => labels[i % labels.length]).join('، ');
    const text = clampLikeSite(`مرحبًا شِفت 👋 عندي مطعم الساحة. يهمّني: كرم بوت، نقاط الولاء. أحتاج: ${needs}، ${needs}، ${needs}.`);
    expect(text.length).toBeLessThanOrEqual(700);
    expect(text.endsWith('…')).toBe(true);

    const r = parsePrefill(text);
    expect(r.truncated).toBe(true);
    expect(r.attribution).toBeNull();
    expect(r.wantsCall).toBe(false);
    expect(r.leadPatch).toMatchObject({ business_name: 'مطعم الساحة', sector: 'restaurant', products: ['karam', 'loyalty'] });
    expect(r.leadPatch.need).toEqual(labels);
  });

  test('13. salon with a descriptor → other + sector_text', () => {
    expect(parsePrefill('مرحبًا شِفت 👋 عندي صالون حلاقة. متى نحكي؟').leadPatch)
      .toEqual({ sector: 'other', sector_text: 'صالون حلاقة', language: 'ar' });
  });

  test('14. sector word + a name → business_name and sector', () => {
    expect(parsePrefill('مرحبًا شِفت 👋 عندي مطعم الساحة. متى نحكي؟').leadPatch)
      .toEqual({ business_name: 'مطعم الساحة', sector: 'restaurant', language: 'ar' });
  });

  test('15. not a template → null', () => {
    expect(parsePrefill('مرحبا، عندي كافيه')).toBeNull();
    expect(parsePrefill('')).toBeNull();
    expect(parsePrefill(null)).toBeNull();
  });

  test('16. stripEstimates on #1 leaves no calculator numbers for customer_numbers', () => {
    const r = parsePrefill(F1);
    const stripped = stripEstimates(F1, r);
    expect(stripped).not.toMatch(/40|180/);
    expect(extractCustomerNumbers(stripped)).toEqual([]);
    expect(stripped).toContain('عندي كافيه زيتون.');
    expect(stripped).toContain('متى نحكي؟');
  });
});

describe('further template variants', () => {
  test('English roi_estimate, builder_plan, ask_about_product, bundle_quote, team_plan', () => {
    const roi = parsePrefill('Hi SHIFT, I run a Restaurant & café. I get ~80 messages/day and lose ~1,250 JD/month according to the calculator. When can we talk?');
    expect(roi.kind).toBe('roi_estimate');
    expect(roi.leadPatch).toEqual({ sector: 'restaurant', language: 'en' });
    expect(roi.siteEstimates.map((e) => [e.value, e.unit])).toEqual([['80', 'msgs_per_day'], ['1250', 'jod_per_month']]);

    const plan = parsePrefill('Hi SHIFT, I want a Karam Bot plan for: AI Receptionist for a Clinic on WhatsApp. Biggest pain: slow replies.');
    expect(plan.kind).toBe('builder_plan');
    expect(plan.leadPatch).toEqual({ sector: 'clinic', need: ['slow replies', 'Agent: AI Receptionist'], language: 'en' });

    expect(parsePrefill("Hi SHIFT, I'd like to know more about Bookings & Appointments.").leadPatch.products).toEqual(['bookings']);
    const quote = parsePrefill("Hi SHIFT, I'd like a quote for a bundle of: Karam Bot, Loyalty Points, Business ERP.");
    expect(quote).toMatchObject({ kind: 'bundle_quote', wantsQuote: true });
    expect(quote.leadPatch.products).toEqual(['karam', 'loyalty', 'erp']);
    expect(parsePrefill("Hi SHIFT, I'd like a Karam Bot team of: AI Receptionist, AI Booking Agent.").kind).toBe('team_plan');
  });

  test('English phone line and need are parsed; «Something else» is dropped', () => {
    const text = 'Hi SHIFT 👋 I run a Online store. I need: WhatsApp replies, Something else. Name: Lina Haddad. Phone: +962 79 123 4567. When can we talk? (source: ig/stores-2026)';
    const r = parsePrefill(text);
    expect(r.leadPatch).toEqual({ sector: 'store', need: ['WhatsApp replies'], name: 'Lina Haddad', language: 'en' });
    expect(r.attribution).toBe('ig/stores-2026');
    const stripped = stripEstimates(text, r);
    expect(extractCustomerNumbers(stripped)).toEqual([]);
    expect(stripped).toContain('Name: Lina Haddad.');
  });

  test('a business name containing a dot survives', () => {
    const r = parsePrefill('مرحبًا شِفت 👋 عندي عيادة د. رنا. يهمّني: كرم بوت. متى نحكي؟');
    expect(r.leadPatch).toMatchObject({ business_name: 'عيادة د. رنا', sector: 'clinic', products: ['karam'] });
  });

  test('longest sector phrase wins and hamza / taa marbuta fold', () => {
    expect(parsePrefill('مرحبًا شِفت 👋 عندي متجر الكتروني. متى نحكي؟').leadPatch).toEqual({ sector: 'store', language: 'ar' });
    expect(parsePrefill('مرحبًا شِفت 👋 عندي مركز طبي. متى نحكي؟').leadPatch).toEqual({ sector: 'clinic', sector_text: 'مركز طبي', language: 'ar' });
    expect(parsePrefill('مرحبًا شِفت 👋 عندي عياده اطفال. متى نحكي؟').leadPatch).toEqual({ sector: 'clinic', sector_text: 'عياده اطفال', language: 'ar' });
    expect(parsePrefill('مرحبًا شِفت 👋 عندي صالون ليلى. متى نحكي؟').leadPatch)
      .toEqual({ business_name: 'صالون ليلى', sector: 'other', sector_text: 'صالون', language: 'ar' });
    expect(parsePrefill('Hi SHIFT 👋 I run a dental clinic. When can we talk?').leadPatch)
      .toEqual({ sector: 'clinic', sector_text: 'dental clinic', language: 'en' });
    expect(parsePrefill('Hi SHIFT 👋 I run Olive Café. When can we talk?').leadPatch)
      .toEqual({ business_name: 'Olive Café', sector: 'restaurant', language: 'en' });
  });

  test('a name without a sector word is a business name with no sector', () => {
    expect(parsePrefill('مرحبًا شِفت 👋 عندي زيتون وزعتر. متى نحكي؟').leadPatch).toEqual({ business_name: 'زيتون وزعتر', language: 'ar' });
  });

  test('a name cut by «…» is captured up to the cut', () => {
    const r = parsePrefill('مرحبًا شِفت 👋 عندي عيادة. الاسم: محمد عبد…');
    expect(r.truncated).toBe(true);
    expect(r.leadPatch.name).toBe('محمد عبد');
  });

  test('a calculator sentence cut before its «.» gives no estimate but is still excluded', () => {
    const text = 'مرحبًا شِفت 👋 عندي عيادة. عندي ~40 رسالة/يوم وأخسر ~1…';
    const r = parsePrefill(text);
    expect(r.siteEstimates).toEqual([]);
    expect(extractCustomerNumbers(stripEstimates(text, r))).toEqual([]);
  });

  test('every value is capped (business name 80 code points)', () => {
    const r = parsePrefill(`مرحبًا شِفت 👋 عندي ${'ز'.repeat(79)}. متى نحكي؟`);
    expect(Array.from(r.leadPatch.business_name).length).toBeLessThanOrEqual(80);
  });

  test('never throws on odd input; stripEstimates tolerates missing parse results', () => {
    for (const t of ['مرحبًا شِفت', 'Hi SHIFT', 'مرحبًا شِفت 👋 عندي . . .', 'Hi SHIFT (source: )', 'مرحبًا شِفت\nعندي\nمطعم.']) {
      expect(() => parsePrefill(t)).not.toThrow();
    }
    expect(stripEstimates('نص 40', null)).toBe('نص 40');
    expect(stripEstimates(undefined, null)).toBe('');
    expect(stripEstimates('abcdef', { estimateSpans: [[3, 5], [1, 4]] })).toBe('af');
  });

  test('word lists agree with the lead enums', () => {
    expect(Object.keys(SECTOR_WORDS).sort()).toEqual([...SECTORS].sort());
    for (const key of Object.values(PRODUCT_NAME_TO_KEY)) expect(PRODUCT_KEYS).toContain(key);
  });
});

describe('review r1-8: no catastrophic backtracking on a typed «Hi SHIFT» message', () => {
  test('a 20k-character adversarial message is not a pre-fill and returns at once', () => {
    const en = `Hi SHIFT I want a Karam Bot plan for: ${' for a on .'.repeat(1800)}`;
    const ar = `مرحبا شفت أريد خطة كرم بوت لوكيل: ${' لـا عبر .'.repeat(2000)}`;
    for (const text of [en, ar]) {
      const t0 = Date.now();
      expect(isPrefill(text)).toBe(false);
      expect(parsePrefill(text)).toBeNull();
      expect(Date.now() - t0).toBeLessThan(50);
    }
  });

  test('an adversarial message just under the cap still parses quickly', () => {
    const en = `Hi SHIFT I want a Karam Bot plan for: ${' for a on .'.repeat(85)}`;
    const ar = `مرحبا شفت أريد خطة كرم بوت لوكيل: ${' لـا عبر .'.repeat(90)}`;
    for (const text of [en, ar]) {
      expect(Array.from(text).length).toBeLessThanOrEqual(PREFILL_MAX_CHARS);
      expect(isPrefill(text)).toBe(true);
      const t0 = Date.now();
      parsePrefill(text);
      expect(Date.now() - t0).toBeLessThan(50);
    }
  });
});
