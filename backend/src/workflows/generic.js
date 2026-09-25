const prisma = require('../config/prisma');
const { generateValidatedAIReply } = require('../ai/provider');

/**
 * The agent for a business with no sector workflow.
 *
 * A restaurant's knowledge is its menu and a clinic's is its services; both are modelled and
 * both feed a prompt. Every other business — a pharmacy, a gym, a workshop, a shop — fell
 * through to a fixed greeting string with no model call at all, which is why SHIFT could sell
 * to four sectors and deliver two.
 *
 * This is the same pattern with the knowledge the owner enters themselves: facts, opening
 * hours, services and prices, and answers to the questions customers actually ask. It books
 * nothing and takes no orders — those need a sector workflow — so its one escalation is
 * handing the conversation to a human, which is the honest thing to do when a customer wants
 * something the agent cannot complete.
 */

const MAX_ITEMS = 60;

/** The knowledge as the model should read it: grouped, labelled, and never invented. */
async function buildKnowledgeText(businessId) {
  const items = await prisma.businessKnowledge.findMany({
    where: { business_id: businessId, active: true },
    orderBy: [{ kind: 'asc' }, { position: 'asc' }],
    take: MAX_ITEMS,
  });
  if (!items.length) return null;

  const LABEL = {
    hours: 'أوقات العمل',
    service: 'الخدمات والأسعار',
    policy: 'السياسات',
    faq: 'أسئلة يسألها العملاء',
    fact: 'معلومات عن المنشأة',
  };

  const groups = new Map();
  for (const item of items) {
    const key = LABEL[item.kind] || LABEL.fact;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item.kind === 'faq' && item.question ? `- س: ${item.question}\n  ج: ${item.content}` : `- ${item.content}`);
  }

  return [...groups.entries()].map(([label, lines]) => `${label}:\n${lines.join('\n')}`).join('\n\n');
}

function buildGenericSystemPrompt(business, knowledgeText) {
  const hours = Array.isArray(business.opening_hours) && business.opening_hours.length
    ? `\nأوقات الدوام المسجّلة: ${JSON.stringify(business.opening_hours)}` : '';

  return `أنت مساعد واتساب لمنشأة اسمها "${business.name}".
شخصيتك: ${business.ai_config?.personality || 'مساعد ودود ومحترف'}.

ما تعرفه عن المنشأة:
${knowledgeText}${hours}

قواعد مهمة:
- أجب فقط مما تعرفه أعلاه. لا تخترع سعراً ولا خدمة ولا موعداً ولا رقماً غير موجود.
- إذا سُئلت عن شيء لا تعرفه، قل ذلك بوضوح واعرض تحويل العميل لموظف — لا تخمّن.
- لا تَعِد بحجز أو طلب: أنت لا تستطيع تنفيذهما، فحوّل العميل لموظف إذا طلب ذلك.
- اختصر. هذه محادثة واتساب، لا صفحة.
- تحدث بالعربية دائماً، وبنفس لهجة العميل قدر الإمكان.

أجب فقط بـ JSON بهذا الشكل:
{
  "reply": "الرد على العميل",
  "action": "NONE | HANDOFF_TO_HUMAN"
}`;
}

async function processGenericMessage(business, conversation, customerMessage) {
  if (!conversation.ai_enabled) {
    return { reply: null, stateUpdate: {}, action: 'NONE' };
  }

  // The owner's own escalation words win before anything is generated.
  const handoffKeywords = business.ai_config?.handoff_keywords || [];
  if (handoffKeywords.some((k) => String(customerMessage).includes(k))) {
    return {
      reply: business.ai_config?.fallback_message || 'سأحولك إلى أحد موظفينا الآن.',
      stateUpdate: { ai_enabled: false, status: 'human_takeover' },
      action: 'HANDOFF_TO_HUMAN',
    };
  }

  const knowledgeText = await buildKnowledgeText(business.id);

  // Nothing entered yet: the greeting is the honest answer, and it is what a customer would
  // have received before this workflow existed. Inventing answers would be worse than silence.
  if (!knowledgeText) {
    return {
      reply: business.ai_config?.greeting_message || 'كيف أقدر أساعدك؟',
      stateUpdate: {},
      action: 'NONE',
      knowledge_empty: true,
    };
  }

  const systemPrompt = buildGenericSystemPrompt(business, knowledgeText);
  const aiResult = await generateValidatedAIReply(systemPrompt, customerMessage);

  if (!aiResult) {
    return {
      reply: business.ai_config?.fallback_message || 'عذراً، واجهنا مشكلة تقنية. سيتواصل معك موظفنا قريباً.',
      stateUpdate: { ai_enabled: false, status: 'human_takeover' },
      action: 'HANDOFF_TO_HUMAN',
    };
  }

  const { reply, action } = aiResult;

  if (action === 'HANDOFF_TO_HUMAN') {
    return {
      reply: reply || business.ai_config?.fallback_message || 'سأحولك إلى أحد موظفينا الآن.',
      stateUpdate: { ai_enabled: false, status: 'human_takeover' },
      action: 'HANDOFF_TO_HUMAN',
    };
  }

  return { reply, stateUpdate: {}, action: 'NONE' };
}

module.exports = { processGenericMessage, buildKnowledgeText };
