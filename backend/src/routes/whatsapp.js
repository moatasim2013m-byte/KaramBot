const express = require('express');
const router = express.Router();
const { validateSignature, parseInboundMessage } = require('../services/whatsapp');
const { persistInbound, processInboundMessage } = require('../services/messageProcessor');

// GET - Meta webhook verification
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    console.log('✅ WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ error: 'Verification failed' });
});

// Rejects with Error('persist timeout') after `ms`; the timer is cleared as soon as the promise settles.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('persist timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// POST - Inbound messages
router.post('/webhook', async (req, res) => {
  // Validate signature
  const signature = req.headers['x-hub-signature-256'] || '';
  const rawBody = req.body; // raw buffer (middleware set before json)

  if (!validateSignature(rawBody, signature)) {
    console.warn('⚠️ Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(rawBody.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (body.object !== 'whatsapp_business_account') return res.status(200).json({ status: 'ok' });

  // D12: a 200 tells Meta the message is ours, so it is saved first. A slow or failed save answers
  // 500 and Meta retries; the unique meta_message_id makes the retry harmless. Meta expects an
  // answer within a few seconds, hence the budget.
  const entries = body.entry || [];
  const budget = parseInt(process.env.WEBHOOK_PERSIST_BUDGET_MS, 10) || 4000;
  const persistAll = Promise.all(entries.map((e) => persistInbound(e)));
  let persisted;
  try {
    persisted = await withTimeout(persistAll, budget);
  } catch (err) {
    persistAll.catch(() => {}); // the in-flight persist keeps running; Meta will retry
    console.error('[webhook] persist failed — returning 500 so Meta retries:', err.message);
    return res.status(500).json({ error: 'persist_failed' });
  }

  res.status(200).json({ status: 'ok' });

  // AI work, statuses, forwarding and sends happen after the response.
  entries.forEach((e, i) => {
    Promise.resolve()
      .then(() => processInboundMessage(e, { persisted: persisted[i] }))
      .catch(console.error);
  });
});

module.exports = router;
