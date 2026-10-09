'use strict';

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
const { firstName } = require('../utils/names');

/**
 * «جرّب مجانًا» — public self-signup (docs/panels/spec.md P5; docs/panels/self-signup.md).
 *
 *   GET  /api/public/signup/config  {enabled}: which /join screen a visitor with no link sees
 *   POST /api/public/signup         {shop_name, sector, owner_name, owner_phone, password, website}
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
 *   4. one mobile, one owner: a number that already signs in, or is already a shop's owner, is a 409;
 *   5. what invite shops already have: no Subscription until the number is connected (the free
 *      month starts at connect), and the cost guard's reply caps once it is.
 * The duplicate check on meta_business_id and the display number happens where those exist, at
 * connect (services/embeddedSignup.js assertNumberFree), not here.
 *
 * The shop gets source 'self_signup' and no number; the owner is active and signed straight in,
 * like /activate, and lands on /join's connect step. SHIFT hears of it at once (notifyShift
 * 'self_signup'), because this is a shop nobody at SHIFT has met.
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
  // Deliberately says nothing about which shop: this page is public, so it must not tell a
  // stranger whose number is on Karam Bot.
  phoneTaken: 'هذا الموبايل مسجّل لدينا. سجّل الدخول، أو راسل شِفت على واتساب إن نسيت كلمة المرور.',
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

async function phoneTaken(phone) {
  const user = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  if (user) return true;
  const shop = await prisma.business.findFirst({ where: { owner_phone: phone }, select: { id: true } });
  return Boolean(shop);
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
    // Counted before the duplicate check, so a full day answers the same to everyone. Two
    // signups racing past the last place can make it cap + 1; at five a day that is accepted.
    if ((await signupsToday()) >= cap) return res.status(429).json({ error: ERRORS.dailyCap });

    if (await phoneTaken(phone)) return res.status(409).json({ error: ERRORS.phoneTaken });

    const spec = SECTORS[sector];
    const hashed = await bcrypt.hash(password, 12);
    const base = slugFromName(shopName);
    const now = new Date();

    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
      try {
        // One transaction: no shop without its owner. No Subscription and no number: the free
        // month is made at connect, as for an invite (spec decision (a)), so a signup that never
        // connects costs nothing and takes no place in the offer.
        const created = await prisma.$transaction(async (tx) => {
          const business = await tx.business.create({
            data: {
              name: shopName,
              slug: nextSlug(base, attempt),
              business_type: spec.business_type,
              sector,
              owner_phone: phone,
              source: 'self_signup',
              wa_phone_number_id: null,
              ai_config: { greeting_message: spec.greeting(shopName), alert_wa_numbers: [phone] },
            },
            select: { id: true, name: true, business_type: true },
          });
          const owner = await tx.user.create({
            data: {
              name: ownerName,
              email: null,
              phone,
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
          return { business, owner };
        });

        const { business, owner } = created;
        // Not awaited: the owner's first screen must not wait on SHIFT's WhatsApp, and notifyShift
        // never throws.
        alerts.notifyShift({
          reason: 'self_signup',
          businessId: business.id,
          shopName: business.name,
          phone,
          summary: `${firstName(owner.name) || 'صاحب محل'} سجّل ${business.name} بنفسه — التالي: ربط واتساب`,
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
        });
      } catch (err) {
        if (err && err.code === 'P2002') {
          const target = `${JSON.stringify((err.meta && err.meta.target) || '')} ${err.message || ''}`;
          if (target.includes('slug')) continue; // the next candidate, in a new transaction
          if (target.includes('phone')) return res.status(409).json({ error: ERRORS.phoneTaken });
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

module.exports = router;
module.exports.ERRORS = ERRORS;
module.exports.signupsToday = signupsToday;
