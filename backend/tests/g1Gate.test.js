/**
 * The G1 lock on owner self-connect, on the server. es_owner_enabled opens only after G1 (the
 * first attended live Embedded Signup, on a spare SIM) is on record, and G1 is recorded only when
 * the server can see such a connect: an es_connected written by SHIFT's own Embedded Signup routes.
 * Undoing G1 closes self-connect (and public self-signup, which needs it) before the record goes.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('./helpers/fakeDb').getFakeDb();
const app = require('../src/app');
const platformSettings = require('../src/services/platformSettings');
const { G1_CONFIRM } = require('../src/routes/adminPlatform');

const auth = (id = 'admin1') => ({ Authorization: `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}` });
const URL = '/api/admin/platform-settings';
const patch = (body, id) => request(app).patch(URL).set(auth(id)).send(body);
const recordG1 = (confirm = G1_CONFIRM, id) => request(app).post(`${URL}/g1`).set(auth(id)).send({ confirm });
const stored = (key) => (db.store.platformSettings.find((r) => r.key === key) || {}).value;
const events = (type) => db.store.accountEvents.filter((e) => e.type === type);

const ATTENDED = {
  id: 'ev_conn', business_id: 'b_sim', actor_kind: 'shift', actor_user_id: 'admin1', type: 'es_connected',
  data: { waba_id: 'W1', phone_number_id: 'P1' }, created_at: new Date('2026-10-10T10:00:00Z'),
};

beforeEach(() => {
  db.reset();
  platformSettings.clearCache();
  db.seed({
    businesses: [{ id: 'b_sim', name: 'شريحة شِفت الاحتياطية' }],
    users: [
      { id: 'admin1', name: 'معتصم', role: 'platform_admin', business_id: null, active: true },
      { id: 'owner1', name: 'أبو خالد', role: 'business_owner', business_id: 'b_sim', active: true },
    ],
  });
});

describe('recording G1', () => {
  test('refused without an attended connect on record, nothing stored', async () => {
    const res = await recordG1();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/الشريحة الاحتياطية/);
    expect(stored('g1_passed_at')).toBeUndefined();
    expect(events('g1_passed')).toHaveLength(0);
  });

  test('an owner\'s connect or an orphan attached by SHIFT is not the attended run', async () => {
    db.seed({
      accountEvents: [
        { ...ATTENDED, id: 'ev_owner', actor_kind: 'owner', actor_user_id: 'owner1' },
        { ...ATTENDED, id: 'ev_orphan', data: { resumed_from: 'orphan' } },
      ],
    });
    expect((await recordG1()).status).toBe(409);
  });

  test('the typed sentence is required', async () => {
    db.seed({ accountEvents: [ATTENDED] });
    const res = await recordG1('نعم');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(G1_CONFIRM);
    expect(stored('g1_passed_at')).toBeUndefined();
  });

  test('with the evidence: stored with who and when, logged, and the GET checklist shows it', async () => {
    let get = await request(app).get(URL).set(auth());
    expect(get.body.g1).toMatchObject({ passed_at: null, passed_by: null, evidence: null, confirm: G1_CONFIRM });

    db.seed({ accountEvents: [ATTENDED] });
    get = await request(app).get(URL).set(auth());
    expect(get.body.g1.evidence).toMatchObject({ event_id: 'ev_conn', business_name: 'شريحة شِفت الاحتياطية' });

    const res = await recordG1();
    expect(res.status).toBe(200);
    expect(stored('g1_passed_at')).toMatchObject({ at: expect.any(String), by_user_id: 'admin1', by_name: 'معتصم', evidence: { event_id: 'ev_conn' } });
    expect(res.body.g1).toMatchObject({ passed_at: expect.any(String), passed_by: { id: 'admin1', name: 'معتصم' } });
    expect(events('g1_passed')).toEqual([expect.objectContaining({ business_id: null, actor_kind: 'shift', actor_user_id: 'admin1' })]);
  });

  test('platform_admin only', async () => {
    db.seed({ accountEvents: [ATTENDED] });
    expect((await recordG1(G1_CONFIRM, 'owner1')).status).toBe(403);
    expect((await request(app).delete(`${URL}/g1`).set(auth('owner1'))).status).toBe(403);
  });
});

describe('the self-connect switch', () => {
  test('true is refused before G1, in Arabic; false is always allowed', async () => {
    const res = await patch({ key: 'es_owner_enabled', value: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/G1/);
    expect(stored('es_owner_enabled')).toBeUndefined();
    expect((await patch({ key: 'es_owner_enabled', value: false })).status).toBe(200);
  });

  test('the lock is in the service, so no other caller can open it around G1', async () => {
    await expect(platformSettings.set('es_owner_enabled', true, null)).rejects.toMatchObject({ code: 'G1_NOT_PASSED', status: 409 });
  });

  test('g1_passed_at cannot be written through the PATCH', async () => {
    const res = await patch({ key: 'g1_passed_at', value: { at: '2026-10-11T00:00:00Z' } });
    expect(res.status).toBe(400);
    expect(stored('g1_passed_at')).toBeUndefined();
  });

  test('after G1 it opens', async () => {
    db.seed({ accountEvents: [ATTENDED] });
    await recordG1();
    const res = await patch({ key: 'es_owner_enabled', value: true });
    expect(res.status).toBe(200);
    expect(await platformSettings.get('es_owner_enabled')).toBe(true);
  });

  test('undoing G1 closes self-connect and public self-signup, then lets nothing reopen', async () => {
    db.seed({ accountEvents: [ATTENDED] });
    await recordG1();
    await patch({ key: 'es_owner_enabled', value: true });
    await patch({ key: 'self_signup', value: { enabled: true }, confirm: 'افتح التسجيل العام' });
    expect((await platformSettings.get('self_signup')).enabled).toBe(true);

    const res = await request(app).delete(`${URL}/g1`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.g1.passed_at).toBeNull();
    expect(await platformSettings.get('es_owner_enabled')).toBe(false);
    expect((await platformSettings.get('self_signup')).enabled).toBe(false);
    expect(stored('g1_passed_at')).toBeUndefined();
    expect(events('g1_reverted')).toHaveLength(1);
    expect((await patch({ key: 'es_owner_enabled', value: true })).status).toBe(409);
  });
});
