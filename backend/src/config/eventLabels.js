'use strict';

/**
 * Every Arabic word SHIFT's operator panel shows for a stored code, in one place
 * (docs/panels/spec.md «Operator panel», «Attention rules»).
 *
 * The routes store codes (AccountEvent.type, a subscription's status, a derived stage) and the
 * panel shows sentences. When those sentences were written next to each query, the same event read
 * three ways on three screens, and a new type showed up as its English constant. Here a type the
 * map does not know still reads as Arabic («حدث في الحساب»), never as «es_ownership_mismatch».
 *
 * Nothing here reads the database; callers pass what the sentence needs. Dates are day/month
 * numbers in Amman time: month names read differently in Jordan and the Gulf, and the panels
 * already write dates that way (accountsDaily.shortDate).
 */

const TIME_ZONE = 'Asia/Amman';

// ─── formatting ────────────────────────────────────────────────────────────

/** «15/10» in Amman time; null for a missing or unreadable date. */
function shortDate(d) {
  if (!d) return null;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, day: 'numeric', month: 'numeric' }).formatToParts(t)) parts[p.type] = Number(p.value);
  return `${parts.day}/${parts.month}`;
}

/** «19.99 د.أ», «1,250 د.أ». */
function jod(amount) {
  const n = Math.round(Number(amount || 0) * 100) / 100;
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} د.أ`;
}

/** «1,000». */
function count(n) {
  return Number(n || 0).toLocaleString('en-US');
}

/** «يوم واحد», «يومان», «5 أيام», «12 يومًا»: Arabic number agreement for days. */
function days(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (v === 1) return 'يوم واحد';
  if (v === 2) return 'يومان';
  if (v >= 3 && v <= 10) return `${v} أيام`;
  return `${v} يومًا`;
}

// ─── stages, states, statuses ──────────────────────────────────────────────

/** The fleet table's «المرحلة» chip and the «مسار الانضمام» counts. */
const STAGE_AR = Object.freeze({
  invite_sent: 'أُرسل الرابط',
  invite_opened: 'فتح الرابط',
  invite_expired: 'انتهت الدعوة',
  connecting: 'يربط واتساب',
  awaiting_card: 'بانتظار البطاقة',
  teaching: 'يعلّم البوت',
  awaiting_first_customer: 'بانتظار أول زبون',
  live: 'يعمل',
  paused: 'موقوف مؤقتًا',
  suspended: 'موقوف',
});

/** «واتساب» column: a dot colour and one word. */
const WHATSAPP_AR = Object.freeze({
  connected: { tone: 'green', label_ar: 'متصل' },
  card_unconfirmed: { tone: 'amber', label_ar: 'بدون بطاقة مؤكدة' },
  payment_blocked: { tone: 'red', label_ar: 'الدفع مرفوض' },
  removed: { tone: 'red', label_ar: 'مفصول من Meta' },
  failed: { tone: 'red', label_ar: 'تعثّر الربط' },
  not_connected: { tone: 'grey', label_ar: 'غير مربوط' },
});

/** «البوت» column. */
const BOT_AR = Object.freeze({
  answering: { tone: 'green', label_ar: 'يرد' },
  no_knowledge: { tone: 'amber', label_ar: 'بدون معلومات' },
  paused: { tone: 'grey', label_ar: 'موقوف مؤقتًا' },
  cap_reached: { tone: 'red', label_ar: 'وصل حد الشهر' },
  unanswered: { tone: 'red', label_ar: 'رسالة بدون رد' },
  no_messages: { tone: 'grey', label_ar: 'لا رسائل بعد' },
});

const SUBSCRIPTION_STATUS_AR = Object.freeze({
  trial: 'فترة مجانية',
  active: 'فعّال',
  past_due: 'متأخر',
  paused: 'موقوف',
  cancelled: 'ملغى',
  none: 'بدون عقد',
});

const PAYMENT_METHOD_AR = Object.freeze({
  cliq: 'كليك',
  bank_transfer: 'تحويل بنكي',
  cash: 'نقدًا',
  card: 'بطاقة',
  other: 'أخرى',
});

/** «إعدادات المنصة» block names, for the log line a save leaves. */
const SETTING_AR = Object.freeze({
  es_owner_enabled: 'الربط الذاتي',
  campaign: 'العرض الحالي',
  ai_limits: 'حدود الذكاء الاصطناعي',
  payment_instructions: 'طرق الدفع التي يراها الزبون',
  late_policy: 'سياسة التأخر',
  invite_ttl_days: 'مدة صلاحية رابط الانضمام',
  shift_alert_numbers: 'أرقام شِفت للتنبيهات',
  self_signup: 'التسجيل الذاتي العام',
  coexistence: 'التطبيق والمنصة معًا',
  provider_status: 'حالة مزوّد الذكاء الاصطناعي',
});

const ROLE_AR = Object.freeze({
  business_owner: 'صاحب المحل',
  manager: 'مدير',
  staff: 'موظف',
  platform_admin: 'شِفت',
});

// ─── attention rules ───────────────────────────────────────────────────────

/** The fix buttons on «يحتاج انتباهك». `kind` is what the panel wires; label_ar is the button. */
const ACTIONS = Object.freeze({
  message_owner: 'راسله',
  connect: 'اربط معه',
  confirm_card: 'أكّد البطاقة',
  record_payment: 'سجّل دفعة',
  resend_link: 'أعد إرسال الرابط',
  pause_bot: 'أوقف البوت مؤقتًا',
  open_inbox: 'افتح المحادثات',
  open_knowledge: 'افتح المعرفة',
  open_onboarding: 'افتح الانضمام',
  open_settings: 'افتح الإعدادات',
  open_account: 'افتح الحساب',
});

/**
 * Each rule's severity and fix button (spec «Attention rules»). The panel sorts critical >
 * warning > info, then oldest first.
 */
const RULES = Object.freeze({
  payment_blocked: { severity: 'critical', action: 'message_owner' },
  partner_removed: { severity: 'critical', action: 'connect' },
  meta_restriction: { severity: 'critical', action: 'message_owner' },
  unanswered: { severity: 'critical', action: 'open_inbox' },
  es_failed: { severity: 'critical', action: 'connect' },
  needs_operator: { severity: 'critical', action: 'open_onboarding' },
  meta_quality_red: { severity: 'critical', action: 'message_owner' },
  meta_number: { severity: 'critical', action: 'message_owner' },
  provider_down: { severity: 'critical', action: 'open_settings' },
  platform_ceiling: { severity: 'critical', action: 'open_settings' },
  past_due: { severity: 'critical', action: 'record_payment' },
  connection: { severity: 'critical', action: 'connect' },
  payment_unconfirmed: { severity: 'warning', action: 'confirm_card' },
  handoff_waiting: { severity: 'warning', action: 'message_owner' },
  es_cancelled: { severity: 'warning', action: 'message_owner' },
  join_stalled: { severity: 'warning', action: 'message_owner' },
  orphan_connection: { severity: 'warning', action: 'open_onboarding' },
  onboarding_incomplete: { severity: 'warning', action: 'connect' },
  no_knowledge: { severity: 'warning', action: 'open_knowledge' },
  cap_80: { severity: 'warning', action: 'message_owner' },
  cap_reached: { severity: 'warning', action: 'message_owner' },
  trial_ending: { severity: 'warning', action: 'record_payment' },
  overdue: { severity: 'warning', action: 'record_payment' },
  meta_quality_yellow: { severity: 'warning', action: 'message_owner' },
  name_declined: { severity: 'warning', action: 'message_owner' },
  invite_not_opened: { severity: 'info', action: 'message_owner' },
  invite_expired: { severity: 'info', action: 'resend_link' },
  name_pending: { severity: 'info', action: 'open_account' },
  went_live: { severity: 'info', action: 'open_account' },
  due_soon: { severity: 'info', action: 'record_payment' },
  quiet: { severity: 'info', action: 'message_owner' },
  no_contract: { severity: 'info', action: 'record_payment' },
});

const SEVERITY_RANK = Object.freeze({ critical: 0, warning: 1, info: 2 });

/** {kind, label_ar} for a rule's fix button. */
function actionFor(rule) {
  const kind = (RULES[rule] && RULES[rule].action) || 'open_account';
  return { kind, label_ar: ACTIONS[kind] };
}

// Meta's restriction codes (account_update restriction_info[].restriction_type), read by keyword.
function restrictionAr(event) {
  const d = (event && event.data) || {};
  if (d.event === 'DISABLED_UPDATE' || d.ban_info) return 'حظر الحساب';
  if (d.event === 'ACCOUNT_VIOLATION' || d.violation_info) return 'مخالفة لسياسات واتساب';
  const info = Array.isArray(d.restriction_info) ? d.restriction_info[0] : d.restriction_info;
  const type = String((info && info.restriction_type) || '').toUpperCase();
  if (type.includes('CUSTOMER_INITIATED')) return 'الرد على الزبائن';
  if (type.includes('BIZ_INITIATED') || type.includes('BUSINESS_INITIATED')) return 'بدء المحادثات';
  if (type.includes('ADD_PHONE')) return 'إضافة أرقام';
  return 'قيد على الإرسال';
}

/** When Meta says a restriction ends, if it says. */
function restrictionUntil(event) {
  const d = (event && event.data) || {};
  const info = Array.isArray(d.restriction_info) ? d.restriction_info[0] : d.restriction_info;
  const raw = info && (info.expiration || info.expiration_time || info.expires_at);
  if (!raw) return null;
  const t = typeof raw === 'number' ? new Date(raw * (raw < 1e12 ? 1000 : 1)) : new Date(raw);
  return Number.isNaN(t.getTime()) ? null : t;
}

/**
 * Meta's popup step names (the CANCEL event's current_step) are not documented; they are read by
 * keyword so nobody sees an English constant (the same reading as frontend ConnectWhatsApp.jsx).
 */
function metaStepLabel(step) {
  const s = String(step || '').toUpperCase();
  if (!s) return null;
  if (s.includes('VERIF') || s.includes('OTP') || s.includes('CODE')) return 'التحقق من الرقم';
  if (s.includes('PHONE') || s.includes('NUMBER')) return 'إدخال الرقم';
  if (s.includes('PROFILE') || s.includes('NAME')) return 'اسم النشاط';
  if (s.includes('WABA') || s.includes('WHATSAPP')) return 'حساب واتساب للأعمال';
  if (s.includes('BUSINESS') || s.includes('PORTFOLIO')) return 'اختيار حساب الأعمال';
  if (s.includes('LOGIN') || s.includes('AUTH')) return 'تسجيل الدخول إلى فيسبوك';
  if (s.includes('PERMISSION') || s.includes('CONSENT')) return 'الموافقة على الصلاحيات';
  return 'إحدى خطوات Meta';
}

// Our onboarding steps, as «where it stopped» (the step after the last one that finished).
const ONBOARDING_STOP_AR = Object.freeze({
  code_received: 'استلام الموافقة',
  token_exchanged: 'ربط الرقم بكرم بوت',
  subscribed: 'تسجيل الرقم',
  registered: 'إكمال الربط',
});

// ─── the activity log ──────────────────────────────────────────────────────

const ES_STAGE_AR = Object.freeze({
  exchange: 'استلام الموافقة',
  verify: 'التحقق من الحساب',
  onboarding: 'حفظ الربط',
  number: 'تحديد الرقم',
  subscribe: 'ربط الرقم بكرم بوت',
  register: 'تسجيل الرقم',
  link: 'إكمال الربط',
});

// BusinessKnowledge.kind, as «أضاف معلومة: الدوام» reads it.
const KNOWLEDGE_KIND_AR = Object.freeze({
  hours: 'الدوام', faq: 'سؤال وجواب', service: 'خدمة', policy: 'سياسة',
});

// menu_changed / clinic_changed (middleware/recordCatalogChange.js): what changed, by route.
const MENU_WHAT_AR = Object.freeze({
  categories: 'قسم', items: 'صنف', 'modifier-groups': 'خيارات صنف',
});
const CLINIC_WHAT_AR = Object.freeze({
  services: 'خدمة', doctors: 'طبيب', slots: 'موعد متاح',
});
const CATALOG_ACTION_AR = Object.freeze({ added: 'أضاف', updated: 'عدّل', removed: 'حذف' });
function catalogText(area, whatAr, d) {
  const verb = CATALOG_ACTION_AR[d.action] || 'عدّل';
  const what = whatAr[d.what];
  if (!what) return `${verb} في ${area}`;
  return `${verb} ${what}${d.name ? ` «${d.name}»` : ''} في ${area}`;
}

const PAUSE_REASON_AR = Object.freeze({
  late_payment: 'تأخر الدفع',
});

const reasonOf = (d) => {
  if (!d || !d.reason) return '';
  const r = PAUSE_REASON_AR[d.reason] || String(d.reason);
  return ` — السبب: ${r}`;
};

// The two coexistence syncs, by Meta's sync_type.
const COEX_SYNC_AR = Object.freeze({
  smb_app_state_sync: 'جهات الاتصال',
  history: 'المحادثات السابقة',
});

/**
 * One sentence per event type. `d` is the event's data (already free of secrets: accountEvents
 * strips them on write). Kept short: it follows «10:32 · مطعم الشام ·» on «آخر ما حصل».
 */
const EVENT_AR = Object.freeze({
  // A self-signup is a shop nobody at SHIFT has met: the log says so.
  business_created: (d) => (d.source === 'self_signup' ? 'سجّل صاحب المحل بنفسه من «جرّب مجانًا»' : 'أُنشئ الحساب'),
  self_signup_code: () => 'أُرسل رمز تأكيد الموبايل لصاحب المحل',
  self_signup_verified: () => 'أكّد صاحب المحل رقم موبايله من واتساب',
  self_signup_phone_taken: () => 'أكّد صاحب المحل موبايلًا مسجّلًا لحساب آخر — لم يُربط بهذا الحساب',
  invite_created: (d) => (d.reissued ? 'أُنشئ رابط انضمام جديد' : 'أُنشئ رابط الانضمام'),
  invite_shared: () => 'أُرسل رابط الانضمام على واتساب',
  join_opened: () => 'فتح صاحب المحل رابط الانضمام',
  password_set: () => 'اختار صاحب المحل كلمة المرور',
  invite_expired: () => 'انتهت صلاحية رابط الانضمام دون استخدام',
  invite_cancelled: () => 'أُلغيت دعوة الانضمام',
  es_started: () => 'بدأ ربط واتساب',
  es_cancelled: () => 'أُغلقت نافذة Meta قبل إكمال الربط',
  es_failed: (d) => (d.stage && ES_STAGE_AR[d.stage] ? `تعثّر ربط واتساب عند: ${ES_STAGE_AR[d.stage]}` : 'تعثّر ربط واتساب'),
  es_conflict: () => 'الرقم مربوط بحساب آخر لدى شِفت',
  es_ownership_mismatch: () => 'الرقم لا يتبع حساب فيسبوك الذي ربط منه',
  es_connected: () => 'رُبط واتساب',
  wrong_number: () => 'قال صاحب المحل إن الرقم ليس رقم محله',
  partner_added: () => 'أضاف صاحب المحل شِفت إلى حسابه في Meta',
  partner_added_matched: () => 'أضاف صاحب المحل شِفت إلى حسابه في Meta',
  partner_added_unmatched: () => 'ربط واتساب بدون حساب لدى شِفت',
  partner_removed: () => 'أزال صاحب المحل صلاحية شِفت من حسابه في Meta',
  partner_reconnected: () => 'أعاد صاحب المحل صلاحية شِفت في Meta',
  meta_restriction: (d) => `قيّدت Meta حساب واتساب: ${restrictionAr({ data: d })}`,
  token_invalid: () => 'توقف مفتاح الوصول إلى واتساب عن العمل',
  payment_claimed: () => 'قال صاحب المحل إنه أضاف بطاقة الدفع لدى Meta',
  payment_confirmed: () => 'أكّدت شِفت بطاقة الدفع لدى Meta',
  payment_confirmation_removed: () => 'أُلغي تأكيد بطاقة الدفع لدى Meta',
  payment_blocked: () => 'رفضت واتساب ردود البوت — طريقة الدفع لدى Meta',
  knowledge_added: (d) => {
    if (d.from_gap) return 'علّم البوت جوابًا لسؤال لم يعرفه';
    return KNOWLEDGE_KIND_AR[d.kind] ? `أضاف معلومة: ${KNOWLEDGE_KIND_AR[d.kind]}` : 'أضاف معلومة للبوت';
  },
  knowledge_updated: (d) => (KNOWLEDGE_KIND_AR[d.kind] ? `عدّل معلومة: ${KNOWLEDGE_KIND_AR[d.kind]}` : 'عدّل معلومة للبوت'),
  knowledge_removed: (d) => (KNOWLEDGE_KIND_AR[d.kind] ? `حذف معلومة: ${KNOWLEDGE_KIND_AR[d.kind]}` : 'حذف معلومة من البوت'),
  menu_changed: (d) => catalogText('القائمة', MENU_WHAT_AR, d),
  clinic_changed: (d) => catalogText('خدمات العيادة', CLINIC_WHAT_AR, d),
  went_live: () => 'يعمل — أول رد للبوت على زبون',
  bot_handoff: () => 'حوّل البوت سؤالًا لم يعرف جوابه لفريق المحل',
  bot_paused: (d) => `أُوقف البوت مؤقتًا${reasonOf(d)}`,
  bot_resumed: (d) => `أُعيد تشغيل البوت${d.reason === 'payment_recorded' ? ' بعد تسجيل الدفعة' : ''}`,
  cap_80: (d) => `استهلك 80% من ردود الشهر${d.used && d.cap ? ` (${count(d.used)} / ${count(d.cap)})` : ''}`,
  cap_reached: (d) => `وصل حد ردود الشهر${d.used && d.cap ? ` (${count(d.used)} / ${count(d.cap)})` : ''}`,
  platform_ceiling: () => 'بلغت ردود البوت اليوم سقف المنصة',
  payment_recorded: (d) => `سُجّلت دفعة ${jod(d.amount_jod)}${d.method && PAYMENT_METHOD_AR[d.method] ? ` (${PAYMENT_METHOD_AR[d.method]})` : ''}`,
  contract_created: (d) => `أُنشئ عقد${d.amount_jod != null ? ` بمبلغ ${jod(d.amount_jod)}` : ''}`,
  contract_updated: (d) => (d.status && SUBSCRIPTION_STATUS_AR[d.status] ? `عُدّل العقد — الحالة: ${SUBSCRIPTION_STATUS_AR[d.status]}` : 'عُدّل العقد'),
  late_policy_applied: (d) => `تأخر الدفع ${d.grace_days != null ? `أكثر من ${days(d.grace_days)} ` : ''}— صار الاشتراك متأخرًا`,
  trial_started: () => 'بدأت الفترة المجانية',
  trial_reminder: (d) => (Number(d.days) === 0 ? 'تذكير: الفترة المجانية تنتهي اليوم' : 'تذكير: الفترة المجانية تنتهي خلال 3 أيام'),
  user_added: (d) => `أُضيف دخول${d.role && ROLE_AR[d.role] ? ` (${ROLE_AR[d.role]})` : ''}`,
  role_changed: (d) => `تغيّر دور مستخدم${d.to && ROLE_AR[d.to] ? ` إلى ${ROLE_AR[d.to]}` : ''}`,
  user_deactivated: () => 'عُطّل دخول مستخدم',
  user_reactivated: () => 'أُعيد تفعيل دخول مستخدم',
  login_reset: () => 'أُعيد ضبط دخول مستخدم وأُنشئ رابط جديد',
  settings_changed: () => 'عُدّلت إعدادات الحساب',
  token_set: () => 'حُفظ مفتاح وصول واتساب يدويًا',
  platform_setting_changed: (d) => `عُدّلت «${SETTING_AR[d.key] || 'إعدادات المنصة'}»`,
  owner_alert_template_submitted: () => 'أُرسل قالب تنبيهات صاحب المحل لمراجعة Meta',
  owner_alert_template_approved: () => 'وافقت Meta على قالب تنبيهات صاحب المحل',
  owner_alert_template_failed: () => 'تعذّر إرسال قالب تنبيهات صاحب المحل',
  // Coexistence (services/coexistence.js): the two syncs Meta requires within 24 hours, each named,
  // so «السجل» tells a done sync from a failed or late one (coexistence.md, G1 step 4).
  coex_sync_started: () => 'رُبط الرقم مع تطبيق واتساب للأعمال — بدأت مهلة Meta للمزامنة (24 ساعة)',
  coex_sync_done: (d) => `تمت مزامنة ${COEX_SYNC_AR[d.sync_type] || 'البيانات'} مع Meta`,
  coex_sync_failed: (d) => (d.gave_up
    ? 'توقفت محاولات المزامنة مع Meta بعد انتهاء المهلة — يلزم تدخل شِفت'
    : `تعذّرت مزامنة ${COEX_SYNC_AR[d.sync_type] || 'البيانات'} مع Meta — ستعاد المحاولة`),
  coex_sync_late: () => 'المزامنة مع Meta لم تكتمل وقاربت المهلة على الانتهاء — أُبلغ فريق شِفت',
  coex_history_unavailable: () => 'لم يشارك صاحب المحل المحادثات السابقة من التطبيق',
});

/** The Arabic sentence for one stored AccountEvent. Never throws, never English. */
function eventText(event) {
  const fn = event && EVENT_AR[event.type];
  if (!fn) return 'حدث في الحساب';
  try {
    return fn((event.data && typeof event.data === 'object') ? event.data : {});
  } catch (err) {
    return 'حدث في الحساب';
  }
}

/** Who did it: «صاحب المحل», «شِفت (معتصم)», «Meta», «النظام». `name` is the actor's name, if known. */
function actorText(kind, name) {
  switch (kind) {
    case 'owner': return name ? `صاحب المحل (${name})` : 'صاحب المحل';
    case 'staff': return name ? `فريق المحل (${name})` : 'فريق المحل';
    case 'shift': return name ? `شِفت (${name})` : 'شِفت';
    case 'meta': return 'Meta';
    default: return 'النظام';
  }
}

/** admin_access_logs.action → what SHIFT did, for the shop's «السجل». */
const ACCESS_AR = Object.freeze({
  workspace_list: 'فتح قائمة المحادثات (قراءة فقط)',
  workspace_thread: 'قرأ محادثة (قراءة فقط)',
  workspace_search: 'بحث في المحادثات (قراءة فقط)',
  user_created: 'أنشأ دخولًا جديدًا',
  user_invite: 'أنشأ رابط دخول جديد',
  user_updated: 'عدّل دخول مستخدم',
  user_reset: 'أعاد ضبط دخول مستخدم',
});

function accessText(action) {
  return ACCESS_AR[action] || 'دخل إلى بيانات الحساب';
}

module.exports = {
  STAGE_AR,
  WHATSAPP_AR,
  BOT_AR,
  SUBSCRIPTION_STATUS_AR,
  PAYMENT_METHOD_AR,
  SETTING_AR,
  ROLE_AR,
  ACTIONS,
  RULES,
  SEVERITY_RANK,
  EVENT_AR,
  ONBOARDING_STOP_AR,
  ES_STAGE_AR,
  PAUSE_REASON_AR,
  actionFor,
  metaStepLabel,
  restrictionAr,
  restrictionUntil,
  eventText,
  actorText,
  accessText,
  shortDate,
  jod,
  count,
  days,
};

/**
 * The line «راسله» pre-fills in WhatsApp to the shop's owner, per rule. Written to the owner, not
 * to SHIFT: the attention text («أزال الزبون صلاحية شِفت…») is the operator's own shorthand.
 */
const OWNER_LINE_AR = Object.freeze({
  payment_blocked: 'واتساب رفضت ردود البوت لأن طريقة الدفع لدى Meta لا تعمل. هل نراجعها معًا الآن؟',
  partner_removed: 'يبدو أن صلاحية كرم بوت أُزيلت من حسابكم في Meta، فالبوت لا يستقبل الرسائل. هل نعيد الربط معًا؟',
  meta_restriction: 'وصلنا من Meta أن على رقم واتساب قيدًا. هل نراجعه معًا؟',
  meta_quality_red: 'تقييم رقمكم لدى Meta منخفض والإرسال مقيّد. نود مراجعة الرسائل معكم.',
  meta_quality_yellow: 'تقييم رقمكم لدى Meta بدأ ينخفض. نود مراجعة الرسائل معكم.',
  meta_number: 'رقم واتساب لا يظهر متصلًا لدى Meta. هل نراجعه معًا؟',
  name_declined: 'رفضت Meta الاسم الظاهر للمحل، فيرى الزبائن الرقم بدل الاسم. هل نختار اسمًا آخر معًا؟',
  payment_unconfirmed: 'هل أضفتم بطاقة الدفع لرسوم واتساب لدى Meta؟ بدونها قد تتوقف ردود البوت.',
  handoff_waiting: 'عندكم محادثات حوّلها البوت لفريقكم ولم يُرد عليها بعد.',
  es_cancelled: 'لاحظنا أن ربط واتساب لم يكتمل. هل نكمله معًا؟ يأخذ دقائق.',
  join_stalled: 'لاحظنا أن تفعيل كرم بوت لم يكتمل. هل نكمله معًا؟ يأخذ دقائق.',
  invite_not_opened: 'أرسلنا لكم رابط تفعيل كرم بوت. هل وصلكم؟',
  cap_80: 'استهلك البوت معظم ردود هذا الشهر. نود الحديث معكم عن الباقة.',
  cap_reached: 'وصل البوت لحد ردود هذا الشهر. نود الحديث معكم عن الباقة.',
  quiet: 'لم نلاحظ رسائل على كرم بوت منذ أيام. هل كل شيء على ما يرام؟',
});
const OWNER_LINE_DEFAULT = 'نود الاطمئنان على كرم بوت عندكم. هل تحتاجون أي مساعدة؟';

/** The «راسله» message: «مرحبًا أبو خالد، معك فريق شِفت. …». */
function ownerLine(rule, ownerFirstName) {
  const hello = ownerFirstName ? `مرحبًا ${ownerFirstName}، معك فريق شِفت.` : 'مرحبًا، معك فريق شِفت.';
  return `${hello} ${OWNER_LINE_AR[rule] || OWNER_LINE_DEFAULT}`;
}

module.exports.OWNER_LINE_AR = OWNER_LINE_AR;
module.exports.ownerLine = ownerLine;
