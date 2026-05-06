/**
 * create-business.js
 * Bootstrap a new Business + owner user for KaramBot (production-safe).
 *
 * Safe to run against production via Cloud Shell.
 * Idempotent: exits 0 without any changes if the slug already exists.
 *
 * Required environment variables:
 *   DATABASE_URL
 *   BIZ_NAME, BIZ_SLUG, BIZ_TYPE (restaurant|clinic|generic)
 *   BIZ_CURRENCY, BIZ_TIMEZONE
 *   BIZ_WA_PHONE_NUMBER_ID, BIZ_WA_BUSINESS_ACCOUNT_ID
 *   OWNER_NAME, OWNER_EMAIL, OWNER_PASSWORD
 *
 * Optional:
 *   APP_URL  – base URL printed in the login summary
 *              (defaults to https://app.karambot.ai)
 *
 * Sample Cloud Shell command:
 *   export DATABASE_URL="postgresql://user:pass@host:5432/karambot"
 *   export BIZ_NAME="My Restaurant"          BIZ_SLUG="my-restaurant" \
 *          BIZ_TYPE="restaurant"              BIZ_CURRENCY="JOD" \
 *          BIZ_TIMEZONE="Asia/Amman"          BIZ_WA_PHONE_NUMBER_ID="10000000001" \
 *          BIZ_WA_BUSINESS_ACCOUNT_ID="20000000001" \
 *          OWNER_NAME="Ahmad Khalil"          OWNER_EMAIL="ahmad@example.com" \
 *          OWNER_PASSWORD="Secure@2025"
 *   node backend/scripts/create-business.js
 */

'use strict';

// Load .env for local dev convenience; in production these come from the shell.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

// ─── Fail-fast env validation ─────────────────────────────────────────────────

const REQUIRED_VARS = [
  'DATABASE_URL',
  'BIZ_NAME',
  'BIZ_SLUG',
  'BIZ_TYPE',
  'BIZ_CURRENCY',
  'BIZ_TIMEZONE',
  'BIZ_WA_PHONE_NUMBER_ID',
  'BIZ_WA_BUSINESS_ACCOUNT_ID',
  'OWNER_NAME',
  'OWNER_EMAIL',
  'OWNER_PASSWORD',
];

const missing = REQUIRED_VARS.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`❌ Missing required environment variable(s): ${missing.join(', ')}`);
  process.exit(1);
}

const VALID_BIZ_TYPES = ['restaurant', 'clinic', 'generic'];
const bizType = process.env.BIZ_TYPE;
if (!VALID_BIZ_TYPES.includes(bizType)) {
  console.error(
    `❌ BIZ_TYPE must be one of: ${VALID_BIZ_TYPES.join('|')}. Got: "${bizType}"`
  );
  process.exit(1);
}

// ─── Config ───────────────────────────────────────────────────────────────────

const appUrl = (process.env.APP_URL || 'https://app.karambot.ai').replace(/\/$/, '');

const bizData = {
  name:                   process.env.BIZ_NAME,
  slug:                   process.env.BIZ_SLUG,
  business_type:          bizType,
  currency:               process.env.BIZ_CURRENCY,
  timezone:               process.env.BIZ_TIMEZONE,
  wa_phone_number_id:     process.env.BIZ_WA_PHONE_NUMBER_ID,
  wa_business_account_id: process.env.BIZ_WA_BUSINESS_ACCOUNT_ID,
};

const ownerData = {
  name:     process.env.OWNER_NAME,
  email:    process.env.OWNER_EMAIL,
  password: process.env.OWNER_PASSWORD,
};

// ─── Minimal sane defaults ────────────────────────────────────────────────────

const AI_CONFIG_DEFAULTS = {
  enabled:              true,
  provider:             'gemini',
  personality:          '',
  greeting_message:     '',
  fallback_message:     '',
  handoff_keywords:     [],
  out_of_hours_message: '',
};

const POLICIES_DEFAULTS = {
  payment_methods: ['cash'],
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

async function main() {
  // Idempotency: bail out cleanly if this slug already exists
  const existing = await prisma.business.findUnique({
    where:  { slug: bizData.slug },
    select: { id: true, name: true },
  });

  if (existing) {
    console.log(`ℹ️  Business with slug "${bizData.slug}" already exists — no changes made.`);
    console.log(`   id   : ${existing.id}`);
    console.log(`   name : ${existing.name}`);
    return; // exit 0
  }

  // Create Business (wa_access_token intentionally left null)
  const business = await prisma.business.create({
    data: {
      name:                   bizData.name,
      slug:                   bizData.slug,
      business_type:          bizData.business_type,
      currency:               bizData.currency,
      timezone:               bizData.timezone,
      wa_phone_number_id:     bizData.wa_phone_number_id,
      wa_business_account_id: bizData.wa_business_account_id,
      wa_access_token:        null,
      status:                 'active',
      opening_hours:          [],
      ai_config:              AI_CONFIG_DEFAULTS,
      policies:               POLICIES_DEFAULTS,
    },
  });

  // Hash password — 12 rounds (matches project convention in seed.js)
  const passwordHash = await bcrypt.hash(ownerData.password, 12);

  // Create business_owner user attached to the new business
  const owner = await prisma.user.create({
    data: {
      name:        ownerData.name,
      email:       ownerData.email,
      password:    passwordHash,
      role:        'business_owner',
      business_id: business.id,
      active:      true,
    },
  });

  // ─── Summary (passwords and tokens are never printed) ─────────────────────
  console.log('\n✅ Bootstrap complete!\n');
  console.log(`   business_id   : ${business.id}`);
  console.log(`   business_name : ${business.name}`);
  console.log(`   owner_email   : ${owner.email}`);
  console.log(`   login_url     : ${appUrl}/login`);
  console.log('');
}

main()
  .catch((err) => {
    console.error('❌ Script failed:', err.message || err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
