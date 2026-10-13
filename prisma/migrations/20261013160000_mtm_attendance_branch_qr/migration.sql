SET lock_timeout='3s';
CREATE TABLE mtm_attendance_qr_evidence (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "agentId" TEXT NOT NULL, "eventId" TEXT NOT NULL, action VARCHAR(6) NOT NULL CHECK(action IN ('START','FINISH')),
 state VARCHAR(16) NOT NULL CHECK(state IN ('VERIFIED','NOT_PROVIDED','EXPIRED','INVALID','BRANCH_CHANGED','REUSED')),
 "branchRevisionId" TEXT, "nonceFingerprint" VARCHAR(64), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("organizationId","agentId") REFERENCES mtm_agents("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","eventId") REFERENCES mtm_agent_workday_events("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","branchRevisionId") REFERENCES mtm_attendance_branch_revisions("organizationId",id) ON DELETE RESTRICT,
 CHECK ((state='VERIFIED' AND "branchRevisionId" IS NOT NULL AND "nonceFingerprint" IS NOT NULL AND "nonceFingerprint" ~ '^[a-f0-9]{64}$')
   OR (state<>'VERIFIED' AND "branchRevisionId" IS NULL AND "nonceFingerprint" IS NULL)),
 UNIQUE("organizationId","eventId"), UNIQUE("organizationId","agentId","nonceFingerprint",action)
);
CREATE INDEX ON mtm_attendance_qr_evidence("organizationId","agentId","createdAt");
CREATE FUNCTION mtm_attendance_qr_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organizations WHERE id=OLD."organizationId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'MTM_ATTENDANCE_QR_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM mtm_agent_workday_events e WHERE e."organizationId"=NEW."organizationId" AND e.id=NEW."eventId" AND e."agentId"=NEW."agentId" AND e.type::text=NEW.action) THEN
  RAISE EXCEPTION 'MTM_ATTENDANCE_QR_EVENT_MISMATCH' USING ERRCODE='23514';
 END IF;
 NEW."createdAt":=clock_timestamp(); RETURN NEW;
END $$;
ALTER TABLE "mtm_attendance_qr_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_qr_evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "mtm_attendance_qr_evidence" FOR SELECT USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE POLICY tenant_insert ON "mtm_attendance_qr_evidence" FOR INSERT WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE TRIGGER mtm_attendance_qr_guard BEFORE INSERT OR UPDATE OR DELETE ON "mtm_attendance_qr_evidence" FOR EACH ROW EXECUTE FUNCTION mtm_attendance_qr_guard();
