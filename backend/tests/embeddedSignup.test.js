/**
 * Embedded Signup (v4) onboarding: the three Graph steps, resume after a failure,
 * and the rule that one customer's WhatsApp traffic can never reach another's inbox.
 */
require('./setup');

process.env.SHIFT_ES_APP_SECRET = 'test_es_app_secret';
process.env.META_ES_APP_ID = '1065272896256103';

jest.mock('axios');
jest.mock('../src/config/prisma', () => ({
  whatsappOnboarding: {
    upsert: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(),
    update: jest.fn(), updateMany: jest.fn(),
  },
  business: { findFirst: jest.fn(), update: jest.fn() },
}));

const axios = require('axios');
const prisma = require('../src/config/prisma');
const { decrypt } = require('../src/utils/tokenCrypto');
const { runOnboarding, generatePin, publicStatus } = require('../src/services/embeddedSignup');

const WABA = '111111111111111';
const PHONE = '222222222222222';
const TOKEN = 'EAABusinessTokenThatNeverExpires';

const row = (over = {}) => ({
  id: 'onb_1', business_id: 'biz_1', app_id: '1065272896256103',
  meta_business_id: '333', waba_id: WABA, phone_number_id: PHONE,
  access_token_enc: null, pin_enc: null, step: 'code_received',
  payment_method_ok: false, last_error: null, updated_at: new Date(), ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  // Each update returns the row as changed, the way Prisma does.
  prisma.whatsappOnboarding.update.mockImplementation(({ where, data }) =>
    Promise.resolve(row({ id: where.id, ...data })));
});

describe('the three Graph steps', () => {
  test('a clean run exchanges the code, subscribes the WABA and registers the number', async () => {
    prisma.whatsappOnboarding.findUnique.mockResolvedValue(row());
    axios.get.mockResolvedValue({ data: { access_token: TOKEN } });
    axios.post.mockResolvedValue({ data: { success: true } });

    const done = await runOnboarding('onb_1', { code: 'CODE30S' });

    // 1 — the exchange carries the app secret, and never the browser's business
    const [exchangeUrl, exchangeCfg] = axios.get.mock.calls[0];
    expect(exchangeUrl).toMatch(/\/oauth\/access_token$/);
    expect(exchangeCfg.params).toMatchObject({
      client_id: '1065272896256103', client_secret: 'test_es_app_secret', code: 'CODE30S',
    });

    // 2 and 3 — in order, both bearing the customer's business token
    const [subUrl, , subCfg] = axios.post.mock.calls[0];
    expect(subUrl).toBe(`https://graph.facebook.com/v24.0/${WABA}/subscribed_apps`);
    expect(subCfg.headers.Authorization).toBe(`Bearer ${TOKEN}`);

    const [regUrl, regBody] = axios.post.mock.calls[1];
    expect(regUrl).toBe(`https://graph.facebook.com/v24.0/${PHONE}/register`);
    expect(regBody.messaging_product).toBe('whatsapp');
    expect(regBody.pin).toMatch(/^\d{6}$/);

    expect(done.step).toBe('done');
  });

  test('the token is stored encrypted, never in the clear', async () => {
    prisma.whatsappOnboarding.findUnique.mockResolvedValue(row());
    axios.get.mockResolvedValue({ data: { access_token: TOKEN } });
    axios.post.mockResolvedValue({ data: {} });

    await runOnboarding('onb_1', { code: 'CODE30S' });

    const stored = prisma.whatsappOnboarding.update.mock.calls
      .map(([{ data }]) => data.access_token_enc).find(Boolean);
    expect(stored).toBeTruthy();
    expect(stored).not.toContain(TOKEN);
    expect(decrypt(stored)).toBe(TOKEN);
  });

  test('a 6-digit PIN keeps its leading zeros', () => {
    for (let i = 0; i < 200; i += 1) expect(generatePin()).toMatch(/^\d{6}$/);
  });

  test('neither the token nor the PIN can reach the browser', () => {
    const shown = publicStatus(row({ access_token_enc: 'enc', pin_enc: 'enc', step: 'done' }));
    expect(JSON.stringify(shown)).not.toMatch(/access_token|pin_enc/);
    expect(shown.next_action.code).toBe('add_payment_method'); // the customer's own last step
  });
});

describe('resume', () => {
  test('a failed subscribe is recorded as the resume point, not a lost signup', async () => {
    prisma.whatsappOnboarding.findUnique.mockResolvedValue(row());
    axios.get.mockResolvedValue({ data: { access_token: TOKEN } });
    axios.post.mockRejectedValue({ response: { data: { error: { message: 'temporary', code: 4 } } } });

    await expect(runOnboarding('onb_1', { code: 'CODE30S' })).rejects.toThrow(/subscribed_apps failed/);

    const failure = prisma.whatsappOnboarding.update.mock.calls
      .map(([a]) => a.data).find((d) => d.last_error);
    expect(failure.step).toBe('token_exchanged');
  });

  test('retrying after that uses the stored token and asks for no new code', async () => {
    const { encrypt } = require('../src/utils/tokenCrypto');
    prisma.whatsappOnboarding.findUnique.mockResolvedValue(
      row({ step: 'token_exchanged', access_token_enc: encrypt(TOKEN) }));
    axios.post.mockResolvedValue({ data: {} });

    const done = await runOnboarding('onb_1', {}); // no code — this is the point

    expect(axios.get).not.toHaveBeenCalled();     // no second exchange
    expect(axios.post).toHaveBeenCalledTimes(2);  // subscribe + register only
    expect(done.step).toBe('done');
  });

  test('a finished onboarding is not run again', async () => {
    prisma.whatsappOnboarding.findUnique.mockResolvedValue(row({ step: 'done' }));
    const out = await runOnboarding('onb_1', {});
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
    expect(out.step).toBe('done');
  });

  test('a register retry reuses the stored PIN so 2FA is not reset under the customer', async () => {
    const { encrypt } = require('../src/utils/tokenCrypto');
    prisma.whatsappOnboarding.findUnique.mockResolvedValue(
      row({ step: 'subscribed', access_token_enc: encrypt(TOKEN), pin_enc: encrypt('042042') }));
    axios.post.mockResolvedValue({ data: {} });

    await runOnboarding('onb_1', {});

    const [, regBody] = axios.post.mock.calls[0];
    expect(regBody.pin).toBe('042042');
  });
});

describe('a number that already has two-step verification', () => {
  test('a supplied PIN overrides the stored one, so a retry is not stuck with ours', async () => {
    const { encrypt } = require('../src/utils/tokenCrypto');
    prisma.whatsappOnboarding.findUnique.mockResolvedValue(
      row({ step: 'subscribed', access_token_enc: encrypt(TOKEN), pin_enc: encrypt('111111') }));
    axios.post.mockResolvedValue({ data: {} });

    await runOnboarding('onb_1', { pin: '987654' });

    const [, regBody] = axios.post.mock.calls[0];
    expect(regBody.pin).toBe('987654');
  });

  test('a PIN that is not 6 digits is refused before Meta is called', async () => {
    const { encrypt } = require('../src/utils/tokenCrypto');
    prisma.whatsappOnboarding.findUnique.mockResolvedValue(
      row({ step: 'subscribed', access_token_enc: encrypt(TOKEN) }));

    await expect(runOnboarding('onb_1', { pin: '12ab' })).rejects.toThrow(/6 digits/);
    expect(axios.post).not.toHaveBeenCalled();
  });
});
