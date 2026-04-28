const express = require('express');
const User = require('../models/User');
const HourlyBooking = require('../models/HourlyBooking');
const BirthdayBooking = require('../models/BirthdayBooking');
const { sendEmail, emailTemplates } = require('../utils/email');
const { sweepHourlyBookingLifecycle } = require('../utils/bookingLifecycle');

const router = express.Router();

const WINBACK_WINDOW_DAYS = 14;
const MILLISECONDS_IN_DAY = 24 * 60 * 60 * 1000;

const isCronAuthorized = (req) => {
  const providedSecret = req.get('X-CRON-SECRET');
  return Boolean(process.env.CRON_SECRET) && providedSecret === process.env.CRON_SECRET;
};

router.post('/winback', async (req, res) => {
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized cron request' });
  }

  try {
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - (WINBACK_WINDOW_DAYS * MILLISECONDS_IN_DAY));
    const ctaLink = req.body?.cta_link || `${process.env.FRONTEND_URL || 'https://peekaboojor.com'}/bookings`;
    const couponCode = req.body?.coupon_code || '';

    const [recentHourlyUserIds, recentBirthdayUserIds, candidates] = await Promise.all([
      HourlyBooking.distinct('user_id', {
        status: { $in: ['confirmed', 'checked_in', 'completed'] },
        created_at: { $gte: cutoffDate }
      }),
      BirthdayBooking.distinct('user_id', {
        status: { $in: ['confirmed', 'completed'] },
        created_at: { $gte: cutoffDate }
      }),
      User.find({
        role: 'parent',
        is_disabled: { $ne: true },
        email: { $exists: true, $ne: '' },
        $or: [
          { last_winback_at: { $exists: false } },
          { last_winback_at: null },
          { last_winback_at: { $lt: cutoffDate } }
        ]
      }).select('_id name email')
    ]);

    const activeUserIds = new Set(
      [...recentHourlyUserIds, ...recentBirthdayUserIds].map((id) => id.toString())
    );

    const scanned = candidates.length;
    let emailed = 0;
    let skipped = 0;

    for (const user of candidates) {
      if (activeUserIds.has(user._id.toString())) {
        skipped += 1;
        continue;
      }

      try {
        const template = emailTemplates.winback({
          userName: user.name,
          ctaLink,
          couponCode
        });

        await sendEmail(user.email, template.subject, template.html);
        await User.updateOne({ _id: user._id }, { $set: { last_winback_at: now } });
        emailed += 1;
      } catch (emailError) {
        console.error('[WINBACK_EMAIL_FAILED]', {
          user_id: user._id,
          email: user.email,
          error: emailError.message
        });
        skipped += 1;
      }
    }

    return res.json({ scanned, emailed, skipped });
  } catch (error) {
    console.error('[WINBACK_CRON_ERROR]', error);
    return res.status(500).json({ error: 'Failed to execute win-back automation' });
  }
});

// POST /whatsapp-followup — auto follow-up for unanswered inbound WhatsApp messages
// Triggered every 15 minutes via external cron (e.g., Cloud Scheduler)
router.post('/whatsapp-followup', async (req, res) => {
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized cron request' });
  }

  const WhatsAppMessage = require('../models/WhatsAppMessage');
  const Settings = require('../models/Settings');
  const { postWhatsAppTemplate } = require('../utils/whatsappMarketing');
  const { normalizePhoneForWhatsApp } = require('../utils/whatsappBookingConfirmation');
  const { isWhatsAppOptedOut } = require('../utils/whatsappOptOut');

  const FOLLOWUP_DELAY_MS = 60 * 60 * 1000; // 60 minutes
  const FOLLOWUP_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - FOLLOWUP_DELAY_MS);
    const cooldownCutoff = new Date(now.getTime() - FOLLOWUP_COOLDOWN_MS);

    // Get configurable template name. If not set, skip the run entirely
    // rather than falling back to a test template (which would send test
    // strings to real customers). Matches the Cloud Scheduler runbook.
    const templateSetting = await Settings.findOne({ key: 'whatsapp_followup_template_name' }).lean();
    const templateName = (templateSetting?.value || '').trim();
    const templateLanguage = req.body?.template_language || 'en';

    if (!templateName) {
      console.log('FOLLOWUP_CRON_SKIPPED', {
        reason: 'missing_template_setting',
        setting_key: 'whatsapp_followup_template_name'
      });
      return res.json({
        template: null,
        scanned: 0,
        sent: 0,
        skipped_replied: 0,
        skipped_opted_out: 0,
        skipped_already_sent: 0,
        skipped_failed: 0,
        skipped_run: true,
        skip_reason: 'missing_template_setting'
      });
    }

    // Find all contacts with an inbound message older than 60 minutes
    // grouped by sender, with the latest inbound message per contact
    const unansweredContacts = await WhatsAppMessage.aggregate([
      {
        $match: {
          direction: 'inbound',
          platform: 'whatsapp',
          timestamp: { $lte: cutoff }
        }
      },
      {
        $sort: { timestamp: -1 }
      },
      {
        $group: {
          _id: '$sender_wa_id',
          lastInboundTime: { $first: '$timestamp' },
          lastInboundId: { $first: '$message_id' }
        }
      }
    ]);

    // For each contact, check if there's any outbound reply AFTER their last inbound
    let scanned = unansweredContacts.length;
    let sent = 0;
    let skipped_replied = 0;
    let skipped_opted_out = 0;
    let skipped_already_sent = 0;
    let skipped_failed = 0;

    for (const contact of unansweredContacts) {
      const waId = contact._id;
      if (!waId) continue;

      // Check if any outbound message exists after the last inbound (bot or staff replied)
      const outboundAfter = await WhatsAppMessage.findOne({
        sender_wa_id: waId,
        direction: 'outbound',
        platform: 'whatsapp',
        timestamp: { $gt: contact.lastInboundTime }
      }).lean();

      if (outboundAfter) {
        skipped_replied++;
        continue;
      }

      // Check opt-out
      const optOutStatus = await isWhatsAppOptedOut(waId);
      if (optOutStatus.optedOut) {
        skipped_opted_out++;
        continue;
      }

      // Check if follow-up already sent in last 24 hours
      const recentFollowup = await WhatsAppMessage.findOne({
        sender_wa_id: waId,
        direction: 'outbound',
        platform: 'whatsapp',
        'raw_payload.is_followup': true,
        timestamp: { $gte: cooldownCutoff }
      }).lean();

      if (recentFollowup) {
        skipped_already_sent++;
        continue;
      }

      // Send follow-up template
      try {
        const result = await postWhatsAppTemplate({
          to: waId,
          templateName,
          languageCode: templateLanguage,
          components: []
        });

        if (result.ok) {
          // Persist follow-up message for dedup and inbox visibility
          const messageId = result.messageId || `followup_${waId}_${Date.now()}`;
          try {
            await WhatsAppMessage.create({
              message_id: messageId,
              sender_wa_id: waId,
              profile_name: '',
              message_type: 'text',
              text_body: `[Auto follow-up: ${templateName}]`,
              direction: 'outbound',
              platform: 'whatsapp',
              status: 'sent',
              timestamp: new Date(),
              raw_payload: {
                is_followup: true,
                followup_template: templateName,
                trigger_inbound_id: contact.lastInboundId
              },
              is_read_by_staff: true
            });
          } catch (persistErr) {
            if (persistErr?.code !== 11000) {
              console.error('FOLLOWUP_PERSIST_ERROR', { waId, error: persistErr.message });
            }
          }
          sent++;
          console.log('FOLLOWUP_SENT', { waId, templateName, messageId });
        } else if (result.skipped) {
          skipped_opted_out++;
        } else {
          skipped_failed++;
          console.warn('FOLLOWUP_SEND_FAILED', { waId, reason: result.reason || result.error });
        }
      } catch (sendErr) {
        skipped_failed++;
        console.error('FOLLOWUP_SEND_ERROR', { waId, error: sendErr.message });
      }
    }

    console.log('FOLLOWUP_CRON_COMPLETED', { scanned, sent, skipped_replied, skipped_opted_out, skipped_already_sent, skipped_failed });
    return res.json({
      template: templateName,
      scanned,
      sent,
      skipped_replied,
      skipped_opted_out,
      skipped_already_sent,
      skipped_failed
    });
  } catch (error) {
    console.error('FOLLOWUP_CRON_ERROR', error.message);
    return res.status(500).json({ error: 'Failed to execute follow-up automation' });
  }
});

// POST /booking-lifecycle — Phase 9.3 booking & session lifecycle sweep.
// Resolves two stuck state transitions:
//   - checked_in sessions whose session_end_time has passed → completed
//   - confirmed + unused bookings on past-dated slots → qr_status = expired
// Idempotent. Safe to run at any cadence (recommended: every 10-15 min).
router.post('/booking-lifecycle', async (req, res) => {
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized cron request' });
  }
  try {
    const result = await sweepHourlyBookingLifecycle();
    console.log('BOOKING_LIFECYCLE_CRON', result);
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error('BOOKING_LIFECYCLE_CRON_ERROR', error.message);
    return res.status(500).json({ error: 'Failed to run booking lifecycle sweep' });
  }
});

module.exports = router;
