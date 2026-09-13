/*! shifts-ai.store — sections/team.js — #team (5 agent personas → 5-step walkthrough) + #builder (4 questions → agent card)
 * Vanilla ES2019, classic <script>. Depends on content.js + core.js (window.SHIFT). Registers TWO modules from one file:
 *   SHIFT.sections.team     (contract "Page order 9")
 *   SHIFT.sections.builder  (contract "Page order 10")
 * Styles for both live in assets/css/sections/team.css (scoped under #team / #builder). No CSS in JS.
 *
 * #team
 *   sec-head → 5 persona cards from content.team (role=tablist/tab; icon holder + short label on mobile, icon holder +
 *   name + role line ≥768; light cards, selected = 1.5px ink border + check) → ONE tabpanel (a light card) for the
 *   selected persona: name + role line + «مثال توضيحي», a 5-marker step line on a hairline (role=progressbar; the
 *   CURRENT marker is gold — gold place 4 of 4, done markers are ink), the text label «الخطوة N من 5 — …» 13px
 *   (ui.team_step_label), the 5 steps as 44px rows on hairlines (tap = jump to that step) and a quiet
 *   «▶ أعد التشغيل» link once the walkthrough ended or was paused.
 *   Auto-advance: one step every 2.2 s, ONE pass (1 → 5) then it stops — no loop (same rule as the ops card and the
 *   phone). It runs only while the panel is on screen (SHIFT.onVisible) and the tab is visible; any interaction with
 *   the steps pauses it; selecting a card restarts from step 1. prefers-reduced-motion: no auto-advance at all
 *   (steps stay clickable, the replay link stays hidden). Personas are sector-free, so 'sector' changes nothing here
 *   (update() exists so core does not re-render and restart the walkthrough).
 *
 * #builder
 *   sec-head → progress line «N من 4 · label» (ui.builder_progress; «4 من 4 · تم» once complete) over a 2px ink
 *   progress bar (.builder-bar.is-at-N, N = the current question, aria-hidden — the text is the accessible progress)
 *   → the questions from demos.builder.questions as single-select chip groups (role=radiogroup/radio) revealed one at
 *   a time: answered questions stay visible and editable, the next appears under them. No placeholder box: the
 *   summary card (a light card: templates.builder_summary + the role's tasks + the pain's impact + «مثال توضيحي»)
 *   renders only when all four answers exist, with ONE green CTA <a data-wa="builder" data-wa-kind="builder_plan" data-wa-role/-business/-channel/
 *   -pain> — core's delegated handler calls SHIFT.waLink('builder', composeMessage('builder_plan', vars)) at click time.
 *   The business question is bound to SHIFT.state.sector (question.sectorKey === 'sector'): answering it calls
 *   SHIFT.setSector(); a sector change elsewhere on the page re-syncs the answer (single source of truth). It starts
 *   unanswered so the progress line really reads «1 من 4 · النشاط». role/channel/pain live only in this module.
 *   {{unit}} in a task = sectors[state.sector].unit, {{noun}} = the business option's noun. No timers, no observers.
 */

/* =============================================================================== #team */
(function (w, d) {
  'use strict';
  if (!w.SHIFT) return;
  var SHIFT = w.SHIFT;
  var esc = SHIFT.esc, rich = SHIFT.rich, t = SHIFT.t, tx = SHIFT.tx;

  var ID = 'team';
  var PANEL_ID = 'team-panel';
  var TAB_PREFIX = 'team-tab-';
  var STEP_MS = 2200;   // auto-advance rhythm while on screen
  var MAX_STEPS = 5;    // steps per persona (content.team[i].steps has exactly 5; the bar's CSS knows is-at-1 … is-at-5)

  // Section-local runtime state (survives re-renders; never persisted).
  var S = {
    persona: '',       // selected persona key ('' → first persona)
    step: 1,           // 1-based current step
    done: false,       // one pass finished
    paused: false,     // the visitor touched the steps
    visible: false,    // panel on screen right now
    t: null,           // pending setTimeout for the next step
    offVisible: null,  // IntersectionObserver disposer
    docBound: false,   // visibilitychange bound once
    el: null,          // mount point (for the document-level listener)
    tracked: {}        // demo_run sent once per persona per page life
  };

  /* ------------------------------------------------------------ helpers */
  function personas() { var list = SHIFT.content && SHIFT.content.team; return Array.isArray(list) ? list : []; }
  function personaOf(key) {
    var list = personas();
    for (var i = 0; i < list.length; i++) { if (list[i] && list[i].key === key) return list[i]; }
    return null;
  }
  function current() {
    var p = personaOf(S.persona) || personas()[0] || null;
    if (p) S.persona = p.key;
    return p;
  }
  function stepsOf(p) { return (p && Array.isArray(p.steps)) ? p.steps.slice(0, MAX_STEPS) : []; }
  function reducedMotion() {
    try { return !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  function isRtl() { return (d.documentElement.getAttribute('dir') || 'rtl') !== 'ltr'; }
  function nextFrame(fn) {
    if (typeof w.requestAnimationFrame === 'function') {
      w.requestAnimationFrame(function () { w.requestAnimationFrame(fn); });
    } else { fn(); }
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function markState(i) { return i < S.step ? ' is-done' : (i === S.step ? ' is-current' : ' is-next'); }
  function stepLabel(p) {
    var steps = stepsOf(p);
    return t('team_step_label', { n: S.step, total: steps.length, label: tx(steps[S.step - 1]) });
  }
  function replayShown() { return !reducedMotion() && (S.done || S.paused); }

  /* --------------------------------------------------------------- html */
  function tabHtml(p, on) {
    return '<button type="button" role="tab" id="' + TAB_PREFIX + esc(p.key) + '" class="team-card' + (on ? ' is-on' : '') + '"' +
      ' aria-selected="' + (on ? 'true' : 'false') + '" aria-controls="' + PANEL_ID + '" tabindex="' + (on ? '0' : '-1') + '"' +
      ' data-team="' + esc(p.key) + '">' +
      '<span class="team-card-ic" aria-hidden="true">' + SHIFT.icon(p.icon || 'bot', { size: 24 }) + '</span>' +
      '<span class="team-card-short">' + rich(tx(p.short)) + '</span>' +
      '<span class="team-card-name">' + rich(tx(p.name)) + '</span>' +
      '<span class="team-card-role">' + rich(tx(p.role)) + '</span>' +
      SHIFT.icon('check', { size: 16, cls: 'team-card-check' }) +
    '</button>';
  }
  function tabsHtml() {
    var cur = S.persona;
    return personas().map(function (p) { return tabHtml(p, p.key === cur); }).join('');
  }
  function markHtml(i) {
    // Both the number and the check are in the DOM; CSS shows the check on done markers (no SVG churn per tick).
    return '<span class="team-mark' + markState(i) + '">' +
      '<span class="team-mark-n">' + i + '</span>' + SHIFT.icon('check', { size: 14, cls: 'team-mark-check' }) +
    '</span>';
  }
  function barHtml(p) {
    var n = stepsOf(p).length, marks = '';
    for (var i = 1; i <= n; i++) marks += markHtml(i);
    return '<div class="team-bar is-at-' + S.step + '" role="progressbar" aria-label="' + esc(t('team_progress_aria')) + '"' +
      ' aria-valuemin="1" aria-valuemax="' + n + '" aria-valuenow="' + S.step + '" aria-valuetext="' + esc(stepLabel(p)) + '">' +
      '<span class="team-bar-track" aria-hidden="true"><span class="team-bar-fill"></span></span>' +
      marks +
    '</div>';
  }
  function stepsHtml(p) {
    return '<ol class="team-steps" aria-label="' + esc(t('team_steps_aria')) + '">' +
      stepsOf(p).map(function (s, i) {
        var n = i + 1;
        return '<li class="team-step' + markState(n) + '">' +
          '<button type="button" class="team-step-btn" data-team-step="' + n + '"' + (n === S.step ? ' aria-current="step"' : '') + '>' +
            '<span class="team-step-n" aria-hidden="true">' + n + '</span>' +
            '<span class="team-step-text">' + rich(tx(s)) + '</span>' +
          '</button>' +
        '</li>';
      }).join('') +
    '</ol>';
  }
  function panelHtml(p) {
    return '<div class="team-panel-head">' +
        '<div class="team-panel-titles">' +
          '<h3 class="team-panel-name">' + rich(tx(p.name)) + '</h3>' +
          '<p class="team-panel-role small muted">' + rich(tx(p.role)) + '</p>' +
        '</div>' +
        '<span class="badge badge-example">' + esc(t('illustrative')) + '</span>' +
      '</div>' +
      barHtml(p) +
      '<p class="team-step-label">' + rich(stepLabel(p)) + '</p>' +
      stepsHtml(p) +
      '<button type="button" class="team-replay" data-team-replay' + (replayShown() ? '' : ' hidden') + '>' + esc(t('replay')) + '</button>';
  }
  function render(el) {
    var p = current();
    el.innerHTML =
      '<div class="wrap team-in">' +
        '<div class="sec-head">' +
          '<p class="eyebrow">' + rich(t('sections.team.eyebrow')) + '</p>' +
          '<h2>' + rich(t('sections.team.title')) + '</h2>' +
          '<p class="intro">' + rich(t('sections.team.intro')) + '</p>' +
        '</div>' +
        '<div class="team-tabs" role="tablist" aria-label="' + esc(t('team_pick_aria')) + '">' + tabsHtml() + '</div>' +
        '<div class="team-panel" role="tabpanel" id="' + PANEL_ID + '" aria-labelledby="' + TAB_PREFIX + esc(S.persona) + '" data-team="' + esc(S.persona) + '">' +
          (p ? panelHtml(p) : '') +
        '</div>' +
      '</div>';
  }

  /* ------------------------------------------------- in-place updates */
  // Reflect S.step / done / paused into the existing panel (keeps focus and the observer target).
  function paint(el) {
    var p = current();
    var panel = el.querySelector('#' + PANEL_ID);
    if (!p || !panel) return false;
    var bar = panel.querySelector('.team-bar'), label = panel.querySelector('.team-step-label');
    if (!bar || !label) return false;
    var text = stepLabel(p);
    bar.className = 'team-bar is-at-' + S.step;
    bar.setAttribute('aria-valuenow', String(S.step));
    bar.setAttribute('aria-valuetext', text);
    var marks = bar.querySelectorAll('.team-mark');
    for (var i = 0; i < marks.length; i++) marks[i].className = 'team-mark' + markState(i + 1);
    var rows = panel.querySelectorAll('.team-step');
    for (var j = 0; j < rows.length; j++) {
      var n = j + 1, btn = rows[j].querySelector('.team-step-btn');
      rows[j].className = 'team-step' + markState(n);
      if (btn) { if (n === S.step) btn.setAttribute('aria-current', 'step'); else btn.removeAttribute('aria-current'); }
    }
    label.innerHTML = rich(text);
    label.classList.add('is-new');
    nextFrame(function () { label.classList.remove('is-new'); });
    var rp = panel.querySelector('[data-team-replay]');
    if (rp) rp.hidden = !replayShown();
    return true;
  }
  function patchTabs(el) {
    var tabs = el.querySelectorAll('.team-tabs [role="tab"]');
    if (!tabs.length) return false;
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-team') === S.persona;
      tabs[i].classList.toggle('is-on', on);
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[i].setAttribute('tabindex', on ? '0' : '-1');
    }
    return true;
  }
  function swapPanel(el, p) {
    var panel = el.querySelector('#' + PANEL_ID);
    if (!panel) return false;
    panel.setAttribute('aria-labelledby', TAB_PREFIX + p.key);
    panel.setAttribute('data-team', p.key);
    panel.classList.add('is-new');
    panel.innerHTML = panelHtml(p);
    // Two frames so the initial opacity:0 / translateY(4px) is committed before the 160 ms transition.
    nextFrame(function () { panel.classList.remove('is-new'); });
    return true;
  }

  /* --------------------------------------------------------- walkthrough */
  function stop() { if (S.t) { clearTimeout(S.t); S.t = null; } }
  function canRun() { return S.visible && !S.done && !S.paused && !d.hidden && !reducedMotion(); }
  function schedule(el) {
    if (S.t || !canRun()) return;
    S.t = setTimeout(function () { tick(el); }, STEP_MS);
  }
  function setStep(el, n) {
    S.step = clamp(n, 1, Math.max(1, stepsOf(current()).length));
    if (!paint(el)) render(el);
  }
  function tick(el) {
    S.t = null;
    if (!canRun()) return;
    var n = stepsOf(current()).length;
    if (S.step < n) setStep(el, S.step + 1);
    if (S.step >= n) { S.done = true; paint(el); }   // one pass, then the replay link — no loop
    else schedule(el);
  }
  function pause(el) {
    if (S.paused || S.done) return;
    stop();
    S.paused = true;
    paint(el);
  }
  function restart(el) {
    stop();
    S.step = 1; S.done = false; S.paused = false;
    if (!paint(el)) render(el);
    schedule(el);
  }
  function select(el, key) {
    var p = personaOf(key);
    if (!p) return;
    stop();
    S.persona = p.key; S.step = 1; S.done = false; S.paused = false;
    if (!patchTabs(el) || !swapPanel(el, p)) render(el);
    if (!S.tracked[p.key]) { S.tracked[p.key] = true; SHIFT.track('demo_run', { demo: 'team' }); }
    schedule(el);
  }

  /* ---------------------------------------------------------- visibility */
  function watch(el) {
    if (S.offVisible) { S.offVisible(); S.offVisible = null; }
    var panel = el.querySelector('#' + PANEL_ID);
    if (!panel) return;
    S.offVisible = SHIFT.onVisible(panel, function () {
      S.visible = true;
      schedule(el);
    }, function () {
      S.visible = false;
      stop();
    }, { threshold: 0.2 });
  }

  /* ------------------------------------------------------------ keyboard */
  // Roving tabindex on the cards: Left/Right move in reading direction; Home/End jump. Selecting follows focus.
  function onKeydown(el, e) {
    var tg = e.target;
    if (!tg || typeof tg.closest !== 'function') return;
    var tab = tg.closest('.team-tabs [role="tab"]');
    if (!tab) return;
    var tabs = Array.prototype.slice.call(tab.parentNode.querySelectorAll('[role="tab"]'));
    var n = tabs.length, i = tabs.indexOf(tab), next;
    if (!n || i < 0) return;
    var fwd = isRtl() ? 'ArrowLeft' : 'ArrowRight';
    var back = isRtl() ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === fwd) next = (i + 1) % n;
    else if (e.key === back) next = (i - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else return;
    e.preventDefault();
    tabs[next].focus();
    select(el, tabs[next].getAttribute('data-team'));
  }

  /* --------------------------------------------------------------- module */
  SHIFT.sections[ID] = {
    id: ID,
    render: render,
    init: function (el) {
      S.el = el;
      el.addEventListener('click', function (e) {
        var tg = e.target;
        if (!tg || typeof tg.closest !== 'function') return;
        var tab = tg.closest('.team-tabs [role="tab"]');
        if (tab && el.contains(tab)) { select(el, tab.getAttribute('data-team')); return; }
        var stepBtn = tg.closest('[data-team-step]');
        if (stepBtn && el.contains(stepBtn)) {
          // Jumping to a step is an interaction: the walkthrough pauses there and offers the replay link.
          stop();
          S.paused = true; S.done = false;
          setStep(el, parseInt(stepBtn.getAttribute('data-team-step'), 10) || 1);
          return;
        }
        var rp = tg.closest('[data-team-replay]');
        if (rp && el.contains(rp)) restart(el);
      });
      el.addEventListener('keydown', function (e) { onKeydown(el, e); });
      // Keyboard focus inside the step list also counts as interaction: freeze it so the current step doesn't drift.
      el.addEventListener('focusin', function (e) {
        var tg = e.target;
        if (tg && typeof tg.closest === 'function' && tg.closest('.team-steps')) pause(el);
      });
      watch(el);
      if (!S.docBound) {
        S.docBound = true;
        d.addEventListener('visibilitychange', function () {
          if (d.hidden) stop();
          else if (S.el) schedule(S.el);
        });
      }
    },
    update: function (el, reason) {
      S.el = el;
      if (reason === 'lang' || reason === 'rerender') {
        // core re-rendered from S (persona/step kept): re-point the observer at the new panel and resume.
        stop();
        watch(el);
        schedule(el);
      }
      // 'sector' / 'bundle' / 'state': the personas are sector-free; nothing to refresh, the walkthrough keeps going.
    }
  };
})(window, document);

/* ============================================================================ #builder */
(function (w, d) {
  'use strict';
  if (!w.SHIFT) return;
  var SHIFT = w.SHIFT;
  var esc = SHIFT.esc, rich = SHIFT.rich, t = SHIFT.t, tx = SHIFT.tx;

  var ID = 'builder';
  var CARD_TITLE_ID = 'builder-card-title';

  // Section-local runtime state (survives re-renders; never persisted). The business answer mirrors SHIFT.state.sector.
  var B = {
    answers: {},     // { [question.key]: option.key }
    shown: 1,        // questions currently in the DOM (the first one never fades in)
    card: false,     // card currently in the DOM
    el: null,
    tracked: false   // demo_run sent once per page life (first completion)
  };

  /* ------------------------------------------------------------ helpers */
  function cfg() { var c = SHIFT.content && SHIFT.content.demos && SHIFT.content.demos.builder; return c || {}; }
  function questions() { var q = cfg().questions; return Array.isArray(q) ? q : []; }
  function sectors() { return (SHIFT.content && SHIFT.content.sectors) || {}; }
  function isSectorQ(q) { return !!(q && q.sectorKey === 'sector'); }
  function sectorQ() {
    var qs = questions();
    for (var i = 0; i < qs.length; i++) { if (isSectorQ(qs[i])) return qs[i]; }
    return null;
  }
  function questionOf(key) {
    var qs = questions();
    for (var i = 0; i < qs.length; i++) { if (qs[i] && qs[i].key === key) return qs[i]; }
    return null;
  }
  function optionOf(q, key) {
    var opts = (q && Array.isArray(q.options)) ? q.options : [];
    for (var i = 0; i < opts.length; i++) { if (opts[i] && opts[i].key === key) return opts[i]; }
    return null;
  }
  // Business options are sector keys: their label is the sector's label (single source of truth).
  function optionLabel(q, o) {
    if (isSectorQ(q)) { var s = sectors()[o.key]; return s ? tx(s.label) : ''; }
    return tx(o.label);
  }
  function answer(q) {
    if (!q) return null;
    var v = B.answers[q.key];
    return (v && optionOf(q, v)) ? v : null;
  }
  function firstOpen() {
    var qs = questions();
    for (var i = 0; i < qs.length; i++) { if (!answer(qs[i])) return i; }
    return qs.length;
  }
  function complete() { var n = questions().length; return n > 0 && firstOpen() >= n; }
  function shownCount() { return Math.min(firstOpen() + 1, questions().length); }
  function progressText() {
    var qs = questions(), i = firstOpen(), n = qs.length;
    if (i >= n) return t('builder_progress', { n: n, total: n, label: t('done') });
    return t('builder_progress', { n: i + 1, total: n, label: tx(qs[i].label) });
  }
  // The bar mirrors the «N» of the progress text: the current question number (the total once complete).
  function progressStep() { return Math.min(firstOpen() + 1, questions().length); }
  function barClass() { return 'builder-bar is-at-' + progressStep(); }
  function progressHtml() {
    return '<div class="builder-progress-wrap">' +
      '<p class="builder-progress" aria-live="polite">' + rich(progressText()) + '</p>' +
      '<span class="' + barClass() + '" aria-hidden="true"><span class="builder-bar-fill"></span></span>' +
    '</div>';
  }
  function nextFrame(fn) {
    if (typeof w.requestAnimationFrame === 'function') {
      w.requestAnimationFrame(function () { w.requestAnimationFrame(fn); });
    } else { fn(); }
  }
  function stripNew(el) {
    nextFrame(function () {
      var nodes = el.querySelectorAll('.is-new');
      for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('is-new');
    });
  }
  function isRtl() { return (d.documentElement.getAttribute('dir') || 'rtl') !== 'ltr'; }

  /* --------------------------------------------------------------- html */
  function chipHtml(q, o) {
    var on = answer(q) === o.key;
    return '<button type="button" role="radio" aria-checked="' + (on ? 'true' : 'false') + '" class="chip builder-chip' + (on ? ' is-on' : '') + '"' +
      ' data-builder-q="' + esc(q.key) + '" data-builder-opt="' + esc(o.key) + '">' +
      (o.icon ? SHIFT.icon(o.icon, { size: 15 }) : '') +
      '<span>' + rich(optionLabel(q, o)) + '</span>' +
      SHIFT.icon('check', { size: 16, cls: 'chip-check' }) +
    '</button>';
  }
  function questionHtml(q, i, isNew) {
    var id = 'builder-q-' + esc(q.key);
    var opts = Array.isArray(q.options) ? q.options : [];
    return '<div class="builder-q' + (isNew ? ' is-new' : '') + '" data-q="' + esc(q.key) + '">' +
      '<h3 class="builder-q-title" id="' + id + '">' +
        '<span class="builder-q-n" aria-hidden="true">' + (i + 1) + '</span>' +
        '<span>' + rich(tx(q.prompt || q.label)) + '</span>' +
      '</h3>' +
      '<div class="chips builder-chips" role="radiogroup" aria-labelledby="' + id + '">' +
        opts.map(function (o) { return chipHtml(q, o); }).join('') +
      '</div>' +
    '</div>';
  }
  // Template variables: {{role}} / {{channel}} / {{pain}} = that question's answer label, {{business}} = the sector label,
  // {{does}} / tasks / {{impact}} from the chosen option, {{channelPhrase}} from demos.builder.channelPhrase.
  function cardVars() {
    var s = SHIFT.sector(), phrase = cfg().channelPhrase || {};
    var v = {
      role: '', channel: '', pain: '', does: '', impact: '', channelPhrase: '', tasks: [],
      business: s ? tx(s.label) : '', unit: s ? tx(s.unit) : '', noun: ''
    };
    questions().forEach(function (q) {
      var o = optionOf(q, answer(q));
      if (!o) return;
      if (isSectorQ(q)) { v.noun = tx(o.noun); return; }
      v[q.key] = tx(o.label);
      if (o.does) v.does = tx(o.does);
      if (Array.isArray(o.tasks)) v.tasks = o.tasks;
      if (o.impact) v.impact = tx(o.impact);
      if (q.key === 'channel') v.channelPhrase = tx(phrase[o.key] || phrase.single, { channel: tx(o.label) });
    });
    return v;
  }
  function taskHtml(task, v) {
    return '<li class="builder-task">' + SHIFT.icon('check', { size: 18 }) +
      '<span>' + rich(tx(task, { unit: v.unit, noun: v.noun })) + '</span></li>';
  }
  function sectionHtml(labelKey, inner) {
    return '<div class="builder-card-sec"><h4 class="builder-card-label">' + rich(t(labelKey)) + '</h4>' + inner + '</div>';
  }
  function cardHtml(isNew) {
    var v = cardVars();
    var summary = t('templates.builder_summary', v);
    var tasks = v.tasks.map(function (task) { return taskHtml(task, v); }).join('');
    return '<article class="builder-card' + (isNew ? ' is-new' : '') + '" aria-labelledby="' + CARD_TITLE_ID + '">' +
      '<div class="builder-card-head">' +
        '<h3 class="builder-card-title" id="' + CARD_TITLE_ID + '">' + rich(t('builder_card_title')) + '</h3>' +
        '<span class="badge badge-example">' + esc(t('illustrative')) + '</span>' +
      '</div>' +
      '<p class="builder-card-meta small muted">' + [v.business, v.channel, v.pain].filter(Boolean).map(function (x) { return rich(x); }).join(' · ') + '</p>' +
      '<p class="builder-card-summary">' + rich(summary) + '</p>' +
      '<div class="builder-card-grid">' +
        sectionHtml('builder_card_role', '<p class="builder-card-role">' + rich(v.role) + '</p>') +
        (tasks ? sectionHtml('builder_card_tasks', '<ul class="builder-tasks">' + tasks + '</ul>') : '') +
        (v.impact ? sectionHtml('builder_card_impact', '<p class="builder-card-impact">' + rich(v.impact) + '</p>') : '') +
      '</div>' +
      '<a class="btn btn-wa btn-lg builder-cta" href="' + esc(SHIFT.waHref()) + '" data-wa="builder" data-wa-kind="builder_plan"' +
        ' data-wa-role="' + esc(v.role) + '" data-wa-business="' + esc(v.business) + '" data-wa-channel="' + esc(v.channel) + '" data-wa-pain="' + esc(v.pain) + '"' +
        ' target="_blank" rel="noopener">' +
        SHIFT.icon('whatsapp', { size: 20 }) + '<span>' + rich(t('builder_cta')) + '</span>' +
      '</a>' +
    '</article>';
  }
  function render(el) {
    var qs = questions(), n = shownCount(), done = complete(), html = '';
    for (var i = 0; i < n; i++) html += questionHtml(qs[i], i, i >= B.shown);
    el.innerHTML =
      '<div class="wrap builder-in">' +
        '<div class="sec-head">' +
          '<p class="eyebrow">' + rich(t('sections.builder.eyebrow')) + '</p>' +
          '<h2>' + rich(t('sections.builder.title')) + '</h2>' +
          '<p class="intro">' + rich(t('sections.builder.intro')) + '</p>' +
        '</div>' +
        progressHtml() +
        '<div class="builder-qs">' + html + '</div>' +
        (done ? cardHtml(!B.card) : '') +
      '</div>';
    B.shown = n; B.card = done;
    stripNew(el);
  }

  /* ------------------------------------------------- in-place updates */
  // After an answer: patch chips + progress in place (keeps focus and the live region), append what is newly revealed.
  function patch(el) {
    var qs = questions(), n = shownCount(), done = complete();
    var prog = el.querySelector('.builder-progress'), box = el.querySelector('.builder-qs');
    if (!prog || !box) return false;
    prog.innerHTML = rich(progressText());
    var bar = el.querySelector('.builder-bar');
    if (bar) bar.className = barClass();
    var chips = box.querySelectorAll('[data-builder-q]');
    for (var i = 0; i < chips.length; i++) {
      var c = chips[i], on = B.answers[c.getAttribute('data-builder-q')] === c.getAttribute('data-builder-opt');
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    var have = box.querySelectorAll('.builder-q').length;
    for (var j = have; j < n; j++) box.insertAdjacentHTML('beforeend', questionHtml(qs[j], j, true));
    var card = el.querySelector('.builder-card');
    if (done) {
      if (card) card.outerHTML = cardHtml(false);
      else box.insertAdjacentHTML('afterend', cardHtml(true));
    } else if (card) {
      card.parentNode.removeChild(card);
    }
    B.shown = n; B.card = done;
    stripNew(el);
    return true;
  }
  function focusChip(el, qKey, oKey) {
    var chip = el.querySelector('[data-builder-q="' + qKey + '"][data-builder-opt="' + oKey + '"]');
    if (!chip) return;
    try { chip.focus({ preventScroll: true }); } catch (e) { try { chip.focus(); } catch (_) { /* noop */ } }
  }
  function choose(el, qKey, oKey) {
    var q = questionOf(qKey);
    if (!q || !optionOf(q, oKey) || B.answers[qKey] === oKey) return;
    var wasDone = complete();
    B.answers[qKey] = oKey;
    // The business answer IS the page's sector: setSector() propagates and core calls update(el,'sector') → patch().
    // It returns false when nothing changed (same sector) — then patch here.
    var propagated = isSectorQ(q) && SHIFT.setSector(oKey) === true;
    if (!propagated && !patch(el)) render(el);
    if (!wasDone && complete() && !B.tracked) { B.tracked = true; SHIFT.track('demo_run', { demo: 'builder' }); }
    focusChip(el, qKey, oKey);
  }

  /* ------------------------------------------------------------ keyboard */
  // Radio pattern inside a chip group: arrows move (and select) in reading direction; Home/End jump.
  function onKeydown(el, e) {
    var tg = e.target;
    if (!tg || typeof tg.closest !== 'function') return;
    var chip = tg.closest('.builder-chips [role="radio"]');
    if (!chip) return;
    var chips = Array.prototype.slice.call(chip.parentNode.querySelectorAll('[role="radio"]'));
    var n = chips.length, i = chips.indexOf(chip), next;
    if (!n || i < 0) return;
    var fwd = isRtl() ? 'ArrowLeft' : 'ArrowRight';
    var back = isRtl() ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === fwd || e.key === 'ArrowDown') next = (i + 1) % n;
    else if (e.key === back || e.key === 'ArrowUp') next = (i - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else return;
    e.preventDefault();
    chips[next].focus();
    choose(el, chips[next].getAttribute('data-builder-q'), chips[next].getAttribute('data-builder-opt'));
  }

  /* --------------------------------------------------------------- module */
  SHIFT.sections[ID] = {
    id: ID,
    render: render,
    init: function (el) {
      B.el = el;
      el.addEventListener('click', function (e) {
        var tg = e.target;
        if (!tg || typeof tg.closest !== 'function') return;
        var chip = tg.closest('[data-builder-q]');
        if (chip && el.contains(chip)) choose(el, chip.getAttribute('data-builder-q'), chip.getAttribute('data-builder-opt'));
      });
      el.addEventListener('keydown', function (e) { onKeydown(el, e); });
    },
    update: function (el, reason) {
      B.el = el;
      if (reason === 'sector') {
        // core did NOT re-render on 'sector'. If the business was answered, it follows the page's sector (single
        // source of truth) and the card re-reads the sector's label / unit. Unanswered → still question 1, nothing to do.
        var q = sectorQ();
        if (q && B.answers[q.key]) {
          B.answers[q.key] = SHIFT.state.sector;
          if (!patch(el)) render(el);
        }
        return;
      }
      // 'lang' / 'rerender': core already re-rendered from B. 'bundle' / 'state': nothing here depends on them.
    }
  };
})(window, document);
