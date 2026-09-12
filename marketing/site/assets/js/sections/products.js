/*! shifts-ai.store — sections/products.js — #products: the 8 products + «باقتي» bundle
 * Vanilla ES2019, classic <script>. Depends only on window.SHIFT (core.js) and SHIFT_CONTENT (content.js).
 *
 * What it renders (contract "Page order 5")
 *   sec-head → .prod-grid:
 *     • Karam = full-width light .card with a 1.5px gold border + .badge-flagship «المنتج الرئيسي» (the only gold here),
 *       tagline, «جرّبه الآن» (→ #karam, ink pill), «أضِفه لباقتي», «اسأل عن كرم بوت», «التفاصيل» toggle.
 *     • 7 compact light .card (hairline, no shadow): 32px .ic-holder circle · title 15px · one-line tagline 13px muted
 *       · the same two actions: «أضِفه لباقتي» = 44px outline pill (ink-filled while in the bundle) and
 *       «اسأل عن …» = green text link with the WhatsApp glyph.
 *     • one .prod-details block per product (ماذا يفعل / الأنسب لـ / يعمل مع) rendered right after its card:
 *         <640px  the details sit under their header (accordion, one open, 160 ms opacity, aria-expanded);
 *         ≥640px  the grid has 2 columns (4 at ≥1024) and .prod-details is a full-row item with order:99,
 *                 so the open product's details show as ONE panel below the grid — same DOM, CSS decides.
 *   → bundle bar (light .card, hidden while state.bundle is empty): «3 منتجات في باقتك» + names + green pill «أرسل لي عرض الباقة».
 *
 * Wiring
 *   «أضِفه لباقتي»  data-action="product" data-product="<key>" → core's delegated handler → SHIFT.toggleProduct(key)
 *                   → core calls update(el,'bundle',keys): buttons + bar are patched in place (focus is kept).
 *   «اسأل عن …»     <a data-wa="product:<key>" data-wa-kind="ask_about_product" data-wa-product="<name>">
 *                   → core calls SHIFT.waLink('product:<key>', composeMessage('ask_about_product',{product})) at click time.
 *   bundle CTA      <a data-wa="bundle"> → SHIFT.waLink('bundle') with the full composed message (core keeps its href fresh).
 *   Sector-aware part: «الأنسب لـ» marks SHIFT.state.sector — update(el,'sector') re-renders; 'lang' is re-rendered by core.
 *   No timers, no observers: nothing can run while the section is off-screen. Not a simulation → no «مثال توضيحي» badge.
 */
(function (w, d) {
  'use strict';

  var SHIFT = w.SHIFT;
  if (!SHIFT) return;

  var ID = 'products';
  var PANEL_MQ = '(min-width:640px)';                       // mirrors products.css: grid + one panel below the grid
  var SECTOR_ICON = { clinic: 'stethoscope', restaurant: 'utensils', store: 'store' };

  /* ---- section-local state (survives re-renders; never persisted) ---- */
  var S = { open: null };   // key of the product whose details are open — one at a time

  /* ---- helpers ---- */
  function t(k, v) { return SHIFT.t(k, v); }
  function esc(s) { return SHIFT.esc(s); }
  function $(el, sel) { return el ? el.querySelector(sel) : null; }
  function $$(el, sel) { return el ? Array.prototype.slice.call(el.querySelectorAll(sel)) : []; }
  function products() { var ps = SHIFT.content && SHIFT.content.products; return Array.isArray(ps) ? ps : []; }
  function sectors() { return (SHIFT.content && SHIFT.content.sectors) || {}; }
  function byKey(key) { return products().filter(function (p) { return p.key === key; })[0] || null; }
  function panelMode() {
    try { return !!(w.matchMedia && w.matchMedia(PANEL_MQ).matches); } catch (e) { return false; }
  }
  function joiner() {
    var T = SHIFT.content && SHIFT.content.templates;
    return SHIFT.tx(T && T.composed && T.composed.joiner) || (SHIFT.state.lang === 'ar' ? '، ' : ', ');
  }
  function headId(p) { return 'prod-h-' + p.key; }
  function nameId(p) { return 'prod-n-' + p.key; }
  function tagId(p) { return 'prod-t-' + p.key; }
  function detId(p) { return 'prod-d-' + p.key; }
  function askHref(p) {
    return SHIFT.waUrl(SHIFT.composeMessage('ask_about_product', { product: SHIFT.tx(p.name) }));
  }

  /* ---- pieces (pure strings) ---- */
  function addInner(on) {
    return on
      ? SHIFT.icon('check', { size: 18 }) + '<span>' + esc(t('in_bundle')) + '</span>'
      : '<span class="prod-add-plus" aria-hidden="true">+</span><span>' + esc(t('add_to_bundle')) + '</span>';
  }
  function addBtn(p) {
    var on = SHIFT.inBundle(p.key);
    return '<button type="button" class="btn btn-ghost prod-add' + (on ? ' is-on' : '') + '" data-action="product" data-product="' + esc(p.key) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      addInner(on) +
    '</button>';
  }
  function askLink(p) {
    var name = SHIFT.tx(p.name);
    return '<a class="prod-ask" href="' + esc(askHref(p)) + '" data-wa="product:' + esc(p.key) + '" data-wa-kind="ask_about_product" data-wa-product="' + esc(name) + '" target="_blank" rel="noopener">' +
      SHIFT.icon('whatsapp', { size: 18 }) +
      '<span>' + SHIFT.rich(t('ask_about_product', { product: name })) + '</span>' +
    '</a>';
  }
  function chevron() { return SHIFT.icon('chevron', { size: 20, cls: 'prod-chev' }); }

  function tagChip(icon, label, on) {
    return '<li class="prod-tagchip' + (on ? ' is-on' : '') + '"' + (on ? ' aria-current="true"' : '') + '>' +
      SHIFT.icon(icon, { size: 16 }) +
      '<span>' + esc(label) + '</span>' +
      (on ? SHIFT.icon('check', { size: 16 }) + '<span class="sr-only"> · ' + esc(t('products_your_sector')) + '</span>' : '') +
    '</li>';
  }
  function detailsHtml(p) {
    var open = S.open === p.key;
    var sec = sectors(), cur = SHIFT.state.sector;
    var does = (p.does || []).map(function (x) {
      return '<li>' + SHIFT.icon('check', { size: 18 }) + '<span>' + SHIFT.rich(SHIFT.tx(x)) + '</span></li>';
    }).join('');
    var best = (p.bestFor || []).filter(function (k) { return !!sec[k]; }).map(function (k) {
      return tagChip(SECTOR_ICON[k] || 'store', SHIFT.tx(sec[k].label), k === cur);
    }).join('');
    var works = (p.worksWith || []).map(function (k) {
      var q = SHIFT.product(k);
      return q ? tagChip(q.icon, SHIFT.tx(q.name), false) : '';
    }).join('');
    return '<div class="prod-details' + (open ? ' is-open' : '') + '" id="' + detId(p) + '" role="region" aria-labelledby="' + nameId(p) + '"' + (open ? '' : ' hidden') + '>' +
      '<div class="card prod-d-in">' +
        '<div class="prod-d-head">' +
          '<span class="ic-holder prod-ic" aria-hidden="true">' + SHIFT.icon(p.icon, { size: 16 }) + '</span>' +
          '<div class="prod-d-titles">' +
            '<span class="prod-d-name">' + SHIFT.rich(SHIFT.tx(p.name)) + '</span>' +
            '<span class="prod-d-short small muted">' + SHIFT.rich(SHIFT.tx(p.short)) + '</span>' +
          '</div>' +
          '<button type="button" class="prod-d-close" data-act="close" aria-label="' + esc(t('close')) + '">' + SHIFT.icon('x', { size: 20 }) + '</button>' +
        '</div>' +
        (p.intro ? '<p class="prod-d-intro">' + SHIFT.rich(SHIFT.tx(p.intro)) + '</p>' : '') +
        '<div class="prod-d-cols">' +
          '<div class="prod-d-block prod-d-does"><h4>' + esc(t('what_it_does')) + '</h4><ul class="prod-d-list">' + does + '</ul></div>' +
          '<div class="prod-d-side">' +
            '<div class="prod-d-block"><h4>' + esc(t('best_for')) + '</h4><ul class="prod-d-chips">' + best + '</ul></div>' +
            '<div class="prod-d-block"><h4>' + esc(t('works_with')) + '</h4><ul class="prod-d-chips">' + works + '</ul></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function flagshipHtml(p) {
    var open = S.open === p.key;
    return '<article class="card prod-card prod-flag' + (open ? ' is-open' : '') + '" data-key="' + esc(p.key) + '">' +
      '<div class="flag-top">' +
        '<span class="ic-holder prod-ic flag-ic" aria-hidden="true">' + SHIFT.icon(p.icon, { size: 20 }) + '</span>' +
        '<span class="badge badge-flagship">' + esc(t('flagship')) + '</span>' +
      '</div>' +
      '<h3 class="flag-name" id="' + nameId(p) + '">' + SHIFT.rich(SHIFT.tx(p.name)) + '</h3>' +
      '<p class="flag-tag" id="' + tagId(p) + '">' + SHIFT.rich(SHIFT.tx(p.tagline)) + '</p>' +
      '<div class="prod-acts flag-acts">' +
        '<a class="btn btn-ink prod-try" href="#karam">' + SHIFT.icon('bot', { size: 18 }) + '<span>' + esc(t('see_demo')) + '</span></a>' +
        addBtn(p) +
        askLink(p) +
        '<button type="button" class="prod-more" id="' + headId(p) + '" data-act="details" data-key="' + esc(p.key) + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="' + detId(p) + '">' +
          '<span class="prod-more-label">' + esc(t(open ? 'hide_details' : 'show_details')) + '</span>' + chevron() +
        '</button>' +
      '</div>' +
    '</article>';
  }

  function compactHtml(p) {
    var open = S.open === p.key;
    return '<article class="card prod-card' + (open ? ' is-open' : '') + '" data-key="' + esc(p.key) + '">' +
      '<h3 class="prod-h3">' +
        '<button type="button" class="prod-head" id="' + headId(p) + '" data-act="details" data-key="' + esc(p.key) + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="' + detId(p) + '" aria-labelledby="' + nameId(p) + '" aria-describedby="' + tagId(p) + '">' +
          '<span class="ic-holder prod-ic" aria-hidden="true">' + SHIFT.icon(p.icon, { size: 16 }) + '</span>' +
          '<span class="prod-txt">' +
            '<span class="prod-name" id="' + nameId(p) + '">' + SHIFT.rich(SHIFT.tx(p.name)) + '</span>' +
            '<span class="prod-tag" id="' + tagId(p) + '">' + SHIFT.rich(SHIFT.tx(p.tagline)) + '</span>' +
          '</span>' +
          chevron() +
        '</button>' +
      '</h3>' +
      '<div class="prod-acts">' + addBtn(p) + askLink(p) + '</div>' +
    '</article>';
  }

  function countText(n) {
    if (n <= 0) return t('bundle_count_zero');
    if (n === 1) return t('bundle_count_one');
    if (n === 2) return t('bundle_count_two');
    return t('bundle_count_many', { n: SHIFT.fmtNum(n) });
  }
  function bundleNames() {
    return SHIFT.state.bundle.map(function (k) { return SHIFT.productName(k); }).filter(Boolean).join(joiner());
  }
  function barHtml() {
    var n = SHIFT.state.bundle.length;
    return '<div class="card prod-bundle" role="region" aria-label="' + esc(t('products_bundle_aria')) + '"' + (n ? '' : ' hidden') + '>' +
      '<div class="prod-bundle-txt">' +
        '<strong class="prod-bundle-count">' + esc(countText(n)) + '</strong>' +
        '<span class="prod-bundle-names small muted">' + SHIFT.rich(bundleNames()) + '</span>' +
      '</div>' +
      '<a class="btn btn-wa prod-bundle-cta" href="' + esc(SHIFT.waUrl()) + '" data-wa="bundle" target="_blank" rel="noopener">' +
        SHIFT.icon('whatsapp', { size: 20 }) + '<span>' + esc(t('bundle_cta')) + '</span>' +
      '</a>' +
    '</div>' +
    '<p class="sr-only" aria-live="polite" data-live></p>';
  }

  /* ---- render (pure: no timers, no listeners, no tracking) ---- */
  function render(el) {
    var ps = products();
    if (S.open && !byKey(S.open)) S.open = null;
    var flag = ps.filter(function (p) { return p.flagship; })[0] || ps[0] || null;
    var cards = '';
    if (flag) cards += flagshipHtml(flag) + detailsHtml(flag);
    ps.forEach(function (p) { if (p !== flag) cards += compactHtml(p) + detailsHtml(p); });

    el.setAttribute('aria-labelledby', 'products-title');
    el.innerHTML =
      '<div class="wrap">' +
        '<div class="sec-head">' +
          '<p class="eyebrow">' + SHIFT.rich(t('sections.products.eyebrow')) + '</p>' +
          '<h2 id="products-title">' + SHIFT.rich(t('sections.products.title')) + '</h2>' +
          '<p class="intro">' + SHIFT.rich(t('sections.products.intro')) + '</p>' +
        '</div>' +
        '<div class="prod-grid">' + cards + '</div>' +
        barHtml() +
      '</div>';
  }

  /* ---- accordion (<640) / panel below the grid (≥640): one open at a time ---- */
  function setMoreLabel(head, open) {
    var lab = head && head.querySelector('.prod-more-label');
    if (lab) lab.textContent = t(open ? 'hide_details' : 'show_details');
  }
  function closeOpen(el, refocus) {
    var key = S.open;
    S.open = null;
    if (!key) return;
    var card = $(el, '.prod-card[data-key="' + key + '"]');
    var head = $(el, '#prod-h-' + key);
    var det = $(el, '#prod-d-' + key);
    if (card) card.classList.remove('is-open');
    if (head) { head.setAttribute('aria-expanded', 'false'); setMoreLabel(head, false); }
    if (det) { det.classList.remove('is-open'); det.hidden = true; }
    if (refocus && head) { try { head.focus(); } catch (e) { /* noop */ } }
  }
  function openKey(el, key) {
    var card = $(el, '.prod-card[data-key="' + key + '"]');
    var head = $(el, '#prod-h-' + key);
    var det = $(el, '#prod-d-' + key);
    if (!card || !head || !det) return;
    S.open = key;
    card.classList.add('is-open');
    head.setAttribute('aria-expanded', 'true');
    setMoreLabel(head, true);
    det.hidden = false;
    // Two frames so opacity:0 is committed before the 160 ms fade (base.css collapses it under reduced motion).
    w.requestAnimationFrame(function () {
      w.requestAnimationFrame(function () { if (S.open === key) det.classList.add('is-open'); });
    });
    // Keep what just opened reachable: the panel below the grid (≥640) or the header (mobile — the previously
    // open item above it may have collapsed). scroll-margin in products.css keeps it clear of the nav / bundle bar.
    var target = panelMode() ? det : head;
    try { target.scrollIntoView({ block: 'nearest' }); } catch (e) { /* older engines: ignore */ }
  }
  function toggle(el, key) {
    var same = S.open === key;
    closeOpen(el, false);
    if (!same && byKey(key)) openKey(el, key);
  }

  /* ---- bundle: patch buttons + bar in place (a full re-render would drop focus from the button just clicked) ---- */
  function paintBar(el, announce) {
    var n = SHIFT.state.bundle.length;
    var bar = $(el, '.prod-bundle');
    if (bar) {
      var c = bar.querySelector('.prod-bundle-count');
      var names = bar.querySelector('.prod-bundle-names');
      if (c) c.textContent = countText(n);
      if (names) names.innerHTML = SHIFT.rich(bundleNames());
      bar.hidden = n === 0;
    }
    var live = $(el, '[data-live]');
    if (live && announce) live.textContent = countText(n);
  }
  function refreshBundle(el, keys) {
    keys = Array.isArray(keys) ? keys : SHIFT.state.bundle;
    $$(el, '.prod-add').forEach(function (b) {
      var on = keys.indexOf(b.getAttribute('data-product')) > -1;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.innerHTML = addInner(on);
    });
    paintBar(el, true);
  }

  /* ---- init: delegation on `el` (survives every re-render) ---- */
  function init(el) {
    el.addEventListener('click', function (e) {
      var tgt = e.target;
      if (!tgt || typeof tgt.closest !== 'function') return;
      var act = tgt.closest('[data-act]');
      if (!act || !el.contains(act)) return;
      var a = act.getAttribute('data-act');
      if (a === 'details') { e.preventDefault(); toggle(el, act.getAttribute('data-key')); }
      else if (a === 'close') { e.preventDefault(); closeOpen(el, true); }
    });
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      var tgt = e.target;
      if (!S.open || !tgt || typeof tgt.closest !== 'function' || !tgt.closest('.prod-details')) return;
      e.preventDefault();
      closeOpen(el, true);
    });
  }

  /* ---- update: 'sector' (we re-render — «الأنسب لـ» mark) · 'bundle' (patch in place)
          · 'lang' / 'rerender' (core already re-rendered from S.open; nothing to restart) ---- */
  function update(el, reason, detail) {
    if (reason === 'sector') { render(el); return; }
    if (reason === 'bundle') { refreshBundle(el, detail); return; }
  }

  SHIFT.sections[ID] = { id: ID, render: render, init: init, update: update };
})(window, document);
