/**
 * Restaurant Workflow Engine
 *
 * Deterministic state machine for order collection.
 * AI is used ONLY for NLP (intent detection, item matching, friendly replies).
 * Prices, totals, availability = always from DB.
 */

const { generateValidatedAIReply } = require('../ai/provider');
const prisma = require('../config/prisma');

const STATES = {
  IDLE: 'idle',
  BROWSING: 'browsing',
  COLLECTING_ITEMS: 'collecting_items',
  ASKING_ORDER_TYPE: 'asking_order_type',
  COLLECTING_ADDRESS: 'collecting_address',
  CONFIRMING_ORDER: 'confirming_order',
  ORDER_PLACED: 'order_placed',
};

const CONFIRMATION_PHRASES = [
  'yes', 'يس', 'اه', 'آه', 'أكد', 'تأكيد', 'confirm', 'تمام', 'تمم',
  'موافق', 'حسنا', 'حسناً', 'صح', 'صحيح', 'نعم', 'اوكي', 'okay', 'ok',
];

const CANCEL_PHRASES = ['إلغاء', 'cancel', 'لا', 'no', 'بطل', 'مش عارف'];

const DECISION_SPLIT_RE = /[\s،؛؟!,.?;:()\[\]{}"'«»…]+/;

function normalizeDecisionText(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ـ/g, '')
    .replace(/[\u064B-\u0652\u0670]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getDecisionTokens(text) {
  return normalizeDecisionText(text).split(DECISION_SPLIT_RE).filter(Boolean);
}

function hasDecisionPhrase(text, phrases) {
  const tokens = getDecisionTokens(text);
  if (tokens.length === 0) return false;
  for (const phrase of phrases) {
    const phraseTokens = getDecisionTokens(phrase);
    if (phraseTokens.length === 0) continue;
    if (phraseTokens.length === 1) {
      if (tokens.includes(phraseTokens[0])) return true;
      continue;
    }
    outer: for (let i = 0; i <= tokens.length - phraseTokens.length; i++) {
      for (let j = 0; j < phraseTokens.length; j++) {
        if (tokens[i + j] !== phraseTokens[j]) continue outer;
      }
      return true;
    }
  }
  return false;
}

function isConfirmation(text) { return hasDecisionPhrase(text, CONFIRMATION_PHRASES); }
function isCancellation(text) { return hasDecisionPhrase(text, CANCEL_PHRASES); }

function buildSystemPrompt(business, menuText) {
  return `أنت مساعد طلبات ودود لمطعم "${business.name}".
شخصيتك: ${business.ai_config?.personality || 'مساعد ودود ومحترف'}.
عملتك: ${business.currency || 'JOD'}.

قائمة الطعام المتاحة:
${menuText}

قواعد مهمة جداً:
- لا تخترع أسعاراً أو أصنافاً غير موجودة في القائمة.
- لا تؤكد الطلب حتى يقول العميل كلمة تأكيد صريحة.
- إذا لم تفهم الطلب، اسأل بودٍّ.
- تحدث بالعربية دائماً.
- ردودك موجزة وعملية.

أجب فقط بـ JSON بهذا الشكل:
{
  "reply": "الرد على العميل",
  "action": "NONE | SHOW_MENU | ADD_ITEM | REMOVE_ITEM | ASK_ORDER_TYPE | ASK_ADDRESS | SHOW_SUMMARY | CONFIRM_ORDER | HANDOFF_TO_HUMAN | CANCEL_ORDER",
  "extracted_items": [{ "name_ar": "...", "quantity": 1 }]
}`;
}

async function buildMenuText(businessId) {
  const categories = await prisma.category.findMany({
    where: { business_id: businessId, active: true },
    orderBy: { sort_order: 'asc' },
  });
  const items = await prisma.menuItem.findMany({
    where: { business_id: businessId, active: true, available: true },
  });

  const lines = [];
  for (const cat of categories) {
    const catItems = items.filter(i => i.category_id === cat.id);
    if (!catItems.length) continue;
    lines.push(`\n[${cat.name_ar}]`);
    for (const item of catItems) {
      lines.push(`- ${item.name_ar}: ${item.price} ${''} (ID: ${item.id})`);
    }
  }
  return lines.join('\n') || 'القائمة فارغة حالياً';
}

async function matchItemsToMenu(businessId, extractedItems) {
  const allItems = await prisma.menuItem.findMany({
    where: { business_id: businessId, active: true, available: true },
  });
  const matched = [];

  for (const ext of extractedItems || []) {
    const name = ext.name_ar?.toLowerCase() || '';
    const found = allItems.find(i =>
      i.name_ar.toLowerCase().includes(name) ||
      name.includes(i.name_ar.toLowerCase()) ||
      (i.name_en && i.name_en.toLowerCase().includes(ext.name_ar?.toLowerCase()))
    );
    if (found) {
      matched.push({
        menu_item_id: found.id,
        name_ar: found.name_ar,
        name_en: found.name_en,
        quantity: Math.max(1, parseInt(ext.quantity) || 1),
        unit_price: found.price,
        item_total: found.price * Math.max(1, parseInt(ext.quantity) || 1),
        modifiers: [],
      });
    }
  }
  return matched;
}

function calculateTotals(cart, deliveryFee = 0) {
  const subtotal = cart.reduce((sum, i) => sum + i.item_total, 0);
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    delivery_fee: deliveryFee,
    total: Math.round((subtotal + deliveryFee) * 100) / 100,
  };
}

function formatCartSummary(cart, totals, currency = 'JOD') {
  if (!cart.length) return 'سلة الطلب فارغة.';
  const lines = cart.map(i => `• ${i.name_ar} × ${i.quantity} = ${i.item_total.toFixed(2)} ${currency}`);
  lines.push(`\nالمجموع الفرعي: ${totals.subtotal.toFixed(2)} ${currency}`);
  if (totals.delivery_fee > 0) lines.push(`رسوم التوصيل: ${totals.delivery_fee.toFixed(2)} ${currency}`);
  lines.push(`الإجمالي: ${totals.total.toFixed(2)} ${currency}`);
  return lines.join('\n');
}

async function processRestaurantMessage(business, conversation, customerMessage) {
  const state = conversation.current_state || STATES.IDLE;
  const workflowData = conversation.workflow_data || {};
  const cart = workflowData.cart || [];

  if (!conversation.ai_enabled) {
    return { reply: null, stateUpdate: {}, action: 'NONE' };
  }

  const handoffKeywords = business.ai_config?.handoff_keywords || [];
  if (handoffKeywords.some(k => customerMessage.toLowerCase().includes(k.toLowerCase()))) {
    return {
      reply: business.ai_config?.fallback_message || 'سأحولك إلى أحد موظفينا الآن.',
      stateUpdate: { ai_enabled: false, status: 'human_takeover' },
      action: 'HANDOFF_TO_HUMAN',
    };
  }

  if (state === STATES.CONFIRMING_ORDER) {
    if (!Array.isArray(cart) || cart.length === 0) {
      return {
        reply: 'سلة الطلب فارغة حالياً. يرجى إرسال الأصناف التي ترغب بطلبها من جديد.',
        stateUpdate: { current_state: STATES.IDLE, workflow_data: {} },
        action: 'CANCEL_ORDER',
      };
    }
    if (isConfirmation(customerMessage)) {
      const totals = calculateTotals(cart, workflowData.delivery_fee || 0);
      return {
        reply: `✅ تم تأكيد طلبك! شكراً ${workflowData.customer_name || ''}. سنبدأ التحضير فوراً.`,
        stateUpdate: {
          current_state: STATES.ORDER_PLACED,
          workflow_data: { ...workflowData, confirmed: true },
        },
        action: 'CONFIRM_ORDER',
        orderData: {
          items: cart,
          ...totals,
          order_type: workflowData.order_type || 'delivery',
          address: workflowData.address,
          notes: workflowData.notes,
          customer_name: workflowData.customer_name,
          payment_method: workflowData.payment_method || 'cash',
        },
      };
    } else if (isCancellation(customerMessage)) {
      return {
        reply: '❌ تم إلغاء الطلب. هل تريد طلب شيء آخر؟',
        stateUpdate: { current_state: STATES.IDLE, workflow_data: {} },
        action: 'CANCEL_ORDER',
      };
    } else {
      const totals = calculateTotals(cart, workflowData.delivery_fee || 0);
      const summary = formatCartSummary(cart, totals, business.currency);
      return {
        reply: `${summary}\n\nهل تؤكد الطلب؟ قل "تمام" للتأكيد أو "إلغاء" للإلغاء.`,
        stateUpdate: {},
        action: 'NONE',
      };
    }
  }

  if (state === STATES.COLLECTING_ADDRESS) {
    workflowData.address = customerMessage;
    const totals = calculateTotals(cart, business.policies?.delivery_fee || 0);
    workflowData.delivery_fee = totals.delivery_fee;
    const summary = formatCartSummary(cart, totals, business.currency);
    return {
      reply: `شكراً! العنوان: ${customerMessage}\n\n${summary}\n\nهل تؤكد الطلب؟`,
      stateUpdate: {
        current_state: STATES.CONFIRMING_ORDER,
        workflow_data: workflowData,
      },
      action: 'NONE',
    };
  }

  if (state === STATES.ASKING_ORDER_TYPE) {
    const lower = customerMessage.toLowerCase();
    let orderType = null;
    if (lower.includes('توصيل') || lower.includes('delivery') || lower.includes('بيت') || lower.includes('عنوان')) {
      orderType = 'delivery';
    } else if (lower.includes('استلام') || lower.includes('pickup') || lower.includes('بجيب') || lower.includes('أجي')) {
      orderType = 'pickup';
    }

    if (orderType === 'pickup') {
      workflowData.order_type = 'pickup';
      const totals = calculateTotals(cart, 0);
      const summary = formatCartSummary(cart, totals, business.currency);
      return {
        reply: `${summary}\n\nهل تؤكد الطلب؟`,
        stateUpdate: {
          current_state: STATES.CONFIRMING_ORDER,
          workflow_data: { ...workflowData, order_type: 'pickup' },
        },
        action: 'NONE',
      };
    } else if (orderType === 'delivery') {
      workflowData.order_type = 'delivery';
      return {
        reply: 'ممتاز! أرسل لي عنوانك للتوصيل من فضلك.',
        stateUpdate: {
          current_state: STATES.COLLECTING_ADDRESS,
          workflow_data: workflowData,
        },
        action: 'NONE',
      };
    }
    return {
      reply: 'هل تريد توصيل إلى بيتك أم ستستلم الطلب بنفسك؟',
      stateUpdate: {},
      action: 'NONE',
    };
  }

  try {
    const menuText = await buildMenuText(business.id);
    const systemPrompt = buildSystemPrompt(business, menuText);
    const contextMsg = state !== STATES.IDLE && cart.length
      ? `[حالة الطلب: ${cart.length} صنف في السلة]\nرسالة العميل: ${customerMessage}`
      : customerMessage;

    const aiResult = await generateValidatedAIReply(systemPrompt, contextMsg);

    if (!aiResult) {
      console.warn(`AI returned invalid output twice for business ${business.id} — triggering human handoff`);
      return {
        reply: business.ai_config?.fallback_message || 'عذراً، واجهنا مشكلة تقنية. سيتواصل معك موظفنا قريباً.',
        stateUpdate: { ai_enabled: false, status: 'human_takeover' },
        action: 'HANDOFF_TO_HUMAN',
      };
    }

    const { reply, action, extracted_items } = aiResult;

    if (action === 'ADD_ITEM' && extracted_items?.length) {
      const newItems = await matchItemsToMenu(business.id, extracted_items);
      if (newItems.length) {
        for (const newItem of newItems) {
          const existing = cart.find(i => i.menu_item_id === newItem.menu_item_id);
          if (existing) {
            existing.quantity += newItem.quantity;
            existing.item_total = existing.quantity * existing.unit_price;
          } else {
            cart.push(newItem);
          }
        }
        workflowData.cart = cart;
        const totals = calculateTotals(cart, 0);
        const cartLine = formatCartSummary(cart, totals, business.currency);
        const confirmReply = `${reply}\n\n🛒 سلتك الحالية:\n${cartLine}\n\nهل تريد إضافة شيء آخر؟`;
        return {
          reply: confirmReply,
          stateUpdate: { current_state: STATES.COLLECTING_ITEMS, workflow_data: workflowData },
          action: 'ADD_ITEM',
        };
      } else {
        return {
          reply: 'عذراً، هذا الصنف غير متوفر في القائمة. هل تريد رؤية قائمتنا؟',
          stateUpdate: {},
          action: 'NONE',
        };
      }
    }

    if (action === 'ASK_ORDER_TYPE' || (cart.length > 0 && action === 'SHOW_SUMMARY')) {
      const targetAction = cart.length > 0 ? 'ASK_ORDER_TYPE' : action;
      return {
        reply: reply || 'هل تريد توصيل أم استلام؟',
        stateUpdate: {
          current_state: cart.length > 0 ? STATES.ASKING_ORDER_TYPE : state,
          workflow_data: workflowData,
        },
        action: targetAction,
      };
    }

    if (action === 'HANDOFF_TO_HUMAN') {
      return {
        reply: business.ai_config?.fallback_message || 'سأحولك إلى موظف الآن.',
        stateUpdate: { ai_enabled: false, status: 'human_takeover' },
        action: 'HANDOFF_TO_HUMAN',
      };
    }

    return {
      reply: reply || 'كيف أقدر أساعدك؟',
      stateUpdate: { current_state: state, workflow_data: workflowData },
      action: action || 'NONE',
    };
  } catch (err) {
    console.error('Restaurant workflow AI error:', err.message);
    return {
      reply: 'عذراً، واجهنا مشكلة تقنية. سيتواصل معك موظفنا قريباً.',
      stateUpdate: { ai_enabled: false, status: 'human_takeover' },
      action: 'HANDOFF_TO_HUMAN',
    };
  }
}

module.exports = { processRestaurantMessage, STATES, isConfirmation, isCancellation };
