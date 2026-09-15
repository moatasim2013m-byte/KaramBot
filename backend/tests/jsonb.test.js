require('./setup');

jest.mock('../src/config/prisma', () => ({
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn(),
}));

const prisma = require('../src/config/prisma');
const jsonb = require('../src/db/jsonb');

// The Prisma.Sql object handed to the raw call: text with `?` where each bound value sits.
function lastSql(spy) {
  const sql = spy.mock.calls[spy.mock.calls.length - 1][0];
  return { text: sql.strings.join('?'), values: sql.values };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$executeRaw.mockResolvedValue(1);
  prisma.$queryRaw.mockResolvedValue([{ n: 1 }]);
});

describe('patchJson', () => {
  test('merges with || after removing keys, patch JSON bound as a value', async () => {
    const patch = { lead: { name: "Robert'); DROP TABLE conversations;--" } };
    const r = await jsonb.patchJson('conversations', 'c1', 'workflow_data', patch, { remove: ['capture_pending'] });

    expect(r).toEqual({ ok: true, count: 1 });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const { text, values } = lastSql(prisma.$executeRaw);
    expect(text).toContain('UPDATE "conversations"');
    expect(text).toContain('SET "workflow_data" = (COALESCE("workflow_data", \'{}\'::jsonb) - ?::text[]) || ?::jsonb');
    expect(text).toContain('"updated_at" = now()');
    expect(text).toContain('WHERE "id" = ?');
    expect(text).not.toContain('DROP TABLE');
    expect(text).not.toContain('version');
    expect(values).toEqual([['capture_pending'], JSON.stringify(patch), 'c1']);
  });

  test('ifVersion adds the version predicate; count 0 → ok false', async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    const r = await jsonb.patchJson('conversations', 'c1', 'workflow_data', { lead: { version: 3 } }, { ifVersion: 2 });

    expect(r).toEqual({ ok: false, count: 0 });
    const { text, values } = lastSql(prisma.$executeRaw);
    expect(text).toContain('AND COALESCE(("workflow_data" -> \'lead\' ->> \'version\')::int, 0) = ?::int');
    expect(values[values.length - 1]).toBe(2);
  });

  test('ifVersion 0 still guards (a first lead write)', async () => {
    await jsonb.patchJson('conversations', 'c1', 'workflow_data', { lead: { version: 1 } }, { ifVersion: 0 });
    expect(lastSql(prisma.$executeRaw).text).toContain("->> 'version')::int, 0) = ?::int");
  });

  test('empty patch and no removals → no SQL', async () => {
    const r = await jsonb.patchJson('conversations', 'c1', 'metadata', {});
    expect(r).toEqual({ ok: true, count: 0 });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  test('bad column or table throws before any SQL', async () => {
    await expect(jsonb.patchJson('conversations', 'c1', 'status', { a: 1 })).rejects.toThrow('jsonb: bad identifier');
    await expect(jsonb.patchJson('messages', 'c1', 'metadata', { a: 1 })).rejects.toThrow('jsonb: bad identifier');
    await expect(jsonb.claimFlag('conversations', 'c1', 'metadata"; --', ['x'])).rejects.toThrow('jsonb: bad identifier');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('leases', () => {
  test('acquireLease uses DB now() and binds the token; count 0 → false', async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    const ok = await jsonb.acquireLease('c1', 'tok-1', 45000);

    expect(ok).toBe(false);
    const { text, values } = lastSql(prisma.$executeRaw);
    expect(text).toContain("now() + (?::int * interval '1 millisecond')");
    expect(text).toContain("(\"metadata\" ->> 'reply_lease_until')::timestamptz < now()");
    expect(text).toContain("\"metadata\" ->> 'lease_token' = ?::text");
    expect(values).toEqual(['tok-1', 45000, 'c1', 'tok-1']);
  });

  test('acquireLease count 1 → true, default TTL 60 s', async () => {
    expect(await jsonb.acquireLease('c1', 'tok-1')).toBe(true);
    expect(lastSql(prisma.$executeRaw).values).toContain(jsonb.LEASE_TTL_MS);
    expect(jsonb.LEASE_TTL_MS).toBe(60000);
  });

  test('renewLease requires the token', async () => {
    expect(await jsonb.renewLease('c1', 'tok-1')).toBe(true);
    const { text, values } = lastSql(prisma.$executeRaw);
    expect(text).toContain("WHERE \"id\" = ? AND \"metadata\" ->> 'lease_token' = ?::text");
    expect(values).toEqual([60000, 'c1', 'tok-1']);

    prisma.$executeRaw.mockResolvedValue(0);
    expect(await jsonb.renewLease('c1', 'other')).toBe(false);
  });

  test('GPT-6 #2: renewLease only renews a lease that has not expired yet (D20)', async () => {
    // An expired token nobody replaced yet must not come back to life: another worker may already be
    // past acquireLease's "expired" branch.
    await jsonb.renewLease('c1', 'tok-1');
    expect(lastSql(prisma.$executeRaw).text).toContain("(\"metadata\" ->> 'reply_lease_until')::timestamptz > now()");
  });

  test('releaseLease requires the token and removes both keys', async () => {
    expect(await jsonb.releaseLease('c1', 'tok-1')).toBe(true);
    const { text, values } = lastSql(prisma.$executeRaw);
    expect(text).toContain("\"metadata\" - 'lease_token' - 'reply_lease_until'");
    expect(text).toContain("\"metadata\" ->> 'lease_token' = ?::text");
    expect(values).toEqual(['c1', 'tok-1']);
  });
});

describe('preSendCheck (D20)', () => {
  test('GPT-6 #2: one statement fences the lease and the human state right before a Graph call', async () => {
    const ok = await jsonb.preSendCheck('c1', { leaseToken: 'tok-1', humanGuard: true, optedOutSince: '2026-09-14T08:00:00.000Z' });

    expect(ok).toBe(true);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const { text, values } = lastSql(prisma.$executeRaw);
    expect(text).toContain('UPDATE "conversations"');
    expect(text).toContain("\"metadata\" ->> 'lease_token' = ?::text");
    expect(text).toContain("(\"metadata\" ->> 'reply_lease_until')::timestamptz > now()");
    expect(text).toContain('"status" <> \'human_takeover\'');
    expect(text).toContain('"ai_enabled" = true');
    expect(text).toContain("(\"metadata\" ->> 'human_active_until')::timestamptz <= now()");
    expect(text).toContain("(\"workflow_data\" ->> 'marketing_opted_out_at')::timestamptz <= ?::timestamptz");
    expect(values).toEqual(expect.arrayContaining(['c1', 'tok-1', '2026-09-14T08:00:00.000Z']));

    prisma.$executeRaw.mockResolvedValue(0);
    expect(await jsonb.preSendCheck('c1', { leaseToken: 'tok-1' })).toBe(false);
  });

  test('without a lease or a human guard only the requested predicates are added', async () => {
    await jsonb.preSendCheck('c1', { humanGuard: false });
    const { text } = lastSql(prisma.$executeRaw);
    expect(text).not.toContain('lease_token');
    expect(text).not.toContain('human_takeover');
    expect(text).not.toContain('marketing_opted_out_at');
  });
});

describe('preSendCheck claim fence', () => {
  test('each claim adds a bound `#>> path = value::text` predicate; bad columns throw before SQL', async () => {
    await jsonb.preSendCheck('c1', {
      humanGuard: false,
      claim: [
        { column: 'workflow_data', path: ['needs_team', 'at'], value: '2026-09-14T08:00:00.000Z' },
        { column: 'workflow_data', path: ['needs_team', 'sla_note_attempt'], value: 2 },
      ],
    });
    const { text, values } = lastSql(prisma.$executeRaw);
    expect(text.match(/\("workflow_data" #>> \?::text\[\]\) = \?::text/g)).toHaveLength(2);
    expect(values).toEqual(expect.arrayContaining([['needs_team', 'at'], '2026-09-14T08:00:00.000Z', ['needs_team', 'sla_note_attempt'], '2']));

    prisma.$executeRaw.mockClear();
    await expect(jsonb.preSendCheck('c1', { claim: [{ column: 'status', path: ['x'], value: 1 }] })).rejects.toThrow('jsonb: bad identifier');
    await expect(jsonb.preSendCheck('c1', { claim: [{ column: 'metadata', path: [], value: 1 }] })).rejects.toThrow('jsonb: bad path');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('writeConversationState (D27)', () => {
  test('GPT-6 #13: status, current_state, workflow_data and the team request in one statement, never over a claim', async () => {
    prisma.$queryRaw.mockResolvedValue([{ needs_team_reason: 'person', needs_team_at: '2026-09-15T08:00:00.000Z' }]);
    const entry = { reason: 'person', at: '2026-09-15T08:00:00.000Z', resolved_at: null };
    const r = await jsonb.writeConversationState('c1', {
      status: 'pending', currentState: 'handoff', patch: { bot_turns: 2 }, needsTeam: entry, priorities: { person: 5, quote: 3 }, defaultPriority: 1,
    });

    expect(r).toEqual({ ok: true, needsTeam: { reason: 'person', at: '2026-09-15T08:00:00.000Z' } });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const { text, values } = lastSql(prisma.$queryRaw);
    expect(text).toContain('UPDATE "conversations"');
    expect(text).toContain("jsonb_typeof(\"workflow_data\" -> 'needs_team') IS DISTINCT FROM 'object'");
    expect(text).toContain("(\"workflow_data\" #>> '{needs_team,resolved_at}') IS NOT NULL");
    expect(text).toContain("(\"workflow_data\" #>> '{needs_team,claimed_at}') IS NOT NULL");
    expect(text).toContain("jsonb_build_object('needs_team', ?::jsonb)");
    expect(text).toContain('"current_state" = ?::text');
    expect(text).toContain('"status" = ?::text');
    expect(text).toContain('WHERE "id" = ? AND "status" <> \'human_takeover\'');
    expect(text).toContain('RETURNING');
    expect(values).toEqual(expect.arrayContaining([JSON.stringify(entry), JSON.stringify({ bot_turns: 2 }), 'pending', 'handoff', 'c1', 5, 1]));
  });

  test('no row (claimed) → ok false; currentState undefined leaves current_state alone', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    const r = await jsonb.writeConversationState('c1', { status: 'pending', patch: {} });
    expect(r).toEqual({ ok: false, needsTeam: null });
    expect(lastSql(prisma.$queryRaw).text).not.toContain('current_state');
    await expect(jsonb.writeConversationState('c1', {})).rejects.toThrow('needs a status');
  });
});

describe('touchBatchDue (D25)', () => {
  test('GPT-6 #9: stores the burst deadline with DB now(), capped from the first fragment, and returns the delay', async () => {
    prisma.$queryRaw.mockResolvedValue([{ due_at: '2026-09-14T08:00:04+00:00', delay_ms: 4000 }]);
    const r = await jsonb.touchBatchDue('c1', 4000, 10000);

    expect(r).toEqual({ dueAt: new Date('2026-09-14T08:00:04+00:00'), delayMs: 4000 });
    const { text, values } = lastSql(prisma.$queryRaw);
    expect(text).toContain("'batch_due_at'");
    expect(text).toContain("'batch_first_at'");
    expect(text).toContain('LEAST(now() + (?::int * interval \'1 millisecond\')');
    expect(text).toContain('RETURNING');
    expect(values).toEqual(expect.arrayContaining([4000, 10000, 'c1']));

    prisma.$queryRaw.mockResolvedValue([]);
    expect(await jsonb.touchBatchDue('missing', 4000, 10000)).toBeNull();
  });
});

describe('mergeObjectKey', () => {
  test('merges into the object under the key with jsonb_set, guarded by type and an optional @> match', async () => {
    prisma.$executeRaw.mockResolvedValue(1);
    const ok = await jsonb.mergeObjectKey('conversations', 'c1', 'workflow_data', 'needs_team', { summary: 'الساعة 5' },
      { match: { reason: 'meeting', at: 't1' } });

    expect(ok).toBe(true);
    const { text, values } = lastSql(prisma.$executeRaw);
    expect(text).toContain('SET "workflow_data" = jsonb_set("workflow_data", ARRAY[?::text], ("workflow_data" -> ?::text) || ?::jsonb, false)');
    expect(text).toContain("jsonb_typeof(\"workflow_data\" -> ?::text) = 'object'");
    expect(text).toContain('("workflow_data" -> ?::text) @> ?::jsonb');
    expect(values).toEqual(['needs_team', 'needs_team', JSON.stringify({ summary: 'الساعة 5' }), 'c1', 'needs_team', 'needs_team',
      JSON.stringify({ reason: 'meeting', at: 't1' })]);
  });

  test('no match clause without match; count 0 → false; empty patch → no SQL; bad identifiers throw', async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    expect(await jsonb.mergeObjectKey('conversations', 'c1', 'workflow_data', 'needs_team', { resolved_at: 'x' })).toBe(false);
    expect(lastSql(prisma.$executeRaw).text).not.toContain('@>');

    prisma.$executeRaw.mockClear();
    expect(await jsonb.mergeObjectKey('conversations', 'c1', 'workflow_data', 'needs_team', {})).toBe(false);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    await expect(jsonb.mergeObjectKey('users', 'c1', 'workflow_data', 'needs_team', { a: 1 })).rejects.toThrow('jsonb: bad identifier');
  });
});

describe('claims and counters', () => {
  test('claimFlag on a nested path adds the parent-object predicate', async () => {
    const ok = await jsonb.claimFlag('conversations', 'c1', 'workflow_data', ['needs_team', 'sla_note_sent_at']);

    expect(ok).toBe(true);
    const { text, values } = lastSql(prisma.$executeRaw);
    expect(text).toContain('jsonb_set("workflow_data", ?::text[], to_jsonb(now()), true)');
    expect(text).toContain('("workflow_data" #>> ?::text[]) IS NULL');
    expect(text).toContain('jsonb_typeof("workflow_data" #> ?::text[]) = \'object\'');
    expect(values).toEqual([['needs_team', 'sla_note_sent_at'], 'c1', ['needs_team', 'sla_note_sent_at'], ['needs_team']]);
  });

  test('claimFlag on a top-level key has no parent predicate; count 0 → false', async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    expect(await jsonb.claimFlag('conversations', 'c1', 'workflow_data', ['disclosed_at'])).toBe(false);
    expect(lastSql(prisma.$executeRaw).text).not.toContain('jsonb_typeof');
  });

  test('claimValue sets only when the value differs', async () => {
    expect(await jsonb.claimValue('conversations', 'c1', 'metadata', 'awaiting_note_for', 'm9')).toBe(true);
    const { text, values } = lastSql(prisma.$executeRaw);
    expect(text).toContain('jsonb_build_object(?::text, ?::text)');
    expect(text).toContain('IS DISTINCT FROM ?::text');
    expect(values).toEqual(['awaiting_note_for', 'm9', 'c1', 'awaiting_note_for', 'm9']);
  });

  test('incrementCounter uses $queryRaw and returns n', async () => {
    prisma.$queryRaw.mockResolvedValue([{ n: 3 }]);
    const n = await jsonb.incrementCounter('conversations', 'c1', 'metadata', 'reply_failures');

    expect(n).toBe(3);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    const { text, values } = lastSql(prisma.$queryRaw);
    expect(text).toContain('RETURNING ("metadata" ->> ?::text)::int AS n');
    expect(values).toContain(1);

    prisma.$queryRaw.mockResolvedValue([]);
    expect(await jsonb.incrementCounter('conversations', 'missing', 'metadata', 'reply_failures')).toBeNull();
  });
});
