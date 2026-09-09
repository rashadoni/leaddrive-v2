-- MTM Routes Phase 1 foundation. All changes are additive: legacy route/visit
-- agentId columns remain authoritative primary-owner fields during migration.

ALTER TYPE "MtmRouteStatus" ADD VALUE IF NOT EXISTS 'DRAFT' BEFORE 'PLANNED';

CREATE TYPE "MtmRouteAssignmentRole" AS ENUM ('PRIMARY', 'PARTICIPANT', 'OBSERVER');
CREATE TYPE "MtmVisitActionKey" AS ENUM ('PHOTO', 'PRESENTATION', 'STOCK_CHECK', 'VISIT_NOTE', 'CHECKLIST', 'FEEDBACK', 'NEXT_ACTION');
CREATE TYPE "MtmRequirementMode" AS ENUM ('REQUIRED', 'OPTIONAL', 'HIDDEN');
CREATE TYPE "MtmVisitActionStatus" AS ENUM ('PENDING', 'COMPLETED', 'WAIVED');
CREATE TYPE "MtmApprovalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "MtmRouteChangeType" AS ENUM ('REMOVE_STOP', 'CONFLICT_OVERRIDE');
CREATE TYPE "MtmCustomerObjectType" AS ENUM ('PHARMACY', 'CLINIC', 'DOCTOR', 'STORE', 'OTHER');
CREATE TYPE "MtmVisitOutcome" AS ENUM ('SUCCESSFUL', 'PARTIAL', 'NO_CONTACT', 'RESCHEDULE');
CREATE TYPE "MtmVisitPotential" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');
CREATE TYPE "MtmImportType" AS ENUM ('CUSTOMERS', 'ROUTES', 'SALES_FACTS', 'VISIT_RESULTS', 'PLAN_FACT');
CREATE TYPE "MtmImportStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'READY', 'APPLYING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'ROLLED_BACK');
CREATE TYPE "MtmExternalDocumentStatus" AS ENUM ('IMPORTED', 'CONFIRMED', 'CANCELLED');

ALTER TABLE "mtm_customers"
  ADD COLUMN "objectType" "MtmCustomerObjectType" NOT NULL DEFAULT 'STORE';

ALTER TABLE "mtm_routes"
  ADD COLUMN "dedupeKey" TEXT,
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "publishedBy" TEXT;

ALTER TABLE "mtm_visits"
  ADD COLUMN "nextActionDueAt" TIMESTAMP(3),
  ADD COLUMN "outcome" "MtmVisitOutcome",
  ADD COLUMN "potential" "MtmVisitPotential",
  ADD COLUMN "resultNotes" TEXT,
  ADD COLUMN "routeId" TEXT,
  ADD COLUMN "routePointId" TEXT;

CREATE TABLE "mtm_route_assignments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "routeId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "role" "MtmRouteAssignmentRole" NOT NULL DEFAULT 'PARTICIPANT',
  "assignedBy" TEXT,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_route_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_visit_participants" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "role" "MtmRouteAssignmentRole" NOT NULL DEFAULT 'PARTICIPANT',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_visit_participants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_visit_policies" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "teamId" TEXT,
  "name" TEXT NOT NULL,
  "visitType" TEXT NOT NULL DEFAULT 'DEFAULT',
  "priority" INTEGER NOT NULL DEFAULT 100,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_visit_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_visit_policies_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")
);

CREATE TABLE "mtm_visit_policy_actions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "actionKey" "MtmVisitActionKey" NOT NULL,
  "mode" "MtmRequirementMode" NOT NULL DEFAULT 'OPTIONAL',
  "minCount" INTEGER NOT NULL DEFAULT 1,
  "conditions" JSONB,
  "allowWaiver" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_visit_policy_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_visit_policy_actions_min_count_check" CHECK ("minCount" >= 0)
);

CREATE TABLE "mtm_visit_requirement_snapshots" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "sourcePolicyId" TEXT,
  "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_visit_requirement_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_visit_requirements" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "actionKey" "MtmVisitActionKey" NOT NULL,
  "mode" "MtmRequirementMode" NOT NULL,
  "minCount" INTEGER NOT NULL DEFAULT 1,
  "conditions" JSONB,
  "allowWaiver" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_visit_requirements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_visit_requirements_min_count_check" CHECK ("minCount" >= 0)
);

CREATE TABLE "mtm_visit_action_results" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "requirementId" TEXT,
  "actionKey" "MtmVisitActionKey" NOT NULL,
  "status" "MtmVisitActionStatus" NOT NULL DEFAULT 'COMPLETED',
  "evidence" JSONB,
  "completedByAgentId" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_visit_action_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_route_change_requests" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "routeId" TEXT NOT NULL,
  "routePointId" TEXT,
  "requestedByAgentId" TEXT NOT NULL,
  "changeType" "MtmRouteChangeType" NOT NULL,
  "status" "MtmApprovalStatus" NOT NULL DEFAULT 'SUBMITTED',
  "reason" TEXT NOT NULL,
  "payload" JSONB,
  "reviewedBy" TEXT,
  "decisionComment" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_route_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_customer_create_requests" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "requestedByAgentId" TEXT NOT NULL,
  "routeId" TEXT,
  "approvedCustomerId" TEXT,
  "status" "MtmApprovalStatus" NOT NULL DEFAULT 'DRAFT',
  "objectType" "MtmCustomerObjectType" NOT NULL,
  "externalCode" TEXT,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "city" TEXT,
  "district" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "contactPerson" TEXT,
  "phone" TEXT,
  "category" "MtmCustomerCategory",
  "potential" "MtmVisitPotential" NOT NULL DEFAULT 'UNKNOWN',
  "territoryCode" TEXT,
  "photoUrl" TEXT,
  "reason" TEXT NOT NULL,
  "agentComment" TEXT,
  "reviewedBy" TEXT,
  "decisionComment" TEXT,
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_customer_create_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_customer_requests_latitude_check" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
  CONSTRAINT "mtm_customer_requests_longitude_check" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180)
);

CREATE TABLE "mtm_import_jobs" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "type" "MtmImportType" NOT NULL,
  "status" "MtmImportStatus" NOT NULL DEFAULT 'UPLOADED',
  "templateVersion" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "fileChecksum" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "storageKey" TEXT,
  "errorFileKey" TEXT,
  "requestedBy" TEXT NOT NULL,
  "applyMode" TEXT NOT NULL DEFAULT 'STRICT',
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "createRows" INTEGER NOT NULL DEFAULT 0,
  "updateRows" INTEGER NOT NULL DEFAULT 0,
  "unchangedRows" INTEGER NOT NULL DEFAULT 0,
  "skippedRows" INTEGER NOT NULL DEFAULT 0,
  "errorRows" INTEGER NOT NULL DEFAULT 0,
  "validatedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "rollbackRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_import_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_import_jobs_size_check" CHECK ("fileSize" >= 0 AND "fileSize" <= 20971520),
  CONSTRAINT "mtm_import_jobs_counts_check" CHECK (
    "totalRows" >= 0 AND "createRows" >= 0 AND "updateRows" >= 0 AND
    "unchangedRows" >= 0 AND "skippedRows" >= 0 AND "errorRows" >= 0
  )
);

CREATE TABLE "mtm_import_row_errors" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "sheetName" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "columnName" TEXT,
  "errorCode" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "rawValue" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_import_row_errors_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_import_row_errors_row_check" CHECK ("rowNumber" > 0)
);

CREATE TABLE "mtm_external_sales_documents" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "externalDocumentNo" TEXT NOT NULL,
  "documentDate" DATE NOT NULL,
  "customerId" TEXT NOT NULL,
  "agentId" TEXT,
  "status" "MtmExternalDocumentStatus" NOT NULL DEFAULT 'IMPORTED',
  "currency" TEXT NOT NULL DEFAULT 'AZN',
  "totalAmount" DECIMAL(18,4),
  "sourceImportJobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_external_sales_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_external_sales_documents_amount_check" CHECK ("totalAmount" IS NULL OR "totalAmount" >= 0)
);

CREATE TABLE "mtm_external_sales_lines" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "productCode" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL,
  "unit" TEXT,
  "amount" DECIMAL(18,4),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_external_sales_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_external_sales_lines_values_check" CHECK (
    "lineNumber" > 0 AND "quantity" >= 0 AND ("amount" IS NULL OR "amount" >= 0)
  )
);

CREATE INDEX "mtm_route_assignments_organizationId_agentId_removedAt_idx" ON "mtm_route_assignments"("organizationId", "agentId", "removedAt");
CREATE INDEX "mtm_route_assignments_routeId_role_idx" ON "mtm_route_assignments"("routeId", "role");
CREATE UNIQUE INDEX "mtm_route_assignments_routeId_agentId_key" ON "mtm_route_assignments"("routeId", "agentId");
CREATE UNIQUE INDEX "mtm_route_assignments_one_primary_idx" ON "mtm_route_assignments"("routeId") WHERE "role" = 'PRIMARY' AND "removedAt" IS NULL;

CREATE INDEX "mtm_visit_participants_organizationId_agentId_idx" ON "mtm_visit_participants"("organizationId", "agentId");
CREATE INDEX "mtm_visit_participants_visitId_role_idx" ON "mtm_visit_participants"("visitId", "role");
CREATE UNIQUE INDEX "mtm_visit_participants_visitId_agentId_key" ON "mtm_visit_participants"("visitId", "agentId");
CREATE UNIQUE INDEX "mtm_visit_participants_one_primary_idx" ON "mtm_visit_participants"("visitId") WHERE "role" = 'PRIMARY' AND "leftAt" IS NULL;

CREATE INDEX "mtm_visit_policies_organizationId_teamId_visitType_isActive_idx" ON "mtm_visit_policies"("organizationId", "teamId", "visitType", "isActive");
CREATE INDEX "mtm_visit_policies_organizationId_effectiveFrom_effectiveTo_idx" ON "mtm_visit_policies"("organizationId", "effectiveFrom", "effectiveTo");
CREATE INDEX "mtm_visit_policy_actions_organizationId_actionKey_idx" ON "mtm_visit_policy_actions"("organizationId", "actionKey");
CREATE UNIQUE INDEX "mtm_visit_policy_actions_policyId_actionKey_key" ON "mtm_visit_policy_actions"("policyId", "actionKey");
CREATE UNIQUE INDEX "mtm_visit_requirement_snapshots_visitId_key" ON "mtm_visit_requirement_snapshots"("visitId");
CREATE INDEX "mtm_visit_requirement_snapshots_organizationId_resolvedAt_idx" ON "mtm_visit_requirement_snapshots"("organizationId", "resolvedAt");
CREATE INDEX "mtm_visit_requirements_organizationId_actionKey_idx" ON "mtm_visit_requirements"("organizationId", "actionKey");
CREATE UNIQUE INDEX "mtm_visit_requirements_snapshotId_actionKey_key" ON "mtm_visit_requirements"("snapshotId", "actionKey");
CREATE INDEX "mtm_visit_action_results_organizationId_visitId_actionKey_idx" ON "mtm_visit_action_results"("organizationId", "visitId", "actionKey");
CREATE INDEX "mtm_visit_action_results_requirementId_idx" ON "mtm_visit_action_results"("requirementId");
CREATE INDEX "mtm_visit_action_results_completedByAgentId_idx" ON "mtm_visit_action_results"("completedByAgentId");
CREATE INDEX "mtm_route_change_requests_organizationId_status_submittedAt_idx" ON "mtm_route_change_requests"("organizationId", "status", "submittedAt");
CREATE INDEX "mtm_route_change_requests_routeId_status_idx" ON "mtm_route_change_requests"("routeId", "status");
CREATE INDEX "mtm_route_change_requests_routePointId_idx" ON "mtm_route_change_requests"("routePointId");
CREATE INDEX "mtm_route_change_requests_requestedByAgentId_idx" ON "mtm_route_change_requests"("requestedByAgentId");
CREATE INDEX "mtm_customer_create_requests_organizationId_status_createdA_idx" ON "mtm_customer_create_requests"("organizationId", "status", "createdAt");
CREATE INDEX "mtm_customer_create_requests_requestedByAgentId_idx" ON "mtm_customer_create_requests"("requestedByAgentId");
CREATE INDEX "mtm_customer_create_requests_routeId_idx" ON "mtm_customer_create_requests"("routeId");
CREATE INDEX "mtm_customer_create_requests_approvedCustomerId_idx" ON "mtm_customer_create_requests"("approvedCustomerId");
CREATE INDEX "mtm_import_jobs_organizationId_status_createdAt_idx" ON "mtm_import_jobs"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "mtm_import_jobs_organizationId_type_fileChecksum_key" ON "mtm_import_jobs"("organizationId", "type", "fileChecksum");
CREATE INDEX "mtm_import_row_errors_organizationId_jobId_rowNumber_idx" ON "mtm_import_row_errors"("organizationId", "jobId", "rowNumber");
CREATE INDEX "mtm_external_sales_documents_organizationId_customerId_docu_idx" ON "mtm_external_sales_documents"("organizationId", "customerId", "documentDate");
CREATE INDEX "mtm_external_sales_documents_organizationId_agentId_documen_idx" ON "mtm_external_sales_documents"("organizationId", "agentId", "documentDate");
CREATE INDEX "mtm_external_sales_documents_sourceImportJobId_idx" ON "mtm_external_sales_documents"("sourceImportJobId");
CREATE UNIQUE INDEX "mtm_external_sales_documents_organizationId_externalDocumen_key" ON "mtm_external_sales_documents"("organizationId", "externalDocumentNo", "documentDate");
CREATE INDEX "mtm_external_sales_lines_organizationId_productCode_idx" ON "mtm_external_sales_lines"("organizationId", "productCode");
CREATE UNIQUE INDEX "mtm_external_sales_lines_documentId_lineNumber_key" ON "mtm_external_sales_lines"("documentId", "lineNumber");
CREATE INDEX "mtm_routes_organizationId_dedupeKey_idx" ON "mtm_routes"("organizationId", "dedupeKey");
CREATE UNIQUE INDEX "mtm_routes_active_dedupe_key" ON "mtm_routes"("organizationId", "dedupeKey") WHERE "dedupeKey" IS NOT NULL AND "deletedAt" IS NULL;
CREATE INDEX "mtm_visits_routeId_idx" ON "mtm_visits"("routeId");
CREATE INDEX "mtm_visits_routePointId_idx" ON "mtm_visits"("routePointId");

ALTER TABLE "mtm_visits" ADD CONSTRAINT "mtm_visits_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "mtm_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mtm_visits" ADD CONSTRAINT "mtm_visits_routePointId_fkey" FOREIGN KEY ("routePointId") REFERENCES "mtm_route_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mtm_route_assignments" ADD CONSTRAINT "mtm_route_assignments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_route_assignments" ADD CONSTRAINT "mtm_route_assignments_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "mtm_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_route_assignments" ADD CONSTRAINT "mtm_route_assignments_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_visit_participants" ADD CONSTRAINT "mtm_visit_participants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_visit_participants" ADD CONSTRAINT "mtm_visit_participants_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "mtm_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_visit_participants" ADD CONSTRAINT "mtm_visit_participants_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_visit_policies" ADD CONSTRAINT "mtm_visit_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_visit_policies" ADD CONSTRAINT "mtm_visit_policies_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "mtm_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_visit_policy_actions" ADD CONSTRAINT "mtm_visit_policy_actions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_visit_policy_actions" ADD CONSTRAINT "mtm_visit_policy_actions_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "mtm_visit_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_visit_requirement_snapshots" ADD CONSTRAINT "mtm_visit_requirement_snapshots_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_visit_requirement_snapshots" ADD CONSTRAINT "mtm_visit_requirement_snapshots_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "mtm_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_visit_requirement_snapshots" ADD CONSTRAINT "mtm_visit_requirement_snapshots_sourcePolicyId_fkey" FOREIGN KEY ("sourcePolicyId") REFERENCES "mtm_visit_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mtm_visit_requirements" ADD CONSTRAINT "mtm_visit_requirements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_visit_requirements" ADD CONSTRAINT "mtm_visit_requirements_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "mtm_visit_requirement_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_visit_action_results" ADD CONSTRAINT "mtm_visit_action_results_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_visit_action_results" ADD CONSTRAINT "mtm_visit_action_results_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "mtm_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_visit_action_results" ADD CONSTRAINT "mtm_visit_action_results_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "mtm_visit_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mtm_visit_action_results" ADD CONSTRAINT "mtm_visit_action_results_completedByAgentId_fkey" FOREIGN KEY ("completedByAgentId") REFERENCES "mtm_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mtm_route_change_requests" ADD CONSTRAINT "mtm_route_change_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_route_change_requests" ADD CONSTRAINT "mtm_route_change_requests_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "mtm_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_route_change_requests" ADD CONSTRAINT "mtm_route_change_requests_routePointId_fkey" FOREIGN KEY ("routePointId") REFERENCES "mtm_route_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mtm_route_change_requests" ADD CONSTRAINT "mtm_route_change_requests_requestedByAgentId_fkey" FOREIGN KEY ("requestedByAgentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_customer_create_requests" ADD CONSTRAINT "mtm_customer_create_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_customer_create_requests" ADD CONSTRAINT "mtm_customer_create_requests_requestedByAgentId_fkey" FOREIGN KEY ("requestedByAgentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_customer_create_requests" ADD CONSTRAINT "mtm_customer_create_requests_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "mtm_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mtm_customer_create_requests" ADD CONSTRAINT "mtm_customer_create_requests_approvedCustomerId_fkey" FOREIGN KEY ("approvedCustomerId") REFERENCES "mtm_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mtm_import_jobs" ADD CONSTRAINT "mtm_import_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_import_row_errors" ADD CONSTRAINT "mtm_import_row_errors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_import_row_errors" ADD CONSTRAINT "mtm_import_row_errors_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "mtm_import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_external_sales_documents" ADD CONSTRAINT "mtm_external_sales_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_external_sales_documents" ADD CONSTRAINT "mtm_external_sales_documents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "mtm_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_external_sales_documents" ADD CONSTRAINT "mtm_external_sales_documents_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mtm_external_sales_documents" ADD CONSTRAINT "mtm_external_sales_documents_sourceImportJobId_fkey" FOREIGN KEY ("sourceImportJobId") REFERENCES "mtm_import_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mtm_external_sales_lines" ADD CONSTRAINT "mtm_external_sales_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_external_sales_lines" ADD CONSTRAINT "mtm_external_sales_lines_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "mtm_external_sales_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deterministic and idempotent backfill for compatibility. Every existing route
-- and visit receives one primary relation matching its legacy owner.
INSERT INTO "mtm_route_assignments" (
  "id", "organizationId", "routeId", "agentId", "role", "assignedAt", "createdAt", "updatedAt"
)
SELECT
  'ra_' || md5(r."id" || ':primary'), r."organizationId", r."id", r."agentId",
  'PRIMARY'::"MtmRouteAssignmentRole", r."createdAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "mtm_routes" r
ON CONFLICT ("routeId", "agentId") DO UPDATE SET
  "role" = 'PRIMARY'::"MtmRouteAssignmentRole",
  "removedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "mtm_visit_participants" (
  "id", "organizationId", "visitId", "agentId", "role", "joinedAt", "createdAt", "updatedAt"
)
SELECT
  'vp_' || md5(v."id" || ':primary'), v."organizationId", v."id", v."agentId",
  'PRIMARY'::"MtmRouteAssignmentRole", v."checkInAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "mtm_visits" v
ON CONFLICT ("visitId", "agentId") DO UPDATE SET
  "role" = 'PRIMARY'::"MtmRouteAssignmentRole",
  "leftAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

-- New tenant tables ship fail-closed. Migration/bootstrap jobs may use the
-- explicit app.rls_bypass context; normal requests must set app.org_id.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'mtm_route_assignments',
    'mtm_visit_participants',
    'mtm_visit_policies',
    'mtm_visit_policy_actions',
    'mtm_visit_requirement_snapshots',
    'mtm_visit_requirements',
    'mtm_visit_action_results',
    'mtm_route_change_requests',
    'mtm_customer_create_requests',
    'mtm_import_jobs',
    'mtm_import_row_errors',
    'mtm_external_sales_documents',
    'mtm_external_sales_lines'
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
END $$;
