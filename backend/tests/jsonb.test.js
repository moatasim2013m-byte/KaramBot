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

  test('releaseLease requires the token and removes both keys', async () => {
    expect(await jsonb.releaseLease('c1', 'tok-1')).toBe(true);
    const { text, values } = lastSql(prisma.$executeRaw);
    expect(text).toContain("\"metadata\" - 'lease_token' - 'reply_lease_until'");
    expect(text).toContain("\"metadata\" ->> 'lease_token' = ?::text");
    expect(values).toEqual(['c1', 'tok-1']);
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
