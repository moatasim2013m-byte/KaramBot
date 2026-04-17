# WhatsApp Marketing System — PRD

## Original Problem Statement
1. Audit the current WhatsApp marketing campaign implementation against Meta Marketing Messages documentation — produce gap analysis and compliance decision.
2. Make `POST /api/staff/campaigns/manual-bulk-send` async — return 202 immediately, process sends in the background, track progress via existing CampaignBroadcast model.

## Architecture
- Backend: Node.js/Express in `/app/backend/node-app/`, proxied via FastAPI wrapper on port 8001
- Database: MongoDB Atlas
- Frontend: React
- WhatsApp: Meta Cloud API v25.0, Marketing Messages endpoint
- Deployment: GCP Cloud Run

## Completed
- [x] Meta Compliance Audit — all 7 pillars COMPLIANT, decision: NO CODE CHANGE NEEDED (Feb 2026)
- [x] Async manual-bulk-send — returns 202 immediately, background processing via setImmediate, progress tracking via CampaignBroadcast (Feb 2026)

## Implementation Details (Async Manual Bulk Send)
**File modified:** `backend/node-app/routes/staffCampaigns.js` only
**Files read-only:** `whatsappMarketing.js`, `CampaignBroadcast.js`, `Campaign.js`, `User.js`

### Endpoints:
- `POST /api/staff/campaigns/manual-bulk-send` — validates inputs, creates Campaign + CampaignBroadcast, returns 202 with broadcast_id, fires background send loop
- `GET /api/staff/campaigns/manual-bulk-send/:broadcastId` — polls broadcast progress (status, summary counters, per-recipient results)

### Key Design Decisions:
- Uses `setImmediate()` for background execution (no new queue system)
- Creates a lightweight Campaign doc as parent (CampaignBroadcast.campaign_id is required)
- Persists progress after each batch of 20 sends
- Background runner handles fatal errors gracefully (marks broadcast as failed)

## Backlog
- P2: (Advisory A1) Add `whatsapp_marketing_consent` check to `manual-bulk-send` for parity with `/bulk-send`
- P2: (Advisory A2) Staff opt-out handler should also clear `whatsapp_marketing_consent` for data consistency
