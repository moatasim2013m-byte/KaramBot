/* eslint-disable no-restricted-globals */
/**
 * Peekaboo Staff PWA — service worker (Phase 8 one-time cache purge).
 *
 * Why this exists
 * ---------------
 * A previous deploy shipped a Workbox precache service worker that cached
 * `index.html` + JS/CSS bundles on users' devices. Some staff phones are
 * still being served that stale precache, showing an old English /
 * manual-first staff scanner UI that no longer exists in the source.
 *
 * This service worker performs a one-time Cache Storage purge per client,
 * then gets out of the way:
 *
 *   1. On install  → `self.skipWaiting()` so the new SW becomes active
 *      immediately (no waiting for all tabs to close).
 *   2. On activate →
 *        a) iterate every Cache Storage entry and delete it (wipes any
 *           Workbox precache left behind by the previous deploy);
 *        b) `clients.claim()` so this SW controls every open tab right away;
 *        c) IF (and only if) a cache was actually purged, navigate each open
 *           window client to its current URL once — pulling fresh HTML + JS
 *           from the network. Clean clients (nothing to purge) are NEVER
 *           reloaded, which prevents infinite-refresh loops on future
 *           deploys and zero-disruption for first-time visitors.
 *   3. NO fetch handler. Every network request — including `/api/*` — goes
 *      straight to the network as normal. Staff data can never be served
 *      from cache.
 *
 * This SW is still useful after the migration: Android / desktop Chrome
 * require a registered service worker (alongside the manifest) to show the
 * Add-to-Home-Screen / Install prompt. Keeping it registered retains that
 * capability without any caching side-effects.
 */

self.addEventListener('install', () => {
  // Take over immediately — do not wait for old tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Step 1 — wipe every Cache Storage entry (e.g. leftover Workbox precache
    // from the previous deploy). Track whether anything was actually deleted
    // so we can skip the reload for clean / first-time clients.
    let deletedCount = 0;
    try {
      const keys = await caches.keys();
      if (keys.length > 0) {
        const results = await Promise.all(keys.map((key) => caches.delete(key)));
        deletedCount = results.filter(Boolean).length;
      }
    } catch (_err) {
      // Cache Storage may be unavailable (private mode, older browsers).
      // Nothing to purge — continue silently.
    }

    // Step 2 — claim all open clients so this SW is the active one.
    await self.clients.claim();

    // Step 3 — one-shot reload, only for clients that were actually stuck on
    // an old cached build. No cache deleted → no reload. This is what
    // prevents an infinite refresh loop across future deploys.
    if (deletedCount > 0) {
      try {
        const windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true
        });
        await Promise.all(windowClients.map((client) => {
          if (typeof client.navigate === 'function') {
            return client.navigate(client.url).catch(() => undefined);
          }
          return undefined;
        }));
      } catch (_err) {
        // Navigation can fail if the client is closing or cross-origin.
        // Ignore — the user's next manual refresh will pick up fresh assets
        // anyway since the caches are already purged.
      }
    }
  })());
});

// Intentionally NO fetch handler.
// All requests (including /api/*) go directly to the network.
