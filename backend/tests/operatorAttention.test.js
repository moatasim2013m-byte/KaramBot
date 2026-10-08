/**
 * The operator panel's attention rules (docs/panels/spec.md «Attention rules»), one by one: each
 * fires on the evidence the spec names, and stays quiet just short of it. Pure functions
 * (services/accountHealth.js shopAttention, platformAttention and the fleet columns), so every
 * boundary is pinned without a database. The overview route's own tests cover the reads.
 */
require('./setup');

const {
  shopAttention, platformAttention, whatsappColumn, botColumn, subscriptionColumn, sortAttention, providerDown,
} = require('../src/services/accountHealth');
const labels = require('../src/config/eventLabels');

const NOW = new Date('2026-10-20T09:00:00Z').getTime();
const H = 3600000;
const D = 24 * H;
const ago = (ms) => new Date(NOW - ms);
const ahead = (ms) => new Date(NOW + ms);

const shop = (over = {}) => ({
  id: 'b1', name: 'مطعم الشام', status: 'active', business_type: 'restaurant', is_internal: false,
  wa_phone_number_id: 'P1', wa_access_token: 'enc', ai_config: {}, connected_at: ago(10 * D),
  went_live_at: null, created_at: ago(20 * D), updated_at: ago(D), ...over,
});
const ready = (over = {}) => ({
  business_id: 'b1', step: 'done', payment_method_ok: true, payment_method_claimed_at: null, payment_blocked_at: null,
  registered_at: ago(10 * D), needs_operator: false, revoked_at: null, revoked_reason: null, last_error: null,
  updated_at: ago(10 * D), meta_name_status: null, meta_checked_at: ago(H), ...over,
});
let seq = 0;
const ev = (type, at, data = {}, over = {}) => ({ id: `e${++seq}`, type, created_at: at, data, resolved_at: null, ...over });

// A connected, paid, answering shop: the baseline every test changes one thing in.
function run(over = {}) {
  return shopAttention({
    business: shop(over.business),
    onboarding: over.onboarding === undefined ? ready() : over.onboarding,
    events: (over.events || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    owner: over.owner === undefined ? { active: true, last_login: ago(5 * D) } : over.owner,
    invite: over.invite || null,
    agent: over.agent || { state: 'ok' },
    bucket: over.bucket || 'active',
    waiting: over.waiting,
    handoff: over.handoff,
    knowledgeCount: over.knowledgeCount ?? 3,
    usage: over.usage === undefined ? { ai_replies_month: 10, cap: 1000 } : over.usage,
    contract: over.contract === undefined ? { status: 'active', amount_jod: 19.99, next_due_at: ahead(20 * D) } : over.contract,
    botContract: over.botContract === undefined ? over.contract : over.botContract,
    trialPaid: over.trialPaid || false,
    metaItems: over.metaItems || [],
    lastActivity: over.lastActivity || ago(H),
    exempt: over.exempt || false,
    paymentText: (s) => `payment:${s}`,
    now: NOW,
  });
}
const rules = (items) => items.map((i) => i.rule);

test('the baseline shop needs nothing', () => {
  expect(run()).toEqual([]);
});

describe('critical rules', () => {
  test('payment_blocked: a Meta 131042 refusal', () => {
    const items = run({ onboarding: ready({ payment_blocked_at: ago(H) }) });
    expect(items.find((i) => i.rule === 'payment_blocked')).toMatchObject({ severity: 'critical', text_ar: 'payment:blocked' });
    expect(rules(run())).not.toContain('payment_blocked');
  });

  test('partner_removed: the onboarding row is revoked; a dead token says so', () => {
    expect(run({ onboarding: ready({ revoked_at: ago(H), revoked_reason: 'partner_removed' }) }).find((i) => i.rule === 'partner_removed'))
      .toMatchObject({ severity: 'critical', text_ar: 'أزال الزبون صلاحية شِفت من حسابه في Meta — البوت لا يستقبل الرسائل' });
    expect(run({ onboarding: ready({ revoked_at: ago(H), revoked_reason: 'token_invalid' }) }).find((i) => i.rule === 'partner_removed').text_ar)
      .toContain('مفتاح الوصول');
    expect(rules(run({ onboarding: ready({ revoked_at: null }) }))).not.toContain('partner_removed');
  });

  test('meta_restriction: an unresolved restriction, in Arabic with its end date; an expired or resolved one is not', () => {
    const restricted = ev('meta_restriction', ago(H), {
      event: 'ACCOUNT_RESTRICTION', restriction_info: [{ restriction_type: 'RESTRICTED_BIZ_INITIATED_MESSAGING', expiration: Math.floor(ahead(3 * D).getTime() / 1000) }],
    });
    const item = run({ events: [restricted] }).find((i) => i.rule === 'meta_restriction');
    expect(item.severity).toBe('critical');
    expect(item.text_ar).toMatch(/^قيّدت Meta حساب واتساب: بدء المحادثات حتى \d+\/\d+$/);
    expect(item.text_ar).not.toMatch(/[A-Z_]{4,}/);

    const expired = ev('meta_restriction', ago(5 * D), { restriction_info: [{ restriction_type: 'X', expiration: Math.floor(ago(D).getTime() / 1000) }] });
    expect(rules(run({ events: [expired] }))).not.toContain('meta_restriction');
    expect(rules(run({ events: [{ ...restricted, resolved_at: ago(1000) }] }))).not.toContain('meta_restriction');
  });

  test('es_failed: a failed connect with no number, or an onboarding row that stopped with an error', () => {
    const failed = run({ business: { wa_phone_number_id: null }, onboarding: null, events: [ev('es_failed', ago(H), { stage: 'register', status: 'failed' })] });
    expect(failed.find((i) => i.rule === 'es_failed')).toMatchObject({ severity: 'critical', text_ar: 'تعثّر الربط عند: تسجيل الرقم' });

    const stopped = run({ onboarding: ready({ step: 'subscribed', last_error: 'x', last_error_at: ago(H) }) });
    expect(stopped.find((i) => i.rule === 'es_failed').text_ar).toBe('تعثّر الربط عند: تسجيل الرقم');
    // The same stop is not also listed as «لم يكتمل».
    expect(rules(stopped)).not.toContain('onboarding_incomplete');

    // A later success clears it.
    const healed = run({ business: { wa_phone_number_id: null }, onboarding: null, events: [ev('es_failed', ago(2 * H), { stage: 'register' }), ev('es_connected', ago(H))] });
    expect(rules(healed)).not.toContain('es_failed');
  });

  test('needs_operator: the onboarding flag, a «not my number», or a number on another shop', () => {
    expect(run({ onboarding: ready({ needs_operator: true, step: 'token_exchanged' }), business: { wa_phone_number_id: null } })
      .find((i) => i.rule === 'needs_operator').text_ar).toBe('الربط يحتاج شِفت: لم يُحدَّد الرقم');
    expect(run({ business: { wa_phone_number_id: null }, onboarding: null, events: [ev('wrong_number', ago(H))] })
      .find((i) => i.rule === 'needs_operator').text_ar).toBe('الربط يحتاج شِفت: قال الزبون إنه ليس رقمه');
    expect(run({ business: { wa_phone_number_id: null }, onboarding: null, events: [ev('es_conflict', ago(H))] })
      .find((i) => i.rule === 'needs_operator').text_ar).toBe('الربط يحتاج شِفت: الرقم مربوط بحساب آخر');
    // Resolved by SHIFT: gone.
    expect(rules(run({ business: { wa_phone_number_id: null }, onboarding: null, events: [ev('wrong_number', ago(H), {}, { resolved_at: ago(1000) })] })))
      .not.toContain('needs_operator');
  });

  test('unanswered: waiting customers, unless the bot is paused on purpose', () => {
    const waiting = { count: 2, oldest: ago(3 * H) };
    expect(run({ waiting }).find((i) => i.rule === 'unanswered')).toMatchObject({ severity: 'critical', text_ar: '2 زبائن ينتظرون ردًا — أقدمهم منذ 3 س' });
    expect(rules(run({ waiting, agent: { state: 'paused' } }))).not.toContain('unanswered');
  });

  test('past_due is critical, with the amount', () => {
    expect(run({ contract: { status: 'past_due', amount_jod: 19.99, next_due_at: ago(9 * D) } }).find((i) => i.rule === 'past_due'))
      .toMatchObject({ severity: 'critical', text_ar: 'دفعة متأخرة — 19.99 د.أ' });
  });

  test('meta quality red / yellow and a declined name map to the spec\'s rules, keeping their old categories', () => {
    const items = run({
      metaItems: [
        { severity: 'critical', category: 'meta_quality', message: 'تقييم الجودة أحمر لدى Meta — الإرسال مُقيَّد' },
        { severity: 'warning', category: 'meta_name', message: 'Meta رفضت الاسم الظاهر' },
        { severity: 'critical', category: 'meta_number', message: 'حالة الرقم لدى Meta: FLAGGED' },
      ],
    });
    expect(items.map((i) => [i.rule, i.category])).toEqual(expect.arrayContaining([
      ['meta_quality_red', 'meta_quality'], ['name_declined', 'meta_name'], ['meta_number', 'meta_number'],
    ]));
    // Meta's English status never reaches the queue.
    expect(items.find((i) => i.rule === 'meta_number').text_ar).not.toMatch(/FLAGGED/);
  });
});

describe('warning rules', () => {
  test('es_cancelled: only after a day, with Meta\'s step in Arabic', () => {
    const at = (ms) => run({ business: { wa_phone_number_id: null }, onboarding: null, events: [ev('es_cancelled', ago(ms), { current_step: 'PHONE_NUMBER_VERIFICATION' })] });
    const item = at(25 * H).find((i) => i.rule === 'es_cancelled');
    expect(item).toMatchObject({ severity: 'warning' });
    expect(item.text_ar).toBe('أغلق نافذة Meta عند: التحقق من الرقم — منذ 25 س');
    expect(rules(at(23 * H))).not.toContain('es_cancelled');
  });

  test('join_stalled: opened the link more than 48 h ago and never got a number', () => {
    const notSigned = { active: false, last_login: null };
    const invite = { expires_at: ahead(3 * D) };
    const item = run({ business: { wa_phone_number_id: null }, onboarding: null, owner: notSigned, invite, events: [ev('join_opened', ago(50 * H))] })
      .find((i) => i.rule === 'join_stalled');
    expect(item).toMatchObject({ severity: 'warning', text_ar: 'فتح رابط الانضمام ولم يكمل منذ 2 يوم' });
    expect(rules(run({ business: { wa_phone_number_id: null }, onboarding: null, owner: notSigned, invite, events: [ev('join_opened', ago(40 * H))] })))
      .not.toContain('join_stalled');
    // Signed in but never pressed connect: still stalled.
    expect(rules(run({ business: { wa_phone_number_id: null }, onboarding: null, events: [ev('join_opened', ago(3 * D))] }))).toContain('join_stalled');
    // Connected: not.
    expect(rules(run({ events: [ev('join_opened', ago(3 * D))] }))).not.toContain('join_stalled');
  });

  test('payment_unconfirmed: 48 h after connecting with no confirmed card', () => {
    expect(run({ business: { connected_at: ago(3 * D) }, onboarding: ready({ payment_method_ok: false }) }).find((i) => i.rule === 'payment_unconfirmed'))
      .toMatchObject({ severity: 'warning', text_ar: 'payment:missing — منذ 3 يوم' });
    expect(rules(run({ business: { connected_at: ago(40 * H) }, onboarding: ready({ payment_method_ok: false }) }))).not.toContain('payment_unconfirmed');
  });

  test('cap_80 and cap_reached, never for SHIFT\'s own rows', () => {
    expect(run({ usage: { ai_replies_month: 800, cap: 1000 } }).find((i) => i.rule === 'cap_80').text_ar).toBe('استهلك 80% من ردود الشهر (800 / 1,000)');
    expect(rules(run({ usage: { ai_replies_month: 799, cap: 1000 } }))).not.toContain('cap_80');
    const trial = { status: 'trial', amount_jod: 19.99, trial_ends_at: ahead(20 * D), next_due_at: ahead(20 * D) };
    expect(run({ usage: { ai_replies_month: 1000, cap: 1000 }, contract: trial }).find((i) => i.rule === 'cap_reached').text_ar)
      .toBe('وصل حد ردود الشهر (1,000 / 1,000) — البوت يحوّل الزبائن للفريق');
    expect(rules(run({ usage: { ai_replies_month: 1000, cap: 1000 }, exempt: true }))).toEqual([]);
  });

  test('trial_ending: within 3 days and nothing paid', () => {
    const trial = (ends) => ({ status: 'trial', amount_jod: 19.99, trial_ends_at: ends, next_due_at: ends });
    expect(run({ contract: trial(ahead(2 * D + H)) }).find((i) => i.rule === 'trial_ending'))
      .toMatchObject({ severity: 'warning', text_ar: 'الشهر المجاني ينتهي خلال 3 أيام — لا دفعة مسجّلة' });
    expect(rules(run({ contract: trial(ahead(4 * D)) }))).not.toContain('trial_ending');
    expect(rules(run({ contract: trial(ahead(2 * D)), trialPaid: true }))).not.toContain('trial_ending');
    // Not also «دفعة مستحقة»: one line per fact.
    expect(rules(run({ contract: trial(ahead(2 * D)) }))).not.toContain('due_soon');
  });

  test('overdue: past its date and still within grace', () => {
    expect(run({ contract: { status: 'active', amount_jod: 19.99, next_due_at: ago(4 * D) } }).find((i) => i.rule === 'overdue').text_ar)
      .toBe('تجاوز موعد الدفع بـ 4 أيام — 19.99 د.أ');
  });
});

describe('info rules', () => {
  const notSigned = { active: false, last_login: null };
  const unconnected = { business: { wa_phone_number_id: null }, onboarding: null, owner: notSigned };

  test('invite_not_opened: shared more than 48 h ago, no join_opened since', () => {
    const invite = { expires_at: ahead(4 * D) };
    expect(run({ ...unconnected, invite, events: [ev('invite_shared', ago(50 * H))] }).find((i) => i.rule === 'invite_not_opened'))
      .toMatchObject({ severity: 'info', text_ar: 'لم يفتح رابط الانضمام بعد (أُرسل قبل 2 يوم)' });
    expect(rules(run({ ...unconnected, invite, events: [ev('invite_shared', ago(47 * H))] }))).not.toContain('invite_not_opened');
    expect(rules(run({ ...unconnected, invite, events: [ev('invite_shared', ago(50 * H)), ev('join_opened', ago(10 * H))] })))
      .not.toContain('invite_not_opened');
  });

  test('invite_expired: the owner never got in and the link ran out', () => {
    expect(run({ ...unconnected, invite: { expires_at: ago(H) } }).find((i) => i.rule === 'invite_expired'))
      .toMatchObject({ severity: 'info', text_ar: 'انتهت دعوة الانضمام دون استخدام' });
    // From the sweep's event when the link row is gone, unless a new link came after it.
    expect(rules(run({ ...unconnected, events: [ev('invite_expired', ago(D))] }))).toContain('invite_expired');
    expect(rules(run({ ...unconnected, events: [ev('invite_expired', ago(D)), ev('invite_created', ago(H))] }))).not.toContain('invite_expired');
    expect(rules(run({ ...unconnected, invite: { expires_at: ahead(D) } }))).not.toContain('invite_expired');
  });

  test('name_pending: Meta is reviewing the display name', () => {
    expect(run({ onboarding: ready({ meta_name_status: 'PENDING_REVIEW' }) }).find((i) => i.rule === 'name_pending'))
      .toMatchObject({ severity: 'info', text_ar: 'الاسم الظاهر قيد مراجعة Meta' });
    expect(rules(run({ onboarding: ready({ meta_name_status: 'APPROVED' }) }))).not.toContain('name_pending');
  });

  test('went_live: for the first day only', () => {
    expect(run({ business: { went_live_at: ago(2 * H) } }).find((i) => i.rule === 'went_live').text_ar).toBe('مطعم الشام يعمل — أول رد للبوت');
    expect(rules(run({ business: { went_live_at: ago(25 * H) } }))).not.toContain('went_live');
  });
});

describe('platform-wide rows', () => {
  test('provider_down while the last failure is under 15 minutes old', () => {
    expect(platformAttention({ providerStatus: { last_seen: ago(5 * 60000).toISOString(), kind: 'credit' }, now: NOW })[0])
      .toMatchObject({ rule: 'provider_down', severity: 'critical', text_ar: 'مزوّد الذكاء الاصطناعي متعطّل — الردود تتحول لفرق المحلات' });
    expect(platformAttention({ providerStatus: { last_seen: ago(16 * 60000).toISOString() }, now: NOW })).toEqual([]);
    expect(providerDown(null, NOW)).toBe(false);
  });

  test('platform_ceiling at the ceiling, not below it', () => {
    expect(platformAttention({ repliesToday: 2000, ceiling: 2000, now: NOW }).map((i) => i.rule)).toEqual(['platform_ceiling']);
    expect(platformAttention({ repliesToday: 1999, ceiling: 2000, now: NOW })).toEqual([]);
  });

  test('orphan_connection per connection that belongs to nobody', () => {
    const items = platformAttention({ orphans: [{ id: 'o1', created_at: ago(D) }, { id: 'e9', created_at: ago(H) }], now: NOW });
    expect(items.map((i) => [i.rule, i.severity, i.ref])).toEqual([['orphan_connection', 'warning', 'o1'], ['orphan_connection', 'warning', 'e9']]);
    expect(platformAttention({ orphans: [], now: NOW })).toEqual([]);
  });
});

test('sorted critical > warning > info, then oldest first', () => {
  const sorted = sortAttention([
    { severity: 'info', since: ago(9 * D) },
    { severity: 'critical', since: ago(H) },
    { severity: 'critical', since: ago(D) },
    { severity: 'warning', since: null },
  ]);
  expect(sorted.map((i) => i.severity)).toEqual(['critical', 'critical', 'warning', 'info']);
  expect(sorted[0].since).toEqual(ago(D));
});

test('every rule has Arabic action labels and a severity', () => {
  for (const [rule, spec] of Object.entries(labels.RULES)) {
    expect(['critical', 'warning', 'info']).toContain(spec.severity);
    expect(labels.actionFor(rule).label_ar).toMatch(/[ء-ي]/);
  }
});

describe('fleet columns', () => {
  test('واتساب: evidence over confirmations', () => {
    expect(whatsappColumn(shop(), ready())).toMatchObject({ state: 'connected', label_ar: 'متصل' });
    expect(whatsappColumn(shop(), ready({ payment_method_ok: false }))).toMatchObject({ state: 'card_unconfirmed', tone: 'amber' });
    expect(whatsappColumn(shop(), ready({ payment_blocked_at: ago(H) }))).toMatchObject({ state: 'payment_blocked', label_ar: 'الدفع مرفوض' });
    expect(whatsappColumn(shop(), ready({ revoked_at: ago(H) }))).toMatchObject({ state: 'removed', label_ar: 'مفصول من Meta' });
    expect(whatsappColumn(shop({ wa_phone_number_id: null }), null, [ev('es_failed', ago(H), { stage: 'register' })])).toMatchObject({ state: 'failed' });
    expect(whatsappColumn(shop({ wa_phone_number_id: null }), null)).toMatchObject({ state: 'not_connected', label_ar: 'غير مربوط' });
  });

  test('البوت: paused, the cap of a free month, and the agent\'s own state', () => {
    expect(botColumn({ state: 'paused' })).toMatchObject({ state: 'paused' });
    expect(botColumn({ state: 'ok' }, { usage: { ai_replies_month: 1000, cap: 1000 }, trial: true })).toMatchObject({ state: 'cap_reached', label_ar: 'وصل حد الشهر' });
    expect(botColumn({ state: 'ok' }, { usage: { ai_replies_month: 1000, cap: 1000 }, trial: false })).toMatchObject({ state: 'answering' });
    expect(botColumn({ state: 'down' })).toMatchObject({ label_ar: 'رسالة بدون رد' });
    expect(botColumn({ state: 'unknown' })).toMatchObject({ label_ar: 'لا رسائل بعد' });
  });

  test('الاشتراك: days left, paid until, how late', () => {
    expect(subscriptionColumn(null, { connected: false, now: NOW }).label_ar).toBe('لم يبدأ');
    expect(subscriptionColumn(null, { connected: true, now: NOW }).label_ar).toBe('بدون عقد');
    expect(subscriptionColumn({ status: 'trial', trial_ends_at: ahead(18 * D - H), next_due_at: ahead(18 * D) }, { now: NOW }).label_ar).toBe('مجاني — باقي 18 يومًا');
    expect(subscriptionColumn({ status: 'active', next_due_at: new Date('2026-12-07T10:00:00Z') }, { now: NOW }).label_ar).toBe('مدفوع حتى 7/12');
    expect(subscriptionColumn({ status: 'active', next_due_at: ago(5 * D - H) }, { now: NOW }).label_ar).toBe('متأخر 5 أيام');
    expect(subscriptionColumn({ status: 'past_due', next_due_at: ago(9 * D) }, { now: NOW }).state).toBe('late');
  });
});

test('every stored event type the code writes reads as Arabic', () => {
  for (const type of Object.keys(labels.EVENT_AR)) {
    const text = labels.eventText({ type, data: {} });
    expect(text).toMatch(/[ء-ي]/);
    expect(text).not.toMatch(/undefined|null|NaN/);
  }
  expect(labels.eventText({ type: 'something_new', data: {} })).toBe('حدث في الحساب');
  expect(labels.eventText({ type: 'payment_recorded', data: { amount_jod: 19.99, method: 'cliq' } })).toBe('سُجّلت دفعة 19.99 د.أ (كليك)');
  expect(labels.eventText({ type: 'bot_paused', data: { reason: 'late_payment' } })).toBe('أُوقف البوت مؤقتًا — السبب: تأخر الدفع');
});
