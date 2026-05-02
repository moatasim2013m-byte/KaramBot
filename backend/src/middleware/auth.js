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
        business_id: true, active: true,
      },
    });
    if (!user || !user.active) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = user;
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

function attachBusinessId(req, res, next) {
  if (req.user?.role !== 'platform_admin' && req.user?.business_id) {
    req.businessId = req.user.business_id;
  } else if (req.params.businessId) {
    req.businessId = req.params.businessId;
  } else if (req.query.businessId) {
    req.businessId = req.query.businessId;
  }

  // platform_admin must supply a businessId to scope queries
  if (req.user?.role === 'platform_admin' && !req.businessId) {
    return res.status(400).json({ error: 'platform_admin must supply businessId as query param or route param' });
  }

  next();
}

module.exports = { authenticate, requireRole, requireBusinessAccess, attachBusinessId };
