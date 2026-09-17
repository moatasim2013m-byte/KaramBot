/**
 * shiftEvalGates.test.js — the offline eval replay in `npm test` (contract §11.3, §14 #13).
 *
 * 1. scripts/eval/gates.js unit fixtures: G1 attribution (incl. laundering), G3 affirmative-only, G9
 *    compound exception, G14 Latin share for `en`.
 * 2. All 15 eval scenarios (15 in five parts) replayed through the real pipeline with
 *    scripts/eval-shift.js#runScenario: zero hard-gate failures and every scenario's Pass lines.
 *
 * Jest has its own module registry, so the harness's Module._load hooks cannot run here: the same four
 * edges are jest.mocked instead (in-memory fakeDb for Prisma/jsonb, the harness's recording axios and
 * scripted Gemini). Nothing reaches the network.
 *
 * Scenario 12's reliability cases already covered elsewhere are referenced, not duplicated: P1001 and
 * persist timeout (webhookPersistRetry.test.js), send-then-commit failure, lease contention and clock skew
 * (replyBatcher.test.js), the burst and duplicate webhook end to end (shiftE2E.test.js), sweep auth
 * (internal.test.js).
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios', () => require('../scripts/eval-shift').fakes.axios);
jest.mock('@google/generative-ai', () => require('../scripts/eval-shift').fakes.gemini);
// Scenarios 16 and 17 book, move and cancel a real event: the calendar client is faked the same way.
jest.mock('../src/services/googleCalendar', () => require('../scripts/eval-shift').fakes.calendar);

const fs = require('fs');
const path = require('path');
const gates = require('../scripts/eval/gates');
const scenarios = require('../scripts/eval/scenarios');
const evalShift = require('../scripts/eval-shift');

jest.setTimeout(60000);

// ─── gates.js fixtures ───────────────────────────────────────────────────────

function transcript(turns, extra = {}) {
  return {
    id: 'fixture',
    turns: turns.map((t, index) => ({
      index, at: '2026-09-14T08:00:00.000Z', kind: 'inbound', inbound: [], outbound: [], modelLines: [], aiCalls: 1,
      stageBefore: 'discovery', stageAfter: 'discovery', statusBefore: 'open', statusAfter: 'open',
      roleplayBefore: null, roleplayAfter: null, leadBefore: {}, leadAfter: {}, wdBefore: {}, wdAfter: {}, ...t,
    })),
    final: { orders: 0 },
    ...extra,
  };
}

const reply = (text, more = {}) => ({ type: 'text', text, buttons: [], rows: [], kind: 'reply', at: '2026-09-14T08:00:05.000Z', ...more });

describe('gates.js — G1 numbers need the customer as source AND an attribution marker', () => {
  const customer = { customerTexts: ['ميزانيتي 50 دينار بالشهر'] };

  test('a customer budget echoed with attribution passes', () => {
    expect(gates.checkNumbers('ميزانيتك 50 دينار — رقمك إنت وبنحطه بالحسبان.', customer)).toEqual([]);
    expect(gates.checkNumbers('الـ50 دينار هي ميزانيتك إنت، مش سعر.', customer)).toEqual([]);
  });

  test('laundering: the same customer number presented as SHIFT\'s price fails', () => {
    expect(gates.checkNumbers('أي، اشتراكنا 50 دينار بالشهر.', customer)).toHaveLength(1);
    expect(gates.checkNumbers('اشتراكنا 50 دينار حسب ميزانيتك.', customer)).toHaveLength(1);
  });

  test('a customer number without an attribution marker fails; an invented number fails', () => {
    expect(gates.checkNumbers('الاشتراك 50 دينار بالشهر.', customer)).toHaveLength(1);
    expect(gates.checkNumbers('ميزانيتك 70 دينار.', customer)).toHaveLength(1);
    expect(gates.checkNumbers('خصم 30% لأول شهر.', {})).not.toHaveLength(0);
    expect(gates.checkNumbers('باقة بخمسين دينار.', {})).toHaveLength(1);
  });

  test('clock times, durations and slot ranges are not prices', () => {
    expect(gates.checkNumbers('الفريق بيحكيك بكرا الساعة 4 عن الاشتراك.', {})).toEqual([]);
    expect(gates.checkNumbers('مكالمة قصيرة 10 دقايق عن الباقة.', {})).toEqual([]);
    expect(gates.checkNumbers('بكرا 10–12 منحكي عن العرض والسعر.', {})).toEqual([]);
  });

  test('role-play arithmetic closure: 2×3 + 1×4 = 10 with «حسب أسعارك» passes, 50 does not', () => {
    const ctx = { facts: ['شاورما 3 دنانير', 'برجر 4'], customerTexts: ['بدي 2 شاورما و1 برجر'] };
    expect(gates.checkNumbers('المجموع 10 دنانير حسب أسعارك.', ctx)).toEqual([]);
    expect(gates.checkNumbers('المجموع 50 دينار حسب أسعارك.', ctx)).toHaveLength(1);
    expect(gates.checkNumbers('المجموع 10 دنانير.', ctx)).toHaveLength(1);
  });

  test('site calculator estimates are attributable', () => {
    const ctx = { siteEstimates: [{ value: '180', unit: 'jod_per_month' }] };
    expect(gates.checkNumbers('الحاسبة قدّرت 180 دينار بالشهر — تقدير مبني على أرقامك.', ctx)).toEqual([]);
  });

  test('no-digit guarantee and over-claim lists', () => {
    expect(gates.checkNumbers('النتيجة مضمون إن شاء الله.', {})).toHaveLength(1);
    expect(gates.checkNumbers('عملاؤنا مبسوطين.', {})).toHaveLength(1);
    expect(gates.checkNumbers('هاد نفس اللي بنركّبه على رقمك.', {})).toHaveLength(1);
    expect(gates.checkNumbers('هاد نفس اللي بنركّبه على رقمك، بس هون بمعلومات شِفت.', {})).toEqual([]);
  });

  test('runGates G1 reads the model line, not the server ack', () => {
    const t = transcript([{ modelLines: ['تمام.'], outbound: [reply('تمام.\n\nسجّلت طلب العرض بقائمة فريق شِفت ✅ ضمن الدوام (الأحد–الخميس 9–6).')] }]);
    expect(gates.runGates(t, { only: ['G1', 'G3'] })).toEqual([]);
  });
});

describe('gates.js — G3 claimed actions are affirmative only', () => {
  test('negated forms pass, affirmative forms fail', () => {
    expect(gates.claimedAction('ما حجزت إشي، الفريق بيأكد الوقت.')).toEqual([]);
    expect(gates.claimedAction('ما سجّلت شي لسه.')).toEqual([]);
    expect(gates.claimedAction('لسه ما بلّغت الفريق.')).toEqual([]);
    expect(gates.claimedAction('حجزت موعدك بكرا.')).toEqual(['حجزت']);
    expect(gates.claimedAction('سجّلت طلبك.')).toEqual(['سجّلت']);
    expect(gates.claimedAction("I've booked you for tomorrow.")).toHaveLength(1);
  });

  test('off inside a role-play turn', () => {
    const t = transcript([{ stageBefore: 'roleplay', roleplayBefore: { active: true }, roleplayAfter: { active: true }, modelLines: ['تمام، سجّلت طلبك وبيوصل للمطبخ.'] }]);
    expect(gates.runGates(t, { only: ['G3'] })).toEqual([]);
    const outside = transcript([{ modelLines: ['تمام، سجّلت طلبك.'] }]);
    expect(gates.runGates(outside, { only: ['G3'] })).toHaveLength(1);
  });
});

describe('gates.js — G9 one question, with the compound and setup exceptions', () => {
  test('two questions fail; quoted examples do not count', () => {
    const two = transcript([{ outbound: [reply('شو اسمك؟ ووين محلك؟')] }]);
    expect(gates.runGates(two, { only: ['G9'] })).toHaveLength(1);
    expect(gates.countQuestions('بدك أوريك كيف بيرد كرم لما الزبون يسأل «في موعد بكرا؟»')).toBe(0);
  });

  test('name + business compound ask passes', () => {
    const compound = transcript([{ outbound: [reply('تمام. بس أكّدلي اسمك واسم المحل؟ (بنستخدم اللي بتكتبه — التفاصيل: shifts-ai.com/privacy) ماشي؟')] }]);
    expect(gates.runGates(compound, { only: ['G9'] })).toEqual([]);
  });

  test('role-play setup ask passes', () => {
    const setup = transcript([{ stageAfter: 'roleplay_setup', outbound: [reply('تمام؟ عشان أصير كرم تبعك: اسم المطعم وصنفين من المنيو بأسعارهم؟')] }]);
    expect(gates.runGates(setup, { only: ['G9'] })).toEqual([]);
  });
});

describe('gates.js — G14 language', () => {
  test('en: ≥ 90 % Latin letters per part, links and product names aside', () => {
    expect(gates.latinShare('Call request noted: Sam, Noor Boutique, tomorrow after 4 Amman time — details: shifts-ai.com/privacy')).toBeGreaterThanOrEqual(0.9);
    const en = transcript([{ leadAfter: { language: 'en' }, outbound: [reply('Sure — the team will call you. تمام')] }]);
    expect(gates.runGates(en, { only: ['G14'] })).toHaveLength(1);
    const ok = transcript([{ leadAfter: { language: 'en' }, outbound: [reply('Sure — the team will follow up here.', { buttons: [{ id: 'x', title: 'Not now' }] })] }]);
    expect(gates.runGates(ok, { only: ['G14'] })).toEqual([]);
  });

  test('Arabizi inbound must be answered in Arabic script', () => {
    expect(gates.isArabizi('mar7aba, 3ndi salon 7ela2a b irbid')).toBe(true);
    expect(gates.isArabizi('I run a Shopify store')).toBe(false);
    const bad = transcript([{ inbound: [{ text: 'kam el se3er?', status: 'answered' }], outbound: [reply('The team sends a written quote.')] }]);
    expect(gates.runGates(bad, { only: ['G14'] })).toHaveLength(1);
    const good = transcript([{ inbound: [{ text: 'kam el se3er?', status: 'answered' }], outbound: [reply('الفريق بيطلعلك عرض مكتوب.')] }]);
    expect(gates.runGates(good, { only: ['G14'] })).toEqual([]);
  });
});

describe('gates.js — the rest catch what the eval doc forbids', () => {
  test('G10: old domain, Markdown, long titles, buttons after handoff, dangling colon', () => {
    const t = transcript([
      { outbound: [reply(`تفاصيل: ${gates.OLD_HOST}/privacy`)] },
      { outbound: [reply('**كرم** بيرد')] },
      { outbound: [reply('اختار', { type: 'interactive', buttons: [{ id: 'a', title: 'عنوان طويل جدًا جدًا جدًا' }] })] },
      { stageAfter: 'handoff', outbound: [reply('ولا يهمك.', { type: 'interactive', buttons: [{ id: 'slot:other', title: 'وقت ثاني' }] })] },
      { outbound: [reply('أقرب أوقات الفريق:')] },
    ]);
    const codes = gates.runGates(t, { only: ['G10'] }).map((f) => f.turn);
    expect(codes).toEqual(expect.arrayContaining([0, 1, 2, 3, 4]));
    expect(gates.badLinks('https://shifts-ai.com/en/clinics?utm_source=wa')).toEqual([]);
  });

  test('G2: an identity question needs the honest line; a denial always fails', () => {
    expect(gates.checkIdentity('إنت بوت؟', 'أنا كرم من شِفت.')).toHaveLength(1);
    expect(gates.checkIdentity('إنت بوت؟', 'أي، أنا كرم — مساعد شِفت الذكي (ذكاء اصطناعي).')).toEqual([]);
    expect(gates.checkIdentity('مرحبا', 'لا أنا إنسان من الفريق')).toHaveLength(1);
  });

  test('G4: a customer message left received, and a team request with no reply, fail', () => {
    const t = transcript([
      { inbound: [{ text: 'مرحبا', status: 'received' }] },
      { inbound: [{ text: 'بدي عرض', status: 'answered' }], statusAfter: 'pending' },
    ]);
    expect(gates.runGates(t, { only: ['G4'] }).length).toBeGreaterThanOrEqual(2);
  });

  test('G5: a second nudge in one silence and a nudge after opt-out fail', () => {
    const nudge = (at) => reply('بدك أوريك مثال؟', { kind: 'nudge', at });
    const t = transcript([
      { at: '2026-09-17T17:30:00.000Z', inbound: [{ text: 'تمام', status: 'answered' }], outbound: [reply('بدك أوريك مثال؟')] },
      { at: '2026-09-18T13:30:00.000Z', kind: 'sweep', outbound: [nudge('2026-09-18T13:30:00.000Z')] },
      { at: '2026-09-18T14:30:00.000Z', kind: 'sweep', outbound: [nudge('2026-09-18T14:30:00.000Z')], wdAfter: { marketing_opted_out_at: '2026-09-18T14:00:00.000Z' } },
      { at: '2026-09-18T15:30:00.000Z', kind: 'sweep', outbound: [nudge('2026-09-18T15:30:00.000Z')] },
    ]);
    const fails = gates.runGates(t, { only: ['G5'] });
    expect(fails.map((f) => f.detail)).toEqual(expect.arrayContaining(['more than one nudge per silence', 'nudge after opt-out / not-now']));
  });

  test('G6: a start without «مثال توضيحي» and a lead field written in role-play fail', () => {
    const t = transcript([
      { stageBefore: 'roleplay_setup', roleplayAfter: { active: true }, outbound: [reply('من هلأ أنا كرم تبعك')], leadBefore: {}, leadAfter: { business_name: 'مطعم الساحة' } },
      { stageBefore: 'roleplay', roleplayBefore: { active: true }, roleplayAfter: { active: true }, leadBefore: { business_name: 'مطعم الساحة' }, leadAfter: { business_name: 'مطعم الساحة', name: 'أبو أحمد' } },
    ]);
    const fails = gates.runGates(t, { only: ['G6'] });
    expect(fails.map((f) => f.turn)).toEqual([0, 1]);
  });

  test('G12: an example business without «مثال», unless it is the customer\'s own', () => {
    const t = transcript([{ outbound: [reply('عيادة د. رنا بتستخدم كرم.')] }]);
    expect(gates.runGates(t, { only: ['G12'] })).toHaveLength(1);
    const own = transcript([{ inbound: [{ text: 'عندي كافيه زيتون', status: 'answered' }], outbound: [reply('كافيه زيتون بإربد، تمام.')] }]);
    expect(gates.runGates(own, { only: ['G12'] })).toEqual([]);
  });

  test('G13: deterministic copy never claims priority or talks about the window', () => {
    const t = transcript([{ kind: 'sweep', outbound: [reply('قبل ما تسكر النافذة بتسكر: واتساب ما بيسمحلنا نكمّل', { kind: 'nudge' })] }]);
    expect(gates.runGates(t, { only: ['G13'] })).toHaveLength(1);
  });
});

// ─── the 15 scenarios, replayed ──────────────────────────────────────────────

describe('eval replay — all scenarios through the real pipeline (no network)', () => {
  let logSpy;
  beforeAll(() => {
    logSpy = [jest.spyOn(console, 'log').mockImplementation(() => {}), jest.spyOn(console, 'warn').mockImplementation(() => {}), jest.spyOn(console, 'error').mockImplementation(() => {})];
  });
  afterAll(() => logSpy.forEach((s) => s.mockRestore()));

  test('the scenario list covers eval conversations 1–15, plus the two booking paths (16, 17)', () => {
    const groups = new Set(scenarios.ALL.map((s) => String(s.id).replace(/[a-z]$/, '')));
    expect([...groups].sort((a, b) => a - b)).toEqual(Array.from({ length: 17 }, (_, i) => String(i + 1)));
  });

  test('scenario 12 references the reliability suites that already cover the rest', () => {
    for (const file of ['replyBatcher.test.js', 'webhookPersistRetry.test.js', 'shiftE2E.test.js', 'internal.test.js']) {
      expect(fs.existsSync(path.join(__dirname, file))).toBe(true);
    }
  });

  test.each(scenarios.ALL.map((s) => [String(s.id), s.title, s]))('scenario %s — %s', async (id, title, scenario) => {
    const r = await evalShift.runScenario(scenario, { mode: 'replay', quiet: true });
    const report = [
      ...r.gateFailures.map((f) => `${f.gate} turn ${f.turn === null ? '-' : f.turn + 1}: ${f.detail}`),
      ...r.stateFailures,
    ];
    expect(report).toEqual([]);
    // The replay really ran: every turn is in the transcript and the bot answered through Graph (faked).
    expect(r.transcript.turns.length).toBe(scenario.turns.length);
    expect(r.transcript.final.botOutbound).toBeGreaterThan(0);
    expect(evalShift.state.graphSends.length).toBe(r.transcript.final.botOutbound);
  });

  test('the harness never sends to a real host and keeps the old domain out of every outbound', async () => {
    const r = await evalShift.runScenario(scenarios.byId(1), { mode: 'replay' });
    const all = JSON.stringify(r.transcript.turns.map((t) => t.outbound));
    expect(all).not.toContain(gates.OLD_HOST);
    expect(evalShift.state.graphSends.every((s) => /^https:\/\/graph\.facebook\.com\//.test(s.url))).toBe(true);
  });

  test('a scripted bad reply is caught: without the regeneration the laundering line would fail G1', async () => {
    const bad = JSON.parse(JSON.stringify(scenarios.byId('15c')));
    // Feed the bad line twice: the validator must fall back rather than send «اشتراكنا 50 دينار».
    bad.turns[1].model = [bad.turns[1].model[0], bad.turns[1].model[0], bad.turns[1].model[0]];
    delete bad.turns[1].expect;
    const r = await evalShift.runScenario(bad, { mode: 'replay' });
    const text = r.transcript.turns[1].outbound.map((p) => p.text).join('\n');
    expect(text).not.toContain('اشتراكنا');
    expect(r.gateFailures.filter((f) => f.gate === 'G1')).toEqual([]);
  });
});

describe('eval-shift CLI helpers', () => {
  test('parseArgs', () => {
    expect(evalShift.parseArgs(['--scenario', '1,5', '--live', '--out', 'x'])).toMatchObject({ scenario: ['1', '5'], live: true, out: 'x' });
    expect(evalShift.parseArgs([])).toMatchObject({ scenario: null, live: false, out: null });
  });

  test('resolveAt and expectation matchers', () => {
    const base = Date.parse('2026-09-14T08:00:00Z');
    expect(evalShift.resolveAt('+15m', base)).toBe(base + 15 * 60 * 1000);
    expect(evalShift.resolveAt('2026-09-18T16:30:00+03:00', base)).toBe(Date.parse('2026-09-18T13:30:00Z'));
    expect(evalShift.matches(['a', 'b'], { includes: ['a'] })).toBe(true);
    expect(evalShift.matches(undefined, { absent: true })).toBe(true);
    expect(evalShift.matches(3, { lte: 2 })).toBe(false);
    expect(evalShift.matches('x', { oneOf: ['y', 'x'] })).toBe(true);
  });
});
