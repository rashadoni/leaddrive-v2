-- C2: append-only arrival/departure claims for planned Workforce segments.
-- This ledger contains no raw location or payment decision; C4 assesses proof
-- separately and C3 later snapshots the effective segment configuration.

SET lock_timeout = '3s';

CREATE TYPE "WorkforceSiteTransitionKind" AS ENUM ('ARRIVAL', 'DEPARTURE');

CREATE TABLE "workforce_site_transitions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "workdayId" TEXT NOT NULL,
  "segmentId" TEXT NOT NULL,
  "kind" "WorkforceSiteTransitionKind" NOT NULL,
  "clientTransitionId" VARCHAR(100) NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "queuedAt" TIMESTAMP(3),
  "serverReceivedAt" TIMESTAMP(3) NOT NULL,
  "appliedAt" TIMESTAMP(3) NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "requestHash" VARCHAR(64) NOT NULL,
  "attendanceReviewState" "WorkforceAttendanceClaimReviewState" NOT NULL DEFAULT 'NOT_REQUIRED',
  "attendanceReviewReasonCode" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_site_transitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_site_transitions_schema_version_check" CHECK ("schemaVersion" >= 1),
  CONSTRAINT "workforce_site_transitions_receipt_order_check" CHECK (
    "appliedAt" >= "serverReceivedAt"
  )
);

CREATE UNIQUE INDEX "workforce_site_transitions_organizationId_id_key"
  ON "workforce_site_transitions"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_site_transitions_org_agent_client_key"
  ON "workforce_site_transitions"("organizationId", "agentId", "clientTransitionId");
CREATE UNIQUE INDEX "workforce_site_transitions_org_workday_segment_kind_key"
  ON "workforce_site_transitions"("organizationId", "workdayId", "segmentId", "kind");
CREATE INDEX "workforce_site_transitions_org_agent_claimed_idx"
  ON "workforce_site_transitions"("organizationId", "agentId", "claimedAt");
CREATE INDEX "workforce_site_transitions_org_workday_claimed_idx"
  ON "workforce_site_transitions"("organizationId", "workdayId", "claimedAt");
CREATE INDEX "workforce_site_transitions_org_segment_claimed_idx"
  ON "workforce_site_transitions"("organizationId", "segmentId", "claimedAt");
CREATE INDEX "workforce_site_transitions_org_agent_review_idx"
  ON "workforce_site_transitions"("organizationId", "agentId", "attendanceReviewState", "serverReceivedAt");

ALTER TABLE "workforce_site_transitions"
  ADD CONSTRAINT "workforce_site_transitions_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_site_transitions_agent_fkey"
    FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_site_transitions_workday_fkey"
    FOREIGN KEY ("organizationId", "workdayId") REFERENCES "mtm_agent_workdays"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_site_transitions_segment_fkey"
    FOREIGN KEY ("organizationId", "segmentId") REFERENCES "workforce_shift_segments"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A fact is never overwritten or removed. Corrections and assessment results
-- belong to separate append-only records rather than altering the claim.
CREATE OR REPLACE FUNCTION workforce_reject_site_transition_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce site transitions are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_site_transitions_append_only
  BEFORE UPDATE OR DELETE ON "workforce_site_transitions"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_site_transition_mutation();

-- A departure is meaningful only after the same workday/segment has an
-- arrival. Inter-site movement is represented by departure from the prior
-- segment and arrival to the next segment; it never creates a second day.
CREATE OR REPLACE FUNCTION workforce_validate_site_transition_order()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."kind" = 'DEPARTURE'::"WorkforceSiteTransitionKind" AND NOT EXISTS (
    SELECT 1
    FROM "workforce_site_transitions" AS arrival
    WHERE arrival."organizationId" = NEW."organizationId"
      AND arrival."workdayId" = NEW."workdayId"
      AND arrival."segmentId" = NEW."segmentId"
      AND arrival."kind" = 'ARRIVAL'::"WorkforceSiteTransitionKind"
      AND arrival."claimedAt" <= NEW."claimedAt"
  ) THEN
    RAISE EXCEPTION 'A Workforce segment departure requires an earlier arrival claim' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_site_transitions_validate_order
  BEFORE INSERT ON "workforce_site_transitions"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_site_transition_order();

ALTER TABLE "workforce_site_transitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_site_transitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workforce_site_transitions"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
