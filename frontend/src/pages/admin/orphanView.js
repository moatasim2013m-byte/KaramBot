/**
 * «ربط بدون حساب»: what each orphan row offers and how it reads. Plain functions with no React,
 * so the backend's tests hold the panel to what /api/admin/onboardings accepts
 * (backend/tests/connectViewContract.test.js).
 */

/**
 * The buttons a row gets. The server lists two kinds of onboarding rows: needs 'attach' (no
 * shop yet) and needs 'number' (a shop, but Meta left no number). Only the first can be attached
 * (the second already has a shop, so /attach answers 409 already_attached); only the second takes
 * /complete. A PARTNER_ADDED with no row is attached too.
 */
export function orphanActions(o) {
  const needs = o?.needs || (o?.kind === 'onboarding' && !o?.phone_number_id ? 'number' : 'attach');
  return {
    attach: needs === 'attach',
    complete: o?.kind === 'onboarding' && needs === 'number',
  };
}

/**
 * The number as the row shows it. «الرقم غير محدد» only when there is none (Meta left it
 * unchosen, or a PARTNER_ADDED carries none); a row with a number Meta could not be asked about
 * says so in grey rather than claiming it has none.
 * @returns {{text: string, tone: 'number'|'missing'|'unread'}}
 */
export function orphanNumber(o) {
  if (o?.display_phone) return { text: o.display_phone, tone: 'number' };
  if (o?.phone_number_id) return { text: 'الرقم لم يُقرأ من Meta', tone: 'unread' };
  return { text: 'الرقم غير محدد', tone: 'missing' };
}

/** The shop is live on another number: the server asks SHIFT to confirm the replacement. */
export function needsReplaceConfirm(err) {
  return err?.response?.status === 409 && err?.response?.data?.error === 'business_connected';
}

/** The /attach body; `replace` only once SHIFT confirmed it. */
export function attachBody(businessId, replace = false) {
  return replace ? { business_id: businessId, replace: true } : { business_id: businessId };
}
