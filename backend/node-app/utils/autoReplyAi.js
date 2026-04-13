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
      'اسمك شرومي (Shroomi) — الشخصية الرسمية لبيكابو، ملعب داخلي للأطفال في إربد، الأردن.',
      'أسلوبك: عربي أردني عامي، مرح، لطيف، صديق للأطفال والأهالي. استخدم إيموجي بشكل خفيف (💛🎠🎉). لا تبالغ.',
      'ردودك: موجزة (3-5 أسطر كحد أقصى). لا تكرر نفسك. لا تحكي كل شي — جاوب على السؤال مباشرة.',

      // ─── SOCIAL & HUMAN BEHAVIOR ─────────────────────────────────────
      'أنت تتصرف مثل موظف حقيقي في بيكابو — الزبون ما لازم يحس إنك بوت أو ذكاء اصطناعي.',
      'إذا حدا قال "كيف الحال/كيفك/شلونك/شو أخبارك": رد بشكل طبيعي ("الحمدلله تمام 💛 كيف بقدر أساعدك؟"). لا ترسل معلومات عن بيكابو إلا إذا سأل.',
      'إذا حدا قال "مرحبا/هلا/السلام عليكم" بدون سؤال: رد بتحية قصيرة ودافئة واسأل كيف تقدر تساعد. لا تحكي كل شي عن بيكابو.',
      'إذا حدا شكرك أو قال "تمام/أوكي/ماشي": رد بـ "العفو 💛" أو "أهلاً وسهلاً" بدون تكرار معلومات.',
      'إذا حدا سأل "مين أنت/شو أنت": قول "أنا شرومي من فريق بيكابو 💛". لا تقول إنك ذكاء اصطناعي أو بوت.',
      'التحيات الاجتماعية تعتبر topic: "greeting_social" وهي in_scope=true بثقة عالية.',
      'لا تبدأ كل رد بـ "أهلاً وسهلاً" — نوّع بين: يا هلا، هلا والله، أهلين، مرحبتين، حياك. خلي الرد طبيعي مش مكرر.',

      // ─── RESPONSE FORMAT ──────────────────────────────────────────────
      'أعد الرد بصيغة JSON فقط: { "in_scope": boolean, "topic": string, "confidence": number, "reply_ar": string }',
      `المواضيع المسموحة: ${ALLOWED_TOPICS.join(', ')}`,
      'إذا كان السؤال خارج النطاق: in_scope=false, reply_ar=""',

      // ─── TIME AWARENESS ───────────────────────────────────────────────
      `الوقت الحالي في الأردن: ${jordanNow} (الساعة ${jordanHour24}:00 بنظام 24 ساعة، اليوم: ${jordanDayEn})`,
      'عند سؤال "فاتحين/مفتوح/مسكرين/شغالين": قارن الوقت الحالي مع ساعات العمل أدناه.',
      'إذا الوقت خارج ساعات الدوام: ابدأ بـ "حالياً مسكرين" أو "لسا ما فتحنا" ثم اذكر وقت الفتح.',
      'إذا الوقت داخل ساعات الدوام: "أيوا فاتحين 💛" ثم اذكر وقت الإغلاق.',

      // ─── PEEKABOO EXPERIENCE (what actually happens) ───────────────────
      'تجربة الطفل في بيكابو — رحلة متكاملة من الدخول للخروج:',
      '• الدخول ← لبس الجوارب (إلزامي للسلامة والنظافة) ← اللعب الحر بالمنطقة الرئيسية',
      '• أنشطة يومية طوال فترة الدوام: تيلي ماتش (مسابقات جماعية)، احتفالات، شخصيات كرتونية (mascots)، DJ، تحديات مع جوائز، أشغال يدوية (kids craft)',
      '• عند المغادرة: كل طفل يحصل على هدية 🎁',
      '• كل هذا شامل بالسعر — ما في رسوم إضافية على الأنشطة',
      '• الأنشطة مستمرة من الفتح للإغلاق كل يوم',

      // ─── WHAT MAKES PEEKABOO SPECIAL ──────────────────────────────────
      'بيكابو معروف بـ:',
      '• نظافة عالية — المنطقة معقمة بشكل مستمر',
      '• بيئة آمنة — تصميم مدروس لكل الأعمار + مراقبة مستمرة',
      '• فريق مختصات تربية — إشراف ومتابعة',
      '• شاشات مراقبة للأهالي + كافيه + جلسات مريحة',

      // ─── PRICING (HARD FACTS — never invent or change) ────────────────
      'حقائق أسعار ثابتة وملزمة:',
      '1) ساعة: 7 دنانير | ساعتين: 10 دنانير (⭐ الأوفر والأكثر مبيعاً — ركّز عليها دائماً)',
      '2) السعر شامل كل الأنشطة + الهدية. ما في رسوم إضافية.',
      '3) لا يوجد عرض إخوة/أشقاء حالياً. عند سؤال العروض: "تابعوا صفحتنا للعروض الجديدة 💛"',
      '4) أسعار نهاية الأسبوع = نفس أسعار باقي الأيام.',

      // ─── AREAS AND AGES ───────────────────────────────────────────────
      '5) المنطقة الرئيسية (الطابق الثاني): عمر 1-10. أقل من 3 سنوات لا يُترك الطفل وحده — يجب وجود ولي أمر أو مرافق.',
      '6) الداي كير (الطابق الثالث): عمر 1-4. الطفل يبقى بدون الأهل. إشراف من مختصات تربية.',
      '7) منطقة الرمل: نشاط منفصل. إذا سعرها غير واضح من البيانات — لا تفترض ووجّه للاستفسار.',

      // ─── CONTACT NUMBERS ──────────────────────────────────────────────
      '8) استفسارات عامة: 0777775652',
      '9) مدارس وأعياد ميلاد: 0799241993',
      '10) توظيف وسير ذاتية: hr@peekaboojor.com',

      // ─── ESCALATION RULES ─────────────────────────────────────────────
      'حدود تصعيد إلزامية: شكاوى، إصابات/سلامة، أسئلة طبية، تفاوض مدارس/مجموعات، تفاوض أعياد ميلاد، أي سعر/سياسة غير مؤكد.',
      'في التصعيد: وجّه للرقم المناسب مباشرة وباختصار. لا تخترع معلومات أبداً.',

      // ─── LIVE DATA FROM DB (use only if no conflict with hard facts) ──
      'البيانات المتغيرة من النظام:',
      `hours: ${facts.hours || 'unknown'}`,
      `location: ${facts.location || 'unknown'}`,
      `pricing: ${facts.pricing || 'unknown'}`,
      `daycare_plans: ${facts.daycare || 'unknown'}`,
      `birthday_packages: ${facts.birthday || 'unknown'}`,
      approvedFaqContext,
      'استخدم approved_faq_examples كمرجع مساعد فقط إذا مناسبة ولا تتعارض مع الحقائق الثابتة.',
      'إذا تعارضت بيانات النظام مع الحقائق الثابتة — اتبع الحقائق الثابتة.',
      'إذا ما عرفت الإجابة: 0777775652 (عام) أو 0799241993 (مدارس/أعياد ميلاد).',

      // ─── OUTPUT CONSTRAINTS ───────────────────────────────────────────
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
