/**
 * results.js PR2 behaviour (contract §9.2–§9.4): the role-play sandbox, pre-fill merge, the bundle-quote
 * upgrade, sector_text capture, the sector list, counters, part metadata and the Arabizi language patch.
 * Uses the real modules below results.js; since the integration pass that includes context.js
 * (consentAllowed), never followups.js.
 */
require('./setup');

// Pure: the mock only keeps lead.js from building a real PrismaClient.
jest.mock('../src/config/prisma', () => ({}));

const {
  toWorkflowResult, roleplayEndResult, nextStage, renderCaptureAck,
} = require('../src/workflows/shift/results');
const acks = require('../src/workflows/shift/acks');
const hours = require('../src/workflows/shift/hours');
const roleplay = require('../src/workflows/shift/roleplay');
const validators = require('../src/workflows/shift/validators');
const { parsePrefill } = require('../src/workflows/shift/prefill');
const { mergeLead } = require('../src/workflows/shift/lead');

const MON_11 = new Date('2026-09-14T11:00:00+03:00');
const TH = hours.DEFAULT_TEAM_HOURS;
const OLD_HOST = ['shifts-ai', 'store'].join('.');
const ENV_KEYS = ['SHIFT_ROLEPLAY', 'SHIFT_PROMPT_V1', 'SHIFT_SAMPLES_VETTED', 'SHIFT_SAMPLES_BASE'];
beforeEach(() => ENV_KEYS.forEach((k) => delete process.env[k]));
afterAll(() => ENV_KEYS.forEach((k) => delete process.env[k]));

const business = { id: 'b1', ai_config: {} };

function ctx({ wd = {}, stage = 'discovery', status = 'open', texts = ['تمام'], lang = 'ar', batch, ...rest } = {}) {
  const batchMessages = batch || texts.map((t, i) => ({ id: `m${i + 1}`, message_type: 'text', text_body: t }));
  return {
    business,
    conversation: { id: 'c1', status, current_state: stage, workflow_data: wd },
    batchMessages,
    now: MON_11,
    lang,
    ...rest,
  };
}

const FACTS = ['شاورما 3 دنانير', 'برجر 4', 'توصيل داخل إربد'];
const setupRoleplay = (fields = {}) => ({
  active: false, sector: 'restaurant', business_name: null, facts: [], started_at: null, last_turn_at: null,
  turns: 0, setup_asks: 1, ended_at: null, end_reason: null, ...fields,
});
const liveRoleplay = (fields = {}) => ({
  ...setupRoleplay(),
  active: true, business_name: 'مطعم الساحة', facts: FACTS, started_at: MON_11.toISOString(), last_turn_at: MON_11.toISOString(), ...fields,
});

// ─── role-play ───────────────────────────────────────────────────────────────

describe('START_ROLEPLAY', () => {
  const start = (args, reply = 'تفضل، شو بتحب تطلب؟') => ({
    reply, action: 'START_ROLEPLAY', action_args: args, stage: 'roleplay_setup', next_step: 'question',
  });

  test('accepted from roleplay_setup: start line + model line, stage roleplay, active state', () => {
    const r = toWorkflowResult(
      start({ sector: 'restaurant', business_name: 'مطعم الساحة', facts: FACTS }),
      ctx({ stage: 'roleplay_setup', wd: { roleplay: setupRoleplay() }, texts: ['مطعم الساحة، شاورما 3 دنانير، برجر 4، توصيل داخل إربد'] }),
    );
    const line = roleplay.startLine('مطعم الساحة', 'ar');
    expect(r.action).toBe('START_ROLEPLAY');
    expect(r.messages).toEqual([{ type: 'text', text: `${line}\n\nتفضل، شو بتحب تطلب؟`, modelLine: 'تفضل، شو بتحب تطلب؟', ack: line }]);
    expect(r.messages[0].text.startsWith('مثال توضيحي 🎭')).toBe(true);
    expect(r.stateUpdate).toEqual({ current_state: 'roleplay' });
    expect(r.workflowDataPatch.roleplay).toEqual({
      active: true, sector: 'restaurant', business_name: 'مطعم الساحة', facts: FACTS,
      started_at: MON_11.toISOString(), last_turn_at: MON_11.toISOString(), turns: 0, setup_asks: 1, ended_at: null, end_reason: null,
    });
  });

  test('business_name is the only lead write from the setup, with source roleplay_setup', () => {
    const c = ctx({ stage: 'roleplay_setup', wd: { roleplay: setupRoleplay() }, texts: ['أنا أبو أحمد، مطعم الساحة، شاورما 3 دنانير'] });
    const ai = { ...start({ business_name: 'مطعم الساحة', facts: ['شاورما 3 دنانير'] }), lead: { name: 'أبو أحمد', city: 'إربد' } };
    const r = toWorkflowResult(ai, c);
    expect(r.leadPatch).toEqual({ business_name: 'مطعم الساحة' });
    expect(r.leadMeta).toMatchObject({ source: 'roleplay_setup', provSource: 'roleplay_setup', trusted: [], inboundText: '' });
    const { lead } = mergeLead({}, r.leadPatch, r.leadMeta);
    expect(lead.business_name).toBe('مطعم الساحة');
    expect(lead._prov.business_name.source).toBe('roleplay_setup');
    expect(lead).not.toHaveProperty('name');
    expect(lead).not.toHaveProperty('customer_numbers');

    // A known business_name is never replaced from the sandbox.
    const known = toWorkflowResult(ai, ctx({ stage: 'roleplay_setup', wd: { roleplay: setupRoleplay(), lead: { business_name: 'كافيه زيتون' } } }));
    expect(known.leadPatch).toBeNull();
  });

  test('the setup sector is kept when the model omits it', () => {
    const r = toWorkflowResult(start({ business_name: 'عيادة الشفاء', facts: ['تنظيف أسنان'] }), ctx({ stage: 'roleplay_setup', wd: { roleplay: setupRoleplay({ sector: 'clinic' }) } }));
    expect(r.workflowDataPatch.roleplay.sector).toBe('clinic');
  });

  test.each(['sample', 'opening', 'close', 'fit'])('from %s → wrong stage: treated as NONE, the model line kept', (stage) => {
    const ai = { ...start({ business_name: 'مطعم الساحة', facts: FACTS }, 'شو اسم مطعمك؟'), stage };
    const r = toWorkflowResult(ai, ctx({ stage, texts: ['مطعم الساحة، شاورما 3 دنانير'] }));
    expect(r.action).toBe('NONE');
    expect(r.messages).toEqual([{ type: 'text', text: 'شو اسم مطعمك؟', modelLine: 'شو اسم مطعمك؟' }]);
    expect(r.workflowDataPatch).not.toHaveProperty('roleplay');
    expect(r.stateUpdate.current_state).not.toBe('roleplay');
    expect(r.leadPatch?.business_name).toBeUndefined();
  });

  test('role-play disabled → NONE', () => {
    process.env.SHIFT_ROLEPLAY = '0';
    const r = toWorkflowResult(start({ business_name: 'مطعم الساحة', facts: FACTS }), ctx({ stage: 'roleplay_setup', wd: { roleplay: setupRoleplay() } }));
    expect(r.action).toBe('NONE');
    expect(r.workflowDataPatch).not.toHaveProperty('roleplay');
  });

  test('no business name → bad args → NONE with the model line', () => {
    const r = toWorkflowResult(start({ facts: FACTS }, 'شو اسم المطعم؟'), ctx({ stage: 'roleplay_setup', wd: { roleplay: setupRoleplay() } }));
    expect(r.action).toBe('NONE');
    expect(r.messages[0].text).toBe('شو اسم المطعم؟');
  });

  test('no facts: asks twice (model line dropped), then starts name-only', () => {
    let wd = { roleplay: setupRoleplay({ setup_asks: 0 }) };
    const ai = start({ sector: 'restaurant', business_name: 'مطعم الساحة', facts: [] }, 'يلا نبدأ!');
    const ask = roleplay.setupAsk('restaurant', 'ar');

    const first = toWorkflowResult(ai, ctx({ stage: 'roleplay_setup', wd }));
    expect(first.messages).toEqual([{ type: 'text', text: ask }]);
    expect(first.workflowDataPatch.roleplay).toMatchObject({ active: false, setup_asks: 1 });
    expect(first.stateUpdate).toEqual({ current_state: 'roleplay_setup' });
    expect(first.leadPatch).toBeNull();

    wd = { roleplay: first.workflowDataPatch.roleplay };
    const second = toWorkflowResult(ai, ctx({ stage: 'roleplay_setup', wd }));
    expect(second.messages).toEqual([{ type: 'text', text: ask }]);
    expect(second.workflowDataPatch.roleplay.setup_asks).toBe(2);

    wd = { roleplay: second.workflowDataPatch.roleplay };
    const third = toWorkflowResult(ai, ctx({ stage: 'roleplay_setup', wd }));
    expect(third.stateUpdate).toEqual({ current_state: 'roleplay' });
    expect(third.workflowDataPatch.roleplay).toMatchObject({ active: true, facts: [], business_name: 'مطعم الساحة', setup_asks: 2 });
  });
});

describe('role-play turns', () => {
  const turn = (reply, extra = {}) => ({ reply, action: 'NONE', stage: 'roleplay', next_step: 'question', ...extra });

  test('a turn counts, keeps the stage, drops model buttons and writes no lead', () => {
    const r = toWorkflowResult(
      turn('شاورما عدد 2 بـ3 دنانير — المجموع 6 دنانير حسب أسعارك. بتأكد؟', {
        buttons: [{ id: 'slot:other', title: 'وقت ثاني' }], lead: { name: 'أبو أحمد' },
      }),
      ctx({ stage: 'roleplay', wd: { roleplay: liveRoleplay({ turns: 1 }) }, texts: ['أنا أبو أحمد، بدي 2 شاورما'] }),
    );
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].type).toBe('text');
    expect(r.messages[0]).not.toHaveProperty('buttons');
    expect(r.messages[0].modelLine).toBe('شاورما عدد 2 بـ3 دنانير — المجموع 6 دنانير حسب أسعارك. بتأكد؟');
    expect(r.stateUpdate).toEqual({});
    expect(r.workflowDataPatch.roleplay).toMatchObject({ active: true, turns: 2, last_turn_at: MON_11.toISOString() });
    expect(r.leadPatch).toBeNull();
    expect(r.workflowDataPatch).not.toHaveProperty('slot_offers');
  });

  test('a claimed-action or capture action inside the example never becomes a real request (G6)', () => {
    const r = toWorkflowResult(
      turn('تمام، سجّلت طلبك: 2 شاورما.', { action: 'CAPTURE_TIME', action_args: { time_text: 'بكرا 5' } }),
      ctx({ stage: 'roleplay', wd: { roleplay: liveRoleplay(), capture_pending: { slot_id: 'other', time_text: 'بكرا 5', at: 'x' } }, texts: ['أكّد الطلب بكرا 5'] }),
    );
    expect(r.action).toBe('NONE');
    expect(r.stateUpdate).toEqual({});
    expect(r.alert).toBeNull();
    expect(r.workflowDataPatch).not.toHaveProperty('needs_team');
    expect(r).not.toHaveProperty('capture');
  });

  test('the turn counter ends the example at 6 with the end line as the ack', () => {
    let rp = liveRoleplay({ turns: 0 });
    let r;
    for (let i = 1; i <= 6; i += 1) {
      r = toWorkflowResult(turn(`جواب ${i}`), ctx({ stage: rp.active ? 'roleplay' : 'close', wd: { roleplay: rp }, texts: [`سؤال ${i}`] }));
      rp = r.workflowDataPatch.roleplay;
      if (i < 6) {
        expect(rp.active).toBe(true);
        expect(r.messages[0].text).toBe(`جواب ${i}`);
      }
    }
    const end = roleplay.endLine('restaurant', 'ar');
    expect(r.messages).toEqual([{ type: 'text', text: `جواب 6\n\n${end}`, modelLine: 'جواب 6', ack: end }]);
    expect(r.stateUpdate).toEqual({ current_state: 'close' });
    expect(rp).toMatchObject({ active: false, turns: 6, end_reason: 'turns', ended_at: MON_11.toISOString() });
  });

  test('END_ROLEPLAY without the label → the end line alone', () => {
    const r = toWorkflowResult(
      { reply: 'هيك كان المثال، شو رأيك؟', action: 'END_ROLEPLAY', stage: 'close', next_step: 'question' },
      ctx({ stage: 'roleplay', wd: { roleplay: liveRoleplay() }, texts: ['خلصنا من المثال'] }),
    );
    expect(r.action).toBe('END_ROLEPLAY');
    expect(r.messages).toEqual([{ type: 'text', text: roleplay.endLine('restaurant', 'ar') }]);
    expect(r.stateUpdate).toEqual({ current_state: 'close' });
    expect(r.workflowDataPatch.roleplay).toMatchObject({ active: false, end_reason: 'done' });
    expect(r.leadPatch).toBeNull();
  });

  test('END_ROLEPLAY with the label keeps the debrief above the end line', () => {
    const debrief = 'هاد كان مثال توضيحي على مطعمك بالليل.';
    const r = toWorkflowResult({ reply: debrief, action: 'END_ROLEPLAY' }, ctx({ stage: 'roleplay', wd: { roleplay: liveRoleplay({ sector: 'clinic' }) } }));
    const end = roleplay.endLine('clinic', 'ar');
    expect(r.messages).toEqual([{ type: 'text', text: `${debrief}\n\n${end}`, modelLine: debrief, ack: end }]);
  });

  test('a whole-message exit keyword ends the example even when the model answered in character', () => {
    const r = toWorkflowResult({ reply: 'أكيد، شو كمان؟', action: 'NONE' }, ctx({ stage: 'roleplay', wd: { roleplay: liveRoleplay() }, texts: ['خلص'] }));
    expect(r.action).toBe('END_ROLEPLAY');
    expect(r.messages[0].text).toBe(roleplay.endLine('restaurant', 'ar'));

    const notExit = toWorkflowResult({ reply: 'تمام، 2 شاورما.', action: 'NONE' }, ctx({ stage: 'roleplay', wd: { roleplay: liveRoleplay() }, texts: ['خلص، بدي 2 شاورما'] }));
    expect(notExit.action).toBe('NONE');
    expect(notExit.workflowDataPatch.roleplay.active).toBe(true);
  });

  test('roleplayEndResult (index.js exit path, no AI) → END with the end line', () => {
    const r = roleplayEndResult(ctx({ stage: 'roleplay', wd: { roleplay: liveRoleplay() }, texts: ['خلص'], lang: 'en' }));
    expect(r.action).toBe('END_ROLEPLAY');
    expect(r.messages).toEqual([{ type: 'text', text: roleplay.endLine('restaurant', 'en') }]);
    expect(r.workflowDataPatch.roleplay.end_reason).toBe('done');
  });

  test('a handoff mid-example ends it with reason handoff; opt-out with optout', () => {
    const h = toWorkflowResult(
      { reply: 'ولا يهمك.', action: 'HANDOFF_TO_HUMAN', action_args: { reason: 'person' } },
      ctx({ stage: 'roleplay', wd: { roleplay: liveRoleplay() }, texts: ['بدي موظف حقيقي هلأ'] }),
    );
    expect(h.stateUpdate.current_state).toBe('handoff');
    expect(h.workflowDataPatch.roleplay).toMatchObject({ active: false, end_reason: 'handoff' });
    const o = toWorkflowResult({ reply: '', action: 'OPT_OUT' }, ctx({ stage: 'roleplay', wd: { roleplay: liveRoleplay() } }));
    expect(o.workflowDataPatch.roleplay).toMatchObject({ active: false, end_reason: 'optout' });
  });

  test('an AI failure inside the example sends no slot buttons', () => {
    const r = toWorkflowResult(null, ctx({ stage: 'roleplay', wd: { roleplay: liveRoleplay() } }));
    expect(r.kind).toBe('fallback');
    expect(r.messages[0].type).toBe('text');
  });

  test('a roleplay stage whose example already ended continues as close', () => {
    const r = toWorkflowResult({ reply: 'بتحب نكمّل؟', action: 'NONE', stage: 'fit' }, ctx({ stage: 'roleplay', wd: { roleplay: liveRoleplay({ active: false, end_reason: 'idle' }) } }));
    expect(r.stateUpdate).toEqual({ current_state: 'fit' });
  });
});

// ─── pre-fill ────────────────────────────────────────────────────────────────

describe('pre-fill on the first reply (eval #1)', () => {
  const PREFILL = 'مرحبًا شِفت 👋 عندي كافيه زيتون. يهمّني: كرم بوت، نقاط الولاء. عندي ~40 رسالة/يوم وأخسر ~180 دينار/شهر حسب الحاسبة. متى نحكي؟ (المصدر: fb/karam-restaurants)';
  const texts = [PREFILL, 'بإربد', 'الاسم: محمد'];

  test('merged lead shape, confirmed facts kept, calculator numbers out of customer_numbers', () => {
    const prefill = parsePrefill(PREFILL);
    const ai = {
      reply: 'أهلًا محمد 👋 أنا كرم، مساعد شِفت الذكي. أقرب أوقات الفريق:',
      action: 'NONE',
      stage: 'close',
      next_step: 'buttons',
      lead: { name: 'محمد', business_name: 'زيتون', city: 'إربد', interest: 'hot', products: ['karam'] },
    };
    const r = toWorkflowResult(ai, ctx({ stage: 'opening', texts, prefill }));
    expect(r.leadPatch).toMatchObject({
      name: 'محمد',
      business_name: 'كافيه زيتون',
      sector: 'restaurant',
      products: ['karam', 'loyalty'],
      city: 'إربد',
      interest: 'hot',
      source: { type: 'site', attribution: 'fb/karam-restaurants', confidence: 'confirmed' },
    });
    expect(r.leadMeta.trusted).toEqual(expect.arrayContaining(['business_name', 'sector']));
    expect(r.leadMeta.inboundText).not.toContain('180');
    expect(r.workflowDataPatch.site_estimates).toEqual([
      { value: '40', unit: 'msgs_per_day', source: 'site_calculator' },
      { value: '180', unit: 'jod_per_month', source: 'site_calculator' },
    ]);
    expect(r.workflowDataPatch.prefill).toEqual({ kind: 'composed', lang: 'ar', truncated: false, at: MON_11.toISOString(), msg_id: 'm1' });
    expect(r.stateUpdate).toEqual({ current_state: 'close' });

    const { lead } = mergeLead({}, r.leadPatch, r.leadMeta);
    expect(lead).toMatchObject({ name: 'محمد', business_name: 'كافيه زيتون', sector: 'restaurant', city: 'إربد', interest: 'hot' });
    expect(lead.source).toEqual({ type: 'site', attribution: 'fb/karam-restaurants', confidence: 'confirmed' });
    expect(lead._prov.sector.confirmed).toBe(true);
    expect(lead.customer_numbers || []).not.toContain('180');
    expect(lead.customer_numbers || []).not.toContain('40');
    // A slot offer on the first reply is the validators' job; the pre-fill never becomes the sector list.
    expect(r.messages[0].type).toBe('text');
  });

  test('a CTWA source is never overwritten; the pre-fill is applied once', () => {
    const prefill = parsePrefill(PREFILL);
    const ctwa = { lead: { source: { type: 'ctwa', referral: 'x' } } };
    const r = toWorkflowResult({ reply: 'أهلًا', action: 'NONE' }, ctx({ texts, prefill, wd: ctwa }));
    expect(r.leadPatch).not.toHaveProperty('source');

    const again = toWorkflowResult({ reply: 'أهلًا', action: 'NONE' }, ctx({ texts, prefill, wd: { prefill: { kind: 'composed' } } }));
    expect(again.workflowDataPatch).not.toHaveProperty('prefill');
    expect(again.leadPatch?.business_name).toBeUndefined();
  });

  test('an AI failure on a pre-fill still records the parsed facts', () => {
    const r = toWorkflowResult(null, ctx({ texts, prefill: parsePrefill(PREFILL) }));
    expect(r.kind).toBe('fallback');
    expect(r.leadPatch).toMatchObject({ business_name: 'كافيه زيتون', sector: 'restaurant' });
    expect(r.workflowDataPatch.prefill.kind).toBe('composed');
  });

  test('bundle_quote → FLAG_FOR_TEAM quote even when the model did not flag, model line kept', () => {
    const text = 'مرحبًا شِفت، أريد عرض سعر لباقة من: كرم بوت، الحجوزات والمواعيد.';
    const prefill = parsePrefill(text);
    const r = toWorkflowResult({ reply: 'أهلًا وسهلًا، أنا كرم، مساعد شِفت الذكي.', action: 'NONE', stage: 'fit' }, ctx({ texts: [text], prefill }));
    expect(r.action).toBe('FLAG_FOR_TEAM');
    expect(r.stateUpdate.status).toBe('pending');
    expect(r.workflowDataPatch.needs_team).toMatchObject({ reason: 'quote', summary: 'عرض سعر لباقة من الموقع: كرم بوت، الحجوزات والمواعيد' });
    expect(r.alert.reason).toBe('quote');
    const ack = acks.flagAck('quote', { teamHours: TH, lang: 'ar' });
    expect(r.messages[0]).toEqual({ type: 'text', text: `أهلًا وسهلًا، أنا كرم، مساعد شِفت الذكي.\n\n${ack}`, modelLine: 'أهلًا وسهلًا، أنا كرم، مساعد شِفت الذكي.', ack });
    expect(r.leadPatch.products).toEqual(['karam', 'bookings']);

    // A model that flagged itself is left alone.
    const flagged = toWorkflowResult({ reply: 'أكيد.', action: 'FLAG_FOR_TEAM', action_args: { reason: 'quote', summary: 'باقة' } }, ctx({ texts: [text], prefill }));
    expect(flagged.workflowDataPatch.needs_team.summary).toBe('باقة');
  });
});

// ─── sector_text, sector list, language ──────────────────────────────────────

describe('sector_text after «نشاط آخر»', () => {
  test('the first batch text becomes sector_text and the flag clears', () => {
    const r = toWorkflowResult({ reply: 'حلو! مين بيرد على الحجوزات عندك؟', action: 'NONE', stage: 'discovery' },
      ctx({ wd: { awaiting_sector_text: true, lead: { sector: 'other' } }, texts: ['صالون   نسائي'] }));
    expect(r.leadPatch).toMatchObject({ sector_text: 'صالون نسائي' });
    expect(r.leadMeta.trusted).toContain('sector_text');
    expect(r.workflowDataPatch.awaiting_sector_text).toBe(false);
  });

  test('the model\'s own sector_text wins; long text is cut to 60 code points', () => {
    const model = toWorkflowResult({ reply: 'تمام.', action: 'NONE', lead: { sector_text: 'جيم' } },
      ctx({ wd: { awaiting_sector_text: true }, texts: ['عندي جيم للسيدات'] }));
    expect(model.leadPatch.sector_text).toBe('جيم');
    expect(model.workflowDataPatch.awaiting_sector_text).toBe(false);

    const long = toWorkflowResult({ reply: 'تمام.', action: 'NONE' }, ctx({ wd: { awaiting_sector_text: true }, texts: ['ا'.repeat(90)] }));
    expect(Array.from(long.leadPatch.sector_text)).toHaveLength(60);
  });
});

describe('sector list on a bare greeting', () => {
  test('«مرحبا» on the first reply → a list part with the four rows, body = the model line', () => {
    const reply = 'أهلًا وسهلًا 👋 أنا كرم، مساعد شِفت الذكي — shifts-ai.com. شو نوع شغلك؟';
    const r = toWorkflowResult({ reply, action: 'NONE', stage: 'opening' }, ctx({ stage: 'opening', texts: ['مرحبا'] }));
    expect(r.messages).toHaveLength(1);
    const list = r.messages[0];
    expect(list).toMatchObject({ type: 'list', text: reply, modelLine: reply, buttonLabel: acks.sectorListLabel('ar') });
    expect(list.sections[0].rows.map((row) => row.id)).toEqual(['sector:clinic', 'sector:restaurant', 'sector:store', 'sector:other']);
    expect(r.workflowDataPatch.last_bot.next_step).toBe('buttons');
    expect(r.workflowDataPatch.disclosed_at).toBe(MON_11.toISOString());
  });

  test.each([
    ['a second reply', { wd: { bot_turns: 1 }, texts: ['مرحبا'] }],
    ['a known sector', { wd: { lead: { sector: 'clinic' } }, texts: ['مرحبا'] }],
    ['a question', { texts: ['مرحبا، شو بتعملوا؟'] }],
    ['more than three words', { texts: ['مرحبا عندي مطعم بإربد وبدي بوت'] }],
    ['a locked stage', { stage: 'handoff', status: 'pending', texts: ['مرحبا'] }],
  ])('no list for %s', (_, fields) => {
    const r = toWorkflowResult({ reply: 'أهلًا وسهلًا.', action: 'NONE' }, ctx({ stage: 'opening', ...fields }));
    expect(r.messages[0].type).toBe('text');
  });

  test('the English list', () => {
    const r = toWorkflowResult({ reply: "Hi 👋 I'm Karam. What kind of business do you run?", action: 'NONE' }, ctx({ stage: 'opening', texts: ['hello'], lang: 'en' }));
    expect(r.messages[0].type).toBe('list');
    expect(r.messages[0].sections[0].rows[1].title).toBe('Restaurant or café');
  });
});

describe('Arabizi language patch (§5.10)', () => {
  test('an Arabizi batch adds language ar as a trusted field', () => {
    const r = toWorkflowResult({ reply: 'أهلًا! شو نوع شغلك؟', action: 'NONE' }, ctx({ texts: ['mar7aba, 3ndi salon 7ela2a b irbid'] }));
    expect(r.leadPatch).toMatchObject({ language: 'ar' });
    expect(r.leadMeta.trusted).toContain('language');
    expect(mergeLead({ language: 'en' }, r.leadPatch, r.leadMeta).lead.language).toBe('ar');
  });

  test('English or Arabic script → no language patch; the newest message decides', () => {
    expect(toWorkflowResult({ reply: 'Sure.', action: 'NONE' }, ctx({ texts: ['Can we speak tomorrow after 4?'], lang: 'en' })).leadPatch?.language).toBeUndefined();
    expect(toWorkflowResult({ reply: 'أكيد.', action: 'NONE' }, ctx({ texts: ['عندي مطعم'] })).leadPatch?.language).toBeUndefined();
    expect(toWorkflowResult({ reply: 'Sure.', action: 'NONE' }, ctx({ texts: ['kam el se3er?', 'How much is it?'] })).leadPatch?.language).toBeUndefined();
  });

  test('never inside the sandbox', () => {
    const r = toWorkflowResult({ reply: 'تمام.', action: 'NONE' }, ctx({ stage: 'roleplay', wd: { roleplay: liveRoleplay() }, texts: ['kam el se3er?'] }));
    expect(r.leadPatch).toBeNull();
  });
});

// ─── counters, nudge, last_bot ───────────────────────────────────────────────

describe('counters (§9.2 step 9)', () => {
  test('a discovery question counts; a statement does not', () => {
    const q = toWorkflowResult({ reply: 'مين بيرد على واتساب حاليًا؟', action: 'NONE', stage: 'discovery' }, ctx({ wd: { questions_asked: 1 } }));
    expect(q.workflowDataPatch.questions_asked).toBe(2);
    const s = toWorkflowResult({ reply: 'تمام، واضح.', action: 'NONE', stage: 'discovery' }, ctx({ wd: { questions_asked: 1 } }));
    expect(s.workflowDataPatch).not.toHaveProperty('questions_asked');
    const fit = toWorkflowResult({ reply: 'بدك أوريك مثال؟', action: 'NONE', stage: 'fit' }, ctx({ wd: { questions_asked: 2 } }));
    expect(fit.workflowDataPatch).not.toHaveProperty('questions_asked');
  });

  test('msgs_since_interest resets on hot interest or a tap, else counts up', () => {
    expect(toWorkflowResult({ reply: 'تمام.', action: 'NONE' }, ctx({ wd: { msgs_since_interest: 2 } })).workflowDataPatch.msgs_since_interest).toBe(3);
    expect(toWorkflowResult({ reply: 'تمام.', action: 'NONE', lead: { interest: 'hot' } }, ctx({ wd: { msgs_since_interest: 2 } })).workflowDataPatch.msgs_since_interest).toBe(0);
    const tapBatch = [{ id: 'm1', message_type: 'interactive', text_body: 'بكرا 10–12' }];
    expect(toWorkflowResult({ reply: 'تمام.', action: 'NONE' }, ctx({ wd: { msgs_since_interest: 2 }, batch: tapBatch })).workflowDataPatch.msgs_since_interest).toBe(0);
  });

  test('calc_echoed_at is set once when the model line mentions «الحاسبة» and estimates exist', () => {
    const estimates = [{ value: '40', unit: 'msgs_per_day', source: 'site_calculator' }];
    const reply = 'وصلتني حسبتك من الموقع — والحاسبة قدّرت هيك، تقدير مبني على أرقامك.';
    const r = toWorkflowResult({ reply, action: 'NONE' }, ctx({ wd: { site_estimates: estimates } }));
    expect(r.workflowDataPatch.calc_echoed_at).toBe(MON_11.toISOString());
    expect(toWorkflowResult({ reply, action: 'NONE' }, ctx({ wd: { site_estimates: estimates, calc_echoed_at: 'x' } })).workflowDataPatch).not.toHaveProperty('calc_echoed_at');
    expect(toWorkflowResult({ reply, action: 'NONE' }, ctx({})).workflowDataPatch).not.toHaveProperty('calc_echoed_at');
  });

  test('close_declines counts a declined call in the close stage only', () => {
    const r = toWorkflowResult({ reply: 'ولا يهمك، بطلبلك عرض مكتوب؟', action: 'NONE', stage: 'close' }, ctx({ stage: 'close', wd: { close_declines: 1 }, texts: ['لا ما بدي مكالمة'] }));
    expect(r.workflowDataPatch.close_declines).toBe(2);
    const fit = toWorkflowResult({ reply: 'تمام.', action: 'NONE' }, ctx({ stage: 'fit', texts: ["I don't want a call"] }));
    expect(fit.workflowDataPatch).not.toHaveProperty('close_declines');
    const en = toWorkflowResult({ reply: 'Sure.', action: 'NONE' }, ctx({ stage: 'close', texts: ["I don't want a call"], lang: 'en' }));
    expect(en.workflowDataPatch.close_declines).toBe(1);
  });

  test('every inbound-driven result cancels a pending nudge and records last_bot', () => {
    const wd = { nudge: { due_at: 'x', kind: 'stage', for_inbound_id: 'm0' } };
    for (const ai of [{ reply: 'تمام.', action: 'NONE' }, null, { reply: '', action: 'OPT_OUT' }, { reply: 'على راحتك.', action: 'NOT_NOW' }]) {
      const r = toWorkflowResult(ai, ctx({ wd }));
      expect(r.workflowDataPatch.nudge).toBeNull();
      expect(r.workflowDataPatch.last_bot).toMatchObject({ at: MON_11.toISOString(), action: r.action });
    }
    expect(toWorkflowResult({ reply: 'على راحتك.', action: 'NOT_NOW' }, ctx({ wd })).workflowDataPatch.last_bot.next_step).toBe('terminal');
  });
});

// ─── part metadata ───────────────────────────────────────────────────────────

describe('modelLine / ack metadata on every composed part', () => {
  test('NONE text', () => {
    expect(toWorkflowResult({ reply: 'أهلًا', action: 'NONE' }, ctx()).messages[0]).toEqual({ type: 'text', text: 'أهلًا', modelLine: 'أهلًا' });
  });

  test('FLAG_FOR_TEAM: model line + the server ack', () => {
    const r = toWorkflowResult({ reply: 'ما بقدر أخمّن سعر.', action: 'FLAG_FOR_TEAM', action_args: { reason: 'quote', summary: 's' }, stage: 'fit' }, ctx());
    const ack = acks.flagAck('quote', { teamHours: TH, lang: 'ar' });
    expect(r.messages[0]).toEqual({ type: 'text', text: `ما بقدر أخمّن سعر.\n\n${ack}`, modelLine: 'ما بقدر أخمّن سعر.', ack });
  });

  test('CAPTURE_TIME preview and its re-render keep the model reply without the media prefix', () => {
    const batch = [
      { id: 'm1', message_type: 'audio', text_body: null },
      { id: 'm2', message_type: 'text', text_body: 'محمد، زيتون، بكرا الساعة 5؟' },
    ];
    const r = toWorkflowResult(
      { reply: 'أكيد يا محمد.', action: 'CAPTURE_TIME', action_args: { time_text: 'بكرا الساعة 5' }, lead: { name: 'محمد', business_name: 'زيتون' } },
      ctx({ stage: 'close', batch }),
    );
    expect(r.action).toBe('CAPTURE_TIME');
    const part = r.messages[0];
    expect(part.modelLine).toBe('أكيد يا محمد.');
    expect(part.ack).toContain('سجّلت طلب مكالمة');
    expect(part.text.startsWith(acks.mediaPrefix('audio', 'ar', { captioned: false }))).toBe(true);
    const rendered = renderCaptureAck(r.capture, { name: 'محمد', business_name: 'زيتون', preferred_time: { text: 'بكرا الساعة 5' } });
    expect(rendered.messages[0].modelLine).toBe('أكيد يا محمد.');
  });

  test('a capture ask built by the server carries no model metadata', () => {
    const r = toWorkflowResult({ reply: 'تمام.', action: 'CAPTURE_TIME', action_args: { time_text: 'بكرا' } }, ctx({ stage: 'close', texts: ['طيب بكرا'] }));
    expect(r.messages[0]).not.toHaveProperty('modelLine');
  });

  test('NONE with slot buttons → interactive with metadata', () => {
    const offers = [{ id: 'slot:2026-09-15T10:00+03:00/12:00', title: 'بكرا 10–12' }];
    const r = toWorkflowResult({ reply: 'أقرب أوقات الفريق:', action: 'NONE', buttons: [{ id: offers[0].id, title: 'x' }] }, ctx({ offers }));
    expect(r.messages[0]).toEqual({ type: 'interactive', text: 'أقرب أوقات الفريق:', buttons: offers, modelLine: 'أقرب أوقات الفريق:' });
  });

  test('HANDOFF_TO_HUMAN: the first model line + the handoff ack', () => {
    const r = toWorkflowResult({ reply: 'ولا يهمك.\nسطر ثاني', action: 'HANDOFF_TO_HUMAN', action_args: { reason: 'person' } }, ctx());
    expect(r.messages[0].modelLine).toBe('ولا يهمك.');
    expect(r.messages[0].ack).toBe(acks.handoffAck({ teamHours: TH, now: MON_11, lang: 'ar' }));
  });

  test('server-only texts (opt-out, AI failure, NOT_NOW without a line) carry none', () => {
    expect(toWorkflowResult({ reply: '', action: 'OPT_OUT' }, ctx()).messages[0]).toEqual({ type: 'text', text: acks.optOut('ar') });
    expect(toWorkflowResult(null, ctx()).messages[0]).not.toHaveProperty('modelLine');
    expect(toWorkflowResult({ reply: '', action: 'NOT_NOW' }, ctx()).messages[0]).toEqual({ type: 'text', text: acks.notNow('ar') });
  });

  test('a transcribed voice note gets «(سمعت رسالتك الصوتية)», an unread one keeps PR1\'s text-only line', () => {
    const heard = [{ id: 'm1', message_type: 'audio', text_body: null, shift_media: { type: 'audio', text: 'بدي أعرف السعر', status: 'ok' } }];
    const r = toWorkflowResult({ reply: 'أكيد، السعر بيحدده الفريق.', action: 'NONE' }, ctx({ batch: heard }));
    expect(r.messages[0]).toEqual({ type: 'text', text: '(سمعت رسالتك الصوتية)\nأكيد، السعر بيحدده الفريق.', modelLine: 'أكيد، السعر بيحدده الفريق.' });

    const failed = [{ id: 'm1', message_type: 'audio', text_body: null, raw_payload: { shift_media: { status: 'failed' } } }];
    const f = toWorkflowResult({ reply: 'أكيد.', action: 'NONE' }, ctx({ batch: failed }));
    expect(f.messages[0].text).toContain('بقرأ النص بس');
  });

  test('the validators see only the model line: a true «سجّلت» ack passes, a claimed one in the model line is blocked', () => {
    const vctx = {
      attempt: 1, lang: 'ar', stage: 'fit', action: 'FLAG_FOR_TEAM', batchTexts: ['بدي عرض سعر'], customerHistoryTexts: [],
      lead: {}, roleplayFacts: [], allowedButtonIds: new Set(), offers: [], stageLocked: false,
    };
    const ok = toWorkflowResult({ reply: 'أكيد.', action: 'FLAG_FOR_TEAM', action_args: { reason: 'quote' } }, ctx({ texts: ['بدي عرض سعر'] }));
    expect(validators.validateResult(ok, vctx).verdict).toBe('ok');
    const bad = toWorkflowResult({ reply: 'سجّلت طلبك.', action: 'FLAG_FOR_TEAM', action_args: { reason: 'quote' } }, ctx({ texts: ['بدي عرض سعر'] }));
    expect(validators.validateResult(bad, vctx).verdict).toBe('regenerate');
  });
});

// ─── stage transitions ───────────────────────────────────────────────────────

describe('nextStage (§2.5)', () => {
  test('server-forced transitions', () => {
    expect(nextStage('roleplay', 'fit', 'OPT_OUT')).toBe('closed');
    expect(nextStage('fit', 'fit', 'HANDOFF_TO_HUMAN')).toBe('handoff');
    expect(nextStage('roleplay_setup', null, 'START_ROLEPLAY')).toBe('roleplay');
    expect(nextStage('roleplay', null, 'END_ROLEPLAY')).toBe('close');
    expect(nextStage('fit', null, 'SEND_SAMPLE')).toBe('sample');
    expect(nextStage('handoff', 'fit', 'SEND_SAMPLE', true)).toBeUndefined();
  });

  test('proposals: sample and roleplay_setup accepted, roleplay never left by a proposal', () => {
    expect(nextStage('fit', 'sample', 'NONE')).toBe('sample');
    expect(nextStage('sample', 'roleplay_setup', 'NONE')).toBe('roleplay_setup');
    expect(nextStage('roleplay', 'close', 'NONE')).toBeUndefined();
    expect(nextStage('fit', 'roleplay', 'NONE')).toBeUndefined();
    expect(nextStage('fit', 'closed', 'NONE')).toBeUndefined();
    expect(nextStage('closed', 'roleplay_setup', 'NONE')).toBeUndefined();
  });

  test('roleplay_setup refused while role-play is off', () => {
    process.env.SHIFT_ROLEPLAY = '0';
    expect(nextStage('sample', 'roleplay_setup', 'NONE')).toBeUndefined();
    process.env.SHIFT_ROLEPLAY = '';
    process.env.SHIFT_PROMPT_V1 = '1';
    expect(nextStage('sample', 'roleplay_setup', 'NONE')).toBeUndefined();
    expect(nextStage('fit', 'sample', 'NONE')).toBeUndefined();
  });

  test('a model-proposed setup creates the setup object (its ask counts)', () => {
    const r = toWorkflowResult({ reply: 'عشان أجرّبه على مطعمك: شو اسمه وصنفين من المنيو؟', action: 'NONE', stage: 'roleplay_setup' },
      ctx({ stage: 'sample', wd: { lead: { sector: 'restaurant' } } }));
    expect(r.stateUpdate).toEqual({ current_state: 'roleplay_setup' });
    expect(r.workflowDataPatch.roleplay).toMatchObject({ active: false, sector: 'restaurant', setup_asks: 1 });
  });
});

test('no result in this suite carries the old domain', () => {
  const r = [
    toWorkflowResult({ reply: 'أهلًا', action: 'NONE' }, ctx({ stage: 'opening', texts: ['مرحبا'] })),
    roleplayEndResult(ctx({ stage: 'roleplay', wd: { roleplay: liveRoleplay() } })),
  ];
  expect(JSON.stringify(r)).not.toContain(OLD_HOST);
});

// ─── integration pass ────────────────────────────────────────────────────────

describe('integration pass', () => {
  const OFFERS = [];

  test('a model-proposed roleplay_setup («جرّبني») gets the fixed setup ask; the model\'s own question is dropped', () => {
    const r = toWorkflowResult(
      { reply: 'أكيد، خلّيني أصير كرم تبع مطعمك. شو اسم المطعم؟', action: 'NONE', stage: 'roleplay_setup', next_step: 'question' },
      ctx({ stage: 'fit', wd: { lead: { sector: 'restaurant' } }, texts: ['جرّبني'], offers: OFFERS }),
    );
    const ask = roleplay.setupAsk('restaurant', 'ar');
    expect(r.messages).toEqual([{ type: 'text', text: `أكيد، خلّيني أصير كرم تبع مطعمك.\n\n${ask}`, modelLine: 'أكيد، خلّيني أصير كرم تبع مطعمك.', ack: ask }]);
    expect(r.stateUpdate).toEqual({ current_state: 'roleplay_setup' });
    expect(r.workflowDataPatch.roleplay).toMatchObject({ active: false, sector: 'restaurant', setup_asks: 1 });

    const onlyQuestion = toWorkflowResult(
      { reply: 'شو اسم المطعم؟', action: 'NONE', stage: 'roleplay_setup', next_step: 'question' },
      ctx({ stage: 'fit', wd: { lead: {} }, texts: ['try me'], lang: 'en', offers: OFFERS }),
    );
    expect(onlyQuestion.messages).toEqual([{ type: 'text', text: roleplay.setupAsk('other', 'en') }]);
  });

  test('a time the customer stated (model wrote only lead.preferred_time) → stored, capture_pending, identity ask', () => {
    const r = toWorkflowResult(
      { reply: 'Sure, happy to set that up.', action: 'NONE', stage: 'close', next_step: 'confirmed', lead: { preferred_time: 'tomorrow after 4' } },
      ctx({ stage: 'discovery', wd: { lead: { sector: 'store' } }, texts: ['Can we speak tomorrow after 4?'], lang: 'en', offers: OFFERS }),
    );
    expect(r.action).toBe('CAPTURE_TIME');
    expect(r.messages).toEqual([{ type: 'text', text: acks.captureAsk({ nameKnown: false, businessKnown: false, sector: 'store', lang: 'en' }) }]);
    expect(r.workflowDataPatch.capture_pending).toEqual({ slot_id: null, time_text: 'tomorrow after 4', at: MON_11.toISOString() });
    expect(r.leadPatch.preferred_time).toBe('tomorrow after 4');
    expect(r.stateUpdate).toEqual({ current_state: 'close' });

    // With the name known it is the capture itself (ack + meeting request).
    const known = toWorkflowResult(
      { reply: 'Great.', action: 'NONE', stage: 'close', next_step: 'confirmed', lead: { preferred_time: 'tomorrow after 4' } },
      ctx({ stage: 'close', wd: { lead: { name: 'Sam', business_name: 'Noor Boutique' } }, texts: ['call me tomorrow after 4'], lang: 'en', offers: OFFERS }),
    );
    expect(known.action).toBe('CAPTURE_TIME');
    expect(known.stateUpdate).toEqual({ status: 'pending', current_state: 'captured' });

    // Not a time («متى نحكي؟» copied into the field) → no upgrade.
    const notTime = toWorkflowResult(
      { reply: 'أكيد.', action: 'NONE', stage: 'close', next_step: 'confirmed', lead: { preferred_time: 'متى نحكي' } },
      ctx({ stage: 'close', wd: { lead: {} }, texts: ['متى نحكي؟'], offers: OFFERS }),
    );
    expect(notTime.action).toBe('NONE');
    expect(notTime.workflowDataPatch.capture_pending).toBeUndefined();
  });

  test('consent buttons after a declined call: server titles, only when allowed', () => {
    const ask = { reply: 'بتحب يتواصل معك الفريق بعد يومين؟', action: 'NONE', stage: 'close', next_step: 'buttons', buttons: [{ id: 'followup_yes', title: 'yes' }, { id: 'followup_no', title: 'no' }] };
    const quoteOpen = { reason: 'quote', summary: 'x', at: MON_11.toISOString(), resolved_at: null };
    const r = toWorkflowResult(ask, ctx({ stage: 'sample', status: 'pending', wd: { close_declines: 1, needs_team: quoteOpen }, offers: OFFERS }));
    expect(r.messages).toEqual([{ type: 'interactive', text: ask.reply, buttons: acks.consentButtons('ar'), modelLine: ask.reply }]);

    const tooEarly = toWorkflowResult(ask, ctx({ stage: 'close', wd: {}, offers: OFFERS }));
    expect(tooEarly.messages[0].type).toBe('text');
    const alreadyConsented = toWorkflowResult(ask, ctx({ stage: 'close', wd: { close_declines: 2, lead_consent: { answer: 'yes' } }, offers: OFFERS }));
    expect(alreadyConsented.messages[0].type).toBe('text');
  });
});

// ─── Review round 1 ──────────────────────────────────────────────────────────

describe('review round 1 (results)', () => {
  test('minor: in the role-play setup a CAPTURE_TIME or a meeting flag is not a real call request (G6)', () => {
    const wd = { lead: { name: 'محمد', business_name: 'كافيه زيتون', sector: 'restaurant' }, roleplay: setupRoleplay() };
    const texts = ['مطعم الساحة، شاورما 3 دنانير، الطلبات بكرا الساعة 11'];
    for (const ai of [
      { reply: 'تمام، سجلت المعلومات.', action: 'CAPTURE_TIME', action_args: { time_text: 'بكرا الساعة 11' } },
      { reply: 'تمام.', action: 'FLAG_FOR_TEAM', action_args: { reason: 'meeting', time_text: 'بكرا الساعة 11' } },
    ]) {
      const r = toWorkflowResult(ai, ctx({ stage: 'roleplay_setup', wd, texts, roleplayOn: true, vetted: new Set() }));
      expect(r.action).toBe('NONE');
      expect(r.stateUpdate.status).toBeUndefined();
      expect(r.capture).toBeUndefined();
      expect(r.alert).toBeNull();
      expect(r.leadPatch).toBeNull();
    }
  });

  test('minor: SEND_SAMPLE with a vetted sector keeps only the model line\'s statements before the card (one question)', () => {
    const r = toWorkflowResult(
      { reply: 'أكيد، هاد مثال على عيادة. بتحب تجرّبه بعدها؟', action: 'SEND_SAMPLE', action_args: { sector: 'clinic' } },
      ctx({ stage: 'fit', wd: { lead: { sector: 'clinic' } }, roleplayOn: true, vetted: new Set(['clinic']) }),
    );
    expect(r.messages).toHaveLength(2);
    expect(r.messages[0].text).toBe('أكيد، هاد مثال على عيادة.');
    const questions = r.messages.reduce((n, m) => n + validators.countQuestions(m.text), 0);
    expect(questions).toBe(1);
  });

  test('minor: SEND_SAMPLE into the role-play setup drops the model\'s own question before the fixed ask', () => {
    const r = toWorkflowResult(
      { reply: 'أكيد. بتحب نجرّبه على مطعمك؟', action: 'SEND_SAMPLE', action_args: { sector: 'restaurant' } },
      ctx({ stage: 'fit', wd: { lead: { sector: 'restaurant' } }, roleplayOn: true, vetted: new Set() }),
    );
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].text).toBe(`أكيد.\n\n${roleplay.setupAsk('restaurant', 'ar')}`);
  });

  test('minor: the example\'s business name loses links, prices and discounts before it reaches the start line', () => {
    const r = toWorkflowResult(
      { reply: 'يلا.', action: 'START_ROLEPLAY', action_args: { sector: 'restaurant', business_name: 'مطعم الساحة www.shift-offer.co خصم 50% للمشتركين', facts: FACTS } },
      ctx({
        stage: 'roleplay_setup',
        wd: { lead: { sector: 'restaurant' }, roleplay: setupRoleplay() },
        texts: ['مطعم الساحة www.shift-offer.co خصم 50% للمشتركين، شاورما 3 دنانير، برجر 4، توصيل داخل إربد'],
        roleplayOn: true,
        vetted: new Set(),
      }),
    );
    expect(r.workflowDataPatch.roleplay.business_name).toBe('مطعم الساحة');
    expect(r.messages[0].text).not.toMatch(/www|50|خصم/);
    expect(r.leadPatch).toEqual({ business_name: 'مطعم الساحة' });
  });

  test('minor: a name that is only a link or an offer does not start the example', () => {
    const r = toWorkflowResult(
      { reply: 'يلا.', action: 'START_ROLEPLAY', action_args: { sector: 'restaurant', business_name: 'www.shift-offer.co', facts: FACTS } },
      ctx({ stage: 'roleplay_setup', wd: { lead: { sector: 'restaurant' }, roleplay: setupRoleplay() }, roleplayOn: true, vetted: new Set() }),
    );
    expect(r.action).not.toBe('START_ROLEPLAY');
    expect(r.workflowDataPatch.roleplay).toBeUndefined();
  });

  test('minor: a reply that already offered a step restarts the commitment count', () => {
    const offered = toWorkflowResult({ reply: 'تمام. بدك أوريك مثال على شغلك؟', action: 'NONE' }, ctx({ wd: { msgs_since_interest: 3 } }));
    expect(offered.workflowDataPatch.msgs_since_interest).toBe(0);
    const plain = toWorkflowResult({ reply: 'كرم بيرد بالليل كمان.', action: 'NONE' }, ctx({ wd: { msgs_since_interest: 3 } }));
    expect(plain.workflowDataPatch.msgs_since_interest).toBe(4);
  });
});

describe('review round 2 (results)', () => {
  const idleEnded = (sector = 'restaurant', endedAgoMs = 5 * 60 * 1000) => roleplay.endState(
    liveRoleplay({ sector, turns: 2, started_at: new Date(MON_11.getTime() - 40 * 60 * 1000).toISOString() }),
    'idle',
    new Date(MON_11.getTime() - endedAgoMs),
  );

  describe('r2 #0 / #10: the first batch after a silent idle end stays out of the real lead and the call capture', () => {
    test('a mock name and time written in character are not a lead, a capture or an alert', () => {
      const wd = { roleplay: idleEnded(), lead: { business_name: 'مطعم الساحة', sector: 'restaurant' }, bot_turns: 5 };
      const r = toWorkflowResult(
        { reply: 'تمام يا أبو أحمد.', action: 'NONE', stage: 'close', next_step: 'wait', lead: { name: 'أبو أحمد', preferred_time: 'بكرا الساعة 8' } },
        ctx({ stage: 'close', wd, texts: ['وبدي كمان 2 شاورما، اسمي أبو أحمد، بدي ياها بكرا الساعة 8'] }),
      );
      expect(r.action).not.toBe('CAPTURE_TIME');
      expect(r.leadPatch).toBeNull();
      expect(r.alert).toBeNull();
      expect(r.stateUpdate.current_state).not.toBe('captured');
      // The customer is told the example is over, in front of the reply, and that is recorded.
      expect(r.messages[0].text.startsWith(roleplay.endNote('restaurant', 'ar'))).toBe(true);
      expect(r.messages[0].modelLine).toBe('تمام يا أبو أحمد.');
      expect(r.workflowDataPatch.roleplay).toMatchObject({ active: false, end_reason: 'idle', end_announced_at: MON_11.toISOString() });
    });

    test('a mock booking the model records as preferred_time is not a real call request', () => {
      const ended = idleEnded('clinic', 60 * 1000);
      const ai = { reply: 'تمام، بشوف مع الفريق.', action: 'NONE', stage: 'close', next_step: 'confirmed', lead: { preferred_time: 'بكرا الساعة 5' } };
      const live = toWorkflowResult(ai, ctx({ stage: 'roleplay', wd: { roleplay: liveRoleplay({ sector: 'clinic' }), lead: { business_name: 'عيادة النور' } }, texts: ['بدي احجز موعد بكرا الساعة 5'] }));
      expect(live.action).not.toBe('CAPTURE_TIME');
      const r = toWorkflowResult(ai, ctx({ stage: 'close', wd: { roleplay: ended, lead: { business_name: 'عيادة النور' }, bot_turns: 4 }, texts: ['بدي احجز موعد بكرا الساعة 5'] }));
      expect(r.action).not.toBe('CAPTURE_TIME');
      expect(r.stateUpdate.current_state).not.toBe('captured');
      expect(r.workflowDataPatch.needs_team).toBeUndefined();
      expect(r.messages[0].text.startsWith(roleplay.endNote('clinic', 'ar'))).toBe(true);
    });

    test('once the end was told, the next batch is sales again (a stated time is captured)', () => {
      const wd = {
        roleplay: { ...idleEnded(), end_announced_at: new Date(MON_11.getTime() - 60 * 1000).toISOString() },
        lead: { name: 'محمد', business_name: 'مطعم الساحة', sector: 'restaurant' },
      };
      const r = toWorkflowResult(
        { reply: 'تمام.', action: 'NONE', stage: 'close', lead: { preferred_time: 'بكرا الساعة 5' } },
        ctx({ stage: 'close', wd, texts: ['بدي مكالمة بكرا الساعة 5'] }),
      );
      expect(r.action).toBe('CAPTURE_TIME');
      expect(r.workflowDataPatch.roleplay).toBeUndefined();
    });

    test('an opt-out after the silent end gets its ack alone', () => {
      const r = toWorkflowResult({ reply: '', action: 'OPT_OUT' }, ctx({ stage: 'close', wd: { roleplay: idleEnded() }, texts: ['ما بدي رسائل'] }));
      expect(r.messages[0].text).toBe(acks.optOut('ar'));
    });
  });

  describe('r2 #2: role-play facts and the business name come from what the customer typed', () => {
    const setupCtx = (texts, extra = {}) => ctx({ stage: 'roleplay_setup', wd: { roleplay: setupRoleplay() }, texts, roleplayOn: true, vetted: new Set(), ...extra });

    test('invented fact prices are removed, so the in-character price is blocked by the digit guard', () => {
      const customer = 'مطعم الريم، عنا منسف ومقلوبة';
      const r = toWorkflowResult({
        reply: 'تفضل، شو بتحب تطلب؟',
        action: 'START_ROLEPLAY',
        action_args: { sector: 'restaurant', business_name: 'مطعم الريم', facts: ['منسف 8 دنانير', 'مقلوبة 6 دنانير'] },
        stage: 'roleplay_setup',
        next_step: 'question',
      }, setupCtx([customer]));
      expect(r.action).toBe('START_ROLEPLAY');
      expect(r.workflowDataPatch.roleplay.facts).toEqual(['منسف', 'مقلوبة']);
      const vctx = { roleplayActive: true, roleplayFacts: r.workflowDataPatch.roleplay.facts, batchTexts: ['كم سعر المنسف؟'], roleplayTexts: ['كم سعر المنسف؟', customer], lead: {} };
      expect(validators.checkDigits('المنسف بـ8 دنانير.', vctx)).not.toEqual([]);
      expect(r.leadPatch).toEqual({ business_name: 'مطعم الريم' });
    });

    test('prices from an earlier customer message (history) are kept', () => {
      const r = toWorkflowResult({
        reply: 'يلا.',
        action: 'START_ROLEPLAY',
        action_args: { sector: 'restaurant', business_name: 'مطعم الريم', facts: ['منسف 8 دنانير'] },
      }, setupCtx(['اسمه مطعم الريم'], { customerHistoryTexts: ['عنا منسف بـ8 دنانير'] }));
      expect(r.workflowDataPatch.roleplay.facts).toEqual(['منسف 8 دنانير']);
    });

    test('a business name the customer never typed starts the example but is not written to the real lead', () => {
      const r = toWorkflowResult({
        reply: 'تفضل.',
        action: 'START_ROLEPLAY',
        action_args: { sector: 'restaurant', business_name: 'مطعم الأمل', facts: ['منسف'] },
      }, setupCtx(['عنا منسف ومقلوبة']));
      expect(r.action).toBe('START_ROLEPLAY');
      expect(r.leadPatch).toBeNull();
    });

    test('the name without its generic head word counts as typed («الريم» → «مطعم الريم»)', () => {
      const r = toWorkflowResult({
        reply: 'تفضل.',
        action: 'START_ROLEPLAY',
        action_args: { sector: 'restaurant', business_name: 'مطعم الريم', facts: ['منسف'] },
      }, setupCtx(['الريم، عنا منسف']));
      expect(r.leadPatch).toEqual({ business_name: 'مطعم الريم' });
    });
  });

  describe('r2 #12: a live example outside its stage is never played', () => {
    test('captured/pending with a live object: the reply is out of character and the object ends', () => {
      const wd = { lead: { name: 'أحمد', business_name: 'مطعم زيتون', sector: 'restaurant' }, roleplay: liveRoleplay({ turns: 1 }) };
      const r = toWorkflowResult(
        { reply: 'طلبك بقائمة الفريق، وهم بيتواصلوا معك.', action: 'NONE', next_step: 'confirmed', lead: {} },
        ctx({ stage: 'captured', status: 'pending', wd, texts: ['طيب امتى بيتصلوا؟'], roleplayOn: true }),
      );
      expect(r.workflowDataPatch.roleplay).toMatchObject({ active: false, end_reason: 'done', turns: 1 });
    });
  });
});

