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

  test('7. HTTP 503 → server, retryable', async () => {
    axios.post.mockRejectedValue(axiosError({ status: 503 }));
    const result = await wa.sendText('PNID', 'TOKEN', '962790000000', 'مرحبا');
    expect(result).toMatchObject({ ok: false, reason: 'server', retryable: true, httpStatus: 503 });
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
    expect(c(axiosError({ status: 500 }))).toMatchObject({ reason: 'server', retryable: true });
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
