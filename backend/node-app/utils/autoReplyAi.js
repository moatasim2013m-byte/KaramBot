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

const parseJsonObject = (rawText) => {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (error) {
    return null;
  }
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

const getScopedAiFallbackReply = async ({ userText, maxChars = 500 }) => {
  if (!process.env.GEMINI_API_KEY) return null;

  try {
    const facts = await loadFacts();
    const prompt = [
      'You are a strict classifier+responder for Peekaboo WhatsApp auto reply.',
      'Return STRICT JSON only with keys exactly:',
      'in_scope (boolean), topic (string), confidence (number), reply_ar (string).',
      `Allowed topics only: ${ALLOWED_TOPICS.join(', ')}`,
      'If uncertain OR outside scope, set in_scope=false, topic="out_of_scope", confidence<=0.4, reply_ar="".',
      'Hard out-of-scope categories: medical, legal, religion, politics, unrelated parenting advice, unrelated general knowledge.',
      'Use only these business facts when relevant and do not invent unavailable details.',
      `hours: ${facts.hours || 'unknown'}`,
      `location: ${facts.location || 'unknown'}`,
      `pricing: ${facts.pricing || 'unknown'}`,
      `daycare_plans: ${facts.daycare || 'unknown'}`,
      `birthday_packages: ${facts.birthday || 'unknown'}`,
      `Reply must be Arabic and <= ${Math.max(80, Number(maxChars) || 500)} chars.`,
      `Customer message: ${String(userText || '').trim()}`
    ].join('\n');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(TEXT_MODEL)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
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
    const parsed = parseJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const inScope = parsed.in_scope === true;
    const topic = String(parsed.topic || '').trim();
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence || 0)));
    const replyAr = String(parsed.reply_ar || '').trim();

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
