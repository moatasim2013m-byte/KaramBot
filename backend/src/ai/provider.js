/**
 * AI Provider Adapter
 * Supports Gemini and OpenAI. Switch via AI_PROVIDER env var.
 */

async function callGemini(systemPrompt, userMessage) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `${systemPrompt}\n\nرسالة العميل: ${userMessage}`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function callOpenAI(systemPrompt, userMessage, history = []) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    temperature: 0.5,
    max_tokens: 600,
  });

  return response.choices[0].message.content;
}

/**
 * Main AI call function - routes to correct provider
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {Array} history - optional message history for OpenAI
 * @returns {Promise<string>} AI response text
 */
async function generateAIReply(systemPrompt, userMessage, history = []) {
  const provider = process.env.AI_PROVIDER || 'gemini';

  try {
    if (provider === 'openai') {
      return await callOpenAI(systemPrompt, userMessage, history);
    }
    return await callGemini(systemPrompt, userMessage);
  } catch (err) {
    console.error(`AI [${provider}] error:`, err.message);
    throw err;
  }
}

/**
 * Extract structured JSON from AI response
 * Returns parsed object or null
 */
function extractJSON(text) {
  try {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/) ||
                  text.match(/\{[\s\S]*\}/);
    const jsonStr = match ? (match[1] || match[0]) : text;
    return JSON.parse(jsonStr.trim());
  } catch {
    return null;
  }
}

module.exports = { generateAIReply, extractJSON };
