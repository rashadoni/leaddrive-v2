-- N5 Validation rules (Phase 2 roadmap slice 1).
-- Declarative formula-based validation rules. Wires into the N4 formula
-- engine: when `condition` evaluates truthy at save, the rule fails.

-- CreateTable
CREATE TABLE "formula_validation_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "condition" TEXT NOT NULL,
    "errorField" TEXT,
    "errorMessage" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'error',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "formula_validation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "formula_validation_rules_organizationId_entityType_isActive_idx"
    ON "formula_validation_rules"("organizationId", "entityType", "isActive");

-- AddForeignKey
ALTER TABLE "formula_validation_rules"
    ADD CONSTRAINT "formula_validation_rules_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Severity must be one of the two engine-supported values. DB-level guard
-- against manual SQL / seed scripts that bypass the Zod-validated API path.
ALTER TABLE "formula_validation_rules"
    ADD CONSTRAINT "formula_validation_rules_severity_check"
    CHECK ("severity" IN ('error', 'warning'));
