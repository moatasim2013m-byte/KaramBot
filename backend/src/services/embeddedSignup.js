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
 * Create or find the onboarding row for a signup.
 *
 * Keyed on phone_number_id, which is unique per number at Meta: a customer who runs
 * the flow twice for the same number updates one row instead of creating a rival.
 */
async function startOnboarding({ appId, businessId, metaBusinessId, wabaId, phoneNumberId, sessionId }) {
  return prisma.whatsappOnboarding.upsert({
    where: { phone_number_id: phoneNumberId },
    create: {
      app_id: String(appId),
      business_id: businessId || null,
      meta_business_id: String(metaBusinessId || ''),
      waba_id: String(wabaId),
      phone_number_id: String(phoneNumberId),
      session_id: sessionId || null,
      step: 'code_received',
    },
    update: {
      waba_id: String(wabaId),
      meta_business_id: String(metaBusinessId || ''),
      session_id: sessionId || null,
      last_error: null,
      last_error_at: null,
    },
  });
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
 * Returns the row as the dashboard should show it.
 */
async function runOnboarding(onboardingId, { code, pin: suppliedPin } = {}) {
  let row = await prisma.whatsappOnboarding.findUnique({ where: { id: onboardingId } });
  if (!row) throw new Error(`onboarding ${onboardingId} not found`);
  if (row.step === 'done') return row; // already finished — nothing to repeat

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

/** What the customer may see: never the token, never the PIN. */
function publicStatus(row) {
  if (!row) return null;
  return {
    id: row.id,
    waba_id: row.waba_id,
    phone_number_id: row.phone_number_id,
    business_id: row.business_id,
    step: row.step,
    connected: row.step === 'done',
    payment_method_added: row.payment_method_ok,
    // The one thing left that only they can do; shown as a checklist item, not a footnote.
    // From 1 October 2026 Meta charges service messages per message — the bot's REPLY to a
    // customer who wrote first, not only business-initiated sends — and stops delivering them
    // for any account without a payment method on file by 30 September 2026. So this is no
    // longer "outbound campaigns won't go out"; without a card the bot goes silent.
    next_action: row.payment_method_ok ? null : {
      code: 'add_payment_method',
      url: 'https://business.facebook.com/wa/manage/home/',
      deadline: '2026-09-30',
      severity: 'critical',
      ar: 'أضف طريقة دفع في WhatsApp Manager قبل 30 أيلول — بدونها سيتوقف الوكيل عن الرد على العملاء اعتبارًا من 1 تشرين الأول.',
      en: 'Add a payment method in WhatsApp Manager before 30 September — without it the agent stops replying to customers from 1 October.',
    },
    last_error: row.last_error,
    updated_at: row.updated_at,
  };
}

module.exports = {
  runOnboarding,
  startOnboarding,
  publicStatus,
  generatePin,
  exchangeCode,
  subscribeApp,
  registerPhoneNumber,
  STEPS,
};
