'use strict';

/**
 * jsonb helper — the only writer of conversations.workflow_data / .metadata for SHIFT.
 *
 * Why raw SQL: a Prisma `update({data:{metadata}})` rewrites the whole column, so the batcher's
 * lease, a staff send's `human_active_until` and a sweeper claim would overwrite each other.
 * Each function here is ONE autocommit statement that merges keys server-side, so concurrent
 * writers keep each other's siblings. One statement also keeps it safe behind Neon's PgBouncer
 * in transaction mode (no advisory locks, no SET, no session state). Time always comes from the
 * DB's now() so Cloud Run instances with skewed clocks agree on lease expiry.
 *
 * Identifiers are whitelisted and injected with Prisma.raw; every value is a bound parameter
 * with an explicit cast.
 */

const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');

const TABLES = ['conversations'];
const COLUMNS = ['workflow_data', 'metadata'];
const LEASE_TTL_MS = 60000;

function ident(name, allowed) {
  if (typeof name !== 'string' || !allowed.includes(name)) {
    throw new Error('jsonb: bad identifier');
  }
  return Prisma.raw(`"${name}"`);
}

function checkPath(path) {
  if (!Array.isArray(path) || path.length === 0 || !path.every((p) => typeof p === 'string' && p)) {
    throw new Error('jsonb: bad path');
  }
}

function ttl(ttlMs) {
  const n = Math.round(Number(ttlMs));
  return Number.isFinite(n) && n > 0 ? n : LEASE_TTL_MS;
}

/**
 * Top-level merge: keys in `remove` are deleted first, then each key of `patch` replaces the
 * whole top-level key. `ifVersion` (a number) guards `C.lead.version` for optimistic lead writes.
 * No retry here — saveLead owns the version retry.
 */
async function patchJson(table, id, column, patch, { ifVersion, remove = [] } = {}) {
  const T = ident(table, TABLES);
  const C = ident(column, COLUMNS);
  const removeKeys = Array.isArray(remove) ? remove.filter((k) => typeof k === 'string') : [];
  const json = JSON.stringify(patch || {});
  if (json === '{}' && removeKeys.length === 0) return { ok: true, count: 0 };

  const versionClause = Number.isInteger(ifVersion)
    ? Prisma.sql` AND COALESCE((${C} -> 'lead' ->> 'version')::int, 0) = ${ifVersion}::int`
    : Prisma.empty;

  const count = await prisma.$executeRaw(Prisma.sql`UPDATE ${T}
SET ${C} = (COALESCE(${C}, '{}'::jsonb) - ${removeKeys}::text[]) || ${json}::jsonb,
    "updated_at" = now()
WHERE "id" = ${id}${versionClause}`);
  return { ok: count === 1, count };
}

/**
 * Set a (possibly nested) key to now() only if it is null/missing. Two concurrent sweeps race on
 * the same row; Postgres row locking makes exactly one of them see count 1.
 * The parent must already be an object: jsonb_set cannot create intermediate objects, and a claim
 * on a needs_team that no longer exists must fail rather than resurrect it.
 */
async function claimFlag(table, id, column, path) {
  const T = ident(table, TABLES);
  const C = ident(column, COLUMNS);
  checkPath(path);
  const parentClause = path.length > 1
    ? Prisma.sql`
  AND jsonb_typeof(${C} #> ${path.slice(0, -1)}::text[]) = 'object'`
    : Prisma.empty;

  const count = await prisma.$executeRaw(Prisma.sql`UPDATE ${T}
SET ${C} = jsonb_set(${C}, ${path}::text[], to_jsonb(now()), true), "updated_at" = now()
WHERE "id" = ${id}
  AND (${C} #>> ${path}::text[]) IS NULL${parentClause}`);
  return count === 1;
}

/**
 * Merge `patch` into the object stored under top-level `key`, leaving its other fields alone. Only
 * when that key already holds an object, and (optionally) that object contains `match` (jsonb @>).
 * patchJson replaces a whole top-level key, so a writer holding an old copy of needs_team would wipe
 * a flag another writer set inside it meanwhile (sla_note_sent_at, resolved_at); this does not.
 * Returns true when the row was updated.
 */
async function mergeObjectKey(table, id, column, key, patch, { match } = {}) {
  const T = ident(table, TABLES);
  const C = ident(column, COLUMNS);
  checkPath([key]);
  const json = JSON.stringify(patch || {});
  if (json === '{}') return false;
  const matchClause = match
    ? Prisma.sql`
  AND (${C} -> ${key}::text) @> ${JSON.stringify(match)}::jsonb`
    : Prisma.empty;

  const count = await prisma.$executeRaw(Prisma.sql`UPDATE ${T}
SET ${C} = jsonb_set(${C}, ARRAY[${key}::text], (${C} -> ${key}::text) || ${json}::jsonb, false),
    "updated_at" = now()
WHERE "id" = ${id}
  AND jsonb_typeof(${C} -> ${key}::text) = 'object'${matchClause}`);
  return count === 1;
}

/** Set key := value only if it differs — "once per inbound id" claims for the sweeper. */
async function claimValue(table, id, column, key, value) {
  const T = ident(table, TABLES);
  const C = ident(column, COLUMNS);
  checkPath([key]);
  const v = value === null || value === undefined ? null : String(value);

  const count = await prisma.$executeRaw(Prisma.sql`UPDATE ${T}
SET ${C} = COALESCE(${C}, '{}'::jsonb) || jsonb_build_object(${key}::text, ${v}::text), "updated_at" = now()
WHERE "id" = ${id} AND (${C} ->> ${key}::text) IS DISTINCT FROM ${v}::text`);
  return count === 1;
}

/** Atomic counter (e.g. metadata.reply_failures). Returns the new value, or null if no row. */
async function incrementCounter(table, id, column, key, by = 1) {
  const T = ident(table, TABLES);
  const C = ident(column, COLUMNS);
  checkPath([key]);
  const step = Number.isInteger(by) ? by : 1;

  const rows = await prisma.$queryRaw(Prisma.sql`UPDATE ${T}
SET ${C} = jsonb_set(COALESCE(${C}, '{}'::jsonb), ARRAY[${key}::text],
                  to_jsonb(COALESCE((${C} ->> ${key}::text)::int, 0) + ${step}::int), true),
    "updated_at" = now()
WHERE "id" = ${id}
RETURNING (${C} ->> ${key}::text)::int AS n`);
  const n = Array.isArray(rows) && rows[0] ? rows[0].n : null;
  return n === null || n === undefined ? null : Number(n);
}

/**
 * Reply lease: one runBatch per conversation across instances. Free when no token, no expiry,
 * expired, or already ours (re-entry by the same run renews it).
 */
async function acquireLease(conversationId, token, ttlMs = LEASE_TTL_MS) {
  const count = await prisma.$executeRaw(Prisma.sql`UPDATE "conversations"
SET "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object(
      'lease_token', ${String(token)}::text,
      'reply_lease_until', now() + (${ttl(ttlMs)}::int * interval '1 millisecond')),
    "updated_at" = now()
WHERE "id" = ${conversationId}
  AND ( "metadata" ->> 'lease_token' IS NULL
     OR "metadata" ->> 'reply_lease_until' IS NULL
     OR ("metadata" ->> 'reply_lease_until')::timestamptz < now()
     OR "metadata" ->> 'lease_token' = ${String(token)}::text )`);
  return count === 1;
}

async function renewLease(conversationId, token, ttlMs = LEASE_TTL_MS) {
  const count = await prisma.$executeRaw(Prisma.sql`UPDATE "conversations"
SET "metadata" = "metadata" || jsonb_build_object('reply_lease_until', now() + (${ttl(ttlMs)}::int * interval '1 millisecond')),
    "updated_at" = now()
WHERE "id" = ${conversationId} AND "metadata" ->> 'lease_token' = ${String(token)}::text`);
  return count === 1;
}

async function releaseLease(conversationId, token) {
  const count = await prisma.$executeRaw(Prisma.sql`UPDATE "conversations"
SET "metadata" = "metadata" - 'lease_token' - 'reply_lease_until', "updated_at" = now()
WHERE "id" = ${conversationId} AND "metadata" ->> 'lease_token' = ${String(token)}::text`);
  return count === 1;
}

module.exports = {
  patchJson,
  mergeObjectKey,
  claimFlag,
  claimValue,
  incrementCounter,
  acquireLease,
  renewLease,
  releaseLease,
  LEASE_TTL_MS,
};
