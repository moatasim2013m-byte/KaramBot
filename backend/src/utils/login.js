'use strict';

/**
 * Who a login names: an email or a mobile number (Migration 2, decisions-2026-10-08.md #3).
 *
 * A shop owner signs in with the number SHIFT already has for them; staff and SHIFT's own people
 * keep their email. The rule is the spec's and deliberately dumb: anything containing '@' is an
 * email, anything else is a phone. A login form that guessed harder would one day sign someone
 * into the wrong kind of account.
 *
 * Every place that looks a user up by what they typed, or checks that a new login is free, goes
 * through here, so «0791 234 567», «+962791234567» and Arabic-Indic digits all reach the same row
 * and two creation paths cannot disagree about what «taken» means.
 */

const prisma = require('../config/prisma');
const { normalizePhone } = require('./phone');

/** Trimmed, lower-cased email, or null. Admin-created users have always been stored lower-case. */
function normalizeEmail(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  return s || null;
}

/**
 * The phone as stored in users.phone: 9627XXXXXXXX. Only a Jordanian mobile is accepted for a
 * login, so a landline or a typo with the right length is refused at creation instead of
 * producing an owner who can never sign in.
 */
function normalizeLoginPhone(raw) {
  const p = normalizePhone(raw);
  return p && /^9627[789]\d{7}$/.test(p) ? p : null;
}

/**
 * {kind:'email', email} | {kind:'phone', phone} | null for what was typed in the login field.
 * Not a validator: a malformed email still comes back as an email, so it simply finds nobody.
 */
function parseLogin(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  if (s.includes('@')) return { kind: 'email', email: normalizeEmail(s) };
  const phone = normalizeLoginPhone(s);
  return phone ? { kind: 'phone', phone } : null;
}

/**
 * The user a login names, with `select`, or null.
 *
 * Email: tried as typed first, then lower-cased. Users made by POST /api/auth/register kept the
 * capitalisation they were typed with, and Postgres compares exactly, so a lower-case-only lookup
 * would lock those people out on the day this shipped.
 */
async function findUserByLogin(raw, select) {
  const parsed = parseLogin(raw);
  if (!parsed) return null;
  if (parsed.kind === 'phone') {
    return prisma.user.findUnique({ where: { phone: parsed.phone }, select });
  }
  const asTyped = String(raw).trim();
  const user = await prisma.user.findUnique({ where: { email: asTyped }, select });
  if (user || asTyped === parsed.email) return user;
  return prisma.user.findUnique({ where: { email: parsed.email }, select });
}

/**
 * 'email' | 'phone' | null: which of a new login's identifiers already belongs to someone.
 * Checked before create so the answer is an Arabic sentence, not a P2002; the unique indexes
 * remain the real guard against a race.
 */
async function loginTaken({ email, phone } = {}) {
  if (email) {
    const hit = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (hit) return 'email';
  }
  if (phone) {
    const hit = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
    if (hit) return 'phone';
  }
  return null;
}

/** The Arabic refusal for loginTaken's answer. */
const LOGIN_TAKEN_ERROR = {
  email: 'هذا البريد مستخدم مسبقًا',
  phone: 'رقم الموبايل هذا مستخدم لحساب آخر',
};

/**
 * «+962 7•• ••• 567»: enough for the owner to recognise their own number on the activation page,
 * not enough for whoever holds a leaked link to learn it.
 */
function maskPhone(phone) {
  const p = String(phone || '');
  if (!/^\d{8,15}$/.test(p)) return null;
  if (/^9627\d{8}$/.test(p)) return `+962 7•• ••• ${p.slice(-3)}`;
  return `+${p.slice(0, 3)} ••• ${p.slice(-3)}`;
}

module.exports = {
  normalizeEmail, normalizeLoginPhone, parseLogin, findUserByLogin, loginTaken, LOGIN_TAKEN_ERROR, maskPhone,
};
