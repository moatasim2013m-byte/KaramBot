/**
 * The SHIFT Tech Provider app has its own webhook endpoint.
 *
 * The point of these tests is the boundary: each endpoint accepts only its own app's
 * verify token and only its own app's signature. Before this split, a body that
 * matched any configured secret was accepted at either URL.
 */
require('./setup');

jest.mock('../src/services/messageProcessor', () => ({
  persistInbound: jest.fn().mockResolvedValue({ business: null, items: [] }),
  processInboundMessage: jest.fn(),
  MEDIA_TYPES: [],
}));

const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');

const SHIFT_PATH = '/api/shift/whatsapp/webhook';
const LEGACY_PATH = '/api/whatsapp/webhook';

const SHIFT_SECRET = process.env.SHIFT_ES_APP_SECRET;
const LEGACY_SECRET = process.env.META_APP_SECRET;
const SHIFT_TOKEN = process.env.SHIFT_WEBHOOK_VERIFY_TOKEN;
const LEGACY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

const sign = (body, secret) =>
  'sha256=' + crypto.createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');

const BODY = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

describe('GET verification', () => {
  test('the SHIFT endpoint echoes the challenge for the SHIFT token', async () => {
    const res = await request(app).get(SHIFT_PATH).query({
      'hub.mode': 'subscribe', 'hub.verify_token': SHIFT_TOKEN, 'hub.challenge': '12345',
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe('12345');
  });

  test("the SHIFT endpoint rejects Karambot's token", async () => {
    const res = await request(app).get(SHIFT_PATH).query({
      'hub.mode': 'subscribe', 'hub.verify_token': LEGACY_TOKEN, 'hub.challenge': '12345',
    });
    expect(res.status).toBe(403);
  });

  test("the legacy endpoint rejects SHIFT's token", async () => {
    const res = await request(app).get(LEGACY_PATH).query({
      'hub.mode': 'subscribe', 'hub.verify_token': SHIFT_TOKEN, 'hub.challenge': '12345',
    });
    expect(res.status).toBe(403);
  });

  test('the challenge is never cached', async () => {
    const res = await request(app).get(SHIFT_PATH).query({
      'hub.mode': 'subscribe', 'hub.verify_token': SHIFT_TOKEN, 'hub.challenge': 'x',
    });
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });
});

describe('POST signatures do not cross between apps', () => {
  test('the SHIFT endpoint accepts a body signed with the SHIFT app secret', async () => {
    const res = await request(app).post(SHIFT_PATH)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(BODY, SHIFT_SECRET))
      .send(BODY);
    expect(res.status).toBe(200);
  });

  test("the SHIFT endpoint rejects a body signed with Karambot's secret", async () => {
    const res = await request(app).post(SHIFT_PATH)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(BODY, LEGACY_SECRET))
      .send(BODY);
    expect(res.status).toBe(401);
  });

  test("the legacy endpoint rejects a body signed with SHIFT's secret", async () => {
    const res = await request(app).post(LEGACY_PATH)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(BODY, SHIFT_SECRET))
      .send(BODY);
    expect(res.status).toBe(401);
  });

  test('the legacy endpoint still accepts its own signature', async () => {
    const res = await request(app).post(LEGACY_PATH)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(BODY, LEGACY_SECRET))
      .send(BODY);
    expect(res.status).toBe(200);
  });
});

describe('both endpoints feed the same pipeline', () => {
  const { persistInbound } = require('../src/services/messageProcessor');

  // v26.0 is what the SHIFT app is subscribed on; the payload shape the parser depends on
  // (entry[].id, changes[].value.metadata.phone_number_id) is unchanged from v25.0.
  const v26 = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '962790000000', phone_number_id: 'PHONE_1' },
          messages: [{ id: 'wamid.x', from: '962791111111', type: 'text', text: { body: 'hi' }, timestamp: '1790000000' }],
        },
      }],
    }],
  });

  test('a v26.0 message payload reaches persistInbound with its WABA id intact', async () => {
    persistInbound.mockClear();
    const res = await request(app).post(SHIFT_PATH)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(v26, SHIFT_SECRET))
      .send(v26);

    expect(res.status).toBe(200);
    expect(persistInbound).toHaveBeenCalledTimes(1);
    const entry = persistInbound.mock.calls[0][0];
    expect(entry.id).toBe('WABA_1');
    expect(entry.changes[0].value.metadata.phone_number_id).toBe('PHONE_1');
  });
});
