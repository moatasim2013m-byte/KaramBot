/**
 * The three states of an account, derived from what we actually store.
 *
 * Shared by the platform overview and the customer's own status card on purpose: a customer
 * asking «is my WhatsApp connected?» must get the same answer SHIFT staff see in the fleet
 * view. Two implementations would drift, and the customer would find out which one was
 * wrong by losing messages.
 *
 * Where a signal needs a Graph call we do not make yet (Meta's quality rating, messaging
 * tier), the answer is `unknown` — never a green light we did not earn.
 */

// Silence longer than this on an otherwise live account is worth a look.
const QUIET_HOURS = 48;
// An inbound with nothing sent after it: the customer is waiting.
const UNANSWERED_MINUTES = 15;

const minutesSince = (d) => (d ? (Date.now() - new Date(d).getTime()) / 60000 : null);

/**
 * Three states that fail independently, so they are never collapsed into one badge:
 * the account, its WhatsApp connection, and the agent.
 */
function connectionState(business, onboarding) {
  if (!business.wa_phone_number_id) return { state: 'unknown', label: 'غير معروف' };
  if (onboarding && onboarding.step !== 'done') {
    return { state: 'degraded', label: 'قيد التوصيل', sub: onboarding.step };
  }
  if (!business.wa_access_token) return { state: 'down', label: 'بدون رمز وصول' };
  if (onboarding && !onboarding.payment_method_ok) {
    // Meta stops delivering service messages — the agent's replies — without a payment method
    // on file from 1 October 2026, so this is a countdown, not a cosmetic gap.
    return { state: 'degraded', label: 'بدون طريقة دفع — مهلة 30 أيلول' };
  }
  return { state: 'ok', label: 'متصل' };
}

// The types whose knowledge is modelled elsewhere: a menu, services, or SHIFT's own sales flow.
const WORKFLOW_TYPES = ['restaurant', 'clinic', 'shift'];

/**
 * @param knowledgeCount  rows of BusinessKnowledge, for a business whose type has no sector
 *                        workflow. Undefined means "not checked" and is not held against it.
 */
function agentState(business, lastInbound, lastOutbound, knowledgeCount) {
  if (business.ai_config?.enabled === false) return { state: 'idle', label: 'موقوف يدويًا' };
  // Every type has a workflow now, but a generic one with nothing entered still answers with a
  // greeting and stops — a working pipeline with nothing to say.
  if (!WORKFLOW_TYPES.includes(business.business_type) && knowledgeCount === 0) {
    return { state: 'down', label: 'بدون معلومات', sub: 'لم تُدخل معلومات المنشأة' };
  }
  if (!lastInbound) return { state: 'unknown', label: 'لا توجد رسائل بعد' };
  const waiting = minutesSince(lastInbound);
  const answered = lastOutbound && new Date(lastOutbound) >= new Date(lastInbound);
  if (!answered && waiting > UNANSWERED_MINUTES) {
    return { state: 'down', label: 'رسالة بدون رد', sub: `${Math.round(waiting)} د` };
  }
  return { state: 'ok', label: 'يرد' };
}

/** Which lifecycle bucket an account sits in — onboarding is a state, not a status flag. */
function lifecycle(business, onboarding) {
  if (business.status === 'suspended') return 'suspended';
  if (onboarding && onboarding.step !== 'done') return 'onboarding';
  if (!business.wa_phone_number_id || !business.wa_access_token) return 'onboarding';
  return business.status === 'active' ? 'active' : 'inactive';
}


module.exports = { connectionState, agentState, lifecycle, minutesSince, QUIET_HOURS, UNANSWERED_MINUTES, WORKFLOW_TYPES };
