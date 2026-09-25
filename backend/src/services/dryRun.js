/**
 * «جرّب البوت» — run the account's REAL workflow against a message, and send nothing.
 *
 * The earlier test tool built its own prompt and called the model directly, so a `generic`
 * account — which answers production with a fixed greeting and never calls a model — came
 * back fluent and sane. A readiness check that certifies a dead bot is worse than none.
 *
 * This goes through the same dispatch the webhook uses (`runWorkflow`), with the business's
 * real menu, services and configuration, against a conversation that exists only in memory:
 * nothing is persisted, no WhatsApp message leaves, and no order or appointment is created —
 * those side effects live in the webhook path after the workflow returns, not inside it.
 * State is handed back to the caller so a multi-turn exchange («بدي أحجز» → «أي خدمة؟») can
 * be walked exactly as a customer would.
 */

const { processRestaurantMessage } = require('../workflows/restaurant');
const { processClinicMessage } = require('../workflows/clinic');
const { processGenericMessage } = require('../workflows/generic');

// Every type now has a workflow. The rest — a pharmacy, a gym, a workshop — answer from the
// knowledge their owner entered, rather than from a fixed greeting.
const WORKFLOW_TYPES = ['restaurant', 'clinic', 'generic', 'store', 'other'];

/**
 * The one dispatch. The webhook path calls this too, so a dry run cannot drift from
 * production: if a workflow is added or renamed, both change together.
 */
async function runWorkflow(business, conversation, customerText) {
  if (business.business_type === 'restaurant') {
    return processRestaurantMessage(business, conversation, customerText);
  }
  if (business.business_type === 'clinic') {
    return processClinicMessage(business, conversation, customerText);
  }
  // Everything else answers from the knowledge its owner entered. With none entered it falls
  // back to the greeting — the same reply as before — and says so, so a panel cannot show a
  // fluent answer for an account that would greet and stop.
  return processGenericMessage(business, conversation, customerText);
}

/**
 * @param business  the row as the webhook would see it (ai_config, business_type, id…)
 * @param text      what the customer would type
 * @param state     { current_state, workflow_data } from the previous turn, or undefined
 */
async function dryRun(business, text, state = {}) {
  const started = Date.now();
  const conversation = {
    id: `dryrun-${business.id}`,
    business_id: business.id,
    customer_wa_id: '962700000000',
    profile_name: 'زبون تجريبي',
    status: 'open',
    ai_enabled: true,
    current_state: state.current_state || 'IDLE',
    workflow_data: state.workflow_data || {},
  };

  const result = await runWorkflow(business, conversation, String(text));
  const update = result?.stateUpdate || {};

  return {
    sent: false,
    runs_workflow: true,
    has_workflow: WORKFLOW_TYPES.includes(business.business_type),
    // A generic account with nothing entered answers with its greeting and stops. Said out
    // loud, because a fluent-looking test reply for such an account is exactly the false
    // green this tool was rebuilt to stop giving.
    knowledge_empty: Boolean(result?.knowledge_empty),
    reply: result?.reply ?? '',
    action: result?.action || 'NONE',
    // What the webhook would have persisted; handed back so the next turn continues from here.
    state: {
      current_state: update.current_state ?? conversation.current_state,
      workflow_data: update.workflow_data ?? conversation.workflow_data,
      // A workflow can hand the conversation to a human; the customer should see that happen.
      handed_to_human: update.ai_enabled === false || update.status === 'human_takeover',
    },
    latency_ms: Date.now() - started,
  };
}

module.exports = { dryRun, runWorkflow, WORKFLOW_TYPES };
