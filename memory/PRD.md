# KaramBot — Memory / PRD

## Original Problem Statement
1. Bootstrap script for first Business + owner user
2. Business_owner dashboard fixes (no /businesses/null, role-based nav)
3. Remove demo login hint + role route guards

## Architecture
- PostgreSQL via Prisma ORM
- Frontend: React + Vite + Tailwind
- Auth context: user.role, user.business_id, user.business_type (optional), user.name

## Core Requirements (static)
- No backend changes, no schema changes, no new dependencies
- Only the specified frontend files touched per session

## What's Been Implemented

### 2026-02 — Bootstrap Script
- `backend/scripts/create-business.js`: idempotent, fail-fast, bcrypt 12 rounds, wa_access_token=null, no password/token in output

### 2026-02 — Dashboard Fixes
- `SettingsPage.jsx`: guard for missing business_id → Arabic notice + /admin/businesses link
- `DashboardLayout.jsx`: buildNavItems() — role-based nav (platform_admin, staff, business_owner, manager) with business_type filtering

### 2026-02 — Login Hint Removal + Route Guards
- `LoginPage.jsx`: removed "بيانات التجربة: staff@demo.com / Staff@123" hint
- `App.jsx`: added RoleRoute component; applied to /menu, /clinic, /reports, /staff (owner+manager+admin), /settings (owner+admin); unauthorised role → redirect to /overview

## Backlog / Next Tasks
- P0: none
- P1: Implement /admin/businesses route for platform_admin
- P2: Add business_type to JWT payload so DashboardLayout filter is always accurate
- P2: manager role — confirm exact permission set with product
