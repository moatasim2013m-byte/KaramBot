-- Hardening the handover flow after an adversarial review.

-- Sessions minted before a password change are refused.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sessions_valid_from" TIMESTAMP(3);

-- One live invitation per user. Two concurrent issues both saw "nothing live" under READ
-- COMMITTED and both inserted, leaving two working keys to one account; a transaction alone
-- cannot fix that because there are no rows to lock. Retire the extras, then forbid them.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
  FROM "user_activations"
  WHERE "used_at" IS NULL
)
UPDATE "user_activations" SET "used_at" = CURRENT_TIMESTAMP
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS "user_activations_one_live_per_user"
  ON "user_activations"("user_id") WHERE "used_at" IS NULL;
