# Coexistence: built, off (P5)

A shop's existing number stays in the WhatsApp Business app on the owner's phone, and Karam Bot answers on the same number through Cloud API. Decision #10 keeps it **off** for October: every shop connects a fresh SIM. Meta's requirements are in `meta-facts.md` Q4a–d.

## The switch

`PlatformSetting coexistence = {enabled: false}` by default. It is changed in «إعدادات المنصة» → «رقم واتساب موصول بتطبيق الهاتف». Switching it on means typing the sentence `routes/adminPlatform.js` `COEXISTENCE_CONFIRM` («نعم، فعّل الربط مع تطبيق واتساب للأعمال»). The PATCH refuses it without that sentence. Switching it off needs only a confirm.

The switch decides what is **offered**. A number already connected through coexistence keeps
working when it is switched off: its onboarding row (`finish_event
FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`, `step 'done'`, not removed) lets its echoes, history and
contacts through, so the owner's replies still hold the bot, and its open syncs still run.

While it is off, everything below is inert for every other number:

| Piece | Off (today) | On |
|---|---|---|
| Connect screen | No extra option (`/config` → `coexistence: false`) | «رقم المحل الحالي وعليه واتساب», which launches ES with `extras {featureType: 'whatsapp_business_app_onboarding', setup: {}}` |
| `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` | Subscribed, never registered, `needs_operator`, SHIFT alerted (unchanged) | Subscribed, **no /register**, linked to the shop, `done` |
| SHIFT's «أكمل الربط» on such a row | 409 `coexistence` | Links it without /register |
| `smb_app_data` syncs | Never called | Called at connect, retried by the sweep, alert at 20 h |
| Webhook `smb_message_echoes`, `history`, `smb_app_state_sync` | Logged and dropped (handled for a number already connected through coexistence) | Handled (below) |
| Bot | Unchanged | Stays quiet for 2 h in a chat where the owner just replied from the app |

## What happens when it is on

- **Connect** (`services/embeddedSignup.js`): `connectFromCode` reads the switch once. `runOnboarding` skips /register for the coexistence event and links the number. `afterConnect` calls `coexistence.startSync`, so every path that connects such a number triggers the syncs: the code exchange, a resume, and SHIFT finishing it.
- **The 24-hour syncs** (`services/coexistence.js`): `POST /{phone_number_id}/smb_app_data {messaging_product: 'whatsapp', sync_type: 'smb_app_state_sync'}` runs first, then the same call with `sync_type: 'history'`. Progress is recorded on the account's log:
  - `coex_sync_started` records `due_by` and is resolved once both syncs are done;
  - `coex_sync_done` and `coex_sync_failed` record each call;
  - `coex_sync_late` records the 20-hour alert.

  The minute sweep (`shiftSweeper.runSweep` → `coexistence.sweepSyncs`) retries the missing syncs at most every 10 minutes. It tells SHIFT once at 20 h (`notifyShift` reason `needs_operator`) and stops after 72 h. It does not retry a number Meta removed (ACCOUNT_OFFBOARDED), and it resumes after ACCOUNT_RECONNECTED.

  - **Meta's clock**: the 24 h run from the onboarding (`token_exchanged_at`, seconds after Meta's finish), not from the link. `coex_sync_started` records `onboarded_at`, `lag_ms` and a `due_by` from it, and the sweep's 20 h and 72 h are measured the same way. A row SHIFT finishes late, or a subscribe the owner resumes hours later, alerts SHIFT at once when the 20 h mark has already passed.
  - **Time budget**: the step runs inside the sweep's `running` flag, so it stops starting calls after 15 s (`SYNC_SWEEP_BUDGET_MS`) and leaves the rest as `deferred` for the next minute; what it spent comes off the daily step's 40 s. A slow Meta can no longer make the next sweep (SHIFT's own recovery, alerts and nudges) return `already_running`.
  - **One caller per number**: `startSync` on the connect request and a sweep on any instance take the number's lease (`businesses.ai_config.coex_sync_lease`, compare-and-set, 60 s) before calling `smb_app_data`, so no sync is asked for twice at once.
  - «السجل» names each step in Arabic: which sync was done or failed, the late alert, and a declined history.
- **Echoes**: each echo is stored once per wamid as the shop's outbound message (`is_ai_generated` false, `raw_payload {source: 'owner_app'}`). It moves `last_outbound_at` and sets `conversation.metadata.owner_app_until` to 2 h after the echo. `messageProcessor.runTenantWorkflow` skips the bot while that hold is in the future. If an echo's wamid is already stored as the bot's own send, nothing changes, so the bot never silences itself. A failed save answers 500, so Meta retries; a retry of an echo whose row was saved but whose hold was not still sets the hold.
- **History**: messages are imported once per wamid, in the background, and already settled (inbound `delivered`). An import does not change unread counts, `last_inbound_at` (the 24-hour window) or the waiting list. A chunk with `errors` (the owner declined to share history) is logged as `coex_history_unavailable`.
- **Contacts** (`smb_app_state_sync`): only the count is logged.
- **Isolation**: each field must name a number that a shop holds, arrive on that shop's WABA (`entry.id`), and come through the endpoint of the shop's Meta app. This is the same rule as `wabaIsolation.test.js`.
- **Removal**: `accountUpdate.js` already treats ACCOUNT_OFFBOARDED as a removal (`revoked_at`, `partner_removed`, alerts) and ACCOUNT_RECONNECTED as a recovery. `coexistence.test.js` covers both on a coexistence row.
- **Owner copy**: the connect screen and the connected card show `coexistence.NOTICE_AR`:
  - the 14-day rule: if the primary phone is inactive for about 14 days, Meta disconnects the number;
  - the 2-hour hold;
  - the 20 mps limit.

  A test keeps the two copies identical.

## Assumed, to replace in G1

The payload shapes for the three webhook fields come from Meta's docs and have not been recorded yet. They are in `backend/tests/fixtures/coexAssumed.js` and marked for replacement. Things still to confirm:

1. `entry.id` is the WABA and `value.metadata.phone_number_id` the number, on all three fields.
2. The field names: `message_echoes[]` (`to` = the customer), `history[].threads[].messages[]` with `history_context.status`, `history[].errors[]`, and `state_sync[]`.
3. Cloud API sends from a coexistence number do **not** come back as echoes. If they do, the wamid check already ignores them, but check that the echo arrives after our own row is saved.
4. What `smb_app_data` returns, and its error codes.
5. Whether `+962` is supported at all (Q4b, unverified).

## G1 test plan: one friendly Irbid number

Run this only after the fresh-SIM G1 has passed. Use one shop owner who agrees to it, on a number they can afford to lose for a day.

1. **Meta App Dashboard → WhatsApp → Configuration → Webhook fields**: subscribe `history`, `smb_app_state_sync` and `smb_message_echoes`, alongside `messages` and `account_update`. Without this, no echo arrives, and the bot will talk over the owner.
2. Check that the owner's WhatsApp Business app is 2.24.17 or later, on the primary phone (not Windows or WearOS).
3. Turn on `coexistence` in «إعدادات المنصة» by typing the sentence. Leave `es_owner_enabled` as it is: SHIFT connects attended, from the shop's «الحالة» tab.
4. Press «رقم المحل الحالي وعليه واتساب» and complete Meta's window with the owner, who scans the QR code in the app.
   - Expect «واتساب متصل» and the blue coexistence card.
   - The shop's «السجل» shows `coex_sync_started`, then two `coex_sync_done`. Save the server log and the raw webhook bodies.
5. Within the next hour, save the first `history` and `smb_app_state_sync` deliveries.
   - Check that the past chats appear in «المحادثات» with nothing marked as waiting.
6. Have a friend message the shop.
   - The bot answers.
   - The owner then replies from the app: the reply appears in «المحادثات» as the shop's message.
   - The friend writes again: the bot stays quiet for 2 h in that chat only. Check this with a second friend.
7. Save every new payload under `backend/tests/fixtures/es/coex/`, rewrite `coexAssumed.js` from them, and rerun the suite.
8. If a sync fails, the sweep retries it every 10 minutes. If it is still missing at 20 h, SHIFT gets the alert, with about 4 hours left before Meta's deadline.
9. Turn `coexistence` off again until the result has been reviewed. Numbers that are already connected keep working.

If Meta refuses the number (no `+962` support), the flow ends in Meta's window, and `es_failed` or `es_cancelled` carries Meta's `session_id` to quote to Meta support.
