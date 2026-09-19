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
// "updated_at" is Prisma's `timestamp(3)` WITHOUT time zone, holding UTC. `now()` is timestamptz, and assigning
// it converts with the session TimeZone: on a database/role whose TimeZone is not UTC, `= now()` stored local
// wall time (Asia/Amman: 3 h in the future). Found by tests/integration/pg.test.js; UTC wall time is stored instead.
const UPDATED_AT = Prisma.raw(`"updated_at" = timezone('UTC', now())`);

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
    ${UPDATED_AT}
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
SET ${C} = jsonb_set(${C}, ${path}::text[], to_jsonb(now()), true), ${UPDATED_AT}
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
    ${UPDATED_AT}
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
SET ${C} = COALESCE(${C}, '{}'::jsonb) || jsonb_build_object(${key}::text, ${v}::text), ${UPDATED_AT}
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
    ${UPDATED_AT}
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
    ${UPDATED_AT}
WHERE "id" = ${conversationId}
  AND ( "metadata" ->> 'lease_token' IS NULL
     OR "metadata" ->> 'reply_lease_until' IS NULL
     OR ("metadata" ->> 'reply_lease_until')::timestamptz < now()
     OR "metadata" ->> 'lease_token' = ${String(token)}::text )`);
  return count === 1;
}

/**
 * D20 / GPT-6 #2: only a lease that is still ours AND unexpired is renewed. An expired token that
 * nobody replaced yet must not come back to life: another instance may already have read the lease
 * as free, and a stalled worker renewing it would then send next to that instance's run.
 */
async function renewLease(conversationId, token, ttlMs = LEASE_TTL_MS) {
  const count = await prisma.$executeRaw(Prisma.sql`UPDATE "conversations"
SET "metadata" = "metadata" || jsonb_build_object('reply_lease_until', now() + (${ttl(ttlMs)}::int * interval '1 millisecond')),
    ${UPDATED_AT}
WHERE "id" = ${conversationId} AND "metadata" ->> 'lease_token' = ${String(token)}::text
  AND ("metadata" ->> 'reply_lease_until')::timestamptz > now()`);
  return count === 1;
}

/**
 * D20 pre-send fence: ONE conditional statement run right before every Graph call, so nothing a
 * staff member or another worker commits before it can be talked over by a stale bot send.
 * - `leaseToken`: the caller still owns an unexpired lease (the lease is renewed in the same row lock).
 * - `humanGuard`: not claimed / human_takeover, AI on, no staff pause (`human_active_until`) running.
 * - `optedOutSince`: the customer has not opted out after this instant (a sales reply generated before
 *   «إيقاف» must not follow it).
 * - `claim`: [{column, path, value}] — each jsonb path still holds this value as text. A sweeper note is
 *   fenced on its claim: a sweep that stalled past NOTE_CLAIM_TTL_MS and was taken over must not send
 *   the note the taking-over sweep already sent.
 * Returns true when the row matched (safe to send), false otherwise. Never sends anything itself.
 */
async function preSendCheck(conversationId, {
  leaseToken = null, ttlMs = LEASE_TTL_MS, humanGuard = true, optedOutSince = null, claim = null,
} = {}) {
  const hasLease = leaseToken !== null && leaseToken !== undefined && leaseToken !== '';
  // Without a lease there is nothing to renew: a no-op SET keeps updated_at (Inbox ordering) untouched.
  const setClause = hasLease
    ? Prisma.sql`"metadata" = "metadata" || jsonb_build_object('reply_lease_until', now() + (${ttl(ttlMs)}::int * interval '1 millisecond')),
    ${UPDATED_AT}`
    : Prisma.sql`"metadata" = "metadata"`;
  const leaseClause = hasLease
    ? Prisma.sql`
  AND "metadata" ->> 'lease_token' = ${String(leaseToken)}::text
  AND ("metadata" ->> 'reply_lease_until')::timestamptz > now()`
    : Prisma.empty;
  const humanClause = humanGuard
    ? Prisma.sql`
  AND "status" <> 'human_takeover' AND "ai_enabled" = true
  AND (("metadata" ->> 'human_active_until') IS NULL OR ("metadata" ->> 'human_active_until')::timestamptz <= now())`
    : Prisma.empty;
  const since = optedOutSince ? new Date(optedOutSince) : null;
  const optOutClause = since && !Number.isNaN(since.getTime())
    ? Prisma.sql`
  AND (("workflow_data" ->> 'marketing_opted_out_at') IS NULL OR ("workflow_data" ->> 'marketing_opted_out_at')::timestamptz <= ${since.toISOString()}::timestamptz)`
    : Prisma.empty;
  const claims = (Array.isArray(claim) ? claim : claim ? [claim] : []).map((c) => {
    const C = ident(c && c.column, COLUMNS);
    checkPath(c.path);
    return Prisma.sql`
  AND (${C} #>> ${c.path}::text[]) = ${String(c.value)}::text`;
  });
  const claimClause = claims.length ? Prisma.join(claims, '') : Prisma.empty;

  const count = await prisma.$executeRaw(Prisma.sql`UPDATE "conversations"
SET ${setClause}
WHERE "id" = ${conversationId}${leaseClause}${humanClause}${optOutClause}${claimClause}`);
  return count === 1;
}

/**
 * D27 / GPT-6 #13 (bot side): a result's status, current_state and workflow_data in ONE statement,
 * never over a staff claim (`human_takeover` → no row, the caller does not send).
 * `needsTeam` is merged against the entry stored at write time with results.mergeNeedsTeam's rule
 * (replace when missing, resolved, claimed or of strictly lower priority), not against the copy read
 * before the model call. Two statements (status, then needs_team) let staff resolve the old request in
 * between: the resolve moved pending → open and the bot's new request then sat unresolved on an open
 * conversation, invisible to the needs-team filter and the SLA sweep. A candidate the stale copy
 * rejected is recorded when staff resolved that copy meanwhile, instead of being lost.
 * `currentState` undefined leaves current_state alone. `patch` must not carry needs_team.
 * Returns {ok, needsTeam: {reason, at} | null} (needsTeam = the entry stored after the write).
 */
async function writeConversationState(conversationId, {
  status, currentState, patch = {}, needsTeam = null, priorities = {}, defaultPriority = 1,
} = {}) {
  if (typeof status !== 'string' || !status) throw new Error('jsonb: writeConversationState needs a status');
  const json = JSON.stringify(patch || {});
  const entry = needsTeam && typeof needsTeam === 'object' ? JSON.stringify(needsTeam) : null;
  const prio = (reason) => (Object.prototype.hasOwnProperty.call(priorities, reason) ? priorities[reason] : defaultPriority);
  const entryPriority = entry ? prio(needsTeam.reason) : 0;
  const stateClause = currentState === undefined
    ? Prisma.empty
    : Prisma.sql`
    "current_state" = ${currentState === null ? null : String(currentState)}::text,`;

  const rows = await prisma.$queryRaw(Prisma.sql`UPDATE "conversations"
SET "workflow_data" = CASE
      WHEN ${entry}::jsonb IS NOT NULL AND (
           jsonb_typeof("workflow_data" -> 'needs_team') IS DISTINCT FROM 'object'
        OR ("workflow_data" #>> '{needs_team,resolved_at}') IS NOT NULL
        OR ("workflow_data" #>> '{needs_team,claimed_at}') IS NOT NULL
        OR COALESCE((${JSON.stringify(priorities)}::jsonb ->> ("workflow_data" #>> '{needs_team,reason}'))::int, ${defaultPriority}::int) < ${entryPriority}::int)
      THEN COALESCE("workflow_data", '{}'::jsonb) || ${json}::jsonb || jsonb_build_object('needs_team', ${entry}::jsonb)
      ELSE COALESCE("workflow_data", '{}'::jsonb) || ${json}::jsonb
    END,${stateClause}
    "status" = ${status}::text,
    ${UPDATED_AT}
WHERE "id" = ${conversationId} AND "status" <> 'human_takeover'
RETURNING ("workflow_data" #>> '{needs_team,reason}') AS needs_team_reason, ("workflow_data" #>> '{needs_team,at}') AS needs_team_at`);
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!row) return { ok: false, needsTeam: null };
  return { ok: true, needsTeam: row.needs_team_at || row.needs_team_reason ? { reason: row.needs_team_reason, at: row.needs_team_at } : null };
}

/**
 * D25 / GPT-6 #9: the burst's quiet deadline lives in the DB, so every instance debounces the same
 * burst. Each inbound pushes `batch_due_at` to now() + quiet window, never past `batch_first_at` + cap;
 * a deadline already in the past means the previous burst is over and this fragment starts a new one.
 * Returns {dueAt, delayMs} with the delay measured on DB time (instance clocks may be skewed), or null
 * when the conversation does not exist.
 */
async function touchBatchDue(conversationId, quietMs, capMs) {
  const quiet = Math.max(0, Math.round(Number(quietMs)) || 0);
  const cap = Math.max(0, Math.round(Number(capMs)) || 0);
  const fresh = Prisma.sql`("metadata" ->> 'batch_due_at') IS NULL OR ("metadata" ->> 'batch_first_at') IS NULL
       OR ("metadata" ->> 'batch_due_at')::timestamptz < now()`;
  const firstAt = Prisma.sql`CASE WHEN ${fresh} THEN now() ELSE ("metadata" ->> 'batch_first_at')::timestamptz END`;

  const rows = await prisma.$queryRaw(Prisma.sql`UPDATE "conversations"
SET "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object(
      'batch_first_at', ${firstAt},
      'batch_due_at', LEAST(now() + (${quiet}::int * interval '1 millisecond'), ${firstAt} + (${cap}::int * interval '1 millisecond'))),
    ${UPDATED_AT}
WHERE "id" = ${conversationId}
RETURNING ("metadata" ->> 'batch_due_at') AS due_at,
  GREATEST(0, (EXTRACT(EPOCH FROM (("metadata" ->> 'batch_due_at')::timestamptz - now())) * 1000))::int AS delay_ms`);
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!row) return null;
  return { dueAt: new Date(row.due_at), delayMs: Number(row.delay_ms) || 0 };
}

/**
 * D27 / GPT-6 #13: staff «تم التواصل». Stamps needs_team.resolved_at AND moves a pending conversation to
 * open in ONE statement, only while the stored request is still the one staff resolved (`match`, e.g.
 * {reason, at}) and unresolved. Two statements would let the bot record a newer request (and set
 * pending) in between, and the second write would then hide that request as open.
 * Returns true when the row was updated.
 */
async function resolveNeedsTeam(conversationId, { match, resolvedAt }) {
  if (!match || typeof match !== 'object' || !Object.keys(match).length) throw new Error('jsonb: resolveNeedsTeam needs a match');
  const count = await prisma.$executeRaw(Prisma.sql`UPDATE "conversations"
SET "workflow_data" = jsonb_set("workflow_data", ARRAY['needs_team'], ("workflow_data" -> 'needs_team') || jsonb_build_object('resolved_at', ${String(resolvedAt)}::text), false),
    "status" = CASE WHEN "status" = 'pending' THEN 'open' ELSE "status" END,
    ${UPDATED_AT}
WHERE "id" = ${conversationId}
  AND jsonb_typeof("workflow_data" -> 'needs_team') = 'object'
  AND ("workflow_data" -> 'needs_team') @> ${JSON.stringify(match)}::jsonb
  AND ("workflow_data" #>> '{needs_team,resolved_at}') IS NULL`);
  return count === 1;
}

async function releaseLease(conversationId, token) {
  const count = await prisma.$executeRaw(Prisma.sql`UPDATE "conversations"
SET "metadata" = "metadata" - 'lease_token' - 'reply_lease_until', ${UPDATED_AT}
WHERE "id" = ${conversationId} AND "metadata" ->> 'lease_token' = ${String(token)}::text`);
  return count === 1;
}

/**
 * Compare-and-set of ONE top-level key of businesses.ai_config (the Calendly sync cursor): the key becomes
 * `value` only while it still holds `expected` (null = missing). Everything else in ai_config is untouched,
 * so the owner's own `ai_config || '{…}'` edits and this write never clobber each other. Two sweeps racing
 * to advance the same cursor: exactly one wins. Returns true when the row was updated.
 */
async function casBusinessConfig(businessId, key, expected, value) {
  checkPath([key]);
  const exp = expected === null || expected === undefined ? null : JSON.stringify(expected);
  const count = await prisma.$executeRaw(Prisma.sql`UPDATE "businesses"
SET "ai_config" = COALESCE("ai_config", '{}'::jsonb) || jsonb_build_object(${key}::text, ${JSON.stringify(value)}::jsonb),
    ${UPDATED_AT}
WHERE "id" = ${businessId}
  AND (COALESCE("ai_config", '{}'::jsonb) -> ${key}::text) IS NOT DISTINCT FROM ${exp}::jsonb`);
  return count === 1;
}

module.exports = {
  casBusinessConfig,
  patchJson,
  mergeObjectKey,
  claimFlag,
  claimValue,
  incrementCounter,
  acquireLease,
  renewLease,
  releaseLease,
  preSendCheck,
  touchBatchDue,
  resolveNeedsTeam,
  writeConversationState,
  LEASE_TTL_MS,
};
