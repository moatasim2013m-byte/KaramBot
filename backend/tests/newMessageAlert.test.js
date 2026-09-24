/**
 * newMessageAlert.test.js — «رسالة جديدة من عميل» staff alerts.
 *
 * A customer's first message alerts; later ones only after `alert_new_message_quiet_min` (30) minutes of
 * silence from them. Staff numbers never alert. The text carries the name, +number, a preview (or a media
 * label), the ad it came from and the Inbox link. It runs beside the reply path: a slow or failing alert
 * never delays or breaks the reply.
 *
 * Real messageProcessor + alerts + whatsapp senders on the in-memory fakeDb; axios is mocked (no network).
 */

require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');

const axios = require('axios');
const db = require('./helpers/fakeDb').getFakeDb();
const alerts = require('../src/services/alerts');
const newMessageAlert = require('../src/services/newMessageAlert');
const replyBatcher = require('../src/services/replyBatcher');
const { persistInbound, processInboundMessage } = require('../src/services/messageProcessor');
const { encrypt } = require('../src/utils/tokenCrypto');

const {
  notifyNewMessages, newMessageConfig, messagePreview, adLine, alertSummary, CLAIM_KEY,
} = newMessageAlert;

const PNID = 'pnid_alerts';
const CUSTOMER = '962791111111';
const OWNER = '962796381676';
const BROTHER = '971557657948';
const T0 = new Date('2026-09-19T08:00:00.000Z');
const MIN = 60 * 1000;

let seq = 0;

function seedBusiness(aiConfig = {}, extra = {}) {
  return db.seed({
    businesses: [{
      id: 'biz_1',
      name: 'Test',
      business_type: 'generic',
      wa_phone_number_id: PNID,
      wa_access_token: encrypt('tok'),
      ai_config: { alert_wa_numbers: [OWNER, BROTHER], ...aiConfig },
      ...extra,
    }],
  }).businesses[0];
}

function entry(messages, { from = CUSTOMER, name = 'محمد' } = {}) {
  return {
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: PNID },
        contacts: [{ wa_id: from, profile: { name } }],
        messages: messages.map((m) => {
          seq += 1;
          return { id: `wamid.n${seq}`, from, timestamp: '1', type: 'text', ...m };
        }),
      },
    }],
  };
}

const text = (body, extra = {}) => ({ type: 'text', text: { body }, ...extra });

async function deliver(messages, opts = {}) {
  const { business, items } = await persistInbound(entry(messages, opts));
  return notifyNewMessages(business, items, { now: db.clock.now() });
}

beforeEach(() => {
  db.reset();
  db.clock.set(T0);
  seq = 0;
  jest.restoreAllMocks();
  axios.post.mockReset();
  delete process.env.SHIFT_INBOX_URL;
  delete process.env.STAFF_ALERT_WEBHOOK_URL;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  replyBatcher.cancelAll?.();
});

// ─── pure pieces ─────────────────────────────────────────────────────────────

describe('config', () => {
  test('on by default when staff numbers are set; explicit flag wins; no repeat unless asked for', () => {
    // Unset means a customer's FIRST-EVER message alerts and nothing after it — what the owner
    // chose on 2026-09-22, since these land on his own phone. Infinity: no gap is ever enough.
    expect(newMessageConfig({ ai_config: { alert_wa_numbers: [OWNER] } })).toMatchObject({ enabled: true, quietMs: Infinity });
    expect(newMessageConfig({ ai_config: {} }).enabled).toBe(false);
    expect(newMessageConfig({ ai_config: { alert_wa_numbers: [] } }).enabled).toBe(false);
    expect(newMessageConfig({ ai_config: { alert_wa_numbers: [OWNER], alert_new_messages: false } }).enabled).toBe(false);
    expect(newMessageConfig({ ai_config: { alert_new_messages: true } }).enabled).toBe(true);
    expect(newMessageConfig({ ai_config: { alert_wa_numbers: [OWNER], alert_new_message_quiet_min: 10 } }).quietMs).toBe(10 * MIN);
    // A nonsense value falls back to the safe default rather than inventing a cadence.
    expect(newMessageConfig({ ai_config: { alert_wa_numbers: [OWNER], alert_new_message_quiet_min: 'x' } }).quietMs).toBe(Infinity);
    expect(newMessageConfig({ ai_config: { alert_wa_numbers: [OWNER], alert_new_message_quiet_min: -5 } }).quietMs).toBe(Infinity);
    expect(newMessageConfig({ ai_config: { alert_wa_numbers: [OWNER], alert_new_message_quiet_min: 0 } }).quietMs).toBe(0);
    expect(newMessageConfig({ ai_config: { alert_wa_numbers: ['+962 79-638-1676'] } }).staff.has(OWNER)).toBe(true);
    expect(newMessageConfig(null).enabled).toBe(false);
  });
});

describe('preview and media labels', () => {
  test('text: one line in «», cut at 120 characters', () => {
    expect(messagePreview(text('مرحبا\nبدي أعرف   الأسعار'))).toBe('«مرحبا بدي أعرف الأسعار»');
    const long = messagePreview(text('ا'.repeat(300)));
    expect(long).toBe(`«${'ا'.repeat(120)}…»`);
  });

  test('media → Arabic label (with a caption when there is one)', () => {
    expect(messagePreview({ type: 'audio', audio: { id: 'a', voice: true } })).toBe('رسالة صوتية');
    expect(messagePreview({ type: 'image', image: { id: 'i' } })).toBe('صورة');
    expect(messagePreview({ type: 'image', image: { id: 'i', caption: 'هاد نظامنا' } })).toBe('صورة: هاد نظامنا');
    expect(messagePreview({ type: 'video', video: { id: 'v' } })).toBe('فيديو');
    expect(messagePreview({ type: 'document', document: { id: 'd', filename: 'menu.pdf' } })).toBe('ملف: menu.pdf');
    expect(messagePreview({ type: 'sticker', sticker: { id: 's' } })).toBe('ملصق');
    expect(messagePreview({ type: 'location', location: { latitude: 1, longitude: 2 } })).toBe('موقع');
    expect(messagePreview({ type: 'contacts', contacts: [] })).toBe('جهة اتصال');
    expect(messagePreview({ type: 'unsupported' })).toBe('رسالة غير مدعومة');
    expect(messagePreview({ type: 'something_new' })).toBe('رسالة');
    expect(messagePreview({ type: 'interactive', interactive: { button_reply: { id: 'x', title: 'احجز مكالمة' } } })).toBe('«احجز مكالمة»');
    expect(messagePreview({ type: 'button', button: { text: 'بدي أغيّر الموعد' } })).toBe('«بدي أغيّر الموعد»');
  });

  test('referral → «من إعلان: headline»; falls back to body / url; posts say «من منشور»', () => {
    expect(adLine(undefined)).toBeNull();
    expect(adLine({ source_type: 'ad', headline: 'بوت واتساب لعيادتك', body: 'x' })).toBe('من إعلان: بوت واتساب لعيادتك');
    expect(adLine({ source_type: 'ad', body: 'جرّب شِفت' })).toBe('من إعلان: جرّب شِفت');
    expect(adLine({ source_type: 'ad', source_url: 'https://fb.me/ad1' })).toBe('من إعلان: https://fb.me/ad1');
    expect(adLine({ source_type: 'ad' })).toBe('من إعلان');
    expect(adLine({ source_type: 'post', headline: 'منشور' })).toBe('من منشور: منشور');
    expect(adLine({ headline: 'ع'.repeat(200) })).toBe(`من إعلان: ${'ع'.repeat(80)}…`);
    expect(alertSummary(text('مرحبا', { referral: { source_type: 'ad', headline: 'عرض' } }))).toBe('«مرحبا»\nمن إعلان: عرض');
  });
});

// ─── burst / quiet-gap logic (real persistInbound + fakeDb) ──────────────────

describe('when it fires', () => {
  let send;
  beforeEach(() => {
    send = jest.spyOn(alerts, 'sendStaffAlert').mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
  });

  test('first-ever message → one alert with name, number, preview and the Inbox link', async () => {
    seedBusiness();
    expect(await deliver([text('مرحبا، بدي أعرف الأسعار')])).toEqual(['alerted']);
    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0][0];
    expect(arg).toMatchObject({
      reason: 'new_message',
      summary: '«مرحبا، بدي أعرف الأسعار»',
      link: 'https://app.shifts-ai.com/inbox',
      conversation: { customer_wa_id: CUSTOMER, profile_name: 'محمد' },
    });
    expect(arg.business.id).toBe('biz_1');
    const conv = db.store.conversations[0];
    expect(conv.metadata[CLAIM_KEY]).toBe('first');
  });

  test('a burst of ten messages (separate deliveries, seconds apart) → one alert', async () => {
    seedBusiness();
    const outcomes = [];
    for (let i = 0; i < 10; i += 1) {
      outcomes.push(...await deliver([text(`رسالة ${i}`)]));
      db.clock.advance(20 * 1000);
    }
    expect(outcomes[0]).toBe('alerted');
    expect(outcomes.slice(1)).toEqual(Array(9).fill('burst'));
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('several messages in one delivery → one alert', async () => {
    seedBusiness();
    expect(await deliver([text('1'), text('2'), { type: 'image', image: { id: 'm' } }])).toEqual(['alerted']);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('29 min of silence → no alert; 30 min → alert again (gap measured from their last message)', async () => {
    // The repeat is opt-in now, so this business asks for it explicitly.
    seedBusiness({ alert_new_message_quiet_min: 30 });
    await deliver([text('أول')]);
    db.clock.advance(29 * MIN);
    expect(await deliver([text('بعد 29 دقيقة')])).toEqual(['burst']);
    db.clock.advance(29 * MIN);
    // 58 min since the first alert, but only 29 since their last message: still the same conversation burst.
    expect(await deliver([text('بعد 29 كمان')])).toEqual(['burst']);
    db.clock.advance(30 * MIN);
    expect(await deliver([text('رجعت')])).toEqual(['alerted']);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].summary).toBe('«رجعت»');
  });

  test('quiet gap is configurable per business', async () => {
    seedBusiness({ alert_new_message_quiet_min: 5 });
    await deliver([text('أول')]);
    db.clock.advance(5 * MIN);
    expect(await deliver([text('بعد 5')])).toEqual(['alerted']);
  });

  test('a reaction neither alerts nor breaks the silence', async () => {
    seedBusiness({ alert_new_message_quiet_min: 30 });
    await deliver([text('أول')]);
    db.clock.advance(60 * MIN);
    expect(await deliver([{ type: 'reaction', reaction: { message_id: 'x', emoji: '👍' } }])).toEqual([]);
    db.clock.advance(1 * MIN);
    expect(await deliver([text('سؤال جديد')])).toEqual(['alerted']);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('staff numbers never alert themselves (either format)', async () => {
    seedBusiness({ alert_wa_numbers: ['+962 79 638 1676', BROTHER] });
    expect(await deliver([text('تجربة')], { from: OWNER })).toEqual([]);
    expect(await deliver([text('test')], { from: BROTHER })).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  test('not configured → nothing (no staff numbers, or alert_new_messages: false)', async () => {
    seedBusiness({ alert_wa_numbers: [] });
    expect(await deliver([text('مرحبا')])).toEqual([]);
    db.reset();
    db.clock.set(T0);
    seedBusiness({ alert_new_messages: false });
    expect(await deliver([text('مرحبا')])).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  test('a Meta retry of a stored message is not new', async () => {
    seedBusiness();
    const e = entry([text('مرحبا')]);
    const first = await persistInbound(e);
    const retry = await persistInbound(e);
    expect(await notifyNewMessages(first.business, first.items)).toEqual(['alerted']);
    expect(await notifyNewMessages(retry.business, retry.items)).toEqual([]);
  });

  test('two racing deliveries of one burst that both look like «after the gap» → one alert (claim)', async () => {
    seedBusiness({ alert_new_message_quiet_min: 30 });
    await deliver([text('أول')]);
    db.clock.advance(60 * MIN);
    // Both rows stored with the same timestamp before either checks: each sees only «أول» before it.
    const a = await persistInbound(entry([text('أ')]));
    const b = await persistInbound(entry([text('ب')]));
    const outcomes = await Promise.all([notifyNewMessages(a.business, a.items), notifyNewMessages(b.business, b.items)]);
    expect(outcomes.flat().sort()).toEqual(['alerted', 'claimed_elsewhere']);
    expect(send).toHaveBeenCalledTimes(2); // the first-ever message + one for the burst
  });

  test('the ad the customer came from is on the alert', async () => {
    seedBusiness();
    await deliver([text('مرحبا', { referral: { source_type: 'ad', source_id: '1', headline: 'بوت واتساب لعيادتك' } })]);
    expect(send.mock.calls[0][0].summary).toBe('«مرحبا»\nمن إعلان: بوت واتساب لعيادتك');
  });

  test('SHIFT_INBOX_URL overrides the link', async () => {
    process.env.SHIFT_INBOX_URL = 'https://inbox.example.test/inbox';
    seedBusiness();
    await deliver([{ type: 'audio', audio: { id: 'a' } }]);
    expect(send.mock.calls[0][0]).toMatchObject({ summary: 'رسالة صوتية', link: 'https://inbox.example.test/inbox' });
  });

  test('a DB error or a throwing alert resolves (never rejects) and is logged', async () => {
    seedBusiness();
    const { business, items } = await persistInbound(entry([text('مرحبا')]));
    db.failNext('message.findFirst', new Error('db down'));
    await expect(notifyNewMessages(business, items)).resolves.toEqual(['failed']);
    send.mockRejectedValueOnce(new Error('boom'));
    await expect(notifyNewMessages(business, items)).resolves.toEqual(['failed']);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[new_message] alert failed'));
    await expect(notifyNewMessages(business, null)).resolves.toEqual([]);
    await expect(notifyNewMessages(null, items)).resolves.toEqual([]);
  });

  test('a failed claim write still alerts (a duplicate beats a missed customer)', async () => {
    seedBusiness();
    const { business, items } = await persistInbound(entry([text('مرحبا')]));
    db.failNext('jsonb.claimValue', new Error('db down'));
    await expect(notifyNewMessages(business, items)).resolves.toEqual(['alerted']);
  });
});

// ─── through processInboundMessage: the reply path is never delayed or broken ─

describe('inbound path', () => {
  const graphCalls = (to) => axios.post.mock.calls.filter(([, body]) => body && body.to === to);

  function notifyPromise(spy) {
    return spy.mock.results.length ? spy.mock.results[0].value : Promise.resolve([]);
  }

  test('generic tenant: customer gets the reply AND both staff get the alert (owner in window → text, brother → template)', async () => {
    seedBusiness({ greeting_message: 'أهلا! كيف بنقدر نساعدك؟', alert_template: { name: 'staff_alert', language: 'ar' } });
    db.seed({ conversations: [{ business_id: 'biz_1', customer_wa_id: OWNER, last_inbound_at: new Date(T0.getTime() - 2 * 60 * MIN) }] });
    let out = 0;
    axios.post.mockImplementation(async () => { out += 1; return { status: 200, data: { messages: [{ id: `wamid.out${out}` }] } }; });
    const spy = jest.spyOn(newMessageAlert, 'notifyNewMessages');

    await processInboundMessage(entry([text('مرحبا من الإعلان', { referral: { source_type: 'ad', headline: 'عرض شِفت' } })]));
    await notifyPromise(spy);

    const reply = graphCalls(CUSTOMER).filter(([, body]) => body.type === 'text');
    expect(reply).toHaveLength(1);
    expect(reply[0][1].text.body).toBe('أهلا! كيف بنقدر نساعدك؟');

    const toOwner = graphCalls(OWNER);
    expect(toOwner).toHaveLength(1);
    const customerConv = db.store.conversations.find((c) => c.customer_wa_id === CUSTOMER);
    expect(toOwner[0][1].text.body).toBe([
      '🔔 SHIFT bot — رسالة جديدة من عميل',
      `العميل: محمد (+${CUSTOMER})`,
      '«مرحبا من الإعلان»',
      'من إعلان: عرض شِفت',
      'Inbox: https://app.shifts-ai.com/inbox',
      `conversation=${customerConv.id}`,
    ].join('\n'));

    const toBrother = graphCalls(BROTHER);
    expect(toBrother).toHaveLength(1);
    expect(toBrother[0][1]).toMatchObject({
      type: 'template',
      template: {
        name: 'staff_alert',
        language: { code: 'ar' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: 'رسالة جديدة من عميل' },
            { type: 'text', text: `محمد (+${CUSTOMER})` },
            { type: 'text', text: '«مرحبا من الإعلان» · من إعلان: عرض شِفت' },
          ],
        }],
      },
    });
    // The brother had no thread: one is created and holds the template copy.
    const brotherConv = db.store.conversations.find((c) => c.customer_wa_id === BROTHER);
    const stored = db.store.messages.filter((m) => m.conversation_id === brotherConv.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ direction: 'outbound', message_type: 'template', raw_payload: { kind: 'staff_alert', reason: 'new_message' } });
    expect(stored[0].text_body).toContain('[قالب staff_alert] تنبيه لفريق شِفت: رسالة جديدة من عميل');
  });

  test('the reply goes out even when the alert blows up (sync throw inside, rejected send, DB error)', async () => {
    seedBusiness({ greeting_message: 'أهلا!' });
    axios.post.mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.out' }] } });
    jest.spyOn(alerts, 'sendStaffAlert').mockRejectedValue(new Error('alert exploded'));
    const spy = jest.spyOn(newMessageAlert, 'notifyNewMessages');

    await processInboundMessage(entry([text('مرحبا')]));
    await expect(notifyPromise(spy)).resolves.toEqual(['failed']);
    expect(graphCalls(CUSTOMER).filter(([, b]) => b.type === 'text')).toHaveLength(1);

    db.clock.advance(60 * MIN);
    db.failNext('message.findFirst', new Error('db down'));
    await processInboundMessage(entry([text('مرة ثانية')]));
    expect(graphCalls(CUSTOMER).filter(([, b]) => b.type === 'text')).toHaveLength(2);
  });

  test('the reply does not wait for a slow alert', async () => {
    seedBusiness({ greeting_message: 'أهلا!' });
    axios.post.mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.out' }] } });
    let release;
    jest.spyOn(alerts, 'sendStaffAlert').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const spy = jest.spyOn(newMessageAlert, 'notifyNewMessages');

    await processInboundMessage(entry([text('مرحبا')]));
    expect(graphCalls(CUSTOMER).filter(([, b]) => b.type === 'text')).toHaveLength(1);
    // The alert is still pending after the reply was sent.
    let settled = false;
    notifyPromise(spy).then(() => { settled = true; });
    await new Promise((r) => setImmediate(r));
    expect(settled).toBe(false);
    release({ webhook: 'skipped', whatsapp: [] });
    await notifyPromise(spy);
    expect(settled).toBe(true);
  });

  test('SHIFT business: the alert fires and the message still joins the reply batch', async () => {
    seedBusiness({}, { business_type: 'shift' });
    axios.post.mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.out' }] } });
    const send = jest.spyOn(alerts, 'sendStaffAlert').mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
    const spy = jest.spyOn(newMessageAlert, 'notifyNewMessages');

    await processInboundMessage(entry([text('مرحبا، كم سعر البوت؟')]));
    await expect(notifyPromise(spy)).resolves.toEqual(['alerted']);
    expect(send).toHaveBeenCalledTimes(1);
    const conv = db.store.conversations.find((c) => c.customer_wa_id === CUSTOMER);
    expect(conv.metadata.batch_due_at).toBeTruthy();
    expect(db.store.messages.find((m) => m.direction === 'inbound').status).toBe('received');
    replyBatcher.cancel(conv.id);
  });

  test('inactive business → no alert', async () => {
    seedBusiness({}, { status: 'inactive' });
    const send = jest.spyOn(alerts, 'sendStaffAlert');
    await processInboundMessage(entry([text('مرحبا')]));
    expect(send).not.toHaveBeenCalled();
  });
});
