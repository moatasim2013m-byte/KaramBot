/**
 * SHIFT Sales Assistant Workflow
 *
 * Answers prospects who message SHIFT's own WhatsApp number (usually from an ad or shifts-ai.store).
 * AI does the conversation; everything it may state about SHIFT comes from SHIFT_KNOWLEDGE below, which mirrors
 * the public site (marketing/site/assets/js/content.js). There are no public prices, clients or statistics, so the
 * assistant never states any: pricing, meetings, contracts and anything it cannot answer go to a person.
 *
 * Handoff = the conversation leaves AI (ai_enabled false, status human_takeover) and shows in the Inbox.
 */

const { generateValidatedAIReply } = require('../ai/provider');
const prisma = require('../config/prisma');

const HISTORY_LIMIT = 12;

const SHIFT_KNOWLEDGE = `شِفت (SHIFT AI & Automation) — شركة ذكاء اصطناعي وأتمتة في إربد، الأردن، تخدم عمّان وإربد والزرقاء.
الموقع: https://shifts-ai.store
القطاعات الأساسية: العيادات، المطاعم والكافيهات، المتاجر الإلكترونية.

المنتجات:
1) كرم بوت — وكلاء ذكاء اصطناعي على واتساب: يردّ من قائمة المنشأة وأسعارها وأوقاتها ليلًا ونهارًا، يستقبل الطلبات ويحجز المواعيد في التقويم، يتابع العملاء، يحوّل لموظف مع السياق كاملًا، وتقرير يومي للمالك على واتساب.
   - للعيادات: يعرض الأوقات المتاحة فعليًا من التقويم، يثبّت الموعد ويذكّر به ويعدّله، ويحوّل الاستثناءات للاستقبال.
   - للمطاعم والكافيهات: يجيب من القائمة والأسعار، يأخذ طلب التوصيل بالعنوان ويرسله للمطبخ، ويثبّت حجز الطاولة.
   - للمتاجر الإلكترونية: حالة الطلب برقمه، المقاسات المتوفرة، وقت التوصيل وطريقة الدفع، وتذكير بالسلال المتروكة.
2) نقاط الولاء — نقاط لكل عملية شراء، مستويات (برونزي/فضي/ذهبي) ومكافآت، انضمام برقم الهاتف أو QR، وإشعارات واتساب.
3) الحجوزات والمواعيد — حجز بالتوفر الفعلي، عربون ودفع إلكتروني، تذكير قبل 24 ساعة وقبل ساعتين، وقائمة انتظار.
4) الاشتراكات والباقات — خطط شهرية وباقات جلسات، عدّاد جلسات، وتذكير بالتجديد على واتساب.
5) نظام الدوام — حضور بالبصمة أو QR أو الجوال، ورديات، تنبيهات تأخير وغياب، إجازات، وتصدير شهري للرواتب.
6) التسويق الآلي — شرائح عملاء، كوبونات، رسائل أعياد الميلاد، واستعادة العملاء الخاملين عبر واتساب.
7) نظام إدارة الأعمال — نقطة بيع، متجر إلكتروني، مخزون، فواتير ومصاريف، وتقارير أرباح، وفروع متعددة.
8) أتمتة مخصّصة — ربط واتساب Cloud API وجداول جوجل والتقويمات وأنظمة CRM ونقاط البيع، ومسارات Make وZapier وn8n، مع تدقيق أتمتة مجاني قبل أي بناء.
يمكن البدء بمنتج واحد وإضافة الباقي لاحقًا.`;

function buildSystemPrompt(business, historyText) {
  return `أنت مساعد المبيعات لشركة شِفت على واتساب. تتحدث مع أصحاب منشآت مهتمين بخدمات شِفت.
شخصيتك: ${business.ai_config?.personality || 'ودود، مختصر، ومحترف، بلهجة أردنية مهذبة'}.

معلومات شِفت — لا تذكر أي معلومة عن شِفت خارج هذا النص:
${SHIFT_KNOWLEDGE}

قواعد صارمة:
- لا تذكر أسعارًا أو خصومات أو مدة تنفيذ أو أسماء عملاء أو أرقامًا أو نتائج مضمونة — هذه غير منشورة. عند سؤال السعر: اشرح أن السعر يعتمد على المنتجات وحجم المنشأة، واسأل عن نوع المنشأة وما يحتاجه، وأخبره أن فريق شِفت سيرسل عرضًا.
- لا تخترع ميزات غير موجودة في النص. إن لم تعرف، قل إن الفريق سيجيبه.
- ردود قصيرة مناسبة لواتساب: جملتان إلى أربع جمل، بدون عناوين أو جداول.
- ردّ بلغة العميل (عربي أو إنجليزي).
- هدفك: فهم المنشأة (القطاع، المشكلة، اسم المنشأة) واقتراح المنتج المناسب، ثم ترتيب تواصل مع الفريق.
- لا تطلب بيانات حساسة (كلمات مرور، بطاقات، رموز تحقق).

متى تستخدم HANDOFF_TO_HUMAN:
- طلب العميل التحدث مع شخص أو موظف.
- طلب عرض سعر أو اجتماع أو عرض تجريبي، وقد عرفت قطاعه وما يحتاجه (أو رفض إعطاءهما).
- شكوى، أو موضوع خارج خدمات شِفت، أو سؤال لا تجد جوابه في النص.
عند HANDOFF_TO_HUMAN: اجعل ردك جملة تخبره أن أحد فريق شِفت سيتواصل معه هنا قريبًا.

المحادثة حتى الآن (الأقدم أولًا):
${historyText || '(لا توجد رسائل سابقة)'}

أجب بـ JSON فقط بدون أي نص آخر:
{"reply":"نص الرد","action":"NONE","extracted_items":[]}
الأكشن: NONE أو HANDOFF_TO_HUMAN فقط.`;
}

function formatHistory(messages) {
  return messages
    .filter(m => m.text_body)
    .map(m => `${m.direction === 'inbound' ? 'العميل' : 'شِفت'}: ${m.text_body.replace(/\s+/g, ' ').slice(0, 400)}`)
    .join('\n');
}

const HANDOFF_REPLY = 'شكرًا لتواصلك مع شِفت 🙏 أحد أعضاء الفريق سيتواصل معك هنا قريبًا.';

function toWorkflowResult(aiResult) {
  if (!aiResult) {
    return {
      reply: HANDOFF_REPLY,
      stateUpdate: { ai_enabled: false, status: 'human_takeover' },
      action: 'HANDOFF_TO_HUMAN',
    };
  }
  if (aiResult.action === 'HANDOFF_TO_HUMAN') {
    return {
      reply: aiResult.reply.trim() || HANDOFF_REPLY,
      stateUpdate: { ai_enabled: false, status: 'human_takeover' },
      action: 'HANDOFF_TO_HUMAN',
    };
  }
  return { reply: aiResult.reply.trim(), stateUpdate: {}, action: 'NONE' };
}

async function processShiftMessage(business, conversation, customerText) {
  // The current inbound message is already saved; take the turns before it as history.
  const recent = await prisma.message.findMany({
    where: { conversation_id: conversation.id },
    orderBy: { created_at: 'desc' },
    take: HISTORY_LIMIT + 1,
    select: { direction: true, text_body: true },
  });
  const history = recent.slice(1).reverse();
  const aiResult = await generateValidatedAIReply(buildSystemPrompt(business, formatHistory(history)), customerText);
  if (!aiResult) console.error(`[shift] AI failed for conversation=${conversation.id} — handing off`);
  return toWorkflowResult(aiResult);
}

module.exports = { processShiftMessage, buildSystemPrompt, formatHistory, toWorkflowResult, SHIFT_KNOWLEDGE, HANDOFF_REPLY };
