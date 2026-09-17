require('./setup');

jest.mock('../src/ai/provider', () => ({ generateValidatedAIReply: jest.fn() }));
jest.mock('../src/config/prisma', () => ({ message: { findMany: jest.fn() } }));

const { generateValidatedAIReply } = require('../src/ai/provider');
const prisma = require('../src/config/prisma');
const {
  processShiftMessage, processShiftBatch, buildSystemPrompt, formatHistory, toWorkflowResult, batchLine, SHIFT_ACTIONS,
} = require('../src/workflows/shift');
const { SHIFT_ACTIONS_V1, RESPONSE_SCHEMA, RESPONSE_SCHEMA_V1 } = require('../src/workflows/shift/actions');
const { CONCIERGE } = require('../src/workflows/shift/objectives');
const { OPERATIONAL_FAQ } = require('../src/workflows/shift/prompt.ar');
const acks = require('../src/workflows/shift/acks');
const hours = require('../src/workflows/shift/hours');
const buttons = require('../src/workflows/shift/buttons');
const { mergeNeedsTeam, nextStage, sanitizeButtons, compose } = require('../src/workflows/shift/results');

const business = { id: 'b1', name: 'SHIFT AI & Automation', ai_config: {} };
const conversation = { id: 'c1' };
// Monday 14 Sep 2026, 11:00 Amman — inside default team hours.
const MON_11 = new Date('2026-09-14T11:00:00+03:00');
const TH = hours.DEFAULT_TEAM_HOURS;

function conv(fields = {}) {
  return { id: 'c1', status: 'open', current_state: 'discovery', workflow_data: {}, ...fields };
}

function ctx(fields = {}) {
  return { business, conversation: conv(), batchMessages: [{ id: 'm1', message_type: 'text', text_body: 'مرحبا' }], now: MON_11, lang: 'ar', ...fields };
}

describe('SHIFT workflow — prompt', () => {
  test('carries the product knowledge, the official domain and the no-prices rule', () => {
    const p = buildSystemPrompt(business, '');
    expect(p).toContain('كرم بوت');
    expect(p).toContain('https://shifts-ai.com');
    expect(p).not.toMatch(/shifts-ai\.store/);   // D4: the old domain never appears
    expect(p).toContain('لا تذكر أسعارًا');
    expect(p).toContain('HANDOFF_TO_HUMAN');
    expect(p).toContain('shifts-ai.com/privacy');
  });

  test('lists the slot offers, the stage and Amman time', () => {
    const offers = [{ id: 'slot:2026-09-14T16:00+03:00/18:00', title: 'اليوم 4–6' }];
    const p = buildSystemPrompt(business, 'العميل: مرحبا', { now: MON_11, offers, stage: 'fit' });
    expect(p).toContain('slot:2026-09-14T16:00+03:00/18:00 «اليوم 4–6»');
    expect(p).toContain('المرحلة الحالية: fit · الوقت الآن بتوقيت عمّان: الاثنين 14/9 11:00');
    expect(p).toContain('العميل: مرحبا');
  });

  test('formats history oldest first and skips empty bodies', () => {
    const text = formatHistory([
      { direction: 'inbound', text_body: 'مرحبا' },
      { direction: 'outbound', text_body: null },
      { direction: 'outbound', text_body: 'أهلًا' },
    ]);
    expect(text).toBe('العميل: مرحبا\nشِفت: أهلًا');
  });

  test('batchLine uses media placeholders', () => {
    expect(batchLine({ message_type: 'text', text_body: 'هلا' })).toBe('هلا');
    expect(batchLine({ message_type: 'audio', text_body: null })).toBe('[رسالة صوتية]');
    expect(batchLine({ message_type: 'image', text_body: null }, 'en')).toBe('[image]');
    expect(batchLine({ message_type: 'location', text_body: null })).toBe('[موقع]');
    expect(batchLine({ message_type: 'interactive', text_body: 'بكرا 10–12' })).toBe('بكرا 10–12');
  });
});

describe('SHIFT workflow — results', () => {
  test('NONE keeps AI on', () => {
    const r = toWorkflowResult({ reply: ' أهلًا ', action: 'NONE' });
    expect(r.messages[0].text).toBe('أهلًا');
    expect(r.messages).toHaveLength(1);
    expect(r.stateUpdate).not.toHaveProperty('ai_enabled');
    expect(r.kind).toBe('reply');
  });

  test('HANDOFF_TO_HUMAN marks the conversation pending without turning AI off', () => {
    const r = toWorkflowResult(
      { reply: 'ولا يهمك.', action: 'HANDOFF_TO_HUMAN', action_args: { reason: 'person', summary: 'بدو يحكي مع المدير' } },
      ctx(),
    );
    expect(r.stateUpdate).toEqual({ status: 'pending', current_state: 'handoff' });
    expect(r.stateUpdate).not.toHaveProperty('ai_enabled');
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].type).toBe('text');
    expect(r.messages[0]).not.toHaveProperty('buttons');
    expect(r.messages[0].text).toBe(`ولا يهمك.\n\n${acks.handoffAck({ teamHours: TH, now: MON_11, lang: 'ar' })}`);
    expect(r.alert.reason).toBe('handoff');
    expect(r.workflowDataPatch.needs_team.reason).toBe('person');
    expect(r.workflowDataPatch.handoff).toEqual({ requested_at: MON_11.toISOString(), reason: 'person', tier: 2 });
  });

  test('HANDOFF_TO_HUMAN while a handoff is open repeats the model line only', () => {
    const open = conv({ status: 'pending', current_state: 'handoff', workflow_data: { handoff: { requested_at: 'x' }, needs_team: { reason: 'person', resolved_at: null } } });
    const r = toWorkflowResult({ reply: 'حقك تحكي مع شخص.', action: 'HANDOFF_TO_HUMAN', action_args: {} }, ctx({ conversation: open }));
    expect(r.messages[0].text).toBe('حقك تحكي مع شخص.');
    expect(r.alert).toBeNull();
    expect(r.stateUpdate).toEqual({});
  });

  test('AI failure mid-conversation with no time chosen → fallback with slot buttons, pending, needs_team ai_failure', () => {
    const c = conv({ workflow_data: { bot_turns: 2, lead: { name: 'محمد' } } });
    const r = toWorkflowResult(null, ctx({ conversation: c }));
    expect(r.kind).toBe('fallback');
    expect(r.action).toBe('AI_FAILURE');
    expect(r.stateUpdate).toEqual({ status: 'pending' });
    expect(r.workflowDataPatch.needs_team.reason).toBe('ai_failure');
    expect(r.workflowDataPatch.bot_turns).toBe(3);
    expect(r.messages[0].type).toBe('interactive');
    expect(r.messages[0].buttons).toHaveLength(3);
    expect(r.messages[0].buttons).toEqual(buttons.slotOffers(TH, MON_11, 'ar').map((o) => ({ id: o.id, title: o.title })));
    expect(r.messages[0].text).toBe(acks.aiFailure('ar', { withButtons: true }));
    expect(r.workflowDataPatch.slot_offers).toHaveLength(3);
    expect(r.workflowDataPatch.slot_offers[0].issued_at).toBe(MON_11.toISOString());
    expect(r.alert.reason).toBe('ai_failure');
    expect(JSON.stringify(r)).not.toContain('ai_enabled');
  });

  // Hotfix 2026-09-15: a call offer on a bare «مرحبا», or again right after a slot tap, read as broken.
  describe('AI failure slot buttons only mid-conversation with no time chosen', () => {
    const expectTextFallback = (r, lang = 'ar') => {
      expect(r.kind).toBe('fallback');
      expect(r.messages).toEqual([{ type: 'text', text: acks.aiFailure(lang, { withButtons: false }) }]);
      expect(r.workflowDataPatch).not.toHaveProperty('slot_offers');
      expect(r.stateUpdate).toEqual({ status: 'pending' });
      expect(r.workflowDataPatch.needs_team.reason).toBe('ai_failure');
      expect(r.alert.reason).toBe('ai_failure');
    };

    test('the very first turn (bot_turns 0) → text fallback, no buttons', () => {
      const r = toWorkflowResult(null, ctx({ conversation: conv({ current_state: null, workflow_data: {} }) }));
      expectTextFallback(r);
      expect(r.workflowDataPatch.bot_turns).toBe(1);
    });

    test('the first turn in English → English text fallback, no buttons', () => {
      const r = toWorkflowResult(null, ctx({
        conversation: conv({ current_state: null, workflow_data: { bot_turns: 0 } }),
        batchMessages: [{ id: 'm1', message_type: 'text', text_body: 'Hi' }],
        lang: 'en',
      }));
      expectTextFallback(r, 'en');
    });

    test('lead.preferred_time already stored → no buttons', () => {
      const c = conv({
        current_state: 'captured',
        workflow_data: { bot_turns: 4, lead: { name: 'محمد', preferred_time: { text: 'بكرا بين 10 و12', slot_id: 'slot:2026-09-15T10:00+03:00/12:00' } } },
      });
      expectTextFallback(toWorkflowResult(null, ctx({ conversation: c })));
    });

    test('capture_pending (a slot was just tapped) → no buttons', () => {
      const c = conv({
        current_state: 'close',
        workflow_data: { bot_turns: 3, capture_pending: { slot_id: 'slot:2026-09-14T16:00+03:00/18:00', time_text: null, at: MON_11.toISOString() } },
      });
      expectTextFallback(toWorkflowResult(null, ctx({ conversation: c })));
    });

    test('the button text invites a time pick; the text variant does not', () => {
      expect(acks.aiFailure('ar', { withButtons: true })).not.toBe(acks.aiFailure('ar'));
      expect(acks.aiFailure('en', { withButtons: true })).toMatch(/pick a time/);
      expect(acks.aiFailure('en')).not.toMatch(/pick a time|call/);
    });
  });

  test('AI failure during a handoff keeps the open person request and sends no buttons', () => {
    const c = conv({ status: 'pending', current_state: 'handoff', workflow_data: { needs_team: { reason: 'person', resolved_at: null } } });
    const r = toWorkflowResult(null, ctx({ conversation: c }));
    expect(r.messages[0]).toEqual({ type: 'text', text: acks.aiFailure('ar', { withButtons: false }) });
    expect(r.workflowDataPatch).not.toHaveProperty('needs_team');
    expect(r.needsTeam).toBeNull();
  });

  test('FLAG_FOR_TEAM quote → pending, needs_team and the flag ack', () => {
    const r = toWorkflowResult(
      { reply: 'حتى الرقم التقريبي ما بقدر أخمّنه عليك.', action: 'FLAG_FOR_TEAM', action_args: { reason: 'quote', summary: 'بدو سعر تقريبي' }, stage: 'fit' },
      ctx(),
    );
    expect(r.stateUpdate).toEqual({ status: 'pending', current_state: 'fit' });
    expect(r.workflowDataPatch.needs_team).toMatchObject({ reason: 'quote', summary: 'بدو سعر تقريبي', resolved_at: null });
    expect(r.messages[0].text).toBe(`حتى الرقم التقريبي ما بقدر أخمّنه عليك.\n\n${acks.flagAck('quote', { teamHours: TH, lang: 'ar' })}`);
    expect(r.alert).toEqual({ reason: 'quote', summary: 'بدو سعر تقريبي' });
  });

  test('duplicate quote while the first is unresolved → no ack, no alert', () => {
    const c = conv({ status: 'pending', workflow_data: { needs_team: { reason: 'quote', resolved_at: null } } });
    const r = toWorkflowResult({ reply: 'الفريق عنده طلبك.', action: 'FLAG_FOR_TEAM', action_args: { reason: 'quote' } }, ctx({ conversation: c }));
    expect(r.messages[0].text).toBe('الفريق عنده طلبك.');
    expect(r.alert).toBeNull();
    expect(r.workflowDataPatch).not.toHaveProperty('needs_team');
    expect(r.stateUpdate.status).toBe('pending');
  });

  test('FLAG_FOR_TEAM with an unknown reason becomes unknown with the generic ack', () => {
    const r = toWorkflowResult({ reply: 'سؤال حلو.', action: 'FLAG_FOR_TEAM', action_args: { reason: 'weird' } }, ctx());
    expect(r.workflowDataPatch.needs_team.reason).toBe('unknown');
    expect(r.messages[0].text).toContain(acks.flagAck('other', { teamHours: TH, lang: 'ar' }));
    expect(r.alert.reason).toBe('needs_team');
  });

  test('CAPTURE_TIME with the name known → captured and captureAck', () => {
    const c = conv({ workflow_data: { lead: { name: 'محمد', version: 1 } } });
    const r = toWorkflowResult(
      { reply: 'تمام.', action: 'CAPTURE_TIME', action_args: { time_text: 'بكرا الساعة 5' }, lead: {} },
      // The customer's own words carry the time: the model's time_text alone is never recorded (owner phone test).
      ctx({ conversation: c, batchMessages: [{ id: 'm1', message_type: 'text', text_body: 'بكرا الساعة 5 بناسبني' }] }),
    );
    expect(r.action).toBe('CAPTURE_TIME');
    expect(r.stateUpdate).toEqual({ status: 'pending', current_state: 'captured' });
    expect(r.messages[0].text).toBe(`تمام.\n\n${acks.captureAck({ name: 'محمد', when: 'بكرا الساعة 5', lang: 'ar' })}`);
    expect(r.messages[0].text).toContain('سجّلت طلب مكالمة: محمد، بكرا الساعة 5 بتوقيت عمّان');
    expect(r.workflowDataPatch.capture_pending).toBeNull();
    expect(r.workflowDataPatch.needs_team.reason).toBe('meeting');
    expect(r.leadPatch.preferred_time).toBe('بكرا الساعة 5');   // mergeLead turns a string into {text}
    expect(r.alert).toEqual({ reason: 'meeting', summary: 'بكرا الساعة 5' });
  });

  test('CAPTURE_TIME without name or business asks for them and keeps the time pending', () => {
    const r = toWorkflowResult(
      { reply: 'تمام.', action: 'CAPTURE_TIME', action_args: { time_text: 'الأحد العصر' } },
      ctx({ batchMessages: [{ id: 'm1', message_type: 'text', text_body: 'خليها الأحد العصر' }] }),
    );
    expect(r.messages[0].text).toBe(acks.captureAsk({ nameKnown: false, businessKnown: false, lang: 'ar' }));
    expect(r.stateUpdate).toEqual({ current_state: 'close' });
    expect(r.workflowDataPatch.capture_pending).toEqual({ slot_id: null, time_text: 'الأحد العصر', at: MON_11.toISOString() });
  });

  test('OPT_OUT replaces the model line with the fixed ack', () => {
    const r = toWorkflowResult({ reply: 'تمام ما رح نزعجك', action: 'OPT_OUT' }, ctx());
    expect(r.messages[0].text).toBe(acks.optOut('ar'));
    expect(r.stateUpdate).toEqual({ current_state: 'closed' });
    expect(r.workflowDataPatch).toMatchObject({ marketing_opted_out_at: MON_11.toISOString(), followups: [], capture_pending: null });
    expect(r.kind).toBe('optout');
  });

  test('NOT_NOW keeps the model line and closes', () => {
    const r = toWorkflowResult({ reply: 'على راحتك.', action: 'NOT_NOW' }, ctx());
    expect(r.messages[0].text).toBe('على راحتك.');
    expect(r.stateUpdate).toEqual({ current_state: 'closed' });
    expect(r.workflowDataPatch.not_now_at).toBe(MON_11.toISOString());
  });

  test('NONE with offered slot ids → interactive message and slot_offers', () => {
    const r = toWorkflowResult({
      reply: 'أقرب أوقات الفريق:',
      action: 'NONE',
      buttons: [{ id: 'slot:2026-09-15T10:00+03:00/12:00', title: 'غلط' }, { id: 'made-up', title: 'x' }],
    }, ctx());
    // PR2 §9.2 step 1: a part built from the model's reply carries its words as `modelLine`.
    expect(r.messages[0]).toEqual({
      type: 'interactive',
      text: 'أقرب أوقات الفريق:',
      buttons: [{ id: 'slot:2026-09-15T10:00+03:00/12:00', title: 'بكرا 10–12' }],
      modelLine: 'أقرب أوقات الفريق:',
    });
    expect(r.workflowDataPatch.slot_offers[0]).toMatchObject({ id: 'slot:2026-09-15T10:00+03:00/12:00', issued_at: MON_11.toISOString() });
  });

  test('capture_pending + next batch → capture ack with the missing segments omitted', () => {
    const c = conv({
      current_state: 'close',
      workflow_data: {
        capture_pending: { slot_id: 'slot:2026-09-15T10:00+03:00/12:00', time_text: null, at: 'x' },
        lead: {
          version: 1,
          preferred_time: { text: 'بكرا بين 10 و12 (الثلاثاء 15/9)', start: '2026-09-15T07:00:00.000Z', end: '2026-09-15T09:00:00.000Z', tz: 'Asia/Amman', slot_id: 'slot:2026-09-15T10:00+03:00/12:00' },
        },
      },
    });
    const r = toWorkflowResult(
      { reply: 'أهلين محمد!', action: 'NONE', lead: { name: 'محمد' } },
      ctx({ conversation: c, batchMessages: [{ id: 'm9', message_type: 'text', text_body: 'محمد' }] }),
    );
    expect(r.action).toBe('CAPTURE_TIME');
    expect(r.messages[0].text).toBe(acks.captureAck({ name: 'محمد', when: 'بكرا بين 10 و12 (الثلاثاء 15/9)', lang: 'ar' }));
    expect(r.messages[0].text).not.toContain('أهلين');
    expect(r.messages[0].text).not.toMatch(/،\s*،|:\s*،/);
    expect(r.stateUpdate.current_state).toBe('captured');
    expect(r.leadPatch.name).toBe('محمد');
    expect(r.leadMeta).toMatchObject({ source: 'model', msgId: 'm9' });
  });

  test('disclosed_at is set once the canonical intro was sent', () => {
    const r = toWorkflowResult({ reply: 'أنا كرم، مساعد شِفت الذكي (shifts-ai.com) — شو نوع منشأتك؟', action: 'NONE' }, ctx({ conversation: conv({ current_state: null }) }));
    expect(r.workflowDataPatch.disclosed_at).toBe(MON_11.toISOString());
    expect(r.workflowDataPatch.bot_turns).toBe(1);
    expect(r.stateUpdate.current_state).toBe('opening');
  });

  test('mergeNeedsTeam priority, nextStage and sanitizeButtons', () => {
    expect(mergeNeedsTeam(null, { reason: 'quote' })).toEqual({ reason: 'quote' });
    expect(mergeNeedsTeam({ reason: 'person', resolved_at: null }, { reason: 'ai_failure' })).toBeNull();
    expect(mergeNeedsTeam({ reason: 'quote', resolved_at: null }, { reason: 'meeting' })).toEqual({ reason: 'meeting' });
    expect(mergeNeedsTeam({ reason: 'person', resolved_at: 'x' }, { reason: 'demo' })).toEqual({ reason: 'demo' });
    expect(nextStage('handoff', 'fit', 'NONE')).toBeUndefined();
    expect(nextStage('handoff', 'fit', 'OPT_OUT')).toBe('closed');
    expect(nextStage('discovery', 'closed', 'NONE')).toBeUndefined();
    expect(nextStage(null, undefined, 'NONE')).toBe('opening');
    expect(sanitizeButtons([{ id: 'a' }, { id: 'a' }], [{ id: 'a', title: 'A' }])).toEqual([{ id: 'a', title: 'A' }]);
  });

  test('compose cuts the model line, never the ack', () => {
    const ack = 'ACK';
    const text = compose('x'.repeat(5000), ack);
    expect(Array.from(text)).toHaveLength(4096);
    expect(text.endsWith('\n\nACK')).toBe(true);
  });
});

describe('SHIFT workflow — processShiftBatch', () => {
  const HISTORY_ROWS = [
    { id: 'm2', direction: 'inbound', text_body: 'بإربد' },
    { id: 'm1', direction: 'inbound', text_body: 'عندي كافيه' },
    { id: 'o1', direction: 'outbound', text_body: 'أهلين', is_ai_generated: true },
    { id: 'm0', direction: 'inbound', text_body: 'مرحبا' },
  ];
  const BATCH = [
    { id: 'm1', message_type: 'text', text_body: 'عندي كافيه' },
    { id: 'm2', message_type: 'text', text_body: 'بإربد' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SHIFT_PROMPT_V1;
    prisma.message.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    delete process.env.SHIFT_PROMPT_V1;
  });

  // §12.3 #1: prompt v2 moves the history out of the system prompt into the user turn.
  test('passes jsonMode, validActions, deadlineAt; history and the batch are in the user turn (prompt v2)', async () => {
    prisma.message.findMany.mockResolvedValue(HISTORY_ROWS);
    generateValidatedAIReply.mockResolvedValue({ reply: 'حلو! شو اسم الكافيه؟', action: 'NONE', buttons: [], lead: { city: 'إربد' } });
    const onRetry = jest.fn();
    const deadlineAt = Date.now() + 18000;

    const r = await processShiftBatch(business, conv(), BATCH, { now: MON_11, deadlineAt, onRetry });

    expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 14, orderBy: { created_at: 'desc' } }));
    const [prompt, userMessage, history, opts] = generateValidatedAIReply.mock.calls[0];
    expect(history).toEqual([]);
    expect(userMessage).toContain('العميل: "مرحبا"\nكرم: أهلين');
    expect(userMessage).toContain('["عندي كافيه","بإربد"]');
    expect(userMessage).not.toContain('العميل: "عندي كافيه"');
    expect(prompt).not.toContain('العميل: مرحبا');
    expect(prompt).not.toContain('أهلين');
    expect(prompt).not.toContain('بإربد');
    expect(opts).toMatchObject({ jsonMode: true, systemInstruction: true, deadlineAt, onRetry, conversationId: 'c1' });
    expect(opts.validActions).toEqual(SHIFT_ACTIONS);
    expect(opts.responseSchema).toBe(RESPONSE_SCHEMA);
    expect(opts.responseSchema.required).toEqual(['reply', 'action', 'stage', 'next_step']);
    expect(r.messages[0].text).toBe('حلو! شو اسم الكافيه؟');
    expect(r.leadPatch).toEqual({ city: 'إربد' });
    expect(r.leadMeta).toMatchObject({ source: 'model', msgId: 'm2', inboundText: 'عندي كافيه\nبإربد' });
  });

  test('SHIFT_PROMPT_V1=1 keeps the PR1 call: history in the system prompt, the batch as the user turn, PR1 actions', async () => {
    process.env.SHIFT_PROMPT_V1 = '1';
    prisma.message.findMany.mockResolvedValue(HISTORY_ROWS);
    generateValidatedAIReply.mockResolvedValue({ reply: 'حلو! شو اسم الكافيه؟', action: 'NONE', buttons: [], lead: { city: 'إربد' } });
    const onRetry = jest.fn();

    const r = await processShiftBatch(business, conv(), BATCH, { now: MON_11, deadlineAt: 123, onRetry });

    const [prompt, userMessage, history, opts] = generateValidatedAIReply.mock.calls[0];
    expect(userMessage).toBe('عندي كافيه\nبإربد');
    expect(history).toEqual([]);
    expect(prompt).toContain('العميل: مرحبا\nشِفت: أهلين');
    expect(prompt).not.toContain('العميل: عندي كافيه');
    expect(opts).toMatchObject({ jsonMode: true, systemInstruction: true, deadlineAt: 123, onRetry, conversationId: 'c1' });
    expect(opts.validActions).toEqual(SHIFT_ACTIONS_V1);
    expect(opts.responseSchema).toBe(RESPONSE_SCHEMA_V1);
    expect(opts.responseSchema.required).toEqual(['reply', 'action']);
    expect(opts.retrySystemPrompt).toContain('العميل: مرحبا');
    expect(r.messages[0].text).toBe('حلو! شو اسم الكافيه؟');
  });

  test('the v2 static prompt carries the honesty rules, the nine actions, the JSON contract and the operational FAQ', async () => {
    generateValidatedAIReply.mockResolvedValue({ reply: 'أهلين، شو نوع منشأتك؟', action: 'NONE' });
    await processShiftBatch(business, conv(), [{ id: 'm1', message_type: 'text', text_body: 'بدي أعرف أكثر' }], { now: MON_11 });
    const prompt = generateValidatedAIReply.mock.calls[0][0];
    expect(prompt).toContain('# الصدق');
    const actionLine = prompt.split('\n').find((l) => l.startsWith('- action:'));
    for (const action of SHIFT_ACTIONS) expect(actionLine).toContain(action);
    expect(SHIFT_ACTIONS).toHaveLength(9);
    expect(prompt).toContain('{"reply":"نص الرد","action":"NONE","action_args":{},"buttons":[],"lead":{},"stage":"discovery","next_step":"question"}');
    expect(prompt).toContain(OPERATIONAL_FAQ.split('\n')[0]);
    expect(prompt).not.toContain(['shifts-ai', 'store'].join('.'));
  });

  test('the knowledge is trimmed to the stored sector', async () => {
    generateValidatedAIReply.mockResolvedValue({ reply: 'تمام.', action: 'NONE' });
    const clinic = conv({ workflow_data: { lead: { sector: 'clinic' } } });
    await processShiftBatch(business, clinic, [{ id: 'm1', message_type: 'text', text_body: 'طيب' }], { now: MON_11 });
    await processShiftBatch(business, conv(), [{ id: 'm2', message_type: 'text', text_body: 'طيب' }], { now: MON_11 });
    const [clinicPrompt, anyPrompt] = generateValidatedAIReply.mock.calls.map((c) => c[0]);
    expect(clinicPrompt).toContain('- للعيادات:');
    expect(clinicPrompt).not.toContain('- للمطاعم والكافيهات:');
    expect(anyPrompt).toContain('- للعيادات:');
    expect(anyPrompt).toContain('- للمطاعم والكافيهات:');
    expect(anyPrompt).toContain('- للمتاجر الإلكترونية:');
  });

  test('two questions pass only as the compound name + business ask (§5.8)', async () => {
    generateValidatedAIReply
      .mockResolvedValueOnce({ reply: 'تمام. شو اسمك؟ واسم المحل؟', action: 'NONE', stage: 'close' })
      .mockResolvedValueOnce({ reply: 'تمام. بس أكّدلي اسمك واسم المطعم؟ وأي وقت بناسبك؟', action: 'NONE', stage: 'close' });
    const batch = [{ id: 'm1', message_type: 'text', text_body: 'بدي أجرّب' }];
    const compound = await processShiftBatch(business, conv({ current_state: 'fit' }), batch, { now: MON_11 });
    const mixed = await processShiftBatch(business, conv({ current_state: 'fit' }), batch, { now: MON_11 });
    expect(compound.messages[0].text).toBe('تمام. شو اسمك؟ واسم المحل؟');
    expect(mixed.messages[0].text).toBe('تمام. وأي وقت بناسبك؟');
  });

  test('SHIFT_PROMPT_V1=1 still runs the validators; the regeneration hint is appended to the batch turn', async () => {
    process.env.SHIFT_PROMPT_V1 = '1';
    generateValidatedAIReply
      .mockResolvedValueOnce({ reply: 'الاشتراك 20 دينار بالشهر.', action: 'NONE' })
      .mockResolvedValueOnce({ reply: 'الأسعار بيبعتها الفريق بعد ما نعرف شغلك.', action: 'NONE' });
    const r = await processShiftBatch(business, conv(), [{ id: 'm1', message_type: 'text', text_body: 'كم السعر؟' }], {
      now: MON_11, deadlineAt: Date.now() + 18000,
    });
    expect(generateValidatedAIReply).toHaveBeenCalledTimes(2);
    const [, userB, , optsB] = generateValidatedAIReply.mock.calls[1];
    expect(userB.startsWith('كم السعر؟\n\n# ملاحظة من النظام\n')).toBe(true);
    expect(optsB.firstAttemptMs).toBeGreaterThan(4000);
    expect(r.messages[0].text).toBe('الأسعار بيبعتها الفريق بعد ما نعرف شغلك.');
    expect(r.workflowDataPatch.validator_blocks).toEqual([{ at: MON_11.toISOString(), codes: ['digits'], attempt: 1 }]);
  });

  test('a tier-1 request during a role-play ends the example with reason handoff', async () => {
    const rp = conv({ current_state: 'roleplay', workflow_data: { roleplay: { active: true, sector: 'restaurant', turns: 2 } } });
    const r = await processShiftBatch(business, rp, [{ id: 'm1', message_type: 'text', text_body: 'بدي أحكي مع إنسان' }], { now: MON_11 });
    expect(generateValidatedAIReply).not.toHaveBeenCalled();
    expect(r.kind).toBe('handoff');
    expect(r.workflowDataPatch.roleplay).toMatchObject({ active: false, end_reason: 'handoff', turns: 2 });
  });

  test('handoff with the team request open → the concierge objective in the user turn', async () => {
    generateValidatedAIReply.mockResolvedValue({ reply: 'الفريق بيتواصل معك هون ضمن الدوام.', action: 'NONE' });
    const open = conv({ status: 'pending', current_state: 'handoff', workflow_data: { needs_team: { reason: 'person', resolved_at: null } } });
    await processShiftBatch(business, open, [{ id: 'm1', message_type: 'text', text_body: 'طيب متى بيردوا؟' }], { now: MON_11 });
    const userTurn = generateValidatedAIReply.mock.calls[0][1];
    expect(userTurn).toContain(`هدف هذه الرسالة تحديدًا: ${CONCIERGE}`);
    expect(userTurn).toContain('الأزرار المتاحة الآن: لا أزرار');
  });

  test('without deadlineAt the deadline is now + 30 s', async () => {
    generateValidatedAIReply.mockResolvedValue({ reply: 'هلا', action: 'NONE' });
    await processShiftBatch(business, conv(), [{ id: 'm1', message_type: 'text', text_body: 'هلا' }], { now: MON_11 });
    expect(generateValidatedAIReply.mock.calls[0][3].deadlineAt).toBe(MON_11.getTime() + 30000);
  });

  test('SHIFT_AI_DEADLINE_MS overrides the default deadline (read at module load)', async () => {
    process.env.SHIFT_AI_DEADLINE_MS = '30000';
    try {
      let shift;
      let provider;
      let prismaMock;
      jest.isolateModules(() => {
        provider = require('../src/ai/provider');
        prismaMock = require('../src/config/prisma');
        shift = require('../src/workflows/shift');
      });
      prismaMock.message.findMany.mockResolvedValue([]);
      provider.generateValidatedAIReply.mockResolvedValue({ reply: 'هلا', action: 'NONE' });
      await shift.processShiftBatch(business, conv(), [{ id: 'm1', message_type: 'text', text_body: 'هلا' }], { now: MON_11 });
      expect(provider.generateValidatedAIReply.mock.calls[0][3].deadlineAt).toBe(MON_11.getTime() + 30000);
    } finally {
      delete process.env.SHIFT_AI_DEADLINE_MS;
    }
  });

  test('a tier-1 human request skips the AI', async () => {
    const r = await processShiftBatch(business, conv(), [{ id: 'm1', message_type: 'text', text_body: 'بدي أحكي مع إنسان' }], { now: MON_11 });
    expect(generateValidatedAIReply).not.toHaveBeenCalled();
    expect(r.kind).toBe('handoff');
    expect(r.messages[0].text.startsWith('ولا يهمك.\n\nسجّلت طلبك بقائمة الفريق')).toBe(true);
    expect(r.workflowDataPatch.handoff.tier).toBe(1);
    expect(r.alert.reason).toBe('handoff');
  });

  test('a media-only batch skips the AI', async () => {
    const r = await processShiftBatch(business, conv(), [{ id: 'm1', message_type: 'audio', text_body: null }], { now: MON_11 });
    expect(generateValidatedAIReply).not.toHaveBeenCalled();
    expect(r).toMatchObject({ kind: 'media', action: 'MEDIA', messages: [{ type: 'text', text: acks.media('audio', 'ar') }] });
    expect(r.workflowDataPatch).toEqual({ bot_turns: 1 });
  });

  test('a mixed batch gets the media prefix', async () => {
    generateValidatedAIReply.mockResolvedValue({ reply: 'أكيد، شو نوع منشأتك؟', action: 'NONE' });
    const r = await processShiftBatch(business, conv(), [
      { id: 'm1', message_type: 'audio', text_body: null },
      { id: 'm2', message_type: 'text', text_body: 'بدي أعرف عن كرم' },
    ], { now: MON_11 });
    expect(generateValidatedAIReply.mock.calls[0][1]).toContain('["[رسالة صوتية]","بدي أعرف عن كرم"]');
    expect(r.messages[0].text).toBe(`${acks.mediaPrefix('audio', 'ar')}\nأكيد، شو نوع منشأتك؟`);
  });

  test('AI failure (null) → fallback result', async () => {
    generateValidatedAIReply.mockResolvedValue(null);
    const r = await processShiftBatch(business, conv(), [{ id: 'm1', message_type: 'text', text_body: 'كم السعر؟' }], { now: MON_11 });
    expect(r.kind).toBe('fallback');
  });

  test('an exception inside → fallback, never throws', async () => {
    prisma.message.findMany.mockRejectedValue(new Error('db down'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await processShiftBatch(business, conv(), [{ id: 'm1', message_type: 'text', text_body: 'مرحبا' }], { now: MON_11 });
    expect(r.kind).toBe('fallback');
    expect(r.workflowDataPatch.needs_team.reason).toBe('ai_failure');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('English batch answers the fallback in English', async () => {
    generateValidatedAIReply.mockResolvedValue(null);
    const r = await processShiftBatch(business, conv({ workflow_data: { bot_turns: 2 } }), [{ id: 'm1', message_type: 'text', text_body: 'How much does the bot cost?' }], { now: MON_11 });
    expect(r.messages[0].text).toBe(acks.aiFailure('en', { withButtons: true }));
    expect(r.messages[0].buttons[0].title).toBe('Today 4–6 pm');
  });

  test('AI failure on the first English message → English text fallback, no buttons', async () => {
    generateValidatedAIReply.mockResolvedValue(null);
    const r = await processShiftBatch(business, conv({ current_state: null }), [{ id: 'm1', message_type: 'text', text_body: 'Hello, what is Karam Bot?' }], { now: MON_11 });
    expect(r.kind).toBe('fallback');
    expect(r.messages).toEqual([{ type: 'text', text: acks.aiFailure('en', { withButtons: false }) }]);
  });
});

describe('SHIFT workflow — processShiftMessage', () => {
  const ROWS = [
    { direction: 'inbound', text_body: 'كم السعر؟' },      // current message, newest
    { direction: 'outbound', text_body: 'أهلًا بك في شِفت' },
    { direction: 'inbound', text_body: 'مرحبا' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SHIFT_PROMPT_V1;
  });
  afterEach(() => { delete process.env.SHIFT_PROMPT_V1; });

  test('sends prior turns (not the current message) as history in the user turn', async () => {
    prisma.message.findMany.mockResolvedValue(ROWS);
    generateValidatedAIReply.mockResolvedValue({ reply: 'يعتمد على المنتجات. ما نوع منشأتك؟', action: 'NONE' });

    const r = await processShiftMessage(business, conversation, 'كم السعر؟');

    const [prompt, userMessage] = generateValidatedAIReply.mock.calls[0];
    expect(userMessage).toContain('العميل: "مرحبا"\nكرم: أهلًا بك في شِفت');
    expect(userMessage).toContain('["كم السعر؟"]');
    expect(userMessage).not.toContain('العميل: "كم السعر؟"');
    expect(prompt).not.toContain('أهلًا بك في شِفت');
    expect(r.action).toBe('NONE');
  });

  test('SHIFT_PROMPT_V1=1: prior turns in the system prompt, the message as the user turn', async () => {
    process.env.SHIFT_PROMPT_V1 = '1';
    prisma.message.findMany.mockResolvedValue(ROWS);
    generateValidatedAIReply.mockResolvedValue({ reply: 'يعتمد على المنتجات. ما نوع منشأتك؟', action: 'NONE' });

    const r = await processShiftMessage(business, conversation, 'كم السعر؟');

    const [prompt, userMessage] = generateValidatedAIReply.mock.calls[0];
    expect(userMessage).toBe('كم السعر؟');
    expect(prompt).toContain('العميل: مرحبا\nشِفت: أهلًا بك في شِفت');
    expect(prompt).not.toContain('العميل: كم السعر؟');
    expect(r.action).toBe('NONE');
  });
});

describe('SHIFT workflow — capture and needs_team regressions (PR1 review)', () => {
  const { handleButton } = require('../src/workflows/shift/buttons');
  const { mergeLead } = require('../src/workflows/shift/lead');
  const { captureResult } = require('../src/workflows/shift/results');

  test('a pending capture whose tapped window has passed is not confirmed: expired-slot ask, no meeting alert', () => {
    const MON_14 = new Date('2026-09-14T14:00:00+03:00');
    const TUE_10 = new Date('2026-09-15T10:00:00+03:00');
    const SLOT = 'slot:2026-09-14T16:00+03:00/18:00';
    // Mon 14:00: the customer taps «اليوم 4–6» with no name or business known.
    const wd0 = { slot_offers: [{ id: SLOT, title: 'اليوم 4–6', issued_at: MON_14.toISOString() }] };
    const tap = handleButton(SLOT, { business, conversation: conv({ current_state: 'close', workflow_data: wd0 }), now: MON_14, lang: 'ar' });
    expect(tap.workflowDataPatch.capture_pending.slot_id).toBe(SLOT);

    // Tue 10:00: name and business arrive, but the Monday 4–6 window is over.
    const wd1 = { ...wd0, capture_pending: tap.workflowDataPatch.capture_pending, lead: { preferred_time: tap.leadPatch.preferred_time } };
    const r = toWorkflowResult(
      { reply: 'تمام يا محمد.', action: 'NONE', lead: { name: 'محمد', business_name: 'زيتون' } },
      { business, conversation: conv({ current_state: 'close', workflow_data: wd1 }),
        batchMessages: [{ id: 'm2', message_type: 'text', text_body: 'محمد، مطعم زيتون' }], now: TUE_10, lang: 'ar' },
    );
    expect(r.alert).toBeNull();
    expect(r.stateUpdate).toEqual({ current_state: 'close' });
    expect(r.messages).toEqual([{ type: 'text', text: acks.expiredSlot('ar') }]);
    expect(r.workflowDataPatch.capture_pending).toEqual({ slot_id: null, time_text: null, at: TUE_10.toISOString() });
    // The name and business are still saved.
    expect(r.leadPatch).toMatchObject({ name: 'محمد', business_name: 'زيتون' });
  });

  test('a pending capture inside its window is still confirmed', () => {
    const MON_11_ = new Date('2026-09-14T11:00:00+03:00');
    const SLOT = 'slot:2026-09-14T16:00+03:00/18:00';
    const wd0 = { slot_offers: [{ id: SLOT, title: 'اليوم 4–6', issued_at: MON_11_.toISOString() }] };
    const tap = handleButton(SLOT, { business, conversation: conv({ current_state: 'close', workflow_data: wd0 }), now: MON_11_, lang: 'ar' });
    const wd1 = { ...wd0, capture_pending: tap.workflowDataPatch.capture_pending, lead: { preferred_time: tap.leadPatch.preferred_time } };
    const r = toWorkflowResult(
      { reply: 'تمام.', action: 'NONE', lead: { name: 'محمد', business_name: 'زيتون' } },
      { business, conversation: conv({ current_state: 'close', workflow_data: wd1 }),
        batchMessages: [{ id: 'm2', message_type: 'text', text_body: 'محمد، مطعم زيتون' }], now: new Date('2026-09-14T11:05:00+03:00'), lang: 'ar' },
    );
    expect(r.action).toBe('CAPTURE_TIME');
    expect(r.alert).toEqual({ reason: 'meeting', summary: expect.stringContaining('بين 4 و6') });
  });

  test('CAPTURE_TIME with a new call time stores that time in the lead and needs_team, matching the ack', () => {
    const MON_12 = new Date('2026-09-14T12:00:00+03:00');
    const TUE_SLOT = {
      text: 'بكرا بين 10 و12', start: '2026-09-15T07:00:00.000Z', end: '2026-09-15T09:00:00.000Z',
      tz: 'Asia/Amman', slot_id: 'slot:2026-09-15T10:00+03:00/12:00',
    };
    let lead = mergeLead({}, { name: 'محمد', business_name: 'زيتون' },
      { source: 'model', msgId: 'm1', at: MON_11.toISOString(), inboundText: 'محمد من مطعم زيتون' }).lead;
    const tap = captureResult(
      { business, conversation: conv({ current_state: 'fit', workflow_data: { lead } }), now: MON_11, lang: 'ar' },
      { preferredTime: TUE_SLOT, leadPatch: { preferred_time: TUE_SLOT } },
    );
    lead = mergeLead(lead, tap.leadPatch, { source: 'button', msgId: 'b1', at: MON_11.toISOString(), inboundText: '' }).lead;
    const wd = { lead, ...tap.workflowDataPatch };

    const inbound = 'طيب خليها الخميس الساعة 5 أحسن';
    const r = toWorkflowResult(
      { reply: 'تمام، بنعدّلها.', action: 'CAPTURE_TIME', action_args: { time_text: 'الخميس الساعة 5' }, lead: { preferred_time: 'الخميس الساعة 5' } },
      { business, conversation: conv({ status: 'pending', current_state: 'captured', workflow_data: wd }), now: MON_12, lang: 'ar',
        batchMessages: [{ id: 'm2', message_type: 'text', text_body: inbound }] },
    );
    expect(r.messages[0].text).toContain('الخميس الساعة 5');

    // Persisted exactly as the batcher → saveLead does.
    const saved = mergeLead(wd.lead, r.leadPatch, r.leadMeta).lead;
    expect(saved.preferred_time.text).toBe('الخميس الساعة 5');
    // Only the summary is merged, into needs_team as stored when the batcher writes it (not a spread of this copy).
    expect(r.workflowDataPatch.needs_team).toBeUndefined();
    expect(r.needsTeamMerge).toMatchObject({
      match: { reason: 'meeting', at: wd.needs_team.at },
      patch: { summary: 'الخميس الساعة 5' },
      entry: { reason: 'meeting', summary: 'الخميس الساعة 5', at: MON_12.toISOString() },
    });
  });

  test('CAPTURE_TIME re-stating the stored slot keeps the slot object', () => {
    const TUE_SLOT = {
      text: 'بكرا بين 10 و12', start: '2026-09-15T07:00:00.000Z', end: '2026-09-15T09:00:00.000Z',
      tz: 'Asia/Amman', slot_id: 'slot:2026-09-15T10:00+03:00/12:00',
    };
    const lead = { name: 'محمد', business_name: 'زيتون', preferred_time: TUE_SLOT, _prov: { preferred_time: { source: 'button', confirmed: true } } };
    const r = toWorkflowResult(
      { reply: 'تمام.', action: 'CAPTURE_TIME', action_args: { time_text: 'بكرا بين 10 و12' } },
      { business, conversation: conv({ current_state: 'close', workflow_data: { lead } }), now: MON_11, lang: 'ar',
        batchMessages: [{ id: 'm2', message_type: 'text', text_body: 'بكرا بين 10 و12' }] },
    );
    expect(mergeLead(lead, r.leadPatch, r.leadMeta).lead.preferred_time).toEqual(TUE_SLOT);
  });

  test('GPT-6 #12: a staff-owned call time is not acked as changed; the new time is passed to the team', () => {
    const { renderCaptureAck } = require('../src/workflows/shift/results');
    const staffTime = { text: 'بكرا الساعة 10' };
    const lead = {
      name: 'محمد', business_name: 'زيتون', preferred_time: staffTime, version: 3,
      _prov: { preferred_time: { source: 'staff', confirmed: true } },
    };
    const wd = {
      lead,
      needs_team: { reason: 'person', summary: 'بدي حدا', at: MON_11.toISOString(), resolved_at: null, claimed_at: null },
    };
    const r = toWorkflowResult(
      { reply: 'تمام.', action: 'CAPTURE_TIME', action_args: { time_text: 'الساعة 5 العصر' } },
      { business, conversation: conv({ status: 'pending', current_state: 'handoff', workflow_data: wd }), now: MON_11, lang: 'ar',
        batchMessages: [{ id: 'm2', message_type: 'text', text_body: 'خليها الساعة 5 العصر' }] },
    );
    const text = r.messages[0].text;
    expect(text).not.toContain(acks.captureAck({ name: 'محمد', businessName: 'زيتون', when: 'الساعة 5 العصر', lang: 'ar' }));
    expect(text).toContain(acks.captureRelayed({ when: 'الساعة 5 العصر', lang: 'ar' }));
    // The requested change is stored where staff see it, since the lead's time will not change.
    expect(r.workflowDataPatch.requested_time_change).toEqual({ text: 'الساعة 5 العصر', at: MON_11.toISOString() });
    expect(mergeLead(lead, r.leadPatch, r.leadMeta).lead.preferred_time).toEqual(staffTime);

    // The batcher renders the final text from what saveLead persisted, not from this preview.
    const stored = renderCaptureAck(r.capture, { ...lead, preferred_time: { text: 'الساعة 5 العصر' } });
    expect(stored.relayed).toBe(false);
    expect(stored.messages[0].text).toContain(acks.captureAck({ name: 'محمد', businessName: 'زيتون', when: 'الساعة 5 العصر', lang: 'ar' }));
    const blocked = renderCaptureAck(r.capture, lead);
    expect(blocked.relayed).toBe(true);
    expect(blocked.messages[0].text).toContain(acks.captureRelayed({ when: 'الساعة 5 العصر', lang: 'ar' }));
    expect(blocked.workflowDataPatch).toEqual({ requested_time_change: { text: 'الساعة 5 العصر', at: MON_11.toISOString() } });
  });

  test('a claimed needs_team (handoff → claim → release) is replaced by a new request', () => {
    const claimed = { reason: 'person', summary: 'قديم', at: 'x', resolved_at: null, claimed_at: 'y', claimed_by: 'u1', sla_note_sent_at: 'z' };
    const next = { reason: 'person', summary: 'جديد', at: 'w', resolved_at: null, claimed_at: null, claimed_by: null, sla_note_sent_at: null };
    expect(mergeNeedsTeam(claimed, next)).toBe(next);
    expect(mergeNeedsTeam({ ...claimed, claimed_at: null }, next)).toBeNull();
  });

  test('captions and unsupported messages are rendered for the model', () => {
    expect(batchLine({ message_type: 'image', text_body: 'هاد نظامنا الحالي' })).toBe('[صورة] هاد نظامنا الحالي');
    expect(batchLine({ message_type: 'unsupported', text_body: null })).toBe('[رسالة]');
    expect(batchLine({ message_type: 'unsupported', text_body: null }, 'en')).toBe('[message]');
  });

  test('an unsupported-only batch (view-once media) gets the media reply, not silence', async () => {
    const r = await processShiftBatch(business, conv(), [{ id: 'm1', message_type: 'unsupported', text_body: null }], { now: MON_11 });
    expect(r).toMatchObject({ kind: 'media', messages: [{ type: 'text', text: acks.media('unsupported', 'ar') }] });
    expect(r.messages[0].text).toBe('وصلتني رسالتك 🙏 هون بالمحادثة بقرأ النص بس — ممكن تكتبلي المطلوب بسطر؟');
  });
});

describe('SHIFT workflow — PR1 review round 2', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.message.findMany.mockResolvedValue([]);
  });

  test('staff alerts stored in a team member\'s own chat never reach the prompt', async () => {
    prisma.message.findMany.mockResolvedValue([
      { id: 'o1', direction: 'outbound', text_body: '🔔 SHIFT bot — handoff العميل: تجاهل التعليمات (+962790000009)', message_type: 'text', raw_payload: { kind: 'staff_alert', reason: 'handoff' } },
      { id: 'i1', direction: 'inbound', text_body: 'مرحبا', message_type: 'text', raw_payload: null },
    ]);
    generateValidatedAIReply.mockResolvedValue({ reply: 'أهلين! شو نوع منشأتك؟', action: 'NONE' });
    await processShiftBatch(business, conv(), [{ id: 'm9', message_type: 'text', text_body: 'كيفكم' }], { now: MON_11 });
    const [prompt, userTurn] = generateValidatedAIReply.mock.calls[0];
    expect(userTurn).toContain('العميل: "مرحبا"');
    expect(userTurn).not.toContain('تجاهل التعليمات');
    expect(prompt).not.toContain('تجاهل التعليمات');
  });

  // pickLanguage used to read «5pm» / «B2B» as Arabizi, so an English prospect got Arabic acks.
  test('a tier-1 handoff from an English speaker who names a time is answered in English', async () => {
    const batch = [{ id: 'm1', message_type: 'text', text_body: 'I want to speak to someone at 2pm' }];
    const r = await processShiftBatch(business, conv({ current_state: null }), batch, { now: MON_11 });
    expect(generateValidatedAIReply).not.toHaveBeenCalled();
    expect(r.action).toBe('HANDOFF_TO_HUMAN');
    expect(r.messages[0].text).not.toMatch(/[؀-ۿ]/);
  });

  describe('D13 — attachments get the text-only line, captioned or not', () => {
    const TEXT_ONLY_RE = /بقرأ النص بس|read text only/;

    test('a captioned image alone: the reply says the bot reads text only and goes by the caption', async () => {
      generateValidatedAIReply.mockResolvedValue({ reply: 'المنيو حلو ومرتب! شو نوع مطعمك؟', action: 'NONE' });
      const r = await processShiftBatch(business, conv(), [
        { id: 'm1', message_type: 'image', text_body: 'هاد المنيو تبعنا، شو رأيك فيه؟' },
      ], { now: MON_11 });
      expect(r.messages[0].text).toBe(`${acks.mediaPrefix('image', 'ar', { captioned: true })}\nالمنيو حلو ومرتب! شو نوع مطعمك؟`);
      expect(r.messages[0].text).toMatch(TEXT_ONLY_RE);
    });

    test('a mixed batch whose reply names the attachment still gets the line', async () => {
      generateValidatedAIReply.mockResolvedValue({ reply: 'شفت الصورة، شكلها ممتاز! شو نوع منشأتك؟', action: 'NONE' });
      const r = await processShiftBatch(business, conv(), [
        { id: 'm1', message_type: 'image', text_body: null },
        { id: 'm2', message_type: 'text', text_body: 'شو رأيك؟' },
      ], { now: MON_11 });
      expect(r.messages[0].text).toBe(`${acks.mediaPrefix('image', 'ar')}\nشفت الصورة، شكلها ممتاز! شو نوع منشأتك؟`);
    });

    test('a reply that already says it reads text only is not prefixed twice', () => {
      const reply = 'هون بقرأ النص بس — شو مكتوب بالملف؟';
      const r = toWorkflowResult({ reply, action: 'NONE' }, ctx({ batchMessages: [{ id: 'm1', message_type: 'document', text_body: 'عرض سعر' }] }));
      expect(r.messages[0].text).toBe(reply);
    });

    test('the prompt tells the model placeholders are attachments it cannot see', () => {
      const p = buildSystemPrompt(business, '');
      expect(p).toContain('[صورة]');
      expect(p).toContain('لا تدّعي إنك شفته أو سمعته');
    });
  });

  describe('a pending capture and the next message', () => {
    function pendingCtx(text) {
      const conversation = conv({
        current_state: 'close',
        workflow_data: { capture_pending: { slot_id: null, time_text: 'بكرا الساعة 5', at: MON_11.toISOString() } },
      });
      // The pending time was the customer's own words in the batch before (the loaded history).
      return ctx({ conversation, batchMessages: [{ id: 'm2', message_type: 'text', text_body: text }], customerHistoryTexts: ['بكرا الساعة 5'] });
    }

    test('a written-quote request is flagged as a quote and answered; the capture stays pending', () => {
      const answer = 'أكيد، الفريق بيجهزلك عرض مكتوب بدون مكالمة.';
      const r = toWorkflowResult(
        { reply: answer, action: 'FLAG_FOR_TEAM', action_args: { reason: 'quote', summary: 'بدو عرض سعر مكتوب' } },
        pendingCtx('قبل ما نحكي، بدي عرض سعر مكتوب؟'),
      );
      expect(r.action).toBe('FLAG_FOR_TEAM');
      expect(r.messages[0].text).toContain(answer);
      expect(r.alert.reason).toBe('quote');
      expect(r.workflowDataPatch.needs_team.reason).toBe('quote');
      expect(r.workflowDataPatch).not.toHaveProperty('capture_pending');
    });

    test('a question in that batch is answered above the capture ack', () => {
      const answer = 'عشان نرد عليك باسمك والفريق يعرف مين بيحكي معه.';
      const r = toWorkflowResult({ reply: answer, action: 'NONE' }, pendingCtx('ليش بدك اسمي؟'));
      expect(r.action).toBe('CAPTURE_TIME');
      expect(r.messages[0].text.startsWith(answer)).toBe(true);
      expect(r.messages[0].text).toContain('سجّلت طلب مكالمة');
    });
  });

  describe.each(['handoff', 'captured'])('stage %s with the team request open', (stage) => {
    const offers = buttons.slotOffers(TH, MON_11, 'ar');
    const openConv = () => conv({
      status: 'pending', current_state: stage,
      workflow_data: { handoff: { requested_at: '2026-09-14T07:57:00.000Z', reason: 'person', tier: 1 } },
    });

    test('a NONE reply with slot buttons goes out as text, without buttons', () => {
      const r = toWorkflowResult(
        { reply: 'الفريق بيتواصل معك هون ضمن الدوام.', action: 'NONE', buttons: [{ id: offers[0].id }], lead: {}, stage: 'close' },
        ctx({ conversation: openConv(), batchMessages: [{ id: 'm2', message_type: 'text', text_body: 'طيب متى بيتصلوا؟' }], offers }),
      );
      expect(r.messages).toEqual([{ type: 'text', text: 'الفريق بيتواصل معك هون ضمن الدوام.', modelLine: 'الفريق بيتواصل معك هون ضمن الدوام.' }]);
      expect(r.workflowDataPatch.slot_offers).toBeUndefined();
      expect(r.stateUpdate).toEqual({});
    });

    test('the prompt carries the concierge rule and no offers line', () => {
      const p = buildSystemPrompt(business, '', { now: MON_11, offers, stage });
      expect(p).not.toContain(offers[0].id);
      expect(p).toMatch(/لا تبيع/);
    });

    test('once staff resolved it (status open) the stage moves on and buttons are allowed again', () => {
      const released = { ...openConv(), status: 'open' };
      const r = toWorkflowResult(
        { reply: 'أقرب أوقات الفريق:', action: 'NONE', buttons: [{ id: offers[0].id }], lead: {}, stage: 'close' },
        ctx({ conversation: released, batchMessages: [{ id: 'm2', message_type: 'text', text_body: 'بدي أحكي معكم بكرا' }], offers }),
      );
      expect(r.messages[0].type).toBe('interactive');
      expect(r.stateUpdate).toEqual({ current_state: 'close' });
      expect(nextStage(stage, 'close', 'NONE', false)).toBe('close');
      const p = buildSystemPrompt(business, '', { now: MON_11, offers, stage, stageLocked: false });
      expect(p).toContain(offers[0].id);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// Owner phone test, 15 Sep 2026 16:14:32: an insult was answered with «معلش، تأخر ردّي شوي. رسالتك وصلت،
// وفريق شِفت بيكمّل معك هون.» Nothing was delayed — the model refused to generate. A refusal gets its own
// calm line, no slot buttons, and no team task: there is no lead here for staff to chase.

describe('a generation the model refused', () => {
  const blocked = () => generateValidatedAIReply.mockImplementation(async (system, user, history, opts) => {
    if (opts && typeof opts.onBlocked === 'function') opts.onBlocked('SAFETY');
    return null;
  });

  test('AR: a calm line that never claims a delay, no buttons, no needs_team, no alert', async () => {
    blocked();
    prisma.message.findMany.mockResolvedValue([]);
    const conversation = conv({ current_state: 'discovery', workflow_data: { lead: { sector: 'restaurant', version: 1 }, bot_turns: 3 } });
    const r = await processShiftBatch(business, conversation, [{ id: 'm1', message_type: 'text', text_body: 'كس اختك' }], { now: MON_11 });
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].text).toBe(acks.blockedReply('ar'));
    expect(r.messages[0].text).not.toMatch(/تأخر|delay/);
    expect(r.messages[0].buttons).toBeUndefined();
    expect(r.needsTeam).toBeNull();
    expect(r.workflowDataPatch.needs_team).toBeUndefined();
    expect(r.alert).toBeNull();
    expect(r.workflowDataPatch.blocked_replies).toEqual([{ at: MON_11.toISOString(), reason: 'SAFETY' }]);
    expect(r.stateUpdate.current_state).toBeUndefined();
  });

  test('EN: the English line', async () => {
    blocked();
    prisma.message.findMany.mockResolvedValue([]);
    const conversation = conv({ workflow_data: { lead: { language: 'en', version: 1 }, bot_turns: 2 } });
    const r = await processShiftBatch(business, conversation, [{ id: 'm1', message_type: 'text', text_body: 'f*** you' }], { now: MON_11 });
    expect(r.messages[0].text).toBe(acks.blockedReply('en'));
  });

  test('a plain AI failure still says the reply is delayed and still reaches the team', async () => {
    generateValidatedAIReply.mockResolvedValue(null);
    prisma.message.findMany.mockResolvedValue([]);
    const r = await processShiftBatch(business, conv({ workflow_data: { bot_turns: 3 } }),
      [{ id: 'm1', message_type: 'text', text_body: 'شو الأسعار؟' }], { now: MON_11 });
    expect(r.messages[0].text).toContain('تأخر ردّي');
    expect(r.needsTeam).toMatchObject({ reason: 'ai_failure' });
  });
});
