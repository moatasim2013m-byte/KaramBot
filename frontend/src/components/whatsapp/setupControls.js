/**
 * Which controls a checklist step («خطوات تشغيل البوت») or the status card's explanation shows.
 * Plain functions with no React, so the backend's tests can hold the panel to the server's words:
 * a step the server marks «عليك» with an action, or whose hint says «اضغط «اربط واتساب»», has that
 * button on the screen (backend/tests/setupControlsContract.test.js). Before this, the connect step
 * and the «أضفت البطاقة» claim had nothing to press outside /join.
 */

export const CONTROL_LABEL = {
  connect: 'اربط واتساب',
  claim: 'أضفت البطاقة',
  manager: 'افتح WhatsApp Manager',
  where: 'اذهب للإعداد',
  knowledge: 'أضف معلومات منشأتك',
  contact: 'راسل فريق شِفت على واتساب',
};

/** The controls of one checklist step, in order. Done steps have none. */
export function stepControls(step) {
  if (!step || step.done) return [];
  const out = [];
  if (step.action === 'connect') out.push({ kind: 'connect', label: CONTROL_LABEL.connect });
  if (step.url) out.push({ kind: 'manager', label: CONTROL_LABEL.manager, href: step.url });
  if (step.action === 'payment_claim') out.push({ kind: 'claim', label: CONTROL_LABEL.claim });
  if (step.where) out.push({ kind: 'where', label: CONTROL_LABEL.where, to: step.where });
  if (step.owner === 'shift') out.push({ kind: 'shift_wait', label: 'بانتظار فريق شِفت' });
  return out;
}

/** The controls under the status card's explanation (GET /whatsapp/status `explain`). */
export function explainControls(explain, { managerUrl, knowledgeWhere = '/settings' } = {}) {
  const action = explain && explain.action;
  if (!action) return [];
  if (action === 'connect') return [{ kind: 'connect', label: CONTROL_LABEL.connect }];
  if (action === 'payment') {
    return [
      { kind: 'manager', label: `${CONTROL_LABEL.manager} وأضف طريقة دفع`, href: managerUrl },
      { kind: 'claim', label: CONTROL_LABEL.claim },
    ];
  }
  if (action === 'knowledge') return [{ kind: 'knowledge', label: CONTROL_LABEL.knowledge, to: knowledgeWhere }];
  return [{ kind: 'contact', label: CONTROL_LABEL.contact }];
}
