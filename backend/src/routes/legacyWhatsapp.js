/**
 * Webhook endpoint for the legacy Karambot app (the numbers wired by hand).
 *
 * Its verify token and app secret are unchanged; existing numbers run on this app,
 * so nothing here may drift when the SHIFT endpoint changes.
 */

const { createWebhookRouter } = require('./whatsapp');

module.exports = createWebhookRouter({
  label: 'karambot',
  verifyToken: () => process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  appSecret: () => process.env.META_APP_SECRET,
});
