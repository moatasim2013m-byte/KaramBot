-- Embedded Signup (v4): one row per signup run, plus the app that owns a number's webhooks.

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN "wa_app_id" TEXT;

-- CreateTable
CREATE TABLE "whatsapp_onboardings" (
    "id" TEXT NOT NULL,
    "business_id" TEXT,
    "app_id" TEXT NOT NULL,
    "meta_business_id" TEXT NOT NULL,
    "waba_id" TEXT NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "access_token_enc" TEXT,
    "pin_enc" TEXT,
    "step" TEXT NOT NULL DEFAULT 'code_received',
    "token_exchanged_at" TIMESTAMP(3),
    "subscribed_at" TIMESTAMP(3),
    "registered_at" TIMESTAMP(3),
    "payment_method_ok" BOOLEAN NOT NULL DEFAULT false,
    "session_id" TEXT,
    "last_error" TEXT,
    "last_error_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_onboardings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_onboardings_business_id_key" ON "whatsapp_onboardings"("business_id");
CREATE UNIQUE INDEX "whatsapp_onboardings_phone_number_id_key" ON "whatsapp_onboardings"("phone_number_id");
CREATE INDEX "whatsapp_onboardings_waba_id_idx" ON "whatsapp_onboardings"("waba_id");
CREATE INDEX "whatsapp_onboardings_step_idx" ON "whatsapp_onboardings"("step");

-- AddForeignKey
ALTER TABLE "whatsapp_onboardings" ADD CONSTRAINT "whatsapp_onboardings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
