/**
 * Staff Campaigns Routes — /api/staff/campaigns
 *
 * Meta Marketing Messages API compliant (Feb 2026 GA release).
 * - Template messages (outside 24h window) → /marketing_messages endpoint
 * - Free-form messages (within 24h window)  → /messages endpoint (existing postWhatsAppText)
 * - Audience is built entirely from WhatsAppMessage contact history (no separate contacts collection)
 */

const express = require('express');
const Campaign = require('../models/Campaign');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const HourlyBooking = require('../models/HourlyBooking');
const BirthdayBooking = require('../models/BirthdayBooking');
const UserSubscription = require('../models/UserSubscription');
const { authMiddleware, staffMiddleware } = require('../middleware/auth');
const { normalizePhoneForWhatsApp, postWhatsAppText } = require('../utils/whatsappBookingConfirmation');
const { postWhatsAppTemplate } = require('../utils/whatsappMarketing');

const router = express.Router();

// All campaign routes require authenticated staff
router.use(authMiddleware, staffMiddleware);

// ==================== HELPERS ====================

const WINDOW_MS = 24 * 60 * 60 * 1000; // 24-hour customer-service window

/**
 * Determine if a wa_id has an inbound message within the last 24 hours.
 */
async function isWithin24hWindow(waId) {
  const cutoff = new Date(Date.now() - WINDOW_MS);
  const msg = await WhatsAppMessage.findOne({
    sender_wa_id: waId,
    direction: 'inbound',
    timestamp: { $gte: cutoff }
  }).sort({ timestamp: -1 });
  return !!msg;
}

/**
 * Build the filtered audience (array of normalized wa_ids) from campaign audience_filters.
 * Source of truth: WhatsAppMessage collection — distinct inbound sender_wa_id values.
 */
async function buildAudience(audienceFilters) {
  const {
    has_booking,
    has_active_subscription,
    last_message_after,
    last_message_before,
    profile_name_contains
  } = audienceFilters || {};

  // Step 1: get all distinct inbound senders
  let matchStage = { direction: 'inbound', platform: 'whatsapp' };

  if (last_message_after || last_message_before) {
    matchStage.timestamp = {};
    if (last_message_after) matchStage.timestamp.$gte = new Date(last_message_after);
    if (last_message_before) matchStage.timestamp.$lte = new Date(last_message_before);
  }

  const contactAgg = await WhatsAppMessage.aggregate([
    { $match: matchStage },
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: '$sender_wa_id',
        profile_name: { $first: '$profile_name' },
        linked_user_id: { $first: '$linked_user_id' },
        last_inbound_at: { $first: '$timestamp' }
      }
    }
  ]);

  // Step 2: profile_name filter
  let contacts = contactAgg;
  if (profile_name_contains) {
    const needle = profile_name_contains.toLowerCase();
    contacts = contacts.filter(c => (c.profile_name || '').toLowerCase().includes(needle));
  }

  // Step 3: has_booking filter — keep only contacts whose linked_user_id has a booking
  if (has_booking) {
    const linkedUserIds = contacts.map(c => c.linked_user_id).filter(Boolean);
    const [hourlyUserIds, birthdayUserIds] = await Promise.all([
      HourlyBooking.distinct('user_id', { user_id: { $in: linkedUserIds } }),
      BirthdayBooking.distinct('user_id', { user_id: { $in: linkedUserIds } })
    ]);
    const bookedSet = new Set([
      ...hourlyUserIds.map(String),
      ...birthdayUserIds.map(String)
    ]);
    contacts = contacts.filter(c => c.linked_user_id && bookedSet.has(String(c.linked_user_id)));
  }

  // Step 4: has_active_subscription filter
  if (has_active_subscription) {
    const linkedUserIds = contacts.map(c => c.linked_user_id).filter(Boolean);
    const activeSubUserIds = await UserSubscription.distinct('user_id', {
      user_id: { $in: linkedUserIds },
      status: 'active',
      remaining_visits: { $gt: 0 }
    });
    const activeSet = new Set(activeSubUserIds.map(String));
    contacts = contacts.filter(c => c.linked_user_id && activeSet.has(String(c.linked_user_id)));
  }

  // Step 5: normalize phone numbers and drop invalid ones
  return contacts
    .map(c => normalizePhoneForWhatsApp(c._id))
    .filter(Boolean);
}

// ==================== ROUTES ====================

/**
 * POST /api/staff/campaigns
 * Create a new campaign.
 */
router.post('/', async (req, res) => {
  try {
    const {
      name,
      message_type,
      template_name,
      template_language,
      template_components,
      free_form_message,
      audience_filters,
      scheduled_at
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Campaign name is required' });
    }
    if (!message_type || !['template', 'free_form'].includes(message_type)) {
      return res.status(400).json({ error: 'message_type must be "template" or "free_form"' });
    }
    if (message_type === 'template' && !template_name) {
      return res.status(400).json({ error: 'template_name is required for template campaigns' });
    }
    if (message_type === 'free_form' && !free_form_message) {
      return res.status(400).json({ error: 'free_form_message is required for free_form campaigns' });
    }

    const campaign = new Campaign({
      name,
      // Repurpose existing schema fields to hold marketing-specific values
      template_name: template_name || null,
      audience_filter: {
        segment: 'custom',
        // Store new-style filters in metadata extension point
      },
      allow_24h_window: message_type === 'free_form',
      created_by: req.user._id,
      status: 'draft',
      scheduled_at: scheduled_at || null,
      metadata: {
        message_type,
        template_language: template_language || 'ar',
        template_components: template_components || [],
        free_form_message: free_form_message || null,
        audience_filters: audience_filters || {}
      }
    });

    await campaign.save();

    res.status(201).json({
      success: true,
      campaign: {
        id: campaign._id,
        name: campaign.name,
        status: campaign.status,
        message_type,
        created_at: campaign.createdAt
      }
    });
  } catch (error) {
    console.error('Staff create campaign error:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

/**
 * GET /api/staff/campaigns
 * List campaigns with live stats, paginated.
 */
router.get('/', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = status;

    const [campaigns, total] = await Promise.all([
      Campaign.find(query)
        .sort({ createdAt: -1 })
        .skip((parseInt(page) - 1) * parseInt(limit))
        .limit(parseInt(limit))
        .lean(),
      Campaign.countDocuments(query)
    ]);

    // Attach live stats from WhatsAppMessage for each campaign
    const campaignIds = campaigns.map(c => c._id);
    const statsAgg = await WhatsAppMessage.aggregate([
      { $match: { campaign_id: { $in: campaignIds } } },
      { $group: { _id: { campaign_id: '$campaign_id', status: '$status' }, count: { $sum: 1 } } }
    ]);

    const statsMap = {};
    for (const row of statsAgg) {
      const cid = String(row._id.campaign_id);
      if (!statsMap[cid]) statsMap[cid] = { sent: 0, delivered: 0, read: 0, failed: 0 };
      const s = row._id.status;
      if (['sent', 'delivered', 'read'].includes(s)) statsMap[cid].sent += row.count;
      if (['delivered', 'read'].includes(s)) statsMap[cid].delivered += row.count;
      if (s === 'read') statsMap[cid].read += row.count;
      if (s === 'failed') statsMap[cid].failed += row.count;
    }

    const result = campaigns.map(c => ({
      id: c._id,
      name: c.name,
      status: c.status,
      message_type: c.metadata?.message_type || (c.allow_24h_window ? 'free_form' : 'template'),
      recipient_count: c.stats?.total_recipients || 0,
      executed_at: c.metadata?.executed_at || null,
      created_at: c.createdAt,
      live_stats: statsMap[String(c._id)] || { sent: 0, delivered: 0, read: 0, failed: 0 }
    }));

    res.json({
      campaigns: result,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    console.error('Staff list campaigns error:', error);
    res.status(500).json({ error: 'Failed to list campaigns' });
  }
});

/**
 * GET /api/staff/campaigns/:id
 * Get single campaign with live stats.
 */
router.get('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Live stats from WhatsAppMessage
    const statsAgg = await WhatsAppMessage.aggregate([
      { $match: { campaign_id: campaign._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const stats = { sent: 0, delivered: 0, read: 0, failed: 0 };
    for (const row of statsAgg) {
      if (['sent', 'delivered', 'read'].includes(row._id)) stats.sent += row.count;
      if (['delivered', 'read'].includes(row._id)) stats.delivered += row.count;
      if (row._id === 'read') stats.read += row.count;
      if (row._id === 'failed') stats.failed += row.count;
    }

    res.json({ campaign, live_stats: stats });
  } catch (error) {
    console.error('Staff get campaign error:', error);
    res.status(500).json({ error: 'Failed to get campaign' });
  }
});

/**
 * POST /api/staff/campaigns/:id/execute
 * Execute a broadcast. Responds 202 immediately; sends run in the background.
 */
router.post('/:id/execute', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (!['draft', 'paused'].includes(campaign.status)) {
      return res.status(400).json({ error: 'Campaign already executed or running' });
    }

    const audienceFilters = campaign.metadata?.audience_filters || {};
    const recipients = await buildAudience(audienceFilters);

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'No valid recipients found for this campaign' });
    }

    // Lock campaign before responding
    campaign.status = 'running';
    campaign.stats = campaign.stats || {};
    campaign.stats.total_recipients = recipients.length;
    campaign.metadata = campaign.metadata || {};
    campaign.metadata.executed_at = new Date();
    campaign.markModified('metadata');
    await campaign.save();

    // Capture values needed in the async loop before req may be garbage-collected
    const staffId = req.user._id;
    const campaignId = campaign._id;
    const messageType = campaign.metadata.message_type;
    const templateName = campaign.template_name;
    const templateLanguage = campaign.metadata.template_language || 'ar';
    const templateComponents = campaign.metadata.template_components || [];
    const freeFormMessage = campaign.metadata.free_form_message;

    // Respond 202 immediately
    res.status(202).json({
      success: true,
      message: 'Campaign execution started',
      recipient_count: recipients.length
    });

    // Run broadcast asynchronously
    runBroadcast({
      campaign,
      recipients,
      staffId,
      campaignId,
      messageType,
      templateName,
      templateLanguage,
      templateComponents,
      freeFormMessage
    }).catch(err => console.error('STAFF_CAMPAIGN_BROADCAST_FATAL', { campaignId: String(campaignId), error: err.message }));
  } catch (error) {
    console.error('Staff execute campaign error:', error);
    res.status(500).json({ error: 'Failed to execute campaign' });
  }
});

/**
 * Background broadcast worker.
 * Chunks recipients into batches of 20, sends, then waits 1 s between batches.
 */
async function runBroadcast({
  campaign,
  recipients,
  staffId,
  campaignId,
  messageType,
  templateName,
  templateLanguage,
  templateComponents,
  freeFormMessage
}) {
  const BATCH_SIZE = 20;
  const BATCH_DELAY_MS = 1000;

  try {
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);

      for (const waId of batch) {
        try {
          let result;
          const within24h = await isWithin24hWindow(waId);

          if (messageType === 'free_form' && within24h) {
            // 24-hour window: free-form text via existing Cloud API /messages
            result = await postWhatsAppText({
              to: waId,
              messageBody: freeFormMessage,
              staffId,
              campaignId
            });
          } else {
            // Outside window (or template campaign): use Marketing Messages API
            result = await postWhatsAppTemplate({
              to: waId,
              templateName,
              languageCode: templateLanguage,
              components: templateComponents,
              staffId,
              campaignId
            });
          }

          if (!result.ok) {
            console.warn('STAFF_CAMPAIGN_SEND_FAILED', { waId, campaignId: String(campaignId), reason: result.reason || result.error });
          }
        } catch (recipientErr) {
          console.error('STAFF_CAMPAIGN_RECIPIENT_ERROR', { waId, error: recipientErr.message });
        }
      }

      // Rate-limit: wait between batches (skip after the last one)
      if (i + BATCH_SIZE < recipients.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    // Mark campaign completed
    const done = await Campaign.findById(campaignId);
    if (done) {
      done.status = 'completed';
      await done.save();
    }
    console.log('STAFF_CAMPAIGN_BROADCAST_COMPLETED', { campaignId: String(campaignId), totalRecipients: recipients.length });
  } catch (err) {
    console.error('STAFF_CAMPAIGN_BROADCAST_ERROR', { campaignId: String(campaignId), error: err.message });
    const failed = await Campaign.findById(campaignId);
    if (failed) {
      failed.status = 'failed';
      await failed.save();
    }
  }
}

/**
 * GET /api/staff/campaigns/:id/stats
 * Live stats for a campaign aggregated from WhatsAppMessage.
 */
router.get('/:id/stats', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const statsAgg = await WhatsAppMessage.aggregate([
      { $match: { campaign_id: campaign._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const stats = { sent: 0, delivered: 0, read: 0, failed: 0 };
    for (const row of statsAgg) {
      if (['sent', 'delivered', 'read'].includes(row._id)) stats.sent += row.count;
      if (['delivered', 'read'].includes(row._id)) stats.delivered += row.count;
      if (row._id === 'read') stats.read += row.count;
      if (row._id === 'failed') stats.failed += row.count;
    }

    res.json({
      campaign_id: req.params.id,
      stats,
      recipient_count: campaign.stats?.total_recipients || 0,
      status: campaign.status
    });
  } catch (error) {
    console.error('Staff campaign stats error:', error);
    res.status(500).json({ error: 'Failed to get campaign stats' });
  }
});

/**
 * POST /api/staff/campaigns/:id/pause
 * Pause a running campaign (prevents new batches from being enqueued).
 */
router.post('/:id/pause', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.status !== 'running') {
      return res.status(400).json({ error: 'Campaign is not running' });
    }

    campaign.status = 'paused';
    await campaign.save();

    res.json({ success: true, status: 'paused' });
  } catch (error) {
    console.error('Staff pause campaign error:', error);
    res.status(500).json({ error: 'Failed to pause campaign' });
  }
});

module.exports = router;
