# WhatsApp Cloud API Webhook (Inbound)

## Routes

- `GET /api/whatsapp/webhook`
  - Used by Meta for webhook verification.
  - Reads query params: `hub.mode`, `hub.verify_token`, `hub.challenge`.
  - Returns `200` with plain challenge text when token matches `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
  - Returns `403` otherwise.

- `POST /api/whatsapp/webhook`
  - Accepts Meta webhook JSON.
  - Verifies `X-Hub-Signature-256` against the raw body using `META_APP_SECRET`.
  - Returns `401` for invalid signatures.
  - Returns `200` quickly for valid payloads (including unhandled events).
  - Safely parses `entry[].changes[].value` and logs summary info for `messages` and `statuses`.

## Environment variables

- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `META_APP_SECRET`
- `WHATSAPP_WEBHOOK_VALIDATE_SIGNATURE=true` (optional, defaults to enabled)

## Local test command

```bash
cd backend/node-app
npm run test:whatsapp-webhook
```

## Manual curl checks

### 1) GET verification success

```bash
curl -i "http://localhost:8080/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=$WHATSAPP_WEBHOOK_VERIFY_TOKEN&hub.challenge=123456"
```

### 2) GET verification failure

```bash
curl -i "http://localhost:8080/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=123456"
```

### 3) POST with invalid signature (expects 401)

```bash
curl -i -X POST "http://localhost:8080/api/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=invalid" \
  -d '{"object":"whatsapp_business_account","entry":[]}'
```

### 4) POST with valid signature (expects 200)

```bash
BODY='{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"messages":[{"from":"15551234567","type":"text"}],"statuses":[{"id":"wamid-1","status":"delivered"}]}}]}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$META_APP_SECRET" | sed 's/^.* //')

curl -i -X POST "http://localhost:8080/api/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$SIG" \
  -d "$BODY"
```

## Meta dashboard setup

1. In **Meta for Developers** -> your app -> **WhatsApp** -> **Configuration**.
2. Set **Callback URL** to your public backend endpoint:
   - `https://<your-domain>/api/whatsapp/webhook`
3. Set **Verify Token** to exactly the same value as `WHATSAPP_WEBHOOK_VERIFY_TOKEN` on your server.
4. Click **Verify and Save**.
5. Under webhook fields, subscribe to **messages**.
