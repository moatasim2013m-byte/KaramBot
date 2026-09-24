/**
 * The `account_update` webhook field.
 *
 * Meta requires the app to subscribe to it for Embedded Signup, and it is how we
 * learn about a customer's account after the browser flow is over: the signup
 * completing, a number being verified, a ban. The event is keyed by WABA id
 * (entry.id), which is what ties it to an onboarding row.
 */

const prisma = require('../config/prisma');

/** Handle one `account_update` change. Returns what it did, for the tests and the log. */
async function handleAccountUpdate(entry, change) {
  const wabaId = entry?.id ? String(entry.id) : null;
  const value = change?.value || {};
  const event = value.event || 'unknown';
  if (!wabaId) return { handled: false, reason: 'no waba id' };

  const row = await prisma.whatsappOnboarding.findFirst({
    where: { waba_id: wabaId },
    orderBy: { created_at: 'desc' },
  });
  if (!row) {
    // A WABA we were subscribed to but never onboarded here: worth seeing, not an error.
    console.warn(`[account_update] ${event} for unknown WABA ${wabaId}`);
    return { handled: false, reason: 'unknown waba' };
  }

  const data = {};
  switch (event) {
    case 'PARTNER_ADDED':
      // Fires when the customer finishes Embedded Signup. The token exchange is already
      // running in the request that opened it, so this is confirmation, not a trigger.
      break;
    case 'ACCOUNT_VIOLATION':
    case 'ACCOUNT_RESTRICTION':
    case 'DISABLED_UPDATE':
      data.last_error = `${event}: ${JSON.stringify(value).slice(0, 300)}`;
      data.last_error_at = new Date();
      break;
    default:
      break;
  }

  if (Object.keys(data).length) {
    await prisma.whatsappOnboarding.update({ where: { id: row.id }, data });
  }
  console.log(`[account_update] ${event} waba=${wabaId} onboarding=${row.id}`);
  return { handled: true, event, onboardingId: row.id };
}

module.exports = { handleAccountUpdate };
