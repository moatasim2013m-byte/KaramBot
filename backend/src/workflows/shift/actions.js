/**
 * SHIFT workflow vocabulary: the actions, stages and next steps the model may return, the correction
 * prompt used on a validation retry, and the Gemini responseSchema.
 *
 * The schema uses plain strings identical to the SDK's SchemaType values so this file never imports
 * the SDK. Reasons, sectors and the like are free strings here and normalised server-side: a schema
 * rejection must never silence the bot.
 */

const SHIFT_ACTIONS = ['NONE', 'FLAG_FOR_TEAM', 'HANDOFF_TO_HUMAN', 'CAPTURE_TIME', 'NOT_NOW', 'OPT_OUT'];
const STAGES = ['opening', 'discovery', 'fit', 'sample', 'roleplay_setup', 'roleplay', 'objection', 'close', 'captured', 'handoff', 'closed'];
// What the model may propose in PR1; sample/roleplay arrive in PR2, captured/handoff are set by the server.
const MODEL_STAGES = ['opening', 'discovery', 'fit', 'objection', 'close', 'closed'];
const NEXT_STEPS = ['question', 'buttons', 'confirmed', 'terminal'];
const FLAG_REASONS = ['quote', 'meeting', 'demo', 'complaint', 'unknown'];
const HANDOFF_REASONS = ['person', 'complaint', 'abuse'];

const CORRECTION_PROMPT = `يجب أن يكون ردك JSON فقط بهذا الشكل بالضبط، بدون أي نص إضافي:
{"reply":"نص الرد","action":"NONE","action_args":{},"buttons":[],"lead":{},"stage":"discovery","next_step":"question"}
action واحد من: NONE, FLAG_FOR_TEAM, HANDOFF_TO_HUMAN, CAPTURE_TIME, NOT_NOW, OPT_OUT
stage واحد من: opening, discovery, fit, objection, close, closed
next_step واحد من: question, buttons, confirmed, terminal
أعد المحاولة الآن.`;

const str = (extra = {}) => ({ type: 'string', nullable: true, ...extra });
const en = (values) => ({ type: 'string', format: 'enum', enum: values });

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    action: en(SHIFT_ACTIONS),
    action_args: {
      type: 'object',
      nullable: true,
      properties: { reason: str(), summary: str(), time_text: str() },
    },
    buttons: {
      type: 'array',
      nullable: true,
      maxItems: 3,
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, title: { type: 'string' } },
        required: ['id', 'title'],
      },
    },
    lead: {
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
    },
    stage: en(MODEL_STAGES),
    next_step: en(NEXT_STEPS),
  },
  required: ['reply', 'action'],
};

module.exports = {
  SHIFT_ACTIONS,
  STAGES,
  MODEL_STAGES,
  NEXT_STEPS,
  FLAG_REASONS,
  HANDOFF_REASONS,
  CORRECTION_PROMPT,
  RESPONSE_SCHEMA,
};
