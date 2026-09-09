-- SWM-09: fail-closed pharmacy promotion plan -> fact/evidence -> L1/L2 ->
-- immutable points ledger. This migration is additive and deliberately seeds
-- no promotion, formula, policy, reward, or feature-enablement data.

SELECT set_config('app.rls_bypass', 'on', false);

CREATE TYPE "MtmPharmacyDefinitionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "MtmPharmacyPromotionVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED', 'CANCELLED');
CREATE TYPE "MtmPharmacyTargetStatus" AS ENUM ('PLANNED', 'CONNECTED', 'CLOSED', 'CANCELLED');
CREATE TYPE "MtmPharmacyEligibilityStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'INELIGIBLE', 'OVERRIDDEN');
CREATE TYPE "MtmPharmacyExecutionStatus" AS ENUM ('DRAFT', 'READY', 'IN_REVIEW', 'APPROVED', 'RETURNED', 'REJECTED', 'REVERSED');
CREATE TYPE "MtmPharmacyReviewState" AS ENUM ('NOT_READY', 'READY', 'APPROVED', 'REJECTED', 'RETURNED');
CREATE TYPE "MtmPharmacyReviewLevel" AS ENUM ('L1', 'L2');
CREATE TYPE "MtmPharmacyReviewDecision" AS ENUM ('APPROVED', 'REJECTED', 'RETURNED');
CREATE TYPE "MtmPharmacyEvidenceKind" AS ENUM ('PHOTO', 'DOCUMENT');
CREATE TYPE "MtmPharmacyLedgerEntryType" AS ENUM ('AWARD', 'REWARD_DEBIT', 'REVERSAL', 'ADJUSTMENT_CREDIT', 'ADJUSTMENT_DEBIT');
CREATE TYPE "MtmPharmacyPointsBucket" AS ENUM ('FACT_POINTS', 'REWARD_POINTS');
CREATE TYPE "MtmPharmacyRewardStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "MtmPharmacyRewardClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED');
CREATE TYPE "MtmPharmacyOperationKind" AS ENUM ('BULK_PLAN', 'BULK_REVIEW', 'REOPEN', 'ADJUST');
CREATE TYPE "MtmPharmacyOperationStatus" AS ENUM ('PENDING', 'COMPLETED', 'PARTIAL', 'FAILED');
CREATE TYPE "MtmPharmacySelectionScope" AS ENUM ('EXPLICIT_IDS', 'FILTER_SNAPSHOT');

-- Composite parent keys are prerequisites for tenant-bound foreign keys. They
-- do not change existing primary keys or legacy relation semantics.
CREATE UNIQUE INDEX "users_organizationId_id_key"
  ON "users"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_teams_organizationId_id_key"
  ON "mtm_teams"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_agents_organizationId_id_key"
  ON "mtm_agents"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_customers_organizationId_id_key"
  ON "mtm_customers"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_contacts_organizationId_id_key"
  ON "mtm_contacts"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_visits_organizationId_id_key"
  ON "mtm_visits"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_photos_organizationId_id_key"
  ON "mtm_photos"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_documents_organizationId_id_key"
  ON "mtm_documents"("organizationId", "id");

CREATE TABLE "mtm_pharmacy_promotion_types" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "nameRu" TEXT NOT NULL,
  "nameAz" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "description" TEXT,
  "status" "MtmPharmacyDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_pharmacy_promotion_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_pharmacy_promotions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_pharmacy_promotions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_pharmacy_points_formulas" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "nameRu" TEXT NOT NULL,
  "nameAz" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "definition" JSONB NOT NULL,
  "definitionHash" VARCHAR(64) NOT NULL,
  "approvalReference" TEXT,
  "sourceSystem" TEXT NOT NULL,
  "sourceReference" TEXT,
  "sourceObservedAt" TIMESTAMP(3) NOT NULL,
  "sourceReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "MtmPharmacyDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" TEXT NOT NULL,
  "signedByUserId" TEXT,
  "signedAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_pharmacy_points_formulas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_pharmacy_approval_policies" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "l1Roles" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "l2Roles" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "l1Scope" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "l2Scope" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "definition" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false,
  "requireDistinctReviewers" BOOLEAN NOT NULL DEFAULT true,
  "requireRejectReason" BOOLEAN NOT NULL DEFAULT true,
  "requireReturnReason" BOOLEAN NOT NULL DEFAULT true,
  "definitionHash" VARCHAR(64) NOT NULL,
  "approvalReference" TEXT,
  "sourceSystem" TEXT NOT NULL,
  "sourceReference" TEXT,
  "sourceObservedAt" TIMESTAMP(3) NOT NULL,
  "sourceReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "MtmPharmacyDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" TEXT NOT NULL,
  "signedByUserId" TEXT,
  "signedAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_pharmacy_approval_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_pharmacy_promotion_versions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "promotionId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "typeId" TEXT NOT NULL,
  "nameRu" TEXT NOT NULL,
  "nameAz" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "descriptionRu" TEXT,
  "descriptionAz" TEXT,
  "descriptionEn" TEXT,
  "startsOn" DATE NOT NULL,
  "endsOn" DATE NOT NULL,
  "timezone" VARCHAR(100) NOT NULL,
  "formulaId" TEXT NOT NULL,
  "approvalPolicyId" TEXT NOT NULL,
  "eligibilityDefinition" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "eligibilityDefinitionHash" VARCHAR(64) NOT NULL,
  "definitionHash" VARCHAR(64) NOT NULL,
  "approvalReference" TEXT,
  "eligibilityApprovalReference" TEXT,
  "eligibilityApprovedByUserId" TEXT,
  "eligibilityApprovedAt" TIMESTAMP(3),
  "sourceSystem" TEXT NOT NULL,
  "sourceReference" TEXT,
  "sourceObservedAt" TIMESTAMP(3) NOT NULL,
  "sourceReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "MtmPharmacyPromotionVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" TEXT NOT NULL,
  "publishedByUserId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_pharmacy_promotion_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_pharmacy_promotion_targets" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "promotionVersionId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "contactId" TEXT,
  "assignedAgentId" TEXT NOT NULL,
  "assignedTeamId" TEXT,
  "managingManagerId" TEXT,
  "planQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "unit" TEXT NOT NULL,
  "status" "MtmPharmacyTargetStatus" NOT NULL DEFAULT 'PLANNED',
  "eligibilityStatus" "MtmPharmacyEligibilityStatus" NOT NULL DEFAULT 'PENDING',
  "eligibilitySnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "eligibilityOverrideReason" TEXT,
  "customerCodeSnapshot" TEXT,
  "customerNameSnapshot" TEXT NOT NULL,
  "customerAddressSnapshot" TEXT,
  "customerRegistrationSnapshot" TEXT,
  "agentNameSnapshot" TEXT NOT NULL,
  "teamNameSnapshot" TEXT,
  "managerNameSnapshot" TEXT,
  "sourceSystem" TEXT NOT NULL,
  "sourceReference" TEXT,
  "sourceObservedAt" TIMESTAMP(3) NOT NULL,
  "sourceReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "connectedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_pharmacy_promotion_targets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_pharmacy_promotion_executions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "visitId" TEXT,
  "agentId" TEXT NOT NULL,
  "submittedByAgentId" TEXT,
  "submittedByUserId" TEXT,
  "clientExecutionId" TEXT NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "supersedesExecutionId" TEXT,
  "planQuantitySnapshot" DECIMAL(18,4) NOT NULL,
  "actualQuantity" DECIMAL(18,4) NOT NULL,
  "unit" TEXT NOT NULL,
  "formulaId" TEXT NOT NULL,
  "formulaVersion" INTEGER NOT NULL,
  "formulaHash" VARCHAR(64) NOT NULL,
  "approvalPolicyId" TEXT NOT NULL,
  "approvalPolicyVersion" INTEGER NOT NULL,
  "approvalPolicyHash" VARCHAR(64) NOT NULL,
  "calculationInput" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "calculationOutput" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "factPointsPreview" DECIMAL(18,4),
  "rewardPointsPreview" DECIMAL(18,4),
  "differencePointsPreview" DECIMAL(18,4),
  "sourceSystem" TEXT NOT NULL,
  "sourceReference" TEXT,
  "sourceObservedAt" TIMESTAMP(3) NOT NULL,
  "sourceReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "MtmPharmacyExecutionStatus" NOT NULL DEFAULT 'DRAFT',
  "l1State" "MtmPharmacyReviewState" NOT NULL DEFAULT 'NOT_READY',
  "l2State" "MtmPharmacyReviewState" NOT NULL DEFAULT 'NOT_READY',
  "version" INTEGER NOT NULL DEFAULT 1,
  "submittedAt" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_pharmacy_promotion_executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_pharmacy_promotion_evidence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "submittedByAgentId" TEXT NOT NULL,
  "clientEvidenceId" TEXT NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "kind" "MtmPharmacyEvidenceKind" NOT NULL,
  "photoId" TEXT,
  "documentId" TEXT,
  "contentHash" VARCHAR(64) NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "sourceObservedAt" TIMESTAMP(3) NOT NULL,
  "sourceReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_pharmacy_promotion_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_pharmacy_promotion_reviews" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "level" "MtmPharmacyReviewLevel" NOT NULL,
  "decision" "MtmPharmacyReviewDecision" NOT NULL,
  "reviewerAgentId" TEXT,
  "reviewerUserId" TEXT,
  "reviewerNameSnapshot" TEXT NOT NULL,
  "reviewerScopeSnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "reason" TEXT,
  "approvalPolicyId" TEXT NOT NULL,
  "approvalPolicyVersion" INTEGER NOT NULL,
  "approvalPolicyHash" VARCHAR(64) NOT NULL,
  "formulaId" TEXT NOT NULL,
  "formulaVersion" INTEGER NOT NULL,
  "formulaHash" VARCHAR(64) NOT NULL,
  "factPointsPreview" DECIMAL(18,4),
  "rewardPointsPreview" DECIMAL(18,4),
  "differencePointsPreview" DECIMAL(18,4),
  "calculationSnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "batchId" TEXT,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_pharmacy_promotion_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_pharmacy_rewards" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "nameRu" TEXT NOT NULL,
  "nameAz" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "descriptionRu" TEXT,
  "descriptionAz" TEXT,
  "descriptionEn" TEXT,
  "pointsCost" DECIMAL(18,4) NOT NULL,
  "stockQuantity" INTEGER,
  "availableFrom" TIMESTAMP(3),
  "availableUntil" TIMESTAMP(3),
  "definitionHash" VARCHAR(64) NOT NULL,
  "sourceSystem" TEXT NOT NULL,
  "sourceReference" TEXT,
  "sourceObservedAt" TIMESTAMP(3) NOT NULL,
  "sourceReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "MtmPharmacyRewardStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" TEXT NOT NULL,
  "activatedByUserId" TEXT,
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_pharmacy_rewards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_pharmacy_reward_claims" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "rewardId" TEXT NOT NULL,
  "targetId" TEXT,
  "customerId" TEXT,
  "contactId" TEXT,
  "beneficiaryAgentId" TEXT NOT NULL,
  "requestedByAgentId" TEXT NOT NULL,
  "clientClaimId" TEXT NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "pointsCostSnapshot" DECIMAL(18,4) NOT NULL,
  "totalPointsCost" DECIMAL(18,4) NOT NULL,
  "rewardDefinitionHash" VARCHAR(64) NOT NULL,
  "status" "MtmPharmacyRewardClaimStatus" NOT NULL DEFAULT 'PENDING',
  "version" INTEGER NOT NULL DEFAULT 1,
  "decisionReason" TEXT,
  "decidedByUserId" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "fulfilledAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_pharmacy_reward_claims_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_pharmacy_promotion_operations" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "kind" "MtmPharmacyOperationKind" NOT NULL,
  "status" "MtmPharmacyOperationStatus" NOT NULL DEFAULT 'PENDING',
  "selectionScope" "MtmPharmacySelectionScope" NOT NULL,
  "explicitIds" JSONB,
  "filterSnapshot" JSONB,
  "selectionHash" VARCHAR(64) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "requestPayload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "resultPayload" JSONB,
  "selectedCount" INTEGER NOT NULL DEFAULT 0,
  "succeededCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "actorAgentId" TEXT,
  "actorUserId" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_pharmacy_promotion_operations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_pharmacy_points_ledger_entries" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "beneficiaryAgentId" TEXT NOT NULL,
  "targetId" TEXT,
  "customerId" TEXT,
  "contactId" TEXT,
  "executionId" TEXT,
  "reviewId" TEXT,
  "rewardClaimId" TEXT,
  "entryType" "MtmPharmacyLedgerEntryType" NOT NULL,
  "bucket" "MtmPharmacyPointsBucket" NOT NULL,
  "delta" DECIMAL(18,4) NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "formulaId" TEXT,
  "formulaVersion" INTEGER,
  "formulaHash" VARCHAR(64),
  "calculationSnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "reversesEntryId" TEXT,
  "reason" TEXT,
  "actorAgentId" TEXT,
  "actorUserId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_pharmacy_points_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mtm_pharmacy_promotion_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "promotionTypeId" TEXT,
  "promotionId" TEXT,
  "promotionVersionId" TEXT,
  "targetId" TEXT,
  "executionId" TEXT,
  "formulaId" TEXT,
  "approvalPolicyId" TEXT,
  "evidenceId" TEXT,
  "reviewId" TEXT,
  "rewardClaimId" TEXT,
  "operationId" TEXT,
  "eventType" TEXT NOT NULL,
  "fromState" TEXT,
  "toState" TEXT,
  "actorAgentId" TEXT,
  "actorUserId" TEXT,
  "sourceKey" TEXT NOT NULL,
  "requestHash" VARCHAR(64),
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_pharmacy_promotion_events_pkey" PRIMARY KEY ("id")
);

-- Tenant identities and query contracts.
CREATE UNIQUE INDEX "mtm_pharmacy_promotion_types_org_id_key" ON "mtm_pharmacy_promotion_types"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_pharmacy_promotion_types_org_code_key" ON "mtm_pharmacy_promotion_types"("organizationId", "code");
CREATE INDEX "mtm_pharmacy_promotion_types_org_status_idx" ON "mtm_pharmacy_promotion_types"("organizationId", "status");

CREATE UNIQUE INDEX "mtm_pharmacy_promotions_org_id_key" ON "mtm_pharmacy_promotions"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_pharmacy_promotions_org_code_key" ON "mtm_pharmacy_promotions"("organizationId", "code");
CREATE INDEX "mtm_pharmacy_promotions_org_archive_created_idx" ON "mtm_pharmacy_promotions"("organizationId", "archivedAt", "createdAt");

CREATE UNIQUE INDEX "mtm_pharmacy_formulas_org_id_key" ON "mtm_pharmacy_points_formulas"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_pharmacy_formulas_org_code_version_key" ON "mtm_pharmacy_points_formulas"("organizationId", "code", "version");
CREATE INDEX "mtm_pharmacy_formulas_org_status_code_idx" ON "mtm_pharmacy_points_formulas"("organizationId", "status", "code");
CREATE UNIQUE INDEX "mtm_pharmacy_formulas_one_active_idx" ON "mtm_pharmacy_points_formulas"("organizationId", "code") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "mtm_pharmacy_policies_org_id_key" ON "mtm_pharmacy_approval_policies"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_pharmacy_policies_org_code_version_key" ON "mtm_pharmacy_approval_policies"("organizationId", "code", "version");
CREATE INDEX "mtm_pharmacy_policies_org_status_code_idx" ON "mtm_pharmacy_approval_policies"("organizationId", "status", "code");
CREATE UNIQUE INDEX "mtm_pharmacy_policies_one_active_idx" ON "mtm_pharmacy_approval_policies"("organizationId", "code") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "mtm_pharmacy_versions_org_id_key" ON "mtm_pharmacy_promotion_versions"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_pharmacy_versions_org_promotion_revision_key" ON "mtm_pharmacy_promotion_versions"("organizationId", "promotionId", "revision");
CREATE UNIQUE INDEX "mtm_pharmacy_versions_one_published_idx" ON "mtm_pharmacy_promotion_versions"("organizationId", "promotionId") WHERE "status" = 'PUBLISHED';
CREATE INDEX "mtm_pharmacy_versions_org_status_period_idx" ON "mtm_pharmacy_promotion_versions"("organizationId", "status", "startsOn", "endsOn");
CREATE INDEX "mtm_pharmacy_versions_org_type_status_idx" ON "mtm_pharmacy_promotion_versions"("organizationId", "typeId", "status");
CREATE INDEX "mtm_pharmacy_versions_org_formula_idx" ON "mtm_pharmacy_promotion_versions"("organizationId", "formulaId");
CREATE INDEX "mtm_pharmacy_versions_org_policy_idx" ON "mtm_pharmacy_promotion_versions"("organizationId", "approvalPolicyId");

CREATE UNIQUE INDEX "mtm_pharmacy_targets_org_id_key" ON "mtm_pharmacy_promotion_targets"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_pharmacy_targets_assignment_key" ON "mtm_pharmacy_promotion_targets"("organizationId", "promotionVersionId", "customerId", "assignedAgentId");
CREATE INDEX "mtm_pharmacy_targets_org_agent_status_idx" ON "mtm_pharmacy_promotion_targets"("organizationId", "assignedAgentId", "status", "createdAt");
CREATE INDEX "mtm_pharmacy_targets_org_team_status_idx" ON "mtm_pharmacy_promotion_targets"("organizationId", "assignedTeamId", "status", "createdAt");
CREATE INDEX "mtm_pharmacy_targets_org_manager_status_idx" ON "mtm_pharmacy_promotion_targets"("organizationId", "managingManagerId", "status", "createdAt");
CREATE INDEX "mtm_pharmacy_targets_org_customer_status_idx" ON "mtm_pharmacy_promotion_targets"("organizationId", "customerId", "status");
CREATE INDEX "mtm_pharmacy_targets_org_version_status_idx" ON "mtm_pharmacy_promotion_targets"("organizationId", "promotionVersionId", "status");
CREATE INDEX "mtm_pharmacy_targets_org_connected_idx" ON "mtm_pharmacy_promotion_targets"("organizationId", "connectedAt");
CREATE INDEX "mtm_pharmacy_targets_org_closed_idx" ON "mtm_pharmacy_promotion_targets"("organizationId", "closedAt");

CREATE UNIQUE INDEX "mtm_pharmacy_executions_org_id_key" ON "mtm_pharmacy_promotion_executions"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_pharmacy_executions_client_key" ON "mtm_pharmacy_promotion_executions"("organizationId", "agentId", "clientExecutionId");
CREATE UNIQUE INDEX "mtm_pharmacy_executions_successor_key" ON "mtm_pharmacy_promotion_executions"("organizationId", "supersedesExecutionId");
CREATE UNIQUE INDEX "mtm_pharmacy_executions_root_target_idx" ON "mtm_pharmacy_promotion_executions"("organizationId", "targetId") WHERE "supersedesExecutionId" IS NULL;
CREATE INDEX "mtm_pharmacy_executions_org_target_status_idx" ON "mtm_pharmacy_promotion_executions"("organizationId", "targetId", "status");
CREATE INDEX "mtm_pharmacy_executions_org_agent_status_idx" ON "mtm_pharmacy_promotion_executions"("organizationId", "agentId", "status", "sourceObservedAt");
CREATE INDEX "mtm_pharmacy_executions_review_queue_idx" ON "mtm_pharmacy_promotion_executions"("organizationId", "l1State", "l2State", "readyAt");
CREATE INDEX "mtm_pharmacy_executions_org_visit_idx" ON "mtm_pharmacy_promotion_executions"("organizationId", "visitId");
CREATE INDEX "mtm_pharmacy_executions_submit_agent_idx" ON "mtm_pharmacy_promotion_executions"("organizationId", "submittedByAgentId", "submittedAt");
CREATE INDEX "mtm_pharmacy_executions_submit_user_idx" ON "mtm_pharmacy_promotion_executions"("organizationId", "submittedByUserId", "submittedAt");
CREATE INDEX "mtm_pharmacy_executions_fact_points_idx" ON "mtm_pharmacy_promotion_executions"("organizationId", "factPointsPreview");
CREATE INDEX "mtm_pharmacy_executions_reward_points_idx" ON "mtm_pharmacy_promotion_executions"("organizationId", "rewardPointsPreview");
CREATE INDEX "mtm_pharmacy_executions_difference_points_idx" ON "mtm_pharmacy_promotion_executions"("organizationId", "differencePointsPreview");

CREATE UNIQUE INDEX "mtm_pharmacy_evidence_org_id_key" ON "mtm_pharmacy_promotion_evidence"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_pharmacy_evidence_client_key" ON "mtm_pharmacy_promotion_evidence"("organizationId", "submittedByAgentId", "clientEvidenceId");
CREATE UNIQUE INDEX "mtm_pharmacy_evidence_execution_photo_key" ON "mtm_pharmacy_promotion_evidence"("organizationId", "executionId", "photoId") WHERE "photoId" IS NOT NULL;
CREATE UNIQUE INDEX "mtm_pharmacy_evidence_execution_document_key" ON "mtm_pharmacy_promotion_evidence"("organizationId", "executionId", "documentId") WHERE "documentId" IS NOT NULL;
CREATE INDEX "mtm_pharmacy_evidence_org_execution_created_idx" ON "mtm_pharmacy_promotion_evidence"("organizationId", "executionId", "createdAt");
CREATE INDEX "mtm_pharmacy_evidence_org_photo_idx" ON "mtm_pharmacy_promotion_evidence"("organizationId", "photoId");
CREATE INDEX "mtm_pharmacy_evidence_org_document_idx" ON "mtm_pharmacy_promotion_evidence"("organizationId", "documentId");

CREATE UNIQUE INDEX "mtm_pharmacy_reviews_org_id_key" ON "mtm_pharmacy_promotion_reviews"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_pharmacy_reviews_execution_level_key" ON "mtm_pharmacy_promotion_reviews"("organizationId", "executionId", "level");
CREATE UNIQUE INDEX "mtm_pharmacy_reviews_idempotency_key" ON "mtm_pharmacy_promotion_reviews"("organizationId", "idempotencyKey");
CREATE INDEX "mtm_pharmacy_reviews_queue_history_idx" ON "mtm_pharmacy_promotion_reviews"("organizationId", "level", "decision", "decidedAt");
CREATE INDEX "mtm_pharmacy_reviews_agent_history_idx" ON "mtm_pharmacy_promotion_reviews"("organizationId", "reviewerAgentId", "decidedAt");
CREATE INDEX "mtm_pharmacy_reviews_user_history_idx" ON "mtm_pharmacy_promotion_reviews"("organizationId", "reviewerUserId", "decidedAt");
CREATE INDEX "mtm_pharmacy_reviews_batch_idx" ON "mtm_pharmacy_promotion_reviews"("organizationId", "batchId");

CREATE UNIQUE INDEX "mtm_pharmacy_rewards_org_id_key" ON "mtm_pharmacy_rewards"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_pharmacy_rewards_org_code_version_key" ON "mtm_pharmacy_rewards"("organizationId", "code", "version");
CREATE UNIQUE INDEX "mtm_pharmacy_rewards_one_active_idx" ON "mtm_pharmacy_rewards"("organizationId", "code") WHERE "status" = 'ACTIVE';
CREATE INDEX "mtm_pharmacy_rewards_org_status_code_idx" ON "mtm_pharmacy_rewards"("organizationId", "status", "code");

CREATE UNIQUE INDEX "mtm_pharmacy_claims_org_id_key" ON "mtm_pharmacy_reward_claims"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_pharmacy_claims_client_key" ON "mtm_pharmacy_reward_claims"("organizationId", "requestedByAgentId", "clientClaimId");
CREATE INDEX "mtm_pharmacy_claims_beneficiary_status_idx" ON "mtm_pharmacy_reward_claims"("organizationId", "beneficiaryAgentId", "status", "requestedAt");
CREATE INDEX "mtm_pharmacy_claims_reward_status_idx" ON "mtm_pharmacy_reward_claims"("organizationId", "rewardId", "status");
CREATE INDEX "mtm_pharmacy_claims_customer_time_idx" ON "mtm_pharmacy_reward_claims"("organizationId", "customerId", "requestedAt");

CREATE UNIQUE INDEX "mtm_pharmacy_operations_org_id_key" ON "mtm_pharmacy_promotion_operations"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_pharmacy_operations_idempotency_key" ON "mtm_pharmacy_promotion_operations"("organizationId", "idempotencyKey");
CREATE INDEX "mtm_pharmacy_operations_kind_status_idx" ON "mtm_pharmacy_promotion_operations"("organizationId", "kind", "status", "createdAt");
CREATE INDEX "mtm_pharmacy_operations_user_created_idx" ON "mtm_pharmacy_promotion_operations"("organizationId", "actorUserId", "createdAt");
CREATE INDEX "mtm_pharmacy_operations_agent_created_idx" ON "mtm_pharmacy_promotion_operations"("organizationId", "actorAgentId", "createdAt");

CREATE UNIQUE INDEX "mtm_pharmacy_ledger_org_id_key" ON "mtm_pharmacy_points_ledger_entries"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_pharmacy_ledger_source_key" ON "mtm_pharmacy_points_ledger_entries"("organizationId", "sourceKey");
CREATE UNIQUE INDEX "mtm_pharmacy_ledger_reversal_key" ON "mtm_pharmacy_points_ledger_entries"("organizationId", "reversesEntryId");
CREATE UNIQUE INDEX "mtm_pharmacy_ledger_execution_award_key" ON "mtm_pharmacy_points_ledger_entries"("organizationId", "executionId", "bucket") WHERE "entryType" = 'AWARD';
CREATE UNIQUE INDEX "mtm_pharmacy_ledger_claim_debit_key" ON "mtm_pharmacy_points_ledger_entries"("organizationId", "rewardClaimId") WHERE "entryType" = 'REWARD_DEBIT';
CREATE INDEX "mtm_pharmacy_ledger_beneficiary_time_idx" ON "mtm_pharmacy_points_ledger_entries"("organizationId", "beneficiaryAgentId", "occurredAt");
CREATE INDEX "mtm_pharmacy_ledger_customer_time_idx" ON "mtm_pharmacy_points_ledger_entries"("organizationId", "customerId", "occurredAt");
CREATE INDEX "mtm_pharmacy_ledger_target_time_idx" ON "mtm_pharmacy_points_ledger_entries"("organizationId", "targetId", "occurredAt");
CREATE INDEX "mtm_pharmacy_ledger_execution_idx" ON "mtm_pharmacy_points_ledger_entries"("organizationId", "executionId");
CREATE INDEX "mtm_pharmacy_ledger_claim_idx" ON "mtm_pharmacy_points_ledger_entries"("organizationId", "rewardClaimId");

CREATE UNIQUE INDEX "mtm_pharmacy_events_org_id_key" ON "mtm_pharmacy_promotion_events"("organizationId", "id");
CREATE UNIQUE INDEX "mtm_pharmacy_events_source_key" ON "mtm_pharmacy_promotion_events"("organizationId", "sourceKey");
CREATE INDEX "mtm_pharmacy_events_type_time_idx" ON "mtm_pharmacy_promotion_events"("organizationId", "eventType", "occurredAt");
CREATE INDEX "mtm_pharmacy_events_promotion_type_time_idx" ON "mtm_pharmacy_promotion_events"("organizationId", "promotionTypeId", "occurredAt");
CREATE INDEX "mtm_pharmacy_events_execution_time_idx" ON "mtm_pharmacy_promotion_events"("organizationId", "executionId", "occurredAt");
CREATE INDEX "mtm_pharmacy_events_target_time_idx" ON "mtm_pharmacy_promotion_events"("organizationId", "targetId", "occurredAt");
CREATE INDEX "mtm_pharmacy_events_formula_time_idx" ON "mtm_pharmacy_promotion_events"("organizationId", "formulaId", "occurredAt");
CREATE INDEX "mtm_pharmacy_events_policy_time_idx" ON "mtm_pharmacy_promotion_events"("organizationId", "approvalPolicyId", "occurredAt");
CREATE INDEX "mtm_pharmacy_events_evidence_time_idx" ON "mtm_pharmacy_promotion_events"("organizationId", "evidenceId", "occurredAt");
CREATE INDEX "mtm_pharmacy_events_review_time_idx" ON "mtm_pharmacy_promotion_events"("organizationId", "reviewId", "occurredAt");

-- Row-local invariants. Cross-row workflow invariants are enforced by the
-- triggers below and repeated in the API transaction layer.
ALTER TABLE "mtm_pharmacy_promotion_types"
  ADD CONSTRAINT "mtm_pharmacy_type_code_nonempty" CHECK (btrim("code") <> '');

ALTER TABLE "mtm_pharmacy_promotions"
  ADD CONSTRAINT "mtm_pharmacy_promotion_code_nonempty" CHECK (btrim("code") <> '');

ALTER TABLE "mtm_pharmacy_points_formulas"
  ADD CONSTRAINT "mtm_pharmacy_formula_version_positive" CHECK ("version" > 0 AND "schemaVersion" > 0),
  ADD CONSTRAINT "mtm_pharmacy_formula_hash_valid" CHECK ("definitionHash" ~ '^[A-Fa-f0-9]{64}$'),
  ADD CONSTRAINT "mtm_pharmacy_formula_definition_object" CHECK (jsonb_typeof("definition") = 'object'),
  ADD CONSTRAINT "mtm_pharmacy_formula_projection_coherent" CHECK (
    "status" <> 'ACTIVE'
    OR (
      "definition" ? 'schemaVersion'
      AND ("definition" ->> 'schemaVersion')::integer = "schemaVersion"
    )
  ),
  ADD CONSTRAINT "mtm_pharmacy_formula_signature_coherent" CHECK (
    "status" <> 'ACTIVE'
    OR ("signedByUserId" IS NOT NULL AND "signedAt" IS NOT NULL AND "activatedAt" IS NOT NULL AND NULLIF(btrim("approvalReference"), '') IS NOT NULL)
  ),
  ADD CONSTRAINT "mtm_pharmacy_formula_retirement_coherent" CHECK ("status" <> 'RETIRED' OR "retiredAt" IS NOT NULL);

ALTER TABLE "mtm_pharmacy_approval_policies"
  ADD CONSTRAINT "mtm_pharmacy_policy_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "mtm_pharmacy_policy_hash_valid" CHECK ("definitionHash" ~ '^[A-Fa-f0-9]{64}$'),
  ADD CONSTRAINT "mtm_pharmacy_policy_json_shapes" CHECK (
    jsonb_typeof("l1Roles") = 'array'
    AND jsonb_typeof("l2Roles") = 'array'
    AND jsonb_typeof("l1Scope") = 'object'
    AND jsonb_typeof("l2Scope") = 'object'
    AND jsonb_typeof("definition") = 'object'
  ),
  ADD CONSTRAINT "mtm_pharmacy_policy_projection_coherent" CHECK (
    "status" <> 'ACTIVE'
    OR (
      "definition" ?& ARRAY['schemaVersion', 'levels', 'l1Roles', 'l2Roles', 'preventSelfApproval', 'requireDistinctReviewers', 'reasonRequiredFor']
      AND "definition" -> 'levels' = '["L1", "L2"]'::jsonb
      AND "l1Roles" = "definition" -> 'l1Roles'
      AND "l2Roles" = "definition" -> 'l2Roles'
      AND "allowSelfApproval" = NOT (("definition" ->> 'preventSelfApproval')::boolean)
      AND "requireDistinctReviewers" = (("definition" ->> 'requireDistinctReviewers')::boolean)
      AND "requireRejectReason" = (("definition" -> 'reasonRequiredFor') ? 'REJECTED')
      AND "requireReturnReason" = (("definition" -> 'reasonRequiredFor') ? 'RETURNED')
    )
  ),
  ADD CONSTRAINT "mtm_pharmacy_policy_signature_coherent" CHECK (
    "status" <> 'ACTIVE'
    OR ("signedByUserId" IS NOT NULL AND "signedAt" IS NOT NULL AND "activatedAt" IS NOT NULL AND NULLIF(btrim("approvalReference"), '') IS NOT NULL)
  ),
  ADD CONSTRAINT "mtm_pharmacy_policy_retirement_coherent" CHECK ("status" <> 'RETIRED' OR "retiredAt" IS NOT NULL);

ALTER TABLE "mtm_pharmacy_promotion_versions"
  ADD CONSTRAINT "mtm_pharmacy_version_revision_positive" CHECK ("revision" > 0),
  ADD CONSTRAINT "mtm_pharmacy_version_period_valid" CHECK ("endsOn" >= "startsOn"),
  ADD CONSTRAINT "mtm_pharmacy_version_hashes_valid" CHECK (
    "definitionHash" ~ '^[A-Fa-f0-9]{64}$'
    AND "eligibilityDefinitionHash" ~ '^[A-Fa-f0-9]{64}$'
  ),
  ADD CONSTRAINT "mtm_pharmacy_version_eligibility_object" CHECK (jsonb_typeof("eligibilityDefinition") = 'object'),
  ADD CONSTRAINT "mtm_pharmacy_version_eligibility_projection" CHECK (
    "status" <> 'PUBLISHED'
    OR (
      "eligibilityDefinition" ?& ARRAY['schemaVersion', 'customerObjectTypes', 'requireActiveCustomer', 'requireCompletedVisit', 'minimumEvidenceCount']
      AND ("eligibilityDefinition" ->> 'schemaVersion')::integer = 1
      AND jsonb_typeof("eligibilityDefinition" -> 'customerObjectTypes') = 'array'
      AND ("eligibilityDefinition" ->> 'minimumEvidenceCount')::integer BETWEEN 0 AND 100
    )
  ),
  ADD CONSTRAINT "mtm_pharmacy_version_publish_signature" CHECK (
    "status" <> 'PUBLISHED'
    OR (
      "publishedByUserId" IS NOT NULL
      AND "publishedAt" IS NOT NULL
      AND NULLIF(btrim("approvalReference"), '') IS NOT NULL
      AND NULLIF(btrim("eligibilityApprovalReference"), '') IS NOT NULL
      AND "eligibilityApprovedByUserId" IS NOT NULL
      AND "eligibilityApprovedAt" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "mtm_pharmacy_version_terminal_timestamps" CHECK (
    ("status" <> 'RETIRED' OR "retiredAt" IS NOT NULL)
    AND ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL)
  );

ALTER TABLE "mtm_pharmacy_promotion_targets"
  ADD CONSTRAINT "mtm_pharmacy_target_quantity_nonnegative" CHECK ("planQuantity" >= 0),
  ADD CONSTRAINT "mtm_pharmacy_target_unit_nonempty" CHECK (btrim("unit") <> ''),
  ADD CONSTRAINT "mtm_pharmacy_target_override_reason" CHECK (
    ("eligibilityStatus" = 'OVERRIDDEN' AND NULLIF(btrim("eligibilityOverrideReason"), '') IS NOT NULL)
    OR ("eligibilityStatus" <> 'OVERRIDDEN' AND "eligibilityOverrideReason" IS NULL)
  ),
  ADD CONSTRAINT "mtm_pharmacy_target_eligibility_snapshot" CHECK (
    jsonb_typeof("eligibilitySnapshot") = 'object'
    AND (
      "eligibilityStatus" <> 'OVERRIDDEN'
      OR (
        "eligibilitySnapshot" ->> 'status' = 'OVERRIDDEN'
        AND jsonb_typeof("eligibilitySnapshot" -> 'override') = 'object'
        AND "eligibilitySnapshot" #>> '{override,reason}' = "eligibilityOverrideReason"
        AND NULLIF(btrim("eligibilitySnapshot" #>> '{override,operationId}'), '') IS NOT NULL
        AND NULLIF(btrim("eligibilitySnapshot" #>> '{override,actorUserId}'), '') IS NOT NULL
        AND NULLIF(btrim("eligibilitySnapshot" #>> '{override,occurredAt}'), '') IS NOT NULL
      )
    )
  ),
  ADD CONSTRAINT "mtm_pharmacy_target_status_timestamps" CHECK (
    ("status" <> 'CONNECTED' OR "connectedAt" IS NOT NULL)
    AND ("status" <> 'CLOSED' OR ("connectedAt" IS NOT NULL AND "closedAt" IS NOT NULL))
    AND ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL)
  );

ALTER TABLE "mtm_pharmacy_promotion_executions"
  ADD CONSTRAINT "mtm_pharmacy_execution_submitter_identity" CHECK (
    "status" = 'DRAFT' OR num_nonnulls("submittedByAgentId", "submittedByUserId") >= 1
  ),
  ADD CONSTRAINT "mtm_pharmacy_execution_quantities_nonnegative" CHECK ("planQuantitySnapshot" >= 0 AND "actualQuantity" >= 0),
  ADD CONSTRAINT "mtm_pharmacy_execution_versions_positive" CHECK ("version" > 0 AND "formulaVersion" > 0 AND "approvalPolicyVersion" > 0),
  ADD CONSTRAINT "mtm_pharmacy_execution_hashes_valid" CHECK (
    "requestHash" ~ '^[A-Fa-f0-9]{64}$'
    AND "formulaHash" ~ '^[A-Fa-f0-9]{64}$'
    AND "approvalPolicyHash" ~ '^[A-Fa-f0-9]{64}$'
  ),
  ADD CONSTRAINT "mtm_pharmacy_execution_preview_coherence" CHECK (
    ("factPointsPreview" IS NULL AND "rewardPointsPreview" IS NULL AND "differencePointsPreview" IS NULL)
    OR (
      "factPointsPreview" IS NOT NULL AND "factPointsPreview" >= 0
      AND "rewardPointsPreview" IS NOT NULL AND "rewardPointsPreview" >= 0
      AND "differencePointsPreview" = "factPointsPreview" - "rewardPointsPreview"
    )
  ),
  ADD CONSTRAINT "mtm_pharmacy_execution_ready_values" CHECK (
    "status" = 'DRAFT'
    OR (
      "submittedAt" IS NOT NULL
      AND "readyAt" IS NOT NULL
      AND "factPointsPreview" IS NOT NULL
      AND "rewardPointsPreview" IS NOT NULL
      AND "differencePointsPreview" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "mtm_pharmacy_execution_closed_timestamp" CHECK (
    "status" NOT IN ('APPROVED', 'REJECTED', 'REVERSED') OR "closedAt" IS NOT NULL
  );

ALTER TABLE "mtm_pharmacy_promotion_evidence"
  ADD CONSTRAINT "mtm_pharmacy_evidence_attachment_xor" CHECK (
    ("kind" = 'PHOTO' AND "photoId" IS NOT NULL AND "documentId" IS NULL)
    OR ("kind" = 'DOCUMENT' AND "documentId" IS NOT NULL AND "photoId" IS NULL)
  ),
  ADD CONSTRAINT "mtm_pharmacy_evidence_hashes_valid" CHECK (
    "requestHash" ~ '^[A-Fa-f0-9]{64}$' AND "contentHash" ~ '^[A-Fa-f0-9]{64}$'
  );

ALTER TABLE "mtm_pharmacy_promotion_reviews"
  ADD CONSTRAINT "mtm_pharmacy_review_actor_identity" CHECK (num_nonnulls("reviewerAgentId", "reviewerUserId") >= 1),
  ADD CONSTRAINT "mtm_pharmacy_review_versions_positive" CHECK ("formulaVersion" > 0 AND "approvalPolicyVersion" > 0),
  ADD CONSTRAINT "mtm_pharmacy_review_hashes_valid" CHECK (
    "requestHash" ~ '^[A-Fa-f0-9]{64}$'
    AND "formulaHash" ~ '^[A-Fa-f0-9]{64}$'
    AND "approvalPolicyHash" ~ '^[A-Fa-f0-9]{64}$'
  ),
  ADD CONSTRAINT "mtm_pharmacy_review_preview_complete" CHECK (
    "factPointsPreview" IS NOT NULL AND "factPointsPreview" >= 0
    AND "rewardPointsPreview" IS NOT NULL AND "rewardPointsPreview" >= 0
    AND "differencePointsPreview" = "factPointsPreview" - "rewardPointsPreview"
  );

ALTER TABLE "mtm_pharmacy_rewards"
  ADD CONSTRAINT "mtm_pharmacy_reward_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "mtm_pharmacy_reward_cost_positive" CHECK ("pointsCost" > 0),
  ADD CONSTRAINT "mtm_pharmacy_reward_stock_nonnegative" CHECK ("stockQuantity" IS NULL OR "stockQuantity" >= 0),
  ADD CONSTRAINT "mtm_pharmacy_reward_period_valid" CHECK ("availableUntil" IS NULL OR "availableFrom" IS NULL OR "availableUntil" >= "availableFrom"),
  ADD CONSTRAINT "mtm_pharmacy_reward_hash_valid" CHECK ("definitionHash" ~ '^[A-Fa-f0-9]{64}$'),
  ADD CONSTRAINT "mtm_pharmacy_reward_activation_coherent" CHECK (
    "status" <> 'ACTIVE' OR ("activatedByUserId" IS NOT NULL AND "activatedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "mtm_pharmacy_reward_retirement_coherent" CHECK ("status" <> 'RETIRED' OR "retiredAt" IS NOT NULL);

ALTER TABLE "mtm_pharmacy_reward_claims"
  ADD CONSTRAINT "mtm_pharmacy_claim_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "mtm_pharmacy_claim_cost_valid" CHECK (
    "pointsCostSnapshot" > 0 AND "totalPointsCost" = "pointsCostSnapshot" * "quantity"
  ),
  ADD CONSTRAINT "mtm_pharmacy_claim_hashes_valid" CHECK (
    "requestHash" ~ '^[A-Fa-f0-9]{64}$' AND "rewardDefinitionHash" ~ '^[A-Fa-f0-9]{64}$'
  ),
  ADD CONSTRAINT "mtm_pharmacy_claim_decision_coherent" CHECK (
    ("status" NOT IN ('APPROVED', 'REJECTED', 'FULFILLED') OR ("decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL))
    AND ("status" <> 'REJECTED' OR NULLIF(btrim("decisionReason"), '') IS NOT NULL)
    AND ("status" <> 'FULFILLED' OR "fulfilledAt" IS NOT NULL)
    AND ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL)
  );

ALTER TABLE "mtm_pharmacy_promotion_operations"
  ADD CONSTRAINT "mtm_pharmacy_operation_selection_xor" CHECK (
    ("selectionScope" = 'EXPLICIT_IDS' AND jsonb_typeof("explicitIds") = 'array' AND "filterSnapshot" IS NULL)
    OR ("selectionScope" = 'FILTER_SNAPSHOT' AND jsonb_typeof("filterSnapshot") = 'object' AND "explicitIds" IS NULL)
  ),
  ADD CONSTRAINT "mtm_pharmacy_operation_hashes_valid" CHECK (
    "selectionHash" ~ '^[A-Fa-f0-9]{64}$' AND "requestHash" ~ '^[A-Fa-f0-9]{64}$'
  ),
  ADD CONSTRAINT "mtm_pharmacy_operation_counts_valid" CHECK (
    "version" > 0 AND "selectedCount" >= 0 AND "succeededCount" >= 0 AND "failedCount" >= 0
    AND (
      ("status" = 'PENDING' AND "succeededCount" = 0 AND "failedCount" = 0)
      OR ("status" = 'COMPLETED' AND "succeededCount" = "selectedCount" AND "failedCount" = 0)
      OR ("status" = 'PARTIAL' AND "succeededCount" > 0 AND "failedCount" > 0
          AND "succeededCount" + "failedCount" = "selectedCount")
      OR ("status" = 'FAILED' AND "succeededCount" = 0 AND "failedCount" = "selectedCount")
    )
  ),
  ADD CONSTRAINT "mtm_pharmacy_operation_actor_required" CHECK (num_nonnulls("actorAgentId", "actorUserId") >= 1),
  ADD CONSTRAINT "mtm_pharmacy_operation_completion_coherent" CHECK (
    "startedAt" IS NOT NULL
    AND (
      ("status" = 'PENDING' AND "completedAt" IS NULL AND "resultPayload" IS NULL)
      OR ("status" <> 'PENDING' AND "completedAt" IS NOT NULL AND "resultPayload" IS NOT NULL)
    )
  );

ALTER TABLE "mtm_pharmacy_points_ledger_entries"
  ADD CONSTRAINT "mtm_pharmacy_ledger_delta_contract" CHECK ("entryType" = 'AWARD' OR "delta" <> 0),
  ADD CONSTRAINT "mtm_pharmacy_ledger_hash_valid" CHECK ("requestHash" ~ '^[A-Fa-f0-9]{64}$'),
  ADD CONSTRAINT "mtm_pharmacy_ledger_actor_contract" CHECK (
    num_nonnulls("actorAgentId", "actorUserId") >= 1 OR "entryType" IN ('AWARD', 'REWARD_DEBIT', 'REVERSAL')
  ),
  ADD CONSTRAINT "mtm_pharmacy_ledger_formula_tuple" CHECK (
    ("formulaId" IS NULL AND "formulaVersion" IS NULL AND "formulaHash" IS NULL)
    OR ("formulaId" IS NOT NULL AND "formulaVersion" > 0 AND "formulaHash" ~ '^[A-Fa-f0-9]{64}$')
  ),
  ADD CONSTRAINT "mtm_pharmacy_ledger_type_contract" CHECK (
    ("entryType" = 'AWARD' AND "delta" >= 0 AND "executionId" IS NOT NULL AND "reviewId" IS NOT NULL AND "formulaId" IS NOT NULL AND "reversesEntryId" IS NULL)
    OR ("entryType" = 'REWARD_DEBIT' AND "bucket" = 'REWARD_POINTS' AND "delta" < 0 AND "rewardClaimId" IS NOT NULL AND "reversesEntryId" IS NULL)
    OR ("entryType" = 'REVERSAL' AND "reversesEntryId" IS NOT NULL)
    OR ("entryType" = 'ADJUSTMENT_CREDIT' AND "delta" > 0 AND NULLIF(btrim("reason"), '') IS NOT NULL AND num_nonnulls("actorAgentId", "actorUserId") >= 1)
    OR ("entryType" = 'ADJUSTMENT_DEBIT' AND "delta" < 0 AND NULLIF(btrim("reason"), '') IS NOT NULL AND num_nonnulls("actorAgentId", "actorUserId") >= 1)
  );

ALTER TABLE "mtm_pharmacy_promotion_events"
  ADD CONSTRAINT "mtm_pharmacy_event_subject_contract" CHECK (
    (
      "eventType" IN ('PROMOTION_TYPE_CREATED', 'PROMOTION_TYPE_ACTIVATED')
      AND "promotionTypeId" IS NOT NULL
      AND num_nonnulls("promotionTypeId", "promotionId", "promotionVersionId", "targetId", "executionId", "formulaId", "approvalPolicyId", "evidenceId", "reviewId", "rewardClaimId", "operationId") = 1
    ) OR (
      "eventType" IN ('POINTS_FORMULA_DRAFT_CREATED', 'POINTS_FORMULA_ACTIVATED', 'POINTS_FORMULA_RETIRED')
      AND "formulaId" IS NOT NULL
      AND num_nonnulls("promotionTypeId", "promotionId", "promotionVersionId", "targetId", "executionId", "formulaId", "approvalPolicyId", "evidenceId", "reviewId", "rewardClaimId", "operationId") = 1
    ) OR (
      "eventType" IN ('APPROVAL_POLICY_DRAFT_CREATED', 'APPROVAL_POLICY_ACTIVATED', 'APPROVAL_POLICY_RETIRED')
      AND "approvalPolicyId" IS NOT NULL
      AND num_nonnulls("promotionTypeId", "promotionId", "promotionVersionId", "targetId", "executionId", "formulaId", "approvalPolicyId", "evidenceId", "reviewId", "rewardClaimId", "operationId") = 1
    ) OR (
      "eventType" = 'PROMOTION_CREATED'
      AND "promotionId" IS NOT NULL
      AND num_nonnulls("promotionTypeId", "promotionId", "promotionVersionId", "targetId", "executionId", "formulaId", "approvalPolicyId", "evidenceId", "reviewId", "rewardClaimId", "operationId") = 1
    ) OR (
      "eventType" IN ('PROMOTION_VERSION_CREATED', 'PROMOTION_VERSION_PUBLISHED', 'PROMOTION_VERSION_RETIRED')
      AND "promotionId" IS NOT NULL AND "promotionVersionId" IS NOT NULL
      AND num_nonnulls("promotionTypeId", "promotionId", "promotionVersionId", "targetId", "executionId", "formulaId", "approvalPolicyId", "evidenceId", "reviewId", "rewardClaimId", "operationId") = 2
    ) OR (
      "eventType" = 'PROMOTION_TARGET_PLANNED'
      AND "promotionId" IS NOT NULL AND "promotionVersionId" IS NOT NULL
      AND "targetId" IS NOT NULL AND "operationId" IS NOT NULL
      AND num_nonnulls("promotionTypeId", "promotionId", "promotionVersionId", "targetId", "executionId", "formulaId", "approvalPolicyId", "evidenceId", "reviewId", "rewardClaimId", "operationId") = 4
    ) OR (
      "eventType" = 'PROMOTION_TARGET_ELIGIBILITY_OVERRIDDEN'
      AND "promotionId" IS NOT NULL AND "promotionVersionId" IS NOT NULL AND "targetId" IS NOT NULL
      AND "requestHash" IS NOT NULL
      AND NULLIF(btrim("payload" ->> 'operationId'), '') IS NOT NULL
      AND NULLIF(btrim("payload" ->> 'reason'), '') IS NOT NULL
      AND NULLIF(btrim("payload" ->> 'actorUserId'), '') IS NOT NULL
      AND NULLIF(btrim("payload" ->> 'occurredAt'), '') IS NOT NULL
      AND "actorUserId" = "payload" ->> 'actorUserId'
      AND "actorAgentId" IS NOT DISTINCT FROM ("payload" ->> 'actorAgentId')
      AND num_nonnulls("promotionTypeId", "promotionId", "promotionVersionId", "targetId", "executionId", "formulaId", "approvalPolicyId", "evidenceId", "reviewId", "rewardClaimId", "operationId") = 3
    ) OR (
      "eventType" IN ('EXECUTION_DRAFT_CREATED', 'EXECUTION_SUBMITTED')
      AND "targetId" IS NOT NULL AND "executionId" IS NOT NULL
      AND num_nonnulls("promotionTypeId", "promotionId", "promotionVersionId", "targetId", "executionId", "formulaId", "approvalPolicyId", "evidenceId", "reviewId", "rewardClaimId", "operationId") = 2
    ) OR (
      "eventType" = 'EVIDENCE_ADDED'
      AND "executionId" IS NOT NULL AND "evidenceId" IS NOT NULL
      AND num_nonnulls("promotionTypeId", "promotionId", "promotionVersionId", "targetId", "executionId", "formulaId", "approvalPolicyId", "evidenceId", "reviewId", "rewardClaimId", "operationId") = 2
    ) OR (
      "eventType" IN (
        'REVIEW_L1_APPROVED', 'REVIEW_L1_REJECTED', 'REVIEW_L1_RETURNED',
        'REVIEW_L2_APPROVED', 'REVIEW_L2_REJECTED', 'REVIEW_L2_RETURNED'
      )
      AND "targetId" IS NOT NULL AND "executionId" IS NOT NULL
      AND "formulaId" IS NOT NULL AND "approvalPolicyId" IS NOT NULL AND "reviewId" IS NOT NULL
      AND num_nonnulls("promotionTypeId", "promotionId", "promotionVersionId", "targetId", "executionId", "formulaId", "approvalPolicyId", "evidenceId", "reviewId", "rewardClaimId", "operationId")
        = CASE WHEN "operationId" IS NULL THEN 5 ELSE 6 END
    ) OR (
      "eventType" IN ('BULK_REVIEW_COMPLETED', 'SYSTEM_BULK_OPERATION_RECOVERED')
      AND "operationId" IS NOT NULL
      AND num_nonnulls("promotionTypeId", "promotionId", "promotionVersionId", "targetId", "executionId", "formulaId", "approvalPolicyId", "evidenceId", "reviewId", "rewardClaimId", "operationId") = 1
    )
  ),
  ADD CONSTRAINT "mtm_pharmacy_event_actor_contract" CHECK (
    num_nonnulls("actorAgentId", "actorUserId") >= 1
    OR (
      "eventType" = 'SYSTEM_BULK_OPERATION_RECOVERED'
      AND COALESCE(current_setting('app.rls_bypass', true), '') = 'on'
    )
  ),
  ADD CONSTRAINT "mtm_pharmacy_event_request_hash_valid" CHECK (
    "requestHash" IS NULL OR "requestHash" ~ '^[A-Fa-f0-9]{64}$'
  );

ALTER TABLE "mtm_pharmacy_points_formulas"
  ADD CONSTRAINT "mtm_pharmacy_formula_source_time" CHECK (
    NULLIF(btrim("sourceSystem"), '') IS NOT NULL
    AND "sourceObservedAt" <= "sourceReceivedAt" + INTERVAL '5 minutes'
  );
ALTER TABLE "mtm_pharmacy_approval_policies"
  ADD CONSTRAINT "mtm_pharmacy_policy_source_time" CHECK (
    NULLIF(btrim("sourceSystem"), '') IS NOT NULL
    AND "sourceObservedAt" <= "sourceReceivedAt" + INTERVAL '5 minutes'
  );
ALTER TABLE "mtm_pharmacy_promotion_versions"
  ADD CONSTRAINT "mtm_pharmacy_version_source_time" CHECK (
    NULLIF(btrim("sourceSystem"), '') IS NOT NULL
    AND "sourceObservedAt" <= "sourceReceivedAt" + INTERVAL '5 minutes'
  );
ALTER TABLE "mtm_pharmacy_promotion_targets"
  ADD CONSTRAINT "mtm_pharmacy_target_source_time" CHECK (
    NULLIF(btrim("sourceSystem"), '') IS NOT NULL
    AND "sourceObservedAt" <= "sourceReceivedAt" + INTERVAL '5 minutes'
  );
ALTER TABLE "mtm_pharmacy_promotion_executions"
  ADD CONSTRAINT "mtm_pharmacy_execution_source_time" CHECK (
    NULLIF(btrim("sourceSystem"), '') IS NOT NULL
    AND "sourceObservedAt" <= "sourceReceivedAt" + INTERVAL '5 minutes'
  );
ALTER TABLE "mtm_pharmacy_promotion_evidence"
  ADD CONSTRAINT "mtm_pharmacy_evidence_source_time" CHECK (
    "sourceObservedAt" <= "sourceReceivedAt" + INTERVAL '5 minutes'
    AND "capturedAt" <= "sourceObservedAt"
  );
ALTER TABLE "mtm_pharmacy_rewards"
  ADD CONSTRAINT "mtm_pharmacy_reward_source_time" CHECK (
    NULLIF(btrim("sourceSystem"), '') IS NOT NULL
    AND "sourceObservedAt" <= "sourceReceivedAt" + INTERVAL '5 minutes'
  );

-- Every business relation carries organizationId on both sides. These
-- composite FKs make cross-tenant references impossible even under bypass.
ALTER TABLE "mtm_pharmacy_promotion_types" ADD CONSTRAINT "mtm_pharmacy_types_org_fk"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_pharmacy_promotions" ADD CONSTRAINT "mtm_pharmacy_promotions_org_fk"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotions" ADD CONSTRAINT "mtm_pharmacy_promotions_creator_fk"
  FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mtm_pharmacy_points_formulas" ADD CONSTRAINT "mtm_pharmacy_formulas_org_fk"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_points_formulas" ADD CONSTRAINT "mtm_pharmacy_formulas_creator_fk"
  FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_points_formulas" ADD CONSTRAINT "mtm_pharmacy_formulas_signer_fk"
  FOREIGN KEY ("organizationId", "signedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mtm_pharmacy_approval_policies" ADD CONSTRAINT "mtm_pharmacy_policies_org_fk"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_approval_policies" ADD CONSTRAINT "mtm_pharmacy_policies_creator_fk"
  FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_approval_policies" ADD CONSTRAINT "mtm_pharmacy_policies_signer_fk"
  FOREIGN KEY ("organizationId", "signedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mtm_pharmacy_promotion_versions" ADD CONSTRAINT "mtm_pharmacy_versions_org_fk"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_versions" ADD CONSTRAINT "mtm_pharmacy_versions_promotion_fk"
  FOREIGN KEY ("organizationId", "promotionId") REFERENCES "mtm_pharmacy_promotions"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_versions" ADD CONSTRAINT "mtm_pharmacy_versions_type_fk"
  FOREIGN KEY ("organizationId", "typeId") REFERENCES "mtm_pharmacy_promotion_types"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_versions" ADD CONSTRAINT "mtm_pharmacy_versions_formula_fk"
  FOREIGN KEY ("organizationId", "formulaId") REFERENCES "mtm_pharmacy_points_formulas"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_versions" ADD CONSTRAINT "mtm_pharmacy_versions_policy_fk"
  FOREIGN KEY ("organizationId", "approvalPolicyId") REFERENCES "mtm_pharmacy_approval_policies"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_versions" ADD CONSTRAINT "mtm_pharmacy_versions_creator_fk"
  FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_versions" ADD CONSTRAINT "mtm_pharmacy_versions_publisher_fk"
  FOREIGN KEY ("organizationId", "publishedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_versions" ADD CONSTRAINT "mtm_pharmacy_versions_eligibility_approver_fk"
  FOREIGN KEY ("organizationId", "eligibilityApprovedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mtm_pharmacy_promotion_targets" ADD CONSTRAINT "mtm_pharmacy_targets_org_fk"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_targets" ADD CONSTRAINT "mtm_pharmacy_targets_version_fk"
  FOREIGN KEY ("organizationId", "promotionVersionId") REFERENCES "mtm_pharmacy_promotion_versions"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_targets" ADD CONSTRAINT "mtm_pharmacy_targets_customer_fk"
  FOREIGN KEY ("organizationId", "customerId") REFERENCES "mtm_customers"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_targets" ADD CONSTRAINT "mtm_pharmacy_targets_contact_fk"
  FOREIGN KEY ("organizationId", "contactId") REFERENCES "mtm_contacts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_targets" ADD CONSTRAINT "mtm_pharmacy_targets_agent_fk"
  FOREIGN KEY ("organizationId", "assignedAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_targets" ADD CONSTRAINT "mtm_pharmacy_targets_team_fk"
  FOREIGN KEY ("organizationId", "assignedTeamId") REFERENCES "mtm_teams"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_targets" ADD CONSTRAINT "mtm_pharmacy_targets_manager_fk"
  FOREIGN KEY ("organizationId", "managingManagerId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_targets" ADD CONSTRAINT "mtm_pharmacy_targets_creator_fk"
  FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mtm_pharmacy_promotion_executions" ADD CONSTRAINT "mtm_pharmacy_executions_org_fk"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_executions" ADD CONSTRAINT "mtm_pharmacy_executions_target_fk"
  FOREIGN KEY ("organizationId", "targetId") REFERENCES "mtm_pharmacy_promotion_targets"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_executions" ADD CONSTRAINT "mtm_pharmacy_executions_visit_fk"
  FOREIGN KEY ("organizationId", "visitId") REFERENCES "mtm_visits"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_executions" ADD CONSTRAINT "mtm_pharmacy_executions_agent_fk"
  FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_executions" ADD CONSTRAINT "mtm_pharmacy_executions_submit_agent_fk"
  FOREIGN KEY ("organizationId", "submittedByAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_executions" ADD CONSTRAINT "mtm_pharmacy_executions_submit_user_fk"
  FOREIGN KEY ("organizationId", "submittedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_executions" ADD CONSTRAINT "mtm_pharmacy_executions_formula_fk"
  FOREIGN KEY ("organizationId", "formulaId") REFERENCES "mtm_pharmacy_points_formulas"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_executions" ADD CONSTRAINT "mtm_pharmacy_executions_policy_fk"
  FOREIGN KEY ("organizationId", "approvalPolicyId") REFERENCES "mtm_pharmacy_approval_policies"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_executions" ADD CONSTRAINT "mtm_pharmacy_executions_supersedes_fk"
  FOREIGN KEY ("organizationId", "supersedesExecutionId") REFERENCES "mtm_pharmacy_promotion_executions"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "mtm_pharmacy_promotion_evidence" ADD CONSTRAINT "mtm_pharmacy_evidence_org_fk"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_evidence" ADD CONSTRAINT "mtm_pharmacy_evidence_execution_fk"
  FOREIGN KEY ("organizationId", "executionId") REFERENCES "mtm_pharmacy_promotion_executions"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_evidence" ADD CONSTRAINT "mtm_pharmacy_evidence_agent_fk"
  FOREIGN KEY ("organizationId", "submittedByAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_evidence" ADD CONSTRAINT "mtm_pharmacy_evidence_photo_fk"
  FOREIGN KEY ("organizationId", "photoId") REFERENCES "mtm_photos"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_evidence" ADD CONSTRAINT "mtm_pharmacy_evidence_document_fk"
  FOREIGN KEY ("organizationId", "documentId") REFERENCES "mtm_documents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mtm_pharmacy_promotion_reviews" ADD CONSTRAINT "mtm_pharmacy_reviews_org_fk"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_reviews" ADD CONSTRAINT "mtm_pharmacy_reviews_execution_fk"
  FOREIGN KEY ("organizationId", "executionId") REFERENCES "mtm_pharmacy_promotion_executions"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_reviews" ADD CONSTRAINT "mtm_pharmacy_reviews_agent_fk"
  FOREIGN KEY ("organizationId", "reviewerAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_reviews" ADD CONSTRAINT "mtm_pharmacy_reviews_user_fk"
  FOREIGN KEY ("organizationId", "reviewerUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_reviews" ADD CONSTRAINT "mtm_pharmacy_reviews_policy_fk"
  FOREIGN KEY ("organizationId", "approvalPolicyId") REFERENCES "mtm_pharmacy_approval_policies"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_reviews" ADD CONSTRAINT "mtm_pharmacy_reviews_formula_fk"
  FOREIGN KEY ("organizationId", "formulaId") REFERENCES "mtm_pharmacy_points_formulas"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_reviews" ADD CONSTRAINT "mtm_pharmacy_reviews_batch_fk"
  FOREIGN KEY ("organizationId", "batchId") REFERENCES "mtm_pharmacy_promotion_operations"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mtm_pharmacy_rewards" ADD CONSTRAINT "mtm_pharmacy_rewards_org_fk"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_rewards" ADD CONSTRAINT "mtm_pharmacy_rewards_creator_fk"
  FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_rewards" ADD CONSTRAINT "mtm_pharmacy_rewards_activator_fk"
  FOREIGN KEY ("organizationId", "activatedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mtm_pharmacy_reward_claims" ADD CONSTRAINT "mtm_pharmacy_claims_org_fk"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_reward_claims" ADD CONSTRAINT "mtm_pharmacy_claims_reward_fk"
  FOREIGN KEY ("organizationId", "rewardId") REFERENCES "mtm_pharmacy_rewards"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_reward_claims" ADD CONSTRAINT "mtm_pharmacy_claims_target_fk"
  FOREIGN KEY ("organizationId", "targetId") REFERENCES "mtm_pharmacy_promotion_targets"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_reward_claims" ADD CONSTRAINT "mtm_pharmacy_claims_customer_fk"
  FOREIGN KEY ("organizationId", "customerId") REFERENCES "mtm_customers"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_reward_claims" ADD CONSTRAINT "mtm_pharmacy_claims_contact_fk"
  FOREIGN KEY ("organizationId", "contactId") REFERENCES "mtm_contacts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_reward_claims" ADD CONSTRAINT "mtm_pharmacy_claims_beneficiary_fk"
  FOREIGN KEY ("organizationId", "beneficiaryAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_reward_claims" ADD CONSTRAINT "mtm_pharmacy_claims_requester_fk"
  FOREIGN KEY ("organizationId", "requestedByAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_reward_claims" ADD CONSTRAINT "mtm_pharmacy_claims_decider_fk"
  FOREIGN KEY ("organizationId", "decidedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mtm_pharmacy_promotion_operations" ADD CONSTRAINT "mtm_pharmacy_operations_org_fk"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_operations" ADD CONSTRAINT "mtm_pharmacy_operations_agent_fk"
  FOREIGN KEY ("organizationId", "actorAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_operations" ADD CONSTRAINT "mtm_pharmacy_operations_user_fk"
  FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mtm_pharmacy_points_ledger_entries" ADD CONSTRAINT "mtm_pharmacy_ledger_org_fk"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_points_ledger_entries" ADD CONSTRAINT "mtm_pharmacy_ledger_beneficiary_fk"
  FOREIGN KEY ("organizationId", "beneficiaryAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_points_ledger_entries" ADD CONSTRAINT "mtm_pharmacy_ledger_target_fk"
  FOREIGN KEY ("organizationId", "targetId") REFERENCES "mtm_pharmacy_promotion_targets"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_points_ledger_entries" ADD CONSTRAINT "mtm_pharmacy_ledger_customer_fk"
  FOREIGN KEY ("organizationId", "customerId") REFERENCES "mtm_customers"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_points_ledger_entries" ADD CONSTRAINT "mtm_pharmacy_ledger_contact_fk"
  FOREIGN KEY ("organizationId", "contactId") REFERENCES "mtm_contacts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_points_ledger_entries" ADD CONSTRAINT "mtm_pharmacy_ledger_execution_fk"
  FOREIGN KEY ("organizationId", "executionId") REFERENCES "mtm_pharmacy_promotion_executions"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_points_ledger_entries" ADD CONSTRAINT "mtm_pharmacy_ledger_review_fk"
  FOREIGN KEY ("organizationId", "reviewId") REFERENCES "mtm_pharmacy_promotion_reviews"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_points_ledger_entries" ADD CONSTRAINT "mtm_pharmacy_ledger_claim_fk"
  FOREIGN KEY ("organizationId", "rewardClaimId") REFERENCES "mtm_pharmacy_reward_claims"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_points_ledger_entries" ADD CONSTRAINT "mtm_pharmacy_ledger_formula_fk"
  FOREIGN KEY ("organizationId", "formulaId") REFERENCES "mtm_pharmacy_points_formulas"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_points_ledger_entries" ADD CONSTRAINT "mtm_pharmacy_ledger_reverses_fk"
  FOREIGN KEY ("organizationId", "reversesEntryId") REFERENCES "mtm_pharmacy_points_ledger_entries"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_points_ledger_entries" ADD CONSTRAINT "mtm_pharmacy_ledger_actor_agent_fk"
  FOREIGN KEY ("organizationId", "actorAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_points_ledger_entries" ADD CONSTRAINT "mtm_pharmacy_ledger_actor_user_fk"
  FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mtm_pharmacy_promotion_events" ADD CONSTRAINT "mtm_pharmacy_events_org_fk"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_events" ADD CONSTRAINT "mtm_pharmacy_events_promotion_type_fk"
  FOREIGN KEY ("organizationId", "promotionTypeId") REFERENCES "mtm_pharmacy_promotion_types"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_events" ADD CONSTRAINT "mtm_pharmacy_events_promotion_fk"
  FOREIGN KEY ("organizationId", "promotionId") REFERENCES "mtm_pharmacy_promotions"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_events" ADD CONSTRAINT "mtm_pharmacy_events_version_fk"
  FOREIGN KEY ("organizationId", "promotionVersionId") REFERENCES "mtm_pharmacy_promotion_versions"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_events" ADD CONSTRAINT "mtm_pharmacy_events_target_fk"
  FOREIGN KEY ("organizationId", "targetId") REFERENCES "mtm_pharmacy_promotion_targets"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_events" ADD CONSTRAINT "mtm_pharmacy_events_execution_fk"
  FOREIGN KEY ("organizationId", "executionId") REFERENCES "mtm_pharmacy_promotion_executions"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_events" ADD CONSTRAINT "mtm_pharmacy_events_formula_fk"
  FOREIGN KEY ("organizationId", "formulaId") REFERENCES "mtm_pharmacy_points_formulas"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_events" ADD CONSTRAINT "mtm_pharmacy_events_policy_fk"
  FOREIGN KEY ("organizationId", "approvalPolicyId") REFERENCES "mtm_pharmacy_approval_policies"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_events" ADD CONSTRAINT "mtm_pharmacy_events_evidence_fk"
  FOREIGN KEY ("organizationId", "evidenceId") REFERENCES "mtm_pharmacy_promotion_evidence"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_events" ADD CONSTRAINT "mtm_pharmacy_events_review_fk"
  FOREIGN KEY ("organizationId", "reviewId") REFERENCES "mtm_pharmacy_promotion_reviews"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_events" ADD CONSTRAINT "mtm_pharmacy_events_claim_fk"
  FOREIGN KEY ("organizationId", "rewardClaimId") REFERENCES "mtm_pharmacy_reward_claims"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_events" ADD CONSTRAINT "mtm_pharmacy_events_operation_fk"
  FOREIGN KEY ("organizationId", "operationId") REFERENCES "mtm_pharmacy_promotion_operations"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_events" ADD CONSTRAINT "mtm_pharmacy_events_actor_agent_fk"
  FOREIGN KEY ("organizationId", "actorAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_pharmacy_promotion_events" ADD CONSTRAINT "mtm_pharmacy_events_actor_user_fk"
  FOREIGN KEY ("organizationId", "actorUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutable definitions and append-only financial/audit facts.
CREATE OR REPLACE FUNCTION "mtm_pharmacy_append_only_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% is append-only; create a compensating/domain row instead', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' AND COALESCE(current_setting('app.rls_bypass', true), '') <> 'on' THEN
    RAISE EXCEPTION '% is append-only; tenant deletes are forbidden', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "mtm_pharmacy_evidence_append_only"
  BEFORE UPDATE OR DELETE ON "mtm_pharmacy_promotion_evidence"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_append_only_guard"();
CREATE TRIGGER "mtm_pharmacy_reviews_append_only"
  BEFORE UPDATE OR DELETE ON "mtm_pharmacy_promotion_reviews"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_append_only_guard"();
CREATE TRIGGER "mtm_pharmacy_events_append_only"
  BEFORE UPDATE OR DELETE ON "mtm_pharmacy_promotion_events"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_append_only_guard"();
CREATE TRIGGER "mtm_pharmacy_ledger_append_only"
  BEFORE UPDATE OR DELETE ON "mtm_pharmacy_points_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_append_only_guard"();

CREATE OR REPLACE FUNCTION "mtm_pharmacy_no_tenant_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(current_setting('app.rls_bypass', true), '') <> 'on' THEN
    RAISE EXCEPTION '% uses lifecycle transitions; tenant hard deletes are forbidden', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "mtm_pharmacy_types_no_delete" BEFORE DELETE ON "mtm_pharmacy_promotion_types"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_no_tenant_delete"();
CREATE TRIGGER "mtm_pharmacy_promotions_no_delete" BEFORE DELETE ON "mtm_pharmacy_promotions"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_no_tenant_delete"();
CREATE TRIGGER "mtm_pharmacy_formulas_no_delete" BEFORE DELETE ON "mtm_pharmacy_points_formulas"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_no_tenant_delete"();
CREATE TRIGGER "mtm_pharmacy_policies_no_delete" BEFORE DELETE ON "mtm_pharmacy_approval_policies"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_no_tenant_delete"();
CREATE TRIGGER "mtm_pharmacy_versions_no_delete" BEFORE DELETE ON "mtm_pharmacy_promotion_versions"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_no_tenant_delete"();
CREATE TRIGGER "mtm_pharmacy_targets_no_delete" BEFORE DELETE ON "mtm_pharmacy_promotion_targets"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_no_tenant_delete"();
CREATE TRIGGER "mtm_pharmacy_executions_no_delete" BEFORE DELETE ON "mtm_pharmacy_promotion_executions"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_no_tenant_delete"();
CREATE TRIGGER "mtm_pharmacy_rewards_no_delete" BEFORE DELETE ON "mtm_pharmacy_rewards"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_no_tenant_delete"();
CREATE TRIGGER "mtm_pharmacy_claims_no_delete" BEFORE DELETE ON "mtm_pharmacy_reward_claims"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_no_tenant_delete"();
CREATE TRIGGER "mtm_pharmacy_operations_no_delete" BEFORE DELETE ON "mtm_pharmacy_promotion_operations"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_no_tenant_delete"();

CREATE OR REPLACE FUNCTION "mtm_pharmacy_guard_signed_definition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_status TEXT := OLD."status"::text;
  new_status TEXT := NEW."status"::text;
  allowed_keys TEXT[];
BEGIN
  IF TG_TABLE_NAME = 'mtm_pharmacy_rewards' THEN
    allowed_keys := ARRAY['status', 'retiredAt', 'updatedAt'];
  ELSE
    allowed_keys := ARRAY['status', 'retiredAt', 'updatedAt'];
  END IF;

  IF old_status <> 'DRAFT'
     AND (to_jsonb(NEW) - allowed_keys) IS DISTINCT FROM (to_jsonb(OLD) - allowed_keys) THEN
    RAISE EXCEPTION '% signed definition content is immutable', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  IF old_status = 'DRAFT' AND new_status NOT IN ('DRAFT', 'ACTIVE') THEN
    RAISE EXCEPTION 'invalid definition transition % -> %', old_status, new_status USING ERRCODE = '23514';
  ELSIF old_status = 'ACTIVE' AND new_status NOT IN ('ACTIVE', 'RETIRED') THEN
    RAISE EXCEPTION 'invalid definition transition % -> %', old_status, new_status USING ERRCODE = '23514';
  ELSIF old_status = 'RETIRED' AND new_status <> 'RETIRED' THEN
    RAISE EXCEPTION 'retired definition cannot transition to %', new_status USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "mtm_pharmacy_formula_immutable"
  BEFORE UPDATE ON "mtm_pharmacy_points_formulas"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_guard_signed_definition"();
CREATE TRIGGER "mtm_pharmacy_policy_immutable"
  BEFORE UPDATE ON "mtm_pharmacy_approval_policies"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_guard_signed_definition"();
CREATE TRIGGER "mtm_pharmacy_reward_immutable"
  BEFORE UPDATE ON "mtm_pharmacy_rewards"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_guard_signed_definition"();

CREATE OR REPLACE FUNCTION "mtm_pharmacy_guard_promotion_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  formula_row "mtm_pharmacy_points_formulas"%ROWTYPE;
  policy_row "mtm_pharmacy_approval_policies"%ROWTYPE;
  type_status "MtmPharmacyDefinitionStatus";
  old_status TEXT;
  new_status TEXT := NEW."status"::text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_status := OLD."status"::text;
    IF old_status <> 'DRAFT'
       AND (to_jsonb(NEW) - ARRAY['status', 'retiredAt', 'cancelledAt', 'updatedAt'])
           IS DISTINCT FROM
           (to_jsonb(OLD) - ARRAY['status', 'retiredAt', 'cancelledAt', 'updatedAt']) THEN
      RAISE EXCEPTION 'published promotion version content is immutable' USING ERRCODE = '55000';
    END IF;

    IF old_status = 'DRAFT' AND new_status NOT IN ('DRAFT', 'PUBLISHED', 'CANCELLED') THEN
      RAISE EXCEPTION 'invalid promotion version transition % -> %', old_status, new_status USING ERRCODE = '23514';
    ELSIF old_status = 'PUBLISHED' AND new_status NOT IN ('PUBLISHED', 'RETIRED', 'CANCELLED') THEN
      RAISE EXCEPTION 'invalid promotion version transition % -> %', old_status, new_status USING ERRCODE = '23514';
    ELSIF old_status IN ('RETIRED', 'CANCELLED') AND new_status <> old_status THEN
      RAISE EXCEPTION 'terminal promotion version cannot transition to %', new_status USING ERRCODE = '23514';
    END IF;
  END IF;

  IF new_status = 'PUBLISHED' THEN
    SELECT * INTO formula_row
      FROM "mtm_pharmacy_points_formulas"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."formulaId";
    IF NOT FOUND OR formula_row."status" <> 'ACTIVE'
       OR formula_row."signedAt" IS NULL OR formula_row."signedByUserId" IS NULL
       OR NULLIF(btrim(formula_row."approvalReference"), '') IS NULL THEN
      RAISE EXCEPTION 'promotion publication requires an active signed formula with approval reference'
        USING ERRCODE = '23514';
    END IF;

    SELECT * INTO policy_row
      FROM "mtm_pharmacy_approval_policies"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."approvalPolicyId";
    IF NOT FOUND OR policy_row."status" <> 'ACTIVE'
       OR policy_row."signedAt" IS NULL OR policy_row."signedByUserId" IS NULL
       OR NULLIF(btrim(policy_row."approvalReference"), '') IS NULL THEN
      RAISE EXCEPTION 'promotion publication requires an active signed approval policy with approval reference'
        USING ERRCODE = '23514';
    END IF;

    SELECT "status" INTO type_status
      FROM "mtm_pharmacy_promotion_types"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."typeId";
    IF NOT FOUND OR type_status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'promotion publication requires an active promotion type' USING ERRCODE = '23514';
    END IF;

    IF NULLIF(btrim(NEW."approvalReference"), '') IS NULL
       OR NULLIF(btrim(NEW."eligibilityApprovalReference"), '') IS NULL
       OR NEW."eligibilityApprovedByUserId" IS NULL
       OR NEW."eligibilityApprovedAt" IS NULL THEN
      RAISE EXCEPTION 'promotion and eligibility approvals must be explicitly pinned before publication'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "mtm_pharmacy_promotion_version_guard"
  BEFORE INSERT OR UPDATE ON "mtm_pharmacy_promotion_versions"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_guard_promotion_version"();

CREATE OR REPLACE FUNCTION "mtm_pharmacy_guard_target_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_status TEXT;
  new_status TEXT := NEW."status"::text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."eligibilityStatus" = 'OVERRIDDEN' THEN
      RAISE EXCEPTION 'a target cannot start with an eligibility override'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  old_status := OLD."status"::text;

  IF old_status <> 'PLANNED'
     AND (to_jsonb(NEW) - ARRAY['status', 'eligibilityStatus', 'eligibilitySnapshot', 'eligibilityOverrideReason', 'connectedAt', 'closedAt', 'cancelledAt', 'updatedAt'])
         IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['status', 'eligibilityStatus', 'eligibilitySnapshot', 'eligibilityOverrideReason', 'connectedAt', 'closedAt', 'cancelledAt', 'updatedAt']) THEN
    RAISE EXCEPTION 'connected promotion target plan and ownership snapshots are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF old_status = 'PLANNED' AND new_status NOT IN ('PLANNED', 'CONNECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'invalid target transition % -> %', old_status, new_status USING ERRCODE = '23514';
  ELSIF old_status = 'CONNECTED' AND new_status NOT IN ('CONNECTED', 'CLOSED', 'CANCELLED') THEN
    RAISE EXCEPTION 'invalid target transition % -> %', old_status, new_status USING ERRCODE = '23514';
  ELSIF old_status IN ('CLOSED', 'CANCELLED') AND new_status <> old_status THEN
    RAISE EXCEPTION 'terminal target cannot transition to %', new_status USING ERRCODE = '23514';
  END IF;

  IF OLD."connectedAt" IS NOT NULL AND NEW."connectedAt" IS DISTINCT FROM OLD."connectedAt" THEN
    RAISE EXCEPTION 'target connectedAt is immutable once recorded' USING ERRCODE = '55000';
  END IF;
  IF OLD."closedAt" IS NOT NULL AND NEW."closedAt" IS DISTINCT FROM OLD."closedAt" THEN
    RAISE EXCEPTION 'target closedAt is immutable once recorded' USING ERRCODE = '55000';
  END IF;
  IF OLD."cancelledAt" IS NOT NULL AND NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt" THEN
    RAISE EXCEPTION 'target cancelledAt is immutable once recorded' USING ERRCODE = '55000';
  END IF;

  IF (NEW."eligibilityStatus", NEW."eligibilitySnapshot", NEW."eligibilityOverrideReason")
       IS DISTINCT FROM
       (OLD."eligibilityStatus", OLD."eligibilitySnapshot", OLD."eligibilityOverrideReason")
     AND NOT (
       (OLD."eligibilityStatus" = 'PENDING' AND NEW."eligibilityStatus" IN ('PENDING', 'ELIGIBLE', 'INELIGIBLE', 'OVERRIDDEN'))
       OR (OLD."eligibilityStatus" = 'INELIGIBLE' AND NEW."eligibilityStatus" = 'OVERRIDDEN')
     ) THEN
    RAISE EXCEPTION 'evaluated target eligibility snapshot is immutable except for a governed override'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "mtm_pharmacy_target_transition_guard"
  BEFORE INSERT OR UPDATE ON "mtm_pharmacy_promotion_targets"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_guard_target_transition"();

CREATE OR REPLACE FUNCTION "mtm_pharmacy_validate_execution"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_row "mtm_pharmacy_promotion_targets"%ROWTYPE;
  version_row "mtm_pharmacy_promotion_versions"%ROWTYPE;
  formula_row "mtm_pharmacy_points_formulas"%ROWTYPE;
  policy_row "mtm_pharmacy_approval_policies"%ROWTYPE;
  visit_row "mtm_visits"%ROWTYPE;
  submitter_agent_count INTEGER;
  submitter_agent_id TEXT;
  prior_row "mtm_pharmacy_promotion_executions"%ROWTYPE;
  old_status TEXT;
  new_status TEXT := NEW."status"::text;
BEGIN
  IF TG_OP = 'INSERT' AND new_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'new execution must start as DRAFT'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_status := OLD."status"::text;

    IF old_status <> 'DRAFT'
       AND (to_jsonb(NEW) - ARRAY['status', 'l1State', 'l2State', 'version', 'closedAt', 'updatedAt'])
           IS DISTINCT FROM
           (to_jsonb(OLD) - ARRAY['status', 'l1State', 'l2State', 'version', 'closedAt', 'updatedAt']) THEN
      RAISE EXCEPTION 'submitted execution facts and calculation snapshots are immutable'
        USING ERRCODE = '55000';
    END IF;

    IF old_status = 'DRAFT' AND new_status NOT IN ('DRAFT', 'READY') THEN
      RAISE EXCEPTION 'invalid execution transition % -> %', old_status, new_status USING ERRCODE = '23514';
    ELSIF old_status = 'READY' AND new_status NOT IN ('READY', 'IN_REVIEW', 'RETURNED', 'REJECTED') THEN
      RAISE EXCEPTION 'invalid execution transition % -> %', old_status, new_status USING ERRCODE = '23514';
    ELSIF old_status = 'IN_REVIEW' AND new_status NOT IN ('IN_REVIEW', 'APPROVED', 'RETURNED', 'REJECTED') THEN
      RAISE EXCEPTION 'invalid execution transition % -> %', old_status, new_status USING ERRCODE = '23514';
    ELSIF old_status = 'APPROVED' AND new_status NOT IN ('APPROVED', 'REVERSED') THEN
      RAISE EXCEPTION 'invalid execution transition % -> %', old_status, new_status USING ERRCODE = '23514';
    ELSIF old_status IN ('RETURNED', 'REJECTED', 'REVERSED') AND new_status <> old_status THEN
      RAISE EXCEPTION 'terminal execution cannot transition to %; create a successor execution', new_status USING ERRCODE = '23514';
    END IF;

    IF (NEW."status", NEW."l1State", NEW."l2State") IS DISTINCT FROM (OLD."status", OLD."l1State", OLD."l2State")
       AND NEW."version" <> OLD."version" + 1 THEN
      RAISE EXCEPTION 'workflow transition requires an exact optimistic version increment'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  SELECT * INTO target_row
    FROM "mtm_pharmacy_promotion_targets"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."targetId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'execution target is missing in tenant' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO version_row
    FROM "mtm_pharmacy_promotion_versions"
    WHERE "organizationId" = NEW."organizationId" AND "id" = target_row."promotionVersionId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'target promotion version is missing in tenant' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO formula_row
    FROM "mtm_pharmacy_points_formulas"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."formulaId";
  SELECT * INTO policy_row
    FROM "mtm_pharmacy_approval_policies"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."approvalPolicyId";

  IF NEW."agentId" <> target_row."assignedAgentId"
     OR NEW."planQuantitySnapshot" <> target_row."planQuantity"
     OR NEW."unit" <> target_row."unit" THEN
    RAISE EXCEPTION 'execution owner/plan/unit must match its immutable target snapshot'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."formulaId" <> version_row."formulaId"
     OR NEW."approvalPolicyId" <> version_row."approvalPolicyId"
     OR formula_row."id" IS NULL OR policy_row."id" IS NULL
     OR NEW."formulaVersion" <> formula_row."version"
     OR NEW."formulaHash" <> formula_row."definitionHash"
     OR NEW."approvalPolicyVersion" <> policy_row."version"
     OR NEW."approvalPolicyHash" <> policy_row."definitionHash" THEN
    RAISE EXCEPTION 'execution must pin the published formula and approval policy exactly'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."submittedByAgentId" IS NOT NULL AND NEW."submittedByAgentId" <> NEW."agentId" THEN
    RAISE EXCEPTION 'agent submitter must be the execution owner' USING ERRCODE = '42501';
  END IF;

  IF NEW."submittedByUserId" IS NOT NULL THEN
    SELECT count(*), min("id") INTO submitter_agent_count, submitter_agent_id
      FROM "mtm_agents"
      WHERE "organizationId" = NEW."organizationId" AND "userId" = NEW."submittedByUserId";
    IF submitter_agent_count <> 1 OR submitter_agent_id <> NEW."agentId" THEN
      RAISE EXCEPTION 'user submitter must map uniquely to the execution owner agent'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW."supersedesExecutionId" IS NOT NULL THEN
    SELECT * INTO prior_row
      FROM "mtm_pharmacy_promotion_executions"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."supersedesExecutionId";
    IF NOT FOUND OR prior_row."targetId" <> NEW."targetId" OR prior_row."agentId" <> NEW."agentId"
       OR prior_row."status" NOT IN ('RETURNED', 'REJECTED') THEN
      RAISE EXCEPTION 'successor execution must replace a returned/rejected fact for the same target and agent'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."visitId" IS NOT NULL THEN
    SELECT * INTO visit_row
      FROM "mtm_visits"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."visitId";
    IF NOT FOUND OR visit_row."customerId" <> target_row."customerId"
       OR visit_row."deletedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'execution visit must be active and belong to the target pharmacy' USING ERRCODE = '23514';
    END IF;
    IF visit_row."agentId" <> NEW."agentId" AND NOT EXISTS (
      SELECT 1 FROM "mtm_visit_participants" participant
      WHERE participant."organizationId" = NEW."organizationId"
        AND participant."visitId" = NEW."visitId"
        AND participant."agentId" = NEW."agentId"
        AND participant."leftAt" IS NULL
    ) THEN
      RAISE EXCEPTION 'execution agent must own or actively participate in the visit' USING ERRCODE = '42501';
    END IF;
    IF new_status <> 'DRAFT'
       AND NOT (
         target_row."eligibilityStatus" = 'OVERRIDDEN'
         AND NULLIF(BTRIM(target_row."eligibilityOverrideReason"), '') IS NOT NULL
       )
       AND (visit_row."status" <> 'CHECKED_OUT' OR visit_row."checkOutAt" IS NULL) THEN
      RAISE EXCEPTION 'a submitted execution may only link a completed visit'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF new_status <> 'DRAFT' THEN
    IF target_row."status" NOT IN ('CONNECTED', 'CLOSED')
       OR version_row."status" NOT IN ('PUBLISHED', 'RETIRED') THEN
      RAISE EXCEPTION 'only connected targets of a published version may be submitted'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "mtm_pharmacy_execution_guard"
  BEFORE INSERT OR UPDATE ON "mtm_pharmacy_promotion_executions"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_validate_execution"();

CREATE OR REPLACE FUNCTION "mtm_pharmacy_validate_evidence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  execution_row "mtm_pharmacy_promotion_executions"%ROWTYPE;
  photo_row "mtm_photos"%ROWTYPE;
  document_row "mtm_documents"%ROWTYPE;
BEGIN
  SELECT * INTO execution_row
    FROM "mtm_pharmacy_promotion_executions"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."executionId";
  IF NOT FOUND OR execution_row."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'evidence may only be attached while its execution is DRAFT'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."submittedByAgentId" <> execution_row."agentId" THEN
    RAISE EXCEPTION 'evidence submitter must be the execution owner' USING ERRCODE = '42501';
  END IF;

  IF NEW."photoId" IS NOT NULL THEN
    SELECT * INTO photo_row FROM "mtm_photos"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."photoId";
    IF NOT FOUND OR photo_row."agentId" <> execution_row."agentId"
       OR (execution_row."visitId" IS NOT NULL AND photo_row."visitId" IS DISTINCT FROM execution_row."visitId") THEN
      RAISE EXCEPTION 'photo evidence must belong to the execution agent and visit'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO document_row FROM "mtm_documents"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."documentId";
    IF NOT FOUND
       OR (document_row."uploadedByAgentId" IS NOT NULL AND document_row."uploadedByAgentId" <> execution_row."agentId")
       OR (execution_row."visitId" IS NOT NULL AND document_row."visitId" IS DISTINCT FROM execution_row."visitId") THEN
      RAISE EXCEPTION 'document evidence must belong to the execution agent and visit'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "mtm_pharmacy_evidence_guard"
  BEFORE INSERT ON "mtm_pharmacy_promotion_evidence"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_validate_evidence"();

CREATE OR REPLACE FUNCTION "mtm_pharmacy_execution_requires_evidence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  required_evidence INTEGER;
  actual_evidence INTEGER;
  require_completed_visit BOOLEAN;
  eligibility_override_active BOOLEAN;
BEGIN
  IF NEW."status" <> 'DRAFT' THEN
    SELECT
        (version."eligibilityDefinition" ->> 'minimumEvidenceCount')::integer,
        (version."eligibilityDefinition" ->> 'requireCompletedVisit')::boolean,
        target."eligibilityStatus" = 'OVERRIDDEN'
          AND NULLIF(BTRIM(target."eligibilityOverrideReason"), '') IS NOT NULL
      INTO required_evidence, require_completed_visit, eligibility_override_active
      FROM "mtm_pharmacy_promotion_targets" target
      JOIN "mtm_pharmacy_promotion_versions" version
        ON version."organizationId" = target."organizationId"
       AND version."id" = target."promotionVersionId"
      WHERE target."organizationId" = NEW."organizationId" AND target."id" = NEW."targetId";
    IF eligibility_override_active THEN
      required_evidence := 0;
    END IF;
    IF NOT eligibility_override_active AND (
      require_completed_visit IS NULL
      OR (
        require_completed_visit
        AND NOT EXISTS (
          SELECT 1 FROM "mtm_visits" visit
          WHERE visit."organizationId" = NEW."organizationId"
            AND visit."id" = NEW."visitId"
            AND visit."status" = 'CHECKED_OUT'
            AND visit."checkOutAt" IS NOT NULL
            AND visit."deletedAt" IS NULL
        )
      )
    ) THEN
      RAISE EXCEPTION 'submitted execution requires an active completed visit under signed eligibility'
        USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO actual_evidence
      FROM "mtm_pharmacy_promotion_evidence"
      WHERE "organizationId" = NEW."organizationId" AND "executionId" = NEW."id";
    IF required_evidence IS NULL OR actual_evidence < required_evidence THEN
      RAISE EXCEPTION 'submitted execution has % evidence rows but signed eligibility requires %', actual_evidence, required_evidence
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "mtm_pharmacy_promotion_targets"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."targetId"
        AND "eligibilityStatus" IN ('ELIGIBLE', 'OVERRIDDEN')
    ) THEN
      RAISE EXCEPTION 'submitted execution requires an atomically evaluated eligible target'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "mtm_pharmacy_execution_evidence_required"
  AFTER INSERT OR UPDATE ON "mtm_pharmacy_promotion_executions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_execution_requires_evidence"();

CREATE OR REPLACE FUNCTION "mtm_pharmacy_validate_review"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  execution_row "mtm_pharmacy_promotion_executions"%ROWTYPE;
  policy_row "mtm_pharmacy_approval_policies"%ROWTYPE;
  l1_row "mtm_pharmacy_promotion_reviews"%ROWTYPE;
  reviewer_user_from_agent TEXT;
  l1_user_from_agent TEXT;
  submitter_user_from_agent TEXT;
BEGIN
  SELECT * INTO execution_row
    FROM "mtm_pharmacy_promotion_executions"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."executionId";
  SELECT * INTO policy_row
    FROM "mtm_pharmacy_approval_policies"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."approvalPolicyId";

  IF execution_row."id" IS NULL OR policy_row."id" IS NULL
     OR execution_row."status" NOT IN ('READY', 'IN_REVIEW') THEN
    RAISE EXCEPTION 'only ready/in-review execution can receive a decision' USING ERRCODE = '23514';
  END IF;
  IF NEW."approvalPolicyId" <> execution_row."approvalPolicyId"
     OR NEW."approvalPolicyVersion" <> execution_row."approvalPolicyVersion"
     OR NEW."approvalPolicyHash" <> execution_row."approvalPolicyHash"
     OR NEW."formulaId" <> execution_row."formulaId"
     OR NEW."formulaVersion" <> execution_row."formulaVersion"
     OR NEW."formulaHash" <> execution_row."formulaHash"
     OR NEW."factPointsPreview" IS DISTINCT FROM execution_row."factPointsPreview"
     OR NEW."rewardPointsPreview" IS DISTINCT FROM execution_row."rewardPointsPreview"
     OR NEW."differencePointsPreview" IS DISTINCT FROM execution_row."differencePointsPreview" THEN
    RAISE EXCEPTION 'review must pin the execution policy, formula, and all point previews exactly'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."decision" = 'REJECTED' AND policy_row."requireRejectReason"
     AND NULLIF(btrim(NEW."reason"), '') IS NULL THEN
    RAISE EXCEPTION 'signed approval policy requires a rejection reason' USING ERRCODE = '23514';
  END IF;
  IF NEW."decision" = 'RETURNED' AND policy_row."requireReturnReason"
     AND NULLIF(btrim(NEW."reason"), '') IS NULL THEN
    RAISE EXCEPTION 'signed approval policy requires a return reason' USING ERRCODE = '23514';
  END IF;

  IF NEW."reviewerAgentId" IS NOT NULL THEN
    SELECT "userId" INTO reviewer_user_from_agent FROM "mtm_agents"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."reviewerAgentId";
  END IF;
  IF NEW."reviewerAgentId" IS NOT NULL AND NEW."reviewerUserId" IS NOT NULL
     AND reviewer_user_from_agent IS DISTINCT FROM NEW."reviewerUserId" THEN
    RAISE EXCEPTION 'reviewer agent and user identities must describe the same actor'
      USING ERRCODE = '42501';
  END IF;
  IF execution_row."submittedByAgentId" IS NOT NULL THEN
    SELECT "userId" INTO submitter_user_from_agent FROM "mtm_agents"
      WHERE "organizationId" = NEW."organizationId" AND "id" = execution_row."submittedByAgentId";
  END IF;

  IF NOT policy_row."allowSelfApproval" AND (
    (NEW."reviewerAgentId" IS NOT NULL AND NEW."reviewerAgentId" = execution_row."submittedByAgentId")
    OR (NEW."reviewerUserId" IS NOT NULL AND NEW."reviewerUserId" = execution_row."submittedByUserId")
    OR (NEW."reviewerUserId" IS NOT NULL AND NEW."reviewerUserId" = submitter_user_from_agent)
    OR (reviewer_user_from_agent IS NOT NULL AND reviewer_user_from_agent = execution_row."submittedByUserId")
    OR (reviewer_user_from_agent IS NOT NULL AND reviewer_user_from_agent = submitter_user_from_agent)
  ) THEN
    RAISE EXCEPTION 'signed approval policy forbids self-approval' USING ERRCODE = '42501';
  END IF;

  IF NEW."level" = 'L2' THEN
    SELECT * INTO l1_row
      FROM "mtm_pharmacy_promotion_reviews"
      WHERE "organizationId" = NEW."organizationId"
        AND "executionId" = NEW."executionId"
        AND "level" = 'L1';
    IF NOT FOUND OR l1_row."decision" <> 'APPROVED' THEN
      RAISE EXCEPTION 'L2 decision requires an approved L1 decision' USING ERRCODE = '23514';
    END IF;

    IF l1_row."reviewerAgentId" IS NOT NULL THEN
      SELECT "userId" INTO l1_user_from_agent FROM "mtm_agents"
        WHERE "organizationId" = NEW."organizationId" AND "id" = l1_row."reviewerAgentId";
    END IF;
    IF policy_row."requireDistinctReviewers" AND (
      (NEW."reviewerAgentId" IS NOT NULL AND NEW."reviewerAgentId" = l1_row."reviewerAgentId")
      OR (NEW."reviewerUserId" IS NOT NULL AND NEW."reviewerUserId" = l1_row."reviewerUserId")
      OR (NEW."reviewerUserId" IS NOT NULL AND NEW."reviewerUserId" = l1_user_from_agent)
      OR (reviewer_user_from_agent IS NOT NULL AND reviewer_user_from_agent = l1_row."reviewerUserId")
      OR (reviewer_user_from_agent IS NOT NULL AND reviewer_user_from_agent = l1_user_from_agent)
    ) THEN
      RAISE EXCEPTION 'signed approval policy requires distinct L1 and L2 reviewers'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "mtm_pharmacy_review_guard"
  BEFORE INSERT ON "mtm_pharmacy_promotion_reviews"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_validate_review"();

CREATE OR REPLACE FUNCTION "mtm_pharmacy_validate_ledger_entry"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  execution_row "mtm_pharmacy_promotion_executions"%ROWTYPE;
  review_row "mtm_pharmacy_promotion_reviews"%ROWTYPE;
  target_row "mtm_pharmacy_promotion_targets"%ROWTYPE;
  claim_row "mtm_pharmacy_reward_claims"%ROWTYPE;
  original_row "mtm_pharmacy_points_ledger_entries"%ROWTYPE;
  formula_row "mtm_pharmacy_points_formulas"%ROWTYPE;
  running_reward_balance DECIMAL(30,4);
  expected_delta DECIMAL(18,4);
BEGIN
  -- Serializes concurrent awards, adjustments, and reward claims for one
  -- beneficiary without introducing a mutable balance row.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'mtm-pharmacy-ledger:' || NEW."organizationId" || ':' || NEW."beneficiaryAgentId", 0
  ));

  IF NEW."entryType" = 'AWARD' THEN
    SELECT * INTO execution_row FROM "mtm_pharmacy_promotion_executions"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."executionId";
    SELECT * INTO review_row FROM "mtm_pharmacy_promotion_reviews"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."reviewId";
    IF execution_row."id" IS NULL OR review_row."id" IS NULL
       OR execution_row."status" <> 'APPROVED'
       OR review_row."executionId" <> execution_row."id"
       OR review_row."level" <> 'L2' OR review_row."decision" <> 'APPROVED' THEN
      RAISE EXCEPTION 'AWARD requires the approved execution and its approved L2 review'
        USING ERRCODE = '23514';
    END IF;

    SELECT * INTO target_row FROM "mtm_pharmacy_promotion_targets"
      WHERE "organizationId" = NEW."organizationId" AND "id" = execution_row."targetId";
    IF NEW."beneficiaryAgentId" <> execution_row."agentId"
       OR NEW."targetId" IS DISTINCT FROM execution_row."targetId"
       OR NEW."customerId" IS DISTINCT FROM target_row."customerId"
       OR NEW."contactId" IS DISTINCT FROM target_row."contactId"
       OR NEW."rewardClaimId" IS NOT NULL THEN
      RAISE EXCEPTION 'AWARD subject must match its execution target and beneficiary'
        USING ERRCODE = '23514';
    END IF;

    expected_delta := CASE NEW."bucket"
      WHEN 'FACT_POINTS' THEN execution_row."factPointsPreview"
      WHEN 'REWARD_POINTS' THEN execution_row."rewardPointsPreview"
    END;
    IF expected_delta IS NULL OR NEW."delta" <> expected_delta
       OR NEW."formulaId" <> execution_row."formulaId"
       OR NEW."formulaVersion" <> execution_row."formulaVersion"
       OR NEW."formulaHash" <> execution_row."formulaHash" THEN
      RAISE EXCEPTION 'AWARD must equal the pinned server preview for its points bucket'
        USING ERRCODE = '23514';
    END IF;

  ELSIF NEW."entryType" = 'REWARD_DEBIT' THEN
    SELECT * INTO claim_row FROM "mtm_pharmacy_reward_claims"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."rewardClaimId";
    IF claim_row."id" IS NULL OR claim_row."status" <> 'APPROVED'
       OR NEW."beneficiaryAgentId" <> claim_row."beneficiaryAgentId"
       OR NEW."targetId" IS DISTINCT FROM claim_row."targetId"
       OR NEW."customerId" IS DISTINCT FROM claim_row."customerId"
       OR NEW."contactId" IS DISTINCT FROM claim_row."contactId"
       OR NEW."delta" <> -claim_row."totalPointsCost"
       OR NEW."executionId" IS NOT NULL OR NEW."reviewId" IS NOT NULL THEN
      RAISE EXCEPTION 'REWARD_DEBIT must equal an approved claim for the same beneficiary and subject'
        USING ERRCODE = '23514';
    END IF;

  ELSIF NEW."entryType" = 'REVERSAL' THEN
    SELECT * INTO original_row FROM "mtm_pharmacy_points_ledger_entries"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."reversesEntryId";
    IF original_row."id" IS NULL OR original_row."entryType" = 'REVERSAL'
       OR NEW."beneficiaryAgentId" <> original_row."beneficiaryAgentId"
       OR NEW."bucket" <> original_row."bucket"
       OR NEW."delta" <> -original_row."delta"
       OR NEW."targetId" IS DISTINCT FROM original_row."targetId"
       OR NEW."customerId" IS DISTINCT FROM original_row."customerId"
       OR NEW."contactId" IS DISTINCT FROM original_row."contactId"
       OR NEW."executionId" IS DISTINCT FROM original_row."executionId"
       OR NEW."rewardClaimId" IS DISTINCT FROM original_row."rewardClaimId"
       OR NULLIF(btrim(NEW."reason"), '') IS NULL THEN
      RAISE EXCEPTION 'REVERSAL must exactly compensate one original entry for the same subject'
        USING ERRCODE = '23514';
    END IF;

  ELSE
    SELECT * INTO formula_row FROM "mtm_pharmacy_points_formulas"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."formulaId";
    IF formula_row."id" IS NULL OR formula_row."status" <> 'ACTIVE'
       OR formula_row."version" <> NEW."formulaVersion"
       OR formula_row."definitionHash" <> NEW."formulaHash"
       OR NULLIF(btrim(formula_row."approvalReference"), '') IS NULL THEN
      RAISE EXCEPTION 'adjustment requires a current signed versioned formula'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."bucket" = 'REWARD_POINTS' THEN
    SELECT COALESCE(sum("delta"), 0) INTO running_reward_balance
      FROM "mtm_pharmacy_points_ledger_entries"
      WHERE "organizationId" = NEW."organizationId"
        AND "beneficiaryAgentId" = NEW."beneficiaryAgentId"
        AND "bucket" = 'REWARD_POINTS';
    IF running_reward_balance + NEW."delta" < 0 THEN
      RAISE EXCEPTION 'reward points balance cannot become negative' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "mtm_pharmacy_ledger_entry_guard"
  BEFORE INSERT ON "mtm_pharmacy_points_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_validate_ledger_entry"();

CREATE OR REPLACE FUNCTION "mtm_pharmacy_validate_review_state_at_commit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  execution_row "mtm_pharmacy_promotion_executions"%ROWTYPE;
  expected_state TEXT;
  actual_state TEXT;
BEGIN
  SELECT * INTO execution_row FROM "mtm_pharmacy_promotion_executions"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."executionId";
  expected_state := CASE NEW."decision"::text
    WHEN 'APPROVED' THEN 'APPROVED'
    WHEN 'REJECTED' THEN 'REJECTED'
    WHEN 'RETURNED' THEN 'RETURNED'
  END;
  actual_state := CASE NEW."level"::text
    WHEN 'L1' THEN execution_row."l1State"::text
    WHEN 'L2' THEN execution_row."l2State"::text
  END;
  IF actual_state IS DISTINCT FROM expected_state THEN
    RAISE EXCEPTION 'review decision and execution review state must commit atomically'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "mtm_pharmacy_review_state_atomic"
  AFTER INSERT ON "mtm_pharmacy_promotion_reviews"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_validate_review_state_at_commit"();

CREATE OR REPLACE FUNCTION "mtm_pharmacy_validate_execution_workflow_at_commit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  execution_row "mtm_pharmacy_promotion_executions"%ROWTYPE;
  l1_decision TEXT;
  l2_decision TEXT;
  l1_count INTEGER;
  l2_count INTEGER;
  workflow_valid BOOLEAN := FALSE;
BEGIN
  -- Read the final row rather than NEW: a review and its execution transition
  -- are intentionally allowed to occur in either order inside one transaction.
  SELECT * INTO execution_row
    FROM "mtm_pharmacy_promotion_executions"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."id";
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    max("decision"::text) FILTER (WHERE "level" = 'L1'),
    max("decision"::text) FILTER (WHERE "level" = 'L2'),
    count(*) FILTER (WHERE "level" = 'L1'),
    count(*) FILTER (WHERE "level" = 'L2')
  INTO l1_decision, l2_decision, l1_count, l2_count
  FROM "mtm_pharmacy_promotion_reviews"
  WHERE "organizationId" = execution_row."organizationId"
    AND "executionId" = execution_row."id";

  CASE execution_row."status"::text
    WHEN 'DRAFT' THEN
      workflow_valid := execution_row."l1State"::text = 'NOT_READY'
        AND execution_row."l2State"::text = 'NOT_READY'
        AND l1_count = 0 AND l2_count = 0;
    WHEN 'READY' THEN
      workflow_valid := execution_row."l1State"::text = 'READY'
        AND execution_row."l2State"::text = 'NOT_READY'
        AND l1_count = 0 AND l2_count = 0;
    WHEN 'IN_REVIEW' THEN
      workflow_valid := execution_row."l1State"::text = 'APPROVED'
        AND execution_row."l2State"::text = 'READY'
        AND l1_count = 1 AND l1_decision = 'APPROVED'
        AND l2_count = 0;
    WHEN 'RETURNED' THEN
      workflow_valid := (
        execution_row."l1State"::text = 'RETURNED'
        AND execution_row."l2State"::text = 'NOT_READY'
        AND l1_count = 1 AND l1_decision = 'RETURNED'
        AND l2_count = 0
      ) OR (
        execution_row."l1State"::text = 'APPROVED'
        AND execution_row."l2State"::text = 'RETURNED'
        AND l1_count = 1 AND l1_decision = 'APPROVED'
        AND l2_count = 1 AND l2_decision = 'RETURNED'
      );
    WHEN 'REJECTED' THEN
      workflow_valid := (
        execution_row."l1State"::text = 'REJECTED'
        AND execution_row."l2State"::text = 'NOT_READY'
        AND l1_count = 1 AND l1_decision = 'REJECTED'
        AND l2_count = 0
      ) OR (
        execution_row."l1State"::text = 'APPROVED'
        AND execution_row."l2State"::text = 'REJECTED'
        AND l1_count = 1 AND l1_decision = 'APPROVED'
        AND l2_count = 1 AND l2_decision = 'REJECTED'
      );
    WHEN 'APPROVED' THEN
      workflow_valid := execution_row."l1State"::text = 'APPROVED'
        AND execution_row."l2State"::text = 'APPROVED'
        AND l1_count = 1 AND l1_decision = 'APPROVED'
        AND l2_count = 1 AND l2_decision = 'APPROVED';
    WHEN 'REVERSED' THEN
      workflow_valid := execution_row."l1State"::text = 'APPROVED'
        AND execution_row."l2State"::text = 'APPROVED'
        AND l1_count = 1 AND l1_decision = 'APPROVED'
        AND l2_count = 1 AND l2_decision = 'APPROVED';
    ELSE
      workflow_valid := FALSE;
  END CASE;

  IF workflow_valid IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'execution status, review states, and immutable decisions must commit atomically'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "mtm_pharmacy_execution_workflow_atomic"
  AFTER INSERT OR UPDATE ON "mtm_pharmacy_promotion_executions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_validate_execution_workflow_at_commit"();

CREATE OR REPLACE FUNCTION "mtm_pharmacy_validate_execution_approval_at_commit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'APPROVED' THEN
    IF NEW."l1State" <> 'APPROVED' OR NEW."l2State" <> 'APPROVED'
       OR NOT EXISTS (
         SELECT 1 FROM "mtm_pharmacy_promotion_reviews"
         WHERE "organizationId" = NEW."organizationId" AND "executionId" = NEW."id"
           AND "level" = 'L1' AND "decision" = 'APPROVED'
       )
       OR NOT EXISTS (
         SELECT 1 FROM "mtm_pharmacy_promotion_reviews"
         WHERE "organizationId" = NEW."organizationId" AND "executionId" = NEW."id"
           AND "level" = 'L2' AND "decision" = 'APPROVED'
       ) THEN
      RAISE EXCEPTION 'APPROVED execution requires atomic approved L1 and L2 decisions'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM "mtm_pharmacy_points_ledger_entries"
      WHERE "organizationId" = NEW."organizationId" AND "executionId" = NEW."id"
        AND "entryType" = 'AWARD' AND "bucket" = 'FACT_POINTS'
        AND "delta" = NEW."factPointsPreview"
    ) OR NOT EXISTS (
      SELECT 1 FROM "mtm_pharmacy_points_ledger_entries"
      WHERE "organizationId" = NEW."organizationId" AND "executionId" = NEW."id"
        AND "entryType" = 'AWARD' AND "bucket" = 'REWARD_POINTS'
        AND "delta" = NEW."rewardPointsPreview"
    ) THEN
      RAISE EXCEPTION 'APPROVED execution and exact per-bucket ledger awards must commit atomically'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."status" = 'REVERSED' AND EXISTS (
    SELECT 1
    FROM "mtm_pharmacy_points_ledger_entries" award
    WHERE award."organizationId" = NEW."organizationId"
      AND award."executionId" = NEW."id" AND award."entryType" = 'AWARD'
      AND award."delta" <> 0
      AND NOT EXISTS (
        SELECT 1 FROM "mtm_pharmacy_points_ledger_entries" reversal
        WHERE reversal."organizationId" = award."organizationId"
          AND reversal."reversesEntryId" = award."id"
          AND reversal."entryType" = 'REVERSAL'
      )
  ) THEN
    RAISE EXCEPTION 'REVERSED execution requires compensating entries for every award'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "mtm_pharmacy_execution_approval_atomic"
  AFTER INSERT OR UPDATE ON "mtm_pharmacy_promotion_executions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_validate_execution_approval_at_commit"();

CREATE OR REPLACE FUNCTION "mtm_pharmacy_validate_reversal_subject_at_commit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  original_row "mtm_pharmacy_points_ledger_entries"%ROWTYPE;
BEGIN
  IF NEW."entryType" <> 'REVERSAL' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO original_row
    FROM "mtm_pharmacy_points_ledger_entries"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."reversesEntryId";

  IF original_row."entryType" = 'AWARD' AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_promotion_executions"
    WHERE "organizationId" = original_row."organizationId"
      AND "id" = original_row."executionId"
      AND "status" = 'REVERSED'
  ) THEN
    RAISE EXCEPTION 'award reversal and REVERSED execution must commit atomically'
      USING ERRCODE = '23514';
  ELSIF original_row."entryType" = 'REWARD_DEBIT' AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_reward_claims"
    WHERE "organizationId" = original_row."organizationId"
      AND "id" = original_row."rewardClaimId"
      AND "status" = 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'reward debit reversal and CANCELLED claim must commit atomically'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "mtm_pharmacy_reversal_subject_atomic"
  AFTER INSERT ON "mtm_pharmacy_points_ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_validate_reversal_subject_at_commit"();

CREATE OR REPLACE FUNCTION "mtm_pharmacy_validate_reward_claim"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reward_row "mtm_pharmacy_rewards"%ROWTYPE;
  target_row "mtm_pharmacy_promotion_targets"%ROWTYPE;
  reserved_quantity BIGINT;
  old_status TEXT;
  new_status TEXT := NEW."status"::text;
BEGIN
  SELECT * INTO reward_row FROM "mtm_pharmacy_rewards"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."rewardId";
  IF reward_row."id" IS NULL
     OR NEW."pointsCostSnapshot" <> reward_row."pointsCost"
     OR NEW."rewardDefinitionHash" <> reward_row."definitionHash" THEN
    RAISE EXCEPTION 'reward claim must pin the selected reward version and cost exactly'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."requestedByAgentId" <> NEW."beneficiaryAgentId" THEN
    RAISE EXCEPTION 'first-slice reward claims must be requested by their beneficiary'
      USING ERRCODE = '42501';
  END IF;

  IF NEW."targetId" IS NOT NULL THEN
    SELECT * INTO target_row FROM "mtm_pharmacy_promotion_targets"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."targetId";
    IF target_row."id" IS NULL
       OR target_row."assignedAgentId" <> NEW."beneficiaryAgentId"
       OR target_row."customerId" <> NEW."customerId"
       OR target_row."contactId" IS DISTINCT FROM NEW."contactId" THEN
      RAISE EXCEPTION 'reward claim target/customer/contact must match its beneficiary assignment'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF new_status <> 'PENDING' OR reward_row."status" <> 'ACTIVE'
       OR (reward_row."availableFrom" IS NOT NULL AND NEW."requestedAt" < reward_row."availableFrom")
       OR (reward_row."availableUntil" IS NOT NULL AND NEW."requestedAt" > reward_row."availableUntil") THEN
      RAISE EXCEPTION 'new reward claim requires a currently active and available reward'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    old_status := OLD."status"::text;
    IF (to_jsonb(NEW) - ARRAY['status', 'version', 'decisionReason', 'decidedByUserId', 'decidedAt', 'fulfilledAt', 'cancelledAt', 'updatedAt'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status', 'version', 'decisionReason', 'decidedByUserId', 'decidedAt', 'fulfilledAt', 'cancelledAt', 'updatedAt']) THEN
      RAISE EXCEPTION 'reward claim identity and pinned cost are immutable' USING ERRCODE = '55000';
    END IF;

    IF old_status = 'PENDING' AND new_status NOT IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') THEN
      RAISE EXCEPTION 'invalid reward claim transition % -> %', old_status, new_status USING ERRCODE = '23514';
    ELSIF old_status = 'APPROVED' AND new_status NOT IN ('APPROVED', 'FULFILLED', 'CANCELLED') THEN
      RAISE EXCEPTION 'invalid reward claim transition % -> %', old_status, new_status USING ERRCODE = '23514';
    ELSIF old_status IN ('REJECTED', 'FULFILLED', 'CANCELLED') AND new_status <> old_status THEN
      RAISE EXCEPTION 'terminal reward claim cannot transition to %', new_status USING ERRCODE = '23514';
    END IF;

    IF new_status <> old_status AND NEW."version" <> OLD."version" + 1 THEN
      RAISE EXCEPTION 'reward claim transition requires an exact optimistic version increment'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  IF new_status = 'APPROVED' AND reward_row."stockQuantity" IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'mtm-pharmacy-reward:' || NEW."organizationId" || ':' || NEW."rewardId", 0
    ));
    SELECT COALESCE(sum("quantity"), 0) INTO reserved_quantity
      FROM "mtm_pharmacy_reward_claims"
      WHERE "organizationId" = NEW."organizationId" AND "rewardId" = NEW."rewardId"
        AND "status" IN ('APPROVED', 'FULFILLED') AND "id" <> NEW."id";
    IF reserved_quantity + NEW."quantity" > reward_row."stockQuantity" THEN
      RAISE EXCEPTION 'reward stock is insufficient' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "mtm_pharmacy_reward_claim_guard"
  BEFORE INSERT OR UPDATE ON "mtm_pharmacy_reward_claims"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_validate_reward_claim"();

CREATE OR REPLACE FUNCTION "mtm_pharmacy_validate_claim_ledger_at_commit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  debit_id TEXT;
BEGIN
  SELECT "id" INTO debit_id
    FROM "mtm_pharmacy_points_ledger_entries"
    WHERE "organizationId" = NEW."organizationId" AND "rewardClaimId" = NEW."id"
      AND "entryType" = 'REWARD_DEBIT';

  IF NEW."status" IN ('APPROVED', 'FULFILLED') THEN
    IF debit_id IS NULL OR EXISTS (
      SELECT 1 FROM "mtm_pharmacy_points_ledger_entries"
      WHERE "organizationId" = NEW."organizationId" AND "reversesEntryId" = debit_id
    ) THEN
      RAISE EXCEPTION 'approved/fulfilled reward claim requires one unreversed atomic debit'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."status" = 'CANCELLED' AND debit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_points_ledger_entries"
    WHERE "organizationId" = NEW."organizationId" AND "reversesEntryId" = debit_id
      AND "entryType" = 'REVERSAL'
  ) THEN
    RAISE EXCEPTION 'cancelling an approved reward claim requires an atomic debit reversal'
      USING ERRCODE = '23514';
  ELSIF NEW."status" IN ('PENDING', 'REJECTED') AND debit_id IS NOT NULL THEN
    RAISE EXCEPTION 'pending/rejected reward claim cannot have a points debit'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "mtm_pharmacy_reward_claim_ledger_atomic"
  AFTER INSERT OR UPDATE ON "mtm_pharmacy_reward_claims"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_validate_claim_ledger_at_commit"();

CREATE OR REPLACE FUNCTION "mtm_pharmacy_guard_operation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_status TEXT;
  new_status TEXT := NEW."status"::text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF new_status <> 'PENDING' OR NEW."version" <> 1 THEN
      RAISE EXCEPTION 'new bulk operation must start PENDING at version 1'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  old_status := OLD."status"::text;
  IF (to_jsonb(NEW) - ARRAY['status', 'resultPayload', 'succeededCount', 'failedCount', 'version', 'startedAt', 'completedAt', 'updatedAt'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'resultPayload', 'succeededCount', 'failedCount', 'version', 'startedAt', 'completedAt', 'updatedAt']) THEN
    RAISE EXCEPTION 'bulk operation request and frozen selection are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF old_status = 'PENDING' AND new_status NOT IN ('PENDING', 'COMPLETED', 'PARTIAL', 'FAILED') THEN
    RAISE EXCEPTION 'invalid bulk operation transition % -> %', old_status, new_status USING ERRCODE = '23514';
  ELSIF old_status <> 'PENDING' AND new_status <> old_status THEN
    RAISE EXCEPTION 'completed bulk operation is terminal' USING ERRCODE = '23514';
  END IF;
  IF old_status <> 'PENDING'
     AND (to_jsonb(NEW) - ARRAY['updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updatedAt']) THEN
    RAISE EXCEPTION 'completed bulk operation result is immutable' USING ERRCODE = '55000';
  END IF;
  IF new_status <> old_status AND NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'bulk operation transition requires an exact optimistic version increment'
      USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "mtm_pharmacy_operation_guard"
  BEFORE INSERT OR UPDATE ON "mtm_pharmacy_promotion_operations"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_guard_operation"();

CREATE OR REPLACE FUNCTION "mtm_pharmacy_validate_actor_pair"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."actorAgentId" IS NOT NULL AND NEW."actorUserId" IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM "mtm_agents"
       WHERE "organizationId" = NEW."organizationId"
         AND "id" = NEW."actorAgentId"
         AND "userId" = NEW."actorUserId"
     ) THEN
    RAISE EXCEPTION 'agent and user actor identities must describe the same tenant actor'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "mtm_pharmacy_validate_event_subject"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."executionId" IS NOT NULL AND NEW."targetId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_promotion_executions"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."executionId"
      AND "targetId" = NEW."targetId"
  ) THEN
    RAISE EXCEPTION 'event execution and target hierarchy is inconsistent' USING ERRCODE = '23514';
  END IF;
  IF NEW."executionId" IS NOT NULL AND NEW."formulaId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_promotion_executions"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."executionId"
      AND "formulaId" = NEW."formulaId"
  ) THEN
    RAISE EXCEPTION 'event execution and formula hierarchy is inconsistent' USING ERRCODE = '23514';
  END IF;
  IF NEW."executionId" IS NOT NULL AND NEW."approvalPolicyId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_promotion_executions"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."executionId"
      AND "approvalPolicyId" = NEW."approvalPolicyId"
  ) THEN
    RAISE EXCEPTION 'event execution and approval policy hierarchy is inconsistent' USING ERRCODE = '23514';
  END IF;
  IF NEW."evidenceId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_promotion_evidence"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."evidenceId"
      AND "executionId" = NEW."executionId"
  ) THEN
    RAISE EXCEPTION 'event evidence and execution hierarchy is inconsistent' USING ERRCODE = '23514';
  END IF;
  IF NEW."reviewId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_promotion_reviews"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."reviewId"
      AND "executionId" = NEW."executionId"
      AND "formulaId" = NEW."formulaId"
      AND "approvalPolicyId" = NEW."approvalPolicyId"
      AND "batchId" IS NOT DISTINCT FROM NEW."operationId"
  ) THEN
    RAISE EXCEPTION 'event review subject chain is inconsistent' USING ERRCODE = '23514';
  END IF;
  IF NEW."eventType" = 'PROMOTION_TARGET_PLANNED' AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_promotion_operations"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."operationId"
      AND "kind" = 'BULK_PLAN'
      AND "requestHash" = NEW."requestHash"
      AND "actorAgentId" IS NOT DISTINCT FROM NEW."actorAgentId"
      AND "actorUserId" IS NOT DISTINCT FROM NEW."actorUserId"
  ) THEN
    RAISE EXCEPTION 'event target and planning operation hierarchy is inconsistent' USING ERRCODE = '23514';
  END IF;
  IF NEW."eventType" = 'PROMOTION_TARGET_ELIGIBILITY_OVERRIDDEN' AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_promotion_targets"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."targetId"
      AND "eligibilityStatus" = 'OVERRIDDEN'
      AND "eligibilityOverrideReason" = NEW."payload" ->> 'reason'
      AND "eligibilitySnapshot" #>> '{override,operationId}' = NEW."payload" ->> 'operationId'
      AND "eligibilitySnapshot" #>> '{override,actorUserId}' = NEW."actorUserId"
      AND ("eligibilitySnapshot" #>> '{override,actorAgentId}') IS NOT DISTINCT FROM NEW."actorAgentId"
      AND "eligibilitySnapshot" #>> '{override,occurredAt}' = NEW."payload" ->> 'occurredAt'
  ) THEN
    RAISE EXCEPTION 'eligibility override event must match the governed target exception'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."reviewId" IS NOT NULL AND NEW."operationId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_promotion_operations"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."operationId"
      AND "kind" = 'BULK_REVIEW'
      AND "actorAgentId" IS NOT DISTINCT FROM NEW."actorAgentId"
      AND "actorUserId" IS NOT DISTINCT FROM NEW."actorUserId"
  ) THEN
    RAISE EXCEPTION 'event review and bulk operation hierarchy is inconsistent' USING ERRCODE = '23514';
  END IF;
  IF NEW."eventType" = 'BULK_REVIEW_COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_promotion_operations"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."operationId"
      AND "kind" = 'BULK_REVIEW'
      AND "requestHash" = NEW."requestHash"
      AND "actorAgentId" IS NOT DISTINCT FROM NEW."actorAgentId"
      AND "actorUserId" IS NOT DISTINCT FROM NEW."actorUserId"
  ) THEN
    RAISE EXCEPTION 'event and bulk review operation hierarchy is inconsistent' USING ERRCODE = '23514';
  END IF;
  IF NEW."targetId" IS NOT NULL AND NEW."promotionVersionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_promotion_targets"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."targetId"
      AND "promotionVersionId" = NEW."promotionVersionId"
  ) THEN
    RAISE EXCEPTION 'event target and promotion version hierarchy is inconsistent' USING ERRCODE = '23514';
  END IF;
  IF NEW."promotionVersionId" IS NOT NULL AND NEW."promotionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_promotion_versions"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."promotionVersionId"
      AND "promotionId" = NEW."promotionId"
  ) THEN
    RAISE EXCEPTION 'event promotion version and root hierarchy is inconsistent' USING ERRCODE = '23514';
  END IF;
  IF NEW."promotionVersionId" IS NOT NULL AND NEW."promotionTypeId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_promotion_versions"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."promotionVersionId"
      AND "typeId" = NEW."promotionTypeId"
  ) THEN
    RAISE EXCEPTION 'event promotion version and type hierarchy is inconsistent' USING ERRCODE = '23514';
  END IF;
  IF NEW."promotionVersionId" IS NOT NULL AND NEW."formulaId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_promotion_versions"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."promotionVersionId"
      AND "formulaId" = NEW."formulaId"
  ) THEN
    RAISE EXCEPTION 'event promotion version and formula hierarchy is inconsistent' USING ERRCODE = '23514';
  END IF;
  IF NEW."promotionVersionId" IS NOT NULL AND NEW."approvalPolicyId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_promotion_versions"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."promotionVersionId"
      AND "approvalPolicyId" = NEW."approvalPolicyId"
  ) THEN
    RAISE EXCEPTION 'event promotion version and approval policy hierarchy is inconsistent' USING ERRCODE = '23514';
  END IF;
  IF NEW."rewardClaimId" IS NOT NULL AND NEW."targetId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_reward_claims"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."rewardClaimId"
      AND "targetId" = NEW."targetId"
  ) THEN
    RAISE EXCEPTION 'event reward claim and target hierarchy is inconsistent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "mtm_pharmacy_validate_target_override_at_commit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "mtm_pharmacy_promotion_events"
    WHERE "organizationId" = NEW."organizationId"
      AND "targetId" = NEW."id"
      AND "eventType" = 'PROMOTION_TARGET_ELIGIBILITY_OVERRIDDEN'
      AND "fromState" = OLD."eligibilityStatus"::text
      AND "toState" = 'OVERRIDDEN'
      AND "requestHash" IS NOT NULL
      AND "payload" ->> 'reason' = NEW."eligibilityOverrideReason"
      AND "payload" ->> 'operationId' = NEW."eligibilitySnapshot" #>> '{override,operationId}'
      AND "actorUserId" = NEW."eligibilitySnapshot" #>> '{override,actorUserId}'
      AND "actorAgentId" IS NOT DISTINCT FROM (NEW."eligibilitySnapshot" #>> '{override,actorAgentId}')
      AND "payload" ->> 'occurredAt' = NEW."eligibilitySnapshot" #>> '{override,occurredAt}'
  ) THEN
    RAISE EXCEPTION 'eligibility override and immutable audit event must commit atomically'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "mtm_pharmacy_target_override_audit_atomic"
  AFTER UPDATE OF "eligibilityStatus", "eligibilitySnapshot", "eligibilityOverrideReason"
  ON "mtm_pharmacy_promotion_targets"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD."eligibilityStatus" IS DISTINCT FROM NEW."eligibilityStatus" AND NEW."eligibilityStatus" = 'OVERRIDDEN')
  EXECUTE FUNCTION "mtm_pharmacy_validate_target_override_at_commit"();

CREATE TRIGGER "mtm_pharmacy_ledger_actor_identity"
  BEFORE INSERT ON "mtm_pharmacy_points_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_validate_actor_pair"();
CREATE TRIGGER "mtm_pharmacy_event_actor_identity"
  BEFORE INSERT ON "mtm_pharmacy_promotion_events"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_validate_actor_pair"();
CREATE TRIGGER "mtm_pharmacy_event_subject_identity"
  BEFORE INSERT ON "mtm_pharmacy_promotion_events"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_validate_event_subject"();
CREATE TRIGGER "mtm_pharmacy_operation_actor_identity"
  BEFORE INSERT OR UPDATE ON "mtm_pharmacy_promotion_operations"
  FOR EACH ROW EXECUTE FUNCTION "mtm_pharmacy_validate_actor_pair"();

-- FORCE RLS even for the table owner. Mutable workflow rows get tenant-bound
-- ALL policies; append-only rows get SELECT/INSERT plus bypass-only retention
-- deletes and deliberately receive no UPDATE policy.
ALTER TABLE "mtm_pharmacy_promotion_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_types" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_points_formulas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_points_formulas" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_approval_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_approval_policies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_targets" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_executions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_evidence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_reviews" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_rewards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_rewards" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_reward_claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_reward_claims" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_operations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_points_ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_points_ledger_entries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "mtm_pharmacy_types_tenant_all" ON "mtm_pharmacy_promotion_types"
  FOR ALL USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  ) WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "mtm_pharmacy_promotions_tenant_all" ON "mtm_pharmacy_promotions"
  FOR ALL USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  ) WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "mtm_pharmacy_formulas_tenant_all" ON "mtm_pharmacy_points_formulas"
  FOR ALL USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  ) WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "mtm_pharmacy_policies_tenant_all" ON "mtm_pharmacy_approval_policies"
  FOR ALL USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  ) WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "mtm_pharmacy_versions_tenant_all" ON "mtm_pharmacy_promotion_versions"
  FOR ALL USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  ) WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "mtm_pharmacy_targets_tenant_all" ON "mtm_pharmacy_promotion_targets"
  FOR ALL USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  ) WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "mtm_pharmacy_executions_tenant_all" ON "mtm_pharmacy_promotion_executions"
  FOR ALL USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  ) WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "mtm_pharmacy_rewards_tenant_all" ON "mtm_pharmacy_rewards"
  FOR ALL USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  ) WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "mtm_pharmacy_claims_tenant_all" ON "mtm_pharmacy_reward_claims"
  FOR ALL USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  ) WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "mtm_pharmacy_operations_tenant_all" ON "mtm_pharmacy_promotion_operations"
  FOR ALL USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  ) WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

CREATE POLICY "mtm_pharmacy_evidence_tenant_select" ON "mtm_pharmacy_promotion_evidence"
  FOR SELECT USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "mtm_pharmacy_evidence_tenant_insert" ON "mtm_pharmacy_promotion_evidence"
  FOR INSERT WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "mtm_pharmacy_evidence_bypass_delete" ON "mtm_pharmacy_promotion_evidence"
  FOR DELETE USING (current_setting('app.rls_bypass', true) = 'on');

CREATE POLICY "mtm_pharmacy_reviews_tenant_select" ON "mtm_pharmacy_promotion_reviews"
  FOR SELECT USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "mtm_pharmacy_reviews_tenant_insert" ON "mtm_pharmacy_promotion_reviews"
  FOR INSERT WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "mtm_pharmacy_reviews_bypass_delete" ON "mtm_pharmacy_promotion_reviews"
  FOR DELETE USING (current_setting('app.rls_bypass', true) = 'on');

CREATE POLICY "mtm_pharmacy_ledger_tenant_select" ON "mtm_pharmacy_points_ledger_entries"
  FOR SELECT USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "mtm_pharmacy_ledger_tenant_insert" ON "mtm_pharmacy_points_ledger_entries"
  FOR INSERT WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "mtm_pharmacy_ledger_bypass_delete" ON "mtm_pharmacy_points_ledger_entries"
  FOR DELETE USING (current_setting('app.rls_bypass', true) = 'on');

CREATE POLICY "mtm_pharmacy_events_tenant_select" ON "mtm_pharmacy_promotion_events"
  FOR SELECT USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "mtm_pharmacy_events_tenant_insert" ON "mtm_pharmacy_promotion_events"
  FOR INSERT WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "mtm_pharmacy_events_bypass_delete" ON "mtm_pharmacy_promotion_events"
  FOR DELETE USING (current_setting('app.rls_bypass', true) = 'on');

-- Deployments may run migrations as a role distinct from the application
-- owner. Mirror the established MTM grant pattern without granting tenant
-- UPDATE/DELETE privileges on append-only facts.
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
      'mtm_pharmacy_promotion_types',
      'mtm_pharmacy_promotions',
      'mtm_pharmacy_points_formulas',
      'mtm_pharmacy_approval_policies',
      'mtm_pharmacy_promotion_versions',
      'mtm_pharmacy_promotion_targets',
      'mtm_pharmacy_promotion_executions',
      'mtm_pharmacy_rewards',
      'mtm_pharmacy_reward_claims',
      'mtm_pharmacy_promotion_operations'
    ] LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO %I', table_name, app_owner);
    END LOOP;

    FOREACH table_name IN ARRAY ARRAY[
      'mtm_pharmacy_promotion_evidence',
      'mtm_pharmacy_promotion_reviews',
      'mtm_pharmacy_points_ledger_entries',
      'mtm_pharmacy_promotion_events'
    ] LOOP
      EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO %I', table_name, app_owner);
    END LOOP;
  END IF;
END $$;

SELECT set_config('app.rls_bypass', 'off', false);
