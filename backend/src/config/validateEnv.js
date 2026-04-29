/**
 * Environment variable validator.
 * In production: hard fail on missing critical vars.
 * In development: warn but continue.
 */

const REQUIRED_ALWAYS = [
  'MONGO_URL',
  'JWT_SECRET',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
];

const REQUIRED_IN_PRODUCTION = [
  'META_APP_SECRET',
  'CORS_ORIGINS',
  'TOKEN_ENCRYPTION_KEY',
];

const AI_KEYS = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
};

function validateEnv() {
  const isProd = process.env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];

  // Always required
  for (const key of REQUIRED_ALWAYS) {
    if (!process.env[key]) {
      errors.push(key);
    }
  }

  // Required in production only
  if (isProd) {
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (!process.env[key]) {
        errors.push(key);
      }
    }
  } else {
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (!process.env[key]) {
        warnings.push(key);
      }
    }
  }

  // AI provider key
  const provider = process.env.AI_PROVIDER || 'gemini';
  const aiKey = AI_KEYS[provider];
  if (aiKey) {
    if (!process.env[aiKey]) {
      if (isProd) {
        errors.push(`${aiKey} (required for AI_PROVIDER=${provider})`);
      } else {
        warnings.push(`${aiKey} (required for AI_PROVIDER=${provider})`);
      }
    }
  } else {
    warnings.push(`Unknown AI_PROVIDER="${provider}". Supported: gemini, openai`);
  }

  // JWT_SECRET strength check
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    if (isProd) {
      errors.push('JWT_SECRET must be at least 32 characters in production');
    } else {
      warnings.push('JWT_SECRET is short (< 32 chars) — use a longer secret in production');
    }
  }

  // TOKEN_ENCRYPTION_KEY length check (must be 32 bytes = 64 hex chars)
  if (process.env.TOKEN_ENCRYPTION_KEY) {
    if (process.env.TOKEN_ENCRYPTION_KEY.length !== 64) {
      const msg = 'TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)';
      if (isProd) errors.push(msg);
      else warnings.push(msg);
    }
  }

  // META_APP_SECRET - warn in dev if missing (webhook sig validation will be skipped)
  if (!isProd && !process.env.META_APP_SECRET) {
    warnings.push('META_APP_SECRET is missing — webhook signature validation is DISABLED (dev only)');
  }

  // Print warnings
  if (warnings.length > 0) {
    console.warn('\n⚠️  Environment warnings:');
    warnings.forEach(w => console.warn(`   - ${w}`));
    console.warn('');
  }

  // Fail on errors
  if (errors.length > 0) {
    console.error('\n❌ FATAL: Missing required environment variables:');
    errors.forEach(e => console.error(`   - ${e}`));
    console.error('\nServer cannot start. Add the missing variables to your .env file.\n');
    process.exit(1);
  }

  console.log(`✅ Environment validated (${isProd ? 'production' : 'development'})`);
}

module.exports = { validateEnv };
