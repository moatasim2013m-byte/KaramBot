/**
 * Platform settings (services/platformSettings.js): the switches the owner changes without a deploy.
 *
 * An empty table must be a working platform with the decided defaults (decisions-2026-10-08.md),
 * a stored object must be merged over its default rather than replace it, and every change must
 * leave an AccountEvent naming who made it. The connect button for owners hangs on one of these
 * (es_owner_enabled), so requireSetting has to fail closed.
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const express = require('express');
const request = require('supertest');
const db = require('./helpers/fakeDb').getFakeDb();
const prisma = require('../src/config/prisma');
const settings = require('../src/services/platformSettings');

let errorSpy;
beforeEach(() => {
  db.reset();
  settings.clearCache();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

const DEFAULTS = {
  es_owner_enabled: false,
  campaign: { name: 'حملة إربد — الشهر الأول مجاني', trial_days: 30, trial_starts: 'first_reply', backstop_days: 14 },
  ai_limits: { reply_month_default: 1000, media_day_default: 30, platform_day_ceiling: 2000, ceiling_policy: 'trials_first' },
  payment_instructions: { cliq_alias: '', iban: '', holder: '' },
  late_policy: { grace_days: 7 },
  invite_ttl_days: 7,
  shift_alert_numbers: [],
  self_signup: { enabled: false, daily_cap: 5 },
  coexistence: { enabled: false },
  provider_status: null,
};

describe('defaults', () => {
  test('an empty table answers with every decided default', async () => {
    expect(await settings.getAll()).toEqual(DEFAULTS);
    expect(settings.KEYS.sort()).toEqual(Object.keys(DEFAULTS).sort());
    expect(settings.defaults()).toEqual(DEFAULTS);
  });

  test('get returns one default', async () => {
    expect(await settings.get('es_owner_enabled')).toBe(false);
    expect(await settings.get('ai_limits')).toEqual(DEFAULTS.ai_limits);
    expect(await settings.get('provider_status')).toBeNull();
  });

  test('a caller cannot change the defaults by editing what it got back', async () => {
    const limits = await settings.get('ai_limits');
    limits.platform_day_ceiling = 1;
    (await settings.get('shift_alert_numbers')).push('962790000000');
    settings.defaults().campaign.trial_days = 1;
    settings.clearCache();
    expect(await settings.get('ai_limits')).toEqual(DEFAULTS.ai_limits);
    expect(await settings.get('shift_alert_numbers')).toEqual([]);
    expect(await settings.get('campaign')).toEqual(DEFAULTS.campaign);
  });

  test('an unknown key is an error, not undefined', async () => {
    await expect(settings.get('es_owner_enabeld')).rejects.toMatchObject({ code: 'UNKNOWN_SETTING', status: 400 });
  });

  test('a failed read falls back to the defaults and is not cached', async () => {
    db.seed({ platformSettings: [{ key: 'es_owner_enabled', value: true }] });
    db.failNext('platformSetting.findMany', new Error('db down'));
    expect(await settings.get('es_owner_enabled')).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('read failed, using defaults: db down'));
    expect(await settings.get('es_owner_enabled')).toBe(true);
  });
});

describe('stored values', () => {
  test('a stored object is merged over its default, field by field', async () => {
    db.seed({
      platformSettings: [
        { key: 'ai_limits', value: { platform_day_ceiling: 500 } },
        { key: 'payment_instructions', value: { cliq_alias: 'SHIFTJO', holder: 'شِفت' } },
      ],
    });
    expect(await settings.get('ai_limits')).toEqual({ ...DEFAULTS.ai_limits, platform_day_ceiling: 500 });
    expect(await settings.get('payment_instructions')).toEqual({ cliq_alias: 'SHIFTJO', iban: '', holder: 'شِفت' });
  });

  test('scalars and lists replace the default', async () => {
    db.seed({
      platformSettings: [
        { key: 'es_owner_enabled', value: true },
        { key: 'invite_ttl_days', value: 3 },
        { key: 'shift_alert_numbers', value: ['962790000001'] },
      ],
    });
    const all = await settings.getAll();
    expect(all.es_owner_enabled).toBe(true);
    expect(all.invite_ttl_days).toBe(3);
    expect(all.shift_alert_numbers).toEqual(['962790000001']);
  });

  test('a stored key this code does not know is ignored', async () => {
    db.seed({ platformSettings: [{ key: 'retired_switch', value: true }] });
    expect(await settings.getAll()).toEqual(DEFAULTS);
  });
});

describe('cache', () => {
  test('one read serves 30 seconds, then the table is read again', async () => {
    const spy = jest.spyOn(prisma.platformSetting, 'findMany');
    let now = Date.parse('2026-10-08T10:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    await settings.get('es_owner_enabled');
    await settings.get('campaign');
    await settings.getAll();
    expect(spy).toHaveBeenCalledTimes(1);

    // Changed behind the cache's back (another instance): not seen until it expires.
    db.store.platformSettings.push({ key: 'es_owner_enabled', value: true, updated_by: null, updated_at: new Date() });
    now += 29 * 1000;
    expect(await settings.get('es_owner_enabled')).toBe(false);
    now += 2 * 1000;
    expect(await settings.get('es_owner_enabled')).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test('concurrent first reads share one query', async () => {
    const spy = jest.spyOn(prisma.platformSetting, 'findMany');
    await Promise.all([settings.get('campaign'), settings.get('ai_limits'), settings.getAll()]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('set clears the cache at once', async () => {
    expect(await settings.get('es_owner_enabled')).toBe(false);
    await settings.set('es_owner_enabled', true, 'admin1');
    expect(await settings.get('es_owner_enabled')).toBe(true);
  });
});

describe('set', () => {
  test('stores the value, who set it, and an AccountEvent with before and after', async () => {
    db.seed({ platformSettings: [{ key: 'late_policy', value: { grace_days: 7 } }] });
    const effective = await settings.set('late_policy', { grace_days: 10 }, 'admin1');
    expect(effective).toEqual({ grace_days: 10 });
    expect(db.store.platformSettings).toEqual([
      expect.objectContaining({ key: 'late_policy', value: { grace_days: 10 }, updated_by: 'admin1' }),
    ]);
    expect(db.store.accountEvents).toHaveLength(1);
    expect(db.store.accountEvents[0]).toMatchObject({
      business_id: null,
      actor_user_id: 'admin1',
      actor_kind: 'shift',
      type: 'platform_setting_changed',
      data: { key: 'late_policy', before: { grace_days: 7 }, after: { grace_days: 10 } },
    });
  });

  test('a first write records before as null and returns the merged value', async () => {
    const effective = await settings.set('payment_instructions', { cliq_alias: 'SHIFTJO' }, 'admin1');
    expect(effective).toEqual({ cliq_alias: 'SHIFTJO', iban: '', holder: '' });
    expect(db.store.accountEvents[0].data).toEqual({
      key: 'payment_instructions', before: null, after: { cliq_alias: 'SHIFTJO' },
    });
  });

  test('written by code (provider_status), the actor is the system', async () => {
    const status = { provider: 'gemini', kind: 'quota', last_seen: '2026-10-08T10:00:00.000Z' };
    expect(await settings.set('provider_status', status)).toEqual(status);
    expect(db.store.accountEvents[0]).toMatchObject({ actor_user_id: null, actor_kind: 'system' });
    expect(await settings.get('provider_status')).toEqual(status);
  });

  test('null removes the stored row, which puts the default back', async () => {
    await settings.set('es_owner_enabled', true, 'admin1');
    expect(await settings.set('es_owner_enabled', null, 'admin1')).toBe(false);
    expect(db.store.platformSettings).toHaveLength(0);
    expect(await settings.get('es_owner_enabled')).toBe(false);
    expect(db.store.accountEvents[1].data).toEqual({ key: 'es_owner_enabled', before: true, after: null });
  });

  test('an unknown key is refused and nothing is written', async () => {
    await expect(settings.set('es_owner_enable', true, 'admin1')).rejects.toMatchObject({ code: 'UNKNOWN_SETTING', status: 400 });
    expect(db.store.platformSettings).toHaveLength(0);
    expect(db.store.accountEvents).toHaveLength(0);
  });

  test('a value of the wrong shape is refused: "false" is truthy', async () => {
    await expect(settings.set('es_owner_enabled', 'false', 'admin1')).rejects.toMatchObject({ code: 'BAD_SETTING_VALUE' });
    await expect(settings.set('ai_limits', 2000, 'admin1')).rejects.toMatchObject({ code: 'BAD_SETTING_VALUE' });
    await expect(settings.set('shift_alert_numbers', '9627', 'admin1')).rejects.toMatchObject({ code: 'BAD_SETTING_VALUE' });
    await expect(settings.set('invite_ttl_days', Number.NaN, 'admin1')).rejects.toMatchObject({ code: 'BAD_SETTING_VALUE' });
    await expect(settings.set('provider_status', 'down')).rejects.toMatchObject({ code: 'BAD_SETTING_VALUE' });
    expect(db.store.platformSettings).toHaveLength(0);
  });

  test('a failed event write does not undo or fail the change', async () => {
    db.failNext('accountEvent.create', new Error('log table locked'));
    await expect(settings.set('invite_ttl_days', 3, 'admin1')).resolves.toBe(3);
    expect(await settings.get('invite_ttl_days')).toBe(3);
  });
});

describe('requireSetting', () => {
  function appWith(...middleware) {
    const app = express();
    app.get('/x', ...middleware, (req, res) => res.json({ ok: true }));
    return app;
  }

  test('closed by default: 503 with the Arabic message', async () => {
    const res = await request(appWith(settings.requireSetting('es_owner_enabled', 'ربط واتساب غير متاح بعد'))).get('/x');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'ربط واتساب غير متاح بعد' });
  });

  test('open when the setting is on', async () => {
    db.seed({ platformSettings: [{ key: 'es_owner_enabled', value: true }] });
    const res = await request(appWith(settings.requireSetting('es_owner_enabled', 'x'))).get('/x');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('a switch stored as {enabled} is on only when enabled is true', async () => {
    const mw = settings.requireSetting('self_signup', 'التسجيل مغلق');
    expect((await request(appWith(mw)).get('/x')).status).toBe(503);
    await settings.set('self_signup', { enabled: true }, 'admin1');
    expect((await request(appWith(mw)).get('/x')).status).toBe(200);
  });

  test('without a message it still answers in Arabic', async () => {
    const res = await request(appWith(settings.requireSetting('coexistence'))).get('/x');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/[؀-ۿ]/);
  });

  test('fails closed when the settings cannot be read', async () => {
    db.seed({ platformSettings: [{ key: 'es_owner_enabled', value: true }] });
    db.failNext('platformSetting.findMany', new Error('db down'));
    const res = await request(appWith(settings.requireSetting('es_owner_enabled', 'x'))).get('/x');
    expect(res.status).toBe(503);
  });

  test('a typo in the key fails when the route is defined, not on every request', () => {
    expect(() => settings.requireSetting('es_owner_enabeld')).toThrow(/unknown platform setting/);
  });

  test('isOn', () => {
    expect(settings.isOn(true)).toBe(true);
    expect(settings.isOn(false)).toBe(false);
    expect(settings.isOn(null)).toBe(false);
    expect(settings.isOn({ enabled: false, daily_cap: 5 })).toBe(false);
    expect(settings.isOn({ enabled: true })).toBe(true);
    expect(settings.isOn({ provider: 'gemini' })).toBe(true);
  });
});
