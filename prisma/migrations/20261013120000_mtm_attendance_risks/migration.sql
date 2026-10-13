-- Review hints have their own MTM ledger: legacy Workforce cases block payroll approval.
SET lock_timeout='3s';
CREATE TABLE mtm_attendance_risk_cases (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "agentId" TEXT NOT NULL, "eventId" TEXT NOT NULL,
 kind VARCHAR(32) NOT NULL CHECK(kind IN ('SHARED_INSTALLATION','MOCK_LOCATION','OUTSIDE_BRANCH','CLOCK_DIFFERENCE','DELAYED_CLAIM','NEW_INSTALLATION')),
 "workDate" DATE NOT NULL, timezone VARCHAR(64) NOT NULL CHECK(length(timezone)>0),
 "detectorVersion" VARCHAR(64) NOT NULL CHECK("detectorVersion"='mtm-attendance-risk-v1'),
 "policySnapshot" JSONB NOT NULL CHECK(jsonb_typeof("policySnapshot")='object'),
 details JSONB NOT NULL CHECK(jsonb_typeof(details)='object' AND details->>'version'='1'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("organizationId","agentId") REFERENCES mtm_agents("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","eventId") REFERENCES mtm_agent_workday_events("organizationId",id) ON DELETE RESTRICT,
 UNIQUE("organizationId",id), UNIQUE("organizationId","eventId",kind)
);
CREATE TABLE mtm_attendance_risk_decisions (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "caseId" TEXT NOT NULL, "requestId" TEXT NOT NULL CHECK("requestId" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 "requestHash" VARCHAR(64) NOT NULL CHECK("requestHash" ~ '^[a-f0-9]{64}$'),
 "actorUserId" TEXT NOT NULL, reason VARCHAR(1000) NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 1000),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("organizationId","caseId") REFERENCES mtm_attendance_risk_cases("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","actorUserId") REFERENCES users("organizationId",id) ON DELETE RESTRICT,
 UNIQUE("organizationId","caseId"), UNIQUE("organizationId","requestId")
);
CREATE INDEX ON mtm_attendance_risk_cases("organizationId","agentId","workDate");
CREATE INDEX ON mtm_attendance_risk_cases("organizationId","workDate",kind);
CREATE FUNCTION mtm_attendance_risk_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fact RECORD; field TEXT; related TEXT;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organizations WHERE id=OLD."organizationId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'MTM_ATTENDANCE_RISK_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='mtm_attendance_risk_cases' THEN
  SELECT e."agentId",w."workDate" INTO fact FROM mtm_agent_workday_events e
   JOIN mtm_agent_workdays w ON w."organizationId"=e."organizationId" AND w.id=e."workdayId"
   JOIN mtm_attendance_mark_evidence m ON m."organizationId"=e."organizationId" AND m."eventId"=e.id
   WHERE e."organizationId"=NEW."organizationId" AND e.id=NEW."eventId" AND e.type::text IN ('START','FINISH');
  IF NOT FOUND OR fact."agentId"<>NEW."agentId" OR fact."workDate"<>NEW."workDate" THEN
   RAISE EXCEPTION 'MTM_ATTENDANCE_RISK_EVENT_MISMATCH' USING ERRCODE='23514';
  END IF;
  FOR field IN SELECT jsonb_object_keys(NEW.details) LOOP
   IF field<>ALL(ARRAY['version','relatedAgentIds','usualAgentId','usualDays','observedDays','deltaSeconds','thresholdSeconds','branchRevisionId','distanceMeters']) THEN
    RAISE EXCEPTION 'MTM_ATTENDANCE_RISK_PRIVATE_DETAIL' USING ERRCODE='23514';
   END IF;
  END LOOP;
  FOR field IN SELECT jsonb_object_keys(NEW."policySnapshot") LOOP
   IF field<>ALL(ARRAY['allowSharedInstallations','rejectMockLocations','clockDifferenceSeconds']) THEN
    RAISE EXCEPTION 'MTM_ATTENDANCE_RISK_PRIVATE_POLICY' USING ERRCODE='23514';
   END IF;
  END LOOP;
  IF NEW.details ? 'relatedAgentIds' THEN
   IF jsonb_typeof(NEW.details->'relatedAgentIds')<>'array' THEN RAISE EXCEPTION 'MTM_ATTENDANCE_RISK_RELATED_INVALID' USING ERRCODE='23514'; END IF;
   FOR related IN SELECT jsonb_array_elements_text(NEW.details->'relatedAgentIds') LOOP
    IF NOT EXISTS(SELECT 1 FROM mtm_agents WHERE "organizationId"=NEW."organizationId" AND id=related) THEN
     RAISE EXCEPTION 'MTM_ATTENDANCE_RISK_RELATED_INVALID' USING ERRCODE='23514';
    END IF;
   END LOOP;
  END IF;
  IF NEW.details->>'usualAgentId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM mtm_agents WHERE "organizationId"=NEW."organizationId" AND id=NEW.details->>'usualAgentId') THEN
   RAISE EXCEPTION 'MTM_ATTENDANCE_RISK_RELATED_INVALID' USING ERRCODE='23514';
  END IF;
 END IF;
 NEW."createdAt":=clock_timestamp(); RETURN NEW;
END $$;
DO $$ DECLARE name TEXT; BEGIN
 FOREACH name IN ARRAY ARRAY['mtm_attendance_risk_cases','mtm_attendance_risk_decisions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("organizationId"=current_setting(''app.org_id'',true) OR current_setting(''app.rls_bypass'',true)=''on'') WITH CHECK ("organizationId"=current_setting(''app.org_id'',true) OR current_setting(''app.rls_bypass'',true)=''on'')',name);
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION mtm_attendance_risk_guard()',name||'_guard',name);
 END LOOP;
END $$;
