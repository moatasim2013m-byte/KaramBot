const mongoose = require('mongoose');

const hourlyBookingSchema = new mongoose.Schema({
  // user_id is optional for guest checkouts (is_guest_booking: true).
  // All authenticated bookings continue to have a user_id set.
  // The validator below enforces this at the document layer.
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    default: null,
    validate: {
      validator: function (v) {
        // user_id is required unless this is explicitly a guest booking.
        return this.is_guest_booking === true || v != null;
      },
      message: 'user_id is required for non-guest bookings'
    }
  },
  // Guest booking flag — set to true when the booking was made without an account.
  is_guest_booking: { type: Boolean, default: false },
  // Guest contact fields — only populated when is_guest_booking is true.
  guest_parent_name: { type: String, default: '' },
  guest_parent_phone: { type: String, default: '' },
  guest_parent_email: { type: String, default: '' },
  // child_id is now optional — WhatsApp walk-in bookings may not have a registered child.
  // When null, `guest_child_name` carries the name the customer gave over chat.
  child_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Child', default: null },
  guest_child_name: { type: String, default: '' },
  child_count: { type: Number, default: 1, min: 1, max: 20 },
  booking_source: { type: String, enum: ['website', 'whatsapp'], default: 'website', index: true },
  // Service type — determines pricing table, capacity rules, and booking_code prefix.
  // 'main_area'  → existing hourly play (PK-H-* booking codes, hourly_* pricing keys)
  // 'daycare'    → day care service (PK-D-* booking codes, daycare_* pricing keys)
  // Defaults to 'main_area' so all pre-existing bookings remain classified correctly.
  service_type: { type: String, enum: ['main_area', 'daycare'], default: 'main_area', index: true },
  slot_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TimeSlot', required: true },
  duration_hours: { type: Number, required: true, default: 2 },
  custom_notes: { type: String, default: '' },
  qr_code: { type: String, required: true },
  booking_code: { type: String, required: true, unique: true },
  // Secure scanner token — separate from human booking_code. 32 random bytes hex.
  // Sparse + unique so legacy bookings without qr_token don't collide.
  qr_token: { type: String, unique: true, sparse: true, index: true },
  qr_status: { type: String, enum: ['unused', 'checked_in', 'expired', 'cancelled'], default: 'unused', index: true },
  qr_checked_in_at: { type: Date },
  qr_checked_in_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Phase 3 — loyalty earn marker. Set ONCE when points are successfully
  // awarded on check-in. The unique compound index in LoyaltyLedger
  // (userId, refType, refId) is the canonical duplicate guard; this field
  // is a fast booking-level marker for admin views and idempotent retries.
  loyalty_awarded_at: { type: Date, default: null, index: true },
  loyalty_points_awarded: { type: Number, default: 0, min: 0 },
  loyalty_award_skipped_reason: { type: String, default: null },
  // Phase 6 — loyalty redemption marker. Set ONCE when a negative
  // ledger entry is successfully posted for this booking. The
  // LoyaltyLedger unique compound index on (userId, refType, refId)
  // remains the canonical duplicate guard; these fields are fast
  // booking-level markers for admin views and idempotent retries.
  // refId used for redemption is `redeem:<bookingId>` so it never
  // collides with the earn entry that uses `<bookingId>` directly.
  loyalty_redeemed_points: { type: Number, default: 0, min: 0 },
  loyalty_redemption_jd: { type: Number, default: 0, min: 0 },
  loyalty_redeemed_at: { type: Date, default: null, index: true },
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
    // user_id is null for guest bookings — guard before calling toString().
    ret.user_id = ret.user_id ? ret.user_id.toString() : null;
    // child_id is optional — guard against null guest bookings.
    ret.child_id = ret.child_id ? ret.child_id.toString() : null;
    ret.slot_id = ret.slot_id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('HourlyBooking', hourlyBookingSchema);
