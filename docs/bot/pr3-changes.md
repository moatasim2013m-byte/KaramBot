# PR3 — Karam books real SHIFT sales calls in Google Calendar, with reminders

Branch `feat/shift-bot-pr3-booking`, on `main` (PR1, hotfix #23, PR2 #22). It implements
`pr3-booking-design-2026-09-15.md` and still follows D1–D27: every outbound (confirmations, change offers, reminders,
template reminders) is a send intent whose row id travels as `biz_opaque_callback_data` and passes the pre-send
fence, and an ack only states what was persisted.

PR3 adds no Prisma migration, no route, no npm dependency (Google APIs through axios) and nothing to
`REQUIRED_IN_PRODUCTION`. **Without `SHIFT_SALES_CALENDAR_ID` the bot behaves exactly as PR2**: window slot offers
and «سجّلت طلب مكالمة — طلب مش موعد مؤكد». Restaurant, clinic and external-mode tenants are unchanged.

## What changed

**Keyless calendar client (`services/googleCalendar.js`).** The runtime token comes from the metadata server
(`Metadata-Flavor: Google`); IAM Credentials `generateAccessToken` mints a `calendar`-scoped token for
`CALENDAR_SA_EMAIL`, cached until 5 minutes before it expires (concurrent callers share one mint; a 401 drops it).
`GOOGLE_CALENDAR_ACCESS_TOKEN` skips both hops for local development. `freeBusy` (a calendar Google cannot read
fails the whole answer, never "free"), `insertEvent` with a client event id (409 → reads the event: live = already
booked, cancelled = conflict), `patchEvent`, `deleteEvent` (404/410 = already gone), `getEvent`. Nothing throws;
errors are `auth | notFound | conflict | rate | network | invalid | server`.

**Slots and offers (`workflows/shift/booking.js`).** 30-minute slots on the team-hours grid (D8 defaults), from
2 h ahead, over the next 5 team days that still have a slot; Friday/Saturday and `closures` are skipped through
`hours.isTeamDay`. Busy time of every busy calendar is subtracted (the sales calendar is always read, so the bot
sees its own bookings); the horizon's freeBusy is cached for 60 s. Offered: the first free slot, the first free
slot on a later day, and «وقت ثاني» (`slot:other`, PR1's ask). Ids `book:<startISO>`, titles in Amman time
(«بكرا 10:30 الصبح», "Wednesday 2:30 pm", ≤ 20 code points, walked by `assertButtons()` at boot). The offers
replace PR2's windows wherever PR2 offered slots (agreeing to a call, model-chosen slot buttons, slot injection,
the AI-failure fallback, the «مكالمة» button) — only when booking is enabled, the stage is not locked, no example
is running and no call is booked. The lookup is bounded to 3 s so it never eats the model's deadline; unconfigured,
`SHIFT_BOOKING=0`, a calendar error or the timeout keep PR2's offers.

**Book on tap (deterministic, under the lease).** `replyBatcher.answerTaps` sends `book:*`, `book_ok`,
`book_change`, `book_cancel`, `book_seeyou` to `booking.handleBookingTap`, then the usual `deliverResult`:
1. Stale taps (offer older than 12 h, off-grid, too close) get «الخيار هاد قديم.» + fresh slots.
2. freeBusy re-check of that one slot (never cached). Busy → if the event there is ours (a retry whose persist
   failed) it counts as booked; otherwise «هاد الوقت انحجز هلأ.» + fresh slots.
3. Insert on the sales calendar: id `sh` + base32hex(sha256(conversationId|start|seq)), summary
   `مكالمة شِفت — {business_name || profile_name} (+wa)`, lead-card description + Inbox link,
   `extendedProperties.private {conversationId, businessId}`, `reminders.useDefault`, `sendUpdates=none`.
4. The result persists `workflow_data.booking = {event_id, calendar_id, start, end, tz, status:'booked', booked_at,
   seq, source_msg_id, reminders:{}, details_pending, details_missing, history[]}`, `lead.preferred_time`
   (`_prov.source = 'booking'`), status `pending` / stage `captured`, needs_team `meeting`; the batcher writes all of
   it before the confirmation «ثبّتنا مكالمتك مع فريق شِفت: {day} الساعة {time} بتوقيت عمّان. رح نذكّرك قبلها.»
   with [تمام][غيّر الموعد][ألغِ المكالمة], plus one question for a missing name/business. Staff alert
   `booking_booked`.
5. Insert refused, or freeBusy down at tap time → PR2's capture: «سجّلت طلب مكالمة … طلب مش موعد مؤكد», needs_team,
   alert `booking_failed`. Never «ثبّتنا».
6. The name/business answer is saved by the model path as before; `deliverResult` then patches the event's summary
   and description (best effort, off the reply path).

**Reschedule / cancel.** `book_change` (button or template quick reply) or a short text such as «ممكن نغيّر
الموعد؟», «مش رح أقدر», "can we reschedule?" → fresh slots; a tap patches the event (status `rescheduled`,
`booked_at` kept, reminders reset, alert `booking_rescheduled`). If staff deleted the event, the new time is
inserted as a new event (`seq + 1`). A refused patch → «ما قدرت أغيّر الموعد هلأ — وصّلت طلبك … وموعدك الحالي
بضل زي ما هو», `booking.change_requested`, alert `booking_change_request`. `book_cancel` deletes the event (the
booking is kept as `cancelled` for the audit), resolves the meeting request, sets the conversation `open`/`close`
(unless another request is open), sends «لغيت المكالمة. إذا حبيت نرتّب وقت ثاني احكيلي.», alert `booking_cancelled`.
A typed «بدي ألغي» first asks «أكيد بدك نلغي مكالمتك …؟» [ألغِ المكالمة][خليها] (see deviations). `book_ok` /
«تمام، بشوفكم» → «تمام 👍 منحكي معك {day} الساعة {time} بتوقيت عمّان.»

**Reminders (sweeper step `bookings`).** d1 from 24 h before the call (only for bookings made more than 24 h
ahead), h1 from 60 min before. Claimed per (event, start, kind) in `metadata.booking_reminder_<kind>` with a
2-minute takeover like the awaiting note (a taken-over claim whose intent row exists is never sent again), fenced
on that claim in the pre-send check, and never after an opt-out stored since the booking. Inside the 24 h window:
an interactive reminder («تذكير: مكالمتك مع فريق شِفت بكرا الساعة 10:30 الصبح بتوقيت عمّان. إذا بدك تغيّر
الموعد احكيلي.» [تمام، بشوفكم][بدي أغيّر الموعد]); outside it: template `shift_call_reminder`
(language from `lead.language`, body `[dayText, timeText]`, quick-reply payloads `book_seeyou`, `book_change`)
through a new template part that `dispatchIntent` sends with its intent id as callback data. A template refused as
not approved/paused (132000/132001/132005/132007/132012/132015/132016/132068/132069 → reason `template`) or blocked
by billing (131042) → `reminders.<kind> = {skipped}`, `metadata.reminder_blocked` (Inbox chip) and one
`reminder_blocked` alert per booking; other refusals → `{failed}`; nothing is retried. Cancelled bookings,
opted-out customers, calls already started, save-only mode and staff takeovers (`skipped:'staff'`) get no reminder;
a d1 missed until the last hour is recorded `late`. 15 min after the call ends: `booking.passed_at`, the meeting
request resolves (pending → open). Booked calls no longer raise the SLA note/alert or the window-closing flag.

**Inbound template quick replies.** SHIFT rows of `type: 'button'` store `button.text`; `replyBatcher.tapButtonId`
maps payload `book_change`/`book_seeyou`, or the texts «بدي أغيّر الموعد» / "Change the time" and «تمام، بشوفكم» /
"See you then", to the booking controls, so they are deterministic taps under the lease (D23).

**Model.** The user turn gains one line only while a booking exists («الحجز: مكالمة … (booked). الحجز والتغيير
والإلغاء يعملها النظام بالأزرار فقط …»). The static prompt's «لا تقل» list adds «ثبّتنا» and «موعدك مؤكد». The
claimed-action validator also blocks «ثبّتنا/حجزنا/تم تثبيت/غيّرت موعدك/لغيت المكالمة/تم الإلغاء/موعدك صار مؤكد»,
"I've booked/confirmed/rescheduled/cancelled your call", "your call is booked", "booked you", a bare "Booked!".

**Status, alerts, Inbox.** `/api/internal/shift-status` adds `calendar_configured`, `booking_enabled`,
`bookings_upcoming` and `reminders {d1_sent, h1_sent, template_sent, skipped, template_blocked, failed}`; the sweep
report adds `reminders_sent/skipped/failed`, `bookings_passed`. Alert reasons: `booking_booked`,
`booking_rescheduled`, `booking_cancelled`, `booking_failed` (also when the calendar changed but the conversation
write was refused), `booking_change_request`, `reminder_blocked`. Inbox (SHIFT only): «مكالمة محجوزة: {weekday time}»
chip, «التذكير ما انبعت» chip, an «المكالمة» section in the lead card (time, status, both reminders, pending
change/cancel requests, missing details) and a «قالب» tag on template rows.

## Design deviations

1. **Event id includes a sequence** (`conversationId|start|seq`): a cancelled event keeps its id in Google, so
   re-booking the same slot after a cancel would otherwise 409 forever.
2. **Second offer on a later day** when one is free (design: "first 2 free slots"), so the two buttons are a real
   choice, not 10:00 and 10:30.
3. **A typed cancel asks for confirmation** ([ألغِ المكالمة][خليها]); the button cancels at once. A change by text
   offers slots directly (non-destructive).
4. **In-window reminders carry the two quick buttons** (interactive, not plain text), mirroring the template.
5. **Staff-held conversations get no reminder** (`skipped:'staff'`): staff may have moved the call by hand.
6. **SLA note/alert and window-closing flag are skipped for booked calls** (not in the design; they were noise).
7. **`template_status`** in shift-status is represented by `reminders.template_blocked` (the app cannot read Meta's
   template status without a Graph call).
8. The offer lookup has a 3 s budget before the model call.

## Environment

| Variable | Default | Effect |
|---|---|---|
| `SHIFT_SALES_CALENDAR_ID` | unset | the calendar events go to; unset (and no `ai_config.calendar.sales_calendar_id`) = PR2 behaviour |
| `SHIFT_BUSY_CALENDAR_IDS` | the sales calendar | comma list of calendars whose busy time is subtracted (the sales calendar is always added) |
| `SHIFT_SLOT_MINUTES` | 30 | slot length (15–120) |
| `SHIFT_BOOKING` | on when a calendar id exists | `0` = request-only slots again (taps on already-sent `book:` buttons become call requests) |
| `CALENDAR_SA_EMAIL` | `karambot-calendar@karam-bot.iam.gserviceaccount.com` | impersonated service account |
| `GOOGLE_CALENDAR_ACCESS_TOKEN` | unset | local development only: a ready calendar token, skips metadata + IAM |
| `SHIFT_INBOX_URL` | `https://app.shifts-ai.com/inbox` | the link in the event description (staff-facing) |

`ai_config.calendar` (optional, never written by code): `sales_calendar_id`, `busy_calendar_ids`, `slot_minutes`,
`min_lead_minutes`, `horizon_days`.

## Rollout (owner)

1. **Share the calendar** (cowork brief `shift-sales-calendar-brief-2026-09-15.md`): the sales calendar with
   `karambot-calendar@karam-bot.iam.gserviceaccount.com` as "Make changes to events", and `osaid@shifts-ai.com` as
   "See only free/busy". Note the sales Calendar ID.
2. **Merge with no calendar env** → nothing changes (shift-status: `calendar_configured: false`).
3. **Payment method** on WABA 1964739120830326, and wait for Meta to approve `shift_call_reminder` (ar, en). Until
   then out-of-window reminders are skipped (`reminders.template_blocked`, one `reminder_blocked` alert per booking);
   in-window reminders still go out.
4. **Save-only test first:** `SHIFT_BOT_LIVE=0`, `SHIFT_TEST_NUMBERS=962796381676`, then on Cloud Run
   `SHIFT_SALES_CALENDAR_ID=<sales id>` and `SHIFT_BUSY_CALENDAR_IDS=<sales id>,osaid@shifts-ai.com`.
   shift-status → `calendar_configured: true, booking_enabled: true`.
5. **Phone checklist (test number):**
   - [ ] Agree to a call → two real free slots + «وقت ثاني»; a slot you block in the calendar is not offered.
   - [ ] Tap → «ثبّتنا مكالمتك…» with three buttons; the event is on the sales calendar at that time with the
         lead card; Inbox shows «مكالمة محجوزة»; staff alert `booking_booked`.
   - [ ] Answer the name question → the event description gains the name.
   - [ ] [غيّر الموعد] → new slots → tap → the same event moves; «غيّرنا موعد مكالمتك…».
   - [ ] «بدي ألغي المكالمة» → confirmation → [ألغِ المكالمة] → the event is gone; «لغيت المكالمة…».
   - [ ] Block a slot in the calendar between the offer and the tap → «هاد الوقت انحجز هلأ» + fresh slots.
   - [ ] Revoke the service account's access (or set a wrong calendar id) → slots fall back to PR2 windows;
         a `book:` tap → «سجّلت طلب مكالمة … طلب مش موعد مؤكد» + `booking_failed` alert.
   - [ ] A booking ≥ 25 h ahead with the chat silent → d1 via template the day before (after approval); tap
         «بدي أغيّر الموعد» on it → new slots.
6. Go live: remove `SHIFT_BOT_LIVE`.

## Rollback (stop at the first step that fixes it)

1. `SHIFT_BOOKING=0` — request-only slots, no calendar calls; existing bookings stay on the calendar and their
   reminders still run (they read `workflow_data.booking`, not the flag).
2. Unset `SHIFT_SALES_CALENDAR_ID` — same, and shift-status shows `calendar_configured: false`.
3. Code: `git revert` the PR3 merge. No migration; `workflow_data.booking` and the `metadata.booking_reminder_*`
   keys are ignored by PR2 code (a `captured`/`pending` conversation stays locked until staff resolve it).

## Verification (this branch)

- Backend: 44 suites passed + 1 skipped (Postgres-only), 1 609 passed / 35 skipped (baseline 41 suites, 1 506).
  New: `googleCalendar.test.js` (29), `shiftBooking.test.js` (53), `bookingReminders.test.js` (17), 4 cases in
  `shiftE2E.test.js`; `sweeper.test.js` shape assertions extended for the new report/status fields.
- `node backend/scripts/eval-shift.js`: exit 0, 19 PASS / 0 FAIL.
- Frontend `vite build` (out of tree): built.
- `backend/scripts/pg-integration.sh all`: plain / tz / flag passes, 34 tests each.

## Known gaps

- A template reminder Graph accepted and Meta later fails (async `failed` status, e.g. template paused after
  send) stays recorded as sent; only synchronous refusals are marked skipped.
- «وقت ثاني» while a call is booked leads to PR2's typed-time capture: the time is recorded as a request for the
  team and the booked call (and its reminders) stay until staff move it.
- An old PR2 `slot:` button tapped while a call is booked is still a PR2 call request.
- A calendar write whose conversation write is then refused (staff claimed in between, DB error) leaves the event
  on the calendar; staff get a `booking_failed` alert and a retry of the tap recognises the event.
- Reminders are skipped for conversations in `human_takeover`; staff remind by hand.
- The Arabic copy (confirmation, reminders, change/cancel lines, button titles) needs the owner's review; the
  English template texts must match the approved template's quick-reply titles exactly for the text fallback
  (payloads are matched first).
