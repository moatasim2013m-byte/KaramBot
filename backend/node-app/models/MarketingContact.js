const mongoose = require('mongoose');

const marketingContactSchema = new mongoose.Schema({
  full_name: { type: String, default: '' },
  phone_raw: { type: String, default: '' },
  normalized_wa_id: { type: String, required: true, index: true },
  child_name: { type: String, default: '' },
  source: { type: String, default: 'manual' },
  tags: [{ type: String }],
  segment: [{ type: String }],
  language_code: { type: String, default: 'ar' },
  has_whatsapp_opt_in: { type: Boolean, default: false, index: true },
  consent_source: { type: String, default: '' },
  consent_note: { type: String, default: '' },
  whatsapp_opted_out_at: { type: Date, default: null, index: true },
  last_marketing_sent_at: { type: Date, default: null },
  last_marketing_campaign_id: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketingCampaign', default: null },
  import_batch_id: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketingImportBatch', default: null, index: true },
  is_active: { type: Boolean, default: true },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

marketingContactSchema.index({ normalized_wa_id: 1 }, { unique: true });
marketingContactSchema.index({ tags: 1 });
marketingContactSchema.index({ segment: 1 });

module.exports = mongoose.model('MarketingContact', marketingContactSchema);
