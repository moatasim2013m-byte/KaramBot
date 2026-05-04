const express = require('express');
const TimeSlot = require('../models/TimeSlot');
const HourlyBooking = require('../models/HourlyBooking');
const Settings = require('../models/Settings');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { format, addDays, parse, isBefore, subMinutes, addMinutes } = require('date-fns');
const { fromZonedTime } = require('date-fns-tz');

const router = express.Router();
const TIMEZONE = 'Asia/Amman';
const BOOKING_CUTOFF_MINUTES = 30;
const SLOTS_CACHE_TTL_MS = 60 * 1000;
const slotsAvailabilityCache = new Map();
const jordanDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

const getJordanDateTimeParts = (date = new Date()) => {
  const parts = jordanDateTimeFormatter.formatToParts(date);
  const getPart = (type) => parts.find((part) => part.type === type)?.value;

  return {
    date: `${getPart('year')}-${getPart('month')}-${getPart('day')}`,
    hour: Number(getPart('hour')),
    minute: Number(getPart('minute'))
  };
};

const getSlotsCacheKey = ({ date, slotType, timeMode, durationHours, sameDayBucket }) => (
  `${date}|${slotType}|${timeMode || 'all'}|${durationHours}|${sameDayBucket || 'na'}`
);

// HOURLY: 10:00 AM to 12:00 AM (midnight), every 10 minutes, session = 60 min
// Last entry at 23:00 (session ends at midnight)
const HOURLY_CONFIG = {
  startHour: 10,
  startMinute: 0,
  lastEntryHour: 23, // Last entry at 23:00
  lastEntryMinute: 0,
  intervalMinutes: 10,
  sessionDurationMinutes: 60,
  maxCapacity: 70 // max kids at any moment
};

// BIRTHDAY: 1:00 PM to 12:00 AM, every 2 hours, duration = 2 hours
// Slots: 13:00, 15:00, 17:00, 19:00, 21:00, 23:00
const BIRTHDAY_CONFIG = {
  startHour: 13,
  endHour: 24,
  intervalHours: 2,
  durationHours: 2,
  slots: ['13:00', '15:00', '17:00', '19:00', '21:00', '23:00']
};

// DAY CARE: parallel-but-independent service from Main Area hourly.
// Slot generation is NEVER auto-triggered from public/customer code paths —
// daycare slots are created manually via /api/admin/slots or via the
// dev-only seed script at /app/backend/node-app/scripts/seed_daycare_slots.js.
// This config is the single source of truth for the seed script + admin UI.
const DAYCARE_CONFIG = {
  startHour: 8,            // 08:00 first drop-off
  startMinute: 0,
  lastEntryHour: 16,       // last entry at 16:00
  lastEntryMinute: 0,
  intervalMinutes: 60,     // hourly drop-off slots
  defaultCapacity: 12,     // small group default; admin/seed can override
  sessionDurationMinutes: 60
};

// Generate hourly slots for a date (every 10 minutes from 10:00 to 23:00)
const generateHourlySlotsForDate = async (date) => {
  const slots = [];
  const existingSlots = await TimeSlot.find({ date, slot_type: 'hourly' }).lean();
  const existingByStartTime = new Map(existingSlots.map((slot) => [slot.start_time, slot]));
  const slotsToCreate = [];
  let hour = HOURLY_CONFIG.startHour;
  let minute = HOURLY_CONFIG.startMinute;
  
  while (hour < HOURLY_CONFIG.lastEntryHour || 
         (hour === HOURLY_CONFIG.lastEntryHour && minute <= HOURLY_CONFIG.lastEntryMinute)) {
    const startTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    
    const existing = existingByStartTime.get(startTime);
    if (!existing) {
      slotsToCreate.push({
        date,
        start_time: startTime,
        slot_type: 'hourly',
        capacity: HOURLY_CONFIG.maxCapacity,
        booked_count: 0
      });
    } else {
      slots.push(existing);
    }
    
    // Increment by 10 minutes
    minute += HOURLY_CONFIG.intervalMinutes;
    if (minute >= 60) {
      minute = 0;
      hour += 1;
    }
  }

  if (slotsToCreate.length > 0) {
    const createdSlots = await TimeSlot.insertMany(slotsToCreate, { ordered: false });
    slots.push(...createdSlots);
  }

  return slots;
};

// Generate birthday slots for a date
const generateBirthdaySlotsForDate = async (date) => {
  const slots = [];
  const existingSlots = await TimeSlot.find({ date, slot_type: 'birthday' }).lean();
  const existingByStartTime = new Map(existingSlots.map((slot) => [slot.start_time, slot]));
  const capacitySetting = await Settings.findOne({ key: 'birthday_capacity' }).lean();
  const capacity = capacitySetting?.value || 1;
  const slotsToCreate = [];
  
  for (const startTime of BIRTHDAY_CONFIG.slots) {
    const existing = existingByStartTime.get(startTime);
    if (!existing) {
      slotsToCreate.push({
        date,
        start_time: startTime,
        slot_type: 'birthday',
        capacity,
        booked_count: 0
      });
    } else {
      slots.push(existing);
    }
  }

  if (slotsToCreate.length > 0) {
    const createdSlots = await TimeSlot.insertMany(slotsToCreate, { ordered: false });
    slots.push(...createdSlots);
  }

  return slots;
};

// MANUAL day-care slot generator. Used ONLY by:
//   • /api/admin/slots/generate  (admin-triggered)
//   • /app/backend/node-app/scripts/seed_daycare_slots.js  (dev-only)
// Never invoked from /api/slots/available (no auto-seed in customer flow).
const generateDaycareSlotsForDate = async (date, { capacity } = {}) => {
  const slots = [];
  const existingSlots = await TimeSlot.find({ date, slot_type: 'daycare' }).lean();
  const existingByStartTime = new Map(existingSlots.map((slot) => [slot.start_time, slot]));
  const slotCapacity = Number.isFinite(capacity) && capacity > 0 ? capacity : DAYCARE_CONFIG.defaultCapacity;
  const slotsToCreate = [];
  let hour = DAYCARE_CONFIG.startHour;
  let minute = DAYCARE_CONFIG.startMinute;

  while (hour < DAYCARE_CONFIG.lastEntryHour ||
         (hour === DAYCARE_CONFIG.lastEntryHour && minute <= DAYCARE_CONFIG.lastEntryMinute)) {
    const startTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const existing = existingByStartTime.get(startTime);
    if (!existing) {
      slotsToCreate.push({
        date,
        start_time: startTime,
        slot_type: 'daycare',
        capacity: slotCapacity,
        booked_count: 0
      });
    } else {
      slots.push(existing);
    }

    minute += DAYCARE_CONFIG.intervalMinutes;
    while (minute >= 60) {
      minute -= 60;
      hour += 1;
    }
  }

  if (slotsToCreate.length > 0) {
    const createdSlots = await TimeSlot.insertMany(slotsToCreate, { ordered: false });
    slots.push(...createdSlots);
  }

  return slots;
};
const buildBookingIntervals = (bookings, slotStartMinutesById) => bookings
  .map((booking) => slotStartMinutesById.get(String(booking.slot_id)))
  .filter((slotStartMinutes) => Number.isInteger(slotStartMinutes))
  .map((slotStartMinutes) => ({
    start: slotStartMinutes,
    end: slotStartMinutes + HOURLY_CONFIG.sessionDurationMinutes
  }));

const calculateAvailableCapacityFromIntervals = (startTimeStr, bookingIntervals, slotCapacity = HOURLY_CONFIG.maxCapacity) => {
  const [startHour, startMinute] = startTimeStr.split(':').map(Number);
  const startTimeMinutes = startHour * 60 + startMinute;
  const endTimeMinutes = startTimeMinutes + HOURLY_CONFIG.sessionDurationMinutes;

  let maxActiveKids = 0;

  for (let t = startTimeMinutes; t < endTimeMinutes; t += 10) {
    let activeCount = 0;

    for (const bookingInterval of bookingIntervals) {
      if (bookingInterval.start <= t && t < bookingInterval.end) {
        activeCount++;
      }
    }

    maxActiveKids = Math.max(maxActiveKids, activeCount);
  }

  return slotCapacity - maxActiveKids;
};

// Calculate active kids count at a specific time for a given date
// This checks all sessions that would be active at that moment
const getActiveKidsAtTime = async (date, timeStr) => {
  const [checkHour, checkMinute] = timeStr.split(':').map(Number);
  const checkTimeMinutes = checkHour * 60 + checkMinute;
  
  // Find all confirmed/checked_in hourly bookings for this date only
  // Use aggregation to filter by slot date efficiently
  const bookings = await HourlyBooking.find({
    status: { $in: ['confirmed', 'checked_in'] }
  }).populate({
    path: 'slot_id',
    match: { date: date },
    select: 'date start_time'
  }).lean();
  
  let activeCount = 0;
  
  for (const booking of bookings) {
    // Skip if slot doesn't match the date filter (populate match returns null)
    if (!booking.slot_id) continue;
    
    const [slotHour, slotMinute] = booking.slot_id.start_time.split(':').map(Number);
    const slotStartMinutes = slotHour * 60 + slotMinute;
    const slotEndMinutes = slotStartMinutes + HOURLY_CONFIG.sessionDurationMinutes;
    
    // Check if this session overlaps with the check time
    // A session is active if: slotStart <= checkTime < slotEnd
    if (slotStartMinutes <= checkTimeMinutes && checkTimeMinutes < slotEndMinutes) {
      activeCount++;
    }
  }
  
  return activeCount;
};

// Optimized: Calculate available capacity using pre-fetched bookings
const calculateAvailableCapacityForSlot = (date, startTimeStr, allBookings, slotCapacity = HOURLY_CONFIG.maxCapacity) => {
  const [startHour, startMinute] = startTimeStr.split(':').map(Number);
  const startTimeMinutes = startHour * 60 + startMinute;
  const endTimeMinutes = startTimeMinutes + HOURLY_CONFIG.sessionDurationMinutes;
  
  let maxActiveKids = 0;
  
  // Check every 10-minute interval during this session
  for (let t = startTimeMinutes; t < endTimeMinutes; t += 10) {
    let activeCount = 0;
    
    for (const booking of allBookings) {
      if (!booking.slot_id || booking.slot_id.date !== date) continue;
      
      const [slotHour, slotMinute] = booking.slot_id.start_time.split(':').map(Number);
      const slotStartMinutes = slotHour * 60 + slotMinute;
      const slotEndMinutes = slotStartMinutes + HOURLY_CONFIG.sessionDurationMinutes;
      
      // Check if this session overlaps with the check time
      if (slotStartMinutes <= t && t < slotEndMinutes) {
        activeCount++;
      }
    }
    
    maxActiveKids = Math.max(maxActiveKids, activeCount);
  }
  
  return slotCapacity - maxActiveKids;
};

// Get available slots for a date (public - no auth required for viewing)
router.get('/available', async (req, res) => {
  try {
    const { date, slot_type = 'hourly', timeMode, duration } = req.query;
    
    // Safely parse duration to number (default to 1 if invalid)
    const parsedDuration = parseInt(duration, 10);
    const durationHours = (isNaN(parsedDuration) || parsedDuration <= 0) ? 1 : parsedDuration;
    
    // Debug logging - 1) Query params
    console.log('SLOTS_AVAILABLE_HIT', { date, timeMode, duration, durationHours });
    
    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }

    const jordanNowParts = getJordanDateTimeParts();
    const isJordanTodayRequest = date === jordanNowParts.date;
    const sameDayBucket = isJordanTodayRequest
      ? `${jordanNowParts.date}-${String(jordanNowParts.hour).padStart(2, '0')}:${String(jordanNowParts.minute).padStart(2, '0')}`
      : undefined;

    const cacheKey = getSlotsCacheKey({
      date,
      slotType: slot_type,
      timeMode,
      durationHours,
      sameDayBucket
    });
    const cachedEntry = slotsAvailabilityCache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return res.json(cachedEntry.payload);
    }

    // Generate slots if they don't exist.
    // NOTE: daycare slots are NEVER auto-generated from this customer-facing
    // endpoint. They are seeded manually via /api/admin/slots or the
    // dev-only seed script. If no daycare slots exist for the date the
    // response will simply be empty.
    if (slot_type === 'hourly') {
      await generateHourlySlotsForDate(date);
    } else if (slot_type === 'birthday') {
      await generateBirthdaySlotsForDate(date);
    }

    // Keep cutoff at now + BOOKING_CUTOFF_MINUTES while comparing absolute instants
    const cutoffTime = addMinutes(new Date(), BOOKING_CUTOFF_MINUTES);

    // Determine closing time based on day of week (Thu=4, Fri=5)
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.getDay();
    const isWeekend = (dayOfWeek === 4 || dayOfWeek === 5); // Thu or Fri
    const closingHour = isWeekend ? 24 : 23; // midnight vs 23:00
    const closingMinutes = closingHour * 60;

    const slots = await TimeSlot.find({ 
      date, 
      slot_type,
      is_active: true
    }).sort({ start_time: 1 });

    // Debug logging - 2) Total slots from DB
    console.log('SLOTS_DB_COUNT_TOTAL', slots.length);

    // OPTIMIZATION: Fetch all bookings for the date ONCE (instead of per-slot)
    let bookingIntervals = [];
    if (slot_type === 'hourly') {
      const slotStartMinutesById = new Map(
        slots.map((slot) => {
          const [slotHour, slotMinute] = slot.start_time.split(':').map(Number);
          return [String(slot._id), (slotHour * 60) + slotMinute];
        })
      );

      const allBookings = await HourlyBooking.find({
        slot_id: { $in: slots.map((slot) => slot._id) },
        status: { $in: ['confirmed', 'checked_in'] }
      })
        .select('slot_id')
        .lean();

      bookingIntervals = buildBookingIntervals(allBookings, slotStartMinutesById);
    }

    // Counters for logging
    let countAfterMode = 0;
    let countAfterEndTime = 0;

    // Process slots with availability (now using in-memory calculation)
    const availableSlots = slots.map((slot) => {
      const slotDateTimeInAmman = parse(`${slot.date} ${slot.start_time}`, 'yyyy-MM-dd HH:mm', new Date());
      const slotDateTime = fromZonedTime(slotDateTimeInAmman, TIMEZONE);

      const isPast = isBefore(slotDateTime, cutoffTime);
      
      // Parse start time
      const [startHour, startMinute] = slot.start_time.split(':').map(Number);
      const startMinutes = startHour * 60 + startMinute;
      const endMinutes = startMinutes + (durationHours * 60);
      
      let availableSpots;
      let isAvailable;
      
      if (slot_type === 'hourly') {
        // For hourly, calculate based on overlapping sessions (using cached bookings)
        availableSpots = calculateAvailableCapacityFromIntervals(slot.start_time, bookingIntervals, slot.capacity);
        
        // Check if slot fits within closing time
        const fitsClosing = endMinutes <= closingMinutes;
        
        // Filter by timeMode if provided
        let matchesTimeMode = true;
        if (timeMode === 'morning') {
          // Morning: slots from 10:00 to before 14:00
          matchesTimeMode = (startHour >= 10 && startHour < 14);
        } else if (timeMode === 'afternoon') {
          // Afternoon: slots from 14:00 onwards
          matchesTimeMode = (startHour >= 14);
        }
        
        // Count for logging
        if (matchesTimeMode) countAfterMode++;
        if (matchesTimeMode && fitsClosing) countAfterEndTime++;
        
        isAvailable = slot.is_active && !isPast && availableSpots > 0 && fitsClosing && matchesTimeMode;
      } else {
        // Birthday and daycare: simple per-slot capacity check.
        availableSpots = slot.capacity - slot.booked_count;
        isAvailable = slot.is_active && !isPast && availableSpots > 0;
      }
      
      return {
        ...slot.toJSON(),
        available_spots: availableSpots,
        is_available: isAvailable,
        is_past: isPast
      };
    });

    // Debug logging - 3) Count after timeMode filter
    console.log('SLOTS_DB_COUNT_AFTER_MODE', countAfterMode);
    
    // Debug logging - 4) Count after endTime filter
    console.log('SLOTS_DB_COUNT_AFTER_ENDTIME', countAfterEndTime, { closingMinutes, dayOfWeek });

    // Filter out non-matching timeMode slots entirely for cleaner response
    const filteredSlots = timeMode 
      ? availableSlots.filter(s => s.is_available || s.is_past)
      : availableSlots;

    // Same-day safety filter (Jordan time): only allow slots >= now + 60 minutes
    const jordanCutoffParts = getJordanDateTimeParts(addMinutes(new Date(), 60));
    const cutoffMinutes = (jordanCutoffParts.hour * 60) + jordanCutoffParts.minute;

    const slotsAfterJordanCutoff = isJordanTodayRequest
      ? (() => {
          if (date < jordanCutoffParts.date) {
            return [];
          }

          return filteredSlots.filter((slot) => {
            const rawStart = slot.start_time || slot.startTime;
            if (typeof rawStart !== 'string') return false;

            const [h, m] = rawStart.split(':').map(Number);
            if (Number.isNaN(h) || Number.isNaN(m)) return false;

            const slotStartMinutes = (h * 60) + m;
            return slotStartMinutes >= cutoffMinutes;
          });
        })()
      : filteredSlots;

    const payload = { slots: slotsAfterJordanCutoff };
    slotsAvailabilityCache.set(cacheKey, {
      payload,
      expiresAt: Date.now() + SLOTS_CACHE_TTL_MS
    });

    res.json(payload);
  } catch (error) {
    console.error('Get available slots error:', error);
    res.status(500).json({ error: 'Failed to get slots' });
  }
});

// Get single slot
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const slot = await TimeSlot.findById(req.params.id);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    res.json({ slot: slot.toJSON() });
  } catch (error) {
    console.error('Get slot error:', error);
    res.status(500).json({ error: 'Failed to get slot' });
  }
});

// Check capacity before booking (internal helper exported for use in bookings.js)
const checkHourlyCapacity = async (date, startTimeStr) => {
  const availableCapacity = await getAvailableCapacityForSlot(date, startTimeStr);
  return availableCapacity > 0;
};

// Admin: Create slot
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { date, start_time, slot_type, capacity } = req.body;

    if (!['hourly', 'birthday', 'daycare'].includes(slot_type)) {
      return res.status(400).json({ error: `Invalid slot_type: ${slot_type}` });
    }

    const existing = await TimeSlot.findOne({ date, start_time, slot_type });
    if (existing) {
      return res.status(400).json({ error: 'Slot already exists' });
    }

    const fallbackCapacity = slot_type === 'daycare' ? DAYCARE_CONFIG.defaultCapacity : 25;
    const slot = new TimeSlot({ date, start_time, slot_type, capacity: capacity || fallbackCapacity });
    await slot.save();
    
    res.status(201).json({ slot: slot.toJSON() });
  } catch (error) {
    console.error('Create slot error:', error);
    res.status(500).json({ error: 'Failed to create slot' });
  }
});

// Admin: Update slot
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { capacity, is_active } = req.body;
    
    const slot = await TimeSlot.findById(req.params.id);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }

    if (capacity !== undefined) slot.capacity = capacity;
    if (is_active !== undefined) slot.is_active = is_active;
    
    await slot.save();
    res.json({ slot: slot.toJSON() });
  } catch (error) {
    console.error('Update slot error:', error);
    res.status(500).json({ error: 'Failed to update slot' });
  }
});

// Admin: Bulk generate slots for date range
router.post('/generate', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { start_date, end_date, slot_type = 'hourly', capacity } = req.body;
    
    const start = new Date(start_date);
    const end = new Date(end_date);
    const generatedSlots = [];

    let current = start;
    while (current <= end) {
      const dateStr = format(current, 'yyyy-MM-dd');
      let slots;
      if (slot_type === 'hourly') {
        slots = await generateHourlySlotsForDate(dateStr);
      } else if (slot_type === 'birthday') {
        slots = await generateBirthdaySlotsForDate(dateStr);
      } else if (slot_type === 'daycare') {
        slots = await generateDaycareSlotsForDate(dateStr, { capacity: Number(capacity) });
      } else {
        return res.status(400).json({ error: `Unsupported slot_type: ${slot_type}` });
      }
      generatedSlots.push(...slots);
      current = addDays(current, 1);
    }

    res.json({ 
      message: `Generated ${generatedSlots.length} slots`,
      slots: generatedSlots.map(s => s.toJSON())
    });
  } catch (error) {
    console.error('Generate slots error:', error);
    res.status(500).json({ error: 'Failed to generate slots' });
  }
});

module.exports = router;
module.exports.checkHourlyCapacity = checkHourlyCapacity;
module.exports.calculateAvailableCapacityForSlot = calculateAvailableCapacityForSlot;
module.exports.generateDaycareSlotsForDate = generateDaycareSlotsForDate;
module.exports.DAYCARE_CONFIG = DAYCARE_CONFIG;
