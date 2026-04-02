const mongoose = require('mongoose');

const whatsAppMessageSchema = new mongoose.Schema({
  // Unique message identifier from WhatsApp (for duplicate protection)
  message_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Contact information
  sender_wa_id: {
    type: String,
    required: true,
    index: true
  },
  
  profile_name: {
    type: String,
    default: ''
  },
  
  // Message content
  message_type: {
    type: String,
    enum: ['text', 'image', 'audio', 'video', 'document', 'location', 'contacts', 'sticker', 'unsupported'],
    default: 'text'
  },
  
  text_body: {
    type: String,
    default: ''
  },
  
  // Media/attachment metadata (for future use)
  media_url: {
    type: String,
    default: ''
  },
  
  media_mime_type: {
    type: String,
    default: ''
  },
  
  // Direction
  direction: {
    type: String,
    enum: ['inbound', 'outbound'],
    required: true,
    index: true
  },
  
  // Status (for outbound messages)
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
    default: 'pending'
  },
  
  // Platform (for future multi-platform support)
  platform: {
    type: String,
    enum: ['whatsapp', 'instagram', 'facebook', 'telegram'],
    default: 'whatsapp',
    index: true
  },

  // WhatsApp webhook metadata (keeps our backend as source-of-truth context)
  messaging_product: {
    type: String,
    default: 'whatsapp'
  },

  business_phone_number_id: {
    type: String,
    default: ''
  },
  
  // Timestamp from WhatsApp
  timestamp: {
    type: Date,
    required: true,
    index: true
  },
  
  // Raw payload for debugging
  raw_payload: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  
  // Staff member who sent the reply (for outbound messages)
  sent_by_staff_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  // Link to customer if identified
  linked_user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  // Read status (for staff inbox)
  is_read_by_staff: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // Reply status (for tracking if staff responded)
  is_replied: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true // Adds createdAt and updatedAt
});

// Compound indexes for efficient queries
whatsAppMessageSchema.index({ sender_wa_id: 1, timestamp: -1 });
whatsAppMessageSchema.index({ platform: 1, direction: 1, timestamp: -1 });
whatsAppMessageSchema.index({ is_read_by_staff: 1, direction: 1 });

// Virtual for conversation grouping
whatsAppMessageSchema.virtual('conversation_id').get(function() {
  return `${this.platform}_${this.sender_wa_id}`;
});

// Ensure virtuals are included in JSON
whatsAppMessageSchema.set('toJSON', { virtuals: true });
whatsAppMessageSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('WhatsAppMessage', whatsAppMessageSchema);
