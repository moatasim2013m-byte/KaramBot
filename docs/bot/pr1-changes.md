# PR1 — SHIFT bot reliability: what changed and how to roll it out

Branch `feat/shift-bot-pr1-reliability`. Follows `implementation-decisions-2026-09-14.md` (which overrides the plan)
and `pr1-contracts.md`. Commands for Cloud Run, Cloud Scheduler and the database are in
`backend/scripts/shift-runbook.md`; the owner runs them, not Claude.

## What changed

**Webhook (D12).** `routes/whatsapp.js` now saves inbound messages and conversation counters before it answers 200
(4 s budget). A DB error or timeout returns 500 so Meta retries; the unique `meta_message_id` makes retries harmless.
Each inbound row is inserted as `persisting` and the delivery whose update moves it to its real status (`received`
for SHIFT, `delivered` for everyone else) is the only one that processes it, so a retry that races a slow delivery
never forwards or answers the message twice. `last_inbound_at` never moves backwards.
AI work, status updates, forwarding and sends run after the response. This also applies to the external-mode
restaurant tenant: its inbound row is now saved before 200, and everything else about it is unchanged.

**Reply batching (D5).** SHIFT inbound rows are saved as `received`. A per-conversation quiet window (1.5 / 2.5 / 4 s,
never more than 10 s after the first line) collects a burst, and `services/replyBatcher.js` answers every `received`
row with one AI call and one reply. A DB lease stops two instances replying at once. An intent row is written before
each Graph call, so a crash after sending is recovered without a second send. Rows then move to
`answered | awaiting_staff | skipped`.

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
  - the «بدون رد» badge and banner (bot failed 3 times)

  The lead card, stage chip and team badges show only for a `shift` business; other tenants' Inbox is unchanged.

**Sweeper and alerts.** `services/shiftSweeper.js` runs every 60 s in-process and on `POST /api/internal/sweep`
(bearer token). It:
- retries orphaned `received` rows
- sends the SLA note and the awaiting-staff note
- flags windows that are about to close
- alerts on ambiguous sends and on inbound messages without a reply

`GET /api/internal/shift-status` reports health. `services/alerts.js` posts to a Slack/Discord webhook and/or
WhatsApp staff numbers (D7).

**Shared plumbing.**
- `db/jsonb.js` is the only place that writes raw SQL. It patches single keys of `workflow_data` / `metadata`, so
  concurrent writers never overwrite each other.
- `ai/provider.js` gains SHIFT options: JSON mode, `systemInstruction` and the deadline split. The restaurant and
  clinic call shape is pinned by `tests/providerContract.test.js`.
- `services/whatsapp.js` gains `sendText` / `sendInteractiveButtons`, which never throw and classify errors, and
  reads `GRAPH_API_VERSION` at call time.
- `@google/generative-ai` is pinned to `0.24.1` (D14).
- `cloudbuild.yaml` gains only `--no-cpu-throttling` (D3, matches today's setting, no min instances).

No Prisma migration (D6). Restaurant, clinic and external-mode behaviour is unchanged apart from persist-before-200.

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
- [ ] Check `shift-status` again: `received_backlog: 0`, `ambiguous: 0`.

## Rollback

Stop at the first step that fixes it (runbook §7):

1. `SHIFT_BOT_LIVE=0`: save-only, test numbers still answered. No deploy needed.
2. `ai_config.reply_mode = "external"`: the bot sends nothing, messages are still saved and visible in the Inbox.
3. `git revert` the merge commit on `main`: Cloud Build redeploys PR #19's code.
   - No migration to undo.
   - Rows saved as `received` / `awaiting_staff` / `answered` stay in the DB and are simply ignored by the old code.
   - Also remove `--no-cpu-throttling` only if you want to change CPU allocation; it matches today's setting.
