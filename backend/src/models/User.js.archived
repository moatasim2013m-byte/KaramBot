const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },
  role: {
    type: String,
    enum: ['platform_admin', 'business_owner', 'manager', 'staff'],
    default: 'staff',
  },
  // null for platform_admin
  business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null },
  active: { type: Boolean, default: true },
  last_login: Date,
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
