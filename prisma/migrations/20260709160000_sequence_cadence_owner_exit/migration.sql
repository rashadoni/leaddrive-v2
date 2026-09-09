-- Sales cadence upgrade for sequences:
--  * sales_sequences: auto-exit rule flags (reply / meeting / deal closed)
--  * sequence_enrollments: ownerId (whose touch-queue), outcome tracking columns
--  * backfill ownerId from the enrolled lead's assignedTo, falling back to enrolledBy
--    (contacts have no owner column, so contact enrollments fall back too).
--
-- sales_sequences / sequence_enrollments / leads run with FORCE ROW LEVEL SECURITY
-- in production (tenant_isolation policy). The migration connection has no
-- app.org_id, so the backfill UPDATE + its JOIN to leads would silently see zero
-- rows. Prior art (20260705152500_monitoring_external_sources_rls_backfill):
-- snapshot RLS state, disable, backfill, restore exactly as it was.

ALTER TABLE "sales_sequences" ADD COLUMN IF NOT EXISTS "exitOnReply" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "sales_sequences" ADD COLUMN IF NOT EXISTS "exitOnMeeting" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "sales_sequences" ADD COLUMN IF NOT EXISTS "exitOnDealClosed" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "sequence_enrollments" ADD COLUMN IF NOT EXISTS "ownerId" TEXT;
ALTER TABLE "sequence_enrollments" ADD COLUMN IF NOT EXISTS "repliedAt" TIMESTAMP(3);
ALTER TABLE "sequence_enrollments" ADD COLUMN IF NOT EXISTS "meetingBookedAt" TIMESTAMP(3);
ALTER TABLE "sequence_enrollments" ADD COLUMN IF NOT EXISTS "lastOutcome" TEXT;
ALTER TABLE "sequence_enrollments" ADD COLUMN IF NOT EXISTS "exitReason" TEXT;

CREATE INDEX IF NOT EXISTS "sequence_enrollments_organizationId_ownerId_status_idx"
  ON "sequence_enrollments" ("organizationId", "ownerId", "status");

DO $$
DECLARE
  enr_rls boolean;
  enr_force boolean;
  leads_rls boolean;
  leads_force boolean;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity INTO enr_rls, enr_force
  FROM pg_class WHERE oid = 'sequence_enrollments'::regclass;
  SELECT relrowsecurity, relforcerowsecurity INTO leads_rls, leads_force
  FROM pg_class WHERE oid = 'leads'::regclass;

  ALTER TABLE "sequence_enrollments" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "leads" DISABLE ROW LEVEL SECURITY;

  -- Lead enrollments: owner = the lead's assignee (same-org guard on the JOIN).
  UPDATE "sequence_enrollments" AS se
  SET "ownerId" = l."assignedTo"
  FROM "leads" AS l
  WHERE se."ownerId" IS NULL
    AND se."entityType" = 'lead'
    AND l."id" = se."entityId"
    AND l."organizationId" = se."organizationId"
    AND l."assignedTo" IS NOT NULL;

  -- Everything still unowned (contact enrollments, unassigned leads): whoever enrolled them.
  UPDATE "sequence_enrollments"
  SET "ownerId" = "enrolledBy"
  WHERE "ownerId" IS NULL
    AND "enrolledBy" IS NOT NULL;

  IF enr_rls THEN
    ALTER TABLE "sequence_enrollments" ENABLE ROW LEVEL SECURITY;
  END IF;
  IF enr_force THEN
    ALTER TABLE "sequence_enrollments" FORCE ROW LEVEL SECURITY;
  END IF;
  IF leads_rls THEN
    ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
  END IF;
  IF leads_force THEN
    ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
