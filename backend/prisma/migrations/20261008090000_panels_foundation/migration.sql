-- Ten customers, P0 (docs/panels/spec.md «Schema changes», Migration 1): a shop's profile before its
-- number, what Meta tells us about it, the contract's own terms, one table for what happened to an
-- account, and the platform switches the owner changes without a deploy.
--
-- Backward compatible with the code in production (dc0ed6ee): it only adds nullable or defaulted
-- columns, drops two NOT NULL constraints, and adds tables and indexes. Nothing is renamed or
-- dropped, and the running code never writes NULL into the two relaxed columns, so it behaves the
-- same before and after this runs. Apply with backend/scripts/migrate-prod.sh.
--
-- The SQL down to the backfills is `prisma migrate diff` from the previous schema to this one.

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "city" TEXT,
ADD COLUMN     "connected_at" TIMESTAMP(3),
ADD COLUMN     "is_internal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "meta_business_id" TEXT,
ADD COLUMN     "owner_phone" TEXT,
ADD COLUMN     "sector" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'operator',
ADD COLUMN     "wa_display_phone" TEXT,
ADD COLUMN     "wa_verified_name" TEXT,
ADD COLUMN     "went_live_at" TIMESTAMP(3),
ALTER COLUMN "wa_phone_number_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "last_outbound_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "whatsapp_onboardings" ADD COLUMN     "detached_at" TIMESTAMP(3),
ADD COLUMN     "finish_event" TEXT,
ADD COLUMN     "needs_operator" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payment_blocked_at" TIMESTAMP(3),
ADD COLUMN     "payment_method_claimed_at" TIMESTAMP(3),
ADD COLUMN     "revoked_at" TIMESTAMP(3),
ADD COLUMN     "revoked_reason" TEXT,
ADD COLUMN     "started_by_user_id" TEXT,
ADD COLUMN     "token_checked_at" TIMESTAMP(3),
ALTER COLUMN "phone_number_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "ai_replies_month" INTEGER,
ADD COLUMN     "campaign" TEXT,
ADD COLUMN     "seats" INTEGER,
ADD COLUMN     "trial_ends_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "account_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT,
    "actor_user_id" TEXT,
    "actor_kind" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "account_events_business_id_created_at_idx" ON "account_events"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "account_events_type_resolved_at_idx" ON "account_events"("type", "resolved_at");

-- CreateIndex
CREATE INDEX "account_events_created_at_idx" ON "account_events"("created_at");

-- CreateIndex
CREATE INDEX "conversations_business_id_last_inbound_at_idx" ON "conversations"("business_id", "last_inbound_at");

-- CreateIndex
-- A plain CREATE INDEX holds writes on messages while it builds. At ten shops the table is small
-- enough for that to take a moment, and migrate deploy runs inside a transaction, where
-- CREATE INDEX CONCURRENTLY is not allowed.
CREATE INDEX "messages_business_id_created_at_idx" ON "messages"("business_id", "created_at");

-- Backfill (a): SHIFT's own business and the test rows (slugs ending in -sim) are internal, so the
-- fleet totals, the attention queue and the daily AI ceiling stop counting them from the first deploy.
UPDATE "businesses" SET "is_internal" = true WHERE "business_type" = 'shift' OR "slug" LIKE '%-sim';

-- Backfill (b): conversations.last_outbound_at from the newest outbound message of each conversation,
-- so the «waiting for a reply» rule built on it is right for history, not only for messages saved
-- after the deploy. Rows that never reached the customer (failed, cancelled, or an ambiguous send
-- the sweeper could not reconcile: shiftSweeper's UNDELIVERED_OUTBOUND) are not a reply and are
-- skipped. Only rows still NULL are touched, so running it again changes nothing.
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
  AND c."last_outbound_at" IS NULL;
