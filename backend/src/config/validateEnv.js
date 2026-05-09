const REQUIRED_ALWAYS = [
  'DATABASE_URL',
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

  for (const key of REQUIRED_ALWAYS) {
    if (!process.env[key]) {
      errors.push(key);
    }
  }

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

  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    if (isProd) {
      errors.push('JWT_SECRET must be at least 32 characters in production');
    } else {
      warnings.push('JWT_SECRET is short (< 32 chars) — use a longer secret in production');
    }
  }

  if (process.env.TOKEN_ENCRYPTION_KEY) {
    if (process.env.TOKEN_ENCRYPTION_KEY.length !== 64) {
      const msg = 'TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)';
      if (isProd) errors.push(msg);
      else warnings.push(msg);
    }
  }

  if (!isProd && !process.env.META_APP_SECRET) {
    warnings.push('META_APP_SECRET is missing — webhook signature validation is DISABLED (dev only)');
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  Environment warnings:');
    warnings.forEach(w => console.warn(`   - ${w}`));
    console.warn('');
  }

  if (errors.length > 0) {
    console.error('\n❌ FATAL: Missing required environment variables:');
    errors.forEach(e => console.error(`   - ${e}`));
    console.error('\nServer cannot start. Add the missing variables to your .env file.\n');
    process.exit(1);
  }

  console.log(`✅ Environment validated (${isProd ? 'production' : 'development'})`);
}

module.exports = { validateEnv };
