/**
 * Restaurant Workflow Engine
 *
 * Deterministic state machine for order collection.
 * AI is used ONLY for NLP (intent detection, item matching, friendly replies).
 * Prices, totals, availability = always from DB.
 */

const { generateAIReply, extractJSON } = require('../ai/provider');
const { MenuItem, Category } = require('../models/Menu');
const Order = require('../models/Order');

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

function isConfirmation(text) {
  const lower = text.toLowerCase().trim();
  return CONFIRMATION_PHRASES.some(p => lower.includes(p));
}

function isCancellation(text) {
  const lower = text.toLowerCase().trim();
  return CANCEL_PHRASES.some(p => lower.includes(p));
}

/**
 * Build system prompt with live DB data
 */
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

/**
 * Format menu for AI prompt
 */
async function buildMenuText(businessId) {
  const categories = await Category.find({ business_id: businessId, active: true }).sort('sort_order');
  const items = await MenuItem.find({ business_id: businessId, active: true, available: true });

  const lines = [];
  for (const cat of categories) {
    const catItems = items.filter(i => i.category_id.toString() === cat._id.toString());
    if (!catItems.length) continue;
    lines.push(`\n[${cat.name_ar}]`);
    for (const item of catItems) {
      lines.push(`- ${item.name_ar}: ${item.price} ${''} (ID: ${item._id})`);
    }
  }
  return lines.join('\n') || 'القائمة فارغة حالياً';
}

/**
 * Match AI-extracted items to real DB menu items
 */
async function matchItemsToMenu(businessId, extractedItems) {
  const allItems = await MenuItem.find({ business_id: businessId, active: true, available: true });
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
        menu_item_id: found._id,
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

/**
 * Calculate order totals from cart
 */
function calculateTotals(cart, deliveryFee = 0) {
  const subtotal = cart.reduce((sum, i) => sum + i.item_total, 0);
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    delivery_fee: deliveryFee,
    total: Math.round((subtotal + deliveryFee) * 100) / 100,
  };
}

/**
 * Format cart summary in Arabic
 */
function formatCartSummary(cart, totals, currency = 'JOD') {
  if (!cart.length) return 'سلة الطلب فارغة.';
  const lines = cart.map(i => `• ${i.name_ar} × ${i.quantity} = ${i.item_total.toFixed(2)} ${currency}`);
  lines.push(`\nالمجموع الفرعي: ${totals.subtotal.toFixed(2)} ${currency}`);
  if (totals.delivery_fee > 0) lines.push(`رسوم التوصيل: ${totals.delivery_fee.toFixed(2)} ${currency}`);
  lines.push(`الإجمالي: ${totals.total.toFixed(2)} ${currency}`);
  return lines.join('\n');
}

/**
 * Main workflow processor
 */
async function processRestaurantMessage(business, conversation, customerMessage) {
  const state = conversation.current_state || STATES.IDLE;
  const workflowData = conversation.workflow_data || {};
  const cart = workflowData.cart || [];

  // Human takeover - skip AI
  if (!conversation.ai_enabled) {
    return { reply: null, stateUpdate: {}, action: 'NONE' };
  }

  // Check human handoff keywords
  const handoffKeywords = business.ai_config?.handoff_keywords || [];
  if (handoffKeywords.some(k => customerMessage.toLowerCase().includes(k.toLowerCase()))) {
    return {
      reply: business.ai_config?.fallback_message || 'سأحولك إلى أحد موظفينا الآن.',
      stateUpdate: { ai_enabled: false, status: 'human_takeover' },
      action: 'HANDOFF_TO_HUMAN',
    };
  }

  // State: confirming order - deterministic, no AI needed
  if (state === STATES.CONFIRMING_ORDER) {
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
      // Still asking for confirmation
      const totals = calculateTotals(cart, workflowData.delivery_fee || 0);
      const summary = formatCartSummary(cart, totals, business.currency);
      return {
        reply: `${summary}\n\nهل تؤكد الطلب؟ قل "تمام" للتأكيد أو "إلغاء" للإلغاء.`,
        stateUpdate: {},
        action: 'NONE',
      };
    }
  }

  // State: collecting address
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

  // State: asking order type (delivery/pickup)
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
    // Unclear
    return {
      reply: 'هل تريد توصيل إلى بيتك أم ستستلم الطلب بنفسك؟',
      stateUpdate: {},
      action: 'NONE',
    };
  }

  // All other states: use AI for NLP
  try {
    const menuText = await buildMenuText(business._id);
    const systemPrompt = buildSystemPrompt(business, menuText);
    const contextMsg = state !== STATES.IDLE && cart.length
      ? `[حالة الطلب: ${cart.length} صنف في السلة]\nرسالة العميل: ${customerMessage}`
      : customerMessage;

    const aiRaw = await generateAIReply(systemPrompt, contextMsg);
    const aiResult = extractJSON(aiRaw);

    if (!aiResult) {
      return {
        reply: 'عذراً، لم أفهم طلبك. هل يمكنك إعادة الصياغة؟',
        stateUpdate: {},
        action: 'NONE',
      };
    }

    const { reply, action, extracted_items } = aiResult;

    // Handle ADD_ITEM
    if (action === 'ADD_ITEM' && extracted_items?.length) {
      const newItems = await matchItemsToMenu(business._id, extracted_items);
      if (newItems.length) {
        // Merge into cart
        for (const newItem of newItems) {
          const existing = cart.find(i => i.menu_item_id?.toString() === newItem.menu_item_id?.toString());
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

    // Handle ASK_ORDER_TYPE
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

module.exports = { processRestaurantMessage, STATES };
