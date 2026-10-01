/**
 * Webhook endpoint for the legacy Karambot app (the numbers wired by hand).
 *
 * Its verify token and app secret are unchanged; existing numbers run on this app,
 * so nothing here may drift when the SHIFT endpoint changes.
 */

const { createWebhookRouter } = require('./whatsapp');
const { embeddedSignupAppId: SHIFT_APP_ID } = require('../utils/metaSecrets');

module.exports = createWebhookRouter({
  label: 'karambot',
  verifyToken: () => process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  appSecret: () => process.env.META_APP_SECRET,
  // Numbers wired by hand sit on more than one old Meta app, so this endpoint is not tied
  // to a single id. The rule that matters is the other direction: a customer onboarded
  // through Embedded Signup belongs to the Tech Provider endpoint and never to this one.
  servesApp: (ownerAppId) => String(ownerAppId) !== SHIFT_APP_ID(),
});
