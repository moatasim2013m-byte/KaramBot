const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true, name: true, email: true, role: true,
        business_id: true, active: true, sessions_valid_from: true,
      },
    });
    if (!user || !user.active) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    // A password change ends every session that predates it. Without this, someone who used a
    // stolen activation link keeps their session even after the real owner recovers the
    // account — the recovery would look successful and change nothing.
    if (user.sessions_valid_from && decoded.iat) {
      if (decoded.iat * 1000 < new Date(user.sessions_valid_from).getTime()) {
        return res.status(401).json({ error: 'Session expired' });
      }
    }

    let business_type = null;
    if (user.business_id) {
      try {
        const business = await prisma.business.findUnique({
          where: { id: user.business_id },
          select: { business_type: true },
        });
        business_type = business ? business.business_type : null;
      } catch (e) {
        business_type = null;
      }
    }

    req.user = { ...user, business_type };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function requireBusinessAccess(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role === 'platform_admin') return next();

  const businessId = req.params.businessId || req.query.businessId || req.body.business_id;
  if (!businessId) return res.status(400).json({ error: 'business_id required' });

  if (req.user.business_id !== businessId) {
    return res.status(403).json({ error: 'Access denied to this business' });
  }
  next();
}

/**
 * Pin every request to exactly one business.
 *
 * This must fail closed. The previous version only pinned a tenant when they HAD a
 * business_id, so a non-admin whose business_id was null fell through to the request's
 * own params — meaning `?businessId=<anyone>` was honoured, and with no param at all the
 * scope became `{ business_id: undefined }`, a key Prisma drops, returning every tenant's
 * rows. Such users are not hypothetical: creating staff without a business made them.
 *
 * So: a tenant is pinned to their own business and no parameter can widen it, and a user
 * with no business is refused rather than left unscoped.
 */
function attachBusinessId(req, res, next) {
  if (req.user?.role !== 'platform_admin') {
    if (!req.user?.business_id) {
      return res.status(403).json({ error: 'هذا الحساب غير مرتبط بمنشأة' });
    }
    req.businessId = req.user.business_id;
    return next();
  }

  // platform_admin reads across accounts, so the account must be named explicitly.
  req.businessId = req.params.businessId || req.query.businessId || null;
  if (!req.businessId) {
    return res.status(400).json({ error: 'platform_admin must supply businessId as query param or route param' });
  }
  return next();
}

module.exports = { authenticate, requireRole, requireBusinessAccess, attachBusinessId };
