# KaramBot — Memory / PRD

## Original Problem Statement
1. Bootstrap script for first Business + owner user
2. Business_owner dashboard fixes (no /businesses/null, role-based nav)
3. Remove demo login hint + role route guards
4. WhatsApp credential entry tab in Settings
5. Multi-business routing test
6. Platform admin business management UI

## Architecture
- PostgreSQL via Prisma ORM (no DB available in dev pod — tests use in-memory mocks)
- Frontend: React + Vite + Tailwind
- Auth context: user.role, user.business_id, user.business_type (optional), user.name
- Token endpoint: PATCH /api/businesses/:id/token  body: { wa_access_token }
- IDs patchable by platform_admin via PATCH /api/businesses/:id

## Core Requirements (static)
- No backend app code changes, no schema changes, no new dependencies

## What's Been Implemented

### 2026-02 — Bootstrap Script
- `backend/scripts/create-business.js`

### 2026-02 — Dashboard Fixes
- `SettingsPage.jsx`, `DashboardLayout.jsx`

### 2026-02 — Login Hint Removal + Route Guards
- `LoginPage.jsx`, `App.jsx` (RoleRoute)

### 2026-02 — WhatsApp Credential Tab
- `SettingsPage.jsx` tab system

### 2026-02 — Multi-Business Routing Test
- `backend/tests/multiBusiness.test.js` (15 tests)

### 2026-02 — Platform Admin Business Management UI
- `frontend/src/pages/admin/BusinessesPage.jsx`: list with table (name, slug, type, status badge, masked phone, date), "+ إضافة عمل" button, "إدارة" link per row
- `frontend/src/pages/admin/CreateBusinessPage.jsx`: form (name, slug with auto-fill, type, language, timezone, currency, address, WA IDs); POST /api/businesses; navigate to detail on success; clear error display
- `frontend/src/pages/admin/BusinessDetailPage.jsx`: 4 tabs (عام | ذكاء اصطناعي | سياسات | واتساب); PATCH per tab; WhatsApp tab with token form (never shown)
- `App.jsx`: 3 new routes under RoleRoute(['platform_admin'])
- `DashboardLayout.jsx`: label updated "الشركات" → "الأعمال"

## Backlog / Next Tasks
- P0: none
- P1: Extract shared Section/Field/WhatsAppTab into a shared component file to reduce duplication between SettingsPage and BusinessDetailPage
- P2: Add business_type to JWT payload
- P2: manager role — confirm exact permission set
