'use strict';

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const accountEvents = require('../services/accountEvents');
const platformSettings = require('../services/platformSettings');
const alerts = require('../services/alerts');
const costGuard = require('../services/costGuard');
const { SECTORS } = require('./adminAccounts');
const { slugFromName, nextSlug } = require('./businesses');
const { normalizeLoginPhone } = require('../utils/login');
const { authenticate } = require('../middleware/auth');
const { firstName } = require('../utils/names');

/**
 * «جرّب مجانًا» — public self-signup (docs/panels/spec.md P5; docs/panels/self-signup.md).
 *
 *   GET  /api/public/signup/config       {enabled}: which /join screen a visitor with no link sees
 *   POST /api/public/signup              {shop_name, sector, owner_name, owner_phone, password, website}
 *   POST /api/public/signup/verify       (the new owner's session) has the code arrived from the mobile?
 *   POST /api/public/signup/verify/code  (the new owner's session) a fresh code
 *
 * The only route that makes a shop and a user without SHIFT. It is built OFF (decisions-2026-10-08
 * #1: the first ten are invite-only) and stays completely inert until the owner flips
 * PlatformSetting self_signup.enabled with its confirm text (routes/adminPlatform.js): every POST
 * is a 503 before anything is read from the body.
 *
 * Once on, five things stand between the internet and a free month of AI replies:
 *   1. the daily cap (self_signup.daily_cap, 5 by default), counted from today's business_created
 *      events with source self_signup, Amman's day — the same day the cost guard counts;
 *   2. a per-IP limiter like authLimiter, so one script cannot spend the day's cap in a second;
 *   3. a honeypot: `website` is a field people never see (the form hides it), so a filled one is a bot;
 *   4. the mobile is the visitor's only once they prove it (below): until then it is no login, no
 *      shop's owner number and no alert number, so typing a stranger's mobile takes nothing from them;
 *   5. what invite shops already have: no Subscription until the number is connected (the free
 *      month starts at connect), and the cost guard's reply caps once it is.
 * The duplicate check on meta_business_id and the display number happens where those exist, at
 * connect (services/embeddedSignup.js assertSelfSignupFree), not here.
 *
 * Proving the mobile. Nothing checked it before the P5 review: a stranger could sign up with a
 * shop owner's mobile, hold it as their login (users.phone is unique, so the real owner could then
 * neither sign up nor be invited) and send that shop's handoff alerts to it. And the 409 for a
 * taken mobile told anyone whether a number was a Karam Bot customer. Now the signup answers the
 * same for every mobile and holds none of them: the new owner gets a six-digit code and sends it
 * from that mobile's WhatsApp to SHIFT's number (a wa.me link with the text filled in, free and with
 * no template). The message lands in SHIFT's inbox like any other, read-only from here: the sales
 * bot's message path is untouched (it answers the message as it answers any first message). When
 * an inbound message from that very mobile carries the code, the mobile becomes the owner's login,
 * the shop's owner number and its alert number. Only a hash of the code is stored.
 *
 * The shop gets source 'self_signup' and no number; the owner is active and signed straight in
 * (the session is the only way in until the mobile is proven), and lands on /join's «أكّد رقمك»
 * step, then connect. SHIFT hears of it at once (notifyShift 'self_signup'), because this is a
 * shop nobody at SHIFT has met, and again when the mobile is proven.
 */

const NAME_MAX = 120;
const SLUG_ATTEMPTS = 5;
const PASSWORD_MIN = 10;

const ERRORS = {
  closed: 'التسجيل عبر دعوة من شِفت فقط حاليًا.',
  shopName: 'اكتب اسم المحل',
  sector: 'اختر نوع النشاط',
  ownerName: 'اكتب اسمك',
  ownerPhone: 'رقم الموبايل غير صحيح — اكتبه هكذا: 07XXXXXXXX',
  password: `كلمة المرور يجب أن تكون ${PASSWORD_MIN} أحرف على الأقل`,
  // Only ever said to someone who proved the mobile from its own WhatsApp: the signup itself
  // answers the same for every number, so it tells a stranger nothing about who is a customer.
  phoneTaken: 'هذا الموبايل مسجّل لحساب آخر لدينا. سجّل الدخول به، أو راسل شِفت على واتساب إن نسيت كلمة المرور.',
  notSelfSignup: 'هذه الخطوة لمن سجّل بنفسه من «جرّب مجانًا».',
  noCode: 'لا يوجد رمز تأكيد لهذا الحساب. اطلب رمزًا جديدًا.',
  dailyCap: 'اكتملت تسجيلات اليوم. جرّب غدًا، أو راسل شِفت على واتساب ونفعّلك بأنفسنا.',
  tooMany: 'محاولات كثيرة من هذا الجهاز. انتظر ربع ساعة ثم جرّب مرة أخرى.',
  failed: 'تعذّر إنشاء الحساب، حاول مرة أخرى',
};

// Like app.js's authLimiter (15 minutes, per client IP; app.js trusts one proxy hop so req.ip is
// the visitor, not Google's front end), but tighter: a person signs up once, and five tries cover
// typos. Only POST is counted, so reading /config never uses up a visitor's tries.
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: ERRORS.tooMany },
});

function clean(v, max) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max).trim() : s;
}

// The same session /api/auth/activate hands out (routes/auth.js signToken).
function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

async function selfSignupSetting() {
  try {
    return await platformSettings.get('self_signup');
  } catch (err) {
    console.error(`[public/signup] self_signup not read: ${err.message}`);
    return { enabled: false, daily_cap: 0 };
  }
}

/** Self-signups since midnight in Amman. JSON-path filters are not used (db contract), so the day's few business_created rows are read and filtered here. */
async function signupsToday(now = new Date()) {
  const rows = await prisma.accountEvent.findMany({
    where: { type: 'business_created', created_at: { gte: costGuard.dayStart(now) } },
    select: { data: true },
  });
  return rows.filter((r) => r.data && r.data.source === 'self_signup').length;
}

async function phoneTaken(phone, { exceptBusinessId = null } = {}) {
  const user = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  if (user) return true;
  const shop = await prisma.business.findFirst({ where: { owner_phone: phone }, select: { id: true } });
  return Boolean(shop && shop.id !== exceptBusinessId);
}

// ── The mobile's proof ───────────────────────────────────────────────────────

const CODE_EVENT = 'self_signup_code';
const digest = (code) => crypto.createHash('sha256').update(`karam-self-signup:${code}`).digest('hex');
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/** The text the wa.me link fills in. The page builds the same sentence (JoinPage VerifyStep). */
const codeText = (code) => `رمز تأكيد كرم بوت: ${code}`;

/** A new code for the shop's pending mobile; the old one stops counting. Returns the plain code. */
async function issueCode({ businessId, userId, phone, client = prisma }) {
  const code = newCode();
  await client.accountEvent.updateMany({
    where: { business_id: businessId, type: CODE_EVENT, resolved_at: null },
    data: { resolved_at: new Date() },
  });
  await client.accountEvent.create({
    data: accountEvents.toRow({
      businessId, actorUserId: userId, actorKind: 'owner', type: CODE_EVENT,
      data: { phone, digest: digest(code) },
    }),
  });
  return code;
}

// Arabic-Indic and Persian digits as typed on many phones' keyboards.
const asciiDigits = (s) => String(s || '')
  .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));

/** Did SHIFT's number receive, from `phone` itself and since `since`, a message carrying the code? */
async function codeArrived({ phone, want, since }) {
  const shift = await prisma.business.findFirst({ where: { business_type: 'shift', status: 'active' }, select: { id: true } });
  if (!shift) return false;
  const rows = await prisma.message.findMany({
    where: { business_id: shift.id, direction: 'inbound', sender_wa_id: phone, created_at: { gte: since } },
    select: { text_body: true },
    orderBy: { created_at: 'desc' },
    take: 20,
  });
  return rows.some((r) => (asciiDigits(r.text_body).match(/(?<!\d)\d{6}(?!\d)/g) || []).some((c) => digest(c) === want));
}

/** The signed-in owner of a self-signup shop, or a response already sent. */
async function selfSignupOwner(req, res) {
  const shop = req.user && req.user.role === 'business_owner' && req.user.business_id
    ? await prisma.business.findUnique({ where: { id: req.user.business_id }, select: { id: true, name: true, source: true, ai_config: true } })
    : null;
  if (!shop || shop.source !== 'self_signup') {
    res.status(403).json({ error: ERRORS.notSelfSignup });
    return null;
  }
  return shop;
}

const router = express.Router();

router.get('/config', async (req, res) => {
  const setting = await selfSignupSetting();
  res.json({ enabled: platformSettings.isOn(setting) });
});

router.post('/', platformSettings.requireSetting('self_signup', ERRORS.closed), signupLimiter, async (req, res) => {
  const body = req.body || {};
  // A bot filled the field people never see. Answered like any refused form, so it learns nothing.
  if (String(body.website == null ? '' : body.website).trim()) {
    console.warn('[public/signup] honeypot filled, refused');
    return res.status(400).json({ error: ERRORS.failed });
  }

  const shopName = clean(body.shop_name, NAME_MAX);
  const sector = String(body.sector || '').trim();
  const ownerName = clean(body.owner_name, NAME_MAX);
  const phone = normalizeLoginPhone(body.owner_phone);
  const password = body.password == null ? '' : String(body.password);

  if (!shopName) return res.status(400).json({ error: ERRORS.shopName });
  if (!Object.prototype.hasOwnProperty.call(SECTORS, sector)) return res.status(400).json({ error: ERRORS.sector });
  if (!ownerName) return res.status(400).json({ error: ERRORS.ownerName });
  if (!phone) return res.status(400).json({ error: ERRORS.ownerPhone });
  if (password.length < PASSWORD_MIN) return res.status(400).json({ error: ERRORS.password });

  try {
    const setting = await selfSignupSetting();
    const cap = Number.isInteger(setting.daily_cap) ? setting.daily_cap : 0;
    // A full day answers the same to everyone. Two signups racing past the last place can make
    // it cap + 1; at five a day that is accepted.
    if ((await signupsToday()) >= cap) return res.status(429).json({ error: ERRORS.dailyCap });
    // No «this mobile is taken» here: that answer would tell a stranger who is a customer. A
    // taken mobile is found when its owner proves it (POST /verify), never before.

    const spec = SECTORS[sector];
    const hashed = await bcrypt.hash(password, 12);
    const base = slugFromName(shopName);
    const now = new Date();

    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
      try {
        // One transaction: no shop without its owner. No Subscription and no number: the free
        // month is made at connect, as for an invite (spec decision (a)), so a signup that never
        // connects costs nothing and takes no place in the offer. The mobile is held nowhere yet
        // (no users.phone, no owner_phone, no alert number) until its owner proves it.
        const created = await prisma.$transaction(async (tx) => {
          const business = await tx.business.create({
            data: {
              name: shopName,
              slug: nextSlug(base, attempt),
              business_type: spec.business_type,
              sector,
              owner_phone: null,
              source: 'self_signup',
              wa_phone_number_id: null,
              ai_config: { greeting_message: spec.greeting(shopName), alert_wa_numbers: [] },
            },
            select: { id: true, name: true, business_type: true },
          });
          const owner = await tx.user.create({
            data: {
              name: ownerName,
              email: null,
              phone: null,
              password: hashed,
              role: 'business_owner',
              business_id: business.id,
              active: true,
              // Signed in now: the board puts the shop at «يربط واتساب», not «أُرسل الرابط».
              last_login: now,
            },
            select: { id: true, name: true, email: true, phone: true, role: true, business_id: true },
          });
          await tx.accountEvent.create({
            data: accountEvents.toRow({
              businessId: business.id, actorUserId: owner.id, actorKind: 'owner', type: 'business_created',
              data: { business_type: spec.business_type, sector, source: 'self_signup' },
            }),
          });
          const code = await issueCode({ businessId: business.id, userId: owner.id, phone, client: tx });
          return { business, owner, code };
        });

        const { business, owner, code } = created;
        // Not awaited: the owner's first screen must not wait on SHIFT's WhatsApp, and notifyShift
        // never throws.
        // No phone: it is not proven yet, and SHIFT must not message a mobile a stranger typed.
        alerts.notifyShift({
          reason: 'self_signup',
          businessId: business.id,
          shopName: business.name,
          summary: `${firstName(owner.name) || 'صاحب محل'} سجّل ${business.name} بنفسه — لم يؤكد موبايله بعد`,
        });

        return res.status(201).json({
          token: signToken(owner.id),
          user: {
            id: owner.id,
            name: owner.name,
            email: owner.email ?? null,
            phone: owner.phone ?? null,
            role: owner.role,
            business_id: owner.business_id,
            business_type: business.business_type,
            business_name: business.name,
          },
          verify: { code, text: codeText(code) },
        });
      } catch (err) {
        if (err && err.code === 'P2002') {
          const target = `${JSON.stringify((err.meta && err.meta.target) || '')} ${err.message || ''}`;
          if (target.includes('slug')) continue; // the next candidate, in a new transaction
        }
        throw err;
      }
    }
    console.error(`[public/signup] no free slug after ${SLUG_ATTEMPTS} attempts from "${base}"`);
    return res.status(409).json({ error: ERRORS.failed });
  } catch (err) {
    // Never err.message to a stranger: Prisma's English, with column names in it.
    console.error(`[public/signup] failed: ${err.code || ''} ${err.message}`);
    return res.status(500).json({ error: ERRORS.failed });
  }
});

// The new owner's own session; a few tries a minute is plenty for a page that polls every few seconds.
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: ERRORS.tooMany },
});

/**
 * Has the code arrived from the mobile? {verified: false} until it has; then the mobile becomes the
 * owner's login, the shop's owner number and its alert number, and {verified: true, user}. A mobile
 * another account already holds is a 409: the person proved it is theirs, so saying so leaks nothing.
 * Not behind the self_signup switch: a shop that signed up before SHIFT closed it can still finish.
 */
router.post('/verify', verifyLimiter, authenticate, async (req, res) => {
  try {
    const shop = await selfSignupOwner(req, res);
    if (!shop) return undefined;
    if (req.user.phone) return res.json({ verified: true });
    const [pending] = await accountEvents.list({ businessId: shop.id, types: CODE_EVENT, unresolved: true, limit: 1 });
    if (!pending || !pending.data || !pending.data.phone) return res.status(404).json({ error: ERRORS.noCode });
    const phone = String(pending.data.phone);
    if (!(await codeArrived({ phone, want: pending.data.digest, since: new Date(pending.created_at) }))) {
      return res.json({ verified: false });
    }

    if (await phoneTaken(phone, { exceptBusinessId: shop.id })) {
      await accountEvents.resolve(pending.id);
      await accountEvents.record({ businessId: shop.id, actorUserId: req.user.id, actorKind: 'owner', type: 'self_signup_phone_taken', data: {} });
      return res.status(409).json({ error: ERRORS.phoneTaken });
    }
    const aiConfig = shop.ai_config && typeof shop.ai_config === 'object' ? shop.ai_config : {};
    try {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: req.user.id }, data: { phone } });
        await tx.business.update({
          where: { id: shop.id },
          data: { owner_phone: phone, ai_config: { ...aiConfig, alert_wa_numbers: [phone] } },
        });
      });
    } catch (err) {
      // Another account took the mobile between the check and the write.
      if (err && err.code === 'P2002') return res.status(409).json({ error: ERRORS.phoneTaken });
      throw err;
    }
    await accountEvents.resolve(pending.id);
    await accountEvents.record({ businessId: shop.id, actorUserId: req.user.id, actorKind: 'owner', type: 'self_signup_verified', data: {} });
    alerts.notifyShift({
      reason: 'self_signup',
      businessId: shop.id,
      shopName: shop.name,
      phone,
      summary: `أكّد صاحب ${shop.name} موبايله — التالي: ربط واتساب`,
    });
    return res.json({ verified: true, user: { id: req.user.id, phone } });
  } catch (err) {
    console.error(`[public/signup] verify failed: ${err.code || ''} ${err.message}`);
    return res.status(500).json({ error: ERRORS.failed });
  }
});

/** A fresh code for the same pending mobile (the page lost it on a reload, or the owner asked). */
router.post('/verify/code', verifyLimiter, authenticate, async (req, res) => {
  try {
    const shop = await selfSignupOwner(req, res);
    if (!shop) return undefined;
    if (req.user.phone) return res.json({ verified: true });
    const [pending] = await accountEvents.list({ businessId: shop.id, types: CODE_EVENT, unresolved: true, limit: 1 });
    if (!pending || !pending.data || !pending.data.phone) return res.status(404).json({ error: ERRORS.noCode });
    const code = await issueCode({ businessId: shop.id, userId: req.user.id, phone: String(pending.data.phone) });
    return res.json({ verified: false, code, text: codeText(code) });
  } catch (err) {
    console.error(`[public/signup] new code failed: ${err.code || ''} ${err.message}`);
    return res.status(500).json({ error: ERRORS.failed });
  }
});

module.exports = router;
module.exports.codeText = codeText;
module.exports.ERRORS = ERRORS;
module.exports.signupsToday = signupsToday;
