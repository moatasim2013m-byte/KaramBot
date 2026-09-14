# Karam sales bot — implementation decisions that override the plan (2026-09-14)

`sales-bot-implementation-plan.md` (rev. 2) was written without two facts about production. It also leaves several
owner decisions open. This file is authoritative wherever it disagrees with the plan, the design doc or the prompt doc.
Decisions marked **(default)** were taken without the owner and are reversible by config.

## Production facts (verified 2026-09-14)

1. **The SHIFT bot is live for every sender today.** Business `shiftc6f194e723be82b9b363` has `ai_config = {}`
   (no `reply_mode`), `business_type = 'shift'`, and PR #19's single-prompt workflow replies to everyone. The plan's
   premise "the SHIFT number answers nothing, keep `reply_mode='external'` through PR2" is wrong.
   - Only one conversation exists: the owner's test number `962796381676` (currently `human_takeover`).
   - Ads have not started.
   - The other tenant ("My Restaurant", phone_number_id `1094591410406062`) is the owner's brother's project in
     `reply_mode='external'` (forwards to Make). Its behaviour must not change, except that its inbound message is
     now persisted before the webhook returns 200.
2. **Cloud Run `karambot` already has CPU always allocated** (`run.googleapis.com/cpu-throttling: false`, set by
   hand on revision `karambot-00055-skl`). `gcloud run deploy --image` preserves it. `min-instances` is 0.
3. Existing inbound `Message` rows have `status = 'delivered'`. Outbound rows have `sent | delivered | read | failed`,
   updated by the status webhook through `meta_message_id`.
4. Only the SHIFT business sends WhatsApp messages from this service. The external-mode tenant only forwards.
5. The host has 4 CPUs and a nearly full `/home` disk. `backend/node_modules` and `frontend/node_modules` are
   symlinks into `/tmp`. Never run `npm install` inside the repo. Never write large files under `/home`.

## Decisions

| # | Topic | Decision |
|---|---|---|
| D1 | Go-live gate | `SHIFT_BOT_LIVE` **unset means live** (preserves today's behaviour). `SHIFT_BOT_LIVE=0` makes the SHIFT number save-only for everyone except test numbers. Test numbers = `ai_config.test_numbers` ∪ env `SHIFT_TEST_NUMBERS` (comma-separated digits). `reply_mode='external'` keeps its existing meaning for every business. |
| D2 | Prompt rollout | PR1 keeps the current prompt, extended with the new actions. PR2's prompt v2 is live on deploy. `SHIFT_PROMPT_V1=1` falls back to the PR1 prompt without a deploy. |
| D3 | Cost **(default)** | **No `--min-instances=1`** (the owner runs on a $5/month budget alert and asked for zero monthly cost). `cloudbuild.yaml` gains only `--no-cpu-throttling`, which matches today's setting. A Cloud Scheduler job calling `POST /api/internal/sweep` every minute is the primary sweep trigger, and an in-process `setInterval` runs as well. |
| D4 | Domain | **`https://shifts-ai.com` is the official domain.** Every customer-visible link in the backend comes from one constant `SITE_URL = process.env.SHIFT_SITE_URL \|\| 'https://shifts-ai.com'` (in `backend/src/config/site.js`). Nowhere in backend code, prompts, acks or tests may `shifts-ai.store` appear. The canonical intro says `shifts-ai.com`. Privacy link: `${SITE_URL}/privacy`. Sector pages: `${SITE_URL}/clinics`, `/restaurants`, `/online-stores`, and the `/en/...` variants. |
| D5 | Batch selection | New SHIFT inbound rows are saved with `status = 'received'`. **The batch is inbound rows with `status = 'received'`**, never `status <> 'answered'`, which would sweep up all history. The inbound status of restaurant, clinic and external tenants is unchanged (`'delivered'`). Inbound values for SHIFT are `received → answered \| awaiting_staff \| skipped` (`skipped` = reaction, opt-out command, or outside window). |
| D6 | No migration | No Prisma migration and no new unique constraints. Outbound de-duplication: the reply lease, plus a check for an existing outbound row with `raw_payload->>'batch_key' = <batch key>` before sending. The batch key is the id of the newest inbound in the batch plus the part index. |
| D7 | Alerts **(default)** | `STAFF_ALERT_WEBHOOK_URL` is optional. When set, POST JSON `{text, reason, conversationId, businessId}`, where `text` is Slack/Discord compatible. Also `ai_config.alert_wa_numbers` (digits array): send a WhatsApp text to a staff number only if that number has a conversation with this business with `last_inbound_at` inside 24 h; otherwise skip and log. Alerts never throw into the reply path. `/api/internal/shift-status` reports `alert_channel_configured`. |
| D8 | Team hours **(default)** | When `ai_config.team_hours` is missing: `{days:[0,1,2,3,4], from:'09:00', to:'18:00', tz:'Asia/Amman', closures:[]}` (Sunday–Thursday). When `ai_config.contact` is missing, omit the contact segment. Never print an empty segment. |
| D9 | Call wording **(default)** | «مكالمة قصيرة مع الفريق». Never «15 دقيقة». |
| D10 | Graph | `GRAPH_API_VERSION` defaults to `v24.0`. Don't call the Business Profile API from code. |
| D11 | Samples **(default)** | PR2 sends a sector image only if that sector is in `ai_config.samples_vetted` or env `SHIFT_SAMPLES_VETTED`. Otherwise `SEND_SAMPLE` falls back to role-play setup. Asset base: `process.env.SHIFT_SAMPLES_BASE \|\| ${SITE_URL}/assets/samples`. Rendering and deploying the PNGs is a separate marketing step, not part of the backend PRs. |
| D12 | Webhook | `routes/whatsapp.js` persists **inbound messages and conversation counters** inside a 4 s budget, then returns 200. Persist failure or timeout returns 500 so Meta retries. Dedup relies on the unique `meta_message_id`. Status updates, forwarding (external mode), AI work and sends all happen after the response. The persist step must be idempotent under retries. |
| D13 | Media (PR1) | For SHIFT, image, audio, video, document and sticker messages join the batch as a placeholder line. The reply follows the design («وصلتني رسالتك الصوتية 🙏 هون بالمحادثة بقرأ النص بس — ممكن تكتبلي المطلوب بسطر؟»). PR2's `SHIFT_MEDIA` defaults to `0`. |
| D14 | Model | `@google/generative-ai` is pinned to `0.24.1` (already in `package.json` and the lock). The code default model is `gemini-3.6-flash`, and `GEMINI_MODEL` overrides it. Restaurant and clinic callers keep working unchanged. |
| D15 | Scope boundaries | Build agents do **not** commit, push, deploy, call Meta/Gemini/OpenRouter, touch the production DB or Cloud Run, or edit `marketing/`. Tests never hit the network. |
| D16 | Existing tests | All 10 existing suites (103 tests) must stay green. Tests whose asserted behaviour the design deliberately changes (the SHIFT handoff turning AI off) are updated, not deleted, with the new expectation. |

## Addendum — decisions from the GPT-6 external review (2026-09-14, evening)

GPT-6 (openai/gpt-6-astra-pro via OpenRouter) reviewed the PR1 source diff after two internal review rounds; its
report is in `docs/bot/reviews/pr1-gpt6-2026-09-14.md`. These decisions settle the trade-offs it raised.

| # | Topic | Decision |
|---|---|---|
| D17 | Send correlation | Every bot/system outbound (replies, fallbacks, acks, claim acks, sweeper notes) is an **intent row** created before the Graph call, and its row id is sent as WhatsApp's `biz_opaque_callback_data` (≤512 chars; echoed in status webhooks). Status webhooks reconcile **only** by that echoed id (or by an exact `meta_message_id`); recipient/time guessing is removed. |
| D18 | Unknown send outcome | Delivery is **at most once, never silent**. Retry immediately only on errors that prove Graph did not accept the message (4xx validation/auth/rate-limit codes documented as rejections, connection refused/DNS before a request was written). A timeout or a generic 5xx is `ambiguous`: no immediate retry. An `ambiguous` or `sending` intent whose echoed status webhook has not arrived within 2 minutes is treated as **not delivered**: its inbound rows go back to `received` once (retry budget 1 per batch key), and if that retry is also unconfirmed the rows become `awaiting_staff` with `needs_team.reason='unsent_reply'` (status `pending`, Inbox «بدون رد» badge, alert). Inbound rows are marked `answered` only when a wamid was returned or a `sent/delivered/read` status was echoed for the intent. |
| D19 | Async delivery failure | A `failed` status for a covering intent requeues its inbound rows once (same retry budget as D18); a second failure → `awaiting_staff` + `needs_team.unsent_reply` + alert. Billing codes keep their banner. |
| D20 | Lease fencing | `renewLease` succeeds only for the matching **unexpired** token; any failed renewal aborts the run. Right before every Graph call the worker re-verifies lease ownership and human state in one conditional statement; failure aborts before sending. Conditional state writes that affect 0 rows abort the send. |
| D21 | Staff vs bot | Inbox `/send` and `/claim` write `human_active_until` / takeover state **before** calling Graph. The batcher's pre-send check (D20) therefore sees it. Sweeper notes and button answers use the same pre-send check. |
| D22 | Pause expiry | When `human_active_until` passes and the conversation is not claimed / `human_takeover` / `ai_enabled=false`, the sweeper moves its `awaiting_staff` rows back to `received` (then normal batching answers them). Closer detection uses an explicit phrase list (شكرًا، تمام، ok، 👍، مشكور، يعطيك العافية…), never word count. |
| D23 | Deterministic commands | Opt-out, reactions and button taps are handled inside the leased worker from durable `received` rows, so a crash before handling is recovered by the sweeper with the same deterministic logic, never by the AI. Opt-out state and its ack intent are written before inbound rows leave `received`. |
| D24 | Persist atomicity | `persistInbound` inserts/claims the row and updates conversation counters in one Prisma `$transaction` (short, PgBouncer-safe). Non-SHIFT rows are claimed as `processing` and set to `delivered` after forward/workflow processing; the sweeper re-processes `processing` rows older than 2 minutes (forward/workflow) once, then logs. |
| D25 | Cross-instance debounce | Each inbound sets `metadata.batch_due_at` (DB time + quiet window, capped). A timer that fires before `batch_due_at` reschedules; the sweeper respects it. |
| D26 | Honest acks | Capture/handoff acks are built from the state that was actually persisted (the result of `saveLead` / conditional writes). If a staff-owned field blocks the change, the ack says the request was passed to the team, not that the time was changed. A failed save aborts the ack. |
| D27 | Inbox editor | `LeadCard` is keyed by conversation id; PATCH lead resolves `needs_team` and changes `status` in one conditional statement that checks the same `needs_team.at`. |
