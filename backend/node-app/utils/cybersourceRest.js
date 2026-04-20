const crypto = require('crypto');

const CYBERSOURCE_SECURE_ACCEPTANCE_TEST_URL = 'https://testsecureacceptance.cybersource.com/pay';
const CYBERSOURCE_SECURE_ACCEPTANCE_LIVE_URL = 'https://secureacceptance.cybersource.com/pay';
const SECURE_ACCEPTANCE_RESPONSE_SIGNED_FIELDS = 'signed_field_names,signature';
const REQUIRED_SIGNED_FIELDS = [
  'merchant_id',
  'access_key',
  'profile_id',
  'transaction_uuid',
  'signed_field_names',
  'signed_date_time',
  'transaction_type',
  'reference_number',
  'amount',
  'currency',
  'locale',
  'bill_to_forename',
  'bill_to_surname',
  'bill_to_email',
  'bill_to_address_country',
  'bill_to_address_city',
  'bill_to_address_line1',
  'payment_method'
];
const CYBERSOURCE_HOSTS = {
  test: 'testsecureacceptance.cybersource.com',
  prod: 'secureacceptance.cybersource.com'
};


const CYBERSOURCE_SUPPORTED_LOCALES = new Set([
  'en-us',
  'en-gb',
  'fr-fr',
  'de-de',
  'it-it',
  'es-es',
  'pt-br',
  'ja-jp',
  'zh-cn',
  'zh-tw',
  'ar-xn'
]);

const normalizeCyberSourceLocale = (locale) => {
  const normalized = String(locale || '').trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return 'en-us';
  if (normalized === 'ar') return 'ar-xn';
  return CYBERSOURCE_SUPPORTED_LOCALES.has(normalized) ? normalized : 'en-us';
};

const getCapitalBankEnv = () => {
  const configuredEnv = String(
    process.env.CAPITAL_BANK_ENV
    || process.env.CYBERSOURCE_ENV
    || 'prod'
  ).trim().toLowerCase();

  return configuredEnv === 'test' ? 'test' : 'prod';
};

const CYBERSOURCE_PAY_PATH = '/pay';

const normalizeConfiguredPaymentEndpoint = (endpoint) => {
  const normalized = String(endpoint || '').trim();
  if (!normalized) return '';

  try {
    const parsedUrl = new URL(normalized);
    if (parsedUrl.pathname === '/' || !parsedUrl.pathname) {
      parsedUrl.pathname = CYBERSOURCE_PAY_PATH;
      return parsedUrl.toString();
    }
    return parsedUrl.toString();
  } catch (error) {
    return normalized;
  }
};

const getConfiguredPaymentEndpoint = () => normalizeConfiguredPaymentEndpoint(
  process.env.CAPITAL_BANK_PAYMENT_ENDPOINT
  || process.env.CAPITAL_BANK_ENDPOINT
  || ''
);

const getCyberSourceBaseUrl = () => {
  const configuredEndpoint = getConfiguredPaymentEndpoint();
  if (configuredEndpoint) return configuredEndpoint;

  return getCapitalBankEnv() === 'test'
    ? CYBERSOURCE_SECURE_ACCEPTANCE_TEST_URL
    : CYBERSOURCE_SECURE_ACCEPTANCE_LIVE_URL;
};

const getCyberSourcePaymentUrl = () => {
  const configuredEndpoint = getConfiguredPaymentEndpoint();
  if (configuredEndpoint) return configuredEndpoint;

  return getCapitalBankEnv() === 'test'
    ? CYBERSOURCE_SECURE_ACCEPTANCE_TEST_URL
    : CYBERSOURCE_SECURE_ACCEPTANCE_LIVE_URL;
};

const sanitizeKeyPreview = (value = '', visibleTail = 4) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  const suffix = normalized.slice(-visibleTail);
  return `${'*'.repeat(Math.max(normalized.length - visibleTail, 0))}${suffix}`;
};

const SENSITIVE_SIGNED_FIELDS = new Set([
  'access_key',
  'signature',
  'bill_to_email',
  'bill_to_forename',
  'bill_to_surname',
  'bill_to_address_line1'
]);

const sanitizeDataToSignPreview = (dataToSign, maxLength = 280) => String(dataToSign || '')
  .split(',')
  .map((segment) => {
    const [fieldName, ...rest] = segment.split('=');
    const normalizedFieldName = String(fieldName || '').trim();
    if (!normalizedFieldName) return segment;
    if (!SENSITIVE_SIGNED_FIELDS.has(normalizedFieldName)) return segment;
    return `${normalizedFieldName}=[REDACTED]`;
  })
  .join(',')
  .slice(0, maxLength);

const validateSecureAcceptanceConfig = ({ merchantId, profileId, accessKey, secretKey, env, endpoint }) => {
  const normalizedEnv = String(env || getCapitalBankEnv()).trim().toLowerCase() === 'test' ? 'test' : 'prod';
  const normalizedEndpoint = String(endpoint || getCyberSourcePaymentUrl()).trim();
  const missing = [
    ['CAPITAL_BANK_MERCHANT_ID', merchantId],
    ['CAPITAL_BANK_PROFILE_ID', profileId],
    ['CAPITAL_BANK_ACCESS_KEY', accessKey],
    ['CAPITAL_BANK_SECRET_KEY', secretKey],
    ['CAPITAL_BANK_ENV', normalizedEnv]
  ].filter(([, value]) => !String(value || '').trim()).map(([name]) => name);

  const details = {
    env: normalizedEnv,
    endpoint: normalizedEndpoint,
    merchant_id_present: Boolean(String(merchantId || '').trim()),
    profile_id_present: Boolean(String(profileId || '').trim()),
    access_key_present: Boolean(String(accessKey || '').trim()),
    secret_key_present: Boolean(String(secretKey || '').trim()),
    merchant_id_preview: sanitizeKeyPreview(merchantId),
    profile_id_preview: sanitizeKeyPreview(profileId),
    access_key_preview: sanitizeKeyPreview(accessKey),
    missing
  };

  if (missing.length) {
    return { ok: false, code: 'CAPITAL_BANK_CONFIG_INVALID', reason: 'missing_required_env', details };
  }

  try {
    const parsed = new URL(normalizedEndpoint);
    const host = parsed.host.toLowerCase();
    const pathname = parsed.pathname;
    const isCybersourceHost = Object.values(CYBERSOURCE_HOSTS).includes(host);
    details.endpoint_host = host;
    details.endpoint_path = pathname;
    details.is_cybersource_host = isCybersourceHost;

    if (isCybersourceHost) {
      const expectedHost = CYBERSOURCE_HOSTS[normalizedEnv];
      if (host !== expectedHost) {
        details.expected_host = expectedHost;
        return { ok: false, code: 'CAPITAL_BANK_ENV_HOST_MISMATCH', reason: 'env_host_mismatch', details };
      }
      if (pathname !== CYBERSOURCE_PAY_PATH) {
        details.expected_path = CYBERSOURCE_PAY_PATH;
        return { ok: false, code: 'CAPITAL_BANK_ENDPOINT_INVALID', reason: 'invalid_pay_path', details };
      }
    }
  } catch (_error) {
    return { ok: false, code: 'CAPITAL_BANK_ENDPOINT_INVALID', reason: 'invalid_endpoint_url', details };
  }

  return { ok: true, code: null, reason: null, details };
};

const validateSecureAcceptanceFields = (fields = {}) => {
  const requiredFields = ['transaction_type', 'reference_number', 'amount', 'currency', 'locale', 'signature', 'signed_field_names'];
  const missingFields = requiredFields.filter((fieldName) => !String(fields[fieldName] || '').trim());
  const signedFieldNames = String(fields.signed_field_names || '').split(',').map((name) => name.trim()).filter(Boolean);
  const missingSignedFields = REQUIRED_SIGNED_FIELDS.filter((fieldName) => !signedFieldNames.includes(fieldName));
  const expectedRequiredOrder = REQUIRED_SIGNED_FIELDS.join(',');
  const actualRequiredOrder = signedFieldNames
    .filter((fieldName) => REQUIRED_SIGNED_FIELDS.includes(fieldName))
    .join(',');
  const hasRequiredOrderMismatch = actualRequiredOrder !== expectedRequiredOrder;
  const hasUnsignedFieldNames = Object.prototype.hasOwnProperty.call(fields, 'unsigned_field_names');
  const payloadFields = Object.keys(fields).filter((fieldName) => fieldName !== 'signature');
  const unsignedPayloadFields = payloadFields.filter((fieldName) => !signedFieldNames.includes(fieldName));
  const details = {
    missing_fields: missingFields,
    missing_signed_fields: missingSignedFields,
    signed_field_count: signedFieldNames.length,
    expected_required_signed_field_order: expectedRequiredOrder,
    actual_required_signed_field_order: actualRequiredOrder,
    has_unsigned_field_names: hasUnsignedFieldNames,
    unsigned_payload_fields: unsignedPayloadFields
  };

  if (missingFields.length || missingSignedFields.length || hasRequiredOrderMismatch || hasUnsignedFieldNames || unsignedPayloadFields.length) {
    return {
      ok: false,
      code: 'CAPITAL_BANK_SIGNATURE_INVALID',
      reason: hasRequiredOrderMismatch ? 'signed_field_order_mismatch' : 'missing_signed_payload_fields',
      details
    };
  }

  return { ok: true, code: null, reason: null, details };
};

let hasLoggedCapitalBankEndpoint = false;
const logCapitalBankEndpointSelection = () => {
  if (hasLoggedCapitalBankEndpoint) return;
  hasLoggedCapitalBankEndpoint = true;
  const capitalBankEnv = getCapitalBankEnv() === 'test' ? 'TEST' : 'PROD';
  console.log(`[Capital Bank] Environment: ${capitalBankEnv}`);
  console.log(`[Capital Bank] Endpoint: ${getCyberSourcePaymentUrl()}`);
};

logCapitalBankEndpointSelection();

const toCyberSourceIsoDate = (date = new Date()) => (
  new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z')
);

const generateTransactionUuid = () => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
};

const isLikelyBase64 = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return false;
  if (/^[0-9a-fA-F]+$/.test(normalized)) return false;
  return true;
};

const getSecretKeyEncoding = () => String(
  process.env.CAPITAL_BANK_SECRET_KEY_ENCODING
  || process.env.CAPITAL_BANK_SECRET_KEY_ENCODE
  || 'auto'
).trim().toLowerCase();

const decodeBase64Key = (value) => Buffer.from(value, 'base64');
const decodeHexKey = (value) => Buffer.from(value, 'hex');
const decodeUtf8Key = (value) => Buffer.from(value, 'utf8');

const isBase64WithStrongSignal = (value) => {
  const normalized = String(value || '').trim();
  if (!isLikelyBase64(normalized)) return false;
  return /[+/=]/.test(normalized);
};

const detectSecretKeyEncoding = (secretKey, requestedEncoding) => {
  const key = String(secretKey || '').trim();
  if (!key) {
    return { ok: false, error: 'CAPITAL_BANK_SECRET_KEY is required', code: 'CAPITAL_BANK_SECRET_KEY_MISSING' };
  }
  if (requestedEncoding === 'hex') {
    if (!/^[0-9a-fA-F]+$/.test(key) || key.length % 2 !== 0) {
      return { ok: false, error: 'Secret key is not valid hex', code: 'CAPITAL_BANK_SECRET_ENCODING_INVALID' };
    }
    return { ok: true, buffer: Buffer.from(key, 'hex') };
  }
  if (requestedEncoding === 'base64') {
    return { ok: true, buffer: Buffer.from(key, 'base64') };
  }
  if (requestedEncoding === 'utf8' || requestedEncoding === 'plain' || requestedEncoding === 'text') {
    return { ok: true, buffer: Buffer.from(key, 'utf8') };
  }
  if (requestedEncoding !== 'auto') {
    return { ok: false, error: 'CAPITAL_BANK_SECRET_KEY_ENCODING must be: auto, base64, hex, or utf8', code: 'CAPITAL_BANK_SECRET_ENCODING_INVALID' };
  }
  const isHex = /^[0-9a-fA-F]+$/.test(key) && key.length % 2 === 0;
  if (isHex) return { ok: true, buffer: Buffer.from(key, 'hex') };
  if (isBase64WithStrongSignal(key)) return { ok: true, buffer: Buffer.from(key, 'base64') };
  return { ok: true, buffer: Buffer.from(key, 'utf8') };
};

const decodeSecretKey = (secretKey) => {
  const resolved = detectSecretKeyEncoding(secretKey, getSecretKeyEncoding());
  if (!resolved.ok) {
    const error = new Error(resolved.error || 'Invalid Capital Bank secret key configuration');
    error.code = resolved.code || 'CAPITAL_BANK_SECRET_ENCODING_INVALID';
    error.details = resolved.details;
    throw error;
  }
  return resolved.buffer;
};

const signFields = (fieldValues, secretKey) => {
  const signedFieldNames = String(fieldValues?.signed_field_names || '')
    .split(',')
    .map((fieldName) => fieldName.trim())
    .filter(Boolean);

  if (!signedFieldNames.length) {
    throw new Error('signed_field_names is required for Secure Acceptance signatures');
  }

  const dataToSign = signedFieldNames
    .map((fieldName) => `${fieldName}=${fieldValues[fieldName] ?? ''}`)
    .join(',');

  const decodedSecretKey = decodeSecretKey(secretKey);
  const signature = crypto
    .createHmac('sha256', decodedSecretKey)
    .update(dataToSign, 'utf8')
    .digest('base64');

  return {
    signature,
    dataToSign,
    signedFieldNames
  };
};

const buildSecureAcceptanceFields = ({
  merchantId,
  profileId,
  accessKey,
  secretKey,
  transactionUuid,
  referenceNumber,
  amount,
  locale = 'en-us',
  transactionType = 'sale',
  currency = 'JOD',
  billToForename = 'Customer',
  billToSurname = 'Customer',
  billToEmail = 'customer@example.com',
  billToAddressLine1 = 'Amman',
  billToAddressCity = 'Amman',
  billToAddressCountry = 'JO',
  overrideCustomReceiptPage,
  overrideCustomCancelPage
}) => {
  if (!merchantId) throw new Error('CAPITAL_BANK_MERCHANT_ID is required');
  if (!profileId) throw new Error('CAPITAL_BANK_PROFILE_ID is required');
  if (!accessKey) throw new Error('CAPITAL_BANK_ACCESS_KEY is required');
  if (!secretKey) throw new Error('CAPITAL_BANK_SECRET_KEY is required');

  const normalizedAmount = Number(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error('Payment amount must be a positive number');
  }

  const signedFieldNames = [
    ...REQUIRED_SIGNED_FIELDS,
    ...(overrideCustomReceiptPage ? ['override_custom_receipt_page'] : []),
    ...(overrideCustomCancelPage ? ['override_custom_cancel_page'] : [])
  ].join(',');

  const fields = {
    merchant_id: String(merchantId),
    access_key: String(accessKey),
    profile_id: String(profileId),
    transaction_uuid: String(transactionUuid),
    signed_field_names: signedFieldNames,
    signed_date_time: toCyberSourceIsoDate(),
    locale: normalizeCyberSourceLocale(locale),
    transaction_type: String(transactionType || 'sale').toLowerCase(),
    reference_number: String(referenceNumber),
    amount: normalizedAmount.toFixed(2),
    currency: String(currency || 'JOD').toUpperCase(),
    payment_method: 'card',
    bill_to_forename: String(billToForename || 'Customer'),
    bill_to_surname: String(billToSurname || 'Customer'),
    bill_to_email: String(billToEmail || 'customer@example.com'),
    bill_to_address_line1: String(billToAddressLine1 || 'Amman'),
    bill_to_address_city: String(billToAddressCity || 'Amman'),
    bill_to_address_country: String(billToAddressCountry || 'JO').toUpperCase(),
    ...(overrideCustomReceiptPage ? { override_custom_receipt_page: String(overrideCustomReceiptPage) } : {}),
    ...(overrideCustomCancelPage ? { override_custom_cancel_page: String(overrideCustomCancelPage) } : {})
  };

  const requiredFields = [
    'access_key',
    'profile_id',
    'transaction_uuid',
    'signed_field_names',
    'signed_date_time',
    'transaction_type',
    'reference_number',
    'amount',
    'currency',
    'locale',
    'bill_to_forename',
    'bill_to_surname',
    'bill_to_email',
    'bill_to_address_country',
    'bill_to_address_city',
    'bill_to_address_line1'
  ];
  const missingFields = requiredFields.filter((fieldName) => !String(fields[fieldName] || '').trim());
  const allFieldNames = Object.keys(fields);
  const unsignedSentFields = allFieldNames.filter((fieldName) => !signedFieldNames.split(',').includes(fieldName));
  const fieldsMissingFromPayload = signedFieldNames
    .split(',')
    .filter((fieldName) => !allFieldNames.includes(fieldName));
  if (missingFields.length > 0) {
    console.error('[CyberSource Secure Acceptance] Missing fields in signed payload', {
      missing_fields: missingFields,
      reference_number: fields.reference_number,
      transaction_uuid: fields.transaction_uuid
    });
    throw new Error(`Missing required Secure Acceptance fields: ${missingFields.join(', ')}`);
  }
  if (unsignedSentFields.length > 0 || fieldsMissingFromPayload.length > 0) {
    throw new Error(
      `Signed field set mismatch. Unsigned sent fields: ${unsignedSentFields.join(', ') || 'none'}. Missing payload fields: ${fieldsMissingFromPayload.join(', ') || 'none'}.`
    );
  }

  const { signature, dataToSign, signedFieldNames: parsedSignedFields } = signFields(fields, secretKey);
  fields.signature = signature;

  console.info('[CyberSource Secure Acceptance] Signed request fields generated', {
    reference_number: fields.reference_number,
    transaction_uuid: fields.transaction_uuid,
    merchant_id: fields.merchant_id,
    profile_id: fields.profile_id,
    signed_field_count: parsedSignedFields.length,
    signed_fields: parsedSignedFields,
    signed_date_time: fields.signed_date_time,
    has_required_signature_inputs: {
      merchant_id: Boolean(fields.merchant_id),
      profile_id: Boolean(fields.profile_id),
      access_key: Boolean(fields.access_key),
      transaction_uuid: Boolean(fields.transaction_uuid)
    },
    data_to_sign_preview: sanitizeDataToSignPreview(dataToSign)
  });

  return fields;
};

const verifySecureAcceptanceSignature = (payload, secretKey) => {
  if (!payload || typeof payload !== 'object') {
    return { isValid: false, reason: 'invalid_payload' };
  }

  const providedSignature = String(payload.signature || '').trim();
  const signedFieldNames = String(payload.signed_field_names || '').trim();
  if (!providedSignature || !signedFieldNames) {
    return { isValid: false, reason: 'missing_signature_fields' };
  }

  const { signature: computedSignature, dataToSign, signedFieldNames: parsedSignedFields } = signFields(payload, secretKey);
  const providedBuffer = Buffer.from(providedSignature, 'utf8');
  const computedBuffer = Buffer.from(computedSignature, 'utf8');
  const isValid = providedBuffer.length === computedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, computedBuffer);

  return {
    isValid,
    reason: isValid ? null : 'signature_mismatch',
    computedSignature,
    providedSignature,
    dataToSign,
    dataToSignPreview: sanitizeDataToSignPreview(dataToSign, 200),
    signedFieldNames: parsedSignedFields
  };
};

module.exports = {
  CYBERSOURCE_SECURE_ACCEPTANCE_TEST_URL,
  CYBERSOURCE_SECURE_ACCEPTANCE_LIVE_URL,
  SECURE_ACCEPTANCE_RESPONSE_SIGNED_FIELDS,
  buildSecureAcceptanceFields,
  getCapitalBankEnv,
  getCyberSourceBaseUrl,
  getCyberSourcePaymentUrl,
  generateTransactionUuid,
  REQUIRED_SIGNED_FIELDS,
  signFields,
  toCyberSourceIsoDate,
  validateSecureAcceptanceConfig,
  validateSecureAcceptanceFields,
  verifySecureAcceptanceSignature
};
