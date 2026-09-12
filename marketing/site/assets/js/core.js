/*! shifts-ai.store — core.js — window.SHIFT
 * Vanilla ES2019, classic <script>, no modules, no libraries.
 * Load order: content.js → core.js → analytics.js → sections/*.js → inline SHIFT.mount().
 *
 * ============================================================================
 *  PUBLIC API — stable; section builders rely on every signature below
 * ============================================================================
 *
 *  Constants
 *    SHIFT.WA           "962776788972" — the ONLY place the WhatsApp number lives (owner has not confirmed it yet).
 *    SHIFT.content      alias of window.SHIFT_CONTENT.
 *    SHIFT.ORDER        ['top','karam','cases','products','loyalty','attendance','roi','team','builder','contact']
 *                       (nav, #about, footer and .sticky are rendered by core, not by section modules).
 *    SHIFT.SECTORS      ['clinic','restaurant','store']
 *    SHIFT.mounted      boolean — true after SHIFT.mount() finished.
 *
 *  State — read freely; WRITE ONLY THROUGH THE SETTERS (they validate, persist, emit and refresh the sticky bar).
 *    SHIFT.state = {
 *      lang:        'ar' | 'en'
 *      sector:      'clinic' | 'restaurant' | 'store'        (never null; default 'restaurant')
 *      bizName:     ''  (visitor-typed name, ≤ 28 chars; '' = use sector.exampleName)
 *      bundle:      [productKey, …]                          (product KEYS: 'karam','loyalty','attend',… not ids)
 *      roi:         { msgsPerDay, avgTicketJOD, missedRate, replyMinutes }   (numbers)
 *      roiTouched:  boolean  (false = roi still equals the sector defaults and follows sector changes)
 *      need:        [needKey, …]                             (keys of contact chip "need": 'karam','booking','loyalty','attend','marketing','custom')
 *      attribution: { utm_source?, utm_medium?, utm_campaign?, utm_content?, utm_term?, fbclid?, gclid? }
 *      contact:     { name:'', phone:'' }
 *    }
 *    SHIFT.setLang(lang)              → boolean changed. Updates <html lang/dir>, persists 'kb-lang',
 *                                       re-renders shell + every section, THEN emits 'lang'.
 *    SHIFT.setSector(key)             → boolean changed. Resets roi to the sector defaults unless roiTouched,
 *                                       persists, calls update(el,'sector') on sections that define it (re-renders the
 *                                       others), THEN emits 'sector', THEN tracks sector_select.
 *    SHIFT.setBizName(name)           → trims, clamps to 28, persists ('kb-state' + 'kb-name'), emits 'state' {key:'bizName'}.
 *    SHIFT.toggleProduct(keyOrId)     → boolean nowInBundle. Emits 'bundle' (keys[]), tracks product_add / product_remove.
 *    SHIFT.inBundle(keyOrId)          → boolean.
 *    SHIFT.setNeed(keys[])  SHIFT.toggleNeed(key) → emits 'state' {key:'need'}.
 *    SHIFT.setRoi({msgsPerDay?,…})    → merges numbers, sets roiTouched = true, emits 'state' {key:'roi'},
 *                                       tracks roi_change {monthly_value} (analytics debounces 1 s).
 *    SHIFT.resetRoi()                 → back to the sector defaults, roiTouched = false.
 *    SHIFT.setContact({name?,phone?}) → emits 'state' {key:'contact'}.
 *    SHIFT.save()                     → persist now (setters already do).
 *
 *  Derived data
 *    SHIFT.sector()                   → SHIFT_CONTENT.sectors[state.sector]  (the single source of truth for every demo)
 *    SHIFT.bizName()                  → state.bizName || tx(sector().exampleName)
 *    SHIFT.product(keyOrId)           → product object | null        SHIFT.productName(keyOrId) → localized name
 *    SHIFT.needLabel(key)             → localized label of a contact "need" option
 *    SHIFT.roiCalc(roi?)              → { loss, hours }   loss = round(msgs × missed × avg × 30); hours = round(msgs × reply × 30 / 60)
 *
 *  Text / i18n
 *    SHIFT.t(key, vars?)              → string. key = a ui key ('cta_whatsapp') or a dotted content path
 *                                       ('sections.top.title', 'templates.hours_line_night', 'contact.cta', 'demos.roi.assumptions').
 *                                       Missing key → returns the key itself.
 *    SHIFT.tx(obj, vars?)             → picks obj[state.lang] from an {ar,en} object (falls back to the other language);
 *                                       plain strings pass through. Then fills {{vars}}.
 *    SHIFT.fill(str, vars)            → replaces {{name}} placeholders (plain text; unknown placeholders are left as-is).
 *    SHIFT.esc(str)                   → HTML-escape. ALWAYS escape data before putting it into innerHTML.
 *    SHIFT.rich(str)                  → esc() + wraps Latin runs inside Arabic text in <bdi>…</bdi> (WhatsApp, ERP, Excel…).
 *    SHIFT.fmtNum(n, {dec?, percent?}) → Latin digits, grouped ("1,250"); {percent:true} → "15%" from 0.15.
 *    SHIFT.icon(name, {size?, cls?, label?}) → inline SVG string (Lucide-style, stroke 2, 24 viewBox; aria-hidden unless label given).
 *        names: whatsapp, message, calendar, calendar-check, clock, bell, bell-off, check, x, chevron (down), chevron-left,
 *               chevron-right, star, trophy, users, user-x, bar-chart, shopping-bag, stethoscope, utensils, store, phone, send,
 *               edit, refresh, arrow (points FORWARD: left in Arabic, right in English), arrow-left, arrow-right, bot, repeat,
 *               zap, workflow, headphones, trending-up, clipboard-list, instagram, globe, layers, file-bar-chart, gift, alert, sun, moon.
 *        Lucide PascalCase names used in content.js ('BarChart3', 'UtensilsCrossed', 'PenLine', 'MessageCircle') are accepted.
 *
 *  Clock — the visitor's local time, Latin digits
 *    SHIFT.clock()                    → { date, hour (0–23.99), text, phase:'night'|'morning'|'peak', friday, ramadan }
 *    SHIFT.nowText(lang?)             → "11:42 م" / "11:42 PM"          SHIFT.timeText(date, lang?) → same for any Date
 *    SHIFT.isNight(sectorKey?) / isMorning / isPeak → by the sector's support hours:
 *                                       peak = open ≤ h < close · morning = 06:00 ≤ h < open · night = h ≥ close or h < 06:00
 *    SHIFT.isFriday()  SHIFT.isRamadan()  SHIFT.isPromo(sectorKey?)   (promo = sector.promoVariant window)
 *    SHIFT.scenario(sectorKey?)       → 'friday' | 'ramadan' | 'promo' | 'night' | 'morning' | 'peak' — always a key present
 *                                       in sector.chat (friday only if hours.fridayClosed; ramadan only if sector.ramadanVariant).
 *    SHIFT.phase()                    → generic phase for SHIFT's own availability: night 21:00–06:00, morning 06:00–09:00, else peak.
 *    SHIFT.hoursLine()                → the honest time line («الآن الساعة 11:42 م — …») from templates.hours_line_<phase>.
 *
 *  WhatsApp
 *    SHIFT.composeMessage(kind?, vars?) → string ≤ templates.composed.max_chars (700), in the current language.
 *        kind omitted / 'composed' → the full message from state (greeting · business · bundle · need · calculator (only if
 *        roiTouched) · name · phone · closing · attribution). Other kinds = a key of SHIFT_CONTENT.templates:
 *        'ask_about_product' {product}, 'bundle_quote', 'roi_estimate', 'builder_plan' {role,business,channel,pain}, 'team_plan' {agents}.
 *        vars default to {name, business, business_line, sector, bundle, need, msgs, loss, hours, attribution} from state.
 *        name = the visitor-typed name only ('' when untyped — outgoing text never claims sector.exampleName as the lead's);
 *        business = name || sector label; business_line = composed.business_named / business_sector (the honest sentence).
 *    SHIFT.waUrl(msg?)                → "https://wa.me/<WA>?text=…" (pure; msg defaults to composeMessage()).
 *    SHIFT.waLink(placement, msg?)    → tracks whatsapp_click {placement, sector, bundle} THEN returns waUrl(msg). Call at click time.
 *    Declarative (preferred): render  <a href="…" data-wa="placement" target="_blank" rel="noopener">…</a>
 *        (+ optional data-wa-kind="ask_about_product" data-wa-product="كرم بوت" → extra vars). Core's delegated click handler
 *        recomposes the message from live state, tracks, and rewrites href before navigation; it also keeps the href of every
 *        kind-less [data-wa] fresh on state changes. Mark the opening CTA data-cta="top" and the contact CTA data-cta="contact":
 *        the sticky bar hides while either is on screen.
 *    Other delegated actions (no JS needed in the section):
 *        data-action="lang"  ·  data-action="sector" data-sector="clinic"  ·  data-action="product" data-product="loyalty"
 *
 *  Events
 *    SHIFT.on(event, fn) → off()      events: 'lang' (lang) · 'sector' (key) · 'bundle' (keys[]) · 'state' ({key, value}) · 'mount'
 *    SHIFT.emit(event, payload)
 *
 *  Sections
 *    SHIFT.sections[id] = { id, render(el), init(el), update?(el, reason, detail) }     (or SHIFT.register(module))
 *      render(el)   writes el.innerHTML for the CURRENT state. Pure: no timers, no listeners, no tracking.
 *      init(el)     once per page life, right after the first render. Bind listeners by delegation on `el` — it survives
 *                   every re-render. Start timers only through SHIFT.onVisible() so nothing runs off-screen.
 *      update(el, reason, detail)   optional. reason = 'lang' (core already re-rendered; re-grab refs / restart demos),
 *                   'sector' (core did NOT re-render; refresh sector-aware parts), 'bundle' (detail = keys[]),
 *                   'state' (detail = {key, value}). Without update(): core re-renders on 'sector'; nothing on 'bundle'/'state'.
 *    SHIFT.rerender(id, reason?)      → render(el) again (+ update(el, reason) if defined), refresh sticky observers.
 *    SHIFT.mount()                    → renders nav/#about/footer/sticky and every registered section, binds delegation and
 *                                       observers, tracks page_view. Mount points without a module are hidden.
 *    SHIFT.onVisible(el, onEnter, onLeave?, {threshold?, rootMargin?}) → off()   IntersectionObserver helper; onLeave also fires
 *                                       once initially when el starts off-screen. Falls back to an immediate onEnter.
 *    SHIFT.debounce(fn, ms)           → debounced function.
 *    SHIFT.track(name, params)        → implemented in analytics.js (core keeps a queue until it loads; never throws).
 * ============================================================================
 */
(function (w, d) {
  'use strict';

  var C = w.SHIFT_CONTENT || {};
  // Static pages (built by tools/build-pages.js) declare what they are: { lang, sector|null, home, alternates:{ar,en} }.
  // The page's language and sector win over storage so the prerendered HTML, the URL and the live render agree.
  var PAGE = (w.SHIFT_PAGE && typeof w.SHIFT_PAGE === 'object') ? w.SHIFT_PAGE : null;
  var SECTOR_DATA = C.sectors || {};
  var SHIFT = w.SHIFT = w.SHIFT || {};
  SHIFT.page = PAGE;

  SHIFT.WA = '962776788972';
  SHIFT.content = C;
  SHIFT.ORDER = ['top', 'karam', 'cases', 'products', 'loyalty', 'attendance', 'roi', 'team', 'builder', 'contact'];
  SHIFT.SECTORS = ['clinic', 'restaurant', 'store'];
  SHIFT.sections = SHIFT.sections || {};
  SHIFT.mounted = false;

  var KEY_STATE = 'kb-state';
  var KEY_LANG = 'kb-lang';
  var KEY_NAME = 'kb-name';
  var TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  var NAME_MAX = 28;
  var NIGHT_END = 6;   // 06:00 — before this it is night for every sector; from here until `open` it is morning
  var OWN_NIGHT = 21;  // generic phase (SHIFT's own team): night from 21:00
  var OWN_MORNING_END = 9;

  var listeners = {};
  var trackQueue = [];
  SHIFT._trackQueue = trackQueue;
  // Replaced by analytics.js; until then, calls are queued.
  SHIFT.track = function (name, params) { trackQueue.push([name, params || {}]); };

  /* ---------------------------------------------------------------- helpers */
  function err(e) { try { console.error('[SHIFT]', e); } catch (_) { /* noop */ } }
  function safe(fn) { try { return fn(); } catch (e) { err(e); } }
  function num(v, dflt) { v = Number(v); return isFinite(v) ? v : dflt; }
  function str(v) { return v == null ? '' : String(v); }
  function sGet(k) { try { return w.localStorage.getItem(k); } catch (e) { return null; } }
  function sSet(k, v) { try { w.localStorage.setItem(k, v); } catch (e) { /* private mode / quota */ } }
  function sDel(k) { try { w.localStorage.removeItem(k); } catch (e) { /* noop */ } }
  function byId(id) { return d.getElementById(id); }
  function path(o, p) {
    var parts = String(p).split('.');
    for (var i = 0; i < parts.length; i++) { if (o == null) return undefined; o = o[parts[i]]; }
    return o;
  }
  function uniq(arr) { return arr.filter(function (v, i) { return arr.indexOf(v) === i; }); }

  /* ------------------------------------------------------------- text/i18n */
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  SHIFT.esc = function (s) { return str(s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); };

  SHIFT.fill = function (s, vars) {
    s = str(s);
    if (!vars) return s;
    return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, function (m, k) {
      var v = vars[k];
      return v == null ? m : String(v);
    });
  };

  function pick(obj) {
    if (obj == null) return '';
    if (typeof obj === 'string' || typeof obj === 'number') return String(obj);
    if (typeof obj === 'object') {
      var v = obj[SHIFT.state.lang];
      if (v == null || v === '') v = obj[SHIFT.state.lang === 'ar' ? 'en' : 'ar'];
      return v == null ? '' : String(v);
    }
    return '';
  }
  SHIFT.tx = function (obj, vars) { return SHIFT.fill(pick(obj), vars); };
  SHIFT.t = function (key, vars) {
    var v;
    if (C.ui && Object.prototype.hasOwnProperty.call(C.ui, key)) v = C.ui[key];
    else v = path(C, key);
    if (v == null) return String(key);
    return SHIFT.tx(v, vars);
  };

  // Latin run inside Arabic text → <bdi>. Letters, digits, & ' + / - and inner single spaces; also «#4821»-style
  // order/booking numbers, which otherwise resolve RTL after Arabic letters and render as «4821#».
  var LATIN_RUN = /(?:#\d+|[A-Za-z][A-Za-z0-9'’&+\/-]*(?: [A-Za-z0-9&][A-Za-z0-9'’&+\/-]*)*)/g;
  SHIFT.rich = function (s) {
    s = str(s);
    if (!/[؀-ۿ]/.test(s)) return SHIFT.esc(s);
    var out = '', last = 0;
    s.replace(LATIN_RUN, function (m, idx) {
      out += SHIFT.esc(s.slice(last, idx)) + '<bdi>' + SHIFT.esc(m) + '</bdi>';
      last = idx + m.length;
      return m;
    });
    return out + SHIFT.esc(s.slice(last));
  };

  var NF = {};
  SHIFT.fmtNum = function (n, opts) {
    opts = opts || {};
    n = Number(n);
    if (!isFinite(n)) return '—';
    if (opts.percent) return Math.round(n * 100) + '%';
    var dec = opts.dec == null ? 0 : opts.dec;
    var key = 'd' + dec;
    if (!(key in NF)) {
      try { NF[key] = new Intl.NumberFormat('en-US', { maximumFractionDigits: dec, minimumFractionDigits: 0 }); }
      catch (e) { NF[key] = null; }
    }
    if (NF[key]) return NF[key].format(n);
    var parts = n.toFixed(dec).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  };

  /* ------------------------------------------------------------------ icons */
  var ICONS = {
    'whatsapp': '<path fill="currentColor" stroke="none" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>',
    'message': '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    'calendar': '<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    'calendar-check': '<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
    'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    'bell': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    'bell-off': '<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>',
    'check': '<path d="M20 6 9 17l-5-5"/>',
    'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'chevron': '<path d="m6 9 6 6 6-6"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'star': '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    'trophy': '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    'user-x': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 8 5 5"/><path d="m22 8-5 5"/>',
    'bar-chart': '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    'shopping-bag': '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    'stethoscope': '<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 6 6a6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/>',
    'utensils': '<path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8"/><path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7"/><path d="m2.1 21.8 6.4-6.3"/><path d="m19 5-7 7"/>',
    'store': '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/>',
    'phone': '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    'send': '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    'edit': '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    'refresh': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    'bot': '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
    'repeat': '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    'zap': '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    'workflow': '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
    'headphones': '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H3v-7a9 9 0 0 1 18 0v7h-3a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
    'trending-up': '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    'clipboard-list': '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
    'instagram': '<rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><path d="M17.5 6.5h.01"/>',
    'globe': '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    'layers': '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    'file-bar-chart': '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="M8 18v-1"/><path d="M16 18v-3"/>',
    'gift': '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
    'alert': '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    'moon': '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'
  };
  var ICON_ALIAS = {
    'wa': 'whatsapp', 'message-circle': 'message', 'message-square': 'message', 'chat': 'message',
    'pen-line': 'edit', 'pencil': 'edit', 'refresh-cw': 'refresh', 'rotate-cw': 'refresh',
    'bar-chart-3': 'bar-chart', 'bar-chart-2': 'bar-chart', 'file-bar-chart-2': 'file-bar-chart',
    'utensils-crossed': 'utensils', 'chevron-down': 'chevron', 'alert-circle': 'alert', 'circle-alert': 'alert',
    'shopping-cart': 'shopping-bag', 'user': 'users', 'gift-box': 'gift', 'calendar-days': 'calendar'
  };
  function normIcon(name) {
    var k = str(name).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[\s_]+/g, '-');
    k = k.replace(/-?\d+$/, '');           // BarChart3 → bar-chart
    if (ICON_ALIAS[k]) k = ICON_ALIAS[k];
    return k;
  }
  SHIFT.icon = function (name, opts) {
    opts = opts || {};
    var key = normIcon(name);
    if (key === 'arrow') key = SHIFT.state.lang === 'ar' ? 'arrow-left' : 'arrow-right';
    var body = ICONS[key] || '';
    var size = opts.size || 24;
    var a11y = opts.label
      ? ' role="img" aria-label="' + SHIFT.esc(opts.label) + '"'
      : ' aria-hidden="true" focusable="false"';
    return '<svg class="ic ic-' + key + (opts.cls ? ' ' + SHIFT.esc(opts.cls) : '') + '" xmlns="http://www.w3.org/2000/svg" width="' + size +
      '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
      a11y + '>' + body + '</svg>';
  };

  /* ------------------------------------------------------------------ state */
  function validSector(k) { return SHIFT.SECTORS.indexOf(k) > -1 && !!SECTOR_DATA[k]; }
  function defaultSector() { return validSector(C.defaultSector) ? C.defaultSector : 'restaurant'; }
  function roiDefaults(k) {
    var s = SECTOR_DATA[k];
    var r = (s && s.roiDefaults) || {};
    return { msgsPerDay: num(r.msgsPerDay, 60), avgTicketJOD: num(r.avgTicketJOD, 20), missedRate: num(r.missedRate, 0.15), replyMinutes: num(r.replyMinutes, 3) };
  }
  function cleanRoi(src, dflt) {
    var out = {};
    Object.keys(dflt).forEach(function (k) { out[k] = num(src && src[k], dflt[k]); });
    return out;
  }
  var productKeys = (C.products || []).map(function (p) { return p.key; });
  var needChip = ((C.contact || {}).chips || []).filter(function (c) { return c && c.key === 'need'; })[0] || null;
  var needOptions = needChip ? (needChip.options || []) : [];
  var needKeys = needOptions.map(function (o) { return typeof o === 'string' ? o : o.key; });

  var state = SHIFT.state = {
    lang: 'ar',
    sector: defaultSector(),
    bizName: '',
    bundle: [],
    roi: roiDefaults(defaultSector()),
    roiTouched: false,
    need: [],
    attribution: {},
    contact: { name: '', phone: '' }
  };

  function restore() {
    var raw = sGet(KEY_STATE);
    if (raw) {
      var o = null;
      try { o = JSON.parse(raw); } catch (e) { o = null; }
      if (!o || typeof o !== 'object' || !o.savedAt || Date.now() - o.savedAt > TTL_MS) {
        sDel(KEY_STATE);
      } else {
        if (validSector(o.sector)) state.sector = o.sector;
        if (typeof o.bizName === 'string') state.bizName = o.bizName.trim().slice(0, NAME_MAX);
        if (Array.isArray(o.bundle)) state.bundle = uniq(o.bundle.filter(function (k) { return productKeys.indexOf(k) > -1; }));
        if (Array.isArray(o.need)) state.need = uniq(o.need.filter(function (k) { return needKeys.indexOf(k) > -1; }));
        state.roiTouched = !!o.roiTouched;
        state.roi = state.roiTouched ? cleanRoi(o.roi, roiDefaults(state.sector)) : roiDefaults(state.sector);
        if (o.attribution && typeof o.attribution === 'object') state.attribution = o.attribution;
        if (o.contact && typeof o.contact === 'object') state.contact = { name: str(o.contact.name).slice(0, 60), phone: str(o.contact.phone).slice(0, 60) };
      }
    }
    if (!state.bizName) { var n = sGet(KEY_NAME); if (n) state.bizName = String(n).trim().slice(0, NAME_MAX); }
    var lang = sGet(KEY_LANG);
    if (lang === 'ar' || lang === 'en') state.lang = lang;
    if (PAGE && (PAGE.lang === 'ar' || PAGE.lang === 'en')) state.lang = PAGE.lang;
  }

  // ?b=clinic|restaurant|store wins over storage and is removed; utm_*/fbclid/gclid are captured (and left in the URL for the vendors).
  function readUrl() {
    var sp;
    try { sp = new URLSearchParams(w.location.search); } catch (e) { return false; }
    var changed = false;
    var b = str(sp.get('b')).toLowerCase();
    if (validSector(b)) {
      state.sector = b;
      if (!state.roiTouched) state.roi = roiDefaults(b);
      changed = true;
    }
    var attr = {}, any = false;
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'].forEach(function (k) {
      var v = sp.get(k);
      if (v) { attr[k] = String(v).slice(0, 120); any = true; }
    });
    if (any) { state.attribution = attr; changed = true; }
    if (sp.has('b')) {
      sp.delete('b');
      var q = sp.toString();
      try { w.history.replaceState(null, '', w.location.pathname + (q ? '?' + q : '') + w.location.hash); } catch (e) { /* noop */ }
    }
    return changed;
  }

  SHIFT.save = function () {
    sSet(KEY_STATE, JSON.stringify({
      savedAt: Date.now(),
      sector: state.sector,
      bizName: state.bizName,
      bundle: state.bundle,
      roi: state.roi,
      roiTouched: state.roiTouched,
      need: state.need,
      attribution: state.attribution,
      contact: state.contact
    }));
  };

  /* ----------------------------------------------------------------- events */
  SHIFT.on = function (ev, fn) {
    (listeners[ev] = listeners[ev] || []).push(fn);
    return function () { var a = listeners[ev] || []; var i = a.indexOf(fn); if (i > -1) a.splice(i, 1); };
  };
  SHIFT.emit = function (ev, payload) {
    (listeners[ev] || []).slice().forEach(function (fn) { try { fn(payload); } catch (e) { err(e); } });
  };

  /* ---------------------------------------------------------------- derived */
  SHIFT.sector = function () { return SECTOR_DATA[state.sector] || null; };
  SHIFT.bizName = function () { var s = SHIFT.sector(); return state.bizName || (s ? SHIFT.tx(s.exampleName) : ''); };
  SHIFT.product = function (x) {
    var ps = C.products || [];
    for (var i = 0; i < ps.length; i++) { if (ps[i].key === x || ps[i].id === x) return ps[i]; }
    return null;
  };
  SHIFT.productName = function (x) { var p = SHIFT.product(x); return p ? SHIFT.tx(p.name) : ''; };
  SHIFT.needLabel = function (k) {
    for (var i = 0; i < needOptions.length; i++) {
      var o = needOptions[i];
      if (typeof o === 'string') { if (o === k) return k; }
      else if (o.key === k) return SHIFT.tx(o.label);
    }
    return '';
  };
  SHIFT.inBundle = function (x) { var p = SHIFT.product(x); return !!p && state.bundle.indexOf(p.key) > -1; };
  SHIFT.roiCalc = function (r) {
    r = r || state.roi;
    var days = num(path(C, 'demos.roi.constants.daysPerMonth'), 30);
    return {
      loss: Math.round(num(r.msgsPerDay, 0) * num(r.missedRate, 0) * num(r.avgTicketJOD, 0) * days),
      hours: Math.round(num(r.msgsPerDay, 0) * num(r.replyMinutes, 0) * days / 60)
    };
  };

  /* ----------------------------------------------------------------- setters */
  function applyLang() {
    var h = d.documentElement;
    h.lang = state.lang;
    h.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  }
  function forEachSection(fn) {
    SHIFT.ORDER.forEach(function (id) {
      var mod = SHIFT.sections[id], el = byId(id);
      if (mod && el) fn(mod, el, id);
    });
  }
  // Push a change into mounted sections: update() if defined; otherwise re-render on 'sector' only.
  function propagate(reason, detail) {
    if (!SHIFT.mounted) return;
    forEachSection(function (mod, el) {
      if (typeof mod.update === 'function') safe(function () { mod.update(el, reason, detail); });
      else if (reason === 'sector') safe(function () { mod.render(el); });
    });
    refreshSticky();
  }
  function commit(key, value) {
    SHIFT.save();
    var detail = { key: key, value: value };
    propagate('state', detail);
    SHIFT.emit('state', detail);
  }

  SHIFT.setLang = function (l) {
    if (l !== 'ar' && l !== 'en') return false;
    if (l === state.lang && SHIFT.mounted) return false;
    // Each language has its own URL: go there instead of re-rendering in place (keeps utm_* and the hash).
    if (SHIFT.mounted && PAGE && PAGE.alternates && PAGE.alternates[l]) {
      sSet(KEY_LANG, l);
      w.location.href = PAGE.alternates[l] + w.location.search + w.location.hash;
      return true;
    }
    state.lang = l;
    applyLang();
    sSet(KEY_LANG, l);
    if (SHIFT.mounted) {
      renderShell();
      forEachSection(function (mod, el) {
        safe(function () { mod.render(el); });
        if (typeof mod.update === 'function') safe(function () { mod.update(el, 'lang'); });
      });
      refreshSticky();
    }
    SHIFT.emit('lang', l);
    return true;
  };

  function seoPage(k) { return path(C, 'seo.pages.' + k) || null; }
  SHIFT.seoPage = function (k) { return PAGE && PAGE.sector ? seoPage(k || state.sector) : null; };
  function syncSectorUrl(k) {
    var sp = seoPage(k);
    if (!PAGE || !PAGE.sector || !sp || !sp.path) return;
    PAGE.sector = k;
    PAGE.alternates = { ar: sp.path.ar, en: sp.path.en };
    try { w.history.replaceState(null, '', sp.path[state.lang] + w.location.search + w.location.hash); } catch (e) { /* noop */ }
    if (sp.title) d.title = SHIFT.tx(sp.title);
  }

  SHIFT.setSector = function (k) {
    if (!validSector(k) || k === state.sector) return false;
    state.sector = k;
    syncSectorUrl(k);
    if (!state.roiTouched) state.roi = roiDefaults(k);
    SHIFT.save();
    propagate('sector', k);
    SHIFT.emit('sector', k);
    if (SHIFT.mounted) SHIFT.track('sector_select', { sector: k });
    return true;
  };

  SHIFT.setBizName = function (n) {
    n = str(n).trim().slice(0, NAME_MAX);
    if (n === state.bizName) return;
    state.bizName = n;
    if (n) sSet(KEY_NAME, n); else sDel(KEY_NAME);
    commit('bizName', n);
  };

  SHIFT.toggleProduct = function (x) {
    var p = SHIFT.product(x);
    if (!p) return false;
    var i = state.bundle.indexOf(p.key), on;
    if (i > -1) { state.bundle.splice(i, 1); on = false; }
    else { state.bundle.push(p.key); on = true; }
    SHIFT.save();
    var keys = state.bundle.slice();
    propagate('bundle', keys);
    SHIFT.emit('bundle', keys);
    SHIFT.track(on ? 'product_add' : 'product_remove', { product: p.key });
    return on;
  };

  SHIFT.setNeed = function (keys) {
    keys = uniq((Array.isArray(keys) ? keys : []).filter(function (k) { return needKeys.indexOf(k) > -1; }));
    state.need = keys;
    commit('need', keys.slice());
  };
  SHIFT.toggleNeed = function (k) {
    if (needKeys.indexOf(k) === -1) return false;
    var i = state.need.indexOf(k), on;
    if (i > -1) { state.need.splice(i, 1); on = false; } else { state.need.push(k); on = true; }
    commit('need', state.need.slice());
    return on;
  };

  SHIFT.setRoi = function (patch) {
    var r = state.roi, changed = false;
    Object.keys(patch || {}).forEach(function (k) {
      if (!(k in r)) return;
      var v = Number(patch[k]);
      if (isFinite(v) && v !== r[k]) { r[k] = v; changed = true; }
    });
    if (!changed) return;
    state.roiTouched = true;
    commit('roi', Object.assign({}, r));
    SHIFT.track('roi_change', { monthly_value: SHIFT.roiCalc().loss });
  };
  SHIFT.resetRoi = function () {
    state.roi = roiDefaults(state.sector);
    state.roiTouched = false;
    commit('roi', Object.assign({}, state.roi));
  };

  SHIFT.setContact = function (p) {
    p = p || {};
    var c = state.contact, changed = false;
    ['name', 'phone'].forEach(function (k) {
      if (!(k in p)) return;
      var v = str(p[k]).trim().slice(0, 60);
      if (v !== c[k]) { c[k] = v; changed = true; }
    });
    if (changed) commit('contact', Object.assign({}, c));
  };

  /* ------------------------------------------------------------------ clock */
  var TF = {};
  function timeFmt(lang) {
    var loc = lang === 'en' ? 'en-US' : 'ar-JO-u-nu-latn';
    if (!(loc in TF)) {
      try { TF[loc] = new Intl.DateTimeFormat(loc, { hour: 'numeric', minute: '2-digit' }); } catch (e) { TF[loc] = null; }
    }
    return TF[loc];
  }
  SHIFT.timeText = function (date, lang) {
    lang = lang || state.lang;
    var f = timeFmt(lang);
    if (f) { try { return f.format(date); } catch (e) { /* fall through */ } }
    var h = date.getHours(), m = date.getMinutes(), h12 = h % 12 || 12;
    var suffix = lang === 'en' ? (h < 12 ? 'AM' : 'PM') : (h < 12 ? 'ص' : 'م');
    return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + suffix;
  };
  SHIFT.nowText = function (lang) { return SHIFT.timeText(new Date(), lang); };

  function hourNow() { var n = new Date(); return n.getHours() + n.getMinutes() / 60; }
  function hoursOf(k) {
    var s = SECTOR_DATA[k || state.sector];
    var h = (s && s.hours) || {};
    return { open: num(h.open, 9), close: num(h.close, 21), fridayClosed: !!h.fridayClosed };
  }
  SHIFT.isFriday = function () { return new Date().getDay() === 5; };
  SHIFT.isRamadan = function () {
    try { return new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { month: 'numeric' }).format(new Date()) === '9'; }
    catch (e) { return false; }
  };
  SHIFT.isNight = function (k) { var h = hourNow(), o = hoursOf(k); return h < NIGHT_END || h >= o.close; };
  SHIFT.isMorning = function (k) { var h = hourNow(), o = hoursOf(k); return h >= NIGHT_END && h < o.open; };
  SHIFT.isPeak = function (k) { var h = hourNow(), o = hoursOf(k); return h >= o.open && h < o.close; };
  SHIFT.isPromo = function (k) {
    var s = SECTOR_DATA[k || state.sector], p = s && s.promoVariant;
    if (!p) return false;
    var h = hourNow();
    return h >= num(p.from, 21) && h < num(p.to, 24);
  };
  SHIFT.scenario = function (k) {
    k = k || state.sector;
    var s = SECTOR_DATA[k], chat = (s && s.chat) || {}, key;
    if (SHIFT.isFriday() && hoursOf(k).fridayClosed && chat.friday) key = 'friday';
    else if (s && s.ramadanVariant && chat.ramadan && SHIFT.isRamadan()) key = 'ramadan';
    else if (chat.promo && SHIFT.isPromo(k)) key = 'promo';
    else key = SHIFT.isPeak(k) ? 'peak' : (SHIFT.isMorning(k) ? 'morning' : 'night');
    if (!chat[key]) key = chat.night ? 'night' : (Object.keys(chat)[0] || 'night');
    return key;
  };
  SHIFT.phase = function () {
    var h = hourNow();
    return (h < NIGHT_END || h >= OWN_NIGHT) ? 'night' : (h < OWN_MORNING_END ? 'morning' : 'peak');
  };
  SHIFT.clock = function () {
    var n = new Date();
    return { date: n, hour: n.getHours() + n.getMinutes() / 60, text: SHIFT.timeText(n), phase: SHIFT.phase(), friday: SHIFT.isFriday(), ramadan: SHIFT.isRamadan() };
  };
  SHIFT.hoursLine = function () { return SHIFT.t('templates.hours_line_' + SHIFT.phase(), { time: SHIFT.nowText() }); };

  /* --------------------------------------------------------------- WhatsApp */
  function attributionText() {
    var a = state.attribution || {};
    if (a.utm_source) return a.utm_source + (a.utm_campaign ? '/' + a.utm_campaign : '');
    if (a.fbclid) return 'facebook';
    if (a.gclid) return 'google';
    return '';
  }
  function joiner() { return SHIFT.tx(path(C, 'templates.composed.joiner')) || (state.lang === 'ar' ? '، ' : ', '); }
  function maxChars() { return num(path(C, 'templates.composed.max_chars'), 700); }
  // «عندي كافيه زيتون.» only when the visitor typed that name; otherwise «عندي مطعم أو كافيه.» — outgoing messages must never
  // claim the sector's illustrative exampleName as the lead's own business (SHIFT.bizName() with that fallback is for on-page demos).
  function businessLine() {
    var P = path(C, 'templates.composed') || {}, s = SHIFT.sector();
    if (state.bizName) return SHIFT.tx(P.business_named, { name: state.bizName });
    return s ? SHIFT.tx(P.business_sector, { sector: SHIFT.tx(s.label) }) : '';
  }
  function baseVars() {
    var s = SHIFT.sector(), r = SHIFT.roiCalc();
    return {
      name: state.bizName,
      business: state.bizName || (s ? SHIFT.tx(s.label) : ''),
      business_line: businessLine(),
      sector: s ? SHIFT.tx(s.label) : '',
      bundle: state.bundle.map(SHIFT.productName).filter(Boolean).join(joiner()),
      need: state.need.map(SHIFT.needLabel).filter(Boolean).join(joiner()),
      msgs: SHIFT.fmtNum(state.roi.msgsPerDay),
      loss: SHIFT.fmtNum(r.loss),
      hours: SHIFT.fmtNum(r.hours),
      attribution: attributionText()
    };
  }
  function clampMsg(msg, max) {
    msg = msg.replace(/\s+/g, ' ').trim();
    if (msg.length <= max) return msg;
    var cut = msg.lastIndexOf(' ', max - 1);
    if (cut < max * 0.6) cut = max - 1;
    return msg.slice(0, cut).replace(/[،,\s]+$/, '') + '…';
  }
  SHIFT.composeMessage = function (kind, vars) {
    var T = C.templates || {};
    var v = Object.assign(baseVars(), vars || {});
    var max = maxChars();
    if (kind && kind !== 'composed' && T[kind]) return clampMsg(SHIFT.tx(T[kind], v), max);

    var P = T.composed || {};
    var parts = [];
    // Parts are joined with spaces; a part without terminal punctuation (e.g. «الاسم: …») gets a period so lines don't run together.
    function add(key, text, drop) {
      if (!text) return;
      text = String(text).trim();
      if (/[\p{L}\p{N}]$/u.test(text)) text += '.';   // ends in a letter/digit → close the sentence; «👋» or «؟» stay as they are
      parts.push({ key: key, text: text, drop: drop == null ? 99 : drop });
    }
    add('greeting', SHIFT.tx(P.greeting));
    add('business', v.business_line);
    if (v.bundle) add('bundle', SHIFT.tx(P.bundle, { bundle: v.bundle }), 6);
    if (v.need) add('need', SHIFT.tx(P.need, { need: v.need }), 2);
    // Calculator numbers join the message only after the visitor actually used the calculator.
    if (state.roiTouched) {
      var r = SHIFT.roiCalc();
      add('roi', r.loss > 0
        ? SHIFT.tx(P.msgs, { msgs: v.msgs }) + ' ' + SHIFT.tx(P.loss, { loss: v.loss })
        : SHIFT.tx(P.msgs_only, { msgs: v.msgs }), 5);
    }
    if (state.contact.name) add('name', SHIFT.tx(P.name_line, { name: state.contact.name }), 4);
    if (state.contact.phone) add('phone', SHIFT.tx(P.phone_line, { phone: state.contact.phone }), 3);
    add('closing', SHIFT.tx(P.closing));
    if (v.attribution) add('attribution', SHIFT.tx(P.attribution, { attribution: v.attribution }), 1);

    function text() { return parts.map(function (p) { return p.text; }).join(' '); }
    var msg = text();
    while (msg.length > max) {
      var idx = -1, best = 99;
      parts.forEach(function (p, i) { if (p.drop < best) { best = p.drop; idx = i; } });
      if (idx === -1 || best === 99) break;
      parts.splice(idx, 1);
      msg = text();
    }
    return clampMsg(msg, max);
  };
  SHIFT.waUrl = function (msg) {
    if (msg == null) msg = SHIFT.composeMessage();
    return 'https://wa.me/' + SHIFT.WA + '?text=' + encodeURIComponent(msg);
  };
  SHIFT.waLink = function (placement, msg) {
    SHIFT.track('whatsapp_click', { placement: placement || 'unknown', sector: state.sector, bundle: state.bundle.join(',') });
    return SHIFT.waUrl(msg);
  };
  function refreshWaHrefs() {
    var url = SHIFT.waUrl();
    var nodes = d.querySelectorAll('[data-wa]:not([data-wa-kind])');
    for (var i = 0; i < nodes.length; i++) nodes[i].setAttribute('href', url);
  }

  /* ------------------------------------------------------------------ shell */
  function waAnchor(placement, cls, inner, extra) {
    return '<a class="' + cls + '" href="' + SHIFT.esc(SHIFT.waUrl()) + '" data-wa="' + placement + '" target="_blank" rel="noopener"' + (extra || '') + '>' + inner + '</a>';
  }
  function renderNav() {
    var el = byId('nav');
    if (!el) return;
    var links = [['karam', 'nav_karam'], ['cases', 'nav_sectors'], ['products', 'nav_products'], ['roi', 'nav_roi'], ['contact', 'nav_contact']]
      .map(function (l) { return '<a href="#' + l[0] + '">' + SHIFT.esc(SHIFT.t(l[1])) + '</a>'; }).join('');
    var other = state.lang === 'ar' ? 'en' : 'ar';
    el.innerHTML =
      '<a class="skip" href="#main">' + SHIFT.esc(SHIFT.t('skip_to_content')) + '</a>' +
      '<div class="wrap nav-in">' +
        '<div class="nav-start">' +
          '<a class="nav-logo" href="' + SHIFT.esc(PAGE && PAGE.sector && PAGE.home ? PAGE.home : '#top') + '" aria-label="' + SHIFT.esc(SHIFT.t('brand_full')) + '">' +
            '<span class="nav-mark" aria-hidden="true"></span>' +
            '<span class="nav-word">' + SHIFT.esc(SHIFT.t('brand')) + '</span>' +
          '</a>' +
          '<nav class="nav-links" aria-label="' + SHIFT.esc(SHIFT.t('nav_aria')) + '">' + links + '</nav>' +
        '</div>' +
        '<div class="nav-end">' +
          '<button type="button" class="nav-lang" data-action="lang" lang="' + other + '" aria-label="' + SHIFT.esc(SHIFT.t('lang_toggle_aria')) + '">' + SHIFT.esc(SHIFT.t(state.lang === 'ar' ? 'lang_en' : 'lang_ar')) + '</button>' +
          // Mobile: 40px green circle. ≥768: the same anchor becomes a 44px green pill with the «واتساب» label (CSS).
          waAnchor('nav', 'nav-wa', '<span class="nav-wa-circle">' + SHIFT.icon('whatsapp', { size: 20 }) + '</span>' +
            '<span class="nav-wa-label">' + SHIFT.esc(SHIFT.t('footer_whatsapp')) + '</span>', ' aria-label="' + SHIFT.esc(SHIFT.t('nav_whatsapp_aria')) + '"') +
        '</div>' +
      '</div>';
  }
  function renderAbout() {
    var el = byId('about');
    if (!el) return;
    el.hidden = false;
    el.innerHTML =
      '<div class="wrap">' +
        '<div class="sec-head">' +
          '<p class="eyebrow">' + SHIFT.esc(SHIFT.t('sections.about.eyebrow')) + '</p>' +
          '<h2>' + SHIFT.rich(SHIFT.t('sections.about.title')) + '</h2>' +
        '</div>' +
        '<p class="about-text">' + SHIFT.rich(SHIFT.t('sections.about.intro')) + '</p>' +
        '<p class="about-also small muted">' + SHIFT.rich(SHIFT.t('sections.about.alsoServe')) + '</p>' +
      '</div>';
  }
  function renderFooter() {
    var el = byId('footer');
    if (!el) return;
    var fb = str(path(C, 'contact.facebookUrl'));
    el.innerHTML =
      '<div class="wrap footer-in">' +
        '<div class="footer-brand"><span class="nav-mark" aria-hidden="true"></span><span>' + SHIFT.rich(SHIFT.t('footer_brand')) + '</span></div>' +
        '<p class="footer-line">' + SHIFT.rich(SHIFT.t('footer_line')) + '</p>' +
        '<nav class="footer-links" aria-label="' + SHIFT.esc(SHIFT.t('nav_aria')) + '">' +
          '<a href="/privacy">' + SHIFT.esc(SHIFT.t('footer_privacy')) + '</a>' +
          '<a href="/data-deletion">' + SHIFT.esc(SHIFT.t('footer_data_deletion')) + '</a>' +
          '<a href="/terms">' + SHIFT.esc(SHIFT.t('footer_terms')) + '</a>' +
          (fb ? '<a href="' + SHIFT.esc(fb) + '" target="_blank" rel="noopener">' + SHIFT.esc(SHIFT.t('footer_facebook')) + '</a>' : '') +
          waAnchor('footer', '', SHIFT.icon('whatsapp', { size: 18 }) + SHIFT.esc(SHIFT.t('footer_whatsapp'))) +
        '</nav>' +
        sectorLinks() +
        '<div class="footer-copy">' + SHIFT.rich(SHIFT.t('footer_copyright')) + '</div>' +
      '</div>';
  }
  function sectorLinks() {
    var pages = path(C, 'seo.pages');
    if (!pages) return '';
    var links = Object.keys(pages).map(function (k) {
      var sp = pages[k];
      if (!sp || !sp.path || !sp.link) return '';
      var cur = PAGE && PAGE.sector === k ? ' aria-current="page"' : '';
      return '<a href="' + SHIFT.esc(sp.path[state.lang]) + '"' + cur + '>' + SHIFT.esc(SHIFT.tx(sp.link)) + '</a>';
    }).join('');
    return '<nav class="footer-links footer-sectors" aria-label="' + SHIFT.esc(SHIFT.t('footer_sectors_aria')) + '">' + links + '</nav>';
  }
  function renderSticky() {
    var el = byId('sticky');
    if (!el) return;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', SHIFT.t('sticky_aria'));
    el.innerHTML = waAnchor('sticky', 'btn btn-wa btn-block', SHIFT.icon('whatsapp', { size: 20 }) + '<span class="sticky-label">' + SHIFT.esc(stickyLabel()) + '</span>');
  }
  function renderShell() { renderNav(); renderAbout(); renderFooter(); renderSticky(); }

  /* ------------------------------------------------------- sticky + observers */
  var currentSection = 'top';
  var ctaIO = null, viewIO = null, curIO = null;
  var ctaVisible = new Map();

  function stickyLabel() {
    if (currentSection === 'contact') return SHIFT.t('sticky_contact');
    if (state.bundle.length) return SHIFT.t('sticky_bundle');
    return SHIFT.t('sticky_default');
  }
  function updateStickyLabel() {
    var el = byId('sticky');
    var lab = el && el.querySelector('.sticky-label');
    if (lab) lab.textContent = stickyLabel();
  }
  function updateStickyHidden() {
    var el = byId('sticky');
    if (!el) return;
    var any = false;
    ctaVisible.forEach(function (v, node) { if (v && node.isConnected) any = true; });
    el.classList.toggle('is-hidden', any);
  }
  // Re-scan the page for CTAs after any render: observers keep pointing at live elements.
  function refreshSticky() {
    if (ctaIO) {
      ctaIO.disconnect();
      ctaVisible.clear();
      var ctas = d.querySelectorAll('[data-cta="top"],[data-cta="contact"]');
      for (var i = 0; i < ctas.length; i++) ctaIO.observe(ctas[i]);
    }
    updateStickyLabel();
    refreshWaHrefs();
  }
  function setupObservers() {
    if (!('IntersectionObserver' in w)) return;
    viewIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        viewIO.unobserve(en.target);
        SHIFT.track('section_view', { id: en.target.id });
      });
      // Fires once the section reaches the middle 40% band of the viewport, whatever its height — an element-ratio threshold
      // (0.3 of the section) can never be met by #products on small phones (2262px tall at 360×640 → max 28% on screen).
    }, { threshold: 0, rootMargin: '-30% 0px -30% 0px' });
    curIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { currentSection = en.target.id; updateStickyLabel(); }
      });
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    ctaIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { ctaVisible.set(en.target, en.isIntersecting); });
      updateStickyHidden();
    }, { threshold: 0.2 });
    SHIFT.ORDER.concat(['about']).forEach(function (id) {
      var el = byId(id);
      if (el && !el.hidden) { viewIO.observe(el); curIO.observe(el); }
    });
    refreshSticky();
  }

  SHIFT.onVisible = function (el, onEnter, onLeave, opts) {
    if (!el) return function () { /* noop */ };
    if (!('IntersectionObserver' in w)) {
      if (onEnter) safe(function () { onEnter(el, null); });
      return function () { /* noop */ };
    }
    opts = opts || {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { if (onEnter) safe(function () { onEnter(el, en); }); }
        else if (onLeave) safe(function () { onLeave(el, en); });
      });
    }, { threshold: opts.threshold == null ? 0.25 : opts.threshold, rootMargin: opts.rootMargin || '0px' });
    io.observe(el);
    return function () { io.disconnect(); };
  };
  SHIFT.debounce = function (fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  /* ------------------------------------------------------------- delegation */
  function bindGlobal() {
    d.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || typeof t.closest !== 'function') return;
      var wa = t.closest('[data-wa]');
      if (wa) {
        var kind = wa.getAttribute('data-wa-kind') || undefined;
        var vars = {};
        Object.keys(wa.dataset).forEach(function (k) {
          if (k === 'wa' || k === 'waKind' || k.indexOf('wa') !== 0 || k.length < 3) return;
          vars[k.charAt(2).toLowerCase() + k.slice(3)] = wa.dataset[k];
        });
        wa.setAttribute('href', SHIFT.waLink(wa.getAttribute('data-wa'), SHIFT.composeMessage(kind, vars)));
        return;
      }
      var act = t.closest('[data-action]');
      if (!act) return;
      var a = act.getAttribute('data-action');
      if (a === 'lang') { e.preventDefault(); SHIFT.setLang(state.lang === 'ar' ? 'en' : 'ar'); }
      else if (a === 'sector') { SHIFT.setSector(act.getAttribute('data-sector')); }
      else if (a === 'product') { SHIFT.toggleProduct(act.getAttribute('data-product')); }
    });
  }

  /* ----------------------------------------------------------------- mount */
  SHIFT.register = function (mod) {
    if (mod && mod.id) SHIFT.sections[mod.id] = mod;
    return mod;
  };
  SHIFT.rerender = function (id, reason) {
    var mod = SHIFT.sections[id], el = byId(id);
    if (!mod || !el) return;
    safe(function () { mod.render(el); });
    if (typeof mod.update === 'function') safe(function () { mod.update(el, reason || 'rerender'); });
    refreshSticky();
  };
  SHIFT.mount = function () {
    if (SHIFT.mounted) return;
    applyLang();
    renderShell();
    SHIFT.ORDER.forEach(function (id) {
      var el = byId(id), mod = SHIFT.sections[id];
      if (!el) return;
      if (!mod || typeof mod.render !== 'function') { el.hidden = true; return; }
      el.hidden = false;
      safe(function () { mod.render(el); });
      if (typeof mod.init === 'function') safe(function () { mod.init(el); });
    });
    bindGlobal();
    setupObservers();
    SHIFT.mounted = true;
    refreshSticky();
    SHIFT.emit('mount', state);
    SHIFT.track('page_view', {});
  };

  /* ------------------------------------------------------------------ boot */
  restore();
  if (readUrl()) SHIFT.save();
  if (PAGE && validSector(PAGE.sector) && state.sector !== PAGE.sector) {
    state.sector = PAGE.sector;
    if (!state.roiTouched) state.roi = roiDefaults(PAGE.sector);
    SHIFT.save();
  }
  applyLang();
})(window, document);
