const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();

// Security headers.
//
// The dashboard is served from here, so this CSP governs the page that runs Embedded
// Signup. Helmet's defaults allow scripts from 'self' only, which blocks the Facebook
// JS SDK and the facebook.com frames it opens, so those origins — and only those — are
// added on top of the defaults rather than replacing them.
const FB_SCRIPT = 'https://connect.facebook.net';
const FB_FRAMES = ['https://www.facebook.com', 'https://web.facebook.com', 'https://staticxx.facebook.com'];
const cspDefaults = helmet.contentSecurityPolicy.getDefaultDirectives();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...cspDefaults,
      'script-src': ["'self'", FB_SCRIPT],
      'frame-src': ["'self'", ...FB_FRAMES],
      'connect-src': ["'self'", 'https://graph.facebook.com', ...FB_FRAMES],
      'img-src': ["'self'", 'data:', 'https://*.facebook.com'],
    },
  },
}));

// CORS
const allowedOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173').split(',');
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Logging
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// Raw body for webhook signature validation (must be before json parser)
app.use('/api/whatsapp/webhook', express.raw({ type: 'application/json' }));

// JSON body
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many requests' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 100 });

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes
app.use('/api/auth', authLimiter, require('./routes/auth'));
// Mounted before the webhook router so the more specific path wins.
app.use('/api/whatsapp/embedded-signup', apiLimiter, require('./routes/embeddedSignup'));
app.use('/api/whatsapp', require('./routes/whatsapp'));
// Bearer-protected and called every minute by Cloud Scheduler: never behind apiLimiter.
app.use('/api/internal', require('./routes/internal'));
app.use('/api/ingest', apiLimiter, require('./routes/ingest'));
app.use('/api/inbox', apiLimiter, require('./routes/inbox'));
app.use('/api/businesses', apiLimiter, require('./routes/businesses'));
app.use('/api/menu', apiLimiter, require('./routes/menu'));
app.use('/api/orders', apiLimiter, require('./routes/orders'));
app.use('/api/staff', apiLimiter, require('./routes/staff'));
app.use('/api/clinic', apiLimiter, require('./routes/clinic'));
app.use('/api/reports', apiLimiter, require('./routes/reports'));


// Block suspicious probe paths before static/spa handling
const blockedPrefixes = [
  '/.git',
  '/.env',
  '/config/.env',
  '/app/.env',
  '/api/env',
  '/api/config/env',
  '/api/templates',
  '/api/v1/templates',
  '/api/v1/env',
  '/inngest',
];
app.use((req, res, next) => {
  const path = (req.path || '').toLowerCase();
  if (blockedPrefixes.some((prefix) => path.startsWith(prefix))) {
    return res.status(404).json({ error: 'Route not found' });
  }
  next();
});

// Static frontend (built SPA copied into ./public by Dockerfile stage 1)
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// SPA fallback: non-API GET requests return index.html (client-side routing)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/health') return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
