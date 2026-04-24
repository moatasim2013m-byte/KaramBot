const {
  buildSecureAcceptanceFields,
  getCyberSourcePaymentUrl,
  validateSecureAcceptanceConfig,
  validateSecureAcceptanceFields
} = require('../utils/cybersourceRest');

const runScenario = (name, input) => {
  const configResult = validateSecureAcceptanceConfig(input);
  const result = {
    name,
    configOk: configResult.ok,
    configCode: configResult.code || null,
    details: configResult.details
  };

  if (configResult.ok) {
    const payload = buildSecureAcceptanceFields({
      merchantId: input.merchantId,
      profileId: input.profileId,
      accessKey: input.accessKey,
      secretKey: input.secretKey,
      transactionUuid: '123e4567-e89b-12d3-a456-426614174000',
      referenceNumber: 'order-12345',
      amount: 10.5,
      locale: 'ar-xn',
      transactionType: 'sale',
      currency: 'JOD',
      billToForename: 'Test',
      billToSurname: 'User',
      billToEmail: 'test@example.com',
      billToAddressLine1: 'Amman',
      billToAddressCity: 'Amman',
      billToAddressCountry: 'JO',
      overrideCustomReceiptPage: input.overrideCustomReceiptPage,
      overrideCustomCancelPage: input.overrideCustomCancelPage
    });

    const fieldsResult = validateSecureAcceptanceFields(payload);
    result.fieldsOk = fieldsResult.ok;
    result.fieldsCode = fieldsResult.code || null;
    result.fieldsReason = fieldsResult.reason || null;
    result.fieldsDetails = fieldsResult.details || null;
    result.url = input.endpoint || getCyberSourcePaymentUrl();
    result.pathOk = String(result.url).includes('/pay');
    result.payloadUnsignedFieldNames = payload.unsigned_field_names || null;
  }

  return result;
};

const sharedCreds = {
  merchantId: 'testmerchant1234',
  profileId: 'testprofile1234',
  accessKey: 'ABCD1234ACCESS',
  secretKey: '00112233445566778899aabbccddeeff'
};

const scenarios = [
  {
    name: 'env=test + live host => reject mismatch',
    input: {
      ...sharedCreds,
      env: 'test',
      endpoint: 'https://secureacceptance.cybersource.com/pay'
    },
    expect: { configOk: false, configCode: 'CAPITAL_BANK_ENV_HOST_MISMATCH' }
  },
  {
    name: 'env=prod + test host => reject mismatch',
    input: {
      ...sharedCreds,
      env: 'prod',
      endpoint: 'https://testsecureacceptance.cybersource.com/pay'
    },
    expect: { configOk: false, configCode: 'CAPITAL_BANK_ENV_HOST_MISMATCH' }
  },
  {
    name: 'missing profile/access/secret => config invalid',
    input: {
      merchantId: 'merchantOnly',
      profileId: '',
      accessKey: '',
      secretKey: '',
      env: 'test',
      endpoint: 'https://testsecureacceptance.cybersource.com/pay'
    },
    expect: { configOk: false, configCode: 'CAPITAL_BANK_CONFIG_INVALID' }
  },
  {
    name: 'valid config => /pay URL + signed fields',
    input: {
      ...sharedCreds,
      env: 'test',
      endpoint: 'https://testsecureacceptance.cybersource.com/pay'
    },
    expect: { configOk: true, fieldsOk: true, pathOk: true }
  },
  {
    name: 'valid config WITH override_custom_receipt/cancel_page => must NOT reject as unsigned',
    input: {
      ...sharedCreds,
      env: 'test',
      endpoint: 'https://testsecureacceptance.cybersource.com/pay',
      overrideCustomReceiptPage: 'https://peekaboojor.com/api/payments/capital-bank/return',
      overrideCustomCancelPage: 'https://peekaboojor.com/payment/cancel'
    },
    expect: { configOk: true, fieldsOk: true, pathOk: true }
  }
];

let failures = 0;
const report = scenarios.map((scenario) => {
  const outcome = runScenario(scenario.name, scenario.input);
  const expected = scenario.expect;

  Object.entries(expected).forEach(([key, expectedValue]) => {
    if (outcome[key] !== expectedValue) {
      failures += 1;
      outcome[`expected_${key}`] = expectedValue;
    }
  });

  return outcome;
});

console.log(JSON.stringify({ failures, report }, null, 2));
if (failures > 0) process.exit(1);
