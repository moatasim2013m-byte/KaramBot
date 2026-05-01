/* eslint-disable no-restricted-globals */

import { clientsClaim, skipWaiting } from "workbox-core";
import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute } from "workbox-routing";

// Activate the new service worker immediately without waiting for all tabs to
// close. Combined with clientsClaim() this ensures staff devices receive code
// updates on the very next page navigation after a new build is deployed.
skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);

const fileExtensionRegexp = new RegExp("/[^/?]+\\.[^/]+$");
registerRoute(
  ({ request, url }) => {
    if (request.mode !== "navigate") {
      return false;
    }
    if (url.pathname.startsWith("/_")) {
      return false;
    }
    if (url.pathname.match(fileExtensionRegexp)) {
      return false;
    }
    return true;
  },
  createHandlerBoundToURL(`${process.env.PUBLIC_URL}/index.html`),
);

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

