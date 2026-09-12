/*! shifts-ai.store — sections/loyalty.js — #loyalty: loyalty demo bound to the CURRENT sector
 * Vanilla ES2019, classic <script>. Depends on content.js + core.js (window.SHIFT).
 *
 * Renders (contract "Page order 6" + "Sector consistency"):
 *   sec-head → rules card (3 sliders from demos.loyalty.rules, seeded with sectors[sector].pointsPerJOD /
 *   rewardAt / avgTicketJOD, snapped to each rule's [min,max,step]) + «زيارة جديدة · +N» / «استبدل المكافأة» /
 *   «إعادة» → preview panel («مثال توضيحي» badge): member card (business name = SHIFT.bizName(), tier
 *   bronze→silver→gold from demos.loyalty.tiers, balance, progress bar, status
 *   line) + a WhatsApp-style log of the notifications the customer receives → 3 stat tiles (visits, points
 *   issued, rewards redeemed) → the demo note.
 *
 * Arithmetic — exact, from the visible sliders (demos.loyalty.formula):
 *   points = round(avgTicket × pointsPerJOD) · balance += points · remaining = max(0, rewardAt − balance)
 *   progress = min(100, round(balance / rewardAt × 100)) · unlocked = balance ≥ rewardAt (one unlock message when
 *   the balance crosses rewardAt) · redeem: balance −= rewardAt, redeemed += 1 · lifetime never decreases ·
 *   tier = the highest tier whose lifetimeMultiple × rewardAt ≤ lifetime.
 *   Moving any slider resets the run (rules are kept) so every number on screen stays derivable from the inputs.
 *
 * Every string comes from content.js (sectors[key].exampleName/reward, demos.loyalty.*, templates.loyalty_*,
 * ui.loy_* / illustrative / reset / phone_business_account). No cross-sector text: only the current sector's data
 * is ever read. Bubbles: opacity + translateY(4px), 200 ms, no loop. The unlock notification follows the earn
 * notification after a short delay; that timer runs only while the panel is on screen (SHIFT.onVisible) and the
 * tab is visible — otherwise the queue flushes at once. prefers-reduced-motion: no delay.
 * update(): 'sector' reseeds + resets + re-renders · 'lang' — core re-rendered from the same state · 'state'
 * {key:'bizName'} re-renders the preview (card name, chat header, message texts).
 */
(function (w, d) {
  'use strict';
  if (!w.SHIFT) return;
  var SHIFT = w.SHIFT;

  var ID = 'loyalty';
  var UNLOCK_DELAY = 600;                       // ms between the earn bubble and the unlock bubble
  var RULE_ORDER = ['pointsPerJOD', 'rewardAt', 'avgTicket'];
  var STATS = [
    { key: 'visits', label: 'loy_visits', icon: 'calendar-check' },
    { key: 'issued', label: 'loy_points_issued', icon: 'star' },
    { key: 'redeemed', label: 'loy_rewards_redeemed', icon: 'gift' }
  ];
  var TEMPLATE_BY_KIND = { earn: 'loyalty_earn', unlock: 'loyalty_unlock', redeem: 'loyalty_redeem' };

  var S = null;                                 // demo state (module-level; never persisted)
  var run = { el: null, visible: false, timer: null, queue: [], tracked: false, offVisible: null, docBound: false };

  /* ------------------------------------------------------------ helpers */
  function t(k, v) { return SHIFT.t(k, v); }
  function esc(s) { return SHIFT.esc(s); }
  function rich(s) { return SHIFT.rich(s); }
  function fmt(n) { return SHIFT.fmtNum(n); }
  function $(el, sel) { return el ? el.querySelector(sel) : null; }
  function num(v, dflt) { v = Number(v); return isFinite(v) ? v : dflt; }
  function demo() { return (SHIFT.content && SHIFT.content.demos && SHIFT.content.demos.loyalty) || {}; }
  function rules() { return demo().rules || {}; }
  function templates() { return (SHIFT.content && SHIFT.content.templates) || {}; }
  function sector() { return SHIFT.sector() || {}; }
  function reduced() {
    try { return !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function clampSnap(v, r) {
    var min = num(r.min, 0), max = num(r.max, min), step = num(r.step, 1) || 1;
    v = num(v, min);
    v = min + Math.round((v - min) / step) * step;
    if (v < min) v = min;
    if (v > max) v = max;
    return v;
  }
  function tiers() {
    var list = demo().tiers;
    return (Array.isArray(list) && list.length) ? list : [{ key: 'bronze', lifetimeMultiple: 0, label: '' }];
  }

  /* -------------------------------------------------------------- state */
  // Slider defaults come from the sector (rule.sectorKey names the field), snapped to the rule's grid.
  function seedRules() {
    var R = rules(), out = {}, sec = sector();
    RULE_ORDER.forEach(function (k) {
      var r = R[k] || {};
      var v = r.sectorKey ? sec[r.sectorKey] : undefined;
      out[k] = clampSnap(v == null ? r.min : v, r);
    });
    return out;
  }
  function freshState(keepRules) {
    var i = demo().initialState || {};
    return {
      sector: SHIFT.state.sector,
      rules: (keepRules && S) ? S.rules : seedRules(),
      visits: num(i.visits, 0), balance: num(i.balance, 0), lifetime: num(i.lifetime, 0),
      issued: num(i.issued, 0), redeemed: num(i.redeemed, 0),
      events: []
    };
  }
  function ensureState() { if (!S || S.sector !== SHIFT.state.sector) S = freshState(false); }

  function pointsPerVisit() { return Math.round(S.rules.avgTicket * S.rules.pointsPerJOD); }
  function remaining(balance) { return Math.max(0, S.rules.rewardAt - balance); }
  function progress() { return S.rules.rewardAt > 0 ? Math.min(100, Math.round(S.balance / S.rules.rewardAt * 100)) : 0; }
  function unlocked() { return S.balance >= S.rules.rewardAt; }
  function tierOf() {
    var list = tiers(), cur = list[0];
    for (var i = 0; i < list.length; i++) {
      if (S.lifetime >= S.rules.rewardAt * num(list[i].lifetimeMultiple, 0)) cur = list[i];
    }
    return cur;
  }
  function msgVars(ev) {
    var v = { name: SHIFT.bizName(), reward: SHIFT.tx(sector().reward) };
    if (ev && ev.kind === 'earn') {
      v.points = fmt(ev.points);
      v.balance = fmt(ev.balance);
      v.remaining = fmt(ev.remaining);
    }
    return v;
  }
  function valText(k) {
    var r = rules()[k] || {};
    return fmt(S.rules[k]) + ' ' + SHIFT.tx(r.unit);
  }

  /* ---------------------------------------------------------------- html */
  function ruleHtml(k) {
    var r = rules()[k];
    if (!r) return '';
    var id = esc(r.id || ('l-' + k));
    return '<div class="loy-rule">' +
      '<div class="loy-rule-head">' +
        '<label for="' + id + '">' + rich(SHIFT.tx(r.label)) + '</label>' +
        '<output for="' + id + '" class="loy-rule-val num" data-rule-val="' + esc(k) + '">' + esc(valText(k)) + '</output>' +
      '</div>' +
      '<input type="range" class="range" id="' + id + '" data-rule="' + esc(k) + '"' +
        ' min="' + num(r.min, 0) + '" max="' + num(r.max, 0) + '" step="' + (num(r.step, 1) || 1) + '"' +
        ' value="' + S.rules[k] + '" aria-valuetext="' + esc(valText(k)) + '">' +
    '</div>';
  }
  function rulesHtml() {
    return '<div class="loy-rule-list" role="group" aria-label="' + esc(t('loy_rules_aria')) + '">' +
      RULE_ORDER.map(ruleHtml).join('') +
    '</div>';
  }
  function actionsHtml() {
    var un = unlocked();
    return '<div class="loy-actions">' +
      '<button type="button" class="btn loy-visit ' + (un ? 'btn-ghost' : 'btn-ink') + '" data-loy="visit">' +
        SHIFT.icon('star', { size: 20 }) +
        '<span class="loy-visit-label">' + rich(t('loy_new_visit_points', { points: fmt(pointsPerVisit()) })) + '</span>' +
      '</button>' +
      '<button type="button" class="btn btn-ink loy-redeem" data-loy="redeem"' + (un ? '' : ' hidden') + '>' +
        SHIFT.icon('gift', { size: 20 }) + '<span>' + rich(t('loy_redeem')) + '</span>' +
      '</button>' +
      '<button type="button" class="btn btn-ghost loy-reset" data-loy="reset">' +
        SHIFT.icon('refresh', { size: 20 }) + '<span>' + rich(t('reset')) + '</span>' +
      '</button>' +
    '</div>';
  }
  function cardHtml() {
    var tier = tierOf(), un = unlocked(), card = demo().card || {};
    var reward = SHIFT.tx(sector().reward);
    var line = un
      ? SHIFT.tx(card.unlockedLine, { reward: reward })
      : SHIFT.tx(card.toRewardLine, { remaining: fmt(remaining(S.balance)), reward: reward });
    return '<div class="loy-card is-' + esc(tier.key) + (un ? ' is-unlocked' : '') + '" data-tier="' + esc(tier.key) + '">' +
      '<div class="loy-card-top">' +
        '<div class="loy-card-id">' +
          '<p class="loy-card-label">' + rich(t('loy_member_card')) + '</p>' +
          '<p class="loy-card-name">' + rich(SHIFT.bizName()) + '</p>' +
        '</div>' +
        '<span class="loy-tier">' + SHIFT.icon('trophy', { size: 14 }) +
          '<span class="sr-only">' + esc(t('loy_tier')) + ': </span>' + rich(SHIFT.tx(tier.label)) +
        '</span>' +
      '</div>' +
      '<div class="loy-card-mid">' +
        '<div>' +
          '<p class="loy-card-label">' + rich(t('loy_balance')) + '</p>' +
          '<p class="loy-balance num">' + esc(fmt(S.balance)) + '</p>' +
        '</div>' +
        '<p class="loy-card-visits small">' +
          rich(SHIFT.tx(card.visitsLine, { name: SHIFT.tx(card.memberName), visits: fmt(S.visits) })) +
        '</p>' +
      '</div>' +
      '<div class="loy-bar" role="progressbar" aria-label="' + esc(t('loy_balance')) + '" aria-valuemin="0"' +
        ' aria-valuemax="' + S.rules.rewardAt + '" aria-valuenow="' + Math.min(S.rules.rewardAt, S.balance) + '"' +
        ' aria-valuetext="' + esc(fmt(S.balance) + ' / ' + fmt(S.rules.rewardAt)) + '">' +
        '<i style="--p:' + (progress() / 100) + '"></i>' +
      '</div>' +
      '<p class="loy-card-line' + (un ? ' is-ready' : '') + '">' + rich(line) + '</p>' +
    '</div>';
  }
  // shown=true renders the bubble already visible (full re-render); false = starts hidden, appendBubble fades it in.
  function bubbleHtml(ev, shown) {
    var side = (demo().bubbleSide || {})[ev.kind] || 'in';
    var tpl = templates()[TEMPLATE_BY_KIND[ev.kind] || 'loyalty_earn'];
    var date = new Date(ev.at);
    var cls = 'loy-bub loy-bub-' + (side === 'book' ? 'book' : 'in') + (shown ? ' is-in' : '');
    var time = '<time class="loy-time num" datetime="' + esc(date.toISOString()) + '">' + esc(SHIFT.timeText(date)) + '</time>';
    var text = '<span class="loy-bub-text" dir="auto">' + rich(SHIFT.tx(tpl, msgVars(ev))) + '</span>';
    return '<div class="' + cls + '" data-kind="' + esc(ev.kind) + '">' +
      (side === 'book' ? SHIFT.icon('gift', { size: 18 }) : '') + text + time +
    '</div>';
  }
  function bubblesHtml() {
    if (!S.events.length) return '<p class="loy-empty small muted">' + rich(t('loy_empty')) + '</p>';
    return S.events.map(function (ev) { return bubbleHtml(ev, true); }).join('');
  }
  function chatHtml() {
    var card = demo().card || {};
    return '<div class="loy-chat">' +
      '<div class="loy-chat-head">' +
        '<span class="loy-chat-avatar" aria-hidden="true">' + SHIFT.icon('trophy', { size: 16 }) + '</span>' +
        '<div class="loy-chat-id">' +
          '<p class="loy-chat-name">' + rich(SHIFT.tx(card.chatHeader, { name: SHIFT.bizName() })) + '</p>' +
          '<p class="loy-chat-sub">' + rich(t('phone_business_account')) + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="loy-msgs" role="log" aria-live="polite" aria-relevant="additions" aria-label="' + esc(t('loy_whatsapp_preview')) + '">' +
        bubblesHtml() +
      '</div>' +
    '</div>';
  }
  function previewHtml() {
    return '<div class="loy-preview-head">' +
        '<h3 class="loy-preview-title">' + rich(t('loy_whatsapp_preview')) + '</h3>' +
        '<span class="badge badge-example">' + esc(t('illustrative')) + '</span>' +
      '</div>' +
      '<div class="loy-phone">' + cardHtml() + chatHtml() + '</div>';
  }
  function statsHtml() {
    return STATS.map(function (s) {
      return '<div class="loy-stat">' +
        '<span class="ic-holder" aria-hidden="true">' + SHIFT.icon(s.icon, { size: 16 }) + '</span>' +
        '<p class="loy-stat-num num" data-stat="' + s.key + '">' + esc(fmt(S[s.key])) + '</p>' +
        '<p class="loy-stat-label">' + rich(t(s.label)) + '</p>' +
      '</div>';
    }).join('');
  }

  function render(el) {
    ensureState();
    el.innerHTML =
      '<div class="wrap loy-in">' +
        '<div class="sec-head">' +
          '<p class="eyebrow">' + rich(t('sections.loyalty.eyebrow')) + '</p>' +
          '<h2>' + rich(t('sections.loyalty.title')) + '</h2>' +
          '<p class="intro">' + rich(t('sections.loyalty.intro')) + '</p>' +
        '</div>' +
        '<div class="loy-grid">' +
          '<div class="loy-rules card">' + rulesHtml() + actionsHtml() + '</div>' +
          '<div class="loy-preview">' + previewHtml() + '</div>' +
          '<div class="loy-stats" role="group" aria-label="' + esc(t('loy_stats_aria')) + '">' + statsHtml() + '</div>' +
          '<p class="loy-note small muted">' + rich(SHIFT.tx(demo().note)) + '</p>' +
        '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------ in-place patches */
  function patchCard(el) {
    var old = $(el, '.loy-card');
    if (old) old.outerHTML = cardHtml();
  }
  function patchChat(el) {
    var msgs = $(el, '.loy-msgs');
    if (msgs) msgs.innerHTML = bubblesHtml();
  }
  function patchPreview(el) {
    var p = $(el, '.loy-preview');
    if (p) p.innerHTML = previewHtml();
  }
  function patchStats(el) {
    STATS.forEach(function (s) {
      var n = $(el, '.loy-stat-num[data-stat="' + s.key + '"]');
      if (n) n.textContent = fmt(S[s.key]);
    });
  }
  // Buttons are patched in place (never re-created) so keyboard focus survives a click.
  function patchButtons(el) {
    var un = unlocked();
    var visit = $(el, '.loy-visit'), redeem = $(el, '.loy-redeem'), label = $(el, '.loy-visit-label');
    if (label) label.innerHTML = rich(t('loy_new_visit_points', { points: fmt(pointsPerVisit()) }));
    if (visit) { visit.classList.toggle('btn-ink', !un); visit.classList.toggle('btn-ghost', un); }
    if (redeem) redeem.hidden = !un;
  }
  function patchRuleValue(el, k) {
    var out = $(el, '.loy-rule-val[data-rule-val="' + k + '"]');
    var input = $(el, 'input[data-rule="' + k + '"]');
    var text = valText(k);
    if (out) out.textContent = text;
    if (input) { input.setAttribute('aria-valuetext', text); if (String(input.value) !== String(S.rules[k])) input.value = String(S.rules[k]); }
  }
  function patchAll(el) { patchCard(el); patchChat(el); patchStats(el); patchButtons(el); }

  function scrollLog(el) {
    var msgs = $(el, '.loy-msgs');
    if (!msgs) return;
    try { msgs.scrollTo({ top: msgs.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' }); }
    catch (e) { msgs.scrollTop = msgs.scrollHeight; }
  }
  function appendBubble(el, ev) {
    var msgs = $(el, '.loy-msgs');
    if (!msgs) return;
    var empty = $(msgs, '.loy-empty');
    if (empty) empty.parentNode.removeChild(empty);
    msgs.insertAdjacentHTML('beforeend', bubbleHtml(ev, false));
    var node = msgs.lastElementChild;
    if (node) {
      void node.offsetWidth;          // commit the initial opacity:0 / translateY(4px) frame
      node.classList.add('is-in');    // 200 ms opacity + transform (base.css collapses it under reduced motion)
    }
    var kept = Math.max(1, num(demo().eventsKept, 6));
    while (msgs.children.length > kept) msgs.removeChild(msgs.firstElementChild);
    scrollLog(el);
  }

  /* --------------------------------------------------------- event queue */
  function commit(ev) {
    ev.at = Date.now();
    S.events.push(ev);
    var kept = Math.max(1, num(demo().eventsKept, 6));
    if (S.events.length > kept) S.events.splice(0, S.events.length - kept);
    appendBubble(run.el, ev);
  }
  function clearTimer() { if (run.timer) { clearTimeout(run.timer); run.timer = null; } }
  function flushNow() {
    clearTimer();
    while (run.queue.length) commit(run.queue.shift());
  }
  function discardQueue() { clearTimer(); run.queue.length = 0; }
  // The next queued notification lands after UNLOCK_DELAY — only while on screen and in a visible tab;
  // otherwise it lands at once so no timer ever runs off-screen.
  function schedule() {
    if (run.timer || !run.queue.length) return;
    if (!run.visible || d.hidden || reduced()) { flushNow(); return; }
    run.timer = setTimeout(function () {
      run.timer = null;
      var ev = run.queue.shift();
      if (ev) commit(ev);
      schedule();
    }, UNLOCK_DELAY);
  }
  function enqueue(ev) { run.queue.push(ev); schedule(); }

  /* -------------------------------------------------------------- actions */
  function visit(el) {
    flushNow();
    var pts = pointsPerVisit(), was = S.balance;
    S.visits += 1;
    S.balance += pts;
    S.lifetime += pts;
    S.issued += pts;
    commit({ kind: 'earn', points: pts, balance: S.balance, remaining: remaining(S.balance) });
    if (S.balance >= S.rules.rewardAt && was < S.rules.rewardAt) enqueue({ kind: 'unlock' });
    patchCard(el); patchStats(el); patchButtons(el);
    if (!run.tracked) { run.tracked = true; SHIFT.track('demo_run', { demo: 'loyalty' }); }
  }
  function redeem(el) {
    if (!unlocked()) return;
    flushNow();
    S.balance -= S.rules.rewardAt;
    S.redeemed += 1;
    commit({ kind: 'redeem' });
    patchCard(el); patchStats(el); patchButtons(el);
  }
  function reset(el, keepRules) {
    discardQueue();
    S = freshState(keepRules);
    run.tracked = false;
    patchAll(el);
  }
  function onRule(el, input) {
    var k = input.getAttribute('data-rule');
    var r = rules()[k];
    if (!r) return;
    var v = clampSnap(input.value, r);
    if (v === S.rules[k]) return;
    S.rules[k] = v;
    patchRuleValue(el, k);
    // Rules changed → the run restarts so every number on screen follows the visible sliders.
    reset(el, true);
  }

  /* ----------------------------------------------------------- visibility */
  function bindVisible(el) {
    if (run.offVisible) { run.offVisible(); run.offVisible = null; }
    var panel = $(el, '.loy-phone');
    if (!panel) return;
    run.offVisible = SHIFT.onVisible(panel, function () {
      run.visible = true;
      schedule();
    }, function () {
      run.visible = false;
      flushNow();                    // nothing pending → nothing running while off-screen
    }, { threshold: 0.25 });
  }
  function bindDocVisibility() {
    if (run.docBound) return;
    run.docBound = true;
    d.addEventListener('visibilitychange', function () { if (d.hidden) flushNow(); });
  }

  /* ----------------------------------------------------------------- init */
  function init(el) {
    run.el = el;
    el.addEventListener('click', function (e) {
      var b = e.target && typeof e.target.closest === 'function' ? e.target.closest('[data-loy]') : null;
      if (!b || !el.contains(b)) return;
      var a = b.getAttribute('data-loy');
      if (a === 'visit') visit(el);
      else if (a === 'redeem') redeem(el);
      else if (a === 'reset') reset(el, true);
    });
    el.addEventListener('input', function (e) {
      var i = e.target;
      if (i && i.matches && i.matches('input[type="range"][data-rule]')) onRule(el, i);
    });
    bindVisible(el);
    bindDocVisibility();
  }

  function update(el, reason, detail) {
    run.el = el;
    if (reason === 'sector') {
      discardQueue();
      S = freshState(false);           // reseed the rules from the new sector, start over
      run.tracked = false;
      render(el);
      bindVisible(el);
      return;
    }
    if (reason === 'lang' || reason === 'rerender') {
      flushNow();                      // core re-rendered from S; land anything pending in the new DOM
      bindVisible(el);
      return;
    }
    if (reason === 'state' && detail && detail.key === 'bizName') {
      flushNow();
      patchPreview(el);
    }
  }

  SHIFT.sections[ID] = { id: ID, render: render, init: init, update: update };
})(window, document);
