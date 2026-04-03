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

const keywordMap = [
  {
    key: 'pricing',
    keywords: ['سعر', 'اسعار', 'الاسعار', 'الأسعار', 'تكلفه', 'price', 'pricing', 'cost'],
    buildReply: ({ pricingText, footer }) =>
      ['أكيد 🌟 هاي أسعار اللعب الحالية:', pricingText, footer].filter(Boolean).join('\n')
  },
  {
    key: 'hours',
    keywords: ['ساعات', 'الدوام', 'تفتح', 'تسكر', 'تغلق', 'hours', 'open'],
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
    key: 'birthday',
    keywords: [
      'عيد', 'ميلاد', 'حفله', 'حفلة', 'احتفال', 'birthday', 'party', 'celebration'
    ],
    reply:
      '🎂 باقات أعياد الميلاد:\n\n🟡 Basic – 90 د.أ\n• 10 أطفال + ساعة لعب\n\n🟠 VIP – 150 د.أ\n• Basic + ستاند مطبوع\n\n🔴 Premium – 250 د.أ\n• VIP + هدايا + هدية مميزة للمحتفي\n\nللحجز: https://peekaboojor.com/book\n📞 0777775652'
  },
  {
    key: 'booking',
    keywords: ['حجز', 'احجز', 'book', 'booking'],
    reply:
      'للحجز السريع 💛 تقدري تحجزي مباشرة من الموقع: https://peekaboojor.com/book أو اتركي رقمك ونتواصل معك.'
  },
  {
    key: 'daycare',
    keywords: [
      'داي', 'كير', 'daycare', 'حضانه', 'حضانة', 'روضه', 'روضة', 'اشراف', 'إشراف',
      'supervision', 'specialist'
    ],
    reply:
      '👶 خدمة الداي كير (1-4 سنوات):\n\n🔴 نصف يوم (149 د.أ) – 6 ساعات\n🔵 يوم كامل (199 د.أ) – 12 ساعة\n🟢 شامل (250 د.أ) – 12 ساعة + ألعاب + رمل\n\n❌ لا يُسمح بوجود الأهالي داخل الداي كير\n✅ إشراف كامل من مختصات\n\n📞 0777775652'
  },
  {
    key: 'age',
    keywords: [
      'عمر', 'سنوات', 'مناسب', 'كم', 'متى', 'شو', 'كيم', 'اعمار', 'أعمار',
      'شو العمر', 'كم العمر', 'الاعمار', 'age', 'years', 'old'
    ],
    reply:
      '💛 الأعمار المسموح فيها للعب من 1 إلى 10 سنوات:\n\n👶 من 1 إلى أقل من 3 سنوات:\nلازم يكون مع الطفل مرافق واحد (3 دنانير)\n\n🧒 من 3 سنوات إلى 10 سنوات:\nالأطفال بيلعبوا بكل الألعاب بدون مرافق\n\n👶 Daycare (1-4 سنوات):\nمنطقة مخصصة مع إشراف كامل من مختصات\n❌ لا يُسمح بوجود الأهالي داخل الداي كير\n\n📞 0777775652'
  },
  {
    key: 'parent_experience',
    keywords: [
      'اهل', 'أهل', 'والدين', 'مرافق', 'جلوس', 'كافيه', 'cafe', 'coffee',
      'monitoring', 'screens', 'شاشات', 'مراقبه', 'مراقبة'
    ],
    reply:
      '☕ تجربة مريحة للأهالي:\n\n• مكان جلوس مخصص للأهالي\n• كافيه مع مشروبات و وجبات خفيفة\n• شاشات مراقبة لمتابعة الأطفال\n• بيئة آمنة و مريحة\n\nيمكنكم الاستمتاع بوقتكم والاطمئنان على أطفالكم في نفس الوقت ✨\n\n📞 0777775652'
  },
  {
    key: 'sand_area',
    keywords: [
      'رمل', 'sand', 'منطقة الرمل', 'sandy', 'رملي'
    ],
    reply:
      '🏖️ منطقة الرمل:\n\nمتاحة للأطفال من عمر 1 إلى 10 سنوات\n\n📦 الخيارات:\n• مشمولة في باقات الداي كير الأساسية\n• إضافة الرمل على أي باقة: +20 دينار\n• غير مشمول في باقات الزيارات المرنة (إلا بـ +20 د)\n\nتجربة حسية تفاعلية ممتعة للأطفال ✨\n\n📞 0777775652'
  },
  {
    key: 'transportation',
    keywords: [
      'توصيل', 'نقل', 'transport', 'delivery', 'وسيله', 'وسيلة', 'driver', 'سواق'
    ],
    reply:
      '🚗 خدمة التوصيل:\n\nمتاحة بسعر: 40 دينار للاتجاه الواحد\n\n📅 العمل:\nيوميًا ما عدا الجمعة والسبت\n\nللحجز و الاستفسار:\n📞 0777775652'
  },
  {
    key: 'after_school',
    keywords: [
      'بعد', 'مدرسه', 'مدرسة', 'school', 'pickup', 'after'
    ],
    reply:
      '🎒 خدمة بعد المدرسة:\n\nنوفر خدمة انتظار بعد المدرسة للأطفال\n\n• الاستقبال الآمن من المدرسة\n• اللعب و تطوير مهارات\n• إشراف من مختصات\n\nللتفاصيل والحجز:\n📞 0777775652'
  },
  {
    key: 'facilities',
    keywords: [
      'مكان', 'منطقه', 'منطقة', 'facility', 'area', 'spaces', 'zones',
      'مرافق', 'العاب', 'ألعاب', 'activities', 'انشطه', 'أنشطة'
    ],
    reply:
      '🏢 مرافق Peekaboo:\n\n🎠 منطقة الألعاب الرئيسية\nللأطفال 1-10 سنوات\n\n👶 منطقة Daycare\nللأطفال 1-4 سنوات (مع إشراف متخصص)\n\n🏖️ منطقة الرمل\nللأطفال 1-10 سنوات (تجربة حسية)\n\n☕ منطقة الأهالي\nجلوس مريح + كافيه + شاشات مراقبة\n\n🔒 بيئة آمنة 100%\n\n📞 0777775652'
  },
  {
    key: 'safety',
    keywords: [
      'امن', 'آمن', 'سلامه', 'سلامة', 'safety', 'secure', 'protected', 'حمايه', 'حماية'
    ],
    reply:
      '🔒 السلامة أولويتنا في Peekaboo:\n\n• بيئة آمنة ومراقبة بالكامل\n• شاشات مراقبة لمتابعة الأطفال\n• إشراف من مختصات متدربات\n• تصميم الملعب مناسب لكل الأعمار\n\n📞 0777775652'
  },
  {
    key: 'subscription',
    keywords: ['اشتراك', 'باقه', 'باقة', 'subscription', 'plan', 'plans', 'زيارات'],
    reply:
      'لدينا باقات اشتراك متعددة حسب عدد الزيارات والفترة. ارسلي كلمة (اشتراك) وسيقوم الفريق بتزويدك بأفضل خيار 👌'
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
  DEFAULT_CONFIG
};
