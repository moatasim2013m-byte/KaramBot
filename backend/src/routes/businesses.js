const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const prisma = require('../config/prisma');
const { encrypt } = require('../utils/tokenCrypto');

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
];

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
      select: {
        id: true, name: true, slug: true, business_type: true,
        logo_url: true, language_default: true, timezone: true,
        currency: true, address: true, wa_phone_number_id: true,
        wa_business_account_id: true, opening_hours: true,
        status: true, ai_config: true, policies: true,
        created_at: true, updated_at: true,
      },
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
      select: {
        id: true, name: true, slug: true, business_type: true,
        logo_url: true, language_default: true, timezone: true,
        currency: true, address: true, wa_phone_number_id: true,
        wa_business_account_id: true, opening_hours: true,
        status: true, ai_config: true, policies: true,
        created_at: true, updated_at: true,
      },
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

    if (update.ai_config && typeof update.ai_config === 'object') {
      update.ai_config = pickAllowed(update.ai_config, OWNER_AI_CONFIG_ALLOWED);
    }
    if (update.policies && typeof update.policies === 'object') {
      update.policies = pickAllowed(update.policies, OWNER_POLICIES_ALLOWED);
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const biz = await prisma.business.update({
      where: { id: req.params.id },
      data: update,
      select: {
        id: true, name: true, slug: true, business_type: true,
        logo_url: true, language_default: true, timezone: true,
        currency: true, address: true, wa_phone_number_id: true,
        wa_business_account_id: true, opening_hours: true,
        status: true, ai_config: true, policies: true,
        created_at: true, updated_at: true,
      },
    });
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
    res.json({ success: true, message: 'Token encrypted and saved' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Business not found' });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
