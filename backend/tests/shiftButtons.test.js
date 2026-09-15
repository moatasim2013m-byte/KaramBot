require('./setup');

// Nothing here touches the DB; the mock only keeps lead.js from building a real PrismaClient.
jest.mock('../src/config/prisma', () => ({}));
// followups.js is the other Layer-2 builder's module (contract §0): assertButtons only sees this stand-in.
// Not `virtual`: the file exists now, and a virtual mock of a real path was not always the module
// buttons.js resolved in parallel full runs (the real titles came back and the over-long one never threw).
let mockNudgeTitles = ['جرّبني كزبون', 'مش هلأ'];
jest.mock('../src/workflows/shift/followups', () => ({
  staticTitles: () => mockNudgeTitles,
  nudgePart: () => null,
}));

const hours = require('../src/workflows/shift/hours');
const acks = require('../src/workflows/shift/acks');
const {
  parseSlotId, isShiftButtonId, slotOffers, handleButton, assertButtons, SLOT_OFFER_TTL_MS,
  PR2_ID_RE, DISCOVERY_Q1, consentRecord, staffTask,
} = require('../src/workflows/shift/buttons');
const assets = require('../src/workflows/shift/assets');
const roleplay = require('../src/workflows/shift/roleplay');
const validators = require('../src/workflows/shift/validators');
const { isOptOutCommand, normalizeCommand, optOutResult } = require('../src/workflows/shift/optout');
const { detectHumanRequest, normalizeArabic } = require('../src/workflows/shift/handoff');

const TH = hours.DEFAULT_TEAM_HOURS;
const amman = (s) => new Date(`${s}+03:00`);
const business = { id: 'b1', ai_config: {} };
const MON_11 = amman('2026-09-14T11:00:00');
const TUE_SLOT = 'slot:2026-09-15T10:00+03:00/12:00';

function conv(workflowData = {}, fields = {}) {
  return { id: 'c1', status: 'open', current_state: 'fit', workflow_data: workflowData, ...fields };
}

function summary(offers) {
  return offers.map((o) => [o.id, o.title]);
}

describe('slotOffers — fixture table', () => {
  test('Mon 11:00 → today afternoon, tomorrow morning, other', () => {
    expect(summary(slotOffers(TH, MON_11))).toEqual([
      ['slot:2026-09-14T16:00+03:00/18:00', 'اليوم 4–6'],
      [TUE_SLOT, 'بكرا 10–12'],
      ['slot:other', 'وقت ثاني'],
    ]);
  });

  test('Mon 15:30 → tomorrow morning and afternoon', () => {
    expect(summary(slotOffers(TH, amman('2026-09-14T15:30:00'))).slice(0, 2)).toEqual([
      [TUE_SLOT, 'بكرا 10–12'],
      ['slot:2026-09-15T16:00+03:00/18:00', 'بكرا 4–6'],
    ]);
  });

  test('Thu 11:00 → today afternoon and Sunday morning', () => {
    expect(summary(slotOffers(TH, amman('2026-09-17T11:00:00'))).slice(0, 2)).toEqual([
      ['slot:2026-09-17T16:00+03:00/18:00', 'اليوم 4–6'],
      ['slot:2026-09-20T10:00+03:00/12:00', 'الأحد 10–12'],
    ]);
  });

  test('Thu 16:00 → Sunday morning and afternoon', () => {
    expect(slotOffers(TH, amman('2026-09-17T16:00:00')).map((o) => o.title)).toEqual(['الأحد 10–12', 'الأحد 4–6', 'وقت ثاني']);
  });

  test('Fri 10:00 → Sunday morning and afternoon', () => {
    expect(slotOffers(TH, amman('2026-09-18T10:00:00')).map((o) => o.title)).toEqual(['الأحد 10–12', 'الأحد 4–6', 'وقت ثاني']);
  });

  test('Sat 12:00 → Sunday is tomorrow', () => {
    expect(slotOffers(TH, amman('2026-09-19T12:00:00')).map((o) => o.title)).toEqual(['بكرا 10–12', 'بكرا 4–6', 'وقت ثاني']);
  });

  test('Mon 11:00 with Tuesday closed → Wednesday', () => {
    const offers = slotOffers({ ...TH, closures: ['2026-09-15'] }, MON_11);
    expect(summary(offers).slice(0, 2)).toEqual([
      ['slot:2026-09-14T16:00+03:00/18:00', 'اليوم 4–6'],
      ['slot:2026-09-16T10:00+03:00/12:00', 'الأربعاء 10–12'],
    ]);
  });

  test('Mon 11:00 in English', () => {
    expect(slotOffers(TH, MON_11, 'en').map((o) => o.title)).toEqual(['Today 4–6 pm', 'Tomorrow 10–12', 'Another time']);
  });

  test('assertButtons passes for every title the default hours produce', () => {
    expect(() => assertButtons()).not.toThrow();
  });
});

describe('slot ids', () => {
  test('parseSlotId round-trips with slotOffers', () => {
    for (const offer of slotOffers(TH, MON_11).slice(0, 2)) {
      const p = parseSlotId(offer.id);
      expect(`slot:${p.dateKey}T${p.startHm}${p.offset}/${p.endHm}`).toBe(offer.id);
      expect(p.end.getTime()).toBeGreaterThan(p.start.getTime());
    }
    const p = parseSlotId(TUE_SLOT);
    expect(p.start.toISOString()).toBe('2026-09-15T07:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-09-15T09:00:00.000Z');
    expect(parseSlotId('slot:other')).toEqual({ other: true });
    expect(parseSlotId('slot:2026-09-15T12:00+03:00/10:00')).toBeNull();
    expect(parseSlotId('lead_talk')).toBeNull();
  });

  test('isShiftButtonId', () => {
    expect(isShiftButtonId('lead_talk')).toBe(true);
    expect(isShiftButtonId('slot:other')).toBe(true);
    expect(isShiftButtonId(TUE_SLOT)).toBe(true);
    expect(isShiftButtonId('CONFIRM_ORDER')).toBe(false);
    expect(isShiftButtonId('slot:tomorrow')).toBe(false);
    expect(isShiftButtonId(undefined)).toBe(false);
  });
});

describe('handleButton', () => {
  const offers = (issuedAt) => [{ id: TUE_SLOT, title: 'بكرا 10–12', issued_at: issuedAt }];

  test('slot tap with name and business → capture', () => {
    const wd = { lead: { name: 'محمد', business_name: 'كافيه زيتون', version: 2 }, slot_offers: offers(MON_11.toISOString()) };
    const r = handleButton(TUE_SLOT, { business, conversation: conv(wd), now: MON_11, lang: 'ar', messageId: 'w1' });
    expect(r.kind).toBe('button');
    expect(r.action).toBe('CAPTURE_TIME');
    expect(r.stateUpdate).toEqual({ status: 'pending', current_state: 'captured' });
    expect(r.workflowDataPatch.needs_team.reason).toBe('meeting');
    expect(r.alert.reason).toBe('meeting');
    expect(r.messages[0].text).toContain('بكرا بين 10 و12 (الثلاثاء 15/9)');
    expect(r.messages[0].text).toContain('سجّلت طلب مكالمة: محمد، كافيه زيتون، بكرا بين 10 و12 (الثلاثاء 15/9) بتوقيت عمّان');
    expect(r.leadPatch.preferred_time).toEqual({
      text: 'بكرا بين 10 و12 (الثلاثاء 15/9)',
      start: '2026-09-15T07:00:00.000Z',
      end: '2026-09-15T09:00:00.000Z',
      tz: 'Asia/Amman',
      slot_id: TUE_SLOT,
    });
    expect(r.leadMeta).toEqual({ source: 'button', msgId: 'w1', at: MON_11.toISOString(), inboundText: '' });
  });

  test('slot tap without both → captureAsk with the privacy line', () => {
    const wd = { lead: { name: 'محمد', sector: 'restaurant' }, slot_offers: offers(MON_11.toISOString()) };
    const r = handleButton(TUE_SLOT, { business, conversation: conv(wd), now: MON_11, lang: 'ar', messageId: 'w1' });
    expect(r.messages[0].text).toBe(acks.captureAsk({ nameKnown: true, businessKnown: false, sector: 'restaurant', lang: 'ar' }));
    expect(r.messages[0].text).toContain('اسم المطعم؟');
    expect(r.messages[0].text).toContain('shifts-ai.com/privacy');
    expect(r.workflowDataPatch.capture_pending).toEqual({ slot_id: TUE_SLOT, time_text: null, at: MON_11.toISOString() });
    expect(r.stateUpdate).toEqual({ current_state: 'close' });
    expect(r.leadPatch.preferred_time.slot_id).toBe(TUE_SLOT);
    expect(r.alert).toBeNull();
  });

  test('an offer issued 13 h ago is expired', () => {
    const issued = new Date(MON_11.getTime() - 13 * 60 * 60 * 1000).toISOString();
    expect(13 * 60 * 60 * 1000).toBeGreaterThan(SLOT_OFFER_TTL_MS);
    const r = handleButton(TUE_SLOT, { business, conversation: conv({ slot_offers: offers(issued) }), now: MON_11, lang: 'ar' });
    expect(r.messages[0].text).toBe('الخيار هاد قديم — أي يوم ووقت بناسبك هلأ؟');
    expect(r.workflowDataPatch.capture_pending).toEqual({ slot_id: null, time_text: null, at: MON_11.toISOString() });
    expect(r.leadPatch).toBeNull();
  });

  test('a window that already ended is expired', () => {
    const r = handleButton('slot:2026-09-13T10:00+03:00/12:00', { business, conversation: conv({}), now: MON_11, lang: 'ar' });
    expect(r.messages[0].text).toBe(acks.expiredSlot('ar'));
  });

  test('slot:other asks for a time and stores capture_pending', () => {
    const r = handleButton('slot:other', { business, conversation: conv({}), now: MON_11, lang: 'ar' });
    expect(r.messages).toEqual([{ type: 'text', text: 'تمام — أي يوم وساعة بتريحك؟' }]);
    expect(r.workflowDataPatch.capture_pending).toEqual({ slot_id: 'other', time_text: null, at: MON_11.toISOString() });
    expect(r.stateUpdate).toEqual({ current_state: 'close' });
    const locked = handleButton('slot:other', { business, conversation: conv({}, { current_state: 'handoff', status: 'pending' }), now: MON_11, lang: 'ar' });
    expect(locked.stateUpdate).toEqual({});
    // Staff resolved or released the handoff: the stage moves on again.
    const released = handleButton('slot:other', { business, conversation: conv({}, { current_state: 'handoff', status: 'open' }), now: MON_11, lang: 'ar' });
    expect(released.stateUpdate).toEqual({ current_state: 'close' });
  });

  test('lead_talk → handoff without buttons', () => {
    const r = handleButton('lead_talk', { business, conversation: conv({}), now: MON_11, lang: 'ar' });
    expect(r.kind).toBe('handoff');
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].type).toBe('text');
    expect(r.messages[0].text.startsWith('ولا يهمك.\n\n')).toBe(true);
    expect(r.stateUpdate).toEqual({ status: 'pending', current_state: 'handoff' });
    expect(r.alert).toEqual({ reason: 'handoff', summary: 'ضغط زر «احكي مع الفريق»' });
  });

  test('unknown id → null', () => {
    expect(handleButton('CONFIRM_ORDER', { business, conversation: conv({}), now: MON_11 })).toBeNull();
  });
});

describe('opt-out commands (§5.8)', () => {
  test.each(['إيقاف', 'ايقاف', 'stop', 'STOP', 'Unsubscribe', 'لا تبعتولي', 'لا تبعتولي شي', 'مش مهتم.', 'مش مهتم!', 'وقف بعت رسايل', 'وقفوا الرسائل'])(
    'positive: %s', (text) => expect(isOptOutCommand(text)).toBe(true),
  );

  test.each(['مش مهتم بالولاء بس بكرم', 'ما بتوقف الرسائل بالليل', 'one-stop shop', 'لا تبعتولي الأسعار هلأ', 'بدي أوقف الموظف', 'stop the bot from replying at night', ''])(
    'negative: %s', (text) => expect(isOptOutCommand(text)).toBe(false),
  );

  test('normalizeCommand strips trailing punctuation', () => {
    expect(normalizeCommand('  إيقاف!! ')).toBe('ايقاف');
  });

  test('optOutResult shape', () => {
    const r = optOutResult({ conversation: conv({}), lang: 'ar', now: MON_11 });
    expect(r).toEqual({
      kind: 'optout',
      action: 'OPT_OUT',
      messages: [{ type: 'text', text: acks.optOut('ar') }],
      stateUpdate: { current_state: 'closed' },
      workflowDataPatch: { marketing_opted_out_at: MON_11.toISOString(), followups: [], capture_pending: null },
      leadPatch: null,
      leadMeta: null,
      needsTeam: null,
      alert: null,
    });
  });
});

describe('human request patterns (§5.7)', () => {
  test.each(['بدي أحكي مع إنسان', 'بدي احكي مع حدا من الفريق', 'حوّلني لموظف', 'وين الموظف؟', 'بدي المدير', 'بدي صاحب الشركة', 'خليني أحكي مع شخص', 'I want to talk to a human', 'can I speak with someone'])(
    'positive: %s', (text) => expect(detectHumanRequest(text)).toBe(true),
  );

  test.each(['عندي موظفة بترد', 'زبايني بحبوا يحكوا مع شخص', 'بدي أحكي مع زباين أكثر', 'موظف', 'مش راضي أحكي مع بوت', 'the bot can talk to customers', 'one-stop shop'])(
    'negative: %s', (text) => expect(detectHumanRequest(text)).toBe(false),
  );

  // The customer checking with their own side first (the «بحكيك» objection) or asking for the site:
  // not a request for someone from SHIFT, so the model decides.
  test.each([
    'خليني أحكي مع المدير وبرجعلك',
    'بدي أحكي مع صاحب الشركة تبعي قبل ما أقرر',
    'خليني احكي مع الفريق تبعي',
    'حوّلني على الموقع',
    'I need to talk to the owner first, then I will get back to you',
  ])('own side or the site, not a handoff: %s', (text) => expect(detectHumanRequest(text)).toBe(false));

  test.each(['بدي احكي مع حدا من الفريق قبل ما ادفع', 'بدي احكي مع حدا عندي سؤال عن الاسعار', 'حوّلني على موظف'])(
    'still a request with more words around it: %s', (text) => expect(detectHumanRequest(text)).toBe(true),
  );

  test('normalizeArabic', () => {
    expect(normalizeArabic('  حوّلني   إلى  مستشفى ')).toBe('حولني الي مستشفي');
  });
});

// ─── PR2 ids (contract §9.1) ─────────────────────────────────────────────────

describe('PR2 button ids', () => {
  const ENV_KEYS = ['SHIFT_ROLEPLAY', 'SHIFT_PROMPT_V1', 'SHIFT_SAMPLES_VETTED', 'SHIFT_SAMPLES_BASE'];
  beforeEach(() => ENV_KEYS.forEach((k) => delete process.env[k]));
  afterAll(() => ENV_KEYS.forEach((k) => delete process.env[k]));

  const SECTORS = ['clinic', 'restaurant', 'store', 'other'];
  const ALL_IDS = [
    ...SECTORS.flatMap((s) => [`sector:${s}`, `sample_roleplay:${s}`, `sample_page:${s}`, `sample_image:${s}`]),
    'send_sample_now', 'quote_written', 'lead_call', 'end_roleplay', 'roleplay_continue', 'followup_yes', 'followup_no', 'nudge_not_now',
  ];
  const vettedBiz = (...sectors) => ({ id: 'b1', ai_config: { samples_vetted: sectors } });
  const tap = (id, wd = {}, fields = {}, extra = {}) => handleButton(id, {
    business, conversation: conv(wd, fields), now: MON_11, lang: 'ar', messageId: 'w9', ...extra,
  });
  const activeRoleplay = (fields = {}) => ({
    active: true, sector: 'restaurant', business_name: 'مطعم الساحة', facts: ['شاورما 3 دنانير'],
    started_at: MON_11.toISOString(), last_turn_at: MON_11.toISOString(), turns: 2, setup_asks: 1, ended_at: null, end_reason: null, ...fields,
  });

  test('isShiftButtonId accepts every PR2 id and still refuses look-alikes', () => {
    for (const id of ALL_IDS) {
      expect(PR2_ID_RE.test(id)).toBe(true);
      expect(isShiftButtonId(id)).toBe(true);
    }
    for (const id of ['sector:gym', 'sample_page:', 'send_sample_now ', 'followup_maybe', 'SECTOR:clinic', 'sample_roleplay:clinic:x']) {
      expect(isShiftButtonId(id)).toBe(false);
    }
  });

  test.each(ALL_IDS)('%s routes to a result with messages and records itself in last_bot', (id) => {
    const r = tap(id, { lead: { sector: 'clinic' } });
    expect(r).not.toBeNull();
    expect(r.messages.length).toBeGreaterThanOrEqual(1);
    for (const part of r.messages) expect(validators.countQuestions(part.text || '')).toBeLessThanOrEqual(1);
    expect(r.workflowDataPatch.last_bot).toMatchObject({ button_id: id, at: MON_11.toISOString() });
    expect(['question', 'buttons', 'confirmed', 'terminal']).toContain(r.workflowDataPatch.last_bot.next_step);
    // Taps never carry model metadata: every word is server copy.
    for (const part of r.messages) expect(part).not.toHaveProperty('modelLine');
  });

  test('sector:clinic → ack + fixed discovery question, stage discovery, trusted sector', () => {
    const r = tap('sector:clinic', {}, { current_state: 'opening' });
    expect(r.messages).toEqual([{ type: 'text', text: `${acks.sectorAck('clinic', 'ar')}\n${DISCOVERY_Q1.ar}` }]);
    expect(r.stateUpdate).toEqual({ current_state: 'discovery' });
    expect(r.leadPatch).toEqual({ sector: 'clinic' });
    expect(r.leadMeta).toEqual({ source: 'button', msgId: 'w9', at: MON_11.toISOString(), inboundText: '', trusted: ['sector'] });
    expect(r.workflowDataPatch.questions_asked).toBe(1);
    expect(r.workflowDataPatch.last_bot.next_step).toBe('question');
    const en = tap('sector:store', {}, {}, { lang: 'en' });
    expect(en.messages[0].text).toBe(`Got it, an online store.\n${DISCOVERY_Q1.en}`);
  });

  test('sector:other → the sector_text ask and awaiting_sector_text', () => {
    const r = tap('sector:other');
    expect(r.messages).toEqual([{ type: 'text', text: acks.sectorTextAsk('ar') }]);
    expect(r.stateUpdate).toEqual({ current_state: 'discovery' });
    expect(r.leadPatch).toEqual({ sector: 'other' });
    expect(r.workflowDataPatch.awaiting_sector_text).toBe(true);
  });

  test('sample_roleplay with role-play on → setup ask, roleplay_setup, a complete inactive roleplay object', () => {
    const r = tap('sample_roleplay:restaurant', { samples_sent: { image: 'restaurant', page: null, accepted_at: null } });
    expect(r.messages).toEqual([{ type: 'text', text: roleplay.setupAsk('restaurant', 'ar') }]);
    expect(r.stateUpdate).toEqual({ current_state: 'roleplay_setup' });
    expect(r.workflowDataPatch.roleplay).toEqual({
      active: false, sector: 'restaurant', business_name: null, facts: [], started_at: null, last_turn_at: null,
      turns: 0, setup_asks: 1, ended_at: null, end_reason: null,
    });
    expect(r.workflowDataPatch.samples_sent).toEqual({ image: 'restaurant', page: null, accepted_at: MON_11.toISOString() });
    expect(r.workflowDataPatch.msgs_since_interest).toBe(0);
  });

  test('sample_roleplay during a live example does not reset it', () => {
    const r = tap('sample_roleplay:restaurant', { roleplay: activeRoleplay() }, { current_state: 'roleplay' });
    expect(r.messages[0].text).toBe(acks.roleplayContinue('ar'));
    expect(r.workflowDataPatch).not.toHaveProperty('roleplay');
    expect(r.stateUpdate).toEqual({});
  });

  test.each([
    ['ctx.roleplayOn false', {}, { roleplayOn: false }],
    ['SHIFT_ROLEPLAY=0', { SHIFT_ROLEPLAY: '0' }, {}],
    ['SHIFT_PROMPT_V1=1', { SHIFT_PROMPT_V1: '1' }, {}],
  ])('sample_roleplay with role-play off (%s) → sector page + follow-up', (_, env, extra) => {
    Object.assign(process.env, env);
    const r = tap('sample_roleplay:clinic', {}, {}, extra);
    expect(r.messages.map((p) => p.type)).toEqual(['cta_url', 'text']);
    expect(r.messages[0]).toEqual(assets.pagePart('clinic', 'ar'));
    expect(r.messages[1]).toEqual(assets.pageFollowUp('clinic', 'ar', { roleplayOn: false }));
    expect(r.stateUpdate).toEqual({});
    expect(r.workflowDataPatch).not.toHaveProperty('roleplay');
    expect(r.workflowDataPatch.samples_sent.page).toBe('clinic');
  });

  test('sample_page in English → cta_url to /en/clinics + the follow-up a second later', () => {
    const r = tap('sample_page:clinic', {}, {}, { lang: 'en' });
    expect(r.messages[0].type).toBe('cta_url');
    expect(r.messages[0].url).toContain('/en/clinics?');
    expect(r.messages[0].serverButtons).toBe(true);
    expect(r.messages[1]).toEqual({ type: 'text', text: assets.pageFollowUp('clinic', 'en', { roleplayOn: true }).text, delayMs: 1000 });
    expect(r.workflowDataPatch.samples_sent).toEqual({ image: null, page: 'clinic', accepted_at: null });
  });

  test('sample_image unvetted → the setup ask; vetted → the labelled image', () => {
    const unvetted = tap('sample_image:store');
    expect(unvetted.messages[0].text).toBe(roleplay.setupAsk('store', 'ar'));
    expect(unvetted.stateUpdate).toEqual({ current_state: 'roleplay_setup' });
    expect(unvetted.workflowDataPatch.samples_sent.image).toBeNull();

    const vetted = handleButton('sample_image:store', { business: vettedBiz('store'), conversation: conv({}), now: MON_11, lang: 'ar' });
    expect(vetted.messages).toEqual([assets.imagePart('store', 'ar', {})]);
    expect(vetted.workflowDataPatch.samples_sent.image).toBe('store');

    process.env.SHIFT_SAMPLES_VETTED = 'store';
    expect(tap('sample_image:store').messages[0].type).toBe('image');
  });

  test('send_sample_now: vetted → the card once, then the pointer; unvetted → setup ask; sector from the lead', () => {
    const biz = vettedBiz('clinic');
    const first = handleButton('send_sample_now', { business: biz, conversation: conv({ lead: { sector: 'clinic' } }), now: MON_11, lang: 'ar' });
    expect(first.messages).toEqual([assets.sampleCard('clinic', 'ar', { roleplayOn: true })]);
    expect(first.stateUpdate).toEqual({ current_state: 'sample' });
    expect(first.workflowDataPatch.samples_sent).toEqual({ image: 'clinic', page: null, accepted_at: MON_11.toISOString() });

    const again = handleButton('send_sample_now', {
      business: biz, conversation: conv({ lead: { sector: 'clinic' }, samples_sent: first.workflowDataPatch.samples_sent }), now: MON_11, lang: 'ar',
    });
    expect(again.messages).toEqual([{ type: 'text', text: acks.sampleAlreadySent('ar') }]);
    expect(again.stateUpdate).toEqual({});

    const unknown = tap('send_sample_now', {});
    expect(unknown.messages[0].text).toBe(roleplay.setupAsk('other', 'ar'));
    expect(unknown.workflowDataPatch.roleplay.sector).toBe('other');

    const offCard = handleButton('send_sample_now', { business: biz, conversation: conv({ lead: { sector: 'clinic' } }), now: MON_11, lang: 'en', roleplayOn: false });
    expect(offCard.messages[0].buttons.map((b) => b.id)).toEqual(['sample_page:clinic', 'quote_written', 'lead_talk']);
  });

  test('quote_written → the written-quote ack, pending, needs_team quote and a quote alert', () => {
    const r = tap('quote_written');
    expect(r.messages[0].text).toBe(`${acks.quoteWrittenLead('ar')}\n\n${acks.flagAck('quote', { teamHours: TH, lang: 'ar' })}`);
    expect(r.stateUpdate).toEqual({ status: 'pending' });
    expect(r.workflowDataPatch.needs_team).toMatchObject({ reason: 'quote', summary: 'طلب عرض مكتوب (زر)', resolved_at: null });
    expect(r.needsTeamCandidate.reason).toBe('quote');
    expect(r.alert).toEqual({ reason: 'quote', summary: 'طلب عرض مكتوب (زر)' });
  });

  test('quote_written while a person request is open → no second «سجّلت», no alert', () => {
    const r = tap('quote_written', { needs_team: { reason: 'person', resolved_at: null, at: 'x' } });
    expect(r.messages[0].text).toBe(validators.stageFallback('handoff', 'ar'));
    expect(r.messages[0].text).not.toContain('سجّلت');
    expect(r.alert).toBeNull();
    expect(r.workflowDataPatch).not.toHaveProperty('needs_team');
  });

  test('lead_call → «تمام.» + slots body + slot buttons, stage close, offers stored', () => {
    const r = tap('lead_call');
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toMatchObject({ type: 'interactive', text: `${acks.callChoiceLead('ar')} ${acks.slotsBody('ar')}`, serverButtons: true });
    expect(r.messages[0].buttons).toEqual(slotOffers(TH, MON_11, 'ar'));
    expect(r.stateUpdate).toEqual({ current_state: 'close' });
    expect(r.workflowDataPatch.slot_offers.every((o) => o.issued_at === MON_11.toISOString())).toBe(true);
    expect(r.workflowDataPatch.last_bot.next_step).toBe('buttons');
  });

  test('end_roleplay: a live example ends with the end line; one never started gets the close line', () => {
    const r = tap('end_roleplay', { roleplay: activeRoleplay({ sector: 'clinic' }) }, { current_state: 'roleplay' });
    expect(r.messages).toEqual([{ type: 'text', text: roleplay.endLine('clinic', 'ar') }]);
    expect(r.stateUpdate).toEqual({ current_state: 'close' });
    expect(r.workflowDataPatch.roleplay).toMatchObject({ active: false, end_reason: 'done', ended_at: MON_11.toISOString(), turns: 2 });

    const setup = tap('end_roleplay', { roleplay: { active: false, sector: 'store', setup_asks: 1, started_at: null } }, { current_state: 'roleplay_setup' });
    expect(setup.messages[0].text).toBe(validators.stageFallback('close', 'ar'));
    expect(setup.messages[0].text).not.toContain('مثال توضيحي');
    expect(setup.stateUpdate).toEqual({ current_state: 'close' });
  });

  test('roleplay_continue: live → carry on; idle-ended < 1 h → reactivated; older → the setup ask', () => {
    const live = tap('roleplay_continue', { roleplay: activeRoleplay() }, { current_state: 'roleplay' });
    expect(live.messages[0].text).toBe(acks.roleplayContinue('ar'));
    expect(live.stateUpdate).toEqual({ current_state: 'roleplay' });

    const endedAt = new Date(MON_11.getTime() - 40 * 60 * 1000).toISOString();
    const idle = tap('roleplay_continue', { roleplay: activeRoleplay({ active: false, end_reason: 'idle', ended_at: endedAt }) }, { current_state: 'close' });
    expect(idle.messages[0].text).toBe(acks.roleplayContinue('ar'));
    expect(idle.stateUpdate).toEqual({ current_state: 'roleplay' });
    expect(idle.workflowDataPatch.roleplay).toMatchObject({ active: true, last_turn_at: MON_11.toISOString(), ended_at: null, end_reason: null, turns: 2, facts: ['شاورما 3 دنانير'] });

    const oldEnd = new Date(MON_11.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const old = tap('roleplay_continue', { roleplay: activeRoleplay({ active: false, end_reason: 'idle', ended_at: oldEnd }) }, { current_state: 'close' });
    expect(old.messages[0].text).toBe(roleplay.setupAsk('restaurant', 'ar'));
    expect(old.stateUpdate).toEqual({ current_state: 'roleplay_setup' });
    expect(old.workflowDataPatch.roleplay).toMatchObject({ active: false, setup_asks: 1, turns: 0, started_at: null });

    process.env.SHIFT_ROLEPLAY = '0';
    expect(tap('roleplay_continue', { roleplay: activeRoleplay({ active: false, end_reason: 'idle', ended_at: endedAt }) }).messages[0].type).toBe('cta_url');
  });

  test('review minor: [نكمّل] under the sent resume nudge resumes the stored facts, however long ago the example paused', () => {
    const oldEnd = new Date(MON_11.getTime() - 3 * 60 * 60 * 1000).toISOString();
    const nudge = { kind: 'roleplay_resume', stage: 'close', sent_at: new Date(MON_11.getTime() - 60000).toISOString() };
    const r = tap('roleplay_continue', { roleplay: activeRoleplay({ active: false, end_reason: 'idle', ended_at: oldEnd }), nudge }, { current_state: 'close' });
    expect(r.messages[0].text).toBe(acks.roleplayContinue('ar'));
    expect(r.stateUpdate).toEqual({ current_state: 'roleplay' });
    expect(r.workflowDataPatch.roleplay).toMatchObject({ active: true, facts: ['شاورما 3 دنانير'] });
  });

  test('followup_yes → consent with scope, a staff task due in two days, an alert, no nudge', () => {
    const existing = Array.from({ length: 20 }, (_, i) => ({ kind: 'call', summary: `t${i}`, due_at: 'x', at: 'x', done_at: null }));
    const r = tap('followup_yes', { staff_tasks: existing, nudge: { due_at: 'x', kind: 'stage' } }, { current_state: 'close' });
    expect(r.messages).toEqual([{ type: 'text', text: acks.consentYes('ar') }]);
    expect(r.workflowDataPatch.lead_consent).toEqual({
      text: acks.consentAsk('ar'), answer: 'yes', at: MON_11.toISOString(), msg_id: 'w9',
      scope: { channel: 'whatsapp', when: '+2d', max: 1 },
    });
    const tasks = r.workflowDataPatch.staff_tasks;
    expect(tasks).toHaveLength(20);
    expect(tasks[19]).toEqual({
      kind: 'followup_consent', summary: 'موافقة متابعة بعد يومين',
      due_at: new Date(MON_11.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(), at: MON_11.toISOString(), done_at: null,
    });
    expect(tasks[0].summary).toBe('t1');
    expect(r.workflowDataPatch.nudge).toBeNull();
    expect(r.alert).toEqual({ reason: 'needs_team', summary: 'موافقة متابعة بعد يومين' });
    expect(r.stateUpdate).toEqual({});
  });

  test('followup_no → consent «no», closed, no followups and no nudge', () => {
    const r = tap('followup_no', {}, { current_state: 'close' });
    expect(r.messages[0].text).toBe(acks.consentNo('ar'));
    expect(r.workflowDataPatch.lead_consent.answer).toBe('no');
    expect(r.stateUpdate).toEqual({ current_state: 'closed' });
    expect(r.workflowDataPatch).toMatchObject({ followups: [], nudge: null });
    expect(r.alert).toBeNull();
  });

  test('nudge_not_now → PR1 NOT_NOW', () => {
    const r = tap('nudge_not_now');
    expect(r.messages).toEqual([{ type: 'text', text: acks.notNow('ar') }]);
    expect(r.stateUpdate).toEqual({ current_state: 'closed' });
    expect(r.workflowDataPatch).toMatchObject({ not_now_at: MON_11.toISOString(), followups: [], capture_pending: null, nudge: null });
    expect(r.workflowDataPatch.last_bot.next_step).toBe('terminal');
  });

  test.each(['sector:clinic', 'sample_roleplay:clinic', 'sample_page:clinic', 'sample_image:clinic', 'send_sample_now', 'lead_call', 'roleplay_continue', 'end_roleplay'])(
    'locked stage (handoff pending): %s → the concierge line, nothing changes', (id) => {
      const r = tap(id, { lead: { sector: 'clinic' } }, { current_state: 'handoff', status: 'pending' });
      expect(r.messages).toEqual([{ type: 'text', text: validators.stageFallback('handoff', 'ar') }]);
      expect(r.stateUpdate).toEqual({});
      expect(r.leadPatch).toBeNull();
      expect(Object.keys(r.workflowDataPatch).filter((k) => !['last_bot', 'msgs_since_interest'].includes(k))).toEqual([]);
    },
  );

  test('locked stage: followup_no and nudge_not_now keep the stage', () => {
    expect(tap('followup_no', {}, { current_state: 'captured', status: 'pending' }).stateUpdate).toEqual({});
    expect(tap('nudge_not_now', {}, { current_state: 'captured', status: 'pending' }).stateUpdate).toEqual({});
  });

  test('every title and row a PR2 tap can produce fits WhatsApp limits, and every id routes (both languages, both modes)', () => {
    const biz = vettedBiz('clinic', 'restaurant', 'store', 'other');
    for (const lang of ['ar', 'en']) {
      for (const roleplayOn of [true, false]) {
        for (const id of ALL_IDS) {
          for (const sector of SECTORS) {
            const r = handleButton(id, { business: biz, conversation: conv({ lead: { sector } }), now: MON_11, lang, roleplayOn });
            for (const part of r.messages) {
              for (const b of part.buttons || []) {
                expect(Array.from(b.title).length).toBeLessThanOrEqual(20);
                expect(isShiftButtonId(b.id)).toBe(true);
              }
              if (part.displayText) expect(Array.from(part.displayText).length).toBeLessThanOrEqual(20);
              if (lang === 'en') expect(part.text).not.toMatch(/[؀-ۿ]/);
            }
          }
        }
      }
      const list = acks.sectorListPart(lang, {});
      expect(Array.from(list.buttonLabel).length).toBeLessThanOrEqual(20);
      for (const row of list.sections[0].rows) {
        expect(Array.from(row.title).length).toBeLessThanOrEqual(24);
        expect(isShiftButtonId(row.id)).toBe(true);
        expect(handleButton(row.id, { business, conversation: conv({}), now: MON_11, lang })).not.toBeNull();
      }
    }
  });

  test('assertButtons walks the nudge titles and throws on one over 20 code points', () => {
    expect(() => assertButtons()).not.toThrow();
    const saved = mockNudgeTitles;
    mockNudgeTitles = ['هاد عنوان طويل كتير ما بيزبط أبدًا'];
    try {
      expect(() => assertButtons()).toThrow(/nudge title/);
    } finally {
      mockNudgeTitles = saved;
    }
  });

  test('consentRecord and staffTask shapes', () => {
    expect(consentRecord({ answer: 'yes', text: 'q', msgId: 'm', now: MON_11 })).toEqual({
      text: 'q', answer: 'yes', at: MON_11.toISOString(), msg_id: 'm', scope: { channel: 'whatsapp', when: '+2d', max: 1 },
    });
    expect(staffTask('window_closed', 'x'.repeat(250), MON_11, new Date(MON_11.getTime() + 1000))).toEqual({
      kind: 'window_closed', summary: 'x'.repeat(200), due_at: new Date(MON_11.getTime() + 1000).toISOString(), at: MON_11.toISOString(), done_at: null,
    });
  });

  test('PR1 ids now also record last_bot', () => {
    const r = handleButton('slot:other', { business, conversation: conv({}), now: MON_11, lang: 'ar' });
    expect(r.workflowDataPatch.last_bot).toMatchObject({ stage: 'close', next_step: 'question', button_id: 'slot:other' });
    expect(r.workflowDataPatch.msgs_since_interest).toBe(0);
  });
});

describe('review round 2: taps that leave a live example end it (r2 #12)', () => {
  const NOW = MON_11;
  function liveConv() {
    return conv({
      lead: { name: 'أحمد', business_name: 'مطعم زيتون', sector: 'restaurant' },
      slot_offers: [{ id: TUE_SLOT, title: 'بكرا 10–12', issued_at: amman('2026-09-14T10:30:00').toISOString() }],
      roleplay: {
        active: true, sector: 'restaurant', business_name: 'مطعم زيتون', facts: ['شاورما 3 دنانير'],
        started_at: amman('2026-09-14T10:55:00').toISOString(), last_turn_at: amman('2026-09-14T10:58:00').toISOString(),
        turns: 1, setup_asks: 1, ended_at: null, end_reason: null,
      },
      bot_turns: 5,
    }, { current_state: 'roleplay' });
  }
  const tap = (id, c = liveConv()) => handleButton(id, { business, conversation: c, now: NOW, lang: 'ar', messageId: 'm1', roleplayOn: true });

  test.each([
    [TUE_SLOT, 'done', 'captured'],
    ['lead_talk', 'handoff', 'handoff'],
    ['nudge_not_now', 'optout', 'closed'],
    ['followup_no', 'optout', 'closed'],
    ['lead_call', 'done', 'close'],
    ['sector:restaurant', 'done', 'discovery'],
  ])('%s ends the example (%s) and leaves the stage at %s', (id, reason, stage) => {
    const r = tap(id);
    expect(r.workflowDataPatch.roleplay).toMatchObject({ active: false, end_reason: reason, ended_at: NOW.toISOString(), turns: 1 });
    expect(r.stateUpdate.current_state).toBe(stage);
  });

  test('a tap that keeps the stage (a quote request) also ends the example, and the stage moves to close', () => {
    const r = tap('quote_written');
    expect(r.workflowDataPatch.roleplay).toMatchObject({ active: false, end_reason: 'done' });
    expect(r.stateUpdate).toMatchObject({ status: 'pending', current_state: 'close' });
  });

  test.each(['end_roleplay', 'roleplay_continue', 'sample_roleplay:restaurant'])('%s is the example\'s own control and is left as it was', (id) => {
    const r = tap(id);
    if (id === 'end_roleplay') expect(r.workflowDataPatch.roleplay.end_reason).toBe('done');
    else expect(r.workflowDataPatch.roleplay).toBeUndefined();
  });

  test('without a live example a tap writes no roleplay object', () => {
    const c = liveConv();
    c.workflow_data.roleplay = { ...c.workflow_data.roleplay, active: false, end_reason: 'done' };
    expect(tap('lead_call', c).workflowDataPatch.roleplay).toBeUndefined();
  });
});
