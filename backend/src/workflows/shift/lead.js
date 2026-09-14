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

function cleanText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const s = cut(String(value).trim());
  return s ? s : undefined;
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
  return list.map(cleanText).filter(Boolean);
}

/** Rule 1: bring a raw patch (model JSON, button, staff form) into the stored shape; invalid values drop. */
function normalizePatch(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;

  for (const field of TEXT_SCALARS) {
    const v = cleanText(patch[field]);
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
    const numbers = extractCustomerNumbers(m.inboundText);
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
