/**
 * CyberSource Unified Checkout (Microform v2 + Payments v2)
 *
 * Implements HTTP Signature authentication for CyberSource REST APIs and
 * exposes helpers to:
 *   - Create a Unified Checkout capture context (Sessions API JWT)
 *   - Authorize + capture a payment using a transient token JWT
 *
 * Uses only Node.js built-in modules (crypto, https). No new npm packages.
 *
 * Environment variables:
 *   - CYBERSOURCE_REST_KEY_ID         REST API Key from Areeba/Capital Bank
 *   - CYBERSOURCE_REST_SHARED_SECRET  REST API Shared Secret (base64) from Areeba/Capital Bank
 *   - CAPITAL_BANK_MERCHANT_ID        (or CYBERSOURCE_MERCHANT_ID) Merchant ID
 *   - CAPITAL_BANK_ENV                'test' (default) -> apitest.cybersource.com
 *                                     'prod' / 'live'  -> api.cybersource.com
 */

const crypto = require('crypto');
const https = require('https');

const LOG_PREFIX = '[CyberSource Unified Checkout]';

const getRestKeyId = () => String(process.env.CYBERSOURCE_REST_KEY_ID || '').trim();
const getRestSharedSecret = () => String(process.env.CYBERSOURCE_REST_SHARED_SECRET || '').trim();
const getMerchantId = () => String(
  process.env.CAPITAL_BANK_MERCHANT_ID
  || process.env.CYBERSOURCE_MERCHANT_ID
  || ''
).trim();

const getEnv = () => {
  const raw = String(process.env.CAPITAL_BANK_ENV || 'test').trim().toLowerCase();
  return raw === 'prod' || raw === 'live' || raw === 'production' ? 'prod' : 'test';
};

const getHost = () => (getEnv() === 'test' ? 'apitest.cybersource.com' : 'api.cybersource.com');

/**
 * Build an RFC 7231 HTTP date string, e.g. "Thu, 18 Jul 2024 00:18:03 GMT"
 */
const buildHttpDate = () => new Date().toUTCString();

/**
 * SHA-256 digest of a body string, formatted per CyberSource spec:
 *   "SHA-256=<base64>"
 */
const buildDigest = (bodyString) => {
  const hash = crypto.createHash('sha256').update(bodyString || '', 'utf8').digest('base64');
  return `SHA-256=${hash}`;
};

/**
 * HMAC-SHA256 sign the signature string using a base64-decoded shared secret.
 * Returns the base64-encoded HMAC result.
 */
const hmacSign = (signatureString, sharedSecretBase64) => {
  const keyBuffer = Buffer.from(String(sharedSecretBase64 || ''), 'base64');
  return crypto.createHmac('sha256', keyBuffer).update(signatureString, 'utf8').digest('base64');
};

/**
 * Build the HTTP Signature header for a given request.
 * Returns { headers } -> an object of headers to send on the request.
 */
const buildSignedHeaders = ({ method, path, body, host, merchantId, keyId, sharedSecret }) => {
  const httpDate = buildHttpDate();
  const isPost = String(method || '').toUpperCase() === 'POST';
  const bodyString = isPost ? (typeof body === 'string' ? body : JSON.stringify(body || {})) : '';
  const digest = isPost ? buildDigest(bodyString) : null;
  const requestTarget = `${String(method).toLowerCase()} ${path}`;

  const headerFieldsList = isPost
    ? ['host', 'date', '(request-target)', 'digest', 'v-c-merchant-id']
    : ['host', 'date', '(request-target)', 'v-c-merchant-id'];

  const signatureLines = headerFieldsList.map((field) => {
    switch (field) {
      case 'host':
        return `host: ${host}`;
      case 'date':
        return `date: ${httpDate}`;
      case '(request-target)':
        return `(request-target): ${requestTarget}`;
      case 'digest':
        return `digest: ${digest}`;
      case 'v-c-merchant-id':
        return `v-c-merchant-id: ${merchantId}`;
      default:
        return '';
    }
  });
  const signatureString = signatureLines.join('\n');
  const signatureValue = hmacSign(signatureString, sharedSecret);

  const signatureHeader = [
    `keyid="${keyId}"`,
    'algorithm="HmacSHA256"',
    `headers="${headerFieldsList.join(' ')}"`,
    `signature="${signatureValue}"`
  ].join(', ');

  const headers = {
    'v-c-merchant-id': merchantId,
    Date: httpDate,
    Host: host,
    Signature: signatureHeader,
    Accept: 'application/json'
  };

  if (isPost) {
    headers['Content-Type'] = 'application/json';
    headers.Digest = digest;
  }

  return { headers, bodyString };
};

/**
 * Perform the HTTPS request using the built-in https module.
 */
const httpsRequest = ({ host, method, path, headers, body }) => new Promise((resolve, reject) => {
  const options = {
    host,
    port: 443,
    method,
    path,
    headers: { ...headers }
  };

  if (body) {
    options.headers['Content-Length'] = Buffer.byteLength(body, 'utf8');
  }

  const req = https.request(options, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve({
        status: res.statusCode,
        headers: res.headers,
        raw
      });
    });
  });

  req.on('error', (err) => reject(err));

  if (body) {
    req.write(body, 'utf8');
  }
  req.end();
});

/**
 * Validate required environment configuration for REST calls.
 */
const validateRestConfig = () => {
  const keyId = getRestKeyId();
  const sharedSecret = getRestSharedSecret();
  const merchantId = getMerchantId();
  const missing = [];
  if (!keyId) missing.push('CYBERSOURCE_REST_KEY_ID');
  if (!sharedSecret) missing.push('CYBERSOURCE_REST_SHARED_SECRET');
  if (!merchantId) missing.push('CAPITAL_BANK_MERCHANT_ID (or CYBERSOURCE_MERCHANT_ID)');
  return { ok: missing.length === 0, missing, keyId, sharedSecret, merchantId };
};

/**
 * Low-level helper to call any CyberSource REST API endpoint with HTTP
 * Signature authentication.
 *
 * @param {string} method - 'GET' or 'POST'
 * @param {string} path   - path starting with '/', e.g. '/microform/v2/sessions'
 * @param {object|null} body - JSON body for POST, null/undefined for GET
 * @returns {Promise<{ok: boolean, status: number, data: object|string, error?: string}>}
 */
const cybersourceRestCall = async (method, path, body = null) => {
  const httpMethod = String(method || 'GET').toUpperCase();
  if (!path || typeof path !== 'string' || !path.startsWith('/')) {
    return { ok: false, status: 0, data: null, error: 'path must start with "/"' };
  }

  const cfg = validateRestConfig();
  if (!cfg.ok) {
    console.error(`${LOG_PREFIX} Missing environment variables:`, cfg.missing);
    return {
      ok: false,
      status: 0,
      data: null,
      error: `Missing required env vars: ${cfg.missing.join(', ')}`
    };
  }

  const host = getHost();
  const { headers, bodyString } = buildSignedHeaders({
    method: httpMethod,
    path,
    body,
    host,
    merchantId: cfg.merchantId,
    keyId: cfg.keyId,
    sharedSecret: cfg.sharedSecret
  });

  try {
    console.info(`${LOG_PREFIX} Request`, {
      host,
      method: httpMethod,
      path,
      body_length: bodyString ? Buffer.byteLength(bodyString, 'utf8') : 0
    });

    const response = await httpsRequest({
      host,
      method: httpMethod,
      path,
      headers,
      body: httpMethod === 'POST' ? bodyString : null
    });

    let parsed = null;
    const rawString = response.raw || '';
    if (rawString) {
      try {
        parsed = JSON.parse(rawString);
      } catch (_parseErr) {
        parsed = rawString;
      }
    }

    const ok = response.status >= 200 && response.status < 300;
    if (!ok) {
      console.error(`${LOG_PREFIX} Response error`, {
        method: httpMethod,
        path,
        status: response.status,
        body_preview: typeof parsed === 'string' ? parsed.slice(0, 500) : parsed
      });
    } else {
      console.info(`${LOG_PREFIX} Response ok`, {
        method: httpMethod,
        path,
        status: response.status
      });
    }

    return { ok, status: response.status, data: parsed };
  } catch (error) {
    console.error(`${LOG_PREFIX} Transport error`, {
      method: httpMethod,
      path,
      error: error?.message
    });
    return { ok: false, status: 0, data: null, error: error?.message || 'transport_error' };
  }
};

/**
 * Normalize a numeric amount to a "10.00" style string.
 */
const formatAmount = (amount) => {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('amount must be a positive number');
  }
  return n.toFixed(2);
};

/**
 * Normalize a target origin to just its scheme://host[:port] form.
 */
const normalizeTargetOrigin = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    return u.origin;
  } catch (_err) {
    return '';
  }
};

/**
 * Create a Unified Checkout capture context (Sessions API).
 *
 * The response body is a signed JWT string that the frontend JS SDK consumes
 * via `Accept.checkout(captureContext)`.
 *
 * @param {object} options
 * @param {number|string} options.amount        - e.g. 10 or "10.00"
 * @param {string} [options.currency='JOD']
 * @param {string} [options.locale='ar-xn']
 * @param {string} [options.targetOrigin]       - e.g. "https://peekaboojor.com"
 *                                                (falls back to FRONTEND_URL env or "https://peekaboojor.com")
 * @returns {Promise<{ok: boolean, captureContext?: string, status?: number, error?: string, details?: object}>}
 */
const createCaptureContext = async ({ amount, currency = 'JOD', locale = 'ar-xn', targetOrigin } = {}) => {
  let totalAmount;
  try {
    totalAmount = formatAmount(amount);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const normalizedOrigin = normalizeTargetOrigin(targetOrigin)
    || normalizeTargetOrigin(process.env.FRONTEND_URL)
    || 'https://peekaboojor.com';

  const body = {
    targetOrigins: [normalizedOrigin],
    clientVersion: '0.23',
    allowedCardNetworks: ['VISA', 'MASTERCARD'],
    allowedPaymentTypes: ['PANENTRY'],
    country: 'JO',
    locale: String(locale || 'ar-xn'),
    captureMandate: {
      billingType: 'FULL',
      requestEmail: false,
      requestPhone: false,
      requestShipping: false,
      showAcceptedNetworkIcons: true
    },
    orderInformation: {
      amountDetails: {
        totalAmount,
        currency: String(currency || 'JOD').toUpperCase()
      }
    }
  };

  const result = await cybersourceRestCall('POST', '/microform/v2/sessions', body);

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error || 'sessions_api_failed',
      details: result.data || null
    };
  }

  // CyberSource returns the capture context as a signed JWT.
  // Newer responses may return it as the raw response body (string).
  // Older responses return { keyId } or { captureContext } wrappers.
  let captureContext = '';
  if (typeof result.data === 'string') {
    captureContext = result.data.trim();
  } else if (result.data && typeof result.data === 'object') {
    captureContext = String(
      result.data.captureContext
      || result.data.jwt
      || result.data.keyId
      || ''
    ).trim();
  }

  if (!captureContext) {
    return {
      ok: false,
      status: result.status,
      error: 'capture_context_missing_in_response',
      details: result.data
    };
  }

  return { ok: true, status: result.status, captureContext };
};

/**
 * Authorize (with capture) a payment using a Unified Checkout transient token.
 *
 * @param {object} options
 * @param {string} options.transientToken   - JWT transient token returned by the frontend SDK
 * @param {number|string} options.amount    - e.g. 10 or "10.00"
 * @param {string} [options.currency='JOD']
 * @param {string} [options.referenceNumber] - Merchant reference (session_id etc.)
 * @returns {Promise<{ok: boolean, data?: object, status?: number, error?: string}>}
 */
const authorizePayment = async ({
  transientToken,
  amount,
  currency = 'JOD',
  referenceNumber
} = {}) => {
  const token = String(transientToken || '').trim();
  if (!token) {
    return { ok: false, error: 'transientToken is required' };
  }

  let totalAmount;
  try {
    totalAmount = formatAmount(amount);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const body = {
    tokenInformation: {
      transientTokenJwt: token
    },
    orderInformation: {
      amountDetails: {
        totalAmount,
        currency: String(currency || 'JOD').toUpperCase()
      }
    },
    processingInformation: {
      capture: true
    }
  };

  if (referenceNumber) {
    body.clientReferenceInformation = {
      code: String(referenceNumber)
    };
  }

  const result = await cybersourceRestCall('POST', '/pts/v2/payments', body);

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error || 'payments_api_failed',
      data: result.data || null
    };
  }

  return { ok: true, status: result.status, data: result.data || {} };
};

module.exports = {
  cybersourceRestCall,
  createCaptureContext,
  authorizePayment,
  // Exposed for diagnostics / testing:
  _internal: {
    buildSignedHeaders,
    buildDigest,
    hmacSign,
    buildHttpDate,
    getHost,
    getEnv,
    validateRestConfig
  }
};
