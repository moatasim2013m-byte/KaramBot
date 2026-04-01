const crypto = require('crypto');
const express = require('express');

const router = express.Router();

const getTrimmedEnv = (name) => String(process.env[name] || '').trim();

const safeCompare = (a, b) => {
  const aBuffer = Buffer.from(String(a || ''), 'utf8');
  const bBuffer = Buffer.from(String(b || ''), 'utf8');

  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
};

const isValidWhatsAppSignature = (rawBodyBuffer, signatureHeader) => {
  const appSecret = getTrimmedEnv('WHATSAPP_APP_SECRET');
  if (!appSecret) return true;

  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const receivedSignature = signatureHeader.slice('sha256='.length);
  const expectedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(rawBodyBuffer || Buffer.alloc(0))
    .digest('hex');

  return safeCompare(receivedSignature, expectedSignature);
};

const countWebhookChanges = (payload) => {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  return entries.reduce((total, entry) => {
    const changes = Array.isArray(entry?.changes) ? entry.changes.length : 0;
    return total + changes;
  }, 0);
};

router.get('/', (req, res) => {
  const mode = String(req.query['hub.mode'] || '');
  const challenge = String(req.query['hub.challenge'] || '');
  const verifyToken = String(req.query['hub.verify_token'] || '');
  const expectedVerifyToken = getTrimmedEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN');

  if (!expectedVerifyToken) {
    console.error('WHATSAPP_WEBHOOK_VERIFY_TOKEN_MISSING');
    return res.status(500).send('Webhook verify token is not configured');
  }

  if (mode === 'subscribe' && verifyToken === expectedVerifyToken) {
    return res.status(200).send(challenge);
  }

  return res.status(403).json({ error: 'Webhook verification failed' });
});

router.post('/', (req, res) => {
  const signature = String(req.get('x-hub-signature-256') || '');
  const rawBody = req.rawBody;

  if (!isValidWhatsAppSignature(rawBody, signature)) {
    console.error('WHATSAPP_WEBHOOK_INVALID_SIGNATURE');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = req.body || {};
  if (payload.object !== 'whatsapp_business_account') {
    return res.status(200).json({ received: true, ignored: true });
  }

  const changeCount = countWebhookChanges(payload);
  console.log('WHATSAPP_WEBHOOK_RECEIVED', {
    object: payload.object,
    changes: changeCount
  });

  return res.status(200).json({ received: true });
});

module.exports = router;
