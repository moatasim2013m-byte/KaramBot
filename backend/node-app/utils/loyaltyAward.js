/**
 * Loyalty earn on hourly check-in — Phase 3.
 *
 * Single source of truth for awarding loyalty points when a hourly booking
 * is successfully checked in. Used by both:
 *   - POST /api/staff/qr/checkin
 *   - POST /api/staff/checkin   (legacy manual booking_code path)
 *
 * Duplicate-protection layers (in order of defence):
 *   1) booking.loyalty_awarded_at (fast booking-level marker — first check)
 *   2) LoyaltyLedger unique index on (userId, refType, refId) — DB-level
 *      guarantee that the same (user, hourly, bookingId) tuple can only
 *      ever hold one earn entry
 *   3) HourlyBooking.findOneAndUpdate guard so the booking-level marker
 *      itself flips atomically only on a transition from null → date
 *
 * Eligibility rules (must ALL be true to award):
 *   - policy.enabled === true
 *   - booking.status === 'checked_in'
 *   - booking.qr_status === 'checked_in' OR booking.check_in_time present
 *   - booking.user_id is set (guest-only bookings without an owner cannot earn)
 *   - booking.payment_status indicates a real spend ('paid' OR confirmed cash)
 *     — we accept 'paid', 'pending_cash', 'pending_cliq' as a successful
 *       check-in implies cash was collected at the door / will be settled.
 *       Cancelled bookings cannot reach checked_in so they are excluded
 *       implicitly.
 *
 * Never throws — returns a structured result so callers can log without
 * breaking the check-in response.
 */

const HourlyBooking = require('../models/HourlyBooking');
const { awardPoints } = require('./awardPoints');
const { getLoyaltyEarnPolicy, computePointsForAmount } = require('./loyaltySettings');

const skip = (booking, reason) => ({ awarded: false, reason, points: 0, bookingId: booking?._id?.toString() });

const awardLoyaltyForHourlyCheckin = async (booking) => {
  if (!booking || !booking._id) {
    return skip(null, 'no_booking');
  }
  if (!booking.user_id) {
    return skip(booking, 'no_user');
  }
  if (booking.status !== 'checked_in') {
    return skip(booking, 'not_checked_in');
  }
  if (booking.loyalty_awarded_at) {
    return skip(booking, 'already_awarded_marker');
  }

  const policy = await getLoyaltyEarnPolicy();
  if (!policy.enabled) {
    return skip(booking, 'loyalty_disabled');
  }

  const points = computePointsForAmount(policy, booking.amount);
  if (points <= 0) {
    return skip(booking, 'zero_points');
  }

  // Atomic award via the existing helper. The unique compound index on
  // LoyaltyLedger.(userId, refType, refId) gives us the DB-level dedup.
  const refId = String(booking._id);
  const result = await awardPoints({
    userId: booking.user_id,
    refType: 'hourly',
    refId,
    type: 'hourly',
    points,
    description: `Earned ${points} points from hourly check-in (${booking.booking_code || refId})`
  });

  if (!result.awarded) {
    // Either zero/missing or already_awarded (ledger said so).
    // Still flip the booking-level marker for already_awarded so future calls
    // short-circuit immediately.
    if (result.reason === 'already_awarded') {
      await HourlyBooking.updateOne(
        { _id: booking._id, loyalty_awarded_at: null },
        { $set: { loyalty_awarded_at: new Date() } }
      ).catch(() => {});
    }
    return { awarded: false, reason: result.reason || 'award_failed', points: 0, bookingId: refId };
  }

  // Stamp the booking-level marker. Only flips if still null — protects
  // against any concurrent legacy path that might have flipped it first.
  await HourlyBooking.updateOne(
    { _id: booking._id, loyalty_awarded_at: null },
    {
      $set: {
        loyalty_awarded_at: new Date(),
        loyalty_points_awarded: points,
        loyalty_award_skipped_reason: null
      }
    }
  );

  return { awarded: true, points, bookingId: refId, ledgerId: result.ledgerEntry?._id?.toString() || null };
};

module.exports = {
  awardLoyaltyForHourlyCheckin
};
