'use strict';

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const activation = require('../services/activation');
const accountEvents = require('../services/accountEvents');
const platformSettings = require('../services/platformSettings');
const { errorAr } = require('../services/embeddedSignup');
const { slugFromName, nextSlug } = require('./businesses');
const { firstName } = require('../utils/names');
const {
  normalizeEmail, normalizeLoginPhone, LOGIN_TAKEN_ERROR,
} = require('../utils/login');

/**
 * «زبون جديد» and «الانضمام» (docs/panels/spec.md P2; operator panel).
 *
 *   POST   /api/admin/accounts                 create a shop, its owner and a 7-day join link
 *   POST   /api/admin/accounts/:id/join-link   a new link (refused once the owner signed in)
 *   DELETE /api/admin/accounts/:id/invite      cancel the link and keep the unused owner inactive
 *   POST   /api/admin/accounts/:id/events      {type:'invite_shared'}: the operator sent it
 *   GET    /api/admin/accounts/:id/es-attempts one shop's «محاولات الربط», however old
 *   POST   /api/admin/accounts/invites/unused-links  reissue and return every unused owner link
 *   GET    /api/admin/onboarding               the campaign board, the Meta attempts, orphans
 *
 * The October path is invite-only: SHIFT types the shop's name, its type and the owner's mobile,
 * and sends one link from its own WhatsApp (a wa.me link, so nothing is paid to Meta). The owner
 * does the rest on their phone. Nothing public creates a shop or a user.
 *
 * platform_admin only. Mounted in app.js before admin.js, route by route, so the rest of
 * /api/admin is not authenticated twice.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX = 120;
const CITY_MAX = 60;
const SLUG_ATTEMPTS = 5;

/**
 * The sectors the form offers, the workflow each runs (messageProcessor picks it by business_type;
 * only restaurants and clinics have their own), and the greeting the bot starts with. The owner
 * changes the greeting later; this only saves a new shop from answering with nothing.
 */
const SECTORS = Object.freeze({
  restaurant: { business_type: 'restaurant', greeting: (n) => `أهلًا وسهلًا في ${n}! كيف نقدر نخدمك اليوم؟ اسأل عن القائمة والأسعار أو اطلب مباشرة.` },
  clinic: { business_type: 'clinic', greeting: (n) => `أهلًا بك في ${n}. كيف نقدر نساعدك؟ اسأل عن الخدمات والمواعيد أو احجز موعدك.` },
  pharmacy: { business_type: 'generic', greeting: (n) => `أهلًا بك في ${n}. كيف نقدر نساعدك؟ اسأل عن توفر دواء أو منتج، أو عن الدوام والتوصيل.` },
  salon: { business_type: 'generic', greeting: (n) => `أهلًا بك في ${n}! اسأل عن الخدمات والأسعار أو احجز موعدك.` },
  clothing: { business_type: 'generic', greeting: (n) => `أهلًا بك في ${n}! اسأل عن الموديلات والمقاسات والأسعار والتوصيل.` },
  shop: { business_type: 'generic', greeting: (n) => `أهلًا بك في ${n}! كيف نقدر نساعدك اليوم؟` },
  other: { business_type: 'generic', greeting: (n) => `أهلًا بك في ${n}! كيف نقدر نساعدك اليوم؟` },
});

const ERRORS = {
  name: 'اكتب اسم المحل',
  sector: 'اختر نوع النشاط',
  ownerName: 'اكتب اسم صاحب المحل',
  ownerPhone: 'موبايل صاحب المحل غير صحيح — اكتبه هكذا: 07XXXXXXXX',
  email: 'البريد الإلكتروني غير صحيح',
  failed: 'تعذّر إنشاء الحساب، حاول مرة أخرى',
  notFound: 'لا يوجد حساب بهذا المعرّف',
  noOwner: 'لا يوجد دخول لصاحب هذا المحل',
  signedIn: 'صاحب المحل فعّل حسابه ويستخدمه — لا حاجة لرابط جديد. لإعادة ضبط دخوله: عطّل حسابه أولًا ثم أرسل دعوة جديدة.',
  signedInCancel: 'صاحب المحل فعّل حسابه — لا دعوة لإلغائها.',
  badEvent: 'نوع الحدث غير معروف',
};

// Events the operator's screen may write. Everything else on the log is written by the code that
// did the thing it records.
const OPERATOR_EVENTS = ['invite_shared'];

const guard = [authenticate, requireRole('platform_admin')];

function shiftEvent(req, businessId, type, data = {}) {
  return accountEvents.record({ businessId, actorUserId: req.user?.id || null, actorKind: 'shift', type, data });
}

function clean(v, max) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max).trim() : s;
}

/** «لمطعم الشام», «للنور» (ل + ال contracts), «لـ Sham Café». */
function forShop(name) {
  const n = String(name || '').trim();
  if (n.startsWith('ال')) return `ل${n.slice(1)}`;
  if (/^[ء-ي]/.test(n)) return `ل${n}`;
  return `لـ ${n}`;
}

// The panel's own origin: the link opens the /join page there. Not FRONTEND_URL, which is a CORS
// list and in development points at Vite.
function appOrigin() {
  return String(process.env.APP_ORIGIN || 'https://app.shifts-ai.com').trim().replace(/\/+$/, '');
}

async function inviteTtlDays() {
  try {
    const days = Number(await platformSettings.get('invite_ttl_days'));
    if (Number.isFinite(days)) return Math.min(Math.max(Math.round(days), 1), 30);
  } catch (err) {
    console.warn(`[admin/accounts] invite_ttl_days not read: ${err.message}`);
  }
  return 7;
}

/**
 * The link and the WhatsApp message the operator sends it in (spec step 2). The token is only in
 * the fragment, which browsers never send to a server, as on /activate.
 */
function invitePayload({ businessId, ownerName, ownerPhone, shopName, token, expiresAt, ttlDays }) {
  const joinUrl = `${appOrigin()}/join#${token}`;
  const greeting = firstName(ownerName) ? `مرحبًا ${firstName(ownerName)}` : 'مرحبًا';
  const text = `${greeting}، هذا رابط تفعيل كرم بوت ${forShop(shopName)}: ${joinUrl} — صالح ${ttlDays === 7 ? '7 أيام' : `${ttlDays} يوم`} ويستغرق نحو 10 دقائق. `
    + 'جهّز: الهاتف الذي فيه شريحة رقم المحل، وحساب فيسبوك، وبطاقة دفع لرسوم واتساب لدى Meta.';
  return {
    account_id: businessId,
    join_url: joinUrl,
    wa_share_url: ownerPhone ? `https://wa.me/${ownerPhone}?text=${encodeURIComponent(text)}` : null,
    share_text: text,
    invite_expires_at: expiresAt,
  };
}

// Which unique column a P2002 names (Prisma's meta.target, or the message on older drivers).
function takenField(err) {
  if (!err || err.code !== 'P2002') return null;
  const target = err.meta && err.meta.target;
  const text = `${Array.isArray(target) ? target.join(',') : (target || '')} ${err.message || ''}`;
  for (const f of ['slug', 'phone', 'email']) if (text.includes(f)) return f;
  return 'other';
}

async function phoneTakenMessage(phone) {
  const holder = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, business: { select: { name: true } } },
  });
  if (!holder) return null;
  return holder.business && holder.business.name
    ? `هذا الموبايل مسجّل لحساب ${holder.business.name}`
    : LOGIN_TAKEN_ERROR.phone;
}

async function ownerOf(businessId) {
  return prisma.user.findFirst({
    where: { business_id: businessId, role: 'business_owner' },
    orderBy: { created_at: 'asc' },
    select: { id: true, name: true, phone: true, email: true, active: true, last_login: true },
  });
}

// Once the owner holds the account, a fresh link would let SHIFT set their password and sign in as
// them (the same rule as admin.js's re-invite). Recovery is deliberate: deactivate, then invite.
const ownerSignedIn = (owner) => Boolean(owner && owner.active && owner.last_login);

/**
 * «محاولات الربط» rows from es_* AccountEvents, in Arabic: when, who started it, the result, the
 * step, the error, and Meta's session id. Shared by the fleet board and one shop's own history.
 */
async function describeAttempts(attemptsRaw, nameOf = new Map()) {
  const missing = [...new Set(attemptsRaw.map((e) => e.business_id).filter((id) => id && !nameOf.has(id)))];
  if (missing.length) {
    for (const b of await prisma.business.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } })) nameOf.set(b.id, b.name);
  }
  const actorIds = [...new Set(attemptsRaw.filter((e) => e.actor_kind === 'shift' && e.actor_user_id).map((e) => e.actor_user_id))];
  const actorName = new Map(actorIds.length
    ? (await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])
    : []);
  const startedBy = (e) => {
    if (e.actor_kind === 'owner') return 'الزبون';
    if (e.actor_kind === 'shift') return actorName.get(e.actor_user_id) ? `شِفت: ${firstName(actorName.get(e.actor_user_id))}` : 'شِفت';
    if (e.actor_kind === 'meta') return 'Meta';
    return 'النظام';
  };
  return attemptsRaw.map((e) => ({
    at: e.created_at,
    account_id: e.business_id,
    name: nameOf.get(e.business_id) || null,
    started_by_ar: startedBy(e),
    ...resultOf(e),
    step_ar: stepOf(e),
    error_ar: errorOf(e),
    // Meta's session id: what Meta support asks for. Shown to SHIFT only, never to the shop.
    session_id: (e.data && e.data.session_id) || null,
  }));
}

// ─── «زبون جديد» ────────────────────────────────────────────────────────────

const accountsRouter = express.Router();

accountsRouter.post('/', guard, async (req, res) => {
  const body = req.body || {};
  const name = clean(body.name, NAME_MAX);
  const sector = String(body.sector || '').trim();
  const ownerName = clean(body.owner_name, NAME_MAX);
  const phone = normalizeLoginPhone(body.owner_phone);
  const email = normalizeEmail(body.owner_email);
  const city = clean(body.city, CITY_MAX) || null;

  if (!name) return res.status(400).json({ error: ERRORS.name });
  if (!Object.prototype.hasOwnProperty.call(SECTORS, sector)) return res.status(400).json({ error: ERRORS.sector });
  if (!ownerName) return res.status(400).json({ error: ERRORS.ownerName });
  if (!phone) return res.status(400).json({ error: ERRORS.ownerPhone });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: ERRORS.email });

  try {
    // Checked first so the answer names the shop that already has this owner; the unique
    // indexes are still the guard against a race (the P2002 branch below).
    const phoneTaken = await phoneTakenMessage(phone);
    if (phoneTaken) return res.status(409).json({ error: phoneTaken });
    if (email && await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      return res.status(409).json({ error: LOGIN_TAKEN_ERROR.email });
    }

    const ttlDays = await inviteTtlDays();
    const spec = SECTORS[sector];
    // The schema needs a password; this one nobody knows and nobody can use. The account opens
    // only when the owner chooses their own on /join.
    const unusable = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    const base = slugFromName(name);

    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
      try {
        // One transaction: a shop with no owner, or an owner with no link, cannot be left behind.
        // No Subscription: the free month is made at connect, so an unused invite never takes
        // one of the October offer's places (shiftSweeper.offerPlacesLeft counts contracts).
        const created = await prisma.$transaction(async (tx) => {
          const business = await tx.business.create({
            data: {
              name,
              slug: nextSlug(base, attempt),
              business_type: spec.business_type,
              sector,
              city,
              owner_phone: phone,
              source: 'invite',
              wa_phone_number_id: null,
              ai_config: { greeting_message: spec.greeting(name), alert_wa_numbers: [phone] },
            },
            select: { id: true, name: true },
          });
          const owner = await tx.user.create({
            data: {
              name: ownerName,
              email,
              phone,
              password: unusable,
              role: 'business_owner',
              business_id: business.id,
              active: false,
            },
            select: { id: true, name: true },
          });
          const link = await activation.issue(owner.id, req.user.id, { ttlHours: ttlDays * 24, client: tx });
          await tx.accountEvent.create({
            data: accountEvents.toRow({
              businessId: business.id, actorUserId: req.user.id, actorKind: 'shift', type: 'business_created',
              data: { business_type: spec.business_type, sector, source: 'invite' },
            }),
          });
          await tx.accountEvent.create({
            data: accountEvents.toRow({
              businessId: business.id, actorUserId: req.user.id, actorKind: 'shift', type: 'invite_created',
              data: { user_id: owner.id, role: 'business_owner', expires_at: link.expires_at },
            }),
          });
          return { business, owner, link };
        });

        return res.status(201).json(invitePayload({
          businessId: created.business.id,
          ownerName: created.owner.name,
          ownerPhone: phone,
          shopName: created.business.name,
          token: created.link.token,
          expiresAt: created.link.expires_at,
          ttlDays,
        }));
      } catch (err) {
        const field = takenField(err);
        if (field === 'slug') continue; // someone has it: the next candidate, in a new transaction
        if (field === 'phone') return res.status(409).json({ error: (await phoneTakenMessage(phone)) || LOGIN_TAKEN_ERROR.phone });
        if (field === 'email') return res.status(409).json({ error: LOGIN_TAKEN_ERROR.email });
        throw err;
      }
    }
    console.error(`[admin/accounts] create failed: no free slug after ${SLUG_ATTEMPTS} attempts from "${base}"`);
    return res.status(409).json({ error: ERRORS.failed });
  } catch (err) {
    // Never err.message: Prisma's English, with column names in it.
    console.error(`[admin/accounts] create failed: ${err.code || ''} ${err.message}`);
    return res.status(500).json({ error: ERRORS.failed });
  }
});

/**
 * «انسخ روابط الدعوات غير المستخدمة» on «الزبائن» (docs/panels/spec.md, the campaign action): one
 * fresh link for every owner who never signed in and still holds an unused, unexpired invite, so
 * the operator can paste them into their own WhatsApp in one go instead of shop by shop.
 *
 * The links are stored hashed, so the outstanding ones cannot be read back: each is reissued (the
 * old one stops working, as with «رابط جديد»), logged as invite_created with bulk: true, and
 * returned once. Customer shops only; an owner who signed in is never given a link (ownerSignedIn).
 * `account_ids` narrows it to the shops shown. Declared before '/:id/…' so «invites» is no id.
 */
const BULK_LINKS_MAX = 50;
accountsRouter.post('/invites/unused-links', guard, async (req, res) => {
  const only = Array.isArray(req.body?.account_ids) ? req.body.account_ids.map(String).slice(0, 500) : null;
  try {
    const now = new Date();
    const live = await prisma.userActivation.findMany({
      where: { used_at: null, expires_at: { gt: now } },
      select: { user_id: true },
    });
    const userIds = [...new Set(live.map((a) => a.user_id))];
    const owners = userIds.length ? await prisma.user.findMany({
      where: { id: { in: userIds }, role: 'business_owner', last_login: null },
      select: { id: true, name: true, phone: true, business_id: true, active: true, last_login: true },
    }) : [];
    const wanted = owners.filter((o) => o.business_id && !ownerSignedIn(o) && (!only || only.includes(o.business_id)));
    const shops = wanted.length ? await prisma.business.findMany({
      where: {
        id: { in: [...new Set(wanted.map((o) => o.business_id))] },
        is_internal: false, business_type: { not: 'shift' }, status: { not: 'closed' },
      },
      select: { id: true, name: true, owner_phone: true },
    }) : [];
    const shopOf = new Map(shops.map((b) => [b.id, b]));

    const ttlDays = await inviteTtlDays();
    const links = [];
    for (const owner of wanted) {
      const shop = shopOf.get(owner.business_id);
      // The first owner per shop only (a shop's later owners have their own team invite).
      if (!shop || links.some((l) => l.account_id === shop.id) || links.length >= BULK_LINKS_MAX) continue;
      const link = await activation.issue(owner.id, req.user.id, { ttlHours: ttlDays * 24 });
      await shiftEvent(req, shop.id, 'invite_created', {
        user_id: owner.id, role: 'business_owner', reissued: true, bulk: true, expires_at: link.expires_at,
      });
      links.push({
        name: shop.name,
        ...invitePayload({
          businessId: shop.id, ownerName: owner.name, ownerPhone: owner.phone || shop.owner_phone || null,
          shopName: shop.name, token: link.token, expiresAt: link.expires_at, ttlDays,
        }),
      });
    }
    return res.json({ links });
  } catch (err) {
    console.error(`[admin/accounts/unused-links] failed: ${err.message}`);
    return res.status(500).json({ error: 'تعذّر تجهيز روابط الدعوات' });
  }
});

/** A new join link for an owner who has not signed in yet: the old one stops working. */
accountsRouter.post('/:id/join-link', guard, async (req, res) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.params.id }, select: { id: true, name: true, owner_phone: true },
    });
    if (!business) return res.status(404).json({ error: ERRORS.notFound });
    const owner = await ownerOf(business.id);
    if (!owner) return res.status(404).json({ error: ERRORS.noOwner });
    if (ownerSignedIn(owner)) return res.status(409).json({ error: ERRORS.signedIn });

    const ttlDays = await inviteTtlDays();
    const link = await activation.issue(owner.id, req.user.id, { ttlHours: ttlDays * 24 });
    // Who and until when, never the link: the token in it is a password.
    await shiftEvent(req, business.id, 'invite_created', {
      user_id: owner.id, role: 'business_owner', reissued: true, expires_at: link.expires_at,
    });
    return res.json(invitePayload({
      businessId: business.id,
      ownerName: owner.name,
      ownerPhone: owner.phone || business.owner_phone || null,
      shopName: business.name,
      token: link.token,
      expiresAt: link.expires_at,
      ttlDays,
    }));
  } catch (err) {
    console.error(`[admin/accounts/join-link] failed: ${err.message}`);
    return res.status(500).json({ error: 'تعذّر إنشاء رابط جديد' });
  }
});

/** «ألغِ الدعوة»: the link dies and the owner who never used it stays unable to sign in. */
accountsRouter.delete('/:id/invite', guard, async (req, res) => {
  try {
    const business = await prisma.business.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!business) return res.status(404).json({ error: ERRORS.notFound });
    const owner = await ownerOf(business.id);
    if (!owner) return res.status(404).json({ error: ERRORS.noOwner });
    if (ownerSignedIn(owner)) return res.status(409).json({ error: ERRORS.signedInCancel });

    const revoked = await prisma.$transaction(async (tx) => {
      const count = await activation.revoke(owner.id, tx);
      await tx.user.update({ where: { id: owner.id }, data: { active: false } });
      await tx.accountEvent.create({
        data: accountEvents.toRow({
          businessId: business.id, actorUserId: req.user.id, actorKind: 'shift', type: 'invite_cancelled',
          data: { user_id: owner.id, revoked: count },
        }),
      });
      return count;
    });
    return res.json({ ok: true, revoked });
  } catch (err) {
    console.error(`[admin/accounts/invite] cancel failed: ${err.message}`);
    return res.status(500).json({ error: 'تعذّر إلغاء الدعوة' });
  }
});

/**
 * One shop's «محاولات الربط» for its WhatsApp tab: every es_* event it has, with no 30-day window
 * and no fleet-wide cap, so an old connection can still be traced when SHIFT investigates it.
 */
const SHOP_ATTEMPTS_LIMIT = 200;
accountsRouter.get('/:id/es-attempts', guard, async (req, res) => {
  try {
    const shop = await prisma.business.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
    if (!shop) return res.status(404).json({ error: 'لا يوجد حساب بهذا المعرّف' });
    const rows = await prisma.accountEvent.findMany({
      where: { business_id: shop.id, type: { in: ES_TYPES } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: SHOP_ATTEMPTS_LIMIT,
    });
    res.json({ attempts: await describeAttempts(rows, new Map([[shop.id, shop.name]])) });
  } catch (err) {
    console.error(`[admin/accounts/es-attempts] failed: ${err.message}`);
    res.status(500).json({ error: 'تعذّر تحميل محاولات الربط' });
  }
});

/** «أرسل على واتساب» pressed: moves the board card to «أُرسل الرابط». No message is sent from here. */
accountsRouter.post('/:id/events', guard, async (req, res) => {
  const type = String(req.body?.type || '').trim();
  if (!OPERATOR_EVENTS.includes(type)) return res.status(400).json({ error: ERRORS.badEvent });
  try {
    const business = await prisma.business.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!business) return res.status(404).json({ error: ERRORS.notFound });
    const row = await shiftEvent(req, business.id, type, {});
    if (!row) return res.status(500).json({ error: 'تعذّر الحفظ' });
    return res.status(201).json({ ok: true, type, at: row.created_at });
  } catch (err) {
    console.error(`[admin/accounts/events] failed: ${err.message}`);
    return res.status(500).json({ error: 'تعذّر الحفظ' });
  }
});

// ─── «الانضمام» ─────────────────────────────────────────────────────────────

const STAGES = Object.freeze([
  { stage: 'invite_sent', label_ar: 'أُرسل الرابط' },
  { stage: 'connecting', label_ar: 'يربط واتساب' },
  { stage: 'awaiting_card', label_ar: 'بانتظار البطاقة' },
  { stage: 'teaching', label_ar: 'يعلّم البوت' },
  { stage: 'awaiting_first_customer', label_ar: 'بانتظار أول زبون' },
  { stage: 'live', label_ar: 'يعمل' },
]);
const STUCK_MS = DAY_MS;
const ATTEMPTS_LOOKBACK_MS = 30 * DAY_MS;
const ATTEMPTS_LIMIT = 100;
const EVENT_SCAN_LIMIT = 3000;
const ES_TYPES = ['es_started', 'es_cancelled', 'es_failed', 'es_conflict', 'es_ownership_mismatch', 'es_connected', 'wrong_number'];
const BOARD_TYPES = [
  'invite_created', 'invite_shared', 'join_opened', 'password_set', 'invite_expired', 'invite_cancelled',
  'payment_claimed', 'payment_confirmed', ...ES_TYPES,
];

// Meta's popup step names, in Arabic (shared with the overview's es_cancelled rule).
const { metaStepLabel } = require('../config/eventLabels');

// Our own steps after Meta's window closed (services/embeddedSignup.js, es_failed data.stage).
const SERVER_STAGE_AR = {
  exchange: 'استلام الموافقة',
  verify: 'التحقق من الحساب',
  onboarding: 'حفظ الربط',
  number: 'تحديد الرقم',
  subscribe: 'ربط الرقم بكرم بوت',
  register: 'تسجيل الرقم',
  link: 'إكمال الربط',
};

const REASON_AR = {
  waba_unresolved: 'لم نعرف أي حساب واتساب للأعمال يقصد — يلزم ربط جديد بحساب واحد',
  coexistence: 'الرقم على تطبيق واتساب للأعمال — لم نسجّله',
  not_linked: 'لم يكتمل تسجيل الرقم',
};

function stepOf(e) {
  const d = e.data || {};
  if (d.current_step) return metaStepLabel(d.current_step);
  if (d.stage) return SERVER_STAGE_AR[d.stage] || 'إحدى خطوات الربط';
  return null;
}

/** An attempt's outcome: a code for the panel's filters and its Arabic. */
function resultOf(e) {
  const d = e.data || {};
  switch (e.type) {
    case 'es_started': return { result: 'started', result_ar: 'بدأ' };
    case 'es_connected': return { result: 'connected', result_ar: 'اكتمل' };
    case 'es_cancelled': return { result: 'cancelled', result_ar: 'أُلغي' };
    case 'es_conflict': return { result: 'conflict', result_ar: 'تعارض رقم' };
    case 'wrong_number': return { result: 'needs_operator', result_ar: 'بحاجة لشِفت' };
    case 'es_ownership_mismatch':
      return d.blocking === false ? { result: 'needs_operator', result_ar: 'بحاجة لشِفت' } : { result: 'failed', result_ar: 'خطأ' };
    case 'es_failed':
      return ['needs_operator', 'needs_number'].includes(d.status)
        ? { result: 'needs_operator', result_ar: 'بحاجة لشِفت' }
        : { result: 'failed', result_ar: 'خطأ' };
    default: return { result: 'other', result_ar: 'حدث' };
  }
}

function errorOf(e) {
  const d = e.data || {};
  if (e.type === 'es_conflict') return 'هذا الرقم مربوط بحساب آخر لدى شِفت';
  if (e.type === 'wrong_number') return 'قال الزبون إن هذا ليس رقم محله';
  if (e.type === 'es_ownership_mismatch') {
    return d.detail === 'portfolio_differs'
      ? 'حساب Meta الذي ربط منه يختلف عمّا أرسله المتصفح'
      : 'هذا الرقم لا يتبع الحساب الذي دخل به في فيسبوك';
  }
  if (e.type !== 'es_failed') return null;
  // Meta's own words from the popup, already in the owner's language (the SDK loads ar_AR).
  if (d.source === 'browser' && d.error_message) return `أبلغت Meta عن خطأ: ${d.error_message}`;
  if (d.reason && REASON_AR[d.reason]) return REASON_AR[d.reason];
  if (d.status === 'needs_number') return 'حساب واتساب للأعمال بلا رقم';
  if (d.status === 'needs_operator') return 'على الحساب أكثر من رقم — اختر الرقم من «ربط بدون حساب»';
  return errorAr({ code: d.error_code, step: d.stage }).text;
}

/** The board card's last Meta step, when the newest attempt stopped short. */
function lastEsStep(events) {
  const latest = events.find((e) => ES_TYPES.includes(e.type) && e.type !== 'es_started');
  if (!latest || latest.type === 'es_connected') return null;
  const step = stepOf(latest);
  if (latest.type === 'es_cancelled') return `توقف عند: ${step || 'إحدى خطوات Meta'}`;
  if (latest.type === 'es_failed') return step ? `فشل عند: ${step}` : (errorOf(latest) || 'فشل الربط');
  return errorOf(latest);
}

const maxDate = (...ds) => {
  const t = ds.filter(Boolean).map((d) => new Date(d).getTime()).filter(Number.isFinite);
  return t.length ? new Date(Math.max(...t)) : null;
};
const minDate = (ds) => {
  const t = ds.filter(Boolean).map((d) => new Date(d).getTime()).filter(Number.isFinite);
  return t.length ? new Date(Math.min(...t)) : null;
};

/**
 * Where one shop is, derived from what is stored (never stored itself, like the account checklist).
 * Forward progress wins: a shop SHIFT wired by hand is past «أُرسل الرابط» whether or not its owner
 * ever signed in.
 */
function deriveCard({
  business, owner, invite, onboarding, knowledge, events, now, ownerConnect,
}) {
  const latest = (type) => events.find((e) => e.type === type) || null;
  const earliest = (type) => [...events].reverse().find((e) => e.type === type) || null;
  const connected = Boolean(business.wa_phone_number_id) && !(onboarding && onboarding.revoked_at);
  const paymentDone = Boolean(onboarding && (onboarding.payment_method_ok || onboarding.payment_method_claimed_at));
  const signedIn = Boolean(owner && owner.last_login) || Boolean(latest('password_set'));
  const opened = Boolean(latest('join_opened'));
  const connectedAt = business.connected_at || (onboarding && onboarding.registered_at) || null;
  const paidAt = onboarding ? maxDate(onboarding.payment_method_claimed_at, onboarding.payment_method_marked_at) : null;
  const firstKnowledge = minDate(knowledge.map((k) => k.created_at));
  const lastEs = lastEsStep(events);
  const wrongNumber = events.find((e) => e.type === 'wrong_number' && !e.resolved_at);
  const needsOperator = Boolean(onboarding && onboarding.needs_operator) || Boolean(wrongNumber)
    || ['es_conflict'].includes((events.find((e) => ES_TYPES.includes(e.type) && e.type !== 'es_started') || {}).type);

  let stage;
  let since;
  let reason = null;
  if (business.went_live_at) {
    stage = 'live';
    since = business.went_live_at;
  } else if (connected) {
    if (!paymentDone) {
      stage = 'awaiting_card';
      since = connectedAt || business.created_at;
      reason = 'لم يضف بطاقة الدفع لدى Meta';
    } else if (!knowledge.length) {
      stage = 'teaching';
      since = maxDate(connectedAt, paidAt) || business.created_at;
      reason = 'لم يضف معلومات للبوت بعد';
    } else {
      stage = 'awaiting_first_customer';
      since = maxDate(connectedAt, paidAt, firstKnowledge) || business.created_at;
      reason = 'لم يرد البوت على أي زبون بعد';
    }
  } else if (signedIn) {
    stage = 'connecting';
    since = (earliest('password_set') || {}).created_at || (owner && owner.last_login) || business.created_at;
    if (onboarding && onboarding.revoked_at) reason = 'انفصل كرم بوت عن حسابه في Meta';
    else if (lastEs) reason = lastEs;
    else if (onboarding && onboarding.needs_operator) reason = 'وصلتنا موافقته ولم نحدد الرقم — أكمل الربط';
    else reason = ownerConnect ? 'لم يضغط «اربط واتساب» بعد' : 'بانتظار ربط واتساب مع شِفت';
  } else {
    stage = 'invite_sent';
    const sent = latest('invite_shared') || latest('invite_created');
    since = (sent && sent.created_at) || business.created_at;
    if (!owner) reason = 'لا يوجد دخول لصاحب المحل';
    else if (!invite) reason = latest('invite_cancelled') ? 'أُلغيت الدعوة' : 'لا يوجد رابط صالح — أعد إرسال الرابط';
    else if (new Date(invite.expires_at).getTime() < now.getTime()) reason = 'انتهت صلاحية الرابط — أعد إرساله';
    else if (opened) reason = 'فتح الرابط ولم يختر كلمة المرور';
    else if (!latest('invite_shared')) reason = 'الرابط جاهز ولم يُرسل بعد';
    else reason = 'لم يفتح الرابط بعد';
  }

  const sinceDate = since ? new Date(since) : null;
  return {
    stage,
    card: {
      account_id: business.id,
      name: business.name,
      owner_first_name: firstName(owner && owner.name),
      // «راسله» on the board opens wa.me to this; SHIFT is the only reader of this route.
      owner_phone: business.owner_phone || null,
      since: sinceDate,
      stuck: stage !== 'live' && Boolean(sinceDate) && now.getTime() - sinceDate.getTime() > STUCK_MS,
      reason_ar: reason,
      needs_operator: needsOperator,
      last_es_step_ar: connected ? null : lastEs,
      // The «فتحه» sub-badge on «أُرسل الرابط», and what «أعد إرسال الرابط» needs to know.
      opened,
      invite_expires_at: invite ? invite.expires_at : null,
      payment_claimed: Boolean(onboarding && onboarding.payment_method_claimed_at && !onboarding.payment_method_ok),
    },
  };
}

// The knowledge each kind of shop actually uses (the same choice as whatsappStatus.js): a menu, a
// service list, or the facts its owner typed. A model the client lacks answers nothing.
async function knowledgeRows(model, ids, where = {}) {
  if (!ids.length || !prisma[model] || typeof prisma[model].findMany !== 'function') return [];
  try {
    return await prisma[model].findMany({
      where: { business_id: { in: ids }, ...where },
      select: { business_id: true, created_at: true },
    });
  } catch (err) {
    console.warn(`[admin/onboarding] ${model} not read: ${err.message}`);
    return [];
  }
}

async function orphansCount() {
  const [unattached, numberless, unmatched] = await Promise.all([
    prisma.whatsappOnboarding.count({ where: { business_id: null, detached_at: null } }),
    prisma.whatsappOnboarding.count({ where: { business_id: { not: null }, phone_number_id: null } }),
    prisma.accountEvent.count({ where: { business_id: null, type: 'partner_added_unmatched', resolved_at: null } }),
  ]);
  return unattached + numberless + unmatched;
}

const groupBy = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};

// The onboarding columns the stage reads.
const ONBOARDING_STAGE_SELECT = {
  business_id: true, step: true, needs_operator: true, payment_method_ok: true,
  payment_method_claimed_at: true, payment_method_marked_at: true, revoked_at: true, registered_at: true,
};

/**
 * What deriveCard needs for many shops at once, one query per signal (never per shop): the
 * owners, their newest unused links, the board's events, the knowledge each kind of shop uses,
 * and whether the owner's connect button is open. Shared by the board and the operator overview's
 * «مسار الانضمام», so a shop is in the same stage on both screens.
 *
 * `extraTypes` adds event types the caller needs from the same read (the overview's rules).
 */
async function loadStageInputs(businesses, { extraTypes = [] } = {}) {
  const ids = businesses.map((b) => b.id);
  const idsOf = (pred) => businesses.filter(pred).map((b) => b.id);
  const types = [...new Set([...BOARD_TYPES, ...extraTypes])];
  const [owners, events, facts, menu, services, ownerConnect] = await Promise.all([
    ids.length ? prisma.user.findMany({
      where: { business_id: { in: ids }, role: 'business_owner' },
      select: { id: true, name: true, phone: true, business_id: true, active: true, last_login: true, created_at: true },
      orderBy: { created_at: 'asc' },
    }) : [],
    ids.length ? prisma.accountEvent.findMany({
      where: { business_id: { in: ids }, type: { in: types } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: EVENT_SCAN_LIMIT,
    }) : [],
    knowledgeRows('businessKnowledge', idsOf((b) => !['restaurant', 'clinic'].includes(b.business_type)), { active: true }),
    knowledgeRows('menuItem', idsOf((b) => b.business_type === 'restaurant')),
    knowledgeRows('service', idsOf((b) => b.business_type === 'clinic')),
    platformSettings.get('es_owner_enabled').then(platformSettings.isOn).catch(() => false),
  ]);

  const ownerOf = new Map();
  for (const o of owners) if (!ownerOf.has(o.business_id)) ownerOf.set(o.business_id, o);
  const ownerIds = [...ownerOf.values()].map((o) => o.id);
  // The owner's newest unused link, expired or not: an expired one is the card's reason.
  const invites = ownerIds.length ? await prisma.userActivation.findMany({
    where: { user_id: { in: ownerIds }, used_at: null },
    select: { user_id: true, expires_at: true, created_at: true },
    orderBy: { created_at: 'desc' },
  }) : [];
  const inviteOfUser = new Map();
  for (const i of invites) if (!inviteOfUser.has(i.user_id)) inviteOfUser.set(i.user_id, i);
  const inviteOf = new Map();
  for (const [businessId, o] of ownerOf) if (inviteOfUser.has(o.id)) inviteOf.set(businessId, inviteOfUser.get(o.id));
  return {
    ownerOf,
    inviteOf,
    eventsOf: groupBy(events, 'business_id'),
    knowledgeOf: groupBy([...facts, ...menu, ...services], 'business_id'),
    ownerConnect,
  };
}

/** One shop's board stage and card, from loadStageInputs. */
function stageOf(business, onboarding, inputs, now = new Date()) {
  const owner = inputs.ownerOf.get(business.id) || null;
  return deriveCard({
    business,
    owner,
    invite: owner ? inputs.inviteOf.get(business.id) || null : null,
    onboarding: onboarding || null,
    knowledge: inputs.knowledgeOf.get(business.id) || [],
    events: inputs.eventsOf.get(business.id) || [],
    now,
    ownerConnect: inputs.ownerConnect,
  });
}

const boardRouter = express.Router();

boardRouter.get('/', guard, async (req, res) => {
  try {
    const now = new Date();
    // SHIFT's own row and the -sim rows are not customers; a closed shop has left the campaign.
    const businesses = await prisma.business.findMany({
      where: { is_internal: false, business_type: { not: 'shift' }, status: { not: 'closed' } },
      select: {
        id: true, name: true, business_type: true, created_at: true, wa_phone_number_id: true,
        connected_at: true, went_live_at: true, owner_phone: true,
      },
      orderBy: { created_at: 'asc' },
    });
    const onboardings = businesses.length ? await prisma.whatsappOnboarding.findMany({
      where: { business_id: { in: businesses.map((b) => b.id) } },
      select: ONBOARDING_STAGE_SELECT,
    }) : [];
    const onboardingOf = new Map(onboardings.map((o) => [o.business_id, o]));
    const inputs = await loadStageInputs(businesses);

    const columns = STAGES.map((s) => ({ ...s, cards: [] }));
    const columnOf = new Map(columns.map((c) => [c.stage, c]));
    for (const business of businesses) {
      const { stage, card } = stageOf(business, onboardingOf.get(business.id) || null, inputs, now);
      columnOf.get(stage).cards.push(card);
    }
    // Longest in its stage first: that is the one to call.
    for (const c of columns) c.cards.sort((a, b) => (a.since ? a.since.getTime() : 0) - (b.since ? b.since.getTime() : 0));

    // «محاولات الربط مع Meta»: every ES event of the last 30 days, any shop.
    const attemptsRaw = await prisma.accountEvent.findMany({
      where: { type: { in: ES_TYPES }, created_at: { gte: new Date(now.getTime() - ATTEMPTS_LOOKBACK_MS) } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: ATTEMPTS_LIMIT,
    });
    const attempts = await describeAttempts(attemptsRaw, new Map(businesses.map((b) => [b.id, b.name])));

    res.json({ columns, attempts, orphans_count: await orphansCount() });
  } catch (err) {
    console.error(`[admin/onboarding] failed: ${err.message}`);
    res.status(500).json({ error: 'تعذّر تحميل لوحة الانضمام' });
  }
});

module.exports = {
  accountsRouter, boardRouter, SECTORS, STAGES, deriveCard, invitePayload, firstName, forShop, metaStepLabel,
  loadStageInputs, stageOf, ONBOARDING_STAGE_SELECT, ES_TYPES, BOARD_TYPES, ownerOf, appOrigin, inviteTtlDays,
};
