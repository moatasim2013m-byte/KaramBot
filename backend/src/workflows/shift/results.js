/**
 * Turns the model's validated JSON (or null on AI failure) into a WorkflowResult.
 *
 * The model writes the conversational line; the server decides state and appends every factual ack
 * («سجّلت طلبك…») itself, so the customer is never told something happened that did not. Nothing
 * here writes to the DB — the batcher persists the state first and only then sends.
 *
 * PR2 (contract §9.2): samples, the role-play sandbox, pre-fill merge, the sector list and counters.
 * Every part built from the model's reply carries `modelLine` (the model's own words) and `ack` (the
 * server segment) so the validators check the model's words and never a true server ack.
 */

const acks = require('./acks');
const hours = require('./hours');
const handoff = require('./handoff');
const buttons = require('./buttons');
const assets = require('./assets');
const roleplay = require('./roleplay');
const validators = require('./validators');
const context = require('./context');
const booking = require('./booking');
const prefillParser = require('./prefill');
const { mergeLead, extractCustomerNumbers, normalize } = require('./lead');
const { actionSetFor, normalizeActionArgs, FLAG_REASONS } = require('./actions');
const { SITE_HOST } = require('../../config/site');

// unsent_reply (D18): the bot's reply to the customer could not be confirmed twice, so the customer may
// have nothing at all — more urgent than any request the customer made.
const NEEDS_TEAM_PRIORITY = { unsent_reply: 6, person: 5, complaint: 5, meeting: 4, quote: 3, demo: 2, unknown: 1, ai_failure: 0 };
// `unsupported` (view-once media, polls…) is answered like media: the bot cannot read it either.
const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker', 'unsupported'];
const TEXT_LIMIT = 4096;
const INTERACTIVE_LIMIT = 1024;
const LOCKED_STAGES = ['handoff', 'captured'];
const ROLEPLAY_STAGES = ['roleplay_setup', 'roleplay'];
// The reply already tells the customer the bot reads text only. Naming the attachment («شفت الصورة»)
// is not that: it may be the model pretending it saw it.
const TEXT_ONLY_RE = /بقرأ النص بس|بقرا النص بس|read text only|only read text/i;
// Actions whose visible text the server supplies, so an empty model line is not a silent reply.
const SERVER_TEXT_ACTIONS = ['OPT_OUT', 'NOT_NOW', 'HANDOFF_TO_HUMAN', 'SEND_SAMPLE', 'START_ROLEPLAY', 'END_ROLEPLAY'];
const CLOSE_DECLINE_RE = /ما بدي مكالمة|مش مناسب(ة)? مكالمة|بلاش مكالمة|no call|don't want a call/i;
const ROLEPLAY_LABEL_RE = /مثال توضيحي|illustrative/i;
const COMMITMENT_ACTIONS = ['SEND_SAMPLE', 'START_ROLEPLAY', 'CAPTURE_TIME', 'FLAG_FOR_TEAM', 'HANDOFF_TO_HUMAN'];
const COMMITMENT_OFFER_RE = /أوريك مثال|اوريك مثال|بتحب (أوريك|اوريك|نجرّب|نجرب)|جرّبني|جربني|مكالمة|عرض مكتوب|see an example|try (it|me)|a (short )?call|written quote/i;
const SECTOR_TEXT_MAX = 60;
const BARE_GREETING_MAX_WORDS = 3;
const PRODUCT_LABELS = Object.entries(prefillParser.PRODUCT_NAME_TO_KEY)
  .filter(([name]) => /[؀-ۿ]/.test(name))
  .reduce((out, [name, key]) => ({ ...out, [key]: out[key] || name }), {});

function priorityOf(reason) {
  return Object.prototype.hasOwnProperty.call(NEEDS_TEAM_PRIORITY, reason) ? NEEDS_TEAM_PRIORITY[reason] : NEEDS_TEAM_PRIORITY.unknown;
}

/**
 * The stored needs_team is replaced only when missing, resolved, claimed, or of strictly lower
 * priority. A claimed entry belongs to a finished takeover: the bot only runs again after «إرجاع
 * للبوت», so a new request must start fresh (its own SLA note, not the earlier staff member's claim).
 */
function mergeNeedsTeam(existing, next) {
  if (!next) return null;
  if (!existing || typeof existing !== 'object' || existing.resolved_at || existing.claimed_at) return next;
  return priorityOf(existing.reason) < priorityOf(next.reason) ? next : null;
}

function needsTeamEntry(reason, summary, at) {
  return {
    reason,
    summary: String(summary || '').slice(0, 200),
    at,
    resolved_at: null,
    sla_note_sent_at: null,
    claimed_at: null,
    claimed_by: null,
  };
}

function sanitizeButtons(list, offers) {
  if (!Array.isArray(list) || !Array.isArray(offers)) return [];
  const out = [];
  for (const b of list) {
    const offer = b && offers.find((o) => o.id === b.id);
    if (!offer || out.some((o) => o.id === offer.id)) continue;
    out.push({ id: offer.id, title: offer.title });
    if (out.length === 3) break;
  }
  return out;
}

/**
 * Handed off or captured with the team's request still open (pending): the bot answers as a concierge
 * and only staff move the stage on. Once staff resolve or release it the conversation is open again
 * and continues like any other, so a prospect who comes back is not stuck at «تحويل» for good.
 */
function isStageLocked(conversation) {
  return !!conversation && LOCKED_STAGES.includes(conversation.current_state) && conversation.status === 'pending';
}

/**
 * Contract §2.5. Server-forced transitions first; a model proposal only moves an unlocked stage, never
 * out of `roleplay` (that is END_ROLEPLAY / exit / turn cap) and never into `roleplay_setup` while
 * role-play is off. START_ROLEPLAY / END_ROLEPLAY / SEND_SAMPLE are passed only once accepted.
 */
function nextStage(current, proposed, action, locked = LOCKED_STAGES.includes(current)) {
  if (action === 'OPT_OUT' || action === 'NOT_NOW') return 'closed';
  if (action === 'HANDOFF_TO_HUMAN') return 'handoff';
  if (action === 'CAPTURE_TIME') return 'captured';
  if (locked) return undefined;
  if (action === 'START_ROLEPLAY') return 'roleplay';
  if (action === 'END_ROLEPLAY') return 'close';
  if (action === 'SEND_SAMPLE') return 'sample';
  if (current === 'roleplay') return undefined;
  const { stages } = actionSetFor();
  if (stages.includes(proposed) && proposed !== 'closed') {
    const setupRefused = proposed === 'roleplay_setup'
      && (!roleplay.roleplayEnabled() || ['closed', 'handoff', 'captured'].includes(current));
    if (!setupRefused) return proposed;
  }
  if (!current) return 'opening';
  return undefined;
}

function cutCodePoints(s, max) {
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('') : s;
}

/** `[modelLine, ack]` joined by a blank line; over the limit the model line is cut, never the ack. */
function compose(modelLine, ack, limit = TEXT_LIMIT) {
  const tail = ack || '';
  let line = modelLine || '';
  if (line && tail) {
    const room = limit - Array.from(tail).length - 2;
    line = room > 0 ? cutCodePoints(line, room).trim() : '';
  } else if (line) {
    line = cutCodePoints(line, limit);
  }
  return [line, cutCodePoints(tail, limit)].filter(Boolean).join('\n\n');
}

/**
 * Part metadata (contract §1.4): only a part that shows the model's words carries it. `reply` is the
 * model's own line; `line` is what is shown (it may carry the media prefix above the reply).
 */
function withMeta(part, line, ack, reply) {
  if (reply && line) {
    part.modelLine = reply;
    if (ack) part.ack = ack;
  }
  return part;
}

function textMessage(modelLine, ack, reply) {
  return withMeta({ type: 'text', text: compose(modelLine, ack, TEXT_LIMIT) }, modelLine, ack, reply);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function preferredTimeText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (isPlainObject(value) && typeof value.text === 'string') return value.text.trim() || null;
  return null;
}

// ─── the customer's own call time ────────────────────────────────────────────
//
// Owner phone test on the PR1 bot (2026-09-15): «صح عليكم طيب يلا» (agreeing to a call, no time) came back
// as CAPTURE_TIME with a slot title («بكرا 10–12») as time_text, and the server acked «سجّلت طلب مكالمة: بيكابو،
// بكرا 10–12» under the model's own «اختار الوقت المناسب إلك… أقرب أوقات الفريق:». The model's time_text and
// lead.preferred_time are proposals: a call time is stored or acked only when the customer tapped a slot
// (buttons.js) or when the customer's own text carries an explicit day/time the server can see here.

const AR_LETTERS = '\\u0621-\\u064A\\u066E-\\u06D3';
const NOT_AR_BEFORE = `(?<![${AR_LETTERS}])(?:[وبعف](?=ال|بكر|غد))?`;
const NOT_AR_AFTER = `(?![${AR_LETTERS}])`;
const DIGIT = '[0-9٠-٩]';
const NO_DIGIT_BEFORE = '(?<![0-9٠-٩])';
const NO_DIGIT_AFTER = '(?![0-9٠-٩])';
// A number right after a day word is a clock time unless a unit follows («بكرا 5 طلبات» is not 5 o'clock).
const UNIT_AFTER_AR = `(?!\\s*(?:أيام|ايام|يوم|شهر|أشهر|اشهر|شهور|سنة|سنين|سنوات|دقيقة|دقايق|دقائق|ساعات|أسابيع|اسابيع|موظف|موظفين|فروع|فرع|طلب|طلبات|رسالة|رسائل|رسايل|زبون|زباين|دينار|دنانير|%|٪)${NOT_AR_AFTER})`;
const HOUR_WORDS_AR = 'واحدة|وحدة|ثنتين|تنتين|اتنين|ثلاث|ثلاثة|تلاتة|تلات|أربع|اربع|أربعة|اربعة|خمس|خمسة|خمسه|ست|ستة|سته|سبع|سبعة|سبعه|ثمان|ثمانية|تمانية|تمنة|تسع|تسعة|تسعه|عشر|عشرة|عشره|حداش|احدعش|إحدعش|اطنعش|طنعش';

const DAY_TERMS = [
  ['after_tomorrow', 'بعد بكرا|بعد بكره|بعد بكرة|بعد غد|بعد الغد', 'day after tomorrow'],
  ['today', 'اليوم', 'today'],
  ['tomorrow', 'بكرا|بكره|بكرة|غدًا|غداً|غدا|الغد', 'tomorrow|tmrw'],
  ['sun', 'الأحد|الاحد', 'sunday'],
  ['mon', 'الإثنين|الاثنين|الإتنين|الاتنين|التنين', 'monday'],
  ['tue', 'الثلاثاء|الثلاثا|التلاتاء|التلاتا', 'tuesday'],
  ['wed', 'الأربعاء|الاربعاء|الأربعا|الاربعا', 'wednesday'],
  ['thu', 'الخميس', 'thursday'],
  ['fri', 'الجمعة|الجمعه', 'friday'],
  ['sat', 'السبت', 'saturday'],
  ['next_week', '(?:الأسبوع|الاسبوع)\\s+(?:الجاي|القادم)', 'next week|this week|(?:this|next) weekend'],
];
const PART_TERMS = [
  ['morning', 'الصبح|الصباح|صباحًا|صباحاً|صباحا|الضحى', 'morning'],
  ['afternoon', 'بعد الظهر|بعد الضهر|العصر', 'afternoon'],
  ['noon', 'الظهر|الضهر', 'noon|midday'],
  ['evening', 'المسا|المساء|مساءً|مساءا|مساء|الليلة|الليله', 'evening|tonight'],
];
const termRe = (ar, en) => new RegExp(`${NOT_AR_BEFORE}(?:${ar})${NOT_AR_AFTER}|\\b(?:${en})\\b`, 'gi');
const DAY_RES = DAY_TERMS.map(([key, ar, en]) => [key, termRe(ar, en)]);
const PART_RES = [
  ...PART_TERMS.map(([key, ar, en]) => [key, termRe(ar, en)]),
  ['am', new RegExp(`(?<=${DIGIT}\\s?)(?:ص${NOT_AR_AFTER}|am\\b|a\\.m\\.)`, 'gi')],
  ['pm', new RegExp(`(?<=${DIGIT}\\s?)(?:م${NOT_AR_AFTER}|pm\\b|p\\.m\\.)`, 'gi')],
];
const DAY_ALT_AR = DAY_TERMS.map(([, ar]) => ar).join('|');
const CLOCK_RES = [
  new RegExp(`${NOT_AR_BEFORE}(?:الساعة|الساعه)\\s*(?:${DIGIT}{1,2}(?:[:.]${DIGIT}{2})?|(?:${HOUR_WORDS_AR})${NOT_AR_AFTER})(?:\\s*(?:و\\s*)?(?:نص|ربع)${NOT_AR_AFTER})?`, 'g'),
  new RegExp(`${NO_DIGIT_BEFORE}${DIGIT}{1,2}:${DIGIT}{2}${NO_DIGIT_AFTER}`, 'g'),
  new RegExp(`${NO_DIGIT_BEFORE}${DIGIT}{1,2}\\s*(?:ص|م|صباحًا|صباحاً|صباحا|مساءً|مساءا|مساء|الصبح|الصباح|المسا|المساء|العصر|الظهر|الضهر)${NOT_AR_AFTER}`, 'g'),
  new RegExp(`${NOT_AR_BEFORE}(?:${DAY_ALT_AR})\\s*(?:الساعة\\s*|الساعه\\s*)?${DIGIT}{1,2}(?:\\s*[-–—]\\s*${DIGIT}{1,2})?${NO_DIGIT_AFTER}${UNIT_AFTER_AR}`, 'g'),
  new RegExp(`${NOT_AR_BEFORE}(?:من|بين)\\s+(?:الساعة\\s*)?${DIGIT}{1,2}\\s*(?:و|ل|لـ|لل|الى|إلى|-|–)\\s*${DIGIT}{1,2}${NO_DIGIT_AFTER}${UNIT_AFTER_AR}`, 'g'),
  new RegExp(`${NOT_AR_BEFORE}(?:بعد|قبل)\\s+(?:الساعة\\s*|الساعه\\s*)?${DIGIT}{1,2}(?:[:.]${DIGIT}{2})?${NO_DIGIT_AFTER}(?=\\s*(?:$|[؟?.!,،\\n]))`, 'g'),
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.|o'?clock)(?![a-z])/gi,
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:am|pm|o'?clock)\b/gi,
  /\b(?:at|after|before|around|by|from|between)\s+\d{1,2}(?::\d{2})?(?:\s*(?:-|–|and|to)\s*\d{1,2}(?::\d{2})?)?(?:\s*(?:am|pm))?\b(?!\s*(?:%|percent|days?|weeks?|months?|years?|hours?|minutes?|mins?|people|staff|employees|branches|orders|messages|customers|clients|jd|jod|dinars?|usd))/gi,
  new RegExp(`${NO_DIGIT_BEFORE}${DIGIT}{1,2}\\s*/\\s*${DIGIT}{1,2}(?![0-9٠-٩/])`, 'g'),
];
const TIME_NEGATION_RE = /(?:^|[\s،,])(?:مش|مو|ما|لا|غير|not|no|except)\s*$/i;
const RELATIVE_DAYS = ['today', 'tomorrow', 'after_tomorrow'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const PART_EQUIV = {
  am: ['am', 'morning'], morning: ['morning', 'am'], noon: ['noon'],
  pm: ['pm', 'afternoon', 'evening'], afternoon: ['afternoon', 'pm'], evening: ['evening', 'pm'],
};
const PHRASE_MAX = 120;

/** The day/time expressions in a text: their spans, the days, parts of day and numbers inside them. */
function timeFacts(text) {
  const s = String(text || '');
  const hits = [];
  const scan = (re, onHit) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      if (!m[0]) { re.lastIndex += 1; continue; }
      // «مش اليوم», "not today": a time the customer rules out is not the one they chose.
      if (TIME_NEGATION_RE.test(s.slice(Math.max(0, m.index - 8), m.index))) continue;
      hits.push([m.index, m.index + m[0].length]);
      if (onHit) onHit();
    }
  };
  const days = new Set();
  const parts = new Set();
  for (const [key, re] of DAY_RES) scan(re, () => days.add(key));
  for (const [key, re] of PART_RES) scan(re, () => parts.add(key));
  for (const re of CLOCK_RES) scan(re);

  hits.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const spans = [];
  for (const h of hits) {
    const last = spans[spans.length - 1];
    if (last && (h[0] <= last[1] || /^[ \t،,و]*$/.test(s.slice(last[1], h[0])))) last[1] = Math.max(last[1], h[1]);
    else spans.push([h[0], h[1]]);
  }
  const pieces = spans.map(([a, b]) => s.slice(a, b).trim());
  const numbers = new Set(pieces.flatMap((p) => extractCustomerNumbers(p)));
  return { spans, days, parts, numbers, phrase: cutCodePoints(pieces.join(' '), PHRASE_MAX).trim() };
}

/** Every day, part of day and number of the proposed time is one the customer wrote. */
function groundedIn(candidate, facts) {
  const t = preferredTimeText(candidate);
  if (!t || !facts.spans.length) return null;
  const m = timeFacts(t);
  if (!m.spans.length) return null;
  for (const n of m.numbers) if (!facts.numbers.has(n)) return null;
  for (const p of m.parts) if (!(PART_EQUIV[p] || [p]).some((q) => facts.parts.has(q))) return null;
  // «بكرا» written as its weekday («الثلاثاء») is the same day.
  const relative = RELATIVE_DAYS.some((d) => facts.days.has(d));
  for (const d of m.days) if (!facts.days.has(d) && !(relative && WEEKDAYS.includes(d))) return null;
  return t;
}

function sharesTime(m, facts) {
  return [...m.numbers].some((n) => facts.numbers.has(n))
    || [...m.days].some((d) => facts.days.has(d))
    || [...m.parts].some((p) => (PART_EQUIV[p] || [p]).some((q) => facts.parts.has(q)));
}

/** What the customer typed or said in this batch. A tap's title is not typed text (taps go through buttons.js). */
function batchCustomerTexts(c) {
  const out = [];
  for (const m of c.batchMessages || []) {
    if (m.message_type === 'interactive' || m.message_type === 'button') continue;
    if (typeof m.text_body === 'string' && m.text_body.trim()) out.push(m.text_body);
    const sm = shiftMediaOf(m, c);
    if (sm && sm.status === 'ok' && typeof sm.text === 'string' && sm.text.trim()) out.push(sm.text);
  }
  return out;
}

/**
 * The call time the customer gave in this batch, or null. A proposal the customer's words fully back is kept
 * as written; one that only shares part of them («بكرا» → «بكرا 10–12») gives way to the customer's own words.
 */
function customerCallTime(ctx, candidates, texts) {
  const c = ctx || {};
  const joined = (texts || batchCustomerTexts(c)).join('\n');
  const facts = timeFacts(joined);
  if (!facts.spans.length) return null;
  // A relative or referential time is never the call time, whatever the model proposed (2026-09-17).
  if (VAGUE_TIME_RE.test(joined) && !EXPLICIT_CLOCK_RE.test(joined)) return null;
  const list = (Array.isArray(candidates) ? candidates : [candidates]).map(preferredTimeText).filter(isStorableTime);
  for (const t of list) if (groundedIn(t, facts)) return t;
  for (const t of list) {
    const m = timeFacts(t);
    if (m.spans.length && sharesTime(m, facts) && facts.phrase) return isStorableTime(facts.phrase) ? facts.phrase : null;
  }
  return null;
}

/**
 * A time that only means something at the moment it was typed: «بعد ساعة», «بعد ساعتين», «بكرا نفس
 * الوقت», "in an hour", "later". Owner phone test 2026-09-17: «اليوم بعد ساعتين» and «بكره نفس الوقت»
 * were stored as the confirmed call time and sent to staff, who cannot read them cold. They are not
 * stored: with booking on the customer taps a real slot, with booking off the bot asks for a day and a
 * time. An explicit clock time in the same message («بكرا الساعة 5») is still the customer's own time.
 */
const VAGUE_TIME_RE = new RegExp([
  `(?<![${AR_LETTERS}])بعد\\s+(?:ساعة|ساعه|ساعتين|ساعتي|ساعات|شوي|شوية|شويّة|قليل|كم\\s+\\S+|دقيقة|دقيقه|دقايق|دقائق)(?![${AR_LETTERS}])`,
  `(?<![${AR_LETTERS}])(?:ب)?نفس\\s+(?:الوقت|الموعد|الساعة|الساعه|التوقيت)(?![${AR_LETTERS}])`,
  `(?<![${AR_LETTERS}])(?:بعدين|لاحقًا|لاحقا|بوقت لاحق|وقت لاحق)(?![${AR_LETTERS}])`,
  '\\bin (?:an?|another|a few|\\d+) (?:hour|hours|hr|hrs|minute|minutes|min|mins|bit|while|moment)\\b',
  '\\bafter (?:an?|\\d+) (?:hour|hours|hr|hrs)\\b',
  '\\bsame time\\b',
  '\\b(?:later|later on|in a bit)\\b',
].join('|'), 'i');
const EXPLICIT_CLOCK_RE = new RegExp(`(?:الساعة|الساعه)\\s*${DIGIT}|${DIGIT}\\s*[:.]${DIGIT}{2}|${DIGIT}\\s*(?:ص|م|صباحًا|صباحا|مساءً|مساء)(?![${AR_LETTERS}])|\\b\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|o'?clock)\\b`, 'i');

/** A time text the server may store as the customer's preferred time. */
function isStorableTime(value) {
  const t = preferredTimeText(value);
  if (!t) return false;
  return !VAGUE_TIME_RE.test(t) || EXPLICIT_CLOCK_RE.test(t);
}

/** A stored time the customer picked by tapping a slot (or staff set with a window). */
function tappedTime(lead) {
  const pt = lead && lead.preferred_time;
  return isPlainObject(pt) && (pt.slot_id || pt.start) ? pt : null;
}

// A line that asks the customer to pick a time cannot stand above «سجّلت طلب مكالمة…» (owner phone test).
const CHOOSE_TIME_RE = /اختار|اختر|تختار|أي وقت|اي وقت|أي يوم|اي يوم|أي ساعة|اي ساعة|متى بفرغ|متى بتفضى|متى بتفضي|متى بناسبك|متى بيناسبك|إمتى|امتى|وقت بناسبك|وقت بيناسبك|وقت بريحك|الوقت المناسب|وقت مناسب|أقرب أوقات|اقرب أوقات|اقرب اوقات|أقرب اوقات|\bpick\b|\bchoose\b|which (?:day|time)|what time|when (?:are you|you're|would you be) free|when suits|when works|what works|a time that (?:suits|works)|nearest times/i;

/**
 * Round-2 review #5: the privacy notice «(بنستخدم اللي بتكتبه … — التفاصيل: shifts-ai.com/privacy)»
 * carries a colon, and a colon used to end a "sentence". withoutTimeAsk then dropped the piece that ends
 * on it — the opening paren and the whole explanation — and left the customer the orphan
 * «… بنرتّبها مع الفريق. shifts-ai.com/privacy). شو اسم المطعم الكريم؟». A parenthesis is never split.
 */
function sentencesOf(line) {
  const raw = String(line || '').split(/(?<=[.!؟?:：])(?=\s)|(?<=\n)/);
  const out = [];
  let open = 0;
  for (const piece of raw) {
    const delta = (piece.match(/[(（]/g) || []).length - (piece.match(/[)）]/g) || []).length;
    if (open > 0) out[out.length - 1] += piece;
    else out.push(piece);
    open = Math.max(0, open + delta);
  }
  return out;
}

function withoutChooseAsk(line) {
  if (!line) return null;
  const kept = sentencesOf(line).filter((s) => !CHOOSE_TIME_RE.test(s) && !/[:：]\s*$/.test(s));
  return kept.join('').trim() || null;
}

/**
 * Any question about a day, a time or the appointment. The server's own ask (or its slot buttons) is the
 * one question in the message: the model's «شو اليوم والوقت الجديد؟» above it made the reply ask twice
 * (owner phone test 2026-09-17, 07:51–07:58).
 */
const TIME_QUESTION_RE = /وقت|ساعة|ساعه|يوم|موعد|متى|إمتى|امتى|توقيت|\btime\b|\bday\b|\bwhen\b|\bhour\b|\bslot\b|\bappointment\b/i;

function isTimeQuestion(sentence) {
  const s = String(sentence || '');
  return /[؟?]/.test(s) && (TIME_QUESTION_RE.test(s) || CHOOSE_TIME_RE.test(s));
}

/** The model's line without its time question and without a dangling lead-in colon. */
function withoutTimeAsk(line) {
  if (!line) return null;
  const kept = sentencesOf(line).filter((s) => !isTimeQuestion(s) && !CHOOSE_TIME_RE.test(s) && !/[:：]\s*$/.test(s));
  return kept.join('').trim() || null;
}

function emptyResult(fields) {
  return {
    kind: 'reply',
    action: 'NONE',
    messages: [],
    stateUpdate: {},
    workflowDataPatch: {},
    leadPatch: null,
    leadMeta: null,
    needsTeam: null,
    alert: null,
    ...fields,
  };
}

/** Fill the optional ctx so toWorkflowResult can be called with the AI result alone (tests, scripts). */
function fillCtx(ctx = {}) {
  const business = ctx.business || { ai_config: {} };
  const conversation = ctx.conversation || { status: 'open', workflow_data: {} };
  const batchMessages = Array.isArray(ctx.batchMessages) ? ctx.batchMessages : [];
  const now = ctx.now instanceof Date ? ctx.now : new Date(ctx.now || Date.now());
  const wd = conversation.workflow_data || {};
  const joinedText = typeof ctx.joinedText === 'string'
    ? ctx.joinedText
    : batchMessages.map((m) => m.text_body || '').join('\n');
  const lang = ctx.lang || 'ar';
  const teamHours = ctx.teamHours || hours.resolveTeamHours(business.ai_config);
  const offers = Array.isArray(ctx.offers) ? ctx.offers : buttons.slotOffers(teamHours, now, lang);
  const newest = ctx.newest || batchMessages[batchMessages.length - 1] || null;
  const roleplayOn = typeof ctx.roleplayOn === 'boolean' ? ctx.roleplayOn : roleplay.roleplayEnabled();
  const vetted = ctx.vetted instanceof Set ? ctx.vetted : assets.vettedSectors(business);
  return { ...ctx, business, conversation, batchMessages, now, lang, teamHours, offers, newest, joinedText, wd, roleplayOn, vetted };
}

function modelLeadMeta(c) {
  return { source: 'model', msgId: c.newest?.id ?? null, at: c.now.toISOString(), inboundText: c.joinedText };
}

/** The stored call time is the one the customer asked for (a tapped slot by id/start, text otherwise). */
function isStoredTime(stored, requested) {
  if (!isPlainObject(stored) || !isPlainObject(requested)) return false;
  if (requested.slot_id) return stored.slot_id === requested.slot_id;
  if (requested.start) return stored.start === requested.start;
  return !!requested.text && normalize(stored.text || '') === normalize(requested.text);
}

/**
 * D26 / GPT-6 #12: the capture ack as the lead actually stands. The batcher calls this again with the
 * lead saveLead returned, so «سجّلت طلب مكالمة: الخميس 5» is only said when that time was stored. A
 * staff-owned time is never overwritten by the bot: the customer is told the new time was passed to
 * the team, and the request is kept in `requested_time_change` for staff (the lead card keeps theirs).
 */
function renderCaptureAck(capture, storedLead) {
  const lead = isPlainObject(storedLead) ? storedLead : {};
  const relayed = !isStoredTime(lead.preferred_time, capture.requested);
  const ack = relayed
    ? acks.captureRelayed({ when: capture.when, lang: capture.lang })
    : acks.captureAck({ name: lead.name, businessName: lead.business_name, when: capture.when, lang: capture.lang });
  // The ack says the time is recorded: a model sentence asking the customer to choose one cannot precede it.
  const line = withoutChooseAsk(capture.modelLine);
  const reply = line ? withoutChooseAsk(capture.modelReply || capture.modelLine) : null;
  // Round-2 review #15: the free-text time is captured honestly as «طلب مش موعد مؤكد» — and then the
  // real slots go out in the same turn, so the request can become a booking instead of waiting.
  const offers = Array.isArray(capture.offers) ? capture.offers.slice(0, 3) : [];
  const slotPart = offers.length
    ? [{
      type: 'interactive',
      text: acks.slotsBody(capture.lang),
      ack: acks.slotsBody(capture.lang),
      buttons: offers.map((o) => ({ id: o.id, title: o.title })),
      serverButtons: true,
    }]
    : [];
  return {
    relayed,
    messages: [textMessage(line, ack, reply), ...slotPart],
    workflowDataPatch: relayed
      ? { requested_time_change: { text: capture.requested?.text || capture.when, at: capture.at } }
      : {},
  };
}

function captureResult(ctx, { preferredTime, timeText, modelLine, modelReply, leadPatch } = {}) {
  const c = fillCtx(ctx);
  const at = c.now.toISOString();
  const patch = {
    ...(leadPatch || {}),
    preferred_time: preferredTime || leadPatch?.preferred_time || { text: timeText },
  };
  // The ack below names this time, so it must be stored even over an earlier confirmed one («خليها
  // الخميس» carries no correction word): the capture is the customer's explicit statement of it.
  const leadMeta = { ...modelLeadMeta(c), trusted: ['preferred_time'] };
  const lead = mergeLead(c.wd.lead || {}, patch, leadMeta).lead;
  // The requested time in its stored shape (a merge into an empty lead normalises it).
  const requested = mergeLead({}, { preferred_time: patch.preferred_time }, leadMeta).lead.preferred_time || null;
  const when = preferredTime?.start
    ? acks.windowText(preferredTime, c.now, preferredTime.tz || c.teamHours.tz, c.lang)
    : (timeText || preferredTimeText(preferredTime) || '');
  const existing = c.wd.needs_team;
  const entry = needsTeamEntry('meeting', when, at);
  const needs = mergeNeedsTeam(existing, entry);
  let needsTeamMerge = null;
  if (!needs && existing && existing.reason === 'meeting' && existing.summary !== entry.summary) {
    // Same request, new time: the team's item must show the time the customer was just told was noted.
    // Only the summary is merged, into needs_team as stored at write time: this copy was read before
    // the model call, and spreading it would wipe a flag the sweeper or staff set meanwhile.
    const match = { reason: 'meeting', at: existing.at };
    if ('resolved_at' in existing) match.resolved_at = null;
    if ('claimed_at' in existing) match.claimed_at = null;
    needsTeamMerge = { match, patch: { summary: entry.summary }, entry };
  }
  // A preview from the lead as read before the model call; the batcher re-renders it from `capture`
  // with the lead saveLead persisted, which is what the customer is told.
  const capture = { requested, when, lang: c.lang, modelLine: modelLine || null, at };
  if (modelLine && modelReply) capture.modelReply = modelReply;
  // Only REAL calendar slots (`book:<iso>`): a PR2 window offer would make a second request, not a booking.
  const realSlots = (c.offers || []).filter((o) => o && typeof o.id === 'string' && o.id.startsWith('book:')).slice(0, 3);
  if (realSlots.length && !inSandbox(c)) capture.offers = realSlots.map((o) => ({ id: o.id, title: o.title }));
  const preview = renderCaptureAck(capture, lead);

  return emptyResult({
    kind: 'reply',
    action: 'CAPTURE_TIME',
    messages: preview.messages,
    stateUpdate: { status: 'pending', current_state: 'captured' },
    workflowDataPatch: {
      capture_pending: null,
      bot_turns: (c.wd.bot_turns || 0) + 1,
      ...(needs && { needs_team: needs }),
      ...preview.workflowDataPatch,
    },
    leadPatch: patch,
    leadMeta,
    needsTeam: needs,
    // D27: re-merged against needs_team as stored at write time (a request resolved meanwhile).
    needsTeamCandidate: entry,
    needsTeamMerge,
    capture,
    alert: { reason: 'meeting', summary: when },
  });
}

function aiFailureResult(c) {
  const at = c.now.toISOString();
  // Slot buttons only mid-conversation and only while no time is chosen: offering a call on a bare
  // «مرحبا», or again right after the customer tapped a slot, read as broken (owner test, 2026-09-15).
  const timeChosen = Boolean(c.wd.lead?.preferred_time || c.wd.capture_pending);
  // No slot buttons inside the sandbox either: a call offer mid-example reads as part of the example.
  const inRoleplay = roleplay.isActive(c.wd) || ROLEPLAY_STAGES.includes(c.conversation.current_state);
  const withButtons = !isStageLocked(c.conversation) && c.conversation.current_state !== 'closed' && !inRoleplay
    && c.offers.length > 0 && (c.wd.bot_turns || 0) > 0 && !timeChosen;
  const candidate = needsTeamEntry('ai_failure', c.joinedText.slice(0, 200), at);
  const needs = mergeNeedsTeam(c.wd.needs_team, candidate);
  const workflowDataPatch = { bot_turns: (c.wd.bot_turns || 0) + 1 };
  if (needs) workflowDataPatch.needs_team = needs;
  let message;
  if (withButtons) {
    message = { type: 'interactive', text: acks.aiFailure(c.lang, { withButtons: true }), buttons: c.offers.map((o) => ({ id: o.id, title: o.title })) };
    workflowDataPatch.slot_offers = c.offers.map((o) => ({ id: o.id, title: o.title, issued_at: at }));
  } else {
    message = { type: 'text', text: acks.aiFailure(c.lang, { withButtons: false }) };
  }
  return emptyResult({
    kind: 'fallback',
    action: 'AI_FAILURE',
    messages: [message],
    stateUpdate: { status: 'pending' },
    workflowDataPatch,
    needsTeam: needs,
    needsTeamCandidate: candidate,
    alert: { reason: 'ai_failure', summary: c.joinedText.slice(0, 200) },
  });
}

const BLOCKED_REPLIES_CAP = 10;

/**
 * The model refused to generate (a safety block, not a timeout): one calm line, no buttons, no team task.
 * Abuse is not a lead, so nothing goes on the team's list; the turn is kept in `blocked_replies` so staff
 * can see in the Inbox why the bot answered the way it did (owner phone test 2026-09-15, 16:14:32).
 */
function blockedReplyResult(ctx, reason = 'BLOCKED') {
  const c = fillCtx(ctx);
  const at = c.now.toISOString();
  const prev = Array.isArray(c.wd.blocked_replies) ? c.wd.blocked_replies : [];
  return emptyResult({
    kind: 'fallback',
    action: 'BLOCKED_REPLY',
    messages: [{ type: 'text', text: acks.blockedReply(c.lang) }],
    workflowDataPatch: {
      bot_turns: (c.wd.bot_turns || 0) + 1,
      nudge: null,
      blocked_replies: [...prev, { at, reason: String(reason || 'BLOCKED') }].slice(-BLOCKED_REPLIES_CAP),
    },
  });
}

/** A pending capture's slot: over once its window has ended or the tap is older than an offer may be. */
function slotExpired(slot, capturePending, now) {
  const nowMs = now.getTime();
  const endMs = slot.end ? new Date(slot.end).getTime() : NaN;
  if (Number.isFinite(endMs) && endMs <= nowMs) return true;
  const atMs = capturePending.at ? new Date(capturePending.at).getTime() : NaN;
  return Number.isFinite(atMs) && nowMs - atMs > buttons.SLOT_OFFER_TTL_MS;
}

function firstLine(s) {
  return (s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
}

/**
 * Lead extraction is off inside the sandbox: a mock «أنا أبو أحمد» must never become lead.name (G6). The first
 * batch after an example the sweeper ended silently (idle) is still sandbox: the prospect may be writing in
 * character, and nothing told them the example was over (review r2 #0/#10).
 */
function inSandbox(c) {
  return ROLEPLAY_STAGES.includes(c.conversation.current_state) || roleplay.isActive(c.wd)
    || roleplay.endUnannounced(c.wd.roleplay, c.now);
}

/**
 * An example is only played while the stage is the example's and no team request locks it. A live
 * roleplay object left behind in any other stage (a tap moved the stage, a half-applied sweep) is stale:
 * the reply is SHIFT's Karam, and the object is ended with it (review r2 #12).
 */
function roleplayLive(c) {
  return roleplay.isActive(c.wd) && ROLEPLAY_STAGES.includes(c.conversation.current_state) && !isStageLocked(c.conversation);
}

/** What the customer typed or said, in this batch (with transcripts) and in the loaded history. */
function customerTextsOf(c) {
  const out = [];
  for (const m of c.batchMessages) {
    if (typeof m.text_body === 'string' && m.text_body.trim()) out.push(m.text_body);
    const sm = shiftMediaOf(m, c);
    if (sm && sm.status === 'ok' && typeof sm.text === 'string' && sm.text.trim()) out.push(sm.text);
  }
  for (const t of Array.isArray(c.customerHistoryTexts) ? c.customerHistoryTexts : []) {
    if (typeof t === 'string' && t.trim()) out.push(t);
  }
  return out;
}

const GENERIC_NAME_HEAD_RE = /^(?:مطعم|كافيه|كافي|كوفي|عيادة|عياده|متجر|محل|محلات|صالون|مركز|شركة|مؤسسة|the|restaurant|cafe|café|clinic|store|shop)\s+/i;

/** The business name occurs in what the customer wrote (with or without its generic head word). */
function customerWrote(name, texts) {
  const n = normalize(name);
  if (!n) return false;
  const hay = texts.map((t) => normalize(t)).join('\n');
  if (hay.includes(n)) return true;
  const core = normalize(String(name).replace(GENERIC_NAME_HEAD_RE, ''));
  return Array.from(core).length >= 2 && core !== n && hay.includes(core);
}

/** The end line's statements in front of the first part: the reply to the first batch after a silent end. */
function withEndNote(messages, sector, lang) {
  const note = roleplay.endNote(sector, lang);
  const list = Array.isArray(messages) ? messages.slice() : [];
  const first = list[0];
  if (first && first.type === 'text') {
    list[0] = { ...first, text: compose(note, first.text, TEXT_LIMIT) };
  } else if (list.length < 3) {
    list.unshift({ type: 'text', text: note });
  } else if (first && first.type === 'interactive') {
    list[0] = { ...first, text: compose(note, first.text, INTERACTIVE_LIMIT) };
  }
  return list;
}

function cleanLeadPatch(lead, c) {
  if (inSandbox(c)) return null;
  const out = {};
  if (isPlainObject(lead)) {
    for (const [k, v] of Object.entries(lead)) {
      if (v === null || v === undefined || v === '') continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[k] = v;
    }
  }
  if (out.preferred_time !== undefined) {
    // Only a time the customer wrote in this batch reaches the lead (owner phone test, 2026-09-15).
    const said = customerCallTime(c, [out.preferred_time]);
    if (said) out.preferred_time = said;
    else delete out.preferred_time;
  }
  if (Object.keys(out).length) return out;
  // An empty patch still lets saveLead record the numbers the customer typed (the PR2 digit guard).
  return extractCustomerNumbers(c.joinedText).length ? {} : null;
}

function stateWith(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) out[k] = v;
  return out;
}

function sampleSector(value) {
  return assets.SAMPLE_SECTORS.includes(value) ? value : 'other';
}

function textsOf(c) {
  return c.batchMessages.map((m) => (typeof m.text_body === 'string' ? m.text_body : '')).filter((t) => t.trim());
}

function shiftMediaOf(message, c) {
  if (message.shift_media) return message.shift_media;
  if (message.raw_payload && message.raw_payload.shift_media) return message.raw_payload.shift_media;
  const row = Array.isArray(c.mediaRows) ? c.mediaRows.find((r) => r && r.id && r.id === message.id) : null;
  return row ? (row.shift_media || row.raw_payload?.shift_media || null) : null;
}

/**
 * The line above a model reply for a batch with an attachment. A transcribed voice note or image
 * (SHIFT_MEDIA=1, status ok) gets «(سمعت رسالتك الصوتية)»; anything the bot could not read keeps
 * PR1's «بقرأ النص بس» — the reply must not sound as if it heard what it did not.
 */
function mediaPrefixFor(c, reply) {
  const mediaMessages = c.batchMessages.filter((m) => MEDIA_TYPES.includes(m.message_type));
  if (!mediaMessages.length || !reply || TEXT_ONLY_RE.test(reply)) return '';
  const unread = mediaMessages.find((m) => shiftMediaOf(m, c)?.status !== 'ok');
  if (!unread) return acks.mediaTranscribedPrefix(mediaMessages[0].message_type, c.lang);
  const separateText = c.batchMessages.some((m) => m.text_body && !MEDIA_TYPES.includes(m.message_type));
  return acks.mediaPrefix(unread.message_type, c.lang, { captioned: !separateText && !!unread.text_body });
}

/**
 * The server's media notice is the only sentence about the attachment. Owner phone test 2026-09-17,
 * 07:59:53: under «وصلتني رسالتك الصوتية كمان 🙏 هون بقرأ النص بس.» the model added «بلاحظ الرسالة
 * الصوتية وصلتك بالنص» — nonsense, and it contradicted the line above it. Every model sentence about the
 * attachment is dropped; what the model said about the customer's words stays.
 */
const MEDIA_NOUN_RE = /الصوتي|صوتية|صوتيه|الڤويس|الفويس|المرفق|المرفقات|الصورة|الفيديو|الملف|الملصق|\bvoice (?:note|message)\b|\bvoicenote\b|\baudio\b|\battachment\b|\b(?:image|photo|picture|video|file|sticker)\b/i;
// The notice itself: «وصلتني رسالتك الصوتية», «وصلتك بالنص», "I only read text here". A sentence that
// merely mentions the attachment («شفت الصورة») is the model's own claim and is judged by the validators.
const MEDIA_NOTICE_VERB_RE = /وصل|واصل|استلم|تلقّيت|تلقيت|بقرأ|بقرا|بالنص|النص بس|بس النص|\bread (?:only )?text\b|\bonly read\b|\breceiv\w*\b|\bgot your\b|\bcame (?:through|in)\b/i;

function withoutMediaTalk(line) {
  if (!line) return '';
  const kept = sentencesOf(line).filter((sentence) => !(MEDIA_NOUN_RE.test(sentence) && MEDIA_NOTICE_VERB_RE.test(sentence)));
  return kept.join('').trim();
}

/** Objective row 9: no sector yet and a bare greeting (≤ 3 words, no question) on the first reply. */
function isBareGreetingBatch(c) {
  if (!c.batchMessages.length || c.batchMessages.some((m) => m.message_type && m.message_type !== 'text')) return false;
  const joined = textsOf(c).join(' ').trim();
  if (!joined || /[؟?]/.test(joined)) return false;
  return joined.split(/\s+/).length <= BARE_GREETING_MAX_WORDS;
}

function endRoleplayPart(reply, shown, sector, lang) {
  const end = roleplay.endLine(sector, lang);
  // The model's debrief is kept only when it labels the example itself (G6 needs the label at the end).
  if (reply && ROLEPLAY_LABEL_RE.test(reply)) return textMessage(shown, end, reply);
  return { type: 'text', text: end };
}

/** The model's line without its own questions: the fixed setup ask after it is the one question. */
function statementsOnly(line) {
  return String(line || '')
    .split(/(?<=[.!؟?\n])/)
    .filter((sentence) => !/[؟?]/.test(sentence))
    .join('')
    .trim();
}

function setupAskPart(shown, reply, sector, lang) {
  const ask = roleplay.setupAsk(sector, lang);
  const line = statementsOnly(shown);
  const own = statementsOnly(reply);
  return line && own ? textMessage(line, ask, own) : { type: 'text', text: ask };
}

// ─── finishing: patches every model-path result shares ───────────────────────

function unionList(a, b) {
  const out = [];
  for (const v of [].concat(a || [], b || [])) {
    if (!out.some((x) => normalize(x) === normalize(v))) out.push(v);
  }
  return out;
}

/**
 * §9.2 step 6: the pre-fill's parsed facts under the model's. The customer sent name, business and
 * sector themselves, so those keep the pre-fill's values; calculator numbers stay out of
 * customer_numbers and are kept as site estimates.
 */
function applyPrefill(leadPatch, leadMeta, wdp, c, prefill) {
  const p = isPlainObject(prefill.leadPatch) ? prefill.leadPatch : {};
  const model = leadPatch || {};
  const merged = { ...p };
  for (const [k, v] of Object.entries(model)) {
    if (['name', 'business_name', 'sector'].includes(k) && p[k]) continue;
    if (['need', 'products'].includes(k) && Array.isArray(p[k])) {
      merged[k] = unionList(p[k], v);
      continue;
    }
    merged[k] = v;
  }
  if (!model.source && c.wd.lead?.source?.type !== 'ctwa') {
    merged.source = { type: 'site', attribution: prefill.attribution || null, confidence: 'confirmed' };
  }
  const trusted = ['name', 'business_name', 'sector'].filter((k) => p[k]);
  const meta = {
    ...leadMeta,
    inboundText: prefillParser.stripEstimates(c.joinedText, prefill),
    trusted: Array.from(new Set([...(leadMeta.trusted || []), ...trusted])),
  };
  wdp.prefill = {
    kind: prefill.kind,
    lang: prefill.lang,
    truncated: !!prefill.truncated,
    at: c.now.toISOString(),
    msg_id: c.batchMessages[0]?.id ?? null,
  };
  // PR1 mergeLead never takes site_estimates from a patch (its rule 4): kept beside the lead (§14 #7).
  if (Array.isArray(prefill.siteEstimates) && prefill.siteEstimates.length) wdp.site_estimates = prefill.siteEstimates;
  return { leadPatch: merged, leadMeta: meta };
}

function addTrusted(meta, field) {
  return { ...meta, trusted: Array.from(new Set([...(meta.trusted || []), field])) };
}

function lastPartOf(r) {
  return Array.isArray(r.messages) && r.messages.length ? r.messages[r.messages.length - 1] : null;
}

function finishResult(r, c, { aiResult, reply, action, common, baseLeadPatch, prefill }) {
  const wd = c.wd;
  const stage = c.conversation.current_state;
  const sandbox = inSandbox(c);
  let wdp = { ...r.workflowDataPatch, ...common };
  let leadPatch = r.leadPatch ?? baseLeadPatch;
  let leadMeta = r.leadMeta || modelLeadMeta(c);

  // §9.2 step 11: any inbound-driven result cancels a pending nudge (the sweeper re-plans from last_bot).
  wdp.nudge = null;

  // A handoff, opt-out or «مش هلأ» mid-example ends the example (state machine §3.2).
  if (roleplay.isActive(wd) && ['HANDOFF_TO_HUMAN', 'OPT_OUT', 'NOT_NOW'].includes(action) && !('roleplay' in r.workflowDataPatch)) {
    wdp.roleplay = roleplay.endState(wd.roleplay, action === 'HANDOFF_TO_HUMAN' ? 'handoff' : 'optout', c.now);
  }
  // A live object outside the example's stage is ended with this out-of-character reply (review r2 #12).
  if (roleplay.isActive(wd) && !roleplayLive(c) && !wdp.roleplay) {
    wdp.roleplay = roleplay.endState(wd.roleplay, 'done', c.now);
  }
  // The first reply after a silent idle end tells the customer the example is over (review r2 #0/#10).
  let messages = r.messages;
  if (roleplay.endUnannounced(wd.roleplay, c.now)) {
    if (action !== 'OPT_OUT') messages = withEndNote(r.messages, wd.roleplay.sector, c.lang);
    if (!wdp.roleplay) wdp.roleplay = { ...wd.roleplay, end_announced_at: c.now.toISOString() };
  }

  if (!sandbox) {
    if (prefill) ({ leadPatch, leadMeta } = applyPrefill(leadPatch, leadMeta, wdp, c, prefill));

    // §9.2 step 7: the answer to «شو نوع النشاط بالضبط؟» after «نشاط آخر».
    if (wd.awaiting_sector_text) {
      if (!aiResult?.lead?.sector_text) {
        const first = textsOf(c)[0];
        if (first) {
          leadPatch = { ...(leadPatch || {}), sector_text: cutCodePoints(first.replace(/\s+/g, ' ').trim(), SECTOR_TEXT_MAX) };
          leadMeta = addTrusted(leadMeta, 'sector_text');
        }
      }
      wdp.awaiting_sector_text = false;
    }

    // §9.2 step 10: an Arabizi writer is an Arabic speaker, whatever the Latin script suggests (G14).
    const texts = textsOf(c);
    for (let i = texts.length - 1; i >= 0; i -= 1) {
      if (!validators.languageOf(texts[i])) continue;
      if (validators.isArabizi(texts[i])) {
        leadPatch = { ...(leadPatch || {}), language: 'ar' };
        leadMeta = addTrusted(leadMeta, 'language');
      }
      break;
    }
  }

  // §9.2 step 9: counters.
  const postStage = r.stateUpdate?.current_state ?? stage;
  const last = lastPartOf(r);
  if (postStage === 'discovery' && last && validators.countQuestions(last.text || '') > 0) {
    wdp.questions_asked = (Number(wd.questions_asked) || 0) + 1;
  }
  const tapped = c.batchMessages.some((m) => m.message_type === 'interactive' || m.message_type === 'button');
  // A reply that already offered a step (an example, a call, buttons) restarts the count, so objective row 17
  // adds its commitment push at most once every three replies, never on each one (prompt: «لا تكرر»).
  const offeredStep = COMMITMENT_ACTIONS.includes(action) || (Array.isArray(r.messages) && r.messages.some((p) => p
    && (p.type === 'interactive' || p.type === 'list') && ((p.buttons && p.buttons.length) || p.sections)))
    || (reply && COMMITMENT_OFFER_RE.test(reply));
  wdp.msgs_since_interest = aiResult?.lead?.interest === 'hot' || tapped || offeredStep ? 0 : (Number(wd.msgs_since_interest) || 0) + 1;
  const estimates = wdp.site_estimates || wd.site_estimates || wd.lead?.site_estimates;
  if (reply && reply.includes('الحاسبة') && Array.isArray(estimates) && estimates.length && !wd.calc_echoed_at) {
    wdp.calc_echoed_at = c.now.toISOString();
  }
  if (stage === 'close' && CLOSE_DECLINE_RE.test(c.joinedText)) {
    wdp.close_declines = (Number(wd.close_declines) || 0) + 1;
  }

  const guarded = repeatedAskGuard({ ...r, messages }, c, wdp, action);
  const out = { ...guarded, workflowDataPatch: wdp, leadPatch, leadMeta };
  // last_bot for every result; the validators recompute it for a reply after their repairs.
  return validators.repairNextStep(out, aiResult, { stage: postStage, now: c.now }).result;
}

// ─── the same question, twice ────────────────────────────────────────────────
//
// Owner phone test 2026-09-17: «شو اليوم والوقت الجديد اللي يناسبك؟» went out five times in seven minutes
// (07:51:22 → 07:58:37) while the customer kept answering. Nothing noticed that the ask had already gone
// out unanswered. `wd.last_ask` keeps the last question's key and how many times in a row it was asked;
// a repeat is answered with the deterministic next step instead of the same words.

const ASK_REPEAT_MAX = 2;
const ASK_KEY_MAX = 120;
const NO_ASK_GUARD_ACTIONS = ['OPT_OUT', 'NOT_NOW', 'HANDOFF_TO_HUMAN', 'START_ROLEPLAY', 'END_ROLEPLAY'];

// Words that carry no topic: two asks are "the same" on what they are about, not on their politeness.
const ASK_STOPWORDS = new Set(['شو', 'ما', 'مين', 'وين', 'كيف', 'هو', 'هي', 'في', 'من', 'عن', 'على', 'مع',
  'هل', 'يا', 'بس', 'كمان', 'حاليا', 'هلا', 'هلأ', 'لو', 'سمحت', 'ممكن', 'تحب', 'بتحب', 'بدك', 'عندك',
  'the', 'a', 'an', 'is', 'are', 'do', 'does', 'you', 'your', 'what', 'which', 'who', 'where', 'how', 'of',
  'in', 'on', 'at', 'to', 'for', 'and', 'or', 'please', 'could', 'would', 'can']);

function askWordsOf(text) {
  return Array.from(new Set(normalize(text).split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !ASK_STOPWORDS.has(w))));
}

/**
 * The key of the question a part ends on: 'time' for any day/time ask, its normalized words otherwise,
 * plus the topic words so a reworded repeat of the same question still counts as a repeat (#7).
 */
function askKeyOf(part) {
  if (!part || typeof part.text !== 'string') return null;
  const questions = sentencesOf(part.text).filter((s) => /[؟?]/.test(s));
  if (!questions.length) return null;
  const joined = questions.join(' ');
  if (questions.some(isTimeQuestion)) return { key: 'time', words: [] };
  const key = normalize(joined).slice(0, ASK_KEY_MAX);
  return key ? { key, words: askWordsOf(joined).slice(0, 8) } : null;
}

/** «شو مجال شغلك؟» and «طيب، شو مجال شغلك حاليًا؟» are one ask asked twice. */
function sameAsk(prev, cur) {
  if (!prev || !cur) return false;
  if (prev.key === cur.key) return true;
  if (prev.key === 'time' || cur.key === 'time') return false;
  const a = new Set(Array.isArray(prev.words) ? prev.words : []);
  const b = new Set(Array.isArray(cur.words) ? cur.words : []);
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const w of b) if (a.has(w)) shared += 1;
  return shared / Math.max(a.size, b.size) >= 0.6;
}

function askPart(part, line, ack, buttonList) {
  if (buttonList && buttonList.length) {
    return withMeta({
      type: 'interactive',
      text: compose(line, ack, INTERACTIVE_LIMIT),
      buttons: buttonList.map((o) => ({ id: o.id, title: o.title })),
      // The offers are the server's: they stay with the body line even if the model's words are replaced.
      serverButtons: true,
    }, line, ack, part.modelLine || null);
  }
  return withMeta({ ...part, type: 'text', text: compose(line, ack, TEXT_LIMIT) }, line, ack, part.modelLine || null);
}

function partHasButtons(part) {
  if (!part) return false;
  if (part.type === 'interactive') return Array.isArray(part.buttons) && part.buttons.length > 0;
  if (part.type === 'list') return (part.sections || []).some((sec) => (sec.rows || []).length > 0);
  return false;
}

function repeatedAskGuard(r, c, wdp, action) {
  const messages = Array.isArray(r.messages) ? r.messages : [];
  const last = messages[messages.length - 1];
  const prev = isPlainObject(c.wd.last_ask) ? c.wd.last_ask : null;
  const at = c.now.toISOString();
  const clear = () => {
    if (prev) wdp.last_ask = null;
    return r;
  };
  if (NO_ASK_GUARD_ACTIONS.includes(action) || inSandbox(c) || r.kind === 'handoff') return r;
  // Buttons are a next step, not a question that can be repeated.
  if (partHasButtons(last)) return clear();
  const ask = askKeyOf(last);
  if (!ask) return clear();
  const { key, words } = ask;
  const msgId = c.newest?.id ?? null;
  // A re-run of the SAME batch (a send that failed, a sweeper requeue) is not the customer ignoring the
  // question — they never saw it. Only a new inbound batch can repeat an ask.
  const rerun = !!(prev && msgId && prev.msg_id === msgId);
  const count = !rerun && sameAsk(prev, ask) ? (Number(prev.count) || 1) + 1 : 1;
  if (count === 1) {
    wdp.last_ask = { key, words, at, count, msg_id: msgId };
    return r;
  }

  const line = key === 'time' ? withoutTimeAsk(last.text) : statementsOnly(last.text);
  const head = messages.slice(0, -1);
  const offersBlocked = key !== 'time' || inSandbox(c)
    || (isStageLocked(c.conversation) && !calendarOpen(c))
    || !!(c.wd.capture_pending && c.wd.capture_pending.slot_id === 'other');
  const offers = offersBlocked ? [] : (c.offers || []).slice(0, 3);
  if (offers.length) {
    // The deterministic next step: real times to tap instead of the same question again.
    wdp.slot_offers = offers.map((o) => ({ id: o.id, title: o.title, issued_at: at }));
    wdp.last_ask = null;
    return { ...r, messages: [...head, askPart(last, line, acks.slotsBody(c.lang), offers)] };
  }
  if (key === 'time' && count <= ASK_REPEAT_MAX) {
    // Nothing to offer: the same ask once more, in the server's own words, and counted.
    wdp.last_ask = { key, words, at, count, msg_id: msgId };
    return { ...r, messages: [...head, askPart(last, line, acks.callTimeAsk(c.lang), null)] };
  }
  if (count <= ASK_REPEAT_MAX) {
    // Round-2 review #7: ANY question that came back unanswered is dropped the second time — the model's
    // own words go out without it, and the server offers a step instead of asking again.
    const moveOn = acks.askMovedOn(c.lang);
    wdp.last_ask = {
      key: normalize(moveOn).slice(0, ASK_KEY_MAX), words: askWordsOf(moveOn).slice(0, 8), at, count: 1, msg_id: msgId,
    };
    return { ...r, messages: [...head, askPart(last, line, moveOn, null)] };
  }

  // Asked three times with no answer: the team takes it over, and the bot stops repeating itself.
  const candidate = needsTeamEntry(key === 'time' ? 'meeting' : 'unknown',
    `سؤال متكرر بدون جواب: ${cutCodePoints(String(last.text || ''), 120)}`, at);
  const needs = mergeNeedsTeam(c.wd.needs_team, candidate);
  wdp.last_ask = null;
  if (needs) wdp.needs_team = needs;
  return {
    ...r,
    messages: [...head, askPart(last, line, acks.askHandover(c.lang), null)],
    stateUpdate: { ...(r.stateUpdate || {}), status: 'pending' },
    needsTeam: needs || r.needsTeam,
    needsTeamCandidate: candidate,
    alert: r.alert || { reason: 'needs_team', summary: candidate.summary },
  };
}

/**
 * The customer agreed to a call without naming a time (owner phone test, 2026-09-15): the slot buttons under
 * the server's «أقرب أوقات الفريق:», or «أي يوم ووقت بناسبك؟» when there is nothing to offer (outside team
 * hours, the team's request open, or right after «وقت ثاني»). Nothing is stored, no capture, no alert.
 */
function callTimeAskResult(c, { shown, reply, locked, leadPatch }) {
  const at = c.now.toISOString();
  const stateUpdate = locked ? {} : { current_state: 'close' };
  const askedOther = c.wd.capture_pending && c.wd.capture_pending.slot_id === 'other';
  // A `captured` conversation holding only a call request is not locked against the calendar (2026-09-17).
  const offersBlocked = (locked && !calendarOpen(c)) || inSandbox(c) || askedOther;
  const offers = offersBlocked ? [] : (c.offers || []).slice(0, 3);
  if (offers.length) {
    const body = acks.slotsBody(c.lang);
    const line = withoutTimeAsk(shown);
    const own = withoutTimeAsk(reply);
    const part = withMeta({
      type: 'interactive',
      text: compose(line, body, INTERACTIVE_LIMIT),
      buttons: offers.map((o) => ({ id: o.id, title: o.title })),
      // Server-chosen offers: they stay with the body line even if the model's words are replaced.
      serverButtons: true,
    }, line, body, own);
    return emptyResult({
      action: 'NONE',
      messages: [part],
      stateUpdate,
      workflowDataPatch: { slot_offers: offers.map((o) => ({ id: o.id, title: o.title, issued_at: at })) },
      leadPatch,
    });
  }
  // The server's «أي يوم ووقت بناسبك؟» is the message's one question: the model's own goes with it.
  const line = withoutTimeAsk(shown);
  const own = line ? withoutTimeAsk(reply) : null;
  return emptyResult({
    action: 'NONE',
    messages: [textMessage(line, acks.callTimeAsk(c.lang), own)],
    stateUpdate,
    leadPatch,
  });
}

/** Whether the calendar may still be offered although the stage is locked (design §Flow, 2026-09-17). */
function calendarOpen(c) {
  return booking.calendarOpenAt(c.business, c.conversation, c.now);
}

// ─── the entry point ─────────────────────────────────────────────────────────

function resolveAction(aiResult, c) {
  const rawArgs = isPlainObject(aiResult?.action_args) ? aiResult.action_args : {};
  const { actions } = actionSetFor();
  let action = aiResult && actions.includes(aiResult.action) ? aiResult.action : 'NONE';
  const norm = normalizeActionArgs(action, rawArgs);
  if (!norm.ok) {
    console.warn('[shift] bad_args', JSON.stringify({ conv: c.conversation.id || null, action, reason: norm.reason }));
    action = 'NONE';
    return { action, args: rawArgs, rawArgs };
  }
  return { action, args: { ...rawArgs, ...norm.args }, rawArgs };
}

function toWorkflowResult(aiResult, ctx) {
  const c = fillCtx(ctx);
  const wd = c.wd;
  // A re-run of the first reply to the same site message (run 1 stored wd.prefill, its send failed) keeps it.
  const prefillRerun = !!(wd.prefill && wd.prefill.msg_id && wd.prefill.msg_id === c.batchMessages[0]?.id);
  const prefill = c.prefill && (!wd.prefill || prefillRerun) ? c.prefill : null;
  let reply = aiResult && typeof aiResult.reply === 'string' ? aiResult.reply.trim() : '';
  let { action, args, rawArgs } = aiResult ? resolveAction(aiResult, c) : { action: 'NONE', args: {}, rawArgs: {} };
  const common = { bot_turns: (wd.bot_turns || 0) + 1 };
  const baseLeadPatch = cleanLeadPatch(aiResult && aiResult.lead, c);
  const finishOpts = () => ({ aiResult, reply, action, common, baseLeadPatch, prefill });
  const finish = (r) => finishResult(r, c, finishOpts());

  // An empty line is as silent as a failure; these actions have their own fixed text.
  if (!aiResult || (!reply && !SERVER_TEXT_ACTIONS.includes(action))) {
    return finish(aiFailureResult(c));
  }

  const at = c.now.toISOString();
  const lead = wd.lead || {};
  const stage = c.conversation.current_state;
  const locked = isStageLocked(c.conversation);
  const rpActive = roleplayLive(c);
  // A `roleplay` stage whose example already ended (idle, before the sweeper moved it) continues as close.
  const stageForNext = stage === 'roleplay' && !rpActive ? 'close' : stage;
  let leadPatch = baseLeadPatch;
  const leadMeta = modelLeadMeta(c);

  const prefix = mediaPrefixFor(c, reply);
  // The notice about the attachment is the server's line alone; the model's own words about it go (§8.4).
  if (prefix) reply = withoutMediaTalk(reply);
  const shown = prefix && reply ? `${prefix}\n${reply}` : (prefix || reply);
  const mtext = (ack) => textMessage(shown, ack, reply);

  if (!wd.disclosed_at && /مساعد شِفت|SHIFT's AI assistant/.test(reply) && reply.includes(SITE_HOST)) common.disclosed_at = at;

  // ── the sandbox (§9.2 steps 4–5): a live example answers in character until it ends ──
  if (rpActive && !['HANDOFF_TO_HUMAN', 'OPT_OUT', 'NOT_NOW'].includes(action)) {
    const texts = textsOf(c);
    const exit = texts.length === 1 && c.batchMessages.length === 1 && roleplay.isExit(texts[0]);
    const sector = wd.roleplay.sector;
    if (action === 'END_ROLEPLAY' || exit) {
      return finish(emptyResult({
        action: 'END_ROLEPLAY',
        messages: [endRoleplayPart(reply, shown, sector, c.lang)],
        stateUpdate: { current_state: 'close' },
        workflowDataPatch: { roleplay: roleplay.endState(wd.roleplay, 'done', c.now) },
      }));
    }
    if (!reply && !prefix) return finish(aiFailureResult(c));
    const turn = roleplay.nextTurn(wd.roleplay, c.now);
    // The start line never reached the customer (replyBatcher.deliveredView): it leads this first turn,
    // so nothing in character is ever read without the example label (G6).
    const startFirst = wd.roleplay.start_undelivered ? roleplay.startLine(wd.roleplay.business_name, c.lang) : null;
    const turnPart = startFirst
      ? { type: 'text', text: compose(startFirst, turn.ended ? compose(shown, roleplay.endLine(sector, c.lang)) : shown, TEXT_LIMIT), modelLine: reply, ack: startFirst }
      : (turn.ended ? mtext(roleplay.endLine(sector, c.lang)) : mtext());
    // Model buttons are dropped: nothing inside the example may look like a real booking control.
    return finish(emptyResult({
      action: 'NONE',
      messages: [turnPart],
      stateUpdate: turn.ended ? { current_state: 'close' } : {},
      workflowDataPatch: { roleplay: turn.roleplay },
    }));
  }

  // A tapped slot (or «وقت ثاني») whose details this batch completes. Not from the role-play setup:
  // a mock «بدي احجز بكرا» there must never become a real call request (G6).
  const flagsOther = action === 'FLAG_FOR_TEAM' && rawArgs.reason !== 'meeting';
  const answerLine = /[؟?]/.test(c.joinedText) ? shown : null;
  if (wd.capture_pending && !inSandbox(c) && !['OPT_OUT', 'NOT_NOW', 'HANDOFF_TO_HUMAN'].includes(action) && !flagsOther) {
    const cp = wd.capture_pending;
    const storedSlot = cp.slot_id && cp.slot_id !== 'other' && lead.preferred_time?.slot_id === cp.slot_id
      ? lead.preferred_time
      : null;
    const expired = !!storedSlot && slotExpired(storedSlot, cp, c.now);
    // A pending time is the customer's only if their words (this batch or the loaded history) carry it: a
    // PR1 row may hold a model-invented one. A new time must be in this batch.
    const pendingText = cp.time_text && groundedIn(cp.time_text, timeFacts(customerTextsOf(c).join('\n'))) ? cp.time_text : null;
    let timeText = pendingText || customerCallTime(c, [aiResult.lead?.preferred_time, rawArgs.time_text]);
    // An echo of the expired slot's own wording is not a new time.
    if (expired && timeText && normalize(timeText) === normalize(storedSlot.text || '')) timeText = null;
    const answer = { modelLine: answerLine, modelReply: answerLine ? reply : null };
    if (storedSlot && !expired) {
      return finish(captureResult(c, { preferredTime: storedSlot, ...answer, leadPatch }));
    }
    if (timeText) {
      return finish(captureResult(c, { timeText, ...answer, leadPatch: { ...(leadPatch || {}), preferred_time: timeText } }));
    }
    if (storedSlot) {
      // The tapped window is over (or the tap is stale): the same rule handleButton applies at tap time.
      return finish(emptyResult({
        action: 'NONE',
        messages: [textMessage(answerLine, acks.expiredSlot(c.lang), reply)],
        stateUpdate: locked ? {} : { current_state: 'close' },
        workflowDataPatch: { capture_pending: { slot_id: null, time_text: null, at } },
      }));
    }
  }

  // Samples and role-play are sales steps: never while the team's request is open (concierge).
  if (locked && ['SEND_SAMPLE', 'START_ROLEPLAY', 'END_ROLEPLAY'].includes(action)) action = 'NONE';

  // §9.3: a bundle quote from the site is a quote request even when the model forgot to flag it.
  if (prefill && (prefill.wantsQuote || prefill.kind === 'bundle_quote') && action === 'NONE') {
    const products = (prefill.leadPatch?.products || []).map((k) => PRODUCT_LABELS[k] || k).join('، ');
    action = 'FLAG_FOR_TEAM';
    args = { reason: 'quote', summary: `عرض سعر لباقة من الموقع: ${products}`.slice(0, 200) };
    rawArgs = args;
  }

  if (action === 'SEND_SAMPLE') {
    const r = sendSampleResult(c, { rawArgs, args, reply, mtext, shown, lead, at, stage: stageForNext });
    if (r) return finish(r);
    action = 'NONE';
  }

  if (action === 'START_ROLEPLAY') {
    const r = startRoleplayResult(c, { rawArgs, args, reply, shown, lead, at });
    if (r) return finish(r);
    action = 'NONE';
  }

  // END_ROLEPLAY without a live example (handled above): the model line alone.
  if (action === 'END_ROLEPLAY') action = 'NONE';

  // A time the customer stated in this message («Can we speak tomorrow after 4?») is a call request even
  // when the model only wrote it into the lead: the server stores it now and asks for what the capture
  // still needs (eval #7), instead of offering slot buttons over the time the customer already gave.
  // Only a time the customer's own words carry: never a slot title or «متى نحكي؟» the model copied in.
  const statedTime = action === 'NONE' && !locked && !inSandbox(c) && stage !== 'captured' && aiResult.lead?.preferred_time
    ? customerCallTime(c, [aiResult.lead.preferred_time])
    : null;
  if (statedTime) {
    action = 'CAPTURE_TIME';
    args = { ...args, time_text: statedTime };
  }
  // The role-play setup never produces a real call request (G6): a time in the example's facts
  // («الطلبات بكرا الساعة 11») is not the prospect's preferred time.
  if (inSandbox(c) && (action === 'CAPTURE_TIME' || (action === 'FLAG_FOR_TEAM' && rawArgs.reason === 'meeting'))) {
    action = 'NONE';
  }
  if (!reply && !prefix && !['OPT_OUT', 'NOT_NOW', 'HANDOFF_TO_HUMAN'].includes(action)) return finish(aiFailureResult(c));

  switch (action) {
    case 'FLAG_FOR_TEAM': {
      const reason = FLAG_REASONS.includes(args.reason) ? args.reason : 'unknown';
      if (reason === 'meeting') {
        const preview = mergeLead(lead, leadPatch || {}, leadMeta).lead;
        // A time the customer wrote now, or the slot they tapped before; never the model's own time_text.
        const said = customerCallTime(c, [rawArgs.time_text, aiResult.lead?.preferred_time]);
        const tapped = tappedTime(lead);
        const timeText = said || (tapped && preferredTimeText(tapped));
        if (timeText && (preview.name || preview.business_name)) {
          const slot = tapped && (!said || normalize(tapped.text || '') === normalize(said)) ? tapped : undefined;
          return finish(captureResult(c, { preferredTime: slot, timeText, modelLine: shown, modelReply: reply, leadPatch }));
        }
      }
      const summary = String(args.summary || c.joinedText).slice(0, 200);
      const candidate = needsTeamEntry(reason, summary, at);
      const needs = mergeNeedsTeam(wd.needs_team, candidate);
      const stateUpdate = stateWith({ status: 'pending', current_state: nextStage(stageForNext, aiResult.stage, action, locked) });
      if (!needs) {
        // Already on the team's list with an equal or higher priority: no second ack, no second alert.
        // The candidate still goes to the write: if staff resolved that request meanwhile, this one is
        // recorded instead of leaving the conversation pending with nothing open (GPT-6 #13).
        return finish(emptyResult({ action, messages: [mtext()], stateUpdate, needsTeamCandidate: candidate }));
      }
      return finish(emptyResult({
        action,
        messages: [mtext(acks.flagAck(reason === 'quote' ? 'quote' : 'other', { teamHours: c.teamHours, lang: c.lang }))],
        stateUpdate,
        workflowDataPatch: { needs_team: needs },
        needsTeam: needs,
        needsTeamCandidate: candidate,
        alert: { reason: reason === 'quote' ? 'quote' : 'needs_team', summary },
      }));
    }

    case 'HANDOFF_TO_HUMAN': {
      if (handoff.isHandoffOpen(c.conversation)) {
        const messages = [shown ? mtext() : textMessage(acks.handoffRepeat(c.lang))];
        return finish(emptyResult({ kind: 'handoff', action, messages }));
      }
      const line = firstLine(reply);
      const r = handoff.buildHandoff({
        business: c.business,
        conversation: c.conversation,
        now: c.now,
        lang: c.lang,
        teamHours: c.teamHours,
        reason: rawArgs.reason === 'person' ? 'person' : 'complaint',
        tier: 2,
        summary: rawArgs.summary || c.joinedText,
        modelLine: line || acks.handoffLead(c.lang),
      });
      if (line && r.messages[0] && r.stateUpdate.current_state === 'handoff') {
        const ack = r.messages[0].text.startsWith(`${line}\n\n`) ? r.messages[0].text.slice(line.length + 2) : '';
        r.messages[0] = withMeta({ ...r.messages[0] }, line, ack, line);
      }
      return finish(r);
    }

    case 'CAPTURE_TIME': {
      // The model's time_text is a proposal: only the customer's own words (or a tap, in buttons.js) set a time.
      const timeText = customerCallTime(c, [args.time_text, aiResult.lead?.preferred_time]);
      // Agreeing to a call without naming a time: the slot buttons (or the day/time ask), nothing stored.
      if (!timeText) return finish(callTimeAskResult(c, { shown, reply, locked, leadPatch }));
      // Re-stating the stored time keeps the stored object (a tapped slot's start/end/slot_id).
      const sameTime = timeText && isPlainObject(lead.preferred_time)
        && normalize(lead.preferred_time.text || '') === normalize(timeText);
      if (timeText) leadPatch = { ...(leadPatch || {}), preferred_time: sameTime ? lead.preferred_time : timeText };
      const preview = mergeLead(lead, leadPatch || {}, leadMeta).lead;
      if (timeText && (preview.name || preview.business_name)) {
        const slot = sameTime && lead.preferred_time.start ? lead.preferred_time : undefined;
        return finish(captureResult(c, { preferredTime: slot, timeText, modelLine: shown, modelReply: reply, leadPatch }));
      }
      const message = /[؟?]/.test(shown)
        ? mtext()
        : textMessage(acks.captureAsk({ nameKnown: !!preview.name, businessKnown: !!preview.business_name, sector: preview.sector, lang: c.lang }));
      return finish(emptyResult({
        action,
        messages: [message],
        stateUpdate: locked ? {} : { current_state: 'close' },
        workflowDataPatch: { capture_pending: { slot_id: null, time_text: timeText || null, at } },
        leadPatch,
      }));
    }

    case 'NOT_NOW':
      return finish(emptyResult({
        action,
        messages: [shown ? mtext() : textMessage(acks.notNow(c.lang))],
        stateUpdate: { current_state: 'closed' },
        workflowDataPatch: { not_now_at: at, followups: [], capture_pending: null },
      }));

    case 'OPT_OUT':
      return finish(emptyResult({
        kind: 'optout',
        action,
        messages: [textMessage(acks.optOut(c.lang))],
        stateUpdate: { current_state: 'closed' },
        workflowDataPatch: { marketing_opted_out_at: at, followups: [], capture_pending: null },
      }));

    default: {
      const proposed = nextStage(stageForNext, aiResult.stage, 'NONE', locked);
      const stateUpdate = stateWith({ current_state: proposed === undefined && stageForNext !== stage ? stageForNext : proposed });
      const workflowDataPatch = {};
      if (stateUpdate.current_state === 'roleplay_setup' && stage !== 'roleplay_setup') {
        // «جرّبني» or a customer-role question: the model asked for the setup itself, and that ask counts
        // toward the name-only start (§3.2). The ask is the same fixed line the tap sends (design §4 Layer
        // 3), so the example never depends on the model naming the right facts (eval #14).
        const sector = sampleSector(lead.sector);
        workflowDataPatch.roleplay = buttons.roleplayObject(wd.roleplay, { sector, setup_asks: 1 });
        return finish(emptyResult({ action: 'NONE', messages: [setupAskPart(shown, reply, sector, c.lang)], stateUpdate, workflowDataPatch }));
      }

      // Concierge while the team's request is open (design §3.1/§7.1): no slot buttons, no pitch.
      const kept = locked || inSandbox(c) ? [] : sanitizeButtons(aiResult.buttons, c.offers);

      // [أكيد][لا] under the +2 d follow-up ask, after a declined call (eval #11). Server titles.
      const consent = !kept.length && !locked && !inSandbox(c)
        && context.consentAllowed({ stage: stateUpdate.current_state ?? stage, wd })
        && sanitizeButtons(aiResult.buttons, acks.consentButtons(c.lang)).length
        ? acks.consentButtons(c.lang)
        : [];
      if (consent.length) {
        const body = compose(shown, '', INTERACTIVE_LIMIT);
        return finish(emptyResult({
          action: 'NONE',
          messages: [withMeta({ type: 'interactive', text: body, buttons: consent }, shown, '', reply)],
          stateUpdate,
          workflowDataPatch,
        }));
      }

      // §9.2 step 8: a bare greeting from someone we know nothing about gets the sector list. Slot
      // buttons the model chose (a time was asked for) win over it.
      const sectorKnown = !!(lead.sector || aiResult.lead?.sector);
      const firstReply = !wd.bot_turns && (!stage || stage === 'opening');
      if (firstReply && !kept.length && !prefill && !locked && !sectorKnown && !inSandbox(c) && isBareGreetingBatch(c)) {
        const body = compose(shown, '', INTERACTIVE_LIMIT);
        const list = acks.sectorListPart(c.lang, { text: body, disclosed: !!wd.disclosed_at });
        return finish(emptyResult({ action: 'NONE', messages: [withMeta(list, body, '', reply)], stateUpdate, workflowDataPatch }));
      }
      if (kept.length) {
        const body = compose(shown || acks.slotsBody(c.lang), '', INTERACTIVE_LIMIT);
        return finish(emptyResult({
          action: 'NONE',
          messages: [withMeta({ type: 'interactive', text: body, buttons: kept }, shown, '', reply)],
          stateUpdate,
          workflowDataPatch: { ...workflowDataPatch, slot_offers: kept.map((o) => ({ ...o, issued_at: at })) },
        }));
      }
      return finish(emptyResult({ action: 'NONE', messages: [mtext()], stateUpdate, workflowDataPatch }));
    }
  }
}

/** §9.2 step 2. Returns null when the sample cannot run (then the model line goes out as NONE). */
function sendSampleResult(c, { rawArgs, args, reply, mtext, shown, lead, at, stage }) {
  const wd = c.wd;
  if (roleplay.isActive(wd)) return null;
  const raw = typeof rawArgs.sector === 'string' && rawArgs.sector.trim() ? args.sector : null;
  const sector = sampleSector(raw || lead.sector);
  const samples = buttons.samplesSent(wd);
  const lineParts = reply ? [mtext()] : [];

  if (c.vetted.has(sector)) {
    if (samples.image === sector) {
      // One image per sector: the second ask gets the model line (or a pointer to the first one).
      return emptyResult({
        action: 'SEND_SAMPLE',
        messages: reply ? lineParts : [textMessage(acks.sampleAlreadySent(c.lang))],
        stateUpdate: stateWith({ current_state: nextStage(stage, 'sample', 'NONE') }),
      });
    }
    // The card body ends in its own question: the model line before it keeps only its statements (G9).
    const statements = statementsOnly(shown);
    const cardLine = reply && statements ? [textMessage(statements, '', statementsOnly(reply) || statements)] : [];
    return emptyResult({
      action: 'SEND_SAMPLE',
      messages: [...cardLine, assets.sampleCard(sector, c.lang, { sectorText: lead.sector_text, roleplayOn: c.roleplayOn })],
      stateUpdate: { current_state: nextStage(stage, null, 'SEND_SAMPLE') },
      workflowDataPatch: { samples_sent: { ...samples, image: sector, accepted_at: samples.accepted_at || at } },
    });
  }

  if (c.roleplayOn) {
    // D11: no vetted image yet — the example on the prospect's own business instead.
    const prev = wd.roleplay && typeof wd.roleplay === 'object' ? wd.roleplay : null;
    const asks = c.conversation.current_state === 'roleplay_setup' ? (Number(prev?.setup_asks) || 0) + 1 : 1;
    return emptyResult({
      action: 'SEND_SAMPLE',
      // The fixed setup ask is the one question: the model's own questions go (as on the default path).
      messages: [setupAskPart(shown, reply, sector, c.lang)],
      stateUpdate: { current_state: 'roleplay_setup' },
      workflowDataPatch: {
        roleplay: buttons.roleplayObject(prev, { sector, setup_asks: asks }),
        samples_sent: { ...samples, accepted_at: samples.accepted_at || at },
      },
    });
  }

  return emptyResult({
    action: 'SEND_SAMPLE',
    messages: [...lineParts, assets.pagePart(sector, c.lang)],
    stateUpdate: { current_state: nextStage(stage, null, 'SEND_SAMPLE') },
    workflowDataPatch: { samples_sent: { ...samples, page: sector, accepted_at: samples.accepted_at || at } },
  });
}

// The example's business name is the customer's own text echoed in a SHIFT-branded server line: no links,
// no prices or discounts («اسم المطعم: www.x.co خصم 50%»), one short line.
const NAME_STOP_RE = /[\d٠-٩۰-۹%٪:：|\n]|https?:|www\.|خصم|عرض|تخفيض|مجان|ببلاش|discount|offer|free\b|\bdeal\b/i;
const EXAMPLE_NAME_MAX = 40;

function exampleBusinessName(value) {
  if (typeof value !== 'string') return value;
  const noLinks = validators.filterLinks(value).text;
  const stop = noLinks.search(NAME_STOP_RE);
  const head = (stop >= 0 ? noLinks.slice(0, stop) : noLinks).replace(/[«»"“”<>]/g, '').replace(/\s+/g, ' ').trim()
    .replace(/[\s،,.\-–—]+$/, '');
  return cutCodePoints(head, EXAMPLE_NAME_MAX).trim();
}

/**
 * Two setup asks and still nothing to build the example on: stop asking. The customer is told once, the
 * team gets the thread, and the stage leaves roleplay_setup so the next turn is an ordinary one.
 */
function roleplaySetupHandover(c, sector, prev, at) {
  const candidate = needsTeamEntry('demo', `تعذّر تجهيز المثال التوضيحي (${sector}) بعد طلبين`, at);
  const needs = mergeNeedsTeam(c.wd.needs_team, candidate);
  return emptyResult({
    action: 'START_ROLEPLAY',
    messages: [textMessage(acks.roleplaySetupGaveUp(c.lang))],
    stateUpdate: { current_state: 'fit', status: 'pending' },
    workflowDataPatch: {
      roleplay: buttons.roleplayObject(prev, { sector, setup_asks: roleplay.MAX_SETUP_ASKS, end_reason: 'setup_failed' }),
      ...(needs ? { needs_team: needs } : {}),
    },
    needsTeam: needs,
    needsTeamCandidate: candidate,
    alert: { reason: 'needs_team', summary: candidate.summary },
  });
}

/** The texts of THIS turn only — the answer to the setup ask, before any older message. */
function batchTextsOf(c) {
  const out = [];
  for (const m of c.batchMessages) {
    if (typeof m.text_body === 'string' && m.text_body.trim()) out.push(m.text_body);
    const sm = shiftMediaOf(m, c);
    if (sm && sm.status === 'ok' && typeof sm.text === 'string' && sm.text.trim()) out.push(sm.text);
  }
  return out;
}

/** §9.2 step 3. Returns null for wrong_stage / disabled (then NONE with the model line). */
function startRoleplayResult(c, { rawArgs, args, reply, shown, lead, at }) {
  const wd = c.wd;
  const prev = wd.roleplay && typeof wd.roleplay === 'object' ? wd.roleplay : null;
  // normalizeActionArgs maps a missing sector to `other`; the setup's sector wins over that default.
  const hasSector = typeof rawArgs.sector === 'string' && rawArgs.sector.trim();
  // Only numbers the customer typed survive in the facts (review r2 #2): an invented price there would be an
  // allowed number inside the example, against the start line's «بستخدم بس اللي كتبته إنت».
  const texts = customerTextsOf(c);
  const batchTexts = batchTextsOf(c);
  // Round-2 review #1: the model left business_name null on every START_ROLEPLAY in the six sims, so the
  // example never opened for a customer who had already typed her clinic's name, services and hours. The
  // name is hers, not the model's — read it back from her own words (then from what we already stored).
  const typedName = exampleBusinessName(roleplay.businessNameFrom(batchTexts));
  const businessName = exampleBusinessName(args.business_name)
    || typedName
    || exampleBusinessName(prev && prev.business_name)
    || exampleBusinessName(lead.business_name)
    || exampleBusinessName(roleplay.businessNameFrom(texts));
  let facts = roleplay.groundFacts(args.facts, texts);
  // Only from a turn that IS the answer to the setup ask — one that named the business. «تمام» on its
  // own is not a menu, and a stray line must never become a fact the example then quotes back.
  if (!facts.length && typedName) facts = roleplay.groundFacts(roleplay.factsFrom(batchTexts, typedName), texts);
  const startArgs = {
    ...args,
    sector: hasSector ? args.sector : undefined,
    business_name: businessName,
    facts,
  };
  const check = roleplay.canStart(c.conversation, startArgs);
  const sector = sampleSector(startArgs.sector || prev?.sector || lead.sector);

  if (!check.ok && (check.reason === 'no_facts_first_ask' || check.reason === 'no_name')) {
    const ask = roleplay.setupAsk(sector, c.lang);
    // Never the same ask twice (round-2 review #1): the customer already answered it once, and repeating
    // it word for word is what made the sims loop. With a name, open the example on the name alone.
    const repeat = !!(prev && prev.last_setup_ask === ask);
    if (!repeat) {
      // The model line is dropped: the fixed ask names exactly what the example needs.
      return emptyResult({
        action: 'START_ROLEPLAY',
        messages: [textMessage(ask)],
        stateUpdate: { current_state: 'roleplay_setup' },
        workflowDataPatch: {
          roleplay: buttons.roleplayObject(prev, {
            sector, setup_asks: (Number(prev?.setup_asks) || 0) + 1, last_setup_ask: ask,
          }),
        },
      });
    }
    if (!startArgs.business_name) return roleplaySetupHandover(c, sector, prev, at);
  } else if (!check.ok && check.reason === 'no_name_final') {
    return roleplaySetupHandover(c, sector, prev, at);
  } else if (!check.ok) {
    return null;
  }

  const state = roleplay.startState({ ...startArgs, sector }, c.now, prev);
  const start = roleplay.startLine(state.business_name, c.lang);
  const message = reply
    ? { type: 'text', text: compose(start, shown, TEXT_LIMIT), modelLine: reply, ack: start }
    : { type: 'text', text: start };
  const r = emptyResult({
    action: 'START_ROLEPLAY',
    messages: [message],
    stateUpdate: { current_state: nextStage(c.conversation.current_state, null, 'START_ROLEPLAY') },
    workflowDataPatch: { roleplay: state },
  });
  if (!lead.business_name && state.business_name && customerWrote(state.business_name, texts)) {
    // The only lead write from the sandbox (G6). mergeLead has no provenance hook, so the meta source
    // itself is `roleplay_setup`: _prov.business_name.source records it, and customer_numbers are not
    // taken from menu prices (§14 #6).
    r.leadPatch = { business_name: state.business_name };
    r.leadMeta = { source: 'roleplay_setup', provSource: 'roleplay_setup', msgId: c.newest?.id ?? null, at, inboundText: '', trusted: [] };
  }
  return r;
}

/**
 * Round-2 review #2: the real slot offer, in place of a line that named an appointment the server never
 * made. The customer asked about a time; they get the team's actual times, not a generic apology.
 */
function slotOfferResult(ctx, base) {
  const c = fillCtx(ctx);
  const r = callTimeAskResult(c, { shown: '', reply: '', locked: isStageLocked(c.conversation), leadPatch: null });
  if (!r) return null;
  const keep = base && typeof base === 'object' ? base : {};
  return {
    ...r,
    // The state, acks and alerts the blocked result had already earned stay; only its words go.
    needsTeam: keep.needsTeam ?? r.needsTeam,
    needsTeamCandidate: keep.needsTeamCandidate ?? r.needsTeamCandidate,
    alert: keep.alert ?? r.alert,
  };
}

/**
 * The END result for index.js's deterministic exit (§10.1 step 3): the whole batch was «خلص».
 * Same shape as an END_ROLEPLAY with an empty model line.
 */
function roleplayEndResult(ctx) {
  return toWorkflowResult({ reply: '', action: 'END_ROLEPLAY', action_args: {} }, ctx);
}

module.exports = {
  blockedReplyResult,
  NEEDS_TEAM_PRIORITY,
  MEDIA_TYPES,
  mergeNeedsTeam,
  needsTeamEntry,
  sanitizeButtons,
  nextStage,
  isStageLocked,
  captureResult,
  renderCaptureAck,
  customerCallTime,
  toWorkflowResult,
  roleplayEndResult,
  slotOfferResult,
  compose,
};
