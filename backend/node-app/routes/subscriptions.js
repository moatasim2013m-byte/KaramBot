const express = require('express');
const QRCode = require('qrcode');
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');

const SubscriptionPlan = require('../models/SubscriptionPlan');
const UserSubscription = require('../models/UserSubscription');
const Child = require('../models/Child');
const User = require('../models/User');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { sendEmail, emailTemplates } = require('../utils/email');
const { notifyAdminsOfOrder } = require('../utils/adminOrderNotifications');
const { postWhatsAppText, normalizePhoneForWhatsApp } = require('../utils/whatsappBookingConfirmation');
const { awardPoints } = require('../utils/awardPoints');
const { addDays } = require('date-fns');
const { handleReferralAwardForConfirmedOrder } = require('../utils/referrals');

const router = express.Router();
const SUBSCRIPTION_DAYS = 30;


const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

// Get all subscription plans
router.get('/plans', async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find({ is_active: true })
      .select('name name_ar description description_ar visits price is_daily_pass valid_days created_at')
      .sort({ price: 1 })
      .lean();

    // Short-lived cache header to reduce repeated DB reads from anonymous traffic
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      plans: plans.map((plan) => {
        const { _id, __v, ...rest } = plan;
        return { ...rest, id: _id.toString() };
      })
    });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ error: 'Failed to get plans' });
  }
});

// Get single plan
router.get('/plans/:id', async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid plan id' });
    }

    const plan = await SubscriptionPlan.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    res.json({ plan: plan.toJSON() });
  } catch (error) {
    console.error('Get plan error:', error);
    res.status(500).json({ error: 'Failed to get plan' });
  }
});

// Purchase subscription (after payment confirmed)
// NOTE: Expiry is set to null - it starts counting from FIRST CHECK-IN
router.post('/purchase', authMiddleware, async (req, res) => {
  try {
    const { plan_id, child_id, payment_id } = req.body;

    if (!isValidObjectId(plan_id)) {
      return res.status(400).json({ error: 'معرّف الباقة غير صالح' });
    }
    if (!isValidObjectId(child_id)) {
      return res.status(400).json({ error: 'معرّف الطفل غير صالح' });
    }
    
    const plan = await SubscriptionPlan.findById(plan_id);
    if (!plan || !plan.is_active) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const child = await Child.findOne({ _id: child_id, parent_id: req.userId });
    if (!child) {
      return res.status(400).json({ error: 'Invalid child' });
    }

    // expires_at is null until first check-in
    const subscription = new UserSubscription({
      user_id: req.userId,
      child_id,
      plan_id,
      remaining_visits: plan.visits,
      expires_at: null, // Will be set on first check-in
      payment_id,
      status: 'pending' // Pending until first check-in activates it
    });

    await subscription.save();

    // Send WhatsApp confirmation (non-blocking)
    try {
      const userDoc = await User.findById(req.userId).lean();
      if (userDoc?.phone) {
        const SubscriptionPlan = require('../models/SubscriptionPlan');
        const plan = await SubscriptionPlan.findById(plan_id).lean();
        const phone = normalizePhoneForWhatsApp(userDoc.phone);
        if (phone) {
          const msg = [
            `أهلاً ${userDoc.name || 'عميلنا العزيز'}، تم تفعيل اشتراكك في Peekaboo 🎉`,
            `الباقة: ${plan?.name_ar || plan?.name || 'اشتراك'}`,
            `عدد الزيارات: ${plan?.visits || subscription.remaining_visits}`,
            `رقم الاشتراك: ${subscription._id.toString().slice(-8).toUpperCase()}`,
            'بنستناكم في بيكابو 💛'
          ].join('\n');
          await postWhatsAppText({ to: phone, messageBody: msg });
        }
      }
    } catch (waErr) {
      console.error('SUBSCRIPTION_WHATSAPP_ERROR', waErr.message);
    }

    await awardPoints({
      userId: req.userId,
      refType: 'subscription_purchase',
      refId: subscription._id.toString(),
      type: 'subscription',
      description: 'Earned points from subscription purchase'
    });

    await handleReferralAwardForConfirmedOrder(req.userId);

    // Send confirmation email (non-blocking)
    const user = await User.findById(req.userId);
    const template = emailTemplates.subscriptionConfirmation({
      userName: user?.name,
      subscription,
      plan,
      child
    });
    try {
      await sendEmail(user.email, template.subject, template.html);
    } catch (emailErr) {
      console.error('SUBSCRIPTION_EMAIL_ERROR', emailErr.message || emailErr);
    }
    notifyAdminsOfOrder({
      orderType: 'Subscription',
      orderId: subscription?._id?.toString(),
      customerName: user?.name,
      customerEmail: user?.email,
      amount: plan?.price || 0,
      paymentStatus: subscription?.payment_status || 'paid',
      createdAt: subscription?.created_at || new Date()
    }).catch((error) => console.error('ADMIN_ORDER_ALERT_FAILED', error?.message || error));

    res.status(201).json({ subscription: subscription.toJSON() });
  } catch (error) {
    console.error('Purchase subscription error:', error);
    res.status(500).json({ error: 'Failed to purchase subscription' });
  }
});

// Purchase subscription with cash/cliq payment (offline providers)
router.post('/purchase/offline', authMiddleware, async (req, res) => {
  try {
    const { plan_id, child_id, payment_method } = req.body;

    if (!isValidObjectId(plan_id)) {
      return res.status(400).json({ error: 'معرّف الباقة غير صالح' });
    }
    if (!isValidObjectId(child_id)) {
      return res.status(400).json({ error: 'معرّف الطفل غير صالح' });
    }
    
    // Validate payment method
    if (!['cash', 'cliq'].includes(payment_method)) {
      return res.status(400).json({ error: 'طريقة دفع غير صالحة' });
    }
    
    const plan = await SubscriptionPlan.findById(plan_id);
    if (!plan || !plan.is_active) {
      return res.status(400).json({ error: 'باقة غير صالحة' });
    }

    const child = await Child.findOne({ _id: child_id, parent_id: req.userId });
    if (!child) {
      return res.status(400).json({ error: 'طفل غير صالح' });
    }

    const paymentStatus = payment_method === 'cash' ? 'pending_cash' : 'pending_cliq';

    const subscription = new UserSubscription({
      user_id: req.userId,
      child_id,
      plan_id,
      remaining_visits: plan.visits,
      expires_at: null, // Will be set on first check-in
      payment_method,
      payment_status: paymentStatus,
      status: 'pending' // Pending until first check-in activates it
    });

    await subscription.save();

    // Send confirmation email (non-blocking)
    const user = await User.findById(req.userId);
    const template = emailTemplates.subscriptionConfirmation({
      userName: user?.name,
      subscription,
      plan,
      child
    });
    try {
      await sendEmail(user.email, template.subject, template.html);
      const pendingTemplate = emailTemplates.paymentPending({
        userName: user?.name,
        serviceName: `Subscription - ${plan?.name_ar || plan?.name || 'Peekaboo'}`,
        serviceDate: new Date(subscription.created_at).toLocaleDateString('en-GB'),
        serviceTime: new Date(subscription.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        totalPrice: plan?.price || 0
      });
      await sendEmail(user.email, pendingTemplate.subject, pendingTemplate.html);
    } catch (emailErr) {
      console.error('SUBSCRIPTION_OFFLINE_EMAIL_ERROR', emailErr.message || emailErr);
    }
    notifyAdminsOfOrder({
      orderType: 'Subscription',
      orderId: subscription?._id?.toString(),
      customerName: user?.name,
      customerEmail: user?.email,
      amount: plan?.price || 0,
      paymentStatus,
      createdAt: subscription?.created_at || new Date()
    }).catch((error) => console.error('ADMIN_ORDER_ALERT_FAILED', error?.message || error));

    res.status(201).json({ 
      subscription: subscription.toJSON(),
      message: payment_method === 'cash' 
        ? 'تم الحجز بنجاح! الرجاء الدفع نقداً عند الاستقبال.' 
        : 'تم الحجز بنجاح! الرجاء إتمام التحويل عبر CliQ.'
    });
  } catch (error) {
    console.error('Purchase offline subscription error:', error);
    res.status(500).json({ error: 'فشل شراء الاشتراك' });
  }
});

// Get user's subscriptions
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const subscriptions = await UserSubscription.find({ user_id: req.userId })
      .populate('plan_id')
      .populate('child_id')
      .sort({ created_at: -1 });

    // Update expired subscriptions (only those that have been activated)
    const now = new Date();
    for (const sub of subscriptions) {
      if (sub.status === 'active' && sub.expires_at && sub.expires_at < now) {
        sub.status = 'expired';
        await sub.save();
      }
    }

    res.json({ subscriptions: subscriptions.map(s => s.toJSON()) });
  } catch (error) {
    console.error('Get subscriptions error:', error);
    res.status(500).json({ error: 'Failed to get subscriptions' });
  }
});

// Get active subscriptions for a child
router.get('/child/:childId', authMiddleware, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.childId)) {
      return res.status(400).json({ error: 'معرّف الطفل غير صالح' });
    }

    const child = await Child.findOne({ _id: req.params.childId, parent_id: req.userId });
    if (!child) {
      return res.status(404).json({ error: 'Child not found' });
    }

    // Find subscription that is either pending (not yet activated) or active with visits remaining
    const subscription = await UserSubscription.findOne({
      child_id: req.params.childId,
      status: { $in: ['pending', 'active'] },
      remaining_visits: { $gt: 0 },
      $or: [
        { expires_at: null }, // Pending, not yet activated
        { expires_at: { $gt: new Date() } } // Active and not expired
      ]
    }).populate('plan_id');

    res.json({ subscription: subscription ? subscription.toJSON() : null });
  } catch (error) {
    console.error('Get child subscription error:', error);
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});

// Consume subscription visit (reception scan)
// This also activates the subscription if it's the first use
router.post('/consume', authMiddleware, async (req, res) => {
  try {
    const { child_id } = req.body;

    if (!isValidObjectId(child_id)) {
      return res.status(400).json({ error: 'معرّف الطفل غير صالح' });
    }
    
    // SECURITY: Verify child belongs to authenticated parent
    const child = await Child.findOne({ _id: child_id, parent_id: req.userId });
    if (!child) {
      return res.status(403).json({ error: 'غير مصرح: الطفل لا ينتمي لحسابك' });
    }
    
    // Find subscription that is pending or active AND belongs to this parent
    const subscription = await UserSubscription.findOne({
      child_id,
      user_id: req.userId, // SECURITY: Ensure subscription belongs to authenticated user
      status: { $in: ['pending', 'active'] },
      remaining_visits: { $gt: 0 },
      $or: [
        { expires_at: null }, // Pending, not yet activated
        { expires_at: { $gt: new Date() } } // Active and not expired
      ]
    }).populate('plan_id').populate('child_id');

    if (!subscription) {
      return res.status(404).json({ error: 'لا يوجد اشتراك فعال لهذا الطفل' });
    }

    // If this is the first check-in (pending status), activate and set expiry
    if (subscription.status === 'pending') {
      subscription.status = 'active';
      subscription.expires_at = addDays(new Date(), SUBSCRIPTION_DAYS);
      subscription.first_checkin_at = new Date();
    }

    subscription.remaining_visits -= 1;
    if (subscription.remaining_visits === 0) {
      subscription.status = 'consumed';
    }
    await subscription.save();

    res.json({
      message: 'Visit consumed successfully',
      subscription: subscription.toJSON(),
      first_activation: subscription.first_checkin_at ? true : false
    });
  } catch (error) {
    console.error('Consume subscription error:', error);
    res.status(500).json({ error: 'Failed to consume visit' });
  }
});

module.exports = router;
