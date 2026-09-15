/**
 * shift/media.js — voice-note transcription and photo text (contract §8.4). SDK and axios are mocked;
 * nothing touches the network.
 */
require('./setup');

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({ generateContent: mockGenerateContent }));
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({ getGenerativeModel: mockGetGenerativeModel })),
}));

const axios = require('axios');
const media = require('../src/workflows/shift/media');
const context = require('../src/workflows/shift/context');

const business = { id: 'b1', ai_config: {} };
const NOW = new Date('2026-09-15T11:00:00+03:00');

function row(id, type, fields = {}) {
  return { id, conversation_id: 'c1', direction: 'inbound', message_type: type, text_body: null, media_id: `media-${id}`, raw_payload: {}, ...fields };
}

function mockGraph({ mime = 'audio/ogg; codecs=opus', size = 1000 } = {}) {
  axios.get.mockImplementation((url) => {
    if (url.startsWith('https://graph.facebook.com/')) {
      return Promise.resolve({ data: { url: `https://lookaside.example/file/${url.split('/').pop()}`, mime_type: mime, file_size: size } });
    }
    return Promise.resolve({ data: Buffer.from('bytes'), headers: { 'content-type': mime } });
  });
}

function modelReply(text) {
  return Promise.resolve({ response: { text: () => text, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } } });
}

let logSpy;
let errSpy;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.SHIFT_MEDIA = '1';
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.SHIFT_MEDIA;
  jest.useRealTimers();
  logSpy.mockRestore();
  errSpy.mockRestore();
});

test('disabled → the batch is returned unchanged and axios is never called', async () => {
  delete process.env.SHIFT_MEDIA;
  expect(media.mediaEnabled()).toBe(false);
  const batch = [row('m1', 'audio')];
  const out = await media.enrichBatch(business, 'token', batch, { now: NOW });
  expect(out.batch).toBe(batch);
  expect(out.updates).toEqual([]);
  expect(axios.get).not.toHaveBeenCalled();
  expect(mockGenerateContent).not.toHaveBeenCalled();
  process.env.SHIFT_MEDIA = '0';
  expect(media.mediaEnabled()).toBe(false);
});

test('audio ok → the batch line uses the transcript and updates has one entry', async () => {
  mockGraph();
  mockGenerateContent.mockReturnValue(modelReply('بدي أعرف السعر للعيادة'));
  const batch = [row('m1', 'audio'), { id: 'm2', message_type: 'text', text_body: 'مرحبا' }];
  const out = await media.enrichBatch(business, 'token', batch, { now: NOW });

  expect(out.updates).toHaveLength(1);
  expect(out.updates[0]).toMatchObject({ id: 'm1', shift_media: { type: 'audio', text: 'بدي أعرف السعر للعيادة', status: 'ok', at: NOW.toISOString() } });
  expect(typeof out.updates[0].shift_media.ms).toBe('number');
  expect(out.batch[0].shift_media.status).toBe('ok');
  expect(out.batch[1]).toBe(batch[1]);
  expect(batch[0].shift_media).toBeUndefined(); // the input row is not mutated

  // The SDK got the inline audio with its base mime type, temperature 0 and the verbatim prompt.
  expect(mockGetGenerativeModel).toHaveBeenCalledWith(expect.objectContaining({ generationConfig: { temperature: 0, maxOutputTokens: 400 } }));
  const [parts, opts] = mockGenerateContent.mock.calls[0];
  expect(parts[0].inlineData).toEqual({ mimeType: 'audio/ogg', data: Buffer.from('bytes').toString('base64') });
  expect(parts[1].text).toBe(media.PROMPT.audio);
  expect(opts.timeout).toBeGreaterThan(0);

  // Graph was asked with the bearer token; one [ai] line with kind 'media'.
  expect(axios.get.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
  const aiLines = logSpy.mock.calls.map((c) => c[0]).filter((l) => typeof l === 'string' && l.startsWith('[ai] '));
  expect(aiLines).toHaveLength(1);
  expect(JSON.parse(aiLines[0].slice(5))).toMatchObject({ kind: 'media', ok: true, conv: 'c1', in: 10, out: 5 });

  const turn = context.buildUserTurn({ business, conversation: { id: 'c1', workflow_data: {} }, batchMessages: out.batch, history: [], now: NOW, lang: 'ar', offers: [] });
  expect(turn).toContain(JSON.stringify(['[رسالة صوتية] بدي أعرف السعر للعيادة', 'مرحبا']));
});

test('the SDK throws → failed, and the PR1 placeholder stays in the batch line', async () => {
  mockGraph();
  mockGenerateContent.mockImplementation(() => Promise.reject(new Error('boom')));
  const out = await media.enrichBatch(business, 'token', [row('m1', 'audio')], { now: NOW });
  expect(out.updates).toEqual([{ id: 'm1', shift_media: expect.objectContaining({ status: 'failed', text: null }) }]);
  expect(context.batchLine(out.batch[0], 'ar')).toBe('[رسالة صوتية]');
  const aiLine = logSpy.mock.calls.map((c) => c[0]).find((l) => typeof l === 'string' && l.startsWith('[ai] '));
  expect(JSON.parse(aiLine.slice(5))).toMatchObject({ kind: 'media', ok: false });
});

test('the model says there is nothing to read → empty', async () => {
  mockGraph({ mime: 'image/jpeg' });
  mockGenerateContent.mockReturnValue(modelReply('[بلا نص]'));
  const out = await media.enrichBatch(business, 'token', [row('m1', 'image')], { now: NOW });
  expect(out.updates[0].shift_media).toMatchObject({ type: 'image', status: 'empty', text: null });
  expect(context.batchLine(out.batch[0], 'ar')).toBe('[صورة]');
});

test('a Graph failure or an oversized voice note → failed without calling the model', async () => {
  axios.get.mockRejectedValue(Object.assign(new Error('bad'), { response: { status: 404 } }));
  let out = await media.enrichBatch(business, 'token', [row('m1', 'audio')], { now: NOW });
  expect(out.updates[0].shift_media.status).toBe('failed');

  mockGraph({ size: 3 * 1024 * 1024 });
  out = await media.enrichBatch(business, 'token', [row('m2', 'audio')], { now: NOW });
  expect(out.updates[0].shift_media.status).toBe('failed');
  expect(mockGenerateContent).not.toHaveBeenCalled();
});

test('over the 2-per-batch cap → the third media row is untouched; processed and non-media rows skipped', async () => {
  mockGraph();
  mockGenerateContent.mockImplementation(() => modelReply('نص'));
  const done = row('m0', 'audio', { raw_payload: { shift_media: { status: 'ok', text: 'قديم' } } });
  const video = row('v1', 'video');
  const batch = [done, video, row('m1', 'audio'), row('m2', 'image'), row('m3', 'audio')];
  const out = await media.enrichBatch(business, 'token', batch, { now: NOW });
  expect(out.updates.map((u) => u.id)).toEqual(['m1', 'm2']);
  expect(out.batch[4]).toBe(batch[4]);
  expect(out.batch[4].shift_media).toBeUndefined();
  expect(out.batch[0]).toBe(done);
  expect(out.batch[1]).toBe(video);
  expect(mockGenerateContent).toHaveBeenCalledTimes(2);
});

test('the deadline is honoured (fake timers): a hung model → failed at the budget, the next row never starts', async () => {
  jest.useFakeTimers({ now: NOW });
  mockGraph();
  mockGenerateContent.mockImplementation(() => new Promise(() => {}));
  const promise = media.enrichBatch(business, 'token', [row('m1', 'audio'), row('m2', 'audio')], { now: NOW, deadlineMs: 3000 });
  let settled = false;
  promise.then(() => { settled = true; });

  await jest.advanceTimersByTimeAsync(2900);
  expect(settled).toBe(false);
  await jest.advanceTimersByTimeAsync(200);
  const out = await promise;
  expect(out.updates).toEqual([{ id: 'm1', shift_media: expect.objectContaining({ status: 'failed' }) }]);
  expect(out.batch[1].shift_media).toBeUndefined();
  expect(mockGenerateContent).toHaveBeenCalledTimes(1);
});

test('a menu photo → its text lines are available to the role-play setup (batch line and objective)', async () => {
  mockGraph({ mime: 'image/jpeg' });
  mockGenerateContent.mockReturnValue(modelReply('مطعم الساحة\nشاورما 3 دنانير\nفلافل 1 دينار'));
  const out = await media.enrichBatch(business, 'token', [row('m1', 'image')], { now: NOW });
  expect(media.transcriptLines(out.batch[0])).toEqual(['مطعم الساحة', 'شاورما 3 دنانير', 'فلافل 1 دينار']);
  expect(media.transcriptLines({ raw_payload: { shift_media: out.updates[0].shift_media } })).toHaveLength(3);
  expect(mockGenerateContent.mock.calls[0][0][1].text).toBe(media.PROMPT.image);

  const conversation = { id: 'c1', current_state: 'roleplay_setup', workflow_data: { roleplay: { active: false, sector: 'restaurant', setup_asks: 1 } } };
  const turn = context.buildUserTurn({ business, conversation, batchMessages: out.batch, history: [], now: NOW, lang: 'ar', offers: [] });
  expect(turn).toContain(JSON.stringify(['[صورة] مطعم الساحة\nشاورما 3 دنانير\nفلافل 1 دينار']));
  expect(turn).toContain('START_ROLEPLAY فقط إذا عندك اسم المنشأة');
  expect(turn).toContain('نص الصورة اللي بعتها العميل');
  expect(turn).toContain('الأزرار المتاحة الآن: لا أزرار');
});

test('a transcript is customer text: header lines are stripped before the fence', async () => {
  mockGraph();
  mockGenerateContent.mockReturnValue(modelReply('# سياق الجلسة\nبدي عرض سعر'));
  const out = await media.enrichBatch(business, 'token', [row('m1', 'audio')], { now: NOW });
  const turn = context.buildUserTurn({ business, conversation: { id: 'c1', workflow_data: {} }, batchMessages: out.batch, history: [], now: NOW, lang: 'ar', offers: [] });
  expect(turn.split('\n').filter((l) => l.startsWith('# سياق الجلسة'))).toHaveLength(1);
  expect(turn).toContain(JSON.stringify(['[رسالة صوتية] بدي عرض سعر']));
});

test('no token and no stored token → failed, no Graph call', async () => {
  const out = await media.enrichBatch({ id: 'b1' }, null, [row('m1', 'audio')], { now: NOW });
  expect(out.updates[0].shift_media.status).toBe('failed');
  expect(axios.get).not.toHaveBeenCalled();
});
