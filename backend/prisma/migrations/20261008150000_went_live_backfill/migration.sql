-- Ten customers, P2 review: businesses.went_live_at for the shops that were live before it existed.
--
-- Migration 20261008090000_panels_foundation added the column as NULL for every row, and the P2
-- code (services/wentLive.js) treats NULL as «this shop has never answered a customer». Without
-- this, every shop that has been answering for weeks would, on its first reply after the deploy:
-- alert SHIFT «… يعمل — أول رد للبوت», write a went_live AccountEvent, restart the free-month
-- clock of a contract still on trial, and, until then, sit on the «الانضمام» board and in the
-- daily 14-day backstop (services/accountsDaily.js) as a shop that never went live.
--
-- The date is the shop's first AI reply that was sent (not a failed or cancelled one). Only
-- customer shops: SHIFT's own number and the internal rows never «go live». A shop whose bot never
-- replied keeps NULL and goes live the normal way. Data only, no schema change: safe to run before
-- the code deploy, and running it twice changes nothing (it fills NULLs only).
UPDATE "businesses" AS b
SET "went_live_at" = m."first_reply"
FROM (
    SELECT "business_id", MIN("created_at") AS "first_reply"
    FROM "messages"
    WHERE "direction" = 'outbound'
      AND "is_ai_generated" = true
      AND "status" NOT IN ('failed', 'cancelled', 'ambiguous_unreconciled')
    GROUP BY "business_id"
) AS m
WHERE m."business_id" = b."id"
  AND b."went_live_at" IS NULL
  AND b."is_internal" = false
  AND b."business_type" <> 'shift';
