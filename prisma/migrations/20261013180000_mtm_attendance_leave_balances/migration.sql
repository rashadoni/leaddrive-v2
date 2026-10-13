SET lock_timeout='3s';
-- Client-confirmed norms and explicit yearly inputs. No legal defaults or backfill.
CREATE TABLE mtm_attendance_leave_policies (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 year INTEGER NOT NULL CHECK(year BETWEEN 2000 AND 2100), version INTEGER NOT NULL CHECK(version>0), "previousId" TEXT,
 "requestId" TEXT NOT NULL, "requestHash" VARCHAR(64) NOT NULL CHECK("requestHash" ~ '^[a-f0-9]{64}$'),
 value JSONB NOT NULL CHECK(jsonb_typeof(value)='object'), reason VARCHAR(1000) NOT NULL CHECK(length(btrim(reason))>=3),
 "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("organizationId","createdBy") REFERENCES users("organizationId",id) ON DELETE RESTRICT,
 UNIQUE("organizationId",id), UNIQUE("organizationId","requestId"), UNIQUE("organizationId",year,version)
);
ALTER TABLE "mtm_attendance_leave_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_leave_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "mtm_attendance_leave_policies" FOR SELECT USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE POLICY tenant_insert ON "mtm_attendance_leave_policies" FOR INSERT WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE TABLE mtm_attendance_leave_profiles (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "agentId" TEXT NOT NULL,
 year INTEGER NOT NULL CHECK(year BETWEEN 2000 AND 2100), version INTEGER NOT NULL CHECK(version>0), "previousId" TEXT,
 "requestId" TEXT NOT NULL, "requestHash" VARCHAR(64) NOT NULL CHECK("requestHash" ~ '^[a-f0-9]{64}$'),
 value JSONB NOT NULL CHECK(jsonb_typeof(value)='object'), reason VARCHAR(1000) NOT NULL CHECK(length(btrim(reason))>=3),
 "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("organizationId","createdBy") REFERENCES users("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","agentId") REFERENCES mtm_agents("organizationId",id) ON DELETE RESTRICT,
 UNIQUE("organizationId",id), UNIQUE("organizationId","requestId"), UNIQUE("organizationId","agentId",year,version)
);
ALTER TABLE "mtm_attendance_leave_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_leave_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "mtm_attendance_leave_profiles" FOR SELECT USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE POLICY tenant_insert ON "mtm_attendance_leave_profiles" FOR INSERT WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE FUNCTION mtm_attendance_leave_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE predecessor RECORD;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organizations WHERE id=OLD."organizationId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'MTM_ATTENDANCE_LEAVE_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('mtm-attendance-leave:'||NEW."organizationId"||':'||NEW.year,0));
 IF TG_TABLE_NAME='mtm_attendance_leave_policies' THEN
  SELECT id,version,"createdAt" INTO predecessor FROM mtm_attendance_leave_policies WHERE "organizationId"=NEW."organizationId" AND year=NEW.year ORDER BY version DESC LIMIT 1;
 ELSE
  SELECT id,version,"createdAt" INTO predecessor FROM mtm_attendance_leave_profiles WHERE "organizationId"=NEW."organizationId" AND "agentId"=NEW."agentId" AND year=NEW.year ORDER BY version DESC LIMIT 1;
 END IF;
 IF NEW.version<>COALESCE(predecessor.version,0)+1 OR NEW."previousId" IS DISTINCT FROM predecessor.id THEN
  RAISE EXCEPTION 'MTM_ATTENDANCE_LEAVE_CHANGED' USING ERRCODE='23514';
 END IF;
 NEW."createdAt":=GREATEST(clock_timestamp()::timestamp(3),predecessor."createdAt"+interval '1 millisecond'); RETURN NEW;
END $$;
CREATE TRIGGER mtm_attendance_leave_policy_guard BEFORE INSERT OR UPDATE OR DELETE ON mtm_attendance_leave_policies FOR EACH ROW EXECUTE FUNCTION mtm_attendance_leave_history_guard();
CREATE TRIGGER mtm_attendance_leave_profile_guard BEFORE INSERT OR UPDATE OR DELETE ON mtm_attendance_leave_profiles FOR EACH ROW EXECUTE FUNCTION mtm_attendance_leave_history_guard();
