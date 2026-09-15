/**
 * shift/assets.js — sector samples (contract §7.1, D11).
 */
require('./setup');

const assets = require('../src/workflows/shift/assets');
const wa = require('../src/services/whatsapp');
const { SITE_URL, SITE_HOST } = require('../src/config/site');

const OLD_HOST = ['shifts-ai', 'store'].join('.');
const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;
const cp = (s) => Array.from(s).length;
const SECTORS = assets.SAMPLE_SECTORS;
const LANGS = ['ar', 'en'];

// Same allow-list as validators §5.7 (k): host, then path without query/fragment, query keys only utm_*.
const ALLOWED_PATHS = ['', '/', '/clinics', '/restaurants', '/online-stores', '/privacy', '/en', '/en/', '/en/clinics', '/en/restaurants', '/en/online-stores'];
function allowedLink(url) {
  const u = new URL(url);
  const hostOk = u.host === SITE_HOST || u.host === `www.${SITE_HOST}`;
  const path = u.pathname === '/' && !url.replace(/[?#].*$/, '').endsWith('/') ? '' : u.pathname;
  const queryOk = [...u.searchParams.keys()].every((k) => k.startsWith('utm_'));
  return hostOk && ALLOWED_PATHS.includes(path) && queryOk;
}

const ENV_KEYS = ['SHIFT_SAMPLES_BASE', 'SHIFT_SAMPLES_VETTED', 'SHIFT_ROLEPLAY', 'SHIFT_PROMPT_V1'];
beforeEach(() => ENV_KEYS.forEach((k) => delete process.env[k]));
afterAll(() => ENV_KEYS.forEach((k) => delete process.env[k]));

function allParts() {
  const parts = [];
  for (const s of SECTORS) {
    for (const lang of LANGS) {
      for (const roleplayOn of [true, false]) {
        parts.push(assets.sampleCard(s, lang, { roleplayOn }));
        parts.push(assets.pageFollowUp(s, lang, { roleplayOn }));
      }
      parts.push(assets.pagePart(s, lang));
      parts.push(assets.imagePart(s, lang));
    }
  }
  return parts;
}

// Customer-visible strings of a part, with the language they are written in.
function visibleStrings(part) {
  const out = [part.text, part.footer, part.displayText, part.header && part.header.text];
  for (const b of part.buttons || []) out.push(b.title);
  return out.filter((x) => typeof x === 'string');
}

describe('titles and limits', () => {
  test('every title ≤ 20 code points and every part passes Graph limits, both languages and role-play modes', () => {
    for (const part of allParts()) {
      for (const b of part.buttons || []) expect(cp(b.title)).toBeLessThanOrEqual(20);
      expect(() => wa.assertStructuredLimits(part)).not.toThrow();
      if (part.fallback) expect(() => wa.assertStructuredLimits(part.fallback)).not.toThrow();
    }
  });

  test('buttons per mode', () => {
    expect(assets.sampleCard('restaurant', 'ar', { roleplayOn: true }).buttons).toEqual([
      { id: 'sample_roleplay:restaurant', title: 'جرّبه كزبون' },
      { id: 'sample_page:restaurant', title: 'افتح صفحة المطاعم' },
      { id: 'lead_talk', title: 'احكي مع الفريق' },
    ]);
    expect(assets.sampleCard('clinic', 'ar', { roleplayOn: true }).buttons[0]).toEqual({ id: 'sample_roleplay:clinic', title: 'جرّبه كمراجع' });
    expect(assets.sampleCard('clinic', 'en', { roleplayOn: true }).buttons.map((b) => b.title)).toEqual(['Try it as a patient', 'Clinics page', 'Talk to the team']);
    expect(assets.sampleCard('other', 'ar', { roleplayOn: true }).buttons[1]).toEqual({ id: 'sample_page:other', title: 'افتح الموقع' });
    expect(assets.sampleCard('store', 'ar', { roleplayOn: false }).buttons).toEqual([
      { id: 'sample_page:store', title: 'افتح صفحة المتاجر' },
      { id: 'quote_written', title: 'عرض مكتوب' },
      { id: 'lead_talk', title: 'احكي مع الفريق' },
    ]);
    expect(assets.sampleCard('store', 'en', { roleplayOn: false }).buttons.map((b) => b.title)).toEqual(['Stores page', 'Written quote', 'Talk to the team']);
  });

  test('roleplayOn is required', () => {
    expect(() => assets.sampleCard('clinic', 'ar')).toThrow(TypeError);
    expect(() => assets.sampleCard('clinic', 'ar', { roleplayOn: 'yes' })).toThrow(TypeError);
  });
});

describe('copy honesty (G12, G13)', () => {
  test('no digits in bodies except clock times before «بالليل» / "pm"', () => {
    for (const part of allParts()) {
      for (const text of visibleStrings(part)) {
        const withoutClock = text.replace(/\b\d{1,2}\b(?=\s*(بالليل|pm))/g, '');
        expect(withoutClock).not.toMatch(/[0-9٠-٩]/);
      }
    }
  });

  test('sample bodies are labelled as illustrative in both languages', () => {
    for (const s of SECTORS) {
      expect(assets.sampleCard(s, 'ar', { roleplayOn: true }).text).toContain('مثال توضيحي');
      expect(assets.sampleCard(s, 'en', { roleplayOn: true }).text).toContain('Illustrative example');
      expect(assets.sampleCard(s, 'ar', { roleplayOn: true }).footer).toBe('مثال توضيحي · شِفت');
      expect(assets.sampleCard(s, 'en', { roleplayOn: true }).footer).toBe('Illustrative example · SHIFT');
      expect(assets.imagePart(s, 'ar').text).toContain('مثال توضيحي');
    }
  });

  test('ar strings have no Latin letters except SITE_HOST; en strings have no Arabic letters', () => {
    for (const s of SECTORS) {
      for (const roleplayOn of [true, false]) {
        const arParts = [assets.sampleCard(s, 'ar', { roleplayOn }), assets.pagePart(s, 'ar'), assets.pageFollowUp(s, 'ar', { roleplayOn }), assets.imagePart(s, 'ar')];
        const enParts = [assets.sampleCard(s, 'en', { roleplayOn }), assets.pagePart(s, 'en'), assets.pageFollowUp(s, 'en', { roleplayOn }), assets.imagePart(s, 'en')];
        for (const text of arParts.flatMap(visibleStrings)) {
          expect(text.split(SITE_HOST).join('')).not.toMatch(LATIN);
          expect(text).not.toContain('هنا');
        }
        for (const text of enParts.flatMap(visibleStrings)) expect(text).not.toMatch(ARABIC);
      }
    }
  });

  test('the design §4 bodies verbatim', () => {
    expect(assets.sampleCard('restaurant', 'ar', { roleplayOn: true }).text).toBe(
      'مثال توضيحي (مش زبون حقيقي) 👇 كافيه زيتون، الساعة 11 بالليل: زبون بيسأل عن التوصيل، كرم بيرد من المنيو وبياخد الطلب، والصبح صاحب الكافيه بيلاقي تقرير بكل شي صار. بدك تشوفه شغّال على مطعمك أنت؟',
    );
    expect(assets.sampleCard('clinic', 'en', { roleplayOn: true }).text).toBe(
      "Illustrative example 👇 Dr. Rana's clinic, 11 pm: a patient asks for an appointment, Karam offers free slots from the calendar, confirms, sends a reminder; special cases go to reception. Want to see it on your clinic?",
    );
    expect(assets.pagePart('restaurant', 'ar')).toMatchObject({
      type: 'cta_url',
      header: { type: 'text', text: 'كرم للمطاعم' },
      text: 'صفحة المطاعم فيها محاكاة كاملة لمحادثة طلب، وتقدر تغيّر اسم المطعم فيها. بتفتح بالمتصفح.',
      footer: 'شِفت · إربد',
      displayText: 'افتح الصفحة',
      serverButtons: true,
    });
  });

  test('the other body uses the customer word or «شغلك» / "business"', () => {
    expect(assets.sampleCard('other', 'ar', { roleplayOn: true }).text).toMatch(/شغّال على شغلك؟$/);
    expect(assets.sampleCard('other', 'ar', { roleplayOn: true, sectorText: 'صالون حلاقة' }).text).toMatch(/شغّال على صالون حلاقة؟$/);
    expect(assets.sampleCard('other', 'en', { roleplayOn: true }).text).toMatch(/on your business\?$/);
    expect(assets.sampleCard('other', 'en', { roleplayOn: true, sectorText: 'gym' }).text).toMatch(/on your gym\?$/);
    const long = assets.sampleCard('other', 'ar', { roleplayOn: true, sectorText: `جيم\n${'ا'.repeat(100)}` }).text;
    expect(long).not.toContain('\n');
    expect(long).not.toContain('{sectorText}');
  });
});

describe('the sample card (§4.2)', () => {
  test('image header, footer, serverButtons and a header-less fallback', () => {
    const card = assets.sampleCard('restaurant', 'ar', { roleplayOn: true });
    expect(card).toMatchObject({
      type: 'interactive',
      header: { type: 'image', image: { link: `${SITE_URL}/assets/samples/restaurant-square-v1.png` } },
      footer: 'مثال توضيحي · شِفت',
      serverButtons: true,
    });
    expect(card.fallback).toEqual({ type: 'interactive', text: card.text, footer: card.footer, buttons: card.buttons, serverButtons: true });
    expect(card.fallback).not.toHaveProperty('header');
    expect(wa.buildButtonsPayload('9627XXXXXXXX', card, { callbackData: 'intent' }).interactive.header)
      .toEqual({ type: 'image', image: { link: 'https://shifts-ai.com/assets/samples/restaurant-square-v1.png' } });
  });

  test('imagePart is a plain labelled image whose fallback is the page link, never a detached caption', () => {
    const part = assets.imagePart('clinic', 'ar');
    expect(part).toMatchObject({ type: 'image', image: { link: `${SITE_URL}/assets/samples/clinic-square-v1.png` } });
    expect(part.fallback).toEqual(assets.pagePart('clinic', 'ar'));
  });
});

describe('URLs', () => {
  test('SHIFT_SAMPLES_BASE override with a trailing slash; unknown sector → other', () => {
    expect(assets.sampleImageUrl('clinic')).toBe('https://shifts-ai.com/assets/samples/clinic-square-v1.png');
    process.env.SHIFT_SAMPLES_BASE = 'https://cdn.example.com/samples///';
    expect(assets.sampleImageUrl('store')).toBe('https://cdn.example.com/samples/store-square-v1.png');
    expect(assets.sampleCard('store', 'en', { roleplayOn: true }).header.image.link).toBe('https://cdn.example.com/samples/store-square-v1.png');
    expect(assets.sampleImageUrl('bakery')).toBe('https://cdn.example.com/samples/other-square-v1.png');
  });

  test('sector page URLs per language', () => {
    expect(assets.sectorPageUrl('restaurant', 'ar')).toBe('https://shifts-ai.com/restaurants?utm_source=wa&utm_medium=bot&utm_campaign=karam-restaurant');
    expect(assets.sectorPageUrl('clinic', 'en')).toBe('https://shifts-ai.com/en/clinics?utm_source=wa&utm_medium=bot&utm_campaign=karam-clinic');
    expect(assets.sectorPageUrl('store', 'ar')).toBe('https://shifts-ai.com/online-stores?utm_source=wa&utm_medium=bot&utm_campaign=karam-store');
    expect(assets.sectorPageUrl('other', 'ar')).toBe('https://shifts-ai.com/?utm_source=wa&utm_medium=bot&utm_campaign=karam-other');
    expect(assets.sectorPageUrl('other', 'en')).toBe('https://shifts-ai.com/en?utm_source=wa&utm_medium=bot&utm_campaign=karam-other');
  });

  test('every URL starts with SITE_URL and passes the §5.7 allow-list; the old host never appears', () => {
    for (const s of SECTORS) {
      for (const lang of LANGS) {
        const url = assets.pagePart(s, lang).url;
        expect(url.startsWith(SITE_URL)).toBe(true);
        expect(allowedLink(url)).toBe(true);
        expect(assets.sampleImageUrl(s).startsWith(SITE_URL)).toBe(true);
      }
    }
    expect(JSON.stringify(allParts())).not.toContain(OLD_HOST);
    expect(JSON.stringify(assets.REGISTRY)).not.toContain(OLD_HOST);
  });
});

describe('vetted sectors (D11)', () => {
  test('ai_config ∪ env, filtered to the four sectors', () => {
    const business = { ai_config: { samples_vetted: ['clinic', ' Restaurant ', 'bakery', 7] } };
    expect([...assets.vettedSectors(business, {})].sort()).toEqual(['clinic', 'restaurant']);
    expect([...assets.vettedSectors(business, { SHIFT_SAMPLES_VETTED: 'store, other,,nope' })].sort()).toEqual(['clinic', 'other', 'restaurant', 'store']);
    expect([...assets.vettedSectors({}, {})]).toEqual([]);
    expect([...assets.vettedSectors(null, { SHIFT_SAMPLES_VETTED: 'clinic' })]).toEqual(['clinic']);
    expect([...assets.vettedSectors({ ai_config: { samples_vetted: 'store' } }, {})]).toEqual(['store']);
  });

  test('isVetted reads the env at call time', () => {
    const business = { ai_config: {} };
    expect(assets.isVetted(business, 'clinic')).toBe(false);
    process.env.SHIFT_SAMPLES_VETTED = 'clinic';
    expect(assets.isVetted(business, 'clinic')).toBe(true);
    expect(assets.isVetted(business, 'store')).toBe(false);
    expect(assets.isVetted(business, undefined)).toBe(false);
  });
});

describe('page follow-up', () => {
  test('texts, delay and the role-play-off wording', () => {
    expect(assets.pageFollowUp('restaurant', 'ar', { roleplayOn: true })).toEqual({ type: 'text', text: 'لما ترجع، اكتبلي "جرّبني" وبصير كرم تبع مطعمك هون.', delayMs: 1000 });
    expect(assets.pageFollowUp('other', 'ar', { roleplayOn: true }).text).toBe('لما ترجع، اكتبلي "جرّبني" وبصير كرم تبع شغلك هون.');
    expect(assets.pageFollowUp('clinic', 'en', { roleplayOn: true }).text).toBe('When you\'re back, type "try me" and I\'ll be your clinic\'s Karam here.');
    expect(assets.pageFollowUp('clinic', 'ar', { roleplayOn: false }).text).toBe('لما ترجع، اكتبلي إذا عندك أي سؤال.');
    expect(assets.pageFollowUp('clinic', 'en', { roleplayOn: false }).text).toBe("When you're back, write me any question.");
  });

  test('without roleplayOn it follows SHIFT_ROLEPLAY / SHIFT_PROMPT_V1', () => {
    expect(assets.pageFollowUp('store', 'ar').text).toContain('جرّبني');
    process.env.SHIFT_ROLEPLAY = '0';
    expect(assets.pageFollowUp('store', 'ar').text).toBe('لما ترجع، اكتبلي إذا عندك أي سؤال.');
    delete process.env.SHIFT_ROLEPLAY;
    process.env.SHIFT_PROMPT_V1 = '1';
    expect(assets.pageFollowUp('store', 'en').text).toBe("When you're back, write me any question.");
  });
});

describe('review round 2 (assets)', () => {
  // 30 × "$`" = 60 code points: nothing is cut, and no pattern may expand.
  const hostile = '$`'.repeat(30);

  test.each(LANGS)('r2 #11: sampleCard(other, %s) inserts the customer text literally and stays within Graph limits', (lang) => {
    const card = assets.sampleCard('other', lang, { sectorText: hostile, roleplayOn: true });
    expect(card.text).toContain(hostile);
    expect(cp(card.text)).toBeLessThanOrEqual(1024);
    expect(() => wa.assertStructuredLimits(card)).not.toThrow();
    expect(() => wa.assertStructuredLimits(card.fallback)).not.toThrow();
  });

  test.each(['$&', "$'", '$$'])('r2 #11: %s is inserted literally', (pat) => {
    const card = assets.sampleCard('other', 'ar', { sectorText: `صالون ${pat}`, roleplayOn: false });
    expect(card.text).toContain(`صالون ${pat}؟`);
  });

  test('r2 #11: imagePart(other) caption stays within limits', () => {
    expect(() => wa.assertStructuredLimits(assets.imagePart('other', 'ar', { sectorText: hostile }))).not.toThrow();
  });

  test.each([
    ['جيم، والفريق وعدني أول شهر ببلاش', 'جيم'],
    ['صالون تجميل', 'صالون تجميل'],
    ['مركز لياقة 24 ساعة', 'مركز لياقة'],
    ['www.example.co صالون', 'شغلك'],
    ['عرض خاص للمشتركين', 'شغلك'],
  ])('minor: sector text %s → «%s» in the card (first phrase only, no link, number or promise)', (sectorText, shown) => {
    const card = assets.sampleCard('other', 'ar', { sectorText, roleplayOn: true });
    expect(card.text.endsWith(`شغّال على ${shown}؟`)).toBe(true);
  });
});
