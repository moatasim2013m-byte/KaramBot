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
  'فاتحين/مسكرين: قارن الوقت الحالي (أدناه) مع ساعات العمل. الدوام من 10 صباحاً.',
  'قاعدة ثابتة: يومي الخميس والجمعة الإغلاق الساعة 12:00 ص (منتصف الليل).',
  'قبل 10 = مسكرين حتماً → "حالياً مسكرين 💛 بنفتح الساعة 10".',
  'داخل الدوام → "أيوا فاتحين 💛 بنضل لحد [وقت الإغلاق]".',
  '',

  // ═══ VENUE (500م²) ════════════════════════════════════════════════════
  'بيكابو 500م²: 400م ألعاب حركية + سلايم + بروجكتر تفاعلي + رمل (منفصل) + صالة حفلات + متجر ألعاب + كافيتيريا + منطقة أهالي (واي فاي، شاشات مراقبة، مشروبات، مقاعد مريحة) + داي كير (1-4 سنوات، إشراف مختصات).',
  '',

  // ═══ ACTIVITIES ═══════════════════════════════════════════════════════
  'أنشطة يومية شاملة بالسعر (من الفتح للإغلاق):',
  'حسية (استكشاف مواد) + حركية (تيلي ماتش، تحديات، جوائز) + فنية (أشغال يدوية، رسم) + ترفيه (شخصيات كرتونية، DJ، احتفالات) + هدية عند المغادرة 🎁.',
  'الفوائد: تطوير مهارات حركية، إبداع، ثقة، تفاعل اجتماعي، تعلم من خلال اللعب.',
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
  'لا عرض إخوة → "تابعوا صفحتنا للعروض 💛"',
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

  // ═══ AREAS ════════════════════════════════════════════════════════════
  'رئيسية: 1-10 سنوات. تحت 3: مرافق أو إشراف خاص.',
  'داي كير: 1-4 بإشراف مختصات. بدون أهل.',
  'رمل: منفصل — سعر مش واضح لا تفترض.',
  '',

  // ═══ SPECIAL ══════════════════════════════════════════════════════════
  'بيكابو: نظافة عالية، معقم، آمن، مختصات تربية، مراقبة مستمرة.',
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

const loadFacts = async () => {
  const [hoursDoc, locationDoc, pricingDocs, plans, birthdayThemes] = await Promise.all([
    Settings.findOne({ key: 'whatsapp_hours' }).lean(),
    Settings.findOne({ key: 'whatsapp_location' }).lean(),
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

  return {
    hours: String(hoursDoc?.value || ''),
    location: String(locationDoc?.value || ''),
    pricing: priceFacts,
    daycare: daycareFacts,
    birthday: birthdayFacts
  };
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

const getScopedAiFallbackReply = async ({ userText, maxChars = 500, conversationHistory = [] }) => {
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

    const currentTurn = { role: 'user', parts: [{ text: String(userText || '').trim() }] };

    const contents = [...historyTurns, currentTurn];

    const jordanNow = new Date().toLocaleString('ar-JO', {
      timeZone: 'Asia/Amman',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    const jordanHour24 = parseInt(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Amman', hour: 'numeric', hour12: false }),
      10
    );
    const jordanDayEn = new Date().toLocaleString('en-US', { timeZone: 'Asia/Amman', weekday: 'long' }).toLowerCase();

    const dynamicContext = [
      `الوقت الحالي: ${jordanNow} (${jordanHour24}:00، ${jordanDayEn})`,
      `hours: ${facts.hours || 'unknown'}`,
      `location: ${facts.location || 'unknown'}`,
      `pricing: ${facts.pricing || 'unknown'}`,
      `daycare_plans: ${facts.daycare || 'unknown'}`,
      `birthday_packages: ${facts.birthday || 'unknown'}`,
      approvedFaqContext,
      'بيانات النظام تكمّل الحقائق الثابتة. إذا تعارضت: اتبع الحقائق الثابتة.',
      'ما عرفت الإجابة: 0777775652 (عام) أو 0799241993 (أعياد/مدارس).',
      `الرد يجب أن لا يتجاوز ${Math.max(80, Number(maxChars) || 500)} حرف.`
    ].join('\n');

    const systemInstruction = getStaticPrompt() + '\n\n' + dynamicContext;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(TEXT_MODEL)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    logAutoReplyAi('WA_BOT_AI_ROUTE', {
      route: 'ai_call_failed',
      reason: 'exception',
      error: error?.message || 'unknown_error'
    });
    return null;
  }
};

module.exports = {
  getScopedAiFallbackReply
};
