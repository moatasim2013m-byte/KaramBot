/**
 * Staff alerts (decision D7).
 *
 * Two optional channels: a Slack/Discord-compatible webhook (STAFF_ALERT_WEBHOOK_URL) and
 * WhatsApp messages to staff numbers in ai_config.alert_wa_numbers. Inside the staff number's 24 h
 * window the alert is free-form text (free). Outside it — or when the staff member never wrote to the
 * number — it goes out as the approved utility template in ai_config.alert_template ({name, language});
 * with no template configured, or one Meta refuses (not approved yet, paused), it is skipped and logged.
 *
 * The webhook is SHIFT's private channel: it carries SHIFT's own sales-bot alerts and the platform
 * reasons (notifyShift) only. A tenant's alerts go to that tenant's numbers and nowhere else.
 *
 * Alerts are best effort: they are called from the reply path and must never throw into it.
 */

const axios = require('axios');
const prisma = require('../config/prisma');
const { sendText, sendTemplate } = require('./whatsapp');
const { isWithinServiceWindow } = require('../utils/serviceWindow');
const { decrypt } = require('../utils/tokenCrypto');
const { markOutbound } = require('./lastOutbound');

const ALERT_REASONS = ['handoff', 'quote', 'needs_team', 'meeting', 'ai_failure', 'reply_failures', 'billing', 'sla_breached',
  'awaiting_staff', 'ambiguous_send', 'inbound_without_outbound', 'window_closing', 'hot_lead', 'unsent_reply',
  // PR3: sales-call bookings in Google Calendar and their reminders.
  'booking_booked', 'booking_rescheduled', 'booking_cancelled', 'booking_failed', 'booking_change_request', 'reminder_blocked',
  // A call REQUEST (no calendar event) the customer stopped.
  'call_request_cancelled',
  // Calendly bookings the sweep could not tie to a conversation by phone.
  'calendly_check', 'calendly_unmatched',
  // A customer wrote (first message, or after a quiet gap) — services/newMessageAlert.js.
  'new_message',
  // Platform alerts: about SHIFT's customers (the shops), sent only to SHIFT by notifyShift.
  'join_opened', 'customer_connected', 'connect_failed', 'needs_operator', 'went_live', 'partner_removed',
  'payment_blocked', 'provider_down', 'cap_80', 'cap_reached', 'platform_ceiling', 'trial_ending', 'payment_claimed',
  // To a shop's owner, from the shop's own number: their free month is ending (shiftSweeper daily).
  'trial_reminder'];

// The reasons notifyShift sends. They describe a shop or the platform, never an end customer's
// conversation, so they are the only ones besides SHIFT's own sales bot that may reach
// STAFF_ALERT_WEBHOOK_URL (SHIFT's private channel).
const PLATFORM_REASONS = Object.freeze(['join_opened', 'customer_connected', 'connect_failed', 'needs_operator',
  'went_live', 'partner_removed', 'payment_blocked', 'provider_down', 'cap_80', 'cap_reached', 'platform_ceiling',
  'trial_ending', 'payment_claimed']);

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
  call_request_cancelled: 'العميل أوقف طلب المكالمة',
  calendly_check: 'حجز Calendly بحاجة تأكيد — مطابقة بالاسم فقط',
  calendly_unmatched: 'حجز Calendly بدون محادثة واتساب',
  new_message: 'رسالة جديدة من عميل',
  join_opened: 'زبون فتح رابط الانضمام',
  customer_connected: 'زبون ربط واتساب',
  connect_failed: 'ربط واتساب ما زبط',
  needs_operator: 'ربط واتساب يحتاج تدخّل شِفت',
  went_live: 'البوت ردّ على أول زبون',
  partner_removed: 'زبون فصل شِفت من حساب Meta',
  payment_blocked: 'Meta رفضت ردود البوت — طريقة الدفع',
  provider_down: 'مزوّد الذكاء الاصطناعي متعطّل',
  cap_80: 'زبون وصل 80% من ردود الشهر',
  cap_reached: 'زبون وصل حد ردود الشهر',
  platform_ceiling: 'وصلنا سقف ردود اليوم لكل المنصة',
  trial_ending: 'الفترة المجانية لزبون قاربت تنتهي',
  payment_claimed: 'زبون قال إنه أضاف بطاقة الدفع لدى Meta — بانتظار تأكيدك',
  trial_reminder: 'تذكير بالفترة المجانية لكرم بوت',
};

const WEBHOOK_TIMEOUT_MS = 5000;

// The staff-alert utility template, exactly as submitted to Meta for SHIFT (name staff_alert, ar, UTILITY,
// template id 1012210055209109; scripts/create-alert-template.js builds the same payload). A template is the
// only way to reach a staff number outside its 24 h window. Variables — never reorder or add: {{1}} alert
// label, {{2}} customer (name + number), {{3}} short summary. No header, no buttons. The body neither starts
// nor ends with a variable.
const ALERT_TEMPLATE_NAME = 'staff_alert';
const ALERT_TEMPLATE_LANGUAGE = 'ar';
const ALERT_TEMPLATE_BODY = 'تنبيه لفريق شِفت: {{1}}\nالعميل: {{2}}\nالتفاصيل: {{3}}\nافتح صندوق الرسائل للرد.';
// Meta allows up to 1024 per parameter; alerts stay short so the notification preview is readable.
const TEMPLATE_VAR_MAX = 200;
const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;

// Same default as the booking card's link (workflows/shift/booking.js).
function inboxUrl() {
  return (process.env.SHIFT_INBOX_URL || '').trim() || 'https://app.shifts-ai.com/inbox';
}

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
//
// The conversation id is NOT in the text: staff read these on their own phones, and a line like
// «conversation=cmu0x7xgd0001oy9dkumedui8» is noise to everyone who is not debugging (owner, 2026-09-21).
// The customer's name and number identify the chat — that is what staff search WhatsApp by — and every
// alert still carries the id in the server log beside it (`[alerts] reason=… conversation=…`).
//
// `link` is ours, never customer text, and adds an «Inbox: …» line when a destination is known.
//
// The webhook copy also names the business: SHIFT's channel hears about its own sales bot and about
// the platform (notifyShift), and a line that does not say which account it is about is useless there.
function formatAlertText({ reason, business, conversation, summary, link }, { forWebhook = false } = {}) {
  const conv = conversation || {};
  const label = ALERT_LABELS[reason] || reason;
  const safe = (v) => (forWebhook ? escapeForWebhook(v) : v);
  const lines = [
    `🔔 SHIFT bot — ${label}`,
    forWebhook && business?.name ? `الحساب: ${safe(business.name)}` : '',
    `العميل: ${safe(conv.profile_name || '-')}${conv.customer_wa_id ? ` (+${conv.customer_wa_id})` : ''}`,
    safe(summary || ''),
    link ? `Inbox: ${link}` : '',
  ];
  return lines.filter((l) => String(l).trim()).join('\n');
}

/**
 * One template variable under Meta's rules: no newlines or tabs, never more than 4 consecutive spaces,
 * not empty, and cut to `max` characters (code points, so an emoji or Arabic mark is never split).
 */
function templateVar(value, max = TEMPLATE_VAR_MAX) {
  const flat = String(value ?? '')
    .replace(/\s*[\r\n\u2028\u2029]+\s*/g, ' · ')
    .replace(/[\t\v\f\u00a0]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/^[\s·]+|[\s·]+$/g, '');
  const chars = Array.from(flat);
  const out = chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join('').trimEnd()}…` : flat;
  return out || '-';
}

/** The three body parameters of the staff-alert template: label, customer, summary. */
function alertTemplateParams({ reason, conversation, summary }) {
  const conv = conversation || {};
  const name = conv.profile_name || '-';
  const customer = conv.customer_wa_id ? `${name} (+${conv.customer_wa_id})` : name;
  return [templateVar(ALERT_LABELS[reason] || reason), templateVar(customer), templateVar(summary)];
}

/** ai_config.alert_template → {name, language}, or null when unset/invalid. A bare string is the name. */
function alertTemplate(business) {
  const raw = business?.ai_config?.alert_template;
  if (!raw) return null;
  const name = typeof raw === 'string' ? raw : raw.name;
  const language = (typeof raw === 'object' && typeof raw.language === 'string' && raw.language.trim()) || ALERT_TEMPLATE_LANGUAGE;
  if (typeof name !== 'string' || !TEMPLATE_NAME_RE.test(name)) {
    console.error(`[alerts] ai_config.alert_template has an invalid name for business=${business?.id} — template fallback off`);
    return null;
  }
  return { name, language };
}

// The Inbox copy of a sent template: the approved wording with the parameters filled in.
function renderAlertTemplate(template, params) {
  const body = ALERT_TEMPLATE_BODY.replace(/\{\{(\d+)\}\}/g, (m, i) => params[Number(i) - 1] ?? m);
  return `[قالب ${template.name}] ${body}`;}

function alertNumbers(business) {
  const list = business?.ai_config?.alert_wa_numbers;
  if (!Array.isArray(list)) return [];
  return list.map((n) => String(n ?? '').replace(/\D/g, '')).filter(Boolean);
}

function isShiftBusiness(business) {
  return business?.business_type === 'shift';
}

/**
 * Whether this alert may go to STAFF_ALERT_WEBHOOK_URL. That channel is SHIFT's own: it used to
 * receive every tenant's handoffs and new-message alerts too, so a shop's customer names, numbers
 * and words landed in SHIFT's Slack. Now only SHIFT's own sales bot and the platform reasons go.
 */
function webhookAllowed(business, reason) {
  return isShiftBusiness(business) || PLATFORM_REASONS.includes(reason);
}

// A tenant's own channel is its alert numbers; the webhook counts only where it may be used.
function alertChannelConfigured(business) {
  const webhook = !!(process.env.STAFF_ALERT_WEBHOOK_URL || '').trim() && (!business || isShiftBusiness(business));
  return webhook || alertNumbers(business).length > 0;
}

async function storeAlert(business, conversationId, number, row) {
  try {
    const stored = await prisma.message.create({
      data: {
        business_id: business.id,
        conversation_id: conversationId,
        direction: 'outbound',
        status: 'sent',
        is_ai_generated: false,
        ...row,
      },
    });
    await markOutbound(conversationId, stored && stored.created_at);
  } catch (err) {
    console.error(`[alerts] wa alert to ${number} sent but not stored: ${err.message}`);
  }
}

// The staff member's own thread for the stored template. A staff number that never wrote to the business
// has none yet: it is created like any first contact (a race on the unique key reads the winner's row).
async function staffThread(business, number) {
  try {
    return await prisma.conversation.create({
      data: { business_id: business.id, customer_wa_id: number, profile_name: null, status: 'open', ai_enabled: true },
    });
  } catch (err) {
    if (err && err.code === 'P2002') {
      return prisma.conversation.findFirst({ where: { business_id: business.id, customer_wa_id: number } });
    }
    throw err;
  }
}

async function sendTemplateAlert(business, number, conv, { reason, params }) {
  const template = alertTemplate(business);
  if (!template) {
    console.warn('[alerts] skip wa', number, 'outside window (no ai_config.alert_template)');
    return 'skipped';
  }

  const token = decrypt(business.wa_access_token);
  const sent = await sendTemplate(business.wa_phone_number_id, token, number, {
    type: 'template', name: template.name, language: template.language, bodyParams: params,
  });
  if (!sent || !sent.ok) {
    if (sent?.reason === 'template' || sent?.reason === 'invalid_payload') {
      // Not approved yet, paused/disabled, or its variables no longer match the approved body.
      console.error(`[alerts] skip wa ${number}: template ${template.name}/${template.language} refused `
        + `(reason=${sent.reason} code=${sent.code}): ${sent.error} — check its status with scripts/create-alert-template.js --status`);
      return 'skipped';
    }
    console.error(`[alerts] template alert to ${number} failed: ${sent?.reason} ${sent?.error}`);
    return 'failed';
  }

  let thread = conv;
  if (!thread) {
    try {
      thread = await staffThread(business, number);
    } catch (err) {
      console.error(`[alerts] template alert to ${number} sent but no thread to store it: ${err.message}`);
    }
  }
  if (thread) {
    await storeAlert(business, thread.id, number, {
      message_type: 'template',
      text_body: renderAlertTemplate(template, params),
      meta_message_id: sent.id,
      raw_payload: { kind: 'staff_alert', reason, template: { name: template.name, language: template.language, params } },
    });
  }
  return 'sent_template';
}

async function sendWhatsAppAlert(business, number, alert) {
  const { text, reason, now } = alert;
  const conv = await prisma.conversation.findFirst({
    where: { business_id: business.id, customer_wa_id: number },
  });

  // Free-form is free and preferred while the staff member's window is open.
  if (conv && isWithinServiceWindow(conv.last_inbound_at, now)) {
    const token = decrypt(business.wa_access_token);
    const sent = await sendText(business.wa_phone_number_id, token, number, text);
    if (sent && sent.ok) {
      // Store it so the staff member's own thread in the Inbox shows what they were sent.
      await storeAlert(business, conv.id, number, {
        message_type: 'text',
        text_body: text,
        meta_message_id: sent.id,
        raw_payload: { kind: 'staff_alert', reason },
      });
      return 'sent';
    }
    if (sent?.reason !== 'window') {
      console.error(`[alerts] wa alert to ${number} failed: ${sent?.reason} ${sent?.error}`);
      return 'failed';
    }
    // 131047: Meta's clock says the window closed (skew around the 24 h mark) — the template still reaches them.
    console.warn(`[alerts] wa alert to ${number}: Meta reports the window closed — trying the template`);
  }

  return sendTemplateAlert(business, number, conv, alert);
}

/**
 * Send one alert to every configured channel. Never throws, never rejects.
 * @returns {Promise<{webhook: 'sent'|'failed'|'skipped', whatsapp: Array<{to, status: 'sent'|'sent_template'|'skipped'|'failed'}>}>}
 */
async function sendStaffAlert({ reason, business, conversation, summary = '', link = null, now = new Date() } = {}) {
  const report = { webhook: 'skipped', whatsapp: [] };
  try {
    const text = formatAlertText({ reason, business, conversation, summary, link });

    const url = (process.env.STAFF_ALERT_WEBHOOK_URL || '').trim();
    if (url && webhookAllowed(business, reason)) {
      try {
        await axios.post(url, {
          text: formatAlertText({ reason, business, conversation, summary, link }, { forWebhook: true }),
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

    const numbers = alertNumbers(business);
    const params = numbers.length ? alertTemplateParams({ reason, conversation, summary }) : null;
    for (const number of numbers) {
      let status;
      try {
        status = await sendWhatsAppAlert(business, number, { text, reason, now, params });
      } catch (err) {
        status = 'failed';
        console.error(`[alerts] wa alert to ${number} failed: ${err.message}`);
      }
      report.whatsapp.push({ to: number, status });
    }

    if (report.webhook !== 'sent' && !report.whatsapp.some((w) => w.status === 'sent' || w.status === 'sent_template')) {
      console.warn(`[alerts] reason=${reason} conversation=${conversation?.id} reached no staff channel`);
    }
  } catch (err) {
    console.error(`[alerts] failed reason=${reason}: ${err.message}`);
  }
  return report;
}

// ─── alerts to SHIFT about its customers ────────────────────────────────────

const SHIFT_SUMMARY_MAX = 200;

/**
 * SHIFT's own Business row: the sales bot's number, which is what alerts SHIFT staff. A '-sim'
 * test row can share business_type 'shift', so the real one (not a '-sim' slug) is preferred.
 */
async function shiftBusiness() {
  const rows = await prisma.business.findMany({
    where: { business_type: 'shift', status: 'active' },
    orderBy: { created_at: 'asc' },
  });
  const usable = (rows || []).filter((b) => b.wa_phone_number_id && b.wa_access_token);
  return usable.find((b) => !String(b.slug || '').endsWith('-sim')) || usable[0] || null;
}

/**
 * Tell SHIFT about one of its customers (a shop) or about the platform: a connect, a first live
 * reply, an AI provider outage. Sent from SHIFT's own row through the same staff-alert machinery
 * (free text inside the staff number's 24 h window, the approved staff_alert template outside it),
 * to PlatformSetting shift_alert_numbers, or SHIFT's own ai_config.alert_wa_numbers when that
 * setting is empty, and to STAFF_ALERT_WEBHOOK_URL.
 *
 * It takes no conversation and no message: the "customer" in the alert is the shop (its name and
 * owner phone), and the summary is the caller's own wording. An end customer's text has no field
 * to arrive through, and anything else passed in is ignored.
 *
 * Never throws; resolves with sendStaffAlert's report, or null when there is no SHIFT row.
 */
async function notifyShift({ reason, businessId = null, shopName = '', phone = '', summary = '', now = new Date() } = {}) {
  try {
    const shift = await shiftBusiness();
    if (!shift) {
      console.error(`[alerts] notifyShift reason=${reason} business=${businessId}: no active SHIFT business row`);
      return null;
    }

    let name = String(shopName || '').trim();
    let ownerPhone = String(phone || '').replace(/\D/g, '');
    if (businessId && (!name || !ownerPhone)) {
      try {
        const shop = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, owner_phone: true } });
        if (shop) {
          name = name || shop.name || '';
          ownerPhone = ownerPhone || String(shop.owner_phone || '').replace(/\D/g, '');
        }
      } catch (err) {
        console.warn(`[alerts] notifyShift could not read business=${businessId}: ${err.message}`);
      }
    }

    let numbers = [];
    try {
      const settings = require('./platformSettings');
      numbers = alertNumbers({ ai_config: { alert_wa_numbers: await settings.get('shift_alert_numbers') } });
    } catch (err) {
      console.warn(`[alerts] notifyShift could not read shift_alert_numbers: ${err.message}`);
    }
    if (!numbers.length) numbers = alertNumbers(shift);

    return await sendStaffAlert({
      reason,
      business: { ...shift, ai_config: { ...(shift.ai_config || {}), alert_wa_numbers: numbers } },
      // Not a conversation: the shop, in the slot the template calls «العميل».
      conversation: { id: null, profile_name: name || '-', customer_wa_id: ownerPhone || null },
      summary: summary ? templateVar(summary, SHIFT_SUMMARY_MAX) : '',
      now,
    });
  } catch (err) {
    console.error(`[alerts] notifyShift failed reason=${reason}: ${err.message}`);
    return null;
  }
}

module.exports = {
  ALERT_REASONS,
  PLATFORM_REASONS,
  notifyShift,
  webhookAllowed,
  ALERT_LABELS,
  ALERT_TEMPLATE_NAME,
  ALERT_TEMPLATE_LANGUAGE,
  ALERT_TEMPLATE_BODY,
  TEMPLATE_VAR_MAX,
  formatAlertText,
  sendStaffAlert,
  alertChannelConfigured,
  alertNumbers,
  alertTemplate,
  alertTemplateParams,
  templateVar,
  renderAlertTemplate,
  inboxUrl,
};
