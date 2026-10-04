# Inbox v2 — porting the Peekaboo WhatsApp inbox into KaramBot

Owner's request, 2026-10-04: take the inbox from the Peekaboo repo — layouts, design, features — into
KaramBot. Scope chosen: **everything, all phases**.

**Source:** `official-peekaboo-website-`
- UI: `frontend/src/pages/StaffPage.js` L4892–6544 (the `inbox` tab), its state and handlers spread
  across the same 7,563-line component, plus `components/inbox/*` (12 components), `hooks/useInboxNotifications.js`,
  `utils/inboxTime.js`.
- API: `backend/node-app/routes/staffInbox.js` (2,438 lines, 40 endpoints) and `utils/{inboxEvents,
  conversationStore, inboxAiAssist, inboxOfficeHours, inboxEmailAlerts, chatArchive, conversationAnalyzer,
  whatsappMedia, whatsappInteractive}.js`.

## Non-negotiables

1. **Tenant scoping.** Peekaboo's inbox has *zero* — every endpoint is keyed by phone number, because
   Peekaboo is one business. Copied unchanged, any customer's staff could read every other customer's
   conversations. Every query here carries `business_id`, resolved exactly as `routes/inbox.js` does
   today (owner → their business; `platform_admin` → an explicit, audited account).
2. **Conversation id, not `wa_id`, as the route key.** A phone number is unique per business, not
   globally.
3. **Additive schema only.** New nullable columns and new tables. Applied with
   `scripts/migrate-prod.sh` *before* the new code is deployed; old code ignores what it does not know.
4. **Nothing KaramBot already does gets worse:** claim / release / takeover / enable-AI / resolve, the
   SHIFT reply batcher, staff alerts, audited platform-admin reads.

## Stack differences

| | Peekaboo | KaramBot | Approach |
|---|---|---|---|
| React | 19 | 18 | Components used are 18-compatible |
| Router | 7 | 6 | Inbox uses no v7-only API |
| Build | CRA + craco | Vite | Port the `@/` alias to `vite.config` |
| UI kit | Radix / shadcn | none | Add the Radix primitives the inbox actually uses |
| lucide-react | 0.507 | 0.294 | Bump; check every existing icon import still resolves |

## Schema (additive)

**Conversation:** `labels` (text[]), `snoozed_until`, `contact_notes`, `custom_label`, `needs_attention`,
`attention_reason`, `attention_at`, `last_outbound_at`, `last_staff_read_at`, `first_unread_at`,
`last_message_preview`, `last_message_type`, `last_message_direction`.

**Message:** `reply_to_message_id`, `reactions` (Json), `delivered_at`, `read_at`, `failed_at`,
`error_code`, `error_message`.

**New, each with `business_id`:** `QuickReply`, `ScheduledMessage` (by `conversation_id`),
`StaffInboxPresence`.

## Dropped — Peekaboo-specific

- `CustomerLoyaltyCard` → replaced by a KaramBot customer card: lead fields, orders, appointments.
- Children, birthday and hourly bookings; `send-booking-flow`.
- Campaign / broadcast linkage on messages; `linked_user`.

## Phases

| Phase | Contents |
|---|---|
| **A — Data and core API** | Migration. Conversation list with filters and cursor; messages; read/unread; labels, snooze, contact notes, custom label; assign, status, attention; bot toggle. |
| **B — Live** | Server-sent events for the list, stats and the open thread; staff presence and typing. |
| **C — Agent tools** | Quick replies; AI suggested reply and summary; search; scheduled messages and the sender that sends them; interactive buttons; reactions; media in and out (image, video, voice notes, documents); CSV export; customer profile. |
| **D — The UI** | Radix setup in Vite; the three-pane layout extracted from `StaffPage`; every inbox component, wired to the API above. |
| **E — Around the inbox** | CSAT analytics cards, per-staff notification settings, command palette, browser notifications. |

Each phase lands with tests and its own commit.
