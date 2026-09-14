#!/usr/bin/env node
/* Render the WhatsApp "live sample" images that Karam (SHIFT's sales assistant) sends to prospects:
 * a phone-frame chat mock per sector, with a fictional business, clearly labelled «مثال توضيحي».
 *
 * Rules (docs/bot/sales-bot-design-2026-09-14.md §4): no prices, counts, client names or claims; the only digits are
 * clock times; no ad call-to-action; one chat bubble story that matches the caption the bot sends with the image.
 * The bot uses an image only after the owner lists its sector in ai_config.samples_vetted.
 *
 *   node marketing/tools/render-samples.js   → marketing/site/assets/samples/<sector>-square-v1.png
 * Needs Playwright at ~/qa-playwright (set PLAYWRIGHT_BROWSERS_PATH if Chromium lives elsewhere). */
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require(path.join(process.env.HOME, 'qa-playwright/node_modules/playwright'));
const SITE = path.join(__dirname, '..', 'site');
const OUT = path.join(SITE, 'assets', 'samples');
const FONTS = fs.readFileSync(path.join(SITE, 'assets/css/fonts.css'), 'utf8')
  .replace(/url\('\/assets\/fonts\//g, "url('file://" + path.join(SITE, 'assets/fonts') + '/')
  .replace(/font-display:optional/g, 'font-display:block');

// who: 'c' = the customer, 'k' = Karam. Times are the only digits allowed.
const SAMPLES = {
  restaurant: {
    name: 'كافيه زيتون', sector: 'مطعم أو كافيه', clock: '11:02 م',
    chat: [
      ['c', 'مرحبا، بتوصلوا لإيدون هلأ؟', '11:02 م'],
      ['k', 'أهلًا وسهلًا! أي، التوصيل لإيدون شغّال لآخر الليل. شو حابب تطلب؟', '11:02 م'],
      ['c', 'شاورما عربي وعصير ليمون', '11:03 م'],
      ['k', 'تمام، هاد ملخص طلبك. أكّدلي العنوان وبيوصل الطلب للمطبخ فورًا.', '11:03 م'],
    ],
    note: 'الصبح: صاحب الكافيه بيلاقي تقرير بكل الطلبات والأسئلة',
  },
  clinic: {
    name: 'عيادة د. رنا', sector: 'عيادة', clock: '11:10 م',
    chat: [
      ['c', 'مساء الخير، بدي موعد بكرا الصبح إذا في', '11:10 م'],
      ['k', 'مساء النور! في وقتين فاضيين بكرا: 9:30 و11:00. أي وقت بناسبك؟', '11:10 م'],
      ['c', '9:30 لو سمحت', '11:11 م'],
      ['k', 'ثبّتت موعدك بكرا 9:30، وببعتلك تذكير قبله بساعتين.', '11:11 م'],
    ],
    note: 'الحالات الخاصة بتروح للاستقبال مع كامل المحادثة',
  },
  store: {
    name: 'متجر النور', sector: 'متجر إلكتروني', clock: '10:05 م',
    chat: [
      ['c', 'طلبي وين صار؟ باسم سارة', '10:05 م'],
      ['k', 'أهلًا سارة! طلبك طلع مع المندوب وبيوصلك بكرا قبل 6 المسا.', '10:05 م'],
      ['c', 'وفي من نفس البلوزة مقاس أكبر؟', '10:06 م'],
      ['k', 'أي، متوفر من نفس اللون بمقاس L. بتحب أضيفه لطلبك؟', '10:06 م'],
    ],
    note: 'السلال المتروكة بيوصلها تذكير لحالها',
  },
  other: {
    name: 'صالون لمسة', sector: 'صالون، جيم، مركز', clock: '9:40 م',
    chat: [
      ['c', 'في موعد قص شعر بكرا العصر؟', '9:40 م'],
      ['k', 'أهلًا! في موعدين بكرا العصر: 4:00 و5:30. أي واحد بناسبك؟', '9:40 م'],
      ['c', '5:30', '9:41 م'],
      ['k', 'تمام، وصل طلب الموعد للصالون وبيأكدوه معك هون الصبح.', '9:41 م'],
    ],
    note: 'كرم بيرد من جدولك وقائمة خدماتك، والفريق بيأكد',
  },
};

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function html(s) {
  const bubbles = s.chat.map(([who, text, t]) =>
    `<div class="b ${who === 'k' ? 'ka' : 'cu'}"><p>${esc(text)}</p><time>${esc(t)}</time></div>`).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${FONTS}
  html,body{margin:0}
  .c{width:1080px;height:1080px;box-sizing:border-box;background:#F5F6F9;color:#0F1E38;font-family:'IBM Plex Sans Arabic',system-ui,sans-serif;
     display:flex;align-items:center;justify-content:center;gap:56px;padding:56px 64px;position:relative;overflow:hidden}
  .wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
  .wm span{transform:rotate(-24deg);font-family:'Alexandria',sans-serif;font-weight:700;font-size:150px;color:rgba(15,30,56,.045);white-space:nowrap}
  .side{width:300px;display:flex;flex-direction:column;gap:22px;z-index:1}
  .brand{display:flex;align-items:center;gap:12px;font-family:'Alexandria',sans-serif;font-weight:700;font-size:40px}
  .brand i{width:14px;height:14px;border-radius:4px;background:#F2B33D;display:block}
  .tag{align-self:flex-start;font-size:26px;font-weight:600;color:#0F1E38;background:#FFE7B3;border-radius:999px;padding:8px 20px}
  .side h2{margin:0;font-family:'Alexandria',sans-serif;font-weight:600;font-size:38px;line-height:1.35}
  .side p{margin:0;font-size:24px;color:#5B6B85;line-height:1.55}
  .phone{width:560px;height:940px;box-sizing:border-box;border-radius:56px;background:#0F1E38;padding:18px;z-index:1;box-shadow:0 30px 60px rgba(15,30,56,.18)}
  .screen{width:100%;height:100%;border-radius:40px;overflow:hidden;display:flex;flex-direction:column;background:#EFE7DC}
  .top{background:#075E54;color:#fff;padding:26px 26px 20px;display:flex;align-items:center;gap:16px}
  .av{width:62px;height:62px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;font-family:'Alexandria',sans-serif;font-weight:700;font-size:28px;color:#062b1a}
  .top b{display:block;font-size:28px;font-weight:600}
  .top small{display:block;font-size:19px;opacity:.85;margin-top:2px}
  .chip{margin-inline-start:auto;font-size:18px;border:1px solid rgba(255,255,255,.55);border-radius:999px;padding:5px 12px;white-space:nowrap}
  .msgs{flex:1;display:flex;flex-direction:column;gap:16px;padding:26px 22px}
  .b{max-width:82%;border-radius:18px;padding:14px 18px 10px;box-shadow:0 1px 1px rgba(0,0,0,.08)}
  .b p{margin:0;font-size:25px;line-height:1.5}
  .b time{display:block;font-size:16px;color:#667781;margin-top:4px;text-align:left;direction:ltr}
  .b.cu{align-self:flex-start;background:#fff}
  .b.ka{align-self:flex-end;background:#D9FDD3}
  .note{margin:0 22px 26px;background:rgba(15,30,56,.86);color:#EAF0F9;border-radius:16px;padding:14px 18px;font-size:21px;line-height:1.45}
  </style></head><body><div class="c">
  <div class="wm"><span>مثال توضيحي</span></div>
  <div class="phone"><div class="screen">
    <div class="top"><div class="av">${esc(s.name.slice(0, 1))}</div><div><b>${esc(s.name)}</b><small>كرم · مساعد واتساب</small></div><span class="chip">مثال توضيحي</span></div>
    <div class="msgs">${bubbles}</div>
    <p class="note">${esc(s.note)}</p>
  </div></div>
  <div class="side">
    <div class="brand"><i></i>شِفت</div>
    <span class="tag">مثال توضيحي</span>
    <h2>هيك كرم بيرد على زباين ${esc(s.sector)}</h2>
    <p>منشأة وأسماء افتراضية للتوضيح، مش زبون حقيقي.</p>
  </div>
  </div></body></html>`;
}

// Guard the copy before rendering: digits may only appear inside a clock time (H:MM).
function assertNoLooseDigits(key, s) {
  const texts = [s.name, s.sector, s.note, ...s.chat.map(m => m[1])];
  for (const t of texts) {
    const stripped = t.replace(/\b\d{1,2}:\d{2}\b/g, '').replace(/قبل \d{1,2} المسا/g, '');
    if (/[0-9٠-٩]/.test(stripped)) throw new Error(`${key}: digit outside a clock time in «${t}»`);
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const [key, s] of Object.entries(SAMPLES)) {
    assertNoLooseDigits(key, s);
    const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
    const tmp = path.join(OUT, `.${key}.html`);
    fs.writeFileSync(tmp, html(s));
    await page.goto('file://' + tmp, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(() => {
      const m = document.querySelector('.msgs'), sc = document.querySelector('.screen');
      return sc.scrollHeight > sc.clientHeight + 1 || m.scrollHeight > m.clientHeight + 1;
    });
    const file = path.join(OUT, `${key}-square-v1.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1080, height: 1080 } });
    console.log(path.relative(process.cwd(), file), overflow ? 'OVERFLOW' : 'ok', fs.statSync(file).size, 'bytes');
    await page.close();
    fs.unlinkSync(tmp);
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
