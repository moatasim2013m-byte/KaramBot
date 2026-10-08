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
