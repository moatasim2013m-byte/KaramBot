/**
 * SHIFT workflow vocabulary: the actions, stages and next steps the model may return, the correction
 * prompt used on a validation retry, and the Gemini responseSchema.
 *
 * Two sets live side by side: V1 is PR1's prompt path (kept for SHIFT_PROMPT_V1=1, decision D2) and the
 * unsuffixed names are prompt v2's. Callers pick one through actionSetFor() so a rollback is an env edit,
 * not a deploy.
 *
 * The schema uses plain strings identical to the SDK's SchemaType values so this file never imports
 * the SDK. It stays flat on purpose: @google/generative-ai 0.24.1 has no dependable oneOf, so the
 * per-action discrimination happens server-side in normalizeActionArgs (PR2 contract §14 #1). A schema
 * rejection must never silence the bot.
 */

const SHIFT_ACTIONS_V1 = ['NONE', 'FLAG_FOR_TEAM', 'HANDOFF_TO_HUMAN', 'CAPTURE_TIME', 'NOT_NOW', 'OPT_OUT'];
const SHIFT_ACTIONS = ['NONE', 'SEND_SAMPLE', 'START_ROLEPLAY', 'END_ROLEPLAY', 'FLAG_FOR_TEAM', 'HANDOFF_TO_HUMAN',
  'CAPTURE_TIME', 'NOT_NOW', 'OPT_OUT'];
const STAGES = ['opening', 'discovery', 'fit', 'sample', 'roleplay_setup', 'roleplay', 'objection', 'close', 'captured', 'handoff', 'closed'];
// What the model may propose. `roleplay` is entered only through START_ROLEPLAY; `captured`/`handoff`
// only by the server after the state they describe is written.
const MODEL_STAGES_V1 = ['opening', 'discovery', 'fit', 'objection', 'close', 'closed'];
const MODEL_STAGES = ['opening', 'discovery', 'fit', 'sample', 'roleplay_setup', 'objection', 'close', 'closed'];
const NEXT_STEPS = ['question', 'buttons', 'confirmed', 'terminal'];
const FLAG_REASONS = ['quote', 'meeting', 'demo', 'complaint', 'unknown'];
const HANDOFF_REASONS = ['person', 'complaint', 'abuse'];
const SAMPLE_SECTORS = ['clinic', 'restaurant', 'store', 'other'];

const CORRECTION_PROMPT_V1 = `يجب أن يكون ردك JSON فقط بهذا الشكل بالضبط، بدون أي نص إضافي:
{"reply":"نص الرد","action":"NONE","action_args":{},"buttons":[],"lead":{},"stage":"discovery","next_step":"question"}
action واحد من: NONE, FLAG_FOR_TEAM, HANDOFF_TO_HUMAN, CAPTURE_TIME, NOT_NOW, OPT_OUT
stage واحد من: opening, discovery, fit, objection, close, closed
next_step واحد من: question, buttons, confirmed, terminal
أعد المحاولة الآن.`;

const CORRECTION_PROMPT = `يجب أن يكون ردك JSON فقط بهذا الشكل بالضبط، بدون أي نص إضافي:
{"reply":"نص الرد","action":"NONE","action_args":{},"buttons":[],"lead":{},"stage":"discovery","next_step":"question"}
action واحد من: ${SHIFT_ACTIONS.join(', ')}
stage واحد من: ${MODEL_STAGES.join(', ')}
next_step واحد من: ${NEXT_STEPS.join(', ')}
أعد المحاولة الآن.`;

const str = (extra = {}) => ({ type: 'string', nullable: true, ...extra });
const en = (values) => ({ type: 'string', format: 'enum', enum: values });

const BUTTONS_SCHEMA = {
  type: 'array',
  nullable: true,
  maxItems: 3,
  items: {
    type: 'object',
    properties: { id: { type: 'string' }, title: { type: 'string' } },
    required: ['id', 'title'],
  },
};

const LEAD_SCHEMA = {
  type: 'object',
  nullable: true,
  properties: {
    name: str(),
    business_name: str(),
    sector: str(),
    sector_text: str(),
    city: str(),
    need: str(),
    products: { type: 'array', nullable: true, items: { type: 'string' } },
    preferred_time: str(),
    language: str(),
    budget_note: str(),
    objection: str(),
    interest: str(),
  },
};

const RESPONSE_SCHEMA_V1 = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    action: en(SHIFT_ACTIONS_V1),
    action_args: {
      type: 'object',
      nullable: true,
      properties: { reason: str(), summary: str(), time_text: str() },
    },
    buttons: BUTTONS_SCHEMA,
    lead: LEAD_SCHEMA,
    stage: en(MODEL_STAGES_V1),
    next_step: en(NEXT_STEPS),
  },
  required: ['reply', 'action'],
};

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    action: en(SHIFT_ACTIONS),
    action_args: {
      type: 'object',
      nullable: true,
      properties: {
        sector: str(),
        business_name: str(),
        facts: { type: 'array', nullable: true, items: { type: 'string' } },
        reason: str(),
        summary: str(),
        time_text: str(),
      },
    },
    buttons: BUTTONS_SCHEMA,
    lead: LEAD_SCHEMA,
    stage: en(MODEL_STAGES),
    next_step: en(NEXT_STEPS),
  },
  required: ['reply', 'action', 'stage', 'next_step'],
};

/**
 * The vocabulary for the prompt path in force. Read at call time so an env edit on Cloud Run (or a
 * test setting it per case) applies without a code change.
 */
function actionSetFor(env = process.env) {
  if (env && env.SHIFT_PROMPT_V1 === '1') {
    return { actions: SHIFT_ACTIONS_V1, stages: MODEL_STAGES_V1, schema: RESPONSE_SCHEMA_V1, correctionPrompt: CORRECTION_PROMPT_V1 };
  }
  return { actions: SHIFT_ACTIONS, stages: MODEL_STAGES, schema: RESPONSE_SCHEMA, correctionPrompt: CORRECTION_PROMPT };
}

// Code-point aware cut so an Arabic letter or emoji is never split in half.
function cut(value, max) {
  const chars = Array.from(value);
  return chars.length > max ? chars.slice(0, max).join('') : value;
}

function text(value, max) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return cut(String(value).trim(), max).trim();
}

// The model writes the sector in whatever words the customer used; the server only knows four.
const SECTOR_WORDS = [
  [/مطعم|مطاعم|كافيه|كافي|مقهى|كوفي|restaurant|cafe|café|coffee/i, 'restaurant'],
  [/عيادة|عيادات|clinic/i, 'clinic'],
  [/متجر|متاجر|store|shop/i, 'store'],
];

function normalizeSector(value) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!s) return 'other';
  if (SAMPLE_SECTORS.includes(s)) return s;
  for (const [re, sector] of SECTOR_WORDS) if (re.test(s)) return sector;
  return 'other';
}

function normalizeFacts(value) {
  const list = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
  const out = [];
  for (const item of list) {
    const fact = text(item, 200);
    if (fact) out.push(fact);
    if (out.length === 8) break;
  }
  return out;
}

/**
 * Pure, per-action discrimination of the flat action_args (contract §2.3). `ok:false` means the action
 * cannot run with what the model gave; results.js then treats it as NONE and keeps the model line.
 */
function normalizeActionArgs(action, args) {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  switch (action) {
    case 'SEND_SAMPLE':
      return { ok: true, args: { sector: normalizeSector(a.sector) } };
    case 'START_ROLEPLAY': {
      const businessName = text(a.business_name, 80);
      const out = { sector: normalizeSector(a.sector), business_name: businessName, facts: normalizeFacts(a.facts) };
      return businessName ? { ok: true, args: out } : { ok: false, args: out, reason: 'no_business_name' };
    }
    case 'FLAG_FOR_TEAM':
      return {
        ok: true,
        args: { reason: FLAG_REASONS.includes(a.reason) ? a.reason : 'unknown', summary: text(a.summary, 200) },
      };
    case 'HANDOFF_TO_HUMAN':
      return {
        ok: true,
        args: { reason: HANDOFF_REASONS.includes(a.reason) ? a.reason : 'person', summary: text(a.summary, 200) },
      };
    case 'CAPTURE_TIME':
      // Whether a capture can complete is PR1's logic (name/business known); only the shape is fixed here.
      return { ok: true, args: { time_text: text(a.time_text, 120) } };
    case 'NONE':
    case 'NOT_NOW':
    case 'OPT_OUT':
    case 'END_ROLEPLAY':
      return { ok: true, args: {} };
    default:
      return { ok: false, args: {}, reason: 'unknown_action' };
  }
}

module.exports = {
  SHIFT_ACTIONS_V1,
  SHIFT_ACTIONS,
  STAGES,
  MODEL_STAGES_V1,
  MODEL_STAGES,
  NEXT_STEPS,
  FLAG_REASONS,
  HANDOFF_REASONS,
  SAMPLE_SECTORS,
  CORRECTION_PROMPT_V1,
  CORRECTION_PROMPT,
  RESPONSE_SCHEMA_V1,
  RESPONSE_SCHEMA,
  actionSetFor,
  normalizeActionArgs,
  normalizeSector,
};
