-- Additive MTM evidence, independent of withdrawn Workforce trust tables.
SET lock_timeout='3s';
CREATE TABLE mtm_attendance_location_policies (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version>0), "previousId" TEXT, "requestId" TEXT NOT NULL,
 "requestHash" VARCHAR(64) NOT NULL CHECK("requestHash" ~ '^[a-f0-9]{64}$'),
 enabled BOOLEAN NOT NULL, texts JSONB NOT NULL,
 "legalReviewConfirmed" BOOLEAN NOT NULL, "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("organizationId","createdBy") REFERENCES users("organizationId",id) ON DELETE RESTRICT,
 UNIQUE("organizationId",id), UNIQUE("organizationId",version), UNIQUE("organizationId","requestId"),
 CHECK(jsonb_typeof(texts)='object' AND texts ?& ARRAY['az','ru','en'] AND jsonb_typeof(texts->'az')='string' AND jsonb_typeof(texts->'ru')='string' AND jsonb_typeof(texts->'en')='string'),
 CHECK(NOT enabled OR ("legalReviewConfirmed" AND length(btrim(texts->>'az'))>=20 AND length(btrim(texts->>'ru'))>=20 AND length(btrim(texts->>'en'))>=20))
);
CREATE TABLE mtm_attendance_location_consents (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "agentId" TEXT NOT NULL, "policyRevisionId" TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0), "previousId" TEXT, "requestId" TEXT NOT NULL,
 "requestHash" VARCHAR(64) NOT NULL CHECK("requestHash" ~ '^[a-f0-9]{64}$'), accepted BOOLEAN NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("organizationId","agentId") REFERENCES mtm_agents("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","policyRevisionId") REFERENCES mtm_attendance_location_policies("organizationId",id) ON DELETE RESTRICT,
 UNIQUE("organizationId",id), UNIQUE("organizationId","agentId",version), UNIQUE("organizationId","agentId","requestId")
);
CREATE TABLE mtm_attendance_mark_evidence (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "agentId" TEXT NOT NULL, "eventId" TEXT NOT NULL,
 "redactedRequestHash" VARCHAR(64) NOT NULL CHECK("redactedRequestHash" ~ '^[a-f0-9]{64}$'),
 "installationId" VARCHAR(128) NOT NULL CHECK("installationId" ~ '^rf-[a-z0-9-]{20,125}$'),
 action VARCHAR(6) NOT NULL CHECK(action IN ('START','FINISH')),
 "claimedAt" TIMESTAMP(3) NOT NULL, "serverReceivedAt" TIMESTAMP(3) NOT NULL,
 "locationState" VARCHAR(20) NOT NULL CHECK("locationState" IN ('INSIDE','OUTSIDE','UNCERTAIN','UNCONFIGURED','UNAVAILABLE','NO_CONSENT','BREAK_PRIVACY')),
 latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, accuracy DOUBLE PRECISION,
 "fixCapturedAt" TIMESTAMP(3), "fixAgeSeconds" INTEGER, provider VARCHAR(10), "isMock" BOOLEAN,
 "consentId" TEXT, "branchRevisionId" TEXT, "primaryBranchId" TEXT, "distanceMeters" INTEGER,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("organizationId","agentId") REFERENCES mtm_agents("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","eventId") REFERENCES mtm_agent_workday_events("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","consentId") REFERENCES mtm_attendance_location_consents("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","branchRevisionId") REFERENCES mtm_attendance_branch_revisions("organizationId",id) ON DELETE RESTRICT,
 UNIQUE("organizationId","eventId"),
 CHECK(("locationState" IN ('UNAVAILABLE','NO_CONSENT','BREAK_PRIVACY') AND latitude IS NULL AND longitude IS NULL AND accuracy IS NULL AND "fixCapturedAt" IS NULL AND "fixAgeSeconds" IS NULL AND provider IS NULL AND "isMock" IS NULL AND "branchRevisionId" IS NULL AND "distanceMeters" IS NULL AND "consentId" IS NULL)
   OR ("locationState" IN ('INSIDE','OUTSIDE','UNCERTAIN','UNCONFIGURED') AND latitude IS NOT NULL AND longitude IS NOT NULL AND accuracy IS NOT NULL AND "fixCapturedAt" IS NOT NULL AND "fixAgeSeconds" IS NOT NULL AND provider IS NOT NULL AND "isMock" IS NOT NULL AND "consentId" IS NOT NULL)),
 CHECK(latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 AND accuracy BETWEEN 0 AND 100000),
 CHECK(provider IN ('FUSED','GPS','NETWORK','PASSIVE','UNKNOWN')),
 CHECK(("branchRevisionId" IS NULL)=("distanceMeters" IS NULL)), CHECK("distanceMeters">=0)
);
CREATE INDEX ON mtm_attendance_mark_evidence("organizationId","installationId","claimedAt");
CREATE INDEX ON mtm_attendance_mark_evidence("organizationId","agentId","claimedAt");
ALTER TABLE "mtm_attendance_location_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_location_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_attendance_location_policies" USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on') WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
ALTER TABLE "mtm_attendance_location_consents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_location_consents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_attendance_location_consents" USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on') WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
ALTER TABLE "mtm_attendance_mark_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_mark_evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mtm_attendance_mark_evidence" USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on') WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE FUNCTION mtm_attendance_location_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE predecessor RECORD; current_policy RECORD; canonical_event RECORD; consent RECORD;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organizations WHERE id=OLD."organizationId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'MTM_ATTENDANCE_LOCATION_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='mtm_attendance_location_policies' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('mtm-attendance-location:'||NEW."organizationId",0));
  SELECT id,version,"createdAt" INTO predecessor FROM mtm_attendance_location_policies WHERE "organizationId"=NEW."organizationId" ORDER BY version DESC LIMIT 1;
 ELSIF TG_TABLE_NAME='mtm_attendance_location_consents' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('mtm-attendance-requests:'||NEW."organizationId"||':'||NEW."agentId",0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('mtm-attendance-location:'||NEW."organizationId",0));
  SELECT id,enabled INTO current_policy FROM mtm_attendance_location_policies WHERE "organizationId"=NEW."organizationId" ORDER BY version DESC LIMIT 1;
  IF NEW.accepted AND (current_policy.id IS DISTINCT FROM NEW."policyRevisionId" OR NOT COALESCE(current_policy.enabled,false)) THEN
   RAISE EXCEPTION 'MTM_ATTENDANCE_LOCATION_POLICY_CHANGED' USING ERRCODE='23514';
  END IF;
  SELECT id,version,"createdAt" INTO predecessor FROM mtm_attendance_location_consents WHERE "organizationId"=NEW."organizationId" AND "agentId"=NEW."agentId" ORDER BY version DESC LIMIT 1;
 ELSE
  SELECT * INTO canonical_event FROM mtm_agent_workday_events WHERE "organizationId"=NEW."organizationId" AND id=NEW."eventId";
  IF canonical_event.id IS NULL OR canonical_event."agentId"<>NEW."agentId" OR canonical_event.type::text<>NEW.action OR canonical_event."occurredAt"<>NEW."claimedAt" OR canonical_event."serverReceivedAt" IS DISTINCT FROM NEW."serverReceivedAt" THEN
   RAISE EXCEPTION 'MTM_ATTENDANCE_MARK_EVENT_MISMATCH' USING ERRCODE='23514';
  END IF;
  IF NEW.latitude IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('mtm-attendance-requests:'||NEW."organizationId"||':'||NEW."agentId",0));
   PERFORM pg_advisory_xact_lock_shared(hashtextextended('mtm-attendance-location:'||NEW."organizationId",0));
   SELECT * INTO consent FROM mtm_attendance_location_consents WHERE "organizationId"=NEW."organizationId" AND "agentId"=NEW."agentId" ORDER BY version DESC LIMIT 1;
   SELECT id,enabled INTO current_policy FROM mtm_attendance_location_policies WHERE "organizationId"=NEW."organizationId" ORDER BY version DESC LIMIT 1;
   IF NEW."fixCapturedAt"<consent."createdAt" OR consent.id IS DISTINCT FROM NEW."consentId" OR NOT COALESCE(consent.accepted,false) OR consent."policyRevisionId" IS DISTINCT FROM current_policy.id OR NOT COALESCE(current_policy.enabled,false) THEN
    RAISE EXCEPTION 'MTM_ATTENDANCE_LOCATION_CONSENT_REQUIRED' USING ERRCODE='23514';
   END IF;
   -- Capture-time privacy is resolved by the shared workday-pauses.ts reader
   -- in the transaction. Do not introduce a second SQL event interpreter.
  END IF;
  NEW."createdAt":=clock_timestamp(); RETURN NEW;
 END IF;
 IF NEW.version<>COALESCE(predecessor.version,0)+1 OR NEW."previousId" IS DISTINCT FROM predecessor.id THEN
  RAISE EXCEPTION 'MTM_ATTENDANCE_LOCATION_HISTORY_CHANGED' USING ERRCODE='23514';
 END IF;
 NEW."createdAt":=GREATEST(clock_timestamp()::timestamp(3),predecessor."createdAt"+interval '1 millisecond');
 RETURN NEW;
END $$;
CREATE TRIGGER mtm_attendance_location_policies_guard BEFORE INSERT OR UPDATE OR DELETE ON mtm_attendance_location_policies FOR EACH ROW EXECUTE FUNCTION mtm_attendance_location_history_guard();
CREATE TRIGGER mtm_attendance_location_consents_guard BEFORE INSERT OR UPDATE OR DELETE ON mtm_attendance_location_consents FOR EACH ROW EXECUTE FUNCTION mtm_attendance_location_history_guard();
CREATE TRIGGER mtm_attendance_mark_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON mtm_attendance_mark_evidence FOR EACH ROW EXECUTE FUNCTION mtm_attendance_location_history_guard();
