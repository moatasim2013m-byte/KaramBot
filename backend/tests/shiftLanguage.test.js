/**
 * shiftLanguage.test.js — G13/G14 over every deterministic producer (contract §11.3).
 *
 * For lang='en' no fixed text the server can send — acks, sample assets, role-play lines, nudges,
 * validator fallbacks, HONEST_IDENTITY.en, button/list/CTA titles — contains an Arabic letter; and
 * every button title fits WhatsApp's 20 code points in both languages (prompt doc §4). Producers are
 * walked through their real entry points (handleButton over every id and several conversation states,
 * nudgePart over every kind), so a string added later is covered without editing this list.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const acks = require('../src/workflows/shift/acks');
const assets = require('../src/workflows/shift/assets');
const roleplay = require('../src/workflows/shift/roleplay');
const followups = require('../src/workflows/shift/followups');
const validators = require('../src/workflows/shift/validators');
const buttons = require('../src/workflows/shift/buttons');
const hours = require('../src/workflows/shift/hours');

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LANGS = ['ar', 'en'];
const SECTORS = ['clinic', 'restaurant', 'store', 'other'];
const STAGES = ['opening', 'discovery', 'fit', 'sample', 'objection', 'close', 'roleplay_setup', 'roleplay', 'captured', 'handoff', 'closed', 'unknown'];
const NOW = new Date('2026-09-14T08:00:00Z'); // Monday 11:00 Amman
const MAX_TITLE = 20;
const MAX_ROW_TITLE = 24;

const cp = (s) => Array.from(String(s)).length;

/** Every customer-visible string of a part (text, titles, header, footer, rows, CTA), fallbacks included. */
function partStrings(part) {
  if (!part || typeof part !== 'object') return [];
  const out = [];
  if (typeof part.text === 'string') out.push(part.text);
  if (part.header && part.header.type === 'text') out.push(part.header.text);
  if (typeof part.footer === 'string') out.push(part.footer);
  if (typeof part.displayText === 'string') out.push(part.displayText);
  if (typeof part.buttonLabel === 'string') out.push(part.buttonLabel);
  for (const b of part.buttons || []) out.push(b.title);
  for (const s of part.sections || []) {
    if (s.title) out.push(s.title);
    for (const r of s.rows || []) {
      out.push(r.title);
      if (r.description) out.push(r.description);
    }
  }
  if (part.fallback) out.push(...partStrings(part.fallback));
  return out;
}

/** [where, title, max] for every title in a part (button ≤ 20, list row ≤ 24, list label / CTA ≤ 20). */
function partTitles(part, where) {
  if (!part || typeof part !== 'object') return [];
  const out = [];
  for (const b of part.buttons || []) out.push([`${where} button`, b.title, MAX_TITLE]);
  if (typeof part.buttonLabel === 'string') out.push([`${where} list label`, part.buttonLabel, MAX_TITLE]);
  if (typeof part.displayText === 'string') out.push([`${where} cta`, part.displayText, MAX_TITLE]);
  for (const s of part.sections || []) {
    for (const r of s.rows || []) out.push([`${where} row`, r.title, MAX_ROW_TITLE]);
  }
  if (part.fallback) out.push(...partTitles(part.fallback, `${where} fallback`));
  return out;
}

// Customer-typed values in these fixtures are Latin, so any Arabic found in `en` output is server copy.
function conversationFor(stage, { status = 'open', lead = {}, rp = null, samples = null, extra = {} } = {}) {
  return {
    id: 'conv_lang', status, ai_enabled: true, current_state: stage, customer_wa_id: '962790000001',
    last_inbound_at: NOW,
    workflow_data: {
      lead: { name: 'Sam', business_name: 'Noor Boutique', sector: 'store', need: ['night messages'], ...lead },
      ...(rp && { roleplay: rp }),
      ...(samples && { samples_sent: samples }),
      bot_turns: 2,
      ...extra,
    },
  };
}

const RP_ACTIVE = { active: true, sector: 'restaurant', business_name: 'Al Saha', facts: ['shawarma 3'], started_at: NOW.toISOString(), last_turn_at: NOW.toISOString(), turns: 2, setup_asks: 1, ended_at: null, end_reason: null };
const RP_IDLE = { ...RP_ACTIVE, active: false, ended_at: NOW.toISOString(), end_reason: 'idle' };

const BUTTON_IDS = [
  ...SECTORS.flatMap((s) => [`sector:${s}`, `sample_roleplay:${s}`, `sample_page:${s}`, `sample_image:${s}`]),
  'send_sample_now', 'quote_written', 'lead_call', 'end_roleplay', 'roleplay_continue', 'followup_yes', 'followup_no',
  'nudge_not_now', 'slot:other', 'lead_talk', 'slot:2026-09-14T16:00+03:00/18:00',
];

const CONV_STATES = [
  ['fit', conversationFor('fit')],
  ['opening, no sector', conversationFor('opening', { lead: { sector: null, business_name: null, name: null } })],
  ['roleplay_setup', conversationFor('roleplay_setup', { rp: { ...RP_ACTIVE, active: false, setup_asks: 1 } })],
  ['roleplay active', conversationFor('roleplay', { rp: RP_ACTIVE })],
  ['roleplay idle', conversationFor('close', { rp: RP_IDLE })],
  ['sample sent', conversationFor('sample', { samples: { image: 'store', page: null, accepted_at: NOW.toISOString() } })],
  ['locked (pending handoff)', conversationFor('handoff', { status: 'pending', extra: { needs_team: { reason: 'person', at: NOW.toISOString() } } })],
  ['quote pending', conversationFor('close', { status: 'pending', extra: { needs_team: { reason: 'quote', at: NOW.toISOString() } } })],
];

/** Every deterministic part the server can produce, per language: [label, part]. */
function allParts(lang) {
  const out = [];
  const business = { id: 'biz', ai_config: { contact: { phone: '+962790000000', email: 'team@example.test' } } };
  for (const [label, conversation] of CONV_STATES) {
    for (const roleplayOn of [true, false]) {
      for (const vetted of [new Set(), new Set(SECTORS)]) {
        for (const id of BUTTON_IDS) {
          let r;
          try {
            r = buttons.handleButton(id, { business, conversation, now: NOW, lang, messageId: 'wamid.tap', roleplayOn, vetted });
          } catch (err) {
            throw new Error(`handleButton(${id}) in ${label} threw: ${err.message}`);
          }
          for (const part of (r && r.messages) || []) out.push([`tap ${id} (${label}, roleplay ${roleplayOn}, vetted ${vetted.size})`, part]);
        }
      }
    }
  }
  const nudgeKinds = ['stage', 'sample_touch', 'roleplay_resume', 'close_declined', 'no_contact'];
  for (const sector of [...SECTORS, null]) {
    for (const kind of nudgeKinds) {
      for (const conversation of [
        conversationFor('fit', { lead: { sector }, rp: RP_IDLE }),
        conversationFor('sample', { lead: { sector, name: null, need: [] } }),
        conversationFor('discovery', { lead: { sector, name: null, business_name: null, need: [] } }),
      ]) {
        out.push([`nudge ${kind} ${sector} ${conversation.current_state}`, followups.nudgePart(conversation, { kind, stage: conversation.current_state }, lang)]);
      }
    }
  }
  for (const sector of SECTORS) {
    for (const roleplayOn of [true, false]) {
      out.push([`sampleCard ${sector} ${roleplayOn}`, assets.sampleCard(sector, lang, { sectorText: 'barber shop', roleplayOn })]);
      out.push([`pageFollowUp ${sector} ${roleplayOn}`, assets.pageFollowUp(sector, lang, { roleplayOn })]);
    }
    out.push([`pagePart ${sector}`, assets.pagePart(sector, lang)]);
    out.push([`imagePart ${sector}`, assets.imagePart(sector, lang, { sectorText: 'barber shop' })]);
  }
  out.push(['sectorListPart', acks.sectorListPart(lang, { disclosed: false })]);
  out.push(['sectorListPart disclosed', acks.sectorListPart(lang, { disclosed: true })]);
  out.push(['consent buttons', { type: 'interactive', text: acks.consentAsk(lang), buttons: acks.consentButtons(lang) }]);
  for (const offer of [0, 1]) {
    const at = new Date(NOW.getTime() + offer * 9 * 60 * 60 * 1000);
    out.push([`slotOffers ${offer}`, { type: 'interactive', text: acks.slotsBody(lang), buttons: buttons.slotOffers(hours.DEFAULT_TEAM_HOURS, at, lang) }]);
  }
  return out;
}

/** Every fixed text that is not a part on its own. */
function allTexts(lang) {
  const th = hours.DEFAULT_TEAM_HOURS;
  const out = [];
  const push = (label, value) => out.push([label, value]);
  const afterHours = new Date('2026-09-14T17:00:00Z');
  for (const at of [NOW, afterHours, new Date('2026-09-17T17:00:00Z')]) {
    push(`handoffAck ${at.toISOString()}`, acks.handoffAck({ teamHours: th, contact: { phone: '+962790000000', email: 'team@example.test' }, now: at, lang }));
    push(`openingWords ${at.toISOString()}`, acks.openingWords(th, at, lang));
  }
  push('handoffLead', acks.handoffLead(lang));
  push('handoffRepeat', acks.handoffRepeat(lang));
  for (const reason of ['quote', 'meeting', 'other']) push(`flagAck ${reason}`, acks.flagAck(reason, { teamHours: th, lang }));
  push('captureAck', acks.captureAck({ name: 'Sam', businessName: 'Noor Boutique', when: 'tomorrow after 4', lang }));
  push('captureRelayed', acks.captureRelayed({ when: 'tomorrow after 4', lang }));
  push('captureRelayed empty', acks.captureRelayed({ lang }));
  for (const nameKnown of [true, false]) {
    for (const businessKnown of [true, false]) {
      for (const sector of SECTORS) push(`captureAsk ${nameKnown} ${businessKnown} ${sector}`, acks.captureAsk({ nameKnown, businessKnown, sector, lang }));
    }
  }
  push('purposeLine', acks.purposeLine(lang));
  push('slotOther', acks.slotOther(lang));
  push('expiredSlot', acks.expiredSlot(lang));
  push('aiFailure', acks.aiFailure(lang));
  push('aiFailure buttons', acks.aiFailure(lang, { withButtons: true }));
  push('optOut', acks.optOut(lang));
  push('notNow', acks.notNow(lang));
  push('claimAck', acks.claimAck({ lang }));
  push('slaNote', acks.slaNote(lang));
  push('awaitingStaffNote', acks.awaitingStaffNote({ lang }));
  for (const type of ['audio', 'image', 'video', 'document', 'sticker', 'unknown']) {
    push(`media ${type}`, acks.media(type, lang));
    push(`mediaPrefix ${type}`, acks.mediaPrefix(type, lang));
    push(`mediaPrefix captioned ${type}`, acks.mediaPrefix(type, lang, { captioned: true }));
    push(`mediaTranscribedPrefix ${type}`, acks.mediaTranscribedPrefix(type, lang));
  }
  push('windowText', acks.windowText({ start: '2026-09-15T07:00:00Z', end: '2026-09-15T09:00:00Z' }, NOW, th.tz, lang));
  push('sectorTextAsk', acks.sectorTextAsk(lang));
  for (const s of [...SECTORS, 'unknown']) push(`sectorAck ${s}`, acks.sectorAck(s, lang));
  push('consentYes', acks.consentYes(lang));
  push('consentNo', acks.consentNo(lang));
  push('quoteWrittenLead', acks.quoteWrittenLead(lang));
  push('callChoiceLead', acks.callChoiceLead(lang));
  push('roleplayContinue', acks.roleplayContinue(lang));
  push('sampleAlreadySent', acks.sampleAlreadySent(lang));
  for (const s of [...SECTORS, 'unknown']) {
    push(`setupAsk ${s}`, roleplay.setupAsk(s, lang));
    push(`endLine ${s}`, roleplay.endLine(s, lang));
  }
  push('startLine', roleplay.startLine('Al Saha', lang));
  for (const stage of STAGES) {
    for (const disclosed of [true, false]) {
      for (const sector of SECTORS) push(`stageFallback ${stage} ${disclosed} ${sector}`, validators.stageFallback(stage, lang, { disclosed, sector }));
    }
  }
  push('HONEST_IDENTITY', validators.HONEST_IDENTITY[lang]);
  return out;
}

describe('lang=en: no Arabic letters in any deterministic producer (G14)', () => {
  test('every part the server can build (taps in every state, nudges, samples, lists, slots)', () => {
    const offenders = allParts('en')
      .flatMap(([label, part]) => partStrings(part).filter((s) => ARABIC.test(s)).map((s) => `${label}: ${s}`));
    expect(offenders).toEqual([]);
  });

  test('every fixed text (acks, role-play lines, validator fallbacks, HONEST_IDENTITY.en)', () => {
    const offenders = allTexts('en').filter(([, s]) => typeof s !== 'string' || ARABIC.test(s)).map(([label, s]) => `${label}: ${s}`);
    expect(offenders).toEqual([]);
  });

  test('static nudge titles', () => {
    const en = followups.staticTitles().filter((t) => !ARABIC.test(t));
    expect(en.length).toBeGreaterThan(0);
    for (const kind of ['stage', 'sample_touch', 'roleplay_resume', 'close_declined']) {
      const part = followups.nudgePart(conversationFor('fit', { rp: RP_IDLE }), { kind, stage: 'fit' }, 'en');
      for (const b of part.buttons) expect(en).toContain(b.title);
    }
  });

  // The walk must actually reach the PR2 part types, or a green result would mean nothing.
  test('the walk covers text, interactive, list, cta_url and image parts', () => {
    const types = new Set(allParts('en').map(([, p]) => p.type));
    expect([...types].sort()).toEqual(expect.arrayContaining(['cta_url', 'image', 'interactive', 'list', 'text']));
  });
});

describe('lang=ar: server copy is Arabic script', () => {
  test('taps, nudges and samples in ar carry Arabic text', () => {
    const latinOnly = allParts('ar')
      .filter(([, part]) => typeof part.text === 'string' && part.text.trim() && !ARABIC.test(part.text))
      .map(([label, part]) => `${label}: ${part.text}`);
    expect(latinOnly).toEqual([]);
  });
});

describe('every button title ≤ 20 code points in both languages (list rows ≤ 24)', () => {
  test.each(LANGS)('%s', (lang) => {
    const tooLong = allParts(lang)
      .flatMap(([label, part]) => partTitles(part, label))
      .filter(([, title, max]) => cp(title) < 1 || cp(title) > max)
      .map(([where, title, max]) => `${where}: "${title}" (${cp(title)} > ${max})`);
    expect(tooLong).toEqual([]);
  });

  test('followups.staticTitles and the consent buttons', () => {
    for (const t of followups.staticTitles()) expect([t, cp(t) <= MAX_TITLE]).toEqual([t, true]);
    for (const lang of LANGS) for (const b of acks.consentButtons(lang)) expect(cp(b.title)).toBeLessThanOrEqual(MAX_TITLE);
  });

  test('slot titles over a fortnight in 30-minute steps', () => {
    const base = Date.UTC(2026, 8, 13, 0, 0);
    for (let step = 0; step < 14 * 48; step += 1) {
      const now = new Date(base + step * 30 * 60 * 1000);
      for (const lang of LANGS) {
        for (const offer of buttons.slotOffers(hours.DEFAULT_TEAM_HOURS, now, lang)) {
          expect(cp(offer.title)).toBeLessThanOrEqual(MAX_TITLE);
          if (lang === 'en') expect(offer.title).not.toMatch(ARABIC);
        }
      }
    }
  });

  test('buttons.assertButtons passes over the same copy', () => {
    expect(() => buttons.assertButtons()).not.toThrow();
  });
});
