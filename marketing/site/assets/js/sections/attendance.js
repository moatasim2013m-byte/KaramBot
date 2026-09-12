/*! shifts-ai.store — sections/attendance.js — #attendance: attendance demo bound to the CURRENT sector
 * Vanilla ES2019, classic <script>. Depends on content.js + core.js (window.SHIFT).
 *
 * Renders (contract "Page order 7" + "Sector consistency"):
 *   sec-head → rules card (two small controls from demos.attendance.rules: shift start <select> seeded from
 *   sectors[sector].hours.open, grace <select> 0–30 min) + the printed absence rule + «شغّل الصباح» / «إعادة»
 *   → attendance board («مثال توضيحي» badge, simulated clock + progress, one row per employee from
 *   sectors[sector].staff — first 5 — with a status pill, three counters) → manager panel («إلى المدير · معاينة»,
 *   business name = SHIFT.bizName(), a WhatsApp-style log of the late/absent alerts by name) → «معاينة كشف الرواتب»
 *   button + sheet (today's rows + month hours with the printed assumption) → the demo note.
 *
 * Deterministic — nothing random. Each employee's arrival is data (staff[i].arrivalOffsetMin, minutes relative to
 * the shift start; null = never checks in; demos.attendance.roster is the by-name fallback). At simulated clock c:
 *   arrival == null → absent when c ≥ absentAfterMin (else idle)
 *   c < arrival     → idle
 *   arrival > grace → late (late minutes = arrival, i.e. check-in time − shift start)   else → on time
 * Alerts: templates.attendance_alert_late(_few)(_f) at shiftStart + arrival, attendance_alert_absent(_f) at
 * shiftStart + absentAfterMin, chronological. Counters: present = ontime + late · late · absent.
 * Month hours = present × 8 × 22 (from demos.attendance.month.hours.formula; the assumption is printed beside it).
 * Every number on screen is derivable from the visible shift start, grace, check-in times and the absence rule.
 * Changing a rule recomputes: a finished morning jumps to its new end state; a running one restarts idle.
 *
 * Timers: one setInterval (tickMs per simulated minute, start → end offset, then it stops) that runs only while the
 * board is on screen (SHIFT.onVisible) and the tab is visible; prefers-reduced-motion jumps straight to the end.
 * Every string comes from content.js (ui.att_* / illustrative / reset / run_again / minutes(_few) / hours,
 * demos.attendance.*, templates.attendance_*, sectors[sector].staff). No cross-sector text.
 * update(): 'sector' reseeds (grace kept, shift start re-seeded unless the visitor chose it) + re-renders ·
 * 'lang' — core re-rendered from the same state (a running morning resumes) · 'state' {key:'bizName'} patches
 * the manager panel's business name.
 */
(function (w, d) {
  'use strict';
  if (!w.SHIFT) return;
  var SHIFT = w.SHIFT;

  var ID = 'attendance';
  var STAFF_SHOWN = 5;
  var STATUS_ICON = { idle: 'clock', ontime: 'check', late: 'alert', absent: 'user-x' };
  var ALERT_ICON = { late: 'alert', absent: 'user-x' };
  var COUNTER_KEYS = ['present', 'late', 'absent'];

  var S = null;   // demo state (module-level; never persisted)
  var run = { el: null, visible: false, timer: null, offVisible: null, docBound: false };

  /* ------------------------------------------------------------ helpers */
  function t(k, v) { return SHIFT.t(k, v); }
  function esc(s) { return SHIFT.esc(s); }
  function rich(s) { return SHIFT.rich(s); }
  function fmt(n) { return SHIFT.fmtNum(n); }
  function $(el, sel) { return el ? el.querySelector(sel) : null; }
  function $$(el, sel) { return el ? Array.prototype.slice.call(el.querySelectorAll(sel)) : []; }
  function num(v, dflt) { v = Number(v); return isFinite(v) ? v : dflt; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function demo() { return (SHIFT.content && SHIFT.content.demos && SHIFT.content.demos.attendance) || {}; }
  function rules() { return demo().rules || {}; }
  function templates() { return (SHIFT.content && SHIFT.content.templates) || {}; }
  function sector() { return SHIFT.sector() || {}; }
  function reduced() {
    try { return !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function isAr() { return SHIFT.state.lang === 'ar'; }
  // Arabic counts 3–10 with the plural noun («6 دقائق»); everything else keeps the singular («18 دقيقة»).
  function few(n) { return isAr() && n >= 3 && n <= 10; }
  function minutesWord(n) { return t(few(n) ? 'minutes_few' : 'minutes'); }

  function clockCfg() {
    var c = demo().clock || {};
    return {
      start: num(c.startOffsetMin, -15),
      end: num(c.endOffsetMin, 45),
      absentAfter: num(c.absentAfterMin, 30),
      tick: Math.max(30, num(c.tickMs, 95))
    };
  }
  function startOptions() {
    var r = rules().shiftStart || {};
    return (Array.isArray(r.options) && r.options.length) ? r.options.map(String) : ['09:00'];
  }
  function graceOptions() {
    var r = rules().grace || {};
    var min = num(r.min, 0), max = num(r.max, 30), step = num(r.step, 5) || 5, out = [];
    for (var v = min; v <= max; v += step) out.push(v);
    return out;
  }
  // Shift start default = sector.hours.open as "HH:00" when it is an option, else the rule's fallback.
  function defaultStart() {
    var r = rules().shiftStart || {}, opts = startOptions();
    var open = sector().hours && sector().hours.open;
    var s = (typeof open === 'number' && isFinite(open)) ? pad2(Math.floor(open)) + ':00' : '';
    if (opts.indexOf(s) > -1) return s;
    return opts.indexOf(String(r.fallback)) > -1 ? String(r.fallback) : opts[0];
  }
  function defaultGrace() {
    var r = rules().grace || {}, opts = graceOptions(), v = num(r['default'], 10);
    return opts.indexOf(v) > -1 ? v : opts[0];
  }

  /* ------------------------------------------------------------- time */
  function parseHM(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
    return m ? num(m[1], 9) * 60 + num(m[2], 0) : 9 * 60;
  }
  function dateAt(hm, offset) {
    var total = parseHM(hm) + num(offset, 0);
    var dt = new Date();
    dt.setHours(Math.floor(total / 60), ((total % 60) + 60) % 60, 0, 0);
    return dt;
  }
  function timeAt(offset) { return SHIFT.timeText(dateAt(S.shiftStart, offset)); }
  function datetimeAt(offset) { var dt = dateAt(S.shiftStart, offset); return pad2(dt.getHours()) + ':' + pad2(dt.getMinutes()); }
  function hmLabel(hm) { return SHIFT.timeText(dateAt(hm, 0)); }
  function graceLabel(v) { return v === 0 ? t('att_grace_none') : fmt(v) + ' ' + minutesWord(v); }

  /* ------------------------------------------------------------- staff */
  // The sector's first 5 employees. gender / arrivalOffsetMin live on the staff entry; the demo roster is the
  // by-name fallback (then positional) so a missing field never invents data in JS.
  function staff() {
    var sec = sector();
    var list = Array.isArray(sec.staff) ? sec.staff.slice(0, STAFF_SHOWN) : [];
    var roster = Array.isArray(demo().roster) ? demo().roster : [];
    return list.map(function (p, i) {
      p = p || {};
      var name = p.name || {}, fb = null;
      for (var j = 0; j < roster.length; j++) {
        var r = roster[j];
        if (r && r.name && ((name.ar && r.name.ar === name.ar) || (name.en && r.name.en === name.en))) { fb = r; break; }
      }
      if (!fb) fb = roster[i] || {};
      var arr = ('arrivalOffsetMin' in p) ? p.arrivalOffsetMin : fb.arrivalOffsetMin;
      return {
        name: name,
        role: p.role || {},
        gender: p.gender === 'f' || (!p.gender && fb.gender === 'f') ? 'f' : 'm',
        arrival: (arr == null || !isFinite(Number(arr))) ? null : Math.round(Number(arr))
      };
    });
  }
  function initial(s) { s = String(s || '').trim(); return s ? s.charAt(0) : ''; }

  /* --------------------------------------------------------- outcomes */
  function statusAt(p, clock) {
    var c = clockCfg();
    if (p.arrival == null) return clock >= c.absentAfter ? 'absent' : 'idle';
    if (clock < p.arrival) return 'idle';
    return p.arrival > S.grace ? 'late' : 'ontime';
  }
  function lateMin(p) { return p.arrival == null ? 0 : Math.max(0, p.arrival); }
  function checkedIn(st) { return st === 'ontime' || st === 'late'; }
  function statusLabel(key, p) {
    var st = (demo().statuses || {})[key] || {};
    return SHIFT.tx(p.gender === 'f' && st.label_f ? st.label_f : st.label);
  }
  function pillText(key, p) {
    if (key !== 'late') return statusLabel(key, p);
    var m = lateMin(p);
    return t('att_late_by' + (few(m) ? '_few' : '') + (p.gender === 'f' ? '_f' : ''), { min: fmt(m) });
  }
  function alertText(ev) {
    var T = templates(), p = ev.p, key;
    var vars = { name: SHIFT.tx(p.name), time: timeAt(ev.at) };
    if (ev.kind === 'late') {
      var m = lateMin(p);
      vars.min = fmt(m);
      key = 'attendance_alert_late' + (few(m) ? '_few' : '') + (p.gender === 'f' ? '_f' : '');
      if (!T[key]) key = 'attendance_alert_late' + (p.gender === 'f' ? '_f' : '');
    } else {
      key = 'attendance_alert_absent' + (p.gender === 'f' ? '_f' : '');
    }
    if (!T[key]) key = ev.kind === 'late' ? 'attendance_alert_late' : 'attendance_alert_absent';
    return SHIFT.tx(T[key], vars);
  }
  // Every alert of the morning, chronological (ties in staff order).
  function allEvents() {
    var c = clockCfg(), out = [];
    staff().forEach(function (p, i) {
      if (p.arrival == null) out.push({ kind: 'absent', i: i, p: p, at: c.absentAfter });
      else if (p.arrival > S.grace) out.push({ kind: 'late', i: i, p: p, at: p.arrival });
    });
    out.sort(function (a, b) { return (a.at - b.at) || (a.i - b.i); });
    return out;
  }
  function eventsUntil(clock) { return allEvents().filter(function (e) { return e.at <= clock; }); }
  function counts(clock) {
    var c = { present: 0, late: 0, absent: 0 };
    staff().forEach(function (p) {
      var st = statusAt(p, clock);
      if (checkedIn(st)) c.present++;
      if (st === 'late') c.late++;
      if (st === 'absent') c.absent++;
    });
    return c;
  }
  // "present * 8 * 22" → [8, 22]; anything unreadable falls back to the same constants.
  function monthFactors() {
    var f = String((demo().month && demo().month.hours && demo().month.hours.formula) || '');
    var m = /present\s*\*\s*(\d+(?:\.\d+)?)\s*\*\s*(\d+(?:\.\d+)?)/.exec(f);
    return m ? [Number(m[1]), Number(m[2])] : [8, 22];
  }
  function monthHours(present) { var f = monthFactors(); return Math.round(present * f[0] * f[1]); }

  /* -------------------------------------------------------------- state */
  function freshState(prev) {
    var c = clockCfg();
    return {
      sector: SHIFT.state.sector,
      shiftStart: (prev && prev.startTouched) ? prev.shiftStart : defaultStart(),
      startTouched: !!(prev && prev.startTouched),
      grace: prev ? prev.grace : defaultGrace(),
      phase: 'idle',          // 'idle' | 'running' | 'done'
      clock: c.start,         // simulated minutes relative to the shift start
      alerted: 0,             // alerts already in the log
      payroll: false          // payroll sheet open
    };
  }
  function ensureState() {
    if (!S) S = freshState(null);
    else if (S.sector !== SHIFT.state.sector) S = freshState(S);
  }
  function progress() { var c = clockCfg(); return c.end > c.start ? Math.min(1, Math.max(0, (S.clock - c.start) / (c.end - c.start))) : 1; }

  /* ---------------------------------------------------------------- html */
  function badge() { return '<span class="badge badge-example">' + esc(t('illustrative')) + '</span>'; }
  function selectHtml(id, key, options) {
    return '<select class="input" id="' + esc(id) + '" data-att-rule="' + esc(key) + '">' +
      options.map(function (o) {
        return '<option value="' + esc(o.value) + '"' + (o.selected ? ' selected' : '') + '>' + esc(o.label) + '</option>';
      }).join('') +
    '</select>';
  }
  function rulesHtml() {
    var R = rules(), rs = R.shiftStart || {}, rg = R.grace || {};
    var startId = String(rs.id || 'a-start'), graceId = String(rg.id || 'a-grace');
    return '<div class="att-rules card" role="group" aria-label="' + esc(t('att_rules_aria')) + '">' +
      '<div class="att-rule-row">' +
        '<div class="field">' +
          '<label for="' + esc(startId) + '">' + rich(SHIFT.tx(rs.label)) + '</label>' +
          selectHtml(startId, 'shiftStart', startOptions().map(function (hm) { return { value: hm, label: hmLabel(hm), selected: hm === S.shiftStart }; })) +
        '</div>' +
        '<div class="field">' +
          '<label for="' + esc(graceId) + '">' + rich(SHIFT.tx(rg.label)) + '</label>' +
          selectHtml(graceId, 'grace', graceOptions().map(function (v) { return { value: String(v), label: graceLabel(v), selected: v === S.grace }; })) +
        '</div>' +
      '</div>' +
      '<p class="att-absent-rule small muted">' + rich(t('att_absent_after', { min: fmt(clockCfg().absentAfter) })) + '</p>' +
      actionsHtml() +
    '</div>';
  }
  function runLabel() {
    return S.phase === 'running' ? t('att_running') : (S.phase === 'done' ? t('run_again') : t('att_run'));
  }
  function actionsHtml() {
    return '<div class="att-actions">' +
      '<button type="button" class="btn btn-ink att-run" data-att="run"' + (S.phase === 'running' ? ' aria-disabled="true"' : '') + '>' +
        SHIFT.icon('sun', { size: 20 }) + '<span class="att-run-label">' + rich(runLabel()) + '</span>' +
      '</button>' +
      '<button type="button" class="btn btn-ghost att-reset" data-att="reset">' +
        SHIFT.icon('refresh', { size: 20 }) + '<span>' + rich(t('reset')) + '</span>' +
      '</button>' +
    '</div>';
  }
  function timeCellHtml(p, st) {
    if (checkedIn(st)) {
      return '<span class="sr-only">' + esc(t('att_checkin_time')) + ': </span>' +
        '<time datetime="' + esc(datetimeAt(p.arrival)) + '">' + esc(timeAt(p.arrival)) + '</time>';
    }
    return '<span class="sr-only">' + esc(t('att_no_checkin')) + '</span><span aria-hidden="true">—</span>';
  }
  function pillInner(st, p) {
    return SHIFT.icon(STATUS_ICON[st] || 'clock', { size: 14 }) + '<span>' + rich(pillText(st, p)) + '</span>';
  }
  function rowHtml(p, i) {
    var st = statusAt(p, S.clock);
    return '<li class="att-row is-' + st + '" data-i="' + i + '" data-status="' + st + '">' +
      '<span class="att-avatar" aria-hidden="true">' + esc(initial(SHIFT.tx(p.name))) + '</span>' +
      '<span class="att-who">' +
        '<span class="att-name">' + rich(SHIFT.tx(p.name)) + '</span>' +
        '<span class="att-role muted">' + rich(SHIFT.tx(p.role)) + '</span>' +
      '</span>' +
      '<span class="att-state">' +
        '<span class="att-pill is-in">' + pillInner(st, p) + '</span>' +
        '<span class="att-time num">' + timeCellHtml(p, st) + '</span>' +
      '</span>' +
    '</li>';
  }
  function rowsHtml() { return staff().map(rowHtml).join(''); }
  function countersHtml() {
    var list = Array.isArray(demo().counters) ? demo().counters : [];
    var c = counts(S.clock);
    return list.filter(function (k) { return k && COUNTER_KEYS.indexOf(k.key) > -1; }).map(function (k) {
      return '<div class="att-counter tone-' + esc(k.tone || 'ok') + '">' +
        '<p class="att-counter-num num" data-att-count="' + esc(k.key) + '">' + esc(fmt(c[k.key])) + '</p>' +
        '<p class="att-counter-label"><i class="att-dot" aria-hidden="true"></i>' + rich(SHIFT.tx(k.label)) + '</p>' +
      '</div>';
    }).join('');
  }
  function boardHtml() {
    var c = clockCfg();
    return '<div class="att-board card">' +
      '<div class="att-board-head">' +
        '<div class="att-board-titles"><h3 class="att-h3">' + rich(t('att_board')) + '</h3>' + badge() + '</div>' +
        '<span class="att-clock num">' +
          '<span class="sr-only">' + esc(t('att_clock_aria')) + ': </span>' +
          '<time datetime="' + esc(datetimeAt(S.clock)) + '">' + esc(timeAt(S.clock)) + '</time>' +
        '</span>' +
      '</div>' +
      '<div class="att-progress" role="progressbar" aria-label="' + esc(t('att_clock_aria')) + '" aria-valuemin="0"' +
        ' aria-valuemax="' + (c.end - c.start) + '" aria-valuenow="' + (S.clock - c.start) + '" aria-valuetext="' + esc(timeAt(S.clock)) + '">' +
        '<i style="--p:' + progress() + '"></i>' +
      '</div>' +
      '<ul class="att-list" aria-label="' + esc(t('att_board')) + '">' + rowsHtml() + '</ul>' +
      '<div class="att-counters" role="group" aria-label="' + esc(t('att_counters_aria')) + '">' + countersHtml() + '</div>' +
    '</div>';
  }
  // shown=true renders the bubble already visible (full re-render); false = starts hidden, appendBubble fades it in.
  function bubbleHtml(ev, shown) {
    return '<div class="att-bub' + (shown ? ' is-in' : '') + '" data-kind="' + esc(ev.kind) + '">' +
      SHIFT.icon(ALERT_ICON[ev.kind] || 'alert', { size: 18 }) +
      '<span class="att-bub-text" dir="auto">' + rich(alertText(ev)) + '</span>' +
    '</div>';
  }
  function emptyHtml() { return '<p class="att-empty small muted">' + rich(t('att_no_alerts')) + '</p>'; }
  function bubblesHtml() {
    var evs = eventsUntil(S.clock);
    S.alerted = evs.length;
    if (!evs.length) return S.phase === 'idle' ? emptyHtml() : '';
    return evs.map(function (ev) { return bubbleHtml(ev, true); }).join('');
  }
  function doneHtml() { return '<p class="att-done">' + rich(t('att_done')) + '</p>'; }
  function alertsHtml() {
    return '<div class="att-alerts">' +
      '<div class="att-alerts-head"><h3 class="att-h3">' + rich(t('att_manager_alerts')) + '</h3>' + badge() + '</div>' +
      '<div class="att-chat">' +
        '<div class="att-chat-head">' +
          '<span class="att-chat-avatar" aria-hidden="true">' + SHIFT.icon('bell', { size: 16 }) + '</span>' +
          '<div class="att-chat-id">' +
            '<p class="att-chat-name">' + rich(t('att_to_manager')) + '</p>' +
            '<p class="att-chat-sub" data-att-biz>' + rich(SHIFT.bizName()) + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="att-msgs" role="log" aria-live="polite" aria-relevant="additions" aria-label="' + esc(t('att_manager_alerts')) + '">' +
          bubblesHtml() +
        '</div>' +
        (S.phase === 'done' ? doneHtml() : '') +
      '</div>' +
    '</div>';
  }
  function sheetHtml() {
    var c = counts(S.clock), M = (demo().month && demo().month.hours) || {};
    var rows = staff().map(function (p) {
      var st = statusAt(p, S.clock);
      return '<tr class="is-' + st + '">' +
        '<th scope="row"><span class="att-name">' + rich(SHIFT.tx(p.name)) + '</span><span class="att-role muted">' + rich(SHIFT.tx(p.role)) + '</span></th>' +
        '<td><span class="att-pill is-in">' + SHIFT.icon(STATUS_ICON[st] || 'clock', { size: 14 }) + '<span>' + rich(statusLabel(st, p)) + '</span></span></td>' +
        '<td class="num">' + timeCellHtml(p, st) + '</td>' +
        '<td class="num">' + (st === 'late' ? esc(fmt(lateMin(p))) : (checkedIn(st) ? '0' : '<span class="sr-only">' + esc(t('att_no_checkin')) + '</span><span aria-hidden="true">—</span>')) + '</td>' +
      '</tr>';
    }).join('');
    return '<div class="att-sheet-head"><h3 class="att-h3">' + rich(t('att_exported')) + '</h3>' + badge() + '</div>' +
      '<div class="att-table-wrap">' +
        '<table class="att-table">' +
          '<caption class="sr-only">' + esc(t('att_today')) + '</caption>' +
          '<thead><tr>' +
            '<th scope="col">' + rich(t('att_col_employee')) + '</th>' +
            '<th scope="col">' + rich(t('att_col_status')) + '</th>' +
            '<th scope="col">' + rich(t('att_checkin_time')) + '</th>' +
            '<th scope="col">' + rich(t('att_col_late_min')) + '</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
      '<div class="att-month">' +
        '<p class="att-month-label label">' + rich(t('att_month')) + ' · ' + rich(SHIFT.tx(M.label) || t('att_hours_worked')) + '</p>' +
        '<p class="att-month-num num">' + esc(fmt(monthHours(c.present))) + ' ' + esc(t('hours')) + '</p>' +
        '<p class="att-month-formula small muted">' + rich(t('att_month_formula', { present: fmt(c.present), assumption: SHIFT.tx(M.assumption) })) + '</p>' +
      '</div>' +
      '<p class="att-payroll-note small muted">' + rich(t('att_payroll_note')) + '</p>';
  }
  function payrollHtml() {
    var open = S.phase === 'done' && S.payroll;
    return '<div class="att-payroll">' +
      '<button type="button" class="btn btn-ghost att-payroll-btn" data-att="payroll" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="att-sheet"' + (S.phase === 'done' ? '' : ' disabled') + '>' +
        SHIFT.icon('file-bar-chart', { size: 20 }) + '<span>' + rich(t('att_payroll_preview')) + '</span>' +
      '</button>' +
      '<div class="att-sheet card" id="att-sheet"' + (open ? '' : ' hidden') + '>' + (open ? sheetHtml() : '') + '</div>' +
    '</div>';
  }

  function render(el) {
    ensureState();
    el.innerHTML =
      '<div class="wrap att-in">' +
        '<div class="sec-head">' +
          '<p class="eyebrow">' + rich(t('sections.attendance.eyebrow')) + '</p>' +
          '<h2>' + rich(t('sections.attendance.title')) + '</h2>' +
          '<p class="intro">' + rich(t('sections.attendance.intro')) + '</p>' +
        '</div>' +
        '<div class="att-grid">' +
          rulesHtml() +
          boardHtml() +
          alertsHtml() +
          payrollHtml() +
          '<p class="att-note small muted">' + rich(SHIFT.tx(demo().note)) + '</p>' +
        '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------ in-place patches */
  function paintClock(el) {
    var c = clockCfg();
    var tm = $(el, '.att-clock time');
    if (tm) { tm.textContent = timeAt(S.clock); tm.setAttribute('datetime', datetimeAt(S.clock)); }
    var bar = $(el, '.att-progress');
    if (bar) {
      bar.setAttribute('aria-valuenow', String(S.clock - c.start));
      bar.setAttribute('aria-valuetext', timeAt(S.clock));
      var fill = bar.firstElementChild;
      if (fill) fill.style.setProperty('--p', String(progress()));
    }
  }
  function paintRows(el) {
    var list = staff();
    $$(el, '.att-row').forEach(function (li) {
      var i = num(li.getAttribute('data-i'), -1), p = list[i];
      if (!p) return;
      var st = statusAt(p, S.clock);
      if (li.getAttribute('data-status') === st) return;
      li.setAttribute('data-status', st);
      li.className = 'att-row is-' + st;
      var time = $(li, '.att-time');
      if (time) time.innerHTML = timeCellHtml(p, st);
      var pill = $(li, '.att-pill');
      if (pill) {
        pill.classList.remove('is-in');
        pill.innerHTML = pillInner(st, p);
        void pill.offsetWidth;          // commit the hidden frame, then fade in (200 ms; collapsed under reduced motion)
        pill.classList.add('is-in');
      }
    });
  }
  function paintCounters(el) {
    var c = counts(S.clock);
    COUNTER_KEYS.forEach(function (k) {
      var n = $(el, '.att-counter-num[data-att-count="' + k + '"]');
      if (n) n.textContent = fmt(c[k]);
    });
  }
  function scrollLog(el) {
    var msgs = $(el, '.att-msgs');
    if (!msgs) return;
    try { msgs.scrollTo({ top: msgs.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' }); }
    catch (e) { msgs.scrollTop = msgs.scrollHeight; }
  }
  // Append the alerts the clock has reached since the last paint (fade-in), or rebuild the whole log.
  function paintAlerts(el, rebuild) {
    var msgs = $(el, '.att-msgs');
    if (!msgs) return;
    if (rebuild) { msgs.innerHTML = bubblesHtml(); scrollLog(el); return; }
    var evs = eventsUntil(S.clock);
    if (evs.length <= S.alerted) return;
    var empty = $(msgs, '.att-empty');
    if (empty) empty.parentNode.removeChild(empty);
    for (var i = S.alerted; i < evs.length; i++) {
      msgs.insertAdjacentHTML('beforeend', bubbleHtml(evs[i], false));
      var node = msgs.lastElementChild;
      if (node) { void node.offsetWidth; node.classList.add('is-in'); }
    }
    S.alerted = evs.length;
    scrollLog(el);
  }
  function paintDone(el) {
    var chat = $(el, '.att-chat'), line = $(el, '.att-done');
    if (!chat) return;
    if (S.phase === 'done') { if (!line) chat.insertAdjacentHTML('beforeend', doneHtml()); }
    else if (line) line.parentNode.removeChild(line);
  }
  // Buttons are patched in place (never re-created) so keyboard focus survives a click.
  function paintButtons(el) {
    var runBtn = $(el, '.att-run'), label = $(el, '.att-run-label'), pay = $(el, '.att-payroll-btn');
    if (label) label.innerHTML = rich(runLabel());
    if (runBtn) { if (S.phase === 'running') runBtn.setAttribute('aria-disabled', 'true'); else runBtn.removeAttribute('aria-disabled'); }
    if (pay) {
      pay.disabled = S.phase !== 'done';
      pay.setAttribute('aria-expanded', (S.phase === 'done' && S.payroll) ? 'true' : 'false');
    }
  }
  function paintSheet(el) {
    var sheet = $(el, '.att-sheet');
    if (!sheet) return;
    var open = S.phase === 'done' && S.payroll;
    sheet.innerHTML = open ? sheetHtml() : '';
    sheet.hidden = !open;
  }
  function paintRules(el) {
    var s = $(el, 'select[data-att-rule="shiftStart"]'), g = $(el, 'select[data-att-rule="grace"]');
    if (s && s.value !== S.shiftStart) s.value = S.shiftStart;
    if (g && String(g.value) !== String(S.grace)) g.value = String(S.grace);
    var rule = $(el, '.att-absent-rule');
    if (rule) rule.innerHTML = rich(t('att_absent_after', { min: fmt(clockCfg().absentAfter) }));
  }
  function paintAll(el) {
    paintRules(el);
    paintClock(el);
    var list = $(el, '.att-list');
    if (list) list.innerHTML = rowsHtml();
    paintCounters(el);
    paintAlerts(el, true);
    paintDone(el);
    paintButtons(el);
    paintSheet(el);
  }

  /* --------------------------------------------------------------- timer */
  function stopTimer() { if (run.timer) { clearInterval(run.timer); run.timer = null; } }
  function canTick() { return run.visible && !d.hidden; }
  function finish(el) {
    stopTimer();
    S.phase = 'done';
    paintDone(el);
    paintButtons(el);
  }
  // Jump to the end of the morning at once (reduced motion, or a rule change after a finished run).
  function finishNow(el) {
    stopTimer();
    S.clock = clockCfg().end;
    paintClock(el);
    paintRows(el);
    paintCounters(el);
    paintAlerts(el, true);
    finish(el);
    paintSheet(el);
  }
  function step(el) {
    if (S.phase !== 'running') { stopTimer(); return; }
    var c = clockCfg();
    S.clock += 1;
    paintClock(el);
    paintRows(el);
    paintCounters(el);
    paintAlerts(el, false);
    if (S.clock >= c.end) finish(el);
  }
  // Runs only while the board is on screen and the tab is visible; otherwise it waits and resumes on enter.
  function startTimer(el) {
    stopTimer();
    if (S.phase !== 'running') return;
    if (reduced()) { finishNow(el); return; }
    if (!canTick()) return;
    run.timer = setInterval(function () { step(el); }, clockCfg().tick);
  }

  /* -------------------------------------------------------------- actions */
  function startRun(el) {
    if (S.phase === 'running') return;
    stopTimer();
    S.phase = 'running';
    S.clock = clockCfg().start;
    S.alerted = 0;
    S.payroll = false;
    paintAll(el);
    SHIFT.track('demo_run', { demo: 'attendance' });
    startTimer(el);
  }
  function reset(el) {
    stopTimer();
    S = freshState(S);
    paintAll(el);
  }
  function togglePayroll(el) {
    if (S.phase !== 'done') return;
    S.payroll = !S.payroll;
    paintButtons(el);
    paintSheet(el);
  }
  function onRule(el, sel) {
    var k = sel.getAttribute('data-att-rule');
    if (k === 'shiftStart') {
      var v = String(sel.value);
      if (startOptions().indexOf(v) === -1 || v === S.shiftStart) { paintRules(el); return; }
      S.shiftStart = v;
      S.startTouched = true;
    } else if (k === 'grace') {
      var g = num(sel.value, S.grace);
      if (graceOptions().indexOf(g) === -1 || g === S.grace) { paintRules(el); return; }
      S.grace = g;
    } else return;
    // Rules changed → outcomes follow the visible controls: a finished morning jumps to its new end state,
    // a running one starts over idle (so the log never mixes two rule sets).
    stopTimer();
    if (S.phase === 'done') { S.clock = clockCfg().end; paintAll(el); return; }
    S.phase = 'idle';
    S.clock = clockCfg().start;
    S.alerted = 0;
    S.payroll = false;
    paintAll(el);
  }

  /* ----------------------------------------------------------- visibility */
  function bindVisible(el) {
    if (run.offVisible) { run.offVisible(); run.offVisible = null; }
    var board = $(el, '.att-board');
    if (!board) return;
    run.offVisible = SHIFT.onVisible(board, function () {
      run.visible = true;
      if (S && S.phase === 'running') startTimer(el);
    }, function () {
      run.visible = false;
      stopTimer();                     // paused off-screen; resumes from the same simulated minute
    }, { threshold: 0.2 });
  }
  function bindDocVisibility() {
    if (run.docBound) return;
    run.docBound = true;
    d.addEventListener('visibilitychange', function () {
      if (d.hidden) stopTimer();
      else if (run.el && S && S.phase === 'running') startTimer(run.el);
    });
  }

  /* ----------------------------------------------------------------- init */
  function init(el) {
    run.el = el;
    el.addEventListener('click', function (e) {
      var b = e.target && typeof e.target.closest === 'function' ? e.target.closest('[data-att]') : null;
      if (!b || !el.contains(b)) return;
      var a = b.getAttribute('data-att');
      if (a === 'run') startRun(el);
      else if (a === 'reset') reset(el);
      else if (a === 'payroll') togglePayroll(el);
    });
    el.addEventListener('change', function (e) {
      var s = e.target;
      if (s && s.matches && s.matches('select[data-att-rule]')) onRule(el, s);
    });
    bindVisible(el);
    bindDocVisibility();
  }

  function update(el, reason, detail) {
    run.el = el;
    if (reason === 'sector') {
      stopTimer();
      S = freshState(S);               // new sector's staff + shift start (grace kept), start over idle
      render(el);
      bindVisible(el);
      return;
    }
    if (reason === 'lang' || reason === 'rerender') {
      stopTimer();                     // core re-rendered from S (same simulated minute); resume if it was running
      bindVisible(el);
      if (S && S.phase === 'running') startTimer(el);
      return;
    }
    if (reason === 'state' && detail && detail.key === 'bizName') {
      var biz = $(el, '[data-att-biz]');
      if (biz) biz.innerHTML = rich(SHIFT.bizName());
    }
  }

  SHIFT.sections[ID] = { id: ID, render: render, init: init, update: update };
})(window, document);
