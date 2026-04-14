const mongoose = require('mongoose');
const MarketingContact = require('../models/MarketingContact');
const MarketingCampaign = require('../models/MarketingCampaign');
const MarketingCampaignRecipient = require('../models/MarketingCampaignRecipient');
const TemplateDefinition = require('../models/TemplateDefinition');
const User = require('../models/User');
const { logger } = require('./logger');
const { normalizePhoneForWhatsApp } = require('./whatsappBookingConfirmation');
const { postWhatsAppTemplate } = require('./whatsappMarketing');
const { isWhatsAppOptedOut, setWhatsAppOptOut } = require('./whatsappOptOut');

const DEFAULT_BATCH_SIZE = Math.max(1, Number(process.env.MARKETING_BATCH_SIZE || 40));
const DEFAULT_DELAY_MS = Math.max(0, Number(process.env.MARKETING_BATCH_DELAY_MS || 2000));

let runnerStarted = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeTextList = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || '')
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const getAudienceQuery = (campaign) => {
  const query = { is_active: true };
  const filter = campaign?.audience_filter || {};

  if (campaign.audience_type === 'imported_batch' && filter.import_batch_id && mongoose.Types.ObjectId.isValid(filter.import_batch_id)) {
    query.import_batch_id = filter.import_batch_id;
  }

  if (campaign.audience_type === 'tags') {
    const tags = normalizeTextList(filter.tags);
    if (tags.length) query.tags = { $in: tags };

    const segments = normalizeTextList(filter.segment);
    if (segments.length) query.segment = { $in: segments };
  }

  if (campaign.audience_type === 'selected_contacts') {
    const ids = Array.isArray(filter.contact_ids) ? filter.contact_ids.filter((id) => mongoose.Types.ObjectId.isValid(id)) : [];
    query._id = { $in: ids };
  }

  if (campaign.audience_type === 'query') {
    if (typeof filter.has_whatsapp_opt_in === 'boolean') query.has_whatsapp_opt_in = filter.has_whatsapp_opt_in;
    if (filter.q) {
      query.$or = [
        { full_name: { $regex: String(filter.q), $options: 'i' } },
        { phone_raw: { $regex: String(filter.q), $options: 'i' } },
        { normalized_wa_id: { $regex: String(filter.q), $options: 'i' } }
      ];
    }
  }

  return query;
};

const verifyTemplate = async (templateName) => {
  if (!templateName) return false;

  const template = await TemplateDefinition.findOne({ name: templateName }).lean();
  if (!template) return false;
  return template.status === 'approved';
};

const createRecipientsForCampaign = async (campaign) => {
  const query = getAudienceQuery(campaign);
  const contacts = await MarketingContact.find(query).select('_id normalized_wa_id has_whatsapp_opt_in whatsapp_opted_out_at').lean();
  if (!contacts.length) return { total: 0 };

  const docs = contacts.map((contact) => ({
    campaign_id: campaign._id,
    marketing_contact_id: contact._id,
    normalized_wa_id: contact.normalized_wa_id,
    template_name: campaign.template_name,
    language_code: campaign.language_code,
    status: 'queued'
  }));

  const bulk = docs.map((doc) => ({
    updateOne: {
      filter: { campaign_id: doc.campaign_id, normalized_wa_id: doc.normalized_wa_id },
      update: { $setOnInsert: doc },
      upsert: true
    }
  }));

  const result = await MarketingCampaignRecipient.bulkWrite(bulk, { ordered: false });
  const total = Number(result.upsertedCount || 0);

  await MarketingCampaign.updateOne({ _id: campaign._id }, { $set: { total_recipients: contacts.length } });
  return { total: contacts.length, inserted: total };
};

const incrementCampaignCounter = async (campaignId, field) => {
  if (!field) return;
  await MarketingCampaign.updateOne({ _id: campaignId }, { $inc: { [field]: 1 } });
};

const processRecipient = async (campaign, recipient) => {
  const contact = await MarketingContact.findById(recipient.marketing_contact_id).lean();
  if (!contact || !contact.is_active) {
    await MarketingCampaignRecipient.updateOne({ _id: recipient._id }, { $set: { status: 'skipped_invalid', failed_at: new Date(), error_message: 'inactive_or_missing_contact' } });
    await incrementCampaignCounter(campaign._id, 'skipped_invalid_count');
    return;
  }

  const waId = normalizePhoneForWhatsApp(contact.normalized_wa_id || contact.phone_raw);
  if (!waId) {
    await MarketingCampaignRecipient.updateOne({ _id: recipient._id }, { $set: { status: 'skipped_invalid', failed_at: new Date(), error_message: 'invalid_phone' } });
    await incrementCampaignCounter(campaign._id, 'skipped_invalid_count');
    return;
  }

  if (!contact.has_whatsapp_opt_in) {
    await MarketingCampaignRecipient.updateOne({ _id: recipient._id }, { $set: { status: 'skipped_no_opt_in', failed_at: new Date(), error_message: 'no_opt_in' } });
    await incrementCampaignCounter(campaign._id, 'skipped_no_opt_in_count');
    logger.info({ event: 'marketing_recipient_skipped_no_opt_in', campaign_id: campaign._id, wa_id: waId });
    return;
  }

  const optedOut = Boolean(contact.whatsapp_opted_out_at) || (await isWhatsAppOptedOut(waId)).optedOut;
  if (optedOut) {
    await MarketingCampaignRecipient.updateOne({ _id: recipient._id }, { $set: { status: 'skipped_opted_out', failed_at: new Date(), error_message: 'opted_out' } });
    await incrementCampaignCounter(campaign._id, 'skipped_opted_out_count');
    logger.info({ event: 'marketing_recipient_skipped_opted_out', campaign_id: campaign._id, wa_id: waId });
    return;
  }

  const sendResult = await postWhatsAppTemplate({
    to: waId,
    templateName: campaign.template_name,
    languageCode: campaign.language_code,
    components: campaign.template_components,
    campaignId: campaign._id
  });

  if (!sendResult.ok) {
    const isOptOut = sendResult.reason === 'opted_out' || sendResult.reason === 'opt_out_check_failed';
    const status = isOptOut ? 'skipped_opted_out' : 'failed';
    await MarketingCampaignRecipient.updateOne(
      { _id: recipient._id },
      {
        $set: {
          status,
          failed_at: new Date(),
          error_message: sendResult.error || sendResult.reason || 'send_failed',
          response_snapshot: sendResult
        }
      }
    );

    await incrementCampaignCounter(campaign._id, isOptOut ? 'skipped_opted_out_count' : 'failed_count');
    return;
  }

  const sentAt = new Date();
  await MarketingCampaignRecipient.updateOne(
    { _id: recipient._id },
    {
      $set: {
        status: 'sent',
        sent_at: sentAt,
        meta_message_id: sendResult.messageId || null,
        response_snapshot: sendResult
      }
    }
  );

  await Promise.all([
    incrementCampaignCounter(campaign._id, 'sent_count'),
    MarketingContact.updateOne(
      { _id: contact._id },
      { $set: { last_marketing_sent_at: sentAt, last_marketing_campaign_id: campaign._id, normalized_wa_id: waId } }
    )
  ]);
};

const processCampaign = async (campaignId) => {
  const campaign = await MarketingCampaign.findById(campaignId);
  if (!campaign) return;
  if (!['queued', 'running'].includes(campaign.status)) return;

  if (campaign.status === 'queued') {
    campaign.status = 'running';
    campaign.started_at = campaign.started_at || new Date();
    await campaign.save();
  }

  logger.info({ event: 'marketing_campaign_batch_started', campaign_id: campaign._id, batch_size: DEFAULT_BATCH_SIZE });

  while (true) {
    const refreshedCampaign = await MarketingCampaign.findById(campaign._id).lean();
    if (!refreshedCampaign || refreshedCampaign.status !== 'running') break;

    const recipients = await MarketingCampaignRecipient.find({ campaign_id: campaign._id, status: 'queued' })
      .sort({ created_at: 1 })
      .limit(DEFAULT_BATCH_SIZE)
      .lean();

    if (!recipients.length) {
      await MarketingCampaign.updateOne(
        { _id: campaign._id, status: 'running' },
        { $set: { status: 'completed', completed_at: new Date() } }
      );
      logger.info({ event: 'marketing_campaign_completed', campaign_id: campaign._id });
      break;
    }

    for (const recipient of recipients) {
      const latest = await MarketingCampaign.findById(campaign._id).select('status').lean();
      if (!latest || latest.status !== 'running') return;
      await processRecipient(campaign, recipient);
    }

    if (DEFAULT_DELAY_MS > 0) {
      await sleep(DEFAULT_DELAY_MS);
    }
  }
};

const runPendingCampaigns = async () => {
  const now = new Date();
  const campaigns = await MarketingCampaign.find({
    status: { $in: ['queued', 'running'] },
    $or: [{ scheduled_at: null }, { scheduled_at: { $lte: now } }]
  })
    .sort({ created_at: 1 })
    .limit(1)
    .lean();

  if (!campaigns.length) return;
  await processCampaign(campaigns[0]._id);
};

const startMarketingCampaignRunner = () => {
  if (runnerStarted) return;
  runnerStarted = true;

  setInterval(() => {
    runPendingCampaigns().catch((error) => {
      logger.error({ event: 'marketing_campaign_runner_error', error: error.message, stack: error.stack });
    });
  }, Math.max(3000, Number(process.env.MARKETING_RUNNER_POLL_MS || 7000)));

  logger.info({ event: 'marketing_campaign_runner_started' });
};

const syncOptOutForMarketingContact = async (contact, optOut) => {
  const when = optOut ? new Date() : null;
  await MarketingContact.updateOne({ _id: contact._id }, { $set: { whatsapp_opted_out_at: when } });
  await setWhatsAppOptOut(contact.normalized_wa_id, optOut);

  const phoneForms = [contact.normalized_wa_id, `+${contact.normalized_wa_id}`];
  if (contact.normalized_wa_id.startsWith('962')) {
    phoneForms.push(`0${contact.normalized_wa_id.slice(3)}`);
  }
  await User.updateMany({ phone: { $in: phoneForms } }, { $set: { whatsapp_opted_out_at: when } });
};

const syncRecipientStatusFromWebhook = async ({ messageId, status }) => {
  if (!messageId || !status) return;
  const recipient = await MarketingCampaignRecipient.findOne({ meta_message_id: messageId });
  if (!recipient) return;

  const previous = recipient.status;
  const now = new Date();
  const set = {};
  if (status === 'delivered') {
    set.status = 'delivered';
    set.delivered_at = now;
  } else if (status === 'read') {
    set.status = 'read';
    set.read_at = now;
    if (!recipient.delivered_at) set.delivered_at = now;
  } else if (status === 'failed') {
    set.status = 'failed';
    set.failed_at = now;
  } else {
    set.status = 'sent';
  }

  await MarketingCampaignRecipient.updateOne({ _id: recipient._id }, { $set: set });

  const inc = {};
  if (status === 'delivered' && !['delivered', 'read'].includes(previous)) inc.delivered_count = 1;
  if (status === 'read' && previous !== 'read') {
    inc.read_count = 1;
    if (!['delivered', 'read'].includes(previous)) inc.delivered_count = 1;
  }
  if (status === 'failed' && previous !== 'failed') inc.failed_count = 1;

  if (Object.keys(inc).length) {
    await MarketingCampaign.updateOne({ _id: recipient.campaign_id }, { $inc: inc });
  }
};

module.exports = {
  getAudienceQuery,
  createRecipientsForCampaign,
  verifyTemplate,
  startMarketingCampaignRunner,
  syncOptOutForMarketingContact,
  syncRecipientStatusFromWebhook
};
