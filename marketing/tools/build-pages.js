#!/usr/bin/env node
/* Build the static, pre-rendered pages of shifts-ai.store from src/page.template.html.
 *
 *   /                /en
 *   /clinics         /en/clinics
 *   /restaurants     /en/restaurants
 *   /online-stores   /en/online-stores
 *
 * For each page: write the SEO head (title, description, canonical, hreflang, Open Graph, JSON-LD) and
 * window.SHIFT_PAGE, then load it in headless Chromium and bake the rendered nav, sections and footer into the
 * HTML — so crawlers that do not run JavaScript (Bing, AI search, link previews) see the full text. The live page
 * re-renders on load exactly as before. Vendor tracking is blocked during the build and the clock is fixed to a
 * Tuesday 13:30 in Amman, so output is deterministic. Also writes sitemap.xml.
 *
 *   node marketing/tools/build-pages.js
 * Needs Playwright at ~/qa-playwright (chromium). */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm');
const { chromium } = require(path.join(process.env.HOME, 'qa-playwright/node_modules/playwright'));

const M = path.join(__dirname, '..');
const SITE = path.join(M, 'site');
const ORIGIN = 'https://shifts-ai.store';
const TEMPLATE = fs.readFileSync(path.join(M, 'src/page.template.html'), 'utf8');
const BUILD_TIME = '2026-09-15T13:30:00+03:00';
const TODAY = new Date().toISOString().slice(0, 10);
const crypto = require('crypto');
// src/lastmod.json: { "/clinics": { "hash": "<sha256 of built HTML>", "lastmod": "YYYY-MM-DD" }, … } — committed.
// A URL's lastmod only moves when its built HTML actually changes, so sitemap dates stay trustworthy.
const LASTMOD_FILE = path.join(M, 'src/lastmod.json');
const lastmodState = fs.existsSync(LASTMOD_FILE) ? JSON.parse(fs.readFileSync(LASTMOD_FILE, 'utf8')) : {};
function stamp(urlPath, file) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const prev = lastmodState[urlPath];
  lastmodState[urlPath] = prev && prev.hash === hash ? prev : { hash, lastmod: TODAY };
  return lastmodState[urlPath].lastmod;
}

const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(SITE, 'assets/js/content.js'), 'utf8'), ctx);
const C = ctx.window.SHIFT_CONTENT;
const SEO = C.seo;
if (!SEO || !SEO.home || !SEO.pages) { console.error('content.js has no seo block'); process.exit(1); }

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const abs = p => ORIGIN + p;
const fileFor = p => (p === '/' ? 'index.html' : p.replace(/^\//, '') + '.html');

// ---------------------------------------------------------------- pages
const pages = [];
for (const lang of ['ar', 'en']) {
  pages.push({ key: 'home', lang, sector: null, seo: SEO.home, path: SEO.home.path[lang], alternates: SEO.home.path });
  for (const k of Object.keys(SEO.pages)) {
    const sp = SEO.pages[k];
    pages.push({ key: k, lang, sector: k, seo: sp, path: sp.path[lang], alternates: sp.path });
  }
}

function jsonLd(pg) {
  const L = pg.lang, org = ORIGIN + '/#org', site = ORIGIN + '/#website', url = abs(pg.path);
  const graph = [
    {
      '@type': 'Organization', '@id': org,
      name: 'SHIFT AI & Automation', alternateName: 'شِفت',
      url: ORIGIN + '/', logo: ORIGIN + '/assets/logo.png',
      sameAs: [C.contact.facebookUrl].filter(Boolean),
      address: { '@type': 'PostalAddress', addressLocality: 'Irbid', addressCountry: 'JO' },
      contactPoint: [
        { '@type': 'ContactPoint', telephone: '+962776788972', contactType: 'customer service', areaServed: 'JO', availableLanguage: ['ar', 'en'] },
        { '@type': 'ContactPoint', telephone: '+962776788972', contactType: 'sales', areaServed: 'JO', availableLanguage: ['ar', 'en'] }
      ]
    },
    { '@type': 'WebSite', '@id': site, url: ORIGIN + '/', name: L === 'ar' ? 'شِفت' : 'SHIFT', inLanguage: ['ar', 'en'], publisher: { '@id': org } },
    {
      '@type': 'WebPage', '@id': url + '#page', url, name: pg.seo.title[L], description: pg.seo.description[L],
      inLanguage: L, isPartOf: { '@id': site }, about: { '@id': url + '#service' }, primaryImageOfPage: ORIGIN + '/assets/og.png'
    },
    {
      '@type': 'Service', '@id': url + '#service',
      name: L === 'ar' ? 'كرم بوت' : 'Karam Bot',
      serviceType: L === 'ar' ? 'وكيل ذكاء اصطناعي على واتساب' : 'WhatsApp AI agent',
      description: pg.seo.description[L],
      provider: { '@id': org },
      areaServed: { '@type': 'Country', name: 'Jordan' },
      ...(pg.sector ? { audience: { '@type': 'BusinessAudience', audienceType: pg.seo.audience } } : {})
    }
  ];
  // FAQ only where that sector's questions are visible on the page (#cases renders them).
  if (pg.sector && C.sectors[pg.sector] && Array.isArray(C.sectors[pg.sector].faq)) {
    graph.push({
      '@type': 'FAQPage', '@id': url + '#faq',
      mainEntity: C.sectors[pg.sector].faq.map(f => ({ '@type': 'Question', name: f.q[L], acceptedAnswer: { '@type': 'Answer', text: f.a[L] } }))
    });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

function headFor(pg) {
  const L = pg.lang, url = abs(pg.path);
  return [
    `<title>${esc(pg.seo.title[L])}</title>`,
    `<meta name="description" content="${esc(pg.seo.description[L])}">`,
    `<link rel="canonical" href="${url}">`,
    `<link rel="alternate" hreflang="ar" href="${abs(pg.alternates.ar)}">`,
    `<link rel="alternate" hreflang="en" href="${abs(pg.alternates.en)}">`,
    `<link rel="alternate" hreflang="x-default" href="${abs(pg.alternates.ar)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="${L === 'ar' ? 'ar_AR' : 'en_US'}">`,
    `<meta property="og:locale:alternate" content="${L === 'ar' ? 'en_US' : 'ar_AR'}">`,
    `<meta property="og:site_name" content="${L === 'ar' ? 'شِفت' : 'SHIFT'}">`,
    `<meta property="og:title" content="${esc(pg.seo.title[L])}">`,
    `<meta property="og:description" content="${esc(pg.seo.description[L])}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${ORIGIN}/assets/og.png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:image" content="${ORIGIN}/assets/og.png">`,
    `<script type="application/ld+json">${jsonLd(pg)}</script>`
  ].join('\n');
}

function shellFor(pg) {
  const page = { lang: pg.lang, sector: pg.sector, home: SEO.home.path[pg.lang], alternates: { ar: pg.alternates.ar, en: pg.alternates.en } };
  return TEMPLATE
    .replace('{{lang}}', pg.lang).replace('{{dir}}', pg.lang === 'ar' ? 'rtl' : 'ltr')
    .replace('{{head}}', headFor(pg))
    .replace('{{page_script}}', `<script>window.SHIFT_PAGE=${JSON.stringify(page)}</script>`);
}

// ---------------------------------------------------------------- local server (Firebase cleanUrls semantics)
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain', '.json': 'application/json' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let u = decodeURIComponent(req.url.split('?')[0]);
      let f = u === '/' ? 'index.html' : u.replace(/^\//, '');
      if (!path.extname(f)) f += '.html';
      const full = path.join(SITE, f);
      if (!full.startsWith(SITE) || !fs.existsSync(full)) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      rsp.end(fs.readFileSync(full));
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

// Pre-rendered markup repeats the same inline icons hundreds of times. In the baked HTML each icon becomes
// <svg …same attributes…><use href="#i-N"/></svg> pointing at one hidden <symbol> sheet. The outer <svg> keeps its
// class/size/stroke attributes, so layout and colour are identical; stroke/fill inherit into <use>. The live
// JavaScript render still produces inline icons — this only shrinks what crawlers and first paint download.
function spriteIcons(parts) {
  const symbols = new Map();
  const swap = html => html.replace(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g, (m, attrs, inner) => {
    if (inner.length < 60 || /<use\b/.test(inner)) return m;
    const vb = (attrs.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 24 24';
    const key = vb + '|' + inner;
    if (!symbols.has(key)) symbols.set(key, { id: 'i-' + symbols.size, vb, inner });
    return '<svg' + attrs + '><use href="#' + symbols.get(key).id + '"></use></svg>';
  });
  const outParts = { nav: swap(parts.nav), footer: swap(parts.footer), sections: {} };
  for (const [id, inner] of Object.entries(parts.sections)) outParts.sections[id] = swap(inner);
  const sheet = symbols.size
    ? '<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false">' +
      Array.from(symbols.values()).map(x => '<symbol id="' + x.id + '" viewBox="' + x.vb + '">' + x.inner + '</symbol>').join('') + '</svg>'
    : '';
  return { parts: outParts, sheet };
}

function bake(html, rawParts) {
  const { parts, sheet } = spriteIcons(rawParts);
  let out = html.replace(/<body>/, '<body>\n' + sheet);
  const put = (re, inner, label) => {
    const before = out;
    out = out.replace(re, (m, open, close) => open + inner + close);
    if (out === before) throw new Error('mount point not found: ' + label);
  };
  put(/(<header class="nav" id="nav">)(<\/header>)/, parts.nav, 'nav');
  for (const [id, inner] of Object.entries(parts.sections)) {
    put(new RegExp('(<section id="' + id + '" data-section="' + id + '">)(</section>)'), inner, id);
  }
  put(/(<footer class="footer" id="footer">)(<\/footer>)/, parts.footer, 'footer');
  return out;
}

(async () => {
  // 1) shells first (pages link to each other and the server needs them on disk)
  for (const pg of pages) {
    const f = path.join(SITE, fileFor(pg.path));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, shellFor(pg));
  }
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Amman', locale: 'ar-JO' });
  await context.route(/connect\.facebook\.net|facebook\.com\/tr|googletagmanager\.com|google-analytics\.com|doubleclick\.net/, r => r.abort());
  let failed = 0;

  // 2) pre-render each page and bake the result into its file
  for (const pg of pages) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.setFixedTime(new Date(BUILD_TIME));
    await page.goto(base + pg.path, { waitUntil: 'load' });
    await page.waitForFunction(() => window.SHIFT && window.SHIFT.mounted, null, { timeout: 15000 });
    await page.waitForTimeout(150);
    const parts = await page.evaluate(() => {
      const ids = Array.from(document.querySelectorAll('main > section[data-section]')).map(s => s.id);
      const sections = {};
      ids.forEach(id => { const el = document.getElementById(id); sections[id] = el.hidden ? '' : el.innerHTML; });
      return {
        nav: document.getElementById('nav').innerHTML,
        footer: document.getElementById('footer').innerHTML,
        sections,
        h1: (document.querySelector('h1') || {}).textContent || '',
        lang: document.documentElement.lang,
        sector: window.SHIFT.state.sector
      };
    });
    await page.close();
    const f = path.join(SITE, fileFor(pg.path));
    const expectedH1 = pg.sector ? pg.seo.h1[pg.lang] : C.sections.top.title[pg.lang];
    const problems = [];
    if (errors.length) problems.push('page errors: ' + errors.join(' | '));
    if (parts.lang !== pg.lang) problems.push('rendered lang ' + parts.lang);
    if (pg.sector && parts.sector !== pg.sector) problems.push('rendered sector ' + parts.sector);
    if (parts.h1.replace(/\s+/g, ' ').trim() !== expectedH1.replace(/\s+/g, ' ').trim()) problems.push('h1 mismatch: ' + parts.h1);
    if (problems.length) { failed++; console.error('FAIL ' + pg.path + ' — ' + problems.join('; ')); continue; }
    const html = bake(fs.readFileSync(f, 'utf8'), parts);
    fs.writeFileSync(f, html);
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`ok   ${pg.path.padEnd(18)} ${fileFor(pg.path).padEnd(22)} ${String(text.length).padStart(6)} chars of text · h1: ${parts.h1.slice(0, 60)}`);
  }
  await browser.close(); srv.close();

  // 3) sitemap with language alternates
  const urls = [];
  const groups = [SEO.home.path, ...Object.values(SEO.pages).map(p => p.path)];
  for (const g of groups) for (const L of ['ar', 'en']) {
    const lm = stamp(g[L], path.join(SITE, fileFor(g[L])));
    urls.push(`  <url>\n    <loc>${abs(g[L])}</loc>\n    <lastmod>${lm}</lastmod>\n` +
      `    <xhtml:link rel="alternate" hreflang="ar" href="${abs(g.ar)}"/>\n` +
      `    <xhtml:link rel="alternate" hreflang="en" href="${abs(g.en)}"/>\n` +
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${abs(g.ar)}"/>\n  </url>`);
  }
  for (const p of ['/privacy', '/data-deletion']) urls.push(`  <url>\n    <loc>${abs(p)}</loc>\n    <lastmod>${stamp(p, path.join(SITE, fileFor(p)))}</lastmod>\n  </url>`);
  if (!failed) fs.writeFileSync(LASTMOD_FILE, JSON.stringify(lastmodState, null, 2) + '\n');
  fs.writeFileSync(path.join(SITE, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + urls.join('\n') + '\n</urlset>\n');
  console.log(`sitemap.xml: ${urls.length} urls`);
  if (failed) { console.error(`\n${failed} page(s) failed — files left as unrendered shells`); process.exit(1); }
  console.log(`\nbuilt ${pages.length} pages`);
})().catch(e => { console.error(e); process.exit(1); });
