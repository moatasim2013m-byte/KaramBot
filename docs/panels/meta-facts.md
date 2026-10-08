# Meta Embedded Signup facts (researched 2026-10-08)

Confidence: verified = read in Meta docs or the repo; likely = inferred from docs; unknown = not found. Confirm "likely" items in the G1 live run.

## [verified] Q1a. ES v4 session-info postMessage: which event names exist?
Every message has type 'WA_EMBEDDED_SIGNUP'. The documented `event` values are: FINISH (the Cloud API flow completed), FINISH_ONLY_WABA (the flow completed without a phone number), FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING (completed with a WhatsApp Business app number, i.e. coexistence), FINISH_OBO_MIGRATION, FINISH_GRANT_ONLY_API_ACCESS, ERROR and CANCEL. ERROR is listed, but the docs' own example of a user-reported error arrives as event CANCEL carrying error_message. A receiver has to handle both.

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/

## [verified] Q1b. Which data fields does the FINISH payload carry?
The success payload is { data: { phone_number_id, waba_id, business_id (the customer's business portfolio id), and optionally ad_account_ids[], page_ids[], dataset_ids[], catalog_ids[], instagram_account_ids[], waba_ids[] }, type:'WA_EMBEDDED_SIGNUP', event:'<FLOW_FINISH_TYPE>' }. The asset arrays appear only if the customer selected those assets. The v4 example has no `version` key. It carries no email, user name or business name.

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/

## [verified] Q1c. What do the CANCEL and error payloads look like?
Abandoned flow: { data: { current_step }, type:'WA_EMBEDDED_SIGNUP', event:'CANCEL' }. User-reported error: { data: { error_message, error_code, session_id, timestamp }, type:'WA_EMBEDDED_SIGNUP', event:'CANCEL' }. session_id is what Meta support asks for.

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/

## [likely] Q1d. What does the coexistence finish event carry?
FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING carries ONLY waba_id: { data: { waba_id }, type:'WA_EMBEDDED_SIGNUP', event:'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', version: 3 }. There is no phone_number_id, so the server must look it up with GET /{waba_id}/phone_numbers. For the Only-WABA bypass, the doc shows FINISH_ONLY_WABA with phone_number_id + waba_id. In v4, though, it is described as 'completed flow without a phone number', so phone_number_id may be absent.

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/ ; https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/bypass-phone-addition

## [verified] Q1e. What are the v4 launch options (extras / featureType / sessionInfoVersion), and how long does the code live?
The v4 launch is FB.login(cb, { config_id, response_type:'code', override_default_response_type:true, extras:{ setup:{} } }). The versions page says 'The extras object is purposely empty for v4'. sessionInfoVersion ('3') is required only on v2 and v2-public-preview, and session info is 'sent back for all flows' in v3 and v4. featureType 'whatsapp_business_app_onboarding' is supported in v4. Blank means the default flow, and 'only_waba_sharing' is v2 only. A login configuration created by selecting products is automatically v4. v2 and v3 are 'available until October 2026'; separately, v2 deprecation is 2026-10-15. The exchangeable code has a 30-second TTL. The repo passes featureType:'' and sessionInfoVersion:'3' (frontend/src/utils/facebookSdk.js:80-84). That is harmless under v4, but it does nothing.

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions/ ; https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/

## [verified] Q1f. Does the repo handle the non-FINISH success events?
No. frontend/src/components/whatsapp/ConnectWhatsApp.jsx:68 accepts only event === 'FINISH'. Any other WA_EMBEDDED_SIGNUP event, including FINISH_ONLY_WABA and FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING, falls into the cancel branch: it sets state 'failed' and posts a CANCEL to /events. Even if it got past that, POST /exchange returns 400 without phone_number_id (backend/src/routes/embeddedSignup.js:34-36). So enabling coexistence, or a customer finishing without a number, would burn the 30-second code. A self-serve design needs all FINISH_* events accepted, and a server-side GET /{waba}/phone_numbers when phone_number_id is missing.

Source: frontend/src/components/whatsapp/ConnectWhatsApp.jsx:61-87 ; backend/src/routes/embeddedSignup.js:31-36

## [verified] Q2a. Which phone-number fields fill a profile, and which permission do they need?
GET /{phone-number-id} returns code_verification_status, display_phone_number, id, quality_rating and verified_name by default. name_status can be requested (marked beta). Its values are APPROVED, AVAILABLE_WITHOUT_REVIEW, DECLINED, EXPIRED, PENDING_REVIEW and NONE. Also readable: status (must be CONNECTED to message), throughput, health_status and whatsapp_business_manager_messaging_limit (messaging_limit_tier is deprecated). Reading phone numbers is covered by whatsapp_business_management ('getting business phone numbers associated with your WABA'), which SHIFT's ES config grants. verified_name is the shop's WhatsApp display name, the best 'business name' we can get without business_management.

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers ; https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions ; https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits

## [likely] Q2b. Which WABA fields can be read, and with which permissions?
The WABA reference (v26.0) lists name, currency, timezone_id, message_template_namespace, business_verification_status, country, status, ownership_type, on_behalf_of_business_info, health_status, is_shared_with_partners and primary_funding_id. Its stated requirements are whatsapp_business_management + whatsapp_business_messaging (+ public_profile), which the ES config has. GET /{waba}?fields=account_review_status (PENDING/APPROVED/REJECTED) is documented, and the repo already calls it (backend/src/services/metaStatus.js:63). owner_business_info is NOT listed in the current reference or the manage-accounts page. Whether it still works is unknown. For the owner's portfolio id, use instead FINISH data.business_id, /me (see Q2d), PARTNER_ADDED waba_info.owner_business_id, or on_behalf_of_business_info.

Source: https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/ ; https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/manage-accounts ; https://developers.facebook.com/documentation/business-messaging/whatsapp/whatsapp-business-accounts

## [likely] Q2c. Can GET /{business-id}?fields=name be read with only the two WhatsApp permissions?
Probably not. Meta says business_management is 'only needed if you need to programmatically access your business portfolio'. Reading a Business node is a portfolio read, and business_management is not in SHIFT's login config (docs/whatsapp-embedded-signup.md:84). Treat the portfolio name as unavailable. Fill the profile from phone.verified_name + display_phone_number and waba.name/currency/timezone_id/country instead. Adding business_management would mean changing the approved config and possibly another App Review, which the memory note warns against. Not tested live.

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions ; https://developers.facebook.com/docs/permissions/

## [verified] Q2d. What does /me return with the ES business token?
With a business integration system user access token, GET /me returns the app user's client business id (field client_business_id), i.e. the customer's portfolio id. It is a cheap server-side way to confirm which customer portfolio a token belongs to, independent of what the browser posted.

Source: https://developers.facebook.com/docs/facebook-login/facebook-login-for-business

## [verified] Q2e. What does the repo read from Meta today?
Nothing at signup: exchangeCode, subscribeApp and registerPhoneNumber make no profile reads (backend/src/services/embeddedSignup.js:59-99). The manual staff refresh (backend/src/services/metaStatus.js:38-75) reads display_phone_number, quality_rating, throughput, status and name_status, plus account_review_status, with the stored business token. It saves everything except display_phone_number, which it returns and discards. These same reads can run right after step 3 to auto-fill the new profile.

Source: backend/src/services/metaStatus.js:31-90 ; backend/src/services/embeddedSignup.js:59-99

## [verified] Q3. Can the ES login configuration also return the Facebook user's email or name?
No. Facebook Login for Business marks email and public_profile as 'N/A' for business integration system user access tokens (user-token configurations only), and ES configurations return a business token. The FINISH payload has no email or name either. To capture the owner's email or name, either collect them in SHIFT's own signup form before launching ES (simplest, no Meta change), or run a separate Facebook Login for Business 'General' configuration that issues a user token (a second popup). Note that ES itself runs through FB.login, so the customer needs a Facebook account to complete it.

Source: https://developers.facebook.com/docs/facebook-login/facebook-login-for-business

## [verified] Q4a. What is coexistence, and what must SHIFT have to offer it?
Coexistence lets a business onboard to Cloud API with its EXISTING WhatsApp Business app account and number. Meta converts the account into a backward-compatible messaging account that keeps the same id (returned as waba_id). After that, the partner app can send at scale while the owner keeps chatting 1:1 in the app, and history stays in sync between the two. To enable it, pass extras.featureType = 'whatsapp_business_app_onboarding'. Requirements: the customer's WhatsApp Business app is version 2.24.17 or later; the partner is a Tech Provider or Solution Partner; the partner's webhook can digest payloads; and ES runs with session logging. Pricing: messages sent from the app stay free, and messages sent via Cloud API are charged at Cloud API rates.

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/

## [likely] Q4b. Is coexistence available for Jordanian (+962) numbers?
Probably yes, but I could not verify it. Meta's current coexistence page names no countries. Meta's changelog shows launch on 2025-02-11, India added on 2025-05-05, and Australia, Japan, Philippines, Russia, South Korea, Turkey, the EEA/EU and the UK added on 2025-10-23. Infobip's docs still list Nigeria and South Africa as the only unsupported countries; one third-party source says those were lifted in April 2026, which is unverified. Jordan or +962 appears in no restriction list from Meta or anyone else. Confirm on the first real Irbid number.

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog ; https://www.infobip.com/docs/whatsapp/manage-integration/coexistence

## [verified] Q4c. What are coexistence's limitations?
Limitations: a fixed 20 mps throughput. Group chats are not synced or supported. Disappearing messages are turned off for 1:1 chats. View-once, live location, broadcast lists (disabled after onboarding), voice/video calls, business tools, the business profile and channels are unsupported. WhatsApp for Windows and WearOS are unsupported as companions. If the primary phone is inactive for about 14 days, the number disconnects (reason PRIMARY_INACTIVITY); a companion disconnects after about 30 days. Meta sends account_update ACCOUNT_OFFBOARDED and ACCOUNT_RECONNECTED for device changes or re-registration. Partner docs, not Meta's, add: no Official Business Account badge, no classic business verification, the number cannot move between WABAs (360dialog), and one number per coexistence WABA with a maximum of 4 coexistence WABAs (Infobip).

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/ ; https://docs.360dialog.com/partner/waba-management/phone-number-and-hosting/using-whatsapp-app-and-cloud-api-simultaneously ; https://www.infobip.com/docs/whatsapp/manage-integration/coexistence

## [verified] Q4d. What must the Tech Provider do after a coexistence onboarding, and does the repo support it?
Meta requires: subscribe to the webhook fields history, smb_app_state_sync and smb_message_echoes. Then, WITHIN 24 HOURS, call POST /{phone-number-id}/smb_app_data with sync_type 'smb_app_state_sync' (contacts) and again with sync_type 'history', otherwise the business must be offboarded and redo the flow. Skip /register ('the number is already registered'), and digest smb_message_echoes, which carry the owner's own replies from the app. The repo does none of this. runOnboarding always registers (backend/src/services/embeddedSignup.js:188-217), the webhook handles only messages and account_update (backend/src/routes/whatsapp.js:90-96), and there is no echo handling. Without echo handling the bot would answer chats the owner is already handling by hand.

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/ ; backend/src/services/embeddedSignup.js:188-217

## [verified] Q5a. Which account_update events can a Tech Provider receive?
The account_update `event` values are: ACCOUNT_DELETED, ACCOUNT_RESTRICTION (restriction_info[{restriction_type e.g. RESTRICTED_BIZ_INITIATED_MESSAGING, expiration}]), ACCOUNT_VIOLATION (violation_info{violation_type}), AD_ACCOUNT_LINKED, AUTH_INTL_PRICE_ELIGIBILITY_UPDATE, BUSINESS_PRIMARY_LOCATION_COUNTRY_UPDATE, DISABLED_UPDATE (ban_info{waba_ban_state, waba_ban_date}), MM_LITE_TERMS_SIGNED, PARTNER_ADDED, PARTNER_APP_INSTALLED, PARTNER_APP_UNINSTALLED, PARTNER_CLIENT_CERTIFICATION_STATUS_UPDATE, PARTNER_REMOVED, VOLUME_BASED_PRICING_TIER_UPDATE, ACCOUNT_OFFBOARDED and ACCOUNT_RECONNECTED. Separately, limit changes arrive on the business_capability_update webhook.

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update/

## [verified] Q5b. Do partner_app_installed and partner_app_uninstalled exist?
Yes, as account_update EVENT values (PARTNER_APP_INSTALLED: 'a business customer granted the app one or more permissions'; PARTNER_APP_UNINSTALLED: 'deauthenticated or uninstalled the app'), not as separate webhook fields. Their waba_info carries waba_id, owner_business_id and partner_app_id; PARTNER_APP_INSTALLED also carries solution_id and solution_partner_business_ids. PARTNER_ADDED carries waba_id, owner_business_id, solution_id and solution_partner_business_ids. PARTNER_REMOVED carries only waba_id and owner_business_id. PARTNER_ADDED fires when a customer completes ES, and it is the ONLY signal under Hosted ES.

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update/ ; https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/hosted-es

## [likely] Q5c. Does the repo's account_update handler key these events correctly?
Probably not. In Meta's PARTNER_ADDED and PARTNER_APP_INSTALLED examples, entry.id is '2949482758682047', which equals solution_partner_business_ids[0]: the PARTNER's portfolio id, not the WABA. The WABA id is in value.waba_info.waba_id. ACCOUNT_OFFBOARDED's example uses the WABA id as entry.id. backend/src/services/accountUpdate.js:14 treats entry.id as the WABA for every event, so PARTNER_ADDED and PARTNER_APP_* would likely log 'unknown WABA' and do nothing. PARTNER_REMOVED, PARTNER_APP_UNINSTALLED, ACCOUNT_DELETED and ACCOUNT_OFFBOARDED fall into the default no-op branch, so SHIFT is not told when a customer disconnects. Fix: read waba_info.waba_id first and fall back to entry.id.

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update/ ; backend/src/services/accountUpdate.js:13-50

## [likely] Q6. Can a Tech Provider read whether the customer's WABA has a payment method or credit line?
Not reliably. primary_funding_id IS a WABA field ('Primary funding ID for the WhatsApp Business Account paid service'), but the repo recorded that Graph refuses it with 'requires the Business that owns this App' (backend/src/services/metaStatus.js:8-10, commit 02619fe3). Meta says Tech Providers have no credit lines, and their customers add their own payment method in WhatsApp Manager, where Meta bills them directly. No Tech Provider API to read the payment method is documented. Usable signals: (a) error 131042 'There was an error related to your payment method' on the message status webhook, which the repo already maps (backend/src/services/whatsapp.js:247, backend/src/services/messageProcessor.js:36); (b) health_status on the WABA or number (can_send_message AVAILABLE/LIMITED/BLOCKED with errors[]). A payment-specific health error code (141006) appears only in third-party sources. So the panel needs a staff-confirmed or customer-confirmed checkbox, auto-flipped to 'problem' on 131042.

Source: https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/ ; https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview ; https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes ; https://developers.facebook.com/documentation/business-messaging/whatsapp/support/health-status/ ; backend/src/services/metaStatus.js:8-10

## [verified] Q7a. Which messaging limits apply to a just-signed-up shop?
New portfolios start at 250 unique users per moving 24 hours. That limit counts only messages delivered OUTSIDE a customer service window, i.e. business-initiated templates. Replies inside the window are not limited, so a bot answering inbound chats is unaffected. The tiers are 2,000, 10,000, 100,000 and unlimited. Since 2025-10-08 limits are set per business portfolio, not per number. To move from 250 to 2,000, a business needs business verification, partner-led verification, or 2,000 delivered high-quality template messages to unique users within 30 days. The limit is read from whatsapp_business_manager_messaging_limit, and changes arrive on the business_capability_update webhook. ES customers 'start with standard messaging limits'. Business verification is NOT a prerequisite for onboarding.

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits ; https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/ ; https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog

## [likely] Q7b. What other early-account constraints matter for a new shop?
New portfolios are capped at 2 registered phone numbers, which rises to 20 after verification or after reaching the 2,000 tier. WABA account_review_status can be PENDING, APPROVED or REJECTED. Display name: name_status can be PENDING_REVIEW or DECLINED (SHIFT's own number is DECLINED per the memory note), and the health-status docs show a LIMITED state: 'Your display name has not been approved yet. Your message limit will increase after approval.' Payment: Meta says Tech Provider customers must add a payment method before they can send and receive. Third-party sources and the repo comment (backend/src/services/embeddedSignup.js:248-259) say that from 2026-10-01 service (reply) messages are charged per message, with about 1,000 free per number per month, and are not delivered for accounts with no payment method on file. Meta's pricing page as fetched did not yet show this. In practice: a shop that signs up without adding a card gets a bot whose replies fail with 131042.

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers ; https://developers.facebook.com/documentation/business-messaging/whatsapp/support/health-status/ ; https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/support/business-customer-support/ ; https://chatfuel.com/docs/whatsapp-pricing-2026

## [likely] Q8a. Does Meta require SHIFT to approve customers, or forbid public self-serve signup?
I found no Meta rule that requires a Tech Provider to review or approve each customer, or that forbids public self-serve signup. ES is meant to be embedded in the partner's website or portal, and Hosted ES is literally a URL to 'map to a button on your website'. The real gate is a volume cap: 10 new business customers per rolling 7 days by default, raised automatically to 200 after Business Verification, App Review and Access Verification. Only newly onboarded customers count, Meta emails a warning near the limit, and beyond 200 the partner must apply to be a Meta Business Partner. The memory note says SHIFT has all three verifications, so the 200 cap should apply, but this was not re-checked live.

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/ ; https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/hosted-es

## [likely] Q8b. Which policy obligations sit with SHIFT versus the customer?
Each customer WABA must follow the WhatsApp Business Messaging Policy and Commerce Policy. Meta enforces against the WABA (ACCOUNT_VIOLATION, ACCOUNT_RESTRICTION, DISABLED_UPDATE, error 368/131031), not by requiring SHIFT's sign-off. The one written-approval rule I found concerns onboarding 'Client ISVs', i.e. resellers or software vendors. It requires notifying WhatsApp and getting written approval plus compliance checks. That would matter only if an agency or reseller signed up through SHIFT, not a shop. An owner-led review step for the first 10 is a business choice, not a Meta requirement.

Source: https://business.whatsapp.com/policy ; https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/multi-partner-solutions/ ; https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes

## [verified] Q8c. Is Hosted ES an option, and what is the catch?
Hosted Embedded Signup (launched 2025-10-17) is a Meta-hosted, no-JavaScript flow. Tech Providers are eligible; it is Cloud API only and cannot be customized. The URL comes from the WhatsApp > Quickstart > 'Zero integration onboarding' card. The partner learns about a signup ONLY from the account_update PARTNER_ADDED webhook (waba_id + owner_business_id). It then gets the business token with POST /{business_portfolio_id}/system_user_access_tokens (fetch_only=true, appsecret_proof, SHIFT's system token), finds the number via GET /{waba}/phone_numbers, and then subscribes and registers as usual. The docs mention no partner state or reference parameter, so a Hosted ES signup cannot be tied to a SHIFT customer record automatically. Matching would be by phone number or portfolio, by hand. The same system_user_access_tokens call may also recover a business token when the 30-second code is lost (an inference, not stated by Meta).

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/hosted-es

## [verified] Q8d. What domain or app settings does a public signup page need?
Every domain that hosts the ES button must use HTTPS and be listed in BOTH 'Allowed domains' and 'Valid OAuth redirect URIs'. Client OAuth login, Web OAuth login, Enforce HTTPS, Embedded Browser OAuth Login, Strict Mode and Login with the JavaScript SDK must be enabled. A signup page on shifts-ai.com, or any domain other than the ones already configured, must be added before launch. The Tech Provider steps after ES are: exchange the code (30 seconds), POST /{waba}/subscribed_apps, register the number with a 6-digit PIN, optionally send a test message, then the customer adds a payment method in WhatsApp Manager.

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/ ; https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider
