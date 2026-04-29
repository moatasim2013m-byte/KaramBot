const express = require('express');
const router = express.Router();
const { validateSignature, parseInboundMessage } = require('../services/whatsapp');
const { processInboundMessage } = require('../services/messageProcessor');

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

// POST - Inbound messages
router.post('/webhook', (req, res) => {
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

  // Respond 200 immediately (Meta requires fast response)
  res.status(200).json({ status: 'ok' });

  // Process async
  if (body.object === 'whatsapp_business_account') {
    for (const entry of body.entry || []) {
      processInboundMessage(entry).catch(console.error);
    }
  }
});

module.exports = router;
