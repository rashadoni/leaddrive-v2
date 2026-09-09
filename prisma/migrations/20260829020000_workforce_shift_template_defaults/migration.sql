-- Make default-template selection explicit instead of overloading a business
-- code value. Only one active default is allowed per organization or team.
-- Existing rows remain non-default and no data is backfilled.

SET lock_timeout = '3s';

ALTER TABLE "workforce_shift_templates"
  ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "workforce_shift_templates_one_active_org_default_key"
  ON "workforce_shift_templates"("organizationId")
  WHERE "isDefault" = true
    AND "status" = 'ACTIVE'
    AND "teamId" IS NULL;

CREATE UNIQUE INDEX "workforce_shift_templates_one_active_team_default_key"
  ON "workforce_shift_templates"("organizationId", "teamId")
  WHERE "isDefault" = true
    AND "status" = 'ACTIVE'
    AND "teamId" IS NOT NULL;
