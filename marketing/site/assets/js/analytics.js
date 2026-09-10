/*! shifts-ai.store — analytics.js — SHIFT.track(name, params)
 * Vanilla ES2019, classic <script>. Loads after core.js (which queues calls until this file runs).
 *
 * Reads window.SHIFT_CONFIG = { metaPixelId:"", ga4Id:"", googleAdsId:"", googleAdsLabels:{ lead:"" }, metaDomainVerification:"" }.
 * Exactly two vendors, each loaded `async` AFTER the window `load` event and ONLY when its ID is configured:
 *   Meta Pixel  → https://connect.facebook.net/en_US/fbevents.js
 *   Google tag  → https://www.googletagmanager.com/gtag/js   (GA4 and/or Google Ads)
 * Empty IDs → that vendor is a silent no-op. No IDs at all → SHIFT.track is a no-op. Never throws.
 *
 * Event map (SHIFT event → Meta Pixel / GA4 / Google Ads):
 *   page_view                         PageView               / (auto page_view on config)   / —
 *   whatsapp_click {placement,sector,bundle}  Lead + Contact / generate_lead                 / conversion (lead label)
 *   sector_select {sector}            ViewContent{content_name} / select_content            / —
 *   product_add {product}             AddToWishlist          / add_to_wishlist              / —
 *   product_remove {product}          —                      / product_remove (custom)      / —
 *   demo_run {demo}                   ViewContent            / select_content               / —
 *   roi_change {monthly_value}        —                      / roi_change (debounced 1 s)   / —
 *   contact_submit                    Lead                   / generate_lead                / conversion
 *   section_view {id}                 —                      / section_view                 / —
 *   anything else                     —                      / <name> (custom, params)      / —
 */
(function (w, d) {
  'use strict';

  var SHIFT = w.SHIFT;
  if (!SHIFT) return;

  function s(v) { return typeof v === 'string' ? v.trim() : ''; }
  var cfg = w.SHIFT_CONFIG || {};
  var META = s(cfg.metaPixelId);
  var GA4 = s(cfg.ga4Id);
  var ADS = s(cfg.googleAdsId);
  var LEAD_LABEL = s(cfg.googleAdsLabels && cfg.googleAdsLabels.lead);
  var DOMAIN_VERIFICATION = s(cfg.metaDomainVerification);
  var hasMeta = !!META;
  var hasGoogle = !!(GA4 || ADS);

  var ready = false;          // vendors initialised (or: nothing to initialise)
  var queue = [];             // calls made before `ready`
  var roiTimer = null;

  SHIFT.analytics = { meta: hasMeta, google: hasGoogle, ads: !!(ADS && LEAD_LABEL) };

  function sanitize(p) {
    var o = {};
    if (p && typeof p === 'object') {
      Object.keys(p).forEach(function (k) {
        var v = p[k];
        if (v == null) return;
        o[k] = (typeof v === 'number' || typeof v === 'boolean') ? v : String(v).slice(0, 100);
      });
    }
    return o;
  }

  function adsConversion(gtag) {
    if (ADS && LEAD_LABEL) gtag('event', 'conversion', { send_to: ADS + '/' + LEAD_LABEL });
  }

  function dispatch(name, p) {
    var fbq = hasMeta && typeof w.fbq === 'function' ? w.fbq : null;
    var gtag = hasGoogle && typeof w.gtag === 'function' ? w.gtag : null;
    if (!fbq && !gtag) return;
    switch (name) {
      case 'page_view':
        if (fbq) fbq('track', 'PageView');
        // GA4 sends page_view automatically from gtag('config', …).
        break;
      case 'whatsapp_click':
        if (fbq) { fbq('track', 'Lead', p); fbq('track', 'Contact', p); }
        if (gtag) { gtag('event', 'generate_lead', p); adsConversion(gtag); }
        break;
      case 'contact_submit':
        if (fbq) fbq('track', 'Lead', p);
        if (gtag) { gtag('event', 'generate_lead', p); adsConversion(gtag); }
        break;
      case 'sector_select':
        if (fbq) fbq('track', 'ViewContent', { content_name: p.sector, content_type: 'sector' });
        if (gtag) gtag('event', 'select_content', { content_type: 'sector', item_id: p.sector });
        break;
      case 'product_add':
        if (fbq) fbq('track', 'AddToWishlist', { content_name: p.product });
        if (gtag) gtag('event', 'add_to_wishlist', { items: [{ item_id: p.product, item_name: p.product }] });
        break;
      case 'product_remove':
        if (gtag) gtag('event', 'product_remove', p);
        break;
      case 'demo_run':
        if (fbq) fbq('track', 'ViewContent', { content_name: p.demo, content_type: 'demo' });
        if (gtag) gtag('event', 'select_content', { content_type: 'demo', item_id: p.demo });
        break;
      case 'roi_change':
        if (gtag) gtag('event', 'roi_change', p);
        break;
      case 'section_view':
        if (gtag) gtag('event', 'section_view', p);
        break;
      default:
        if (gtag) gtag('event', name, p);
    }
  }

  function send(name, p) {
    if (ready) dispatch(name, p); else queue.push([name, p]);
  }

  SHIFT.track = function (name, params) {
    try {
      if (!name || (!hasMeta && !hasGoogle)) return;
      var p = sanitize(params);
      if (name === 'roi_change') {
        clearTimeout(roiTimer);
        roiTimer = setTimeout(function () { try { send('roi_change', p); } catch (e) { /* never throw */ } }, 1000);
        return;
      }
      send(String(name), p);
    } catch (e) { /* never throw */ }
  };

  /* ------------------------------------------------------- vendor loaders */
  function loadScript(src) {
    var el = d.createElement('script');
    el.async = true;
    el.src = src;
    (d.head || d.documentElement).appendChild(el);
  }
  function initMeta() {
    if (typeof w.fbq === 'function') { w.fbq('init', META); return; }
    var n = w.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!w._fbq) w._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    loadScript('https://connect.facebook.net/en_US/fbevents.js');
    w.fbq('init', META);
  }
  function initGoogle() {
    w.dataLayer = w.dataLayer || [];
    if (typeof w.gtag !== 'function') w.gtag = function () { w.dataLayer.push(arguments); };
    w.gtag('js', new Date());
    if (GA4) w.gtag('config', GA4);
    if (ADS) w.gtag('config', ADS);
    loadScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA4 || ADS));
  }
  function boot() {
    try {
      if (DOMAIN_VERIFICATION && !d.querySelector('meta[name="facebook-domain-verification"]')) {
        var m = d.createElement('meta');
        m.name = 'facebook-domain-verification';
        m.content = DOMAIN_VERIFICATION;
        (d.head || d.documentElement).appendChild(m);
      }
      if (hasMeta) initMeta();
      if (hasGoogle) initGoogle();
    } catch (e) { /* never throw */ }
    ready = true;
    var pending = (SHIFT._trackQueue || []).map(function (x) { return [x[0], sanitize(x[1])]; }).concat(queue);
    if (SHIFT._trackQueue) SHIFT._trackQueue.length = 0;
    queue.length = 0;
    pending.forEach(function (x) { try { dispatch(x[0], x[1]); } catch (e) { /* never throw */ } });
  }

  if (!hasMeta && !hasGoogle) {
    ready = true;                                   // nothing to load: drop everything silently
    if (SHIFT._trackQueue) SHIFT._trackQueue.length = 0;
  } else if (d.readyState === 'complete') {
    setTimeout(boot, 0);
  } else {
    w.addEventListener('load', function () { setTimeout(boot, 0); });
  }
})(window, document);
