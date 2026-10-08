/**
 * WhatsApp Embedded Signup (v4) — Tech Provider onboarding.
 *
 * A customer finishes Embedded Signup in the browser; everything after that is
 * server-to-server, because the steps need the app secret and the business token
 * and Meta does not allow them from a browser.
 *
 * Three Graph calls, in order:
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
  if (onboarding && onboarding.id !== onboardingId && onboarding.business_id !== businessId) {
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
 *   - a different number re-points the shop's own row and starts it over, so business_id stays
 *     unique and the new number never inherits the old token or PIN.
 *
 * @param {object} p
 * @param {string} p.businessId  required; whose signup this is
 * @param {{kind?: string, userId?: string}} [p.actor]  who pressed the button (AccountEvent)
 */
async function startOnboarding({
  appId, businessId, metaBusinessId, wabaId, phoneNumberId, sessionId, actor = {},
}) {
  if (!businessId) throw new TypeError('startOnboarding needs the business the signup is for');
  const phone = String(phoneNumberId);

  const own = await prisma.whatsappOnboarding.findUnique({ where: { business_id: businessId } });
  await assertNumberFree(phone, businessId, { onboardingId: own?.id || null, wabaId, actor });

  const signup = {
    app_id: String(appId),
    waba_id: String(wabaId),
    meta_business_id: String(metaBusinessId || ''),
    session_id: sessionId || null,
    started_by_user_id: actor.userId || null,
  };

  try {
    if (!own) {
      return await prisma.whatsappOnboarding.create({
        data: { ...signup, business_id: businessId, phone_number_id: phone, step: 'code_received' },
      });
    }
    if (own.phone_number_id === phone) {
      return await prisma.whatsappOnboarding.update({
        where: { id: own.id },
        data: { ...signup, last_error: null, last_error_at: null },
      });
    }
    return await prisma.whatsappOnboarding.update({
      where: { id: own.id },
      data: {
        ...signup,
        ...NUMBER_FIELDS_RESET,
        ...(own.waba_id === String(wabaId) ? {} : WABA_FIELDS_RESET),
        phone_number_id: phone,
      },
    });
  } catch (err) {
    // Another shop's row took the number between the check and this write: same answer as the
    // check, and still nothing of theirs was touched (the unique index refused the write).
    if (err?.code === 'P2002') {
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
 * Run the onboarding from wherever it stopped.
 *
 * `code` is only needed the first time; a resume uses the stored token, which is why
 * a failed step 2 or 3 does not send the customer back through Embedded Signup.
 * `actor` ({kind, userId}) is who asked, for the es_conflict event when the number turns out
 * to be taken. Returns the row as the dashboard should show it.
 */
async function runOnboarding(onboardingId, { code, pin: suppliedPin, actor = {} } = {}) {
  let row = await prisma.whatsappOnboarding.findUnique({ where: { id: onboardingId } });
  if (!row) throw new Error(`onboarding ${onboardingId} not found`);
  if (row.step === 'done') return row; // already finished — nothing to repeat

  // A resume can come days after the signup started, and the number may have been linked to
  // another shop since. Checked before subscribed_apps and /register, which act on Meta's side.
  if (row.business_id) {
    await assertNumberFree(row.phone_number_id, row.business_id, { onboardingId: row.id, wabaId: row.waba_id, actor });
  }

  // ── Step 1: token ──────────────────────────────────────────────────────────
  if (stepIndex(row.step) < stepIndex('token_exchanged')) {
    if (!code) throw new Error('resume needs a new signup: no code and no stored token');
    let token;
    try {
      token = await exchangeCode(code);
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
  // wa_phone_number_id is unique, so this is also what makes inbound routing work.
  if (row.business_id) {
    await prisma.business.update({
      where: { id: row.business_id },
      data: {
        wa_phone_number_id: row.phone_number_id,
        wa_business_account_id: row.waba_id,
        wa_access_token: row.access_token_enc, // already encrypted, same format the sender expects
        wa_app_id: row.app_id,
      },
    });
  }

  return prisma.whatsappOnboarding.update({ where: { id: row.id }, data: { step: 'done' } });
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
 * What a browser may see: never the token, never the PIN.
 *
 * `audience` 'owner' (the default, so a forgotten argument shows less) carries no ids and no raw
 * Graph error: the owner's screen needs the step, the number as Meta shows it and the payment
 * state. 'staff' (SHIFT's admin mirror) adds the WABA and number ids and the last Graph error,
 * which are what SHIFT needs to follow up with Meta. The payment wording comes from
 * config/metaNotices.js, the one place it is written, in the reader's own wording.
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
  const out = {
    step: row.step,
    connected: row.step === 'done',
    display_phone: business?.wa_display_phone || null,
    verified_name: business?.wa_verified_name || null,
    name_status: row.meta_name_status || null,
    payment: {
      state: payment,
      confirmed: Boolean(row.payment_method_ok),
      claimed: Boolean(row.payment_method_claimed_at),
      blocked: Boolean(row.payment_blocked_at),
    },
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
    failed: Boolean(row.last_error),
    updated_at: row.updated_at,
  };
  if (reader === 'staff') {
    out.waba_id = row.waba_id;
    out.phone_number_id = row.phone_number_id;
    out.last_error = row.last_error;
  }
  return out;
}

module.exports = {
  runOnboarding,
  startOnboarding,
  publicStatus,
  paymentState,
  assertNumberFree,
  numberHolder,
  generatePin,
  exchangeCode,
  subscribeApp,
  registerPhoneNumber,
  STEPS,
};
