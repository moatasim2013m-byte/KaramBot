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

const { PAYMENT_NOTICES } = require('../config/metaNotices');

// Silence longer than this on an otherwise live account is worth a look.
const QUIET_HOURS = 48;
// An inbound with nothing sent after it: the customer is waiting.
const UNANSWERED_MINUTES = 15;
// Past a day the thread is no longer «someone is waiting right now» but a lost conversation; the
// attention queue is for what can still be saved today, and the window keeps the query bounded.
const UNANSWERED_MAX_HOURS = 24;
// A conversation handed to the shop's team that nobody has answered for this long.
const HANDOFF_MINUTES = 60;
// Connected this long and nobody has confirmed a payment method at Meta: worth chasing.
const PAYMENT_UNCONFIRMED_HOURS = 48;

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
  // A Meta 131042 refusal is evidence, so it wins over any confirmation a person gave.
  if (onboarding?.payment_blocked_at) {
    return { state: 'down', label: PAYMENT_NOTICES.blocked.staff.short };
  }
  if (onboarding && !onboarding.payment_method_ok) {
    // Without a payment method Meta refuses the agent's replies. The wording comes from
    // config/metaNotices.js: the dated copy that was here read as a missed deadline once its date passed.
    return { state: 'degraded', label: PAYMENT_NOTICES.missing.staff.short };
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
  // A deliberate pause (PATCH /api/admin/accounts/:id/bot) is its own state: silence here is the
  // intended outcome, so it must read neither as healthy nor as a broken bot.
  if (business.ai_config?.enabled === false) return { state: 'paused', label: 'موقوف مؤقتًا' };
  // Every type has a workflow now, but a generic one with nothing entered still answers with a
  // greeting and stops — a working pipeline with nothing to say. Degraded, not down: the
  // customers still get a reply and the shop's team still gets the conversation.
  if (!WORKFLOW_TYPES.includes(business.business_type) && knowledgeCount === 0) {
    return { state: 'degraded', label: 'بدون معلومات', sub: 'لم تُدخل معلومات المحل' };
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

/**
 * Is a customer waiting for a reply in this conversation?
 *
 * Read per conversation from its own last_inbound_at and last_outbound_at. The rule this replaces
 * asked only «was the last inbound more than 15 minutes ago», so every thread the bot had already
 * answered counted as waiting and the queue claimed every shop had unanswered customers.
 *
 * Waiting means: the customer wrote after the last thing sent to them (coalesce(last_outbound_at,
 * epoch)), the thread is open or pending, the bot is on for it, and that message is between 15
 * minutes and 24 hours old.
 */
function isWaiting(conv, now = Date.now()) {
  if (!conv || !conv.last_inbound_at) return false;
  if (!['open', 'pending'].includes(conv.status)) return false;
  if (conv.ai_enabled === false) return false;
  const inbound = new Date(conv.last_inbound_at).getTime();
  const outbound = conv.last_outbound_at ? new Date(conv.last_outbound_at).getTime() : 0;
  if (!(inbound > outbound)) return false;
  const age = now - inbound;
  return age > UNANSWERED_MINUTES * 60000 && age < UNANSWERED_MAX_HOURS * 3600000;
}

/**
 * Handed to the shop's team (needs_attention) more than an hour ago, and nothing sent since.
 * A reply after attention_at is the team picking it up, whoever sent it.
 */
function isHandoffWaiting(conv, now = Date.now()) {
  if (!conv || !conv.needs_attention || !conv.attention_at) return false;
  if (!['open', 'pending'].includes(conv.status)) return false;
  const at = new Date(conv.attention_at).getTime();
  if (now - at <= HANDOFF_MINUTES * 60000) return false;
  return !(conv.last_outbound_at && new Date(conv.last_outbound_at).getTime() > at);
}

/** «25 د», «3 س», «2 يوم»: how long, in the short form the queue's «منذ» column uses. */
function shortDuration(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  if (m < 60) return `${m} د`;
  if (m < 48 * 60) return `${Math.round(m / 60)} س`;
  return `${Math.round(m / 1440)} يوم`;
}

module.exports = {
  connectionState, agentState, lifecycle, minutesSince, isWaiting, isHandoffWaiting, shortDuration,
  QUIET_HOURS, UNANSWERED_MINUTES, UNANSWERED_MAX_HOURS, HANDOFF_MINUTES, PAYMENT_UNCONFIRMED_HOURS,
  WORKFLOW_TYPES,
};
