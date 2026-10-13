SET lock_timeout='3s';
CREATE TABLE mtm_attendance_reminder_notices (
 id TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "agentId" TEXT NOT NULL,
 "workDate" DATE NOT NULL,
 kind VARCHAR(20) NOT NULL CHECK(kind IN ('EMPLOYEE_START','EMPLOYEE_FINISH','MANAGER_MISSING','MANAGER_LATE')),
 "recipientAgentId" TEXT,
 "recipientUserId" TEXT,
 "observedAt" TIMESTAMP(3) NOT NULL,
 "ruleId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("organizationId","agentId") REFERENCES mtm_agents("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","recipientAgentId") REFERENCES mtm_agents("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","recipientUserId") REFERENCES users("organizationId",id) ON DELETE RESTRICT,
 CHECK ((kind IN ('EMPLOYEE_START','EMPLOYEE_FINISH') AND "recipientAgentId" IS NOT NULL AND "recipientAgentId"="agentId" AND "recipientUserId" IS NULL)
   OR (kind IN ('MANAGER_MISSING','MANAGER_LATE') AND "recipientAgentId" IS NULL AND "recipientUserId" IS NOT NULL)),
 CONSTRAINT mtm_reminder_employee_dedupe UNIQUE("organizationId","agentId","workDate",kind,"recipientAgentId"),
 CONSTRAINT mtm_reminder_manager_dedupe UNIQUE("organizationId","agentId","workDate",kind,"recipientUserId")
);
CREATE INDEX mtm_reminder_user_date ON mtm_attendance_reminder_notices("organizationId","recipientUserId","workDate");
CREATE INDEX mtm_reminder_agent_date ON mtm_attendance_reminder_notices("organizationId","recipientAgentId","workDate");
CREATE FUNCTION mtm_attendance_reminder_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organizations WHERE id=OLD."organizationId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'MTM_ATTENDANCE_REMINDER_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM mtm_agents WHERE "organizationId"=NEW."organizationId" AND id=NEW."agentId" AND status='ACTIVE' AND (role='AGENT' OR "attendanceParticipant")) THEN
  RAISE EXCEPTION 'MTM_ATTENDANCE_REMINDER_SUBJECT_INVALID' USING ERRCODE='23514';
 END IF;
 IF NEW."recipientUserId" IS NOT NULL AND EXISTS(SELECT 1 FROM mtm_agents WHERE "organizationId"=NEW."organizationId" AND id=NEW."agentId" AND "userId"=NEW."recipientUserId") THEN
  RAISE EXCEPTION 'MTM_ATTENDANCE_REMINDER_SELF_RECIPIENT' USING ERRCODE='23514';
 END IF;
 NEW."createdAt":=clock_timestamp(); RETURN NEW;
END $$;
ALTER TABLE mtm_attendance_reminder_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE mtm_attendance_reminder_notices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON mtm_attendance_reminder_notices FOR SELECT USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE POLICY tenant_insert ON mtm_attendance_reminder_notices FOR INSERT WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE TRIGGER mtm_attendance_reminder_guard BEFORE INSERT OR UPDATE OR DELETE ON mtm_attendance_reminder_notices FOR EACH ROW EXECUTE FUNCTION mtm_attendance_reminder_guard();
