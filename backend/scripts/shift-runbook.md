# SHIFT sales bot — operations runbook (PR1 + PR2)

**The owner runs these commands, not Claude.** Build agents never touch Cloud Run, Cloud Scheduler or the
production database. Every command below is copy-paste ready; replace nothing except where `$INTERNAL_SWEEP_TOKEN`
must be exported in your shell first.

- Service: Cloud Run `karambot`, region `europe-west1`, public URL `https://karambots.com`
- SHIFT business id: `shiftc6f194e723be82b9b363`
- Customer-facing site: `https://shifts-ai.com`

```bash
export INTERNAL_SWEEP_TOKEN='<the value set on the Cloud Run service>'
```

---

## 1. Status check

```bash
curl -s -H "Authorization: Bearer $INTERNAL_SWEEP_TOKEN" https://karambots.com/api/internal/shift-status
```

What to read in the JSON:

| Field | Healthy value |
|---|---|
| `workflow_active` | `true` when the bot should answer customers |
| `bot_live` | `false` means `SHIFT_BOT_LIVE=0` (save-only except test numbers) |
| `reply_mode` | `null` (bot answers) or `"external"` (forward-only, bot silent) |
| `alert_channel_configured` | `true` — staff alerts reach a webhook or a WhatsApp number |
| `received_backlog` | `0` — inbound messages older than 60 s still waiting for the bot |
| `awaiting_staff`, `pending` | conversations/messages the team still owes |
| `ambiguous` | outbound sends Meta never confirmed (check these by hand) |
| `nudges_pending` | planned follow-up nudges not yet sent or dropped (PR2; normal to be > 0) |
| `roleplays_active` | illustrative examples running now (PR2; they end silently after 15 min idle) |
| `sweep.at` | within the last ~1–2 minutes |

Responses: `503 sweep_not_configured` → `INTERNAL_SWEEP_TOKEN` is not set on the service; `401` → wrong token.

Trigger one sweep by hand:

```bash
curl -s -X POST -H "Authorization: Bearer $INTERNAL_SWEEP_TOKEN" https://karambots.com/api/internal/sweep
```

## 2. Save-only / live (env `SHIFT_BOT_LIVE`)

Unset means live (today's behaviour). `0` makes the SHIFT number save-only for everyone except test numbers.
Each env change creates a new revision.

Save-only:

```bash
gcloud run services update karambot --region=europe-west1 --update-env-vars SHIFT_BOT_LIVE=0
```

Live again:

```bash
gcloud run services update karambot --region=europe-west1 --remove-env-vars SHIFT_BOT_LIVE
```

## 3. `reply_mode` (database, both directions)

Forward-only (bot never replies, messages still saved and alerts still fire):

```sql
UPDATE businesses SET ai_config = jsonb_set(ai_config, '{reply_mode}', '"external"', true) WHERE id = 'shiftc6f194e723be82b9b363';
```

Bot replies again:

```sql
UPDATE businesses SET ai_config = ai_config - 'reply_mode' WHERE id = 'shiftc6f194e723be82b9b363';
```

## 4. Key-preserving `ai_config` edits

Always merge with `||`. **Never** rewrite the whole `ai_config`: that would drop `reply_mode`, `test_numbers` and
the other keys.

Test numbers (digits only, with country code, no `+`):

```sql
UPDATE businesses SET ai_config = ai_config || '{"test_numbers": ["962796381676"]}'::jsonb WHERE id = 'shiftc6f194e723be82b9b363';
```

Team hours (days: 0 = Sunday … 6 = Saturday; `closures` are `YYYY-MM-DD` dates):

```sql
UPDATE businesses SET ai_config = ai_config || '{"team_hours": {"days": [0,1,2,3,4], "from": "09:00", "to": "18:00", "tz": "Asia/Amman", "closures": []}}'::jsonb WHERE id = 'shiftc6f194e723be82b9b363';
```

Contact shown in handoff acks (omit either key to hide it):

```sql
UPDATE businesses SET ai_config = ai_config || '{"contact": {"phone": "<PHONE>", "email": "<EMAIL>"}}'::jsonb WHERE id = 'shiftc6f194e723be82b9b363';
```

Staff WhatsApp numbers for alerts. Inside a number's 24 h window (it messaged the SHIFT number in the last 24 h)
the alert is free-form text; outside it, or when the number never wrote, it is the approved utility template in
`alert_template` (without one, or while Meta has not approved it, that alert is skipped and logged):

```sql
UPDATE businesses SET ai_config = ai_config || '{"alert_wa_numbers": ["9627XXXXXXXX"]}'::jsonb WHERE id = 'shiftc6f194e723be82b9b363';
-- once `node scripts/create-alert-template.js --status` says APPROVED:
UPDATE businesses SET ai_config = ai_config || '{"alert_template": {"name": "staff_alert", "language": "ar"}}'::jsonb WHERE id = 'shiftc6f194e723be82b9b363';
```

New-message alerts («رسالة جديدة من عميل»): on by default whenever `alert_wa_numbers` is set. A customer's first
message alerts, then only a message after 30 min of silence from them (a burst is one alert); staff numbers never
alert. Turn off or tune:

```sql
UPDATE businesses SET ai_config = ai_config || '{"alert_new_messages": false}'::jsonb WHERE id = 'shiftc6f194e723be82b9b363';
UPDATE businesses SET ai_config = ai_config || '{"alert_new_message_quiet_min": 60}'::jsonb WHERE id = 'shiftc6f194e723be82b9b363';
```

Check the result:

```sql
SELECT ai_config FROM businesses WHERE id = 'shiftc6f194e723be82b9b363';
```

## 5. Cloud Scheduler sweep job (primary sweep trigger)

```bash
gcloud scheduler jobs create http karambot-sweep --location=europe-west1 --schedule="* * * * *" --uri=https://karambots.com/api/internal/sweep --http-method=POST --headers="Authorization=Bearer $INTERNAL_SWEEP_TOKEN"
```

The service also runs an in-process sweep every 60 s as a backup; overlapping sweeps are safe (every note and
alert is claimed once in the database).

## 6. Verify CPU allocation

`cloudbuild.yaml` deploys with `--no-cpu-throttling` (CPU always allocated, no min instances). Check:

```bash
gcloud run services describe karambot --region=europe-west1 --format='value(spec.template.metadata.annotations)'
```

Expect `run.googleapis.com/cpu-throttling: 'false'` in the output.

## 7. PR2 flags (prompt v2, role-play, nudges, media, samples)

Every flag is optional and read at call time; an env change applies on the next revision. Deploy defaults: prompt
v2 live, role-play on, nudges on, media off, no sample sector vetted.

| Env var | Unset | Set to | Effect |
|---|---|---|---|
| `SHIFT_PROMPT_V1` | prompt v2 | `1` | PR1 prompt and action list; also turns role-play off. Validators, buttons and nudges still run. |
| `SHIFT_ROLEPLAY` | on | `0` | no illustrative example; role-play taps get the sector page. Running examples end silently on the next sweep. |
| `SHIFT_NUDGES` | on | `0` | no follow-up nudge is planned or sent. Nudges already planned stay unsent. |
| `SHIFT_MEDIA` | off | `1` | voice notes and images are transcribed/read (needs the privacy-page media sentence first). |
| `SHIFT_SAMPLES_VETTED` | none | `clinic,restaurant` | sectors whose sample image may be sent, in addition to `ai_config.samples_vetted`. |
| `SHIFT_SAMPLES_BASE` | `https://shifts-ai.com/assets/samples` | an https URL | where `{sector}-square-v1.png` sample images are served from. |

Turn one off (example: nudges):

```bash
gcloud run services update karambot --region=europe-west1 --update-env-vars SHIFT_NUDGES=0
```

Back to the default:

```bash
gcloud run services update karambot --region=europe-west1 --remove-env-vars SHIFT_NUDGES
```

### Vetting a sample image (database, key-preserving)

Only vet a sector after its PNG is live at `SHIFT_SAMPLES_BASE` and the owner approved it. Replace `clinic` with
`restaurant`, `store` or `other`. The statement appends to the existing list with `||` and leaves every other
`ai_config` key untouched; the `WHERE` makes it a no-op when the sector is already there.

```sql
UPDATE businesses
SET ai_config = jsonb_set(ai_config, '{samples_vetted}', COALESCE(ai_config -> 'samples_vetted', '[]'::jsonb) || '["clinic"]'::jsonb, true)
WHERE id = 'shiftc6f194e723be82b9b363' AND NOT (COALESCE(ai_config -> 'samples_vetted', '[]'::jsonb) ? 'clinic');
```

Un-vet a sector (the bot falls back to the role-play setup or the sector page):

```sql
UPDATE businesses
SET ai_config = jsonb_set(ai_config, '{samples_vetted}', COALESCE(ai_config -> 'samples_vetted', '[]'::jsonb) - 'clinic', true)
WHERE id = 'shiftc6f194e723be82b9b363';
```

Check:

```sql
SELECT ai_config -> 'samples_vetted' FROM businesses WHERE id = 'shiftc6f194e723be82b9b363';
```

### Offline eval (no network, no production)

```bash
cd backend && node scripts/eval-shift.js            # every scenario (1–21), replay mode, report in a temp dir
cd backend && node scripts/eval-shift.js --scenario 1,5 --out ../docs/bot/eval
```

Exit code 1 means a hard gate failed. `--live` (real Gemini, prisma and Graph still faked) needs `EVAL_LIVE=1` and
`GEMINI_API_KEY`, exits 3 on a model 404, and never runs in `npm test`.

`--provider anthropic` runs the same scenarios on Claude (replay: a scripted Anthropic client; `--live`: the real API,
needs `EVAL_LIVE=1` and `ANTHROPIC_API_KEY`, and prints p50/p90 latency, tokens incl. cache reads and cost per call):

```bash
cd backend && node scripts/eval-shift.js --provider anthropic
cd backend && EVAL_LIVE=1 ANTHROPIC_API_KEY=… node scripts/eval-shift.js --provider anthropic --live
cd backend && OPENROUTER_API_KEY=… ANTHROPIC_API_KEY=… node scripts/sim-chat.js --customer moonshotai/kimi-k3 --persona restaurant --provider anthropic
```

## 7c. AI provider: Claude and failover (`AI_PROVIDER`, `AI_FALLBACK_PROVIDER`)

2026-09-19: Gemini answered `402 Payment Required — Your prepayment credits are depleted` on every call and the bot
sent only its apology line. With a fallback provider set, the SAME turn is retried on the other provider inside the
30 s deadline before any apology is sent, and staff get one `ai_failure` alert per provider per hour
(«رصيد Gemini خلص — البوت شغّال على Claude», or the reverse).

| Env var | Default | Meaning |
|---|---|---|
| `AI_PROVIDER` | `gemini` | Primary: `gemini`, `anthropic` (Claude) or `openai` |
| `AI_FALLBACK_PROVIDER` | unset (no failover) | Second provider: `gemini` / `anthropic` / `openai`. Missing key → warning, no failover |
| `ANTHROPIC_API_KEY` | — | Required when `AI_PROVIDER=anthropic` (startup fails in production without it) |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | Claude model id |
| `ANTHROPIC_THINKING` | `off` | `off` → `thinking: {type: "disabled"}` (latency) · `adaptive` → adaptive thinking |
| `ANTHROPIC_EFFORT` | `low` | `output_config.effort`: `low` / `medium` / `high` / `xhigh` / `max` |
| `ANTHROPIC_MAX_TOKENS` | `2048` (`4096` with adaptive) | Output cap per call; a `max_tokens` stop retries once with thinking off and twice the cap |
| `ANTHROPIC_STRUCTURED` | on | `0` → no structured outputs (JSON by prompt + the parser). A schema the API rejects turns it off by itself |
| `AI_PROVIDER_COOLDOWN_MS` | `300000` | After billing / auth / model-not-found, later turns skip that provider for this long |
| `AI_PROVIDER_ALERT_MS` | `3600000` | Minimum gap between two provider alerts for the same provider |
| `AI_FAILOVER_AFTER_TRANSIENT` | `2` | 429/5xx/529 in a row on one provider before the turn moves to the other |
| `AI_FAILOVER_MIN_MS` | `4000` | A timed-out call moves to the other provider only if at least this much deadline is left |

When the turn moves: billing (Claude: `400 credit balance is too low` / `402`; Gemini: `402` / prepayment credits
depleted), auth `401`/`403` (Gemini: `API key not valid`), model `404`, any other `400` (never retried on the same
provider), persistent overload after the transient retries, a timeout with ≥ 4 s left. A refusal / safety block does
NOT move: it gets the calm blocked line, as before.

Logs: every call writes `[ai] {"provider":"anthropic","model":…,"ms":…,"in":…,"out":…,"cache_read":…,"cache_write":…,
"finish":…}`; a switch writes `[AI] failover anthropic → gemini (billing)`; a hard failure writes `[ai] provider_issue {…}`.
`cache_read` should be several thousand tokens from the second SHIFT reply on (the static prompt is the cached prefix).

**Switch the bot to Claude with Gemini as fallback** (the secret must exist first):

```bash
printf '%s' 'sk-ant-…' | gcloud secrets create ANTHROPIC_API_KEY --replication-policy=automatic --data-file=- --project karam-bot
# (key rotation later: printf '%s' 'sk-ant-…' | gcloud secrets versions add ANTHROPIC_API_KEY --data-file=- --project karam-bot)
gcloud run services update karambot --region europe-west1 --project karam-bot \
  --update-secrets ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest \
  --update-env-vars AI_PROVIDER=anthropic,AI_FALLBACK_PROVIDER=gemini
```

If the deploy fails with a Secret Manager permission error, grant the service's runtime service account
`roles/secretmanager.secretAccessor` on the secret (`gcloud run services describe karambot --region europe-west1
--project karam-bot --format='value(spec.template.spec.serviceAccountName)'` shows which account).

Optional after the live check: `--update-env-vars ANTHROPIC_THINKING=adaptive` (quality) or `ANTHROPIC_EFFORT=medium`.

**Revert to Gemini** (keeps Claude as the fallback while its key is there):

```bash
gcloud run services update karambot --region europe-west1 --project karam-bot \
  --update-env-vars AI_PROVIDER=gemini,AI_FALLBACK_PROVIDER=anthropic
```

**No failover at all** (exactly the pre-change behaviour): `--remove-env-vars AI_FALLBACK_PROVIDER`.

Both providers are prepaid: failover buys time, not credit. Top up the one the alert names.

## 7b. Calendly booking (booking_mode)

Owner decision 2026-09-19: the bot books sales calls only through Calendly. Everywhere it used to offer slot buttons
it sends ONE WhatsApp `cta_url` message («احجز موعدك» / "Book a time") with a personalised link:
`calendly_url?name=<lead name>&a1=%2B962…&utm_source=whatsapp&utm_campaign=karam`. Sending the link books nothing.
The sweep (`calendly` step) lists the sales calendar (`SHIFT_SALES_CALENDAR_ID`, which Calendly writes into), and
only then stores the booking (source `calendly`), confirms on WhatsApp inside the 24 h window, and alerts staff.

Turn it on (key-preserving):

```sql
UPDATE businesses SET ai_config = ai_config || '{"calendly_url": "https://calendly.com/shift-ai/30min", "booking_mode": "calendly"}'::jsonb WHERE id = 'shiftc6f194e723be82b9b363';
```

Back to in-chat slot buttons (no deploy; Calendly bookings already on file keep their own change/cancel links):

```sql
UPDATE businesses SET ai_config = jsonb_set(ai_config, '{booking_mode}', '"inchat"', true) WHERE id = 'shiftc6f194e723be82b9b363';
```

Calendly event type must: be connected to the SAME Google calendar as `SHIFT_SALES_CALENDAR_ID`; have as its FIRST
invitee question a one-line text question «رقم الواتساب / WhatsApp number» (required) — `a1` pre-fills it; keep
Calendly's default event description (it carries the invitee's answers and the Cancel / Reschedule links).

- The detection cursor is `ai_config.calendly_sync` (written by the sweep with a compare-and-set; do not edit it by
  hand — deleting it makes the next sweep re-read the last 24 h, which is safe). `CALENDLY_SYNC=0` stops detection.
- Every Calendly event seen is logged as `[calendly] event shape {…}` (booleans and counts only). After the first
  real booking check that `phone`, `cancel_url` and `reschedule_url` are `true`.
- Staff alerts: `booking_booked` / `booking_rescheduled` / `booking_cancelled` (Calendly), `calendly_unmatched` (a
  booking with no WhatsApp conversation, e.g. from the website), `calendly_check` (name-only match — confirm by hand).
- `GET /api/internal/shift-status` shows `booking_mode`, `calendly_sync_enabled` and `calendly_sync_cursor`.

## 8. Rollback order

Stop at the first step that fixes the problem:

0. **AI provider:** `AI_PROVIDER=gemini` (section 7c) if Claude answers badly; the fallback stays as it is.
1. **One PR2 feature:** `SHIFT_NUDGES=0`, `SHIFT_ROLEPLAY=0`, `SHIFT_MEDIA=0`, or un-vet a sample sector (section 7).
2. **PR1 prompt:** `SHIFT_PROMPT_V1=1` (section 7).
3. **Save-only:** `SHIFT_BOT_LIVE=0` (section 2). Messages are saved, only test numbers get replies.
4. **Forward-only:** `reply_mode = "external"` (section 3). The bot sends nothing at all.
5. **Code:** `git revert` the PR merge commit and let Cloud Build redeploy.
