/**
 * The operator panel's vocabulary, as plain functions with no React (docs/panels/spec.md,
 * «Operator panel», fleet_table_columns and attention_rules).
 *
 * «اليوم», «الزبائن», the account page and «الاشتراكات والدفعات» all read the same rows, so the
 * words and the decisions live here once: which stage label a key gets, which fix button a rule
 * earns, what the owner is told on WhatsApp, how a column sorts, what the CSV holds. The backend's
 * tests load this file as a script (backend/tests/operatorViewContract.test.js), which is why it
 * imports nothing.
 *
 * The rows are read defensively: the overview grew in phases, and a field the server does not
 * send yet shows as «—», never as a healthy-looking zero or an English key.
 */

// «اليوم» announces its attention count under this name; the shell's nav badge listens.
export const ATTENTION_EVENT = 'shift:attention';

// ─── Stages ───────────────────────────────────────────────────────────────────

// Derived on the server from stored data (adminAccounts.js deriveCard), never stored.
export const STAGE_AR = {
  invite_sent: 'أُرسل الرابط',
  invite_opened: 'فتح الرابط',
  connecting: 'يربط واتساب',
  awaiting_card: 'بانتظار البطاقة',
  teaching: 'يعلّم البوت',
  awaiting_first_customer: 'بانتظار أول زبون',
  live: 'يعمل',
  paused: 'موقوف مؤقتًا',
  suspended: 'موقوف',
  invite_expired: 'انتهت الدعوة',
};

// «مسار الانضمام» on «اليوم», right to left; each count opens «الزبائن?stage=».
export const FUNNEL = [
  ['invite_sent', 'أُرسل الرابط'],
  ['connecting', 'يربط واتساب'],
  ['awaiting_card', 'بانتظار البطاقة'],
  ['teaching', 'يعلّم البوت'],
  ['awaiting_first_customer', 'بانتظار أول زبون'],
  ['live', 'يعمل'],
  ['paused', 'موقوف'],
];

const JOINING = ['invite_sent', 'invite_opened', 'connecting', 'awaiting_card', 'teaching', 'awaiting_first_customer'];
const STOPPED = ['paused', 'suspended'];

// The funnel counts some stages under another chip (admin.js FUNNEL_OF): an opened or expired
// invite is still «أُرسل الرابط», a suspended shop is «موقوف». The chip's ?stage= link must list
// the same shops it counted.
const FUNNEL_OF = { invite_opened: 'invite_sent', invite_expired: 'invite_sent', suspended: 'paused' };
export function stageMatches(rowStage, stage) {
  if (!stage) return true;
  return rowStage === stage || FUNNEL_OF[rowStage] === stage;
}

export const STAGE_TONE = {
  live: 'bg-emerald-50 text-emerald-800',
  paused: 'bg-gray-200 text-gray-700',
  suspended: 'bg-red-50 text-red-700',
  invite_expired: 'bg-red-50 text-red-700',
};

export function stageLabel(stage) {
  return STAGE_AR[stage] || '—';
}

// sector first (a pharmacy is business_type 'generic'), then the workflow type.
export const SECTOR_AR = {
  restaurant: 'مطعم', clinic: 'عيادة', pharmacy: 'صيدلية', salon: 'صالون', clothing: 'محل ملابس',
  shop: 'محل', other: 'نشاط عام', generic: 'نشاط عام', store: 'متجر', shift: 'شِفت',
};

export function sectorLabel(row) {
  return SECTOR_AR[row?.sector] || SECTOR_AR[row?.business_type] || 'نشاط عام';
}

// ─── Fix buttons ──────────────────────────────────────────────────────────────

export const FIX_AR = {
  message: 'راسله',
  connect_with: 'اربط معه',
  confirm_card: 'أكّد البطاقة',
  record_payment: 'سجّل دفعة',
  resend_link: 'أعد إرسال الرابط',
  pause_bot: 'أوقف البوت مؤقتًا',
  // Rows with no shop behind them: the platform itself, or a Meta signup nobody owns yet.
  platform_settings: 'إعدادات المنصة',
  open_onboarding: 'افتح «الانضمام»',
};

/**
 * Per rule: the one fix button and the account tab a click on the row opens. A rule the server
 * adds later falls back to «راسله» on «الحالة», which is never wrong.
 */
export const RULES = {
  payment_blocked: { fix: 'message', tab: 'whatsapp' },
  partner_removed: { fix: 'message', tab: 'whatsapp' },
  meta_restriction: { fix: 'message', tab: 'whatsapp' },
  unanswered: { fix: 'message', tab: 'health' },
  es_failed: { fix: 'connect_with', tab: 'health' },
  needs_operator: { fix: 'connect_with', tab: 'health' },
  meta_quality_red: { fix: 'pause_bot', tab: 'whatsapp' },
  provider_down: { fix: 'platform_settings', tab: null },
  platform_ceiling: { fix: 'platform_settings', tab: null },
  past_due: { fix: 'record_payment', tab: 'contract' },
  payment_unconfirmed: { fix: 'confirm_card', tab: 'health' },
  handoff_waiting: { fix: 'message', tab: 'health' },
  es_cancelled: { fix: 'connect_with', tab: 'health' },
  join_stalled: { fix: 'message', tab: 'health' },
  orphan_connection: { fix: 'open_onboarding', tab: null },
  no_knowledge: { fix: 'message', tab: 'knowledge' },
  cap_80: { fix: 'message', tab: 'health' },
  cap_reached: { fix: 'message', tab: 'health' },
  trial_ending: { fix: 'record_payment', tab: 'contract' },
  overdue: { fix: 'record_payment', tab: 'contract' },
  meta_quality_yellow: { fix: 'message', tab: 'whatsapp' },
  name_declined: { fix: 'message', tab: 'whatsapp' },
  invite_not_opened: { fix: 'resend_link', tab: 'access' },
  invite_expired: { fix: 'resend_link', tab: 'access' },
  name_pending: { fix: null, tab: 'whatsapp' },
  went_live: { fix: 'message', tab: 'health' },
  due_soon: { fix: 'record_payment', tab: 'contract' },
  quiet: { fix: 'message', tab: 'health' },
  no_contract: { fix: 'record_payment', tab: 'contract' },
};

const FIX_KINDS = Object.keys(FIX_AR);

// The server names a fix too ({action: {kind}}, config/eventLabels.js ACTIONS), in its own words.
// Those are translated here; the rest (open_inbox, open_account…) have no button of their own.
const SERVER_FIX = {
  message_owner: 'message', connect: 'connect_with', open_settings: 'platform_settings',
};

// A rule this file knows keeps its own fix: the server's map was written separately and differs
// on purpose-built rows (needs_operator is «اربط معه» on the shop, not the onboarding board;
// meta_quality_red is «أوقف البوت مؤقتًا»). The server's choice only decides for a rule added
// later. An action nobody knows is ignored rather than drawn as raw text.
export function fixFor(item) {
  const rule = item?.rule || item?.category;
  const raw = item?.action && typeof item.action === 'object' ? item.action.kind : item?.action;
  const sent = SERVER_FIX[raw] || raw;
  const kind = RULES[rule] ? RULES[rule].fix : (FIX_KINDS.includes(sent) ? sent : 'message');
  if (!kind) return null;
  // A rule that is about a shop needs one; a platform row cannot be «راسله».
  const accountId = item?.account_id || item?.business_id || null;
  if (!accountId && !['platform_settings', 'open_onboarding'].includes(kind)) return null;
  return { kind, label: FIX_AR[kind] };
}

export function tabFor(item) {
  const rule = item?.rule || item?.category;
  return (RULES[rule] && RULES[rule].tab) || 'health';
}

// ─── Attention rows ───────────────────────────────────────────────────────────

const SEV_RANK = { critical: 0, warning: 1, info: 2 };

/** One attention item in the contract's shape, whichever generation of the overview sent it. */
export function attentionItem(a) {
  return {
    rule: a.rule || a.category || null,
    severity: SEV_RANK[a.severity] === undefined ? 'info' : a.severity,
    account_id: a.account_id || a.business_id || null,
    name: a.name || a.business_name || null,
    text: a.text_ar || a.message || '',
    since: a.since || null,
    action: a.action || null,
  };
}

/** critical > warning > info, then oldest first; a row with no time goes last in its band. */
export function sortAttention(items) {
  const t = (x) => (x.since ? new Date(x.since).getTime() : Number.POSITIVE_INFINITY);
  return [...items].sort((a, b) => (SEV_RANK[a.severity] - SEV_RANK[b.severity]) || (t(a) - t(b)));
}

/** The worst severity per shop, for the row tint on «الزبائن». */
export function worstByAccount(items) {
  const out = new Map();
  for (const it of items) {
    if (!it.account_id) continue;
    const prev = out.get(it.account_id);
    if (!prev || SEV_RANK[it.severity] < SEV_RANK[prev]) out.set(it.account_id, it.severity);
  }
  return out;
}

// ─── راسله ────────────────────────────────────────────────────────────────────

const WA_LINE = {
  payment_blocked: 'واتساب رفض ردود البوت لـ{name} لأن طريقة الدفع عند Meta غير مقبولة. نراجعها سوا؟',
  partner_removed: 'لاحظنا أن صلاحية شِفت أُزيلت من حساب واتساب لـ{name}، فالبوت لا يستقبل الرسائل الآن. نعيد الربط سوا؟',
  meta_restriction: 'Meta قيّدت حساب واتساب لـ{name}. خلّينا نراجع الموضوع معك اليوم.',
  unanswered: 'في زبون ينتظر ردًا في محادثات {name}. تقدر ترد عليه من «المحادثات»؟',
  handoff_waiting: 'في محادثات حوّلها البوت لفريقك في {name} وما زالت تنتظر ردًا.',
  join_stalled: 'شفنا إنك فتحت رابط الانضمام لـ{name}. وين وقفت؟ نكمّل سوا؟',
  no_knowledge: 'البوت في {name} يحتاج معلومات المحل (الدوام، الأسعار، العنوان) حتى يجاوب الزبائن. نعبّيها سوا؟',
  cap_80: 'البوت في {name} استهلك أغلب ردود هذا الشهر. حبينا نطمّنك ونحكي عن الباقة المناسبة.',
  cap_reached: 'البوت في {name} وصل حد ردود هذا الشهر، والمحادثات الجديدة تتحول لفريقك.',
  meta_quality_yellow: 'تقييم جودة رقم {name} عند Meta نزل قليلًا. خلّينا نراجع الردود سوا.',
  name_declined: 'Meta رفضت الاسم الظاهر لرقم {name}، فالزبائن يرون الرقم بدل اسم المحل. نختار اسمًا جديدًا سوا؟',
  went_live: 'مبروك! البوت في {name} رد على أول زبون.',
  quiet: 'ما وصلت رسائل على {name} من كم يوم. كل شي تمام؟',
  invite_not_opened: 'أرسلنا لك رابط الانضمام لـ{name}. وصلك؟',
  invite_expired: 'رابط الانضمام لـ{name} انتهى. نرسل لك رابطًا جديدًا؟',
};

/** The Arabic line «راسله» opens WhatsApp with, per rule; a greeting when the rule has none. */
export function waLine(rule, name, firstName) {
  const hi = firstName ? `مرحبًا ${firstName}، معك شِفت. ` : 'مرحبًا، معك شِفت. ';
  const shop = name || 'محلك';
  const body = WA_LINE[rule] || `بخصوص كرم بوت لـ{name}.`;
  return hi + body.replace(/\{name\}/g, shop);
}

/** wa.me with the line prefilled, or null when there is no mobile to write to. */
export function waLink(phone, text) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** 962791234567 → 079•••4567: enough to recognise, not enough to copy from a screenshot. */
export function maskPhone(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('962')) d = `0${d.slice(3)}`;
  if (d.length < 7) return d;
  return `${d.slice(0, 3)}•••${d.slice(-4)}`;
}

// ─── Fleet rows ───────────────────────────────────────────────────────────────

const DAY_MS = 86400000;

export function daysUntil(iso, now = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now) / DAY_MS);
}

const AR_DATE = 'ar-JO-u-nu-latn';
export function dayMonth(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(AR_DATE, { day: 'numeric', month: 'long' });
}

/** «مجاني — باقي 18 يومًا» · «مدفوع حتى 7 كانون الأول» · «متأخر 5 أيام» · «بدون عقد» · «لم يبدأ». */
export function subscriptionLabel(sub, now = Date.now()) {
  if (!sub || !sub.status || sub.status === 'none') return { text: 'بدون عقد', tone: 'muted' };
  if (sub.status === 'cancelled') return { text: 'ملغى', tone: 'muted' };
  if (sub.status === 'trial') {
    const left = daysUntil(sub.trial_ends_at, now);
    if (left === null) return { text: 'لم يبدأ', tone: 'muted' };
    if (left < 0) return { text: 'انتهت المجانية', tone: 'bad' };
    return { text: `مجاني — باقي ${left} ${left === 1 ? 'يوم' : 'يومًا'}`, tone: left <= 3 ? 'warn' : 'ok' };
  }
  const due = daysUntil(sub.next_due_at, now);
  if (sub.status === 'past_due' || (due !== null && due < 0)) {
    const late = due !== null && due < 0 ? Math.abs(due) : null;
    return { text: late ? `متأخر ${late} ${late === 1 ? 'يوم' : 'أيام'}` : 'متأخر', tone: 'bad' };
  }
  if (sub.status === 'paused') return { text: 'موقوف', tone: 'muted' };
  return { text: sub.next_due_at ? `مدفوع حتى ${dayMonth(sub.next_due_at)}` : 'فعّال', tone: 'ok' };
}

const firstWord = (s) => (s ? String(s).trim().split(/\s+/)[0] : null);

/**
 * One row of «الزبائن», whichever generation of /admin/overview sent it. Newer fields
 * (stage, whatsapp, bot, subscription, owner) win; the older ones (connection, agent, contract)
 * fill in until the server sends them.
 */
// The P4 columns (accountHealth.whatsappColumn/botColumn) name their own states — connected,
// removed, answering… — with a tone. The dots, chips and sort here speak ok/degraded/down/…, so
// the tone decides; a grey bot is «paused» only when it was paused, otherwise just quiet.
const TONE_STATE = { green: 'ok', amber: 'degraded', red: 'down' };
function columnState(col, quiet) {
  if (!col || !col.state) return 'unknown';
  if (!col.tone) return col.state;
  if (col.state === 'paused') return 'paused';
  return TONE_STATE[col.tone] || quiet;
}

export function fleetRow(a) {
  const wa = a.whatsapp || a.connection || {};
  const bot = a.bot || a.agent || {};
  // The P4 `subscription` column is only {state, label_ar}; the status and dates the filters and
  // the sort need stay on `contract`, which the server still sends next to it.
  const subSrc = (a.subscription || a.contract) ? { ...(a.subscription || {}), ...(a.contract || {}) } : null;
  const sub = subSrc ? {
    status: subSrc.status || null,
    trial_ends_at: subSrc.trial_ends_at || a.trial_ends_at || null,
    next_due_at: subSrc.next_due_at || null,
    amount_jod: subSrc.amount_jod ?? null,
  } : (a.trial_ends_at ? { status: 'trial', trial_ends_at: a.trial_ends_at } : null);
  const computed = subscriptionLabel(sub);
  const label = (subSrc && (subSrc.label_ar || subSrc.label)) || a.subscription_label || computed.text;
  const owner = a.owner || null;
  return {
    id: a.id || a.account_id,
    name: a.name || '—',
    sector: a.sector || null,
    business_type: a.business_type || null,
    sector_ar: sectorLabel(a),
    city: a.city || null,
    display_phone: a.display_phone || a.wa_display_phone || null,
    verified_name: a.verified_name || a.wa_verified_name || null,
    meta_name_status: a.name_status || (a.meta && a.meta.name_status) || null,
    is_internal: Boolean(a.is_internal),
    stage: a.stage || null,
    stage_ar: a.stage_ar || stageLabel(a.stage),
    wa: { state: columnState(wa, 'unknown'), label: wa.label_ar || wa.label || '—' },
    bot: { state: columnState(bot, 'idle'), label: bot.label_ar || bot.label || '—' },
    bot_enabled: a.bot_enabled !== false,
    usage: a.usage && a.usage.ai_replies_month !== undefined && a.usage.ai_replies_month !== null ? a.usage : null,
    conversations_7d: a.conversations_7d ?? null,
    sub: { ...(sub || {}), label, tone: computed.tone },
    owner: owner ? {
      first_name: owner.first_name || firstWord(owner.name),
      phone: owner.phone || a.owner_phone || null,
      signed_in: Boolean(owner.signed_in),
      active: owner.active !== false,
      invite_expires_at: owner.invite_expires_at || null,
    } : (a.owner_phone ? { first_name: null, phone: a.owner_phone, signed_in: false, active: true, invite_expires_at: null } : null),
    last_activity: a.last_activity || a.last_activity_at || a.last_inbound_at || null,
  };
}

/** The owner's login in one phrase: «✓ دخل» · «الدعوة تنتهي بعد يومين» · «انتهت الدعوة» · «معطّل». */
export function ownerLoginLabel(owner, now = Date.now()) {
  if (!owner) return { text: '—', tone: 'muted' };
  if (owner.signed_in && owner.active) return { text: '✓ دخل', tone: 'ok' };
  if (owner.signed_in && !owner.active) return { text: 'معطّل', tone: 'bad' };
  const left = daysUntil(owner.invite_expires_at, now);
  if (left === null || left < 0) return { text: 'انتهت الدعوة', tone: 'bad' };
  if (left === 0) return { text: 'الدعوة تنتهي اليوم', tone: 'warn' };
  return { text: `الدعوة تنتهي بعد ${left === 1 ? 'يوم' : left === 2 ? 'يومين' : `${left} أيام`}`, tone: 'warn' };
}

/** Amber at 80%, red at the cap. */
export function usageTone(used, cap) {
  if (!cap) return 'none';
  const r = used / cap;
  if (r >= 1) return 'bad';
  if (r >= 0.8) return 'warn';
  return 'ok';
}

// ─── «الزبائن»: filters, search, sort ─────────────────────────────────────────

export const FLEET_FILTERS = [
  ['all', 'الكل'],
  ['attention', 'يحتاج انتباهًا'],
  ['joining', 'قيد الانضمام'],
  ['live', 'يعمل'],
  ['trial', 'فترة مجانية'],
  ['late', 'متأخر بالدفع'],
  ['stopped', 'موقوف'],
];

export function matchesFilter(row, filter, attentionIds) {
  switch (filter) {
    case 'attention': return attentionIds.has(row.id);
    case 'joining': return JOINING.includes(row.stage);
    case 'live': return row.stage === 'live';
    case 'trial': return row.sub.status === 'trial';
    case 'late': return row.sub.tone === 'bad' && row.sub.status !== 'trial' && row.sub.status !== 'cancelled';
    case 'stopped': return STOPPED.includes(row.stage);
    default: return true;
  }
}

const digitsOf = (s) => String(s || '').replace(/\D/g, '');

/** Name, the shop's number, the owner's mobile (0791… or 962791… alike) and first name. */
export function matchesSearch(row, q) {
  const text = String(q || '').trim().toLowerCase();
  if (!text) return true;
  if (row.name.toLowerCase().includes(text)) return true;
  if (row.owner?.first_name && row.owner.first_name.toLowerCase().includes(text)) return true;
  if (row.city && row.city.toLowerCase().includes(text)) return true;
  let d = digitsOf(text);
  if (d.length >= 3) {
    if (d.startsWith('0')) d = d.slice(1);
    return [row.display_phone, row.owner?.phone].some((p) => digitsOf(p).includes(d));
  }
  return false;
}

const STAGE_ORDER = Object.keys(STAGE_AR);
const STATE_ORDER = ['down', 'degraded', 'paused', 'unknown', 'idle', 'ok'];

// Each column's sort key. Strings compare in Arabic order; a missing value sorts last either way.
export const FLEET_SORT = {
  name: (r) => r.name,
  stage: (r) => (r.stage ? STAGE_ORDER.indexOf(r.stage) : null),
  wa: (r) => STATE_ORDER.indexOf(r.wa.state),
  bot: (r) => STATE_ORDER.indexOf(r.bot.state),
  usage: (r) => (r.usage && r.usage.cap ? r.usage.ai_replies_month / r.usage.cap : null),
  conversations_7d: (r) => r.conversations_7d,
  subscription: (r) => {
    if (r.sub.status === 'trial') return daysUntil(r.sub.trial_ends_at);
    return daysUntil(r.sub.next_due_at);
  },
  owner: (r) => r.owner?.first_name || null,
  last_activity: (r) => (r.last_activity ? new Date(r.last_activity).getTime() : null),
};

export function sortRows(rows, key, dir = 'asc') {
  const keyOf = FLEET_SORT[key];
  if (!keyOf) return rows;
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = keyOf(a);
    const y = keyOf(b);
    const xn = x === null || x === undefined || x === -1;
    const yn = y === null || y === undefined || y === -1;
    if (xn && yn) return 0;
    if (xn) return 1;
    if (yn) return -1;
    if (typeof x === 'string' || typeof y === 'string') return sign * String(x).localeCompare(String(y), 'ar');
    return sign * (x - y);
  });
}

// ─── Billing ──────────────────────────────────────────────────────────────────

export const SUB_STATUS_AR = {
  trial: 'فترة مجانية', active: 'فعّال', past_due: 'متأخر', paused: 'موقوف', cancelled: 'ملغى', none: 'بدون عقد',
};

export const METHOD_AR = { cliq: 'كليك', bank_transfer: 'تحويل بنكي', cash: 'نقدًا', card: 'بطاقة', other: 'أخرى' };

export const BILLING_FILTERS = [
  ['all', 'الكل'],
  ['ending7', 'ينتهي خلال 7 أيام'],
  ['late', 'متأخر'],
  ['no_contract', 'بدون عقد'],
];

export function billingMatches(row, filter, now = Date.now()) {
  const status = row.status || 'none';
  if (filter === 'ending7') {
    const left = daysUntil(row.trial_ends_at, now);
    return status === 'trial' && left !== null && left >= 0 && left <= 7;
  }
  if (filter === 'late') {
    const due = daysUntil(row.next_due_at, now);
    return status === 'past_due' || (['active', 'trial'].includes(status) && due !== null && due < 0);
  }
  if (filter === 'no_contract') return status === 'none' || status === 'cancelled' || !row.status;
  return true;
}

export const jod = (n) => (n === null || n === undefined || Number.isNaN(Number(n))
  ? '—'
  : `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} د.أ`);

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The billing table as CSV, built in the browser so nothing leaves the screen that was not on it.
 * A byte-order mark first: without it Excel opens Arabic UTF-8 as mojibake.
 */
export function billingCsv(rows) {
  const head = ['الزبون', 'الحالة', 'المبلغ (د.أ)', 'تنتهي المجانية', 'الاستحقاق القادم', 'آخر دفعة', 'طريقة آخر دفعة', 'مرجع آخر دفعة', 'الردود', 'الحد'];
  const day = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
  const lines = rows.map((r) => [
    r.name,
    SUB_STATUS_AR[r.status || 'none'] || r.status,
    r.amount_jod ?? '',
    day(r.trial_ends_at),
    day(r.next_due_at),
    day(r.last_payment?.paid_at),
    r.last_payment ? (METHOD_AR[r.last_payment.method] || r.last_payment.method || '') : '',
    r.last_payment?.reference || '',
    r.usage?.ai_replies_month ?? '',
    r.usage?.cap ?? '',
  ].map(csvCell).join(','));
  return `﻿${[head.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
}

// ─── Events ───────────────────────────────────────────────────────────────────

/** «10:32» today, «أمس 18:04», otherwise «7 تشرين الأول 18:04». */
export function eventTime(iso, now = new Date()) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const hm = d.toLocaleTimeString(AR_DATE, { hour: '2-digit', minute: '2-digit', hour12: false });
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
  if (diff === 0) return hm;
  if (diff === 1) return `أمس ${hm}`;
  return `${dayMonth(iso)} ${hm}`;
}

const hasArabic = (s) => /[؀-ۿ]/.test(String(s || ''));

/** The server's Arabic line; a type with no Arabic text is shown as a neutral phrase, never raw. */
export function eventText(e) {
  if (e && hasArabic(e.text_ar)) return e.text_ar;
  return 'تغيير في الحساب';
}
