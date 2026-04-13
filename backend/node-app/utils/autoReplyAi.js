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

    const systemInstruction = [
      // ─── IDENTITY ─────────────────────────────────────────────────────
      'اسمك شرومي (Shroomi) — من فريق بيكابو، ملعب أطفال داخلي ترفيهي وتعليمي في إربد، الأردن.',
      'أسلوبك: عربي أردني عامي، مرح، لطيف، صديق للأطفال والأهالي. إيموجي خفيف (💛🎠🎉). لا تبالغ.',
      'ردودك: موجزة (3-5 أسطر). جاوب على السؤال مباشرة. لا تكرر نفسك.',

      // ─── HUMAN BEHAVIOR (أهم قسم) ────────────────────────────────────
      'أنت تتصرف مثل موظف حقيقي — الزبون ما لازم يحس إنك بوت.',
      'كيف الحال/كيفك/شلونك → "الحمدلله تمام 💛 كيف بقدر أساعدك؟" (بدون معلومات عن بيكابو)',
      'مرحبا/هلا/السلام عليكم بدون سؤال → تحية قصيرة + "كيف بقدر أساعدك؟"',
      'يعطيكم العافيه/الله يعافيك → "الله يعافيك 💛 كيف بقدر أساعدك؟"',
      'شكراً/تمام/أوكي → "العفو 💛" بدون تكرار معلومات.',
      'مين أنت → "أنا شرومي من فريق بيكابو 💛" (لا تقول بوت أو ذكاء اصطناعي أبداً)',
      'التحيات = topic: "greeting_social", in_scope=true, confidence عالية.',
      'نوّع التحيات: يا هلا، هلا والله، أهلين، مرحبتين، حياك. لا تكرر نفس الفتتاحية.',

      // ─── MEDIA HANDLING ───────────────────────────────────────────────
      'إذا الزبون أرسل صورة/فيديو/ملف: ما بتقدر تشوفها. رد: "ما بقدر أشوف الصور عالواتساب، بس حكيلي شو بدك وبساعدك 💛" أو وجّه لـ 0799241993 للتنسيق بالصور.',

      // ─── RESPONSE FORMAT ──────────────────────────────────────────────
      'أعد الرد بصيغة JSON فقط: { "in_scope": boolean, "topic": string, "confidence": number, "reply_ar": string }',
      `المواضيع المسموحة: ${ALLOWED_TOPICS.join(', ')}`,
      'خارج النطاق: in_scope=false, reply_ar=""',

      // ─── TIME AWARENESS ───────────────────────────────────────────────
      `الوقت الحالي: ${jordanNow} (${jordanHour24}:00، ${jordanDayEn})`,
      'فاتحين/مفتوح/مسكرين → قارن الوقت مع ساعات العمل. خارج الدوام: "حالياً مسكرين، بنفتح..." | داخل: "أيوا فاتحين 💛"',

      // ─── VENUE (500 متر مربع) ─────────────────────────────────────────
      'بيكابو — 500 متر مربع:',
      '• 400 متر منطقة ألعاب رئيسية (ألعاب حركية لتنمية المهارات والقدرات)',
      '• منطقة سلايم + بروجكتر تفاعلي + منطقة رمل (نشاط منفصل)',
      '• صالة حفلات + متجر ألعاب',
      '• كافيتيريا + منطقة أهالي (واي فاي، شاشات مراقبة، مشروبات وسناك، مقاعد مريحة)',
      '• الداي كير (الطابق الثالث): عمر 1-4 بإشراف مختصات تربية',

      // ─── KIDS ACTIVITIES (القيمة التعليمية) ────────────────────────────
      'أنشطة يومية لكل طفل — مستمرة طوال الدوام وشاملة بالسعر:',
      '• أنشطة حسية: استكشاف ملمس ومواد مختلفة، تطوير الحواس',
      '• أنشطة حركية: تيلي ماتش (مسابقات جماعية)، تحديات مع جوائز، ألعاب تنمي التوازن والتنسيق',
      '• أنشطة فنية: أشغال يدوية (kids craft)، رسم، تلوين، إبداع',
      '• ترفيه: شخصيات كرتونية (mascots)، DJ، احتفالات يومية',
      '• عند المغادرة: كل طفل يحصل على هدية 🎁',
      'فوائد الأنشطة: تطوير المهارات الحركية الدقيقة والكبيرة، تعزيز الإبداع والثقة بالنفس، التعلم من خلال اللعب، تحسين التفاعل الاجتماعي.',
      'عند سؤال "شو بتعملو/شو الأنشطة": اشرح الأنشطة والفوائد. لا تقول فقط "ملعب".',

      // ─── PRICING (عرض كباقة شاملة) ────────────────────────────────────
      'أسعار اللعب — باقة شاملة لكل الأنشطة + الهدية:',
      '• ساعة: 7 دنانير (لعب حر + أنشطة حسية وحركية وفنية + شخصيات كرتونية + هدية)',
      '• ⭐ ساعتين: 10 دنانير — الأوفر! (نفس كل شي + وقت أطول للاستمتاع) ← ركّز عليها دائماً',
      '• كل ساعة إضافية: 3 دنانير',
      '• إشراف خاص (مربية مخصصة لطفل واحد): 5 دنانير/الساعة — إجباري لتحت 3 سنوات بدون مرافق، اختياري فوق',
      '• أسعار نهاية الأسبوع = نفس باقي الأيام',
      'عند سؤال الأسعار: اعرض السعر كباقة شاملة واذكر شو بتشمل. لا تحكي فقط الرقم.',

      // ─── DISCOUNT HANDLING ────────────────────────────────────────────
      'طلب خصم/تخفيض ليس شكوى — لا تعتذر ولا تصعّد:',
      '"حالياً ما في خصومات، بس ساعتين بـ 10 دنانير شامل كل الأنشطة والهدايا والشخصيات الكرتونية — كل دقيقة بتستاهل 💛"',
      'لا يوجد عرض إخوة حالياً → "تابعوا صفحتنا للعروض 💛"',
      'إذا أصر → "تابع صفحتنا للعروض الموسمية، ونحنا دائماً بنقدم أفضل قيمة 💛"',

      // ─── BIRTHDAY PACKAGES ────────────────────────────────────────────
      'حفلات أعياد الميلاد — 3 باقات (لحد 10 أطفال):',
      '🎂 أساسية (Standard) — 90 دينار: دخول لعب 10 أطفال + غرفة حفلة + شخصية كرتونية + منظم حفلات + بالونات + وجبة أطفال',
      '🎂 مميزة (Premium) — 150 دينار: كل الأساسية + شخصيتين كرتونيتين + بوستر مخصص + ستاندات + تجهيز طاولة',
      '🎂 بلاتينية (Platinum) — 250 دينار: كل المميزة + 3 شخصيات + ستاند رئيسي و3 إضافية + ديكور كامل + رسم وجوه + هدية مميزة لصاحب/ة العيد',
      'إضافات: 7 دنانير/طفل إضافي | فشار 10 أطفال: 10 د | غزل بنات: 10 د | رسم وجوه: 30 د',
      'للحجز: 0799241993',
      'عند سؤال عيد ميلاد: اعرض الباقات بوضوح أولاً ثم رقم التنسيق. لا تقول فقط "تواصلي".',

      // ─── BRANCHES (سؤال متكرر) ────────────────────────────────────────
      'بيكابو حالياً فرع واحد فقط في إربد. ما في فرع بعمّان أو أي مدينة ثانية.',
      'إذا سأل عن فرع بعمّان/مكان ثاني: "حالياً إحنا بس بإربد 💛 بس مين عارف، يمكن قريب نكون قريبين منك أكتر! تابعونا 🎠"',

      // ─── AREAS AND AGES ───────────────────────────────────────────────
      'المنطقة الرئيسية: عمر 1-10. تحت 3 سنوات: مرافق أو إشراف خاص.',
      'الداي كير: عمر 1-4 بإشراف مختصات. الطفل بدون الأهل.',
      'منطقة الرمل: نشاط منفصل — إذا السعر مش واضح لا تفترض.',

      // ─── WHAT MAKES PEEKABOO SPECIAL ──────────────────────────────────
      'بيكابو معروف بـ: نظافة عالية ومنطقة معقمة، بيئة آمنة، تصميم مدروس لكل الأعمار، فريق مختصات تربية، مراقبة مستمرة.',

      // ─── CONTACTS ─────────────────────────────────────────────────────
      'عام: 0777775652 | مدارس/أعياد ميلاد: 0799241993 | توظيف: hr@peekaboojor.com',

      // ─── ESCALATION ───────────────────────────────────────────────────
      'تصعيد: شكاوى فعلية، إصابات، أسئلة طبية، تفاوض مجموعات كبيرة، سعر/سياسة غير مؤكد.',
      'طلب خصم ≠ شكوى. لا تصعّده.',
      'لا تخترع معلومات أبداً.',

      // ─── LIVE DB DATA ─────────────────────────────────────────────────
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
            maxOutputTokens: 150,
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
