# Karam sales bot — PR1 engineering contracts (2026-09-14)

**Audience:** the six build agents for PR1 (L1a, L1b, L2a, L2b, L3a, L3b). Each agent codes only against this file
and the modules of lower layers. Nobody talks to anybody. If this file and the code of a lower layer disagree, the
lower layer's code wins (it was built from this file first) — adapt, and report the difference.

**Precedence:** `implementation-decisions-2026-09-14.md` (D1–D16) > this file > plan (PR1) = design (§3, §6, §7, §13)
= prompt doc = eval doc. Every place where this file departs from the plan/design is listed in §11.

**Hard rules for every agent:** no commit, push, deploy, `npm install`, external API call, production DB or Cloud Run
access, no edit under `marketing/`. Node commands need `export PATH=$PATH:/usr/local/nvm/versions/node/v24.20.0/bin`.
Tests: `cd /home/moatasim2013m/KaramBot/backend && npx jest <files> --forceExit`. Tests never touch the network: mock
`../src/config/prisma`, `axios`, `@google/generative-ai`. CommonJS, 2-space indent, `'use strict'` optional (match the
file you edit), comments explain *why*. The string `shifts-ai.store` must not appear in any backend file or test (D4).
Restaurant, clinic, generic and external-mode behaviour stays byte-for-byte the same except D12 (persist before 200).
All 10 existing suites stay green (D16); the only assertions you may change are listed in §10.

---

## 0. Module map and ownership

| Layer | Agent | Files (create = C, modify = M, delete = D) | Tests owned |
|---|---|---|---|
| 1 | L1a | C `backend/src/config/site.js` · M `backend/src/ai/provider.js` · M `backend/src/services/whatsapp.js` · M `backend/src/utils/serviceWindow.js` · C `backend/src/services/alerts.js` | C `tests/providerContract.test.js`, C `tests/provider.test.js`, C `tests/whatsapp.test.js`, M `tests/serviceWindow.test.js`, C `tests/alerts.test.js` |
| 1 | L1b | C `backend/src/db/jsonb.js` · C `backend/src/workflows/shift/lead.js` · C `backend/tests/helpers/fakeDb.js` | C `tests/jsonb.test.js`, C `tests/shiftLead.test.js`, C `tests/fakeDb.test.js` |
| 2 | L2a | D `backend/src/workflows/shift.js` · C `backend/src/workflows/shift/{index,actions,prompt,hours,acks,handoff,results,buttons,optout}.js` (not `lead.js`) | M `tests/shift.test.js`, C `tests/shiftButtons.test.js`, C `tests/shiftAcks.test.js` |
| 2 | L2b | M `backend/src/routes/inbox.js` · M `frontend/src/pages/InboxPage.jsx` | M `tests/inbox.test.js` |
| 3 | L3a | C `backend/src/services/replyBatcher.js` · M `backend/src/services/messageProcessor.js` · M `backend/src/routes/whatsapp.js` | C `tests/replyBatcher.test.js`, M `tests/webhook.test.js`, keep `tests/multiBusiness.test.js` green |
| 3 | L3b | C `backend/src/services/shiftSweeper.js` · C `backend/src/routes/internal.js` · M `backend/src/app.js` · M `backend/src/server.js` · M `backend/src/config/validateEnv.js` · M `cloudbuild.yaml` · C `backend/scripts/shift-runbook.md` | C `tests/sweeper.test.js`, C `tests/internal.test.js`, keep `tests/validateEnv.test.js` green |

Layer-2 agents run in parallel, so L2b tests `jest.mock` the L2a modules they import (`workflows/shift/acks`,
`workflows/shift/actions`).
Layer-3 agents run in parallel, so L3b tests `jest.mock('../src/services/replyBatcher')`.

Import graph (arrows = `require`; nothing may require upward or sideways beyond this):

```
config/site ──────────────┐
utils/serviceWindow ──> services/whatsapp ──> services/alerts
ai/provider               │                     │
config/prisma ──> db/jsonb ──> workflows/shift/lead
                                   │
workflows/shift/{hours,acks,optout,handoff,buttons,actions,prompt,results} ──> workflows/shift/index
                                   │
services/replyBatcher (requires shift/index, shift/lead, jsonb, whatsapp, alerts, serviceWindow, sseEmitter)
services/messageProcessor (requires replyBatcher, shift/optout, shift/buttons, shift/lead, + existing)
routes/whatsapp (requires messageProcessor) · routes/inbox (requires jsonb, shift/lead, shift/acks, whatsapp)
services/shiftSweeper (requires replyBatcher, jsonb, shift/hours, shift/acks, alerts, serviceWindow)
routes/internal (requires shiftSweeper) · app.js/server.js (mount + interval + boot log)
```

### 0.1 Out of scope for PR1 (deferred — do not build)

- Prompt v2 (`prompt.ar.js`), `context.js`, `objectives.js`, fenced data blocks, curated lead card, sector-trimmed knowledge → PR2.
- `SEND_SAMPLE`, `START_ROLEPLAY`, `END_ROLEPLAY`, samples/assets, role-play sandbox, `sector:*` list, `sample_*`, `quote_written`, `followup_yes/no`, consent capture → PR2.
- Media transcription / OCR (`SHIFT_MEDIA`); PR1 only has placeholder lines and a deterministic media ack (D13).
- All nudges and `followups.js` (`SHIFT_NUDGES` is not read in PR1); `followups` is only cleared on opt-out.
- Pre-fill parsing (`prefill.js`), `site_estimates` population, Arabizi detector beyond `pickLanguage` (§5.4).
- Validators (digit guard, claimed-action guard, identity check, question trim, Markdown strip, link filter) → PR2.
- 09:00 overnight digest, staff call tasks, browser `Notification`, `score_min` filter, 🔥 chip, «مثال جاري» chip.
- Cloud Scheduler OIDC auth (bearer only), `--min-instances=1` (D3), Business Profile API calls (D10), OpenRouter (PR3).
- Any Prisma migration or new unique constraint (D6).

---

## 1. Shared data model (no migration)

### 1.1 `Conversation` columns used

| Column | PR1 values / meaning |
|---|---|
| `status` | `open` · `pending` (needs the team; set on every needs_team event) · `human_takeover` (claimed, AI off) · `resolved` |
| `ai_enabled` | Only staff routes set it `false` (`/claim`, legacy `/takeover`). **The SHIFT workflow never writes `ai_enabled`.** |
| `current_state` | `opening\|discovery\|fit\|sample\|roleplay_setup\|roleplay\|objection\|close\|captured\|handoff\|closed` (PR1 writes only `opening, discovery, fit, objection, close, captured, handoff, closed`) |
| `assigned_staff_id` | set by `/claim` and legacy `/takeover`; cleared by `/release` and `/enable-ai` |
| `last_inbound_at`, `last_message_at`, `unread_count` | written by `persistInbound` (§7.2) before the webhook returns 200 |
| `workflow_data` (jsonb) | §1.3 — written **only** through `db/jsonb.js` for SHIFT conversations |
| `metadata` (jsonb) | §1.4 — written **only** through `db/jsonb.js` |

Rule: for a SHIFT conversation, no code path may pass `workflow_data` or `metadata` to `prisma.conversation.update`.
Restaurant/clinic keep their existing full-column `stateUpdate` writes.

### 1.2 `Message.status` (D5)

| Direction | Business | Values and transitions |
|---|---|---|
| inbound | restaurant, clinic, generic, any `reply_mode='external'` (incl. SHIFT if set) | `processing` (D24: inserted with the counters in one transaction) → `delivered` (today's value) once the forward/workflow ran or was attempted · `processing` older than 2 min → `reprocessing` (the one re-run by `reprocessStuckInbound`) → `delivered`; `reprocessing` older than 2 min → `delivered` + error log (given up) |
| inbound | SHIFT, not external | `received` → `answered` (a covering intent got a wamid, or an echoed `sent/delivered/read`) · `unconfirmed` (D18: the covering intent is `sending`/`ambiguous`; → `answered` on confirmation, → `received` once after 2 min, → `awaiting_staff` the second time) · `awaiting_staff` (human-active guard, or D18 escalation) · `skipped` (reaction, unsupported type, opt-out command — once its ack intent exists —, window closed, D1 gate closed) |
| outbound | bot (SHIFT) | `sending` (intent row; its id is `biz_opaque_callback_data`) → `sent` (Graph returned a wamid) → `delivered`/`read`/`failed` (status webhook) · `failed` (proven rejection) · `cancelled` (D20 pre-send check refused; never reached Graph) · `ambiguous` (timeout / generic 5xx, no wamid) → confirmed by the echoed status (`replyBatcher.applyIntentStatus`), or → `ambiguous_unreconciled` by `reconcileUnconfirmedIntents` after 2 min (`raw_payload.settled` = `requeued` \| `escalated` \| `unreconciled` \| `dropped` (an opt-out ack given up on)) |
| outbound | staff, ingest, restaurant/clinic bot | `sent` (unchanged) |

Only `replyBatcher` moves inbound SHIFT rows out of `received` (`deliverResult`/`dispatchIntent`, `runBatch` for
reactions and opt-outs, `applyIntentStatus`, `reconcileUnconfirmedIntents`; plus `messageProcessor` for `skipped` in D1
save-only mode and for `answered → unconfirmed` on a D19 `failed` status, and the staff `/send` route for
`awaiting_staff → answered`). Outbound bot intents with a `failed` status webhook keep `raw_payload.settled` /
`status_error`.

### 1.3 `workflow_data` shape (SHIFT)

```js
{
  lead: {                         // §4.2; every key optional
    name, business_name, sector /* clinic|restaurant|store|other */, sector_text, city,
    need: [], products: [], objections: [], customer_numbers: [], site_estimates: [],
    preferred_time: { text, start /* ISO */, end /* ISO */, tz: 'Asia/Amman', slot_id },
    language /* ar|en */, source: { type /* ctwa|site|direct */, attribution, referral, confidence /* confirmed|inferred */ },
    budget_note, interest /* hot|warm|cold */, score /* int */,
    _prov: { <field>: { source /* model|button|staff|referral */, source_msg_id, at, confirmed /* bool */ } },
    version /* int, starts at 1 on first write */
  },
  needs_team: { reason /* unsent_reply|quote|meeting|demo|person|complaint|unknown|ai_failure */, summary, at,
                resolved_at: null, sla_note_sent_at: null, claimed_at: null, claimed_by: null,
                // sweeper (GPT-6 #11), added on claim: sla_note_sent_at = claim time of the latest attempt,
                sla_note_attempt /* int */, sla_note_done_at /* note dispatched or skipped, alert sent */ },
  requested_time_change: { text, at } | null,   // D26: a call time the customer asked for that a staff-owned time blocked
  handoff: { requested_at, reason /* person|complaint|abuse */, tier /* 1|2 */ },
  slot_offers: [{ id: 'slot:2026-09-15T10:00+03:00/12:00', title: 'بكرا 10–12', issued_at }],
  capture_pending: { slot_id /* id|'other'|null */, time_text, at } | null,
  marketing_opted_out_at: null, human_requested_at: null, not_now_at: null,
  stage_before_takeover: null, disclosed_at: null, bot_turns: 0, followups: []
}
```

All timestamps are ISO-8601 strings. JS writers use `date.toISOString()`; SQL writers use `to_jsonb(now())`
(Postgres prints `2026-09-14T08:00:00.123456+00:00`). Readers always use `new Date(value)`.
`needs_team` priority (higher wins while unresolved): `unsent_reply (6) > person = complaint (5) > meeting (4) > quote (3) >
demo (2) > unknown (1) > ai_failure (0)`. A new needs_team replaces the stored one only if the stored one is missing, resolved, or
of strictly lower priority (helper `mergeNeedsTeam` in `shift/results.js`).

### 1.4 `metadata` shape (SHIFT)

```js
{
  lease_token: null, reply_lease_until: null,   // §4.1 lease; reply_lease_until written with DB now()
  batch_first_at: null, batch_due_at: null,     // D25: the burst's shared quiet deadline (jsonb.touchBatchDue, DB now())
  reply_failures: 0,                            // consecutive failed deliveries; ≥3 → sweeper stops retrying
  human_active_until: null,                     // staff send / SHIFT claim: now + 30 min, written BEFORE Graph (D21)
  billing_blocked_at: null,                     // last send failure with reason 'billing' (Inbox banner)
  window_flag_for: null, window_closing_at: null, // sweeper once-per-inbound claim + Inbox flag
  awaiting_note_for: null,                      // sweeper claim `${first silence row id}#${attempt}` (a bare id = PR1's first sweeper, handled)
  awaiting_note_claimed_at: null,               // written just before each claim; a claim older than 2 min with no intent is taken over
  awaiting_note_done_for: null,                 // silence whose note was dispatched (or skipped) and alerted
  unanswered_alert_for: null                    // sweeper once-per-inbound claim (inbound id)
}
```

### 1.5 Environment variables (all optional; nothing is added to `REQUIRED_IN_PRODUCTION`)

| Var | Default | Read by | Meaning |
|---|---|---|---|
| `SHIFT_BOT_LIVE` | unset = live | replyBatcher, shiftSweeper | `'0'` → SHIFT save-only except test numbers (D1). Any other value or unset → live. |
| `SHIFT_TEST_NUMBERS` | `''` | replyBatcher | comma-separated digits, unioned with `ai_config.test_numbers` |
| `SHIFT_SITE_URL` | `https://shifts-ai.com` | config/site | D4 |
| `GEMINI_MODEL` | `gemini-3.6-flash` | ai/provider | D14 |
| `GEMINI_TEXT_MODE` | unset | ai/provider | `'1'` → SHIFT prompt concatenated into the user turn (still JSON mode, same SDK) |
| `GRAPH_API_VERSION` | `v24.0` | services/whatsapp | D10; read at call time |
| `WA_TYPING_INDICATOR` | unset | services/whatsapp | `'1'` → typing indicator on mark-read |
| `SHIFT_BATCH_QUIET_MS` | `2500` | replyBatcher | base quiet window (short = 0.6×, long = 1.6×) |
| `SHIFT_BATCH_CAP_MS` | `10000` | replyBatcher | max wait from the first fragment |
| `WEBHOOK_PERSIST_BUDGET_MS` | `4000` | routes/whatsapp | D12 budget (tests set it low) |
| `INTERNAL_SWEEP_TOKEN` | unset | routes/internal | unset → 503; wrong → 401 |
| `STAFF_ALERT_WEBHOOK_URL` | unset | services/alerts | D7 |

`ai_config` keys read (never required): `reply_mode`, `forward_url`, `test_numbers` (digits[]), `team_hours`
(D8 default), `contact` `{phone, email}`, `alert_wa_numbers` (digits[]), `personality`.

---

## 2. Database access contract (so every in-memory mock agrees)

### 2.1 Allowed Prisma calls per module

No module in this PR may call `prisma.$queryRaw`, `$executeRaw`, `$queryRawUnsafe` or `$executeRawUnsafe` except
`db/jsonb.js`. No interactive `$transaction(async tx => …)` in new code; no Prisma JSON-path filters
(`raw_payload: {path: …}`) anywhere — filter JSON in JS after `findMany`.

| Module | Calls (model.method — where/data keys used) |
|---|---|
| `db/jsonb.js` | `$executeRaw` (tagged / `Prisma.sql`), `$queryRaw` (only `incrementCounter`) |
| `shift/lead.js` (`saveLead`) | `conversation.findUnique({where:{id}, select:{workflow_data:true}})` |
| `shift/index.js` | `message.findMany({where:{conversation_id}, orderBy:{created_at:'desc'}, take, select:{id,direction,text_body,sent_by_user_id,message_type}})` |
| `services/alerts.js` | `conversation.findFirst({where:{business_id, customer_wa_id}})`, `message.create` (alert outbound row) |
| `services/replyBatcher.js` | `conversation.findUnique({where:{id}})`, `business.findUnique({where:{id}})`, `message.findMany({where:{conversation_id, direction, status?, created_at?:{gt}}, orderBy:{created_at}, take})`, `message.findFirst({where:{conversation_id, direction:'outbound', sent_by_user_id:{not:null}}, orderBy:{created_at:'desc'}})`, `message.create`, `message.update({where:{id, status?:{in}}})` (P2025 = settled by a status webhook first), `message.updateMany({where:{id:{in}, status}})`, `message.updateMany({where:{id, meta_message_id:null}})`, `conversation.update({where:{id}, data:{current_state?, last_message_at?}})` (a status goes through `jsonb.writeConversationState`) |
| `services/messageProcessor.js` | existing calls + `$transaction(async (tx) => …, {maxWait, timeout})` (persist: `tx.message.create`, `tx.conversation.updateMany/update`), `message.findUnique({where:{id}})` / `({where:{meta_message_id}})`, `message.findMany({where:{conversation_id, direction:'outbound', created_at:{gte}}})`, `message.findMany({where:{direction:'inbound', status, created_at|updated_at:{lt}}, orderBy:{created_at}, take})`, `message.update({where:{id}, data:{status}})`, `message.updateMany({where:{id | id:{in}, status? | status:{in}, direction?}, data:{status, raw_payload?}})`, `conversation.findUnique({where:{id}})`, `conversation.findFirst({where:{business_id, customer_wa_id}})`, `business.findUnique({where:{id}, select})` |
| `routes/inbox.js` | existing calls + `message.findMany({where:{conversation_id:{in}, direction:'inbound', status:'awaiting_staff'}, select:{conversation_id:true}})`, `message.count({where:{business_id, direction:'inbound', status:'awaiting_staff'}})`, `message.updateMany({where:{conversation_id, direction:'inbound', status:'awaiting_staff'}})`, `user.findUnique({where:{id}, select:{name:true}})`, `conversation.findUnique({where:{id}})` |
| `services/shiftSweeper.js` | `business.findMany({where:{business_type:'shift', status:'active'}})`, `conversation.findMany({where:{business_id, status?, last_inbound_at?:{gte,lte}}})`, `conversation.findUnique({where:{id}})`, `message.findMany({where:{business_id, direction, status, created_at?:{lt}, conversation_id?:{notIn}}, orderBy:{created_at:'asc'}, take})`, `message.findMany({where:{conversation_id, direction:'outbound', status?:'ambiguous_unreconciled', created_at?:{gte}}})` (JS filter on `raw_payload`), `message.findFirst({where:{conversation_id, direction, sent_by_user_id?:{not:null}, created_at?:{gt\|gte}}, orderBy:{created_at:'desc'}})`, `message.updateMany({where:{conversation_id, direction:'inbound', status:'awaiting_staff', id?:{notIn}}, data:{status:'received'}})`, `message.count(...)`, `user.findUnique` |

### 2.2 `backend/tests/helpers/fakeDb.js` (owner L1b)

One in-memory database shared by a Prisma fake and a `db/jsonb.js` fake, so layer-2/3 tests exercise real module
logic without SQL. Usage (the helper is a per-test-file singleton because Jest shares the module registry inside one
file; never call `jest.resetModules()` in these files):

```js
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
const db = require('./helpers/fakeDb').getFakeDb();
beforeEach(() => db.reset());
```

API:

```js
getFakeDb() → {
  prisma,                       // fake PrismaClient (below)
  jsonb,                        // same exports as src/db/jsonb.js (§4.1), operating on the store
  store: { businesses: [], conversations: [], messages: [], users: [] },
  seed({ businesses, conversations, messages, users }), // fills defaults: id (cuid-like), created_at=clock.now(),
                                                         // updated_at, workflow_data:{}, metadata:{}, status defaults
  reset(),                      // empties the store, clock.set(null) (= real Date.now)
  clock: { now() → Date, set(dateOrNull), advance(ms) },  // "DB now()" for leases and created_at
  failNext(modelDotMethod, err) // e.g. failNext('message.create', Object.assign(new Error('x'), {code:'P1001'}))
}
```

Fake Prisma surface (exactly the calls in §2.1, nothing more):
- models `business`, `conversation`, `message`, `user` with `findUnique`, `findFirst`, `findMany`, `create`, `update`,
  `updateMany`, `count`; `conversation.findFirst/findMany` accept `include:{assigned_staff:…}` (returns
  `assigned_staff: {name}` or `null`); `select` is ignored (full rows returned).
- `where` support: scalar equality, `{in:[…]}`, `{not: x}` (incl. `{not:null}`), `{lt,lte,gt,gte}` on dates/numbers,
  `OR: […]`, nested AND by listing keys. `orderBy` single `{field:'asc'|'desc'}`, `take`, `skip`.
- `data` support: plain values, `{increment: n}`; `update` stamps `updated_at`; `message.create` throws
  `{code:'P2002'}` on a duplicate non-null `meta_message_id`; `conversation.create` throws P2002 on a duplicate
  `(business_id, customer_wa_id)`.
- `$transaction(arrayOfPromises)` → `Promise.all` in order. `$transaction(async (tx) => …)` (interactive, D24): `tx`
  exposes the same model methods (looked up on `prisma` at call time, so spies and `failNext` apply); every
  `create`/`update`/`updateMany` made through `tx` is journalled and undone in reverse order if the callback throws, like
  a Postgres rollback. No isolation (other code sees uncommitted writes). `$executeRaw`/`$queryRaw` throw
  `Error('fakeDb: raw SQL is only allowed inside db/jsonb.js')`.
- Returned objects are copies (mutating a result never changes the store).

`tests/fakeDb.test.js` covers: where operators, P2002 paths, lease semantics with `clock.advance`, `patchJson`
sibling preservation, `ifVersion` mismatch, `claimFlag`/`claimValue` once-only, interactive `$transaction` rollback.

---

## 3. Layer 1a — site, service window, WhatsApp, AI provider, alerts

### 3.1 `backend/src/config/site.js`

```js
const SITE_URL = (process.env.SHIFT_SITE_URL || 'https://shifts-ai.com').replace(/\/+$/, '');
const SITE_HOST = SITE_URL.replace(/^https?:\/\//, '');          // 'shifts-ai.com'
const PRIVACY_URL = `${SITE_URL}/privacy`;
const PRIVACY_SHORT = `${SITE_HOST}/privacy`;                     // used inside customer text
module.exports = { SITE_URL, SITE_HOST, PRIVACY_URL, PRIVACY_SHORT };
```
Evaluated at require time (env changes need a restart — same as every other env in this service).

### 3.2 `backend/src/utils/serviceWindow.js`

```js
isWithinServiceWindow(lastInboundAt, now = new Date(), { marginMs = 0 } = {}) → boolean
windowClosesAt(lastInboundAt) → Date | null                     // lastInboundAt + 24 h
const TWENTY_FOUR_HOURS_MS, REPLY_WINDOW_MARGIN_MS = 60 * 1000, NOTE_WINDOW_MARGIN_MS = 30 * 60 * 1000;
```
- `now` may be a `Date`, a number (epoch ms) or a function returning either (injectable clock).
- Inside ⇔ `0 ≤ now − last ≤ 24h − marginMs`; future timestamps stay inside; null/invalid → false. With
  `marginMs = 0` every existing test keeps passing.
- Replies to a customer message use `REPLY_WINDOW_MARGIN_MS`; sweeper notes use `NOTE_WINDOW_MARGIN_MS`.

### 3.3 `backend/src/services/whatsapp.js`

Keep every existing export and its behaviour (`validateSignature`, `sendTextMessage` → returns `res.data`, throws on
error; `sendButtonMessage`, `sendListMessage`, `sendTemplateMessage`, `parseInboundMessage`, `normalizePhone`).
`sendTextMessage` and `markAsRead` pass `timeout: LEGACY_TIMEOUT_MS` (15 s) to axios: D24 re-runs a restaurant/clinic
row still `processing` after 2 min, and a hung Graph connection must not outlive that (a re-run next to a live
delivery could send or order twice).
Changes:

```js
graphVersion() → process.env.GRAPH_API_VERSION || 'v24.0'      // read on every call; BASE_URL constant removed
graphBase() → `https://graph.facebook.com/${graphVersion()}`

markAsRead(phoneNumberId, accessToken, messageId, { typing = false } = {}) → Promise<boolean>   // never throws
  payload {messaging_product:'whatsapp', status:'read', message_id}
  + typing_indicator:{type:'text'}   only when typing === true && process.env.WA_TYPING_INDICATOR === '1'

assertInteractiveLimits(buttons, { body = '', footer } = {}) → void   // throws Error with err.code = 'INTERACTIVE_LIMITS'
  buttons: array length 1..3; each {id, title}; id non-empty, ≤ 256 chars, unique; title 1..20 code points
  (Array.from(title).length); body 1..1024 code points; footer (if given) ≤ 60 code points

sendText(phoneNumberId, accessToken, to, text, { timeoutMs = 10000, callbackData } = {}) → Promise<SendResult>          // never throws
sendInteractiveButtons(phoneNumberId, accessToken, to, body, buttons, { timeoutMs = 10000, callbackData } = {}) → Promise<SendResult>
  // calls assertInteractiveLimits first; a limits error returns {ok:false, reason:'invalid_payload'} without HTTP
// D17: every sender (also sendTextMessage, sendButtonMessage, sendListMessage, sendTemplateMessage via a trailing
// `{ callbackData }` argument) sets top-level `biz_opaque_callback_data: String(callbackData)` when given. A value over
// CALLBACK_DATA_MAX = 512 chars is not sent (logged): a cut id would correlate with nothing.

SendResult = { ok: true,  id: 'wamid…', error: null, reason: null, code: null, httpStatus: 200, retryable: false }
           | { ok: false, id: null, error: 'message', reason, code: <graph code|null>, httpStatus: <n|null>, retryable }

classifySendError(err) → { reason, code, httpStatus, retryable }
```

| Condition (axios error) | `reason` | `retryable` |
|---|---|---|
| Graph `error.code` ∈ {131042} (payment/eligibility), or `error.error_subcode` ∈ {2494010} | `billing` | false |
| code 131047 (re-engagement / outside 24 h) | `window` | false |
| code ∈ {130429, 131056, 80007} | `rate_limit` | false |
| code ∈ {131026, 131030} | `invalid_recipient` | false |
| code 190 or HTTP 401/403 | `auth` | false |
| `err.code` ∈ {`ECONNABORTED`, `ETIMEDOUT`, `ECONNRESET`} or `err.request && !err.response` | `ambiguous` | false |
| `err.code` ∈ {`ENOTFOUND`, `ECONNREFUSED`, `EAI_AGAIN`} | `network` | true |
| HTTP ≥ 500 without a code above (D18 / GPT-6 #4: a gateway 5xx can follow an accepted POST) | `ambiguous` | false |
| anything else | `rejected` | false |

Only `network` (the request never left this host) is retryable. The `server` reason no longer exists.

`sendButtonMessage` and `sendListMessage` call `assertInteractiveLimits` (lists: body only) before HTTP and keep
throwing. Delete the local `isWithinServiceWindow` and export `isWithinServiceWindow` from `../utils/serviceWindow`.
Move `sendTemplateMessage` above `module.exports` (no behaviour change).

### 3.4 `backend/src/ai/provider.js`

Exports: `generateAIReply`, `generateValidatedAIReply`, `extractJSON`, `validateAIResult`, `resolveModel`,
`DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash'`, `VALID_ACTIONS`, `CORRECTION_PROMPT`.

```js
resolveModel() → process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL

generateAIReply(systemPrompt, userMessage, history = [], opts = {}) → Promise<string>   // throws on error
validateAIResult(result, validActions = VALID_ACTIONS, { stages, nextSteps } = {}) → {valid, reason?, repairable?}
generateValidatedAIReply(systemPrompt, userMessage, history = [], opts = {}) → Promise<object|null>
```

`opts` (all optional; **absent opts = legacy restaurant/clinic path, unchanged**):

| opt | meaning |
|---|---|
| `validActions: Set\|string[]` | replaces `VALID_ACTIONS` |
| `correctionPrompt: string` | replaces `CORRECTION_PROMPT` on a validation retry |
| `jsonMode: boolean` | `generationConfig.responseMimeType = 'application/json'`, `temperature: 0.4`, `maxOutputTokens: 600` |
| `responseSchema: object` | added to `generationConfig` when `jsonMode` |
| `systemInstruction: boolean` | send `systemPrompt` as `systemInstruction` and `userMessage` as the only user turn (ignored when `GEMINI_TEXT_MODE==='1'`) |
| `deadlineAt: number` (epoch ms) | absolute deadline for all attempts (SHIFT passes `now + 18000`) |
| `firstAttemptMs: number` | default 10000 |
| `retrySystemPrompt: string` | prompt used on the retry (SHIFT passes the 6-turn-history variant) |
| `onRetry: () => Promise\|void` | awaited (errors swallowed) before the retry — batcher re-posts typing and renews the lease |
| `stages`, `nextSteps: string[]` | enable enum validation of `result.stage` / `result.next_step` |
| `conversationId: string` | only for the usage log |

Gemini call shapes (`@google/generative-ai@0.24.1`, required lazily inside `callGemini` so tests can mock it):

```js
// legacy (no opts) — pinned by tests/providerContract.test.js
genAI.getGenerativeModel({ model: resolveModel() });
model.generateContent(`${systemPrompt}\n\nرسالة العميل: ${userMessage}`);        // raced against a 15 s timeout
// SHIFT (jsonMode + systemInstruction, GEMINI_TEXT_MODE unset)
genAI.getGenerativeModel({ model: resolveModel(), systemInstruction: systemPrompt,
  generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 600, responseSchema } });
model.generateContent({ contents: [{ role: 'user', parts: [{ text: userMessage }] }] }, { timeout: attemptMs });
// SHIFT with GEMINI_TEXT_MODE=1: no systemInstruction; text = `${systemPrompt}\n\nرسائل العميل:\n${userMessage}`
```
Also race every call against `attemptMs` in JS (a mocked SDK ignores `timeout`); the timeout error message is
`Gemini timeout after ${attemptMs}ms`.

Usage log — exactly one line per Gemini attempt, success or failure:
`console.log('[ai] ' + JSON.stringify({model, ms, in, out, finish, conv, attempt, ok}))` where `in`/`out` come from
`response.usageMetadata.promptTokenCount` / `candidatesTokenCount` (null if absent), `finish` from
`response.candidates?.[0]?.finishReason` (null if absent), `attempt` is 1 or 2.

`validateAIResult` rules (existing rules unchanged, in this order): object; non-empty `reply` string; `action` (if
present) ∈ validActions; `extracted_items` (if present) array; `stage` (if present and `stages` given) ∈ stages →
else `{valid:false, reason, repairable:true}`; same for `next_step`. Extra fields are accepted. **Buttons are
sanitised, never a validation failure:** keep ≤ 3 entries that are `{id: non-empty string ≤ 256, title: string with
1..20 code points}`; drop the rest; non-array `buttons` → `[]`. `lead` that is not a plain object → `{}`;
`action_args` that is not a plain object → `{}`.

`generateValidatedAIReply` algorithm:
1. Legacy (no `deadlineAt`): identical to today — first call throws → `null` (no retry); invalid → one retry with
   `${userMessage}\n\n${correctionPrompt}`; still invalid → `null`.
2. Deadline mode: attempt 1 with `attemptMs = min(firstAttemptMs, deadlineAt − Date.now())`. If it throws (incl.
   timeout) or is invalid → if `deadlineAt − Date.now() < 1500` return `null`; else `await onRetry?.()`, attempt 2
   with `attemptMs = deadlineAt − Date.now()`, `retrySystemPrompt || systemPrompt`, and the correction prompt
   appended only when attempt 1 returned an invalid (not a thrown) result. Attempt 2 invalid but `repairable`
   (only stage/next_step wrong) → delete those fields and return the result. Otherwise `null`.
3. JSON mode parses with `JSON.parse(text)` first, then falls back to `extractJSON(text)`.
Never throws; logs `[AI]` errors as today.

### 3.5 `backend/src/services/alerts.js` (D7)

```js
const ALERT_REASONS = ['handoff','quote','needs_team','meeting','ai_failure','reply_failures','billing','sla_breached',
  'awaiting_staff','ambiguous_send','inbound_without_outbound','window_closing','hot_lead','unsent_reply'];

formatAlertText({ reason, business, conversation, summary }) → string
sendStaffAlert({ reason, business, conversation, summary = '', now = new Date() }) → Promise<{webhook, whatsapp}>
alertChannelConfigured(business) → boolean   // !!STAFF_ALERT_WEBHOOK_URL || ai_config.alert_wa_numbers non-empty
```
- Text (plain, Slack/Discord safe, no Markdown):
  `🔔 SHIFT bot — ${LABEL[reason]}\nالعميل: ${conversation.profile_name || '-'} (+${conversation.customer_wa_id})\n${summary}\nconversation=${conversation.id}`
  with `LABEL = {handoff:'طلب شخص من الفريق', quote:'طلب عرض سعر', needs_team:'يحتاج الفريق', meeting:'طلب مكالمة',
  ai_failure:'تعطّل رد البوت', reply_failures:'فشل الإرسال 3 مرات', billing:'واتساب موقف الإرسال — طريقة الدفع',
  sla_breached:'طلب بالقائمة من 15 دقيقة بدون استلام', awaiting_staff:'رسالة بانتظار الموظف من 10 دقائق',
  ambiguous_send:'إرسال غير مؤكد', inbound_without_outbound:'رسالة بدون رد من دقيقتين',
  window_closing:'نافذة الـ24 ساعة قربت تسكر', hot_lead:'عميل ساخن', unsent_reply:'رد البوت ما وصل — العميل بدون رد'}`
  (`unsent_reply`, D18/D19: the bot's reply stayed unconfirmed or failed twice).
- Webhook: if `STAFF_ALERT_WEBHOOK_URL` → `axios.post(url, {text, reason, conversationId, businessId}, {timeout: 5000})`
  → `webhook: 'sent' | 'failed'`; unset → `'skipped'`.
- WhatsApp: for each digits string in `business.ai_config.alert_wa_numbers`: `conversation.findFirst({where:
  {business_id: business.id, customer_wa_id: n}})`; if `isWithinServiceWindow(conv?.last_inbound_at, now)` →
  decrypt `business.wa_access_token` (`utils/tokenCrypto.decrypt`) and `sendText(business.wa_phone_number_id, token, n,
  text)`; on ok create `message` `{business_id, conversation_id: conv.id, direction:'outbound', message_type:'text',
  text_body: text, status:'sent', meta_message_id: id, is_ai_generated: false, raw_payload:{kind:'staff_alert', reason}}`;
  else skip and `console.warn('[alerts] skip wa', n, 'outside window')`. Result `whatsapp: [{to, status:'sent'|'skipped'|'failed'}]`.
- Wrapped in try/catch end to end: **never throws, never rejects**.

---

## 4. Layer 1b — jsonb helper and lead merge

### 4.1 `backend/src/db/jsonb.js`

The only writer of `conversations.workflow_data` and `conversations.metadata` for SHIFT. Every function is **one SQL
statement** (autocommit) — safe behind Neon's PgBouncer in transaction mode: no advisory locks, no `SET`, no session
state, no multi-statement transactions. Time comes from DB `now()`. Identifiers are whitelisted
(`TABLES = ['conversations']`, `COLUMNS = ['workflow_data','metadata']`) and injected with `Prisma.raw`; values always
go through `Prisma.sql` parameters with explicit casts. Invalid table/column → throw `Error('jsonb: bad identifier')`.

```js
patchJson(table, id, column, patch, { ifVersion, remove = [] } = {}) → Promise<{ ok: boolean, count: number }>
claimFlag(table, id, column, path /* string[] */) → Promise<boolean>
claimValue(table, id, column, key, value /* string */) → Promise<boolean>
incrementCounter(table, id, column, key, by = 1) → Promise<number | null>
acquireLease(conversationId, token, ttlMs = 60000) → Promise<boolean>
renewLease(conversationId, token, ttlMs = 60000) → Promise<boolean>   // D20: only an unexpired lease with this token
releaseLease(conversationId, token) → Promise<boolean>
preSendCheck(conversationId, { leaseToken = null, ttlMs = 60000, humanGuard = true, optedOutSince = null,
             claim = null /* [{column, path: string[], value}] */ } = {}) → Promise<boolean>
touchBatchDue(conversationId, quietMs, capMs) → Promise<{ dueAt: Date, delayMs: number } | null>
resolveNeedsTeam(conversationId, { match /* e.g. {reason, at} */, resolvedAt /* ISO */ }) → Promise<boolean>   // D27
writeConversationState(conversationId, { status, currentState /* undefined = leave */, patch = {}, needsTeam = null,
                       priorities = {}, defaultPriority = 1 }) → Promise<{ ok: boolean, needsTeam: {reason, at} | null }>   // D27
LEASE_TTL_MS = 60000
```

`resolveNeedsTeam` (D27 / GPT-6 #13, the Inbox «تم التواصل»): ONE statement that sets `needs_team.resolved_at` and
`status = CASE WHEN status = 'pending' THEN 'open' ELSE status END`, only `WHERE needs_team @> match AND
needs_team.resolved_at IS NULL`. A request the bot records in between fails the match, so it keeps its `pending`.

`writeConversationState` (D27 / GPT-6 #13, bot side; `$queryRaw … RETURNING`): ONE statement `WHERE id AND status <>
'human_takeover'` that sets `status`, `current_state` (only when `currentState !== undefined`) and `workflow_data =
workflow_data || patch`, plus `needs_team = needsTeam` when the needs_team stored **at write time** is not an object,
has `resolved_at` or `claimed_at` set, or has a lower priority (`priorities[reason]`, else `defaultPriority`) than
`needsTeam` — `results.mergeNeedsTeam`'s rule. Returns `ok:false` when no row matched, else the stored needs_team's
`{reason, at}`. Writing the status first and needs_team second let «تم التواصل» on the old request land in between and
move the conversation to `open` under the bot's new, unresolved request.

`preSendCheck` (D20) is the single statement run right before every Graph call; true = safe to send. Predicates are
added only when requested: `leaseToken` → the token matches and `reply_lease_until > now()` (and the lease is renewed in
the same statement); `humanGuard` → `status <> 'human_takeover' AND ai_enabled = true AND (human_active_until IS NULL OR
<= now())`; `optedOutSince` → `workflow_data.marketing_opted_out_at` is null or ≤ that instant; each `claim` entry →
`(C #>> path::text[]) = value::text` (whitelisted column; a missing path never matches) — the sweeper's note-claim
fence. Without a lease the SET is a no-op (`updated_at` untouched).

`touchBatchDue` (D25, `$queryRaw`): `batch_first_at` = now() when the previous `batch_due_at` is missing or past, else
kept; `batch_due_at = LEAST(now() + quietMs, batch_first_at + capMs)`; returns the stored deadline and the delay on DB time.

Exact SQL (`C` = the whitelisted column):

```sql
-- patchJson: top-level merge; keys in `remove` are deleted first; `patch` values replace whole top-level keys
UPDATE "conversations"
SET C = (COALESCE(C, '{}'::jsonb) - ${remove}::text[]) || ${JSON.stringify(patch)}::jsonb,
    "updated_at" = now()
WHERE "id" = ${id}
  -- only when ifVersion is a number:
  AND COALESCE((C -> 'lead' ->> 'version')::int, 0) = ${ifVersion}::int
-- → ok = count === 1

-- claimFlag: set a (possibly nested) key to now() iff it is currently null/missing and its parent object exists
UPDATE "conversations"
SET C = jsonb_set(C, ${path}::text[], to_jsonb(now()), true), "updated_at" = now()
WHERE "id" = ${id}
  AND (C #>> ${path}::text[]) IS NULL
  AND jsonb_typeof(C #> ${parentPath}::text[]) = 'object'    -- parentPath = path.slice(0,-1); omit this line when path.length === 1
-- → true iff count === 1 (two concurrent sweeps: exactly one gets true)

-- claimValue: set key := value iff it differs (once-per-X claims)
UPDATE "conversations"
SET C = COALESCE(C, '{}'::jsonb) || jsonb_build_object(${key}::text, ${value}::text), "updated_at" = now()
WHERE "id" = ${id} AND (C ->> ${key}::text) IS DISTINCT FROM ${value}::text

-- incrementCounter ($queryRaw)
UPDATE "conversations"
SET C = jsonb_set(COALESCE(C, '{}'::jsonb), ARRAY[${key}::text],
                  to_jsonb(COALESCE((C ->> ${key}::text)::int, 0) + ${by}::int), true),
    "updated_at" = now()
WHERE "id" = ${id}
RETURNING (C ->> ${key}::text)::int AS n
-- → rows[0]?.n ?? null

-- acquireLease
UPDATE "conversations"
SET "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object(
      'lease_token', ${token}::text,
      'reply_lease_until', now() + (${ttlMs}::int * interval '1 millisecond')),
    "updated_at" = now()
WHERE "id" = ${id}
  AND ( "metadata" ->> 'lease_token' IS NULL
     OR "metadata" ->> 'reply_lease_until' IS NULL
     OR ("metadata" ->> 'reply_lease_until')::timestamptz < now()
     OR "metadata" ->> 'lease_token' = ${token}::text )

-- renewLease
UPDATE "conversations"
SET "metadata" = "metadata" || jsonb_build_object('reply_lease_until', now() + (${ttlMs}::int * interval '1 millisecond')),
    "updated_at" = now()
WHERE "id" = ${id} AND "metadata" ->> 'lease_token' = ${token}::text
  AND ("metadata" ->> 'reply_lease_until')::timestamptz > now()

-- releaseLease
UPDATE "conversations"
SET "metadata" = "metadata" - 'lease_token' - 'reply_lease_until', "updated_at" = now()
WHERE "id" = ${id} AND "metadata" ->> 'lease_token' = ${token}::text
```

`patchJson` does **not** retry; version retries live in `saveLead`. A patch with zero keys and empty `remove` returns
`{ok:true, count:0}` without SQL. Values must be JSON-serialisable; `undefined` keys are dropped by `JSON.stringify`.
`tests/jsonb.test.js` mocks `../src/config/prisma` with `$executeRaw`/`$queryRaw` spies and asserts on
`sql.strings.join('?')` (the `Prisma.Sql` object) and `sql.values`.

### 4.2 `backend/src/workflows/shift/lead.js`

```js
const LEAD_SCALARS = ['name','business_name','sector','sector_text','city','preferred_time','language','budget_note','interest','source'];
const LEAD_ARRAYS  = ['need','products','objections','customer_numbers','site_estimates'];
const SECTORS = ['clinic','restaurant','store','other'];
const PRODUCT_KEYS = ['karam','loyalty','bookings','subscriptions','attendance','marketing','erp','custom'];
const OBJECTION_KEYS = ['price','staff','ai_errors','customers','small','later','references','other'];

mergeLead(existing = {}, patch = {}, meta) → { lead, changed: string[] }            // pure
  meta = { source: 'model'|'button'|'staff'|'referral', msgId = null, at /* ISO */, inboundText = '' }
extractCustomerNumbers(text) → string[]                                              // pure
isCorrection(text, newValue) → boolean                                               // pure
computeScore(lead, workflowData = {}) → number                                       // pure
saveLead(conversationId, patch, meta, { expectedVersion } = {})
  → Promise<{ ok, lead, changed, conflict?: true, previousScore }>
```

`mergeLead` rules (apply field by field; skip `undefined`, `null`, `''`, empty arrays):
1. **Normalise the patch:** `sector` ∉ SECTORS → drop; `language` ∉ {ar,en} → drop; `interest` ∉ {hot,warm,cold} →
   drop; string scalars trimmed and cut to 200 code points; `preferred_time` string → `{text}`; object →
   pick `{text, start, end, tz, slot_id}`; `need` string → `[string]`; `products` keep only PRODUCT_KEYS;
   `objection` (singular, from the model) ∈ OBJECTION_KEYS → appended to `objections`; `source` only as an object.
2. **Who may overwrite a scalar** (`prov = existing._prov?.[field]`):
   - `meta.source === 'staff'` → always writes; `_prov[field] = {source:'staff', confirmed:true, at, source_msg_id:null}`.
   - `prov?.source === 'staff'` and patch not from staff → ignore.
   - field empty in `existing` → write.
   - `prov?.confirmed === false` (inferred) → write.
   - confirmed value, different new value → write only if `isCorrection(meta.inboundText, newValue)`.
   - `source` is written only when `existing.source` is empty (first touch wins; `referral` never overwrites).
   - New `_prov[field]` = `{source: meta.source, source_msg_id: meta.msgId, at: meta.at, confirmed: meta.source !== 'referral'}`.
3. **Arrays:** staff → replace. Others → append, de-duplicate by `normalize(str)` (trim, collapse spaces, lowercase),
   keep order, cap: `need` 5 (each ≤ 200 code points), `objections` 10, `products` 8, `customer_numbers` 20.
4. `customer_numbers` = union with `extractCustomerNumbers(meta.inboundText)` when `meta.source` ∈ {model, button};
   never from `patch.customer_numbers` and never from staff edits. `site_estimates` is never written in PR1.
5. If `changed.length > 0`: `version = (existing.version || 0) + 1`. `score` is not set by `mergeLead`.

`extractCustomerNumbers(text)`: map Arabic-Indic `٠-٩` and Persian `۰-۹` to `0-9`, then
`text.match(/\d+(?:[.,]\d+)?/g) || []`, strings, unique.

`isCorrection(text, newValue)`: `text` contains `newValue` (after the normalisation above) **and** matches
`/(^|[\s،,])(مش|مو|لا|لأ|not|no)\s|قصدي|بالغلط|صحّح|صحح|I meant|actually/i`. Fixture: «مش عمّان، إربد» with
`city: 'إربد'` → true; «عندي فرع بعمّان» with `city: 'عمّان'` → false.

`computeScore(lead, wd)` (design §6 deltas available in PR1):
`+3` if `wd.needs_team?.reason === 'quote'` or `lead.objections` includes `'price'`; `+3` if `lead.preferred_time?.text
|| lead.preferred_time?.start`; `+2` if `lead.business_name`; `+1` if `lead.source?.type === 'ctwa'`; `−2` if
`wd.not_now_at`; `−5` if `wd.marketing_opted_out_at`. (Role-play and reply-speed deltas are PR2.)

`saveLead` algorithm:
```
for attempt in [1, 2]:
  row = prisma.conversation.findUnique({ where:{id}, select:{workflow_data:true} })
  wd = row?.workflow_data || {}; cur = wd.lead || {}
  if expectedVersion !== undefined && (cur.version || 0) !== expectedVersion → return {ok:false, conflict:true, lead:cur, changed:[]}
  {lead, changed} = mergeLead(cur, patch, meta)
  if !changed.length → return {ok:true, lead:cur, changed:[], previousScore: cur.score || 0}
  lead.score = computeScore(lead, wd)
  r = jsonb.patchJson('conversations', id, 'workflow_data', {lead}, {ifVersion: cur.version || 0})
  if r.ok → return {ok:true, lead, changed, previousScore: cur.score || 0}
  if expectedVersion !== undefined → return {ok:false, conflict:true, lead:cur, changed:[]}   // staff: no silent retry
console.warn('[lead] version conflict twice', id); return {ok:false, lead:null, changed:[]}
```
Never throws on a version conflict; DB errors propagate to the caller.

---

## 5. Layer 2a — `backend/src/workflows/shift/` (replaces `workflows/shift.js`)

Delete `backend/src/workflows/shift.js`; `require('../workflows/shift')` resolves to `shift/index.js`. **No module in
this folder writes to the DB or calls WhatsApp** (except `index.js` reading history, and `lead.js` from L1b). They
return a `WorkflowResult`; the batcher persists and sends it.

### 5.1 `WorkflowResult` (the one shape every producer returns)

```js
{
  kind: 'reply' | 'fallback' | 'handoff' | 'button' | 'optout' | 'media',
  action: 'NONE'|'FLAG_FOR_TEAM'|'HANDOFF_TO_HUMAN'|'CAPTURE_TIME'|'NOT_NOW'|'OPT_OUT'|'AI_FAILURE'|'BUTTON'|'MEDIA',
  messages: [ { type: 'text', text } | { type: 'interactive', text, buttons: [{ id, title }] } ],  // length 1 in PR1
  stateUpdate: { status?, current_state? },          // scalar Conversation columns only; never ai_enabled
  workflowDataPatch: { /* top-level workflow_data keys except `lead` */ },
  leadPatch: null | { /* mergeLead patch */ },
  leadMeta: null | { source, msgId, at, inboundText },
  needsTeam: null | { /* same object as workflowDataPatch.needs_team */ },
  needsTeamCandidate?: { /* the needsTeamEntry the result wanted, even when mergeNeedsTeam dropped it against the
                           stale copy; FLAG_FOR_TEAM, capture, AI failure, handoff. The batcher re-merges it at write
                           time (jsonb.writeConversationState, D27) */ },
  alert: null | { reason /* alerts.ALERT_REASONS */, summary }
}
```
Part text limits: `text` ≤ 4096 code points; `interactive.text` ≤ 1024 (cut the model line, never the ack).
Parts are composed as `[modelLine, ack].filter(Boolean).join('\n\n')`.

### 5.2 `index.js`

```js
const HISTORY_LIMIT = 12;
processShiftBatch(business, conversation, batchMessages, { now = new Date(), deadlineAt, onRetry } = {}) → Promise<WorkflowResult>
processShiftMessage(business, conversation, customerText) → Promise<WorkflowResult>      // one-message wrapper
batchLine(message, lang) → string        // text_body, or media placeholder
module.exports = { processShiftBatch, processShiftMessage, batchLine, buildSystemPrompt, formatHistory,
                   toWorkflowResult, SHIFT_KNOWLEDGE, SHIFT_ACTIONS };
```

`processShiftBatch` (never throws — any exception → `toWorkflowResult(null, ctx)` and `console.error('[shift]', …)`):
1. `wd = conversation.workflow_data || {}`, `lead = wd.lead || {}`, `texts = batchMessages.map(m => m.text_body || '')`,
   `joinedText = texts.join('\n')`, `lang = acks.pickLanguage(lead, joinedText)`, `teamHours = hours.resolveTeamHours(business.ai_config)`,
   `offers = buttons.slotOffers(teamHours, now, lang)`, `newest = batchMessages[batchMessages.length - 1]`,
   `ctx = {business, conversation, batchMessages, now, lang, teamHours, offers, newest, joinedText}`.
2. **Media only** (every message has `message_type` ∈ `MEDIA_TYPES = ['image','audio','video','document','sticker']`
   and no `text_body`) → `{kind:'media', action:'MEDIA', messages:[{type:'text', text: acks.media(firstMediaType, lang)}],
   workflowDataPatch:{bot_turns: n+1}}` — no AI.
3. **Tier-1 handoff:** `handoff.detectHumanRequest(joinedText)` → return `handoff.buildHandoff({...ctx, reason:'person',
   tier:1, summary: joinedText.slice(0, 200), modelLine: acks.handoffLead(lang)})` — no AI.
4. History: `prisma.message.findMany({where:{conversation_id: conversation.id}, orderBy:{created_at:'desc'},
   take: HISTORY_LIMIT + batchMessages.length, select:{id:true, direction:true, text_body:true, message_type:true}})`,
   drop rows whose `id` is in the batch, keep the newest 12, reverse.
5. `userMessage = batchMessages.map(m => batchLine(m, lang)).join('\n')`;
   `systemPrompt = buildSystemPrompt(business, formatHistory(history), {now, offers, stage: conversation.current_state, lang})`;
   `retrySystemPrompt` = same with `formatHistory(history.slice(-6))`.
6. `aiResult = await generateValidatedAIReply(systemPrompt, userMessage, [], {validActions: SHIFT_ACTIONS, correctionPrompt:
   CORRECTION_PROMPT, responseSchema: RESPONSE_SCHEMA, jsonMode: true, systemInstruction: true, deadlineAt: deadlineAt ??
   now.getTime() + 18000, retrySystemPrompt, onRetry, stages: MODEL_STAGES, nextSteps: NEXT_STEPS, conversationId: conversation.id})`.
7. `return toWorkflowResult(aiResult, ctx)`.

`batchLine`: text → `text_body`; `interactive` → `text_body` (the button title); media with no text →
`{audio:'[رسالة صوتية]', image:'[صورة]', video:'[فيديو]', document:'[ملف]', sticker:'[ملصق]'}[type]` (en:
`[voice note]`, `[image]`, `[video]`, `[file]`, `[sticker]`); `location` → `text_body || '[موقع]'`.

`processShiftMessage(business, conversation, customerText)` keeps today's history query verbatim
(`take: HISTORY_LIMIT + 1`, `select:{direction, text_body}`, `slice(1).reverse()`) and then runs steps 3, 5–7 with a
synthetic batch `[{id: null, direction:'inbound', message_type:'text', text_body: customerText}]`; with no
`deadlineAt` passed it uses `now + 18000`. It exists for the existing test and for scripts.

`formatHistory(messages)` is unchanged (labels `العميل` / `شِفت`, 400-char cut, skips empty bodies).

### 5.3 `actions.js`

```js
const SHIFT_ACTIONS = ['NONE','FLAG_FOR_TEAM','HANDOFF_TO_HUMAN','CAPTURE_TIME','NOT_NOW','OPT_OUT'];
const STAGES = ['opening','discovery','fit','sample','roleplay_setup','roleplay','objection','close','captured','handoff','closed'];
const MODEL_STAGES = ['opening','discovery','fit','objection','close','closed'];      // what the model may propose in PR1
const NEXT_STEPS = ['question','buttons','confirmed','terminal'];
const FLAG_REASONS = ['quote','meeting','demo','complaint','unknown'];
const HANDOFF_REASONS = ['person','complaint','abuse'];
```

`CORRECTION_PROMPT` (exact):
```
يجب أن يكون ردك JSON فقط بهذا الشكل بالضبط، بدون أي نص إضافي:
{"reply":"نص الرد","action":"NONE","action_args":{},"buttons":[],"lead":{},"stage":"discovery","next_step":"question"}
action واحد من: NONE, FLAG_FOR_TEAM, HANDOFF_TO_HUMAN, CAPTURE_TIME, NOT_NOW, OPT_OUT
stage واحد من: opening, discovery, fit, objection, close, closed
next_step واحد من: question, buttons, confirmed, terminal
أعد المحاولة الآن.
```

`RESPONSE_SCHEMA` (Gemini `responseSchema`; plain string types, identical to the SDK's `SchemaType` values — do not
import the SDK here):
```js
const str = (extra = {}) => ({ type: 'string', nullable: true, ...extra });
const en = (values) => ({ type: 'string', format: 'enum', enum: values });
{
  type: 'object',
  properties: {
    reply: { type: 'string' },
    action: en(SHIFT_ACTIONS),
    action_args: { type: 'object', nullable: true, properties: {
      reason: str(), summary: str(), time_text: str() } },
    buttons: { type: 'array', nullable: true, maxItems: 3, items: { type: 'object',
      properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['id','title'] } },
    lead: { type: 'object', nullable: true, properties: {
      name: str(), business_name: str(), sector: str(), sector_text: str(), city: str(),
      need: str(), products: { type: 'array', nullable: true, items: { type: 'string' } },
      preferred_time: str(), language: str(), budget_note: str(), objection: str(), interest: str() } },
    stage: en(MODEL_STAGES),
    next_step: en(NEXT_STEPS)
  },
  required: ['reply', 'action']
}
```
(`reason`/`sector`/… are free strings in the schema and normalised server-side, so a schema rejection can never
silence the bot.)

### 5.4 `prompt.js`

`buildSystemPrompt(business, historyText, { now = new Date(), offers = [], stage = null, lang = 'ar' } = {}) → string`
and `SHIFT_KNOWLEDGE` (today's text with the line `الموقع: https://shifts-ai.store` replaced by
`` `الموقع: ${SITE_URL}` ``). `offersLine = offers.map(o => `${o.id} «${o.title}»`).join(' · ')`;
`nowAmman` = `hours.formatLocal(now, 'Asia/Amman', lang)` e.g. `الاثنين 14/9 11:00`. Exact template:

```text
أنت «كرم»، مساعد شِفت الذكي على واتساب (ذكاء اصطناعي). بتحكي مع أصحاب منشآت مهتمين بخدمات شِفت.
شخصيتك: ${business.ai_config?.personality || 'ودود، مختصر، ومحترف، بلهجة أردنية مهذبة'}.

معلومات شِفت — لا تذكر أي معلومة عن شِفت خارج هذا النص:
${SHIFT_KNOWLEDGE}

التعريف القياسي (مرة واحدة بأول رد):
«أنا كرم، مساعد شِفت الذكي (${SITE_HOST}) — نفس محرّك كرم اللي بنركّبه على رقم {مطعمك|عيادتك|متجرك|محلك}، بس هون بمعلومات شِفت.»
إذا سُئلت «إنت بوت؟»: «أي، أنا كرم — مساعد شِفت الذكي (ذكاء اصطناعي)، مش شخص من الفريق. لو بتفضّل تحكي مع شخص من الفريق بحوّلك هلأ.» لا تدّعِ أنك إنسان أبدًا.

قواعد صارمة:
- لا تذكر أسعارًا أو خصومات أو مدة تنفيذ أو أسماء عملاء أو أرقامًا أو نتائج مضمونة — هذه غير منشورة. عند سؤال السعر: ما عندك تسعيرة معتمدة، الفريق بيطلع عرض مكتوب (بدون مكالمة إذا بيحب)، واسأل سؤال نطاق واحد.
- لا تخترع ميزات غير موجودة في النص. إذا ما بتعرف: «ما عندي جواب أكيد، بحطها بأسئلة الفريق».
- 1–3 أسطر قصيرة، سؤال واحد بالآخر، بدون عناوين أو جداول أو Markdown. عربي أردني خفيف (هون، شو، بدك، هلأ)، أرقام إنجليزية فقط.
- ردّ بلغة العميل (عربي أو إنجليزي).
- لا تقل «سجّلت» ولا «بسجّل» ولا «حجزت» ولا «بلّغت الفريق» ولا «بعثت» ولا «وصل طلبك». النظام بيضيف جملة التأكيد بعد ما ينفّذ الإجراء فعلًا. للمعلومات قل «بحطها بالحسبان».
- أول مرة بتطلب الاسم أو اسم المنشأة أضف: «(بنستخدم اللي بتكتبه عشان نرد عليك ونرتّب متابعة الفريق — التفاصيل: ${PRIVACY_SHORT})».
- لا تطلب بيانات حساسة (كلمات مرور، بطاقات، رموز تحقق). رابط مسموح فقط: ${SITE_HOST}.
- هدفك: فهم المنشأة (القطاع، المشكلة، اسم المنشأة) واقتراح المنتج المناسب، ثم عرض مكالمة قصيرة مع الفريق كخيار: «منكمّل هون، أو بطلبلك مكالمة قصيرة مع الفريق — أيهم أريح إلك؟»

الأكشن (واحد فقط):
- NONE: رد عادي.
- FLAG_FOR_TEAM: طلب عرض سعر أو عرض مكتوب أو عرض تجريبي أو سؤال بيحتاج الفريق. action_args: {"reason":"quote|meeting|demo|complaint|unknown","summary":"سطر للفريق بكلمات العميل"}. كمّل المحادثة طبيعي، لا تسكت.
- HANDOFF_TO_HUMAN: طلب صريح لشخص أو موظف أو صاحب الشركة، أو شكوى، أو غضب. ردك «ولا يهمك.» أو «حقك تحكي مع شخص.» فقط — بلا أسئلة، بلا طلب اسم، بلا أزرار. ذكر كلمة «موظف» أو «إنسان» لحالها (مثل «عندي موظفة بترد») مش طلب تحويل. action_args: {"reason":"person|complaint|abuse","summary":"سطر للفريق"}.
- CAPTURE_TIME: العميل حدد وقت للمكالمة والاسم أو اسم المنشأة معروف. action_args: {"time_text":"الوقت بكلماته"}.
- NOT_NOW: «مش هلأ» أو «بعدين» أو «بعد رمضان» — جملة احترام بلا سؤال بيع.
- OPT_OUT: «إيقاف» أو «لا تبعتولي» أو «مش مهتم» بمعناها الكامل. انتبه للنفي: «مش مهتم بالولاء بس بكرم» مش إيقاف.

الأزرار المتاحة الآن (بس إذا طلب العميل وقت أو وافق على المكالمة، والنص قبلها «أقرب أوقات الفريق:»): ${offersLine}
المرحلة الحالية: ${stage || 'opening'} · الوقت الآن بتوقيت عمّان: ${nowAmman}

المحادثة حتى الآن (الأقدم أولًا):
${historyText || '(لا توجد رسائل سابقة)'}

أجب بـ JSON فقط بدون أي نص آخر:
{"reply":"نص الرد","action":"NONE","action_args":{},"buttons":[],"lead":{},"stage":"discovery","next_step":"question"}
lead: اللي عرفته من رسائل العميل هاي فقط (والباقي null): name, business_name, sector (clinic|restaurant|store|other), sector_text, city, need, products, preferred_time, language (ar|en), budget_note, objection (price|staff|ai_errors|customers|small|later|references|other), interest (hot|warm|cold).
stage: opening|discovery|fit|objection|close|closed · next_step: question|buttons|confirmed|terminal
```

### 5.5 `hours.js` (team hours, D8)

```js
const DEFAULT_TEAM_HOURS = { days: [0,1,2,3,4], from: '09:00', to: '18:00', tz: 'Asia/Amman', closures: [] };
const WEEKDAYS_AR = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const WEEKDAYS_EN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
resolveTeamHours(aiConfig) → {days, from, to, tz, closures}   // per-key fallback to the default when missing/invalid
localParts(date, tz) → { dateKey: 'YYYY-MM-DD', hh, mm, minutes /* hh*60+mm */, weekday /* 0=Sun */, offset: '+03:00' }
zonedDate(dateKey, 'HH:MM', tz) → Date
addDays(dateKey, n) → dateKey
isTeamDay(th, dateKey) → boolean                     // weekday ∈ days && !closures.includes(dateKey)
isWithinTeamHours(th, now) → boolean                 // team day && from ≤ local HH:MM < to
nextOpening(th, now) → { at: Date, dateKey, relation: 'today'|'tomorrow'|'later' }   // searches ≤ 14 days
dayWord(dateKey, now, tz, lang) → 'اليوم'|'بكرا'|WEEKDAYS_AR[w]  /  'today'|'tomorrow'|WEEKDAYS_EN[w]
hoursLabel(th, lang) → 'الأحد–الخميس 9–6'  /  'Sun–Thu 9 am–6 pm'
formatLocal(date, tz, lang) → 'الاثنين 14/9 11:00'  /  'Monday 14/9 11:00'
teamMinutesBetween(th, from, to) → number            // minutes of team hours inside [from, to], ≤ 7 days scanned
```
Implementation note: `Intl.DateTimeFormat('en-US', {timeZone, hourCycle:'h23', year:'numeric', month:'2-digit',
day:'2-digit', hour:'2-digit', minute:'2-digit', weekday:'short', timeZoneName:'longOffset'})`; `GMT+03:00` → `+03:00`,
bare `GMT` → `+00:00`. Hour labels: 12-hour, no leading zero, `:30` only when minutes ≠ 0; contiguous `days` print as
a range (`الأحد–الخميس`, `Sun–Thu`), otherwise joined with `، ` / `, `. English adds ` am`/` pm` to both ends.

### 5.6 `acks.js` (every deterministic customer-visible string)

Pure functions; `lang` ∈ {ar, en}; unknown segments are omitted (never printed empty, never `undefined`).

```js
pickLanguage(lead, text) → 'ar'|'en'
hoursSegment(teamHours, lang)   → ' (الأحد–الخميس 9–6)' | ' (Sun–Thu 9 am–6 pm)'
contactSegment(contact, lang)   → '' | ' للاستعجال: 0776788972 أو hello@x.com.' | ' For urgent matters: 0776788972 or hello@x.com.'
windowText({start, end}, now, tz, lang) → 'بكرا بين 10 و12 (الثلاثاء 15/9)' | 'tomorrow between 10 and 12 (Tuesday 15/9)'
handoffLead(lang) · handoffAck({teamHours, contact, now, lang}) · handoffRepeat(lang)
flagAck(reason, {teamHours, lang}) · captureAck({name, businessName, when, lang}) · captureAsk({nameKnown, businessKnown, sector, lang})
slotOther(lang) · expiredSlot(lang) · aiFailure(lang, {withButtons}) · optOut(lang) · notNow(lang)
claimAck({staffName, lang}) · slaNote(lang) · awaitingStaffNote({staffName, lang})
media(type, lang) · mediaPrefix(type, lang) · purposeLine(lang)
```

`pickLanguage`: `lead.language` if set; else count Arabic letters `[؀-ۿ]` and Latin `[A-Za-z]`; `'en'` iff
Latin ≥ 70 % of letters **and** the text does not match the Arabizi test
`/[a-z][2356789]|[2356789][a-z]|\b(shu|sho|keef|kif|bdi|baddi|3ndi|ahlan|mar7aba|marhaba|se3er|kam|tamam|yalla|mat3am|3iyade)\b/i`;
otherwise `'ar'`.

| Function | Arabic (exact) | English (exact) |
|---|---|---|
| `handoffLead` | ولا يهمك. | Of course. |
| `handoffAck` in team hours | سجّلت طلبك بقائمة الفريق مع ملخص محادثتنا — لسه ما استلمه حدا، وبيردوا عليك هون ضمن الدوام{hours}.{contact} لو احتجت أي شي بالوقت هذا أنا هون. | Your request is on the team's list with a summary of our chat — nobody has picked it up yet; they reply here during working hours{hours}.{contact} If you need anything meanwhile, I'm here. |
| `handoffAck` after hours | سجّلت طلبك بقائمة الفريق مع ملخص محادثتنا — لسه ما استلمه حدا، وبيردوا عليك هون {opening} مع بداية الدوام إن شاء الله.{contact} لو احتجت أي شي بالوقت هذا أنا هون. | Your request is on the team's list with a summary of our chat — nobody has picked it up yet; they'll reply here {opening} when the working day starts.{contact} If you need anything meanwhile, I'm here. |
| `{opening}` (from `nextOpening`) | today → `اليوم الساعة 9` · tomorrow → `بكرا الصبح` · later → `يوم الأحد الصبح` | `today at 9 am` · `tomorrow morning` · `on Sunday morning` |
| `handoffRepeat` | لسه ما استلمه حدا من الفريق، ومعلّم عندهم — إذا بتحب اكتبلي وقت بيناسبك ونحطّه بالطلب. | Nobody from the team has picked it up yet, and it's flagged for them — if you like, write a time that suits you and I'll add it to the request. |
| `flagAck('quote')` | سجّلت طلب العرض بقائمة فريق شِفت ✅ لسه ما استلمه حدا — بيرجعولك على هالرقم ضمن الدوام{hours}. لحد ما يردوا أنا هون لأي سؤال. | I've put your quote request on the SHIFT team's list ✅ nobody has picked it up yet — they'll get back to you on this number during working hours{hours}. Until then I'm here for any question. |
| `flagAck(other)` | سجّلت طلبك بقائمة فريق شِفت ✅ لسه ما استلمه حدا — بيرجعولك على هالرقم ضمن الدوام{hours}. لحد ما يردوا أنا هون لأي سؤال. | I've put your request on the SHIFT team's list ✅ nobody has picked it up yet — they'll get back to you on this number during working hours{hours}. Until then I'm here for any question. |
| `captureAck` | سجّلت طلب مكالمة: {name، }{business، }{when} بتوقيت عمّان — طلب مش موعد مؤكد، الفريق بيأكد الساعة بالضبط معك هون. إذا بتفضّل اتصال بدل الرسائل، اكتبلي. | Call request noted: {name, }{business, }{when} Amman time — a request, not a confirmed booking; the team will confirm the exact time here. If you'd rather be phoned than messaged, tell me. |
| `captureAsk` none known | تمام. بس أكّدلي اسمك واسم {noun}؟ {purpose} | Great. Could you confirm your name and your business name? {purpose} |
| `captureAsk` name known | تمام. بس أكّدلي اسم {noun}؟ {purpose} | Great. Could you confirm your business name? {purpose} |
| `captureAsk` business known | تمام. بس أكّدلي اسمك؟ {purpose} | Great. Could you confirm your name? {purpose} |
| `{noun}` by `lead.sector` | restaurant `المطعم` · clinic `العيادة` · store `المتجر` · other/unknown `المحل` | — |
| `purposeLine` | (بنستخدم اللي بتكتبه عشان نرد عليك ونرتّب متابعة الفريق — التفاصيل: ${PRIVACY_SHORT}) | (we use what you write to reply to you and organise the team's follow-up — details: ${PRIVACY_SHORT}) |
| `slotOther` | تمام — أي يوم وساعة بتريحك؟ | Sure — which day and time suits you? |
| `expiredSlot` | الخيار هاد قديم — أي يوم ووقت بناسبك هلأ؟ | That option is out of date — which day and time suits you now? |
| `aiFailure` withButtons | علّقت شوي — رسالتك محفوظة وبرجع أكمّل معك. بالوقت هذا: بتحب أسجّللك وقت للمكالمة؟ | I got stuck for a moment — your message is saved and I'll continue with you. Meanwhile, shall I note a time for the call? |
| `aiFailure` without buttons | علّقت شوي — رسالتك محفوظة وبرجع أكمّل معك هون. | I got stuck for a moment — your message is saved and I'll continue with you here. |
| `optOut` | تمام، أوقفت المتابعة. إذا احتجتنا إحنا هون. | Done — I've stopped follow-ups. We're here if you need us. |
| `notNow` | تمام، الوقت إلك. لو رجعت بأي وقت بنكمّل من نفس النقطة. | Sure, whenever suits you. If you come back we'll pick up where we left off. |
| `claimAck` with name | استلم طلبك {staff} وبيكمّل معك هون. | {staff} has picked up your request and will continue with you here. |
| `claimAck` no name | استلم طلبك واحد من الفريق وبيكمّل معك هون. | Someone from the team has picked up your request and will continue with you here. |
| `slaNote` | طلبك لسه بالقائمة عند الفريق وما استلمه حدا بعد — معلّم عندهم. إذا بتحب، اكتبلي وقت بيناسبك ونحطّه بالطلب. | Your request is still on the team's list and not yet picked up — it's flagged. If you like, write a time that suits you and I'll add it to the request. |
| `awaitingStaffNote` | رسالتك وصلت، {staff\|الفريق} بيكمّل معك هون. | Your message arrived — {staff\|the team} will continue with you here. |
| `media(audio)` | وصلتني رسالتك الصوتية 🙏 هون بالمحادثة بقرأ النص بس — ممكن تكتبلي المطلوب بسطر؟ | Got your voice note 🙏 in this chat I read text only — could you type what you need in one line? |
| `media(image/video/document/sticker)` | وصلتني الصورة / وصلني الفيديو / وصلني الملف / وصلني الملصق + « 🙏 هون بالمحادثة بقرأ النص بس — ممكن تكتبلي المطلوب بسطر؟» | Got your image / video / file / sticker + " 🙏 in this chat I read text only — could you type what you need in one line?" |
| `mediaPrefix(type)` | وصلتني رسالتك الصوتية كمان 🙏 هون بقرأ النص بس. (same nouns as `media`) | Got your voice note too 🙏 — here I read text only. |
| slot-buttons body (fallback when the model line is empty) | أقرب أوقات الفريق: | The team's nearest times: |

`{name، }` renders `محمد، ` only when known (no honorific — the server cannot know gender); `{business، }` likewise;
`{when}` = `windowText(...)` for a slot, otherwise the customer's time text verbatim.
Test: with `lang='en'` no function returns a string matching `/[؀-ۿ]/` (names/business values excluded).

### 5.7 `handoff.js`

```js
normalizeArabic(text) → string     // strip [ً-ْٰـ], أ/إ/آ → ا, ى → ي, lowercase, collapse spaces, trim
detectHumanRequest(text) → boolean
isHandoffOpen(conversation) → boolean  // status === 'pending' && wd.handoff?.requested_at && !wd.needs_team?.resolved_at
buildHandoff({ business, conversation, now, lang, teamHours, reason, tier, summary, modelLine }) → WorkflowResult
```
Patterns, tested against `normalizeArabic(text)` (whole batch text; any match triggers):
```js
const OBJ = '(حد|حدا|انسان|موظف|شخص|بني ادم|بشر|المدير|مدير|المسؤول|صاحب الشركه|صاحب الشركة|الفريق|حدا من الفريق)';
const REQUEST_PATTERNS = [
  new RegExp(`بدي (احكي|اتكلم|اتواصل) مع ${OBJ}`),
  new RegExp(`خليني (احكي|اتكلم) مع ${OBJ}`),
  /حول(ني|وني) ?(ل|على|عل)/,
  /وين (الموظف|الموظفين|الفريق|المسؤول)/,
  /بدي (المدير|المسؤول|صاحب الشركه|صاحب الشركة)/,
  /\b(talk|speak|chat) (to|with) (a |an |the |your )?(human|person|someone|agent|manager|owner|team|real person)\b/i,
  /\b(transfer|connect) me\b/i,
];
```
Positives: «بدي أحكي مع إنسان», «بدي احكي مع حدا من الفريق», «حوّلني لموظف», «وين الموظف؟», «بدي المدير»,
«بدي صاحب الشركة», «خليني أحكي مع شخص», "I want to talk to a human", "can I speak with someone".
Negatives (→ model): «عندي موظفة بترد», «زبايني بحبوا يحكوا مع شخص», «بدي أحكي مع زباين أكثر», «موظف»,
«مش راضي أحكي مع بوت» (the model decides), "the bot can talk to customers", "one-stop shop".

`buildHandoff`:
- `isHandoffOpen(conversation)` → `{kind:'handoff', action:'HANDOFF_TO_HUMAN', messages:[{type:'text', text:
  acks.handoffRepeat(lang)}], stateUpdate:{}, workflowDataPatch:{bot_turns: n+1}, alert:null}` (tier 1) — for tier 2 the
  caller passes `modelLine` and the text is `modelLine` only.
- otherwise: `ack = acks.handoffAck({teamHours, contact: business.ai_config?.contact, now, lang})`;
  `needs = mergeNeedsTeam(wd.needs_team, {reason: reason === 'complaint' ? 'complaint' : 'person', summary, at,
  resolved_at:null, sla_note_sent_at:null, claimed_at:null, claimed_by:null})`; result
  `{kind:'handoff', action:'HANDOFF_TO_HUMAN', messages:[{type:'text', text: join(modelLine, ack)}],
  stateUpdate:{status:'pending', current_state:'handoff'}, workflowDataPatch:{handoff:{requested_at: at, reason, tier},
  human_requested_at: at, capture_pending: null, bot_turns: n+1, ...(needs && {needs_team: needs})},
  needsTeam: needs, alert:{reason:'handoff', summary}}`. **Never buttons; never `ai_enabled`.**

### 5.8 `optout.js`

```js
normalizeCommand(text) → string   // normalizeArabic, then strip trailing [.!؟?،,…\s]+ and leading spaces
isOptOutCommand(text) → boolean   // ≤ 4 words after normalisation AND OPT_OUT_RE matches
optOutResult({ conversation, lang, now }) → WorkflowResult
const OPT_OUT_RE = /^(ايقاف|stop|unsubscribe|لا تبعتولي( شي| اشي)?|لا تبعتو|لا تبعتوا|مش مهتم|مش مهتمه|وقف(وا)? (بعت |ارسال )?(ال)?(رسايل|رسائل))$/i;
```
Positives: «إيقاف», «ايقاف», «stop», «STOP», «Unsubscribe», «لا تبعتولي», «لا تبعتولي شي», «مش مهتم.», «مش مهتم!»,
«وقف بعت رسايل», «وقفوا الرسائل». Negatives: «مش مهتم بالولاء بس بكرم», «ما بتوقف الرسائل بالليل», "one-stop shop",
«لا تبعتولي الأسعار هلأ», «بدي أوقف الموظف», «stop the bot from replying at night».

`optOutResult` → `{kind:'optout', action:'OPT_OUT', messages:[{type:'text', text: acks.optOut(lang)}],
stateUpdate:{current_state:'closed'}, workflowDataPatch:{marketing_opted_out_at: now.toISOString(), followups: [],
capture_pending: null}, leadPatch:null, needsTeam:null, alert:null}`. Status is not changed (a pending handoff stays
pending for staff).

### 5.9 `buttons.js` (deterministic, no AI, no DB)

```js
const SLOT_OFFER_TTL_MS = 12 * 60 * 60 * 1000;
const SLOT_ID_RE = /^slot:(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})([+-]\d{2}:\d{2})\/(\d{2}:\d{2})$/;
parseSlotId(id) → null | { other: true } | { dateKey, startHm, endHm, offset, start: Date, end: Date }
isShiftButtonId(id) → boolean                         // 'lead_talk' | 'slot:other' | SLOT_ID_RE
slotOffers(teamHours, now, lang = 'ar') → [{id, title}, {id, title}, {id:'slot:other', title}]
handleButton(id, ctx) → WorkflowResult | null         // ctx = {business, conversation, now, lang, messageId}; null = not ours
assertButtons() → void                                // throws if any title it can produce exceeds 20 code points
```

`slotOffers` algorithm (all times in `teamHours.tz`):
- Windows per team day: morning = `[from + 60 min, from + 180 min]`, afternoon = `[to − 120 min, to]`; if morning end >
  afternoon start, a single window `[from, to]` is used for both.
- If today is a team day and local time < 15:00 and < afternoon start → offer 1 = today afternoon.
- `next` = first team day after today → push next morning; if fewer than 2 offers, push next afternoon.
- `id = slot:${dateKey}T${startHm}${offset}/${endHm}`; `title = ${dayWord} ${range}`; range ar `4–6`, `10–12`;
  en `10–12`, `4–6 pm` (` pm` when the end hour ≥ 13). Third button `{id:'slot:other', title: 'وقت ثاني' | 'Another time'}`.

Fixtures (tz Asia/Amman, default hours):

| now (Amman) | offers |
|---|---|
| Mon 2026-09-14 11:00 | `slot:2026-09-14T16:00+03:00/18:00` «اليوم 4–6» · `slot:2026-09-15T10:00+03:00/12:00` «بكرا 10–12» · «وقت ثاني» |
| Mon 2026-09-14 15:30 | `…2026-09-15T10:00…/12:00` «بكرا 10–12» · `…2026-09-15T16:00…/18:00` «بكرا 4–6» |
| Thu 2026-09-17 11:00 | «اليوم 4–6» (09-17) · «الأحد 10–12» (09-20) |
| Thu 2026-09-17 16:00 | «الأحد 10–12» · «الأحد 4–6» |
| Fri 2026-09-18 10:00 | «الأحد 10–12» · «الأحد 4–6» |
| Sat 2026-09-19 12:00 | «بكرا 10–12» · «بكرا 4–6» (Sunday is tomorrow) |
| Mon 11:00, `closures:['2026-09-15']` | «اليوم 4–6» · «الأربعاء 10–12» (09-16) |
| Mon 11:00, lang en | "Today 4–6 pm" · "Tomorrow 10–12" · "Another time" |

`handleButton`:
- `lead_talk` → `handoff.buildHandoff({..., reason:'person', tier:1, summary:'ضغط زر «احكي مع الفريق»', modelLine: acks.handoffLead(lang)})`.
- `slot:other` → `{kind:'button', action:'BUTTON', messages:[{type:'text', text: acks.slotOther(lang)}],
  workflowDataPatch:{capture_pending:{slot_id:'other', time_text:null, at}}, stateUpdate:{current_state:'close'}}`
  (current_state only when the stage is not `handoff`/`captured`).
- `slot:<window>`: `offer = wd.slot_offers?.find(o => o.id === id)`. **Expired** iff `end ≤ now` or
  (`offer` and `now − offer.issued_at > SLOT_OFFER_TTL_MS`) or (no `offer` and `start ≤ now`) →
  `messages:[text acks.expiredSlot(lang)]`, `workflowDataPatch:{capture_pending:{slot_id:null, time_text:null, at}}`.
  Otherwise `preferredTime = {text: acks.windowText(parsed, now, tz, lang), start: start.toISOString(),
  end: end.toISOString(), tz, slot_id: id}`; `leadPatch = {preferred_time: preferredTime}`, `leadMeta =
  {source:'button', msgId: ctx.messageId, at, inboundText:''}`. If `lead.name && lead.business_name` →
  `results.captureResult(ctx, {preferredTime})`; else `messages:[text acks.captureAsk({nameKnown: !!lead.name,
  businessKnown: !!lead.business_name, sector: lead.sector, lang})]`, `workflowDataPatch:{capture_pending:{slot_id: id,
  time_text: null, at}}`, `stateUpdate:{current_state:'close'}` (unless handoff/captured).
- any other id → `null`.

### 5.10 `results.js`

```js
const NEEDS_TEAM_PRIORITY = { person: 5, complaint: 5, meeting: 4, quote: 3, demo: 2, unknown: 1, ai_failure: 0 };
mergeNeedsTeam(existing, next) → next | null          // null = keep existing (unresolved and priority ≥ next)
sanitizeButtons(buttons, offers) → [{id, title}]      // keep ids present in `offers`; titles taken from `offers`
nextStage(current, proposed, action) → string | undefined
captureResult(ctx, { preferredTime, timeText, modelLine, leadPatch }) → WorkflowResult   // + `capture` (below)
renderCaptureAck(capture, storedLead) → { relayed: boolean, messages: [part], workflowDataPatch }   // D26
toWorkflowResult(aiResult, ctx) → WorkflowResult      // ctx optional: business {ai_config:{}}, conversation {status:'open',
                                                      // workflow_data:{}}, batchMessages [], now new Date(), lang 'ar', DEFAULT_TEAM_HOURS
```

`nextStage`: OPT_OUT/NOT_NOW → `closed`; HANDOFF → `handoff`; capture → `captured`; if `current` ∈ {handoff, captured}
→ `undefined` (only staff `/release` moves it); `proposed` ∈ MODEL_STAGES and ≠ `closed` → `proposed`; no current →
`opening`; else `undefined` (column untouched).

Common to every valid `aiResult`: `modelLine = aiResult.reply.trim()`; `leadPatch = aiResult.lead` (null if empty or
if `current_state` ∈ {roleplay_setup, roleplay}); `leadMeta = {source:'model', msgId: newest?.id ?? null, at,
inboundText: joinedText}`; `workflowDataPatch.bot_turns = (wd.bot_turns || 0) + 1`; `disclosed_at = at` when not yet
set and the reply contains `مساعد شِفت` (or `SHIFT's AI assistant`) and `SITE_HOST`. Mixed media batch: prefix
`acks.mediaPrefix(type, lang)` + `\n` unless the reply already matches
`/صوت|صورة|فيديو|ملف|ملصق|voice|image|photo|video|file|sticker/i`.

**Pending capture first:** if `wd.capture_pending` and action ∉ {OPT_OUT, NOT_NOW, HANDOFF_TO_HUMAN}: time = the
stored slot (`lead.preferred_time` with `slot_id === capture_pending.slot_id`) or `capture_pending.time_text` or
`aiResult.lead?.preferred_time` or `action_args.time_text`; if a time is known → `captureResult(ctx, {preferredTime |
timeText, modelLine: null, leadPatch})` (the ack alone, missing name/business segments omitted); if no time is known
(«وقت ثاني» then a message without a time) → continue below and keep `capture_pending`.

| `aiResult.action` | messages | stateUpdate | workflowDataPatch (besides bot_turns) | alert |
|---|---|---|---|---|
| `null` (AI failure) | stage ∉ {handoff, captured, closed}: interactive `acks.aiFailure(lang,{withButtons:true})` + `offers`; else text `aiFailure(lang,{withButtons:false})` | `{status:'pending'}` | `needs_team` = `mergeNeedsTeam(wd.needs_team, {reason:'ai_failure', summary: joinedText.slice(0,200), at, …nulls})` when non-null; `slot_offers` when buttons | `ai_failure` |
| `NONE` | text `modelLine`, or interactive when `sanitizeButtons` keeps ≥ 1 id (then `slot_offers`) | `current_state: nextStage` | — | — |
| `FLAG_FOR_TEAM` | `reason` ∉ FLAG_REASONS → `unknown`. `meeting` with a known time and (name or business) → `captureResult`. Else if `mergeNeedsTeam` returns null → text `modelLine` only. Else text `modelLine + \n\n + flagAck(reason === 'quote' ? 'quote' : 'other')` (no buttons) | `{status:'pending', current_state: nextStage}` | `needs_team` | `quote` or `needs_team` (none when merge returned null) |
| `HANDOFF_TO_HUMAN` | `isHandoffOpen` → text `modelLine` only; else `buildHandoff({reason: args.reason === 'person' ? 'person' : 'complaint' (abuse → complaint), tier:2, summary: args.summary \|\| joinedText, modelLine: firstLine(modelLine) \|\| handoffLead})` | from buildHandoff | from buildHandoff | `handoff` |
| `CAPTURE_TIME` | `timeText = args.time_text \|\| aiResult.lead?.preferred_time`; preview `mergeLead(wd.lead, leadPatch, leadMeta).lead`; if time and (name or business) → `captureResult`; else text `modelLine` (or `captureAsk` when `modelLine` has no `؟`/`?`) | `current_state:'close'` | `capture_pending:{slot_id:null, time_text: timeText, at}`; `leadPatch.preferred_time = timeText` | — |
| `NOT_NOW` | text `modelLine \|\| acks.notNow(lang)` | `current_state:'closed'` | `not_now_at`, `followups: []`, `capture_pending: null` | — |
| `OPT_OUT` | text `acks.optOut(lang)` (replaces the model line) | `current_state:'closed'` | `marketing_opted_out_at`, `followups: []`, `capture_pending: null` | — |

`captureResult(ctx, {preferredTime, timeText, modelLine, leadPatch})`: `lead` preview = `mergeLead(wd.lead,
leadPatch ?? {preferred_time: preferredTime ?? {text: timeText}}).lead`; `when = preferredTime?.start ?
acks.windowText(preferredTime, now, tz, lang) : timeText`; text = `join(modelLine, acks.captureAck({name: lead.name,
businessName: lead.business_name, when, lang}))`; `stateUpdate:{status:'pending', current_state:'captured'}`;
`workflowDataPatch:{capture_pending:null, ...(needs && {needs_team: needs})}` with `needs = mergeNeedsTeam(wd.needs_team,
{reason:'meeting', summary: when, at, …nulls})`; `leadPatch` (with `preferred_time`); `alert:{reason:'meeting', summary:
when}`; `kind` = `'button'` from buttons.js, `'reply'` otherwise; `action:'CAPTURE_TIME'`.

**D26 / GPT-6 #12 — acks from what was persisted.** `captureResult` also returns `capture = {requested /* the
normalised preferred_time asked for */, when, lang, modelLine, at}` and renders its messages with
`renderCaptureAck(capture, previewLead)`. `renderCaptureAck`: the stored `preferred_time` equals `requested` (same
`slot_id`, else same `start`, else same normalised `text`) → `captureAck({name, businessName: business_name, when})` from
the stored lead, `workflowDataPatch: {}`; otherwise (a staff-owned time the bot may not overwrite) → `relayed: true`,
`acks.captureRelayed({when, lang})` («وصّلت طلبك للوقت الجديد … للفريق»), `workflowDataPatch: {requested_time_change:
{text: requested.text || when, at}}`. The batcher calls it again with the lead `saveLead` returned and sends that text.

---

## 6. Layer 2b — Inbox API and page

### 6.1 `backend/src/routes/inbox.js`

All new routes sit behind the existing `authenticate, attachBusinessId` and scope with
`conversation.findFirst({where:{id: req.params.id, business_id: req.businessId}})` → 404 `{error:'Conversation not found'}`.
Imports: `db/jsonb` (`patchJson`), `workflows/shift/lead` (`saveLead`), `workflows/shift/acks` (`claimAck`,
`pickLanguage`), `services/whatsapp` (`sendText`, existing `sendTextMessage`), `utils/serviceWindow`.

| Route | Contract |
|---|---|
| `GET /conversations` | Existing query plus: `needs_team=1` → `where.status = 'pending'` (overrides `status`); `stage=<s>` (must be in `STAGES`, else 400 `{error:'invalid stage'}`) → `where.current_state = s`. After fetching the page: `awaiting = message.findMany({where:{conversation_id:{in: ids}, direction:'inbound', status:'awaiting_staff'}, select:{conversation_id:true}})` → each conversation gets `awaiting_staff: <count>`; stable sort `pending` first, then the existing `last_message_at desc`. Response shape unchanged plus the new field. |
| `PATCH /conversations/:id/lead` | Body `{lead?: object, version?: int, needs_team_resolved?: boolean}`. Whitelist lead keys: `name, business_name, sector, sector_text, city, need (string[]), preferred_time (string → {text}), budget_note, language, interest`; unknown keys → 400 `{error:'invalid field', field}`. If `lead` has keys: `r = saveLead(id, lead, {source:'staff', msgId:null, at: now ISO, inboundText:''}, {expectedVersion: version})` (omit option when `version` is undefined); `r.conflict \|\| !r.ok` → 409 `{error:'version_conflict', lead: r.lead}`; a saved `preferred_time` with a stored `workflow_data.requested_time_change` → `patchJson(workflow_data, {}, {remove:['requested_time_change']})` (staff answered it, D26). If `needs_team_resolved === true` and the read `needs_team` exists unresolved: **D27** `jsonb.resolveNeedsTeam(id, {match: {reason, at} as read, resolvedAt: now ISO})` — resolved_at and `pending → open` in one conditional statement; a newer request recorded meanwhile is left untouched and pending. Response `{conversation, needs_team_resolved: boolean}` from `conversation.findUnique`. |
| `POST /conversations/:id/claim` | If `status === 'human_takeover'` and `assigned_staff_id` ≠ `req.user.id` → 409 `{error:'already_claimed'}`; same user → 200 `{conversation, ack:'skipped'}` (idempotent, no second ack). Else atomic `conversation.updateMany({where:{id, business_id, status:{not:'human_takeover'}}, data:{status:'human_takeover', ai_enabled:false, assigned_staff_id}})` (count ≠ 1 → 409 / idempotent 200); `patchJson(workflow_data, {stage_before_takeover})`; `mergeObjectKey(needs_team, {claimed_at, claimed_by})`. **D21:** for a `shift` business, `patchJson(metadata, {human_active_until: now + 30 min})` — all of this before any Graph call, so a bot run about to send is refused by its pre-send check. **Claim ack** only for `shift` and `isWithinServiceWindow(conv.last_inbound_at)`: `text = acks.claimAck({staffName, lang})`; `replyBatcher.dispatchIntent({business, conversation, token, kind:'claim_ack', parts:[{type:'text', text}], batchIds:[], precheck:{humanGuard:false}, now})` (D17 intent, id as `biz_opaque_callback_data`) with `sentByUserId: req.user.id`, so the intent row is the staff member's
message (`sent_by_user_id`, `is_ai_generated:false`) from its creation. Response `{conversation, ack: 'sent'\|'ambiguous'\|'failed'\|'skipped'}` (ack failure never fails the claim; the pause stays). |
| `POST /conversations/:id/release` | `conversation.update({data:{status:'open', ai_enabled:true, assigned_staff_id:null, current_state: wd.stage_before_takeover ?? conv.current_state}})`; `patchJson(workflow_data, {stage_before_takeover:null})`; `patchJson(metadata, {human_active_until:null, released_at: now})`; `awaiting_staff` rows → `received`. Response `{conversation}`. |
| `POST /conversations/:id/send` | Existing checks (404, 409 outside the window, token). **D21:** `patchJson(metadata, {human_active_until: now + 30 min})` **before** `sendTextMessage` (a failed send keeps the pause; D22 requeues parked rows when it expires). After the send (all businesses, logged not thrown): `patchJson(metadata, {human_active_until: now + 30 min, reply_failures: 0})` and `message.updateMany({where:{conversation_id, direction:'inbound', status:'awaiting_staff'}, data:{status:'answered'}})`. `received` rows are **not** touched (the batcher decides them). |
| `GET /stats` | adds `awaiting_staff: message.count({where:{business_id, direction:'inbound', status:'awaiting_staff'}})`; `pending` already exists. |
| `GET /updates` (SSE) | the `stats` event data becomes `{open, human_takeover, pending, awaiting_staff}` on connect and on every `new_message`. |
| `/takeover`, `/enable-ai`, `/resolve` | unchanged. |

### 6.2 `frontend/src/pages/InboxPage.jsx`

No new dependencies (React + lucide icons already imported). Components stay in the one file.

- Constants: `STAGE_LABELS = {opening:'بداية', discovery:'اكتشاف', fit:'ملاءمة', sample:'مثال', roleplay_setup:'تجهيز مثال',
  roleplay:'مثال جاري', objection:'اعتراض', close:'إغلاق', captured:'طلب مكالمة', handoff:'تحويل', closed:'مغلق'}`;
  `NEEDS_TEAM_LABELS = {quote:'عرض سعر', meeting:'مكالمة', person:'شخص', complaint:'شكوى', demo:'عرض تجريبي',
  unknown:'سؤال', ai_failure:'تعطّل البوت'}`.
- `ConvItem`: stage chip (when `current_state`); second line `sector · sector_text · business_name` from
  `workflow_data.lead` (skip empties); orange badge «يحتاج الفريق: {label}» when `status === 'pending'` and
  `workflow_data.needs_team` is unresolved; amber badge «بانتظار الموظف» when `conv.awaiting_staff > 0`.
- Filter `<select>` gains `<option value="needs_team">يحتاج الفريق</option>` → request `{needs_team: 1}` instead of
  `status`. The list is sorted client-side: `pending` first, then `last_message_at` desc.
- Chat header: window countdown from `last_inbound_at`: `closes = last + 24h`; open → «النافذة تسكر بعد HH:MM»
  (hours:minutes remaining, re-rendered every 30 s), past → red «النافذة مسكّرة — اتصل».
- Red banner above messages when `selected.metadata?.billing_blocked_at`: «واتساب موقف الإرسال — أضف طريقة دفع».
- «بطاقة العميل» panel (collapsible, above the reply box): rows for the whitelisted lead fields with inline edit
  (click → input → Enter/«حفظ» → `PATCH /inbox/conversations/:id/lead` with `{lead:{field:value}, version:
  lead.version ?? 0}`; 409 → reload the conversation and show «تعدّل من مكان ثاني — حدّثنا البطاقة»); buttons
  «تم التواصل» (`PATCH … {needs_team_resolved:true}`, visible when needs_team unresolved), «استلام» (`POST …/claim`,
  visible when status ≠ `human_takeover`), «إرجاع للبوت» (`POST …/release`, visible when status = `human_takeover`).
  Existing «تولي المحادثة» / «تفعيل AI» / «إنهاء» buttons stay.
- `MessageBubble`: unchanged except `status === 'awaiting_staff'` inbound shows a small «بانتظار الموظف» label,
  inbound `unconfirmed` shows «الرد غير مؤكد», outbound `ambiguous`/`ambiguous_unreconciled` shows «إرسال غير مؤكد» and
  outbound `cancelled` shows «ما انبعتت».
- `NEEDS_TEAM_LABELS.unsent_reply = 'بدون رد'`; an open `unsent_reply` request shows the red «بدون رد» badge (like
  `reply_failures ≥ 3`) instead of the orange «يحتاج الفريق» one.
- **GPT-6 #14:** `<LeadCard key={selected.id} …/>` — switching conversations remounts the card and its field rows, so no
  draft survives into another customer's card; each `LeadFieldRow` saves with the `lead.version` it started editing
  from (`onSave(key, value, version)`), so a change made meanwhile returns 409 instead of being overwritten.
- **D26:** `workflow_data.requested_time_change.text` shows under the team request as «العميل طلب وقت جديد: …» — the
  customer was told a time was passed to the team while staff own `preferred_time`; staff saving `preferred_time`
  clears it (§6.1).

---

## 7. Layer 3a — batching, message processing, webhook

### 7.1 `backend/src/services/replyBatcher.js`

```js
const LEASE_TTL_MS = 60000, AI_DEADLINE_MS = 18000, HUMAN_ACTIVE_MS = 30 * 60 * 1000, MAX_BATCH = 20, MAX_REPLY_FAILURES = 3;
const UNCONFIRMED_AFTER_MS = 2 * 60 * 1000;
quietWindowMs(text, env = process.env) → number
isShiftReplyAllowed(business, customerWaId, env = process.env) → boolean
isHumanActive(conversation, lastStaffOutbound, now) → boolean
scheduleReply(conversationId, { text = '', reason = 'inbound' } = {}) → void
touchBatchDue(conversationId, quietMs) → Promise<{dueAt, delayMs} | null>   // D25; DB errors propagate
hasPendingTimer(conversationId) → boolean
collectBatch(conversationId) → Promise<Message[]>
runBatch(conversationId, { now = () => new Date() } = {}) → Promise<{ outcome, sent }>
deliverResult({ business, conversation, result, batch = [], leaseToken = null, windowMarginMs = REPLY_WINDOW_MARGIN_MS,
                inboundStatus = 'answered', now = new Date(), humanGuard }) → Promise<DeliveryReport>
dispatchIntent({ business, conversation, token = null, kind, parts = [], batchIds = [], batchKey = null,
                 precheck = {}, inboundStatus = 'answered', since = null, sentByUserId = null, now = new Date() })
  → Promise<{ outcome: 'sent'|'ambiguous'|'failed'|'deduped'|'aborted', parts: [{index, status, reason, id, intentId}] }>
applyIntentStatus({ intentId, wamid = null, status }) → Promise<{ matched: boolean, intent? }>   // echoed sent/delivered/read
settleUndelivered(intentRow, { now, claimFrom = null, reclaimAnswered = false })
  → Promise<'requeued'|'escalated'|'dropped'|'unreconciled'|null>       // also for D19 `failed`
reconcileUnconfirmedIntents({ now = new Date(), businessId = null }) → Promise<{requeued, escalated, unreconciled, errors}>
                                // also rescues rows stranded `unconfirmed` by a crash mid-settlement (below)
cancel(conversationId) → void   // clears one conversation's pending timer (opt-out)
cancelAll() → void              // clears every timer (tests, shutdown)
```

**GPT-6 review addendum (D17, D18, D20, D23, D25, D26) — authoritative where the steps below disagree.**

- **Intent protocol (D17).** `dispatchIntent` is the only path from a bot/system message to Graph (the sweeper's SLA and
  awaiting notes and the Inbox claim ack use it directly, §8.1 / §6.1). Per part `i`: dedupe on `raw_payload.batch_key === \`${batchKey}:${i}\``
  against intents since `since` whose status is not `failed | ambiguous_unreconciled | cancelled` (a duplicate still
  `sending` is flagged `ambiguous` when `precheck.leaseToken` is set) → `message.create` the intent (`sending`,
  `raw_payload: {kind, batch_key, part_index, batch_ids, buttons, inbound_status}`; `sentByUserId` set → the row is
  written `{sent_by_user_id, is_ai_generated:false}` from the start — the Inbox claim ack) → `jsonb.preSendCheck(id, precheck)`
  (skipped only for `precheck === false`; refused → intent `cancelled` from `sending | ambiguous` — Graph was never
  called, even if another worker's `recoverCovered` flipped it to `ambiguous` meanwhile — and its `batchIds` rows still
  `unconfirmed` that no other `sending|ambiguous` intent covers → `received` + `scheduleReply`; remaining parts
  aborted) → `sendText` / `sendInteractiveButtons` with `{callbackData: intent.id}` → one immediate retry only when
  `retryable`, after the check again → **record** (`recordOutcome`): `message.update({where:{id, status:{in:['sending',
  'ambiguous']}}, data})` with `sent`+wamid / `ambiguous` / `failed`. A status webhook may settle the intent before the
  POST returns (GPT-6 #7): on P2025 the stored status stands (a missing wamid is attached with `updateMany({where:{id,
  meta_message_id:null}})`), so `delivered/read` never regress to `sent` and a D19-settled `failed` never becomes
  `sent`. The part's status follows the stored one: `sent|delivered|read` → `sent`; `failed|ambiguous_unreconciled|
  cancelled` → `failed` (reason `status_failed`). Then rows in `batchIds`: a sent part, or a duplicate that is
  confirmed → `inboundStatus` (from `received | awaiting_staff | unconfirmed`), then (unless a confirmed duplicate
  covers them) the sent parts are re-read: if none is still confirmed, the rows take the recorded
  `raw_payload.settled` (`requeued` → `received` + `scheduleReply`, `escalated` → `awaiting_staff`); else an ambiguous
  part or an unconfirmed duplicate → `unconfirmed` (from `received`).
- **Unknown outcome (D18).** `recoverCovered` marks rows from a confirmed intent (`sent|delivered|read`) with that
  intent's `inbound_status`; rows covered by a `sending`/`ambiguous` intent become `unconfirmed` (never `answered`, never
  resent; a `sending` one is flagged `ambiguous`); `failed`/`cancelled`/`ambiguous_unreconciled` cover nothing. No
  `ambiguous_send` alert at send time. `applyIntentStatus` (status webhook, by the echoed id): upgrades the intent status
  (never downgrades), stores the wamid if missing, and moves `unconfirmed | received` rows to `inbound_status`.
  `reconcileUnconfirmedIntents` takes `sending | ambiguous` intents older than 2 min and calls `settleUndelivered`, whose
  claim is `updateMany({where:{id, status (or status ∈ claimFrom)}, data:{status:'ambiguous_unreconciled', raw_payload:{…,
  settled, settled_at}}})`, then with `reclaimAnswered` the `batch_ids` rows `answered → unconfirmed`:
  no `batch_ids` → `unreconciled` + `ambiguous_send` alert; else if another intent of the conversation with the same
  `batch_key` has `settled: 'requeued'` (any status) → kind `optout` → `dropped`: rows `unconfirmed|received → skipped`
  + `ambiguous_send` alert, no needs_team, no `pending` (the opt-out is stored; staff are not asked to answer «إيقاف»
  and no awaiting note can follow it; counted as `unreconciled`); any other kind → `escalated`: rows `unconfirmed|received → awaiting_staff`,
  `needs_team = mergeNeedsTeam(stored, {reason:'unsent_reply', …})`, `status = 'pending'` unless `human_takeover`, alert
  `unsent_reply`; else `requeued`: rows `unconfirmed → received` and `scheduleReply(id, {reason:'sweep'})`.
  **Stranded rows** (same call, after the intents): inbound `unconfirmed` rows with `updated_at` older than
  `STRANDED_AFTER_MS = 5 min`, grouped by conversation, whose covering intents (`raw_payload.batch_ids`, kinds
  reply|fallback|handoff|button|media|optout) include no `sending|ambiguous` one. A confirmed covering intent can only
  mean the D19 path crashed between moving the rows and settling (§7.2) → `settleUndelivered(it)` then status `failed`;
  else the newest covering intent's `settled === 'dropped'` → rows `unconfirmed → skipped`; `settled === 'escalated'` → rows `unconfirmed → awaiting_staff` (count is the claim)
  + needs_team `unsent_reply` + alert; else rows `unconfirmed → received` + `scheduleReply`. Counts add to
  `requeued`/`escalated`.
- **Fencing (D20).** Every `renewLease` in `runLeased` (loop start, `onRetry`) that returns false ends the run with
  `lease_lost`. `deliver` passes `precheck = {leaseToken, humanGuard, optedOutSince}` with `humanGuard` defaulting to
  "kind ∈ reply|fallback|handoff|button|media" (notes and the opt-out ack are sent while staff hold the conversation)
  and `optedOutSince = batch[0].created_at` for every kind but `optout`. A result with `stateUpdate.status` writes status,
  current_state, `workflowDataPatch` (minus needs_team) and `needsTeamCandidate || needsTeam` in ONE
  `jsonb.writeConversationState(id, {…, priorities: NEEDS_TEAM_PRIORITY, defaultPriority: NEEDS_TEAM_PRIORITY.unknown})`
  (D27 / GPT-6 #13); without a status, `conversation.update` + `patchJson` as before. `writeConversationState`
  returning `ok:false` (claimed), a `patchJson` returning `ok:false`, or an aborted dispatch → `explainAbort`: lease not ours → `lease_lost` (rows left
  alone); staff hold → rows `awaiting_staff`, `awaiting_staff`; opted out → rows `skipped`, `skipped`.
- **Deterministic rows (D23).** After recovery, `runLeased` marks `reaction|system|ephemeral` rows `skipped`, and a text
  row that `isOptOutCommand` → `handleOptOut`: `deliverResult(optOutResult, batch:[stop], leaseToken, inboundStatus:
  'skipped')` (state written, then the ack intent, then the send; the command row leaves `received` only in the commit),
  then the other queued rows → `skipped` unless the delivery was `state_failed`/`lease_lost` (everything stays
  `received` and the retry takes the same path). This runs before the human and window checks. A STOP found by the
  freshness check discards the generated reply and takes the same path. Taps stay in `answerTaps`.
- **Shared debounce (D25).** `runBatch` first reads `metadata.batch_due_at`; more than 25 ms ahead → re-arms the local
  timer for `min(wait, SHIFT_BATCH_CAP_MS)` and returns `not_due` (no lease taken). `touchBatchDue` writes the deadline
  and arms the timer with the DB delay. A `fallback` result's batch is extended at dispatch with every `received` row
  that is not a tap, opt-out or reaction, so one burst gets one fallback.
- **Honest acks (D26).** For a result with `capture`, `saveLead` returning `!ok` (or no lead) aborts with `state_failed`;
  otherwise the parts are `renderCaptureAck(capture, leadSave.lead).messages` and `workflow_data.requested_time_change`
  is written (`null` when not relayed) before dispatch.

`quietWindowMs(text)`: `base = int(SHIFT_BATCH_QUIET_MS) || 2500`; words = `text.trim().split(/\s+/).filter(Boolean)`;
ends with `?`/`؟` (after trailing spaces/emoji) or ≥ 8 words → `round(base × 0.6)` (1.5 s); ≤ 4 words (incl. empty,
media) → `round(base × 1.6)` (4 s); else `base` (2.5 s).

`isShiftReplyAllowed` (D1): `reply_mode === 'external'` → false; `env.SHIFT_BOT_LIVE !== '0'` → true; else
`testNumbers.has(normalizePhone(customerWaId))` with `testNumbers = ai_config.test_numbers ∪ SHIFT_TEST_NUMBERS.split(',')`
(digits only, empty entries dropped).

`isHumanActive`: `conversation.status === 'human_takeover'` || `conversation.ai_enabled === false` ||
`metadata.human_active_until > now` || (`lastStaffOutbound` && `now − lastStaffOutbound.created_at < HUMAN_ACTIVE_MS`).

`scheduleReply` (in-memory, per instance): `timers: Map<id, {timer, firstAt}>`. `reason` ∈ {`sweep`, `reschedule`} →
`setTimeout(run, 0)` (no quiet window). `inbound` → `firstAt` = existing entry's or now; `delay = min(quietWindowMs(text),
max(0, firstAt + CAP − now))` with `CAP = int(SHIFT_BATCH_CAP_MS) || 10000`; clear the old timer; new timer runs
`runBatch(id).catch(log)` and deletes the map entry first. Timers are `unref()`ed.

`collectBatch` = `message.findMany({where:{conversation_id, direction:'inbound', status:'received'}, orderBy:{created_at:'asc'},
take: MAX_BATCH})`.

`runBatch` (outcomes: `no_batch | not_due | lease_busy | skipped | awaiting_staff | recovered | sent | fallback | failed |
ambiguous | window_closed | lease_lost`):
1. `token = crypto.randomUUID()`; `jsonb.acquireLease(id, token, LEASE_TTL_MS)` false → `lease_busy`.
   Everything below runs in `try { … } finally { jsonb.releaseLease(id, token) }`; after release, if
   `(await collectBatch(id)).length > 0` and the outcome was not `lease_busy`, call `scheduleReply(id, {reason:'reschedule'})`
   unless the outcome is `failed` with `reply_failures ≥ 3` or `awaiting_staff`/`skipped`/`window_closed`.
2. `conv = conversation.findUnique({where:{id}})`, `business = business.findUnique({where:{id: conv.business_id}})`,
   `batch = collectBatch(id)`; empty → `no_batch`.
3. Not SHIFT, not active, or `!isShiftReplyAllowed(business, conv.customer_wa_id)` → batch rows `skipped` → `skipped`.
4. **Recovery (commit failed after a send):** `recent = message.findMany({where:{conversation_id:id, direction:'outbound',
   created_at:{gt: batch[0].created_at}}, orderBy:{created_at:'asc'}})`; `covered` = union of
   `raw_payload.batch_ids` of rows with `raw_payload.kind` ∈ {reply, fallback, handoff, button, media} and status ≠
   `failed`; rows of `batch` in `covered` → `updateMany → 'answered'`; `batch` = the rest; empty → `recovered`.
5. `lastStaff = message.findFirst({where:{conversation_id:id, direction:'outbound', sent_by_user_id:{not:null}},
   orderBy:{created_at:'desc'}})`; `isHumanActive` → `updateMany({where:{id:{in}, status:'received'}, data:{status:
   'awaiting_staff'}})` → `awaiting_staff`.
6. `!isWithinServiceWindow(conv.last_inbound_at, now(), {marginMs: REPLY_WINDOW_MARGIN_MS})` → rows `skipped` →
   `window_closed`.
7. Generate: `renewLease`; `result = await processShiftBatch(business, conv, batch, {now: now(), deadlineAt: now() +
   AI_DEADLINE_MS, onRetry})` with `onRetry = async () => { await jsonb.renewLease(id, token);
   whatsapp.markAsRead(pnid, accessToken, newest.meta_message_id, {typing:true}); }`.
8. **Freshness (max 1 regeneration):** `fresh = collectBatch(id)`; if it contains ids not in `batch` and
   `regenerations === 0` and `result.kind !== 'fallback'` → `batch = fresh`, `regenerations = 1`, go to 7. A second
   newer set is left for the reschedule in step 1.
9. Re-read `conv2 = conversation.findUnique` and `lastStaff2`; `isHumanActive` → rows `awaiting_staff`
   (`awaiting_staff`); `conv2.workflow_data.marketing_opted_out_at` set after `batch[0].created_at` and
   `result.kind !== 'optout'` → rows `skipped` → `skipped` (the opt-out ack already went out).
10. `report = deliverResult({business, conversation: conv2, result, batch, leaseToken: token, now: now()})`;
    return `report.outcome` (and `fallback` when `result.kind === 'fallback'` and it was sent).

`accessToken` = `tokenCrypto.decrypt(business.wa_access_token)`; decrypt failure or empty → log, rows stay
`received`, `failed` (the sweeper alerts on inbound-without-outbound).

`deliverResult` (also used by messageProcessor for buttons/opt-out/media and by the sweeper for notes):
1. If `leaseToken` and `!(await jsonb.renewLease(conv.id, leaseToken))` → `{outcome:'lease_lost'}` (nothing written).
2. Window: `!isWithinServiceWindow(conv.last_inbound_at, now, {marginMs: windowMarginMs})` → batch rows `skipped`,
   `{outcome:'window_closed'}`. For `result.kind === 'optout'` the opt-out's `stateUpdate` (`current_state`) and
   `workflowDataPatch` are written first (D23: «إيقاف» is recorded even when no ack can be sent); a failed write →
   `{outcome:'state_failed'}` with the rows still `received`.
3. **State before send** (acks may only state what is persisted): if `stateUpdate` has keys →
   `conversation.update({where:{id}, data: pick(stateUpdate, ['status','current_state'])})`; if `workflowDataPatch`
   has keys → `patchJson('conversations', id, 'workflow_data', patch)`; if `leadPatch` → `saveLead(id, leadPatch,
   leadMeta)` (a `{ok:false}` is logged, not fatal). Any throw → `{outcome:'state_failed'}`; nothing is sent, rows stay
   `received`, `incrementCounter(... 'reply_failures')`.
4. For each part `i`: `batchKey = batch.length ? `${batch[batch.length-1].id}:${i}` : null`; if `batchKey` and an
   outbound in `conversation_id` has `raw_payload.batch_key === batchKey` (JS filter over `message.findMany({where:
   {conversation_id, direction:'outbound', created_at:{gt: batch[0].created_at}}})`) → skip part (`deduped`). Intent row: `message.create({data:{business_id, conversation_id, direction:
   'outbound', message_type: part.type === 'interactive' ? 'interactive' : 'text', text_body: part.type ===
   'interactive' ? `${part.text}\n${part.buttons.map(b => `[${b.title}]`).join(' ')}` : part.text, status:'sending',
   is_ai_generated: true, raw_payload:{kind: result.kind, batch_key: batchKey, part_index: i, batch_ids: batch.map(m =>
   m.id), buttons: part.buttons || null}}})`.
5. Send: `sendText` / `sendInteractiveButtons` (structured). `!ok && retryable` → one immediate retry. Then
   `message.update({where:{id: intent.id}, data: ok ? {status:'sent', meta_message_id: id} : reason === 'ambiguous' ?
   {status:'ambiguous'} : {status:'failed', raw_payload:{...intent.raw_payload, error, reason, code}}})`.
6. **Commit:** at least one part `sent` or `ambiguous` → (skipped when the batch is empty) `message.updateMany({where:{id:{in: batchIds}, status:{in:
   ['received','awaiting_staff']}}, data:{status: inboundStatus}})`, `conversation.update({data:{last_message_at: now}})`,
   `patchJson(metadata, {reply_failures: 0})`; ambiguous → `sendStaffAlert({reason:'ambiguous_send'})`.
   All parts failed → `n = incrementCounter('conversations', id, 'metadata', 'reply_failures')`; `reason === 'billing'` →
   `patchJson(metadata, {billing_blocked_at: now ISO})` + alert `billing` (every time; staff must act); `n === 3` → alert
   `reply_failures`. Rows stay `received`.
7. After a successful commit: `result.alert` → `sendStaffAlert({reason, business, conversation, summary})`
   (not awaited); `saveLead` returned `score ≥ 6 && previousScore < 6` → alert `hot_lead`;
   `sseEmitter.emit(`business:${business.id}`, {type:'new_message', conversationId, businessId})`.
8. `DeliveryReport = {outcome:'sent'|'ambiguous'|'failed'|'deduped'|'state_failed'|'window_closed'|'lease_lost'|
   'awaiting_staff'|'skipped', parts:[{index, status, reason, id}]}` (part status also `aborted`).

### 7.2 `backend/src/services/messageProcessor.js`

Exports: `persistInbound(entry)`, `processInboundMessage(entry, { persisted } = {})`,
`reprocessStuckInbound({ olderThanMs = 120000, now = new Date() } = {})`, `MEDIA_TYPES`.

`persistInbound(entry) → Promise<{ business: Business|null, items: PersistedItem[] }>` — **throws** on any DB error,
with `err.persisted = {business, items}` (the items committed before the error).
`PersistedItem = {waMsg, contact, customerWaId, conversation /* after counters when claimed */, message, created, claimed,
recovered: false}`; `claimed === created`: only the delivery whose transaction inserted the row processes it.
1. `value = entry?.changes?.[0]?.value`; no `value` or no `messages` → `{business:null, items:[]}` (statuses are not
   persisted here).
2. `business = business.findFirst({where:{wa_phone_number_id}, select: <existing select>})`; none → warn, `{business:
   null, items:[]}`; `status !== 'active'` → `{business, items:[]}`.
3. `inboundStatus = business_type === 'shift' && reply_mode !== 'external' ? 'received' : 'processing'` (D5, D24).
4. For each message in order: `getOrCreateConversation` (on P2002 from `conversation.create`, re-run `findFirst`); then
   **D24** `insertInbound`: `message.findUnique({meta_message_id})` → exists: duplicate (`created:false`). Otherwise one
   `prisma.$transaction(async (tx) => …, {maxWait: 2000, timeout: 4000})`: `tx.message.create({status: inboundStatus})`,
   `tx.conversation.updateMany({where:{id, OR:[{last_inbound_at:null},{last_inbound_at:{lt: msg.created_at}}]}, data:
   {last_message_at, last_inbound_at}})` (never backwards), `tx.conversation.update({data:{unread_count:{increment:1}}})`.
   A P2002 aborts the transaction and the message is a duplicate. A counter failure rolls the insert back (Meta's retry
   inserts it again). A commit whose outcome is unknown leaves the row committed but unprocessed: `received` rows are
   the SHIFT sweeper's; `processing` rows are `reprocessStuckInbound`'s.

`processInboundMessage(entry, {persisted})` — post-response, never throws (outer try/catch as today):
1. **Statuses (D17/D19).** For each status: `row` = `message.findUnique({id: status.biz_opaque_callback_data})` when it
   is a bot intent (`direction='outbound'` and `raw_payload.kind`), else `message.findUnique({meta_message_id:
   status.id})`. **No recipient/time matching**: no row → nothing is updated (reconcileUnconfirmedIntents settles the
   send it may belong to).
   - bot intent + `sent|delivered|read` → `replyBatcher.applyIntentStatus({intentId: row.id, wamid: status.id, status})`.
   - bot intent + `failed` → `failIntent` (every `failed` write is `where status notIn failed|ambiguous_unreconciled|
     cancelled`, not the status read: the POST may still be in flight): already settled → nothing. Not covering
     (`kind` ∉ reply|fallback|handoff|button|media, no `batch_ids`, or `inbound_status='skipped'`) → `failed` (+
     `raw_payload.status_error {code,title}`). Another covering intent for an overlapping `batch_ids` is
     `sent|delivered|read` → `failed` only. Otherwise its `answered` rows → `unconfirmed`; another covering intent still
     `sending|ambiguous` → `failed` (that intent's reconciliation settles the rows); else
     `replyBatcher.settleUndelivered(intent, {claimFrom: ['sending','ambiguous','sent','delivered','read'],
     reclaimAnswered: true})` (requeue once, then awaiting_staff + needs_team `unsent_reply` + alert) and the intent's
     status is set back from `ambiguous_unreconciled` to `failed` (`raw_payload.settled` kept). GPT-6 #7: the claim
     accepts an intent still `sending` or just turned `sent`, answered rows written by the batcher after the first move
     are taken back after the claim, and the batcher's commit re-reads its sent parts (§7.1) for the remaining order.
   - any other row (staff, restaurant/clinic, ingest) → `message.updateMany({where:{id}, data:{status}})` as today.
   - `failed` with `errors[0].code === 131042` on a SHIFT business → `patchJson(metadata, {billing_blocked_at})` + alert
     `billing`, on the row's conversation (by recipient only when no row matched).
2. No messages → return. `persisted ??= await persistInbound(entry)` (legacy callers, e.g. multiBusiness test).
3. `reply_mode === 'external'` → `forwardExternal`: SSE per claimed item, forward `value` when any item is claimed (as
   today), then the claimed rows → `delivered` (also when the forward failed: it is logged, never retried).
4. No token → return (claimed non-SHIFT rows → `delivered`, nothing could ever be sent).
5. Non-SHIFT → `processTenantItems`: today's restaurant/clinic/generic loop, unchanged; each claimed row → `delivered`
   after its workflow. A throw aborts the rest (as today) and leaves those rows `processing`.
6. **SHIFT** — for each claimed item in order (`msg = item.message`, `conv = item.conversation`, `text = msg.text_body`):
   a. `markAsRead(pnid, token, waMsg.id, {typing})`; SSE `new_message`.
   b. `!isShiftReplyAllowed(...)` → `message.update → skipped`; return.
   c. `waMsg.type` ∈ {reaction, system, ephemeral} → `await replyBatcher.runBatch(conv.id)` (D23: the leased worker
      skips it; a pending burst's `batch_due_at` is left alone, so runBatch returns `not_due` and the batch skips it).
   d. `waMsg.referral` → `saveLead(conv.id, {source:{type:'ctwa', referral: pick(referral, ['source_url','source_id',
      'source_type','headline','body','ctwa_clid']), confidence:'inferred'}}, {source:'referral', msgId: msg.id, at})`.
   e. Opt-out command or `replyBatcher.tapButtonId(msg)` → `replyBatcher.cancel(conv.id)`;
      `jsonb.touchBatchDue(conv.id, 0, SHIFT_BATCH_CAP_MS)` (the queued burst is due now on every instance; errors
      logged); `await replyBatcher.runBatch(conv.id)` (D23: handleOptOut / answerTaps under the lease; a busy lease →
      the running batch's freshness check takes it). The processor never marks these rows itself.
   f. Otherwise → `replyBatcher.touchBatchDue(conv.id, quietWindowMs(text))` (D25; on a DB error →
      `scheduleReply(conv.id, {text})`).

`reprocessStuckInbound({olderThanMs, now}) → Promise<{reprocessed, gaveUp, errors: string[]}>` (D24, for the sweeper):
1. Inbound `reprocessing` rows with `updated_at < now - olderThanMs` (a re-run that died) → claim → `delivered` and
   `console.error('[inbound] gave up …')`; counted in `gaveUp`. Never a third run.
2. Inbound `processing` rows with `created_at < now - olderThanMs` (≤ 50, oldest first) → claim `processing →
   reprocessing` (`updateMany`, count 1 = ours) → load business + conversation → external mode: forward the rebuilt
   `value` (`metadata.phone_number_id`, `contacts[{wa_id, profile.name}]`, `messages:[raw_payload]`; no
   `display_phone_number`) · SHIFT now out of external mode: → `received` · other tenants: `processTenantItems` ·
   inactive/missing: → `delivered`. A throw is pushed to `errors` and the row stays `reprocessing` (step 1 later).

### 7.3 `backend/src/routes/whatsapp.js` (D12)

```js
router.post('/webhook', async (req, res) => {
  // signature + JSON parse exactly as today (401 / 400)
  if (body.object !== 'whatsapp_business_account') return res.status(200).json({ status: 'ok' });
  const entries = body.entry || [];
  const budget = parseInt(process.env.WEBHOOK_PERSIST_BUDGET_MS, 10) || 4000;
  const persists = entries.map((e) => persistInbound(e));
  let persisted;
  try {
    persisted = await withTimeout(Promise.all(persists), budget); // rejects with Error('persist timeout') after `budget`
  } catch (err) {
    res.status(500).json({ error: 'persist_failed' });
    // Each persist that finishes (or fails with err.persisted) is processed by this delivery: Meta's retry finds
    // those rows stored and skips them.
    entries.forEach((e, i) => persists[i]
      .then((p) => p, (e2) => (e2 && e2.persisted) || null)
      .then((p) => (p && p.items.length ? processInboundMessage(e, { persisted: p }) : null))
      .catch(console.error));
    return;
  }
  res.status(200).json({ status: 'ok' });
  entries.forEach((e, i) => processInboundMessage(e, { persisted: persisted[i] }).catch(console.error));
});
```
`withTimeout` clears its timer when the promise settles. Status-only webhooks persist nothing and return 200.

---

## 8. Layer 3b — sweeper, internal routes, boot, config

### 8.1 `backend/src/services/shiftSweeper.js`

```js
runSweep({ now = new Date() } = {}) → Promise<SweepReport>
getShiftStatus({ now = new Date() } = {}) → Promise<ShiftStatus>
lastSweep() → { at: ISO|null, report: SweepReport|null }
isCloser(text) → boolean     // D22: only phrases from an explicit list («شكرًا», «تمام», «ok», «👍», «مشكور», «يعطيك العافية»…), no ?/؟
SweepReport = { skipped?: 'already_running', stuck_inbound: <reprocessStuckInbound result>|null,
                unconfirmed_requeued: n, unconfirmed_escalated: n, ambiguous_alerts: n /* unreconciled */,
                pause_requeued: n, orphans: n, sla_notes: n, awaiting_notes: n, window_flags: n, unanswered_alerts: n,
                errors: [string] }
```
A module-level `running` flag makes overlapping calls return `{skipped:'already_running'}`. First, once per run and for
every tenant, **D24** `messageProcessor.reprocessStuckInbound({olderThanMs: 2 min, now})` (required lazily; a throw →
`errors: 'stuck_inbound: …'`). Then each step runs per SHIFT business (`business.findMany({where:{business_type:'shift',
status:'active'}})`) inside its own try/catch (errors pushed to `report.errors`, never thrown), in this order.
`teamHours = resolveTeamHours(business.ai_config)`; `lang` per conversation = lead language, else `pickLanguage` of
the newest inbound text.

**Notes (D17/D21, GPT-6 #11).** Customer notes are send intents: `replyBatcher.dispatchIntent({business, conversation,
kind:'sla_note'|'awaiting_note', parts:[{type:'text', text}], batchIds:[], batchKey, precheck, since, now})`, only when
`isWithinServiceWindow(last_inbound_at, now, {marginMs: NOTE_WINDOW_MARGIN_MS})` (else outcome `window_closed`). A claim
names the request it is for and records when; after the dispatch returns (any outcome) the staff alert is sent and only
then the note is marked done. A claim older than `NOTE_CLAIM_TTL_MS = 2 min` that is not done is taken over; if an
intent row with `raw_payload.batch_key === \`${batchKey}:0\`` (any status) exists since `since`, the takeover only
alerts and marks done (outcome `already_dispatched`) and never dispatches again.

0. **Unconfirmed intents (D18)** — `replyBatcher.reconcileUnconfirmedIntents({now, businessId})`; its `requeued`,
   `escalated`, `unreconciled` add to the report, its `errors` are pushed as `unconfirmed <biz>: …`. The sweeper never
   changes an intent's status itself (the PR1 `sweepAmbiguous` step is gone).
1a. **Expired staff pause (D22, GPT-6 #10)** — pages (like orphans, ≤ 10 × 200 rows, excluding conversations already
   seen) of `awaiting_staff` inbound rows; per conversation: skip unless `isShiftReplyAllowed`; skip when
   `replyBatcher.isHumanActive(conv, newestStaffOutbound, now)` (claimed / `human_takeover`, `ai_enabled=false`,
   `human_active_until > now`, staff message < 30 min not released); else `message.updateMany(awaiting_staff →
   received)` excluding rows listed in `batch_ids` of an `ambiguous_unreconciled` (D18) or `failed` (D19) intent with
   `raw_payload.settled === 'escalated'` (those hand-offs wait for staff), and `scheduleReply(id, {reason:'sweep'})`. The batcher re-checks human
   state before replying, so a claim made after this read only parks the rows again.
1. **Orphans** — `message.findMany({where:{business_id, direction:'inbound', status:'received', created_at:{lt: now −
   30 s}}, orderBy:{created_at:'asc'}, take: 100})`, paged by conversation → skip when `metadata.reply_failures ≥ 3`
   (rows → `skipped` once the 24 h window closed) → `scheduleReply(convId, {reason:'sweep'})`.
2. **SLA note** — within team hours, `conversation.findMany({where:{business_id, status:'pending'}})`; eligible when
   `nt && !nt.resolved_at && !nt.sla_note_done_at && nt.reason !== 'ai_failure' && !wd.marketing_opted_out_at`, not a
   PR1-era claim (`sla_note_sent_at` set without `sla_note_attempt` = handled), no live claim (`sla_note_sent_at` < 2 min
   old), `teamMinutesBetween(nt.at, now) ≥ 15`, D1 gate open, and no staff outbound since `nt.at`. **Claim** =
   `jsonb.mergeObjectKey(workflow_data, 'needs_team', {sla_note_sent_at: now ISO, sla_note_attempt: n + 1}, {match:
   {at, reason, sla_note_sent_at (as read), sla_note_attempt (if read), resolved_at: null, claimed_at: null}})` — a
   request replaced or claimed meanwhile fails the match. `batchKey = sla_note:<reason>:<at>`, `since = nt.at`,
   `precheck = {humanGuard: true, optedOutSince: nt.at, claim: [{column:'workflow_data', path:['needs_team','at'], value:
   nt.at}, {column:'workflow_data', path:['needs_team','sla_note_attempt'], value: attempt}]}` (a claim or staff pause
   meanwhile cancels the note; so does losing the note claim — a sweep stalled past the TTL and taken over must not send
   what the other sweep sent). Outcome `aborted` with the claim no longer this sweep's (needs_team `at`/`reason`/
   `sla_note_attempt` changed) → return without alert or done mark. A meeting
   request with `lead.preferred_time` sends no note (outcome `skipped`). Alert `sla_breached` (summary carries the
   outcome); done = `mergeObjectKey(needs_team, {sla_note_done_at: now ISO}, {match: {at, reason}})`.
3. **Awaiting-staff note** — within team hours, `message.findMany({where:{business_id, direction:'inbound',
   status:'awaiting_staff', created_at:{lt: now − 10 min}}, orderBy:{created_at:'asc'}, take: 200})`, grouped by
   conversation; `silence` = rows after the newest staff outbound; skip if empty, if every row `isCloser`, or D1 gate
   closed. Identity = `silence[0].id`. Skip when `metadata.awaiting_note_done_for === id`, when `awaiting_note_for === id`
   (PR1-era claim), or when `awaiting_note_for === id#k` and `awaiting_note_claimed_at` is < 2 min old. **Claim** =
   `patchJson(metadata, {awaiting_note_claimed_at: now ISO})` then `claimValue(metadata, 'awaiting_note_for',
   \`${id}#${k+1}\`)`. `batchKey = awaiting_note:<id>`, `since = silence[0].created_at`, `precheck = {humanGuard: false,
   optedOutSince: silence[0].created_at, claim: [{column:'metadata', path:['awaiting_note_for'], value: \`${id}#${k+1}\`}]}`
   (the customer is waiting for the person holding the conversation; never after an opt-out during the silence; never
   by a sweep whose claim was taken over — that `aborted` returns without alert or done mark). Alert `awaiting_staff`; done =
   `patchJson(metadata, {awaiting_note_done_for: id})`. The rows stay `awaiting_staff`.
4. **Window closing** — `conversation.findMany({where:{business_id, last_inbound_at:{gte: now − 24 h, lte: now − 22 h}}})`;
   eligible when `status` ∈ {pending, human_takeover} or any `awaiting_staff` inbound exists
   (`message.count`) → `claimValue(metadata, 'window_flag_for', conv.last_inbound_at.toISOString())` → true →
   `patchJson(metadata, {window_closing_at: windowClosesAt(last).toISOString()})` + alert `window_closing`. No customer
   message.
5. **Inbound without outbound** (regardless of `reply_mode`/`SHIFT_BOT_LIVE`) — `conversation.findMany({where:
   {business_id, last_inbound_at:{gte: now − 60 min, lte: now − 2 min}}})`; `inb` = newest inbound; skip if
   `message_type === 'reaction'` or `status === 'awaiting_staff'`; skip if an outbound with `created_at ≥ inb.created_at`
   and status not in `failed | sending | cancelled | ambiguous_unreconciled` exists; `claimValue(metadata,
   'unanswered_alert_for', inb.id)` → true → alert `inbound_without_outbound`.

`getShiftStatus` (first active SHIFT business; none → `{workflow_active:false, business:null}`):
```js
{ business: { id, name }, workflow_active,      // status active && reply_mode !== 'external' && SHIFT_BOT_LIVE !== '0'
  reply_mode: ai_config.reply_mode ?? null, bot_live: SHIFT_BOT_LIVE !== '0', test_numbers_count,
  alert_channel_configured: alertChannelConfigured(business), model: resolveModel(), graph_version: graphVersion(),
  last_inbound_at, last_outbound_at,            // newest message per direction for the business (ISO or null)
  pending, awaiting_staff, received_backlog, unconfirmed, ambiguous,
  // counts: conversations status pending; inbound awaiting_staff; inbound received older than 60 s;
  // inbound unconfirmed (D18); outbound ambiguous | ambiguous_unreconciled
  sweep: lastSweep(), now: now.toISOString() }
```

### 8.2 `backend/src/routes/internal.js`

```js
function requireSweepToken(req, res, next) {
  const expected = process.env.INTERNAL_SWEEP_TOKEN;
  if (!expected) { console.warn('[internal] INTERNAL_SWEEP_TOKEN not set'); return res.status(503).json({ error: 'sweep_not_configured' }); }
  const header = req.headers.authorization || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'unauthorized' });
  next();
}
router.post('/sweep', requireSweepToken, async (req, res) => res.json({ ok: true, report: await runSweep() }));
router.get('/shift-status', requireSweepToken, async (req, res) => res.json(await getShiftStatus()));
```
Handlers wrap in try/catch → 500 `{error: message}`.

### 8.3 `app.js`, `server.js`, `validateEnv.js`, `cloudbuild.yaml`, runbook

- `app.js`: `app.use('/api/internal', require('./routes/internal'));` next to `/api/whatsapp`, **without `apiLimiter`**.
- `server.js`, inside the `listen` callback: `console.log(`[ai] model=${resolveModel()} graph=${graphVersion()}`)`;
  `require('./workflows/shift/buttons').assertButtons()`; when `process.env.NODE_ENV !== 'test'`:
  `setInterval(() => runSweep().catch((e) => console.error('[sweep]', e.message)), 60000).unref()`.
- `validateEnv.js`: nothing new in `REQUIRED_ALWAYS`/`REQUIRED_IN_PRODUCTION`. Add warnings only: production and
  `INTERNAL_SWEEP_TOKEN` unset → warn `INTERNAL_SWEEP_TOKEN is not set — /api/internal/sweep returns 503`; production and
  `STAFF_ALERT_WEBHOOK_URL` unset → warn `STAFF_ALERT_WEBHOOK_URL is not set — staff alerts go to WhatsApp numbers only`;
  `GRAPH_API_VERSION` set and not matching `/^v\d+\.\d+$/` → warn.
- `cloudbuild.yaml`: add `- '--no-cpu-throttling'` after `--platform=managed` in the deploy step. Nothing else.
- `backend/scripts/shift-runbook.md` (English, copy-paste ready): (1) status check `curl -s -H "Authorization: Bearer
  $INTERNAL_SWEEP_TOKEN" https://karambots.com/api/internal/shift-status`; (2) save-only / live via env:
  `gcloud run services update karambot --region=europe-west1 --update-env-vars SHIFT_BOT_LIVE=0` and `--remove-env-vars
  SHIFT_BOT_LIVE`; (3) `reply_mode` both directions — `UPDATE businesses SET ai_config = jsonb_set(ai_config,
  '{reply_mode}', '"external"', true) WHERE id = 'shiftc6f194e723be82b9b363';` and `UPDATE businesses SET ai_config =
  ai_config - 'reply_mode' WHERE id = 'shiftc6f194e723be82b9b363';`; (4) key-preserving edits for `test_numbers`,
  `team_hours`, `contact`, `alert_wa_numbers` with `ai_config || '{"team_hours": {...}}'::jsonb` (never a full
  rewrite); (5) Cloud Scheduler job: `gcloud scheduler jobs create http karambot-sweep --location=europe-west1
  --schedule="* * * * *" --uri=https://karambots.com/api/internal/sweep --http-method=POST
  --headers="Authorization=Bearer $INTERNAL_SWEEP_TOKEN"`; (6) verifying CPU allocation: `gcloud run services describe
  karambot --region=europe-west1 --format='value(spec.template.metadata.annotations)'`; (7) rollback order:
  `SHIFT_BOT_LIVE=0` → `reply_mode=external` → `git revert`. States that the owner, not Claude, runs these.

---

## 9. Sequences

Actors: **M** Meta · **W** `routes/whatsapp` · **P** `messageProcessor` · **B** `replyBatcher` · **S** `shift/index` ·
**G** Gemini · **DB** Neon · **T** staff Inbox · **SW** sweeper. `t` = seconds after the first fragment.

### 9.1 Three-message burst (eval #1)
```
t=0.0 M→W  msg A «مرحبًا… عندي كافيه زيتون… متى نحكي؟»   W→DB persistInbound: A status=received, counters   W→M 200
      W→P  process(A): markAsRead(A, typing) · SSE · gate ok · not opt-out/button → B.scheduleReply(c, text A)  [timer 1.5 s: ends with ؟]
t=0.8 M→W  msg B «بإربد» → DB B received → 200 → P → B.scheduleReply(c, «بإربد»)      [timer reset: 4 s, cap at t=10]
t=1.6 M→W  msg C «الاسم: محمد» → DB → 200 → P → B.scheduleReply(c, …)                  [timer reset: 4 s → fires t=5.6]
t=5.6 B    acquireLease(c, tok) ✓ · collectBatch = [A,B,C] · recovery none · human-active no · window ok
      B→S  processShiftBatch(biz, conv, [A,B,C], deadline t+18) → S→G attempt 1 (≤10 s) → JSON {action:NONE, buttons:[slot…], lead:{…}}
      S    toWorkflowResult → 1 interactive part (model line + offers), slot_offers patch, leadPatch
      B    freshness: collectBatch = [A,B,C] (no new) · re-read conv: not human-active
      B    deliverResult: renewLease ✓ → conversation.update(current_state) → patchJson(workflow_data) → saveLead(v1)
           → intent row (status sending, batch_key=C.id:0, batch_ids=[A,B,C]) → sendInteractiveButtons → ok wamid
           → row sent · A,B,C received→answered · last_message_at · reply_failures 0 · SSE
      B    releaseLease · collectBatch empty → done.  Result: 1 outbound, 1 AI call.
```

### 9.2 Quote request
```
C «كم السعر؟» → W persist → 200 → P → scheduleReply (1.5 s)
B runBatch → S → G: {reply:"سؤالك بمحله… بدك ردود بس ولا طلبات وحجوزات كمان؟", action:NONE}  → sent, answered
C «بس أعطيني رقم تقريبي» → … → G: {reply:"حتى الرقم التقريبي ما بقدر أخمّنه عليك…", action:FLAG_FOR_TEAM, action_args:{reason:'quote', summary}}
S results: mergeNeedsTeam(null, quote) → part text = model line + "\n\n" + flagAck('quote')
          stateUpdate {status:'pending'} · workflowDataPatch {needs_team:{reason:'quote',…}} · alert quote
B deliverResult: conversation.update(status pending) → patchJson(needs_team) → saveLead → [state persisted]
          → send (ack now states a persisted fact) → answered → alerts.sendStaffAlert(quote) (webhook + alert_wa_numbers)
Inbox: badge «يحتاج الفريق: عرض سعر», pending sorted first. ai_enabled stays true; next message gets a normal AI reply.
```

### 9.3 Human request, then SLA
```
C «بدي أحكي مع إنسان» → persist → P → scheduleReply → B runBatch → S: detectHumanRequest ✓ (no AI call)
S buildHandoff(tier 1): text «ولا يهمك.\n\nسجّلت طلبك بقائمة الفريق… ضمن الدوام (الأحد–الخميس 9–6). للاستعجال: …»  (no buttons)
  stateUpdate {status:'pending', current_state:'handoff'} · patch {handoff, human_requested_at, needs_team:person} · alert handoff
B deliverResult → state → send → answered → alert
C «لسه بستنى» (3 min) → S: AI runs with stage=handoff; action NONE → concierge one-liner (or isHandoffOpen → handoffRepeat on a repeated request)
SW +15 team-minutes, no staff outbound: claimFlag(needs_team.sla_note_sent_at) ✓ (a concurrent sweep gets false)
   → deliverResult(slaNote, window margin 30 min) → alert sla_breached.   After hours: no note.
T «استلام» → POST /claim → human_takeover, ai_enabled false, claimAck sent, human_active_until = now+30m
C «طيب وينكم؟» → persist → P → scheduleReply → B: isHumanActive ✓ → row awaiting_staff, no AI, no send
```

### 9.4 AI failure
```
B runBatch → S → G attempt 1 times out at 10 s → provider: remaining 8 s ≥ 1.5 s → onRetry (renewLease + typing) → attempt 2 throws
provider returns null → S toWorkflowResult(null): interactive «علّقت شوي — رسالتك محفوظة…» + [اليوم 4–6][بكرا 10–12][وقت ثاني]
  stateUpdate {status:'pending'} · needs_team ai_failure (unless a higher-priority one is open) · slot_offers · alert ai_failure
B freshness: no regeneration after a fallback · deliverResult → sent → answered → alert.  ai_enabled untouched.
Duplicate protection: batch_key = newest.id:0 · a crashed run that sent but did not commit is recovered by step 4 (no second fallback).
Send failure instead (Graph 5xx twice): row failed · reply_failures=1 · rows stay received → SW orphan (≥30 s) → retry; at 3 → alert, SW stops.
```

### 9.5 Staff reply mid-batch
```
t=0   C «عندي سؤال عن الحجوزات» → received → scheduleReply (2.5 s)
t=2.5 B lease ✓ · guards ok (no staff activity yet) → S → G generating (≈6 s)
t=4   T sends from Inbox → sendTextMessage → outbound row (sent_by_user_id) → patchJson(metadata.human_active_until = now+30m)
      → awaiting_staff rows → answered (none yet; the received row is left alone)
t=8.5 B freshness step 9: re-read conv + lastStaff → isHumanActive ✓ → received → awaiting_staff; nothing sent; release lease
t=8.6 C «تمام شكرًا» → received → scheduleReply → B: human-active → awaiting_staff
SW +10 min: silence set = awaiting rows newer than the staff outbound = [«تمام شكرًا»] → all closers → no note
      (the t=0 question predates the staff reply). Inbox shows «بانتظار الموظف» until the next staff send.
```

---

## 10. Test cases per file

Every file starts with `require('./setup')`. Layer-2/3 suites use `tests/helpers/fakeDb.js` (§2.2) unless noted.
Time-dependent tests pass `now`; timer tests use `jest.useFakeTimers()` and `await jest.advanceTimersByTimeAsync(ms)`.

**`tests/providerContract.test.js` (L1a, SDK mocked: `jest.mock('@google/generative-ai', …)`)**
1. legacy call: `getGenerativeModel` called with exactly `{model:'gemini-3.6-flash'}`; `generateContent` with the one concatenated string.
2. `GEMINI_MODEL` overrides; the default is not `gemini-2.0-flash`.
3. valid JSON in a ```json fence → parsed object; 4. invalid then valid → 2 calls, 2nd message ends with `CORRECTION_PROMPT`;
5. both invalid → `null`; 6. first call throws → `null`, 1 call; 7. a 404 model error → `null` and `console.error` called.
8. `validateAIResult` legacy cases from restaurant.test still hold (unknown action rejected, non-array `extracted_items`).

**`tests/provider.test.js` (L1a)**
1. `validActions` array replaces the default; 2. extra fields accepted; 3. a 21-code-point button title dropped, no retry;
4. `buttons` not an array → `[]`; 5. invalid action → one correction retry; 6. invalid `stage` twice → returned without `stage`;
7. SHIFT shape: `systemInstruction`, `responseMimeType:'application/json'`, `responseSchema`, user turn in `contents`;
8. `GEMINI_TEXT_MODE=1` → no `systemInstruction`, concatenated text; 9. deadline split: attempt 1 timeout = min(10 s, remaining),
attempt 2 gets the remainder, total ≤ 18 s (fake timers, never-resolving mock); 10. `onRetry` awaited before attempt 2;
11. remaining < 1.5 s → no retry; 12. `retrySystemPrompt` used on attempt 2; 13. usage log line has `model, ms, in, out, conv, attempt`.

**`tests/whatsapp.test.js` (L1a, axios mocked)**
1. URL uses `GRAPH_API_VERSION` at call time, default `v24.0`; 2. `markAsRead` adds `typing_indicator:{type:'text'}` only with
`typing:true` and `WA_TYPING_INDICATOR=1`; never throws; 3. `assertInteractiveLimits` rejects 4 buttons, a 21-code-point title,
duplicate ids, a 1025-char body; accepts «اليوم 4–6»; 4. `sendText` ok → `{ok:true,id}`; 5. code 131042 → `reason:'billing'`;
6. `ECONNABORTED` → `ambiguous`, not retryable; 7. HTTP 503 → `server`, retryable; 8. `sendInteractiveButtons` payload shape
matches the plan's slot JSON; 9. `isWithinServiceWindow` export is the utils function (same reference).

**`tests/serviceWindow.test.js` (L1a, extend)** existing 10 cases unchanged, plus: `marginMs` 30 min excludes 23 h 45 m;
`now` as a function; `windowClosesAt`.

**`tests/alerts.test.js` (L1a)** webhook POST body `{text, reason, conversationId, businessId}`; webhook unset → skipped;
webhook 500 → resolves (no throw); WhatsApp number with `last_inbound_at` 2 h ago → `sendText` + outbound row; 30 h ago → skipped;
`alertChannelConfigured` both branches.

**`tests/jsonb.test.js` (L1b, `$executeRaw` spy)** 1. `patchJson` SQL contains `||` and `- ` with the patch JSON as a value, not
interpolated; 2. `ifVersion` adds the version predicate; count 0 → `{ok:false}`; 3. bad column → throws; 4. `acquireLease` SQL uses
`now()` and the token; rowCount 0 → false; 5. `renew/release` require the token; 6. `claimFlag` nested path adds the parent
predicate; 7. `incrementCounter` uses `$queryRaw` and returns `n`.

**`tests/fakeDb.test.js` (L1b)** interleaved writers keep siblings: batcher lease + staff `human_active_until` + sweeper
`awaiting_note_for` + staff PATCH lead on one conversation → all four keys present; lease expiry with `clock.advance(61000)`;
two `claimFlag` calls → one true; `ifVersion` mismatch; P2002 on duplicate `meta_message_id`.

**`tests/shiftLead.test.js` (L1b)** merge fills empties; confirmed value kept on a passing mention; «مش عمّان، إربد» replaces
`city`; staff edit wins and a later model patch cannot overwrite it; referral `source` never overwrites; `_prov` recorded;
`need`/`objections` append-dedupe; `objection:'price'` → `objections:['price']`; `customer_numbers` from inbound text only
(«ميزانيتي ٥٠ دينار» → `['50']`), never from the patch; `site_estimates` untouched; version increments once per change;
`computeScore` deltas; `saveLead` retries once on a version race (fakeDb) and returns `conflict` with `expectedVersion`.

**`tests/shift.test.js` (L2a, update)** — assertion changes allowed: (a) prompt contains `https://shifts-ai.com` instead of
the old domain and never `shifts-ai.store`; (b) `NONE keeps AI on` → `r.messages[0].text === 'أهلًا'`, `r.stateUpdate` has no
`ai_enabled`; (c) **HANDOFF_TO_HUMAN** → `stateUpdate` `{status:'pending', current_state:'handoff'}`, no `ai_enabled`,
text = model line + handoff ack, no `buttons`, `alert.reason === 'handoff'`; (d) `toWorkflowResult(null)` → `kind:'fallback'`,
`status:'pending'`, `workflowDataPatch.needs_team.reason === 'ai_failure'`, interactive with 3 buttons, no `ai_enabled`;
(e) the history test keeps its assertions (userMessage `'كم السعر؟'`, history labels). New: FLAG_FOR_TEAM quote → pending +
needs_team + `flagAck`; duplicate quote while unresolved → no ack, no alert; CAPTURE_TIME with name known → captured +
`captureAck`; OPT_OUT → `acks.optOut` replaces the model line; tier-1 pattern skips the AI (`generateValidatedAIReply` not
called); media-only batch skips the AI; mixed batch gets `mediaPrefix`; `capture_pending` + next batch → capture ack with
omitted segments; `processShiftBatch` passes `jsonMode`, `validActions`, `deadlineAt`; exception inside → fallback.

**`tests/shiftButtons.test.js` (L2a)** every row of the §5.9 fixture table; `parseSlotId` round-trip; `isShiftButtonId`;
`slot:*` with name+business → capture (pending, captured, needs_team meeting, alert meeting, ack contains «بكرا بين 10 و12
(الثلاثاء 15/9)»); without both → `captureAsk` with the purpose line containing `shifts-ai.com/privacy`; offer issued 13 h ago →
«الخيار هاد قديم»; `slot:other`; `lead_talk` → handoff without buttons; unknown id → null; `assertButtons` passes; opt-out
positives/negatives of §5.8; handoff pattern positives/negatives of §5.7.

**`tests/shiftAcks.test.js` (L2a)** hours/contact segments omitted when unset; after-hours opening words (Thu 20:00 → «يوم
الأحد الصبح», Mon 07:30 → «اليوم الساعة 9», Mon 19:00 → «بكرا الصبح»); `captureAck` with no name/business prints no «، »
artefacts; no Arabic script in any `en` output; `pickLanguage` (English → en, «mar7aba 3ndi salon» → ar, mixed Arabic+POS → ar).

**`tests/inbox.test.js` (L2b, extend; `acks` mocked; fakeDb)** existing 401 cases unchanged; `needs_team=1` → only pending;
invalid `stage` → 400; `awaiting_staff` count attached and pending sorted first; PATCH lead merges with `_prov.source='staff'`;
PATCH with a stale `version` → 409; PATCH on another business's conversation → 404; `needs_team_resolved` → `resolved_at` + status
open; claim → human_takeover + ai_enabled false + `stage_before_takeover` + claim ack sent once (second claim by the same user →
`ack:'skipped'`, other user → 409); claim outside the window → no send; release restores the stage and AI; `/send` sets
`metadata.human_active_until` ≈ now+30 min and turns `awaiting_staff` rows into `answered` but leaves `received`; stats include
`awaiting_staff`. GPT-6 review: `/send` and `/claim` have the pause (and takeover) stored when Graph is called and the bot's
`preSendCheck` refuses at that moment (#6); the claim ack is an intent with `callbackData` = its row id; a failed ack keeps the
pause; a bot write landing right after the resolve keeps the new request pending (#13); `resolveNeedsTeam` fake semantics and
SQL text.
Re-verification (2026-09-15): `requested_time_change` is kept by other lead edits and cleared by a staff `preferred_time`.

**Re-verification regressions (2026-09-15), replacing the `_reverify_*` scratch suites.** `replyBatcher.test.js`:
`failed` processed while the POST is in flight (part failed, rows requeued, second send answers); `failed` between
the recorded wamid and the commit (rows take the requeue); a second in-flight failure escalates; `delivered` echoed
mid-POST stays `delivered`; an echoed `sent` confirms an ambiguous POST; a refused send another worker flipped to
`ambiguous` is cancelled and its rows requeued at once; an opt-out ack unconfirmed twice is `dropped`; #13 resolve
before / after the bot's single write, a stale equal-priority candidate recorded, an open equal-priority request kept,
a claim before the write. `shiftE2E.test.js` (ix) out-of-order `failed` end to end, (x) two sweeper instances with a
stalled note claim send the SLA note once. `sweeper.test.js`: the note prechecks carry the claim (and the awaiting
note `optedOutSince`), a lost claim skips alert and done mark. `jsonb.test.js` / `fakeDb.test.js`:
`writeConversationState` SQL and merge semantics, `preSendCheck` claim predicates. `whatsapp.test.js`: legacy sender
timeouts.

**`tests/replyBatcher.test.js` (L3a; fakeDb; `whatsapp`, `alerts`, `workflows/shift` index mocked where noted)**
1. three fragments within the window → one `runBatch`, one outbound, ≤ 2 `processShiftBatch` calls; 2. `quietWindowMs` 1.5/2.5/4 s
and the 10 s cap; 3. newer inbound during generation → exactly one regeneration with the larger batch, one outbound; 4. a third
fragment after the regeneration → sent + rescheduled; 5. lease contention: second `runBatch` → `lease_busy`, no send;
6. AI failure (index returns the fallback result) → exactly one fallback outbound, `status:'pending'`, `ai_enabled` unchanged;
7. human-active (staff outbound 5 min ago, or `human_active_until` future, or human_takeover) → rows `awaiting_staff`, no send;
8. staff send lands during generation → nothing sent, rows `awaiting_staff`; 9. window closed at send time → `skipped`;
10. `SHIFT_BOT_LIVE=0` → skipped, but a test number is answered; 11. intent row `sending` exists before the Graph call
(assert inside the send mock); 12. send ok + commit throws → next `runBatch` recovers (rows answered) with no second send;
13. `ambiguous` → row ambiguous, rows answered, alert, no retry; 14. retryable 5xx → one retry; 15. three failures → `reply_failures`
3 and one alert; billing → `billing_blocked_at` + alert; 16. state write before send: when `patchJson` throws nothing is sent;
17. clock skew: two inbound rows with `created_at` out of order are both in the batch (status-based); 18. `deliverResult` dedupes on
`batch_key`; 19. opt-out after batch start → no send. GPT-6 review (integration): a STOP row found after the 24 h window
closed still stores the opt-out, no ack; rows stranded `unconfirmed` → a confirmed covering intent (D19 crash) is settled
and requeued once and the new run sends; an `escalated` settle that crashed before moving rows → `awaiting_staff` +
`unsent_reply`; rows touched < 5 min ago are left alone. `processing` rows for non-SHIFT tenants, a counter failure that
leaves no row (rollback), and a status webhook that matches only by the echoed callback id replace the three PR1 processor
tests whose behaviour D17/D24 removed.

**`tests/webhook.test.js` (L3a, extend; `messageProcessor` mocked)** existing 5 cases keep passing; persist rejects (P1001) → 500;
persist slower than `WEBHOOK_PERSIST_BUDGET_MS=50` → 500 and `processInboundMessage` not called; persist ok → 200 and
`processInboundMessage(entry, {persisted})` called after the response; status-only payload → 200.

**`tests/multiBusiness.test.js` (L3a)** unchanged and green (legacy `processInboundMessage(entry)` persists once; duplicates
stored once). Add one case: a restaurant business ignores `SHIFT_BOT_LIVE=0` and still stores inbound as `delivered`.
Its hand-rolled Prisma mock gains `$transaction` (callback runs on the mock) and `id/status: {in}` in `updateMany`.

**`tests/webhookProcessor.test.js` (GPT-6 #1/#5/#7/#8; fakeDb, whose interactive `$transaction` rolls back; a local wrapper only adds `inTx()`)** D24: row +
counters inside one transaction; a counter failure leaves no row and the retry processes once; SHIFT sets
`batch_due_at`; restaurant/external rows `processing → delivered`; a duplicate never closes the other delivery's row;
`reprocessStuckInbound` re-runs once after 2 min (restaurant and rebuilt external forward) and gives up a dead re-run.
D17: no callback data → no recipient/time attachment; echoed id confirms exactly that intent and answers its rows; exact
wamid still updates staff rows and never moves an intent backwards. D19: first failure requeues, duplicate webhook
settles once, second failure escalates (`unsent_reply` + alert), exact-wamid match, delivered sibling part → no requeue,
note failure + billing banner. D23: opt-out under the lease, a failed opt-out state write leaves the row `received`, a
reaction does not cut a pending burst.

**`tests/webhookPersistRetry.test.js`** also: counter failure → nothing kept, retry forwards/counts once; a commit whose
outcome was lost → 500, retry 200 without a forward, `reprocessStuckInbound` forwards once.

**`tests/shiftE2E.test.js` (real app; fakeDb; Gemini SDK and axios mocked; jest fake timers; the sweeper called once a
minute as Cloud Scheduler does)** PR1 (a)–(j), plus the GPT-6 decisions end to end: (i) the instance dies after the intent
row and before Graph (pre-send check never returns) → after 2 min the sweeper requeues once, exactly one reply, the send
carries its intent id; (ii) Graph 502 → one POST, row `ambiguous`, inbound `unconfirmed`; the echoed `delivered` status
with `biz_opaque_callback_data` marks it answered and later sweeps settle nothing; (iii) 502 twice with no echo → one
requeue, then `awaiting_staff` + `needs_team.unsent_reply` + pending + one `unsent_reply` alert, never a third reply;
(iv) staff claim while the model generates → only the claim ack (a staff-attributed intent) goes out, rows
`awaiting_staff`; (iv-b) a claim committed inside the pre-send gap → intent `cancelled`, nothing sent (D20/D21); (v) staff
send, question at +5 min parked, pause over at +30 → `pause_requeued` 1 and the bot answers; (vi) a `failed` status for an
answered batch → one requeue and one new reply, a repeated webhook changes nothing; (vii) STOP on an instance that dies
before handling (read receipt never returns) → the orphan sweep applies the opt-out ack, no AI call; (viii) external
tenant, crash after persist and before the forward → `processing`, forwarded once by `reprocessStuckInbound`, `delivered`.

**`tests/sweeper.test.js` (L3b; fakeDb; `replyBatcher` and `alerts` mocked)** orphan > 30 s → `scheduleReply(reason:'sweep')`,
< 30 s → not; `reply_failures ≥ 3` → skipped; SLA: 16 team-minutes, no staff outbound → one note + alert; two concurrent
`runSweep` → one note; after hours → none; staff outbound since → none; opted out → none; ai_failure needs_team → none;
awaiting: question 11 min old → one note, a second sweep → none, a new silence after another staff reply → note again; closers
only → none; window 23 h old pending → flag + alert once; inbound 3 min without outbound → alert once, including
`reply_mode='external'`; overlapping call → `already_running`; `getShiftStatus` shape. GPT-6 review: `isCloser` phrase list
(«price please» is not a closer, #10); expired pause → rows `received` + run scheduled, not while paused / claimed / AI off / staff
message < 30 min, never for D18-escalated (`ambiguous_unreconciled`) or D19-escalated (`failed`) rows, paged past 200 held rows (#10); notes via `dispatchIntent` with request-keyed
`batchKey`; a stale unclaimed read loses the claim; a replaced request is not claimed; a crash before the intent is taken over after
2 min with exactly one note; a crash after the intent is finished without resending; PR1-era claims count as handled (#11);
`reconcileUnconfirmedIntents` called per business, old intents not flipped by the sweeper (D18); `reprocessStuckInbound` called
once per run even without a SHIFT business, failures reported (D24).

**`tests/internal.test.js` (L3b; `shiftSweeper` mocked)** no token env → 503; wrong bearer → 401; right bearer → 200 with report;
`/shift-status` same auth; the route is not rate-limited (101 calls → no 429).

**`tests/validateEnv.test.js` (L3b)** unchanged and green; add: production without `INTERNAL_SWEEP_TOKEN` warns but does not exit.

---

## 11. Cross-layer imports (exact names)

| Importer | From | Names |
|---|---|---|
| L1a alerts | whatsapp, serviceWindow, tokenCrypto, prisma | `sendText`, `isWithinServiceWindow`, `decrypt` |
| L1b lead | db/jsonb, prisma | `patchJson` |
| L2a shift/* | config/site | `SITE_URL`, `SITE_HOST`, `PRIVACY_SHORT` |
| L2a index | ai/provider, shift/lead | `generateValidatedAIReply`; `mergeLead` (preview only, via results) |
| L2b inbox | db/jsonb · shift/lead · shift/acks · shift/actions · whatsapp · serviceWindow | `patchJson` · `saveLead` · `claimAck`, `pickLanguage` · `STAGES` · `sendText`, `sendTextMessage` · `isWithinServiceWindow` |
| L3a replyBatcher | shift/index · shift/lead · db/jsonb · whatsapp · alerts · serviceWindow · tokenCrypto · sseEmitter | `processShiftBatch` · `saveLead` · `acquireLease`, `renewLease`, `releaseLease`, `patchJson`, `incrementCounter` · `sendText`, `sendInteractiveButtons`, `markAsRead`, `normalizePhone` · `sendStaffAlert` · `isWithinServiceWindow`, `REPLY_WINDOW_MARGIN_MS` · `decrypt` |
| L3a messageProcessor | replyBatcher · shift/optout · shift/lead · db/jsonb · alerts | `touchBatchDue`, `quietWindowMs`, `scheduleReply`, `runBatch`, `cancel`, `hasPendingTimer`, `tapButtonId`, `isShiftReplyAllowed`, `applyIntentStatus`, `settleUndelivered` · `isOptOutCommand` · `saveLead` · `patchJson`, `touchBatchDue` · `sendStaffAlert` |
| L3a routes/whatsapp | messageProcessor | `persistInbound`, `processInboundMessage` |
| L3b shiftSweeper | replyBatcher · messageProcessor (lazy) · db/jsonb · shift/hours · shift/acks · alerts · serviceWindow · ai/provider · whatsapp | `scheduleReply`, `dispatchIntent`, `reconcileUnconfirmedIntents`, `isHumanActive`, `isShiftReplyAllowed` · `reprocessStuckInbound` · `mergeObjectKey`, `claimValue`, `patchJson` · `resolveTeamHours`, `isWithinTeamHours`, `teamMinutesBetween` · `slaNote`, `awaitingStaffNote`, `pickLanguage` · `sendStaffAlert`, `alertChannelConfigured` · `NOTE_WINDOW_MARGIN_MS`, `windowClosesAt` · `resolveModel` · `graphVersion` |
| L3b routes/internal, server | shiftSweeper · ai/provider · whatsapp · shift/buttons | `runSweep`, `getShiftStatus` · `resolveModel` · `graphVersion` · `assertButtons` |

`replyBatcher.cancelAll` must also be exported for tests; `messageProcessor` uses it only through a per-conversation
`cancel(conversationId)` — export `cancel` as well (clears one timer).

---

## 12. Deviations from the plan/design (all minimal; reviewers check these first)

1. **Outbound status `sent`, not `accepted`** — matches production fact 3 and the existing status webhook.
   `ambiguous_unreconciled` is added so the sweeper's once-only alert is an atomic status transition (no raw SQL on
   `messages`).
2. **D1 gate closed → inbound `skipped`** (D5 lists skipped reasons; "gate closed" is one more), so the sweeper never
   loops on rows the bot is not allowed to answer. Staff still get the inbound-without-outbound alert.
3. **No intent row unique key** (D6 forbids constraints): dedupe = lease + JS check of `raw_payload.batch_key` + the
   recovery pass over `raw_payload.batch_ids`; no Prisma JSON-path filters so the fake DB stays simple.
4. **Reply window margin 60 s, note margin 30 min** — design §7.2 says 30 min for every send; applying it to a reply to
   a message received 23 h 40 m ago would silence a legal reply.
5. **Handoff patterns tightened** — `بدي أحكي مع` / `خليني أحكي مع` require a person object and bare `speak to` is
   narrowed, so «بدي أحكي مع زباين أكثر» and "the bot can talk to customers" do not hand off (design §7.1 intent:
   bare nouns never trigger).
6. **Opt-out regex adds `وقف(وا)? (بعت )?(ال)?(رسايل|رسائل)`** — eval #15(e) expects «وقف بعت رسايل» to be a
   deterministic opt-out; still whole-message and ≤ 4 words.
7. **Capture ack has no honorific** («محمد، …» not «أستاذ محمد، …») — the server cannot know gender; the model may still use
   honorifics in its own line.
8. **Slot tap captures only when name and business are both known** (design §6, eval #7); the model's `CAPTURE_TIME`
   still needs name *or* business (prompt doc). The next inbound after the compound ask always completes the capture.
9. **`needs_team.reason` gains `person`** (the plan's list has no value for a plain human request; the Inbox badge
   «شخص» needs it) and a priority rule so an AI failure never overwrites an open handoff.
10. **`processShiftBatch` returns `leadPatch`/`leadMeta` and `kind`** in addition to the task's shape — lead writes need
    the version-checked `saveLead`, and the batcher's recovery pass needs `kind`.
11. **Tier-1 handoff and media-only batches skip the AI call** — the handoff ack must not wait up to 18 s for a model whose
    line is fixed («ولا يهمك.»); PR2 may revisit.
12. **Plan items not in PR1:** single nudge (`SHIFT_NUDGES`), `followup_yes/no`, 09:00 digest, staff call tasks,
    OIDC on the sweep route, `--min-instances=1` (D3), `GEMINI_TEXT_MODE` as an SDK rollback (it is a prompt-shape flag only).
13. **`processShiftMessage` keeps its old history query** so the existing history test stays unchanged; the batch path
    uses id-based exclusion instead.
14. **The PR1 prompt keeps history inside the system prompt** (today's shape), so `systemInstruction` is not yet
    cache-stable; PR2's context builder moves history into the user turn (plan PR2 test list already expects that change).
15. **New statuses for D17/D18/D20 (no migration, `status` is a free string):** inbound `unconfirmed` (a covering send
    is neither confirmed nor settled — not `received`, which a run would answer again, and not `answered`, which the
    customer may not have) and outbound `cancelled` (an intent the pre-send check refused; it never reached Graph).
    `needs_team.reason` gains `unsent_reply` (priority 6), and `alerts.js` gains the alert reason `unsent_reply`.
