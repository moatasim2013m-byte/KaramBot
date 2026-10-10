# Public self-signup («جرّب مجانًا») — P5

Built, and OFF (decisions-2026-10-08.md #1: the first ten shops are invite-only).

## Switching it on
«إعدادات المنصة» › «التسجيل الذاتي العام». Turning it on asks the operator to type
`افتح التسجيل العام`; the server checks it (`routes/adminPlatform.js`, `CONFIRM_TO_ENABLE`).
Changing the daily cap, or turning it off, needs no sentence. Every change is an AccountEvent
`platform_setting_changed`. It is refused while `es_owner_enabled` (owner self-connect) is off,
since a self-signed shop could not then connect WhatsApp without SHIFT; the page says so first.

## What a visitor sees
`app.shifts-ai.com/join` with no link and no session:
- on: a one-screen form — shop name, sector, owner name, mobile, password — then «أكّد رقم
  موبايلك» (below), then the same connect step an invited owner reaches after choosing a password;
- off: «التسجيل عبر دعوة من شِفت فقط» with a wa.me button to SHIFT and a login link.

## API (`routes/publicSignup.js`)
- `GET /api/public/signup/config` → `{enabled}`.
- `POST /api/public/signup {shop_name, sector, owner_name, owner_phone, password, website}` →
  201 `{token, user, verify: {code, text}}` (the /activate session shape, plus the code to send).
- `POST /api/public/signup/verify` (the new owner's session) → `{verified: false}` until the code
  has arrived; then `{verified: true}`; 409 when the proven mobile is already another account's.
- `POST /api/public/signup/verify/code` (the new owner's session) → a fresh code; the old stops counting.

## Proving the mobile
Nothing checked the typed mobile before the P5 review: a stranger could hold a shop owner's
mobile as their login (locking the real owner out of signup and of SHIFT's invite) and receive
that shop's alerts, and the 409 for a taken mobile told anyone who is a customer. Now:
- the signup holds the mobile nowhere: no `users.phone`, no `owner_phone`, no alert number; the
  answer is the same 201 for any mobile;
- the page shows a six-digit code and a wa.me link to SHIFT's number with «رمز تأكيد كرم بوت: …»
  filled in. The message is stored in SHIFT's inbox like any other (the sales bot answers it as a
  first message; its message path is not touched);
- `/verify` looks, read-only, for an inbound message on SHIFT's number **from that same mobile**,
  since the code was issued, carrying the code (Arabic-Indic digits too). Only a hash of the code is
  stored (AccountEvent `self_signup_code`). Then the mobile becomes the login, the owner number and
  the alert number (`self_signup_verified`), and SHIFT is told with the mobile;
- until then the session is the only way in: an owner who never proves the mobile cannot sign in
  again once it expires (7 days), and SHIFT sees the shop on the board as usual.

## Abuse controls, in order
1. Off → 503 «التسجيل عبر دعوة من شِفت فقط حاليًا.» before the body is read.
2. Per IP: 5 POSTs per 15 minutes → 429.
3. Honeypot `website` filled → 400, nothing written.
4. Daily cap (`self_signup.daily_cap`, default 5): today's `business_created` events with
   `data.source = 'self_signup'`, from midnight Asia/Amman → 429. Two racing requests can make it
   cap + 1; accepted at this size.
5. One mobile, one owner, checked when the mobile is proven (`/verify` → 409), never at signup.
6. Unchanged from invites: no Subscription until connect, and the cost guard's reply caps after it.
7. At connect, for `source 'self_signup'` only (`embeddedSignup.assertSelfSignupFree`): a Meta
   portfolio (`meta_business_id`) or a display number another open shop holds → `es_conflict`
   (`held_by 'portfolio'` or `'display_number'`), SHIFT told, the neutral «number taken» Arabic,
   before subscribe or any write. `assertNumberFree` still covers `phone_number_id` for everyone.

## What it writes
Business (`source 'self_signup'`, no number, sector greeting, no owner mobile or alert number
yet), an active owner User with no phone yet (signed in: `last_login` set, so the board shows
«يربط واتساب»), AccountEvents `business_created {source: 'self_signup'}` («سجّل صاحب المحل بنفسه
من «جرّب مجانًا»» in «السجل») and `self_signup_code`, and `notifyShift` reason `self_signup`
without the unproven mobile. The board card carries `source`.

Still open for this item: the «جرّب مجانًا» link on the marketing site (shifts-ai.com) itself. It is
an owner task, listed with its reason in `decisions-2026-10-08.md` «What still needs the owner».
