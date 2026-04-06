const mongoose = require('mongoose');

const birthdayBookingSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  child_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Child', required: true },
  slot_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TimeSlot', required: true },
  theme_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Theme' },
  is_custom: { type: Boolean, default: false },
  custom_request: { type: String },
  booking_code: { type: String, required: true, unique: true },
  status: { type: String, enum: ['pending', 'confirmed', 'completed', 'cancelled', 'custom_pending'], default: 'pending' },
  payment_id: { type: String },
  payment_method: { type: String, enum: ['card', 'cash', 'cliq'], default: 'card' },
  payment_status: { type: String, enum: ['paid', 'pending_cash', 'pending_cliq'], default: 'paid' },
  paid_at: { type: Date },
  amount: { type: Number },
  lineItems: [{
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    sku: { type: String },
    nameAr: { type: String },
    nameEn: { type: String },
    unitPriceJD: { type: Number },
    quantity: { type: Number },
    lineTotalJD: { type: Number }
  }],
  guest_count: { type: Number, default: 10 },
  special_notes: { type: String },
  created_at: { type: Date, default: Date.now }
});

birthdayBookingSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    ret.user_id = ret.user_id.toString();
    ret.child_id = ret.child_id.toString();
    ret.slot_id = ret.slot_id.toString();
    if (ret.theme_id) ret.theme_id = ret.theme_id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('BirthdayBooking', birthdayBookingSchema);
