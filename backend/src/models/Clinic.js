const mongoose = require('mongoose');

// ─── Service ──────────────────────────────────────────────────────────────────
const serviceSchema = new mongoose.Schema({
  business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  name_ar: { type: String, required: true },
  name_en: String,
  duration_minutes: { type: Number, default: 30 },
  price: Number,
  active: { type: Boolean, default: true },
}, { timestamps: true });

// ─── Doctor ────────────────────────────────────────────────────────────────────
const doctorSchema = new mongoose.Schema({
  business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  name_ar: { type: String, required: true },
  name_en: String,
  specialty_ar: String,
  services: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
  active: { type: Boolean, default: true },
}, { timestamps: true });

// ─── Appointment Slot ─────────────────────────────────────────────────────────
const appointmentSlotSchema = new mongoose.Schema({
  business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  doctor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' },
  service_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
  start_time: Date,
  end_time: Date,
  is_booked: { type: Boolean, default: false },
}, { timestamps: true });

// ─── Appointment ──────────────────────────────────────────────────────────────
const appointmentSchema = new mongoose.Schema({
  business_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  conversation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
  customer_wa_id: String,
  customer_name: String,
  customer_phone: String,
  doctor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' },
  service_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
  slot_id: { type: mongoose.Schema.Types.ObjectId, ref: 'AppointmentSlot' },
  scheduled_at: Date,
  status: {
    type: String,
    enum: ['draft', 'confirmed', 'cancelled', 'completed'],
    default: 'draft',
  },
  notes: String,
}, { timestamps: true });

module.exports = {
  Service: mongoose.model('Service', serviceSchema),
  Doctor: mongoose.model('Doctor', doctorSchema),
  AppointmentSlot: mongoose.model('AppointmentSlot', appointmentSlotSchema),
  Appointment: mongoose.model('Appointment', appointmentSchema),
};
