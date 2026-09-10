/*! shifts-ai.store — sections/top.js — #top: opening + live ops card (premium direction, 2026-09-10)
 * Vanilla ES2019, classic <script>. Depends on content.js + core.js (window.SHIFT).
 *
 * Renders (contract "Page order 2" + "Live ops card", visuals per PREMIUM-DIRECTION.md / Main.dc.html):
 *   eyebrow (hairline rule drawn by base .eyebrow) → H1 (sentence-split into two .top-h1-line spans) → proof line
 *   → ONE green WhatsApp CTA 52px (data-wa="top" data-cta="top": core's delegated handler calls SHIFT.waLink('top'))
 *   + the secondary text link «شاهد كرم يردّ ↓» (desktop only, CSS) → note «بلا التزام · نردّ خلال ساعات العمل»
 *   → the ops card as the DARK GLASS panel (.panel-glass): title + subtitle + «مثال توضيحي» badge,
 *     rows as .glass-row (32px .glass-icon, 14.5px text, 12px tabular time at the end),
 *     3 rows in the HTML at first paint, 5 more stream in (one every 1.4 s, .is-new 200 ms), then it stops;
 *     the NEWEST row carries .is-hot (moved as rows stream in);
 *     footer line «تحديث <real clock>» / «N أحداث هذا الصباح» (N = rows on screen).
 *   → sector chips row: label + three 44px pills (data-action="sector": core's delegated handler sets the sector).
 *
 * Rows come from SHIFT.sector().opsRows (sector-aware); every string comes from content.js.
 * Row times are illustrative minutes inside the card's «9–10 صباحًا» window (Latin digits; the card is labelled
 * «مثال توضيحي»); the footer clock is the visitor's REAL time.
 * Timers (stream + clock) run only while the panel is on screen (SHIFT.onVisible) and never loop.
 * prefers-reduced-motion: all rows are present at first paint and nothing streams.
 */
(function (w, d) {
  'use strict';
  if (!w.SHIFT) return;
  var SHIFT = w.SHIFT;

  var ID = 'top';
  var FIRST_PAINT = 3;       // rows present in the HTML before any timer runs
  var STREAM_MS = 1400;      // one new row every 1.4 s
  var CLOCK_MS = 60 * 1000;  // the footer clock shows hour:minute

  var ICON_BY_KIND = {
    order: 'shopping-bag',
    booking: 'calendar-check',
    reminder: 'bell',
    question: 'message',
    late: 'alert',
    payment: 'check',
    handoff: 'headphones',
    report: 'file-bar-chart'
  };
  // Chip glyph per sector — the same glyphs #cases uses, so the page reads as one system.
  var ICON_BY_SECTOR = { clinic: 'stethoscope', restaurant: 'utensils', store: 'shopping-bag' };
  // Illustrative row times (minutes past 9:00) — the subtitle says «بين الساعة 9 و10 صباحًا».
  var ROW_MINUTES = [4, 11, 17, 26, 33, 41, 53, 58];

  // Section-local runtime state (survives re-renders; never persisted).
  var S = {
    shown: FIRST_PAINT,   // rows currently in the DOM
    done: false,          // stream finished (or skipped for reduced motion)
    visible: false,       // panel on screen right now
    streamT: null,        // pending setTimeout for the next row
    clockT: null,         // setTimeout to the next minute boundary
    clockI: null,         // setInterval once aligned to the minute
    offVisible: null      // IntersectionObserver disposer
  };

  /* ------------------------------------------------------------ helpers */
  function rows() {
    var s = SHIFT.sector();
    return (s && Array.isArray(s.opsRows)) ? s.opsRows : [];
  }
  function sectors() { return (SHIFT.content && SHIFT.content.sectors) || {}; }
  function sectorKeys() { return SHIFT.SECTORS.filter(function (k) { return !!sectors()[k]; }); }
  function reducedMotion() {
    try { return !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function datetimeAttr(date) { return pad2(date.getHours()) + ':' + pad2(date.getMinutes()); }
  function rowMinute(i) { return ROW_MINUTES[clamp(i, 0, ROW_MINUTES.length - 1)]; }

  // «عميل يراسلك الساعة 11 ليلًا. كرم يردّ…» → two lines, split at the first sentence end.
  function titleLines(str) {
    var m = /^([\s\S]*?[.؟!])\s+(\S[\s\S]*)$/.exec(String(str || '').trim());
    return m ? [m[1], m[2]] : [String(str || '')];
  }

  function rowHtml(row, i, isNew, isHot) {
    var kind = String((row && row.kind) || '').toLowerCase();
    var icon = ICON_BY_KIND[kind] || 'message';
    var min = rowMinute(i);
    return '<li class="glass-row ops-row ops-row-' + SHIFT.esc(kind || 'other') + (isNew ? ' is-new' : '') + (isHot ? ' is-hot' : '') + '" data-i="' + i + '">' +
      '<span class="glass-icon ops-ic" aria-hidden="true">' + SHIFT.icon(icon, { size: 16 }) + '</span>' +
      '<span class="glass-row-text ops-text">' + SHIFT.rich(SHIFT.tx(row && row.text)) + '</span>' +
      '<time class="glass-time ops-time" datetime="09:' + pad2(min) + '">9:' + pad2(min) + '</time>' +
    '</li>';
  }
  function feedHtml(count) {
    var list = rows(), out = '', n = Math.min(count, list.length);
    for (var i = 0; i < n; i++) out += rowHtml(list[i], i, false, i === n - 1);
    return out;
  }
  function doneHtml() {
    // role="status" = an implicit polite live region: the ONE announcement when the stream finishes.
    return '<p class="ops-done small" role="status">' + SHIFT.rich(SHIFT.t('ops_done')) + '</p>';
  }
  function countText(n) { return SHIFT.t('ops_count', { n: String(n) }); }
  // «تحديث {{time}}» → the text around the token goes through rich(); the token becomes a real <time> element.
  function updatedHtml(now) {
    var parts = String(SHIFT.t('ops_updated')).split(/\{\{\s*time\s*\}\}/);
    var timeEl = '<time datetime="' + datetimeAttr(now) + '">' + SHIFT.esc(SHIFT.timeText(now)) + '</time>';
    if (parts.length < 2) return SHIFT.rich(parts[0]) + ' ' + timeEl;
    return parts.map(SHIFT.rich).join(timeEl);
  }
  function footHtml(now, count) {
    return '<div class="ops-foot">' +
      '<span class="ops-clock num">' +
        '<span class="sr-only">' + SHIFT.esc(SHIFT.t('ops_clock_aria')) + ': </span>' +
        updatedHtml(now) +
      '</span>' +
      // Not a live region: the count is rewritten on every streamed row and the rows already carry the information.
      '<span class="ops-count num">' + SHIFT.esc(countText(count)) + '</span>' +
    '</div>';
  }
  function chipHtml(key, current) {
    var s = sectors()[key], on = key === current;
    return '<button type="button" class="chip top-chip' + (on ? ' is-on' : '') + '" aria-pressed="' + (on ? 'true' : 'false') + '"' +
      ' data-action="sector" data-sector="' + key + '">' +
      SHIFT.icon(ICON_BY_SECTOR[key] || 'store', { size: 15 }) +
      '<span>' + SHIFT.rich(SHIFT.tx(s && s.label)) + '</span>' +
    '</button>';
  }
  function chipsHtml(current) {
    return sectorKeys().map(function (k) { return chipHtml(k, current); }).join('');
  }

  /* ------------------------------------------------------------- render */
  function render(el) {
    var list = rows();
    // Reduced motion: everything is present at first paint, nothing streams.
    if (reducedMotion()) { S.shown = list.length; S.done = true; }
    S.shown = clamp(S.shown, Math.min(FIRST_PAINT, list.length), list.length);
    if (S.shown >= list.length) S.done = true;

    var now = new Date();
    var lines = titleLines(SHIFT.t('sections.top.title')).map(function (l) {
      return '<span class="top-h1-line">' + SHIFT.rich(l) + '</span>';
    }).join(' ');

    el.innerHTML =
      '<div class="wrap top-in">' +
        '<div class="top-text">' +
          '<p class="eyebrow top-eyebrow">' + SHIFT.rich(SHIFT.t('sections.top.eyebrow')) + '</p>' +
          '<h1 class="top-h1">' + lines + '</h1>' +
          '<p class="top-proof">' + SHIFT.rich(SHIFT.t('sections.top.intro')) + '</p>' +
          '<div class="top-actions">' +
            '<a class="btn btn-wa btn-lg top-cta" href="' + SHIFT.esc(SHIFT.waUrl()) + '" data-wa="top" data-cta="top" target="_blank" rel="noopener">' +
              SHIFT.icon('whatsapp', { size: 20 }) +
              '<span>' + SHIFT.esc(SHIFT.t('cta_whatsapp')) + '</span>' +
            '</a>' +
            '<a class="link-quiet top-watch" href="#karam">' + SHIFT.rich(SHIFT.t('top_watch')) + '</a>' +
          '</div>' +
          '<p class="top-note small">' + SHIFT.rich(SHIFT.t('top_note')) + '</p>' +
        '</div>' +
        '<div class="ops panel-glass" role="region" aria-label="' + SHIFT.esc(SHIFT.t('ops_title')) + '">' +
          '<div class="ops-head">' +
            '<div class="ops-titles">' +
              '<h2 class="ops-title">' + SHIFT.rich(SHIFT.t('ops_title')) + '</h2>' +
              '<p class="ops-sub">' + SHIFT.rich(SHIFT.t('ops_subtitle')) + '</p>' +
            '</div>' +
            '<span class="badge badge-example">' + SHIFT.esc(SHIFT.t('illustrative')) + '</span>' +
          '</div>' +
          '<ol class="ops-feed" data-sector="' + SHIFT.esc(SHIFT.state.sector) + '" aria-label="' + SHIFT.esc(SHIFT.t('ops_feed_aria')) + '">' +
            feedHtml(S.shown) +
          '</ol>' +
          (S.done ? doneHtml() : '') +
          footHtml(now, S.shown) +
        '</div>' +
        '<div class="top-sectors">' +
          '<p class="chips-label top-sectors-label">' + SHIFT.rich(SHIFT.t('top_sectors_label')) + '</p>' +
          '<div class="chips top-chips" role="group" aria-label="' + SHIFT.esc(SHIFT.t('cases_pick_aria')) + '">' +
            chipsHtml(SHIFT.state.sector) +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* -------------------------------------------------------------- clock */
  function paintClock(el) {
    var t = el.querySelector('.ops-clock time');
    if (!t) return;
    var now = new Date();
    t.textContent = SHIFT.timeText(now);
    t.setAttribute('datetime', datetimeAttr(now));
  }
  function paintCount(el) {
    var c = el.querySelector('.ops-count');
    if (c) c.textContent = countText(S.shown);
  }
  function stopClock() {
    if (S.clockT) { clearTimeout(S.clockT); S.clockT = null; }
    if (S.clockI) { clearInterval(S.clockI); S.clockI = null; }
  }
  function startClock(el) {
    stopClock();
    paintClock(el);
    var now = new Date();
    var toNextMinute = CLOCK_MS - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50;
    S.clockT = setTimeout(function () {
      S.clockT = null;
      paintClock(el);
      S.clockI = setInterval(function () { paintClock(el); }, CLOCK_MS);
    }, toNextMinute);
  }

  /* ------------------------------------------------------------- stream */
  function stopStream() {
    if (S.streamT) { clearTimeout(S.streamT); S.streamT = null; }
  }
  function finish(el) {
    S.done = true;
    var panel = el.querySelector('.ops');
    if (!panel || panel.querySelector('.ops-done')) return;
    var foot = panel.querySelector('.ops-foot');
    if (foot) foot.insertAdjacentHTML('beforebegin', doneHtml());
    else panel.insertAdjacentHTML('beforeend', doneHtml());
  }
  function appendRow(el, i) {
    var feed = el.querySelector('.ops-feed'), list = rows();
    if (!feed || !list[i]) return false;
    // The newest row is the only hot one: hand the class over before the new row lands.
    var prevHot = feed.querySelector('.is-hot');
    if (prevHot) prevHot.classList.remove('is-hot');
    feed.insertAdjacentHTML('beforeend', rowHtml(list[i], i, true, true));
    var li = feed.lastElementChild;
    if (li) {
      // Two frames so the initial opacity:0 / translateY(4px) is committed before the 200 ms transition.
      w.requestAnimationFrame(function () {
        w.requestAnimationFrame(function () { li.classList.remove('is-new'); });
      });
    }
    return true;
  }
  function tick(el) {
    S.streamT = null;
    if (!S.visible || S.done) return;
    if (appendRow(el, S.shown)) { S.shown++; paintCount(el); }
    if (S.shown >= rows().length) finish(el);
    else schedule(el);
  }
  function schedule(el) {
    if (S.streamT || S.done || !S.visible) return;
    if (S.shown >= rows().length) { finish(el); return; }
    S.streamT = setTimeout(function () { tick(el); }, STREAM_MS);
  }

  /* ---------------------------------------------------------- visibility */
  function watch(el) {
    if (S.offVisible) { S.offVisible(); S.offVisible = null; }
    var panel = el.querySelector('.ops');
    if (!panel) return;
    S.offVisible = SHIFT.onVisible(panel, function () {
      S.visible = true;
      startClock(el);
      schedule(el);
    }, function () {
      S.visible = false;
      stopClock();
      stopStream();
    }, { threshold: 0.2 });
  }

  /* ---------------------------------------------------------------- chips */
  function patchChips(el) {
    var key = SHIFT.state.sector;
    var chips = el.querySelectorAll('.top-chips .chip');
    for (var i = 0; i < chips.length; i++) {
      var on = chips[i].getAttribute('data-sector') === key;
      chips[i].classList.toggle('is-on', on);
      chips[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  /* --------------------------------------------------------------- module */
  SHIFT.sections[ID] = {
    id: ID,
    render: render,
    init: function (el) {
      // Chip clicks are handled by core's delegated data-action="sector"; nothing to bind here.
      watch(el);
    },
    update: function (el, reason) {
      if (reason === 'sector') {
        // core did NOT re-render on 'sector': swap the feed for the new sector and let it stream again (once).
        stopStream();
        var list = rows();
        S.done = reducedMotion();
        S.shown = S.done ? list.length : Math.min(FIRST_PAINT, list.length);
        var feed = el.querySelector('.ops-feed');
        var old = el.querySelector('.ops-done');
        if (old) old.parentNode.removeChild(old);
        if (feed) {
          feed.setAttribute('data-sector', SHIFT.state.sector);
          feed.innerHTML = feedHtml(S.shown);
          paintCount(el);
          patchChips(el);
        } else {
          render(el);
        }
        if (S.done || S.shown >= list.length) finish(el);
        watch(el);
        return;
      }
      // 'lang' (core already re-rendered with the current S.shown) and any other full re-render:
      // re-attach the observer to the fresh panel; the stream resumes from where it was.
      stopStream();
      stopClock();
      watch(el);
    }
  };
})(window, document);
