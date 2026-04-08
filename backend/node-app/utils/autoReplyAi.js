const Settings = require('../models/Settings');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Theme = require('../models/Theme');

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
  'transportation'
];
const OUT_OF_SCOPE_TOPIC = 'out_of_scope';
const MAX_MODEL_JSON_CHARS = 4000;

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

const getScopedAiFallbackReply = async ({ userText, maxChars = 500, conversationHistory = [] }) => {
  if (!process.env.GEMINI_API_KEY) return null;

  try {
    const facts = await loadFacts();

    const historyTurns = conversationHistory
      .filter((m) => m.text && m.text.trim().length > 0)
      .map((m) => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.text.trim() }]
      }));

    const currentTurn = { role: 'user', parts: [{ text: String(userText || '').trim() }] };

    const contents = [...historyTurns, currentTurn];

    const systemInstruction = [
      'أنت مساعد واتساب لـ Peekaboo — ملعب داخلي للأطفال في إربد، الأردن.',
      'ردودك: عربية أردنية عامية، دافئة، موجزة (3-4 أسطر كحد أقصى).',
      'أعد الرد بصيغة JSON فقط: { "in_scope": boolean, "topic": string, "confidence": number, "reply_ar": string }',
      `المواضيع المسموحة: ${ALLOWED_TOPICS.join(', ')}`,
      'إذا كان السؤال خارج النطاق: in_scope=false, reply_ar=""',
      'حقائق ثابتة وملزمة (لا تغيّرها ولا تخترع غيرها):',
      '1) الأسعار: الأوفر ساعتين بـ 10 دنانير، ثم ساعة بـ 7 دنانير.',
      '2) لا يوجد عرض إخوة/أشقاء حالياً. عند سؤال العروض: "تابعوا صفحتنا للعروض".',
      '3) أسعار نهاية الأسبوع = نفس أسعار باقي الأيام.',
      '4) الأنشطة متاحة خلال ساعات الدوام.',
      '5) المنطقة الرئيسية (الطابق الثاني): عمر 1-10. أقل من 3 سنوات لا يُترك الطفل وحده ويجب وجود ولي أمر/مرافق.',
      '6) الداي كير (الطابق الثالث): عمر 1-4. الطفل يمكنه البقاء بدون وجود الأهل داخل القسم. الإشراف من مختصات تربية.',
      '7) تجربة الأهالي: جلسات + كافيه + متابعة عبر الشاشات/المراقبة الداخلية (بدون مبالغة تقنية).',
      '8) الاستفسارات العامة: 0777775652.',
      '9) المدارس وأعياد الميلاد: 0799241993.',
      '10) التوظيف والسير الذاتية: hr@peekaboojor.com.',
      '11) منطقة الرمل نشاط منفصل؛ إذا كان سعرها/إدراجها غير واضح من البيانات لا تفترض ووجّه للاستفسار.',
      'حدود تصعيد إلزامية: الشكاوى، الإصابات/السلامة التفصيلية، الأسئلة الطبية، تفاوض المدارس/المجموعات، تفاوض أعياد الميلاد، وأي سياسة/سعر غير مؤكد.',
      'في حالات التصعيد أو عدم اليقين: وجّه للرقم المناسب مباشرة وباختصار.',
      'البيانات المتغيرة من النظام (استخدمها فقط إذا لا تتعارض مع الحقائق الثابتة):',
      `hours: ${facts.hours || 'unknown'}`,
      `location: ${facts.location || 'unknown'}`,
      `pricing: ${facts.pricing || 'unknown'}`,
      `daycare_plans: ${facts.daycare || 'unknown'}`,
      `birthday_packages: ${facts.birthday || 'unknown'}`,
      'إذا تعارضت أي بيانات مع الحقائق الثابتة، اتبع الحقائق الثابتة.',
      'إذا لم تعرف الإجابة: 0777775652 (عام) أو 0799241993 (مدارس/أعياد ميلاد). لا تخترع معلومات.',
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
            maxOutputTokens: 220,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    if (!response.ok) return null;

    const payload = await response.json();
    const raw = payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('\n') || '';
    const parsed = parseStrictJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') return null;

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

    return {
      in_scope: inScope,
      topic,
      confidence,
      reply_ar: replyAr
    };
  } catch (error) {
    return null;
  }
};

module.exports = {
  getScopedAiFallbackReply
};
