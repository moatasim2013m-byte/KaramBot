require('./setup');

// One in-memory DB behind both Prisma and db/jsonb, so the route's jsonb writes and Prisma reads agree.
jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

// No Graph calls: the structured and legacy senders are spies.
jest.mock('../src/services/whatsapp', () => ({
  ...jest.requireActual('../src/services/whatsapp'),
  sendText: jest.fn(),
  sendTextMessage: jest.fn(),
  markAsRead: jest.fn().mockResolvedValue(true),
}));

// Layer-2 modules are built by another slice (pr1-contracts §0), so the ack text this route sends is
// mocked: these tests pin the route's behaviour, not the wording.
jest.mock('../src/workflows/shift/acks', () => ({
  ...jest.requireActual('../src/workflows/shift/acks'),
  claimAck: jest.fn(({ staffName }) => (staffName
    ? `استلم طلبك ${staffName} وبيكمّل معك هون.`
    : 'استلم طلبك واحد من الفريق وبيكمّل معك هون.')),
  pickLanguage: jest.fn(() => 'ar'),
}));
jest.mock('../src/workflows/shift/actions', () => ({
  ...jest.requireActual('../src/workflows/shift/actions'),
  STAGES: ['opening', 'discovery', 'fit', 'sample', 'roleplay_setup', 'roleplay',
    'objection', 'close', 'captured', 'handoff', 'closed'],
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const whatsapp = require('../src/services/whatsapp');
const acks = require('../src/workflows/shift/acks');
const db = require('./helpers/fakeDb').getFakeDb();

describe('Inbox Routes — Authentication', () => {
  test('GET /api/inbox/conversations requires auth', async () => {
    const res = await request(app).get('/api/inbox/conversations');
    expect(res.status).toBe(401);
  });

  test('GET /api/inbox/conversations/:id/messages requires auth', async () => {
    const res = await request(app).get('/api/inbox/conversations/someid/messages');
    expect(res.status).toBe(401);
  });

  test('POST /api/inbox/conversations/:id/send requires auth', async () => {
    const res = await request(app).post('/api/inbox/conversations/someid/send').send({ text: 'hi' });
    expect(res.status).toBe(401);
  });

  test('POST /api/inbox/conversations/:id/takeover requires auth', async () => {
    const res = await request(app).post('/api/inbox/conversations/someid/takeover');
    expect(res.status).toBe(401);
  });

  test('POST /api/inbox/conversations/:id/enable-ai requires auth', async () => {
    const res = await request(app).post('/api/inbox/conversations/someid/enable-ai');
    expect(res.status).toBe(401);
  });

  test('POST /api/inbox/conversations/:id/resolve requires auth', async () => {
    const res = await request(app).post('/api/inbox/conversations/someid/resolve');
    expect(res.status).toBe(401);
  });

  test('GET /api/inbox/stats requires auth', async () => {
    const res = await request(app).get('/api/inbox/stats');
    expect(res.status).toBe(401);
  });

  test('GET /api/inbox/updates requires auth', async () => {
    const res = await request(app).get('/api/inbox/updates');
    expect(res.status).toBe(401);
  });
});

describe('Clinic Routes — Authentication', () => {
  test('GET /api/clinic/services requires auth', async () => {
    const res = await request(app).get('/api/clinic/services');
    expect(res.status).toBe(401);
  });

  test('GET /api/clinic/doctors requires auth', async () => {
    const res = await request(app).get('/api/clinic/doctors');
    expect(res.status).toBe(401);
  });

  test('GET /api/clinic/appointments requires auth', async () => {
    const res = await request(app).get('/api/clinic/appointments');
    expect(res.status).toBe(401);
  });

  test('GET /api/clinic/slots requires auth', async () => {
    const res = await request(app).get('/api/clinic/slots');
    expect(res.status).toBe(401);
  });
});

describe('Reports Routes — Authentication', () => {
  test('GET /api/reports/daily requires auth', async () => {
    const res = await request(app).get('/api/reports/daily');
    expect(res.status).toBe(401);
  });

  test('GET /api/reports/weekly requires auth', async () => {
    const res = await request(app).get('/api/reports/weekly');
    expect(res.status).toBe(401);
  });
});

// ─── SHIFT staff routes (fakeDb) ───────────────────────────────────────────────
// The router is mounted on a bare app: the real app's apiLimiter (100/min) would otherwise make
// the suite's request count matter.
const inboxApp = express();
inboxApp.use(express.json());
inboxApp.use('/api/inbox', require('../src/routes/inbox'));

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function tokenFor(userId) {
  return `Bearer ${jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '15m' })}`;
}

function seedWorld({ conversations = [], messages = [], businessType = 'shift' } = {}) {
  const now = Date.now();
  db.seed({
    businesses: [
      { id: 'biz_shift', name: 'SHIFT', business_type: businessType, wa_phone_number_id: 'pnid_shift', wa_access_token: 'plain_token' },
      { id: 'biz_other', name: 'Other', business_type: 'restaurant', wa_phone_number_id: 'pnid_other', wa_access_token: 'plain_token' },
    ],
    users: [
      { id: 'u_sara', name: 'سارة', role: 'business_owner', business_id: 'biz_shift' },
      { id: 'u_omar', name: 'عمر', role: 'staff', business_id: 'biz_shift' },
      { id: 'u_other', name: 'Other owner', role: 'business_owner', business_id: 'biz_other' },
    ],
    conversations: conversations.map((c) => ({
      business_id: 'biz_shift',
      status: 'open',
      last_inbound_at: new Date(now - 5 * MINUTE),
      ...c,
    })),
    messages,
  });
}

function conversationRow(id) {
  return db.store.conversations.find((c) => c.id === id);
}

beforeEach(() => {
  db.reset();
  jest.clearAllMocks();
  whatsapp.sendText.mockResolvedValue({ ok: true, id: 'wamid.claim', error: null, reason: null, code: null, httpStatus: 200, retryable: false });
  whatsapp.sendTextMessage.mockResolvedValue({ messages: [{ id: 'wamid.staff' }] });
});

describe('GET /api/inbox/conversations — SHIFT filters', () => {
  beforeEach(() => {
    const t = Date.now();
    seedWorld({
      conversations: [
        { id: 'c_new_open', customer_wa_id: '962700000001', status: 'open', current_state: 'discovery', last_message_at: new Date(t - 1 * MINUTE) },
        { id: 'c_pending_old', customer_wa_id: '962700000002', status: 'pending', current_state: 'handoff', last_message_at: new Date(t - 30 * MINUTE) },
        { id: 'c_mid_open', customer_wa_id: '962700000003', status: 'open', current_state: 'discovery', last_message_at: new Date(t - 10 * MINUTE) },
        { id: 'c_pending_new', customer_wa_id: '962700000004', status: 'pending', current_state: 'captured', last_message_at: new Date(t - 5 * MINUTE) },
        { id: 'c_foreign', business_id: 'biz_other', customer_wa_id: '962700000005', status: 'pending' },
      ],
      messages: [
        { business_id: 'biz_shift', conversation_id: 'c_mid_open', direction: 'inbound', status: 'awaiting_staff', text_body: 'وينكم؟' },
        { business_id: 'biz_shift', conversation_id: 'c_mid_open', direction: 'inbound', status: 'awaiting_staff', text_body: 'مرحبا' },
        { business_id: 'biz_shift', conversation_id: 'c_mid_open', direction: 'inbound', status: 'answered', text_body: 'قديم' },
        { business_id: 'biz_shift', conversation_id: 'c_new_open', direction: 'inbound', status: 'received', text_body: 'جديد' },
      ],
    });
  });

  test('needs_team=1 returns only pending conversations of this business (overrides status)', async () => {
    const res = await request(inboxApp)
      .get('/api/inbox/conversations?needs_team=1&status=open')
      .set('Authorization', tokenFor('u_sara'));
    expect(res.status).toBe(200);
    expect(res.body.conversations.map((c) => c.id)).toEqual(['c_pending_new', 'c_pending_old']);
    expect(res.body.total).toBe(2);
  });

  test('an unknown stage is rejected with 400; a known stage filters current_state', async () => {
    const bad = await request(inboxApp).get('/api/inbox/conversations?stage=negotiation').set('Authorization', tokenFor('u_sara'));
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: 'invalid stage' });

    const ok = await request(inboxApp).get('/api/inbox/conversations?stage=captured').set('Authorization', tokenFor('u_sara'));
    expect(ok.status).toBe(200);
    expect(ok.body.conversations.map((c) => c.id)).toEqual(['c_pending_new']);
  });

  test('awaiting_staff counts are attached and pending conversations sort first', async () => {
    const res = await request(inboxApp).get('/api/inbox/conversations').set('Authorization', tokenFor('u_sara'));
    expect(res.status).toBe(200);
    expect(res.body.conversations.map((c) => c.id)).toEqual(['c_pending_new', 'c_pending_old', 'c_new_open', 'c_mid_open']);
    const counts = Object.fromEntries(res.body.conversations.map((c) => [c.id, c.awaiting_staff]));
    expect(counts).toEqual({ c_pending_new: 0, c_pending_old: 0, c_new_open: 0, c_mid_open: 2 });
  });
});

describe('PATCH /api/inbox/conversations/:id/lead', () => {
  beforeEach(() => {
    seedWorld({
      conversations: [{
        id: 'c_lead',
        customer_wa_id: '962700000010',
        status: 'pending',
        workflow_data: {
          lead: {
            name: 'محمد',
            city: 'عمّان',
            version: 1,
            score: 0,
            _prov: {
              name: { source: 'model', source_msg_id: 'm1', at: '2026-09-14T08:00:00.000Z', confirmed: true },
              city: { source: 'model', source_msg_id: 'm1', at: '2026-09-14T08:00:00.000Z', confirmed: true },
            },
          },
          needs_team: { reason: 'quote', summary: 'بدو سعر', at: '2026-09-14T08:00:00.000Z', resolved_at: null, sla_note_sent_at: null, claimed_at: null, claimed_by: null },
          bot_turns: 3,
        },
        metadata: { reply_failures: 0 },
      }],
    });
  });

  test('merges a staff edit with _prov.source staff and keeps the rest of workflow_data', async () => {
    const res = await request(inboxApp)
      .patch('/api/inbox/conversations/c_lead/lead')
      .set('Authorization', tokenFor('u_sara'))
      .send({ lead: { city: 'إربد', business_name: 'كافيه زيتون', need: ['حجوزات'] }, version: 1 });

    expect(res.status).toBe(200);
    const lead = res.body.conversation.workflow_data.lead;
    expect(lead).toMatchObject({ name: 'محمد', city: 'إربد', business_name: 'كافيه زيتون', need: ['حجوزات'], version: 2 });
    expect(lead._prov.city).toMatchObject({ source: 'staff', confirmed: true, source_msg_id: null });
    expect(lead._prov.name.source).toBe('model');
    // Sibling keys written by the bot are untouched.
    expect(res.body.conversation.workflow_data.needs_team.reason).toBe('quote');
    expect(res.body.conversation.workflow_data.bot_turns).toBe(3);
    expect(conversationRow('c_lead').status).toBe('pending');
  });

  test('preferred_time typed by staff is stored as {text}', async () => {
    const res = await request(inboxApp)
      .patch('/api/inbox/conversations/c_lead/lead')
      .set('Authorization', tokenFor('u_sara'))
      .send({ lead: { preferred_time: 'الأحد الصبح' }, version: 1 });
    expect(res.status).toBe(200);
    expect(res.body.conversation.workflow_data.lead.preferred_time).toEqual({ text: 'الأحد الصبح' });
  });

  test('a stale version returns 409 with the current lead and writes nothing', async () => {
    const res = await request(inboxApp)
      .patch('/api/inbox/conversations/c_lead/lead')
      .set('Authorization', tokenFor('u_sara'))
      .send({ lead: { city: 'الزرقاء' }, version: 0 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('version_conflict');
    expect(res.body.lead).toMatchObject({ city: 'عمّان', version: 1 });
    expect(conversationRow('c_lead').workflow_data.lead.city).toBe('عمّان');
  });

  test('unknown or non-whitelisted lead keys are rejected with 400', async () => {
    const unknown = await request(inboxApp)
      .patch('/api/inbox/conversations/c_lead/lead')
      .set('Authorization', tokenFor('u_sara'))
      .send({ lead: { score: 99 } });
    expect(unknown.status).toBe(400);
    expect(unknown.body).toEqual({ error: 'invalid field', field: 'score' });

    const numbers = await request(inboxApp)
      .patch('/api/inbox/conversations/c_lead/lead')
      .set('Authorization', tokenFor('u_sara'))
      .send({ lead: { customer_numbers: ['50'] } });
    expect(numbers.status).toBe(400);
    expect(numbers.body.field).toBe('customer_numbers');
    expect(conversationRow('c_lead').workflow_data.lead.version).toBe(1);
  });

  test("another business's conversation is 404", async () => {
    const res = await request(inboxApp)
      .patch('/api/inbox/conversations/c_lead/lead')
      .set('Authorization', tokenFor('u_other'))
      .send({ lead: { city: 'إربد' }, version: 1 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Conversation not found' });
    expect(conversationRow('c_lead').workflow_data.lead.city).toBe('عمّان');
  });

  test('needs_team_resolved stamps resolved_at and reopens a pending conversation', async () => {
    const before = Date.now();
    const res = await request(inboxApp)
      .patch('/api/inbox/conversations/c_lead/lead')
      .set('Authorization', tokenFor('u_sara'))
      .send({ needs_team_resolved: true });
    expect(res.status).toBe(200);
    const nt = res.body.conversation.workflow_data.needs_team;
    expect(nt.reason).toBe('quote');
    expect(new Date(nt.resolved_at).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(res.body.conversation.status).toBe('open');
    expect(res.body.conversation.workflow_data.lead.version).toBe(1);
  });

  test('needs_team_resolved does not close a newer request the bot recorded after staff loaded the card', async () => {
    const row = conversationRow('c_lead');
    const stale = JSON.parse(JSON.stringify(row));
    // Meanwhile the customer asked for a person: the handoff replaced the quote entry.
    row.workflow_data.needs_team = { reason: 'person', summary: 'بدو حدا', at: '2026-09-14T09:00:00.000Z', resolved_at: null, sla_note_sent_at: '2026-09-14T09:20:00.000Z', claimed_at: null, claimed_by: null };
    const realFindFirst = db.prisma.conversation.findFirst;
    jest.spyOn(db.prisma.conversation, 'findFirst').mockImplementationOnce(async () => stale).mockImplementation(realFindFirst);

    const res = await request(inboxApp)
      .patch('/api/inbox/conversations/c_lead/lead')
      .set('Authorization', tokenFor('u_sara'))
      .send({ needs_team_resolved: true });

    expect(res.status).toBe(200);
    expect(conversationRow('c_lead').workflow_data.needs_team).toMatchObject({ reason: 'person', resolved_at: null, sla_note_sent_at: '2026-09-14T09:20:00.000Z' });
    expect(conversationRow('c_lead').status).toBe('pending');
  });
});

describe('POST /api/inbox/conversations/:id/claim and /release', () => {
  function seedClaimable(overrides = {}, businessType = 'shift') {
    seedWorld({
      businessType,
      conversations: [{
        id: 'c_claim',
        customer_wa_id: '962700000020',
        status: 'pending',
        current_state: 'handoff',
        ai_enabled: true,
        workflow_data: {
          lead: { name: 'محمد', version: 1 },
          needs_team: { reason: 'person', summary: 'بدو حدا', at: '2026-09-14T08:00:00.000Z', resolved_at: null, sla_note_sent_at: null, claimed_at: null, claimed_by: null },
        },
        metadata: { reply_failures: 0 },
        ...overrides,
      }],
    });
  }

  test('claim takes the conversation, records the stage and sends the ack exactly once', async () => {
    seedClaimable();
    const before = Date.now();
    const res = await request(inboxApp).post('/api/inbox/conversations/c_claim/claim').set('Authorization', tokenFor('u_sara'));

    expect(res.status).toBe(200);
    expect(res.body.ack).toBe('sent');
    const conv = res.body.conversation;
    expect(conv).toMatchObject({ status: 'human_takeover', ai_enabled: false, assigned_staff_id: 'u_sara' });
    expect(conv.workflow_data.stage_before_takeover).toBe('handoff');
    expect(conv.workflow_data.needs_team).toMatchObject({ reason: 'person', claimed_by: 'u_sara' });
    expect(conv.workflow_data.needs_team.claimed_at).toEqual(expect.any(String));
    expect(conv.workflow_data.lead.name).toBe('محمد');

    expect(acks.claimAck).toHaveBeenCalledWith({ staffName: 'سارة', lang: 'ar' });
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendText).toHaveBeenCalledWith('pnid_shift', 'plain_token', '962700000020', 'استلم طلبك سارة وبيكمّل معك هون.');

    const outbound = db.store.messages.filter((m) => m.direction === 'outbound');
    expect(outbound).toHaveLength(1);
    expect(outbound[0]).toMatchObject({
      conversation_id: 'c_claim', status: 'sent', meta_message_id: 'wamid.claim', sent_by_user_id: 'u_sara',
      is_ai_generated: false, raw_payload: { kind: 'claim_ack' },
    });

    const until = new Date(conv.metadata.human_active_until).getTime();
    expect(until).toBeGreaterThanOrEqual(before + 30 * MINUTE - 1000);
    expect(until).toBeLessThanOrEqual(Date.now() + 30 * MINUTE + 1000);

    // Same staff member again: idempotent, no second ack.
    const again = await request(inboxApp).post('/api/inbox/conversations/c_claim/claim').set('Authorization', tokenFor('u_sara'));
    expect(again.status).toBe(200);
    expect(again.body.ack).toBe('skipped');
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);

    // Someone else: already claimed.
    const other = await request(inboxApp).post('/api/inbox/conversations/c_claim/claim').set('Authorization', tokenFor('u_omar'));
    expect(other.status).toBe(409);
    expect(other.body).toEqual({ error: 'already_claimed' });
    expect(conversationRow('c_claim').assigned_staff_id).toBe('u_sara');
  });

  test('claim outside the 24 h window takes the conversation but sends nothing', async () => {
    seedClaimable({ last_inbound_at: new Date(Date.now() - 25 * HOUR) });
    const res = await request(inboxApp).post('/api/inbox/conversations/c_claim/claim').set('Authorization', tokenFor('u_sara'));
    expect(res.status).toBe(200);
    expect(res.body.ack).toBe('skipped');
    expect(res.body.conversation.status).toBe('human_takeover');
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(db.store.messages).toHaveLength(0);
  });

  test('claim on a non-SHIFT business never sends an ack', async () => {
    seedClaimable({}, 'restaurant');
    const res = await request(inboxApp).post('/api/inbox/conversations/c_claim/claim').set('Authorization', tokenFor('u_sara'));
    expect(res.status).toBe(200);
    expect(res.body.ack).toBe('skipped');
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });

  test('a failed ack does not fail the claim', async () => {
    seedClaimable();
    whatsapp.sendText.mockResolvedValue({ ok: false, id: null, error: 'boom', reason: 'server', code: null, httpStatus: 503, retryable: true });
    const res = await request(inboxApp).post('/api/inbox/conversations/c_claim/claim').set('Authorization', tokenFor('u_sara'));
    expect(res.status).toBe(200);
    expect(res.body.ack).toBe('failed');
    expect(res.body.conversation.status).toBe('human_takeover');
    expect(db.store.messages).toHaveLength(0);
    expect(res.body.conversation.metadata.human_active_until).toBeUndefined();
  });

  test('claim on another business is 404', async () => {
    seedClaimable();
    const res = await request(inboxApp).post('/api/inbox/conversations/c_claim/claim').set('Authorization', tokenFor('u_other'));
    expect(res.status).toBe(404);
    expect(conversationRow('c_claim').status).toBe('pending');
  });

  test('release restores the stage before takeover and turns the bot back on', async () => {
    seedClaimable();
    await request(inboxApp).post('/api/inbox/conversations/c_claim/claim').set('Authorization', tokenFor('u_sara'));

    const res = await request(inboxApp).post('/api/inbox/conversations/c_claim/release').set('Authorization', tokenFor('u_sara'));
    expect(res.status).toBe(200);
    const conv = res.body.conversation;
    expect(conv).toMatchObject({ status: 'open', ai_enabled: true, assigned_staff_id: null, current_state: 'handoff' });
    expect(conv.workflow_data.stage_before_takeover).toBeNull();
    expect(conv.metadata.human_active_until).toBeNull();
    expect(conv.metadata.reply_failures).toBe(0);
    expect(conv.workflow_data.needs_team.claimed_by).toBe('u_sara');
  });

  test('release stamps released_at and hands messages parked for staff back to the batcher queue', async () => {
    seedClaimable({ status: 'human_takeover', ai_enabled: false, assigned_staff_id: 'u_sara' });
    db.seed({
      messages: [
        { id: 'm_park', business_id: 'biz_shift', conversation_id: 'c_claim', direction: 'inbound', status: 'awaiting_staff', text_body: 'طيب كم السعر؟' },
        { id: 'm_done', business_id: 'biz_shift', conversation_id: 'c_claim', direction: 'inbound', status: 'answered', text_body: 'مرحبا' },
      ],
    });
    const before = Date.now();
    const res = await request(inboxApp).post('/api/inbox/conversations/c_claim/release').set('Authorization', tokenFor('u_sara'));
    expect(res.status).toBe(200);
    expect(new Date(res.body.conversation.metadata.released_at).getTime()).toBeGreaterThanOrEqual(before);
    const status = Object.fromEntries(db.store.messages.map((m) => [m.id, m.status]));
    expect(status).toEqual({ m_park: 'received', m_done: 'answered' });
  });

  test('enable-ai is a release too', async () => {
    seedClaimable({ status: 'human_takeover', ai_enabled: false, assigned_staff_id: 'u_sara' });
    db.seed({ messages: [{ id: 'm_park2', business_id: 'biz_shift', conversation_id: 'c_claim', direction: 'inbound', status: 'awaiting_staff' }] });
    const res = await request(inboxApp).post('/api/inbox/conversations/c_claim/enable-ai').set('Authorization', tokenFor('u_sara'));
    expect(res.status).toBe(200);
    expect(res.body.conversation).toMatchObject({ status: 'open', ai_enabled: true });
    expect(res.body.conversation.metadata.released_at).toEqual(expect.any(String));
    expect(db.store.messages[0].status).toBe('received');
  });

  test('two staff claiming at the same moment: one owner, one ack', async () => {
    seedClaimable();
    const [a, b] = await Promise.all([
      request(inboxApp).post('/api/inbox/conversations/c_claim/claim').set('Authorization', tokenFor('u_sara')),
      request(inboxApp).post('/api/inbox/conversations/c_claim/claim').set('Authorization', tokenFor('u_omar')),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    const winner = a.status === 200 ? 'u_sara' : 'u_omar';
    expect(conversationRow('c_claim').assigned_staff_id).toBe(winner);
    expect(conversationRow('c_claim').workflow_data.needs_team.claimed_by).toBe(winner);
  });

  test('the claim ack language falls back to the customer\'s newest text when the lead has none', async () => {
    seedClaimable({ workflow_data: { lead: { version: 1 } } });
    db.seed({ messages: [{ business_id: 'biz_shift', conversation_id: 'c_claim', direction: 'inbound', status: 'answered', text_body: 'Hi, I need a quote' }] });
    await request(inboxApp).post('/api/inbox/conversations/c_claim/claim').set('Authorization', tokenFor('u_sara'));
    expect(acks.pickLanguage).toHaveBeenCalledWith({ version: 1 }, 'Hi, I need a quote');
  });

  test('release without a recorded stage keeps current_state', async () => {
    seedClaimable({ status: 'human_takeover', ai_enabled: false, assigned_staff_id: 'u_sara', current_state: 'discovery' });
    const res = await request(inboxApp).post('/api/inbox/conversations/c_claim/release').set('Authorization', tokenFor('u_omar'));
    expect(res.status).toBe(200);
    expect(res.body.conversation).toMatchObject({ status: 'open', ai_enabled: true, current_state: 'discovery' });
  });
});

describe('POST /api/inbox/conversations/:id/send — human activity bookkeeping', () => {
  test('sets human_active_until ≈ now+30 min and answers awaiting_staff rows, leaving received rows', async () => {
    seedWorld({
      conversations: [{ id: 'c_send', customer_wa_id: '962700000030', status: 'human_takeover', ai_enabled: false, metadata: { lease_token: 'tok', reply_failures: 1 } }],
      messages: [
        { id: 'm_wait1', business_id: 'biz_shift', conversation_id: 'c_send', direction: 'inbound', status: 'awaiting_staff', text_body: 'وينكم؟' },
        { id: 'm_wait2', business_id: 'biz_shift', conversation_id: 'c_send', direction: 'inbound', status: 'awaiting_staff', text_body: 'مرحبا' },
        { id: 'm_recv', business_id: 'biz_shift', conversation_id: 'c_send', direction: 'inbound', status: 'received', text_body: 'سؤال جديد' },
      ],
    });

    const before = Date.now();
    const res = await request(inboxApp)
      .post('/api/inbox/conversations/c_send/send')
      .set('Authorization', tokenFor('u_sara'))
      .send({ text: 'أهلين، معك سارة' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatchObject({ direction: 'outbound', sent_by_user_id: 'u_sara', meta_message_id: 'wamid.staff' });
    expect(whatsapp.sendTextMessage).toHaveBeenCalledWith('pnid_shift', 'plain_token', '962700000030', 'أهلين، معك سارة');

    const meta = conversationRow('c_send').metadata;
    const until = new Date(meta.human_active_until).getTime();
    expect(until).toBeGreaterThanOrEqual(before + 30 * MINUTE - 1000);
    expect(until).toBeLessThanOrEqual(Date.now() + 30 * MINUTE + 1000);
    // Keys other writers own survive the patch; the bot's failure count is cleared (the customer got a reply).
    expect(meta).toMatchObject({ lease_token: 'tok', reply_failures: 0 });

    const status = Object.fromEntries(db.store.messages.filter((m) => m.direction === 'inbound').map((m) => [m.id, m.status]));
    expect(status).toEqual({ m_wait1: 'answered', m_wait2: 'answered', m_recv: 'received' });
  });

  test('outside the window it still refuses without touching metadata', async () => {
    seedWorld({
      conversations: [{ id: 'c_late', customer_wa_id: '962700000031', last_inbound_at: new Date(Date.now() - 25 * HOUR) }],
    });
    const res = await request(inboxApp)
      .post('/api/inbox/conversations/c_late/send')
      .set('Authorization', tokenFor('u_sara'))
      .send({ text: 'مرحبا' });
    expect(res.status).toBe(409);
    expect(conversationRow('c_late').metadata.human_active_until).toBeUndefined();
  });
});

describe('GET /api/inbox/stats', () => {
  test('includes awaiting_staff alongside the existing counts', async () => {
    seedWorld({
      conversations: [
        { id: 'c_s1', customer_wa_id: '962700000040', status: 'pending' },
        { id: 'c_s2', customer_wa_id: '962700000041', status: 'human_takeover' },
        { id: 'c_s3', customer_wa_id: '962700000042', status: 'open' },
      ],
      messages: [
        { business_id: 'biz_shift', conversation_id: 'c_s2', direction: 'inbound', status: 'awaiting_staff' },
        { business_id: 'biz_shift', conversation_id: 'c_s2', direction: 'inbound', status: 'awaiting_staff' },
        { business_id: 'biz_shift', conversation_id: 'c_s3', direction: 'inbound', status: 'received' },
        { business_id: 'biz_other', conversation_id: 'x', direction: 'inbound', status: 'awaiting_staff' },
      ],
    });
    const res = await request(inboxApp).get('/api/inbox/stats').set('Authorization', tokenFor('u_sara'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ open: 1, human_takeover: 1, pending: 1, awaiting_staff: 2, today_orders: 0 });
  });
});
