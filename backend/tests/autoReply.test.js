/**
 * A customer's WhatsApp away message is stored for staff but answered by nobody (Laraca, 2026-10-08):
 * staff wrote «hi», and four seconds later the customer's phone replied «Thank you for your message. We're
 * unavailable right now, but will respond as soon as possible.»
 *
 * Shape AND timing: an adversarial review showed wording alone silences real people, so the same words
 * minutes after our last message are a person, and are answered.
 */
require('./setup');
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');
jest.mock('../src/ai/provider', () => ({ generateValidatedAIReply: jest.fn(), generateAIReply: jest.fn(), resolveModel: () => 'gemini-test' }));

const axios = require('axios');
const db = require('./helpers/fakeDb').getFakeDb();
const provider = require('../src/ai/provider');
const replyBatcher = require('../src/services/replyBatcher');
const { looksLikeAwayText, withinAwayWindow } = require('../src/services/autoReply');
const { persistInbound, processInboundMessage } = require('../src/services/messageProcessor');
const { encrypt } = require('../src/utils/tokenCrypto');

describe('the away-message shape', () => {
  test.each([
    'Thank you for your message. We’re unavailable right now, but will respond as soon as possible.',
    'Hello! Thanks for contacting us. We are currently out of the office and will get back to you shortly.',
    'شكراً لتواصلك معنا، نحن غير متواجدين حالياً وسيتم الرد عليك في أقرب وقت',
    'شكرًا لتواصلك معنا، سنرد عليك في أقرب وقت',
    'شكـــراً لتواصلك معنا، سنرد عليك في أقرب وقت',
    'هذه رسالة تلقائية: سنرد عليك بأقرب وقت',
    'هلا فيك! حالياً مش موجودين، رح نرجعلك بأسرع وقت 🙏',
    'تم استلام رسالتك بنجاح، سنتواصل معك قريباً.',
    'Our office is closed. We will reply as soon as we can.',
  ])('is an away message: %s', (t) => expect(looksLikeAwayText(t)).toBe(true));

  // Every one of these was silenced by the first version (adversarial review, 2026-10-08).
  test.each([
    'شكرا',
    'ليش ما حدا رد الي؟',
    'ارجو الرد الي باقرب وقت',
    'بدي رد تلقائي لمحلي',
    'هل الرد آلي؟ بدي احكي مع حدا',
    'is it auto-reply or real AI?',
    'I already have an automatic reply in WhatsApp Business, why do I need you?',
    'thanks, I will get back to you tomorrow',
    'I am busy now, will reply later',
    "I'm away this week, will reply when I'm back with the measurements",
    'المقاس 42 غير متاح؟ بدي ياه بأقرب وقت',
    'الدكتور غير متواجد اليوم؟ بدي موعد باقرب وقت',
    'احنا بنسكر الساعة 10 وما في حدا يرد بعدها',
    'مرحبا، شفت العرض تبع الشهر المجاني وبدي أعرف أكثر',
    'Hello! Can I get more info on this?',
    '',
  ])('is a person: %s', (t) => expect(looksLikeAwayText(t)).toBe(false));

  test('timing: within 30 s of our last message only', () => {
    expect(withinAwayWindow(1004000, 1000000)).toBe(true);
    expect(withinAwayWindow(1000000 + 31000, 1000000)).toBe(false);
    expect(withinAwayWindow(1000000 + 5 * 60000, 1000000)).toBe(false);
    expect(withinAwayWindow(1000000, NaN)).toBe(false);
  });
});

describe('the inbound path', () => {
  const PNID = 'pn_ar';
  const AWAY = 'Thank you for your message. We’re unavailable right now, but will respond as soon as possible.';
  let seq = 0;
  const entry = (body, atMs) => ({ changes: [{ value: {
    messaging_product: 'whatsapp', metadata: { phone_number_id: PNID },
    contacts: [{ wa_id: '17868225826', profile: { name: 'Laraca company' } }],
    messages: [{ id: `wamid.ar${++seq}`, from: '17868225826', timestamp: String(Math.floor(atMs / 1000)), type: 'text', text: { body } }],
  } }] });
  async function deliver(body, atMs) {
    const e = entry(body, atMs);
    const persisted = await persistInbound(e);
    await processInboundMessage(e, { persisted });
    await new Promise((r) => setImmediate(r));
  }

  let staffAt;
  beforeEach(() => {
    db.reset();
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.out' }] } });
    staffAt = Date.now();
    db.seed({
      businesses: [{ id: 'biz_g', name: 'محل', business_type: 'generic', status: 'active', wa_phone_number_id: PNID, wa_access_token: encrypt('tok'), ai_config: {} }],
      conversations: [{ id: 'c_lar', business_id: 'biz_g', customer_wa_id: '17868225826', status: 'open', unread_count: 0, last_inbound_at: new Date(staffAt - 8 * 3600e3) }],
      messages: [{ business_id: 'biz_g', conversation_id: 'c_lar', direction: 'outbound', message_type: 'text', text_body: 'hi', status: 'delivered', created_at: new Date(staffAt) }],
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { replyBatcher.cancelAll?.(); jest.restoreAllMocks(); });

  test('an away message seconds after our «hi»: stored for staff, answered by nobody, not the customer writing', async () => {
    await deliver(AWAY, staffAt + 4000);
    const row = db.store.messages.find((m) => m.direction === 'inbound');
    expect(row.message_type).toBe('auto_reply');
    expect(row.status).toBe('skipped');
    expect(row.raw_payload.auto_reply).toBe(true);
    const conv = db.store.conversations.find((c) => c.id === 'c_lar');
    expect(conv.unread_count).toBe(0);
    expect(new Date(conv.last_inbound_at).getTime()).toBe(staffAt - 8 * 3600e3);
    expect(provider.generateValidatedAIReply).not.toHaveBeenCalled();
    expect(axios.post.mock.calls.map((c) => c[1]).filter((p) => p && p.type === 'text')).toHaveLength(0);
  });

  test('the same words minutes later are a person, and are answered', async () => {
    await deliver(AWAY, staffAt + 5 * 60000);
    const row = db.store.messages.find((m) => m.direction === 'inbound');
    expect(row.message_type).toBe('text');
    expect(row.status).not.toBe('skipped');
    expect(axios.post.mock.calls.map((c) => c[1]).filter((p) => p && p.type === 'text').length).toBeGreaterThan(0);
  });

  test('a real message seconds after ours is answered', async () => {
    await deliver('مرحبا، بدي أعرف السعر', staffAt + 3000);
    const row = db.store.messages.find((m) => m.direction === 'inbound');
    expect(row.message_type).toBe('text');
    expect(axios.post.mock.calls.map((c) => c[1]).filter((p) => p && p.type === 'text').length).toBeGreaterThan(0);
  });
});
