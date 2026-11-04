-- Kinds of a break (owner, 2026-11-04): the kind the employee chose for one PAUSE,
-- with a copy of the kind's name and limit at that moment. Never a place.
SET lock_timeout='3s';
CREATE TABLE mtm_attendance_break_labels (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "agentId" TEXT NOT NULL, "eventId" TEXT NOT NULL,
 "kindId" VARCHAR(40) NOT NULL CHECK ("kindId" ~ '^[a-z0-9-]{1,40}$'),
 "kindName" VARCHAR(40) CHECK ("kindName" IS NULL OR length(btrim("kindName")) > 0),
 "limitMinutes" INTEGER CHECK ("limitMinutes" IS NULL OR "limitMinutes" BETWEEN 1 AND 720),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("organizationId","agentId") REFERENCES mtm_agents("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","eventId") REFERENCES mtm_agent_workday_events("organizationId",id) ON DELETE RESTRICT,
 UNIQUE("organizationId","eventId")
);
CREATE INDEX ON mtm_attendance_break_labels("organizationId","agentId","createdAt");
CREATE FUNCTION mtm_attendance_break_label_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organizations WHERE id=OLD."organizationId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'MTM_ATTENDANCE_BREAK_LABEL_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM mtm_agent_workday_events e WHERE e."organizationId"=NEW."organizationId" AND e.id=NEW."eventId" AND e."agentId"=NEW."agentId" AND e.type::text='PAUSE') THEN
  RAISE EXCEPTION 'MTM_ATTENDANCE_BREAK_LABEL_EVENT_MISMATCH' USING ERRCODE='23514';
 END IF;
 NEW."createdAt":=clock_timestamp(); RETURN NEW;
END $$;
ALTER TABLE "mtm_attendance_break_labels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_break_labels" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "mtm_attendance_break_labels" FOR SELECT USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE POLICY tenant_insert ON "mtm_attendance_break_labels" FOR INSERT WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE TRIGGER mtm_attendance_break_label_guard BEFORE INSERT OR UPDATE OR DELETE ON "mtm_attendance_break_labels" FOR EACH ROW EXECUTE FUNCTION mtm_attendance_break_label_guard();
