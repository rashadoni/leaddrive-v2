BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL app.rls_bypass = 'on';

ALTER TABLE "mtm_agents" ADD COLUMN "attendanceExcluded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "mtm_agents" ADD COLUMN "attendanceIncludedFrom" TIMESTAMP(3);

CREATE TABLE "mtm_attendance_participation_events" (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  "agentId" TEXT NOT NULL,
  included BOOLEAN NOT NULL,
  "previousEventId" TEXT,
  "requestId" TEXT NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  "createdBy" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  FOREIGN KEY ("organizationId", "agentId") REFERENCES mtm_agents("organizationId", id) ON DELETE RESTRICT,
  FOREIGN KEY ("organizationId", "createdBy") REFERENCES users("organizationId", id) ON DELETE RESTRICT,
  UNIQUE ("organizationId", id), UNIQUE ("organizationId", "agentId", id),
  UNIQUE ("organizationId", "requestId"),
  FOREIGN KEY ("organizationId", "agentId", "previousEventId") REFERENCES "mtm_attendance_participation_events"("organizationId", "agentId", id) ON DELETE RESTRICT
);
CREATE INDEX mtm_attendance_participation_employee_date ON "mtm_attendance_participation_events"("organizationId", "agentId", "effectiveAt", id);
ALTER TABLE "mtm_attendance_participation_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_participation_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "mtm_attendance_participation_events" FOR SELECT USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY tenant_insert ON "mtm_attendance_participation_events" FOR INSERT WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

-- All entry points share a tenant lock and read the switch AFTER taking it.
-- No SECURITY DEFINER or RLS bypass: the caller's existing tenant scope applies.
CREATE FUNCTION mtm_attendance_provision_user(org TEXT, uid TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE principal RECORD; card RECORD; card_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('mtm-attendance-participation:' || org, 0));
  IF NOT EXISTS (SELECT 1 FROM mtm_settings WHERE "organizationId" = org AND key = 'attendanceEnabled' AND value = 'true'::jsonb) THEN RETURN; END IF;
  SELECT id, name, email INTO principal FROM users WHERE "organizationId" = org AND id = uid AND "isActive" AND "anonymizedAt" IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*) INTO card_count FROM mtm_agents WHERE "organizationId" = org AND "userId" = uid;
  IF card_count > 1 THEN RAISE EXCEPTION 'MTM_ATTENDANCE_EMPLOYEE_IDENTITY_CONFLICT' USING ERRCODE = '23514'; END IF;
  IF card_count = 1 THEN
    SELECT * INTO card FROM mtm_agents WHERE "organizationId" = org AND "userId" = uid;
    -- Old field/manual participants retain their historical baseline. An
    -- inactive card stays inactive; this is not a mobile-account activation.
    IF NOT card."attendanceParticipant" AND card.role <> 'AGENT' THEN
      UPDATE mtm_agents SET "attendanceParticipant" = true,
        "attendanceIncludedFrom" = COALESCE(card."attendanceIncludedFrom", (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)),
        "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
      WHERE "organizationId" = org AND id = card.id;
    END IF;
    RETURN;
  END IF;
  -- A matching email is not proof of identity. Never steal or relink a card.
  IF EXISTS (SELECT 1 FROM mtm_agents WHERE "organizationId" = org AND lower(email) = lower(principal.email)) THEN
    RAISE EXCEPTION 'MTM_ATTENDANCE_EMPLOYEE_IDENTITY_CONFLICT' USING ERRCODE = '23514';
  END IF;
  INSERT INTO mtm_agents (id, "organizationId", "userId", name, email, role, status,
    "attendanceParticipant", "attendanceIncludedFrom", "canPlanOwnRoutes", "canSelfPublishRoutes", "updatedAt")
  VALUES (gen_random_uuid()::text, org, uid, principal.name, principal.email, 'EMPLOYEE', 'ACTIVE',
    true, (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3), false, false, (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3));
END $$;

CREATE FUNCTION mtm_attendance_provision_user_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM mtm_attendance_provision_user(NEW."organizationId", NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER mtm_attendance_provision_user AFTER INSERT OR UPDATE OF "isActive", "anonymizedAt", "organizationId" ON users
  FOR EACH ROW EXECUTE FUNCTION mtm_attendance_provision_user_trigger();

CREATE FUNCTION mtm_attendance_provision_setting_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE principal RECORD;
BEGIN
  IF NEW.key <> 'attendanceEnabled' OR NEW.value <> 'true'::jsonb THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('mtm-attendance-participation:' || NEW."organizationId", 0));
  -- Do not lock user rows here: a concurrent lifecycle write holds its user
  -- row before entering its trigger, and will reconcile after this lock.
  FOR principal IN SELECT id FROM users WHERE "organizationId" = NEW."organizationId" AND "isActive" AND "anonymizedAt" IS NULL ORDER BY id LOOP
    PERFORM mtm_attendance_provision_user(NEW."organizationId", principal.id);
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER mtm_attendance_provision_setting AFTER INSERT OR UPDATE OF value ON mtm_settings
  FOR EACH ROW EXECUTE FUNCTION mtm_attendance_provision_setting_trigger();

CREATE FUNCTION mtm_attendance_agent_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."userId" IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('mtm-attendance-participation:' || NEW."organizationId", 0));
  IF EXISTS (SELECT 1 FROM mtm_settings WHERE "organizationId" = NEW."organizationId" AND key = 'attendanceEnabled' AND value = 'true'::jsonb)
    AND EXISTS (SELECT 1 FROM mtm_agents WHERE "organizationId" = NEW."organizationId" AND "userId" = NEW."userId" AND id <> NEW.id) THEN
    RAISE EXCEPTION 'MTM_ATTENDANCE_EMPLOYEE_IDENTITY_CONFLICT' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mtm_attendance_agent_identity BEFORE INSERT OR UPDATE OF "userId", "organizationId" ON mtm_agents
  FOR EACH ROW EXECUTE FUNCTION mtm_attendance_agent_identity_guard();

-- An active CRM user cannot disappear from automatic attendance through an
-- unrelated card delete/unlink. Exclusion is the explicit attendance control.
CREATE FUNCTION mtm_attendance_active_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."userId" IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."userId" IS NOT DISTINCT FROM OLD."userId" AND NEW."organizationId" = OLD."organizationId" THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('mtm-attendance-participation:' || OLD."organizationId", 0));
  IF EXISTS (SELECT 1 FROM organizations WHERE id = OLD."organizationId")
    AND EXISTS (SELECT 1 FROM mtm_settings WHERE "organizationId" = OLD."organizationId" AND key = 'attendanceEnabled' AND value = 'true'::jsonb)
    AND EXISTS (SELECT 1 FROM users WHERE "organizationId" = OLD."organizationId" AND id = OLD."userId" AND "isActive" AND "anonymizedAt" IS NULL) THEN
    RAISE EXCEPTION 'MTM_ATTENDANCE_EMPLOYEE_LINK_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER mtm_attendance_active_link BEFORE DELETE OR UPDATE OF "userId", "organizationId" ON mtm_agents
  FOR EACH ROW EXECUTE FUNCTION mtm_attendance_active_link_guard();

CREATE FUNCTION mtm_attendance_participation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE predecessor RECORD; excluded BOOLEAN;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD."organizationId") THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'MTM_ATTENDANCE_PARTICIPATION_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  -- Match API/month-close canonical order. Never take the lifecycle tenant
  -- advisory here: a user insert can hold the month fence while waiting on it.
  PERFORM pg_advisory_xact_lock(hashtextextended('mtm-attendance-participation-request:' || NEW."organizationId" || ':' || NEW."requestId", 0));
  PERFORM pg_advisory_xact_lock(hashtext('mtm-workday:' || NEW."organizationId" || ':' || NEW."agentId"));
  PERFORM pg_advisory_xact_lock(hashtextextended('mtm-attendance-requests:' || NEW."organizationId" || ':' || NEW."agentId", 0));
  IF NOT EXISTS (SELECT 1 FROM users WHERE "organizationId" = NEW."organizationId" AND id = NEW."createdBy" AND "isActive" AND "anonymizedAt" IS NULL AND role IN ('admin', 'superadmin'))
    OR NOT EXISTS (SELECT 1 FROM mtm_settings WHERE "organizationId" = NEW."organizationId" AND key = 'attendanceEnabled' AND value = 'true'::jsonb) THEN
    RAISE EXCEPTION 'MTM_ATTENDANCE_PARTICIPATION_FORBIDDEN' USING ERRCODE = '23514';
  END IF;
  SELECT "attendanceExcluded" INTO excluded FROM mtm_agents WHERE "organizationId" = NEW."organizationId" AND id = NEW."agentId" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MTM_ATTENDANCE_EMPLOYEE_NOT_FOUND' USING ERRCODE = '23514'; END IF;
  SELECT id, "effectiveAt" INTO predecessor FROM mtm_attendance_participation_events WHERE "organizationId" = NEW."organizationId" AND "agentId" = NEW."agentId" ORDER BY "effectiveAt" DESC, id DESC LIMIT 1;
  IF NEW."previousEventId" IS DISTINCT FROM predecessor.id OR NEW.included = (NOT excluded) THEN
    RAISE EXCEPTION 'MTM_ATTENDANCE_PARTICIPATION_CHANGED' USING ERRCODE = '23514';
  END IF;
  NEW."effectiveAt" := GREATEST((clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3), predecessor."effectiveAt" + interval '1 millisecond');
  UPDATE mtm_agents SET "attendanceExcluded" = NOT NEW.included, "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
    WHERE "organizationId" = NEW."organizationId" AND id = NEW."agentId";
  RETURN NEW;
END $$;
CREATE TRIGGER mtm_attendance_participation_history BEFORE INSERT OR UPDATE OR DELETE ON "mtm_attendance_participation_events"
  FOR EACH ROW EXECUTE FUNCTION mtm_attendance_participation_guard();
CREATE TRIGGER mtm_month_source_fence BEFORE INSERT OR UPDATE OR DELETE ON "mtm_attendance_participation_events"
  FOR EACH ROW EXECUTE FUNCTION mtm_attendance_month_source_lock();

CREATE FUNCTION mtm_attendance_exclusion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW."attendanceExcluded" THEN RETURN NEW; END IF;
  ELSIF NEW."attendanceExcluded" IS NOT DISTINCT FROM OLD."attendanceExcluded" THEN RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM mtm_attendance_participation_events WHERE "organizationId" = NEW."organizationId" AND "agentId" = NEW.id
    AND included = (NOT NEW."attendanceExcluded") AND xmin::text::bigint = mod(pg_current_xact_id()::text::numeric, 4294967296)::bigint) THEN
    RAISE EXCEPTION 'MTM_ATTENDANCE_PARTICIPATION_HISTORY_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER mtm_attendance_exclusion_history AFTER INSERT OR UPDATE ON mtm_agents DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION mtm_attendance_exclusion_guard();

-- Apply the exact same rule to organizations already enabled. An identity
-- conflict aborts visibly; no partial enrollment or invented HIRE is written.
DO $$ DECLARE principal RECORD; BEGIN
  FOR principal IN SELECT u."organizationId", u.id FROM users u JOIN mtm_settings s ON s."organizationId" = u."organizationId"
    AND s.key = 'attendanceEnabled' AND s.value = 'true'::jsonb
    WHERE u."isActive" AND u."anonymizedAt" IS NULL ORDER BY u."organizationId", u.id LOOP
    PERFORM mtm_attendance_provision_user(principal."organizationId", principal.id);
  END LOOP;
END $$;
COMMIT;
