require('./setup');

jest.mock('../src/ai/provider', () => ({ generateValidatedAIReply: jest.fn() }));
jest.mock('../src/config/prisma', () => ({ message: { findMany: jest.fn() } }));

const { generateValidatedAIReply } = require('../src/ai/provider');
const prisma = require('../src/config/prisma');
const {
  processShiftMessage, processShiftBatch, buildSystemPrompt, formatHistory, toWorkflowResult, batchLine, SHIFT_ACTIONS,
} = require('../src/workflows/shift');
const acks = require('../src/workflows/shift/acks');
const hours = require('../src/workflows/shift/hours');
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

  test('AI failure → fallback with slot buttons, pending, needs_team ai_failure', () => {
    const r = toWorkflowResult(null);
    expect(r.kind).toBe('fallback');
    expect(r.action).toBe('AI_FAILURE');
    expect(r.stateUpdate).toEqual({ status: 'pending' });
    expect(r.workflowDataPatch.needs_team.reason).toBe('ai_failure');
    expect(r.messages[0].type).toBe('interactive');
    expect(r.messages[0].buttons).toHaveLength(3);
    expect(r.messages[0].text).toBe(acks.aiFailure('ar', { withButtons: true }));
    expect(r.workflowDataPatch.slot_offers).toHaveLength(3);
    expect(r.alert.reason).toBe('ai_failure');
    expect(JSON.stringify(r)).not.toContain('ai_enabled');
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
      ctx({ conversation: c }),
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
    const r = toWorkflowResult({ reply: 'تمام.', action: 'CAPTURE_TIME', action_args: { time_text: 'الأحد العصر' } }, ctx());
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
    expect(r.messages[0]).toEqual({
      type: 'interactive',
      text: 'أقرب أوقات الفريق:',
      buttons: [{ id: 'slot:2026-09-15T10:00+03:00/12:00', title: 'بكرا 10–12' }],
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
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.message.findMany.mockResolvedValue([]);
  });

  test('passes jsonMode, validActions, deadlineAt and the batch as the user turn', async () => {
    prisma.message.findMany.mockResolvedValue([
      { id: 'm2', direction: 'inbound', text_body: 'بإربد' },
      { id: 'm1', direction: 'inbound', text_body: 'عندي كافيه' },
      { id: 'o1', direction: 'outbound', text_body: 'أهلين' },
      { id: 'm0', direction: 'inbound', text_body: 'مرحبا' },
    ]);
    generateValidatedAIReply.mockResolvedValue({ reply: 'حلو! شو اسم الكافيه؟', action: 'NONE', buttons: [], lead: { city: 'إربد' } });
    const onRetry = jest.fn();
    const batch = [
      { id: 'm1', message_type: 'text', text_body: 'عندي كافيه' },
      { id: 'm2', message_type: 'text', text_body: 'بإربد' },
    ];

    const r = await processShiftBatch(business, conv(), batch, { now: MON_11, deadlineAt: 123, onRetry });

    expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 14, orderBy: { created_at: 'desc' } }));
    const [prompt, userMessage, history, opts] = generateValidatedAIReply.mock.calls[0];
    expect(userMessage).toBe('عندي كافيه\nبإربد');
    expect(history).toEqual([]);
    expect(prompt).toContain('العميل: مرحبا\nشِفت: أهلين');
    expect(prompt).not.toContain('العميل: عندي كافيه');
    expect(opts).toMatchObject({ jsonMode: true, systemInstruction: true, deadlineAt: 123, onRetry, conversationId: 'c1' });
    expect(opts.validActions).toEqual(SHIFT_ACTIONS);
    expect(opts.responseSchema.required).toEqual(['reply', 'action']);
    expect(opts.retrySystemPrompt).toContain('العميل: مرحبا');
    expect(r.messages[0].text).toBe('حلو! شو اسم الكافيه؟');
    expect(r.leadPatch).toEqual({ city: 'إربد' });
    expect(r.leadMeta).toMatchObject({ source: 'model', msgId: 'm2', inboundText: 'عندي كافيه\nبإربد' });
  });

  test('without deadlineAt the deadline is now + 18 s', async () => {
    generateValidatedAIReply.mockResolvedValue({ reply: 'هلا', action: 'NONE' });
    await processShiftBatch(business, conv(), [{ id: 'm1', message_type: 'text', text_body: 'هلا' }], { now: MON_11 });
    expect(generateValidatedAIReply.mock.calls[0][3].deadlineAt).toBe(MON_11.getTime() + 18000);
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
    expect(generateValidatedAIReply.mock.calls[0][1]).toBe('[رسالة صوتية]\nبدي أعرف عن كرم');
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
    const r = await processShiftBatch(business, conv(), [{ id: 'm1', message_type: 'text', text_body: 'How much does the bot cost?' }], { now: MON_11 });
    expect(r.messages[0].text).toBe(acks.aiFailure('en', { withButtons: true }));
    expect(r.messages[0].buttons[0].title).toBe('Today 4–6 pm');
  });
});

describe('SHIFT workflow — processShiftMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sends prior turns (not the current message) as history', async () => {
    prisma.message.findMany.mockResolvedValue([
      { direction: 'inbound', text_body: 'كم السعر؟' },      // current message, newest
      { direction: 'outbound', text_body: 'أهلًا بك في شِفت' },
      { direction: 'inbound', text_body: 'مرحبا' },
    ]);
    generateValidatedAIReply.mockResolvedValue({ reply: 'يعتمد على المنتجات. ما نوع منشأتك؟', action: 'NONE' });

    const r = await processShiftMessage(business, conversation, 'كم السعر؟');

    const [prompt, userMessage] = generateValidatedAIReply.mock.calls[0];
    expect(userMessage).toBe('كم السعر؟');
    expect(prompt).toContain('العميل: مرحبا\nشِفت: أهلًا بك في شِفت');
    expect(prompt).not.toContain('العميل: كم السعر؟');
    expect(r.action).toBe('NONE');
  });
});
