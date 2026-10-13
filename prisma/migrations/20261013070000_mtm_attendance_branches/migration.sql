-- MTM-only registry, independent of the withdrawn Workforce routes.
SET lock_timeout = '3s';
CREATE TABLE mtm_attendance_branches (
  id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("organizationId", id)
);
CREATE TABLE mtm_attendance_branch_revisions (
  id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "branchId" TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0), "previousId" TEXT,
  "requestId" TEXT NOT NULL, "requestHash" VARCHAR(64) NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  name VARCHAR(160) NOT NULL CHECK (length(btrim(name)) > 0), address VARCHAR(500) NOT NULL CHECK (length(btrim(address)) > 0),
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  "radiusMeters" INTEGER NOT NULL CHECK ("radiusMeters" BETWEEN 25 AND 5000), active BOOLEAN NOT NULL,
  "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("organizationId", "branchId") REFERENCES mtm_attendance_branches("organizationId",id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("organizationId", "createdBy") REFERENCES users("organizationId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE ("organizationId", id), UNIQUE ("organizationId", "branchId", version), UNIQUE ("organizationId", "requestId")
);
CREATE INDEX ON mtm_attendance_branch_revisions("organizationId", "branchId", "createdAt");
CREATE TABLE mtm_attendance_primary_branch_revisions (
  id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "agentId" TEXT NOT NULL, "branchId" TEXT, version INTEGER NOT NULL CHECK (version > 0), "previousId" TEXT,
  "requestId" TEXT NOT NULL, "requestHash" VARCHAR(64) NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("organizationId", "agentId") REFERENCES mtm_agents("organizationId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("organizationId", "branchId") REFERENCES mtm_attendance_branches("organizationId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("organizationId", "createdBy") REFERENCES users("organizationId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE ("organizationId", id), UNIQUE ("organizationId", "agentId", version), UNIQUE ("organizationId", "requestId")
);
CREATE INDEX ON mtm_attendance_primary_branch_revisions("organizationId", "agentId", "createdAt");
ALTER TABLE "mtm_attendance_branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_branches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_attendance_branches"
  USING ("organizationId" = current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true) = 'on');
ALTER TABLE "mtm_attendance_branch_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_branch_revisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_attendance_branch_revisions"
  USING ("organizationId" = current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true) = 'on');
ALTER TABLE "mtm_attendance_primary_branch_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_primary_branch_revisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_attendance_primary_branch_revisions"
  USING ("organizationId" = current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true) = 'on');

CREATE FUNCTION mtm_attendance_branch_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE predecessor RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id=OLD."organizationId") THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'MTM_ATTENDANCE_BRANCH_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  -- Database authority supplies a monotonic timestamp; callers cannot backdate.
  IF TG_TABLE_NAME = 'mtm_attendance_branches' THEN
    NEW."createdAt" := clock_timestamp(); RETURN NEW;
  END IF;
  -- Both services and direct writers serialize timeline publication per tenant.
  PERFORM pg_advisory_xact_lock(hashtextextended('mtm-attendance-branches:' || NEW."organizationId", 0));
  IF TG_TABLE_NAME = 'mtm_attendance_branch_revisions' THEN
    SELECT id,version,"createdAt" INTO predecessor FROM mtm_attendance_branch_revisions
      WHERE "organizationId"=NEW."organizationId" AND "branchId"=NEW."branchId" ORDER BY version DESC LIMIT 1;
  ELSE
    SELECT id,version,"createdAt" INTO predecessor FROM mtm_attendance_primary_branch_revisions
      WHERE "organizationId"=NEW."organizationId" AND "agentId"=NEW."agentId" ORDER BY version DESC LIMIT 1;
    IF NEW."branchId" IS NOT NULL AND NOT COALESCE((SELECT active FROM mtm_attendance_branch_revisions
      WHERE "organizationId"=NEW."organizationId" AND "branchId"=NEW."branchId" ORDER BY version DESC LIMIT 1),false) THEN
      RAISE EXCEPTION 'MTM_ATTENDANCE_BRANCH_UNAVAILABLE' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.version <> COALESCE(predecessor.version,0)+1 OR NEW."previousId" IS DISTINCT FROM predecessor.id THEN
    RAISE EXCEPTION 'MTM_ATTENDANCE_BRANCH_CHANGED' USING ERRCODE='23514';
  END IF;
  NEW."createdAt" := GREATEST(clock_timestamp()::timestamp(3), predecessor."createdAt" + interval '1 millisecond');
  RETURN NEW;
END $$;
CREATE TRIGGER mtm_attendance_branches_immutable BEFORE INSERT OR UPDATE OR DELETE ON mtm_attendance_branches FOR EACH ROW EXECUTE FUNCTION mtm_attendance_branch_history_guard();
CREATE TRIGGER mtm_attendance_branch_revisions_immutable BEFORE INSERT OR UPDATE OR DELETE ON mtm_attendance_branch_revisions FOR EACH ROW EXECUTE FUNCTION mtm_attendance_branch_history_guard();
CREATE TRIGGER mtm_attendance_primary_branch_revisions_immutable BEFORE INSERT OR UPDATE OR DELETE ON mtm_attendance_primary_branch_revisions FOR EACH ROW EXECUTE FUNCTION mtm_attendance_branch_history_guard();
-- Rollback keeps this additive history; no data rewrite or deletion is required.
