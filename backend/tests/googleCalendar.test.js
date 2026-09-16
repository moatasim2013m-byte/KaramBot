/**
 * services/googleCalendar.js: keyless token minting (metadata → IAM Credentials), the cache, the local env
 * token, and freeBusy / insert (409 idempotency) / patch / delete with error classification. axios is mocked;
 * nothing reaches the network.
 */
require('./setup');

jest.mock('axios');
const axios = require('axios');
const cal = require('../src/services/googleCalendar');

const NOW = new Date('2026-09-15T07:00:00.000Z');

const httpError = (status, data = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data }, request: {} });

function mockMint({ expireTime = '2026-09-15T08:00:00.000Z', token = 'cal-token' } = {}) {
  axios.get.mockImplementation(async (url) => {
    if (url === cal.METADATA_TOKEN_URL) return { status: 200, data: { access_token: 'runtime-token', expires_in: 3599 } };
    throw new Error(`unexpected GET ${url}`);
  });
  axios.post.mockImplementation(async (url) => {
    if (url.startsWith(cal.IAM_BASE)) return { status: 200, data: { accessToken: token, expireTime } };
    throw new Error(`unexpected POST ${url}`);
  });
}

beforeEach(() => {
  axios.get.mockReset();
  axios.post.mockReset();
  axios.patch.mockReset();
  axios.delete.mockReset();
  cal.resetTokenCache();
  delete process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
  delete process.env.CALENDAR_SA_EMAIL;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
  delete process.env.CALENDAR_SA_EMAIL;
});

describe('token minting', () => {
  test('metadata token → generateAccessToken for the calendar SA with the calendar scope', async () => {
    mockMint();
    const r = await cal.getAccessToken({ now: NOW });
    expect(r).toMatchObject({ ok: true, token: 'cal-token', source: 'minted' });

    const [metaUrl, metaOpts] = axios.get.mock.calls[0];
    expect(metaUrl).toBe('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token');
    expect(metaOpts.headers).toEqual({ 'Metadata-Flavor': 'Google' });

    const [iamUrl, body, iamOpts] = axios.post.mock.calls[0];
    expect(iamUrl).toBe('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/karambot-calendar%40karam-bot.iam.gserviceaccount.com:generateAccessToken');
    expect(body).toEqual({ scope: ['https://www.googleapis.com/auth/calendar'], lifetime: '3600s' });
    expect(iamOpts.headers.Authorization).toBe('Bearer runtime-token');
  });

  test('CALENDAR_SA_EMAIL overrides the service account', async () => {
    process.env.CALENDAR_SA_EMAIL = 'other@karam-bot.iam.gserviceaccount.com';
    mockMint();
    await cal.getAccessToken({ now: NOW });
    expect(axios.post.mock.calls[0][0]).toContain('other%40karam-bot.iam.gserviceaccount.com:generateAccessToken');
  });

  test('cached until 5 min before expiry, then minted again', async () => {
    mockMint({ expireTime: '2026-09-15T08:00:00.000Z' });
    await cal.getAccessToken({ now: NOW });
    await cal.getAccessToken({ now: new Date('2026-09-15T07:54:59.000Z') });
    expect(axios.post).toHaveBeenCalledTimes(1);
    const later = await cal.getAccessToken({ now: new Date('2026-09-15T07:55:01.000Z') });
    expect(later.source).toBe('minted');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test('concurrent callers share one mint', async () => {
    mockMint();
    const [a, b] = await Promise.all([cal.getAccessToken({ now: NOW }), cal.getAccessToken({ now: NOW })]);
    expect(a.token).toBe('cal-token');
    expect(b.token).toBe('cal-token');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('GOOGLE_CALENDAR_ACCESS_TOKEN (local dev) skips the metadata server', async () => {
    process.env.GOOGLE_CALENDAR_ACCESS_TOKEN = 'local-token';
    const r = await cal.getAccessToken({ now: NOW });
    expect(r).toMatchObject({ ok: true, token: 'local-token', source: 'env' });
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('metadata server unreachable (not on Cloud Run) → {ok:false}, never throws', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND', request: {} }));
    const r = await cal.getAccessToken({ now: NOW });
    expect(r.ok).toBe(false);
    expect(r.error.kind).toBe('network');
  });

  test('IAM refuses (no tokenCreator role) → auth', async () => {
    axios.get.mockResolvedValue({ data: { access_token: 'runtime-token' } });
    axios.post.mockRejectedValue(httpError(403, { error: { message: 'Permission iam.serviceAccounts.getAccessToken denied', errors: [{ reason: 'forbidden' }] } }));
    const r = await cal.getAccessToken({ now: NOW });
    expect(r).toMatchObject({ ok: false, error: { kind: 'auth', status: 403 } });
  });
});

describe('error classification', () => {
  test.each([
    [409, {}, 'conflict'],
    [404, {}, 'notFound'],
    [410, {}, 'notFound'],
    [401, {}, 'auth'],
    [403, { error: { errors: [{ reason: 'forbidden' }] } }, 'auth'],
    [403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 'rate'],
    [429, {}, 'rate'],
    [500, {}, 'server'],
    [503, {}, 'server'],
    [400, {}, 'invalid'],
  ])('HTTP %s → %s', (status, data, kind) => {
    expect(cal.classifyError(httpError(status, data)).kind).toBe(kind);
  });

  test('timeout / no response → network', () => {
    expect(cal.classifyError(Object.assign(new Error('timeout'), { code: 'ECONNABORTED', request: {} })).kind).toBe('network');
  });
});

describe('calendar calls (env token)', () => {
  beforeEach(() => { process.env.GOOGLE_CALENDAR_ACCESS_TOKEN = 'tok'; });

  test('freeBusy posts the window and every calendar; returns sorted busy intervals', async () => {
    axios.post.mockResolvedValue({
      data: {
        calendars: {
          sales: { busy: [{ start: '2026-09-16T08:00:00Z', end: '2026-09-16T09:00:00Z' }] },
          'osaid@shifts-ai.com': { busy: [{ start: '2026-09-15T10:00:00Z', end: '2026-09-15T10:30:00Z' }] },
        },
      },
    });
    const r = await cal.freeBusy({ timeMin: NOW, timeMax: new Date('2026-09-22T00:00:00Z'), calendarIds: ['sales', 'osaid@shifts-ai.com'] });
    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toBe('https://www.googleapis.com/calendar/v3/freeBusy');
    expect(body).toEqual({
      timeMin: '2026-09-15T07:00:00.000Z', timeMax: '2026-09-22T00:00:00.000Z', timeZone: 'Asia/Amman',
      items: [{ id: 'sales' }, { id: 'osaid@shifts-ai.com' }],
    });
    expect(opts.headers.Authorization).toBe('Bearer tok');
    expect(r.ok).toBe(true);
    expect(r.busy.map((b) => b.start.toISOString())).toEqual(['2026-09-15T10:00:00.000Z', '2026-09-16T08:00:00.000Z']);
  });

  test('freeBusy with a calendar Google cannot read (not shared) → notFound, never a "free" answer', async () => {
    axios.post.mockResolvedValue({ data: { calendars: { sales: { errors: [{ domain: 'global', reason: 'notFound' }], busy: [] } } } });
    const r = await cal.freeBusy({ timeMin: NOW, timeMax: NOW.getTime() + 3600e3, calendarIds: ['sales'] });
    expect(r).toMatchObject({ ok: false, error: { kind: 'notFound' } });
  });

  test('freeBusy HTTP 503 → server error result', async () => {
    axios.post.mockRejectedValue(httpError(503));
    const r = await cal.freeBusy({ timeMin: NOW, timeMax: NOW.getTime() + 3600e3, calendarIds: ['sales'] });
    expect(r).toMatchObject({ ok: false, error: { kind: 'server' } });
  });

  test('insertEvent posts to the calendar with sendUpdates=none', async () => {
    axios.post.mockResolvedValue({ data: { id: 'shabc', status: 'confirmed' } });
    const r = await cal.insertEvent('sales@group.calendar.google.com', { id: 'shabc', summary: 'x' });
    expect(axios.post.mock.calls[0][0]).toBe('https://www.googleapis.com/calendar/v3/calendars/sales%40group.calendar.google.com/events');
    expect(axios.post.mock.calls[0][2].params).toEqual({ sendUpdates: 'none' });
    expect(r).toEqual({ ok: true, event: { id: 'shabc', status: 'confirmed' }, existed: false });
  });

  test('insertEvent 409 on a live event with the same id → booked (idempotent retry)', async () => {
    axios.post.mockRejectedValue(httpError(409, { error: { message: 'The requested identifier already exists.' } }));
    axios.get.mockResolvedValue({ data: { id: 'shabc', status: 'confirmed', start: { dateTime: '2026-09-16T08:00:00Z' } } });
    const r = await cal.insertEvent('sales', { id: 'shabc' });
    expect(r).toMatchObject({ ok: true, existed: true, event: { id: 'shabc' } });
    expect(axios.get.mock.calls[0][0]).toBe('https://www.googleapis.com/calendar/v3/calendars/sales/events/shabc');
  });

  test('insertEvent 409 on a cancelled event → conflict (not booked)', async () => {
    axios.post.mockRejectedValue(httpError(409));
    axios.get.mockResolvedValue({ data: { id: 'shabc', status: 'cancelled' } });
    const r = await cal.insertEvent('sales', { id: 'shabc' });
    expect(r).toMatchObject({ ok: false, error: { kind: 'conflict', reason: 'cancelled' } });
  });

  test('insertEvent 403 (calendar not shared for writing) → auth', async () => {
    axios.post.mockRejectedValue(httpError(403, { error: { errors: [{ reason: 'requiredAccessLevel' }] } }));
    const r = await cal.insertEvent('sales', { id: 'shabc' });
    expect(r).toMatchObject({ ok: false, error: { kind: 'auth' } });
  });

  test('patchEvent sends PATCH with the new times', async () => {
    axios.patch.mockResolvedValue({ data: { id: 'shabc', start: { dateTime: '2026-09-17T08:00:00Z' } } });
    const patch = { start: { dateTime: '2026-09-17T08:00:00.000Z' }, end: { dateTime: '2026-09-17T08:30:00.000Z' } };
    const r = await cal.patchEvent('sales', 'shabc', patch);
    expect(axios.patch.mock.calls[0][0]).toBe('https://www.googleapis.com/calendar/v3/calendars/sales/events/shabc');
    expect(axios.patch.mock.calls[0][1]).toEqual(patch);
    expect(r.ok).toBe(true);
  });

  test('patchEvent on a deleted event → notFound', async () => {
    axios.patch.mockRejectedValue(httpError(404));
    expect((await cal.patchEvent('sales', 'gone', {})).error.kind).toBe('notFound');
  });

  test('deleteEvent → ok; already gone (410) → ok with alreadyGone', async () => {
    axios.delete.mockResolvedValueOnce({ status: 204 });
    expect(await cal.deleteEvent('sales', 'shabc')).toEqual({ ok: true, alreadyGone: false });
    axios.delete.mockRejectedValueOnce(httpError(410));
    expect(await cal.deleteEvent('sales', 'shabc')).toEqual({ ok: true, alreadyGone: true });
    axios.delete.mockRejectedValueOnce(httpError(500));
    expect((await cal.deleteEvent('sales', 'shabc')).ok).toBe(false);
  });

  test('a 401 drops the cached minted token so the next call mints again', async () => {
    delete process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
    mockMint({ expireTime: '2099-01-01T00:00:00Z' });
    axios.patch.mockRejectedValueOnce(httpError(401));
    await cal.patchEvent('sales', 'x', {}, { now: NOW });
    axios.patch.mockResolvedValueOnce({ data: {} });
    await cal.patchEvent('sales', 'x', {}, { now: NOW });
    expect(axios.post.mock.calls.filter(([u]) => u.startsWith(cal.IAM_BASE))).toHaveLength(2);
  });
});
