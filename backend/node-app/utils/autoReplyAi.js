const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const getTrimmedEnv = (name) => String(process.env[name] || '').trim();

const DEFAULT_TIMEOUT_MS = Number.parseInt(getTrimmedEnv('GEMINI_AUTO_REPLY_TIMEOUT_MS') || '6000', 10);
const DEFAULT_MODEL = getTrimmedEnv('GEMINI_AUTO_REPLY_MODEL') || getTrimmedEnv('GEMINI_TEXT_MODEL') || 'gemini-1.5-flash';

const SAFE_NO_ANSWER = {
  status: 'out_of_scope',
  answer: null,
  reason: 'no_answer'
};

const isArabicText = (value) => /[\u0600-\u06FF]/.test(String(value || ''));

const parseJsonStrict = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const buildPrompt = ({ messageText, businessContext }) => {
  const contextJson = JSON.stringify(businessContext || {}, null, 2);

  return [
    'أنت مساعد واتساب لنشاط Peekaboo فقط.',
    'المطلوب: تصنيف السؤال هل هو ضمن نطاق معلومات Peekaboo المتاحة في السياق أم لا.',
    'إذا كان ضمن النطاق وبثقة عالية فقط: أجب بإجابة عربية قصيرة جداً (جملة إلى جملتين).',
    'إذا كان خارج النطاق أو غير واضح أو ينقصه سياق أو توجد أي درجة شك: أرجع out_of_scope.',
    'ممنوع اختراع أسعار أو ساعات عمل أو موقع أو أي حقائق غير موجودة في السياق.',
    'ممنوع تقديم نصائح طبية أو قانونية أو أي موضوع غير متعلق بخدمات Peekaboo.',
    'مسموح فقط بصيغة JSON صالحة بدون أي نص إضافي.',
    'صيغة JSON المطلوبة حرفياً:',
    '{"classification":"in_scope"|"out_of_scope","confidence":"high"|"low","answer_ar":"..."}',
    'قواعد صارمة:',
    '- إذا classification = out_of_scope فلتكن answer_ar سلسلة فارغة.',
    '- إذا confidence ليست high فاعتبرها out_of_scope.',
    '- answer_ar يجب أن تكون عربية فقط ومختصرة جداً ودون روابط.',
    '',
    `رسالة العميل: ${JSON.stringify(String(messageText || '').trim())}`,
    `السياق التجاري المنظم: ${contextJson}`
  ].join('\n');
};

const generateAutoReplyFromGemini = async ({ messageText, businessContext }) => {
  const text = String(messageText || '').trim();
  if (!text) return { ...SAFE_NO_ANSWER, reason: 'empty_message' };

  const apiKey = getTrimmedEnv('GEMINI_API_KEY');
  const model = DEFAULT_MODEL;

  if (!apiKey || !model) {
    return { ...SAFE_NO_ANSWER, reason: 'gemini_not_configured' };
  }

  const timeoutMs = Number.isFinite(DEFAULT_TIMEOUT_MS) && DEFAULT_TIMEOUT_MS > 0 ? DEFAULT_TIMEOUT_MS : 6000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${GEMINI_API_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt({ messageText: text, businessContext }) }] }],
        generationConfig: {
          temperature: 0,
          topP: 0.1,
          maxOutputTokens: 120,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      return { ...SAFE_NO_ANSWER, reason: `gemini_http_${response.status}` };
    }

    const payload = await response.json();
    const modelText = payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('') || '';
    const parsed = parseJsonStrict(modelText);

    if (!parsed || typeof parsed !== 'object') {
      return { ...SAFE_NO_ANSWER, reason: 'invalid_model_json' };
    }

    const classification = typeof parsed.classification === 'string' ? parsed.classification.trim() : '';
    const confidence = typeof parsed.confidence === 'string' ? parsed.confidence.trim() : '';
    const answerAr = typeof parsed.answer_ar === 'string' ? parsed.answer_ar.trim() : '';

    const isInScope = classification === 'in_scope' && confidence === 'high';
    if (!isInScope) {
      return { ...SAFE_NO_ANSWER, reason: 'model_out_of_scope_or_uncertain' };
    }

    if (!answerAr || answerAr.length > 280 || !isArabicText(answerAr)) {
      return { ...SAFE_NO_ANSWER, reason: 'unsafe_or_non_arabic_answer' };
    }

    return {
      status: 'in_scope',
      answer: answerAr,
      reason: 'ok'
    };
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'gemini_timeout' : 'gemini_exception';
    return { ...SAFE_NO_ANSWER, reason };
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  generateAutoReplyFromGemini,
  SAFE_NO_ANSWER
};
