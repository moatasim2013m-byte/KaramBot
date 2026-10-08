/**
 * Facebook JS SDK loader for Embedded Signup.
 *
 * Loaded on demand, not on every dashboard page: the SDK is only needed when
 * someone opens the WhatsApp connection screen, and it sets third-party cookies.
 * One in-flight promise is shared, so a double mount cannot inject the script twice.
 *
 * The split between preload() and launchEmbeddedSignup() is the point of this file. A browser
 * only lets a popup open from inside the click that asked for it; any await between the tap and
 * FB.login spends that permission, and mobile Safari and Chrome then block Meta's window. So the
 * screen preloads when it mounts, the button stays disabled until the SDK is ready, and the tap
 * calls FB.login with nothing in front of it.
 */

let sdkPromise = null;
let loadedFB = null;

/**
 * Load and init the SDK, in Arabic unless told otherwise: the popup is Meta's own screens, and
 * a shop owner in Irbid should not meet them in English.
 */
export function preload({ appId, graphVersion, locale = 'ar_AR' }) {
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    if (window.FB) {
      loadedFB = window.FB;
      resolve(window.FB);
      return;
    }

    window.fbAsyncInit = function fbAsyncInit() {
      window.FB.init({
        appId,
        autoLogAppEvents: true,
        xfbml: true,
        version: graphVersion,
      });
      loadedFB = window.FB;
      resolve(window.FB);
    };

    // Only a locale shaped like ar_AR reaches the URL; the config is ours, but the URL is a script.
    const safeLocale = /^[a-z]{2}_[A-Z]{2}$/.test(locale) ? locale : 'ar_AR';
    const script = document.createElement('script');
    script.src = `https://connect.facebook.net/${safeLocale}/sdk.js`;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    // A blocked or failed script (ad blockers do this) must reject, otherwise the button waits
    // forever. Clearing the promise lets the screen offer a second try.
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('facebook_sdk_failed'));
    };
    document.body.appendChild(script);
  });

  return sdkPromise;
}

// The old name, kept so nothing that still imports it breaks.
export const loadFacebookSdk = preload;

/** The SDK if it has finished loading, else null. Read synchronously inside a click handler. */
export function getLoadedSdk() {
  return loadedFB || null;
}

/**
 * Meta posts the signup events from a facebook.com window. Anything from another
 * origin is someone else talking to our page, so it is ignored before the payload
 * is even parsed.
 */
export function isFacebookOrigin(origin) {
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== 'https:') return false;
    return hostname === 'facebook.com' || hostname.endsWith('.facebook.com');
  } catch {
    return false;
  }
}

/**
 * WhatsApp's, Facebook's and Instagram's own browsers cannot run Meta's login popup reliably
 * (it opens behind the chat, or not at all), and a join link sent on WhatsApp opens in exactly
 * that browser. Detected from the user agent: FBAN/FBAV/FB_IAB are Facebook's and Messenger's.
 */
export function isInAppBrowser(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
  return /FBAN|FBAV|FB_IAB|FBIOS|Instagram|WhatsApp/i.test(ua || '');
}

/**
 * Launch Embedded Signup v4 and resolve with {code} or {code: null, status}.
 *
 * FB.login runs synchronously, inside the Promise executor, so a click handler that calls this
 * first keeps the user gesture. The caller must not await anything before calling it.
 *
 * `response_type: 'code'` with `override_default_response_type` is what makes Meta
 * hand back a code instead of an access token — the token must never reach a browser.
 * The code is alive for 30 seconds, so the caller posts it immediately.
 *
 * extras is {setup: {}} and nothing else: Meta's v4 docs say it is purposely empty. The
 * featureType '' and sessionInfoVersion '3' that used to be here did nothing under v4
 * (docs/panels/meta-facts.md, Q1e), and featureType stays unsent so coexistence is not offered.
 */
export function launchEmbeddedSignup(FB, { configId }) {
  return new Promise((resolve) => {
    FB.login(
      (response) => {
        const code = response?.authResponse?.code || null;
        resolve({ code, status: response?.status || null });
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {} },
      },
    );
  });
}
