const express = require('express');
const QRCode = require('qrcode');
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const HourlyBooking = require('../models/HourlyBooking');
const BirthdayBooking = require('../models/BirthdayBooking');
const TimeSlot = require('../models/TimeSlot');
const Child = require('../models/Child');
const Theme = require('../models/Theme');
const Product = require('../models/Product');
const User = require('../models/User');
const LoyaltyHistory = require('../models/LoyaltyHistory');
const Settings = require('../models/Settings');
const Coupon = require('../models/Coupon');
const { awardPoints } = require('../utils/awardPoints');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { sendEmail, emailTemplates } = require('../utils/email');
const { validateCoupon } = require('../utils/coupons');
const {
  sendHourlyBookingWhatsAppConfirmation,
  sendBirthdayBookingWhatsAppConfirmation
} = require('../utils/whatsappBookingConfirmation');
const { notifyAdminsOfOrder } = require('../utils/adminOrderNotifications');
const { generateBookingQrPayload } = require('../utils/bookingQr');
const { addMinutes, isBefore, isAfter } = require('date-fns');

const router = express.Router();
const LOYALTY_POINTS_PER_ORDER = 10;
const JORDAN_TIMEZONE = 'Asia/Amman';

const jordanDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: JORDAN_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

const getJordanDateTimeParts = (date = new Date()) => {
  const parts = jordanDateTimeFormatter.formatToParts(date);
  const getPart = (type) => Number(parts.find((p) => p.type === type)?.value || 0);

  return {
    year: getPart('year'),
    month: getPart('month'),
    day: getPart('day'),
    hour: getPart('hour'),
    minute: getPart('minute')
  };
};

const formatDateParts = ({ year, month, day }) => (
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
);

const isTomorrowInJordan = (slotDate) => {
  const now = getJordanDateTimeParts();
  const tomorrowUTC = new Date(Date.UTC(now.year, now.month - 1, now.day));
  tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);

  return slotDate === formatDateParts({
    year: tomorrowUTC.getUTCFullYear(),
    month: tomorrowUTC.getUTCMonth() + 1,
    day: tomorrowUTC.getUTCDate()
  });
};

const canBookBirthdayDate = (slotDate) => {
  if (!isTomorrowInJordan(slotDate)) {
    return true;
  }

  const now = getJordanDateTimeParts();
  return now.hour < 18;
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const MAX_GUEST_CHILD_COUNT = 20;
const MAX_GUEST_CHILD_NAME_LENGTH = 100;

const normalizeGuestCount = (value, { min = 5, max = 100, fallback = 10 } = {}) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const normalizeChildIds = (childIdsInput, childIdInput) => {
  const rawChildIds = Array.isArray(childIdsInput)
    ? childIdsInput
    : (childIdInput ? [childIdInput] : []);

  const normalized = rawChildIds
    .map((id) => id?.toString().trim())
    .filter(Boolean);

  const deduped = [...new Set(normalized)];
  return {
    childIds: deduped,
    allValid: deduped.every((id) => isValidObjectId(id))
  };
};

const normalizeDurationHours = (value, fallback = 2) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(4, Math.max(1, parsed));
};

// Helper function for Happy Hour pricing
const getHourlyPrice = async (duration_hours = 2, slot_start_time = null) => {
  const hours = normalizeDurationHours(duration_hours);

  // Happy Hour logic: 10:00-13:59 => 3.5 JD per hour
  if (slot_start_time) {
    try {
      const [startHour] = slot_start_time.split(':').map(Number);
      const isHappyHour = startHour >= 10 && startHour < 14;
      
      if (isHappyHour) {
        return 3.5 * hours; // Happy Hour: 3.5 JD per hour
      }
    } catch (err) {
      console.error('Error parsing slot_start_time:', err);
      // Fall through to normal pricing
    }
  }

  try {
    // Fetch pricing from Settings
    const pricing = await Settings.find({
      key: { $in: ['hourly_1hr', 'hourly_2hr', 'hourly_3hr', 'hourly_extra_hr'] }
    });

    const prices = {
      hourly_1hr: 7,
      hourly_2hr: 10,
      hourly_3hr: 13,
      hourly_extra_hr: 3
    };

    pricing.forEach(p => { prices[p.key] = parseFloat(p.value); });

    if (hours === 1) return prices.hourly_1hr;
    if (hours === 2) return prices.hourly_2hr;
    if (hours === 3) return prices.hourly_3hr;
    // For 4+ hours: 2h base price + extra hour price per additional hour
    return prices.hourly_2hr + (hours - 2) * prices.hourly_extra_hr;
  } catch (error) {
    console.error('Error fetching hourly pricing:', error);
    // Fallback to defaults
    if (hours === 1) return 7;
    if (hours === 2) return 10;
    if (hours === 3) return 13;
    return 10 + (hours - 2) * 3;
  }
};

const buildLineItems = async (lineItems = []) => {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return { normalizedLineItems: [], productsTotal: 0 };
  }

  const quantityByProduct = new Map();
  lineItems.forEach((item) => {
    const productId = (item?.productId || item?.product_id || '').toString().trim();
    const qty = parseInt(item?.quantity, 10) || 0;
    if (!productId || qty <= 0) return;
    quantityByProduct.set(productId, (quantityByProduct.get(productId) || 0) + qty);
  });

  const productIds = [...quantityByProduct.keys()];
  if (productIds.length === 0) {
    return { normalizedLineItems: [], productsTotal: 0 };
  }

  const products = await Product.find({ _id: { $in: productIds }, active: true });
  const productsMap = new Map(products.map((product) => [product._id.toString(), product]));

  const normalizedLineItems = [];
  let productsTotal = 0;

  quantityByProduct.forEach((quantity, productId) => {
    const product = productsMap.get(productId);
    if (!product) return;

    const unitPriceJD = Number(product.priceJD) || 0;
    const lineTotalJD = unitPriceJD * quantity;
    productsTotal += lineTotalJD;

    normalizedLineItems.push({
      product_id: product._id,
      sku: product.sku,
      nameAr: product.nameAr,
      nameEn: product.nameEn,
      unitPriceJD,
      quantity,
      lineTotalJD
    });
  });

  return { normalizedLineItems, productsTotal };
};

// Generate QR code as data URL
const generateQRCode = async (data) => {
  try {
    return await QRCode.toDataURL(data, { width: 300, margin: 2 });
  } catch (error) {
    console.error('QR generation error:', error);
    return null;
  }
};

// Award loyalty points (idempotent by reference id)
// Phase 3 — Loyalty earn moved to check-in time (see utils/loyaltyAward.js
// + routes/staff.js). Booking-creation no longer awards loyalty points;
// this stub stays in place so any forgotten caller gracefully no-ops
// instead of duplicating awards. The legacy LoyaltyHistory + User.loyalty_points
// fields are intentionally NOT touched on booking creation anymore.
const awardLoyaltyPoints = async (_userId, _referenceId, _source) => {
  return { awarded: false, reason: 'phase3_award_on_checkin' };
};

// ==================== HOURLY BOOKINGS ====================

// Create hourly booking (after payment confirmed) - supports multiple children
router.post('/hourly', authMiddleware, async (req, res) => {
  let reservedSlotId = null;
  let reservedCount = 0;

  try {
    const { slot_id, child_ids, child_id, payment_id, duration_hours, custom_notes, lineItems, coupon_code, child_count, guest_child_name } = req.body;
    // NOTE: req.body.amount is intentionally IGNORED for security - price computed server-side
    
    if (!isValidObjectId(slot_id)) {
      return res.status(400).json({ error: 'معرّف الموعد غير صالح' });
    }

    // Support both child_ids array and legacy child_id
    const { childIds: childIdList, allValid } = normalizeChildIds(child_ids, child_id);
    const useGuestBooking = childIdList.length === 0;
    const effectiveCount = useGuestBooking
      ? Math.max(1, Math.min(MAX_GUEST_CHILD_COUNT, parseInt(child_count) || 1))
      : childIdList.length;

    if (!useGuestBooking && !allValid) {
      return res.status(400).json({ error: 'معرّف طفل غير صالح' });
    }
    
    // ATOMIC capacity check for all children at once
    const slot = await TimeSlot.findOneAndUpdate(
      { 
        _id: slot_id, 
        slot_type: 'hourly',
        $expr: { $lte: [{ $add: ['$booked_count', effectiveCount] }, '$capacity'] }
      },
      { $inc: { booked_count: effectiveCount } },
      { new: true }
    );
    
    if (!slot) {
      const existingSlot = await TimeSlot.findById(slot_id);
      if (!existingSlot) {
        return res.status(400).json({ error: 'الوقت غير صالح' });
      }
      const available = existingSlot.capacity - existingSlot.booked_count;
      return res.status(400).json({ 
        error: `عذراً، المتاح ${available} مكان فقط. اخترت ${effectiveCount} أطفال.`
      });
    }

    reservedSlotId = slot_id;
    reservedCount = effectiveCount;

    // Validate all children belong to user (only when child IDs provided)
    let validChildren = [];
    if (!useGuestBooking) {
      validChildren = await Child.find({ _id: { $in: childIdList }, parent_id: req.userId });
      if (validChildren.length !== childIdList.length) {
        await TimeSlot.findByIdAndUpdate(slot_id, { $inc: { booked_count: -effectiveCount } });
        return res.status(400).json({ error: 'طفل غير صالح' });
      }
    }

    // SECURITY: Compute price server-side using slot start_time for Happy Hour pricing
    const hours = normalizeDurationHours(duration_hours);
    const basePrice = await getHourlyPrice(hours, slot.start_time);
    const { normalizedLineItems, productsTotal } = await buildLineItems(lineItems);
    const subtotalAmount = (basePrice * effectiveCount) + productsTotal;
    let discountAmount = 0;
    let normalizedCouponCode = '';

    if (coupon_code) {
      const couponValidation = await validateCoupon({
        code: coupon_code,
        amount: subtotalAmount,
        type: 'hourly'
      });
      if (!couponValidation.valid) {
        await TimeSlot.findByIdAndUpdate(slot_id, { $inc: { booked_count: -effectiveCount } });
        return res.status(400).json({ error: couponValidation.message });
      }
      discountAmount = couponValidation.discountAmount;
      normalizedCouponCode = couponValidation.normalizedCode;
    }
    const totalAmount = subtotalAmount - discountAmount;
    
    // Safety check: computed amount must be valid
    if (!totalAmount || isNaN(totalAmount) || totalAmount <= 0) {
      await TimeSlot.findByIdAndUpdate(slot_id, { $inc: { booked_count: -effectiveCount } });
      return res.status(400).json({ error: 'خطأ في حساب السعر' });
    }
    
    const pricePerUnit = totalAmount / effectiveCount;
    const bookings = [];

    if (useGuestBooking) {
      // Single booking without a registered child
      const booking_code = `PK-H-${randomUUID().substring(0, 8).toUpperCase()}`;
      const { qr_token, qr_code } = await generateBookingQrPayload();
      const booking = new HourlyBooking({
        user_id: req.userId,
        child_id: null,
        guest_child_name: (guest_child_name || '').trim().slice(0, MAX_GUEST_CHILD_NAME_LENGTH),
        child_count: effectiveCount,
        slot_id,
        duration_hours: hours,
        custom_notes: custom_notes || '',
        qr_code,
        qr_token,
        qr_status: 'unused',
        booking_code,
        status: 'confirmed',
        payment_id,
        amount: totalAmount,
        subtotal_amount: subtotalAmount,
        discount_amount: discountAmount,
        coupon_code: normalizedCouponCode,
        lineItems: normalizedLineItems
      });
      await booking.save();
      bookings.push(booking);
    } else {
      // Create a booking for each registered child
      for (const cid of childIdList) {
        const booking_code = `PK-H-${randomUUID().substring(0, 8).toUpperCase()}`;
        const { qr_token, qr_code } = await generateBookingQrPayload();
        const booking = new HourlyBooking({
          user_id: req.userId,
          child_id: cid,
          child_count: 1,
          slot_id,
          duration_hours: hours,
          custom_notes: custom_notes || '',
          qr_code,
          qr_token,
          qr_status: 'unused',
          booking_code,
          status: 'confirmed',
          payment_id,
          amount: pricePerUnit,
          subtotal_amount: subtotalAmount / childIdList.length,
          discount_amount: discountAmount / childIdList.length,
          coupon_code: normalizedCouponCode,
          lineItems: normalizedLineItems
        });
        await booking.save();
        bookings.push(booking);
      }
    }

    await awardLoyaltyPoints(req.userId, payment_id || bookings[0]?._id, 'hourly');

    if (normalizedCouponCode) {
      await Coupon.findOneAndUpdate({ code: normalizedCouponCode }, { $inc: { redeemed_count: 1 } });
    }

    // Send confirmation email (non-blocking)
    const user = await User.findById(req.userId);
    const childNames = validChildren.length > 0
      ? validChildren.map(c => c.name).join(', ')
      : ((guest_child_name || '').trim() || `${effectiveCount} أطفال`);
    const template = emailTemplates.bookingConfirmation(bookings[0], slot, { name: childNames });
    try {
      await sendEmail(user.email, template.subject, template.html);
    } catch (emailErr) {
      console.error('HOURLY_BOOKING_EMAIL_ERROR', emailErr.message || emailErr);
    }

    await sendHourlyBookingWhatsAppConfirmation({
      phone: user?.phone,
      customerName: user?.name,
      date: slot?.date,
      time: slot?.start_time,
      childCount: effectiveCount,
      durationHours: bookings[0]?.duration_hours,
      bookingReference: bookings[0]?.booking_code,
      bookingId: bookings[0]?._id?.toString()
    });
    notifyAdminsOfOrder({
      orderType: 'Hourly Booking',
      orderId: bookings[0]?.booking_code,
      customerName: user?.name,
      customerEmail: user?.email,
      amount: totalAmount,
      paymentStatus: 'paid',
      createdAt: bookings[0]?.created_at || new Date()
    }).catch((error) => console.error('ADMIN_ORDER_ALERT_FAILED', error?.message || error));

    reservedSlotId = null;
    reservedCount = 0;

    res.status(201).json({ bookings: bookings.map(b => b.toJSON()) });
  } catch (error) {
    if (reservedSlotId && reservedCount > 0) {
      await TimeSlot.findByIdAndUpdate(reservedSlotId, { $inc: { booked_count: -reservedCount } });
    }

    console.error('Create hourly booking error:', error);
    res.status(500).json({ error: 'فشل إنشاء الحجز' });
  }
});

// Create hourly booking with cash/cliq payment (offline providers)
router.post('/hourly/offline', authMiddleware, async (req, res) => {
  let reservedSlotId = null;
  let reservedCount = 0;

  try {
    const { slot_id, child_ids, child_id, duration_hours, custom_notes, payment_method, lineItems, coupon_code, child_count, guest_child_name } = req.body;
    
    // Validate payment method
    if (!['cash', 'cliq'].includes(payment_method)) {
      return res.status(400).json({ error: 'طريقة دفع غير صالحة' });
    }
    
    if (!isValidObjectId(slot_id)) {
      return res.status(400).json({ error: 'معرّف الموعد غير صالح' });
    }

    // Support both child_ids array and legacy child_id
    const { childIds: childIdList, allValid } = normalizeChildIds(child_ids, child_id);
    const useGuestBooking = childIdList.length === 0;
    const effectiveCount = useGuestBooking
      ? Math.max(1, Math.min(MAX_GUEST_CHILD_COUNT, parseInt(child_count) || 1))
      : childIdList.length;

    if (!useGuestBooking && !allValid) {
      return res.status(400).json({ error: 'معرّف طفل غير صالح' });
    }
    
    // ATOMIC capacity check for all children at once
    const slot = await TimeSlot.findOneAndUpdate(
      { 
        _id: slot_id, 
        slot_type: 'hourly',
        $expr: { $lte: [{ $add: ['$booked_count', effectiveCount] }, '$capacity'] }
      },
      { $inc: { booked_count: effectiveCount } },
      { new: true }
    );
    
    if (!slot) {
      const existingSlot = await TimeSlot.findById(slot_id);
      if (!existingSlot) {
        return res.status(400).json({ error: 'الوقت غير صالح' });
      }
      const available = existingSlot.capacity - existingSlot.booked_count;
      return res.status(400).json({ 
        error: `عذراً، المتاح ${available} مكان فقط. اخترت ${effectiveCount} أطفال.`
      });
    }

    reservedSlotId = slot_id;
    reservedCount = effectiveCount;

    // Validate all children belong to user (only when child IDs provided)
    let validChildren = [];
    if (!useGuestBooking) {
      validChildren = await Child.find({ _id: { $in: childIdList }, parent_id: req.userId });
      if (validChildren.length !== childIdList.length) {
        await TimeSlot.findByIdAndUpdate(slot_id, { $inc: { booked_count: -effectiveCount } });
        return res.status(400).json({ error: 'طفل غير صالح' });
      }
    }

    // Calculate price on server side with Happy Hour logic
    const hours = parseInt(duration_hours) || 2;
    const basePrice = await getHourlyPrice(hours, slot.start_time);
    const { normalizedLineItems, productsTotal } = await buildLineItems(lineItems);
    const subtotalAmount = (basePrice * effectiveCount) + productsTotal;
    let discountAmount = 0;
    let normalizedCouponCode = '';

    if (coupon_code) {
      const couponValidation = await validateCoupon({
        code: coupon_code,
        amount: subtotalAmount,
        type: 'hourly'
      });
      if (!couponValidation.valid) {
        await TimeSlot.findByIdAndUpdate(slot_id, { $inc: { booked_count: -effectiveCount } });
        return res.status(400).json({ error: couponValidation.message });
      }
      discountAmount = couponValidation.discountAmount;
      normalizedCouponCode = couponValidation.normalizedCode;
    }

    const totalAmount = subtotalAmount - discountAmount;
    
    // Safety check: computed amount must be valid
    if (!totalAmount || isNaN(totalAmount) || totalAmount <= 0) {
      await TimeSlot.findByIdAndUpdate(slot_id, { $inc: { booked_count: -effectiveCount } });
      return res.status(400).json({ error: 'خطأ في حساب السعر' });
    }
    
    const pricePerUnit = totalAmount / effectiveCount;
    const bookings = [];
    const paymentStatus = payment_method === 'cash' ? 'pending_cash' : 'pending_cliq';

    if (useGuestBooking) {
      // Single booking without a registered child
      const booking_code = `PK-H-${randomUUID().substring(0, 8).toUpperCase()}`;
      const { qr_token, qr_code } = await generateBookingQrPayload();
      const booking = new HourlyBooking({
        user_id: req.userId,
        child_id: null,
        guest_child_name: (guest_child_name || '').trim().slice(0, MAX_GUEST_CHILD_NAME_LENGTH),
        child_count: effectiveCount,
        slot_id,
        duration_hours: hours,
        custom_notes: custom_notes || '',
        qr_code,
        qr_token,
        qr_status: 'unused',
        booking_code,
        status: 'confirmed',
        payment_method,
        payment_status: paymentStatus,
        amount: totalAmount,
        subtotal_amount: subtotalAmount,
        discount_amount: discountAmount,
        coupon_code: normalizedCouponCode,
        lineItems: normalizedLineItems
      });
      await booking.save();
      bookings.push(booking);
    } else {
      // Create a booking for each registered child
      for (const cid of childIdList) {
        const booking_code = `PK-H-${randomUUID().substring(0, 8).toUpperCase()}`;
        const { qr_token, qr_code } = await generateBookingQrPayload();
        const booking = new HourlyBooking({
          user_id: req.userId,
          child_id: cid,
          child_count: 1,
          slot_id,
          duration_hours: hours,
          custom_notes: custom_notes || '',
          qr_code,
          qr_token,
          qr_status: 'unused',
          booking_code,
          status: 'confirmed',
          payment_method,
          payment_status: paymentStatus,
          amount: pricePerUnit,
          subtotal_amount: subtotalAmount / childIdList.length,
          discount_amount: discountAmount / childIdList.length,
          coupon_code: normalizedCouponCode,
          lineItems: normalizedLineItems
        });
        await booking.save();
        bookings.push(booking);
      }
    }

    await awardLoyaltyPoints(req.userId, bookings[0]?._id, 'hourly');

    if (normalizedCouponCode) {
      await Coupon.findOneAndUpdate({ code: normalizedCouponCode }, { $inc: { redeemed_count: 1 } });
    }

    // Send confirmation email (non-blocking)
    const user = await User.findById(req.userId);
    const childNames = validChildren.length > 0
      ? validChildren.map(c => c.name).join(', ')
      : ((guest_child_name || '').trim() || `${effectiveCount} أطفال`);
    const template = emailTemplates.paymentPending({
      userName: user?.name,
      serviceName: `Hourly Play (${childNames})`,
      serviceDate: slot?.date,
      serviceTime: slot?.start_time,
      totalPrice: totalAmount
    });
    try {
      await sendEmail(user.email, template.subject, template.html);
    } catch (emailErr) {
      console.error('HOURLY_OFFLINE_EMAIL_ERROR', emailErr.message || emailErr);
    }

    await sendHourlyBookingWhatsAppConfirmation({
      phone: user?.phone,
      customerName: user?.name,
      date: slot?.date,
      time: slot?.start_time,
      childCount: effectiveCount,
      durationHours: bookings[0]?.duration_hours,
      bookingReference: bookings[0]?.booking_code,
      bookingId: bookings[0]?._id?.toString(),
      isPending: true,
      paymentMethod: payment_method
    });
    notifyAdminsOfOrder({
      orderType: 'Hourly Booking',
      orderId: bookings[0]?.booking_code,
      customerName: user?.name,
      customerEmail: user?.email,
      amount: totalAmount,
      paymentStatus,
      createdAt: bookings[0]?.created_at || new Date()
    }).catch((error) => console.error('ADMIN_ORDER_ALERT_FAILED', error?.message || error));

    reservedSlotId = null;
    reservedCount = 0;

    res.status(201).json({ 
      bookings: bookings.map(b => b.toJSON()),
      message: payment_method === 'cash' 
        ? 'تم الحجز بنجاح! الرجاء الدفع نقداً عند الاستقبال.' 
        : 'تم الحجز بنجاح! الرجاء إتمام التحويل عبر CliQ.'
    });
  } catch (error) {
    if (reservedSlotId && reservedCount > 0) {
      await TimeSlot.findByIdAndUpdate(reservedSlotId, { $inc: { booked_count: -reservedCount } });
    }

    console.error('Create offline hourly booking error:', error);
    res.status(500).json({ error: 'فشل إنشاء الحجز' });
  }
});

// Get user's hourly bookings
router.get('/hourly', authMiddleware, async (req, res) => {
  try {
    const bookings = await HourlyBooking.find({ user_id: req.userId })
      .populate('slot_id')
      .populate('child_id')
      .sort({ created_at: -1 });

    res.json({ bookings: bookings.map(b => b.toJSON()) });
  } catch (error) {
    console.error('Get hourly bookings error:', error);
    res.status(500).json({ error: 'Failed to get bookings' });
  }
});

// Get active session
router.get('/hourly/active', authMiddleware, async (req, res) => {
  try {
    const activeBooking = await HourlyBooking.findOne({
      user_id: req.userId,
      status: 'checked_in',
      session_end_time: { $gt: new Date() }
    })
    .populate('slot_id')
    .populate('child_id');

    if (!activeBooking) {
      return res.json({ active_session: null });
    }

    const now = new Date();
    const remaining_ms = activeBooking.session_end_time - now;
    const remaining_minutes = Math.max(0, Math.ceil(remaining_ms / 60000));

    res.json({
      active_session: {
        ...activeBooking.toJSON(),
        remaining_minutes,
        warning_5min: remaining_minutes <= 5 && remaining_minutes > 0
      }
    });
  } catch (error) {
    console.error('Get active session error:', error);
    res.status(500).json({ error: 'Failed to get active session' });
  }
});

// Check-in (reception scan)
router.post('/hourly/checkin', authMiddleware, async (req, res) => {
  try {
    const { booking_code } = req.body;
    
    const booking = await HourlyBooking.findOne({ booking_code })
      .populate('slot_id')
      .populate('child_id');

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking.status !== 'confirmed') {
      return res.status(400).json({ error: `Cannot check in - booking status is ${booking.status}` });
    }

    const now = new Date();
    const durationMinutes = (booking.duration_hours || 2) * 60;
    const sessionEndTime = addMinutes(now, durationMinutes);

    booking.status = 'checked_in';
    booking.check_in_time = now;
    booking.session_end_time = sessionEndTime;
    await booking.save();

    res.json({
      message: 'Check-in successful',
      booking: booking.toJSON(),
      session_end_time: sessionEndTime
    });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ error: 'Failed to check in' });
  }
});

// ==================== BIRTHDAY BOOKINGS ====================

// Create birthday booking
router.post('/birthday', authMiddleware, async (req, res) => {
  try {
    const { slot_id, child_id, theme_id, is_custom, custom_request, guest_count, special_notes, payment_id, lineItems } = req.body;

    if (!isValidObjectId(slot_id)) {
      return res.status(400).json({ error: 'معرّف موعد الحفل غير صالح' });
    }
    if (!isValidObjectId(child_id)) {
      return res.status(400).json({ error: 'معرّف الطفل غير صالح' });
    }
    if (!is_custom && !isValidObjectId(theme_id)) {
      return res.status(400).json({ error: 'معرّف الثيم غير صالح' });
    }

    const requestedSlot = await TimeSlot.findById(slot_id).select('date slot_type');
    if (!requestedSlot || requestedSlot.slot_type !== 'birthday') {
      return res.status(400).json({ error: 'Invalid birthday slot' });
    }

    if (!canBookBirthdayDate(requestedSlot.date)) {
      return res.status(400).json({ error: 'يمكن حجز حفلة اليوم التالي قبل الساعة 6:00 مساءً فقط. الرجاء اختيار يوم آخر.' });
    }
    
    // ATOMIC capacity check for birthday slots
    const slot = await TimeSlot.findOneAndUpdate(
      { 
        _id: slot_id, 
        slot_type: 'birthday',
        $expr: { $lt: ['$booked_count', '$capacity'] }
      },
      { $inc: { booked_count: 1 } },
      { new: true }
    );
    
    if (!slot) {
      const existingSlot = await TimeSlot.findById(slot_id);
      if (!existingSlot) {
        return res.status(400).json({ error: 'Invalid birthday slot' });
      }
      return res.status(400).json({ error: 'عذراً، هذا الموعد محجوز. يرجى اختيار موعد آخر.' }); // Slot full (Arabic)
    }

    // Validate child
    const child = await Child.findOne({ _id: child_id, parent_id: req.userId });
    if (!child) {
      await TimeSlot.findByIdAndUpdate(slot_id, { $inc: { booked_count: -1 } });
      return res.status(400).json({ error: 'Invalid child' });
    }

    // Validate theme if not custom
    let theme = null;
    if (!is_custom && theme_id) {
      theme = await Theme.findById(theme_id);
      if (!theme) {
        await TimeSlot.findByIdAndUpdate(slot_id, { $inc: { booked_count: -1 } });
        return res.status(400).json({ error: 'Invalid theme' });
      }
    }

    const booking_code = `PK-B-${randomUUID().substring(0, 8).toUpperCase()}`;
    const { normalizedLineItems, productsTotal } = await buildLineItems(lineItems);
    const themeAmount = Number(theme?.price || 0);

    const booking = new BirthdayBooking({
      user_id: req.userId,
      child_id,
      slot_id,
      theme_id: is_custom ? null : theme_id,
      is_custom,
      custom_request: is_custom ? custom_request : null,
      booking_code,
      status: is_custom ? 'custom_pending' : 'confirmed',
      payment_id: is_custom ? null : payment_id,
      amount: is_custom ? null : (themeAmount + productsTotal),
      lineItems: normalizedLineItems,
      guest_count: normalizeGuestCount(guest_count),
      special_notes
    });

    await booking.save();
    
    // Capacity already incremented atomically

    // Send confirmation email (non-blocking)
    const user = await User.findById(req.userId);
    const template = emailTemplates.birthdayConfirmation(booking, slot, child, theme);
    try {
      await sendEmail(user.email, template.subject, template.html);
    } catch (emailErr) {
      console.error('BIRTHDAY_BOOKING_EMAIL_ERROR', emailErr.message || emailErr);
    }

    if (booking.status === 'confirmed') {
      await sendBirthdayBookingWhatsAppConfirmation({
        phone: user?.phone,
        customerName: user?.name,
        date: slot?.date,
        time: slot?.start_time,
        childName: child?.name,
        packageOrTheme: theme?.name,
        bookingReference: booking?.booking_code,
        bookingId: booking?._id?.toString()
      });
    }
    notifyAdminsOfOrder({
      orderType: booking.status === 'custom_pending' ? 'Custom Birthday Request' : 'Birthday Booking',
      orderId: booking?.booking_code,
      customerName: user?.name,
      customerEmail: user?.email,
      amount: booking?.amount || 0,
      paymentStatus: booking?.payment_status || 'paid',
      createdAt: booking?.created_at || new Date()
    }).catch((error) => console.error('ADMIN_ORDER_ALERT_FAILED', error?.message || error));

    res.status(201).json({ booking: booking.toJSON() });
  } catch (error) {
    console.error('Create birthday booking error:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// Create birthday booking with cash/cliq payment (offline providers)
router.post('/birthday/offline', authMiddleware, async (req, res) => {
  try {
    const { slot_id, child_id, theme_id, guest_count, special_notes, payment_method, lineItems } = req.body;

    if (!isValidObjectId(slot_id)) {
      return res.status(400).json({ error: 'معرّف موعد الحفل غير صالح' });
    }
    if (!isValidObjectId(child_id)) {
      return res.status(400).json({ error: 'معرّف الطفل غير صالح' });
    }
    if (!isValidObjectId(theme_id)) {
      return res.status(400).json({ error: 'معرّف الثيم غير صالح' });
    }
    
    // Validate payment method
    if (!['cash', 'cliq'].includes(payment_method)) {
      return res.status(400).json({ error: 'طريقة دفع غير صالحة' });
    }
    
    const requestedSlot = await TimeSlot.findById(slot_id).select('date slot_type');
    if (!requestedSlot || requestedSlot.slot_type !== 'birthday') {
      return res.status(400).json({ error: 'Invalid birthday slot' });
    }

    if (!canBookBirthdayDate(requestedSlot.date)) {
      return res.status(400).json({ error: 'يمكن حجز حفلة اليوم التالي قبل الساعة 6:00 مساءً فقط. الرجاء اختيار يوم آخر.' });
    }

    // ATOMIC capacity check for birthday slots
    const slot = await TimeSlot.findOneAndUpdate(
      { 
        _id: slot_id, 
        slot_type: 'birthday',
        $expr: { $lt: ['$booked_count', '$capacity'] }
      },
      { $inc: { booked_count: 1 } },
      { new: true }
    );
    
    if (!slot) {
      const existingSlot = await TimeSlot.findById(slot_id);
      if (!existingSlot) {
        return res.status(400).json({ error: 'Invalid birthday slot' });
      }
      return res.status(400).json({ error: 'عذراً، هذا الموعد محجوز. يرجى اختيار موعد آخر.' });
    }

    // Validate child
    const child = await Child.findOne({ _id: child_id, parent_id: req.userId });
    if (!child) {
      await TimeSlot.findByIdAndUpdate(slot_id, { $inc: { booked_count: -1 } });
      return res.status(400).json({ error: 'طفل غير صالح' });
    }

    // Validate theme
    const theme = await Theme.findById(theme_id);
    if (!theme) {
      await TimeSlot.findByIdAndUpdate(slot_id, { $inc: { booked_count: -1 } });
      return res.status(400).json({ error: 'ثيم غير صالح' });
    }

    const booking_code = `PK-B-${randomUUID().substring(0, 8).toUpperCase()}`;
    const { normalizedLineItems, productsTotal } = await buildLineItems(lineItems);
    const totalAmount = Number(theme?.price || 0) + productsTotal;
    const paymentStatus = payment_method === 'cash' ? 'pending_cash' : 'pending_cliq';

    const booking = new BirthdayBooking({
      user_id: req.userId,
      child_id,
      slot_id,
      theme_id,
      booking_code,
      status: 'confirmed',
      payment_method,
      payment_status: paymentStatus,
      amount: totalAmount,
      lineItems: normalizedLineItems,
      guest_count: normalizeGuestCount(guest_count),
      special_notes
    });

    await booking.save();

    // Send confirmation email (non-blocking)
    const user = await User.findById(req.userId);
    const template = emailTemplates.paymentPending({
      userName: user?.name,
      serviceName: `Birthday - ${theme?.name || 'Peekaboo'}`,
      serviceDate: slot?.date,
      serviceTime: slot?.start_time,
      totalPrice: booking?.amount || totalAmount
    });
    try {
      await sendEmail(user.email, template.subject, template.html);
    } catch (emailErr) {
      console.error('BIRTHDAY_OFFLINE_EMAIL_ERROR', emailErr.message || emailErr);
    }

    await sendBirthdayBookingWhatsAppConfirmation({
      phone: user?.phone,
      customerName: user?.name,
      date: slot?.date,
      time: slot?.start_time,
      childName: child?.name,
      packageOrTheme: theme?.name,
      bookingReference: booking?.booking_code,
      bookingId: booking?._id?.toString(),
      isPending: true,
      paymentMethod: payment_method
    });
    notifyAdminsOfOrder({
      orderType: 'Birthday Booking',
      orderId: booking?.booking_code,
      customerName: user?.name,
      customerEmail: user?.email,
      amount: booking?.amount || totalAmount,
      paymentStatus,
      createdAt: booking?.created_at || new Date()
    }).catch((error) => console.error('ADMIN_ORDER_ALERT_FAILED', error?.message || error));

    res.status(201).json({ 
      booking: booking.toJSON(),
      message: payment_method === 'cash' 
        ? 'تم الحجز بنجاح! الرجاء الدفع نقداً عند الاستقبال.' 
        : 'تم الحجز بنجاح! الرجاء إتمام التحويل عبر CliQ.'
    });
  } catch (error) {
    console.error('Create offline birthday booking error:', error);
    res.status(500).json({ error: 'فشل إنشاء الحجز' });
  }
});

// Get user's birthday bookings
router.get('/birthday', authMiddleware, async (req, res) => {
  try {
    const bookings = await BirthdayBooking.find({ user_id: req.userId })
      .populate('slot_id')
      .populate('child_id')
      .populate('theme_id')
      .sort({ created_at: -1 });

    res.json({ bookings: bookings.map(b => b.toJSON()) });
  } catch (error) {
    console.error('Get birthday bookings error:', error);
    res.status(500).json({ error: 'Failed to get bookings' });
  }
});

// Custom birthday request (no payment)
router.post('/birthday/custom', authMiddleware, async (req, res) => {
  try {
    const { slot_id, child_id, custom_request, guest_count, special_notes } = req.body;

    if (!isValidObjectId(slot_id)) {
      return res.status(400).json({ error: 'معرّف موعد الحفل غير صالح' });
    }
    if (!isValidObjectId(child_id)) {
      return res.status(400).json({ error: 'معرّف الطفل غير صالح' });
    }
    
    const slot = await TimeSlot.findById(slot_id);
    if (!slot || slot.slot_type !== 'birthday') {
      return res.status(400).json({ error: 'Invalid birthday slot' });
    }

    if (!canBookBirthdayDate(slot.date)) {
      return res.status(400).json({ error: 'يمكن حجز حفلة اليوم التالي قبل الساعة 6:00 مساءً فقط. الرجاء اختيار يوم آخر.' });
    }

    const child = await Child.findOne({ _id: child_id, parent_id: req.userId });
    if (!child) {
      return res.status(400).json({ error: 'Invalid child' });
    }

    const booking_code = `PK-BC-${randomUUID().substring(0, 8).toUpperCase()}`;

    const booking = new BirthdayBooking({
      user_id: req.userId,
      child_id,
      slot_id,
      is_custom: true,
      custom_request,
      booking_code,
      status: 'custom_pending',
      guest_count: normalizeGuestCount(guest_count),
      special_notes
    });

    await booking.save();

    // Send confirmation email (non-blocking)
    const user = await User.findById(req.userId);
    const template = emailTemplates.birthdayConfirmation(booking, slot, child, null);
    try {
      await sendEmail(user.email, template.subject, template.html);
    } catch (emailErr) {
      console.error('BIRTHDAY_CUSTOM_EMAIL_ERROR', emailErr.message || emailErr);
    }
    notifyAdminsOfOrder({
      orderType: 'Custom Birthday Request',
      orderId: booking?.booking_code,
      customerName: user?.name,
      customerEmail: user?.email,
      amount: 0,
      paymentStatus: 'pending_quote',
      createdAt: booking?.created_at || new Date()
    }).catch((error) => console.error('ADMIN_ORDER_ALERT_FAILED', error?.message || error));

    res.status(201).json({ 
      booking: booking.toJSON(),
      message: 'Custom theme request submitted. Our team will contact you soon.'
    });
  } catch (error) {
    console.error('Create custom birthday request error:', error);
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

module.exports = router;
