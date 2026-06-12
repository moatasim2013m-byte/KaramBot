const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();

// Security headers
app.use(helmet());

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
app.use('/api/whatsapp', require('./routes/whatsapp'));
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
