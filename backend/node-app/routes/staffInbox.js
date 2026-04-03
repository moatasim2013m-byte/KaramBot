const express = require('express');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const QuickReply = require('../models/QuickReply');
const User = require('../models/User');
const Child = require('../models/Child');
const HourlyBooking = require('../models/HourlyBooking');
const BirthdayBooking = require('../models/BirthdayBooking');
const UserSubscription = require('../models/UserSubscription');
const { authMiddleware, staffMiddleware } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const {
  postWhatsAppText,
  normalizePhoneForWhatsApp,
  markWhatsAppMessageRead
} = require('../utils/whatsappBookingConfirmation');
const { getMetaMediaUrl, downloadMetaMedia, uploadMediaToMeta, sendMetaImageMessage } = require('../utils/whatsappMedia');
const TemplateDefinition = require('../models/TemplateDefinition');
const { postWhatsAppTemplate } = require('../utils/whatsappMarketing');
const multer = require('multer');
const { logWhatsAppSendFailure, logger } = require('../utils/logger');

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG and WebP images are allowed'));
  }
});

const router = express.Router();
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'تم تجاوز الحد المسموح للإرسال. حاول بعد دقيقة.' }
});

// Apply staff middleware to all routes
router.use(authMiddleware, staffMiddleware);

// ==================== CONVERSATIONS ====================

const getConversationsPayload = async (query) => {
  const { search, unread_only, date_from, date_to } = query;
  const matchStage = { platform: 'whatsapp' };

  if (date_from || date_to) {
    matchStage.timestamp = {};
    if (date_from) matchStage.timestamp.$gte = new Date(date_from);
    if (date_to) matchStage.timestamp.$lte = new Date(date_to);
  }

  const conversations = await WhatsAppMessage.aggregate([
    { $match: matchStage },
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: '$sender_wa_id',
        last_message: { $first: '$$ROOT' },
        unread_count: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ['$direction', 'inbound'] }, { $eq: ['$is_read_by_staff', false] }] },
              1,
              0
            ]
          }
        },
        message_count: { $sum: 1 }
      }
    },
    { $sort: { 'last_message.timestamp': -1 } },
    { $limit: 100 }
  ]);

  let filteredConversations = conversations;
  if (search) {
    const searchLower = search.toLowerCase();
    filteredConversations = conversations.filter((conv) => {
      const profileName = conv.last_message?.profile_name?.toLowerCase() || '';
      const waId = conv.last_message?.sender_wa_id || '';
      return profileName.includes(searchLower) || waId.includes(search);
    });
  }
  if (unread_only === 'true') filteredConversations = filteredConversations.filter((conv) => conv.unread_count > 0);

  return {
    conversations: filteredConversations.map((conv) => ({
      wa_id: conv._id,
      profile_name: conv.last_message?.profile_name || conv._id,
      last_message: {
        text: conv.last_message?.text_body || '[Media]',
        timestamp: conv.last_message?.timestamp,
        direction: conv.last_message?.direction,
        type: conv.last_message?.message_type
      },
      unread_count: conv.unread_count,
      message_count: conv.message_count,
      linked_user_id: conv.last_message?.linked_user_id
    }))
  };
};

const getStatsPayload = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [totalConversations, unreadCount, todayMessages] = await Promise.all([
    WhatsAppMessage.distinct('sender_wa_id', { platform: 'whatsapp' }),
    WhatsAppMessage.countDocuments({
      platform: 'whatsapp',
      direction: 'inbound',
      is_read_by_staff: false
    }),
    WhatsAppMessage.countDocuments({
      platform: 'whatsapp',
      direction: 'inbound',
      timestamp: { $gte: today }
    })
  ]);

  return {
    total_conversations: totalConversations.length,
    unread_messages: unreadCount,
    today_messages: todayMessages
  };
};

const initSse = (res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
};

router.get('/conversations', async (req, res) => {
  try {
    res.json(await getConversationsPayload(req.query));
  } catch (error) {
    logger.error({ event: 'inbox_conversations_fetch_failed', error: error.message, stack: error.stack }, 'Get conversations error');
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    res.json(await getStatsPayload());
  } catch (error) {
    logger.error({ event: 'inbox_stats_fetch_failed', error: error.message, stack: error.stack }, 'Get stats error');
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

router.get('/stream/conversations', async (req, res) => {
  initSse(res);
  const push = async () => {
    const payload = await getConversationsPayload(req.query);
    res.write(`event: conversations\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  try { await push(); } catch (error) { logger.error({ event: 'inbox_stream_conversations_init_failed', error: error.message }); }
  const interval = setInterval(() => { push().catch((error) => logger.error({ event: 'inbox_stream_conversations_tick_failed', error: error.message })); }, 10000);
  req.on('close', () => clearInterval(interval));
});

router.get('/stream/stats', async (req, res) => {
  initSse(res);
  const push = async () => {
    const payload = await getStatsPayload();
    res.write(`event: stats\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  try { await push(); } catch (error) { logger.error({ event: 'inbox_stream_stats_init_failed', error: error.message }); }
  const interval = setInterval(() => { push().catch((error) => logger.error({ event: 'inbox_stream_stats_tick_failed', error: error.message })); }, 10000);
  req.on('close', () => clearInterval(interval));
});

// ==================== MESSAGES ====================

const getMessagesPayload = async (wa_id, { limit = 100, before } = {}) => {
  const query = { sender_wa_id: wa_id, platform: 'whatsapp' };
  if (before) query.timestamp = { $lt: new Date(before) };

  const messages = await WhatsAppMessage.find(query)
    .sort({ timestamp: -1 })
    .limit(parseInt(limit, 10))
    .populate('sent_by_staff_id', 'name email')
    .populate('linked_user_id', 'name email phone');

  await WhatsAppMessage.updateMany(
    { sender_wa_id: wa_id, direction: 'inbound', is_read_by_staff: false },
    { $set: { is_read_by_staff: true } }
  );

  return {
    messages: messages.reverse().map((msg) => ({
      id: msg._id,
      message_id: msg.message_id,
      direction: msg.direction,
      message_type: msg.message_type,
      text_body: msg.text_body,
      media_url: msg.media_url,
      media_proxy_url: msg.media_url ? `/api/staff/inbox/media/${msg.media_url}` : null,
      timestamp: msg.timestamp,
      status: msg.status,
      sent_by_staff: msg.sent_by_staff_id
        ? { name: msg.sent_by_staff_id.name, email: msg.sent_by_staff_id.email }
        : null
    }))
  };
};

router.get('/messages/:wa_id', async (req, res) => {
  try {
    res.json(await getMessagesPayload(req.params.wa_id, req.query));
  } catch (error) {
    logger.error({ event: 'inbox_messages_fetch_failed', wa_id: req.params.wa_id, error: error.message, stack: error.stack }, 'Get messages error');
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

router.get('/stream/messages/:wa_id', async (req, res) => {
  initSse(res);
  const push = async () => {
    const payload = await getMessagesPayload(req.params.wa_id, req.query);
    res.write(`event: messages\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  try { await push(); } catch (error) { logger.error({ event: 'inbox_stream_messages_init_failed', wa_id: req.params.wa_id, error: error.message }); }
  const interval = setInterval(() => {
    push().catch((error) => logger.error({ event: 'inbox_stream_messages_tick_failed', wa_id: req.params.wa_id, error: error.message }));
  }, 6000);
  req.on('close', () => clearInterval(interval));
});

// Get customer profile for a WhatsApp contact
router.get('/customer-profile/:wa_id', async (req, res) => {
  try {
    const { wa_id } = req.params;
    
    // Find message to check linked user
    const message = await WhatsAppMessage.findOne({ sender_wa_id: wa_id })
      .populate('linked_user_id');
    
    if (!message || !message.linked_user_id) {
      return res.json({
        found: false,
        wa_id,
        profile_name: message?.profile_name || 'Unknown'
      });
    }
    
    const user = message.linked_user_id;
    
    // Get children
    const children = await Child.find({ parent_id: user._id });
    
    // Get recent bookings
    const recentHourlyBookings = await HourlyBooking.find({ user_id: user._id })
      .sort({ created_at: -1 })
      .limit(5)
      .populate('slot_id')
      .populate('child_id');
    
    const recentBirthdayBookings = await BirthdayBooking.find({ user_id: user._id })
      .sort({ created_at: -1 })
      .limit(3)
      .populate('slot_id')
      .populate('child_id');
    
    // Get active subscriptions
    const activeSubscriptions = await UserSubscription.find({
      user_id: user._id,
      status: { $in: ['active', 'pending'] },
      remaining_visits: { $gt: 0 }
    }).populate('plan_id');
    
    res.json({
      found: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        created_at: user.createdAt
      },
      children: children.map(c => ({
        id: c._id,
        name: c.name,
        birthday: c.birthday
      })),
      recent_bookings: {
        hourly: recentHourlyBookings.map(b => ({
          id: b._id,
          booking_code: b.booking_code,
          status: b.status,
          slot_date: b.slot_id?.date,
          slot_time: b.slot_id?.start_time,
          child_name: b.child_id?.name
        })),
        birthday: recentBirthdayBookings.map(b => ({
          id: b._id,
          booking_code: b.booking_code,
          status: b.status,
          slot_date: b.slot_id?.date,
          slot_time: b.slot_id?.start_time,
          child_name: b.child_id?.name
        }))
      },
      subscriptions: activeSubscriptions.map(s => ({
        id: s._id,
        plan_name: s.plan_id?.name,
        remaining_visits: s.remaining_visits,
        status: s.status,
        expires_at: s.expires_at
      }))
    });
  } catch (error) {
    console.error('Get customer profile error:', error);
    res.status(500).json({ error: 'Failed to get customer profile' });
  }
});

// ==================== SEND MESSAGE ====================

// Send message to contact
router.post('/send', sendLimiter, async (req, res) => {
  try {
    const { wa_id, message } = req.body;
    
    if (!wa_id || !message) {
      return res.status(400).json({ error: 'wa_id and message are required' });
    }
    
    if (message.trim().length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    // Normalize phone number to E.164 digits (no +) for Meta API compliance
    const normalizedWaId = normalizePhoneForWhatsApp(wa_id);
    if (!normalizedWaId) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }
    
    // COMPLIANCE: Mark customer's most recent message as read (Meta best practice)
    // This triggers blue double-tick on customer's end
    const lastInbound = await WhatsAppMessage.findOne({
      sender_wa_id: wa_id,
      direction: 'inbound',
      platform: 'whatsapp'
    }).sort({ timestamp: -1 });
    
    if (lastInbound?.message_id) {
      markWhatsAppMessageRead(lastInbound.message_id).catch(err =>
        console.error('MARK_READ_ERROR', err.message)
      );
    }
    
    // Send via WhatsApp API
    const result = await postWhatsAppText({
      to: normalizedWaId,
      messageBody: message,
      staffId: req.user._id
    });
    
    if (!result.ok) {
      logWhatsAppSendFailure({
        event: 'whatsapp_text_send_failed',
        wa_id: normalizedWaId,
        metaError: result.error || result.reason,
        statusCode: result.status,
        details: result.responseText
      });
      return res.status(500).json({
        error: 'Failed to send message',
        details: result.error || result.reason
      });
    }
    
    // Mark conversation as replied
    await WhatsAppMessage.updateMany(
      {
        sender_wa_id: wa_id,
        direction: 'inbound',
        is_replied: false
      },
      { $set: { is_replied: true } }
    );
    
    res.json({
      success: true,
      message: 'Message sent successfully',
      message_id: result.messageId
    });
  } catch (error) {
    logWhatsAppSendFailure({
      event: 'whatsapp_text_send_exception',
      wa_id: req.body?.wa_id,
      metaError: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ==================== QUICK REPLIES ====================

// Get quick replies
router.get('/quick-replies', async (req, res) => {
  try {
    const { platform = 'all' } = req.query;
    
    const query = {
      is_active: true,
      $or: [
        { platform },
        { platform: 'all' }
      ]
    };
    
    const quickReplies = await QuickReply.find(query)
      .sort({ sort_order: 1, createdAt: -1 })
      .populate('created_by_staff_id', 'name');
    
    res.json({
      quick_replies: quickReplies.map(qr => ({
        id: qr._id,
        label: qr.label,
        message: qr.message,
        category: qr.category,
        usage_count: qr.usage_count,
        created_by: qr.created_by_staff_id?.name || 'Unknown'
      }))
    });
  } catch (error) {
    console.error('Get quick replies error:', error);
    res.status(500).json({ error: 'Failed to get quick replies' });
  }
});

// Create quick reply
router.post('/quick-replies', async (req, res) => {
  try {
    const { label, message, category, platform = 'all' } = req.body;
    
    if (!label || !message) {
      return res.status(400).json({ error: 'label and message are required' });
    }
    
    const quickReply = new QuickReply({
      label,
      message,
      category: category || 'other',
      platform,
      created_by_staff_id: req.user._id
    });
    
    await quickReply.save();
    
    res.status(201).json({
      success: true,
      quick_reply: {
        id: quickReply._id,
        label: quickReply.label,
        message: quickReply.message,
        category: quickReply.category
      }
    });
  } catch (error) {
    console.error('Create quick reply error:', error);
    res.status(500).json({ error: 'Failed to create quick reply' });
  }
});

// Update quick reply
router.put('/quick-replies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { label, message, category, is_active } = req.body;
    
    const updateFields = {};
    if (label !== undefined) updateFields.label = label;
    if (message !== undefined) updateFields.message = message;
    if (category !== undefined) updateFields.category = category;
    if (is_active !== undefined) updateFields.is_active = is_active;
    
    const quickReply = await QuickReply.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true }
    );
    
    if (!quickReply) {
      return res.status(404).json({ error: 'Quick reply not found' });
    }
    
    res.json({
      success: true,
      quick_reply: {
        id: quickReply._id,
        label: quickReply.label,
        message: quickReply.message,
        category: quickReply.category,
        is_active: quickReply.is_active
      }
    });
  } catch (error) {
    console.error('Update quick reply error:', error);
    res.status(500).json({ error: 'Failed to update quick reply' });
  }
});

// Delete quick reply
router.delete('/quick-replies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const quickReply = await QuickReply.findByIdAndDelete(id);
    
    if (!quickReply) {
      return res.status(404).json({ error: 'Quick reply not found' });
    }
    
    res.json({
      success: true,
      message: 'Quick reply deleted'
    });
  } catch (error) {
    console.error('Delete quick reply error:', error);
    res.status(500).json({ error: 'Failed to delete quick reply' });
  }
});

// Increment quick reply usage
router.post('/quick-replies/:id/use', async (req, res) => {
  try {
    const { id } = req.params;
    
    await QuickReply.findByIdAndUpdate(
      id,
      { $inc: { usage_count: 1 } }
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Increment usage error:', error);
    res.status(500).json({ error: 'Failed to update usage count' });
  }
});

// POST /contact-label — save a custom display name for a wa_id
router.post('/contact-label', async (req, res) => {
  try {
    const { wa_id, label } = req.body;
    if (!wa_id || !label) {
      return res.status(400).json({ error: 'wa_id and label are required' });
    }
    // Store label by updating profile_name on all messages from this wa_id
    await WhatsAppMessage.updateMany(
      { sender_wa_id: wa_id },
      { $set: { profile_name: label.trim() } }
    );
    res.json({ success: true, wa_id, label: label.trim() });
  } catch (error) {
    console.error('Save contact label error:', error);
    res.status(500).json({ error: 'Failed to save label' });
  }
});

// POST /start-conversation — initiate outbound message to a new number
router.post('/start-conversation', sendLimiter, async (req, res) => {
  try {
    const { wa_id, message } = req.body;
    if (!wa_id || !message) {
      return res.status(400).json({ error: 'wa_id and message are required' });
    }
    if (message.trim().length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }
    const normalizedWaId = normalizePhoneForWhatsApp(wa_id);
    if (!normalizedWaId) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }
    const result = await postWhatsAppText({
      to: normalizedWaId,
      messageBody: message,
      staffId: req.user._id
    });
    if (!result.ok) {
      logWhatsAppSendFailure({
        event: 'whatsapp_start_conversation_failed',
        wa_id: normalizedWaId,
        metaError: result.error || result.reason,
        statusCode: result.status,
        details: result.responseText
      });
      return res.status(500).json({
        error: 'Failed to send message',
        details: result.error || result.reason
      });
    }
    res.json({ success: true, wa_id: normalizedWaId, message_id: result.messageId });
  } catch (error) {
    logWhatsAppSendFailure({
      event: 'whatsapp_start_conversation_exception',
      wa_id: req.body?.wa_id,
      metaError: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: 'Failed to start conversation' });
  }
});

// GET /media/:mediaId — proxy Meta media to browser (avoids CORS and auth issues)
router.get('/media/:mediaId', async (req, res) => {
  try {
    const { mediaId } = req.params;
    if (!mediaId) return res.status(400).json({ error: 'mediaId required' });

    // Step 1: get temporary download URL from Meta
    const tempUrl = await getMetaMediaUrl(mediaId);
    if (!tempUrl) {
      return res.status(404).json({ error: 'Media not found or expired' });
    }

    // Step 2: download the binary from Meta
    const { ok, buffer, contentType } = await downloadMetaMedia(tempUrl);
    if (!ok) {
      return res.status(502).json({ error: 'Failed to download media from Meta' });
    }

    // Step 3: stream to browser with correct content type
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'private, max-age=300'); // cache 5 min
    res.send(buffer);
  } catch (error) {
    console.error('Media proxy error:', error);
    res.status(500).json({ error: 'Media proxy failed' });
  }
});

// POST /send-template — send an approved template to a contact
router.post('/send-template', sendLimiter, async (req, res) => {
  try {
    const { wa_id, template_name, language_code, components } = req.body;
    if (!wa_id || !template_name) {
      return res.status(400).json({ error: 'wa_id and template_name are required' });
    }

    const templateDoc = await TemplateDefinition.findOne({ name: template_name });
    if (!templateDoc) {
      return res.status(404).json({ error: `Template "${template_name}" not found. Run sync first.` });
    }
    if (templateDoc.status !== 'approved') {
      return res.status(400).json({ error: `Template "${template_name}" is not approved (status: ${templateDoc.status})` });
    }

    const normalizedWaId = normalizePhoneForWhatsApp(wa_id);
    if (!normalizedWaId) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    const result = await postWhatsAppTemplate({
      to: normalizedWaId,
      templateName: template_name,
      languageCode: language_code || templateDoc.language || 'ar',
      components: components || [],
      staffId: req.user._id
    });

    if (!result.ok) {
      logWhatsAppSendFailure({
        event: 'whatsapp_template_send_failed',
        wa_id: normalizedWaId,
        metaError: result.error || result.reason,
        statusCode: result.status
      });
      return res.status(500).json({ error: 'Failed to send template', details: result.error || result.reason });
    }

    try {
      await WhatsAppMessage.create({
        message_id: result.messageId || `tpl_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        sender_wa_id: wa_id,
        profile_name: '',
        message_type: 'template',
        text_body: templateDoc.body_text || `[Template: ${template_name}]`,
        direction: 'outbound',
        platform: 'whatsapp',
        status: 'sent',
        timestamp: new Date(),
        sent_by_staff_id: req.user._id,
        is_read_by_staff: true,
        is_template_message: true,
        template_id: templateDoc._id
      });
    } catch (persistErr) {
      if (persistErr?.code !== 11000) console.error('TEMPLATE_SEND_PERSIST_ERROR', persistErr.message);
    }

    res.json({ success: true, message_id: result.messageId });
  } catch (error) {
    logWhatsAppSendFailure({
      event: 'whatsapp_template_send_exception',
      wa_id: req.body?.wa_id,
      metaError: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: 'Failed to send template' });
  }
});

// POST /send-image — staff sends an image to a contact
router.post('/send-image', sendLimiter, (req, res) => {
  uploadMemory.single('image')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message || 'Upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const { wa_id, caption } = req.body;
    if (!wa_id) return res.status(400).json({ error: 'wa_id is required' });

    const normalizedWaId = normalizePhoneForWhatsApp(wa_id);
    if (!normalizedWaId) return res.status(400).json({ error: 'Invalid phone number format' });

    try {
      // Step 1: upload image to Meta
      const uploadResult = await uploadMediaToMeta(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname || 'image.jpg'
      );

      if (!uploadResult.ok) {
        logWhatsAppSendFailure({
          event: 'whatsapp_image_upload_failed',
          wa_id: normalizedWaId,
          mimeType: req.file.mimetype,
          metaError: uploadResult.error,
          statusCode: uploadResult.status
        });
        return res.status(502).json({ error: 'Failed to upload image to Meta', details: uploadResult.error });
      }

      const mediaId = uploadResult.mediaId;
      const sendResult = await sendMetaImageMessage({
        to: normalizedWaId,
        mediaId,
        caption
      });
      if (!sendResult.ok) {
        logWhatsAppSendFailure({
          event: 'whatsapp_image_send_failed',
          wa_id: normalizedWaId,
          mimeType: req.file.mimetype,
          metaError: sendResult.error,
          statusCode: sendResult.status
        });
        return res.status(502).json({ error: 'Failed to send image', details: sendResult.error });
      }
      const messageId = sendResult.messageId || `img_${Date.now()}`;

      // Step 3: persist outbound message
      try {
        await WhatsAppMessage.create({
          message_id: messageId,
          sender_wa_id: wa_id,
          profile_name: '',
          message_type: 'image',
          text_body: caption || '',
          media_url: mediaId,
          media_mime_type: req.file.mimetype,
          direction: 'outbound',
          platform: 'whatsapp',
          status: 'sent',
          timestamp: new Date(),
          sent_by_staff_id: req.user._id,
          is_read_by_staff: true
        });
      } catch (persistErr) {
        if (persistErr?.code !== 11000) console.error('IMAGE_SEND_PERSIST_ERROR', persistErr.message);
      }

      res.json({ success: true, message_id: messageId, media_id: mediaId });
    } catch (error) {
      logWhatsAppSendFailure({
        event: 'whatsapp_image_send_exception',
        wa_id: req.body?.wa_id,
        mimeType: req.file?.mimetype,
        metaError: error.message,
        stack: error.stack
      });
      res.status(500).json({ error: 'Failed to send image' });
    }
  });
});

module.exports = router;
