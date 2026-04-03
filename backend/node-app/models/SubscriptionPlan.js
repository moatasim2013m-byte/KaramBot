const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema({
  name: { type: String, required: true },
  name_ar: { type: String },
  description: { type: String },
  description_ar: { type: String },
  visits: { type: Number, required: true },
  price: { type: Number, required: true },
  duration_hours: { type: Number, default: 0 },
  duration_minutes: { type: Number, default: 0 },
  includes: { type: [String], default: [] },
  time_slots: { type: [String], default: [] },
  is_daily_pass: { type: Boolean, default: false },
  valid_days: { type: [String], default: [] }, // ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday']
  is_active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now }
});

// Optimize common read path for public subscriptions page
subscriptionPlanSchema.index({ is_active: 1, price: 1 });

subscriptionPlanSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
