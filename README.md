# official-peekaboo-website-
Official Peekaboo indoor playground website source code

## Staff shortcut links

- WhatsApp inbox direct shortcut: `/whatsapp-inbox`
- Canonical inbox URL: `/staff?tab=inbox`
- Production direct link (your domain): `https://peekaboojor.com/whatsapp-inbox`
- Production canonical link: `https://peekaboojor.com/staff?tab=inbox`

## Payment Gateway Readiness (Capital Bank Jordan)

The backend supports a `PAYMENT_PROVIDER` switch with these options:

- `manual` (default): cash / CliQ flow
- `capital_bank`: Capital Bank CyberSource Hosted Secure Acceptance

### Capital Bank environment variables

Set the following in your backend runtime environment:

- `PAYMENT_PROVIDER=capital_bank`
- `CAPITAL_BANK_PROFILE_ID`
- `CAPITAL_BANK_ACCESS_KEY`
- `CAPITAL_BANK_SECRET_KEY`
- `CAPITAL_BANK_PAYMENT_ENDPOINT` (optional; alias: `CAPITAL_BANK_ENDPOINT`; defaults to `https://testsecureacceptance.cybersource.com/pay`)
- `CAPITAL_BANK_SECRET_KEY_ENCODING` (optional; alias: `CAPITAL_BANK_SECRET_KEY_ENCODE`; default: `auto`)

### Capital Bank flow implemented

1. Frontend calls `POST /api/payments/create-checkout`.
2. Backend computes booking amount on server side and creates a pending transaction.
3. Frontend redirects to `/api/payments/capital-bank/secure-acceptance/form/:sessionId`.
4. Backend signs Hosted Secure Acceptance fields and returns an auto-submit HTML form to CyberSource.
5. Callback endpoints update transactions atomically and redirect via:
   - `POST /api/payments/capital-bank/secure-acceptance/response`
   - `POST /api/payments/capital-bank/secure-acceptance/cancel`
   - `POST /api/payments/capital-bank/secure-acceptance/notify`
