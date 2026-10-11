/**
 * What one «الانضمام» card shows besides its name: the lines, the badges and the buttons. Plain
 * functions with no React, so the backend's tests can hold the board to deriveCard
 * (backend/tests/setupControlsContract.test.js).
 *
 * last_es_step_ar already reads «توقف عند: …» or «فشل عند: …» from the server, so it is shown as
 * it comes; reason_ar is left out when it says the same thing. A shop that only claimed its card
 * moves on to «يعلّم البوت», so the card itself says SHIFT still has to confirm it, with the
 * button (spec step 11); a shop stuck connecting gets «اربط معه» (the account's «الحالة» tab,
 * where SHIFT runs the attended connect).
 *
 * Who acts next is the server's call (deriveCard's next_actor), made from the same facts as the
 * stage. cardNextActor only falls back to the card's own flags for a card without it (a server
 * older than the field), and never reads reason_ar's wording.
 */

export function cardNextActor(card, stage) {
  if (card && Object.prototype.hasOwnProperty.call(card, 'next_actor')) return card.next_actor || null;
  if (stage === 'live') return null;
  if (card.payment_claimed || card.needs_operator) return 'shift';
  if (stage === 'invite_sent' && (!card.invite_expires_at || new Date(card.invite_expires_at).getTime() < Date.now())) return 'shift';
  return 'owner';
}

export function cardLines(card) {
  const step = (card && card.last_es_step_ar) || null;
  const reason = card && card.stuck && card.reason_ar && card.reason_ar !== step ? card.reason_ar : null;
  return { step, reason };
}

export function cardBadges(card, stage) {
  const out = [];
  if (card.needs_operator) out.push({ kind: 'needs_operator', label: 'بحاجة لشِفت' });
  if (card.payment_claimed) out.push({ kind: 'payment_claimed', label: 'بانتظار تأكيد البطاقة' });
  if (stage === 'invite_sent' && card.opened) out.push({ kind: 'opened', label: 'فتحه' });
  return out;
}

export function cardActions(card, stage) {
  const out = [{ kind: 'message', label: 'راسله' }];
  if (stage === 'invite_sent') {
    out.push({ kind: 'resend', label: 'أعد إرسال الرابط' }, { kind: 'revoke', label: 'ألغِ الدعوة' });
  }
  if (stage === 'connecting') {
    out.push({ kind: 'connect_with', label: 'اربط معه', to: `/admin/accounts/${encodeURIComponent(card.account_id)}` });
  }
  if (card.payment_claimed) out.push({ kind: 'confirm_card', label: 'رأيت البطاقة — أكّد' });
  return out;
}
