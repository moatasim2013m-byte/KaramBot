/**
 * «أوقات الدوام» and «رسالة خارج الدوام» from /bot on the tenant message path (P3 review).
 *
 *  - Closed by the owner's hours, with a message written: the message goes once a day, nothing is
 *    read or asked of the AI, and the conversation waits for the team as 'out_of_hours'. For the
 *    generic, restaurant and clinic workflows alike.
 *  - Open, or no message written, or hours in a shape the editor does not write: the bot answers
 *    exactly as before. The live bots must not go quiet because of a default row.
 *
 * Real messageProcessor and workflows over the in-memory fakeDb; WhatsApp and the AI are mocked.
 */

require('./setup');

jest.mock('../src/config/prisma', () => {
  const fake = require('./helpers/fakeDb').getFakeDb();
  // The menu and clinic tables, empty: enough for the restaurant and clinic workflows to run.
  const empty = { findMany: async () => [], findFirst: async () => null, findUnique: async () => null, count: async () => 0 };
  for (const m of ['category', 'menuItem', 'service', 'doctor', 'appointmentSlot']) fake.prisma[m] = empty;
  return fake.prisma;
});
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);
jest.mock('axios');
jest.mock('../src/services/whatsapp', () => ({
  sendText: jest.fn(),
  sendInteractiveButtons: jest.fn(),
  sendStructured: jest.fn(),
  sendTemplate: jest.fn(),
  partSummary: jest.fn(() => ''),
  sendTextMessage: jest.fn(),
  markAsRead: jest.fn(),
  normalizePhone: jest.fn((p) => (p ? String(p).replace(/\D/g, '') : p)),
}));
jest.mock('../src/services/alerts', () => ({
  ...jest.requireActual('../src/services/alerts'),
  sendStaffAlert: jest.fn(),
  notifyShift: jest.fn(),
}));
jest.mock('../src/workflows/shift', () => ({
  processShiftBatch: jest.fn(),
  toWorkflowResult: jest.fn(),
}));
jest.mock('../src/ai/provider', () => ({ generateValidatedAIReply: jest.fn(), generateAIReply: jest.fn(), resolveModel: () => 'gemini-test' }));
jest.mock('../src/workflows/shift/media', () => ({
  mediaEnabled: jest.fn(() => true),
  readForTenant: jest.fn(),
  enrichBatch: jest.fn(async (b, t, batch) => ({ batch, updates: [] })),
}));

const db = require('./helpers/fakeDb').getFakeDb();
const whatsapp = require('../src/services/whatsapp');
const alerts = require('../src/services/alerts');
const shift = require('../src/workflows/shift');
const provider = require('../src/ai/provider');
const media = require('../src/workflows/shift/media');
const batcher = require('../src/services/replyBatcher');
const costGuard = require('../src/services/costGuard');
const { isOpenAt, DAYS } = require('../src/services/openingHours');
const platformSettings = require('../src/services/platformSettings');
const { persistInbound, processInboundMessage } = require('../src/services/messageProcessor');


const CUSTOMER = '962791111111';
const OWNER = '962796381676';
const PNID = 'pnid_hours';
const CLOSED_TEXT = 'نحن مغلقون الآن، نرد عليك أول ما نفتح.';
let seq = 0;

// Real time, so the rows are built around today in Amman: today closed, every other day open.
function ammanToday() {
  const en = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Amman', weekday: 'long' }).format(new Date());
  return { Saturday: 'السبت', Sunday: 'الأحد', Monday: 'الاثنين', Tuesday: 'الثلاثاء', Wednesday: 'الأربعاء', Thursday: 'الخميس', Friday: 'الجمعة' }[en];
}
const closedToday = () => DAYS.map((day) => ({ day, open: '09:00', close: '21:00', closed: day === ammanToday() }));
const openAllDay = () => DAYS.map((day) => ({ day, open: '00:00', close: '00:00', closed: false }));

function seedShop(type, { hours = closedToday(), message = CLOSED_TEXT } = {}) {
  db.seed({
    businesses: [{
      id: 'biz_h', name: 'محل', business_type: type, status: 'active', wa_phone_number_id: PNID,
      wa_access_token: 'plain_test_token', opening_hours: hours, timezone: 'Asia/Amman',
      ai_config: { alert_wa_numbers: [OWNER], out_of_hours_message: message },
    }],
    businessKnowledge: [{ business_id: 'biz_h', kind: 'fact', content: 'عندنا بنادول', active: true }],
  });
}

async function deliver(body, from = CUSTOMER) {
  seq += 1;
  const e = { changes: [{ value: {
    messaging_product: 'whatsapp', metadata: { phone_number_id: PNID },
    contacts: [{ wa_id: from, profile: { name: 'محمد' } }],
    messages: [{ id: `wamid.h${seq}`, from, timestamp: '1', type: 'text', text: { body } }],
  } }] };
  const persisted = await persistInbound(e);
  await processInboundMessage(e, { persisted });
}

const conversation = () => db.store.conversations.find((c) => c.customer_wa_id === CUSTOMER);

beforeEach(() => {
  db.reset();
  jest.clearAllMocks();
  seq = 0;
  costGuard.clearCache();
  platformSettings.clearCache();
  whatsapp.sendTextMessage.mockReset().mockResolvedValue({ messages: [{ id: 'wamid.reply' }] });
  whatsapp.markAsRead.mockReset().mockResolvedValue(true);
  alerts.sendStaffAlert.mockReset().mockResolvedValue({ webhook: 'skipped', whatsapp: [] });
  alerts.notifyShift.mockReset().mockResolvedValue(null);
  provider.generateValidatedAIReply.mockReset().mockResolvedValue({ reply: 'أهلًا، تفضل.', action: 'NONE' });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  batcher.cancelAll();
  jest.restoreAllMocks();
});

describe.each(['generic', 'restaurant', 'clinic'])('%s', (type) => {
  test('closed today: the out-of-hours message once, no AI, and the team is told', async () => {
    seedShop(type);
    await deliver('بدي أطلب');
    await deliver('مرحبا؟');

    expect(provider.generateValidatedAIReply).not.toHaveBeenCalled();
    expect(whatsapp.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendTextMessage).toHaveBeenCalledWith(PNID, 'plain_test_token', CUSTOMER, CLOSED_TEXT);
    expect(conversation()).toMatchObject({ needs_attention: true, attention_reason: 'out_of_hours' });
    const out = db.store.messages.filter((m) => m.direction === 'outbound');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text_body: CLOSED_TEXT, is_ai_generated: false });
  });

  test('open: the bot answers as before', async () => {
    seedShop(type, { hours: openAllDay() });
    await deliver('مرحبا');
    expect(provider.generateValidatedAIReply).toHaveBeenCalled();
    expect(whatsapp.sendTextMessage).not.toHaveBeenCalledWith(PNID, 'plain_test_token', CUSTOMER, CLOSED_TEXT);
  });

  test('closed but no message written: the bot answers as before', async () => {
    seedShop(type, { message: '  ' });
    await deliver('مرحبا');
    expect(provider.generateValidatedAIReply).toHaveBeenCalled();
    expect(conversation().attention_reason).not.toBe('out_of_hours');
  });
});

test('hours in another shape (SHIFT\'s older numeric days) never close the shop', async () => {
  seedShop('generic', { hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '11:00', close: '11:01' })) });
  await deliver('مرحبا');
  expect(provider.generateValidatedAIReply).toHaveBeenCalled();
});

test('a staff number writing in is not told the shop is closed', async () => {
  seedShop('generic');
  await deliver('تمام', OWNER);
  expect(whatsapp.sendTextMessage).not.toHaveBeenCalledWith(PNID, 'plain_test_token', OWNER, CLOSED_TEXT);
});

describe('isOpenAt', () => {
  // 2026-10-09 is a Friday; 21:00 UTC on Thursday 10-08 is 00:00 Friday in Amman (UTC+3).
  const at = (iso) => new Date(iso);
  const rows = (fri, thu = { open: '09:00', close: '21:00' }) => DAYS.map((day) => (
    day === 'الجمعة' ? { day, ...fri } : day === 'الخميس' ? { day, ...thu } : { day, open: '09:00', close: '21:00' }
  ));

  test('a day marked closed is closed, and an ordinary day is open inside its hours only', () => {
    expect(isOpenAt(rows({ closed: true, open: '09:00', close: '21:00' }), at('2026-10-09T10:00:00Z'))).toBe(false);
    expect(isOpenAt(rows({ open: '09:00', close: '21:00' }), at('2026-10-09T10:00:00Z'))).toBe(true); // 13:00
    expect(isOpenAt(rows({ open: '09:00', close: '21:00' }), at('2026-10-09T19:00:00Z'))).toBe(false); // 22:00
  });

  test('hours past midnight hold the shop open in the small hours of the next day', () => {
    const lateThursday = { open: '12:00', close: '01:00' };
    expect(isOpenAt(rows({ closed: true }, lateThursday), at('2026-10-08T21:30:00Z'))).toBe(true); // Fri 00:30
    expect(isOpenAt(rows({ closed: true }, lateThursday), at('2026-10-08T22:30:00Z'))).toBe(false); // Fri 01:30
  });

  test('no rows, or rows it cannot read, say nothing', () => {
    expect(isOpenAt([], at('2026-10-09T10:00:00Z'))).toBeNull();
    expect(isOpenAt(null, at('2026-10-09T10:00:00Z'))).toBeNull();
    expect(isOpenAt(rows({ open: 'x', close: '21:00' }), at('2026-10-09T10:00:00Z'))).toBeNull();
  });
});
