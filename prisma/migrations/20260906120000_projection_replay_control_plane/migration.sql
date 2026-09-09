BEGIN;

CREATE TABLE "projection_activations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "projectionName" TEXT NOT NULL,
  "activeBuildId" UUID NOT NULL,
  "activationVersion" BIGINT NOT NULL DEFAULT 1,
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "projection_activations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "projection_activations_version_positive" CHECK ("activationVersion" > 0)
);

CREATE TABLE "projection_promotion_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "projectionName" TEXT NOT NULL,
  "targetBuildId" UUID NOT NULL,
  "previousBuildId" UUID,
  "action" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "requestedBy" TEXT NOT NULL,
  "approvedBy" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "resultingPointerVersion" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "projection_promotion_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "projection_promotion_events_action" CHECK ("action" IN ('promote', 'rollback')),
  CONSTRAINT "projection_promotion_events_two_person" CHECK ("requestedBy" <> "approvedBy"),
  CONSTRAINT "projection_promotion_events_evidence_hash" CHECK ("evidenceHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "projection_promotion_events_pointer_version_positive" CHECK ("resultingPointerVersion" > 0),
  CONSTRAINT "projection_promotion_events_target_changes" CHECK ("previousBuildId" IS NULL OR "previousBuildId" <> "targetBuildId")
);

CREATE UNIQUE INDEX "projection_activations_org_id_key"
  ON "projection_activations"("organizationId", "id");
CREATE UNIQUE INDEX "projection_activations_pointer_key"
  ON "projection_activations"("organizationId", "projectionName");
CREATE INDEX "projection_activations_build_idx"
  ON "projection_activations"("organizationId", "activeBuildId");
CREATE UNIQUE INDEX "projection_promotion_events_request_key"
  ON "projection_promotion_events"("organizationId", "projectionName", "requestKey");
CREATE INDEX "projection_promotion_events_history_idx"
  ON "projection_promotion_events"("organizationId", "projectionName", "createdAt");

ALTER TABLE "projection_activations" ADD CONSTRAINT "projection_activations_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projection_activations" ADD CONSTRAINT "projection_activations_active_build_fkey"
  FOREIGN KEY ("organizationId", "activeBuildId") REFERENCES "projection_builds"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projection_promotion_events" ADD CONSTRAINT "projection_promotion_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projection_promotion_events" ADD CONSTRAINT "projection_promotion_events_target_build_fkey"
  FOREIGN KEY ("organizationId", "targetBuildId") REFERENCES "projection_builds"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projection_promotion_events" ADD CONSTRAINT "projection_promotion_events_previous_build_fkey"
  FOREIGN KEY ("organizationId", "previousBuildId") REFERENCES "projection_builds"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION projection_activation_guard_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target "projection_builds"%ROWTYPE;
  matching_event_count BIGINT;
BEGIN
  SELECT * INTO target
    FROM "projection_builds"
   WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."activeBuildId"
   FOR SHARE;

  IF NOT FOUND OR target."projectionName" <> NEW."projectionName"
     OR target."status" <> 'promoted' OR target."effectsFenced" IS NOT TRUE THEN
    RAISE EXCEPTION 'projection activation requires a promoted, effect-fenced build of the same tenant and projection'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."activationVersion" <> 1 THEN
      RAISE EXCEPTION 'initial projection activation version must be 1'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."projectionName" IS DISTINCT FROM OLD."projectionName"
       OR NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."activationVersion" <> OLD."activationVersion" + 1 THEN
      RAISE EXCEPTION 'projection activation identity is immutable and version must advance exactly once'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT count(*) INTO matching_event_count
    FROM "projection_promotion_events"
   WHERE "organizationId" = NEW."organizationId"
     AND "projectionName" = NEW."projectionName"
     AND "targetBuildId" = NEW."activeBuildId"
     AND "resultingPointerVersion" = NEW."activationVersion";
  IF matching_event_count <> 1 THEN
    RAISE EXCEPTION 'projection activation requires one matching promotion event in the same transaction'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION projection_checkpoint_guard_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  parent "projection_builds"%ROWTYPE;
BEGIN
  SELECT * INTO parent
    FROM "projection_builds"
   WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."buildId"
   FOR SHARE;
  IF NOT FOUND OR parent."status" NOT IN ('running', 'verifying') THEN
    RAISE EXCEPTION 'projection checkpoints may change only while their build is running or verifying'
      USING ERRCODE = 'check_violation';
  END IF;
  IF parent."mode" <> 'live' AND parent."effectsFenced" IS NOT TRUE THEN
    RAISE EXCEPTION 'shadow/replay checkpoint requires an active effect fence'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."buildId" IS DISTINCT FROM OLD."buildId"
       OR NEW."sourceTopic" IS DISTINCT FROM OLD."sourceTopic"
       OR NEW."sourcePartition" IS DISTINCT FROM OLD."sourcePartition"
       OR NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."sourceOffset" < OLD."sourceOffset"
       OR (NEW."sourceOffset" = OLD."sourceOffset"
           AND NEW."lastEventId" IS DISTINCT FROM OLD."lastEventId") THEN
      RAISE EXCEPTION 'projection checkpoint identity is immutable and offset cannot rewind'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION projection_promotion_event_guard_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target "projection_builds"%ROWTYPE;
BEGIN
  SELECT * INTO target
    FROM "projection_builds"
   WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."targetBuildId"
   FOR SHARE;
  IF NOT FOUND OR target."projectionName" <> NEW."projectionName"
     OR target."status" <> 'promoted' OR target."effectsFenced" IS NOT TRUE THEN
    RAISE EXCEPTION 'promotion evidence target must be a promoted, effect-fenced build of the same tenant and projection'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Prisma baseline environments contain the event-platform tables but not the
-- trigger functions created by the foundation migration. Keep this migration
-- independently deployable while preserving the exact production guards.
CREATE OR REPLACE FUNCTION event_platform_append_only_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% is append-only; UPDATE rejected (id=%)', TG_TABLE_NAME, OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(current_setting('app.event_history_purge', true), '') <> 'on'
     OR pg_trigger_depth() <= 1
     OR EXISTS (SELECT 1 FROM public."organizations" WHERE "id" = OLD."organizationId") THEN
    RAISE EXCEPTION '% is append-only; DELETE rejected (id=%)', TG_TABLE_NAME, OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION event_platform_delete_only_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('app.event_history_purge', true), '') <> 'on'
     OR pg_trigger_depth() <= 1
     OR EXISTS (SELECT 1 FROM public."organizations" WHERE "id" = OLD."organizationId") THEN
    RAISE EXCEPTION '% DELETE rejected outside a whole-tenant cascade (id=%)', TG_TABLE_NAME, OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION event_platform_reject_truncate_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; TRUNCATE rejected', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE CONSTRAINT TRIGGER projection_activation_guard_trigger
  AFTER INSERT OR UPDATE ON "projection_activations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION projection_activation_guard_fn();
CREATE TRIGGER projection_checkpoint_guard_trigger
  BEFORE INSERT OR UPDATE ON "projection_checkpoints"
  FOR EACH ROW EXECUTE FUNCTION projection_checkpoint_guard_fn();
CREATE TRIGGER projection_activations_delete_guard_trigger
  BEFORE DELETE ON "projection_activations"
  FOR EACH ROW EXECUTE FUNCTION event_platform_delete_only_fn();
CREATE TRIGGER projection_activations_reject_truncate_trigger
  BEFORE TRUNCATE ON "projection_activations"
  FOR EACH STATEMENT EXECUTE FUNCTION event_platform_reject_truncate_fn();
CREATE CONSTRAINT TRIGGER projection_promotion_event_guard_trigger
  AFTER INSERT ON "projection_promotion_events"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION projection_promotion_event_guard_fn();
CREATE TRIGGER projection_promotion_events_append_only_trigger
  BEFORE UPDATE OR DELETE ON "projection_promotion_events"
  FOR EACH ROW EXECUTE FUNCTION event_platform_append_only_fn();
CREATE TRIGGER projection_promotion_events_reject_truncate_trigger
  BEFORE TRUNCATE ON "projection_promotion_events"
  FOR EACH STATEMENT EXECUTE FUNCTION event_platform_reject_truncate_fn();

ALTER TABLE "projection_activations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projection_activations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "projection_promotion_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projection_promotion_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "projection_activations"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));
CREATE POLICY event_platform_tenant_select ON "projection_promotion_events"
  FOR SELECT USING ("organizationId" = current_setting('app.org_id', true));
CREATE POLICY event_platform_tenant_insert ON "projection_promotion_events"
  FOR INSERT WITH CHECK ("organizationId" = current_setting('app.org_id', true));

REVOKE ALL ON TABLE "projection_activations", "projection_promotion_events" FROM PUBLIC;

DO $$
DECLARE
  app_owner TEXT;
  app_grantee TEXT;
BEGIN
  SELECT tableowner INTO app_owner FROM pg_tables
   WHERE schemaname = 'public' AND tablename = 'funds';
  IF app_owner IS NOT NULL AND app_owner <> current_user THEN
    EXECUTE format('REVOKE ALL ON TABLE projection_activations, projection_promotion_events FROM %I', app_owner);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE projection_activations TO %I', app_owner);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE projection_promotion_events TO %I', app_owner);
  END IF;

  -- Mirror access only to principals already trusted with the existing
  -- projection control-plane. This covers deployments where the application
  -- role is a grantee rather than the owner of the legacy business tables.
  FOR app_grantee IN
    SELECT DISTINCT grantee
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name = 'projection_builds'
       AND privilege_type = 'SELECT'
       AND grantee NOT IN ('PUBLIC', current_user)
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE projection_activations, projection_promotion_events FROM %I', app_grantee);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE projection_activations TO %I', app_grantee);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE projection_promotion_events TO %I', app_grantee);
  END LOOP;
END $$;

COMMIT;
