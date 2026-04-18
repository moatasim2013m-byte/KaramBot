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
const CampaignBroadcast = require('../models/CampaignBroadcast');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const HourlyBooking = require('../models/HourlyBooking');
const BirthdayBooking = require('../models/BirthdayBooking');
const UserSubscription = require('../models/UserSubscription');
const User = require('../models/User');
const TemplateDefinition = require('../models/TemplateDefinition');
const { authMiddleware, staffMiddleware, staffPermissionMiddleware } = require('../middleware/auth');
const { normalizePhoneForWhatsApp, postWhatsAppText } = require('../utils/whatsappBookingConfirmation');
const { postWhatsAppTemplate } = require('../utils/whatsappMarketing');
const { phoneLookupFormats } = require('../utils/whatsappOptOut');

const router = express.Router();
router.use(authMiddleware, staffMiddleware);
router.use(staffPermissionMiddleware('access_whatsapp_campaigns'));

const MANUAL_BULK_MAX_RECIPIENTS = 1000;
const MANUAL_BULK_SEND_DELAY_MS = 250;

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
  // Use phoneLookupFormats for multi-format matching (same logic as isWhatsAppOptedOut)
  const rawPhones = contacts.map(c => c._id).filter(Boolean);
  const allOptOutVariants = rawPhones.flatMap(p => phoneLookupFormats(p));
  const optedOutUsers = await User.find(
    { whatsapp_opted_out_at: { $ne: null }, phone: { $in: allOptOutVariants } },
    { phone: 1 }
  ).lean();
  const optedOutNormalized = new Set();
  for (const u of optedOutUsers) {
    const norm = normalizePhoneForWhatsApp(u.phone);
    if (norm) optedOutNormalized.add(norm);
  }

  // Exclude recipients without explicit marketing consent (Meta compliance)
  const consentedUsers = await User.find(
    { whatsapp_marketing_consent: true, whatsapp_opted_out_at: null },
    { _id: 1 }
  ).lean();
  const consentedIdSet = new Set(consentedUsers.map(u => String(u._id)));

  return contacts
    .map(c => ({
      wa_id: normalizePhoneForWhatsApp(c._id),
      profile_name: c.profile_name || '',
      linked_user_id: c.linked_user_id || null,
      last_inbound_at: c.last_inbound_at || null
    }))
    .filter(c => c.wa_id && !optedOutNormalized.has(c.wa_id) && c.linked_user_id && consentedIdSet.has(String(c.linked_user_id)));
}

function getExcludedWaIds(campaign) {
  const excluded = campaign?.metadata?.excluded_wa_ids;
  if (!Array.isArray(excluded)) return [];
  return excluded.map(waId => normalizePhoneForWhatsApp(waId)).filter(Boolean);
}

function extractRawRecipientValue(recipient) {
  if (typeof recipient === 'string' || typeof recipient === 'number') return String(recipient);
  if (recipient && typeof recipient === 'object') {
    if (recipient.wa_id !== undefined && recipient.wa_id !== null) return String(recipient.wa_id);
    if (recipient.phone !== undefined && recipient.phone !== null) return String(recipient.phone);
  }
  return '';
}

function normalizeTemplateParams(templateParams) {
  if (!Array.isArray(templateParams)) return [];
  return templateParams.map(value => String(value ?? '').trim());
}

function buildBodyComponentsFromParams(templateParams) {
  return [{
    type: 'body',
    parameters: templateParams.map(value => ({ type: 'text', text: value }))
  }];
}

// Background runner for manual-bulk-send (fires after 202 response)
async function runManualBulkSend({ broadcastId, campaignId, validRecipients, templateName, languageCode, components, staffId }) {
  const BATCH_SIZE = 20;
  const BATCH_DELAY_MS = 500;

  let broadcast;
  try {
    broadcast = await CampaignBroadcast.findById(broadcastId);
    if (!broadcast) {
      console.error('MANUAL_BULK_SEND_BG_NO_BROADCAST', { broadcastId: String(broadcastId) });
      return;
    }
    broadcast.status = 'in_progress';
    broadcast.started_at = new Date();
    broadcast.addAuditLog('broadcast_started', `Sending ${validRecipients.length} recipients, template: ${templateName}`);
    await broadcast.save();
  } catch (initErr) {
    console.error('MANUAL_BULK_SEND_BG_INIT_ERROR', { broadcastId: String(broadcastId), error: initErr.message });
    return;
  }

  try {
    for (let i = 0; i < validRecipients.length; i += BATCH_SIZE) {
      const batch = validRecipients.slice(i, i + BATCH_SIZE);

      for (const { waId } of batch) {
        try {
          const result = await postWhatsAppTemplate({
            to: waId,
            templateName,
            languageCode,
            components,
            staffId
          });

          if (result.ok) {
            broadcast.updateRecipientStatus(waId, 'sent', {
              whatsapp_message_id: result.messageId || null,
              sent_at: new Date(),
              template_used: true
            });
          } else if (result.skipped && (result.reason === 'opted_out' || result.reason === 'opt_out_check_failed')) {
            broadcast.updateRecipientStatus(waId, 'opted_out', {
              error_reason: result.reason
            });
          } else {
            broadcast.updateRecipientStatus(waId, 'failed', {
              error_reason: result.reason || result.error || 'send_failed',
              meta_error_code: result.status ? String(result.status) : null
            });
          }
        } catch (sendErr) {
          broadcast.updateRecipientStatus(waId, 'failed', {
            error_reason: sendErr.message || 'exception'
          });
        }
      }

      // Persist progress after each batch
      try {
        broadcast.recalculateCounters();
        await broadcast.save();
      } catch (saveErr) {
        console.error('MANUAL_BULK_SEND_BG_SAVE_ERROR', { broadcastId: String(broadcastId), batch: i, error: saveErr.message });
      }

      if (i + BATCH_SIZE < validRecipients.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    broadcast.markCompleted();
    await broadcast.save();

    // Update parent campaign status
    try {
      await Campaign.findByIdAndUpdate(campaignId, { status: 'completed' });
    } catch (_) { /* non-critical */ }

    console.log('MANUAL_BULK_SEND_BG_COMPLETED', {
      broadcastId: String(broadcastId),
      sent: broadcast.total_sent,
      failed: broadcast.total_failed,
      opted_out: broadcast.total_opted_out,
      skipped: broadcast.total_skipped
    });
  } catch (fatalErr) {
    console.error('MANUAL_BULK_SEND_BG_FATAL', { broadcastId: String(broadcastId), error: fatalErr.message });
    try {
      broadcast.status = 'failed';
      broadcast.completed_at = new Date();
      broadcast.addAuditLog('broadcast_failed', fatalErr.message, 'failed');
      broadcast.recalculateCounters();
      await broadcast.save();
      await Campaign.findByIdAndUpdate(campaignId, { status: 'cancelled' });
    } catch (_) { /* best effort */ }
  }
}

// POST /manual-bulk-send — async: returns 202 immediately, sends in background
router.post('/manual-bulk-send', async (req, res) => {
  try {
    const {
      template_name,
      template_language,
      template_params,
      header_image_url,
      recipients
    } = req.body || {};

    if (!template_name || !String(template_name).trim()) {
      return res.status(400).json({ error: 'template_name is required' });
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'recipients must be a non-empty array' });
    }

    if (recipients.length > MANUAL_BULK_MAX_RECIPIENTS) {
      return res.status(400).json({
        error: `Maximum ${MANUAL_BULK_MAX_RECIPIENTS} recipients allowed per manual send`
      });
    }

    const templateDoc = await TemplateDefinition.findOne({ name: String(template_name).trim() }).lean();
    if (!templateDoc) {
      return res.status(400).json({
        error: `Template "${template_name}" not found. Register it first via POST /api/templates.`
      });
    }
    if (templateDoc.status !== 'approved') {
      return res.status(400).json({
        error: `Template "${template_name}" status is "${templateDoc.status}". Only approved templates can be sent.`
      });
    }
    if (templateDoc.category !== 'marketing') {
      return res.status(400).json({
        error: `Template "${template_name}" category is "${templateDoc.category}". Only marketing templates can be used for bulk marketing sends.`
      });
    }

    const normalizedTemplateParams = normalizeTemplateParams(template_params);
    const requiredParamsCount = Array.isArray(templateDoc.variables) ? templateDoc.variables.length : 0;
    if (requiredParamsCount > 0 && normalizedTemplateParams.length < requiredParamsCount) {
      return res.status(400).json({
        error: `Missing required template params: expected ${requiredParamsCount}, received ${normalizedTemplateParams.length}`
      });
    }

    if (requiredParamsCount > 0 && normalizedTemplateParams.slice(0, requiredParamsCount).some(value => !value)) {
      return res.status(400).json({ error: 'template_params contains empty required values' });
    }

    const components = requiredParamsCount > 0
      ? buildBodyComponentsFromParams(normalizedTemplateParams.slice(0, requiredParamsCount))
      : [];

    // Add header image component if template has image header and URL provided
    if (header_image_url && String(header_image_url).trim()) {
      components.unshift({
        type: 'header',
        parameters: [{ type: 'image', image: { link: String(header_image_url).trim() } }]
      });
    } else if (templateDoc.header_type === 'image') {
      return res.status(400).json({ error: 'This template requires a header_image_url' });
    }

    // Build consented phone set — mirrors /bulk-send consent enforcement
    const consentedUsers = await User.find(
      { whatsapp_marketing_consent: true, whatsapp_opted_out_at: null },
      { phone: 1 }
    ).lean();
    const consentedPhoneSet = new Set();
    for (const u of consentedUsers) {
      const norm = normalizePhoneForWhatsApp(u.phone);
      if (norm) consentedPhoneSet.add(norm);
    }

    // Normalize, deduplicate, and separate invalid recipients
    const seenWaIds = new Set();
    const validRecipients = [];
    const skippedRecipients = [];

    for (const recipient of recipients) {
      const original = extractRawRecipientValue(recipient);
      const waId = normalizePhoneForWhatsApp(original);

      if (!waId) {
        skippedRecipients.push({ phone: original, wa_id: '', status: 'skipped', error_reason: 'invalid_phone_format' });
        continue;
      }

      if (seenWaIds.has(waId)) continue; // deduplicate silently
      seenWaIds.add(waId);

      if (!consentedPhoneSet.has(waId)) {
        skippedRecipients.push({ phone: original, wa_id: waId, status: 'skipped_no_consent', error_reason: 'no_marketing_consent' });
        continue;
      }

      validRecipients.push({ waId, original });
    }

    if (validRecipients.length === 0) {
      return res.status(400).json({ error: 'No valid phone numbers after normalization' });
    }

    // Create lightweight Campaign as parent for the broadcast
    const campaign = await new Campaign({
      name: `manual_bulk_${Date.now()}`,
      template_name: String(template_name).trim(),
      created_by: req.user._id,
      status: 'active',
      metadata: {
        message_type: 'template',
        manual_bulk: true,
        template_language: template_language || templateDoc.language || 'ar',
        template_components: components
      }
    }).save();

    // Create CampaignBroadcast with valid recipients seeded as 'pending'
    const broadcastRecipients = validRecipients.map(({ waId, original }) => ({
      phone: original,
      wa_id: waId,
      status: 'pending',
      template_used: true,
      template_id: templateDoc.meta_template_id || null
    }));

    const broadcast = await new CampaignBroadcast({
      campaign_id: campaign._id,
      broadcast_number: 1,
      status: 'queued',
      total_recipients: validRecipients.length,
      recipients: broadcastRecipients
    }).save();

    // Return 202 immediately
    res.status(202).json({
      success: true,
      broadcast_id: broadcast._id,
      campaign_id: campaign._id,
      template_name: String(template_name).trim(),
      recipient_count: validRecipients.length,
      skipped_invalid: skippedRecipients.length,
      status: 'queued',
      poll_url: `/api/staff/campaigns/manual-bulk-send/${broadcast._id}`
    });

    // Fire background send after response is flushed
    setImmediate(() => {
      runManualBulkSend({
        broadcastId: broadcast._id,
        campaignId: campaign._id,
        validRecipients,
        templateName: String(template_name).trim(),
        languageCode: template_language || templateDoc.language || 'ar',
        components,
        staffId: req.user._id
      }).catch(err => console.error('MANUAL_BULK_SEND_SETIMMEDIATE_ERROR', err.message));
    });
  } catch (error) {
    console.error('Staff manual bulk send error:', error);
    res.status(500).json({ error: 'Failed to initiate manual bulk send' });
  }
});

// GET /manual-bulk-send/:broadcastId — poll progress of a background manual bulk send
router.get('/manual-bulk-send/:broadcastId', async (req, res) => {
  try {
    const broadcast = await CampaignBroadcast.findById(req.params.broadcastId).lean();
    if (!broadcast) {
      return res.status(404).json({ error: 'Broadcast not found' });
    }

    res.json({
      broadcast_id: broadcast._id,
      campaign_id: broadcast.campaign_id,
      status: broadcast.status,
      started_at: broadcast.started_at,
      completed_at: broadcast.completed_at,
      summary: {
        total_recipients: broadcast.total_recipients,
        sent: broadcast.total_sent,
        delivered: broadcast.total_delivered,
        failed: broadcast.total_failed,
        opted_out: broadcast.total_opted_out,
        skipped: broadcast.total_skipped,
        pending: (broadcast.recipients || []).filter(r => r.status === 'pending').length
      },
      recipients: (broadcast.recipients || []).map(r => ({
        wa_id: r.wa_id,
        status: r.status,
        whatsapp_message_id: r.whatsapp_message_id || null,
        error_reason: r.error_reason || null,
        sent_at: r.sent_at || null
      }))
    });
  } catch (error) {
    console.error('Manual bulk send status error:', error);
    res.status(500).json({ error: 'Failed to get broadcast status' });
  }
});

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

// POST /bulk-send — DB-neutral manual bulk template send (max 1000 recipients)
// No new DB models, no campaign state, no queue/cron/scheduler.
// Sends sequentially in small batches and returns per-recipient results synchronously.
router.post('/bulk-send', async (req, res) => {
  const BULK_BATCH_SIZE = 20;
  const BULK_BATCH_DELAY_MS = 500;
  const MAX_RECIPIENTS = 1000;

  try {
    const { template_name, language_code, components, ttl_hours, recipients } = req.body;

    // Extract header image from components if present (for templates with image headers)
    let headerImageUrl = null;
    const tplComponents = Array.isArray(components) ? components.filter(c => {
      if (c.type === 'header' && c.parameters?.[0]?.type === 'image') {
        headerImageUrl = c.parameters[0].image?.link || null;
        return true;
      }
      return true;
    }) : [];

    // --- Validation ---
    if (!template_name || typeof template_name !== 'string' || !template_name.trim()) {
      return res.status(400).json({ error: 'template_name is required' });
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'recipients array is required and must not be empty' });
    }
    if (recipients.length > MAX_RECIPIENTS) {
      return res.status(400).json({ error: `Maximum ${MAX_RECIPIENTS} recipients per run. Received: ${recipients.length}` });
    }
    if (ttl_hours !== undefined && ttl_hours !== null && ttl_hours !== '') {
      const ttlNum = Number(ttl_hours);
      if (isNaN(ttlNum) || ttlNum < 12 || ttlNum > 720) {
        return res.status(400).json({ error: 'ttl_hours must be between 12 and 720' });
      }
    }

    // Validate template exists and is approved
    const templateDoc = await TemplateDefinition.findOne({ name: template_name.trim() });
    if (!templateDoc) {
      return res.status(400).json({ error: `Template "${template_name.trim()}" not found. Register or sync it first.` });
    }
    if (templateDoc.status !== 'approved') {
      return res.status(400).json({ error: `Template "${template_name.trim()}" status is "${templateDoc.status}". Only approved templates can be sent.` });
    }
    if (templateDoc.category !== 'marketing') {
      return res.status(400).json({ error: `Template "${template_name.trim()}" category is "${templateDoc.category}". Only marketing templates can be used for bulk marketing sends.` });
    }

    // Normalize, deduplicate, and categorize recipients
    const seen = new Set();
    const validRecipients = [];
    const results = [];

    for (const raw of recipients) {
      const phone = String(raw || '').trim();
      if (!phone) continue;
      const normalized = normalizePhoneForWhatsApp(phone);
      if (!normalized) {
        results.push({ phone, normalized_phone: null, status: 'skipped_invalid', reason: 'invalid_phone_format' });
        continue;
      }
      if (seen.has(normalized)) continue; // deduplicate silently
      seen.add(normalized);
      validRecipients.push({ phone, normalized });
    }

    if (validRecipients.length === 0) {
      return res.status(400).json({ error: 'No valid phone numbers after normalization', results });
    }

    // Build consent lookup: only send to recipients with explicit marketing consent
    // Use phoneLookupFormats for consistent multi-format matching
    const allPhoneVariants = validRecipients.flatMap(({ normalized }) => phoneLookupFormats(normalized));
    const consentedUsers = await User.find({
      phone: { $in: allPhoneVariants },
      whatsapp_marketing_consent: true,
      whatsapp_opted_out_at: null
    }).select('phone').lean();
    const consentedPhoneSet = new Set();
    for (const u of consentedUsers) {
      const norm = normalizePhoneForWhatsApp(u.phone);
      if (norm) consentedPhoneSet.add(norm);
    }

    // Send in small sequential batches using existing postWhatsAppTemplate
    const staffId = req.user._id;
    const langCode = (language_code || 'ar').trim();
    const ttlSeconds = ttl_hours ? Number(ttl_hours) * 3600 : null;

    for (let i = 0; i < validRecipients.length; i += BULK_BATCH_SIZE) {
      const batch = validRecipients.slice(i, i + BULK_BATCH_SIZE);

      for (const { phone, normalized } of batch) {
        // Skip recipients without explicit marketing consent
        if (!consentedPhoneSet.has(normalized)) {
          results.push({ phone, normalized_phone: normalized, status: 'skipped_no_consent', reason: 'no_marketing_consent' });
          continue;
        }
        try {
          const result = await postWhatsAppTemplate({
            to: normalized,
            templateName: template_name.trim(),
            languageCode: langCode,
            components: tplComponents,
            staffId,
            ttl_seconds: ttlSeconds
          });

          if (result.ok) {
            results.push({ phone, normalized_phone: normalized, status: 'sent', messageId: result.messageId || null });
          } else if (result.skipped && (result.reason === 'opted_out' || result.reason === 'opt_out_check_failed')) {
            results.push({ phone, normalized_phone: normalized, status: 'skipped_opted_out', reason: result.reason });
          } else if (result.reason === 'missing_config') {
            results.push({ phone, normalized_phone: normalized, status: 'failed', reason: 'whatsapp_not_configured' });
          } else {
            results.push({ phone, normalized_phone: normalized, status: 'failed', reason: result.error || result.reason || 'api_error' });
          }
        } catch (sendErr) {
          results.push({ phone, normalized_phone: normalized, status: 'failed', reason: sendErr.message || 'exception' });
        }
      }

      // Small delay between batches to avoid rate-limit spikes
      if (i + BULK_BATCH_SIZE < validRecipients.length) {
        await new Promise(resolve => setTimeout(resolve, BULK_BATCH_DELAY_MS));
      }
    }

    // Build summary
    const summary = {
      total: results.length,
      sent: results.filter(r => r.status === 'sent').length,
      skipped_opted_out: results.filter(r => r.status === 'skipped_opted_out').length,
      skipped_no_consent: results.filter(r => r.status === 'skipped_no_consent').length,
      skipped_invalid: results.filter(r => r.status === 'skipped_invalid').length,
      failed: results.filter(r => r.status === 'failed').length
    };

    if (!res.headersSent) {
      res.json({ success: true, template_name: template_name.trim(), summary, results });
    }
  } catch (error) {
    console.error('Bulk send error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Bulk send failed', details: error.message });
    }
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
      if (templateDoc.category !== 'marketing') return res.status(400).json({
        error: `Template "${tplName}" category is "${templateDoc.category}". Only marketing templates can be used for campaign sends.`
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
      // Re-check campaign status each batch — stop if paused/cancelled externally
      if (i > 0) {
        const current = await Campaign.findById(campaignId).select('status').lean();
        if (!current || current.status !== 'running') {
          console.log('STAFF_CAMPAIGN_BROADCAST_STOPPED', { campaignId: String(campaignId), stoppedAtIndex: i, reason: current?.status || 'not_found' });
          return;
        }
      }

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
    // Only mark completed if still running (respect external pause/cancel)
    const done = await Campaign.findById(campaignId);
    if (done && done.status === 'running') { done.status = 'completed'; await done.save(); }
    console.log('STAFF_CAMPAIGN_BROADCAST_COMPLETED', { campaignId: String(campaignId), totalRecipients: recipients.length });
  } catch (err) {
    console.error('STAFF_CAMPAIGN_BROADCAST_ERROR', { campaignId: String(campaignId), error: err.message });
    try {
      const failed = await Campaign.findById(campaignId);
      if (failed && failed.status === 'running') { failed.status = 'failed'; await failed.save(); }
    } catch (dbErr) {
      console.error('STAFF_CAMPAIGN_STATUS_UPDATE_FAILED', { campaignId: String(campaignId), error: dbErr.message });
    }
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
