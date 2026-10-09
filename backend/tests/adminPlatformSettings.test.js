/**
 * «إعدادات المنصة» made real: GET and PATCH /api/admin/platform-settings over the PlatformSetting
 * rows the code obeys. What a person can get wrong is refused in Arabic before anything is stored;
 * a block may be sent partly; null restores the default; every save leaves
 * platform_setting_changed with the value before and after. provider_status and coexistence are
 * not editable here, and public self-signup opens only with a typed confirmation
 * (tests/publicSignup.test.js).
 */
require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('./helpers/fakeDb').getFakeDb();
const app = require('../src/app');
const platformSettings = require('../src/services/platformSettings');

const auth = (id = 'admin1') => ({ Authorization: `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}` });
const patch = (body, id) => request(app).patch('/api/admin/platform-settings').set(auth(id)).send(body);
const stored = (key) => (db.store.platformSettings.find((r) => r.key === key) || {}).value;
const changes = () => db.store.accountEvents.filter((e) => e.type === 'platform_setting_changed');

beforeEach(() => {
  db.reset();
  platformSettings.clearCache();
  db.seed({
    businesses: [{ id: 'b1', name: 'مطعم' }],
    users: [
      { id: 'admin1', name: 'معتصم', role: 'platform_admin', business_id: null, active: true },
      { id: 'owner1', name: 'أبو خالد', role: 'business_owner', business_id: 'b1', active: true },
    ],
  });
});

test('GET returns every effective setting, the defaults, what is editable and the read-only Meta block', async () => {
  const res = await request(app).get('/api/admin/platform-settings').set(auth());
  expect(res.status).toBe(200);
  expect(res.body.settings).toMatchObject({ es_owner_enabled: false, late_policy: { grace_days: 7 }, ai_limits: { platform_day_ceiling: 2000 } });
  expect(res.body.defaults.campaign.trial_days).toBe(30);
  expect(res.body.editable).toEqual(expect.arrayContaining(['campaign', 'ai_limits', 'late_policy', 'payment_instructions']));
  expect(res.body.editable).not.toContain('provider_status');
  expect(res.body.editable).not.toContain('coexistence');
  expect(res.body.meta).toMatchObject({ config_id: expect.any(String) });
});

test('a partial block is merged over the current value, stored, and logged with before and after', async () => {
  const res = await patch({ key: 'late_policy', value: { grace_days: 10 } });
  expect(res.status).toBe(200);
  expect(res.body.value).toEqual({ grace_days: 10 });
  expect(stored('late_policy')).toEqual({ grace_days: 10 });

  await patch({ key: 'campaign', value: { trial_days: 45 } });
  expect(stored('campaign')).toMatchObject({ trial_days: 45, trial_starts: 'first_reply', backstop_days: 14, name: expect.stringMatching(/[ء-ي]/) });

  const log = changes();
  expect(log).toHaveLength(2);
  expect(log[0]).toMatchObject({ business_id: null, actor_kind: 'shift', actor_user_id: 'admin1', data: { key: 'late_policy', before: null, after: { grace_days: 10 } } });
});

test('null puts the default back', async () => {
  await patch({ key: 'invite_ttl_days', value: 3 });
  expect(stored('invite_ttl_days')).toBe(3);
  const res = await patch({ key: 'invite_ttl_days', value: null });
  expect(res.body.value).toBe(7);
  expect(stored('invite_ttl_days')).toBeUndefined();
});

describe('validation, in Arabic, before anything is stored', () => {
  test.each([
    ['campaign', { trial_days: 0 }, 'مدة الفترة المجانية'],
    ['campaign', { trial_starts: 'whenever' }, 'تبدأ الفترة المجانية'],
    ['campaign', { name: '' }, 'اسم الحملة'],
    ['ai_limits', { platform_day_ceiling: -1 }, 'سقف الردود'],
    ['ai_limits', { reply_month_default: 1.5 }, 'الردود الشهرية'],
    ['ai_limits', { ceiling_policy: 'nobody' }, 'عند بلوغ السقف'],
    ['late_policy', { grace_days: 90 }, 'أيام السماح'],
    ['late_policy', 'seven', 'غير صحيحة'],
    ['invite_ttl_days', 0, 'مدة صلاحية'],
    ['payment_instructions', { iban: 'JO12 not an iban' }, 'IBAN'],
    ['shift_alert_numbers', ['hello'], 'رقم التنبيه'],
    ['shift_alert_numbers', '0791234567', 'قائمة'],
    ['es_owner_enabled', 'true', 'الربط الذاتي'],
    ['self_signup', { enabled: true }, 'بعد أول 10 زبائن'],
  ])('%s = %j is refused', async (key, value, words) => {
    const res = await patch({ key, value });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(words);
    expect(db.store.platformSettings).toHaveLength(0);
    expect(changes()).toHaveLength(0);
  });

  test('settings the code writes, or that the spec keeps closed, are not editable', async () => {
    for (const key of ['provider_status', 'coexistence', 'nonsense']) {
      const res = await patch({ key, value: { enabled: true } });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/[ء-ي]/);
    }
    expect((await patch({ key: 'late_policy' })).status).toBe(400);
  });

  test('values are cleaned: an IBAN in groups, mobiles in any form, a numeric string', async () => {
    await patch({ key: 'payment_instructions', value: { iban: 'jo94 cbjo 0010 0000 0000 0131 0003 02', cliq_alias: '  SHIFT  ', holder: 'شركة شفت' } });
    expect(stored('payment_instructions')).toEqual({ iban: 'JO94CBJO0010000000000131000302', cliq_alias: 'SHIFT', holder: 'شركة شفت' });
    await patch({ key: 'shift_alert_numbers', value: ['0791234567', '+962 79 123 4567', '00962781112223'] });
    expect(stored('shift_alert_numbers')).toEqual(['962791234567', '962781112223']);
    await patch({ key: 'invite_ttl_days', value: '10' });
    expect(stored('invite_ttl_days')).toBe(10);
  });

  test('self-signup keeps only its daily cap until after the first ten', async () => {
    await patch({ key: 'self_signup', value: { daily_cap: 3 } });
    expect(stored('self_signup')).toEqual({ enabled: false, daily_cap: 3 });
  });
});

test('a saved switch is what the code reads next', async () => {
  await patch({ key: 'es_owner_enabled', value: true });
  expect(await platformSettings.get('es_owner_enabled')).toBe(true);
});

test('SHIFT only', async () => {
  expect((await patch({ key: 'late_policy', value: { grace_days: 1 } }, 'owner1')).status).toBe(403);
  expect((await request(app).get('/api/admin/platform-settings').set(auth('owner1'))).status).toBe(403);
});
