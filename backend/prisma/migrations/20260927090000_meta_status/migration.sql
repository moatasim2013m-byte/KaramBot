-- Who confirmed the payment method, and what Meta last reported about the number.

ALTER TABLE "whatsapp_onboardings" ADD COLUMN IF NOT EXISTS "payment_method_marked_by" TEXT;
ALTER TABLE "whatsapp_onboardings" ADD COLUMN IF NOT EXISTS "payment_method_marked_at" TIMESTAMP(3);
ALTER TABLE "whatsapp_onboardings" ADD COLUMN IF NOT EXISTS "meta_quality_rating" TEXT;
ALTER TABLE "whatsapp_onboardings" ADD COLUMN IF NOT EXISTS "meta_throughput" TEXT;
ALTER TABLE "whatsapp_onboardings" ADD COLUMN IF NOT EXISTS "meta_number_status" TEXT;
ALTER TABLE "whatsapp_onboardings" ADD COLUMN IF NOT EXISTS "meta_name_status" TEXT;
ALTER TABLE "whatsapp_onboardings" ADD COLUMN IF NOT EXISTS "meta_review_status" TEXT;
ALTER TABLE "whatsapp_onboardings" ADD COLUMN IF NOT EXISTS "meta_checked_at" TIMESTAMP(3);
