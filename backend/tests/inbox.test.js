require('./setup');
const request = require('supertest');
const app = require('../src/app');

describe('Inbox Routes — Authentication', () => {
  test('GET /api/inbox/conversations requires auth', async () => {
    const res = await request(app).get('/api/inbox/conversations');
    expect(res.status).toBe(401);
  });

  test('GET /api/inbox/conversations/:id/messages requires auth', async () => {
    const res = await request(app).get('/api/inbox/conversations/someid/messages');
    expect(res.status).toBe(401);
  });

  test('POST /api/inbox/conversations/:id/send requires auth', async () => {
    const res = await request(app).post('/api/inbox/conversations/someid/send').send({ text: 'hi' });
    expect(res.status).toBe(401);
  });

  test('POST /api/inbox/conversations/:id/takeover requires auth', async () => {
    const res = await request(app).post('/api/inbox/conversations/someid/takeover');
    expect(res.status).toBe(401);
  });

  test('POST /api/inbox/conversations/:id/enable-ai requires auth', async () => {
    const res = await request(app).post('/api/inbox/conversations/someid/enable-ai');
    expect(res.status).toBe(401);
  });

  test('POST /api/inbox/conversations/:id/resolve requires auth', async () => {
    const res = await request(app).post('/api/inbox/conversations/someid/resolve');
    expect(res.status).toBe(401);
  });

  test('GET /api/inbox/stats requires auth', async () => {
    const res = await request(app).get('/api/inbox/stats');
    expect(res.status).toBe(401);
  });

  test('GET /api/inbox/updates requires auth', async () => {
    const res = await request(app).get('/api/inbox/updates');
    expect(res.status).toBe(401);
  });
});

describe('Clinic Routes — Authentication', () => {
  test('GET /api/clinic/services requires auth', async () => {
    const res = await request(app).get('/api/clinic/services');
    expect(res.status).toBe(401);
  });

  test('GET /api/clinic/doctors requires auth', async () => {
    const res = await request(app).get('/api/clinic/doctors');
    expect(res.status).toBe(401);
  });

  test('GET /api/clinic/appointments requires auth', async () => {
    const res = await request(app).get('/api/clinic/appointments');
    expect(res.status).toBe(401);
  });

  test('GET /api/clinic/slots requires auth', async () => {
    const res = await request(app).get('/api/clinic/slots');
    expect(res.status).toBe(401);
  });
});

describe('Reports Routes — Authentication', () => {
  test('GET /api/reports/daily requires auth', async () => {
    const res = await request(app).get('/api/reports/daily');
    expect(res.status).toBe(401);
  });

  test('GET /api/reports/weekly requires auth', async () => {
    const res = await request(app).get('/api/reports/weekly');
    expect(res.status).toBe(401);
  });
});
