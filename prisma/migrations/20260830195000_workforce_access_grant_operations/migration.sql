-- C7: make the dormant grant/revocation ledger safely replayable before any
-- endpoint is allowed to write it. This migration intentionally refuses to
-- retrofit an unknown direct database grant: there is no trustworthy
-- operation id to invent for already-existing authority rows.

SET lock_timeout = '3s';

ALTER TABLE "workforce_access_grants"
  ADD COLUMN "operationId" VARCHAR(100);
ALTER TABLE "workforce_access_grant_revocations"
  ADD COLUMN "operationId" VARCHAR(100);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "workforce_access_grants")
    OR EXISTS (SELECT 1 FROM "workforce_access_grant_revocations") THEN
    RAISE EXCEPTION 'Cannot add Workforce access operation ids to a non-empty dormant ledger; reconcile each authority action before rollout'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

ALTER TABLE "workforce_access_grants"
  ALTER COLUMN "operationId" SET NOT NULL,
  ADD CONSTRAINT "workforce_access_grants_operation_id_check"
    CHECK ("operationId" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  ADD CONSTRAINT "workforce_access_grants_reason_format_check"
    CHECK ("grantReasonCode" ~ '^[A-Z][A-Z0-9_]{0,63}$');
ALTER TABLE "workforce_access_grant_revocations"
  ALTER COLUMN "operationId" SET NOT NULL,
  ADD CONSTRAINT "workforce_access_grant_revocations_operation_id_check"
    CHECK ("operationId" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  ADD CONSTRAINT "workforce_access_grant_revocations_reason_format_check"
    CHECK ("revocationReasonCode" ~ '^[A-Z][A-Z0-9_]{0,63}$');

CREATE UNIQUE INDEX "workforce_access_grants_organizationId_operationId_key"
  ON "workforce_access_grants"("organizationId", "operationId");
CREATE UNIQUE INDEX "workforce_access_grant_revocations_organizationId_operationId_key"
  ON "workforce_access_grant_revocations"("organizationId", "operationId");
