const express = require('express');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const QuickReply = require('../models/QuickReply');
const User = require('../models/User');
const Child = require('../models/Child');
const HourlyBooking = require('../models/HourlyBooking');
const BirthdayBooking = require('../models/BirthdayBooking');
const UserSubscription = require('../models/UserSubscription');
const { authMiddleware, staffMiddleware } = require('../middleware/auth');
const { postWhatsAppText, markMessageAsRead } = require('../utils/whatsappBookingConfirmation');

const router = express.Router();

// Apply staff middleware to all routes
router.use(authMiddleware, staffMiddleware);

// ==================== CONVERSATIONS ====================

// Get all conversations (unique contacts)
router.get('/conversations', async (req, res) => {
  try {
    const { search, unread_only, date_from, date_to } = req.query;
    
    // Build aggregation pipeline
    const matchStage = { platform: 'whatsapp' };
    
    // Date filter
    if (date_from || date_to) {
      matchStage.timestamp = {};
      if (date_from) matchStage.timestamp.$gte = new Date(date_from);
      if (date_to) matchStage.timestamp.$lte = new Date(date_to);
    }
    
    // Aggregate conversations
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
                { $and: [
                  { $eq: ['$direction', 'inbound'] },
                  { $eq: ['$is_read_by_staff', false] }
                ]},
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
    
    // Filter by search query if provided
    let filteredConversations = conversations;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredConversations = conversations.filter(conv => {
        const profileName = conv.last_message?.profile_name?.toLowerCase() || '';
        const waId = conv.last_message?.sender_wa_id || '';
        return profileName.includes(searchLower) || waId.includes(search);
      });
    }
    
    // Filter by unread only
    if (unread_only === 'true') {
      filteredConversations = filteredConversations.filter(conv => conv.unread_count > 0);
    }
    
    // Format response
    const formattedConversations = filteredConversations.map(conv => ({
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
    }));
    
    res.json({ conversations: formattedConversations });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

// Get conversation statistics
router.get('/stats', async (req, res) => {
  try {
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
    
    res.json({
      total_conversations: totalConversations.length,
      unread_messages: unreadCount,
      today_messages: todayMessages
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ==================== MESSAGES ====================

// Get messages for a specific contact
router.get('/messages/:wa_id', async (req, res) => {
  try {
    const { wa_id } = req.params;
    const { limit = 100, before } = req.query;
    
    const query = {
      sender_wa_id: wa_id,
      platform: 'whatsapp'
    };
    
    // Pagination
    if (before) {
      query.timestamp = { $lt: new Date(before) };
    }
    
    const messages = await WhatsAppMessage.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .populate('sent_by_staff_id', 'name email')
      .populate('linked_user_id', 'name email phone');
    
    // Mark inbound messages as read
    await WhatsAppMessage.updateMany(
      {
        sender_wa_id: wa_id,
        direction: 'inbound',
        is_read_by_staff: false
      },
      { $set: { is_read_by_staff: true } }
    );
    
    // Format response
    const formattedMessages = messages.reverse().map(msg => ({
      id: msg._id,
      message_id: msg.message_id,
      direction: msg.direction,
      message_type: msg.message_type,
      text_body: msg.text_body,
      media_url: msg.media_url,
      timestamp: msg.timestamp,
      status: msg.status,
      sent_by_staff: msg.sent_by_staff_id ? {
        name: msg.sent_by_staff_id.name,
        email: msg.sent_by_staff_id.email
      } : null
    }));
    
    res.json({ messages: formattedMessages });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
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
router.post('/send', async (req, res) => {
  try {
    const { wa_id, message } = req.body;
    
    if (!wa_id || !message) {
      return res.status(400).json({ error: 'wa_id and message are required' });
    }
    
    if (message.trim().length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }
    
    // COMPLIANCE: Mark customer's most recent message as read (Meta best practice)
    // This triggers blue double-tick on customer's end
    try {
      const lastUnreadInbound = await WhatsAppMessage.findOne({
        sender_wa_id: wa_id,
        direction: 'inbound',
        platform: 'whatsapp'
      })
        .sort({ timestamp: -1 })
        .select('message_id');
      
      if (lastUnreadInbound && lastUnreadInbound.message_id) {
        await markMessageAsRead(lastUnreadInbound.message_id);
        console.log('STAFF_INBOX_MARKED_READ', { 
          wa_id, 
          message_id: lastUnreadInbound.message_id 
        });
      }
    } catch (markReadError) {
      // Don't fail send if mark-as-read fails
      console.warn('STAFF_INBOX_MARK_READ_FAILED', {
        error: markReadError.message,
        wa_id
      });
    }
    
    // Send via WhatsApp API
    const result = await postWhatsAppText({
      to: wa_id,
      messageBody: message,
      staffId: req.user._id
    });
    
    if (!result.ok) {
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
    console.error('Send message error:', error);
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

module.exports = router;
