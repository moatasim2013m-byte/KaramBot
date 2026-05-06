# KaramBot — Memory / PRD

## Original Problem Statement
1. Bootstrap script for first Business + owner user
2. Business_owner dashboard fixes (no /businesses/null, role-based nav)
3. Remove demo login hint + role route guards
4. WhatsApp credential entry tab in Settings

## Architecture
- PostgreSQL via Prisma ORM
- Frontend: React + Vite + Tailwind
- Auth context: user.role, user.business_id, user.business_type (optional), user.name
- Token endpoint: PATCH /api/businesses/:id/token body: { wa_access_token }
- IDs only patchable by platform_admin via PATCH /api/businesses/:id

## Core Requirements (static)
- No backend changes, no schema changes, no new dependencies
- Only the specified frontend files touched per session

## What's Been Implemented

### 2026-02 — Bootstrap Script
- `backend/scripts/create-business.js`: idempotent, fail-fast, bcrypt 12 rounds, wa_access_token=null, no password/token in output

### 2026-02 — Dashboard Fixes
- `SettingsPage.jsx`: guard for missing business_id → Arabic notice + /admin/businesses link
- `DashboardLayout.jsx`: buildNavItems() — role-based nav with business_type filtering

### 2026-02 — Login Hint Removal + Route Guards
- `LoginPage.jsx`: removed demo credentials hint
- `App.jsx`: RoleRoute component; /menu /clinic /reports /staff (owner+manager+admin), /settings (owner+admin)

### 2026-02 — WhatsApp Credential Tab
- `SettingsPage.jsx`: tab system (الإعدادات | واتساب)
  - WhatsApp tab: IDs editable by platform_admin only (read-only + note for owner)
  - Token: type=password, never pre-filled, clears after save, body key wa_access_token
  - Amber guidance notice when IDs not yet set, link to /docs/whatsapp-setup.md
  - Per-section loading + error states; "✅ تم الحفظ" / "✅ تم حفظ التوكن (مشفّر)"
  - General tab save button only visible in general tab

## Backlog / Next Tasks
- P0: none
- P1: Implement /admin/businesses route for platform_admin
- P2: Add business_type to JWT payload
- P2: manager role — confirm exact permission set
