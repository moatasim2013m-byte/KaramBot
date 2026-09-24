-- Record every time SHIFT staff read a customer's conversations.

CREATE TABLE IF NOT EXISTS "admin_access_logs" (
    "id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "admin_email" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_access_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "admin_access_logs_business_id_created_at_idx" ON "admin_access_logs"("business_id", "created_at");
CREATE INDEX IF NOT EXISTS "admin_access_logs_admin_user_id_created_at_idx" ON "admin_access_logs"("admin_user_id", "created_at");
