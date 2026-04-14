const mongoose = require('mongoose');

const marketingCampaignRecipientSchema = new mongoose.Schema({
  campaign_id: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketingCampaign', required: true, index: true },
  marketing_contact_id: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketingContact', required: true },
  normalized_wa_id: { type: String, required: true },
  template_name: { type: String, required: true },
  language_code: { type: String, default: 'ar' },
  status: {
    type: String,
    enum: ['queued', 'sent', 'delivered', 'read', 'failed', 'skipped_opted_out', 'skipped_no_opt_in', 'skipped_invalid'],
    default: 'queued',
    index: true
  },
  meta_message_id: { type: String, default: null, index: true },
  error_code: { type: String, default: '' },
  error_message: { type: String, default: '' },
  sent_at: { type: Date, default: null },
  delivered_at: { type: Date, default: null },
  read_at: { type: Date, default: null },
  failed_at: { type: Date, default: null },
  response_snapshot: { type: mongoose.Schema.Types.Mixed, default: null }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

marketingCampaignRecipientSchema.index({ campaign_id: 1, normalized_wa_id: 1 }, { unique: true });

module.exports = mongoose.model('MarketingCampaignRecipient', marketingCampaignRecipientSchema);
