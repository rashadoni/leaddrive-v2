-- «Часы приёма» of an MTM place (src/lib/mtm/customer-hours.ts). Nullable
-- columns only: no backfill, no row is rewritten, RLS on mtm_customers stays.
ALTER TABLE "mtm_customers" ADD COLUMN "workingHours" JSONB;
ALTER TABLE "mtm_customers" ADD COLUMN "workingHoursUpdatedAt" TIMESTAMP(3);
ALTER TABLE "mtm_customers" ADD COLUMN "workingHoursUpdatedBy" TEXT;
