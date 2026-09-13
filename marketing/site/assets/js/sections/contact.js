/*! shifts-ai.store — sections/contact.js — #contact: chips → two optional fields → WhatsApp-style preview → ONE green CTA
 * Vanilla ES2019, classic <script>. Depends on content.js + core.js (window.SHIFT).
 *
 * Renders (contract "Page order 11" + "Sector focus — exactly three"):
 *   sec-head → form card: sector chips (the three sector keys from content.contact.chips[sector]; one row of 44px pills,
 *   selected = ink fill + white text + check, 15px glyph in currentColor; bound to SHIFT.setSector through core's delegated
 *   data-action="sector") → need chips (multi-select, content.contact.chips[need]; SHIFT.toggleNeed) → the ONLY two
 *   text inputs (content.contact.fields: name, phone — both optional, 16px, dir from the field definition, maxlength 60
 *   to match core's clamp; SHIFT.setContact on every input) → privacy line
 *   → side: preview card («الرسالة التي سترسلها» + badge «معاينة») holding ONE outgoing WhatsApp-style bubble with the
 *   live SHIFT.composeMessage() → the green 52px CTA «متابعة إلى واتساب» (data-wa="contact" data-cta="contact": core's
 *   delegated handler calls SHIFT.waLink('contact') with the freshly composed message at click time — that ONE
 *   whatsapp_click {placement:'contact'} is the lead event for this CTA (Meta Lead + Contact / GA4 generate_lead / Ads
 *   conversion); this file deliberately does NOT track a second event on the same tap — and hides the sticky bar while
 *   the CTA is on screen) → helper
 *   «ستراجع الرسالة قبل إرسالها» → a short «يتم فتح واتساب مع رسالتك…» status after the click.
 *
 * Preview: the bubble is NOT a simulation — it is the exact text WhatsApp will open with — so it carries «معاينة»,
 *   not «مثال توضيحي». Plain textContent (no <bdi>) so it renders the way WhatsApp will.
 *   Typewriter: on every change that did not come from the visitor's own typing (sector / need / bundle / business
 *   name / calculator / language) the text re-types over content.contact.preview.typewriterMs (600 ms) with
 *   requestAnimationFrame; keystrokes in the two inputs update the bubble instantly. No typewriter under
 *   prefers-reduced-motion, while the tab is hidden, or while the preview is off-screen (SHIFT.onVisible) — the full text
 *   is set at once. A hidden sizer copy of the full message keeps the bubble's height stable while it types.
 * No required fields, no validation, no timers off-screen (the only timer is the 3 s «opening…» status, cleared on leave).
 * Every string comes from content.js (sections.contact.*, contact.*, sectors[key].label, ui.preview).
 * update(): 'sector' patch chips + re-type · 'bundle' re-type · 'state' need → patch chips + re-type, contact → sync
 *   inputs (unless the visitor is typing) + re-type/instant, bizName/roi → re-type · 'lang'/'rerender' (core
 *   re-rendered with the full text) → re-attach the visibility observer.
 */
(function (w, d) {
  'use strict';
  if (!w.SHIFT) return;
  var SHIFT = w.SHIFT;

  var ID = 'contact';
  var FALLBACK_TYPE_MS = 600;      // content.contact.preview.typewriterMs wins
  var OPENING_MS = 3000;           // «يتم فتح واتساب مع رسالتك…» stays this long after the click
  var FIELD_MAX = 60;              // core clamps state.contact.* to 60 chars
  var FIELD_KEYS = ['name', 'phone'];
  // Chip glyph per sector — not user-facing text; the same glyphs #cases uses.
  var ICON_BY_SECTOR = { clinic: 'stethoscope', restaurant: 'utensils', store: 'shopping-bag' };
  var ENTER_HINT = { name: 'next', phone: 'next' };   // Enter moves focus (name → phone → CTA); it never opens WhatsApp

  // Section-local runtime state (survives re-renders; never persisted).
  var run = {
    el: null,
    visible: false,     // preview on screen right now
    raf: null,          // pending requestAnimationFrame of the typewriter
    openT: null,        // «opening…» hide timer
    offVisible: null,   // IntersectionObserver disposer
    docBound: false,
    fromInput: false    // true while SHIFT.setContact runs from this section's own input handler
  };

  /* ------------------------------------------------------------ helpers */
  function t(k, v) { return SHIFT.t(k, v); }
  function esc(s) { return SHIFT.esc(s); }
  function rich(s) { return SHIFT.rich(s); }
  function $(el, sel) { return el ? el.querySelector(sel) : null; }
  function num(v, dflt) { v = Number(v); return isFinite(v) ? v : dflt; }
  function reduced() {
    try { return !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function contact() { return (SHIFT.content && SHIFT.content.contact) || {}; }
  function chipDef(key) {
    var list = contact().chips;
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) { if (list[i] && list[i].key === key) return list[i]; }
    return null;
  }
  function sectors() { return (SHIFT.content && SHIFT.content.sectors) || {}; }
  function sectorKeys() {
    var def = chipDef('sector');
    var opts = def && Array.isArray(def.options) ? def.options : SHIFT.SECTORS;
    return opts.filter(function (k) { return SHIFT.SECTORS.indexOf(k) > -1 && !!sectors()[k]; });
  }
  function needOptions() {
    var def = chipDef('need');
    var opts = def && Array.isArray(def.options) ? def.options : [];
    return opts.map(function (o) { return typeof o === 'string' ? { key: o, label: o } : o; })
      .filter(function (o) { return o && o.key; });
  }
  function fields() {
    var list = contact().fields;
    return (Array.isArray(list) ? list : []).filter(function (f) { return f && FIELD_KEYS.indexOf(f.key) > -1; });
  }
  function typeMs() { var p = contact().preview || {}; return num(p.typewriterMs, FALLBACK_TYPE_MS); }
  function contactState() { return SHIFT.state.contact || { name: '', phone: '' }; }
  function message() { return SHIFT.composeMessage(); }

  /* ---------------------------------------------------------------- html */
  function sectorChipHtml(k) {
    var s = sectors()[k], on = k === SHIFT.state.sector;
    return '<button type="button" class="chip contact-chip-sector' + (on ? ' is-on' : '') + '"' +
      ' data-action="sector" data-sector="' + esc(k) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      SHIFT.icon(ICON_BY_SECTOR[k] || 'store', { size: 15 }) +
      '<span class="contact-chip-label">' + rich(SHIFT.tx(s.label)) + '</span>' +
      SHIFT.icon('check', { size: 15, cls: 'chip-check' }) +
    '</button>';
  }
  function needChipHtml(o) {
    var on = SHIFT.state.need.indexOf(o.key) > -1;
    return '<button type="button" class="chip contact-chip-need' + (on ? ' is-on' : '') + '"' +
      ' data-need="' + esc(o.key) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '<span>' + rich(SHIFT.tx(o.label)) + '</span>' +
      SHIFT.icon('check', { size: 15, cls: 'chip-check' }) +
    '</button>';
  }
  function chipsHtml() {
    var sDef = chipDef('sector') || {}, nDef = chipDef('need') || {};
    return '<div class="contact-group">' +
        '<p class="label contact-group-label" id="contact-sector-label">' + rich(SHIFT.tx(sDef.label)) + '</p>' +
        '<div class="chips contact-chips contact-chips-sector" role="group" aria-labelledby="contact-sector-label">' +
          sectorKeys().map(sectorChipHtml).join('') +
        '</div>' +
      '</div>' +
      '<div class="contact-group">' +
        '<p class="label contact-group-label" id="contact-need-label">' + rich(SHIFT.tx(nDef.label)) + '</p>' +
        '<div class="chips contact-chips contact-chips-need" role="group" aria-labelledby="contact-need-label">' +
          needOptions().map(needChipHtml).join('') +
        '</div>' +
      '</div>';
  }
  function fieldHtml(f) {
    var key = f.key, id = f.id || ('f-' + key), type = f.type || 'text';
    var val = contactState()[key] || '';
    return '<div class="field">' +
      '<label for="' + esc(id) + '">' + rich(SHIFT.tx(f.label)) + '</label>' +
      '<input class="input" id="' + esc(id) + '" name="' + esc(key) + '" type="' + esc(type) + '" data-contact-field="' + esc(key) + '"' +
        ' dir="' + esc(f.dir || 'auto') + '"' +
        (f.inputmode ? ' inputmode="' + esc(f.inputmode) + '"' : '') +
        (f.autocomplete ? ' autocomplete="' + esc(f.autocomplete) + '"' : '') +
        (key === 'name' ? ' autocapitalize="words"' : ' spellcheck="false"') +
        ' maxlength="' + FIELD_MAX + '" enterkeyhint="' + (ENTER_HINT[key] || 'done') + '"' +
        ' placeholder="' + esc(SHIFT.tx(f.placeholder)) + '" value="' + esc(val) + '">' +
    '</div>';
  }
  function formHtml() {
    return '<form class="contact-form card" novalidate aria-labelledby="contact-title">' +
      chipsHtml() +
      '<div class="contact-fields">' + fields().map(fieldHtml).join('') + '</div>' +
      '<p class="contact-privacy muted">' + rich(t('contact.privacy')) + '</p>' +
    '</form>';
  }
  function previewHtml() {
    var msg = message();
    return '<div class="contact-preview card" role="group" aria-label="' + esc(t('contact.preview.label')) + '">' +
      '<div class="contact-preview-head">' +
        '<p class="contact-preview-label">' + rich(t('contact.preview.label')) + '</p>' +
        '<span class="badge badge-example">' + esc(t('preview')) + '</span>' +
      '</div>' +
      '<div class="contact-pane">' +
        '<div class="contact-bubble">' +
          // Sizer = the accessible copy (full text, transparent, keeps the height); the visible copy is the typewriter.
          '<span class="contact-msg-size" data-contact-size dir="auto">' + esc(msg) + '</span>' +
          '<span class="contact-msg" data-contact-msg dir="auto" aria-hidden="true">' + esc(msg) + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }
  function sideHtml() {
    return '<div class="contact-side">' +
      previewHtml() +
      '<a class="btn btn-wa btn-lg btn-block contact-cta" href="' + esc(SHIFT.waHref()) + '" data-wa="contact" data-cta="contact" target="_blank" rel="noopener">' +
        SHIFT.icon('whatsapp', { size: 20 }) + '<span>' + esc(t('contact.cta')) + '</span>' +
      '</a>' +
      '<p class="contact-helper small muted">' + rich(t('contact.helper')) + '</p>' +
      '<p class="contact-opening small" role="status" data-contact-opening hidden>' + rich(t('contact.opening')) + '</p>' +
    '</div>';
  }

  function render(el) {
    el.innerHTML =
      '<div class="wrap contact-in">' +
        '<div class="sec-head">' +
          '<p class="eyebrow">' + rich(t('sections.contact.eyebrow')) + '</p>' +
          '<h2 id="contact-title">' + rich(t('sections.contact.title')) + '</h2>' +
          '<p class="intro">' + rich(t('sections.contact.intro')) + '</p>' +
        '</div>' +
        '<div class="contact-grid">' + formHtml() + sideHtml() + '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------ in-place patches */
  function setPressed(node, on) {
    node.classList.toggle('is-on', on);
    node.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function patchSectorChips(el) {
    var chips = el.querySelectorAll('.contact-chip-sector');
    for (var i = 0; i < chips.length; i++) setPressed(chips[i], chips[i].getAttribute('data-sector') === SHIFT.state.sector);
  }
  function patchNeedChips(el) {
    var chips = el.querySelectorAll('.contact-chip-need');
    for (var i = 0; i < chips.length; i++) setPressed(chips[i], SHIFT.state.need.indexOf(chips[i].getAttribute('data-need')) > -1);
  }
  // State changed elsewhere (e.g. restored / another tab): mirror it into the inputs the visitor is not typing in.
  function syncInputs(el) {
    var c = contactState();
    FIELD_KEYS.forEach(function (k) {
      var input = $(el, 'input[data-contact-field="' + k + '"]');
      if (!input || d.activeElement === input) return;
      var v = c[k] || '';
      if (input.value !== v) input.value = v;
    });
  }

  /* ----------------------------------------------------------- typewriter */
  function canAnimate() {
    return run.visible && !d.hidden && !reduced() && typeof w.requestAnimationFrame === 'function';
  }
  function stopType() {
    if (run.raf == null) return;
    try { w.cancelAnimationFrame(run.raf); } catch (e) { /* noop */ }
    run.raf = null;
  }
  // Land a running typewriter on its full text (leaving the viewport, tab hidden, or a newer change).
  function finishType(el) {
    if (run.raf == null) return;
    stopType();
    var out = $(el, '[data-contact-msg]'), size = $(el, '[data-contact-size]');
    if (out && size) out.textContent = size.textContent;
  }
  function setPreview(el, animate) {
    var msg = message();
    var out = $(el, '[data-contact-msg]'), size = $(el, '[data-contact-size]');
    if (!out || !size) return;
    stopType();
    hideOpening(el);
    size.textContent = msg;
    if (!animate || !canAnimate() || out.textContent === msg) { out.textContent = msg; return; }
    var chars = Array.from(msg), n = chars.length, ms = typeMs(), t0 = null;
    out.textContent = '';
    function frame(ts) {
      if (t0 == null) t0 = ts;
      var p = ms > 0 ? Math.min(1, (ts - t0) / ms) : 1;
      out.textContent = chars.slice(0, Math.round(p * n)).join('');
      run.raf = p < 1 ? w.requestAnimationFrame(frame) : null;
    }
    run.raf = w.requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------- «opening…» status */
  function clearOpening() { if (run.openT) { clearTimeout(run.openT); run.openT = null; } }
  function hideOpening(el) {
    clearOpening();
    var p = $(el, '[data-contact-opening]');
    if (p) p.hidden = true;
  }
  function showOpening(el) {
    clearOpening();
    var p = $(el, '[data-contact-opening]');
    if (!p) return;
    p.hidden = false;
    run.openT = setTimeout(function () { run.openT = null; p.hidden = true; }, OPENING_MS);
  }

  /* ---------------------------------------------------------- visibility */
  function watch(el) {
    if (run.offVisible) { run.offVisible(); run.offVisible = null; }
    var side = $(el, '.contact-side') || el;
    run.offVisible = SHIFT.onVisible(side, function () {
      run.visible = true;
    }, function () {
      run.visible = false;
      finishType(el);
      hideOpening(el);
    }, { threshold: 0.2 });
  }

  /* ------------------------------------------------------------- actions */
  function onInput(el, input) {
    var key = input.getAttribute('data-contact-field');
    if (FIELD_KEYS.indexOf(key) === -1) return;
    var patch = {};
    patch[key] = input.value;
    run.fromInput = true;
    try { SHIFT.setContact(patch); }            // → 'state' {key:'contact'} → update(): instant preview, inputs untouched
    finally { run.fromInput = false; }
  }
  function flushInputs(el) {
    var patch = {}, any = false;
    FIELD_KEYS.forEach(function (k) {
      var input = $(el, 'input[data-contact-field="' + k + '"]');
      if (input) { patch[k] = input.value; any = true; }
    });
    if (!any) return;
    run.fromInput = true;
    try { SHIFT.setContact(patch); } finally { run.fromInput = false; }
  }
  function onCtaClick(el) {
    flushInputs(el);                            // core composes the message from state right after this handler
    // No SHIFT.track here: core's delegated [data-wa] handler already tracks whatsapp_click {placement:'contact'}
    // for this same tap, and that is the single Lead / generate_lead / Ads conversion for the contact CTA.
    showOpening(el);
  }

  /* ----------------------------------------------------------------- init */
  function init(el) {
    run.el = el;
    el.addEventListener('click', function (e) {
      var tg = e.target;
      if (!tg || typeof tg.closest !== 'function') return;
      var need = tg.closest('[data-need]');
      if (need && el.contains(need)) { SHIFT.toggleNeed(need.getAttribute('data-need')); return; }
      var cta = tg.closest('[data-cta="contact"]');
      if (cta && el.contains(cta)) onCtaClick(el);
      // Sector chips are handled by core's delegated data-action="sector".
    });
    el.addEventListener('input', function (e) {
      var tg = e.target;
      if (tg && tg.matches && tg.matches('input[data-contact-field]')) onInput(el, tg);
    });
    el.addEventListener('change', function (e) {
      var tg = e.target;
      if (tg && tg.matches && tg.matches('input[data-contact-field]')) onInput(el, tg);
    });
    // Enter in the name field moves to the phone field; Enter in the phone field lands on the CTA —
    // WhatsApp only opens on an explicit tap of «متابعة إلى واتساب». (Two text fields and no submit button means the
    // browser never submits implicitly; the submit listener below only covers assistive tech that submits directly.)
    el.addEventListener('keydown', function (e) {
      var tg = e.target;
      if (e.key !== 'Enter' || !tg || !tg.matches || !tg.matches('input[data-contact-field]')) return;
      var next = tg.getAttribute('data-contact-field') === 'name'
        ? $(el, 'input[data-contact-field="phone"]')
        : $(el, '.contact-cta');
      if (next) { e.preventDefault(); next.focus(); }
    });
    el.addEventListener('submit', function (e) {
      var f = e.target;
      if (!f || !f.classList || !f.classList.contains('contact-form')) return;
      e.preventDefault();
      flushInputs(el);
      var cta = $(el, '.contact-cta');
      if (cta) { try { cta.focus({ preventScroll: false }); } catch (err) { cta.focus(); } }
    });
    watch(el);
    if (!run.docBound) {
      run.docBound = true;
      d.addEventListener('visibilitychange', function () { if (d.hidden && run.el) finishType(run.el); });
    }
  }

  /* --------------------------------------------------------------- update */
  function update(el, reason, detail) {
    run.el = el;
    if (reason === 'sector') { patchSectorChips(el); setPreview(el, true); return; }
    if (reason === 'bundle') { setPreview(el, true); return; }
    if (reason === 'state') {
      var k = detail && detail.key;
      if (k === 'need') { patchNeedChips(el); setPreview(el, true); return; }
      if (k === 'contact') {
        if (run.fromInput) { setPreview(el, false); return; }   // the visitor is typing: the bubble follows instantly
        syncInputs(el);
        setPreview(el, true);
        return;
      }
      setPreview(el, true);                                     // bizName / roi feed the composed message
      return;
    }
    // 'lang' / 'rerender': core re-rendered with the full text; nothing to type — re-attach the observer to the new DOM.
    stopType();
    clearOpening();
    watch(el);
  }

  SHIFT.sections[ID] = { id: ID, render: render, init: init, update: update };
})(window, document);
