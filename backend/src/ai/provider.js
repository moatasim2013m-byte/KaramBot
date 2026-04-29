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
 * Main AI call — routes to correct provider
 */
async function generateAIReply(systemPrompt, userMessage, history = []) {
  const provider = process.env.AI_PROVIDER || 'gemini';
  try {
    if (provider === 'openai') return await callOpenAI(systemPrompt, userMessage, history);
    return await callGemini(systemPrompt, userMessage);
  } catch (err) {
    console.error(`AI [${provider}] error:`, err.message);
    throw err;
  }
}

/**
 * Extract JSON from AI text response.
 * Tries markdown code block first, then bare object.
 */
function extractJSON(text) {
  if (!text) return null;
  try {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/) ||
                  text.match(/(\{[\s\S]*\})/);
    const jsonStr = match ? (match[1] || match[0]) : text;
    return JSON.parse(jsonStr.trim());
  } catch {
    return null;
  }
}

const VALID_ACTIONS = new Set([
  'NONE', 'SHOW_MENU', 'ADD_ITEM', 'REMOVE_ITEM',
  'ASK_ORDER_TYPE', 'ASK_ADDRESS', 'SHOW_SUMMARY',
  'CONFIRM_ORDER', 'HANDOFF_TO_HUMAN', 'CANCEL_ORDER',
  'ASK_CLARIFYING_QUESTION',
]);

/**
 * Validate parsed AI result against required schema.
 * Returns { valid: true } or { valid: false, reason: string }
 */
function validateAIResult(result) {
  if (!result || typeof result !== 'object') {
    return { valid: false, reason: 'Result is not an object' };
  }
  if (typeof result.reply !== 'string' || result.reply.trim().length === 0) {
    return { valid: false, reason: 'Missing or empty reply string' };
  }
  if (result.action && !VALID_ACTIONS.has(result.action)) {
    return { valid: false, reason: `Unknown action: ${result.action}` };
  }
  if (result.extracted_items !== undefined && !Array.isArray(result.extracted_items)) {
    return { valid: false, reason: 'extracted_items must be an array' };
  }
  return { valid: true };
}

const CORRECTION_PROMPT = `يجب أن يكون ردك JSON فقط بهذا الشكل بالضبط، بدون أي نص إضافي:
{"reply":"نص الرد هنا","action":"NONE","extracted_items":[]}

الأكشن يجب أن يكون أحد هذه القيم فقط:
NONE, SHOW_MENU, ADD_ITEM, REMOVE_ITEM, ASK_ORDER_TYPE, ASK_ADDRESS, SHOW_SUMMARY, CONFIRM_ORDER, HANDOFF_TO_HUMAN, CANCEL_ORDER

أعد المحاولة الآن.`;

/**
 * Call AI with automatic retry on invalid JSON.
 * If second attempt also fails, returns null (caller must handle gracefully).
 */
async function generateValidatedAIReply(systemPrompt, userMessage, history = []) {
  // First attempt
  let raw;
  try {
    raw = await generateAIReply(systemPrompt, userMessage, history);
  } catch (err) {
    console.error('AI first call failed:', err.message);
    return null;
  }

  let parsed = extractJSON(raw);
  let validation = validateAIResult(parsed);

  if (validation.valid) return parsed;

  console.warn(`AI response invalid (${validation.reason}), retrying with correction prompt...`);

  // Second attempt with correction
  try {
    const correctionMessage = `${userMessage}\n\n${CORRECTION_PROMPT}`;
    raw = await generateAIReply(systemPrompt, correctionMessage, history);
    parsed = extractJSON(raw);
    validation = validateAIResult(parsed);
    if (validation.valid) return parsed;
    console.error('AI second attempt also invalid:', validation.reason, '| Raw:', raw?.slice(0, 200));
  } catch (err) {
    console.error('AI retry failed:', err.message);
  }

  return null; // caller must trigger human handoff
}

module.exports = { generateAIReply, generateValidatedAIReply, extractJSON, validateAIResult };
