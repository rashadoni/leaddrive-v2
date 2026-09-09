-- GAP-004 / SwissMed pharmaceutical doctor scoring. Formula definitions are
-- versioned and signed by MTM administrators. Assessment content is append-only;
-- only its review envelope may transition from PENDING to a terminal state.

CREATE TYPE "MtmDoctorScoringFormulaStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "MtmDoctorAssessmentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

CREATE TABLE "mtm_doctor_scoring_formulas" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "definition" JSONB NOT NULL,
  "status" "MtmDoctorScoringFormulaStatus" NOT NULL DEFAULT 'DRAFT',
  "createdBy" TEXT,
  "signedBy" TEXT,
  "signedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_doctor_scoring_formulas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_doctor_scoring_formulas_signature_check" CHECK (
    ("status" = 'DRAFT' AND "signedAt" IS NULL AND "signedBy" IS NULL) OR
    ("status" IN ('ACTIVE', 'RETIRED') AND "signedAt" IS NOT NULL)
  )
);

CREATE TABLE "mtm_doctor_assessments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "formulaId" TEXT NOT NULL,
  "enteredByAgentId" TEXT,
  "reviewedByAgentId" TEXT,
  "clientAssessmentId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "office" TEXT,
  "patientsPerMonth" INTEGER,
  "bedCount" INTEGER,
  "isKol" BOOLEAN NOT NULL DEFAULT false,
  "kolLevel" TEXT,
  "profile" TEXT,
  "psychotype" TEXT,
  "granularCategory" TEXT,
  "actualScore" DECIMAL(14,4),
  "targetScore" DECIMAL(14,4),
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE,
  "source" TEXT NOT NULL,
  "provenance" JSONB NOT NULL,
  "formulaVersion" TEXT NOT NULL,
  "status" "MtmDoctorAssessmentStatus" NOT NULL DEFAULT 'PENDING',
  "reviewComment" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_doctor_assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_doctor_assessments_period_check" CHECK (
    "periodEnd" IS NULL OR "periodEnd" >= "periodStart"
  ),
  CONSTRAINT "mtm_doctor_assessments_counts_check" CHECK (
    ("patientsPerMonth" IS NULL OR "patientsPerMonth" >= 0) AND
    ("bedCount" IS NULL OR "bedCount" >= 0)
  ),
  CONSTRAINT "mtm_doctor_assessments_scores_check" CHECK (
    ("actualScore" IS NULL OR "actualScore" >= 0) AND
    ("targetScore" IS NULL OR "targetScore" >= 0)
  ),
  CONSTRAINT "mtm_doctor_assessments_kol_check" CHECK (
    "isKol" OR "kolLevel" IS NULL
  ),
  CONSTRAINT "mtm_doctor_assessments_review_check" CHECK (
    ("status" = 'PENDING' AND "reviewedAt" IS NULL AND "reviewComment" IS NULL) OR
    ("status" IN ('VERIFIED', 'REJECTED') AND "reviewedAt" IS NOT NULL AND "reviewComment" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "mtm_doctor_scoring_formulas_organizationId_version_key"
  ON "mtm_doctor_scoring_formulas"("organizationId", "version");
CREATE UNIQUE INDEX "mtm_doctor_scoring_formulas_one_active_per_org"
  ON "mtm_doctor_scoring_formulas"("organizationId") WHERE "status" = 'ACTIVE';
CREATE INDEX "mtm_doctor_scoring_formulas_org_status_created_idx"
  ON "mtm_doctor_scoring_formulas"("organizationId", "status", "createdAt");

CREATE UNIQUE INDEX "mtm_doctor_assessments_organizationId_clientAssessmentId_key"
  ON "mtm_doctor_assessments"("organizationId", "clientAssessmentId");
CREATE INDEX "mtm_doctor_assessments_org_contact_period_created_idx"
  ON "mtm_doctor_assessments"("organizationId", "contactId", "periodStart", "createdAt");
CREATE INDEX "mtm_doctor_assessments_org_status_created_idx"
  ON "mtm_doctor_assessments"("organizationId", "status", "createdAt");
CREATE INDEX "mtm_doctor_assessments_org_formula_idx"
  ON "mtm_doctor_assessments"("organizationId", "formulaId");

ALTER TABLE "mtm_doctor_scoring_formulas"
  ADD CONSTRAINT "mtm_doctor_scoring_formulas_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_doctor_assessments"
  ADD CONSTRAINT "mtm_doctor_assessments_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_doctor_assessments"
  ADD CONSTRAINT "mtm_doctor_assessments_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "mtm_contacts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_doctor_assessments"
  ADD CONSTRAINT "mtm_doctor_assessments_formulaId_fkey"
  FOREIGN KEY ("formulaId") REFERENCES "mtm_doctor_scoring_formulas"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mtm_doctor_assessments"
  ADD CONSTRAINT "mtm_doctor_assessments_enteredByAgentId_fkey"
  FOREIGN KEY ("enteredByAgentId") REFERENCES "mtm_agents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mtm_doctor_assessments"
  ADD CONSTRAINT "mtm_doctor_assessments_reviewedByAgentId_fkey"
  FOREIGN KEY ("reviewedByAgentId") REFERENCES "mtm_agents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "mtm_doctor_scoring_formulas" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mtm_doctor_scoring_formulas_tenant_isolation"
  ON "mtm_doctor_scoring_formulas"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));

ALTER TABLE "mtm_doctor_assessments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mtm_doctor_assessments_tenant_isolation"
  ON "mtm_doctor_assessments"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));

-- Defense in depth: Prisma exposes update methods globally, so preserve the
-- append-only contract even if a future route accidentally targets core facts.
CREATE OR REPLACE FUNCTION prevent_mtm_doctor_assessment_content_update()
RETURNS TRIGGER AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status', 'reviewComment', 'reviewedByAgentId', 'reviewedAt', 'updatedAt'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'reviewComment', 'reviewedByAgentId', 'reviewedAt', 'updatedAt']) THEN
    RAISE EXCEPTION 'doctor assessment content is append-only';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "mtm_doctor_assessments_content_immutable"
  BEFORE UPDATE ON "mtm_doctor_assessments"
  FOR EACH ROW EXECUTE FUNCTION prevent_mtm_doctor_assessment_content_update();

CREATE OR REPLACE FUNCTION prevent_mtm_doctor_formula_content_update()
RETURNS TRIGGER AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status', 'signedBy', 'signedAt', 'retiredAt', 'updatedAt'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'signedBy', 'signedAt', 'retiredAt', 'updatedAt']) THEN
    RAISE EXCEPTION 'doctor scoring formula content is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "mtm_doctor_scoring_formulas_content_immutable"
  BEFORE UPDATE ON "mtm_doctor_scoring_formulas"
  FOR EACH ROW EXECUTE FUNCTION prevent_mtm_doctor_formula_content_update();
