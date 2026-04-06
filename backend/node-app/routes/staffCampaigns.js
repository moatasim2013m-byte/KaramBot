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
const User = require('../models/User');
const TemplateDefinition = require('../models/TemplateDefinition');
const { authMiddleware, staffMiddleware, staffPermissionMiddleware } = require('../middleware/auth');
const { normalizePhoneForWhatsApp, postWhatsAppText } = require('../utils/whatsappBookingConfirmation');
const { postWhatsAppTemplate } = require('../utils/whatsappMarketing');

const router = express.Router();
router.use(authMiddleware, staffMiddleware);
router.use(staffPermissionMiddleware('access_whatsapp_campaigns'));

const WINDOW_MS = 24 * 60 * 60 * 1000;

async function isWithin24hWindow(waId) {
  const cutoff = new Date(Date.now() - WINDOW_MS);
  const msg = await WhatsAppMessage.findOne({
    sender_wa_id: waId,
    direction: 'inbound',
    timestamp: { $gte: cutoff }
  }).sort({ timestamp: -1 });
  return !!msg;
}

async function buildAudience(audienceFilters) {
  const {
    has_booking,
    has_active_subscription,
    last_message_after,
    last_message_before,
    profile_name_contains
  } = audienceFilters || {};

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

  let contacts = contactAgg;
  if (profile_name_contains) {
    const needle = profile_name_contains.toLowerCase();
    contacts = contacts.filter(c => (c.profile_name || '').toLowerCase().includes(needle));
  }

  if (has_booking) {
    const linkedUserIds = contacts.map(c => c.linked_user_id).filter(Boolean);
    const [hourlyUserIds, birthdayUserIds] = await Promise.all([
      HourlyBooking.distinct('user_id', { user_id: { $in: linkedUserIds } }),
      BirthdayBooking.distinct('user_id', { user_id: { $in: linkedUserIds } })
    ]);
    const bookedSet = new Set([...hourlyUserIds.map(String), ...birthdayUserIds.map(String)]);
    contacts = contacts.filter(c => c.linked_user_id && bookedSet.has(String(c.linked_user_id)));
  }

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

  // Exclude opted-out users (Meta compliance)
  const rawPhones = contacts.map(c => c._id).filter(Boolean);
  const optedOutUsers = await User.find(
    { whatsapp_opted_out_at: { $ne: null }, phone: { $in: rawPhones } },
    { phone: 1 }
  ).lean();
  const optedOutSet = new Set(optedOutUsers.map(u => String(u.phone)));

  return contacts
    .map(c => ({
      wa_id: normalizePhoneForWhatsApp(c._id),
      profile_name: c.profile_name || '',
      linked_user_id: c.linked_user_id || null,
      last_inbound_at: c.last_inbound_at || null
    }))
    .filter(c => c.wa_id && !optedOutSet.has(c.wa_id));
}

function getExcludedWaIds(campaign) {
  const excluded = campaign?.metadata?.excluded_wa_ids;
  if (!Array.isArray(excluded)) return [];
  return excluded.map(waId => normalizePhoneForWhatsApp(waId)).filter(Boolean);
}

// POST / — create campaign
router.post('/', async (req, res) => {
  try {
    const {
      name, message_type, template_name, template_language,
      template_components, free_form_message, audience_filters,
      scheduled_at, ttl_hours
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Campaign name is required' });
    if (!message_type || !['template', 'free_form'].includes(message_type))
      return res.status(400).json({ error: 'message_type must be "template" or "free_form"' });
    if (message_type === 'template' && !template_name)
      return res.status(400).json({ error: 'template_name is required for template campaigns' });
    if (message_type === 'free_form' && !free_form_message)
      return res.status(400).json({ error: 'free_form_message is required for free_form campaigns' });
    if (ttl_hours !== undefined && ttl_hours !== null && ttl_hours !== '') {
      const ttlNum = Number(ttl_hours);
      if (isNaN(ttlNum) || ttlNum < 12 || ttlNum > 720)
        return res.status(400).json({ error: 'ttl_hours must be between 12 and 720' });
    }

    const campaign = new Campaign({
      name,
      template_name: template_name || null,
      audience_filter: { segment: 'custom' },
      allow_24h_window: message_type === 'free_form',
      created_by: req.user._id,
      status: 'draft',
      scheduled_at: scheduled_at || null,
      metadata: {
        message_type,
        template_language: template_language || 'ar',
        template_components: template_components || [],
        free_form_message: free_form_message || null,
        audience_filters: audience_filters || {},
        ttl_hours: ttl_hours ? Number(ttl_hours) : null
      }
    });

    await campaign.save();
    res.status(201).json({
      success: true,
      campaign: { id: campaign._id, name: campaign.name, status: campaign.status, message_type, created_at: campaign.createdAt }
    });
  } catch (error) {
    console.error('Staff create campaign error:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// GET / — list campaigns
router.get('/', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = status;

    const [campaigns, total] = await Promise.all([
      Campaign.find(query).sort({ createdAt: -1 })
        .skip((parseInt(page) - 1) * parseInt(limit)).limit(parseInt(limit)).lean(),
      Campaign.countDocuments(query)
    ]);

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
      ttl_hours: c.metadata?.ttl_hours || null,
      live_stats: statsMap[String(c._id)] || { sent: 0, delivered: 0, read: 0, failed: 0 }
    }));

    res.json({ campaigns: result, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    console.error('Staff list campaigns error:', error);
    res.status(500).json({ error: 'Failed to list campaigns' });
  }
});

// GET /preview — must be before /:id
router.get('/preview', async (req, res) => {
  try {
    const { has_booking, has_active_subscription, last_message_after, last_message_before } = req.query;
    const audienceFilters = {
      has_booking: has_booking === 'true',
      has_active_subscription: has_active_subscription === 'true',
      last_message_after: last_message_after || null,
      last_message_before: last_message_before || null
    };
    const recipients = await buildAudience(audienceFilters);
    res.json({ estimated_recipients: recipients.length, filters_applied: audienceFilters });
  } catch (error) {
    console.error('Campaign preview error:', error);
    res.status(500).json({ error: 'Failed to estimate audience' });
  }
});

// GET /:id/recipients — list campaign audience with exclusion flags
router.get('/:id/recipients', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const recipients = await buildAudience(campaign.metadata?.audience_filters || {});
    const excludedSet = new Set(getExcludedWaIds(campaign));

    const result = recipients.map(recipient => ({
      ...recipient,
      excluded: excludedSet.has(recipient.wa_id)
    }));

    res.json({
      campaign_id: req.params.id,
      recipient_count: result.length,
      excluded_count: result.filter(r => r.excluded).length,
      recipients: result
    });
  } catch (error) {
    console.error('Campaign recipients list error:', error);
    res.status(500).json({ error: 'Failed to list campaign recipients' });
  }
});

// DELETE /:id/recipients/:waId — exclude one recipient from campaign
router.delete('/:id/recipients/:waId', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!['draft', 'paused'].includes(campaign.status)) {
      return res.status(400).json({ error: 'Can only remove recipients for draft or paused campaigns' });
    }

    const waId = normalizePhoneForWhatsApp(req.params.waId);
    if (!waId) return res.status(400).json({ error: 'Invalid WhatsApp number' });

    campaign.metadata = campaign.metadata || {};
    const existing = new Set(getExcludedWaIds(campaign));
    existing.add(waId);
    campaign.metadata.excluded_wa_ids = Array.from(existing);
    campaign.markModified('metadata');
    await campaign.save();

    res.json({ success: true, campaign_id: req.params.id, excluded_wa_ids: campaign.metadata.excluded_wa_ids });
  } catch (error) {
    console.error('Campaign recipient exclusion error:', error);
    res.status(500).json({ error: 'Failed to remove recipient from campaign' });
  }
});

// GET /:id — single campaign
router.get('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

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

// POST /:id/execute
router.post('/:id/execute', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!['draft', 'paused'].includes(campaign.status))
      return res.status(400).json({ error: 'Campaign already executed or running' });

    const audienceFilters = campaign.metadata?.audience_filters || {};
    const allRecipients = await buildAudience(audienceFilters);
    const excludedSet = new Set(getExcludedWaIds(campaign));
    const recipients = allRecipients.map(r => r.wa_id).filter(waId => !excludedSet.has(waId));
    if (recipients.length === 0)
      return res.status(400).json({ error: 'No valid recipients found for this campaign' });

    // Validate template is approved before firing
    const messageType = campaign.metadata?.message_type;
    if (messageType === 'template') {
      const tplName = campaign.template_name;
      if (!tplName) return res.status(400).json({ error: 'Template campaign has no template name set' });
      const templateDoc = await TemplateDefinition.findOne({ name: tplName });
      if (!templateDoc) return res.status(400).json({
        error: `Template "${tplName}" not found. Register it first via POST /api/templates.`
      });
      if (templateDoc.status !== 'approved') return res.status(400).json({
        error: `Template "${tplName}" status is "${templateDoc.status}". Only approved templates can be sent.`
      });
    }

    // Lock campaign
    campaign.status = 'running';
    campaign.stats = campaign.stats || {};
    campaign.stats.total_recipients = recipients.length;
    campaign.metadata = campaign.metadata || {};
    campaign.metadata.executed_at = new Date();
    campaign.markModified('metadata');
    await campaign.save();

    const staffId = req.user._id;
    const campaignId = campaign._id;
    const templateName = campaign.template_name;
    const templateLanguage = campaign.metadata.template_language || 'ar';
    const templateComponents = campaign.metadata.template_components || [];
    const freeFormMessage = campaign.metadata.free_form_message;
    const ttlHours = campaign.metadata.ttl_hours || null;

    res.status(202).json({ success: true, message: 'Campaign execution started', recipient_count: recipients.length });

    runBroadcast({ campaign, recipients, staffId, campaignId, messageType, templateName, templateLanguage, templateComponents, freeFormMessage, ttlHours })
      .catch(err => console.error('STAFF_CAMPAIGN_BROADCAST_FATAL', { campaignId: String(campaignId), error: err.message }));
  } catch (error) {
    console.error('Staff execute campaign error:', error);
    res.status(500).json({ error: 'Failed to execute campaign' });
  }
});

async function runBroadcast({ campaign, recipients, staffId, campaignId, messageType, templateName, templateLanguage, templateComponents, freeFormMessage, ttlHours }) {
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
            result = await postWhatsAppText({ to: waId, messageBody: freeFormMessage, staffId, campaignId });
          } else {
            result = await postWhatsAppTemplate({
              to: waId, templateName, languageCode: templateLanguage,
              components: templateComponents, staffId, campaignId,
              ttl_seconds: ttlHours ? ttlHours * 3600 : null
            });
          }
          if (!result.ok) console.warn('STAFF_CAMPAIGN_SEND_FAILED', { waId, campaignId: String(campaignId), reason: result.reason || result.error });
        } catch (recipientErr) {
          console.error('STAFF_CAMPAIGN_RECIPIENT_ERROR', { waId, error: recipientErr.message });
        }
      }
      if (i + BATCH_SIZE < recipients.length) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
    const done = await Campaign.findById(campaignId);
    if (done) { done.status = 'completed'; await done.save(); }
    console.log('STAFF_CAMPAIGN_BROADCAST_COMPLETED', { campaignId: String(campaignId), totalRecipients: recipients.length });
  } catch (err) {
    console.error('STAFF_CAMPAIGN_BROADCAST_ERROR', { campaignId: String(campaignId), error: err.message });
    const failed = await Campaign.findById(campaignId);
    if (failed) { failed.status = 'failed'; await failed.save(); }
  }
}

// GET /:id/stats
router.get('/:id/stats', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
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
    res.json({ campaign_id: req.params.id, stats, recipient_count: campaign.stats?.total_recipients || 0, status: campaign.status });
  } catch (error) {
    console.error('Staff campaign stats error:', error);
    res.status(500).json({ error: 'Failed to get campaign stats' });
  }
});

// POST /:id/pause
router.post('/:id/pause', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status !== 'running') return res.status(400).json({ error: 'Campaign is not running' });
    campaign.status = 'paused';
    await campaign.save();
    res.json({ success: true, status: 'paused' });
  } catch (error) {
    console.error('Staff pause campaign error:', error);
    res.status(500).json({ error: 'Failed to pause campaign' });
  }
});

module.exports = router;
