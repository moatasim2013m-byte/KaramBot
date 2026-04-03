const Settings = require('../models/Settings');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Theme = require('../models/Theme');
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

const PRICING_KEYS = ['hourly_1hr', 'hourly_2hr', 'hourly_3hr', 'hourly_extra_hr', 'extra_companion', 'sand_area_addon', 'transport_one_way'];
const STAFF_REPLY_BLOCK_MINUTES = 10;

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

// ─── DB fetch helpers ────────────────────────────────────────────────────────

const buildPlayPricingText = async () => {
  const docs = await Settings.find({ key: { $in: PRICING_KEYS } }).lean();

  const prices = {
    hourly_1hr: 7,
    hourly_2hr: 10,
    hourly_3hr: 13,
    hourly_extra_hr: 3,
    extra_companion: 3,
    sand_area_addon: 20,
    transport_one_way: 40
  };

  docs.forEach((doc) => {
    prices[doc.key] = Number(doc.value || prices[doc.key]);
  });

  const lines = [
    `• ساعة: ${prices.hourly_1hr} د.أ`,
    `• ساعتان: ${prices.hourly_2hr} د.أ`,
    `• 3 ساعات: ${prices.hourly_3hr} د.أ`,
    `• كل ساعة إضافية: ${prices.hourly_extra_hr} د.أ`,
    `• مرافق إضافي: ${prices.extra_companion} د.أ`,
    `• منطقة الرمل (إضافة): ${prices.sand_area_addon} د.أ`,
    `• خدمة التوصيل (اتجاه واحد): ${prices.transport_one_way} د.أ`
  ];

  return lines.join('\n');
};

const buildHoursText = async () => {
  try {
    const doc = await Settings.findOne({ key: 'whatsapp_hours' }).lean();
    if (doc && doc.value) return String(doc.value);
  } catch (_) { /* fallback */ }
  return 'الأحد-الخميس: 10ص-11م، الجمعة-السبت: 10ص-12ص';
};

const buildLocationText = async () => {
  try {
    const doc = await Settings.findOne({ key: 'whatsapp_location' }).lean();
    if (doc && doc.value) return String(doc.value);
  } catch (_) { /* fallback */ }
  return 'إربد - شارع أبو راشد، مجمع السيف التجاري، الطابق الثاني';
};

const buildDaycareText = async () => {
  try {
    const plans = await SubscriptionPlan.find({ is_active: true }).sort({ price: 1 }).lean();
    if (!plans.length) throw new Error('empty');

    const lines = plans.map((p) => {
      const nameDisplay = p.name_ar || p.name;
      const durationParts = [];
      if (p.duration_hours) durationParts.push(`${p.duration_hours} ساعة`);
      if (p.duration_minutes) durationParts.push(`${p.duration_minutes} دقيقة`);
      const durationStr = durationParts.length ? ` (${durationParts.join(' و')})` : '';
      const timeSlotsStr = p.time_slots && p.time_slots.length ? ` | ${p.time_slots.join(', ')}` : '';
      return `• ${nameDisplay}: ${p.price} د.أ${durationStr}${timeSlotsStr}`;
    });

    return lines.join('\n');
  } catch (_) {
    return '• نصف يوم: 149 د.أ (6 ساعات)\n• يوم كامل: 199 د.أ (12 ساعة)';
  }
};

const buildBirthdayText = async () => {
  try {
    const packages = await Theme.find({ package_type: 'birthday', is_active: true }).sort({ price: 1 }).lean();
    if (!packages.length) throw new Error('empty');

    const lines = packages.map((pkg) => {
      const nameDisplay = pkg.name_ar || pkg.name;
      const inc = pkg.includes || {};
      const details = [];
      if (inc.kids_count) details.push(`${inc.kids_count} طفل`);
      if (inc.play_hours) details.push(`${inc.play_hours} ساعة لعب`);
      if (inc.meals) details.push(`${inc.meals} وجبة`);
      if (inc.stands) details.push(`${inc.stands} ستاند`);
      if (inc.gifts_per_kid) details.push('هدايا للأطفال');
      if (inc.premium_gift) details.push('هدية مميزة');
      const detailsStr = details.length ? ` — ${details.join(', ')}` : '';
      return `• ${nameDisplay}: ${pkg.price} د.أ${detailsStr}`;
    });

    return lines.join('\n');
  } catch (_) {
    return '• Basic: 90 د.أ — 10 أطفال + ساعتا لعب\n• VIP: 150 د.أ — Basic + ستاند\n• Premium: 250 د.أ — VIP + هدايا';
  }
};

// ─── Keyword map ─────────────────────────────────────────────────────────────

const keywordMap = [
  {
    key: 'pricing',
    keywords: ['سعر', 'اسعار', 'الاسعار', 'الأسعار', 'تكلفه', 'price', 'pricing', 'cost'],
    buildReply: async ({ footer }) => {
      const pricingText = await buildPlayPricingText();
      return ['أكيد 🌟 هاي أسعار اللعب الحالية:', pricingText, footer].filter(Boolean).join('\n');
    }
  },
  {
    key: 'hours',
    keywords: ['ساعات', 'الدوام', 'متى', 'تفتح', 'تسكر', 'تغلق', 'hours', 'open'],
    buildReply: async ({ footer }) => {
      const hoursText = await buildHoursText();
      return [`⏰ ساعات العمل:\n${hoursText}`, footer].filter(Boolean).join('\n');
    }
  },
  {
    key: 'location',
    keywords: ['موقع', 'العنوان', 'وين', 'location', 'address', 'اربد', 'إربد'],
    buildReply: async ({ footer }) => {
      const locationText = await buildLocationText();
      return [`📍 موقعنا:\n${locationText}`, footer].filter(Boolean).join('\n');
    }
  },
  {
    key: 'birthday',
    keywords: ['عيد', 'ميلاد', 'حفل', 'حفله', 'حفلة', 'birthday', 'party'],
    buildReply: async ({ footer }) => {
      const birthdayText = await buildBirthdayText();
      return [`🎂 باقات أعياد الميلاد:\n${birthdayText}`, footer].filter(Boolean).join('\n');
    }
  },
  {
    key: 'daycare',
    keywords: ['داي كير', 'دايكير', 'daycare', 'حضانه', 'حضانة', 'رعايه', 'رعاية'],
    buildReply: async ({ footer }) => {
      const daycareText = await buildDaycareText();
      return [`👶 باقات الداي كير:\n${daycareText}\n\nللتفاصيل اتصلي: 0777775652 📞`, footer].filter(Boolean).join('\n');
    }
  },
  {
    key: 'booking',
    keywords: ['حجز', 'احجز', 'book', 'booking'],
    reply:
      'للحجز السريع 💛 تقدري تحجزي مباشرة من الموقع: https://peekaboojor.com/book أو اتركي رقمك ونتواصل معك.'
  },
  {
    key: 'subscription',
    keywords: ['اشتراك', 'باقه', 'باقة', 'subscription', 'plan', 'plans'],
    buildReply: async ({ footer }) => {
      const daycareText = await buildDaycareText();
      return [`📋 باقات الاشتراك:\n${daycareText}`, footer].filter(Boolean).join('\n');
    }
  }
];

const loadAutoReplyConfig = async () => {
  const setting = await Settings.findOne({ key: 'whatsapp_auto_reply_config' }).lean();
  const legacyEnabledSetting = await Settings.findOne({ key: 'whatsapp_auto_reply_enabled' }).lean();
  const value = setting?.value && typeof setting.value === 'object' ? setting.value : {};
  const legacyEnabled =
    typeof legacyEnabledSetting?.value === 'boolean' ? legacyEnabledSetting.value : undefined;
  const enabledFromConfig = typeof value?.enabled === 'boolean' ? value.enabled : undefined;
  const enabled = typeof enabledFromConfig === 'boolean' ? enabledFromConfig : Boolean(legacyEnabled);

  return {
    ...DEFAULT_CONFIG,
    ...value,
    enabled,
    cooldownMinutes: Math.max(1, Number(value?.cooldownMinutes || DEFAULT_CONFIG.cooldownMinutes))
  };
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

const hasRecentStaffReply = async (senderWaId) => {
  const cutoff = new Date(Date.now() - STAFF_REPLY_BLOCK_MINUTES * 60 * 1000);

  const recent = await WhatsAppMessage.findOne({
    sender_wa_id: senderWaId,
    direction: 'outbound',
    platform: 'whatsapp',
    $or: [
      { 'raw_payload.auto_reply': { $exists: false } },
      { 'raw_payload.auto_reply': false }
    ],
    timestamp: { $gte: cutoff }
  })
    .sort({ timestamp: -1 })
    .lean();

  return Boolean(recent);
};

const logAutoReply = (event, payload = {}) => {
  console.log(event, payload);
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
    logAutoReply('AUTO_REPLY_TRIGGERED', {
      messageId,
      senderWaId,
      messageType,
      hasTextBody: Boolean(textBody)
    });

    if (!senderWaId || !messageId) {
      logAutoReply('AUTO_REPLY_SKIPPED', { messageId, reason: 'missing_payload' });
      return { skipped: true, reason: 'missing_payload' };
    }

    if (messageType !== 'text') {
      logAutoReply('AUTO_REPLY_SKIPPED', { messageId, reason: 'unsupported_message_type', messageType });
      return { skipped: true, reason: 'unsupported_message_type' };
    }

    const config = await loadAutoReplyConfig();
    logAutoReply('AUTO_REPLY_CONFIG_LOADED', {
      messageId,
      enabled: config.enabled,
      cooldownMinutes: config.cooldownMinutes
    });
    if (!config.enabled) {
      logAutoReply('AUTO_REPLY_SKIPPED', { messageId, reason: 'disabled' });
      return { skipped: true, reason: 'disabled' };
    }

    const normalizedWaId = normalizePhoneForWhatsApp(senderWaId);
    if (!normalizedWaId) {
      logAutoReply('AUTO_REPLY_SKIPPED', { messageId, reason: 'invalid_wa_id', senderWaId });
      return { skipped: true, reason: 'invalid_wa_id' };
    }

    const alreadyHandled = await WhatsAppMessage.findOne({
      message_id: `auto_trigger_${messageId}`
    }).lean();
    if (alreadyHandled) {
      logAutoReply('AUTO_REPLY_SKIPPED', { messageId, reason: 'duplicate_trigger' });
      return { skipped: true, reason: 'duplicate_trigger' };
    }

    if (await hasRecentStaffReply(normalizedWaId)) {
      logAutoReply('AUTO_REPLY_SKIPPED', {
        messageId,
        senderWaId: normalizedWaId,
        reason: 'recent_staff_reply',
        blockMinutes: STAFF_REPLY_BLOCK_MINUTES
      });
      return { skipped: true, reason: 'recent_staff_reply' };
    }

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
      logAutoReply('AUTO_REPLY_SKIPPED', { messageId, senderWaId: normalizedWaId, reason: 'cooldown_active' });
      return { skipped: true, reason: 'cooldown_active' };
    }

    const matched = detectKeyword(textBody);
    let replyText;
    if (matched) {
      if (matched.buildReply) {
        replyText = await matched.buildReply({ footer: config.footer });
      } else {
        replyText = [matched.reply, config.footer].filter(Boolean).join('\n');
      }
    } else {
      replyText = config.fallbackReply;
    }

    const sendResult = await postWhatsAppText({
      to: normalizedWaId,
      messageBody: replyText,
      staffId: null
    });

    if (!sendResult?.ok) {
      logAutoReply('AUTO_REPLY_SEND_FAILED', {
        messageId,
        senderWaId: normalizedWaId,
        reason: sendResult?.reason || sendResult?.error || 'send_failed'
      });
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

    logAutoReply('AUTO_REPLY_SENT', {
      messageId,
      senderWaId: normalizedWaId,
      matchedKey: matched?.key || 'fallback',
      outgoingMessageId: sendResult.messageId
    });
    return { ok: true, matchedKey: matched?.key || 'fallback' };
  } catch (error) {
    console.error('AUTO_REPLY_TRIGGER_ERROR', error.message);
    return { skipped: true, reason: 'exception', error: error.message };
  }
};

module.exports = {
  maybeAutoReply,
  DEFAULT_CONFIG,
  buildPlayPricingText,
  buildHoursText,
  buildLocationText,
  buildDaycareText,
  buildBirthdayText
};
