/**
 * SEND_SAMPLE in results.js (contract §9.2 step 2, D11): vetted sector cards, one image per sector,
 * the role-play setup when no image is vetted, and the sector page when role-play is off.
 */
require('./setup');

// Pure: the mock only keeps lead.js from building a real PrismaClient.
jest.mock('../src/config/prisma', () => ({}));

const { toWorkflowResult } = require('../src/workflows/shift/results');
const assets = require('../src/workflows/shift/assets');
const roleplay = require('../src/workflows/shift/roleplay');
const { SITE_URL } = require('../src/config/site');

const OLD_HOST = ['shifts-ai', 'store'].join('.');
const MON_11 = new Date('2026-09-14T11:00:00+03:00');
const ENV_KEYS = ['SHIFT_ROLEPLAY', 'SHIFT_PROMPT_V1', 'SHIFT_SAMPLES_VETTED', 'SHIFT_SAMPLES_BASE'];
beforeEach(() => ENV_KEYS.forEach((k) => delete process.env[k]));
afterAll(() => ENV_KEYS.forEach((k) => delete process.env[k]));

const CARD_BUTTONS = {
  ar: ['جرّبه كمراجع', 'افتح صفحة العيادات', 'احكي مع الفريق'],
  en: ['Try it as a patient', 'Clinics page', 'Talk to the team'],
};

function ctx({ wd = {}, stage = 'fit', lang = 'ar', vetted = [], text = 'أي أوريني', ...rest } = {}) {
  return {
    business: { id: 'b1', ai_config: { samples_vetted: vetted } },
    conversation: { id: 'c1', status: 'open', current_state: stage, workflow_data: wd },
    batchMessages: [{ id: 'm1', message_type: 'text', text_body: text }],
    now: MON_11,
    lang,
    ...rest,
  };
}

const sample = (sector, reply = 'تمام، هاد مثال على عيادة 👇', extra = {}) => ({
  reply, action: 'SEND_SAMPLE', action_args: sector === undefined ? {} : { sector }, stage: 'sample', next_step: 'buttons', ...extra,
});

describe('SEND_SAMPLE — vetted sector', () => {
  test.each(['ar', 'en'])('one interactive part: image header, labelled body, three fixed buttons, header-less fallback (%s)', (lang) => {
    const reply = lang === 'en' ? "Sure, here's an example 👇" : 'تمام، هاد مثال على عيادة 👇';
    const r = toWorkflowResult(sample('clinic', reply), ctx({ lang, vetted: ['clinic'] }));
    const interactive = r.messages.filter((p) => p.type === 'interactive');
    expect(interactive).toHaveLength(1);
    const card = interactive[0];
    expect(card.header).toEqual({ type: 'image', image: { link: `${SITE_URL}/assets/samples/clinic-square-v1.png` } });
    expect(card.text.startsWith(lang === 'en' ? 'Illustrative example' : 'مثال توضيحي')).toBe(true);
    expect(card.buttons).toEqual([
      { id: 'sample_roleplay:clinic', title: CARD_BUTTONS[lang][0] },
      { id: 'sample_page:clinic', title: CARD_BUTTONS[lang][1] },
      { id: 'lead_talk', title: CARD_BUTTONS[lang][2] },
    ]);
    expect(card.serverButtons).toBe(true);
    expect(card.fallback).toBeDefined();
    expect(card.fallback).not.toHaveProperty('header');
    expect(card.fallback.buttons).toEqual(card.buttons);
    expect(card).not.toHaveProperty('modelLine');

    // The model's own line goes first, as its own part with metadata.
    expect(r.messages).toHaveLength(2);
    expect(r.messages[0]).toEqual({ type: 'text', text: reply, modelLine: reply });
    expect(r.action).toBe('SEND_SAMPLE');
    expect(r.stateUpdate).toEqual({ current_state: 'sample' });
    expect(r.workflowDataPatch.samples_sent).toEqual({ image: 'clinic', page: null, accepted_at: MON_11.toISOString() });
    expect(r.leadPatch).toBeNull();
  });

  test('an empty model line → the card alone', () => {
    const r = toWorkflowResult(sample('restaurant', ''), ctx({ vetted: ['restaurant'] }));
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].type).toBe('interactive');
    expect(r.messages[0].text.startsWith('مثال توضيحي (مش زبون حقيقي)')).toBe(true);
  });

  test('the env list is unioned with ai_config.samples_vetted', () => {
    process.env.SHIFT_SAMPLES_VETTED = 'store';
    const r = toWorkflowResult(sample('store'), ctx({ vetted: [] }));
    expect(r.messages.some((p) => p.type === 'interactive' && p.header?.type === 'image')).toBe(true);
  });

  test('an existing accepted_at is kept', () => {
    const wd = { samples_sent: { image: null, page: 'clinic', accepted_at: '2026-09-13T08:00:00.000Z' } };
    const r = toWorkflowResult(sample('clinic'), ctx({ wd, vetted: ['clinic'] }));
    expect(r.workflowDataPatch.samples_sent).toEqual({ image: 'clinic', page: 'clinic', accepted_at: '2026-09-13T08:00:00.000Z' });
  });

  test('role-play off → the card offers the page and a written quote instead of «جرّبه»', () => {
    process.env.SHIFT_ROLEPLAY = '0';
    const r = toWorkflowResult(sample('clinic'), ctx({ vetted: ['clinic'] }));
    const card = r.messages.find((p) => p.type === 'interactive');
    expect(card.buttons.map((b) => b.id)).toEqual(['sample_page:clinic', 'quote_written', 'lead_talk']);
  });

  test('a second SEND_SAMPLE of the same sector → the model line only, no second image', () => {
    const wd = { samples_sent: { image: 'clinic', page: null, accepted_at: MON_11.toISOString() } };
    const r = toWorkflowResult(sample('clinic', 'المثال فوق، بتحب تجرّبه على عيادتك؟'), ctx({ wd, vetted: ['clinic'] }));
    expect(r.messages).toEqual([{ type: 'text', text: 'المثال فوق، بتحب تجرّبه على عيادتك؟', modelLine: 'المثال فوق، بتحب تجرّبه على عيادتك؟' }]);
    expect(r.workflowDataPatch).not.toHaveProperty('samples_sent');

    const empty = toWorkflowResult(sample('clinic', ''), ctx({ wd, vetted: ['clinic'] }));
    expect(empty.messages).toEqual([{ type: 'text', text: 'المثال وصلك فوق 👆 بتحب تجرّبه على شغلك أنت؟' }]);
  });

  test('a different sector after the first image is still sent', () => {
    const wd = { samples_sent: { image: 'clinic', page: null, accepted_at: MON_11.toISOString() } };
    const r = toWorkflowResult(sample('store'), ctx({ wd, vetted: ['clinic', 'store'] }));
    expect(r.messages.find((p) => p.type === 'interactive').buttons[0].id).toBe('sample_roleplay:store');
    expect(r.workflowDataPatch.samples_sent.image).toBe('store');
  });
});

describe('SEND_SAMPLE — not vetted (D11 default)', () => {
  test('role-play on → the model line + the setup ask, stage roleplay_setup, setup_asks 1', () => {
    const reply = 'أكيد، خلينا نجرّبه على مطعمك.';
    const r = toWorkflowResult(sample('restaurant', reply), ctx());
    expect(r.messages).toHaveLength(1);
    const ask = roleplay.setupAsk('restaurant', 'ar');
    expect(r.messages[0]).toEqual({ type: 'text', text: `${reply}\n\n${ask}`, modelLine: reply, ack: ask });
    expect(r.stateUpdate).toEqual({ current_state: 'roleplay_setup' });
    expect(r.workflowDataPatch.roleplay).toEqual({
      active: false, sector: 'restaurant', business_name: null, facts: [], started_at: null, last_turn_at: null,
      turns: 0, setup_asks: 1, ended_at: null, end_reason: null,
    });
    expect(r.workflowDataPatch.samples_sent.accepted_at).toBe(MON_11.toISOString());
  });

  test('role-play off → the sector page as a cta_url', () => {
    process.env.SHIFT_ROLEPLAY = '0';
    const r = toWorkflowResult(sample('clinic'), ctx());
    expect(r.messages.map((p) => p.type)).toEqual(['text', 'cta_url']);
    expect(r.messages[1]).toEqual(assets.pagePart('clinic', 'ar'));
    expect(r.messages[1].url.startsWith(`${SITE_URL}/clinics?`)).toBe(true);
    expect(r.stateUpdate).toEqual({ current_state: 'sample' });
    expect(r.workflowDataPatch.samples_sent.page).toBe('clinic');
    expect(r.workflowDataPatch).not.toHaveProperty('roleplay');
  });

  test('SHIFT_PROMPT_V1=1 has no SEND_SAMPLE: the model line goes out as NONE', () => {
    process.env.SHIFT_PROMPT_V1 = '1';
    const r = toWorkflowResult(sample('clinic', 'هاد مثال.'), ctx({ vetted: ['clinic'] }));
    expect(r.action).toBe('NONE');
    expect(r.messages).toEqual([{ type: 'text', text: 'هاد مثال.', modelLine: 'هاد مثال.' }]);
  });
});

describe('SEND_SAMPLE — sector resolution and `other`', () => {
  test('no sector in args → the lead sector', () => {
    const r = toWorkflowResult(sample(undefined), ctx({ wd: { lead: { sector: 'store' } }, vetted: ['store'] }));
    expect(r.workflowDataPatch.samples_sent.image).toBe('store');
  });

  test('a customer word is normalised («كافيه» → restaurant)', () => {
    const r = toWorkflowResult(sample('كافيه'), ctx({ vetted: ['restaurant'] }));
    expect(r.workflowDataPatch.samples_sent.image).toBe('restaurant');
  });

  test('`other` → the generic card with the customer\'s sector_text', () => {
    const wd = { lead: { sector: 'other', sector_text: 'صالون نسائي' } };
    const r = toWorkflowResult(sample('other'), ctx({ wd, vetted: ['other'] }));
    const card = r.messages.find((p) => p.type === 'interactive');
    expect(card.text).toContain('بدك تشوفه شغّال على صالون نسائي؟');
    expect(card.buttons.map((b) => b.id)).toEqual(['sample_roleplay:other', 'sample_page:other', 'lead_talk']);

    const noText = toWorkflowResult(sample(undefined), ctx({ vetted: ['other'] }));
    expect(noText.messages.find((p) => p.type === 'interactive').text).toContain('على شغلك؟');
  });

  test('image URLs come from SHIFT_SAMPLES_BASE (trailing slash stripped)', () => {
    process.env.SHIFT_SAMPLES_BASE = 'https://cdn.samples.test/shift/v1/';
    const r = toWorkflowResult(sample('store'), ctx({ vetted: ['store'] }));
    const card = r.messages.find((p) => p.type === 'interactive');
    expect(card.header.image.link).toBe('https://cdn.samples.test/shift/v1/store-square-v1.png');
  });

  test('locked stage (handoff pending): no sample, the model line only', () => {
    const c = ctx({ vetted: ['clinic'] });
    c.conversation = { ...c.conversation, status: 'pending', current_state: 'handoff' };
    const r = toWorkflowResult(sample('clinic', 'الفريق بيتواصل معك.'), c);
    expect(r.action).toBe('NONE');
    expect(r.messages.map((p) => p.type)).toEqual(['text']);
    expect(r.workflowDataPatch).not.toHaveProperty('samples_sent');
  });

  test('no result from this path carries the old domain', () => {
    const results = ['clinic', 'restaurant', 'store', 'other'].flatMap((s) => [
      toWorkflowResult(sample(s), ctx({ vetted: [s] })),
      toWorkflowResult(sample(s), ctx({})),
      toWorkflowResult(sample(s), ctx({ lang: 'en', vetted: [s] })),
    ]);
    expect(JSON.stringify(results)).not.toContain(OLD_HOST);
  });
});
