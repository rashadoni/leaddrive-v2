-- «Клиент здесь», while the request waits: a visit checked in from the place
-- its agent's own waiting request names is accepted — the owner, 2026-10-12:
-- «пускать, но показывать руководителю такой визит с пометкой "адрес на
-- проверке"». This column is that mark: which request the visit leaned on.
--
-- Nullable, no default: adding it rewrites nothing and existing visits keep
-- NULL. The previous build does not know the column and never reads it.

SET lock_timeout = '3s';

ALTER TABLE "mtm_visits" ADD COLUMN "locationRequestId" TEXT;

-- NOT VALID, then validated on its own: the table is not scanned while the
-- lock that adds the constraint is held. Every existing row is NULL.
ALTER TABLE "mtm_visits"
  ADD CONSTRAINT "mtm_visits_locationRequestId_fkey"
  FOREIGN KEY ("locationRequestId") REFERENCES "mtm_customer_location_requests"("id")
  ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "mtm_visits" VALIDATE CONSTRAINT "mtm_visits_locationRequestId_fkey";

-- Only the handful of visits that carry a request: the index stays tiny.
CREATE INDEX "mtm_visits_organizationId_locationRequestId_idx"
  ON "mtm_visits"("organizationId", "locationRequestId")
  WHERE "locationRequestId" IS NOT NULL;

-- Rollback is forward-safe: roll back the application code and keep the
-- column. Without the code nothing writes or reads it.
