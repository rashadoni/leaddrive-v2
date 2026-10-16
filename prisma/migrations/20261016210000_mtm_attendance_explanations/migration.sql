-- Personnel → explanations (owner, 2026-10-16): HR asks an employee who was
-- late or absent without a recorded reason to explain; the employee answers
-- from the app or writes on their own; HR accepts or does not. One row per
-- person, date and kind; hours are never changed by it.
SET lock_timeout='3s';
CREATE TABLE mtm_attendance_explanations (
 id TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "agentId" TEXT NOT NULL,
 "workDate" DATE NOT NULL,
 kind VARCHAR(10) NOT NULL CHECK(kind IN ('LATE','ABSENT')),
 status VARCHAR(10) NOT NULL CHECK(status IN ('REQUESTED','ANSWERED','ACCEPTED','REJECTED')),
 "lateMinutes" INTEGER CHECK("lateMinutes" IS NULL OR "lateMinutes" > 0),
 "requestedByUserId" TEXT,
 "requestedAt" TIMESTAMP(3),
 answer VARCHAR(1000),
 "answeredAt" TIMESTAMP(3),
 "decidedByUserId" TEXT,
 "decidedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("organizationId","agentId") REFERENCES mtm_agents("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","requestedByUserId") REFERENCES users("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","decidedByUserId") REFERENCES users("organizationId",id) ON DELETE RESTRICT,
 CHECK(("requestedByUserId" IS NULL) = ("requestedAt" IS NULL)),
 CHECK((answer IS NULL) = ("answeredAt" IS NULL)),
 CHECK(("decidedByUserId" IS NULL) = ("decidedAt" IS NULL)),
 CHECK(answer IS NULL OR length(btrim(answer)) >= 3),
 CHECK((kind = 'LATE') = ("lateMinutes" IS NOT NULL)),
 CHECK((status = 'REQUESTED' AND "requestedAt" IS NOT NULL AND answer IS NULL AND "decidedAt" IS NULL)
   OR (status = 'ANSWERED' AND answer IS NOT NULL AND "decidedAt" IS NULL)
   OR (status IN ('ACCEPTED','REJECTED') AND answer IS NOT NULL AND "decidedAt" IS NOT NULL)),
 CONSTRAINT mtm_attendance_explanation_once UNIQUE("organizationId","agentId","workDate",kind)
);
CREATE INDEX mtm_attendance_explanation_date ON mtm_attendance_explanations("organizationId","workDate");
-- A decided explanation is final; nothing is ever deleted except with the tenant.
CREATE FUNCTION mtm_attendance_explanation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM organizations WHERE id=OLD."organizationId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'MTM_ATTENDANCE_EXPLANATION_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (OLD.status IN ('ACCEPTED','REJECTED') OR NEW."organizationId"<>OLD."organizationId" OR NEW."agentId"<>OLD."agentId"
   OR NEW."workDate"<>OLD."workDate" OR NEW.kind<>OLD.kind OR NEW."requestedByUserId" IS DISTINCT FROM OLD."requestedByUserId"
   OR NEW."requestedAt" IS DISTINCT FROM OLD."requestedAt") THEN
  RAISE EXCEPTION 'MTM_ATTENDANCE_EXPLANATION_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 NEW."updatedAt":=clock_timestamp();
 IF TG_OP='INSERT' THEN NEW."createdAt":=NEW."updatedAt"; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mtm_attendance_explanation_guard BEFORE INSERT OR UPDATE OR DELETE ON mtm_attendance_explanations FOR EACH ROW EXECUTE FUNCTION mtm_attendance_explanation_guard();
ALTER TABLE "mtm_attendance_explanations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_explanations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mtm_attendance_explanations USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on')
 WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
