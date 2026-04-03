const assert = require('assert');
const crypto = require('crypto');
const express = require('express');

const whatsappWebhookRoutes = require('../routes/whatsappWebhook');

const buildApp = () => {
  const app = express();

  app.use('/api/whatsapp', express.json({
    verify: (req, res, buffer) => {
      req.rawBody = buffer;
    }
  }), whatsappWebhookRoutes);

  return app;
};

const request = async (server, { method = 'GET', path, body, headers = {} }) => {
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body
  });

  return {
    status: response.status,
    text: await response.text()
  };
};

(async () => {
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'verify-token-123';
  delete process.env.VERIFY_TOKEN;
  process.env.META_APP_SECRET = 'meta-secret-abc';
  process.env.WHATSAPP_WEBHOOK_VALIDATE_SIGNATURE = 'true';

  const app = buildApp();
  const server = app.listen(0);

  try {
    const verifySuccess = await request(server, {
      path: '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-token-123&hub.challenge=98765'
    });
    assert.strictEqual(verifySuccess.status, 200);
    assert.strictEqual(verifySuccess.text, '98765');

    const verifyFailure = await request(server, {
      path: '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=bad-token&hub.challenge=98765'
    });
    assert.strictEqual(verifyFailure.status, 403);

    process.env.VERIFY_TOKEN = 'legacy-token';
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    const verifyLegacySuccess = await request(server, {
      path: '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=legacy-token&hub.challenge=777'
    });
    assert.strictEqual(verifyLegacySuccess.status, 200);
    assert.strictEqual(verifyLegacySuccess.text, '777');
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'verify-token-123';

    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: '15551234567', type: 'text' }],
                statuses: [{ id: 'wamid-1', status: 'delivered' }]
              }
            }
          ]
        }
      ]
    });

    const invalidSig = await request(server, {
      method: 'POST',
      path: '/api/whatsapp/webhook',
      body: payload,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=invalid'
      }
    });
    assert.strictEqual(invalidSig.status, 401);

    const validSignature = crypto
      .createHmac('sha256', process.env.META_APP_SECRET)
      .update(payload)
      .digest('hex');

    const validSig = await request(server, {
      method: 'POST',
      path: '/api/whatsapp/webhook',
      body: payload,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${validSignature}`
      }
    });
    assert.strictEqual(validSig.status, 200);

    console.log('All WhatsApp webhook checks passed.');
  } finally {
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
