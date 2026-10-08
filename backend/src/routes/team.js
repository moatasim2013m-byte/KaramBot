const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { authenticate, attachBusinessId, requireRole } = require('../middleware/auth');
const activation = require('../services/activation');
const accountEvents = require('../services/accountEvents');
const platformSettings = require('../services/platformSettings');
const { normalizeLoginPhone, loginTaken, LOGIN_TAKEN_ERROR } = require('../utils/login');
const { firstName } = require('../utils/names');
const { contractOf, seatsOf, seatsUsed } = require('./account');

/**
 * «الفريق» (docs/panels/spec.md, P3): the shop's people, invited by link.
 *
 * Before this, the owner added staff through POST /api/auth/register by typing someone else's
 * password, and every new member came out 'staff' whatever was chosen («مدير» was a label). Now
 * the owner names a mobile and a role, and gets a /activate link to send on WhatsApp: the member
 * sets their own password, and a manager really is a manager.
 *
 * Owner manages, manager views (the same page without the buttons), staff never see it. Every
 * query is pinned to req.businessId from attachBusinessId; nothing in a body or query names a shop.
 * The owner row cannot be changed here and nobody can change themselves: losing the only owner of a
 * shop from its own panel would need SHIFT to recover it.
 */

const TEAM_ROLES = ['manager', 'staff'];
const NAME_MAX = 80;

const ERRORS = {
  name: 'اكتب اسم العضو',
  phone: 'رقم الموبايل غير صحيح — اكتبه هكذا: 07XXXXXXXX',
  role: 'اختر الدور: مدير أو موظف',
  seatsFull: 'وصلت لعدد المستخدمين في باقتك — تواصل مع شِفت',
  notFound: 'لا يوجد عضو بهذا المعرّف في فريقك',
  self: 'لا يمكنك تغيير حسابك أنت من هنا',
  owner: 'لا يمكن تغيير حساب صاحب المحل من هنا — تواصل مع شِفت',
  nothing: 'لا يوجد ما يُحفظ',
  notActivated: 'هذا العضو لم يفعّل حسابه بعد — أرسل له رابطًا جديدًا',
  signedIn: 'هذا العضو فعّل حسابه ويستخدمه — لا حاجة لرابط جديد',
  failed: 'تعذّر الحفظ، حاول مرة أخرى',
};

// The panel's own origin: the link opens /activate there (the same rule as the /join links).
function appOrigin() {
  return String(process.env.APP_ORIGIN || 'https://app.shifts-ai.com').trim().replace(/\/+$/, '');
}

async function inviteTtlDays() {
  try {
    const days = Number(await platformSettings.get('invite_ttl_days'));
    if (Number.isFinite(days)) return Math.min(Math.max(Math.round(days), 1), 30);
  } catch (err) {
    console.warn(`[team] invite_ttl_days not read: ${err.message}`);
  }
  return 7;
}

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max).trim();
const actorKind = (req) => (req.user.role === 'platform_admin' ? 'shift' : req.user.role === 'business_owner' ? 'owner' : 'staff');

/**
 * The link and the WhatsApp message the owner sends it in. The token sits only in the fragment,
 * which browsers never send to a server. wa.me costs nothing: it is the owner's own WhatsApp.
 */
async function invitePayload({ member, shopName, token, expiresAt, ttlDays }) {
  const joinUrl = `${appOrigin()}/activate#${token}`;
  const greeting = firstName(member.name) ? `مرحبًا ${firstName(member.name)}` : 'مرحبًا';
  const role = member.role === 'manager' ? 'مديرًا' : 'موظفًا';
  const text = `${greeting}، أضفتك ${role} في كرم بوت${shopName ? ` — ${shopName}` : ''}. افتح الرابط واختر كلمة المرور: ${joinUrl} — صالح ${ttlDays === 7 ? '7 أيام' : `${ttlDays} يوم`}.`;
  return {
    member_id: member.id,
    join_url: joinUrl,
    wa_share_url: member.phone ? `https://wa.me/${member.phone}?text=${encodeURIComponent(text)}` : null,
    share_text: text,
    invite_expires_at: expiresAt,
  };
}

const router = express.Router();
router.use(authenticate, attachBusinessId);

/**
 * active → «فعّال»; not active with an unused link → «بانتظار التفعيل» (an expired one too: the
 * owner's move is the same, send a new link); not active and no link → «معطّل».
 */
router.get('/', requireRole('platform_admin', 'business_owner', 'manager'), async (req, res) => {
  try {
    const [users, contract] = await Promise.all([
      prisma.user.findMany({
        where: { business_id: req.businessId, role: { not: 'platform_admin' } },
        orderBy: { created_at: 'asc' },
        select: { id: true, name: true, phone: true, email: true, role: true, active: true, last_login: true },
      }),
      contractOf(req.businessId),
    ]);
    const inactive = users.filter((u) => !u.active).map((u) => u.id);
    const links = inactive.length
      ? await prisma.userActivation.findMany({ where: { user_id: { in: inactive }, used_at: null }, select: { user_id: true } })
      : [];
    const pending = new Set(links.map((l) => l.user_id));
    const members = users.map((u) => ({
      id: u.id,
      name: u.name,
      phone: u.phone || null,
      email: u.email || null,
      role: u.role,
      status: u.active ? 'active' : pending.has(u.id) ? 'pending' : 'disabled',
      last_login: u.last_login || null,
    }));
    res.json({
      members,
      seats_used: members.filter((m) => m.status !== 'disabled').length,
      seats: seatsOf(contract),
    });
  } catch (err) {
    console.error(`[team] list failed business=${req.businessId}: ${err.message}`);
    res.status(500).json({ error: 'تعذّر تحميل الفريق' });
  }
});

router.post('/invite', requireRole('business_owner'), async (req, res) => {
  const name = clean(req.body?.name, NAME_MAX);
  const phone = normalizeLoginPhone(req.body?.phone);
  const role = String(req.body?.role || '');
  if (!name) return res.status(400).json({ error: ERRORS.name });
  if (!phone) return res.status(400).json({ error: ERRORS.phone });
  if (!TEAM_ROLES.includes(role)) return res.status(400).json({ error: ERRORS.role });

  try {
    const contract = await contractOf(req.businessId);
    // Checked before anything is written. Two invites pressed at the same instant could both pass;
    // for a three-seat shop SHIFT sees it on the account and it costs nothing, so no lock.
    if (await seatsUsed(req.businessId) >= seatsOf(contract)) {
      return res.status(409).json({ error: ERRORS.seatsFull });
    }
    const taken = await loginTaken({ phone });
    if (taken) return res.status(409).json({ error: LOGIN_TAKEN_ERROR[taken] });

    const business = await prisma.business.findUnique({ where: { id: req.businessId }, select: { name: true } });
    const ttlDays = await inviteTtlDays();
    // The schema needs a password; this one nobody knows. The account opens when the member sets
    // their own on /activate (activation.consume sets active).
    const unusable = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);

    // One transaction: no member without a link, no link without a member, and the log line with both.
    const { member, link } = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name, phone, email: null, password: unusable, role, business_id: req.businessId, active: false },
        select: { id: true, name: true, phone: true, role: true },
      });
      const issued = await activation.issue(created.id, req.user.id, { ttlHours: ttlDays * 24, client: tx });
      await tx.accountEvent.create({
        data: accountEvents.toRow({
          businessId: req.businessId, actorUserId: req.user.id, actorKind: actorKind(req),
          type: 'user_added', data: { user_id: created.id, role },
        }),
      });
      return { member: created, link: issued };
    });

    res.status(201).json(await invitePayload({
      member, shopName: business && business.name, token: link.token, expiresAt: link.expires_at, ttlDays,
    }));
  } catch (err) {
    // The unique index is the real guard against two people taking one mobile at once.
    if (err && err.code === 'P2002') return res.status(409).json({ error: LOGIN_TAKEN_ERROR.phone });
    console.error(`[team] invite failed business=${req.businessId}: ${err.message}`);
    res.status(500).json({ error: ERRORS.failed });
  }
});

/** The member, in this shop, that the owner may change: never themselves, never the owner. */
async function changeableMember(req, res) {
  const member = await prisma.user.findFirst({
    where: { id: String(req.params.id), business_id: req.businessId, role: { not: 'platform_admin' } },
    select: { id: true, name: true, phone: true, role: true, active: true, last_login: true },
  });
  if (!member) { res.status(404).json({ error: ERRORS.notFound }); return null; }
  if (member.id === req.user.id) { res.status(403).json({ error: ERRORS.self }); return null; }
  if (member.role === 'business_owner') { res.status(403).json({ error: ERRORS.owner }); return null; }
  return member;
}

router.patch('/:id', requireRole('business_owner'), async (req, res) => {
  const body = req.body || {};
  const data = {};
  if (body.role !== undefined) {
    if (!TEAM_ROLES.includes(body.role)) return res.status(400).json({ error: ERRORS.role });
    data.role = body.role;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return res.status(400).json({ error: ERRORS.nothing });
    data.active = body.active;
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: ERRORS.nothing });

  try {
    const member = await changeableMember(req, res);
    if (!member) return;

    if (data.active === true && !member.active) {
      // Someone who never chose a password cannot be switched on: they would be «فعّال» and unable
      // to sign in. Their way in is a new link.
      if (!member.last_login) return res.status(409).json({ error: ERRORS.notActivated });
      const contract = await contractOf(req.businessId);
      if (await seatsUsed(req.businessId) >= seatsOf(contract)) {
        return res.status(409).json({ error: ERRORS.seatsFull });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id: member.id },
        data,
        select: { id: true, name: true, phone: true, role: true, active: true, last_login: true },
      });
      // Disabling takes any outstanding link with it, or whoever holds it comes straight back in.
      if (data.active === false) await activation.revoke(member.id, tx);
      const actor = { businessId: req.businessId, actorUserId: req.user.id, actorKind: actorKind(req) };
      if (data.role && data.role !== member.role) {
        await tx.accountEvent.create({ data: accountEvents.toRow({ ...actor, type: 'role_changed', data: { user_id: member.id, from: member.role, to: data.role } }) });
      }
      if (typeof data.active === 'boolean' && data.active !== member.active) {
        await tx.accountEvent.create({ data: accountEvents.toRow({ ...actor, type: data.active ? 'user_reactivated' : 'user_deactivated', data: { user_id: member.id } }) });
      }
      return row;
    });
    res.json({ member: updated });
  } catch (err) {
    console.error(`[team] update failed business=${req.businessId}: ${err.message}`);
    res.status(500).json({ error: ERRORS.failed });
  }
});

/**
 * «أعد إرسال الرابط»: a new link for a member who has not signed in yet (the old one stops working).
 * Refused once they have: a fresh link would let the owner set a working member's password.
 */
router.post('/:id/resend', requireRole('business_owner'), async (req, res) => {
  try {
    const member = await changeableMember(req, res);
    if (!member) return;
    if (member.last_login) return res.status(409).json({ error: ERRORS.signedIn });
    // A link for someone the owner disabled puts them back on the seats meter.
    const links = await prisma.userActivation.count({ where: { user_id: member.id, used_at: null } });
    if (!links) {
      const contract = await contractOf(req.businessId);
      if (await seatsUsed(req.businessId) >= seatsOf(contract)) {
        return res.status(409).json({ error: ERRORS.seatsFull });
      }
    }
    const business = await prisma.business.findUnique({ where: { id: req.businessId }, select: { name: true } });
    const ttlDays = await inviteTtlDays();
    const link = await activation.issue(member.id, req.user.id, { ttlHours: ttlDays * 24 });
    res.json(await invitePayload({
      member, shopName: business && business.name, token: link.token, expiresAt: link.expires_at, ttlDays,
    }));
  } catch (err) {
    console.error(`[team] resend failed business=${req.businessId}: ${err.message}`);
    res.status(500).json({ error: ERRORS.failed });
  }
});

module.exports = router;
