const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const accountEvents = require('../services/accountEvents');
const { decrypt } = require('../utils/tokenCrypto');
const {
  attachOnboarding, completeOnboarding, listWabaNumbers, publicStatus,
} = require('../services/embeddedSignup');
const { wrap } = require('./embeddedSignup');

/**
 * Signups SHIFT has to finish by hand (docs/panels/spec.md, «ربط بدون حساب» and «أكمل الربط»).
 *
 *   GET  /api/admin/onboardings/orphans
 *   POST /api/admin/onboardings/:id/attach    {business_id, replace?}
 *   POST /api/admin/onboardings/:id/complete  {phone_number_id}
 *   GET  /api/admin/onboardings/:id/numbers   the WABA's numbers, to pick one for /complete
 *
 * Three kinds of rows end up here. An onboarding no business owns (the old admin flow made them).
 * An onboarding whose number Meta did not settle (FINISH_ONLY_WABA, a WABA with several numbers,
 * no FINISH): it keeps the customer's token and WABA, so SHIFT picks the number and the customer
 * never opens the popup again. And a PARTNER_ADDED for a WABA with no row at all (Hosted ES, a
 * code lost before the exchange), which only SHIFT can match to a shop.
 *
 * platform_admin only. Ids are shown here, and only here, because this is where SHIFT matches
 * them against WhatsApp Manager. Mounted in app.js before admin.js.
 */

const router = express.Router();
router.use(authenticate, requireRole('platform_admin'));

const MESSAGES = {
  badBusiness: 'اختر الحساب الذي تريد ربط هذا الرقم به.',
  badNumber: 'اختر رقمًا من أرقام حساب واتساب للأعمال.',
  notFound: 'لا يوجد ربط بهذا المعرّف.',
  numberTaken: 'هذا الرقم مربوط بحساب آخر لدى شِفت.',
  failed: 'لم يكتمل الربط. حاول مرة أخرى بعد قليل.',
  noToken: 'لا يوجد رمز وصول محفوظ لهذا الربط — يلزم ربط جديد من نافذة Meta.',
};

const isId = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 64;
const isMetaId = (v) => v !== undefined && v !== null && /^\d{1,32}$/.test(String(v).trim());
const actorOf = (req) => ({ kind: 'shift', userId: req.user.id });

async function businessView(businessId) {
  if (!businessId) return null;
  return prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true, wa_display_phone: true, wa_verified_name: true },
  }).catch(() => null);
}

/** The orphans and the rows waiting for a number, newest first. */
router.get('/orphans', wrap(async (req, res) => {
  const [unattached, numberless, unmatched] = await Promise.all([
    prisma.whatsappOnboarding.findMany({
      where: { business_id: null, detached_at: null },
      orderBy: { created_at: 'desc' },
      take: 100,
    }),
    prisma.whatsappOnboarding.findMany({
      where: { business_id: { not: null }, phone_number_id: null },
      orderBy: { created_at: 'desc' },
      take: 100,
    }),
    accountEvents.list({ businessId: null, types: 'partner_added_unmatched', unresolved: true, limit: 100 }),
  ]);

  const businessIds = [...new Set(numberless.map((r) => r.business_id))];
  const businesses = businessIds.length
    ? await prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(businesses.map((b) => [b.id, b.name]));

  const fromRow = (row, needs) => ({
    id: row.id,
    kind: 'onboarding',
    // A row holds no display number of its own: an orphan's shop is unknown, and a numberless
    // row has none yet.
    display_phone: null,
    verified_name: null,
    waba_id: row.waba_id,
    phone_number_id: row.phone_number_id || null,
    created_at: row.created_at,
    needs,
    step: row.step,
    finish_event: row.finish_event || null,
    business_id: row.business_id || null,
    business_name: row.business_id ? nameOf.get(row.business_id) || null : null,
  });

  // A PARTNER_ADDED that arrived before the exchange wrote its row is not an orphan any more.
  const unmatchedWabas = [...new Set(unmatched.map((e) => e?.data?.waba_id).filter(Boolean))];
  const known = unmatchedWabas.length
    ? new Set((await prisma.whatsappOnboarding.findMany({
      where: { waba_id: { in: unmatchedWabas } }, select: { waba_id: true },
    })).map((r) => r.waba_id))
    : new Set();

  const orphans = [
    ...unattached.map((r) => fromRow(r, 'attach')),
    ...numberless.map((r) => fromRow(r, 'number')),
    ...unmatched.filter((e) => e?.data?.waba_id && !known.has(e.data.waba_id)).map((e) => ({
      id: e.id,
      kind: 'partner_added',
      display_phone: null,
      verified_name: null,
      waba_id: e.data.waba_id,
      phone_number_id: null,
      created_at: e.created_at,
      needs: 'attach',
      owner_business_id: e.data.owner_business_id || null,
      business_id: null,
      business_name: null,
    })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json({ orphans });
}));

async function answer(res, result) {
  const business = await businessView(result.onboarding?.business_id);
  res.json({
    status: result.status,
    onboarding: publicStatus(result.onboarding, { business, audience: 'staff' }),
  });
}

function refusal(res, err) {
  if (err.code === 'number_taken') return res.status(409).json({ error: 'number_taken', message: MESSAGES.numberTaken });
  if (err.message_ar && err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.code, message: err.message_ar });
  }
  if (err.message_ar) {
    return res.status(502).json({ error: 'onboarding_failed', message: err.message_ar, detail: err.message, needs_pin: Boolean(err.needs_pin) });
  }
  if (err.graph !== undefined) {
    return res.status(502).json({ error: 'meta_failed', message: MESSAGES.failed, detail: err.message });
  }
  throw err;
}

/**
 * Give an orphan to a shop. An onboarding row is attached (and linked when it is past /register);
 * a PARTNER_ADDED is marked handled and noted on the shop's log, since without a token the shop
 * still has to run «اربط واتساب» once.
 */
router.post('/:id/attach', wrap(async (req, res) => {
  const businessId = req.body?.business_id;
  if (!isId(businessId)) return res.status(400).json({ error: 'bad_business', message: MESSAGES.badBusiness });
  const id = String(req.params.id);

  const row = await prisma.whatsappOnboarding.findUnique({ where: { id } });
  if (!row) {
    const event = await prisma.accountEvent.findUnique({ where: { id } });
    if (!event || event.type !== 'partner_added_unmatched' || event.business_id) {
      return res.status(404).json({ error: 'not_found', message: MESSAGES.notFound });
    }
    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } });
    if (!business) return res.status(404).json({ error: 'business_not_found', message: 'لا يوجد حساب بهذا المعرّف.' });
    await accountEvents.resolve(event.id, { businessId: null });
    await accountEvents.record({
      businessId: business.id,
      actorUserId: req.user.id,
      actorKind: 'shift',
      type: 'partner_added_matched',
      data: { waba_id: event.data?.waba_id || null, owner_business_id: event.data?.owner_business_id || null, event_id: event.id },
    });
    return res.json({ status: 'not_started', onboarding: null, resolved: true });
  }

  try {
    const result = await attachOnboarding({
      onboardingId: id, businessId, replace: req.body?.replace === true, actor: actorOf(req),
    });
    return answer(res, result);
  } catch (err) {
    return refusal(res, err);
  }
}));

/** «أكمل الربط»: the number SHIFT picked for a row Meta left without one. */
router.post('/:id/complete', wrap(async (req, res) => {
  const phone = req.body?.phone_number_id;
  if (!isMetaId(phone)) return res.status(400).json({ error: 'bad_number', message: MESSAGES.badNumber });
  try {
    const result = await completeOnboarding({ onboardingId: req.params.id, phoneNumberId: String(phone).trim(), actor: actorOf(req) });
    return answer(res, result);
  } catch (err) {
    return refusal(res, err);
  }
}));

/** The numbers on the row's WABA, read with the customer's stored token, to choose from. */
router.get('/:id/numbers', wrap(async (req, res) => {
  const row = await prisma.whatsappOnboarding.findUnique({ where: { id: String(req.params.id) } });
  if (!row) return res.status(404).json({ error: 'not_found', message: MESSAGES.notFound });
  const token = decrypt(row.access_token_enc);
  if (!token) return res.status(409).json({ error: 'no_token', message: MESSAGES.noToken });
  try {
    const numbers = await listWabaNumbers(row.waba_id, token);
    return res.json({
      numbers: numbers.map((n) => ({ id: n.id, display_phone: n.display_phone_number, verified_name: n.verified_name })),
    });
  } catch (err) {
    return refusal(res, err);
  }
}));

router.use((req, res) => res.status(404).json({ error: 'Route not found' }));

module.exports = router;
