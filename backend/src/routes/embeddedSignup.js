const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, requireRole, attachBusinessId } = require('../middleware/auth');
const { requireSetting } = require('../services/platformSettings');
const accountEvents = require('../services/accountEvents');
const alerts = require('../services/alerts');
const { embeddedSignupAppId } = require('../utils/metaSecrets');
const {
  connectFromCode, resumeOnboarding, publicStatus, deriveStatus, normalizeFinishEvent, ERRORS_AR,
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
  missingFields: 'بيانات الربط من Meta ناقصة أو غير صالحة. افتح نافذة الربط من جديد.',
  numberTaken: ERRORS_AR.number_taken,
  ownershipMismatch: ERRORS_AR.ownership,
  failed: ERRORS_AR.generic,
  badPin: 'رمز التحقق بخطوتين يجب أن يكون 6 أرقام.',
  noOnboarding: 'لم يبدأ ربط واتساب لهذا الحساب بعد.',
  badEvent: 'نوع الحدث غير معروف.',
  internal: 'تعذّر إكمال الطلب. حاول مرة أخرى بعد قليل.',
};

// What the browser reports besides a finished signup. LAUNCHED is sent right after FB.login opens
// the popup, so the board shows «يربط واتساب» even when the customer never comes back.
const BROWSER_EVENTS = ['LAUNCHED', 'CANCEL', 'ERROR'];

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

/**
 * A failure as the panel reads it: the contract's status 'failed', the onboarding where it
 * stopped, and Arabic words. SHIFT also gets Meta's own message (`detail`), which is what Meta
 * support asks for; the owner never sees it.
 */
async function failureBody(scope, err, error, extra = {}) {
  const body = {
    error,
    status: 'failed',
    message: err.message_ar || MESSAGES.failed,
    error_code: err.graph?.code ?? null,
    needs_pin: Boolean(err.needs_pin),
    onboarding: await statusFor(scope, err.onboarding || null),
    ...extra,
  };
  if (scope.audience === 'staff') body.detail = err.message;
  return body;
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
 * The browser posts the authResponse code and whatever FINISH payload it got.
 *
 * The exchange runs inline, not on a queue: the code expires 30 seconds after the
 * flow closes, and a queue hop can cost more than that.
 *
 * Only the code is required. Every FINISH_* event is accepted, and so is none at all: a missing
 * WABA or number is found on the server from what the token was granted (connectFromCode), where
 * a 400 here used to burn the code. The ids the browser does send must at least look like Meta
 * ids; they still prove nothing until Meta confirms them with the token.
 *
 * 200 answers carry status connected, needs_number or needs_operator; 409 a number another shop
 * holds; 403 ids the customer's Facebook login does not cover; 422 a grant naming no single
 * WABA (a new popup is needed); 502 a Graph step that failed,
 * resumable from GET /status and POST /retry.
 */
async function exchange(req, res) {
  const scope = req.es;
  const body = req.body || {};
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const finishEvent = normalizeFinishEvent(body.finish_event);
  const wabaId = metaId(body.waba_id);
  const phoneNumberId = metaId(body.phone_number_id);
  const metaBusinessId = metaId(body.meta_business_id);

  if (!code || code.length > 2048 || finishEvent === undefined
    || wabaId === undefined || phoneNumberId === undefined || metaBusinessId === undefined) {
    return res.status(400).json({ error: 'missing_fields', message: MESSAGES.missingFields });
  }

  try {
    const result = await connectFromCode({
      businessId: scope.businessId,
      code,
      finishEvent,
      hints: { wabaId, phoneNumberId, metaBusinessId, sessionId: shortString(body.session_id, 128) },
      actor: actorOf(scope),
    });
    return res.json({ status: result.status, onboarding: await statusFor(scope, result.onboarding) });
  } catch (err) {
    if (err.code === 'number_taken') {
      return res.status(409).json({ error: 'number_taken', status: 'failed', message: MESSAGES.numberTaken });
    }
    if (err.code === 'es_ownership_mismatch') {
      return res.status(403).json({ error: 'es_ownership_mismatch', status: 'failed', message: MESSAGES.ownershipMismatch });
    }
    // Not one WABA to keep the token against: nothing was stored, a new popup is the way on.
    if (err.code === 'waba_unresolved') {
      return res.status(422).json(await failureBody(scope, err, 'waba_unresolved', { resumable: false }));
    }
    // A TypeError or a database error before any Graph call is ours, not Meta's.
    if (!err.message_ar) throw err;
    const row = err.onboarding || null;
    return res.status(502).json(await failureBody(scope, err, 'onboarding_failed', {
      resumable: Boolean(row && row.phone_number_id && row.step !== 'code_received'),
    }));
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

  try {
    const result = await resumeOnboarding({ businessId: scope.businessId, pin, actor: actorOf(scope) });
    if (!result) return res.status(404).json({ error: 'no_onboarding', message: MESSAGES.noOnboarding });
    return res.json({ status: result.status, onboarding: await statusFor(scope, result.onboarding) });
  } catch (err) {
    if (err.code === 'number_taken') {
      return res.status(409).json({ error: 'number_taken', status: 'failed', message: MESSAGES.numberTaken });
    }
    if (!err.message_ar) throw err;
    return res.status(502).json(await failureBody(scope, err, 'retry_failed'));
  }
}

/**
 * LAUNCHED, CANCEL and error events from the browser.
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
  if (event === 'LAUNCHED') {
    await record(scope, 'es_started', { source: 'browser', session_id: shortString(body.session_id, 128) });
    return res.json({ ok: true });
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

/**
 * The caller's own onboarding, for the panels. Takes no parameters. Reading it is how the card
 * resumes after a reload: the step, the Arabic problem and needs_pin are all here.
 */
async function status(req, res) {
  const scope = req.es;
  const row = await prisma.whatsappOnboarding.findFirst({
    where: { business_id: scope.businessId },
    orderBy: { created_at: 'desc' },
  });
  res.json({ status: deriveStatus(row), onboarding: await statusFor(scope, row) });
}

/**
 * «لا، ليس هذا الرقم» on /join (spec step 7): the owner says the number Meta's window connected is
 * not their shop's. It sets needs_operator on the shop's onboarding, writes AccountEvent
 * wrong_number (the board's «بحاجة لشِفت») and alerts SHIFT, which is what the screen promises
 * («سيتواصل معك فريق شِفت»). Nothing is rolled back automatically: SHIFT checks it with the owner.
 * Owner only, on their own account; pressing again does not alert twice while the first is open.
 */
async function wrongNumber(req, res) {
  const scope = req.es;
  const row = await prisma.whatsappOnboarding.findFirst({
    where: { business_id: scope.businessId },
    orderBy: { created_at: 'desc' },
    select: { id: true, needs_operator: true, phone_number_id: true },
  });
  if (!row) return res.status(404).json({ error: 'no_onboarding', message: MESSAGES.noOnboarding });
  if (!row.needs_operator) {
    await prisma.whatsappOnboarding.update({ where: { id: row.id }, data: { needs_operator: true } });
  }
  const open = await prisma.accountEvent.findFirst({
    where: { business_id: scope.businessId, type: 'wrong_number', resolved_at: null },
    select: { id: true },
  });
  if (!open) {
    const business = await prisma.business.findUnique({
      where: { id: scope.businessId }, select: { name: true, wa_display_phone: true },
    }).catch(() => null);
    await record(scope, 'wrong_number', { onboarding_id: row.id, display_phone: business?.wa_display_phone || null });
    try {
      await alerts.notifyShift({
        reason: 'needs_operator',
        businessId: scope.businessId,
        shopName: business?.name || '',
        summary: `قال صاحب المحل إن الرقم المربوط${business?.wa_display_phone ? ` ${business.wa_display_phone}` : ''} ليس رقم محله — تواصل معه`,
      });
    } catch (err) {
      console.error(`[embedded-signup] wrong_number alert failed business=${scope.businessId}: ${err.message}`);
    }
  }
  return res.json({ ok: true, status: 'needs_operator' });
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
// The owner's answer to «هل هذا رقم محلك؟»; SHIFT's attended connect has no such question.
router.post('/wrong-number', wrap(wrongNumber));
mountAccountRoutes(router);

module.exports = router;
// For the admin mirror (routes/adminEmbeddedSignup.js), so both sides run the same handlers.
module.exports.config = config;
module.exports.mountAccountRoutes = mountAccountRoutes;
module.exports.refuseBusinessIdInput = refuseBusinessIdInput;
module.exports.wrap = wrap;
