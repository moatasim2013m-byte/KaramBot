const express = require('express');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const buildPhoneLookupFormats = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return [];

  const formats = [digits, `+${digits}`];

  if (digits.startsWith('962')) {
    formats.push(`0${digits.slice(3)}`);
    formats.push(`00${digits}`);
  }

  return [...new Set(formats)];
};

/**
 * POST /api/opt-out
 * Public endpoint - no auth required
 */
router.post('/opt-out', async (req, res) => {
  try {
    const { wa_id, phone } = req.body;

    if (!wa_id && !phone) {
      return res.status(400).json({ error: 'wa_id or phone is required' });
    }

    const lookupValue = wa_id || phone;
    const phoneFormats = buildPhoneLookupFormats(lookupValue);
    const query = phoneFormats.length > 0
      ? { phone: { $in: phoneFormats } }
      : { phone: lookupValue };
    const user = await User.findOne(query);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.whatsapp_opted_out_at = new Date();
    user.whatsapp_marketing_consent = false;
    await user.save();

    console.log(`WHATSAPP_OPT_OUT user_id=${user._id} wa_id=${wa_id || phone}`);

    res.json({
      success: true,
      message: 'You have been unsubscribed from WhatsApp marketing messages'
    });
  } catch (error) {
    console.error('Opt-out error:', error);
    res.status(500).json({ error: 'Failed to process opt-out' });
  }
});

/**
 * POST /api/opt-in
 * Authenticated endpoint
 */
router.post('/opt-in', authMiddleware, async (req, res) => {
  try {
    const { consent_source = 'manual_opt_in' } = req.body;

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.whatsapp_marketing_consent = true;
    user.whatsapp_consent_date = new Date();
    user.whatsapp_consent_source = consent_source;
    user.whatsapp_opted_out_at = null;
    await user.save();

    console.log(`WHATSAPP_OPT_IN user_id=${user._id} source=${consent_source}`);

    res.json({
      success: true,
      message: 'You have been subscribed to WhatsApp marketing messages'
    });
  } catch (error) {
    console.error('Opt-in error:', error);
    res.status(500).json({ error: 'Failed to process opt-in' });
  }
});

/**
 * GET /api/consent-status
 */
router.get('/consent-status', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('whatsapp_marketing_consent whatsapp_consent_date whatsapp_consent_source whatsapp_opted_out_at');

    res.json({
      opted_in: user.whatsapp_marketing_consent && !user.whatsapp_opted_out_at,
      consent_date: user.whatsapp_consent_date,
      consent_source: user.whatsapp_consent_source,
      opted_out_at: user.whatsapp_opted_out_at
    });
  } catch (error) {
    console.error('Get consent status error:', error);
    res.status(500).json({ error: 'Failed to get consent status' });
  }
});

module.exports = router;
