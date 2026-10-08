/**
 * What happened to an account, and who did it (AccountEvent, docs/panels/spec.md «Schema changes»).
 *
 * One table serves three readers: the account's «السجل» tab, the history of Meta connect attempts
 * on the onboarding board, and «ما عرف يجاوب» (open bot_handoff rows, resolved when answered).
 *
 * Recording is a side effect of something that already happened (a payment saved, a number
 * connected), so record() never throws: a missing log line must not undo or fail the action it
 * describes. It logs and returns null instead. Use toRow() inside a transaction when the event has
 * to commit or roll back with the action.
 *
 * Nothing secret goes into `data`: keys that name a token, PIN, password, secret or code are
 * dropped wherever they appear, and values shaped like a Meta access token or a JWT are redacted.
 * The table is shown to staff and, for some types, to the shop.
 */

const prisma = require('../config/prisma');

const ACTOR_KINDS = ['owner', 'staff', 'shift', 'system', 'meta'];

// The types the spec names. Listed for reference and for the panels' labels; record() accepts any
// type so a new one does not need this file changed.
const TYPES = [
  'invite_created', 'invite_shared', 'join_opened', 'password_set', 'invite_expired', 'invite_cancelled',
  'es_started', 'es_cancelled', 'es_failed', 'es_conflict', 'es_ownership_mismatch', 'es_connected',
  'wrong_number', 'partner_added_unmatched', 'partner_removed', 'meta_restriction', 'token_invalid',
  'payment_claimed', 'payment_confirmed', 'payment_blocked', 'knowledge_added', 'went_live',
  'bot_handoff', 'bot_paused', 'bot_resumed', 'cap_80', 'cap_reached', 'payment_recorded',
  'user_added', 'role_changed', 'login_reset', 'settings_changed', 'platform_setting_changed',
];

const SECRET_WORDS = new Set([
  'token', 'tokens', 'pin', 'password', 'passwd', 'passcode', 'secret', 'code', 'otp',
  'apikey', 'authorization', 'cookie',
]);
// "code" also names harmless numbers Meta and HTTP return. These are what the panels show when a
// connect fails, so they are kept; any other *code key is treated as a credential.
const SAFE_KEYS = new Set([
  'error_code', 'error_subcode', 'status_code', 'http_code', 'country_code', 'currency_code', 'language_code',
]);
// A Meta access token (EAA…) or a JWT, wherever it turns up, e.g. inside an error message.
const SECRET_VALUE_RE = /\bEA[A-Za-z0-9]{30,}|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g;

const MAX_DEPTH = 6;
const MAX_STRING = 2000;
const MAX_LIMIT = 200;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

// accessToken, access_token, ACCESS-TOKEN → access_token, then judged by its words.
function isSecretKey(key) {
  const norm = String(key).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const joined = norm.join('_');
  if (SAFE_KEYS.has(joined)) return false;
  if (joined.includes('api_key')) return true;
  return norm.some((w) => SECRET_WORDS.has(w));
}

/** A JSON-safe copy of `value` with secret keys dropped and token-shaped strings redacted. */
function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value === null ? null : undefined;
  if (typeof value === 'string') {
    const clean = value.replace(SECRET_VALUE_RE, '[redacted]');
    return clean.length > MAX_STRING ? `${clean.slice(0, MAX_STRING)}…` : clean;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'object') return undefined; // functions, symbols
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    return value.map((v) => sanitize(v, depth + 1)).map((v) => (v === undefined ? null : v));
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (isSecretKey(k)) continue;
    const clean = sanitize(v, depth + 1);
    if (clean !== undefined) out[k] = clean;
  }
  return out;
}

/**
 * The row to insert, validated. Throws on a bad actor kind or a missing type: for callers that
 * write the event inside their own transaction (tx.accountEvent.create({ data: toRow(e) })).
 */
function toRow({ businessId = null, actorUserId = null, actorKind = 'system', type, data = {} } = {}) {
  if (!ACTOR_KINDS.includes(actorKind)) throw new Error(`unknown actor_kind "${actorKind}"`);
  if (typeof type !== 'string' || !type.trim() || type.length > 64) throw new Error('an event needs a type');
  const clean = isPlainObject(data) ? sanitize(data) : {};
  return {
    business_id: businessId || null,
    actor_user_id: actorUserId || null,
    actor_kind: actorKind,
    type: type.trim(),
    data: clean,
  };
}

/**
 * Record an event. Never throws; returns the created row, or null when it could not be written.
 *
 * @param {object} e
 * @param {string|null} [e.businessId]   null for platform events
 * @param {string|null} [e.actorUserId]
 * @param {'owner'|'staff'|'shift'|'system'|'meta'} [e.actorKind='system']
 * @param {string} e.type
 * @param {object} [e.data]
 * @param {object} [opts]
 * @param {object} [opts.client]  a transaction client to write through instead of prisma
 */
async function record(e = {}, { client } = {}) {
  try {
    const row = toRow(e);
    return await (client || prisma).accountEvent.create({ data: row });
  } catch (err) {
    console.error(`[accountEvents] ${e && e.type} for business=${e && e.businessId} not recorded: ${err.message}`);
    return null;
  }
}

/**
 * Newest first.
 *
 * businessId is required so a tenant route can never list the whole platform by passing
 * undefined: pass a business id, null for platform events, or allBusinesses: true for SHIFT's
 * fleet-wide feed. `before` is the created_at of the last row already shown (paging); an
 * unreadable one is ignored rather than failing the page.
 */
async function list({
  businessId, allBusinesses = false, types, before, limit = 50, unresolved = false,
} = {}) {
  if (businessId === undefined && !allBusinesses) {
    throw new TypeError('accountEvents.list needs businessId (or allBusinesses: true)');
  }
  const where = {};
  if (businessId !== undefined) where.business_id = businessId;
  if (types !== undefined && types !== null) where.type = { in: [].concat(types).map(String) };
  if (before) {
    const d = new Date(before);
    if (!Number.isNaN(d.getTime())) where.created_at = { lt: d };
  }
  if (unresolved) where.resolved_at = null;
  const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), MAX_LIMIT);
  return prisma.accountEvent.findMany({
    where,
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take,
  });
}

/**
 * Mark an event handled (a «ما عرف يجاوب» question answered or dismissed). Returns true when it
 * changed a row. Pass businessId from a tenant route, so an id from another shop matches nothing.
 */
async function resolve(id, { businessId } = {}) {
  if (!id) return false;
  const where = { id: String(id), resolved_at: null };
  if (businessId !== undefined) where.business_id = businessId;
  const { count } = await prisma.accountEvent.updateMany({ where, data: { resolved_at: new Date() } });
  return count > 0;
}

module.exports = { record, list, resolve, toRow, sanitize, isSecretKey, ACTOR_KINDS, TYPES };
