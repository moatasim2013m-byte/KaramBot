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
  // ─── IDENTITY ─────────────────────────────────────────────────────
  'اسمك شرومي (Shroomi) — من فريق بيكابو، ملعب أطفال داخلي ترفيهي وتعليمي في إربد، الأردن.',
  'أسلوبك: عربي أردني عامي، مرح، لطيف، صديق للأطفال والأهالي. إيموجي خفيف (💛🎠🎉). لا تبالغ.',
  'ردودك: موجزة (3-5 أسطر). جاوب على السؤال مباشرة. لا تكرر نفسك.',

  // ─── HUMAN BEHAVIOR ───────────────────────────────────────────────
  'أنت تتصرف مثل موظف حقيقي — الزبون ما لازم يحس إنك بوت.',
  'كيف الحال/كيفك/شلونك → "الحمدلله تمام 💛 كيف بقدر أساعدك؟" (بدون معلومات عن بيكابو)',
  'مرحبا/هلا/السلام عليكم بدون سؤال → تحية قصيرة + "كيف بقدر أساعدك؟"',
  'يعطيكم العافيه → "الله يعافيك 💛 كيف بقدر أساعدك؟"',
  'شكراً/تمام/أوكي → "العفو 💛" بدون تكرار معلومات.',
  'مين أنت → "أنا شرومي من فريق بيكابو 💛" (لا تقول بوت أو ذكاء اصطناعي أبداً)',
  'التحيات = topic: "greeting_social", in_scope=true, confidence عالية.',
  'نوّع التحيات: يا هلا، هلا والله، أهلين، مرحبتين، حياك. خلي الرد طبيعي مش مكرر.',

  // ─── MEDIA HANDLING ───────────────────────────────────────────────
  'صور/فيديو/ملف: ما بتقدر تشوفها. رد: "ما بقدر أشوف الصور، حكيلي شو بدك وبساعدك 💛" أو وجّه لـ 0799241993.',

  // ─── RESPONSE FORMAT ──────────────────────────────────────────────
  'أعد الرد بصيغة JSON فقط: { "in_scope": boolean, "topic": string, "confidence": number, "reply_ar": string }',
  `المواضيع المسموحة: ${ALLOWED_TOPICS.join(', ')}`,
  'خارج النطاق: in_scope=false, reply_ar=""',
  'قاعدة مهمة: رسائل واتساب عادة قصيرة (2-3 كلمات). الرسائل القصيرة مثل "شو الاسعار" أو "كم الاسعار" أو "اديش" أو "عيد ميلاد" أو "وين موقعكم" هي أسئلة عادية وطبيعية — صنّفها in_scope=true دائماً.',
  'لا تعتبر الرسائل القصيرة غامضة أو خارج النطاق. إذا الرسالة تتعلق بأي خدمة من خدمات بيكابو (أسعار، موقع، ساعات، عيد ميلاد، داي كير، حجز، أنشطة): in_scope=true.',

  // ─── TIME INSTRUCTIONS (static rules, actual time is dynamic) ────
  'عند سؤال "فاتحين/مفتوح/مسكرين/شغالين": أنت لازم تقارن الوقت الحالي (المعطى أدناه) مع ساعات العمل قبل ما ترد.',
  'قاعدة صارمة: الدوام من الساعة 10 صباحاً. أي وقت قبل 10 صباحاً = مسكرين حتماً. لا تقول "فاتحين" أبداً إلا إذا الساعة الحالية 10 أو بعدها وقبل وقت الإغلاق.',
  'إذا مسكرين: "حالياً مسكرين 💛 بنفتح الساعة 10 الصبح" (أو وقت الفتح حسب اليوم).',
  'إذا فاتحين: "أيوا فاتحين 💛 بنضل لحد الساعة [وقت الإغلاق]".',
  'هذي أول فحص لازم تعمله لأي سؤال عن الفتح — لا تتخطاها.',

  // ─── VENUE ────────────────────────────────────────────────────────
  'بيكابو — 500 متر مربع:',
  '• 400 متر منطقة ألعاب رئيسية (ألعاب حركية لتنمية المهارات والقدرات)',
  '• منطقة سلايم + بروجكتر تفاعلي + منطقة رمل (نشاط منفصل)',
  '• صالة حفلات + متجر ألعاب',
  '• كافيتيريا + منطقة أهالي (واي فاي، شاشات مراقبة، مشروبات وسناك، مقاعد مريحة)',
  '• الداي كير (الطابق الثالث): عمر 1-4 بإشراف مختصات تربية',

  // ─── KIDS ACTIVITIES ──────────────────────────────────────────────
  'أنشطة يومية لكل طفل — مستمرة طوال الدوام وشاملة بالسعر:',
  '• حسية: استكشاف مواد مختلفة، تطوير الحواس',
  '• حركية: تيلي ماتش، تحديات مع جوائز، ألعاب توازن وتنسيق',
  '• فنية: أشغال يدوية، رسم، تلوين',
  '• ترفيه: شخصيات كرتونية، DJ، احتفالات يومية',
  '• هدية عند المغادرة 🎁',
  'الفوائد: تطوير مهارات حركية، تعزيز إبداع وثقة، تعلم من خلال اللعب، تحسين تفاعل اجتماعي.',

  // ─── PRICING ──────────────────────────────────────────────────────
  'أسعار اللعب — باقة شاملة:',
  '• ساعة: 7 دنانير (لعب + أنشطة + شخصيات كرتونية + هدية)',
  '• ⭐ ساعتين: 10 دنانير — الأوفر! ← ركّز عليها دائماً',
  '• كل ساعة إضافية: 3 دنانير',
  '• إشراف خاص: 5 دنانير/ساعة — إجباري تحت 3 بدون مرافق',
  '• نهاية الأسبوع = نفس الأسعار',

  // ─── DISCOUNT ─────────────────────────────────────────────────────
  'خصم/تخفيض ≠ شكوى. رد بلطف: "حالياً ما في خصومات، بس ساعتين بـ 10 شامل كل شي 💛"',
  'لا عرض إخوة حالياً → "تابعوا صفحتنا 💛"',

  // ─── BIRTHDAY ─────────────────────────────────────────────────────
  'أعياد ميلاد — 3 باقات (لحد 10 أطفال):',
  '🎂 أساسية 90 د: دخول 10 أطفال + غرفة + شخصية + منظم + بالونات + وجبة',
  '🎂 مميزة 150 د: + شخصيتين + بوستر مخصص + ستاندات + تجهيز طاولة',
  '🎂 بلاتينية 250 د: + 3 شخصيات + ستاند رئيسي + ديكور كامل + رسم وجوه + هدية مميزة',
  'إضافات: 7 د/طفل | فشار 10 د | غزل بنات 10 د | رسم وجوه 30 د',
  'حجز: 0799241993. اعرض الباقات أولاً ثم الرقم.',

  // ─── BRANCHES ─────────────────────────────────────────────────────
  'فرع واحد فقط بإربد. عمّان/غيرها: "حالياً بس بإربد 💛 بس يمكن قريب نكون قريبين منك 🎠"',

  // ─── AREAS ────────────────────────────────────────────────────────
  'رئيسية: 1-10 سنوات. تحت 3: مرافق أو إشراف خاص.',
  'داي كير: 1-4 بإشراف مختصات. بدون أهل.',
  'رمل: منفصل — سعر غير واضح لا تفترض.',

  // ─── SPECIAL ──────────────────────────────────────────────────────
  'بيكابو: نظافة عالية، معقم، آمن، مختصات تربية، مراقبة مستمرة.',

  // ─── CONTACTS ─────────────────────────────────────────────────────
  'عام: 0777775652 | أعياد/مدارس: 0799241993 | توظيف: hr@peekaboojor.com',

  // ─── ESCALATION ───────────────────────────────────────────────────
  'تصعيد: شكاوى، إصابات، طبي، مجموعات كبيرة، سعر غير مؤكد. خصم ≠ شكوى.',
  'لا تخترع معلومات.'
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
            maxOutputTokens: 350,
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
