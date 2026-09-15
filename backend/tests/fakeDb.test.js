require('./setup');

jest.mock('../src/config/prisma', () => require('./helpers/fakeDb').getFakeDb().prisma);
jest.mock('../src/db/jsonb', () => require('./helpers/fakeDb').getFakeDb().jsonb);

const db = require('./helpers/fakeDb').getFakeDb();
const prisma = require('../src/config/prisma');
const jsonb = require('../src/db/jsonb');

beforeEach(() => db.reset());

function seedConversation(extra = {}) {
  const { businesses: [biz] } = db.seed({ businesses: [{ business_type: 'shift' }] });
  const { conversations: [conv] } = db.seed({
    conversations: [{ business_id: biz.id, customer_wa_id: '962790000001', ...extra }],
  });
  return { biz, conv };
}

describe('fakeDb wiring', () => {
  test('the mocked modules are the singleton, and the jsonb fake mirrors the real exports', () => {
    expect(prisma).toBe(db.prisma);
    expect(jsonb).toBe(db.jsonb);
    const real = jest.requireActual('../src/db/jsonb');
    expect(Object.keys(db.jsonb).sort()).toEqual(Object.keys(real).sort());
    expect(db.jsonb.LEASE_TTL_MS).toBe(real.LEASE_TTL_MS);
  });

  test('seed fills schema defaults', () => {
    const { conv } = seedConversation();
    expect(conv).toMatchObject({ status: 'open', ai_enabled: true, workflow_data: {}, metadata: {}, unread_count: 0 });
    expect(conv.id).toEqual(expect.any(String));
    expect(conv.created_at).toBeInstanceOf(Date);
  });

  test('raw SQL outside the jsonb fake throws', () => {
    expect(() => prisma.$executeRaw`SELECT 1`).toThrow('fakeDb: raw SQL is only allowed inside db/jsonb.js');
    expect(() => prisma.$queryRaw`SELECT 1`).toThrow('fakeDb: raw SQL is only allowed inside db/jsonb.js');
  });

  test('returned rows are copies', async () => {
    const { conv } = seedConversation({ metadata: { a: 1 } });
    const row = await prisma.conversation.findUnique({ where: { id: conv.id } });
    row.metadata.a = 2;
    row.status = 'resolved';
    const again = await prisma.conversation.findUnique({ where: { id: conv.id } });
    expect(again.metadata.a).toBe(1);
    expect(again.status).toBe('open');
  });
});

describe('where / orderBy / data', () => {
  test('equality, in, not, not null, date ranges, OR, take/skip', async () => {
    const { biz, conv } = seedConversation();
    const t0 = new Date('2026-09-14T08:00:00Z');
    db.seed({
      users: [{ id: 'u1', name: 'Rana' }],
      messages: [
        { id: 'm1', business_id: biz.id, conversation_id: conv.id, direction: 'inbound', status: 'received', created_at: t0 },
        { id: 'm2', business_id: biz.id, conversation_id: conv.id, direction: 'outbound', status: 'sent', sent_by_user_id: 'u1', created_at: new Date(t0.getTime() + 1000) },
        { id: 'm3', business_id: biz.id, conversation_id: conv.id, direction: 'inbound', status: 'answered', created_at: new Date(t0.getTime() + 2000) },
      ],
    });

    const received = await prisma.message.findMany({ where: { conversation_id: conv.id, direction: 'inbound', status: 'received' } });
    expect(received.map((m) => m.id)).toEqual(['m1']);

    const inIds = await prisma.message.findMany({ where: { id: { in: ['m1', 'm3'] } }, orderBy: { created_at: 'desc' } });
    expect(inIds.map((m) => m.id)).toEqual(['m3', 'm1']);

    const staff = await prisma.message.findFirst({
      where: { conversation_id: conv.id, direction: 'outbound', sent_by_user_id: { not: null } },
      orderBy: { created_at: 'desc' },
    });
    expect(staff.id).toBe('m2');

    const notSent = await prisma.message.findMany({ where: { status: { not: 'sent' } } });
    expect(notSent.map((m) => m.id).sort()).toEqual(['m1', 'm3']);

    const after = await prisma.message.findMany({ where: { created_at: { gt: t0 } }, orderBy: { created_at: 'asc' } });
    expect(after.map((m) => m.id)).toEqual(['m2', 'm3']);
    const range = await prisma.message.count({ where: { created_at: { gte: t0.toISOString(), lt: new Date(t0.getTime() + 2000) } } });
    expect(range).toBe(2);

    const either = await prisma.message.findMany({ where: { OR: [{ id: 'm1' }, { status: 'sent' }] }, orderBy: { created_at: 'asc' } });
    expect(either.map((m) => m.id)).toEqual(['m1', 'm2']);

    const paged = await prisma.message.findMany({ orderBy: { created_at: 'asc' }, skip: 1, take: 1 });
    expect(paged.map((m) => m.id)).toEqual(['m2']);
  });

  test('include assigned_staff, increment, update stamps updated_at, unknown operators throw', async () => {
    db.clock.set('2026-09-14T08:00:00Z');
    db.seed({ users: [{ id: 'u1', name: 'Rana' }] });
    const { conv } = seedConversation({ assigned_staff_id: 'u1' });
    const withStaff = await prisma.conversation.findFirst({ where: { id: conv.id }, include: { assigned_staff: { select: { name: true } } } });
    expect(withStaff.assigned_staff).toEqual({ name: 'Rana' });

    db.clock.advance(5000);
    const updated = await prisma.conversation.update({ where: { id: conv.id }, data: { unread_count: { increment: 2 } } });
    expect(updated.unread_count).toBe(2);
    expect(updated.updated_at.toISOString()).toBe('2026-09-14T08:00:05.000Z');

    await expect(prisma.conversation.update({ where: { id: 'nope' }, data: { status: 'open' } })).rejects.toMatchObject({ code: 'P2025' });
    await expect(prisma.message.findMany({ where: { raw_payload: { path: ['batch_key'], equals: 'x' } } })).rejects.toThrow('unsupported where operator');
  });

  test('P2002 on a duplicate meta_message_id and a duplicate conversation', async () => {
    const { biz, conv } = seedConversation();
    await prisma.message.create({ data: { business_id: biz.id, conversation_id: conv.id, meta_message_id: 'wamid.1', direction: 'inbound' } });
    await expect(prisma.message.create({
      data: { business_id: biz.id, conversation_id: conv.id, meta_message_id: 'wamid.1', direction: 'inbound' },
    })).rejects.toMatchObject({ code: 'P2002' });

    // null meta_message_id is not unique-constrained
    await prisma.message.create({ data: { business_id: biz.id, conversation_id: conv.id, direction: 'outbound' } });
    await prisma.message.create({ data: { business_id: biz.id, conversation_id: conv.id, direction: 'outbound' } });
    expect(await prisma.message.count({ where: { conversation_id: conv.id } })).toBe(3);

    await expect(prisma.conversation.create({
      data: { business_id: biz.id, customer_wa_id: '962790000001' },
    })).rejects.toMatchObject({ code: 'P2002' });
  });

  test('U+0000 in text or JSON is rejected like Postgres (22021 / 22P05)', async () => {
    const { biz, conv } = seedConversation();
    const NUL = String.fromCharCode(0);
    await expect(prisma.message.create({ data: { business_id: biz.id, conversation_id: conv.id, direction: 'inbound', text_body: `a${NUL}` } }))
      .rejects.toThrow('0x00');
    await expect(prisma.message.create({ data: { business_id: biz.id, conversation_id: conv.id, direction: 'inbound', raw_payload: { t: [`${NUL}`] } } }))
      .rejects.toThrow('0x00');
    await expect(prisma.conversation.update({ where: { id: conv.id }, data: { profile_name: NUL } })).rejects.toThrow('0x00');
    await expect(prisma.conversation.updateMany({ where: { id: conv.id }, data: { profile_name: NUL } })).rejects.toThrow('0x00');
    await expect(db.jsonb.patchJson('conversations', conv.id, 'metadata', { a: NUL })).rejects.toThrow('0x00');
    expect(await prisma.message.count({ where: { conversation_id: conv.id } })).toBe(0);
  });

  test('select returns only the selected fields, like Prisma on Postgres', async () => {
    const { conv } = seedConversation();
    const row = await prisma.conversation.findUnique({ where: { id: conv.id }, select: { workflow_data: true } });
    expect(row).toEqual({ workflow_data: {} });
    const [first] = await prisma.conversation.findMany({ where: { id: conv.id }, select: { id: true, status: true } });
    expect(first).toEqual({ id: conv.id, status: 'open' });
    const full = await prisma.conversation.findFirst({ where: { id: conv.id } });
    expect(full).toHaveProperty('metadata');
  });

  test('updateMany counts only matching rows; failNext rejects once', async () => {
    const { biz, conv } = seedConversation();
    db.seed({
      messages: [
        { id: 'a', business_id: biz.id, conversation_id: conv.id, status: 'received' },
        { id: 'b', business_id: biz.id, conversation_id: conv.id, status: 'answered' },
      ],
    });
    const r = await prisma.message.updateMany({ where: { id: { in: ['a', 'b'] }, status: 'received' }, data: { status: 'answered' } });
    expect(r).toEqual({ count: 1 });

    db.failNext('message.create', Object.assign(new Error('db down'), { code: 'P1001' }));
    await expect(prisma.message.create({ data: { conversation_id: conv.id } })).rejects.toMatchObject({ code: 'P1001' });
    await expect(prisma.message.create({ data: { conversation_id: conv.id } })).resolves.toMatchObject({ conversation_id: conv.id });
  });

  test('$transaction with an array resolves in order', async () => {
    const { conv } = seedConversation();
    const [a, b] = await prisma.$transaction([
      prisma.conversation.update({ where: { id: conv.id }, data: { status: 'pending' } }),
      prisma.conversation.count({ where: { status: 'pending' } }),
    ]);
    expect(a.status).toBe('pending');
    expect(b).toBe(1);
  });

  test('interactive $transaction: a throwing callback undoes its creates and updates; a commit keeps them', async () => {
    const { biz, conv } = seedConversation();
    db.failNext('conversation.update', new Error('counter write failed'));
    await expect(prisma.$transaction(async (tx) => {
      await tx.message.create({ data: { id: 'm1', business_id: biz.id, conversation_id: conv.id, meta_message_id: 'wamid.t' } });
      await tx.conversation.updateMany({ where: { id: conv.id }, data: { unread_count: { increment: 1 } } });
      await tx.conversation.update({ where: { id: conv.id }, data: { unread_count: { increment: 1 } } });
    })).rejects.toThrow('counter write failed');
    expect(db.store.messages).toHaveLength(0);
    expect(db.store.conversations[0].unread_count).toBe(0);

    await prisma.$transaction(async (tx) => {
      await tx.message.create({ data: { id: 'm2', business_id: biz.id, conversation_id: conv.id, meta_message_id: 'wamid.t' } });
      await tx.conversation.update({ where: { id: conv.id }, data: { unread_count: { increment: 1 } } });
    });
    expect(db.store.messages.map((m) => m.id)).toEqual(['m2']);
    expect(db.store.conversations[0].unread_count).toBe(1);
  });
});

describe('jsonb fake: writeConversationState and the preSendCheck claim', () => {
  const PRIO = { unsent_reply: 6, person: 5, meeting: 4, quote: 3, unknown: 1 };
  const entry = (reason, at, extra = {}) => ({ reason, at, summary: reason, resolved_at: null, claimed_at: null, ...extra });
  const write = (id, needsTeam, extra = {}) => jsonb.writeConversationState(id, {
    status: 'pending', patch: { bot_turns: 1 }, needsTeam, priorities: PRIO, defaultPriority: 1, ...extra,
  });

  test('needs_team is merged against the stored entry: missing, resolved, claimed or lower priority → replaced', async () => {
    const { conv } = seedConversation();
    expect(await write(conv.id, entry('quote', 't1'))).toEqual({ ok: true, needsTeam: { reason: 'quote', at: 't1' } });
    // Equal priority, still open: kept.
    expect((await write(conv.id, entry('quote', 't2'))).needsTeam).toEqual({ reason: 'quote', at: 't1' });
    // Higher priority: replaced.
    expect((await write(conv.id, entry('person', 't3'))).needsTeam).toEqual({ reason: 'person', at: 't3' });
    db.store.conversations[0].workflow_data.needs_team.resolved_at = 'done';
    expect((await write(conv.id, entry('quote', 't4'))).needsTeam).toEqual({ reason: 'quote', at: 't4' });
    db.store.conversations[0].workflow_data.needs_team.claimed_at = 'staff';
    expect((await write(conv.id, entry('quote', 't5'), { currentState: 'captured' })).needsTeam).toEqual({ reason: 'quote', at: 't5' });
    expect(db.store.conversations[0]).toMatchObject({ status: 'pending', current_state: 'captured', workflow_data: { bot_turns: 1 } });
  });

  test('a human_takeover conversation is not written at all', async () => {
    const { conv } = seedConversation({ status: 'human_takeover', workflow_data: { needs_team: entry('quote', 't1') } });
    expect(await write(conv.id, entry('person', 't2'))).toEqual({ ok: false, needsTeam: null });
    expect(db.store.conversations[0]).toMatchObject({ status: 'human_takeover', workflow_data: { needs_team: { reason: 'quote' } } });
  });

  test('preSendCheck claim: every path must hold the value (numbers compare as text; missing never matches)', async () => {
    const { conv } = seedConversation({ workflow_data: { needs_team: { at: 't1', sla_note_attempt: 2 } }, metadata: { awaiting_note_for: 'm1#1' } });
    const claim = (c) => jsonb.preSendCheck(conv.id, { humanGuard: false, claim: c });
    expect(await claim([{ column: 'workflow_data', path: ['needs_team', 'at'], value: 't1' }, { column: 'workflow_data', path: ['needs_team', 'sla_note_attempt'], value: 2 }])).toBe(true);
    expect(await claim([{ column: 'workflow_data', path: ['needs_team', 'sla_note_attempt'], value: 1 }])).toBe(false);
    expect(await claim([{ column: 'metadata', path: ['awaiting_note_for'], value: 'm1#1' }])).toBe(true);
    expect(await claim([{ column: 'metadata', path: ['missing'], value: 'null' }])).toBe(false);
    await expect(claim([{ column: 'status', path: ['x'], value: 1 }])).rejects.toThrow('jsonb: bad identifier');
  });
});

describe('jsonb fake', () => {
  test('interleaved writers keep each other\'s siblings', async () => {
    const { conv } = seedConversation({ workflow_data: { needs_team: { reason: 'quote', resolved_at: null } } });

    // batcher lease, staff send, sweeper claim, staff lead edit — all on one conversation
    expect(await jsonb.acquireLease(conv.id, 'run-1')).toBe(true);
    await jsonb.patchJson('conversations', conv.id, 'metadata', { human_active_until: '2026-09-14T09:00:00.000Z' });
    expect(await jsonb.claimValue('conversations', conv.id, 'metadata', 'awaiting_note_for', 'm7')).toBe(true);
    const lead = await jsonb.patchJson('conversations', conv.id, 'workflow_data', { lead: { name: 'محمد', version: 1 } }, { ifVersion: 0 });
    expect(lead.ok).toBe(true);

    const row = await prisma.conversation.findUnique({ where: { id: conv.id } });
    expect(row.metadata).toMatchObject({
      lease_token: 'run-1',
      reply_lease_until: expect.any(String),
      human_active_until: '2026-09-14T09:00:00.000Z',
      awaiting_note_for: 'm7',
    });
    expect(row.workflow_data).toEqual({
      needs_team: { reason: 'quote', resolved_at: null },
      lead: { name: 'محمد', version: 1 },
    });
  });

  test('patchJson remove deletes keys first; empty patch is a no-op', async () => {
    const { conv } = seedConversation({ workflow_data: { capture_pending: { slot_id: 'other' }, bot_turns: 2 } });
    await jsonb.patchJson('conversations', conv.id, 'workflow_data', { bot_turns: 3 }, { remove: ['capture_pending'] });
    expect(db.store.conversations[0].workflow_data).toEqual({ bot_turns: 3 });
    expect(await jsonb.patchJson('conversations', conv.id, 'workflow_data', {})).toEqual({ ok: true, count: 0 });
    await expect(jsonb.patchJson('conversations', conv.id, 'status', { a: 1 })).rejects.toThrow('jsonb: bad identifier');
  });

  test('lease: another token waits until expiry (clock.advance 61 s)', async () => {
    db.clock.set('2026-09-14T08:00:00Z');
    const { conv } = seedConversation();
    expect(await jsonb.acquireLease(conv.id, 'A')).toBe(true);
    expect(await jsonb.acquireLease(conv.id, 'B')).toBe(false);
    expect(await jsonb.acquireLease(conv.id, 'A')).toBe(true); // re-entry by the holder
    expect(await jsonb.renewLease(conv.id, 'B')).toBe(false);
    expect(await jsonb.releaseLease(conv.id, 'B')).toBe(false);

    db.clock.advance(61000);
    // GPT-6 #2: an expired lease is not renewed even while nobody has taken it yet.
    expect(await jsonb.renewLease(conv.id, 'A')).toBe(false);
    expect(await jsonb.acquireLease(conv.id, 'B')).toBe(true);
    expect(await jsonb.renewLease(conv.id, 'A')).toBe(false);
    expect(await jsonb.releaseLease(conv.id, 'B')).toBe(true);
    expect(db.store.conversations[0].metadata).toEqual({});
    expect(await jsonb.acquireLease(conv.id, 'A')).toBe(true);
  });

  test('preSendCheck: live lease and no human state → true (and renews); any failed predicate → false', async () => {
    db.clock.set('2026-09-14T08:00:00Z');
    const { conv } = seedConversation();
    await jsonb.acquireLease(conv.id, 'A');
    expect(await jsonb.preSendCheck(conv.id, { leaseToken: 'A' })).toBe(true);
    expect(db.store.conversations[0].metadata.reply_lease_until).toBe('2026-09-14T08:01:00.000Z');
    expect(await jsonb.preSendCheck(conv.id, { leaseToken: 'B' })).toBe(false);

    db.store.conversations[0].metadata.human_active_until = '2026-09-14T08:10:00.000Z';
    expect(await jsonb.preSendCheck(conv.id, { leaseToken: 'A' })).toBe(false);
    expect(await jsonb.preSendCheck(conv.id, { leaseToken: 'A', humanGuard: false })).toBe(true);
    db.store.conversations[0].metadata.human_active_until = '2026-09-14T07:59:00.000Z';
    db.store.conversations[0].status = 'human_takeover';
    expect(await jsonb.preSendCheck(conv.id, {})).toBe(false);
    db.store.conversations[0].status = 'open';
    db.store.conversations[0].ai_enabled = false;
    expect(await jsonb.preSendCheck(conv.id, {})).toBe(false);
    db.store.conversations[0].ai_enabled = true;

    db.store.conversations[0].workflow_data.marketing_opted_out_at = '2026-09-14T07:30:00.000Z';
    expect(await jsonb.preSendCheck(conv.id, { optedOutSince: '2026-09-14T07:00:00.000Z' })).toBe(false);
    expect(await jsonb.preSendCheck(conv.id, { optedOutSince: '2026-09-14T07:45:00.000Z' })).toBe(true);

    db.clock.advance(61000);
    expect(await jsonb.preSendCheck(conv.id, { leaseToken: 'A' })).toBe(false);
  });

  test('touchBatchDue: quiet window from now, capped from the first fragment of the burst', async () => {
    db.clock.set('2026-09-14T08:00:00Z');
    const { conv } = seedConversation();
    expect(await jsonb.touchBatchDue(conv.id, 4000, 10000)).toEqual({ dueAt: new Date('2026-09-14T08:00:04Z'), delayMs: 4000 });
    db.clock.advance(3000);
    expect((await jsonb.touchBatchDue(conv.id, 4000, 10000)).delayMs).toBe(4000);
    db.clock.advance(3000);
    expect((await jsonb.touchBatchDue(conv.id, 4000, 10000)).delayMs).toBe(4000);
    db.clock.advance(3000); // t = 9 s: the cap (first fragment + 10 s) wins over a fresh 4 s window
    expect(await jsonb.touchBatchDue(conv.id, 4000, 10000)).toEqual({ dueAt: new Date('2026-09-14T08:00:10Z'), delayMs: 1000 });
    db.clock.advance(5000); // the burst is over; the next fragment starts a new one
    expect((await jsonb.touchBatchDue(conv.id, 1500, 10000)).dueAt).toEqual(new Date('2026-09-14T08:00:15.500Z'));
    expect(await jsonb.touchBatchDue('missing', 4000, 10000)).toBeNull();
  });

  test('two claimFlag calls → exactly one true; missing parent → false', async () => {
    const { conv } = seedConversation({ workflow_data: { needs_team: { reason: 'person', sla_note_sent_at: null } } });
    const results = await Promise.all([
      jsonb.claimFlag('conversations', conv.id, 'workflow_data', ['needs_team', 'sla_note_sent_at']),
      jsonb.claimFlag('conversations', conv.id, 'workflow_data', ['needs_team', 'sla_note_sent_at']),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(new Date(db.store.conversations[0].workflow_data.needs_team.sla_note_sent_at).getTime()).not.toBeNaN();

    expect(await jsonb.claimFlag('conversations', conv.id, 'workflow_data', ['handoff', 'requested_at'])).toBe(false);
    expect(db.store.conversations[0].workflow_data.handoff).toBeUndefined();
  });

  test('mergeObjectKey merges into the stored object only, and only when it matches', async () => {
    const { conv } = seedConversation({
      workflow_data: { needs_team: { reason: 'meeting', at: 't1', summary: 'old', resolved_at: null }, bot_turns: 2 },
    });
    // A claim written by another actor after the caller read the object.
    await jsonb.claimFlag('conversations', conv.id, 'workflow_data', ['needs_team', 'sla_note_sent_at']);

    expect(await jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'needs_team', { summary: 'new' },
      { match: { reason: 'meeting', at: 't1', resolved_at: null } })).toBe(true);
    const wd = db.store.conversations[0].workflow_data;
    expect(wd.needs_team).toMatchObject({ summary: 'new', at: 't1', sla_note_sent_at: expect.any(String) });
    expect(wd.bot_turns).toBe(2);

    expect(await jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'needs_team', { summary: 'x' }, { match: { at: 't2' } })).toBe(false);
    expect(await jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'needs_team', { summary: 'x' }, { match: { claimed_at: null } })).toBe(false);
    expect(await jsonb.mergeObjectKey('conversations', conv.id, 'workflow_data', 'handoff', { tier: 1 })).toBe(false);
    expect(db.store.conversations[0].workflow_data.needs_team.summary).toBe('new');
    expect(db.store.conversations[0].workflow_data.handoff).toBeUndefined();
  });

  test('claimValue once per value; incrementCounter', async () => {
    const { conv } = seedConversation();
    expect(await jsonb.claimValue('conversations', conv.id, 'metadata', 'unanswered_alert_for', 'm1')).toBe(true);
    expect(await jsonb.claimValue('conversations', conv.id, 'metadata', 'unanswered_alert_for', 'm1')).toBe(false);
    expect(await jsonb.claimValue('conversations', conv.id, 'metadata', 'unanswered_alert_for', 'm2')).toBe(true);

    expect(await jsonb.incrementCounter('conversations', conv.id, 'metadata', 'reply_failures')).toBe(1);
    expect(await jsonb.incrementCounter('conversations', conv.id, 'metadata', 'reply_failures', 2)).toBe(3);
    expect(await jsonb.incrementCounter('conversations', 'missing', 'metadata', 'reply_failures')).toBeNull();
  });

  test('ifVersion mismatch writes nothing', async () => {
    const { conv } = seedConversation({ workflow_data: { lead: { name: 'سارة', version: 2 } } });
    const r = await jsonb.patchJson('conversations', conv.id, 'workflow_data', { lead: { name: 'x', version: 2 } }, { ifVersion: 1 });
    expect(r).toEqual({ ok: false, count: 0 });
    expect(db.store.conversations[0].workflow_data.lead).toEqual({ name: 'سارة', version: 2 });
  });

  test('reset empties the store in place and restores the real clock', () => {
    const store = db.store;
    seedConversation();
    db.clock.set('2020-01-01T00:00:00Z');
    db.reset();
    expect(store.conversations).toHaveLength(0);
    expect(Math.abs(db.clock.now().getTime() - Date.now())).toBeLessThan(1000);
  });
});
