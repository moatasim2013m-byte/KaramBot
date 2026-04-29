const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = 'https://graph.facebook.com/v19.0';

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

/**
 * Send a plain text message
 */
async function sendTextMessage(phoneNumberId, accessToken, to, text) {
  const url = `${BASE_URL}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  };

  const res = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  return res.data;
}

/**
 * Send interactive button message (up to 3 buttons)
 */
async function sendButtonMessage(phoneNumberId, accessToken, to, bodyText, buttons) {
  const url = `${BASE_URL}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map((b, i) => ({
          type: 'reply',
          reply: { id: b.id || `btn_${i}`, title: b.title },
        })),
      },
    },
  };

  const res = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  return res.data;
}

/**
 * Send interactive list message
 */
async function sendListMessage(phoneNumberId, accessToken, to, bodyText, buttonLabel, sections) {
  const url = `${BASE_URL}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: { button: buttonLabel, sections },
    },
  };

  const res = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  return res.data;
}

/**
 * Mark message as read
 */
async function markAsRead(phoneNumberId, accessToken, messageId) {
  const url = `${BASE_URL}/${phoneNumberId}/messages`;
  await axios.post(url, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  }, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {}); // non-critical
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
  validateSignature,
  sendTextMessage,
  sendButtonMessage,
  sendListMessage,
  markAsRead,
  parseInboundMessage,
  normalizePhone,
};
