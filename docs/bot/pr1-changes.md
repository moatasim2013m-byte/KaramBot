# PR1 — SHIFT bot reliability: what changed and how to roll it out

Branch `feat/shift-bot-pr1-reliability`. Follows `implementation-decisions-2026-09-14.md` (which overrides the plan)
and `pr1-contracts.md`. Commands for Cloud Run, Cloud Scheduler and the database are in
`backend/scripts/shift-runbook.md`; the owner runs them, not Claude.

## What changed

**Webhook (D12).** `routes/whatsapp.js` now saves inbound messages and conversation counters before it answers 200
(4 s budget). A DB error or timeout returns 500 so Meta retries; the unique `meta_message_id` makes retries harmless.
Each inbound row and its conversation counters are written in one short transaction (D24). Only the delivery whose
transaction inserted the row processes it, so a retry that races a slow delivery never forwards or answers the message
twice, and a failed counter update leaves no half-saved row behind. `last_inbound_at` never moves backwards.
Rows for restaurant, clinic, generic and external-mode tenants are saved as `processing` and become `delivered` (their
old value) once the forward or workflow ran. If the instance dies in between, the sweeper's
`messageProcessor.reprocessStuckInbound` re-runs a row still `processing` after 2 minutes, once. A re-run that dies
too is logged («gave up») and closed, never run a third time.
AI work, status updates, forwarding and sends run after the response. This also applies to the external-mode
restaurant tenant: its inbound row is now saved before 200, and everything else about it is unchanged.

**Reply batching (D5).** SHIFT inbound rows are saved as `received`. A per-conversation quiet window (1.5 / 2.5 / 4 s,
never more than 10 s after the first line) collects a burst, and `services/replyBatcher.js` answers every `received`
row with one AI call and one reply. A DB lease stops two instances replying at once. An intent row is written before
each Graph call, so a crash after sending is recovered without a second send. Rows then move to
`answered | awaiting_staff | skipped`.

**Send intents and fencing (D17–D26, after the GPT-6 external review).**
- *Correlation (D17).* Every bot send is an intent row created before the Graph call. Its id goes out as WhatsApp's
  `biz_opaque_callback_data`, so a status webhook can name the exact send (`replyBatcher.applyIntentStatus`).
  `replyBatcher.dispatchIntent` is the single helper for bot and system sends.
- *At most once, never silent (D18).* A timeout or a generic 5xx is `ambiguous` and is not resent at once; only a
  request that never left the host is retried. The customer's messages wait as `unconfirmed` (not `answered`) until
  Graph returned a wamid or a `sent/delivered/read` status is echoed. After 2 minutes without that,
  `reconcileUnconfirmedIntents` puts them back to `received` once. If the retry is also unconfirmed, the messages
  become `awaiting_staff`, `needs_team.reason = unsent_reply`, the conversation goes `pending` and staff are alerted.
- *Fencing (D20).* A lease is only renewed while it is still ours and unexpired, and a failed renewal ends the run.
  Right before each Graph call one conditional statement re-checks lease ownership, claim/takeover, AI switch,
  staff pause and opt-out; if it refuses, nothing is sent and the messages go to `awaiting_staff` (staff) or are left
  to the new lease owner. A state write that matches no row (e.g. the conversation was claimed) also stops the send.
- *Deterministic rows (D23).* The worker handles reactions and «إيقاف» from the stored `received` rows. It saves the
  opt-out and the ack intent before those rows change status, so a crash is recovered the same way and never by the
  AI. A «إيقاف» that arrives while a reply is generating cancels that reply.
- *Shared debounce (D25).* Each fragment's quiet deadline is stored in `metadata.batch_due_at`
  (`replyBatcher.touchBatchDue`). A timer or sweep that fires early on any instance waits for it. An AI-failure
  fallback covers every message received up to the moment it is sent, so one burst gets one fallback.
- *Honest acks (D26).* The «سجّلت طلب مكالمة…» ack is built from the lead that `saveLead` actually stored. If a
  staff-set time blocks the customer's new time, the customer is told it was passed to the team, and the request is
  kept in `workflow_data.requested_time_change`. A failed lead save sends no ack.

- *Status webhook (D17/D19).* `handleStatuses` finds the send only by the echoed `biz_opaque_callback_data` or the exact
  wamid; a status that matches nothing changes nothing (the old recipient/time guess is gone). A `failed` status on a
  reply that answered customer messages puts those messages back in the queue once; a second failure hands them to
  staff (`unsent_reply`). If another part of the same reply was accepted, nothing is requeued. Billing still raises
  the banner.
- *Processor (D23/D25).* The processor no longer answers opt-outs, reactions or taps itself: it hands them to
  `runBatch` (opt-outs and taps make the queued burst due at once), and a normal message sets the shared
  `batch_due_at` through `replyBatcher.touchBatchDue`.
- *Staff before bot (D21).* Inbox «إرسال» and «استلام» store the 30-minute staff pause (and, for «استلام», the
  takeover) **before** calling WhatsApp, so a bot reply that is about to go out is stopped by its pre-send check. The
  claim ack is a send intent like every bot message.
- *Pause expiry (D22).* When a staff pause runs out and nobody took the conversation, the sweeper puts the messages
  that waited for staff back in the queue and the bot answers them. Messages handed to staff because a bot reply could
  not be confirmed stay with staff. The awaiting-staff note is skipped only for real closers from a phrase list
  («شكرًا», «تمام», «ok», «👍», «يعطيك العافية»…), no longer for any message of three words or fewer.
- *Recoverable notes (GPT-6 #11).* The SLA and awaiting-staff notes are send intents tied to the request (or silence)
  they are for. A sweep that dies after claiming a note is taken over after 2 minutes; if its intent was already
  written, the note is not sent again. A request replaced while a sweep was reading it is never marked as noted.
- *Integration fixes.*
  - A customer message left «الرد غير مؤكد» by a crash in the middle of settling a send is finished by the next sweep
    after 5 minutes. The rules are the same: requeued once, then handed to staff.
  - Messages handed to staff after a second `failed` status are no longer handed back to the bot when a staff pause
    expires.
  - A «إيقاف» found after the 24 h window closed is still recorded, even though its ack can no longer be sent.
  - The claim ack is stored as the staff member's message from the start.
  - Staff alerts have a label for `unsent_reply`.
  - The test fake database now rolls back a failed transaction, like Postgres.
- *Re-verification of the GPT-6 fixes.* A second pass reproduced two findings that were only half fixed, plus smaller gaps:
  - *#7, out of order.* Meta can deliver a `failed` status before the send's own response. The send's answer no
    longer overwrites it: the part counts as failed, the messages are requeued once and a second reply goes out (a
    second failure hands them to staff). A `failed` status that lands between recording the send and marking the
    messages answered is re-applied to them.
  - *#13, bot side.* The bot writes the conversation's status, stage and team request in one database statement, and
    the team request is compared with what is stored at that moment. A staff «تم التواصل» on the old request can no
    longer leave the bot's new request hidden on an `open` conversation. A request the bot skipped because an
    equal-priority one was open is recorded when staff resolved that one meanwhile.
  - *Notes after a takeover.* A sweep that stalled for more than 2 minutes and was taken over no longer sends the SLA
    or awaiting-staff note a second time: the send is checked against the note's claim right before WhatsApp.
  - *Opt-out ack.* An opt-out ack that could not be confirmed twice is given up on with an alert. It is no longer
    handed to staff as an unanswered customer, and no «رسالتك وصلت» note can follow a «إيقاف».
  - *Echoed statuses.* A `delivered`/`read` status that arrives while the send is still in flight is kept (no longer
    reset to `sent`), and an echoed `sent` confirms a send whose response was lost.
  - *Aborted sends.* A send that another worker marked unconfirmed but that was stopped before WhatsApp is cancelled,
    and its messages go straight back to the queue instead of waiting 2 minutes and spending the retry.
  - *Restaurant/clinic sends* time out after 15 s, so a hung connection cannot outlive the 2-minute re-run of a stuck
    message.
  - *Lead card.* A new call time the customer asked for while staff own the time is shown on the card; saving the time
    clears it.
- *Inbox editor (D27).* «تم التواصل» resolves the request and reopens the conversation in one conditional database
  statement (`jsonb.resolveNeedsTeam`), so a request the bot records at the same moment stays pending. The lead card is
  keyed by conversation, so a half-typed edit never carries over to the next customer, and a save uses the lead
  version the edit started from.

**End-to-end coverage.** `tests/shiftE2E.test.js` drives the real app through the ten failure paths behind these
decisions:
- a crash before Graph
- a Graph 502 later confirmed by its echoed status
- two unconfirmed sends in a row
- a staff claim during generation and inside the pre-send gap
- a staff pause that expires
- a `failed` status webhook
- a STOP on a dying instance
- an external-mode forward lost to a crash
- a `failed` status that arrives before the send's own response
- a note sweep that stalls and is taken over by another instance

**Never silent.** If the AI fails twice within the 18 s deadline, the customer gets one fallback message (with slot
buttons during team hours). The conversation goes to `pending` with `needs_team.reason = ai_failure`, and staff are
alerted. Send failures are counted, and staff are alerted after 3. A failed send is not retried at once: the rows
stay `received` and each sweep (a minute apart) is the next attempt, so a short throttle or Meta outage does not use
all three. After 3 the Inbox shows «بدون رد» and a banner until the bot or a staff reply answers the customer.
Billing errors (131042) set `metadata.billing_blocked_at`, which the Inbox shows as a red banner.

**Workflow.** `workflows/shift.js` is now the folder `workflows/shift/`:

| Module | Role |
|---|---|
| `index` | Entry point |
| `prompt` | System prompt |
| `actions` | Action list and response schema |
| `results` | AI result → WorkflowResult |
| `acks` | Every fixed customer text |
| `handoff` | «بدي أحكي مع إنسان» detection |
| `optout` | «إيقاف» |
| `buttons` | Slot offers and taps |
| `hours` | Team hours (D8 defaults) |
| `lead` | Lead card merge and save |

A handoff never turns the AI off; only staff «استلام» (claim) does. Every customer link comes from
`config/site.js` (`https://shifts-ai.com`, D4).

**Staff are never talked over.** A staff send from the Inbox sets `metadata.human_active_until` (now + 30 min). While
it is in the future, or while the conversation is claimed or in `human_takeover`, the bot does not reply. Instead
the customer's messages become `awaiting_staff`.

**Inbox.**
- New routes: `PATCH /conversations/:id/lead`, `POST /claim` and `POST /release`.
- `GET /conversations` gains the filters `needs_team=1` and `stage=`, plus an `awaiting_staff` count, and lists
  pending conversations first.
- `/stats` adds `pending` and `awaiting_staff`.
- `InboxPage.jsx` adds:
  - the stage chip
  - the «يحتاج الفريق» and «بانتظار الموظف» badges
  - the 24 h window countdown
  - the lead card with inline edit
  - the «استلام» and «إرجاع للبوت» buttons
  - the billing banner
  - the «بدون رد» badge and banner (bot failed 3 times), also for an open `unsent_reply` request (D18)
  - «الرد غير مؤكد» on customer messages whose reply is unconfirmed, «ما انبعتت» on sends the pre-send check stopped

  The lead card, stage chip and team badges show only for a `shift` business; other tenants' Inbox is unchanged.

**Sweeper and alerts.** `services/shiftSweeper.js` runs every 60 s in-process and on `POST /api/internal/sweep`
(bearer token). It:
- re-runs non-SHIFT messages stuck in `processing` (D24, `messageProcessor.reprocessStuckInbound`)
- settles unconfirmed bot sends (D18, `replyBatcher.reconcileUnconfirmedIntents`)
- hands messages back to the bot when a temporary staff pause expired (D22)
- retries orphaned `received` rows
- sends the SLA note and the awaiting-staff note (as recoverable send intents)
- flags windows that are about to close
- alerts on inbound messages without a reply

`GET /api/internal/shift-status` reports health. `services/alerts.js` posts to a Slack/Discord webhook and/or
WhatsApp staff numbers (D7).

**Shared plumbing.**
- `db/jsonb.js` is the only place that writes raw SQL. It patches single keys of `workflow_data` / `metadata`, so
  concurrent writers never overwrite each other.
- `ai/provider.js` gains SHIFT options: JSON mode, `systemInstruction` and the deadline split. The restaurant and
  clinic call shape is pinned by `tests/providerContract.test.js`.
- `services/whatsapp.js` gains `sendText` / `sendInteractiveButtons`, which never throw and classify errors, and
  reads `GRAPH_API_VERSION` at call time. Every sender accepts `{ callbackData }` (D17). A generic HTTP 5xx is now
  `ambiguous`, not a retryable `server` error (D18).
- `db/jsonb.js` gains `preSendCheck` (D20), `touchBatchDue` (D25) and `resolveNeedsTeam` (D27); `renewLease`
  refuses an expired lease.
- `@google/generative-ai` is pinned to `0.24.1` (D14).
- `cloudbuild.yaml` gains only `--no-cpu-throttling` (D3, matches today's setting, no min instances).

No Prisma migration (D6). Restaurant, clinic and external-mode behaviour is unchanged apart from persist-before-200.

## External review (GPT-6)

The review is in `reviews/pr1-gpt6-2026-09-14.md`, and decisions D17–D27 settle it. Each finding and what changed:

| # | Finding | What changed |
|---|---|---|
| 1 | Persist not atomic; a crash after claim loses a forward | D24: row insert and counters in one `$transaction`. Only the inserting delivery processes the row. Non-SHIFT rows stay `processing` until forward/workflow ran, and the sweeper re-runs them once after 2 min. |
| 2 | Expired worker can still write and send | D20: `renewLease` needs a matching unexpired token, and a failed renewal ends the run. `preSendCheck` re-checks lease + human state in one statement right before Graph. A 0-row state write aborts the send. |
| 3 | Unsent intent marked answered | D18: rows wait as `unconfirmed` until a wamid or an echoed `sent/delivered/read`. After 2 min they are requeued once, then go `awaiting_staff` + `needs_team.unsent_reply` + alert. Owner trade-off decided: at most once, never silent. |
| 4 | Generic 5xx retried | D18: 5xx, timeout and reset are `ambiguous`, with no immediate retry. Only DNS/refused (request never sent) is retried. |
| 5 | Opt-out not durable/serialized | D23: opt-out, reactions and taps run in the leased worker from `received` rows. Opt-out state and ack intent are written before rows leave `received`. The sweeper recovers them with the same logic, never the AI. |
| 6 | Staff don't serialize with bot | D21: `/send` and `/claim` write the pause/takeover before Graph. The claim ack, sweeper notes and button answers go through `dispatchIntent` + `preSendCheck`. |
| 7 | Async `failed` leaves rows answered | D19: a `failed` status on a covering intent requeues once, then hands to staff. It is also handled when `failed` arrives before the POST response. |
| 8 | Status matched by recipient/time | D17: intent id sent as `biz_opaque_callback_data` (≤512). Statuses match only by that id or the exact wamid, and `mayReconcile` is removed. |
| 9 | Instance-local debounce | D25: shared `metadata.batch_due_at` (`touchBatchDue`). Early timers/sweeps wait. A fallback covers every row received up to its send. |
| 10 | Staff pause strands messages; closer by word count | D22: the sweeper requeues `awaiting_staff` rows when the pause expires unclaimed (not `unsent_reply` ones). Closers come from an explicit phrase list. |
| 11 | Note claims consume work that never happened | SLA/awaiting notes are intents tied to the request's `at`. Claims are reclaimable after 2 min, and the claim is re-checked before Graph. |
| 12 | «time noted» contradicts the lead | D26: ack built from what `saveLead` stored. A staff-owned time means «passed to the team» + `requested_time_change`. A failed save sends no ack. |
| 13 | Resolving hides a newer request | D27: `resolveNeedsTeam` and the bot's `writeConversationState` are single conditional statements compared on `needs_team.at`. |
| 14 | Editor draft survives customer switch | D27: `<LeadCard key={selected.id}>`, and a save uses the version the edit started from. |
| 15 | Other checks (SQL, tenancy, auth, XSS, boot) | No defect reported; no change. |

## Environment variables

All are optional. Unset values keep today's behaviour.

| Variable | Default | Effect |
|---|---|---|
| `SHIFT_BOT_LIVE` | unset = live | `0` → SHIFT number save-only except test numbers (D1) |
| `SHIFT_TEST_NUMBERS` | empty | comma-separated digits, added to `ai_config.test_numbers` |
| `INTERNAL_SWEEP_TOKEN` | unset | bearer token for `/api/internal/*`; unset → 503 (in-process sweep still runs) |
| `STAFF_ALERT_WEBHOOK_URL` | unset | Slack/Discord-compatible alert webhook |
| `SHIFT_SITE_URL` | `https://shifts-ai.com` | base for every customer-visible link |
| `GEMINI_MODEL` | `gemini-3.6-flash` | model override |
| `GEMINI_TEXT_MODE` | unset | `1` → prompt in the user turn instead of `systemInstruction` (rollback switch) |
| `GRAPH_API_VERSION` | `v24.0` | Graph API version |
| `WA_TYPING_INDICATOR` | unset | `1` → typing indicator with the read receipt |
| `SHIFT_BATCH_QUIET_MS` / `SHIFT_BATCH_CAP_MS` | `2500` / `10000` | quiet window base / cap |
| `WEBHOOK_PERSIST_BUDGET_MS` | `4000` | persist budget before the webhook answers 500 |

`ai_config` keys read by PR1 (merge with `||`, never overwrite; see runbook §4):
`reply_mode`, `test_numbers`, `team_hours`, `contact`, `alert_wa_numbers`.

## Rollout (D1: the bot is live today, and merging to `main` deploys)

1. **Before merging, set the env vars on Cloud Run** (runbook §2 style, `--update-env-vars`):
   - `INTERNAL_SWEEP_TOKEN` (a long random value).
   - Optionally `STAFF_ALERT_WEBHOOK_URL`, or `ai_config.alert_wa_numbers`.

   The old revision ignores these, so setting them now is harmless.
2. **Optional safer path:** also set `SHIFT_BOT_LIVE=0` and `SHIFT_TEST_NUMBERS=962796381676`. The deploy then
   goes out save-only: everyone's messages are saved, and only the test number gets replies. Remove
   `SHIFT_BOT_LIVE` after the phone checklist passes. Ads have not started, so this costs nothing.
3. **Merge the PR.** Cloud Build deploys it. Confirm that the new revision started. `assertButtons()` runs at boot,
   and a bad slot title would crash the start instead of failing silently.
4. **Create the Cloud Scheduler job** (runbook §5). Check `/api/internal/shift-status`:
   - `workflow_active` (false while in save-only)
   - `received_backlog: 0`
   - `sweep.at` recent
   - `alert_channel_configured`
5. **Run the phone checklist below** from the test number.
6. **If you took step 2:** remove `SHIFT_BOT_LIVE` (runbook §2).

### Phone checklist (test number 962796381676)

Before you start: that conversation is currently `human_takeover`, so the bot is silent for it. In the Inbox, press
«إرجاع للبوت» (or «تفعيل AI») first.

- [ ] Send three short lines within ~3 s («مرحبا» / «عندي كافيه» / «بإربد»). Expect **one** reply a few seconds
      later that takes all three into account. The Inbox shows one bot message.
- [ ] The intro / any link says `shifts-ai.com`, never `.store`.
- [ ] Send «بدي أحكي مع إنسان». Expect the handoff ack right away, with team hours (and contact if configured). The
      Inbox shows the conversation as pending with «يحتاج الفريق». The alert arrives if a channel is configured.
- [ ] Ask a normal question. The bot still answers; the handoff did not switch it off.
- [ ] Tap a slot button, or give name + business + a time. Expect the «سجّلت…» ack, and the lead card shows the
      fields.
- [ ] Send a voice note. Expect the media ack asking you to write it as text.
- [ ] In the Inbox, press «استلام». Expect the claim ack on the phone. Send a staff message, then reply from the
      phone. The bot stays quiet and the message shows «بانتظار الموظف». Reply as staff and the badge clears.
      Press «إرجاع للبوت».
- [ ] Send «إيقاف». Expect the opt-out ack; later messages get no sales push.
- [ ] Check `shift-status` again: `received_backlog: 0`, `unconfirmed: 0`, `ambiguous: 0`.

## Rollback

Stop at the first step that fixes it (runbook §7):

1. `SHIFT_BOT_LIVE=0`: save-only, test numbers still answered. No deploy needed.
2. `ai_config.reply_mode = "external"`: the bot sends nothing, messages are still saved and visible in the Inbox.
3. `git revert` the merge commit on `main`: Cloud Build redeploys PR #19's code.
   - No migration to undo.
   - Rows saved as `received` / `awaiting_staff` / `answered` / `unconfirmed` stay in the DB and are simply ignored
     by the old code. Outbound `cancelled` rows never reached WhatsApp.
   - Also remove `--no-cpu-throttling` only if you want to change CPU allocation; it matches today's setting.
