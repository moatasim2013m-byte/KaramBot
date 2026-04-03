const Settings = require('../models/Settings');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const {
  normalizePhoneForWhatsApp,
  postWhatsAppText
} = require('./whatsappBookingConfirmation');

const DEFAULT_CONFIG = {
  enabled: false,
  cooldownMinutes: 30,
  footer: 'للحجز المباشر تفضلي عبر الموقع: https://peekaboojor.com/book',
  fallbackReply:
    'أهلاً وسهلاً 🌷 وصلتنا رسالتك، وفريقنا سيرد عليك بأسرع وقت. إذا حابة، ارسلي (أسعار / موقع / ساعات العمل / عيد ميلاد / اشتراك).'
};

const PRICING_KEYS = ['hourly_1hr', 'hourly_2hr', 'hourly_3hr', 'hourly_extra_hr'];

const normalizeText = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const keywordMap = [
  {
    key: 'pricing',
    keywords: ['سعر', 'اسعار', 'الاسعار', 'الأسعار', 'تكلفه', 'price', 'pricing', 'cost'],
    buildReply: ({ pricingText, footer }) =>
      ['أكيد 🌟 هاي أسعار اللعب الحالية:', pricingText, footer].filter(Boolean).join('\n')
  },
  {
    key: 'hours',
    keywords: ['ساعات', 'الدوام', 'متى', 'تفتح', 'تسكر', 'تغلق', 'hours', 'open'],
    reply:
      'ساعات العمل حاليًا: يوميًا 10:00 صباحًا - 11:00 مساءً، والخميس والجمعة حتى 12:00 منتصف الليل. 📍'
  },
  {
    key: 'location',
    keywords: ['موقع', 'العنوان', 'وين', 'location', 'address', 'اربد', 'إربد'],
    reply:
      'موقعنا: إربد - شارع الشهيد وصفي التل (أبو راشد) - مجمع السيف التجاري، الطابق الثاني، بجانب وحشة سنتر.'
  },
  {
    key: 'booking',
    keywords: ['حجز', 'احجز', 'book', 'booking', 'عيد', 'ميلاد', 'حفله', 'حفلة'],
    reply:
      'للحجز السريع 💛 تقدري تحجزي مباشرة من الموقع: https://peekaboojor.com/book أو اتركي رقمك ونتواصل معك.'
  },
  {
    key: 'subscription',
    keywords: ['اشتراك', 'باقه', 'باقة', 'subscription', 'plan', 'plans'],
    reply:
      'لدينا باقات اشتراك متعددة حسب عدد الزيارات والفترة. ارسلي كلمة (اشتراك) وسيقوم الفريق بتزويدك بأفضل خيار 👌'
  }
];

const loadAutoReplyConfig = async () => {
  const setting = await Settings.findOne({ key: 'whatsapp_auto_reply_config' }).lean();
  const value = setting?.value && typeof setting.value === 'object' ? setting.value : {};

  return {
    ...DEFAULT_CONFIG,
    ...value,
    enabled: Boolean(value?.enabled),
    cooldownMinutes: Math.max(1, Number(value?.cooldownMinutes || DEFAULT_CONFIG.cooldownMinutes))
  };
};

const buildPricingText = async () => {
  const docs = await Settings.find({ key: { $in: PRICING_KEYS } }).lean();

  const prices = {
    hourly_1hr: 7,
    hourly_2hr: 10,
    hourly_3hr: 13,
    hourly_extra_hr: 3
  };

  docs.forEach((doc) => {
    prices[doc.key] = Number(doc.value || prices[doc.key]);
  });

  return [
    `• ساعة: ${prices.hourly_1hr} د.أ`,
    `• ساعتان: ${prices.hourly_2hr} د.أ`,
    `• 3 ساعات: ${prices.hourly_3hr} د.أ`,
    `• كل ساعة إضافية: ${prices.hourly_extra_hr} د.أ`
  ].join('\n');
};

const detectKeyword = (textBody) => {
  const normalized = normalizeText(textBody);
  if (!normalized) return null;

  return keywordMap.find((entry) =>
    entry.keywords.some((keyword) => normalized.includes(normalizeText(keyword)))
  ) || null;
};

const hasRecentAutoReply = async (senderWaId, cooldownMinutes) => {
  const cutoff = new Date(Date.now() - cooldownMinutes * 60 * 1000);

  const recent = await WhatsAppMessage.findOne({
    sender_wa_id: senderWaId,
    direction: 'outbound',
    platform: 'whatsapp',
    'raw_payload.auto_reply': true,
    timestamp: { $gte: cutoff }
  })
    .sort({ timestamp: -1 })
    .lean();

  return Boolean(recent);
};

const persistAutoReplyMessage = async ({ waId, textBody, messageId, matchedKey }) => {
  if (!messageId) return;

  try {
    await WhatsAppMessage.create({
      message_id: messageId,
      sender_wa_id: waId,
      profile_name: '',
      message_type: 'text',
      text_body: textBody,
      direction: 'outbound',
      platform: 'whatsapp',
      status: 'sent',
      timestamp: new Date(),
      raw_payload: {
        auto_reply: true,
        matched_key: matchedKey
      },
      is_read_by_staff: true,
      is_replied: false
    });
  } catch (error) {
    if (error?.code !== 11000) {
      console.error('AUTO_REPLY_PERSIST_ERROR', error.message);
    }
  }
};

const maybeAutoReply = async ({ messageId, senderWaId, messageType, textBody }) => {
  try {
    if (!senderWaId || !messageId) return { skipped: true, reason: 'missing_payload' };
    if (messageType !== 'text') return { skipped: true, reason: 'unsupported_message_type' };

    const config = await loadAutoReplyConfig();
    if (!config.enabled) return { skipped: true, reason: 'disabled' };

    const normalizedWaId = normalizePhoneForWhatsApp(senderWaId);
    if (!normalizedWaId) return { skipped: true, reason: 'invalid_wa_id' };

    const alreadyHandled = await WhatsAppMessage.findOne({
      message_id: `auto_trigger_${messageId}`
    }).lean();
    if (alreadyHandled) return { skipped: true, reason: 'duplicate_trigger' };

    if (await hasRecentAutoReply(normalizedWaId, config.cooldownMinutes)) {
      await WhatsAppMessage.create({
        message_id: `auto_trigger_${messageId}`,
        sender_wa_id: normalizedWaId,
        message_type: 'unsupported',
        text_body: '',
        direction: 'outbound',
        platform: 'whatsapp',
        status: 'sent',
        timestamp: new Date(),
        raw_payload: { auto_reply: true, skipped: 'cooldown' },
        is_read_by_staff: true,
        is_replied: false
      }).catch(() => {});
      return { skipped: true, reason: 'cooldown_active' };
    }

    const matched = detectKeyword(textBody);
    const pricingText = matched?.key === 'pricing' ? await buildPricingText() : '';
    const replyText = matched
      ? (matched.buildReply
          ? matched.buildReply({ pricingText, footer: config.footer })
          : [matched.reply, config.footer].filter(Boolean).join('\n'))
      : config.fallbackReply;

    const sendResult = await postWhatsAppText({
      to: normalizedWaId,
      messageBody: replyText,
      staffId: null
    });

    if (!sendResult?.ok) {
      return { skipped: true, reason: sendResult?.reason || sendResult?.error || 'send_failed' };
    }

    await persistAutoReplyMessage({
      waId: normalizedWaId,
      textBody: replyText,
      messageId: sendResult.messageId,
      matchedKey: matched?.key || 'fallback'
    });

    await WhatsAppMessage.create({
      message_id: `auto_trigger_${messageId}`,
      sender_wa_id: normalizedWaId,
      message_type: 'unsupported',
      text_body: '',
      direction: 'outbound',
      platform: 'whatsapp',
      status: 'sent',
      timestamp: new Date(),
      raw_payload: { auto_reply: true, trigger_message_id: messageId, matched_key: matched?.key || 'fallback' },
      is_read_by_staff: true,
      is_replied: false
    }).catch(() => {});

    return { ok: true, matchedKey: matched?.key || 'fallback' };
  } catch (error) {
    console.error('AUTO_REPLY_ERROR', error.message);
    return { skipped: true, reason: 'exception', error: error.message };
  }
};

module.exports = {
  maybeAutoReply,
  DEFAULT_CONFIG
};
