# PR3 — Karam books real SHIFT sales calls in Google Calendar, with reminders (design, 2026-09-15)

**Owner decisions (2026-09-15):** bookings are for **SHIFT sales calls**, they live in **Google Calendar**
(Workspace shifts-ai.com), and the customer is reminded on **WhatsApp**. Stacked on PR2 (#22).
Decisions D1–D27 in `implementation-decisions-2026-09-14.md` still apply, especially the send-intent protocol
(D17–D21) for every outbound and honest acks (D26).

## Infrastructure already in place
- Google Calendar API enabled in project `karam-bot`.
- Service account **karambot-calendar@karam-bot.iam.gserviceaccount.com**. It has no key. The Cloud Run runtime
  SA (`577743455775-compute@developer.gserviceaccount.com`) holds `roles/iam.serviceAccountTokenCreator` on it,
  so the app mints calendar-scoped tokens with the IAM Credentials API: `POST
  https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{sa}:generateAccessToken`,
  `{"scope":["https://www.googleapis.com/auth/calendar"],"lifetime":"3600s"}`, authorised by the runtime token
  from the metadata server. Verified: a token is issued. No calendars are shared yet; the owner does that through
  `docs/cowork/shift-sales-calendar-brief-2026-09-15.md`.
- WhatsApp utility template **`shift_call_reminder`** submitted in `ar` (id 2613732339127833) and `en` (id
  1100360822966863), status PENDING.
  - Body: `{{1}}` = day text, `{{2}}` = time.
  - Quick replies: «تمام، بشوفكم» / «بدي أغيّر الموعد» (en: "See you then" / "Change the time").
  - Sending templates also needs a payment method on WABA 1964739120830326 (owner).

## Configuration
Env overrides take precedence over `ai_config.calendar`:

| Key | Env | Default |
|---|---|---|
| `sales_calendar_id` | `SHIFT_SALES_CALENDAR_ID` | none — booking disabled; falls back to today's "call request" |
| `busy_calendar_ids` | `SHIFT_BUSY_CALENDAR_IDS` (comma list) | `[sales_calendar_id]` |
| `slot_minutes` | `SHIFT_SLOT_MINUTES` | 30 |
| `min_lead_minutes` | — | 120 (no slot sooner than 2 h from now) |
| `horizon_days` | — | 5 team days |
| service account | `CALENDAR_SA_EMAIL` | `karambot-calendar@karam-bot.iam.gserviceaccount.com` |
| `SHIFT_BOOKING` | `SHIFT_BOOKING` | on when a calendar id exists; `0` = request-only |

Team hours come from PR1's `hours.js` (D8 default Sunday–Thursday 09:00–18:00 Asia/Amman).

## Flow
1. **Offer.** When the bot would offer call slots (a close stage, an explicit time request, the button after
   "agree to a call"):
   - Compute candidate 30-minute slots inside team hours for the next `horizon_days`.
   - Subtract Google `freeBusy` for `busy_calendar_ids`.
   - Offer the first 2 free slots plus «وقت ثاني» as buttons, with ids `book:<startISO>`. Labels are Amman local
     time, e.g. «بكرا 10:30», «الخميس 12:00».
   - Offers expire after 12 h, as PR1's do.
   - If the calendar is not configured or `freeBusy` fails, use PR1/PR2's window offers and "request" semantics.
     The wording never says «ثبّتنا».
2. **Book on tap, deterministic, no AI, under the lease.**
   - Re-check `freeBusy` for that slot. If it's taken, say «هاد الوقت انحجز هلأ» and offer fresh slots.
   - Insert the event on the sales calendar:
     - Id: a client-supplied event id `sh` + base32hex of sha256(conversationId + start), truncated. A retry gets
       409 and counts as booked (idempotent).
     - Summary: `مكالمة شِفت — {business_name || profile_name} ({customer_wa_id})`.
     - Description: lead card (name, business, sector, need, source) + Inbox link `https://app.shifts-ai.com/inbox`.
     - `extendedProperties.private`: `{conversationId, businessId}`.
     - Reminders: `useDefault`.
   - Persist `workflow_data.booking = {event_id, calendar_id, start, end, status:'booked', booked_at,
     reminders:{}}` and `lead.preferred_time` (source `booking`). Set conversation `status:'pending'` with
     needs_team `meeting` (resolved automatically when the call time passes, or by staff).
   - Only after the persist succeeds, send the honest confirmation: «ثبّتنا مكالمتك مع فريق شِفت: {day}
     الساعة {time} بتوقيت عمّان. رح نذكّرك قبلها.» with buttons [تمام] [غيّر الموعد] [ألغِ المكالمة]
     (English equivalent).
   - If the event insert fails: fall back to the request ack + needs_team + alert. Never say «ثبّتنا».
3. **Name/business.** Booking no longer waits for the name. If the name or business is unknown, the
   confirmation adds ONE follow-up question «وشو اسمك واسم المحل عشان الفريق يكون جاهز؟». The answer patches
   the event description.
4. **Reschedule / cancel.**
   - A `book_change` / `book_cancel` tap, or text matching a change/cancel pattern while a booking exists (ar:
     «غيّر/أغيّر/أأجل/بدي وقت ثاني/مش رح أقدر/ألغي/الغي»; en: change/reschedule/cancel/can't make it),
     is deterministic.
   - Change: offer fresh slots, then patch the event time on tap; `status:'rescheduled'`; reminders reset.
   - Cancel: delete the event (the id is kept for the audit), `status:'cancelled'`, confirm «لغيت المكالمة.
     إذا حبيت نرتّب وقت ثاني احكيلي.», and send a staff alert.
5. **Reminders (sweeper, every minute, idempotent claims like PR1's notes).**
   - `d1`: when `start − 24h ≤ now` and the booking was made more than 24 h before start. `h1`: when
     `start − 60 min ≤ now`.
   - Inside the 24-hour window: a free-form text through the intent protocol, e.g. «تذكير: مكالمتك مع فريق شِفت
     بكرا الساعة 10:30 بتوقيت عمّان. إذا بدك تغيّر الموعد احكيلي.»
   - Outside the window: template `shift_call_reminder` (language from `lead.language`), params `[dayText,
     timeText]`, with the intent row and callback data (D17).
   - If the template is not approved or billing blocks sending: mark `reminders.d1 = {skipped:'template'}`, set
     the Inbox flag and send a staff alert once.
   - Template quick replies arrive as `type:'button'` inbound messages with `button.text`: map «بدي أغيّر
     الموعد» / "Change the time" → reschedule, «تمام، بشوفكم» → a short ack.
   - Never remind a cancelled booking, an opted-out customer, or a call whose time has passed.
6. **Team.** Google Calendar notifications (configured on the calendar by the owner) plus a WhatsApp/webhook
   staff alert on book / reschedule / cancel (PR1 `alerts.js`). Inbox: chip «مكالمة محجوزة: الأربعاء 10:30»
   on the conversation, and the lead card shows the booking with status.
7. **Model.** The prompt tells the model a booking exists (time, status) and forbids it from confirming, moving or
   cancelling bookings itself. Validators block «ثبّتنا/حجزت/موعدك مؤكد» in model lines (the claimed-action
   guard already exists; extend its list).

## Files (indicative)
- `backend/src/services/googleCalendar.js` (new): token minting through IAM Credentials with the runtime
  metadata token, cached until 5 min before expiry; `freeBusy`, `insertEvent`, `patchEvent`, `deleteEvent`;
  axios, no new dependency; errors classified (auth / notFound / conflict / rate / network).
- `backend/src/workflows/shift/booking.js` (new): candidate slots, free-slot offers, book / reschedule / cancel
  results, confirmation texts (ar/en), deterministic intents.
- `buttons.js`, `results.js`, `index.js`, `acks.js`, `validators.js`, `context.js`/`prompt.ar.js` (booking line),
  `shiftSweeper.js` (reminders), `services/whatsapp.js` (template send through the intent protocol,
  `button`-type inbound parsing), `messageProcessor.js` (template quick-reply routing), `routes/internal.js`
  (`shift-status` gains `calendar_configured`, `template_status`), `InboxPage.jsx` (booking chip/card).
- Tests: googleCalendar (mocked axios, token cache, 409 idempotency), booking slots (team hours, lead time,
  Friday/Saturday, busy subtraction, DST-free Amman), book/reschedule/cancel flows, reminders (window vs
  template, claims, cancelled/opted-out skips), e2e "agree → slots → tap → event created → confirmation →
  d1 reminder via template → change-time quick reply → rescheduled".

## Owner actions
1. Cowork brief `shift-sales-calendar-brief-2026-09-15.md` → Calendar ID → set `SHIFT_SALES_CALENDAR_ID` and
   `SHIFT_BUSY_CALENDAR_IDS=<sales id>,osaid@shifts-ai.com` on Cloud Run.
2. Payment method on WABA 1964739120830326 (template reminders cannot send without it).
3. Wait for Meta to approve `shift_call_reminder` (ar, en).
