const crypto = require('crypto');
const express = require('express');

const router = express.Router();

const getTrimmedEnv = (name) => String(process.env[name] || '').trim();
const getVerifyToken = () => {
  // Prefer the new env name while keeping backward compatibility.
  return getTrimmedEnv('WHATSAPP_VERIFY_TOKEN') || getTrimmedEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
};

const isSignatureValidationEnabled = () => {
  const value = String(
    process.env.WHATSAPP_WEBHOOK_VALIDATE_SIGNATURE || 'true'
  ).trim().toLowerCase();

  return value !== 'false';
};

const safeCompare = (a, b) => {
  const aBuffer = Buffer.from(String(a || ''), 'utf8');
  const bBuffer = Buffer.from(String(b || ''), 'utf8');

  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
};

const isValidWhatsAppSignature = (rawBodyBuffer, signatureHeader) => {
  if (!isSignatureValidationEnabled()) return true;

  const appSecret = getTrimmedEnv('META_APP_SECRET');
  if (!appSecret) {
    console.error('WHATSAPP_WEBHOOK_META_APP_SECRET_MISSING');
    return false;
  }

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

const parseChanges = (payload) => {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  const allChanges = [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      allChanges.push(change?.value || {});
    }
  }

  return allChanges;
};

router.get('/webhook', (req, res) => {
  const mode = String(req.query['hub.mode'] || '');
  const challenge = String(req.query['hub.challenge'] || '');
  const verifyToken = String(req.query['hub.verify_token'] || '');
  const expectedVerifyToken = getVerifyToken();

  if (
    mode === 'subscribe' &&
    expectedVerifyToken &&
    verifyToken &&
    safeCompare(verifyToken, expectedVerifyToken)
  ) {
    return res.status(200).type('text/plain').send(challenge);
  }

  return res.sendStatus(403);
});

router.post('/webhook', (req, res) => {
  const signature = String(req.get('x-hub-signature-256') || '');

  if (!isValidWhatsAppSignature(req.rawBody, signature)) {
    console.error('WHATSAPP_WEBHOOK_INVALID_SIGNATURE');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = req.body || {};
  const values = parseChanges(payload);
  res.sendStatus(200);

  setImmediate(() => {
    console.log('WHATSAPP_WEBHOOK_RECEIVED', {
      object: payload?.object || 'unknown',
      entryCount: Array.isArray(payload?.entry) ? payload.entry.length : 0,
      changeCount: values.length
    });

    values.forEach((value, index) => {
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      const statuses = Array.isArray(value?.statuses) ? value.statuses : [];

      if (messages.length > 0) {
        console.log('WHATSAPP_WEBHOOK_MESSAGES', {
          index,
          count: messages.length,
          from: messages.map(msg => msg?.from).filter(Boolean),
          types: messages.map(msg => msg?.type).filter(Boolean)
        });
      }

      if (statuses.length > 0) {
        console.log('WHATSAPP_WEBHOOK_STATUSES', {
          index,
          count: statuses.length,
          statuses: statuses.map(item => item?.status).filter(Boolean),
          messageIds: statuses.map(item => item?.id).filter(Boolean)
        });
      }
    });
  });
});

module.exports = router;
