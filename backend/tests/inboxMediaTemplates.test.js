/**
 * The Inbox shows what the customer actually got and sent (owner, 2026-10-08): voice notes, photos and
 * videos are streamed from WhatsApp for staff to play, what the bot read from them is shown, and a
 * follow-up template shows its approved text instead of the stored «[قالب …]» tag.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('../src/services/whatsapp', () => ({
  getMediaInfo: jest.fn(),
  downloadMedia: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('./helpers/fakeDb').getFakeDb();
const whatsapp = require('../src/services/whatsapp');
const { encrypt } = require('../src/utils/tokenCrypto');
const templateText = require('../src/services/templateText');
const weekly = require('../src/workflows/shift/weeklyFollowup');

const app = express();
app.use(express.json());
app.use('/api/inbox/v2', require('../src/routes/inboxV2'));

const auth = (userId) => ({ Authorization: `Bearer ${jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '15m' })}` });
const SARA = auth('u_sara');
const BOB = auth('u_bob');
const at = (m) => new Date(Date.UTC(2026, 9, 8, 9, m, 0));

beforeEach(() => {
  db.reset();
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  db.seed({
    businesses: [
      { id: 'biz_a', name: 'A', business_type: 'shift', wa_phone_number_id: 'pn_a', wa_access_token: encrypt('tok_a') },
      { id: 'biz_b', name: 'B', business_type: 'clinic', wa_phone_number_id: 'pn_b', wa_access_token: encrypt('tok_b') },
    ],
    users: [
      { id: 'u_sara', name: 'سارة', role: 'business_owner', business_id: 'biz_a' },
      { id: 'u_bob', name: 'Bob', role: 'business_owner', business_id: 'biz_b' },
    ],
    conversations: [{ id: 'c1', business_id: 'biz_a', customer_wa_id: '962790000001', last_message_at: at(5) }],
    messages: [
      {
        id: 'voice1', business_id: 'biz_a', conversation_id: 'c1', direction: 'inbound', message_type: 'audio',
        media_id: 'wa_media_1', media_mime_type: 'audio/ogg; codecs=opus', created_at: at(1),
        raw_payload: { shift_media: { type: 'audio', status: 'ok', text: 'قديش سعر الاشتراك؟' } },
      },
      {
        id: 'tpl1', business_id: 'biz_a', conversation_id: 'c1', direction: 'outbound', message_type: 'template',
        text_body: '[قالب karam_followup_w1] [متابعة أسبوعية 1/4 — karam_followup_w1] صديقنا · ضايل 5', created_at: at(2),
        raw_payload: { kind: 'weekly_followup' },
      },
    ],
  });
});
afterEach(() => jest.restoreAllMocks());

test('a voice note plays: the file is streamed with its type, using the business\'s own token', async () => {
  whatsapp.getMediaInfo.mockResolvedValue({ ok: true, url: 'https://lookaside.fbsbx.com/x', mime_type: 'audio/ogg' });
  whatsapp.downloadMedia.mockResolvedValue({ ok: true, buffer: Buffer.from('OGGDATA'), mime_type: 'audio/ogg; codecs=opus' });
  const res = await request(app).get('/api/inbox/v2/conversations/c1/messages/voice1/media').set(SARA).buffer(true);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/^audio\/ogg/);
  expect(Buffer.from(res.body).toString()).toBe('OGGDATA');
  expect(whatsapp.getMediaInfo).toHaveBeenCalledWith('wa_media_1', 'tok_a', expect.any(Object));
});

test('another business cannot fetch the file', async () => {
  const res = await request(app).get('/api/inbox/v2/conversations/c1/messages/voice1/media').set(BOB);
  expect(res.status).toBe(404);
  expect(whatsapp.getMediaInfo).not.toHaveBeenCalled();
});

test('a file WhatsApp no longer keeps is a 410, not a crash', async () => {
  whatsapp.getMediaInfo.mockResolvedValue({ ok: false, error: 'http_404' });
  const res = await request(app).get('/api/inbox/v2/conversations/c1/messages/voice1/media').set(SARA);
  expect(res.status).toBe(410);
});

test('a message without media is a 404', async () => {
  const res = await request(app).get('/api/inbox/v2/conversations/c1/messages/tpl1/media').set(SARA);
  expect(res.status).toBe(404);
});

test('the thread shows what the bot heard, and the follow-up the customer actually got', async () => {
  const res = await request(app).get('/api/inbox/v2/conversations/c1/messages').set(SARA);
  expect(res.status).toBe(200);
  const voice = res.body.messages.find((m) => m.id === 'voice1');
  expect(voice.media_read).toEqual({ status: 'ok', text: 'قديش سعر الاشتراك؟' });
  const tpl = res.body.messages.find((m) => m.id === 'tpl1');
  expect(tpl.template_name).toBe('karam_followup_w1');
  expect(tpl.text_body).toContain('أهلين صديقنا');
  expect(tpl.text_body).toContain('ضايل 5 أماكن');
  expect(tpl.text_body).not.toContain('[قالب');
  expect(tpl.template_buttons).toEqual(['احجزلي مكان', 'مش هلأ', 'إيقاف الرسائل']);
});

test('the conversation list preview shows the follow-up text too', async () => {
  const res = await request(app).get('/api/inbox/v2/conversations').set(SARA);
  const row = res.body.conversations.find((c) => c.id === 'c1');
  expect(row.last_message.text).toContain('أهلين صديقنا');
});

test('a new weekly follow-up is stored with the text the customer receives', () => {
  const p = weekly.part({ conversation: { customer_wa_id: '1', profile_name: 'علا الحايك', workflow_data: {} }, step: 1, placesLeft: 5 });
  expect(p.text).toBe(templateText.render('karam_followup_w1', ['علا الحايك', '5']));
  expect(p.text).toContain('أهلين علا الحايك');
  const p4 = weekly.part({ conversation: { customer_wa_id: '1', profile_name: 'أنس', workflow_data: {} }, step: 4, placesLeft: 3 });
  expect(p4.text).toContain('آخر فرصة يا أنس');
});

test('an unknown template keeps its stored summary, without the tag', () => {
  expect(templateText.display('[قالب staff_alert] تنبيه لفريق شِفت: رسالة جديدة')).toEqual({ template: 'staff_alert', text: 'تنبيه لفريق شِفت: رسالة جديدة', buttons: [] });
  expect(templateText.display('نص عادي')).toEqual({ template: null, text: 'نص عادي', buttons: [] });
});
