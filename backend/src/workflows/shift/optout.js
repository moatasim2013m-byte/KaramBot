/**
 * Deterministic opt-out. Only a short whole-message command counts («إيقاف», «مش مهتم.»); a sentence
 * that merely contains the words («مش مهتم بالولاء بس بكرم») goes to the model, which reads negation.
 */

const acks = require('./acks');
const { normalizeArabic } = require('./handoff');

const OPT_OUT_RE = /^(ايقاف|stop|unsubscribe|لا تبعتولي( شي| اشي)?|لا تبعتو|لا تبعتوا|مش مهتم|مش مهتمه|وقف(وا)? (بعت |ارسال )?(ال)?(رسايل|رسائل))$/i;
const MAX_WORDS = 4;

function normalizeCommand(text) {
  return normalizeArabic(text).replace(/[.!؟?،,…\s]+$/, '').replace(/^\s+/, '');
}

function isOptOutCommand(text) {
  const command = normalizeCommand(text);
  if (!command) return false;
  if (command.split(' ').length > MAX_WORDS) return false;
  return OPT_OUT_RE.test(command);
}

function optOutResult({ conversation, lang = 'ar', now = new Date() } = {}) {
  // Status is left alone: a pending handoff stays on the team's list after the customer opts out.
  return {
    kind: 'optout',
    action: 'OPT_OUT',
    messages: [{ type: 'text', text: acks.optOut(lang) }],
    stateUpdate: { current_state: 'closed' },
    workflowDataPatch: { marketing_opted_out_at: now.toISOString(), followups: [], capture_pending: null },
    leadPatch: null,
    leadMeta: null,
    needsTeam: null,
    alert: null,
  };
}

module.exports = { normalizeCommand, isOptOutCommand, optOutResult, OPT_OUT_RE };
