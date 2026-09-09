-- C9 #15 — FormDefinition.campaignId for form-submission attribution touchpoints.
-- Additive + nullable: a form opts into attribution by linking to a campaign;
-- existing forms keep campaignId = NULL and behave exactly as before.

ALTER TABLE "form_definitions" ADD COLUMN "campaignId" TEXT;

CREATE INDEX "form_definitions_organizationId_campaignId_idx"
  ON "form_definitions"("organizationId", "campaignId");

ALTER TABLE "form_definitions"
  ADD CONSTRAINT "form_definitions_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
