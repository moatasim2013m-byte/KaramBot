/**
 * shift/prompt.ar.js — static system prompt v2 (contract §7.2).
 */
require('./setup');

const promptV2 = require('../src/workflows/shift/prompt.ar');
const { SHIFT_KNOWLEDGE } = require('../src/workflows/shift/prompt');
const { SITE_HOST, PRIVACY_SHORT } = require('../src/config/site');

const OLD_HOST = ['shifts-ai', 'store'].join('.');
const CLINIC_BULLET = '- للعيادات:';
const RESTAURANT_BULLET = '- للمطاعم والكافيهات:';
const STORE_BULLET = '- للمتاجر الإلكترونية:';
const ACTIONS = ['NONE', 'SEND_SAMPLE', 'START_ROLEPLAY', 'END_ROLEPLAY', 'FLAG_FOR_TEAM', 'HANDOFF_TO_HUMAN', 'CAPTURE_TIME', 'NOT_NOW', 'OPT_OUT'];

describe('static prompt content', () => {
  const prompt = promptV2.buildStaticPrompt({});

  test('identity, the nine actions, the JSON contract, the fence, links, the call wording and the FAQ', () => {
    expect(prompt).toContain('مساعد شِفت الذكي');
    const actionLine = prompt.split('\n').find((l) => l.startsWith('- action:'));
    for (const action of ACTIONS) expect(actionLine).toContain(action);
    expect(prompt).toContain('{"reply":"نص الرد","action":"NONE","action_args":{},"buttons":[],"lead":{},"stage":"discovery","next_step":"question"}');
    expect(prompt).toContain('<<<بيانات>>>');
    expect(prompt).toContain(`- روابط مسموحة فقط: ${SITE_HOST} و/clinics و/restaurants و/online-stores و/privacy و/en و/en/clinics و/en/restaurants و/en/online-stores.`);
    expect(prompt).toContain(`التفاصيل: ${PRIVACY_SHORT})`);
    expect(prompt).toContain(`أنا كرم، مساعد شِفت الذكي (${SITE_HOST})`);
    expect(prompt).toContain('مكالمة قصيرة');
    expect(prompt).toContain('أسئلة تشغيلية');
  });

  test('D9 line sits under «# الصدق»', () => {
    const lines = prompt.split('\n');
    const honesty = lines.findIndex((l) => l.startsWith('# الصدق'));
    const next = lines.findIndex((l, i) => i > honesty && l.startsWith('# '));
    const section = lines.slice(honesty, next);
    expect(section).toContain('- المكالمة: «مكالمة قصيرة مع الفريق» — لا تذكر مدتها بالدقائق.');
  });

  test('no old host, no «15 دقيقة» outside the D9 prohibition, no unreplaced placeholders', () => {
    for (const text of [prompt, promptV2.SHIFT_SYSTEM_PROMPT_TEMPLATE, promptV2.buildStaticPrompt({ sector: 'store' })]) {
      expect(text).not.toContain(OLD_HOST);
      const outsideD9 = text.split('\n').filter((l) => !l.includes('لا تذكر مدتها بالدقائق')).join('\n');
      expect(outsideD9).not.toMatch(/15\s*دقيقة/);
    }
    expect(prompt).not.toContain('{{');
    expect(prompt).not.toMatch(/\$\{|undefined/);
    expect(promptV2.SHIFT_SYSTEM_PROMPT_TEMPLATE.match(/\{\{/g)).toHaveLength(1);
  });
});

describe('sector-trimmed knowledge', () => {
  test('clinic has the clinic bullet and not the restaurant bullet', () => {
    const clinic = promptV2.buildStaticPrompt({ sector: 'clinic' });
    expect(clinic).toContain(CLINIC_BULLET);
    expect(clinic).not.toContain(RESTAURANT_BULLET);
    expect(clinic).not.toContain(STORE_BULLET);
  });

  test('no sector, or an unknown one, has all three sectors', () => {
    for (const p of [promptV2.buildStaticPrompt({}), promptV2.buildStaticPrompt(), promptV2.buildStaticPrompt({ sector: 'bakery' })]) {
      expect(p).toContain(CLINIC_BULLET);
      expect(p).toContain(RESTAURANT_BULLET);
      expect(p).toContain(STORE_BULLET);
    }
  });

  test('other keeps the common lines and the FAQ but no sector bullet', () => {
    const other = promptV2.buildStaticPrompt({ sector: 'other' });
    expect(other).not.toContain(CLINIC_BULLET);
    expect(other).not.toContain(RESTAURANT_BULLET);
    expect(other).toContain('8) أتمتة مخصّصة');
    expect(other).toContain('أسئلة تشغيلية:');
  });

  test('two calls with the same sector return identical strings', () => {
    expect(promptV2.buildStaticPrompt({ sector: 'restaurant' })).toBe(promptV2.buildStaticPrompt({ sector: 'restaurant' }));
    expect(promptV2.buildStaticPrompt({})).toBe(promptV2.buildStaticPrompt({ sector: undefined }));
  });

  test('KNOWLEDGE_SECTIONS partition PR1 SHIFT_KNOWLEDGE without losing a line', () => {
    const { common, clinic, restaurant, store, other } = promptV2.KNOWLEDGE_SECTIONS;
    expect(common).toContain('شِفت (SHIFT AI & Automation)');
    expect(common).toContain('الموقع:');
    expect(common).toContain('يمكن البدء بمنتج واحد');
    for (const n of [2, 3, 4, 5, 6, 7, 8]) expect(common).toContain(`${n}) `);
    expect(clinic.startsWith('   - للعيادات:')).toBe(true);
    expect(restaurant).toContain(RESTAURANT_BULLET);
    expect(store).toContain(STORE_BULLET);
    expect(other).toBe('');
    const all = [common, clinic, restaurant, store].join('\n').split('\n').filter(Boolean).sort();
    expect(all).toEqual(SHIFT_KNOWLEDGE.split('\n').filter(Boolean).sort());
  });

  test('OPERATIONAL_FAQ: header and five verbatim Q→A lines', () => {
    const lines = promptV2.OPERATIONAL_FAQ.split('\n');
    expect(lines[0]).toBe('أسئلة تشغيلية:');
    expect(lines.slice(1)).toHaveLength(5);
    for (const l of lines.slice(1)) expect(l).toMatch(/^- «.+» → «.+»$/);
    expect(promptV2.OPERATIONAL_FAQ).toContain('هاي بتتحدد بالعرض حسب الإعداد — بحطها بأسئلة الفريق');
    expect(promptV2.knowledgeFor('clinic').endsWith(promptV2.OPERATIONAL_FAQ)).toBe(true);
  });
});
