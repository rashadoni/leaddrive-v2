-- Mobile sync v2 foundation (server-first, additive).
--
-- This migration does NOT alter the frozen v1 pull/push endpoints or their
-- idempotency table. It adds an independently gated routes pilot whose
-- change-log is populated transactionally by database triggers. The owner
-- approved a seven-day offline guarantee; change tombstones retain fourteen
-- days (seven days plus a recovery buffer).
--
-- Rollback: disable/delete rows from mtm_mobile_sync_cohorts first. The new
-- tables and triggers remain harmless while no cohort reaches the v2 endpoint;
-- destructive table removal is a separate, post-fleet-retirement migration.

SET lock_timeout = '3s';
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "mtm_mobile_sync_streams" (
  "organizationId" TEXT NOT NULL,
  "stream" TEXT NOT NULL,
  "revision" BIGINT NOT NULL DEFAULT 0,
  "retentionFloorRevision" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_mobile_sync_streams_pkey" PRIMARY KEY ("organizationId", "stream"),
  CONSTRAINT "mtm_mobile_sync_streams_stream_nonempty" CHECK (char_length("stream") BETWEEN 1 AND 64),
  CONSTRAINT "mtm_mobile_sync_streams_revisions_nonnegative" CHECK (
    "revision" >= 0 AND "retentionFloorRevision" >= 0
  )
);

-- A scope revision belongs to one Field actor, not to the whole tenant. A
-- primary/assignment revoke therefore invalidates all of that actor's devices
-- without making every other route client rebuild its stream.
CREATE TABLE "mtm_mobile_sync_agent_scopes" (
  "organizationId" TEXT NOT NULL,
  "stream" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "scopeRevision" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_mobile_sync_agent_scopes_pkey" PRIMARY KEY ("organizationId", "stream", "agentId"),
  CONSTRAINT "mtm_mobile_sync_agent_scopes_stream_nonempty" CHECK (char_length("stream") BETWEEN 1 AND 64),
  CONSTRAINT "mtm_mobile_sync_agent_scopes_revisions_nonnegative" CHECK ("scopeRevision" >= 0)
);

CREATE TABLE "mtm_mobile_sync_changes" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "stream" TEXT NOT NULL,
  "revision" BIGINT NOT NULL,
  "changeType" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "audienceAgentId" TEXT NOT NULL,
  "tombstoneReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_mobile_sync_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_mobile_sync_changes_change_type" CHECK ("changeType" IN ('UPSERT', 'TOMBSTONE')),
  CONSTRAINT "mtm_mobile_sync_changes_stream_nonempty" CHECK (char_length("stream") BETWEEN 1 AND 64),
  CONSTRAINT "mtm_mobile_sync_changes_audience_agent_nonempty" CHECK (char_length("audienceAgentId") BETWEEN 1 AND 255),
  CONSTRAINT "mtm_mobile_sync_changes_revision_positive" CHECK ("revision" > 0)
);

CREATE TABLE "mtm_mobile_sync_snapshots" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "stream" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "boundaryRevision" BIGINT NOT NULL,
  "scopeRevision" BIGINT NOT NULL,
  "horizonKey" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_mobile_sync_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_mobile_sync_snapshots_organizationId_id_key" UNIQUE ("organizationId", "id"),
  CONSTRAINT "mtm_mobile_sync_snapshots_stream_nonempty" CHECK (char_length("stream") BETWEEN 1 AND 64),
  CONSTRAINT "mtm_mobile_sync_snapshots_device_id_length" CHECK (char_length("deviceId") BETWEEN 1 AND 128),
  CONSTRAINT "mtm_mobile_sync_snapshots_horizon_key_length" CHECK (char_length("horizonKey") BETWEEN 1 AND 64),
  CONSTRAINT "mtm_mobile_sync_snapshots_revisions_nonnegative" CHECK (
    "boundaryRevision" >= 0 AND "scopeRevision" >= 0
  )
);

-- Acquired in a short Read Committed statement before a Repeatable Read
-- snapshot build. This durable fence avoids duplicate builders even though
-- RLS setup runs a SQL command before an interactive Prisma callback starts.
CREATE TABLE "mtm_mobile_sync_snapshot_leases" (
  "organizationId" TEXT NOT NULL,
  "stream" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "horizonKey" TEXT NOT NULL,
  "leaseToken" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_mobile_sync_snapshot_leases_pkey" PRIMARY KEY ("organizationId", "stream", "agentId", "deviceId", "horizonKey"),
  CONSTRAINT "mtm_mobile_sync_snapshot_leases_stream_nonempty" CHECK (char_length("stream") BETWEEN 1 AND 64),
  CONSTRAINT "mtm_mobile_sync_snapshot_leases_device_id_length" CHECK (char_length("deviceId") BETWEEN 1 AND 128),
  CONSTRAINT "mtm_mobile_sync_snapshot_leases_horizon_key_length" CHECK (char_length("horizonKey") BETWEEN 1 AND 64),
  CONSTRAINT "mtm_mobile_sync_snapshot_leases_token_length" CHECK (char_length("leaseToken") BETWEEN 1 AND 128)
);

CREATE TABLE "mtm_mobile_sync_snapshot_items" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_mobile_sync_snapshot_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_mobile_sync_snapshot_items_ordinal_positive" CHECK ("ordinal" > 0)
);

CREATE TABLE "mtm_mobile_sync_cohorts" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "stream" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_mobile_sync_cohorts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_mobile_sync_cohorts_stream_nonempty" CHECK (char_length("stream") BETWEEN 1 AND 64),
  CONSTRAINT "mtm_mobile_sync_cohorts_device_id_length" CHECK (char_length("deviceId") BETWEEN 1 AND 128)
);

ALTER TABLE "mtm_mobile_sync_streams"
  ADD CONSTRAINT "mtm_mobile_sync_streams_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_mobile_sync_agent_scopes"
  ADD CONSTRAINT "mtm_mobile_sync_agent_scopes_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_mobile_sync_agent_scopes_stream_fkey"
  FOREIGN KEY ("organizationId", "stream") REFERENCES "mtm_mobile_sync_streams"("organizationId", "stream") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_mobile_sync_changes"
  ADD CONSTRAINT "mtm_mobile_sync_changes_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_mobile_sync_changes_stream_fkey"
  FOREIGN KEY ("organizationId", "stream") REFERENCES "mtm_mobile_sync_streams"("organizationId", "stream") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_mobile_sync_snapshots"
  ADD CONSTRAINT "mtm_mobile_sync_snapshots_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_mobile_sync_snapshots_stream_fkey"
  FOREIGN KEY ("organizationId", "stream") REFERENCES "mtm_mobile_sync_streams"("organizationId", "stream") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_mobile_sync_snapshot_leases"
  ADD CONSTRAINT "mtm_mobile_sync_snapshot_leases_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_mobile_sync_snapshot_leases_stream_fkey"
  FOREIGN KEY ("organizationId", "stream") REFERENCES "mtm_mobile_sync_streams"("organizationId", "stream") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_mobile_sync_snapshot_items"
  ADD CONSTRAINT "mtm_mobile_sync_snapshot_items_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_mobile_sync_snapshot_items_snapshot_fkey"
  FOREIGN KEY ("organizationId", "snapshotId") REFERENCES "mtm_mobile_sync_snapshots"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_mobile_sync_cohorts"
  ADD CONSTRAINT "mtm_mobile_sync_cohorts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "mtm_mobile_sync_changes_organizationId_stream_revision_key"
  ON "mtm_mobile_sync_changes"("organizationId", "stream", "revision");
CREATE INDEX "mtm_mobile_sync_changes_audience_idx"
  ON "mtm_mobile_sync_changes"("organizationId", "stream", "audienceAgentId", "revision");
CREATE INDEX "mtm_mobile_sync_changes_expiresAt_idx"
  ON "mtm_mobile_sync_changes"("expiresAt");
CREATE INDEX "mtm_mobile_sync_streams_organizationId_updatedAt_idx"
  ON "mtm_mobile_sync_streams"("organizationId", "updatedAt");
CREATE INDEX "mtm_mobile_sync_agent_scopes_lookup_idx"
  ON "mtm_mobile_sync_agent_scopes"("organizationId", "stream", "agentId", "updatedAt");
CREATE INDEX "mtm_mobile_sync_snapshots_lookup_idx"
  ON "mtm_mobile_sync_snapshots"("organizationId", "stream", "agentId", "deviceId", "horizonKey", "expiresAt");
CREATE INDEX "mtm_mobile_sync_snapshots_expiresAt_idx"
  ON "mtm_mobile_sync_snapshots"("expiresAt");
CREATE INDEX "mtm_mobile_sync_snapshot_leases_expiresAt_idx"
  ON "mtm_mobile_sync_snapshot_leases"("expiresAt");
CREATE UNIQUE INDEX "mtm_mobile_sync_snapshot_items_snapshotId_ordinal_key"
  ON "mtm_mobile_sync_snapshot_items"("snapshotId", "ordinal");
CREATE UNIQUE INDEX "mtm_mobile_sync_snapshot_items_snapshotId_entityId_key"
  ON "mtm_mobile_sync_snapshot_items"("snapshotId", "entityId");
CREATE INDEX "mtm_mobile_sync_snapshot_items_lookup_idx"
  ON "mtm_mobile_sync_snapshot_items"("organizationId", "snapshotId", "ordinal");
CREATE UNIQUE INDEX "mtm_mobile_sync_cohorts_organizationId_stream_agent_device_key"
  ON "mtm_mobile_sync_cohorts"("organizationId", "stream", "agentId", "deviceId");
CREATE INDEX "mtm_mobile_sync_cohorts_lookup_idx"
  ON "mtm_mobile_sync_cohorts"("organizationId", "stream", "enabled", "expiresAt");

-- The read-path indexes for existing `mtm_routes`/`mtm_route_assignments`
-- deliberately do NOT run inside this transactional migration. PostgreSQL
-- would take a write-blocking lock while building a normal CREATE INDEX on a
-- large live table. The exact CREATE INDEX CONCURRENTLY commands, verification
-- and rollback are in docs/mobile-sync-v2-rollout-runbook.md and are a hard
-- prerequisite before any cohort is enabled. New v2 tables above are empty,
-- so their ordinary indexes remain safe here.

-- Every new tenant-owned table is FORCE RLS from the first migration. The
-- bypass arm is required for the established runWithRlsBypass() maintenance
-- paths; without it cleanup would falsely see zero rows.
ALTER TABLE "mtm_mobile_sync_streams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_mobile_sync_streams" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_mobile_sync_streams";
CREATE POLICY tenant_isolation ON "mtm_mobile_sync_streams"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "mtm_mobile_sync_agent_scopes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_mobile_sync_agent_scopes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_mobile_sync_agent_scopes";
CREATE POLICY tenant_isolation ON "mtm_mobile_sync_agent_scopes"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "mtm_mobile_sync_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_mobile_sync_changes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_mobile_sync_changes";
CREATE POLICY tenant_isolation ON "mtm_mobile_sync_changes"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "mtm_mobile_sync_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_mobile_sync_snapshots" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_mobile_sync_snapshots";
CREATE POLICY tenant_isolation ON "mtm_mobile_sync_snapshots"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "mtm_mobile_sync_snapshot_leases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_mobile_sync_snapshot_leases" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_mobile_sync_snapshot_leases";
CREATE POLICY tenant_isolation ON "mtm_mobile_sync_snapshot_leases"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "mtm_mobile_sync_snapshot_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_mobile_sync_snapshot_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_mobile_sync_snapshot_items";
CREATE POLICY tenant_isolation ON "mtm_mobile_sync_snapshot_items"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "mtm_mobile_sync_cohorts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_mobile_sync_cohorts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_mobile_sync_cohorts";
CREATE POLICY tenant_isolation ON "mtm_mobile_sync_cohorts"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

-- Atomically advance a stream revision and append a compact change record.
-- It is called only from row triggers below, so a business write and its
-- journal record cannot commit independently. Scope is deliberately kept in
-- a separate per-agent fence rather than advancing a tenant-wide revision.
--
-- This compact, actor-addressed journal intentionally runs before an exact
-- device cohort exists. Gating it on the current cohort would open a cursor
-- gap around cohort enable/disable: an older repeatable-read writer could
-- commit after a new device's snapshot without leaving a delta. It retains no
-- route payload/PII and expires after fourteen days; endpoint delivery stays
-- strictly cohort-gated. Measure its retention volume before any expansion.
CREATE OR REPLACE FUNCTION mtm_mobile_sync_append_change(
  p_organization_id TEXT,
  p_stream TEXT,
  p_change_type TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_audience_agent_id TEXT,
  p_tombstone_reason TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_revision BIGINT;
BEGIN
  INSERT INTO "mtm_mobile_sync_streams" (
    "organizationId", "stream", "revision", "retentionFloorRevision", "createdAt", "updatedAt"
  ) VALUES (
    p_organization_id, p_stream, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
  ON CONFLICT ("organizationId", "stream") DO UPDATE
  SET
    "revision" = "mtm_mobile_sync_streams"."revision" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
  RETURNING "revision" INTO v_revision;

  INSERT INTO "mtm_mobile_sync_changes" (
    "id", "organizationId", "stream", "revision", "changeType", "entityType", "entityId",
    "audienceAgentId", "tombstoneReason", "createdAt", "expiresAt"
  ) VALUES (
    gen_random_uuid()::text, p_organization_id, p_stream, v_revision, p_change_type, p_entity_type, p_entity_id,
    p_audience_agent_id, p_tombstone_reason, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '14 days'
  );
  RETURN v_revision;
END;
$$;

-- The same primary/assignment mutation can be initiated by different web
-- requests. All membership transitions for a route take this advisory lock,
-- preventing two transactions from each seeing the other access path and
-- jointly omitting the required removal fence.
CREATE OR REPLACE FUNCTION mtm_mobile_sync_lock_route(
  p_organization_id TEXT,
  p_route_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('mtm-mobile-sync-v2-route:' || p_organization_id || ':' || p_route_id, 0)
  );
END;
$$;

-- Moving a point/assignment between routes touches two independent route
-- audiences. Lock the pair in a deterministic order so simultaneous A→B and
-- B→A maintenance operations cannot deadlock or miss the old projection.
CREATE OR REPLACE FUNCTION mtm_mobile_sync_lock_route_pair(
  p_organization_id TEXT,
  p_first_route_id TEXT,
  p_second_route_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_first_route_id = p_second_route_id THEN
    PERFORM mtm_mobile_sync_lock_route(p_organization_id, p_first_route_id);
  ELSIF p_first_route_id < p_second_route_id THEN
    PERFORM mtm_mobile_sync_lock_route(p_organization_id, p_first_route_id);
    PERFORM mtm_mobile_sync_lock_route(p_organization_id, p_second_route_id);
  ELSE
    PERFORM mtm_mobile_sync_lock_route(p_organization_id, p_second_route_id);
    PERFORM mtm_mobile_sync_lock_route(p_organization_id, p_first_route_id);
  END IF;
END;
$$;

-- Legacy child FKs reference route id only. Enforce the denormalised tenant
-- invariant at the sync trigger boundary for every newly linked point or
-- assignment, so an RLS-bypass maintenance mistake cannot create a child in
-- tenant A that points to tenant B's route.
CREATE OR REPLACE FUNCTION mtm_mobile_sync_assert_route_tenant(
  p_organization_id TEXT,
  p_route_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "mtm_routes" r
    WHERE r."organizationId" = p_organization_id
      AND r."id" = p_route_id
  ) THEN
    RAISE EXCEPTION 'mtm route child must belong to the same tenant';
  END IF;
END;
$$;

-- Bump all devices for exactly one Field actor. A reader takes FOR UPDATE on
-- this row while it reads a snapshot/delta page, so a committed revoke cannot
-- race a subsequent page into disclosing an immutable snapshot item.
CREATE OR REPLACE FUNCTION mtm_mobile_sync_bump_agent_scope(
  p_organization_id TEXT,
  p_stream TEXT,
  p_agent_id TEXT
) RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_scope_revision BIGINT;
BEGIN
  INSERT INTO "mtm_mobile_sync_agent_scopes" (
    "organizationId", "stream", "agentId", "scopeRevision", "createdAt", "updatedAt"
  ) VALUES (
    p_organization_id, p_stream, p_agent_id, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
  ON CONFLICT ("organizationId", "stream", "agentId") DO UPDATE
  SET
    "scopeRevision" = "mtm_mobile_sync_agent_scopes"."scopeRevision" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
  RETURNING "scopeRevision" INTO v_scope_revision;
  RETURN v_scope_revision;
END;
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_route_audience_agents(
  p_organization_id TEXT,
  p_route_id TEXT,
  p_primary_agent_id TEXT
) RETURNS TABLE("agentId" TEXT)
LANGUAGE sql
VOLATILE
AS $$
  SELECT DISTINCT audience."agentId"
  FROM (
    SELECT p_primary_agent_id AS "agentId"
    UNION ALL
    SELECT a."agentId"
    FROM "mtm_route_assignments" a
    WHERE a."organizationId" = p_organization_id
      AND a."routeId" = p_route_id
      AND a."removedAt" IS NULL
      AND a."role" <> 'OBSERVER'
  ) audience
  WHERE audience."agentId" IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_emit_route_tombstones(
  p_organization_id TEXT,
  p_route_id TEXT,
  p_primary_agent_id TEXT,
  p_reason TEXT,
  p_bump_scope BOOLEAN DEFAULT false
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_agent_id TEXT;
BEGIN
  FOR v_agent_id IN
    SELECT "agentId"
    FROM mtm_mobile_sync_route_audience_agents(p_organization_id, p_route_id, p_primary_agent_id)
  LOOP
    PERFORM mtm_mobile_sync_append_change(
      p_organization_id, 'routes', 'TOMBSTONE', 'route', p_route_id, v_agent_id, p_reason
    );
    IF p_bump_scope THEN
      PERFORM mtm_mobile_sync_bump_agent_scope(p_organization_id, 'routes', v_agent_id);
    END IF;
  END LOOP;
END;
$$;

-- A stream revision is globally monotonic, but its delivery is actor-specific.
-- Fan out one compact UPSERT per current route audience at write time so a
-- device never has to page through another agent's route/point churn merely
-- to advance its own cursor.
CREATE OR REPLACE FUNCTION mtm_mobile_sync_emit_route_upserts(
  p_organization_id TEXT,
  p_route_id TEXT,
  p_primary_agent_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_agent_id TEXT;
BEGIN
  FOR v_agent_id IN
    SELECT "agentId"
    FROM mtm_mobile_sync_route_audience_agents(p_organization_id, p_route_id, p_primary_agent_id)
  LOOP
    PERFORM mtm_mobile_sync_append_change(
      p_organization_id, 'routes', 'UPSERT', 'route', p_route_id, v_agent_id, NULL
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_bump_route_audience_scopes(
  p_organization_id TEXT,
  p_route_id TEXT,
  p_primary_before TEXT,
  p_primary_after TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_agent_id TEXT;
BEGIN
  FOR v_agent_id IN
    SELECT DISTINCT audience."agentId"
    FROM (
      SELECT p_primary_before AS "agentId"
      UNION ALL
      SELECT p_primary_after AS "agentId"
      UNION ALL
      SELECT a."agentId"
      FROM "mtm_route_assignments" a
      WHERE a."organizationId" = p_organization_id
        AND a."routeId" = p_route_id
        AND a."removedAt" IS NULL
        AND a."role" <> 'OBSERVER'
    ) audience
    WHERE audience."agentId" IS NOT NULL
  LOOP
    PERFORM mtm_mobile_sync_bump_agent_scope(p_organization_id, 'routes', v_agent_id);
  END LOOP;
END;
$$;

-- Scope loss is subtle during the legacy-primary → assignment migration: an
-- agent can lose one assignment row yet still own the route as its primary,
-- or lose primary ownership while retaining an active participant assignment.
-- This checks the post-write scope only after the route-level lock is held.
CREATE OR REPLACE FUNCTION mtm_mobile_sync_route_visible_to_agent(
  p_organization_id TEXT,
  p_route_id TEXT,
  p_agent_id TEXT
) RETURNS BOOLEAN
LANGUAGE sql
VOLATILE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "mtm_routes" r
    WHERE r."organizationId" = p_organization_id
      AND r."id" = p_route_id
      AND r."deletedAt" IS NULL
      AND r."agentId" = p_agent_id
  ) OR EXISTS (
    SELECT 1
    FROM "mtm_route_assignments" a
    WHERE a."organizationId" = p_organization_id
      AND a."routeId" = p_route_id
      AND a."agentId" = p_agent_id
      AND a."removedAt" IS NULL
      AND a."role" <> 'OBSERVER'
  );
$$;

-- Hard deletion must run before FK cascades remove assignments; otherwise the
-- old audience cannot be reconstructed to receive its targeted tombstones.
CREATE OR REPLACE FUNCTION mtm_mobile_sync_route_delete_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM mtm_mobile_sync_lock_route(OLD."organizationId", OLD."id");
  PERFORM mtm_mobile_sync_emit_route_tombstones(
    OLD."organizationId", OLD."id", OLD."agentId", 'DELETED', true
  );
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_route_change_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- The route is the tenant root of its points/assignments and of every
  -- actor-addressed journal event. Do not permit a maintenance/bypass write
  -- to turn it into an accidental cross-tenant move with stale old scopes.
  IF TG_OP = 'UPDATE' AND OLD."organizationId" IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'mtm route cannot move across tenants';
  END IF;

  PERFORM mtm_mobile_sync_lock_route(NEW."organizationId", NEW."id");

  IF NEW."deletedAt" IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM mtm_mobile_sync_emit_route_tombstones(
        NEW."organizationId", NEW."id", NEW."agentId", 'DELETED', true
      );
    ELSIF OLD."deletedAt" IS NULL THEN
      PERFORM mtm_mobile_sync_emit_route_tombstones(
        NEW."organizationId", NEW."id", OLD."agentId", 'DELETED', true
      );
    END IF;
    RETURN NEW;
  END IF;

  -- A restored route is safe as a normal UPSERT: the deletion invalidated any
  -- earlier snapshot, and a complete snapshot can pick the new row up in its
  -- following delta.
  IF TG_OP = 'UPDATE' THEN
    IF OLD."deletedAt" IS NULL
      AND (
        OLD."agentId" IS DISTINCT FROM NEW."agentId"
        OR OLD."date" IS DISTINCT FROM NEW."date"
        OR OLD."status" IS DISTINCT FROM NEW."status"
      )
    THEN
      -- Date/status changes may move an otherwise authorized route out of the
      -- approved horizon. The prior audience gets a targeted tombstone and a
      -- per-agent scope fence; no tenant-wide record can disclose another route.
      PERFORM mtm_mobile_sync_emit_route_tombstones(
        OLD."organizationId", OLD."id", OLD."agentId", 'SCOPE_OR_HORIZON_CHANGED', false
      );
      PERFORM mtm_mobile_sync_bump_route_audience_scopes(
        OLD."organizationId", OLD."id", OLD."agentId", NEW."agentId"
      );
    END IF;
  END IF;

  PERFORM mtm_mobile_sync_emit_route_upserts(
    NEW."organizationId", NEW."id", NEW."agentId"
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_route_point_change_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_organization_id TEXT;
  v_route_id TEXT;
  v_primary_agent_id TEXT;
  v_old_primary_agent_id TEXT;
BEGIN
  -- A point belongs to its route's tenant. Cross-tenant reassignment would
  -- violate the projection/RLS ownership invariant rather than create a
  -- recoverable sync event, so fail the source transaction closed.
  IF TG_OP = 'UPDATE' AND OLD."organizationId" IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'mtm route point cannot move across tenants';
  END IF;
  IF TG_OP = 'INSERT'
    OR (TG_OP = 'UPDATE' AND OLD."routeId" IS DISTINCT FROM NEW."routeId")
  THEN
    PERFORM mtm_mobile_sync_assert_route_tenant(NEW."organizationId", NEW."routeId");
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."routeId" IS DISTINCT FROM NEW."routeId" THEN
    -- The row is already attached to NEW here. Repair both route projections:
    -- old viewers must receive an UPSERT without this point, and new viewers
    -- receive one with it. A single NEW-route signal would leave the old
    -- immutable/local projection stale.
    PERFORM mtm_mobile_sync_lock_route_pair(
      NEW."organizationId", OLD."routeId", NEW."routeId"
    );

    SELECT r."agentId"
    INTO v_old_primary_agent_id
    FROM "mtm_routes" r
    WHERE r."id" = OLD."routeId"
      AND r."organizationId" = OLD."organizationId"
      AND r."deletedAt" IS NULL;
    IF FOUND THEN
      PERFORM mtm_mobile_sync_emit_route_upserts(
        OLD."organizationId", OLD."routeId", v_old_primary_agent_id
      );
    END IF;

    SELECT r."agentId"
    INTO v_primary_agent_id
    FROM "mtm_routes" r
    WHERE r."id" = NEW."routeId"
      AND r."organizationId" = NEW."organizationId"
      AND r."deletedAt" IS NULL;
    IF FOUND THEN
      PERFORM mtm_mobile_sync_emit_route_upserts(
        NEW."organizationId", NEW."routeId", v_primary_agent_id
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_organization_id := OLD."organizationId";
    v_route_id := OLD."routeId";
  ELSE
    v_organization_id := NEW."organizationId";
    v_route_id := NEW."routeId";
  END IF;

  PERFORM mtm_mobile_sync_lock_route(v_organization_id, v_route_id);
  -- A hard route deletion cascades its points. The route's BEFORE DELETE
  -- trigger already emitted audience-specific tombstones, so never append an
  -- UPSERT after the parent has disappeared.
  SELECT r."agentId"
  INTO v_primary_agent_id
  FROM "mtm_routes" r
  WHERE r."id" = v_route_id
    AND r."organizationId" = v_organization_id
    AND r."deletedAt" IS NULL;
  IF FOUND THEN
    PERFORM mtm_mobile_sync_emit_route_upserts(
      v_organization_id, v_route_id, v_primary_agent_id
    );
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION mtm_mobile_sync_route_assignment_change_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_organization_id TEXT;
  v_route_id TEXT;
  v_route_primary_agent_id TEXT;
  v_route_active BOOLEAN;
  v_old_route_primary_agent_id TEXT;
  v_old_route_active BOOLEAN;
  v_new_route_primary_agent_id TEXT;
  v_new_route_active BOOLEAN;
  v_old_explicit BOOLEAN := false;
  v_new_explicit BOOLEAN := false;
  v_new_was_visible BOOLEAN := false;
  v_new_scope_gained BOOLEAN := false;
BEGIN
  -- Assignment and route tenant ownership must never be rewritten together:
  -- that would make an actor-targeted journal event cross an RLS boundary.
  IF TG_OP = 'UPDATE' AND OLD."organizationId" IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'mtm route assignment cannot move across tenants';
  END IF;
  IF TG_OP = 'INSERT'
    OR (TG_OP = 'UPDATE' AND OLD."routeId" IS DISTINCT FROM NEW."routeId")
  THEN
    PERFORM mtm_mobile_sync_assert_route_tenant(NEW."organizationId", NEW."routeId");
  END IF;

  IF TG_OP <> 'INSERT' THEN
    v_old_explicit := OLD."removedAt" IS NULL AND OLD."role" <> 'OBSERVER';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_explicit := NEW."removedAt" IS NULL AND NEW."role" <> 'OBSERVER';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."routeId" IS DISTINCT FROM NEW."routeId" THEN
    -- A transfer changes two projections. Lock both routes before inspecting
    -- post-write membership, then notify remaining old viewers and current
    -- new viewers independently. This closes the stale-old-route gap that a
    -- NEW-only trigger leaves behind.
    PERFORM mtm_mobile_sync_lock_route_pair(
      NEW."organizationId", OLD."routeId", NEW."routeId"
    );

    SELECT r."agentId", r."deletedAt" IS NULL
    INTO v_old_route_primary_agent_id, v_old_route_active
    FROM "mtm_routes" r
    WHERE r."organizationId" = OLD."organizationId" AND r."id" = OLD."routeId";
    IF FOUND AND v_old_route_active THEN
      IF v_old_explicit
        AND NOT mtm_mobile_sync_route_visible_to_agent(
          OLD."organizationId", OLD."routeId", OLD."agentId"
        )
      THEN
        PERFORM mtm_mobile_sync_append_change(
          OLD."organizationId", 'routes', 'TOMBSTONE', 'route', OLD."routeId", OLD."agentId", 'SCOPE_REMOVED'
        );
        PERFORM mtm_mobile_sync_bump_agent_scope(OLD."organizationId", 'routes', OLD."agentId");
      END IF;
      PERFORM mtm_mobile_sync_emit_route_upserts(
        OLD."organizationId", OLD."routeId", v_old_route_primary_agent_id
      );
    END IF;

    SELECT r."agentId", r."deletedAt" IS NULL
    INTO v_new_route_primary_agent_id, v_new_route_active
    FROM "mtm_routes" r
    WHERE r."organizationId" = NEW."organizationId" AND r."id" = NEW."routeId";
    IF FOUND AND v_new_route_active THEN
      IF v_new_explicit AND v_new_route_primary_agent_id <> NEW."agentId" THEN
        -- The unique (routeId, agentId) constraint means the transferred row
        -- could not have been a second active assignment on this new route.
        -- A non-primary active actor therefore gained route scope now.
        v_new_scope_gained := true;
      END IF;
      PERFORM mtm_mobile_sync_emit_route_upserts(
        NEW."organizationId", NEW."routeId", v_new_route_primary_agent_id
      );
      IF v_new_scope_gained THEN
        PERFORM mtm_mobile_sync_bump_agent_scope(NEW."organizationId", 'routes', NEW."agentId");
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_organization_id := OLD."organizationId";
    v_route_id := OLD."routeId";
  ELSE
    v_organization_id := NEW."organizationId";
    v_route_id := NEW."routeId";
  END IF;

  PERFORM mtm_mobile_sync_lock_route(v_organization_id, v_route_id);
  SELECT r."agentId", r."deletedAt" IS NULL
  INTO v_route_primary_agent_id, v_route_active
  FROM "mtm_routes" r
  WHERE r."organizationId" = v_organization_id AND r."id" = v_route_id;

  -- Parent DELETE cascades arrive here after the route's pre-delete tombstone;
  -- never add a duplicate actor change while the parent is gone.
  IF NOT FOUND OR NOT v_route_active THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF v_old_explicit
    AND NOT mtm_mobile_sync_route_visible_to_agent(v_organization_id, v_route_id, OLD."agentId")
  THEN
    PERFORM mtm_mobile_sync_append_change(
      v_organization_id, 'routes', 'TOMBSTONE', 'route', v_route_id, OLD."agentId", 'SCOPE_REMOVED'
    );
    PERFORM mtm_mobile_sync_bump_agent_scope(v_organization_id, 'routes', OLD."agentId");
  END IF;

  IF v_new_explicit THEN
    v_new_was_visible := v_route_primary_agent_id = NEW."agentId";
    IF TG_OP = 'UPDATE' AND OLD."agentId" = NEW."agentId" AND v_old_explicit THEN
      v_new_was_visible := true;
    END IF;
    IF NOT v_new_was_visible THEN
      v_new_scope_gained := true;
    END IF;
  END IF;

  -- Assignment metadata is part of the projection. Fan out only to the
  -- current audience after locked scope reconciliation, so a noisy tenant
  -- cannot make unrelated devices page/drop this route's updates.
  PERFORM mtm_mobile_sync_emit_route_upserts(
    v_organization_id, v_route_id, v_route_primary_agent_id
  );
  -- Keep the lock order uniform across all route triggers: stream revision
  -- first, then agent scope. This prevents two unrelated route changes from
  -- deadlocking while one holds the stream row and the other holds a scope.
  IF v_new_scope_gained THEN
    PERFORM mtm_mobile_sync_bump_agent_scope(v_organization_id, 'routes', NEW."agentId");
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mtm_mobile_sync_route_change ON "mtm_routes";
DROP TRIGGER IF EXISTS mtm_mobile_sync_route_delete ON "mtm_routes";
CREATE TRIGGER mtm_mobile_sync_route_delete
BEFORE DELETE ON "mtm_routes"
FOR EACH ROW EXECUTE FUNCTION mtm_mobile_sync_route_delete_trigger();
CREATE TRIGGER mtm_mobile_sync_route_change
AFTER INSERT OR UPDATE ON "mtm_routes"
FOR EACH ROW EXECUTE FUNCTION mtm_mobile_sync_route_change_trigger();

DROP TRIGGER IF EXISTS mtm_mobile_sync_route_point_change ON "mtm_route_points";
CREATE TRIGGER mtm_mobile_sync_route_point_change
AFTER INSERT OR UPDATE OR DELETE ON "mtm_route_points"
FOR EACH ROW EXECUTE FUNCTION mtm_mobile_sync_route_point_change_trigger();

DROP TRIGGER IF EXISTS mtm_mobile_sync_route_assignment_change ON "mtm_route_assignments";
CREATE TRIGGER mtm_mobile_sync_route_assignment_change
AFTER INSERT OR UPDATE OR DELETE ON "mtm_route_assignments"
FOR EACH ROW EXECUTE FUNCTION mtm_mobile_sync_route_assignment_change_trigger();
