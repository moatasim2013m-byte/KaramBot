/**
 * shift/followups.js — the single in-window nudge (contract §8.3, design §7.4, eval #10).
 */
require('./setup');

const followups = require('../src/workflows/shift/followups');
const hours = require('../src/workflows/shift/hours');

const OLD_HOST = ['shifts-ai', 'store'].join('.');
const ARABIC = /[؀-ۿ]/;
const cp = (s) => Array.from(s).length;
const amman = (s) => new Date(`${s}+03:00`);
const local = (d) => hours.formatLocal(d, 'Asia/Amman', 'en');

// 2026-09-14 is a Monday; Thursday = 17th, Friday = 18th.
const THU_2030 = amman('2026-09-17T20:30:00');

function conversation(fields = {}, wd = {}) {
  return {
    id: 'c1',
    status: 'open',
    ai_enabled: true,
    current_state: 'fit',
    last_inbound_at: null,
    ...fields,
    workflow_data: { lead: { name: 'محمد', need: ['الرسائل بالليل'], sector: 'clinic' }, nudges_sent: 0, ...wd },
  };
}

function plan({ inboundAt = THU_2030, conv, lastBot, now } = {}) {
  const at = new Date(inboundAt);
  const c = conv || conversation({ last_inbound_at: at.toISOString() });
  return followups.planNudge({
    conversation: c,
    lastInbound: { id: 'in1', created_at: at.toISOString() },
    lastBot: lastBot || { stage: c.current_state, next_step: 'question', at: new Date(at.getTime() + 60000).toISOString() },
    now: now || new Date(at.getTime() + 120000),
  });
}

afterEach(() => {
  delete process.env.SHIFT_NUDGES;
});

describe('planNudge — eligibility', () => {
  test('eligible fit conversation → a stage nudge 20 h after the inbound', () => {
    const n = plan();
    expect(n).toMatchObject({ kind: 'stage', stage: 'fit', for_inbound_id: 'in1', sent_at: null, dropped_at: null, drop_reason: null });
    expect(local(new Date(n.due_at))).toBe('Friday 18/9 16:30');
  });

  test('1. one per silence: a nudge already planned (sent or dropped) for the same inbound → null', () => {
    const first = plan();
    const at = THU_2030.toISOString();
    const withSent = conversation({ last_inbound_at: at }, { nudge: { ...first, sent_at: new Date().toISOString() } });
    expect(plan({ conv: withSent })).toBeNull();
    const withDropped = conversation({ last_inbound_at: at }, { nudge: { ...first, dropped_at: at, drop_reason: 'window' } });
    expect(plan({ conv: withDropped })).toBeNull();
    // A nudge that belongs to an older inbound does not block the new silence.
    const older = conversation({ last_inbound_at: at }, { nudge: { ...first, for_inbound_id: 'older' } });
    expect(plan({ conv: older })).not.toBeNull();
  });

  test('2. lifetime cap of 2', () => {
    const at = THU_2030.toISOString();
    expect(plan({ conv: conversation({ last_inbound_at: at }, { nudges_sent: 1 }) })).not.toBeNull();
    expect(plan({ conv: conversation({ last_inbound_at: at }, { nudges_sent: 2 }) })).toBeNull();
  });

  test('only after a bot message that asked something, and only when the bot spoke last', () => {
    expect(plan({ lastBot: { next_step: 'confirmed', at: new Date(THU_2030.getTime() + 60000).toISOString() } })).toBeNull();
    expect(plan({ lastBot: { next_step: 'terminal', at: new Date(THU_2030.getTime() + 60000).toISOString() } })).toBeNull();
    expect(plan({ lastBot: { next_step: 'buttons', at: new Date(THU_2030.getTime() + 60000).toISOString() } })).not.toBeNull();
    // The customer wrote after the bot: not a silence after our question.
    expect(plan({ lastBot: { next_step: 'question', at: new Date(THU_2030.getTime() - 60000).toISOString() } })).toBeNull();
    const c = conversation({ last_inbound_at: THU_2030.toISOString() });
    const staffLast = followups.planNudge({
      conversation: c,
      lastInbound: { id: 'in1', created_at: THU_2030.toISOString() },
      lastBot: { next_step: 'question', at: new Date(THU_2030.getTime() + 60000).toISOString() },
      newestMessage: { direction: 'outbound', sent_by_user_id: 'u1', created_at: new Date(THU_2030.getTime() + 90000).toISOString() },
      now: new Date(THU_2030.getTime() + 120000),
    });
    expect(staffLast).toBeNull();
  });

  test.each([
    ['opted out', {}, { marketing_opted_out_at: '2026-09-17T10:00:00Z' }],
    ['not now', {}, { not_now_at: '2026-09-17T10:00:00Z' }],
    ['captured', { current_state: 'captured' }, {}],
    ['handoff', { current_state: 'handoff' }, {}],
    ['closed', { current_state: 'closed' }, {}],
    ['human takeover', { status: 'human_takeover' }, {}],
    ['ai disabled', { ai_enabled: false }, {}],
  ])('not eligible when %s', (_, fields, wd) => {
    expect(plan({ conv: conversation({ last_inbound_at: THU_2030.toISOString(), ...fields }, wd) })).toBeNull();
  });

  test('SHIFT_NUDGES=0 → nothing is planned', () => {
    process.env.SHIFT_NUDGES = '0';
    expect(followups.nudgesEnabled()).toBe(false);
    expect(plan()).toBeNull();
  });

  test('3. sample_touch (2 h) only for a sample accepted but not delivered; a plain sample stage → 20 h', () => {
    const at = amman('2026-09-15T14:00:00');
    const accepted = conversation(
      { current_state: 'sample', last_inbound_at: at.toISOString() },
      { samples_sent: { image: null, page: null, accepted_at: at.toISOString() } },
    );
    const touch = plan({ inboundAt: at, conv: accepted });
    expect(touch.kind).toBe('sample_touch');
    expect(new Date(touch.due_at).getTime() - at.getTime()).toBe(2 * 3600000);

    const delivered = conversation(
      { current_state: 'sample', last_inbound_at: at.toISOString() },
      { samples_sent: { image: 'clinic', page: null, accepted_at: at.toISOString() } },
    );
    const plain = plan({ inboundAt: at, conv: delivered });
    expect(plain.kind).toBe('stage');
    expect(new Date(plain.due_at).getTime() - at.getTime()).toBe(20 * 3600000);

    const offered = conversation({ current_state: 'sample', last_inbound_at: at.toISOString() }, { samples_sent: { image: null, page: null, accepted_at: null } });
    expect(plan({ inboundAt: at, conv: offered }).kind).toBe('stage');
  });

  test('kinds: roleplay_resume (idle end < 1 h), close_declined, no_contact', () => {
    const at = amman('2026-09-15T10:00:00');
    const now = new Date(at.getTime() + 20 * 60000);
    const idle = conversation(
      { current_state: 'close', last_inbound_at: at.toISOString() },
      { roleplay: { active: false, end_reason: 'idle', ended_at: new Date(at.getTime() + 16 * 60000).toISOString(), business_name: 'مطعم الساحة' } },
    );
    expect(plan({ inboundAt: at, conv: idle, now }).kind).toBe('roleplay_resume');
    const staleIdle = conversation(
      { current_state: 'close', last_inbound_at: at.toISOString() },
      { roleplay: { active: false, end_reason: 'idle', ended_at: new Date(at.getTime() - 2 * 3600000).toISOString() } },
    );
    expect(plan({ inboundAt: at, conv: staleIdle, now }).kind).toBe('stage');
    const declined = conversation({ current_state: 'close', last_inbound_at: at.toISOString() }, { close_declines: 1 });
    expect(plan({ inboundAt: at, conv: declined, now }).kind).toBe('close_declined');
    const anonymous = { ...conversation({ last_inbound_at: at.toISOString() }), workflow_data: { lead: { sector: 'store' } } };
    expect(plan({ inboundAt: at, conv: anonymous, now }).kind).toBe('no_contact');
  });
});

describe('friendly hours and the window ceiling', () => {
  test('4a. eval #10: Thursday 20:30 fit → due Friday 16:30 → send (outside the Friday block)', () => {
    const n = plan();
    const c = conversation({ last_inbound_at: THU_2030.toISOString() }, { nudge: n });
    expect(followups.dueCheck(n, c, amman('2026-09-18T12:00:00'))).toBe('wait');
    expect(followups.dueCheck(n, c, amman('2026-09-18T16:30:00'))).toBe('send');
  });

  test('4b. a last inbound Thursday 23:00 → due Friday 19:00', () => {
    const n = plan({ inboundAt: amman('2026-09-17T23:00:00') });
    expect(local(new Date(n.due_at))).toBe('Friday 18/9 19:00');
    expect(n.dropped_at).toBeNull();
  });

  test('4c. a due time landing Friday 12:00 → 14:00', () => {
    const n = plan({ inboundAt: amman('2026-09-17T16:00:00') });
    expect(local(new Date(n.due_at))).toBe('Friday 18/9 14:00');
    expect(followups.nextFriendlyMinute(amman('2026-09-18T11:00:00')).toISOString()).toBe(amman('2026-09-18T14:00:00').toISOString());
    expect(followups.nextFriendlyMinute(amman('2026-09-18T13:59:00')).toISOString()).toBe(amman('2026-09-18T14:00:00').toISOString());
    // The block is Friday only.
    expect(followups.nextFriendlyMinute(amman('2026-09-17T12:00:00')).toISOString()).toBe(amman('2026-09-17T12:00:00').toISOString());
  });

  test('5. a last inbound at 02:00 → due 22:00 → next friendly 09:00 is past the 01:30 ceiling → born dropped (window)', () => {
    const at = amman('2026-09-15T02:00:00');
    const n = plan({ inboundAt: at });
    expect(local(new Date(n.due_at))).toBe('Wednesday 16/9 09:00');
    expect(n.drop_reason).toBe('window');
    expect(n.dropped_at).not.toBeNull();
    expect(n.sent_at).toBeNull();
  });

  test('nextFriendlyMinute: before 09:00 → 09:00, after 21:30 → 09:00 next day, inside → unchanged', () => {
    expect(local(followups.nextFriendlyMinute(amman('2026-09-15T07:10:00')))).toBe('Tuesday 15/9 09:00');
    expect(local(followups.nextFriendlyMinute(amman('2026-09-15T21:31:00')))).toBe('Wednesday 16/9 09:00');
    expect(local(followups.nextFriendlyMinute(amman('2026-09-15T21:30:00')))).toBe('Tuesday 15/9 21:30');
    // Thursday night → Friday 09:00 (the block starts at 11:00).
    expect(local(followups.nextFriendlyMinute(amman('2026-09-17T23:00:00')))).toBe('Friday 18/9 09:00');
  });

  test('dueCheck: past the ceiling → drop; outside friendly hours → wait, or drop when the next friendly minute is past the ceiling', () => {
    const inbound = amman('2026-09-16T12:00:00'); // ceiling Thursday 11:30
    const base = { kind: 'stage', stage: 'fit', for_inbound_id: 'in1', for_inbound_at: inbound.toISOString(), sent_at: null, dropped_at: null, drop_reason: null };
    const c = (n) => conversation({ last_inbound_at: inbound.toISOString() }, { nudge: n });

    const early = { ...base, due_at: amman('2026-09-17T07:00:00').toISOString() };
    expect(followups.dueDecision(early, c(early), amman('2026-09-17T08:00:00'))).toMatchObject({ decision: 'wait', reason: 'friendly_hours' });
    expect(followups.dueCheck(early, c(early), amman('2026-09-17T09:00:00'))).toBe('send');
    expect(followups.dueDecision(early, c(early), amman('2026-09-17T11:31:00'))).toMatchObject({ decision: 'drop', reason: 'window' });

    const inbound2 = amman('2026-09-16T01:00:00'); // ceiling Thursday 00:30
    const late = { ...base, for_inbound_at: inbound2.toISOString(), due_at: amman('2026-09-16T21:00:00').toISOString() };
    const c2 = conversation({ last_inbound_at: inbound2.toISOString() }, { nudge: late });
    expect(followups.dueDecision(late, c2, amman('2026-09-16T21:45:00'))).toMatchObject({ decision: 'drop', reason: 'window' });
  });

  test('a settled nudge is never sent again', () => {
    const n = plan();
    const sent = { ...n, sent_at: amman('2026-09-18T16:30:00').toISOString() };
    const c = conversation({ last_inbound_at: THU_2030.toISOString() }, { nudge: sent });
    expect(followups.dueDecision(sent, c, amman('2026-09-18T17:00:00'))).toEqual({ decision: 'drop', reason: 'settled' });
  });
});

describe('6. cancel reasons', () => {
  const due = amman('2026-09-18T16:30:00');
  function setup(fields = {}, wd = {}) {
    const n = plan();
    return { n, c: conversation({ last_inbound_at: THU_2030.toISOString(), ...fields }, { nudge: n, ...wd }) };
  }

  test('none → send', () => {
    const { n, c } = setup();
    expect(followups.cancelReason(c)).toBeNull();
    expect(followups.dueCheck(n, c, due)).toBe('send');
  });

  test('inbound: a newer inbound row, or a newer last_inbound_at', () => {
    const { n, c } = setup();
    const newest = { id: 'in2', created_at: amman('2026-09-18T09:00:00').toISOString() };
    expect(followups.cancelReason(c, { newestInbound: newest })).toBe('inbound');
    expect(followups.dueCheck(n, c, due, { newestInbound: newest })).toBe('drop');
    const moved = { ...c, last_inbound_at: amman('2026-09-18T09:00:00').toISOString() };
    expect(followups.dueDecision(n, moved, due)).toMatchObject({ decision: 'drop', reason: 'inbound' });
    // The same inbound is not a cancel.
    expect(followups.cancelReason(c, { newestInbound: { id: 'in1', created_at: THU_2030.toISOString() } })).toBeNull();
  });

  test('staff: a staff outbound after the inbound, or a takeover', () => {
    const { n, c } = setup();
    const staff = { created_at: amman('2026-09-18T10:00:00').toISOString(), sent_by_user_id: 'u1' };
    expect(followups.cancelReason(c, { newestStaffOutbound: staff })).toBe('staff');
    expect(followups.dueDecision(n, c, due, { newestStaffOutbound: staff })).toMatchObject({ decision: 'drop', reason: 'staff' });
    const old = { created_at: amman('2026-09-17T10:00:00').toISOString() };
    expect(followups.cancelReason(c, { newestStaffOutbound: old })).toBeNull();
    expect(followups.cancelReason({ ...c, status: 'human_takeover' })).toBe('staff');
  });

  test.each([
    ['optout', {}, { marketing_opted_out_at: '2026-09-18T08:00:00Z' }],
    ['not_now', {}, { not_now_at: '2026-09-18T08:00:00Z' }],
    ['captured', { current_state: 'captured' }, {}],
    ['handoff', { current_state: 'handoff' }, {}],
    ['closed', { current_state: 'closed' }, {}],
    ['lifetime', {}, { nudges_sent: 2 }],
  ])('%s', (reason, fields, wd) => {
    const { n, c } = setup(fields, wd);
    expect(followups.cancelReason(c)).toBe(reason);
    expect(followups.dueDecision(n, c, due)).toMatchObject({ decision: 'drop', reason });
  });

  test('disabled (SHIFT_NUDGES=0)', () => {
    const { n, c } = setup();
    process.env.SHIFT_NUDGES = '0';
    expect(followups.cancelReason(c)).toBe('disabled');
    expect(followups.dueCheck(n, c, due)).toBe('drop');
  });
});

describe('7. texts', () => {
  const FORBIDDEN = /واتساب ما بيسمحلنا|WhatsApp (doesn't|does not) allow/i;

  function variants(lang) {
    const en = lang === 'en';
    const lead = en
      ? { name: 'Sam', business_name: 'Noor Boutique', sector: 'store', need: ['late replies'] }
      : { name: 'محمد', business_name: 'مطعم الساحة', sector: 'restaurant', need: ['الرسائل بالليل'] };
    const rp = { business_name: lead.business_name, end_reason: 'idle' };
    return [
      [{ kind: 'stage', stage: 'fit' }, conversation({ current_state: 'fit' }, { lead })],
      [{ kind: 'stage', stage: 'discovery' }, conversation({ current_state: 'discovery' }, { lead: { sector: lead.sector, name: lead.name } })],
      [{ kind: 'stage', stage: 'opening' }, conversation({ current_state: 'opening' }, { lead: { business_name: lead.business_name } })],
      [{ kind: 'stage', stage: 'sample' }, conversation({ current_state: 'sample' }, { lead })],
      [{ kind: 'sample_touch', stage: 'sample' }, conversation({ current_state: 'sample' }, { lead })],
      [{ kind: 'roleplay_resume', stage: 'close' }, conversation({ current_state: 'close' }, { lead, roleplay: rp })],
      [{ kind: 'close_declined', stage: 'close' }, conversation({ current_state: 'close' }, { lead })],
      [{ kind: 'no_contact', stage: 'discovery' }, conversation({}, { lead: {} })],
    ];
  }

  test.each(['ar', 'en'])('%s: no digits, titles ≤ 20 cp, no window claim, server buttons, one question at most', (lang) => {
    for (const [nudge, c] of variants(lang)) {
      const part = followups.nudgePart(c, nudge, lang);
      expect(part.text).not.toMatch(/\d/);
      expect(part.text).not.toMatch(FORBIDDEN);
      expect(part.text).not.toContain(OLD_HOST);
      expect((part.text.match(/[؟?]/g) || []).length).toBeLessThanOrEqual(1);
      if (lang === 'en') expect(part.text).not.toMatch(ARABIC);
      for (const b of part.buttons || []) {
        expect(cp(b.title)).toBeLessThanOrEqual(20);
        expect(b.title).not.toMatch(/\d/);
        if (lang === 'en') expect(b.title).not.toMatch(ARABIC);
      }
      if (part.type === 'interactive') expect(part.serverButtons).toBe(true);
    }
  });

  test('stage text (eval #10 shape) with honorific, need and the sector question; buttons and ids', () => {
    const c = conversation({ current_state: 'fit' }, { lead: { name: 'محمد', need: ['الرسائل بالليل'], sector: 'clinic' } });
    const part = followups.nudgePart(c, { kind: 'stage', stage: 'fit' }, 'ar');
    expect(part.text).toBe('أستاذ محمد، بخصوص اللي حكيتلي عنه (الرسائل بالليل) — بدك أوريك كيف بيرد كرم لما الزبون يسأل «في موعد بكرا؟»');
    expect(part.buttons).toEqual([
      { id: 'sample_roleplay:clinic', title: 'جرّبني كزبون' },
      { id: 'send_sample_now', title: 'ابعت مثال' },
      { id: 'nudge_not_now', title: 'مش هلأ' },
    ]);
    const noNeed = followups.nudgePart(conversation({}, { lead: { business_name: 'متجر النور' } }), { kind: 'stage', stage: 'fit' }, 'ar');
    expect(noNeed.text).toBe('بدك أوريك كيف بيرد كرم لما الزبون يسأل «شو أوقات الدوام؟»');
    expect(noNeed.buttons[0].id).toBe('sample_roleplay:other');
    const abu = followups.nudgePart(conversation({}, { lead: { name: 'أبو أحمد', sector: 'restaurant' } }), { kind: 'stage', stage: 'fit' }, 'ar');
    expect(abu.text.startsWith('أبو أحمد، بدك')).toBe(true);
    const en = followups.nudgePart(conversation({}, { lead: { name: 'Sam', sector: 'restaurant', need: ['late replies'] } }), { kind: 'stage' }, 'en');
    expect(en.text).toBe('Sam, about what you told me (late replies) — want to see how Karam answers when a customer asks "Do you deliver?"');
    expect(en.buttons.map((b) => b.title)).toEqual(['Try me as a customer', 'Send an example', 'Not now']);
  });

  test('other kinds: exact ids', () => {
    const lead = { name: 'محمد', business_name: 'مطعم الساحة', sector: 'restaurant' };
    const ids = (kind, stage, wd = {}) => followups.nudgePart(conversation({ current_state: stage }, { lead, ...wd }), { kind, stage }, 'ar').buttons?.map((b) => b.id);
    expect(ids('sample_touch', 'sample')).toEqual(['send_sample_now', 'nudge_not_now']);
    expect(ids('stage', 'sample')).toEqual(['send_sample_now', 'nudge_not_now']);
    expect(ids('roleplay_resume', 'close', { roleplay: { business_name: 'مطعم الساحة' } })).toEqual(['roleplay_continue', 'end_roleplay']);
    expect(ids('close_declined', 'close')).toEqual(['quote_written', 'lead_call', 'nudge_not_now']);
    const noContact = followups.nudgePart(conversation({}, { lead: {} }), { kind: 'no_contact' }, 'ar');
    expect(noContact).toEqual({ type: 'text', text: 'قبل ما يسكر الشات من جهتنا: اسم المحل بس، عشان الفريق يرجعلك على هالرقم؟' });
    const resume = followups.nudgePart(conversation({}, { lead, roleplay: { business_name: 'مطعم الساحة' } }), { kind: 'roleplay_resume' }, 'ar');
    expect(resume.text).toBe('نكمّل المثال على مطعم الساحة؟ ضايل كم سؤال.');
    const sample = followups.nudgePart(conversation({ current_state: 'sample' }, { lead: {} }), { kind: 'stage', stage: 'sample' }, 'ar');
    expect(sample.text).toBe('إذا لسه حاب تشوف المثال على شغلك، بقدر أبعثه هون.');
  });

  test('staticTitles covers both languages within 20 cp', () => {
    const titles = followups.staticTitles();
    expect(titles.length).toBeGreaterThanOrEqual(16);
    for (const t of titles) expect(cp(t)).toBeLessThanOrEqual(20);
  });
});

// ─── Review round 1 ──────────────────────────────────────────────────────────

describe('review round 1 (nudges)', () => {
  test('minor: no «المثال جاهز» touch after the page link already went out', () => {
    const at = amman('2026-09-15T14:00:00');
    const pageSent = conversation(
      { current_state: 'sample', last_inbound_at: at.toISOString() },
      { samples_sent: { image: null, page: 'other', accepted_at: at.toISOString() } },
    );
    expect(plan({ inboundAt: at, conv: pageSent }).kind).toBe('stage');
  });

  test('minor: no nudge is planned while an example is live; the resume nudge comes 2 h after the silence', () => {
    const at = amman('2026-09-15T10:00:00');
    const live = conversation({ current_state: 'roleplay', last_inbound_at: at.toISOString() }, { roleplay: { active: true, started_at: at.toISOString() } });
    expect(plan({ inboundAt: at, conv: live })).toBeNull();

    const idle = conversation(
      { current_state: 'close', last_inbound_at: at.toISOString() },
      { roleplay: { active: false, end_reason: 'idle', started_at: at.toISOString(), ended_at: new Date(at.getTime() + 16 * 60000).toISOString(), business_name: 'مطعم الساحة' } },
    );
    const n = plan({ inboundAt: at, conv: idle, now: new Date(at.getTime() + 17 * 60000) });
    expect(n.kind).toBe('roleplay_resume');
    expect(new Date(n.due_at).getTime() - at.getTime()).toBe(followups.ROLEPLAY_RESUME_DELAY_MS);
  });

  test.each(['close', 'objection'])('minor: a %s-stage nudge asks continue-here-or-call, not another example', (stage) => {
    const c = conversation({ current_state: stage }, { lead: { name: 'محمد', business_name: 'مطعم الساحة', sector: 'restaurant' }, roleplay: { active: false, end_reason: 'done' } });
    const ar = followups.nudgePart(c, { kind: 'stage', stage }, 'ar');
    expect(ar.text).toBe('إذا بتحب، منكمّل هون، أو بطلبلك مكالمة قصيرة مع الفريق — أيهم أريح إلك؟');
    expect(ar.buttons.map((b) => b.id)).toEqual(['lead_call', 'nudge_not_now']);
    expect(ar.serverButtons).toBe(true);
    const en = followups.nudgePart(c, { kind: 'stage', stage }, 'en');
    expect(en.text).not.toMatch(ARABIC);
    expect(en.text).not.toMatch(/\d/);
    expect((en.text.match(/\?/g) || []).length).toBe(1);
  });
});

describe('review round 2 (followups)', () => {
  const at = THU_2030.toISOString();

  test('r2 #9: no nudge while the customer waits on the team (pending with an open request)', () => {
    const escalated = conversation(
      { status: 'pending', current_state: 'discovery', last_inbound_at: at },
      { needs_team: { reason: 'unsent_reply', summary: 'x', at, resolved_at: null } },
    );
    expect(plan({ conv: escalated })).toBeNull();
    const quote = conversation(
      { status: 'pending', current_state: 'sample', last_inbound_at: at },
      { needs_team: { reason: 'quote', summary: 'x', at, resolved_at: null } },
    );
    expect(plan({ conv: quote })).toBeNull();
    // Resolved by staff: selling may resume.
    const resolved = conversation(
      { status: 'open', current_state: 'fit', last_inbound_at: at },
      { needs_team: { reason: 'quote', summary: 'x', at, resolved_at: at } },
    );
    expect(plan({ conv: resolved })).not.toBeNull();
  });

  test('r2 #9: no nudge after an inbound parked for staff or not yet confirmed answered', () => {
    const c = conversation({ last_inbound_at: at });
    for (const status of ['awaiting_staff', 'unconfirmed']) {
      const n = followups.planNudge({
        conversation: c,
        lastInbound: { id: 'in1', created_at: at, status },
        lastBot: { stage: 'fit', next_step: 'question', at: new Date(THU_2030.getTime() + 60000).toISOString() },
        now: new Date(THU_2030.getTime() + 120000),
      });
      expect(n).toBeNull();
    }
  });

  test('r2 #9: a planned nudge is cancelled once the conversation waits on the team', () => {
    const n = plan();
    const c = conversation({ status: 'pending', last_inbound_at: at }, { nudge: n, needs_team: { reason: 'unsent_reply', at, resolved_at: null } });
    expect(followups.cancelReason(c, {})).toBe('staff');
    expect(followups.cancelReason(conversation({ last_inbound_at: at }, { nudge: n }), { newestInbound: { id: 'in1', created_at: at, status: 'awaiting_staff' } })).toBe('staff');
  });

  test('minor: with role-play off the stage nudge opens the sector page instead of promising a try-out', () => {
    process.env.SHIFT_ROLEPLAY = '0';
    try {
      const part = followups.nudgePart(conversation(), { kind: 'stage', stage: 'fit' }, 'ar');
      expect(part.buttons[0]).toEqual({ id: 'sample_page:clinic', title: 'افتح صفحة العيادات' });
      expect(part.buttons.map((b) => b.title)).not.toContain('جرّبني كزبون');
    } finally {
      delete process.env.SHIFT_ROLEPLAY;
    }
    expect(followups.nudgePart(conversation(), { kind: 'stage', stage: 'fit' }, 'ar').buttons[0].id).toBe('sample_roleplay:clinic');
  });

  test('minor: a need or name carrying a promise or a link stays out of the nudge line', () => {
    const c = conversation({}, { lead: { name: 'محمد', need: ['الفريق وعدني أول شهر ببلاش'], sector: 'clinic', business_name: 'www.x.co' } });
    const part = followups.nudgePart(c, { kind: 'stage', stage: 'fit' }, 'ar');
    expect(part.text).not.toMatch(/ببلاش|www/);
    expect(part.text.startsWith('أستاذ محمد، بدك أوريك')).toBe(true);
  });
});
