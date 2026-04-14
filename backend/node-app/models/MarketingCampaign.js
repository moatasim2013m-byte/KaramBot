const mongoose = require('mongoose');

const marketingCampaignSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  template_name: { type: String, required: true },
  language_code: { type: String, default: 'ar' },
  template_components: { type: Array, default: [] },
  audience_type: { type: String, enum: ['all', 'tags', 'imported_batch', 'selected_contacts', 'query'], default: 'all' },
  audience_filter: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: {
    type: String,
    enum: ['draft', 'queued', 'running', 'paused', 'completed', 'failed', 'canceled'],
    default: 'draft',
    index: true
  },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  approved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  scheduled_at: { type: Date, default: null, index: true },
  started_at: { type: Date, default: null },
  completed_at: { type: Date, default: null },
  total_recipients: { type: Number, default: 0 },
  sent_count: { type: Number, default: 0 },
  delivered_count: { type: Number, default: 0 },
  read_count: { type: Number, default: 0 },
  failed_count: { type: Number, default: 0 },
  skipped_opted_out_count: { type: Number, default: 0 },
  skipped_no_opt_in_count: { type: Number, default: 0 },
  skipped_invalid_count: { type: Number, default: 0 },
  last_error: { type: String, default: '' }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

module.exports = mongoose.model('MarketingCampaign', marketingCampaignSchema);
