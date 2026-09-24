/**
 * pg.test.js — PR1's raw SQL and transactions against a REAL PostgreSQL behind PgBouncer (transaction
 * pool mode), with the real Prisma client. Everything else in tests/ runs on the in-memory fakeDb.
 *
 * SKIPPED unless PG_INTEGRATION_URL is set. Run it with backend/scripts/pg-integration.sh, which starts
 * postgres:16 + PgBouncer (pool_mode=transaction, max_prepared_statements=1000, like Neon's pooler),
 * pushes the schema on the direct port and points PG_INTEGRATION_URL at the PgBouncer port.
 * The database is TRUNCATEd between tests: never point this at a database you care about.
 *
 * Only the edges are mocked: axios (Graph, forwards, alert webhooks) and the Gemini SDK.
 * See docs/bot/pr1-postgres-verification.md.
 */

require('../setup');

const PG_URL = process.env.PG_INTEGRATION_URL;
if (PG_URL) process.env.DATABASE_URL = PG_URL;

jest.mock('axios');
const mockGenerateContent = jest.fn();
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({ generateContent: mockGenerateContent }),
  })),
}));

const describePg = PG_URL ? describe : describe.skip;

jest.setTimeout(60000);

describePg('PR1 on real Postgres behind PgBouncer (transaction mode)', () => {
  // Required lazily: without PG_INTEGRATION_URL this file must not load the Prisma engine.
  let prisma;
  let jsonb;
  let batcher;
  let processor;
  let sweeper;
  let axios;
  let app;
  let request;
  let jwt;

  const SHIFT_PNID = 'pnid_pg_shift';
  const EXTERNAL_PNID = 'pnid_pg_external';
  const FORWARD_URL = 'https://hook.example.test/pg-forward';
  const MIN = 60 * 1000;
  let seq = 0;
  let wamidOut = 0;

  const later = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ms = (v) => new Date(v).getTime();

  beforeAll(async () => {
    prisma = require('../../src/config/prisma');
    jsonb = require('../../src/db/jsonb');
    batcher = require('../../src/services/replyBatcher');
    processor = require('../../src/services/messageProcessor');
    sweeper = require('../../src/services/shiftSweeper');
    axios = require('axios');
    request = require('supertest');
    jwt = require('jsonwebtoken');
    app = require('../../src/app');
    // No in-process timers in this file: a requeue or a touchBatchDue would otherwise start a real run
    // in the background while a test inspects the rows. Tests call runBatch themselves.
    await batcher.shutdown(1);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "messages", "conversations", "users", "businesses" RESTART IDENTITY CASCADE');
    axios.post.mockReset();
    axios.post.mockImplementation(async (url) => {
      if (/\/messages$/.test(url)) {
        wamidOut += 1;
        return { status: 200, data: { messages: [{ id: `wamid.pgout${wamidOut}` }] } };
      }
      return { status: 200, data: {} };
    });
    mockGenerateContent.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── Fixtures ──────────────────────────────────────────────────────────────

  async function shiftBusiness(aiConfig = {}) {
    return prisma.business.create({
      data: {
        name: 'SHIFT', slug: `shift-${++seq}`, business_type: 'shift', status: 'active',
        wa_phone_number_id: SHIFT_PNID, wa_access_token: 'plain_test_token', ai_config: aiConfig,
      },
    });
  }

  async function conversation(business, fields = {}) {
    seq += 1;
    return prisma.conversation.create({
      data: {
        business_id: business.id, customer_wa_id: `96279${String(seq).padStart(7, '0')}`,
        last_inbound_at: new Date(), ...fields,
      },
    });
  }

  async function inbound(conv, fields = {}) {
    seq += 1;
    return prisma.message.create({
      data: {
        business_id: conv.business_id, conversation_id: conv.id, direction: 'inbound', status: 'received',
        message_type: 'text', text_body: `رسالة ${seq}`, meta_message_id: `wamid.pgin${seq}`, ...fields,
      },
    });
  }

  const convRow = (id) => prisma.conversation.findUnique({ where: { id } });
  const msgRow = (id) => prisma.message.findUnique({ where: { id } });

  function graphSends() {
    return axios.post.mock.calls
      .filter(([url, payload]) => /\/messages$/.test(url) && payload && ['text', 'interactive'].includes(payload.type));
  }

  function inboundPayload({ pnid = SHIFT_PNID, from, text = 'مرحبا', id }) {
    return {
      id: 'waba_pg',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: pnid },
          contacts: [{ wa_id: from, profile: { name: 'زبون' } }],
          messages: [{ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
        },
      }],
    };
  }

  // ─── 0. The connection really is pooled ────────────────────────────────────

  test('runs through the pooled URL with a working connection pool', async () => {
    const [row] = await prisma.$queryRaw`SELECT current_setting('server_version_num')::int AS v`;
    expect(row.v).toBeGreaterThanOrEqual(160000);
    // Many statements over few server connections: named prepared statements must survive PgBouncer.
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => prisma.$queryRaw`SELECT ${i}::int AS n`));
    expect(results.map((r) => r[0].n)).toEqual(Array.from({ length: 40 }, (_, i) => i));
  });

  // Prisma keeps DateTime columns as `timestamp(3)` WITHOUT time zone holding UTC. The script runs this file a
  // second time with the database TimeZone set to Asia/Amman: raw SQL must not store local wall time.
  test('timestamps stay UTC whatever the session TimeZone', async () => {
    const [{ tz }] = await prisma.$queryRaw`SELECT current_setting('TimeZone') AS tz`;
    const biz = await shiftBusiness();
    const conv = await conversation(biz);
    const msg = await inbound(conv);
    expect(Math.abs(ms(msg.created_at) - Date.now())).toBeLessThan(MIN);
    await jsonb.patchJson('conversations', conv.id, 'metadata', { a: 1 });
    const row = await convRow(conv.id);
    // Fails by the zone's offset (e.g. +3 h for Asia/Amman) when the SQL writes "updated_at" = now().
    expect({ tz, skewMs: Math.abs(ms(row.updated_at) - Date.now()) < MIN }).toEqual({ tz, skewMs: true });
    // A Postgres-written jsonb instant parses to the same absolute time in JS.
    await jsonb.acquireLease(conv.id, 'tok', 60000);
    const lease = (await convRow(conv.id)).metadata.reply_lease_until;
    expect(Math.abs(ms(lease) - Date.now() - 60000)).toBeLessThan(MIN);
  });

  // ─── 1. db/jsonb.js ────────────────────────────────────────────────────────

  describe('db/jsonb.js', () => {
    let biz;
    let conv;
    beforeEach(async () => {
      biz = await shiftBusiness();
      conv = await conversation(biz, {
        workflow_data: { lead: { name: 'سامر', version: 2 }, bot_turns: 3 },
        metadata: { human_active_until: null, reply_failures: 1 },
      });
    });

    test('casBusinessConfig: the Calendly cursor is a compare-and-set on one ai_config key, siblings kept', async () => {
      const b = await prisma.business.update({
        where: { id: biz.id }, data: { ai_config: { calendly_url: 'https://calendly.com/shift-ai/30min', test_numbers: ['962790000001'] } },
      });
      const read = async () => (await prisma.business.findUnique({ where: { id: b.id } })).ai_config;
      // Missing key = expected null.
      expect(await jsonb.casBusinessConfig(b.id, 'calendly_sync', null, { cursor: 'c1' })).toBe(true);
      expect(await jsonb.casBusinessConfig(b.id, 'calendly_sync', null, { cursor: 'c2' })).toBe(false);
      // Key order does not matter (jsonb equality).
      await jsonb.casBusinessConfig(b.id, 'calendly_sync', { cursor: 'c1' }, { unmatched: ['e1'], cursor: 'c3' });
      expect(await jsonb.casBusinessConfig(b.id, 'calendly_sync', { cursor: 'c3', unmatched: ['e1'] }, { cursor: 'c4', unmatched: ['e1'] })).toBe(true);
      expect(await read()).toEqual({
        calendly_url: 'https://calendly.com/shift-ai/30min', test_numbers: ['962790000001'], calendly_sync: { cursor: 'c4', unmatched: ['e1'] },
      });
      // Two racing writers from the same expected value: exactly one wins.
      const results = await Promise.all([
        jsonb.casBusinessConfig(b.id, 'calendly_sync', { cursor: 'c4', unmatched: ['e1'] }, { cursor: 'A' }),
        jsonb.casBusinessConfig(b.id, 'calendly_sync', { cursor: 'c4', unmatched: ['e1'] }, { cursor: 'B' }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    test('patchJson merges top-level keys, keeps siblings, removes keys, guards ifVersion', async () => {
      expect(await jsonb.patchJson('conversations', conv.id, 'workflow_data', { bot_turns: 4, disclosed_at: 'x' }))
        .toEqual({ ok: true, count: 1 });
      let row = await convRow(conv.id);
      expect(row.workflow_data).toEqual({ lead: { name: 'سامر', version: 2 }, bot_turns: 4, disclosed_at: 'x' });

      expect(await jsonb.patchJson('conversations', conv.id, 'workflow_data', {}, { remove: ['disclosed_at'] }))
        .toEqual({ ok: true, count: 1 });
      row = await convRow(conv.id);
      expect(row.workflow_data).not.toHaveProperty('disclosed_at');

      // Wrong version: nothing written.
      expect(await jsonb.patchJson('conversations', conv.id, 'workflow_data', { lead: { version: 9 } }, { ifVersion: 1 }))
        .toEqual({ ok: false, count: 0 });
      expect(await jsonb.patchJson('conversations', conv.id, 'workflow_data', { lead: { name: 'سامر', version: 3 } }, { ifVersion: 2 }))
        .toEqual({ ok: true, count: 1 });
      // No lead at all counts as version 0.
      const bare = await conversation(biz);
      expect((await jsonb.patchJson('conversations', bare.id, 'workflow_data', { lead: { version: 1 } }, { ifVersion: 0 })).ok).toBe(true);

      // Empty patch, nothing to remove: no SQL, ok. Unknown id: ok false.
      expect(await jsonb.patchJson('conversations', conv.id, 'metadata', {})).toEqual({ ok: true, count: 0 });
      expect(await jsonb.patchJson('conversations', 'nope', 'metadata', { a: 1 })).toEqual({ ok: false, count: 0 });
      await expect(jsonb.patchJson('conversations', conv.id, 'raw_payload', { a: 1 })).rejects.toThrow('jsonb: bad identifier');
    });

    test('patchJson: 20 concurrent writers of different keys all survive (server-side merge)', async () => {
      await Promise.all(Array.from({ length: 20 }, (_, i) => jsonb.patchJson('conversations', conv.id, 'metadata', { [`k${i}`]: i })));
      const row = await convRow(conv.id);
      for (let i = 0; i < 20; i++) expect(row.metadata[`k${i}`]).toBe(i);
      expect(row.metadata.reply_failures).toBe(1);
    });

    test('mergeObjectKey merges inside an object key only when it exists and contains match', async () => {
      await jsonb.patchJson('conversations', conv.id, 'workflow_data', {
        needs_team: { reason: 'quote', at: '2026-09-15T08:00:00.000Z', resolved_at: null, sla_note_sent_at: null },
      });
      expect(await jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'needs_team', { claimed_at: 'c' },
        { match: { reason: 'meeting' } })).toBe(false);
      expect(await jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'needs_team', { sla_note_sent_at: 's', sla_note_attempt: 1 },
        { match: { reason: 'quote', at: '2026-09-15T08:00:00.000Z', sla_note_sent_at: null, resolved_at: null } })).toBe(true);
      // null in match only matches a stored null now that it is set.
      expect(await jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'needs_team', { x: 1 },
        { match: { sla_note_sent_at: null } })).toBe(false);
      expect(await jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'needs_team', { x: 1 },
        { match: { sla_note_attempt: 1 } })).toBe(true);
      const row = await convRow(conv.id);
      expect(row.workflow_data.needs_team).toEqual({
        reason: 'quote', at: '2026-09-15T08:00:00.000Z', resolved_at: null, sla_note_sent_at: 's', sla_note_attempt: 1, x: 1,
      });
      expect(row.workflow_data.lead).toEqual({ name: 'سامر', version: 2 });
      // Not an object / missing: false, nothing resurrected.
      expect(await jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'bot_turns', { a: 1 })).toBe(false);
      expect(await jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'handoff', { a: 1 })).toBe(false);
      expect((await convRow(conv.id)).workflow_data).not.toHaveProperty('handoff');
    });

    test('claimFlag: once only, nested needs an object parent, 10 concurrent claimers → exactly one', async () => {
      expect(await jsonb.claimFlag('conversations', conv.id, 'metadata', ['flag_at'])).toBe(true);
      expect(await jsonb.claimFlag('conversations', conv.id, 'metadata', ['flag_at'])).toBe(false);
      const row = await convRow(conv.id);
      expect(Number.isFinite(ms(row.metadata.flag_at))).toBe(true);
      expect(Math.abs(ms(row.metadata.flag_at) - Date.now())).toBeLessThan(MIN);

      // Parent missing → false and the parent is not created.
      expect(await jsonb.claimFlag('conversations', conv.id, 'workflow_data', ['needs_team', 'claimed_at'])).toBe(false);
      expect((await convRow(conv.id)).workflow_data).not.toHaveProperty('needs_team');
      await jsonb.patchJson('conversations', conv.id, 'workflow_data', { needs_team: { reason: 'quote', claimed_at: null } });

      const results = await Promise.all(Array.from({ length: 10 },
        () => jsonb.claimFlag('conversations', conv.id, 'workflow_data', ['needs_team', 'claimed_at'])));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await convRow(conv.id)).workflow_data.needs_team.reason).toBe('quote');
    });

    test('claimValue: once per value, concurrent claimers of the same value → exactly one', async () => {
      const results = await Promise.all(Array.from({ length: 10 },
        () => jsonb.claimValue('conversations', conv.id, 'metadata', 'unanswered_alert_for', 'msg1')));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await jsonb.claimValue('conversations', conv.id, 'metadata', 'unanswered_alert_for', 'msg1')).toBe(false);
      expect(await jsonb.claimValue('conversations', conv.id, 'metadata', 'unanswered_alert_for', 'msg2')).toBe(true);
      // Stored as text; a number is compared as its text.
      expect(await jsonb.claimValue('conversations', conv.id, 'metadata', 'n', 5)).toBe(true);
      expect(await jsonb.claimValue('conversations', conv.id, 'metadata', 'n', '5')).toBe(false);
      // null: a missing key already IS DISTINCT FROM nothing → no write.
      expect(await jsonb.claimValue('conversations', conv.id, 'metadata', 'absent', null)).toBe(false);
      const row = await convRow(conv.id);
      expect(row.metadata).toMatchObject({ unanswered_alert_for: 'msg2', n: '5', reply_failures: 1 });
    });

    test('incrementCounter: 25 concurrent increments → 25 more, unknown id → null', async () => {
      const values = await Promise.all(Array.from({ length: 25 },
        () => jsonb.incrementCounter('conversations', conv.id, 'metadata', 'reply_failures')));
      expect(new Set(values).size).toBe(25);
      expect((await convRow(conv.id)).metadata.reply_failures).toBe(26);
      expect(await jsonb.incrementCounter('conversations', conv.id, 'metadata', 'fresh_counter', 3)).toBe(3);
      expect(await jsonb.incrementCounter('conversations', 'nope', 'metadata', 'reply_failures')).toBeNull();
    });

    test('acquireLease: 10 concurrent acquirers → exactly one; re-entry, expiry and release', async () => {
      const tokens = Array.from({ length: 10 }, (_, i) => `tok-${i}`);
      const results = await Promise.all(tokens.map((t) => jsonb.acquireLease(conv.id, t, 60000)));
      expect(results.filter(Boolean)).toHaveLength(1);
      const winner = tokens[results.indexOf(true)];
      let row = await convRow(conv.id);
      expect(row.metadata.lease_token).toBe(winner);
      expect(ms(row.metadata.reply_lease_until)).toBeGreaterThan(Date.now() + 50000);
      expect(row.metadata.reply_failures).toBe(1);

      expect(await jsonb.acquireLease(conv.id, winner, 60000)).toBe(true); // same run re-enters
      expect(await jsonb.acquireLease(conv.id, 'other', 60000)).toBe(false);
      expect(await jsonb.releaseLease(conv.id, 'other')).toBe(false);
      expect(await jsonb.releaseLease(conv.id, winner)).toBe(true);
      row = await convRow(conv.id);
      expect(row.metadata).not.toHaveProperty('lease_token');
      expect(row.metadata).not.toHaveProperty('reply_lease_until');

      // An expired lease is free for anyone.
      expect(await jsonb.acquireLease(conv.id, 'short', 1)).toBe(true);
      await later(20);
      expect(await jsonb.acquireLease(conv.id, 'next', 60000)).toBe(true);
    });

    test('renewLease: extends only an unexpired lease with the same token', async () => {
      expect(await jsonb.acquireLease(conv.id, 'tok', 5000)).toBe(true);
      const before = ms((await convRow(conv.id)).metadata.reply_lease_until);
      expect(await jsonb.renewLease(conv.id, 'tok', 60000)).toBe(true);
      expect(ms((await convRow(conv.id)).metadata.reply_lease_until)).toBeGreaterThan(before);
      expect(await jsonb.renewLease(conv.id, 'wrong', 60000)).toBe(false);

      expect(await jsonb.acquireLease(conv.id, 'tok', 1)).toBe(true);
      await later(20);
      // Nobody replaced it, but it expired: it must not come back to life (D20).
      expect(await jsonb.renewLease(conv.id, 'tok', 60000)).toBe(false);
      expect(await jsonb.renewLease('nope', 'tok', 60000)).toBe(false);
    });

    test('preSendCheck: lease, human state, opt-out and claim fences', async () => {
      // No lease requested: the no-op SET matches, and updated_at (Inbox order) is untouched.
      const u0 = (await convRow(conv.id)).updated_at;
      await later(5);
      expect(await jsonb.preSendCheck(conv.id, {})).toBe(true);
      expect((await convRow(conv.id)).updated_at).toEqual(u0);
      expect(await jsonb.preSendCheck('nope', {})).toBe(false);

      // Lease held → true and renewed; another token → false; expired → false.
      expect(await jsonb.acquireLease(conv.id, 'tok', 5000)).toBe(true);
      const before = ms((await convRow(conv.id)).metadata.reply_lease_until);
      expect(await jsonb.preSendCheck(conv.id, { leaseToken: 'tok', ttlMs: 60000 })).toBe(true);
      expect(ms((await convRow(conv.id)).metadata.reply_lease_until)).toBeGreaterThan(before);
      expect(await jsonb.preSendCheck(conv.id, { leaseToken: 'lost' })).toBe(false);
      expect(await jsonb.acquireLease(conv.id, 'tok', 1)).toBe(true);
      await later(20);
      expect(await jsonb.preSendCheck(conv.id, { leaseToken: 'tok' })).toBe(false);

      // Human state.
      await prisma.conversation.update({ where: { id: conv.id }, data: { status: 'human_takeover' } });
      expect(await jsonb.preSendCheck(conv.id, {})).toBe(false);
      expect(await jsonb.preSendCheck(conv.id, { humanGuard: false })).toBe(true);
      await prisma.conversation.update({ where: { id: conv.id }, data: { status: 'open', ai_enabled: false } });
      expect(await jsonb.preSendCheck(conv.id, {})).toBe(false);
      await prisma.conversation.update({ where: { id: conv.id }, data: { ai_enabled: true } });
      await jsonb.patchJson('conversations', conv.id, 'metadata', { human_active_until: new Date(Date.now() + 30 * MIN).toISOString() });
      expect(await jsonb.preSendCheck(conv.id, {})).toBe(false);
      expect(await jsonb.preSendCheck(conv.id, { humanGuard: false })).toBe(true);
      await jsonb.patchJson('conversations', conv.id, 'metadata', { human_active_until: new Date(Date.now() - MIN).toISOString() });
      expect(await jsonb.preSendCheck(conv.id, {})).toBe(true);
      await jsonb.patchJson('conversations', conv.id, 'metadata', { human_active_until: null });
      expect(await jsonb.preSendCheck(conv.id, {})).toBe(true);

      // Opt-out after the batch started → refuse; before → allow.
      const optedAt = new Date(Date.now() - 2 * MIN);
      await jsonb.patchJson('conversations', conv.id, 'workflow_data', { marketing_opted_out_at: optedAt.toISOString() });
      expect(await jsonb.preSendCheck(conv.id, { optedOutSince: new Date(optedAt.getTime() - MIN) })).toBe(false);
      expect(await jsonb.preSendCheck(conv.id, { optedOutSince: new Date(optedAt.getTime() + MIN) })).toBe(true);
      expect(await jsonb.preSendCheck(conv.id, { optedOutSince: optedAt })).toBe(true); // <= since
      // A Postgres-written timestamp (to_jsonb(now()), microseconds + offset) compares the same way.
      await prisma.$executeRaw`UPDATE "conversations" SET "workflow_data" = "workflow_data" || jsonb_build_object('marketing_opted_out_at', now()) WHERE "id" = ${conv.id}`;
      expect(await jsonb.preSendCheck(conv.id, { optedOutSince: new Date(Date.now() - MIN) })).toBe(false);
      await jsonb.patchJson('conversations', conv.id, 'workflow_data', { marketing_opted_out_at: null });

      // Claim fence: path must hold exactly this text; a number compares as text; a missing path never matches.
      await jsonb.patchJson('conversations', conv.id, 'workflow_data', { needs_team: { at: 'A1', sla_note_attempt: 2 } });
      await jsonb.patchJson('conversations', conv.id, 'metadata', { awaiting_note_for: 'row#1' });
      expect(await jsonb.preSendCheck(conv.id, {
        claim: [{ column: 'workflow_data', path: ['needs_team', 'at'], value: 'A1' },
          { column: 'workflow_data', path: ['needs_team', 'sla_note_attempt'], value: 2 }],
      })).toBe(true);
      expect(await jsonb.preSendCheck(conv.id, { claim: [{ column: 'workflow_data', path: ['needs_team', 'sla_note_attempt'], value: 1 }] })).toBe(false);
      expect(await jsonb.preSendCheck(conv.id, { claim: [{ column: 'metadata', path: ['awaiting_note_for'], value: 'row#1' }] })).toBe(true);
      expect(await jsonb.preSendCheck(conv.id, { claim: [{ column: 'metadata', path: ['nothing'], value: 'x' }] })).toBe(false);
      await expect(jsonb.preSendCheck(conv.id, { claim: [{ column: 'status', path: ['x'], value: 1 }] })).rejects.toThrow('bad identifier');
    });

    test('touchBatchDue: shared burst deadline on DB time, capped from the first fragment', async () => {
      const first = await jsonb.touchBatchDue(conv.id, 3000, 10000);
      expect(first.delayMs).toBeGreaterThan(2500);
      expect(first.delayMs).toBeLessThanOrEqual(3000);
      let row = await convRow(conv.id);
      const firstAt = row.metadata.batch_first_at;
      expect(ms(row.metadata.batch_due_at) - ms(firstAt)).toBeGreaterThanOrEqual(2990);
      expect(first.dueAt.getTime()).toBe(ms(row.metadata.batch_due_at));

      // A long quiet window inside the burst is capped at first + cap; batch_first_at is kept.
      const second = await jsonb.touchBatchDue(conv.id, 60000, 10000);
      row = await convRow(conv.id);
      expect(row.metadata.batch_first_at).toBe(firstAt);
      expect(ms(row.metadata.batch_due_at) - ms(firstAt)).toBe(10000);
      expect(second.delayMs).toBeLessThanOrEqual(10000);
      expect(second.delayMs).toBeGreaterThan(9000);

      // Due now: 0 delay; a deadline in the past starts a new burst.
      const zero = await jsonb.touchBatchDue(conv.id, 0, 10000);
      expect(zero.delayMs).toBe(0);
      await later(20);
      await jsonb.touchBatchDue(conv.id, 1000, 10000);
      row = await convRow(conv.id);
      expect(row.metadata.batch_first_at).not.toBe(firstAt);
      expect(row.metadata.reply_failures).toBe(1);
      expect(await jsonb.touchBatchDue('nope', 1000, 10000)).toBeNull();
    });

    test('resolveNeedsTeam: one statement, conditional on the request staff looked at', async () => {
      const nt = { reason: 'quote', at: '2026-09-15T08:00:00.000Z', resolved_at: null, sla_note_sent_at: 'S', claimed_at: null };
      await prisma.conversation.update({ where: { id: conv.id }, data: { status: 'pending' } });
      await jsonb.patchJson('conversations', conv.id, 'workflow_data', { needs_team: nt });

      await expect(jsonb.resolveNeedsTeam(conv.id, { match: {}, resolvedAt: 'x' })).rejects.toThrow('needs a match');
      // The bot replaced the request meanwhile: at differs → no change, still pending.
      expect(await jsonb.resolveNeedsTeam(conv.id, { match: { reason: 'quote', at: '2026-09-15T07:00:00.000Z' }, resolvedAt: 'R' })).toBe(false);
      expect((await convRow(conv.id)).status).toBe('pending');

      expect(await jsonb.resolveNeedsTeam(conv.id, { match: { reason: 'quote', at: nt.at }, resolvedAt: 'R' })).toBe(true);
      let row = await convRow(conv.id);
      expect(row.status).toBe('open');
      expect(row.workflow_data.needs_team).toEqual({ ...nt, resolved_at: 'R' });
      expect(row.workflow_data.lead).toEqual({ name: 'سامر', version: 2 });
      // Already resolved → false.
      expect(await jsonb.resolveNeedsTeam(conv.id, { match: { reason: 'quote', at: nt.at }, resolvedAt: 'R2' })).toBe(false);

      // A claimed conversation keeps its status.
      const other = await conversation(biz, { status: 'human_takeover', workflow_data: { needs_team: { ...nt } } });
      expect(await jsonb.resolveNeedsTeam(other.id, { match: { at: nt.at }, resolvedAt: 'R' })).toBe(true);
      row = await convRow(other.id);
      expect(row.status).toBe('human_takeover');
      expect(row.workflow_data.needs_team.resolved_at).toBe('R');
      // No needs_team at all → false.
      const none = await conversation(biz);
      expect(await jsonb.resolveNeedsTeam(none.id, { match: { at: nt.at }, resolvedAt: 'R' })).toBe(false);
    });

    test('writeConversationState: CASE on the stored needs_team, RETURNING, never over a claim', async () => {
      const P = { unsent_reply: 6, person: 5, complaint: 5, meeting: 4, quote: 3, demo: 2, unknown: 1, ai_failure: 0 };
      const entry = (reason, at) => ({ reason, at, summary: reason, resolved_at: null, claimed_at: null });
      await expect(jsonb.writeConversationState(conv.id, {})).rejects.toThrow('needs a status');

      // Nothing stored → recorded; current_state set; patch merged, siblings kept.
      let r = await jsonb.writeConversationState(conv.id, {
        status: 'pending', currentState: 'discovery', patch: { bot_turns: 4 }, needsTeam: entry('quote', 'A1'), priorities: P, defaultPriority: 1,
      });
      expect(r).toEqual({ ok: true, needsTeam: { reason: 'quote', at: 'A1' } });
      let row = await convRow(conv.id);
      expect(row).toMatchObject({ status: 'pending', current_state: 'discovery' });
      expect(row.workflow_data).toMatchObject({ bot_turns: 4, lead: { name: 'سامر', version: 2 }, needs_team: entry('quote', 'A1') });

      // Lower priority does not replace; currentState undefined leaves current_state.
      r = await jsonb.writeConversationState(conv.id, { status: 'pending', needsTeam: entry('demo', 'A2'), priorities: P });
      expect(r.needsTeam).toEqual({ reason: 'quote', at: 'A1' });
      expect((await convRow(conv.id)).current_state).toBe('discovery');
      // Equal priority does not replace either (strictly lower only).
      r = await jsonb.writeConversationState(conv.id, { status: 'pending', needsTeam: entry('quote', 'A3'), priorities: P });
      expect(r.needsTeam).toEqual({ reason: 'quote', at: 'A1' });
      // Higher priority replaces.
      r = await jsonb.writeConversationState(conv.id, { status: 'pending', needsTeam: entry('person', 'A4'), priorities: P });
      expect(r.needsTeam).toEqual({ reason: 'person', at: 'A4' });
      // An unknown stored reason uses defaultPriority.
      await jsonb.patchJson('conversations', conv.id, 'workflow_data', { needs_team: { reason: 'weird', at: 'W' } });
      r = await jsonb.writeConversationState(conv.id, { status: 'pending', needsTeam: entry('unknown', 'A5'), priorities: P, defaultPriority: 1 });
      expect(r.needsTeam).toEqual({ reason: 'weird', at: 'W' });
      r = await jsonb.writeConversationState(conv.id, { status: 'pending', needsTeam: entry('demo', 'A6'), priorities: P, defaultPriority: 1 });
      expect(r.needsTeam).toEqual({ reason: 'demo', at: 'A6' });
      // Resolved or claimed stored entries are replaced whatever their priority.
      await jsonb.patchJson('conversations', conv.id, 'workflow_data', { needs_team: { ...entry('person', 'B1'), resolved_at: 'R' } });
      r = await jsonb.writeConversationState(conv.id, { status: 'pending', needsTeam: entry('ai_failure', 'B2'), priorities: P });
      expect(r.needsTeam).toEqual({ reason: 'ai_failure', at: 'B2' });
      await jsonb.patchJson('conversations', conv.id, 'workflow_data', { needs_team: { ...entry('person', 'C1'), claimed_at: 'C' } });
      r = await jsonb.writeConversationState(conv.id, { status: 'pending', needsTeam: entry('demo', 'C2'), priorities: P });
      expect(r.needsTeam).toEqual({ reason: 'demo', at: 'C2' });

      // No candidate: status only; null current_state clears it.
      r = await jsonb.writeConversationState(conv.id, { status: 'open', currentState: null, patch: { x: 1 } });
      expect(r).toEqual({ ok: true, needsTeam: { reason: 'demo', at: 'C2' } });
      row = await convRow(conv.id);
      expect(row).toMatchObject({ status: 'open', current_state: null });
      const bare = await conversation(biz);
      expect(await jsonb.writeConversationState(bare.id, { status: 'open' })).toEqual({ ok: true, needsTeam: null });
      // Empty priorities object and a null candidate bind cleanly too.
      expect((await jsonb.writeConversationState(bare.id, { status: 'open', needsTeam: null, priorities: {} })).ok).toBe(true);

      // Claimed by staff: no row, nothing written.
      await prisma.conversation.update({ where: { id: conv.id }, data: { status: 'human_takeover' } });
      r = await jsonb.writeConversationState(conv.id, { status: 'pending', patch: { y: 1 }, needsTeam: entry('unsent_reply', 'D1'), priorities: P });
      expect(r).toEqual({ ok: false, needsTeam: null });
      row = await convRow(conv.id);
      expect(row.status).toBe('human_takeover');
      expect(row.workflow_data).not.toHaveProperty('y');
    });
  });

  test('D27 race, 30 rounds: «تم التواصل» on the old request vs the bot recording a newer one → never hidden as open', async () => {
    const P = { person: 5, quote: 3 };
    const biz = await shiftBusiness();
    for (let i = 0; i < 30; i++) {
      const oldReq = { reason: 'quote', at: `2026-09-15T08:00:${String(i).padStart(2, '0')}.000Z`, resolved_at: null, claimed_at: null };
      const newReq = { reason: 'person', at: `2026-09-15T09:00:${String(i).padStart(2, '0')}.000Z`, resolved_at: null, claimed_at: null };
      const conv = await conversation(biz, { status: 'pending', workflow_data: { needs_team: oldReq } });
      const ops = [
        () => jsonb.resolveNeedsTeam(conv.id, { match: { reason: oldReq.reason, at: oldReq.at }, resolvedAt: 'R' }),
        () => jsonb.writeConversationState(conv.id, { status: 'pending', needsTeam: newReq, priorities: P }),
      ];
      await Promise.all(i % 2 ? ops.map((f) => f()) : ops.reverse().map((f) => f()));
      const row = await convRow(conv.id);
      expect({ i, status: row.status, nt: row.workflow_data.needs_team }).toEqual({ i, status: 'pending', nt: newReq });
    }
  });

  // ─── 2. messageProcessor ───────────────────────────────────────────────────

  describe('messageProcessor', () => {
    test('persistInbound: 6 concurrent deliveries of one new message → one conversation, one row, counters once', async () => {
      const biz = await shiftBusiness();
      const entry = inboundPayload({ from: '962790000777', id: 'wamid.dup1' });
      const settled = await Promise.allSettled(Array.from({ length: 6 }, () => processor.persistInbound(entry)));
      const errors = settled.filter((s) => s.status === 'rejected').map((s) => s.reason && s.reason.message);
      expect(errors).toEqual([]);
      const items = settled.flatMap((s) => s.value.items);
      expect(items).toHaveLength(6);
      expect(items.filter((i) => i.created)).toHaveLength(1);
      expect(items.filter((i) => i.claimed)).toHaveLength(1);

      const convs = await prisma.conversation.findMany({ where: { business_id: biz.id } });
      expect(convs).toHaveLength(1);
      expect(convs[0].unread_count).toBe(1);
      const rows = await prisma.message.findMany({ where: { conversation_id: convs[0].id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'received', meta_message_id: 'wamid.dup1', text_body: 'مرحبا' });
      expect(ms(convs[0].last_inbound_at)).toBe(ms(rows[0].created_at));
    });

    test('persistInbound: 60 concurrent deliveries (10 customers × 3 messages, each delivered twice) → 30 rows, exact counters', async () => {
      const biz = await shiftBusiness();
      const entries = [];
      for (let c = 0; c < 10; c++) {
        for (let m = 0; m < 3; m++) {
          const e = inboundPayload({ from: `9627911${String(c).padStart(5, '0')}`, id: `wamid.load${c}_${m}`, text: `m${m}` });
          entries.push(e, e);
        }
      }
      const settled = await Promise.allSettled(entries.map((e) => processor.persistInbound(e)));
      expect(settled.filter((s) => s.status === 'rejected').map((s) => `${s.reason.code} ${s.reason.message}`)).toEqual([]);
      expect(settled.flatMap((s) => s.value.items).filter((i) => i.created)).toHaveLength(30);
      const convs = await prisma.conversation.findMany({ where: { business_id: biz.id } });
      expect(convs).toHaveLength(10);
      expect(convs.every((c) => c.unread_count === 3)).toBe(true);
      expect(await prisma.message.count({ where: { business_id: biz.id } })).toBe(30);
    });

    test('persistInbound: a U+0000 in the message is stored without it (Postgres rejects NUL in text and jsonb)', async () => {
      const biz = await shiftBusiness();
      const NUL = String.fromCharCode(0);
      const entry = inboundPayload({ from: '962790000780', id: 'wamid.nul1', text: `مر${NUL}حبا` });
      entry.changes[0].value.contacts[0].profile.name = `زبون${NUL}`;
      const { items } = await processor.persistInbound(entry);
      expect(items[0].created).toBe(true);
      const row = await prisma.message.findUnique({ where: { meta_message_id: 'wamid.nul1' } });
      expect(row.text_body).toBe('مرحبا');
      expect(row.raw_payload.text.body).toBe('مرحبا');
      const [conv] = await prisma.conversation.findMany({ where: { business_id: biz.id } });
      expect(conv).toMatchObject({ profile_name: 'زبون', unread_count: 1 });
    });

    test('persistInbound: a burst of different messages committed concurrently counts each once, last_inbound_at = newest', async () => {
      const biz = await shiftBusiness();
      const from = '962790000778';
      await processor.persistInbound(inboundPayload({ from, id: 'wamid.b0' }));
      await Promise.all(Array.from({ length: 8 }, (_, i) => processor.persistInbound(inboundPayload({ from, id: `wamid.b${i + 1}`, text: `جزء ${i}` }))));
      const [conv] = await prisma.conversation.findMany({ where: { business_id: biz.id } });
      expect(conv.unread_count).toBe(9);
      const rows = await prisma.message.findMany({ where: { conversation_id: conv.id }, orderBy: { created_at: 'desc' } });
      expect(rows).toHaveLength(9);
      expect(ms(conv.last_inbound_at)).toBe(Math.max(...rows.map((m) => ms(m.created_at))));
    });

    test('persistInbound: a failing counter update rolls the row back (the retry then inserts it)', async () => {
      const biz = await shiftBusiness();
      const conv = await conversation(biz, { customer_wa_id: '962790000779' });
      const entry = inboundPayload({ from: '962790000779', id: 'wamid.rb1' });
      // Force the second statement of the transaction to fail inside Postgres: unread_count overflows int4.
      await prisma.conversation.update({ where: { id: conv.id }, data: { unread_count: 2147483647 } });
      await expect(processor.persistInbound(entry)).rejects.toBeTruthy();
      expect(await prisma.message.count({ where: { meta_message_id: 'wamid.rb1' } })).toBe(0);
      await prisma.conversation.update({ where: { id: conv.id }, data: { unread_count: 0 } });
      const { items } = await processor.persistInbound(entry);
      expect(items[0].created).toBe(true);
      expect((await convRow(conv.id)).unread_count).toBe(1);
    });

    test('reprocessStuckInbound selects processing rows older than the cutoff, reprocessing ones are given up', async () => {
      const external = await prisma.business.create({
        data: {
          name: 'External', slug: 'ext', business_type: 'restaurant', status: 'active', wa_phone_number_id: EXTERNAL_PNID,
          ai_config: { reply_mode: 'external', forward_url: FORWARD_URL },
        },
      });
      const shift = await shiftBusiness();
      const extConv = await conversation(external, { profile_name: 'مطعم' });
      const shiftConv = await conversation(shift);
      const old = new Date(Date.now() - 5 * MIN);
      const stuck = await inbound(extConv, {
        status: 'processing', created_at: old, raw_payload: { id: 'wamid.stuck', type: 'text', text: { body: 'hi' } },
      });
      const fresh = await inbound(extConv, { status: 'processing' });
      const abandoned = await inbound(extConv, { status: 'reprocessing', created_at: old });
      // updated_at is @updatedAt: an explicit value in `data` wins, and Prisma writes it as UTC whatever the
      // session TimeZone (a raw `SET updated_at = $1` would be converted with the session TimeZone).
      await prisma.message.update({ where: { id: abandoned.id }, data: { updated_at: old } });
      const recentClaim = await inbound(extConv, { status: 'reprocessing', created_at: old });
      const shiftStuck = await inbound(shiftConv, { status: 'processing', created_at: old });

      const report = await processor.reprocessStuckInbound({ olderThanMs: 2 * MIN, now: new Date() });
      expect(report).toEqual({ reprocessed: 2, gaveUp: 1, errors: [] });
      expect((await msgRow(stuck.id)).status).toBe('delivered');
      expect((await msgRow(fresh.id)).status).toBe('processing');
      expect((await msgRow(abandoned.id)).status).toBe('delivered');
      expect((await msgRow(recentClaim.id)).status).toBe('reprocessing');
      expect((await msgRow(shiftStuck.id)).status).toBe('received');
      const forwards = axios.post.mock.calls.filter(([url]) => url === FORWARD_URL);
      expect(forwards).toHaveLength(1);
      expect(forwards[0][1].messages[0].id).toBe('wamid.stuck');

      // Two sweeps at once: the processing → reprocessing claim lets only one re-run it.
      const again = await inbound(extConv, { status: 'processing', created_at: old, raw_payload: { id: 'wamid.stuck2', type: 'text' } });
      const both = await Promise.all([
        processor.reprocessStuckInbound({ olderThanMs: 2 * MIN }), processor.reprocessStuckInbound({ olderThanMs: 2 * MIN }),
      ]);
      expect(both[0].reprocessed + both[1].reprocessed).toBe(1);
      expect((await msgRow(again.id)).status).toBe('delivered');
    });
  });

  // ─── 3. replyBatcher ───────────────────────────────────────────────────────

  describe('replyBatcher send-intent protocol', () => {
    let biz;
    let conv;
    let rows;
    beforeEach(async () => {
      biz = await shiftBusiness();
      conv = await conversation(biz);
      rows = [await inbound(conv, { created_at: new Date(Date.now() - 3000) }), await inbound(conv, { created_at: new Date(Date.now() - 2000) })];
    });

    const parts = [{ type: 'text', text: 'جزء أول' }, { type: 'text', text: 'جزء ثاني' }];

    test('dispatchIntent: intent rows before Graph, callback id echoed, rows answered, dedupe on batch_key', async () => {
      const batchIds = rows.map((m) => m.id);
      const batchKey = rows[1].id;
      axios.post.mockImplementation(async (url, payload) => {
        // The intent row exists (sending) when Graph is called.
        const intent = await prisma.message.findUnique({ where: { id: payload.biz_opaque_callback_data } });
        expect(intent.status).toBe('sending');
        wamidOut += 1;
        return { status: 200, data: { messages: [{ id: `wamid.pgout${wamidOut}` }] } };
      });
      const r = await batcher.dispatchIntent({
        business: biz, conversation: conv, kind: 'reply', parts, batchIds, batchKey, since: rows[0].created_at, precheck: {},
      });
      expect(r.outcome).toBe('sent');
      expect(r.parts.map((p) => p.status)).toEqual(['sent', 'sent']);
      const sends = graphSends();
      expect(sends).toHaveLength(2);
      const intents = await prisma.message.findMany({ where: { conversation_id: conv.id, direction: 'outbound' }, orderBy: { created_at: 'asc' } });
      expect(intents).toHaveLength(2);
      intents.forEach((m, i) => {
        expect(m.status).toBe('sent');
        expect(m.meta_message_id).toMatch(/^wamid\.pgout/);
        expect(m.raw_payload).toMatchObject({ kind: 'reply', batch_key: `${batchKey}:${i}`, part_index: i, batch_ids: batchIds });
      });
      expect(sends.map(([, p]) => p.biz_opaque_callback_data).sort()).toEqual(intents.map((m) => m.id).sort());
      for (const m of rows) expect((await msgRow(m.id)).status).toBe('answered');

      // Same batch key again: nothing reaches Graph.
      const again = await batcher.dispatchIntent({
        business: biz, conversation: conv, kind: 'reply', parts, batchIds, batchKey, since: rows[0].created_at, precheck: {},
      });
      expect(again.outcome).toBe('deduped');
      expect(graphSends()).toHaveLength(2);
    });

    test('dispatchIntent: a refused pre-send check cancels the intent and never calls Graph', async () => {
      await prisma.conversation.update({ where: { id: conv.id }, data: { status: 'human_takeover', ai_enabled: false } });
      const r = await batcher.dispatchIntent({
        business: biz, conversation: conv, kind: 'reply', parts, batchIds: rows.map((m) => m.id), batchKey: rows[1].id, precheck: {},
      });
      expect(r.outcome).toBe('aborted');
      expect(graphSends()).toHaveLength(0);
      const intents = await prisma.message.findMany({ where: { conversation_id: conv.id, direction: 'outbound' } });
      expect(intents.map((m) => m.status)).toEqual(['cancelled']);
      for (const m of rows) expect((await msgRow(m.id)).status).toBe('received');
    });

    test('ambiguous send → unconfirmed rows; applyIntentStatus by callback id confirms and never regresses', async () => {
      axios.post.mockImplementation(async () => { throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED', request: {} }); });
      const r = await batcher.dispatchIntent({
        business: biz, conversation: conv, kind: 'reply', parts: parts.slice(0, 1), batchIds: rows.map((m) => m.id), batchKey: rows[1].id,
      });
      expect(r.outcome).toBe('ambiguous');
      const [intent] = await prisma.message.findMany({ where: { conversation_id: conv.id, direction: 'outbound' } });
      expect(intent.status).toBe('ambiguous');
      for (const m of rows) expect((await msgRow(m.id)).status).toBe('unconfirmed');

      // Status webhook echoes the intent id.
      const status = {
        id: 'wamid.echoed1', status: 'delivered', recipient_id: conv.customer_wa_id, biz_opaque_callback_data: intent.id,
      };
      await processor.processInboundMessage({ changes: [{ value: { metadata: { phone_number_id: SHIFT_PNID }, statuses: [status] } }] });
      let row = await msgRow(intent.id);
      expect(row).toMatchObject({ status: 'delivered', meta_message_id: 'wamid.echoed1' });
      for (const m of rows) expect((await msgRow(m.id)).status).toBe('answered');

      // A late `sent` never moves it back; `read` moves it forward.
      expect((await batcher.applyIntentStatus({ intentId: intent.id, status: 'sent' })).matched).toBe(true);
      expect((await msgRow(intent.id)).status).toBe('delivered');
      await batcher.applyIntentStatus({ intentId: intent.id, status: 'read' });
      expect((await msgRow(intent.id)).status).toBe('read');

      // A wamid already held by another row (unique meta_message_id): the status still applies (P2002 path).
      const other = await prisma.message.create({
        data: {
          business_id: biz.id, conversation_id: conv.id, direction: 'outbound', status: 'ambiguous', text_body: 'x',
          is_ai_generated: true, raw_payload: { kind: 'reply', batch_key: 'zz:0', batch_ids: [] },
        },
      });
      const res = await batcher.applyIntentStatus({ intentId: other.id, wamid: 'wamid.echoed1', status: 'delivered' });
      expect(res.matched).toBe(true);
      row = await msgRow(other.id);
      expect(row).toMatchObject({ status: 'delivered', meta_message_id: null });
    });

    test('reconcileUnconfirmedIntents: first time requeues, second time for the batch key escalates', async () => {
      const batchIds = rows.map((m) => m.id);
      const key = `${rows[1].id}:0`;
      const old = new Date(Date.now() - 3 * MIN);
      const makeIntent = (status) => prisma.message.create({
        data: {
          business_id: biz.id, conversation_id: conv.id, direction: 'outbound', status, text_body: 'رد', is_ai_generated: true,
          created_at: old, raw_payload: { kind: 'reply', batch_key: key, part_index: 0, batch_ids: batchIds, inbound_status: 'answered' },
        },
      });
      const fresh = await prisma.message.create({
        data: {
          business_id: biz.id, conversation_id: conv.id, direction: 'outbound', status: 'ambiguous', text_body: 'new', is_ai_generated: true,
          raw_payload: { kind: 'reply', batch_key: 'other:0', batch_ids: [] },
        },
      });
      const first = await makeIntent('ambiguous');
      await prisma.message.updateMany({ where: { id: { in: batchIds } }, data: { status: 'unconfirmed' } });

      let report = await batcher.reconcileUnconfirmedIntents({ now: new Date(), businessId: biz.id });
      expect(report).toMatchObject({ requeued: 1, escalated: 0, unreconciled: 0, errors: [] });
      let row = await msgRow(first.id);
      expect(row.status).toBe('ambiguous_unreconciled');
      expect(row.raw_payload.settled).toBe('requeued');
      for (const m of rows) expect((await msgRow(m.id)).status).toBe('received');
      expect((await msgRow(fresh.id)).status).toBe('ambiguous'); // younger than 2 min: untouched

      // Two sweeps at once on the retry: one claim, one escalation.
      const second = await makeIntent('sending');
      await prisma.message.updateMany({ where: { id: { in: batchIds } }, data: { status: 'unconfirmed' } });
      const both = await Promise.all([
        batcher.reconcileUnconfirmedIntents({ now: new Date(), businessId: biz.id }),
        batcher.reconcileUnconfirmedIntents({ now: new Date(), businessId: biz.id }),
      ]);
      expect(both[0].escalated + both[1].escalated).toBe(1);
      row = await msgRow(second.id);
      expect(row.raw_payload.settled).toBe('escalated');
      for (const m of rows) expect((await msgRow(m.id)).status).toBe('awaiting_staff');
      const c = await convRow(conv.id);
      expect(c.status).toBe('pending');
      expect(c.workflow_data.needs_team).toMatchObject({ reason: 'unsent_reply', resolved_at: null });
      report = await batcher.reconcileUnconfirmedIntents({ now: new Date(), businessId: biz.id });
      expect(report).toMatchObject({ requeued: 0, escalated: 0 });
    });

    test('runBatch end to end: lease, Gemini (mocked) FLAG_FOR_TEAM, writeConversationState, lead, intent, release', async () => {
      const reply = {
        reply: 'أكيد، الفريق بجهزلك عرض سعر.', action: 'FLAG_FOR_TEAM', action_args: { reason: 'quote', summary: 'عرض سعر لعيادة' },
        buttons: [], lead: { name: 'ليلى', sector: 'clinic' }, stage: 'fit', next_step: 'question',
      };
      mockGenerateContent.mockResolvedValue({
        response: { text: () => JSON.stringify(reply), usageMetadata: {}, candidates: [{ finishReason: 'STOP' }] },
      });
      const out = await batcher.runBatch(conv.id);
      expect(out.outcome).toBe('sent');
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const sends = graphSends();
      expect(sends.length).toBeGreaterThanOrEqual(1);
      const c = await convRow(conv.id);
      expect(c.metadata).not.toHaveProperty('lease_token');
      expect(c.status).toBe('pending');
      expect(c.workflow_data.needs_team).toMatchObject({ reason: 'quote' });
      expect(c.workflow_data.lead).toMatchObject({ name: 'ليلى', version: 1 });
      for (const m of rows) expect((await msgRow(m.id)).status).toBe('answered');
      const intents = await prisma.message.findMany({ where: { conversation_id: conv.id, direction: 'outbound' } });
      expect(intents.every((m) => m.status === 'sent' && m.raw_payload.batch_key.startsWith(`${rows[1].id}:`))).toBe(true);

      // A second run finds nothing to answer.
      expect((await batcher.runBatch(conv.id)).outcome).toBe('no_batch');
    });

    test('runBatch: two instances racing on the same burst → one generation, one reply', async () => {
      mockGenerateContent.mockImplementation(async () => {
        await later(300);
        return { response: { text: () => JSON.stringify({ reply: 'أهلين!', action: 'NONE', stage: 'discovery' }), usageMetadata: {}, candidates: [{ finishReason: 'STOP' }] } };
      });
      const outs = await Promise.all([batcher.runBatch(conv.id), batcher.runBatch(conv.id)]);
      expect(outs.map((o) => o.outcome).sort()).toEqual(['lease_busy', 'sent']);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(graphSends()).toHaveLength(1);
    });
  });

  describe('status webhooks, opt-out and the signed webhook route', () => {
    test('D19: a failed status for a sent covering intent requeues its rows once, then escalates', async () => {
      const biz = await shiftBusiness();
      const conv = await conversation(biz);
      const row = await inbound(conv);
      const first = await batcher.dispatchIntent({
        business: biz, conversation: conv, kind: 'reply', parts: [{ type: 'text', text: 'رد' }], batchIds: [row.id], batchKey: row.id,
      });
      expect(first.outcome).toBe('sent');
      expect((await msgRow(row.id)).status).toBe('answered');
      const [intent] = await prisma.message.findMany({ where: { conversation_id: conv.id, direction: 'outbound' } });
      const failed = (id, wamid) => ({
        changes: [{
          value: {
            metadata: { phone_number_id: SHIFT_PNID },
            statuses: [{ id: wamid, status: 'failed', recipient_id: conv.customer_wa_id, biz_opaque_callback_data: id, errors: [{ code: 131000, title: 'x' }] }],
          },
        }],
      });
      await processor.processInboundMessage(failed(intent.id, intent.meta_message_id));
      let settled = await msgRow(intent.id);
      expect(settled.status).toBe('failed');
      expect(settled.raw_payload).toMatchObject({ settled: 'requeued', status_error: { code: 131000 } });
      expect((await msgRow(row.id)).status).toBe('received');

      // The retry is sent and fails again: rows go to staff.
      const retry = await batcher.dispatchIntent({
        business: biz, conversation: conv, kind: 'reply', parts: [{ type: 'text', text: 'رد' }], batchIds: [row.id], batchKey: row.id,
      });
      expect(retry.outcome).toBe('sent');
      const second = (await prisma.message.findMany({ where: { conversation_id: conv.id, direction: 'outbound' }, orderBy: { created_at: 'asc' } }))
        .find((m) => m.id !== intent.id);
      await processor.processInboundMessage(failed(second.id, second.meta_message_id));
      settled = await msgRow(second.id);
      expect(settled.raw_payload.settled).toBe('escalated');
      expect((await msgRow(row.id)).status).toBe('awaiting_staff');
      const c = await convRow(conv.id);
      expect(c.status).toBe('pending');
      expect(c.workflow_data.needs_team.reason).toBe('unsent_reply');
    });

    test('runBatch opt-out: state before the ack, command row skipped, nothing else answered', async () => {
      const biz = await shiftBusiness();
      const conv = await conversation(biz, { workflow_data: { lead: { name: 'x', version: 1 } } });
      const hello = await inbound(conv, { text_body: 'مرحبا', created_at: new Date(Date.now() - 3000) });
      const stop = await inbound(conv, { text_body: 'إيقاف', created_at: new Date(Date.now() - 2000) });
      const out = await batcher.runBatch(conv.id);
      expect(out.outcome).toBe('sent');
      expect(mockGenerateContent).not.toHaveBeenCalled();
      expect(graphSends()).toHaveLength(1);
      const c = await convRow(conv.id);
      expect(c.workflow_data.marketing_opted_out_at).toBeTruthy();
      expect(c.workflow_data.lead).toEqual({ name: 'x', version: 1 });
      expect(c.current_state).toBe('closed');
      expect((await msgRow(stop.id)).status).toBe('skipped');
      expect((await msgRow(hello.id)).status).toBe('skipped');
      const [ack] = await prisma.message.findMany({ where: { conversation_id: conv.id, direction: 'outbound' } });
      expect(ack).toMatchObject({ status: 'sent' });
      expect(ack.raw_payload).toMatchObject({ kind: 'optout', batch_ids: [stop.id], inbound_status: 'skipped' });
    });

    test('POST /api/whatsapp/webhook persists before 200 (signed), a Meta retry is a duplicate', async () => {
      const crypto = require('crypto');
      await shiftBusiness();
      const body = { object: 'whatsapp_business_account', entry: [inboundPayload({ from: '962790000901', id: 'wamid.route1', text: 'مرحبا' })] };
      const raw = JSON.stringify(body);
      const sig = `sha256=${crypto.createHmac('sha256', process.env.META_APP_SECRET).update(Buffer.from(raw)).digest('hex')}`;
      const post = () => request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json').set('x-hub-signature-256', sig).send(raw);
      expect((await post()).status).toBe(200);
      // Durable at the time of the 200.
      const rows = await prisma.message.findMany({ where: { meta_message_id: 'wamid.route1' } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('received');
      expect((await post()).status).toBe(200);
      await later(200);
      expect(await prisma.message.count({ where: { meta_message_id: 'wamid.route1' } })).toBe(1);
      const conv = await convRow(rows[0].conversation_id);
      expect(conv.unread_count).toBe(1);
      expect(conv.metadata.batch_due_at).toBeTruthy(); // touchBatchDue ran after the response
    });
  });

  // ─── 4. Sweeper ────────────────────────────────────────────────────────────

  test('shiftSweeper.runSweep: one main pass against real rows', async () => {
    const allDay = { team_hours: { days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59', tz: 'UTC', closures: [] } };
    const biz = await shiftBusiness(allDay);
    const now = new Date();
    const ago = (m) => new Date(now.getTime() - m * MIN);

    // SLA note: unclaimed quote request 90 min old.
    const slaAt = ago(90).toISOString();
    const sla = await conversation(biz, {
      status: 'pending', last_inbound_at: ago(95),
      workflow_data: { needs_team: { reason: 'quote', summary: 'عرض', at: slaAt, resolved_at: null, sla_note_sent_at: null, claimed_at: null, claimed_by: null } },
    });
    await inbound(sla, { status: 'answered', created_at: ago(95) });
    // Awaiting-staff note: parked messages 15 min old, staff pause still running.
    const waiting = await conversation(biz, {
      last_inbound_at: ago(15), metadata: { human_active_until: new Date(now.getTime() + 20 * MIN).toISOString() },
    });
    const parked = await inbound(waiting, { status: 'awaiting_staff', created_at: ago(15), text_body: 'بدي أعرف السعر' });
    // Expired pause: parked row goes back to received (then orphans schedule it; timers are off here).
    const paused = await conversation(biz, { last_inbound_at: ago(3), metadata: { human_active_until: ago(1).toISOString() } });
    const unpaused = await inbound(paused, { status: 'awaiting_staff', created_at: ago(3) });
    // Window flag: pending conversation, last inbound 23 h ago.
    const windowConv = await conversation(biz, { status: 'pending', last_inbound_at: ago(23 * 60) });
    // Unanswered: inbound 5 min old with no outbound.
    const silent = await conversation(biz, { last_inbound_at: ago(5) });
    await inbound(silent, { status: 'skipped', created_at: ago(5) });
    // Unconfirmed intent older than 2 min.
    const unsure = await conversation(biz, { last_inbound_at: ago(4) });
    const unsureRow = await inbound(unsure, { status: 'unconfirmed', created_at: ago(4) });
    await prisma.message.create({
      data: {
        business_id: biz.id, conversation_id: unsure.id, direction: 'outbound', status: 'ambiguous', text_body: 'رد', is_ai_generated: true,
        created_at: ago(3), raw_payload: { kind: 'reply', batch_key: `${unsureRow.id}:0`, part_index: 0, batch_ids: [unsureRow.id] },
      },
    });

    const report = await sweeper.runSweep({ now });
    expect(report.errors).toEqual([]);
    expect(report).toMatchObject({
      unconfirmed_requeued: 1, pause_requeued: 1, sla_notes: 1, awaiting_notes: 1, window_flags: 1,
    });
    expect(report.unanswered_alerts).toBeGreaterThanOrEqual(1);
    expect(report.orphans).toBeGreaterThanOrEqual(0);

    const slaRow = await convRow(sla.id);
    expect(slaRow.workflow_data.needs_team).toMatchObject({ sla_note_attempt: 1 });
    expect(slaRow.workflow_data.needs_team.sla_note_done_at).toBeTruthy();
    const slaIntents = await prisma.message.findMany({ where: { conversation_id: sla.id, direction: 'outbound' } });
    expect(slaIntents).toHaveLength(1);
    expect(slaIntents[0]).toMatchObject({ status: 'sent' });
    expect(slaIntents[0].raw_payload.batch_key).toBe(`sla_note:quote:${slaAt}:0`);

    const waitingRow = await convRow(waiting.id);
    expect(waitingRow.metadata).toMatchObject({ awaiting_note_for: `${parked.id}#1`, awaiting_note_done_for: parked.id });
    expect(waitingRow.metadata.human_active_until).toBeTruthy(); // siblings kept
    expect((await msgRow(unpaused.id)).status).toBe('received');
    expect((await convRow(windowConv.id)).metadata.window_flag_for).toBe(new Date(windowConv.last_inbound_at).toISOString());
    expect((await convRow(silent.id)).metadata.unanswered_alert_for).toBeTruthy();
    expect((await msgRow(unsureRow.id)).status).toBe('received');

    // A second pass right after: every claim holds, nothing is sent twice.
    const sendsBefore = graphSends().length;
    const again = await sweeper.runSweep({ now: new Date() });
    expect(again.errors).toEqual([]);
    expect(again).toMatchObject({ sla_notes: 0, awaiting_notes: 0, window_flags: 0, unanswered_alerts: 0 });
    expect(graphSends()).toHaveLength(sendsBefore);
  });

  test('two sweeper instances at once (separate module registries, one DB): every note and flag exactly once', async () => {
    const allDay = { team_hours: { days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59', tz: 'UTC', closures: [] } };
    const biz = await shiftBusiness(allDay);
    const now = new Date();
    const ago = (m) => new Date(now.getTime() - m * MIN);
    const slaAt = ago(90).toISOString();
    const sla = await conversation(biz, {
      status: 'pending', last_inbound_at: ago(95),
      workflow_data: { needs_team: { reason: 'meeting', summary: 'm', at: slaAt, resolved_at: null, sla_note_sent_at: null, claimed_at: null, claimed_by: null } },
    });
    const waiting = await conversation(biz, { last_inbound_at: ago(15), metadata: { human_active_until: new Date(now.getTime() + 20 * MIN).toISOString() } });
    await inbound(waiting, { status: 'awaiting_staff', created_at: ago(15), text_body: 'وينكم؟' });
    const windowConv = await conversation(biz, { status: 'human_takeover', ai_enabled: false, last_inbound_at: ago(23 * 60) });
    const silent = await conversation(biz, { last_inbound_at: ago(5) });
    await inbound(silent, { status: 'skipped', created_at: ago(5) });

    let other;
    jest.isolateModules(() => {
      other = { sweeper: require('../../src/services/shiftSweeper'), batcher: require('../../src/services/replyBatcher') };
    });
    await other.batcher.shutdown(1);
    const [a, b] = await Promise.all([sweeper.runSweep({ now }), other.sweeper.runSweep({ now })]);
    expect([...a.errors, ...b.errors]).toEqual([]);
    const total = (k) => a[k] + b[k];
    expect({ sla: total('sla_notes'), awaiting: total('awaiting_notes'), window: total('window_flags'), unanswered: total('unanswered_alerts') })
      .toEqual({ sla: 1, awaiting: 1, window: 1, unanswered: 1 });
    expect(await prisma.message.count({ where: { conversation_id: sla.id, direction: 'outbound' } })).toBe(1);
    expect(await prisma.message.count({ where: { conversation_id: waiting.id, direction: 'outbound' } })).toBe(1);
    expect((await convRow(windowConv.id)).metadata.window_flag_for).toBeTruthy();
  });

  // ─── 5. Inbox PATCH lead ───────────────────────────────────────────────────

  test('PATCH /api/inbox/conversations/:id/lead: versioned lead edit and conditional «تم التواصل»', async () => {
    const biz = await shiftBusiness();
    const user = await prisma.user.create({ data: { name: 'Staff', email: 'staff@pg.test', password: 'x', role: 'staff', business_id: biz.id } });
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
    const at = new Date(Date.now() - 10 * MIN).toISOString();
    const conv = await conversation(biz, {
      status: 'pending',
      workflow_data: {
        lead: { name: 'سامر', version: 1 }, requested_time_change: { text: 'بكرا', at },
        needs_team: { reason: 'quote', at, summary: 's', resolved_at: null, sla_note_sent_at: 'S', claimed_at: null },
      },
    });
    const patch = (body) => request(app).patch(`/api/inbox/conversations/${conv.id}/lead`).set('Authorization', `Bearer ${token}`).send(body);

    let res = await patch({ lead: { city: 'إربد', preferred_time: 'الأحد 10' }, version: 1 });
    expect(res.status).toBe(200);
    let row = await convRow(conv.id);
    expect(row.workflow_data.lead).toMatchObject({ name: 'سامر', city: 'إربد', preferred_time: { text: 'الأحد 10' }, version: 2 });
    expect(row.workflow_data).not.toHaveProperty('requested_time_change');

    res = await patch({ lead: { city: 'عمان' }, version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.lead.version).toBe(2);

    // The bot recorded a newer request between the staff member's read and the click: not resolved.
    const stale = { ...row.workflow_data.needs_team };
    await jsonb.writeConversationState(conv.id, {
      status: 'pending', needsTeam: { reason: 'person', at: new Date().toISOString(), resolved_at: null, claimed_at: null },
      priorities: { person: 5, quote: 3 },
    });
    // Simulate the stale read by resolving through the helper with the old match, like the route does.
    expect(await jsonb.resolveNeedsTeam(conv.id, { match: { reason: stale.reason, at: stale.at }, resolvedAt: new Date().toISOString() })).toBe(false);
    expect((await convRow(conv.id)).status).toBe('pending');

    res = await patch({ needs_team_resolved: true });
    expect(res.status).toBe(200);
    expect(res.body.needs_team_resolved).toBe(true);
    row = await convRow(conv.id);
    expect(row.status).toBe('open');
    expect(row.workflow_data.needs_team).toMatchObject({ reason: 'person' });
    expect(row.workflow_data.needs_team.resolved_at).toBeTruthy();
  });

  test('POST /claim: takeover + pause before Graph, needs_team merged, claim ack intent attributed to staff (FK)', async () => {
    const biz = await shiftBusiness();
    const user = await prisma.user.create({ data: { name: 'رنا', email: 'rana@pg.test', password: 'x', role: 'staff', business_id: biz.id } });
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
    const conv = await conversation(biz, {
      status: 'pending', current_state: 'fit',
      workflow_data: { needs_team: { reason: 'person', at: new Date().toISOString(), resolved_at: null, claimed_at: null, sla_note_sent_at: 'S' } },
    });
    const claims = await Promise.all([1, 2].map(() => request(app).post(`/api/inbox/conversations/${conv.id}/claim`).set('Authorization', `Bearer ${token}`)));
    expect(claims.map((r) => r.status)).toEqual([200, 200]);
    expect(claims.map((r) => r.body.ack).sort()).toEqual(['sent', 'skipped']);
    const row = await convRow(conv.id);
    expect(row).toMatchObject({ status: 'human_takeover', ai_enabled: false, assigned_staff_id: user.id });
    expect(row.workflow_data.needs_team).toMatchObject({ claimed_by: user.id, sla_note_sent_at: 'S' });
    expect(row.workflow_data.stage_before_takeover).toBe('fit');
    expect(ms(row.metadata.human_active_until)).toBeGreaterThan(Date.now() + 20 * MIN);
    const acks = await prisma.message.findMany({ where: { conversation_id: conv.id, direction: 'outbound' } });
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({ status: 'sent', sent_by_user_id: user.id, is_ai_generated: false });
    expect(graphSends()).toHaveLength(1);

    // getShiftStatus reads the same rows.
    const status = await sweeper.getShiftStatus();
    expect(status).toMatchObject({ workflow_active: true, pending: 0, awaiting_staff: 0, unconfirmed: 0 });
  });
  test('new_message alerts: first message, burst suppressed, racing deliveries claim once, template fallback stored', async () => {
    const newMessageAlert = require('../../src/services/newMessageAlert');
    const OWNER = '962796381676';
    const biz = await shiftBusiness({ alert_wa_numbers: [OWNER], alert_template: { name: 'staff_alert', language: 'ar' } });
    const customer = '962791234567';
    const persist = (text) => {
      seq += 1;
      return processor.persistInbound(inboundPayload({ from: customer, text, id: `wamid.pgnm${seq}` }));
    };
    const templateSends = () => axios.post.mock.calls.filter(([url, p]) => /\/messages$/.test(url) && p && p.type === 'template' && p.to === OWNER);

    const first = await persist('مرحبا');
    expect(await newMessageAlert.notifyNewMessages(first.business, first.items)).toEqual(['alerted']);
    expect(templateSends()).toHaveLength(1);
    // The owner had no thread: it is created and holds the template copy.
    const ownerConv = await prisma.conversation.findFirst({ where: { business_id: biz.id, customer_wa_id: OWNER } });
    const stored = await prisma.message.findMany({ where: { conversation_id: ownerConv.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ direction: 'outbound', message_type: 'template', status: 'sent' });

    const burst = await persist('كم السعر؟');
    expect(await newMessageAlert.notifyNewMessages(burst.business, burst.items)).toEqual(['burst']);

    // Back-date everything 2 h: the next two deliveries both follow a long silence and race on the claim.
    await prisma.$executeRawUnsafe(`UPDATE "messages" SET "created_at" = "created_at" - interval '2 hours' WHERE "sender_wa_id" = '${customer}'`);
    const [a, b] = await Promise.all([persist('رجعت'), persist('سؤال')]);
    const outcomes = await Promise.all([
      newMessageAlert.notifyNewMessages(a.business, a.items),
      newMessageAlert.notifyNewMessages(b.business, b.items),
    ]);
    expect(outcomes.flat().filter((o) => o === 'alerted')).toHaveLength(1);
    expect(templateSends()).toHaveLength(2);
    const conv = await prisma.conversation.findFirst({ where: { business_id: biz.id, customer_wa_id: customer } });
    expect(conv.metadata.new_message_alert_after).toBeTruthy();
  });
});

