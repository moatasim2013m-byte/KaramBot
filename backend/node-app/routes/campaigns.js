const express = require('express');
const Campaign = require('../models/Campaign');
const CampaignBroadcast = require('../models/CampaignBroadcast');
const TemplateDefinition = require('../models/TemplateDefinition');
const User = require('../models/User');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const HourlyBooking = require('../models/HourlyBooking');
const UserSubscription = require('../models/UserSubscription');
const { authMiddleware, staffMiddleware } = require('../middleware/auth');
const { postWhatsAppText } = require('../utils/whatsappBookingConfirmation');

const router = express.Router();

// Apply staff middleware to all campaign routes
router.use(authMiddleware, staffMiddleware);

// ==================== UTILITY FUNCTIONS ====================

/**
 * Query audience based on campaign filter
 * Returns array of {user, phone, wa_id, ...context}
 */
async function queryAudience(audienceFilter) {
  const { segment, tags, exclude_tags, phone_numbers, created_after, created_before } = audienceFilter;
  
  let query = {
    whatsapp_opted_out_at: null // Exclude opted-out users (COMPLIANCE)
  };
  
  // Date range filter
  if (created_after) query.created_at = { $gte: new Date(created_after) };
  if (created_before) {
    query.created_at = query.created_at || {};
    query.created_at.$lte = new Date(created_before);
  }
  
  // Tag filters (if implemented in future)
  if (tags && tags.length > 0) {
    query.tags = { $in: tags };
  }
  if (exclude_tags && exclude_tags.length > 0) {
    query.tags = query.tags || {};
    query.tags.$nin = exclude_tags;
  }
  
  // Manual phone list
  if (phone_numbers && phone_numbers.length > 0) {
    query.phone = { $in: phone_numbers };
  }
  
  let users = [];
  
  // Segment-based queries
  if (segment === 'all') {
    users = await User.find(query).lean();
  } else if (segment === 'active_bookings') {
    // Users with checked-in bookings today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const activeBookings = await HourlyBooking.find({
      status: 'checked_in',
      check_in_time: { $gte: today }
    }).distinct('user_id');
    
    query._id = { $in: activeBookings };
    users = await User.find(query).lean();
  } else if (segment === 'expired_subs') {
    // Users with expired subscriptions
    const expiredSubs = await UserSubscription.find({
      status: 'consumed',
      expires_at: { $lt: new Date() }
    }).distinct('user_id');
    
    query._id = { $in: expiredSubs };
    users = await User.find(query).lean();
  } else if (segment === 'high_value') {
    // Users with >5 bookings
    const bookingCounts = await HourlyBooking.aggregate([
      { $group: { _id: '$user_id', count: { $sum: 1 } } },
      { $match: { count: { $gt: 5 } } }
    ]);
    
    const highValueUsers = bookingCounts.map(b => b._id);
    query._id = { $in: highValueUsers };
    users = await User.find(query).lean();
  } else {
    // Custom or unsupported segment
    users = await User.find(query).lean();
  }
  
  // Enrich with WhatsApp ID and consent info
  const enriched = users.map(user => ({
    user,
    phone: user.phone,
    wa_id: user.phone, // Normalize phone to wa_id
    name: user.name,
    consent_verified: user.whatsapp_marketing_consent === true,
    last_inbound_time: user.last_inbound_whatsapp_time,
    opted_out: user.whatsapp_opted_out_at !== null
  }));
  
  return enriched.filter(e => e.phone && !e.opted_out); // Only users with phone and not opted out
}

/**
 * Check if user is within 24-hour customer service window
 */
function isWithin24HourWindow(lastInboundTime) {
  if (!lastInboundTime) return false;
  
  const now = new Date();
  const diff_ms = now - new Date(lastInboundTime);
  const hours_24_ms = 24 * 60 * 60 * 1000;
  
  return diff_ms < hours_24_ms;
}

/**
 * Inject template variables
 * Example: "Hello {{customer_name}}, your booking on {{booking_date}}" 
 *          -> "Hello John, your booking on 2025-04-05"
 */
function injectTemplateVariables(templateBody, variableValues) {
  let result = templateBody;
  
  for (const [key, value] of Object.entries(variableValues)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value);
  }
  
  return result;
}

/**
 * Build variable values from user context and personalization mapping
 * Example personalization: {customer_name: 'user.name', booking_date: 'booking.slot_id.date'}
 */
function buildVariableValues(recipient, personalizationMap) {
  const values = {};
  
  for (const [varName, path] of Object.entries(personalizationMap)) {
    // Simple path resolution (e.g., 'user.name' -> recipient.user.name)
    const pathParts = path.split('.');
    let value = recipient;
    
    for (const part of pathParts) {
      value = value?.[part];
    }
    
    values[varName] = value || '';
  }
  
  return values;
}

// ==================== ROUTES ====================

/**
 * POST /api/campaigns
 * Create new campaign
 */
router.post('/', async (req, res) => {
  try {
    const {
      name,
      description,
      template_id,
      audience_filter,
      personalization,
      allow_24h_window,
      scheduled_at
    } = req.body;
    
    // Validation
    if (!name) {
      return res.status(400).json({ error: 'Campaign name is required' });
    }
    
    // If template_id provided, validate it exists and is approved
    if (template_id) {
      const template = await TemplateDefinition.findByMetaId(template_id);
      if (!template) {
        return res.status(400).json({ error: `Template ${template_id} not found` });
      }
      if (!template.canUse()) {
        return res.status(400).json({ error: `Template ${template_id} is not approved (status: ${template.status})` });
      }
    }
    
    // Validate scheduled_at is not in past
    if (scheduled_at && new Date(scheduled_at) < new Date()) {
      return res.status(400).json({ error: 'scheduled_at cannot be in the past' });
    }
    
    const campaign = new Campaign({
      name,
      description: description || '',
      template_id,
      audience_filter: audience_filter || { segment: 'all' },
      personalization: personalization || {},
      allow_24h_window: allow_24h_window || false,
      scheduled_at: scheduled_at || null,
      created_by: req.user._id,
      status: 'draft'
    });
    
    await campaign.save();
    
    res.status(201).json({
      success: true,
      campaign: campaign.toJSON()
    });
  } catch (error) {
    console.error('Create campaign error:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

/**
 * GET /api/campaigns
 * List campaigns (paginated)
 */
router.get('/', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    
    const query = {};
    if (status) query.status = status;
    
    const campaigns = await Campaign.find(query)
      .populate('created_by', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await Campaign.countDocuments(query);
    
    res.json({
      campaigns,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('List campaigns error:', error);
    res.status(500).json({ error: 'Failed to list campaigns' });
  }
});

/**
 * GET /api/campaigns/:id
 * Get single campaign with broadcast history
 */
router.get('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id)
      .populate('created_by', 'name email');
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    // Get broadcast history
    const broadcasts = await CampaignBroadcast.find({ campaign_id: campaign._id })
      .sort({ created_at: -1 })
      .select('-recipients -audit_log'); // Exclude large arrays
    
    res.json({
      campaign,
      broadcasts,
      broadcast_count: broadcasts.length
    });
  } catch (error) {
    console.error('Get campaign error:', error);
    res.status(500).json({ error: 'Failed to get campaign' });
  }
});

/**
 * PATCH /api/campaigns/:id
 * Update campaign (only if draft)
 */
router.patch('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    if (!campaign.isEditable()) {
      return res.status(400).json({ error: `Cannot edit campaign in status: ${campaign.status}` });
    }
    
    const allowedFields = ['name', 'description', 'template_id', 'audience_filter', 'personalization', 'allow_24h_window', 'scheduled_at', 'status'];
    
    for (const field of allowedFields) {
      if (req.body.hasOwnProperty(field)) {
        campaign[field] = req.body[field];
      }
    }
    
    // Validate template if changed
    if (req.body.template_id) {
      const template = await TemplateDefinition.findByMetaId(req.body.template_id);
      if (!template || !template.canUse()) {
        return res.status(400).json({ error: `Template ${req.body.template_id} not approved` });
      }
    }
    
    await campaign.save();
    
    res.json({
      success: true,
      campaign
    });
  } catch (error) {
    console.error('Update campaign error:', error);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

// Continue in next message due to character limit...

/**
 * POST /api/campaigns/:id/execute
 * Execute campaign broadcast
 * 
 * COMPLIANCE CHECKPOINTS:
 * 1. Validate opt-in consent for all recipients
 * 2. Check 24-hour window for free-form eligibility
 * 3. Enforce template usage outside 24h window
 * 4. Log all send attempts for audit
 * 5. Handle rate limiting (1 msg/sec per phone)
 */
router.post('/:id/execute', async (req, res) => {
  try {
    const { force_send_all = false } = req.body;
    
    const campaign = await Campaign.findById(req.params.id);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    if (!campaign.canExecute()) {
      return res.status(400).json({ error: `Cannot execute campaign in status: ${campaign.status}` });
    }
    
    // Lock campaign
    campaign.status = 'active';
    await campaign.save();
    
    // Query audience
    const recipients = await queryAudience(campaign.audience_filter);
    
    if (recipients.length === 0) {
      campaign.status = 'completed';
      await campaign.save();
      return res.status(400).json({ error: 'No recipients found matching audience filter' });
    }
    
    // Get next broadcast number
    const lastBroadcast = await CampaignBroadcast.findOne({ campaign_id: campaign._id })
      .sort({ broadcast_number: -1 });
    const broadcastNumber = lastBroadcast ? lastBroadcast.broadcast_number + 1 : 1;
    
    // Create broadcast record
    const broadcast = new CampaignBroadcast({
      campaign_id: campaign._id,
      broadcast_number: broadcastNumber,
      status: 'in_progress',
      started_at: new Date(),
      total_recipients: recipients.length,
      recipients: recipients.map(r => ({
        phone: r.phone,
        wa_id: r.wa_id,
        user_id: r.user?._id,
        consent_verified: r.consent_verified,
        last_inbound_time: r.last_inbound_time,
        within_24h_window: isWithin24HourWindow(r.last_inbound_time),
        status: 'pending'
      }))
    });
    
    broadcast.addAuditLog('broadcast_started', `Campaign execution started with ${recipients.length} recipients`);
    await broadcast.save();
    
    // Execute sends asynchronously (don't block response)
    setImmediate(() => executeBroadcastSends(campaign, broadcast));
    
    res.json({
      success: true,
      broadcast_id: broadcast._id,
      status: 'in_progress',
      total_recipients: recipients.length
    });
  } catch (error) {
    console.error('Execute campaign error:', error);
    res.status(500).json({ error: 'Failed to execute campaign' });
  }
});

/**
 * Background worker: Execute broadcast sends with rate limiting
 */
async function executeBroadcastSends(campaign, broadcast) {
  try {
    const template = campaign.template_id 
      ? await TemplateDefinition.findByMetaId(campaign.template_id)
      : null;
    
    const sendDelay = 1000; // 1 second per send (rate limit compliance)
    
    for (const recipient of broadcast.recipients) {
      // Skip if already processed
      if (recipient.status !== 'pending') continue;
      
      // COMPLIANCE: Validate consent
      if (campaign.require_consent && !recipient.consent_verified) {
        recipient.status = 'skipped';
        recipient.error_reason = 'No marketing consent';
        broadcast.addAuditLog('consent_check_failed', `Skipped ${recipient.wa_id}: No consent`, 'warning', recipient.wa_id);
        continue;
      }
      
      // COMPLIANCE: Check 24h window
      const within24h = recipient.within_24h_window;
      const useTemplate = !campaign.allow_24h_window || !within24h || campaign.template_id !== null;
      
      if (useTemplate && !template) {
        recipient.status = 'failed';
        recipient.error_reason = 'Template required but not configured';
        broadcast.addAuditLog('template_missing', `Failed ${recipient.wa_id}: Template required`, 'failed', recipient.wa_id);
        continue;
      }
      
      // Build variable values
      const variableValues = buildVariableValues(recipient, campaign.personalization.toObject ? campaign.personalization.toObject() : campaign.personalization);
      
      // Inject variables into template or free-form message
      let messageText = '';
      if (useTemplate && template) {
        messageText = injectTemplateVariables(template.body_text, variableValues);
        recipient.template_used = true;
        recipient.template_id = template.meta_template_id;
        recipient.variables_injected = variableValues;
      } else {
        // Free-form message (within 24h window)
        messageText = campaign.description; // Or use custom message field
        recipient.template_used = false;
      }
      
      // Send message
      try {
        const result = await postWhatsAppText({
          to: recipient.wa_id,
          messageBody: messageText,
          staffId: campaign.created_by
        });
        
        if (result.ok) {
          recipient.status = 'sent';
          recipient.sent_at = new Date();
          recipient.whatsapp_message_id = result.messageId;
          
          // Create WhatsAppMessage record
          const whatsappMsg = new WhatsAppMessage({
            message_id: result.messageId || `campaign_${broadcast._id}_${recipient.wa_id}_${Date.now()}`,
            sender_wa_id: recipient.wa_id,
            profile_name: recipient.name || '',
            message_type: 'text',
            text_body: messageText,
            direction: 'outbound',
            status: 'sent',
            timestamp: new Date(),
            sent_by_staff_id: campaign.created_by,
            campaign_id: campaign._id,
            broadcast_id: broadcast._id,
            is_template_message: recipient.template_used,
            template_id: recipient.template_id,
            template_variables_used: recipient.variables_injected,
            consent_verified: recipient.consent_verified
          });
          
          await whatsappMsg.save();
          
          broadcast.addAuditLog('message_sent', `Sent to ${recipient.wa_id}`, 'success', recipient.wa_id, { template_used: recipient.template_used });
        } else {
          recipient.status = 'failed';
          recipient.error_reason = result.error || result.reason || 'Unknown error';
          broadcast.addAuditLog('message_failed', `Failed ${recipient.wa_id}: ${recipient.error_reason}`, 'failed', recipient.wa_id);
        }
      } catch (sendError) {
        recipient.status = 'failed';
        recipient.error_reason = sendError.message;
        broadcast.addAuditLog('message_error', `Error ${recipient.wa_id}: ${sendError.message}`, 'failed', recipient.wa_id);
      }
      
      // Rate limiting: wait 1 second between sends
      await new Promise(resolve => setTimeout(resolve, sendDelay));
    }
    
    // Mark broadcast as completed
    broadcast.markCompleted();
    await broadcast.save();
    
    // Update campaign stats
    campaign.stats.total_recipients += broadcast.total_recipients;
    campaign.stats.sent += broadcast.total_sent;
    campaign.stats.failed += broadcast.total_failed;
    campaign.status = 'completed';
    await campaign.save();
    
    console.log(`CAMPAIGN_BROADCAST_COMPLETED campaign=${campaign._id} broadcast=${broadcast._id} sent=${broadcast.total_sent} failed=${broadcast.total_failed}`);
  } catch (error) {
    console.error('CAMPAIGN_BROADCAST_ERROR', error);
    broadcast.status = 'failed';
    broadcast.addAuditLog('broadcast_failed', `Broadcast failed: ${error.message}`, 'failed');
    await broadcast.save();
  }
}

/**
 * GET /api/campaigns/:id/broadcasts
 * List all broadcasts for a campaign
 */
router.get('/:id/broadcasts', async (req, res) => {
  try {
    const broadcasts = await CampaignBroadcast.find({ campaign_id: req.params.id })
      .sort({ broadcast_number: -1 })
      .select('-recipients -audit_log'); // Exclude large arrays
    
    res.json({ broadcasts });
  } catch (error) {
    console.error('List broadcasts error:', error);
    res.status(500).json({ error: 'Failed to list broadcasts' });
  }
});

/**
 * GET /api/campaigns/:id/broadcasts/:broadcast_id
 * Get detailed broadcast status with per-recipient breakdown
 */
router.get('/:id/broadcasts/:broadcast_id', async (req, res) => {
  try {
    const broadcast = await CampaignBroadcast.findOne({
      _id: req.params.broadcast_id,
      campaign_id: req.params.id
    });
    
    if (!broadcast) {
      return res.status(404).json({ error: 'Broadcast not found' });
    }
    
    res.json({ broadcast });
  } catch (error) {
    console.error('Get broadcast error:', error);
    res.status(500).json({ error: 'Failed to get broadcast' });
  }
});

/**
 * POST /api/campaigns/:id/cancel
 * Cancel campaign
 */
router.post('/:id/cancel', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    campaign.status = 'cancelled';
    await campaign.save();
    
    // Cancel any in-progress broadcasts
    await CampaignBroadcast.updateMany(
      { campaign_id: campaign._id, status: 'in_progress' },
      { $set: { status: 'cancelled', completed_at: new Date() } }
    );
    
    res.json({
      success: true,
      message: 'Campaign cancelled'
    });
  } catch (error) {
    console.error('Cancel campaign error:', error);
    res.status(500).json({ error: 'Failed to cancel campaign' });
  }
});

/**
 * GET /api/campaigns/:id/audit-log
 * Get full audit trail for compliance
 */
router.get('/:id/audit-log', async (req, res) => {
  try {
    const broadcasts = await CampaignBroadcast.find({ campaign_id: req.params.id })
      .sort({ broadcast_number: 1 })
      .select('broadcast_number audit_log started_at');
    
    const fullLog = [];
    
    for (const broadcast of broadcasts) {
      for (const entry of broadcast.audit_log) {
        fullLog.push({
          broadcast_number: broadcast.broadcast_number,
          broadcast_id: broadcast._id,
          timestamp: entry.timestamp,
          event: entry.event,
          wa_id: entry.wa_id,
          details: entry.details,
          status: entry.status,
          metadata: entry.metadata
        });
      }
    }
    
    res.json({
      campaign_id: req.params.id,
      total_entries: fullLog.length,
      audit_log: fullLog
    });
  } catch (error) {
    console.error('Get audit log error:', error);
    res.status(500).json({ error: 'Failed to get audit log' });
  }
});

module.exports = router;

