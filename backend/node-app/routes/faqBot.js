const express = require('express');
const Settings = require('../models/Settings');
const Theme = require('../models/Theme');
const SubscriptionPlan = require('../models/SubscriptionPlan');

const router = express.Router();

const FAQ_ITEMS = [
  {
    key: 'hours',
    answer: 'متوفرين يوميًا ما عدا الجمعة والسبت. للاستفسار والتسجيل: 0777775652.',
    keywords: ['ساعات', 'الدوام', 'متى', 'تفتح', 'تغلق', 'hours', 'open']
  },
  {
    key: 'prices',
    answer: 'الأسعار الحالية: ساعة واحدة متوفرة، وساعتين بـ 10 دينار. باقات أعياد الميلاد تبدأ من 90 دينار وتصل إلى 250 دينار. باقات الاشتراك: 250، 200، 150، 99، 79 دينار.',
    keywords: ['سعر', 'الاسعار', 'الأسعار', 'price', 'pricing', 'تكلفة']
  },
  {
    key: 'location',
    answer: 'نخدمكم في الأردن - الزرقاء الجديدة. تواصلوا معنا على 0777775652 لإرسال الموقع بالتفصيل.',
    keywords: ['موقع', 'العنوان', 'وين', 'location', 'address', 'جدة']
  },
  {
    key: 'booking',
    answer: 'يمكنكم الحجز مباشرة من الموقع أو عبر التواصل على الرقم 0777775652، وسيتم تأكيد الحجز من فريقنا.',
    keywords: ['حجز', 'احجز', 'الحجز', 'booking', 'book']
  },
  {
    key: 'cancellation',
    answer: 'سياسة الاسترجاع تعتمد على وقت الإلغاء ونوع الحجز. تواصلوا معنا على 0777775652 وسنخدمكم حسب الحالة.',
    keywords: ['إلغاء', 'الغاء', 'استرجاع', 'استرداد', 'refund', 'cancel', 'cancellation']
  },
  {
    key: 'socks_policy',
    answer: 'يرجى ارتداء الجوارب للأطفال أثناء اللعب للمحافظة على السلامة والنظافة.',
    keywords: ['جوارب', 'شرابات', 'socks', 'sock']
  }
];

const normalizeText = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (value) => normalizeText(value).split(' ').filter(Boolean);

const scoreKnowledgeItem = (query, item) => {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return 0;

  const searchableText = normalizeText([item.title, item.answer, ...(item.keywords || [])].join(' '));
  const keywordText = normalizeText((item.keywords || []).join(' '));

  return queryTokens.reduce((score, token) => {
    if (keywordText.includes(token)) return score + 4;
    if (searchableText.includes(token)) return score + 2;
    return score;
  }, 0);
};

const toPriceText = (price) => {
  if (typeof price !== 'number') return null;
  return `${price.toFixed(2)} ريال`;
};

const buildDynamicKnowledgeBase = async () => {
  const [themes, plans, settingsDocs] = await Promise.all([
    Theme.find({ is_active: true }).sort({ price: 1 }).limit(12).lean(),
    SubscriptionPlan.find({ is_active: true }).sort({ price: 1 }).limit(12).lean(),
    Settings.find({ key: { $in: ['working_hours', 'location', 'phone', 'email', 'refund_policy'] } }).lean()
  ]);

  const knowledge = [];

  themes.forEach((theme) => {
    const themeName = theme.name_ar || theme.name;
    knowledge.push({
      key: `theme_${theme._id}`,
      title: `ثيم ${themeName}`,
      keywords: ['ثيم', 'عيد ميلاد', themeName, theme.name, 'theme', 'birthday'],
      answer: `${themeName}: ${theme.description_ar || theme.description || 'ثيم مميز لحفلات الأطفال.'}${
        toPriceText(theme.price) ? ` السعر يبدأ من ${toPriceText(theme.price)}.` : ''
      }`
    });
  });

  plans.forEach((plan) => {
    const planName = plan.name_ar || plan.name;
    const visitsText = plan.visits ? ` يشمل ${plan.visits} زيارة.` : '';
    knowledge.push({
      key: `plan_${plan._id}`,
      title: `باقة ${planName}`,
      keywords: ['باقة', 'اشتراك', 'تذاكر', planName, plan.name, 'plan', 'subscription'],
      answer: `${planName}: ${plan.description_ar || plan.description || 'باقة مناسبة للأطفال والعائلة.'}${visitsText}${
        toPriceText(plan.price) ? ` السعر ${toPriceText(plan.price)}.` : ''
      }`
    });
  });

  settingsDocs.forEach((setting) => {
    if (setting.key === 'working_hours') {
      knowledge.push({
        key: 'working_hours_dynamic',
        title: 'ساعات العمل',
        keywords: ['ساعات', 'دوام', 'متى', 'تفتح', 'تغلق', 'working hours'],
        answer: `ساعات العمل الحالية: ${String(setting.value)}.`
      });
    }

    if (setting.key === 'location') {
      knowledge.push({
        key: 'location_dynamic',
        title: 'الموقع',
        keywords: ['الموقع', 'العنوان', 'وين', 'location', 'address'],
        answer: `الموقع الحالي: ${String(setting.value)}.`
      });
    }

    if (setting.key === 'phone') {
      knowledge.push({
        key: 'phone_dynamic',
        title: 'الهاتف',
        keywords: ['جوال', 'هاتف', 'رقم', 'اتصال', 'phone', 'contact'],
        answer: `رقم التواصل: ${String(setting.value)}.`
      });
    }

    if (setting.key === 'email') {
      knowledge.push({
        key: 'email_dynamic',
        title: 'البريد الإلكتروني',
        keywords: ['ايميل', 'بريد', 'email', 'mail'],
        answer: `البريد الإلكتروني للتواصل: ${String(setting.value)}.`
      });
    }

    if (setting.key === 'refund_policy') {
      knowledge.push({
        key: 'refund_policy_dynamic',
        title: 'سياسة الاسترجاع',
        keywords: ['سياسة', 'استرجاع', 'الغاء', 'refund', 'cancel'],
        answer: `سياسة الاسترجاع الحالية: ${String(setting.value)}.`
      });
    }
  });

  return knowledge;
};

router.get('/faq', async (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase();

  if (!query) {
    return res.json({
      answer: 'اكتب سؤالك أو اختر أحد الأزرار السريعة وسأساعدك فورًا.',
      matchedKey: 'default'
    });
  }

  let knowledgeBase = FAQ_ITEMS;

  try {
    const dynamicKnowledge = await buildDynamicKnowledgeBase();
    knowledgeBase = [...FAQ_ITEMS, ...dynamicKnowledge];
  } catch (error) {
    console.error('[FAQ_BOT] Failed to load dynamic knowledge:', error.message);
  }

  const matched = knowledgeBase
    .map((item) => ({ item, score: scoreKnowledgeItem(query, item) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!matched || matched.score < 2) {
    return res.json({
      answer:
        'عذرًا، ما فهمت سؤالك بشكل كامل. جرّب سؤالًا عن الأسعار، الموقع، ساعات الدوام، الباقات، أعياد الميلاد أو سياسة الاسترجاع. ويمكنك كتابة السؤال بتفاصيل أكثر.',
      matchedKey: 'fallback'
    });
  }

  return res.json({
    answer: matched.item.answer,
    matchedKey: matched.item.key
  });
});

module.exports = router;
