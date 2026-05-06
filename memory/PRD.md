# KaramBot — Memory / PRD

## Original Problem Statement
1. Bootstrap script for first Business + owner user
2. Business_owner dashboard fixes (no /businesses/null, role-based nav)
3. Remove demo login hint + role route guards
4. WhatsApp credential entry tab in Settings
5. Multi-business routing test

## Architecture
- PostgreSQL via Prisma ORM (no DB available in dev pod — tests use in-memory mocks)
- Frontend: React + Vite + Tailwind
- Auth context: user.role, user.business_id, user.business_type (optional), user.name
- Token endpoint: PATCH /api/businesses/:id/token  body: { wa_access_token }
- IDs only patchable by platform_admin via PATCH /api/businesses/:id

## Core Requirements (static)
- No backend app code changes
- No schema changes
- No new dependencies
- Only specified files touched per session

## What's Been Implemented

### 2026-02 — Bootstrap Script
- `backend/scripts/create-business.js`: idempotent, fail-fast, bcrypt 12 rounds, wa_access_token=null

### 2026-02 — Dashboard Fixes
- `SettingsPage.jsx`: business_id guard + Arabic notice
- `DashboardLayout.jsx`: buildNavItems() — role-based nav with business_type filtering

### 2026-02 — Login Hint Removal + Route Guards
- `LoginPage.jsx`: removed demo credentials hint
- `App.jsx`: RoleRoute component applied to restricted routes

### 2026-02 — WhatsApp Credential Tab
- `SettingsPage.jsx`: tab system (الإعدادات | واتساب), token never shown, wa_access_token body key

### 2026-02 — Multi-Business Routing Test
- `backend/tests/multiBusiness.test.js`: 15 tests, all passing
  - TC1+2: fixture setup (2 businesses, 2 conversations, distinct phone IDs)
  - TC3: PHONE_A webhook → CONV_A only
  - TC4: PHONE_B webhook → CONV_B only
  - TC5: business_owner of A via JWT → inbox returns only BIZ_A conversations
  - TC6: findFirst by wa_phone_number_id correctness
  - Cross-routing isolation (interleaved messages)
  - Idempotency (duplicate meta_message_id)
  - Unknown phone_number_id silently ignored
  - Pattern: in-memory Prisma mock (no real DB in pod), WhatsApp HTTP calls mocked, processInboundMessage exercised directly

## Backlog / Next Tasks
- P0: none
- P1: Implement /admin/businesses route for platform_admin
- P2: Add business_type to JWT payload
- P2: manager role — confirm exact permission set
