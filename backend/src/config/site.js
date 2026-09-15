/**
 * The one place customer-visible links come from (decision D4).
 * shifts-ai.com is the official domain; SHIFT_SITE_URL exists only for staging.
 * Evaluated at require time — like every other env in this service, a change needs a restart.
 */

const SITE_URL = (process.env.SHIFT_SITE_URL || 'https://shifts-ai.com').replace(/\/+$/, '');
const SITE_HOST = SITE_URL.replace(/^https?:\/\//, '');
const PRIVACY_URL = `${SITE_URL}/privacy`;
// Inside WhatsApp text a bare host reads better than a full URL, and WhatsApp still links it.
const PRIVACY_SHORT = `${SITE_HOST}/privacy`;

module.exports = { SITE_URL, SITE_HOST, PRIVACY_URL, PRIVACY_SHORT };
