/**
 * SHIFT-wide settings the owner changes without a deploy (PlatformSetting; docs/panels/spec.md and
 * decisions-2026-10-08.md).
 *
 * The defaults live here, in code. An empty platform_settings table is therefore a working
 * platform with every default the decisions doc took, and a stored row only records a deliberate
 * change. get() merges a stored object over its default, so a row written before a new field was
 * added still gets that field's default.
 *
 * Reads are cached in-process for 30 seconds: these are checked on hot paths (every connect
 * request, every AI reply's cost guard) and change a few times a month. set() clears this
 * instance's cache at once; another Cloud Run instance sees the change within 30 s.
 *
 * A failed read falls back to the defaults, which are the safe side for each key (the connect
 * button closed, self-signup off, the stated AI limits), and is not cached, so the next call
 * tries again.
 */

const prisma = require('../config/prisma');
const accountEvents = require('./accountEvents');

const CACHE_MS = 30 * 1000;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function deepFreeze(obj) {
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}

const DEFAULTS = deepFreeze({
  // Owners see «اربط واتساب» only after G1, the first attended live Embedded Signup, has passed.
  es_owner_enabled: false,
  campaign: {
    name: 'حملة إربد — الشهر الأول مجاني',
    trial_days: 30,
    trial_starts: 'first_reply', // 'first_reply' | 'connect'
    backstop_days: 14,
  },
  ai_limits: {
    reply_month_default: 1000,
    media_day_default: 30,
    platform_day_ceiling: 2000,
    ceiling_policy: 'trials_first',
  },
  // Empty until the owner fills them in: the «كيف أدفع؟» card stays hidden while they are.
  payment_instructions: { cliq_alias: '', iban: '', holder: '' },
  late_policy: { grace_days: 7 },
  invite_ttl_days: 7,
  shift_alert_numbers: [],
  self_signup: { enabled: false, daily_cap: 5 },
  coexistence: { enabled: false },
  // Written by code when the AI provider fails ({provider, kind, last_seen}), not by a person.
  provider_status: null,
});

const KEYS = Object.keys(DEFAULTS);

function settingError(message, code) {
  return Object.assign(new Error(message), { code, status: 400 });
}

function assertKnown(key) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
    throw settingError(`unknown platform setting "${key}"`, 'UNKNOWN_SETTING');
  }
}

// A stored value must have the shape of its default, so a bad PATCH cannot turn
// es_owner_enabled into the string "false" (which is truthy) or ai_limits into a number.
function assertShape(key, value) {
  const def = DEFAULTS[key];
  let ok;
  if (def === null) ok = isPlainObject(value); // provider_status
  else if (Array.isArray(def)) ok = Array.isArray(value);
  else if (isPlainObject(def)) ok = isPlainObject(value);
  else if (typeof def === 'number') ok = typeof value === 'number' && Number.isFinite(value);
  else ok = typeof value === typeof def;
  if (!ok) throw settingError(`platform setting "${key}" has the wrong shape`, 'BAD_SETTING_VALUE');
}

function merge(key, stored) {
  const def = DEFAULTS[key];
  if (stored === undefined) return clone(def);
  if (isPlainObject(def) && isPlainObject(stored)) return { ...clone(def), ...clone(stored) };
  return clone(stored);
}

// ─── cache ─────────────────────────────────────────────────────────────────

let cache = null; // { at, values: Map<key, storedValue> }
let loading = null;
// Bumped by every clear, so a read that started before a write cannot repopulate the cache with
// the value the write just replaced.
let generation = 0;

function clearCache() {
  cache = null;
  loading = null;
  generation += 1;
}

async function loadStored() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.values;
  if (!loading) {
    const gen = generation;
    const pending = prisma.platformSetting.findMany({ select: { key: true, value: true } })
      .then((rows) => {
        const values = new Map(rows.map((r) => [r.key, r.value]));
        if (gen === generation) cache = { at: Date.now(), values };
        return values;
      })
      .catch((err) => {
        console.error(`[platformSettings] read failed, using defaults: ${err.message}`);
        return new Map();
      })
      .finally(() => {
        if (loading === pending) loading = null;
      });
    loading = pending;
  }
  return loading;
}

// ─── API ───────────────────────────────────────────────────────────────────

/** The effective value of one setting: the stored value merged over the code default. */
async function get(key) {
  assertKnown(key);
  const values = await loadStored();
  return merge(key, values.get(key));
}

/** Every setting's effective value, keyed by name. Stored keys this code does not know are left out. */
async function getAll() {
  const values = await loadStored();
  const out = {};
  for (const key of KEYS) out[key] = merge(key, values.get(key));
  return out;
}

/**
 * Store a setting and record who changed it (AccountEvent platform_setting_changed, with the
 * stored value before and after). `null` removes the stored row, which puts the default back.
 * Throws (status 400, code UNKNOWN_SETTING or BAD_SETTING_VALUE) on an unknown key or a value of
 * the wrong shape. Returns the new effective value.
 *
 * @param {string} key
 * @param {*} value
 * @param {string|null} actorUserId  the platform_admin making the change; null when code writes it
 * @param {object} [opts]
 * @param {string} [opts.actorKind]  defaults to 'shift' with a user and 'system' without
 */
async function set(key, value, actorUserId = null, { actorKind } = {}) {
  assertKnown(key);
  if (value !== null) assertShape(key, value);

  const existing = await prisma.platformSetting.findUnique({ where: { key } });
  const before = existing ? existing.value : null;
  if (value === null) {
    await prisma.platformSetting.deleteMany({ where: { key } });
  } else {
    await prisma.platformSetting.upsert({
      where: { key },
      create: { key, value, updated_by: actorUserId || null },
      update: { value, updated_by: actorUserId || null },
    });
  }
  clearCache();

  await accountEvents.record({
    businessId: null,
    actorUserId: actorUserId || null,
    actorKind: actorKind || (actorUserId ? 'shift' : 'system'),
    type: 'platform_setting_changed',
    data: { key, before, after: value },
  });
  return merge(key, value === null ? undefined : value);
}

// A setting is "on" when its value is truthy, or, for a switch stored as {enabled, …}
// (self_signup, coexistence), when enabled is true.
function isOn(value) {
  if (isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, 'enabled')) return value.enabled === true;
  return Boolean(value);
}

/**
 * Express middleware: 503 {error: arabicMessage} unless the setting is on. The key is checked when
 * the route is defined, so a typo fails at startup instead of closing a route for good.
 */
function requireSetting(key, arabicMessage = 'هذه الخدمة غير متاحة حاليًا.') {
  assertKnown(key);
  return async function requirePlatformSetting(req, res, next) {
    let on = false;
    try {
      on = isOn(await get(key));
    } catch (err) {
      console.error(`[platformSettings] requireSetting(${key}) failed: ${err.message}`);
    }
    if (!on) return res.status(503).json({ error: arabicMessage });
    return next();
  };
}

/** A copy of the code defaults (for the settings page's «القيمة الافتراضية»). */
function defaults() {
  return clone(DEFAULTS);
}

module.exports = { get, getAll, set, requireSetting, isOn, defaults, clearCache, KEYS, CACHE_MS };
