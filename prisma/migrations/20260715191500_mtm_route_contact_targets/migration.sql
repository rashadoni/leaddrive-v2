-- Preserve the physical organization target while optionally naming the
-- doctor or pharmacist expected at that workplace.
ALTER TABLE "mtm_route_points" ADD COLUMN "contactId" TEXT;
ALTER TABLE "mtm_visits" ADD COLUMN "contactId" TEXT;

CREATE INDEX "mtm_route_points_contactId_idx" ON "mtm_route_points"("contactId");
CREATE INDEX "mtm_visits_contactId_idx" ON "mtm_visits"("contactId");

ALTER TABLE "mtm_route_points"
  ADD CONSTRAINT "mtm_route_points_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "mtm_contacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "mtm_visits"
  ADD CONSTRAINT "mtm_visits_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "mtm_contacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
