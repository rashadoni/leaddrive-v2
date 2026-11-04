-- A desk screen (owner, 2026-11-04): the employee's own computer, paired by the
-- employee's phone, shows the branch code and the employee's break buttons; a
-- reception screen (no agent) shows only the code. A screen on the branch's
-- remembered office network stands at its branch without a position (NETWORK).
SET lock_timeout='3s';

ALTER TABLE mtm_attendance_branch_screens ADD COLUMN "agentId" TEXT;
ALTER TABLE mtm_attendance_branch_screens ADD CONSTRAINT mtm_attendance_branch_screens_agent_fkey
  FOREIGN KEY ("organizationId","agentId") REFERENCES mtm_agents("organizationId",id) ON DELETE CASCADE;
CREATE INDEX mtm_attendance_branch_screens_org_agent_idx ON mtm_attendance_branch_screens("organizationId","agentId") WHERE "agentId" IS NOT NULL;

ALTER TABLE mtm_attendance_branch_screens DROP CONSTRAINT mtm_attendance_branch_screens_place_check;
ALTER TABLE mtm_attendance_branch_screens ADD CONSTRAINT mtm_attendance_branch_screens_place_check CHECK (
  ("placeState" IS NULL AND "placeDistanceMeters" IS NULL AND "placeCheckedAt" IS NULL)
  OR ("placeState" IN ('NO_FIX','NETWORK') AND "placeDistanceMeters" IS NULL AND "placeCheckedAt" IS NOT NULL)
  OR ("placeState" IN ('AT_BRANCH','AWAY') AND "placeDistanceMeters" >= 0 AND "placeCheckedAt" IS NOT NULL)
);
