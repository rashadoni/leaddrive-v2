ALTER TABLE "mtm_agent_locations"
  ADD COLUMN "workdayId" TEXT;

CREATE INDEX "mtm_agent_locations_workdayId_recordedAt_idx"
  ON "mtm_agent_locations"("workdayId", "recordedAt");

ALTER TABLE "mtm_agent_locations"
  ADD CONSTRAINT "mtm_agent_locations_workdayId_fkey"
  FOREIGN KEY ("workdayId") REFERENCES "mtm_agent_workdays"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
