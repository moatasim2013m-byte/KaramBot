const axios = require('axios');
const crypto = require('crypto');
const { isWithinServiceWindow } = require('../utils/serviceWindow');

// Read on every call (not a module constant) so a version bump is an env change, not a
// deploy. v19.0 is expired and v20.0 expires 2026-09-24 (decision D10).
function graphVersion() {
  return process.env.GRAPH_API_VERSION || 'v24.0';
}

function graphBase() {
  return `https://graph.facebook.com/${graphVersion()}`;
}

// D17: Meta echoes this string in every status webhook for the message, so a status can be matched to
// the intent row that caused the send without guessing by recipient and time. Max 512 characters; a
// longer value is dropped rather than cut, because a cut id would match no intent.
const CALLBACK_DATA_MAX = 512;

function withCallbackData(payload, callbackData) {
  if (callbackData === undefined || callbackData === null || callbackData === '') return payload;
  const value = String(callbackData);
  if (value.length > CALLBACK_DATA_MAX) {
    console.error(`[wa] biz_opaque_callback_data over ${CALLBACK_DATA_MAX} chars — not sent`);
    return payload;
  }
  return { ...payload, biz_opaque_callback_data: value };
}

/**
 * Validate Meta webhook signature
 */
function validateSignature(rawBody, signature) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return true; // skip in dev if not set

  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── Interactive limits ──────────────────────────────────────────────────────
// Meta rejects the whole message when one limit is broken, and it counts characters,
// not UTF-16 units — «اليوم 4–6» must pass, so lengths are code points.

const codePoints = (s) => Array.from(String(s)).length;

function limitsError(message) {
  const err = new Error(`Interactive limits: ${message}`);
  err.code = 'INTERACTIVE_LIMITS';
  return err;
}

function assertBodyLimits(body, footer) {
  if (typeof body !== 'string' || codePoints(body) < 1 || codePoints(body) > 1024) {
    throw limitsError('body must be 1..1024 characters');
  }
  if (footer !== undefined && footer !== null && (typeof footer !== 'string' || codePoints(footer) > 60)) {
    throw limitsError('footer must be at most 60 characters');
  }
}

/**
 * Throws (err.code = 'INTERACTIVE_LIMITS') when a reply-button message would be rejected by Meta.
 */
function assertInteractiveLimits(buttons, { body = '', footer } = {}) {
  if (!Array.isArray(buttons) || buttons.length < 1 || buttons.length > 3) {
    throw limitsError('buttons must be an array of 1..3');
  }
  const ids = new Set();
  for (const b of buttons) {
    if (!b || typeof b.id !== 'string' || b.id.length === 0 || b.id.length > 256) {
      throw limitsError('button id must be 1..256 characters');
    }
    if (ids.has(b.id)) throw limitsError(`duplicate button id ${b.id}`);
    ids.add(b.id);
    if (typeof b.title !== 'string' || codePoints(b.title) < 1 || codePoints(b.title) > 20) {
      throw limitsError(`button title must be 1..20 characters (${b.title})`);
    }
  }
  assertBodyLimits(body, footer);
}

// ─── Legacy throwing senders (restaurant / clinic / staff routes) ────────────

// D24: a restaurant/clinic row still `processing` after 2 minutes is re-run by the sweeper. Without a
// timeout a hung Graph connection could outlive that, and the re-run would send (or order) twice while
// the original delivery is still alive. Well under 2 minutes, with room for the AI calls around it.
const LEGACY_TIMEOUT_MS = 15000;

/**
 * Send a plain text message
 */
async function sendTextMessage(phoneNumberId, accessToken, to, text, { callbackData } = {}) {
  const url = `${graphBase()}/${phoneNumberId}/messages`;
  const payload = withCallbackData({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  }, callbackData);

  const res = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    timeout: LEGACY_TIMEOUT_MS,
  });

  return res.data;
}

/**
 * Send interactive button message (up to 3 buttons)
 */
async function sendButtonMessage(phoneNumberId, accessToken, to, bodyText, buttons, { callbackData } = {}) {
  const url = `${graphBase()}/${phoneNumberId}/messages`;
  const replies = buttons.map((b, i) => ({ id: b.id || `btn_${i}`, title: b.title }));
  assertInteractiveLimits(replies, { body: bodyText });
  const payload = withCallbackData({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: replies.map((reply) => ({ type: 'reply', reply })),
      },
    },
  }, callbackData);

  const res = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  return res.data;
}

/**
 * Send interactive list message
 */
async function sendListMessage(phoneNumberId, accessToken, to, bodyText, buttonLabel, sections, { callbackData } = {}) {
  const url = `${graphBase()}/${phoneNumberId}/messages`;
  assertBodyLimits(bodyText);
  const payload = withCallbackData({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: { button: buttonLabel, sections },
    },
  }, callbackData);

  const res = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  return res.data;
}

/**
 * Send a WhatsApp template message.
 * Used for outbound messages outside the 24-hour customer service window.
 *
 * @param {string} phoneNumberId
 * @param {string} accessToken
 * @param {string} to - recipient phone number
 * @param {string} templateName - approved template name in Meta
 * @param {string} languageCode - e.g. 'ar', 'en_US'
 * @param {Array}  components - header/body/button variable components (optional)
 */
async function sendTemplateMessage(phoneNumberId, accessToken, to, templateName, languageCode = 'ar', components = [], { callbackData } = {}) {
  const url = `${graphBase()}/${phoneNumberId}/messages`;
  const payload = withCallbackData({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length > 0 && { components }),
    },
  }, callbackData);

  const res = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  return res.data;
}

/**
 * Mark message as read. With {typing:true} (and WA_TYPING_INDICATOR=1) also shows the typing
 * indicator, which Meta dismisses after ~25 s or when we reply.
 * Never throws — a failed read receipt must not block a reply.
 */
async function markAsRead(phoneNumberId, accessToken, messageId, { typing = false } = {}) {
  try {
    const payload = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    };
    if (typing === true && process.env.WA_TYPING_INDICATOR === '1') {
      payload.typing_indicator = { type: 'text' };
    }
    await axios.post(`${graphBase()}/${phoneNumberId}/messages`, payload, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: LEGACY_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false; // non-critical
  }
}

// ─── Structured senders (SHIFT) ──────────────────────────────────────────────
// These never throw: the reply batcher needs to tell "Meta refused" apart from "we don't
// know whether it went out" (ambiguous) so it never double-sends and never goes silent.
//
// D18: Graph has no idempotency key, so a resend after an unknown outcome can reach the customer
// twice. Only results that prove Graph did not accept the message are failures (and only a request
// that never left this host is retried at once); everything else is `ambiguous` and is settled by
// the echoed status webhook or, after 2 minutes, by replyBatcher.reconcileUnconfirmedIntents.

const BILLING_CODES = new Set([131042]);
const BILLING_SUBCODES = new Set([2494010]);
const RATE_LIMIT_CODES = new Set([130429, 131056, 80007]);
const INVALID_RECIPIENT_CODES = new Set([131026, 131030]);
// The request may have reached Meta before the socket died: resending could duplicate.
const AMBIGUOUS_ERRNOS = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET']);
// The request never left this host: safe to retry.
const NETWORK_ERRNOS = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN']);

/**
 * Map an axios error to {reason, code, httpStatus, retryable}.
 */
function classifySendError(err) {
  const graphError = err?.response?.data?.error || null;
  const code = graphError && graphError.code !== undefined ? graphError.code : null;
  const subcode = graphError ? graphError.error_subcode : undefined;
  const httpStatus = err?.response?.status ?? null;
  const result = (reason, retryable = false) => ({ reason, code, httpStatus, retryable });

  if (BILLING_CODES.has(code) || BILLING_SUBCODES.has(subcode)) return result('billing');
  if (code === 131047) return result('window');
  if (RATE_LIMIT_CODES.has(code)) return result('rate_limit');
  if (INVALID_RECIPIENT_CODES.has(code)) return result('invalid_recipient');
  if (code === 190 || httpStatus === 401 || httpStatus === 403) return result('auth');
  if (AMBIGUOUS_ERRNOS.has(err?.code)) return result('ambiguous');
  // Checked before the generic "request but no response" rule: axios sets err.request for
  // DNS/refused errors too, and those are known not to have been delivered.
  if (NETWORK_ERRNOS.has(err?.code)) return result('network', true);
  if (err?.request && !err?.response) return result('ambiguous');
  // GPT-6 #4: a gateway 502/503 can be returned after Graph accepted the POST. Without a documented
  // rejection code above, a 5xx proves nothing about delivery.
  if (httpStatus !== null && httpStatus >= 500) return result('ambiguous');
  return result('rejected');
}

async function postStructured(phoneNumberId, accessToken, payload, timeoutMs) {
  try {
    const res = await axios.post(`${graphBase()}/${phoneNumberId}/messages`, payload, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      timeout: timeoutMs,
    });
    const id = res?.data?.messages?.[0]?.id || null;
    return { ok: true, id, error: null, reason: null, code: null, httpStatus: res?.status ?? 200, retryable: false };
  } catch (err) {
    const { reason, code, httpStatus, retryable } = classifySendError(err);
    const error = err?.response?.data?.error?.message || err?.message || 'send failed';
    console.error(`[wa] send failed reason=${reason} code=${code} http=${httpStatus}: ${error}`);
    return { ok: false, id: null, error, reason, code, httpStatus, retryable };
  }
}

/**
 * Send a text message. Resolves to a SendResult; never throws.
 */
async function sendText(phoneNumberId, accessToken, to, text, { timeoutMs = 10000, callbackData } = {}) {
  return postStructured(phoneNumberId, accessToken, withCallbackData({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  }, callbackData), timeoutMs);
}

/**
 * Send reply buttons. A payload Meta would reject returns reason 'invalid_payload' without an
 * HTTP call. Resolves to a SendResult; never throws.
 */
async function sendInteractiveButtons(phoneNumberId, accessToken, to, body, buttons, { timeoutMs = 10000, callbackData } = {}) {
  try {
    assertInteractiveLimits(buttons, { body });
  } catch (err) {
    console.error(`[wa] invalid interactive payload: ${err.message}`);
    return { ok: false, id: null, error: err.message, reason: 'invalid_payload', code: null, httpStatus: null, retryable: false };
  }
  return postStructured(phoneNumberId, accessToken, withCallbackData({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
      },
    },
  }, callbackData), timeoutMs);
}

/**
 * Parse inbound message from webhook payload
 */
function parseInboundMessage(entry) {
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  if (!value) return null;

  const phoneNumberId = value.metadata?.phone_number_id;
  const contacts = value.contacts;
  const messages = value.messages;
  const statuses = value.statuses;

  return { phoneNumberId, contacts, messages, statuses };
}

/**
 * Normalize phone: remove +, spaces
 */
function normalizePhone(phone) {
  return phone?.replace(/\D/g, '') || phone;
}

module.exports = {
  graphVersion,
  graphBase,
  validateSignature,
  sendTextMessage,
  sendButtonMessage,
  sendListMessage,
  sendTemplateMessage,
  markAsRead,
  assertInteractiveLimits,
  sendText,
  sendInteractiveButtons,
  classifySendError,
  CALLBACK_DATA_MAX,
  parseInboundMessage,
  normalizePhone,
  // The window rule lives in one place; this re-export keeps old imports working.
  isWithinServiceWindow,
};
