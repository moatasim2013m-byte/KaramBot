const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { authenticate } = require('../middleware/auth');
const {
  findUserByLogin, normalizeEmail, normalizeLoginPhone, loginTaken, LOGIN_TAKEN_ERROR, maskPhone,
} = require('../utils/login');

const BAD_LOGIN = 'رقم الموبايل أو البريد أو كلمة المرور غير صحيحة';

function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

/**
 * The business half of a session: its type (which picks the nav: menu, clinic or neither) and its
 * name (the brand line «كرم بوت · {اسم المحل}»). Every way of getting a session — login, /me and
 * activation — answers with both, so the first screen after any of them is already complete.
 * A failed lookup answers nulls rather than failing the sign-in: the nav degrades, the login works.
 */
async function businessInfo(user) {
  if (!user || !user.business_id) return { business_type: null, business_name: null };
  if (user.business && typeof user.business === 'object') {
    return { business_type: user.business.business_type ?? null, business_name: user.business.name ?? null };
  }
  try {
    const business = await prisma.business.findUnique({
      where: { id: user.business_id },
      select: { business_type: true, name: true },
    });
    return { business_type: business ? business.business_type : null, business_name: business ? business.name : null };
  } catch (e) {
    return { business_type: null, business_name: null };
  }
}

// POST /api/auth/login — {login | email, password}. `login` is what the form now sends: a mobile
// number or an email (utils/login.js decides by '@'). `email` is still read so a browser holding
// the previous bundle keeps signing in across the deploy.
router.post('/login', async (req, res) => {
  try {
    const { password } = req.body || {};
    const login = (req.body || {}).login ?? (req.body || {}).email;
    if (!login || !password) return res.status(400).json({ error: 'أدخل رقم الموبايل أو البريد الإلكتروني وكلمة المرور' });

    const user = await findUserByLogin(login, {
      id: true, name: true, email: true, phone: true, role: true,
      business_id: true, active: true, password: true,
    });
    // One answer for an unknown login and a wrong password, so the form cannot be used to learn
    // which numbers have an account.
    if (!user) return res.status(401).json({ error: BAD_LOGIN });

    const valid = await bcrypt.compare(String(password), user.password);
    if (!valid) return res.status(401).json({ error: BAD_LOGIN });

    if (!user.active) return res.status(403).json({ error: 'هذا الحساب غير مفعّل. تواصل مع شِفت.' });

    await prisma.user.update({
      where: { id: user.id },
      data: { last_login: new Date() },
    });

    const token = signToken(user.id);

    const { business_type, business_name } = await businessInfo(user);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone ?? null,
        role: user.role,
        business_id: user.business_id,
        business_type,
        business_name,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/register (platform_admin creates business users)
router.post('/register', authenticate, async (req, res) => {
  try {
    if (!['platform_admin', 'business_owner'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { name, password, role, business_id } = req.body || {};
    // A login is an email, a mobile, or both (Migration 2). A phone that is given must be a real
    // Jordanian mobile: storing a typo would make an account nobody can sign in to.
    const email = normalizeEmail(req.body?.email);
    const rawPhone = req.body?.phone;
    const phone = rawPhone ? normalizeLoginPhone(rawPhone) : null;
    if (rawPhone && !phone) return res.status(400).json({ error: 'رقم الموبايل غير صحيح' });
    if (!name || !password || (!email && !phone)) {
      return res.status(400).json({ error: 'الاسم وكلمة المرور ورقم الموبايل أو البريد مطلوبة' });
    }

    const targetBusinessId = req.user.role === 'platform_admin' ? business_id : req.user.business_id;
    const targetRole = req.user.role === 'platform_admin' ? (role || 'staff') : 'staff';

    // A tenant user with no business is the shape that used to slip past request scoping,
    // and it is meaningless anyway: staff belong to a business. Only platform_admin may
    // exist without one.
    if (targetRole !== 'platform_admin' && !targetBusinessId) {
      return res.status(400).json({ error: 'business_id required for a non-admin user' });
    }

    const taken = await loginTaken({ email, phone });
    if (taken) return res.status(409).json({ error: LOGIN_TAKEN_ERROR[taken] });

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        password: hashed,
        role: targetRole,
        business_id: targetBusinessId || null,
      },
    });
    res.status(201).json({ id: user.id, name: user.name, email: user.email, phone: user.phone ?? null, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  // authenticate() already resolved business_type; the name is looked up here only, so the
  // middleware on every other request stays one query lighter.
  const { business_name } = await businessInfo({ business_id: req.user.business_id });
  res.json({
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    phone: req.user.phone ?? null,
    role: req.user.role,
    business_id: req.user.business_id,
    business_type: req.user.business_type,
    business_name,
  });
});

/**
 * Redeeming an activation link. Public by necessity — the customer has no account yet — so it
 * is deliberately quiet: every failure answers the same way, whether the link never existed,
 * already got used, or expired. A link that leaked cannot be used to discover which customers
 * exist, and a valid one reveals only the name and email it was issued for.
 *
 * These two routes sit behind the same rate limiter as login (app.js mounts authLimiter on
 * /api/auth), so the token cannot be brute-forced by volume.
 */
const activation = require('../services/activation');
const accountEvents = require('../services/accountEvents');
const alerts = require('../services/alerts');

const { firstName } = require('../utils/names');

/** The shop's sector and number for /join: from the loaded relation, else read by the user's own id. */
async function joinBusiness(user) {
  if (!user || !user.business_id) return null;
  const loaded = user.business && typeof user.business === 'object' ? user.business : null;
  if (loaded && 'sector' in loaded && 'wa_phone_number_id' in loaded) return loaded;
  try {
    return await prisma.business.findUnique({
      where: { id: user.business_id },
      select: { sector: true, wa_phone_number_id: true },
    });
  } catch (e) {
    return null;
  }
}

/**
 * The first time a shop owner opens their join link: the account's log (join_opened, which moves
 * the board card to «فتحه») and one WhatsApp alert to SHIFT, «أبو خالد فتح رابط مطعم الشام».
 * Once per link: a reload, or the owner coming back the next day, says nothing new. Staff and
 * manager invites are the shop's own business and do not alert SHIFT. Never throws.
 */
async function noteJoinOpened(row, shopName = null) {
  try {
    const user = row.user || {};
    if (user.role !== 'business_owner' || !user.business_id) return;
    const seen = await prisma.accountEvent.findMany({
      where: { business_id: user.business_id, type: 'join_opened' },
      select: { data: true },
      take: 50,
    });
    if ((seen || []).some((e) => e.data && e.data.activation_id === row.id)) return;
    await accountEvents.record({
      businessId: user.business_id, actorUserId: user.id, actorKind: 'owner', type: 'join_opened',
      data: { activation_id: row.id, user_id: user.id },
    });
    const shop = shopName || (user.business && user.business.name) || '';
    await alerts.notifyShift({
      reason: 'join_opened',
      businessId: user.business_id,
      shopName: shop,
      summary: `${firstName(user.name) || 'صاحب المحل'} فتح رابط ${shop || 'الانضمام'}`,
    });
  } catch (err) {
    console.error(`[auth/activate] join_opened not recorded: ${err.message}`);
  }
}

// POST, with the token in the body, because a token in a URL path is written to the access
// log by morgan AND by Cloud Run's own request log — which would undo the whole point of
// storing only its hash. The link itself carries the token in the fragment, which browsers
// never transmit, so it reaches this endpoint only as a body field.
router.post('/activate/lookup', async (req, res) => {
  const row = await activation.lookup((req.body || {}).token);
  if (!row) return res.status(404).json({ error: 'الرابط غير صالح أو انتهت صلاحيته' });
  // The page leads with the shop's name, which is what the owner recognises; the email is kept
  // for the staff and manager invites that still sign in with one. Nothing here names a business
  // the link was not issued for, so a valid link still reveals only its own account.
  const { business_name, business_type } = await businessInfo(row.user);
  const business = await joinBusiness(row.user);
  // Not awaited: SHIFT's alert must not hold up the owner's first screen, and noteJoinOpened
  // never throws.
  noteJoinOpened(row, business_name);
  res.json({
    name: row.user.name,
    email: row.user.email,
    // Masked: the owner recognises their own number, a leaked link does not hand it out.
    phone_masked: maskPhone(row.user.phone),
    role: row.user.role || null,
    business_name,
    // /join (docs/panels/spec.md step 3): «أهلًا أبو خالد», the sector's starter cards, and
    // whether the connect step is already done (a number SHIFT wired by hand).
    shop_name: business_name,
    owner_first_name: firstName(row.user.name),
    sector: business ? business.sector ?? null : null,
    // /join's teach step picks menu, services or facts by this; a shop made before sectors
    // existed has a business_type and no sector.
    business_type: business_type || null,
    connected: Boolean(business && business.wa_phone_number_id),
    expires_at: row.expires_at,
  });
});

router.post('/activate', async (req, res) => {
  const { token, password } = req.body || {};
  // 10 is the floor a customer picks for themselves; the token is what carries the entropy.
  if (!password || String(password).length < 10) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 10 أحرف على الأقل' });
  }

  try {
    const user = await activation.consume(token, String(password), bcrypt);
    if (!user) return res.status(404).json({ error: 'الرابط غير صالح أو انتهت صلاحيته' });

    // Signed straight in: a customer who has just chosen a password should not be asked for it.
    // The user carries everything login returns: without role and business_type the first
    // session rendered the wrong nav (no menu for a restaurant, owner links for staff) until a
    // reload fetched /me.
    const jwtToken = signToken(user.id);
    const { business_type, business_name } = await businessInfo(user);
    // The board's «يربط واتساب» starts here, and the shop's «السجل» shows when the owner got in.
    if (user.business_id) {
      await accountEvents.record({
        businessId: user.business_id, actorUserId: user.id,
        actorKind: user.role === 'business_owner' ? 'owner' : 'staff',
        type: 'password_set', data: { user_id: user.id, role: user.role || null },
      });
    }
    res.json({
      token: jwtToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone ?? null,
        role: user.role,
        business_id: user.business_id,
        business_type,
        business_name,
      },
    });
  } catch (err) {
    // The race guard in consume() throws when two tabs redeem the same link at once.
    if (String(err.message).includes('already used')) {
      return res.status(404).json({ error: 'الرابط غير صالح أو انتهت صلاحيته' });
    }
    console.error('[auth/activate] failed:', err.message);
    res.status(500).json({ error: 'تعذّر تفعيل الحساب' });
  }
});

module.exports = router;
