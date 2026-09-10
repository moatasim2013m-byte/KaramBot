/*! shifts-ai.store — sections/karam.js — #karam: the WhatsApp phone (component `phone`)
 * Vanilla ES2019, classic <script>. Depends only on window.SHIFT (core.js) and SHIFT_CONTENT (content.js).
 *
 * What it renders
 *   sec-head (eyebrow · H2 · 2-line intro) → 3 sector chips (delegated to core via data-action="sector") →
 *   the phone: status bar (real time + «مثال توضيحي») · chat header (avatar letter, editable business name,
 *   «حساب أعمال») · chat log · «▶ أعد التشغيل» → caption · honest time-of-day line (quiet hairline card) · secondary WhatsApp CTA
 *   (data-wa="karam" → core tracks whatsapp_click {placement:'karam'} and recomposes the message at click time).
 *
 * Script = SHIFT.sector().chat[SHIFT.scenario()]  (sector × time of day, Friday / Ramadan / promo variants when defined).
 * Timing: customer bubble immediate (no typing indicator; a short reading pause after the previous bubble);
 *   Karam: typing indicator 500–700 ms then the bubble fades in over 200 ms (opacity + translateY(4px));
 *   booking card / system note: short pause, same fade. Every bubble carries the real time it appeared.
 *   One cycle, then a quiet replay link. Timers run only while the phone is on screen (SHIFT.onVisible) and the tab is visible.
 *   prefers-reduced-motion: the whole conversation is laid out at once (no timers, no typing, no name-swap animation).
 * Business name: tap → <input maxlength=28 enterkeyhint="done">; Enter / blur / ✓ saves through SHIFT.setBizName
 *   (core persists 'kb-name'); the first Karam bubble shows typing for 600 ms then swaps its text — no restart.
 * Bubble sides: customer at inline-start, Karam at inline-end — decided by the sender, never by the bubble's own text direction.
 */
(function (w, d) {
  'use strict';

  var SHIFT = w.SHIFT;
  if (!SHIFT) return;

  var ID = 'karam';

  /* ---- timing (ms) ---- */
  var TYPE_MIN = 500, TYPE_MAX = 700;   // Karam typing indicator window (contract)
  var GAP_CUSTOMER = 900;               // reading pause before a customer bubble (the first one is immediate)
  var GAP_BOOK = 450;                   // pause before a booking / order card
  var GAP_SYSTEM = 350;                 // pause before a system note
  var NAME_SWAP = 600;                  // typing shown on the first Karam bubble after a name change
  var CLOCK_MS = 30000;                 // status-bar clock + hours line refresh while visible

  var SECTOR_ICON = { clinic: 'stethoscope', restaurant: 'utensils', store: 'store' };
  var CARD_ICON = { clinic: 'calendar-check', restaurant: 'shopping-bag', store: 'shopping-bag' };

  /* ---- run state (one phone per page) ---- */
  var run = { turns: [], idx: 0, timer: null, visible: false, started: false, done: false };
  var swapTimer = null;
  var clockTimer = null;
  var offVisible = null;
  var visBound = false;

  /* ---- helpers ---- */
  function t(k, v) { return SHIFT.t(k, v); }
  function esc(s) { return SHIFT.esc(s); }
  function $(el, sel) { return el ? el.querySelector(sel) : null; }
  function reduced() {
    try { return !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function sectorKey() { return SHIFT.state.sector; }
  function scenarioKey() { return SHIFT.scenario(sectorKey()); }
  function turnsFor() {
    var s = SHIFT.sector();
    var chat = (s && s.chat) || {};
    var list = chat[scenarioKey()];
    return Array.isArray(list) ? list : [];
  }
  function nameVars() { return { name: SHIFT.bizName() }; }
  function avatarLetter(name) {
    var s = String(name || '').trim();
    if (!s) return '';
    var chars = Array.from ? Array.from(s) : s.split('');
    return chars[0];
  }
  function hasNameToken(turn) {
    var tx = (turn && turn.text) || {};
    var raw = typeof tx === 'string' ? tx : (String(tx.ar || '') + ' ' + String(tx.en || ''));
    return /\{\{\s*name\s*\}\}/.test(raw);
  }
  function typingMs(turn) {
    var len = SHIFT.tx(turn.text, nameVars()).length;
    return Math.max(TYPE_MIN, Math.min(TYPE_MAX, 450 + len * 2));
  }
  function typingDots() {
    return '<span class="typing" role="img" aria-label="' + esc(t('phone_typing')) + '"><i></i><i></i><i></i></span>';
  }

  /* ---- render (pure) ---- */
  function renderChips() {
    var cur = sectorKey();
    var sectors = (SHIFT.content && SHIFT.content.sectors) || {};
    return '<p class="chips-label karam-chips-label" id="karam-chips-label">' + esc(t('cases_pick_aria')) + '</p>' +
    '<div class="karam-chips" role="group" aria-labelledby="karam-chips-label">' +
      SHIFT.SECTORS.map(function (k) {
        var s = sectors[k];
        if (!s) return '';
        var on = k === cur;
        return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" data-action="sector" data-sector="' + k + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
          SHIFT.icon(SECTOR_ICON[k] || 'store', { size: 15 }) +
          '<span>' + esc(SHIFT.tx(s.label)) + '</span>' +
          SHIFT.icon('check', { size: 15, cls: 'chip-check' }) +
        '</button>';
      }).join('') +
    '</div>';
  }

  function renderHeader() {
    var name = SHIFT.bizName();
    return '<div class="phone-head">' +
      '<span class="phone-avatar" aria-hidden="true">' + esc(avatarLetter(name)) + '</span>' +
      '<div class="phone-id">' +
        // Accessible name = the visible business name (WCAG 2.5.3 label-in-name); the action is the description
        // (the «اضغط على الاسم لتغييره» hint rendered next to the chips).
        '<button type="button" class="phone-name-btn" data-act="edit-name" aria-describedby="karam-name-hint" title="' + esc(t('phone_name_hint')) + '">' +
          '<span class="phone-name" dir="auto">' + esc(name) + '</span>' +
          SHIFT.icon('edit', { size: 16 }) +
        '</button>' +
        '<span class="phone-sub">' + esc(t('phone_business_account')) + '</span>' +
      '</div>' +
    '</div>';
  }

  function renderPhone() {
    var now = new Date();
    return '<div class="phone shadow-card" role="group" aria-label="' + esc(t('phone_aria')) + '">' +
      '<div class="phone-screen">' +
        '<div class="phone-status">' +
          '<time class="phone-time num" datetime="' + esc(now.toISOString()) + '" aria-label="' + esc(t('ops_clock_aria')) + '">' + esc(SHIFT.timeText(now)) + '</time>' +
          '<span class="badge badge-example badge-example--glass phone-badge">' + esc(t('illustrative')) + '</span>' +
        '</div>' +
        renderHeader() +
        '<div class="phone-chat" role="log" aria-live="polite" aria-label="' + esc(t('phone_aria')) + '">' +
          '<div class="phone-day"><span>' + esc(t('phone_scenario_' + scenarioKey())) + '</span></div>' +
          '<div class="phone-msgs"></div>' +
          '<div class="phone-typing" hidden>' + typingDots() + '</div>' +
        '</div>' +
        '<div class="phone-foot">' +
          '<button type="button" class="phone-replay link-quiet" data-act="replay" hidden>' + esc(t('replay')) + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function render(el) {
    el.setAttribute('aria-labelledby', 'karam-title');
    el.innerHTML =
      '<div class="wrap">' +
        '<div class="sec-head">' +
          '<p class="eyebrow">' + SHIFT.rich(t('sections.karam.eyebrow')) + '</p>' +
          '<h2 id="karam-title">' + SHIFT.rich(t('sections.karam.title')) + '</h2>' +
          '<p class="intro">' + SHIFT.rich(t('sections.karam.intro')) + '</p>' +
        '</div>' +
        '<div class="karam-grid">' +
          '<div class="karam-top">' +
            renderChips() +
            '<p class="karam-hint small muted" id="karam-name-hint">' + esc(t('phone_name_hint')) + '</p>' +
          '</div>' +
          renderPhone() +
          '<div class="karam-foot">' +
            '<p class="karam-caption small muted">' + SHIFT.rich(t('phone_caption')) + '</p>' +
            '<div class="karam-hours card">' +
              '<span class="ic-holder" aria-hidden="true">' + SHIFT.icon('clock', { size: 16 }) + '</span>' +
              '<p class="karam-hours-text" data-hours>' + SHIFT.rich(SHIFT.hoursLine()) + '</p>' +
            '</div>' +
            '<a class="btn btn-wa karam-cta" href="' + esc(SHIFT.waUrl()) + '" data-wa="karam" target="_blank" rel="noopener">' +
              SHIFT.icon('whatsapp', { size: 20 }) + '<span>' + esc(t('karam_cta')) + '</span>' +
            '</a>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ---- bubbles ---- */
  function bubble(turn, idx, date) {
    var from = turn.from;
    var text = SHIFT.rich(SHIFT.tx(turn.text, nameVars()));
    var time = '<time class="bub-time num" datetime="' + esc(date.toISOString()) + '">' + esc(SHIFT.timeText(date)) + '</time>';
    var attrs = ' data-idx="' + idx + '"';
    if (from === 'customer') {
      return '<div class="bub bub-customer"' + attrs + '>' +
        '<span class="sr-only">' + esc(t('phone_customer')) + ': </span>' +
        '<span class="bub-text" dir="auto">' + text + '</span>' + time + '</div>';
    }
    if (from === 'karam') {
      return '<div class="bub bub-karam"' + attrs + (hasNameToken(turn) ? ' data-name="1"' : '') + '>' +
        '<span class="sr-only">' + esc(t('phone_karam')) + ': </span>' +
        '<span class="bub-text" dir="auto">' + text + '</span>' + time + '</div>';
    }
    if (from === 'book') {
      return '<div class="bub bub-book"' + attrs + '>' +
        SHIFT.icon(CARD_ICON[sectorKey()] || 'check', { size: 18 }) +
        '<span class="bub-text" dir="auto">' + text + '</span>' + time + '</div>';
    }
    return '<div class="bub bub-system"' + attrs + '>' +
      '<span class="bub-label">' + esc(t('phone_system_label')) + '</span>' +
      '<span class="bub-text" dir="auto">' + text + '</span>' + time + '</div>';
  }

  function scrollChat(el) {
    var chat = $(el, '.phone-chat');
    if (!chat) return;
    try { chat.scrollTo({ top: chat.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' }); }
    catch (e) { chat.scrollTop = chat.scrollHeight; }
  }

  function place(el, turn, idx) {
    var msgs = $(el, '.phone-msgs');
    if (!msgs) return;
    msgs.insertAdjacentHTML('beforeend', bubble(turn, idx, new Date()));
    var node = msgs.lastElementChild;
    if (node) {
      void node.offsetWidth;          // commit the initial opacity:0 / translateY(4px) frame
      node.classList.add('is-in');    // 200 ms opacity + transform (base.css collapses it under reduced motion)
    }
    scrollChat(el);
  }

  function showTyping(el, on) {
    var ty = $(el, '.phone-typing');
    if (!ty) return;
    ty.hidden = !on;
    if (on) scrollChat(el);
  }

  /* ---- the cycle ---- */
  function clearRunTimer() { if (run.timer) { clearTimeout(run.timer); run.timer = null; } }

  function canRun() { return run.visible && !d.hidden && run.started && !run.done; }

  function finish(el) {
    clearRunTimer();
    run.done = true;
    showTyping(el, false);
    var rp = $(el, '.phone-replay');
    if (rp) rp.hidden = false;
  }

  function schedule(el) {
    if (!canRun() || run.timer) return;
    if (run.idx >= run.turns.length) { finish(el); return; }
    var turn = run.turns[run.idx];
    var from = turn.from;
    var delay;
    if (from === 'karam') {
      showTyping(el, true);
      delay = typingMs(turn);
    } else if (run.idx === 0) {
      delay = 0;
    } else {
      delay = from === 'customer' ? GAP_CUSTOMER : (from === 'book' ? GAP_BOOK : GAP_SYSTEM);
    }
    run.timer = setTimeout(function () {
      run.timer = null;
      if (!canRun()) { showTyping(el, false); return; }
      if (from === 'karam') showTyping(el, false);
      place(el, turn, run.idx);
      run.idx++;
      if (run.idx >= run.turns.length) finish(el); else schedule(el);
    }, delay);
  }

  function pause(el) {
    clearRunTimer();
    showTyping(el, false);
  }

  function reset(el) {
    clearRunTimer();
    if (swapTimer) { clearTimeout(swapTimer); swapTimer = null; }
    run.turns = turnsFor();
    run.idx = 0;
    run.started = false;
    run.done = false;
    var msgs = $(el, '.phone-msgs');
    if (msgs) msgs.innerHTML = '';
    showTyping(el, false);
    var rp = $(el, '.phone-replay');
    if (rp) rp.hidden = true;
    var day = $(el, '.phone-day > span');
    if (day) day.textContent = t('phone_scenario_' + scenarioKey());
  }

  function start(el) {
    if (run.started) return;
    run.started = true;
    if (reduced()) {
      run.turns.forEach(function (turn, i) { place(el, turn, i); });
      run.idx = run.turns.length;
      finish(el);
      return;
    }
    schedule(el);
  }

  function resume(el) {
    if (!run.started) start(el);
    else if (!run.done) schedule(el);
  }

  function replay(el) {
    SHIFT.track('demo_run', { demo: 'karam' });
    reset(el);
    if (run.visible) start(el);
  }

  /* ---- clock (status bar + honest hours line) ---- */
  function tickClock(el) {
    var now = new Date();
    var tm = $(el, '.phone-time');
    if (tm) { tm.textContent = SHIFT.timeText(now); tm.setAttribute('datetime', now.toISOString()); }
    var hl = $(el, '[data-hours]');
    if (hl) hl.innerHTML = SHIFT.rich(SHIFT.hoursLine());
  }
  function startClock(el) {
    stopClock();
    tickClock(el);
    clockTimer = setInterval(function () { tickClock(el); }, CLOCK_MS);
  }
  function stopClock() { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } }

  /* ---- visibility ---- */
  function bindVisible(el) {
    if (offVisible) { offVisible(); offVisible = null; }
    var phone = $(el, '.phone');
    if (!phone) return;
    offVisible = SHIFT.onVisible(phone, function () {
      run.visible = true;
      startClock(el);
      resume(el);
    }, function () {
      run.visible = false;
      stopClock();
      pause(el);
    }, { threshold: 0.35 });
  }

  function bindDocVisibility(el) {
    if (visBound) return;
    visBound = true;
    d.addEventListener('visibilitychange', function () {
      if (d.hidden) { pause(el); stopClock(); }
      else if (run.visible) { startClock(el); resume(el); }
    });
  }

  /* ---- business name ---- */
  function refreshHeader(el) {
    var name = SHIFT.bizName();
    var n = $(el, '.phone-name');
    if (n) n.textContent = name;
    var a = $(el, '.phone-avatar');
    if (a) a.textContent = avatarLetter(name);
  }

  function setBubbleText(node) {
    var i = Number(node.getAttribute('data-idx'));
    var turn = run.turns[i];
    var tx = node.querySelector('.bub-text');
    if (turn && tx) tx.innerHTML = SHIFT.rich(SHIFT.tx(turn.text, nameVars()));
  }

  // The first Karam bubble re-renders with typing (600 ms) then swaps; later bubbles that carry {{name}} swap silently.
  function swapName(el) {
    var nodes = el.querySelectorAll('.bub-karam[data-name]');
    if (!nodes.length) return;
    var first = nodes[0];
    for (var i = 1; i < nodes.length; i++) setBubbleText(nodes[i]);
    if (swapTimer) { clearTimeout(swapTimer); swapTimer = null; }
    if (reduced()) { setBubbleText(first); return; }
    var tx = first.querySelector('.bub-text');
    if (tx) tx.innerHTML = typingDots();
    first.classList.add('is-typing');
    swapTimer = setTimeout(function () {
      swapTimer = null;
      first.classList.remove('is-typing');
      setBubbleText(first);
    }, NAME_SWAP);
  }

  function openEditor(el) {
    var id = $(el, '.phone-id');
    if (!id || $(el, '.phone-name-form')) return;
    var btn = $(el, '.phone-name-btn');
    if (btn) btn.hidden = true;
    id.insertAdjacentHTML('afterbegin',
      '<form class="phone-name-form" data-act="name-form" novalidate>' +
        '<input class="phone-name-input" type="text" maxlength="28" enterkeyhint="done" dir="auto" autocomplete="organization" autocapitalize="words" spellcheck="false"' +
          ' aria-label="' + esc(t('phone_edit_name_aria')) + '" placeholder="' + esc(t('phone_name_placeholder')) + '" value="' + esc(SHIFT.bizName()) + '">' +
        '<button type="submit" class="phone-name-save" aria-label="' + esc(t('done')) + '">' + SHIFT.icon('check', { size: 20 }) + '</button>' +
      '</form>');
    var inp = $(el, '.phone-name-input');
    if (inp) { inp.focus(); try { inp.select(); } catch (e) { /* noop */ } }
  }

  function closeEditor(el, save, refocus) {
    var form = $(el, '.phone-name-form');
    if (!form) return;
    var inp = form.querySelector('.phone-name-input');
    var value = inp ? inp.value : '';
    form.parentNode.removeChild(form);
    var btn = $(el, '.phone-name-btn');
    if (btn) { btn.hidden = false; if (refocus) { try { btn.focus(); } catch (e) { /* noop */ } } }
    if (!save) return;
    var s = SHIFT.sector();
    var name = String(value).trim().slice(0, 28);
    if (s && name === SHIFT.tx(s.exampleName)) name = '';   // typing the example name back = use the sector default
    SHIFT.setBizName(name);                                  // persists, then core calls update(el,'state',{key:'bizName'})
  }

  /* ---- init: delegation on `el` (survives every re-render) ---- */
  function init(el) {
    el.addEventListener('click', function (e) {
      var tgt = e.target;
      if (!tgt || typeof tgt.closest !== 'function') return;
      var act = tgt.closest('[data-act]');
      if (!act || !el.contains(act)) return;
      var a = act.getAttribute('data-act');
      if (a === 'edit-name') { e.preventDefault(); openEditor(el); }
      else if (a === 'replay') { e.preventDefault(); replay(el); }
    });
    el.addEventListener('submit', function (e) {
      var f = e.target;
      if (f && f.classList && f.classList.contains('phone-name-form')) { e.preventDefault(); closeEditor(el, true, true); }
    });
    el.addEventListener('keydown', function (e) {
      var tgt = e.target;
      if (!tgt || !tgt.classList || !tgt.classList.contains('phone-name-input')) return;
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); closeEditor(el, false, true); }
    });
    el.addEventListener('focusout', function (e) {
      var tgt = e.target;
      if (!tgt || !tgt.classList || !tgt.classList.contains('phone-name-input')) return;
      var to = e.relatedTarget;
      if (to && to.classList && to.classList.contains('phone-name-save')) return;   // submit handles it
      closeEditor(el, true, false);
    });
    reset(el);
    bindVisible(el);
    bindDocVisibility(el);
  }

  /* ---- update: 'lang' (core re-rendered) · 'sector' (we re-render) · 'state' bizName (swap, no restart) ---- */
  function update(el, reason, detail) {
    if (reason === 'sector') {
      render(el);
      reset(el);
      bindVisible(el);
      return;
    }
    if (reason === 'lang' || reason === 'rerender') {
      reset(el);
      bindVisible(el);
      return;
    }
    if (reason === 'state' && detail && detail.key === 'bizName') {
      refreshHeader(el);
      swapName(el);
    }
  }

  SHIFT.sections[ID] = { id: ID, render: render, init: init, update: update };
})(window, document);
