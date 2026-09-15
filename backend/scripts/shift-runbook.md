# SHIFT sales bot — operations runbook (PR1)

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

Staff WhatsApp numbers for alerts (a number only receives alerts while it has messaged the SHIFT number in the last
24 h):

```sql
UPDATE businesses SET ai_config = ai_config || '{"alert_wa_numbers": ["9627XXXXXXXX"]}'::jsonb WHERE id = 'shiftc6f194e723be82b9b363';
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

## 7. Rollback order

Stop at the first step that fixes the problem:

1. **Save-only:** `SHIFT_BOT_LIVE=0` (section 2). Messages are saved, only test numbers get replies.
2. **Forward-only:** `reply_mode = "external"` (section 3). The bot sends nothing at all.
3. **Code:** `git revert` the PR merge commit and let Cloud Build redeploy.
