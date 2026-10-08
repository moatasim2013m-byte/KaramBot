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

// ─── The operator panel's rules (docs/panels/spec.md «Attention rules», «Fleet table columns») ──

const labels = require('../config/eventLabels');

const DAY_MS = 24 * 60 * 60 * 1000;
// es_cancelled waits a day: most owners who close Meta's window come back the same evening.
const ES_CANCELLED_HOURS = 24;
// The join link opened, or sent, this long ago with nothing after it: worth a call.
const JOIN_STALLED_HOURS = 48;
const INVITE_UNOPENED_HOURS = 48;
const TRIAL_ENDING_DAYS = 3;
const WENT_LIVE_HOURS = 24;
const DUE_SOON_DAYS = 7;
// A restriction Meta sent without an end date stays on the queue this long, then the daily Meta
// refresh (number status, quality) is the evidence that matters.
const RESTRICTION_DAYS = 30;
// A provider failure written within this window means the AI is down now.
const PROVIDER_DOWN_MINUTES = 15;

// The ES outcomes, in the order Meta and our server write them. es_started is an attempt, not an
// outcome, and does not hide the result of the one before it.
const ES_OUTCOMES = ['es_cancelled', 'es_failed', 'es_conflict', 'es_ownership_mismatch', 'es_connected', 'wrong_number'];

const time = (d) => (d ? new Date(d).getTime() : NaN);
const ageMs = (d, now) => now - time(d);

/** The newest event of one of `types` in a newest-first list, or null. */
function newest(events, types) {
  const set = [].concat(types);
  return (events || []).find((e) => set.includes(e.type)) || null;
}

/** Whether `later` is newer than `earlier` (either may be missing). */
const after = (later, earlier) => Boolean(later) && (!earlier || time(later.created_at) > time(earlier.created_at));

/** What the newest Meta connect attempt ended in, read as one of our rules (or null). */
function esOutcome(events) {
  const e = newest(events, ES_OUTCOMES);
  if (!e) return null;
  if (e.type === 'es_connected') return { kind: 'connected', event: e };
  if (e.type === 'es_cancelled') return { kind: 'cancelled', event: e };
  if (e.type === 'wrong_number' || e.type === 'es_conflict') return e.resolved_at ? null : { kind: 'needs_operator', event: e };
  const d = e.data || {};
  if (['needs_operator', 'needs_number'].includes(d.status) || (e.type === 'es_ownership_mismatch' && d.blocking === false)) {
    return { kind: 'needs_operator', event: e };
  }
  return { kind: 'failed', event: e };
}

/**
 * «واتساب» on the fleet table: one state and one word, from the number, the onboarding row
 * (revoked, 131042, last error) and the card. Evidence wins over confirmations, as connectionState.
 */
function whatsappColumn(business, onboarding, events = []) {
  const pick = (state) => ({ state, ...labels.WHATSAPP_AR[state] });
  if (onboarding && onboarding.revoked_at) return pick('removed');
  if (!business.wa_phone_number_id) {
    const out = esOutcome(events);
    if ((onboarding && onboarding.last_error) || (out && out.kind === 'failed')) return pick('failed');
    return pick('not_connected');
  }
  if (onboarding && onboarding.payment_blocked_at) return pick('payment_blocked');
  if (onboarding && onboarding.step !== 'done') return pick('failed');
  if (!business.wa_access_token) return pick('failed');
  if (onboarding && !onboarding.payment_method_ok) return pick('card_unconfirmed');
  return pick('connected');
}

/** «البوت» on the fleet table, from agentState plus the monthly cap. */
function botColumn(agent, { usage = null, trial = false } = {}) {
  const pick = (state) => ({ state, ...labels.BOT_AR[state] });
  if (agent && agent.state === 'paused') return pick('paused');
  // Only a free-month shop is stopped at its cap; a paying one keeps answering (costGuard).
  if (trial && usage && usage.cap > 0 && usage.ai_replies_month >= usage.cap) return pick('cap_reached');
  if (agent && agent.state === 'degraded') return pick('no_knowledge');
  if (agent && agent.state === 'down') return pick('unanswered');
  if (!agent || agent.state === 'unknown') return pick('no_messages');
  return pick('answering');
}

/**
 * «الاشتراك» on the fleet table: free days left, paid-until, or how late. `connected` decides
 * whether a shop without a contract has not started yet or is live with nothing sold.
 */
function subscriptionColumn(contract, { connected = false, now = Date.now() } = {}) {
  if (!contract) {
    return connected ? { state: 'none', label_ar: labels.SUBSCRIPTION_STATUS_AR.none } : { state: 'unstarted', label_ar: 'لم يبدأ' };
  }
  const due = contract.next_due_at ? time(contract.next_due_at) : null;
  const lateDays = due !== null && due < now ? Math.ceil((now - due) / DAY_MS) : 0;
  if (contract.status === 'past_due' || (lateDays > 0 && ['active', 'trial'].includes(contract.status))) {
    return { state: 'late', label_ar: lateDays > 0 ? `متأخر ${labels.days(lateDays)}` : 'متأخر', late_days: lateDays };
  }
  if (contract.status === 'trial') {
    const ends = contract.trial_ends_at ? time(contract.trial_ends_at) : due;
    if (!ends) return { state: 'trial', label_ar: 'مجاني' };
    const left = Math.ceil((ends - now) / DAY_MS);
    return { state: 'trial', label_ar: left > 0 ? `مجاني — باقي ${labels.days(left)}` : 'انتهت الفترة المجانية', days_left: Math.max(left, 0) };
  }
  if (contract.status === 'active') {
    return { state: 'paid', label_ar: due ? `مدفوع حتى ${labels.shortDate(contract.next_due_at)}` : 'فعّال' };
  }
  return { state: contract.status, label_ar: labels.SUBSCRIPTION_STATUS_AR[contract.status] || labels.SUBSCRIPTION_STATUS_AR.none };
}

// metaAttention (services/metaStatus.js) category → the spec's rule.
function metaRule(item) {
  if (item.category === 'meta_quality') return item.severity === 'critical' ? 'meta_quality_red' : 'meta_quality_yellow';
  if (item.category === 'meta_name') return 'name_declined';
  return 'meta_number';
}

/**
 * The attention items for one shop. Pure: every input is read by the caller, in one grouped query
 * per signal for the whole fleet, so the overview stays one round of queries however many shops.
 *
 * Returns [{rule, category, severity, text_ar, since}]; `category` keeps the name the fleet view
 * used before the spec's names (meta_quality, meta_name), so an old filter still matches.
 *
 * @param {object} c
 * @param {object} c.business        the Business row (status, ai_config, wa_*, connected_at, went_live_at, is_internal)
 * @param {object|null} c.onboarding  its WhatsappOnboarding row
 * @param {Array} [c.events]          its AccountEvents, newest first
 * @param {object} [c.owner]          {active, last_login} of the business_owner
 * @param {object|null} [c.invite]    the owner's newest unused activation {expires_at}
 * @param {object} [c.agent]          agentState()
 * @param {string} [c.bucket]         lifecycle()
 * @param {object} [c.waiting]        {count, oldest} unanswered conversations
 * @param {object} [c.handoff]        {count, oldest} handed-over conversations left waiting
 * @param {number} [c.knowledgeCount]
 * @param {object|null} [c.usage]     {ai_replies_month, cap}
 * @param {object|null} [c.contract]  the live contract (any solution)
 * @param {object|null} [c.botContract] the live Karam Bot contract
 * @param {boolean} [c.trialPaid]     a payment exists on the bot contract
 * @param {Array} [c.metaItems]       metaAttention(onboarding)
 * @param {Date|null} [c.lastActivity]
 * @param {boolean} [c.exempt]        SHIFT's own row and the internal ones: no cap rules
 * @param {Function} [c.paymentText]  (state) → the shared payment wording (config/metaNotices.js)
 * @param {number} [c.now]
 */
function shopAttention(c) {
  const now = c.now || Date.now();
  const b = c.business;
  const o = c.onboarding || null;
  const events = c.events || [];
  const out = [];
  // Minutes before `now` (the caller's clock, so the rules are testable at any instant).
  const mins = (d) => (d ? (now - time(d)) / 60000 : null);
  const push = (rule, text, since, category = rule) => out.push({
    rule, category, severity: labels.RULES[rule].severity, text_ar: String(text).slice(0, 200), since: since || null,
  });
  const has = (rule) => out.some((i) => i.rule === rule);
  const connected = Boolean(b.wa_phone_number_id);
  const paused = c.agent ? c.agent.state === 'paused' : b.ai_config?.enabled === false;
  const outcome = esOutcome(events);

  // ── Meta and the connection ──────────────────────────────────────────────
  if (o && o.payment_blocked_at) push('payment_blocked', c.paymentText ? c.paymentText('blocked') : 'رفضت واتساب ردود البوت — طريقة الدفع لدى Meta', o.payment_blocked_at);
  if (o && o.revoked_at) {
    push('partner_removed', o.revoked_reason === 'token_invalid'
      ? 'توقف مفتاح الوصول إلى واتساب — البوت لا يستقبل الرسائل'
      : 'أزال الزبون صلاحية شِفت من حسابه في Meta — البوت لا يستقبل الرسائل', o.revoked_at);
  }
  const restriction = events.find((e) => e.type === 'meta_restriction' && !e.resolved_at);
  if (restriction && ageMs(restriction.created_at, now) < RESTRICTION_DAYS * DAY_MS) {
    const until = labels.restrictionUntil(restriction);
    if (!until || until.getTime() > now) {
      push('meta_restriction', `قيّدت Meta حساب واتساب: ${labels.restrictionAr(restriction)}${until ? ` حتى ${labels.shortDate(until)}` : ''}`, restriction.created_at);
    }
  }
  if (o && o.last_error && o.step !== 'done') {
    push('es_failed', `تعثّر الربط عند: ${labels.ONBOARDING_STOP_AR[o.step] || 'إحدى خطوات الربط'}`, o.last_error_at || o.updated_at);
  } else if (!connected && outcome && outcome.kind === 'failed') {
    const d = outcome.event.data || {};
    push('es_failed', `تعثّر الربط عند: ${labels.ES_STAGE_AR[d.stage] || (d.current_step ? labels.metaStepLabel(d.current_step) : 'إحدى خطوات الربط')}`, outcome.event.created_at);
  }
  if ((o && o.needs_operator) || (!connected && outcome && outcome.kind === 'needs_operator')) {
    const e = outcome && outcome.kind === 'needs_operator' ? outcome.event : null;
    let why = 'لم يُحدَّد الرقم';
    if (e && e.type === 'wrong_number') why = 'قال الزبون إنه ليس رقمه';
    else if (e && e.type === 'es_conflict') why = 'الرقم مربوط بحساب آخر';
    push('needs_operator', `الربط يحتاج شِفت: ${why}`, (e && e.created_at) || (o && o.updated_at));
  }
  if (!connected && outcome && outcome.kind === 'cancelled' && ageMs(outcome.event.created_at, now) > ES_CANCELLED_HOURS * 3600000) {
    const step = labels.metaStepLabel((outcome.event.data || {}).current_step) || 'إحدى خطوات Meta';
    push('es_cancelled', `أغلق نافذة Meta عند: ${step} — منذ ${shortDuration(mins(outcome.event.created_at))}`, outcome.event.created_at);
  }
  if (connected && !b.wa_access_token && !(o && o.revoked_at)) push('connection', 'الحساب بدون رمز وصول — لن تصل الرسائل', b.updated_at);
  if (o && o.step !== 'done' && !has('es_failed') && !has('needs_operator')) {
    push('onboarding_incomplete', `التوصيل لم يكتمل — توقف عند: ${labels.ONBOARDING_STOP_AR[o.step] || 'إحدى خطوات الربط'}`, o.updated_at);
  }
  // Meta 131042 is the only evidence there is; short of it, a confirmation nobody made yet, and
  // only 48 h after connecting.
  if (o && !o.payment_blocked_at && o.step === 'done' && !o.payment_method_ok) {
    const connectedAt = b.connected_at || o.registered_at || o.updated_at;
    if (connectedAt && mins(connectedAt) > PAYMENT_UNCONFIRMED_HOURS * 60) {
      const state = o.payment_method_claimed_at ? 'claimed' : 'missing';
      const base = c.paymentText ? c.paymentText(state) : 'بطاقة الدفع لدى Meta غير مؤكدة';
      push('payment_unconfirmed', `${base} — منذ ${shortDuration(mins(connectedAt))}`, connectedAt);
    }
  }
  for (const m of c.metaItems || []) push(metaRule(m), metaRule(m) === 'meta_number' ? 'حالة الرقم لدى Meta ليست «متصل» — قد لا تصل الرسائل' : m.message, o && o.meta_checked_at, m.category);
  if (o && o.meta_name_status === 'PENDING_REVIEW') push('name_pending', 'الاسم الظاهر قيد مراجعة Meta', o.meta_checked_at);

  // ── The join link ────────────────────────────────────────────────────────
  const signedIn = Boolean(c.owner && c.owner.last_login) || Boolean(newest(events, 'password_set'));
  if (!connected && c.owner && !signedIn) {
    const expiredEvent = newest(events, 'invite_expired');
    const reissued = newest(events, ['invite_created', 'invite_cancelled']);
    const inviteExpired = c.invite
      ? time(c.invite.expires_at) < now
      : Boolean(expiredEvent) && after(expiredEvent, reissued);
    const opened = newest(events, 'join_opened');
    const shared = newest(events, 'invite_shared');
    if (inviteExpired) {
      push('invite_expired', 'انتهت دعوة الانضمام دون استخدام', (c.invite && c.invite.expires_at) || (expiredEvent && expiredEvent.created_at));
    } else if (opened && ageMs(opened.created_at, now) > JOIN_STALLED_HOURS * 3600000) {
      push('join_stalled', `فتح رابط الانضمام ولم يكمل منذ ${shortDuration(mins(opened.created_at))}`, opened.created_at);
    } else if (shared && !after(opened, shared) && c.invite && ageMs(shared.created_at, now) > INVITE_UNOPENED_HOURS * 3600000) {
      push('invite_not_opened', `لم يفتح رابط الانضمام بعد (أُرسل قبل ${shortDuration(mins(shared.created_at))})`, shared.created_at);
    }
  } else if (!connected && signedIn && !outcome) {
    // Signed in and never tried Meta's window: the link was used, the connection was not.
    const opened = newest(events, 'join_opened');
    if (opened && ageMs(opened.created_at, now) > JOIN_STALLED_HOURS * 3600000) {
      push('join_stalled', `فتح رابط الانضمام ولم يكمل منذ ${shortDuration(mins(opened.created_at))}`, opened.created_at);
    }
  }

  // ── The bot ──────────────────────────────────────────────────────────────
  // A paused bot is silent on purpose: its waiting customers are the shop team's to answer.
  if (c.waiting && c.waiting.count > 0 && !paused) {
    const since = shortDuration(mins(c.waiting.oldest));
    push('unanswered', c.waiting.count === 1
      ? `زبون ينتظر ردًا منذ ${since}`
      : `${c.waiting.count} زبائن ينتظرون ردًا — أقدمهم منذ ${since}`, c.waiting.oldest);
  }
  if (c.handoff && c.handoff.count > 0) {
    push('handoff_waiting', c.handoff.count === 1
      ? 'محادثة محوّلة لفريق المحل بلا رد منذ أكثر من ساعة'
      : `${c.handoff.count} محادثات محوّلة لفريق المحل بلا رد منذ أكثر من ساعة`, c.handoff.oldest);
  }
  // Softened: before a number is connected an empty knowledge base is a setup step.
  if (connected && !WORKFLOW_TYPES.includes(b.business_type) && (c.knowledgeCount || 0) === 0) {
    push('no_knowledge', 'لم تُدخل معلومات المحل — البوت يرحّب فقط', b.connected_at || b.created_at);
  }
  const usage = c.usage;
  if (usage && usage.cap > 0 && !c.exempt) {
    const shown = `(${labels.count(usage.ai_replies_month)} / ${labels.count(usage.cap)})`;
    if (usage.ai_replies_month >= usage.cap) {
      push('cap_reached', c.botContract && c.botContract.status === 'trial'
        ? `وصل حد ردود الشهر ${shown} — البوت يحوّل الزبائن للفريق`
        : `وصل حد ردود الشهر ${shown} — اشتراك مدفوع، البوت مستمر`, null);
    } else if (usage.ai_replies_month >= Math.ceil(usage.cap * 0.8)) {
      push('cap_80', `استهلك 80% من ردود الشهر ${shown}`, null);
    }
  }
  if (b.went_live_at && ageMs(b.went_live_at, now) < WENT_LIVE_HOURS * 3600000 && ageMs(b.went_live_at, now) >= 0) {
    push('went_live', `${b.name} يعمل — أول رد للبوت`, b.went_live_at);
  }

  // ── Money ────────────────────────────────────────────────────────────────
  const contract = c.contract || null;
  const bot = c.botContract || null;
  if (bot && bot.status === 'trial' && bot.trial_ends_at && !c.trialPaid) {
    const left = time(bot.trial_ends_at) - now;
    if (left >= 0 && left <= TRIAL_ENDING_DAYS * DAY_MS) {
      const n = Math.ceil(left / DAY_MS);
      push('trial_ending', n <= 0
        ? 'الشهر المجاني ينتهي اليوم — لا دفعة مسجّلة'
        : `الشهر المجاني ينتهي خلال ${labels.days(n)} — لا دفعة مسجّلة`, bot.trial_ends_at);
    }
  }
  const dueInDays = contract && contract.next_due_at ? Math.ceil((time(contract.next_due_at) - now) / DAY_MS) : null;
  if (contract && contract.status === 'past_due') {
    push('past_due', `دفعة متأخرة — ${labels.jod(contract.amount_jod)}`, contract.next_due_at);
  } else if (contract && dueInDays !== null && dueInDays < 0) {
    push('overdue', `تجاوز موعد الدفع بـ ${labels.days(Math.abs(dueInDays))} — ${labels.jod(contract.amount_jod)}`, contract.next_due_at);
  } else if (contract && dueInDays !== null && dueInDays <= DUE_SOON_DAYS && !has('trial_ending') && contract.status !== 'trial') {
    push('due_soon', `دفعة مستحقة خلال ${labels.days(dueInDays)} — ${labels.jod(contract.amount_jod)}`, contract.next_due_at);
  }
  // An active, connected account with nothing sold against it: a trial nobody recorded or revenue
  // nobody is collecting. Internal rows never have a contract and never will.
  if (!contract && c.bucket === 'active' && !b.is_internal) push('no_contract', 'لا يوجد عقد مسجّل لهذا الحساب', b.created_at);
  if (c.bucket === 'active' && c.lastActivity && mins(c.lastActivity) > QUIET_HOURS * 60) {
    push('quiet', `لا نشاط منذ ${labels.days(Math.round(mins(c.lastActivity) / 60 / 24))}`, c.lastActivity);
  }
  return out;
}

/**
 * The platform-wide rows (no shop): the AI provider, the daily ceiling and connections that
 * belong to nobody.
 *
 * @param {object} p
 * @param {object|null} p.providerStatus  PlatformSetting provider_status {provider, kind, last_seen}
 * @param {number|null} p.repliesToday
 * @param {number|null} p.ceiling
 * @param {Array} [p.orphans]             [{id, created_at, display}] unattached onboardings and unmatched PARTNER_ADDED
 * @param {number} [p.now]
 */
function platformAttention(p) {
  const now = p.now || Date.now();
  const out = [];
  const push = (rule, text, since, extra = {}) => out.push({
    rule, category: rule, severity: labels.RULES[rule].severity, text_ar: text, since: since || null, ...extra,
  });
  if (providerDown(p.providerStatus, now)) {
    push('provider_down', 'مزوّد الذكاء الاصطناعي متعطّل — الردود تتحول لفرق المحلات', p.providerStatus.last_seen);
  }
  if (p.ceiling > 0 && Number.isFinite(p.repliesToday) && p.repliesToday >= p.ceiling) {
    push('platform_ceiling', 'بلغت ردود البوت اليوم سقف المنصة — ردود التجارب متوقفة حتى منتصف الليل', null);
  }
  for (const o of p.orphans || []) {
    push('orphan_connection', o.display ? `ربط واتساب بدون حساب: ‎${o.display}` : 'ربط واتساب بدون حساب', o.created_at, { ref: o.id });
  }
  return out;
}

/** Whether the AI provider failed within the last 15 minutes (PlatformSetting provider_status). */
function providerDown(status, now = Date.now()) {
  if (!status || !status.last_seen) return false;
  const age = now - time(status.last_seen);
  return Number.isFinite(age) && age >= 0 && age < PROVIDER_DOWN_MINUTES * 60000;
}

/** Critical before warning before info, then the oldest first (no date sorts last). */
function sortAttention(items) {
  const at = (i) => (i.since ? time(i.since) : Infinity);
  return items.sort((a, b) => (labels.SEVERITY_RANK[a.severity] - labels.SEVERITY_RANK[b.severity]) || (at(a) - at(b)));
}

module.exports = {
  connectionState, agentState, lifecycle, minutesSince, isWaiting, isHandoffWaiting, shortDuration,
  whatsappColumn, botColumn, subscriptionColumn, shopAttention, platformAttention, providerDown, sortAttention, esOutcome,
  QUIET_HOURS, UNANSWERED_MINUTES, UNANSWERED_MAX_HOURS, HANDOFF_MINUTES, PAYMENT_UNCONFIRMED_HOURS,
  WORKFLOW_TYPES, PROVIDER_DOWN_MINUTES, DUE_SOON_DAYS,
};
