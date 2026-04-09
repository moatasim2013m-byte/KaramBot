const mongoose = require('mongoose');

const aiFaqMemorySchema = new mongoose.Schema(
  {
    category: { type: String, trim: true, default: '' },
    intent_key: { type: String, trim: true, default: '' },
    question_variants: { type: [String], default: [] },
    approved_answer_ar: { type: String, required: true, trim: true },
    short_facts: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    source: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: ['draft', 'approved', 'archived'],
      default: 'draft',
      index: true
    },
    priority: { type: Number, default: 0, index: true },
    usage_count: { type: Number, default: 0 },
    last_used_at: { type: Date, default: null }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

aiFaqMemorySchema.index({ status: 1, category: 1, intent_key: 1, priority: -1 });

module.exports = mongoose.model('AIFaqMemory', aiFaqMemorySchema);
