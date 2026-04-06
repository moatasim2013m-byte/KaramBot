const mongoose = require('mongoose');

const userSubscriptionSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  child_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Child', required: true },
  plan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
  remaining_visits: { type: Number, required: true },
  expires_at: { type: Date }, // null until first check-in
  first_checkin_at: { type: Date }, // when subscription was activated
  payment_id: { type: String },
  payment_method: { type: String, enum: ['card', 'cash', 'cliq'], default: 'card' },
  payment_status: { type: String, enum: ['paid', 'pending_cash', 'pending_cliq'], default: 'paid' },
  paid_at: { type: Date },
  status: { type: String, enum: ['pending', 'active', 'expired', 'consumed'], default: 'pending' },
  created_at: { type: Date, default: Date.now }
});

userSubscriptionSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    ret.user_id = ret.user_id.toString();
    ret.child_id = ret.child_id.toString();
    ret.plan_id = ret.plan_id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('UserSubscription', userSubscriptionSchema);
