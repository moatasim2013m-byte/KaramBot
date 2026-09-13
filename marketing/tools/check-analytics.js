#!/usr/bin/env node
/* Dry-run the ads/analytics layer in a real browser without sending anything to Meta or Google.
 * Serves ./site locally, injects test IDs via assets/js/config.js (or the committed IDs with --real),
 * stubs the vendor scripts, clicks through the page and asserts which fbq/gtag calls fire.
 *   node marketing/tools/check-analytics.js          # fake IDs
 *   node marketing/tools/check-analytics.js --real   # use the IDs committed in index.html
 * Needs Playwright at ~/qa-playwright (chromium). Exit 1 on any failed expectation. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(path.join(process.env.HOME, 'qa-playwright/node_modules/playwright'));
const ROOT = path.join(__dirname, '..', 'site');
const REAL = process.argv.includes('--real');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain' };
const FAKE = '{metaPixelId:"111111111111111",ga4Id:"G-TEST000000",googleAdsId:"AW-999999999",googleAdsLabels:{lead:"TESTLABEL"},metaDomainVerification:""}';

const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
  const f = path.join(ROOT, u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(f);
  // IDs live in assets/js/config.js; swap in test IDs there unless --real.
  if (u === '/assets/js/config.js' && !REAL) body = Buffer.from('window.SHIFT_CONFIG=' + FAKE + ';');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(body);
});

const results = [];
function expect(label, ok, detail) { results.push({ label, ok, detail }); }

srv.listen(4174, '127.0.0.1', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // Stub vendors: nothing leaves this machine. fbevents.js / gtag.js become no-op scripts.
  await page.route(/connect\.facebook\.net|googletagmanager\.com|google-analytics\.com|facebook\.com\/tr/, r => { external.push(r.request().url()); r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); });
  // Record every vendor call from the vendors' own queues: with the real scripts stubbed out, fbq keeps every
  // call in fbq.queue and gtag pushes every call onto dataLayer — so nothing can fire before we are listening.
  const calls = async () => page.evaluate(() => {
    const out = [];
    const q = (window.fbq && window.fbq.queue) || [];
    for (const a of q) out.push(['fbq', ...Array.from(a)]);
    for (const a of (window.dataLayer || [])) if (a && typeof a.length === 'number') out.push(['gtag', ...Array.from(a).map(v => v instanceof Date ? 'Date' : v)]);
    return JSON.parse(JSON.stringify(out));
  });
  // Per-vendor marks: new fbq calls must not be sliced away by gtag growth (or vice versa).
  const mark = async () => page.evaluate(() => [((window.fbq && window.fbq.queue) || []).length, (window.dataLayer || []).length]);
  const since = async (m) => page.evaluate((m) => {
    const out = [];
    for (const a of ((window.fbq && window.fbq.queue) || []).slice(m[0])) out.push(['fbq', ...Array.from(a)]);
    for (const a of (window.dataLayer || []).slice(m[1])) if (a && typeof a.length === 'number') out.push(['gtag', ...Array.from(a).map(v => v instanceof Date ? 'Date' : v)]);
    return JSON.parse(JSON.stringify(out));
  }, m);
  const has = (cs, vendor, ...args) => cs.some(c => c[0] === vendor && args.every((a, i) => c[i + 1] === a));

  await page.goto('http://127.0.0.1:4174/?b=clinic&utm_source=fb&utm_campaign=karam-clinics', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  let c = await calls();
  const cfg = await page.evaluate(() => window.SHIFT_CONFIG);
  expect('vendor scripts requested (stubbed)', external.some(u => u.includes('fbevents')) && external.some(u => u.includes('gtag/js')), external.join(' | '));
  expect('fbq init with pixel id', has(c, 'fbq', 'init', cfg.metaPixelId));
  expect('fbq PageView', has(c, 'fbq', 'track', 'PageView'));
  expect('gtag config GA4', has(c, 'gtag', 'config', cfg.ga4Id));
  expect('gtag config Google Ads', !cfg.googleAdsId || has(c, 'gtag', 'config', cfg.googleAdsId));
  expect('?b=clinic sets sector', (await page.evaluate(() => SHIFT.state.sector)) === 'clinic');
  expect('utm captured', (await page.evaluate(() => SHIFT.state.attribution.utm_campaign)) === 'karam-clinics');

  // 1) Opening WhatsApp CTA → Lead + Contact + generate_lead + Ads conversion, exactly once each.
  let n = await mark();
  const ctx = page.context();
  ctx.on('page', p => p.close().catch(() => {}));            // wa.me opens a new tab; close it
  // Capture what the tap opens: core opens the full message itself, the href stays public.
  await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return {}; }; });
  await page.route('https://wa.me/**', r => r.abort());
  await page.locator('[data-cta="top"], #top [data-wa]').first().click();
  await page.waitForTimeout(600);
  c = await since(n);
  const href = (await page.evaluate(() => window.__opened[0])) || '';
  const leads = c.filter(x => x[0] === 'fbq' && x[1] === 'track' && x[2] === 'Lead').length;
  expect('top CTA → fbq Lead (once)', leads === 1, 'Lead x' + leads);
  expect('top CTA → fbq Contact', has(c, 'fbq', 'track', 'Contact'));
  expect('top CTA → gtag generate_lead', has(c, 'gtag', 'event', 'generate_lead'));
  expect('top CTA → Ads conversion send_to', !cfg.googleAdsId || c.some(x => x[0] === 'gtag' && x[2] === 'conversion' && x[3] && x[3].send_to === cfg.googleAdsId + '/' + cfg.googleAdsLabels.lead));
  const msg = decodeURIComponent((href || '').split('text=')[1] || '');
  expect('wa.me number', (href || '').startsWith('https://wa.me/962776788972'), href);
  expect('message carries campaign attribution', msg.includes('fb/karam-clinics'), msg);

  // 2) Sector switch → ViewContent / select_content
  n = await mark();
  const storeChip = page.locator('#cases [role="tab"]').filter({ hasText: /متجر|store/i }).first();
  if (await storeChip.count()) { await storeChip.click(); await page.waitForTimeout(400); c = await since(n);
    expect('sector switch → fbq ViewContent', has(c, 'fbq', 'track', 'ViewContent'));
    expect('sector switch → gtag select_content', has(c, 'gtag', 'event', 'select_content')); }
  else expect('sector tab found in #cases', false);

  // 3) Add a product to the bundle → AddToWishlist / add_to_wishlist
  n = await mark();
  const addBtn = page.locator('#products button').filter({ hasText: /أضِفه لباقتي|Add to my bundle/i }).first();
  if (await addBtn.count()) { await addBtn.scrollIntoViewIfNeeded(); await addBtn.click(); await page.waitForTimeout(400); c = await since(n);
    expect('bundle add → fbq AddToWishlist', has(c, 'fbq', 'track', 'AddToWishlist'));
    expect('bundle add → gtag add_to_wishlist', has(c, 'gtag', 'event', 'add_to_wishlist')); }
  else expect('bundle add button found', false);

  // 4) Contact CTA → one Lead, not two
  n = await mark();
  const contactCta = page.locator('[data-cta="contact"]').first();
  if (await contactCta.count()) {
    // Privacy: what the visitor types must reach WhatsApp but never an href (Meta automatic events / GA4 outbound clicks read hrefs).
    const NAME = 'Zzprobe', PHONE = '0790000123';
    await page.fill('#f-name', NAME); await page.fill('#f-phone', PHONE);
    await page.evaluate(() => { window.__opened = []; });
    await contactCta.scrollIntoViewIfNeeded(); await contactCta.click(); await page.waitForTimeout(600); c = await since(n);
    const l2 = c.filter(x => x[0] === 'fbq' && x[1] === 'track' && x[2] === 'Lead').length;
    expect('contact CTA → exactly one fbq Lead', l2 === 1, 'Lead x' + l2);
    const opened = decodeURIComponent((await page.evaluate(() => window.__opened[0])) || '');
    expect('contact CTA opens WhatsApp with the typed name and phone', opened.includes(NAME) && opened.includes(PHONE), opened);
    const hrefs = await page.$$eval('a[href]', as => as.map(a => decodeURIComponent(a.getAttribute('href'))));
    const leaky = hrefs.filter(h => h.includes(NAME) || h.includes(PHONE) || h.includes('karam-clinics'));
    expect('no href carries typed name/phone or attribution', leaky.length === 0, leaky.slice(0, 2).join(' | '));
    const trackArgs = JSON.stringify(c);
    expect('no fbq/gtag call carries typed name/phone', !trackArgs.includes(NAME) && !trackArgs.includes(PHONE), ''); }
  else expect('contact CTA found', false);

  expect('no page/console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  expect('nothing sent to real vendor endpoints', !external.some(u => /facebook\.com\/tr|google-analytics\.com\/g\/collect/.test(u)), '');

  await browser.close(); srv.close();
  let fail = 0;
  for (const r of results) { console.log((r.ok ? 'PASS ' : 'FAIL ') + r.label + (r.ok || !r.detail ? '' : '  — ' + r.detail)); if (!r.ok) fail++; }
  console.log(fail ? `\n${fail} FAILED` : `\nALL ${results.length} PASSED` + (REAL ? ' (real IDs)' : ' (test IDs — nothing sent)'));
  process.exit(fail ? 1 : 0);
});
