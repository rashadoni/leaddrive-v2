-- Phone orders go to Zeytun's 1C on the manager's confirm, and every manager
-- change after the call is recorded. New nullable columns: no backfill, the
-- table's FORCE row-level security is untouched.
ALTER TABLE "pharmacy_phone_orders"
  ADD COLUMN "erpState" TEXT,
  ADD COLUMN "erpAttemptAt" TIMESTAMP(3),
  ADD COLUMN "erpDocument" JSONB,
  ADD COLUMN "erpResult" JSONB,
  ADD COLUMN "managerEdits" JSONB;

ALTER TABLE "pharmacy_phone_orders" ADD CONSTRAINT "pharmacy_phone_orders_erp_state_check"
  CHECK ("erpState" IS NULL OR "erpState" IN ('sending', 'created', 'refused', 'unknown'));
