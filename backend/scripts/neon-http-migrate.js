/**
 * Apply pending Prisma migrations to a Neon database over the SQL-over-HTTPS API.
 *
 * Useful when outbound TCP 5432 is unavailable (e.g. restricted/proxied
 * environments) so `prisma migrate deploy` cannot connect. Applies each
 * migration's DDL in a transaction and records it in `_prisma_migrations`
 * exactly like `prisma migrate deploy` would (sha256 checksum), so the two
 * methods stay interchangeable.
 *
 * Limitations: statements are split on semicolons at line ends, which is safe
 * for Prisma-generated DDL but NOT for migrations containing $$-quoted
 * function/trigger bodies — use `prisma migrate deploy` for those.
 *
 * Usage:
 *   npm install --no-save @neondatabase/serverless
 *   NEON_URL='postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require' \
 *     node scripts/neon-http-migrate.js
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_ROOT = path.join(__dirname, '..', 'prisma', 'migrations');
const url = process.env.NEON_URL;
if (!url) {
  console.error('NEON_URL is not set');
  process.exit(1);
}

const sql = neon(url);

function splitStatements(text) {
  const withoutComments = text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

(async () => {
  await sql`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) NOT NULL PRIMARY KEY,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )`;

  const applied = new Set(
    (await sql`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`)
      .map((r) => r.migration_name),
  );

  const migrationDirs = fs
    .readdirSync(MIGRATIONS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const name of migrationDirs) {
    if (applied.has(name)) {
      console.log(`= ${name} (already applied)`);
      continue;
    }
    const file = path.join(MIGRATIONS_ROOT, name, 'migration.sql');
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('$$')) {
      console.error(`✗ ${name} contains $$-quoted bodies — apply it with prisma migrate deploy instead`);
      process.exit(1);
    }
    const statements = splitStatements(content);
    console.log(`→ ${name}: applying ${statements.length} statements...`);
    await sql.transaction(statements.map((s) => sql.query(s)));

    const checksum = crypto.createHash('sha256').update(content).digest('hex');
    await sql`INSERT INTO "_prisma_migrations"
        (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
      VALUES
        (${crypto.randomUUID()}, ${checksum}, now(), ${name}, now(), ${statements.length})`;
    console.log(`✓ ${name} applied and recorded`);
  }

  const tables = await sql`SELECT table_name FROM information_schema.tables
                           WHERE table_schema = 'public' ORDER BY table_name`;
  console.log('\nTables in database:');
  tables.forEach((t) => console.log(`  - ${t.table_name}`));
})().catch((err) => {
  console.error('FAILED:', err.message || err);
  process.exit(1);
});
