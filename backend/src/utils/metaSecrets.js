/**
 * Meta app secrets, read at runtime from GCP Secret Manager.
 *
 * SHIFT runs more than one Meta app: the original Karambot app signs the webhooks
 * for numbers we onboarded by hand, and the "SHIFT AI & Automation" app (the
 * verified Tech Provider) signs everything that arrives through Embedded Signup.
 * A webhook must be checked against the secret of the app that sent it, so
 * secrets are looked up by app id.
 *
 * Nothing here is ever logged or returned to a client — callers get the value
 * only to hand it to crypto or to Graph.
 */

const APP_SECRET_ENV = {
  // app id → env var holding the secret (Cloud Run maps these to Secret Manager versions)
  [process.env.META_ES_APP_ID || '1065272896256103']: 'SHIFT_ES_APP_SECRET',
};

// Cached per process: these rotate rarely and a webhook must not wait on a network call.
const cache = new Map();

/**
 * The secret for one Meta app id, or null when it is not configured.
 * Falls back to META_APP_SECRET for the legacy app so existing webhooks keep working.
 */
function appSecretFor(appId) {
  const key = String(appId || '');
  if (cache.has(key)) return cache.get(key);

  const envName = APP_SECRET_ENV[key];
  const value = (envName && process.env[envName]) || null;
  cache.set(key, value);
  return value;
}

/** Every configured app secret, for a webhook whose app id we cannot tell in advance. */
function allAppSecrets() {
  const secrets = [];
  for (const envName of new Set(Object.values(APP_SECRET_ENV))) {
    if (process.env[envName]) secrets.push(process.env[envName]);
  }
  if (process.env.META_APP_SECRET) secrets.push(process.env.META_APP_SECRET);
  return secrets;
}

/** The Embedded Signup app id and secret, for the code→token exchange. */
function embeddedSignupApp() {
  const appId = process.env.META_ES_APP_ID || '1065272896256103';
  const secret = appSecretFor(appId);
  if (!secret) {
    // Deliberately loud: without it the exchange cannot run, and we never invent a value.
    throw new Error(
      'SHIFT_ES_APP_SECRET is not configured. Add the app secret for ' +
      `${appId} to Secret Manager and map it into the service.`
    );
  }
  return { appId, secret };
}

function _resetCache() { cache.clear(); }

module.exports = { appSecretFor, allAppSecrets, embeddedSignupApp, _resetCache };
