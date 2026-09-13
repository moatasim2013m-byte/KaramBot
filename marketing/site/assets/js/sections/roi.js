/*! shifts-ai.store — sections/roi.js — #roi: ROI calculator bound to the CURRENT sector
 * Vanilla ES2019, classic <script>. Depends on content.js + core.js (window.SHIFT).
 *
 * Renders (contract "Page order 8" + "Sector consistency"), RESULT FIRST:
 *   sec-head → result card (light --surface card, the section's one --shadow-card, «مثال توضيحي» badge, the primary
 *   output as a 40px Alexandria gold tabular number
 *   + its unit, the assumptions note 13px right under it, the secondary output as one line) — position:sticky
 *   within the section while the sliders are used → inputs card: defaults note («الأرقام الافتراضية لقطاع …»,
 *   shown until the visitor moves a slider), the two PRIMARY sliders (msgsPerDay, avgTicketJOD — facts the owner
 *   knows), «تعديل الافتراضات» <details> holding every other demos.roi input (missedRate, replyMinutes) with their
 *   current values printed in the summary so the number stays derivable while the details is closed, then the
 *   green 48px pill CTA «أرسل لي هذا التقدير على واتساب» (data-wa="roi" data-wa-kind="roi_estimate" → core calls
 *   SHIFT.waLink('roi', composeMessage('roi_estimate')) at click time) + a ghost reset shown once touched.
 *
 * Arithmetic — exact, from the visible sliders (SHIFT.roiCalc, demos.roi.formula, constants.daysPerMonth = 30):
 *   loss  = round(msgsPerDay × missedRate × avgTicketJOD × 30)   hours = round(msgsPerDay × replyMinutes × 30 / 60)
 *   Slider values are snapped to each input's [min, max, step] (6-decimal rounding keeps 0.05 steps exact).
 *   Outputs update instantly on every input event — no animated counters.
 *
 * State: sliders mirror SHIFT.state.roi. During a drag the section keeps its own `vals`; SHIFT.setRoi(vals) runs on
 *   `change` (release / key commit), 1 s after the last `input` (SHIFT.debounce), before any WhatsApp CTA click inside
 *   the section, on sector/lang changes, when the section leaves the viewport and when the tab is hidden — so
 *   SHIFT.state.roi is current whenever a message is composed. SHIFT.setRoi persists, emits 'state' {key:'roi'} and
 *   tracks roi_change {monthly_value} (analytics.js debounces that event 1 s). Reset → SHIFT.resetRoi() (sector
 *   defaults, roiTouched = false). Sector switch: core loads the sector's roiDefaults unless roiTouched; the section
 *   re-renders either way.
 *
 * Every string comes from content.js (sections.roi.*, demos.roi.inputs/outputs/assumptions, sectors[key].label,
 * ui.illustrative / roi_defaults_note / roi_adjust / roi_adjust_values / roi_reset / roi_inputs_aria / roi_cta,
 * templates.roi_estimate). No timers except the one-shot 1 s commit debounce (flushed off-screen). No animations.
 * update(): 'sector' flush + re-render · 'lang' core re-rendered (a pending drag is kept, then flushed) ·
 * 'state' {key:'roi'} re-sync sliders/outputs in place (focus survives) · other 'state' keys refresh the CTA href.
 */
(function (w, d) {
  'use strict';
  if (!w.SHIFT) return;
  var SHIFT = w.SHIFT;

  var ID = 'roi';
  var PRIMARY = ['msgsPerDay', 'avgTicketJOD'];   // always visible; every other demos.roi input sits under «تعديل الافتراضات»
  var COMMIT_MS = 1000;

  var vals = null;            // current slider values (snapped) — mirrors SHIFT.state.roi except during a drag
  var dirty = false;          // vals changed and not yet pushed through SHIFT.setRoi
  var detailsOpen = false;    // <details> state, kept across re-renders
  var run = { el: null, docBound: false, offVisible: null };

  /* ------------------------------------------------------------ helpers */
  function t(k, v) { return SHIFT.t(k, v); }
  function esc(s) { return SHIFT.esc(s); }
  function rich(s) { return SHIFT.rich(s); }
  function fmt(n, o) { return SHIFT.fmtNum(n, o); }
  function $(el, sel) { return el ? el.querySelector(sel) : null; }
  function num(v, dflt) { v = Number(v); return isFinite(v) ? v : dflt; }
  function same(a, b) { return Math.abs(num(a, 0) - num(b, 0)) < 1e-9; }
  function demo() { return (SHIFT.content && SHIFT.content.demos && SHIFT.content.demos.roi) || {}; }
  function inputs() { var l = demo().inputs; return Array.isArray(l) ? l : []; }
  function inputById(id) {
    var l = inputs();
    for (var i = 0; i < l.length; i++) { if (l[i] && l[i].id === id) return l[i]; }
    return null;
  }
  function output(id) {
    var l = demo().outputs;
    if (Array.isArray(l)) { for (var i = 0; i < l.length; i++) { if (l[i] && l[i].id === id) return l[i]; } }
    return {};
  }
  function primaryInputs() { return inputs().filter(function (i) { return PRIMARY.indexOf(i.id) > -1; }); }
  function secondaryInputs() { return inputs().filter(function (i) { return PRIMARY.indexOf(i.id) === -1; }); }
  function sector() { return SHIFT.sector() || {}; }
  function touched() { return !!SHIFT.state.roiTouched; }

  // Snap to the input's grid: min + n×step, clamped; rounded to 6 decimals so 0.05 steps print exactly.
  function snap(v, inp) {
    var min = num(inp.min, 0), max = num(inp.max, min), step = num(inp.step, 1) || 1;
    v = num(v, min);
    v = min + Math.round((v - min) / step) * step;
    v = Math.round(v * 1e6) / 1e6;
    if (v < min) v = min;
    if (v > max) v = max;
    return v;
  }
  function fromState() {
    var r = SHIFT.state.roi || {}, out = {};
    inputs().forEach(function (inp) { out[inp.id] = snap(r[inp.id], inp); });
    return out;
  }
  function syncVals() { if (!vals || !dirty) vals = fromState(); }

  /* -------------------------------------------------------------- values */
  function calc() { return SHIFT.roiCalc(vals); }
  function valText(inp) {
    var v = vals[inp.id];
    if (inp.format === 'percent') return fmt(v, { percent: true });
    var u = SHIFT.tx(inp.unit);
    return fmt(v) + (u ? ' ' + u : '');
  }
  function valVars() { var o = {}; inputs().forEach(function (inp) { o[inp.id] = valText(inp); }); return o; }
  function summaryValues() { return t('roi_adjust_values', valVars()); }
  function defaultsNote() { return t('roi_defaults_note', { sector: SHIFT.tx(sector().label) }); }
  function ctaHref() { return SHIFT.waHref(); }   // public href; core opens the roi_estimate message on tap

  /* ---------------------------------------------------------------- html */
  function fieldHtml(inp) {
    var id = 'roi-' + esc(inp.id);
    var text = valText(inp);
    return '<div class="roi-field">' +
      '<div class="roi-field-head">' +
        '<label for="' + id + '">' + rich(SHIFT.tx(inp.label)) + '</label>' +
        '<span class="roi-field-val num" data-roi-val="' + esc(inp.id) + '" aria-hidden="true">' + esc(text) + '</span>' +
      '</div>' +
      '<input type="range" class="range" id="' + id + '" data-roi-input="' + esc(inp.id) + '"' +
        ' min="' + num(inp.min, 0) + '" max="' + num(inp.max, 0) + '" step="' + (num(inp.step, 1) || 1) + '"' +
        ' value="' + vals[inp.id] + '" aria-valuetext="' + esc(text) + '">' +
    '</div>';
  }
  function resultHtml() {
    var r = calc(), loss = output('loss'), hours = output('hours');
    return '<div class="roi-result card shadow-card" role="group" aria-labelledby="roi-loss-label">' +
      '<div class="roi-result-top">' +
        '<p class="roi-result-label" id="roi-loss-label">' + rich(SHIFT.tx(loss.label)) + '</p>' +
        '<span class="badge badge-example">' + esc(t('illustrative')) + '</span>' +
      '</div>' +
      '<p class="roi-num-row" aria-live="polite" aria-atomic="true">' +
        '<span class="roi-num num" data-roi-out="loss">' + esc(fmt(r.loss)) + '</span>' +
        '<span class="roi-unit">' + rich(SHIFT.tx(loss.unit)) + '</span>' +
      '</p>' +
      '<p class="roi-assume">' + rich(SHIFT.tx(demo().assumptions)) + '</p>' +
      '<p class="roi-hours"><span class="ic-holder" aria-hidden="true">' + SHIFT.icon('clock', { size: 16 }) + '</span>' +
        '<span class="roi-hours-label">' + rich(SHIFT.tx(hours.label)) + '</span>' +
        '<span class="roi-hours-val num"><span data-roi-out="hours">' + esc(fmt(r.hours)) + '</span> ' + rich(SHIFT.tx(hours.unit)) + '</span>' +
      '</p>' +
    '</div>';
  }
  function detailsHtml() {
    var sec = secondaryInputs();
    if (!sec.length) return '';
    return '<details class="roi-details"' + (detailsOpen ? ' open' : '') + '>' +
      '<summary class="roi-summary">' +
        '<span class="roi-summary-text">' +
          '<span class="roi-summary-label">' + rich(t('roi_adjust')) + '</span>' +
          '<span class="roi-summary-vals num" data-roi-vals>' + rich(summaryValues()) + '</span>' +
        '</span>' +
        SHIFT.icon('chevron', { size: 20 }) +
      '</summary>' +
      '<div class="roi-fields" role="group" aria-label="' + esc(t('roi_adjust')) + '">' + sec.map(fieldHtml).join('') + '</div>' +
    '</details>';
  }
  function inputsHtml() {
    var on = touched();
    return '<div class="roi-inputs card">' +
      '<p class="roi-defaults small muted" data-roi-defaults' + (on ? ' hidden' : '') + '>' + rich(defaultsNote()) + '</p>' +
      '<div class="roi-fields" role="group" aria-label="' + esc(t('roi_inputs_aria')) + '">' + primaryInputs().map(fieldHtml).join('') + '</div>' +
      detailsHtml() +
      '<div class="roi-actions">' +
        '<a class="btn btn-wa roi-cta" href="' + esc(ctaHref()) + '" data-wa="roi" data-wa-kind="roi_estimate" target="_blank" rel="noopener">' +
          SHIFT.icon('whatsapp', { size: 20 }) + '<span>' + rich(t('roi_cta')) + '</span>' +
        '</a>' +
        '<button type="button" class="btn btn-ghost roi-reset" data-roi="reset"' + (on ? '' : ' hidden') + '>' +
          SHIFT.icon('refresh', { size: 20 }) + '<span>' + rich(t('roi_reset')) + '</span>' +
        '</button>' +
      '</div>' +
    '</div>';
  }

  function render(el) {
    syncVals();
    el.innerHTML =
      '<div class="wrap roi-in">' +
        '<div class="sec-head">' +
          '<p class="eyebrow">' + rich(t('sections.roi.eyebrow')) + '</p>' +
          '<h2>' + rich(t('sections.roi.title')) + '</h2>' +
          '<p class="intro">' + rich(t('sections.roi.intro')) + '</p>' +
        '</div>' +
        '<div class="roi-grid">' + resultHtml() + inputsHtml() + '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------ in-place patches */
  function patchOutputs(el) {
    var r = calc();
    var loss = $(el, '[data-roi-out="loss"]'), hours = $(el, '[data-roi-out="hours"]'), sv = $(el, '[data-roi-vals]');
    if (loss) loss.textContent = fmt(r.loss);
    if (hours) hours.textContent = fmt(r.hours);
    if (sv) sv.innerHTML = rich(summaryValues());
  }
  function patchInput(el, id) {
    var inp = inputById(id);
    if (!inp) return;
    var text = valText(inp);
    var lab = $(el, '[data-roi-val="' + id + '"]'), input = $(el, 'input[data-roi-input="' + id + '"]');
    if (lab) lab.textContent = text;
    if (input) {
      input.setAttribute('aria-valuetext', text);
      if (!same(input.value, vals[id])) input.value = String(vals[id]);
    }
  }
  function patchTouched(el) {
    var on = touched();
    var note = $(el, '[data-roi-defaults]'), reset = $(el, '.roi-reset');
    if (note) { note.innerHTML = rich(defaultsNote()); note.hidden = on; }
    if (reset) reset.hidden = !on;
  }
  function patchHref(el) { var a = $(el, '.roi-cta'); if (a) a.setAttribute('href', ctaHref()); }
  function patchAll(el) {
    inputs().forEach(function (inp) { patchInput(el, inp.id); });
    patchOutputs(el);
    patchTouched(el);
    patchHref(el);
  }

  /* --------------------------------------------------------------- commit */
  // Push the section's values into SHIFT.state.roi (persist + 'state' event + roi_change tracking).
  function flush() {
    if (!dirty) return;
    dirty = false;
    SHIFT.setRoi(vals);
  }
  var flushSoon = SHIFT.debounce(flush, COMMIT_MS);

  function onInput(el, input) {
    var id = input.getAttribute('data-roi-input'), inp = inputById(id);
    if (!inp || !vals) return;
    var v = snap(input.value, inp);
    if (same(v, vals[id])) return;
    vals[id] = v;
    dirty = true;
    patchInput(el, id);
    patchOutputs(el);
    flushSoon();
  }
  function reset(el) {
    dirty = false;                    // anything pending is discarded: the sector defaults win
    SHIFT.resetRoi();                 // → 'state' {key:'roi'} → update() re-syncs sliders + outputs
    var first = $(el, 'input[data-roi-input]');
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }
  }

  /* ----------------------------------------------------------------- init */
  function isRange(n) { return !!(n && n.matches && n.matches('input[type="range"][data-roi-input]')); }
  function init(el) {
    run.el = el;
    el.addEventListener('input', function (e) { if (isRange(e.target)) onInput(el, e.target); });
    el.addEventListener('change', function (e) { if (isRange(e.target)) { onInput(el, e.target); flush(); } });
    el.addEventListener('click', function (e) {
      var tg = e.target;
      if (!tg || typeof tg.closest !== 'function') return;
      if (tg.closest('[data-wa]')) { flush(); return; }          // core composes the message from state right after this
      var b = tg.closest('[data-roi="reset"]');
      if (b && el.contains(b)) reset(el);
    });
    // `toggle` does not bubble; a capture listener on the section still sees it.
    el.addEventListener('toggle', function (e) {
      var dt = e.target;
      if (dt && dt.classList && dt.classList.contains('roi-details')) detailsOpen = !!dt.open;
    }, true);
    if (run.offVisible) run.offVisible();
    run.offVisible = SHIFT.onVisible(el, null, function () { flush(); }, { threshold: 0 });
    if (!run.docBound) {
      run.docBound = true;
      d.addEventListener('visibilitychange', function () { if (d.hidden) flush(); });
    }
  }

  function update(el, reason, detail) {
    run.el = el;
    if (reason === 'sector') { flush(); render(el); return; }
    if (reason === 'lang' || reason === 'rerender') { flush(); return; }   // core re-rendered (a pending drag was kept); land it now
    if (reason === 'state') {
      if (detail && detail.key === 'roi') {
        if (dirty) { patchHref(el); return; }   // mid-drag: the visitor's hand wins until the next flush
        vals = fromState();
        patchAll(el);
        return;
      }
      patchHref(el);                            // bizName etc. feed templates.roi_estimate {{name}}
    }
  }

  SHIFT.sections[ID] = { id: ID, render: render, init: init, update: update };
})(window, document);
