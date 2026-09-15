'use strict';

/**
 * Sector samples for the SHIFT sales bot (design §4 layers 1–2, contract §7.1, D11).
 *
 * The model never emits URLs or picks an asset: it asks for SEND_SAMPLE {sector} and the server builds
 * the part from this registry. Every example business here is fictional and every body says so
 * («مثال توضيحي»). No prices, client names or statistics — the only digits are clock times.
 *
 * OWNER-APPROVAL-PENDING: the Arabic in this file needs the owner's sign-off and a native reviewer pass
 * before merge (contract §13). The clinic, store and other page bodies are not in the design (only the
 * restaurant one is) and were written to claim no more than the pages show.
 *
 * Pure: no DB, no network. Env flags are read at call time.
 */

const { SITE_URL } = require('../../config/site');

const SAMPLE_SECTORS = ['clinic', 'restaurant', 'store', 'other'];

const PATH = { clinic: '/clinics', restaurant: '/restaurants', store: '/online-stores', other: '' };

const SECTOR_TEXT_MAX = 60;

const REGISTRY = {
  restaurant: {
    label_ar: 'مطعم أو كافيه',
    label_en: 'Restaurant or café',
    body_ar: 'مثال توضيحي (مش زبون حقيقي) 👇 كافيه زيتون، الساعة 11 بالليل: زبون بيسأل عن التوصيل، كرم بيرد من المنيو وبياخد الطلب، والصبح صاحب الكافيه بيلاقي تقرير بكل شي صار. بدك تشوفه شغّال على مطعمك أنت؟',
    body_en: 'Illustrative example (not a real client) 👇 Olive Café, 11 pm: a customer asks about delivery, Karam answers from the menu and takes the order; in the morning the owner finds a report of everything. Want to see it on your own restaurant?',
    page_header_ar: 'كرم للمطاعم',
    page_header_en: 'Karam for restaurants',
    page_body_ar: 'صفحة المطاعم فيها محاكاة كاملة لمحادثة طلب، وتقدر تغيّر اسم المطعم فيها. بتفتح بالمتصفح.',
    page_body_en: "The restaurants page has a full simulation of an order chat, and you can change the restaurant's name in it. It opens in your browser.",
    your_ar: 'مطعمك',
    your_en: "restaurant's",
    buttons_ar: { roleplay: 'جرّبه كزبون', page: 'افتح صفحة المطاعم', talk: 'احكي مع الفريق', quote: 'عرض مكتوب' },
    buttons_en: { roleplay: 'Try it as a customer', page: 'Restaurants page', talk: 'Talk to the team', quote: 'Written quote' },
  },
  clinic: {
    label_ar: 'عيادة',
    label_en: 'Clinic',
    body_ar: 'مثال توضيحي 👇 عيادة د. رنا، 11 بالليل: مريض بيطلب موعد، كرم بيعرض الأوقات المتاحة من التقويم ويثبّت الموعد، وبيبعت تذكير قبله، والحالات الخاصة بتروح للاستقبال. بدك تشوفه شغّال على عيادتك؟',
    body_en: "Illustrative example 👇 Dr. Rana's clinic, 11 pm: a patient asks for an appointment, Karam offers free slots from the calendar, confirms, sends a reminder; special cases go to reception. Want to see it on your clinic?",
    page_header_ar: 'كرم للعيادات',
    page_header_en: 'Karam for clinics',
    page_body_ar: 'صفحة العيادات فيها محاكاة لمحادثة حجز موعد على واتساب. بتفتح بالمتصفح.',
    page_body_en: 'The clinics page has a simulation of an appointment chat on WhatsApp. It opens in your browser.',
    your_ar: 'عيادتك',
    your_en: "clinic's",
    buttons_ar: { roleplay: 'جرّبه كمراجع', page: 'افتح صفحة العيادات', talk: 'احكي مع الفريق', quote: 'عرض مكتوب' },
    buttons_en: { roleplay: 'Try it as a patient', page: 'Clinics page', talk: 'Talk to the team', quote: 'Written quote' },
  },
  store: {
    label_ar: 'متجر إلكتروني',
    label_en: 'Online store',
    body_ar: 'مثال توضيحي 👇 متجر النور، 10 بالليل: "طلبي وين صار؟" — كرم بيجاوب برقم الطلب ووقت التوصيل، بيرد عن المقاسات من الكتالوج، وبيذكّر بالسلة المتروكة. بدك تشوفه شغّال على متجرك؟',
    body_en: 'Illustrative example 👇 Al-Noor Store, 10 pm: "where\'s my order?" — Karam answers from the order number, replies about sizes from the catalogue, reminds about the abandoned cart. Want to see it on your store?',
    page_header_ar: 'كرم للمتاجر',
    page_header_en: 'Karam for stores',
    page_body_ar: 'صفحة المتاجر فيها محاكاة لمحادثة عميل مع كرم. بتفتح بالمتصفح.',
    page_body_en: 'The stores page has a simulation of a customer chat with Karam. It opens in your browser.',
    your_ar: 'متجرك',
    your_en: "store's",
    buttons_ar: { roleplay: 'جرّبه كزبون', page: 'افتح صفحة المتاجر', talk: 'احكي مع الفريق', quote: 'عرض مكتوب' },
    buttons_en: { roleplay: 'Try it as a customer', page: 'Stores page', talk: 'Talk to the team', quote: 'Written quote' },
  },
  other: {
    label_ar: 'نشاط آخر',
    label_en: 'Something else',
    // {sectorText} is the customer's own word for the business (صالون، جيم…), or «شغلك» / "business".
    body_ar: 'مثال توضيحي 👇 صالون أو جيم أو مركز: زبون بيسأل عن موعد أو سعر خدمة، كرم بيرد من جدولك وقائمتك، بياخد طلب الحجز، والفريق بيأكده. بدك تشوفه شغّال على {sectorText}؟',
    body_en: 'Illustrative example 👇 a salon, gym or centre: a customer asks about a slot or a service, Karam answers from your schedule and list, takes the booking request, the team confirms. Want to see it on your {sectorText}?',
    page_header_ar: 'كرم من شِفت',
    page_header_en: 'Karam by SHIFT',
    page_body_ar: 'الموقع فيه تفاصيل كرم ومنتجات شِفت. بتفتح بالمتصفح.',
    page_body_en: "The site has the details of Karam and SHIFT's products. It opens in your browser.",
    your_ar: 'شغلك',
    your_en: "business's",
    buttons_ar: { roleplay: 'جرّبه كزبون', page: 'افتح الموقع', talk: 'احكي مع الفريق', quote: 'عرض مكتوب' },
    buttons_en: { roleplay: 'Try it as a customer', page: 'Open the site', talk: 'Talk to the team', quote: 'Written quote' },
  },
};

const FOOTER = { ar: 'مثال توضيحي · شِفت', en: 'Illustrative example · SHIFT' };
const PAGE_FOOTER = { ar: 'شِفت · إربد', en: 'SHIFT · Irbid' };
const PAGE_DISPLAY_TEXT = { ar: 'افتح الصفحة', en: 'Open the page' };

const isEn = (lang) => lang === 'en';
const pick = (row, key, lang) => row[`${key}_${isEn(lang) ? 'en' : 'ar'}`];

function sectorKey(sector) {
  return SAMPLE_SECTORS.includes(sector) ? sector : 'other';
}

/** Mirrors roleplay.roleplayEnabled() (contract §1.1); used only when a caller does not pass roleplayOn. */
function defaultRoleplayOn(env = process.env) {
  return env.SHIFT_ROLEPLAY !== '0' && env.SHIFT_PROMPT_V1 !== '1';
}

function listOf(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',');
  return [];
}

/** ai_config.samples_vetted ∪ SHIFT_SAMPLES_VETTED, keeping only known sectors (D11). */
function vettedSectors(business, env = process.env) {
  const fromConfig = listOf(business && business.ai_config && business.ai_config.samples_vetted);
  const fromEnv = listOf(env.SHIFT_SAMPLES_VETTED);
  const out = new Set();
  for (const raw of fromConfig.concat(fromEnv)) {
    const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (SAMPLE_SECTORS.includes(s)) out.add(s);
  }
  return out;
}

function isVetted(business, sector, env = process.env) {
  return SAMPLE_SECTORS.includes(sector) && vettedSectors(business, env).has(sector);
}

function sampleImageUrl(sector) {
  const base = (process.env.SHIFT_SAMPLES_BASE || `${SITE_URL}/assets/samples`).replace(/\/+$/, '');
  return `${base}/${sectorKey(sector)}-square-v1.png`;
}

function sectorPageUrl(sector, lang) {
  const s = sectorKey(sector);
  const prefix = isEn(lang) ? '/en' : '';
  // `other` has no sector page: the home page, «/» for Arabic and «/en» for English.
  const path = PATH[s] ? `${prefix}${PATH[s]}` : (prefix || '/');
  return `${SITE_URL}${path}?utm_source=wa&utm_medium=bot&utm_campaign=karam-${s}`;
}

// The customer's own word for the business goes into a SHIFT-branded one-line body, and the card's text comes
// back as a «كرم:» history line: only the first phrase, and nothing that reads as a link, a number or a
// promise («جيم، والفريق وعدني أول شهر ببلاش» → «جيم») (review minors).
const SECTOR_TEXT_STOP_RE = /[،,.;؛:!؟?\n()«»"\[\]{}<>|]|https?:|www\.|[a-z0-9-]+\.[a-z]{2,}|[0-9٠-٩۰-۹%٪]/i;
const SECTOR_TEXT_PROMISE_RE = /خصم|عرض|تخفيض|مجان|ببلاش|وعد|ضمان|مضمون|discount|offer|free|promise|guarantee/i;
const BODY_MAX = 1024;

function cleanSectorText(value) {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim();
  const stop = flat.search(SECTOR_TEXT_STOP_RE);
  const head = (stop >= 0 ? flat.slice(0, stop) : flat).trim();
  if (!head || SECTOR_TEXT_PROMISE_RE.test(head)) return '';
  const chars = Array.from(head);
  return chars.length > SECTOR_TEXT_MAX ? chars.slice(0, SECTOR_TEXT_MAX).join('').trim() : head;
}

function sampleBody(sector, lang, sectorText) {
  const s = sectorKey(sector);
  const body = pick(REGISTRY[s], 'body', lang);
  if (s !== 'other') return body;
  const word = cleanSectorText(sectorText);
  const fill = word || (isEn(lang) ? 'business' : 'شغلك');
  // A function replacement: the customer's text is inserted literally, never read as `$&` / `$\`` patterns
  // (review r2 #11). The body limit is a backstop for Graph's 1024 characters.
  const out = body.split('{sectorText}').join(fill);
  const chars = Array.from(out);
  return chars.length > BODY_MAX ? chars.slice(0, BODY_MAX).join('') : out;
}

function requireBoolean(value, name) {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${name} must be a boolean (pass roleplay.roleplayEnabled())`);
  }
}

/**
 * The sample card: image header, labelled body, footer and three reply buttons (contract §4.2).
 * `fallback` is the same buttons without the header, for when Graph refuses the image, so the customer
 * never gets a picture detached from its label.
 */
function sampleCard(sector, lang, { sectorText, roleplayOn } = {}) {
  requireBoolean(roleplayOn, 'roleplayOn');
  const s = sectorKey(sector);
  const titles = pick(REGISTRY[s], 'buttons', lang);
  const buttons = roleplayOn
    ? [
      { id: `sample_roleplay:${s}`, title: titles.roleplay },
      { id: `sample_page:${s}`, title: titles.page },
      { id: 'lead_talk', title: titles.talk },
    ]
    : [
      { id: `sample_page:${s}`, title: titles.page },
      { id: 'quote_written', title: titles.quote },
      { id: 'lead_talk', title: titles.talk },
    ];
  const text = sampleBody(s, lang, sectorText);
  const footer = isEn(lang) ? FOOTER.en : FOOTER.ar;
  return {
    type: 'interactive',
    text,
    header: { type: 'image', image: { link: sampleImageUrl(s) } },
    footer,
    buttons,
    serverButtons: true,
    fallback: { type: 'interactive', text, footer, buttons: buttons.map((b) => ({ ...b })), serverButtons: true },
  };
}

/** CTA-URL part that opens the sector page (layer 2). */
function pagePart(sector, lang) {
  const s = sectorKey(sector);
  const row = REGISTRY[s];
  return {
    type: 'cta_url',
    text: pick(row, 'page_body', lang),
    header: { type: 'text', text: pick(row, 'page_header', lang) },
    footer: isEn(lang) ? PAGE_FOOTER.en : PAGE_FOOTER.ar,
    displayText: isEn(lang) ? PAGE_DISPLAY_TEXT.en : PAGE_DISPLAY_TEXT.ar,
    url: sectorPageUrl(s, lang),
    serverButtons: true,
  };
}

/**
 * The line sent a second after the page link. The contract signature is (sector, lang); `roleplayOn`
 * is an optional third argument because the wording depends on it, defaulting to the env flags.
 */
function pageFollowUp(sector, lang, { roleplayOn = defaultRoleplayOn() } = {}) {
  const row = REGISTRY[sectorKey(sector)];
  let text;
  if (!roleplayOn) {
    text = isEn(lang) ? "When you're back, write me any question." : 'لما ترجع، اكتبلي إذا عندك أي سؤال.';
  } else if (isEn(lang)) {
    text = `When you're back, type "try me" and I'll be your ${row.your_en} Karam here.`;
  } else {
    text = `لما ترجع، اكتبلي "جرّبني" وبصير كرم تبع ${row.your_ar} هون.`;
  }
  return { type: 'text', text, delayMs: 1000 };
}

/**
 * Plain sector image with its labelled caption (the explicit `sample_image:*` tap). If Graph refuses
 * the image, the fallback is the sector page link — never the caption alone pointing at nothing.
 */
function imagePart(sector, lang, { sectorText } = {}) {
  const s = sectorKey(sector);
  return {
    type: 'image',
    image: { link: sampleImageUrl(s) },
    text: sampleBody(s, lang, sectorText),
    fallback: pagePart(s, lang),
  };
}

module.exports = {
  SAMPLE_SECTORS,
  REGISTRY,
  vettedSectors,
  isVetted,
  sampleImageUrl,
  sectorPageUrl,
  sampleCard,
  pagePart,
  pageFollowUp,
  imagePart,
};
