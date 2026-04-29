const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verify JWT and attach user to req
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select('-password');
    if (!user || !user.active) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Require specific roles
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Ensure user belongs to the business being accessed (or is platform_admin)
function requireBusinessAccess(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role === 'platform_admin') return next();

  const businessId = req.params.businessId || req.query.businessId || req.body.business_id;
  if (!businessId) return res.status(400).json({ error: 'business_id required' });

  if (req.user.business_id?.toString() !== businessId.toString()) {
    return res.status(403).json({ error: 'Access denied to this business' });
  }
  next();
}

// Attach business_id from user automatically (for staff/owner routes)
function attachBusinessId(req, res, next) {
  if (req.user?.role !== 'platform_admin' && req.user?.business_id) {
    req.businessId = req.user.business_id;
  } else if (req.params.businessId) {
    req.businessId = req.params.businessId;
  }
  next();
}

module.exports = { authenticate, requireRole, requireBusinessAccess, attachBusinessId };
