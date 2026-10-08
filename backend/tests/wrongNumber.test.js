/**
 * «لا، ليس هذا الرقم» on /join (docs/panels/spec.md step 7; P2 review). The screen tells the owner
 * «سيتواصل معك فريق شِفت», so pressing it must reach SHIFT: the shop's onboarding gets
 * needs_operator, AccountEvent wrong_number is written (the board's «بحاجة لشِفت»), and SHIFT is
 * alerted, once. Only the owner's own account is touched. Real app on the in-memory database.
 */
require('./setup');

jest.mock('axios');
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('./helpers/fakeDb').getFakeDb();
const settings = require('../src/services/platformSettings');
const alerts = require('../src/services/alerts');
const { deriveCard } = require('../src/routes/adminAccounts');
const app = require('../src/app');

const URL = '/api/whatsapp/embedded-signup/wrong-number';
let nonce = 0;
const as = (userId) => ({ Authorization: `Bearer ${jwt.sign({ id: userId, n: (nonce += 1) }, process.env.JWT_SECRET)}` });

function seed({ open = true } = {}) {
  db.seed({
    businesses: [
      { id: 'biz_a', name: 'مطعم الشام', slug: 'a', wa_phone_number_id: 'PA', wa_display_phone: '+962 7 9123 4567' },
      { id: 'biz_b', name: 'صالون ريم', slug: 'b', wa_phone_number_id: 'PB' },
    ],
    users: [
      { id: 'u_owner_a', role: 'business_owner', business_id: 'biz_a' },
      { id: 'u_staff_a', role: 'staff', business_id: 'biz_a' },
    ],
    whatsappOnboardings: [
      { id: 'onb_a', business_id: 'biz_a', app_id: 'app', meta_business_id: 'm', waba_id: 'WA', phone_number_id: 'PA', step: 'done' },
      { id: 'onb_b', business_id: 'biz_b', app_id: 'app', meta_business_id: 'm', waba_id: 'WB', phone_number_id: 'PB', step: 'done' },
    ],
    ...(open ? { platformSettings: [{ key: 'es_owner_enabled', value: true }] } : {}),
  });
  settings.clearCache();
}

let notify;
beforeEach(() => {
  db.reset();
  jest.restoreAllMocks();
  notify = jest.spyOn(alerts, 'notifyShift').mockResolvedValue(null);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

test('the owner\'s «لا» sets needs_operator, logs wrong_number and alerts SHIFT, once', async () => {
  seed();
  const res = await request(app).post(URL).set(as('u_owner_a'));
  expect(res.status).toBe(200);
  expect(db.store.whatsappOnboardings.find((o) => o.id === 'onb_a').needs_operator).toBe(true);
  expect(db.store.accountEvents.filter((e) => e.type === 'wrong_number')).toEqual([
    expect.objectContaining({ business_id: 'biz_a', actor_kind: 'owner', actor_user_id: 'u_owner_a' }),
  ]);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({ reason: 'needs_operator', businessId: 'biz_a' }));

  // Another shop is untouched.
  expect(db.store.whatsappOnboardings.find((o) => o.id === 'onb_b').needs_operator).toBeFalsy();

  // Pressing again while SHIFT has not dealt with it: no second alert or event.
  await request(app).post(URL).set(as('u_owner_a'));
  expect(notify).toHaveBeenCalledTimes(1);
  expect(db.store.accountEvents.filter((e) => e.type === 'wrong_number')).toHaveLength(1);

  // The board reads it: «بحاجة لشِفت» on the card.
  const { card } = deriveCard({
    business: db.store.businesses[0], owner: null, invite: null,
    onboarding: db.store.whatsappOnboardings[0], knowledge: [],
    events: [...db.store.accountEvents].reverse(), now: new Date(), ownerConnect: true,
  });
  expect(card.needs_operator).toBe(true);
});

test('owner only, and a body business_id is refused', async () => {
  seed();
  expect((await request(app).post(URL).set(as('u_staff_a'))).status).toBe(403);
  expect((await request(app).post(URL).set(as('u_owner_a')).send({ business_id: 'biz_b' })).status).toBe(400);
  expect(notify).not.toHaveBeenCalled();
  expect(db.store.accountEvents.filter((e) => e.type === 'wrong_number')).toHaveLength(0);
});

test('/join calls it before showing «سيتواصل معك فريق شِفت»', () => {
  const join = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/JoinPage.jsx'), 'utf8');
  const endpoints = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/whatsapp/ConnectWhatsApp.jsx'), 'utf8');
  expect(endpoints).toMatch(/wrongNumber: '\/whatsapp\/embedded-signup\/wrong-number'/);
  // Inside the confirm step, the post comes before the move to the «wrong_number» screen.
  const confirm = join.slice(join.indexOf('function ConfirmStep'), join.indexOf('function WrongNumberStep'));
  const post = confirm.indexOf('await api.post(OWNER_ENDPOINTS.wrongNumber)');
  expect(post).toBeGreaterThan(-1);
  expect(confirm.indexOf('onNo()', post)).toBeGreaterThan(post);
  expect(confirm).toMatch(/onClick=\{no\}/);
});
