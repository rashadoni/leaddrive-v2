-- C7: explicit employment lifecycle history. This is intentionally additive
-- and does not translate a mutable directory ACTIVE/INACTIVE/SUSPENDED value
-- into a legal employment conclusion. Historical status is unknown until an
-- authorized HR lifecycle fact is recorded.

SET lock_timeout = '3s';

CREATE TYPE "WorkforceEmploymentEventKind" AS ENUM (
  'HIRE',
  'TERMINATION',
  'REHIRE'
);

CREATE TABLE "workforce_employment_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "kind" "WorkforceEmploymentEventKind" NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "source" VARCHAR(48) NOT NULL,
  "recordedByUserId" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workforce_employment_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_employment_events_source_check"
    CHECK (NULLIF(btrim("source"), '') IS NOT NULL)
);

CREATE UNIQUE INDEX "workforce_employment_events_organizationId_id_key"
  ON "workforce_employment_events"("organizationId", "id");
CREATE UNIQUE INDEX "workforce_employment_events_agent_effective_kind_key"
  ON "workforce_employment_events"("organizationId", "agentId", "effectiveAt", "kind");
CREATE INDEX "workforce_employment_events_agent_effective_idx"
  ON "workforce_employment_events"("organizationId", "agentId", "effectiveAt");
CREATE INDEX "workforce_employment_events_effective_idx"
  ON "workforce_employment_events"("organizationId", "effectiveAt");
CREATE INDEX "workforce_employment_events_recorded_by_idx"
  ON "workforce_employment_events"("organizationId", "recordedByUserId", "recordedAt");

ALTER TABLE "workforce_employment_events"
  ADD CONSTRAINT "workforce_employment_events_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_employment_events_agent_fkey"
    FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_employment_events_recorded_by_fkey"
    FOREIGN KEY ("organizationId", "recordedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION workforce_reject_employment_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce employment history is immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_employment_events_immutable
  BEFORE UPDATE OR DELETE ON "workforce_employment_events"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_employment_event_mutation();

ALTER TABLE "workforce_employment_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_employment_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workforce_employment_events_tenant_select"
  ON "workforce_employment_events" FOR SELECT
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY "workforce_employment_events_tenant_insert"
  ON "workforce_employment_events" FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
