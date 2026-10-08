/**
 * What the customer panel says, as plain functions with no React.
 *
 * The home screen's one honest line, the free-month or late banner, the navigation for each role
 * and shop type, and the Arabic for Meta's own words (name status, quality). Kept apart from the
 * screens so the backend's tests can hold them to the server's output
 * (backend/tests/panelViewContract.test.js): a state the server can be in always has a line here,
 * and never «0 · 0 · 0 · 0» for a shop that is simply not connected yet.
 */

export const SHIFT_WA = '962776788972';

const MONTHS = [
  'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
  'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول',
];

// Amman, fixed: Jordan has had no DST since 2022, so +3 is right all year and a date shown to a
// shop does not depend on the phone's own time zone.
const AMMAN_MS = 3 * 60 * 60 * 1000;

/** «7 كانون الأول» — the Levantine month names the shops use, with Western digits. */
export function dateAr(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const d = new Date(t + AMMAN_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** «يوم واحد», «يومان», «3 أيام», «18 يومًا» — Arabic counts agree with the number. */
export function daysAr(n) {
  const k = Math.max(0, Math.round(Number(n) || 0));
  if (k === 0) return 'أقل من يوم';
  if (k === 1) return 'يوم واحد';
  if (k === 2) return 'يومان';
  if (k <= 10) return `${k} أيام`;
  return `${k} يومًا`;
}

/** «1,000» with Western digits, which is how the plan is sold. */
export function countAr(n) {
  const k = Math.round(Number(n) || 0);
  return String(k).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A wa.me link to SHIFT, prefilled. Free for the shop and needs no template. */
export function shiftWaLink(text) {
  return `https://wa.me/${SHIFT_WA}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** The help line every screen ends with, prefilled with who is writing so SHIFT need not ask. */
export function helpText(user) {
  const who = user?.name ? `أنا ${user.name}` : 'مرحبًا';
  return user?.business_name ? `${who} من ${user.business_name}` : who;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days late, counted from next_due_at. 0 when not late or not knowable. */
export function daysLate(plan, now = Date.now()) {
  if (!plan?.next_due_at) return 0;
  const due = new Date(plan.next_due_at).getTime();
  if (Number.isNaN(due) || now <= due) return 0;
  return Math.floor((now - due) / DAY_MS);
}

/**
 * The banner above the status line: the free month counting down, paid until a date, or late with
 * how long until the bot stops. Null when there is no contract to speak of.
 *
 * @returns {{tone: 'good'|'info'|'warn'|'bad', text: string}|null}
 */
export function planBanner(plan, { graceDays = 7, now = Date.now() } = {}) {
  if (!plan || !plan.status || plan.status === 'none') return null;
  if (plan.status === 'trial') {
    const left = plan.trial_days_left;
    if (left == null) return { tone: 'info', text: 'الشهر الأول مجاني' };
    if (left <= 0) return { tone: 'warn', text: 'انتهى الشهر المجاني — تواصل مع شِفت لتبدأ الاشتراك' };
    return { tone: 'info', text: `الشهر الأول مجاني — باقي ${daysAr(left)}` };
  }
  if (plan.status === 'active') {
    return plan.next_due_at ? { tone: 'good', text: `مدفوع حتى ${dateAr(plan.next_due_at)}` } : { tone: 'good', text: 'اشتراكك فعّال' };
  }
  if (plan.status === 'past_due') {
    const late = daysLate(plan, now);
    const remaining = Math.max(0, graceDays - late);
    const lateText = late > 0 ? `اشتراكك متأخر ${daysAr(late)}` : 'موعد دفعة اشتراكك حان';
    const stopText = remaining > 0
      ? `يتوقف الرد الآلي بعد ${daysAr(remaining)} إن لم تُسجَّل الدفعة`
      : 'يتوقف الرد الآلي قريبًا إن لم تُسجَّل الدفعة';
    return { tone: 'warn', text: `${lateText} — ${stopText}، ورسائل زبائنك تبقى تصل` };
  }
  if (plan.status === 'paused') {
    return { tone: 'bad', text: 'توقف الرد الآلي لتأخر الدفعة — رسائل زبائنك تبقى تصلك في «المحادثات»' };
  }
  return null;
}

// The owner wording of a Meta 131042 refusal (backend config/metaNotices.js, blocked.owner.short)
// and the staff wording connectionState puts on the connection label, which is how the status
// route says it today.
export const BLOCKED_LINE = 'رفضت واتساب ردود البوت — أضف بطاقة دفع لدى Meta';
const BLOCKED_STAFF_LABEL = 'رفضت واتساب ردود البوت — طريقة الدفع لدى Meta';

/** Whether this shop's number is linked at all (as opposed to linked and unwell). */
export function isConnected(status) {
  if (!status) return false;
  if (status.number?.display) return true;
  const state = status.connection?.state;
  return state === 'ok' || state === 'down' || (state === 'degraded' && status.lifecycle !== 'onboarding');
}

/** Whether the owner may run Embedded Signup from the panel (PlatformSetting es_owner_enabled). */
export function ownerCanConnect(status) {
  const step = status?.setup?.steps?.find((s) => s.key === 'connected');
  return Boolean(step && step.action === 'connect') || status?.explain?.action === 'connect';
}

export function capReached(status) {
  const u = status?.usage;
  return Boolean(u && u.cap && Number(u.ai_replies_month) >= Number(u.cap));
}

export function isRevoked(status) {
  return Boolean(status?.revoked || status?.onboarding?.revoked || status?.connection?.revoked);
}

export function isPaymentBlocked(status) {
  return Boolean(
    status?.payment_blocked
    || status?.onboarding?.payment?.blocked
    || status?.connection?.label === BLOCKED_STAFF_LABEL,
  );
}

/**
 * The one honest line on «الرئيسية». The order is what matters: what stops the bot replying is
 * said before what merely limits it, and «البوت يعمل ويرد» only when nothing else is true.
 *
 * @returns {{key: string, tone: 'good'|'warn'|'bad', text: string,
 *   action: 'connect'|'reconnect'|'resume'|'manager'|'billing'|'inbox'|'contact'|null}}
 */
export function statusLine(status, { role = 'business_owner' } = {}) {
  if (!status) return null;
  const owner = role === 'business_owner' || role === 'platform_admin';
  const canConnect = owner && ownerCanConnect(status);

  if (isRevoked(status)) {
    return { key: 'revoked', tone: 'bad', text: 'انفصل كرم بوت عن حسابك في Meta', action: canConnect ? 'reconnect' : 'contact' };
  }
  if (!isConnected(status)) {
    return canConnect
      ? { key: 'not_connected', tone: 'warn', text: 'واتساب غير مربوط بعد — اربطه خلال دقائق', action: 'connect' }
      : { key: 'not_connected', tone: 'warn', text: 'واتساب غير مربوط بعد — فريق شِفت يربطه معك', action: 'contact' };
  }
  if (isPaymentBlocked(status)) {
    return { key: 'payment_blocked', tone: 'bad', text: BLOCKED_LINE, action: owner ? 'manager' : null };
  }
  if (status.plan?.status === 'paused') {
    return { key: 'plan_paused', tone: 'bad', text: 'توقف الرد الآلي لتأخر الدفعة — الرسائل تصلك', action: owner ? 'billing' : 'contact' };
  }
  if (status.agent?.state === 'paused') {
    return { key: 'paused', tone: 'warn', text: 'البوت موقوف مؤقتًا — الرسائل تصلك', action: owner ? 'resume' : null };
  }
  if (capReached(status)) {
    return { key: 'cap', tone: 'warn', text: 'وصل البوت إلى حد ردود هذا الشهر — الرسائل الجديدة بانتظار فريقك', action: 'inbox' };
  }
  if (status.agent?.state === 'down') {
    return { key: 'not_answering', tone: 'bad', text: 'رسالة زبون بلا رد — تواصل مع شِفت', action: 'contact' };
  }
  if (status.connection?.state === 'ok' && ['ok', 'unknown'].includes(status.agent?.state)) {
    return { key: 'ok', tone: 'good', text: 'البوت يعمل ويرد', action: null };
  }
  // Anything else (no card at Meta yet, a shop with nothing taught): the server's own sentence.
  const tone = status.explain?.tone === 'bad' ? 'bad' : status.explain?.tone === 'good' ? 'good' : 'warn';
  return { key: 'explain', tone, text: status.explain?.title || 'تواصل مع شِفت للتأكد', action: null };
}

/** Meta's display-name review, in the owner's words. */
export function nameStatusAr(s) {
  const v = String(s || '').toUpperCase();
  if (v === 'APPROVED' || v === 'AVAILABLE_WITHOUT_REVIEW') return 'مقبول';
  if (v === 'DECLINED' || v === 'REJECTED' || v === 'NON_EXISTS') return 'مرفوض';
  if (v.startsWith('PENDING') || v === 'IN_REVIEW') return 'قيد المراجعة';
  return '';
}

/** Meta's quality rating for the number. */
export function qualityAr(q) {
  const v = String(q || '').toUpperCase();
  if (v === 'GREEN' || v === 'HIGH') return { label: 'جيدة', state: 'ok' };
  if (v === 'YELLOW' || v === 'MEDIUM') return { label: 'متوسطة', state: 'degraded' };
  if (v === 'RED' || v === 'LOW') return { label: 'منخفضة', state: 'down' };
  return { label: 'غير معروفة بعد', state: 'unknown' };
}

/** The Meta card's state, from the status route's fields. */
export function paymentCardAr(status) {
  if (isPaymentBlocked(status)) return { key: 'blocked', label: 'رفضتها Meta — صحّحها في WhatsApp Manager', state: 'down' };
  if (status?.payment_method_ok === true) return { key: 'confirmed', label: 'مؤكدة', state: 'ok' };
  if (status?.payment_method_claimed) return { key: 'claimed', label: 'بانتظار تأكيد شِفت', state: 'degraded' };
  return { key: 'missing', label: 'غير مضافة', state: 'down' };
}

/**
 * Where each role goes, in order. `tabs` is the phone's bottom bar (at most four, then «المزيد»),
 * `more` the rest, and `side` the desktop sidebar, which holds them all.
 *
 * Owners and managers: الرئيسية · المحادثات · البوت · الطلبات/المواعيد (or الاشتراك for a generic
 * shop's owner) · المزيد. Staff: المحادثات · الطلبات. Keys, not icons: the layout picks those.
 */
export function navFor(role, bizType) {
  const ordersLabel = bizType === 'clinic' ? 'المواعيد' : 'الطلبات';
  const hasOrders = !bizType || bizType === 'restaurant' || bizType === 'clinic';
  const owner = role === 'business_owner' || role === 'platform_admin';

  const item = {
    overview: { key: 'overview', to: '/overview', label: 'الرئيسية' },
    inbox: { key: 'inbox', to: '/inbox', label: 'المحادثات' },
    bot: { key: 'bot', to: '/bot', label: 'البوت' },
    orders: { key: 'orders', to: '/orders', label: ordersLabel },
    menu: { key: 'menu', to: '/menu', label: 'القائمة' },
    clinic: { key: 'clinic', to: '/clinic', label: 'الخدمات والأطباء' },
    reports: { key: 'reports', to: '/reports', label: 'التقارير' },
    staff: { key: 'staff', to: '/staff', label: 'الفريق' },
    billing: { key: 'billing', to: '/billing', label: 'الاشتراك' },
    settings: { key: 'settings', to: '/settings', label: 'الإعدادات' },
    help: { key: 'help', href: 'help', label: 'راسل شِفت على واتساب' },
  };

  if (role === 'staff') {
    const tabs = [item.inbox, ...(hasOrders ? [item.orders] : [])];
    const more = [{ ...item.settings, label: 'حسابي' }, item.help];
    return { tabs, more, side: [...tabs, ...more] };
  }

  const catalogue = [
    ...(!bizType || bizType === 'restaurant' ? [item.menu] : []),
    ...(!bizType || bizType === 'clinic' ? [item.clinic] : []),
  ];
  const fourth = hasOrders ? item.orders : owner ? item.billing : item.reports;
  const tabs = [item.overview, item.inbox, item.bot, fourth];
  const rest = [
    ...catalogue,
    item.reports,
    item.staff,
    ...(owner ? [item.billing] : []),
    // A manager's settings are their own account only (the shop's are the owner's).
    owner ? item.settings : { ...item.settings, label: 'حسابي' },
    item.help,
  ].filter((i) => !tabs.includes(i));
  return { tabs, more: rest, side: [...tabs, ...rest] };
}
