-- Optional signal, separate from legacy GPS DTOs. Never infer false for old rows.
SET lock_timeout='3s';
CREATE TABLE mtm_attendance_stream_integrity (
 "locationId" TEXT PRIMARY KEY REFERENCES mtm_agent_locations(id) ON DELETE CASCADE,
 "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "agentId" TEXT NOT NULL,
 "consentId" TEXT NOT NULL,
 "isMock" BOOLEAN NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("organizationId","agentId") REFERENCES mtm_agents("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY ("organizationId","consentId") REFERENCES mtm_attendance_location_consents("organizationId",id) ON DELETE RESTRICT
);
CREATE INDEX ON mtm_attendance_stream_integrity("organizationId","agentId","createdAt");
ALTER TABLE mtm_attendance_stream_integrity ENABLE ROW LEVEL SECURITY;
ALTER TABLE mtm_attendance_stream_integrity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON mtm_attendance_stream_integrity FOR SELECT USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE POLICY tenant_insert ON mtm_attendance_stream_integrity FOR INSERT WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE FUNCTION mtm_attendance_stream_integrity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'MTM_ATTENDANCE_STREAM_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM mtm_agent_locations WHERE id=OLD."locationId") OR NOT EXISTS(SELECT 1 FROM organizations WHERE id=OLD."organizationId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'MTM_ATTENDANCE_STREAM_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM mtm_agent_locations l JOIN mtm_attendance_location_consents c
   ON c."organizationId"=l."organizationId" AND c."agentId"=l."agentId"
   WHERE l.id=NEW."locationId" AND l."organizationId"=NEW."organizationId" AND l."agentId"=NEW."agentId"
     AND c.id=NEW."consentId" AND c.accepted AND l."recordedAt">=c."createdAt") THEN
  RAISE EXCEPTION 'MTM_ATTENDANCE_STREAM_SOURCE_MISMATCH' USING ERRCODE='23514';
 END IF;
 NEW."createdAt":=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER mtm_attendance_stream_integrity_guard BEFORE INSERT OR UPDATE OR DELETE ON mtm_attendance_stream_integrity FOR EACH ROW EXECUTE FUNCTION mtm_attendance_stream_integrity_guard();
