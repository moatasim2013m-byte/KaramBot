/**
 * AccountEvent: the one log of what happened to an account (services/accountEvents.js).
 *
 * Two properties matter more than the rest. Recording never throws, because it describes an action
 * that already happened and must not fail it. And nothing secret lands in `data`: the table is
 * shown to staff and partly to the shop, while the connect flow handles an OAuth code, a business
 * token and a 2FA PIN.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const db = require('./helpers/fakeDb').getFakeDb();
const prisma = require('../src/config/prisma');
const events = require('../src/services/accountEvents');

let errorSpy;
beforeEach(() => {
  db.reset();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  jest.restoreAllMocks();
});

const META_TOKEN = `EAAG${'x1Y2z3'.repeat(20)}`;

describe('record', () => {
  test('writes one row with the actor and the data', async () => {
    const row = await events.record({
      businessId: 'b1', actorUserId: 'u1', actorKind: 'shift', type: 'payment_confirmed', data: { by: 'Rana' },
    });
    expect(row).toMatchObject({ business_id: 'b1', actor_user_id: 'u1', actor_kind: 'shift', type: 'payment_confirmed', data: { by: 'Rana' }, resolved_at: null });
    expect(db.store.accountEvents).toHaveLength(1);
    expect(db.store.accountEvents[0].created_at).toBeInstanceOf(Date);
  });

  test('a platform event has no business, and the actor defaults to the system', async () => {
    const row = await events.record({ type: 'provider_down' });
    expect(row).toMatchObject({ business_id: null, actor_user_id: null, actor_kind: 'system', data: {} });
  });

  test('drops every key that names a secret, at any depth and in any spelling', async () => {
    await events.record({
      businessId: 'b1',
      actorKind: 'owner',
      type: 'es_failed',
      data: {
        code: 'AQB-oauth-code',
        access_token: META_TOKEN,
        accessToken: META_TOKEN,
        pin: '123456',
        pin_enc: 'enc',
        password: 'p',
        newPassword: 'p',
        client_secret: 's',
        SHIFT_ES_APP_SECRET: 's',
        verification_code: '999',
        api_key: 'k',
        apiKey: 'k',
        authorization: 'Bearer x',
        // Kept: harmless "code" fields the panels show when a connect fails.
        error_code: 131042,
        errorCode: 100,
        error_subcode: 2388001,
        current_step: 'subscribed',
        meta: { response: { token: 't', id: 'waba1' } },
        attempts: [{ code: 'c', step: 'register' }],
      },
    });
    const { data } = db.store.accountEvents[0];
    expect(data).toEqual({
      error_code: 131042,
      errorCode: 100,
      error_subcode: 2388001,
      current_step: 'subscribed',
      meta: { response: { id: 'waba1' } },
      attempts: [{ step: 'register' }],
    });
  });

  test('redacts token-shaped values hidden inside text', async () => {
    await events.record({
      type: 'es_failed',
      data: { error_message: `Graph refused ${META_TOKEN} for this WABA`, jwt: undefined, note: 'eyJhbGciOiJIUzI1.eyJpZCI6InUxIn0x.c2lnbmF0dXJlMTIz' },
    });
    const { data } = db.store.accountEvents[0];
    expect(data.error_message).toBe('Graph refused [redacted] for this WABA');
    expect(data.note).toBe('[redacted]');
    expect(JSON.stringify(data)).not.toContain('EAAG');
  });

  test('makes data JSON-safe: dates become ISO strings, functions and undefined go', async () => {
    const at = new Date('2026-10-08T10:00:00Z');
    await events.record({ type: 'went_live', data: { at, fn: () => 1, gone: undefined, n: Infinity } });
    expect(db.store.accountEvents[0].data).toEqual({ at: '2026-10-08T10:00:00.000Z', n: null });
  });

  test('never throws when the database fails, and says so in the log', async () => {
    db.failNext('accountEvent.create', new Error('connection reset'));
    await expect(events.record({ businessId: 'b1', type: 'went_live' })).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('went_live for business=b1 not recorded: connection reset'));
    expect(db.store.accountEvents).toHaveLength(0);
  });

  test('never throws on a bad call either: unknown actor kind, missing type, no argument', async () => {
    await expect(events.record({ type: 'went_live', actorKind: 'robot' })).resolves.toBeNull();
    await expect(events.record({ businessId: 'b1' })).resolves.toBeNull();
    await expect(events.record()).resolves.toBeNull();
    expect(db.store.accountEvents).toHaveLength(0);
  });

  test('writes through a transaction client when given one', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'e1' });
    const row = await events.record({ type: 'invite_created', businessId: 'b1', actorKind: 'shift' }, { client: { accountEvent: { create } } });
    expect(row).toEqual({ id: 'e1' });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'invite_created', business_id: 'b1' }) });
    expect(db.store.accountEvents).toHaveLength(0);
  });
});

describe('toRow', () => {
  test('throws on bad input, for callers that want the event to roll back with their transaction', () => {
    expect(() => events.toRow({ type: 'x', actorKind: 'robot' })).toThrow(/actor_kind/);
    expect(() => events.toRow({ type: '' })).toThrow(/type/);
  });

  test('accepts every actor kind the spec names', () => {
    for (const actorKind of ['owner', 'staff', 'shift', 'system', 'meta']) {
      expect(events.toRow({ type: 'x', actorKind }).actor_kind).toBe(actorKind);
    }
  });

  test('a non-object data becomes {}', () => {
    expect(events.toRow({ type: 'x', data: 'oops' }).data).toEqual({});
    expect(events.toRow({ type: 'x', data: null }).data).toEqual({});
  });
});

describe('list', () => {
  async function seedEvents() {
    db.seed({
      accountEvents: [
        { id: 'e1', business_id: 'b1', actor_kind: 'shift', type: 'invite_created', created_at: new Date('2026-10-01T10:00:00Z') },
        { id: 'e2', business_id: 'b1', actor_kind: 'owner', type: 'bot_handoff', created_at: new Date('2026-10-02T10:00:00Z') },
        { id: 'e3', business_id: 'b2', actor_kind: 'owner', type: 'bot_handoff', created_at: new Date('2026-10-03T10:00:00Z') },
        { id: 'e4', business_id: 'b1', actor_kind: 'owner', type: 'bot_handoff', created_at: new Date('2026-10-04T10:00:00Z'), resolved_at: new Date('2026-10-04T11:00:00Z') },
        { id: 'e5', business_id: null, actor_kind: 'shift', type: 'platform_setting_changed', created_at: new Date('2026-10-05T10:00:00Z') },
      ],
    });
  }

  test("one business's events, newest first", async () => {
    await seedEvents();
    expect((await events.list({ businessId: 'b1' })).map((e) => e.id)).toEqual(['e4', 'e2', 'e1']);
  });

  test('filters by type, open only, and pages with before', async () => {
    await seedEvents();
    expect((await events.list({ businessId: 'b1', types: 'bot_handoff', unresolved: true })).map((e) => e.id)).toEqual(['e2']);
    expect((await events.list({ businessId: 'b1', types: ['bot_handoff', 'invite_created'] })).map((e) => e.id)).toEqual(['e4', 'e2', 'e1']);
    expect((await events.list({ businessId: 'b1', before: '2026-10-04T10:00:00Z' })).map((e) => e.id)).toEqual(['e2', 'e1']);
    expect((await events.list({ businessId: 'b1', before: 'not a date' })).map((e) => e.id)).toEqual(['e4', 'e2', 'e1']);
  });

  test('null lists platform events; allBusinesses lists the whole fleet', async () => {
    await seedEvents();
    expect((await events.list({ businessId: null })).map((e) => e.id)).toEqual(['e5']);
    expect((await events.list({ allBusinesses: true, limit: 2 })).map((e) => e.id)).toEqual(['e5', 'e4']);
  });

  test('refuses to guess when no business is named, so a tenant route cannot list everyone', async () => {
    await expect(events.list({})).rejects.toThrow(TypeError);
    await expect(events.list({ businessId: undefined })).rejects.toThrow(/businessId/);
  });

  test('the limit is clamped', async () => {
    const spy = jest.spyOn(prisma.accountEvent, 'findMany');
    await events.list({ businessId: 'b1', limit: 100000 });
    await events.list({ businessId: 'b1', limit: 0 });
    expect(spy.mock.calls[0][0].take).toBe(200);
    expect(spy.mock.calls[1][0].take).toBe(50);
  });
});

describe('resolve', () => {
  test('marks an open event handled once', async () => {
    db.seed({ accountEvents: [{ id: 'e1', business_id: 'b1', actor_kind: 'owner', type: 'bot_handoff' }] });
    expect(await events.resolve('e1')).toBe(true);
    expect(db.store.accountEvents[0].resolved_at).toBeInstanceOf(Date);
    expect(await events.resolve('e1')).toBe(false);
  });

  test("scoped to a business, another shop's event is not touched", async () => {
    db.seed({ accountEvents: [{ id: 'e1', business_id: 'b2', actor_kind: 'owner', type: 'bot_handoff' }] });
    expect(await events.resolve('e1', { businessId: 'b1' })).toBe(false);
    expect(db.store.accountEvents[0].resolved_at).toBeNull();
    expect(await events.resolve('e1', { businessId: 'b2' })).toBe(true);
  });

  test('no id, no change', async () => {
    expect(await events.resolve(undefined)).toBe(false);
  });
});
