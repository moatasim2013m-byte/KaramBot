'use strict';

/**
 * Minimal WhatsApp Cloud API connectivity test.
 *
 * Required env vars:
 *   - WHATSAPP_TOKEN
 *   - PHONE_NUMBER_ID
 *
 * Optional env var for message test recipient:
 *   - TEST_TO (your verified WhatsApp number in international format, e.g. 15551234567)
 */

const GRAPH_VERSION = 'v25.0';
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

const token = process.env.WHATSAPP_TOKEN;
const phoneNumberId = process.env.PHONE_NUMBER_ID;
const testTo = process.env.TEST_TO || 'YOUR_VERIFIED_NUMBER';

if (!token || !phoneNumberId) {
  console.error('Missing required environment variables.');
  console.error('Please set WHATSAPP_TOKEN and PHONE_NUMBER_ID.');
  process.exit(1);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  const body = safeJsonParse(text);

  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers: Object.fromEntries(res.headers.entries()),
    body,
  };
}

async function testPhoneNumberLookup() {
  const url = `${BASE_URL}/${phoneNumberId}`;

  console.log('\n=== Test 1: GET Phone Number ID ===');
  console.log('Request:', url);

  const result = await request(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  console.log('Response:', JSON.stringify(result, null, 2));
  return result;
}

async function sendTestMessage() {
  const url = `${BASE_URL}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: testTo,
    type: 'text',
    text: {
      body: 'Hello from Peekaboo test 🚀',
    },
  };

  console.log('\n=== Test 2: POST Send WhatsApp Message ===');
  console.log('Request:', url);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  if (testTo === 'YOUR_VERIFIED_NUMBER') {
    console.warn('Skipping send: set TEST_TO to your verified WhatsApp number to run POST test.');
    return { skipped: true };
  }

  const result = await request(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  console.log('Response:', JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  try {
    await testPhoneNumberLookup();
    await sendTestMessage();
  } catch (error) {
    console.error('\nUnhandled error while running WhatsApp tests:');
    console.error(error?.stack || error);
    process.exit(1);
  }
}

main();
