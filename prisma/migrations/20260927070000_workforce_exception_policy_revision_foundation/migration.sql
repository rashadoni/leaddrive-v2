-- C6 dormant policy-revision provenance. This migration creates no row,
-- enables no tenant and changes no decision behavior.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '2min';

CREATE TABLE "workforce_exception_policy_revisions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "operationId" VARCHAR(100) NOT NULL,
  "policyVersion" VARCHAR(64) NOT NULL,
  "definition" JSONB NOT NULL,
  "definitionHash" VARCHAR(64) NOT NULL,
  "recordedByUserId" TEXT NOT NULL,
  "recordReasonCode" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workforce_exception_policy_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_exception_policy_revisions_revision_check"
    CHECK ("revision" > 0),
  CONSTRAINT "workforce_exception_policy_revisions_operation_id_check"
    CHECK ("operationId" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  CONSTRAINT "workforce_exception_policy_revisions_version_check"
    CHECK ("policyVersion" ~ '^[a-z][a-z0-9._-]{0,63}$'),
  CONSTRAINT "workforce_exception_policy_revisions_definition_check"
    CHECK (jsonb_typeof("definition") = 'object'),
  CONSTRAINT "workforce_exception_policy_revisions_hash_check"
    CHECK ("definitionHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "workforce_exception_policy_revisions_reason_check"
    CHECK ("recordReasonCode" ~ '^[A-Z][A-Z0-9_]{0,63}$')
);

CREATE UNIQUE INDEX "workforce_exception_policy_revisions_org_id_key"
  ON "workforce_exception_policy_revisions"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_exception_policy_revisions_org_revision_key"
  ON "workforce_exception_policy_revisions"("organizationId", "revision");
CREATE UNIQUE INDEX "workforce_exception_policy_revisions_org_operation_key"
  ON "workforce_exception_policy_revisions"("organizationId", "operationId");
CREATE INDEX "workforce_exception_policy_revisions_org_created_idx"
  ON "workforce_exception_policy_revisions"("organizationId", "createdAt");
CREATE INDEX "workforce_exception_policy_revisions_org_actor_created_idx"
  ON "workforce_exception_policy_revisions"(
    "organizationId", "recordedByUserId", "createdAt"
  );

ALTER TABLE "workforce_exception_policy_revisions"
  ADD CONSTRAINT "workforce_exception_policy_revisions_org_fk"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workforce_exception_policy_revisions"
  ADD CONSTRAINT "workforce_exception_policy_revisions_recorded_by_fk"
  FOREIGN KEY ("organizationId", "recordedByUserId")
  REFERENCES "users"("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION workforce_exception_policy_revisions_append_only_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $append_only$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'workforce_exception_policy_revisions is append-only; TRUNCATE rejected'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'workforce_exception_policy_revisions is append-only; UPDATE rejected (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'workforce_exception_policy_revisions is append-only; DELETE rejected (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$append_only$;

CREATE TRIGGER workforce_exception_policy_revisions_append_only
  BEFORE UPDATE OR DELETE ON "workforce_exception_policy_revisions"
  FOR EACH ROW
  EXECUTE FUNCTION workforce_exception_policy_revisions_append_only_fn();

CREATE TRIGGER workforce_exception_policy_revisions_no_truncate
  BEFORE TRUNCATE ON "workforce_exception_policy_revisions"
  FOR EACH STATEMENT
  EXECUTE FUNCTION workforce_exception_policy_revisions_append_only_fn();

ALTER TABLE "workforce_exception_policy_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_exception_policy_revisions" FORCE ROW LEVEL SECURITY;

CREATE POLICY workforce_exception_policy_revisions_tenant_select
  ON "workforce_exception_policy_revisions" FOR SELECT
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

CREATE POLICY workforce_exception_policy_revisions_tenant_insert
  ON "workforce_exception_policy_revisions" FOR INSERT
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- Storage remains dormant. The existing application relation owner receives
-- read/append only; no seed, activation flag, writer or route is introduced.
DO $$
DECLARE
  app_owner TEXT;
BEGIN
  SELECT tableowner INTO app_owner
  FROM pg_tables
  WHERE schemaname = current_schema() AND tablename = 'mtm_agents';
  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    EXECUTE format(
      'GRANT SELECT, INSERT ON TABLE %I.%I TO %I',
      current_schema(),
      'workforce_exception_policy_revisions',
      app_owner
    );
  END IF;
END $$;

-- Acquire the live decision-table lock only after every new-table-only object
-- is ready, then release it immediately at commit. NULL is the honest
-- rollback-window and historical value: no old decision is attributed to a
-- policy that was not recorded when that decision happened.
ALTER TABLE "workforce_exception_decisions"
  ADD COLUMN "policyRevisionId" TEXT;

-- The nullable addition is enforced for every new non-NULL write immediately.
-- Validation of the live table is deliberately left to a later bounded phase.
ALTER TABLE "workforce_exception_decisions"
  ADD CONSTRAINT "workforce_exception_decisions_policy_revision_fk"
  FOREIGN KEY ("organizationId", "policyRevisionId")
  REFERENCES "workforce_exception_policy_revisions"("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;

COMMIT;
