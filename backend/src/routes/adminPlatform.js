'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const prisma = require('../config/prisma');
const platformSettings = require('../services/platformSettings');
const accountEvents = require('../services/accountEvents');
const { normalizePhone } = require('../utils/phone');
const labels = require('../config/eventLabels');
const { embeddedSignupAppId } = require('../utils/metaSecrets');

/**
 * «إعدادات المنصة» made real (docs/panels/spec.md; decisions-2026-10-08.md): SHIFT's own switches
 * and defaults, stored as PlatformSetting rows and read by the code that obeys them.
 *
 *   GET    /api/admin/platform-settings          {settings, defaults, editable, meta, g1}
 *   PATCH  /api/admin/platform-settings {key, value}
 *   POST   /api/admin/platform-settings/g1 {confirm}   record G1 (the spare-SIM run) as passed
 *   DELETE /api/admin/platform-settings/g1             undo it; owner self-connect closes with it
 *
 * platformSettings.set already refuses an unknown key or a value of the wrong type. This route
 * checks what a person can get wrong on top: a free month of 0 days, a daily ceiling of -1, an IBAN
 * with a typo, an alert number that is not a mobile. Each block is saved on its own and may be
 * sent partly: the fields sent are merged over the current value, so «أيام السماح» can change
 * without retyping the campaign. value null restores the code default. Every save is an
 * AccountEvent platform_setting_changed with the value before and after (platformSettings.set).
 *
 * Not editable here, on purpose: provider_status (written by the code when the AI fails) and
 * g1_passed_at (only the G1 routes below write it).
 *
 * Owner self-connect (es_owner_enabled) opens only after G1, the first attended live Embedded
 * Signup on a spare SIM. platformSettings.set refuses true while g1_passed_at is empty (409), so
 * the lock holds for any caller, not only this PATCH.
 *
 * Two switches open something wide, so turning either ON from off needs a sentence typed by a
 * person in the body ({key, value, confirm}) rather than a click (CONFIRM_TO_ENABLE). Turning
 * them off needs nothing: off is the safe side.
 * - Public self-signup (P5, routes/publicSignup.js) is built off (decisions #1: the first ten are
 *   invite-only); its daily cap can be changed freely. It opens only while owner self-connect
 *   (es_owner_enabled) is on, or a self-signed shop could not go live alone.
 * - Coexistence (P5) changes what every shop's connect screen offers, and Meta then holds SHIFT to
 *   a 24-hour sync per number (services/coexistence.js).
 */

const router = express.Router();
router.use(authenticate, requireRole('platform_admin'));

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

class SettingInputError extends Error {}
const bad = (message) => { throw new SettingInputError(message); };

function intIn(v, min, max, message) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) bad(message);
  return n;
}

function text(v, max, message, { required = false } = {}) {
  if (v === null || v === undefined) v = '';
  if (typeof v !== 'string') bad(message);
  const s = v.replace(/\s+/g, ' ').trim();
  if (required && !s) bad(message);
  if (s.length > max) bad(message);
  return s;
}

/** Only the fields a block knows, each checked; a partial value is merged over the current one. */
const VALIDATORS = {
  es_owner_enabled(v) {
    if (typeof v !== 'boolean') bad('حدّد هل الربط الذاتي مفتوح أم مغلق');
    return v;
  },
  campaign(v) {
    return {
      name: text(v.name, 80, 'اكتب اسم الحملة (حتى 80 حرفًا)', { required: true }),
      trial_days: intIn(v.trial_days, 1, 90, 'مدة الفترة المجانية بين 1 و90 يومًا'),
      trial_starts: ['first_reply', 'connect'].includes(v.trial_starts) ? v.trial_starts : bad('تبدأ الفترة المجانية من أول رد للبوت أو من الربط'),
      backstop_days: intIn(v.backstop_days, 1, 60, 'أقصى انتظار لأول رد بين 1 و60 يومًا'),
    };
  },
  ai_limits(v) {
    return {
      reply_month_default: intIn(v.reply_month_default, 1, 100000, 'الردود الشهرية لكل محل بين 1 و100,000'),
      media_day_default: intIn(v.media_day_default, 0, 1000, 'قراءة الوسائط اليومية بين 0 و1,000'),
      platform_day_ceiling: intIn(v.platform_day_ceiling, 1, 1000000, 'سقف الردود اليومي للمنصة يجب أن يكون رقمًا موجبًا'),
      ceiling_policy: ['trials_first', 'all'].includes(v.ceiling_policy) ? v.ceiling_policy : bad('عند بلوغ السقف: أوقف التجارب أولًا أو أوقف الجميع'),
    };
  },
  payment_instructions(v) {
    const iban = text(v.iban, 60, 'رقم IBAN غير صحيح').replace(/\s+/g, '').toUpperCase();
    // An IBAN is a country code, two check digits and up to 30 letters or digits (JO: 30 in all).
    if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) bad('رقم IBAN غير صحيح — مثال: JO94CBJO0010000000000131000302');
    return {
      cliq_alias: text(v.cliq_alias, 60, 'اسم CliQ طويل جدًا'),
      iban,
      holder: text(v.holder, 120, 'اسم صاحب الحساب طويل جدًا'),
    };
  },
  late_policy(v) {
    return { grace_days: intIn(v.grace_days, 0, 60, 'أيام السماح بين 0 و60') };
  },
  invite_ttl_days(v) {
    return intIn(v, 1, 30, 'مدة صلاحية رابط الانضمام بين 1 و30 يومًا');
  },
  shift_alert_numbers(v) {
    if (!Array.isArray(v)) bad('أرقام التنبيهات يجب أن تكون قائمة');
    if (v.length > 5) bad('حتى 5 أرقام للتنبيهات');
    const out = [];
    for (const raw of v) {
      const p = normalizePhone(typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '');
      if (!p || p.length < 9 || p.length > 15) bad(`رقم التنبيه غير صحيح: ${String(raw).slice(0, 20)}`);
      if (!out.includes(p)) out.push(p);
    }
    return out;
  },
  self_signup(v) {
    if (typeof v.enabled !== 'boolean') bad('حدّد هل التسجيل الذاتي العام مفتوح أم مغلق');
    return { enabled: v.enabled, daily_cap: intIn(v.daily_cap, 1, 50, 'الحد اليومي للتسجيل بين 1 و50') };
  },
};

// ── Coexistence (P5) ─────────────────────────────────────────────────────────
// Off in October (decisions #10). The typed sentence below says what it does.
const COEXISTENCE_CONFIRM = 'نعم، فعّل الربط مع تطبيق واتساب للأعمال';
VALIDATORS.coexistence = function coexistence(v) {
  if (typeof v.enabled !== 'boolean') bad('حدّد هل الربط مع تطبيق واتساب للأعمال مفعّل أم لا');
  return { enabled: v.enabled };
};

/**
 * Switches that open something wide: turning one ON from off needs this exact sentence in the
 * request's `confirm`. The settings page asks the person to type it. One mechanism for both, so
 * the PATCH path passes `confirm` through one place.
 */
const CONFIRM_TO_ENABLE = {
  self_signup: {
    text: 'افتح التسجيل العام',
    error: 'التسجيل الذاتي العام يُفتح بعد أول 10 زبائن. لفتحه اكتب عبارة التأكيد: «افتح التسجيل العام»',
  },
  coexistence: {
    text: COEXISTENCE_CONFIRM,
    error: `للتفعيل اكتب: «${COEXISTENCE_CONFIRM}»`,
  },
};

function assertConfirmed(key, value, current, confirm) {
  const rule = CONFIRM_TO_ENABLE[key];
  if (!rule || !isPlainObject(value) || value.enabled !== true) return;
  if (isPlainObject(current) && current.enabled === true) return; // already open: e.g. a new cap
  if (String(confirm == null ? '' : confirm).replace(/\s+/g, ' ').trim() !== rule.text) bad(rule.error);
}
const EDITABLE = Object.keys(VALIDATORS);

/**
 * The checked value to store for `key`, from the current effective value and what was sent.
 * `opts.confirm` is the typed sentence a switch in CONFIRM_TO_ENABLE asks for.
 */
// Self-signup promises a shop that «signs up and goes live alone» (spec P5): with owner self-connect
// still closed (es_owner_enabled, off until G1), every public signup would stop at «سيتواصل معك
// فريق شِفت لربط واتساب» and become SHIFT's manual work. So it opens only after self-connect does.
const SELF_SIGNUP_NEEDS_ES = 'افتح «الربط الذاتي» أولًا: بدونه لا يستطيع من يسجّل بنفسه ربط واتساب دون فريق شِفت.';

function validateSetting(key, sent, current, { confirm, esOwnerOn } = {}) {
  if (!EDITABLE.includes(key)) bad('هذا الإعداد لا يُعدَّل من هنا');
  const validate = VALIDATORS[key];
  let value;
  if (isPlainObject(current)) {
    if (!isPlainObject(sent)) bad(`قيمة «${labels.SETTING_AR[key]}» غير صحيحة`);
    value = validate({ ...current, ...sent });
  } else {
    value = validate(sent);
  }
  assertConfirmed(key, value, current, confirm);
  if (key === 'self_signup' && value.enabled === true && !(isPlainObject(current) && current.enabled === true) && esOwnerOn === false) {
    bad(SELF_SIGNUP_NEEDS_ES);
  }
  return value;
}

// Read-only «Meta» block: the same values the connect button uses (routes/embeddedSignup.js
// config). The app id is public (the browser SDK needs it); the secret is never read here.
function metaInfo() {
  return {
    app_id: embeddedSignupAppId(),
    config_id: process.env.META_ES_CONFIG_ID || '1664627968720314',
    graph_version: process.env.GRAPH_API_VERSION || 'v24.0',
  };
}

// ── G1 ───────────────────────────────────────────────────────────────────────
// G1 is recorded by a person who watched it pass, and only when the server can see it happened:
// an es_connected written by SHIFT's own Embedded Signup routes (routes/adminEmbeddedSignup.js
// records actor_kind 'shift'). The owner's routes write actor_kind 'owner', which cannot exist
// before G1 anyway; «اربط بحساب» (attachOnboarding) also writes es_connected but as resumed_from
// 'orphan', a row someone connected earlier, so it is no live run and does not count.
const G1_CONFIRM = 'نجحت تجربة الشريحة الاحتياطية';
const G1_NO_EVIDENCE = 'لا نرى ربطًا مكتملًا أجراه فريق شِفت عبر نافذة Meta. شغّل التجربة على الشريحة الاحتياطية من تبويب «الحالة» في صفحة الحساب، ثم سجّل نجاحها.';
const G1_EVIDENCE_SCAN = 50;

async function g1Evidence() {
  const rows = await prisma.accountEvent.findMany({
    where: { type: 'es_connected', actor_kind: 'shift', business_id: { not: null } },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: G1_EVIDENCE_SCAN,
  });
  const hit = rows.find((e) => !(e.data && e.data.resumed_from === 'orphan'));
  if (!hit) return null;
  const business = await prisma.business.findUnique({ where: { id: hit.business_id }, select: { name: true } }).catch(() => null);
  return {
    event_id: hit.id,
    at: hit.created_at,
    business_id: hit.business_id,
    business_name: business ? business.name : null,
    actor_user_id: hit.actor_user_id || null,
  };
}

/** What the settings page draws as the G1 checklist. */
async function g1State(settings) {
  const passed = settings.g1_passed_at && settings.g1_passed_at.at ? settings.g1_passed_at : null;
  return {
    passed_at: passed ? passed.at : null,
    passed_by: passed ? { id: passed.by_user_id || null, name: passed.by_name || null } : null,
    evidence: await g1Evidence(),
    confirm: G1_CONFIRM,
  };
}

router.get('/', async (req, res) => {
  try {
    const settings = await platformSettings.getAll();
    res.json({
      settings,
      defaults: platformSettings.defaults(),
      editable: EDITABLE,
      labels: labels.SETTING_AR,
      meta: metaInfo(),
      // The sentence the page asks a person to type before a switch goes on.
      confirm_to_enable: Object.fromEntries(Object.entries(CONFIRM_TO_ENABLE).map(([k, r]) => [k, r.text])),
      // Kept for the coexistence block, which reads it by this name.
      coexistence_confirm: COEXISTENCE_CONFIRM,
      g1: await g1State(settings),
    });
  } catch (err) {
    console.error(`[admin/platform-settings] read failed: ${err.message}`);
    res.status(500).json({ error: 'تعذّر تحميل إعدادات المنصة' });
  }
});

router.patch('/', async (req, res) => {
  const key = String((req.body && req.body.key) || '');
  const hasValue = req.body && Object.prototype.hasOwnProperty.call(req.body, 'value');
  if (!key || !hasValue) return res.status(400).json({ error: 'حدّد الإعداد وقيمته' });
  if (!EDITABLE.includes(key)) return res.status(400).json({ error: 'هذا الإعداد لا يُعدَّل من هنا' });

  try {
    let value = null;
    if (req.body.value !== null) {
      const esOwnerOn = key === 'self_signup' ? platformSettings.isOn(await platformSettings.get('es_owner_enabled')) : undefined;
      value = validateSetting(key, req.body.value, await platformSettings.get(key), { confirm: req.body.confirm, esOwnerOn });
    }
    const effective = await platformSettings.set(key, value, req.user.id);
    res.json({ key, value: effective, settings: await platformSettings.getAll() });
  } catch (err) {
    if (err instanceof SettingInputError) return res.status(400).json({ error: err.message });
    if (err && err.code === 'G1_NOT_PASSED') return res.status(409).json({ error: err.message, code: err.code });
    if (err && err.status === 400) return res.status(400).json({ error: 'قيمة الإعداد غير صحيحة' });
    console.error(`[admin/platform-settings] ${key} not saved: ${err.message}`);
    res.status(500).json({ error: 'تعذّر حفظ الإعداد' });
  }
});

router.post('/g1', async (req, res) => {
  const confirm = String((req.body && req.body.confirm) || '').replace(/\s+/g, ' ').trim();
  if (confirm !== G1_CONFIRM) return res.status(400).json({ error: `للتسجيل اكتب: «${G1_CONFIRM}»` });
  try {
    const current = await platformSettings.get('g1_passed_at');
    // Already recorded: the first record (and who made it) stands.
    if (current && current.at) {
      const settings = await platformSettings.getAll();
      return res.json({ settings, g1: await g1State(settings) });
    }
    const evidence = await g1Evidence();
    if (!evidence) return res.status(409).json({ error: G1_NO_EVIDENCE, code: 'G1_NO_EVIDENCE' });
    const by = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } }).catch(() => null);
    await platformSettings.set('g1_passed_at', {
      at: new Date().toISOString(),
      by_user_id: req.user.id,
      by_name: (by && by.name) || null,
      evidence: { event_id: evidence.event_id, business_id: evidence.business_id, at: evidence.at },
    }, req.user.id);
    await accountEvents.record({
      businessId: null,
      actorUserId: req.user.id,
      actorKind: 'shift',
      type: 'g1_passed',
      data: { evidence_event_id: evidence.event_id, evidence_business_id: evidence.business_id },
    });
    const settings = await platformSettings.getAll();
    res.json({ settings, g1: await g1State(settings) });
  } catch (err) {
    console.error(`[admin/platform-settings] G1 not recorded: ${err.message}`);
    res.status(500).json({ error: 'تعذّر تسجيل نجاح التجربة' });
  }
});

// Undoing G1 closes what it opened, before the record goes: owner self-connect, and public
// self-signup, which only makes sense while owners can connect alone (SELF_SIGNUP_NEEDS_ES).
router.delete('/g1', async (req, res) => {
  try {
    if (platformSettings.isOn(await platformSettings.get('es_owner_enabled'))) {
      await platformSettings.set('es_owner_enabled', false, req.user.id);
    }
    const signup = await platformSettings.get('self_signup');
    if (platformSettings.isOn(signup)) await platformSettings.set('self_signup', { ...signup, enabled: false }, req.user.id);
    const current = await platformSettings.get('g1_passed_at');
    if (current) {
      await platformSettings.set('g1_passed_at', null, req.user.id);
      await accountEvents.record({
        businessId: null, actorUserId: req.user.id, actorKind: 'shift', type: 'g1_reverted', data: {},
      });
    }
    const settings = await platformSettings.getAll();
    res.json({ settings, g1: await g1State(settings) });
  } catch (err) {
    console.error(`[admin/platform-settings] G1 not undone: ${err.message}`);
    res.status(500).json({ error: 'تعذّر إلغاء تسجيل التجربة' });
  }
});

module.exports = router;
module.exports.validateSetting = validateSetting;
module.exports.EDITABLE = EDITABLE;
module.exports.CONFIRM_TO_ENABLE = CONFIRM_TO_ENABLE;
module.exports.COEXISTENCE_CONFIRM = COEXISTENCE_CONFIRM;
module.exports.SELF_SIGNUP_NEEDS_ES = SELF_SIGNUP_NEEDS_ES;
module.exports.G1_CONFIRM = G1_CONFIRM;
module.exports.g1Evidence = g1Evidence;
