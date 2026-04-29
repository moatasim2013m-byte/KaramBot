require('./setup');
const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');

describe('Webhook Security', () => {

  const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const APP_SECRET = process.env.META_APP_SECRET;

  // ─── GET verification ──────────────────────────────────────────────────────

  test('GET /api/whatsapp/webhook verifies with correct token', async () => {
    const res = await request(app)
      .get('/api/whatsapp/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': 'CHALLENGE_123',
      });
    expect(res.status).toBe(200);
    expect(res.text).toBe('CHALLENGE_123');
  });

  test('GET /api/whatsapp/webhook rejects wrong token', async () => {
    const res = await request(app)
      .get('/api/whatsapp/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'WRONG_TOKEN',
        'hub.challenge': 'CHALLENGE_123',
      });
    expect(res.status).toBe(403);
  });

  // ─── POST signature validation ─────────────────────────────────────────────

  function makeSignature(body, secret) {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  test('POST /api/whatsapp/webhook rejects missing signature', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(401);
  });

  test('POST /api/whatsapp/webhook rejects invalid signature', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'sha256=invalidsignature')
      .send(body);
    expect(res.status).toBe(401);
  });

  test('POST /api/whatsapp/webhook accepts valid signature', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const sig = makeSignature(Buffer.from(body), APP_SECRET);
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sig)
      .send(body);
    expect(res.status).toBe(200);
  });
});
