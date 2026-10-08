-- conversations.last_outbound_at, again, after the panels code is deployed.
--
-- Migration 20261008090000_panels_foundation backfills this column, but it runs before the code
-- deploy (migrate-prod.sh is run by hand), and the old code keeps saving replies, staff sends and
-- /ingest rows in between without stamping it. A handoff answered in that gap would otherwise stay
-- «محوّلة لفريق المحل بلا رد» in the attention queue (isHandoffWaiting has no time limit).
--
-- The same statement as the migration's backfill (b). It only moves the column forward, like
-- markOutbound, so running it more than once is harmless.
UPDATE "conversations" AS c
SET "last_outbound_at" = m."last_out"
FROM (
    SELECT "conversation_id", MAX("created_at") AS "last_out"
    FROM "messages"
    WHERE "direction" = 'outbound'
      AND "status" NOT IN ('failed', 'cancelled', 'ambiguous_unreconciled')
    GROUP BY "conversation_id"
) AS m
WHERE m."conversation_id" = c."id"
  AND (c."last_outbound_at" IS NULL OR c."last_outbound_at" < m."last_out");
