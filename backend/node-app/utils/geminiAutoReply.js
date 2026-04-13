const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-1.5-flash';

const parseGeminiJson = (rawText) => {
  const text = String(rawText || '').trim();
  if (!text) return null;

  const direct = text.match(/\{[\s\S]*\}/);
  if (!direct) return null;

  try {
    return JSON.parse(direct[0]);
  } catch (error) {
    return null;
  }
};

const getGeminiAutoReply = async ({ userText, maxChars = 260 }) => {
  if (!process.env.GEMINI_API_KEY) {
    return { inScope: false, confidence: 0, reply: '' };
  }

  const prompt = [
    'You classify and draft a short WhatsApp auto-reply for Peekaboo kids play center in Irbid, Jordan.',
    'Scope: hours, location, pricing, booking, birthday packages, daycare, age policy, parents area, transportation.',
    'Return JSON only with keys: in_scope (boolean), confidence (number 0..1), reply (string).',
    `Reply language: Arabic (Jordanian colloquial, Irbid accent). Keep under ${Math.max(40, Number(maxChars) || 260)} characters.`,
    'Tone: warm, friendly, playful, and concise. Use light emojis when suitable without overdoing them.',
    'If unsure or out of scope, set in_scope=false and reply="".',
    `User message: ${String(userText || '').trim()}`
  ].join('\n');

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(TEXT_MODEL)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 120,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      return { inScope: false, confidence: 0, reply: '' };
    }

    const payload = await response.json();
    const modelText = payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('\n') || '';
    const parsed = parseGeminiJson(modelText);
    if (!parsed) return { inScope: false, confidence: 0, reply: '' };

    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence || 0)));
    const reply = String(parsed.reply || '').trim();

    return {
      inScope: parsed.in_scope === true,
      confidence,
      reply
    };
  } catch (error) {
    return { inScope: false, confidence: 0, reply: '' };
  }
};

module.exports = {
  getGeminiAutoReply
};
