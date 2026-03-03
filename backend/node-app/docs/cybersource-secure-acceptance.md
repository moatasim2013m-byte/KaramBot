# CyberSource Secure Acceptance (Capital Bank) - Node.js Integration

## Environment variables
Set on Cloud Run backend and redeploy after any change:

- `PAYMENT_PROVIDER=capital_bank_rest` (historical alias still maps to Secure Acceptance)
  - `PAYMENT_PROVIDER=capital_bank_secure_acceptance` (preferred explicit value)
- `CAPITAL_BANK_PROFILE_ID=capitalbjordan1_acct` (Account ID / Profile ID confirmed by bank)
- `CAPITAL_BANK_ACCESS_KEY=<bank access key>`
- `CAPITAL_BANK_SECRET_KEY=<bank secret key from Secret Manager>`
- `CAPITAL_BANK_SECRET_KEY_ENCODING=auto` (optional; alias: `CAPITAL_BANK_SECRET_KEY_ENCODE`; supports `auto`, `base64`, `hex`, `utf8`; set to `base64` if bank shared secret is explicitly base64)
- `CAPITAL_BANK_PAYMENT_ENDPOINT=https://testsecureacceptance.cybersource.com` (optional explicit override; alias: `CAPITAL_BANK_ENDPOINT`; backend appends `/pay`)

> Notes:
> - For ambiguous secrets (for example values made of only `0-9a-f` characters), set `CAPITAL_BANK_SECRET_KEY_ENCODING=utf8` explicitly.
> - You can also prefix the secret value itself with `utf8:`, `base64:`, or `hex:`.

## Implemented API flow
1. Client creates pending order transaction via existing checkout flow.
2. Frontend opens `/payment/capital-bank/:sessionId` and calls `POST /api/payments/capital-bank/initiate`.
3. Backend reads amount from `PaymentTransaction` only and returns signed Secure Acceptance form fields (`profile_id`, `access_key`, `transaction_uuid`, etc.).
4. Frontend auto-submits the form to Secure Acceptance hosted page (bank collects card data).
5. Backend processes `POST /api/payments/capital-bank/return` and optional `POST /api/payments/capital-bank/notify` callbacks idempotently.

## Security controls
- Secret key never logged.
- Amount sourced from DB transaction only.
- Card data is never captured by backend/frontend app servers.
- HTTPS enforced on Capital Bank endpoints.
- Idempotency guard via `metadata.processed_transaction_ids` for notifications.
- Global clickjacking headers remain enabled (`X-Frame-Options`, CSP frame-ancestors).

## Root-cause investigation checklist for "You are not authorized to view this page"
When Secure Acceptance shows the hosted error page (`...secureacceptance.cybersource.com`) before redirecting back, investigate in this order:

1. **Profile/access/secret mismatch**
   - Confirm `CAPITAL_BANK_PROFILE_ID`, `CAPITAL_BANK_ACCESS_KEY`, `CAPITAL_BANK_SECRET_KEY`, and `CAPITAL_BANK_MERCHANT_ID` are from the same CyberSource profile/account.
   - A mismatch here is the most common cause of immediate authorization rejection on the hosted page.

2. **Environment mismatch (TEST vs PROD)**
   - `CAPITAL_BANK_ENV=test` must use `testsecureacceptance.cybersource.com`.
   - `CAPITAL_BANK_ENV=prod` must use `secureacceptance.cybersource.com`.
   - Any cross-mix can produce hosted-page rejection before transaction processing.

3. **Secure Acceptance profile domain/config restrictions**
   - In CyberSource Business Center, verify the merchant profile is enabled for Hosted Checkout/Secure Acceptance and your production domain is whitelisted according to bank setup.
   - Check whether custom receipt/cancel URLs are allowed and match the configured merchant profile rules.

4. **Signature validation and payload completeness**
   - Check backend logs for `Secure Acceptance payload validation failed` and `Invalid signature` messages.
   - Ensure secret-key encoding (`CAPITAL_BANK_SECRET_KEY_ENCODING`) matches the format provided by bank (`base64` vs `utf8`/`hex`).

5. **Use callback metadata stored per transaction**
   - The callback now stores gateway diagnostics under `PaymentTransaction.metadata.gateway_callback` (`decision`, `reason_code`, `message`, `req_transaction_uuid`, etc.).
   - Use this metadata plus CyberSource error reference number from customer screenshot when opening a ticket with Capital Bank/CyberSource support.
