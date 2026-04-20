# WhatsApp Marketing System — PRD

## Original Problem Statement
1. Audit WhatsApp marketing implementation against Meta Marketing Messages docs
2. Make `POST /api/staff/campaigns/manual-bulk-send` async (return 202, background processing)
3. Add header image support for templates with image headers
4. Fix 3 compliance gaps: category check, consent check, staff opt-out consent clearing

## Architecture
- Backend: Node.js/Express in `/app/backend/node-app/`, proxied via FastAPI wrapper on port 8001
- Database: MongoDB Atlas
- Frontend: React
- WhatsApp: Meta Cloud API v25.0, Marketing Messages endpoint (`/marketing_messages`)
- Deployment: GCP Cloud Run

## Completed
- [x] Meta Compliance Audit v1 — all 7 pillars COMPLIANT (Apr 2026)
- [x] Meta Compliance Audit v2 — full doc review, NO CODE CHANGE NEEDED (Apr 2026)
- [x] Async manual-bulk-send — returns 202, background processing via setImmediate (Apr 2026)
- [x] Header image support — templates with image headers work in bulk send (Apr 2026)
- [x] Contact import — 2,135 contacts from kids_master_list.xlsx + 147 WhatsApp contacts (Apr 2026)
- [x] Fix 1: Category check added to manual-bulk-send (Apr 2026)
- [x] Fix 2: Consent check added to manual-bulk-send (Apr 2026)
- [x] Fix 3: Staff opt-out now clears whatsapp_marketing_consent (Apr 2026)
- [x] WhatsApp bot: typing indicator, 5s burst window, Gemini context caching, media fallback fixes, Jordanian Arabic vocab, DB readiness gate (Feb 2026)
- [x] Staff Panel shell extraction — shared `DashboardLayout`/`Sidebar`/`Header`/`MobileNav` in `frontend/src/components/admin/`, `StaffPage` now wraps existing tabs in the new shell (Feb 2026)

## Backlog
- [ ] Apply the same `DashboardLayout` shell to `AdminPage.js` (legacy, still uses Tabs + Navbar). New admin at `/app/frontend/src/pages/admin/AdminLayout.js` already uses a sidebar layout.
- [ ] `backend/node-app/routes/adminCron.js`: when `whatsapp_followup_template_name` setting is missing, code falls back to `peekaboo_test_campaign` instead of skipping. Decide: adjust code to skip silently OR update the runbook.
