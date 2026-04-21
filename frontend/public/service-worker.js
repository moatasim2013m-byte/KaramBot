/* eslint-disable no-restricted-globals */
/**
 * Peekaboo Staff PWA – minimal service worker.
 *
 * Purpose: satisfy the browser's "registered service worker" requirement
 * so Android Chrome and desktop Chrome show the Add-to-Home-Screen /
 * Install prompt alongside the manifest.json already in place.
 *
 * Intentionally has NO fetch handler and NO caching strategy.
 * All network requests (including /api/*) go directly to the network.
 * This prevents any risk of stale staff data being served from cache.
 */

self.addEventListener('install', () => {
  // Take over immediately — no waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Claim all open clients so the SW is active right away.
  event.waitUntil(clients.claim());
});

// No fetch handler. Every request goes to the network as normal.
