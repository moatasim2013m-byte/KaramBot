const crypto = require('crypto');

const SECURE_ACCEPTANCE_DEFAULT_ENDPOINT = 'https://testsecureacceptance.cybersource.com/pay';

const getSecureAcceptanceUrl = () => {
  return String(process.env.CAPITAL_BANK_SECURE_ACCEPTANCE_URL || SECURE_ACCEPTANCE_DEFAULT_ENDPOINT).trim();
};

const toCybersourceDateTime = (date = new Date()) => {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');
};

const sign = (data, secretKey) => {
  return crypto
    .createHmac('sha256', secretKey)
    .update(data, 'utf8')
    .digest('base64');
};

const buildDataToSign = (fields) => {
  const signedFieldNames = String(fields.signed_field_names || '')
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);

  return signedFieldNames
    .map((field) => `${field}=${fields[field] || ''}`)
    .join(',');
};

const buildSecureAcceptanceFields = ({
  profileId,
  accessKey,
  secretKey,
  transactionUuid,
  referenceNumber,
  amount,
  returnUrl,
  cancelUrl,
  locale = 'ar-xn'
}) => {
  const signedDateTime = toCybersourceDateTime();
  const fields = {
    access_key: String(accessKey),
    profile_id: String(profileId),
    transaction_uuid: String(transactionUuid),
    signed_field_names: 'access_key,profile_id,transaction_uuid,signed_field_names,signed_date_time,locale,transaction_type,reference_number,amount,currency,override_custom_receipt_page,override_custom_cancel_page',
    signed_date_time: signedDateTime,
    locale: String(locale || 'ar-xn'),
    transaction_type: 'sale',
    reference_number: String(referenceNumber),
    amount: Number(amount).toFixed(2),
    currency: 'JOD',
    override_custom_receipt_page: String(returnUrl),
    override_custom_cancel_page: String(cancelUrl)
  };

  fields.signature = sign(buildDataToSign(fields), secretKey);
  return fields;
};

module.exports = {
  buildSecureAcceptanceFields,
  getSecureAcceptanceUrl
};
