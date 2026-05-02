/**
 * Clinic Workflow Engine
 *
 * State machine for appointment booking via WhatsApp.
 * AI does NLP only (intent, service/doctor matching, friendly replies).
 * Slot availability comes exclusively from the DB.
 */

const { generateValidatedAIReply } = require('../ai/provider');
const prisma = require('../config/prisma');
const { isConfirmation, isCancellation } = require('./restaurant');

// Prisma CUID v1 format: starts with 'c', followed by 24+ alphanumeric chars.
// If the ID strategy changes, update this pattern accordingly.
const PRISMA_ID_PATTERN = /\b(c[a-z0-9]{20,})\b/i;

const CLINIC_STATES = {
  IDLE: 'idle',
  CHOOSING_SERVICE: 'choosing_service',
  CHOOSING_DOCTOR: 'choosing_doctor',
  CHOOSING_SLOT: 'choosing_slot',
  CONFIRMING_APPOINTMENT: 'confirming_appointment',
  APPOINTMENT_PLACED: 'appointment_placed',
};

async function buildServicesText(businessId) {
  const services = await prisma.service.findMany({
    where: { business_id: businessId, active: true },
    orderBy: { name_ar: 'asc' },
  });
  if (!services.length) return 'لا توجد خدمات متاحة حالياً';
  return services.map(s => `- ${s.name_ar}${s.price != null ? ` (${s.price} JOD)` : ''} — ${s.duration_minutes} دقيقة (ID: ${s.id})`).join('\n');
}

async function buildDoctorsText(businessId, serviceId) {
  const where = { business_id: businessId, active: true };
  if (serviceId) {
    where.doctorServices = { some: { service_id: serviceId } };
  }
  const doctors = await prisma.doctor.findMany({
    where,
    orderBy: { name_ar: 'asc' },
  });
  if (!doctors.length) return 'لا يوجد أطباء متاحون لهذه الخدمة';
  return doctors.map(d => `- ${d.name_ar}${d.specialty_ar ? ` (${d.specialty_ar})` : ''} (ID: ${d.id})`).join('\n');
}

async function buildSlotsText(businessId, serviceId, doctorId) {
  const now = new Date();
  const oneWeekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const where = {
    business_id: businessId,
    is_booked: false,
    start_time: { gte: now, lte: oneWeekLater },
  };
  if (serviceId) where.service_id = serviceId;
  if (doctorId) where.doctor_id = doctorId;

  const slots = await prisma.appointmentSlot.findMany({
    where,
    orderBy: { start_time: 'asc' },
    take: 10,
  });
  if (!slots.length) return 'لا توجد مواعيد متاحة خلال الأسبوع القادم';
  return slots.map((s) => {
    const dt = new Date(s.start_time);
    const label = dt.toLocaleString('ar-JO', { weekday: 'long', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `- ${label} (ID: ${s.id})`;
  }).join('\n');
}

function buildClinicSystemPrompt(business, context) {
  return `أنت مساعد حجز مواعيد ودود لعيادة "${business.name}".
شخصيتك: ${business.ai_config?.personality || 'مساعد ودود ومحترف'}.

${context}

قواعد مهمة:
- لا تخترع أسعاراً أو أطباء أو أوقاتاً غير موجودة في القائمة.
- لا تؤكد الموعد حتى يقول العميل كلمة تأكيد صريحة.
- إذا لم تفهم الطلب، اسأل بودٍّ.
- تحدث بالعربية دائماً.

أجب فقط بـ JSON بهذا الشكل:
{
  "reply": "الرد على العميل",
  "action": "NONE | SHOW_SERVICES | CHOOSE_SERVICE | SHOW_DOCTORS | CHOOSE_DOCTOR | SHOW_SLOTS | CHOOSE_SLOT | CONFIRM_APPOINTMENT | HANDOFF_TO_HUMAN | CANCEL_APPOINTMENT",
  "extracted_id": "معرف الخدمة أو الطبيب أو الموعد إذا اختار العميل شيئاً"
}`;
}

async function processClinicMessage(business, conversation, customerMessage) {
  const state = conversation.current_state || CLINIC_STATES.IDLE;
  const workflowData = conversation.workflow_data || {};

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

  // State: confirming appointment
  if (state === CLINIC_STATES.CONFIRMING_APPOINTMENT) {
    if (isConfirmation(customerMessage)) {
      const { selectedSlotId, selectedDoctorId, selectedServiceId, customerName } = workflowData;
      if (!selectedSlotId) {
        return {
          reply: 'عذراً، لم يتم تحديد موعد. هل تريد إعادة الحجز؟',
          stateUpdate: { current_state: CLINIC_STATES.IDLE, workflow_data: {} },
          action: 'NONE',
        };
      }
      return {
        reply: `✅ تم تأكيد موعدك! شكراً ${customerName || ''}. سنتواصل معك للتذكير.`,
        stateUpdate: {
          current_state: CLINIC_STATES.APPOINTMENT_PLACED,
          workflow_data: { ...workflowData, confirmed: true },
        },
        action: 'CONFIRM_APPOINTMENT',
        appointmentData: {
          slot_id: selectedSlotId,
          doctor_id: selectedDoctorId || null,
          service_id: selectedServiceId || null,
          customer_name: customerName || null,
          customer_wa_id: conversation.customer_wa_id,
        },
      };
    } else if (isCancellation(customerMessage)) {
      return {
        reply: '❌ تم إلغاء طلب الحجز. هل تريد تحديد موعد آخر؟',
        stateUpdate: { current_state: CLINIC_STATES.IDLE, workflow_data: {} },
        action: 'CANCEL_APPOINTMENT',
      };
    }
  }

  // State: choosing slot — try to match a slot ID from the message
  if (state === CLINIC_STATES.CHOOSING_SLOT) {
    const slotIdMatch = customerMessage.match(PRISMA_ID_PATTERN);
    if (slotIdMatch) {
      const slot = await prisma.appointmentSlot.findFirst({
        where: { id: slotIdMatch[1], business_id: business.id, is_booked: false },
      });
      if (slot) {
        const dt = new Date(slot.start_time);
        const label = dt.toLocaleString('ar-JO', { weekday: 'long', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return {
          reply: `ممتاز! الموعد المختار: ${label}\n\nهل تؤكد حجز الموعد؟ قل "تمام" للتأكيد أو "إلغاء" للإلغاء.`,
          stateUpdate: {
            current_state: CLINIC_STATES.CONFIRMING_APPOINTMENT,
            workflow_data: { ...workflowData, selectedSlotId: slot.id },
          },
          action: 'NONE',
        };
      }
    }
  }

  // AI-driven flow for other states
  try {
    let contextText = '';
    const servicesText = await buildServicesText(business.id);

    if (state === CLINIC_STATES.IDLE || state === CLINIC_STATES.CHOOSING_SERVICE) {
      contextText = `الخدمات المتاحة:\n${servicesText}`;
    } else if (state === CLINIC_STATES.CHOOSING_DOCTOR) {
      const doctorsText = await buildDoctorsText(business.id, workflowData.selectedServiceId);
      contextText = `الخدمة المختارة: ${workflowData.selectedServiceName || ''}\nالأطباء المتاحون:\n${doctorsText}`;
    } else if (state === CLINIC_STATES.CHOOSING_SLOT) {
      const slotsText = await buildSlotsText(business.id, workflowData.selectedServiceId, workflowData.selectedDoctorId);
      contextText = `الطبيب: ${workflowData.selectedDoctorName || 'أي طبيب'}\nالمواعيد المتاحة (الأسبوع القادم):\n${slotsText}`;
    } else {
      contextText = `الخدمات المتاحة:\n${servicesText}`;
    }

    const systemPrompt = buildClinicSystemPrompt(business, contextText);
    const aiResult = await generateValidatedAIReply(systemPrompt, customerMessage);

    if (!aiResult) {
      return {
        reply: business.ai_config?.fallback_message || 'عذراً، واجهنا مشكلة تقنية. سيتواصل معك موظفنا قريباً.',
        stateUpdate: { ai_enabled: false, status: 'human_takeover' },
        action: 'HANDOFF_TO_HUMAN',
      };
    }

    const { reply, action, extracted_id } = aiResult;

    if (action === 'CHOOSE_SERVICE' && extracted_id) {
      const service = await prisma.service.findFirst({
        where: { id: extracted_id, business_id: business.id, active: true },
      });
      if (service) {
        const doctorsText = await buildDoctorsText(business.id, service.id);
        return {
          reply: `ممتاز! اخترت: ${service.name_ar}.\n\nالأطباء المتاحون:\n${doctorsText}\n\nمن تفضل؟`,
          stateUpdate: {
            current_state: CLINIC_STATES.CHOOSING_DOCTOR,
            workflow_data: { ...workflowData, selectedServiceId: service.id, selectedServiceName: service.name_ar },
          },
          action: 'CHOOSE_SERVICE',
        };
      }
    }

    if (action === 'CHOOSE_DOCTOR' && extracted_id) {
      const doctor = await prisma.doctor.findFirst({
        where: { id: extracted_id, business_id: business.id, active: true },
      });
      if (doctor) {
        const slotsText = await buildSlotsText(business.id, workflowData.selectedServiceId, doctor.id);
        return {
          reply: `د. ${doctor.name_ar} — إليك المواعيد المتاحة:\n${slotsText}\n\nاختر رقم الموعد المناسب لك.`,
          stateUpdate: {
            current_state: CLINIC_STATES.CHOOSING_SLOT,
            workflow_data: { ...workflowData, selectedDoctorId: doctor.id, selectedDoctorName: doctor.name_ar },
          },
          action: 'CHOOSE_DOCTOR',
        };
      }
    }

    if (action === 'SHOW_SERVICES') {
      const servicesListText = await buildServicesText(business.id);
      return {
        reply: `${reply || 'إليك خدماتنا:'}\n\n${servicesListText}`,
        stateUpdate: { current_state: CLINIC_STATES.CHOOSING_SERVICE, workflow_data: workflowData },
        action: 'SHOW_SERVICES',
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
    console.error('Clinic workflow AI error:', err.message);
    return {
      reply: 'عذراً، واجهنا مشكلة تقنية. سيتواصل معك موظفنا قريباً.',
      stateUpdate: { ai_enabled: false, status: 'human_takeover' },
      action: 'HANDOFF_TO_HUMAN',
    };
  }
}

module.exports = { processClinicMessage, CLINIC_STATES };
