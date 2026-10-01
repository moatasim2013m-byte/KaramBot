/**
 * The owner's alert numbers: the setting the staff alerts depend on.
 *
 * `handoff`, `ai_failure`, `needs_team` and `billing` alerts are built and wired, but they reach
 * nobody unless ai_config.alert_wa_numbers holds a number — and until now nothing could set it.
 *
 * ai_config is PATCHED in Postgres (`jsonb ||`) rather than assigned, because assigning the
 * column replaces the whole object: a PATCH carrying only a greeting would have deleted the
 * alert numbers and switched every alert off, silently. The merge itself belongs to
 * db/jsonb.patchJson (covered against a real Postgres in tests/integration/pg.test.js); what
 * these tests pin is that the route sends the right patch and nothing else.
 */
require('./setup');

jest.mock('../src/config/prisma', () => ({
  user: { findUnique: jest.fn() },
  business: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
}));
jest.mock('../src/db/jsonb', () => ({ patchJson: jest.fn() }));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const jsonb = require('../src/db/jsonb');
const app = require('../src/app');

const OWNER = { id: 'u1', name: 'O', email: 'o@x.jo', role: 'business_owner', business_id: 'b1', active: true };
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: 'u1' }, process.env.JWT_SECRET)}` });

/** The ai_config patch the route sent to Postgres. */
const sentPatch = () => {
  const call = jsonb.patchJson.mock.calls.find((c) => c[2] === 'ai_config');
  return call ? call[3] : null;
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(OWNER);
  prisma.business.findUnique.mockResolvedValue({ id: 'b1', ai_config: {} });
  prisma.business.update.mockImplementation(({ data }) => Promise.resolve({ id: 'b1', ...data }));
  jsonb.patchJson.mockResolvedValue({ ok: true, count: 1 });
});

test('an owner can set the number their bot should alert', async () => {
  const res = await request(app).patch('/api/businesses/b1').set(auth())
    .send({ ai_config: { alert_wa_numbers: ['+962 79 638 1676'] } });

  expect(res.status).toBe(200);
  expect(jsonb.patchJson).toHaveBeenCalledWith('businesses', 'b1', 'ai_config', { alert_wa_numbers: ['962796381676'] });
});

test('the local form a Jordanian owner actually types is stored as WhatsApp needs it', async () => {
  // 0796381676 would be accepted by a digits-only check and then silently refused by WhatsApp.
  await request(app).patch('/api/businesses/b1').set(auth())
    .send({ ai_config: { alert_wa_numbers: ['0796381676'] } });

  expect(sentPatch().alert_wa_numbers).toEqual(['962796381676']);
});

test('the same number written two ways is stored once', async () => {
  await request(app).patch('/api/businesses/b1').set(auth())
    .send({ ai_config: { alert_wa_numbers: ['0796381676', '+962796381676', '00962796381676'] } });

  expect(sentPatch().alert_wa_numbers).toEqual(['962796381676']);
});

test('junk entries are dropped without rejecting the ones that are fine', async () => {
  // A typo in one number must not stop the owner saving the other.
  await request(app).patch('/api/businesses/b1').set(auth())
    .send({ ai_config: { alert_wa_numbers: ['962796381676', '123', '', null, 'abc'] } });

  expect(sentPatch().alert_wa_numbers).toEqual(['962796381676']);
});

test('editing another setting patches only that setting, so the numbers survive', async () => {
  await request(app).patch('/api/businesses/b1').set(auth())
    .send({ ai_config: { greeting_message: 'أهلاً' } });

  // No alert_wa_numbers key at all: Postgres keeps whatever is already there.
  expect(sentPatch()).toEqual({ greeting_message: 'أهلاً' });
});

test('an owner can still clear the numbers deliberately', async () => {
  await request(app).patch('/api/businesses/b1').set(auth())
    .send({ ai_config: { alert_wa_numbers: [] } });

  expect(sentPatch()).toEqual({ alert_wa_numbers: [] });
});

test('a setting outside the whitelist never reaches the patch', async () => {
  const res = await request(app).patch('/api/businesses/b1').set(auth())
    .send({ ai_config: { provider: 'anthropic', some_internal_flag: true } });

  expect(res.status).toBe(200);
  expect(sentPatch()).toEqual({ provider: 'anthropic' });
});

test('an ai_config that is not an object is refused rather than spread into numeric keys', async () => {
  for (const bad of ['abc', ['a'], 42]) {
    const res = await request(app).patch('/api/businesses/b1').set(auth()).send({ ai_config: bad });
    expect(res.status).toBe(400);
  }
  expect(jsonb.patchJson).not.toHaveBeenCalled();
});

test('a PATCH of ai_config alone still answers with the business', async () => {
  // The column patch is not a prisma.update, so the row has to be read back deliberately.
  const res = await request(app).patch('/api/businesses/b1').set(auth())
    .send({ ai_config: { greeting_message: 'أهلاً' } });

  expect(res.status).toBe(200);
  expect(res.body.business.id).toBe('b1');
  expect(prisma.business.update).not.toHaveBeenCalled();
});

test('a patch against a business that does not exist is a 404', async () => {
  jsonb.patchJson.mockResolvedValue({ ok: false, count: 0 });
  const res = await request(app).patch('/api/businesses/b1').set(auth())
    .send({ ai_config: { greeting_message: 'أهلاً' } });

  expect(res.status).toBe(404);
});
