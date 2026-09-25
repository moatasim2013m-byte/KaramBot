-- What the agent knows about a business with no sector workflow.

CREATE TABLE IF NOT EXISTS "business_knowledge" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'fact',
    "question" TEXT,
    "content" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "business_knowledge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "business_knowledge_business_id_active_position_idx"
  ON "business_knowledge"("business_id", "active", "position");

DO $$ BEGIN
  ALTER TABLE "business_knowledge" ADD CONSTRAINT "business_knowledge_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
