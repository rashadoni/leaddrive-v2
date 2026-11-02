-- Personnel number (tabel nömrəsi) of an employee card: the number HR writes in
-- the timesheet and on «Forma N-1t». Owner, 2026-11-02, after the HRSS clip that
-- lists «Tabel №» next to every name. Optional; one card per number within an
-- organization, compared without case so «T-07» and «t-07» are the same number.
-- Separate from "externalCode", the field agent's code that MTM assigns itself.
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE "mtm_agents" ADD COLUMN "personnelNumber" VARCHAR(32);
CREATE UNIQUE INDEX "mtm_agents_personnel_number_key"
  ON "mtm_agents" ("organizationId", lower("personnelNumber"))
  WHERE "personnelNumber" IS NOT NULL;
COMMIT;
