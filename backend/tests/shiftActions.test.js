/**
 * PR2 contract §2: the action vocabulary, the V1/V2 switch and the server-side argument discrimination.
 */

const actions = require('../src/workflows/shift/actions');

const {
  SHIFT_ACTIONS_V1, SHIFT_ACTIONS, STAGES, MODEL_STAGES_V1, MODEL_STAGES, NEXT_STEPS, SAMPLE_SECTORS,
  CORRECTION_PROMPT_V1, CORRECTION_PROMPT, RESPONSE_SCHEMA_V1, RESPONSE_SCHEMA, actionSetFor, normalizeActionArgs,
} = actions;

describe('enums', () => {
  test('V1 keeps the six PR1 actions and stages', () => {
    expect(SHIFT_ACTIONS_V1).toEqual(['NONE', 'FLAG_FOR_TEAM', 'HANDOFF_TO_HUMAN', 'CAPTURE_TIME', 'NOT_NOW', 'OPT_OUT']);
    expect(MODEL_STAGES_V1).toEqual(['opening', 'discovery', 'fit', 'objection', 'close', 'closed']);
  });

  test('PR2 lists follow prompt doc §1', () => {
    expect(SHIFT_ACTIONS).toEqual(['NONE', 'SEND_SAMPLE', 'START_ROLEPLAY', 'END_ROLEPLAY', 'FLAG_FOR_TEAM',
      'HANDOFF_TO_HUMAN', 'CAPTURE_TIME', 'NOT_NOW', 'OPT_OUT']);
    expect(MODEL_STAGES).toEqual(['opening', 'discovery', 'fit', 'sample', 'roleplay_setup', 'objection', 'close', 'closed']);
    expect(NEXT_STEPS).toEqual(['question', 'buttons', 'confirmed', 'terminal']);
    expect(SAMPLE_SECTORS).toEqual(['clinic', 'restaurant', 'store', 'other']);
  });

  test('the model can never propose roleplay, captured or handoff; every model stage is a stored stage', () => {
    for (const s of ['roleplay', 'captured', 'handoff']) {
      expect(MODEL_STAGES).not.toContain(s);
      expect(STAGES).toContain(s);
    }
    for (const s of MODEL_STAGES) expect(STAGES).toContain(s);
  });

  test('schemas: flat, enums wired, PR2 requires stage and next_step', () => {
    expect(RESPONSE_SCHEMA.properties.action.enum).toEqual(SHIFT_ACTIONS);
    expect(RESPONSE_SCHEMA.properties.stage.enum).toEqual(MODEL_STAGES);
    expect(RESPONSE_SCHEMA.properties.next_step.enum).toEqual(NEXT_STEPS);
    expect(RESPONSE_SCHEMA.required).toEqual(['reply', 'action', 'stage', 'next_step']);
    expect(Object.keys(RESPONSE_SCHEMA.properties.action_args.properties))
      .toEqual(['sector', 'business_name', 'facts', 'reason', 'summary', 'time_text']);
    expect(RESPONSE_SCHEMA.properties.action_args.properties.facts).toEqual({ type: 'array', nullable: true, items: { type: 'string' } });
    expect(JSON.stringify(RESPONSE_SCHEMA)).not.toMatch(/oneOf|anyOf/);

    expect(RESPONSE_SCHEMA_V1.properties.action.enum).toEqual(SHIFT_ACTIONS_V1);
    expect(RESPONSE_SCHEMA_V1.properties.stage.enum).toEqual(MODEL_STAGES_V1);
    expect(RESPONSE_SCHEMA_V1.required).toEqual(['reply', 'action']);
    expect(Object.keys(RESPONSE_SCHEMA_V1.properties.action_args.properties)).toEqual(['reason', 'summary', 'time_text']);
    expect(RESPONSE_SCHEMA_V1.properties.lead).toEqual(RESPONSE_SCHEMA.properties.lead);
  });

  test('CORRECTION_PROMPT is the §2.4 text', () => {
    expect(CORRECTION_PROMPT).toBe(`يجب أن يكون ردك JSON فقط بهذا الشكل بالضبط، بدون أي نص إضافي:
{"reply":"نص الرد","action":"NONE","action_args":{},"buttons":[],"lead":{},"stage":"discovery","next_step":"question"}
action واحد من: NONE, SEND_SAMPLE, START_ROLEPLAY, END_ROLEPLAY, FLAG_FOR_TEAM, HANDOFF_TO_HUMAN, CAPTURE_TIME, NOT_NOW, OPT_OUT
stage واحد من: opening, discovery, fit, sample, roleplay_setup, objection, close, closed
next_step واحد من: question, buttons, confirmed, terminal
أعد المحاولة الآن.`);
    expect(CORRECTION_PROMPT_V1).toContain('action واحد من: NONE, FLAG_FOR_TEAM, HANDOFF_TO_HUMAN, CAPTURE_TIME, NOT_NOW, OPT_OUT');
    expect(CORRECTION_PROMPT_V1).not.toContain('SEND_SAMPLE');
  });
});

describe('actionSetFor', () => {
  test('default (and anything but "1") → PR2 set', () => {
    for (const env of [{}, { SHIFT_PROMPT_V1: '0' }, { SHIFT_PROMPT_V1: 'true' }]) {
      expect(actionSetFor(env)).toEqual({
        actions: SHIFT_ACTIONS, stages: MODEL_STAGES, schema: RESPONSE_SCHEMA, correctionPrompt: CORRECTION_PROMPT,
      });
    }
  });

  test('SHIFT_PROMPT_V1=1 → PR1 set', () => {
    expect(actionSetFor({ SHIFT_PROMPT_V1: '1' })).toEqual({
      actions: SHIFT_ACTIONS_V1, stages: MODEL_STAGES_V1, schema: RESPONSE_SCHEMA_V1, correctionPrompt: CORRECTION_PROMPT_V1,
    });
  });

  test('reads process.env at call time', () => {
    const before = process.env.SHIFT_PROMPT_V1;
    try {
      process.env.SHIFT_PROMPT_V1 = '1';
      expect(actionSetFor().actions).toBe(SHIFT_ACTIONS_V1);
      delete process.env.SHIFT_PROMPT_V1;
      expect(actionSetFor().actions).toBe(SHIFT_ACTIONS);
    } finally {
      if (before === undefined) delete process.env.SHIFT_PROMPT_V1;
      else process.env.SHIFT_PROMPT_V1 = before;
    }
  });
});

describe('normalizeActionArgs (§2.3)', () => {
  test.each(['NONE', 'NOT_NOW', 'OPT_OUT', 'END_ROLEPLAY'])('%s keeps no args and is always ok', (action) => {
    expect(normalizeActionArgs(action, { reason: 'quote', sector: 'clinic' })).toEqual({ ok: true, args: {} });
    expect(normalizeActionArgs(action, null)).toEqual({ ok: true, args: {} });
  });

  test('SEND_SAMPLE: sector lower-cased, Arabic words mapped, anything else or missing → other', () => {
    const sector = (s) => normalizeActionArgs('SEND_SAMPLE', { sector: s, business_name: 'x' }).args;
    expect(sector('Clinic')).toEqual({ sector: 'clinic' });
    expect(sector('RESTAURANT')).toEqual({ sector: 'restaurant' });
    expect(sector('مطعم')).toEqual({ sector: 'restaurant' });
    expect(sector('كافيه')).toEqual({ sector: 'restaurant' });
    expect(sector('عيادة')).toEqual({ sector: 'clinic' });
    expect(sector('متجر')).toEqual({ sector: 'store' });
    expect(sector('صالون')).toEqual({ sector: 'other' });
    expect(sector(undefined)).toEqual({ sector: 'other' });
    expect(normalizeActionArgs('SEND_SAMPLE', undefined)).toEqual({ ok: true, args: { sector: 'other' } });
  });

  test('START_ROLEPLAY: name trimmed to 80 cp, facts trimmed / empty dropped / ≤ 8 / each ≤ 200 cp', () => {
    const longName = 'م'.repeat(90);
    const facts = ['  شاورما 3 دنانير ', '', '   ', 'ب'.repeat(250), 1, 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const r = normalizeActionArgs('START_ROLEPLAY', { sector: 'مطعم', business_name: `  ${longName} `, facts, reason: 'quote' });
    expect(r.ok).toBe(true);
    expect(r.args.sector).toBe('restaurant');
    expect(Array.from(r.args.business_name)).toHaveLength(80);
    expect(r.args.facts).toHaveLength(8);
    expect(r.args.facts[0]).toBe('شاورما 3 دنانير');
    expect(Array.from(r.args.facts[1])).toHaveLength(200);
    expect(r.args.facts[2]).toBe('1');
    expect(r.args).not.toHaveProperty('reason');
  });

  test('START_ROLEPLAY without a business name is still ok — results.js reads it from the customer', () => {
    // Round-2 review #1: a missing name is no longer bad args. The model sent null on every
    // START_ROLEPLAY in the 2026-09-17 sims and the example never opened.
    expect(normalizeActionArgs('START_ROLEPLAY', { business_name: '   ', facts: ['x'] }))
      .toMatchObject({ ok: true, args: { business_name: '', facts: ['x'] } });
    expect(normalizeActionArgs('START_ROLEPLAY', {}))
      .toEqual({ ok: true, args: { sector: 'other', business_name: '', facts: [] } });
  });

  test('START_ROLEPLAY with a name and no facts is still ok (canStart decides)', () => {
    expect(normalizeActionArgs('START_ROLEPLAY', { business_name: 'زيتون' }))
      .toEqual({ ok: true, args: { sector: 'other', business_name: 'زيتون', facts: [] } });
  });

  test('FLAG_FOR_TEAM: reason from the list else unknown, summary ≤ 200 cp', () => {
    expect(normalizeActionArgs('FLAG_FOR_TEAM', { reason: 'quote', summary: 'عرض سعر' }))
      .toEqual({ ok: true, args: { reason: 'quote', summary: 'عرض سعر' } });
    const r = normalizeActionArgs('FLAG_FOR_TEAM', { reason: 'price', summary: 'س'.repeat(300) });
    expect(r.args.reason).toBe('unknown');
    expect(Array.from(r.args.summary)).toHaveLength(200);
    expect(r.ok).toBe(true);
  });

  test('HANDOFF_TO_HUMAN: reason from the list else person', () => {
    expect(normalizeActionArgs('HANDOFF_TO_HUMAN', { reason: 'abuse' }).args).toEqual({ reason: 'abuse', summary: '' });
    expect(normalizeActionArgs('HANDOFF_TO_HUMAN', { reason: 'quote' }).args.reason).toBe('person');
    expect(normalizeActionArgs('HANDOFF_TO_HUMAN', null)).toEqual({ ok: true, args: { reason: 'person', summary: '' } });
  });

  test('CAPTURE_TIME: time_text ≤ 120 cp, never ok:false', () => {
    const r = normalizeActionArgs('CAPTURE_TIME', { time_text: 'ب'.repeat(130), reason: 'x' });
    expect(r.ok).toBe(true);
    expect(Object.keys(r.args)).toEqual(['time_text']);
    expect(Array.from(r.args.time_text)).toHaveLength(120);
    expect(normalizeActionArgs('CAPTURE_TIME', {})).toEqual({ ok: true, args: { time_text: '' } });
  });

  test('an unknown action is not ok', () => {
    expect(normalizeActionArgs('SHOW_MENU', {}).ok).toBe(false);
  });
});
