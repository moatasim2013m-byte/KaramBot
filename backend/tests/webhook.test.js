require('./setup');

// The route is under test here, not the processor: persist and post-response work are stubs.
jest.mock('../src/services/messageProcessor', () => ({
  persistInbound: jest.fn(),
  processInboundMessage: jest.fn(),
  MEDIA_TYPES: [],
}));

const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const messageProcessor = require('../src/services/messageProcessor');

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

  // ─── D12: persist before 200 ───────────────────────────────────────────────

  describe('persist before 200', () => {
    const entry = {
      id: 'waba_1',
      changes: [{
        value: {
          metadata: { phone_number_id: '111' },
          contacts: [{ wa_id: '962790000001', profile: { name: 'Test' } }],
          messages: [{ id: 'wamid.in1', from: '962790000001', type: 'text', text: { body: 'مرحبا' } }],
        },
      }],
    };

    function post(payload) {
      const raw = JSON.stringify(payload);
      return request(app)
        .post('/api/whatsapp/webhook')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', makeSignature(Buffer.from(raw), APP_SECRET))
        .send(raw);
    }

    const flush = () => new Promise((resolve) => setImmediate(resolve));

    beforeEach(() => {
      messageProcessor.persistInbound.mockReset();
      messageProcessor.processInboundMessage.mockReset();
      messageProcessor.processInboundMessage.mockResolvedValue(undefined);
      jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      delete process.env.WEBHOOK_PERSIST_BUDGET_MS;
      console.error.mockRestore();
    });

    test('persist rejects (P1001) → 500 and nothing is processed', async () => {
      messageProcessor.persistInbound.mockRejectedValue(Object.assign(new Error('db down'), { code: 'P1001' }));
      const res = await post({ object: 'whatsapp_business_account', entry: [entry] });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'persist_failed' });
      await flush();
      expect(messageProcessor.processInboundMessage).not.toHaveBeenCalled();
    });

    test('persist slower than WEBHOOK_PERSIST_BUDGET_MS → 500, processInboundMessage not called', async () => {
      process.env.WEBHOOK_PERSIST_BUDGET_MS = '50';
      messageProcessor.persistInbound.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ business: null, items: [] }), 300)),
      );
      const res = await post({ object: 'whatsapp_business_account', entry: [entry] });
      expect(res.status).toBe(500);
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(messageProcessor.processInboundMessage).not.toHaveBeenCalled();
    });

    test('persist ok → 200, then processInboundMessage(entry, {persisted}) after the response', async () => {
      const persisted = { business: { id: 'biz' }, items: [{ created: true }] };
      const order = [];
      messageProcessor.persistInbound.mockImplementation(async () => {
        order.push('persist');
        return persisted;
      });
      messageProcessor.processInboundMessage.mockImplementation(async () => {
        order.push('process');
      });

      const res = await post({ object: 'whatsapp_business_account', entry: [entry] });
      expect(res.status).toBe(200);
      await flush();
      expect(messageProcessor.persistInbound).toHaveBeenCalledWith(entry);
      expect(messageProcessor.processInboundMessage).toHaveBeenCalledTimes(1);
      expect(messageProcessor.processInboundMessage).toHaveBeenCalledWith(entry, { persisted });
      expect(order).toEqual(['persist', 'process']);
    });

    test('status-only payload → 200 and statuses are still handled after the response', async () => {
      const statusEntry = {
        id: 'waba_1',
        changes: [{ value: { metadata: { phone_number_id: '111' }, statuses: [{ id: 'wamid.out1', status: 'delivered' }] } }],
      };
      messageProcessor.persistInbound.mockResolvedValue({ business: null, items: [] });
      const res = await post({ object: 'whatsapp_business_account', entry: [statusEntry] });
      expect(res.status).toBe(200);
      await flush();
      expect(messageProcessor.processInboundMessage).toHaveBeenCalledWith(statusEntry, { persisted: { business: null, items: [] } });
    });

    test('a non-WhatsApp object → 200 without persisting', async () => {
      const res = await post({ object: 'page', entry: [entry] });
      expect(res.status).toBe(200);
      expect(messageProcessor.persistInbound).not.toHaveBeenCalled();
    });
  });
});
