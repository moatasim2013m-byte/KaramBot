const { reportError } = require('./logger');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Meta API best-practice:
 * - short timeout to prevent worker saturation
 * - retry only on rate limit (429) and transient 5xx errors
 */
async function fetchMetaWithRetry(url, options = {}, context = {}) {
  const retries = Number(process.env.META_API_RETRIES || 3);
  const timeoutMs = Number(process.env.META_API_TIMEOUT_MS || 15000);

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();

      if (response.ok) {
        clearTimeout(timeout);
        return { ok: true, status: response.status, text };
      }

      const retryable = response.status === 429 || response.status >= 500;
      const metaError = text.slice(0, 500);
      lastError = new Error(metaError || `Meta API HTTP ${response.status}`);

      if (!retryable || attempt === retries) {
        clearTimeout(timeout);
        return { ok: false, status: response.status, text, error: metaError };
      }

      clearTimeout(timeout);
      await wait(300 * (2 ** attempt));
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt === retries) {
        await reportError({
          message: 'Meta API request failed after retries',
          error,
          context: { event: 'meta_api_request_failure', ...context }
        });
        return { ok: false, error: error.message || 'Meta API request failed' };
      }
      await wait(300 * (2 ** attempt));
    }
  }

  return { ok: false, error: lastError?.message || 'Unknown Meta API failure' };
}

module.exports = { fetchMetaWithRetry };
