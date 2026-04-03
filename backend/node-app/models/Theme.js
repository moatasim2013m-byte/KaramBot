const mongoose = require('mongoose');

const themeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  name_ar: { type: String },
  description: { type: String },
  description_ar: { type: String },
  price: { type: Number, required: true },
  image_url: { type: String },
  package_type: { type: String, enum: ['birthday', 'theme', null], default: null },
  includes: {
    kids_count: { type: Number },
    play_hours: { type: Number },
    meals: { type: Number },
    stands: { type: Number },
    gifts_per_kid: { type: Boolean },
    premium_gift: { type: Boolean }
  },
  is_active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now }
});

themeSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('Theme', themeSchema);
