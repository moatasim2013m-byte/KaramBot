const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password_hash: { type: String, required: true },
  name: { type: String, required: true },
  phone: { type: String },
  role: { type: String, enum: ['parent', 'admin', 'staff'], default: 'parent' },
  staff_permissions: {
    access_staff_tools: { type: Boolean, default: true },
    access_whatsapp_inbox: { type: Boolean, default: true },
    access_whatsapp_campaigns: { type: Boolean, default: true }
  },
  loyalty_points: { type: Number, default: 0 },
  is_disabled: { type: Boolean, default: false },
  email_verified: { type: Boolean, default: false },
  email_verify_token: { type: String, default: null },
  email_verify_expires: { type: Date, default: null },
  reset_token: { type: String },
  reset_token_expires: { type: Date },
  last_winback_at: { type: Date, default: null },
  created_at: { type: Date, default: Date.now },
  
  // ========== WHATSAPP MARKETING CONSENT FIELDS ==========
  
  // WhatsApp marketing opt-in status (COMPLIANCE: Required for campaigns)
  whatsapp_marketing_consent: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // Date when user provided consent
  whatsapp_consent_date: {
    type: Date,
    default: null
  },
  
  // Source of consent (for audit trail)
  whatsapp_consent_source: {
    type: String,
    enum: ['booking_signup', 'form_submission', 'manual_opt_in', 'api', null],
    default: null
  },
  
  // Opt-out timestamp (null = opted in, date = opted out)
  whatsapp_opted_out_at: {
    type: Date,
    default: null,
    index: true
  },
  
  // Last time user sent inbound WhatsApp message (for 24h window tracking)
  last_inbound_whatsapp_time: {
    type: Date,
    default: null,
    index: true
  }
});

// Remove _id from JSON responses
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.password_hash;
    delete ret.reset_token;
    delete ret.reset_token_expires;
    delete ret.email_verify_token;
    delete ret.email_verify_expires;
    return ret;
  }
});

module.exports = mongoose.model('User', userSchema);
