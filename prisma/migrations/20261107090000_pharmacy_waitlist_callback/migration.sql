-- Owner's queue task 10 (2026-11-07): the AI calls a pharmacy back when a product it waited for arrives.
-- New nullable columns only: an older release neither reads nor writes them.
ALTER TABLE "pharmacy_waitlist_items" ADD COLUMN "callbackAt" TIMESTAMP(3);
ALTER TABLE "pharmacy_waitlist_items" ADD COLUMN "callbackCallId" TEXT;
ALTER TABLE "pharmacy_waitlist_items" ADD COLUMN "callbackStatus" TEXT;
ALTER TABLE "pharmacy_waitlist_items" ADD CONSTRAINT "pharmacy_waitlist_items_callback_status_check"
  CHECK ("callbackStatus" IS NULL OR "callbackStatus" IN ('placed', 'failed'));
CREATE INDEX "pharmacy_waitlist_items_organizationId_callbackCallId_idx" ON "pharmacy_waitlist_items"("organizationId", "callbackCallId");
