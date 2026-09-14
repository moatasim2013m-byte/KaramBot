/**
 * SHIFT handoff: detecting an explicit request for a person and building the handoff result.
 *
 * A handoff never turns the AI off (only staff /claim does) and never offers buttons: the customer
 * asked for a person, so the bot confirms the request is on the team's list and stays available.
 * The patterns require a person as the object («بدي أحكي مع إنسان»); bare nouns such as «موظف» or
 * «عندي موظفة بترد» go to the model instead (design §7.1).
 */

const acks = require('./acks');

const OBJ = '(حد|حدا|انسان|موظف|شخص|بني ادم|بشر|المدير|مدير|المسؤول|صاحب الشركه|صاحب الشركة|الفريق|حدا من الفريق)';
const REQUEST_PATTERNS = [
  new RegExp(`بدي (احكي|اتكلم|اتواصل) مع ${OBJ}`),
  new RegExp(`خليني (احكي|اتكلم) مع ${OBJ}`),
  /حول(ني|وني) ?(ل|على|عل)/,
  /وين (الموظف|الموظفين|الفريق|المسؤول)/,
  /بدي (المدير|المسؤول|صاحب الشركه|صاحب الشركة)/,
  /\b(talk|speak|chat) (to|with) (a |an |the |your )?(human|person|someone|agent|manager|owner|team|real person)\b/i,
  /\b(transfer|connect) me\b/i,
];
// Mentions of a person that do not ask for someone from SHIFT: the customer checking with their own
// side first («خليني احكي مع المدير تبعي وبرجعلك» — the «بحكيك» objection) or asking to be sent to
// the site. These go to the model, which can still hand off.
const NOT_A_REQUEST = [
  /(المدير|مدير|المسؤول|صاحب الشركه|صاحب الشركة|الفريق|شريكي) ?(تبعي|تبعنا|تبعتي|تبعتنا)/,
  /(برجعلك|برجع لك|برجعلكم|بردلك|برد عليك|بخبرك|بحكيلك)/,
  /حول(ني|وني) ?(ل|علي|عل)? ?(ال|ل)?(موقع|صفح|رابط|لينك|ويب|سايت)/,
  /\b(get back|let you know)\b/i,
  /\b(my|our) (manager|owner|team|boss|partner)\b/i,
];

function normalizeArabic(text) {
  return String(text == null ? '' : text)
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function detectHumanRequest(text) {
  const normalized = normalizeArabic(text);
  if (!normalized) return false;
  if (NOT_A_REQUEST.some((re) => re.test(normalized))) return false;
  return REQUEST_PATTERNS.some((re) => re.test(normalized));
}

function isHandoffOpen(conversation) {
  const wd = (conversation && conversation.workflow_data) || {};
  return Boolean(conversation && conversation.status === 'pending' && wd.handoff?.requested_at && !wd.needs_team?.resolved_at);
}

function joinParts(...parts) {
  return parts.filter(Boolean).join('\n\n');
}

function buildHandoff({ business, conversation, now = new Date(), lang = 'ar', teamHours, reason = 'person', tier = 1, summary = '', modelLine }) {
  // Lazy: results.js requires this module at load time, so a top-level require would be circular.
  const { mergeNeedsTeam, needsTeamEntry } = require('./results');
  const wd = (conversation && conversation.workflow_data) || {};
  const botTurns = (wd.bot_turns || 0) + 1;

  if (isHandoffOpen(conversation)) {
    // Already on the team's list: say so again instead of re-alerting staff.
    const text = tier === 2 && modelLine ? modelLine : acks.handoffRepeat(lang);
    return {
      kind: 'handoff',
      action: 'HANDOFF_TO_HUMAN',
      messages: [{ type: 'text', text }],
      stateUpdate: {},
      workflowDataPatch: { bot_turns: botTurns },
      leadPatch: null,
      leadMeta: null,
      needsTeam: null,
      alert: null,
    };
  }

  const at = now.toISOString();
  const cleanSummary = String(summary || '').slice(0, 200);
  const ack = acks.handoffAck({ teamHours, contact: business?.ai_config?.contact, now, lang });
  const needs = mergeNeedsTeam(wd.needs_team, needsTeamEntry(reason === 'complaint' ? 'complaint' : 'person', cleanSummary, at));

  return {
    kind: 'handoff',
    action: 'HANDOFF_TO_HUMAN',
    messages: [{ type: 'text', text: joinParts(modelLine, ack) }],
    stateUpdate: { status: 'pending', current_state: 'handoff' },
    workflowDataPatch: {
      handoff: { requested_at: at, reason, tier },
      human_requested_at: at,
      capture_pending: null,
      bot_turns: botTurns,
      ...(needs && { needs_team: needs }),
    },
    leadPatch: null,
    leadMeta: null,
    needsTeam: needs,
    alert: { reason: 'handoff', summary: cleanSummary },
  };
}

module.exports = { normalizeArabic, detectHumanRequest, isHandoffOpen, buildHandoff, REQUEST_PATTERNS };
