const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  customer_wa_id: { type: String, required: true }, // phone number
  profile_name: String,
  status: {
    type: String,
    enum: ['open', 'pending', 'resolved', 'human_takeover'],
    default: 'open',
  },
  assigned_staff_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  last_message_at: { type: Date, default: Date.now },
  unread_count: { type: Number, default: 0 },
  ai_enabled: { type: Boolean, default: true },

  // Workflow state machine
  current_workflow_type: {
    type: String,
    enum: ['idle', 'order_taking', 'appointment_booking', 'product_inquiry', 'complaint', null],
    default: null,
  },
  current_state: { type: String, default: null }, // e.g. 'collecting_items', 'confirming_order'
  workflow_data: { type: mongoose.Schema.Types.Mixed, default: {} }, // cart, draft order, etc.

  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

// Unique conversation per business + customer
conversationSchema.index({ business_id: 1, customer_wa_id: 1 }, { unique: true });

module.exports = mongoose.model('Conversation', conversationSchema);
