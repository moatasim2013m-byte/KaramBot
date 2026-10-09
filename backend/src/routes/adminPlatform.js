'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const platformSettings = require('../services/platformSettings');
const { normalizePhone } = require('../utils/phone');
const labels = require('../config/eventLabels');
const { embeddedSignupAppId } = require('../utils/metaSecrets');

/**
 * «إعدادات المنصة» made real (docs/panels/spec.md; decisions-2026-10-08.md): SHIFT's own switches
 * and defaults, stored as PlatformSetting rows and read by the code that obeys them.
 *
 *   GET   /api/admin/platform-settings          {settings, defaults, editable, meta}
 *   PATCH /api/admin/platform-settings {key, value}
 *
 * platformSettings.set already refuses an unknown key or a value of the wrong type. This route
 * checks what a person can get wrong on top: a free month of 0 days, a daily ceiling of -1, an IBAN
 * with a typo, an alert number that is not a mobile. Each block is saved on its own and may be
 * sent partly: the fields sent are merged over the current value, so «أيام السماح» can change
 * without retyping the campaign. value null restores the code default. Every save is an
 * AccountEvent platform_setting_changed with the value before and after (platformSettings.set).
 *
 * Not editable here, on purpose: provider_status (written by the code when the AI fails).
 *
 * Two switches open something wide, so turning either ON from off needs a sentence typed by a
 * person in the body ({key, value, confirm}) rather than a click (CONFIRM_TO_ENABLE). Turning
 * them off needs nothing: off is the safe side.
 * - Public self-signup (P5, routes/publicSignup.js) is built off (decisions #1: the first ten are
 *   invite-only); its daily cap can be changed freely.
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
function validateSetting(key, sent, current, { confirm } = {}) {
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

router.get('/', async (req, res) => {
  try {
    res.json({
      settings: await platformSettings.getAll(),
      defaults: platformSettings.defaults(),
      editable: EDITABLE,
      labels: labels.SETTING_AR,
      meta: metaInfo(),
      // The sentence the page asks a person to type before a switch goes on.
      confirm_to_enable: Object.fromEntries(Object.entries(CONFIRM_TO_ENABLE).map(([k, r]) => [k, r.text])),
      // Kept for the coexistence block, which reads it by this name.
      coexistence_confirm: COEXISTENCE_CONFIRM,
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
      value = validateSetting(key, req.body.value, await platformSettings.get(key), { confirm: req.body.confirm });
    }
    const effective = await platformSettings.set(key, value, req.user.id);
    res.json({ key, value: effective, settings: await platformSettings.getAll() });
  } catch (err) {
    if (err instanceof SettingInputError) return res.status(400).json({ error: err.message });
    if (err && err.status === 400) return res.status(400).json({ error: 'قيمة الإعداد غير صحيحة' });
    console.error(`[admin/platform-settings] ${key} not saved: ${err.message}`);
    res.status(500).json({ error: 'تعذّر حفظ الإعداد' });
  }
});

module.exports = router;
module.exports.validateSetting = validateSetting;
module.exports.EDITABLE = EDITABLE;
module.exports.CONFIRM_TO_ENABLE = CONFIRM_TO_ENABLE;
module.exports.COEXISTENCE_CONFIRM = COEXISTENCE_CONFIRM;
