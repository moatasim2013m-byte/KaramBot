/**
 * Meta payloads for the connect flow and the account webhooks — ASSUMED, not recorded.
 *
 * Shaped from Meta's documented examples (docs/panels/meta-facts.md Q1a–e, Q2a, Q2d, Q5a–c) with
 * made-up ids. Gate G1 (the first live Embedded Signup) records the real ones under
 * tests/fixtures/es/; until then every test that uses these is a test against the docs, and the
 * shapes marked "likely" there (coexistence, FINISH_ONLY_WABA without a number, PARTNER_* entry.id,
 * the quality and template webhooks, the PIN-mismatch code 133005) are the first to re-check.
 */

const IDS = Object.freeze({
  WABA: '104900000000001',
  PHONE: '109900000000001',
  PHONE_2: '109900000000002',
  PORTFOLIO: '880000000000001', // the customer's business portfolio (client_business_id)
  PARTNER: '2949482758682047', // SHIFT's own portfolio: entry.id on PARTNER_* (Meta's example)
  APP_SCOPED_USER: '122100000000001',
});

const TOKEN = `EAAJ${'z'.repeat(60)}`; // a business integration system user token, never expiring

// postMessage from the popup (type WA_EMBEDDED_SIGNUP), v4.
const finish = ({ phone = IDS.PHONE, waba = IDS.WABA, portfolio = IDS.PORTFOLIO } = {}) => ({
  data: { phone_number_id: phone, waba_id: waba, business_id: portfolio },
  type: 'WA_EMBEDDED_SIGNUP',
  event: 'FINISH',
});
const finishOnlyWaba = ({ waba = IDS.WABA, portfolio = IDS.PORTFOLIO } = {}) => ({
  data: { waba_id: waba, business_id: portfolio },
  type: 'WA_EMBEDDED_SIGNUP',
  event: 'FINISH_ONLY_WABA',
});
const finishCoexistence = ({ waba = IDS.WABA } = {}) => ({
  data: { waba_id: waba },
  type: 'WA_EMBEDDED_SIGNUP',
  event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
  version: 3,
});

// GET /oauth/access_token
const tokenExchange = (token = TOKEN) => ({ access_token: token, token_type: 'bearer' });

// GET /debug_token?input_token=…
const debugToken = ({ wabas = [IDS.WABA], valid = true } = {}) => ({
  data: {
    app_id: '1065272896256103',
    type: 'SYSTEM_USER',
    application: 'SHIFT',
    data_access_expires_at: 0,
    expires_at: 0,
    is_valid: valid,
    issued_at: 1791460800,
    scopes: ['whatsapp_business_management', 'whatsapp_business_messaging', 'public_profile'],
    granular_scopes: [
      { scope: 'whatsapp_business_management', target_ids: wabas },
      { scope: 'whatsapp_business_messaging', target_ids: wabas },
    ],
    user_id: IDS.APP_SCOPED_USER,
  },
});

// GET /{waba}/phone_numbers?fields=id,display_phone_number,verified_name
const number = ({ id = IDS.PHONE, display = '+962 7 9123 4567', name = 'مطعم الشام' } = {}) => ({
  verified_name: name,
  code_verification_status: 'VERIFIED',
  display_phone_number: display,
  quality_rating: 'GREEN',
  platform_type: 'NOT_APPLICABLE',
  throughput: { level: 'STANDARD' },
  id,
});
const phoneNumbers = (numbers = [number()]) => ({
  data: numbers,
  paging: { cursors: { before: 'QVFIUk', after: 'QVFIUl' } },
});

// GET /me?fields=client_business_id (business token)
const me = ({ portfolio = IDS.PORTFOLIO } = {}) => ({ client_business_id: portfolio, id: IDS.APP_SCOPED_USER });

// Graph errors, as axios rejects with them.
const graphFailure = (error, status = 400) => ({ response: { status, data: { error } } });
const codeExpired = () => graphFailure({
  message: 'This authorization code has expired.',
  type: 'OAuthException',
  code: 100,
  error_subcode: 36007,
  fbtrace_id: 'AbCdEf1',
});
const pinMismatch = () => graphFailure({
  message: '(#133005) Two step verification PIN Mismatch',
  type: 'OAuthException',
  code: 133005,
  error_data: { messaging_product: 'whatsapp', details: 'Two step verification PIN incorrect' },
  fbtrace_id: 'AbCdEf2',
});

// Webhook deliveries (object whatsapp_business_account).
const delivery = (entryId, field, value) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: entryId, time: 1791460800, changes: [{ field, value }] }],
});
const partnerAdded = ({ waba = IDS.WABA, owner = IDS.PORTFOLIO } = {}) => delivery(IDS.PARTNER, 'account_update', {
  event: 'PARTNER_ADDED',
  waba_info: {
    waba_id: waba, owner_business_id: owner, solution_id: '1065272896256103', solution_partner_business_ids: [IDS.PARTNER],
  },
});
const partnerRemoved = ({ waba = IDS.WABA, owner = IDS.PORTFOLIO } = {}) => delivery(IDS.PARTNER, 'account_update', {
  event: 'PARTNER_REMOVED',
  waba_info: { waba_id: waba, owner_business_id: owner },
});
const appUninstalled = ({ waba = IDS.WABA, owner = IDS.PORTFOLIO } = {}) => delivery(IDS.PARTNER, 'account_update', {
  event: 'PARTNER_APP_UNINSTALLED',
  waba_info: { waba_id: waba, owner_business_id: owner, partner_app_id: '1065272896256103' },
});
const accountEvent = (event, extra = {}, waba = IDS.WABA) => delivery(waba, 'account_update', { event, ...extra });
const restriction = () => accountEvent('ACCOUNT_RESTRICTION', {
  restriction_info: [{ restriction_type: 'RESTRICTED_BIZ_INITIATED_MESSAGING', expiration: 1792060800 }],
});
const banned = () => accountEvent('DISABLED_UPDATE', { ban_info: { waba_ban_state: ['DISABLE'], waba_ban_date: '2026-10-08' } });
const qualityUpdate = ({ event = 'FLAGGED', display = '962791234567', waba = IDS.WABA } = {}) => delivery(waba, 'phone_number_quality_update', {
  display_phone_number: display, event, current_limit: 'TIER_250',
});
const templateStatus = ({ event = 'APPROVED', name = 'owner_alert', language = 'ar', waba = IDS.WABA } = {}) => delivery(waba, 'message_template_status_update', {
  event, message_template_id: 1290000000000001, message_template_name: name, message_template_language: language, reason: 'NONE',
});

module.exports = {
  IDS,
  TOKEN,
  finish,
  finishOnlyWaba,
  finishCoexistence,
  tokenExchange,
  debugToken,
  number,
  phoneNumbers,
  me,
  graphFailure,
  codeExpired,
  pinMismatch,
  delivery,
  partnerAdded,
  partnerRemoved,
  appUninstalled,
  accountEvent,
  restriction,
  banned,
  qualityUpdate,
  templateStatus,
};
