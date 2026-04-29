const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  menu_item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
  name_ar: String,
  name_en: String,
  quantity: { type: Number, required: true, min: 1 },
  unit_price: { type: Number, required: true },
  modifiers: [{
    group_name_ar: String,
    option_name_ar: String,
    price_delta: Number,
  }],
  item_total: Number,
  notes: String,
}, { _id: false });

const orderSchema = new mongoose.Schema({
  business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  conversation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  customer_wa_id: { type: String, required: true },
  customer_name: String,
  customer_phone: String,

  items: [orderItemSchema],
  subtotal: { type: Number, default: 0 },
  delivery_fee: { type: Number, default: 0 },
  total: { type: Number, default: 0 },

  order_type: { type: String, enum: ['delivery', 'pickup'], default: 'delivery' },
  address: String,
  location: {
    latitude: Number,
    longitude: Number,
  },
  notes: String,

  status: {
    type: String,
    enum: ['draft', 'awaiting_confirmation', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'],
    default: 'draft',
  },
  payment_method: {
    type: String,
    enum: ['cash', 'card_link', 'cliq', 'unknown'],
    default: 'cash',
  },
  payment_status: {
    type: String,
    enum: ['pending', 'paid', 'refunded'],
    default: 'pending',
  },

  confirmed_at: Date,
  status_history: [{
    status: String,
    changed_at: { type: Date, default: Date.now },
    changed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  }],
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

module.exports = mongoose.model('Order', orderSchema);
