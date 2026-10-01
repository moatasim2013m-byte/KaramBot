'use strict';

/**
 * Staff alerts for a customer's own business.
 *
 * services/alerts.js has carried `handoff`, `ai_failure`, `needs_team` and the rest for a while,
 * but every caller was SHIFT's own sales bot (workflows/shift, shiftSweeper). A customer's
 * business received one alert — `new_message` — so when its bot handed a conversation to a human,
 * or failed, the owner was told nothing. A shop owner does not sit in a web panel; the only place
 * they will see it is their own WhatsApp.
 *
 * Everything here is fire-and-forget: it returns at once, never throws, and its promise never
 * rejects, so a reply is neither delayed nor broken by an alert. sendStaffAlert already swallows
 * its own failures; this adds the same guarantee around building the call.
 */

const ALERT_SUMMARY_MAX = 300;

function notifyWorkflowAlert({ reason, business, conversation, summary = '' }) {
  try {
    // Lazily required: alerts.js reaches back into the WhatsApp sender, and the workflows that
    // call this are themselves loaded from the inbound path.
    const alerts = require('./alerts');
    Promise.resolve(alerts.sendStaffAlert({
      reason,
      business,
      conversation,
      summary: String(summary || '').slice(0, ALERT_SUMMARY_MAX),
      now: new Date(),
    })).catch((err) => console.error(`[workflowAlerts] ${reason} failed: ${err && err.message}`));
  } catch (err) {
    console.error(`[workflowAlerts] ${reason} failed: ${err && err.message}`);
  }
}

/**
 * The callback ai/provider.js calls when a provider is out of credits, has a rejected key or a
 * missing model. provider.js throttles it to once an hour per provider, so this cannot flood the
 * owner's phone. The turn itself continues on the fallback provider.
 */
function providerIssueAlert(business, conversation) {
  return ({ summary }) => notifyWorkflowAlert({
    reason: 'ai_failure', business, conversation, summary,
  });
}

module.exports = { notifyWorkflowAlert, providerIssueAlert };
