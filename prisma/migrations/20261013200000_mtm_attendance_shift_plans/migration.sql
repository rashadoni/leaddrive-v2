SET lock_timeout='3s';
CREATE TABLE mtm_attendance_shift_plans (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version>0), "previousId" TEXT,
 "requestId" TEXT NOT NULL, "requestHash" VARCHAR(64) NOT NULL CHECK("requestHash" ~ '^[a-f0-9]{64}$'),
 "teamId" TEXT, "teamName" TEXT, value JSONB NOT NULL CHECK(jsonb_typeof(value)='object'),
 reason VARCHAR(1000) NOT NULL CHECK(length(btrim(reason))>=3), "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("organizationId","createdBy") REFERENCES users("organizationId",id) ON DELETE RESTRICT,
 UNIQUE("organizationId",id), UNIQUE("organizationId",version), UNIQUE("organizationId","requestId")
);
CREATE TABLE mtm_attendance_shift_members (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "planId" TEXT NOT NULL, "agentId" TEXT NOT NULL,
 FOREIGN KEY("organizationId","planId") REFERENCES mtm_attendance_shift_plans("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","agentId") REFERENCES mtm_agents("organizationId",id) ON DELETE RESTRICT,
 UNIQUE("organizationId","planId","agentId")
);
CREATE INDEX mtm_attendance_shift_members_agent ON mtm_attendance_shift_members("organizationId","agentId");
ALTER TABLE "mtm_attendance_shift_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_shift_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "mtm_attendance_shift_plans" FOR SELECT USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE POLICY tenant_insert ON "mtm_attendance_shift_plans" FOR INSERT WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
ALTER TABLE "mtm_attendance_shift_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_shift_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "mtm_attendance_shift_members" FOR SELECT USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE POLICY tenant_insert ON "mtm_attendance_shift_members" FOR INSERT WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE FUNCTION mtm_attendance_shift_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE predecessor RECORD;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organizations WHERE id=OLD."organizationId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'MTM_ATTENDANCE_SHIFT_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('mtm-attendance-shifts:'||NEW."organizationId",0));
 SELECT id,version,"createdAt" INTO predecessor FROM mtm_attendance_shift_plans WHERE "organizationId"=NEW."organizationId" ORDER BY version DESC LIMIT 1;
 IF NEW.version<>COALESCE(predecessor.version,0)+1 OR NEW."previousId" IS DISTINCT FROM predecessor.id THEN
  RAISE EXCEPTION 'MTM_ATTENDANCE_SHIFT_CHANGED' USING ERRCODE='23514';
 END IF;
 NEW."createdAt":=GREATEST(clock_timestamp()::timestamp(3),predecessor."createdAt"+interval '1 millisecond'); RETURN NEW;
END $$;
CREATE TRIGGER mtm_attendance_shift_plan_guard BEFORE INSERT OR UPDATE OR DELETE ON mtm_attendance_shift_plans FOR EACH ROW EXECUTE FUNCTION mtm_attendance_shift_history_guard();
CREATE FUNCTION mtm_attendance_shift_members_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  -- Membership is published in the same transaction as its parent. A later
  -- insert must not silently change an already frozen roster.
  IF NOT EXISTS(SELECT 1 FROM mtm_attendance_shift_plans p WHERE p."organizationId"=NEW."organizationId" AND p.id=NEW."planId"
    AND p.xmin::text::bigint=mod(pg_current_xact_id()::text::numeric,4294967296)::bigint) THEN
   RAISE EXCEPTION 'MTM_ATTENDANCE_SHIFT_ROSTER_FROZEN' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organizations WHERE id=OLD."organizationId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'MTM_ATTENDANCE_SHIFT_IMMUTABLE' USING ERRCODE='23514';
END $$;
CREATE TRIGGER mtm_attendance_shift_member_guard BEFORE INSERT OR UPDATE OR DELETE ON mtm_attendance_shift_members FOR EACH ROW EXECUTE FUNCTION mtm_attendance_shift_members_guard();
