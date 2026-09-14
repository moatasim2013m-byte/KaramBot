/**
 * routes/internal.js (pr1-contracts §8.2): bearer-protected sweep and status routes.
 * The sweeper is mocked; the full app is used so the "no apiLimiter" mount is tested too.
 */
require('./setup');

jest.mock('../src/services/shiftSweeper', () => ({
  runSweep: jest.fn(),
  getShiftStatus: jest.fn(),
}));

const request = require('supertest');
const app = require('../src/app');
const { runSweep, getShiftStatus } = require('../src/services/shiftSweeper');

const TOKEN = 'sweep-token-0123456789';
const REPORT = { orphans: 1, sla_notes: 0, awaiting_notes: 0, window_flags: 0, ambiguous_alerts: 0, unanswered_alerts: 0, errors: [] };
const STATUS = { business: { id: 'biz_shift', name: 'SHIFT' }, workflow_active: true };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.INTERNAL_SWEEP_TOKEN = TOKEN;
  runSweep.mockResolvedValue(REPORT);
  getShiftStatus.mockResolvedValue(STATUS);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.INTERNAL_SWEEP_TOKEN;
});

describe('POST /api/internal/sweep', () => {
  test('no INTERNAL_SWEEP_TOKEN env → 503, sweep not run', async () => {
    delete process.env.INTERNAL_SWEEP_TOKEN;
    const res = await request(app).post('/api/internal/sweep').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'sweep_not_configured' });
    expect(runSweep).not.toHaveBeenCalled();
  });

  test('missing, wrong, different-length or non-Bearer credentials → 401', async () => {
    const cases = [
      null,
      `Bearer ${TOKEN.slice(0, -1)}x`,
      `Bearer ${TOKEN}extra`,
      'Bearer ',
      TOKEN,
      `Basic ${TOKEN}`,
    ];
    for (const header of cases) {
      const req = request(app).post('/api/internal/sweep');
      if (header !== null) req.set('Authorization', header);
      const res = await req;
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'unauthorized' });
    }
    expect(runSweep).not.toHaveBeenCalled();
  });

  test('right bearer → 200 with the report', async () => {
    const res = await request(app).post('/api/internal/sweep').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, report: REPORT });
    expect(runSweep).toHaveBeenCalledTimes(1);
  });

  test('sweep throws → 500 with the message', async () => {
    runSweep.mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/api/internal/sweep').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });

  test('not rate-limited: 101 calls → no 429', async () => {
    for (let i = 0; i < 101; i++) {
      const res = await request(app).post('/api/internal/sweep').set('Authorization', `Bearer ${TOKEN}`);
      expect(res.status).toBe(200);
    }
    expect(runSweep).toHaveBeenCalledTimes(101);
  });
});

describe('GET /api/internal/shift-status', () => {
  test('same auth: 503 without env, 401 with a wrong bearer', async () => {
    let res = await request(app).get('/api/internal/shift-status').set('Authorization', 'Bearer nope');
    expect(res.status).toBe(401);

    delete process.env.INTERNAL_SWEEP_TOKEN;
    res = await request(app).get('/api/internal/shift-status').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(503);
    expect(getShiftStatus).not.toHaveBeenCalled();
  });

  test('right bearer → 200 with the status JSON', async () => {
    const res = await request(app).get('/api/internal/shift-status').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(STATUS);
  });

  test('status throws → 500', async () => {
    getShiftStatus.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/internal/shift-status').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'db down' });
  });
});
