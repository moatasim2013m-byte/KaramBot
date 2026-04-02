const mongoose = require('mongoose');

/**
 * CampaignBroadcast Model - Individual Broadcast Execution Record
 * 
 * COMPLIANCE NOTES:
 * - Each execution creates a separate broadcast record
 * - recipients array tracks individual send status for audit
 * - audit_log maintains append-only compliance trail
 * - All consent validations and 24h window checks logged
 */

const campaignBroadcastSchema = new mongoose.Schema({
  // Reference to parent campaign
  campaign_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true,
    index: true
  },
  
  // Broadcast sequence number (1st, 2nd, 3rd execution of same campaign)
  broadcast_number: {
    type: Number,
    required: true,
    default: 1
  },
  
  // Execution status
  status: {
    type: String,
    enum: ['queued', 'in_progress', 'completed', 'failed', 'cancelled'],
    default: 'queued',
    index: true
  },
  
  // Execution timeline
  started_at: {
    type: Date,
    default: null
  },
  
  completed_at: {
    type: Date,
    default: null
  },
  
  // Recipient tracking (detailed per-user status)
  recipients: [{
    phone: {
      type: String,
      required: true
    },
    wa_id: {
      type: String,
      required: true
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    
    // Compliance checks
    consent_verified: {
      type: Boolean,
      default: false
    },
    last_inbound_time: {
      type: Date,
      default: null
    },
    within_24h_window: {
      type: Boolean,
      default: false
    },
    
    // Send status
    status: {
      type: String,
      enum: ['pending', 'queued', 'sent', 'delivered', 'read', 'failed', 'opted_out', 'skipped'],
      default: 'pending'
    },
    
    // WhatsApp message reference
    whatsapp_message_id: {
      type: String, // References WhatsAppMessage.message_id
      default: null
    },
    
    // Template info
    template_used: {
      type: Boolean,
      default: false
    },
    template_id: {
      type: String,
      default: null
    },
    
    // Variables injected (for audit)
    variables_injected: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    
    // Error tracking
    error_reason: {
      type: String,
      default: null
    },
    meta_error_code: {
      type: String,
      default: null
    },
    
    // Delivery timeline
    sent_at: {
      type: Date,
      default: null
    },
    delivered_at: {
      type: Date,
      default: null
    },
    read_at: {
      type: Date,
      default: null
    },
    
    // Rate limiting
    retry_count: {
      type: Number,
      default: 0
    },
    next_retry_at: {
      type: Date,
      default: null
    }
  }],
  
  // Aggregate counters (updated as broadcast progresses)
  total_recipients: {
    type: Number,
    default: 0
  },
  total_sent: {
    type: Number,
    default: 0
  },
  total_delivered: {
    type: Number,
    default: 0
  },
  total_failed: {
    type: Number,
    default: 0
  },
  total_read: {
    type: Number,
    default: 0
  },
  total_opted_out: {
    type: Number,
    default: 0
  },
  total_skipped: {
    type: Number,
    default: 0
  },
  
  // Compliance audit trail (append-only log)
  audit_log: [{
    timestamp: {
      type: Date,
      default: Date.now
    },
    event: String, // 'broadcast_started', 'message_sent', 'consent_check', 'window_validation', etc.
    wa_id: String,
    details: String,
    status: String, // 'success', 'failed', 'warning'
    metadata: mongoose.Schema.Types.Mixed
  }]
}, {
  timestamps: true
});

// Indexes for queries
campaignBroadcastSchema.index({ campaign_id: 1, broadcast_number: 1 });
campaignBroadcastSchema.index({ status: 1, started_at: -1 });
campaignBroadcastSchema.index({ 'recipients.status': 1 });
campaignBroadcastSchema.index({ 'recipients.wa_id': 1 });

// Instance method: Add audit log entry
campaignBroadcastSchema.methods.addAuditLog = function(event, details, status = 'success', wa_id = null, metadata = {}) {
  this.audit_log.push({
    timestamp: new Date(),
    event,
    wa_id,
    details,
    status,
    metadata
  });
};

// Instance method: Update recipient status
campaignBroadcastSchema.methods.updateRecipientStatus = function(wa_id, status, updates = {}) {
  const recipient = this.recipients.find(r => r.wa_id === wa_id);
  if (recipient) {
    recipient.status = status;
    Object.assign(recipient, updates);
    
    // Update counters
    this.recalculateCounters();
  }
};

// Instance method: Recalculate aggregate counters
campaignBroadcastSchema.methods.recalculateCounters = function() {
  this.total_sent = this.recipients.filter(r => r.status === 'sent' || r.status === 'delivered' || r.status === 'read').length;
  this.total_delivered = this.recipients.filter(r => r.status === 'delivered' || r.status === 'read').length;
  this.total_read = this.recipients.filter(r => r.status === 'read').length;
  this.total_failed = this.recipients.filter(r => r.status === 'failed').length;
  this.total_opted_out = this.recipients.filter(r => r.status === 'opted_out').length;
  this.total_skipped = this.recipients.filter(r => r.status === 'skipped').length;
};

// Instance method: Mark as completed
campaignBroadcastSchema.methods.markCompleted = function() {
  this.status = 'completed';
  this.completed_at = new Date();
  this.recalculateCounters();
  this.addAuditLog('broadcast_completed', `Broadcast finished: ${this.total_sent} sent, ${this.total_failed} failed`);
};

// Static method: Get broadcasts needing retry
campaignBroadcastSchema.statics.getPendingRetries = function() {
  return this.find({
    status: 'in_progress',
    'recipients.next_retry_at': { $lte: new Date() },
    'recipients.status': 'queued'
  });
};

module.exports = mongoose.model('CampaignBroadcast', campaignBroadcastSchema);
