const mongoose = require('mongoose');

/**
 * Campaign Model - WhatsApp Marketing Campaign Management
 * 
 * COMPLIANCE NOTES:
 * - template_id MUST reference approved Meta template (enforced in routes)
 * - require_consent=true enforces opt-in validation before send
 * - allow_24h_window enables free-form messages within customer service window
 * - All sends logged to audit trail via CampaignBroadcast
 */

const campaignSchema = new mongoose.Schema({
  // Campaign identification
  name: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  
  description: {
    type: String,
    default: ''
  },
  
  // Meta WhatsApp Template Configuration
  template_id: {
    type: String,
    default: null, // null = free-form only (24h window required)
    index: true
  },
  
  template_name: {
    type: String,
    default: null
  },
  
  template_category: {
    type: String,
    enum: ['marketing', 'utility', 'authentication', null],
    default: null
  },
  
  // Template variable definitions
  template_variables: [{
    name: String,      // e.g., 'customer_name'
    type: String,      // e.g., 'text', 'currency', 'date_time'
    required: Boolean,
    default: true
  }],
  
  // Audience targeting
  audience_filter: {
    segment: {
      type: String,
      enum: ['all', 'active_bookings', 'high_value', 'expired_subs', 'custom'],
      default: 'all'
    },
    tags: [String],
    exclude_tags: [String],
    phone_numbers: [String], // Manual phone list (optional)
    created_after: Date,
    created_before: Date
  },
  
  // Variable mapping for personalization
  // Maps template variables to user/booking fields
  // Example: {customer_name: 'user.name', booking_date: 'booking.slot_id.date'}
  personalization: {
    type: Map,
    of: String,
    default: {}
  },
  
  // Compliance flags
  require_consent: {
    type: Boolean,
    default: true // COMPLIANCE: Must be true for marketing campaigns
  },
  
  allow_24h_window: {
    type: Boolean,
    default: false // If true, can send free-form messages within 24h window
  },
  
  // Campaign lifecycle
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled'],
    default: 'draft',
    index: true
  },
  
  scheduled_at: {
    type: Date,
    default: null,
    index: true
  },
  
  // Ownership
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Statistics (updated by broadcast executions)
  stats: {
    total_recipients: {
      type: Number,
      default: 0
    },
    queued: {
      type: Number,
      default: 0
    },
    sent: {
      type: Number,
      default: 0
    },
    delivered: {
      type: Number,
      default: 0
    },
    failed: {
      type: Number,
      default: 0
    },
    read: {
      type: Number,
      default: 0
    },
    opted_out: {
      type: Number,
      default: 0
    }
  },
  
  // Extension point
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true // Adds createdAt and updatedAt
});

// Indexes for performance
campaignSchema.index({ created_by: 1, status: 1 });
campaignSchema.index({ scheduled_at: 1, status: 1 });
campaignSchema.index({ 'audience_filter.segment': 1 });

// Virtual for broadcast count
campaignSchema.virtual('broadcast_count', {
  ref: 'CampaignBroadcast',
  localField: '_id',
  foreignField: 'campaign_id',
  count: true
});

// Instance method: Check if campaign is editable
campaignSchema.methods.isEditable = function() {
  return this.status === 'draft';
};

// Instance method: Check if campaign can be executed
campaignSchema.methods.canExecute = function() {
  return ['draft', 'scheduled', 'paused'].includes(this.status);
};

// Instance method: Validate template required
campaignSchema.methods.requiresTemplate = function() {
  return !this.allow_24h_window || this.template_id !== null;
};

// Static method: Get campaigns needing execution
campaignSchema.statics.getPendingScheduled = function() {
  return this.find({
    status: 'scheduled',
    scheduled_at: { $lte: new Date() }
  });
};

module.exports = mongoose.model('Campaign', campaignSchema);
