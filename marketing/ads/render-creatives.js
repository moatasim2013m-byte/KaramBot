#!/usr/bin/env node
/* Render the ad images (1080×1080 feed, 1080×1920 stories/reels) for the three sectors from the site's own design:
 * light ground, Alexandria + IBM Plex Sans Arabic (self-hosted files), the dark ops card labelled «مثال توضيحي».
 * Copy comes from the sector pages (content.js seo.pages.*.h1) — no prices, counts or claims the site does not make.
 *   node marketing/ads/render-creatives.js     → marketing/ads/creative/<sector>-{square,story}.png
 * Needs Playwright at ~/qa-playwright. */
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require(path.join(process.env.HOME, 'qa-playwright/node_modules/playwright'));
const SITE = path.join(__dirname, '..', 'site');
const OUT = path.join(__dirname, 'creative');
const FONTS = fs.readFileSync(path.join(SITE, 'assets/css/fonts.css'), 'utf8')
  .replace(/url\('\/assets\/fonts\//g, "url('file://" + path.join(SITE, 'assets/fonts') + '/')
  .replace(/font-display:optional/g, 'font-display:block');

const SECTORS = {
  clinics: {
    eyebrow: 'بوت واتساب للعيادات · الأردن',
    h1: 'مريض يراسل عيادتك الساعة 11 ليلًا. كرم يعرض الأوقات المتاحة ويثبّت الموعد.',
    card: 'يوم عادي في عيادة', sub: 'ما يصل الاستقبال صباحًا',
    rows: [['طلب موعد — عُرضت الأوقات المتاحة من التقويم', '11:04 م'], ['موعد مؤكّد · الخميس 4:30 م', '11:06 م'],
           ['تذكير بالموعد أُرسل للمريض', '9:00 ص'], ['حالة خاصة — حُوّلت إلى الاستقبال', '9:12 ص', true]],
  },
  restaurants: {
    eyebrow: 'بوت واتساب للمطاعم والكافيهات · الأردن',
    h1: 'زبون يراسل مطعمك وقت الذروة. كرم يأخذ الطلب بالعنوان ويرسله للمطبخ.',
    card: 'ساعة ذروة في مطعم', sub: 'ما يصل المدير بين 8 و9 مساءً',
    rows: [['طلب توصيل — العنوان مسجّل وأُرسل إلى المطبخ', '8:04'], ['حجز طاولة مؤكّد · الليلة 9:30', '8:11'],
           ['سؤال عن القائمة — أُجيب من أسعارك', '8:17'], ['شكوى — حُوّلت إلى المدير', '8:26', true]],
  },
  stores: {
    eyebrow: 'بوت واتساب للمتاجر الإلكترونية · الأردن',
    h1: '«طلبي وين صار؟» الساعة 10 ليلًا. كرم يجيب برقم الطلب ووقت التوصيل.',
    card: 'مساء عادي في متجر', sub: 'ما يصل صاحب المتجر صباحًا',
    rows: [['«طلبي وين صار؟» — أُجيب برقم الطلب', '10:02 م'], ['سؤال عن مقاس متوفر — أُجيب من الكتالوج', '10:15 م'],
           ['تذكير بسلة متروكة أُرسل', '10:40 م'], ['شكوى — حُوّلت إلى موظف', '9:05 ص', true]],
  },
};

const WA = '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="#062b1a"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.41-.08-.13-.28-.2-.57-.35m-5.42 7.4h-.01a9.87 9.87 0 01-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 01-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 012.89 6.99c0 5.45-4.44 9.89-9.88 9.89m8.41-18.3A11.82 11.82 0 0012.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 005.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.41z"/></svg>';

function html(s, story) {
  const W = 1080, H = story ? 1920 : 1080, k = story ? 1.18 : 1;
  const rows = s.rows.map(r => `<div class="row${r[2] ? ' hot' : ''}"><p>${r[0]}</p><time>${r[1]}</time></div>`).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${FONTS}
  html,body{margin:0}
  .c{width:${W}px;height:${H}px;box-sizing:border-box;background:#F5F6F9;color:#0F1E38;font-family:'IBM Plex Sans Arabic',system-ui,sans-serif;
     display:flex;flex-direction:column;justify-content:${story ? 'center' : 'space-between'};gap:${story ? 64 : 0}px;padding:${story ? '220px 84px' : '64px 72px'}}
  .brand{display:flex;align-items:center;gap:12px;font-family:'Alexandria',sans-serif;font-weight:700;font-size:${38 * k}px}
  .brand i{width:${13 * k}px;height:${13 * k}px;border-radius:4px;background:#F2B33D;display:block}
  .eyebrow{display:flex;align-items:center;gap:14px;font-size:${24 * k}px;font-weight:600;color:#5B6B85;margin-top:${story ? 0 : 26}px}
  .eyebrow span{width:40px;height:2px;background:#B9C2D0;display:block}
  h1{margin:${14 * k}px 0 0;font-family:'Alexandria',sans-serif;font-weight:600;font-size:${story ? 70 : 54}px;line-height:1.32}
  .panel{background:radial-gradient(75% 42% at 50% 20%,rgba(31,107,255,.28),rgba(31,107,255,0) 72%),linear-gradient(180deg,#0B1526,#0F1E38);
     border-radius:30px;padding:${24 * k}px;display:flex;flex-direction:column;gap:${10 * k}px}
  .ph{display:flex;justify-content:space-between;align-items:flex-start;padding:2px 4px 6px}
  .ph b{font-family:'Alexandria',sans-serif;font-weight:600;font-size:${24 * k}px;color:#fff;display:block}
  .ph small{font-size:${17 * k}px;color:#8FA0BD;display:block;margin-top:${6 * k}px}
  .badge{font-size:${16 * k}px;color:#EAF0F9;border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:5px 13px;white-space:nowrap}
  .row{display:flex;align-items:center;gap:16px;padding:${15 * k}px ${18 * k}px;border-radius:16px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09)}
  .row.hot{background:rgba(34,211,238,.09);border-color:rgba(34,211,238,.45)}
  .row p{margin:0;flex:1;font-size:${22 * k}px;color:#EAF0F9;line-height:1.4}
  .row time{font-size:${18 * k}px;color:#8FA0BD;white-space:nowrap;direction:ltr}
  .cta{align-self:flex-start;display:flex;align-items:center;gap:14px;height:${76 * k}px;padding:0 ${34 * k}px;border-radius:999px;background:#25D366;color:#062b1a;font-weight:600;font-size:${28 * k}px}
  .cta svg{font-size:${30 * k}px}
  </style></head><body><div class="c">
  <div><div class="brand"><i></i>شِفت</div><div class="eyebrow"><span></span>${s.eyebrow}</div><h1>${s.h1}</h1></div>
  <div class="panel"><div class="ph"><div><b>${s.card}</b><small>${s.sub}</small></div><span class="badge">مثال توضيحي</span></div>${rows}</div>
  <div class="cta">${WA}راسلنا على واتساب</div>
  </div></body></html>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const [key, s] of Object.entries(SECTORS)) {
    for (const story of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1080, height: story ? 1920 : 1080 } });
      const tmp = path.join(OUT, `.${key}-${story ? 'story' : 'square'}.html`);
      fs.writeFileSync(tmp, html(s, story));
      await page.goto('file://' + tmp, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => { const c = document.querySelector('.c'); return c.scrollHeight > c.clientHeight + 1; });
      const file = path.join(OUT, `${key}-${story ? 'story' : 'square'}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1080, height: story ? 1920 : 1080 } });
      const fams = await page.evaluate(() => [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family))].join(','));
      console.log(path.relative(process.cwd(), file), overflow ? 'OVERFLOW' : 'ok', '| fonts:', fams);
      await page.close();
      fs.unlinkSync(tmp);
    }
  }
  await browser.close();
})();
