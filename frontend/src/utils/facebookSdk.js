/**
 * Facebook JS SDK loader for Embedded Signup.
 *
 * Loaded on demand, not on every dashboard page: the SDK is only needed when
 * someone opens the WhatsApp connection screen, and it sets third-party cookies.
 * One in-flight promise is shared, so a double click cannot inject the script twice.
 */

let sdkPromise = null;

export function loadFacebookSdk({ appId, graphVersion }) {
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    if (window.FB) {
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
      resolve(window.FB);
    };

    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    // A blocked or failed script must reject, otherwise the button spins forever.
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('Facebook SDK failed to load'));
    };
    document.body.appendChild(script);
  });

  return sdkPromise;
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
 * Launch Embedded Signup v4 and resolve with the exchangeable code.
 *
 * `response_type: 'code'` with `override_default_response_type` is what makes Meta
 * hand back a code instead of an access token — the token must never reach a browser.
 * The code is alive for 30 seconds, so the caller posts it immediately.
 */
export function launchEmbeddedSignup(FB, { configId }) {
  return new Promise((resolve, reject) => {
    FB.login(
      (response) => {
        const code = response?.authResponse?.code;
        if (code) resolve(code);
        else reject(new Error(response?.status || 'signup_cancelled'));
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: '',          // default Cloud API flow (v4)
          sessionInfoVersion: '3',  // v4 session payloads
        },
      },
    );
  });
}
