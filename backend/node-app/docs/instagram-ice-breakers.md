# Instagram Ice Breakers API (Admin)

This backend exposes admin-only endpoints to manage Instagram DM ice breakers through Meta Graph.

## Required environment variables

- `META_ACCESS_TOKEN` (preferred) or `WHATSAPP_ACCESS_TOKEN` (fallback)
- `INSTAGRAM_BUSINESS_ACCOUNT_ID` (optional if passed per request)

## Endpoints

Base path: `/api/instagram/ice-breakers`

### Get current ice breakers

`GET /api/instagram/ice-breakers?instagram_business_account_id=<IG_BUSINESS_ID>`

### Set/replace ice breakers

`POST /api/instagram/ice-breakers`

Request body example:

```json
{
  "instagram_business_account_id": "17841400000000000",
  "ice_breakers": [
    { "question": "ما هي أوقات العمل؟", "payload": "hours" },
    { "question": "كيف أحجز جلسة؟", "payload": "booking" },
    { "question": "ما أسعار الاشتراكات؟", "payload": "subscriptions" }
  ]
}
```

Rules:
- Up to 4 entries.
- `question` is required and max 80 chars.
- `payload` is optional (defaults to `question`).

### Delete ice breakers

`DELETE /api/instagram/ice-breakers`

Body example:

```json
{
  "instagram_business_account_id": "17841400000000000"
}
```

## Notes

- Routes are protected by `authMiddleware` + `adminMiddleware`.
- This API sends requests server-side to Meta Graph under `platform=instagram`.
