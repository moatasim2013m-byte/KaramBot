/**
 * «يعمل»: the first bot reply a shop delivers to a real customer (docs/panels/spec.md step 10).
 *
 * It sets Business.went_live_at once, starts the free month (trial_ends_at from plans.trialEndsAt
 * with the first reply, which can only bring the date earlier), logs went_live and tells SHIFT.
 * The owner trying the bot from their own mobile (a staff number) is not a customer, SHIFT's
 * internal rows never go live, and a send that failed made nobody live. The reply itself goes out
 * exactly as before. Real messageProcessor + generic workflow on the fakeDb; axios mocked.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');
jest.mock('../src/ai/provider', () => ({ generateValidatedAIReply: jest.fn(), generateAIReply: jest.fn() }));

const axios = require('axios');
const db = require('./helpers/fakeDb').getFakeDb();
const alerts = require('../src/services/alerts');
const platformSettings = require('../src/services/platformSettings');
const replyBatcher = require('../src/services/replyBatcher');
const wentLive = require('../src/services/wentLive');
const { persistInbound, processInboundMessage } = require('../src/services/messageProcessor');
const { encrypt } = require('../src/utils/tokenCrypto');

const PNID = 'pnid_live';
const CUSTOMER = '962791111111';
const OWNER = '962796381676';
const DAY = 24 * 3600 * 1000;
const T0 = new Date();
const CONNECTED = new Date(T0.getTime() - 2 * DAY);
let seq = 0;
let notify;

function seedShop(extra = {}) {
  db.seed({
    businesses: [{
      id: 'biz_live', name: 'صيدلية الحياة', business_type: 'generic', status: 'active',
      wa_phone_number_id: PNID, wa_access_token: encrypt('tok'), connected_at: CONNECTED,
      ai_config: { alert_wa_numbers: [OWNER], greeting_message: 'أهلًا بك في صيدلية الحياة' },
      ...extra,
    }],
    // The free month made at connect: the latest it can end (connect + 14-day backstop + 30 days).
    subscriptions: [{
      id: 'sub1', business_id: 'biz_live', solution: 'karam_bot', status: 'trial', amount_jod: 19.99, billing_cycle: 'monthly',
      starts_at: CONNECTED, trial_ends_at: new Date(CONNECTED.getTime() + 44 * DAY), next_due_at: new Date(CONNECTED.getTime() + 44 * DAY),
      created_by: 'system',
    }],
  });
}

const entry = (from, body) => ({
  changes: [{
    value: {
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: PNID },
      contacts: [{ wa_id: from, profile: { name: 'محمد' } }],
      messages: [{ id: `wamid.l${++seq}`, from, timestamp: '1', type: 'text', text: { body } }],
    },
  }],
});

async function deliver(from, body = 'مرحبا') {
  const e = entry(from, body);
  const persisted = await persistInbound(e);
  await processInboundMessage(e, { persisted });
  await new Promise((r) => setImmediate(r));
}

const shop = () => db.store.businesses.find((b) => b.id === 'biz_live');
const repliesTo = (to) => axios.post.mock.calls.filter(([url, body]) => /\/messages$/.test(url) && body.to === to);

beforeEach(() => {
  db.reset();
  db.clock.set(T0);
  platformSettings.clearCache();
  seq = 0;
  jest.restoreAllMocks();
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.out' }] } });
  notify = jest.spyOn(alerts, 'notifyShift').mockResolvedValue(null);
  jest.spyOn(alerts, 'sendStaffAlert').mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => replyBatcher.cancelAll?.());

test('the first reply to a customer makes the shop live, starts the free month, and tells SHIFT once', async () => {
  seedShop();
  await deliver(CUSTOMER);

  // The customer got the reply, exactly as before.
  expect(repliesTo(CUSTOMER)).toHaveLength(1);
  const liveAt = shop().went_live_at;
  expect(liveAt).toBeInstanceOf(Date);

  const sub = db.store.subscriptions[0];
  expect(Math.abs(sub.trial_ends_at.getTime() - (liveAt.getTime() + 30 * DAY))).toBeLessThan(1000);
  expect(sub.next_due_at.getTime()).toBe(sub.trial_ends_at.getTime());

  expect(db.store.accountEvents.filter((e) => e.type === 'went_live')).toEqual([
    expect.objectContaining({ business_id: 'biz_live', actor_kind: 'system' }),
  ]);
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({
    reason: 'went_live', businessId: 'biz_live', summary: 'صيدلية الحياة يعمل — أول رد للبوت على زبون',
  }));

  // The next customer changes nothing.
  await deliver('962792222222');
  expect(repliesTo('962792222222')).toHaveLength(1);
  expect(shop().went_live_at).toEqual(liveAt);
  expect(db.store.accountEvents.filter((e) => e.type === 'went_live')).toHaveLength(1);
  expect(notify.mock.calls.filter(([a]) => a.reason === 'went_live')).toHaveLength(1);
});

test('the owner trying the bot from their own mobile is answered but is not a customer', async () => {
  seedShop();
  await deliver(OWNER);
  expect(repliesTo(OWNER)).toHaveLength(1);
  expect(shop().went_live_at).toBeNull();
  expect(notify).not.toHaveBeenCalled();
  expect(db.store.subscriptions[0].trial_ends_at.getTime()).toBe(CONNECTED.getTime() + 44 * DAY);
});

test('SHIFT\'s internal rows never go live', async () => {
  seedShop({ is_internal: true });
  await deliver(CUSTOMER);
  expect(repliesTo(CUSTOMER)).toHaveLength(1);
  expect(shop().went_live_at).toBeNull();
  expect(notify).not.toHaveBeenCalled();
});

test('a reply Meta refused made nobody live', async () => {
  seedShop();
  axios.post.mockRejectedValue(Object.assign(new Error('send failed'), { response: { data: { error: { code: 131000 } } } }));
  await deliver(CUSTOMER);
  expect(shop().went_live_at).toBeNull();
  expect(db.store.accountEvents.filter((e) => e.type === 'went_live')).toHaveLength(0);
});

test('a shop already live costs no query, and a lost race writes nothing', async () => {
  seedShop();
  const updateMany = jest.spyOn(db.prisma.business, 'updateMany');
  const live = { id: 'biz_live', went_live_at: new Date(), ai_config: {} };
  expect(await wentLive.noteAiReply(live, CUSTOMER)).toBe(false);
  expect(updateMany).not.toHaveBeenCalled();

  // Another instance set it first: updateMany matches nothing, so no event and no alert here.
  shop().went_live_at = new Date();
  expect(await wentLive.noteAiReply({ id: 'biz_live', name: 'x', went_live_at: null, ai_config: {} }, CUSTOMER)).toBe(false);
  expect(db.store.accountEvents).toHaveLength(0);
  expect(notify).not.toHaveBeenCalled();
});

test('a paying shop\'s dates are not touched, and a trial already ending earlier is kept', async () => {
  seedShop();
  db.store.subscriptions[0].status = 'active';
  await deliver(CUSTOMER);
  expect(shop().went_live_at).toBeInstanceOf(Date);
  expect(db.store.subscriptions[0].trial_ends_at.getTime()).toBe(CONNECTED.getTime() + 44 * DAY);

  db.reset();
  seedShop();
  const early = new Date(T0.getTime() + 5 * DAY);
  db.store.subscriptions[0].trial_ends_at = early;
  await deliver(CUSTOMER);
  expect(db.store.subscriptions[0].trial_ends_at).toEqual(early);
});
