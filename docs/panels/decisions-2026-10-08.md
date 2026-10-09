# Ten customers — decisions taken by default (2026-10-08)

The owner said "proceed with all phases" before answering the decision questions in `spec.md`.
The recommended answer was taken for each, as a setting he can change without a deploy. Anything
here overrides `spec.md` where they differ.

| # | Question | Default taken | Where it lives |
|---|---|---|---|
| 1 | First 10: invite or public? | Invite link only. Public sign-up is built (P5) but off. | `PlatformSetting self_signup.enabled = false` |
| 2 | Who connects WhatsApp first? | SHIFT, attended, for the spare-SIM run (G1) and shops 1–2. Owners alone after that. | Operational; `PlatformSetting es_owner_enabled = false` until G1 passes |
| 3 | Owner login | Mobile + password, email optional | Migration 2 (P2) |
| 4 | Free month start | First real AI reply to a non-staff number, or 14 days after connect, whichever comes first. 30 days long. | `PlatformSetting campaign {trial_days: 30, trial_starts: 'first_reply', backstop_days: 14}` |
| 5 | Price after the free month | **19.99 JD/month**. This is the published price the sales bot already quotes (`workflows/shift/objectives.js`). 1,000 bot replies a month, 3 users. | `backend/src/config/plans.js` (snapshotted on each Subscription) |
| 6 | Monthly reply cap reached | Hard during the free month: chats go to the shop's staff, with at most one holding reply per conversation per day. Soft for paying shops: alerts only. | `plans.js` + `costGuard` |
| 7 | Daily AI ceiling, all shops | 2,000 replies a day. Free-trial shops stop first. | `PlatformSetting ai_limits` |
| 8 | Late payment | 7 grace days, then the bot pauses. Inbox and alerts keep working. | `PlatformSetting late_policy {grace_days: 7}` |
| 9 | Payment card at Meta | The owner's «أضفت البطاقة» is enough to continue. SHIFT confirms. A Meta 131042 refusal turns it red. | Code |
| 10 | Numbers in October | Fresh SIM. Coexistence is built (P5) but off. | `PlatformSetting coexistence.enabled = false` |
| 11 | Brand and payment details | «كرم بوت — من شِفت». The CliQ alias and IBAN are empty until the owner fills them in «إعدادات المنصة». The «كيف أدفع؟» card stays hidden while they are empty. | `PlatformSetting payment_instructions` |

## What still needs the owner, outside the code

- **G1, the first live Embedded Signup**: a spare SIM, a test business portfolio, and him at the
  keyboard. Until it passes, `es_owner_enabled` stays false, so customers never see the button.
- **App Dashboard**: confirm the onboarding cap (10 or 200 new customers a week). Confirm
  app.shifts-ai.com is in Allowed domains and Valid OAuth redirect URIs.
- **Production migration**: `backend/scripts/migrate-prod.sh`. Nothing in the pipeline runs migrations.
- **Before merging P0**: a read-only production check for businesses with `ai_config.enabled = false`.
  P0 starts enforcing that flag, so any such shop would go silent on deploy.
- **Merging**: every merge to `main` redeploys the live bot (Cloud Build trigger `^main$`).
- **The «جرّب مجانًا» link on shifts-ai.com** (P5's first item): only the `/join` side is built.
  The marketing site is deployed by hand (`python3 marketing/deploy.py`, not Cloud Build), and its
  landing page (`marketing/site/index.html`) is a self-contained React bundle exported from an
  artifact, so adding the button to `app.shifts-ai.com/join` is an edit to that export plus a
  manual deploy. Do it in the same sitting as switching `self_signup` on, never before (the page
  would say «التسجيل عبر دعوة فقط») and never long after (the switch would be on with no way in).
  Self-signup also needs `es_owner_enabled` on first: the settings page refuses it otherwise.

## P5 scope deliberately left for later

`spec.md` P5 ends with «Also: …». Built in P5: public self-signup (off) and coexistence (off). Not
built, on purpose, and not hidden anywhere in the code:

| Item | Why it waits | What would start it |
|---|---|---|
| Menu from a photo | An image model call per upload, a review screen for what it read, and a menu editor that can take a draft. None of it helps the first ten, whom SHIFT onboards by hand, and it costs per shop before there is a reply-count baseline. | Five or more shops asking for it, after the 30 days of reply counts P5 depends on. |
| Weekly WhatsApp digest to owners | Outside the 24-hour window it is a business-initiated template on each shop's own WABA, which Meta must approve per WABA (as with `owner_alert`), and each one is a paid message on the shop's card. The owner_alert template has to prove itself first. | `owner_alert` approved on most connected shops, and the owner choosing the digest's content. |
| A Modeer-style assignment rule | Needs staff with their own logins actually answering chats; the first ten are one-person shops where the owner answers. The inbox already lets staff assign a chat by hand (`assigned_staff_id`); an automatic rule is the missing part. | A shop with three or more active staff logins. |
| Token metering per shop | The spec makes it conditional: only if reply counts stop being a good proxy for cost. | The cost guard's numbers diverging from the provider bill. |
