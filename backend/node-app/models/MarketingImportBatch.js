const mongoose = require('mongoose');

const marketingImportBatchSchema = new mongoose.Schema({
  original_filename: { type: String, required: true },
  source_type: { type: String, enum: ['csv', 'xlsx', 'manual'], default: 'csv' },
  total_rows: { type: Number, default: 0 },
  created_count: { type: Number, default: 0 },
  updated_count: { type: Number, default: 0 },
  invalid_count: { type: Number, default: 0 },
  duplicate_count: { type: Number, default: 0 },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  notes: { type: String, default: '' }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

module.exports = mongoose.model('MarketingImportBatch', marketingImportBatchSchema);
