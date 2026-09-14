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
