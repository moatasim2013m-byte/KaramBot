const Settings = require('../models/Settings');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Theme = require('../models/Theme');
const {
  normalizePhoneForWhatsApp,
  postWhatsAppText
} = require('./whatsappBookingConfirmation');
const { getScopedAiFallbackReply, hasBookingIntent, runBookingGeminiCall } = require('./autoReplyAi');
const { isWhatsAppOptedOut, setWhatsAppOptOut } = require('./whatsappOptOut');

// Send typing indicator + mark as read (non-blocking)
const sendTypingIndicator = async (messageId) => {
  try {
    const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
    const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
    if (!accessToken || !phoneNumberId || !messageId) return;
    await fetch(`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' }
      })
    });
  } catch (err) {
    console.warn('TYPING_INDICATOR_ERROR', err?.message || err);
  }
};

// Booking conversation state cache (in-memory, TTL 10 minutes)
const bookingStateCache = new Map();
const BOOKING_STATE_TTL_MS = 10 * 60 * 1000;

const getBookingState = (senderWaId) => {
  const entry = bookingStateCache.get(senderWaId);
  if (!entry) return {};
  if (Date.now() > entry.expiresAt) {
    bookingStateCache.delete(senderWaId);
    return {};
  }
  return entry.state;
};

const setBookingState = (senderWaId, state) => {
  if (state.step === 'completed') {
    bookingStateCache.delete(senderWaId);
    return;
  }
  bookingStateCache.set(senderWaId, {
    state,
    expiresAt: Date.now() + BOOKING_STATE_TTL_MS
  });
};

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

const normalizeBoolean = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
};

const PRICING_KEYS = ['hourly_1hr', 'hourly_2hr', 'hourly_3hr', 'hourly_extra_hr', 'extra_companion', 'transport_one_way'];
const STAFF_REPLY_BLOCK_MINUTES = 10;
const BURST_WINDOW_SECONDS = 5;
const FORCE_IN_SCOPE_KEYWORDS = [
  'اسعار', 'الاسعار', 'سعر', 'كم', 'اديش', 'قديش', 'بكم',
  'حجز', 'احجز', 'بدي احجز',
  'عيد ميلاد', 'حفله', 'حفلة', 'حفلات', 'birthday',
  'موقع', 'العنوان', 'وين موقعكم', 'لوكيشن',
  'ساعات', 'الدوام', 'فاتحين', 'مسكرين', 'مفتوح',
  'داي كير', 'حضانه', 'حضانة',
  'اشتراك', 'باقه', 'باقة', 'باقات',
  'رمل', 'توصيل', 'نقل',
  'اعمار', 'عمر', 'مرافق',
  'جوارب', 'انشطه', 'فعاليات', 'العاب',
  'خصم', 'تخفيض', 'عرض', 'عروض',
  'دفع', 'الدفع', 'كاش', 'فيزا', 'ماستر', 'كليك', 'بطاقة', 'بطاقه', 'تحويل'
];
const DUPLICATE_INTENT_SUPPRESSION_MINUTES = 15;
const DUPLICATE_INTENT_SUPPRESSION_KEYS = new Set([
  'intro',
  'pricing',
  'daycare',
  'hours',
  'subscription'
]);
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
const DETERMINISTIC_INTENT_PATTERNS = {
  pricing: [
    'قديش الساعة', 'قديش الساعه', 'كم الساعة', 'كم الساعه',
    'بكام الساعة', 'بكام الساعه', 'سعر الساعة', 'سعر الساعه',
    'رسوم اللعب', 'سعر الدخول', 'اسعار اللعب', 'أسعار اللعب'
  ],
  hours: [
    'اليوم فاتحين', 'متى دوامكم', 'ساعات العمل', 'اوقات الدوام',
    'الدوام', 'متى تفتحوا', 'متى تفتحون', 'شو مواعيدكم', 'شو دوامكم',
    'مداومين', 'دوامكم', 'فاتحين بكره', 'فاتحين بكرا', 'فاتحين اليوم',
    'مفتوح بكره', 'مفتوح بكرا', 'مفتوحين بكره', 'مفتوحين بكرا',
    'بكره مداومين', 'بكرا مداومين', 'اليوم مداومين',
    'مفتوحين اليوم', 'بكره فاتحين', 'بكرا فاتحين',
    'فاتحين', 'مسكرين', 'مفتوح', 'مسكر', 'شغالين'
  ],
  location: [
    'وين موقعكم', 'وين مكانكم', 'موقعكم', 'العنوان',
    'وين انتو', 'وينكم', 'لوكيشن', 'location', 'address'
  ]
};

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

const normalizeArabicDigits = (value) =>
  String(value || '').replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632));

const tokenize = (value) => normalizeText(value).split(' ').filter(Boolean);
const MAX_SUPPORTED_CHILD_COUNT = 200;
const BIRTHDAY_PACKAGE_INCLUDED_CHILDREN = 10;
const BIRTHDAY_EXTRA_CHILD_PRICE = 7;
const BIRTHDAY_BASIC_BASE_PRICE = 90;
const BIRTHDAY_PREMIUM_BASE_PRICE = 150;
const BIRTHDAY_VIP_BASE_PRICE = 250;

const extractChildCount = (textBody) => {
  const withNormalizedDigits = normalizeArabicDigits(textBody);
  const numericMatch = withNormalizedDigits.match(/(\d{1,3})/);
  if (!numericMatch) return null;

  const count = Number(numericMatch[1]);
  if (!Number.isInteger(count) || count <= 0 || count > MAX_SUPPORTED_CHILD_COUNT) return null;
  return count;
};

const isBirthdayChildCountFollowUp = (lastBotReplyText, userText) => {
  const lastNormalized = normalizeText(lastBotReplyText);
  const userNormalized = normalizeText(userText);
  if (!lastNormalized || !userNormalized) return false;
  return (
    lastNormalized.includes('كم') &&
    (lastNormalized.includes('طفل') || lastNormalized.includes('اطفال')) &&
    (lastNormalized.includes('عيد') || lastNormalized.includes('حفله') || lastNormalized.includes('حفلات'))
  );
};

const buildBirthdayChildCountReply = (childCount) => {
  const extraKids = Math.max(0, childCount - BIRTHDAY_PACKAGE_INCLUDED_CHILDREN);
  const extraCost = extraKids * BIRTHDAY_EXTRA_CHILD_PRICE;
  const basicTotal = BIRTHDAY_BASIC_BASE_PRICE + extraCost;
  const premiumTotal = BIRTHDAY_PREMIUM_BASE_PRICE + extraCost;
  const vipTotal = BIRTHDAY_VIP_BASE_PRICE + extraCost;

  return [
    `ممتاز 💛 بما أن العدد ${childCount} طفل${extraKids > 0 ? ` (فيهم ${extraKids} أطفال إضافيين × ${BIRTHDAY_EXTRA_CHILD_PRICE} د)` : ''}، هاي تكلفة الباقات:`,
    `🎂 Basic: ${basicTotal} د`,
    `🎂 Premium: ${premiumTotal} د`,
    `🎂 VIP: ${vipTotal} د`,
    'إذا حابة نكمل الحجز، ابعتي اليوم والتوقيت المناسبين 🎉'
  ].join('\n');
};

const WHATSAPP_OPT_OUT_PHRASES = new Set([
  'stop', 'unsubscribe', 'opt out', 'optout',
  'وقف', 'أوقف', 'اوقف',
  'ايقاف', 'إيقاف',
  'وقف الرسائل', 'اوقف الرسائل', 'أوقف الرسائل',
  'إلغاء الرسائل', 'الغاء الرسائل',
  'ما بدي رسائل', 'لا تراسلني', 'لا تراسلوني',
  'بطل ترسل', 'بطلوا ترسلوا'
].map((phrase) => normalizeText(phrase)));

const WHATSAPP_OPT_IN_PHRASES = new Set([
  'تشغيل الرسائل',
  'اعادة الرسائل',
  'إعادة الرسائل',
  'تفعيل',
  'start',
  'subscribe'
].map((phrase) => normalizeText(phrase)));

const WHATSAPP_OPT_OUT_CONFIRMATION_REPLY = 'تم إيقاف رسائل واتساب التلقائية ✅\nإذا حبيتي ترجعي التفعيل، ارسلي: تفعيل أو start.';
const WHATSAPP_OPT_IN_CONFIRMATION_REPLY = 'تم تفعيل رسائل واتساب التلقائية من جديد ✅\nجاهزين نساعدك بأي استفسار 💛';

const detectOptCommand = (textBody) => {
  const normalized = normalizeText(textBody);
  if (!normalized) return null;
  if (WHATSAPP_OPT_OUT_PHRASES.has(normalized)) return 'opt_out';
  if (WHATSAPP_OPT_IN_PHRASES.has(normalized)) return 'opt_in';
  return null;
};

const TOKEN_BOUNDARY_KEYWORDS = new Set([
  'كم',
  'شو',
  'متى',
  'وين',
  'بعد',
  'مكان',
  'منطقه'
]);

const GREETING_RULES = [
  { opening: 'وعليكم السلام ورحمة الله 💛', patterns: ['السلام عليكم', 'سلام عليكم', 'السلام عليكو', 'السلامُ عليكم'] },
  { opening: 'صباح النور 💛', patterns: ['صباح الخير', 'صباحو', 'صباح الخيرر', 'يسعد صباحك', 'يسعد صباحكم'] },
  { opening: 'مساء النور 💛', patterns: ['مساء الخير', 'مسا الخير', 'يسعد مساك', 'يسعد مساكم'] },
  { opening: 'هلا والله 💛', patterns: ['هلا', 'هلاا', 'هلا والله', 'مرحبتين'] },
  { opening: 'أهلاً وسهلاً 💛', patterns: ['مرحبا', 'مرحباً', 'اهلا', 'أهلا', 'هاي', 'hello', 'hi', 'hey'] }
];

const detectGreetingOpening = (textBody) => {
  const normalized = normalizeText(textBody);
  if (!normalized) return null;

  const matchedRule = GREETING_RULES.find((rule) =>
    rule.patterns.some((pattern) => normalized.includes(normalizeText(pattern)))
  );
  return matchedRule ? matchedRule.opening : null;
};

const isGreetingOnlyMessage = (textBody) => {
  let normalized = normalizeText(textBody);
  if (!normalized) return false;

  GREETING_RULES.forEach((rule) => {
    rule.patterns.forEach((pattern) => {
      const normalizedPattern = normalizeText(pattern);
      normalized = normalized.split(normalizedPattern).join(' ').trim();
    });
  });

  return normalizeText(normalized).length === 0;
};

const removeLeadingDuplicateGreeting = ({ greetingOpening, replyText }) => {
  if (!greetingOpening || !replyText) return String(replyText || '').trim();

  const normalizedOpening = normalizeText(greetingOpening);
  const lines = String(replyText)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return lines.join('\n');

  const firstLineNormalized = normalizeText(lines[0]);
  const secondLineNormalized = normalizeText(lines[1]);

  if (firstLineNormalized === normalizedOpening && secondLineNormalized === normalizedOpening) {
    lines.splice(1, 1);
  } else if (
    firstLineNormalized === normalizedOpening &&
    secondLineNormalized.startsWith(normalizedOpening)
  ) {
    const escapedOpening = greetingOpening.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    lines[1] = lines[1].replace(new RegExp(`^${escapedOpening}\\s*`), '').trim();
  }

  return lines.join('\n');
};

const buildGreetingOnlyIntroReply = ({ opening, footer }) =>
  [
    opening,
    'معك شرومي 🍄 مساعدك في بيكابو! كيف بقدر أخدمك؟ 💛',
    'ارسل/ي: أسعار | داي كير | عيد ميلاد | حجز | أعمار | موقع',
    footer
  ].filter(Boolean).join('\n');

const passesLocalScopePrecheck = (textBody) => {
  const normalized = normalizeText(textBody);
  if (!normalized) return false;
  if (normalized.length > LOCAL_SCOPE_MAX_CHARS) return false;

  const words = tokenize(normalized);
  return words.length >= LOCAL_SCOPE_MIN_WORDS;
};

const detectDeterministicIntent = (textBody) => {
  const normalized = normalizeText(textBody);
  if (!normalized) return null;

  for (const [intentKey, patterns] of Object.entries(DETERMINISTIC_INTENT_PATTERNS)) {
    const isMatched = patterns.some((pattern) => normalized.includes(normalizeText(pattern)));
    if (isMatched) return intentKey;
  }
  return null;
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
    transport_one_way: 40
  };

  docs.forEach((doc) => {
    prices[doc.key] = Number(doc.value || prices[doc.key]);
  });

  const lines = [
    'أكيد 🌟 هاي أسعار اللعب الحالية:',
    '',
    `⭐ الأوفر: ساعتين بـ ${prices.hourly_2hr} دنانير`,
    `• ساعة بـ ${prices.hourly_1hr} دنانير`,
    `• 3 ساعات: ${prices.hourly_3hr} د.أ`,
    `• كل ساعة إضافية: ${prices.hourly_extra_hr} د.أ`,
    `• مرافق إضافي: ${prices.extra_companion} د.أ`,
    '',
    '📍 منطقة اللعب الرئيسية بالطابق الثاني',
    '💡 الأسعار نفسها بكل أيام الأسبوع',
    '📌 ما في عرض إخوة حالياً، تابعوا صفحتنا للعروض',
    '',
    '👶 وعندنا كمان خدمات إضافية بالطابق الثالث:',
    '• الداي كير للأطفال من عمر 1 إلى 4 سنوات',
    '• منطقة الرمل',
    '',
    'وفيه اشتراكات وبالساعة',
    `🚗 وخدمة التوصيل داخل مدينة إربد: ${prices.transport_one_way} دينار للاتجاه الواحد`,
    'للتفاصيل ارسلي: داي كير أو اشتراك'
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
  return 'الأحد-الأربعاء والسبت: 10ص-11م، الخميس-الجمعة: 10ص-12ص';
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
    return '';
  }
};

// ─── Keyword map ─────────────────────────────────────────────────────────────

const keywordMap = [
  {
    key: 'daycare',
    keywords: [
      'حضانة', 'حضانه', 'الحضانة', 'الحضانه',
      'داي كير', 'الداي كير', 'دايكير', 'daycare',
      'رعاية', 'رعايه',
      'اسعار الحضانة', 'اسعار الحضانه', 'أسعار الحضانة', 'أسعار الحضانه',
      'اسعار الداي كير', 'أسعار الداي كير',
      'كم الحضانة', 'كم الحضانه',
      'بكم الحضانة', 'بكم الحضانه',
      'بكم الداي كير',
      'شو اسعار الداي كير', 'شو أسعار الداي كير',
      'عندكم حضانة', 'عندكم حضانه',
      'بدي حضانة', 'بدي حضانه',
      'حضانه يوميه', 'حضانة يومية',
      'رعايه يوميه', 'رعاية يومية',
      'حضانه يوم كامل', 'حضانة يوم كامل',
      'بدي تفاصيل الداي كير',
      'نظام الحضانة', 'نظام الحضانه',
      'تفاصيل الحضانة', 'تفاصيل الحضانه'
    ],
    reply:
      'أكيد 💛\n\nبيكابو أولاً منطقة لعب رئيسية للأطفال 👇\n🎠 المنطقة الرئيسية: من عمر سنة إلى 10 سنوات\n📍 بالطابق الثاني\n\nوعندنا كمان خدمات إضافية:\n👶 الداي كير\n🏖️ منطقة الرمل\n📍 بالطابق الثالث\n\nأسعار الداي كير:\n• نصف يوم: 149 دينار\n• يوم كامل: 199 دينار\n• شامل: 250 دينار\n\nوباقات الزيارات:\n• 8 زيارات: 79 دينار\n• 12 زيارة: 99 دينار\n\nيشمل:\n✅ إشراف من مختصات تربية\n✅ بيئة آمنة ومجهزة للأطفال\n✅ متابعة واهتمام خلال فترة بقاء الطفل\n\n👶 مناسب للأطفال من عمر سنة إلى 4 سنوات\n\nللاستفسار: 0777775652'
  },
  {
    key: 'pricing',
    keywords: [
      'سعر', 'اسعار', 'الاسعار', 'الأسعار', 'تكلفه', 'price', 'pricing', 'cost',
      'قديش الساعه', 'قديش الساعة',
      'كم الساعه', 'كم الساعة',
      'بكام الساعه', 'بكام الساعة',
      'سعر الساعه', 'سعر الساعة',
      'رسوم اللعب', 'سعر الدخول'
    ],
    reply:
      'أكيد 💛\nقبل ما نعطيك السعر، أي خدمة مهتم/ة فيها؟\n• لعب بالساعة\n• عيد ميلاد\n• اشتراك\n• داي كير\n\nاكتب/ي اسم الخدمة وبنبعتلك الأسعار والتفاصيل مباشرة.'
  },
  {
    key: 'price_negotiation',
    keywords: ['غالي', 'غاليه', 'مكلف', 'مو مناسب', 'مش مناسب', 'ابي خصم', 'اريد خصم', 'بدنا خصم', 'هل في خصم', 'في تخفيض'],
    reply:
      'معك حق تسألي 😊\nالأوفر عنا: ساعتين بـ 10 دنانير، وبعدها ساعة بـ 7 دنانير.\nحالياً ما في عرض إخوة خاص، بس تابعوا صفحتنا للعروض.\nوللتفاصيل عن الاشتراكات/تنسيق عيد الميلاد: 0799241993'
  },
  {
    key: 'hours',
    keywords: ['ساعات', 'الدوام', 'تفتح', 'تسكر', 'تغلق', 'hours', 'open'],
    buildReply: async ({ footer }) => {
      const hoursText = await buildHoursText();
      return [`🕒 ساعات العمل الحالية:\n${hoursText}`, 'إذا حابة، ارسلي “موقع” عشان نبعتلك اللوكيشن مباشرة.', footer].filter(Boolean).join('\n');
    }
  },
  {
    key: 'location',
    keywords: [
      'موقع', 'العنوان', 'وين', 'location', 'address', 'اربد', 'إربد',
      'وين موقعكم', 'وين مكانكم',
      'موقعكم باربد', 'مكانكم باربد',
      'شارع ابو راشد', 'شارع أبو راشد',
      'مجمع السيف', 'السيف التجاري'
    ],
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
      return [
        '🎂 لتنسيق أعياد الميلاد والمجموعات المدرسية مباشرة: 0799241993.',
        birthdayText ? `إذا حابة، هاي الباقات النشطة حالياً:\n${birthdayText}` : '',
        footer
      ].filter(Boolean).join('\n');
    }
  },
  {
    key: 'booking',
    keywords: [
      'حجز', 'احجز', 'book', 'booking',
      'بدي احجز', 'بدي احجز لطفلي',
      'بدي حجز', 'كيف احجز', 'كيف احجز عندكم',
      'رابط الحجز', 'حجز اونلاين', 'حجز أونلاين'
    ],
    reply:
      'للحجز السريع 💛 تقدري تحجزي مباشرة من الموقع: https://peekaboojor.com/tickets\nولتنسيق المدارس/أعياد الميلاد: 0799241993\nوللاستفسارات العامة: 0777775652'
  },
  {
    key: 'age',
    keywords: [
      'عمر', 'سنوات', 'مناسب', 'كم', 'متى', 'شو', 'كيم', 'اعمار', 'أعمار',
      'شو العمر', 'كم العمر', 'الاعمار', 'age', 'years', 'old',
      'من اي عمر', 'من أي عمر',
      'لعمر كم', 'اقل عمر', 'أقل عمر', 'اكبر عمر', 'أكبر عمر',
      'عمره سنه', 'عمره سنة', 'عمرها سنه', 'عمرها سنة',
      'عمره سنتين', 'عمرها سنتين', 'طفل عمره', 'طفله عمرها', 'طفلة عمرها'
    ],
    reply:
      '💛 المنطقة الرئيسية (الطابق الثاني): مناسبة لعمر 1-10 سنوات.\n👶 الطفل أقل من 3 سنوات لا يُترك وحده، ويجب وجود ولي أمر أو مرافق داخل المنطقة الرئيسية.\n👶 الداي كير (الطابق الثالث): لعمر 1-4 سنوات، بإشراف مختصات تربية.\n📞 للاستفسار: 0777775652'
  },
  {
    key: 'parent_experience',
    keywords: [
      'اهل', 'أهل', 'والدين', 'مرافق', 'جلوس', 'كافيه', 'cafe', 'coffee',
      'monitoring', 'screens', 'شاشات', 'مراقبه', 'مراقبة'
    ],
    reply:
      '☕ تجربة الأهالي مريحة في بيكابو:\n• مكان جلوس مخصص + كافيه\n• متابعة الأطفال عبر شاشات/مراقبة داخلية\n• وطاقمنا حاضر دائماً للمساعدة\n📞 0777775652'
  },
  {
    key: 'sand_area',
    keywords: [
      'رمل', 'sand', 'منطقة الرمل', 'sandy', 'رملي'
    ],
    reply:
      '🏖️ منطقة الرمل نشاط منفصل داخل بيكابو.\nلحتى نخدمك بسرعة، ابعتي: تاريخ الزيارة + عدد الأطفال + أعمارهم.\nللاستفسار المباشر: 0777775652\nوللمجموعات/المدارس: 0799241993'
  },
  {
    key: 'transportation',
    keywords: [
      'توصيل', 'نقل', 'transport', 'delivery', 'وسيله', 'وسيلة', 'driver', 'سواق'
    ],
    reply:
      '🚗 خدمة التوصيل:\n\nمتاحة بسعر: 40 دينار للاتجاه الواحد\n\n📅 العمل:\nيوميًا\n\nملاحظة: الاشتراكات متاحة من الأحد إلى الخميس.\n\nللحجز والاستفسار:\n📞 0777775652'
  },
  {
    key: 'after_school',
    keywords: [
      'بعد', 'مدرسه', 'مدرسة', 'school', 'pickup', 'after',
      'بعد المدرسه', 'بعد المدرسة',
      'انتظار بعد المدرسه', 'انتظار بعد المدرسة',
      'استقبال من المدرسه', 'استقبال من المدرسة'
    ],
    reply:
      '🎒 خدمة بعد المدرسة:\n\nنوفر خدمة انتظار بعد المدرسة للأطفال\n\n• الاستقبال الآمن من المدرسة\n• اللعب وتطوير المهارات\n• إشراف من مختصات\n\nللتفاصيل والحجز:\n📞 0777775652'
  },
  {
    key: 'facilities',
    keywords: [
      'مكان', 'منطقه', 'منطقة', 'facility', 'area', 'spaces', 'zones',
      'مرافق', 'العاب', 'ألعاب', 'activities', 'انشطه', 'أنشطة',
      'شو الموجود عندكم', 'شو في عندكم',
      'اقسام اللعب', 'أقسام اللعب',
      'الطابق الثاني', 'الطابق الثالث'
    ],
    reply:
      '🏢 مرافق بيكابو:\n🎠 المنطقة الرئيسية (الطابق الثاني): لعمر 1-10 سنوات.\n👶 الداي كير (الطابق الثالث): لعمر 1-4 سنوات بإشراف مختصات تربية.\n☕ للأهالي: جلسات وكافيه ومتابعة عبر الشاشات.\n📞 0777775652'
  },
  {
    key: 'safety',
    keywords: [
      'امن', 'آمن', 'سلامه', 'سلامة', 'safety', 'secure', 'protected', 'حمايه', 'حماية'
    ],
    reply:
      '🔒 السلامة أولويتنا في بيكابو:\n\n• بيئة آمنة ومراقبة بالكامل\n• شاشات مراقبة لمتابعة الأطفال\n• إشراف من مختصات متدربات\n• تصميم الملعب مناسب لكل الأعمار\n\n📞 0777775652'
  },
  {
    key: 'employment',
    keywords: ['وظيفة', 'وظيفه', 'شغل', 'توظيف', 'cv', 'سيرة ذاتية', 'سيره ذاتيه', 'resume', 'job', 'hiring', 'ابي اشتغل', 'اريد اشتغل', 'هل في وظايف'],
    reply:
      'شكراً لاهتمامك بالعمل معنا في بيكابو 🌟\n\nأرسل سيرتك الذاتية مع:\n• المسمى الوظيفي المطلوب\n• تخصصك ومؤهلاتك\n• سنوات الخبرة\n\n📧 hr@peekaboojor.com\n\nسيتواصل معك فريقنا قريباً 💛'
  },
  {
    key: 'offers',
    keywords: ['عرض', 'عروض', 'offer', 'offers', 'في عروض', 'في خصم', 'promotion', 'deal', 'اخر عروض', 'latest offers', 'اخوه', 'إخوة', 'اخوان', 'siblings', 'brothers'],
    reply:
      'حالياً ما في عرض خاص للإخوة/الأشقاء.\n💡 الأوفر: ساعتين بـ 10 دنانير، وبعدها ساعة بـ 7 دنانير.\nتابعوا صفحتنا للعروض الجديدة أول بأول.\n📞 0777775652'
  },
  {
    key: 'payment_methods',
    keywords: [
      'كاش', 'كليك', 'فيزا', 'ماستر', 'بطاقة', 'بطاقه', 'تحويل', 'دفع اونلاين', 'دفع إلكتروني',
      'طريقة الدفع', 'طريقه الدفع', 'كيف الدفع', 'في دفع', 'في فيزا', 'في كليك', 'في ماستر',
      'في بطاقة', 'في بطاقه', 'بطاقة ائتمان', 'pay online', 'payment method'
    ],
    reply:
      'الدفع عندنا: كاش 💛 أو ببطاقة ائتمان (فيزا/ماستر) أو كليك.\nبنشوفكم!'
  },
  {
    key: 'subscription',
    keywords: [
      'اشتراك', 'باقه', 'باقة', 'subscription', 'plan', 'plans', 'زيارات',
      'باقات', 'نظام اشتراك', 'اشتراك شهري', 'اشتراك زيارات'
    ],
    reply:
      'أكيد 💛 عنا اشتراكات للداي كير وباقات زيارات.\n📅 اشتراكات الزيارات من الأحد إلى الخميس.\nلحتى نرشحلك الأنسب مباشرة، ابعتي: عدد الأطفال + الأعمار + إذا بدك (داي كير) أو (زيارات).\nللتنسيق السريع: 0777775652'
  },
  {
    key: 'intro',
    keywords: ['مرحبا', 'هلا', 'السلام عليكم', 'هاي', 'hi', 'hello', 'hey', 'سلام', 'صباح الخير', 'مساء الخير', 'كيفكم', 'كيف حالكم'],
    reply:
      'أهلاً وسهلاً في بيكابو 💛\n🎠 ملعب داخلي في إربد: المنطقة الرئيسية لعمر 1-10 سنوات، والداي كير لعمر 1-4 سنوات.\nكيف نقدر نساعدك؟ ارسلي: أسعار | داي كير | أعمار | حجز | عيد ميلاد | عروض.\n📞 عام: 0777775652 | مدارس/أعياد: 0799241993'
  }
];

const loadAutoReplyConfig = async () => {
  const setting = await Settings.findOne({ key: 'whatsapp_auto_reply_config' }).lean();
  const value = setting?.value && typeof setting.value === 'object' ? setting.value : {};

  // whatsapp_auto_reply_config.enabled is the single source of truth.
  // Legacy whatsapp_auto_reply_enabled key is ignored — admin panel controls the new config.
  const enabled = typeof value?.enabled === 'boolean' ? value.enabled : false;

  return {
    ...DEFAULT_CONFIG,
    ...value,
    enabled,
    cooldownMinutes: Math.max(1, Number(value?.cooldownMinutes || DEFAULT_CONFIG.cooldownMinutes)),
    useAiFallback: normalizeBoolean(value?.useAiFallback, DEFAULT_CONFIG.useAiFallback),
    aiConfidenceThreshold: Math.min(
      1,
      Math.max(0, Number(value?.aiConfidenceThreshold ?? DEFAULT_CONFIG.aiConfidenceThreshold))
    ),
    aiMaxReplyChars: Math.max(50, Number(value?.aiMaxReplyChars || DEFAULT_CONFIG.aiMaxReplyChars))
  };
};

const detectKeywordMatches = (textBody) => {
  const normalized = normalizeText(textBody);
  if (!normalized) return [];
  const textTokens = tokenize(normalized);
  const textTokenSet = new Set(textTokens);
  const matches = [];

  keywordMap.forEach((entry, index) => {
    const matchedKeywords = entry.keywords.filter((keyword) => {
      const normalizedKeyword = normalizeText(keyword);
      if (!normalizedKeyword) return false;

      const keywordTokens = tokenize(normalizedKeyword);
      const isPhraseKeyword = keywordTokens.length > 1;
      if (isPhraseKeyword) return normalized.includes(normalizedKeyword);

      const shouldUseTokenBoundary =
        TOKEN_BOUNDARY_KEYWORDS.has(normalizedKeyword) || normalizedKeyword.length <= 3;

      if (shouldUseTokenBoundary) return textTokenSet.has(normalizedKeyword);

      return normalized.includes(normalizedKeyword);
    });
    if (!matchedKeywords.length) return;

    const strongestKeyword = matchedKeywords.reduce((best, current) =>
      normalizeText(current).length > normalizeText(best).length ? current : best
    );
    const strongestKeywordWords = tokenize(strongestKeyword).length;
    const phraseBoost = strongestKeywordWords > 1 ? 3 : 0;
    const baseScore = normalizeText(strongestKeyword).length + phraseBoost;
    const score = baseScore + Math.min(4, matchedKeywords.length);

    matches.push({ entry, score, index });
  });

  return matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });
};

// Returns the best keyword match that is NOT the greeting/intro entry.
// Used when a burst contains a greeting + a substantive question so the
// question is served rather than repeating the intro menu.
const selectActionKeywordMatch = (textBody) => {
  const matches = detectKeywordMatches(textBody);
  return matches.find((m) => m.entry.key !== 'intro')?.entry || null;
};

const COMPLAINT_OR_SENSITIVE_KEYWORDS = [
  'شكوى', 'مشتكي', 'زعلان', 'زعلانه', 'معصب', 'معصبه', 'سيئ', 'سيء', 'مشكله', 'مشكلة',
  'غلط', 'احتيال', 'نصب', 'استرجاع', 'refund', 'cancel', 'cancellation',
  'حادث', 'اصابه', 'إصابة', 'نزيف', 'تحرش', 'عنف', 'تهديد', 'ابتزاز',
  'دفعت', 'سحب', 'payment', 'charged',
  'خصوصيه', 'خصوصية', 'بيانات', 'privacy', 'data leak', 'تسريب',
  'فشل الحجز', 'الحجز فشل', 'الحجز ما زبط', 'ما زبط الحجز', 'الموقع ما حجز', 'booking failed', 'booking issue'
];

const OUT_OF_SCOPE_KEYWORDS = [
  'طقس', 'weather', 'رياضه', 'كرة', 'مباراه', 'مباراة', 'سياسه', 'سياسة',
  'اخبار', 'أخبار', 'برمجه', 'برمجة', 'كود', 'bitcoin', 'crypto'
];

const SHORT_IN_DOMAIN_HINTS = [
  'داي كير', 'دايكير', 'حضانه', 'حضانة',
  'اشتراك', 'باقه', 'باقة', 'زيارات',
  'الاسعار', 'الأسعار', 'اسعار', 'سعر',
  'وين', 'وينكم', 'موقع', 'العنوان',
  'حجز', 'عيد ميلاد', 'اعمار', 'أعمار', 'عمر',
  'دفع', 'الدفع', 'كاش', 'فيزا', 'ماستر', 'كليك', 'بطاقة', 'بطاقه'
];

const SHORT_QUESTION_WORDS = [
  'وين', 'وينكم', 'كم', 'قديش', 'شو', 'ايش', 'ليش', 'متى', 'هل', 'بقدر', 'ممكن'
];

const CHILD_SUPERVISION_HINTS = [
  'طفل', 'طفلي', 'ابني', 'ابني', 'بنتي', 'بنتي',
  'لحاله', 'لحالو', 'وحده', 'وحده', 'لوحده', 'لوحدو', 'مرافق', 'مرافقه', 'مرافقة',
  'اترك', 'اخليه', 'خليه'
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

const isShortLikelyInDomainQuestion = (textBody) => {
  const normalized = normalizeText(textBody);
  if (!normalized) return false;

  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0 || tokens.length > 8) return false;

  const hasQuestionTone =
    String(textBody || '').includes('?') ||
    SHORT_QUESTION_WORDS.some((token) => normalized.includes(normalizeText(token)));

  if (!hasQuestionTone) return false;

  const hasServiceHint =
    SHORT_IN_DOMAIN_HINTS.some((keyword) => normalized.includes(normalizeText(keyword))) ||
    AI_ALLOWED_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)));

  if (hasServiceHint) return true;

  const childHintHits = CHILD_SUPERVISION_HINTS.filter((keyword) =>
    normalized.includes(normalizeText(keyword))
  ).length;

  return childHintHits >= 2;
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
  const domainTokenHits = tokens.filter((token) =>
    DOMAIN_GUARD_KEYWORDS.some((keyword) => token.includes(keyword) || keyword.includes(token))
  ).length;

  const domainPhraseHits = DOMAIN_GUARD_KEYWORDS.filter((keyword) => normalized.includes(keyword)).length;
  const isShortMessage = tokens.length <= 4;
  const hasShortInDomainHint =
    isShortMessage &&
    SHORT_IN_DOMAIN_HINTS.some((keyword) => normalized.includes(normalizeText(keyword)));
  const shortLikelyInDomainQuestion = isShortLikelyInDomainQuestion(textBody);

  return domainTokenHits <= 1 && domainPhraseHits === 0 && !hasShortInDomainHint && !shortLikelyInDomainQuestion;
};

const shouldEscalateFallback = (textBody, { useAiFallback = false } = {}) => {
  if (includesAnyKeyword(textBody, COMPLAINT_OR_SENSITIVE_KEYWORDS)) {
    return { escalate: true, reason: 'complaint_sensitive', reply: COMPLAINT_HANDOFF_REPLY };
  }

  if (isVeryLongMessage(textBody)) {
    return { escalate: true, reason: 'long_or_ambiguous', reply: SAFE_HANDOFF_REPLY };
  }

  if (includesAnyKeyword(textBody, OUT_OF_SCOPE_KEYWORDS)) {
    return { escalate: true, reason: 'out_of_scope', reply: SAFE_HANDOFF_REPLY };
  }

  // When AI fallback is enabled, let Gemini evaluate scope instead of
  // pre-blocking on low domain confidence. Gemini has its own in_scope
  // check and confidence threshold. When AI is disabled, keep the guard.
  if (!useAiFallback && hasLowDomainConfidence(textBody)) {
    return { escalate: true, reason: 'low_confidence', reply: SAFE_HANDOFF_REPLY };
  }

  return { escalate: false };
};

const hasRecentAutoReply = async (senderWaId, cooldownMinutes) => {
  const cutoff = new Date(Date.now() - cooldownMinutes * 60 * 1000);

  const lastAutoReply = await WhatsAppMessage.findOne({
    sender_wa_id: senderWaId,
    direction: 'outbound',
    platform: 'whatsapp',
    'raw_payload.auto_reply': true,
    timestamp: { $gte: cutoff }
  })
    .sort({ timestamp: -1 })
    .lean();

  if (!lastAutoReply) return false;

  const lastCustomerMessage = await WhatsAppMessage.findOne({
    sender_wa_id: senderWaId,
    direction: 'inbound',
    platform: 'whatsapp'
  })
    .sort({ timestamp: -1 })
    .lean();

  if (!lastCustomerMessage) return true;

  // Customer sent a new message after our last reply → allow reply
  // Our reply is newer than their last message → still in cooldown
  return lastCustomerMessage.timestamp <= lastAutoReply.timestamp;
};

const hasRecentStaffReply = async (senderWaId) => {
  const cutoff = new Date(Date.now() - STAFF_REPLY_BLOCK_MINUTES * 60 * 1000);

  const recent = await WhatsAppMessage.findOne({
    sender_wa_id: senderWaId,
    direction: 'outbound',
    platform: 'whatsapp',
    sent_by_staff_id: { $ne: null },
    timestamp: { $gte: cutoff }
  })
    .sort({ timestamp: -1 })
    .lean();

  return Boolean(recent);
};

const hasRecentDuplicateIntentAutoReply = async ({ senderWaId, matchedKey }) => {
  if (!senderWaId || !matchedKey) return false;
  if (!DUPLICATE_INTENT_SUPPRESSION_KEYS.has(matchedKey)) return false;

  const cutoff = new Date(Date.now() - DUPLICATE_INTENT_SUPPRESSION_MINUTES * 60 * 1000);
  const recentSameIntentAutoReply = await WhatsAppMessage.findOne({
    sender_wa_id: senderWaId,
    direction: 'outbound',
    platform: 'whatsapp',
    message_type: 'text',
    'raw_payload.auto_reply': true,
    'raw_payload.matched_key': matchedKey,
    timestamp: { $gte: cutoff }
  })
    .sort({ timestamp: -1 })
    .lean();

  return Boolean(recentSameIntentAutoReply);
};

const logAutoReply = (event, payload = {}) => {
  console.log(event, payload);
};

const logRoutingDecision = (payload = {}) => {
  logAutoReply('WA_BOT_ROUTE_DECISION', payload);
};

const logRoutingBlock = (payload = {}) => {
  logAutoReply('WA_BOT_ROUTE_BLOCKED', payload);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const persistAutoTriggerMarker = async ({ messageId, senderWaId, skipped, matchedKey, triggerMessageId }) => {
  if (!messageId || !senderWaId) return;
  // Use upsert so this works whether the atomic lock document already exists (the normal case)
  // or needs to be created fresh (e.g. for burst-resolved trigger IDs that differ from messageId).
  await WhatsAppMessage.updateOne(
    { message_id: `auto_trigger_${messageId}` },
    {
      $set: {
        sender_wa_id: senderWaId,
        timestamp: new Date(),
        'raw_payload.auto_reply': true,
        'raw_payload.skipped': skipped,
        'raw_payload.trigger_message_id': triggerMessageId || messageId,
        'raw_payload.matched_key': matchedKey
      },
      $setOnInsert: {
        message_id: `auto_trigger_${messageId}`,
        message_type: 'unsupported',
        text_body: '',
        direction: 'outbound',
        platform: 'whatsapp',
        status: 'sent',
        is_read_by_staff: true,
        is_replied: false
      }
    },
    { upsert: true }
  ).catch(() => {});
};

const acquireBurstLock = async (senderWaId) => {
  if (!senderWaId) return false;
  const lockId = `burst_lock_${senderWaId}`;
  const lockExpiry = new Date(Date.now() - (BURST_WINDOW_SECONDS + 10) * 1000);
  try {
    const result = await WhatsAppMessage.updateOne(
      {
        message_id: lockId,
        $or: [
          { timestamp: { $lte: lockExpiry } },
          { _id: { $exists: false } }
        ]
      },
      {
        $setOnInsert: {
          message_id: lockId,
          sender_wa_id: senderWaId,
          message_type: 'unsupported',
          text_body: '',
          direction: 'outbound',
          platform: 'whatsapp',
          status: 'sent',
          is_read_by_staff: true,
          is_replied: false,
          raw_payload: { burst_lock: true }
        },
        $set: { timestamp: new Date() }
      },
      { upsert: true }
    );
    return result.upsertedCount === 1 || result.modifiedCount === 1;
  } catch (error) {
    if (error?.code === 11000) return false;
    console.error('BURST_LOCK_ERROR', error.message);
    return false;
  }
};

const resolveBurstText = async ({ senderWaId, messageId }) => {
  const burstWindowMs = BURST_WINDOW_SECONDS * 1000;
  const BURST_SUPPORTED_TYPES = ['text', 'audio', 'image', 'video'];
  const triggerMessage = await WhatsAppMessage.findOne({
    message_id: messageId,
    sender_wa_id: senderWaId,
    direction: 'inbound',
    platform: 'whatsapp',
    message_type: { $in: BURST_SUPPORTED_TYPES }
  }).lean();

  if (!triggerMessage?.timestamp) {
    return { skip: true, reason: 'missing_trigger_message', burstText: '' };
  }

  let settledTrigger = triggerMessage;
  while (settledTrigger?.timestamp) {
    const evaluationWindowStart = new Date(settledTrigger.timestamp);
    const evaluationWindowEnd = new Date(evaluationWindowStart.getTime() + burstWindowMs);
    const waitMs = Math.max(0, evaluationWindowEnd.getTime() - Date.now());
    if (waitMs > 0) await sleep(waitMs);

    const latestInBurst = await WhatsAppMessage.findOne({
      sender_wa_id: senderWaId,
      direction: 'inbound',
      platform: 'whatsapp',
      message_type: { $in: BURST_SUPPORTED_TYPES },
      timestamp: { $gte: evaluationWindowStart, $lte: evaluationWindowEnd }
    })
      .sort({ timestamp: -1, _id: -1 })
      .lean();

    if (!latestInBurst?.timestamp) {
      return {
        skip: true,
        reason: 'burst_latest_missing',
        burstText: '',
        latestMessageId: null
      };
    }

    if (latestInBurst.message_id === settledTrigger.message_id) {
      break;
    }

    settledTrigger = latestInBurst;
  }

  if (!settledTrigger?.timestamp) {
    return { skip: true, reason: 'missing_settled_trigger', burstText: '' };
  }

  // Aggregate around the same evaluated trigger.
  // Instead of only looking 5s back from the settled trigger, look back to the
  // last auto-reply so that messages arriving more than 5s apart (but all sent
  // before the bot had a chance to reply) are combined into one context block.
  const BURST_LOOKBACK_MAX_MS = 10 * 60 * 1000; // cap at 10 minutes
  const settledTriggerTime = new Date(settledTrigger.timestamp);
  const evaluationWindowEnd = new Date(settledTriggerTime.getTime() + burstWindowMs);

  const lastAutoReplyBeforeTrigger = await WhatsAppMessage.findOne({
    sender_wa_id: senderWaId,
    direction: 'outbound',
    platform: 'whatsapp',
    'raw_payload.auto_reply': true,
    timestamp: { $lte: settledTriggerTime }
  }).sort({ timestamp: -1 }).lean();

  const lookbackFloor = new Date(settledTriggerTime.getTime() - BURST_LOOKBACK_MAX_MS);
  const aggregationWindowStart = lastAutoReplyBeforeTrigger?.timestamp
    ? new Date(Math.max(
        new Date(lastAutoReplyBeforeTrigger.timestamp).getTime(),
        lookbackFloor.getTime()
      ))
    : new Date(settledTriggerTime.getTime() - burstWindowMs);

  const aggregationWindowEnd = evaluationWindowEnd;
  const burstMessages = await WhatsAppMessage.find({
    sender_wa_id: senderWaId,
    direction: 'inbound',
    platform: 'whatsapp',
    message_type: { $in: BURST_SUPPORTED_TYPES },
    timestamp: { $gte: aggregationWindowStart, $lte: aggregationWindowEnd }
  })
    .sort({ timestamp: 1, _id: 1 })
    .lean();

  const burstText = burstMessages
    .map((item) => String(item?.text_body || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();

  return {
    skip: false,
    reason: null,
    burstText,
    triggerMessageId: settledTrigger.message_id
  };
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

const maybeAutoReply = async ({ messageId, senderWaId, messageType, textBody, mediaId }) => {
  try {
    logAutoReply('AUTO_REPLY_TRIGGERED', {
      messageId,
      senderWaId,
      messageType,
      hasTextBody: Boolean(textBody)
    });

    if (!senderWaId || !messageId) {
      logAutoReply('AUTO_REPLY_SKIPPED', { messageId, reason: 'missing_payload' });
      logRoutingBlock({
        messageId,
        route: 'skip',
        reason: 'missing_payload'
      });
      return { skipped: true, reason: 'missing_payload' };
    }

    const SUPPORTED_MESSAGE_TYPES = ['text', 'audio', 'image', 'video'];
    if (!SUPPORTED_MESSAGE_TYPES.includes(messageType)) {
      logAutoReply('AUTO_REPLY_SKIPPED', { messageId, reason: 'unsupported_message_type', messageType });
      logRoutingBlock({
        messageId,
        route: 'skip',
        reason: 'unsupported_message_type',
        messageType
      });
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
      logRoutingBlock({
        messageId,
        route: 'skip',
        reason: 'disabled'
      });
      return { skipped: true, reason: 'disabled' };
    }

    const normalizedWaId = normalizePhoneForWhatsApp(senderWaId);
    if (!normalizedWaId) {
      logAutoReply('AUTO_REPLY_SKIPPED', { messageId, reason: 'invalid_wa_id', senderWaId });
      logRoutingBlock({
        messageId,
        route: 'skip',
        reason: 'invalid_wa_id'
      });
      return { skipped: true, reason: 'invalid_wa_id' };
    }

    // Atomic duplicate protection — claim the processing lock before doing any work.
    // A non-atomic findOne+insert sequence has a race window where two concurrent
    // webhook deliveries for the same message both read "not found" and both send a reply.
    // Using upsert with $setOnInsert ensures only one caller wins the lock.
    const claimResult = await WhatsAppMessage.updateOne(
      { message_id: `auto_trigger_${messageId}` },
      { $setOnInsert: { message_id: `auto_trigger_${messageId}`, created_at: new Date() } },
      { upsert: true }
    );
    if (claimResult.upsertedCount === 0) {
      logAutoReply('AUTO_REPLY_SKIPPED', { messageId, reason: 'duplicate_trigger' });
      logRoutingBlock({
        messageId,
        senderWaId: normalizedWaId,
        route: 'skip',
        reason: 'duplicate_trigger'
      });
      return { skipped: true, reason: 'duplicate_trigger' };
    }

    const gotBurstLock = await acquireBurstLock(normalizedWaId);
    if (!gotBurstLock) {
      logAutoReply('AUTO_REPLY_SKIPPED', {
        messageId,
        senderWaId: normalizedWaId,
        reason: 'burst_lock_held'
      });
      logRoutingBlock({
        messageId,
        senderWaId: normalizedWaId,
        route: 'skip',
        reason: 'burst_lock_held'
      });
      return { skipped: true, reason: 'burst_lock_held' };
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
      logRoutingBlock({
        messageId,
        senderWaId: normalizedWaId,
        route: 'skip',
        reason: burstResolution.reason
      });
      return { skipped: true, reason: burstResolution.reason };
    }

    const resolvedTriggerMessageId = burstResolution.triggerMessageId || messageId;
    if (resolvedTriggerMessageId !== messageId) {
      const resolvedAlreadyHandled = await WhatsAppMessage.findOne({
        message_id: `auto_trigger_${resolvedTriggerMessageId}`
      }).lean();
      if (resolvedAlreadyHandled) {
        logAutoReply('AUTO_REPLY_SKIPPED', {
          messageId,
          senderWaId: normalizedWaId,
          reason: 'duplicate_trigger',
          resolvedTriggerMessageId
        });
        logRoutingBlock({
          messageId,
          senderWaId: normalizedWaId,
          route: 'skip',
          reason: 'duplicate_trigger',
          resolvedTriggerMessageId
        });
        return { skipped: true, reason: 'duplicate_trigger' };
      }
    }

    const _perfStart = Date.now();
    let effectiveTextBody = burstResolution.burstText || textBody;
    console.log('PERF_BURST_DONE', { messageId, elapsedMs: Date.now() - _perfStart, messageType });

    // Fire typing indicator non-blocking — shows "typing..." to customer while we process
    setImmediate(() => sendTypingIndicator(messageId).catch(() => {}));

    // For audio messages, use a placeholder text body so greeting/keyword logic is bypassed
    if (messageType === 'audio' && !effectiveTextBody) {
      effectiveTextBody = '[رسالة صوتية]';
    }

    // For image messages, use caption if present, otherwise placeholder
    if (messageType === 'image' && !effectiveTextBody) {
      effectiveTextBody = '[صورة من الزبون]';
    }

    // For video messages, use caption if present, otherwise placeholder
    if (messageType === 'video' && !effectiveTextBody) {
      effectiveTextBody = '[فيديو من الزبون]';
    }

    const optCommand = detectOptCommand(effectiveTextBody);
    if (optCommand) {
      const optOut = optCommand === 'opt_out';
      const updated = await setWhatsAppOptOut(normalizedWaId, optOut);
      const confirmationReply = optOut
        ? WHATSAPP_OPT_OUT_CONFIRMATION_REPLY
        : WHATSAPP_OPT_IN_CONFIRMATION_REPLY;

      const sendResult = await postWhatsAppText({
        to: normalizedWaId,
        messageBody: confirmationReply,
        staffId: null,
        skipOptOutCheck: true
      });

      logAutoReply('AUTO_REPLY_OPT_COMMAND_HANDLED', {
        messageId,
        senderWaId: normalizedWaId,
        command: optCommand,
        updated,
        confirmationSent: Boolean(sendResult?.ok)
      });
      if (sendResult?.ok) {
        await persistAutoReplyMessage({
          waId: normalizedWaId,
          textBody: confirmationReply,
          messageId: sendResult.messageId,
          matchedKey: optCommand
        });
      }

      await persistAutoTriggerMarker({
        messageId: resolvedTriggerMessageId,
        senderWaId: normalizedWaId,
        skipped: sendResult?.ok ? null : 'opt_command_confirmation_failed',
        matchedKey: optCommand,
        triggerMessageId: resolvedTriggerMessageId
      });

      logRoutingDecision({
        messageId,
        senderWaId: normalizedWaId,
        route: optCommand,
        updated,
        confirmationSent: Boolean(sendResult?.ok),
        outgoingMessageId: sendResult?.messageId || null
      });

      if (!sendResult?.ok) {
        logRoutingBlock({
          messageId,
          senderWaId: normalizedWaId,
          route: optCommand,
          reason: 'opt_command_confirmation_failed'
        });
        return { skipped: true, reason: 'opt_command_confirmation_failed', command: optCommand };
      }

      return { ok: true, matchedKey: optCommand };
    }

    // Parallel pre-Gemini checks — all independent, all use normalizedWaId only
    const [optOutStatus, recentStaffReply, recentAutoReply] = await Promise.all([
      isWhatsAppOptedOut(normalizedWaId),
      hasRecentStaffReply(normalizedWaId),
      hasRecentAutoReply(normalizedWaId, config.cooldownMinutes)
    ]);

    if (optOutStatus.optedOut) {
      logAutoReply('AUTO_REPLY_SKIPPED', {
        messageId,
        senderWaId: normalizedWaId,
        reason: 'opted_out'
      });
      logRoutingBlock({
        messageId,
        senderWaId: normalizedWaId,
        route: 'skip',
        reason: 'opted_out'
      });
      return { skipped: true, reason: 'opted_out' };
    }

    if (recentStaffReply) {
      logAutoReply('AUTO_REPLY_SKIPPED', {
        messageId,
        senderWaId: normalizedWaId,
        reason: 'recent_staff_reply',
        blockMinutes: STAFF_REPLY_BLOCK_MINUTES
      });
      logRoutingBlock({
        messageId,
        senderWaId: normalizedWaId,
        route: 'skip',
        reason: 'recent_staff_reply',
        blockMinutes: STAFF_REPLY_BLOCK_MINUTES
      });
      return { skipped: true, reason: 'recent_staff_reply' };
    }

    if (recentAutoReply) {
      await persistAutoTriggerMarker({
        messageId: resolvedTriggerMessageId,
        senderWaId: normalizedWaId,
        skipped: 'cooldown',
        triggerMessageId: resolvedTriggerMessageId
      });
      logAutoReply('AUTO_REPLY_SKIPPED', { messageId, senderWaId: normalizedWaId, reason: 'cooldown_active' });
      logRoutingBlock({
        messageId,
        senderWaId: normalizedWaId,
        route: 'skip',
        reason: 'cooldown_active'
      });
      return { skipped: true, reason: 'cooldown_active' };
    }

    const greetingOpening = detectGreetingOpening(effectiveTextBody);
    const greetingOnly = greetingOpening ? isGreetingOnlyMessage(effectiveTextBody) : false;
    let replyText;
    let matchedKey;

    // ─── STEP 1: Greeting-only → instant intro reply ──────────────────────
    if (greetingOnly && greetingOpening) {
      replyText = buildGreetingOnlyIntroReply({ opening: greetingOpening, footer: config.footer });
      matchedKey = 'intro';

      // ─── STEP 2: Hard blocks — complaints, sensitive, out-of-scope ────────
      // These MUST be caught before AI to prevent inappropriate responses.
    } else if (includesAnyKeyword(effectiveTextBody, COMPLAINT_OR_SENSITIVE_KEYWORDS)) {
      replyText = [greetingOpening, COMPLAINT_HANDOFF_REPLY].filter(Boolean).join('\n');
      matchedKey = 'escalation_handoff';
      logRoutingDecision({ messageId, senderWaId: normalizedWaId, route: 'escalation_handoff', reason: 'complaint_sensitive' });

    } else if (isVeryLongMessage(effectiveTextBody)) {
      replyText = [greetingOpening, SAFE_HANDOFF_REPLY].filter(Boolean).join('\n');
      matchedKey = 'escalation_handoff';
      logRoutingDecision({ messageId, senderWaId: normalizedWaId, route: 'escalation_handoff', reason: 'long_or_ambiguous' });

    } else if (includesAnyKeyword(effectiveTextBody, OUT_OF_SCOPE_KEYWORDS)) {
      replyText = [greetingOpening, SAFE_HANDOFF_REPLY].filter(Boolean).join('\n');
      matchedKey = 'escalation_handoff';
      logRoutingDecision({ messageId, senderWaId: normalizedWaId, route: 'escalation_handoff', reason: 'out_of_scope' });

      // ─── STEP 3: GEMINI-FIRST (AI primary — like Voiceflow) ───────────────
      // Every non-blocked message goes to Gemini with knowledge base context.
      // Gemini has: live DB facts (hours, prices, plans, birthday packages),
      // FAQ memory (AIFaqMemory collection), and conversation history.
      // Gemini decides if it can answer (in_scope + confidence) or declines.
    } else if (config.useAiFallback) {
      try {
        const recentMessages = await WhatsAppMessage.find({
          sender_wa_id: normalizedWaId,
          platform: 'whatsapp',
          message_type: 'text',
          text_body: { $exists: true, $ne: '' },
          message_id: { $not: /^auto_trigger_/ },
          $or: [
            { direction: 'inbound' },
            {
              direction: 'outbound',
              'raw_payload.matched_key': { $nin: ['escalation_handoff'] }
            }
          ]
        })
          .sort({ timestamp: -1 })
          .limit(6)
          .lean();

        const conversationHistory = recentMessages
          .reverse()
          .map((m) => ({
            role: m.direction === 'inbound' ? 'user' : 'model',
            text: String(m.text_body || '').trim()
          }))
          .filter((m) => m.text.length > 0)
          .filter((m, idx, arr) => {
            if (idx === arr.length - 1 && m.role === 'user' && m.text === effectiveTextBody.trim()) {
              return false;
            }
            return true;
          })
          .slice(-5);

        const aiUserText = messageType === 'audio' ? (effectiveTextBody && effectiveTextBody !== '[رسالة صوتية]' ? effectiveTextBody : '[رسالة صوتية من الزبون]') : messageType === 'image' ? (effectiveTextBody !== '[صورة من الزبون]' ? effectiveTextBody : '[صورة من الزبون]') : messageType === 'video' ? (effectiveTextBody !== '[فيديو من الزبون]' ? effectiveTextBody : '[فيديو من الزبون]') : effectiveTextBody;

        // Check for booking intent — use tool-calling Gemini path
        const bookingState = getBookingState(normalizedWaId);

        // Check if last bot reply was a booking question — force follow-up into booking flow
        const lastBotReply = await WhatsAppMessage.findOne({
          sender_wa_id: normalizedWaId,
          direction: 'outbound',
          platform: 'whatsapp',
          'raw_payload.auto_reply': true
        }).sort({ timestamp: -1 }).lean();
        const lastMatchedKey = lastBotReply?.raw_payload?.matched_key || '';
        const lastWasBookingQuestion = lastMatchedKey.includes('booking') || lastMatchedKey === 'ai_booking';
        const birthdayChildCount = extractChildCount(aiUserText);
        const isBirthdayCountFollowUp =
          messageType === 'text' &&
          Number.isInteger(birthdayChildCount) &&
          isBirthdayChildCountFollowUp(lastBotReply?.text_body, aiUserText);

        if (lastWasBookingQuestion && !bookingState.step) {
          // Bot asked a booking choice question — treat any short reply as booking follow-up
          bookingState.step = 'service_choice';
          console.log('BOOKING_FOLLOWUP_FORCED', {
            messageId,
            senderWaId: normalizedWaId,
            lastMatchedKey,
            aiUserText: aiUserText.slice(0, 50)
          });
        }

        if (isBirthdayCountFollowUp) {
          replyText = [greetingOpening, buildBirthdayChildCountReply(birthdayChildCount)].filter(Boolean).join('\n');
          matchedKey = 'birthday_child_count_followup';
          logRoutingDecision({
            messageId,
            senderWaId: normalizedWaId,
            route: 'birthday_child_count_followup',
            childCount: birthdayChildCount
          });
        } else if (hasBookingIntent(aiUserText, bookingState)) {
          const bookingContents = conversationHistory
            .map(m => ({ role: m.role, parts: [{ text: m.text }] }));
          bookingContents.push({ role: 'user', parts: [{ text: aiUserText }] });

          const { getStaticPrompt } = require('./autoReplyAi');
          const jordanNow = new Date().toLocaleString('ar-JO', {
            timeZone: 'Asia/Amman', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: true
          });
          const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Amman' });
          const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Amman' });

          const bookingDynamicCtx = `الوقت الحالي: ${jordanNow}\nتاريخ اليوم: ${today}\nتاريخ بكرا: ${tomorrow}`;
          const bookingSystemPrompt = (typeof getStaticPrompt === 'function' ? getStaticPrompt() : '') + '\n\n' + bookingDynamicCtx;

          const bookingResult = await runBookingGeminiCall({
            systemInstruction: bookingSystemPrompt,
            contents: bookingContents,
            senderWaId: normalizedWaId,
            bookingState,
            maxChars: config.aiMaxReplyChars
          });

          if (bookingResult && bookingResult.reply_ar) {
            setBookingState(normalizedWaId, bookingState);
            replyText = [greetingOpening, bookingResult.reply_ar].filter(Boolean).join('\n');
            matchedKey = 'ai_booking';

            logRoutingDecision({
              messageId,
              senderWaId: normalizedWaId,
              route: 'ai_booking',
              bookingStep: bookingState.step || 'active',
              bookingCode: bookingState.bookingCode || null
            });
          }
        }

        // Fall through to regular Gemini if booking path didn't produce a reply
        if (!replyText) {
        const _perfBeforeGemini = Date.now();
        const aiResult = await getScopedAiFallbackReply({
          userText: aiUserText,
          audioMediaId: messageType === 'audio' ? (mediaId || null) : null,
          imageMediaId: messageType === 'image' ? (mediaId || null) : null,
          videoMediaId: messageType === 'video' ? (mediaId || null) : null,
          maxChars: config.aiMaxReplyChars,
          conversationHistory
        });
        console.log('PERF_GEMINI_DONE', { messageId, geminiMs: Date.now() - _perfBeforeGemini, messageType, inScope: aiResult?.in_scope, topic: aiResult?.topic });
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
          // Voice note or text that Gemini classified as greeting → use Shroomi intro
          if (aiResult.topic === 'greeting_social' && greetingOnly) {
            replyText = buildGreetingOnlyIntroReply({ opening: greetingOpening, footer: config.footer });
            matchedKey = 'intro';
            logRoutingDecision({
              messageId,
              senderWaId: normalizedWaId,
              route: 'ai_greeting_intercepted',
              aiTopic: 'greeting_social'
            });
          } else if (aiResult.topic === 'greeting_social' && !greetingOnly) {
            // Burst contained greeting + substantive question — serve the question
            const matched = selectActionKeywordMatch(effectiveTextBody);
            if (matched) {
              const kwReply = matched.buildReply
                ? await matched.buildReply({ footer: config.footer })
                : [matched.reply, config.footer].filter(Boolean).join('\n');
              replyText = greetingOpening ? [greetingOpening, kwReply].join('\n') : kwReply;
              matchedKey = matched.key;
            } else {
              replyText = buildGreetingOnlyIntroReply({ opening: greetingOpening, footer: config.footer });
              matchedKey = 'intro';
            }
            logRoutingDecision({
              messageId,
              senderWaId: normalizedWaId,
              route: 'greeting_with_question',
              aiTopic: 'greeting_social',
              matchedKey
            });
          } else {
            replyText = [greetingOpening, boundedAiReply].filter(Boolean).join('\n');
            matchedKey = 'ai_primary';
            logRoutingDecision({
              messageId,
              senderWaId: normalizedWaId,
              route: 'ai_primary_used',
              aiTopic: aiResult.topic || 'unknown',
              aiConfidence: aiResult.confidence
            });
          }
        } else {
          // Audio and image messages are always in-domain — force use Gemini reply if available
          const isMediaMessage = messageType === 'audio' || messageType === 'image' || messageType === 'video';

          // Check if Gemini misclassified a clearly in-domain text message
          const normalizedForOverride = normalizeText(effectiveTextBody);
          const hasDomainKeyword = isMediaMessage || FORCE_IN_SCOPE_KEYWORDS.some(
            (kw) => normalizedForOverride.includes(normalizeText(kw))
          );

          if (hasDomainKeyword && boundedAiReply && boundedAiReply.length >= 2) {
            // Gemini generated a reply but said out_of_scope — override and use the reply
            replyText = [greetingOpening, boundedAiReply].filter(Boolean).join('\n');
            matchedKey = 'ai_override';
            logRoutingDecision({
              messageId,
              senderWaId: normalizedWaId,
              route: 'ai_scope_override',
              reason: isMediaMessage ? 'media_message_always_in_scope' : 'domain_keyword_detected',
              messageType,
              aiConfidence: aiResult?.confidence ?? null,
              aiInScope: aiResult?.in_scope ?? null,
              aiTopic: aiResult?.topic ?? null
            });
          } else if (hasDomainKeyword) {
            // Gemini said out_of_scope AND gave no usable reply — fall back to legacy keyword matching
            const keywordMatches = detectKeywordMatches(effectiveTextBody);
            const matched = keywordMatches[0]?.entry || null;
            if (matched) {
              if (matched.buildReply) {
                replyText = await matched.buildReply({ footer: config.footer });
              } else {
                replyText = [matched.reply, config.footer].filter(Boolean).join('\n');
              }
              if (greetingOpening) {
                replyText = [greetingOpening, replyText].filter(Boolean).join('\n');
              }
              matchedKey = matched.key;
              logRoutingDecision({
                messageId,
                senderWaId: normalizedWaId,
                route: 'ai_failed_keyword_rescue',
                keywordMatchedKey: matchedKey
              });
            } else {
              const mediaFallbackReply = isMediaMessage
                ? 'ما قدرت أفهم رسالتك بشكل صحيح 💛 ممكن تكتبلي سؤالك بالنص وبساعدك فوراً؟'
                : config.fallbackReply;
              replyText = [greetingOpening, mediaFallbackReply].filter(Boolean).join('\n');
              matchedKey = isMediaMessage ? 'media_fallback' : 'fallback';
              logRoutingDecision({
                messageId,
                senderWaId: normalizedWaId,
                route: isMediaMessage ? 'media_fallback' : 'ai_declined_fallback',
                aiConfidence: aiResult?.confidence ?? null,
                aiInScope: aiResult?.in_scope ?? null
              });
            }
          } else {
            // Genuinely out of scope — no domain keywords found
            replyText = [greetingOpening, config.fallbackReply].filter(Boolean).join('\n');
            matchedKey = 'fallback';
            logRoutingDecision({
              messageId,
              senderWaId: normalizedWaId,
              route: 'ai_declined_fallback',
              aiConfidence: aiResult?.confidence ?? null,
              aiInScope: aiResult?.in_scope ?? null
            });
          }
        }
        } // close if (!replyText) — booking path may have already set replyText
      } catch (aiError) {
        console.error('AI_PRIMARY_ROUTE_ERROR', aiError.message);
        replyText = [greetingOpening, config.fallbackReply].filter(Boolean).join('\n');
        matchedKey = 'fallback';
      }

      // ─── STEP 4: AI disabled → legacy keyword matching ────────────────────
      // Only runs when useAiFallback is false in config (backward compatibility).
    } else {
      const keywordMatches = detectKeywordMatches(effectiveTextBody);
      let matched = keywordMatches[0]?.entry || null;
      // If a greeting+question burst arrives and the top match is intro, prefer the question
      if (matched?.key === 'intro' && !greetingOnly) {
        const actionMatch = selectActionKeywordMatch(effectiveTextBody);
        if (actionMatch) matched = actionMatch;
      }
      if (matched) {
        if (matched.buildReply) {
          replyText = await matched.buildReply({ footer: config.footer });
        } else {
          replyText = [matched.reply, config.footer].filter(Boolean).join('\n');
        }
        if (greetingOpening && matched.key !== 'intro') {
          replyText = [greetingOpening, replyText].filter(Boolean).join('\n');
        }
        matchedKey = matched.key;
        logRoutingDecision({ messageId, senderWaId: normalizedWaId, route: 'keyword_legacy', keywordMatchedKey: matchedKey });
      } else if (hasLowDomainConfidence(effectiveTextBody)) {
        replyText = [greetingOpening, SAFE_HANDOFF_REPLY].filter(Boolean).join('\n');
        matchedKey = 'escalation_handoff';
        logRoutingDecision({ messageId, senderWaId: normalizedWaId, route: 'legacy_low_confidence_handoff' });
      } else {
        replyText = [greetingOpening, config.fallbackReply].filter(Boolean).join('\n');
        matchedKey = 'fallback';
        logRoutingDecision({ messageId, senderWaId: normalizedWaId, route: 'legacy_fallback' });
      }
    }

    replyText = removeLeadingDuplicateGreeting({ greetingOpening, replyText });

    const duplicateIntentSuppressed = await hasRecentDuplicateIntentAutoReply({
      senderWaId: normalizedWaId,
      matchedKey
    });
    if (duplicateIntentSuppressed) {
      await persistAutoTriggerMarker({
        messageId: resolvedTriggerMessageId,
        senderWaId: normalizedWaId,
        skipped: 'duplicate_intent_recent',
        matchedKey,
        triggerMessageId: resolvedTriggerMessageId
      });
      logAutoReply('AUTO_REPLY_SKIPPED', {
        messageId,
        senderWaId: normalizedWaId,
        reason: 'duplicate_intent_recent',
        matchedKey,
        suppressionWindowMinutes: DUPLICATE_INTENT_SUPPRESSION_MINUTES
      });
      logRoutingBlock({
        messageId,
        senderWaId: normalizedWaId,
        route: 'skip',
        reason: 'duplicate_intent_recent',
        matchedKey,
        suppressionWindowMinutes: DUPLICATE_INTENT_SUPPRESSION_MINUTES
      });
      return { skipped: true, reason: 'duplicate_intent_recent', matchedKey };
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
      messageId: resolvedTriggerMessageId,
      senderWaId: normalizedWaId,
      skipped: null,
      matchedKey: matchedKey || 'fallback',
      triggerMessageId: resolvedTriggerMessageId
    });

    console.log('PERF_TOTAL', { messageId, totalMs: Date.now() - _perfStart, messageType });
    logAutoReply('AUTO_REPLY_SENT', {
      messageId,
      senderWaId: normalizedWaId,
      matchedKey: matchedKey || 'fallback',
      outgoingMessageId: sendResult.messageId
    });
    logRoutingDecision({
      messageId,
      senderWaId: normalizedWaId,
      route: 'sent',
      finalMatchedKey: matchedKey || 'fallback',
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
  buildBirthdayText,
  detectDeterministicIntent,
  shouldEscalateFallback
};
