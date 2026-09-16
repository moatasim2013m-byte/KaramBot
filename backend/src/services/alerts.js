/**
 * Staff alerts (decision D7).
 *
 * Two optional channels: a Slack/Discord-compatible webhook (STAFF_ALERT_WEBHOOK_URL) and
 * WhatsApp texts to staff numbers in ai_config.alert_wa_numbers. A WhatsApp alert is only
 * free-form text, so it goes out only while that staff number has an open 24 h window with
 * this business — otherwise Meta would reject it (or bill a template we don't have).
 *
 * Alerts are best effort: they are called from the reply path and must never throw into it.
 */

const axios = require('axios');
const prisma = require('../config/prisma');
const { sendText } = require('./whatsapp');
const { isWithinServiceWindow } = require('../utils/serviceWindow');
const { decrypt } = require('../utils/tokenCrypto');

const ALERT_REASONS = ['handoff', 'quote', 'needs_team', 'meeting', 'ai_failure', 'reply_failures', 'billing', 'sla_breached',
  'awaiting_staff', 'ambiguous_send', 'inbound_without_outbound', 'window_closing', 'hot_lead', 'unsent_reply',
  // PR3: sales-call bookings in Google Calendar and their reminders.
  'booking_booked', 'booking_rescheduled', 'booking_cancelled', 'booking_failed', 'booking_change_request', 'reminder_blocked'];

const ALERT_LABELS = {
  handoff: 'طلب شخص من الفريق',
  quote: 'طلب عرض سعر',
  needs_team: 'يحتاج الفريق',
  meeting: 'طلب مكالمة',
  ai_failure: 'تعطّل رد البوت',
  reply_failures: 'فشل الإرسال 3 مرات',
  billing: 'واتساب موقف الإرسال — طريقة الدفع',
  sla_breached: 'طلب بالقائمة من 15 دقيقة بدون استلام',
  awaiting_staff: 'رسالة بانتظار الموظف من 10 دقائق',
  ambiguous_send: 'إرسال غير مؤكد',
  inbound_without_outbound: 'رسالة بدون رد من دقيقتين',
  window_closing: 'نافذة الـ24 ساعة قربت تسكر',
  hot_lead: 'عميل ساخن',
  // D18/D19: the bot's reply stayed unconfirmed (or failed) twice; the customer may have nothing.
  unsent_reply: 'رد البوت ما وصل — العميل بدون رد',
  booking_booked: 'مكالمة انحجزت بالتقويم',
  booking_rescheduled: 'مكالمة تغيّر موعدها',
  booking_cancelled: 'مكالمة انلغت',
  // The calendar did not take the booking: the customer was told it is a request, not a confirmed call.
  booking_failed: 'الحجز بالتقويم ما زبط — طلب مكالمة بدون موعد مؤكد',
  booking_change_request: 'طلب تغيير/إلغاء مكالمة ما انعمل بالتقويم',
  reminder_blocked: 'تذكير المكالمة ما انبعت (القالب أو طريقة الدفع)',
};

const WEBHOOK_TIMEOUT_MS = 5000;

// The profile name and summary are the customer's own words. Slack parses <!channel>, <url|label>
// and Discord @everyone inside `text`, so the webhook copy escapes them; WhatsApp shows text as is.
function escapeForWebhook(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@(everyone|here|channel)/gi, '@\u200b$1');
}

// Plain text only: Slack, Discord and WhatsApp all render it the same.
function formatAlertText({ reason, business, conversation, summary }, { forWebhook = false } = {}) {
  const conv = conversation || {};
  const label = ALERT_LABELS[reason] || reason;
  const safe = (v) => (forWebhook ? escapeForWebhook(v) : v);
  return `🔔 SHIFT bot — ${label}\nالعميل: ${safe(conv.profile_name || '-')} (+${conv.customer_wa_id})\n${safe(summary || '')}\nconversation=${conv.id}`;
}

function alertNumbers(business) {
  const list = business?.ai_config?.alert_wa_numbers;
  if (!Array.isArray(list)) return [];
  return list.map((n) => String(n ?? '').replace(/\D/g, '')).filter(Boolean);
}

function alertChannelConfigured(business) {
  return !!(process.env.STAFF_ALERT_WEBHOOK_URL || '').trim() || alertNumbers(business).length > 0;
}

async function sendWhatsAppAlert(business, number, text, reason, now) {
  const conv = await prisma.conversation.findFirst({
    where: { business_id: business.id, customer_wa_id: number },
  });
  if (!conv || !isWithinServiceWindow(conv.last_inbound_at, now)) {
    console.warn('[alerts] skip wa', number, 'outside window');
    return 'skipped';
  }

  const token = decrypt(business.wa_access_token);
  const sent = await sendText(business.wa_phone_number_id, token, number, text);
  if (!sent || !sent.ok) {
    console.error(`[alerts] wa alert to ${number} failed: ${sent?.reason} ${sent?.error}`);
    return 'failed';
  }

  // Store it so the staff member's own thread in the Inbox shows what they were sent.
  try {
    await prisma.message.create({
      data: {
        business_id: business.id,
        conversation_id: conv.id,
        direction: 'outbound',
        message_type: 'text',
        text_body: text,
        status: 'sent',
        meta_message_id: sent.id,
        is_ai_generated: false,
        raw_payload: { kind: 'staff_alert', reason },
      },
    });
  } catch (err) {
    console.error(`[alerts] wa alert to ${number} sent but not stored: ${err.message}`);
  }
  return 'sent';
}

/**
 * Send one alert to every configured channel. Never throws, never rejects.
 * @returns {Promise<{webhook: 'sent'|'failed'|'skipped', whatsapp: Array<{to, status}>}>}
 */
async function sendStaffAlert({ reason, business, conversation, summary = '', now = new Date() } = {}) {
  const report = { webhook: 'skipped', whatsapp: [] };
  try {
    const text = formatAlertText({ reason, business, conversation, summary });

    const url = (process.env.STAFF_ALERT_WEBHOOK_URL || '').trim();
    if (url) {
      try {
        await axios.post(url, {
          text: formatAlertText({ reason, business, conversation, summary }, { forWebhook: true }),
          reason,
          conversationId: conversation?.id ?? null,
          businessId: business?.id ?? null,
        }, { timeout: WEBHOOK_TIMEOUT_MS });
        report.webhook = 'sent';
      } catch (err) {
        report.webhook = 'failed';
        console.error(`[alerts] webhook failed reason=${reason}: ${err.message}`);
      }
    }

    for (const number of alertNumbers(business)) {
      let status;
      try {
        status = await sendWhatsAppAlert(business, number, text, reason, now);
      } catch (err) {
        status = 'failed';
        console.error(`[alerts] wa alert to ${number} failed: ${err.message}`);
      }
      report.whatsapp.push({ to: number, status });
    }

    if (report.webhook !== 'sent' && !report.whatsapp.some((w) => w.status === 'sent')) {
      console.warn(`[alerts] reason=${reason} conversation=${conversation?.id} reached no staff channel`);
    }
  } catch (err) {
    console.error(`[alerts] failed reason=${reason}: ${err.message}`);
  }
  return report;
}

module.exports = { ALERT_REASONS, ALERT_LABELS, formatAlertText, sendStaffAlert, alertChannelConfigured };
