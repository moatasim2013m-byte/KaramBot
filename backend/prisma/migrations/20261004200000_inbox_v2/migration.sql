-- Inbox v2 (docs/inbox-v2-port-plan.md): what staff organise conversations by, the message delivery
-- timeline, quick replies, scheduled messages and staff presence. Additive only — every new column is
-- nullable or has a default, so the code already deployed keeps working before and after this runs.

-- conversations
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "labels" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "snoozed_until" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "contact_notes" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "custom_label" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "needs_attention" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "attention_reason" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "attention_at" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "last_staff_read_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "conversations_business_id_last_message_at_idx"
  ON "conversations"("business_id", "last_message_at");
CREATE INDEX IF NOT EXISTS "conversations_business_id_needs_attention_idx"
  ON "conversations"("business_id", "needs_attention");
CREATE INDEX IF NOT EXISTS "conversations_business_id_snoozed_until_idx"
  ON "conversations"("business_id", "snoozed_until");
CREATE INDEX IF NOT EXISTS "conversations_business_id_assigned_staff_id_idx"
  ON "conversations"("business_id", "assigned_staff_id");

-- messages
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "reply_to_message_id" TEXT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "reactions" JSONB;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP(3);
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "read_at" TIMESTAMP(3);
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "failed_at" TIMESTAMP(3);
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "error_code" TEXT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "error_message" TEXT;

-- quick_replies
CREATE TABLE IF NOT EXISTS "quick_replies" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "quick_replies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "quick_replies_business_id_is_active_idx"
  ON "quick_replies"("business_id", "is_active");
DO $$ BEGIN
  ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- scheduled_messages
CREATE TABLE IF NOT EXISTS "scheduled_messages" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "text" TEXT,
    "template_name" TEXT,
    "template_language" TEXT,
    "components" JSONB,
    "send_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fail_reason" TEXT,
    "sent_message_id" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    CONSTRAINT "scheduled_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "scheduled_messages_status_send_at_idx"
  ON "scheduled_messages"("status", "send_at");
CREATE INDEX IF NOT EXISTS "scheduled_messages_business_id_conversation_id_status_idx"
  ON "scheduled_messages"("business_id", "conversation_id", "status");
DO $$ BEGIN
  ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- staff_inbox_presence
CREATE TABLE IF NOT EXISTS "staff_inbox_presence" (
    "user_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "viewing_conversation_id" TEXT,
    "typing_conversation_id" TEXT,
    "typing_at" TIMESTAMP(3),
    CONSTRAINT "staff_inbox_presence_pkey" PRIMARY KEY ("user_id")
);
CREATE INDEX IF NOT EXISTS "staff_inbox_presence_business_id_last_seen_at_idx"
  ON "staff_inbox_presence"("business_id", "last_seen_at");
DO $$ BEGIN
  ALTER TABLE "staff_inbox_presence" ADD CONSTRAINT "staff_inbox_presence_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "staff_inbox_presence" ADD CONSTRAINT "staff_inbox_presence_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
