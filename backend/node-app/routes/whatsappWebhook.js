const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const User = require('../models/User');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { emitInboxUpdate } = require('../utils/inboxEvents');
const { maybeAutoReply } = require('../utils/autoReplyBot');
const { normalizePhoneForWhatsApp } = require('../utils/whatsappBookingConfirmation');
const TemplateDefinition = require('../models/TemplateDefinition');

const router = express.Router();
const META_GRAPH_API_VERSION = 'v22.0';

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
      allChanges.push({
        field: change?.field || '',
        value: change?.value || {}
      });
    }
  }
  return allChanges;
};

const parseGraphError = async (response) => {
  const responseText = await response.text();
  try {
    const payload = JSON.parse(responseText);
    return payload?.error?.message || responseText || 'Unknown Meta API error';
  } catch (_) {
    return responseText || 'Unknown Meta API error';
  }
};

const buildMetaHeaders = () => ({
  Authorization: `Bearer ${getTrimmedEnv('WHATSAPP_ACCESS_TOKEN')}`,
  'Content-Type': 'application/json'
});

const resolvePhoneNumberId = (input) => {
  const reqValue = String(input || '').trim();
  if (reqValue) return reqValue;
  return getTrimmedEnv('WHATSAPP_PHONE_NUMBER_ID');
};

const containsEmoji = (text) => {
  return /[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u.test(String(text || ''));
};

const resolveVerifyToken = () => {
  const legacyToken = getTrimmedEnv('VERIFY_TOKEN');
  if (legacyToken) return legacyToken;
  return getTrimmedEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
};

const validatePrompts = (prompts) => {
  if (!Array.isArray(prompts)) return 'prompts must be an array of strings';
  if (prompts.length > 4) return 'prompts supports up to 4 ice breakers';
  for (const item of prompts) {
    if (typeof item !== 'string' || !item.trim()) {
      return 'each prompt must be a non-empty string';
    }
    if (item.trim().length > 80) {
      return 'each prompt must be at most 80 characters';
    }
    if (containsEmoji(item)) {
      return 'prompts cannot include emojis';
    }
  }
  return null;
};

const validateCommands = (commands) => {
  if (!Array.isArray(commands)) return 'commands must be an array';
  if (commands.length > 30) return 'commands supports up to 30 commands';
  for (const item of commands) {
    const name = String(item?.command_name || '').trim();
    const description = String(item?.command_description || '').trim();
    if (!name || !description) return 'each command must include command_name and command_description';
    if (name.length > 32) return 'command_name must be at most 32 characters';
    if (description.length > 256) return 'command_description must be at most 256 characters';
    if (containsEmoji(name) || containsEmoji(description)) {
      return 'commands cannot include emojis in command_name or command_description';
    }
  }
  return null;
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
const persistInboundMessage = async (message, profileName, changeValue = {}, webhookObject = '') => {
  try {
    const messageId = message?.id;
    if (!messageId) {
      console.warn('WHATSAPP_MESSAGE_NO_ID', { message });
      return;
    }
    
    const rawSenderWaId = message?.from;
    if (!rawSenderWaId) {
      console.warn('WHATSAPP_MESSAGE_NO_SENDER', { messageId });
      return;
    }
    const senderWaId = normalizePhoneForWhatsApp(rawSenderWaId) || rawSenderWaId;
    if (senderWaId !== rawSenderWaId) {
      console.log('WHATSAPP_SENDER_NORMALIZED', { messageId, raw: rawSenderWaId, normalized: senderWaId });
    }
    if (!normalizePhoneForWhatsApp(rawSenderWaId)) {
      console.warn('WHATSAPP_MESSAGE_INVALID_SENDER', { messageId, rawSenderWaId });
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
    
    // Try to link to existing user (non-blocking: do not fail inbound flow if lookup is unavailable)
    let linkedUserId = null;
    const isDbReadyForLookup = mongoose?.connection?.readyState === 1;
    if (isDbReadyForLookup) {
      try {
        const phoneFormats = normalizePhoneForLookup(senderWaId);
        const existingUser = await User.findOne({
          phone: { $in: phoneFormats }
        }).lean();

        if (existingUser?._id) {
          linkedUserId = existingUser._id;
        }
      } catch (lookupError) {
        console.warn('WHATSAPP_USER_LOOKUP_SKIPPED', {
          error: lookupError?.message || String(lookupError),
          senderWaId,
          messageId
        });
      }
    } else {
      console.warn('WHATSAPP_USER_LOOKUP_DB_NOT_READY', {
        dbReadyState: mongoose?.connection?.readyState,
        senderWaId,
        messageId
      });
    }
    
    // Parse timestamp
    const timestamp = message?.timestamp 
      ? new Date(parseInt(message.timestamp) * 1000)
      : new Date();
    
    const compactPayload = {
      object: webhookObject || '',
      metadata: {
        messaging_product: changeValue?.messaging_product || '',
        phone_number_id: changeValue?.metadata?.phone_number_id || ''
      },
      contacts: Array.isArray(changeValue?.contacts) ? changeValue.contacts : [],
      message
    };

    const messageDoc = {
      message_id: messageId,
      sender_wa_id: senderWaId,
      profile_name: profileName || '',
      message_type: messageType,
      text_body: textBody,
      media_url: mediaUrl,
      media_mime_type: mediaMimeType,
      direction: 'inbound',
      platform: 'whatsapp',
      messaging_product: changeValue?.messaging_product || 'whatsapp',
      business_phone_number_id: changeValue?.metadata?.phone_number_id || '',
      timestamp,
      raw_payload: compactPayload,
      linked_user_id: linkedUserId,
      is_read_by_staff: false,
      is_replied: false
    };

    // Atomic duplicate protection by message_id
    const result = await WhatsAppMessage.updateOne(
      { message_id: messageId },
      { $setOnInsert: messageDoc },
      { upsert: true }
    );

    if (result.upsertedCount === 0) {
      console.log('WHATSAPP_MESSAGE_DUPLICATE_SKIPPED', { messageId });
      return;
    }

    console.log('WHATSAPP_MESSAGE_PERSISTED', {
      messageId,
      senderWaId,
      messageType,
      linkedUser: Boolean(linkedUserId)
    });
    emitInboxUpdate(senderWaId, 'inbound_message');
    maybeAutoReply({
      messageId,
      senderWaId,
      messageType,
      textBody,
      mediaId: (messageType === 'audio') ? (message?.audio?.id || null)
            : (messageType === 'image') ? (message?.image?.id || null)
            : null
    }).catch(err => console.error('AUTO_REPLY_TRIGGER_ERROR', err.message));
  } catch (error) {
    if (error?.code === 11000) {
      console.log('WHATSAPP_MESSAGE_DUPLICATE_SKIPPED', { messageId: message?.id });
      return;
    }
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
    emitInboxUpdate(null, 'status_update');
  } catch (error) {
    console.error('WHATSAPP_MESSAGE_STATUS_UPDATE_ERROR', {
      error: error.message,
      messageId: statusUpdate?.id
    });
  }
};

const handleTemplateStatusUpdate = async (value) => {
  try {
    const event = value?.event;
    const templateName = value?.message_template_name;
    const templateId = String(value?.message_template_id || '');
    if (!event || (!templateName && !templateId)) return;

    const statusMap = {
      APPROVED: 'approved',
      REJECTED: 'rejected',
      DISABLED: 'disabled',
      PAUSED: 'paused',
      FLAGGED: 'paused',
      PENDING_REVIEW: 'pending_review',
      PENDING: 'pending_review'
    };

    const newStatus = statusMap[event];
    if (!newStatus) return;

    const query = templateId ? { meta_template_id: templateId } : { name: templateName };
    const updated = await TemplateDefinition.findOneAndUpdate(
      query,
      {
        $set: {
          status: newStatus,
          rejected_reason: event === 'REJECTED' ? (value?.reason || null) : null,
          synced_from_meta_at: new Date()
        }
      },
      { new: true }
    );

    if (updated) {
      console.log('TEMPLATE_STATUS_UPDATED', { name: updated.name, event, newStatus });
    } else {
      console.warn('TEMPLATE_STATUS_NOT_FOUND', { templateName, templateId, event });
    }
  } catch (err) {
    console.error('TEMPLATE_STATUS_UPDATE_ERROR', err.message);
  }
};

const handleTemplateCategoryUpdate = async (value) => {
  try {
    const templateId = String(value?.message_template_id || '');
    const newCategory = (value?.new_category || '').toLowerCase();
    if (!templateId || !newCategory) return;

    const validCategories = ['marketing', 'utility', 'authentication'];
    if (!validCategories.includes(newCategory)) return;

    const updated = await TemplateDefinition.findOneAndUpdate(
      { meta_template_id: templateId },
      { $set: { category: newCategory, synced_from_meta_at: new Date() } },
      { new: true }
    );

    if (updated) {
      console.log('TEMPLATE_CATEGORY_UPDATED', {
        name: updated.name,
        templateId,
        newCategory,
        previous: value?.previous_category
      });
    }
  } catch (err) {
    console.error('TEMPLATE_CATEGORY_UPDATE_ERROR', err.message);
  }
};

router.get('/webhook', (req, res) => {
  const mode = String(req.query['hub.mode'] || '');
  const challenge = String(req.query['hub.challenge'] || '');
  const verifyToken = String(req.query['hub.verify_token'] || '');
  const expectedVerifyToken = resolveVerifyToken();
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

    for (const change of values) {
      const field = change.field;
      const value = change.value;

      if (field === 'message_template_status_update') {
        await handleTemplateStatusUpdate(value);
        continue;
      }

      if (field === 'template_category_update') {
        await handleTemplateCategoryUpdate(value);
        continue;
      }

      if (field === 'account_update') {
        // Policy enforcement: account warned, restricted, or disabled
        const event = value?.event || 'unknown';
        const restrictionType = value?.restriction_info?.restriction_type || null;
        const restrictionDuration = value?.restriction_info?.restriction_duration || null;
        const banState = value?.ban_info?.waba_ban_state || null;
        const banDate = value?.ban_info?.waba_ban_date || null;
        if (banState === 'DISABLE' || banState === 'SCHEDULE_FOR_DISABLE') {
          console.error('WHATSAPP_ACCOUNT_DISABLED', {
            event,
            banState,
            banDate,
            restrictionType,
            restrictionDuration,
            value
          });
        } else if (restrictionType) {
          console.error('WHATSAPP_ACCOUNT_RESTRICTED', {
            event,
            restrictionType,
            restrictionDuration,
            value
          });
        } else {
          console.warn('WHATSAPP_ACCOUNT_UPDATE', { event, value });
        }
        continue;
      }

      if (field === 'account_alerts') {
        // Capability or messaging limit alerts
        const alertType = value?.alert_type || 'unknown';
        const alertDesc = value?.alert_description || '';
        console.warn('WHATSAPP_ACCOUNT_ALERT', { alertType, alertDesc, value });
        continue;
      }

      if (field === 'account_review_update') {
        // Appeal decision result
        const decision = value?.decision || 'unknown';
        const reviewStatus = value?.review_status || 'unknown';
        console.warn('WHATSAPP_ACCOUNT_REVIEW_UPDATE', { decision, reviewStatus, value });
        continue;
      }

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
          await persistInboundMessage(message, profileName, value, payload?.object);
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

router.get('/conversational-automation', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const accessToken = getTrimmedEnv('WHATSAPP_ACCESS_TOKEN');
    const phoneNumberId = resolvePhoneNumberId(req.query.phone_number_id);

    if (!accessToken) {
      return res.status(500).json({ error: 'WHATSAPP_ACCESS_TOKEN must be configured' });
    }
    if (!phoneNumberId) {
      return res.status(400).json({ error: 'phone_number_id is required (or set WHATSAPP_PHONE_NUMBER_ID)' });
    }

    const endpoint = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}?fields=conversational_automation`;
    const response = await fetch(endpoint, { method: 'GET', headers: buildMetaHeaders() });
    if (!response.ok) {
      const details = await parseGraphError(response);
      return res.status(502).json({ error: 'Failed to fetch conversational automation from Meta', details });
    }

    const payload = await response.json();
    return res.json({
      success: true,
      phone_number_id: phoneNumberId,
      conversational_automation: payload?.conversational_automation || { prompts: [], commands: [] }
    });
  } catch (error) {
    console.error('WHATSAPP_CONVERSATIONAL_AUTOMATION_GET_FAILED', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch conversational automation' });
  }
});

router.post('/conversational-automation', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const accessToken = getTrimmedEnv('WHATSAPP_ACCESS_TOKEN');
    const phoneNumberId = resolvePhoneNumberId(req.body?.phone_number_id || req.query.phone_number_id);
    const hasPrompts = Object.prototype.hasOwnProperty.call(req.body || {}, 'prompts');
    const hasCommands = Object.prototype.hasOwnProperty.call(req.body || {}, 'commands');

    if (!accessToken) {
      return res.status(500).json({ error: 'WHATSAPP_ACCESS_TOKEN must be configured' });
    }
    if (!phoneNumberId) {
      return res.status(400).json({ error: 'phone_number_id is required (or set WHATSAPP_PHONE_NUMBER_ID)' });
    }
    if (!hasPrompts && !hasCommands) {
      return res.status(400).json({ error: 'At least one of prompts or commands must be provided' });
    }

    if (hasPrompts) {
      const promptError = validatePrompts(req.body.prompts);
      if (promptError) return res.status(400).json({ error: promptError });
    }
    if (hasCommands) {
      const commandError = validateCommands(req.body.commands);
      if (commandError) return res.status(400).json({ error: commandError });
    }

    const requestBody = {};
    if (hasPrompts) {
      requestBody.prompts = req.body.prompts.map(item => item.trim());
    }
    if (hasCommands) {
      requestBody.commands = req.body.commands.map(item => ({
        command_name: String(item.command_name).trim(),
        command_description: String(item.command_description).trim()
      }));
    }

    const endpoint = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/conversational_automation`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: buildMetaHeaders(),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const details = await parseGraphError(response);
      return res.status(502).json({ error: 'Meta rejected conversational automation update', details });
    }

    const payload = await response.json();
    return res.json({ success: Boolean(payload?.success), phone_number_id: phoneNumberId, meta: payload });
  } catch (error) {
    console.error('WHATSAPP_CONVERSATIONAL_AUTOMATION_POST_FAILED', { error: error.message });
    return res.status(500).json({ error: 'Failed to update conversational automation' });
  }
});

module.exports = router;
