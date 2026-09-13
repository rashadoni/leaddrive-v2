-- C10: this table makes a tenant-wide one-year time/decision legal hold
-- explicit and fail-closed. It intentionally creates no automatic purge or
-- mutation API: those require C7 officer scopes, backup evidence and legal
-- approval. A hold contains an opaque case reference, never legal documents,
-- employee explanations, coordinates, QR values or device material.

SET lock_timeout = '3s';

CREATE TYPE "WorkforceLegalHoldScope" AS ENUM ('TIME_DECISION');
CREATE TYPE "WorkforceLegalHoldStatus" AS ENUM ('ACTIVE', 'RELEASED');

CREATE TABLE "workforce_legal_holds" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "scope" "WorkforceLegalHoldScope" NOT NULL DEFAULT 'TIME_DECISION',
  "status" "WorkforceLegalHoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "matterReference" VARCHAR(191) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedByUserId" TEXT,
  "releasedAt" TIMESTAMP(3),
  CONSTRAINT "workforce_legal_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workforce_legal_holds_matter_reference_check"
    CHECK (NULLIF(btrim("matterReference"), '') IS NOT NULL),
  CONSTRAINT "workforce_legal_holds_status_release_check" CHECK (
    ("status" = 'ACTIVE' AND "releasedByUserId" IS NULL AND "releasedAt" IS NULL)
    OR
    ("status" = 'RELEASED' AND "releasedByUserId" IS NOT NULL AND "releasedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "workforce_legal_holds_organizationId_id_key"
  ON "workforce_legal_holds"("organizationId", "id");
CREATE INDEX "workforce_legal_holds_active_scope_idx"
  ON "workforce_legal_holds"("organizationId", "scope", "status", "createdAt");
CREATE INDEX "workforce_legal_holds_created_by_idx"
  ON "workforce_legal_holds"("organizationId", "createdByUserId", "createdAt");
CREATE INDEX "workforce_legal_holds_released_by_idx"
  ON "workforce_legal_holds"("organizationId", "releasedByUserId", "releasedAt");

ALTER TABLE "workforce_legal_holds"
  ADD CONSTRAINT "workforce_legal_holds_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_legal_holds_created_by_fkey"
    FOREIGN KEY ("organizationId", "createdByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workforce_legal_holds_released_by_fkey"
    FOREIGN KEY ("organizationId", "releasedByUserId") REFERENCES "users"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION workforce_guard_legal_hold_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workforce legal hold cannot be deleted' USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'ACTIVE'
     AND NEW."status" = 'RELEASED'
     AND NEW."releasedByUserId" IS NOT NULL
     AND NEW."releasedAt" IS NOT NULL
     AND (to_jsonb(NEW) - ARRAY['status', 'releasedByUserId', 'releasedAt'])
         IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'releasedByUserId', 'releasedAt']) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Workforce legal hold is immutable except for one recorded release' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_legal_holds_guard
  BEFORE UPDATE OR DELETE ON "workforce_legal_holds"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_legal_hold_mutation();

ALTER TABLE "workforce_legal_holds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workforce_legal_holds" FORCE ROW LEVEL SECURITY;
CREATE POLICY workforce_legal_holds_tenant_isolation ON "workforce_legal_holds"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
