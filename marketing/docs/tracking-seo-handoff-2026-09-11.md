# SHIFT — shifts-ai.store: Tracking & SEO Handoff for Claude Code

**Owner:** SHIFT AI & Automation (شِفت), Irbid, Jordan
**Prepared:** 2026-09-11, from a browser setup session (Meta, GA4, Search Console, Bing, Google Business Profile)
**Scope for Claude Code:** code changes in the repo that deploys the marketing site on **Firebase Hosting site `shifts-ai-site`** (serves `shifts-ai.store` + `www`). All account and console setup is already done, so don't redo it.

---

## 0. TL;DR: tasks for the repo

| # | Task | Priority |
|---|------|----------|
| 1 | Add the **GA4** + **Meta Pixel** base code to the `<head>` of **every** HTML page (AR + EN + privacy + data-deletion) | Must |
| 2 | Add **WhatsApp-click lead tracking** (`fbq('track','Lead')` + `gtag('event','generate_lead')`) | Must |
| 3 | If the site sends a **Content-Security-Policy** header (check `firebase.json`), allow the Google/Meta domains in §4.4 | Must (if CSP exists) |
| 4 | Update **/privacy** (AR + EN) to disclose Meta Pixel + Google Analytics + cookies | Must, before ads run |
| 5 | Keep `sitemap.xml` `<lastmod>` updated automatically on each deploy | Should |
| 6 | Add **IndexNow** (key file + ping after deploy) so Bing picks up changes fast | Should |
| 7 | Strengthen Organization JSON-LD (`logo`, `sameAs`, `contactPoint`) | Should |
| 8 | Content backlog (pricing page, FAQ, case study, demo video), see §6 | Could |

Don't touch the items in §7.

---

## 1. IDs (all public, safe to commit)

| Service | Item | Value |
|---|---|---|
| **GA4** | Measurement ID | `G-Z2F36JFJCN` |
| GA4 | Property / Stream | `SHIFT — shifts-ai.store`, property `553710715`, web stream `15759050894` (`https://shifts-ai.store`) |
| GA4 | Account | `Moatasim Shakhtoori` (`287748559`) |
| **Meta** | Pixel / Dataset ID | `1456547816531153` (name: *SHIFT Website*) |
| Meta | Business portfolio | SHIFT AI & Automation, `146400565185045` |
| Meta | Linked ad account | SHIFT AI, `1618703026336059` |
| Meta | Facebook Page | https://www.facebook.com/profile.php?id=61593849817699 (page id `1213888615151426`) |
| **Google Ads** | Conversion | **None.** No SHIFT Google Ads account yet. Don't add any `AW-` tag. |
| **Search Console** | Property | Domain property `sc-domain:shifts-ai.store`, verified via DNS TXT |
| **Bing Webmaster** | Site | `https://shifts-ai.store/`, verified via import from GSC |
| **Google Business Profile** | Profile | "SHIFT AI & Automation", location id `17665521500302520556`, unverified |
| Contact | Phone / WhatsApp | `+962 77 678 8972` (E.164: `+962776788972`) |

---

## 2. Current state of external services (already done)

**Meta Events Manager: dataset `1456547816531153`**
- Setup method: manual code install. Automatic Advanced Matching is **OFF** (all customer-info fields off).
- Conversions API: **not** configured. The "add CAPI to all datasets" option was unchecked.
- Core setup OFF · Automatic events OFF · First-party cookies ON (default).
- "Automatically include more detailed page and product info" is **ON** (Meta default). The owner hasn't decided yet; nothing to do in code.
- Domain `shifts-ai.store` is **Verified** in Business settings (via DNS TXT). A meta-tag is **not** needed.

**GA4: property `553710715`**
- Timezone Jordan (GMT+03:00), currency JOD, industry Business & Industrial, size Small, objective Generate leads.
- Enhanced measurement ON (page views, scrolls, outbound clicks, etc.).
- Key events: `generate_lead` (created "with code", no default value, counted once per event). GA4 also auto-added `close_convert_lead`, `qualify_lead` and the default `purchase`.
- Data retention: 14 months (event + user).

**Google Search Console**
- Verified (Domain name provider / DNS TXT).
- Sitemap `https://shifts-ai.store/sitemap.xml` submitted 2026-09-11. It first showed "Couldn't fetch / Sitemap could not be read", which is common for brand-new properties. The file itself was checked and is valid (200, `application/xml`, 10 URLs).
- Indexing requested for all 8 main URLs. `/` was already indexed.

**Bing Webmaster Tools**
- Site imported from GSC (verified). Sitemap submitted and was "Processing" at the time. All 8 URLs submitted via URL Submission (daily quota was 100).

**Google Business Profile**
- Service-area business (no street address): Irbid, Amman, Zarqa. Category **Software company**. Phone + website + description set.
- Hours, photos and verification are still pending on the owner.

---

## 3. Site facts (audit on 2026-09-11)

- **Pages (sitemap has 10):** `/`, `/clinics`, `/restaurants`, `/online-stores`, `/en`, `/en/clinics`, `/en/restaurants`, `/en/online-stores`, `/privacy`, `/data-deletion`.
- `robots.txt` has `User-agent: * / Allow: /` + `Sitemap: https://shifts-ai.store/sitemap.xml`.
- `sitemap.xml` has the sitemap 0.9 namespace + `xmlns:xhtml`, hreflang alternates (24 `xhtml:link`), and `lastmod` 2026-09-11 on all URLs.
- Every main page is **pre-rendered HTML**: about 10–12k characters of text in the raw response, no JS needed. Each has:
  - correct `lang`/`dir` (ar → rtl, en → ltr)
  - a unique `<title>` and meta description (147–222 characters)
  - a self-referencing `canonical`
  - hreflang `ar`, `en` and `x-default`
  - exactly one `<h1>` and an `og:image`
  - JSON-LD of types `Organization`, `WebSite`, `WebPage` and `Service`
- **No** `fbq`, **no** `gtag`, and **no** `facebook-domain-verification` meta tag currently on the site.
- The main CTA is a WhatsApp link (wa.me / api.whatsapp.com). This is what we measure as a "Lead".

---

## 4. Implementation spec

### 4.1 Head snippets: put in the shared `<head>` of every page, once per page

```html
<!-- Google tag (gtag.js) — GA4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-Z2F36JFJCN"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-Z2F36JFJCN');
</script>

<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '1456547816531153');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=1456547816531153&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->
```

- Keep IDs in one place, e.g. a constants/config file or build-time env: `GA4_ID=G-Z2F36JFJCN`, `META_PIXEL_ID=1456547816531153`.
- **Exactly one** gtag.js and one `fbq('init', …)` per page. If pages are generated from a template, edit the template, not 10 files by hand.
- Do **not** pass `em`, `ph` or any personal data to `fbq('init')` (Advanced Matching must stay off).

### 4.2 WhatsApp click → Lead: global, place before `</body>` (or in the main JS bundle)

```html
<script>
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href*="wa.me"], a[href*="api.whatsapp.com"], a[href^="whatsapp:"]');
    if (!link) return;
    if (typeof fbq === 'function') fbq('track', 'Lead');
    if (typeof gtag === 'function') gtag('event', 'generate_lead');
  });
</script>
```

- The GA4 event name must be exactly **`generate_lead`** because it is configured as a key event.
- Covers every WhatsApp CTA (hero, sticky/floating button, footer) with no per-button code.
- Prefer `target="_blank" rel="noopener"` on WhatsApp links so the page isn't unloaded before the hits are sent.
- If a WhatsApp CTA is a `<button>` that sets `location.href`, fire the two events there too.
- Don't add parameters containing phone numbers or message text.

### 4.3 Where it must appear
All 10 sitemap URLs (both languages) and any future page. Check the built output (`dist/` / `public/` or whatever Firebase serves), not just source templates.

### 4.4 CSP (only if `firebase.json` or meta tags define a Content-Security-Policy)
Add at least:
- `script-src`: `https://www.googletagmanager.com` `https://connect.facebook.net`, plus `'unsafe-inline'` or a nonce/hash for the two inline snippets
- `img-src`: `https://www.google-analytics.com` `https://*.google-analytics.com` `https://www.googletagmanager.com` `https://www.facebook.com`
- `connect-src`: `https://*.google-analytics.com` `https://*.analytics.google.com` `https://www.googletagmanager.com` `https://www.facebook.com`

### 4.5 Privacy page (/privacy AR + /privacy EN if present)
Add a short "Analytics & advertising cookies" section. The owner should review the wording:
- The site uses **Google Analytics 4** to measure visits and **Meta Pixel** to measure ad performance. Both use cookies and similar technologies.
- Data collected: pages viewed, clicks (e.g. WhatsApp button), device/browser info. No names or phone numbers are sent to these tools by the site.
- Opt-out: Google Analytics opt-out browser add-on (tools.google.com/dlpage/gaoptout) and ad settings in Facebook/Instagram.
- Keep it consistent with the existing processor/controller wording on the page.

### 4.6 Sitemap
- On build, set `<lastmod>` to the page's real last-modified date (or build date if unknown). Keep the `xhtml:link` hreflang pairs.
- Any new page must be added to the sitemap with its AR/EN alternates.

### 4.7 IndexNow (Bing, Yandex and others)
1. Generate a key (8–128 characters: `a-z`, `A-Z`, `0-9`, `-`), e.g. a random 32-char hex.
2. Serve `https://shifts-ai.store/<key>.txt` whose body is exactly the key.
3. After each deploy, POST the changed URLs:
```bash
curl -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{"host":"shifts-ai.store","key":"<key>","keyLocation":"https://shifts-ai.store/<key>.txt","urlList":["https://shifts-ai.store/","https://shifts-ai.store/en"]}'
```
A 200 or 202 response means accepted. Wire this into the deploy script or CI after `firebase deploy`.

### 4.8 Organization JSON-LD (extend the existing block; don't duplicate)
```json
{
  "@type": "Organization",
  "name": "SHIFT AI & Automation",
  "url": "https://shifts-ai.store/",
  "logo": "https://shifts-ai.store/assets/logo.png",
  "sameAs": ["https://www.facebook.com/profile.php?id=61593849817699"],
  "contactPoint": [{
    "@type": "ContactPoint",
    "telephone": "+962776788972",
    "contactType": "customer service",
    "areaServed": "JO",
    "availableLanguage": ["ar", "en"]
  }]
}
```
Keep the business name exactly **"SHIFT AI & Automation"** and the phone identical everywhere (site, Google Business Profile, Facebook).

---

## 5. Verification checklist (after deploy)

- [ ] View source on `/` and `/en/clinics`: exactly one `gtag/js?id=G-Z2F36JFJCN` and one `fbq('init', '1456547816531153')`.
- [ ] No console errors and no CSP violations in DevTools.
- [ ] **Meta:** Events Manager → SHIFT Website → *Test events* → open the site → `PageView` on load, `Lead` on WhatsApp click.
- [ ] **GA4:** Reports → Realtime, or Admin → DebugView with Tag Assistant → `page_view` + `generate_lead`.
- [ ] `https://shifts-ai.store/sitemap.xml` still returns 200 + `application/xml`.
- [ ] IndexNow key file reachable, and the ping returns 200/202.
- [ ] Recheck Search Console → Sitemaps after 24–48 h. If it still says "Couldn't fetch", resubmit.

---

## 6. SEO content backlog (optional, by impact)

Google's current guidance (2026): no special files or markup are needed for AI Overviews/AI Mode (`llms.txt` neither helps nor hurts). What matters is unique, helpful, people-first content, good page experience, and helpful images/video. Local visibility depends on the Business Profile: relevance, distance, prominence (links and reviews).

1. **/pricing** (AR + EN): "starting from" monthly prices. The owner must supply the numbers.
2. **FAQ section** on each vertical page, in customers' words, e.g. «هل يعمل على رقمي الحالي؟», «هل يفهم اللهجة الأردنية؟», «كم يكلف؟». FAQ rich results are limited to gov/health sites, so this is for users and AI answers, not stars.
3. **Case study page** with real metrics (messages handled, bookings, response time). Blur client data in any screenshot.
4. **Short demo video** (Karam replying and booking), embedded with a transcript.
5. Only a few **guides** on real questions (e.g. WhatsApp Business app vs WhatsApp API). Don't create near-duplicate city pages (doorway-page spam).

---

## 7. Do NOT touch

- **DNS (Squarespace):** don't add, edit or delete records. Current records that must stay:
  - `A @ 199.36.158.100`
  - `CNAME www → shifts-ai-site.web.app`
  - `CNAME app → shifts-ai-app.web.app`
  - `TXT @ facebook-domain-verification=qrloso7qcljv7cd5gi8zlb2xodgc7i`
  - `TXT @ google-site-verification=GxF3w-Af7U68S7naiA7iOSWR0VZP0MW29NkxgfyGTVU`
  - `TXT @ hosting-site=shifts-ai-site`
  - `_acme-challenge` / `_acme-challenge.www`
  - `v=spf1 -all`, `_dmarc`, `_domainkey`, `_domainconnect`
- No Google Ads (`AW-…`) tag until a SHIFT Google Ads account exists.
- No Conversions API / server events, and no Advanced Matching.
- Don't create or modify anything in Meta, GA4, GSC, Bing or GBP via API. That is owner-managed.
- Don't touch the `app.shifts-ai.store` dashboard unless asked. This handoff is for the marketing site only.

---

## 8. Pending on the owner (not for Claude Code)

- Google Business Profile: verification (Google asks for a hidden mailing address first), business hours, logo/cover upload.
- Decide on Meta's "Automatically include more detailed page and product info" (currently ON).
- Open a SHIFT Google Ads account, then create the conversion **"WhatsApp lead"** (Contact / Submit lead form, no value, count One). Then add `AW-…` + the conversion event to §4.2.
- Collect genuine reviews from independent clients, not related businesses, employees or family.
