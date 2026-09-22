# WhatsApp Embedded Signup (v4) — Tech Provider onboarding

How a business customer connects its own WhatsApp Business Account from the SHIFT
dashboard, and what SHIFT does automatically once they do.

Status as of 2026-09-22: **code complete, not yet run against a real WABA.** One owner
action blocks the first live test — the app secret. See
[Before the first live test](#before-the-first-live-test).

Commit: `528c37b1`.

---

## The flow

```
Dashboard (app.shifts-ai.com)                 Meta                     SHIFT backend
──────────────────────────────                ────                     ─────────────
[Connect WhatsApp]
   │ FB.login(config_id, response_type=code)
   ├──────────────────────────────────────────►
   │                                   signup UI
   │◄─── postMessage WA_EMBEDDED_SIGNUP FINISH
   │        (waba_id, phone_number_id, business_id)
   │◄─── authResponse.code  (lives 30 seconds)
   │
   └── POST /api/whatsapp/embedded-signup/exchange ──────────────────────►
                                                          1. code → business token
                                                          2. POST /<WABA>/subscribed_apps
                                                          3. POST /<PHONE>/register  {pin}
                                                          4. link to Business row
   ◄──────────────────────────────────── { status: connected, onboarding }
```

Everything after the code is server-to-server. Meta does not allow these calls from a
browser, and the business token must never reach one.

**Step 5 belongs to the customer:** they add a payment method in
[WhatsApp Manager](https://business.facebook.com/wa/manage/home/). Until they do,
business-initiated messages will not send. It appears as a required checklist item on
the connection card, not a footnote.

---

## Where the code lives

| Concern | File |
|---|---|
| Button and states | `frontend/src/components/whatsapp/ConnectWhatsApp.jsx` |
| SDK loader, origin check, `FB.login` | `frontend/src/utils/facebookSdk.js` |
| Mounted (admin-gated) | `frontend/src/pages/SettingsPage.jsx` |
| HTTP endpoints | `backend/src/routes/embeddedSignup.js` |
| The three Graph steps, resume logic | `backend/src/services/embeddedSignup.js` |
| Per-app secret lookup | `backend/src/utils/metaSecrets.js` |
| `account_update` webhook field | `backend/src/services/accountUpdate.js` |
| Multi-app signature validation | `backend/src/services/whatsapp.js` |
| WABA ownership on inbound | `backend/src/services/messageProcessor.js` |
| CSP for the Facebook SDK | `backend/src/app.js` |
| Schema + migration | `backend/prisma/schema.prisma`, `prisma/migrations/20260922090000_whatsapp_embedded_signup/` |
| Tests | `backend/tests/embeddedSignup.test.js`, `backend/tests/wabaIsolation.test.js` |

### Endpoints

All require `platform_admin` while the flow is being proven.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/whatsapp/embedded-signup/config` | app id, config id, Graph version (no secret) |
| `POST` | `/api/whatsapp/embedded-signup/exchange` | code + FINISH payload → runs onboarding |
| `POST` | `/api/whatsapp/embedded-signup/:id/retry` | resume a signup that failed at step 2 or 3 |
| `POST` | `/api/whatsapp/embedded-signup/events` | CANCEL / error events from the browser |
| `GET` | `/api/whatsapp/embedded-signup/status` | onboarding state for the checklist |

---

## Meta configuration (already done — do not change)

| Item | Value |
|---|---|
| App | SHIFT AI & Automation, **1065272896256103** |
| Business | 146400565185045 |
| Login config | SHIFT Embedded Signup, **1664627968720314** |
| Permissions | `whatsapp_business_management`, `whatsapp_business_messaging` |
| Status | Verified Tech Provider, advanced access approved |

Peekaboo runs on a **different** app (1910093982891948) and is untouched by any of this.

---

## Secrets

Nothing here is ever logged, returned to a client, or committed.

| Secret | Where it lives | Notes |
|---|---|---|
| App secret (ES app) | Secret Manager → `SHIFT_ES_APP_SECRET` | read at runtime, cached per process |
| App secret (legacy app) | Secret Manager → `META_APP_SECRET` | **do not overwrite** — the live webhook depends on it |
| Customer business token | DB, AES-256-GCM (`utils/tokenCrypto`) | never expires, so treated as a long-lived credential |
| Registration PIN | DB, AES-256-GCM | a 2FA secret, same protection as the token |

Graph errors are unwrapped to `error.message` before logging, because an axios error dump
carries the request headers — and those hold the bearer token.

### Why secrets are keyed by app id

One callback URL now receives traffic from two Meta apps: the legacy Karambot app for
numbers wired by hand, and the Tech Provider app for everything onboarded through
Embedded Signup. Each signs with its own secret, and the payload does not say which app
sent it, so a body is valid when it matches **any** configured secret. Every comparison is
constant-time.

---

## Resumability

`WhatsappOnboarding.step` is the resume point:

```
code_received → token_exchanged → subscribed → registered → done
```

- A failure records the step it reached, plus `last_error` and `last_error_at`.
- A retry continues from there using the **stored** token — the customer never runs
  Embedded Signup twice for the same number.
- A register retry reuses the **stored PIN**. A fresh PIN on every attempt would reset
  two-step verification under the customer.
- Rows are keyed on `phone_number_id` (unique at Meta), so running the flow twice for one
  number updates a single row instead of creating a rival.

---

## Tenant isolation

Once every customer's WABA delivers to the same callback URL, a phone number id alone no
longer proves ownership. Inbound is accepted only when **both** match:

- `value.metadata.phone_number_id` resolves to a business, **and**
- `entry[].id` (the WABA) equals that business's `wa_business_account_id`

A mismatch is dropped and logged, never delivered. Businesses onboarded before Embedded
Signup have no WABA recorded and still work.

`backend/tests/wabaIsolation.test.js` covers the dangerous shape directly — same
`phone_number_id`, different WABA — and asserts nothing is written to the other tenant's
inbox.

---

## Content Security Policy

Express serves the dashboard as well as the API, so `helmet()`'s CSP governs the page that
runs the SDK. The defaults allow `script-src 'self'` only, which blocks the Facebook SDK
and the frames it opens. `app.js` adds the facebook.com origins **on top of** the defaults
rather than replacing them:

```
script-src  'self' https://connect.facebook.net
frame-src   'self' https://www.facebook.com https://web.facebook.com https://staticxx.facebook.com
connect-src 'self' https://graph.facebook.com + the frame origins
img-src     'self' data: https://*.facebook.com
```

---

## Before the first live test

**1. Add the ES app secret to Secret Manager.** It is not there. The existing
`META_APP_SECRET` belongs to a different app — app 1065272896256103 rejects it with
`OAuthException code 190`. Do not overwrite it.

```bash
gcloud secrets create SHIFT_ES_APP_SECRET --project=karam-bot --replication-policy=automatic
# add the app secret for 1065272896256103 as a version, then map it into Cloud Run:
gcloud run services update karambot --region=europe-west1 \
  --update-secrets=SHIFT_ES_APP_SECRET=SHIFT_ES_APP_SECRET:latest
```

**2. Domain — nothing to do.** Run the flow on **https://karambots.com**, which is already
in both Allowed Domains for the JavaScript SDK and Valid OAuth Redirect URIs.

It serves the identical dashboard bundle from the same Cloud Run service and, unlike
`app.shifts-ai.store`, it answers 200 rather than redirecting — and a redirect does not
carry the SDK origin. `app.shifts-ai.com` is the everyday dashboard domain but is *not*
listed at Meta, so `FB.login` is blocked there until someone adds it. Either add it, or
use `karambots.com` for signups.

**3. Confirm two things I cannot read without that app's secret:**
- WhatsApp → Configuration → Webhook: callback URL points at the Cloud Run service's
  `/api/whatsapp/webhook`
- **`account_update`** is subscribed under webhook fields (Meta requires it for Embedded Signup)

**4. Apply the migration** — `npx prisma migrate deploy` runs on deploy.

Then: sign in as a `platform_admin`, open Settings, and run the flow with your own Meta
credentials before any customer sees the button.

---

## Known gaps

- **No live run yet.** The Graph calls are covered by tests with mocked responses; the real
  responses have not been seen.
- **Graph version drift.** Code defaults to `v24.0` (`GRAPH_API_VERSION` unset) while the
  app console is on v25.0. Frontend and backend read the same variable so they cannot
  diverge; set `GRAPH_API_VERSION=v25.0` on Cloud Run to move both.
- **v2/v3 deprecation:** Meta retires them **15 October 2026**. This is v4 only.
- **Secrets in plain Cloud Run env.** `TOKEN_ENCRYPTION_KEY` — the key protecting every
  stored WhatsApp token — is a plaintext env var, not a Secret Manager reference, as are
  `JWT_SECRET`, `GEMINI_API_KEY` and `INGEST_API_KEY`. Out of scope here, worth fixing.

## Reference

- [Embedded Signup implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
- [Onboarding customers as a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider)
- [Version 4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4)
