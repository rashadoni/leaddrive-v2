-- C7: additive Workforce-only role grants. No tenant receives a grant from
-- this migration and no endpoint reads these tables yet, so applying storage
-- cannot change legacy CRM/MTM authorization or activate Workforce policy.

SET lock_timeout = '3s';

CREATE TYPE "WorkforceAccessRole" AS ENUM (
  'TENANT_ADMIN', 'HR_ADMIN', 'SCHEDULER', 'TIME_APPROVER',
  'EVIDENCE_REVIEWER', 'DEVICE_SECURITY_ADMIN', 'EXPORT_CUSTODIAN',
  'RETENTION_HOLD_OFFICER', 'PILOT_ROLLBACK_OPERATOR', 'TEAM_MANAGER'
);
CREATE TYPE "WorkforceAccessScopeKind" AS ENUM ('ORGANIZATION', 'TEAM', 'SITE', 'AGENT');

CREATE TABLE "workforce_access_grants" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "principalUserId" TEXT NOT NULL,
  "role" "WorkforceAccessRole" NOT NULL,
  "scopeKind" "WorkforceAccessScopeKind" NOT NULL,
  "scopeTeamId" TEXT,
  "scopeSiteId" TEXT,
  "scopeAgentId" TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveUntil" TIMESTAMP(3),
  "grantedByUserId" TEXT NOT NULL,
  "grantReasonCode" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_access_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_access_grants_effective_window_check"
    CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom"),
  CONSTRAINT "workforce_access_grants_reason_check"
    CHECK (NULLIF(btrim("grantReasonCode"), '') IS NOT NULL),
  CONSTRAINT "workforce_access_grants_exact_scope_check" CHECK (
    ("scopeKind" = 'ORGANIZATION' AND "scopeTeamId" IS NULL AND "scopeSiteId" IS NULL AND "scopeAgentId" IS NULL)
    OR ("scopeKind" = 'TEAM' AND "scopeTeamId" IS NOT NULL AND "scopeSiteId" IS NULL AND "scopeAgentId" IS NULL)
    OR ("scopeKind" = 'SITE' AND "scopeTeamId" IS NULL AND "scopeSiteId" IS NOT NULL AND "scopeAgentId" IS NULL)
    OR ("scopeKind" = 'AGENT' AND "scopeTeamId" IS NULL AND "scopeSiteId" IS NULL AND "scopeAgentId" IS NOT NULL)
  ),
  CONSTRAINT "workforce_access_grants_role_scope_check" CHECK (
    ("role" IN ('TENANT_ADMIN', 'RETENTION_HOLD_OFFICER', 'PILOT_ROLLBACK_OPERATOR') AND "scopeKind" = 'ORGANIZATION')
    OR ("role" IN ('HR_ADMIN', 'SCHEDULER') AND "scopeKind" IN ('ORGANIZATION', 'TEAM', 'SITE'))
    OR ("role" = 'TIME_APPROVER' AND "scopeKind" IN ('ORGANIZATION', 'TEAM', 'AGENT'))
    OR ("role" = 'EVIDENCE_REVIEWER' AND "scopeKind" IN ('ORGANIZATION', 'TEAM', 'SITE', 'AGENT'))
    OR ("role" = 'DEVICE_SECURITY_ADMIN' AND "scopeKind" IN ('ORGANIZATION', 'SITE'))
    OR ("role" = 'EXPORT_CUSTODIAN' AND "scopeKind" IN ('ORGANIZATION', 'TEAM', 'AGENT'))
    OR ("role" = 'TEAM_MANAGER' AND "scopeKind" IN ('TEAM', 'SITE'))
  )
);

CREATE TABLE "workforce_access_grant_revocations" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "grantId" TEXT NOT NULL,
  "revokedByUserId" TEXT NOT NULL,
  "revocationReasonCode" VARCHAR(64) NOT NULL,
  "revokedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_access_grant_revocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_access_grant_revocations_reason_check"
    CHECK (NULLIF(btrim("revocationReasonCode"), '') IS NOT NULL)
);

CREATE UNIQUE INDEX "workforce_access_grants_organizationId_id_key"
  ON "workforce_access_grants"("organizationId", "id");
CREATE INDEX "workforce_access_grants_org_principal_effective_idx"
  ON "workforce_access_grants"("organizationId", "principalUserId", "effectiveFrom", "effectiveUntil");
CREATE INDEX "workforce_access_grants_org_role_scope_effective_idx"
  ON "workforce_access_grants"("organizationId", "role", "scopeKind", "effectiveFrom");
CREATE INDEX "workforce_access_grants_org_scope_team_effective_idx"
  ON "workforce_access_grants"("organizationId", "scopeTeamId", "effectiveFrom");
CREATE INDEX "workforce_access_grants_org_scope_site_effective_idx"
  ON "workforce_access_grants"("organizationId", "scopeSiteId", "effectiveFrom");
CREATE INDEX "workforce_access_grants_org_scope_agent_effective_idx"
  ON "workforce_access_grants"("organizationId", "scopeAgentId", "effectiveFrom");
CREATE INDEX "workforce_access_grants_org_granted_by_created_idx"
  ON "workforce_access_grants"("organizationId", "grantedByUserId", "createdAt");

CREATE UNIQUE INDEX "workforce_access_grant_revocations_organizationId_id_key"
  ON "workforce_access_grant_revocations"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_access_grant_revocations_grant_key"
  ON "workforce_access_grant_revocations"("organizationId", "grantId");
CREATE INDEX "workforce_access_grant_revocations_org_actor_at_idx"
  ON "workforce_access_grant_revocations"("organizationId", "revokedByUserId", "revokedAt");

ALTER TABLE "workforce_access_grants"
  ADD CONSTRAINT "workforce_access_grants_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_access_grants_principal_fkey"
    FOREIGN KEY ("organizationId", "principalUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_access_grants_team_fkey"
    FOREIGN KEY ("organizationId", "scopeTeamId") REFERENCES "mtm_teams"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_access_grants_site_fkey"
    FOREIGN KEY ("organizationId", "scopeSiteId") REFERENCES "workforce_sites"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_access_grants_agent_fkey"
    FOREIGN KEY ("organizationId", "scopeAgentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_access_grants_granted_by_fkey"
    FOREIGN KEY ("organizationId", "grantedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workforce_access_grant_revocations"
  ADD CONSTRAINT "workforce_access_grant_revocations_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_access_grant_revocations_grant_fkey"
    FOREIGN KEY ("organizationId", "grantId") REFERENCES "workforce_access_grants"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_access_grant_revocations_actor_fkey"
    FOREIGN KEY ("organizationId", "revokedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce the owner-approved pair separation before a durable grant exists.
-- The effective interval ends at its explicit end or append-only revocation;
-- every grant is otherwise immutable. This makes a future assignment service
-- fail closed even if it forgets the pure planning validator.
CREATE OR REPLACE FUNCTION workforce_validate_access_grant_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "workforce_access_grants" AS existing
    LEFT JOIN "workforce_access_grant_revocations" AS revocation
      ON revocation."organizationId" = existing."organizationId"
      AND revocation."grantId" = existing."id"
    WHERE existing."organizationId" = NEW."organizationId"
      AND existing."principalUserId" = NEW."principalUserId"
      AND existing."effectiveFrom" < COALESCE(NEW."effectiveUntil", 'infinity'::timestamp)
      AND NEW."effectiveFrom" < LEAST(
        COALESCE(existing."effectiveUntil", 'infinity'::timestamp),
        COALESCE(revocation."revokedAt", 'infinity'::timestamp)
      )
      AND (
        (existing."role" = 'SCHEDULER' AND NEW."role" = 'TIME_APPROVER')
        OR (existing."role" = 'TIME_APPROVER' AND NEW."role" = 'SCHEDULER')
        OR (existing."role" = 'TIME_APPROVER' AND NEW."role" = 'TEAM_MANAGER')
        OR (existing."role" = 'TEAM_MANAGER' AND NEW."role" = 'TIME_APPROVER')
        OR (existing."role" = 'EVIDENCE_REVIEWER' AND NEW."role" = 'DEVICE_SECURITY_ADMIN')
        OR (existing."role" = 'DEVICE_SECURITY_ADMIN' AND NEW."role" = 'EVIDENCE_REVIEWER')
        OR (existing."role" = 'EXPORT_CUSTODIAN' AND NEW."role" = 'RETENTION_HOLD_OFFICER')
        OR (existing."role" = 'RETENTION_HOLD_OFFICER' AND NEW."role" = 'EXPORT_CUSTODIAN')
      )
  ) THEN
    RAISE EXCEPTION 'Workforce access grant conflicts with an incompatible effective role' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_access_grants_validate_insert
  BEFORE INSERT ON "workforce_access_grants"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_access_grant_insert();

CREATE OR REPLACE FUNCTION workforce_validate_access_grant_revocation_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  grant_effective_from TIMESTAMP(3);
BEGIN
  SELECT "effectiveFrom" INTO grant_effective_from
  FROM "workforce_access_grants"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."grantId";
  IF NOT FOUND OR NEW."revokedAt" < grant_effective_from THEN
    RAISE EXCEPTION 'Workforce access grant revocation must be tenant-valid and not predate the grant' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_access_grant_revocations_validate_insert
  BEFORE INSERT ON "workforce_access_grant_revocations"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_access_grant_revocation_insert();

CREATE OR REPLACE FUNCTION workforce_reject_access_grant_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce access grants are immutable; append a revocation and new grant' USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION workforce_reject_access_grant_revocation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce access grant revocations are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_access_grants_append_only
  BEFORE UPDATE OR DELETE ON "workforce_access_grants"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_access_grant_mutation();
CREATE TRIGGER workforce_access_grant_revocations_append_only
  BEFORE UPDATE OR DELETE ON "workforce_access_grant_revocations"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_access_grant_revocation_mutation();

ALTER TABLE "workforce_access_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_access_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY workforce_access_grants_tenant_select
  ON "workforce_access_grants" FOR SELECT
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY workforce_access_grants_tenant_insert
  ON "workforce_access_grants" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "workforce_access_grant_revocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_access_grant_revocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY workforce_access_grant_revocations_tenant_select
  ON "workforce_access_grant_revocations" FOR SELECT
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY workforce_access_grant_revocations_tenant_insert
  ON "workforce_access_grant_revocations" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

-- Storage stays dormant: no rows, endpoint, grant conversion or permission
-- switch are introduced. A later tenant-scoped C7 service must provide
-- authorization, atomic actor audit and a controlled rollout fence.
DO $$
DECLARE
  app_owner TEXT;
  table_name TEXT;
BEGIN
  SELECT tableowner INTO app_owner
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'mtm_agents';
  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    FOREACH table_name IN ARRAY ARRAY['workforce_access_grants', 'workforce_access_grant_revocations']
    LOOP
      EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO %I', table_name, app_owner);
    END LOOP;
  END IF;
END $$;
