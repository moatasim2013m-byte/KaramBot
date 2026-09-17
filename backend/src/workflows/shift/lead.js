'use strict';

/**
 * SHIFT lead record — Conversation.workflow_data.lead.
 *
 * mergeLead is pure so the workflow can preview a merge without touching the DB; saveLead is the only
 * writer and goes through db/jsonb so the rest of workflow_data (needs_team, slot offers, …) written by
 * other code paths is never overwritten. Concurrency is optimistic: lead.version is checked in the
 * UPDATE's WHERE clause and a lost race re-reads and merges once.
 *
 * Trust model: the model's extraction is a guess, a button tap or staff edit is not. A value the
 * customer stated (confirmed) is only replaced by an explicit correction («مش عمّان، إربد»), and a
 * staff edit is never replaced by the bot.
 */

const prisma = require('../../config/prisma');
const jsonb = require('../../db/jsonb');

const LEAD_SCALARS = ['name', 'business_name', 'sector', 'sector_text', 'city', 'preferred_time', 'language', 'budget_note', 'interest', 'source'];
const LEAD_ARRAYS = ['need', 'products', 'objections', 'customer_numbers', 'site_estimates'];
const SECTORS = ['clinic', 'restaurant', 'store', 'other'];
const PRODUCT_KEYS = ['karam', 'loyalty', 'bookings', 'subscriptions', 'attendance', 'marketing', 'erp', 'custom'];
const OBJECTION_KEYS = ['price', 'staff', 'ai_errors', 'customers', 'small', 'later', 'references', 'other'];
const LANGUAGES = ['ar', 'en'];
const INTERESTS = ['hot', 'warm', 'cold'];

const MAX_TEXT = 200;
const ARRAY_CAPS = { need: 5, objections: 10, products: 8, customer_numbers: 20 };
const TEXT_SCALARS = ['name', 'business_name', 'sector_text', 'city', 'budget_note'];
const PREFERRED_TIME_KEYS = ['text', 'start', 'end', 'tz', 'slot_id'];
const SOURCE_KEYS = ['type', 'attribution', 'referral', 'confidence'];

const CORRECTION_RE = /(^|[\s،,])(مش|مو|لا|لأ|not|no)\s|قصدي|بالغلط|صحّح|صحح|I meant|actually/i;

// Code-point aware cut so an Arabic or emoji character is never split in half.
function cut(str, max = MAX_TEXT) {
  const chars = Array.from(str);
  return chars.length > max ? chars.slice(0, max).join('') : str;
}

/**
 * Round-2 review #4: the model's own instruction text was stored in a lead field and rendered into the
 * team's calendar event —
 *   sector_text = "مطعم منديFilter Context Requirements: Valid JSON only, strict schema mapping, …"
 * — in 3 of the six 2026-09-17 runs. Every free-text field the model fills goes through here first: a
 * lead value is one line of something a customer typed, nothing else.
 */
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u2028\u2029\uFEFF]/g;
// Where the model stopped answering and started reciting its own instructions. The value is cut here.
const INSTRUCTION_RE = /\b(?:valid\s+json|json\s+(?:only|output|format)|strict\s+schema|schema\s+mapping|output\s+format|single\s+quote|surrounding\s+extra\s+text|extra\s+text|context\s+requirements?|requirements?\s*:|system\s+prompt|assistant\s*:|as\s+required|parsed?\s+as|plain\s+text\s+output|no\s+extra\s+text|do\s+not\s+include|respond\s+with|instructions?\s*:|action_args|next_step|action\s*:|reply\s*:|null\s*,|\bstring\b\s*,)/i;
// Field-level caps: a business's kind, name or city is a handful of words, not a paragraph.
const SCALAR_MAX = { name: 60, business_name: 80, sector_text: 60, city: 40, budget_note: 80 };

function sanitizeFreeText(value, max = MAX_TEXT) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  let s = String(value).replace(CONTROL_RE, ' ');
  // One line: a lead scalar that grew a second line grew it from the model, not the customer.
  s = s.split(/[\r\n]/)[0];
  const m = INSTRUCTION_RE.exec(s);
  if (m) {
    // Keep what came before the boilerplate, back to the last word boundary («مطعم مندي» out of
    // «مطعم منديFilter Context Requirements: …»).
    s = s.slice(0, m.index).trimEnd().replace(/[A-Za-z]+$/, '');
  }
  // «مطعم منديFilter»: a Latin run welded to the end of an Arabic value is the seam of a concatenation,
  // never a name someone typed.
  s = s.replace(/(?<=[\u0621-\u064A])[A-Za-z]+$/, '');
  s = s.replace(/\s{2,}/g, ' ').trim().replace(/[\s،,:;|\-–—]+$/, '');
  if (!s) return undefined;
  // Still reciting after the cut, or no letter at all: it is not something a customer typed.
  if (INSTRUCTION_RE.test(s)) return undefined;
  if (!/[\p{L}]/u.test(s)) return undefined;
  const out = cut(s, max);
  return out ? out : undefined;
}

function cleanText(value, max = MAX_TEXT) {
  return sanitizeFreeText(value, max);
}

/**
 * Comparison form for de-duplication and correction matching. Beyond trim/collapse/lowercase it drops
 * Arabic diacritics and tatweel: customers write «عمّان» and «عمان» interchangeably.
 */
function normalize(str) {
  return String(str == null ? '' : str)
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isEmpty(value) {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function sameValue(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return normalize(a) === normalize(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

function pickObject(obj, keys) {
  const out = {};
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || v === null || v === '') continue;
    out[k] = typeof v === 'string' ? cut(v.trim()) : v;
    if (out[k] === '') delete out[k];
  }
  return out;
}

function stringList(value) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((v) => cleanText(v)).filter(Boolean);
}

/** Rule 1: bring a raw patch (model JSON, button, staff form) into the stored shape; invalid values drop. */
function normalizePatch(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;

  for (const field of TEXT_SCALARS) {
    const v = cleanText(patch[field], SCALAR_MAX[field] || MAX_TEXT);
    if (v !== undefined) out[field] = v;
  }

  if (typeof patch.sector === 'string' && SECTORS.includes(patch.sector.trim().toLowerCase())) {
    out.sector = patch.sector.trim().toLowerCase();
  }
  if (typeof patch.language === 'string' && LANGUAGES.includes(patch.language.trim().toLowerCase())) {
    out.language = patch.language.trim().toLowerCase();
  }
  if (typeof patch.interest === 'string' && INTERESTS.includes(patch.interest.trim().toLowerCase())) {
    out.interest = patch.interest.trim().toLowerCase();
  }

  if (typeof patch.preferred_time === 'string') {
    const text = cleanText(patch.preferred_time);
    if (text) out.preferred_time = { text };
  } else if (patch.preferred_time && typeof patch.preferred_time === 'object' && !Array.isArray(patch.preferred_time)) {
    const pt = pickObject(patch.preferred_time, PREFERRED_TIME_KEYS);
    if (!isEmpty(pt)) out.preferred_time = pt;
  }

  if (patch.source && typeof patch.source === 'object' && !Array.isArray(patch.source)) {
    const src = pickObject(patch.source, SOURCE_KEYS);
    if (!isEmpty(src)) out.source = src;
  }

  const need = stringList(patch.need);
  if (need.length) out.need = need;

  const products = stringList(patch.products).map((p) => p.toLowerCase()).filter((p) => PRODUCT_KEYS.includes(p));
  if (products.length) out.products = products;

  // The model emits a singular `objection` per turn; staff send the whole list. Both are enum keys.
  const objections = stringList(patch.objections)
    .concat(stringList(patch.objection))
    .map((o) => o.toLowerCase())
    .filter((o) => OBJECTION_KEYS.includes(o));
  if (objections.length) out.objections = objections;

  // customer_numbers and site_estimates are deliberately never taken from a patch (rule 4).
  return out;
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = normalize(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function capList(field, list) {
  const cap = ARRAY_CAPS[field];
  return cap ? list.slice(0, cap) : list;
}

/**
 * Numbers the customer typed. The PR2 digit guard only lets the bot repeat these, so they come from
 * inbound text only — never from what the model claims it heard.
 */
function extractCustomerNumbers(text) {
  if (typeof text !== 'string' || !text) return [];
  const western = text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
  const matches = western.match(/\d+(?:[.,]\d+)?/g) || [];
  return Array.from(new Set(matches.map(String)));
}

/**
 * Round-2 review #9: «بكرا الساعة 4 العصر» put "4" in customer_numbers, and the digit guard then let the
 * bot quote 4 back as one of the customer's business figures. A clock time is not a figure about the
 * business, so the spans that read as times of day are removed before the numbers are harvested.
 */
const CLOCK_SPAN_RE = new RegExp([
  '(?:الساعة|الساعه)\\s*\\d{1,2}(?:\\s*[:٫.]\\s*\\d{2})?',
  '\\d{1,2}\\s*[:]\\s*\\d{2}',
  '\\d{1,2}\\s*(?:الصبح|الصباح|المسا|المساء|مساءً|مساء|صباحًا|صباحا|الظهر|العصر|الليل|am|pm|a\\.m\\.|p\\.m\\.)',
  '\\bat\\s+\\d{1,2}\\b',
  // A window: «بين 10 و12», "between 10 and 12" — both ends are clock times.
  '(?:بين|between)\\s*\\d{1,2}\\s*(?:و|and|-|–)\\s*\\d{1,2}',
  '\\d{1,2}\\s*(?:-|–|إلى|الى|ل)\\s*\\d{1,2}\\s*(?:الصبح|الصباح|المسا|المساء|الظهر|العصر)',
].join('|'), 'gi');

// «ممكن نخليها الساعة ٢ الظهر بدل ١١؟» — the 11 has no clock word of its own, but it is the hour it
// replaces. Only inside a message that is already talking about a clock time (sim round 2, clinic).
const CLOCK_MARKER_RE = /الساعة|الساعه|الصبح|الصباح|المسا|المساء|الظهر|العصر|\d\s*[:]\s*\d{2}|\bam\b|\bpm\b|\bo'clock\b/i;
const REPLACED_HOUR_RE = /(?:بدل|بدال|بدلا|بدلًا(?:\s*من)?|عوضا عن|عوضًا عن|instead of)\s*(?:ال)?\s*\d{1,2}(?![\d])/gi;

/** The customer's numbers with the clock times taken out (rule 4 + review #9). */
function businessNumbersOf(text) {
  if (typeof text !== 'string' || !text) return [];
  const western = text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
  let stripped = western.replace(CLOCK_SPAN_RE, ' ');
  if (CLOCK_MARKER_RE.test(western)) stripped = stripped.replace(REPLACED_HOUR_RE, ' ');
  return extractCustomerNumbers(stripped);
}

/** True only when the customer explicitly corrects a value in this message and names the new one. */
function isCorrection(text, newValue) {
  if (typeof text !== 'string' || !text) return false;
  let value = newValue;
  if (value && typeof value === 'object') value = value.text;
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const needle = normalize(value);
  if (!needle) return false;
  return normalize(text).includes(needle) && CORRECTION_RE.test(text);
}

/** PR1 score deltas (design §6); role-play and reply-speed deltas arrive in PR2. */
function computeScore(lead = {}, workflowData = {}) {
  const l = lead || {};
  const wd = workflowData || {};
  let score = 0;
  if (wd.needs_team?.reason === 'quote' || (Array.isArray(l.objections) && l.objections.includes('price'))) score += 3;
  if (l.preferred_time?.text || l.preferred_time?.start) score += 3;
  if (l.business_name) score += 2;
  if (l.source?.type === 'ctwa') score += 1;
  if (wd.not_now_at) score -= 2;
  if (wd.marketing_opted_out_at) score -= 5;
  return score;
}

function provFor(meta) {
  if (meta.source === 'staff') {
    return { source: 'staff', source_msg_id: null, at: meta.at, confirmed: true };
  }
  return { source: meta.source, source_msg_id: meta.msgId, at: meta.at, confirmed: meta.source !== 'referral' };
}

function mayWriteScalar(field, existing, value, meta) {
  const prov = existing._prov?.[field];
  const current = existing[field];

  if (meta.source === 'staff') {
    // Re-saving the same value still records staff ownership so the bot cannot change it later.
    return !sameValue(current, value) || prov?.source !== 'staff';
  }
  if (prov?.source === 'staff') return false;
  if (sameValue(current, value)) return false;
  // The caller acks this field back to the customer («سجّلت طلب مكالمة: …الخميس الساعة 5»), so it is
  // an explicit statement, not a guess (attribution is never trusted this way).
  if (field !== 'source' && Array.isArray(meta.trusted) && meta.trusted.includes(field)) return true;
  // First touch wins for attribution: a later referral or guess never rewrites where the lead came from.
  if (field === 'source') return isEmpty(current);
  if (isEmpty(current)) return true;
  if (prov?.confirmed === false) return true;
  // A button tap is the customer's own explicit choice (e.g. picking a different slot).
  if (meta.source === 'button') return true;
  return isCorrection(meta.inboundText, value);
}

/**
 * Pure merge. Returns a new lead object (existing is not mutated) and the list of fields that changed.
 * `version` is bumped once when anything changed; `score` is left to the caller (it needs workflow_data).
 */
function mergeLead(existing = {}, patch = {}, meta) {
  const base = existing && typeof existing === 'object' ? existing : {};
  const m = {
    source: 'model',
    msgId: null,
    at: new Date().toISOString(),
    inboundText: '',
    ...(meta || {}),
  };
  if (m.msgId === undefined) m.msgId = null;
  if (typeof m.inboundText !== 'string') m.inboundText = '';

  const lead = JSON.parse(JSON.stringify(base));
  const prov = { ...(lead._prov || {}) };
  const changed = [];
  const normalized = normalizePatch(patch);

  for (const field of LEAD_SCALARS) {
    const value = normalized[field];
    if (isEmpty(value)) continue;
    if (!mayWriteScalar(field, base, value, m)) continue;
    lead[field] = value;
    prov[field] = provFor(m);
    changed.push(field);
  }

  for (const field of ['need', 'products', 'objections']) {
    const incoming = normalized[field];
    if (isEmpty(incoming)) continue;
    const current = Array.isArray(base[field]) ? base[field] : [];
    const next = m.source === 'staff'
      ? capList(field, dedupe(incoming))
      : capList(field, dedupe(current.concat(incoming)));
    if (JSON.stringify(next) === JSON.stringify(current)) continue;
    lead[field] = next;
    prov[field] = provFor(m);
    changed.push(field);
  }

  if (m.source === 'model' || m.source === 'button') {
    const numbers = businessNumbersOf(m.inboundText);
    if (numbers.length) {
      const current = Array.isArray(base.customer_numbers) ? base.customer_numbers : [];
      const next = capList('customer_numbers', dedupe(current.concat(numbers)));
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        lead.customer_numbers = next;
        prov.customer_numbers = provFor(m);
        changed.push('customer_numbers');
      }
    }
  }

  if (changed.length > 0) {
    lead._prov = prov;
    lead.version = (Number.isInteger(base.version) ? base.version : 0) + 1;
  }
  return { lead, changed };
}

/**
 * Read → merge → version-guarded write. The model/button path retries once on a lost race (a
 * concurrent writer bumped the version); a staff edit passes expectedVersion and gets `conflict`
 * instead, so the Inbox can show the fresh lead rather than silently merging over it.
 * Never throws on a conflict; DB errors propagate.
 */
async function saveLead(conversationId, patch, meta, { expectedVersion } = {}) {
  const m = { at: new Date().toISOString(), ...(meta || {}) };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const row = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { workflow_data: true },
    });
    const wd = (row && row.workflow_data) || {};
    const cur = wd.lead || {};
    const curVersion = cur.version || 0;

    if (expectedVersion !== undefined && curVersion !== expectedVersion) {
      return { ok: false, conflict: true, lead: cur, changed: [] };
    }

    const { lead, changed } = mergeLead(cur, patch, m);
    if (!changed.length) {
      return { ok: true, lead: cur, changed: [], previousScore: cur.score || 0 };
    }
    lead.score = computeScore(lead, wd);

    const r = await jsonb.patchJson('conversations', conversationId, 'workflow_data', { lead }, { ifVersion: curVersion });
    if (r.ok) return { ok: true, lead, changed, previousScore: cur.score || 0 };
    if (expectedVersion !== undefined) {
      return { ok: false, conflict: true, lead: cur, changed: [] };
    }
  }

  console.warn('[lead] version conflict twice', conversationId);
  return { ok: false, lead: null, changed: [] };
}

module.exports = {
  mergeLead,
  extractCustomerNumbers,
  businessNumbersOf,
  sanitizeFreeText,
  isCorrection,
  computeScore,
  saveLead,
  normalize,
  LEAD_SCALARS,
  LEAD_ARRAYS,
  SECTORS,
  PRODUCT_KEYS,
  OBJECTION_KEYS,
};
