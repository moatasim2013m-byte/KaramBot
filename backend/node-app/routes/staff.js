const express = require('express');
const HourlyBooking = require('../models/HourlyBooking');
const BirthdayBooking = require('../models/BirthdayBooking');
const UserSubscription = require('../models/UserSubscription');
const Child = require('../models/Child');
const TimeSlot = require('../models/TimeSlot');
const User = require('../models/User');
const { authMiddleware, staffMiddleware, staffPermissionMiddleware } = require('../middleware/auth');
const { addMinutes, format } = require('date-fns');
const { sendCheckinConfirmation } = require('../utils/checkinNotifications');
const { logger } = require('../utils/logger');
const { generateBookingQrPayload } = require('../utils/bookingQr');

const router = express.Router();

// Apply staff middleware to all routes (staffMiddleware allows both staff and admin)
router.use(authMiddleware, staffMiddleware);
router.use(staffPermissionMiddleware('access_staff_tools'));

// Get today's active sessions (checked-in hourly bookings)
const getActiveSessionsPayload = async () => {
  const now = new Date();
  const activeSessions = await HourlyBooking.find({
    status: 'checked_in',
    session_end_time: { $gt: now }
  })
    .populate('child_id')
    .populate('slot_id')
    .sort({ check_in_time: -1 });

  return {
    sessions: activeSessions.map((session) => {
      const remaining_ms = session.session_end_time - now;
      const remaining_minutes = Math.max(0, Math.ceil(remaining_ms / 60000));
      return {
        id: session._id.toString(),
        booking_code: session.booking_code,
        child_name: session.child_id?.name || 'Unknown',
        slot_time: session.slot_id?.start_time || 'N/A',
        check_in_time: session.check_in_time,
        session_end_time: session.session_end_time,
        remaining_minutes,
        warning: remaining_minutes <= 5
      };
    })
  };
};

router.get('/active-sessions', async (req, res) => {
  try {
    res.json(await getActiveSessionsPayload());
  } catch (error) {
    logger.error({ event: 'active_sessions_fetch_failed', error: error.message, stack: error.stack }, 'Get active sessions error');
    res.status(500).json({ error: 'Failed to get active sessions' });
  }
});

router.get('/stream/active-sessions', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const push = async () => {
    const payload = await getActiveSessionsPayload();
    res.write(`event: active_sessions\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  try { await push(); } catch (error) { logger.error({ event: 'active_sessions_stream_init_failed', error: error.message }); }
  const interval = setInterval(() => {
    push().catch((error) => logger.error({ event: 'active_sessions_stream_tick_failed', error: error.message }));
  }, 10000);
  req.on('close', () => clearInterval(interval));
});

// Get today's confirmed hourly bookings (pending check-in)
router.get('/pending-checkins', async (req, res) => {
  try {
    const today = format(new Date(), 'yyyy-MM-dd');
    
    // Get today's slots
    const todaySlots = await TimeSlot.find({ date: today, slot_type: 'hourly' });
    const slotIds = todaySlots.map(s => s._id);
    
    const pendingBookings = await HourlyBooking.find({
      slot_id: { $in: slotIds },
      status: 'confirmed'
    })
    .populate('child_id')
    .populate('slot_id')
    .sort({ 'slot_id.start_time': 1 });

    const bookings = pendingBookings.map(booking => ({
      id: booking._id.toString(),
      booking_code: booking.booking_code,
      child_name: booking.child_id?.name || 'Unknown',
      slot_time: booking.slot_id?.start_time || 'N/A',
      qr_code: booking.qr_code,
      qr_token: booking.qr_token || null,
      qr_status: booking.qr_status || 'unused'
    }));

    res.json({ bookings });
  } catch (error) {
    console.error('Get pending check-ins error:', error);
    res.status(500).json({ error: 'Failed to get pending check-ins' });
  }
});

// Check-in a booking (legacy manual booking_code flow — preserved for backward compatibility)
router.post('/checkin', async (req, res) => {
  try {
    const { booking_code } = req.body;
    
    const booking = await HourlyBooking.findOne({ booking_code })
      .populate('slot_id')
      .populate('child_id')
      .populate('user_id');

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking.status !== 'confirmed') {
      return res.status(400).json({ error: `Cannot check in - status is ${booking.status}` });
    }

    const now = new Date();
    const sessionEndTime = addMinutes(now, 60);

    booking.status = 'checked_in';
    booking.check_in_time = now;
    booking.session_end_time = sessionEndTime;
    booking.qr_status = 'checked_in';
    booking.qr_checked_in_at = now;
    booking.qr_checked_in_by = req.userId;
    await booking.save();

    const parentPhone = booking.user_id?.phone;
    const parentName = booking.user_id?.name;

    if (parentPhone) {
      sendCheckinConfirmation({
        phone: parentPhone,
        parentName,
        childName: booking.child_id?.name,
        bookingCode: booking.booking_code,
        checkInTime: now,
        sessionEndTime
      }).then((result) => {
        if (!result?.ok && !result?.skipped) {
          console.error('CHECKIN_NOTIFICATION_FAILED', {
            booking_code,
            reason: result?.error || result?.reason || 'unknown'
          });
        }
      }).catch((notificationError) => {
        console.error('CHECKIN_NOTIFICATION_ERROR', notificationError.message || notificationError);
      });
    }

    res.json({
      success: true,
      message: 'Check-in successful',
      session: {
        child_name: booking.child_id?.name,
        check_in_time: now,
        session_end_time: sessionEndTime
      }
    });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ error: 'Failed to check in' });
  }
});

// Get active subscriptions for a child (for consumption)
router.get('/subscription/:childId', async (req, res) => {
  try {
    const subscription = await UserSubscription.findOne({
      child_id: req.params.childId,
      status: { $in: ['pending', 'active'] },
      remaining_visits: { $gt: 0 },
      $or: [
        { expires_at: null },
        { expires_at: { $gt: new Date() } }
      ]
    }).populate('plan_id').populate('child_id');

    if (!subscription) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    res.json({
      subscription: {
        id: subscription._id.toString(),
        child_name: subscription.child_id?.name,
        plan_name: subscription.plan_id?.name,
        remaining_visits: subscription.remaining_visits,
        status: subscription.status,
        expires_at: subscription.expires_at
      }
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});

// Consume subscription visit
router.post('/consume-visit', async (req, res) => {
  try {
    const { child_id } = req.body;
    
    const subscription = await UserSubscription.findOne({
      child_id,
      status: { $in: ['pending', 'active'] },
      remaining_visits: { $gt: 0 },
      $or: [
        { expires_at: null },
        { expires_at: { $gt: new Date() } }
      ]
    }).populate('plan_id').populate('child_id');

    if (!subscription) {
      return res.status(400).json({ error: 'No active subscription found for this child' });
    }

    // Activate if first use
    if (subscription.status === 'pending') {
      subscription.status = 'active';
      subscription.expires_at = addMinutes(new Date(), 30 * 24 * 60); // 30 days
      subscription.first_checkin_at = new Date();
    }

    subscription.remaining_visits -= 1;
    if (subscription.remaining_visits === 0) {
      subscription.status = 'consumed';
    }
    await subscription.save();

    res.json({
      success: true,
      message: 'Visit consumed',
      remaining_visits: subscription.remaining_visits,
      child_name: subscription.child_id?.name
    });
  } catch (error) {
    console.error('Consume visit error:', error);
    res.status(500).json({ error: 'Failed to consume visit' });
  }
});

// Get today's birthday parties (read-only)
router.get('/today-birthdays', async (req, res) => {
  try {
    const today = format(new Date(), 'yyyy-MM-dd');
    
    // Get today's birthday slots
    const todaySlots = await TimeSlot.find({ date: today, slot_type: 'birthday' });
    const slotIds = todaySlots.map(s => s._id);
    
    const birthdayBookings = await BirthdayBooking.find({
      slot_id: { $in: slotIds },
      status: { $in: ['confirmed', 'custom_pending'] }
    })
    .populate('child_id')
    .populate('slot_id')
    .populate('theme_id')
    .sort({ 'slot_id.start_time': 1 });

    const parties = birthdayBookings.map(booking => ({
      id: booking._id.toString(),
      booking_code: booking.booking_code,
      child_name: booking.child_id?.name || 'Unknown',
      slot_time: booking.slot_id?.start_time || 'N/A',
      theme: booking.is_custom ? 'Custom Request' : booking.theme_id?.name,
      guest_count: booking.guest_count,
      special_notes: booking.special_notes,
      status: booking.status
    }));

    res.json({ parties });
  } catch (error) {
    console.error('Get today birthdays error:', error);
    res.status(500).json({ error: 'Failed to get birthday parties' });
  }
});

// Search child by name (for subscription consumption)
router.get('/search-child', async (req, res) => {
  try {
    const { name } = req.query;
    
    if (!name || name.length < 2) {
      return res.json({ children: [] });
    }

    const children = await Child.find({
      name: { $regex: name, $options: 'i' }
    }).limit(10);

    res.json({
      children: children.map(c => ({
        id: c._id.toString(),
        name: c.name
      }))
    });
  } catch (error) {
    console.error('Search child error:', error);
    res.status(500).json({ error: 'Failed to search' });
  }
});

// Reception: Parent lookup
router.get('/parent-lookup', async (req, res) => {
  try {
    const { q } = req.query;
    const parent = await User.findOne({ 
      $or: [{ email: q }, { mobile: q }],
      role: 'parent'
    });
    if (!parent) return res.status(404).json({ error: 'Not found' });

    const children = await Child.find({ parent_id: parent._id });
    const subscription = await UserSubscription.findOne({ 
      user_id: parent._id,
      expires_at: { $gte: new Date() }
    }).sort({ created_at: -1 });

    // Check active sessions (pseudo-implementation)
    const activeSessions = {}; // Could expand to real sessions table

    res.json({
      name: parent.name,
      email: parent.email,
      subscription: subscription ? { remaining_visits: subscription.remaining_visits } : null,
      children: children.map(c => ({
        id: c._id.toString(),
        name: c.name,
        active_session: activeSessions[c._id.toString()] || null
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// Redeem visit
router.post('/redeem-visit', async (req, res) => {
  try {
    const { child_id } = req.body;
    const child = await Child.findById(child_id);
    if (!child) return res.status(404).json({ error: 'Child not found' });

    const subscription = await UserSubscription.findOne({
      user_id: child.parent_id,
      expires_at: { $gte: new Date() }
    }).sort({ created_at: -1 });

    if (!subscription || subscription.remaining_visits <= 0) {
      return res.status(400).json({ error: 'No visits remaining' });
    }

    subscription.remaining_visits -= 1;
    if (!subscription.first_checkin_at) subscription.first_checkin_at = new Date();
    await subscription.save();

    // Create session placeholder (expand as needed)
    res.json({ message: 'Session started', remaining: subscription.remaining_visits });
  } catch (error) {
    res.status(500).json({ error: 'Redeem failed' });
  }
});

// End session
router.post('/end-session', async (req, res) => {
  try {
    // Placeholder for session end logic
    res.json({ message: 'Session ended' });
  } catch (error) {
    res.status(500).json({ error: 'End failed' });
  }
});

// =============================================================================
// QR-based check-in (Phase 1)
// =============================================================================
// Endpoints:
//   POST /api/staff/qr/validate  — validate a scanned QR string, return booking summary
//   POST /api/staff/qr/checkin   — atomically check in by QR (idempotent re-scan = 409)
//   POST /api/staff/qr/backfill  — admin-only: generate qr_token for legacy bookings
//
// Lookup strategy: try qr_token first (new bookings); fallback to booking_code
// (old bookings whose QR PNG still encodes booking_code, and manual entry).
// =============================================================================

const ARABIC_MESSAGES = {
  not_found: 'رمز الحجز غير صالح',
  cancelled: 'هذا الحجز ملغي',
  unpaid: 'هذا الحجز غير مدفوع أو غير مؤكد',
  already_used: 'تم استخدام رمز QR مسبقًا',
  not_active_yet: 'لا يمكن تفعيل هذا الحجز الآن',
  validate_ok: 'تم التحقق من رمز الحجز بنجاح',
  checkin_ok: 'تم تفعيل الجلسة بنجاح',
  invalid_input: 'رمز الحجز مطلوب',
  server_error: 'حدث خطأ غير متوقع'
};

// Find a booking from any scanned string. Tries qr_token (preferred) first,
// then falls back to booking_code (legacy QR PNG payload + manual entry).
const findBookingByScannedToken = async (scanned) => {
  const value = String(scanned || '').trim();
  if (!value) return null;

  let booking = await HourlyBooking.findOne({ qr_token: value })
    .populate('child_id')
    .populate('slot_id')
    .populate('user_id');

  if (!booking) {
    booking = await HourlyBooking.findOne({ booking_code: value })
      .populate('child_id')
      .populate('slot_id')
      .populate('user_id');
  }

  return booking;
};

// Build the standard JSON summary for a booking. Used by both validate & checkin.
const summarizeBooking = (booking) => ({
  booking_id: booking._id.toString(),
  booking_code: booking.booking_code,
  child_name: booking.child_id?.name || booking.guest_child_name || 'Unknown',
  child_count: booking.child_count || 1,
  date: booking.slot_id?.date || null,
  slot_time: booking.slot_id?.start_time || null,
  duration_hours: booking.duration_hours || null,
  status: booking.status,
  qr_status: booking.qr_status || 'unused',
  payment_status: booking.payment_status || null,
  payment_method: booking.payment_method || null,
  parent_name: booking.user_id?.name || null,
  parent_phone: booking.user_id?.phone || null,
  check_in_time: booking.check_in_time || null,
  session_end_time: booking.session_end_time || null
});

// Determine whether a booking can currently be checked in.
// Returns { can_checkin, reason_code, reason_ar }.
const evaluateCheckinEligibility = (booking) => {
  if (!booking) {
    return { can_checkin: false, reason_code: 'not_found', reason_ar: ARABIC_MESSAGES.not_found };
  }
  if (booking.status === 'cancelled') {
    return { can_checkin: false, reason_code: 'cancelled', reason_ar: ARABIC_MESSAGES.cancelled };
  }
  // Only confirmed (i.e. paid OR pending_cash/pending_cliq accepted by current flow) are eligible
  if (booking.status !== 'confirmed') {
    if (booking.status === 'checked_in' || booking.qr_status === 'checked_in') {
      return { can_checkin: false, reason_code: 'already_used', reason_ar: ARABIC_MESSAGES.already_used };
    }
    return { can_checkin: false, reason_code: 'not_active_yet', reason_ar: ARABIC_MESSAGES.not_active_yet };
  }
  if (booking.qr_status && booking.qr_status !== 'unused') {
    return { can_checkin: false, reason_code: 'already_used', reason_ar: ARABIC_MESSAGES.already_used };
  }
  // Reject if explicitly unpaid/unconfirmed payment-wise
  if (booking.payment_status && !['paid', 'pending_cash', 'pending_cliq'].includes(booking.payment_status)) {
    return { can_checkin: false, reason_code: 'unpaid', reason_ar: ARABIC_MESSAGES.unpaid };
  }
  return { can_checkin: true, reason_code: 'ok', reason_ar: ARABIC_MESSAGES.validate_ok };
};

// POST /qr/validate — validate a scanned QR or booking code.
router.post('/qr/validate', async (req, res) => {
  const scanned = req.body?.qr_token || req.body?.code || req.body?.booking_code;
  if (!scanned || typeof scanned !== 'string') {
    return res.status(400).json({ error: ARABIC_MESSAGES.invalid_input, error_code: 'invalid_input' });
  }
  try {
    const booking = await findBookingByScannedToken(scanned);
    if (!booking) {
      logger.info({ event: 'qr_validate', result: 'not_found', staff_id: req.userId });
      return res.status(404).json({
        error: ARABIC_MESSAGES.not_found,
        error_code: 'not_found',
        can_checkin: false
      });
    }

    const eligibility = evaluateCheckinEligibility(booking);
    logger.info({
      event: 'qr_validate',
      result: eligibility.reason_code,
      booking_id: booking._id.toString(),
      booking_code: booking.booking_code,
      staff_id: req.userId
    });

    return res.json({
      ok: true,
      message: eligibility.can_checkin ? ARABIC_MESSAGES.validate_ok : eligibility.reason_ar,
      can_checkin: eligibility.can_checkin,
      reason_code: eligibility.reason_code,
      booking: summarizeBooking(booking)
    });
  } catch (error) {
    logger.error({ event: 'qr_validate_failed', error: error.message, stack: error.stack });
    return res.status(500).json({ error: ARABIC_MESSAGES.server_error });
  }
});

// POST /qr/checkin — atomically check in by scanned QR or booking code.
router.post('/qr/checkin', async (req, res) => {
  const scanned = req.body?.qr_token || req.body?.code || req.body?.booking_code;
  if (!scanned || typeof scanned !== 'string') {
    return res.status(400).json({ error: ARABIC_MESSAGES.invalid_input, error_code: 'invalid_input' });
  }
  try {
    const booking = await findBookingByScannedToken(scanned);
    if (!booking) {
      logger.info({ event: 'qr_checkin', result: 'not_found', staff_id: req.userId });
      return res.status(404).json({ error: ARABIC_MESSAGES.not_found, error_code: 'not_found' });
    }

    const eligibility = evaluateCheckinEligibility(booking);
    if (!eligibility.can_checkin) {
      logger.info({
        event: 'qr_checkin',
        result: eligibility.reason_code,
        booking_id: booking._id.toString(),
        staff_id: req.userId
      });
      const statusCode = eligibility.reason_code === 'already_used' ? 409 : 400;
      return res.status(statusCode).json({
        error: eligibility.reason_ar,
        error_code: eligibility.reason_code,
        booking: summarizeBooking(booking)
      });
    }

    const now = new Date();
    const sessionEndTime = addMinutes(now, 60);

    // Atomic update: only if still 'unused' and 'confirmed'. Prevents double-use
    // race when the same QR is scanned twice in rapid succession.
    const updated = await HourlyBooking.findOneAndUpdate(
      {
        _id: booking._id,
        status: 'confirmed',
        $or: [{ qr_status: 'unused' }, { qr_status: { $exists: false } }, { qr_status: null }]
      },
      {
        $set: {
          status: 'checked_in',
          check_in_time: now,
          session_end_time: sessionEndTime,
          qr_status: 'checked_in',
          qr_checked_in_at: now,
          qr_checked_in_by: req.userId
        }
      },
      { new: true }
    )
      .populate('child_id')
      .populate('slot_id')
      .populate('user_id');

    if (!updated) {
      // Lost the race or state changed between read and write — re-fetch and report.
      const fresh = await findBookingByScannedToken(scanned);
      logger.info({
        event: 'qr_checkin',
        result: 'race_already_used',
        booking_id: booking._id.toString(),
        staff_id: req.userId
      });
      return res.status(409).json({
        error: ARABIC_MESSAGES.already_used,
        error_code: 'already_used',
        booking: fresh ? summarizeBooking(fresh) : summarizeBooking(booking)
      });
    }

    // Fire-and-forget parent notification (mirrors legacy /checkin behavior).
    const parentPhone = updated.user_id?.phone;
    const parentName = updated.user_id?.name;
    if (parentPhone) {
      sendCheckinConfirmation({
        phone: parentPhone,
        parentName,
        childName: updated.child_id?.name,
        bookingCode: updated.booking_code,
        checkInTime: now,
        sessionEndTime
      }).catch((notificationError) => {
        console.error('CHECKIN_NOTIFICATION_ERROR', notificationError.message || notificationError);
      });
    }

    logger.info({
      event: 'qr_checkin',
      result: 'ok',
      booking_id: updated._id.toString(),
      booking_code: updated.booking_code,
      staff_id: req.userId
    });

    return res.json({
      ok: true,
      message: ARABIC_MESSAGES.checkin_ok,
      booking: summarizeBooking(updated)
    });
  } catch (error) {
    logger.error({ event: 'qr_checkin_failed', error: error.message, stack: error.stack });
    return res.status(500).json({ error: ARABIC_MESSAGES.server_error });
  }
});

// POST /qr/backfill — admin-only: assign qr_token to legacy bookings missing it.
// Idempotent. Does NOT regenerate the existing qr_code data URL (parents may
// already have the old QR PNG that encodes booking_code) — fallback lookup
// in /qr/validate + /qr/checkin handles old QRs by booking_code.
router.post('/qr/backfill', async (req, res) => {
  if ((req.user?.role || '').toLowerCase() !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const limit = Math.min(Math.max(Number(req.body?.limit) || 500, 1), 5000);
    const candidates = await HourlyBooking.find({
      $or: [{ qr_token: { $exists: false } }, { qr_token: null }, { qr_token: '' }],
      status: { $in: ['confirmed', 'checked_in', 'completed', 'cancelled'] }
    }).limit(limit);

    let updated = 0;
    for (const booking of candidates) {
      const { qr_token } = await generateBookingQrPayload();
      let qr_status = 'unused';
      if (booking.status === 'checked_in' || booking.status === 'completed') qr_status = 'checked_in';
      else if (booking.status === 'cancelled') qr_status = 'cancelled';

      booking.qr_token = qr_token;
      booking.qr_status = qr_status;
      if (qr_status === 'checked_in' && !booking.qr_checked_in_at && booking.check_in_time) {
        booking.qr_checked_in_at = booking.check_in_time;
      }
      try {
        await booking.save();
        updated += 1;
      } catch (saveErr) {
        // Unique index collision is statistically impossible with 32-byte tokens
        // but log + skip just in case.
        logger.warn({
          event: 'qr_backfill_skip',
          booking_id: booking._id.toString(),
          error: saveErr.message
        });
      }
    }

    logger.info({ event: 'qr_backfill', updated, scanned: candidates.length, staff_id: req.userId });
    return res.json({ ok: true, scanned: candidates.length, updated });
  } catch (error) {
    logger.error({ event: 'qr_backfill_failed', error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Backfill failed' });
  }
});

module.exports = router;
