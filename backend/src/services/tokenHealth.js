/**
 * Is a shop's WhatsApp business token still good? (docs/panels/spec.md, «Removal is detected
 * three ways».)
 *
 * A customer can remove SHIFT from their Meta account, or Meta can expire the grant, and the first
 * anyone heard of it used to be a shop owner asking why the bot went quiet. Two of the three
 * detectors live here: the daily debug_token is_valid check (run by shiftSweeper's daily step) and
 * the error-190 classifier the message path calls when a send is refused for the token. The third,
 * account_update PARTNER_REMOVED, is accountUpdate.js.
 *
 * An invalid token stamps WhatsappOnboarding.revoked_at with revoked_reason 'token_invalid',
 * records AccountEvent token_invalid and tells SHIFT (notifyShift partner_removed), once per
 * revocation. A later check that finds the token valid again lifts only a 'token_invalid'
 * revocation: one Meta reported itself (partner_removed) is not this module's to undo.
 *
 * Nothing here logs or returns a token.
 */

const axios = require('axios');
const prisma = require('../config/prisma');
const accountEvents = require('./accountEvents');
const { decrypt } = require('../utils/tokenCrypto');
const { appSecretFor, embeddedSignupAppId } = require('../utils/metaSecrets');

const TOKEN_INVALID_CODE = 190;
const TOKEN_INVALID = 'token_invalid';
// A shop wired by hand has no onboarding row to gate on, so its alert repeats at most daily.
const UNGATED_REPEAT_MS = 24 * 60 * 60 * 1000;

function graphBase() {
  return `https://graph.facebook.com/${process.env.GRAPH_API_VERSION || 'v24.0'}`;
}

/** The Graph error code of an axios error, a SendResult or a bare number; null when there is none. */
function graphCode(errOrResult) {
  if (errOrResult === null || errOrResult === undefined) return null;
  if (typeof errOrResult === 'number') return errOrResult;
  const fromResponse = errOrResult.response && errOrResult.response.data && errOrResult.response.data.error
    ? errOrResult.response.data.error.code : undefined;
  const code = fromResponse !== undefined ? fromResponse : errOrResult.code;
  const n = Number(code);
  return code !== undefined && code !== null && Number.isFinite(n) ? n : null;
}

/** True when Graph refused the call because the token is no longer valid (error 190). */
function isTokenInvalid(errOrResult) {
  return graphCode(errOrResult) === TOKEN_INVALID_CODE;
}

// The app token debug_token is asked with: the app that owns the shop's webhooks, when its secret
// is configured. Without one, a token may inspect itself, which answers is_valid just as well.
function inspectorFor(business, token) {
  const appId = business.wa_app_id || embeddedSignupAppId();
  const secret = appSecretFor(appId);
  return secret ? `${appId}|${secret}` : token;
}

async function notifyShift(args) {
  Promise.resolve(require('./alerts').notifyShift(args)).catch(() => {});
}

/**
 * Record that this shop's token stopped working. Returns true when this call was the one that
 * recorded it. Never throws.
 * @param {object} business  needs id, name
 * @param {object} [opts]
 * @param {'daily_check'|'send'} [opts.source]
 */
async function markInvalid(business, { source = 'send', now = new Date() } = {}) {
  try {
    const onb = await prisma.whatsappOnboarding.findUnique({ where: { business_id: business.id }, select: { id: true } });
    if (onb) {
      // The row is the gate: WHERE revoked_at IS NULL wins once, so a burst of refused sends and
      // the daily check make one alert between them.
      const { count } = await prisma.whatsappOnboarding.updateMany({
        where: { id: onb.id, revoked_at: null },
        data: { revoked_at: now, revoked_reason: TOKEN_INVALID },
      });
      if (!count) return false;
    } else {
      const recent = await prisma.accountEvent.findFirst({
        where: { business_id: business.id, type: TOKEN_INVALID, created_at: { gte: new Date(now.getTime() - UNGATED_REPEAT_MS) } },
        select: { id: true },
      });
      if (recent) return false;
    }
    await accountEvents.record({ businessId: business.id, actorKind: 'meta', type: TOKEN_INVALID, data: { source } });
    await notifyShift({
      reason: 'partner_removed', businessId: business.id, shopName: business.name || '',
      summary: source === 'daily_check'
        ? 'Meta تقول إن صلاحية شِفت على حساب الزبون لم تعد صالحة — البوت لا يرد. أعد ربط واتساب'
        : 'واتساب رفض ردود البوت لأن صلاحية شِفت انتهت (190) — أعد ربط واتساب',
    });
    return true;
  } catch (err) {
    console.error(`[tokenHealth] could not record an invalid token for business=${business && business.id}: ${err.message}`);
    return false;
  }
}

// A token found valid again ends a revocation this module made, and nothing else.
async function clearInvalid(business) {
  await prisma.whatsappOnboarding.updateMany({
    where: { business_id: business.id, revoked_reason: TOKEN_INVALID, revoked_at: { not: null } },
    data: { revoked_at: null, revoked_reason: null },
  });
}

/**
 * Ask Meta whether the shop's stored token is still valid, and act on the answer.
 * Stamps WhatsappOnboarding.token_checked_at on every attempt, so the daily step runs once a day
 * per shop however many instances sweep.
 *
 * @returns {Promise<{status: 'valid'|'invalid'|'unknown', error?: string}>}  'unknown' when Meta
 *   could not be asked; nothing is changed then.
 */
async function check(business, { now = new Date() } = {}) {
  let token = null;
  try {
    token = decrypt(business.wa_access_token);
  } catch (err) {
    token = null;
  }
  if (!token) return { status: 'unknown', error: 'no_token' };

  let status = 'unknown';
  let error;
  try {
    const res = await axios.get(`${graphBase()}/debug_token`, {
      params: { input_token: token, access_token: inspectorFor(business, token) },
      timeout: 15000,
    });
    const data = res && res.data && res.data.data;
    if (data && typeof data.is_valid === 'boolean') status = data.is_valid ? 'valid' : 'invalid';
    else error = 'no_answer';
  } catch (err) {
    // Asked with the token itself, an invalid token is refused with 190 instead of answered.
    if (isTokenInvalid(err)) status = 'invalid';
    else error = (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || err.message;
  }

  try {
    await prisma.whatsappOnboarding.updateMany({ where: { business_id: business.id }, data: { token_checked_at: now } });
  } catch (err) {
    console.error(`[tokenHealth] token_checked_at not saved business=${business.id}: ${err.message}`);
  }

  if (status === 'invalid') await markInvalid(business, { source: 'daily_check', now });
  else if (status === 'valid') {
    try {
      await clearInvalid(business);
    } catch (err) {
      console.error(`[tokenHealth] revocation not cleared business=${business.id}: ${err.message}`);
    }
  }
  return error ? { status, error: String(error).slice(0, 200) } : { status };
}

module.exports = { check, markInvalid, isTokenInvalid, graphCode, TOKEN_INVALID_CODE, TOKEN_INVALID };
