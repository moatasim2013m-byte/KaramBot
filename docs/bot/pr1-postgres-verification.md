# PR1 on real PostgreSQL behind PgBouncer — verification (2026-09-15)

Until now every PR1 test ran against the in-memory fake (`backend/tests/helpers/fakeDb.js`). This run executes PR1's
raw SQL, the persist transaction and the send-intent protocol against **postgres:16 behind PgBouncer 1.25.2 in
transaction pool mode**, the same shape as production (Neon pooler host, Prisma 5.22, `DATABASE_URL` with only
`sslmode`, no `pgbouncer=true`). Only axios (Graph, forwards, alert webhooks) and the Gemini SDK are mocked. Nothing
here touches the production database or Cloud Run.

## How to run

```bash
export PATH=/usr/local/nvm/versions/node/v24.20.0/bin:$PATH   # this host
backend/scripts/pg-integration.sh          # up → schema → 3 passes → down (teardown also on failure)
backend/scripts/pg-integration.sh up       # keep containers for iterating
PG_PASSES=plain backend/scripts/pg-integration.sh test
backend/scripts/pg-integration.sh down
```

What the script does (no npm install; ports bound to 127.0.0.1 only; private network `karambot-pgit`):

```bash
docker network create karambot-pgit
docker run -d --name karambot-pgit-postgres --network karambot-pgit -p 127.0.0.1:55432:5432 \
  -e POSTGRES_PASSWORD=pgit_local_only -e POSTGRES_DB=karambot_it postgres:16
docker run -d --name karambot-pgit-pgbouncer --network karambot-pgit -p 127.0.0.1:56432:5432 \
  -e DATABASE_URL=postgres://postgres:pgit_local_only@karambot-pgit-postgres:5432/karambot_it \
  -e AUTH_TYPE=scram-sha-256 -e POOL_MODE=transaction -e MAX_PREPARED_STATEMENTS=1000 \
  -e DEFAULT_POOL_SIZE=4 -e MAX_CLIENT_CONN=200 edoburu/pgbouncer:latest
# schema on the DIRECT port
DATABASE_URL='postgresql://postgres:pgit_local_only@127.0.0.1:55432/karambot_it?sslmode=prefer' \
  npx prisma db push --skip-generate
# suite on the PGBOUNCER port
PG_INTEGRATION_URL='postgresql://postgres:pgit_local_only@127.0.0.1:56432/karambot_it?sslmode=prefer' \
  npx jest tests/integration --runInBand --forceExit
```

`DEFAULT_POOL_SIZE=4` is deliberately smaller than Prisma's client pool, so client connections really share server
connections and prepared statements have to survive PgBouncer. `sslmode=prefer` keeps production's "only sslmode" URL
shape without TLS on the local containers.

Passes (`PG_PASSES`, default `plain tz flag`):

| Pass | URL / DB setting | Result |
|---|---|---|
| `plain` | PgBouncer port, `?sslmode=prefer` (production shape) | 34/34 |
| `tz` | same, `ALTER DATABASE … SET timezone='Asia/Amman'` | 34/34 (failed before fix 1) |
| `flag` | same as plain + `&pgbouncer=true` | 34/34 |

Extra runs done by hand while the suite grew (not in the script): the direct postgres port (all tests of that version
passed), `&connection_limit=1` and `=3` (all tests of that version passed, plus the 60-delivery test on its own), and the
`MAX_PREPARED_STATEMENTS=0` control described below.

The suite is `backend/tests/integration/pg.test.js`. It is `describe.skip` unless `PG_INTEGRATION_URL` is set and
requires Prisma lazily, so a plain `npx jest` never loads the engine or needs a database: **658 passed, 35 skipped**
(34 integration + the existing `auth.test.js` skip; the baseline was 654 passed, the 4 new tests are listed under the
fixes). It TRUNCATEs `messages, conversations, users, businesses` before every test — never point it at a real DB.

## Coverage

**db/jsonb.js (every export)**
- `patchJson`: sibling preservation, `remove`, `ifVersion` match / mismatch / missing lead (= 0), empty patch → no SQL,
  unknown id, bad identifier; 20 concurrent writers of different keys all survive.
- `mergeObjectKey`: `@>` match incl. `null` values, merge keeps other fields, non-object / missing key → false (no
  resurrection).
- `claimFlag`: once only, nested path requires an object parent (parent not created), 10 concurrent → exactly one.
- `claimValue`: 10 concurrent same value → one; numbers compare as text; `null` on a missing key → no write.
- `incrementCounter`: 25 concurrent → +25 with 25 distinct returned values; new key; unknown id → null.
- `acquireLease` / `renewLease` / `releaseLease`: 10 concurrent acquirers → exactly one; re-entry by the same token;
  release by another token refused; an expired lease is acquirable; **renew of an expired lease with its own token fails**.
- `preSendCheck`: no-lease no-op keeps `updated_at`; lease held (renews) / other token / expired; `human_takeover`;
  `ai_enabled=false`; `human_active_until` future (refuse) / past / null; `humanGuard:false`; opt-out after / before /
  equal to `optedOutSince`, including a Postgres-written `to_jsonb(now())` timestamp; claim fences (text vs number,
  missing path, bad column).
- `touchBatchDue`: DB-time delay, cap from `batch_first_at`, past deadline starts a new burst, unknown id → null.
- `resolveNeedsTeam`: match mismatch keeps `pending`; resolves + `pending → open` in one statement; already resolved →
  false; `human_takeover` status kept; no needs_team → false; requires a match.
- `writeConversationState`: CASE against the stored entry (missing, lower / equal / higher priority, unknown stored reason
  → default priority, resolved, claimed), `RETURNING` of the stored `{reason, at}`, `currentState` undefined / null,
  `human_takeover` → `ok:false` and nothing written, null candidate + empty priorities.
- D27 race, 30 rounds of concurrent «تم التواصل» on the old request vs the bot recording a higher-priority one: the
  conversation always ends `pending` with the new, unresolved request.
- Timestamps: Prisma `created_at`, raw-SQL `updated_at` and jsonb instants stay UTC under a non-UTC session TimeZone.

**messageProcessor**
- `persistInbound`: 6 concurrent deliveries of one message for a new customer → one conversation, one row, `unread_count`
  1, exactly one `created/claimed` item; 8 concurrent different messages → counted once each, `last_inbound_at` = newest;
  60 concurrent deliveries (10 customers × 3 messages × 2 retries) → 30 rows, exact counters (also with
  `connection_limit=1`); a counter update failing inside Postgres (int4 overflow) rolls the row back and the retry saves
  it; a U+0000 in the text / contact name (fix 2).
- `reprocessStuckInbound`: selection by `created_at` for `processing` and `updated_at` for `reprocessing`, young rows
  untouched, external forward re-run (axios) → `delivered`, abandoned `reprocessing` → given up, SHIFT row → `received`;
  two concurrent sweeps re-run a row once.
- Signed `POST /api/whatsapp/webhook` (supertest): the row exists when 200 returns; a Meta retry is a duplicate; the
  post-response `touchBatchDue` ran.

**replyBatcher**
- `dispatchIntent`: intent row is `sending` when Graph is called, its id is `biz_opaque_callback_data`, `batch_key`
  `${key}:i`, rows `answered`; the same batch key again → `deduped`, no Graph call; refused pre-send check → `cancelled`,
  no Graph call, rows stay `received`; timeout → `ambiguous` intent + `unconfirmed` rows.
- `applyIntentStatus` through `processInboundMessage` (status webhook with the echoed id): `delivered` + wamid, rows
  answered, never regresses, `read` advances; a wamid already held by another row (unique violation, P2002 path).
- D19 failed status on a sent covering intent: requeue once, the second failure escalates (`awaiting_staff`,
  `pending`, `needs_team.unsent_reply`).
- `reconcileUnconfirmedIntents`: young intents untouched; first → `requeued`; second for the batch key, two reconcilers
  concurrently → exactly one escalation.
- `runBatch` end to end with mocked Gemini (`FLAG_FOR_TEAM` + lead): lease, `writeConversationState`, `saveLead`
  (version 1), intent `sent`, rows answered, lease released; a second run → `no_batch`. Two runs racing on one burst →
  one `lease_busy`, one generation, one Graph send. Opt-out row: opt-out state and ack before rows leave `received`,
  no model call, other queued rows skipped.

**shiftSweeper**
- One `runSweep` over real rows: unconfirmed requeue, expired pause requeue, SLA note (claim inside needs_team, intent,
  done mark), awaiting-staff note (claimValue, metadata siblings kept), window flag, unanswered alert; a second pass sends
  nothing. Two sweeper instances (separate module registries, one DB) at once: every note, flag and alert exactly once.
- `getShiftStatus` counts.

**routes/inbox.js**
- `PATCH /conversations/:id/lead`: versioned edit (409 on a stale version), `requested_time_change` removed via `remove`,
  «تم التواصل» resolves only the request it matches.
- `POST /conversations/:id/claim`: two concurrent clicks → one ack (`sent` + `skipped`), takeover + `human_active_until`
  + `needs_team` merge (keeps `sla_note_sent_at`), claim ack intent attributed to the staff user (real FK).

## Bugs found and fixed

1. **Raw SQL stored `updated_at` in the session TimeZone** — `backend/src/db/jsonb.js` (all 12 statements; the column is
   Prisma's `timestamp(3)` *without* time zone holding UTC). `"updated_at" = now()` converts a timestamptz with the
   session TimeZone, so on a database or role whose TimeZone is not UTC every jsonb write stamped local wall time
   (Asia/Amman: 3 h in the future). Neon defaults to UTC, so production is not visibly affected today and nothing reads
   `conversations.updated_at` for logic, but the value is wrong the moment the setting changes.
   Fix: one fragment `UPDATED_AT = "updated_at" = timezone('UTC', now())` (jsonb.js:26) used by every statement.
   Tests: `pg.test.js` "timestamps stay UTC whatever the session TimeZone" (fails on the `tz` pass without the fix);
   `jsonb.test.js` "every statement writes updated_at as timezone(UTC, now())".
2. **A U+0000 in an inbound message could never be persisted** — `backend/src/services/messageProcessor.js`
   `persistInbound` loop (was lines 259–261). Postgres rejects NUL in `text` (22021) and in `jsonb` (22P05); the insert
   threw on every Meta retry, the webhook answered 500 until Meta gave up, and the message was never stored or answered.
   The fake accepted it. Fix: `withoutNul()` (messageProcessor.js:96–112) strips U+0000 from the stored copy of the
   message and contact (messageProcessor.js:279–280); the external-mode forward still sends Meta's original `value`.
   Tests: `pg.test.js` NUL case; `webhookProcessor.test.js` "a U+0000 … is dropped before insert".

### fakeDb corrected where it disagreed with Postgres/Prisma
- Rejects U+0000 in `create` / `update` / `updateMany` data and in `patchJson` / `mergeObjectKey` /
  `writeConversationState`, like Postgres (`fakeDb.test.js` "U+0000 … is rejected").
- Honors `select` (only the selected fields are returned, like Prisma); it used to return full rows, which would hide
  code reading a field it did not select. The whole suite stays green with it, so no such read exists today
  (`fakeDb.test.js` "select returns only the selected fields"). `pr1-contracts.md` §2.2 still says `select` is ignored.

No other SQL defect was found: every jsonb statement, the persist transaction and the conditional writes behave on
Postgres exactly as the fake modelled them (row locks + READ COMMITTED re-evaluation give the once-only semantics).

## Does production need `pgbouncer=true`?

**No, as long as Neon's pooler keeps protocol-level prepared statement support** (`max_prepared_statements > 0`, which
Neon's PgBouncer has; production already runs this URL). Evidence:

- With `max_prepared_statements=1000` the suite passes **without** the flag (production shape) and **with** it.
- Control run against a PgBouncer with `MAX_PREPARED_STATEMENTS=0` (PgBouncer 1.25's default is 200, so it must be set
  explicitly): without the flag 32 of 34 tests failed with `ERROR: prepared statement "sN" does not exist` (26000); with
  `pgbouncer=true` all passed.

So the flag is not required, but it is a safe, tested switch that removes the dependency on the pooler setting (cost: no
statement cache — every query is parsed again). Interactive transactions (`persistInbound`) work in both modes.

## Residual risks

- **Neon cold start vs the persist budget.** `persistInbound` uses an interactive transaction with `maxWait: 2000,
  timeout: 4000` inside the 4 s webhook budget. A suspended Neon compute (min-instances 0 on both sides) can take longer
  to accept the first connection; the webhook then answers 500 and relies on Meta's retry. Not reproducible locally.
- **Clock skew between JS and DB time.** `human_active_until`, `released_at`, `marketing_opted_out_at` and the
  reconcile/sweep cutoffs are written or computed with the instance clock and compared with DB `now()` in SQL; leases and
  `batch_due_at` use DB time only. Skew of seconds is harmless at the 2/30-minute scales used; minutes would not be.
- **Order of ties.** `collectBatch` orders by `created_at` only (ms precision). Postgres returns rows with an equal
  `created_at` in no fixed order (the fake keeps insertion order), so the batch key (newest row id) of a burst with a
  millisecond tie can differ between two runs. `recoverCovered` matches on `batch_ids`, not the key, so this does not
  cause a resend; only the prompt's line order and the dedupe key can change.
- **Schema drift.** The containers use `prisma db push` of `schema.prisma`; production was built by migrations/
  `neon-http-migrate.js`. Column types, the `meta_message_id` unique index and the FKs were not compared with the live
  DB (not touched by design).
- **Neon's pooler is not this PgBouncer.** Version, `query_wait_timeout`, pool size and TLS differ; TLS (`sslmode=require`)
  was not exercised.
- **Outbound NUL.** A model reply or staff text containing U+0000 still fails its row write: the bot path fails safely
  (no intent row → no send, counted as a failure), but `/send` writes its row after Graph accepted the message and would
  answer 500 for a message that was delivered.
- **Fake transaction isolation.** The fake's interactive transaction has no isolation; the real concurrency paths are now
  covered only by this suite, which is not part of the default `npx jest` run.
- `prisma migrate` through the pooled URL is unsupported (session advisory locks); keep schema changes on a direct URL.
