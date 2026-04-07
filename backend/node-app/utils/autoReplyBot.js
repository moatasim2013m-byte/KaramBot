const Settings = require('../models/Settings');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Theme = require('../models/Theme');
const {
  normalizePhoneForWhatsApp,
  postWhatsAppText
} = require('./whatsappBookingConfirmation');
const { getScopedAiFallbackReply } = require('./autoReplyAi');

const DEFAULT_CONFIG = {
  enabled: false,
  cooldownMinutes: 30,
  footer: 'للحجز المباشر تفضلي عبر الموقع: https://peekaboojor.com/tickets',
  fallbackReply:
    'أهلاً وسهلاً 🌷 وصلتنا رسالتك، وفريقنا سيرد عليك بأسرع وقت. إذا حابة، ارسلي (أسعار / موقع / ساعات العمل / عيد ميلاد / اشتراك).',
  useAiFallback: false,
  aiConfidenceThreshold: 0.7,
  aiMaxReplyChars: 500
};

const PRICING_KEYS = ['hourly_1hr', 'hourly_2hr', 'hourly_3hr', 'hourly_extra_hr', 'extra_companion', 'sand_area_addon', 'transport_one_way'];
const STAFF_REPLY_BLOCK_MINUTES = 10;
const BURST_WINDOW_SECONDS = 25;
const MAX_TEXT_LENGTH_FOR_AUTO_REPLY = 450;
const MAX_TOKENS_FOR_AUTO_REPLY = 90;
const SAFE_HANDOFF_REPLY = 'شكراً لرسالتك 🌷 للتأكيد وخدمتك بدقة، حولنا رسالتك مباشرة لفريق بيكابو، وبيردوا عليك قريبًا.';
const COMPLAINT_HANDOFF_REPLY = 'آسفين إذا صار أي إزعاج 💛 حتى نحل الموضوع بسرعة، حولنا رسالتك مباشرة لفريق الخدمة، وبيردوا عليك قريبًا.';
const LOCAL_SCOPE_MAX_CHARS = 450;
const LOCAL_SCOPE_MIN_WORDS = 2;
const MIN_AI_CONFIDENCE_FLOOR = 0.55;
const AI_ALLOWED_KEYWORDS = [
  'بيكابو',
  'peekaboo',
  'لعب',
  'جلسات',
  'حجز',
  'عيد ميلاد',
  'داي كير',
  'حضانة',
  'اشتراك',
  'زيارة',
  'عمر',
  'مرافق',
  'أهالي',
  'كافيه',
  'مراقبة',
  'موقع',
  'عنوان',
  'ساعات',
  'دوام',
  'رمل',
  'توصيل',
  'نقل'
];

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

const tokenize = (value) => normalizeText(value).split(' ').filter(Boolean);

const passesLocalScopePrecheck = (textBody) => {
  const normalized = normalizeText(textBody);
  if (!normalized) return false;
  if (normalized.length > LOCAL_SCOPE_MAX_CHARS) return false;

  const words = tokenize(normalized);
  if (words.length < LOCAL_SCOPE_MIN_WORDS) return false;

  return AI_ALLOWED_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)));
};

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
  } catch (err) {
    console.error('buildHoursText error:', err.message);
  }
  return 'الأحد-الخميس: 10ص-11م، الجمعة-السبت: 10ص-12ص';
};

const buildLocationText = async () => {
  try {
    const doc = await Settings.findOne({ key: 'whatsapp_location' }).lean();
    if (doc && doc.value) return String(doc.value);
  } catch (err) {
    console.error('buildLocationText error:', err.message);
  }
  return 'إربد - شارع أبو راشد، مجمع السيف التجاري، الطابق الثاني';
};

const buildDaycareText = async () => {
  try {
    const plans = await SubscriptionPlan.find({ is_active: true }).sort({ price: 1 }).lean();
    if (!plans.length) throw new Error('No active daycare plans found');

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
  } catch (err) {
    console.error('buildDaycareText error:', err.message);
    return '• نصف يوم: 149 د.أ (6 ساعات)\n• يوم كامل: 199 د.أ (12 ساعة)';
  }
};

const buildBirthdayText = async () => {
  try {
    const packages = await Theme.find({ package_type: 'birthday', is_active: true }).sort({ price: 1 }).lean();
    if (!packages.length) throw new Error('No active birthday packages found');

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
  } catch (err) {
    console.error('buildBirthdayText error:', err.message);
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
    keywords: ['ساعات', 'الدوام', 'تفتح', 'تسكر', 'تغلق', 'hours', 'open'],
    reply:
      'ساعات العمل حاليًا: يوميًا 10:00 صباحًا - 11:00 مساءً، والخميس والجمعة حتى 12:00 منتصف الليل. 📍'
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
      'للحجز السريع 💛 تقدري تحجزي مباشرة من الموقع: https://peekaboojor.com/tickets أو اتركي رقمك ونتواصل معك.'
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
    cooldownMinutes: Math.max(1, Number(value?.cooldownMinutes || DEFAULT_CONFIG.cooldownMinutes)),
    useAiFallback: Boolean(value?.useAiFallback),
    aiConfidenceThreshold: Math.min(
      1,
      Math.max(0, Number(value?.aiConfidenceThreshold ?? DEFAULT_CONFIG.aiConfidenceThreshold))
    ),
    aiMaxReplyChars: Math.max(50, Number(value?.aiMaxReplyChars || DEFAULT_CONFIG.aiMaxReplyChars))
  };
};

const detectKeyword = (textBody) => {
  const normalized = normalizeText(textBody);
  if (!normalized) return null;

  return keywordMap.find((entry) =>
    entry.keywords.some((keyword) => normalized.includes(normalizeText(keyword)))
  ) || null;
};

const COMPLAINT_OR_SENSITIVE_KEYWORDS = [
  'شكوى', 'مشتكي', 'زعلان', 'زعلانه', 'معصب', 'معصبه', 'سيئ', 'سيء', 'مشكله', 'مشكلة',
  'غلط', 'احتيال', 'نصب', 'استرجاع', 'refund', 'cancel', 'cancellation',
  'حادث', 'اصابه', 'إصابة', 'نزيف', 'تحرش', 'عنف', 'تهديد', 'ابتزاز'
];

const OUT_OF_SCOPE_KEYWORDS = [
  'طقس', 'weather', 'رياضه', 'كرة', 'مباراه', 'مباراة', 'سياسه', 'سياسة',
  'اخبار', 'أخبار', 'برمجه', 'برمجة', 'كود', 'bitcoin', 'crypto', 'وظيفه', 'وظيفة'
];

const DOMAIN_GUARD_KEYWORDS = Array.from(
  new Set(
    keywordMap
      .flatMap((entry) => entry.keywords || [])
      .concat(['بيكابو', 'peekaboo', 'الاطفال', 'الأطفال', 'اطفال', 'play', 'ticket', 'tickets', 'book'])
      .map((token) => normalizeText(token))
      .filter(Boolean)
  )
);

const includesAnyKeyword = (textBody, keywords) => {
  const normalized = normalizeText(textBody);
  return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
};

const isVeryLongMessage = (textBody) => {
  const normalized = normalizeText(textBody);
  const tokenCount = normalized ? normalized.split(' ').filter(Boolean).length : 0;
  return String(textBody || '').length > MAX_TEXT_LENGTH_FOR_AUTO_REPLY || tokenCount > MAX_TOKENS_FOR_AUTO_REPLY;
};

const hasLowDomainConfidence = (textBody) => {
  const normalized = normalizeText(textBody);
  if (!normalized) return true;

  const tokens = normalized.split(' ').filter(Boolean);
  const domainHits = tokens.filter((token) =>
    DOMAIN_GUARD_KEYWORDS.some((keyword) => token.includes(keyword) || keyword.includes(token))
  ).length;

  return domainHits <= 1;
};

const shouldEscalateFallback = (textBody) => {
  if (includesAnyKeyword(textBody, COMPLAINT_OR_SENSITIVE_KEYWORDS)) {
    return { escalate: true, reason: 'complaint_sensitive', reply: COMPLAINT_HANDOFF_REPLY };
  }

  if (isVeryLongMessage(textBody)) {
    return { escalate: true, reason: 'long_or_ambiguous', reply: SAFE_HANDOFF_REPLY };
  }

  if (includesAnyKeyword(textBody, OUT_OF_SCOPE_KEYWORDS)) {
    return { escalate: true, reason: 'out_of_scope', reply: SAFE_HANDOFF_REPLY };
  }

  if (hasLowDomainConfidence(textBody)) {
    return { escalate: true, reason: 'low_confidence', reply: SAFE_HANDOFF_REPLY };
  }

  return { escalate: false };
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const persistAutoTriggerMarker = async ({ messageId, senderWaId, skipped, matchedKey, triggerMessageId }) => {
  if (!messageId || !senderWaId) return;
  await WhatsAppMessage.create({
    message_id: `auto_trigger_${messageId}`,
    sender_wa_id: senderWaId,
    message_type: 'unsupported',
    text_body: '',
    direction: 'outbound',
    platform: 'whatsapp',
    status: 'sent',
    timestamp: new Date(),
    raw_payload: {
      auto_reply: true,
      skipped,
      trigger_message_id: triggerMessageId || messageId,
      matched_key: matchedKey
    },
    is_read_by_staff: true,
    is_replied: false
  }).catch(() => {});
};

const resolveBurstText = async ({ senderWaId, messageId }) => {
  const burstWindowMs = BURST_WINDOW_SECONDS * 1000;
  const triggerMessage = await WhatsAppMessage.findOne({
    message_id: messageId,
    sender_wa_id: senderWaId,
    direction: 'inbound',
    platform: 'whatsapp',
    message_type: 'text'
  }).lean();

  if (!triggerMessage?.timestamp) {
    return { skip: true, reason: 'missing_trigger_message', burstText: '' };
  }

  const triggerTime = new Date(triggerMessage.timestamp);
  const burstEndTime = new Date(triggerTime.getTime() + burstWindowMs);
  const burstStartTime = new Date(triggerTime.getTime() - burstWindowMs);
  const waitMs = Math.max(0, burstEndTime.getTime() - Date.now());
  if (waitMs > 0) await sleep(waitMs);

  const latestInBurst = await WhatsAppMessage.findOne({
    sender_wa_id: senderWaId,
    direction: 'inbound',
    platform: 'whatsapp',
    message_type: 'text',
    timestamp: { $gte: triggerTime, $lte: burstEndTime }
  })
    .sort({ timestamp: -1, _id: -1 })
    .lean();

  if (!latestInBurst || latestInBurst.message_id !== messageId) {
    return {
      skip: true,
      reason: 'burst_superseded',
      burstText: '',
      latestMessageId: latestInBurst?.message_id || null
    };
  }

  const burstMessages = await WhatsAppMessage.find({
    sender_wa_id: senderWaId,
    direction: 'inbound',
    platform: 'whatsapp',
    message_type: 'text',
    timestamp: { $gte: burstStartTime, $lte: triggerTime }
  })
    .sort({ timestamp: 1, _id: 1 })
    .lean();

  const burstText = burstMessages
    .map((item) => String(item?.text_body || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();

  return { skip: false, reason: null, burstText };
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

    const burstResolution = await resolveBurstText({
      senderWaId: normalizedWaId,
      messageId
    });
    if (burstResolution.skip) {
      await persistAutoTriggerMarker({
        messageId,
        senderWaId: normalizedWaId,
        skipped: burstResolution.reason,
        triggerMessageId: messageId
      });
      logAutoReply('AUTO_REPLY_SKIPPED', {
        messageId,
        senderWaId: normalizedWaId,
        reason: burstResolution.reason,
        latestMessageId: burstResolution.latestMessageId || null
      });
      return { skipped: true, reason: burstResolution.reason };
    }

    const effectiveTextBody = burstResolution.burstText || textBody;

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
      await persistAutoTriggerMarker({
        messageId,
        senderWaId: normalizedWaId,
        skipped: 'cooldown',
        triggerMessageId: messageId
      });
      logAutoReply('AUTO_REPLY_SKIPPED', { messageId, senderWaId: normalizedWaId, reason: 'cooldown_active' });
      return { skipped: true, reason: 'cooldown_active' };
    }

    const matched = detectKeyword(effectiveTextBody);
    let replyText;
    let matchedKey;
    if (matched) {
      if (matched.buildReply) {
        replyText = await matched.buildReply({ footer: config.footer });
      } else {
        replyText = [matched.reply, config.footer].filter(Boolean).join('\n');
      }
      matchedKey = matched.key;
    } else {
      const escalationDecision = shouldEscalateFallback(effectiveTextBody);
      if (escalationDecision.escalate) {
        replyText = escalationDecision.reply;
        matchedKey = 'escalation_handoff';
        logAutoReply('AUTO_REPLY_ESCALATED', {
          messageId,
          senderWaId: normalizedWaId,
          reason: escalationDecision.reason
        });
      } else {
        try {
          const passesScopePrecheck = passesLocalScopePrecheck(effectiveTextBody);
          if (passesScopePrecheck && config.useAiFallback) {
            const aiResult = await getScopedAiFallbackReply({
              userText: effectiveTextBody,
              maxChars: config.aiMaxReplyChars
            });
            const requiredConfidence = Math.max(
              MIN_AI_CONFIDENCE_FLOOR,
              Number(config.aiConfidenceThreshold || 0)
            );
            const boundedAiReply = String(aiResult?.reply_ar || '').trim().slice(
              0,
              Math.max(50, Number(config.aiMaxReplyChars || DEFAULT_CONFIG.aiMaxReplyChars))
            );

            const aiReplyAllowed = Boolean(
              aiResult &&
                aiResult.in_scope === true &&
                aiResult.confidence >= requiredConfidence &&
                boundedAiReply &&
                boundedAiReply.length >= 2
            );

            if (aiReplyAllowed) {
              replyText = boundedAiReply;
              matchedKey = 'ai_fallback';
              logAutoReply('AUTO_REPLY_AI_USED', {
                messageId,
                senderWaId: normalizedWaId,
                topic: aiResult.topic || 'unknown',
                confidence: aiResult.confidence
              });
            } else {
              replyText = config.fallbackReply;
              matchedKey = 'fallback';
              logAutoReply('AUTO_REPLY_AI_SKIPPED', {
                messageId,
                senderWaId: normalizedWaId,
                reason: aiResult?.in_scope === false ? 'out_of_scope_or_uncertain' : 'invalid_or_low_confidence',
                confidence: aiResult?.confidence ?? null
              });
            }
          } else {
            replyText = config.fallbackReply;
            matchedKey = 'fallback';
            if (!passesScopePrecheck && config.useAiFallback) {
              logAutoReply('AUTO_REPLY_AI_SKIPPED', {
                messageId,
                senderWaId: normalizedWaId,
                reason: 'local_scope_precheck_failed'
              });
            }
          }
        } catch (error) {
          console.error('AUTO_REPLY_FALLBACK_DECISION_ERROR', error.message);
          // AI/decision failure fallback: keep existing safe generic fallback reply.
          replyText = config.fallbackReply;
          matchedKey = 'fallback';
        }
      }
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
      matchedKey: matchedKey || 'fallback'
    });

    await persistAutoTriggerMarker({
      messageId,
      senderWaId: normalizedWaId,
      skipped: null,
      matchedKey: matchedKey || 'fallback',
      triggerMessageId: messageId
    });

    logAutoReply('AUTO_REPLY_SENT', {
      messageId,
      senderWaId: normalizedWaId,
      matchedKey: matchedKey || 'fallback',
      outgoingMessageId: sendResult.messageId
    });
    return { ok: true, matchedKey: matchedKey || 'fallback' };
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
