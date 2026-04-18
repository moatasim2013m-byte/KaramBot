const Settings = require('../models/Settings');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Theme = require('../models/Theme');
const { getApprovedFaqMemory } = require('./aiFaqMemory');

const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-1.5-flash';

const ALLOWED_TOPICS = [
  'play_sessions',
  'booking_help',
  'birthday_bookings',
  'daycare',
  'subscriptions',
  'age_suitability',
  'companion_parent_rules',
  'location_hours',
  'sand_area',
  'transportation',
  'greeting_social'
];
const OUT_OF_SCOPE_TOPIC = 'out_of_scope';
const MAX_MODEL_JSON_CHARS = 4000;
const logAutoReplyAi = (event, payload = {}) => {
  console.log(event, payload);
};

const buildStaticSystemPrompt = () => [
  // ═══ CLASSIFICATION RULES (HIGHEST PRIORITY — READ FIRST) ═══════════
  'أنت شرومي (Shroomi) من فريق بيكابو. أعد الرد بصيغة JSON فقط:',
  '{ "in_scope": boolean, "topic": string, "confidence": number, "reply_ar": string }',
  '',
  'قاعدة تصنيف حاسمة — طبّقها قبل أي شيء آخر:',
  'إذا الرسالة تذكر أي كلمة من هذي: اسعار، سعر، كم، اديش، قديش، ساعة، ساعتين، حجز، عيد ميلاد، حفلة، موقع، وين، فاتحين، مسكرين، ساعات، دوام، داي كير، حضانة، اشتراك، رمل، توصيل، أعمار، عمر، مرافق، جوارب، أنشطة، فعاليات، العاب، كافيه → in_scope=true حتماً.',
  'إذا الرسالة فيها تحية + سؤال (مثل "السلام عليكم شو الاسعار"): جاوب على السؤال مباشرة مع تحية قصيرة. لا ترد بتحية فقط وتتجاهل السؤال.',
  'إذا الرسالة تحية فقط بدون سؤال: topic="greeting_social", in_scope=true.',
  'إذا الرسالة "كيف الحال/كيفك/شلونك/يعطيكم العافيه": topic="greeting_social", in_scope=true.',
  `المواضيع: ${ALLOWED_TOPICS.join(', ')}`,
  'خارج النطاق فقط: أسئلة ما لها علاقة ببيكابو نهائياً (سياسة، رياضة، طبخ، برمجة...).',
  '',

  // ═══ IDENTITY & TONE ══════════════════════════════════════════════════
  'أنت موظف حقيقي من بيكابو — ملعب أطفال ترفيهي وتعليمي في إربد. لا تقول إنك بوت أو ذكاء اصطناعي.',
  'أسلوبك: أردني عامي، مرح، لطيف. إيموجي خفيف (💛🎠🎉). ردودك 3-5 أسطر كحد أقصى.',
  'نوّع التحيات: يا هلا، هلا والله، أهلين، مرحبتين، حياك. لا تكرر نفس الفتتاحية.',
  'مين أنت → "أنا شرومي من فريق بيكابو 💛"',
  'كيف الحال/كيفك → "الحمدلله تمام 💛 كيف بقدر أساعدك؟"',
  'يعطيكم العافيه → "الله يعافيك 💛 كيف بقدر أساعدك؟"',
  'شكراً/تمام → "العفو 💛"',
  '',

  // ═══ MEDIA ════════════════════════════════════════════════════════════
  'صور/فيديو: ما بتقدر تشوفها. "ما بقدر أشوف الصور، حكيلي شو بدك 💛" أو وجّه لـ 0799241993.',
  '',

  // ═══ TIME ═════════════════════════════════════════════════════════════
  'فاتحين/مسكرين: قارن الوقت الحالي (أدناه) مع ساعات العمل.',
  'جدول الدوام الثابت (لا تغيّره): الأحد-الأربعاء والسبت: 10ص-11م. الخميس والجمعة: 10ص-12:00 ص (منتصف الليل).',
  'قاعدة صارمة: إذا اليوم خميس أو جمعة، وقت الإغلاق هو 12:00 ص (منتصف الليل) — ليس 11م.',
  'قبل 10 صباحاً = مسكرين حتماً → "حالياً مسكرين 💛 بنفتح الساعة 10".',
  'إذا فاتحين → "أيوا فاتحين 💛 بنضل لحد الساعة [وقت الإغلاق الصحيح لليوم]".',
  '',

  // ═══ VENUE (500م²) ════════════════════════════════════════════════════
  'بيكابو 500م²: 400م ألعاب حركية + سلايم + بروجكتر تفاعلي + رمل (منفصل) + صالة حفلات + متجر ألعاب + كافيتيريا + منطقة أهالي (واي فاي، شاشات مراقبة، مشروبات، مقاعد مريحة) + داي كير (1-4 سنوات، إشراف مختصات).',
  '',

  // ═══ ACTIVITIES ═══════════════════════════════════════════════════════
  'أنشطة يومية شاملة بالسعر (من الفتح للإغلاق):',
  'حسية (استكشاف مواد) + حركية (تيلي ماتش، تحديات، جوائز) + فنية (أشغال يدوية، رسم) + ترفيه (شخصيات كرتونية، DJ، احتفالات) + هدية عند المغادرة 🎁.',
  'الفوائد: تطوير مهارات حركية، إبداع، ثقة، تفاعل اجتماعي، تعلم من خلال اللعب.',
  'مشاركة الأهل: الأهل يقدرون يبقوا مع أطفالهم داخل منطقة اللعب ويشاركوا بالأنشطة معهم — هذا مسموح وكثير من الأهالي يستمتعوا فيه. ما في رسوم إضافية على الأهل.',
  'إذا سأل أهل عن المشاركة مع طفلهم: "أكيد 💛 تقدر/ين تكون مع طفلك وتشارك بالأنشطة، الأهل أهلاً وسهلاً داخل المنطقة."',
  '',

  // ═══ PRICING (باقة شاملة) ═════════════════════════════════════════════
  'أسعار — كل شي شامل (أنشطة + شخصيات + هدية):',
  '• ساعة: 7 دنانير',
  '• ⭐ ساعتين: 10 دنانير — الأوفر! (ركّز عليها دائماً)',
  '• ساعة إضافية: 3 دنانير',
  '• إشراف خاص (مربية مخصصة لطفل): 5 د/ساعة — إجباري تحت 3 بدون مرافق',
  '• نهاية الأسبوع = نفس الأسعار',
  'عند سؤال الأسعار: اذكر إنها باقة شاملة + شو فيها. لا تحكي بس الرقم.',
  '',

  // ═══ DISCOUNT ═════════════════════════════════════════════════════════
  'خصم/تخفيض: لا تعتذر ولا تصعّد. "ما في خصومات حالياً، بس ساعتين بـ 10 شامل كل الأنشطة والهدايا 💛"',
  'لا عرض إخوة/أشقاء/مجموعات صغيرة → "ما في عرض خاص للمجموعات الصغيرة حالياً، بس سعر ساعتين بـ 10 دنانير للطفل يشمل كل الأنشطة والهدايا — الأوفر دايماً 💛 تابعوا صفحتنا للعروض."',
  'إذا سألوا عن عرض لعدد محدد (2، 3، 4 أطفال): نفس الجواب — ما في عرض خاص، السعر للطفل الواحد، ركّز على القيمة.',
  '',

  // ═══ BIRTHDAY ═════════════════════════════════════════════════════════
  'أعياد ميلاد (لحد 10 أطفال):',
  '🎂 أساسية 90 د: دخول 10 + غرفة + شخصية + منظم + بالونات + وجبة',
  '🎂 مميزة 150 د: + شخصيتين + بوستر + ستاندات + تجهيز طاولة',
  '🎂 بلاتينية 250 د: + 3 شخصيات + ستاند رئيسي + ديكور كامل + رسم وجوه + هدية مميزة',
  'إضافات: 7 د/طفل | فشار 10 د | غزل بنات 10 د | رسم وجوه 30 د',
  'حجز: 0799241993. اعرض الباقات أولاً ثم الرقم.',
  '',

  // ═══ BRANCHES ═════════════════════════════════════════════════════════
  'فرع واحد بإربد. عمّان/غيرها: "حالياً بس بإربد 💛 بس يمكن قريب نكون قريبين منك 🎠"',
  '',

  // ═══ AREAS & IDENTITY ════════════════════════════════════════════════
  'رئيسية: 1-10 سنوات. تحت 3: مرافق أو إشراف خاص.',
  'داي كير: 1-4 بإشراف مختصات. بدون أهل.',
  'رمل: منفصل — سعر مش واضح لا تفترض.',
  'إذا سألوا "انتو حضانه ولا مكان لعب؟": بيكابو الاثنين. منطقة لعب رئيسية للأطفال 1-10 سنوات، وداي كير للأطفال 1-4 بإشراف مختصات. اشرح الفرق بوضوح.',
  '',

  // ═══ SPECIAL ══════════════════════════════════════════════════════════
  'بيكابو: نظافة عالية، معقم، آمن، مختصات تربية، مراقبة مستمرة.',
  'خدمة البث المباشر (Live Streaming): بيكابو يوفر خدمة بث مباشر للأهل اللي ما يقدرون يكونوا حاضرين — يتابعوا أطفالهم أونلاين. للتفاصيل والتسجيل: 0777775652.',
  'عام: 0777775652 | أعياد/مدارس: 0799241993 | توظيف: hr@peekaboojor.com',
  '',

  // ═══ ESCALATION ═══════════════════════════════════════════════════════
  'تصعيد: شكاوى فعلية، إصابات، طبي، مجموعات كبيرة، سعر غير مؤكد.',
  'خصم ≠ شكوى. لا تخترع معلومات.'
].join('\n');

let _cachedStaticPrompt = null;
let _cachedStaticPromptExpiry = 0;

const getStaticPrompt = () => {
  const now = Date.now();
  if (!_cachedStaticPrompt || now > _cachedStaticPromptExpiry) {
    _cachedStaticPrompt = buildStaticSystemPrompt();
    _cachedStaticPromptExpiry = now + 60 * 60 * 1000; // rebuild hourly (in case ALLOWED_TOPICS changes)
  }
  return _cachedStaticPrompt;
};

const parseStrictJsonObject = (rawText) => {
  const text = String(rawText || '').trim();
  if (!text) return null;
  if (text.length > MAX_MODEL_JSON_CHARS) return null;
  if (!text.startsWith('{') || !text.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch (error) {
    return null;
  }
};

const sanitizeArabicReply = (value, maxChars) => {
  const safeMaxChars = Math.max(80, Number(maxChars) || 500);
  const text = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, safeMaxChars);

  if (!text) return '';
  const hasArabic = /[\u0600-\u06FF]/.test(text);
  return hasArabic ? text : '';
};

const JORDAN_TIME_ZONE = 'Asia/Amman';
const DEFAULT_OPENING_TIME = '10:00';
const DEFAULT_REGULAR_CLOSING_TIME = '23:00';
const SPECIAL_CLOSING_BY_DAY = {
  thursday: '24:00',
  friday: '24:00'
};

const normalizeTime24 = (value, fallback) => {
  const candidate = String(value || '').trim();
  const match = candidate.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return fallback;
  if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59) return fallback;
  if (hours === 24 && minutes !== 0) return fallback;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const time24ToMinutes = (time24) => {
  const normalized = normalizeTime24(time24, DEFAULT_OPENING_TIME);
  const [hours, minutes] = normalized.split(':').map(Number);
  return (hours * 60) + minutes;
};

const formatTimeArabic = (time24) => {
  const normalized = normalizeTime24(time24, DEFAULT_OPENING_TIME);
  if (normalized === '24:00') return '12:00 صباحًا';
  const [hours, minutes] = normalized.split(':').map(Number);
  const suffix = hours >= 12 ? 'م' : 'ص';
  const hour12 = ((hours + 11) % 12) + 1;
  return `${String(hour12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${suffix}`;
};

const getJordanNowParts = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: JORDAN_TIME_ZONE,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = String(lookup.weekday || '').toLowerCase();
  const hour = Number(lookup.hour || '0');
  const minute = Number(lookup.minute || '0');
  return {
    weekday,
    hour,
    minute,
    minutesNow: (hour * 60) + minute
  };
};

let _cachedFacts = null;
let _cachedFactsExpiry = 0;
const FACTS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const loadFacts = async () => {
  const now = Date.now();
  if (_cachedFacts && now < _cachedFactsExpiry) return _cachedFacts;

  const [hoursDoc, locationDoc, openingDoc, closingDoc, pricingDocs, plans, birthdayThemes] = await Promise.all([
    Settings.findOne({ key: 'whatsapp_hours' }).lean(),
    Settings.findOne({ key: 'whatsapp_location' }).lean(),
    Settings.findOne({ key: 'opening_time' }).lean(),
    Settings.findOne({ key: 'closing_time' }).lean(),
    Settings.find({
      key: {
        $in: ['hourly_1hr', 'hourly_2hr', 'hourly_3hr', 'hourly_extra_hr', 'extra_companion', 'sand_area_addon', 'transport_one_way']
      }
    }).lean(),
    SubscriptionPlan.find({ is_active: true }).sort({ price: 1 }).limit(5).lean(),
    Theme.find({ package_type: 'birthday', is_active: true }).sort({ price: 1 }).limit(5).lean()
  ]);

  const priceFacts = pricingDocs.map((doc) => `${doc.key}: ${doc.value}`).join(', ');
  const daycareFacts = plans.map((plan) => `${plan.name_ar || plan.name}: ${plan.price} د.أ`).join(' | ');
  const birthdayFacts = birthdayThemes.map((theme) => `${theme.name_ar || theme.name}: ${theme.price} د.أ`).join(' | ');

  const facts = {
    hours: String(hoursDoc?.value || ''),
    location: String(locationDoc?.value || ''),
    openingTime: normalizeTime24(openingDoc?.value, DEFAULT_OPENING_TIME),
    regularClosingTime: normalizeTime24(closingDoc?.value, DEFAULT_REGULAR_CLOSING_TIME),
    pricing: priceFacts,
    daycare: daycareFacts,
    birthday: birthdayFacts
  };

  _cachedFacts = facts;
  _cachedFactsExpiry = Date.now() + FACTS_CACHE_TTL_MS;
  return facts;
};

const buildApprovedFaqContext = (faqItems = []) => {
  if (!Array.isArray(faqItems) || faqItems.length === 0) return 'approved_faq_examples: none';

  const filteredItems = faqItems.filter((item) => String(item?.approved_answer_ar || '').trim().length > 0);
  if (!filteredItems.length) return 'approved_faq_examples: none';

  const lines = filteredItems.map((item, index) => {
    const variants = Array.isArray(item.question_variants) ? item.question_variants.filter(Boolean).join(' | ') : '';
    const shortFacts = Array.isArray(item.short_facts) ? item.short_facts.filter(Boolean).join(' | ') : '';

    return [
      `example_${index + 1}:`,
      `- category: ${item.category || 'general'}`,
      `- intent_key: ${item.intent_key || 'unknown'}`,
      `- question_variants: ${variants || 'n/a'}`,
      `- approved_answer_ar: ${item.approved_answer_ar || ''}`,
      `- short_facts: ${shortFacts || 'n/a'}`
    ].join('\n');
  });

  return ['approved_faq_examples:', ...lines].join('\n');
};

const getScopedAiFallbackReply = async ({ userText, maxChars = 500, conversationHistory = [], audioMediaId = null, imageMediaId = null, videoMediaId = null }) => {
  if (!process.env.GEMINI_API_KEY) {
    logAutoReplyAi('WA_BOT_AI_ROUTE', {
      route: 'ai_not_called',
      reason: 'missing_api_key'
    });
    return null;
  }

  try {
    logAutoReplyAi('WA_BOT_AI_ROUTE', {
      route: 'ai_call_started',
      model: TEXT_MODEL,
      hasHistory: Array.isArray(conversationHistory) && conversationHistory.length > 0
    });
    const [facts, approvedFaqExamples] = await Promise.all([
      loadFacts(),
      getApprovedFaqMemory({ queryText: userText, limit: 3 }).catch(() => [])
    ]);
    const approvedFaqContext = buildApprovedFaqContext(approvedFaqExamples);

    const historyTurns = conversationHistory
      .filter((m) => m.text && m.text.trim().length > 0)
      .map((m) => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.text.trim() }]
      }));

    const { getMetaMediaUrl, downloadMetaMedia } = require('./whatsappMedia');

    let currentTurnParts = [{ text: String(userText || '').trim() }];

    if (audioMediaId) {
      try {
        const mediaUrl = await getMetaMediaUrl(audioMediaId);
        if (mediaUrl) {
          const downloaded = await downloadMetaMedia(mediaUrl);
          if (downloaded.ok && downloaded.buffer) {
            const mimeType = downloaded.contentType || 'audio/ogg';
            const base64Audio = downloaded.buffer.toString('base64');
            currentTurnParts = [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Audio
                }
              },
              {
                text: 'هذي رسالة صوتية من زبون. استمع لها وفهم السؤال أو الطلب، ثم رد عليه بالعربي الأردني كـ شرومي من فريق بيكابو. لا تذكر إنك سمعت رسالة صوتية في ردك — رد مباشرة على المحتوى.'
              }
            ];
          }
        }
      } catch (audioErr) {
        console.warn('GEMINI_AUDIO_DOWNLOAD_ERROR', audioErr.message);
      }
    }

    if (imageMediaId) {
      try {
        const mediaUrl = await getMetaMediaUrl(imageMediaId);
        if (mediaUrl) {
          const downloaded = await downloadMetaMedia(mediaUrl);
          if (downloaded.ok && downloaded.buffer) {
            const mimeType = downloaded.contentType || 'image/jpeg';
            const base64Image = downloaded.buffer.toString('base64');
            const captionText = String(userText || '').trim();
            currentTurnParts = [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Image
                }
              },
              {
                text: captionText && captionText !== '[صورة من الزبون]'
                  ? `الزبون بعث هاي الصورة مع الرسالة: "${captionText}". شوف الصورة وافهم شو بده، ثم رد بالعربي الأردني كـ شرومي من فريق بيكابو. لا تذكر إنك شفت صورة — رد مباشرة على المحتوى.`
                  : 'الزبون بعث هاي الصورة بدون نص. شوف الصورة وافهم شو بده أو شو سؤاله، ثم رد بالعربي الأردني كـ شرومي من فريق بيكابو. لا تذكر إنك شفت صورة — رد مباشرة على المحتوى. إذا ما فهمت شو بده من الصورة، اسأله بلطف.'
              }
            ];
          }
        }
      } catch (imageErr) {
        console.warn('GEMINI_IMAGE_DOWNLOAD_ERROR', imageErr.message);
      }
    }

    if (videoMediaId) {
      try {
        const mediaUrl = await getMetaMediaUrl(videoMediaId);
        if (mediaUrl) {
          const downloaded = await downloadMetaMedia(mediaUrl);
          if (downloaded.ok && downloaded.buffer) {
            const mimeType = downloaded.contentType || 'video/mp4';
            const base64Video = downloaded.buffer.toString('base64');
            const captionText = String(userText || '').trim();
            currentTurnParts = [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Video
                }
              },
              {
                text: captionText && captionText !== '[فيديو من الزبون]'
                  ? `الزبون بعث هاي الفيديو مع الرسالة: "${captionText}". شوف الفيديو وافهم شو بده، ثم رد بالعربي الأردني كـ شرومي من فريق بيكابو. لا تذكر إنك شفت فيديو — رد مباشرة على المحتوى.`
                  : 'الزبون بعث هاي الفيديو بدون نص. شوف الفيديو وافهم شو بده أو شو سؤاله، ثم رد بالعربي الأردني كـ شرومي من فريق بيكابو. لا تذكر إنك شفت فيديو — رد مباشرة على المحتوى. إذا ما فهمت شو بده من الفيديو، اسأله بلطف.'
              }
            ];
          }
        }
      } catch (videoErr) {
        console.warn('GEMINI_VIDEO_DOWNLOAD_ERROR', videoErr.message);
      }
    }

    const currentTurn = { role: 'user', parts: currentTurnParts };

    const contents = [...historyTurns, currentTurn];

    const jordanNow = new Date().toLocaleString('ar-JO', {
      timeZone: JORDAN_TIME_ZONE,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    const jordanNowParts = getJordanNowParts();
    const todayClosingTime = SPECIAL_CLOSING_BY_DAY[jordanNowParts.weekday] || facts.regularClosingTime;
    const isOpenNow = jordanNowParts.minutesNow >= time24ToMinutes(facts.openingTime) &&
      jordanNowParts.minutesNow < time24ToMinutes(todayClosingTime);

    const dynamicContext = [
      `الوقت الحالي: ${jordanNow} (${String(jordanNowParts.hour).padStart(2, '0')}:${String(jordanNowParts.minute).padStart(2, '0')}، ${jordanNowParts.weekday})`,
      `business_hours_source_of_truth: {"timezone":"${JORDAN_TIME_ZONE}","schedule":{"sunday_to_wednesday_saturday":{"open":"10:00","close":"23:00"},"thursday_friday":{"open":"10:00","close":"24:00 (midnight)"}}}`,
      `today_schedule: {"day":"${jordanNowParts.weekday}","opening_time":"${facts.openingTime}","closing_time":"${todayClosingTime}","closing_time_ar":"${formatTimeArabic(todayClosingTime)}"}`,
      `open_now_state: {"is_open_now":${isOpenNow},"evaluated_at_time":"${String(jordanNowParts.hour).padStart(2, '0')}:${String(jordanNowParts.minute).padStart(2, '0')}","timezone":"${JORDAN_TIME_ZONE}"}`,
      `hours: ${facts.hours || 'unknown'}`,
      `location: ${facts.location || 'unknown'}`,
      `pricing: ${facts.pricing || 'unknown'}`,
      `daycare_plans: ${facts.daycare || 'unknown'}`,
      `birthday_packages: ${facts.birthday || 'unknown'}`,
      approvedFaqContext,
      'بيانات النظام تكمّل الحقائق الثابتة. إذا تعارضت: اتبع الحقائق الثابتة.',
      'لا تخمّن ساعات العمل من النص الحر إذا كانت business_hours_source_of_truth أو today_schedule موجودة.',
      'ما عرفت الإجابة: 0777775652 (عام) أو 0799241993 (أعياد/مدارس).',
      `الرد يجب أن لا يتجاوز ${Math.max(80, Number(maxChars) || 500)} حرف.`
    ].join('\n');

    const systemInstruction = getStaticPrompt() + '\n\n' + dynamicContext;

    const isMediaCall = Boolean(audioMediaId || imageMediaId || videoMediaId);
    const GEMINI_TIMEOUT_MS = isMediaCall ? 20000 : 12000;

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(TEXT_MODEL)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents,
            generationConfig: {
              temperature: 0,
              topP: 0.8,
              maxOutputTokens: 180,
              responseMimeType: 'application/json'
            }
          })
        }
      );
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!response.ok) {
      logAutoReplyAi('WA_BOT_AI_ROUTE', {
        route: 'ai_call_failed',
        reason: 'http_error',
        status: response.status
      });
      return null;
    }

    const payload = await response.json();
    const raw = payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('\n') || '';
    const parsed = parseStrictJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') {
      logAutoReplyAi('WA_BOT_AI_ROUTE', {
        route: 'ai_call_failed',
        reason: 'invalid_json_payload'
      });
      return null;
    }

    const topicRaw = String(parsed.topic || '').trim();
    const topic = ALLOWED_TOPICS.includes(topicRaw) || topicRaw === OUT_OF_SCOPE_TOPIC
      ? topicRaw
      : OUT_OF_SCOPE_TOPIC;
    const confidenceNumber = Number(parsed.confidence);
    const confidence = Number.isFinite(confidenceNumber)
      ? Math.max(0, Math.min(1, confidenceNumber))
      : 0;
    const inScope = parsed.in_scope === true && ALLOWED_TOPICS.includes(topic);
    const replyAr = sanitizeArabicReply(parsed.reply_ar, maxChars);

    const result = {
      in_scope: inScope,
      topic,
      confidence,
      reply_ar: replyAr
    };
    logAutoReplyAi('WA_BOT_AI_ROUTE', {
      route: 'ai_call_succeeded',
      inScope: result.in_scope,
      topic: result.topic,
      confidence: result.confidence,
      hasReply: Boolean(result.reply_ar)
    });
    return result;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('GEMINI_TIMEOUT', { model: TEXT_MODEL, isMediaCall: Boolean(audioMediaId || imageMediaId || videoMediaId), timeoutMs: (audioMediaId || imageMediaId || videoMediaId) ? 20000 : 12000 });
    } else {
      logAutoReplyAi('WA_BOT_AI_ROUTE', {
        route: 'ai_call_failed',
        reason: 'exception',
        error: error?.message || 'unknown_error'
      });
    }
    return null;
  }
};

const { checkAvailability, findOrMatchChild, createWhatsAppBooking } = require('./whatsappBookingService');

const BOOKING_KEYWORDS = ['احجز', 'حجز', 'اجلس', 'اشترك', 'ساعة', 'ساعتين', 'موعد', 'book', 'slot', 'reserve', 'أكد', 'اكد', 'نعم', 'تمام', 'ايوا', 'اي'];

const BOOKING_TOOLS = [
  {
    function_declarations: [
      {
        name: 'check_availability',
        description: 'Check if a play session slot is available at Peekaboo for a specific date and time',
        parameters: {
          type: 'OBJECT',
          properties: {
            date: { type: 'STRING', description: 'Date in YYYY-MM-DD format' },
            time: { type: 'STRING', description: 'Start time in HH:MM 24-hour format' },
            duration_hours: { type: 'NUMBER', description: 'Duration in hours (1 or 2)' }
          },
          required: ['date', 'time', 'duration_hours']
        }
      },
      {
        name: 'find_child',
        description: 'Find a registered child by name for the current WhatsApp customer',
        parameters: {
          type: 'OBJECT',
          properties: {
            child_name: { type: 'STRING', description: 'Child name or partial name in Arabic or English' }
          },
          required: ['child_name']
        }
      },
      {
        name: 'confirm_booking',
        description: 'Confirm and create a play session booking. Only call this when customer explicitly agrees to book.',
        parameters: {
          type: 'OBJECT',
          properties: {
            slot_id: { type: 'STRING', description: 'The slot ID returned from check_availability' },
            child_id: { type: 'STRING', description: 'The child ID returned from find_child' },
            duration_hours: { type: 'NUMBER', description: 'Duration in hours (1 or 2)' }
          },
          required: ['slot_id', 'child_id', 'duration_hours']
        }
      }
    ]
  }
];

const executeTool = async (functionName, args, senderWaId) => {
  switch (functionName) {
    case 'check_availability':
      return await checkAvailability(args.date, args.time, args.duration_hours || 1);
    case 'find_child':
      return await findOrMatchChild(senderWaId, args.child_name);
    case 'confirm_booking': {
      // Need userId from find_child — look it up
      const childResult = await findOrMatchChild(senderWaId, '');
      if (!childResult.userId) return { success: false, error: 'user_not_found' };
      return await createWhatsAppBooking(childResult.userId, args.child_id, args.slot_id, args.duration_hours || 1);
    }
    default:
      return { error: 'unknown_function' };
  }
};

const hasBookingIntent = (text, bookingState) => {
  if (bookingState && bookingState.step) return true; // Active booking conversation
  const normalized = String(text || '').toLowerCase();
  return BOOKING_KEYWORDS.some(kw => normalized.includes(kw));
};

const runBookingGeminiCall = async ({ systemInstruction, contents, senderWaId, bookingState, maxChars }) => {
  if (!process.env.GEMINI_API_KEY) return null;

  const bookingContext = bookingState && bookingState.step
    ? `\n\nبيانات الحجز الحالية: ${JSON.stringify(bookingState)}`
    : '';

  const bookingSystemPrompt = systemInstruction + bookingContext + `
\n\nأنت تقدر تحجز جلسات لعب للزبائن عبر واتساب.
- استخدم check_availability للتحقق من التوفر (التاريخ بصيغة YYYY-MM-DD، الوقت بصيغة HH:MM 24 ساعة)
- الحجز عبر واتساب متاح فقط من الساعة 2:00 الظهر (14:00) وبعدها. الأوقات الصباحية (10:00-13:59) غير متاحة عبر واتساب.
- إذا الزبون طلب وقت صباحي، قله إنه غير متاح عبر واتساب واقترح أوقات بعد الساعة 2 الظهر.
- لا تذكر أبداً أي سعر مخفض أو عرض صباحي أو Happy Hour. السعر دائماً: ساعة = 7 دنانير، ساعتين = 10 دنانير.
- استخدم find_child لإيجاد الطفل المسجل
- استخدم confirm_booking فقط لما الزبون يأكد بشكل صريح
- "بكرا" = التاريخ اللي بعد اليوم، "اليوم" = تاريخ اليوم
- الدفع كاش عند الوصول — اذكر هاد دائماً
- لا تؤكد الحجز بدون موافقة صريحة من الزبون (نعم، تمام، أكد، etc.)
- إذا الزبون ما ذكر الوقت، اسأله عن الوقت المفضل
- إذا عنده أكثر من طفل، اسأله أي طفل بده يحجزله`;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), 15000);

  try {
    let currentContents = [...contents];
    let maxToolRounds = 3;

    while (maxToolRounds > 0) {
      maxToolRounds--;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(TEXT_MODEL)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            system_instruction: { parts: [{ text: bookingSystemPrompt }] },
            contents: currentContents,
            tools: BOOKING_TOOLS,
            generationConfig: {
              temperature: 0,
              topP: 0.8,
              maxOutputTokens: 300
            }
          })
        }
      );

      if (!response.ok) {
        console.error('BOOKING_GEMINI_HTTP_ERROR', response.status);
        return null;
      }

      const payload = await response.json();
      const candidate = payload?.candidates?.[0];
      if (!candidate?.content?.parts) return null;

      const parts = candidate.content.parts;
      const functionCallPart = parts.find(p => p.functionCall);

      if (!functionCallPart) {
        // No function call — extract text reply
        const textReply = parts.map(p => p.text || '').join('').trim();
        if (textReply) {
          return {
            in_scope: true,
            topic: 'booking_help',
            confidence: 0.95,
            reply_ar: textReply.slice(0, Math.max(80, maxChars || 500))
          };
        }
        return null;
      }

      // Execute the function call
      const { name, args } = functionCallPart.functionCall;
      console.log('BOOKING_TOOL_CALL', { name, args });
      const toolResult = await executeTool(name, args || {}, senderWaId);
      console.log('BOOKING_TOOL_RESULT', { name, result: toolResult });

      // Update booking state
      if (name === 'check_availability' && toolResult.slotId) {
        bookingState.slotId = toolResult.slotId;
        bookingState.date = toolResult.date;
        bookingState.time = toolResult.time;
        bookingState.price = toolResult.price;
        bookingState.durationHours = toolResult.durationHours;
        bookingState.step = 'availability_checked';
      }
      if (name === 'find_child' && toolResult.found) {
        bookingState.childId = toolResult.childId;
        bookingState.childName = toolResult.childName;
        bookingState.step = 'child_found';
      }
      if (name === 'confirm_booking') {
        if (toolResult.success) {
          bookingState.step = 'completed';
          bookingState.bookingCode = toolResult.bookingCode;
        } else {
          bookingState.step = 'booking_failed';
        }
      }

      // Add model response + function result to conversation and continue
      currentContents.push({
        role: 'model',
        parts: [{ functionCall: { name, args } }]
      });
      currentContents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name,
            response: toolResult
          }
        }]
      });
    }

    return null; // Max rounds exceeded
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('BOOKING_GEMINI_TIMEOUT');
    } else {
      console.error('BOOKING_GEMINI_ERROR', err.message);
    }
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
};

module.exports = {
  getScopedAiFallbackReply,
  hasBookingIntent,
  runBookingGeminiCall,
  getStaticPrompt
};
