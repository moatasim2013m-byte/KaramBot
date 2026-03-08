const DEFAULT_TIMEOUT_MS = 8000;

const getTrimmedEnv = (name) => String(process.env[name] || '').trim();

const normalizeJordanPhone = (input) => {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('962')) return `+${digits}`;
  if (digits.startsWith('0')) return `+962${digits.slice(1)}`;
  return `+${digits}`;
};

const buildCheckinMessage = ({ childName, bookingCode, checkInTime, sessionEndTime }) => {
  const child = childName || 'طفلكم';
  const code = bookingCode || '-';
  const checkedAt = checkInTime ? new Date(checkInTime).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' }) : '-';
  const endsAt = sessionEndTime ? new Date(sessionEndTime).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' }) : '-';

  return [
    `مرحباً، نؤكد لكم تسجيل دخول ${child} بنجاح في Peekaboo.`,
    `رقم الحجز: ${code}`,
    `وقت الدخول: ${checkedAt}`,
    `وقت نهاية الجلسة: ${endsAt}`,
    'شكراً لثقتكم بنا.'
  ].join('\n');
};

const postNotification = async ({ endpoint, token, payload }) => {
  if (!endpoint) return { ok: false, skipped: true, reason: 'missing_endpoint' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      responseText: text.slice(0, 500)
    };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
};

const sendCheckinConfirmation = async ({ phone, parentName, childName, bookingCode, checkInTime, sessionEndTime }) => {
  const to = normalizeJordanPhone(phone);
  if (!to) {
    return { ok: false, skipped: true, reason: 'missing_phone' };
  }

  const message = buildCheckinMessage({ childName, bookingCode, checkInTime, sessionEndTime });
  const token = getTrimmedEnv('CHECKIN_NOTIFICATIONS_TOKEN');

  const whatsappEndpoint = getTrimmedEnv('CHECKIN_WHATSAPP_ENDPOINT');
  const smsEndpoint = getTrimmedEnv('CHECKIN_SMS_ENDPOINT');

  const basePayload = {
    to,
    parentName: parentName || '',
    childName: childName || '',
    bookingCode: bookingCode || '',
    message,
    metadata: {
      source: 'peekaboo-checkin'
    }
  };

  if (whatsappEndpoint) {
    const whatsappResult = await postNotification({
      endpoint: whatsappEndpoint,
      token,
      payload: { ...basePayload, channel: 'whatsapp' }
    });

    if (whatsappResult.ok) {
      return { ok: true, channel: 'whatsapp' };
    }

    console.error('CHECKIN_WHATSAPP_SEND_FAILED', whatsappResult);
  }

  if (smsEndpoint) {
    const smsResult = await postNotification({
      endpoint: smsEndpoint,
      token,
      payload: { ...basePayload, channel: 'sms' }
    });

    if (smsResult.ok) {
      return { ok: true, channel: 'sms' };
    }

    console.error('CHECKIN_SMS_SEND_FAILED', smsResult);
    return { ok: false, channel: 'sms', error: smsResult.error || smsResult.responseText || 'send_failed' };
  }

  return { ok: false, skipped: true, reason: 'no_channels_configured' };
};

module.exports = {
  sendCheckinConfirmation
};

