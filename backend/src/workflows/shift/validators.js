/**
 * Deterministic output validators for the SHIFT sales bot (PR2 contract §5).
 *
 * The model proposes a line; these checks decide whether a prospect may read it. Content checks read
 * only the model-authored segment (`part.modelLine`): server acks are true by construction and pinned by
 * unit tests, so a real «سجّلت طلبك…» is never blocked. Structure checks (questions, buttons, dangling
 * colon, length, next_step) run on the assembled text of every part.
 *
 * Pure: no DB, no SDK, no clock except the one passed in. Never mutates the result it is given — on a
 * fallback index.js still needs the original.
 */

const { SITE_HOST } = require('../../config/site');
const acks = require('./acks');
const roleplay = require('./roleplay');
const { extractCustomerNumbers, normalize } = require('./lead');

const OLD_HOST = ['shifts-ai', 'store'].join('.');

const CODES = ['markdown', 'digits', 'guarantee', 'overclaim', 'claimed_action', 'human_claim', 'identity', 'questions',
  'buttons', 'dangling_colon', 'split', 'link', 'language', 'next_step', 'training_claim'];

const ARABIC_LETTER_RE = /[ء-يٮ-ۓۺ-ۿ]/g;
const LATIN_LETTER_RE = /[A-Za-z]/g;
// Arabic letters and harakat only: «؟» and «،» sit in the same Unicode block but end a word.
const ARABIC_CHAR = '\\u0621-\\u065F\\u066E-\\u06D3\\u06FA-\\u06FF';

const cp = (s) => Array.from(String(s == null ? '' : s)).length;
const countMatches = (s, re) => (String(s).match(re) || []).length;

// ---------------------------------------------------------------------------------------------------
// §5.2 number tokens

const WORD_VALUES_AR = {
  واحد: 1, وحدة: 1, اثنين: 2, اتنين: 2, ثنتين: 2, ثلاث: 3, ثلاثة: 3, تلات: 3, تلاتة: 3, أربع: 4, اربع: 4,
  أربعة: 4, اربعة: 4, خمس: 5, خمسة: 5, ست: 6, ستة: 6, سبع: 7, سبعة: 7, ثمان: 8, ثمانية: 8, تمن: 8, تمنية: 8,
  تسع: 9, تسعة: 9, عشر: 10, عشرة: 10, عشرين: 20, عشرون: 20, ثلاثين: 30, تلاتين: 30, أربعين: 40, اربعين: 40,
  خمسين: 50, ستين: 60, سبعين: 70, ثمانين: 80, تمانين: 80, تسعين: 90, مية: 100, مئة: 100, ميه: 100, ميتين: 200,
  مئتين: 200, ألف: 1000, الف: 1000, آلاف: null, الاف: null, نص: 0.5, ربع: 0.25,
  // Jordanian teens, compound hundreds and thousands: «بخمسطعش دينار», «خمسمية», «ألفين» (review r1-2).
  حدعش: 11, احدعش: 11, إحدعش: 11, اطنعش: 12, اتنعش: 12, طنعش: 12, تلطعش: 13, ثلطعش: 13, تلتطعش: 13, أربعطعش: 14,
  اربعطعش: 14, خمسطعش: 15, ستطعش: 16, سطعش: 16, سبعطعش: 17, تمنطعش: 18, ثمنطعش: 18, تسعطعش: 19, ميّة: 100,
  تلتمية: 300, ثلاثمية: 300, ثلثمية: 300, ثلاثمئة: 300, أربعمية: 400, اربعمية: 400, أربعمئة: 400, خمسمية: 500,
  خمسمئة: 500, ستمية: 600, ستمئة: 600, سبعمية: 700, سبعمئة: 700, تمنمية: 800, ثمانمية: 800, ثمانمئة: 800, تسعمية: 900,
  تسعمئة: 900, ألفين: 2000, الفين: 2000, ألفان: 2000,
  // Dual nouns carry their number: «بدينارين», «أول شهرين ببلاش».
  دينارين: 2, شهرين: 2, أسبوعين: 2, اسبوعين: 2, يومين: 2, سنتين: 2,
};
// «بالمية» is "percent", not the number 100; its own keyword marks the number before it.
const PERCENT_WORD_RE = /^(?:بالمية|بالمئة|بالميه|بالميّة)$/;
// A bare «واحد/وحدة» or a fraction is everyday speech («ولا واحد من زباينك», «نص ساعة»): a claim only next to money.
const WEAK_WORD_VALUES = new Set([1, 0.5, 0.25]);
const WORD_VALUES_EN = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, thousand: 1000, half: 0.5, dozen: 12,
};
// Longest first, so «ثلاثة» is tried before «ثلاث» (the lookahead would reject the short form anyway).
const byLength = (words) => words.sort((a, b) => b.length - a.length).join('|');
const NUMBER_WORDS_AR = byLength(Object.keys(WORD_VALUES_AR));
const NUMBER_WORDS_EN = byLength(Object.keys(WORD_VALUES_EN));

const DIGIT_RE = /\d+(?:[.,]\d+)?/g;
const WORD_RE_AR = new RegExp(`(?<![${ARABIC_CHAR}])(?:و|ب|بـ|ل|ال|بال|وال)?(${NUMBER_WORDS_AR})(?![${ARABIC_CHAR}])`, 'g');
const WORD_RE_EN = new RegExp(`\\b(${NUMBER_WORDS_EN})\\b`, 'gi');

/** Numeric value of a digit token without roleplay's price bounds: «1,200» → 1200, «3,5» → 3.5. */
function digitValue(raw) {
  const s = roleplay.toWesternDigits(raw);
  if (/^\d{1,3}(,\d{3})+$/.test(s)) return Number(s.replace(/,/g, ''));
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function canonicalOf(value) {
  if (typeof value === 'number') return roleplay.canonical(value);
  if (typeof value === 'string') {
    const v = digitValue(value.trim());
    return v === null ? null : roleplay.canonical(v);
  }
  return null;
}

function findNumbers(s) {
  const text = roleplay.toWesternDigits(String(s == null ? '' : s));
  const out = [];
  for (const m of text.matchAll(DIGIT_RE)) {
    out.push({ raw: m[0], value: digitValue(m[0]), start: m.index, end: m.index + m[0].length });
  }
  for (const m of text.matchAll(WORD_RE_AR)) {
    if (PERCENT_WORD_RE.test(m[0])) continue;
    out.push({ word: true,  raw: m[0], value: WORD_VALUES_AR[m[1]], start: m.index, end: m.index + m[0].length });
  }
  for (const m of text.matchAll(WORD_RE_EN)) {
    out.push({ word: true,  raw: m[0], value: WORD_VALUES_EN[m[1].toLowerCase()], start: m.index, end: m.index + m[0].length });
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------------------------------
// §5.3 (b) digit guard

// Contract §5.3 list plus the review r1-2 gaps: cost/fee/currency words, percent, free/trial, durations
// (a delivery time or a trial length is as invented as a price), and approximations («حوالي 40»).
const CLAIM_KEYWORDS_RE = /دينار|دنانير|د\.أ|JOD|JD|سعر|أسعار|اسعار|خصم|%|٪|باقة|باقات|اشتراك|شهر|شهري|أسبوع|اسبوع|يوم تنفيذ|أيام تنفيذ|ضمان|عملاء|زبائننا|نسبة|price|prices|discount|per month|monthly|subscription|package|clients|guarantee|week|تكلفة|تكلفته|كلفة|بيكلف|بتكلف|يكلف|رسوم|دولار|\$|USD|بالمية|بالمئة|بالميه|مجاني|مجانية|مجانًا|مجانا|ببلاش|تجربة|أيام|ايام|يوم|سنة|سنوي|سنوية|بالسنة|حوالي|تقريبًا|تقريبا|بحدود|\bdinars?\b|\bmonths?\b|\byears?\b|\bannual(?:ly)?\b|\bdays?\b|\btrial\b|\bfree\b|\bcosts?\b|\bfees?\b|\bplans?\b|\bpercent\b|\babout\b|\baround\b|\bapproximately\b|\bstarts? at\b/gi;
// Statistics about businesses («أكثر من 200 مطعم», "over 200 customers"): outside the example only — inside it
// the prospect's own restaurant and customers are the subject.
const STAT_KEYWORDS_RE = /مطعم|مطاعم|عيادة|عيادات|متجر|متاجر|محلات|زبون|زباين|زبائن|عميل|أكثر من|اكثر من|أكتر من|اكتر من|\bcustomers?\b|\bbusinesses\b|\brestaurants\b|\bclinics\b|\bstores\b|\bshops\b|\bcompanies\b|\bover\b|\bmore than\b/gi;
// Review r2 #5: multipliers, "N out of M", response speed and implementation time are statistics too
// («3 أضعاف», «95 من كل 100», «خلال 3 ثواني», «التفعيل بياخد 48 ساعة»). Outside the example only.
const SETUP_WORDS = 'تفعيل|التفعيل|تركيب|التركيب|تشغيل|التشغيل|تنفيذ|التنفيذ|تجهيز|التجهيز|جاهز|جاهزة|يستغرق|بيستغرق|بياخد|بتاخد|بياخذ|بتاخذ|\\bset ?up\\b|\\bsetting up\\b|\\bonboarding\\b|\\bactivat(?:e|ion|ed)\\b|\\binstall(?:ation|ed)?\\b|\\bgo(?:es)? live\\b|\\btakes?\\b|\\bready (?:in|within)\\b|\\blaunch\\b';
const SETUP_RE = new RegExp(SETUP_WORDS, 'i');
const STAT_EXTRA_RE = new RegExp(`أضعاف|اضعاف|ضعف|من كل|ثواني|ثانية|ثوان|ثانيتين|\\bseconds?\\b|\\bsecs?\\b|\\btimes\\b|\\bout of\\b|${SETUP_WORDS}`, 'gi');
// D9: the call's length is never named («مكالمة 15 دقيقة», "a 15-minute call").
const MINUTES_AFTER_RE = new RegExp(`^\\s*[-–]?\\s*(?:دقيقة|دقائق|دقايق|mins?|minutes?)(?![${'\\u0621-\\u065F\\u066E-\\u06D3'}A-Za-z])`, 'i');
const CALL_WORD_RE = /مكالمة|مكالمه|اتصال|اجتماع|لقاء|\bcall\b|\bmeeting\b|\bchat\b/i;
const DURATION_UNIT_RE = /^\s*(?:ساعة|ساعات|ساعتين|دقيقة|دقائق|دقايق|mins|minutes|min|hours|hour)/i;
const MONEY_KEYWORDS_RE = /دينار|دنانير|JD|JOD|د\.أ|%|٪|خصم|سعر|price|discount|دولار|\$|USD|بالمية|بالمئة|\bdinars?\b|\bpercent\b/gi;
const ATTRIBUTION_RE = /ميزانيتك|حسابك|بحسابك|قلتلي|حكيتلي|الحاسبة|أعطيتني|اعطيتني|بكلامك|حسب أسعارك|حسب اسعارك|بأسعارك|رقمك|your budget|you said|you mentioned|the calculator|your calculator|by your prices|your prices|your figures|your number/i;
// The contract's `\b` after the unit is an ASCII boundary and never fires after an Arabic letter
// («24 ساعة من»), so the end of the unit is "not followed by a letter" instead.
const TIME_UNIT_RE = new RegExp(`^\\s*(ساعة|ساعات|ساعتين|دقيقة|دقائق|دقايق|صباحًا|صباحا|مساءً|مساء|بالليل|الصبح|الظهر|العصر|المسا|ص|م|am|pm|mins|minutes|min|hours|hour)(?![${ARABIC_CHAR}A-Za-z])`, 'i');
const CLAUSE_SPLIT_RE = /[.!؟?\n،,؛;—–]|\sبس\s|\sلكن\s|\sbut\s/g;
const QUOTE_RE = /«([^»]*)»|"([^"]*)"|“([^”]*)”/g;
const NEAR = 12;
// A digit in the same clause as a claim keyword counts up to this far away («اشتراك المطاعم الصغيرة عادة بيكون
// حوالي 40»); number words keep the 12-character rule, they are too common in plain speech.
const NEAR_CLAUSE = 48;

function spans(s, re) {
  const out = [];
  for (const m of String(s).matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

function gap(a, b) {
  if (a.end <= b.start) return b.start - a.end;
  if (b.end <= a.start) return a.start - b.end;
  return 0;
}

const near = (n, list) => list.some((k) => gap(n, k) <= NEAR);

function claimKeywordSpans(text, { roleplayActive = false } = {}) {
  const list = spans(text, CLAIM_KEYWORDS_RE);
  return roleplayActive ? list : list.concat(spans(text, STAT_KEYWORDS_RE), spans(text, STAT_EXTRA_RE));
}

/** A number is in claim context when a keyword sits within 12 characters, or (digits) in its clause nearby. */
function inClaimContext(text, n, keywords, money) {
  if (n.word && WEAK_WORD_VALUES.has(n.value)) return money.some((k) => gap(n, k) <= NEAR);
  if (near(n, keywords)) return true;
  if (n.word) return false;
  const clause = clauseBounds(text, n.start);
  return keywords.some((k) => k.start >= clause.start && k.end <= clause.end && gap(n, k) <= NEAR_CLAUSE);
}

/** Numbers that sit near a price / package / client keyword. */
function claimContextNumbers(s, vctx = {}) {
  const text = roleplay.toWesternDigits(String(s == null ? '' : s));
  const keywords = claimKeywordSpans(text, vctx);
  const money = spans(text, MONEY_KEYWORDS_RE);
  return findNumbers(text).filter((n) => inClaimContext(text, n, keywords, money));
}

function isTimeNumber(text, n, money) {
  const after = text.slice(n.end);
  const before = text.slice(0, n.start);
  // «الساعة 50» or "at 50" is not a clock time: only 0–24 reads as one after those words.
  const clockValue = typeof n.value === 'number' && n.value >= 0 && n.value <= 24;
  const timeShape = TIME_UNIT_RE.test(after)
    || (clockValue && (/الساعة ?$/.test(before) || /\bat $/i.test(before)))
    || /^:\d{2}/.test(after) || /\d{1,2}:$/.test(before);
  if (!timeShape || near(n, money)) return false;
  // A duration is exempt as a reminder or a clock phrase («قبل 24 ساعة»), never as how long setup takes
  // (review r2 #5): «التفعيل بياخد 48 ساعة» is an invented implementation time.
  if (DURATION_UNIT_RE.test(after) && SETUP_RE.test(clauseAt(text, n.start))) return false;
  return true;
}

/** D9: a number of minutes in the same clause as the call («مكالمة 15 دقيقة»). */
function isCallLength(text, n) {
  return MINUTES_AFTER_RE.test(text.slice(n.end)) && CALL_WORD_RE.test(clauseAt(text, n.start));
}

// Review r2 #6: a customer's number may be echoed as theirs, never affirmed as SHIFT's price or as enough.
const AFFIRM_START_RE = /^\s*(?:أي|اي|آه|اه|أيوه|أيوا|ايوا|ايوه|نعم|صح|مزبوط|بالضبط|yes|yeah|yep|yup|exactly|correct)(?![\u0621-\u065F\u066E-\u06D3A-Za-z])/i;
const OFFER_WORD_RE = /اشتراك|باقة|باقات|سعرنا|أسعارنا|اسعارنا|بيغطي|بتغطي|بيكفي|بتكفي|كافي|بتمشي|بيمشي|بتزبط|بيزبط|\bworks?\b|\bcovers?\b|\bsubscriptions?\b|\bplans?\b|\bpackages?\b|\benough\b|\bour price\b/i;

function sentenceAt(text, index) {
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(/[!؟?\n]|\.(?!\d)/g)) {
    if (m.index < index) start = m.index + 1;
    else {
      end = m.index;
      break;
    }
  }
  return text.slice(start, end);
}

/** The sentence answers «yes» to the number, or its clause ties it to SHIFT's offer («بيغطي الاشتراك»). */
function affirmsOffer(text, n) {
  return AFFIRM_START_RE.test(sentenceAt(text, n.start)) || OFFER_WORD_RE.test(clauseAt(text, n.start));
}

// The +2 d follow-up consent (eval #11, lead_consent.scope.when) is the one duration the bot may name:
// «بتحب يتواصل معك الفريق بعد يومين؟», "follow up in two days".
const CONSENT_DELAY_RE = /(?:بعد|خلال)\s+(?:يومين|2\s*(?:أيام|ايام|يوم))|\bin (?:two|2) days\b|\bafter (?:two|2) days\b/i;
const CONSENT_VERB_RE = /يتواصل|نتواصل|يرجعلك|نرجعلك|يتابع|نتابع|يحكيك|نحكيك|follow up|get back|reach out|contact you/i;

function isConsentDelay(text, n, money) {
  if (n.value !== 2 || near(n, money)) return false;
  const clause = clauseAt(text, n.start);
  const m = CONSENT_DELAY_RE.exec(clause);
  return !!m && CONSENT_VERB_RE.test(clause);
}

function customerTexts(vctx) {
  return [].concat(vctx.batchTexts || [], vctx.customerHistoryTexts || []).filter((t) => typeof t === 'string');
}

function isQuotedFromCustomer(text, n, vctx) {
  const haystack = customerTexts(vctx).map((t) => normalize(roleplay.toWesternDigits(t)));
  for (const m of text.matchAll(QUOTE_RE)) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (n.start < start || n.end > end) continue;
    const content = normalize(m[1] ?? m[2] ?? m[3] ?? '');
    if (content && haystack.some((h) => h.includes(content))) return true;
  }
  return false;
}

/** A = customer_numbers ∪ numbers in this batch ∪ calculator estimates (∪ role-play facts and totals). */
function allowedNumberSet(vctx = {}) {
  const set = new Set();
  const add = (v) => {
    const c = canonicalOf(v);
    if (c !== null) set.add(c);
  };
  const lead = vctx.lead || {};
  for (const v of Array.isArray(lead.customer_numbers) ? lead.customer_numbers : []) add(v);
  for (const t of vctx.batchTexts || []) for (const v of extractCustomerNumbers(t)) add(v);
  for (const e of Array.isArray(lead.site_estimates) ? lead.site_estimates : []) if (e) add(e.value);
  if (vctx.roleplayActive) {
    for (const v of roleplay.factNumbers(vctx.roleplayFacts)) add(v);
    // Quantities come from the whole example so far (vctx.roleplayTexts, newest first), not only this
    // batch: «أكّد» may repeat the total of an order written two turns earlier (eval #5).
    const quantityTexts = Array.isArray(vctx.roleplayTexts) && vctx.roleplayTexts.length ? vctx.roleplayTexts : vctx.batchTexts;
    for (const v of roleplay.arithmeticClosure(vctx.roleplayFacts, quantityTexts)) set.add(v);
  }
  return set;
}

/**
 * A clock time in a sentence that arranges the call («نرتّب الموعد اليوم الساعة 12:00 تقريبًا») is a fact
 * about an appointment, not a figure of speech: the customer never said 12:00 — they wrote «بعد ساعه»
 * (owner phone test 2026-09-17, 16:52). Such a time is allowed only when the customer wrote it, or when
 * the server put it on the table (a slot offer, the stored preferred time).
 */
const APPOINTMENT_RE = /موعد|مواعيد|المكالمة|مكالمة|نرتّب|نرتب|أرتّب|ارتب|نحجز|احجز|نثبّت|نثبت|نحكيك|نحكي معك|اجتماع|\bappointment\b|\bthe call\b|\ba call\b|\bmeeting\b|\bschedul\w*\b|\bbook\w*\b/i;

/** A time OF DAY, not a duration: «الساعة 12», «12:00», «5 مساءً», "at 5pm" (never «قبل 24 ساعة»). */
function isClockTimeOfDay(text, n) {
  const before = text.slice(0, n.start);
  const after = text.slice(n.end);
  if (/^:\d{2}/.test(after)) return true;
  if (DURATION_UNIT_RE.test(after)) return false;
  const clockValue = typeof n.value === 'number' && n.value >= 0 && n.value <= 24;
  if (clockValue && (/(?:الساعة|الساعه)\s*$/.test(before) || /\bat\s*$/i.test(before))) return true;
  return TIME_UNIT_RE.test(after) && !DURATION_UNIT_RE.test(after);
}

/** Numbers the server itself put in front of the customer: offered slot titles and the stored time. */
function serverTimeNumbers(vctx = {}) {
  const set = new Set();
  const add = (text) => {
    for (const v of extractCustomerNumbers(String(text || ''))) {
      const c = canonicalOf(v);
      if (c !== null) set.add(c);
    }
  };
  for (const o of Array.isArray(vctx.offers) ? vctx.offers : []) add(o && o.title);
  const pt = vctx.lead && vctx.lead.preferred_time;
  add(typeof pt === 'string' ? pt : (pt && pt.text) || '');
  return set;
}

function clauseBounds(text, index) {
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(CLAUSE_SPLIT_RE)) {
    const mEnd = m.index + m[0].length;
    if (mEnd <= index) start = mEnd;
    else if (m.index >= index) {
      end = m.index;
      break;
    }
  }
  return { start, end };
}

function clauseAt(text, index) {
  const { start, end } = clauseBounds(text, index);
  return text.slice(start, end);
}

function checkDigits(line, vctx = {}) {
  const text = roleplay.toWesternDigits(String(line == null ? '' : line));
  const keywords = claimKeywordSpans(text, vctx);
  const money = spans(text, MONEY_KEYWORDS_RE);
  let allowed = null;
  let verbatim = null;
  let serverTimes = null;
  const blocks = [];
  for (const n of findNumbers(text)) {
    if (isCallLength(text, n)) {
      blocks.push({ code: 'digits', detail: n.raw });
      continue;
    }
    if (!inClaimContext(text, n, keywords, money)) continue;
    if (isTimeNumber(text, n, money)) {
      if (!isClockTimeOfDay(text, n) || !APPOINTMENT_RE.test(clauseAt(text, n.start))) continue;
      // The minutes of a clock time belong to the hour beside them, not to a claim of their own.
      if (/\d{1,2}:$/.test(text.slice(0, n.start))) continue;
      const clock = n.value === null || n.value === undefined ? null : roleplay.canonical(n.value);
      allowed = allowed || allowedNumberSet(vctx);
      serverTimes = serverTimes || serverTimeNumbers(vctx);
      if (clock === null || allowed.has(clock) || serverTimes.has(clock)) continue;
      blocks.push({ code: 'digits', detail: n.raw });
      continue;
    }
    if (isConsentDelay(text, n, money)) continue;
    if (isQuotedFromCustomer(text, n, vctx) && !affirmsOffer(text, n)) continue;
    const value = n.value === null || n.value === undefined ? null : roleplay.canonical(n.value);
    if (vctx.roleplayActive && value !== null) {
      verbatim = verbatim || new Set(roleplay.factNumbers(vctx.roleplayFacts)
        .concat(roleplay.quantities(vctx.batchTexts)).map(roleplay.canonical));
      if (verbatim.has(value)) continue;
    }
    allowed = allowed || allowedNumberSet(vctx);
    if (value !== null && allowed.has(value) && ATTRIBUTION_RE.test(clauseAt(text, n.start)) && !affirmsOffer(text, n)) continue;
    blocks.push({ code: 'digits', detail: n.raw });
  }
  return blocks;
}

// ---------------------------------------------------------------------------------------------------
// §5.4 (b′) guarantees, (b″) over-claims

const GUARANTEE_RE = /مضمون|مضمونة|أضمنلك|اضمنلك|بضمنلك|بنضمن|نضمنلك|ما رح يضيع أي|ما رح يضيع ولا|عملاؤنا|عملائنا|زبائننا كلهم|زباينا كلهم|أغلب البوتات|اغلب البوتات|أغلب الـ|اغلب ال|كل الزباين|رح تزيد مبيعاتك|بتزيد مبيعاتك|guaranteed|we guarantee|our clients|our customers all|most bots|will increase your sales|(?:أغلب|اغلب|معظم|كثير|كتير|كثير من|كتير من)\s+(?:ال\S+|زبائن\S*|زباين\S*|عملا\S*|مطاعم|عيادات|متاجر|محلات|شركات)|(?:رح|أكيد|اكيد)\s+(?:رح\s+)?(?:ي|ت)(?:رفع|زيد|ضاعف)\s+(?:مبيعاتك|أرباحك|ارباحك|دخلك)|(?:بي|بت)(?:رفع|زيد|ضاعف)\s+(?:مبيعاتك|أرباحك|ارباحك|دخلك)|\b(?:many|most|lots of|hundreds of|thousands of|dozens of)\s+(?:restaurants|clinics|stores|shops|businesses|customers|clients|companies)\b|\bwill (?:definitely )?(?:increase|double|boost) your (?:sales|revenue|profits?)\b/i;
// «زباينا» / "our customers" claim SHIFT clients — except inside the example, where Karam speaks as the
// prospect's own business («كل زباينا بيحبوا الشاورما»).
const CLIENT_CLAIM_RE = /(?<![\u0621-\u065F\u066E-\u06D3])(?:عملاءنا|زبائننا|زباينّا|زباينا|زبايننا)(?![\u0621-\u065F\u066E-\u06D3])|\bour (?:customers|clients)\b/i;
const OVERCLAIM_RE = /نفس\s+(اللي|الي|يلي)\s+(بنركّبه|بنركبه|بنركّبو|بنركبو)\s+(على|ع)\s+رقمك|the same (one|bot|thing) we (set up|install|put) on your number/i;
const OVERCLAIM_OK_RE = /بمعلومات شِفت|بمعلومات شفت|on SHIFT's (own )?information/i;

// Review r2 #5: multipliers, «مئات المطاعم», «الأغلبية», «كثير من أصحاب المحلات».
const AR_NOT_LETTER_BEFORE = '(?<![\\u0621-\\u065F\\u066E-\\u06D3])';
const AR_NOT_LETTER_AFTER = '(?![\\u0621-\\u065F\\u066E-\\u06D3])';
const GUARANTEE_EXTRA_RE = new RegExp([
  `(?:[0-9٠-٩]+|مرتين|ضعفين|تلات|ثلاث|أربع|اربع|خمس|عشر)\\s*(?:أضعاف|اضعاف)`,
  `${AR_NOT_LETTER_BEFORE}(?:بي|بت|رح ي|رح ت|أكيد ي|أكيد ت)(?:ضاعف|تضاعف|رتفع|زيد|زود|رفع)\\s+(?:ال)?(?:مبيعات|طلبات|أرباح|ارباح|دخل|حجوزات|زباين|زبائن|مواعيد)(?:ك|كم|ها|هم)${AR_NOT_LETTER_AFTER}`,
  `${AR_NOT_LETTER_BEFORE}(?:مئات|ميات|عشرات|آلاف|الاف|ألوف|الوف)\\s+(?:من\\s+)?(?:ال)?(?:مطاعم|عيادات|متاجر|محلات|شركات|زبائن|زباين|عملاء|أصحاب|اصحاب|مشاريع|منشآت|منشات)`,
  `${AR_NOT_LETTER_BEFORE}(?:أغلب|اغلب|معظم|كثير|كتير|كثير من|كتير من)\\s+(?:أصحاب|اصحاب)`,
  `${AR_NOT_LETTER_BEFORE}(?:ال)?(?:أغلبية|اغلبية|غالبية)${AR_NOT_LETTER_AFTER}`,
  '\\b(?:double|triple|2x|3x|5x|10x)\\s+(?:your|their)\\b',
  '\\b(?:the )?majority of\\b',
].join('|'), 'i');

function checkGuarantee(line, vctx = {}) {
  const s = String(line || '');
  const m = GUARANTEE_RE.exec(s) || GUARANTEE_EXTRA_RE.exec(s) || (vctx.roleplayActive ? null : CLIENT_CLAIM_RE.exec(s));
  return m ? [{ code: 'guarantee', detail: m[0] }] : [];
}

function checkOverclaim(line, vctx = {}) {
  const s = String(line || '');
  const m = OVERCLAIM_RE.exec(s);
  if (m && !OVERCLAIM_OK_RE.test(s)) return [{ code: 'overclaim', detail: m[0] }];
  return checkIntegrationClaim(s, vctx);
}

// ---------------------------------------------------------------------------------------------------
// §5.4 (b″) integrating a named third-party system
//
// Owner phone test 2026-09-15, 16:42: the customer said they run «نظام nexus» and the reply promised
// «بنقدر نربط نظام nexus مع الواتساب أو التقويمات أو أي نظام ثاني» — a capability promise about a system
// nobody at SHIFT has seen. The generic statement that SHIFT builds integrations stays allowed, as does
// «الفريق بيتأكد إذا نظامك بيسمح بالربط»; naming the customer's system as connectable does not.

const CONNECT_CLAIM_RE = /(?:بنقدر|منقدر|بقدر|نقدر|فينا|بنعرف|رح|بن)\s*(?:نربط|نربطه|نربطها|نوصل|نوصله|ندمج|ندمجه|نركّب|نركب)|\bwe can (?:connect|integrate|link|hook up|plug)\b|\bcan be (?:connected|integrated|linked)\b|\bwe(?:'ll| will) (?:connect|integrate|link)\b/i;
// Systems SHIFT names in its own material: saying these can be connected is not a claim about an unknown one.
const KNOWN_SYSTEM_RE = /^(?:واتساب|whatsapp|جوجل|google|التقويم|التقويمات|calendar|انستغرام|instagram|فيسبوك|facebook|shopify|شوبيفاي|zapier|make|n8n|كرم|karam|shift|شِفت|شفت|إكسل|اكسل|excel|sheets|شيتس)$/i;
const SYSTEM_NAME_RE = /(?:نظام|النظام|برنامج|البرنامج|سيستم|السيستم|\bsystem\b|\bsoftware\b|\bplatform\b|\bERP\b|\bPOS\b)\s+(?:اسمه\s+|called\s+|named\s+)?([A-Za-z][A-Za-z0-9._+-]{2,}|[\u0621-\u064A]{3,})/gi;

function escapeRe(v) {
  return String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Third-party systems the customer named in their own messages. */
function customerSystemNames(vctx) {
  const names = new Set();
  for (const t of customerTexts(vctx)) {
    SYSTEM_NAME_RE.lastIndex = 0;
    for (const m of String(t).matchAll(SYSTEM_NAME_RE)) {
      const name = m[1];
      if (name && !KNOWN_SYSTEM_RE.test(name)) names.add(name);
    }
  }
  return names;
}

function checkIntegrationClaim(line, vctx = {}) {
  if (!CONNECT_CLAIM_RE.test(line)) return [];
  for (const name of customerSystemNames(vctx)) {
    if (new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'iu').test(line)) {
      return [{ code: 'overclaim', detail: `integration:${name}` }];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------------------------------
// The model is not trained by SHIFT
//
// Owner phone test 2026-09-15, 16:12: «أنا نموذج ذكاء اصطناعي مدرب خصيصًا كوكيل لخدمة العملاء وأتمتة
// الأعمال في شِفت.» Karam is a general model with SHIFT's information in the prompt. The prompt's own
// intro («نفس محرّك كرم اللي بنركّبه عندك، بس بمعلومات شِفت») stays allowed.

const TRAINING_CLAIM_RE = /مدرب خصيص|مدرّب خصيص|مدربة خصيص|مدرّبة خصيص|مدرب عند|مدرّب عند|مدربني|درّبوني|دربوني|درّبني|دربني|درّبناه|دربناه|درّبنا|دربنا\s+النموذج|طوّرناه|طورناه|طوّرنا النموذج|طورنا النموذج|صنعناه|صنعنا النموذج|بنيناه|بنينا النموذج|صمّمناه|صممناه|نموذج خاص فينا|نموذجنا الخاص|\bcustom[- ]trained\b|\btrained (?:me )?specifically\b|\bspecially trained\b|\bwe (?:trained|built|developed|created|made) (?:the |our |this )?(?:model|ai|me)\b|\bour own (?:model|ai)\b|\bbuilt in[- ]house\b/i;

const TRAINING_HONEST = {
  ar: 'بشتغل على نموذج ذكاء اصطناعي، ومعلوماتي من شِفت.',
  en: "I run on an AI model, and my information comes from SHIFT.",
};

function checkTrainingClaim(line) {
  const m = TRAINING_CLAIM_RE.exec(String(line || ''));
  return m ? [{ code: 'training_claim', detail: m[0] }] : [];
}

/** The sentences that claim SHIFT trained the model, replaced by the approved wording. */
function withApprovedTraining(line, lang) {
  const approved = TRAINING_HONEST[lang === 'en' ? 'en' : 'ar'];
  const sentences = splitSentences(line);
  if (!sentences.length) return approved;
  let used = false;
  const out = sentences.map((sentence) => {
    if (!TRAINING_CLAIM_RE.test(sentence)) return sentence;
    if (used) return '';
    used = true;
    const tail = /\s$/.test(sentence) ? ' ' : '';
    return `${approved}${tail}`;
  });
  return out.join('').trim() || approved;
}

// ---------------------------------------------------------------------------------------------------
// §5.5 (c) claimed-action guard

// Contract §5.5 list plus the review r1-4 gaps. Ambiguous stems are narrowed (minor r1): «بلغتهم» is also
// "in their language" and «بسجل واضح» "in a clear log", so bare «بلغت»/«بسجل» need the shadda or an object.
const AR_LETTER = '\\u0621-\\u065F\\u066E-\\u06D3';
const CLAIM_ACTION_RE = new RegExp([
  `(?<![${AR_LETTER}])(?:سجّلت|سجلت|سجّلتلك|سجلتلك|سجّلتك|سجلتك|بسجّل|بسجل(?:ها|ك|هم|ه|لك)(?![${AR_LETTER}])|بسجل (?:طلبك|اسمك|رقمك|موعدك)|تم التسجيل|تم تسجيل|بلّغت|أبلغت|ابلغت|بلغت (?:الفريق|فريق|الإدارة|الادارة|المدير)|حجزت|حجزتلك|تم الحجز|تم حجز|ثبّتت|ثبتت|ثبّتلك|ثبتلك|ثبتّلك|حطيت (?:اسمك|طلبك|رقمك|موعدك)|أرسلت|ارسلت|أرسلتلك|ارسلتلك|بعثت|بعتت|بعثتلك|بعتتلك|تم التحويل|تم الإرسال|تم الارسال|حوّلتك|حولتك|وصّلت|وصلت (?:طلبك|اسمك|رقمك|معلوماتك|للفريق)|بيتصل عليك الساعة|(?:رح|بي)(?: ي)?تصلوا? (?:فيك|عليك) (?:بكرا|بكرة|اليوم|الساعة|هلأ|بعد)|وصل طلبك|وصلهم طلبك`
    // Review r2 #4: first-person plural, passive and scheduling claims.
    + `|سجّلنا|سجلنا|سجّلناك|سجلناك|سجّلنالك|سجلنالك|أرسلنا|ارسلنا|أرسلنالك|ارسلنالك|بعتنا|بعثنا|بعتنالك|بعثنالك`
    + `|رفعت(?:لك)? (?:طلبك|اسمك|معلوماتك|طلب)|رفعتلك|رفعنا(?:لك)? (?:طلبك|اسمك|معلوماتك|طلب)`
    + `|خبّرت|خبرت (?:الفريق|فريق|الإدارة|الادارة|المدير)|خبّرتهم|خبرتهم|خبّرنا|خبرنا (?:الفريق|فريق)`
    + `|تم تأكيد|تم التأكيد|أكدتلك|اكدتلك|أكّدتلك|أكدنالك|اكدنالك|حطيتك|حطيناك`
    + `|(?:موعدك|الموعد|طلبك|المكالمة|مكالمتك|الحجز|حجزك)\\s+(?:مثبت|مثبّت|مؤكد|مأكد|متأكد|محجوز|مسجل|مسجّل|انحجز|تثبت|تأكد)`
    + `|(?:رح|بي|ب)\\s*ي?(?:كلمك|كلموك|حكيك|حكوك|تواصل معك|تواصلوا معك|رن عليك|رنوا عليك)\\s+(?:بكرا|بكرة|بكره|اليوم|الساعة|هلأ|الصبح|المسا|يوم)`
    // PR3: bookings are made, moved and cancelled only by the server (booking.js); the model never says so.
    + `|ثبّتنا|ثبتنا|ثبّتنالك|ثبتنالك|ثبّتنالك|ثبتناها|ثبّتناها|حجزنا|حجزنالك|حجزنالك|تم تثبيت|تثبّت الموعد|تثبت الموعد`
    + `|غيّرت (?:الموعد|موعدك|المكالمة)|غيرت (?:الموعد|موعدك|المكالمة)|غيّرنا (?:الموعد|موعدك)|غيرنا (?:الموعد|موعدك)|أجّلت (?:الموعد|موعدك|المكالمة)|أجلت (?:الموعد|موعدك|المكالمة)`
    + `|لغيت (?:الموعد|موعدك|المكالمة|الحجز)|ألغيت (?:الموعد|موعدك|المكالمة|الحجز)|الغيت (?:الموعد|موعدك|المكالمة|الحجز)|لغينا|ألغينا|الغينا|تم الإلغاء|تم الغاء|تم إلغاء`
    + `|(?:موعدك|مكالمتك|المكالمة|الموعد)\\s+(?:صار|صارت)\\s+(?:مؤكد|مؤكدة|مثبت|مثبتة|محجوز|محجوزة))`,
  "\\b(?:I've|I have|I|we've|we have) (?:logged|booked|scheduled|sent|forwarded|notified|registered|passed|shared|added|informed|arranged|confirmed|reserved)\\b",
  "\\b(?:I've|I have|we've|we have) set up (?:a|the|your) (?:call|meeting|appointment)\\b",
  '\\b(?:is|are|has been|have been) (?:all )?(?:set|booked|confirmed|scheduled|arranged) for\\b',
  '\\byour (?:call|appointment|meeting|booking|request|order) (?:is|has been|was) (?:confirmed|set|booked|scheduled|arranged|logged|registered|sent|received)\\b',
  '\\b(?:has|have) been (?:booked|scheduled|sent|forwarded|logged|passed|shared|registered|confirmed|arranged)\\b',
  "\\byou(?:'re| are) (?:all )?(?:booked|scheduled|confirmed|registered)\\b",
  '\\bwill (?:call|contact|reach) you (?:tomorrow|today|on|at)\\b',
  // PR3 booking claims.
  "\\b(?:I've|I have|I|we've|we have|we) (?:confirmed|moved|rescheduled|cancell?ed|booked|changed) (?:your|the) (?:call|meeting|appointment|booking|slot)\\b",
  '\\b(?:it|that|this|the call|your call|the slot|the meeting)(?:\'s| is| has been) (?:now )?(?:booked|confirmed|rescheduled|cancell?ed)\\b',
  '\\bbooked (?:you|it|your call|the call|a call|a slot)\\b',
  "(?:^|[,.!:\u2014\u2013-]\\s*)(?:all )?booked\\b(?! (?:up|out|solid))",
].join('|'), 'gi');
const NEGATION_BEFORE_RE = /(ما رح|ما|مش|لم|لا|مو|not|haven't|didn't|never|won't)\s*$/i;

function isNegated(line, index) {
  const prefix = line.slice(0, index);
  const windowStart = Math.max(0, prefix.length - 8);
  const m = NEGATION_BEFORE_RE.exec(prefix.slice(windowStart));
  if (!m) return false;
  // «لما سجّلت» ends in «ما» but is not a negation: the negation must be a word of its own.
  const before = prefix[windowStart + m.index - 1];
  return !before || !/[A-Za-z\u0621-\u065F\u066E-\u06D3']/.test(before);
}

function checkClaimedAction(line, vctx = {}) {
  if (vctx.roleplayActive) return [];
  const s = String(line || '');
  const blocks = [];
  for (const m of s.matchAll(CLAIM_ACTION_RE)) {
    if (!isNegated(s, m.index)) blocks.push({ code: 'claimed_action', detail: m[0] });
  }
  return blocks;
}

// ---------------------------------------------------------------------------------------------------
// §5.6 (d) human claim, (e) identity

// Contract §5.6 list plus the review r1-3 gaps: a bare «مش بوت» answer, "not an AI", and a made-up staff
// persona («معك سامر من الفريق», "Sam here from the team"). «كرم مش بوت عادي» (a pitch) is not a denial.
const HUMAN_CLAIM_RE = new RegExp([
  '(أنا|انا)\\s+(موظف|موظفة|إنسان|انسان|بشر|بني ?آدم|بني ?ادم|شخص حقيقي)',
  // Review r2 #3: «لا، إنسان حقيقي 😊», «أكيد بشر».
  '(?:^|[.!؟?\\n،,]\\s*|(?:لا|لأ|أكيد|اكيد)[،,!]?\\s+)(?:إنسان|انسان|بشر|بني ?آدم|بني ?ادم)(?![\\u0621-\\u065F\\u066E-\\u06D3])(?!\\s+(?:من|رح|بي|ب|بس|ممكن|ولا|أو|او))',
  '(أنا|انا)\\s+مش\\s+(بوت|روبوت|ذكاء اصطناعي|آلي|برنامج)',
  '(?:^|[.!؟?\\n،,]\\s*|(?:لا|لأ|أكيد|اكيد)[،,]?\\s+)مش\\s+(?:بوت|روبوت|آلي|برنامج|ذكاء اصطناعي)(?![\\u0621-\\u065F\\u066E-\\u06D3])(?!\\s*(?:عادي|تقليدي|ردود|جاهز|زي|مثل))',
  '(?:أكيد|اكيد)\\s+(?:حقيقي|إنسان|انسان)',
  '(?:^|[.!؟?\\n،,]\\s*|أهلين|أهلا|أهلًا|اهلا|مرحبا|هلا|لا|لأ)[،,!]?\\s*(?:أنا\\s+|انا\\s+)?معك\\s+(?!(?:كرم|حدا|أحد|احد|شخص|موظف|واحد|زميل|زميلي)(?![\\u0621-\\u065F\\u066E-\\u06D3]))[\\u0621-\\u065F\\u066E-\\u06D3]+\\s+من\\s+(?:فريق|الفريق)',
  '(?:^|[.!؟?\\n،,]\\s*|أهلين|أهلا|أهلًا|اهلا|مرحبا|هلا)[،,!]?\\s*معك\\s+(?:فريق|الفريق)',
  '(?:أنا|انا)\\s+من\\s+(?:فريق|الفريق)',
  "\\bI'?m (a |an )?(real )?(human|person|human being)\\b",
  '\\bI am (a |an )?(real )?(human|person|human being)\\b',
  '\\breal (?:human|person|people) here\\b',
  '\\ba real (?:member|employee|staff member|team member)\\b',
  "\\b(?:this is|it's|you're talking to|you are talking to|you're chatting with|you're speaking with) (?:a )?real (?:person|human)\\b",
  "\\bNo(?:pe)?[,.!]?\\s+(?:a\\s+)?(?:real\\s+)?(?:human|person)\\b",
  "\\bI'?m not an? (bot|AI|robot|machine)\\b",
  '\\bI am not an? (bot|AI|robot|machine)\\b',
  '\\bnot an? (bot|robot)\\b',
  '\\b(?!(?:Karam|someone|somebody|anyone|we|they|team|people|staff)\\b)[a-z]+ here from the\\b',
  "\\b(?:I'?m|I am|this is) (?!(?:Karam|someone|somebody|anyone|part|one)\\b)[a-z]+ from (?:the )?(?:SHIFT )?team\\b",
].join('|'), 'i');
// «الي» (آلي without hamza) is also the everyday «اللي» — «هاد الإشي الي بدي ياه» — so it only counts at
// the end of the question.
const IDENTITY_Q_BASE_RE = /(إنت|انت|انتي|إنتِ|انتو|هل (أنت|انت)|هاد|هذا|هاي)\s+(\S+\s+){0,2}(بوت(?![\u0621-\u065F\u066E-\u06D3])|روبوت|آلي|الي(?=\s*[؟?!.]*\s*$)|ذكاء اصطناعي)|(إنسان|انسان|بني ?آدم|بني ?ادم|شخص حقيقي)\s*(ولا|أو|او)\s*(بوت|روبوت|آلي)|(بوت|روبوت)\s*(ولا|أو|او)\s*(إنسان|انسان|بني ?آدم|بني ?ادم|شخص)|\bare you (a |an )?(human|real|person|bot|robot|ai)\b|\bis this (a )?(bot|human|real person)\b|\bam i (talking|speaking|chatting) (to|with) (a )?(bot|human|person|real)/i;
// Review r1-3: «انت حقيقي؟», «بحكي مع برنامج؟», «هل الرد آلي؟», "is this automated?", "are you ChatGPT?".
const IDENTITY_Q_EXTRA_RE = /(إنت|انت|انتي|إنتِ|هل (أنت|انت))\s+(\S+\s+){0,2}(حقيقي|برنامج|أوتوماتيك|اوتوماتيك|اتوماتيك|شات ?جي ?بي ?تي)|(بحكي|عم بحكي|بتكلم|بكتب) مع (بوت|روبوت|برنامج|آلة|الة|ذكاء اصطناعي|إنسان|انسان|شخص حقيقي)|(الرد|الردود|ردك|ردودك|الرسائل)\s+(آلي|آلية|اوتوماتيك|أوتوماتيك|اتوماتيك)|\bis (this|it) (automated|automatic|an ai|chatgpt|a real person|a person|a machine)\b|\bare you (automated|chatgpt|gpt|a machine|an ai|a real person)\b|\bam i (talking|speaking|chatting) (to|with) (a |an )?(bot|human|person|real|ai|machine)|\b(automated|auto)[- ]?(reply|replies|response|message)s?\?/i;
// Review r2 #3: "are u a bot?", "r u human?", «انت بشر؟», a bare «بوت؟», "is this AI?".
const IDENTITY_Q_SHORT_RE = /\b(?:are|r) (?:you|u|ya) (?:a |an )?(?:human|real|person|bot|robot|ai|machine)\b|\bis (?:this|it) (?:a |an )?(?:ai|bot|robot|human|machine)\b|^\s*(?:بوت|روبوت|آلي|ذكاء اصطناعي|إنسان|انسان|بشر|bot|robot|ai|human)\s*[؟?]+\s*$|(?:إنت|انت|انتي|إنتِ|انتو|هل (?:أنت|انت))\s+(?:\S+\s+){0,2}(?:بشر|آدمي|ادمي)(?![\u0621-\u065F\u066E-\u06D3])/im;
const IDENTITY_Q_RE = { test: (s) => IDENTITY_Q_BASE_RE.test(s) || IDENTITY_Q_EXTRA_RE.test(s) || IDENTITY_Q_SHORT_RE.test(s) };
const IDENTITY_OK_AR_NAME = /مساعد شِفت|مساعد شفت/;
const IDENTITY_OK_AR_AI = /الذكي|ذكاء اصطناعي/;
const IDENTITY_OK_EN = /AI assistant/i;
// A negated disclosure is a denial: "I'm not an AI assistant", «مش مساعد شِفت الذكي».
const IDENTITY_NEGATED_RE = /\bnot (an? |SHIFT's )?(AI|bot)\b|\bnot SHIFT's\b|مش\s+(مساعد|ذكاء|بوت)|لست\s+(مساعد|ذكاء|بوت)/i;

const HONEST_IDENTITY = {
  ar: 'أي، أنا كرم — مساعد شِفت الذكي (ذكاء اصطناعي)، مش شخص من الفريق. نفس محرّك كرم اللي بنركّبه عندك، بس بمعلومات شِفت. لو بتفضّل تحكي مع شخص من الفريق بحوّلك هلأ.',
  en: "Yes, I'm Karam — SHIFT's AI assistant (an AI), not a person from the team. The same Karam engine we set up at your place, but running on SHIFT's information. If you'd rather talk to someone from the team, I can transfer you now.",
};

function checkHumanClaim(line) {
  const m = HUMAN_CLAIM_RE.exec(String(line || ''));
  return m ? [{ code: 'human_claim', detail: m[0] }] : [];
}

function isIdentityQuestion(text) {
  return typeof text === 'string' && IDENTITY_Q_RE.test(text);
}

function isHonestIdentity(line) {
  const s = String(line || '');
  if (IDENTITY_NEGATED_RE.test(s)) return false;
  return (IDENTITY_OK_AR_NAME.test(s) && IDENTITY_OK_AR_AI.test(s)) || IDENTITY_OK_EN.test(s);
}

function checkIdentity(line, vctx = {}) {
  if (!(vctx.batchTexts || []).some(isIdentityQuestion)) return [];
  return isHonestIdentity(line) ? [] : [{ code: 'identity', detail: 'not_disclosed' }];
}

// ---------------------------------------------------------------------------------------------------
// §5.7 (a) Markdown, (k) links

function stripMarkdown(s) {
  if (typeof s !== 'string') return '';
  return s
    .split('\n')
    .map((l) => l.replace(/^#{1,6}\s+/, '').replace(/^\s*[-*•]\s+/, '').replace(/^\s*\d+[.)]\s+/, ''))
    .join('\n')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 $2')
    .replace(/\*\*([^\n]+?)\*\*/g, '$1')
    .replace(/__([^\n]+?)__/g, '$1')
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]*?[^\s*])\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w_])_(?!\s)([^_\n]*?[^\s_])_(?![\w_])/g, '$1$2')
    .replace(/`+/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

// Contract §5.7 TLDs plus the common link-in-bio / form / new / country TLDs (review minors: linktr.ee,
// forms.gle, x.ru), any bare host with a path («example.xyz/offer») and IPv4 hosts. A known TLD followed by
// more labels («shifts-ai.com.evil.de») is matched as one host, so it is compared whole and removed.
const URL_RE = /https?:\/\/[^\s«»"')]+|www\.[^\s«»"')]+|\b(?:[a-z0-9-]+\.)+(?:com|store|net|org|io|jo|me|app|ai|co|ly|ee|gle|gl|link|xyz|dev|page|site|online|info|biz|to|gg|us|uk|sa|ae|shop|click|live|pro|tv|cc|ws|bit|am|la|so|sh|li|lnk|website|tech|cloud|ru|su|cn|de|fr|tr|eg|iq|lb|ps|sy|kw|qa|bh|om|ye|ma|dz|tn|ir|pk|es|nl|pl|eu|ch|ca|au|br|ua|kz|jp|kr|vn|th|ph|sg|hk|tw|nz|za|ng|ke|mx|fun|top|club|vip|icu|buzz|work|space|mobi|asia|lat|rest|bar|cam|cyou|sbs|help|world|news|today|life|win|bid|loan|ga|ml|cf|tk|gq|men|ooo|zip|mov|su)(?:\.[a-z0-9-]+)*(?![a-z0-9-])(?:\/[^\s«»"')]*)?|\b(?:[a-z0-9-]+\.)+[a-z]{2,24}\/[^\s«»"')]*|\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{2,5})?(?:\/[^\s«»"')]*)?/gi;
const ALLOWED_PATHS = ['', '/', '/clinics', '/restaurants', '/online-stores', '/privacy', '/en', '/en/', '/en/clinics',
  '/en/restaurants', '/en/online-stores'];

function rewriteUrl(candidate) {
  const m = /^(https?:\/\/)?([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(candidate);
  if (!m) return { allowed: false };
  const [, scheme = '', rawHost, path = '', query = ''] = m;
  let host = rawHost.toLowerCase();
  let rewritten = false;
  if (host === OLD_HOST || host === `www.${OLD_HOST}`) {
    host = SITE_HOST.toLowerCase();
    rewritten = true;
  }
  const site = SITE_HOST.toLowerCase();
  if (host !== site && host !== `www.${site}`) return { allowed: false, rewritten };
  const checkPath = path.length > 1 && path.endsWith('/') && !ALLOWED_PATHS.includes(path) ? path.slice(0, -1) : path;
  if (!ALLOWED_PATHS.includes(checkPath)) return { allowed: false, rewritten };
  const keys = query.slice(1).split('&').filter(Boolean).map((kv) => kv.split('=')[0]);
  const keepQuery = keys.length > 0 && keys.every((k) => k.toLowerCase().startsWith('utm_'));
  const url = `${scheme}${host}${path}${keepQuery ? query : ''}`;
  return { allowed: true, rewritten, url, changed: url !== candidate };
}

/** → { text, events }: old host rewritten, disallowed URLs removed with one adjacent space. */
function filterLinks(line) {
  const s = String(line == null ? '' : line);
  const events = [];
  let out = '';
  let last = 0;
  for (const m of s.matchAll(URL_RE)) {
    const candidate = m[0].replace(/[.,!?؟،؛:]+$/, '');
    const start = m.index;
    const end = start + candidate.length;
    const r = rewriteUrl(candidate);
    if (r.allowed) {
      out += s.slice(last, start) + r.url;
      if (r.rewritten) events.push({ code: 'link', detail: `rewrite:${candidate}` });
    } else {
      let before = s.slice(last, start);
      let skipAfter = 0;
      if (before.endsWith(' ')) before = before.slice(0, -1);
      else if (s[end] === ' ') skipAfter = 1;
      out += before;
      events.push({ code: 'link', detail: `removed:${candidate}` });
      last = end + skipAfter;
      continue;
    }
    last = end;
  }
  out += s.slice(last);
  return { text: out, events };
}

// ---------------------------------------------------------------------------------------------------
// §5.8 (f) questions

const COMPOUND_ASK_RE = /اسم(ك)?.{0,30}(و)?اسم (المحل|المطعم|العيادة|المتجر|المنشأة|الشركة)|your name.{0,30}business/i;

function withoutQuotes(s) {
  return String(s || '').replace(QUOTE_RE, (q) => ' '.repeat(q.length));
}

function countQuestions(s) {
  return countMatches(withoutQuotes(s), /[؟?]/g);
}

function splitSentences(s) {
  // A terminator only ends a sentence when followed by whitespace or the end: «shifts-ai.com/privacy»
  // stays whole.
  const out = [];
  let buf = '';
  const chars = Array.from(String(s || ''));
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    buf += ch;
    let next = chars[i + 1];
    if (/[؟?]/.test(ch)) {
      // «شغلك؟🙂 ومين…»: an emoji right after the mark belongs to the question; «شغلك؟وين…» still ends it.
      // A «?» followed by Latin text (a URL query) does not.
      let emoji = false;
      while (next !== undefined && EMOJI_TAIL_RE.test(next)) {
        buf += next;
        i += 1;
        next = chars[i + 1];
        emoji = true;
      }
      if (emoji || next === undefined || /\s/.test(next) || ARABIC_CHAR_RE.test(next)) {
        out.push(buf);
        buf = '';
      }
      continue;
    }
    if (ch === '\n' || (/[.!]/.test(ch) && (next === undefined || /\s/.test(next)))) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf) out.push(buf);
  return out;
}

const ARABIC_CHAR_RE = new RegExp(`[${ARABIC_CHAR}]`);
const EMOJI_TAIL_RE = /[\p{Extended_Pictographic}\u200d\ufe0f\u{1F3FB}-\u{1F3FF}]/u;
const isQuestionSentence = (x) => /[؟?][\s\p{Extended_Pictographic}\u200d\ufe0f\u{1F3FB}-\u{1F3FF}]*$/u.test(withoutQuotes(x));

/** Keeps every statement and only the last question: one question per message, and it comes last. */
function trimQuestions(s) {
  const parts = splitSentences(s);
  let lastQ = -1;
  parts.forEach((p, i) => {
    if (isQuestionSentence(p)) lastQ = i;
  });
  if (lastQ < 0) return String(s || '');
  const kept = parts.filter((p, i) => !isQuestionSentence(p) || i === lastQ);
  const text = kept.join('').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text || parts[lastQ].trim();
}

// ---------------------------------------------------------------------------------------------------
// §5.9 (h) buttons, slot injection, dangling colon

// A negated ask («ما بدي مكالمة», "don't call me") is a decline, not a request for times: offering slot
// buttons right after it pushes the call the customer just refused (eval #11). Contract §5.9 regex plus
// the two lookbehinds.
const EXPLICIT_TIME_RE = /متى نحكي|إمتى نحكي|امتى نحكي|وقتيش نحكي|(?<!(?:ما|مش|بلاش|لا) )بدي (موعد|مكالمة)|خلينا نحكي|نحكي (بكرا|اليوم|قريب)|(?<!(?:ما|لا) )اتصلوا (فيي|فيني|عليّ|علي)|when can we (talk|speak)|can we (talk|speak|call)|schedule a call|book a call|(?<!(?:don't|do not|dont) )call me/i;
const NO_BUTTON_STAGES = ['roleplay', 'roleplay_setup', 'handoff', 'captured', 'closed'];
const NO_BUTTON_ACTIONS = ['HANDOFF_TO_HUMAN', 'OPT_OUT', 'NOT_NOW', 'END_ROLEPLAY'];
const SLOT_STAGES = ['opening', 'close'];

function buttonsForbidden(vctx) {
  return !!(vctx.roleplayActive || NO_BUTTON_STAGES.includes(vctx.stage) || vctx.stageLocked
    || NO_BUTTON_ACTIONS.includes(vctx.action));
}

function hasId(allowed, id) {
  if (!allowed) return false;
  if (allowed instanceof Set) return allowed.has(id);
  return Array.isArray(allowed) && allowed.includes(id);
}

function toTextPart(part) {
  const out = { type: 'text', text: part.text };
  for (const k of ['modelLine', 'ack', 'delayMs']) if (part[k] !== undefined) out[k] = part[k];
  return out;
}

function hasButtons(part) {
  if (!part) return false;
  if (part.type === 'interactive') return Array.isArray(part.buttons) && part.buttons.length > 0;
  if (part.type === 'list') return (part.sections || []).some((s) => (s.rows || []).length > 0);
  return false;
}

function offerButtons(vctx) {
  return (Array.isArray(vctx.offers) ? vctx.offers : []).slice(0, 3).map((o) => ({ id: o.id, title: o.title }));
}

/** Rules 1–2: forbidden context → text part; otherwise allow-listed, titled, unique, ≤ 3. */
function sanitizeButtons(part, vctx = {}) {
  const events = [];
  if (!part || (part.type !== 'interactive' && part.type !== 'list')) return { part, events };
  if (buttonsForbidden(vctx) && !part.serverButtons) {
    if (hasButtons(part)) events.push({ code: 'buttons', detail: 'forbidden' });
    return { part: toTextPart(part), events };
  }
  const offers = Array.isArray(vctx.offers) ? vctx.offers : [];
  if (part.type === 'interactive') {
    const kept = [];
    for (const b of Array.isArray(part.buttons) ? part.buttons : []) {
      if (!b || typeof b.id !== 'string') continue;
      const offer = offers.find((o) => o.id === b.id);
      const title = String(offer ? offer.title : b.title || '').trim();
      const ok = hasId(vctx.allowedButtonIds, b.id) && cp(title) >= 1 && cp(title) <= 20 && !kept.some((k) => k.id === b.id);
      if (!ok) {
        events.push({ code: 'buttons', detail: `dropped:${b.id}` });
        continue;
      }
      if (kept.length === 3) {
        events.push({ code: 'buttons', detail: `over_three:${b.id}` });
        continue;
      }
      kept.push({ id: b.id, title });
    }
    if (!kept.length) return { part: toTextPart(part), events };
    return { part: { ...part, buttons: kept }, events };
  }
  const seen = new Set();
  const sections = [];
  let rowsKept = 0;
  for (const section of Array.isArray(part.sections) ? part.sections : []) {
    const rows = [];
    for (const row of section && Array.isArray(section.rows) ? section.rows : []) {
      const title = String(row && row.title ? row.title : '').trim();
      const ok = row && hasId(vctx.allowedButtonIds, row.id) && !seen.has(row.id)
        && cp(title) >= 1 && cp(title) <= 24 && rowsKept < 10;
      if (!ok) {
        events.push({ code: 'buttons', detail: `dropped:${row && row.id}` });
        continue;
      }
      seen.add(row.id);
      rowsKept += 1;
      rows.push({ ...row, title });
    }
    if (rows.length) sections.push({ ...section, rows });
  }
  if (!sections.length) return { part: toTextPart(part), events };
  return { part: { ...part, sections }, events };
}

function injectOffers(part, vctx, { appendBody }) {
  let text = part.text || '';
  if (appendBody && !/[:：]\s*$/.test(text)) text = `${text}\n${acks.slotsBody(vctx.lang)}`.trim();
  const out = { ...part, type: 'interactive', text, buttons: offerButtons(vctx) };
  delete out.sections;
  delete out.buttonLabel;
  // Graph refusing the buttons (rejected / invalid_payload) must still leave the words with the customer.
  out.fallback = { type: 'text', text };
  return out;
}

function fixDanglingColon(part, vctx, { canInject }) {
  const text = String(part.text || '');
  if (!/[:：]\s*$/.test(text) || hasButtons(part) || !['text', 'interactive'].includes(part.type)) return { part, events: [] };
  const events = [{ code: 'dangling_colon', detail: part.type }];
  if (canInject) return { part: injectOffers({ ...part }, vctx, { appendBody: false }), events };
  const lines = text.replace(/\s+$/, '').split('\n');
  const lastLine = lines[lines.length - 1].trim();
  if (lastLine === acks.slotsBody(vctx.lang)) {
    lines[lines.length - 1] = acks.slotOther(vctx.lang);
    return { part: toPlain(part, lines.join('\n')), events };
  }
  return { part: toPlain(part, text.replace(/\s*[:：]\s*$/, '.')), events };
}

function toPlain(part, text) {
  const out = part.type === 'interactive' ? toTextPart(part) : { ...part };
  out.text = text;
  return out;
}

// ---------------------------------------------------------------------------------------------------
// §5.10 (j′) Arabizi, (j) language

// English tokens where a digit touches a letter without being Arabizi — times (5pm), ordinals (2nd), B2B,
// sizes (4G, 10k). One definition with acks.pickLanguage; the copy only covers an acks.js without the export.
const ENGLISH_DIGIT_TOKENS_RE = acks.ENGLISH_DIGIT_TOKENS_RE instanceof RegExp
  ? new RegExp(acks.ENGLISH_DIGIT_TOKENS_RE.source, 'gi')
  : /\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b\d+(st|nd|rd|th|k|m|g|x|h|hrs?|mins?|pcs?)\b|\b[bcp]2[bcp]\b/gi;
const ARABIZI_DIGIT_WORD_RE = /\b[a-z]*[a-z][2356789][a-z]*\b|\b[2356789][a-z]+\b/gi;
const ARABIZI_EXCEPTIONS_RE = /\b(mp3|mp4|h264|x264|4g|5g|3d|2fa|b2b|b2c|w3c|html5|css3|ps5|a4|a5|g7|k8s|covid19)\b/gi;
const ARABIZI_WORDS = new Set(['shu', 'sho', 'shou', 'keef', 'kif', 'kaif', 'bdi', 'badi', 'baddi', '3ndi', '3andi', 'ahlan',
  'marhaba', 'mar7aba', 'se3er', 'si3r', 'kam', 'adesh', 'addesh', 'qadeish', 'tamam', 'yalla', 'mat3am', '3iyade', '3yade',
  'habibi', 'inshallah', 'wallah', 'ya3ni', 'mesh', 'mish', 'bas', 'lesh', 'leish', 'hala', 'ahla', 'masa', 'sabah', 'el',
  'il', '3al', 'bil', 'lal', 'zabayen', '7ela2a', 'jarebni', 'jarrebni', 'hon', 'hek', 'hal2', 'halla2', 'ba3dein', 'mnee7',
  'mni7']);
const PRODUCT_TOKENS_RE = /\b(POS|Loyalty|Karam|SHIFT|Shopify|CRM|QR|Make|Zapier|n8n|AI)\b/gi;

function letterCounts(s) {
  const arabic = countMatches(s, ARABIC_LETTER_RE);
  const latin = countMatches(s, LATIN_LETTER_RE);
  return { arabic, latin, total: arabic + latin };
}

function isArabizi(text) {
  if (typeof text !== 'string' || !text) return false;
  const s = text.replace(ENGLISH_DIGIT_TOKENS_RE, ' ').replace(ARABIZI_EXCEPTIONS_RE, ' ');
  const { latin, total } = letterCounts(s);
  if (!total || latin / total < 0.7) return false;
  const digitHits = countMatches(s, ARABIZI_DIGIT_WORD_RE);
  const wordHits = s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => ARABIZI_WORDS.has(w)).length;
  return digitHits >= 1 || wordHits >= 2;
}

function languageOf(text) {
  if (typeof text !== 'string') return null;
  const { arabic, latin, total } = letterCounts(text);
  if (total < 3) return null;
  if (isArabizi(text)) return 'ar';
  if (latin / total >= 0.7) return 'en';
  if (arabic / total >= 0.3) return 'ar';
  return null;
}

/** The newest batch message that has a language decides; a customer who switches to English gets English. */
function expectedLanguage(batchTexts, lead) {
  const texts = Array.isArray(batchTexts) ? batchTexts : [];
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const lang = languageOf(texts[i]);
    if (lang) return lang;
  }
  if (lead && (lead.language === 'ar' || lead.language === 'en')) return lead.language;
  // Too short for languageOf («No», «Hi», «ok») and nothing stored: the script still tells (PR1's rule), so an
  // English [No] tap is not answered in Arabic (G14).
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    if (typeof texts[i] !== 'string') continue;
    const { arabic, latin } = letterCounts(texts[i]);
    if (arabic) return 'ar';
    if (latin && !isArabizi(texts[i])) return 'en';
  }
  return 'ar';
}

function checkLanguage(line, lang) {
  let s = String(line || '');
  if (lang === 'ar') {
    s = s.replace(URL_RE, ' ').split(SITE_HOST).join(' ').replace(PRODUCT_TOKENS_RE, ' ');
    const { latin, total } = letterCounts(s);
    return total && latin / total > 0.6 ? [{ code: 'language', detail: 'latin_in_ar' }] : [];
  }
  if (lang === 'en') {
    const { arabic, total } = letterCounts(s);
    return total && arabic / total > 0.1 ? [{ code: 'language', detail: 'arabic_in_en' }] : [];
  }
  return [];
}

// ---------------------------------------------------------------------------------------------------
// §5.11 (i) length split

function splitText(text, max = 650, { roleplayActive = false } = {}) {
  const s = String(text == null ? '' : text);
  const chars = Array.from(s);
  if (chars.length <= max || roleplayActive) return [s];
  const MIN = 120;
  const inRange = (len) => len >= MIN && len <= max;
  const lastCut = (test) => {
    for (let i = Math.min(max, chars.length - 1); i >= 0; i -= 1) {
      const len = test(i);
      if (len !== null && inRange(len)) return len;
    }
    return null;
  };
  const cut = lastCut((i) => (chars[i] === '\n' && chars[i + 1] === '\n' ? i : null))
    ?? lastCut((i) => (chars[i] === '\n' ? i : null))
    ?? lastCut((i) => (/[.!؟?]/.test(chars[i]) && chars[i + 1] === ' ' ? i + 1 : null))
    ?? lastCut((i) => (chars[i] === ' ' ? i : null))
    ?? max;
  return [chars.slice(0, cut).join('').trim(), chars.slice(cut).join('').trim()];
}

// ---------------------------------------------------------------------------------------------------
// §5.12 (g) next_step

function repairNextStep(result, aiResult, { stage, now } = {}) {
  const messages = (result && Array.isArray(result.messages)) ? result.messages : [];
  const lastPart = messages[messages.length - 1];
  let nextStep;
  if (['OPT_OUT', 'NOT_NOW'].includes(result && result.action)) nextStep = 'terminal';
  else if (hasButtons(lastPart)) nextStep = 'buttons';
  else if (lastPart && countQuestions(lastPart.text) > 0) nextStep = 'question';
  else nextStep = 'confirmed';
  const events = [];
  const proposed = aiResult && aiResult.next_step;
  if (proposed && proposed !== nextStep) events.push({ code: 'next_step', detail: `${proposed}->${nextStep}` });
  const at = (now instanceof Date ? now : new Date(now === undefined ? Date.now() : now)).toISOString();
  const lastBot = { stage: stage ?? null, next_step: nextStep, at, action: (result && result.action) || 'NONE' };
  return {
    result: { ...result, workflowDataPatch: { ...((result && result.workflowDataPatch) || {}), last_bot: lastBot } },
    next_step: nextStep,
    events,
  };
}

// ---------------------------------------------------------------------------------------------------
// §5.13 fallback lines, §5.14 hints

function stageFallback(stage, lang, { disclosed = true, sector } = {}) {
  const en = lang === 'en';
  switch (stage) {
    case 'opening':
      if (!disclosed) {
        return en
          ? `Hi, I'm Karam, SHIFT's AI assistant (${SITE_HOST}). So I can help properly: what kind of business do you run?`
          : `أهلًا وسهلًا، أنا كرم، مساعد شِفت الذكي (${SITE_HOST}). عشان أفيدك صح: شو نوع شغلك؟`;
      }
      break;
    case 'fit':
    case 'sample':
    case 'objection':
      return en
        ? "I'd rather not give you an inaccurate answer. Would you like to see an example on your business, or talk to the team?"
        : 'ما بدي أعطيك جواب مش دقيق. بتحب أوريك مثال على شغلك، ولا نحكي مع الفريق؟';
    case 'close':
      return en
        ? 'If you like, we can continue here, or I can request a short call with the team — which is easier for you?'
        : 'إذا بتحب، منكمّل هون، أو بطلبلك مكالمة قصيرة مع الفريق — أيهم أريح إلك؟';
    case 'roleplay_setup':
      return roleplay.setupAsk(sector, lang);
    case 'roleplay':
      return en
        ? "The staff will confirm that one. Anything else you'd like to ask?"
        : 'هاي المعلومة بيأكدها الموظف. في إشي ثاني بتحب تسأل عنه؟';
    case 'captured':
    case 'handoff':
      return en
        ? "Your request is on the team's list, and I'm here for any question about Karam or SHIFT."
        : 'طلبك بقائمة الفريق، وأنا هون لأي سؤال عن كرم أو شِفت.';
    case 'closed':
      return en ? "Sure — if you need anything about SHIFT, I'm here." : 'تمام، إذا احتجت أي معلومة عن شِفت أنا هون.';
    default:
      break;
  }
  // opening (disclosed), discovery, and any stage this table does not know
  return en ? 'So I can help properly: who answers your WhatsApp messages today?' : 'عشان أفيدك صح: مين بيرد على رسائل واتساب عندكم حاليًا؟';
}

function hintFor(code, lang) {
  switch (code) {
    case 'digits':
      // Review r2 #6: the marker is how a customer's own number is named, never a way to confirm it.
      return 'ردك السابق فيه رقم مش من العميل أو بيأكد رقم العميل كسعر. لا تذكر أي رقم أو سعر أو مدة. رقم كتبه العميل بتذكره بس كرقمه هو (ميزانيتك، الحاسبة، حسب أسعارك)، بدون «أي/نعم» قبله، وبدون ما تقول إنه سعر شِفت أو إنه كافي أو بيغطي الاشتراك.';
    case 'guarantee':
    case 'overclaim':
      return 'ردك السابق فيه ضمانة أو ادعاء. الفائدة هدف مش نتيجة، ونفس المحرّك بس بمعلومات شِفت.';
    case 'claimed_action':
      return 'لا تقل سجّلت أو حجزت أو بعثت. النظام بيضيف التأكيد. قل «بحطها بالحسبان» أو «بلاحظ».';
    case 'training_claim':
      return 'ما حدا بشِفت درّب النموذج. قل: «بشتغل على نموذج ذكاء اصطناعي، ومعلوماتي من شِفت».';
    case 'identity':
      return 'العميل سأل إذا إنت بوت: جاوب بصدق إنك كرم، مساعد شِفت الذكي (ذكاء اصطناعي)، واعرض التحويل لشخص.';
    case 'language':
      return `ردّ بلغة آخر رسالة من العميل: ${lang === 'en' ? 'English' : 'العربية بالحروف العربية'}.`;
    case 'questions':
      return 'سؤال واحد بس بآخر الرد.';
    case 'link':
      return `لا تكتب أي رابط غير ${SITE_HOST} وصفحاته المسموحة.`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------------
// §5.1 entry point

function regen(list) {
  return list.map((b) => ({ ...b, regen: true }));
}

/** Content checks a, k, d, e, b, b′, b″, c, j′/j on one model line. */
const DANGLING_END_RE = /(?:^|[\s(«"])(?:على|عال|عبر|من|هون|هنا|أو|او|و|ع|بـ|ب|في|فيه|تحت|الرابط|رابط|الموقع|موقعنا|الصفحة|صفحتنا|شوف|افتح|زور|on|at|or|and|here|via|to|visit|check|see|open|link|site|website|page)\s*[:：.,،]?\s*$/i;

function checkModelLine(input, vctx, attempt) {
  const events = [];
  let line = stripMarkdown(input).trim();

  const links = filterLinks(line);
  line = links.text.replace(/[ \t]{2,}/g, ' ').trim();
  events.push(...links.events);
  // «من هون: <link>» with the link gone must not end on a colon: the dangling-colon repair would put slot
  // buttons under a sentence that never asked about a call.
  if (links.events.some((e) => String(e.detail).startsWith('removed:'))) line = line.replace(/\s*[:：]\s*$/, '.');
  if (!line) events.push({ code: 'link', detail: 'empty_after_removal', regen: true });
  // «شوف أو» / «تفاصيل أكثر على» with the link gone points at nothing (review minor): regenerate.
  else if (links.events.some((e) => String(e.detail).startsWith('removed:')) && DANGLING_END_RE.test(line)) {
    events.push({ code: 'link', detail: 'dangling_after_removal', regen: true });
  }

  const human = checkHumanClaim(line);
  if (human.length) {
    events.push(...human);
    line = HONEST_IDENTITY[vctx.lang === 'en' ? 'en' : 'ar'];
  }

  // SHIFT did not train the model: the claim is replaced by the approved wording, whatever else was said.
  const training = checkTrainingClaim(line);
  if (training.length) {
    events.push(...training);
    line = withApprovedTraining(line, vctx.lang);
  }

  const identity = checkIdentity(line, vctx);
  if (identity.length) {
    if (attempt >= 2) {
      events.push(...identity);
      line = HONEST_IDENTITY[vctx.lang === 'en' ? 'en' : 'ar'];
    } else {
      events.push(...regen(identity));
    }
  }

  events.push(...regen(checkDigits(line, vctx)));
  events.push(...regen(checkGuarantee(line, vctx)));
  events.push(...regen(checkOverclaim(line, vctx)));
  events.push(...regen(checkClaimedAction(line, vctx)));
  events.push(...regen(checkLanguage(line, vctx.lang)));
  return { line, events };
}

function replaceSegment(text, oldSegment, newSegment) {
  const s = String(text || '');
  const idx = oldSegment ? s.indexOf(oldSegment) : -1;
  if (idx < 0) return null;
  return (s.slice(0, idx) + newSegment + s.slice(idx + oldSegment.length))
    .replace(/^\s+/, '')
    .replace(/\s+$/, '')
    .replace(/\n{3,}/g, '\n\n');
}

function withModelLine(part, newLine) {
  if (newLine === part.modelLine) return part;
  const replaced = replaceSegment(part.text, part.modelLine, newLine);
  const text = replaced !== null ? replaced : [newLine, part.ack].filter(Boolean).join('\n\n');
  return { ...part, text, modelLine: newLine };
}

const TEXT_BEARING = ['text', 'interactive', 'list', 'cta_url'];

/**
 * «بتحب أوريك مثال؟ ولا بتفضّل نحكي مع الفريق؟» is one either/or question split over two marks: the mark before
 * «ولا/أو/or» becomes a comma, so the trim never keeps a tail that starts with «ولا» (review r2 #7).
 */
function joinAlternatives(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/[؟?]([ \t]+)(?=(?:ولا|أو|او|وإلا|والا|ولّا)\s)/g, '،$1')
    .replace(/\?([ \t]+)(or)(?=\s)/gi, (m, sp, word) => `,${sp}${word.toLowerCase()}`);
}

function questionStep(original, vctx, attempt, events) {
  if (!TEXT_BEARING.includes(original.type)) return original;
  let part = original;
  if (countQuestions(part.text) >= 2) {
    const joined = joinAlternatives(part.text);
    if (joined !== part.text) {
      part = { ...part, text: joined };
      if (typeof part.modelLine === 'string') part.modelLine = joinAlternatives(part.modelLine);
      if (typeof part.ack === 'string') part.ack = joinAlternatives(part.ack);
    }
  }
  const n = countQuestions(part.text);
  if (n < 2) return part;
  if (n === 2 && (vctx.compoundAskAllowed || vctx.stage === 'roleplay_setup')) return part;
  if (n >= 3 && attempt < 2) {
    events.push({ code: 'questions', detail: String(n), regen: true });
    return part;
  }
  events.push({ code: 'questions', detail: `trim:${n}` });
  // When the server segment carries a question (a capture ask), the model's questions are the ones to go:
  // the ack's question is last and is the one the flow needs answered.
  if (part.modelLine && part.ack && countQuestions(part.ack) > 0 && part.text.includes(part.modelLine)) {
    const statements = splitSentences(part.modelLine).filter((x) => !isQuestionSentence(x)).join('').trim();
    const replaced = withModelLine(part, statements);
    if (countQuestions(replaced.text) <= 1) return replaced;
  }
  const text = trimQuestions(part.text);
  const out = { ...part, text };
  if (part.modelLine && !text.includes(part.modelLine)) {
    const trimmedLine = trimQuestions(part.modelLine);
    if (text.includes(trimmedLine)) out.modelLine = trimmedLine;
  }
  return out;
}

function splitStep(messages, vctx, events) {
  const out = [];
  messages.forEach((part, i) => {
    const room = 3 - (messages.length - i - 1) - out.length;
    const splittable = (part.type === 'text' || part.type === 'interactive') && !part.serverButtons && room >= 2;
    const pieces = splittable ? splitText(part.text, 650, { roleplayActive: vctx.roleplayActive }) : [part.text];
    if (pieces.length < 2) {
      out.push(part);
      return;
    }
    events.push({ code: 'split', detail: `${cp(pieces[0])}+${cp(pieces[1])}` });
    const head = { type: 'text', text: pieces[0] };
    if (part.modelLine !== undefined) head.modelLine = part.modelLine;
    if (part.delayMs !== undefined) head.delayMs = part.delayMs;
    const tail = { ...part, text: pieces[1] };
    delete tail.modelLine;
    delete tail.delayMs;
    out.push(head, tail);
  });
  return out;
}

const INTERACTIVE_BODY_MAX = 1024;
const TEXT_BODY_MAX = 4096;
const BODY_LIMITED = ['interactive', 'list', 'cta_url'];

/** Cut so the tail (the part that keeps the buttons) is ≤ max, at the latest natural break that allows it. */
function tailCut(text, max) {
  const chars = Array.from(text);
  const minCut = chars.length - max;
  const firstAt = (test) => {
    for (let i = Math.max(minCut, 1); i < chars.length; i += 1) if (test(i)) return i;
    return null;
  };
  return firstAt((i) => chars[i - 1] === '\n' && chars[i - 2] === '\n')
    ?? firstAt((i) => chars[i - 1] === '\n')
    ?? firstAt((i) => /[.!؟?]/.test(chars[i - 1]) && chars[i] === ' ')
    ?? firstAt((i) => chars[i] === ' ')
    ?? Math.max(minCut, 1);
}

/**
 * Graph refuses an interactive body over 1024 characters, and a refused reply reaches nobody. Slot injection
 * can turn a long text part into buttons, and the 650 split makes one cut only, so the buttons' body is
 * re-checked here: what does not fit moves into the text before it.
 */
function bodyLimitStep(messages, events) {
  const out = [];
  messages.forEach((part, index) => {
    if (!part || !BODY_LIMITED.includes(part.type) || cp(part.text) <= INTERACTIVE_BODY_MAX) {
      out.push(part);
      return;
    }
    const chars = Array.from(String(part.text));
    const cut = tailCut(String(part.text), INTERACTIVE_BODY_MAX);
    const head = chars.slice(0, cut).join('').trim();
    const tail = chars.slice(cut).join('').trim();
    events.push({ code: 'split', detail: `body:${cp(head)}+${cp(tail)}` });
    const prev = out[out.length - 1];
    const tailPart = { ...part, text: tail };
    delete tailPart.modelLine;
    if (prev && prev.type === 'text' && cp(prev.text) + cp(head) + 2 <= TEXT_BODY_MAX) {
      out[out.length - 1] = { ...prev, text: `${prev.text}\n\n${head}` };
      out.push(tailPart);
    } else if (out.length + 2 + (messages.length - index - 1) <= 3) {
      const headPart = { type: 'text', text: head };
      if (part.modelLine !== undefined) headPart.modelLine = part.modelLine;
      if (part.delayMs !== undefined) headPart.delayMs = part.delayMs;
      out.push(headPart, tailPart);
    } else {
      // No room for another message: the words matter more than the buttons.
      const textPart = { type: 'text', text: cutText(part.text, TEXT_BODY_MAX) };
      if (part.modelLine !== undefined) textPart.modelLine = part.modelLine;
      out.push(textPart);
    }
  });
  return out;
}

function cutText(text, max) {
  const chars = Array.from(String(text));
  return chars.length > max ? chars.slice(0, max).join('') : String(text);
}

function logBlocks(vctx, blocks, attempt) {
  if (!blocks.length) return;
  const codes = Array.from(new Set(blocks.map((b) => b.code)));
  console.warn('[validators] ' + JSON.stringify({ conv: vctx.conversationId || null, codes, attempt }));
}

/**
 * → { result, verdict, blocks, hint }. `verdict` is `regenerate` when a regenerate-class check fired on
 * attempt 1, `fallback` when one fired on attempt 2, else `ok` with the repaired result.
 */
function validateResult(result, vctx = {}) {
  const attempt = vctx.attempt === 2 ? 2 : 1;
  if (!result || typeof result !== 'object' || !Array.isArray(result.messages)) {
    return { result, verdict: 'ok', blocks: [], hint: null };
  }
  const ctx = {
    ...vctx,
    lang: vctx.lang === 'en' ? 'en' : 'ar',
    batchTexts: (vctx.batchTexts || []).filter((t) => typeof t === 'string'),
  };
  if (ctx.explicitTimeRequest === undefined) ctx.explicitTimeRequest = ctx.batchTexts.some((t) => EXPLICIT_TIME_RE.test(t));

  const events = [];
  let exclamations = 0;

  // Content: only the model's own words.
  let messages = result.messages.map((original) => {
    let part = { ...original };
    if (typeof part.modelLine === 'string' && part.modelLine.trim()) {
      const checked = checkModelLine(part.modelLine, ctx, attempt);
      events.push(...checked.events);
      part = withModelLine(part, checked.line);
      exclamations += countMatches(checked.line, /[!！]/g);
    }
    return part;
  });

  let workflowDataPatch = { ...(result.workflowDataPatch || {}) };
  let out = { ...result, messages, workflowDataPatch };

  if ((result.kind || 'reply') === 'reply') {
    // f: one question
    messages = messages.map((p) => questionStep(p, ctx, attempt, events));

    // h: buttons, slot injection, dangling colon
    messages = messages.map((p) => {
      const r = sanitizeButtons(p, ctx);
      events.push(...r.events);
      return r.part;
    });
    const forbidden = buttonsForbidden(ctx);
    const offersAvailable = offerButtons(ctx).length > 0;
    const lastIndex = messages.length - 1;
    const last = messages[lastIndex];
    if (last && ctx.explicitTimeRequest && SLOT_STAGES.includes(ctx.stage) && !forbidden && offersAvailable
      && ['text', 'interactive'].includes(last.type) && !last.serverButtons) {
      events.push({ code: 'buttons', detail: 'slot_injection' });
      messages[lastIndex] = injectOffers(last, ctx, { appendBody: true });
    }
    messages = messages.map((p, i) => {
      const canInject = i === lastIndex && !forbidden && offersAvailable && !p.serverButtons;
      const r = fixDanglingColon(p, ctx, { canInject });
      events.push(...r.events);
      return r.part;
    });

    // i: length
    messages = splitStep(messages, ctx, events);
    messages = bodyLimitStep(messages, events)
      // A text fallback of injected buttons carries the words the buttons part ends up with, after any split.
      .map((p) => (p && p.fallback && p.fallback.type === 'text' && !p.serverButtons ? { ...p, fallback: { type: 'text', text: p.text } } : p));

    out = { ...out, messages };
    // g: next_step → last_bot
    const repaired = repairNextStep(out, { next_step: ctx.modelNextStep }, { stage: ctx.stage, now: ctx.now });
    events.push(...repaired.events);
    out = repaired.result;
    workflowDataPatch = out.workflowDataPatch;
  }

  // l: exclamations are a style metric, never a block.
  if (exclamations > 0) {
    console.log('[validators] exclamations', { conv: ctx.conversationId || null, n: exclamations });
    out = { ...out, workflowDataPatch: { ...workflowDataPatch, exclamations: (Number(ctx.exclamations) || 0) + exclamations } };
  }

  const regenCodes = Array.from(new Set(events.filter((e) => e.regen).map((e) => e.code)));
  const verdict = regenCodes.length ? (attempt === 1 ? 'regenerate' : 'fallback') : 'ok';
  const blocks = events.map(({ code, detail }) => ({ code, detail }));
  const hint = verdict === 'ok'
    ? null
    : Array.from(new Set(regenCodes.map((c) => hintFor(c, ctx.lang)).filter(Boolean))).join('\n') || null;
  logBlocks(ctx, blocks, attempt);
  return { result: out, verdict, blocks, hint };
}

module.exports = {
  validateResult,
  stageFallback,
  HONEST_IDENTITY,
  languageOf,
  isArabizi,
  expectedLanguage,
  stripMarkdown,
  findNumbers,
  claimContextNumbers,
  allowedNumberSet,
  checkDigits,
  checkGuarantee,
  checkOverclaim,
  checkTrainingClaim,
  checkClaimedAction,
  checkHumanClaim,
  isIdentityQuestion,
  checkIdentity,
  countQuestions,
  trimQuestions,
  repairNextStep,
  sanitizeButtons,
  splitText,
  filterLinks,
  CODES,
  EXPLICIT_TIME_RE,
  COMPOUND_ASK_RE,
  hintFor,
};
