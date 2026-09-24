-- One-time links so a customer sets their own password instead of SHIFT choosing one.

CREATE TABLE IF NOT EXISTS "user_activations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_activations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_activations_token_hash_key" ON "user_activations"("token_hash");
CREATE INDEX IF NOT EXISTS "user_activations_user_id_idx" ON "user_activations"("user_id");

DO $$
BEGIN
  ALTER TABLE "user_activations" ADD CONSTRAINT "user_activations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
