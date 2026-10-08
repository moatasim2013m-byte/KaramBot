const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const prisma = require('../config/prisma');
const { encrypt } = require('../utils/tokenCrypto');
const { normalizePhone } = require('../utils/phone');
const jsonb = require('../db/jsonb');
const accountEvents = require('../services/accountEvents');

/**
 * «السجل» on the account page: which settings changed and who changed them. Key names only, never
 * values: a greeting is harmless but alert numbers and policies are the shop's own data, and the
 * log is read by more people than the settings are.
 */
function recordSettingsChanged(req, businessId, update, aiConfigPatch) {
  const actorKind = req.user.role === 'platform_admin' ? 'shift' : req.user.role === 'business_owner' ? 'owner' : 'staff';
  const data = { keys: Object.keys(update).filter((k) => k !== 'policies') };
  if (aiConfigPatch && Object.keys(aiConfigPatch).length) data.ai_config_keys = Object.keys(aiConfigPatch);
  if (update.policies && typeof update.policies === 'object') data.policies_keys = Object.keys(update.policies);
  return accountEvents.record({ businessId, actorUserId: req.user.id, actorKind, type: 'settings_changed', data });
}

/** A real object: an array or a string spread into numeric keys instead of being rejected. */
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// What a business row looks like to its owner. Never wa_access_token.
const BUSINESS_PUBLIC_SELECT = {
  id: true, name: true, slug: true, business_type: true,
  logo_url: true, language_default: true, timezone: true,
  currency: true, address: true, wa_phone_number_id: true,
  wa_business_account_id: true, opening_hours: true,
  status: true, ai_config: true, policies: true,
  created_at: true, updated_at: true,
};

router.use(authenticate);

const OWNER_ALLOWED_FIELDS = [
  'name', 'logo_url', 'address', 'timezone', 'currency',
  'opening_hours', 'policies', 'ai_config',
];

const ADMIN_ALLOWED_FIELDS = [
  ...OWNER_ALLOWED_FIELDS,
  'slug', 'business_type', 'language_default', 'status',
  'wa_phone_number_id', 'wa_business_account_id',
];

// No 'enabled': the bot's pause has its own route (PATCH /api/admin/accounts/:id/bot), which logs
// bot_paused/bot_resumed with a reason. Accepted here, a settings form opened before a pause
// switched the bot back on when the greeting was saved, and the log said only settings_changed.
const OWNER_AI_CONFIG_ALLOWED = [
  'provider', 'personality', 'greeting_message',
  'fallback_message', 'handoff_keywords', 'out_of_hours_message',
  'confidence_threshold',
  // Where the bot reaches a human. Without a number here the staff alerts — a customer asking
  // for a person, a model failure, WhatsApp refusing to deliver — are built, wired and silent.
  'alert_wa_numbers',
];

/**
 * Alert recipients as the sender needs them: country code included, digits only, deduplicated.
 *
 * Through the shared parser, so «0796381676» — what a Jordanian owner will actually type —
 * becomes «962796381676» rather than being stored as a number WhatsApp would silently refuse.
 * Deduplication happens after that, so the local and international spellings of one number
 * collapse. A bad entry is dropped rather than rejected: a typo in one number must not stop the
 * owner saving the other.
 */
function normalizeAlertNumbers(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const raw of value) {
    const n = normalizePhone(raw);
    if (n) seen.add(n);
  }
  return [...seen].slice(0, 5);
}

const OWNER_POLICIES_ALLOWED = [
  'delivery_fee', 'min_order_amount', 'free_delivery_above',
  'payment_methods', 'order_confirmation_message',
  'cancellation_policy', 'delivery_policy',
];

function pickAllowed(body, allowedKeys) {
  return Object.fromEntries(
    Object.entries(body).filter(([k]) => allowedKeys.includes(k))
  );
}

// GET /api/businesses
router.get('/', async (req, res) => {
  try {
    const where = req.user.role === 'platform_admin' ? {} : { id: req.user.business_id };
    const businesses = await prisma.business.findMany({
      where,
      select: BUSINESS_PUBLIC_SELECT,
    });
    res.json({ businesses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/:id
router.get('/:id', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'platform_admin';
    const where = isAdmin ? { id: req.params.id } : { id: req.user.business_id };
    const biz = await prisma.business.findFirst({
      where,
      select: BUSINESS_PUBLIC_SELECT,
    });
    if (!biz) return res.status(404).json({ error: 'Business not found' });
    res.json({ business: biz });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── creating a shop ────────────────────────────────────────────────────────

// What an operator may set when creating a row. Not the raw body: Prisma would otherwise accept
// any column, wa_access_token and id included, and its own error text named the column that
// broke — English, with internals, shown to an operator as is.
const CREATE_ALLOWED_FIELDS = [
  'name', 'slug', 'business_type', 'language_default', 'timezone', 'currency', 'address', 'logo_url',
  'wa_phone_number_id', 'wa_business_account_id', 'opening_hours', 'ai_config', 'policies',
  'sector', 'city', 'owner_phone', 'is_internal',
];
const SLUG_RE = /^[a-z0-9-]{1,60}$/;
const SLUG_ATTEMPTS = 5;

const CREATE_ERRORS = {
  name: 'اسم الحساب مطلوب',
  slug: 'الرابط المختصر: أحرف إنجليزية صغيرة وأرقام وشرطات فقط',
  number_taken: 'هذا الرقم مربوط بحساب آخر',
  type: 'نوع النشاط غير معروف',
  failed: 'تعذّر إنشاء الحساب',
};
// The workflows that exist (messageProcessor picks one by business_type). The schema default is
// 'restaurant', which would hand a pharmacy created with just a name the restaurant menu bot.
const BUSINESS_TYPES = ['generic', 'restaurant', 'clinic', 'shift'];

function randomLetters(n) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * A slug from the shop's name: its Latin letters and digits, lowercased and joined by dashes.
 * Most of SHIFT's shops have Arabic-only names («صيدلية النور»), which leave nothing Latin, so
 * those get 'shop-' and six random letters. The slug is an internal handle nobody types, so a
 * readable one is a bonus, never a requirement the operator has to meet.
 */
function slugFromName(name) {
  const latin = String(name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return latin.length >= 2 ? latin : `shop-${randomLetters(6)}`;
}

/** The candidate for a retry after a slug collision: a fresh random one, or the base plus a suffix. */
function nextSlug(base, attempt) {
  if (attempt === 0) return base;
  if (/^shop-[a-z]{6}$/.test(base)) return `shop-${randomLetters(6)}`;
  return `${base.slice(0, 50)}-${randomLetters(4)}`;
}

// Prisma reports the column of a unique violation in meta.target (an array, or the index name in
// some versions); the fake DB and older drivers only put it in the message. Both are checked.
function uniqueField(err) {
  if (!err || err.code !== 'P2002') return null;
  const target = err.meta && err.meta.target;
  const text = `${Array.isArray(target) ? target.join(',') : (target || '')} ${err.message || ''}`;
  if (text.includes('wa_phone_number_id')) return 'wa_phone_number_id';
  if (text.includes('slug')) return 'slug';
  return 'other';
}

function cleanCreateBody(body) {
  const data = pickAllowed(body || {}, CREATE_ALLOWED_FIELDS);
  // An empty form field is "not given", never ''. An empty wa_phone_number_id in particular
  // used to be stored as '', and the second shop created without a number then collided with
  // the first on the unique index.
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t) data[k] = t; else delete data[k];
    }
  }
  // Stated, not left to the column default, so "no number yet" is NULL everywhere it is read.
  if (!data.wa_phone_number_id) data.wa_phone_number_id = null;
  if ('owner_phone' in data) data.owner_phone = normalizePhone(data.owner_phone) || null;
  if ('is_internal' in data) data.is_internal = data.is_internal === true;
  for (const k of ['ai_config', 'policies']) {
    if (k in data && !isPlainObject(data[k])) delete data[k];
  }
  if ('opening_hours' in data && !Array.isArray(data.opening_hours)) delete data.opening_hours;
  return data;
}

// POST /api/businesses — platform_admin only. A name (and normally a type) is enough: the slug
// is generated here, and the WhatsApp number comes later, when the shop connects.
router.post('/', requireRole('platform_admin'), async (req, res) => {
  if (req.body && 'wa_access_token' in req.body) {
    return res.status(400).json({ error: 'رمز واتساب يُضبط من صفحة الحساب، لا عند الإنشاء' });
  }
  const data = cleanCreateBody(req.body);
  if (!data.name) return res.status(400).json({ error: CREATE_ERRORS.name });
  if (!data.business_type) data.business_type = 'generic';
  if (!BUSINESS_TYPES.includes(data.business_type)) return res.status(400).json({ error: CREATE_ERRORS.type });

  let base;
  if (data.slug) {
    const given = data.slug.toLowerCase();
    if (!SLUG_RE.test(given)) return res.status(400).json({ error: CREATE_ERRORS.slug });
    base = given;
  } else {
    base = slugFromName(data.name);
  }

  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
    try {
      const { wa_access_token: _tok, ...biz } = await prisma.business.create({
        data: { ...data, slug: nextSlug(base, attempt) },
      });
      void _tok;
      // The first line of the shop's «السجل»: who opened the account, and as what.
      await accountEvents.record({
        businessId: biz.id, actorUserId: req.user.id, actorKind: 'shift', type: 'business_created',
        data: { business_type: biz.business_type, source: biz.source || 'operator' },
      });
      return res.status(201).json({ business: biz });
    } catch (err) {
      const field = uniqueField(err);
      if (field === 'slug') continue; // someone has it: try the next candidate
      if (field === 'wa_phone_number_id') return res.status(409).json({ error: CREATE_ERRORS.number_taken });
      // Never err.message: it is Prisma's English, with column names and internals in it.
      console.error(`[businesses] create failed: ${err.code || ''} ${err.message}`);
      return res.status(400).json({ error: CREATE_ERRORS.failed });
    }
  }
  console.error(`[businesses] create failed: no free slug after ${SLUG_ATTEMPTS} attempts from "${base}"`);
  return res.status(409).json({ error: CREATE_ERRORS.failed });
});

const SETTINGS_ROLES = ['business_owner', 'platform_admin'];

// PATCH /api/businesses/:id — allowlisted fields per role
router.patch('/:id', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'platform_admin';
    if (!isAdmin && req.user.business_id !== req.params.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if ('wa_access_token' in req.body) {
      return res.status(400).json({ error: 'Use PATCH /api/businesses/:id/token to update the WhatsApp token' });
    }
    // What the bot says and does, and the shop's policies, are the owner's decision. A manager
    // or staff member could otherwise switch the bot off, change its greeting or the alert
    // numbers that tell the owner something went wrong.
    if (('ai_config' in req.body || 'policies' in req.body) && !SETTINGS_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'إعدادات البوت والسياسات لصاحب الحساب فقط' });
    }

    const allowedKeys = isAdmin ? ADMIN_ALLOWED_FIELDS : OWNER_ALLOWED_FIELDS;
    const update = pickAllowed(req.body, allowedKeys);

    // A plain object or nothing: an array or a string would spread into numeric keys.
    if ('ai_config' in update && !isPlainObject(update.ai_config)) {
      return res.status(400).json({ error: 'ai_config must be an object' });
    }
    let aiConfigPatch = null;
    if (update.ai_config) {
      aiConfigPatch = pickAllowed(update.ai_config, OWNER_AI_CONFIG_ALLOWED);
      if ('alert_wa_numbers' in aiConfigPatch) {
        aiConfigPatch.alert_wa_numbers = normalizeAlertNumbers(aiConfigPatch.alert_wa_numbers);
      }
      // Patched in Postgres with `||`, not read-modify-written here. Assigning the column
      // replaces the whole object, so a PATCH carrying one setting used to drop every other one
      // — including the alert numbers the staff alerts depend on, which would have switched them
      // off silently the first time an owner edited their greeting. Doing the merge in JS would
      // fix that but lose a concurrent update instead. Clearing one setting still works by
      // sending its empty value ([] or ''), which is what the UI does.
      delete update.ai_config;
    }
    if (update.policies && typeof update.policies === 'object') {
      update.policies = pickAllowed(update.policies, OWNER_POLICIES_ALLOWED);
    }

    if (Object.keys(update).length === 0 && !(aiConfigPatch && Object.keys(aiConfigPatch).length)) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // The jsonb patch runs first so the row that is read back below already carries it. It
    // targets the id directly, so a row that does not exist leaves count 0 — reported the same
    // way Prisma reports it.
    if (aiConfigPatch && Object.keys(aiConfigPatch).length) {
      const { ok } = await jsonb.patchJson('businesses', req.params.id, 'ai_config', aiConfigPatch);
      if (!ok) return res.status(404).json({ error: 'Business not found' });
    }

    if (Object.keys(update).length === 0) {
      const only = await prisma.business.findUnique({
        where: { id: req.params.id },
        select: BUSINESS_PUBLIC_SELECT,
      });
      if (!only) return res.status(404).json({ error: 'Business not found' });
      await recordSettingsChanged(req, req.params.id, update, aiConfigPatch);
      return res.json({ business: only });
    }

    const biz = await prisma.business.update({
      where: { id: req.params.id },
      data: update,
      select: BUSINESS_PUBLIC_SELECT,
    });
    await recordSettingsChanged(req, req.params.id, update, aiConfigPatch);
    res.json({ business: biz });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Business not found' });
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/businesses/:id/token — encrypt and store WhatsApp token. platform_admin only: the
// token comes from Embedded Signup or from SHIFT's own setup, never from a customer pasting one
// into a box, and a wrong token pasted by an owner silently stopped their bot.
router.patch('/:id/token', requireRole('platform_admin'), async (req, res) => {
  try {
    const { wa_access_token } = req.body;
    if (!wa_access_token || wa_access_token.trim().length < 10) {
      return res.status(400).json({ error: 'Valid wa_access_token is required' });
    }
    let encryptedToken;
    try {
      encryptedToken = encrypt(wa_access_token.trim());
    } catch (encErr) {
      console.error('Token encryption failed:', encErr.message);
      return res.status(500).json({ error: 'Token encryption failed. Check TOKEN_ENCRYPTION_KEY.' });
    }
    await prisma.business.update({
      where: { id: req.params.id },
      data: { wa_access_token: encryptedToken },
    });
    // That a token was set by hand, and by whom; never the token. Only platform_admin reaches
    // this route, so the actor is always SHIFT.
    await accountEvents.record({
      businessId: req.params.id, actorUserId: req.user.id,
      actorKind: 'shift', type: 'token_set', data: { source: 'manual' },
    });
    res.json({ success: true, message: 'Token encrypted and saved' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Business not found' });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
// «زبون جديد» (routes/adminAccounts.js) names shops the same way: one slug rule, not two.
module.exports.slugFromName = slugFromName;
module.exports.nextSlug = nextSlug;
module.exports.uniqueField = uniqueField;
