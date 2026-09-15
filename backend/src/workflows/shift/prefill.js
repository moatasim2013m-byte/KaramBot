'use strict';

/**
 * Parser for the WhatsApp message the SHIFT site pre-fills (contract §6).
 *
 * The site composes the first message from fixed templates (marketing content.js `templates`, core.js
 * `composeMessage`): parts joined by one space, a «.» added after a part that ends in a letter or digit,
 * low-priority parts dropped over 700 characters, then a cut at a space with «…». Numbers are `en-US`
 * («1,200»). Every regex here is anchored to one of those template fragments, so ordinary customer text
 * that merely contains «عندي» is never mistaken for a pre-fill (isPrefill gates the whole parser).
 *
 * What it gives the workflow: facts the customer confirmed by sending them (sector, business name,
 * products, needs, name), the calculator estimates kept apart from customer_numbers (they are the site's
 * estimate, not numbers the customer typed), and char spans to cut before customer_numbers extraction.
 *
 * Pure: no DB, no network, never throws on any string.
 */

const { normalize } = require('./lead');

const SECTOR_WORDS = {
  clinic: ['عيادة', 'عياده', 'مجمع طبي', 'مركز طبي', 'مختبر', 'clinic', 'dental clinic', 'medical center'],
  restaurant: ['مطعم', 'كافيه', 'كافي', 'كوفي شوب', 'مقهى', 'مخبز', 'حلويات', 'restaurant', 'cafe', 'café', 'coffee shop', 'bakery'],
  store: ['متجر', 'متجر إلكتروني', 'متجر الكتروني', 'ستور', 'بوتيك', 'online store', 'store', 'e-shop', 'boutique'],
  other: ['صالون', 'سبا', 'جيم', 'نادي', 'مركز', 'معهد', 'أكاديمية', 'اكاديمية', 'عقارات', 'مكتب عقاري', 'صيدلية', 'سوبرماركت',
    'ماركت', 'محل', 'روضة', 'حضانة', 'salon', 'spa', 'gym', 'center', 'centre', 'academy', 'institute', 'real estate',
    'pharmacy', 'supermarket', 'shop'],
};

const DESCRIPTORS = ['أسنان', 'اسنان', 'أطفال', 'اطفال', 'تجميل', 'جلدية', 'نسائية', 'حلاقة', 'رجالي', 'نسائي', 'رياضي', 'إلكتروني', 'الكتروني',
  'أونلاين', 'اونلاين', 'صغير', 'صغيرة', 'ملابس', 'عطور', 'أحذية', 'إكسسوارات', 'شعبي', 'وجبات', 'سريعة', 'dental', 'kids', 'beauty',
  'barber', 'small', 'online', 'clothing', 'fashion'];

const PRODUCT_NAME_TO_KEY = {
  'كرم بوت': 'karam',
  'نقاط الولاء': 'loyalty',
  'نظام الدوام': 'attendance',
  'الحجوزات والمواعيد': 'bookings',
  'الاشتراكات والباقات': 'subscriptions',
  'التسويق الآلي': 'marketing',
  'نظام إدارة الأعمال': 'erp',
  'أتمتة مخصّصة': 'custom',
  'Karam Bot': 'karam',
  'Loyalty Points': 'loyalty',
  'Attendance System': 'attendance',
  'Bookings & Appointments': 'bookings',
  'Subscriptions & Packages': 'subscriptions',
  'Marketing Automation': 'marketing',
  'Business ERP': 'erp',
  'Custom Automation': 'custom',
};

// The site's «أحتاج» chip labels (content.js contact chips). «شيء آخر» carries no information and is dropped.
const NEED_LABELS = {
  ar: ['ردود واتساب', 'الحجوزات والمواعيد', 'نقاط الولاء', 'دوام الموظفين', 'حملات واتساب', 'شيء آخر'],
  en: ['WhatsApp replies', 'Bookings & appointments', 'Loyalty points', 'Staff attendance', 'WhatsApp campaigns', 'Something else'],
};
const NEED_DROPPED = ['شيء آخر', 'Something else'];

// Site sector labels (content.js sectors[*].label): exactly these mean "sector only", no business name.
const SITE_LABELS = {
  'عيادة': 'clinic',
  'مطعم أو كافيه': 'restaurant',
  'متجر إلكتروني': 'store',
  Clinic: 'clinic',
  'Restaurant & café': 'restaurant',
  'Online store': 'store',
};

const NAME_MAX = 80;
const NEED_MAX = 200;

const GREETING_AR = '^\\s*(?:مرحب[ًا]?ا?|مرحباً)\\s+(?:شِفت|شفت)';
const GREETING_EN = '^\\s*Hi SHIFT\\b';
const PREFILL_RE = /^\s*(مرحب[ًا]?ا?|مرحباً)\s+(شِفت|شفت)|^\s*Hi SHIFT\b/i;
const EN_GREETING_RE = new RegExp(GREETING_EN, 'i');
const COMMA_GREETING_RE = new RegExp(`${GREETING_AR}\\s*،|${GREETING_EN}\\s*,`, 'i');

const KIND_PATTERNS = [
  ['ask_about_product', /أريد معرفة المزيد عن (.+?)\.?\s*$/, /I'd like to know more about (.+?)\.?\s*$/],
  ['bundle_quote', /أريد عرض سعر لباقة من: (.+?)\.?\s*$/, /I'd like a quote for a bundle of: (.+?)\.?\s*$/],
  // Role and channel never hold a dot, so the lazy groups cannot trade separators across the whole text.
  ['builder_plan', /أريد خطة كرم بوت لوكيل: ([^.\n]+?) لـ(.+?) عبر ([^.\n]+?)\. أكبر مشكلة: (.+?)\.?\s*$/,
    /I want a Karam Bot plan for: ([^.\n]+?) for an? (.+?) on ([^.\n]+?)\. Biggest pain: (.+?)\.?\s*$/],
  ['team_plan', /أريد فريق كرم بوت من: (.+?)\.?\s*$/, /I'd like a Karam Bot team of: (.+?)\.?\s*$/],
];

const MSGS_RE = { ar: /عندي ~([\d,]+) رسالة\/يوم/, en: /I get ~([\d,]+) messages\/day/ };
const LOSS_RE = { ar: /وأخسر ~([\d,]+) دينار\/شهر حسب الحاسبة/, en: /and lose ~([\d,]+) JD\/month according to the calculator/ };

// What may follow the business line in a composed message; used to allow dots inside a name («عيادة د. رنا»).
const AFTER_BUSINESS = {
  ar: '(?=\\s+(?:يهم[ّ]?ني:|أحتاج:|عندي ~|الاسم:|الهاتف:|متى نحكي؟|\\(المصدر:)|\\s*…?\\s*$)',
  en: "(?=\\s+(?:I'm interested in:|I need:|I get ~|Name:|Phone:|When can we talk\\?|\\(source:)|\\s*…?\\s*$)",
};
// `strict` allows dots inside the name but stays on one short line; `loose` is the contract pattern.
const BUSINESS_RE = {
  ar: { strict: new RegExp(`عندي (?![~\\d])([^\\n؟?]{1,80}?)\\.${AFTER_BUSINESS.ar}`), loose: /عندي (?![~\d])([^.…\n]+?)\./ },
  // The composer writes a lowercase article only before a site sector label.
  en: { strict: new RegExp(`I run (an? )?(?![~\\d])([^\\n؟?]{1,80}?)\\.${AFTER_BUSINESS.en}`), loose: /I run (an? )?(?![~\d])([^.…\n]+?)\./ },
};

const PRODUCTS_RE = { ar: /يهم[ّ]?ني: (.+?)\./, en: /I'm interested in: (.+?)\./ };
const NEED_RE = { ar: /أحتاج: (.+?)\./, en: /I need: (.+?)\./ };
const NEED_TRUNC_RE = { ar: /أحتاج: (.+?)…\s*$/, en: /I need: (.+?)…\s*$/ };
const NAME_RE = {
  ar: /الاسم: (.+?)\.?(?= الهاتف:| متى نحكي|\s*$| \()/,
  en: /Name: (.+?)\.?(?= Phone:| When can| \(|\s*$)/,
};
const PHONE_RE = {
  ar: /الهاتف: (.+?)\.?(?= متى نحكي| \(|\s*$)/,
  en: /Phone: (.+?)\.?(?= When can| \(|\s*$)/,
};
const ATTRIBUTION_RE = /\((?:المصدر|source): (.+?)\)/;
const WANTS_CALL_RE = /متى نحكي؟|When can we talk\?/;

// ─── folding and word matching ───────────────────────────────────────────────

/** PR1 normalize plus hamza / taa marbuta / alef maqsura folding, for word-list matching only. */
function fold(s) {
  return normalize(s)
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

const tokens = (s) => fold(s).split(' ').filter(Boolean);

const SECTOR_PHRASES = Object.entries(SECTOR_WORDS)
  .flatMap(([sector, words]) => words.map((w) => ({ sector, words: tokens(w), raw: w })))
  // Longest phrase first, so «متجر إلكتروني» wins over «متجر» and «مركز طبي» over «مركز».
  .sort((a, b) => b.words.length - a.words.length || b.raw.length - a.raw.length);

const DESCRIPTOR_SET = new Set(DESCRIPTORS.map(fold));
const SITE_LABEL_MAP = new Map(Object.entries(SITE_LABELS).map(([label, sector]) => [fold(label), sector]));
const PRODUCT_MAP = new Map(Object.entries(PRODUCT_NAME_TO_KEY).map(([name, key]) => [fold(name), key]));
const NEED_DROPPED_SET = new Set(NEED_DROPPED.map(fold));
const NEED_LABEL_SET = new Set([...NEED_LABELS.ar, ...NEED_LABELS.en].map(fold));

function startsWithPhrase(list, phrase) {
  return phrase.length <= list.length && phrase.every((w, i) => list[i] === w);
}

function endsWithPhrase(list, phrase) {
  const offset = list.length - phrase.length;
  return offset >= 0 && phrase.every((w, i) => list[offset + i] === w);
}

/** The longest sector phrase at the start (Arabic word order) or, for English, at the end or start. */
function findSectorPhrase(list, lang) {
  // An English name inside an Arabic message («عندي Noor Boutique.») still puts its noun last.
  if (lang === 'en' || /[a-z]/.test(list[list.length - 1] || '')) {
    const tail = SECTOR_PHRASES.find((p) => endsWithPhrase(list, p.words));
    if (tail) return { ...tail, at: 'end' };
  }
  const head = SECTOR_PHRASES.find((p) => startsWithPhrase(list, p.words));
  return head ? { ...head, at: 'start' } : null;
}

function cut(value, max) {
  const chars = Array.from(String(value).trim());
  return (chars.length > max ? chars.slice(0, max).join('') : chars.join('')).trim();
}

// ─── rule 2: the business line ───────────────────────────────────────────────

/**
 * Turn the X of «عندي X.» / "I run (a) X." into lead fields:
 * a site sector label → sector only; sector word + descriptors («عيادة أسنان») → sector + sector_text;
 * anything else → business_name, with the sector read off its sector word when there is one.
 */
function businessFields(rawX, lang, { article = '' } = {}) {
  const x = String(rawX || '').replace(/\s+/g, ' ').trim();
  if (!x) return {};
  const folded = fold(x);
  const label = SITE_LABEL_MAP.get(folded);
  if (label) return { sector: label };

  const list = tokens(x);
  const phrase = findSectorPhrase(list, lang);
  if (phrase) {
    const rest = phrase.at === 'end' ? list.slice(0, list.length - phrase.words.length) : list.slice(phrase.words.length);
    if (rest.every((w) => DESCRIPTOR_SET.has(w))) {
      return { sector: phrase.sector, sector_text: cut(x, NAME_MAX) };
    }
    if (article) {
      // "I run a busy pharmacy": an article means a kind of business, not a name.
      return { sector: phrase.sector, sector_text: cut(x, NAME_MAX) };
    }
    const out = { business_name: cut(x, NAME_MAX), sector: phrase.sector };
    if (phrase.sector === 'other') {
      // The customer's own spelling of the type word («صالون» of «صالون ليلى»), not the list's.
      const words = x.split(' ');
      const n = phrase.words.length;
      out.sector_text = (phrase.at === 'end' ? words.slice(words.length - n) : words.slice(0, n)).join(' ');
    }
    return out;
  }
  if (article) return { business_name: cut(`${article}${x}`, NAME_MAX) };
  return { business_name: cut(x, NAME_MAX) };
}

function matchBusiness(text, lang) {
  const re = BUSINESS_RE[lang];
  const m = text.match(re.strict) || text.match(re.loose);
  if (!m) return null;
  if (lang === 'en') return businessFields(m[2], lang, { article: m[1] || '' });
  return businessFields(m[1], lang);
}

// ─── lists ───────────────────────────────────────────────────────────────────

const splitList = (s) => String(s).split(/\s*[،,]\s*/).map((x) => x.trim()).filter(Boolean);

function productKeys(list) {
  const out = [];
  for (const name of splitList(list)) {
    const key = PRODUCT_MAP.get(fold(name));
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

function needItems(list, { cutAtEnd = false } = {}) {
  let items = splitList(list);
  // A list cut by the 700-char limit may end in half a label: keep that last item only if it is whole.
  if (cutAtEnd && items.length && !NEED_LABEL_SET.has(fold(items[items.length - 1]))) items = items.slice(0, -1);
  return items.filter((x) => !NEED_DROPPED_SET.has(fold(x))).map((x) => cut(x, NEED_MAX));
}

// ─── spans ───────────────────────────────────────────────────────────────────

/** From `start` to its closing «.»; a sentence cut by the 700-char limit runs to the end and is incomplete. */
function sentenceSpan(text, start) {
  const dot = text.indexOf('.', start);
  return dot === -1 ? { span: [start, text.length], complete: false } : { span: [start, dot + 1], complete: true };
}

function mergeSpans(spans) {
  const sorted = spans.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

const toValue = (s) => s.replace(/,/g, '');

// ─── entry points ────────────────────────────────────────────────────────────

// The composer caps its message at 700 characters plus «…». Anything much longer was typed, not composed,
// and must never reach the kind patterns: a 20k-character message is cheap for anyone to send (review r1-8).
const PREFILL_MAX_CHARS = 1000;

function isPrefill(text) {
  return typeof text === 'string' && text.length <= PREFILL_MAX_CHARS * 2
    && Array.from(text).length <= PREFILL_MAX_CHARS && PREFILL_RE.test(text);
}

/**
 * Parse a pre-filled first message. Returns null for anything that does not start with the site's
 * greeting. Output shape: contract §6.1 plus `wantsQuote` (rule 12).
 */
function parsePrefill(text) {
  if (!isPrefill(text)) return null;
  const lang = EN_GREETING_RE.test(text) ? 'en' : 'ar';
  const truncated = text.trimEnd().endsWith('…');
  const leadPatch = {};
  const siteEstimates = [];
  const spans = [];
  const need = [];
  let products = [];

  // Rule 1: kind.
  let kind = 'composed';
  let kindMatch = null;
  for (const [name, ar, en] of KIND_PATTERNS) {
    const m = text.match(lang === 'en' ? en : ar);
    if (m) {
      kind = name;
      kindMatch = m;
      break;
    }
  }
  const msgs = text.match(MSGS_RE[lang]);
  const loss = text.match(LOSS_RE[lang]);
  if (kind === 'composed' && COMMA_GREETING_RE.test(text) && !text.includes('👋') && msgs) kind = 'roi_estimate';

  // Rule 2: business line (composed and roi_estimate), rule 11 for builder_plan.
  let business = null;
  if (kind === 'builder_plan') {
    const [, role, biz, , pain] = kindMatch;
    // As if «عندي {business}.»: the builder's business is the site's sector label or a typed name.
    business = businessFields(biz, lang);
    need.push(cut(pain, NEED_MAX), cut(`${lang === 'en' ? 'Agent' : 'وكيل'}: ${role}`, NEED_MAX));
  } else if (kind === 'composed' || kind === 'roi_estimate') {
    business = matchBusiness(text, lang);
  }
  if (business) Object.assign(leadPatch, business);

  // Rule 3: products; rules 11–12 for the product-shaped kinds.
  const productsMatch = text.match(PRODUCTS_RE[lang]);
  if (productsMatch) products = productKeys(productsMatch[1]);
  if (kind === 'ask_about_product' || kind === 'bundle_quote') products = productKeys(kindMatch[1]);
  if (kind === 'team_plan') products = ['karam'];
  if (products.length) leadPatch.products = products;

  // Rule 4: needs (a truncated list still yields its whole labels).
  const needMatch = text.match(NEED_RE[lang]);
  if (needMatch) need.push(...needItems(needMatch[1]));
  else if (truncated) {
    const partial = text.match(NEED_TRUNC_RE[lang]);
    if (partial) need.push(...needItems(partial[1], { cutAtEnd: true }));
  }
  if (need.length) leadPatch.need = Array.from(new Set(need));

  // Rule 5: calculator estimates. The whole sentence is cut from customer_numbers input, even if partial.
  for (const [match, unit] of [[msgs, 'msgs_per_day'], [loss, 'jod_per_month']]) {
    if (!match) continue;
    const { span, complete } = sentenceSpan(text, match.index);
    spans.push(span);
    if (complete) siteEstimates.push({ value: toValue(match[1]), unit, source: 'site_calculator' });
  }

  // Rule 6: name (captured up to «…» when the message was cut inside it).
  const nameMatch = text.match(NAME_RE[lang]);
  if (nameMatch) {
    const name = cut(nameMatch[1].replace(/…\s*$/, '').replace(/\.$/, ''), NAME_MAX);
    if (name) leadPatch.name = name;
  }

  // Rule 7: the phone line stays in the thread but never feeds customer_numbers.
  const phoneMatch = text.match(PHONE_RE[lang]);
  if (phoneMatch) {
    const start = phoneMatch.index;
    let end = start + phoneMatch[0].length;
    if (text[end] === '.') end += 1;
    spans.push([start, end]);
  }

  // Rule 8: attribution. Its utm values are not numbers the customer typed either.
  const attributionMatch = text.match(ATTRIBUTION_RE);
  const attribution = attributionMatch ? attributionMatch[1].trim() || null : null;
  if (attributionMatch) spans.push([attributionMatch.index, attributionMatch.index + attributionMatch[0].length]);

  leadPatch.language = lang;

  return {
    kind,
    lang,
    truncated,
    wantsCall: WANTS_CALL_RE.test(text),
    wantsQuote: kind === 'bundle_quote',
    attribution,
    leadPatch,
    siteEstimates,
    estimateSpans: mergeSpans(spans),
  };
}

/** The text without its estimate spans, for leadMeta.inboundText (customer_numbers extraction). */
function stripEstimates(text, parsed) {
  if (typeof text !== 'string') return '';
  const spans = parsed && Array.isArray(parsed.estimateSpans) ? mergeSpans(parsed.estimateSpans) : [];
  if (!spans.length) return text;
  let out = '';
  let from = 0;
  for (const [a, b] of spans) {
    out += text.slice(from, Math.max(from, a));
    from = Math.max(from, b);
  }
  out += text.slice(from);
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

module.exports = {
  PREFILL_MAX_CHARS,
  isPrefill,
  parsePrefill,
  stripEstimates,
  SECTOR_WORDS,
  DESCRIPTORS,
  PRODUCT_NAME_TO_KEY,
  NEED_LABELS,
};
