/**
 * Booking lifecycle sweep — Phase 9.3.
 *
 * Two transitions that were previously missing from the system:
 *
 *   1. Stale no-show bookings
 *      (status='confirmed' + qr_status in {unused, null, missing} + slot date
 *      strictly before today) → qr_status='expired'.
 *      status stays 'confirmed' so financial / audit history is preserved;
 *      evaluateCheckinEligibility (staff.js) rejects qr_status='expired'
 *      with a specific Arabic message.
 *
 *   2. Ended sessions
 *      (status='checked_in' + session_end_time < now) → status='completed'.
 *      qr_status already reads 'checked_in' from the activation path and
 *      stays that way. The active-sessions query already filters by
 *      session_end_time > now, so the dashboard count is unaffected; this
 *      pass only resolves the underlying booking state.
 *
 * Called from the cron endpoint POST /api/admin/cron/booking-lifecycle
 * (same CRON_SECRET gate as /winback and /whatsapp-followup). The helper
 * is pure, idempotent, and atomic per bulk update — safe to run on any
 * cadence, including on every minute.
 */

const HourlyBooking = require('../models/HourlyBooking');
const TimeSlot = require('../models/TimeSlot');

// Compute today's YYYY-MM-DD in server local time to match TimeSlot.date format.
const todayDateString = (now = new Date()) => {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const sweepHourlyBookingLifecycle = async ({ now = new Date() } = {}) => {
  // ── 1. Complete ended sessions ────────────────────────────────────────
  const completedResult = await HourlyBooking.updateMany(
    { status: 'checked_in', session_end_time: { $lt: now } },
    { $set: { status: 'completed' } }
  );

  // ── 2. Expire stale no-show bookings ──────────────────────────────────
  // Find slots whose date is strictly before today (string compare works
  // because TimeSlot.date is stored as YYYY-MM-DD).
  const cutoffDate = todayDateString(now);
  const pastSlotIds = await TimeSlot.find(
    { date: { $lt: cutoffDate }, slot_type: 'hourly' },
    { _id: 1 }
  ).lean();
  const pastSlotIdList = pastSlotIds.map((s) => s._id);

  let expiredResult = { modifiedCount: 0 };
  if (pastSlotIdList.length > 0) {
    expiredResult = await HourlyBooking.updateMany(
      {
        slot_id: { $in: pastSlotIdList },
        status: 'confirmed',
        $or: [
          { qr_status: 'unused' },
          { qr_status: { $exists: false } },
          { qr_status: null }
        ]
      },
      { $set: { qr_status: 'expired' } }
    );
  }

  return {
    completed_sessions: completedResult.modifiedCount || 0,
    expired_bookings: expiredResult.modifiedCount || 0,
    cutoff_date: cutoffDate,
    past_slot_count: pastSlotIdList.length
  };
};

module.exports = {
  sweepHourlyBookingLifecycle,
  todayDateString
};
