/*! shifts-ai.store — sections/cases.js — #cases: three sector chips (tabs) + المشكلة → ما يفعله كرم → النتيجة + FAQ
 * Vanilla ES2019, classic <script>. Depends on content.js + core.js (window.SHIFT).
 *
 * Renders (contract "Page order 4" + "Sector focus — exactly three"):
 *   sec-head → ONE row of three pills (role=tablist/tab, 48px; selected = ink fill, white text, check — premium
 *   direction) bound to SHIFT.setSector through core's delegated data-action="sector" →
 *   ONE tabpanel holding only the selected sector: «مثال: {name}» + «مثال توضيحي» badge, the three blocks
 *   المشكلة → ما يفعله كرم → النتيجة as ONE light card (.card) with hairline dividers and 32px .ic-holder glyphs,
 *   a compact FAQ (6 × <details>, hairline rows, chevron), and a quiet underlined text link «اسأل عن {sector}»
 *   (.link-quiet, data-wa="cases": core's delegated handler calls SHIFT.waLink('cases') with the composed message at
 *   click time and keeps the href fresh on state changes).
 *
 * Only the selected sector's panel exists in the DOM — the other two are never rendered, so no cross-sector text.
 * Every string comes from content.js (sectors[key].label/cases/faq + ui.cases_*). No timers, no observers:
 * nothing runs on- or off-screen. Keyboard: Left/Right/Home/End on the tabs (reading-direction aware).
 * update(): 'sector' patches the tabs and swaps the panel in place (focus stays on the tablist);
 *           'state' {key:'bizName'} refreshes the example line; 'lang' — core already re-rendered.
 */
(function (w, d) {
  'use strict';
  if (!w.SHIFT) return;
  var SHIFT = w.SHIFT;

  var ID = 'cases';
  var PANEL_ID = 'cases-panel';
  var TAB_PREFIX = 'cases-tab-';
  var FAQ_MAX = 6;

  // Chip glyph per sector — not user-facing text; the same glyphs the builder's business options use.
  var ICON_BY_SECTOR = { clinic: 'stethoscope', restaurant: 'utensils', store: 'shopping-bag' };
  // The three blocks, in reading order. `label` = ui key; `key` = field of sectors[k].cases; `icon` = the
  // decorative 16px glyph in the block's 32px .ic-holder (not user-facing text).
  var BLOCKS = [
    { key: 'problem', label: 'cases_problem', icon: 'alert' },
    { key: 'karam', label: 'cases_karam', icon: 'bot' },
    { key: 'result', label: 'cases_result', icon: 'check' }
  ];

  /* ------------------------------------------------------------ helpers */
  function sectors() { return (SHIFT.content && SHIFT.content.sectors) || {}; }
  function sectorOf(key) { return sectors()[key] || null; }
  function sectorKeys() { return SHIFT.SECTORS.filter(sectorOf); }
  function isRtl() { return (d.documentElement.getAttribute('dir') || 'rtl') !== 'ltr'; }
  function lcFirst(s) { s = String(s || ''); return s.charAt(0).toLowerCase() + s.slice(1); }
  function nextFrame(fn) {
    if (typeof w.requestAnimationFrame === 'function') {
      w.requestAnimationFrame(function () { w.requestAnimationFrame(fn); });
    } else { fn(); }
  }

  // «اسأل عن عيادة» / "Ask about your clinic" — the English label is lower-cased mid-sentence.
  function askLabel(s) {
    var label = SHIFT.tx(s && s.label);
    if (SHIFT.state.lang === 'en') label = lcFirst(label);
    return SHIFT.t('cases_ask_sector', { sector: label });
  }

  /* -------------------------------------------------------- tabs (chips) */
  function tabHtml(key, current) {
    var s = sectorOf(key), on = key === current;
    return '<button type="button" role="tab" id="' + TAB_PREFIX + key + '" class="chip cases-chip' + (on ? ' is-on' : '') + '"' +
      ' aria-selected="' + (on ? 'true' : 'false') + '" aria-controls="' + PANEL_ID + '" tabindex="' + (on ? '0' : '-1') + '"' +
      ' data-action="sector" data-sector="' + key + '">' +
      SHIFT.icon(ICON_BY_SECTOR[key] || 'store', { size: 15, cls: 'cases-chip-ic' }) +
      '<span class="cases-chip-label">' + SHIFT.rich(SHIFT.tx(s && s.label)) + '</span>' +
      SHIFT.icon('check', { size: 15, cls: 'chip-check' }) +
    '</button>';
  }
  function tabsHtml(current) {
    return sectorKeys().map(function (k) { return tabHtml(k, current); }).join('');
  }

  /* --------------------------------------------------------------- panel */
  function exampleHtml() {
    return '<p class="cases-example small muted">' +
      SHIFT.rich(SHIFT.t('cases_example')) + ': ' +
      '<strong class="cases-example-name">' + SHIFT.rich(SHIFT.bizName()) + '</strong>' +
    '</p>';
  }
  function blocksHtml(s) {
    // One light card; the hairline dividers between blocks are CSS borders (stacked → horizontal, ≥768 → vertical).
    var c = (s && s.cases) || {};
    return BLOCKS.map(function (b) {
      return '<div class="cases-block cases-block-' + b.key + '">' +
          '<span class="ic-holder" aria-hidden="true">' + SHIFT.icon(b.icon, { size: 16 }) + '</span>' +
          '<div class="cases-block-body">' +
            '<h3 class="cases-block-label">' + SHIFT.rich(SHIFT.t(b.label)) + '</h3>' +
            '<p class="cases-block-text">' + SHIFT.rich(SHIFT.tx(c[b.key])) + '</p>' +
          '</div>' +
        '</div>';
    }).join('');
  }
  function faqHtml(s) {
    var list = (s && Array.isArray(s.faq)) ? s.faq.slice(0, FAQ_MAX) : [];
    if (!list.length) return '';
    return '<div class="cases-faq">' +
      '<h3 class="cases-faq-title">' + SHIFT.rich(SHIFT.t('cases_faq_title')) + '</h3>' +
      '<div class="cases-faq-list">' +
        list.map(function (item, i) {
          return '<details class="cases-q" data-i="' + i + '">' +
            '<summary class="cases-q-sum">' +
              '<span class="cases-q-text">' + SHIFT.rich(SHIFT.tx(item && item.q)) + '</span>' +
              SHIFT.icon('chevron', { size: 18, cls: 'cases-q-ic' }) +
            '</summary>' +
            '<div class="cases-a"><p>' + SHIFT.rich(SHIFT.tx(item && item.a)) + '</p></div>' +
          '</details>';
        }).join('') +
      '</div>' +
    '</div>';
  }
  function ctaHtml(s) {
    return '<div class="cases-cta">' +
      '<a class="link-quiet cases-ask" href="' + SHIFT.esc(SHIFT.waHref()) + '" data-wa="cases" target="_blank" rel="noopener">' +
        SHIFT.icon('whatsapp', { size: 16 }) +
        '<span>' + SHIFT.rich(askLabel(s)) + '</span>' +
      '</a>' +
    '</div>';
  }
  function panelHtml() {
    var s = sectorOf(SHIFT.state.sector);
    if (!s) return '';
    return '<div class="cases-panel-head">' +
        exampleHtml() +
        '<span class="badge badge-example">' + SHIFT.esc(SHIFT.t('illustrative')) + '</span>' +
      '</div>' +
      '<div class="card cases-flow" role="group" aria-label="' + SHIFT.esc(SHIFT.t('cases_flow_aria')) + '">' +
        blocksHtml(s) +
      '</div>' +
      faqHtml(s) +
      ctaHtml(s);
  }

  /* -------------------------------------------------------------- render */
  function render(el) {
    var key = SHIFT.state.sector;
    el.innerHTML =
      '<div class="wrap cases-in">' +
        '<div class="sec-head">' +
          '<p class="eyebrow">' + SHIFT.rich(SHIFT.t('sections.cases.eyebrow')) + '</p>' +
          '<h2>' + SHIFT.rich(SHIFT.t('sections.cases.title')) + '</h2>' +
          '<p class="intro">' + SHIFT.rich(SHIFT.t('sections.cases.intro')) + '</p>' +
        '</div>' +
        '<div class="cases-tabs" role="tablist" aria-label="' + SHIFT.esc(SHIFT.t('cases_pick_aria')) + '">' +
          tabsHtml(key) +
        '</div>' +
        '<div class="cases-panel" role="tabpanel" id="' + PANEL_ID + '" aria-labelledby="' + TAB_PREFIX + key + '" data-sector="' + SHIFT.esc(key) + '">' +
          panelHtml() +
        '</div>' +
      '</div>';
  }

  /* ------------------------------------------------- in-place updates */
  function patchTabs(el) {
    var key = SHIFT.state.sector;
    var tabs = el.querySelectorAll('.cases-tabs [role="tab"]');
    if (!tabs.length) return false;
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-sector') === key;
      tabs[i].classList.toggle('is-on', on);
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[i].setAttribute('tabindex', on ? '0' : '-1');
    }
    return true;
  }
  function swapPanel(el) {
    var key = SHIFT.state.sector;
    var panel = el.querySelector('#' + PANEL_ID);
    if (!panel) return false;
    panel.setAttribute('aria-labelledby', TAB_PREFIX + key);
    panel.setAttribute('data-sector', key);
    panel.classList.add('is-new');
    panel.innerHTML = panelHtml();
    // Two frames so the initial opacity:0 / translateY(4px) is committed before the 160 ms transition.
    nextFrame(function () { panel.classList.remove('is-new'); });
    return true;
  }
  function patchName(el) {
    var n = el.querySelector('.cases-example-name');
    if (n) n.innerHTML = SHIFT.rich(SHIFT.bizName());
  }

  /* ------------------------------------------------------------ keyboard */
  // Roving tabindex: Left/Right move along the row in reading direction; Home/End jump. Selecting follows focus.
  function onKeydown(e) {
    var t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    var tab = t.closest('.cases-tabs [role="tab"]');
    if (!tab) return;
    var tabs = Array.prototype.slice.call(tab.parentNode.querySelectorAll('[role="tab"]'));
    var n = tabs.length, i = tabs.indexOf(tab), next;
    if (!n || i < 0) return;
    var fwd = isRtl() ? 'ArrowLeft' : 'ArrowRight';   // DOM order flows in the reading direction
    var back = isRtl() ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === fwd) next = (i + 1) % n;
    else if (e.key === back) next = (i - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else return;
    e.preventDefault();
    tabs[next].focus();
    SHIFT.setSector(tabs[next].getAttribute('data-sector'));
  }

  /* --------------------------------------------------------------- module */
  SHIFT.sections[ID] = {
    id: ID,
    render: render,
    init: function (el) {
      // Clicks are handled by core's delegated data-action="sector"; only the arrow keys live here.
      el.addEventListener('keydown', onKeydown);
    },
    update: function (el, reason, detail) {
      if (reason === 'sector') {
        // core did NOT re-render on 'sector': patch the chips and swap the panel, keeping the tablist DOM (and focus).
        if (!patchTabs(el) || !swapPanel(el)) render(el);
        return;
      }
      if (reason === 'state' && detail && detail.key === 'bizName') { patchName(el); return; }
      // 'lang' / any full re-render: core already rendered the current state; there is nothing to restart here.
    }
  };
})(window, document);
