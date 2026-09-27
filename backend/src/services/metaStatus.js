/**
 * What Meta reports about a number, read with that account's own business token.
 *
 * These were declared «unavailable» on the fleet view because an app token cannot read a WABA.
 * A business token can, and we already store one per account — so quality rating, throughput,
 * number status and display-name status are all knowable, per account, for real.
 *
 * What is NOT knowable: whether a payment method is on file. `primary_funding_id` refuses with
 * "requires the Business that owns this App", so that one is confirmed by staff instead. Better
 * an honest human flag than a green light we cannot earn.
 */

const prisma = require('../config/prisma');
const { decrypt } = require('../utils/tokenCrypto');

function graphBase() {
  return `https://graph.facebook.com/${process.env.GRAPH_API_VERSION || 'v24.0'}`;
}

async function get(url, token) {
  const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`);
  const j = await r.json().catch(() => null);
  // Graph puts the useful part in error.message; the rest of the response carries the token.
  if (!r.ok || j?.error) throw new Error(j?.error?.message || `graph ${r.status}`);
  return j;
}

/**
 * Read and store. Returns what was stored, or throws with a message worth showing to staff.
 * `phoneNumberId` narrows the phone lookup when an account has more than one number.
 */
async function refresh(business) {
  if (!business.wa_business_account_id) throw new Error('لا يوجد حساب واتساب للأعمال مرتبط');
  const token = decrypt(business.wa_access_token);
  if (!token) throw new Error('لا يوجد رمز وصول محفوظ لهذا الحساب');

  const waba = business.wa_business_account_id;

  // Two calls: the account's review status, and the number's own health.
  const [account, numbers] = await Promise.all([
    get(`${graphBase()}/${waba}?fields=account_review_status`, token),
    get(`${graphBase()}/${waba}/phone_numbers?fields=display_phone_number,quality_rating,throughput,status,name_status`, token),
  ]);

  const rows = numbers?.data || [];
  const mine = rows.find((n) => n.id === business.wa_phone_number_id) || rows[0] || {};

  const data = {
    meta_review_status: account?.account_review_status || null,
    meta_quality_rating: mine.quality_rating || null,
    meta_throughput: mine.throughput?.level || null,
    meta_number_status: mine.status || null,
    meta_name_status: mine.name_status || null,
    meta_checked_at: new Date(),
  };

  await prisma.whatsappOnboarding.updateMany({ where: { business_id: business.id }, data });
  return { ...data, display_phone_number: mine.display_phone_number || null };
}

/**
 * Attention items from Meta's own view of an account. Quality and name status are the two that
 * cost a business real money — a RED rating throttles sending, and a declined display name means
 * customers see a bare number where a name should be.
 */
function metaAttention(onboarding) {
  const items = [];
  if (!onboarding) return items;

  if (onboarding.meta_quality_rating === 'RED') {
    items.push({ severity: 'critical', category: 'meta_quality', message: 'تقييم الجودة أحمر لدى Meta — الإرسال مُقيَّد' });
  } else if (onboarding.meta_quality_rating === 'YELLOW') {
    items.push({ severity: 'warning', category: 'meta_quality', message: 'تقييم الجودة أصفر لدى Meta — راقب شكاوى الزبائن' });
  }
  if (onboarding.meta_number_status && !['CONNECTED', 'MIGRATED'].includes(onboarding.meta_number_status)) {
    items.push({ severity: 'critical', category: 'meta_number', message: `حالة الرقم لدى Meta: ${onboarding.meta_number_status}` });
  }
  if (onboarding.meta_name_status === 'DECLINED') {
    items.push({ severity: 'warning', category: 'meta_name', message: 'Meta رفضت الاسم الظاهر — الزبون يرى الرقم بدل اسم المنشأة' });
  }
  return items;
}

module.exports = { refresh, metaAttention };
