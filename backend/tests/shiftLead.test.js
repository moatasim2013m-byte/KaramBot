require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const db = require('./helpers/fakeDb').getFakeDb();
const {
  mergeLead, extractCustomerNumbers, isCorrection, computeScore, saveLead,
} = require('../src/workflows/shift/lead');

const AT = '2026-09-14T08:00:00.000Z';
const model = (inboundText = '', msgId = 'm1') => ({ source: 'model', msgId, at: AT, inboundText });
const staff = { source: 'staff', msgId: 'ignored', at: AT };

beforeEach(() => db.reset());

describe('mergeLead — scalars', () => {
  test('fills empty fields, records _prov and bumps version once', () => {
    const { lead, changed } = mergeLead({}, { name: '  محمد  ', business_name: 'عيادة الشفاء', city: 'إربد' }, model('أنا محمد', 'wamid.1'));

    expect(lead).toMatchObject({ name: 'محمد', business_name: 'عيادة الشفاء', city: 'إربد', version: 1 });
    expect(changed.sort()).toEqual(['business_name', 'city', 'name']);
    expect(lead._prov.name).toEqual({ source: 'model', source_msg_id: 'wamid.1', at: AT, confirmed: true });
    expect(lead.score).toBeUndefined();
  });

  test('does not mutate the existing lead', () => {
    const existing = { name: 'سارة', version: 1, _prov: { name: { source: 'model', confirmed: true } } };
    const snapshot = JSON.stringify(existing);
    mergeLead(existing, { city: 'عمّان' }, model());
    expect(JSON.stringify(existing)).toBe(snapshot);
  });

  test('skips undefined, null, empty strings and invalid enums; nothing changed → no version bump', () => {
    const existing = { name: 'سارة', version: 4 };
    const { lead, changed } = mergeLead(existing, {
      name: '', city: null, business_name: undefined, sector: 'gym', language: 'fr', interest: 'boiling', need: [],
    }, model());
    expect(changed).toEqual([]);
    expect(lead.version).toBe(4);
  });

  test('normalises sector, cuts long strings to 200 code points, preferred_time string → {text}', () => {
    const long = 'ع'.repeat(250);
    const { lead } = mergeLead({}, { sector: 'Clinic', sector_text: long, preferred_time: 'بكرا الصبح' }, model());
    expect(lead.sector).toBe('clinic');
    expect(Array.from(lead.sector_text)).toHaveLength(200);
    expect(lead.preferred_time).toEqual({ text: 'بكرا الصبح' });

    const picked = mergeLead({}, {
      preferred_time: { text: 'بكرا 10–12', start: '2026-09-15T07:00:00.000Z', slot_id: 'slot:x', junk: 1 },
    }, { ...model(), source: 'button' }).lead;
    expect(picked.preferred_time).toEqual({ text: 'بكرا 10–12', start: '2026-09-15T07:00:00.000Z', slot_id: 'slot:x' });
  });

  test('a confirmed value is kept on a passing mention', () => {
    const existing = { city: 'إربد', version: 1, _prov: { city: { source: 'model', confirmed: true } } };
    const { lead, changed } = mergeLead(existing, { city: 'عمّان' }, model('عندي فرع بعمّان'));
    expect(lead.city).toBe('إربد');
    expect(changed).toEqual([]);
  });

  test('an explicit correction replaces a confirmed value', () => {
    const existing = { city: 'عمّان', version: 1, _prov: { city: { source: 'model', confirmed: true } } };
    const { lead, changed } = mergeLead(existing, { city: 'إربد' }, model('مش عمّان، إربد', 'm2'));
    expect(lead.city).toBe('إربد');
    expect(changed).toEqual(['city']);
    expect(lead._prov.city.source_msg_id).toBe('m2');
    expect(lead.version).toBe(2);
  });

  test('an inferred value (confirmed false) is overwritten by the model', () => {
    const existing = { name: 'x', version: 1, _prov: { name: { source: 'referral', confirmed: false } } };
    expect(mergeLead(existing, { name: 'ليلى' }, model()).lead.name).toBe('ليلى');
  });

  test('staff edit wins and a later model patch cannot overwrite it', () => {
    const existing = { city: 'عمّان', version: 1, _prov: { city: { source: 'model', confirmed: true } } };
    const edited = mergeLead(existing, { city: 'الزرقاء' }, staff).lead;
    expect(edited.city).toBe('الزرقاء');
    expect(edited._prov.city).toEqual({ source: 'staff', source_msg_id: null, at: AT, confirmed: true });

    // even with correction wording, the bot never overrides staff
    const later = mergeLead(edited, { city: 'إربد' }, model('لا مش الزرقاء، إربد'));
    expect(later.lead.city).toBe('الزرقاء');
    expect(later.changed).toEqual([]);
  });

  test('referral source never overwrites; first touch wins', () => {
    const existing = { source: { type: 'ctwa', confidence: 'confirmed' }, version: 1 };
    const r = mergeLead(existing, { source: { type: 'site', confidence: 'inferred' } }, { source: 'referral', at: AT });
    expect(r.lead.source).toEqual({ type: 'ctwa', confidence: 'confirmed' });
    expect(r.changed).toEqual([]);

    const first = mergeLead({}, { source: { type: 'ctwa', referral: { ctwa_clid: 'abc' } } }, { source: 'referral', at: AT });
    expect(first.lead.source).toEqual({ type: 'ctwa', referral: { ctwa_clid: 'abc' } });
    expect(first.lead._prov.source.confirmed).toBe(false);

    // a string source is not an object → dropped
    expect(mergeLead({}, { source: 'ctwa' }, model()).changed).toEqual([]);
  });
});

describe('mergeLead — arrays and numbers', () => {
  test('need and objections append and de-duplicate; objection → objections', () => {
    const existing = { need: ['حجز مواعيد'], objections: ['staff'], version: 1 };
    const { lead, changed } = mergeLead(existing, {
      need: ['  حجز   مواعيد ', 'رد على الأسعار'],
      objection: 'price',
    }, model());
    expect(lead.need).toEqual(['حجز مواعيد', 'رد على الأسعار']);
    expect(lead.objections).toEqual(['staff', 'price']);
    expect(changed.sort()).toEqual(['need', 'objections']);

    expect(mergeLead({}, { objection: 'price' }, model()).lead.objections).toEqual(['price']);
    expect(mergeLead({}, { objection: 'too expensive' }, model()).changed).toEqual([]);
    expect(mergeLead({}, { need: 'تذكير المرضى' }, model()).lead.need).toEqual(['تذكير المرضى']);
  });

  test('caps: need 5, products keep only known keys', () => {
    const { lead } = mergeLead({}, {
      need: ['1a', '2a', '3a', '4a', '5a', '6a'],
      products: ['karam', 'crm', 'Loyalty', 'karam'],
    }, model());
    expect(lead.need).toHaveLength(5);
    expect(lead.products).toEqual(['karam', 'loyalty']);
  });

  test('staff replaces arrays', () => {
    const { lead } = mergeLead({ need: ['a', 'b'], version: 2 }, { need: ['c'] }, staff);
    expect(lead.need).toEqual(['c']);
  });

  test('customer_numbers come from inbound text only, never from the patch', () => {
    const { lead, changed } = mergeLead({}, { customer_numbers: ['999'], budget_note: '50 دينار' }, model('ميزانيتي ٥٠ دينار'));
    expect(lead.customer_numbers).toEqual(['50']);
    expect(changed).toContain('customer_numbers');

    const fromStaff = mergeLead({}, { customer_numbers: ['7'] }, { ...staff, inboundText: 'عندي 3 فروع' });
    expect(fromStaff.lead.customer_numbers).toBeUndefined();

    const merged = mergeLead({ customer_numbers: ['50'], version: 1 }, {}, model('50 أو 60.5'));
    expect(merged.lead.customer_numbers).toEqual(['50', '60.5']);
  });

  test('site_estimates is never written', () => {
    const { lead, changed } = mergeLead({ site_estimates: [{ n: 1 }] }, { site_estimates: [{ n: 2 }] }, model());
    expect(lead.site_estimates).toEqual([{ n: 1 }]);
    expect(changed).toEqual([]);
  });
});

describe('pure helpers', () => {
  test('extractCustomerNumbers maps Arabic-Indic and Persian digits and de-duplicates', () => {
    expect(extractCustomerNumbers('ميزانيتي ٥٠ دينار')).toEqual(['50']);
    expect(extractCustomerNumbers('۳ فروع و 3 موظفين، 2,5 ساعة')).toEqual(['3', '2,5']);
    expect(extractCustomerNumbers('')).toEqual([]);
    expect(extractCustomerNumbers(null)).toEqual([]);
  });

  test('isCorrection fixtures', () => {
    expect(isCorrection('مش عمّان، إربد', 'إربد')).toBe(true);
    expect(isCorrection('عندي فرع بعمّان', 'عمّان')).toBe(false);
    expect(isCorrection('لا قصدي الزرقاء', 'الزرقاء')).toBe(true);
    expect(isCorrection('sorry, I meant Irbid', 'irbid')).toBe(true);
    expect(isCorrection('مش عمّان، إربد', 'الزرقاء')).toBe(false); // correction wording, but not this value
    expect(isCorrection('مش عمان، إربد', { text: 'إربد' })).toBe(true);
  });

  test('computeScore deltas', () => {
    expect(computeScore({}, {})).toBe(0);
    expect(computeScore({ objections: ['price'] })).toBe(3);
    expect(computeScore({}, { needs_team: { reason: 'quote' } })).toBe(3);
    expect(computeScore({ preferred_time: { text: 'بكرا' } })).toBe(3);
    expect(computeScore({ preferred_time: { start: AT } })).toBe(3);
    expect(computeScore({ business_name: 'مطعم' })).toBe(2);
    expect(computeScore({ source: { type: 'ctwa' } })).toBe(1);
    expect(computeScore({}, { not_now_at: AT })).toBe(-2);
    expect(computeScore({}, { marketing_opted_out_at: AT })).toBe(-5);
    expect(computeScore(
      { objections: ['price'], preferred_time: { text: 'x' }, business_name: 'y', source: { type: 'ctwa' } },
      { needs_team: { reason: 'quote' } },
    )).toBe(9);
  });
});

describe('saveLead (fakeDb)', () => {
  function seed(workflow_data = {}) {
    const { conversations: [conv] } = db.seed({
      conversations: [{ id: 'c1', business_id: 'b1', customer_wa_id: '962790000001', workflow_data }],
    });
    return conv;
  }

  test('writes the merged lead with score, keeps workflow_data siblings', async () => {
    seed({ needs_team: { reason: 'quote', resolved_at: null }, bot_turns: 3 });
    const r = await saveLead('c1', { business_name: 'مطعم السنابل' }, model('عندي مطعم السنابل'));

    expect(r).toMatchObject({ ok: true, changed: ['business_name'], previousScore: 0 });
    expect(r.lead).toMatchObject({ business_name: 'مطعم السنابل', version: 1, score: 5 });
    const wd = db.store.conversations[0].workflow_data;
    expect(wd.lead).toEqual(r.lead);
    expect(wd.needs_team).toEqual({ reason: 'quote', resolved_at: null });
    expect(wd.bot_turns).toBe(3);
  });

  test('nothing changed → no write, current lead returned', async () => {
    seed({ lead: { name: 'سارة', version: 2, score: 4 } });
    const spy = jest.spyOn(db.jsonb, 'patchJson');
    const r = await saveLead('c1', { name: 'سارة' }, model());
    expect(r).toEqual({ ok: true, lead: { name: 'سارة', version: 2, score: 4 }, changed: [], previousScore: 4 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('retries once on a version race and merges on top of the winner', async () => {
    seed({ lead: { name: 'سارة', version: 1 } });
    const original = db.jsonb.patchJson;
    let raced = false;
    const spy = jest.spyOn(db.jsonb, 'patchJson').mockImplementation(async (...args) => {
      if (!raced) {
        raced = true;
        // a concurrent writer lands between our read and our write
        db.store.conversations[0].workflow_data = { lead: { name: 'سارة', city: 'إربد', version: 2 } };
      }
      return original(...args);
    });

    const r = await saveLead('c1', { business_name: 'صالون ليلى' }, model());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(true);
    expect(r.lead).toMatchObject({ name: 'سارة', city: 'إربد', business_name: 'صالون ليلى', version: 3 });
    expect(db.store.conversations[0].workflow_data.lead.version).toBe(3);
    spy.mockRestore();
  });

  test('two lost races → ok false, lead null, warning', async () => {
    seed({ lead: { version: 1 } });
    const original = db.jsonb.patchJson;
    const spy = jest.spyOn(db.jsonb, 'patchJson').mockImplementation(async (...args) => {
      const lead = db.store.conversations[0].workflow_data.lead;
      db.store.conversations[0].workflow_data = { lead: { ...lead, version: lead.version + 1 } };
      return original(...args);
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const r = await saveLead('c1', { name: 'ليلى' }, model());
    expect(r).toEqual({ ok: false, lead: null, changed: [] });
    expect(warn).toHaveBeenCalledWith('[lead] version conflict twice', 'c1');
    spy.mockRestore();
    warn.mockRestore();
  });

  test('expectedVersion mismatch → conflict without writing', async () => {
    seed({ lead: { name: 'سارة', version: 3 } });
    const r = await saveLead('c1', { name: 'ليلى' }, staff, { expectedVersion: 2 });
    expect(r).toEqual({ ok: false, conflict: true, lead: { name: 'سارة', version: 3 }, changed: [] });
    expect(db.store.conversations[0].workflow_data.lead.name).toBe('سارة');
  });

  test('expectedVersion race at write time → conflict, no silent retry', async () => {
    seed({ lead: { name: 'سارة', version: 3 } });
    const original = db.jsonb.patchJson;
    const spy = jest.spyOn(db.jsonb, 'patchJson').mockImplementation(async (...args) => {
      db.store.conversations[0].workflow_data = { lead: { name: 'سارة', version: 4 } };
      return original(...args);
    });
    const r = await saveLead('c1', { name: 'ليلى' }, staff, { expectedVersion: 3 });
    expect(r).toMatchObject({ ok: false, conflict: true, changed: [] });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  test('staff edit with the right expectedVersion is written as staff-owned', async () => {
    seed({ lead: { city: 'عمّان', version: 1, _prov: { city: { source: 'model', confirmed: true } } } });
    const r = await saveLead('c1', { city: 'إربد' }, staff, { expectedVersion: 1 });
    expect(r.ok).toBe(true);
    expect(db.store.conversations[0].workflow_data.lead._prov.city.source).toBe('staff');

    const later = await saveLead('c1', { city: 'الزرقاء' }, model('مش إربد، الزرقاء'));
    expect(later.changed).toEqual([]);
    expect(db.store.conversations[0].workflow_data.lead.city).toBe('إربد');
  });

  test('missing conversation → the write matches nothing and reports a double conflict', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await saveLead('nope', { name: 'x' }, model());
    expect(r.ok).toBe(false);
    warn.mockRestore();
  });

  test('DB errors propagate', async () => {
    seed();
    db.failNext('conversation.findUnique', Object.assign(new Error('down'), { code: 'P1001' }));
    await expect(saveLead('c1', { name: 'x' }, model())).rejects.toMatchObject({ code: 'P1001' });
  });
});
