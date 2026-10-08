/**
 * Migration 20261008090000_panels_foundation: what the P0 review (2026-10-08) found in it.
 *
 * No Postgres here (the fake DB cannot run SQL), so these read the migration and the post-deploy
 * script as text. They fail if a later edit drops one of the three properties below.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(ROOT, 'prisma/migrations/20261008090000_panels_foundation/migration.sql'), 'utf8');
const rerun = fs.readFileSync(path.join(ROOT, 'scripts/backfill-last-outbound.sql'), 'utf8');
const sqlOnly = (text) => text.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ');

describe('the old ai_config.enabled checkbox cannot silence a bot on deploy', () => {
  test('a leftover enabled:false is dropped, and only that key', () => {
    expect(sqlOnly(migration)).toContain(
      `UPDATE "businesses" SET "ai_config" = "ai_config" - 'enabled' WHERE "ai_config"->>'enabled' = 'false';`,
    );
  });
});

describe('the last_outbound_at backfill', () => {
  const MONOTONIC = `AND (c."last_outbound_at" IS NULL OR c."last_outbound_at" < m."last_out");`;

  test('only moves the column forward, so a re-run picks up replies saved in between', () => {
    expect(sqlOnly(migration)).toContain(MONOTONIC);
    expect(sqlOnly(migration)).not.toMatch(/AND c\."last_outbound_at" IS NULL;/);
  });

  test('the post-deploy script is the same statement', () => {
    const update = (text) => sqlOnly(text).match(/UPDATE "conversations" AS c[^;]*;/)[0];
    expect(update(rerun)).toBe(update(migration));
    expect(sqlOnly(rerun)).toContain(MONOTONIC);
  });
});

test('the header says when a code rollback is unsafe', () => {
  expect(migration).toMatch(/Rolling the CODE back/);
  expect(migration).toMatch(/wa_phone_number_id NULL/);
});
