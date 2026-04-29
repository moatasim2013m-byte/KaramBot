# WhatsApp Cloud API Setup

## 1. Meta Developer Account

1. Go to https://developers.facebook.com
2. Create a new app → Business type
3. Add "WhatsApp" product to your app

## 2. Get Credentials

From your Meta app dashboard:
- `App Secret` → META_APP_SECRET in .env
- From WhatsApp → API Setup:
  - `Phone Number ID` → wa_phone_number_id in Business model
  - `WhatsApp Business Account ID` → wa_business_account_id
  - Temporary access token (or permanent system user token) → wa_access_token

## 3. Configure Webhook

In Meta app → WhatsApp → Configuration → Webhooks:
- URL: `https://yourdomain.com/api/whatsapp/webhook`
- Verify Token: same as `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in .env
- Subscribe to: `messages`

## 4. Test Webhook

```bash
curl "https://yourdomain.com/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=TEST"
# Should return: TEST
```

## 5. Send Test Message

Send a WhatsApp message to your business number. You should see:
- Message appear in MongoDB `messages` collection
- AI reply sent back to customer
- Conversation visible in dashboard Inbox

## Permanent Access Token (Production)

1. Create a System User in Meta Business Manager
2. Grant WhatsApp permissions
3. Generate a permanent token
4. Update via: `PATCH /api/businesses/:id/token` with `{ "wa_access_token": "..." }`
