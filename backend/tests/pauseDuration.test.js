/**
 * «أوقف البوت 30 دقيقة»: a pause that lifts itself.
 *
 *  - PATCH /api/admin/accounts/:id/bot takes an optional duration_minutes (5 to 1440). With one,
 *    ai_config.resume_at is stored next to paused_by 'shift'; without one, and on a resume, it goes.
 *  - shiftSweeper.sweepBotPauses turns the bot back on once resume_at has passed, the way the resume
 *    button does, and logs bot_resumed «انتهت مدة الإيقاف». It never lifts the owner's pause, the
 *    late policy's, or a pause SHIFT has since renewed or made open-ended.
 *  - The panels read the end time (bot_resume_at, agent.resume_at) only for a live SHIFT pause.
 *
 * The real route and sweeper step over the in-memory fakeDb.
 */

require('./setup');

jest.mock('axios');
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('./helpers/fakeDb').getFakeDb();
const app = require('../src/app');
const { sweepBotPauses } = require('../src/services/shiftSweeper');
const { botResumeAt, agentState } = require('../src/services/accountHealth');

const MIN = 60 * 1000;
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: 'admin1' }, process.env.JWT_SECRET)}` });
const patch = (body) => request(app).patch('/api/admin/accounts/b1/bot').set(auth()).send(body);
const shop = () => db.store.businesses.find((b) => b.id === 'b1');
const events = (type) => db.store.accountEvents.filter((e) => !type || e.type === type);

function seed(ai_config = {}) {
  db.seed({
    users: [{ id: 'admin1', name: 'A', email: 'a@shifts-ai.com', role: 'platform_admin', business_id: null, active: true }],
    businesses: [{ id: 'b1', name: 'صيدلية النور', business_type: 'generic', status: 'active', ai_config: { greeting_message: 'أهلًا', ...ai_config } }],
  });
}

// The fakeDb's patchJson writes conversations only; businesses.ai_config gets the same top-level
// merge here (remove first, then replace each key), as jsonb.patchJson does in Postgres.
const fakePatchJson = db.jsonb.patchJson;
db.jsonb.patchJson = async (table, id, column, patch, opts = {}) => {
  if (table !== 'businesses') return fakePatchJson(table, id, column, patch, opts);
  const row = db.store.businesses.find((b) => b.id === id);
  if (!row) return { ok: false, count: 0 };
  const next = { ...(row[column] || {}) };
  for (const k of opts.remove || []) delete next[k];
  Object.assign(next, JSON.parse(JSON.stringify(patch || {})));
  row[column] = next;
  return { ok: true, count: 1 };
};

beforeEach(() => db.reset());

describe('PATCH /accounts/:id/bot with duration_minutes', () => {
  test.each([[0], [4], [1441], [30.5], ['abc'], [-30]])('%p minutes is refused in Arabic and changes nothing', async (d) => {
    seed();
    const res = await patch({ enabled: false, reason: 'صيانة', duration_minutes: d });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/مدة الإيقاف/);
    expect(shop().ai_config.enabled).toBeUndefined();
    expect(events()).toHaveLength(0);
  });

  test('a timed pause stores resume_at beside paused_by and logs it', async () => {
    seed();
    const before = Date.now();
    const res = await patch({ enabled: false, reason: 'صيانة', duration_minutes: 30 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: false, changed: true });
    const cfg = shop().ai_config;
    expect(cfg).toMatchObject({ enabled: false, paused_by: 'shift', greeting_message: 'أهلًا' });
    const at = Date.parse(cfg.resume_at);
    expect(at).toBeGreaterThanOrEqual(before + 30 * MIN);
    expect(at).toBeLessThanOrEqual(Date.now() + 30 * MIN);
    expect(res.body.resume_at).toBe(cfg.resume_at);
    expect(events('bot_paused')[0].data).toEqual({ reason: 'صيانة', resume_at: cfg.resume_at, duration_minutes: 30 });
  });

  test('a duration given as a numeric string is taken', async () => {
    seed();
    expect((await patch({ enabled: false, reason: 'صيانة', duration_minutes: '60' })).status).toBe(200);
    expect(shop().ai_config.resume_at).toEqual(expect.any(String));
  });

  test('a pause without a duration removes a resume_at left from before', async () => {
    seed({ enabled: false, paused_by: 'owner', resume_at: new Date(Date.now() + 10 * MIN).toISOString() });
    const res = await patch({ enabled: false, reason: 'حتى أعيد تشغيله' });
    expect(res.body).toEqual({ enabled: false, changed: true });
    expect(shop().ai_config).toMatchObject({ enabled: false, paused_by: 'shift' });
    expect(shop().ai_config).not.toHaveProperty('resume_at');
  });

  test('making SHIFT\'s timed pause open-ended is a change: resume_at goes', async () => {
    seed({ enabled: false, paused_by: 'shift', resume_at: new Date(Date.now() + 10 * MIN).toISOString() });
    const res = await patch({ enabled: false, reason: 'حتى أعيد تشغيله' });
    expect(res.body.changed).toBe(true);
    expect(shop().ai_config).not.toHaveProperty('resume_at');
  });

  test('an open-ended SHIFT pause pressed again without a duration still changes nothing', async () => {
    seed({ enabled: false, paused_by: 'shift' });
    const res = await patch({ enabled: false, reason: 'مرة ثانية' });
    expect(res.body).toEqual({ enabled: false, changed: false });
    expect(events()).toHaveLength(0);
  });

  test('resuming clears resume_at with the other markers', async () => {
    seed({ enabled: false, paused_by: 'shift', resume_at: new Date(Date.now() + 10 * MIN).toISOString() });
    const res = await patch({ enabled: true, duration_minutes: 30 });
    expect(res.body).toEqual({ enabled: true, changed: true });
    expect(shop().ai_config).toEqual({ greeting_message: 'أهلًا', enabled: true });
  });
});

describe('sweepBotPauses', () => {
  const past = () => new Date(Date.now() - MIN).toISOString();

  test('an expired SHIFT pause is lifted like the resume button, with an automatic bot_resumed', async () => {
    seed({ enabled: false, paused_by: 'shift', resume_at: past() });
    expect(await sweepBotPauses(new Date())).toBe(1);
    expect(shop().ai_config).toEqual({ greeting_message: 'أهلًا', enabled: true });
    const [ev] = events('bot_resumed');
    expect(ev).toMatchObject({ actor_kind: 'system', actor_user_id: null });
    expect(ev.data).toMatchObject({ reason: 'انتهت مدة الإيقاف', automatic: true });
    // A second sweep finds nothing to do.
    expect(await sweepBotPauses(new Date())).toBe(0);
    expect(events('bot_resumed')).toHaveLength(1);
  });

  test('a pause whose time has not come stays', async () => {
    seed({ enabled: false, paused_by: 'shift', resume_at: new Date(Date.now() + 5 * MIN).toISOString() });
    expect(await sweepBotPauses(new Date())).toBe(0);
    expect(shop().ai_config.enabled).toBe(false);
  });

  test.each([
    ['the owner\'s pause', { enabled: false, paused_by: 'owner' }],
    ['the late policy\'s pause', { enabled: false, paused_by: 'shift', pause_reason: 'late_payment' }],
    ['a SHIFT pause made open-ended since (no resume_at)', { enabled: false, paused_by: 'shift', resume_at: undefined }],
    ['a bot already back on', { enabled: true }],
  ])('%s is never lifted', async (_, cfg) => {
    seed({ resume_at: past(), ...cfg });
    if (cfg.resume_at === undefined && 'resume_at' in cfg) delete shop().ai_config.resume_at;
    const before = JSON.parse(JSON.stringify(shop().ai_config));
    expect(await sweepBotPauses(new Date())).toBe(0);
    expect(shop().ai_config).toEqual(before);
    expect(events()).toHaveLength(0);
  });

  test('re-paused through the route without a duration: the sweeper leaves it', async () => {
    seed();
    await patch({ enabled: false, reason: 'صيانة', duration_minutes: 30 });
    await patch({ enabled: false, reason: 'حتى أعيد تشغيله' });
    expect(await sweepBotPauses(new Date(Date.now() + 31 * MIN))).toBe(0);
    expect(shop().ai_config).toMatchObject({ enabled: false, paused_by: 'shift' });
  });

  test('a pause renewed after the sweep read it is not lifted: resume_at no longer matches', async () => {
    seed({ enabled: false, paused_by: 'shift', resume_at: past() });
    const renewed = new Date(Date.now() + 60 * MIN).toISOString();
    // SHIFT presses «30 دقيقة» again between the sweep's read and its claim.
    const realFind = db.prisma.business.findMany;
    db.prisma.business.findMany = async (args) => {
      const rows = await realFind(args);
      shop().ai_config = { ...shop().ai_config, resume_at: renewed };
      return rows;
    };
    try {
      expect(await sweepBotPauses(new Date())).toBe(0);
    } finally {
      db.prisma.business.findMany = realFind;
    }
    expect(shop().ai_config).toMatchObject({ enabled: false, paused_by: 'shift', resume_at: renewed });
  });

  test('the late policy laying its pause over it mid-sweep is left alone', async () => {
    seed({ enabled: false, paused_by: 'shift', resume_at: past() });
    const realFindUnique = db.prisma.business.findUnique;
    db.prisma.business.findUnique = async (args) => {
      shop().ai_config = { ...shop().ai_config, pause_reason: 'late_payment' };
      return realFindUnique(args);
    };
    try {
      expect(await sweepBotPauses(new Date())).toBe(0);
    } finally {
      db.prisma.business.findUnique = realFindUnique;
    }
    expect(shop().ai_config).toMatchObject({ enabled: false, paused_by: 'shift', pause_reason: 'late_payment' });
  });
});

describe('the end time on the panels', () => {
  const at = new Date(Date.now() + 30 * MIN).toISOString();

  test('a live SHIFT timed pause shows its end; any other pause shows none', () => {
    expect(botResumeAt({ enabled: false, paused_by: 'shift', resume_at: at })).toBe(at);
    expect(botResumeAt({ enabled: false, paused_by: 'owner', resume_at: at })).toBeNull();
    expect(botResumeAt({ enabled: false, paused_by: 'shift', pause_reason: 'late_payment', resume_at: at })).toBeNull();
    expect(botResumeAt({ enabled: true, resume_at: at })).toBeNull();
    expect(botResumeAt({ enabled: false, paused_by: 'shift', resume_at: null })).toBeNull();
    expect(botResumeAt(null)).toBeNull();
  });

  test('the paused agent state carries it', () => {
    expect(agentState({ ai_config: { enabled: false, paused_by: 'shift', resume_at: at } })).toMatchObject({ state: 'paused', resume_at: at });
    expect(agentState({ ai_config: { enabled: false, paused_by: 'shift' } })).not.toHaveProperty('resume_at');
  });
});
