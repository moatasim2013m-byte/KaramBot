const DEFAULT_TIMEOUT_MS = 10000;

const getTrimmedEnv = (name) => String(process.env[name] || '').trim();

const isWhatsAppEnabled = () => getTrimmedEnv('WHATSAPP_ENABLED').toLowerCase() === 'true';

const normalizePhoneForWhatsApp = (input) => {
  const raw = String(input || '').trim();
  if (!raw) return '';

  let sanitized = raw.replace(/\s+/g, '').replace(/[()-]/g, '');

  if (sanitized.startsWith('00')) sanitized = sanitized.slice(2);
  sanitized = sanitized.startsWith('+')
    ? sanitized.slice(1).replace(/\D/g, '')
    : sanitized.replace(/\D/g, '');

  // Legacy support for Jordan local numbers
  if (sanitized.startsWith('077')) sanitized = `96277${sanitized.slice(3)}`;
  else if (/^07\d+$/.test(sanitized)) sanitized = `9627${sanitized.slice(2)}`;

  // WhatsApp Cloud API expects E.164 digits without "+"
  if (!/^\d{8,15}$/.test(sanitized)) return '';
  return sanitized;
};

const buildHourlyBookingMessage = ({
  customerName,
  date,
  time,
  childCount,
  durationHours,
  bookingReference
}) => {
  const lines = [
    `أهلاً ${customerName || 'عميلنا العزيز'}، تم تأكيد حجزكم في Peekaboo 🎉`,
    'نوع الحجز: دخول ساعي',
    `التاريخ: ${date || 'غير محدد'}`,
    `الوقت: ${time || 'غير محدد'}`
  ];

  if (childCount !== undefined && childCount !== null && childCount !== '') {
    lines.push(`عدد الأطفال: ${childCount}`);
  }

  if (durationHours !== undefined && durationHours !== null && durationHours !== '') {
    lines.push(`المدة: ${durationHours} ساعة`);
  }

  if (bookingReference) {
    lines.push(`رقم الحجز: ${bookingReference}`);
  }

  lines.push('بنستناكم في بيكابو 💛');
  return lines.join('\n');
};

const buildBirthdayBookingMessage = ({
  customerName,
  date,
  time,
  childName,
  packageOrTheme,
  bookingReference
}) => {
  const lines = [
    `أهلاً ${customerName || 'عميلنا العزيز'}، تم تأكيد حجز عيد الميلاد في Peekaboo 🎉`,
    'نوع الحجز: عيد ميلاد',
    `التاريخ: ${date || 'غير محدد'}`,
    `الوقت: ${time || 'غير محدد'}`
  ];

  if (childName) {
    lines.push(`اسم الطفل: ${childName}`);
  }

  if (packageOrTheme) {
    lines.push(`الباقة/الثيم: ${packageOrTheme}`);
  }

  if (bookingReference) {
    lines.push(`رقم الحجز: ${bookingReference}`);
  }

  lines.push('بنستناكم تحتفلوا معنا في بيكابو 💛');
  return lines.join('\n');
};

const postWhatsAppText = async ({ to, messageBody, staffId = null }) => {
  const accessToken = getTrimmedEnv('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = getTrimmedEnv('WHATSAPP_PHONE_NUMBER_ID');

  if (!accessToken || !phoneNumberId) {
    console.warn('WHATSAPP_BOOKING_CONFIRMATION_CONFIG_MISSING');
    return { ok: false, skipped: true, reason: 'missing_config' };
  }

  const endpoint = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: messageBody }
      }),
      signal: controller.signal
    });

    const responseText = await response.text();
    if (!response.ok) {
      console.error('WHATSAPP_API_ERROR', {
        status: response.status,
        response: responseText.slice(0, 500)
      });
      return { ok: false, status: response.status, responseText: responseText.slice(0, 500) };
    }

    // Parse response and extract message_id
    let responseData = {};
    let messageId = null;
    try {
      responseData = JSON.parse(responseText);
      messageId = responseData?.messages?.[0]?.id;
      
      if (!messageId) {
        console.warn('WHATSAPP_API_NO_MESSAGE_ID', { responseData });
      }
    } catch (e) {
      console.error('WHATSAPP_API_PARSE_ERROR', {
        error: e.message,
        responseText: responseText.slice(0, 200)
      });
    }

    // Save outbound message to database if staffId provided
    if (staffId && messageId) {
      try {
        const WhatsAppMessage = require('../models/WhatsAppMessage');
        await WhatsAppMessage.create({
          message_id: messageId,
          sender_wa_id: to,
          direction: 'outbound',
          message_type: 'text',
          text_body: messageBody,
          platform: 'whatsapp',
          status: 'sent',
          sent_by_staff_id: staffId,
          timestamp: new Date(),
          // Campaign fields (null for staff inbox messages)
          campaign_id: null,
          broadcast_id: null,
          is_template_message: false,
          template_id: null,
          consent_verified: false
        });
        
        console.log('WHATSAPP_OUTBOUND_PERSISTED', {
          message_id: messageId,
          to,
          staff_id: staffId
        });
      } catch (dbError) {
        console.error('WHATSAPP_DB_PERSIST_ERROR', {
          error: dbError.message,
          message_id: messageId
        });
        // Don't fail the send - message was sent successfully to WhatsApp
      }
    }

    return { ok: true, messageId };
  } catch (error) {
    console.error('WHATSAPP_SEND_ERROR', {
      error: error.message,
      to
    });
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
};

const sendHourlyBookingWhatsAppConfirmation = async ({
  phone,
  customerName,
  date,
  time,
  childCount,
  durationHours,
  bookingReference,
  bookingId
}) => {
  if (!isWhatsAppEnabled()) return { ok: false, skipped: true, reason: 'disabled' };

  const normalizedPhone = normalizePhoneForWhatsApp(phone);
  if (!normalizedPhone) {
    console.warn('WHATSAPP_BOOKING_CONFIRMATION_INVALID_PHONE', { bookingType: 'hourly', bookingId });
    return { ok: false, skipped: true, reason: 'invalid_phone' };
  }

  const messageBody = buildHourlyBookingMessage({
    customerName,
    date,
    time,
    childCount,
    durationHours,
    bookingReference
  });

  const result = await postWhatsAppText({ to: normalizedPhone, messageBody });
  if (result.ok) {
    console.log('WHATSAPP_BOOKING_CONFIRMATION_SENT', { bookingType: 'hourly', bookingId });
    return result;
  }

  console.error('WHATSAPP_BOOKING_CONFIRMATION_FAILED', { bookingType: 'hourly', bookingId, ...result });
  return result;
};

const sendBirthdayBookingWhatsAppConfirmation = async ({
  phone,
  customerName,
  date,
  time,
  childName,
  packageOrTheme,
  bookingReference,
  bookingId
}) => {
  if (!isWhatsAppEnabled()) return { ok: false, skipped: true, reason: 'disabled' };

  const normalizedPhone = normalizePhoneForWhatsApp(phone);
  if (!normalizedPhone) {
    console.warn('WHATSAPP_BOOKING_CONFIRMATION_INVALID_PHONE', { bookingType: 'birthday', bookingId });
    return { ok: false, skipped: true, reason: 'invalid_phone' };
  }

  const messageBody = buildBirthdayBookingMessage({
    customerName,
    date,
    time,
    childName,
    packageOrTheme,
    bookingReference
  });

  const result = await postWhatsAppText({ to: normalizedPhone, messageBody });
  if (result.ok) {
    console.log('WHATSAPP_BOOKING_CONFIRMATION_SENT', { bookingType: 'birthday', bookingId });
    return result;
  }

  console.error('WHATSAPP_BOOKING_CONFIRMATION_FAILED', { bookingType: 'birthday', bookingId, ...result });
  return result;
};

module.exports = {
  sendHourlyBookingWhatsAppConfirmation,
  sendBirthdayBookingWhatsAppConfirmation,
  postWhatsAppText // Export for staff inbox use
};
