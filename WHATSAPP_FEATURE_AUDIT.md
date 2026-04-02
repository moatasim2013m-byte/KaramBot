# WhatsApp API Feature Audit (Code Reality)

Date: 2026-04-02
Scope reviewed: backend WhatsApp webhook/send/inbox stack + staff inbox frontend integration.

## Implemented ✅

### 1) Webhook ownership and validation
- Webhook routes are mounted at `/api/whatsapp/webhook`.
- GET webhook verification is implemented with verify-token check.
- POST webhook signature verification is implemented using `x-hub-signature-256` + HMAC SHA-256 over raw request body.
- Raw body capture is enabled specifically for `/api/whatsapp` before global JSON middleware, which is required for Meta signature verification.

### 2) Inbound message ingestion and persistence
- Inbound messages are parsed from Meta `entry[].changes[].value.messages` and persisted to `WhatsAppMessage`.
- Duplicate protection is implemented via `message_id` uniqueness + atomic `upsert` with `$setOnInsert`.
- Supported inbound content parsing currently includes: `text`, `image`, `audio`, `video`, `document`, `location`, `contacts`, `sticker`.
- Basic user auto-linking exists (phone-format matching against `User.phone`).

### 3) Outbound status callback handling
- Webhook `statuses[]` callbacks are processed.
- Message status updates supported: `sent`, `delivered`, `read`, `failed`.

### 4) Outbound send API and persistence
- Outbound text sending is implemented via Meta Graph API (`/{phone_number_id}/messages`) in `postWhatsAppText`.
- Outbound messages are persisted to `WhatsAppMessage` when a `staffId` is provided and a `messageId` is returned.
- Phone normalization helper exists for WhatsApp-compatible E.164 digits (without `+`).

### 5) Staff inbox backend APIs
- Staff-protected APIs exist under `/api/staff/inbox` for:
  - conversations list (+ search/unread filter/date filtering)
  - stats
  - messages by contact
  - customer profile linking view
  - send message
  - quick replies CRUD + usage tracking
- Reading conversation messages marks inbound messages as read in DB.
- Sending a reply marks previous inbound messages as `is_replied=true`.
- API marks latest inbound message as read via Meta API (`status: read`) before replying.

### 6) Staff inbox frontend integration
- Staff page has Inbox tab and calls `/api/staff/inbox/*` endpoints.
- Includes conversations list, message thread, quick replies, unread filter, and polling refresh.

### 7) Consent endpoints (marketing baseline)
- `/api/opt-out`, `/api/opt-in`, `/api/consent-status` endpoints exist for WhatsApp marketing consent state on user records.

---

## Missing / Partial ⚠️

### A) Webhook verify-token env mismatch (important)
- Code checks `VERIFY_TOKEN` in webhook GET verification.
- Documentation references `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
- This mismatch can cause verification failures unless ops sets the non-documented `VERIFY_TOKEN`.

### B) Inbound media handling is metadata-only
- Media message IDs are stored (`media_url` field used as media ID), but there is no implemented media fetch/download pipeline from Meta media endpoints.
- No secure media proxy/serving workflow is present for staff inbox previews.

### C) Limited outbound messaging types
- `postWhatsAppText` currently sends text only.
- No API support found for sending templates, interactive buttons/lists, media outbound, or reaction/location outbound payloads.

### D) No conversation assignment / SLA workflow
- No API fields/routes found for assigning conversations to specific staff, ownership locking, internal notes, priorities, or SLA timers/escalation.

### E) Read-state synchronization is partial
- Internal DB read state (`is_read_by_staff`) and Meta customer read receipt are both used, but there is no explicit robust reconciliation job for drift.

### F) Search/filter scalability limits
- Conversation search is partially done in-memory after aggregation (for profile/wa_id match), then limited to 100 conversations.
- This can miss results for larger inboxes and should move search deeper into indexed DB pipeline.

### G) No delivery failure remediation workflow
- Status `failed` is stored, but no retry queue, dead-letter handling, staff alerts, or automatic fallback channel logic is implemented.

### H) Security hardening opportunities
- Quick reply create/update content has no explicit length/character limits visible in route-level validation.
- Webhook POST accepts payload and async-processes, but there is no explicit request-id/idempotency logging standard beyond message-id dedupe.

### I) Realtime UX not implemented
- Staff inbox relies on polling; no websocket/SSE push updates were found.

---

## Recommended next sprint priorities
1. **Fix token env mismatch immediately** (`VERIFY_TOKEN` vs `WHATSAPP_WEBHOOK_VERIFY_TOKEN`).
2. **Implement media retrieval pipeline** (Meta media fetch + storage/proxy + UI preview).
3. **Add outbound template support** for compliant business-initiated messaging windows.
4. **Move conversation search fully to DB indexes** and remove top-100 cap blind spots.
5. **Add failed-message retry/alerting flow**.
6. **Add conversation assignment + internal notes** for team operations.

