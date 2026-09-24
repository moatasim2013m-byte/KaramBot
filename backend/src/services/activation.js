/**
 * One-time activation links.
 *
 * A customer sets their own password; SHIFT never chooses or sees one. The token is random,
 * stored only as a SHA-256 hash, single-use, and short-lived — so a database dump yields no
 * usable invitations, and a link forwarded in a WhatsApp thread stops working once used.
 *
 * SHA-256 rather than bcrypt here on purpose: the token is 256 bits of entropy we generated,
 * not a human-chosen password, so it needs no slow hash — and a slow hash on the lookup path
 * would mean a database scan per attempt, since the token is what we look it up BY.
 */

const crypto = require('crypto');
const prisma = require('../config/prisma');

const TOKEN_BYTES = 32;
const TTL_HOURS = 72;

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** Issue a link for this user, invalidating any earlier unused one. */
async function issue(userId, createdBy, { ttlHours = TTL_HOURS } = {}) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');

  // Retire the old invitation and create the new one together. The database also carries a
  // partial unique index on (user_id) where used_at is null, because two concurrent issues
  // both see "nothing live" under READ COMMITTED and both insert — a transaction alone has
  // no row to lock, so the constraint is what actually prevents two live keys.
  await prisma.$transaction(async (tx) => {
    await tx.userActivation.updateMany({
      where: { user_id: userId, used_at: null },
      data: { used_at: new Date() },
    });
    await tx.userActivation.create({
      data: {
        user_id: userId,
        token_hash: hash(token),
        expires_at: new Date(Date.now() + ttlHours * 3600 * 1000),
        created_by: createdBy,
      },
    });
  });

  return { token, expires_in_hours: ttlHours };
}

/**
 * Kill every outstanding link for a user.
 *
 * Disabling an account has to take the invitation with it: otherwise whoever holds a link
 * redeems it later and `consume()` sets active back to true, which would make deactivation —
 * the only lockout control there is — reversible by the person being locked out.
 */
async function revoke(userId, client = prisma) {
  const { count } = await client.userActivation.updateMany({
    where: { user_id: userId, used_at: null },
    data: { used_at: new Date() },
  });
  return count;
}

/**
 * Look up a token without telling the caller why it failed: expired, used and never-existed
 * all answer the same way, so a link cannot be probed for which accounts exist.
 */
async function lookup(token) {
  if (!token || typeof token !== 'string') return null;

  const row = await prisma.userActivation.findUnique({
    where: { token_hash: hash(token) },
    include: { user: { select: { id: true, name: true, email: true, active: true, business_id: true } } },
  });

  if (!row) return null;
  if (row.used_at) return null;
  if (row.expires_at.getTime() < Date.now()) return null;
  if (!row.user) return null;

  return row;
}

/**
 * Spend the token and set the password in one transaction — so a crash between the two cannot
 * leave a used link with the old password, or a fresh password with a link still live.
 */
async function consume(token, plainPassword, bcrypt) {
  const row = await lookup(token);
  if (!row) return null;

  const hashed = await bcrypt.hash(plainPassword, 12);

  await prisma.$transaction(async (tx) => {
    const spent = await tx.userActivation.updateMany({
      where: { id: row.id, used_at: null },
      data: { used_at: new Date() },
    });
    // Two people opening the same link at once: only the update that actually changed a row wins.
    if (spent.count !== 1) throw new Error('activation already used');

    await tx.user.update({
      where: { id: row.user_id },
      data: {
        password: hashed,
        active: true,
        // Redeeming the link signs them in, so record it — the handover checklist reads
        // last_login to decide whether the customer ever actually got in.
        last_login: new Date(),
        // Any session minted before this password existed is now refused.
        sessions_valid_from: new Date(),
      },
    });
  });

  return row.user;
}

module.exports = { issue, revoke, lookup, consume, TTL_HOURS };
