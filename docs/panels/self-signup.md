# Public self-signup («جرّب مجانًا») — P5

Built, and OFF (decisions-2026-10-08.md #1: the first ten shops are invite-only).

## Switching it on
«إعدادات المنصة» › «التسجيل الذاتي العام». Turning it on asks the operator to type
`افتح التسجيل العام`; the server checks it (`routes/adminPlatform.js`, `CONFIRM_TO_ENABLE`).
Changing the daily cap, or turning it off, needs no sentence. Every change is an AccountEvent
`platform_setting_changed`.

## What a visitor sees
`app.shifts-ai.com/join` with no link and no session:
- on: a one-screen form — shop name, sector, owner name, mobile, password — then the same connect
  step an invited owner reaches after choosing a password;
- off: «التسجيل عبر دعوة من شِفت فقط» with a wa.me button to SHIFT and a login link.

## API (`routes/publicSignup.js`)
- `GET /api/public/signup/config` → `{enabled}`.
- `POST /api/public/signup {shop_name, sector, owner_name, owner_phone, password, website}` →
  201 `{token, user}` (the /activate session shape).

## Abuse controls, in order
1. Off → 503 «التسجيل عبر دعوة من شِفت فقط حاليًا.» before the body is read.
2. Per IP: 5 POSTs per 15 minutes → 429.
3. Honeypot `website` filled → 400, nothing written.
4. Daily cap (`self_signup.daily_cap`, default 5): today's `business_created` events with
   `data.source = 'self_signup'`, from midnight Asia/Amman → 429. Two racing requests can make it
   cap + 1; accepted at this size.
5. One mobile, one owner: a `users.phone` or `businesses.owner_phone` match → 409, naming no shop.
6. Unchanged from invites: no Subscription until connect, the cost guard's reply caps after it, and
   the duplicate check on the number / `meta_business_id` at connect (`assertNumberFree`).

## What it writes
Business (`source 'self_signup'`, no number, sector greeting, owner mobile as alert number), an
active owner User (signed in: `last_login` set, so the board shows «يربط واتساب»), AccountEvent
`business_created {source: 'self_signup'}`, and `notifyShift` reason `self_signup`. The board card
carries `source`.

Spec still open for this item: the «جرّب مجانًا» link on the marketing site (shifts-ai.com) itself.
