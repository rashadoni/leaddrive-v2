SET lock_timeout='3s';
CREATE TABLE mtm_attendance_month_closes (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 month DATE NOT NULL CHECK(EXTRACT(DAY FROM month)=1), "requestId" TEXT NOT NULL,
 "requestHash" VARCHAR(64) NOT NULL CHECK("requestHash" ~ '^[a-f0-9]{64}$'),
 "payloadHash" VARCHAR(64) NOT NULL CHECK("payloadHash" ~ '^[a-f0-9]{64}$'),
 payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object' AND payload->>'version'='1'),
 "createdBy" TEXT NOT NULL, "createdByName" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("organizationId","createdBy") REFERENCES users("organizationId",id) ON DELETE RESTRICT,
 UNIQUE("organizationId",id), UNIQUE("organizationId","requestId")
);
CREATE INDEX mtm_month_closes_period ON mtm_attendance_month_closes("organizationId",month,"createdAt",id);
CREATE TABLE mtm_attendance_month_members (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "closeId" TEXT NOT NULL, "agentId" TEXT NOT NULL, month DATE NOT NULL CHECK(EXTRACT(DAY FROM month)=1),
 FOREIGN KEY("organizationId","closeId") REFERENCES mtm_attendance_month_closes("organizationId",id) ON DELETE CASCADE,
 FOREIGN KEY("organizationId","agentId") REFERENCES mtm_agents("organizationId",id) ON DELETE RESTRICT,
 UNIQUE("organizationId","closeId","agentId"), UNIQUE("organizationId","agentId",month)
);
CREATE TABLE mtm_attendance_month_days (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "closeId" TEXT NOT NULL, "agentId" TEXT NOT NULL, "sourceDate" DATE NOT NULL,
 FOREIGN KEY("organizationId","closeId","agentId") REFERENCES mtm_attendance_month_members("organizationId","closeId","agentId") ON DELETE CASCADE,
 UNIQUE("organizationId","agentId","sourceDate")
);
CREATE INDEX mtm_month_days_snapshot ON mtm_attendance_month_days("organizationId","closeId");
CREATE FUNCTION mtm_attendance_month_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organizations WHERE id=OLD."organizationId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'MTM_ATTENDANCE_MONTH_IMMUTABLE' USING ERRCODE='23514';
END $$;
DO $$ DECLARE tab TEXT; BEGIN
 FOREACH tab IN ARRAY ARRAY['mtm_attendance_month_closes','mtm_attendance_month_members','mtm_attendance_month_days'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT USING ("organizationId"=current_setting(''app.org_id'',true) OR current_setting(''app.rls_bypass'',true)=''on'')',tab);
  EXECUTE format('CREATE POLICY tenant_insert ON %I FOR INSERT WITH CHECK ("organizationId"=current_setting(''app.org_id'',true) OR current_setting(''app.rls_bypass'',true)=''on'')',tab);
  EXECUTE format('CREATE TRIGGER mtm_month_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION mtm_attendance_month_history_guard()',tab);
 END LOOP;
END $$;
-- READ COMMITTED close takes the exclusive counterpart only after its sorted
-- canonical employee locks and fresh authorization locks. Every source writer
-- holds the shared fence until commit. This avoids a stale RR snapshot taken
-- before waiting for a concurrent event and avoids any whole-table lock.
CREATE FUNCTION mtm_attendance_month_source_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org TEXT;
BEGIN
 org:=CASE WHEN TG_OP='DELETE' THEN OLD."organizationId" ELSE NEW."organizationId" END;
 IF org IS NOT NULL THEN PERFORM pg_advisory_xact_lock_shared(hashtextextended('mtm-attendance-month-snapshot:'||org,0)); END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DO $$ DECLARE tab TEXT; BEGIN
 FOREACH tab IN ARRAY ARRAY['mtm_agents','mtm_teams','users','mtm_settings','mtm_work_calendar_days','mtm_attendance_rules','workforce_employment_events','mtm_hrm_requests','mtm_agent_workdays','mtm_agent_workday_events','workforce_time_corrections'] LOOP
  EXECUTE format('CREATE TRIGGER mtm_month_source_fence BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION mtm_attendance_month_source_lock()',tab);
 END LOOP;
END $$;
-- Events are never appended into a frozen source day. A recorded event replay
-- does not insert and remains readable through the existing exact receipt path.
CREATE FUNCTION mtm_attendance_month_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('mtm-attendance-month-snapshot:'||NEW."organizationId",0));
 IF EXISTS(SELECT 1 FROM mtm_attendance_month_days closed JOIN mtm_agent_workdays day
   ON day."organizationId"=closed."organizationId" AND day."agentId"=closed."agentId" AND day."workDate"=closed."sourceDate"
   WHERE day.id=NEW."workdayId" AND closed."organizationId"=NEW."organizationId" AND closed."agentId"=NEW."agentId") THEN
  RAISE EXCEPTION 'MTM_ATTENDANCE_MONTH_CLOSED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mtm_month_event_guard BEFORE INSERT ON mtm_agent_workday_events FOR EACH ROW EXECUTE FUNCTION mtm_attendance_month_event_guard();
-- A missing-day correction inserts the canonical completed row before its
-- correction ledger; validate at commit, when both sides are present.
CREATE FUNCTION mtm_attendance_month_fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM mtm_attendance_month_days WHERE "organizationId"=NEW."organizationId" AND "agentId"=NEW."agentId" AND "sourceDate"=NEW."workDate") THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'updatedAt')=(to_jsonb(OLD)-'updatedAt') THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM workforce_time_corrections correction WHERE correction."organizationId"=NEW."organizationId" AND correction."agentId"=NEW."agentId" AND correction."workdayId"=NEW.id
  AND correction.xmin=(pg_current_xact_id()::text)::xid
  AND workforce_workday_fact_matches(correction."afterFacts",NEW)
  AND CASE WHEN TG_OP='INSERT' THEN correction."beforeFacts"->>'kind'='MISSING' AND correction."beforeFacts"->>'workDate'=to_char(NEW."workDate",'YYYY-MM-DD')
    ELSE workforce_workday_fact_matches(correction."beforeFacts",OLD) END) THEN
  RAISE EXCEPTION 'MTM_ATTENDANCE_MONTH_CLOSED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER mtm_month_fact_guard AFTER INSERT OR UPDATE ON mtm_agent_workdays DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mtm_attendance_month_fact_guard();

CREATE FUNCTION mtm_attendance_month_member_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE header RECORD;
BEGIN
 SELECT month,payload INTO header FROM mtm_attendance_month_closes WHERE "organizationId"=NEW."organizationId" AND id=NEW."closeId";
 IF header.month IS NULL OR NOT(header.payload->'agentIds' ? NEW."agentId") THEN RAISE EXCEPTION 'MTM_ATTENDANCE_MONTH_MEMBER_INVALID' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='mtm_attendance_month_members' THEN
  IF NEW.month<>header.month THEN RAISE EXCEPTION 'MTM_ATTENDANCE_MONTH_MEMBER_INVALID' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(header.payload->'coverage') covered WHERE covered->>'agentId'=NEW."agentId" AND covered->>'sourceDate'=to_char(NEW."sourceDate",'YYYY-MM-DD')) THEN RAISE EXCEPTION 'MTM_ATTENDANCE_MONTH_MEMBER_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mtm_month_member_guard BEFORE INSERT ON mtm_attendance_month_members FOR EACH ROW EXECUTE FUNCTION mtm_attendance_month_member_guard();
CREATE TRIGGER mtm_month_day_guard BEFORE INSERT ON mtm_attendance_month_days FOR EACH ROW EXECUTE FUNCTION mtm_attendance_month_member_guard();
CREATE FUNCTION mtm_attendance_month_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT count(*) FROM mtm_attendance_month_members WHERE "organizationId"=NEW."organizationId" AND "closeId"=NEW.id)<>jsonb_array_length(NEW.payload->'agentIds')
 OR (SELECT count(*) FROM mtm_attendance_month_days WHERE "organizationId"=NEW."organizationId" AND "closeId"=NEW.id)<>(SELECT count(DISTINCT (day->>'agentId',day->>'sourceDate')) FROM jsonb_array_elements(NEW.payload->'coverage') day) THEN
  RAISE EXCEPTION 'MTM_ATTENDANCE_MONTH_MEMBERS_INCOMPLETE' USING ERRCODE='23514';
 END IF; RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER mtm_month_complete_guard AFTER INSERT ON mtm_attendance_month_closes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mtm_attendance_month_complete_guard();
