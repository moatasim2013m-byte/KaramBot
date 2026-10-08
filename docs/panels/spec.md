# Ten customers — the build spec (2026-10-08)

Produced by a design council (3 independent designs, 3 judges, 1 synthesizer) on top of a verified code map. The owner said "proceed with all phases" on 2026-10-08. Defaults for the decisions he had not yet answered are in `decisions-2026-10-08.md`; they override anything here that conflicts. Meta facts and their confidence are in `meta-facts.md`. Line references are to commit dc0ed6ee.

Artifact (owner-facing page with mockups): https://claude.ai/artifact/L1DaMKMq3KLs3gBRorDZpj

## Answer for the owner

Today, with 10 customers, you would type every shop in by hand, and only you can connect WhatsApp. That is why the panel looks like it is only for you. The plan is one app with two sides: your SHIFT panel, and a panel each shop logs into. To add a shop, you type its name, its type and the owner's mobile, then send one link from your own WhatsApp. The owner opens the link on their phone, picks a password and presses one green button, «اربط واتساب». Meta's window opens, and they log in to Facebook and verify the shop's number. When it closes, the shop's profile in your panel fills itself from Meta: the number, the WhatsApp name, the Meta account and the access key. You get a WhatsApp alert, and on a board you watch each shop move from «أُرسل الرابط» to «يعمل». Your «اليوم» screen lists only the shops that need you. The customers table shows each shop's stage, WhatsApp, bot, replies this month, free days left and payment. Each shop's own panel shows whether the bot is working, today's chats, and the questions the bot could not answer, with one tap to teach it. It also shows their plan, their payments and how to pay by CliQ. Before any customer gets the button, we close a hole that would let one shop take over another shop's account, and you run the flow once yourself on a spare SIM. The first 10 stay in your hands: only people you send a link to can join, and a public sign-up page waits until after them. Each shop adds its own card at Meta, which bills them directly, and both panels turn red if Meta refuses the bot's replies. A monthly reply limit per shop and a daily ceiling across all shops stop the free month from running up your AI bill. Meta may allow only about 10 new customers a week unless your higher limit is confirmed, so we check that before onboarding all 10. I need your answers on five things: the price after the free month, when the free month starts, login by mobile number, a fresh SIM or the shop's current number, and your CliQ details.

## Today vs target

- **Adding a customer** — today: «إضافة حساب شركة» asks for a slug and a WhatsApp Phone Number ID. The column is NOT NULL (schema.prisma:27), so the form fails without one and shows the raw Prisma error (businesses.js:115). The owner's login is a separate step on «الدخول», using a 72-hour link (activation.js:17). — target: «زبون جديد»: a 20-second form (shop name, type, owner's mobile). One transaction creates the profile without a number, plus the owner's login and a 7-day join link sent with «أرسل على واتساب» (a wa.me link, so free).
- **Who can connect WhatsApp** — today: The only button is on /settings, it is admin-only, and it is bound to the admin's own business_id (SettingsPage.jsx:279-284). The «الحالة» tab has no button, although the runbook says it does. Customers are told «فريق شِفت يربط الرقم معك» (whatsappStatus.js:27-32). — target: The owner presses «اربط واتساب» in the /join link or on their checklist. SHIFT can run the same flow for any shop from that shop's «الحالة» tab (the attended path).
- **Profile after Embedded Signup** — today: ES never creates or fills a Business. Without a business_id the row ends 'done', orphaned and invisible (services/embeddedSignup.js:219-233; admin.js:47). Nothing is read from Meta at signup. — target: The number links to the shop in the session, and the profile fills itself: number, display phone, WhatsApp name (verified_name), WABA, encrypted token, the verified portfolio id, quality and name status. No staff typing.
- **Safety of the flow** — today: business_id is taken from the browser, and /status, /:id/retry and /events are unscoped (routes/embeddedSignup.js:32,70-110). startOnboarding upserts onto whichever row matches a phone id, including another tenant's (services/embeddedSignup.js:107-127). — target: The business comes from the session or the URL only. Meta ids are verified on the server with debug_token, GET /{waba}/phone_numbers and GET /me. A number that belongs to another shop is refused before any upsert, subscribe or register.
- **Meta events** — today: Only the exact FINISH event is accepted (ConnectWhatsApp.jsx:68). A missing phone_number_id returns 400 and burns the 30-second code (routes:34-36). account_update is keyed on entry.id and ignores removal (accountUpdate.js:14,30-43). — target: Every FINISH_* event is accepted, and the phone id is found on the server when it is missing. account_update reads waba_info.waba_id first. Removal, deletion, offboarding and restrictions raise alerts, with a daily token check and send-error check as backup.
- **Seeing 10 customers** — today: Three nav items and one unsorted fleet list. The «N محادثة بانتظار رد» rule counts answered threads (admin.js:84-88), so the queue fills with noise. SHIFT's own row and the test rows are counted. — target: «اليوم», showing only what needs you. «الزبائن», with stage, WhatsApp, bot, replies against the cap, free days left and owner contact. The «الانضمام» board. Internal rows are hidden.
- **Alerts to SHIFT** — today: No alert when a customer signs up. A Gemini outage alert goes to whichever shop hits it first, throttled once an hour across all shops (provider.js:230-250; workflowAlerts.js:41-45). STAFF_ALERT_WEBHOOK_URL mixes every shop's end-customer messages (alerts.js:273-283). — target: SHIFT gets alerts from its own number: opened link, connected, stuck, live, removed, provider down, cost ceiling. Shops never receive SHIFT's provider alarms, and the webhook carries platform events only.
- **Pausing a shop's bot** — today: «تفعيل الذكاء الاصطناعي» is not enforced anywhere in the reply path. Setting the shop to «موقوف» stops inbound messages being saved at all (messageProcessor.js:331), and stops alerts too (newMessageAlert.js:170). — target: «أوقف البوت مؤقتًا» really stops replies. The inbox and new-message alerts keep working for paused and suspended shops.
- **AI cost** — today: No per-shop count and no limit. Token usage goes only to stdout logs (provider.js:47-48). — target: A monthly reply cap per shop (when reached, the bot hands chats to the shop's staff), a daily media-read cap, and a daily platform ceiling, all counted from message rows. «ردود الشهر» is shown in both panels.
- **Customer sees plan and payments** — today: GET /api/whatsapp/status returns the contract (whatsappStatus.js:146-149), but no screen shows it. — target: «الاشتراك»: plan, free-month countdown, payments, CliQ instructions, the late-payment policy in plain words, and who Meta bills.
- **Customer login** — today: Email only. The 72-hour link is issued by staff. No reset, and the first session lacks role and business_type (auth.js:155-158). — target: Mobile number (or email) plus password. The join link lasts 7 days. The first session is complete. A reset is one audited action by SHIFT, sent over WhatsApp.
- **Payment card at Meta** — today: Staff tick a box. The copy still says «قبل 30 أيلول» (services/embeddedSignup.js:255-258; whatsappStatus.js:97). — target: The owner presses «أضفت البطاقة», SHIFT confirms, and error 131042 turns both panels red. All the copy comes from one server constant.
- **Team** — today: «مدير» silently becomes «موظف» (auth.js:73-81). The owner types staff passwords, and seats are unlimited. — target: Members are invited by link, roles are honoured, and a seats meter shows «المستخدمون 2 من 3».
- **Who changed what** — today: admin_access_logs is written but never read. There is no record of settings changes or of who ran a signup. — target: One AccountEvent log: «السجل» on each shop, «آخر ما حصل» on «اليوم», and the history of Meta attempts.
- **Customer panel brand and shape** — today: Branded «واتساب AI» (DashboardLayout.jsx:103). Restaurant-shaped cards are shown to every business type. Desktop sidebar only. — target: «كرم بوت · مطعم الشام». Phone-first bottom tabs. A home screen that answers «البوت شغّال؟ ماذا حدث اليوم؟ ماذا لم يعرف؟», with tiles adapted to the business type.

## Signup flow
### Entry points
- Main October path, the operator-sent join link. On /admin/accounts/new, «زبون جديد» creates the draft profile (no number yet) and a 7-day link to app.shifts-ai.com/join#<token>. SHIFT sends it from the operator's own WhatsApp with «أرسل على واتساب» (a wa.me link, so free). Only people SHIFT sends a link to can join: this is the owner-led gate for the first 10.
- Attended path, used for gate G1 and the first 2–3 shops. On /admin/accounts/:id, tab «الحالة», the button «اربط واتساب لهذا الحساب» runs the same Embedded Signup bound to the account id in the URL, while the owner sits beside the operator or is on a call. This also makes docs/connecting-a-customer.md:54-55 true.
- The customer's own panel. «اربط واتساب» sits on the /overview checklist and on /settings › «واتساب». It covers a shop created without a number, a broken link («أعد الربط» after removal or an invalid token) and a number change («غيّر الرقم»).
- Later, not in October: «جرّب مجانًا» on shifts-ai.com links to app.shifts-ai.com/join with no token. It sits behind an off-by-default toggle, a daily cap and AI caps. Hosted ES is not used: it has no reference parameter to tie a signup to a SHIFT customer (Q8c).

### Steps
1. **SHIFT operator — «زبون جديد» /admin/accounts/new**
   - Sees: One card with no slug and no Meta ids. Fields: «اسم المحل», «نوع النشاط» as chips (مطعم · عيادة · صيدلية · صالون · محل ملابس · محل آخر), «اسم صاحب المحل», «موبايل صاحب المحل» (07XXXXXXXX), «البريد الإلكتروني (اختياري)», «المدينة» (إربد preselected) and «العرض» (preselected «حملة إربد — الشهر الأول مجاني»). Button: «أنشئ رابط الانضمام». A collapsed «متقدم» holds manual ids, for hand-wired numbers only.
   - Server: POST /api/admin/accounts runs one prisma.$transaction. (1) Business: wa_phone_number_id NULL; slug generated on the server (Latin letters from the name, otherwise shop-<6 random>); business_type mapped from sector (restaurant / clinic / generic); sector, city, owner_phone normalised to 9627XXXXXXXX (utils/phone.js normalizePhone); source 'invite'; ai_config.greeting_message from a sector template; ai_config.alert_wa_numbers = [owner_phone]. (2) The owner User: role business_owner, phone, email optional, active false, an unusable password (same shape as admin.js:511-525). (3) activation.issue(user.id, admin.id, {ttlHours:168}); activation.js:22 already accepts it. (4) AccountEvent invite_created. No Subscription is created yet, so shiftSweeper.offerPlacesLeft (shiftSweeper.js:1013-1027) does not count unused invites as taken places. Returns {account_id, join_url, wa_share_url}. A duplicate mobile returns 409 «هذا الموبايل مسجّل لحساب مطعم الشام».
2. **SHIFT operator — Result card «الرابط جاهز»**
   - Sees: A preview: «مرحبًا أبو خالد، هذا رابط تفعيل كرم بوت لمطعم الشام: app.shifts-ai.com/join#… — صالح 7 أيام ويستغرق نحو 10 دقائق. جهّز: الهاتف الذي فيه شريحة رقم المحل، وحساب فيسبوك، وبطاقة دفع لرسوم واتساب لدى Meta.» Buttons: «أرسل على واتساب», «نسخ الرابط», «افتح صفحة الزبون».
   - Server: The token travels only in the URL fragment, as /activate does today. Pressing «أرسل على واتساب» fires POST /api/admin/accounts/:id/events {type:'invite_shared'}, which moves the board card to «أُرسل الرابط». No paid message is sent.
3. **Shop owner — WhatsApp chat → /join**
   - Sees: They tap the link. If it opens inside an in-app browser (WhatsApp, Facebook or Instagram user agents), a full-width card says «افتح الرابط في Chrome أو Safari لتتمكن من ربط واتساب», with [افتح في المتصفح] (an Android intent link) and [نسخ الرابط]. Otherwise the welcome screen opens.
   - Server: POST /api/auth/activate/lookup {token}, extended, returns shop_name, owner_first_name, sector, phone_masked and role. Every failure gives the same 404, as today. The first open writes AccountEvent join_opened and sends notifyShift «أبو خالد فتح رابط مطعم الشام».
4. **Shop owner — /join, step «حسابك»**
   - Sees: «أهلًا أبو خالد» · «مطعم الشام على كرم بوت — من شِفت» · the strip «١ حسابك ← ٢ واتساب ← ٣ البوت» · «رقم الدخول: 079•••4567» (read only). One field, «اختر كلمة مرور (10 أحرف على الأقل)», with a show/hide eye, and the line «أنت وحدك تختار كلمة مرورك». Button: «التالي».
   - Server: POST /api/auth/activate consumes the single-use token (activation.consume): bcrypt hash, active=true, last_login, sessions_valid_from. It now returns user {id, name, role, business_id, business_type, business_name}, which fixes the half-empty first session (auth.js:155-158). It writes AccountEvent password_set.
5. **Shop owner — /join, step «اربط واتساب المحل»**
   - Sees: Two tap questions. «أي رقم سيرد عليه البوت؟» with [شريحة جديدة ليس عليها واتساب — الخيار الأنسب] or [رقم المحل الحالي وعليه واتساب]. The second answer opens «يجب حذف حساب واتساب من هذا الرقم أولًا، وستضيع محادثاته القديمة. الأفضل شريحة جديدة، أو تواصل مع شِفت.» Then «هل لديك حساب فيسبوك تستطيع الدخول إليه الآن؟» with [نعم] or [لا]; «لا» opens «يمكنك إنشاء حساب خلال دقيقتين، أو نربط معك» with [احجز 10 دقائق مع شِفت]. Then the big green button «اربط واتساب», enabled only once the Facebook SDK has loaded. Under it: «أسهل من الكمبيوتر؟ ادخل إلى app.shifts-ai.com برقمك وكلمة المرور».
   - Server: GET /api/whatsapp/embedded-signup/config, now open to business_owner when PlatformSetting es_owner_enabled is true. When the page mounts it preloads the Facebook SDK in ar_AR. The tap handler then calls FB.login synchronously, with no await before it, so the popup keeps the user gesture (today ConnectWhatsApp.jsx:94-102 awaits loadFacebookSdk first).
6. **Shop owner, in Meta's window — Meta Embedded Signup popup**
   - Sees: Meta's own screens: Facebook login, choose or create a business portfolio, create or choose the WhatsApp Business account, the display name, the number, and the SMS or voice code. SHIFT does not promise pre-filled fields; the v4 extras object is empty. Behind the popup our page reads «أكمل الخطوات في نافذة فيسبوك — لا تغلق هذه الصفحة».
   - Server: Nothing until the popup closes. FB.login uses config_id 1664627968720314, response_type 'code', override_default_response_type and extras {setup:{}}. The dead featureType '' and sessionInfoVersion '3' are removed (facebookSdk.js:80-84). After FB.login, a fire-and-forget POST /events {event:'LAUNCHED'} writes AccountEvent es_started. The browser keeps any WA_EMBEDDED_SIGNUP event whose name starts with FINISH. ERROR, and CANCEL carrying error_message, are errors. CANCEL carrying current_step is an abandonment. Either posts /events {event, current_step, error_message, error_code, session_id}, which writes AccountEvent es_cancelled for req.businessId only (never updateMany by phone id as at routes/embeddedSignup.js:90-94).
7. **Browser + server — /join «جارٍ الربط…» → «هل هذا رقم محلك؟»**
   - Sees: Ticks: «وصلت موافقتك» → «تحققنا أن الرقم يخصك» → «ربطنا الرقم بكرم بوت» → «سجّلنا الرقم لدى واتساب». Then: «هل هذا رقم محلك؟ ‎+962 7 9123 4567» · «الاسم الذي يراه زبائنك: مطعم الشام — تراجعه Meta، عادة خلال يوم أو يومين», with [نعم، أكمل] and [لا، ليس هذا الرقم].
   - Server: POST /api/whatsapp/embedded-signup/exchange {code, finish_event, waba_id?, phone_number_id?, meta_business_id?, session_id?}. The business is req.businessId; a body business_id returns 400. (1) exchangeCode first, inside the 30-second TTL. (2) verifyGrant: debug_token granular_scopes must list waba_id; GET /{waba}/phone_numbers must contain phone_number_id, or, when it is missing (FINISH_ONLY_WABA or no FINISH), exactly one number is taken; GET /me?fields=client_business_id gives the verified portfolio id. (3) If the number is on another Business, or an onboarding row of another business owns it: 409, AccountEvent es_conflict, SHIFT alert, and nothing written. (4) Upsert the onboarding with the session's business. A 'done' or revoked row of the same business is reset to token_exchanged with the new token (fixes the early return at services/embeddedSignup.js:146). (5) subscribed_apps. (6) register with the generated PIN, skipped (needs_operator) if the event is FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING. (7) linkOnboardingToBusiness writes wa_phone_number_id, wa_business_account_id, wa_access_token (already encrypted), wa_app_id, wa_display_phone, wa_verified_name, meta_business_id and connected_at. (8) metaStatus.refresh. (9) ensureTrialSubscription, idempotent. (10) AccountEvent es_connected, plus notifyShift «مطعم الشام ربط واتساب ‎+962 7 9… — التالي: بطاقة الدفع». [لا، ليس هذا الرقم] sets needs_operator, writes AccountEvent wrong_number and alerts SHIFT; nothing is rolled back automatically.
8. **Shop owner — /join «بطاقة الدفع لدى Meta»**
   - Sees: «آخر خطوة لدى Meta: بطاقة الدفع» · «تحاسبك Meta على رسائل واتساب مباشرة من بطاقتك حسب عدد الرسائل، ولا تمر هذه الرسوم عبر شِفت.» · «بدون بطاقة قد ترفض Meta ردود البوت.» Buttons: [افتح إعدادات الدفع في WhatsApp Manager], then [أضفت البطاقة] or [لاحقًا].
   - Server: POST /api/whatsapp/status/payment-method-claim sets WhatsappOnboarding.payment_method_claimed_at and writes AccountEvent payment_claimed. The checklist reads «بانتظار تأكيد شِفت». SHIFT confirms with the existing PATCH /api/admin/accounts/:id/payment-method (admin.js:772-799). Any later 131042 failure sets payment_blocked_at and turns both panels red.
9. **Shop owner — /join «علّم البوت عن محلك» (skippable)**
   - Sees: Sector starter cards. Generic shops get three cards: «الدوام» (chips: كل يوم 9ص–10م · السبت–الخميس 9ص–6م · غير ذلك), «الموقع والتوصيل» and «أكثر سؤال يسأله زبائنك» (a question and its answer). Restaurants get «أضف 3 أصناف بأسعارها», or «صوّر القائمة وأرسلها لشِفت على واتساب». Clinics get «أضف خدمة وسعرها ومدتها». Buttons: «حفظ والتالي», «لاحقًا».
   - Server: Existing session-scoped POST /api/knowledge, or the menu and clinic routes. A restaurant's first item auto-creates the category «الأصناف», because the UI cannot create categories (MenuPage.jsx:203-205). Writes AccountEvent knowledge_added.
10. **Shop owner — /join «جرّب البوت» (skippable) → /overview**
   - Sees: The existing tester with sector chips («ما أوقات الدوام؟», «هل عندكم توصيل؟», «بدي أحجز»). Then «جرّب الحقيقي: راسل رقم المحل من هاتف آخر» (wa.me/<display number>?text=مرحبا), and [افتح لوحتي].
   - Server: POST /api/whatsapp/status/test runs the real workflow as a dry run. Later, the first AI reply delivered to a non-staff number sets Business.went_live_at (updateMany where null) and starts the free-month clock if the owner chose that. It writes AccountEvent went_live and sends notifyShift «مطعم الشام يعمل — أول رد للبوت».
11. **SHIFT operator — «الانضمام» /admin/onboarding and «اليوم»**
   - Sees: The مطعم الشام card moves «أُرسل الرابط» → «يربط واتساب» → «بانتظار البطاقة» → «يعلّم البوت» → «بانتظار أول زبون» → «يعمل», with time in stage. A stuck card shows the reason, e.g. «أغلق نافذة Meta عند: التحقق من الرقم — منذ يومين», with [راسله] and [اربط معه]. After seeing the card in WhatsApp Manager, the operator presses «رأيت البطاقة — أكّد».
   - Server: GET /api/admin/onboarding derives each stage from stored data and AccountEvents. The stage is never stored, the same rule as the derived checklist at admin.js:278-293.

### Auto-filled profile fields
- Business.wa_phone_number_id ← FINISH phone_number_id, accepted only if GET /{waba}/phone_numbers lists it. When it is absent (FINISH_ONLY_WABA, or FINISH never arrived), the WABA's single number is used.
- Business.wa_business_account_id ← FINISH waba_id, accepted only if it is in the business token's debug_token granular_scopes target_ids. If FINISH never arrived, the token's only granted WABA is used.
- Business.wa_access_token ← the exchanged business token, AES-256-GCM via tokenCrypto (the same format the sender reads).
- Business.wa_app_id ← 1065272896256103 (META_ES_APP_ID). It selects SHIFT_ES_APP_SECRET for webhook signatures (PR #44 predicate).
- Business.wa_display_phone (new) ← Graph display_phone_number, e.g. ‎+962 7 9123 4567. It is what customers and staff see, never the id. Today metaStatus.js:82 reads it and throws it away.
- Business.wa_verified_name (new) ← Graph verified_name, shown as «الاسم عند Meta». It never overwrites Business.name, which the operator typed.
- Business.meta_business_id (new) ← GET /me client_business_id from the business token (verified on the server). FINISH data.business_id is kept for comparison, and a mismatch is flagged needs_operator.
- Business.connected_at (new) ← time of the successful exchange. Business.went_live_at (new) ← the first AI reply delivered to a non-staff number.
- WhatsappOnboarding.meta_name_status, meta_quality_rating, meta_number_status, meta_throughput, meta_review_status, meta_checked_at ← metaStatus.refresh run immediately after linking, so the Meta panel is never empty.
- WhatsappOnboarding.finish_event, session_id and started_by_user_id ← from the exchange request and session. Today nothing records who ran a signup.
- Subscription (trial) ← created once at connect, never at invite: solution 'karam_bot', status 'trial', amount_jod = price after the free month, campaign 'irbid-2026-10', ai_replies_month and seats from backend/src/config/plans.js, starts_at = connected_at, trial_ends_at per the owner's decision.
- ai_config.alert_template ← the owner-alert utility template, auto-submitted to the shop's WABA after connect and set once Meta approves it. Without it, handoff alerts to the owner outside 24 hours are skipped (alerts.js:192-195).
- From the «زبون جديد» form, not from Meta: name, sector, business_type, city, owner_phone, slug (server), the owner User (name, phone, optional email), ai_config.greeting_message (sector template) and ai_config.alert_wa_numbers [owner_phone].
- Never auto-filled: the payment card (no Tech Provider read API; primary_funding_id is refused, metaStatus.js:8-10), the portfolio's name (needs business_management, not in the approved config), and the owner's email or name (the ES business token and the FINISH payload carry neither).

### Gates and safeguards
- Invite-only in October, as the owner-led step for the first 10. No public endpoint creates a Business or a User. The join link is single-use, stored as a SHA-256 hash, carried in the URL fragment and valid 7 days. Reissue is refused once the owner has signed in, as today's guard at admin.js:556 does. Meta does not require SHIFT to approve customers (Q8a); this gate is SHIFT's choice.
- Kill switch: the owner ES router answers 503 «الربط الذاتي متوقف مؤقتًا» unless PlatformSetting es_owner_enabled is true. It stays false until gate G1 passes, and the owner can flip it back from «إعدادات المنصة».
- Tenant binding. Owners hit /api/whatsapp/embedded-signup/* with the business from req.businessId (attachBusinessId). Admins hit /api/admin/accounts/:id/embedded-signup/* with the business from the URL. A body or query business_id returns 400, and /status, /retry and /events read only the caller's own rows.
- Ownership proof from Meta itself: the WABA must be in debug_token target_ids, the number in GET /{waba}/phone_numbers, and the portfolio is read from GET /me client_business_id. A mismatch returns 403 «هذا الرقم لا يتبع الحساب الذي دخلت به في فيسبوك», writes AccountEvent es_ownership_mismatch and alerts SHIFT at critical level.
- Number conflicts are checked before upsert, subscribed_apps and /register, not via a P2002 afterwards. A connected shop's number is replaced only through «غيّر الرقم», which detaches the old onboarding row (business_id NULL, detached_at) first.
- Reconnect is safe. A fresh code on a 'done' or revoked row of the same business re-exchanges, instead of returning early at services/embeddedSignup.js:146. Creating the trial Subscription is idempotent (find, then create), so a reconnect never duplicates it.
- Popup reliability: the SDK is preloaded on mount, FB.login is called synchronously in the tap handler, and in-app browsers are detected and sent to Chrome or Safari. The popup runs only on app.shifts-ai.com. That domain must be listed in both Allowed domains and Valid OAuth redirect URIs, with the Client/Web OAuth, Enforce HTTPS, Embedded Browser OAuth, Strict Mode and JS SDK toggles on (Q8d). The shifts-ai.com marketing site only links to it.
- No coexistence in October. featureType is not sent. If FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING arrives anyway, /register is not called, the row is marked needs_operator and SHIFT is alerted. Coexistence ships only with the full Meta plumbing (P5).
- Cost guard before any shop goes live: a monthly AI-reply cap per shop, a daily media-read cap per shop and a daily platform ceiling, all counted from message rows. A shop that hits its cap hands chats to its staff with at most one holding reply per conversation per day. SHIFT is alerted at 80% and 100%.
- Meta's onboarding volume cap: 10 new business customers per rolling 7 days by default, 200 after Business Verification, App Review and Access Verification (Q8a). The tier is checked in the App Dashboard before inviting more than about 8 shops in one week; the G1 rehearsal portfolio counts too.
- Payment card is two-sided: the owner claims «أضفت البطاقة», SHIFT confirms (payment_method_marked_by), and a 131042 send failure overrides both, showing red in both panels.
- Removal is detected three ways: account_update read from value.waba_info.waba_id (PARTNER_REMOVED, PARTNER_APP_UNINSTALLED, ACCOUNT_DELETED, ACCOUNT_OFFBOARDED); a daily debug_token is_valid check in the existing minute sweep; and error 190 on a send.
- Every step writes an AccountEvent with its actor (owner, shift, system or meta). That feeds the board, the shop's «السجل» tab and «آخر ما حصل».
- SHIFT's alert channel carries platform events only, sent from SHIFT's own number with the approved staff_alert template. It never carries an end customer's message text, and STAFF_ALERT_WEBHOOK_URL fires only for SHIFT's own business (alerts.js:273-283).
- The login phone is normalised and unique. A clash gives an Arabic message and an alert, never a silent merge.
- Secrets: the token and PIN stay encrypted. The customer «Access Token» paste box is removed (SettingsPage.jsx:134-160), and PATCH /api/businesses/:id/token becomes platform_admin-only (businesses.js:189).
- Agencies and resellers are not onboarded through the link. Onboarding a Client ISV needs WhatsApp's written approval (Q8b).
- Copy rules: no promise that Meta fields are pre-filled (v4 extras is empty). No «بدون رسوم» or «بدون إضافات» promise (commit f486294e). Payment deadline wording comes from one server constant instead of «30 أيلول».
- is_internal hides SHIFT's own row and the noor-clinic-sim and sham-restaurant-sim rows from totals, the queue, the board and the cost ceiling.

### Failure paths
- Link expired or used: «الرابط منتهٍ أو مستخدم» with [اطلب رابطًا جديدًا على واتساب] (wa.me to SHIFT, prefilled with the shop name). If the owner already set a password: «حسابك مفعّل — سجّل الدخول» with [تسجيل الدخول].
- Opened in WhatsApp's, Facebook's or Instagram's in-app browser: «افتح الرابط في Chrome أو Safari لتتمكن من ربط واتساب» with [افتح في المتصفح] and [نسخ الرابط].
- Popup blocked or SDK failed: «منع المتصفح نافذة فيسبوك — اضغط مرة أخرى». On the second failure: «جرّب من الكمبيوتر، أو اطلب من شِفت أن يربط معك».
- Owner closed Meta's window (CANCEL with current_step): «توقفت عند: التحقق من الرقم. لم يضِع شيء — أكمل من هنا» with [أكمل الربط] and [تواصل مع شِفت]. AccountEvent es_cancelled is written, and the board shows the step.
- Meta reported an error (ERROR, or CANCEL with error_message): «أبلغت Meta عن خطأ: {error_message}», plus «رمز الجلسة للدعم» [نسخ] holding Meta's session_id, the thing Meta support asks for.
- No Facebook account: «ليس لديك حساب فيسبوك؟ يمكنك إنشاؤه خلال دقيقتين، أو نربط معك» with [احجز 10 دقائق مع شِفت].
- Number still on the WhatsApp or WhatsApp Business app (Meta refuses it in the popup): «هذا الرقم مفعّل على تطبيق واتساب. احذف الحساب من التطبيق أولًا (تضيع المحادثات القديمة) أو استخدم شريحة جديدة», with a 3-step guide and [تواصل مع شِفت].
- FINISH_ONLY_WABA and the WABA has no number: «أنشأت حساب واتساب للأعمال دون إضافة رقم» with [أضف الرقم], which relaunches Embedded Signup.
- FINISH never arrived, or the WABA has several numbers: the server uses the token's grants. If they are ambiguous, the token and WABA are kept (onboarding row with phone_number_id NULL, needs_operator), so the customer never redoes the popup: «وصلتنا موافقتك لكن لم نحدد الرقم — سيُكمل فريق شِفت الربط دون أن تعيد الخطوات». The operator picks the number with «أكمل الربط».
- Code expired (more than 30 seconds) or exchange failed: «انتهت مهلة الموافقة — اضغط «أكمل الربط» وستُفتح النافذة من جديد». If Meta's PARTNER_ADDED arrives for a WABA with no row, it is listed under «ربط بدون حساب» for SHIFT to match by hand.
- Ids outside the token's grants: 403 «هذا الرقم لا يتبع الحساب الذي دخلت به في فيسبوك». SHIFT gets a critical alert.
- Number already on another SHIFT account: 409 «هذا الرقم مربوط بحساب آخر لدى شِفت — تواصل معنا». Nothing is overwritten, and SHIFT is alerted with both shop names.
- subscribed_apps or register failed: «تم الربط جزئيًا» with [حاول مرة أخرى]. The server resumes from the stored step with the stored token, and the resume survives a page reload because the state is read from GET /status.
- PIN mismatch (two-step verification already set; error code assumed 133005): a 6-digit field «رمز التحقق بخطوتين لرقمك» appears, with the hint «إذا لم تعرفه: WhatsApp Manager ← الرقم ← التحقق بخطوتين». It posts /retry {pin}.
- New portfolio already has 2 registered numbers (Meta's cap before verification): «حسابك لدى Meta وصل حد الأرقام المسموح — تواصل مع شِفت».
- The coexistence event arrived although it was not offered: the number is not registered, and the screen says «هذا الرقم مربوط بتطبيق واتساب للأعمال — سيتواصل معك فريق شِفت لترتيب الربط».
- «لا، ليس هذا الرقم»: «سيتواصل معك فريق شِفت خلال ساعات الدوام». The attempt is flagged, and nothing changes until an operator acts.
- Later 131042 (payment): the home status turns red, «رفضت واتساب ردود البوت — أضف بطاقة دفع لدى Meta», with [افتح إعدادات الدفع] and [تواصل مع شِفت]. Messages keep landing in «المحادثات».
- Display name declined: «رفضت Meta اسم «مطعم الشام» — يرى زبائنك الرقم بدل الاسم» with [تواصل مع شِفت].
- Customer removed SHIFT in Meta, or the token died: «انفصل كرم بوت عن حسابك في Meta — البوت لا يستقبل الرسائل» with [أعد الربط]. Reconnect re-exchanges a fresh code on the same row.
- Monthly reply cap reached: «وصل البوت إلى حد ردود هذا الشهر — يحوّل زبائنك إلى فريقك حتى أول الشهر» on the home screen and as an inbox banner. The owner and SHIFT are told.
- Login phone already registered: «هذا الرقم مسجّل لدينا — سجّل الدخول أو تواصل مع شِفت».
- Forgot password: «نسيت كلمة المرور؟ راسل شِفت على واتساب ونرسل لك رابطًا جديدًا». The operator uses «إعادة ضبط الدخول», which is audited.

## Operator panel

### «اليوم» (replaces «نظرة عامة على المنصة») — `/admin/overview`
- Purpose: Each morning: which of the 10 shops needs SHIFT today, whether the platform itself is healthy (AI provider, AI ceiling), and where the campaign stands.
- Layout: Header: «اليوم» with the freshness pill «حُدّث قبل 40 ث» and «تحديث».

Row 1, platform strip, three cells:
- «الذكاء الاصطناعي: يعمل». Red «متعطّل منذ 12 د — الردود تتحول لفرق المحلات» when PlatformSetting provider_status.last_seen is less than 15 minutes old.
- «ردود البوت اليوم: 640 من سقف 2,000». Amber at 80%. Red at 100%, with «ردود التجارب متوقفة».
- «الربط الذاتي: مغلق» or «مفتوح بالدعوات», from es_owner_enabled.

Row 2, «مسار الانضمام». Clickable counts that open «الزبائن?stage=»: «أُرسل الرابط 2 · يربط واتساب 1 · بانتظار البطاقة 2 · يعلّم البوت 1 · بانتظار أول زبون 1 · يعمل 3 · موقوف 0». Money line: «فترة مجانية 7 · مدفوع 3 · مستحق هذا الأسبوع 50 د.أ · متأخر 0».

Row 3, the main block «يحتاج انتباهك · 4». Full width, 36px rows. Columns: ● | الزبون | المشكلة | منذ | إجراء. Sorted critical > warning > info, then oldest first. Rules as in attention_rules. Empty state: «✓ لا شيء يحتاجك الآن — كل الحسابات تعمل».

Row 4, «آخر ما حصل»: the 15 newest AccountEvents across shops, e.g. «10:32 · مطعم الشام · ربط واتساب ‎+962 7…» and «أمس 18:04 · صيدلية الريان · أضاف معلومة: الدوام».

Footnote: «حسابان داخليان مخفيان (شِفت، تجريبي)». is_internal accounts are excluded everywhere.

Data comes from GET /api/admin/overview. The full-table messages groupBy (admin.js:75-79) is replaced, and the stale rule is rebuilt on Conversation.last_outbound_at.
- Actions: Click a row to open the shop on the matching tab. Each rule has a fix button: «راسله» (wa.me to owner_phone, with an Arabic line prefilled per rule), «اربط معه», «أكّد البطاقة», «سجّل دفعة», «أعد إرسال الرابط», «أوقف البوت مؤقتًا». Also «تحديث», plus an automatic refresh every 60 s.

### «الزبائن» (replaces «حسابات الشركات») — `/admin/accounts (?stage=, ?filter=)`
- Purpose: Every shop on one sortable line: stage, health, usage, money and the owner's contact.
- Layout: Toolbar:
- Search «ابحث بالاسم أو الموبايل أو صاحب المحل».
- Filter chips «الكل (10) · يحتاج انتباهًا (3) · قيد الانضمام · يعمل · فترة مجانية · متأخر بالدفع · موقوف».
- Toggle «إظهار الحسابات الداخلية», off by default.
- Primary button «+ زبون جديد».

Table: 36px rows, tabular numerals, identifiers in dir=ltr, every column sortable in the browser (fine at 10; server paging deferred to 50). Columns as in fleet_table_columns.

On a phone each row becomes a card: name, stage chip, two status dots and free-month days.

Empty states: «لا يوجد زبائن بعد — ابدأ بـ «زبون جديد»» and «لا نتائج مطابقة».

TYPE_LABEL gains «نشاط عام» (BusinessesPage.jsx:37 shows the raw 'generic' today) and the sector labels (صيدلية، صالون، محل ملابس، محل).
- Actions: Sort, filter, search, open a shop, «راسله», «+ زبون جديد». Campaign action «انسخ روابط الدعوات غير المستخدمة». No bulk changes to live bots.

### «زبون جديد» (replaces CreateBusinessPage «إضافة عمل جديد») — `/admin/accounts/new`
- Purpose: Create a shop in about 20 seconds without any Meta id, and get the one link to send.
- Layout: One card:
- «اسم المحل»
- «نوع النشاط» as chips (مطعم · عيادة · صيدلية · صالون · محل ملابس · محل آخر)
- «اسم صاحب المحل»
- «موبايل صاحب المحل»
- «البريد الإلكتروني (اختياري)»
- «المدينة»
- «العرض», read from PlatformSetting campaign. It shows the plan name, the price after the free month and the replies per month.

A collapsed «متقدم» holds «ربط يدوي لرقم موصول مسبقًا» (Phone Number ID, WABA ID, token), for hand-wired numbers such as SHIFT's own.

After submit the same card shows «الرابط جاهز — أرسله لأبو خالد», with the message preview and the buttons «أرسل على واتساب», «نسخ الرابط» and «افتح صفحة الزبون».

Validation messages are in Arabic. Raw Prisma text is never shown (businesses.js:115).
- Actions: «أنشئ رابط الانضمام» → POST /api/admin/accounts. «أرسل على واتساب» opens wa.me and logs invite_shared. «نسخ الرابط». «افتح صفحة الزبون».

### «الانضمام» (campaign board) — `/admin/onboarding`
- Purpose: During the October campaign: where each of the 10 shops is, who is stuck and why. It also shows the abandoned Meta attempts and orphan connections that are invisible today.
- Layout: Board in RTL with six columns: «أُرسل الرابط» (a sub-badge «فتحه» once join_opened), «يربط واتساب», «بانتظار البطاقة», «يعلّم البوت», «بانتظار أول زبون», «يعمل».

Each card shows the shop name, the owner's first name and time in stage («منذ يومين»). It gets a red edge when stuck more than 24 h, the last Meta step when cancelled («توقف عند: التحقق من الرقم»), and a badge «بحاجة لشِفت» when needs_operator.

Below the board, the table «محاولات الربط مع Meta», from AccountEvent es_*. Columns: الوقت، الزبون، بدأها (الزبون / شِفت: معتصم)، النتيجة (اكتمل / أُلغي / خطأ / تعارض رقم / بحاجة لشِفت)، الخطوة، الخطأ بالعربي، رمز جلسة Meta (copyable, ltr).

Then the list «ربط بدون حساب». It holds onboarding rows with business_id NULL (hidden at admin.js:47 today) and PARTNER_ADDED events with no matching WABA. Columns: الرقم الظاهر، الاسم عند Meta، WABA، التاريخ.

On a phone the columns become a list grouped by stage.
- Actions: Open a card, «راسله», «أعد إرسال الرابط», «اربط معه», «أكّد البطاقة», «ألغِ الدعوة» (revokes the link and deactivates the unused owner), «اربطه بزبون…» for orphans (POST /api/admin/onboardings/:id/attach), and «أكمل الربط» for rows without a number (POST /api/admin/onboardings/:id/complete).

### Customer page — `/admin/accounts/:id (tabs ?tab=health|knowledge|access|contract|settings|whatsapp|log)`
- Purpose: Everything about one shop: whether it works, what is left, what it knows, who can log in, what they pay and what changed. It is also where SHIFT runs the attended Embedded Signup.
- Layout: Header: «مطعم الشام» · «مطعم · إربد», with the chips [واتساب متصل] [البوت يرد] [فترة مجانية — باقي 18 يومًا]. Owner line: «أبو خالد · 079•••4567 · راسله». Number line: «‎+962 7 9123 4567 · الاسم عند Meta: مطعم الشام (مقبول)». Quick actions: «أوقف البوت مؤقتًا» or «شغّل البوت» (ai_config.enabled, now enforced), «جرّب البوت», and ⋯ (إيقاف الحساب، فحص المحادثات (مُسجّل)).

Tabs:

«الحالة». At the top, a new panel «ربط واتساب». Not connected: the Arabic ConnectWhatsApp in its admin variant, «اربط واتساب لهذا الحساب», with the note «سلّم الشاشة لصاحب المحل: يدخل بحساب فيسبوك الخاص به. لا تطلب كلمة مروره أبدًا.» Stopped part-way: «توقف الربط عند: تسجيل الرقم», with «أكمل الربط» and a PIN field. Connected: «موصول: ‎+962… · الاسم الظاهر: … (قيد المراجعة)». Below it:
- the derived checklist, with new first rows «أُرسلت الدعوة», «فتح الرابط», «اختار كلمة المرور» and «بطاقة الدفع: أكدها الزبون / أكدتها شِفت»
- «ما تقوله Meta» (existing)
- «هذا الشهر»: ردود البوت/الحد، محادثات، تحويلات للفريق، أسئلة لم يعرفها البوت
- this shop's attention items.

«المعرفة». The knowledge, menu and clinic editors for this shop: the menu and clinic routes accept ?businessId for platform_admin. Also «ما عرف يجاوب» and «جرّب البوت».

«الدخول». Table: الاسم، الموبايل، الدور، دخل فعلًا، دعوة معلّقة. Actions: add a user by mobile, «رابط جديد», «تعطيل», «تغيير الدور», «إعادة ضبط الدخول».

«العقد». Existing contracts and payments, plus the plan, the replies cap and «نهاية الفترة المجانية». A trial turns «فعّال» when the first payment is recorded.

«الإعدادات». عام + الذكاء الاصطناعي + السياسات merged and aware of business type; delivery fields appear for restaurants only. Adds «أرقام التنبيهات» and «رسالة خارج الدوام».

«واتساب وMeta». «محاولات الربط» (when, by whom, result, step, Arabic error, Meta session id), copyable ids, «اسأل Meta», confirm or undo the card, and a collapsed «متقدم: إدخال يدوي» holding today's id/token form.

«السجل». AccountEvent and AdminAccessLog merged, newest first, e.g. «اليوم 09:12 · شِفت (معتصم) قرأ محادثة».
- Actions: Connect WhatsApp with the owner (admin mirror endpoints, business from the URL). Copy or reissue the join link. Test the bot. Pause or resume the bot (a reason is required). Suspend. Edit knowledge, menu and services. Manage logins and roles, including an audited reset. Record payments. Change the cap or the free-month end. Confirm the card. «اسأل Meta». Attach a replaced number. Open the audited inspection view.

### «الاشتراكات والدفعات» — `/admin/billing`
- Purpose: Money across all shops, recorded by hand (CliQ, bank transfer, cash): what is due, what came in, and whose free month ends.
- Layout: Strip: «المتوقع هذا الشهر 250 د.أ · المحصّل 75 د.أ · متأخر 25 د.أ · في الفترة المجانية 7».

Table columns: «الزبون», «الحالة» (فترة مجانية / فعّال / متأخر / موقوف / ملغى), «المبلغ», «تنتهي المجانية», «الاستحقاق القادم», «آخر دفعة» (التاريخ · كليك / تحويل · المرجع), «الردود/الحد».

Filters: «ينتهي خلال 7 أيام», «متأخر», «بدون عقد».

The inline drawer «سجّل دفعة» takes المبلغ، الطريقة (كليك / تحويل بنكي / نقدًا)، رقم المرجع and التاريخ.

A partial payment no longer advances the due date by a full cycle (admin.js:712-748).
- Actions: Record a payment. Change the cap or the free-month end. Apply the late policy: pause the bot after the grace days while the inbox keeps working. Export CSV, generated in the browser.

### «إعدادات المنصة» (made real) — `/admin/settings`
- Purpose: SHIFT's own switches and defaults. Today the page displays only three values (PlatformSettingsPage.jsx:5-12).
- Layout: Editable blocks backed by PlatformSetting rows:
- «العرض الحالي»: اسم الحملة، مدة الفترة المجانية (30 يومًا)، تبدأ من: أول رد للبوت / الربط.
- «حدود الذكاء الاصطناعي»: «ردود شهرية لكل محل» (1,000), «قراءة وسائط يوميًا لكل محل» (30), «سقف الردود اليومي للمنصة» (2,000), and «عند بلوغ السقف: أوقف التجارب أولًا».
- «الربط الذاتي»: «السماح للزبائن بربط واتساب بأنفسهم» (es_owner_enabled) and «مدة صلاحية رابط الانضمام (أيام)».
- «طرق الدفع التي يراها الزبون»: اسم CliQ، IBAN، اسم صاحب الحساب.
- «سياسة التأخر»: أيام السماح.
- «أرقام شِفت للتنبيهات».
- «التسجيل الذاتي العام»: off, greyed with «بعد أول 10 زبائن».
- Read-only «Meta»: app 1065272896256103, config 1664627968720314, Graph version.

There is deliberately no coexistence toggle.
- Actions: Save each block with a confirmation. Every save writes AccountEvent platform_setting_changed, with before and after values.

### «فحص المحادثات» (audited, read-only) — `/admin/accounts/:id/conversations`
- Purpose: Diagnose «البوت قال سعرًا غلط» without asking the owner for a password.
- Layout: Keeps the banner «قراءة فقط — كل دخول مسجّل باسمك». Thread view shows the newest 200 messages in order. Today it shows the oldest 200 (admin.js:405-413), so the recent wrong answer can be missing. Search by customer number or name. Media shows its stored transcript instead of «[type]». Each reply is tagged «البوت» / «موظف». Access entries appear in the shop's «السجل» tab.
- Actions: Search, open a thread, and jump to «المعرفة» to fix the answer.

### Fleet table columns
- **الزبون** — Shop name. Under it, small: sector label (مطعم / عيادة / صيدلية / صالون / محل ملابس / نشاط عام), city, and the display number in dir=ltr. States: Normal; «داخلي» tag only when the internal toggle is on.
- **المرحلة** — A stage chip derived from stored data, never stored: owner activation, Business.wa_phone_number_id, payment_method_ok, knowledge count, went_live_at, ai_config.enabled and status. States: أُرسل الرابط · فتح الرابط · يربط واتساب · بانتظار البطاقة · يعلّم البوت · بانتظار أول زبون · يعمل · موقوف مؤقتًا · موقوف · انتهت الدعوة
- **واتساب** — A dot plus one word, from connectionState, the onboarding row (revoked_at, payment_blocked_at, last_error) and Meta's number status. States: متصل (green) · بدون بطاقة مؤكدة (amber) · الدفع مرفوض (red, 131042) · مفصول من Meta (red) · تعثّر الربط (red) · غير مربوط (grey)
- **البوت** — A dot plus one word, from agentState, ai_config.enabled, the monthly cap and the platform ceiling. States: يرد · بدون معلومات · موقوف مؤقتًا · وصل حد الشهر · رسالة بدون رد · لا رسائل بعد
- **ردود الشهر** — AI replies this calendar month (Asia/Amman) against the shop's cap, e.g. 312 / 1,000, with a thin bar. Counted from Message rows (outbound, is_ai_generated) using the new (business_id, created_at) index. States: Normal · amber at ≥80% · red at 100% («وصل الحد»)
- **محادثات 7 أيام** — Conversations with an inbound message in the last 7 days. States: Number; «—» when not connected.
- **الاشتراك** — The live Subscription: trial days left, paid-until date or lateness, from trial_ends_at, next_due_at and status. States: لم يبدأ · مجاني — باقي 18 يومًا · مدفوع حتى 7 كانون الأول · متأخر 5 أيام · بدون عقد
- **صاحب المحل** — Owner first name and a WhatsApp icon (wa.me to owner_phone), plus the login state from User.active, last_login and the live UserActivation. States: ✓ دخل · الدعوة تنتهي بعد يومين · انتهت الدعوة · معطّل
- **آخر نشاط** — Relative time of the newest message or AccountEvent; absolute time on hover. States: «قبل 3 د» … «منذ 4 أيام» (amber after 3 days of silence on a live shop)

### Attention rules
- [critical] `payment_blocked (new)` — «رفضت واتساب ردود البوت — طريقة الدفع لدى Meta» — source: A tenant send failed with error 131042 (already detected at messageProcessor.js:36 and :527-555). It now also sets WhatsappOnboarding.payment_blocked_at, which the next delivered status clears.
- [critical] `partner_removed (new)` — «أزال الزبون صلاحية شِفت من حسابه في Meta — البوت لا يستقبل الرسائل» — source: account_update PARTNER_REMOVED, PARTNER_APP_UNINSTALLED, ACCOUNT_DELETED or ACCOUNT_OFFBOARDED, matched by value.waba_info.waba_id before entry.id. Also the daily debug_token is_valid=false check, or error 190 on a send. Sets onboarding.revoked_at.
- [critical] `meta_restriction (moved out of «تعثّر التوصيل»)` — «قيّدت Meta حساب واتساب: {نوع القيد} حتى {التاريخ}» — source: account_update ACCOUNT_RESTRICTION (restriction_info), ACCOUNT_VIOLATION (violation_info) or DISABLED_UPDATE (ban_info). Today these are written as last_error and shown as an onboarding failure (admin.js:166).
- [critical] `unanswered (fixed)` — «زبون ينتظر ردًا منذ 25 د» — source: Per conversation: last_inbound_at > coalesce(last_outbound_at, epoch), status in (open, pending), ai_enabled true, inbound older than 15 min and younger than 24 h. Counted per business with a groupBy. Replaces the rule at admin.js:84-88, which counts answered threads.
- [critical] `es_failed` — «تعثّر الربط عند: تسجيل الرقم» — source: WhatsappOnboarding.last_error with step before 'done', or AccountEvent es_failed with no es_connected after it.
- [critical] `needs_operator (new)` — «الربط يحتاج شِفت: لم يُحدَّد الرقم / قال الزبون إنه ليس رقمه / الرقم مربوط بحساب آخر» — source: WhatsappOnboarding.needs_operator, or AccountEvent wrong_number or es_conflict that is not resolved.
- [critical] `meta_quality_red (existing)` — «تقييم الجودة أحمر لدى Meta — الإرسال مُقيَّد» — source: meta_quality_rating RED, from metaStatus.refresh (now daily in the sweep) or the phone_number_quality_update webhook.
- [critical] `provider_down (new, platform-wide row)` — «مزوّد الذكاء الاصطناعي متعطّل — الردود تتحول لفرق المحلات» — source: PlatformSetting provider_status.last_seen within 15 min. It is written by workflowAlerts.providerIssueAlert, which now alerts SHIFT instead of a tenant (provider.js:230-250 throttle).
- [critical] `platform_ceiling (new, platform-wide row)` — «بلغت ردود البوت اليوم سقف المنصة — ردود التجارب متوقفة حتى منتصف الليل» — source: costGuard: count of today's AI replies across non-internal shops ≥ PlatformSetting ai_limits.platform_day_ceiling.
- [critical] `past_due (existing)` — «دفعة متأخرة — 25 د.أ» — source: Subscription.status past_due, set by the daily sweep after the grace days, or by hand.
- [warning] `payment_unconfirmed (replaces the stale «سيتوقف من 1 تشرين الأول» rule)` — «بطاقة الدفع لدى Meta غير مؤكدة منذ يومين (الزبون: أضفتها / لم يضفها)» — source: connected_at older than 48 h and payment_method_ok false, with payment_method_claimed_at shown. Critical only through payment_blocked.
- [warning] `handoff_waiting (fixed stale_threads)` — «3 محادثات محوّلة لفريق المحل بلا رد منذ أكثر من ساعة» — source: Conversation.needs_attention true, attention_at older than 60 min, and no last_outbound_at after attention_at (docs/admin-panel-plan.md:117-121).
- [warning] `es_cancelled (new)` — «أغلق نافذة Meta عند: التحقق من الرقم — منذ يوم» — source: AccountEvent es_cancelled with no later es_connected after 24 h. data.current_step is shown in Arabic.
- [warning] `join_stalled (new)` — «فتح رابط الانضمام ولم يكمل منذ يومين» — source: AccountEvent join_opened older than 48 h and the owner not active, or active but no number.
- [warning] `orphan_connection (new)` — «ربط واتساب بدون حساب: ‎+962 7…» — source: WhatsappOnboarding with business_id NULL and not detached (filtered out at admin.js:47 today), or AccountEvent partner_added_unmatched.
- [warning] `no_knowledge (softened)` — «لم تُدخل معلومات المحل — البوت يرحّب فقط» — source: Knowledge, menu or service count is 0, evaluated only once a number is connected. Today it is critical from the moment the account is created (admin.js:169-170).
- [warning] `cap_80 (new)` — «استهلك 80% من ردود الشهر (800 / 1,000)» — source: costGuard monthly count ≥ 80% of Subscription.ai_replies_month (or the platform default).
- [warning] `cap_reached (new)` — «وصل حد ردود الشهر — البوت يحوّل الزبائن للفريق» — source: costGuard monthly count ≥ cap.
- [warning] `trial_ending (new)` — «الشهر المجاني ينتهي خلال 3 أيام — لا دفعة مسجّلة» — source: Subscription.trial_ends_at within 3 days and no Payment on that subscription.
- [warning] `overdue (existing)` — «تجاوز موعد الدفع بـ 4 أيام — 25 د.أ» — source: next_due_at in the past and still within grace.
- [warning] `meta_quality_yellow / name_declined (existing)` — «تقييم الجودة أصفر لدى Meta — راقب شكاوى الزبائن / رفضت Meta الاسم الظاهر — الزبون يرى الرقم بدل اسم المحل» — source: metaAttention (metaStatus.js:93-109) on the daily refresh.
- [info] `invite_not_opened (new)` — «لم يفتح رابط الانضمام بعد (أُرسل قبل يومين)» — source: AccountEvent invite_shared older than 48 h with no join_opened.
- [info] `invite_expired (new)` — «انتهت دعوة الانضمام دون استخدام» — source: The owner was never active and the UserActivation has expired. The daily sweep writes AccountEvent invite_expired.
- [info] `name_pending (new)` — «الاسم الظاهر قيد مراجعة Meta» — source: meta_name_status PENDING_REVIEW.
- [info] `went_live (new, today only)` — «مطعم الشام يعمل — أول رد للبوت» — source: AccountEvent went_live in the last 24 h.
- [info] `due_soon / quiet / no_contract (existing)` — «دفعة مستحقة خلال 5 أيام — 25 د.أ / لا نشاط منذ 4 أيام / لا يوجد عقد مسجّل لهذا الحساب» — source: The existing rules (admin.js:196-209). is_internal replaces the business_type 'shift' exception.

## Customer panel
### Navigation
- **الرئيسية** `/overview` (business_owner, manager): Status line, trial banner, setup checklist, «اليوم», «هذا الشهر», «ما عرف يجاوب». On phones it is the first bottom tab.
- **المحادثات** `/inbox` (business_owner, manager, staff): Inbox v2, defaulting to «بانتظارك», with banners for a paused bot, a reached cap or a provider outage. The badge shows unread count. Second bottom tab; staff's first.
- **البوت** `/bot` (business_owner (all); manager (knowledge, gaps, test)): Pause toggle, knowledge grouped with sector suggestions, «ما عرف يجاوب», «جرّب البوت», reply settings, alert numbers. Third bottom tab.
- **الطلبات (مطعم) / المواعيد (عيادة)** `/orders` (business_owner, manager, staff; restaurants and clinics only): Orders or appointments the bot completed, with the explainer line. Fourth bottom tab for those types. For generic shops the fourth tab is «الاشتراك» for the owner.
- **القائمة (مطعم) / الخدمات والأطباء (عيادة)** `/menu · /clinic` (business_owner, manager): Menu or services editor; also reachable from «البوت» on phones (under «المزيد»).
- **التقارير** `/reports` (business_owner, manager): Conversations, bot replies against team replies, handoffs, the top unanswered questions; 7 or 30 days. Under «المزيد» on phones.
- **الفريق** `/staff` (business_owner (manage), manager (view)): Seats meter, members, invite by link, roles. Under «المزيد».
- **الاشتراك** `/billing` (business_owner): Plan, free-month countdown, reply and user meters, how to pay by CliQ, payments, Meta fees, late policy. Under «المزيد», or the fourth tab for generic shops.
- **الإعدادات** `/settings` (business_owner (واتساب, المحل); all roles (حسابي)): WhatsApp connection card with reconnect and number change (no raw ids, no token box), shop details, my account and password. Under «المزيد».
- **المساعدة** `wa.me/962776788972 (external)` (All): «راسل شِفت على واتساب», prefilled with the shop name. Replaces the dead /docs/whatsapp-setup.md link (SettingsPage.jsx:90). The phone bottom bar for owners and managers is «الرئيسية · المحادثات · البوت · الطلبات/الاشتراك · المزيد»; staff get «المحادثات · الطلبات». On desktop the same items sit in the right-hand sidebar, branded «كرم بوت · مطعم الشام» instead of «واتساب AI» (DashboardLayout.jsx:103).

### «انضمام» (join wizard) — `/join#<token> (public; staff and manager invites keep /activate)` (Invited business_owner before login)
- Layout: Full-screen phone wizard, RTL, 48px tap targets, one decision per screen. A progress strip «١ حسابك · ٢ واتساب · ٣ البوت» stays on top. Brand line «كرم بوت — من شِفت، إربد».

Screens:
- «أهلًا أبو خالد»: password; mobile shown masked.
- «اربط واتساب المحل»: two tap questions, then the green «اربط واتساب».
- «جارٍ الربط…»: four Arabic ticks, ending in «هل هذا رقم محلك؟».
- «بطاقة الدفع لدى Meta».
- «علّم البوت عن محلك»: sector starter cards, skippable.
- «جرّب البوت»: skippable.
- [افتح لوحتي].

Every screen's footer: «عالق؟ راسل شِفت على واتساب», which opens wa.me to SHIFT prefilled «أنا أبو خالد من مطعم الشام، توقفت عند: …». Reopening after the password step lands on /overview, where the checklist continues.
- Actions: Set the password. Connect WhatsApp. Resume or retry. Enter the PIN. Confirm the number. Claim the card. Add knowledge. Test the bot. Contact SHIFT.

### «تسجيل الدخول» — `/login` (All customer roles)
- Layout: Brand «كرم بوت — من شِفت». Fields: «رقم الموبايل أو البريد الإلكتروني» and «كلمة المرور» (eye toggle). The link «نسيت كلمة المرور؟» opens «راسل شِفت على واتساب ونرسل لك رابطًا جديدًا». Staff land on /inbox; owners and managers land on /overview.
- Actions: Log in. Request a reset over WhatsApp; SHIFT uses «إعادة ضبط الدخول».

### «الرئيسية» — `/overview` (business_owner, manager (staff go to /inbox))
- Layout: Top bar «كرم بوت · مطعم الشام». The bell opens the waiting chats (inert today).

Banner. Trial: «الشهر الأول مجاني — باقي 18 يومًا», linking to /billing. Paid: «مدفوع حتى 7 كانون الأول». Late: amber «اشتراكك متأخر 3 أيام — يتوقف الرد الآلي بعد 4 أيام إن لم تُسجَّل الدفعة، ورسائل زبائنك تبقى تصل».

Status card, one honest line:
- «البوت يعمل ويرد»
- «واتساب غير مربوط بعد — اربطه خلال دقائق» [اربط واتساب]
- «رفضت واتساب ردود البوت — أضف بطاقة دفع لدى Meta»
- «البوت موقوف مؤقتًا — الرسائل تصلك» [شغّل البوت]
- «وصل البوت إلى حد ردود هذا الشهر»
- «انفصل كرم بوت عن حسابك في Meta» [أعد الربط]

Until done, the checklist «خطوات تشغيل البوت · 2 من 5»: اربط واتساب (عليك, with a button; today it says «على شِفت»), بطاقة الدفع لدى Meta (عليك), علّم البوت عن محلك (عليك), جرّب البوت (عليك), أول رسالة من زبون (تلقائي).

Card «اليوم»: «زبائن راسلوك 14 · ردّ عليهم البوت 12 · بانتظارك 2», with [افتح المحادثات بانتظارك].

Card «هذا الشهر»: «312 ردًا تلقائيًا من 1,000» and a 7-day sparkline.

Card «ما عرف يجاوب»: up to 3 open questions («'هل عندكم توصيل لحوارة؟' — قبل ساعتين»), each with [علّم البوت الجواب] and [تجاهل].

Restaurants and clinics add «طلبات اليوم» or «مواعيد اليوم». Until WhatsApp is connected, the number cards are replaced by the connect card instead of four zeros.

Footer: «تحتاج مساعدة؟ راسل شِفت».
- Actions: Connect WhatsApp, resume the bot, open waiting chats, teach an answer, dismiss a question, open billing, contact SHIFT.

### «المحادثات» — `/inbox` (business_owner, manager, staff)
- Layout: The existing inbox v2. The filter chip «بانتظارك (2)» is selected by default when above zero. Banners: «البوت موقوف مؤقتًا — أنت ترد على الكل» [شغّل البوت] (owner only), «وصل البوت إلى حد ردود هذا الشهر — الرسائل الجديدة بانتظاركم», and «مزوّد الذكاء الاصطناعي متعطّل مؤقتًا — حوّلنا الزبائن لفريقك». Each thread has «أنا أرد» and «أعد البوت للرد» (the existing per-conversation ai_enabled). Voice notes, photos and videos show their transcripts (PR #58).
- Actions: Reply, take over, hand back to the bot, label, snooze, assign.

### «البوت» — `/bot` (business_owner (all cards); manager (knowledge, gaps and test only))
- Layout: Card «حالة البوت»: the toggle «البوت يرد على الزبائن». When off it reads «موقوف مؤقتًا — الرسائل تصلك في المحادثات», and it is enforced in messageProcessor.

Card «ماذا يعرف البوت عن محلك»: knowledge grouped as الدوام، الموقع والتوصيل، الأسعار والخدمات، أسئلة متكررة، سياسات, each with [+ أضف], and the hint «اكتبها كما تقولها لزبونك على الهاتف». Chips «اقتراحات لمحلات مثل محلك» per sector, e.g. pharmacy: «هل عندكم توصيل؟»، «هل تقبلون التأمين؟»، «هل تفتحون يوم الجمعة؟». Restaurants get a link card «القائمة (24 صنفًا)», clinics «الخدمات والأطباء».

Card «ما عرف يجاوب»: the full list, with [علّم البوت] and [تجاهل].

Card «جرّب البوت»: the existing tester.

Card «طريقة الرد»: «رسالة الترحيب», «رسالة التحويل للموظف», «كلمات تحوّل للموظف» as chips, «رسالة خارج الدوام» (API-only today) and «أوقات الدوام».

Card «إلى أين تصل التنبيهات»: the owner's mobile plus up to 4 more numbers, and the status «التنبيهات خارج 24 ساعة: مفعّلة / بانتظار موافقة Meta على القالب».
- Actions: Pause or resume. Add, edit or remove knowledge. Teach from a gap. Test. Save reply settings. Manage alert numbers.

### «الطلبات» / «المواعيد» — `/orders` (business_owner, manager, staff, for restaurant or clinic only (hidden for generic shops))
- Layout: Labelled «الطلبات» for restaurants and «المواعيد» for clinics. The existing list and status chips, plus the line under the title «الطلبات والمواعيد التي يتمّها البوت في المحادثة تظهر هنا تلقائيًا، والمحادثة نفسها في «المحادثات»» (walkthrough item 6).
- Actions: Change status, open the source conversation.

### «القائمة» / «الخدمات والأطباء» — `/menu (restaurant) · /clinic (clinic)` (business_owner, manager)
- Layout: The existing MenuPage and ClinicPage. MenuPage gains the missing «إضافة تصنيف» (MenuPage.jsx:203-205). Empty state: «بدون هذه المعلومات يرد البوت بالترحيب فقط». The menu, clinic and reports APIs get the same role check the UI applies.
- Actions: Add, edit, reorder and deactivate items or services; test from «البوت».

### «التقارير» — `/reports` (business_owner, manager)
- Layout: A version for every business type (today's page covers orders only): «محادثات يوميًا», «ردود البوت مقابل ردود فريقك», «تحويلات للفريق» and «أكثر ما لم يعرفه البوت» (from bot_handoff events), for 7 or 30 days. Restaurants and clinics keep their order and appointment charts. API role check added (reports.js:6).
- Actions: Switch the period. Open a question to teach the bot.

### «الفريق» — `/staff` (business_owner (manage); manager (view only))
- Layout: Seats meter «المستخدمون 2 من 3». Table: الاسم · الموبايل · الدور (مدير / موظف) · الحالة (فعّال / بانتظار التفعيل / معطّل) · آخر دخول. [+ أضف عضوًا] asks for name, mobile and role and returns a join link with [أرسل على واتساب], so the owner no longer types someone else's password. «مدير» really creates a manager (auth.js:73-81 forces staff today). Managers see no add or toggle buttons. When seats are full: «وصلت لعدد المستخدمين في باقتك — تواصل مع شِفت».
- Actions: Invite, resend the link, change role, deactivate.

### «الاشتراك» — `/billing` (business_owner only)
- Layout: Plan card: «باقة كرم بوت — {السعر} د.أ شهريًا», with the chip «فترة مجانية حتى 7 تشرين الثاني» / «مدفوع حتى 7 كانون الأول» / «متأخر 5 أيام».

Meters: «الردود التلقائية هذا الشهر 312 من 1,000 — تتجدد أول كل شهر» and «المستخدمون 2 من 3».

Card «كيف أدفع؟»: the CliQ alias and IBAN from PlatformSetting, [نسخ اسم CliQ], and [أرسلت الدفعة], which opens wa.me to SHIFT prefilled «دفعت 25 د.أ عبر كليك — مطعم الشام».

Table «دفعاتك»: التاريخ · المبلغ · الطريقة · المرجع. recorded_by is never shown.

Card «رسوم واتساب لدى Meta»: «تدفع رسوم رسائل واتساب لـ Meta مباشرة من بطاقتك في WhatsApp Manager، ولا تمر عبر شِفت.»

Card «إذا تأخرت الدفعة»: «نذكّرك قبل الاستحقاق بخمسة أيام. بعد الاستحقاق لديك 7 أيام سماح يعمل فيها البوت كالمعتاد، بعدها يتوقف الرد الآلي فقط — رسائل زبائنك تبقى تصل إلى «المحادثات» ولا يُحذف شيء.»
- Actions: Tell SHIFT about a payment, copy the CliQ alias, read the payment history, «تواصل مع شِفت لتغيير الباقة».

### «الإعدادات» — `/settings (tabs: واتساب · المحل · حسابي)` (business_owner (حسابي: all roles))
- Layout: Tab «واتساب», one Arabic card with no raw Meta ids:
- «رقم المحل: ‎+962 7 9123 4567»
- «الاسم الذي يراه زبائنك: مطعم الشام — مقبول / قيد المراجعة / مرفوض»
- «جودة الرقم لدى Meta: جيدة / متوسطة / منخفضة»
- «بطاقة الدفع لدى Meta: مؤكدة / بانتظار تأكيد شِفت / غير مضافة»
- «آخر رسالة من زبون» and «آخر رد من البوت».
The «Access Token» box is removed (SettingsPage.jsx:134-160), and so is the admin-only ConnectWhatsApp branch (SettingsPage.jsx:279-284). A collapsed «للدعم الفني» row has only [انسخ رمز الدعم], which copies Meta's session id without showing it.

Tab «المحل»: الاسم، النوع، المدينة، العنوان، العملة, and «سياسات الطلبات» for restaurants only.

Tab «حسابي»: الاسم، الموبايل, and [غيّر كلمة المرور].
- Actions: «أعد الربط» (when broken), «غيّر الرقم» (with a confirmation dialog), «افتح WhatsApp Manager», «أضفت البطاقة», save shop details, change password, «راسل شِفت».

## Schema changes
- Migration 1 (P0), applied with backend/scripts/migrate-prod.sh. Business.wa_phone_number_id: `String @unique` → `String? @unique` (schema.prisma:27), via `ALTER TABLE businesses ALTER COLUMN wa_phone_number_id DROP NOT NULL`. Postgres allows many NULLs under the unique index, inbound routing never matches NULL (messageProcessor.js:319-326), and connectionState already treats a missing number as unknown (accountHealth.js:25).
- Business new columns: wa_display_phone String?, wa_verified_name String?, meta_business_id String?, sector String? (pharmacy | salon | clothing | shop | restaurant | clinic | other; it picks the starter cards and the greeting), city String?, owner_phone String? (9627XXXXXXXX), source String @default("operator") (operator | invite | self_signup), is_internal Boolean @default(false), connected_at DateTime?, went_live_at DateTime?. Backfill is_internal=true WHERE business_type='shift' OR slug LIKE '%-sim'.
- WhatsappOnboarding (schema.prisma:396-435): phone_number_id `String @unique` → `String? @unique`, so a row can keep the token and WABA while the number is unknown (needs_operator). Add finish_event String?, needs_operator Boolean @default(false), payment_method_claimed_at DateTime?, payment_blocked_at DateTime?, started_by_user_id String?, revoked_at DateTime?, revoked_reason String?, detached_at DateTime?, token_checked_at DateTime?. business_id stays @unique, which keeps the 1:1 relation used across admin.js and whatsappStatus.js: a number change detaches the old row (business_id NULL, detached_at) before linking the new one. STEPS stay code_received → token_exchanged → subscribed → registered → done.
- New model AccountEvent: id cuid, business_id String? (NULL for platform events and unmatched PARTNER_ADDED), actor_user_id String?, actor_kind String (owner | staff | shift | system | meta), type String, data Json @default("{}"), resolved_at DateTime?, created_at. Types: invite_created, invite_shared, join_opened, password_set, invite_expired, invite_cancelled, es_started, es_cancelled, es_failed, es_conflict, es_ownership_mismatch, es_connected, wrong_number, partner_added_unmatched, partner_removed, meta_restriction, token_invalid, payment_claimed, payment_confirmed, payment_blocked, knowledge_added, went_live, bot_handoff, bot_paused, bot_resumed, cap_80, cap_reached, payment_recorded, user_added, role_changed, login_reset, settings_changed, platform_setting_changed. Indexes: @@index([business_id, created_at]), @@index([type, resolved_at]), @@index([created_at]); @@map("account_events"). This one table is the activity log, the history of Meta attempts and the «ما عرف يجاوب» source, in place of separate SignupAttempt, AuditEvent and KnowledgeGap tables. Secrets never go into data.
- New model PlatformSetting: key String @id, value Json, updated_by String?, updated_at DateTime @updatedAt; @@map("platform_settings"). Keys: es_owner_enabled (false), campaign {name, trial_days: 30, trial_starts: 'first_reply' | 'connect'}, ai_limits {reply_month_default: 1000, media_day_default: 30, platform_day_ceiling: 2000, ceiling_policy: 'trials_first'}, payment_instructions {cliq_alias, iban, holder}, late_policy {grace_days: 7}, invite_ttl_days (7), shift_alert_numbers, self_signup {enabled: false, daily_cap: 5}, provider_status {provider, kind, last_seen} (written by code).
- Subscription (schema.prisma:482-505): add trial_ends_at DateTime?, ai_replies_month Int? and seats Int? (snapshotted at creation, so a later default change never silently rewrites a deal), and campaign String? (e.g. irbid-2026-10). plan_name stays free text. Defaults live in a new backend/src/config/plans.js, so there is no Plan table.
- Conversation (schema.prisma:89-130): add last_outbound_at DateTime?, set wherever an outbound row is saved (saveOutboundMessage and the inbox send routes). Add @@index([business_id, last_inbound_at]).
- Message: add @@index([business_id, created_at]). Only (business_id) and (conversation_id) exist (schema.prisma:167-168). It backs «ردود الشهر», the cost guard counts and the newest-200 inspection view.
- Migration 2 (P2, phone login): User.email `String @unique` → `String? @unique`, and a new phone String? @unique. Existing users keep their email, so no backfill is needed. Every findUnique-by-email call (auth.js:20, admin.js:508) branches on whether the login contains '@'.
- Not added on purpose, to stay right-sized for 10 shops: SignupInvite (User active=false + UserActivation with ttlHours 168 already does it), SignupAttempt, UsageMonthly/UsageDaily/AiUsage (counts come from Message rows), Plan, TrialClaim (invite-only; for public signup later a duplicate check on Business.meta_business_id and wa_display_phone does the job), ProviderIncident (PlatformSetting provider_status), AttentionSnooze, KnowledgeGap.

## API changes
- backend/src/routes/embeddedSignup.js becomes the owner router: `router.use(authenticate, requireRole('business_owner'), attachBusinessId, requireSetting('es_owner_enabled'))`, replacing requireRole('platform_admin') at :14. GET /config also returns locale 'ar_AR'. POST /exchange {code, finish_event, waba_id?, phone_number_id?, meta_business_id?, session_id?}; a body business_id returns 400 (today it is trusted at :32). POST /retry {pin?} acts only on the caller's own latest onboarding and replaces /:id/retry (:70-78). POST /events {event, current_step?, error_message?, error_code?, session_id?} writes AccountEvent for req.businessId only, never updateMany by phone_number_id (:90-94). GET /status takes no parameters and reads the caller's business (replaces :100-110). Responses carry {status: 'connected' | 'needs_number' | 'needs_operator', onboarding: {step, display_phone, verified_name, name_status, payment: {confirmed, claimed, blocked}}} and never ids or tokens.
- Admin mirror in backend/src/routes/admin.js (already platform_admin): GET /api/admin/embedded-signup/config, POST /api/admin/accounts/:id/embedded-signup/exchange, POST /api/admin/accounts/:id/embedded-signup/retry {pin?}, POST /api/admin/accounts/:id/embedded-signup/events, GET /api/admin/accounts/:id/embedded-signup/status. The business comes from the URL, as the user and contract routes already do. AccountEvent is written with actor_kind 'shift'.
- backend/src/services/embeddedSignup.js gets a new connectFromCode({businessId, code, finishEvent, hints, actor}). Order: (1) exchangeCode, inside the 30-second TTL. (2) verifyGrant(token, hints): GET /debug_token?input_token={token}&access_token={appId}|{secret}, reading granular_scopes target_ids for whatsapp_business_management; GET /{waba}/phone_numbers?fields=id,display_phone_number,verified_name; GET /me?fields=client_business_id. (3) Resolve the ids; a missing phone id resolves to exactly one number, otherwise needs_number or needs_operator. (4) assertNumberFree(phoneNumberId, businessId), returning 409 number_taken. (5) Upsert the onboarding; startOnboarding never updates a row whose business_id differs, fixing :107-127. A same-business row at 'done' or revoked is reset to token_exchanged with the new token, fixing :146. (6) runOnboarding (subscribe, then register), skipping register when finishEvent is FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING. (7) linkOnboardingToBusiness, factored out of :219-233: writes wa_* fields, wa_display_phone, wa_verified_name, meta_business_id and connected_at, and detaches an older row of the same business. (8) metaStatus.refresh. (9) ensureTrialSubscription(businessId), idempotent. (10) AccountEvent es_connected, then notifyShift. publicStatus reads the payment wording from one constant in backend/src/config/metaNotices.js instead of the «30 أيلول» copy (:248-259).
- backend/src/services/accountUpdate.js: `const wabaId = value.waba_info?.waba_id || entry.id` (replaces :14). PARTNER_ADDED with a matched row writes AccountEvent; with no match it writes AccountEvent partner_added_unmatched {waba_id, owner_business_id}. PARTNER_REMOVED, PARTNER_APP_UNINSTALLED, ACCOUNT_DELETED and ACCOUNT_OFFBOARDED set revoked_at and revoked_reason, write AccountEvent partner_removed, and alert SHIFT and the owner. ACCOUNT_RECONNECTED clears revoked_at. ACCOUNT_VIOLATION, ACCOUNT_RESTRICTION and DISABLED_UPDATE write AccountEvent meta_restriction with restriction_info, violation_info or ban_info, instead of last_error (:35-40).
- backend/src/routes/whatsapp.js (:90-96): also route message_template_status_update (sets ai_config.alert_template on APPROVED for that WABA) and phone_number_quality_update (updates meta_quality_rating). The app is already subscribed to both fields (memory note, 2026-10-01). Payload shapes are to be confirmed against the G1 fixtures, and the daily sweep re-checks either way.
- backend/src/services/messageProcessor.js: (a) :331 saves inbound for every status, and :940 and :1047 run the workflow only when status is 'active' but still call newMessageAlert. newMessageAlert.js:170 alerts for any status except 'closed'. (b) runTenantWorkflow (:759), before readTenantMedia (:781): return when ai_config.enabled === false; then costGuard.allow(business, kind). When it says no, set needs_attention with attention_reason 'bot_limit' and send at most one holding reply per conversation per day (ai_config.limit_message). (c) saveOutboundMessage and the staff send routes set Conversation.last_outbound_at. The first AI reply to a non-staff number runs updateMany Business.went_live_at where null, writes AccountEvent went_live and calls notifyShift. (d) HANDOFF_TO_HUMAN with handoff_kind 'model' writes AccountEvent bot_handoff {question, conversation_id}. (e) The existing 131042 branch (:527-555) also sets WhatsappOnboarding.payment_blocked_at and writes AccountEvent payment_blocked. Error 190 on a send sets revoked_reason 'token_invalid'.
- backend/src/workflows/generic.js (:80-85, :118-124), clinic.js and restaurant.js: add handoff_kind 'keyword' | 'model' | 'ai_failure' to every HANDOFF_TO_HUMAN result, so «ما عرف يجاوب» lists only questions the model gave up on.
- New backend/src/services/costGuard.js. monthlyAiReplies(businessId): count of outbound is_ai_generated messages since the 1st (Asia/Amman). mediaReadsToday(businessId): inbound message_type in audio, video or image since midnight. platformAiRepliesToday(): across non-internal shops. Each count is cached in-process for 60 s. Caps come from Subscription.ai_replies_month, then PlatformSetting ai_limits. When the platform ceiling is hit, trial shops stop first. At 80% and 100% it writes AccountEvent once per period and sends notifyShift.
- backend/src/services/workflowAlerts.js providerIssueAlert (:41-45): send notifyShift reason 'provider_down' and upsert PlatformSetting provider_status; stop sending ai_failure to tenant alert numbers. The handed-over conversation in the shop's inbox replaces the alarm. Today provider.js:230-250 throttles this to one alert an hour across all tenants, so one arbitrary shop gets SHIFT's credit outage. backend/src/services/alerts.js:273-283: post to STAFF_ALERT_WEBHOOK_URL only when business.business_type === 'shift' or the reason is a platform reason.
- backend/src/services/alerts.js: new notifyShift({reason, shopName, phone, summary}), sent from SHIFT's own Business row with the approved staff_alert template. Reasons: join_opened, customer_connected, connect_failed, needs_operator, went_live, partner_removed, payment_blocked, provider_down, cap_80, platform_ceiling. It never includes an end customer's message text.
- New backend/src/services/ownerAlertTemplate.js, extracted from backend/scripts/create-alert-template.js. After es_connected it POSTs /{waba}/message_templates with the business token: a neutral utility template «تنبيه من كرم بوت: {{1}} — {{2}} — {{3}}». It sets ai_config.alert_template when the template is approved (webhook, or the sweep poll), so handoff alerts reach the owner outside the 24-hour window (alerts.js:192-195).
- backend/src/routes/auth.js. POST /login takes {login | email, password}: a login containing '@' is looked up by email, anything else by normalizePhone → phone. POST /activate/lookup also returns business_name, owner_first_name, phone_masked, role and connected. POST /activate returns user {id, name, role, business_id, business_type, business_name} (:155-158). POST /register stops being the owner's staff path (:71-107); see /api/team.
- backend/src/routes/admin.js, new endpoints: POST /api/admin/accounts {name, sector, owner_name, owner_phone, owner_email?, city, campaign}, which creates Business + owner User + UserActivation(168 h) + AccountEvent in one transaction, with no Subscription, and returns {account_id, join_url, wa_share_url}. POST /api/admin/accounts/:id/join-link (reissue; refused after sign-in, as at :556). DELETE /api/admin/accounts/:id/invite. POST /api/admin/accounts/:id/events {type:'invite_shared'}. PATCH /api/admin/accounts/:id/bot {enabled, reason}. PATCH /api/admin/accounts/:id/users/:userId {active?, role?}. POST /api/admin/accounts/:id/users/:userId/reset (deactivate, revoke, new link; audited). GET /api/admin/onboarding (board, attempts, orphans). POST /api/admin/onboardings/:id/attach {business_id}. POST /api/admin/onboardings/:id/complete {phone_number_id}. GET /api/admin/events?business_id=&before=. GET /api/admin/billing. GET and PATCH /api/admin/platform-settings.
- backend/src/routes/admin.js, changed endpoints. GET /overview: excludes is_internal; adds stage, display_phone, verified_name, ai_replies_month and cap, trial_ends_at, owner {first_name, phone, signed_in, invite_expires_at}, funnel and money totals, provider and ceiling state, and recent_events (15); the stale rule is rebuilt and the messages groupBy (:75-79) dropped. POST /accounts/:id/subscriptions/:sid/payments: a payment on a 'trial' sets 'active', and next_due_at advances only when the cycle is fully paid (:712-748). PATCH /accounts/:id/payment-method also writes AccountEvent payment_confirmed.
- backend/src/routes/whatsappStatus.js. buildSetup's 'connected' step becomes owner 'you' with action 'connect' when es_owner_enabled is true (:27-32). The knowledge step points to /bot. knowledgeCount is passed into agentState (:138). GET adds number {display, verified_name, name_status}, plan {name, status, trial_days_left, next_due_at}, usage {ai_replies_month, cap, seats_used, seats}, today {inbound, ai_replies, waiting} and gaps_open. New POST /payment-method-claim.
- New customer endpoints. GET /api/account/billing (owner): subscription, payments {paid_at, amount_jod, method, reference}, payment_instructions, late_policy, and the Meta-fees text. GET /api/knowledge/gaps lists open AccountEvent bot_handoff rows. POST /api/knowledge/gaps/:id/answer {answer} creates a faq BusinessKnowledge row and sets resolved_at. DELETE /api/knowledge/gaps/:id dismisses one. POST /api/team/invite {name, phone, role: manager | staff} (owner only, seat-limited; returns a /activate link). PATCH /api/team/:id {role?, active?} (owner only).
- backend/src/routes/businesses.js. POST (:106-117): slug generated on the server, wa_phone_number_id optional, Prisma errors mapped to Arabic. PATCH /:id (:120): changing ai_config or policies requires business_owner or platform_admin. PATCH /:id/token (:189): platform_admin only.
- backend/src/services/shiftSweeper.js runSweep, already called every minute through /api/internal/sweep: add one step a day, guarded by date. It runs metaStatus.refresh for every connected non-internal shop and the debug_token is_valid check (token_checked_at). It writes invite expiry, sends free-month reminders at 3 days and 0 days to SHIFT and the owner, applies past_due after the grace days, and polls owner-alert template status. No new Cloud Scheduler job.
- Frontend utils/facebookSdk.js: load connect.facebook.net/ar_AR/sdk.js, export preload(), make launchEmbeddedSignup call FB.login synchronously, and pass extras {setup:{}} only (drop featureType '' and sessionInfoVersion '3', :80-84).
- Frontend components/whatsapp/ConnectWhatsApp.jsx rewritten in Arabic RTL. An endpoint prop selects the owner or admin endpoints. It accepts every FINISH_* event, treats ERROR and CANCEL-with-error_message as errors, shows a PIN field on PIN errors, resumes from GET /status on mount, detects in-app browsers, and shows a popup-blocked message. It no longer awaits anything before FB.login (:94-102).
- Frontend pages: new JoinPage.jsx (/join), BotPage.jsx (/bot), BillingPage.jsx (/billing), admin/OnboardingBoardPage.jsx (/admin/onboarding), admin/BillingAdminPage.jsx (/admin/billing). CreateBusinessPage.jsx is rewritten as «زبون جديد». AccountHealthTab.jsx gets the «ربط واتساب» panel. SettingsPage.jsx loses the token box (:134-160) and the admin ConnectWhatsApp branch (:279-284). DashboardLayout.jsx gets a bottom tab bar below lg and the brand «كرم بوت · {اسم المحل}». AdminLayout NAV (:18-22) becomes «اليوم · الزبائن · الانضمام · الاشتراكات · إعدادات المنصة». LoginPage's field becomes «رقم الموبايل أو البريد الإلكتروني». AuthContext stores business_name.

## Phases

### P0 · «أساس آمن ونظيف» (safe, clean foundation) [M]
- Scope: Migration 1: nullable Business.wa_phone_number_id and the new Business, WhatsappOnboarding, Conversation and Subscription columns, the Message index, AccountEvent, PlatformSetting, and the is_internal backfill. Slugs generated on the server and Arabic create errors (businesses.js:106-117). Tenant binding: the owner ES router stays closed behind es_owner_enabled=false; the admin mirror routes are added; body business_id is rejected; /status, /retry and /events are scoped. Stale and unanswered rules rebuilt on last_outbound_at. ai_config.enabled enforced, but only after a read-only production check for rows already set to false. Inbox and alerts kept for paused and suspended shops at all four gates (messageProcessor.js:331, :940, :1047; newMessageAlert.js:170). Activation returns role, business_type and business_name. PATCH token admin-only; role check on PATCH business. Provider outages go to SHIFT only and the STAFF_ALERT_WEBHOOK leak is closed. The «30 أيلول» copy moves to one constant. AccountEvent written from the existing admin actions. TYPE_LABEL gains «نشاط عام». Cross-tenant tests in the style of backend/tests/wabaIsolation.test.js.
- Owner sees after: He can create a shop with only a name and type, with no Prisma error. The attention queue stops claiming every shop has waiting chats, and SHIFT's own and test rows stop inflating the totals. «أوقف البوت مؤقتًا» really stops replies while the shop's messages keep arriving. If Gemini runs out, he gets one alert instead of a random shop owner.
- Depends on: Nothing; start here.

### P1 · «اربط واتساب معه» + سقف التكلفة (attended connect and cost guard) [M]
- Scope: connectFromCode: exchange, then verifyGrant (debug_token, /{waba}/phone_numbers, /me), FINISH_* handling, server-side discovery of the number, refusal of number conflicts, reconnect reset, profile enrichment plus metaStatus.refresh, and an idempotent trial Subscription at connect. accountUpdate keyed on waba_info.waba_id, with the removal and restriction events. ConnectWhatsApp rewritten in Arabic: PIN, resume after reload, SDK preload, synchronous FB.login, in-app detection. The «ربط واتساب» panel on the account's «الحالة» tab, using the admin mirror. The /settings admin branch removed. Orphan rows visible and attachable; «أكمل الربط» for rows without a number. notifyShift. The daily sweep step (Meta refresh, debug_token is_valid). costGuard: monthly per-shop cap, daily media cap and platform ceiling. docs/connecting-a-customer.md updated to match the real buttons.
- Owner sees after: On any shop's «الحالة» tab he presses «اربط واتساب لهذا الحساب» and hands the phone over. About two minutes later the page shows the shop's real ‎+962 number and Meta name with «واتساب متصل», and a WhatsApp alert lands on his phone. Each shop row shows «ردود الشهر 0 / 1,000».
- Depends on: P0

### G1 · «أول ربط حقيقي» (first live Embedded Signup, no code) [S]
- Scope: First, the App Dashboard: confirm the onboarding-cap tier (10 a week, or 200) and that app.shifts-ai.com is in Allowed domains and Valid OAuth redirect URIs with the Login toggles on. Then run ES from «الحالة» on a SHIFT-owned spare SIM with a test portfolio, and after that customer #1 attended. Save the real FINISH payload, the Graph responses (token, debug_token, phone_numbers, /me, subscribed_apps, register, profile) and the PARTNER_ADDED and PARTNER_APP_INSTALLED webhooks as fixtures under backend/tests/fixtures/es/. Add the payment card. Confirm inbound, an AI reply, the shop inbox and the SHIFT alert. On the rehearsal WABA, remove SHIFT in Meta Business Settings, record the real removal event, and check the panel turns red. Also try recovering a lost code via system_user_access_tokens (an inference). Only then set es_owner_enabled=true.
- Owner sees after: One real number answering through Karam Bot, connected by Embedded Signup from his own panel. He has a recorded proof of what Meta actually sends, and his own 2026-09-22 condition for showing the button to customers is met.
- Depends on: P1

### P2 · «رابط الانضمام بنقرة» (the one-click join link) [L]
- Scope: «زبون جديد» quick create (POST /api/admin/accounts) with the wa.me share. The /join wizard: password → pre-check → popup → «هل هذا رقم محلك؟» → card at Meta → teach (skippable) → try (skippable). Migration 2 for phone login. The owner ES router opened. The checklist's connect step becomes «عليك» with a button. Payment claim. The «الانضمام» board with Meta attempts and orphans. Signup alerts to SHIFT. Invite expiry in the sweep. The went_live hook and free-month clock. The owner-alert template auto-submitted to each new WABA.
- Owner sees after: He creates a shop in 20 seconds and sends one WhatsApp message. On the board he watches the card walk to «يعمل» while the shop owner does everything on their phone, and the profile fills itself from Meta. This is the 'one click, profile added' he asked for.
- Depends on: G1 passed (es_owner_enabled on), P0, P1

### P3 · «لوحة الزبون» (customer panel, phone-first) [M]
- Scope: Bottom tab bar and brand. Home with the honest status line, «اليوم», «هذا الشهر» and «ما عرف يجاوب» (handoff_kind plus the gaps API). The /bot page (pause, grouped knowledge with sector chips, out-of-hours message and hours, alert numbers). /billing (plan, meters, CliQ, payments, Meta fees, late policy). /settings › «واتساب» without raw ids. Team: invite by link, manager role honoured, seats meter. Generic report tiles. The orders explainer. Activation-page copy from walkthrough item 5. Role checks on the menu, clinic and reports APIs.
- Owner sees after: What each shop sees every day: «البوت يعمل · 14 زبونًا اليوم · 2 بانتظارك», the questions the bot could not answer with a one-tap fix, their plan and payments, and a WhatsApp page a non-technical owner understands.
- Depends on: P0 for /billing and /bot (these can start early); P2 for the join session and phone login

### P4 · «لوحة شِفت لعشرة زبائن» (operator panel) [M]
- Scope: «اليوم» with the full attention_rules, the platform strip, the funnel, the money line and «آخر ما حصل». «الزبائن» with every column, filter and sort. Account page tabs: «المعرفة» (admin edits menu and services via businessId), «السجل», a merged «الإعدادات», user deactivate, role change and «إعادة ضبط الدخول». /admin/billing with trial→active and the partial-payment fix. A real /admin/settings backed by PlatformSetting. Inspection shows the newest 200 messages, with search and transcripts. The quality webhook.
- Owner sees after: The 10-customer morning: one screen listing only what needs him today, the AI ceiling and provider state, money due against money collected, and every change to every shop traceable to a person.
- Depends on: P0 (it can run in parallel with P1–P3; the funnel strip uses P2's events once they exist)

### P5 · «بعد أول 10» (after the first ten) [L]
- Scope: Public «جرّب مجانًا» on shifts-ai.com, linking to app.shifts-ai.com/join with no token. It sits behind the self_signup toggle, a daily cap of 5, a honeypot, authLimiter, a duplicate check on meta_business_id and display number, and the trial caps. Coexistence only with Meta's full requirements: featureType 'whatsapp_business_app_onboarding'; subscriptions to history, smb_app_state_sync and smb_message_echoes; POST /{phone}/smb_app_data with sync_type 'smb_app_state_sync' and with 'history' within 24 h; no /register; echo handling so the bot stays quiet where the owner replied in the app; ACCOUNT_OFFBOARDED and ACCOUNT_RECONNECTED handling; copy that explains 20 mps and the 14-day inactivity rule. Tested first on one friendly Irbid number, since +962 support is unverified. Also: menu from a photo; a weekly WhatsApp digest to owners; a Modeer-style assignment rule; token metering per shop if the reply counts stop being a good proxy.
- Owner sees after: A shop he never met signs up and goes live alone, and he can pause it with one tap. Shops can keep their current WhatsApp Business number.
- Depends on: P2, P4, and 30 days of real reply counts with at least 5 invite signups without a tenant or cost incident

## Must be true before ES opens to customers
- Tenant binding. The business comes from the session (owner) or the URL (admin), never from the body or query. /status, /retry and /events are scoped to the caller, and a body business_id returns 400 (routes/embeddedSignup.js:32, 70-110). Cross-tenant tests cover it.
- startOnboarding must never upsert onto an onboarding row owned by another business (services/embeddedSignup.js:107-127). A number already on another Business is refused before subscribed_apps and /register, not via P2002 afterwards.
- Server-side proof from Meta: the WABA is in the business token's debug_token granular_scopes target_ids, the number is in GET /{waba}/phone_numbers, and the portfolio id comes from GET /me client_business_id instead of the browser.
- Accept every FINISH_* event, and treat ERROR and CANCEL-with-error_message as errors (ConnectWhatsApp.jsx:68). When phone_number_id is missing, discover it on the server, never with a 400 that burns the 30-second code (routes/embeddedSignup.js:34-36). Exchange the code first, then verify.
- Reconnect: a fresh code on a 'done' or revoked row of the same business re-exchanges (fixes the early return at services/embeddedSignup.js:146). /config stays reachable for an owner whose number was removed, and trial creation is idempotent.
- accountUpdate.js:14 reads value.waba_info.waba_id before entry.id. It handles PARTNER_REMOVED, PARTNER_APP_UNINSTALLED, ACCOUNT_DELETED and ACCOUNT_OFFBOARDED explicitly, backed by the daily debug_token is_valid check and the error-190 classifier on sends.
- Popup: SDK preloaded on mount, FB.login called synchronously in the tap with no await before it, in-app browsers detected, and the card in Arabic RTL with a PIN field and resume after reload.
- Business.wa_phone_number_id made nullable, so the profile exists before its number.
- AI cost guard live: a monthly reply cap per shop, a daily media-read cap and a daily platform ceiling.
- Provider outages alert SHIFT only, and STAFF_ALERT_WEBHOOK_URL is limited to SHIFT's own business and platform events (workflowAlerts.js:41-45; alerts.js:273-283).
- Gate G1 passed: one attended live run on a SHIFT spare SIM, then customer #1. Real FINISH, Graph and PARTNER_* payloads saved as fixtures, and SHIFT deliberately removed on the rehearsal WABA to observe the real removal event.
- App Dashboard checked: the onboarding-cap tier (10 a week by default, 200 after verifications), and app.shifts-ai.com in both Allowed domains and Valid OAuth redirect URIs, with the Login toggles on.
- The customer «Access Token» paste box removed and PATCH /api/businesses/:id/token made platform_admin-only (SettingsPage.jsx:134-160; businesses.js:189).
- Copy fixed: no «قبل 30 أيلول» (one server constant), no promise that Meta's fields are pre-filled, and no «بدون رسوم» promise about Meta fees (commit f486294e rule).
- A read-only production check for businesses with ai_config.enabled=false before the pause is enforced, so no live shop goes silent on deploy.

## Risks
- Embedded Signup has never run against a real WABA. FINISH variants, timing, debug_token scopes, register and PIN behaviour, and the removal event are all unproven. Mitigation: gate G1 on a SHIFT spare SIM, with real payloads saved as fixtures, before any customer sees the button. This is the owner's own 2026-09-22 order (D-ES1).
- Meta's popup on phones. A link tapped inside WhatsApp may open an in-app browser, and Safari blocks popups that are not opened synchronously. Mitigation: SDK preload, synchronous FB.login, in-app detection, a «أسهل من الكمبيوتر» path, and the attended route for the first 2–3 shops. In-app browser behaviour per platform is an assumption to check in G1.
- The payment card is the likeliest real blocker. Some Irbid owners may not hold a card Meta accepts, and CliQ cannot pay Meta. Whether service replies are charged and withheld from 2026-10-01 without a card comes from the repo and third-party sources only (unverified), so all the copy reads from one server constant. Mitigation: the card step in /join, 131042 detection in both panels, and a SHIFT playbook for assisted card setup.
- Fresh-SIM friction. Many shops run their main number on the WhatsApp Business app, and moving it to Cloud API loses its history. Coexistence would solve this, but Jordan (+962) support is unverified (Q4b), and Meta requires history and state sync within 24 h plus echo handling. So it is P5, never a toggle before that.
- Meta's onboarding volume cap. The default is 10 new business customers per rolling 7 days, which is exactly the campaign size, and the G1 rehearsal portfolio counts too. If the 200 tier is not confirmed in the App Dashboard, spread connects over two weeks.
- Tenant takeover if ES opens before P0 and P1. Today a body business_id and the phone-keyed upsert could bind or corrupt another shop's row. es_owner_enabled stays false until P1 is merged and G1 passes.
- account_update keying is 'likely', not verified, per Meta's examples (Q5c). If the real PARTNER_* payload differs, removal could still be missed. Mitigation: read waba_info.waba_id with entry.id as fallback, observe the real event in G1, and keep the daily debug_token check and the error-190 classifier as independent detectors.
- A lost 30-second code after Meta's side completed. PARTNER_ADDED still arrives, listed as «ربط بدون حساب». Recovering the token via POST /{portfolio}/system_user_access_tokens is an inference from the Hosted ES docs, not stated for this case, so it is tested in G1. Otherwise the owner reruns the popup.
- Cost run-away on a ~$5 infrastructure budget plus Gemini credits: ten free-month shops, voice and video reads (PR #58), dry runs. Mitigation: monthly per-shop and daily platform caps counted from message rows. Token-level metering is deferred, because counts are a good enough proxy for 10 shops; revisit at 50.
- Phone login has no OTP, so a mistyped or squatted number locks the real owner out. Mitigation: SHIFT types the invite mobile, links can be reissued, and resets are SHIFT-led and audited. Making User.email nullable touches every findUnique-by-email; it ships as its own migration in P2 with login and admin regression tests.
- Owner-alert template on each new WABA: until Meta approves it, handoff alerts to the shop owner outside 24 h are skipped (alerts.js:192-195). If Meta rejects it, owners rely on the inbox «بانتظارك» filter. These template sends count toward the shop's 250-user business-initiated limit, which is negligible.
- Display name review. Until Meta approves the name, or if it declines it, customers see the bare number; SHIFT's own number is DECLINED today. Both panels show name_status so the shop does not blame SHIFT.
- Behaviour changes on deploy. Enforcing ai_config.enabled, and saving inbound messages for suspended shops, change live behaviour. Production data is checked first, and both changes are covered by messageProcessor tests.
- Where the designs disagreed, decided: (a) the trial Subscription is created at connect, not at invite, so shiftSweeper.offerPlacesLeft (:1013-1027) never counts dead invites and weeklyFollowup never stops early with 'offer_full'; (b) no SignupAttempt or invite table: AccountEvent plus UserActivation(ttlHours 168) cover them; (c) the attempt is never created with an await before FB.login; (d) no new Cloud Scheduler job: daily work rides the existing minute sweep; (e) a 6-column board instead of 9; (f) caps are hard during the free month, because a soft quota caps nothing.
- Copy risk: shop-facing text must not promise «بدون رسوم» or pre-filled Meta fields. The Meta-fees line says only that Meta bills the shop directly and the fees do not pass through SHIFT.
- A Client ISV (an agency or reseller) signing up through the link would need WhatsApp's written approval (Q8b). Invites are for shops only.

## Versus Modeer 360
- **How a business signs up** — Modeer: Self-serve on the site («جرب الآن مجاناً»), 7-day trial with no card («بدون بطاقة ائتمانية») · SHIFT today: Staff create the account by hand, which fails without a Phone Number ID. The owner gets a 72-hour link. · target: SHIFT sends one 7-day link. The owner sets a password on their phone, and the profile exists before the number. Public sign-up comes after the first 10.
- **Connecting WhatsApp** — Modeer: Two routes: an unofficial QR link to the WhatsApp Business app, and the official API through Embedded Signup («ربط الحساب الان») · SHIFT today: Official API only, admin-only, bound to the admin's own business. Customers cannot press it. · target: One green button «اربط واتساب» in the join link and checklist, plus SHIFT's attended path. Official API only (no unofficial QR). Coexistence comes later with full Meta sync.
- **Onboarding checklist** — Modeer: «أكمل تهيئة منصة المحادثات — 0 من 3» (channels, staff, assignment) · SHIFT today: 4-step «خطوات تشغيل البوت». Connecting is marked «على شِفت». · target: Join wizard, then a 5-step checklist where connecting is «عليك», plus a SHIFT board that shows where each shop stopped.
- **Teaching the AI** — Modeer: Persona first; knowledge comes from uploaded company files; no sector templates · SHIFT today: Sector workflows (restaurant, clinic) and a knowledge editor hidden in Settings · target: Sector starter cards in the join flow, «البوت» page with sector suggestions, and the «ما عرف يجاوب» list with one-tap «علّم البوت الجواب»
- **Testing the bot** — Modeer: Not found in the trial · SHIFT today: «جرّب البوت» exists (real workflow, dry run) · target: In the join wizard and on «البوت», with sector question chips
- **AI usage meter** — Modeer: 2,500 AI units a month, top-ups 3–10 JD («AI 2k+» badge) · SHIFT today: None; tokens only in logs · target: «الردود التلقائية هذا الشهر 312 من 1,000 — تتجدد أول كل شهر». No top-ups; plan changes go through SHIFT.
- **Seats** — Modeer: Seats meter; Starter capped at 3; extra seat 5–7 JD · SHIFT today: Unlimited. «مدير» silently becomes staff, and the owner types staff passwords. · target: «المستخدمون 2 من 3», invite by link, roles honoured
- **Trial and plan banner** — Modeer: «باقي 7 أيام من تجربتك» → «اختر خطتك» · SHIFT today: None · target: «الشهر الأول مجاني — باقي 18 يومًا» → «الاشتراك»
- **Billing** — Modeer: JOD plans 37–256; paywall «تواصل مع مدير حسابك لدفع الفاتورة» · SHIFT today: Contracts recorded by hand; the customer never sees them · target: «الاشتراك» with plan, payments, CliQ instructions, «أرسلت الدفعة» over WhatsApp, and the late policy in plain words
- **Meta fees transparency** — Modeer: «ادفع تكلفة رسائل الـ API لشركة Meta مباشرة…» · SHIFT today: Checklist step with an out-of-date «قبل 30 أيلول» · target: A card step in /join (owner claims, SHIFT confirms, 131042 turns red) and «تدفع رسوم رسائل واتساب لـ Meta مباشرة… ولا تمر عبر شِفت»
- **Assignment and auto-replies** — Modeer: Per channel: none / round-robin / AI agent; keyword and schedule auto-replies · SHIFT today: Manual assignment; per-conversation bot toggle; greeting, handoff keywords; out-of-hours message API-only · target: Out-of-hours message and hours editable on «البوت». Modeer-style assignment rule after the first 10.
- **Campaigns / broadcasts** — Modeer: 5,000–10,000 people a month · SHIFT today: None · target: None in October (new portfolios are capped at 250 business-initiated users a day anyway); after the first 10
- **Operator view across customers** — Modeer: None; each account is self-contained · SHIFT today: Fleet list with a noisy queue and no onboarding view · target: «اليوم», «الزبائن» and «الانضمام» board, with SHIFT alerts on join, connect, stuck, live and removed: local, hands-on onboarding Modeer does not offer
- **Help** — Modeer: «مساعدة على واتساب» to a +962 number; video guides · SHIFT today: Support number on the status card; a dead setup-guide link · target: «عالق؟ راسل شِفت على واتساب» on every join screen, prefilled with the shop and the step reached
- **Beyond chat (CRM, deals, inventory, calls)** — Modeer: A light ERP on every plan · SHIFT today: Orders and appointments only · target: Unchanged on purpose: sell the bot, sector workflows and local setup, not an ERP
