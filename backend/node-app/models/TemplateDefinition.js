const mongoose = require('mongoose');

/**
 * TemplateDefinition Model - Meta-Approved WhatsApp Message Templates
 * 
 * COMPLIANCE NOTES:
 * - Synced from Meta Business Manager API
 * - Only 'approved' templates can be used in campaigns
 * - Variables must match exactly what Meta has approved
 * - Templates outside 24h window MUST be used for marketing
 */

const templateDefinitionSchema = new mongoose.Schema({
  // Meta template identifier (unique per template)
  meta_template_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Human-readable name
  name: {
    type: String,
    required: true,
    index: true
  },
  
  // Template approval status from Meta
  status: {
    type: String,
    enum: ['approved', 'pending_review', 'rejected', 'disabled', 'paused'],
    default: 'pending_review',
    index: true
  },
  
  // Language code (e.g., 'en_US', 'ar_SA', 'en_GB')
  language: {
    type: String,
    required: true,
    default: 'en_US'
  },
  
  // Template category (determines usage rules)
  category: {
    type: String,
    enum: ['marketing', 'utility', 'authentication'],
    required: true,
    index: true
  },
  
  // Template body with variable placeholders
  // Example: "Hello {{1}}, your booking for {{2}} is confirmed."
  body_text: {
    type: String,
    required: true
  },
  
  // Extracted variable names (parsed from body_text)
  // Example: ['customer_name', 'booking_date']
  variables: [{
    name: String,
    type: {
      type: String,
      enum: ['text', 'currency', 'date_time', 'image', 'document', 'video'],
      default: 'text'
    },
    example: String // Example value from Meta
  }],
  
  // Optional header component
  header_type: {
    type: String,
    enum: ['text', 'image', 'document', 'video', 'location', null],
    default: null
  },
  
  header_text: {
    type: String,
    default: null
  },
  
  header_variables: [{
    name: String,
    type: String
  }],
  
  // Optional footer (small text at bottom)
  footer_text: {
    type: String,
    default: null
  },
  
  // Call-to-action buttons (optional)
  buttons: [{
    type: {
      type: String,
      enum: ['quick_reply', 'url', 'phone_number']
    },
    text: String,
    url: String, // For url type
    phone_number: String // For phone_number type
  }],
  
  // Meta quality rating (affects delivery rate)
  quality_score: {
    type: String,
    enum: ['high', 'medium', 'low', 'unknown'],
    default: 'unknown'
  },
  
  // If rejected, reason from Meta
  rejected_reason: {
    type: String,
    default: null
  },
  
  // Sync metadata
  synced_from_meta_at: {
    type: Date,
    default: null
  },
  
  last_sync_status: {
    type: String,
    enum: ['success', 'failed', 'pending'],
    default: 'pending'
  },
  
  // Usage statistics
  usage_count: {
    type: Number,
    default: 0
  },
  
  last_used_at: {
    type: Date,
    default: null
  },
  
  // Meta WABA (WhatsApp Business Account) ID
  waba_id: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Indexes
templateDefinitionSchema.index({ status: 1, category: 1 });
templateDefinitionSchema.index({ language: 1, category: 1 });
templateDefinitionSchema.index({ waba_id: 1 });

// Instance method: Check if template can be used
templateDefinitionSchema.methods.canUse = function() {
  return this.status === 'approved';
};

// Instance method: Extract variable count
templateDefinitionSchema.methods.getVariableCount = function() {
  return this.variables.length;
};

// Instance method: Validate variable values
templateDefinitionSchema.methods.validateVariables = function(variableValues) {
  const errors = [];
  
  for (const variable of this.variables) {
    if (!variableValues.hasOwnProperty(variable.name)) {
      errors.push(`Missing variable: ${variable.name}`);
    }
  }
  
  return errors.length === 0 ? null : errors;
};

// Static method: Get usable templates
templateDefinitionSchema.statics.getApproved = function(category = null) {
  const query = { status: 'approved' };
  if (category) {
    query.category = category;
  }
  return this.find(query).sort({ name: 1 });
};

// Static method: Find by Meta ID
templateDefinitionSchema.statics.findByMetaId = function(metaTemplateId) {
  return this.findOne({ meta_template_id: metaTemplateId });
};

// Instance method: Increment usage
templateDefinitionSchema.methods.incrementUsage = function() {
  this.usage_count += 1;
  this.last_used_at = new Date();
  return this.save();
};

module.exports = mongoose.model('TemplateDefinition', templateDefinitionSchema);
