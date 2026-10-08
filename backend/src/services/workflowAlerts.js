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
 * missing model. provider.js throttles it to once an hour per provider, across every shop.
 *
 * It goes to SHIFT, not to this shop: the credits and keys are SHIFT's, and the one hourly alert
 * used to land on whichever shop's message happened to hit the outage first — a random owner was
 * told SHIFT's Gemini balance had run out, and SHIFT heard nothing. The shop itself still sees the
 * effect where it matters: when no provider answers, its conversation is handed to staff and that
 * handover alert (handoff, ai_failure from the workflow's result) reaches its numbers as before.
 *
 * provider_status is written so the operator panel can show the outage without a log search.
 * Both halves are fire-and-forget, like every alert here.
 */
function providerIssueAlert(business, conversation) {
  void conversation; // the conversation is the shop's customer's: nothing of it goes to SHIFT
  return ({ provider, kind, summary } = {}) => {
    try {
      const alerts = require('./alerts');
      Promise.resolve(alerts.notifyShift({
        reason: 'provider_down',
        businessId: business?.id || null,
        shopName: business?.name || '',
        summary: String(summary || '').slice(0, ALERT_SUMMARY_MAX),
      })).catch((err) => console.error(`[workflowAlerts] provider_down failed: ${err && err.message}`));
    } catch (err) {
      console.error(`[workflowAlerts] provider_down failed: ${err && err.message}`);
    }
    recordProviderStatus({ provider, kind });
  };
}

/**
 * PlatformSetting provider_status {provider, kind, last_seen}, which the operator panel reads to
 * show an AI outage. Shared by every onProviderIssue callback: provider.js hands the hourly issue
 * to whichever caller hit it first, and that is usually SHIFT's own sales bot (the busiest
 * number), whose callback used to send its ai_failure alert and write nothing here, so the outage
 * never showed (review 2026-10-08). Fire-and-forget, never throws.
 */
function recordProviderStatus({ provider, kind } = {}) {
  try {
    const settings = require('./platformSettings');
    Promise.resolve(settings.set('provider_status', {
      provider: provider || null,
      kind: kind || null,
      last_seen: new Date().toISOString(),
    }, null, { actorKind: 'system' })).catch((err) => console.error(`[workflowAlerts] provider_status not saved: ${err && err.message}`));
  } catch (err) {
    console.error(`[workflowAlerts] provider_status not saved: ${err && err.message}`);
  }
}

module.exports = { notifyWorkflowAlert, providerIssueAlert, recordProviderStatus };
