/**
 * The role-play sandbox: the bot plays "Karam" for the prospect's own business on facts the prospect
 * typed, so they see the product on their menu instead of reading about it.
 *
 * Pure: no DB, no SDK, no sender. Nothing here (or anything it requires) may reach order or appointment
 * creation — a mock «بدي 2 شاورما» must never become a real order (G6). BLOCKED_IMPORTS lists the names
 * the sandbox test asserts are absent from require.cache.
 *
 * Arabic copy is owner-approval pending (contract §13); it follows the prompt doc verbatim.
 */

const { normalizeSector } = require('./actions');

const ROLEPLAY_MAX_TURNS = 6;
const ROLEPLAY_IDLE_MS = 15 * 60 * 1000;
// The sweeper ends an idle example silently. The next batch within this long may still be written in
// character («بدي احجز بكرا الساعة 5»), so it stays out of the real lead and the call capture until the
// end line has been sent (review r2 #0/#10).
const UNANNOUNCED_END_MS = 24 * 60 * 60 * 1000;
const MAX_SETUP_ASKS = 2;
const BLOCKED_IMPORTS = ['createConfirmedOrder', 'createConfirmedAppointment'];

// Whole message only: «خلص، بدي 2 شاورما» is a customer line inside the example, not an exit. «stop»
// alone is PR1's opt-out and never reaches this check.
const EXIT_RE = /^\s*(خلص|خلصنا|خلص المثال|بكفي|كفاية|رجّعني|رجعني|رجّعني لشِفت|رجعني لشفت|done|stop the example|end|exit|back)\s*[.!؟?]*\s*$/i;
const DIACRITICS_RE = /[ً-ْٰـ]/g;

const LIMITS = { factNumbers: 12, quantities: 8, closure: 5000, maxValue: 99999 };

/** §1.1: role-play needs prompt v2's role-play block, so the PR1 prompt path turns it off too. */
function roleplayEnabled(env = process.env) {
  return !!env && env.SHIFT_ROLEPLAY !== '0' && env.SHIFT_PROMPT_V1 !== '1';
}

function isEn(lang) {
  return lang === 'en';
}

const SETUP_ASKS = {
  restaurant: {
    ar: 'عشان أصير كرم تبعك: اسم المطعم وصنفين من المنيو بأسعارهم (مثلًا: شاورما 3 دنانير)؟',
    en: "To be your Karam: the restaurant's name and two menu items with prices (e.g. shawarma 3 JD)?",
  },
  clinic: {
    ar: 'عشان أصير كرم تبعك: اسم العيادة وخدمتين (والسعر بس إذا بدك تنشره) وأوقات الدوام؟',
    en: "To be your Karam: the clinic's name, two services (price only if you publish it) and opening hours?",
  },
  store: {
    ar: 'عشان أصير كرم تبعك: اسم المتجر ومنتجين بأسعارهم ومناطق التوصيل؟',
    en: "To be your Karam: the store's name, two products with prices and delivery areas?",
  },
  other: {
    ar: 'عشان أصير كرم تبعك: اسم المنشأة وخدمتين وأوقات الدوام؟',
    en: 'To be your Karam: the business name, two services and opening hours?',
  },
};

function setupAsk(sector, lang) {
  const entry = SETUP_ASKS[sector] || SETUP_ASKS.other;
  return isEn(lang) ? entry.en : entry.ar;
}

function startLine(businessName, lang) {
  const business = typeof businessName === 'string' ? businessName.trim() : '';
  return isEn(lang)
    ? `Illustrative example 🎭 From here I'm ${business}'s Karam. Write as a customer — nothing is really booked or ordered here, and I only use what you gave me. Type "done" when finished.`
    : `مثال توضيحي 🎭 من هلأ أنا كرم تبع ${business}. اكتب كإنك زبون — ما في حجز ولا طلب حقيقي هون، وبستخدم بس اللي كتبته إنت. لما تخلص اكتب "خلص".`;
}

function endLine(sector, lang) {
  // A clinic prospect just watched a "booking" with no calendar behind it: say so before they assume
  // the real product guesses free slots too.
  if (isEn(lang)) {
    const clinic = sector === 'clinic'
      ? " There's no calendar connected here, so I only took the request — in the real setup it shows the free slots from your calendar."
      : '';
    return `(That was an illustrative example on your own details.) That's how your customer sees you — nothing real was sent.${clinic} Would you like written information, or a short call with the team on the same scenario?`;
  }
  const clinic = sector === 'clinic'
    ? ' هون ما في تقويم مربوط، فأخذت الطلب بس — بالتطبيق الفعلي بيعرض الأوقات الفاضية من تقويمك.'
    : '';
  return `(كان مثال توضيحي على معلوماتك.) هيك بيشوفك زبونك — وما انبعت أي طلب فعلي.${clinic} بتحب معلومات مكتوبة ولا نحكي مع الفريق على نفس السيناريو؟`;
}

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

function toIso(now) {
  const ms = now === undefined ? Date.now() : toMs(now);
  return new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString();
}

function currentRoleplay(conversation) {
  const wd = conversation && conversation.workflow_data;
  return wd && wd.roleplay && typeof wd.roleplay === 'object' ? wd.roleplay : null;
}

function cleanFacts(facts) {
  return (Array.isArray(facts) ? facts : [])
    .map((f) => (typeof f === 'string' ? f.trim() : ''))
    .filter(Boolean);
}

/**
 * Whether START_ROLEPLAY may begin now. The setup is asked at most MAX_SETUP_ASKS times; after that a
 * name alone is enough — a prospect who will not type a menu still gets to see the example.
 */
function canStart(conversation, args) {
  if (!roleplayEnabled()) return { ok: false, reason: 'disabled' };
  if (!conversation || conversation.current_state !== 'roleplay_setup') return { ok: false, reason: 'wrong_stage' };
  const a = args && typeof args === 'object' ? args : {};
  const name = typeof a.business_name === 'string' ? a.business_name.trim() : '';
  if (!name) return { ok: false, reason: 'no_name' };
  if (cleanFacts(a.facts).length) return { ok: true };
  const asks = Number((currentRoleplay(conversation) || {}).setup_asks) || 0;
  if (asks < MAX_SETUP_ASKS) return { ok: false, reason: 'no_facts_first_ask' };
  return { ok: true, nameOnly: true };
}

/** The complete roleplay object (§1.3): producers write it whole, spread from what they read. */
function startState(args, now, prev = null) {
  const a = args && typeof args === 'object' ? args : {};
  const at = toIso(now);
  return {
    active: true,
    sector: normalizeSector(a.sector || (prev && prev.sector)),
    business_name: Array.from(typeof a.business_name === 'string' ? a.business_name.trim() : '').slice(0, 80).join(''),
    facts: cleanFacts(a.facts).slice(0, 8),
    started_at: at,
    last_turn_at: at,
    turns: 0,
    setup_asks: Number(prev && prev.setup_asks) || 0,
    ended_at: null,
    end_reason: null,
  };
}

function isActive(workflowData) {
  return !!(workflowData && workflowData.roleplay && workflowData.roleplay.active === true);
}

/**
 * An example the sweeper ended for idleness that the customer was never told about: the first batch after
 * it is still treated as sandbox, and the reply to it carries the end line.
 */
function endUnannounced(roleplay, now) {
  if (!roleplay || typeof roleplay !== 'object' || roleplay.active === true) return false;
  if (roleplay.end_reason !== 'idle' || !roleplay.started_at || roleplay.end_announced_at) return false;
  const ended = toMs(roleplay.ended_at);
  if (!Number.isFinite(ended)) return false;
  return toMs(now === undefined ? Date.now() : now) - ended < UNANNOUNCED_END_MS;
}

/** The end line without its closing question, for a reply that asks its own. */
function endNote(sector, lang) {
  return String(endLine(sector, lang))
    .split(/(?<=[.!؟?\n])/)
    .filter((sentence) => !/[؟?]/.test(sentence))
    .join('')
    .trim();
}

function isExit(text) {
  if (typeof text !== 'string') return false;
  // Customers write «رجعني» and «رجّعني» alike; the list has both, but diacritics can land anywhere.
  return EXIT_RE.test(text) || EXIT_RE.test(text.replace(DIACRITICS_RE, ''));
}

function endState(roleplay, reason, now) {
  return { ...(roleplay || {}), active: false, ended_at: toIso(now), end_reason: reason };
}

/** Counts one customer turn; the turn that reaches the cap is still answered, then the example ends. */
function nextTurn(roleplay, now) {
  const turns = (Number(roleplay && roleplay.turns) || 0) + 1;
  const next = { ...(roleplay || {}), turns, last_turn_at: toIso(now) };
  if (turns >= ROLEPLAY_MAX_TURNS) {
    return { roleplay: endState(next, 'turns', now), ended: true, end_reason: 'turns' };
  }
  return { roleplay: next, ended: false };
}

function isIdle(roleplay, now) {
  if (!roleplay || roleplay.active !== true) return false;
  const last = toMs(roleplay.last_turn_at || roleplay.started_at);
  if (!Number.isFinite(last)) return false;
  return toMs(now === undefined ? Date.now() : now) - last >= ROLEPLAY_IDLE_MS;
}

// ---------------------------------------------------------------------------------------------------
// Arithmetic closure (design §13 #6): every total the example may quote is built from the prospect's
// own prices and quantities, so the digit guard can allow «المجموع 10 دنانير حسب أسعارك» without ever
// allowing a number the prospect did not give.

const WORD_VALUES = {
  واحد: 1, وحدة: 1, اثنين: 2, اتنين: 2, ثنتين: 2, ثلاث: 3, ثلاثة: 3, تلات: 3, تلاتة: 3,
  أربع: 4, اربع: 4, أربعة: 4, اربعة: 4, خمس: 5, خمسة: 5, ست: 6, ستة: 6, سبع: 7, سبعة: 7,
  ثمان: 8, ثمانية: 8, تمن: 8, تمنية: 8, تسع: 9, تسعة: 9, عشر: 10, عشرة: 10, نص: 0.5,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const AR_WORDS = Object.keys(WORD_VALUES).filter((w) => /[؀-ۿ]/.test(w)).sort((a, b) => b.length - a.length);
const EN_WORDS = Object.keys(WORD_VALUES).filter((w) => /^[a-z]+$/.test(w));
const TOKEN_RE = new RegExp(
  `\\d+(?:[.,]\\d+)*|(?<![\\u0621-\\u065F\\u066E-\\u06D3])(?:و|ب|بـ|ل|ال|بال|وال)?(${AR_WORDS.join('|')})(?![\\u0621-\\u065F\\u066E-\\u06D3])|\\b(${EN_WORDS.join('|')})\\b`,
  'gi',
);

function toWesternDigits(s) {
  // One character in, one character out, so match offsets stay valid on the original text.
  return String(s)
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

/**
 * A digit token as a number. «1,200» (comma + three digits) is a thousands separator, «3,5» a decimal
 * comma. Tokens with more than 4 integer digits or more than 2 decimals are not prices: null.
 */
function parseNumber(raw) {
  const s = toWesternDigits(raw).trim();
  if (!/^\d+(?:[.,]\d+)*$/.test(s)) return null;
  let intPart;
  let decPart = '';
  if (/^\d{1,3}(,\d{3})+$/.test(s)) {
    intPart = s.replace(/,/g, '');
  } else {
    const m = /^(\d+)(?:[.,](\d+))?$/.exec(s);
    if (!m) return null;
    [, intPart, decPart = ''] = m;
  }
  intPart = intPart.replace(/^0+(?=\d)/, '');
  if (intPart.length > 4 || decPart.length > 2) return null;
  return Number(decPart ? `${intPart}.${decPart}` : intPart);
}

/** Canonical string: rounded to 2 decimals, no trailing zeros («10», «10.5», never «10.00»). */
function canonical(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return String(Math.round(value * 100) / 100);
}

function toNumber(token) {
  if (typeof token === 'number') return Number.isFinite(token) ? token : null;
  if (typeof token !== 'string') return null;
  const word = token.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(WORD_VALUES, word)) return WORD_VALUES[word];
  return parseNumber(token);
}

function numberTokens(text) {
  if (typeof text !== 'string' || !text) return [];
  const s = toWesternDigits(text);
  const out = [];
  for (const m of s.matchAll(TOKEN_RE)) {
    const value = m[1] || m[2] ? toNumber(m[1] || m[2]) : parseNumber(m[0]);
    if (value !== null) out.push(value);
  }
  return out;
}

function uniqueNumbers(texts, max) {
  const seen = new Set();
  const out = [];
  for (const t of Array.isArray(texts) ? texts : [texts]) {
    for (const n of numberTokens(t)) {
      const key = canonical(n);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
      if (out.length === max) return out;
    }
  }
  return out;
}

const UNIT_AFTER_RE = /^\s*(?:دينار|دنانير|د\.أ|قرش|قروش|ليرة|ليرات|شيكل|دولار|\$|%|٪|JOD|JD|dinars?|USD)(?![\u0621-\u065F\u066E-\u06D3A-Za-z])/i;
const GLUED_BEFORE_RE = /(?:بـ|(?<=^|\s)ب|(?<=^|\s)b)\s*$/i;

/**
 * Facts the model wrote for START_ROLEPLAY keep only the numbers the customer typed (review r2 #2): the start
 * line promises «بستخدم بس اللي كتبته إنت», and a price in the facts is an allowed number inside the example.
 * A number not in the customer's own texts is removed with its currency word («منسف 8 دنانير» → «منسف»).
 */
function groundFacts(facts, customerTexts) {
  const texts = (Array.isArray(customerTexts) ? customerTexts : [customerTexts]).filter((t) => typeof t === 'string');
  const allowed = new Set(uniqueNumbers(texts, Infinity).map(canonical));
  const out = [];
  for (const fact of cleanFacts(facts)) {
    const s = toWesternDigits(fact);
    let kept = '';
    let last = 0;
    for (const m of s.matchAll(TOKEN_RE)) {
      const value = m[1] || m[2] ? toNumber(m[1] || m[2]) : parseNumber(m[0]);
      if (value === null || allowed.has(canonical(value))) continue;
      let end = m.index + m[0].length;
      const unit = UNIT_AFTER_RE.exec(fact.slice(end));
      if (unit) end += unit[0].length;
      kept += fact.slice(last, m.index).replace(GLUED_BEFORE_RE, '');
      last = end;
    }
    kept += fact.slice(last);
    const clean = kept.replace(/\s{2,}/g, ' ').replace(/^[\s،,:\-–—]+|[\s،,:\-–—]+$/g, '').trim();
    if (clean) out.push(clean);
  }
  return out;
}

function factNumbers(facts) {
  return uniqueNumbers(cleanFacts(facts), LIMITS.factNumbers);
}

function quantities(inboundTexts) {
  return uniqueNumbers(Array.isArray(inboundTexts) ? inboundTexts.filter((t) => typeof t === 'string') : [], LIMITS.quantities);
}

function arithmeticClosure(facts, inboundTexts) {
  const out = new Set();
  let capped = false;
  const add = (v) => {
    if (out.size >= LIMITS.closure) {
      capped = true;
      return false;
    }
    if (v > LIMITS.maxValue) return true;
    out.add(canonical(v));
    return true;
  };

  const F = factNumbers(facts);
  const Q = quantities(inboundTexts);
  const termKeys = new Set();
  const T = [];
  for (const v of F.concat(F.flatMap((f) => Q.map((q) => f * q)))) {
    const key = canonical(v);
    if (termKeys.has(key)) continue;
    termKeys.add(key);
    T.push(Math.round(v * 100) / 100);
  }

  const run = () => {
    for (const v of F) if (!add(v)) return;
    for (const v of Q) if (!add(v)) return;
    for (const v of T) if (!add(v)) return;
    for (let i = 0; i < T.length; i += 1) {
      for (let j = i + 1; j < T.length; j += 1) if (!add(T[i] + T[j])) return;
    }
    for (let i = 0; i < T.length; i += 1) {
      for (let j = i + 1; j < T.length; j += 1) {
        for (let k = j + 1; k < T.length; k += 1) if (!add(T[i] + T[j] + T[k])) return;
      }
    }
  };
  run();
  if (capped) console.warn('[roleplay] arithmetic closure capped', { size: out.size, facts: F.length, quantities: Q.length });
  return out;
}

const SECTOR_LABELS = { clinic: 'عيادة', restaurant: 'مطعم', store: 'متجر', other: 'منشأة' };

// JSON.stringify leaves < and > alone; escaping them keeps a fact like «<<<نهاية>>>» from closing the
// data fence early and turning the prospect's text into instructions.
function fencedJson(value) {
  // U+2028/U+2029 are left raw by JSON.stringify and read as line breaks: a fake header after one would
  // start a line (review minor).
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Prompt doc §2 role-play block. Arabic in both languages: it instructs the model, which mirrors the
 * customer's language on its own.
 */
function roleplayBlock(roleplay, lang) { // eslint-disable-line no-unused-vars
  if (!roleplay || roleplay.active !== true) return '';
  const label = SECTOR_LABELS[roleplay.sector] || SECTOR_LABELS.other;
  const turn = Math.min((Number(roleplay.turns) || 0) + 1, ROLEPLAY_MAX_TURNS);
  return [
    '# وضع المثال التوضيحي — نشط',
    `أنت الآن «كرم» تبع ${fencedJson(String(roleplay.business_name || ''))} (${label}). المعلومات المسموح استخدامها فقط (من العميل):`,
    '<<<بيانات>>>',
    fencedJson(cleanFacts(roleplay.facts)),
    '<<<نهاية>>>',
    `العميل يكتب كزبون. طلب أو حجز: لخّصه واطلب التأكيد ثم قل إنه سيصل للفريق/الاستقبال — لا تنفّذ ولا تؤكد وقتًا غير معطى. مجموع الطلب من أسعاره فقط، مع «حسب أسعارك». سعر أو معلومة غير معطاة: «بيأكدها الموظف». سؤال طبي: «هاد بيحدده الدكتور». الدور ${turn}/${ROLEPLAY_MAX_TURNS}. عند «خلص» أو انتهاء الأدوار: action END_ROLEPLAY، وارجع كرم شِفت. لا أزرار داخل المثال.`,
  ].join('\n');
}

module.exports = {
  roleplayEnabled,
  ROLEPLAY_MAX_TURNS,
  ROLEPLAY_IDLE_MS,
  UNANNOUNCED_END_MS,
  MAX_SETUP_ASKS,
  EXIT_RE,
  setupAsk,
  startLine,
  endLine,
  endNote,
  endUnannounced,
  groundFacts,
  canStart,
  startState,
  isActive,
  isExit,
  nextTurn,
  endState,
  isIdle,
  factNumbers,
  quantities,
  arithmeticClosure,
  roleplayBlock,
  BLOCKED_IMPORTS,
  // shared with validators.js so both compare numbers in one canonical form
  toNumber,
  canonical,
  toWesternDigits,
};
