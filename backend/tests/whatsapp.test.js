/**
 * services/whatsapp.js: Graph version at call time, typing indicator, interactive limits,
 * and the never-throwing structured senders with their error classification.
 */
require('./setup');

jest.mock('axios');
const axios = require('axios');

const wa = require('../src/services/whatsapp');
const serviceWindow = require('../src/utils/serviceWindow');

const axiosError = ({ status, graph, code, request = true } = {}) => {
  const err = new Error(graph?.message || code || `HTTP ${status}`);
  if (code) err.code = code;
  if (request) err.request = {};
  if (status) err.response = { status, data: graph ? { error: graph } : {} };
  return err;
};

beforeEach(() => {
  axios.post.mockReset();
  delete process.env.GRAPH_API_VERSION;
  delete process.env.WA_TYPING_INDICATOR;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.GRAPH_API_VERSION;
  delete process.env.WA_TYPING_INDICATOR;
});

describe('Graph version', () => {
  test('1. defaults to v24.0 and reads GRAPH_API_VERSION on every call', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.1' }] } });

    expect(wa.graphVersion()).toBe('v24.0');
    await wa.sendText('PNID', 'TOKEN', '962790000000', 'مرحبا');
    expect(axios.post.mock.calls[0][0]).toBe('https://graph.facebook.com/v24.0/PNID/messages');

    process.env.GRAPH_API_VERSION = 'v25.0';
    expect(wa.graphBase()).toBe('https://graph.facebook.com/v25.0');
    await wa.sendTextMessage('PNID', 'TOKEN', '962790000000', 'مرحبا');
    expect(axios.post.mock.calls[1][0]).toBe('https://graph.facebook.com/v25.0/PNID/messages');
  });
});

describe('markAsRead', () => {
  test('2. typing indicator only with typing:true and WA_TYPING_INDICATOR=1', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { success: true } });

    await wa.markAsRead('PNID', 'TOKEN', 'wamid.in', { typing: true });
    expect(axios.post.mock.calls[0][1]).toEqual({ messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.in' });

    process.env.WA_TYPING_INDICATOR = '1';
    await wa.markAsRead('PNID', 'TOKEN', 'wamid.in');
    expect(axios.post.mock.calls[1][1]).not.toHaveProperty('typing_indicator');

    await expect(wa.markAsRead('PNID', 'TOKEN', 'wamid.in', { typing: true })).resolves.toBe(true);
    expect(axios.post.mock.calls[2][1]).toEqual({
      messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.in', typing_indicator: { type: 'text' },
    });
  });

  test('never throws', async () => {
    axios.post.mockRejectedValue(axiosError({ status: 500 }));
    await expect(wa.markAsRead('PNID', 'TOKEN', 'wamid.in', { typing: true })).resolves.toBe(false);
  });
});

describe('legacy senders on the webhook path (D24)', () => {
  test('sendTextMessage and markAsRead time out well under the 2 min stuck-row re-run', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.l' }] } });
    await wa.sendTextMessage('PNID', 'TOKEN', '962790000000', 'مرحبا');
    await wa.markAsRead('PNID', 'TOKEN', 'wamid.in');
    for (const [, , config] of axios.post.mock.calls) {
      expect(config.timeout).toBeGreaterThan(0);
      expect(config.timeout).toBeLessThanOrEqual(30000);
    }
  });
});

describe('assertInteractiveLimits', () => {
  const ok = [{ id: 'a', title: 'أ' }];
  const expectLimits = (fn) => {
    let thrown;
    try { fn(); } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.code).toBe('INTERACTIVE_LIMITS');
  };

  test('3. rejects 4 buttons, a 21-code-point title, duplicate ids and a 1025-char body', () => {
    const four = [1, 2, 3, 4].map((i) => ({ id: `b${i}`, title: `زر ${i}` }));
    expectLimits(() => wa.assertInteractiveLimits(four, { body: 'نص' }));
    expectLimits(() => wa.assertInteractiveLimits([{ id: 'a', title: 'ا'.repeat(21) }], { body: 'نص' }));
    expectLimits(() => wa.assertInteractiveLimits([{ id: 'a', title: 'أ' }, { id: 'a', title: 'ب' }], { body: 'نص' }));
    expectLimits(() => wa.assertInteractiveLimits(ok, { body: 'x'.repeat(1025) }));
  });

  test('rejects empty arrays, empty/long ids, empty body and a long footer', () => {
    expectLimits(() => wa.assertInteractiveLimits([], { body: 'نص' }));
    expectLimits(() => wa.assertInteractiveLimits('nope', { body: 'نص' }));
    expectLimits(() => wa.assertInteractiveLimits([{ id: '', title: 'أ' }], { body: 'نص' }));
    expectLimits(() => wa.assertInteractiveLimits([{ id: 'x'.repeat(257), title: 'أ' }], { body: 'نص' }));
    expectLimits(() => wa.assertInteractiveLimits([{ id: 'a', title: '' }], { body: 'نص' }));
    expectLimits(() => wa.assertInteractiveLimits(ok));
    expectLimits(() => wa.assertInteractiveLimits(ok, { body: 'نص', footer: 'f'.repeat(61) }));
  });

  test('accepts «اليوم 4–6», a 20-code-point title, a 1024-char body and a 60-char footer', () => {
    expect(() => wa.assertInteractiveLimits([
      { id: 'slot:2026-09-14T16:00+03:00/18:00', title: 'اليوم 4–6' },
      { id: 'b', title: 'ا'.repeat(20) },
      { id: 'x'.repeat(256), title: '👍'.repeat(20) },
    ], { body: 'x'.repeat(1024), footer: 'f'.repeat(60) })).not.toThrow();
  });

  test('legacy sendButtonMessage throws on a broken limit before any HTTP call', async () => {
    await expect(wa.sendButtonMessage('PNID', 'TOKEN', '962790000000', 'نص', [{ title: 'ا'.repeat(21) }]))
      .rejects.toMatchObject({ code: 'INTERACTIVE_LIMITS' });
    await expect(wa.sendListMessage('PNID', 'TOKEN', '962790000000', '', 'اختر', []))
      .rejects.toMatchObject({ code: 'INTERACTIVE_LIMITS' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('legacy sendButtonMessage keeps its payload and btn_i ids', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.b' }] } });
    const data = await wa.sendButtonMessage('PNID', 'TOKEN', '962790000000', 'نص', [{ title: 'نعم' }, { id: 'no', title: 'لا' }]);
    expect(data).toEqual({ messages: [{ id: 'wamid.b' }] });
    expect(axios.post.mock.calls[0][1].interactive.action.buttons).toEqual([
      { type: 'reply', reply: { id: 'btn_0', title: 'نعم' } },
      { type: 'reply', reply: { id: 'no', title: 'لا' } },
    ]);
  });
});

describe('structured senders', () => {
  test('4. sendText ok → {ok:true, id}', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.ok' }] } });

    const result = await wa.sendText('PNID', 'TOKEN', '962790000000', 'مرحبا', { timeoutMs: 4000 });

    expect(result).toEqual({ ok: true, id: 'wamid.ok', error: null, reason: null, code: null, httpStatus: 200, retryable: false });
    const [, payload, config] = axios.post.mock.calls[0];
    expect(payload).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '962790000000', type: 'text', text: { body: 'مرحبا' },
    });
    expect(config.timeout).toBe(4000);
    expect(config.headers.Authorization).toBe('Bearer TOKEN');
  });

  test('sendText uses a 10 s timeout by default', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.ok' }] } });
    await wa.sendText('PNID', 'TOKEN', '962790000000', 'مرحبا');
    expect(axios.post.mock.calls[0][2].timeout).toBe(10000);
  });

  test('5. Graph code 131042 → billing, not retryable, never throws', async () => {
    axios.post.mockRejectedValue(axiosError({ status: 400, graph: { code: 131042, message: 'Business eligibility payment issue' } }));

    const result = await wa.sendText('PNID', 'TOKEN', '962790000000', 'مرحبا');

    expect(result).toEqual({
      ok: false, id: null, error: 'Business eligibility payment issue', reason: 'billing', code: 131042, httpStatus: 400, retryable: false,
    });
  });

  test('6. ECONNABORTED → ambiguous, not retryable', async () => {
    axios.post.mockRejectedValue(axiosError({ code: 'ECONNABORTED' }));
    const result = await wa.sendText('PNID', 'TOKEN', '962790000000', 'مرحبا');
    expect(result).toMatchObject({ ok: false, reason: 'ambiguous', retryable: false, httpStatus: null, code: null });
  });

  test('7. GPT-6 #4: a generic HTTP 5xx may hide an accepted message → ambiguous, never retried at once', async () => {
    // An intermediary can answer 502/503 after Graph accepted the POST; a resend could reach the customer twice.
    for (const status of [500, 502, 503, 504]) {
      axios.post.mockReset().mockRejectedValue(axiosError({ status }));
      const result = await wa.sendText('PNID', 'TOKEN', '962790000000', 'مرحبا');
      expect(result).toMatchObject({ ok: false, reason: 'ambiguous', retryable: false, httpStatus: status });
    }
  });

  test('GPT-6 #4: documented rejection codes stay proven rejections even on a 5xx; only pre-request errors retry', async () => {
    expect(wa.classifySendError(axiosError({ status: 503, graph: { code: 130429 } }))).toMatchObject({ reason: 'rate_limit', retryable: false });
    expect(wa.classifySendError(axiosError({ code: 'ECONNREFUSED' }))).toMatchObject({ reason: 'network', retryable: true });
    expect(wa.classifySendError(axiosError({ status: 400, graph: { code: 100 } }))).toMatchObject({ reason: 'rejected', retryable: false });
  });

  test('classifySendError covers every row of the table', () => {
    const c = wa.classifySendError;
    expect(c(axiosError({ status: 400, graph: { code: 100, error_subcode: 2494010 } }))).toMatchObject({ reason: 'billing', retryable: false });
    expect(c(axiosError({ status: 400, graph: { code: 131047 } }))).toMatchObject({ reason: 'window', retryable: false });
    for (const code of [130429, 131056, 80007]) {
      expect(c(axiosError({ status: 400, graph: { code } }))).toMatchObject({ reason: 'rate_limit', retryable: false });
    }
    for (const code of [131026, 131030]) {
      expect(c(axiosError({ status: 400, graph: { code } }))).toMatchObject({ reason: 'invalid_recipient', retryable: false });
    }
    expect(c(axiosError({ status: 400, graph: { code: 190 } }))).toMatchObject({ reason: 'auth', code: 190 });
    expect(c(axiosError({ status: 401 }))).toMatchObject({ reason: 'auth', retryable: false });
    expect(c(axiosError({ status: 403 }))).toMatchObject({ reason: 'auth' });
    expect(c(axiosError({ code: 'ETIMEDOUT' }))).toMatchObject({ reason: 'ambiguous', retryable: false });
    expect(c(axiosError({ code: 'ECONNRESET' }))).toMatchObject({ reason: 'ambiguous' });
    expect(c(axiosError({}))).toMatchObject({ reason: 'ambiguous' }); // request sent, no response
    for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN']) {
      expect(c(axiosError({ code }))).toMatchObject({ reason: 'network', retryable: true });
    }
    expect(c(axiosError({ status: 500 }))).toMatchObject({ reason: 'ambiguous', retryable: false });
    expect(c(axiosError({ status: 400, graph: { code: 100 } }))).toMatchObject({ reason: 'rejected', retryable: false, code: 100 });
    expect(c(new Error('weird'))).toMatchObject({ reason: 'rejected', code: null, httpStatus: null });
  });

  test('8. sendInteractiveButtons payload matches the plan slot JSON', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.slots' }] } });
    const buttons = [
      { id: 'slot:2026-09-14T16:00+03:00/18:00', title: 'اليوم 4–6' },
      { id: 'slot:2026-09-15T10:00+03:00/12:00', title: 'بكرا 10–12' },
      { id: 'slot:other', title: 'وقت ثاني' },
    ];

    const result = await wa.sendInteractiveButtons('PNID', 'TOKEN', '9627XXXXXXXX', 'أقرب أوقات الفريق:', buttons);

    expect(result).toMatchObject({ ok: true, id: 'wamid.slots' });
    expect(axios.post.mock.calls[0][1]).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '9627XXXXXXXX',
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'أقرب أوقات الفريق:' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'slot:2026-09-14T16:00+03:00/18:00', title: 'اليوم 4–6' } },
            { type: 'reply', reply: { id: 'slot:2026-09-15T10:00+03:00/12:00', title: 'بكرا 10–12' } },
            { type: 'reply', reply: { id: 'slot:other', title: 'وقت ثاني' } },
          ],
        },
      },
    });
  });

  test('sendInteractiveButtons returns invalid_payload without HTTP on a limits error', async () => {
    const result = await wa.sendInteractiveButtons('PNID', 'TOKEN', '962790000000', 'نص', [{ id: 'a', title: 'ا'.repeat(21) }]);
    expect(result).toMatchObject({ ok: false, id: null, reason: 'invalid_payload', retryable: false, code: null, httpStatus: null });
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('biz_opaque_callback_data (D17)', () => {
  beforeEach(() => {
    axios.post.mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.cb' }] } });
  });

  test('sendText and sendInteractiveButtons send the intent id as a top-level string field', async () => {
    await wa.sendText('PNID', 'TOKEN', '962790000000', 'مرحبا', { callbackData: 'cintent01' });
    expect(axios.post.mock.calls[0][1]).toMatchObject({ type: 'text', biz_opaque_callback_data: 'cintent01' });

    await wa.sendInteractiveButtons('PNID', 'TOKEN', '962790000000', 'نص', [{ id: 'a', title: 'أ' }], { callbackData: 'cintent02' });
    expect(axios.post.mock.calls[1][1]).toMatchObject({ type: 'interactive', biz_opaque_callback_data: 'cintent02' });
  });

  test('legacy senders accept it too; absent → the payload is unchanged', async () => {
    await wa.sendTextMessage('PNID', 'TOKEN', '962790000000', 'مرحبا', { callbackData: 'c3' });
    expect(axios.post.mock.calls[0][1].biz_opaque_callback_data).toBe('c3');
    await wa.sendButtonMessage('PNID', 'TOKEN', '962790000000', 'نص', [{ title: 'نعم' }], { callbackData: 'c4' });
    expect(axios.post.mock.calls[1][1].biz_opaque_callback_data).toBe('c4');
    await wa.sendListMessage('PNID', 'TOKEN', '962790000000', 'نص', 'اختر', [], { callbackData: 'c5' });
    expect(axios.post.mock.calls[2][1].biz_opaque_callback_data).toBe('c5');
    await wa.sendTemplateMessage('PNID', 'TOKEN', '962790000000', 'hello', 'ar', [], { callbackData: 'c6' });
    expect(axios.post.mock.calls[3][1].biz_opaque_callback_data).toBe('c6');

    await wa.sendText('PNID', 'TOKEN', '962790000000', 'مرحبا');
    expect(axios.post.mock.calls[4][1]).not.toHaveProperty('biz_opaque_callback_data');
  });

  test('a value over 512 characters is not sent (a cut id would correlate with nothing)', async () => {
    await wa.sendText('PNID', 'TOKEN', '962790000000', 'مرحبا', { callbackData: 'x'.repeat(513) });
    expect(axios.post.mock.calls[0][1]).not.toHaveProperty('biz_opaque_callback_data');
  });
});

// ─── PR2 structured parts (contract §4) ──────────────────────────────────────

const TO = '9627XXXXXXXX';
const SAMPLE_BUTTONS = [
  { id: 'sample_roleplay:restaurant', title: 'جرّبه كزبون' },
  { id: 'sample_page:restaurant', title: 'افتح صفحة المطاعم' },
  { id: 'lead_talk', title: 'احكي مع الفريق' },
];
const SAMPLE_CARD = {
  type: 'interactive',
  text: 'مثال توضيحي (مش زبون حقيقي) 👇 كافيه زيتون، الساعة 11 بالليل: …',
  header: { type: 'image', image: { link: 'https://shifts-ai.com/assets/samples/restaurant-square-v1.png' } },
  footer: 'مثال توضيحي · شِفت',
  buttons: SAMPLE_BUTTONS,
  modelLine: 'metadata', ack: 'metadata', serverButtons: true, delayMs: 0,
};
const SAMPLE_CARD_JSON = {
  messaging_product: 'whatsapp', recipient_type: 'individual', to: TO, type: 'interactive',
  biz_opaque_callback_data: 'intent-1',
  interactive: {
    type: 'button',
    header: { type: 'image', image: { link: 'https://shifts-ai.com/assets/samples/restaurant-square-v1.png' } },
    body: { text: 'مثال توضيحي (مش زبون حقيقي) 👇 كافيه زيتون، الساعة 11 بالليل: …' },
    footer: { text: 'مثال توضيحي · شِفت' },
    action: {
      buttons: [
        { type: 'reply', reply: { id: 'sample_roleplay:restaurant', title: 'جرّبه كزبون' } },
        { type: 'reply', reply: { id: 'sample_page:restaurant', title: 'افتح صفحة المطاعم' } },
        { type: 'reply', reply: { id: 'lead_talk', title: 'احكي مع الفريق' } },
      ],
    },
  },
};
const CTA_PART = {
  type: 'cta_url',
  header: { type: 'text', text: 'كرم للمطاعم' },
  text: 'صفحة المطاعم فيها محاكاة كاملة لمحادثة طلب، وتقدر تغيّر اسم المطعم فيها. بتفتح بالمتصفح.',
  footer: 'شِفت · إربد',
  displayText: 'افتح الصفحة',
  url: 'https://shifts-ai.com/restaurants?utm_source=wa&utm_medium=bot&utm_campaign=karam-restaurant',
};
const CTA_JSON = {
  messaging_product: 'whatsapp', recipient_type: 'individual', to: TO, type: 'interactive',
  biz_opaque_callback_data: 'intent-1',
  interactive: {
    type: 'cta_url',
    header: { type: 'text', text: 'كرم للمطاعم' },
    body: { text: 'صفحة المطاعم فيها محاكاة كاملة لمحادثة طلب، وتقدر تغيّر اسم المطعم فيها. بتفتح بالمتصفح.' },
    footer: { text: 'شِفت · إربد' },
    action: {
      name: 'cta_url',
      parameters: {
        display_text: 'افتح الصفحة',
        url: 'https://shifts-ai.com/restaurants?utm_source=wa&utm_medium=bot&utm_campaign=karam-restaurant',
      },
    },
  },
};
const LIST_PART = {
  type: 'list',
  text: 'شو نوع شغلك؟',
  buttonLabel: 'اختر القطاع',
  sections: [{
    title: 'القطاعات',
    rows: [
      { id: 'sector:clinic', title: 'عيادة' },
      { id: 'sector:restaurant', title: 'مطعم أو كافيه' },
      { id: 'sector:store', title: 'متجر إلكتروني' },
      { id: 'sector:other', title: 'نشاط آخر', description: 'صالون، جيم، مركز أطفال، عقارات…' },
    ],
  }],
};
const LIST_JSON = {
  messaging_product: 'whatsapp', recipient_type: 'individual', to: TO, type: 'interactive',
  biz_opaque_callback_data: 'intent-1',
  interactive: {
    type: 'list',
    body: { text: 'شو نوع شغلك؟' },
    action: {
      button: 'اختر القطاع',
      sections: [{
        title: 'القطاعات',
        rows: [
          { id: 'sector:clinic', title: 'عيادة' },
          { id: 'sector:restaurant', title: 'مطعم أو كافيه' },
          { id: 'sector:store', title: 'متجر إلكتروني' },
          { id: 'sector:other', title: 'نشاط آخر', description: 'صالون، جيم، مركز أطفال، عقارات…' },
        ],
      }],
    },
  },
};
const IMAGE_PART = {
  type: 'image',
  image: { link: 'https://shifts-ai.com/assets/samples/clinic-square-v1.png' },
  text: 'مثال توضيحي 👇 …',
};
const IMAGE_JSON = {
  messaging_product: 'whatsapp', recipient_type: 'individual', to: TO, type: 'image',
  biz_opaque_callback_data: 'intent-1',
  image: { link: 'https://shifts-ai.com/assets/samples/clinic-square-v1.png', caption: 'مثال توضيحي 👇 …' },
};
const withoutCallback = ({ biz_opaque_callback_data: _omit, ...rest }) => rest;

describe('PR2 payload builders (§4.2)', () => {
  test('1. each builder deep-equals the contract JSON with callbackData', () => {
    const cb = { callbackData: 'intent-1' };
    expect(wa.buildButtonsPayload(TO, SAMPLE_CARD, cb)).toEqual(SAMPLE_CARD_JSON);
    expect(wa.buildCtaUrlPayload(TO, CTA_PART, cb)).toEqual(CTA_JSON);
    expect(wa.buildListPayload(TO, LIST_PART, cb)).toEqual(LIST_JSON);
    expect(wa.buildImagePayload(TO, { image: IMAGE_PART.image, caption: IMAGE_PART.text }, cb)).toEqual(IMAGE_JSON);
  });

  test('1b. callbackData absent or over 512 characters → key omitted', () => {
    for (const opts of [undefined, {}, { callbackData: '' }, { callbackData: 'x'.repeat(513) }]) {
      expect(wa.buildButtonsPayload(TO, SAMPLE_CARD, opts)).toEqual(withoutCallback(SAMPLE_CARD_JSON));
      expect(wa.buildCtaUrlPayload(TO, CTA_PART, opts)).toEqual(withoutCallback(CTA_JSON));
      expect(wa.buildListPayload(TO, LIST_PART, opts)).toEqual(withoutCallback(LIST_JSON));
      expect(wa.buildImagePayload(TO, { image: IMAGE_PART.image, caption: IMAGE_PART.text }, opts)).toEqual(withoutCallback(IMAGE_JSON));
    }
    expect(wa.buildButtonsPayload(TO, SAMPLE_CARD, { callbackData: 'x'.repeat(512) }).biz_opaque_callback_data).toHaveLength(512);
  });

  test('buttons without header or footer keep the PR1 shape', () => {
    const plain = wa.buildButtonsPayload(TO, { text: 'نص', buttons: [{ id: 'a', title: 'أ' }] });
    expect(plain.interactive).toEqual({
      type: 'button', body: { text: 'نص' }, action: { buttons: [{ type: 'reply', reply: { id: 'a', title: 'أ' } }] },
    });
  });

  test('2. image header and plain image with a media id instead of a link', () => {
    const card = wa.buildButtonsPayload(TO, { ...SAMPLE_CARD, header: { type: 'image', image: { id: '1234567890' } } });
    expect(card.interactive.header).toEqual({ type: 'image', image: { id: '1234567890' } });
    expect(wa.buildImagePayload(TO, { image: { id: '42' } }).image).toEqual({ id: '42' });
    expect(() => wa.assertStructuredLimits({ ...SAMPLE_CARD, header: { type: 'image', image: { id: '1234567890' } } })).not.toThrow();
  });
});

describe('assertStructuredLimits (§1.4)', () => {
  const expectLimits = (part) => {
    let thrown;
    try { wa.assertStructuredLimits(part); } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.code).toBe('INTERACTIVE_LIMITS');
  };
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, title: `صف ${i}` }));

  test('the contract parts pass', () => {
    for (const part of [SAMPLE_CARD, CTA_PART, LIST_PART, IMAGE_PART, { type: 'text', text: 'مرحبا' }]) {
      expect(() => wa.assertStructuredLimits(part)).not.toThrow();
    }
  });

  test('3. rejects every limit named in §4.4', () => {
    expectLimits({ ...SAMPLE_CARD, buttons: [{ id: 'a', title: 'ا'.repeat(21) }] });
    expectLimits({ ...SAMPLE_CARD, buttons: [...SAMPLE_BUTTONS, { id: 'x', title: 'رابع' }] });
    expectLimits({ ...LIST_PART, sections: [{ title: 'ق', rows: rows(11) }] });
    expectLimits({ ...LIST_PART, sections: [{ title: 'ق', rows: [{ id: 'a', title: 'ا'.repeat(25) }] }] });
    expectLimits({ ...LIST_PART, sections: [{ title: 'ق', rows: [{ id: 'a', title: 'أ', description: 'ا'.repeat(73) }] }] });
    expectLimits({ ...CTA_PART, displayText: 'ا'.repeat(21) });
    expectLimits({ ...CTA_PART, url: 'http://shifts-ai.com/restaurants' });
    expectLimits({ ...SAMPLE_CARD, footer: 'ا'.repeat(61) });
    expectLimits({ ...SAMPLE_CARD, text: 'ا'.repeat(1025) });
  });

  test('boundaries pass: 24-cp row title, 72-cp description, 10 rows, 20-cp label, 60-cp header', () => {
    expect(() => wa.assertStructuredLimits({
      ...LIST_PART,
      buttonLabel: 'ا'.repeat(20),
      header: { type: 'text', text: 'ا'.repeat(60) },
      sections: [{ title: 'ق', rows: [{ id: 'a', title: 'ا'.repeat(24), description: 'ا'.repeat(72) }, ...rows(9)] }],
    })).not.toThrow();
    expect(() => wa.assertStructuredLimits({ type: 'text', text: 'ا'.repeat(4096) })).not.toThrow();
    expect(() => wa.assertStructuredLimits({ ...IMAGE_PART, text: 'ا'.repeat(1024) })).not.toThrow();
  });

  test('other rejections: long text body, caption, header, label, empty parts, unknown type', () => {
    expectLimits({ type: 'text', text: 'ا'.repeat(4097) });
    expectLimits({ type: 'text', text: '   ' });
    expectLimits({ ...IMAGE_PART, text: 'ا'.repeat(1025) });
    expectLimits({ ...IMAGE_PART, image: { link: 'http://x.com/a.png' } });
    expectLimits({ ...IMAGE_PART, image: {} });
    expectLimits({ ...SAMPLE_CARD, header: { type: 'text', text: 'ا'.repeat(61) } });
    expectLimits({ ...SAMPLE_CARD, header: { type: 'video', video: { link: 'https://x.com/v.mp4' } } });
    expectLimits({ ...CTA_PART, header: { type: 'image', image: { link: 'https://x.com/a.png' } } });
    expectLimits({ ...LIST_PART, buttonLabel: 'ا'.repeat(21) });
    expectLimits({ ...LIST_PART, sections: [] });
    expectLimits({ ...LIST_PART, sections: [{ title: 'أ', rows: [{ id: 'a', title: 'أ' }] }, { rows: [{ id: 'b', title: 'ب' }] }] });
    expectLimits({ ...LIST_PART, sections: [{ title: 'أ', rows: [{ id: 'a', title: 'أ' }, { id: 'a', title: 'ب' }] }] });
    expectLimits({ ...CTA_PART, text: '' });
    expectLimits({ type: 'carousel', text: 'x' });
    expectLimits(null);
  });
});

describe('PR2 senders', () => {
  beforeEach(() => {
    axios.post.mockResolvedValue({ status: 200, data: { messages: [{ id: 'wamid.pr2' }] } });
  });

  test('4. sendStructured dispatches all five types with callbackData and never sends metadata', async () => {
    const opts = { callbackData: 'intent-1' };
    const parts = [
      [{ type: 'text', text: 'مرحبا', modelLine: 'مرحبا', delayMs: 0 },
        { messaging_product: 'whatsapp', recipient_type: 'individual', to: TO, type: 'text', text: { body: 'مرحبا' }, biz_opaque_callback_data: 'intent-1' }],
      [{ ...SAMPLE_CARD, fallback: { type: 'text', text: 'x' } }, SAMPLE_CARD_JSON],
      [LIST_PART, LIST_JSON],
      [CTA_PART, CTA_JSON],
      [IMAGE_PART, IMAGE_JSON],
    ];
    for (const [i, [part, json]] of parts.entries()) {
      const result = await wa.sendStructured('PNID', 'TOKEN', TO, part, opts);
      expect(result).toEqual({ ok: true, id: 'wamid.pr2', error: null, reason: null, code: null, httpStatus: 200, retryable: false });
      const [url, payload, config] = axios.post.mock.calls[i];
      expect(url).toBe('https://graph.facebook.com/v24.0/PNID/messages');
      expect(payload).toEqual(json);
      expect(config.timeout).toBe(10000);
      expect(config.headers.Authorization).toBe('Bearer TOKEN');
    }
  });

  test('4b. limits and unknown types → invalid_payload without HTTP', async () => {
    const bad = [
      { ...SAMPLE_CARD, buttons: [{ id: 'a', title: 'ا'.repeat(21) }] },
      { ...LIST_PART, sections: [{ title: 'ق', rows: Array.from({ length: 11 }, (_, i) => ({ id: `r${i}`, title: 'ص' })) }] },
      { ...CTA_PART, url: 'http://x.com' },
      { ...IMAGE_PART, image: { link: 'ftp://x' } },
      { type: 'text', text: '' },
      { type: 'sticker' },
      undefined,
    ];
    for (const part of bad) {
      const result = await wa.sendStructured('PNID', 'TOKEN', TO, part, { callbackData: 'intent-1' });
      expect(result).toEqual(expect.objectContaining({ ok: false, id: null, reason: 'invalid_payload', retryable: false, code: null, httpStatus: null }));
    }
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('the typed senders accept timeoutMs and set their own type', async () => {
    await wa.sendButtons('PNID', 'TOKEN', TO, { ...SAMPLE_CARD, type: undefined }, { timeoutMs: 3000, callbackData: 'intent-1' });
    expect(axios.post.mock.calls[0][1]).toEqual(SAMPLE_CARD_JSON);
    expect(axios.post.mock.calls[0][2].timeout).toBe(3000);
    await wa.sendList('PNID', 'TOKEN', TO, LIST_PART, { callbackData: 'intent-1' });
    await wa.sendCtaUrl('PNID', 'TOKEN', TO, CTA_PART, { callbackData: 'intent-1' });
    await wa.sendImage('PNID', 'TOKEN', TO, IMAGE_PART);
    expect(axios.post.mock.calls[1][1]).toEqual(LIST_JSON);
    expect(axios.post.mock.calls[2][1]).toEqual(CTA_JSON);
    expect(axios.post.mock.calls[3][1]).toEqual(withoutCallback(IMAGE_JSON));
  });

  test('5. Graph 400 code 131009 on an image header → rejected (PR1 classification), never throws', async () => {
    axios.post.mockReset().mockRejectedValue(axiosError({ status: 400, graph: { code: 131009, message: '(#131009) Parameter value is not valid' } }));
    const result = await wa.sendStructured('PNID', 'TOKEN', TO, SAMPLE_CARD, { callbackData: 'intent-1' });
    expect(result).toEqual({
      ok: false, id: null, error: '(#131009) Parameter value is not valid', reason: 'rejected', code: 131009, httpStatus: 400, retryable: false,
    });
  });

  test('a timeout on a structured part stays ambiguous (D18)', async () => {
    axios.post.mockReset().mockRejectedValue(axiosError({ code: 'ECONNABORTED' }));
    await expect(wa.sendStructured('PNID', 'TOKEN', TO, CTA_PART)).resolves.toMatchObject({ ok: false, reason: 'ambiguous', retryable: false });
  });
});

describe('partSummary (§4.3)', () => {
  test('6. every row in Arabic', () => {
    expect(wa.partSummary({ type: 'text', text: 'مرحبا' })).toEqual({ message_type: 'text', text_body: 'مرحبا' });
    expect(wa.partSummary(SAMPLE_CARD)).toEqual({
      message_type: 'interactive',
      text_body: '[صورة] مثال توضيحي (مش زبون حقيقي) 👇 كافيه زيتون، الساعة 11 بالليل: …\n[جرّبه كزبون] [افتح صفحة المطاعم] [احكي مع الفريق]',
    });
    expect(wa.partSummary({ type: 'interactive', text: 'أقرب أوقات الفريق:', buttons: [{ id: 'a', title: 'بكرا 10–12' }, { id: 'b', title: 'وقت ثاني' }] }))
      .toEqual({ message_type: 'interactive', text_body: 'أقرب أوقات الفريق:\n[بكرا 10–12] [وقت ثاني]' });
    expect(wa.partSummary(LIST_PART)).toEqual({
      message_type: 'interactive',
      text_body: 'شو نوع شغلك؟\n[اختر القطاع]: عيادة · مطعم أو كافيه · متجر إلكتروني · نشاط آخر',
    });
    expect(wa.partSummary(CTA_PART)).toEqual({
      message_type: 'interactive',
      text_body: `${CTA_PART.text}\n[افتح الصفحة] ${CTA_PART.url}`,
    });
    expect(wa.partSummary(IMAGE_PART)).toEqual({ message_type: 'image', text_body: '[صورة] مثال توضيحي 👇 …' });
  });

  test('6b. English marks the image as [image]', () => {
    const card = { ...SAMPLE_CARD, text: 'Illustrative example 👇', buttons: [{ id: 'lead_talk', title: 'Talk to the team' }] };
    expect(wa.partSummary(card, 'en')).toEqual({ message_type: 'interactive', text_body: '[image] Illustrative example 👇\n[Talk to the team]' });
    expect(wa.partSummary({ ...IMAGE_PART, text: 'Illustrative example' }, 'en')).toEqual({ message_type: 'image', text_body: '[image] Illustrative example' });
    expect(wa.partSummary({ type: 'text', text: 'Hi' }, 'en')).toEqual({ message_type: 'text', text_body: 'Hi' });
    expect(wa.partSummary({ ...LIST_PART, text: 'What kind of business?', buttonLabel: 'Choose a sector', sections: [{ title: 'Sectors', rows: [{ id: 'sector:clinic', title: 'Clinic' }, { id: 'sector:store', title: 'Online store' }] }] }, 'en'))
      .toEqual({ message_type: 'interactive', text_body: 'What kind of business?\n[Choose a sector]: Clinic · Online store' });
  });

  test('never throws on a malformed part; an empty summary is visible to validParts', () => {
    expect(wa.partSummary(undefined)).toEqual({ message_type: 'text', text_body: '' });
    expect(wa.partSummary({ type: 'weird', text: 'x' })).toEqual({ message_type: 'text', text_body: 'x' });
    expect(wa.partSummary({ type: 'interactive', text: 'x' }).text_body).toBe('x');
    expect(wa.partSummary({ type: 'list' }).text_body).toBe('[]: ');
  });
});

describe('media download (§4.1)', () => {
  beforeEach(() => {
    axios.get.mockReset();
  });

  test('getMediaInfo GETs the media id with the bearer token', async () => {
    axios.get.mockResolvedValue({ status: 200, data: { url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'audio/ogg', file_size: 12345, id: '987' } });
    const info = await wa.getMediaInfo('987', 'TOKEN');
    expect(info).toEqual({ ok: true, url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'audio/ogg', file_size: 12345 });
    const [url, config] = axios.get.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v24.0/987');
    expect(config.headers.Authorization).toBe('Bearer TOKEN');
    expect(config.timeout).toBe(8000);
  });

  test('downloadMedia returns a buffer with an arraybuffer response and a byte cap', async () => {
    axios.get.mockResolvedValue({ status: 200, data: Buffer.from('abc'), headers: { 'content-type': 'image/jpeg; charset=binary' } });
    const out = await wa.downloadMedia('https://lookaside.fbsbx.com/x', 'TOKEN', { maxBytes: 2 * 1024 * 1024 });
    expect(out).toEqual({ ok: true, buffer: Buffer.from('abc'), mime_type: 'image/jpeg' });
    const [, config] = axios.get.mock.calls[0];
    expect(config).toMatchObject({ responseType: 'arraybuffer', maxContentLength: 2 * 1024 * 1024, timeout: 10000 });
    expect(config.headers.Authorization).toBe('Bearer TOKEN');
  });

  test('7. never throw on 404, timeout or over-size', async () => {
    axios.get.mockRejectedValueOnce(axiosError({ status: 404, graph: { code: 100, message: 'Unsupported get request' } }));
    await expect(wa.getMediaInfo('987', 'TOKEN')).resolves.toMatchObject({ ok: false, url: null, error: 'http_404' });

    axios.get.mockRejectedValueOnce(axiosError({ code: 'ECONNABORTED' }));
    await expect(wa.getMediaInfo('987', 'TOKEN')).resolves.toMatchObject({ ok: false, error: 'timeout' });

    axios.get.mockRejectedValueOnce(axiosError({ status: 404 }));
    await expect(wa.downloadMedia('https://lookaside.fbsbx.com/x', 'TOKEN')).resolves.toEqual({ ok: false, buffer: null, mime_type: null, error: 'http_404' });

    axios.get.mockRejectedValueOnce(axiosError({ code: 'ETIMEDOUT' }));
    await expect(wa.downloadMedia('https://lookaside.fbsbx.com/x', 'TOKEN')).resolves.toMatchObject({ ok: false, error: 'timeout' });

    const big = new Error('maxContentLength size of 5242880 exceeded');
    axios.get.mockRejectedValueOnce(big);
    await expect(wa.downloadMedia('https://lookaside.fbsbx.com/x', 'TOKEN')).resolves.toMatchObject({ ok: false, error: 'too_large' });

    // An adapter that ignores maxContentLength still cannot hand back more than the cap.
    axios.get.mockResolvedValueOnce({ status: 200, data: Buffer.alloc(11), headers: {} });
    await expect(wa.downloadMedia('https://lookaside.fbsbx.com/x', 'TOKEN', { maxBytes: 10 })).resolves.toMatchObject({ ok: false, error: 'too_large' });

    axios.get.mockResolvedValueOnce({ status: 200, data: {} });
    await expect(wa.getMediaInfo('987', 'TOKEN')).resolves.toMatchObject({ ok: false, error: 'no_url' });
  });

  test('no token leaves for a non-https URL or a malformed media id', async () => {
    await expect(wa.downloadMedia('http://evil.example/x', 'TOKEN')).resolves.toMatchObject({ ok: false, error: 'invalid_url' });
    await expect(wa.getMediaInfo('../me', 'TOKEN')).resolves.toMatchObject({ ok: false, error: 'invalid_media_id' });
    await expect(wa.getMediaInfo(undefined, 'TOKEN')).resolves.toMatchObject({ ok: false });
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe('exports', () => {
  test('9. isWithinServiceWindow is the utils function itself', () => {
    expect(wa.isWithinServiceWindow).toBe(serviceWindow.isWithinServiceWindow);
  });

  test('existing exports are still there', () => {
    for (const name of ['validateSignature', 'sendTextMessage', 'sendButtonMessage', 'sendListMessage',
      'sendTemplateMessage', 'markAsRead', 'parseInboundMessage', 'normalizePhone']) {
      expect(typeof wa[name]).toBe('function');
    }
    expect(wa.normalizePhone('+962 79 000')).toBe('96279000');
  });
});
