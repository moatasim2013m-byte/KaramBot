const mongoose = require('mongoose');

const quickReplySchema = new mongoose.Schema({
  // Template name/label
  label: {
    type: String,
    required: true,
    trim: true
  },
  
  // Message content
  message: {
    type: String,
    required: true
  },
  
  // Platform compatibility
  platform: {
    type: String,
    enum: ['whatsapp', 'instagram', 'facebook', 'telegram', 'all'],
    default: 'all'
  },
  
  // Category for organization
  category: {
    type: String,
    enum: ['greeting', 'booking', 'payment', 'inquiry', 'closing', 'other'],
    default: 'other'
  },
  
  // Staff member who created it
  created_by_staff_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Usage tracking
  usage_count: {
    type: Number,
    default: 0
  },
  
  // Active status
  is_active: {
    type: Boolean,
    default: true
  },
  
  // Display order
  sort_order: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for efficient queries
quickReplySchema.index({ platform: 1, is_active: 1, sort_order: 1 });
quickReplySchema.index({ created_by_staff_id: 1 });

module.exports = mongoose.model('QuickReply', quickReplySchema);
