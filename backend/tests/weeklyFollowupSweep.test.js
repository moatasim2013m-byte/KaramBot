/**
 * The sweep step that sends the October offer's weekly follow-up (services/shiftSweeper.js,
 * weekly_followups): off unless enabled, once per step even across sweeps, the real count of places.
 */
require('./setup');
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('../src/services/replyBatcher', () => ({
  scheduleReply: jest.fn(), deliverResult: jest.fn(), dispatchIntent: jest.fn(),
  deliveredView: jest.fn(async (conv) => conv), reconcileUnconfirmedIntents: jest.fn(async () => ({ requeued: 0, escalated: 0, ambiguous: [] })),
  isShiftReplyAllowed: jest.fn(() => true),
  isHumanActive: jest.fn((...args) => jest.requireActual('../src/services/replyBatcher').isHumanActive(...args)),
}));
jest.mock('../src/services/messageProcessor', () => ({ reprocessStuckInbound: jest.fn() }));
jest.mock('../src/services/alerts', () => ({ sendStaffAlert: jest.fn(), alertChannelConfigured: jest.fn() }));

const replyBatcher = require('../src/services/replyBatcher');
const alerts = require('../src/services/alerts');
const { runSweep } = require('../src/services/shiftSweeper');
const db = require('./helpers/fakeDb').getFakeDb();

// Tuesday 13 Oct 2026, 13:00 Amman.
const NOW = new Date('2026-10-13T10:00:00Z');
const DAY = 24 * 3600 * 1000;
const ago = (d) => new Date(NOW.getTime() - d * DAY);

function seed({ subscriptions = [] } = {}) {
  db.seed({
    businesses: [
      { id: 'biz_shift', name: 'SHIFT', business_type: 'shift', status: 'active', wa_phone_number_id: 'PN', ai_config: { alert_wa_numbers: ['962796381676'] } },
      { id: 'biz_c1', name: 'C1', business_type: 'restaurant', wa_phone_number_id: 'PN1' },
      { id: 'biz_c2', name: 'C2', business_type: 'clinic', wa_phone_number_id: 'PN2' },
    ],
    conversations: [
      { id: 'c_lead', business_id: 'biz_shift', customer_wa_id: '962787573973', profile_name: 'anas awawdah', current_state: 'discovery', last_message_at: ago(4), last_inbound_at: ago(4) },
      { id: 'c_no', business_id: 'biz_shift', customer_wa_id: '962795706323', current_state: 'closed', last_message_at: ago(4), last_inbound_at: ago(4) },
      { id: 'c_owner', business_id: 'biz_shift', customer_wa_id: '962796381676', current_state: 'discovery', last_message_at: ago(4), last_inbound_at: ago(4) },
    ],
    messages: ['c_lead', 'c_no', 'c_owner'].map((id) => ({ business_id: 'biz_shift', conversation_id: id, direction: 'inbound', text_body: 'مرحبا', created_at: ago(4) })),
    subscriptions,
  });
}

const sentTo = () => replyBatcher.dispatchIntent.mock.calls.map(([a]) => a.conversation.id);
const conv = (id) => db.store.conversations.find((c) => c.id === id);

beforeEach(() => {
  db.reset();
  jest.clearAllMocks();
  process.env.SHIFT_WEEKLY_FOLLOWUPS = '1';
  replyBatcher.dispatchIntent.mockResolvedValue({ outcome: 'sent', parts: [{ intentId: 'i1' }] });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { delete process.env.SHIFT_WEEKLY_FOLLOWUPS; jest.restoreAllMocks(); });

test('only the quiet lead gets week 1 — not the one who said no, not the owner', async () => {
  seed();
  await runSweep({ now: NOW });
  expect(sentTo()).toEqual(['c_lead']);
  const [arg] = replyBatcher.dispatchIntent.mock.calls[0];
  expect(arg.kind).toBe('weekly_followup');
  expect(arg.parts[0]).toMatchObject({ type: 'template', name: 'karam_followup_w1', bodyParams: ['anas awawdah', '10'] });
  expect(arg.precheck).toMatchObject({ humanGuard: true });
  expect(conv('c_lead').workflow_data.weekly_followup).toMatchObject({ step: 1, template: 'karam_followup_w1' });
});

test('a second sweep — even an hour or a day later — never sends the same week again', async () => {
  seed();
  await runSweep({ now: NOW });
  await runSweep({ now: new Date(NOW.getTime() + 3600 * 1000) });
  await runSweep({ now: new Date(NOW.getTime() + DAY) });
  expect(sentTo()).toEqual(['c_lead']);
});

test('a week later the lead gets week 2', async () => {
  seed();
  await runSweep({ now: NOW });
  await runSweep({ now: new Date(NOW.getTime() + 7 * DAY) });
  expect(replyBatcher.dispatchIntent.mock.calls.map(([a]) => a.parts[0].name)).toEqual(['karam_followup_w1', 'karam_followup_w2']);
});

test('«ضايل X» is ten minus the Karam Bot contracts started since the offer began', async () => {
  seed({
    subscriptions: [
      { business_id: 'biz_c1', solution: 'karam_bot', status: 'active', amount_jod: 19.99, starts_at: new Date('2026-10-08T00:00:00Z'), created_by: 'a' },
      { business_id: 'biz_c2', solution: 'karam_bot', status: 'trial', amount_jod: 0, starts_at: new Date('2026-10-09T00:00:00Z'), created_by: 'a' },
      // Neither counts: another product, and a contract from before the offer.
      { business_id: 'biz_c2', solution: 'automation', status: 'active', amount_jod: 100, starts_at: new Date('2026-10-09T00:00:00Z'), created_by: 'a' },
      { business_id: 'biz_c1', solution: 'karam_bot', status: 'cancelled', amount_jod: 19.99, starts_at: new Date('2026-10-02T00:00:00Z'), created_by: 'a' },
    ],
  });
  await runSweep({ now: NOW });
  expect(replyBatcher.dispatchIntent.mock.calls[0][0].parts[0].bodyParams[1]).toBe('8');
});

test('a number on the do-not-follow-up list never gets it', async () => {
  seed();
  db.store.businesses.find((b) => b.id === 'biz_shift').ai_config.followup_exclude = ['+962 78 757 3973'];
  await runSweep({ now: NOW });
  expect(replyBatcher.dispatchIntent).not.toHaveBeenCalled();
});

test('switched off, nothing is sent', async () => {
  delete process.env.SHIFT_WEEKLY_FOLLOWUPS;
  seed();
  await runSweep({ now: NOW });
  expect(replyBatcher.dispatchIntent).not.toHaveBeenCalled();
});

test('a template Meta has not approved stops the series and tells the owner once', async () => {
  seed();
  replyBatcher.dispatchIntent.mockResolvedValue({ outcome: 'failed', parts: [{ reason: 'template' }] });
  await runSweep({ now: NOW });
  await runSweep({ now: new Date(NOW.getTime() + 7 * DAY) });
  expect(sentTo()).toEqual(['c_lead']);
  expect(conv('c_lead').workflow_data.weekly_followup).toMatchObject({ stopped: 'template' });
  expect(alerts.sendStaffAlert).toHaveBeenCalledTimes(1);
});
