/**
 * Webhook endpoint for the SHIFT Tech Provider app (1065272896256103).
 *
 * Separate from the legacy Karambot app's endpoint on purpose: customer WABAs
 * onboarded through Embedded Signup deliver here, signed with the SHIFT app secret
 * and verified with the SHIFT verify token. Neither credential is shared with
 * /api/whatsapp/webhook, so a body signed by one app cannot be accepted by the
 * other's URL.
 *
 * Past the signature check it is the same pipeline and the same tenant-isolation
 * rule as the legacy route.
 */

const { createWebhookRouter } = require('./whatsapp');
const { appSecretFor } = require('../utils/metaSecrets');

const SHIFT_APP_ID = () => process.env.META_ES_APP_ID || '1065272896256103';

module.exports = createWebhookRouter({
  label: 'shift',
  verifyToken: () => process.env.SHIFT_WEBHOOK_VERIFY_TOKEN,
  appSecret: () => appSecretFor(SHIFT_APP_ID()),
});
