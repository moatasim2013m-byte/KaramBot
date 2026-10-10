/**
 * The customer panel's words against the server's states (P3).
 *
 * «الرئيسية» shows one honest line (panelView.statusLine) built from GET /api/whatsapp/status. These
 * hold that module, loaded as a script like connectViewContract.test.js does, to what the server
 * really computes (accountHealth's connectionState/agentState, whatsappStatus's buildSetup and
 * explain, metaNotices): every state the spec lists has its line and its button, a shop that is not
 * connected never reads as «working», and the navigation gives each role what the spec says.
 */
require('./setup');

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildSetup, explain } = require('../src/routes/whatsappStatus');
const { connectionState, agentState, lifecycle } = require('../src/services/accountHealth');
const { PAYMENT_NOTICES } = require('../src/config/metaNotices');

const FRONTEND = path.join(__dirname, '../../frontend/src');

function loadEsm(rel) {
  const src = fs.readFileSync(path.join(FRONTEND, rel), 'utf8');
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const body = src.replace(/^export\s+/gm, '');
  const sandbox = {};
  vm.runInNewContext(`${body}\n;__out = { ${names.join(', ')} };`, sandbox);
  return sandbox.__out;
}

const view = loadEsm('components/whatsapp/panelView.js');

const RECENT = new Date(Date.now() - 5 * 60000).toISOString();

/** GET /whatsapp/status as the route builds it, from the same functions. */
function statusFor({
  business = {}, onboarding = null, lastInbound = RECENT, lastAi = RECENT, knowledgeCount = 3, ownerConnect = true, extra = {},
} = {}) {
  const biz = {
    business_type: 'generic', status: 'active', wa_phone_number_id: 'P1', wa_access_token: 'enc', ai_config: {}, ...business,
  };
  const connection = connectionState(biz, onboarding);
  const agent = agentState(biz, lastInbound, lastAi, knowledgeCount);
  return {
    connection,
    agent,
    lifecycle: lifecycle(biz, onboarding),
    payment_method_ok: onboarding ? onboarding.payment_method_ok : null,
    payment_method_claimed: Boolean(onboarding?.payment_method_claimed_at),
    explain: explain(connection, agent, onboarding, null, { ownerConnect, hasNumber: Boolean(biz.wa_phone_number_id) }),
    setup: buildSetup({
      business: biz, connection, paymentOk: onboarding ? onboarding.payment_method_ok : null,
      knowledgeCount, lastInbound, ownerConnect,
    }),
    ...extra,
  };
}

const DONE_OK = { step: 'done', payment_method_ok: true };

describe('«الرئيسية»: the one honest line', () => {
  test('working: «البوت يعمل ويرد», no button', () => {
    const line = view.statusLine(statusFor({ onboarding: DONE_OK }));
    expect(line.text).toBe('البوت يعمل ويرد');
    expect(line.action).toBeNull();
  });

  test('no number and owners may connect: «اربط واتساب», and nothing counts as connected', () => {
    const s = statusFor({ business: { wa_phone_number_id: null, wa_access_token: null }, lastInbound: null, lastAi: null });
    expect(view.isConnected(s)).toBe(false);
    const line = view.statusLine(s);
    expect(line.text).toBe('واتساب غير مربوط بعد — اربطه خلال دقائق');
    expect(line.action).toBe('connect');
  });

  test('no number before G1 (es_owner_enabled off): SHIFT connects it, no connect button', () => {
    const s = statusFor({ business: { wa_phone_number_id: null, wa_access_token: null }, ownerConnect: false });
    const line = view.statusLine(s);
    expect(line.action).toBe('contact');
    expect(line.text).toContain('فريق شِفت');
  });

  test('a connect still in progress is not «connected»', () => {
    const s = statusFor({ onboarding: { step: 'subscribed', payment_method_ok: false } });
    expect(view.isConnected(s)).toBe(false);
  });

  test('paused: «شغّل البوت» for the owner only', () => {
    const s = statusFor({ business: { ai_config: { enabled: false } }, onboarding: DONE_OK });
    expect(view.statusLine(s).text).toBe('البوت موقوف مؤقتًا — الرسائل تصلك');
    expect(view.statusLine(s, { role: 'business_owner' }).action).toBe('resume');
    expect(view.statusLine(s, { role: 'manager' }).action).toBeNull();
  });

  test('Meta refused a reply (131042): the owner wording from metaNotices, ahead of a pause', () => {
    const s = statusFor({
      business: { ai_config: { enabled: false } },
      onboarding: { ...DONE_OK, payment_blocked_at: new Date().toISOString() },
    });
    const line = view.statusLine(s);
    expect(line.key).toBe('payment_blocked');
    expect(line.text).toBe(PAYMENT_NOTICES.blocked.owner.short);
    expect(view.BLOCKED_LINE).toBe(PAYMENT_NOTICES.blocked.owner.short);
    expect(view.paymentCardAr(s).key).toBe('blocked');
  });

  test('cap reached: said, and the waiting chats are the button', () => {
    const s = statusFor({ onboarding: DONE_OK, extra: { usage: { ai_replies_month: 1000, cap: 1000, seats_used: 1, seats: 3 } } });
    const line = view.statusLine(s);
    expect(line.key).toBe('cap');
    expect(line.text).toContain('وصل البوت إلى حد ردود هذا الشهر');
    expect(line.action).toBe('inbox');
  });

  test('revoked at Meta: «أعد الربط» comes first, whatever else is true', () => {
    const s = statusFor({ onboarding: DONE_OK, extra: { revoked: true } });
    const line = view.statusLine(s);
    expect(line.text).toBe('انفصل كرم بوت عن حسابك في Meta');
    expect(line.action).toBe('reconnect');
  });

  test('anything else falls back to the server\'s own title, never «يعمل»', () => {
    const s = statusFor({ knowledgeCount: 0, onboarding: DONE_OK });
    const line = view.statusLine(s);
    expect(line.text).toBe(s.explain.title);
    expect(line.tone).not.toBe('good');
  });
});

describe('the plan banner', () => {
  const DAY = 86400000;
  test('free month counts down in agreeing Arabic', () => {
    expect(view.planBanner({ status: 'trial', trial_days_left: 18 }).text).toBe('الشهر الأول مجاني — باقي 18 يومًا');
    expect(view.planBanner({ status: 'trial', trial_days_left: 3 }).text).toBe('الشهر الأول مجاني — باقي 3 أيام');
    expect(view.planBanner({ status: 'trial', trial_days_left: 1 }).text).toBe('الشهر الأول مجاني — باقي يوم واحد');
  });

  test('paid until a Levantine date', () => {
    expect(view.planBanner({ status: 'active', next_due_at: '2026-12-07T10:00:00Z' }).text).toBe('مدفوع حتى 7 كانون الأول');
  });

  test('late: days late and days left before the bot stops, from the grace days', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    const plan = { status: 'past_due', next_due_at: new Date(now - 3 * DAY - 1000).toISOString() };
    expect(view.planBanner(plan, { graceDays: 7, now }).text)
      .toBe('اشتراكك متأخر 3 أيام — يتوقف الرد الآلي بعد 4 أيام إن لم تُسجَّل الدفعة، ورسائل زبائنك تبقى تصل');
  });

  test('no contract: no banner', () => {
    expect(view.planBanner(null)).toBeNull();
    expect(view.planBanner({ status: 'none' })).toBeNull();
  });

  // `Number(grace_days) || 7` read a deliberate 0 as a week of grace.
  test('grace days: the setting as given, 0 included; 7 only when it is missing or unreadable', () => {
    expect(view.graceDaysOf({ grace_days: 0 })).toBe(0);
    expect(view.graceDaysOf({ grace_days: 3 })).toBe(3);
    expect(view.graceDaysOf({ grace_days: '5' })).toBe(5);
    expect(view.graceDaysOf({})).toBe(7);
    expect(view.graceDaysOf(null)).toBe(7);
    expect(view.graceDaysOf({ grace_days: -1 })).toBe(7);
    expect(view.graceDaysOf({ grace_days: 'x' })).toBe(7);
  });
});

// The P3 review: pages that read the wrong field, or none. Read from source, as the contract here
// is the field each page passes on.
describe('page wiring', () => {
  const page = (rel) => fs.readFileSync(path.join(FRONTEND, rel), 'utf8');

  test('the home banner and «الاشتراك» read the same late policy', () => {
    expect(page('pages/OverviewPage.jsx')).toMatch(/planBanner\(status\.plan, \{ graceDays: graceDaysOf\(status\.late_policy\) \}\)/);
    expect(page('pages/BillingPage.jsx')).toMatch(/graceDaysOf\(late\)/);
    expect(page('pages/BillingPage.jsx')).not.toMatch(/grace_days\) \|\| 7/);
  });

  test('«آخر رد من البوت» is the bot\'s own reply, not the last outbound of any kind', () => {
    const src = page('pages/SettingsPage.jsx');
    expect(src).toMatch(/آخر رد من البوت"><Timestamp value=\{status\.last_ai_reply_at\}/);
    expect(src).not.toMatch(/آخر رد من البوت"><Timestamp value=\{status\.last_outbound_at\}/);
  });

  test('«الإعدادات» has المدينة, غيّر كلمة المرور and انسخ رمز الدعم', () => {
    const src = page('pages/SettingsPage.jsx');
    expect(src).toContain('label="المدينة"');
    expect(src).toContain("api.post('/auth/password'");
    expect(src).toContain('انسخ رمز الدعم');
    expect(src).toContain('status.support_code');
  });

  test('the knowledge chips follow the shop\'s sector, and SHIFT\'s pause locks the owner\'s switch', () => {
    const src = page('pages/BotPage.jsx');
    expect(src).toMatch(/<KnowledgeByGroup sector=\{biz\.sector \|\| user\?\.sector \|\| bizType\} \/>/);
    expect(src).toMatch(/paused_by === 'shift'/);
    expect(src).toMatch(/disabled=\{busy \|\| shiftPaused\}/);
  });
});

describe('navigation', () => {
  const keys = (list) => Array.from(list, (i) => i.key);

  test('owner of a restaurant: الرئيسية · المحادثات · البوت · الطلبات, the rest under «المزيد»', () => {
    const nav = view.navFor('business_owner', 'restaurant');
    expect(keys(nav.tabs)).toEqual(['overview', 'inbox', 'bot', 'orders']);
    expect(keys(nav.more)).toEqual(expect.arrayContaining(['menu', 'reports', 'staff', 'billing', 'settings', 'help']));
  });

  test('a clinic\'s fourth tab says «المواعيد»', () => {
    expect(view.navFor('business_owner', 'clinic').tabs[3].label).toBe('المواعيد');
  });

  test('owner of a generic shop: the fourth tab is «الاشتراك», no orders anywhere', () => {
    const nav = view.navFor('business_owner', 'generic');
    expect(nav.tabs[3].key).toBe('billing');
    expect(keys(nav.side)).not.toContain('orders');
  });

  test('a manager never sees «الاشتراك»', () => {
    for (const type of ['restaurant', 'clinic', 'generic']) {
      expect(keys(view.navFor('manager', type).side)).not.toContain('billing');
    }
  });

  test('staff: المحادثات · الطلبات', () => {
    expect(keys(view.navFor('staff', 'restaurant').tabs)).toEqual(['inbox', 'orders']);
    expect(keys(view.navFor('staff', 'generic').tabs)).toEqual(['inbox']);
  });

  test('help goes to SHIFT\'s WhatsApp, prefilled with who is writing', () => {
    const link = view.shiftWaLink(view.helpText({ name: 'أبو خالد', business_name: 'مطعم الشام' }));
    expect(link.startsWith('https://wa.me/962776788972?text=')).toBe(true);
    expect(decodeURIComponent(link.split('text=')[1])).toBe('أنا أبو خالد من مطعم الشام');
  });
});

describe('Meta\'s words, in Arabic', () => {
  test('name status and quality', () => {
    expect(view.nameStatusAr('APPROVED')).toBe('مقبول');
    expect(view.nameStatusAr('PENDING_REVIEW')).toBe('قيد المراجعة');
    expect(view.nameStatusAr('DECLINED')).toBe('مرفوض');
    expect(view.qualityAr('GREEN').label).toBe('جيدة');
    expect(view.qualityAr('YELLOW').label).toBe('متوسطة');
    expect(view.qualityAr('RED').label).toBe('منخفضة');
    expect(view.qualityAr(null).state).toBe('unknown');
  });
});
