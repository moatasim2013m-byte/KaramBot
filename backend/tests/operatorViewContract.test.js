/**
 * The operator panel's view logic (frontend/src/components/admin/operatorView.js) against the spec
 * and the server (P4).
 *
 * «اليوم» draws one fix button per attention rule, «الزبائن» filters, searches and sorts the fleet,
 * and «الاشتراكات والدفعات» exports a CSV — all from that one plain module. The frontend has no
 * test runner, so it is loaded here as a script, its `export` keywords stripped, like
 * connectViewContract.test.js does.
 */
require('./setup');

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { STAGES } = require('../src/routes/adminAccounts');

const FRONTEND = path.join(__dirname, '../../frontend/src');

function loadEsm(rel) {
  const src = fs.readFileSync(path.join(FRONTEND, rel), 'utf8');
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const body = src.replace(/^export\s+/gm, '');
  const sandbox = {};
  vm.runInNewContext(`${body}\n;__out = { ${names.join(', ')} };`, sandbox);
  return sandbox.__out;
}

const v = loadEsm('components/admin/operatorView.js');

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 8, 9, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

// docs/panels/spec.md «Attention rules», every rule the queue can show.
const SPEC_RULES = [
  'payment_blocked', 'partner_removed', 'meta_restriction', 'unanswered', 'es_failed', 'needs_operator',
  'meta_quality_red', 'provider_down', 'platform_ceiling', 'past_due', 'payment_unconfirmed', 'handoff_waiting',
  'es_cancelled', 'join_stalled', 'orphan_connection', 'no_knowledge', 'cap_80', 'cap_reached', 'trial_ending',
  'overdue', 'meta_quality_yellow', 'name_declined', 'invite_not_opened', 'invite_expired', 'name_pending',
  'went_live', 'due_soon', 'quiet', 'no_contract',
];
// The six fix buttons the spec names, plus the two links for rows with no shop behind them.
const SPEC_FIXES = ['راسله', 'اربط معه', 'أكّد البطاقة', 'سجّل دفعة', 'أعد إرسال الرابط', 'أوقف البوت مؤقتًا'];
const ACCOUNT_TABS = ['health', 'knowledge', 'access', 'contract', 'settings', 'whatsapp', 'log'];

describe('attention rules → one fix button each', () => {
  test('every spec rule has a known fix and an account tab', () => {
    for (const rule of SPEC_RULES) {
      expect(v.RULES[rule]).toBeDefined();
      const { fix, tab } = v.RULES[rule];
      if (fix) expect(Object.keys(v.FIX_AR)).toContain(fix);
      if (tab) expect(ACCOUNT_TABS).toContain(tab);
    }
  });

  test('a shop row only ever offers one of the six fixes the spec names', () => {
    for (const rule of SPEC_RULES.filter((r) => !['provider_down', 'platform_ceiling', 'orphan_connection'].includes(r))) {
      const fix = v.fixFor({ rule, account_id: 'b1' });
      if (fix) expect(SPEC_FIXES).toContain(fix.label);
    }
  });

  test('money rules record a payment, a claimed card is confirmed, a dead invite is resent', () => {
    expect(v.fixFor({ rule: 'past_due', account_id: 'b1' }).kind).toBe('record_payment');
    expect(v.fixFor({ rule: 'overdue', account_id: 'b1' }).kind).toBe('record_payment');
    expect(v.fixFor({ rule: 'trial_ending', account_id: 'b1' }).kind).toBe('record_payment');
    expect(v.fixFor({ rule: 'payment_unconfirmed', account_id: 'b1' }).kind).toBe('confirm_card');
    expect(v.fixFor({ rule: 'invite_expired', account_id: 'b1' }).kind).toBe('resend_link');
    expect(v.fixFor({ rule: 'needs_operator', account_id: 'b1' }).kind).toBe('connect_with');
    expect(v.fixFor({ rule: 'meta_quality_red', account_id: 'b1' }).kind).toBe('pause_bot');
  });

  test('platform rows never offer «راسله»: there is no owner to write to', () => {
    expect(v.fixFor({ rule: 'provider_down', account_id: null }).kind).toBe('platform_settings');
    expect(v.fixFor({ rule: 'orphan_connection', account_id: null }).kind).toBe('open_onboarding');
    // An unknown rule without a shop falls back to «راسله», which needs one, so nothing is drawn.
    expect(v.fixFor({ rule: 'something_new', account_id: null })).toBeNull();
  });

  test('the server may name the fix; an action this file does not know is ignored', () => {
    expect(v.fixFor({ rule: 'quiet', account_id: 'b1', action: 'pause_bot' }).kind).toBe('pause_bot');
    expect(v.fixFor({ rule: 'quiet', account_id: 'b1', action: { kind: 'confirm_card' } }).kind).toBe('confirm_card');
    expect(v.fixFor({ rule: 'quiet', account_id: 'b1', action: 'drop_database' }).kind).toBe('message');
  });

  test('the older overview shape (category, message, business_id) reads the same', () => {
    const it = v.attentionItem({ category: 'unanswered', message: 'زبون ينتظر', business_id: 'b1', business_name: 'مطعم', severity: 'critical', since: iso(NOW) });
    expect(it).toMatchObject({ rule: 'unanswered', text: 'زبون ينتظر', account_id: 'b1', name: 'مطعم', severity: 'critical' });
  });

  test('critical > warning > info, then oldest first; a row without a time goes last in its band', () => {
    const out = v.sortAttention([
      { severity: 'info', since: iso(NOW - 9 * DAY) },
      { severity: 'critical', since: null, id: 'c-null' },
      { severity: 'warning', since: iso(NOW - DAY) },
      { severity: 'critical', since: iso(NOW - 60000), id: 'c-new' },
      { severity: 'critical', since: iso(NOW - DAY), id: 'c-old' },
    ]);
    expect(out.map((x) => x.severity)).toEqual(['critical', 'critical', 'critical', 'warning', 'info']);
    expect(out.slice(0, 3).map((x) => x.id)).toEqual(['c-old', 'c-new', 'c-null']);
  });

  test('the row tint follows the worst item per shop', () => {
    const worst = v.worstByAccount([
      { account_id: 'a', severity: 'info' }, { account_id: 'a', severity: 'critical' }, { account_id: 'b', severity: 'warning' }, { account_id: null, severity: 'critical' },
    ]);
    expect(worst.get('a')).toBe('critical');
    expect(worst.get('b')).toBe('warning');
    expect(worst.size).toBe(2);
  });
});

describe('«راسله»', () => {
  test('the line is Arabic, names the shop and the owner, and is URL-encoded into wa.me', () => {
    const line = v.waLine('join_stalled', 'مطعم الشام', 'أبو خالد');
    expect(line).toMatch(/^مرحبًا أبو خالد، معك شِفت\./);
    expect(line).toContain('مطعم الشام');
    expect(line).not.toMatch(/\{name\}/);
    const href = v.waLink('+962 79 123 4567', line);
    expect(href.startsWith('https://wa.me/962791234567?text=')).toBe(true);
    expect(decodeURIComponent(href.split('?text=')[1])).toBe(line);
  });

  test('no mobile, no link', () => {
    expect(v.waLink('', 'hi')).toBeNull();
    expect(v.waLink(null, 'hi')).toBeNull();
  });

  test('a mobile is masked on the account header', () => {
    expect(v.maskPhone('962791234567')).toBe('079•••4567');
    expect(v.maskPhone(null)).toBeNull();
  });
});

describe('stages', () => {
  test('the funnel and the stage labels cover every column the board derives', () => {
    for (const { stage, label_ar } of STAGES) {
      expect(v.STAGE_AR[stage]).toBe(label_ar);
      expect(v.FUNNEL.map(([k]) => k)).toContain(stage);
    }
    expect(v.FUNNEL.map(([k]) => k)).toContain('paused');
    expect(v.stageLabel('nonsense')).toBe('—');
  });
});

describe('the fleet row', () => {
  const now = Date.now();
  const row = (over = {}) => v.fleetRow({
    id: 'b1', name: 'صيدلية الريان', sector: 'pharmacy', business_type: 'generic', city: 'إربد',
    display_phone: '+962 7 9123 4567', stage: 'live',
    whatsapp: { state: 'ok', label_ar: 'متصل' }, bot: { state: 'ok', label_ar: 'يرد' },
    usage: { ai_replies_month: 812, cap: 1000 }, conversations_7d: 14,
    subscription: { status: 'trial', trial_ends_at: iso(now + 18 * DAY + 3600000) },
    owner: { first_name: 'أبو خالد', phone: '962791110000', signed_in: true, invite_expires_at: null },
    last_activity: iso(now - 3600000),
    ...over,
  });

  test('reads the P4 shape', () => {
    const r = row();
    expect(r).toMatchObject({ sector_ar: 'صيدلية', stage_ar: 'يعمل', wa: { label: 'متصل' }, bot: { label: 'يرد' } });
    expect(r.sub.label).toBe('مجاني — باقي 19 يومًا');
  });

  test('a server label for the subscription wins over the computed one', () => {
    expect(row({ subscription: { status: 'active', label_ar: 'مدفوع حتى 7 كانون الأول' } }).sub.label).toBe('مدفوع حتى 7 كانون الأول');
  });

  test('reads the older shape (connection, agent, contract) without English leaking', () => {
    const r = v.fleetRow({ id: 'b2', name: 'مطعم', business_type: 'restaurant', connection: { state: 'down', label: 'مفصول' }, agent: { state: 'idle', label: 'لا رسائل بعد' }, contract: null });
    expect(r).toMatchObject({ sector_ar: 'مطعم', stage_ar: '—', wa: { state: 'down', label: 'مفصول' } });
    expect(r.sub.label).toBe('بدون عقد');
    expect(v.sectorLabel({ business_type: 'generic' })).toBe('نشاط عام');
  });

  test('subscription words', () => {
    expect(v.subscriptionLabel(null).text).toBe('بدون عقد');
    expect(v.subscriptionLabel({ status: 'trial' }).text).toBe('لم يبدأ');
    expect(v.subscriptionLabel({ status: 'past_due', next_due_at: iso(NOW - 5 * DAY) }, NOW)).toMatchObject({ text: 'متأخر 5 أيام', tone: 'bad' });
    expect(v.subscriptionLabel({ status: 'active', next_due_at: iso(NOW - 2 * DAY) }, NOW).tone).toBe('bad');
    expect(v.subscriptionLabel({ status: 'active', next_due_at: iso(NOW + 20 * DAY) }, NOW).text).toMatch(/^مدفوع حتى /);
  });

  test('owner login words', () => {
    expect(v.ownerLoginLabel({ signed_in: true, active: true }).text).toBe('✓ دخل');
    expect(v.ownerLoginLabel({ signed_in: true, active: false }).text).toBe('معطّل');
    expect(v.ownerLoginLabel({ signed_in: false, invite_expires_at: iso(NOW - DAY) }, NOW).text).toBe('انتهت الدعوة');
    expect(v.ownerLoginLabel({ signed_in: false, invite_expires_at: iso(NOW + 2 * DAY - 1000) }, NOW).text).toBe('الدعوة تنتهي بعد يومين');
  });

  test('search: name, owner, and the mobile however it is typed', () => {
    const r = row();
    expect(v.matchesSearch(r, 'الريان')).toBe(true);
    expect(v.matchesSearch(r, 'أبو')).toBe(true);
    expect(v.matchesSearch(r, '0791110000')).toBe(true);
    expect(v.matchesSearch(r, '962791110000')).toBe(true);
    expect(v.matchesSearch(r, '9123')).toBe(true); // the shop's own number
    expect(v.matchesSearch(r, 'مطعم')).toBe(false);
    expect(v.matchesSearch(r, '')).toBe(true);
  });

  test('filters', () => {
    const ids = new Set(['b1']);
    expect(v.matchesFilter(row(), 'attention', ids)).toBe(true);
    expect(v.matchesFilter(row({ id: 'b9' }), 'attention', ids)).toBe(false);
    expect(v.matchesFilter(row(), 'trial', ids)).toBe(true);
    expect(v.matchesFilter(row({ stage: 'connecting' }), 'joining', ids)).toBe(true);
    expect(v.matchesFilter(row({ stage: 'paused' }), 'stopped', ids)).toBe(true);
    expect(v.matchesFilter(row({ subscription: { status: 'past_due', next_due_at: iso(Date.now() - 3 * DAY) } }), 'late', ids)).toBe(true);
    expect(v.matchesFilter(row(), 'late', ids)).toBe(false);
  });

  test('every column sorts, and a missing value goes last either way', () => {
    const rows = [row({ id: 'a', usage: null }), row({ id: 'b', usage: { ai_replies_month: 900, cap: 1000 } }), row({ id: 'c', usage: { ai_replies_month: 100, cap: 1000 } })];
    expect(v.sortRows(rows, 'usage', 'asc').map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(v.sortRows(rows, 'usage', 'desc').map((r) => r.id)).toEqual(['b', 'c', 'a']);
    for (const key of ['name', 'stage', 'wa', 'bot', 'usage', 'conversations_7d', 'subscription', 'owner', 'last_activity']) {
      expect(typeof v.FLEET_SORT[key]).toBe('function');
      expect(v.sortRows(rows, key, 'asc')).toHaveLength(3);
    }
  });
});

describe('billing', () => {
  test('filters: ending within 7 days, late, no contract', () => {
    expect(v.billingMatches({ status: 'trial', trial_ends_at: iso(NOW + 3 * DAY) }, 'ending7', NOW)).toBe(true);
    expect(v.billingMatches({ status: 'trial', trial_ends_at: iso(NOW + 20 * DAY) }, 'ending7', NOW)).toBe(false);
    expect(v.billingMatches({ status: 'past_due' }, 'late', NOW)).toBe(true);
    expect(v.billingMatches({ status: 'active', next_due_at: iso(NOW - DAY) }, 'late', NOW)).toBe(true);
    expect(v.billingMatches({ status: 'active', next_due_at: iso(NOW + DAY) }, 'late', NOW)).toBe(false);
    expect(v.billingMatches({ status: null }, 'no_contract', NOW)).toBe(true);
    expect(v.billingMatches({ status: 'none' }, 'no_contract', NOW)).toBe(true);
  });

  test('the CSV opens in Excel: BOM, Arabic headers, quoted commas and quotes', () => {
    const csv = v.billingCsv([{
      name: 'مطعم "الشام", إربد', status: 'active', amount_jod: 19.99, trial_ends_at: null,
      next_due_at: '2026-11-07T00:00:00.000Z',
      last_payment: { paid_at: '2026-10-07T10:00:00.000Z', method: 'cliq', reference: 'TX-1' },
      usage: { ai_replies_month: 312, cap: 1000 },
    }]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    const [head, line] = csv.slice(1).trim().split('\r\n');
    expect(head.split(',')[0]).toBe('الزبون');
    expect(line).toBe('"مطعم ""الشام"", إربد",فعّال,19.99,,2026-11-07,2026-10-07,كليك,TX-1,312,1000');
  });

  test('money reads in dinars', () => {
    expect(v.jod(25)).toBe('25 د.أ');
    expect(v.jod(null)).toBe('—');
  });
});

describe('events', () => {
  test('a line with no Arabic is never shown raw', () => {
    expect(v.eventText({ text_ar: 'ربط واتساب' })).toBe('ربط واتساب');
    expect(v.eventText({ type: 'es_connected', text_ar: 'es_connected' })).toBe('تغيير في الحساب');
  });

  test('today shows the time, yesterday says «أمس»', () => {
    const now = new Date(2026, 9, 8, 12, 0);
    expect(v.eventTime(new Date(2026, 9, 8, 10, 32).toISOString(), now)).toBe('10:32');
    expect(v.eventTime(new Date(2026, 9, 7, 18, 4).toISOString(), now)).toBe('أمس 18:04');
  });
});
