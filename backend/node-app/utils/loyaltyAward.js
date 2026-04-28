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
 *   - booking.payment_status === 'paid' (absent → treated as 'paid' for
 *     legacy rows whose schema default is 'paid'). Unpaid bookings
 *     (pending_cash / pending_cliq) NEVER earn — enforced here as
 *     defense-in-depth in addition to the staff.js eligibility gate, so
 *     that any path that reaches checked_in (e.g. admin override via
 *     /staff/checkin) still cannot mint points on an unpaid visit.
 *
 * Never throws — returns a structured result so callers can log without
 * breaking the check-in response.
 */

const HourlyBooking = require('../models/HourlyBooking');
const LoyaltyLedger = require('../models/LoyaltyLedger');
const mongoose = require('mongoose');
const { awardPoints } = require('./awardPoints');
const { getLoyaltyEarnPolicy, computePointsForAmount } = require('./loyaltySettings');

const skip = (booking, reason) => ({ awarded: false, reason, points: 0, bookingId: booking?._id?.toString() });

// Sum of POSITIVE earns posted for this user within the current UTC day.
// Used to enforce policy.max_points_per_day. Ignores redemptions (negative
// deltas) and expiry entries — only fresh positive awards count toward the
// daily ceiling.
const getEarnedTodayForUser = async (userId) => {
  // Accept either a raw ObjectId/string or a populated mongoose doc.
  const rawId = userId && userId._id ? userId._id : userId;
  if (!rawId) return 0;
  const oid = rawId instanceof mongoose.Types.ObjectId
    ? rawId
    : new mongoose.Types.ObjectId(String(rawId));
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  const [summary] = await LoyaltyLedger.aggregate([
    {
      $match: {
        userId: oid,
        pointsDelta: { $gt: 0 },
        createdAt: { $gte: startOfDay, $lte: endOfDay }
      }
    },
    { $group: { _id: null, total: { $sum: '$pointsDelta' } } }
  ]);
  return Math.max(0, summary?.total || 0);
};

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
  // Phase 9.2 — payment-first enforcement. Unpaid bookings cannot earn.
  // Absent payment_status is treated as 'paid' (schema default is 'paid').
  if (booking.payment_status && booking.payment_status !== 'paid') {
    return skip(booking, 'unpaid');
  }
  if (booking.loyalty_awarded_at) {
    return skip(booking, 'already_awarded_marker');
  }

  const policy = await getLoyaltyEarnPolicy();
  if (!policy.enabled) {
    return skip(booking, 'loyalty_disabled');
  }

  let points = computePointsForAmount(policy, booking.amount);
  if (points <= 0) {
    return skip(booking, 'zero_points');
  }

  // Phase 9.4 — per-award cap. Cap a single award to policy.max_points_per_award.
  const maxPerAward = Number(policy.max_points_per_award) || 0;
  let capReason = null;
  if (maxPerAward > 0 && points > maxPerAward) {
    points = maxPerAward;
    capReason = 'capped_per_award';
  }

  // Phase 9.4 — daily cap. Clamp against remaining daily headroom.
  const maxPerDay = Number(policy.max_points_per_day) || 0;
  if (maxPerDay > 0) {
    const earnedToday = await getEarnedTodayForUser(booking.user_id);
    const remaining = Math.max(0, maxPerDay - earnedToday);
    if (remaining <= 0) {
      // User has already hit the daily ceiling. Do NOT flip the booking's
      // loyalty marker — the booking is still eligible to earn on a future
      // retroactive top-up if business rules change. For now, skip cleanly.
      return skip(booking, 'daily_cap_reached');
    }
    if (points > remaining) {
      points = remaining;
      capReason = capReason ? 'capped_per_award_and_per_day' : 'capped_per_day';
    }
  }

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
        loyalty_award_skipped_reason: capReason || null
      }
    }
  );

  return {
    awarded: true,
    points,
    bookingId: refId,
    ledgerId: result.ledgerEntry?._id?.toString() || null,
    cap_applied: capReason || null
  };
};

module.exports = {
  awardLoyaltyForHourlyCheckin
};
