/**
 * WhatsApp Embedded Signup (v4) — Tech Provider onboarding.
 *
 * A customer finishes Embedded Signup in the browser; everything after that is
 * server-to-server, because the steps need the app secret and the business token
 * and Meta does not allow them from a browser.
 *
 * Three Graph calls, in order (connectFromCode runs them, with Meta's proof of the ids between
 * 1 and 2):
 *   1. code → business token      (the code dies 30s after the flow ends)
 *   2. POST /<WABA_ID>/subscribed_apps   — our app starts receiving their webhooks
 *   3. POST /<PHONE_NUMBER_ID>/register  — with a generated 6-digit 2FA PIN
 *
 * Each step records where it got to, so a failure in 2 or 3 is resumable: the
 * customer never has to run Embedded Signup again for the same number. Step 4 —
 * a payment method in WhatsApp Manager — only the customer can do, and until they
 * do, business-initiated messages will not send.
 *
 * The token and the PIN are long-lived credentials: encrypted with AES-256-GCM
 * before they touch the database, never logged, never sent to the browser.
 */

const axios = require('axios');
const crypto = require('crypto');
const prisma = require('../config/prisma');
const { encrypt, decrypt } = require('../utils/tokenCrypto');
const { embeddedSignupApp } = require('../utils/metaSecrets');
const accountEvents = require('./accountEvents');
const alerts = require('./alerts');
const metaStatus = require('./metaStatus');
const platformSettings = require('./platformSettings');
const plans = require('../config/plans');
const { WHATSAPP_MANAGER_URL, paymentNotice } = require('../config/metaNotices');

// Same source of truth as the sending code, so the two cannot drift apart.
function graphVersion() {
  return process.env.GRAPH_API_VERSION || 'v24.0';
}
function graphBase() {
  return `https://graph.facebook.com/${graphVersion()}`;
}

const STEPS = ['code_received', 'token_exchanged', 'subscribed', 'registered', 'done'];
const stepIndex = (step) => STEPS.indexOf(step);

/** Meta requires exactly 6 digits. crypto.randomInt keeps it unguessable, including the leading zero. */
function generatePin() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Graph errors carry the useful part in error.error.message; an axios dump would
 * carry the request headers, and those hold the token.
 */
function graphError(err, label) {
  const meta = err?.response?.data?.error;
  const message = meta
    ? `${label}: ${meta.message} (code ${meta.code}${meta.error_subcode ? `/${meta.error_subcode}` : ''})`
    : `${label}: ${err.message}`;
  const clean = new Error(message);
  clean.graph = meta || null;
  clean.status = err?.response?.status || null;
  return clean;
}

/** Step 1 — exchange the 30-second code for the customer's never-expiring business token. */
async function exchangeCode(code) {
  const { appId, secret } = embeddedSignupApp();
  try {
    const { data } = await axios.get(`${graphBase()}/oauth/access_token`, {
      params: { client_id: appId, client_secret: secret, code },
      timeout: 15000,
    });
    if (!data?.access_token) throw new Error('no access_token in response');
    return data.access_token;
  } catch (err) {
    throw graphError(err, 'token exchange failed');
  }
}

/**
 * The FINISH events Embedded Signup can end with (docs/panels/meta-facts.md Q1a). Every one of
 * them carries a code worth exchanging: the browser used to accept only FINISH and burn the
 * 30-second code on the others. FINISH_ONLY_WABA may come without a number, and the coexistence
 * one (FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING) carries only the WABA.
 */
const FINISH_EVENTS = Object.freeze([
  'FINISH',
  'FINISH_ONLY_WABA',
  'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
  'FINISH_OBO_MIGRATION',
  'FINISH_GRANT_ONLY_API_ACCESS',
]);
// A number still on the WhatsApp Business app. Coexistence is off in October (decision 10): its
// number is already registered by the app, so /register is not called and SHIFT finishes by hand.
const COEXISTENCE_EVENT = 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';

/**
 * The browser's finish event, normalised. null when none arrived (the popup closed before the
 * message, or an older browser); undefined when the value is not a FINISH event at all, which the
 * route refuses. An unlisted FINISH_* is kept as sent: Meta adds flows, and a new one is still a
 * finished signup whose code must not be wasted.
 */
function normalizeFinishEvent(value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim().toUpperCase();
  return /^FINISH(_[A-Z]{1,30}){0,6}$/.test(s) && s.length <= 64 ? s : undefined;
}

function ownershipMismatch(detail) {
  return Object.assign(new Error(`es_ownership_mismatch: ${detail}`), { code: 'es_ownership_mismatch', status: 403, detail });
}

/** The numbers on a WABA, read with the customer's own token. One page (Meta's default is 25). */
async function listWabaNumbers(wabaId, token) {
  try {
    const { data } = await axios.get(`${graphBase()}/${wabaId}/phone_numbers`, {
      params: { fields: 'id,display_phone_number,verified_name' },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    return (Array.isArray(data?.data) ? data.data : [])
      .filter((n) => n && n.id !== undefined && n.id !== null)
      .map((n) => ({
        id: String(n.id),
        display_phone_number: n.display_phone_number ? String(n.display_phone_number) : null,
        verified_name: n.verified_name ? String(n.verified_name) : null,
      }));
  } catch (err) {
    throw graphError(err, 'phone_numbers failed');
  }
}

/**
 * The browser's ids proven against Meta, and the missing ones found there, before any is written.
 *
 * The FINISH payload (waba_id, phone_number_id, business_id) comes from the browser, so on its
 * own it proves nothing: a shop could post another shop's fresh number with any code, get it
 * onto its own onboarding row, and leave the real owner a 409 when they connect it
 * (docs/panels/spec.md, «Ownership proof from Meta itself»). The business token answers for what
 * the customer actually granted:
 *   - debug_token granular_scopes: whatsapp_business_management must list the WABA. With no
 *     waba_id from the browser (FINISH never arrived), the token's only granted WABA is used;
 *   - GET /{waba}/phone_numbers (with that token) must list the number. With no phone_number_id
 *     (FINISH_ONLY_WABA, coexistence, no FINISH), the WABA's single number is used. When it has
 *     none the shop still has to add one (resolution 'none'); when it has several, the shop's own
 *     current number wins if it is among them ('own', a reconnect), otherwise SHIFT picks
 *     ('ambiguous'). Guessing the first would bind a number the customer may not have meant;
 *   - GET /me client_business_id is the portfolio, preferred over the browser's.
 * A mismatch throws code 'es_ownership_mismatch' (403 at the route). Several or no granted WABAs
 * with none named throws 'waba_unresolved'. /me is the only read allowed to fail: the portfolio
 * id is informational, not part of the ownership proof.
 *
 * @returns {Promise<{wabaId: string, phoneNumberId: string|null, number: object|null,
 *   resolution: 'given'|'single'|'own'|'none'|'ambiguous', metaBusinessId: string|null}>}
 */
async function verifyGrant(token, { wabaId, phoneNumberId, ownPhoneNumberId = null } = {}) {
  const { appId, secret } = embeddedSignupApp();

  let grant;
  try {
    ({ data: grant } = await axios.get(`${graphBase()}/debug_token`, {
      params: { input_token: token, access_token: `${appId}|${secret}` },
      timeout: 15000,
    }));
  } catch (err) {
    throw graphError(err, 'debug_token failed');
  }
  const scopes = Array.isArray(grant?.data?.granular_scopes) ? grant.data.granular_scopes : [];
  const management = scopes.find((s) => s && s.scope === 'whatsapp_business_management');
  const targets = [...new Set((management?.target_ids || []).map(String))];

  let waba;
  if (wabaId) {
    waba = String(wabaId);
    if (!targets.includes(waba)) throw ownershipMismatch('waba_not_granted');
  } else if (targets.length === 1) {
    [waba] = targets;
  } else {
    // Nothing to keep the token against: WhatsappOnboarding needs a WABA. connectFromCode answers
    // with a failure asking for a new popup; SHIFT sees how many were granted (es_failed).
    throw Object.assign(new Error(`waba_unresolved: ${targets.length} WABAs granted and none named`), {
      code: 'waba_unresolved', granted: targets.length,
    });
  }

  const numbers = await listWabaNumbers(waba, token);
  let number = null;
  let resolution;
  if (phoneNumberId) {
    number = numbers.find((n) => n.id === String(phoneNumberId)) || null;
    if (!number) throw ownershipMismatch('number_not_on_waba');
    resolution = 'given';
  } else if (numbers.length === 1) {
    [number] = numbers;
    resolution = 'single';
  } else if (numbers.length === 0) {
    resolution = 'none';
  } else {
    number = (ownPhoneNumberId && numbers.find((n) => n.id === String(ownPhoneNumberId))) || null;
    resolution = number ? 'own' : 'ambiguous';
  }

  let metaBusinessId = null;
  try {
    const { data: me } = await axios.get(`${graphBase()}/me`, {
      params: { fields: 'client_business_id' },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    if (me?.client_business_id && /^\d{1,32}$/.test(String(me.client_business_id))) metaBusinessId = String(me.client_business_id);
  } catch (err) {
    console.warn(`[embedded-signup] /me unreadable, keeping the browser's portfolio id: ${graphError(err, '/me').message}`);
  }
  return {
    wabaId: waba, phoneNumberId: number ? number.id : null, number, resolution, metaBusinessId,
  };
}

/** Step 2 — subscribe our app to this WABA's webhooks. Idempotent at Meta: repeating it is a no-op. */
async function subscribeApp(wabaId, token) {
  try {
    const { data } = await axios.post(`${graphBase()}/${wabaId}/subscribed_apps`, null, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    return data;
  } catch (err) {
    throw graphError(err, 'subscribed_apps failed');
  }
}

/** Step 3 — register the number for Cloud API with a fresh 2FA PIN. */
async function registerPhoneNumber(phoneNumberId, token, pin) {
  try {
    const { data } = await axios.post(
      `${graphBase()}/${phoneNumberId}/register`,
      { messaging_product: 'whatsapp', pin },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 },
    );
    return data;
  } catch (err) {
    throw graphError(err, 'register failed');
  }
}

/**
 * A number that belongs to another shop is refused, typed, so the route can answer 409.
 *
 * The message names no business: the caller learns only that the number is taken.
 */
function numberTakenError(phoneNumberId) {
  return Object.assign(new Error(`number_taken: ${phoneNumberId} is linked to another account`), {
    code: 'number_taken',
    status: 409,
  });
}

/**
 * Who else holds this number, if anyone: 'business' (another Business row receives its
 * messages), 'onboarding' (another business's signup row) or 'unattached_onboarding' (a row
 * with no business, which only SHIFT may attach). null when the number is free for
 * `businessId`. `onboardingId` is the caller's own row, which never counts against it.
 */
async function numberHolder(phoneNumberId, businessId, { onboardingId = null } = {}) {
  if (!phoneNumberId) return null;
  const business = await prisma.business.findUnique({
    where: { wa_phone_number_id: String(phoneNumberId) },
    select: { id: true },
  });
  if (business && business.id !== businessId) return 'business';
  const onboarding = await prisma.whatsappOnboarding.findUnique({
    where: { phone_number_id: String(phoneNumberId) },
    select: { id: true, business_id: true },
  });
  // With no business (SHIFT completing an orphan), any other row holding the number is a holder.
  if (onboarding && onboarding.id !== onboardingId && (!businessId || onboarding.business_id !== businessId)) {
    return onboarding.business_id ? 'onboarding' : 'unattached_onboarding';
  }
  return null;
}

/**
 * Refuse a number another shop holds, before anything is written and before Meta is called.
 *
 * Without this, the phone-keyed upsert this replaced bound whoever asked to the row (and, after
 * a resume, the stored token) of whichever shop had the number, and subscribed_apps and
 * /register ran on its WABA before a P2002 on the Business row stopped the link. The attempt is
 * recorded on the caller's account (es_conflict), so SHIFT sees a shop that tried someone
 * else's number; the other shop's id is left out, since the caller's log may be shown to them.
 */
async function assertNumberFree(phoneNumberId, businessId, { onboardingId = null, wabaId = null, actor = {} } = {}) {
  const heldBy = await numberHolder(phoneNumberId, businessId, { onboardingId });
  if (!heldBy) return;
  await accountEvents.record({
    businessId,
    actorUserId: actor.userId || null,
    actorKind: actor.kind || 'system',
    type: 'es_conflict',
    data: { phone_number_id: String(phoneNumberId), waba_id: wabaId ? String(wabaId) : null, held_by: heldBy },
  });
  throw numberTakenError(phoneNumberId);
}


// What belongs to the number rather than to the shop. A shop's own row pointed at a new number
// starts over from these, so the new number never inherits the old one's token, PIN or status.
const NUMBER_FIELDS_RESET = {
  step: 'code_received',
  access_token_enc: null,
  pin_enc: null,
  token_exchanged_at: null,
  subscribed_at: null,
  registered_at: null,
  needs_operator: false,
  revoked_at: null,
  revoked_reason: null,
  detached_at: null,
  token_checked_at: null,
  meta_quality_rating: null,
  meta_throughput: null,
  meta_number_status: null,
  meta_name_status: null,
  meta_checked_at: null,
  last_error: null,
  last_error_at: null,
};
// The payment method is the WABA's (WhatsApp Manager bills the account), so it is kept when the
// new number is on the same WABA and starts over on another.
const WABA_FIELDS_RESET = {
  payment_method_ok: false,
  payment_method_marked_by: null,
  payment_method_marked_at: null,
  payment_method_claimed_at: null,
  payment_blocked_at: null,
  meta_review_status: null,
};

/**
 * Create or update the caller's own onboarding row for a signup.
 *
 * The business is the caller's (the owner's session or the admin URL), never the browser's.
 * Keyed on business_id, which is unique: the previous version upserted on phone_number_id, so a
 * request naming another shop's number rewrote that shop's row. Now:
 *   - a number held by another business, or by an unattached row, is refused (409) before any
 *     write and before Meta is called;
 *   - the same number again updates the shop's own row, as before;
 *   - a different number (or none yet) re-points the shop's own row and starts it over, so
 *     business_id stays unique and the new number never inherits the old token or PIN.
 *
 * With `token` (already exchanged and proven by verifyGrant) the row lands at token_exchanged
 * with that token, whatever it was before. That is the reconnect: a 'done' or revoked row of the
 * same shop used to return early in runOnboarding and keep the dead token (spec, «Reconnect is
 * safe»); now a fresh code always re-runs subscribe and register on the fresh token.
 *
 * `phoneNumberId` may be null: the token and WABA are kept so the customer never redoes the popup
 * while the number is found (needs_number) or picked by SHIFT (needs_operator).
 *
 * @param {object} p
 * @param {string} p.businessId  required; whose signup this is
 * @param {{kind?: string, userId?: string}} [p.actor]  who pressed the button (AccountEvent)
 */
async function startOnboarding({
  appId, businessId, metaBusinessId, wabaId, phoneNumberId, sessionId, finishEvent = null,
  needsOperator = false, token = null, actor = {},
}) {
  if (!businessId) throw new TypeError('startOnboarding needs the business the signup is for');
  const phone = phoneNumberId ? String(phoneNumberId) : null;

  const own = await prisma.whatsappOnboarding.findUnique({ where: { business_id: businessId } });
  if (phone) await assertNumberFree(phone, businessId, { onboardingId: own?.id || null, wabaId, actor });

  const signup = {
    app_id: String(appId),
    waba_id: String(wabaId),
    meta_business_id: String(metaBusinessId || ''),
    session_id: sessionId || null,
    started_by_user_id: actor.userId || null,
    finish_event: finishEvent || null,
    needs_operator: Boolean(needsOperator),
  };
  const fresh = token ? {
    access_token_enc: encrypt(token),
    step: 'token_exchanged',
    token_exchanged_at: new Date(),
    revoked_at: null,
    revoked_reason: null,
    detached_at: null,
    token_checked_at: null,
  } : {};

  try {
    if (!own) {
      return await prisma.whatsappOnboarding.create({
        data: { ...signup, business_id: businessId, phone_number_id: phone, step: 'code_received', ...fresh },
      });
    }
    if (phone && own.phone_number_id === phone) {
      return await prisma.whatsappOnboarding.update({
        where: { id: own.id },
        data: { ...signup, last_error: null, last_error_at: null, ...fresh },
      });
    }
    return await prisma.whatsappOnboarding.update({
      where: { id: own.id },
      data: {
        ...NUMBER_FIELDS_RESET,
        ...(own.waba_id === String(wabaId) ? {} : WABA_FIELDS_RESET),
        ...signup,
        phone_number_id: phone,
        ...fresh,
      },
    });
  } catch (err) {
    // Another shop's row took the number between the check and this write: same answer as the
    // check, and still nothing of theirs was touched (the unique index refused the write).
    if (err?.code === 'P2002' && phone) {
      await assertNumberFree(phone, businessId, { onboardingId: own?.id || null, wabaId, actor });
    }
    throw err;
  }
}

async function recordFailure(id, step, err) {
  await prisma.whatsappOnboarding.update({
    where: { id },
    data: { step, last_error: String(err.message).slice(0, 500), last_error_at: new Date() },
  });
}

/**
 * Point the shop's Business row at the onboarding's number: from here inbound messages route to
 * it (wa_phone_number_id is unique) and the sender uses its token.
 *
 * Factored out of runOnboarding so the operator's «أكمل الربط» and «اربط بحساب» take the same
 * path. Whatever row the business held before is detached first (business_id NULL, detached_at),
 * which keeps business_id unique and the old number's history. `number` ({display_phone_number,
 * verified_name}) is what Meta showed for it; without it a changed number's old display fields
 * are cleared rather than shown beside the new number, and metaStatus.refresh fills them.
 * The portfolio id is the row's, which verifyGrant took from GET /me.
 *
 * @returns {Promise<object>} the onboarding row, attached to the business
 */
async function linkOnboardingToBusiness(row, { businessId = row.business_id, number = null, now = new Date() } = {}) {
  if (!businessId) throw new TypeError('linkOnboardingToBusiness needs a business');
  if (!row.phone_number_id) throw new TypeError('linkOnboardingToBusiness needs a number');

  const holder = await prisma.whatsappOnboarding.findUnique({ where: { business_id: businessId } });
  if (holder && holder.id !== row.id) {
    await prisma.whatsappOnboarding.update({ where: { id: holder.id }, data: { business_id: null, detached_at: now } });
  }
  let linked = row;
  if (row.business_id !== businessId) {
    linked = await prisma.whatsappOnboarding.update({ where: { id: row.id }, data: { business_id: businessId, detached_at: null } });
  }

  const current = await prisma.business.findUnique({ where: { id: businessId }, select: { wa_phone_number_id: true } });
  const data = {
    wa_phone_number_id: row.phone_number_id,
    wa_business_account_id: row.waba_id,
    wa_access_token: row.access_token_enc, // already encrypted, same format the sender expects
    wa_app_id: row.app_id,
    connected_at: now,
  };
  if (/^\d{1,32}$/.test(String(row.meta_business_id || ''))) data.meta_business_id = String(row.meta_business_id);
  if (number?.display_phone_number) data.wa_display_phone = String(number.display_phone_number).slice(0, 32);
  else if (current && current.wa_phone_number_id !== row.phone_number_id) data.wa_display_phone = null;
  if (number?.verified_name) data.wa_verified_name = String(number.verified_name).slice(0, 200);
  else if (current && current.wa_phone_number_id !== row.phone_number_id) data.wa_verified_name = null;

  await prisma.business.update({ where: { id: businessId }, data });
  return linked;
}

/**
 * Run the onboarding from wherever it stopped.
 *
 * `code` (or `token`, already exchanged and verified by connectFromCode) is only needed the first
 * time; a resume uses the stored token, which is why a failed step 2 or 3 does not send the
 * customer back through Embedded Signup. `actor` ({kind, userId}) is who asked, for the
 * es_conflict event when the number turns out to be taken. `number` is Meta's view of it, passed
 * to the link. A coexistence row (or `skipRegister`) stops after subscribed_apps, marked
 * needs_operator: its number is registered by the WhatsApp Business app, and /register would
 * take it off the owner's phone. Returns the row as the dashboard should show it.
 */
async function runOnboarding(onboardingId, {
  code, token: exchangedToken, pin: suppliedPin, actor = {}, skipRegister = false, number = null,
} = {}) {
  let row = await prisma.whatsappOnboarding.findUnique({ where: { id: onboardingId } });
  if (!row) throw new Error(`onboarding ${onboardingId} not found`);
  if (row.step === 'done') return row; // already finished — nothing to repeat
  if (!row.phone_number_id) {
    throw Object.assign(new Error('no phone number on this onboarding yet'), { code: 'needs_number' });
  }

  // A resume can come days after the signup started, and the number may have been linked to
  // another shop since. Checked before subscribed_apps and /register, which act on Meta's side.
  if (row.business_id) {
    await assertNumberFree(row.phone_number_id, row.business_id, { onboardingId: row.id, wabaId: row.waba_id, actor });
  }

  // ── Step 1: token ──────────────────────────────────────────────────────────
  if (stepIndex(row.step) < stepIndex('token_exchanged')) {
    if (!code && !exchangedToken) throw new Error('resume needs a new signup: no code and no stored token');
    let token = exchangedToken;
    try {
      // connectFromCode spends the code itself, before verifyGrant, and passes the token in.
      if (!token) token = await exchangeCode(code);
    } catch (err) {
      await recordFailure(row.id, 'code_received', err);
      throw err;
    }
    row = await prisma.whatsappOnboarding.update({
      where: { id: row.id },
      data: {
        access_token_enc: encrypt(token),
        step: 'token_exchanged',
        token_exchanged_at: new Date(),
        last_error: null,
        last_error_at: null,
      },
    });
  }

  const token = decrypt(row.access_token_enc);
  if (!token) throw new Error('stored token is unreadable — check TOKEN_ENCRYPTION_KEY');

  // ── Step 2: webhooks ───────────────────────────────────────────────────────
  if (stepIndex(row.step) < stepIndex('subscribed')) {
    try {
      await subscribeApp(row.waba_id, token);
    } catch (err) {
      await recordFailure(row.id, 'token_exchanged', err);
      throw err;
    }
    row = await prisma.whatsappOnboarding.update({
      where: { id: row.id },
      data: { step: 'subscribed', subscribed_at: new Date(), last_error: null, last_error_at: null },
    });
  }

  if (skipRegister || row.finish_event === COEXISTENCE_EVENT) {
    if (row.needs_operator) return row;
    return prisma.whatsappOnboarding.update({ where: { id: row.id }, data: { needs_operator: true } });
  }

  // ── Step 3: register the number ────────────────────────────────────────────
  if (stepIndex(row.step) < stepIndex('registered')) {
    // A retry after a failed register reuses the stored PIN: Meta remembers the PIN it
    // accepted, so a fresh one on every attempt would lock the customer out of 2FA.
    //
    // `suppliedPin` is the way out of the one case the stored PIN cannot solve: a number
    // that already had two-step verification set somewhere else. Meta then rejects any PIN
    // but the existing one, and retrying with ours would fail forever — so the customer's
    // own PIN can be passed in and takes precedence.
    if (suppliedPin !== undefined && !/^\d{6}$/.test(String(suppliedPin))) {
      throw new Error('pin must be exactly 6 digits');
    }
    const pin = suppliedPin ? String(suppliedPin) : (decrypt(row.pin_enc) || generatePin());
    try {
      await registerPhoneNumber(row.phone_number_id, token, pin);
    } catch (err) {
      await prisma.whatsappOnboarding.update({ where: { id: row.id }, data: { pin_enc: encrypt(pin) } });
      await recordFailure(row.id, 'subscribed', err);
      throw err;
    }
    row = await prisma.whatsappOnboarding.update({
      where: { id: row.id },
      data: {
        pin_enc: encrypt(pin),
        step: 'registered',
        registered_at: new Date(),
        last_error: null,
        last_error_at: null,
      },
    });
  }

  // ── Link to the business row that will receive the messages ────────────────
  // A row with no business (an orphan) stops at 'registered' until SHIFT attaches it.
  if (!row.business_id) return row;
  row = await linkOnboardingToBusiness(row, { number });
  return prisma.whatsappOnboarding.update({ where: { id: row.id }, data: { step: 'done', needs_operator: false } });
}

// ── After a connect ────────────────────────────────────────────────────────────

// Subscription.campaign for the free month when PlatformSetting campaign names none.
const DEFAULT_CAMPAIGN_SLUG = 'irbid-2026-10';

/**
 * The shop's free-month contract, created once, at connect (never at invite: an unused invite
 * must not take one of the offer's places, shiftSweeper.offerPlacesLeft).
 *
 * Idempotent by looking first: any Karam Bot subscription the shop already has, whatever its
 * status, means no new trial. A reconnect, a retry or SHIFT's own contract therefore never adds a
 * second one, and a cancelled shop does not get a fresh free month by reconnecting. The terms are
 * plans.js's, with the free-month rules from PlatformSetting campaign. Internal rows (SHIFT, the
 * -sim shops) get none.
 *
 * @returns {Promise<{subscription: object|null, created: boolean}>}
 */
async function ensureTrialSubscription(businessId, { connectedAt = new Date(), createdBy = 'system' } = {}) {
  if (!businessId) throw new TypeError('ensureTrialSubscription needs a business');
  const existing = await prisma.subscription.findFirst({
    where: { business_id: businessId, solution: plans.DEFAULT_PLAN.solution },
    orderBy: { created_at: 'desc' },
  });
  if (existing) return { subscription: existing, created: false };

  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, is_internal: true } });
  if (!business || business.is_internal) return { subscription: null, created: false };

  // A shop that was already answering its customers before this connect is one of the hand-wired
  // shops that predate contracts, reconnected after its token died. costGuard treats it as paying
  // (soft cap); a trial here would hand it a free month it never had and a hard reply cap that
  // silences a paying shop. connected_at cannot tell (the link just rewrote it), but a message
  // sent before the connect can: a shop connecting for the first time has had no number to send
  // from. SHIFT sets its contract by hand instead.
  const servedBefore = await prisma.message.findFirst({
    where: { business_id: businessId, direction: 'outbound', created_at: { lt: connectedAt } },
    select: { id: true },
  });
  if (servedBefore) return { subscription: null, created: false, skipped: 'served_before' };

  const campaign = (await platformSettings.get('campaign')) || {};
  const data = plans.trialSubscriptionData({
    businessId,
    createdBy,
    connectedAt,
    campaign: typeof campaign.slug === 'string' && campaign.slug.trim() ? campaign.slug.trim() : DEFAULT_CAMPAIGN_SLUG,
    ...(Number.isFinite(campaign.trial_days) ? { trialDays: campaign.trial_days } : {}),
    ...(Number.isFinite(campaign.backstop_days) ? { backstopDays: campaign.backstop_days } : {}),
    ...(['first_reply', 'connect'].includes(campaign.trial_starts) ? { trialStarts: campaign.trial_starts } : {}),
  });
  const subscription = await prisma.subscription.create({ data });
  return { subscription, created: true };
}

// The row again after afterConnect, so the answer carries what metaStatus.refresh just stored.
async function reread(row) {
  return (await prisma.whatsappOnboarding.findUnique({ where: { id: row.id } }).catch(() => null)) || row;
}

function eventLogger(businessId, actor = {}) {
  return (type, data) => accountEvents.record({
    businessId,
    actorUserId: actor.userId || null,
    actorKind: actor.kind || 'system',
    type,
    data,
  });
}

// notifyShift never throws, and SHIFT's alert must not hold up the shop's screen.
function tellShift(payload) {
  try {
    Promise.resolve(alerts.notifyShift(payload)).catch(() => {});
  } catch (err) {
    console.error(`[embedded-signup] notifyShift ${payload.reason} failed: ${err.message}`);
  }
}

/**
 * Everything that follows a number going live on a shop: Meta's view of it stored at once (so the
 * panel is never empty), the free month, the log line and SHIFT's alert. Each step is best effort:
 * the shop is connected already and none of these may undo that.
 */
async function afterConnect({ businessId, onboarding, actor = {}, finishEvent = null, resumedFrom = null, now = new Date() }) {
  let business = null;
  try {
    business = await prisma.business.findUnique({ where: { id: businessId } });
    if (business) {
      const meta = await metaStatus.refresh(business);
      if (meta?.display_phone_number && !business.wa_display_phone) business.wa_display_phone = meta.display_phone_number;
    }
  } catch (err) {
    console.warn(`[embedded-signup] Meta status after connect business=${businessId}: ${err.message}`);
  }
  try {
    const trial = await ensureTrialSubscription(businessId, { connectedAt: now, createdBy: actor.kind === 'shift' ? (actor.userId || 'shift') : 'system' });
    // On the log, so SHIFT sees why a reconnected shop has no free month and sets its contract.
    if (trial.skipped) await eventLogger(businessId, actor)('trial_skipped', { reason: trial.skipped });
  } catch (err) {
    console.error(`[embedded-signup] trial subscription business=${businessId} not created: ${err.message}`);
  }
  await eventLogger(businessId, actor)('es_connected', {
    waba_id: onboarding.waba_id,
    phone_number_id: onboarding.phone_number_id,
    finish_event: finishEvent || onboarding.finish_event || null,
    ...(resumedFrom ? { resumed_from: resumedFrom } : {}),
  });
  // The owner_alert template on the shop's own WABA, so handoff alerts reach the owner outside 24 h.
  // Not awaited: Meta's review is no reason to hold the owner's screen, and it never throws.
  try { require('./ownerAlertTemplate').submitAfterConnect(businessId, { now }).catch(() => {}); } catch (err) { console.warn(`[embedded-signup] owner alert template business=${businessId}: ${err.message}`); }
  const display = business?.wa_display_phone ? `‎${business.wa_display_phone}` : 'رقمه';
  tellShift({
    reason: 'customer_connected',
    businessId,
    shopName: business?.name || '',
    summary: `ربط واتساب ${display} — التالي: بطاقة الدفع`,
  });
}

// ── What a failure means to the person looking at it ──────────────────────────

// Arabic for the owner's and SHIFT's screens. The Graph message (English, and sometimes naming
// ids) stays in last_error for staff; these never carry an id.
const ERRORS_AR = Object.freeze({
  code_expired: 'انتهت مهلة الموافقة — اضغط «أكمل الربط» وستُفتح نافذة فيسبوك من جديد.',
  partial: 'تم الربط جزئيًا — اضغط «حاول مرة أخرى» ونكمل من حيث توقفنا.',
  pin_mismatch: 'على رقمك رمز تحقق بخطوتين. أدخل الرمز المكوّن من 6 أرقام لنكمل الربط.',
  number_not_verified: 'لم يكتمل التحقق من الرقم لدى Meta — أكمل التحقق ثم اضغط «حاول مرة أخرى».',
  meta_busy: 'خدمة Meta مشغولة الآن — حاول مرة أخرى بعد دقائق.',
  revoked: 'انفصل كرم بوت عن حسابك في Meta — البوت لا يستقبل الرسائل. اضغط «أعد الربط».',
  // No FINISH and a grant of several WABAs (or none): the token cannot be kept against one, so
  // the only way on is a new popup with one account chosen.
  waba_unresolved: 'لم نعرف أي حساب واتساب للأعمال تقصد — اضغط «أكمل الربط» واختر حسابًا واحدًا فيه رقمك، أو تواصل مع شِفت.',
  needs_number: 'أنشأت حساب واتساب للأعمال دون إضافة رقم — اضغط «أضف الرقم» لتكمل.',
  needs_operator: 'وصلتنا موافقتك لكن لم نحدد الرقم — سيُكمل فريق شِفت الربط دون أن تعيد الخطوات.',
  coexistence: 'هذا الرقم مربوط بتطبيق واتساب للأعمال — سيتواصل معك فريق شِفت لترتيب الربط.',
  ownership: 'هذا الرقم لا يتبع الحساب الذي دخلت به في فيسبوك.',
  number_taken: 'هذا الرقم مربوط بحساب آخر لدى شِفت — تواصل معنا.',
  generic: 'لم يكتمل ربط واتساب. حاول مرة أخرى، أو تواصل مع فريق شِفت.',
});

// The step that failed, from the step the row was left at (recordFailure keeps the last good one).
const FAILED_STEP = Object.freeze({
  code_received: 'exchange', token_exchanged: 'subscribe', subscribed: 'register', registered: 'link',
});

// SHIFT's alerts are Arabic WhatsApp messages: the stage a connect stopped at, in words (the
// same ones ConnectWhatsApp's FAILED_STEP_LABEL shows), never the code's key.
const STAGE_AR = Object.freeze({
  exchange: 'تأكيد الموافقة',
  verify: 'التحقق من الرقم',
  onboarding: 'حفظ الربط',
  subscribe: 'ربط الرقم بكرم بوت',
  register: 'تسجيل الرقم',
  link: 'إكمال الربط',
});
const stageAr = (stage) => STAGE_AR[stage] || 'إحدى خطوات الربط';

// Graph codes worth their own words. 133005 (two-step PIN mismatch) is assumed from Meta's
// error-code table until G1 records a real one (spec, «Failure paths»).
const PIN_MISMATCH_CODES = new Set([133005]);
const BUSY_CODES = new Set([1, 2, 4, 17, 80007, 130429, 131000, 133004, 133015, 133016]);

/**
 * Arabic for a failure, from its Graph code and the step it happened in. Every exchange failure
 * reads as an expired approval: the code is spent either way, and a new popup is the cure.
 * @returns {{key: string, text: string, needsPin: boolean}}
 */
function errorAr({ code = null, step = null } = {}) {
  const n = Number(code);
  const pick = (key) => ({ key, text: ERRORS_AR[key], needsPin: key === 'pin_mismatch' });
  if (step === 'exchange') return pick('code_expired');
  if (n === 190) return pick('revoked');
  if (PIN_MISMATCH_CODES.has(n) && step === 'register') return pick('pin_mismatch');
  if (n === 133006) return pick('number_not_verified');
  if (BUSY_CODES.has(n)) return pick('meta_busy');
  if (['subscribe', 'register', 'link'].includes(step)) return pick('partial');
  return pick('generic');
}

// recordFailure stores graphError's message, «label: message (code N/sub)».
function graphCodeOf(lastError) {
  const m = /\(code (\d+)/.exec(String(lastError || ''));
  return m ? Number(m[1]) : null;
}

/**
 * The connection in one word, for both panels (the API contract's `status`):
 * not_started · in_progress · connected · needs_number · needs_operator · failed.
 * A removal by Meta outranks everything; a row SHIFT has to finish outranks 'done'.
 */
function deriveStatus(row) {
  if (!row) return 'not_started';
  if (row.revoked_at) return 'failed';
  if (row.needs_operator) return 'needs_operator';
  if (row.step === 'done') return 'connected';
  if (!row.phone_number_id) return 'needs_number';
  if (row.last_error) return 'failed';
  return 'in_progress';
}

/** What went wrong with this row, in Arabic and as the contract's flags. */
function problemOf(row) {
  if (!row) return { last_error_ar: null, needs_pin: false, failed_step: null };
  if (row.revoked_at) return { last_error_ar: ERRORS_AR.revoked, needs_pin: false, failed_step: null };
  if (row.needs_operator) {
    const key = row.finish_event === COEXISTENCE_EVENT ? 'coexistence' : 'needs_operator';
    return { last_error_ar: ERRORS_AR[key], needs_pin: false, failed_step: null };
  }
  if (row.step !== 'done' && !row.phone_number_id) return { last_error_ar: ERRORS_AR.needs_number, needs_pin: false, failed_step: null };
  if (!row.last_error || row.step === 'done') return { last_error_ar: null, needs_pin: false, failed_step: null };
  const step = FAILED_STEP[row.step] || null;
  const { text, needsPin } = errorAr({ code: graphCodeOf(row.last_error), step });
  return { last_error_ar: text, needs_pin: needsPin, failed_step: step };
}

// ── The flows the routes call ────────────────────────────────────────────────

function typed(code, status, messageAr, extra = {}) {
  return Object.assign(new Error(code), { code, status, message_ar: messageAr, ...extra });
}

/**
 * A finished Embedded Signup, from the code to a live number (docs/panels/spec.md, connectFromCode).
 *
 * Order: (0) a number the browser named that another shop holds is refused from the database
 * alone, before the code is spent; (1) exchangeCode, first, inside its 30-second life;
 * (2) verifyGrant proves the browser's ids and finds the missing ones; (3) the number is checked
 * free again, now that it is Meta's; (4) the shop's own row is upserted with the fresh token (a
 * reconnect resets a done or revoked row); a number still unknown stops here as needs_number or
 * needs_operator, with the token and WABA kept so the customer never redoes the popup;
 * (5–6) subscribed_apps and /register (skipped for coexistence, needs_operator); (7) the Business
 * row is linked; (8) Meta status, (9) the trial, (10) es_connected and SHIFT's alert.
 *
 * Every outcome is on the account's log. Throws for the route to answer: number_taken (409),
 * es_ownership_mismatch (403), waba_unresolved (422: no FINISH and not one WABA granted, so
 * nothing could be kept and a new popup is the only way on), and a Graph failure with `stage`
 * and `onboarding` attached.
 *
 * @param {object} p
 * @param {string} p.businessId  from the session or the admin URL, never the browser
 * @param {string} p.code        the 30-second code
 * @param {string|null} [p.finishEvent]  FINISH, FINISH_ONLY_WABA, … or null when none arrived
 * @param {{wabaId?, phoneNumberId?, metaBusinessId?, sessionId?}} [p.hints]  the browser's FINISH data
 * @param {{kind: string, userId?: string}} [p.actor]
 * @returns {Promise<{status: string, onboarding: object|null}>}
 */
async function connectFromCode({ businessId, code, finishEvent = null, hints = {}, actor = {} }) {
  if (!businessId) throw new TypeError('connectFromCode needs the business the signup is for');
  const event = normalizeFinishEvent(finishEvent) || null;
  const wabaHint = hints.wabaId ? String(hints.wabaId) : null;
  const phoneHint = hints.phoneNumberId ? String(hints.phoneNumberId) : null;
  const portfolioHint = hints.metaBusinessId ? String(hints.metaBusinessId) : null;
  const log = eventLogger(businessId, actor);

  const own = await prisma.whatsappOnboarding.findUnique({ where: { business_id: businessId } });
  let stage = 'exchange';
  try {
    if (phoneHint) await assertNumberFree(phoneHint, businessId, { onboardingId: own?.id || null, wabaId: wabaHint, actor });

    const token = await exchangeCode(code);
    stage = 'verify';
    const grant = await verifyGrant(token, {
      wabaId: wabaHint, phoneNumberId: phoneHint, ownPhoneNumberId: own?.phone_number_id || null,
    });
    stage = 'onboarding';

    // The portfolio the browser named is kept only for comparison. A different one from /me is
    // not a refusal (the token's grants are the proof), but SHIFT should look at it.
    if (portfolioHint && grant.metaBusinessId && portfolioHint !== grant.metaBusinessId) {
      await log('es_ownership_mismatch', { detail: 'portfolio_differs', waba_id: grant.wabaId, blocking: false });
      tellShift({ reason: 'needs_operator', businessId, summary: 'حساب Meta الذي ربط منه يختلف عمّا أرسله المتصفح — راجِع الربط' });
    }

    const coexistence = event === COEXISTENCE_EVENT;
    const row = await startOnboarding({
      appId: embeddedSignupApp().appId,
      businessId,
      metaBusinessId: grant.metaBusinessId || portfolioHint,
      wabaId: grant.wabaId,
      phoneNumberId: grant.phoneNumberId,
      sessionId: hints.sessionId ? String(hints.sessionId).slice(0, 128) : null,
      finishEvent: event,
      needsOperator: coexistence || grant.resolution === 'ambiguous',
      token,
      actor,
    });

    if (!row.phone_number_id) {
      const status = deriveStatus(row);
      await log('es_failed', {
        stage: 'number', status, resolution: grant.resolution, finish_event: event, waba_id: grant.wabaId,
      });
      tellShift({
        reason: 'needs_operator',
        businessId,
        summary: status === 'needs_number'
          ? 'وافق في Meta لكن حساب واتساب بلا رقم — ينتظر إضافة الرقم'
          : 'وافق في Meta وعلى حسابه أكثر من رقم — اختر الرقم من «ربط بدون حساب»',
      });
      return { status, onboarding: row };
    }

    stage = 'subscribe';
    const done = await runOnboarding(row.id, { token, actor, skipRegister: coexistence, number: grant.number });
    if (done.step !== 'done') {
      await log('es_failed', {
        stage: 'register', status: deriveStatus(done), reason: coexistence ? 'coexistence' : 'not_linked',
        finish_event: event, waba_id: done.waba_id, phone_number_id: done.phone_number_id,
      });
      tellShift({ reason: 'needs_operator', businessId, summary: 'الرقم على تطبيق واتساب للأعمال — الربط المشترك غير مفعّل، لم نسجّله' });
      return { status: deriveStatus(done), onboarding: done };
    }
    await afterConnect({ businessId, onboarding: done, actor, finishEvent: event });
    return { status: 'connected', onboarding: await reread(done) };
  } catch (err) {
    // es_conflict is already on the account, and nothing was written or sent to Meta.
    if (err.code === 'number_taken') throw Object.assign(err, { message_ar: ERRORS_AR.number_taken });
    // Meta says the token does not cover these ids: nothing was written. SHIFT hears of it,
    // since it is either a probe for another shop's number or a signup that went wrong.
    if (err.code === 'es_ownership_mismatch') {
      await log('es_ownership_mismatch', { waba_id: wabaHint, phone_number_id: phoneHint, detail: err.detail });
      tellShift({ reason: 'needs_operator', businessId, summary: 'رقم واتساب لا يتبع حساب فيسبوك الذي دخل به الزبون' });
      throw Object.assign(err, { message_ar: ERRORS_AR.ownership });
    }
    // Nothing was kept (WhatsappOnboarding needs a WABA, and the token named none), so there is
    // no row SHIFT could finish: telling the customer «لا داعي لإعادة الخطوات» would be untrue.
    // A failure asking for a new popup with one account chosen; SHIFT hears of it too.
    if (err.code === 'waba_unresolved') {
      await log('es_failed', { stage: 'verify', status: 'failed', reason: 'waba_unresolved', granted: err.granted });
      tellShift({ reason: 'connect_failed', businessId, summary: 'وافق في Meta دون تحديد حساب واتساب واحد — يلزم ربط جديد، تواصل معه' });
      throw Object.assign(err, { status: 422, stage: 'verify', onboarding: null, message_ar: ERRORS_AR.waba_unresolved, needs_pin: false });
    }
    // The step reached is on the caller's own row when there is one, so the panel can offer a
    // resume rather than a fresh signup.
    console.error('[embedded-signup] onboarding failed:', err.message);
    const current = await prisma.whatsappOnboarding.findUnique({ where: { business_id: businessId } }).catch(() => null);
    const failedStep = stage === 'subscribe' ? (FAILED_STEP[current?.step] || 'subscribe') : stage;
    await log('es_failed', {
      stage: failedStep,
      step: current?.step || null,
      error_message: err.message,
      error_code: err.graph?.code ?? null,
      error_subcode: err.graph?.error_subcode ?? null,
      waba_id: wabaHint,
      phone_number_id: phoneHint,
    });
    tellShift({ reason: 'connect_failed', businessId, summary: `توقف الربط عند: ${stageAr(failedStep)}` });
    const ar = errorAr({ code: err.graph?.code, step: failedStep });
    throw Object.assign(err, {
      stage: failedStep, onboarding: current, message_ar: ar.text, needs_pin: ar.needsPin,
    });
  }
}

/**
 * Continue the shop's own signup that stopped at step 2 or 3, with the stored token.
 *
 * Rows that a retry cannot finish come back as they are, with no Meta call: no number yet
 * (needs_number), one SHIFT has to finish (needs_operator) and one Meta removed (a fresh code is
 * the only way back). Returns null when the shop has no onboarding.
 */
async function resumeOnboarding({ businessId, pin, actor = {} }) {
  const row = await prisma.whatsappOnboarding.findFirst({
    where: { business_id: businessId },
    orderBy: { created_at: 'desc' },
  });
  if (!row) return null;
  if (row.step === 'done' || row.revoked_at || row.needs_operator || !row.phone_number_id) {
    return { status: deriveStatus(row), onboarding: row };
  }

  let done;
  try {
    done = await runOnboarding(row.id, { pin, actor });
  } catch (err) {
    if (err.code === 'number_taken') throw Object.assign(err, { message_ar: ERRORS_AR.number_taken });
    console.error('[embedded-signup] retry failed:', err.message);
    const current = await prisma.whatsappOnboarding.findUnique({ where: { id: row.id } }).catch(() => null);
    const failedStep = FAILED_STEP[current?.step || row.step] || null;
    await eventLogger(businessId, actor)('es_failed', {
      stage: 'retry',
      step: current?.step || row.step,
      error_message: err.message,
      error_code: err.graph?.code ?? null,
      error_subcode: err.graph?.error_subcode ?? null,
    });
    const ar = errorAr({ code: err.graph?.code, step: failedStep });
    throw Object.assign(err, { stage: failedStep, onboarding: current, message_ar: ar.text, needs_pin: ar.needsPin });
  }
  if (done.step !== 'done') return { status: deriveStatus(done), onboarding: done };
  await afterConnect({ businessId, onboarding: done, actor, resumedFrom: row.step });
  const fresh = await reread(done);
  return { status: deriveStatus(fresh), onboarding: fresh };
}

/**
 * SHIFT's «أكمل الربط»: the number for a row Meta left without one (FINISH_ONLY_WABA, several
 * numbers, no FINISH), proven on the row's WABA with the stored token, then the usual steps.
 * The customer does not open the popup again.
 */
async function completeOnboarding({ onboardingId, phoneNumberId, actor = {} }) {
  const row = await prisma.whatsappOnboarding.findUnique({ where: { id: String(onboardingId) } });
  if (!row) throw typed('not_found', 404, 'لا يوجد ربط بهذا المعرّف.');
  if (row.finish_event === COEXISTENCE_EVENT) {
    throw typed('coexistence', 409, 'هذا الرقم على تطبيق واتساب للأعمال، والربط المشترك غير مفعّل بعد.');
  }
  if (row.phone_number_id && !row.needs_operator) {
    throw typed('has_number', 409, 'لهذا الربط رقم مسبقًا — أكمله من تبويب «الحالة» في صفحة الحساب، أو اربطه بزبون.');
  }
  const token = decrypt(row.access_token_enc);
  if (!token) throw typed('no_token', 409, 'لا يوجد رمز وصول محفوظ لهذا الربط — يلزم ربط جديد من نافذة Meta.');

  const phone = String(phoneNumberId);
  const numbers = await listWabaNumbers(row.waba_id, token);
  const number = numbers.find((n) => n.id === phone);
  if (!number) throw typed('number_not_on_waba', 422, 'هذا الرقم ليس على حساب واتساب للأعمال الذي وافق عليه الزبون.');
  await assertNumberFree(phone, row.business_id, { onboardingId: row.id, wabaId: row.waba_id, actor });

  const sameNumber = row.phone_number_id === phone;
  await prisma.whatsappOnboarding.update({
    where: { id: row.id },
    data: {
      phone_number_id: phone,
      needs_operator: false,
      last_error: null,
      last_error_at: null,
      // A new number is registered afresh; the WABA subscription is the WABA's and stays.
      ...(sameNumber ? {} : {
        pin_enc: null,
        registered_at: null,
        step: stepIndex(row.step) > stepIndex('subscribed') ? 'subscribed' : row.step,
      }),
    },
  });

  let done;
  try {
    done = await runOnboarding(row.id, { actor, number });
  } catch (err) {
    if (err.code === 'number_taken') throw err;
    const current = await prisma.whatsappOnboarding.findUnique({ where: { id: row.id } }).catch(() => null);
    const failedStep = FAILED_STEP[current?.step] || null;
    if (row.business_id) {
      await eventLogger(row.business_id, actor)('es_failed', {
        stage: 'complete', step: current?.step || null, error_message: err.message, error_code: err.graph?.code ?? null,
      });
    }
    const ar = errorAr({ code: err.graph?.code, step: failedStep });
    throw Object.assign(err, { status: 502, onboarding: current, message_ar: ar.text, needs_pin: ar.needsPin });
  }
  if (done.step === 'done' && done.business_id) {
    await afterConnect({ businessId: done.business_id, onboarding: done, actor, resumedFrom: row.step });
    done = await reread(done);
  }
  return { status: deriveStatus(done), onboarding: done };
}

/**
 * SHIFT's «اربط بحساب»: an onboarding no business owns (an old admin signup, a row whose shop was
 * detached) given to one. The number must be free for that business, and a business already
 * connected is replaced only when SHIFT says so (`replace`), since its live number stops
 * receiving. A row past /register is linked at once; an earlier one waits for a retry.
 */
async function attachOnboarding({ onboardingId, businessId, replace = false, actor = {} }) {
  const row = await prisma.whatsappOnboarding.findUnique({ where: { id: String(onboardingId) } });
  if (!row) throw typed('not_found', 404, 'لا يوجد ربط بهذا المعرّف.');
  if (row.business_id) throw typed('already_attached', 409, 'هذا الربط تابع لحساب مسبقًا.');
  const business = await prisma.business.findUnique({ where: { id: String(businessId) }, select: { id: true, wa_phone_number_id: true } });
  if (!business) throw typed('business_not_found', 404, 'لا يوجد حساب بهذا المعرّف.');

  const held = await prisma.whatsappOnboarding.findUnique({ where: { business_id: business.id } });
  const live = (held && held.step === 'done' && !held.revoked_at) || Boolean(business.wa_phone_number_id && business.wa_phone_number_id !== row.phone_number_id);
  if (live && !replace) {
    throw typed('business_connected', 409, 'هذا الحساب مربوط برقم يعمل. أكّد الاستبدال إن كنت تريد نقل الحساب إلى هذا الرقم.');
  }
  if (row.phone_number_id) await assertNumberFree(row.phone_number_id, business.id, { onboardingId: row.id, wabaId: row.waba_id, actor });

  const now = new Date();
  let attached;
  if (row.phone_number_id && ['registered', 'done'].includes(row.step) && !row.needs_operator) {
    attached = await linkOnboardingToBusiness(row, { businessId: business.id, now });
    attached = await prisma.whatsappOnboarding.update({ where: { id: row.id }, data: { step: 'done', started_by_user_id: actor.userId || null } });
    await afterConnect({ businessId: business.id, onboarding: attached, actor, resumedFrom: 'orphan', now });
    attached = await reread(attached);
  } else {
    if (held && held.id !== row.id) {
      await prisma.whatsappOnboarding.update({ where: { id: held.id }, data: { business_id: null, detached_at: now } });
    }
    attached = await prisma.whatsappOnboarding.update({
      where: { id: row.id }, data: { business_id: business.id, detached_at: null, started_by_user_id: actor.userId || null },
    });
    await eventLogger(business.id, actor)('es_attached', { waba_id: row.waba_id, phone_number_id: row.phone_number_id, step: row.step });
  }
  return { status: deriveStatus(attached), onboarding: attached };
}

/**
 * Where the shop stands with paying Meta. A 131042 refusal (blocked) overrides everything,
 * including SHIFT's confirmation: Meta has just said the card does not work.
 */
function paymentState(row) {
  if (row.payment_blocked_at) return 'blocked';
  if (row.payment_method_ok) return 'confirmed';
  if (row.payment_method_claimed_at) return 'claimed';
  return 'missing';
}

/**
 * What a browser may see: never the token, never the PIN, never a Meta id. The number is shown
 * the way Meta displays it (display_phone), which is what the shop and its staff recognise.
 *
 * The shape is the API contract's onboarding object (step, display_phone, verified_name,
 * name_status, quality_rating, payment, last_error_ar, needs_pin, failed_step), plus the payment
 * checklist item the current card reads. `audience` 'owner' (the default, so a forgotten argument
 * shows less) gets Arabic only. 'staff' (SHIFT's admin mirror) also gets the raw Graph error,
 * which is what SHIFT quotes to Meta support; the ids it follows up with are in the orphans list
 * and the account's log. The payment wording comes from config/metaNotices.js, the one place it
 * is written, in the reader's own wording.
 *
 * @param {object|null} row  the WhatsappOnboarding row
 * @param {object} [opts]
 * @param {object} [opts.business]  {wa_display_phone, wa_verified_name}, when the caller loaded it
 * @param {'owner'|'staff'} [opts.audience='owner']
 */
function publicStatus(row, { business = null, audience = 'owner' } = {}) {
  if (!row) return null;
  const reader = audience === 'staff' ? 'staff' : 'owner';
  const payment = paymentState(row);
  // A detached or revoked row's number is not the shop's working number; the Business row is.
  const out = {
    step: row.step,
    connected: deriveStatus(row) === 'connected',
    display_phone: business?.wa_display_phone || null,
    verified_name: business?.wa_verified_name || null,
    name_status: row.meta_name_status || null,
    quality_rating: row.meta_quality_rating || null,
    payment: {
      state: payment,
      confirmed: Boolean(row.payment_method_ok),
      claimed: Boolean(row.payment_method_claimed_at),
      blocked: Boolean(row.payment_blocked_at),
    },
    ...problemOf(row),
    // The one thing left that only the shop can do; shown as a checklist item, not a footnote.
    // Since October 2026 Meta refuses a WABA's bot replies without a payment method, so without
    // a card the bot goes silent.
    next_action: payment === 'confirmed' ? null : {
      code: 'add_payment_method',
      state: payment,
      url: WHATSAPP_MANAGER_URL,
      severity: payment === 'claimed' ? 'info' : 'critical',
      title: paymentNotice(payment, reader, 'short'),
      ar: paymentNotice(payment, reader, 'long'),
    },
    failed: Boolean(row.last_error) || Boolean(row.revoked_at),
    // Meta took SHIFT off the account: its own red state on the panel, with «أعد الربط».
    revoked: Boolean(row.revoked_at),
    updated_at: row.updated_at,
  };
  if (reader === 'staff') out.last_error = row.last_error || null;
  return out;
}

module.exports = {
  connectFromCode,
  resumeOnboarding,
  completeOnboarding,
  attachOnboarding,
  linkOnboardingToBusiness,
  ensureTrialSubscription,
  afterConnect,
  runOnboarding,
  startOnboarding,
  publicStatus,
  deriveStatus,
  errorAr,
  paymentState,
  assertNumberFree,
  numberHolder,
  generatePin,
  exchangeCode,
  verifyGrant,
  listWabaNumbers,
  normalizeFinishEvent,
  subscribeApp,
  registerPhoneNumber,
  STEPS,
  FINISH_EVENTS,
  COEXISTENCE_EVENT,
  ERRORS_AR,
  STAGE_AR,
};
