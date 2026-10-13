-- Approval is for one installation/account pair, not proof of a physical phone.
SET lock_timeout='3s';
CREATE TABLE mtm_attendance_installation_requests (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "agentId" TEXT NOT NULL, "installationId" VARCHAR(128) NOT NULL CHECK("installationId" ~ '^rf-[a-z0-9-]{20,125}$'),
 "requestId" TEXT NOT NULL CHECK("requestId" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 "requestHash" VARCHAR(64) NOT NULL CHECK("requestHash" ~ '^[a-f0-9]{64}$'),
 "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("organizationId","agentId") REFERENCES mtm_agents("organizationId",id) ON DELETE RESTRICT,
 UNIQUE("organizationId",id), UNIQUE("organizationId","requestId")
);
CREATE INDEX ON mtm_attendance_installation_requests("organizationId","agentId","installationId","submittedAt");
CREATE INDEX ON mtm_attendance_installation_requests("organizationId","submittedAt",id);
CREATE TABLE mtm_attendance_installation_decisions (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "installationRequestId" TEXT NOT NULL, action VARCHAR(7) NOT NULL CHECK(action IN ('APPROVE','REJECT')),
 "requestId" TEXT NOT NULL CHECK("requestId" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 "requestHash" VARCHAR(64) NOT NULL CHECK("requestHash" ~ '^[a-f0-9]{64}$'), "actorUserId" TEXT NOT NULL,
 reason VARCHAR(1000) NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 1000), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("organizationId","installationRequestId") REFERENCES mtm_attendance_installation_requests("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","actorUserId") REFERENCES users("organizationId",id) ON DELETE RESTRICT,
 UNIQUE("organizationId",id), UNIQUE("organizationId","installationRequestId"), UNIQUE("organizationId","requestId")
);
CREATE TABLE mtm_attendance_installation_revocations (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "decisionId" TEXT NOT NULL, "requestId" TEXT NOT NULL CHECK("requestId" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 "requestHash" VARCHAR(64) NOT NULL CHECK("requestHash" ~ '^[a-f0-9]{64}$'), "actorUserId" TEXT NOT NULL,
 reason VARCHAR(1000) NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 1000), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("organizationId","decisionId") REFERENCES mtm_attendance_installation_decisions("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","actorUserId") REFERENCES users("organizationId",id) ON DELETE RESTRICT,
 UNIQUE("organizationId","decisionId"), UNIQUE("organizationId","requestId")
);
CREATE FUNCTION mtm_attendance_installation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id TEXT; decision_action TEXT; previous_time TIMESTAMP(3);
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organizations WHERE id=OLD."organizationId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'MTM_ATTENDANCE_INSTALLATION_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='mtm_attendance_installation_requests' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('mtm-attendance-requests:'||NEW."organizationId"||':'||NEW."agentId",0));
  SELECT "submittedAt" INTO previous_time FROM mtm_attendance_installation_requests
    WHERE "organizationId"=NEW."organizationId" AND "agentId"=NEW."agentId" AND "installationId"=NEW."installationId"
    ORDER BY "submittedAt" DESC,id DESC LIMIT 1;
  NEW."submittedAt":=GREATEST(clock_timestamp()::timestamp(3),previous_time+interval '1 millisecond'); RETURN NEW;
 ELSIF TG_TABLE_NAME='mtm_attendance_installation_decisions' THEN
  SELECT a."userId" INTO owner_id FROM mtm_attendance_installation_requests r JOIN mtm_agents a
   ON a."organizationId"=r."organizationId" AND a.id=r."agentId" WHERE r."organizationId"=NEW."organizationId" AND r.id=NEW."installationRequestId";
 ELSE
  SELECT a."userId",d.action INTO owner_id,decision_action FROM mtm_attendance_installation_decisions d
   JOIN mtm_attendance_installation_requests r ON r."organizationId"=d."organizationId" AND r.id=d."installationRequestId"
   JOIN mtm_agents a ON a."organizationId"=r."organizationId" AND a.id=r."agentId"
   WHERE d."organizationId"=NEW."organizationId" AND d.id=NEW."decisionId";
  IF decision_action IS DISTINCT FROM 'APPROVE' THEN RAISE EXCEPTION 'MTM_ATTENDANCE_INSTALLATION_NOT_APPROVED' USING ERRCODE='23514'; END IF;
 END IF;
 IF owner_id=NEW."actorUserId" THEN RAISE EXCEPTION 'MTM_ATTENDANCE_INSTALLATION_SELF_APPROVAL' USING ERRCODE='23514'; END IF;
 NEW."createdAt":=clock_timestamp(); RETURN NEW;
END $$;
ALTER TABLE "mtm_attendance_installation_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_installation_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "mtm_attendance_installation_requests" FOR SELECT USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE POLICY tenant_insert ON "mtm_attendance_installation_requests" FOR INSERT WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE TRIGGER mtm_attendance_installation_requests_guard BEFORE INSERT OR UPDATE OR DELETE ON "mtm_attendance_installation_requests" FOR EACH ROW EXECUTE FUNCTION mtm_attendance_installation_guard();
ALTER TABLE "mtm_attendance_installation_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_installation_decisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "mtm_attendance_installation_decisions" FOR SELECT USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE POLICY tenant_insert ON "mtm_attendance_installation_decisions" FOR INSERT WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE TRIGGER mtm_attendance_installation_decisions_guard BEFORE INSERT OR UPDATE OR DELETE ON "mtm_attendance_installation_decisions" FOR EACH ROW EXECUTE FUNCTION mtm_attendance_installation_guard();
ALTER TABLE "mtm_attendance_installation_revocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_installation_revocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "mtm_attendance_installation_revocations" FOR SELECT USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE POLICY tenant_insert ON "mtm_attendance_installation_revocations" FOR INSERT WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE TRIGGER mtm_attendance_installation_revocations_guard BEFORE INSERT OR UPDATE OR DELETE ON "mtm_attendance_installation_revocations" FOR EACH ROW EXECUTE FUNCTION mtm_attendance_installation_guard();
