/**
 * A customer business's bot reads voice notes, photos and videos (owner, 2026-10-07: «must listen to
 * audio and see photos and videos and respond»), instead of «لا يمكننا معالجة الصور…».
 */
require('./setup');
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');
jest.mock('../src/ai/provider', () => ({ generateValidatedAIReply: jest.fn(), generateAIReply: jest.fn(), resolveModel: () => 'gemini-test' }));
jest.mock('../src/workflows/shift/media', () => ({
  mediaEnabled: jest.fn(() => true),
  readForTenant: jest.fn(),
  enrichBatch: jest.fn(async (b, t, batch) => ({ batch, updates: [] })),
}));

const axios = require('axios');
const db = require('./helpers/fakeDb').getFakeDb();
const provider = require('../src/ai/provider');
const media = require('../src/workflows/shift/media');
const replyBatcher = require('../src/services/replyBatcher');
const { persistInbound, processInboundMessage } = require('../src/services/messageProcessor');
const { encrypt } = require('../src/utils/tokenCrypto');

const PNID = 'pn_tm';
let seq = 0;
const entry = (msg) => ({ changes: [{ value: {
  messaging_product: 'whatsapp', metadata: { phone_number_id: PNID },
  contacts: [{ wa_id: '962791111111', profile: { name: 'محمد' } }],
  messages: [{ id: `wamid.tm${++seq}`, from: '962791111111', timestamp: '1', ...msg }],
} }] });
async function deliver(msg) {
  const e = entry(msg);
  const persisted = await persistInbound(e);
  await processInboundMessage(e, { persisted });
  await new Promise((r) => setImmediate(r));
}
const sentTexts = () => axios.post.mock.calls.map(([, p]) => p && p.text && p.text.body).filter(Boolean);

beforeEach(() => {
  db.reset();
  jest.clearAllMocks();
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.out' }] } });
  db.seed({
    businesses: [{ id: 'biz_g', name: 'صيدلية', business_type: 'generic', status: 'active', wa_phone_number_id: PNID, wa_access_token: encrypt('tok'), ai_config: {} }],
    businessKnowledge: [{ business_id: 'biz_g', kind: 'fact', content: 'عندنا بنادول', active: true }],
  });
  provider.generateValidatedAIReply.mockResolvedValue({ reply: 'أكيد، البنادول متوفر.', action: 'NONE' });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { replyBatcher.cancelAll?.(); jest.restoreAllMocks(); });

test('a photo is read and the bot answers what it shows, with the caption', async () => {
  media.readForTenant.mockResolvedValue({ type: 'image', status: 'ok', text: 'علبة دواء بنادول 500 ملغ', at: 'x', ms: 1 });
  await deliver({ type: 'image', image: { id: 'media1', mime_type: 'image/jpeg', caption: 'عندكم هاد؟' } });

  const [, customerMessage] = provider.generateValidatedAIReply.mock.calls[0];
  expect(customerMessage).toContain('[صورة] عندكم هاد؟');
  expect(customerMessage).toContain('علبة دواء بنادول');
  expect(sentTexts()).toContain('أكيد، البنادول متوفر.');
  expect(sentTexts().join(' ')).not.toContain('لا يمكننا معالجة');
});

test('a voice note is heard', async () => {
  media.readForTenant.mockResolvedValue({ type: 'audio', status: 'ok', text: 'بدي أعرف إذا عندكم بنادول', at: 'x', ms: 1 });
  await deliver({ type: 'audio', audio: { id: 'media2', mime_type: 'audio/ogg' } });
  expect(provider.generateValidatedAIReply.mock.calls[0][1]).toContain('[رسالة صوتية]\nبدي أعرف إذا عندكم بنادول');
});

test('when it cannot be read, the old «send it as text» reply still goes out', async () => {
  media.readForTenant.mockResolvedValue({ type: 'video', status: 'failed', text: null, at: 'x', ms: 1 });
  await deliver({ type: 'video', video: { id: 'media3', mime_type: 'video/mp4' } });
  expect(provider.generateValidatedAIReply).not.toHaveBeenCalled();
  expect(sentTexts().join(' ')).toContain('لا يمكننا معالجة');
});

test('with media switched off nothing is read', async () => {
  media.mediaEnabled.mockReturnValue(false);
  await deliver({ type: 'image', image: { id: 'media4', mime_type: 'image/jpeg' } });
  expect(media.readForTenant).not.toHaveBeenCalled();
  expect(sentTexts().join(' ')).toContain('لا يمكننا معالجة');
});
