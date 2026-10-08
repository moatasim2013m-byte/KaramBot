/**
 * The account webhooks (docs/panels/spec.md, accountUpdate.js and whatsapp.js in «API changes»).
 *
 * account_update is how SHIFT hears that a customer finished a signup it has no row for, removed
 * SHIFT from their Meta account, or was restricted; phone_number_quality_update and
 * message_template_status_update keep the number's rating and the owner-alert template current.
 * Payloads are the assumed fixtures (tests/fixtures/esAssumed.js) until G1 records real ones.
 *
 * The last block runs them through the real webhook route next to inbound messages, to prove the
 * live bots' delivery path is unchanged: a message in the same delivery is still persisted and
 * processed, and a side handler that throws costs nothing.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('../src/services/messageProcessor', () => ({
  persistInbound: jest.fn(async () => ({ business: null, items: [] })),
  processInboundMessage: jest.fn(async () => null),
  MEDIA_TYPES: [],
}));

const crypto = require('crypto');
const request = require('supertest');
const db = require('./helpers/fakeDb').getFakeDb();
const alerts = require('../src/services/alerts');
const messageProcessor = require('../src/services/messageProcessor');
const {
  handleAccountUpdate, handleQualityUpdate, handleTemplateStatusUpdate, wabaOf,
} = require('../src/services/accountUpdate');
const fx = require('./fixtures/esAssumed');
const app = require('../src/app');

const { IDS } = fx;
const onboarding = () => db.store.whatsappOnboardings.find((r) => r.id === 'onb_sham');
const eventsOf = (businessId) => db.store.accountEvents.filter((e) => e.business_id === businessId);
const first = (payload) => [payload.entry[0], payload.entry[0].changes[0]];

let notify;
let staffAlert;
beforeEach(() => {
  db.reset();
  messageProcessor.persistInbound.mockClear();
  messageProcessor.processInboundMessage.mockClear();
  notify = jest.spyOn(alerts, 'notifyShift').mockResolvedValue(null);
  staffAlert = jest.spyOn(alerts, 'sendStaffAlert').mockResolvedValue(null);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  db.seed({
    businesses: [{
      id: 'biz_sham', name: 'مطعم الشام', slug: 'sham', wa_phone_number_id: IDS.PHONE, wa_business_account_id: IDS.WABA,
      wa_display_phone: '+962 7 9123 4567', owner_phone: '962791234567',
      ai_config: { greeting_message: 'أهلًا', alert_wa_numbers: ['962791234567'] },
    }],
    whatsappOnboardings: [{
      id: 'onb_sham', business_id: 'biz_sham', app_id: '1065272896256103', meta_business_id: IDS.PORTFOLIO,
      waba_id: IDS.WABA, phone_number_id: IDS.PHONE, step: 'done',
    }],
  });
});
afterEach(() => jest.restoreAllMocks());

describe('which WABA an event is about', () => {
  test('PARTNER_* carry it in waba_info; entry.id there is SHIFT\'s own portfolio', () => {
    const [entry, change] = first(fx.partnerAdded());
    expect(entry.id).toBe(IDS.PARTNER);
    expect(wabaOf(entry, change.value)).toBe(IDS.WABA);
  });

  test('other events use entry.id', () => {
    const [entry, change] = first(fx.restriction());
    expect(wabaOf(entry, change.value)).toBe(IDS.WABA);
  });
});

describe('PARTNER_ADDED', () => {
  test('for a row we have: confirmation on the shop\'s log', async () => {
    const out = await handleAccountUpdate(...first(fx.partnerAdded()));
    expect(out).toMatchObject({ handled: true, event: 'PARTNER_ADDED', onboardingId: 'onb_sham' });
    expect(eventsOf('biz_sham').map((e) => [e.type, e.actor_kind])).toEqual([['partner_added', 'meta']]);
  });

  test('for a WABA with no row: partner_added_unmatched for SHIFT, once however often Meta repeats it', async () => {
    const payload = fx.partnerAdded({ waba: '104900000000777', owner: '880000000000777' });
    await handleAccountUpdate(...first(payload));
    await handleAccountUpdate(...first(payload));
    const unmatched = db.store.accountEvents.filter((e) => e.type === 'partner_added_unmatched');
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]).toMatchObject({
      business_id: null, actor_kind: 'meta',
      data: { event: 'PARTNER_ADDED', waba_id: '104900000000777', owner_business_id: '880000000000777' },
    });
  });
});

describe('SHIFT removed from the customer\'s account', () => {
  test.each([
    ['PARTNER_REMOVED', fx.partnerRemoved()],
    ['PARTNER_APP_UNINSTALLED', fx.appUninstalled()],
    ['ACCOUNT_DELETED', fx.accountEvent('ACCOUNT_DELETED')],
    ['ACCOUNT_OFFBOARDED', fx.accountEvent('ACCOUNT_OFFBOARDED')],
  ])('%s: revoked, logged, SHIFT and the owner told', async (event, payload) => {
    await handleAccountUpdate(...first(payload));
    expect(onboarding().revoked_at).toBeInstanceOf(Date);
    expect(onboarding().revoked_reason).toBe(event.toLowerCase());
    expect(eventsOf('biz_sham').map((e) => [e.type, e.data.event])).toEqual([['partner_removed', event]]);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ reason: 'partner_removed', businessId: 'biz_sham' }));
    expect(staffAlert).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'partner_removed', business: expect.objectContaining({ id: 'biz_sham' }), summary: expect.stringMatching(/تواصل مع شِفت/),
    }));
    // A removal is a state, not a failed step: last_error (the resume point) is untouched.
    expect(onboarding().last_error).toBeNull();
  });

  test('a repeated removal does not alert again', async () => {
    await handleAccountUpdate(...first(fx.partnerRemoved()));
    await handleAccountUpdate(...first(fx.partnerRemoved()));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(eventsOf('biz_sham')).toHaveLength(1);
  });

  test('two removals delivered together (same event twice, or PARTNER_REMOVED with PARTNER_APP_UNINSTALLED) alert once', async () => {
    await Promise.all([
      handleAccountUpdate(...first(fx.partnerRemoved())),
      handleAccountUpdate(...first(fx.partnerRemoved())),
      handleAccountUpdate(...first(fx.appUninstalled())),
    ]);
    expect(onboarding().revoked_at).toBeInstanceOf(Date);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(staffAlert).toHaveBeenCalledTimes(1);
    expect(eventsOf('biz_sham').filter((e) => e.type === 'partner_removed')).toHaveLength(1);
  });

  test('the owner is not sent looking for a «أعد الربط» button their panel does not have', () => {
    const { REMOVED_AR } = require('../src/services/accountUpdate');
    expect(REMOVED_AR).not.toMatch(/أعد الربط|افتح لوحتك/);
    expect(REMOVED_AR).toMatch(/تواصل مع شِفت/);
  });

  test('ACCOUNT_RECONNECTED clears it', async () => {
    await handleAccountUpdate(...first(fx.partnerRemoved()));
    await handleAccountUpdate(...first(fx.accountEvent('ACCOUNT_RECONNECTED')));
    expect(onboarding()).toMatchObject({ revoked_at: null, revoked_reason: null });
  });
});

describe('Meta acting against the account', () => {
  test.each([
    ['ACCOUNT_RESTRICTION', fx.restriction(), 'restriction_info'],
    ['DISABLED_UPDATE', fx.banned(), 'ban_info'],
    ['ACCOUNT_VIOLATION', fx.accountEvent('ACCOUNT_VIOLATION', { violation_info: { violation_type: 'SCAM' } }), 'violation_info'],
  ])('%s goes to the log as meta_restriction, not over last_error', async (event, payload, field) => {
    await handleAccountUpdate(...first(payload));
    const [logged] = eventsOf('biz_sham');
    expect(logged).toMatchObject({ type: 'meta_restriction', actor_kind: 'meta', data: { event } });
    expect(logged.data[field]).toBeTruthy();
    expect(onboarding().last_error).toBeNull();
  });
});

describe('phone_number_quality_update', () => {
  test('FLAGGED stores RED, UNFLAGGED GREEN', async () => {
    await handleQualityUpdate(...first(fx.qualityUpdate({ event: 'FLAGGED' })));
    expect(onboarding().meta_quality_rating).toBe('RED');
    await handleQualityUpdate(...first(fx.qualityUpdate({ event: 'UNFLAGGED' })));
    expect(onboarding().meta_quality_rating).toBe('GREEN');
  });

  test('a limit change says nothing about quality and leaves it', async () => {
    db.store.whatsappOnboardings[0].meta_quality_rating = 'YELLOW';
    const out = await handleQualityUpdate(...first(fx.qualityUpdate({ event: 'UPGRADE' })));
    expect(out.handled).toBe(false);
    expect(onboarding().meta_quality_rating).toBe('YELLOW');
  });

  test('an unknown WABA changes nothing', async () => {
    const out = await handleQualityUpdate(...first(fx.qualityUpdate({ waba: '104900000000555' })));
    expect(out.handled).toBe(false);
  });
});

describe('message_template_status_update', () => {
  test('an approved owner-alert template becomes the shop\'s alert template, other settings kept', async () => {
    await handleTemplateStatusUpdate(...first(fx.templateStatus()));
    const biz = db.store.businesses[0];
    expect(biz.ai_config).toEqual({
      greeting_message: 'أهلًا', alert_wa_numbers: ['962791234567'], alert_template: { name: 'owner_alert', language: 'ar' },
    });
    expect(eventsOf('biz_sham')).toEqual([expect.objectContaining({
      type: 'template_status', data: expect.objectContaining({ event: 'APPROVED', name: 'owner_alert' }),
    })]);
  });

  test('a rejection, or a template that is not the owner alert, is logged and changes nothing', async () => {
    await handleTemplateStatusUpdate(...first(fx.templateStatus({ event: 'REJECTED' })));
    await handleTemplateStatusUpdate(...first(fx.templateStatus({ name: 'eid_offer' })));
    expect(db.store.businesses[0].ai_config.alert_template).toBeUndefined();
    expect(eventsOf('biz_sham')).toHaveLength(2);
  });

  test('a shop already using another alert template keeps it', async () => {
    db.store.businesses[0].ai_config = { alert_template: { name: 'staff_alert', language: 'ar' } };
    await handleTemplateStatusUpdate(...first(fx.templateStatus()));
    expect(db.store.businesses[0].ai_config.alert_template).toEqual({ name: 'staff_alert', language: 'ar' });
  });
});

describe('through the webhook route, beside inbound messages', () => {
  const sign = (body) => `sha256=${crypto.createHmac('sha256', process.env.META_APP_SECRET).update(body).digest('hex')}`;
  const post = (payload) => {
    const body = JSON.stringify(payload);
    return request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(Buffer.from(body))).send(body);
  };
  const tick = () => new Promise((r) => setImmediate(r));

  const messageEntry = {
    id: IDS.WABA,
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '962791234567', phone_number_id: IDS.PHONE },
        contacts: [{ profile: { name: 'زبون' }, wa_id: '962790000001' }],
        messages: [{ from: '962790000001', id: 'wamid.X1', timestamp: '1791460800', type: 'text', text: { body: 'مرحبا' } }],
      },
    }],
  };

  test('a delivery with a message and the three side fields: 200, the message persisted and processed, the side fields applied', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        messageEntry,
        fx.qualityUpdate().entry[0],
        fx.templateStatus().entry[0],
        fx.partnerAdded().entry[0],
      ],
    };
    const res = await post(payload);
    expect(res.status).toBe(200);
    expect(messageProcessor.persistInbound).toHaveBeenCalledTimes(4);
    expect(messageProcessor.persistInbound.mock.calls[0][0]).toEqual(messageEntry);
    await tick();
    expect(messageProcessor.processInboundMessage).toHaveBeenCalled();
    expect(onboarding().meta_quality_rating).toBe('RED');
    expect(db.store.businesses[0].ai_config.alert_template).toEqual({ name: 'owner_alert', language: 'ar' });
  });

  test('a side handler that fails does not touch the message path', async () => {
    const spy = jest.spyOn(db.prisma.whatsappOnboarding, 'findMany').mockRejectedValue(new Error('db down'));
    const res = await post({ object: 'whatsapp_business_account', entry: [messageEntry, fx.qualityUpdate().entry[0]] });
    expect(res.status).toBe(200);
    expect(messageProcessor.persistInbound).toHaveBeenCalledTimes(2);
    await tick();
    expect(messageProcessor.processInboundMessage).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('[phone_number_quality_update] failed:', 'db down');
    spy.mockRestore();
  });
});
