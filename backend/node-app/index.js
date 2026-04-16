require('dotenv').config();
const crypto = require('crypto');
const { logger, pinoHttpMiddleware, writeCloudError } = require('./utils/logger');
const { GCS_BUCKET_NAME, LOCAL_UPLOADS_DIR, UPLOAD_STORAGE_MODE, isGcsBucketConfigured } = require('./utils/gcsUpload');
const initialEnvPresence = {
  MONGO_URL: Boolean(process.env.MONGO_URL),
  JWT_SECRET: Boolean(process.env.JWT_SECRET || process.env.JWT_SECRET_KEY || process.env.JWT_KEY),
  FRONTEND_URL: Boolean(process.env.FRONTEND_URL),
  CORS_ORIGINS: Boolean(process.env.CORS_ORIGINS),
  RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY),
  SENDER_EMAIL: Boolean(process.env.SENDER_EMAIL),
  GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
  GEMINI_IMAGE_MODEL: Boolean(process.env.GEMINI_IMAGE_MODEL)
};


// ==================== BOOT DIAGNOSTICS ====================
logger.info({ event: 'boot', node: process.version }, 'Boot diagnostics');
logger.info({ event: 'boot_env', env: process.env.NODE_ENV || 'undefined', port: process.env.PORT || 'undefined' }, 'Environment');
logger.info({ event: 'boot_env_presence', env_present: initialEnvPresence }, 'Env presence');
logger.info({
  event: 'boot_storage',
  upload_storage_mode: UPLOAD_STORAGE_MODE,
  gcs_bucket_configured: isGcsBucketConfigured,
  gcs_bucket_name: GCS_BUCKET_NAME,
  local_uploads_dir: LOCAL_UPLOADS_DIR
}, 'Storage configuration');

const isProductionEnv = (process.env.NODE_ENV || '').toLowerCase() === 'production';
if (isProductionEnv && UPLOAD_STORAGE_MODE !== 'local' && !isGcsBucketConfigured) {
  logger.warn({
    event: 'boot_storage_degraded',
    reason: 'Missing GCS bucket; uploads will fall back to local storage',
    upload_storage_mode: UPLOAD_STORAGE_MODE,
    local_uploads_dir: LOCAL_UPLOADS_DIR
  }, 'Starting with local upload fallback; set GCS_BUCKET_NAME for durable uploads');
}

// ==================== PROCESS ERROR HANDLERS ====================
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ event: 'unhandled_rejection', reason: reason?.message || reason, stack: reason?.stack || 'no stack' }, 'Unhandled rejection');
  writeCloudError({ event: 'unhandled_rejection', reason: reason?.message || reason, stack: reason?.stack || 'no stack' });
});

process.on('uncaughtException', (err) => {
  logger.fatal({ event: 'uncaught_exception', error: err.message, stack: err.stack }, 'Uncaught exception');
  writeCloudError({ event: 'uncaught_exception', error: err.message, stack: err.stack });
});

if (!process.env.RESEND_API_KEY) {
  process.env.RESEND_API_KEY = 're_placeholder_disabled';
}

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const whatsappWebhookRoutes = require('./routes/whatsappWebhook');
const instagramIceBreakersRoutes = require('./routes/instagramIceBreakers');
const { requestLogger, reportError } = require('./utils/logger');
const { bootstrapAdminUser } = require('./utils/adminBootstrap');

const app = express();
app.set('trust proxy', 1);

// Ignore favicon early to avoid middleware crashes
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Block .git requests (security scan noise reduction)
app.use('/.git', (req, res) => res.status(404).end());

// ==================== REQUEST ID MIDDLEWARE ====================
app.use((req, res, next) => {
  const id = (crypto.randomUUID && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
  req.req_id = id;
  res.setHeader('X-Request-Id', id);
  return next();
});
app.use(pinoHttpMiddleware);

const allowedOrigins =
  process.env.CORS_ORIGINS === '*'
    ? true
    : (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

const corsOrigin =
  allowedOrigins === true
    ? true
    : (allowedOrigins.length ? allowedOrigins : true);

// Middleware
app.use(requestLogger);
app.use(cors({
  origin: corsOrigin,
  credentials: true
}));



// Public local uploads (used when storage falls back to local mode).
// Keep both routes so legacy `/uploads/...` links and API-scoped `/api/uploads/...`
// links both resolve in every deployment topology.
app.use('/uploads', express.static(LOCAL_UPLOADS_DIR));
app.use('/api/uploads', express.static(LOCAL_UPLOADS_DIR));

app.use('/api/whatsapp', express.json({
  limit: '1mb',
  verify: (req, res, buffer) => {
    // Meta signature validation must use exact raw request bytes.
    req.rawBody = buffer;
  }
}), whatsappWebhookRoutes);

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  return next();
});

app.use(helmet({
  xXssProtection: false,
  contentSecurityPolicy: false
}));

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);
app.use((req, res, next) => {
  if (!Number.isFinite(REQUEST_TIMEOUT_MS) || REQUEST_TIMEOUT_MS <= 0) {
    return next();
  }

  let didTimeout = false;
  const timeoutHandle = setTimeout(() => {
    if (res.headersSent) return;
    didTimeout = true;
    const rid = req.req_id || 'no_req_id';
    logger.warn({
      event: 'request_timeout',
      req_id: rid,
      method: req.method,
      url: req.originalUrl || req.url,
      timeout_ms: REQUEST_TIMEOUT_MS
    }, 'Request timed out');
    res.status(504).json({
      error: 'انتهت مهلة معالجة الطلب',
      req_id: rid
    });
  }, REQUEST_TIMEOUT_MS);

  const clear = () => clearTimeout(timeoutHandle);
  res.on('finish', clear);
  res.on('close', clear);

  if (didTimeout) return;
  return next();
});

const sanitizeObject = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => (typeof item === 'object' ? sanitizeObject(item) : item));
  }

  const clean = {};
  for (const key of Object.keys(obj)) {
    const cleanKey = key.replace(/[$\.]/g, '_');
    const val = obj[key];
    clean[cleanKey] = (val && typeof val === 'object') ? sanitizeObject(val) : val;
  }
  return clean;
};

app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }

  if (req.params && typeof req.params === 'object') {
    Object.assign(req.params, sanitizeObject(req.params));
  }

  if (req.query && typeof req.query === 'object') {
    Object.assign(req.query, sanitizeObject(req.query));
  }

  return next();
});

// ==================== HEALTH CHECK (before rate limiting) ====================
app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.get('/health', (req, res) => {
  const isDbConnected = mongoose?.connection?.readyState === 1;
  const resolvedDbName = process.env.DB_NAME || mongoose?.connection?.name || null;
  const resolvedDbHost = mongoose?.connection?.host || null;

  res.status(200).json({
    status: 'ok',
    service: 'peekaboo',
    db: isDbConnected ? 'connected' : 'disconnected',
    db_name: resolvedDbName,
    db_host: resolvedDbHost,
    ai_image_generation: {
      enabled: Boolean(process.env.GEMINI_API_KEY),
      model: process.env.GEMINI_IMAGE_MODEL || 'imagen-3.0-generate-002'
    }
  });
});

// Basic API rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
});

// Strict rate limiting for auth endpoints (login, forgot-password)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS', // Allow CORS preflight
  message: { error: 'محاولات كثيرة جداً، الرجاء المحاولة بعد 15 دقيقة' }
});

app.use('/api', apiLimiter);

// Import routes
const authRoutes = require('./routes/auth');
const slotsRoutes = require('./routes/slots');
const bookingsRoutes = require('./routes/bookings');
const subscriptionsRoutes = require('./routes/subscriptions');
const loyaltyRoutes = require('./routes/loyalty');
const adminWinbackRoutes = require('./routes/adminWinback');
const adminRoutes = require('./routes/admin');
const adminCronRoutes = require('./routes/adminCron');
const staffRoutes = require('./routes/staff');
const staffInboxRoutes = require('./routes/staffInbox');
const paymentsRoutes = require('./routes/payments');
const galleryRoutes = require('./routes/gallery');
const profileRoutes = require('./routes/profile');
const themesRoutes = require('./routes/themes');
const faqBotRoutes = require('./routes/faqBot');
const productsRoutes = require('./routes/products');
const campaignsRoutes = require('./routes/campaigns');
const staffCampaignRoutes = require('./routes/staffCampaigns');
const templatesRoutes = require('./routes/templates');
const consentRoutes = require('./routes/consent');

// Routes
// Apply strict auth limiter to sensitive endpoints
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/slots', slotsRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/admin/cron', adminCronRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/staff/inbox', staffInboxRoutes);
app.use('/api/staff/campaigns', staffCampaignRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/gallery', galleryRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/themes', themesRoutes);
app.use('/api/bot', faqBotRoutes);
app.use('/api', productsRoutes);
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/instagram', instagramIceBreakersRoutes);
app.use('/api', consentRoutes);

// Public settings endpoint (for homepage hero config)
const Settings = require('./models/Settings');
app.get('/api/settings', async (req, res) => {
  try {
    // Settings are stored as individual key-value documents
    const settingsDocs = await Settings.find({
      key: { $in: ['hero_title', 'hero_subtitle', 'hero_cta_text', 'hero_cta_route', 'hero_image'] }
    });
    
    // Convert to object
    const settings = {};
    settingsDocs.forEach(doc => {
      settings[doc.key] = doc.value;
    });
    
    res.json({ settings });
  } catch (error) {
    res.json({ settings: {} });
  }
});

// Health checks
app.get('/api/healthz', (req, res) => res.status(200).send('ok'));
app.get('/api/', (req, res) => {
  res.json({ message: 'Peekaboo API is running!' });
});

// ================= FRONTEND =================
const fs = require('fs');

const frontendPaths = [
  '/app/frontend/build',                          // Cloud Run absolute path
  path.join(__dirname, '../../frontend/build'),   // fallback
  path.join(__dirname, '../frontend/build')       // fallback
];

const frontendBuildPath = frontendPaths.find(p => fs.existsSync(p));
const indexHtmlPath = frontendBuildPath
  ? path.join(frontendBuildPath, 'index.html')
  : null;

if (frontendBuildPath && fs.existsSync(indexHtmlPath)) {
  console.log('[Peekaboo] Serving frontend from:', frontendBuildPath);
  console.log('[Peekaboo] index.html exists:', indexHtmlPath);

  app.use(express.static(frontendBuildPath));

  // SPA catch-all
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(indexHtmlPath);
  });

} else {
  console.log('[Peekaboo] Frontend build not found or missing index.html');
  console.log('[Peekaboo] checked paths:', frontendPaths);
}

// ==================== GLOBAL ERROR HANDLER ====================
app.use((err, req, res, next) => {
  const rid = (req && req.req_id) ? req.req_id : "no_req_id";
  const payload = {
    event: err.event || 'global_error',
    req_id: rid,
    wa_id: err.wa_id,
    mimeType: err.mimeType,
    metaError: err.metaError || err.message || String(err),
    statusCode: err.status || 500,
    stack: err.stack
  };
  logger.error(payload, 'Global error handler');
  writeCloudError(payload);
  res.status(err.status || 500).json({ error: 'حدث خطأ في الخادم', req_id: rid });
});

// ==================== ENV VALIDATION (before server start) ====================
const requiredEnvVars = ['MONGO_URL', 'JWT_SECRET'];
const optionalEnvVars = ['FRONTEND_URL', 'CORS_ORIGINS', 'RESEND_API_KEY', 'SENDER_EMAIL'];
const isProduction = process.env.NODE_ENV === 'production';

console.log('=== Environment Variables Check ===');
let hasAllRequiredVars = true;
requiredEnvVars.forEach(varName => {
  const isPresent = initialEnvPresence[varName];
  if (varName === 'JWT_SECRET') {
    console.log(`ENV_REQUIRED ${varName}(or JWT_SECRET_KEY/JWT_KEY) ${isPresent}`);
  } else {
    console.log(`ENV_REQUIRED ${varName} ${isPresent}`);
  }
  if (!isPresent) {
    if (varName === 'JWT_SECRET') {
      console.error('ERROR: Required env var JWT_SECRET is missing (no JWT_SECRET_KEY/JWT_KEY fallback found)');
    } else {
      console.error(`ERROR: Required env var ${varName} is missing`);
    }
    hasAllRequiredVars = false;
  }
});

optionalEnvVars.forEach(varName => {
  const isPresent = initialEnvPresence[varName];
  console.log(`ENV_OPTIONAL ${varName} ${isPresent}`);
  if (!isPresent) {
    console.warn(`WARN: Optional env var ${varName} is missing`);
  }
});

if (!hasAllRequiredVars && isProduction) {
  console.error('FATAL: Missing required env vars in production. Continuing startup.');
} else if (hasAllRequiredVars) {
  console.log('=== All required env vars present ===');
}

// ==================== MONGODB CONNECT ====================
const mongoUrl = process.env.MONGO_URL;

if (!mongoUrl) {
  console.error('❌ MONGO_URL is missing. App will run but DB features will NOT work.');
} else {
  console.log('⏳ Attempting to connect to MongoDB...');
  
  const options = { serverSelectionTimeoutMS: 10000 };
  if (process.env.DB_NAME) {
    options.dbName = process.env.DB_NAME;
  }
  
  mongoose
    .connect(mongoUrl, options)
    .then(async () => {
      const dbName = process.env.DB_NAME || 'from URI';
      console.log('✅ Connected to MongoDB:', dbName);
      console.log('DB_CONNECTED name=' + mongoose.connection.name + ' host=' + mongoose.connection.host);
      logger.info({
        event: 'db_connected',
        db_host: mongoose.connection.host,
        db_name: mongoose.connection.name
      }, 'Database connected');

      try {
        await bootstrapAdminUser();
      } catch (bootstrapError) {
        console.error('ADMIN_BOOTSTRAP_ERROR', bootstrapError?.message || bootstrapError);
      }
    })
    .catch((err) => console.error('❌ MongoDB connection error:', err));
}

// ==================== START SERVER ====================
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log('LISTENING', PORT);
});
