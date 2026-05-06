# KaramBot — Memory / PRD

## Original Problem Statement
Business_owner dashboard fixes: every page loads with real data or shows a clean empty state.
No broken pages, no /businesses/null calls.

## Architecture
- PostgreSQL via Prisma ORM
- Frontend: React + Vite + Tailwind
- Auth context provides: user.role, user.business_id, user.business_type (optional), user.name

## Core Requirements (static)
- No backend changes, no schema changes, no new dependencies
- Only modify SettingsPage.jsx and DashboardLayout.jsx

## What's Been Implemented

### 2026-02 — Bootstrap Script
- Created `backend/scripts/create-business.js` (see earlier session)

### 2026-02 — Dashboard Fixes
**SettingsPage.jsx**
- Added `Link` import from react-router-dom
- Guard: if `user?.business_id` is falsy → render Arabic notice + link to /admin/businesses
- Existing useEffect already guards the API call; the new guard prevents the infinite "loading" state for platform_admin

**DashboardLayout.jsx**
- Added `Building2` to lucide-react imports
- Replaced static navItems array with `buildNavItems()` function:
  - `platform_admin` → Overview, Inbox (only if business_id), Settings, Businesses (/admin/businesses)
  - `staff` → Inbox, Orders
  - `business_owner` → Overview, Inbox, Orders, Menu (restaurant), Clinic (clinic), Reports, Staff, Settings
  - `manager` → same as owner minus Settings
  - Fallback (business_type absent) → shows both Menu and Clinic
- `yarn build` passes ✅

## Backlog / Next Tasks
- P0: none (fixes complete per spec)
- P1: Implement /admin/businesses route for platform_admin
- P2: Propagate business_type to user JWT/session so DashboardLayout can filter without fallback
