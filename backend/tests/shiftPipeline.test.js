/**
 * shiftPipeline.test.js — PR2 contract §10.4 (L3a).
 *
 * The real pipeline behind the batcher: replyBatcher → workflows/shift (index, results, validators,
 * context, prompt v2) → ai/provider → a scripted Gemini SDK, and services/whatsapp → a mocked axios.
 * The DB is the in-memory fakeDb. Nothing reaches the network; the clock is Monday 14 Sep 2026 11:00
 * Amman (inside the default team hours, so slot offers exist).
 */

require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');
jest.mock('../src/services/alerts', () => ({
  sendStaffAlert: jest.fn(),
  alertChannelConfigured: jest.fn(() => false),
  ALERT_REASONS: [],
}));

const mockGenerateContent = jest.fn();
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({ generateContent: mockGenerateContent }),
  })),
}));

const path = require('path');
const axios = require('axios');
const db = require('./helpers/fakeDb').getFakeDb();
const alerts = require('../src/services/alerts');
const batcher = require('../src/services/replyBatcher');
const { processShiftBatch } = require('../src/workflows/shift');
const acks = require('../src/workflows/shift/acks');
const hours = require('../src/workflows/shift/hours');
const buttons = require('../src/workflows/shift/buttons');
const roleplay = require('../src/workflows/shift/roleplay');
const validators = require('../src/workflows/shift/validators');

const CUSTOMER = '962790000001';
const START = new Date('2026-09-14T08:00:00.000Z'); // Monday 11:00 Amman
const OFFERS = buttons.slotOffers(hours.resolveTeamHours({}), START, 'ar');
const PREFILL = 'مرحبًا شِفت 👋 عندي كافيه زيتون. يهمّني: كرم بوت، نقاط الولاء. عندي ~40 رسالة/يوم وأخسر ~180 دينار/شهر حسب الحاسبة. متى نحكي؟ (المصدر: fb/karam-restaurants)';
const ARABIC = /[ء-ي]/;

let seq = 0;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function modelReply(obj) {
  return { response: { text: () => JSON.stringify(obj), usageMetadata: {}, candidates: [{ finishReason: 'STOP' }] } };
}

function script(...replies) {
  for (const r of replies) mockGenerateContent.mockResolvedValueOnce(modelReply(r));
}

function seedShift(conversation = {}) {
  const [biz] = db.seed({
    businesses: [{
      name: 'SHIFT', business_type: 'shift', status: 'active', wa_phone_number_id: 'pnid_shift',
      wa_access_token: 'plain_test_token', ai_config: {},
    }],
  }).businesses;
  const [conv] = db.seed({
    conversations: [{ business_id: biz.id, customer_wa_id: CUSTOMER, last_inbound_at: new Date(), ...conversation }],
  }).conversations;
  return { biz, conv };
}

function seedInbound(conv, text, fields = {}) {
  seq += 1;
  return db.seed({
    messages: [{
      business_id: conv.business_id, conversation_id: conv.id, direction: 'inbound', status: 'received',
      message_type: 'text', text_body: text, meta_message_id: `wamid.pin${seq}`,
      created_at: new Date(Date.now() - 1000 + seq), ...fields,
    }],
  }).messages[0];
}

function seedTap(conv, id, title) {
  return seedInbound(conv, title, { message_type: 'interactive', interactive_reply: { type: 'button_reply', button_reply: { id, title } } });
}

/** One customer turn: the rows are saved `received`, then one batch run answers them. */
async function turn(conv, texts) {
  const before = sends().length;
  for (const t of [].concat(texts)) {
    if (typeof t === 'string') seedInbound(conv, t);
    else seedTap(conv, t.tap, t.title);
  }
  jest.setSystemTime(new Date(Date.now() + 1000));
  const report = await batcher.runBatch(conv.id);
  return { report, parts: sends().slice(before) };
}

// Customer-facing Graph sends (read receipts excluded).
function sends() {
  return axios.post.mock.calls
    .filter(([url, payload]) => /\/messages$/.test(url) && payload && ['text', 'interactive', 'image'].includes(payload.type))
    .map(([, payload]) => payload);
}

function bodyOf(payload) {
  if (payload.type === 'text') return payload.text.body;
  if (payload.type === 'image') return payload.image.caption;
  return payload.interactive.body.text;
}

const convRow = (id) => db.store.conversations.find((c) => c.id === id);
const userTurnOf = (call) => mockGenerateContent.mock.calls[call][0].contents[0].parts[0].text;

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(START);
  db.reset();
  seq = 0;
  for (const k of ['SHIFT_PROMPT_V1', 'SHIFT_ROLEPLAY', 'SHIFT_MEDIA', 'SHIFT_BOT_LIVE', 'SHIFT_SAMPLES_VETTED']) delete process.env[k];
  axios.post.mockReset();
  let out = 0;
  axios.post.mockImplementation(async () => {
    out += 1;
    return { status: 200, data: { messages: [{ id: `wamid.out${out}` }] } };
  });
  mockGenerateContent.mockReset();
  alerts.sendStaffAlert.mockReset().mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  batcher.cancelAll();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ─── Validators in the loop ──────────────────────────────────────────────────

describe('regeneration and fallback', () => {
  test('a digits block → one regeneration with the hint → the clean second reply is sent', async () => {
    const { conv } = seedShift({ current_state: 'discovery' });
    script(
      { reply: 'الاشتراك بـ25 دينار بالشهر. شو نوع منشأتك؟', action: 'NONE', stage: 'discovery', next_step: 'question' },
      { reply: 'الأسعار بيبعتها الفريق مكتوبة بعد ما نعرف شغلك. شو نوع منشأتك؟', action: 'NONE', stage: 'discovery', next_step: 'question' },
    );

    const { parts } = await turn(conv, 'كم السعر؟');

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(userTurnOf(0)).not.toContain('# ملاحظة من النظام');
    expect(userTurnOf(1)).toContain(`# ملاحظة من النظام\n${validators.hintFor('digits', 'ar')}`);
    expect(parts).toHaveLength(1);
    expect(bodyOf(parts[0])).toBe('الأسعار بيبعتها الفريق مكتوبة بعد ما نعرف شغلك. شو نوع منشأتك؟');
    const wd = convRow(conv.id).workflow_data;
    expect(wd.validator_blocks).toEqual([{ at: expect.any(String), codes: ['digits'], attempt: 1 }]);
    expect(wd.last_bot).toMatchObject({ stage: 'discovery', next_step: 'question', action: 'NONE' });
  });

  test('digits on both attempts → the stage fallback line, with the quote ack, the team request and the alert kept', async () => {
    const { conv } = seedShift({ current_state: 'fit' });
    const priced = { reply: 'الباقة بتبدأ من 30 دينار بالشهر.', action: 'FLAG_FOR_TEAM', action_args: { reason: 'quote', summary: 'بدو سعر' }, stage: 'fit', next_step: 'confirmed' };
    script(priced, priced);

    const { parts } = await turn(conv, 'بدي سعر تقريبي');

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(parts).toHaveLength(1);
    const text = bodyOf(parts[0]);
    const th = hours.resolveTeamHours({});
    expect(text).toBe(`${validators.stageFallback('fit', 'ar')}\n\n${acks.flagAck('quote', { teamHours: th, lang: 'ar' })}`);
    expect(text).not.toContain('30');
    const c = convRow(conv.id);
    expect(c.status).toBe('pending');
    expect(c.workflow_data.needs_team.reason).toBe('quote');
    expect(c.workflow_data.validator_blocks.map((b) => b.attempt)).toEqual([1, 2]);
    expect(alerts.sendStaffAlert.mock.calls.map(([a]) => a.reason)).toEqual(['quote']);
    expect(db.store.messages.filter((m) => m.direction === 'inbound').map((m) => m.status)).toEqual(['answered']);
  });

  test('an identity question answered with a dodge twice → the honest identity line', async () => {
    const { conv } = seedShift({ current_state: 'opening' });
    const dodge = { reply: 'أنا هون عشان أساعدك بكل اللي بتحتاجه. شو نوع منشأتك؟', action: 'NONE', stage: 'opening', next_step: 'question' };
    script(dodge, dodge);

    const { parts } = await turn(conv, 'إنت بني آدم ولا بوت؟');

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(userTurnOf(1)).toContain(validators.hintFor('identity', 'ar'));
    expect(bodyOf(parts[0])).toBe(validators.HONEST_IDENTITY.ar);
  });

  test('a capture ack is re-rendered by the batcher from the validated model line, never the raw one', async () => {
    const { conv } = seedShift({ current_state: 'close', workflow_data: { lead: { name: 'محمد', business_name: 'كافيه زيتون', version: 1 } } });
    script({ reply: '**تمام يا محمد**', action: 'CAPTURE_TIME', action_args: { time_text: 'بكرا الساعة 5' }, stage: 'close', next_step: 'confirmed' });

    const { parts } = await turn(conv, 'خلينا نحكي بكرا الساعة 5');

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const text = bodyOf(parts[0]);
    expect(text).not.toContain('**');
    expect(text.startsWith('تمام يا محمد\n\n')).toBe(true);
    expect(text).toContain('سجّلت طلب مكالمة: محمد، كافيه زيتون');
    expect(convRow(conv.id).current_state).toBe('captured');
  });

  test('the deadline is respected: no attempt B when fewer than 4 s remain', async () => {
    const { conv } = seedShift({ current_state: 'discovery' });
    const wrong = { reply: 'الاشتراك 25 دينار. شو نوع منشأتك؟', action: 'NONE', stage: 'discovery', next_step: 'question' };
    script(wrong, wrong);
    const batch = [seedInbound(conv, 'كم السعر؟')];

    const r = await processShiftBatch({ id: conv.business_id, ai_config: {} }, convRow(conv.id), batch, {
      now: new Date(), deadlineAt: Date.now() + 3000,
    });

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(r.messages[0].text).toBe(validators.stageFallback('discovery', 'ar'));
    expect(r.messages[0]).not.toHaveProperty('modelLine');
    expect(r.workflowDataPatch.validator_blocks).toEqual([{ at: expect.any(String), codes: ['digits'], attempt: 1 }]);
  });
});

// ─── Language, first reply, pre-fill ─────────────────────────────────────────

describe('first replies', () => {
  test('an Arabizi opener → an English reply is blocked, the Arabic regeneration goes out, lead.language = ar', async () => {
    const { conv } = seedShift();
    script(
      { reply: "Hi! I'm Karam, SHIFT's AI assistant. Who answers your messages at night?", action: 'NONE', stage: 'opening', next_step: 'question' },
      { reply: 'أهلًا وسهلًا، أنا كرم، مساعد شِفت الذكي. مين بيرد على رسائل الصالون بالليل حاليًا؟', action: 'NONE', stage: 'discovery', next_step: 'question', lead: { sector: 'other', sector_text: 'صالون' } },
    );

    const { parts } = await turn(conv, 'mar7aba, 3ndi salon 7ela2a b irbid, bdi bot yrod 3al zabayen bil lail');

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(userTurnOf(1)).toContain(validators.hintFor('language', 'ar'));
    expect(parts).toHaveLength(1);
    expect(bodyOf(parts[0])).toMatch(ARABIC);
    expect(bodyOf(parts[0])).not.toContain('Karam');
    expect(convRow(conv.id).workflow_data.lead.language).toBe('ar');
  });

  test('«مرحبا» from someone unknown → one list part with the four sectors', async () => {
    const { conv } = seedShift({ current_state: null });
    const intro = 'أهلًا وسهلًا 👋 أنا كرم، مساعد شِفت الذكي — shifts-ai.com. شو نوع شغلك؟';
    script({ reply: intro, action: 'NONE', stage: 'opening', next_step: 'buttons' });

    const { parts } = await turn(conv, 'مرحبا');

    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('interactive');
    expect(parts[0].interactive.type).toBe('list');
    expect(parts[0].interactive.body.text).toBe(intro);
    expect(parts[0].interactive.action.sections[0].rows.map((r) => r.id)).toEqual(['sector:clinic', 'sector:restaurant', 'sector:store', 'sector:other']);
    const out = db.store.messages.find((m) => m.direction === 'outbound');
    expect(out.raw_payload.part_type).toBe('list');
    expect(out.text_body).toContain('[اختر القطاع]: عيادة');
    const c = convRow(conv.id);
    expect(c.current_state).toBe('opening');
    expect(c.workflow_data.disclosed_at).toBeTruthy();
    expect(c.workflow_data.last_bot.next_step).toBe('buttons');
  });

  test('eval #1: the site pre-fill burst → slot buttons in the first reply and the lead shape of eval #1', async () => {
    const { conv } = seedShift({ current_state: null });
    script({
      reply: 'أهلًا وسهلًا، أنا كرم، مساعد شِفت الذكي (shifts-ai.com). كافيه زيتون بإربد مع كرم بوت ونقاط الولاء — أقرب أوقات الفريق:',
      action: 'NONE',
      buttons: OFFERS.map((o) => ({ id: o.id, title: o.title })),
      lead: { name: 'محمد', city: 'إربد', interest: 'hot' },
      stage: 'close',
      next_step: 'buttons',
    });

    const { parts } = await turn(conv, [PREFILL, 'بإربد', 'الاسم: محمد']);

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('interactive');
    const ids = parts[0].interactive.action.buttons.map((b) => b.reply.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^slot:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\+03:00\/\d{2}:\d{2}|other)$/);
    expect(bodyOf(parts[0])).not.toMatch(/40|180/);
    // The user turn carried the pre-fill objective and the three fragments.
    expect(userTurnOf(0)).toContain('بإربد');

    const c = convRow(conv.id);
    const lead = c.workflow_data.lead;
    expect(lead).toMatchObject({
      name: 'محمد', business_name: 'كافيه زيتون', sector: 'restaurant', city: 'إربد', interest: 'hot',
      source: { type: 'site', attribution: 'fb/karam-restaurants' },
    });
    expect(lead.products).toEqual(expect.arrayContaining(['karam', 'loyalty']));
    expect(lead._prov.sector.confirmed).toBe(true);
    expect((lead.customer_numbers || []).map(String)).not.toContain('180');
    expect(c.workflow_data.site_estimates.map((e) => e.value)).toEqual(['40', '180']);
    expect(c.workflow_data.prefill).toMatchObject({ kind: expect.any(String), lang: 'ar' });
    expect(c.current_state).toBe('close');
    expect(db.store.messages.filter((m) => m.direction === 'inbound').every((m) => m.status === 'answered')).toBe(true);
  });
});

// ─── The role-play sandbox ───────────────────────────────────────────────────

describe('role-play', () => {
  const FACTS = ['شاورما 3 دنانير', 'برجر 4', 'توصيل داخل إربد'];
  const active = (fields = {}) => ({
    current_state: 'roleplay',
    workflow_data: {
      roleplay: { active: true, sector: 'restaurant', business_name: 'مطعم الساحة', facts: FACTS, started_at: START.toISOString(), last_turn_at: START.toISOString(), turns: 1, setup_asks: 1, ...fields },
      lead: { business_name: 'مطعم الساحة', sector: 'restaurant', version: 1 },
    },
  });

  test('a claimed action inside the example passes (guard c is off; 10 comes from the arithmetic closure)', async () => {
    const { conv } = seedShift(active());
    const line = 'تمام، سجّلت الطلب: شاورما عدد 2 بـ3 دنانير وبرجر عدد 1 بـ4 — المجموع 10 دنانير حسب أسعارك. في إشي ثاني؟';
    script({ reply: line, action: 'NONE', next_step: 'question' });

    const { parts } = await turn(conv, 'بدي 2 شاورما و1 برجر');

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(bodyOf(parts[0])).toBe(line);
    expect(convRow(conv.id).workflow_data.roleplay.turns).toBe(2);
    expect(convRow(conv.id).workflow_data.validator_blocks).toBeUndefined();
  });

  test('the exit keyword → END with no AI call', async () => {
    const { conv } = seedShift(active());

    const { parts } = await turn(conv, 'خلص');

    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('text');
    expect(bodyOf(parts[0])).toBe(roleplay.endLine('restaurant', 'ar'));
    const c = convRow(conv.id);
    expect(c.current_state).toBe('close');
    expect(c.workflow_data.roleplay).toMatchObject({ active: false, end_reason: 'done' });
  });

  test('SHIFT_ROLEPLAY=0: «خلص» ends the example silently; any other message ends it and is answered', async () => {
    process.env.SHIFT_ROLEPLAY = '0';
    const silent = seedShift(active());
    const r1 = await turn(silent.conv, 'خلص');
    expect(r1.report.outcome).toBe('skipped_reply');
    expect(r1.parts).toHaveLength(0);
    expect(convRow(silent.conv.id)).toMatchObject({ current_state: 'close' });
    expect(convRow(silent.conv.id).workflow_data.roleplay).toMatchObject({ active: false, end_reason: 'disabled' });
    expect(db.store.messages.filter((m) => m.conversation_id === silent.conv.id && m.direction === 'inbound')[0].status).toBe('answered');

    const answered = seedShift(active());
    script({ reply: 'تمام، شو بتحب تعرف عن كرم؟', action: 'NONE', stage: 'close', next_step: 'question' });
    const r2 = await turn(answered.conv, 'في توصيل؟');
    expect(r2.parts).toHaveLength(1);
    const c = convRow(answered.conv.id);
    expect(c.current_state).toBe('close');
    expect(c.workflow_data.roleplay).toMatchObject({ active: false, end_reason: 'disabled' });
    expect(userTurnOf(0)).not.toContain('الدور ');
  });

  test('eval #5 end to end: setup tap → START → five turns → «خلص»; labels at both ends, no buttons, no order code loaded', async () => {
    const { conv } = seedShift({ current_state: 'fit', workflow_data: { lead: { sector: 'restaurant', version: 1 } } });
    const noButtons = (parts) => parts.every((p) => p.type === 'text');

    // 1. «جرّبه كزبون» → the fixed setup ask, no model.
    const t1 = await turn(conv, { tap: 'sample_roleplay:restaurant', title: 'جرّبه كزبون' });
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(bodyOf(t1.parts[0])).toBe(roleplay.setupAsk('restaurant', 'ar'));
    expect(convRow(conv.id).current_state).toBe('roleplay_setup');

    // 2. The facts → START_ROLEPLAY → the start line.
    script({ reply: 'يلا نبلش.', action: 'START_ROLEPLAY', action_args: { sector: 'restaurant', business_name: 'مطعم الساحة', facts: FACTS }, stage: 'roleplay_setup', next_step: 'confirmed' });
    const t2 = await turn(conv, 'مطعم الساحة، شاورما 3 دنانير، برجر 4، توصيل داخل إربد');
    expect(bodyOf(t2.parts[0]).startsWith(roleplay.startLine('مطعم الساحة', 'ar'))).toBe(true);
    expect(bodyOf(t2.parts[0])).toContain('مثال توضيحي');
    expect(convRow(conv.id).current_state).toBe('roleplay');

    // 3–6. In character.
    const lines = [
      ['في توصيل لحي التلول؟', { reply: 'التوصيل عندنا داخل إربد، والحي بالضبط بيأكده الموظف. شو بتحب تطلب؟' }],
      ['بدي 2 شاورما و1 برجر', { reply: 'تمام: شاورما عدد 2 بـ3 دنانير وبرجر عدد 1 بـ4 — المجموع 10 دنانير حسب أسعارك. في إشي ثاني؟' }],
      ['وبكم البطاطا؟', { reply: 'سعر البطاطا بيأكده الموظف. في إشي ثاني؟' }],
      ['أنا أبو أحمد، أكّد', { reply: 'تمام يا أبو أحمد، الطلب بيوصل للمطبخ للتأكيد.', lead: { name: 'أبو أحمد' } }],
    ];
    const inCharacter = [];
    for (const [text, model] of lines) {
      script({ action: 'NONE', next_step: 'question', ...model });
      const t = await turn(conv, text);
      expect(t.parts).toHaveLength(1);
      expect(bodyOf(t.parts[0])).toBe(model.reply);
      inCharacter.push(...t.parts);
    }
    expect(noButtons([...t1.parts, ...t2.parts, ...inCharacter])).toBe(true);

    // 7. «خلص» → the fixed end line, no model call.
    const calls = mockGenerateContent.mock.calls.length;
    const t7 = await turn(conv, 'خلص');
    expect(mockGenerateContent.mock.calls.length).toBe(calls);
    expect(bodyOf(t7.parts[0])).toBe(roleplay.endLine('restaurant', 'ar'));
    expect(bodyOf(t7.parts[0])).toContain('مثال توضيحي');
    expect(noButtons(t7.parts)).toBe(true);

    const c = convRow(conv.id);
    expect(c.current_state).toBe('close');
    expect(c.workflow_data.roleplay).toMatchObject({ active: false, end_reason: 'done', business_name: 'مطعم الساحة', facts: FACTS });
    expect(c.workflow_data.roleplay.turns).toBeLessThanOrEqual(roleplay.ROLEPLAY_MAX_TURNS);
    const lead = c.workflow_data.lead;
    expect(lead.name).toBeUndefined();
    expect(lead.business_name).toBe('مطعم الساحة');
    expect(lead._prov.business_name.source).toBe('roleplay_setup');
    expect(c.status).not.toBe('pending');

    // G6: the sandbox never loaded code that can create an order or an appointment.
    const loaded = Object.keys(require.cache);
    expect(loaded).toContain(path.resolve(__dirname, '../src/workflows/shift/index.js'));
    expect(loaded).toContain(path.resolve(__dirname, '../src/services/replyBatcher.js'));
    for (const key of loaded) {
      const exp = require.cache[key] && require.cache[key].exports;
      if (!exp || typeof exp !== 'object') continue;
      for (const name of roleplay.BLOCKED_IMPORTS) expect([key, Object.prototype.hasOwnProperty.call(exp, name)]).toEqual([key, false]);
    }
  });
});

// ─── Integration fixes (PR2 integration pass) ────────────────────────────────

/**
 * Round-2 review #1 — the clinic transcript of 2026-09-17 (docs/bot/sims/2026-09-17-clinic-*.md).
 * The customer answered the setup ask in full; the model still sent START_ROLEPLAY with
 * business_name: null and empty facts, twice, and the same ask went out again word for word.
 */
describe('review round 2: the example opens on the customer\'s own setup answer', () => {
  const SETUP = ['عيادة سمايل كير، خدماتنا تنظيف وتلميع، وحشوات تجميلية', 'الدوام من ١٠ الصبح ل ٨ المسا عدا الجمعة'];

  function seedSetup(setup_asks = 1) {
    const ask = roleplay.setupAsk('clinic', 'ar');
    return seedShift({
      current_state: 'roleplay_setup',
      workflow_data: {
        lead: { sector: 'clinic', sector_text: 'عيادة أسنان', version: 1 },
        roleplay: { active: false, sector: 'clinic', business_name: null, facts: [], setup_asks, last_setup_ask: ask },
        bot_turns: 4,
        disclosed_at: START.toISOString(),
      },
    });
  }

  test('START_ROLEPLAY with business_name null opens the sandbox on her words', async () => {
    const { conv } = seedSetup();
    script({
      reply: 'تمام دكتورة رنا.', action: 'START_ROLEPLAY', action_args: { sector: 'clinic', business_name: null, facts: [] },
      stage: 'roleplay_setup', next_step: 'confirmed',
    });

    const { parts } = await turn(conv, SETUP);

    expect(bodyOf(parts[0]).startsWith(roleplay.startLine('عيادة سمايل كير', 'ar'))).toBe(true);
    const c = convRow(conv.id);
    expect(c.current_state).toBe('roleplay');
    expect(c.workflow_data.roleplay).toMatchObject({ active: true, business_name: 'عيادة سمايل كير' });
    expect(c.workflow_data.roleplay.facts.length).toBeGreaterThan(0);
  });

  test('the identical setup ask is never sent twice', async () => {
    const { conv } = seedSetup();
    const ask = roleplay.setupAsk('clinic', 'ar');
    script({
      reply: 'شو اسم العيادة؟', action: 'START_ROLEPLAY', action_args: { sector: 'clinic', business_name: null, facts: [] },
      stage: 'roleplay_setup', next_step: 'question',
    });

    const { parts } = await turn(conv, ['ما بدي أكتب إشي، وريني بس']);

    expect(parts.map(bodyOf)).not.toContain(ask);
    expect(bodyOf(parts[0])).toBe(acks.roleplaySetupGaveUp('ar'));
    expect(convRow(conv.id).current_state).toBe('fit');
  });

  test('a name we already stored is enough once the asks are spent', async () => {
    const { conv } = seedShift({
      current_state: 'roleplay_setup',
      workflow_data: {
        lead: { sector: 'clinic', business_name: 'عيادة سمايل كير', version: 1 },
        roleplay: { active: false, sector: 'clinic', business_name: null, facts: [], setup_asks: 2 },
        bot_turns: 5,
        disclosed_at: START.toISOString(),
      },
    });
    script({
      reply: 'يلا.', action: 'START_ROLEPLAY', action_args: { sector: 'clinic', business_name: null, facts: [] },
      stage: 'roleplay_setup', next_step: 'confirmed',
    });

    const { parts } = await turn(conv, ['جربيني هلأ']);

    expect(bodyOf(parts[0]).startsWith(roleplay.startLine('عيادة سمايل كير', 'ar'))).toBe(true);
    expect(convRow(conv.id).workflow_data.roleplay).toMatchObject({ active: true, facts: [] });
  });
});

describe('integration fixes', () => {
  test('a tier-2 handoff whose model line invents a price → the fixed handoff line, ack and alert kept, one model call', async () => {
    const { conv } = seedShift({ current_state: 'discovery' });
    script({
      reply: 'بعتذر منك، وبنعطيك خصم 30% على أول شهر.', action: 'HANDOFF_TO_HUMAN',
      action_args: { reason: 'complaint', summary: 'زعلان' }, stage: 'discovery', next_step: 'confirmed',
    });

    const { parts } = await turn(conv, 'بعتلكم قبل أسبوع وما حدا رد!!');

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(parts).toHaveLength(1);
    const text = bodyOf(parts[0]);
    expect(text.startsWith(`${acks.handoffLead('ar')}\n\n`)).toBe(true);
    expect(text).not.toMatch(/30|خصم/);
    const c = convRow(conv.id);
    expect(c).toMatchObject({ status: 'pending', current_state: 'handoff', ai_enabled: true });
    expect(c.workflow_data.validator_blocks).toEqual([{ at: expect.any(String), codes: ['digits'], attempt: 2 }]);
  });

  test('«Can we speak tomorrow after 4?» → the time is stored and name + business asked, no slot buttons; the details → one ack', async () => {
    const { conv } = seedShift({ current_state: 'discovery', workflow_data: { lead: { sector: 'store', language: 'en', version: 1 }, bot_turns: 1, disclosed_at: START.toISOString() } });
    script({ reply: 'Sure, happy to set that up.', action: 'NONE', stage: 'close', next_step: 'confirmed', lead: { preferred_time: 'tomorrow after 4' } });

    const t1 = await turn(conv, 'Can we speak tomorrow after 4?');

    expect(t1.parts).toHaveLength(1);
    expect(t1.parts[0].type).toBe('text');
    expect(bodyOf(t1.parts[0])).toBe(acks.captureAsk({ nameKnown: false, businessKnown: false, sector: 'store', lang: 'en' }));
    let c = convRow(conv.id);
    expect(c.status).toBe('open');
    expect(c.workflow_data.capture_pending).toMatchObject({ time_text: 'tomorrow after 4' });
    expect(c.workflow_data.lead.preferred_time).toMatchObject({ text: 'tomorrow after 4' });

    script({ reply: 'Thanks, Sam.', action: 'CAPTURE_TIME', action_args: { time_text: 'tomorrow after 4' }, stage: 'close', next_step: 'confirmed', lead: { name: 'Sam', business_name: 'Noor Boutique' } });
    const t2 = await turn(conv, 'Sam, Noor Boutique');

    expect(t2.parts).toHaveLength(1);
    const text = bodyOf(t2.parts[0]);
    expect(text.split('Call request noted').length - 1).toBe(1);
    expect(text).toContain('Sam, Noor Boutique');
    c = convRow(conv.id);
    expect(c).toMatchObject({ status: 'pending', current_state: 'captured' });
    expect(c.workflow_data.needs_team.reason).toBe('meeting');
  });

  test('«ما بدي مكالمة» is a decline: the quote is flagged and no slot buttons are pushed after it', async () => {
    const { conv } = seedShift({ current_state: 'close', workflow_data: { lead: { sector: 'restaurant', business_name: 'مطعم الساحة', version: 1 }, bot_turns: 5, disclosed_at: START.toISOString() } });
    script({ reply: 'طيب بدون مكالمة: بطلبلك عرض مكتوب من الفريق.', action: 'FLAG_FOR_TEAM', action_args: { reason: 'quote', summary: 'بدو عرض مكتوب' }, stage: 'close', next_step: 'confirmed' });

    const { parts } = await turn(conv, 'ما بدي مكالمة');

    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('text');
    expect(bodyOf(parts[0])).not.toContain(acks.slotsBody('ar'));
    const c = convRow(conv.id);
    expect(c.workflow_data.needs_team.reason).toBe('quote');
    expect(c.workflow_data.close_declines).toBe(1);
  });

  test('role-play: «أكّد» may repeat the total of an order written two turns earlier (closure over the whole example)', async () => {
    const FACTS = ['شاورما 3 دنانير', 'برجر 4'];
    const { conv } = seedShift({
      current_state: 'roleplay',
      workflow_data: {
        // Started a minute before the first order row is written.
        roleplay: { active: true, sector: 'restaurant', business_name: 'مطعم الساحة', facts: FACTS, started_at: new Date(START.getTime() - 60000).toISOString(), last_turn_at: START.toISOString(), turns: 1, setup_asks: 1 },
        lead: { business_name: 'مطعم الساحة', sector: 'restaurant', version: 1 },
      },
    });
    script({ reply: 'شاورما عدد 2 وبرجر عدد 1 — المجموع 10 دنانير حسب أسعارك. في إشي ثاني؟', action: 'NONE', next_step: 'question' });
    await turn(conv, 'بدي 2 شاورما و1 برجر');
    script({ reply: 'سعر البطاطا بيأكده الموظف. في إشي ثاني؟', action: 'NONE', next_step: 'question' });
    await turn(conv, 'وبكم البطاطا؟');

    const line = 'تمام يا أبو أحمد: المجموع 10 دنانير حسب أسعارك، والطلب بيوصل للمطبخ للتأكيد.';
    script({ reply: line, action: 'NONE', next_step: 'confirmed' });
    const { parts } = await turn(conv, 'أنا أبو أحمد، أكّد');

    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    expect(bodyOf(parts[0])).toBe(line);
    expect(convRow(conv.id).workflow_data.validator_blocks).toBeUndefined();
  });

  test('«جرّبني» → the model proposes the setup and the server appends the fixed setup ask (one question)', async () => {
    const { conv } = seedShift({ current_state: 'fit', workflow_data: { lead: { sector: 'restaurant', version: 1 }, bot_turns: 3, disclosed_at: START.toISOString() } });
    script({ reply: 'أكيد، خلّيني أصير كرم تبع مطعمك. شو اسم المطعم؟', action: 'NONE', stage: 'roleplay_setup', next_step: 'question' });

    const { parts } = await turn(conv, 'جرّبني');

    expect(parts).toHaveLength(1);
    expect(bodyOf(parts[0])).toBe(`أكيد، خلّيني أصير كرم تبع مطعمك.\n\n${roleplay.setupAsk('restaurant', 'ar')}`);
    const c = convRow(conv.id);
    expect(c.current_state).toBe('roleplay_setup');
    expect(c.workflow_data.roleplay).toMatchObject({ active: false, sector: 'restaurant', setup_asks: 1 });
  });
});

// ─── Review round 1 ──────────────────────────────────────────────────────────

describe('review round 1: the regenerated attempt and the role-play debrief are checked too', () => {
  test('r1-9: digits on attempt A, then a HANDOFF_TO_HUMAN whose line has a price → the fixed handoff line; both blocks logged', async () => {
    const { conv } = seedShift({ current_state: 'fit' });
    script(
      { reply: 'باقتنا 50 دينار بالشهر.', action: 'NONE', stage: 'fit', next_step: 'question' },
      { reply: 'الاشتراك 50 دينار بالشهر، وبحوّلك للفريق.', action: 'HANDOFF_TO_HUMAN', action_args: { reason: 'quote', summary: 'بدو سعر' }, stage: 'fit', next_step: 'confirmed' },
    );

    const { parts } = await turn(conv, 'كم السعر؟');

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    const all = parts.map(bodyOf).join('\n');
    expect(all).not.toMatch(/50|دينار/);
    expect(all.startsWith(`${acks.handoffLead('ar')}\n\n`)).toBe(true);
    const c = convRow(conv.id);
    expect(c.current_state).toBe('handoff');
    // Attempt A's entry is merged with the handoff check's, not overwritten by it.
    expect(c.workflow_data.validator_blocks).toEqual([
      { at: expect.any(String), codes: ['digits'], attempt: 1 },
      { at: expect.any(String), codes: ['digits'], attempt: 2 },
    ]);
  });

  test('r1-0: identity blocked on attempt A, then a handoff line denying being a bot with a staff name → the honest identity line', async () => {
    const { conv } = seedShift({ current_state: 'discovery' });
    script(
      { reply: 'أهلين! كيف بقدر أساعدك؟', action: 'NONE', stage: 'discovery', next_step: 'question' },
      { reply: 'لا مش بوت، معك سامر من الفريق وبتابع معك هلأ.', action: 'HANDOFF_TO_HUMAN', action_args: { reason: 'complaint', summary: 'زعلان' }, stage: 'discovery', next_step: 'confirmed' },
    );

    const { parts } = await turn(conv, 'انت بوت؟ صرلي ساعة بستنى ومحدا بيرد، شي بيقهر');

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    const text = parts.map(bodyOf).join('\n');
    expect(text).not.toContain('مش بوت');
    expect(text).not.toContain('سامر');
    expect(text).toContain(validators.HONEST_IDENTITY.ar);
    expect(convRow(conv.id).current_state).toBe('handoff');
  });

  test('r1-1: an END_ROLEPLAY debrief claiming a booked call is checked out of character → the fixed end line alone', async () => {
    const FACTS = ['شاورما 3 دنانير', 'برجر 4', 'توصيل داخل إربد'];
    const { conv } = seedShift({
      current_state: 'roleplay',
      workflow_data: {
        roleplay: { active: true, sector: 'restaurant', business_name: 'مطعم الساحة', facts: FACTS, started_at: START.toISOString(), last_turn_at: START.toISOString(), turns: 1, setup_asks: 1 },
        lead: { business_name: 'مطعم الساحة', sector: 'restaurant', version: 1 },
      },
    });
    const line = 'كان مثال توضيحي. سجّلتلك مكالمة مع الفريق بكرا الساعة 11.';
    script(
      { reply: line, action: 'END_ROLEPLAY', action_args: {}, next_step: 'question' },
      { reply: line, action: 'END_ROLEPLAY', action_args: {}, next_step: 'question' },
    );

    const { parts } = await turn(conv, 'طيب خلصنا المثال، رتبلي مكالمة');

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(parts.map(bodyOf)).toEqual([roleplay.endLine('restaurant', 'ar')]);
    const c = convRow(conv.id);
    expect(c.current_state).toBe('close');
    expect(c.workflow_data.roleplay).toMatchObject({ active: false, end_reason: 'done' });
    expect(c.workflow_data.validator_blocks.map((b) => b.codes)).toEqual([['claimed_action'], ['claimed_action']]);
  });

  test('minor: a blocked line before the fixed setup ask falls back to the setup ask once, not twice', async () => {
    const { conv } = seedShift({ current_state: 'fit', workflow_data: { lead: { sector: 'restaurant', version: 1 }, bot_turns: 3, disclosed_at: START.toISOString() } });
    const reply = { reply: 'تمام، الباقة بـ50 دينار بالشهر.', action: 'SEND_SAMPLE', action_args: { sector: 'restaurant' }, stage: 'sample', next_step: 'question' };
    script(reply, reply);

    const { parts } = await turn(conv, 'ابعتلي مثال');

    const ask = roleplay.setupAsk('restaurant', 'ar');
    expect(parts.map(bodyOf)).toEqual([ask]);
    expect(convRow(conv.id).current_state).toBe('roleplay_setup');
  });

  test('r1-7: the role-play start line failed to send → the rerun\'s first in-character reply carries it', async () => {
    const FACTS = ['شاورما 3 دنانير', 'برجر 4'];
    const { conv } = seedShift({ current_state: 'roleplay_setup', workflow_data: { lead: { sector: 'restaurant', version: 1 }, roleplay: { active: false, sector: 'restaurant', setup_asks: 1 }, bot_turns: 4 } });
    const start = roleplay.startLine('مطعم الساحة', 'ar');
    let out = 0;
    let failStart = true;
    axios.post.mockImplementation(async (url, payload) => {
      if (failStart && payload && payload.type === 'text' && payload.text.body.startsWith(start)) {
        const err = new Error('rate limited');
        err.response = { status: 400, data: { error: { code: 130429 } } };
        throw err;
      }
      out += 1;
      return { status: 200, data: { messages: [{ id: `wamid.rp${out}` }] } };
    });
    script({ reply: 'يلا نبلش.', action: 'START_ROLEPLAY', action_args: { sector: 'restaurant', business_name: 'مطعم الساحة', facts: FACTS }, stage: 'roleplay_setup', next_step: 'confirmed' });

    const t1 = await turn(conv, 'مطعم الساحة، شاورما 3 دنانير، برجر 4');
    expect(t1.report.outcome).toBe('failed');
    expect(convRow(conv.id).workflow_data.roleplay.active).toBe(true);

    failStart = false;
    script({ reply: 'أهلًا بمطعم الساحة، شو بتحب تطلب؟', action: 'NONE', next_step: 'question' });
    jest.setSystemTime(new Date(Date.now() + 1000));
    const before = sends().length;
    await batcher.runBatch(conv.id);
    const body = sends().slice(before).map(bodyOf).join('\n');

    expect(body.startsWith(start)).toBe(true);
    expect(body).toContain('أهلًا بمطعم الساحة، شو بتحب تطلب؟');
    const rp = convRow(conv.id).workflow_data.roleplay;
    expect(rp).toMatchObject({ active: true, turns: 1 });
    expect(rp).not.toHaveProperty('start_undelivered');
  });

  test('minor: SHIFT_MEDIA=1, a transcribed voice note beside an unread sticker still goes to the model', async () => {
    process.env.SHIFT_MEDIA = '1';
    const { conv } = seedShift({ current_state: 'discovery', workflow_data: { lead: { sector: 'restaurant', version: 1 }, bot_turns: 2, disclosed_at: START.toISOString() } });
    seedInbound(conv, null, { message_type: 'audio', raw_payload: { shift_media: { status: 'ok', kind: 'audio', text: 'كم بياخد التركيب؟' } } });
    seedInbound(conv, null, { message_type: 'sticker' });
    script({ reply: 'التركيب بيتحدد مع الفريق حسب شغلك. بتحب أوريك مثال؟', action: 'NONE', stage: 'discovery', next_step: 'question' });

    jest.setSystemTime(new Date(Date.now() + 1000));
    await batcher.runBatch(conv.id);

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const text = sends().map(bodyOf).join('\n');
    expect(text).toContain('التركيب بيتحدد مع الفريق');
  });
});

describe('review round 2 (pipeline)', () => {
  test('r2 #0/#10: after a silent idle end an in-character booking is no call request, and the reply says the example ended', async () => {
    const endedAt = new Date(START.getTime() - 60 * 1000);
    const { conv } = seedShift({
      current_state: 'close',
      workflow_data: {
        lead: { business_name: 'عيادة النور', sector: 'clinic', version: 1 },
        bot_turns: 4,
        disclosed_at: START.toISOString(),
        roleplay: {
          active: false, sector: 'clinic', business_name: 'عيادة النور', facts: ['كشفية 20 دينار'],
          started_at: new Date(START.getTime() - 30 * 60 * 1000).toISOString(), last_turn_at: new Date(START.getTime() - 16 * 60 * 1000).toISOString(),
          turns: 2, setup_asks: 1, ended_at: endedAt.toISOString(), end_reason: 'idle',
        },
      },
    });
    script({ reply: 'بتحب نكمّل المثال ولا نحكي مع الفريق؟', action: 'NONE', stage: 'close', next_step: 'question', lead: { name: 'أبو أحمد', preferred_time: 'بكرا الساعة 5' } });

    const { parts } = await turn(conv, 'اسمي أبو أحمد، بدي احجز موعد بكرا الساعة 5');

    expect(userTurnOf(0)).toContain('# المثال التوضيحي انتهى (من النظام)');
    expect(parts).toHaveLength(1);
    expect(bodyOf(parts[0]).startsWith(roleplay.endNote('clinic', 'ar'))).toBe(true);
    const c = convRow(conv.id);
    expect(c.status).toBe('open');
    expect(c.current_state).not.toBe('captured');
    expect(c.workflow_data.lead.name).toBeUndefined();
    expect(c.workflow_data.lead.preferred_time).toBeUndefined();
    expect(c.workflow_data.roleplay.end_announced_at).toBeTruthy();
    expect(alerts.sendStaffAlert).not.toHaveBeenCalled();
  });

  test('minor: the follow-up consent buttons built for the stage the reply moves to survive the validators', async () => {
    const { conv } = seedShift({
      current_state: 'objection',
      workflow_data: { lead: { name: 'محمد', business_name: 'كافيه زيتون', sector: 'restaurant', version: 1 }, close_declines: 2, bot_turns: 6, disclosed_at: START.toISOString() },
    });
    script({
      reply: acks.consentAsk('ar'), action: 'NONE', stage: 'close', next_step: 'buttons',
      buttons: acks.consentButtons('ar').map((b) => ({ id: b.id, title: b.title })),
    });

    const { parts } = await turn(conv, 'لا ما بدي مكالمة');

    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('interactive');
    expect(parts[0].interactive.action.buttons.map((b) => b.reply.id)).toEqual(['followup_yes', 'followup_no']);
  });

  test('minor: a re-run of the first reply to a site message keeps its pre-fill (run 1 stored state, its send failed)', async () => {
    const { conv } = seedShift({ current_state: 'close' });
    const first = seedInbound(conv, PREFILL);
    db.store.conversations.find((c) => c.id === conv.id).workflow_data = {
      prefill: { kind: 'call', lang: 'ar', truncated: false, at: START.toISOString(), msg_id: first.id },
      bot_turns: 1,
      last_bot: { stage: 'close', next_step: 'buttons', at: START.toISOString(), action: 'NONE' },
      lead: { sector: 'restaurant', version: 1 },
    };
    db.seed({
      messages: [{
        business_id: conv.business_id, conversation_id: conv.id, direction: 'outbound', status: 'failed', is_ai_generated: true,
        message_type: 'text', text_body: 'أهلًا وسهلًا', created_at: new Date(START.getTime() + 500), raw_payload: { kind: 'reply', batch_ids: [first.id] },
      }],
    });
    script({ reply: 'أهلًا وسهلًا، أنا كرم، مساعد شِفت الذكي (shifts-ai.com). أقرب أوقات الفريق:', action: 'NONE', stage: 'close', next_step: 'buttons', buttons: OFFERS.map((o) => ({ id: o.id, title: o.title })) });

    const conversation = db.store.conversations.find((c) => c.id === conv.id);
    const r = await processShiftBatch(conversation.business_id ? db.store.businesses[0] : null, conversation, [first], { now: START });

    expect(userTurnOf(0)).toContain('أقرب أوقات الفريق:');
    expect(r.workflowDataPatch.site_estimates.map((e) => e.value)).toEqual(['40', '180']);
    expect(r.leadPatch).toMatchObject({ business_name: 'كافيه زيتون', source: { type: 'site' } });
  });
});

