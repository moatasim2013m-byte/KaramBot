# Meta Access Token Diagnostic

Use this when validating that a Meta token can access the expected user/page/business resources before wiring WhatsApp flows.

## Run

```bash
cd backend/node-app
npm run diagnose:meta-token
```

## Required env vars

- `WHATSAPP_ACCESS_TOKEN` (required)

## Optional env vars

- `META_APP_ID`
- `META_APP_SECRET`
- `META_GRAPH_VERSION` (default: `v25.0`)

When `META_APP_ID` and `META_APP_SECRET` are present, the script also calls `/debug_token` and prints token validity/scopes.

## What it checks

1. `GET /me?fields=id,name`
2. `GET /me/accounts`
3. `GET /me/businesses`
4. `GET /debug_token` (optional)

The script masks token values and only prints a short preview.
