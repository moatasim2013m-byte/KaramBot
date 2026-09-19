/**
 * One classifier for every provider's failures, so the retry/failover loop in provider.js decides on a
 * kind, never on a message.
 *
 *   timeout      our own abort, or the SDK's request timeout: the model never answered inside the cap
 *   transient    429 / 5xx / 529 / socket: fails in milliseconds, the next call usually succeeds
 *   billing      credits exhausted / payment required: nothing on this provider works until someone pays
 *   auth         401 / 403 / key rejected: nothing on this provider works until the key is fixed
 *   not_found    404 model: a config error, same for every call
 *   bad_request  any other 4xx: this request will fail the same way again on this provider
 *   error        anything else (unknown): retried on the same provider, as before
 *
 * Anthropic: the SDK's typed classes (Anthropic.BadRequestError, …) and `err.type`. The one place a message
 * is read is the «credit balance is too low» 400, which the API sends as an invalid_request_error.
 * Gemini (@google/generative-ai 0.24): GoogleGenerativeAIFetchError carries a numeric `status`; the SDK has no
 * billing/auth classes, so the rest is matched on its message here and only here.
 */

const FATAL_KINDS = ['billing', 'auth', 'not_found'];
// Kinds that retrying the SAME provider will not fix: the turn moves to the fallback provider (if any).
const SWITCH_KINDS = [...FATAL_KINDS, 'bad_request'];

const TRANSIENT_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const TRANSIENT_RE = /\b(408|409|429|500|502|503|504|529)\b|service unavailable|unavailable|overloaded|high demand|try again|internal error|rate.?limit|quota|econnreset|etimedout|enotfound|eai_again|socket hang up|network|fetch failed/i;
const TIMEOUT_RE = /aborted|abort|timeout|timed out|deadline/i;
const BILLING_RE = /\b402\b|payment required|prepayment|credits? (are |is )?(depleted|exhausted)|credit balance|billing/i;
const AUTH_RE = /\b(401|403)\b|api key not valid|api_key_invalid|invalid api key|unauthenticated|permission denied|permission_denied/i;
const NOT_FOUND_RE = /\b404\b|not found/i;
const CREDIT_BALANCE_RE = /credit balance/i;

const statusOf = (err) => {
  if (err && typeof err.status === 'number') return err.status;
  const m = /\[(\d{3})[ \]]/.exec((err && err.message) || '');
  return m ? Number(m[1]) : null;
};

function innerMessage(err) {
  const body = err && err.error;
  const inner = body && (body.error || body);
  return (inner && typeof inner.message === 'string' && inner.message) || (err && err.message) || '';
}

function loadAnthropicSdk() {
  try {
    return require('@anthropic-ai/sdk');
  } catch {
    return {};
  }
}

const isA = (err, Cls) => typeof Cls === 'function' && err instanceof Cls;

/** Anthropic SDK errors, by class (most specific first), then `type`, then status. */
function classifyAnthropic(err, sdk = loadAnthropicSdk()) {
  if (isA(err, sdk.APIConnectionTimeoutError) || isA(err, sdk.APIUserAbortError)) return 'timeout';
  if (isA(err, sdk.APIConnectionError)) return 'transient';
  if (isA(err, sdk.AuthenticationError) || isA(err, sdk.PermissionDeniedError)) return 'auth';
  if (isA(err, sdk.NotFoundError)) return 'not_found';
  if (isA(err, sdk.RateLimitError) || isA(err, sdk.InternalServerError)) return 'transient';
  if (isA(err, sdk.BadRequestError)) return CREDIT_BALANCE_RE.test(innerMessage(err)) ? 'billing' : 'bad_request';
  if (isA(err, sdk.APIError)) {
    const status = err.status;
    if (status === 402 || err.type === 'billing_error') return 'billing';
    if (err.type === 'overloaded_error' || TRANSIENT_STATUSES.has(status) || (status && status >= 500)) return 'transient';
    if (status && status >= 400 && status < 500) return 'bad_request';
    return 'error';
  }
  // Not an SDK error: our own JS-race timeout, or a plain error from a fake/mocked client.
  return classifyGeneric(err);
}

/** Gemini (and OpenAI, and plain errors): status when the SDK gives one, else the message. */
function classifyGeneric(err) {
  const message = (err && err.message) || '';
  if ((err && err.name === 'AbortError') || TIMEOUT_RE.test(message)) return 'timeout';
  const status = statusOf(err);
  if (status === 402 || BILLING_RE.test(message)) return 'billing';
  if (status === 401 || status === 403 || AUTH_RE.test(message)) return 'auth';
  if (status === 404 || (status === null && NOT_FOUND_RE.test(message) && /model/i.test(message))) return 'not_found';
  if ((status && TRANSIENT_STATUSES.has(status)) || (status && status >= 500) || TRANSIENT_RE.test(message)) return 'transient';
  if (status && status >= 400 && status < 500) return 'bad_request';
  return 'error';
}

function classifyProviderError(err, provider) {
  if (provider === 'anthropic') return classifyAnthropic(err);
  return classifyGeneric(err);
}

module.exports = {
  classifyProviderError,
  classifyAnthropic,
  classifyGeneric,
  FATAL_KINDS,
  SWITCH_KINDS,
  TIMEOUT_RE,
  TRANSIENT_RE,
};
