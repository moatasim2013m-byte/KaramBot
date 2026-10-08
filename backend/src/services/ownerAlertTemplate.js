'use strict';

/**
 * The owner-alert template on each newly connected shop's own WABA (docs/panels/spec.md, «Auto-filled
 * profile fields»: ai_config.alert_template).
 *
 * A shop's handoff alerts go from the shop's own number to the owner's mobile. Inside the owner's
 * 24-hour window they are free text; outside it WhatsApp delivers only an approved template, and
 * without one alerts.js skips the alert (sendTemplateAlert, «no ai_config.alert_template»). Before
 * this, someone had to run scripts/create-alert-template.js by hand for every shop, so in practice
 * the owner of a quiet shop never heard that a customer asked for a person.
 *
 * So right after a number connects (embeddedSignup.afterConnect) this submits a neutral UTILITY
 * template, owner_alert, to the shop's WABA with the shop's own token. Meta reviews it, usually in
 * minutes. ai_config.alert_template is set only once Meta says APPROVED: here when the submit answer
 * already says so, otherwise by the daily sweep's poll (pollPending). A template that is not
 * approved is never named in alert_template, because a send through it fails.
 *
 * The request is remembered in ai_config.owner_alert_template {name, language, id, status,
 * submitted_at, checked_at}, never with a token. Everything here is best effort and never throws:
 * a shop is connected and working whether or not Meta approves its alert template.
 */

const axios = require('axios');
const prisma = require('../config/prisma');
const jsonb = require('../db/jsonb');
const { graphBase } = require('./whatsapp');
const { decrypt } = require('../utils/tokenCrypto');
const accountEvents = require('./accountEvents');

const OWNER_ALERT_TEMPLATE_NAME = 'owner_alert';
const OWNER_ALERT_TEMPLATE_LANGUAGE = 'ar';
// The same three variables, in the same order, as SHIFT's staff_alert (alerts.alertTemplateParams
// fills them): {{1}} what happened, {{2}} who (customer name and number), {{3}} the summary. The
// spec's one-line «تنبيه من كرم بوت: {{1}} — {{2}} — {{3}}» ended on a variable, which Meta
// refuses, so a fixed last line closes it. Neutral words only: no promotion, or Meta re-files it
// as MARKETING.
const OWNER_ALERT_TEMPLATE_BODY = 'تنبيه من كرم بوت: {{1}}\nالزبون: {{2}}\nالتفاصيل: {{3}}\nافتح لوحة كرم بوت للرد.';
// Plainly transactional sample values (Meta reviews the example with the body).
const EXAMPLE = ['زبون طلب التحدث مع موظف', 'محمد (+962791234567)', 'سأل عن موعد التوصيل لطلبه'];
const CONFIG_KEY = 'owner_alert_template';
const GRAPH_TIMEOUT_MS = 15000;
// Meta's answer when a template with this name and language already exists on the WABA.
const ALREADY_EXISTS_SUBCODES = new Set([2388023, 2388024]);
// Statuses Meta will not move on from by itself: polling them again is pointless.
const FINAL_STATUSES = new Set(['APPROVED', 'REJECTED', 'DISABLED', 'PAUSED']);

/** The exact body Graph receives for POST /{WABA_ID}/message_templates. */
function templatePayload({ name = OWNER_ALERT_TEMPLATE_NAME, language = OWNER_ALERT_TEMPLATE_LANGUAGE } = {}) {
  return {
    name,
    language,
    category: 'UTILITY',
    components: [
      { type: 'BODY', text: OWNER_ALERT_TEMPLATE_BODY, example: { body_text: [EXAMPLE] } },
    ],
  };
}

function graphErrorOf(err) {
  return err?.response?.data?.error || null;
}

// Graph's message for the log; never the token (it is only ever in a header).
function describe(err) {
  const e = graphErrorOf(err);
  return e ? `${e.message} (code=${e.code}${e.error_subcode ? ` subcode=${e.error_subcode}` : ''})` : err.message;
}

/** The shop's WABA and token, or null when it cannot have a template yet. */
function credentials(business) {
  if (!business || !business.wa_business_account_id || !business.wa_access_token) return null;
  const token = decrypt(business.wa_access_token);
  return token ? { wabaId: business.wa_business_account_id, token } : null;
}

// alert_template already set (SHIFT's staff_alert, or a template set by hand): leave it alone.
function hasAlertTemplate(business) {
  return Boolean(business?.ai_config && business.ai_config.alert_template);
}

/**
 * Remember the request's state on the shop. Compare-and-set against what was read, so a sweep and
 * a connect writing at once cannot put an older state back.
 */
async function remember(business, state) {
  const current = (business.ai_config && business.ai_config[CONFIG_KEY]) || null;
  try {
    await jsonb.casBusinessConfig(business.id, CONFIG_KEY, current, state);
  } catch (err) {
    console.warn(`[ownerAlertTemplate] state not stored for business=${business.id}: ${err.message}`);
  }
}

/**
 * Name the template in ai_config.alert_template, once it is approved, and only while nothing else
 * is named there (compare-and-set against «missing»). Returns true when it was set.
 */
async function enable(business, { name, language }) {
  try {
    const set = await jsonb.casBusinessConfig(business.id, 'alert_template', null, { name, language });
    if (set) {
      await accountEvents.record({
        businessId: business.id, actorKind: 'meta', type: 'owner_alert_template_approved', data: { name, language },
      });
    }
    return set;
  } catch (err) {
    console.warn(`[ownerAlertTemplate] alert_template not set for business=${business.id}: ${err.message}`);
    return false;
  }
}

/** Meta's current status of the template on this WABA: {id, status} or null when there is none. */
async function fetchStatus({ wabaId, token }, { name = OWNER_ALERT_TEMPLATE_NAME, language = OWNER_ALERT_TEMPLATE_LANGUAGE } = {}) {
  const res = await axios.get(`${graphBase()}/${wabaId}/message_templates`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { name, fields: 'id,name,language,status,category' },
    timeout: GRAPH_TIMEOUT_MS,
  });
  const row = (res.data?.data || []).find((t) => t.name === name && (!t.language || t.language === language));
  return row ? { id: row.id || null, status: String(row.status || '').toUpperCase() || null } : null;
}

/**
 * Submit owner_alert to the shop's WABA. Never throws. Resolves with what happened:
 * 'skipped' (internal shop, no WABA or token, or an alert template is already set), 'approved',
 * 'pending', 'exists' (already on the WABA; its status is read instead) or 'failed'.
 */
async function submit(business, { now = new Date() } = {}) {
  try {
    if (!business || business.is_internal || business.business_type === 'shift' || hasAlertTemplate(business)) return 'skipped';
    const creds = credentials(business);
    if (!creds) return 'skipped';
    const name = OWNER_ALERT_TEMPLATE_NAME;
    const language = OWNER_ALERT_TEMPLATE_LANGUAGE;

    let id = null;
    let status = null;
    let outcome;
    try {
      const res = await axios.post(`${graphBase()}/${creds.wabaId}/message_templates`, templatePayload({ name, language }), {
        headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
        timeout: GRAPH_TIMEOUT_MS,
      });
      id = res.data?.id || null;
      status = String(res.data?.status || 'PENDING').toUpperCase();
      outcome = status === 'APPROVED' ? 'approved' : 'pending';
    } catch (err) {
      const e = graphErrorOf(err);
      if (!e || !ALREADY_EXISTS_SUBCODES.has(Number(e.error_subcode))) throw err;
      // A reconnect, or someone ran the script: the template is there, so read where it stands.
      const found = await fetchStatus(creds, { name, language });
      id = found?.id || null;
      status = found?.status || 'PENDING';
      outcome = status === 'APPROVED' ? 'approved' : 'exists';
    }

    await remember(business, { name, language, id, status, submitted_at: new Date(now).toISOString(), checked_at: new Date(now).toISOString() });
    if (status === 'APPROVED') await enable(business, { name, language });
    else {
      await accountEvents.record({
        businessId: business.id, actorKind: 'system', type: 'owner_alert_template_submitted', data: { name, language, status },
      });
    }
    return outcome === 'approved' ? 'approved' : outcome;
  } catch (err) {
    console.error(`[ownerAlertTemplate] submit failed for business=${business && business.id}: ${describe(err)}`);
    await accountEvents.record({
      businessId: business && business.id, actorKind: 'system', type: 'owner_alert_template_failed',
      data: { error_code: graphErrorOf(err)?.code ?? null, error_subcode: graphErrorOf(err)?.error_subcode ?? null },
    });
    return 'failed';
  }
}

/**
 * The call site for the connect flow: read the shop and submit. Takes only an id so the caller
 * (embeddedSignup.afterConnect) needs no knowledge of what is read. Never throws.
 */
async function submitAfterConnect(businessId, { now = new Date() } = {}) {
  try {
    if (!businessId) return 'skipped';
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true, business_type: true, is_internal: true, ai_config: true,
        wa_business_account_id: true, wa_access_token: true,
      },
    });
    return await submit(business, { now });
  } catch (err) {
    console.error(`[ownerAlertTemplate] submitAfterConnect failed for business=${businessId}: ${err.message}`);
    return 'failed';
  }
}

/**
 * The daily sweep's poll: every shop with a submitted owner_alert that Meta has not decided on yet
 * is asked again, and an approved one is named in alert_template. One shop's failure does not stop
 * the rest. Resolves with counts.
 */
async function pollPending({ now = new Date() } = {}) {
  const out = { checked: 0, approved: 0, errors: 0 };
  let shops = [];
  try {
    shops = await prisma.business.findMany({
      where: { is_internal: false, business_type: { not: 'shift' }, wa_access_token: { not: null } },
      select: {
        id: true, business_type: true, is_internal: true, ai_config: true,
        wa_business_account_id: true, wa_access_token: true,
      },
    });
  } catch (err) {
    console.warn(`[ownerAlertTemplate] poll: shops not read: ${err.message}`);
    out.errors += 1;
    return out;
  }
  for (const shop of shops) {
    const state = shop.ai_config && shop.ai_config[CONFIG_KEY];
    if (!state || hasAlertTemplate(shop)) continue;
    if (FINAL_STATUSES.has(String(state.status || '').toUpperCase()) && state.status !== 'APPROVED') continue;
    const creds = credentials(shop);
    if (!creds) continue;
    out.checked += 1;
    try {
      const found = await fetchStatus(creds, { name: state.name, language: state.language });
      const status = found?.status || state.status || null;
      await remember(shop, { ...state, id: found?.id || state.id || null, status, checked_at: new Date(now).toISOString() });
      if (status === 'APPROVED' && await enable(shop, { name: state.name || OWNER_ALERT_TEMPLATE_NAME, language: state.language || OWNER_ALERT_TEMPLATE_LANGUAGE })) {
        out.approved += 1;
      }
    } catch (err) {
      out.errors += 1;
      console.warn(`[ownerAlertTemplate] poll failed for business=${shop.id}: ${describe(err)}`);
    }
  }
  return out;
}

module.exports = {
  OWNER_ALERT_TEMPLATE_NAME,
  OWNER_ALERT_TEMPLATE_LANGUAGE,
  OWNER_ALERT_TEMPLATE_BODY,
  EXAMPLE,
  CONFIG_KEY,
  templatePayload,
  submit,
  submitAfterConnect,
  pollPending,
  fetchStatus,
};
