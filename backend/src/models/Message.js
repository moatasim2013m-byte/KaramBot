const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  conversation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  meta_message_id: { type: String, unique: true, sparse: true }, // idempotency
  direction: { type: String, enum: ['inbound', 'outbound'], required: true },
  message_type: {
    type: String,
    enum: ['text', 'image', 'audio', 'video', 'document', 'location', 'interactive', 'template', 'sticker', 'reaction'],
    default: 'text',
  },
  text_body: String,
  media_id: String,
  media_mime_type: String,
  media_url: String,
  interactive_reply: mongoose.Schema.Types.Mixed, // button/list reply payload
  location: {
    latitude: Number,
    longitude: Number,
    name: String,
    address: String,
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
    default: 'pending',
  },
  sender_wa_id: String,
  sent_by_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  is_ai_generated: { type: Boolean, default: false },
  raw_payload: { type: mongoose.Schema.Types.Mixed },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

module.exports = mongoose.model('Message', messageSchema);
