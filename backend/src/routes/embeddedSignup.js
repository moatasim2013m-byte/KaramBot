const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const { startOnboarding, runOnboarding, publicStatus } = require('../services/embeddedSignup');

/**
 * Embedded Signup (v4) endpoints.
 *
 * Admin-only for now (D-ES1): app admins and developers can run the flow with their
 * own Meta credentials before any customer sees the button. Drop `requireRole` to
 * open it to business owners.
 */
router.use(authenticate, requireRole('platform_admin'));

/** The config the browser needs. The app secret is not here and never will be. */
router.get('/config', (req, res) => {
  res.json({
    app_id: process.env.META_ES_APP_ID || '1065272896256103',
    config_id: process.env.META_ES_CONFIG_ID || '1664627968720314',
    graph_version: process.env.GRAPH_API_VERSION || 'v24.0',
  });
});

/**
 * The browser posts the FINISH payload and the authResponse code together.
 *
 * The exchange runs inline, not on a queue: the code expires 30 seconds after the
 * flow closes, and a queue hop can cost more than that.
 */
router.post('/exchange', async (req, res) => {
  const { code, waba_id, phone_number_id, business_id, meta_business_id, session_id } = req.body || {};

  if (!code || !waba_id || !phone_number_id) {
    return res.status(400).json({ error: 'code, waba_id and phone_number_id are required' });
  }

  try {
    const row = await startOnboarding({
      appId: process.env.META_ES_APP_ID || '1065272896256103',
      businessId: business_id || null,
      metaBusinessId: meta_business_id,
      wabaId: waba_id,
      phoneNumberId: phone_number_id,
      sessionId: session_id,
    });

    const done = await runOnboarding(row.id, { code });
    return res.json({ status: 'connected', onboarding: publicStatus(done) });
  } catch (err) {
    // The step reached is already on the row, so the dashboard can offer a resume
    // rather than a fresh signup.
    console.error('[embedded-signup] onboarding failed:', err.message);
    const row = await prisma.whatsappOnboarding.findUnique({ where: { phone_number_id } }).catch(() => null);
    return res.status(502).json({
      error: 'onboarding_failed',
      message: err.message,
      onboarding: publicStatus(row),
      resumable: Boolean(row && row.step !== 'code_received'),
    });
  }
});

/**
 * Continue a signup that failed at step 2 or 3. No new Embedded Signup run needed.
 *
 * An optional 6-digit `pin` is for a number that already had two-step verification set
 * elsewhere: Meta rejects any PIN but the existing one, so the customer supplies theirs.
 */
router.post('/:id/retry', async (req, res) => {
  try {
    const done = await runOnboarding(req.params.id, { pin: req.body?.pin });
    return res.json({ status: 'connected', onboarding: publicStatus(done) });
  } catch (err) {
    const row = await prisma.whatsappOnboarding.findUnique({ where: { id: req.params.id } }).catch(() => null);
    return res.status(502).json({ error: 'retry_failed', message: err.message, onboarding: publicStatus(row) });
  }
});

/**
 * CANCEL and error events from the browser.
 *
 * Kept because an abandoned signup is the useful thing to see: `current_step` says
 * where customers give up, and `session_id` is what Meta support asks for.
 */
router.post('/events', async (req, res) => {
  const { event, current_step, error_message, session_id, phone_number_id } = req.body || {};
  console.log(`[embedded-signup] ${event} step=${current_step || '-'} session=${session_id || '-'}`);

  if (phone_number_id && (error_message || event === 'ERROR')) {
    await prisma.whatsappOnboarding.updateMany({
      where: { phone_number_id },
      data: { last_error: String(error_message || event).slice(0, 500), last_error_at: new Date(), session_id: session_id || undefined },
    }).catch(() => {});
  }
  res.json({ ok: true });
});

/** Onboarding state for the dashboard checklist. */
router.get('/status', async (req, res) => {
  const where = req.query.business_id
    ? { business_id: String(req.query.business_id) }
    : req.query.phone_number_id
      ? { phone_number_id: String(req.query.phone_number_id) }
      : null;
  if (!where) return res.status(400).json({ error: 'business_id or phone_number_id required' });

  const row = await prisma.whatsappOnboarding.findFirst({ where, orderBy: { created_at: 'desc' } });
  res.json({ onboarding: publicStatus(row) });
});

module.exports = router;
