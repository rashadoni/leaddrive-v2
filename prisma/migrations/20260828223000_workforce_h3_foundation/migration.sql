-- Workforce H3 foundation. All structures are additive: the current MTM
-- workday/request tables remain canonical for supported clients. No tenant
-- policy, shift, snapshot, approval, correction or retention operation is
-- seeded or applied by this migration.

SET lock_timeout = '3s';

CREATE TYPE "WorkforceDefinitionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "WorkforceAttendanceExceptionType" AS ENUM ('LATE_START', 'UNDERTIME', 'OVERTIME', 'LONG_PAUSE');
CREATE TYPE "WorkforceAttendanceExceptionStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "WorkforceTimeCorrectionSource" AS ENUM ('DIRECT_MANAGER', 'REQUEST_APPROVAL');
CREATE TYPE "WorkforceTimesheetRecordKind" AS ENUM ('APPROVAL', 'CORRECTION');

-- Guarantees non-overlapping effective-dated shift assignments per tenant and
-- agent. It is an additive trusted PostgreSQL extension, not application data.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Composite tenant keys allow the new facts to use tenant-scoped foreign keys
-- without changing a legacy data value or source of truth.
CREATE UNIQUE INDEX "mtm_agent_workdays_organizationId_id_key"
  ON "mtm_agent_workdays"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_hrm_requests_organizationId_id_key"
  ON "mtm_hrm_requests"("organizationId", "id");

CREATE TABLE "workforce_policies" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "teamId" TEXT,
  "version" INTEGER NOT NULL,
  "status" "WorkforceDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
  "name" TEXT NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "definition" JSONB NOT NULL,
  "definitionHash" VARCHAR(64) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "activatedByUserId" TEXT,
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workforce_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_policies_version_positive" CHECK ("version" > 0),
  CONSTRAINT "workforce_policies_name_nonempty" CHECK (btrim("name") <> ''),
  CONSTRAINT "workforce_policies_effective_range_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  CONSTRAINT "workforce_policies_definition_object" CHECK (jsonb_typeof("definition") = 'object'),
  CONSTRAINT "workforce_policies_hash_check" CHECK ("definitionHash" ~ '^[A-Fa-f0-9]{64}$'),
  CONSTRAINT "workforce_policies_activation_check" CHECK (
    "status" = 'DRAFT' OR ("activatedByUserId" IS NOT NULL AND "activatedAt" IS NOT NULL)
  ),
  CONSTRAINT "workforce_policies_retirement_check" CHECK ("status" <> 'RETIRED' OR "retiredAt" IS NOT NULL),
  CONSTRAINT "workforce_policies_active_not_retired_check" CHECK ("status" <> 'ACTIVE' OR "retiredAt" IS NULL),
  CONSTRAINT "workforce_policies_draft_lifecycle_check" CHECK (
    "status" <> 'DRAFT' OR ("activatedByUserId" IS NULL AND "activatedAt" IS NULL AND "retiredAt" IS NULL)
  ),
  CONSTRAINT "workforce_policies_lifecycle_time_check" CHECK (
    "retiredAt" IS NULL OR "activatedAt" IS NULL OR "retiredAt" >= "activatedAt"
  )
);

CREATE TABLE "workforce_shift_templates" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "teamId" TEXT,
  "code" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "WorkforceDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
  "name" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "definition" JSONB NOT NULL,
  "definitionHash" VARCHAR(64) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "activatedByUserId" TEXT,
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workforce_shift_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_shift_templates_version_positive" CHECK ("version" > 0),
  CONSTRAINT "workforce_shift_templates_code_nonempty" CHECK (btrim("code") <> ''),
  CONSTRAINT "workforce_shift_templates_name_nonempty" CHECK (btrim("name") <> ''),
  CONSTRAINT "workforce_shift_templates_timezone_nonempty" CHECK (btrim("timezone") <> ''),
  CONSTRAINT "workforce_shift_templates_definition_object" CHECK (jsonb_typeof("definition") = 'object'),
  CONSTRAINT "workforce_shift_templates_hash_check" CHECK ("definitionHash" ~ '^[A-Fa-f0-9]{64}$'),
  CONSTRAINT "workforce_shift_templates_activation_check" CHECK (
    "status" = 'DRAFT' OR ("activatedByUserId" IS NOT NULL AND "activatedAt" IS NOT NULL)
  ),
  CONSTRAINT "workforce_shift_templates_retirement_check" CHECK ("status" <> 'RETIRED' OR "retiredAt" IS NOT NULL),
  CONSTRAINT "workforce_shift_templates_active_not_retired_check" CHECK ("status" <> 'ACTIVE' OR "retiredAt" IS NULL),
  CONSTRAINT "workforce_shift_templates_draft_lifecycle_check" CHECK (
    "status" <> 'DRAFT' OR ("activatedByUserId" IS NULL AND "activatedAt" IS NULL AND "retiredAt" IS NULL)
  ),
  CONSTRAINT "workforce_shift_templates_lifecycle_time_check" CHECK (
    "retiredAt" IS NULL OR "activatedAt" IS NULL OR "retiredAt" >= "activatedAt"
  )
);

CREATE TABLE "workforce_shift_assignments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "assignedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workforce_shift_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_shift_assignments_effective_range_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
);

CREATE TABLE "workforce_policy_snapshots" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "workdayId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "workDate" DATE NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "definition" JSONB NOT NULL,
  "definitionHash" VARCHAR(64) NOT NULL,
  "expectedWorkSeconds" INTEGER NOT NULL,
  "lateGraceSeconds" INTEGER NOT NULL,
  "undertimeToleranceSeconds" INTEGER NOT NULL,
  "overtimeThresholdSeconds" INTEGER NOT NULL,
  "longPauseThresholdSeconds" INTEGER,
  "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_policy_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_policy_snapshots_definition_object" CHECK (jsonb_typeof("definition") = 'object'),
  CONSTRAINT "workforce_policy_snapshots_hash_check" CHECK ("definitionHash" ~ '^[A-Fa-f0-9]{64}$'),
  CONSTRAINT "workforce_policy_snapshots_duration_check" CHECK (
    "expectedWorkSeconds" >= 0
    AND "lateGraceSeconds" >= 0
    AND "undertimeToleranceSeconds" >= 0
    AND "overtimeThresholdSeconds" >= 0
    AND ("longPauseThresholdSeconds" IS NULL OR "longPauseThresholdSeconds" >= 0)
  )
);

CREATE TABLE "workforce_shift_snapshots" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "assignmentId" TEXT,
  "workdayId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "workDate" DATE NOT NULL,
  "templateVersion" INTEGER NOT NULL,
  "timezone" TEXT NOT NULL,
  "definition" JSONB NOT NULL,
  "definitionHash" VARCHAR(64) NOT NULL,
  "plannedStartAt" TIMESTAMP(3) NOT NULL,
  "plannedEndAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_shift_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_shift_snapshots_definition_object" CHECK (jsonb_typeof("definition") = 'object'),
  CONSTRAINT "workforce_shift_snapshots_hash_check" CHECK ("definitionHash" ~ '^[A-Fa-f0-9]{64}$'),
  CONSTRAINT "workforce_shift_snapshots_time_range_check" CHECK ("plannedEndAt" > "plannedStartAt")
);

CREATE TABLE "workforce_attendance_exceptions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workdayId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "policySnapshotId" TEXT NOT NULL,
  "shiftSnapshotId" TEXT NOT NULL,
  "type" "WorkforceAttendanceExceptionType" NOT NULL,
  "calculationVersion" INTEGER NOT NULL,
  "valueSeconds" INTEGER NOT NULL,
  "thresholdSeconds" INTEGER NOT NULL,
  "excessSeconds" INTEGER NOT NULL,
  "provisional" BOOLEAN NOT NULL DEFAULT false,
  "status" "WorkforceAttendanceExceptionStatus" NOT NULL DEFAULT 'OPEN',
  "resolutionNote" TEXT,
  "resolvedByUserId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workforce_attendance_exceptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_attendance_exceptions_values_check" CHECK (
    "calculationVersion" > 0
    AND "valueSeconds" >= 0
    AND "thresholdSeconds" >= 0
    AND "excessSeconds" >= 0
    AND "excessSeconds" = GREATEST(0, "valueSeconds" - "thresholdSeconds")
  ),
  CONSTRAINT "workforce_attendance_exceptions_resolution_check" CHECK (
    (
      "status" = 'RESOLVED'
      AND "resolvedByUserId" IS NOT NULL
      AND "resolvedAt" IS NOT NULL
      AND NULLIF(btrim("resolutionNote"), '') IS NOT NULL
    )
    OR (
      "status" <> 'RESOLVED'
      AND "resolvedByUserId" IS NULL
      AND "resolvedAt" IS NULL
      AND "resolutionNote" IS NULL
    )
  )
);

CREATE TABLE "workforce_time_corrections" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workdayId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "requestId" TEXT,
  "source" "WorkforceTimeCorrectionSource" NOT NULL,
  "operationId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "beforeFacts" JSONB NOT NULL,
  "afterFacts" JSONB NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_time_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_time_corrections_reason_check" CHECK (NULLIF(btrim("reason"), '') IS NOT NULL),
  CONSTRAINT "workforce_time_corrections_operation_check" CHECK (NULLIF(btrim("operationId"), '') IS NOT NULL),
  CONSTRAINT "workforce_time_corrections_source_check" CHECK (
    ("source" = 'DIRECT_MANAGER' AND "requestId" IS NULL)
    OR ("source" = 'REQUEST_APPROVAL' AND "requestId" IS NOT NULL)
  ),
  CONSTRAINT "workforce_time_corrections_fact_change_check" CHECK ("beforeFacts" IS DISTINCT FROM "afterFacts")
);

CREATE TABLE "workforce_timesheet_approvals" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "recordKind" "WorkforceTimesheetRecordKind" NOT NULL DEFAULT 'APPROVAL',
  "revision" INTEGER NOT NULL,
  "supersedesId" TEXT,
  "calculationVersion" INTEGER NOT NULL,
  "factsHash" VARCHAR(64) NOT NULL,
  "rowsHash" VARCHAR(64) NOT NULL,
  "rows" JSONB NOT NULL,
  "approvedByUserId" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL,
  "correctionReason" TEXT,
  "correctionActorUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_timesheet_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_timesheet_approvals_period_check" CHECK ("periodEnd" >= "periodStart" AND "revision" > 0 AND "calculationVersion" > 0),
  CONSTRAINT "workforce_timesheet_approvals_hash_check" CHECK ("factsHash" ~ '^[A-Fa-f0-9]{64}$' AND "rowsHash" ~ '^[A-Fa-f0-9]{64}$'),
  CONSTRAINT "workforce_timesheet_approvals_correction_check" CHECK (
    ("recordKind" = 'APPROVAL' AND "revision" = 1 AND "supersedesId" IS NULL AND "correctionReason" IS NULL AND "correctionActorUserId" IS NULL)
    OR
    ("recordKind" = 'CORRECTION' AND "supersedesId" IS NOT NULL AND NULLIF(btrim("correctionReason"), '') IS NOT NULL AND "correctionActorUserId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "workforce_policies_organizationId_id_key"
  ON "workforce_policies"("organizationId", "id");
-- PostgreSQL treats NULL as distinct in unique indexes, so organization-wide
-- and team-scoped definitions use explicit partial keys rather than an
-- application-controlled scope string.
CREATE UNIQUE INDEX "workforce_policies_org_version_key"
  ON "workforce_policies"("organizationId", "version") WHERE "teamId" IS NULL;
CREATE UNIQUE INDEX "workforce_policies_team_version_key"
  ON "workforce_policies"("organizationId", "teamId", "version") WHERE "teamId" IS NOT NULL;
CREATE INDEX "workforce_policies_team_status_effective_idx"
  ON "workforce_policies"("organizationId", "teamId", "status", "effectiveFrom");
CREATE INDEX "workforce_policies_created_by_idx"
  ON "workforce_policies"("organizationId", "createdByUserId");
CREATE INDEX "workforce_policies_activated_by_idx"
  ON "workforce_policies"("organizationId", "activatedByUserId");
CREATE UNIQUE INDEX "workforce_policies_one_active_org_key"
  ON "workforce_policies"("organizationId") WHERE "status" = 'ACTIVE' AND "teamId" IS NULL;
CREATE UNIQUE INDEX "workforce_policies_one_active_team_key"
  ON "workforce_policies"("organizationId", "teamId") WHERE "status" = 'ACTIVE' AND "teamId" IS NOT NULL;

CREATE UNIQUE INDEX "workforce_shift_templates_organizationId_id_key"
  ON "workforce_shift_templates"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_shift_templates_org_code_version_key"
  ON "workforce_shift_templates"("organizationId", "code", "version") WHERE "teamId" IS NULL;
CREATE UNIQUE INDEX "workforce_shift_templates_team_code_version_key"
  ON "workforce_shift_templates"("organizationId", "teamId", "code", "version") WHERE "teamId" IS NOT NULL;
CREATE INDEX "workforce_shift_templates_team_code_status_idx"
  ON "workforce_shift_templates"("organizationId", "teamId", "code", "status");
CREATE INDEX "workforce_shift_templates_created_by_idx"
  ON "workforce_shift_templates"("organizationId", "createdByUserId");
CREATE INDEX "workforce_shift_templates_activated_by_idx"
  ON "workforce_shift_templates"("organizationId", "activatedByUserId");
CREATE UNIQUE INDEX "workforce_shift_templates_one_active_org_code_key"
  ON "workforce_shift_templates"("organizationId", "code") WHERE "status" = 'ACTIVE' AND "teamId" IS NULL;
CREATE UNIQUE INDEX "workforce_shift_templates_one_active_team_code_key"
  ON "workforce_shift_templates"("organizationId", "teamId", "code") WHERE "status" = 'ACTIVE' AND "teamId" IS NOT NULL;

CREATE UNIQUE INDEX "workforce_shift_assignments_organizationId_id_key"
  ON "workforce_shift_assignments"("organizationId", "id");
CREATE INDEX "workforce_shift_assignments_agent_effective_idx"
  ON "workforce_shift_assignments"("organizationId", "agentId", "effectiveFrom", "effectiveTo");
CREATE INDEX "workforce_shift_assignments_template_effective_idx"
  ON "workforce_shift_assignments"("organizationId", "templateId", "effectiveFrom");
CREATE INDEX "workforce_shift_assignments_assigned_by_idx"
  ON "workforce_shift_assignments"("organizationId", "assignedByUserId");
ALTER TABLE "workforce_shift_assignments"
  ADD CONSTRAINT "workforce_shift_assignments_no_overlap"
  EXCLUDE USING gist (
    "organizationId" WITH =,
    "agentId" WITH =,
    daterange("effectiveFrom", COALESCE("effectiveTo" + 1, 'infinity'::date), '[)') WITH &&
  );

CREATE UNIQUE INDEX "workforce_policy_snapshots_organizationId_id_key"
  ON "workforce_policy_snapshots"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_policy_snapshots_workday_key"
  ON "workforce_policy_snapshots"("organizationId", "workdayId");
CREATE INDEX "workforce_policy_snapshots_agent_date_idx"
  ON "workforce_policy_snapshots"("organizationId", "agentId", "workDate");
CREATE INDEX "workforce_policy_snapshots_policy_version_idx"
  ON "workforce_policy_snapshots"("organizationId", "policyId", "policyVersion");

CREATE UNIQUE INDEX "workforce_shift_snapshots_organizationId_id_key"
  ON "workforce_shift_snapshots"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_shift_snapshots_workday_key"
  ON "workforce_shift_snapshots"("organizationId", "workdayId");
CREATE INDEX "workforce_shift_snapshots_agent_date_idx"
  ON "workforce_shift_snapshots"("organizationId", "agentId", "workDate");
CREATE INDEX "workforce_shift_snapshots_template_version_idx"
  ON "workforce_shift_snapshots"("organizationId", "templateId", "templateVersion");

CREATE UNIQUE INDEX "workforce_attendance_exceptions_workday_type_calculation_key"
  ON "workforce_attendance_exceptions"("organizationId", "workdayId", "type", "calculationVersion");
CREATE INDEX "workforce_attendance_exceptions_agent_status_created_idx"
  ON "workforce_attendance_exceptions"("organizationId", "agentId", "status", "createdAt");
CREATE INDEX "workforce_attendance_exceptions_policy_snapshot_idx"
  ON "workforce_attendance_exceptions"("organizationId", "policySnapshotId");
CREATE INDEX "workforce_attendance_exceptions_shift_snapshot_idx"
  ON "workforce_attendance_exceptions"("organizationId", "shiftSnapshotId");
CREATE INDEX "workforce_attendance_exceptions_resolved_by_idx"
  ON "workforce_attendance_exceptions"("organizationId", "resolvedByUserId");

CREATE UNIQUE INDEX "workforce_time_corrections_organizationId_id_key"
  ON "workforce_time_corrections"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_time_corrections_operation_key"
  ON "workforce_time_corrections"("organizationId", "operationId");
-- PostgreSQL unique indexes treat NULL as distinct, so this permits any number
-- of direct-manager corrections (which have no request) while making a request
-- approval produce exactly one immutable correction fact.
CREATE UNIQUE INDEX "workforce_time_corrections_request_key"
  ON "workforce_time_corrections"("organizationId", "requestId");
CREATE INDEX "workforce_time_corrections_workday_occurred_idx"
  ON "workforce_time_corrections"("organizationId", "workdayId", "occurredAt");
CREATE INDEX "workforce_time_corrections_agent_occurred_idx"
  ON "workforce_time_corrections"("organizationId", "agentId", "occurredAt");
CREATE INDEX "workforce_time_corrections_request_idx"
  ON "workforce_time_corrections"("organizationId", "requestId");
CREATE INDEX "workforce_time_corrections_actor_occurred_idx"
  ON "workforce_time_corrections"("organizationId", "actorUserId", "occurredAt");

CREATE UNIQUE INDEX "workforce_timesheet_approvals_organizationId_id_key"
  ON "workforce_timesheet_approvals"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_timesheet_approvals_revision_key"
  ON "workforce_timesheet_approvals"("organizationId", "agentId", "periodStart", "periodEnd", "revision");
CREATE INDEX "workforce_timesheet_approvals_agent_period_idx"
  ON "workforce_timesheet_approvals"("organizationId", "agentId", "periodStart", "periodEnd");
CREATE UNIQUE INDEX "workforce_timesheet_approvals_organizationId_supersedesId_key"
  ON "workforce_timesheet_approvals"("organizationId", "supersedesId");
CREATE INDEX "workforce_timesheet_approvals_approved_by_idx"
  ON "workforce_timesheet_approvals"("organizationId", "approvedByUserId", "approvedAt");
CREATE INDEX "workforce_timesheet_approvals_correction_actor_idx"
  ON "workforce_timesheet_approvals"("organizationId", "correctionActorUserId", "approvedAt");

ALTER TABLE "workforce_policies"
  ADD CONSTRAINT "workforce_policies_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_policies_team_fkey"
  FOREIGN KEY ("organizationId", "teamId") REFERENCES "mtm_teams"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_policies_created_by_fkey"
  FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_policies_activated_by_fkey"
  FOREIGN KEY ("organizationId", "activatedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workforce_shift_templates"
  ADD CONSTRAINT "workforce_shift_templates_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_templates_team_fkey"
  FOREIGN KEY ("organizationId", "teamId") REFERENCES "mtm_teams"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_templates_created_by_fkey"
  FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_templates_activated_by_fkey"
  FOREIGN KEY ("organizationId", "activatedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workforce_shift_assignments"
  ADD CONSTRAINT "workforce_shift_assignments_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_assignments_agent_fkey"
  FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_assignments_template_fkey"
  FOREIGN KEY ("organizationId", "templateId") REFERENCES "workforce_shift_templates"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_assignments_assigned_by_fkey"
  FOREIGN KEY ("organizationId", "assignedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workforce_policy_snapshots"
  ADD CONSTRAINT "workforce_policy_snapshots_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_policy_snapshots_policy_fkey"
  FOREIGN KEY ("organizationId", "policyId") REFERENCES "workforce_policies"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_policy_snapshots_workday_fkey"
  FOREIGN KEY ("organizationId", "workdayId") REFERENCES "mtm_agent_workdays"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_policy_snapshots_agent_fkey"
  FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workforce_shift_snapshots"
  ADD CONSTRAINT "workforce_shift_snapshots_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_snapshots_template_fkey"
  FOREIGN KEY ("organizationId", "templateId") REFERENCES "workforce_shift_templates"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_snapshots_assignment_fkey"
  FOREIGN KEY ("organizationId", "assignmentId") REFERENCES "workforce_shift_assignments"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_snapshots_workday_fkey"
  FOREIGN KEY ("organizationId", "workdayId") REFERENCES "mtm_agent_workdays"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_shift_snapshots_agent_fkey"
  FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workforce_attendance_exceptions"
  ADD CONSTRAINT "workforce_attendance_exceptions_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_exceptions_workday_fkey"
  FOREIGN KEY ("organizationId", "workdayId") REFERENCES "mtm_agent_workdays"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_exceptions_agent_fkey"
  FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_exceptions_policy_snapshot_fkey"
  FOREIGN KEY ("organizationId", "policySnapshotId") REFERENCES "workforce_policy_snapshots"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_exceptions_shift_snapshot_fkey"
  FOREIGN KEY ("organizationId", "shiftSnapshotId") REFERENCES "workforce_shift_snapshots"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_attendance_exceptions_resolved_by_fkey"
  FOREIGN KEY ("organizationId", "resolvedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workforce_time_corrections"
  ADD CONSTRAINT "workforce_time_corrections_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_time_corrections_workday_fkey"
  FOREIGN KEY ("organizationId", "workdayId") REFERENCES "mtm_agent_workdays"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_time_corrections_agent_fkey"
  FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_time_corrections_request_fkey"
  FOREIGN KEY ("organizationId", "requestId") REFERENCES "mtm_hrm_requests"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_time_corrections_actor_fkey"
  FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workforce_timesheet_approvals"
  ADD CONSTRAINT "workforce_timesheet_approvals_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_timesheet_approvals_agent_fkey"
  FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_timesheet_approvals_supersedes_fkey"
  FOREIGN KEY ("organizationId", "supersedesId") REFERENCES "workforce_timesheet_approvals"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_timesheet_approvals_approved_by_fkey"
  FOREIGN KEY ("organizationId", "approvedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_timesheet_approvals_correction_actor_fkey"
  FOREIGN KEY ("organizationId", "correctionActorUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A tenant-scoped FK alone cannot prove that several referenced rows describe
-- the same agent, workday and date. These INSERT-time checks make historical
-- facts coherent before append-only protection makes them immutable.
CREATE OR REPLACE FUNCTION workforce_validate_h3_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  workday_row RECORD;
  policy_row RECORD;
  template_row RECORD;
  assignment_row RECORD;
  policy_snapshot_row RECORD;
  shift_snapshot_row RECORD;
  request_row RECORD;
  parent_approval_row RECORD;
BEGIN
  IF TG_TABLE_NAME = 'workforce_policy_snapshots' THEN
    SELECT * INTO workday_row
    FROM "mtm_agent_workdays"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workforce policy snapshot workday is missing' USING ERRCODE = '23514';
    END IF;
    IF workday_row."agentId" <> NEW."agentId" OR workday_row."workDate" <> NEW."workDate" THEN
      RAISE EXCEPTION 'Workforce policy snapshot must match its workday agent and date' USING ERRCODE = '23514';
    END IF;

    SELECT * INTO policy_row
    FROM "workforce_policies"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."policyId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workforce policy snapshot policy is missing' USING ERRCODE = '23514';
    END IF;
    -- A delayed offline sync may snapshot a workday which began while this
    -- definition was active and was retired later. Drafts are never eligible;
    -- a retired definition is eligible only for that historical workday.
    IF policy_row."status" = 'DRAFT'::"WorkforceDefinitionStatus"
      OR (
        policy_row."status" = 'RETIRED'::"WorkforceDefinitionStatus"
        AND (policy_row."retiredAt" IS NULL OR workday_row."startedAt" > policy_row."retiredAt")
      )
      OR workday_row."startedAt" < policy_row."activatedAt"
      OR policy_row."version" <> NEW."policyVersion"
      OR policy_row."definitionHash" <> NEW."definitionHash"
      OR policy_row."definition" IS DISTINCT FROM NEW."definition"
      OR policy_row."effectiveFrom" > NEW."workDate"
      OR (policy_row."effectiveTo" IS NOT NULL AND policy_row."effectiveTo" < NEW."workDate") THEN
      RAISE EXCEPTION 'Workforce policy snapshot must preserve its applicable policy version and definition' USING ERRCODE = '23514';
    END IF;

    -- The canonical workday has no historical team snapshot. Do not infer a
    -- team policy from the employee's current team after an offline replay or
    -- transfer; a future owner-approved team-history rule must unlock it.
    IF policy_row."teamId" IS NOT NULL THEN
      RAISE EXCEPTION 'Team-scoped Workforce policy resolution requires an explicit historical team rule' USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'workforce_shift_snapshots' THEN
    SELECT * INTO workday_row
    FROM "mtm_agent_workdays"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workforce shift snapshot workday is missing' USING ERRCODE = '23514';
    END IF;
    IF workday_row."agentId" <> NEW."agentId" OR workday_row."workDate" <> NEW."workDate" THEN
      RAISE EXCEPTION 'Workforce shift snapshot must match its workday agent and date' USING ERRCODE = '23514';
    END IF;

    SELECT * INTO template_row
    FROM "workforce_shift_templates"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."templateId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workforce shift snapshot template is missing' USING ERRCODE = '23514';
    END IF;
    IF template_row."status" = 'DRAFT'::"WorkforceDefinitionStatus"
      OR (
        template_row."status" = 'RETIRED'::"WorkforceDefinitionStatus"
        AND (template_row."retiredAt" IS NULL OR workday_row."startedAt" > template_row."retiredAt")
      )
      OR workday_row."startedAt" < template_row."activatedAt"
      OR template_row."version" <> NEW."templateVersion"
      OR template_row."timezone" <> NEW."timezone"
      OR template_row."definitionHash" <> NEW."definitionHash"
      OR template_row."definition" IS DISTINCT FROM NEW."definition" THEN
      RAISE EXCEPTION 'Workforce shift snapshot must preserve its template version and definition' USING ERRCODE = '23514';
    END IF;

    -- An explicit assignment freezes the agent/template pair at assignment
    -- time. A default team template has no historical team source, so it is
    -- deliberately blocked until the owner chooses transfer semantics.
    IF template_row."teamId" IS NOT NULL AND NEW."assignmentId" IS NULL THEN
      RAISE EXCEPTION 'Team-scoped default Workforce shift resolution requires an explicit historical team rule' USING ERRCODE = '23514';
    END IF;

    IF NEW."assignmentId" IS NOT NULL THEN
      SELECT * INTO assignment_row
      FROM "workforce_shift_assignments"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."assignmentId";
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Workforce shift snapshot assignment is missing' USING ERRCODE = '23514';
      END IF;
      IF assignment_row."agentId" <> NEW."agentId"
        OR assignment_row."templateId" <> NEW."templateId"
        OR assignment_row."effectiveFrom" > NEW."workDate"
        OR (assignment_row."effectiveTo" IS NOT NULL AND assignment_row."effectiveTo" < NEW."workDate") THEN
        RAISE EXCEPTION 'Workforce shift snapshot assignment must cover its agent, template and work date' USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'workforce_attendance_exceptions' THEN
    SELECT * INTO workday_row
    FROM "mtm_agent_workdays"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workforce attendance exception workday is missing' USING ERRCODE = '23514';
    END IF;
    IF workday_row."agentId" <> NEW."agentId" THEN
      RAISE EXCEPTION 'Workforce attendance exception must match its workday agent' USING ERRCODE = '23514';
    END IF;

    SELECT * INTO policy_snapshot_row
    FROM "workforce_policy_snapshots"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."policySnapshotId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workforce attendance exception policy snapshot is missing' USING ERRCODE = '23514';
    END IF;
    IF policy_snapshot_row."workdayId" <> NEW."workdayId" OR policy_snapshot_row."agentId" <> NEW."agentId" THEN
      RAISE EXCEPTION 'Workforce attendance exception policy snapshot must match its workday and agent' USING ERRCODE = '23514';
    END IF;

    SELECT * INTO shift_snapshot_row
    FROM "workforce_shift_snapshots"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."shiftSnapshotId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workforce attendance exception shift snapshot is missing' USING ERRCODE = '23514';
    END IF;
    IF shift_snapshot_row."workdayId" <> NEW."workdayId" OR shift_snapshot_row."agentId" <> NEW."agentId" THEN
      RAISE EXCEPTION 'Workforce attendance exception shift snapshot must match its workday and agent' USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'workforce_time_corrections' THEN
    SELECT * INTO workday_row
    FROM "mtm_agent_workdays"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workforce correction workday is missing' USING ERRCODE = '23514';
    END IF;
    IF workday_row."agentId" <> NEW."agentId" THEN
      RAISE EXCEPTION 'Workforce correction must match its workday agent' USING ERRCODE = '23514';
    END IF;

    IF NEW."source" = 'REQUEST_APPROVAL'::"WorkforceTimeCorrectionSource" THEN
      SELECT * INTO request_row
      FROM "mtm_hrm_requests"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."requestId";
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Workforce correction request is missing' USING ERRCODE = '23514';
      END IF;
      IF request_row."type" <> 'TIME_CORRECTION'::"MtmHrmRequestType"
        OR request_row."status" <> 'APPROVED'::"MtmHrmRequestStatus"
        OR request_row."agentId" <> NEW."agentId"
        OR request_row."correctionWorkdayId" IS DISTINCT FROM NEW."workdayId" THEN
        RAISE EXCEPTION 'Workforce request correction must use an approved matching time-correction request' USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'workforce_timesheet_approvals' THEN
    IF NEW."recordKind" = 'CORRECTION'::"WorkforceTimesheetRecordKind" THEN
      SELECT * INTO parent_approval_row
      FROM "workforce_timesheet_approvals"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."supersedesId";
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Workforce timesheet correction parent is missing' USING ERRCODE = '23514';
      END IF;
      IF parent_approval_row."agentId" <> NEW."agentId"
        OR parent_approval_row."periodStart" <> NEW."periodStart"
        OR parent_approval_row."periodEnd" <> NEW."periodEnd"
        OR NEW."revision" <> parent_approval_row."revision" + 1 THEN
        RAISE EXCEPTION 'Workforce timesheet correction must be the next revision of the same agent and period' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_policy_snapshots_validate_insert
  BEFORE INSERT ON "workforce_policy_snapshots"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_h3_insert();
CREATE TRIGGER workforce_shift_snapshots_validate_insert
  BEFORE INSERT ON "workforce_shift_snapshots"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_h3_insert();
CREATE TRIGGER workforce_attendance_exceptions_validate_insert
  BEFORE INSERT ON "workforce_attendance_exceptions"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_h3_insert();
CREATE TRIGGER workforce_time_corrections_validate_insert
  BEFORE INSERT ON "workforce_time_corrections"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_h3_insert();
CREATE TRIGGER workforce_timesheet_approvals_validate_insert
  BEFORE INSERT ON "workforce_timesheet_approvals"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_h3_insert();

-- An assignment may be amended before it produces a fact. Once an immutable
-- shift snapshot points to it, its identity and date range must stay intact.
-- The same guard prevents a team-scoped template from being assigned outside
-- that employee's tenant-local team.
CREATE OR REPLACE FUNCTION workforce_guard_shift_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  agent_team_id TEXT;
  template_team_id TEXT;
BEGIN
  SELECT "teamId" INTO agent_team_id
  FROM "mtm_agents"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."agentId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce shift assignment agent is missing' USING ERRCODE = '23514';
  END IF;

  SELECT "teamId" INTO template_team_id
  FROM "workforce_shift_templates"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."templateId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce shift assignment template is missing' USING ERRCODE = '23514';
  END IF;
  IF template_team_id IS NOT NULL AND agent_team_id IS DISTINCT FROM template_team_id THEN
    RAISE EXCEPTION 'Workforce shift assignment template team must match its agent' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (
       NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."agentId" IS DISTINCT FROM OLD."agentId"
       OR NEW."templateId" IS DISTINCT FROM OLD."templateId"
       OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
       OR NEW."effectiveTo" IS DISTINCT FROM OLD."effectiveTo"
       OR NEW."assignedByUserId" IS DISTINCT FROM OLD."assignedByUserId"
     )
     AND EXISTS (
       SELECT 1
       FROM "workforce_shift_snapshots"
       WHERE "organizationId" = OLD."organizationId" AND "assignmentId" = OLD."id"
     ) THEN
    RAISE EXCEPTION 'Workforce shift assignment facts are immutable after a snapshot is created' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_shift_assignments_guard
  BEFORE INSERT OR UPDATE ON "workforce_shift_assignments"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_shift_assignment();

-- Calculation inputs are immutable. Only a monotonic acknowledgement/resolution
-- can update an exception; a correction produces a new calculation fact rather
-- than rewriting the prior deviation.
CREATE OR REPLACE FUNCTION workforce_guard_attendance_exception_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_status TEXT := OLD."status"::text;
  new_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workforce attendance exception facts cannot be deleted' USING ERRCODE = '55000';
  END IF;

  new_status := NEW."status"::text;

  IF old_status = 'RESOLVED'
     AND (to_jsonb(NEW) - ARRAY['updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updatedAt']) THEN
    RAISE EXCEPTION 'Resolved Workforce attendance exception is immutable' USING ERRCODE = '55000';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['status', 'resolutionNote', 'resolvedByUserId', 'resolvedAt', 'updatedAt'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'resolutionNote', 'resolvedByUserId', 'resolvedAt', 'updatedAt']) THEN
    RAISE EXCEPTION 'Workforce attendance exception calculation facts are immutable' USING ERRCODE = '55000';
  END IF;

  IF old_status = 'OPEN' AND new_status NOT IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED') THEN
    RAISE EXCEPTION 'invalid Workforce attendance exception transition % -> %', old_status, new_status USING ERRCODE = '23514';
  ELSIF old_status = 'ACKNOWLEDGED' AND new_status NOT IN ('ACKNOWLEDGED', 'RESOLVED') THEN
    RAISE EXCEPTION 'invalid Workforce attendance exception transition % -> %', old_status, new_status USING ERRCODE = '23514';
  ELSIF old_status = 'RESOLVED' AND new_status <> 'RESOLVED' THEN
    RAISE EXCEPTION 'resolved Workforce attendance exception cannot transition to %', new_status USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_attendance_exceptions_update_guard
  BEFORE UPDATE OR DELETE ON "workforce_attendance_exceptions"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_attendance_exception_update();

-- A policy/template draft may be edited freely. Once published, its content
-- becomes a versioned source for immutable snapshots and can only transition
-- ACTIVE -> RETIRED; a changed rule must be a new DRAFT version.
CREATE OR REPLACE FUNCTION workforce_guard_published_definition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_status TEXT := OLD."status"::text;
  new_status TEXT := NEW."status"::text;
  allowed_keys TEXT[];
BEGIN
  allowed_keys := CASE old_status
    WHEN 'ACTIVE' THEN ARRAY['status', 'retiredAt', 'updatedAt']
    WHEN 'RETIRED' THEN ARRAY['updatedAt']
    ELSE ARRAY[]::TEXT[]
  END;

  IF old_status <> 'DRAFT'
     AND (to_jsonb(NEW) - allowed_keys) IS DISTINCT FROM (to_jsonb(OLD) - allowed_keys) THEN
    RAISE EXCEPTION '% published definition content is immutable; create a new draft version', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  IF old_status = 'DRAFT' AND new_status NOT IN ('DRAFT', 'ACTIVE') THEN
    RAISE EXCEPTION 'invalid Workforce definition transition % -> %', old_status, new_status USING ERRCODE = '23514';
  ELSIF old_status = 'ACTIVE' AND new_status NOT IN ('ACTIVE', 'RETIRED') THEN
    RAISE EXCEPTION 'invalid Workforce definition transition % -> %', old_status, new_status USING ERRCODE = '23514';
  ELSIF old_status = 'RETIRED' AND new_status <> 'RETIRED' THEN
    RAISE EXCEPTION 'retired Workforce definition cannot transition to %', new_status USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION workforce_guard_published_definition_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION '% published definition cannot be deleted; retire it instead', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER workforce_policies_published_definition_guard
  BEFORE UPDATE ON "workforce_policies"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_published_definition();
CREATE TRIGGER workforce_shift_templates_published_definition_guard
  BEFORE UPDATE ON "workforce_shift_templates"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_published_definition();
CREATE TRIGGER workforce_policies_published_definition_delete_guard
  BEFORE DELETE ON "workforce_policies"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_published_definition_delete();
CREATE TRIGGER workforce_shift_templates_published_definition_delete_guard
  BEFORE DELETE ON "workforce_shift_templates"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_published_definition_delete();

-- Tenant data ships fail-closed. Migration/bootstrap work needs the explicit
-- bypass context; normal request code must set app.org_id. Mutable operational
-- rows retain regular tenant CRUD, while immutable facts receive only SELECT
-- and INSERT policies. Retention deletion stays disabled until a legal/contract
-- hold and audited approval model exists.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'workforce_policies',
    'workforce_shift_templates',
    'workforce_shift_assignments'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'') WITH CHECK ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')',
      table_name || '_tenant_isolation',
      table_name
    );
  END LOOP;

  -- Exception calculation facts are protected by a trigger too, but omit a
  -- DELETE policy as defense in depth while preserving resolution updates.
  FOREACH table_name IN ARRAY ARRAY['workforce_attendance_exceptions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')',
      table_name || '_tenant_select',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')',
      table_name || '_tenant_insert',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'') WITH CHECK ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')',
      table_name || '_tenant_update',
      table_name
    );
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'workforce_policy_snapshots',
    'workforce_shift_snapshots',
    'workforce_time_corrections',
    'workforce_timesheet_approvals'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')',
      table_name || '_tenant_select',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')',
      table_name || '_tenant_insert',
      table_name
    );
  END LOOP;
END $$;

-- Approved periods, policy/shift snapshots and correction facts are append
-- only. A future retention worker needs a separately approved legal/contract
-- hold and audit model; ordinary application code cannot revise or delete
-- history.
CREATE OR REPLACE FUNCTION workforce_reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce immutable records cannot be %', TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_policy_snapshots_append_only
  BEFORE UPDATE OR DELETE ON "workforce_policy_snapshots"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_immutable_mutation();
CREATE TRIGGER workforce_shift_snapshots_append_only
  BEFORE UPDATE OR DELETE ON "workforce_shift_snapshots"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_immutable_mutation();
CREATE TRIGGER workforce_time_corrections_append_only
  BEFORE UPDATE OR DELETE ON "workforce_time_corrections"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_immutable_mutation();
CREATE TRIGGER workforce_timesheet_approvals_append_only
  BEFORE UPDATE OR DELETE ON "workforce_timesheet_approvals"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_immutable_mutation();

-- A migration runner may own new tables while the established LeadDrive
-- application role owns mtm_agents. Grant only the operations which the RLS
-- policies and immutability guards permit for each table class.
DO $$
DECLARE
  app_owner TEXT;
  table_name TEXT;
BEGIN
  SELECT tableowner INTO app_owner
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'mtm_agents';

  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    FOREACH table_name IN ARRAY ARRAY[
      'workforce_policies',
      'workforce_shift_templates',
      'workforce_shift_assignments'
    ] LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO %I', table_name, app_owner);
    END LOOP;

    FOREACH table_name IN ARRAY ARRAY['workforce_attendance_exceptions']
    LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO %I', table_name, app_owner);
    END LOOP;

    FOREACH table_name IN ARRAY ARRAY[
      'workforce_policy_snapshots',
      'workforce_shift_snapshots',
      'workforce_time_corrections',
      'workforce_timesheet_approvals'
    ] LOOP
      EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO %I', table_name, app_owner);
    END LOOP;
  END IF;
END $$;
