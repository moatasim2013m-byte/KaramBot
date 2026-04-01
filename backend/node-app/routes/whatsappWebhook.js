const crypto = require('crypto');
const express = require('express');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const User = require('../models/User');

const router = express.Router();

const getTrimmedEnv = (name) => String(process.env[name] || '').trim();

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

// Helper to normalize phone for user lookup
const normalizePhoneForLookup = (waId) => {
  const sanitized = String(waId || '').replace(/\D/g, '');
  
  // Try multiple formats for Jordan numbers
  const formats = [
    sanitized, // Original
    `+${sanitized}`, // With +
    sanitized.startsWith('962') ? `0${sanitized.slice(3)}` : null, // 962XXXXXXXX -> 0XXXXXXXX
    sanitized.startsWith('962') ? `+${sanitized}` : null // +962XXXXXXXX
  ].filter(Boolean);
  
  return formats;
};

// Persist inbound message to database
const persistInboundMessage = async (message, profileName) => {
  try {
    const messageId = message?.id;
    if (!messageId) {
      console.warn('WHATSAPP_MESSAGE_NO_ID', { message });
      return;
    }
    
    // Check for duplicate
    const existing = await WhatsAppMessage.findOne({ message_id: messageId });
    if (existing) {
      console.log('WHATSAPP_MESSAGE_DUPLICATE_SKIPPED', { messageId });
      return;
    }
    
    const senderWaId = message?.from;
    if (!senderWaId) {
      console.warn('WHATSAPP_MESSAGE_NO_SENDER', { messageId });
      return;
    }
    
    // Extract message content based on type
    const messageType = message?.type || 'unsupported';
    let textBody = '';
    let mediaUrl = '';
    let mediaMimeType = '';
    
    if (messageType === 'text') {
      textBody = message?.text?.body || '';
    } else if (messageType === 'image') {
      mediaUrl = message?.image?.id || '';
      mediaMimeType = message?.image?.mime_type || '';
      textBody = message?.image?.caption || '';
    } else if (messageType === 'audio') {
      mediaUrl = message?.audio?.id || '';
      mediaMimeType = message?.audio?.mime_type || '';
    } else if (messageType === 'video') {
      mediaUrl = message?.video?.id || '';
      mediaMimeType = message?.video?.mime_type || '';
      textBody = message?.video?.caption || '';
    } else if (messageType === 'document') {
      mediaUrl = message?.document?.id || '';
      mediaMimeType = message?.document?.mime_type || '';
      textBody = message?.document?.filename || '';
    } else if (messageType === 'location') {
      const loc = message?.location;
      textBody = `📍 Location: ${loc?.latitude}, ${loc?.longitude}`;
    } else if (messageType === 'contacts') {
      textBody = '👤 Contact shared';
    } else if (messageType === 'sticker') {
      mediaUrl = message?.sticker?.id || '';
      textBody = '🎭 Sticker';
    }
    
    // Try to link to existing user
    let linkedUserId = null;
    const phoneFormats = normalizePhoneForLookup(senderWaId);
    const existingUser = await User.findOne({
      phone: { $in: phoneFormats }
    });
    
    if (existingUser) {
      linkedUserId = existingUser._id;
    }
    
    // Parse timestamp
    const timestamp = message?.timestamp 
      ? new Date(parseInt(message.timestamp) * 1000)
      : new Date();
    
    // Save to database
    const newMessage = new WhatsAppMessage({
      message_id: messageId,
      sender_wa_id: senderWaId,
      profile_name: profileName || '',
      message_type: messageType,
      text_body: textBody,
      media_url: mediaUrl,
      media_mime_type: mediaMimeType,
      direction: 'inbound',
      platform: 'whatsapp',
      timestamp,
      raw_payload: message,
      linked_user_id: linkedUserId,
      is_read_by_staff: false,
      is_replied: false
    });
    
    await newMessage.save();
    console.log('WHATSAPP_MESSAGE_PERSISTED', { 
      messageId, 
      senderWaId, 
      messageType,
      linkedUser: Boolean(linkedUserId)
    });
  } catch (error) {
    console.error('WHATSAPP_MESSAGE_PERSIST_ERROR', {
      error: error.message,
      messageId: message?.id
    });
  }
};

// Update message status (for outbound messages)
const updateMessageStatus = async (statusUpdate) => {
  try {
    const messageId = statusUpdate?.id;
    const status = statusUpdate?.status; // sent, delivered, read, failed
    
    if (!messageId || !status) {
      return;
    }
    
    const validStatuses = ['sent', 'delivered', 'read', 'failed'];
    if (!validStatuses.includes(status)) {
      return;
    }
    
    await WhatsAppMessage.updateOne(
      { message_id: messageId },
      { $set: { status } }
    );
    
    console.log('WHATSAPP_MESSAGE_STATUS_UPDATED', { messageId, status });
  } catch (error) {
    console.error('WHATSAPP_MESSAGE_STATUS_UPDATE_ERROR', {
      error: error.message,
      messageId: statusUpdate?.id
    });
  }
};

router.get('/webhook', (req, res) => {
  const mode = String(req.query['hub.mode'] || '');
  const challenge = String(req.query['hub.challenge'] || '');
  const verifyToken = String(req.query['hub.verify_token'] || '');
  const expectedVerifyToken = getTrimmedEnv('VERIFY_TOKEN');
  const isTokenMatch =
    expectedVerifyToken &&
    verifyToken &&
    safeCompare(verifyToken, expectedVerifyToken);

  console.log('WHATSAPP_WEBHOOK_VERIFY_ATTEMPT', {
    mode,
    tokenMatched: Boolean(isTokenMatch),
    verifyTokenEnvExists: Boolean(expectedVerifyToken)
  });

  if (
    mode === 'subscribe' &&
    isTokenMatch
  ) {
    return res.status(200).send(challenge);
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

  setImmediate(async () => {
    console.log('WHATSAPP_WEBHOOK_RECEIVED', {
      object: payload?.object || 'unknown',
      entryCount: Array.isArray(payload?.entry) ? payload.entry.length : 0,
      changeCount: values.length
    });

    for (const value of values) {
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
      const profileName = value?.contacts?.[0]?.profile?.name || '';

      // Persist inbound messages
      if (messages.length > 0) {
        console.log('WHATSAPP_WEBHOOK_MESSAGES', {
          count: messages.length,
          from: messages.map(msg => msg?.from).filter(Boolean),
          types: messages.map(msg => msg?.type).filter(Boolean)
        });
        
        for (const message of messages) {
          await persistInboundMessage(message, profileName);
        }
      }

      // Update outbound message statuses
      if (statuses.length > 0) {
        console.log('WHATSAPP_WEBHOOK_STATUSES', {
          count: statuses.length,
          statuses: statuses.map(item => item?.status).filter(Boolean),
          messageIds: statuses.map(item => item?.id).filter(Boolean)
        });
        
        for (const status of statuses) {
          await updateMessageStatus(status);
        }
      }
    }
  });
});

module.exports = router;
