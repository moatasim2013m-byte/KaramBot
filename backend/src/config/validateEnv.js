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
  anthropic: 'ANTHROPIC_API_KEY',
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

  // Embedded Signup is optional: without the app secret the Connect button fails loudly at
  // the exchange, but the bot keeps serving every number that is already connected. A missing
  // secret must not stop the service from booting.
  if (!process.env.SHIFT_ES_APP_SECRET) {
    warnings.push('SHIFT_ES_APP_SECRET (WhatsApp Embedded Signup is disabled without it)');
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
    warnings.push(`Unknown AI_PROVIDER="${provider}". Supported: ${Object.keys(AI_KEYS).join(', ')}`);
  }

  // The fallback provider is optional: a missing key or a bad name only warns (the bot still runs on the
  // primary, it just has nowhere to go when the primary runs out of credit).
  const fallback = (process.env.AI_FALLBACK_PROVIDER || '').trim().toLowerCase();
  if (fallback && fallback !== 'none') {
    const fbKey = AI_KEYS[fallback];
    if (!fbKey) {
      warnings.push(`Unknown AI_FALLBACK_PROVIDER="${fallback}". Supported: ${Object.keys(AI_KEYS).join(', ')} — no failover`);
    } else if (fallback === provider) {
      warnings.push(`AI_FALLBACK_PROVIDER equals AI_PROVIDER ("${provider}") — no failover`);
    } else if (!process.env[fbKey]) {
      warnings.push(`${fbKey} is not set — AI_FALLBACK_PROVIDER=${fallback} is disabled, no failover`);
    }
  }
  if (process.env.ANTHROPIC_THINKING && !['off', 'adaptive'].includes(process.env.ANTHROPIC_THINKING)) {
    warnings.push(`ANTHROPIC_THINKING="${process.env.ANTHROPIC_THINKING}" is not off|adaptive — using off`);
  }
  if (process.env.ANTHROPIC_EFFORT && !['low', 'medium', 'high', 'xhigh', 'max'].includes(process.env.ANTHROPIC_EFFORT)) {
    warnings.push(`ANTHROPIC_EFFORT="${process.env.ANTHROPIC_EFFORT}" is not low|medium|high|xhigh|max — using low`);
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

  // SHIFT bot settings are optional: a missing one must warn, never stop the shared service.
  if (isProd && !process.env.INTERNAL_SWEEP_TOKEN) {
    warnings.push('INTERNAL_SWEEP_TOKEN is not set — /api/internal/sweep returns 503');
  }
  if (isProd && !process.env.STAFF_ALERT_WEBHOOK_URL) {
    warnings.push('STAFF_ALERT_WEBHOOK_URL is not set — staff alerts go to WhatsApp numbers only');
  }
  if (process.env.GRAPH_API_VERSION && !/^v\d+\.\d+$/.test(process.env.GRAPH_API_VERSION)) {
    warnings.push(`GRAPH_API_VERSION="${process.env.GRAPH_API_VERSION}" does not look like v24.0`);
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
