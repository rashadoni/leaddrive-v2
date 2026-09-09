-- An explicit provenance contract for the default Workforce profile. The
-- migration changes no tenant data and does not enable any capability; it only
-- allows a later, audited provisioner to create a system-owned definition
-- without falsely attributing that action to a tenant administrator.

SET lock_timeout = '3s';

CREATE TYPE "WorkforceDefinitionProvenance" AS ENUM ('TENANT_ADMIN', 'SYSTEM_PROVISIONING');

ALTER TABLE "workforce_policies"
  ADD COLUMN "provenance" "WorkforceDefinitionProvenance" NOT NULL DEFAULT 'TENANT_ADMIN',
  ADD COLUMN "systemProfileVersion" TEXT,
  ALTER COLUMN "createdByUserId" DROP NOT NULL;

ALTER TABLE "workforce_shift_templates"
  ADD COLUMN "provenance" "WorkforceDefinitionProvenance" NOT NULL DEFAULT 'TENANT_ADMIN',
  ADD COLUMN "systemProfileVersion" TEXT,
  ALTER COLUMN "createdByUserId" DROP NOT NULL;

-- Existing rows receive TENANT_ADMIN through the DEFAULT and retain their
-- tenant-scoped foreign-key actors. System rows are valid only with a stable
-- profile version and without a fabricated user id.
ALTER TABLE "workforce_policies"
  DROP CONSTRAINT IF EXISTS "workforce_policies_activation_check",
  ADD CONSTRAINT "workforce_policies_provenance_actor_check" CHECK (
    ("provenance" = 'TENANT_ADMIN'
      AND "createdByUserId" IS NOT NULL
      AND "systemProfileVersion" IS NULL)
    OR
    ("provenance" = 'SYSTEM_PROVISIONING'
      AND "createdByUserId" IS NULL
      AND NULLIF(btrim("systemProfileVersion"), '') IS NOT NULL)
  ),
  ADD CONSTRAINT "workforce_policies_activation_check" CHECK (
    ("provenance" = 'TENANT_ADMIN' AND (
      "status" = 'DRAFT' OR (
        "activatedAt" IS NOT NULL AND "activatedByUserId" IS NOT NULL
      )
    ))
    OR
    ("provenance" = 'SYSTEM_PROVISIONING'
      AND "status" IN ('ACTIVE', 'RETIRED')
      AND "activatedAt" IS NOT NULL
      AND "activatedByUserId" IS NULL)
  );

ALTER TABLE "workforce_shift_templates"
  DROP CONSTRAINT IF EXISTS "workforce_shift_templates_activation_check",
  ADD CONSTRAINT "workforce_shift_templates_provenance_actor_check" CHECK (
    ("provenance" = 'TENANT_ADMIN'
      AND "createdByUserId" IS NOT NULL
      AND "systemProfileVersion" IS NULL)
    OR
    ("provenance" = 'SYSTEM_PROVISIONING'
      AND "createdByUserId" IS NULL
      AND NULLIF(btrim("systemProfileVersion"), '') IS NOT NULL)
  ),
  ADD CONSTRAINT "workforce_shift_templates_activation_check" CHECK (
    ("provenance" = 'TENANT_ADMIN' AND (
      "status" = 'DRAFT' OR (
        "activatedAt" IS NOT NULL AND "activatedByUserId" IS NOT NULL
      )
    ))
    OR
    ("provenance" = 'SYSTEM_PROVISIONING'
      AND "status" IN ('ACTIVE', 'RETIRED')
      AND "activatedAt" IS NOT NULL
      AND "activatedByUserId" IS NULL)
  );

CREATE INDEX "workforce_policies_organizationId_provenance_idx"
  ON "workforce_policies"("organizationId", "provenance");

CREATE INDEX "workforce_shift_templates_organizationId_provenance_idx"
  ON "workforce_shift_templates"("organizationId", "provenance");

-- The transaction advisory lock is the primary concurrency control. These
-- partial unique keys are an independent database backstop for a replayed
-- profile version after a process failure or a future caller mistake.
CREATE UNIQUE INDEX "workforce_policies_one_system_profile_version_key"
  ON "workforce_policies"("organizationId", "systemProfileVersion")
  WHERE "provenance" = 'SYSTEM_PROVISIONING';

CREATE UNIQUE INDEX "workforce_shift_templates_one_system_profile_version_key"
  ON "workforce_shift_templates"("organizationId", "systemProfileVersion")
  WHERE "provenance" = 'SYSTEM_PROVISIONING';

-- A system-origin record is not a mutable shortcut. Its provenance and
-- creation actor are immutable for every lifecycle state; tenant activation
-- still sets its normal actor while a system activation keeps it null.
CREATE OR REPLACE FUNCTION workforce_guard_definition_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."provenance" IS DISTINCT FROM OLD."provenance"
     OR NEW."systemProfileVersion" IS DISTINCT FROM OLD."systemProfileVersion"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" THEN
    RAISE EXCEPTION 'Workforce definition provenance is immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD."provenance" = 'SYSTEM_PROVISIONING'
     AND NEW."activatedByUserId" IS NOT NULL THEN
    RAISE EXCEPTION 'System-provisioned Workforce definitions cannot be attributed to a user' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_policies_provenance_guard
  BEFORE UPDATE ON "workforce_policies"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_definition_provenance();

CREATE TRIGGER workforce_shift_templates_provenance_guard
  BEFORE UPDATE ON "workforce_shift_templates"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_definition_provenance();
