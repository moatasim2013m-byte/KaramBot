const mongoose = require('mongoose');

const hourlyBookingSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  child_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Child', required: false, default: null },
  guest_child_name: { type: String, default: '' },
  child_count: { type: Number, default: 1 },
  booking_source: { type: String, enum: ['website', 'whatsapp'], default: 'website' },
  slot_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TimeSlot', required: true },
  duration_hours: { type: Number, required: true, default: 2 },
  custom_notes: { type: String, default: '' },
  qr_code: { type: String, required: true },
  booking_code: { type: String, required: true, unique: true },
  status: { type: String, enum: ['pending', 'confirmed', 'checked_in', 'completed', 'cancelled'], default: 'pending' },
  check_in_time: { type: Date },
  session_end_time: { type: Date },
  payment_id: { type: String },
  payment_method: { type: String, enum: ['card', 'cash', 'cliq'], default: 'card' },
  payment_status: { type: String, enum: ['paid', 'pending_cash', 'pending_cliq'], default: 'paid' },
  paid_at: { type: Date },
  amount: { type: Number, required: true },
  subtotal_amount: { type: Number },
  discount_amount: { type: Number, default: 0 },
  coupon_code: { type: String },
  lineItems: [{
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    sku: { type: String },
    nameAr: { type: String },
    nameEn: { type: String },
    unitPriceJD: { type: Number },
    quantity: { type: Number },
    lineTotalJD: { type: Number }
  }],
  created_at: { type: Date, default: Date.now }
});

hourlyBookingSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    ret.user_id = ret.user_id.toString();
    ret.child_id = ret.child_id ? ret.child_id.toString() : null;
    ret.slot_id = ret.slot_id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('HourlyBooking', hourlyBookingSchema);
