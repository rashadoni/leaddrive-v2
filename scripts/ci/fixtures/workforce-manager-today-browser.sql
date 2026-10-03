-- Prepared disposable GitHub-hosted PostgreSQL16 fixture only; NOT EXECUTED.
-- Apply once AFTER current candidate Prisma db push and BEFORE admin seeding.
-- psql -v app_password=<ephemeral masked value>; never log/commit the value.
-- No seed rows, production target, business-write grant or runtime bypass role.
-- Credential provider src/lib/auth.ts writes only users.lastLogin/loginCount
-- in this non-2FA fixture; Prisma also stamps updatedAt. JWT sessions are real.
-- Dashboard shell performs reads; no user preference/OTP write is admitted.
-- SELECT ALL supports real Auth.js/dashboard reads. The sole UPDATE grant is
-- the three user login metadata columns; Workforce facts remain SELECT ONLY.
-- organizations is intentionally not RLS: tenant-slug credentials lookup is
-- a real pre-tenant lookup in auth.ts; force-RLS users stays tenant scoped.
-- CHECKs/indexes/functions below are copied from the named production
-- migrations; current Prisma db push already supplies types and tenant FKs.
-- This is not a full migration replay. NOT restored: automatic directory
-- membership capture (explicit past fixture history is seeded by admin),
-- policy/shift/workday-schedule snapshot INSERT validation and snapshot
-- immutability, default-timeline write guards, exception decision revision
-- allocation/terminal lifecycle, responses/notifications/correction triggers.
-- Those tables remain empty/read-only; no snapshot/decision write acceptance.
-- All signatures/hash contents still require actual application helpers and
-- hosted receipt assertions; format CHECKs do not prove a correct digest.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $$
BEGIN
  IF current_database() <> 'workforce_manager_today_browser' THEN
    RAISE EXCEPTION 'Today fixture requires its isolated disposable database';
  END IF;
END $$;
CREATE ROLE wf_manager_today_browser LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
GRANT CONNECT ON DATABASE workforce_manager_today_browser TO wf_manager_today_browser;
GRANT USAGE ON SCHEMA public TO wf_manager_today_browser;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO wf_manager_today_browser;
GRANT UPDATE ("lastLogin", "loginCount", "updatedAt") ON public.users TO wf_manager_today_browser;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users','mtm_teams','mtm_agents','mtm_settings','mtm_work_calendar_days','workforce_employee_team_memberships','mtm_agent_workdays','mtm_agent_workday_events','workforce_access_grants','workforce_access_grant_revocations','workforce_shift_templates','workforce_shift_segments','workforce_shift_assignments','workforce_shift_default_assignments','workforce_shift_team_default_assignments','workforce_policy_snapshots','workforce_shift_snapshots','workforce_workday_schedule_snapshots','workforce_exception_cases','workforce_exception_decisions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY wf_manager_today_tenant ON public.%I '
      'USING ("organizationId" = current_setting(''app.org_id'', true) '
      'OR current_setting(''app.rls_bypass'', true) = ''on'') '
      'WITH CHECK ("organizationId" = current_setting(''app.org_id'', true) '
      'OR current_setting(''app.rls_bypass'', true) = ''on'')', table_name);
  END LOOP;
END $$;

-- Production CHECKs: 20260828223000
ALTER TABLE public."workforce_shift_templates" ADD CONSTRAINT "workforce_shift_templates_version_positive" CHECK ("version" > 0);
ALTER TABLE public."workforce_shift_templates" ADD CONSTRAINT "workforce_shift_templates_code_nonempty" CHECK (btrim("code") <> '');
ALTER TABLE public."workforce_shift_templates" ADD CONSTRAINT "workforce_shift_templates_name_nonempty" CHECK (btrim("name") <> '');
ALTER TABLE public."workforce_shift_templates" ADD CONSTRAINT "workforce_shift_templates_timezone_nonempty" CHECK (btrim("timezone") <> '');
ALTER TABLE public."workforce_shift_templates" ADD CONSTRAINT "workforce_shift_templates_definition_object" CHECK (jsonb_typeof("definition") = 'object');
ALTER TABLE public."workforce_shift_templates" ADD CONSTRAINT "workforce_shift_templates_hash_check" CHECK ("definitionHash" ~ '^[A-Fa-f0-9]{64}$');
ALTER TABLE public."workforce_shift_templates" ADD CONSTRAINT "workforce_shift_templates_retirement_check" CHECK ("status" <> 'RETIRED' OR "retiredAt" IS NOT NULL);
ALTER TABLE public."workforce_shift_templates" ADD CONSTRAINT "workforce_shift_templates_active_not_retired_check" CHECK ("status" <> 'ACTIVE' OR "retiredAt" IS NULL);
ALTER TABLE public."workforce_shift_templates" ADD CONSTRAINT "workforce_shift_templates_draft_lifecycle_check" CHECK (
    "status" <> 'DRAFT' OR ("activatedByUserId" IS NULL AND "activatedAt" IS NULL AND "retiredAt" IS NULL)
  );
ALTER TABLE public."workforce_shift_templates" ADD CONSTRAINT "workforce_shift_templates_lifecycle_time_check" CHECK (
    "retiredAt" IS NULL OR "activatedAt" IS NULL OR "retiredAt" >= "activatedAt"
  );

-- Production CHECKs: 20260829140000
ALTER TABLE public."workforce_shift_templates" ADD CONSTRAINT "workforce_shift_templates_provenance_actor_check" CHECK (
    ("provenance" = 'TENANT_ADMIN'
      AND "createdByUserId" IS NOT NULL
      AND "systemProfileVersion" IS NULL)
    OR
    ("provenance" = 'SYSTEM_PROVISIONING'
      AND "createdByUserId" IS NULL
      AND NULLIF(btrim("systemProfileVersion"), '') IS NOT NULL)
  );
ALTER TABLE public."workforce_shift_templates" ADD CONSTRAINT "workforce_shift_templates_activation_check" CHECK (
    ("provenance" = 'TENANT_ADMIN' AND (
      "status" = 'DRAFT' OR (
        "activatedAt" IS NOT NULL AND "activatedByUserId" IS NOT NULL
      )
    ))
    OR
    ("provenance" = 'SYSTEM_PROVISIONING'
      AND "status" IN ('ACTIVE', 'RETIRED')
      AND "activatedAt" IS NOT NULL
      AND "activatedByUserId" IS NULL)
  );

-- Production CHECKs: 20260828223000
ALTER TABLE public."workforce_shift_assignments" ADD CONSTRAINT "workforce_shift_assignments_effective_range_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

-- Production CHECKs: 20260828223000
ALTER TABLE public."workforce_policy_snapshots" ADD CONSTRAINT "workforce_policy_snapshots_definition_object" CHECK (jsonb_typeof("definition") = 'object');
ALTER TABLE public."workforce_policy_snapshots" ADD CONSTRAINT "workforce_policy_snapshots_hash_check" CHECK ("definitionHash" ~ '^[A-Fa-f0-9]{64}$');
ALTER TABLE public."workforce_policy_snapshots" ADD CONSTRAINT "workforce_policy_snapshots_duration_check" CHECK (
    "expectedWorkSeconds" >= 0
    AND "lateGraceSeconds" >= 0
    AND "undertimeToleranceSeconds" >= 0
    AND "overtimeThresholdSeconds" >= 0
    AND ("longPauseThresholdSeconds" IS NULL OR "longPauseThresholdSeconds" >= 0)
  );

-- Production CHECKs: 20260828223000
ALTER TABLE public."workforce_shift_snapshots" ADD CONSTRAINT "workforce_shift_snapshots_definition_object" CHECK (jsonb_typeof("definition") = 'object');
ALTER TABLE public."workforce_shift_snapshots" ADD CONSTRAINT "workforce_shift_snapshots_hash_check" CHECK ("definitionHash" ~ '^[A-Fa-f0-9]{64}$');
ALTER TABLE public."workforce_shift_snapshots" ADD CONSTRAINT "workforce_shift_snapshots_time_range_check" CHECK ("plannedEndAt" > "plannedStartAt");

-- Production CHECKs: 20260830060000
ALTER TABLE public."workforce_shift_segments" ADD CONSTRAINT "workforce_shift_segments_sequence_check" CHECK ("sequence" > 0);
ALTER TABLE public."workforce_shift_segments" ADD CONSTRAINT "workforce_shift_segments_time_format_check" CHECK (
    "startTime" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "endTime" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "endTime" > "startTime"
  );
ALTER TABLE public."workforce_shift_segments" ADD CONSTRAINT "workforce_shift_segments_grace_check" CHECK ("lateGraceSeconds" >= 0 AND "lateGraceSeconds" <= 7200);
ALTER TABLE public."workforce_shift_segments" ADD CONSTRAINT "workforce_shift_segments_site_mode_check" CHECK (
    ("mode" = 'SITE'::"WorkforceShiftSegmentMode" AND "siteId" IS NOT NULL)
    OR ("mode" <> 'SITE'::"WorkforceShiftSegmentMode" AND "siteId" IS NULL)
  );

-- Production CHECKs: 20260830193000
ALTER TABLE public."workforce_access_grants" ADD CONSTRAINT "workforce_access_grants_effective_window_check"
    CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom");
ALTER TABLE public."workforce_access_grants" ADD CONSTRAINT "workforce_access_grants_reason_check"
    CHECK (NULLIF(btrim("grantReasonCode"), '') IS NOT NULL);
ALTER TABLE public."workforce_access_grants" ADD CONSTRAINT "workforce_access_grants_exact_scope_check" CHECK (
    ("scopeKind" = 'ORGANIZATION' AND "scopeTeamId" IS NULL AND "scopeSiteId" IS NULL AND "scopeAgentId" IS NULL)
    OR ("scopeKind" = 'TEAM' AND "scopeTeamId" IS NOT NULL AND "scopeSiteId" IS NULL AND "scopeAgentId" IS NULL)
    OR ("scopeKind" = 'SITE' AND "scopeTeamId" IS NULL AND "scopeSiteId" IS NOT NULL AND "scopeAgentId" IS NULL)
    OR ("scopeKind" = 'AGENT' AND "scopeTeamId" IS NULL AND "scopeSiteId" IS NULL AND "scopeAgentId" IS NOT NULL)
  );
ALTER TABLE public."workforce_access_grants" ADD CONSTRAINT "workforce_access_grants_role_scope_check" CHECK (
    ("role" IN ('TENANT_ADMIN', 'RETENTION_HOLD_OFFICER', 'PILOT_ROLLBACK_OPERATOR') AND "scopeKind" = 'ORGANIZATION')
    OR ("role" IN ('HR_ADMIN', 'SCHEDULER') AND "scopeKind" IN ('ORGANIZATION', 'TEAM', 'SITE'))
    OR ("role" = 'TIME_APPROVER' AND "scopeKind" IN ('ORGANIZATION', 'TEAM', 'AGENT'))
    OR ("role" = 'EVIDENCE_REVIEWER' AND "scopeKind" IN ('ORGANIZATION', 'TEAM', 'SITE', 'AGENT'))
    OR ("role" = 'DEVICE_SECURITY_ADMIN' AND "scopeKind" IN ('ORGANIZATION', 'SITE'))
    OR ("role" = 'EXPORT_CUSTODIAN' AND "scopeKind" IN ('ORGANIZATION', 'TEAM', 'AGENT'))
    OR ("role" = 'TEAM_MANAGER' AND "scopeKind" IN ('TEAM', 'SITE'))
  );

-- Production CHECKs: 20260830193000
ALTER TABLE public."workforce_access_grant_revocations" ADD CONSTRAINT "workforce_access_grant_revocations_reason_check"
    CHECK (NULLIF(btrim("revocationReasonCode"), '') IS NOT NULL);

-- Production CHECKs: 20260830195000
ALTER TABLE public."workforce_access_grants" ADD CONSTRAINT "workforce_access_grants_operation_id_check"
    CHECK ("operationId" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$');
ALTER TABLE public."workforce_access_grants" ADD CONSTRAINT "workforce_access_grants_reason_format_check"
    CHECK ("grantReasonCode" ~ '^[A-Z][A-Z0-9_]{0,63}$');

-- Production CHECKs: 20260830195000
ALTER TABLE public."workforce_access_grant_revocations" ADD CONSTRAINT "workforce_access_grant_revocations_operation_id_check"
    CHECK ("operationId" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$');
ALTER TABLE public."workforce_access_grant_revocations" ADD CONSTRAINT "workforce_access_grant_revocations_reason_format_check"
    CHECK ("revocationReasonCode" ~ '^[A-Z][A-Z0-9_]{0,63}$');

-- Production CHECKs: 20260830170000
ALTER TABLE public."workforce_exception_cases" ADD CONSTRAINT "workforce_exception_cases_kind_check"
    CHECK (NULLIF(btrim("kind"), '') IS NOT NULL);
ALTER TABLE public."workforce_exception_cases" ADD CONSTRAINT "workforce_exception_cases_detector_version_check"
    CHECK (NULLIF(btrim("detectorVersion"), '') IS NOT NULL);
ALTER TABLE public."workforce_exception_cases" ADD CONSTRAINT "workforce_exception_cases_deduplication_key_check"
    CHECK ("deduplicationKey" ~ '^[0-9a-f]{64}$');
ALTER TABLE public."workforce_exception_cases" ADD CONSTRAINT "workforce_exception_cases_subject_check"
    CHECK ("workdayId" IS NOT NULL OR "workdayEventId" IS NOT NULL OR "segmentId" IS NOT NULL);

-- Production CHECKs: 20260901003000
ALTER TABLE public."workforce_exception_cases" ADD CONSTRAINT "workforce_exception_cases_expected_date_segment_check"
    CHECK (
      ("expectedWorkDate" IS NOT NULL) = (
        "kind" = 'NO_SHOW'
        AND "segmentId" IS NOT NULL
        AND "workdayId" IS NULL
        AND "workdayEventId" IS NULL
        AND "evidenceId" IS NULL
      )
    );

-- Production CHECKs: 20260830170000
ALTER TABLE public."workforce_exception_decisions" ADD CONSTRAINT "workforce_exception_decisions_operation_id_check"
    CHECK (NULLIF(btrim("operationId"), '') IS NOT NULL);
ALTER TABLE public."workforce_exception_decisions" ADD CONSTRAINT "workforce_exception_decisions_code_check"
    CHECK (NULLIF(btrim("decisionCode"), '') IS NOT NULL);
ALTER TABLE public."workforce_exception_decisions" ADD CONSTRAINT "workforce_exception_decisions_reason_check"
    CHECK (NULLIF(btrim("reason"), '') IS NOT NULL);

-- Production CHECKs: 20260927014000
ALTER TABLE public."workforce_exception_decisions" ADD CONSTRAINT "workforce_exception_decisions_case_revision_check"
    CHECK ("caseRevision" > 0);

-- Production calendar scope and partial uniqueness: 20260715160000
ALTER TABLE public."mtm_work_calendar_days" ADD CONSTRAINT "mtm_work_calendar_days_single_scope_check"
    CHECK (num_nonnulls("teamId", "agentId") <= 1);

-- Production partial index: 20260715160000
CREATE UNIQUE INDEX "mtm_work_calendar_days_active_org_scope_key"
  ON "mtm_work_calendar_days"("organizationId", "date")
  WHERE "teamId" IS NULL AND "agentId" IS NULL AND "deletedAt" IS NULL;

-- Production partial index: 20260715160000
CREATE UNIQUE INDEX "mtm_work_calendar_days_active_team_scope_key"
  ON "mtm_work_calendar_days"("organizationId", "date", "teamId")
  WHERE "teamId" IS NOT NULL AND "agentId" IS NULL AND "deletedAt" IS NULL;

-- Production partial index: 20260715160000
CREATE UNIQUE INDEX "mtm_work_calendar_days_active_agent_scope_key"
  ON "mtm_work_calendar_days"("organizationId", "date", "agentId")
  WHERE "agentId" IS NOT NULL AND "teamId" IS NULL AND "deletedAt" IS NULL;

-- Production partial index: 20260828223000
CREATE UNIQUE INDEX "workforce_shift_templates_one_active_org_code_key"
  ON "workforce_shift_templates"("organizationId", "code") WHERE "status" = 'ACTIVE' AND "teamId" IS NULL;

-- Production partial index: 20260828223000
CREATE UNIQUE INDEX "workforce_shift_templates_one_active_team_code_key"
  ON "workforce_shift_templates"("organizationId", "teamId", "code") WHERE "status" = 'ACTIVE' AND "teamId" IS NOT NULL;

-- Production partial index: 20260829020000
CREATE UNIQUE INDEX "workforce_shift_templates_one_active_org_default_key"
  ON "workforce_shift_templates"("organizationId")
  WHERE "isDefault" = true
    AND "status" = 'ACTIVE'
    AND "teamId" IS NULL;

-- Production partial index: 20260829020000
CREATE UNIQUE INDEX "workforce_shift_templates_one_active_team_default_key"
  ON "workforce_shift_templates"("organizationId", "teamId")
  WHERE "isDefault" = true
    AND "status" = 'ACTIVE'
    AND "teamId" IS NOT NULL;

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "workforce_shift_assignments"
  ADD CONSTRAINT "workforce_shift_assignments_no_overlap"
  EXCLUDE USING gist (
    "organizationId" WITH =,
    "agentId" WITH =,
    daterange("effectiveFrom", COALESCE("effectiveTo" + 1, 'infinity'::date), '[)') WITH &&
  );

-- Production trigger subset: 20260828223000
CREATE OR REPLACE FUNCTION workforce_guard_published_definition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_status TEXT := OLD."status"::text;
  new_status TEXT := NEW."status"::text;
  allowed_keys TEXT[];
BEGIN
  allowed_keys := CASE old_status
    WHEN 'ACTIVE' THEN ARRAY['status', 'retiredAt', 'updatedAt']
    WHEN 'RETIRED' THEN ARRAY['updatedAt']
    ELSE ARRAY[]::TEXT[]
  END;

  IF old_status <> 'DRAFT'
     AND (to_jsonb(NEW) - allowed_keys) IS DISTINCT FROM (to_jsonb(OLD) - allowed_keys) THEN
    RAISE EXCEPTION '% published definition content is immutable; create a new draft version', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  IF old_status = 'DRAFT' AND new_status NOT IN ('DRAFT', 'ACTIVE') THEN
    RAISE EXCEPTION 'invalid Workforce definition transition % -> %', old_status, new_status USING ERRCODE = '23514';
  ELSIF old_status = 'ACTIVE' AND new_status NOT IN ('ACTIVE', 'RETIRED') THEN
    RAISE EXCEPTION 'invalid Workforce definition transition % -> %', old_status, new_status USING ERRCODE = '23514';
  ELSIF old_status = 'RETIRED' AND new_status <> 'RETIRED' THEN
    RAISE EXCEPTION 'retired Workforce definition cannot transition to %', new_status USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION workforce_guard_published_definition_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION '% published definition cannot be deleted; retire it instead', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER workforce_shift_templates_published_definition_guard
  BEFORE UPDATE ON "workforce_shift_templates"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_published_definition();

CREATE TRIGGER workforce_shift_templates_published_definition_delete_guard
  BEFORE DELETE ON "workforce_shift_templates"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_published_definition_delete();

-- Production trigger subset: 20260829114500
CREATE OR REPLACE FUNCTION workforce_guard_shift_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  agent_team_id TEXT;
  template_team_id TEXT;
  template_status "WorkforceDefinitionStatus";
BEGIN
  SELECT "teamId" INTO agent_team_id
  FROM "mtm_agents"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."agentId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce shift assignment agent is missing' USING ERRCODE = '23514';
  END IF;

  SELECT "teamId", "status" INTO template_team_id, template_status
  FROM "workforce_shift_templates"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."templateId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce shift assignment template is missing' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND template_status <> 'ACTIVE'::"WorkforceDefinitionStatus" THEN
    RAISE EXCEPTION 'Workforce shift assignment template must be active' USING ERRCODE = '23514';
  END IF;
  IF template_team_id IS NOT NULL AND agent_team_id IS DISTINCT FROM template_team_id THEN
    RAISE EXCEPTION 'Workforce shift assignment template team must match its agent' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND EXISTS (
       SELECT 1
       FROM "workforce_shift_snapshots"
       WHERE "organizationId" = OLD."organizationId" AND "assignmentId" = OLD."id"
     ) THEN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."agentId" IS DISTINCT FROM OLD."agentId"
       OR NEW."templateId" IS DISTINCT FROM OLD."templateId"
       OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
       OR NEW."assignedByUserId" IS DISTINCT FROM OLD."assignedByUserId" THEN
      RAISE EXCEPTION 'Workforce shift assignment facts are immutable after a snapshot is created' USING ERRCODE = '55000';
    END IF;

    IF NEW."effectiveTo" IS DISTINCT FROM OLD."effectiveTo" THEN
      IF NEW."effectiveTo" IS NULL
         OR (OLD."effectiveTo" IS NOT NULL AND NEW."effectiveTo" > OLD."effectiveTo") THEN
        RAISE EXCEPTION 'A Workforce shift assignment effective window can only be narrowed' USING ERRCODE = '55000';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM "workforce_shift_snapshots"
        WHERE "organizationId" = OLD."organizationId"
          AND "assignmentId" = OLD."id"
          AND "workDate" > NEW."effectiveTo"
      ) THEN
        RAISE EXCEPTION 'A Workforce shift assignment effective window cannot exclude an existing snapshot' USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Production trigger subset: 20260828223000
CREATE TRIGGER workforce_shift_assignments_guard
  BEFORE INSERT OR UPDATE ON "workforce_shift_assignments"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_shift_assignment();

-- Production trigger subset: 20260830060000
CREATE OR REPLACE FUNCTION workforce_guard_shift_segment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status "WorkforceDefinitionStatus";
  parent_organization_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT "status", "organizationId" INTO parent_status, parent_organization_id
    FROM "workforce_shift_templates"
    WHERE "id" = OLD."templateId" AND "organizationId" = OLD."organizationId";
  ELSE
    SELECT "status", "organizationId" INTO parent_status, parent_organization_id
    FROM "workforce_shift_templates"
    WHERE "id" = NEW."templateId" AND "organizationId" = NEW."organizationId";
  END IF;

  IF parent_organization_id IS NULL THEN
    RAISE EXCEPTION 'Workforce shift segment requires an existing template' USING ERRCODE = '23503';
  END IF;
  IF parent_status IS DISTINCT FROM 'DRAFT'::"WorkforceDefinitionStatus" THEN
    RAISE EXCEPTION 'Published Workforce shift segments are immutable; create a new draft version' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION workforce_validate_shift_segment_order()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "workforce_shift_segments" AS other
    WHERE other."organizationId" = NEW."organizationId"
      AND other."templateId" = NEW."templateId"
      AND other."id" <> NEW."id"
      AND other."startTime" < NEW."endTime"
      AND NEW."startTime" < other."endTime"
  ) THEN
    RAISE EXCEPTION 'Workforce shift segments must not overlap' USING ERRCODE = '23P01';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "workforce_shift_segments" AS other
    WHERE other."organizationId" = NEW."organizationId"
      AND other."templateId" = NEW."templateId"
      AND other."id" <> NEW."id"
      AND (
        (other."sequence" < NEW."sequence" AND other."startTime" >= NEW."startTime")
        OR (other."sequence" > NEW."sequence" AND other."startTime" <= NEW."startTime")
      )
  ) THEN
    RAISE EXCEPTION 'Workforce shift segment sequence must match chronological order' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_shift_segments_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON "workforce_shift_segments"
  FOR EACH ROW EXECUTE FUNCTION workforce_guard_shift_segment_mutation();

CREATE TRIGGER workforce_shift_segments_validate_order
  BEFORE INSERT OR UPDATE ON "workforce_shift_segments"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_shift_segment_order();

-- Production trigger subset: 20260830193000
CREATE OR REPLACE FUNCTION workforce_validate_access_grant_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "workforce_access_grants" AS existing
    LEFT JOIN "workforce_access_grant_revocations" AS revocation
      ON revocation."organizationId" = existing."organizationId"
      AND revocation."grantId" = existing."id"
    WHERE existing."organizationId" = NEW."organizationId"
      AND existing."principalUserId" = NEW."principalUserId"
      AND existing."effectiveFrom" < COALESCE(NEW."effectiveUntil", 'infinity'::timestamp)
      AND NEW."effectiveFrom" < LEAST(
        COALESCE(existing."effectiveUntil", 'infinity'::timestamp),
        COALESCE(revocation."revokedAt", 'infinity'::timestamp)
      )
      AND (
        (existing."role" = 'SCHEDULER' AND NEW."role" = 'TIME_APPROVER')
        OR (existing."role" = 'TIME_APPROVER' AND NEW."role" = 'SCHEDULER')
        OR (existing."role" = 'TIME_APPROVER' AND NEW."role" = 'TEAM_MANAGER')
        OR (existing."role" = 'TEAM_MANAGER' AND NEW."role" = 'TIME_APPROVER')
        OR (existing."role" = 'EVIDENCE_REVIEWER' AND NEW."role" = 'DEVICE_SECURITY_ADMIN')
        OR (existing."role" = 'DEVICE_SECURITY_ADMIN' AND NEW."role" = 'EVIDENCE_REVIEWER')
        OR (existing."role" = 'EXPORT_CUSTODIAN' AND NEW."role" = 'RETENTION_HOLD_OFFICER')
        OR (existing."role" = 'RETENTION_HOLD_OFFICER' AND NEW."role" = 'EXPORT_CUSTODIAN')
      )
  ) THEN
    RAISE EXCEPTION 'Workforce access grant conflicts with an incompatible effective role' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION workforce_validate_access_grant_revocation_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  grant_effective_from TIMESTAMP(3);
BEGIN
  SELECT "effectiveFrom" INTO grant_effective_from
  FROM "workforce_access_grants"
  WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."grantId";
  IF NOT FOUND OR NEW."revokedAt" < grant_effective_from THEN
    RAISE EXCEPTION 'Workforce access grant revocation must be tenant-valid and not predate the grant' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION workforce_reject_access_grant_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce access grants are immutable; append a revocation and new grant' USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION workforce_reject_access_grant_revocation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce access grant revocations are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_access_grants_validate_insert
  BEFORE INSERT ON "workforce_access_grants"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_access_grant_insert();

CREATE TRIGGER workforce_access_grant_revocations_validate_insert
  BEFORE INSERT ON "workforce_access_grant_revocations"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_access_grant_revocation_insert();

CREATE TRIGGER workforce_access_grants_append_only
  BEFORE UPDATE OR DELETE ON "workforce_access_grants"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_access_grant_mutation();

CREATE TRIGGER workforce_access_grant_revocations_append_only
  BEFORE UPDATE OR DELETE ON "workforce_access_grant_revocations"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_access_grant_revocation_mutation();

-- Production trigger subset: 20260901003000
CREATE OR REPLACE FUNCTION workforce_validate_exception_case_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  linked_agent_id TEXT;
  linked_workday_id TEXT;
  evidence_agent_id TEXT;
  evidence_workday_id TEXT;
  subject_workday_id TEXT;
BEGIN
  IF NEW."workdayId" IS NOT NULL THEN
    SELECT "agentId" INTO linked_agent_id
    FROM "mtm_agent_workdays"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayId";
    IF NOT FOUND OR linked_agent_id <> NEW."agentId" THEN
      RAISE EXCEPTION 'Workforce exception case workday must belong to its tenant employee' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."workdayEventId" IS NOT NULL THEN
    SELECT "agentId", "workdayId" INTO linked_agent_id, linked_workday_id
    FROM "mtm_agent_workday_events"
    WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workdayEventId";
    IF NOT FOUND OR linked_agent_id <> NEW."agentId"
       OR (NEW."workdayId" IS NOT NULL AND linked_workday_id <> NEW."workdayId") THEN
      RAISE EXCEPTION 'Workforce exception case event must match its tenant employee/workday' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."evidenceId" IS NOT NULL THEN
    SELECT
      COALESCE(event."agentId", transition."agentId"),
      COALESCE(event."workdayId", transition."workdayId")
    INTO evidence_agent_id, evidence_workday_id
    FROM "workforce_attendance_evidence" AS evidence
    LEFT JOIN "mtm_agent_workday_events" AS event
      ON event."organizationId" = evidence."organizationId"
      AND event."id" = evidence."workdayEventId"
    LEFT JOIN "workforce_site_transitions" AS transition
      ON transition."organizationId" = evidence."organizationId"
      AND transition."id" = evidence."siteTransitionId"
    WHERE evidence."organizationId" = NEW."organizationId"
      AND evidence."id" = NEW."evidenceId";
    IF NOT FOUND OR evidence_agent_id <> NEW."agentId" THEN
      RAISE EXCEPTION 'Workforce exception case evidence must belong to its tenant employee' USING ERRCODE = '23514';
    END IF;
  END IF;

  subject_workday_id := COALESCE(NEW."workdayId", linked_workday_id, evidence_workday_id);
  IF NEW."workdayId" IS NOT NULL
     AND evidence_workday_id IS NOT NULL
     AND evidence_workday_id <> NEW."workdayId" THEN
    RAISE EXCEPTION 'Workforce exception case evidence must match its linked workday' USING ERRCODE = '23514';
  END IF;

  IF NEW."segmentId" IS NOT NULL AND subject_workday_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "workforce_workday_schedule_snapshots" AS snapshot
    CROSS JOIN LATERAL jsonb_array_elements(snapshot."segments"::jsonb) AS segment(value)
    WHERE snapshot."organizationId" = NEW."organizationId"
      AND snapshot."workdayId" = subject_workday_id
      AND segment.value ->> 'id' = NEW."segmentId"
  ) THEN
    RAISE EXCEPTION 'Workforce exception case segment must be pinned in its employee workday snapshot' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- Production trigger subset: 20260830170000
CREATE OR REPLACE FUNCTION workforce_reject_exception_case_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce exception case facts are immutable; append a decision instead' USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION workforce_reject_exception_decision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce exception decisions are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_exception_cases_validate_insert
  BEFORE INSERT ON "workforce_exception_cases"
  FOR EACH ROW EXECUTE FUNCTION workforce_validate_exception_case_insert();

CREATE TRIGGER workforce_exception_cases_append_only
  BEFORE UPDATE OR DELETE ON "workforce_exception_cases"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_exception_case_mutation();

CREATE TRIGGER workforce_exception_decisions_append_only
  BEFORE UPDATE OR DELETE ON "workforce_exception_decisions"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_exception_decision_mutation();

-- Production trigger subset: 20260830130000
CREATE OR REPLACE FUNCTION workforce_reject_employee_team_membership_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workforce employee team membership history is immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workforce_employee_team_memberships_immutable
  BEFORE UPDATE OR DELETE ON "workforce_employee_team_memberships"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_employee_team_membership_mutation();

DO $$
DECLARE app_oid oid; verified integer;
BEGIN
  SELECT oid INTO app_oid FROM pg_roles WHERE rolname='wf_manager_today_browser'
    AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb
    AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit;
  IF app_oid IS NULL THEN RAISE EXCEPTION 'Today app role privileges are unsafe'; END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member=app_oid)
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relowner=app_oid)
    OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='public' AND nspowner=app_oid)
    OR EXISTS (SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=app_oid) THEN
    RAISE EXCEPTION 'Today app role must not own objects or inherit another role';
  END IF;
  SELECT count(*) INTO verified FROM pg_class c
    WHERE c.relnamespace='public'::regnamespace
      AND c.relname=ANY(ARRAY['users','mtm_teams','mtm_agents','mtm_settings','mtm_work_calendar_days','workforce_employee_team_memberships','mtm_agent_workdays','mtm_agent_workday_events','workforce_access_grants','workforce_access_grant_revocations','workforce_shift_templates','workforce_shift_segments','workforce_shift_assignments','workforce_shift_default_assignments','workforce_shift_team_default_assignments','workforce_policy_snapshots','workforce_shift_snapshots','workforce_workday_schedule_snapshots','workforce_exception_cases','workforce_exception_decisions']) AND c.relrowsecurity AND c.relforcerowsecurity
      AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='wf_manager_today_tenant');
  IF verified <> 20 THEN RAISE EXCEPTION 'Today fixture requires20 forced-RLS policies'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace
      AND c.relkind IN ('r','p') AND c.relname <> 'users'
      AND (has_any_column_privilege(app_oid,c.oid,'INSERT')
        OR has_any_column_privilege(app_oid,c.oid,'UPDATE')
        OR has_table_privilege(app_oid,c.oid,'DELETE')
        OR has_table_privilege(app_oid,c.oid,'TRUNCATE'))) THEN
    RAISE EXCEPTION 'Today business tables must be read-only for the app role';
  END IF;
  IF NOT has_column_privilege(app_oid,'public.users','lastLogin','UPDATE')
    OR NOT has_column_privilege(app_oid,'public.users','loginCount','UPDATE')
    OR NOT has_column_privilege(app_oid,'public.users','updatedAt','UPDATE')
    OR has_any_column_privilege(app_oid,'public.users','INSERT')
    OR has_column_privilege(app_oid,'public.users','role','UPDATE')
    OR has_column_privilege(app_oid,'public.users','organizationId','UPDATE')
    OR has_column_privilege(app_oid,'public.users','passwordHash','UPDATE')
    OR has_table_privilege(app_oid,'public.users','DELETE')
    OR has_table_privilege(app_oid,'public.users','TRUNCATE') THEN
    RAISE EXCEPTION 'Today auth update privilege must stay restricted';
  END IF;
END $$;
COMMIT;
