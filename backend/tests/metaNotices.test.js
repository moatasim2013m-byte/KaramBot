/**
 * The payment wording owners and staff see (config/metaNotices.js).
 *
 * Six copies said «قبل 30 أيلول» and «من 1 تشرين الأول»; after those dates they read as if every
 * shop had missed a deadline. The one constant that replaces them must never carry a date again,
 * and must never promise «بدون رسوم» (commit f486294e): Meta bills the shop directly.
 */
require('./setup');

const notices = require('../src/config/metaNotices');

const MONTHS = [
  'كانون الثاني', 'كانون الأول', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول',
  'تشرين الأول', 'تشرين الثاني', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو',
  'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/** Every string in the module, with where it came from. */
function allStrings(value, path = 'metaNotices', out = []) {
  if (typeof value === 'string') out.push([path, value]);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) allStrings(v, `${path}.${k}`, out);
  }
  return out;
}

const STRINGS = allStrings(notices).filter(([path]) => !path.endsWith('WHATSAPP_MANAGER_URL'));

describe('payment wording', () => {
  test('there is wording to check', () => {
    expect(STRINGS.length).toBeGreaterThanOrEqual(13);
  });

  test.each(STRINGS)('%s has no date and no month name', (path, text) => {
    // Month names stand as whole words: «آب» must not match inside another word.
    for (const month of MONTHS) {
      expect(new RegExp(`(^|[\\s،.«(])${month}([\\s،.»)]|$)`).test(text)).toBe(false);
    }
    expect(text).not.toMatch(/\b(19|20)\d{2}\b/); // a year
    expect(text).not.toMatch(/\d{1,2}\s*[/.-]\s*\d{1,2}/); // 30/9, 1-10
    expect(text).not.toMatch(/(قبل|بعد|من|حتى|اعتبارًا من)\s+\d{1,2}\b/); // «قبل 30», «من 1»
    expect(text).not.toMatch(/مهلة/);
  });

  test.each(STRINGS)('%s promises no free fees', (path, text) => {
    expect(text).not.toMatch(/بدون رسوم|بلا رسوم|بدون إضافات|بلا إضافات|مجان/);
  });

  test.each(STRINGS)('%s is written in Arabic', (path, text) => {
    expect(text).toMatch(/[؀-ۿ]/);
  });

  test('the Meta-fees line says who bills what', () => {
    expect(notices.META_FEES_LINE).toBe('تدفع رسوم رسائل واتساب لـ Meta مباشرة من بطاقتك في WhatsApp Manager، ولا تمر عبر شِفت.');
  });

  test('short and long, for owners and staff, in all three states', () => {
    for (const state of ['missing', 'claimed', 'blocked']) {
      for (const audience of ['owner', 'staff']) {
        const { short, long } = notices.PAYMENT_NOTICES[state][audience];
        expect(short.length).toBeGreaterThan(0);
        expect(long.length).toBeGreaterThan(short.length);
        expect(notices.paymentNotice(state, audience, 'short')).toBe(short);
        expect(notices.paymentNotice(state, audience, 'long')).toBe(long);
      }
    }
  });

  test('the named exports are the «missing» wording, which replaces the dated copies', () => {
    expect(notices.PAYMENT_METHOD_OWNER_SHORT).toBe(notices.PAYMENT_NOTICES.missing.owner.short);
    expect(notices.PAYMENT_METHOD_OWNER_LONG).toBe(notices.PAYMENT_NOTICES.missing.owner.long);
    expect(notices.PAYMENT_METHOD_STAFF_SHORT).toBe(notices.PAYMENT_NOTICES.missing.staff.short);
    expect(notices.PAYMENT_METHOD_STAFF_LONG).toBe(notices.PAYMENT_NOTICES.missing.staff.long);
    expect(notices.paymentNotice()).toBe(notices.PAYMENT_METHOD_OWNER_LONG);
  });

  test('the owner is told it is their step, at Meta', () => {
    expect(notices.PAYMENT_METHOD_OWNER_LONG).toContain('WhatsApp Manager');
    expect(notices.PAYMENT_METHOD_OWNER_LONG).toContain('عندك أنت');
  });

  test('an unknown state fails loudly instead of showing nothing', () => {
    expect(() => notices.paymentNotice('late', 'owner', 'short')).toThrow(/no short owner notice/);
  });

  test('the table cannot be edited at run time', () => {
    expect(Object.isFrozen(notices.PAYMENT_NOTICES.missing.owner)).toBe(true);
  });

  test('links to Meta, not to a page of ours', () => {
    expect(notices.WHATSAPP_MANAGER_URL).toMatch(/^https:\/\/business\.facebook\.com\//);
  });
});
