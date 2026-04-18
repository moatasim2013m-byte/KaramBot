/**
 * WhatsApp Booking Service — internal helpers for Gemini tool-calling
 * 
 * Used by autoReplyAi.js to check availability, find children, and create bookings
 * via WhatsApp conversation. Does NOT modify any existing routes or models.
 */

const { randomUUID } = require('crypto');
const QRCode = require('qrcode');
const TimeSlot = require('../models/TimeSlot');
const HourlyBooking = require('../models/HourlyBooking');
const Child = require('../models/Child');
const User = require('../models/User');
const Settings = require('../models/Settings');

// --- Slot generation (copied from slots.js — not exported) ---
const HOURLY_CONFIG = {
  startHour: 10,
  startMinute: 0,
  lastEntryHour: 23,
  lastEntryMinute: 0,
  intervalMinutes: 10,
  maxCapacity: 70
};

const ensureHourlySlotsForDate = async (date) => {
  const existing = await TimeSlot.find({ date, slot_type: 'hourly' }).lean();
  if (existing.length > 0) return existing;

  const slotsToCreate = [];
  let hour = HOURLY_CONFIG.startHour;
  let minute = HOURLY_CONFIG.startMinute;

  while (hour < HOURLY_CONFIG.lastEntryHour ||
    (hour === HOURLY_CONFIG.lastEntryHour && minute <= HOURLY_CONFIG.lastEntryMinute)) {
    const startTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    slotsToCreate.push({
      date,
      start_time: startTime,
      slot_type: 'hourly',
      capacity: HOURLY_CONFIG.maxCapacity,
      booked_count: 0
    });
    minute += HOURLY_CONFIG.intervalMinutes;
    if (minute >= 60) { minute = 0; hour += 1; }
  }

  try {
    const created = await TimeSlot.insertMany(slotsToCreate, { ordered: false });
    return created;
  } catch (err) {
    if (err.code === 11000) {
      return TimeSlot.find({ date, slot_type: 'hourly' }).lean();
    }
    throw err;
  }
};

// --- Pricing (mirrors bookings.js getHourlyPrice) ---
const getHourlyPrice = async (durationHours, startTime) => {
  const hours = Math.max(1, Math.min(5, Math.round(durationHours)));

  if (startTime) {
    try {
      const [startHour] = startTime.split(':').map(Number);
      if (startHour >= 10 && startHour < 14) {
        return 3.5 * hours; // Happy Hour
      }
    } catch (_) { /* fall through */ }
  }

  try {
    const pricingDocs = await Settings.find({
      key: { $in: ['hourly_1hr', 'hourly_2hr', 'hourly_3hr', 'hourly_extra_hr'] }
    }).lean();
    const prices = { hourly_1hr: 7, hourly_2hr: 10, hourly_3hr: 13, hourly_extra_hr: 3 };
    pricingDocs.forEach(p => { prices[p.key] = parseFloat(p.value); });

    if (hours === 1) return prices.hourly_1hr;
    if (hours === 2) return prices.hourly_2hr;
    if (hours === 3) return prices.hourly_3hr;
    return prices.hourly_2hr + (hours - 2) * prices.hourly_extra_hr;
  } catch (_) {
    if (hours === 1) return 7;
    if (hours === 2) return 10;
    return 10 + (hours - 2) * 3;
  }
};

// --- Phone lookup (mirrors whatsappWebhook.js normalizePhoneForLookup) ---
const normalizePhoneForLookup = (waId) => {
  const sanitized = String(waId || '').replace(/\D/g, '');
  return [
    sanitized,
    `+${sanitized}`,
    sanitized.startsWith('962') ? `0${sanitized.slice(3)}` : null,
    sanitized.startsWith('962') ? `+${sanitized}` : null
  ].filter(Boolean);
};

// =====================================================
// FUNCTION 1: Check availability for a date + time
// =====================================================
const checkAvailability = async (dateStr, startTime, durationHours = 1) => {
  try {
    const hours = Math.max(1, Math.min(3, Math.round(durationHours)));

    // Ensure slots exist
    await ensureHourlySlotsForDate(dateStr);

    // Find the exact slot
    const slot = await TimeSlot.findOne({
      date: dateStr,
      start_time: startTime,
      slot_type: 'hourly',
      is_active: true
    }).lean();

    if (!slot) {
      return { available: false, spotsLeft: 0, slotId: null, price: 0, error: 'slot_not_found' };
    }

    const spotsLeft = slot.capacity - slot.booked_count;
    const price = await getHourlyPrice(hours, startTime);

    return {
      available: spotsLeft > 0,
      spotsLeft,
      slotId: String(slot._id),
      price,
      date: dateStr,
      time: startTime,
      durationHours: hours
    };
  } catch (err) {
    console.error('WA_BOOKING_CHECK_AVAILABILITY_ERROR', err.message);
    return { available: false, spotsLeft: 0, slotId: null, price: 0, error: err.message };
  }
};

// =====================================================
// FUNCTION 2: Find or match child by sender phone + name
// =====================================================
const findOrMatchChild = async (senderWaId, childNameHint) => {
  try {
    const phoneFormats = normalizePhoneForLookup(senderWaId);
    const user = await User.findOne({ phone: { $in: phoneFormats } }).lean();

    if (!user) {
      return { found: false, userId: null, childId: null, childName: null, multipleChildren: false, childrenList: [], error: 'user_not_found' };
    }

    const children = await Child.find({ parent_id: user._id }).lean();

    if (children.length === 0) {
      return { found: false, userId: String(user._id), childId: null, childName: null, multipleChildren: false, childrenList: [], error: 'no_children_registered' };
    }

    // If name hint provided, try fuzzy match
    if (childNameHint && childNameHint.trim()) {
      const hint = childNameHint.trim().toLowerCase();
      const match = children.find(c => c.name.toLowerCase().includes(hint) || hint.includes(c.name.toLowerCase()));
      if (match) {
        return {
          found: true,
          userId: String(user._id),
          childId: String(match._id),
          childName: match.name,
          multipleChildren: children.length > 1,
          childrenList: children.map(c => ({ id: String(c._id), name: c.name }))
        };
      }
    }

    // Single child — auto-select
    if (children.length === 1) {
      return {
        found: true,
        userId: String(user._id),
        childId: String(children[0]._id),
        childName: children[0].name,
        multipleChildren: false,
        childrenList: children.map(c => ({ id: String(c._id), name: c.name }))
      };
    }

    // Multiple children, no match
    return {
      found: false,
      userId: String(user._id),
      childId: null,
      childName: null,
      multipleChildren: true,
      childrenList: children.map(c => ({ id: String(c._id), name: c.name })),
      error: 'multiple_children_no_match'
    };
  } catch (err) {
    console.error('WA_BOOKING_FIND_CHILD_ERROR', err.message);
    return { found: false, userId: null, childId: null, childName: null, multipleChildren: false, childrenList: [], error: err.message };
  }
};

// =====================================================
// FUNCTION 3: Create WhatsApp booking (atomic)
// =====================================================
const createWhatsAppBooking = async (userId, childId, slotId, durationHours = 1, childCount = 1) => {
  try {
    const hours = Math.max(1, Math.min(3, Math.round(durationHours)));
    const count = Math.max(1, childCount);

    // ATOMIC capacity check + increment (same pattern as bookings.js line 451)
    const slot = await TimeSlot.findOneAndUpdate(
      {
        _id: slotId,
        slot_type: 'hourly',
        $expr: { $lte: [{ $add: ['$booked_count', count] }, '$capacity'] }
      },
      { $inc: { booked_count: count } },
      { new: true }
    );

    if (!slot) {
      const existingSlot = await TimeSlot.findById(slotId).lean();
      if (!existingSlot) return { success: false, error: 'slot_not_found' };
      const available = existingSlot.capacity - existingSlot.booked_count;
      return { success: false, error: 'slot_full', availableSpots: available };
    }

    const price = await getHourlyPrice(hours, slot.start_time);
    const bookingCode = `WA-H-${randomUUID().substring(0, 8).toUpperCase()}`;
    const qrCode = await QRCode.toDataURL(bookingCode, { width: 300, margin: 2 });

    const booking = new HourlyBooking({
      user_id: userId,
      child_id: childId,
      slot_id: slotId,
      duration_hours: hours,
      custom_notes: 'WhatsApp booking via Shroomi',
      qr_code: qrCode,
      booking_code: bookingCode,
      status: 'confirmed',
      payment_method: 'cash',
      payment_status: 'pending_cash',
      amount: price
    });

    await booking.save();

    console.log('WA_BOOKING_CREATED', { bookingCode, slotDate: slot.date, slotTime: slot.start_time, amount: price, userId, childId });

    return {
      success: true,
      bookingCode,
      slotDate: slot.date,
      slotTime: slot.start_time,
      durationHours: hours,
      amount: price
    };
  } catch (err) {
    console.error('WA_BOOKING_CREATE_ERROR', err.message);
    // Rollback capacity on error
    try {
      await TimeSlot.findByIdAndUpdate(slotId, { $inc: { booked_count: -1 } });
    } catch (_) { /* best effort */ }
    return { success: false, error: err.message };
  }
};

module.exports = {
  checkAvailability,
  findOrMatchChild,
  createWhatsAppBooking
};
