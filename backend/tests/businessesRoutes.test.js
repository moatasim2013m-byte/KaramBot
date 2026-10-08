/**
 * routes/businesses.js: creating a shop, and who may change what (docs/panels/spec.md, P0).
 *
 * Creating a shop used to need a hand-typed Latin slug and a phone_number_id, passed the raw body
 * to Prisma and answered with Prisma's English error text. An Arabic-only name had no slug to
 * offer, a shop without a number stored '' and collided with the next one, and a number already
 * in use read «Unique constraint failed on the fields: (`wa_phone_number_id`)».
 *
 * The role checks: a manager or staff member could rewrite the bot's settings and the alert
 * numbers, and an owner could paste a WhatsApp token over the one Embedded Signup stored.
 *
 * Real routes and middleware on the in-memory fakeDb.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('./helpers/fakeDb').getFakeDb();
const app = require('../src/app');

const as = (userId) => ({ Authorization: `Bearer ${jwt.sign({ id: userId }, process.env.JWT_SECRET)}` });

beforeEach(() => {
  db.reset();
  db.seed({
    businesses: [{ id: 'b1', name: 'صيدلية النور', slug: 'al-noor', business_type: 'generic', ai_config: { greeting_message: 'أهلًا' } }],
    users: [
      { id: 'admin', role: 'platform_admin', business_id: null },
      { id: 'owner', role: 'business_owner', business_id: 'b1' },
      { id: 'manager', role: 'manager', business_id: 'b1' },
      { id: 'staff', role: 'staff', business_id: 'b1' },
    ],
  });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

const create = (body) => request(app).post('/api/businesses').set(as('admin')).send(body);

describe('POST /api/businesses', () => {
  test('a name and a type are enough: the slug comes from the Latin part of the name', async () => {
    const res = await create({ name: 'Cafe Amman 2', business_type: 'generic' });
    expect(res.status).toBe(201);
    expect(res.body.business.slug).toBe('cafe-amman-2');
    expect(res.body.business.business_type).toBe('generic');
    expect(res.body.business).not.toHaveProperty('wa_access_token');
  });

  test('an Arabic-only name gets shop- and six random letters', async () => {
    const res = await create({ name: 'مطعم الشام', business_type: 'restaurant' });
    expect(res.status).toBe(201);
    expect(res.body.business.slug).toMatch(/^shop-[a-z]{6}$/);
  });

  test('a mixed name keeps only its Latin letters and digits', async () => {
    const res = await create({ name: 'صالون Lina 7', business_type: 'generic' });
    expect(res.body.business.slug).toBe('lina-7');
  });

  test('no type given means generic, not the schema default restaurant', async () => {
    const res = await create({ name: 'صيدلية الشفاء' });
    expect(res.status).toBe(201);
    expect(res.body.business.business_type).toBe('generic');
  });

  test('a slug collision is retried, not reported', async () => {
    db.seed({ businesses: [{ id: 'b_taken', name: 'Cafe Amman', slug: 'cafe-amman' }] });
    const res = await create({ name: 'Cafe Amman' });
    expect(res.status).toBe(201);
    expect(res.body.business.slug).toMatch(/^cafe-amman-[a-z]{4}$/);
  });

  test('an operator-typed slug that is taken is also retried with a suffix', async () => {
    const res = await create({ name: 'Another', slug: 'al-noor' });
    expect(res.status).toBe(201);
    expect(res.body.business.slug).toMatch(/^al-noor-[a-z]{4}$/);
  });

  test('a typed slug with Arabic or spaces is refused in Arabic', async () => {
    const res = await create({ name: 'x', slug: 'مطعم الشام' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('الرابط المختصر: أحرف إنجليزية صغيرة وأرقام وشرطات فقط');
  });

  test('without a number the shop is created, and the number is NULL, never ""', async () => {
    const one = await create({ name: 'محل ١', wa_phone_number_id: '' });
    const two = await create({ name: 'محل ٢' });
    expect(one.status).toBe(201);
    expect(two.status).toBe(201); // '' twice used to collide on the unique index
    const rows = db.store.businesses.filter((b) => [one.body.business.id, two.body.business.id].includes(b.id));
    expect(rows.map((r) => r.wa_phone_number_id)).toEqual([null, null]);
  });

  test('a number already linked to another shop answers in Arabic, with no Prisma text', async () => {
    db.seed({ businesses: [{ id: 'b_num', name: 'x', slug: 'x', wa_phone_number_id: '1234567890' }] });
    const res = await create({ name: 'Second', wa_phone_number_id: '1234567890' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'هذا الرقم مربوط بحساب آخر' });
  });

  test('any other database failure is «تعذّر إنشاء الحساب», never err.message', async () => {
    const prisma = require('../src/config/prisma');
    jest.spyOn(prisma.business, 'create').mockRejectedValueOnce(
      Object.assign(new Error('Invalid `prisma.business.create()` invocation: column "x" does not exist'), { code: 'P2022' }),
    );
    const res = await create({ name: 'Broken' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'تعذّر إنشاء الحساب' });
  });

  test('a missing name is refused in Arabic', async () => {
    const res = await create({ business_type: 'generic' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('اسم الحساب مطلوب');
  });

  test('columns outside the allowlist never reach Prisma', async () => {
    const res = await create({ name: 'Mass', id: 'chosen_id', status: 'suspended', wa_app_id: 'x' });
    expect(res.status).toBe(201);
    expect(res.body.business.id).not.toBe('chosen_id');
    expect(res.body.business.status).toBe('active');
  });

  test('only platform_admin creates shops', async () => {
    const res = await request(app).post('/api/businesses').set(as('owner')).send({ name: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/businesses/:id: the bot settings are the owner\'s', () => {
  const patch = (who, body) => request(app).patch('/api/businesses/b1').set(as(who)).send(body);

  test('a manager cannot change ai_config', async () => {
    const res = await patch('manager', { ai_config: { greeting_message: 'غيّرتها' } });
    expect(res.status).toBe(403);
    expect(db.store.businesses.find((b) => b.id === 'b1').ai_config.greeting_message).toBe('أهلًا');
  });

  test('staff cannot change ai_config or policies', async () => {
    expect((await patch('staff', { ai_config: { enabled: false } })).status).toBe(403);
    expect((await patch('staff', { policies: { delivery_fee: 0 } })).status).toBe(403);
  });

  test('a manager cannot sneak ai_config in beside an allowed field', async () => {
    const res = await patch('manager', { name: 'اسم', ai_config: { alert_wa_numbers: [] } });
    expect(res.status).toBe(403);
    expect(db.store.businesses.find((b) => b.id === 'b1').name).toBe('صيدلية النور');
  });

  test('the owner can', async () => {
    // The fake jsonb patches conversations only; the ai_config merge itself is covered against
    // Postgres in tests/integration/pg.test.js. What matters here is that the patch is sent.
    const jsonb = require('../src/db/jsonb');
    const sent = jest.spyOn(jsonb, 'patchJson').mockResolvedValue({ ok: true, count: 1 });
    const res = await patch('owner', { ai_config: { greeting_message: 'مرحبا بكم' } });
    expect(res.status).toBe(200);
    expect(sent).toHaveBeenCalledWith('businesses', 'b1', 'ai_config', { greeting_message: 'مرحبا بكم' });
  });

  test('platform_admin can', async () => {
    const res = await patch('admin', { policies: { delivery_fee: 1 } });
    expect(res.status).toBe(200);
  });

  test('a manager still edits the fields that are not bot settings', async () => {
    const res = await patch('manager', { address: 'إربد' });
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/businesses/:id/token: platform_admin only', () => {
  const longToken = 'EAAG-a-token-that-is-long-enough';

  test('the owner of the business is refused', async () => {
    const res = await request(app).patch('/api/businesses/b1/token').set(as('owner')).send({ wa_access_token: longToken });
    expect(res.status).toBe(403);
    expect(db.store.businesses.find((b) => b.id === 'b1').wa_access_token).toBeNull();
  });

  test('platform_admin stores it encrypted', async () => {
    const res = await request(app).patch('/api/businesses/b1/token').set(as('admin')).send({ wa_access_token: longToken });
    expect(res.status).toBe(200);
    const stored = db.store.businesses.find((b) => b.id === 'b1').wa_access_token;
    expect(stored).toBeTruthy();
    expect(stored).not.toContain(longToken);
  });
});

describe('review 2026-10-08', () => {
  test('creating a shop writes business_created with SHIFT as the actor', async () => {
    const res = await create({ name: 'Cafe Log', business_type: 'generic' });
    expect(res.status).toBe(201);
    expect(db.store.accountEvents).toEqual([expect.objectContaining({
      business_id: res.body.business.id, actor_kind: 'shift', actor_user_id: 'admin', type: 'business_created',
      data: expect.objectContaining({ business_type: 'generic' }),
    })]);
  });

  test.each(['owner', 'admin'])('PATCH /businesses never switches the bot on or off (%s): a stale form cannot undo a pause', async (who) => {
    // The fake jsonb patches conversations only (see «the owner can»): what matters is the patch sent.
    const jsonb = require('../src/db/jsonb');
    const sent = jest.spyOn(jsonb, 'patchJson').mockResolvedValue({ ok: true, count: 1 });
    const res = await request(app).patch('/api/businesses/b1').set(as(who))
      .send({ ai_config: { greeting_message: 'مرحبا', enabled: true } });
    expect(res.status).toBe(200);
    expect(sent).toHaveBeenCalledWith('businesses', 'b1', 'ai_config', { greeting_message: 'مرحبا' });
    expect(db.store.accountEvents.map((e) => e.data.ai_config_keys)).toEqual([['greeting_message']]);
    // Alone, the flag is the owner's pause switch (P3, below); for SHIFT it is not a setting at all
    // (its pause is PATCH /api/admin/accounts/:id/bot, with a reason).
    if (who === 'admin') {
      const only = await request(app).patch('/api/businesses/b1').set(as(who)).send({ ai_config: { enabled: false } });
      expect(only.status).toBe(400);
    }
  });
});
