const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, requireRole, attachBusinessId } = require('../middleware/auth');
const { requireSetting } = require('../services/platformSettings');
const accountEvents = require('../services/accountEvents');
const { embeddedSignupAppId } = require('../utils/metaSecrets');
const {
  startOnboarding, runOnboarding, publicStatus, exchangeCode, verifyGrant, assertNumberFree,
} = require('../services/embeddedSignup');

/**
 * Embedded Signup (v4) endpoints: the shop owner's own.
 *
 * The business is always the caller's: req.businessId from the session (attachBusinessId), never
 * the body or the query. The previous version trusted a body business_id and keyed /status,
 * /:id/retry and /events on ids the browser sent, so one shop could read, resume or overwrite
 * another's signup (docs/panels/spec.md, «Must be true before ES opens to customers»).
 *
 * Closed until G1, the first attended live run, has passed: es_owner_enabled is false by default
 * and this router answers 503 until SHIFT turns it on. SHIFT itself connects a shop through the
 * admin mirror (routes/adminEmbeddedSignup.js), which shares the handlers below and takes the
 * business from the URL.
 */

const ES_CLOSED_AR = 'الربط الذاتي متوقف مؤقتًا';

const MESSAGES = {
  businessIdRefused: 'الحساب يُحدَّد من الجلسة أو من الرابط، لا من الطلب.',
  missingFields: 'بيانات الربط من Meta ناقصة أو غير صالحة: يلزم code و waba_id و phone_number_id.',
  numberTaken: 'هذا الرقم مربوط بحساب آخر على شِفت. تواصل مع فريق شِفت لحل المشكلة.',
  ownershipMismatch: 'هذا الرقم لا يتبع الحساب الذي دخلت به في فيسبوك.',
  failed: 'لم يكتمل ربط واتساب. حاول مرة أخرى، أو تواصل مع فريق شِفت.',
  badPin: 'رمز التحقق بخطوتين يجب أن يكون 6 أرقام.',
  noOnboarding: 'لم يبدأ ربط واتساب لهذا الحساب بعد.',
  badEvent: 'نوع الحدث غير معروف.',
  internal: 'تعذّر إكمال الطلب. حاول مرة أخرى بعد قليل.',
};

const BROWSER_EVENTS = ['CANCEL', 'ERROR'];

/** A Meta id (WABA, phone number, portfolio) is a string of digits; anything else is refused. */
function metaId(value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  return /^\d{1,32}$/.test(s) ? s : undefined;
}

function shortString(value, max) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).slice(0, max);
}

const has = (obj, key) => Boolean(obj) && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);

/**
 * A request that names a business is refused rather than ignored: the browser has no say in
 * which account a number is bound to, and a 400 shows a stale client or a probe for what it is.
 */
function refuseBusinessIdInput(req, res, next) {
  const named = ['business_id', 'businessId'].some((k) => has(req.body, k) || has(req.query, k));
  if (named) return res.status(400).json({ error: 'business_id_not_allowed', message: MESSAGES.businessIdRefused });
  return next();
}

// Express 4 does not catch a rejected handler: without this a DB error leaves the request open.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
  console.error(`[embedded-signup] ${req.method} ${req.baseUrl}${req.path} failed: ${err.message}`);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: 'internal', message: MESSAGES.internal });
});

const actorOf = (scope) => ({ kind: scope.actorKind, userId: scope.actorUserId });

/** The onboarding as this reader may see it, with the number as Meta shows it when known. */
async function statusFor(scope, row) {
  if (!row) return null;
  const business = await prisma.business.findUnique({
    where: { id: scope.businessId },
    select: { wa_display_phone: true, wa_verified_name: true },
  }).catch(() => null);
  return publicStatus(row, { business, audience: scope.audience });
}

function record(scope, type, data) {
  return accountEvents.record({
    businessId: scope.businessId,
    actorUserId: scope.actorUserId,
    actorKind: scope.actorKind,
    type,
    data,
  });
}

// What a failed step tells SHIFT. err.message is a Graph message (graphError), never the token.
function failureData(err, stage, extra = {}) {
  return {
    stage,
    error_message: err.message,
    error_code: err.graph?.code ?? null,
    error_subcode: err.graph?.error_subcode ?? null,
    ...extra,
  };
}

/** The config the browser needs. The app secret is not here and never will be. */
function config(req, res) {
  res.json({
    app_id: embeddedSignupAppId(),
    config_id: process.env.META_ES_CONFIG_ID || '1664627968720314',
    graph_version: process.env.GRAPH_API_VERSION || 'v24.0',
    // The popup in the shop's language (connect.facebook.net/ar_AR).
    locale: 'ar_AR',
  });
}

/**
 * The browser posts the FINISH payload and the authResponse code together.
 *
 * The exchange runs inline, not on a queue: the code expires 30 seconds after the
 * flow closes, and a queue hop can cost more than that.
 *
 * Order (docs/panels/spec.md P0/P1, connectFromCode): a cheap number-conflict check, then the
 * code exchange, then verifyGrant, and only then the onboarding row. The browser's ids prove
 * nothing until Meta has confirmed them with the token: the previous order wrote them first, so
 * a bogus code naming another shop's fresh number left that number on the caller's row (the
 * failure path keeps the row) and the real owner got 409 number_taken when they connected it.
 */
async function exchange(req, res) {
  const scope = req.es;
  const body = req.body || {};
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const wabaId = metaId(body.waba_id);
  const phoneNumberId = metaId(body.phone_number_id);
  const metaBusinessId = metaId(body.meta_business_id);

  if (!code || !wabaId || !phoneNumberId || metaBusinessId === undefined) {
    return res.status(400).json({ error: 'missing_fields', message: MESSAGES.missingFields });
  }

  let stage = 'exchange';
  try {
    // Before the code is spent: a number another shop holds is refused without calling Meta.
    // startOnboarding checks again after the proof, against a row created in between.
    const own = await prisma.whatsappOnboarding.findUnique({ where: { business_id: scope.businessId } });
    await assertNumberFree(phoneNumberId, scope.businessId, { onboardingId: own?.id || null, wabaId, actor: actorOf(scope) });

    const token = await exchangeCode(code);
    stage = 'verify';
    const grant = await verifyGrant(token, { wabaId, phoneNumberId });
    stage = 'exchange';

    const row = await startOnboarding({
      appId: embeddedSignupAppId(),
      businessId: scope.businessId,
      metaBusinessId: grant.metaBusinessId || metaBusinessId,
      wabaId: grant.wabaId,
      phoneNumberId: grant.phoneNumberId,
      sessionId: shortString(body.session_id, 128),
      actor: actorOf(scope),
    });

    const done = await runOnboarding(row.id, { token, actor: actorOf(scope) });
    await record(scope, 'es_connected', { waba_id: wabaId, phone_number_id: phoneNumberId });
    return res.json({ status: 'connected', onboarding: await statusFor(scope, done) });
  } catch (err) {
    // es_conflict is already on the account, and nothing was written or sent to Meta.
    if (err.code === 'number_taken') {
      return res.status(409).json({ error: 'number_taken', message: MESSAGES.numberTaken });
    }
    // Meta says the token does not cover these ids: nothing was written. SHIFT hears of it,
    // since it is either a probe for another shop's number or a signup that went wrong.
    if (err.code === 'es_ownership_mismatch') {
      await record(scope, 'es_ownership_mismatch', { waba_id: wabaId, phone_number_id: phoneNumberId, detail: err.detail });
      try {
        const alerts = require('../services/alerts');
        Promise.resolve(alerts.notifyShift({
          reason: 'needs_operator', businessId: scope.businessId, summary: 'رقم واتساب لا يتبع حساب فيسبوك الذي دخل به الزبون',
        })).catch(() => {});
      } catch (alertErr) {
        console.error(`[embedded-signup] ownership alert failed: ${alertErr.message}`);
      }
      return res.status(403).json({ error: 'es_ownership_mismatch', message: MESSAGES.ownershipMismatch });
    }
    // The step reached is on the caller's own row when there is one, so the dashboard can offer
    // a resume rather than a fresh signup. Read by business: the phone id came from the browser.
    console.error('[embedded-signup] onboarding failed:', err.message);
    const row = await prisma.whatsappOnboarding.findUnique({ where: { business_id: scope.businessId } }).catch(() => null);
    await record(scope, 'es_failed', failureData(err, stage, {
      step: row?.step || null, waba_id: wabaId, phone_number_id: phoneNumberId,
    }));
    return res.status(502).json({
      error: 'onboarding_failed',
      message: scope.audience === 'staff' ? err.message : MESSAGES.failed,
      error_code: err.graph?.code ?? null,
      onboarding: await statusFor(scope, row),
      resumable: Boolean(row && row.step !== 'code_received'),
    });
  }
}

/**
 * Continue the caller's own signup that failed at step 2 or 3. No new Embedded Signup run needed.
 *
 * It takes no id: the row is the business's own (business_id is unique), so there is nothing a
 * browser could name that reaches another shop's signup.
 *
 * An optional 6-digit `pin` is for a number that already had two-step verification set
 * elsewhere: Meta rejects any PIN but the existing one, so the customer supplies theirs.
 */
async function retry(req, res) {
  const scope = req.es;
  const raw = req.body?.pin;
  const pin = raw === undefined || raw === null || raw === '' ? undefined : String(raw);
  if (pin !== undefined && !/^\d{6}$/.test(pin)) {
    return res.status(400).json({ error: 'bad_pin', message: MESSAGES.badPin });
  }

  const row = await prisma.whatsappOnboarding.findFirst({
    where: { business_id: scope.businessId },
    orderBy: { created_at: 'desc' },
  });
  if (!row) return res.status(404).json({ error: 'no_onboarding', message: MESSAGES.noOnboarding });

  try {
    const done = await runOnboarding(row.id, { pin, actor: actorOf(scope) });
    if (row.step !== 'done') {
      await record(scope, 'es_connected', { waba_id: row.waba_id, phone_number_id: row.phone_number_id, resumed_from: row.step });
    }
    return res.json({ status: 'connected', onboarding: await statusFor(scope, done) });
  } catch (err) {
    if (err.code === 'number_taken') {
      return res.status(409).json({ error: 'number_taken', message: MESSAGES.numberTaken });
    }
    console.error('[embedded-signup] retry failed:', err.message);
    const current = await prisma.whatsappOnboarding.findUnique({ where: { id: row.id } }).catch(() => null);
    await record(scope, 'es_failed', failureData(err, 'retry', { step: current?.step || row.step }));
    return res.status(502).json({
      error: 'retry_failed',
      message: scope.audience === 'staff' ? err.message : MESSAGES.failed,
      error_code: err.graph?.code ?? null,
      onboarding: await statusFor(scope, current),
    });
  }
}

/**
 * CANCEL and error events from the browser.
 *
 * Kept because an abandoned signup is the useful thing to see: `current_step` says
 * where customers give up, and `session_id` is what Meta support asks for. Written as an
 * AccountEvent on the caller's own account only. The previous version also wrote last_error onto
 * whichever row held a phone_number_id the browser named, which reached other shops' rows.
 */
async function events(req, res) {
  const scope = req.es;
  const body = req.body || {};
  const event = typeof body.event === 'string' ? body.event.trim().toUpperCase() : '';
  if (!BROWSER_EVENTS.includes(event)) {
    return res.status(400).json({ error: 'bad_event', message: MESSAGES.badEvent });
  }

  const errorMessage = shortString(body.error_message, 500);
  const currentStep = shortString(body.current_step, 64);
  const sessionId = shortString(body.session_id, 128);
  // Meta's docs show user-reported errors as CANCEL carrying error_message, older ones as ERROR.
  const type = event === 'ERROR' || errorMessage ? 'es_failed' : 'es_cancelled';
  console.log(`[embedded-signup] ${event} business=${scope.businessId} step=${currentStep || '-'} session=${sessionId || '-'}`);

  await record(scope, type, {
    source: 'browser',
    event,
    current_step: currentStep,
    error_message: errorMessage,
    error_code: shortString(body.error_code, 32),
    session_id: sessionId,
  });
  return res.json({ ok: true });
}

/** The caller's own onboarding, for the dashboard checklist. Takes no parameters. */
async function status(req, res) {
  const scope = req.es;
  const row = await prisma.whatsappOnboarding.findFirst({
    where: { business_id: scope.businessId },
    orderBy: { created_at: 'desc' },
  });
  res.json({ onboarding: await statusFor(scope, row) });
}

/**
 * The account-scoped routes, identical for the owner and the admin mirror. The router that
 * mounts them must set req.es = {businessId, actorKind, actorUserId, audience} first, from the
 * session or the URL, never from the request's body or query.
 */
function mountAccountRoutes(r) {
  r.post('/exchange', wrap(exchange));
  r.post('/retry', wrap(retry));
  r.post('/events', wrap(events));
  r.get('/status', wrap(status));
  return r;
}

router.use(
  authenticate,
  requireRole('business_owner'),
  attachBusinessId,
  requireSetting('es_owner_enabled', ES_CLOSED_AR),
  refuseBusinessIdInput,
  (req, res, next) => {
    req.es = { businessId: req.businessId, actorKind: 'owner', actorUserId: req.user.id, audience: 'owner' };
    next();
  },
);

router.get('/config', config);
mountAccountRoutes(router);

module.exports = router;
// For the admin mirror (routes/adminEmbeddedSignup.js), so both sides run the same handlers.
module.exports.config = config;
module.exports.mountAccountRoutes = mountAccountRoutes;
module.exports.refuseBusinessIdInput = refuseBusinessIdInput;
module.exports.wrap = wrap;
