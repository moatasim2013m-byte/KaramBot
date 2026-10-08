/**
 * A customer's WhatsApp away message is not answered (Laraca, 2026-10-08): staff wrote «hi», and four
 * seconds later their phone replied «Thank you for your message. We're unavailable right now, but will
 * respond as soon as possible.» Answering it would talk to a machine that may answer back.
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
const { isAutoReply } = require('../src/services/autoReply');
const { persistInbound, processInboundMessage } = require('../src/services/messageProcessor');
const { encrypt } = require('../src/utils/tokenCrypto');

describe('isAutoReply', () => {
  test.each([
    'Thank you for your message. We’re unavailable right now, but will respond as soon as possible.',
    "Hello! Thanks for contacting us. We are currently out of the office and will get back to you shortly.",
    'شكراً لتواصلك معنا، نحن غير متواجدين حالياً وسيتم الرد عليك في أقرب وقت',
    'هذه رسالة تلقائية: سنرد عليك بأقرب وقت',
    'أهلاً بك! شكرا لرسالتك، سنرد عليك في أقرب وقت ممكن',
    'Our business hours are 9-5. We will reply as soon as we can.',
  ])('an away/greeting message: %s', (t) => expect(isAutoReply(t)).toBe(true));

  test.each([
    'شكرا',
    'thanks, I will get back to you tomorrow',
    'I am busy now, will reply later',
    'مرحبا، شفت العرض تبع الشهر المجاني وبدي أعرف أكثر',
    'Hello! Can I get more info on this?',
    'شكرا لرسالتك، بدي أعرف السعر',
    'we are a clinic, are you available now?',
    'احنا مسكرين يوم الجمعة',
    'unavailable',
    '',
  ])('a person writing: %s', (t) => expect(isAutoReply(t)).toBe(false));
});

describe('the inbound path', () => {
  const PNID = 'pn_ar';
  let seq = 0;
  const entry = (body) => ({ changes: [{ value: {
    messaging_product: 'whatsapp', metadata: { phone_number_id: PNID },
    contacts: [{ wa_id: '17868225826', profile: { name: 'Laraca company' } }],
    messages: [{ id: `wamid.ar${++seq}`, from: '17868225826', timestamp: '1', type: 'text', text: { body } }],
  } }] });
  async function deliver(body) {
    const e = entry(body);
    const persisted = await persistInbound(e);
    await processInboundMessage(e, { persisted });
    await new Promise((r) => setImmediate(r));
  }

  beforeEach(() => {
    db.reset();
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.out' }] } });
    db.seed({ businesses: [{ id: 'biz_g', name: 'محل', business_type: 'generic', status: 'active', wa_phone_number_id: PNID, wa_access_token: encrypt('tok'), ai_config: {} }] });
    provider.generateValidatedAIReply.mockResolvedValue({ reply: 'أهلين', action: 'NONE' });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { replyBatcher.cancelAll?.(); jest.restoreAllMocks(); });

  test('an away message is kept, marked, and answered by nobody', async () => {
    await deliver('Thank you for your message. We’re unavailable right now, but will respond as soon as possible.');
    const row = db.store.messages.find((m) => m.direction === 'inbound');
    expect(row.status).toBe('skipped');
    expect(row.raw_payload.auto_reply).toBe(true);
    expect(provider.generateValidatedAIReply).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('a real message is still answered', async () => {
    await deliver('مرحبا، بدي أعرف السعر');
    const row = db.store.messages.find((m) => m.direction === 'inbound');
    expect(row.status).not.toBe('skipped');
    expect(row.raw_payload && row.raw_payload.auto_reply).toBeFalsy();
    const sends = axios.post.mock.calls.map((c) => c[1]).filter((p) => p && p.type === 'text');
    expect(sends.length).toBeGreaterThan(0);
  });
});
