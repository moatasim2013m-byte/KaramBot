const mongoose = require('mongoose');

const openingHourSchema = new mongoose.Schema({
  day: { type: Number, min: 0, max: 6 }, // 0=Sun
  open: String,  // "09:00"
  close: String, // "23:00"
  closed: { type: Boolean, default: false },
}, { _id: false });

const businessSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  business_type: {
    type: String,
    enum: ['restaurant', 'clinic', 'retail', 'custom'],
    default: 'restaurant',
  },
  logo_url: String,
  language_default: { type: String, default: 'ar' },
  timezone: { type: String, default: 'Asia/Amman' },
  currency: { type: String, default: 'JOD' },
  address: String,

  // WhatsApp Cloud API credentials (store encrypted in production)
  wa_phone_number_id: { type: String, required: true },
  wa_business_account_id: String,
  wa_access_token: { type: String, select: false }, // never expose in queries by default

  opening_hours: [openingHourSchema],

  status: { type: String, enum: ['active', 'inactive'], default: 'active' },

  // AI & bot config
  ai_config: {
    enabled: { type: Boolean, default: true },
    provider: { type: String, default: 'gemini' },
    personality: { type: String, default: 'مساعد ودود ومحترف' },
    greeting_message: { type: String, default: 'أهلاً وسهلاً! كيف أقدر أساعدك اليوم؟ 😊' },
    fallback_message: { type: String, default: 'سأحولك إلى أحد موظفينا الآن.' },
    handoff_keywords: { type: [String], default: ['موظف', 'انسان', 'مدير', 'مشكلة'] },
    confidence_threshold: { type: Number, default: 0.6 },
    out_of_hours_message: { type: String, default: 'نحن حالياً خارج أوقات العمل. سنرد عليك قريباً.' },
  },

  // Business rules
  policies: {
    order_confirmation_message: String,
    cancellation_policy: String,
    delivery_policy: String,
    payment_methods: { type: [String], default: ['cash'] },
    delivery_fee: { type: Number, default: 0 },
    min_order_amount: { type: Number, default: 0 },
    free_delivery_above: Number,
  },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

module.exports = mongoose.model('Business', businessSchema);
