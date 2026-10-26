-- Pharmacies from Zeytun's 1C list become companies in the CRM, and a phone
-- order points at its pharmacy's company. Owner, 2026-10-26: «Макет аптек
-- подходит, делай». Both tables are already under FORCE row-level security;
-- no rows are written here (the 1C list is loaded by the application).
ALTER TABLE "companies" ADD COLUMN "managerId" TEXT;
ALTER TABLE "companies" ADD COLUMN "externalSource" TEXT;
ALTER TABLE "companies" ADD COLUMN "externalId" TEXT;
ALTER TABLE "companies" ADD COLUMN "externalSyncedAt" TIMESTAMP(3);
ALTER TABLE "companies" ADD COLUMN "externalRemovedAt" TIMESTAMP(3);
ALTER TABLE "companies" ADD CONSTRAINT "companies_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Both halves of the register key or neither.
ALTER TABLE "companies" ADD CONSTRAINT "companies_external_key_check"
  CHECK (("externalSource" IS NULL) = ("externalId" IS NULL));
CREATE UNIQUE INDEX "companies_organizationId_externalSource_externalId_key"
  ON "companies"("organizationId", "externalSource", "externalId");

ALTER TABLE "pharmacy_phone_orders" ADD COLUMN "companyId" TEXT;
ALTER TABLE "pharmacy_phone_orders" ADD CONSTRAINT "pharmacy_phone_orders_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "pharmacy_phone_orders_organizationId_companyId_createdAt_idx"
  ON "pharmacy_phone_orders"("organizationId", "companyId", "createdAt");
-- A manager can now name the order's pharmacy (manager_selected).
ALTER TABLE "pharmacy_phone_orders" DROP CONSTRAINT "pharmacy_phone_orders_identification_check";
ALTER TABLE "pharmacy_phone_orders" ADD CONSTRAINT "pharmacy_phone_orders_identification_check"
  CHECK ("pharmacyIdentification" IN ('test_call', 'phone_unique', 'phone_shared', 'named_on_call', 'unidentified', 'manager_selected'));
