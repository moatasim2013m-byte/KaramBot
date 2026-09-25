/**
 * «جرّب البوت» goes through the real workflow and sends nothing.
 *
 * The check this replaces built its own prompt and called the model directly, so a `generic`
 * account — fixed greeting in production, no model call — came back fluent. These tests hold
 * the dry run to production's behaviour: same dispatch, same state handling, no side effects.
 */
require('./setup');

jest.mock('../src/workflows/restaurant', () => ({ processRestaurantMessage: jest.fn() }));
jest.mock('../src/workflows/clinic', () => ({ processClinicMessage: jest.fn() }));
jest.mock('../src/workflows/generic', () => ({ processGenericMessage: jest.fn() }));
jest.mock('../src/config/prisma', () => ({
  user: { findUnique: jest.fn() },
  business: { findUnique: jest.fn() },
  conversation: { create: jest.fn(), update: jest.fn() },
  message: { create: jest.fn() },
}));
jest.mock('axios');

const axios = require('axios');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const { processRestaurantMessage } = require('../src/workflows/restaurant');
const { processClinicMessage } = require('../src/workflows/clinic');
const { processGenericMessage } = require('../src/workflows/generic');
const { dryRun } = require('../src/services/dryRun');
const app = require('../src/app');

const restaurant = { id: 'b1', business_type: 'restaurant', ai_config: { greeting_message: 'أهلاً' } };

beforeEach(() => jest.clearAllMocks());

describe('the dry run', () => {
  test('a generic account runs the generic workflow, and reports when nothing is entered', async () => {
    processGenericMessage.mockResolvedValue({ reply: 'كيف بنقدر نساعدك؟', stateUpdate: {}, action: 'NONE', knowledge_empty: true });
    const out = await dryRun({ id: 'b9', business_type: 'generic', ai_config: { greeting_message: 'كيف بنقدر نساعدك؟' } }, 'شو أسعاركم؟');
    expect(processGenericMessage).toHaveBeenCalled();
    expect(out.reply).toBe('كيف بنقدر نساعدك؟');
    expect(out.knowledge_empty).toBe(true);   // the panel must not read this as a working bot
    expect(processRestaurantMessage).not.toHaveBeenCalled();
    expect(processClinicMessage).not.toHaveBeenCalled();
  });

  test('a restaurant goes through the real restaurant workflow with a real-shaped conversation', async () => {
    processRestaurantMessage.mockResolvedValue({ reply: 'قائمتنا: …', stateUpdate: { current_state: 'COLLECTING_ITEMS', workflow_data: { items: [] } }, action: 'NONE' });
    const out = await dryRun(restaurant, 'بدي أطلب');
    const [biz, conv, text] = processRestaurantMessage.mock.calls[0];
    expect(biz).toBe(restaurant);
    expect(text).toBe('بدي أطلب');
    expect(conv).toMatchObject({ business_id: 'b1', ai_enabled: true, current_state: 'IDLE', workflow_data: {} });
    expect(out.reply).toBe('قائمتنا: …');
    expect(out.state).toMatchObject({ current_state: 'COLLECTING_ITEMS', workflow_data: { items: [] }, handed_to_human: false });
  });

  test('state from one turn is the starting point of the next', async () => {
    processRestaurantMessage.mockResolvedValue({ reply: 'تمام', stateUpdate: {}, action: 'NONE' });
    await dryRun(restaurant, 'وكمان عصير', { current_state: 'COLLECTING_ITEMS', workflow_data: { items: ['مشكل'] } });
    const conv = processRestaurantMessage.mock.calls[0][1];
    expect(conv.current_state).toBe('COLLECTING_ITEMS');
    expect(conv.workflow_data).toEqual({ items: ['مشكل'] });
  });

  test('a handoff to a human is reported, not hidden', async () => {
    processClinicMessage.mockResolvedValue({ reply: 'رح يتواصل معك موظف', stateUpdate: { ai_enabled: false, status: 'human_takeover' }, action: 'HANDOFF' });
    const out = await dryRun({ id: 'b2', business_type: 'clinic', ai_config: {} }, 'بدي أحكي مع إنسان');
    expect(out.state.handed_to_human).toBe(true);
    expect(out.action).toBe('HANDOFF');
  });

  test('nothing is sent and nothing is written', async () => {
    processRestaurantMessage.mockResolvedValue({ reply: 'أكيد', stateUpdate: {}, action: 'CONFIRM_ORDER', orderData: { items: [] } });
    const out = await dryRun(restaurant, 'أكّد الطلب');
    expect(out.sent).toBe(false);
    expect(out.action).toBe('CONFIRM_ORDER');            // reported…
    expect(axios.post).not.toHaveBeenCalled();           // …not sent
    expect(prisma.conversation.create).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
});

describe('the customer route', () => {
  const OWNER = { id: 'u1', name: 'O', email: 'o@x.jo', role: 'business_owner', business_id: 'b1', active: true };
  const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: 'u1' }, process.env.JWT_SECRET)}` });

  test('runs against the caller\'s own business only', async () => {
    prisma.user.findUnique.mockResolvedValue(OWNER);
    prisma.business.findUnique.mockResolvedValue(restaurant);
    processRestaurantMessage.mockResolvedValue({ reply: 'أهلاً', stateUpdate: {}, action: 'NONE' });

    const res = await request(app).post('/api/whatsapp/status/test?businessId=OTHER').set(auth()).send({ message: 'مرحبا' });

    expect(res.status).toBe(200);
    expect(prisma.business.findUnique.mock.calls[0][0].where).toEqual({ id: 'b1' });
    expect(res.body.reply).toBe('أهلاً');
    expect(res.body.sent).toBe(false);
  });

  test("SHIFT's own sales bot is not exposed through the customer test", async () => {
    prisma.user.findUnique.mockResolvedValue({ ...OWNER, business_id: 'shift1' });
    prisma.business.findUnique.mockResolvedValue({ id: 'shift1', business_type: 'shift', ai_config: {} });
    const res = await request(app).post('/api/whatsapp/status/test').set(auth()).send({ message: 'مرحبا' });
    expect(res.status).toBe(400);
  });

  test('an empty message is refused before any workflow runs', async () => {
    prisma.user.findUnique.mockResolvedValue(OWNER);
    const res = await request(app).post('/api/whatsapp/status/test').set(auth()).send({ message: '   ' });
    expect(res.status).toBe(400);
    expect(processRestaurantMessage).not.toHaveBeenCalled();
  });
});

describe('the admin tool', () => {
  const ADMIN = { id: 'a1', name: 'A', email: 'a@shifts-ai.com', role: 'platform_admin', business_id: null, active: true };
  const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: 'a1' }, process.env.JWT_SECRET)}` });

  test('no longer certifies a dead bot: an account with nothing entered says so', async () => {
    prisma.user.findUnique.mockResolvedValue(ADMIN);
    prisma.business.findUnique.mockResolvedValue({ id: 'b9', business_type: 'generic', ai_config: { greeting_message: 'مرحبا' } });
    processGenericMessage.mockResolvedValue({ reply: 'مرحبا', stateUpdate: {}, action: 'NONE', knowledge_empty: true });
    const res = await request(app).post('/api/admin/accounts/b9/test-message').set(auth()).send({ message: 'كم سعر التنظيف؟' });
    expect(res.status).toBe(200);
    expect(res.body.knowledge_empty).toBe(true);
    expect(res.body.reply).toBe('مرحبا');   // exactly what production would answer
  });
});
