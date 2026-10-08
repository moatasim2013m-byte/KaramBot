/**
 * A customer's WhatsApp away message never starts a machine-to-machine loop (Laraca, 2026-10-08).
 *
 * Wording-based detection was rejected after two adversarial reviews (it silenced shop owners answering
 * «شو بيصير بالرسائل بعد الدوام؟» and urgent requests). The rule: the first away message is answered like
 * any message; an exact repeat of a template-length text, seconds after our last message, is a machine.
 */
require('./setup');
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');
jest.mock('../src/ai/provider', () => ({ generateValidatedAIReply: jest.fn(), generateAIReply: jest.fn(), resolveModel: () => 'gemini-test' }));

const axios = require('axios');
const db = require('./helpers/fakeDb').getFakeDb();
const replyBatcher = require('../src/services/replyBatcher');
const autoReply = require('../src/services/autoReply');
const { persistInbound, processInboundMessage } = require('../src/services/messageProcessor');
const { encrypt } = require('../src/utils/tokenCrypto');

const PNID = 'pn_ar';
const AWAY = 'Thank you for your message. We’re unavailable right now, but will respond as soon as possible.';
let seq = 0;
const entry = (body, atMs, extra = {}) => ({ changes: [{ value: {
  messaging_product: 'whatsapp', metadata: { phone_number_id: PNID },
  contacts: [{ wa_id: '17868225826', profile: { name: 'Laraca company' } }],
  messages: [{ id: `wamid.ar${++seq}`, from: '17868225826', timestamp: String(Math.floor(atMs / 1000)), type: 'text', text: { body }, ...extra }],
} }] });
async function deliver(body, atMs, extra) {
  const e = entry(body, atMs, extra);
  const persisted = await persistInbound(e);
  await processInboundMessage(e, { persisted });
  await new Promise((r) => setImmediate(r));
}
const inbound = () => db.store.messages.filter((m) => m.direction === 'inbound').sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
const textSends = () => axios.post.mock.calls.map((c) => c[1]).filter((p) => p && p.type === 'text');
function outboundAt(ms) {
  db.seed({ messages: [{ business_id: 'biz_g', conversation_id: 'c_lar', direction: 'outbound', message_type: 'text', text_body: 'hi', status: 'delivered', created_at: new Date(ms) }] });
}

let t0;
beforeEach(() => {
  db.reset();
  jest.clearAllMocks();
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.out' }] } });
  t0 = Date.now() - 60 * 60000;
  db.seed({
    businesses: [{ id: 'biz_g', name: 'محل', business_type: 'generic', status: 'active', wa_phone_number_id: PNID, wa_access_token: encrypt('tok'), ai_config: {} }],
    conversations: [{ id: 'c_lar', business_id: 'biz_g', customer_wa_id: '17868225826', status: 'open', unread_count: 0, last_inbound_at: new Date(t0 - 3600e3) }],
  });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { replyBatcher.cancelAll?.(); jest.restoreAllMocks(); });

test('the first away message is answered like any message', async () => {
  outboundAt(Date.now());
  await deliver(AWAY, Date.now() + 4000);
  expect(inbound()[0].message_type).toBe('text');
  expect(textSends().length).toBeGreaterThan(0);
});

test('the same away text again, seconds after our reply: stored for staff, answered by nobody', async () => {
  outboundAt(Date.now());
  await deliver(AWAY, Date.now() + 4000);
  // The bot answered it; the customer's phone sends the identical away text seconds later.
  const sendsBefore = textSends().length;
  const windowBefore = db.store.conversations.find((c) => c.id === 'c_lar').last_inbound_at;
  await deliver(AWAY, Date.now() + 3000);
  const second = inbound()[1];
  expect(second.message_type).toBe('auto_reply');
  expect(second.status).toBe('skipped');
  expect(second.raw_payload.auto_reply).toBe(true);
  expect(textSends().length).toBe(sendsBefore);
  const conv = db.store.conversations.find((c) => c.id === 'c_lar');
  expect(conv.last_inbound_at).toEqual(windowBefore);
});

test('a repeat minutes after our message is a person resending, and is answered', async () => {
  outboundAt(Date.now());
  await deliver(AWAY, Date.now() + 4000);
  await deliver(AWAY, Date.now() + 5 * 60000);
  expect(inbound()[1].message_type).toBe('text');
});

test('the ad clicked twice is a person (WhatsApp marks ad clicks with a referral)', async () => {
  const prefill = 'مرحبا، شفت العرض تبع الشهر المجاني وبدي أعرف أكثر';
  const ad = { referral: { source_type: 'ad', source_id: '1', headline: 'SHIFT AI & Automation' } };
  outboundAt(Date.now());
  await deliver(prefill, Date.now() + 4000, ad);
  await deliver(prefill, Date.now() + 3000, ad);
  expect(inbound().map((m) => m.message_type)).toEqual(['text', 'text']);
});

test('a shop owner answering «شو بيصير بالرسائل بعد الدوام؟» in seconds is answered (review 2, 2026-10-08)', async () => {
  outboundAt(Date.now());
  await deliver('احنا مش متواجدين بعد الدوام، بنرد عليهم تاني يوم بأقرب وقت', Date.now() + 8000);
  expect(inbound()[0].message_type).toBe('text');
});

test('helpers: short texts are never templates; spelling noise is the same text', () => {
  expect(autoReply.templateLength('تمام')).toBe(false);
  expect(autoReply.templateLength(AWAY)).toBe(true);
  expect(autoReply.normalizeText('شكـــراً   لتواصلك')).toBe(autoReply.normalizeText('شكرا لتواصلك'));
  expect(autoReply.withinAwayWindow(1004000, 1000000)).toBe(true);
  expect(autoReply.withinAwayWindow(1000000 + 31000, 1000000)).toBe(false);
});
