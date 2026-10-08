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

const OWNER_AI_CONFIG_ALLOWED = [
  'enabled', 'provider', 'personality', 'greeting_message',
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

// POST /api/businesses — platform_admin only
router.post('/', requireRole('platform_admin'), async (req, res) => {
  try {
    if ('wa_access_token' in req.body) {
      return res.status(400).json({ error: 'Set WhatsApp token via PATCH /api/businesses/:id/token' });
    }
    const { wa_access_token: _tok, ...biz } = await prisma.business.create({ data: req.body });
    void _tok;
    res.status(201).json({ business: biz });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

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

// PATCH /api/businesses/:id/token — encrypt and store WhatsApp token
router.patch('/:id/token', requireRole('platform_admin', 'business_owner'), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'platform_admin';
    if (!isAdmin && req.user.business_id !== req.params.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
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
    // That a token was set by hand, and by whom; never the token.
    await accountEvents.record({
      businessId: req.params.id, actorUserId: req.user.id,
      actorKind: isAdmin ? 'shift' : 'owner', type: 'token_set', data: { source: 'manual' },
    });
    res.json({ success: true, message: 'Token encrypted and saved' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Business not found' });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
