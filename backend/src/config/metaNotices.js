/**
 * What owners and SHIFT staff are told about paying Meta, in one place.
 *
 * The same warning was written six times with a deadline in it («قبل 30 أيلول», «من 1 تشرين
 * الأول»). Once the date passed, every copy read as if the shop had missed it. These have no
 * dates: since 1 October 2026 a WABA without a payment method has its bot replies refused, and
 * that is simply how it works now (docs/panels/meta-facts.md, Q6).
 *
 * Rules every string here keeps (tests/metaNotices.test.js checks them):
 * - no dates and no month names;
 * - never promise «بدون رسوم» or «بدون إضافات» (commit f486294e): Meta bills the shop directly;
 * - Arabic, with Meta's product names (Meta, WhatsApp Manager) written as the owner sees them there.
 *
 * Three states, each with an owner and a staff wording, each short (a label or a title) and long
 * (the sentence under it):
 * - missing: nobody has confirmed a payment method at Meta;
 * - claimed: the owner pressed «أضفت البطاقة» and SHIFT has not confirmed it yet;
 * - blocked: Meta refused a send with error 131042 (payment), which overrides both.
 */

// Where an owner adds or fixes the card. Meta's own page; it opens their WhatsApp Manager.
const WHATSAPP_MANAGER_URL = 'https://business.facebook.com/wa/manage/home/';

// Who bills what: Meta charges the shop's card for WhatsApp messages; SHIFT charges the plan.
const META_FEES_LINE = 'تدفع رسوم رسائل واتساب لـ Meta مباشرة من بطاقتك في WhatsApp Manager، ولا تمر عبر شِفت.';

function deepFreeze(obj) {
  for (const v of Object.values(obj)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(obj);
}

const PAYMENT_NOTICES = deepFreeze({
  missing: {
    owner: {
      short: 'أضف بطاقة الدفع لدى Meta',
      long: 'أضف بطاقة دفع في WhatsApp Manager. بدونها قد ترفض Meta ردود البوت على زبائنك. هذه خطوة عندك أنت، لا عند شِفت.',
    },
    staff: {
      short: 'بدون بطاقة دفع مؤكدة لدى Meta',
      long: 'بدون طريقة دفع لدى Meta لا تُسلَّم ردود البوت للزبائن. Meta لا تُخبرنا إن كانت مضافة، فأكّدها يدويًا بعد أن تراها في WhatsApp Manager.',
    },
  },
  claimed: {
    owner: {
      short: 'أضفت البطاقة — بانتظار تأكيد شِفت',
      long: 'شكرًا. سيتأكد فريق شِفت من ظهور البطاقة في حسابك لدى Meta.',
    },
    staff: {
      short: 'الزبون أضاف البطاقة — بانتظار تأكيدك',
      long: 'يقول الزبون إنه أضاف بطاقة الدفع. تأكد من ظهورها في WhatsApp Manager ثم أكّدها هنا.',
    },
  },
  blocked: {
    owner: {
      short: 'رفضت واتساب ردود البوت — أضف بطاقة دفع لدى Meta',
      long: 'رفضت Meta تسليم ردود البوت لزبائنك بسبب طريقة الدفع. أضف بطاقة دفع أو صحّح بطاقتك في WhatsApp Manager. رسائل زبائنك ما زالت تصلك في «المحادثات».',
    },
    staff: {
      short: 'رفضت واتساب ردود البوت — طريقة الدفع لدى Meta',
      long: 'فشل إرسال رد بخطأ Meta رقم 131042 (طريقة الدفع). على الزبون إضافة بطاقة دفع أو تصحيحها في WhatsApp Manager.',
    },
  },
});

/**
 * @param {'missing'|'claimed'|'blocked'} state
 * @param {'owner'|'staff'} audience
 * @param {'short'|'long'} variant
 */
function paymentNotice(state = 'missing', audience = 'owner', variant = 'long') {
  const text = PAYMENT_NOTICES[state]?.[audience]?.[variant];
  if (!text) throw new Error(`metaNotices: no ${variant} ${audience} notice for "${state}"`);
  return text;
}

module.exports = {
  WHATSAPP_MANAGER_URL,
  META_FEES_LINE,
  PAYMENT_NOTICES,
  // The wording that replaces today's dated copies (a payment method nobody has confirmed).
  PAYMENT_METHOD_OWNER_SHORT: PAYMENT_NOTICES.missing.owner.short,
  PAYMENT_METHOD_OWNER_LONG: PAYMENT_NOTICES.missing.owner.long,
  PAYMENT_METHOD_STAFF_SHORT: PAYMENT_NOTICES.missing.staff.short,
  PAYMENT_METHOD_STAFF_LONG: PAYMENT_NOTICES.missing.staff.long,
  paymentNotice,
};
