/**
 * shiftCaptureHonesty.test.js — a call time is only recorded when the customer chose it.
 *
 * Owner phone test on the PR1 bot (2026-09-15): after «صح عليكم طيب يلا» (agreeing to a call, no time) the
 * model returned CAPTURE_TIME with a slot title as time_text, and the server sent the model's «اختار الوقت
 * المناسب إلك… أقرب أوقات الفريق:» followed by «سجّلت طلب مكالمة: بيكابو، بكرا 10–12 بتوقيت عمّان» — a time the
 * customer never chose, and no slot buttons. A preferred time may only be stored or acked when the customer
 * tapped a slot, or when the customer's own text in the batch carries an explicit day/time the server sees.
 */
require('./setup');

// Pure: the mock only keeps lead.js from building a real PrismaClient.
jest.mock('../src/config/prisma', () => ({}));

const { toWorkflowResult, renderCaptureAck, customerCallTime } = require('../src/workflows/shift/results');
const acks = require('../src/workflows/shift/acks');
const hours = require('../src/workflows/shift/hours');
const buttons = require('../src/workflows/shift/buttons');
const { mergeLead } = require('../src/workflows/shift/lead');

const MON_11 = new Date('2026-09-14T11:00:00+03:00');
const OFFERS_AR = buttons.slotOffers(hours.DEFAULT_TEAM_HOURS, MON_11, 'ar');
const OFFERS_EN = buttons.slotOffers(hours.DEFAULT_TEAM_HOURS, MON_11, 'en');
const business = { id: 'b1', ai_config: {} };

const AR_LINE = 'ممتاز جداً! عشان ننسّق المكالمة، اختار الوقت المناسب إلك أو احكيلي متى بفرغ وقتك. أقرب أوقات الفريق:';
const EN_LINE = "Great! To arrange the call, pick a time that suits you or tell me when you're free. The team's nearest times:";

function ctx({ wd = {}, stage = 'close', status = 'open', texts, lang = 'ar', offers, ...rest } = {}) {
  return {
    business,
    conversation: { id: 'c1', status, current_state: stage, workflow_data: wd },
    batchMessages: texts.map((t, i) => ({ id: `m${i + 1}`, message_type: 'text', text_body: t })),
    now: MON_11,
    lang,
    offers: offers || (lang === 'en' ? OFFERS_EN : OFFERS_AR),
    ...rest,
  };
}

const wdAr = () => ({ lead: { business_name: 'بيكابو', sector: 'other', version: 2 }, bot_turns: 4, disclosed_at: MON_11.toISOString() });
const wdEn = () => ({ lead: { business_name: 'Peekaboo', sector: 'other', language: 'en', version: 2 }, bot_turns: 4, disclosed_at: MON_11.toISOString() });

/** Nothing about a call time was stored, acked or raised. */
function expectNothingRecorded(r, lead) {
  expect(r.action).not.toBe('CAPTURE_TIME');
  expect(r.capture).toBeFalsy();
  expect(r.alert).toBeNull();
  expect(r.needsTeam).toBeFalsy();
  expect(r.workflowDataPatch.needs_team).toBeUndefined();
  expect(r.stateUpdate.current_state).not.toBe('captured');
  expect(r.stateUpdate.status).toBeUndefined();
  expect(r.workflowDataPatch.capture_pending == null || r.workflowDataPatch.capture_pending.time_text == null).toBe(true);
  expect(r.leadPatch && r.leadPatch.preferred_time).toBeFalsy();
  const saved = mergeLead(lead, r.leadPatch || {}, r.leadMeta || { source: 'model', inboundText: '' }).lead;
  expect(saved.preferred_time).toBeUndefined();
  for (const p of r.messages) {
    expect(p.text).not.toContain('سجّلت طلب مكالمة');
    expect(p.text).not.toMatch(/noted a call request|call request noted/i);
  }
}

function expectSlotButtons(r, offers) {
  expect(r.messages).toHaveLength(1);
  const [part] = r.messages;
  expect(part.type).toBe('interactive');
  expect(part.buttons.map((b) => b.id)).toEqual(offers.slice(0, 3).map((o) => o.id));
  expect(r.workflowDataPatch.slot_offers.map((o) => o.id)).toEqual(offers.slice(0, 3).map((o) => o.id));
  return part;
}

describe('owner phone test: agreeing to a call without naming a time', () => {
  test('AR: CAPTURE_TIME with a slot title as time_text → slot buttons, nothing stored, no capture ack', () => {
    const wd = wdAr();
    const r = toWorkflowResult(
      {
        reply: AR_LINE, action: 'CAPTURE_TIME', action_args: { time_text: 'بكرا 10–12 بتوقيت عمّان' }, stage: 'close',
        next_step: 'buttons', lead: { preferred_time: 'بكرا 10–12' }, buttons: [],
      },
      ctx({ wd, texts: ['صح عليكم طيب يلا'] }),
    );
    expectNothingRecorded(r, wd.lead);
    const part = expectSlotButtons(r, OFFERS_AR);
    expect(part.text.endsWith(acks.slotsBody('ar'))).toBe(true);
    expect(part.text.startsWith('ممتاز جداً!')).toBe(true);
    // The model's line is still the model's words for the validators; the body line is the server's.
    expect(part.modelLine).toBeTruthy();
    expect(part.ack).toBe(acks.slotsBody('ar'));
    expect(r.stateUpdate.current_state).toBe('close');
  });

  test('EN: the same agreement in English → slot buttons, nothing stored, no capture ack', () => {
    const wd = wdEn();
    const r = toWorkflowResult(
      {
        reply: EN_LINE, action: 'CAPTURE_TIME', action_args: { time_text: 'tomorrow 10–12' }, stage: 'close',
        next_step: 'buttons', lead: { preferred_time: 'tomorrow 10–12' },
      },
      ctx({ wd, texts: ["Sounds good, let's do it"], lang: 'en' }),
    );
    expectNothingRecorded(r, wd.lead);
    const part = expectSlotButtons(r, OFFERS_EN);
    expect(part.text.endsWith(acks.slotsBody('en'))).toBe(true);
    expect(part.text).not.toMatch(/[ء-ي]/);
  });

  test('no slot offers (outside team hours) → «أي يوم ووقت بناسبك؟», nothing stored', () => {
    const wd = wdAr();
    const r = toWorkflowResult(
      { reply: AR_LINE, action: 'CAPTURE_TIME', action_args: { time_text: 'بكرا 10–12' }, stage: 'close' },
      ctx({ wd, texts: ['صح عليكم طيب يلا'], offers: [] }),
    );
    expectNothingRecorded(r, wd.lead);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].type).toBe('text');
    expect(r.messages[0].text.endsWith('أي يوم ووقت بناسبك؟')).toBe(true);
    expect(r.messages[0].text).not.toContain('أقرب أوقات الفريق');
    expect(r.messages[0].text).not.toContain('اختار الوقت');
    expect(acks.callTimeAsk('ar')).toBe('أي يوم ووقت بناسبك؟');

    const en = toWorkflowResult(
      { reply: EN_LINE, action: 'CAPTURE_TIME', action_args: { time_text: 'tomorrow 10–12' } },
      ctx({ wd: wdEn(), texts: ["Sounds good, let's do it"], lang: 'en', offers: [] }),
    );
    expectNothingRecorded(en, wdEn().lead);
    expect(en.messages[0].text.endsWith(acks.callTimeAsk('en'))).toBe(true);
  });

  test('the model writing only lead.preferred_time (NONE) is not upgraded to a capture', () => {
    const wd = wdAr();
    const r = toWorkflowResult(
      { reply: 'ممتاز! أقرب أوقات الفريق:', action: 'NONE', stage: 'close', next_step: 'buttons', lead: { preferred_time: 'بكرا 10–12' } },
      ctx({ wd, texts: ['صح عليكم طيب يلا'] }),
    );
    expectNothingRecorded(r, wd.lead);
  });

  test('a meeting flag with an invented time_text is not a capture', () => {
    const wd = wdAr();
    const r = toWorkflowResult(
      { reply: 'تمام، بنرتّب مكالمة.', action: 'FLAG_FOR_TEAM', action_args: { reason: 'meeting', time_text: 'بكرا 10–12', summary: 'مكالمة' }, stage: 'close' },
      ctx({ wd, texts: ['صح عليكم طيب يلا'] }),
    );
    expect(r.action).not.toBe('CAPTURE_TIME');
    expect(r.capture).toBeFalsy();
    expect(r.leadPatch && r.leadPatch.preferred_time).toBeFalsy();
    for (const p of r.messages) expect(p.text).not.toContain('سجّلت طلب مكالمة');
  });

  test('after «وقت ثاني» a model time the customer never wrote is not captured', () => {
    const wd = { ...wdAr(), capture_pending: { slot_id: 'other', time_text: null, at: MON_11.toISOString() } };
    const r = toWorkflowResult(
      { reply: 'تمام.', action: 'NONE', stage: 'close', lead: { preferred_time: 'بكرا 10–12' } },
      ctx({ wd, texts: ['أي وقت بناسبكم'] }),
    );
    expectNothingRecorded(r, wd.lead);
  });

  test('a pending time_text the customer never wrote (a PR1 row) is not acked', () => {
    const wd = { ...wdAr(), lead: { ...wdAr().lead, name: 'سامي' }, capture_pending: { slot_id: null, time_text: 'بكرا 10–12', at: MON_11.toISOString() } };
    const r = toWorkflowResult(
      { reply: 'تمام يا سامي.', action: 'NONE', stage: 'close' },
      ctx({ wd, texts: ['سامي'], customerHistoryTexts: ['صح عليكم طيب يلا'] }),
    );
    expect(r.capture).toBeFalsy();
    for (const p of r.messages) expect(p.text).not.toContain('سجّلت طلب مكالمة');
    // The same pending time the customer did write earlier is still confirmed.
    const ok = toWorkflowResult(
      { reply: 'تمام يا سامي.', action: 'NONE', stage: 'close' },
      ctx({ wd, texts: ['سامي'], customerHistoryTexts: ['بكرا 10–12 بناسبني'] }),
    );
    expect(ok.action).toBe('CAPTURE_TIME');
    expect(ok.messages[0].text).toContain('سجّلت طلب مكالمة: سامي، بيكابو، بكرا 10–12');
  });
});

describe('a time the customer did write', () => {
  test('AR: «طيب بكرا الساعة 5» → captured with the customer\'s time, never the model\'s slot title', () => {
    const wd = wdAr();
    const r = toWorkflowResult(
      { reply: 'تمام.', action: 'CAPTURE_TIME', action_args: { time_text: 'بكرا 10–12' }, stage: 'close' },
      ctx({ wd, texts: ['طيب بكرا الساعة 5'] }),
    );
    expect(r.action).toBe('CAPTURE_TIME');
    expect(r.capture.when).toBe('بكرا الساعة 5');
    expect(r.messages[0].text).toContain('سجّلت طلب مكالمة: بيكابو، بكرا الساعة 5');
    expect(r.messages[0].text).not.toContain('10–12');
  });

  test('EN: «tomorrow at 5pm works» → captured', () => {
    const r = toWorkflowResult(
      { reply: 'Great.', action: 'CAPTURE_TIME', action_args: { time_text: 'tomorrow at 5pm' }, stage: 'close' },
      ctx({ wd: wdEn(), texts: ['tomorrow at 5pm works'], lang: 'en' }),
    );
    expect(r.action).toBe('CAPTURE_TIME');
    expect(r.capture.when).toBe('tomorrow at 5pm');
  });

  test('the capture ack never follows a line that asks the customer to choose', () => {
    const wd = wdAr();
    const r = toWorkflowResult(
      { reply: AR_LINE, action: 'CAPTURE_TIME', action_args: { time_text: 'بكرا الساعة 5' }, stage: 'close' },
      ctx({ wd, texts: ['بكرا الساعة 5'] }),
    );
    expect(r.action).toBe('CAPTURE_TIME');
    const text = r.messages[0].text;
    expect(text).toContain('سجّلت طلب مكالمة');
    expect(text).not.toMatch(/اختار|أقرب أوقات الفريق|متى بفرغ/);
    // The batcher's re-render from the stored lead says the same.
    const rendered = renderCaptureAck(r.capture, { business_name: 'بيكابو', preferred_time: { text: 'بكرا الساعة 5' } });
    expect(rendered.messages[0].text).not.toMatch(/اختار|أقرب أوقات الفريق/);

    const en = renderCaptureAck(
      { requested: { text: 'tomorrow at 5pm' }, when: 'tomorrow at 5pm', lang: 'en', modelLine: EN_LINE, at: MON_11.toISOString() },
      { business_name: 'Peekaboo', preferred_time: { text: 'tomorrow at 5pm' } },
    );
    expect(en.messages[0].text).not.toMatch(/pick a time|nearest times/i);
    expect(en.messages[0].text).toContain('tomorrow at 5pm');
  });
});

describe('customerCallTime', () => {
  const c = (texts) => ({ batchMessages: texts.map((t) => ({ message_type: 'text', text_body: t })) });
  test.each([
    ['صح عليكم طيب يلا', 'بكرا 10–12', null],
    ["Sounds good, let's do it", 'tomorrow 10–12', null],
    ['عندي 3 فروع وبدي مكالمة', '3', null],
    ['طيب بكرا', 'بكرا 10–12', 'بكرا'],
    ['الخميس الساعة 5 بناسبني', 'الخميس الساعة 5', 'الخميس الساعة 5'],
    ['Can we speak tomorrow after 4?', 'tomorrow after 4', 'tomorrow after 4'],
    ['مش اليوم', 'بكرا', null],
  ])('%s + model %s → %s', (text, model, expected) => {
    expect(customerCallTime(c([text]), [model])).toBe(expected);
  });
});
