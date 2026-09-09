-- SWM-04: pin the professional glossary and its source to the signed doctor
-- scoring formula. Existing legacy formulas remain readable but cannot be
-- used as governed sources for new assessments or brand-potential facts.

SET lock_timeout = '3s';

ALTER TABLE "mtm_doctor_scoring_formulas"
  ADD COLUMN "definitionHash" VARCHAR(64),
  ADD COLUMN "glossarySchemaVersion" INTEGER,
  ADD COLUMN "approvalReference" TEXT,
  ADD COLUMN "sourceSystem" TEXT,
  ADD COLUMN "sourceReference" TEXT,
  ADD COLUMN "sourceObservedAt" TIMESTAMP(3);

ALTER TABLE "mtm_doctor_scoring_formulas"
  ADD CONSTRAINT "mtm_doctor_scoring_formula_governance_check" CHECK (
    (
      "definitionHash" IS NULL
      AND "glossarySchemaVersion" IS NULL
      AND "approvalReference" IS NULL
      AND "sourceSystem" IS NULL
      AND "sourceReference" IS NULL
      AND "sourceObservedAt" IS NULL
    )
    OR
    (
      "definitionHash" ~ '^[a-f0-9]{64}$'
      AND "glossarySchemaVersion" = 1
      AND NULLIF(btrim("approvalReference"), '') IS NOT NULL
      AND NULLIF(btrim("sourceSystem"), '') IS NOT NULL
      AND "sourceObservedAt" IS NOT NULL
    )
  );

CREATE INDEX "mtm_doctor_scoring_formulas_governed_status_idx"
  ON "mtm_doctor_scoring_formulas"("organizationId", "status", "definitionHash");
