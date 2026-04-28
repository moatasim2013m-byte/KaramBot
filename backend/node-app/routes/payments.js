const express = require('express');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const { randomUUID } = require('crypto');
const PaymentTransaction = require('../models/PaymentTransaction');
const Settings = require('../models/Settings');
const TimeSlot = require('../models/TimeSlot');
const Product = require('../models/Product');
const Child = require('../models/Child');
const Theme = require('../models/Theme');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const HourlyBooking = require('../models/HourlyBooking');
const BirthdayBooking = require('../models/BirthdayBooking');
const UserSubscription = require('../models/UserSubscription');
const User = require('../models/User');
const Coupon = require('../models/Coupon');
const { authMiddleware } = require('../middleware/auth');
const loyaltyRouter = require('./loyalty');
const { awardPoints } = loyaltyRouter;
const { validateCoupon } = require('../utils/coupons');
const { previewRedemptionForUser, redeemForBooking } = require('../utils/loyaltyRedemption');
const {
  sendHourlyBookingWhatsAppConfirmation,
  sendBirthdayBookingWhatsAppConfirmation
} = require('../utils/whatsappBookingConfirmation');
const { notifyAdminsOfOrder } = require('../utils/adminOrderNotifications');
const { generateBookingQrPayload } = require('../utils/bookingQr');
const {
  buildSecureAcceptanceFields,
  getCapitalBankEnv,
  generateTransactionUuid,
  getCyberSourcePaymentUrl,
  validateSecureAcceptanceConfig,
  validateSecureAcceptanceFields,
  verifySecureAcceptanceSignature
} = require('../utils/cybersourceRest');
const {
  createCaptureContext: cybersourceCreateCaptureContext,
  authorizePayment: cybersourceAuthorizePayment
} = require('../utils/cybersourceUnifiedCheckout');
const router = express.Router();
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);
const PAYMENT_PROVIDERS = {
  MANUAL: 'manual',
  CAPITAL_BANK: 'capital_bank_secure_acceptance',
  CAPITAL_BANK_REST_LEGACY: 'capital_bank_rest'
};
const PAYMENT_PROVIDER_ALIASES = {
  capital_bank: PAYMENT_PROVIDERS.CAPITAL_BANK,
  cybersource: PAYMENT_PROVIDERS.CAPITAL_BANK,
  cyber_source: PAYMENT_PROVIDERS.CAPITAL_BANK,
  secure_acceptance: PAYMENT_PROVIDERS.CAPITAL_BANK
};
const requestedPaymentProvider = (process.env.PAYMENT_PROVIDER || PAYMENT_PROVIDERS.MANUAL).toLowerCase();
const supportedPaymentProviders = new Set(Object.values(PAYMENT_PROVIDERS));
const normalizedRequestedProvider = PAYMENT_PROVIDER_ALIASES[requestedPaymentProvider] || requestedPaymentProvider;
const paymentProvider = normalizedRequestedProvider === PAYMENT_PROVIDERS.CAPITAL_BANK_REST_LEGACY
  ? PAYMENT_PROVIDERS.CAPITAL_BANK
  : (supportedPaymentProviders.has(normalizedRequestedProvider) ? normalizedRequestedProvider : PAYMENT_PROVIDERS.MANUAL);
const DEV_ENVIRONMENTS = new Set(['development', 'dev', 'local', 'test']);
const DB_PROVIDER_CAPITAL_BANK = 'capital_bank';
const FINALIZATION_LOCK_TIMEOUT_MS = Number.parseInt(process.env.PAYMENT_FINALIZATION_LOCK_TIMEOUT_MS || '', 10) || (5 * 60 * 1000);
const isLoyaltyDuplicateError = (error) => {
  return error?.code === 'LOYALTY_DUPLICATE_REFERENCE' || error?.code === 11000;
};
const maskConfigValue = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (normalized.length <= 6) return '***';
  return `${normalized.slice(0, 3)}***${normalized.slice(-3)}`;
};
const maybeAwardProductLoyaltyPoints = async (transaction) => {
  const points = Math.round(Number(transaction?.amount || 0) * 10);
  if (!transaction?.user_id || points <= 0) return;
  try {
    await awardPoints(
      transaction.user_id,
      points,
      'نقاط على شراء منتج',
      'product',
      transaction._id.toString()
    );
    if (DEV_ENVIRONMENTS.has(process.env.NODE_ENV)) {
      console.log('LOYALTY_POINTS_AWARDED', {
        userId: transaction.user_id.toString(),
        refType: 'product',
        refId: transaction._id.toString(),
        points
      });
    }
  } catch (error) {
    if (!isLoyaltyDuplicateError(error)) throw error;
  }
};
const capitalBankConfig = {
  merchantId: String(process.env.CAPITAL_BANK_MERCHANT_ID || process.env.CYBERSOURCE_MERCHANT_ID || '').trim(),
  profileId: String(process.env.CAPITAL_BANK_PROFILE_ID || '').trim(),
  accessKey: String(process.env.CAPITAL_BANK_ACCESS_KEY || '').trim(),
  secretKey: String(process.env.CAPITAL_BANK_SECRET_KEY || '').trim()
};
const requestedCapitalBankProvider = paymentProvider === PAYMENT_PROVIDERS.CAPITAL_BANK;
const missingCapitalBankEnvVars = [
  ['CAPITAL_BANK_MERCHANT_ID (or CYBERSOURCE_MERCHANT_ID)', capitalBankConfig.merchantId],
  ['CAPITAL_BANK_PROFILE_ID (Account ID)', capitalBankConfig.profileId],
  ['CAPITAL_BANK_ACCESS_KEY', capitalBankConfig.accessKey],
  ['CAPITAL_BANK_SECRET_KEY', capitalBankConfig.secretKey]
].filter(([, value]) => !value).map(([name]) => name);
const capitalBankRestReady = requestedCapitalBankProvider && missingCapitalBankEnvVars.length === 0;
let hasLoggedCapitalBankFallbackOnInitiate = false;
if (!supportedPaymentProviders.has(normalizedRequestedProvider)) {
  console.warn(`[Payments] Unsupported PAYMENT_PROVIDER "${requestedPaymentProvider}". Falling back to ${PAYMENT_PROVIDERS.MANUAL}. Supported values: ${Object.values(PAYMENT_PROVIDERS).join(', ')}`);
}
if (requestedCapitalBankProvider) {
  if (capitalBankRestReady) {
    const capitalBankEnv = getCapitalBankEnv();
    console.log(`[Payments] Active provider: ${paymentProvider} (CyberSource Secure Acceptance)`);
    console.log(`[Payments] Capital Bank environment: ${capitalBankEnv}`);
    console.log(`[Payments] Capital Bank endpoint: ${getCyberSourcePaymentUrl()}`);
    console.log(`[Payments] Profile ID: ${maskConfigValue(capitalBankConfig.profileId)}`);
    if (!DEV_ENVIRONMENTS.has(process.env.NODE_ENV) && capitalBankEnv === 'test') {
      console.warn('[Payments] WARNING: production runtime is configured with CAPITAL_BANK_ENV=test');
    }
  } else {
    console.warn(`[Payments] Active provider fallback: manual. Missing env vars for ${paymentProvider}: ${missingCapitalBankEnvVars.join(', ')}`);
  }
} else {
  console.log(`[Payments] Active provider: ${PAYMENT_PROVIDERS.MANUAL}`);
}
const getEffectiveProvider = () => {
  if (capitalBankRestReady) return paymentProvider;
  return PAYMENT_PROVIDERS.MANUAL;
};
const isCapitalBankProviderActive = () => getEffectiveProvider() === PAYMENT_PROVIDERS.CAPITAL_BANK;
const ensureHttpsForCapitalBank = (req, res, next) => {
  const forwardedProto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  const isLocal = DEV_ENVIRONMENTS.has(process.env.NODE_ENV);
  if (protocol !== 'https' && !isLocal) {
    return res.status(400).json({ error: 'HTTPS is required for payment endpoints' });
  }
  return next();
};
const normalizeOrigin = (value) => {
  if (!value || typeof value !== 'string') return null;
  try {
    const candidate = new URL(value);
    if (!['http:', 'https:'].includes(candidate.protocol)) return null;
    return candidate.origin;
  } catch (_) {
    return null;
  }
};
const getAllowedFrontendOrigins = () => {
  const configured = [process.env.FRONTEND_URL, process.env.CORS_ORIGINS]
    .filter(Boolean)
    .flatMap((entry) => entry.split(',').map((item) => item.trim()))
    .map(normalizeOrigin)
    .filter(Boolean);
  return new Set(configured);
};
const resolveFrontendOrigin = (originUrl, req) => {
  const allowedOrigins = getAllowedFrontendOrigins();
  const requestOrigin = normalizeOrigin(req.get('origin'));
  const payloadOrigin = normalizeOrigin(originUrl);
  if (payloadOrigin && allowedOrigins.has(payloadOrigin)) return payloadOrigin;
  if (requestOrigin && allowedOrigins.has(requestOrigin)) return requestOrigin;
  const configuredFrontend = normalizeOrigin(process.env.FRONTEND_URL);
  if (configuredFrontend) return configuredFrontend;
  return null;
};
const resolveOrderTransaction = async (orderId, userId) => {
  const search = [
    { _id: orderId },
    { session_id: orderId },
    { reference_id: orderId }
  ];
  for (const criteria of search) {
    try {
      const record = await PaymentTransaction.findOne({ ...criteria, user_id: userId });
      if (record) return record;
    } catch (_err) {
      // ignore invalid ObjectId for _id lookup
    }
  }
  return null;
};
// Morning (Happy Hour) price: 3.5 JD per hour
const MORNING_PRICE_PER_HOUR = 3.5;
// Get hourly price from Settings or use defaults
const getHourlyPrice = async (duration_hours = 2, slot_start_time = null) => {
  const hours = parseInt(duration_hours) || 2;
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
const getBirthdayThemePrice = async (themeId) => {
  const Theme = require('../models/Theme');
  const theme = await Theme.findById(themeId);
  return parseFloat(theme?.price) || 100.00;
};
const getSubscriptionPrice = async (planId) => {
  const SubscriptionPlan = require('../models/SubscriptionPlan');
  const plan = await SubscriptionPlan.findById(planId);
  return parseFloat(plan?.price) || 50.00;
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
  if (productIds.length === 0) return { normalizedLineItems: [], productsTotal: 0 };
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
      productId: product._id.toString(),
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
const normalizeDurationHours = (value, fallback = 2) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(4, Math.max(1, parsed));
};
const generateQRCode = async (data) => {
  try {
    return await QRCode.toDataURL(data, { width: 300, margin: 2 });
  } catch (_error) {
    return null;
  }
};
const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
};
const parseLineItemsFromMetadata = (metadata) => {
  const raw = parseJsonArray(metadata?.line_items);
  return raw.map((item) => ({
    product_id: item?.productId || item?.product_id,
    sku: item?.sku,
    nameAr: item?.nameAr,
    nameEn: item?.nameEn,
    unitPriceJD: Number(item?.unitPriceJD || 0),
    quantity: Number(item?.quantity || 0),
    lineTotalJD: Number(item?.lineTotalJD || 0)
  })).filter((item) => item.product_id && item.quantity > 0);
};

const finalizePaidTransaction = async (transaction) => {
  const paymentId = transaction.payment_id || transaction.session_id;
  const metadata = transaction.metadata || {};
  const customer = await User.findById(transaction.user_id).select('name email').lean();

  // Phase 6 — loyalty redemption is applied after the booking is persisted
  // and the payment is confirmed paid. Wrapped here so both the "new
  // bookings created" path and the "already finalized, return existing"
  // path both call the idempotent deduction. Failure to deduct does NOT
  // roll back the booking — the ledger is re-attempted on the next
  // finalize retry (unique index makes this safe).
  const maybeDeductLoyaltyForHourly = async (bookings) => {
    const pointsUsed = Number(metadata.loyalty_points_used || 0);
    const discountJd = Number(metadata.loyalty_discount_jd || 0);
    if (!bookings || bookings.length === 0) return;
    if (pointsUsed <= 0 || discountJd <= 0) return;
    try {
      await redeemForBooking({
        userId: transaction.user_id,
        bookingId: bookings[0]._id || bookings[0].id,
        pointsToUse: pointsUsed,
        discountJd
      });
    } catch (error) {
      // Never surface to the caller — ledger is the source of truth and
      // a future retry will post the entry. Logged for ops visibility.
      console.error('LOYALTY_REDEEM_FINALIZE_FAILED', {
        transactionId: transaction._id?.toString(),
        message: error?.message || String(error)
      });
    }
  };

  if (transaction.type === 'hourly') {
    const slotId = metadata.slot_id;
    const childIds = [...new Set(parseJsonArray(metadata.child_ids).map((id) => String(id).trim()).filter(Boolean))];
    if (!isValidObjectId(slotId) || childIds.length === 0 || !childIds.every((id) => isValidObjectId(id))) {
      throw new Error('بيانات الحجز غير مكتملة');
    }

    const existing = await HourlyBooking.find({ user_id: transaction.user_id, payment_id: paymentId }).sort({ created_at: 1 });
    if (existing.length > 0) {
      await maybeDeductLoyaltyForHourly(existing);
      return { resourceType: 'hourly', bookings: existing.map((b) => b.toJSON()) };
    }

    const slot = await TimeSlot.findOneAndUpdate(
      { _id: slotId, slot_type: 'hourly', $expr: { $lte: [{ $add: ['$booked_count', childIds.length] }, '$capacity'] } },
      { $inc: { booked_count: childIds.length } },
      { new: true }
    );
    if (!slot) throw new Error('الموعد غير متاح');

    try {
      const validChildren = await Child.find({ _id: { $in: childIds }, parent_id: transaction.user_id });
      if (validChildren.length !== childIds.length) throw new Error('بيانات الطفل غير صالحة');
      const hours = normalizeDurationHours(metadata.duration_hours);
      const pricePerChild = Number(transaction.amount || 0) / childIds.length;
      const lineItems = parseLineItemsFromMetadata(metadata);
      const bookings = [];
      for (const childId of childIds) {
        const booking_code = `PK-H-${randomUUID().substring(0, 8).toUpperCase()}`;
        const { qr_token, qr_code } = await generateBookingQrPayload();
        const booking = await HourlyBooking.create({
          user_id: transaction.user_id,
          child_id: childId,
          slot_id: slotId,
          duration_hours: hours,
          custom_notes: metadata.custom_notes || '',
          qr_code,
          qr_token,
          qr_status: 'unused',
          booking_code,
          status: 'confirmed',
          payment_id: paymentId,
          payment_method: 'card',
          payment_status: 'paid',
          amount: pricePerChild,
          lineItems
        });
        bookings.push(booking);
      }

      if (metadata.coupon_code) {
        await Coupon.findOneAndUpdate({ code: metadata.coupon_code }, { $inc: { redeemed_count: 1 } });
      }

      // Phase 6 — deduct loyalty AFTER bookings are persisted. Runs only
      // for paid card transactions (this path). Idempotent across retries.
      await maybeDeductLoyaltyForHourly(bookings);

      // Re-hydrate bookings from DB so the response reflects the redemption
      // markers (loyalty_redeemed_points / loyalty_redemption_jd /
      // loyalty_redeemed_at) that maybeDeductLoyaltyForHourly stamped via
      // a separate updateOne. The in-memory Mongoose docs above were
      // serialised pre-stamp; the DB row is the truth.
      const freshBookings = await HourlyBooking.find({
        _id: { $in: bookings.map((b) => b._id) }
      }).sort({ created_at: 1 });

      notifyAdminsOfOrder({
        orderType: 'Hourly Booking',
        orderId: bookings[0]?.booking_code || paymentId,
        customerName: customer?.name,
        customerEmail: customer?.email,
        amount: Number(transaction.amount || 0),
        paymentStatus: 'paid',
        createdAt: bookings[0]?.created_at || new Date()
      }).catch((error) => console.error('ADMIN_ORDER_ALERT_FAILED', error?.message || error));

      return { resourceType: 'hourly', bookings: (freshBookings.length ? freshBookings : bookings).map((b) => b.toJSON()) };
    } catch (error) {
      await TimeSlot.findByIdAndUpdate(slotId, { $inc: { booked_count: -childIds.length } });
      throw error;
    }
  }

  if (transaction.type === 'birthday') {
    const existing = await BirthdayBooking.findOne({ user_id: transaction.user_id, payment_id: paymentId });
    if (existing) return { resourceType: 'birthday', booking: existing.toJSON() };

    const slotId = metadata.slot_id;
    const childId = parseJsonArray(metadata.child_ids)[0];
    const themeId = metadata.theme_id;
    if (!isValidObjectId(slotId) || !isValidObjectId(childId) || !isValidObjectId(themeId)) {
      throw new Error('بيانات حجز الحفلة غير مكتملة');
    }
    const slot = await TimeSlot.findOneAndUpdate(
      { _id: slotId, slot_type: 'birthday', $expr: { $lt: ['$booked_count', '$capacity'] } },
      { $inc: { booked_count: 1 } },
      { new: true }
    );
    if (!slot) throw new Error('موعد الحفلة غير متاح');
    try {
      const [child, theme] = await Promise.all([
        Child.findOne({ _id: childId, parent_id: transaction.user_id }),
        Theme.findById(themeId)
      ]);
      if (!child || !theme) throw new Error('بيانات الحجز غير صالحة');
      const birthdayGuestCount = Number.parseInt(metadata.guest_count, 10);
      const booking = await BirthdayBooking.create({
        user_id: transaction.user_id,
        child_id: childId,
        slot_id: slotId,
        theme_id: themeId,
        booking_code: `PK-B-${randomUUID().substring(0, 8).toUpperCase()}`,
        status: 'confirmed',
        payment_id: paymentId,
        payment_method: 'card',
        payment_status: 'paid',
        amount: Number(transaction.amount || 0),
        ...(Number.isFinite(birthdayGuestCount) && birthdayGuestCount > 0
          ? { guest_count: birthdayGuestCount }
          : {}),
        ...(typeof metadata.special_notes === 'string' && metadata.special_notes.trim()
          ? { special_notes: metadata.special_notes.trim() }
          : {}),
        lineItems: parseLineItemsFromMetadata(metadata)
      });
      notifyAdminsOfOrder({
        orderType: 'Birthday Booking',
        orderId: booking?.booking_code || paymentId,
        customerName: customer?.name,
        customerEmail: customer?.email,
        amount: Number(transaction.amount || 0),
        paymentStatus: 'paid',
        createdAt: booking?.created_at || new Date()
      }).catch((error) => console.error('ADMIN_ORDER_ALERT_FAILED', error?.message || error));
      return { resourceType: 'birthday', booking: booking.toJSON() };
    } catch (error) {
      await TimeSlot.findByIdAndUpdate(slotId, { $inc: { booked_count: -1 } });
      throw error;
    }
  }

  if (transaction.type === 'subscription') {
    const existing = await UserSubscription.findOne({ user_id: transaction.user_id, payment_id: paymentId });
    if (existing) return { resourceType: 'subscription', subscription: existing.toJSON() };
    const planId = metadata.plan_id;
    const childId = parseJsonArray(metadata.child_ids)[0];
    if (!isValidObjectId(planId) || !isValidObjectId(childId)) {
      throw new Error('بيانات الاشتراك غير مكتملة');
    }
    const [plan, child] = await Promise.all([
      SubscriptionPlan.findById(planId),
      Child.findOne({ _id: childId, parent_id: transaction.user_id })
    ]);
    if (!plan || !plan.is_active || !child) throw new Error('بيانات الاشتراك غير صالحة');
    const subscription = await UserSubscription.create({
      user_id: transaction.user_id,
      child_id: childId,
      plan_id: planId,
      remaining_visits: plan.visits,
      expires_at: null,
      payment_id: paymentId,
      payment_method: 'card',
      payment_status: 'paid',
      status: 'pending'
    });
    notifyAdminsOfOrder({
      orderType: 'Subscription',
      orderId: subscription?._id?.toString(),
      customerName: customer?.name,
      customerEmail: customer?.email,
      amount: Number(transaction.amount || 0),
      paymentStatus: 'paid',
      createdAt: subscription?.created_at || new Date()
    }).catch((error) => console.error('ADMIN_ORDER_ALERT_FAILED', error?.message || error));
    return { resourceType: 'subscription', subscription: subscription.toJSON() };
  }

  throw new Error('Unsupported transaction type');
};

const sendWhatsAppAfterSuccessfulBookingFinalization = async (transaction, finalizationResult) => {
  if (!transaction || !finalizationResult || !['hourly', 'birthday'].includes(finalizationResult.resourceType)) {
    return { ok: false, skipped: true, reason: 'not_booking' };
  }

  const user = await User.findById(transaction.user_id).select('name phone');
  if (!user?.phone) {
    return { ok: false, skipped: true, reason: 'missing_phone' };
  }

  if (finalizationResult.resourceType === 'hourly') {
    const firstBooking = finalizationResult.bookings?.[0];
    if (!firstBooking?._id) return { ok: false, skipped: true, reason: 'missing_booking' };

    const bookingDoc = await HourlyBooking.findById(firstBooking._id).populate('slot_id');
    if (!bookingDoc) return { ok: false, skipped: true, reason: 'booking_not_found' };

    return sendHourlyBookingWhatsAppConfirmation({
      phone: user.phone,
      customerName: user.name,
      date: bookingDoc.slot_id?.date,
      time: bookingDoc.slot_id?.start_time,
      childCount: finalizationResult.bookings?.length || 1,
      durationHours: bookingDoc.duration_hours,
      bookingReference: bookingDoc.booking_code,
      bookingId: bookingDoc._id?.toString()
    });
  }

  const birthdayBooking = finalizationResult.booking;
  if (!birthdayBooking?._id) return { ok: false, skipped: true, reason: 'missing_booking' };

  const bookingDoc = await BirthdayBooking.findById(birthdayBooking._id)
    .populate('slot_id')
    .populate('child_id')
    .populate('theme_id');
  if (!bookingDoc) return { ok: false, skipped: true, reason: 'booking_not_found' };

  return sendBirthdayBookingWhatsAppConfirmation({
    phone: user.phone,
    customerName: user.name,
    date: bookingDoc.slot_id?.date,
    time: bookingDoc.slot_id?.start_time,
    childName: bookingDoc.child_id?.name,
    packageOrTheme: bookingDoc.theme_id?.name,
    bookingReference: bookingDoc.booking_code,
    bookingId: bookingDoc._id?.toString()
  });
};

const finalizeTransactionIfPaid = async (transaction) => {
  if (!transaction || transaction.status !== 'paid') return transaction;
  if (transaction.metadata?.finalization?.status === 'succeeded') return transaction;

  const staleLockCutoff = new Date(Date.now() - FINALIZATION_LOCK_TIMEOUT_MS);
  const locked = await PaymentTransaction.findOneAndUpdate(
    {
      _id: transaction._id,
      $or: [
        { 'metadata.finalization.status': { $exists: false } },
        { 'metadata.finalization.status': { $in: ['failed'] } },
        {
          'metadata.finalization.status': 'processing',
          'metadata.finalization.started_at': { $lt: staleLockCutoff }
        }
      ]
    },
    {
      $set: {
        'metadata.finalization.status': 'processing',
        'metadata.finalization.started_at': new Date()
      }
    },
    { new: true }
  );

  if (!locked) {
    return PaymentTransaction.findById(transaction._id);
  }

  try {
    const result = await finalizePaidTransaction(locked);
    const whatsappResult = await sendWhatsAppAfterSuccessfulBookingFinalization(locked, result);

    return PaymentTransaction.findByIdAndUpdate(
      locked._id,
      {
        $set: {
          'metadata.finalization.status': 'succeeded',
          'metadata.finalization.completed_at': new Date(),
          'metadata.finalization.result': result,
          'metadata.finalization.whatsapp_confirmation': {
            attempted: !whatsappResult?.skipped,
            sent: Boolean(whatsappResult?.ok),
            reason: whatsappResult?.reason || null
          }
        }
      },
      { new: true }
    );
  } catch (error) {
    await PaymentTransaction.findByIdAndUpdate(locked._id, {
      $set: {
        'metadata.finalization.status': 'failed',
        'metadata.finalization.error': error.message,
        'metadata.finalization.completed_at': new Date()
      }
    });
    throw error;
  }
};
// Get hourly pricing info (public endpoint for frontend)
router.get('/hourly-pricing', async (req, res) => {
  try {
    const { timeMode } = req.query;
    
    // Morning mode: flat 3.5 JD per hour
    if (timeMode === 'morning') {
      return res.json({
        pricing: [
          { hours: 1, price: 3.5, label: '1 Hour', label_ar: 'ساعة واحدة' },
          { hours: 2, price: 7, label: '2 Hours', label_ar: 'ساعتان' },
          { hours: 3, price: 10.5, label: '3 Hours', label_ar: '3 ساعات' }
        ],
        extra_hour_price: 3.5,
        extra_hour_text: 'كل ساعة = 3.5 دينار فقط (عرض الصباح)',
        currency: 'JD',
        timeMode: 'morning'
      });
    }
    
    // Afternoon mode: standard pricing
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
    res.json({
      pricing: [
        { hours: 1, price: prices.hourly_1hr, label: '1 Hour', label_ar: 'ساعة واحدة' },
        { hours: 2, price: prices.hourly_2hr, label: '2 Hours', label_ar: 'ساعتان', best_value: true },
        { hours: 3, price: prices.hourly_3hr, label: '3 Hours', label_ar: '3 ساعات' }
      ],
      extra_hour_price: prices.hourly_extra_hr,
      extra_hour_text: 'كل ساعة إضافية بعد الساعتين = 3 دنانير فقط',
      currency: 'JD',
      timeMode: 'afternoon'
    });
  } catch (error) {
    console.error('Get hourly pricing error:', error);
    res.status(500).json({ error: 'Failed to get pricing' });
  }
});
// Create checkout session
router.post('/create-checkout', authMiddleware, async (req, res) => {
  try {
    const effectiveProvider = getEffectiveProvider();
    // Manual payment mode
    if (effectiveProvider === PAYMENT_PROVIDERS.MANUAL) {
      return res.status(200).json({
        message: 'Manual payment only (cash / cliq)',
        payment_method: 'manual'
      });
    }
    const {
      type,
      reference_id,
      origin_url,
      duration_hours,
      custom_notes,
      timeMode,
      lineItems,
      coupon_code,
      guest_count,
      special_notes
    } = req.body;
    if (!type) {
      return res.status(400).json({ error: 'type is required' });
    }
    if (reference_id && !isValidObjectId(reference_id)) {
      return res.status(400).json({ error: 'Invalid reference id' });
    }
    const frontendOrigin = resolveFrontendOrigin(origin_url, req);
    if (!frontendOrigin) {
      return res.status(400).json({ error: 'Invalid or unauthorized frontend origin' });
    }
    const { normalizedLineItems, productsTotal } = await buildLineItems(lineItems);
    let amount;
    let metadata = { type, user_id: req.userId.toString() };
    if (normalizedLineItems.length > 0) {
      metadata.line_items = JSON.stringify(normalizedLineItems);
    }
    // Get amount from server-side pricing
    switch (type) {
      case 'hourly': {
        const hours = parseInt(duration_hours) || 2;
        const childIds = Array.isArray(req.body.child_ids)
          ? req.body.child_ids
          : (req.body.child_id ? [req.body.child_id] : []);
        if (childIds.length > 0 && !childIds.every((id) => isValidObjectId(id))) {
          return res.status(400).json({ error: 'Invalid child id' });
        }
        const childCount = childIds.length || 1;
        const slotStartTime = req.body.slot_start_time || null;
        // Check capacity before creating checkout
        const slot = await TimeSlot.findById(reference_id);
        if (!slot) {
          return res.status(400).json({ error: 'الوقت غير صالح' });
        }
        const availableSpots = slot.capacity - slot.booked_count;
        if (availableSpots < childCount) {
          return res.status(400).json({ error: `عذراً، المتاح ${availableSpots} مكان فقط. اخترت ${childCount} أطفال.` });
        }
        const basePrice = await getHourlyPrice(hours, slotStartTime);
        amount = (basePrice * childCount) + productsTotal;
        metadata.slot_id = reference_id;
        metadata.duration_hours = hours;
        metadata.child_ids = JSON.stringify(childIds);
        if (slotStartTime) metadata.slot_start_time = slotStartTime;
        if (custom_notes) metadata.custom_notes = custom_notes;
        break;
      }
      case 'birthday': {
        if (!req.body.theme_id) {
          return res.status(400).json({ error: 'theme_id required for birthday booking' });
        }
        if (!isValidObjectId(req.body.theme_id)) {
          return res.status(400).json({ error: 'Invalid theme id' });
        }
        amount = (await getBirthdayThemePrice(req.body.theme_id)) + productsTotal;
        metadata.slot_id = reference_id;
        metadata.theme_id = req.body.theme_id;
        const normalizedGuestCount = Number.parseInt(guest_count, 10);
        if (Number.isFinite(normalizedGuestCount) && normalizedGuestCount > 0) {
          metadata.guest_count = normalizedGuestCount;
        }
        if (typeof special_notes === 'string' && special_notes.trim()) {
          metadata.special_notes = special_notes.trim();
        }
        break;
      }
      case 'subscription': {
        if (!reference_id) {
          return res.status(400).json({ error: 'plan_id required for subscription' });
        }
        amount = await getSubscriptionPrice(reference_id);
        metadata.plan_id = reference_id;
        break;
      }
      default:
        return res.status(400).json({ error: 'Invalid payment type' });
    }
    // Handle child_ids for multi-child booking (backward compat with child_id)
    if (req.body.child_ids && req.body.child_ids.length > 0) {
      metadata.child_ids = JSON.stringify(req.body.child_ids);
    } else if (req.body.child_id) {
      metadata.child_ids = JSON.stringify([req.body.child_id]);
    }
    // Apply coupon discount when provided
    if (coupon_code) {
      const couponValidation = await validateCoupon({
        code: coupon_code,
        amount,
        type
      });
      if (!couponValidation.valid) {
        return res.status(400).json({ error: couponValidation.message });
      }
      const { normalizedCode, discountAmount, finalAmount } = couponValidation;
      amount = finalAmount;
      metadata.coupon_code = normalizedCode;
      metadata.discount_amount = discountAmount;
    }

    // Phase 6 — loyalty redemption. Applied AFTER coupon so the conversion
    // rule is evaluated against the actual payable amount. Scope restriction:
    // redemption is only applied to hourly checkouts in this phase. The
    // cash / cliq path (routes/bookings.js /hourly/offline) explicitly
    // rejects redemption because payment finalization there is not
    // trustworthy enough for safe deduction.
    //
    // The amount sent to the payment gateway is the post-redemption amount.
    // Points are NOT deducted here — only recorded in metadata. Deduction
    // happens in finalizePaidTransaction() after the payment succeeds.
    const rawLoyaltyPoints = req.body.loyalty_points;
    const useMaxLoyalty = req.body.use_max_loyalty === true || req.body.use_max_loyalty === 'true';
    const loyaltyPointsRequested = Number(rawLoyaltyPoints);
    const wantsLoyalty = useMaxLoyalty || (Number.isFinite(loyaltyPointsRequested) && loyaltyPointsRequested > 0);

    if (wantsLoyalty) {
      if (type !== 'hourly') {
        return res.status(400).json({ error: 'استرداد نقاط الولاء متاح فقط للحجز بالساعة حالياً' });
      }
      const preview = await previewRedemptionForUser({
        userId: req.userId,
        amountJd: amount,
        pointsRequested: Number.isFinite(loyaltyPointsRequested) ? loyaltyPointsRequested : 0,
        useMax: useMaxLoyalty
      });
      if (!preview.ok) {
        const reasonMap = {
          loyalty_disabled: 'نظام الولاء غير مفعل',
          redemption_disabled: 'استرداد النقاط غير مفعل حالياً',
          below_min_points: 'لم تصل إلى الحد الأدنى للاسترداد',
          exceeds_limit: 'تتجاوز الحد الأقصى المسموح لهذا الحجز',
          exceeds_amount: 'الخصم أكبر من قيمة الحجز',
          zero_requested: 'أدخل عدد النقاط لاستخدامها',
          amount_zero: 'قيمة الحجز غير صالحة',
          no_headroom: 'لا يمكن الاسترداد على هذا الحجز',
          rounds_to_zero: 'عدد النقاط غير كافٍ لخصم مرئي',
          invalid_conversion: 'إعدادات الاسترداد غير صالحة'
        };
        return res.status(400).json({
          error: reasonMap[preview.reason] || 'لا يمكن استخدام نقاط الولاء الآن',
          reason: preview.reason,
          maxPointsAllowed: preview.maxPointsAllowed
        });
      }
      amount = Math.max(0, amount - preview.discountJd);
      metadata.loyalty_points_used = preview.pointsToUse;
      metadata.loyalty_discount_jd = preview.discountJd;
      metadata.loyalty_conversion = preview.conversion;
    }

    // Ensure amount is a valid float
    amount = parseFloat(amount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid price configuration' });
    }
    console.log('Creating checkout session:', { type, amount, metadata });
    let sessionId;
    let checkoutUrl;
    const currency = 'JOD';
    if (effectiveProvider === PAYMENT_PROVIDERS.CAPITAL_BANK) {
      sessionId = `cb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      metadata.frontend_origin = frontendOrigin;
      checkoutUrl = `/payment/capital-bank/${sessionId}`;
    }
    // Create pending payment transaction
    const transaction = new PaymentTransaction({
      session_id: sessionId,
      user_id: req.userId,
      amount,
      currency,
      status: 'pending',
      type,
      reference_id,
      provider: effectiveProvider === PAYMENT_PROVIDERS.CAPITAL_BANK ? DB_PROVIDER_CAPITAL_BANK : effectiveProvider,
      metadata
    });
    await transaction.save();
    console.log('Checkout session created:', sessionId, 'provider:', effectiveProvider);
    res.json({
      url: checkoutUrl,
      session_id: sessionId,
      payment_provider: effectiveProvider === PAYMENT_PROVIDERS.CAPITAL_BANK ? DB_PROVIDER_CAPITAL_BANK : effectiveProvider
    });
  } catch (error) {
    console.error('Create checkout error:', error);
    res.status(500).json({
      error: 'Failed to create checkout session',
      details: error.message
    });
  }
});
// Get checkout status
router.get('/status/:sessionId', authMiddleware, async (req, res) => {
  try {
    const effectiveProvider = getEffectiveProvider();
    const { sessionId } = req.params;
    const transaction = await PaymentTransaction.findOne({ session_id: sessionId, user_id: req.userId });
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    if (effectiveProvider === PAYMENT_PROVIDERS.CAPITAL_BANK) {
      return res.json({
        status: transaction.status,
        payment_status: transaction.payment_status || (transaction.status === 'paid' ? 'paid' : 'pending'),
        payment_id: transaction.payment_id,
        metadata: transaction.metadata,
        payment_provider: effectiveProvider === PAYMENT_PROVIDERS.CAPITAL_BANK ? DB_PROVIDER_CAPITAL_BANK : effectiveProvider
      });
    }
    return res.json({
      status: transaction.status,
      payment_status: transaction.payment_status || 'pending',
      payment_id: transaction.payment_id,
      metadata: transaction.metadata,
      payment_provider: effectiveProvider === PAYMENT_PROVIDERS.CAPITAL_BANK ? DB_PROVIDER_CAPITAL_BANK : effectiveProvider
    });
  } catch (error) {
    console.error('Get checkout status error:', error);
    res.status(500).json({ error: 'Failed to get checkout status' });
  }
});

router.post('/finalize/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const transaction = await PaymentTransaction.findOne({ session_id: sessionId, user_id: req.userId });
    if (!transaction) {
      return res.status(404).json({ error: 'لم يتم العثور على عملية الدفع' });
    }
    if (transaction.status !== 'paid') {
      return res.status(409).json({ error: 'عملية الدفع لم تكتمل بعد', status: transaction.status });
    }

    if (transaction.metadata?.finalization?.status === 'succeeded' && transaction.metadata?.finalization?.result) {
      return res.status(200).json({ success: true, ...transaction.metadata.finalization.result });
    }

    const staleLockCutoff = new Date(Date.now() - FINALIZATION_LOCK_TIMEOUT_MS);
    const locked = await PaymentTransaction.findOneAndUpdate(
      {
        _id: transaction._id,
        $or: [
          { 'metadata.finalization.status': { $exists: false } },
          { 'metadata.finalization.status': { $in: ['failed'] } },
          {
            'metadata.finalization.status': 'processing',
            'metadata.finalization.started_at': { $lt: staleLockCutoff }
          }
        ]
      },
      {
        $set: {
          'metadata.finalization.status': 'processing',
          'metadata.finalization.started_at': new Date()
        }
      },
      { new: true }
    );

    if (!locked) {
      const latest = await PaymentTransaction.findById(transaction._id);
      if (latest?.metadata?.finalization?.status === 'succeeded' && latest?.metadata?.finalization?.result) {
        return res.status(200).json({ success: true, ...latest.metadata.finalization.result });
      }
      return res.status(202).json({ success: false, processing: true, message: 'جاري إنهاء الحجز...' });
    }

    try {
      const result = await finalizePaidTransaction(locked);
      const whatsappResult = await sendWhatsAppAfterSuccessfulBookingFinalization(locked, result);
      const finalized = await PaymentTransaction.findByIdAndUpdate(
        locked._id,
        {
          $set: {
            'metadata.finalization.status': 'succeeded',
            'metadata.finalization.completed_at': new Date(),
            'metadata.finalization.result': result,
            'metadata.finalization.whatsapp_confirmation': {
              attempted: !whatsappResult?.skipped,
              sent: Boolean(whatsappResult?.ok),
              reason: whatsappResult?.reason || null
            }
          }
        },
        { new: true }
      );
      return res.status(200).json({ success: true, ...(finalized?.metadata?.finalization?.result || result) });
    } catch (error) {
      await PaymentTransaction.findByIdAndUpdate(locked._id, {
        $set: {
          'metadata.finalization.status': 'failed',
          'metadata.finalization.error': error.message,
          'metadata.finalization.completed_at': new Date()
        }
      });
      return res.status(422).json({ error: error.message || 'فشل إنشاء الحجز بعد الدفع' });
    }
  } catch (error) {
    console.error('Finalize transaction error:', error);
    return res.status(500).json({ error: 'فشل إنهاء عملية الحجز' });
  }
});
const sanitizeReason = (reason = 'payment_failed') => String(reason).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80) || 'payment_failed';
const mapDecisionToStatus = (decision = '') => {
  const normalized = String(decision || '').toUpperCase();
  if (normalized === 'ACCEPT') {
    return { status: 'paid', paymentStatus: 'paid' };
  }
  if (normalized === 'REVIEW' || normalized === 'PENDING') {
    return { status: 'pending', paymentStatus: 'pending' };
  }
  if (!normalized) {
    return { status: null, paymentStatus: null };
  }
  return { status: 'failed', paymentStatus: normalized.toLowerCase() };
};
const isCyberSourceNotifyRequest = (req) => {
  const signature = String(req.body?.signature || req.query?.signature || '').trim();
  const signedFieldNames = String(req.body?.signed_field_names || req.query?.signed_field_names || '').trim();
  return Boolean(signature) && Boolean(signedFieldNames);
};

const resolveBillingDetails = (transaction, req) => {
  const metadata = transaction?.metadata || {};
  const body = req.body || {};

  return {
    billToForename: body.bill_to_forename || metadata.bill_to_forename || 'Peekaboo',
    billToSurname: body.bill_to_surname || metadata.bill_to_surname || 'Customer',
    billToEmail: body.bill_to_email || metadata.bill_to_email || req.user?.email || 'customer@peekaboo.local',
    billToAddressLine1: body.bill_to_address_line1 || metadata.bill_to_address_line1 || 'Amman',
    billToAddressCity: body.bill_to_address_city || metadata.bill_to_address_city || 'Amman',
    billToAddressCountry: body.bill_to_address_country || metadata.bill_to_address_country || 'JO'
  };
};

const toCapitalBankErrorResponse = ({ status = 422, code, error, details = {} }) => ({
  status,
  payload: {
    error,
    code,
    details
  }
});

const buildFailureReason = ({ decision, reasonCode, message }) => {
  const normalizedDecision = sanitizeReason(decision || 'payment_failed');
  const normalizedReasonCode = sanitizeReason(reasonCode || '');
  const normalizedMessage = sanitizeReason(message || '');
  if (normalizedReasonCode && normalizedMessage) return `${normalizedDecision}_${normalizedReasonCode}_${normalizedMessage}`;
  if (normalizedReasonCode) return `${normalizedDecision}_${normalizedReasonCode}`;
  if (normalizedMessage) return `${normalizedDecision}_${normalizedMessage}`;
  return normalizedDecision;
};

router.post('/capital-bank/initiate', authMiddleware, ensureHttpsForCapitalBank, async (req, res) => {
  try {
    if (!isCapitalBankProviderActive()) {
      if (!hasLoggedCapitalBankFallbackOnInitiate) {
        hasLoggedCapitalBankFallbackOnInitiate = true;
        console.warn('[Payments] Capital Bank initiate requested while provider is inactive; falling back to manual', {
          requested_provider: requestedPaymentProvider,
          effective_provider: getEffectiveProvider(),
          missing_env_vars: missingCapitalBankEnvVars
        });
      }
      return res.status(503).json({ error: 'Capital Bank Secure Acceptance payment gateway is not enabled', missing_env_vars: missingCapitalBankEnvVars });
    }

    const { orderId } = req.body || {};
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const transaction = await resolveOrderTransaction(orderId, req.userId);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const amount = Number(transaction.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid transaction amount' });
    }

    await PaymentTransaction.findByIdAndUpdate(transaction._id, {
      $set: {
        status: 'pending',
        payment_status: 'pending',
        updated_at: new Date(),
        provider: DB_PROVIDER_CAPITAL_BANK
      }
    });

    const origin = resolveFrontendOrigin(req.body?.originUrl, req);
    if (!origin) {
      return res.status(400).json({ error: 'Unable to resolve frontend origin for return URLs' });
    }

    const transactionUuid = generateTransactionUuid();
    const endpoint = getCyberSourcePaymentUrl();
    const capitalBankEnv = getCapitalBankEnv();
    const configValidation = validateSecureAcceptanceConfig({
      merchantId: capitalBankConfig.merchantId,
      profileId: capitalBankConfig.profileId,
      accessKey: capitalBankConfig.accessKey,
      secretKey: capitalBankConfig.secretKey,
      env: capitalBankEnv,
      endpoint
    });

    if (!configValidation.ok) {
      const failure = toCapitalBankErrorResponse({
        code: configValidation.code,
        error: 'إعدادات بوابة الدفع غير متطابقة مع بيئة Capital Bank/CyberSource. Payment gateway configuration is inconsistent with Capital Bank/CyberSource environment.',
        details: configValidation.details
      });
      console.error('[Capital Bank] Secure Acceptance preflight failed', {
        code: configValidation.code,
        reason: configValidation.reason,
        ...configValidation.details
      });
      return res.status(failure.status).json(failure.payload);
    }

    console.info('[Capital Bank] Initiate provider context', {
      endpoint,
      capital_bank_env: capitalBankEnv,
      profileId: capitalBankConfig.profileId,
      referenceNumber: transaction.session_id,
      amount: amount.toFixed(2)
    });

    const secureAcceptance = buildSecureAcceptanceFields({
      merchantId: capitalBankConfig.merchantId,
      profileId: capitalBankConfig.profileId,
      accessKey: capitalBankConfig.accessKey,
      secretKey: capitalBankConfig.secretKey,
      transactionUuid,
      referenceNumber: transaction.session_id,
      amount,
      locale: req.body?.locale || 'ar-xn',
      overrideCustomReceiptPage: `${origin}/api/payments/capital-bank/return`,
      overrideCustomCancelPage: `${origin}/payment/cancel`,
      ...resolveBillingDetails(transaction, req)
    });

    const fieldsValidation = validateSecureAcceptanceFields(secureAcceptance);
    if (!fieldsValidation.ok) {
      const failure = toCapitalBankErrorResponse({
        code: fieldsValidation.code,
        error: 'تعذر إنشاء حقول التوقيع لبوابة الدفع. Unable to generate a valid Secure Acceptance signed payload.',
        details: {
          ...fieldsValidation.details,
          env: capitalBankEnv,
          endpoint,
          profile_id: capitalBankConfig.profileId,
          merchant_id: capitalBankConfig.merchantId
        }
      });
      console.error('[Capital Bank] Secure Acceptance payload validation failed', failure.payload);
      return res.status(failure.status).json(failure.payload);
    }

    console.info('[Capital Bank] Secure Acceptance initiate payload prepared', {
      order_id: transaction.session_id,
      transaction_uuid: transactionUuid,
      amount: amount.toFixed(2),
      currency: secureAcceptance.currency,
      locale: secureAcceptance.locale,
      signed_field_names: secureAcceptance.signed_field_names
    });

    return res.status(200).json({
      success: true,
      orderId: transaction.session_id,
      provider: DB_PROVIDER_CAPITAL_BANK,
      secureAcceptance: {
        url: endpoint,
        returnUrl: `${origin}/api/payments/capital-bank/return`,
        cancelUrl: `${origin}/payment/cancel`,
        fields: secureAcceptance
      }
    });
  } catch (error) {
    console.error('Capital Bank initiate error:', error?.message, {
      code: error?.code,
      stack_preview: String(error?.stack || '').split('\n').slice(0, 3).join('\n')
    });
    return res.status(500).json({
      error: 'فشل بدء عملية الدفع. Failed to process payment initiation.',
      code: 'CAPITAL_BANK_INITIATE_FAILED',
      details: {
        message: error?.message || 'unknown_error'
      }
    });
  }
});
const capitalBankCallbackParser = express.urlencoded({ extended: false });
const processCapitalBankCallback = async (req, res, source = 'notify') => {
  const callbackPayload = { ...(req.query || {}), ...(req.body || {}) };
  
  // Secure Acceptance uses different field names
  const sessionId = String(
    callbackPayload?.req_reference_number || 
    callbackPayload?.reference_number || 
    callbackPayload?.orderId || 
    ''
  ).trim();
  
  const decision = String(callbackPayload?.decision || '').toUpperCase();
  const reasonCode = String(callbackPayload?.reason_code || '').trim();
  const message = String(callbackPayload?.message || '').trim();
  const reqReferenceNumber = String(callbackPayload?.req_reference_number || '').trim();
  const referenceNumber = String(callbackPayload?.reference_number || '').trim();
  const transactionId = String(
    callbackPayload?.transaction_id || 
    callbackPayload?.req_transaction_uuid || 
    ''
  ).trim();
  const reqTransactionUuid = String(callbackPayload?.req_transaction_uuid || '').trim();

  console.log('[Secure Acceptance Callback Details]', {
    decision: callbackPayload.decision,
    reason_code: callbackPayload.reason_code,
    message: callbackPayload.message,
    req_reference_number: callbackPayload.req_reference_number,
    reference_number: callbackPayload.reference_number,
    transaction_id: callbackPayload.transaction_id,
    req_transaction_uuid: callbackPayload.req_transaction_uuid
  });

  console.info('[Capital Bank Callback] decision diagnostics', {
    source,
    session_id: sessionId,
    decision,
    reason_code: reasonCode,
    message,
    req_reference_or_reference_number: reqReferenceNumber || referenceNumber,
    req_reference_number: reqReferenceNumber,
    reference_number: referenceNumber,
    transaction_id: transactionId,
    req_transaction_uuid: reqTransactionUuid
  });

  // Verify signature for security
  if (callbackPayload?.signature && callbackPayload?.signed_field_names) {
    try {
      const signatureCheck = verifySecureAcceptanceSignature(callbackPayload, capitalBankConfig.secretKey);
      if (!signatureCheck.isValid) {
        console.error('[SECURITY] Invalid signature in Secure Acceptance callback', {
          reason: signatureCheck.reason,
          reference_number: referenceNumber,
          decision,
          signed_field_names: signatureCheck.signedFieldNames,
          data_to_sign_preview: signatureCheck.dataToSignPreview
        });
        if (source === 'notify') return res.status(200).json({ received: true, ignored: true });
        return res.redirect(303, '/payment/failed?reason=invalid_signature');
      }
      console.log('[Secure Acceptance Callback] Signature verified ✓');
    } catch (error) {
      console.error('[SECURITY] Error verifying signature:', error?.message);
    }
  }

  const mapped = mapDecisionToStatus(decision);

  if (!sessionId) {
    if (source === 'notify') return res.status(200).json({ received: true, ignored: true });
    return res.redirect(303, '/payment/failed?reason=missing_session_id');
  }

  const existing = await PaymentTransaction.findOne({ session_id: sessionId });
  if (!existing) {
    if (source === 'notify') return res.status(200).json({ received: true, ignored: true });
    return res.redirect(303, '/payment/failed?reason=transaction_not_found');
  }

  const processedIds = Array.isArray(existing.metadata?.processed_transaction_ids)
    ? existing.metadata.processed_transaction_ids.map((id) => String(id))
    : [];
  const isDuplicate = Boolean(transactionId) && (
    processedIds.includes(transactionId) ||
    (existing.payment_id && String(existing.payment_id) === transactionId)
  );

  const resolvedStatus = mapped.status || existing.status;
  const resolvedPaymentStatus = mapped.paymentStatus || existing.payment_status || existing.status;
  const shouldKeepPaidState = existing.status === 'paid' && resolvedStatus !== 'paid';
  const updatePayload = {
    $set: {
      status: shouldKeepPaidState ? 'paid' : resolvedStatus,
      payment_status: shouldKeepPaidState ? 'paid' : resolvedPaymentStatus,
      updated_at: new Date(),
      provider: DB_PROVIDER_CAPITAL_BANK,
      'metadata.gateway_callback': {
        source,
        decision,
        reason_code: reasonCode,
        message,
        req_reference_number: reqReferenceNumber,
        reference_number: referenceNumber,
        transaction_id: transactionId,
        req_transaction_uuid: reqTransactionUuid,
        received_at: new Date().toISOString()
      },
      ...(transactionId ? { payment_id: transactionId } : {})
    }
  };

  if (transactionId && !isDuplicate) {
    updatePayload.$addToSet = { 'metadata.processed_transaction_ids': transactionId };
  }

  const transaction = isDuplicate
    ? existing
    : await PaymentTransaction.findOneAndUpdate({ _id: existing._id }, updatePayload, { new: true });

  if (!transaction) {
    if (source === 'notify') return res.status(200).json({ received: true, ignored: true });
    return res.redirect(303, '/payment/failed?reason=transaction_not_found');
  }

  console.log('[Secure Acceptance Callback] Transaction updated:', {
    sessionId,
    status: transaction.status,
    decision
  });

  if (mapped.status === 'paid' && transaction.type === 'product') {
    await maybeAwardProductLoyaltyPoints(transaction);
  }

  if (mapped.status === 'paid' && ['hourly', 'birthday', 'subscription'].includes(transaction.type)) {
    try {
      await finalizeTransactionIfPaid(transaction);
    } catch (error) {
      console.error('[Payments] Finalization after callback failed:', {
        sessionId,
        type: transaction.type,
        error: error?.message
      });
    }
  }

  if (source === 'notify') {
    return res.status(200).json({
      received: true,
      duplicate: isDuplicate,
      sessionId,
      decision,
      status: transaction.status
    });
  }

  if (transaction.status === 'paid') {
    return res.redirect(303, `/payment/success?orderId=${encodeURIComponent(sessionId)}`);
  }
  if (transaction.status === 'pending') {
    return res.redirect(303, `/payment/pending?orderId=${encodeURIComponent(sessionId)}`);
  }

  const reason = buildFailureReason({ decision, reasonCode, message });
  return res.redirect(303, `/payment/failed?orderId=${encodeURIComponent(sessionId)}&reason=${encodeURIComponent(reason)}`);
};

router.post('/capital-bank/notify', capitalBankCallbackParser, ensureHttpsForCapitalBank, async (req, res) => {
  if (!isCyberSourceNotifyRequest(req)) {
    console.error('[SECURITY] Rejected Capital Bank notify request: invalid signature headers');
    return res.status(200).json({ received: true, ignored: true });
  }

  const callbackPayload = { ...(req.query || {}), ...(req.body || {}) };
  const signatureCheck = verifySecureAcceptanceSignature(callbackPayload, capitalBankConfig.secretKey);
  if (!signatureCheck.isValid) {
    console.error('[SECURITY] Rejected Capital Bank notify request: invalid signature', {
      reason: signatureCheck.reason,
      reference_number: callbackPayload.reference_number,
      decision: callbackPayload.decision,
      signed_field_names: signatureCheck.signedFieldNames,
      data_to_sign_preview: signatureCheck.dataToSignPreview
    });
    return res.status(200).json({ received: true, ignored: true });
  }

  try {
    console.log('[Secure Acceptance Notify] Received callback');
    return await processCapitalBankCallback(req, res, 'notify');
  } catch (error) {
    console.error('Capital Bank notify processing error:', error?.message);
    return res.status(200).json({ received: true, error: true });
  }
});

const processCapitalBankReturn = async (req, res) => {
  const callbackPayload = { ...(req.query || {}), ...(req.body || {}) };
  const signatureCheck = verifySecureAcceptanceSignature(callbackPayload, capitalBankConfig.secretKey);
  if (!signatureCheck.isValid) {
    console.error('[SECURITY] Rejected Capital Bank return request: invalid signature', {
      reason: signatureCheck.reason,
      reference_number: callbackPayload.reference_number,
      decision: callbackPayload.decision,
      signed_field_names: signatureCheck.signedFieldNames,
      data_to_sign_preview: signatureCheck.dataToSignPreview
    });
    return res.redirect(303, '/payment/failed?reason=invalid_signature');
  }

  try {
    return await processCapitalBankCallback(req, res, 'return');
  } catch (error) {
    console.error('Capital Bank return processing error:', error?.message);
    return res.redirect(303, '/payment/failed?reason=callback_processing_error');
  }
};

router.post('/capital-bank/return', capitalBankCallbackParser, ensureHttpsForCapitalBank, processCapitalBankReturn);
router.get('/capital-bank/return', ensureHttpsForCapitalBank, processCapitalBankReturn);

// -----------------------------------------------------------------------------
// CyberSource Unified Checkout (Microform v2 + Payments v2) — embedded SDK flow
// -----------------------------------------------------------------------------
// These routes run IN PARALLEL with the existing Secure Acceptance flow above.
// They do NOT replace or modify any existing Secure Acceptance behaviour.
// -----------------------------------------------------------------------------

// Route A: create a Unified Checkout capture context (Sessions API) for the
// current pending checkout session. Frontend loads the CyberSource JS SDK with
// the returned JWT so the card fields render on our page.
router.post('/capital-bank/unified-checkout/session', authMiddleware, ensureHttpsForCapitalBank, async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) {
      return res.status(400).json({ success: false, error: 'orderId is required' });
    }

    const transaction = await resolveOrderTransaction(orderId, req.userId);
    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }

    if (transaction.status && transaction.status !== 'pending') {
      return res.status(409).json({
        success: false,
        error: 'Transaction is not pending',
        status: transaction.status
      });
    }

    const amount = Number(transaction.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid transaction amount' });
    }

    const targetOrigin = resolveFrontendOrigin(req.body?.originUrl, req);
    const locale = String(req.body?.locale || 'en_US');
    const currency = String(transaction.currency || 'JOD').toUpperCase();

    console.info('[CyberSource Unified Checkout] Creating capture context', {
      order_id: transaction.session_id,
      amount: amount.toFixed(2),
      currency,
      locale,
      target_origin: targetOrigin || null
    });

    const result = await cybersourceCreateCaptureContext({
      amount,
      currency,
      locale,
      targetOrigin
    });

    if (!result.ok) {
      let detailsString = '';
      try {
        detailsString = JSON.stringify(result.data || result.details, null, 2);
      } catch (_e) {
        detailsString = String(result.data || result.details);
      }
      console.error(`[CyberSource Unified Checkout] createCaptureContext failed order_id=${transaction.session_id} status=${result.status} error=${result.error}\n${detailsString}`);
      return res.status(502).json({
        success: false,
        error: 'تعذر بدء عملية الدفع. Failed to create Unified Checkout capture context.',
        code: 'UNIFIED_CHECKOUT_SESSION_FAILED',
        details: {
          status: result.status,
          message: result.error,
          provider: result.details || null
        }
      });
    }

    // Persist a marker on the transaction for traceability (no schema change).
    try {
      await PaymentTransaction.findByIdAndUpdate(transaction._id, {
        $set: {
          provider: DB_PROVIDER_CAPITAL_BANK,
          'metadata.unified_checkout.session_created_at': new Date().toISOString(),
          'metadata.unified_checkout.target_origin': targetOrigin || null,
          'metadata.unified_checkout.locale': locale,
          updated_at: new Date()
        }
      });
    } catch (persistError) {
      console.warn('[CyberSource Unified Checkout] Failed to persist session metadata (non-fatal):', persistError?.message);
    }

    return res.status(200).json({
      success: true,
      orderId: transaction.session_id,
      captureContext: result.captureContext
    });
  } catch (error) {
    console.error('[CyberSource Unified Checkout] /session error:', error?.message, {
      stack_preview: String(error?.stack || '').split('\n').slice(0, 3).join('\n')
    });
    return res.status(500).json({
      success: false,
      error: 'Unexpected error creating Unified Checkout session',
      code: 'UNIFIED_CHECKOUT_SESSION_ERROR',
      details: { message: error?.message || 'unknown_error' }
    });
  }
});

// Route B: authorize (+ capture) a payment using the transient token JWT
// returned by the CyberSource JS SDK on the frontend.
router.post('/capital-bank/unified-checkout/authorize', authMiddleware, ensureHttpsForCapitalBank, async (req, res) => {
  try {
    const { orderId, transientToken } = req.body || {};
    if (!orderId) {
      return res.status(400).json({ success: false, error: 'orderId is required' });
    }
    if (!transientToken || typeof transientToken !== 'string') {
      return res.status(400).json({ success: false, error: 'transientToken is required' });
    }

    const transaction = await resolveOrderTransaction(orderId, req.userId);
    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }

    const amount = Number(transaction.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid transaction amount' });
    }

    const currency = String(transaction.currency || 'JOD').toUpperCase();

    console.info('[CyberSource Unified Checkout] Authorizing payment', {
      order_id: transaction.session_id,
      amount: amount.toFixed(2),
      currency
    });

    const result = await cybersourceAuthorizePayment({
      transientToken,
      amount,
      currency,
      referenceNumber: transaction.session_id
    });

    const providerData = (result && typeof result.data === 'object' && result.data) ? result.data : {};
    const providerStatus = String(providerData?.status || '').toUpperCase();
    const providerPaymentId = String(
      providerData?.id
      || providerData?.processorInformation?.transactionId
      || ''
    ).trim();
    const reasonCode = String(
      providerData?.processorInformation?.responseCode
      || providerData?.errorInformation?.reason
      || providerData?.reason
      || ''
    ).trim();
    const providerMessage = String(
      providerData?.processorInformation?.responseCodeSource
      || providerData?.errorInformation?.message
      || providerData?.message
      || ''
    ).trim();

    const isApproved = Boolean(result.ok)
      && (providerStatus === 'AUTHORIZED'
        || providerStatus === 'AUTHORIZED_PENDING_REVIEW'
        || providerStatus === 'PARTIAL_AUTHORIZED'
        || providerStatus === 'PENDING'
        || providerStatus === 'TRANSMITTED');

    const isPending = Boolean(result.ok)
      && (providerStatus === 'PENDING_AUTHENTICATION'
        || providerStatus === 'PENDING_REVIEW');

    let newStatus;
    let newPaymentStatus;
    if (isApproved) {
      newStatus = 'paid';
      newPaymentStatus = 'paid';
    } else if (isPending) {
      newStatus = 'pending';
      newPaymentStatus = 'pending';
    } else {
      newStatus = 'failed';
      newPaymentStatus = 'failed';
    }

    // Do not demote an already-paid transaction (mirror processCapitalBankReturn logic).
    const shouldKeepPaidState = transaction.status === 'paid' && newStatus !== 'paid';

    const updatePayload = {
      $set: {
        status: shouldKeepPaidState ? 'paid' : newStatus,
        payment_status: shouldKeepPaidState ? 'paid' : newPaymentStatus,
        updated_at: new Date(),
        provider: DB_PROVIDER_CAPITAL_BANK,
        'metadata.gateway_callback': {
          source: 'unified_checkout_authorize',
          decision: providerStatus || (result.ok ? 'UNKNOWN' : 'ERROR'),
          reason_code: reasonCode,
          message: providerMessage,
          req_reference_number: transaction.session_id,
          reference_number: transaction.session_id,
          transaction_id: providerPaymentId,
          req_transaction_uuid: providerPaymentId,
          received_at: new Date().toISOString()
        },
        'metadata.unified_checkout.authorize_status': providerStatus,
        'metadata.unified_checkout.authorize_http_status': result.status || null,
        'metadata.unified_checkout.authorized_at': new Date().toISOString(),
        ...(providerPaymentId ? { payment_id: providerPaymentId } : {})
      }
    };

    if (providerPaymentId) {
      updatePayload.$addToSet = { 'metadata.processed_transaction_ids': providerPaymentId };
    }

    const updated = await PaymentTransaction.findOneAndUpdate(
      { _id: transaction._id },
      updatePayload,
      { new: true }
    );

    if (!result.ok) {
      let providerBodyString = '';
      try {
        providerBodyString = JSON.stringify(providerData, null, 2);
      } catch (_e) {
        providerBodyString = String(providerData);
      }
      console.error(`[CyberSource Unified Checkout] Authorize failed order_id=${transaction.session_id} http_status=${result.status} error=${result.error} provider_status=${providerStatus} reason_code=${reasonCode}\n${providerBodyString}`);
      return res.status(402).json({
        success: false,
        orderId: transaction.session_id,
        status: updated?.status || newStatus,
        error: providerMessage || result.error || 'Payment authorization failed',
        code: 'UNIFIED_CHECKOUT_AUTHORIZE_FAILED',
        provider: {
          status: providerStatus || null,
          reasonCode: reasonCode || null,
          httpStatus: result.status || null,
          message: providerMessage || null,
          body: providerData || null
        }
      });
    }

    // On success, mirror the existing callback post-processing.
    if (updated && updated.status === 'paid' && updated.type === 'product') {
      try {
        await maybeAwardProductLoyaltyPoints(updated);
      } catch (loyaltyError) {
        console.error('[CyberSource Unified Checkout] Loyalty award failed (non-fatal):', loyaltyError?.message);
      }
    }

    if (updated && updated.status === 'paid' && ['hourly', 'birthday', 'subscription'].includes(updated.type)) {
      try {
        await finalizeTransactionIfPaid(updated);
      } catch (finalizeError) {
        console.error('[CyberSource Unified Checkout] Finalization failed (non-fatal):', {
          sessionId: updated.session_id,
          type: updated.type,
          error: finalizeError?.message
        });
      }
    }

    console.info('[CyberSource Unified Checkout] Authorize completed', {
      order_id: transaction.session_id,
      provider_status: providerStatus,
      final_status: updated?.status || newStatus,
      payment_id: providerPaymentId || null
    });

    return res.status(200).json({
      success: isApproved,
      orderId: transaction.session_id,
      status: updated?.status || newStatus,
      provider: {
        status: providerStatus || null,
        paymentId: providerPaymentId || null,
        reasonCode: reasonCode || null
      }
    });
  } catch (error) {
    console.error('[CyberSource Unified Checkout] /authorize error:', error?.message, {
      stack_preview: String(error?.stack || '').split('\n').slice(0, 3).join('\n')
    });
    return res.status(500).json({
      success: false,
      error: 'Unexpected error authorizing Unified Checkout payment',
      code: 'UNIFIED_CHECKOUT_AUTHORIZE_ERROR',
      details: { message: error?.message || 'unknown_error' }
    });
  }
});

// Unified Checkout completion callback — CyberSource redirects/calls here after completeMandate finishes
router.post('/capital-bank/unified-checkout/complete', async (req, res) => {
  try {
    const transactionId = req.body?.transactionId || req.body?.id || '';
    const status = String(req.body?.status || req.body?.orderStatus || '').toUpperCase();
    const orderId = req.body?.clientReferenceInformation?.code
      || req.body?.req_reference_number
      || req.body?.orderId
      || '';

    console.log('[CyberSource Unified Checkout] COMPLETE_CALLBACK', {
      transactionId,
      status,
      orderId,
      bodyKeys: Object.keys(req.body || {})
    });

    if (!orderId) {
      return res.status(400).json({ error: 'Missing order reference' });
    }

    const transaction = await PaymentTransaction.findOne({
      $or: [
        { _id: orderId },
        { session_id: orderId },
        { 'metadata.session_id': orderId }
      ]
    });

    if (!transaction) {
      console.error('[CyberSource Unified Checkout] COMPLETE_CALLBACK_NO_TRANSACTION', { orderId });
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const isPaid = status === 'AUTHORIZED' || status === 'CAPTURED' || status === 'COMPLETED';
    const shouldKeepPaidState = ['paid', 'completed'].includes(transaction.status);
    if (!shouldKeepPaidState) {
      transaction.status = isPaid ? 'paid' : 'failed';
      transaction.payment_status = isPaid ? 'paid' : 'failed';
    }
    transaction.provider = DB_PROVIDER_CAPITAL_BANK;
    transaction.payment_id = transactionId || transaction.payment_id;
    if (!transaction.metadata) transaction.metadata = {};
    transaction.metadata.unified_checkout_complete = {
      transactionId,
      status,
      receivedAt: new Date().toISOString(),
      rawBody: req.body
    };
    await transaction.save();

    console.log('[CyberSource Unified Checkout] COMPLETE_SAVED', {
      orderId,
      transactionId,
      status: transaction.status,
      isPaid
    });

    if (isPaid && transaction.type === 'product') {
      try {
        await maybeAwardProductLoyaltyPoints(transaction);
      } catch (loyaltyErr) {
        console.error('[CyberSource Unified Checkout] LOYALTY_ERROR', loyaltyErr?.message);
      }
    }
    if (isPaid && ['hourly', 'birthday', 'subscription'].includes(transaction.type)) {
      try {
        await finalizeTransactionIfPaid(transaction);
      } catch (finalizeErr) {
        console.error('[CyberSource Unified Checkout] FINALIZE_ERROR', finalizeErr?.message);
      }
    }

    const origin = req.headers.origin || req.headers.referer?.replace(/\/[^/]*$/, '') || 'https://peekaboojor.com';
    if (isPaid) {
      return res.redirect(`${origin}/payment/success?orderId=${encodeURIComponent(orderId)}`);
    }
    return res.redirect(`${origin}/payment/failed?orderId=${encodeURIComponent(orderId)}`);
  } catch (error) {
    console.error('[CyberSource Unified Checkout] COMPLETE_ERROR', error?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/capital-bank/unified-checkout/complete', (req, res) => {
  const orderId = req.query.orderId || req.query.ref || '';
  const origin = 'https://peekaboojor.com';
  return res.redirect(`${origin}/payment/success?orderId=${encodeURIComponent(orderId)}`);
});

router.get('/provider', (_req, res) => {
  const effectiveProvider = getEffectiveProvider();
  const endpoint = getCyberSourcePaymentUrl();
  return res.json({
    requestedPaymentProvider,
    effectiveProvider,
    providerActive: isCapitalBankProviderActive(),
    capitalBankEnv: getCapitalBankEnv(),
    missingCapitalBankEnvVars,
    endpoint
  });
});

router.get('/provider-status', (_req, res) => {
  const effectiveProvider = getEffectiveProvider();
  return res.json({
    requestedPaymentProvider,
    effectiveProvider,
    capitalBankEnv: getCapitalBankEnv(),
    endpoint: getCyberSourcePaymentUrl(),
    missingCapitalBankEnvVars
  });
});

// Store transaction
router.post('/store-transaction', authMiddleware, async (req, res) => {
  try {
    const { session_id, user_id, amount, currency, type, reference_id, metadata } = req.body;
    const transaction = new PaymentTransaction({
      session_id,
      user_id: user_id || req.userId,
      amount,
      currency: currency || 'jod',
      status: 'pending',
      type,
      reference_id,
      metadata
    });
    await transaction.save();
    res.status(201).json({ transaction: transaction.toJSON() });
  } catch (error) {
    console.error('Store transaction error:', error);
    res.status(500).json({ error: 'Failed to store transaction' });
  }
});
// Get payment history
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const transactions = await PaymentTransaction.find({
      user_id: req.userId,
      status: 'paid'
    }).sort({ created_at: -1 });
    res.json({ transactions: transactions.map(t => t.toJSON()) });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({ error: 'Failed to get payment history' });
  }
});
module.exports = router;
