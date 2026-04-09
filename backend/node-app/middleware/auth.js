const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_SECRET_KEY || process.env.JWT_KEY;
const jwtSecretSource = process.env.JWT_SECRET
  ? 'JWT_SECRET'
  : (process.env.JWT_SECRET_KEY ? 'JWT_SECRET_KEY' : (process.env.JWT_KEY ? 'JWT_KEY' : null));

// Validate JWT secret presence early and log alias usage for safer migrations.
if (!JWT_SECRET) {
  console.error('WARNING: JWT secret environment variable is not set. Using default for development only.');
} else if (jwtSecretSource !== 'JWT_SECRET') {
  console.warn(`WARNING: Using legacy ${jwtSecretSource} for JWT signing. Please migrate to JWT_SECRET.`);
}

const getJwtSecret = () => {
  if (JWT_SECRET) return JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return 'peekaboo-dev-secret-only';
};

const STAFF_PERMISSION_KEYS = ['access_staff_tools', 'access_whatsapp_inbox', 'access_whatsapp_campaigns'];
const FULL_STAFF_ACCESS = STAFF_PERMISSION_KEYS.reduce((acc, key) => ({ ...acc, [key]: true }), {});

const getEffectiveStaffPermissions = (user) => {
  if (!user || user.role === 'admin') return FULL_STAFF_ACCESS;
  if (user.role !== 'staff') return {};
  if (!user.staff_permissions) return FULL_STAFF_ACCESS;

  return STAFF_PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = Boolean(user.staff_permissions?.[key]);
    return acc;
  }, {});
};

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const queryToken = typeof req.query?.access_token === 'string' ? req.query.access_token.trim() : '';
    const bearerToken = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : '';
    const token = bearerToken || queryToken;

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const decoded = jwt.verify(token, getJwtSecret());
    
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};


const optionalAuthMiddleware = async (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const queryToken = typeof req.query?.access_token === 'string' ? req.query.access_token.trim() : '';
    const bearerToken = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : '';
    const token = bearerToken || queryToken;

    if (!token) {
      req.user = null;
      req.userId = null;
      return next();
    }

    const decoded = jwt.verify(token, getJwtSecret());
    const user = await User.findById(decoded.userId);

    if (!user) {
      req.user = null;
      req.userId = null;
      return next();
    }

    req.user = user;
    req.userId = decoded.userId;
    return next();
  } catch (_error) {
    req.user = null;
    req.userId = null;
    return next();
  }
};

const adminMiddleware = async (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

const staffMiddleware = async (req, res, next) => {
  if (req.user.role !== 'staff' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Staff access required' });
  }
  next();
};

const staffPermissionMiddleware = (permissionKey) => (req, res, next) => {
  if (req.user.role === 'admin') return next();
  if (req.user.role !== 'staff') {
    return res.status(403).json({ error: 'Staff access required' });
  }

  const permissions = getEffectiveStaffPermissions(req.user);
  if (!permissions?.[permissionKey]) {
    return res.status(403).json({ error: 'You do not have access to this section' });
  }
  return next();
};

module.exports = {
  authMiddleware,
  optionalAuthMiddleware,
  adminMiddleware,
  staffMiddleware,
  staffPermissionMiddleware,
  getJwtSecret,
  getEffectiveStaffPermissions,
  FULL_STAFF_ACCESS
};
