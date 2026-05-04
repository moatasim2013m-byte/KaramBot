const mongoose = require('mongoose');

const timeSlotSchema = new mongoose.Schema({
  date: { type: String, required: true }, // YYYY-MM-DD format
  start_time: { type: String, required: true }, // HH:mm format (24h)
  slot_type: { type: String, enum: ['hourly', 'birthday', 'daycare'], required: true },
  capacity: { type: Number, default: 25 },
  booked_count: { type: Number, default: 0 },
  is_active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now }
});

// Compound index for unique slots
timeSlotSchema.index({ date: 1, start_time: 1, slot_type: 1 }, { unique: true });

timeSlotSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('TimeSlot', timeSlotSchema);
