# KaramBot — Memory / PRD

## Original Problem Statement
Create one new standalone helper script `backend/scripts/create-business.js`.
Production bootstrap script for first Business + owner user.
Stack: PostgreSQL + Prisma + Express + Node 20-slim.

## Architecture
- PostgreSQL via Prisma ORM
- `Business` model: id (cuid), slug (unique), business_type, wa_phone_number_id (unique), wa_access_token (null until /token endpoint), ai_config (JSON), policies (JSON)
- `User` model: id (cuid), email (unique), role (business_owner|staff|platform_admin), business_id FK

## Core Requirements (static)
- Script is production-safe (reads DATABASE_URL from env, fails loudly if missing)
- Idempotent on slug uniqueness (exits 0 without mutation)
- All inputs via environment variables
- bcrypt 12 rounds for password hashing
- wa_access_token always left null (set later via /token endpoint)
- Summary output never prints password or tokens

## What's Been Implemented

### 2026-02 — Bootstrap Script
- Created `backend/scripts/create-business.js`
  - Fail-fast validation for 11 required env vars + BIZ_TYPE enum check
  - Idempotency via `prisma.business.findUnique({ where: { slug } })`
  - Creates Business (status=active, opening_hours=[], minimal ai_config + policies)
  - Creates User (role=business_owner, bcrypt hash 12 rounds)
  - wa_access_token explicitly set to null
  - Prints: business_id, business_name, owner_email, login_url
  - node --check verified ✅

## Backlog / Next Tasks
- P0: none (script is complete per spec)
- P1: Add `--dry-run` flag for safer pre-flight validation
- P2: Support seeding initial menu categories for restaurant type
