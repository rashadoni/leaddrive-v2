import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260828120000_mtm_mobile_sync_v2_foundation/migration.sql",
), "utf8")
const rolloutRunbook = readFileSync(join(
  process.cwd(),
  "docs/mobile-sync-v2-rollout-runbook.md",
), "utf8")

describe("MTM mobile sync v2 foundation migration", () => {
  it("keeps v1 idempotency and pull contracts additive", () => {
    expect(migration).not.toContain('ALTER TABLE "mtm_sync_operations"')
    expect(migration).not.toContain('DROP TABLE "mtm_sync_operations"')
    expect(migration).toContain("does NOT alter the frozen v1 pull/push endpoints")
  })

  it("enforces RLS from first deployment for every tenant-owned v2 table", () => {
    for (const table of [
      "mtm_mobile_sync_streams",
      "mtm_mobile_sync_agent_scopes",
      "mtm_mobile_sync_changes",
      "mtm_mobile_sync_snapshots",
      "mtm_mobile_sync_snapshot_leases",
      "mtm_mobile_sync_snapshot_items",
      "mtm_mobile_sync_cohorts",
    ]) {
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`)
      expect(migration).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`)
      expect(migration).toContain(`CREATE POLICY tenant_isolation ON "${table}"`)
    }
  })

  it("writes route changes and targeted scope tombstones in the business transaction", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION mtm_mobile_sync_append_change")
    expect(migration).toContain("BEFORE DELETE ON \"mtm_routes\"")
    expect(migration).toContain("AFTER INSERT OR UPDATE ON \"mtm_routes\"")
    expect(migration).toContain("AFTER INSERT OR UPDATE OR DELETE ON \"mtm_route_points\"")
    expect(migration).toContain("AFTER INSERT OR UPDATE OR DELETE ON \"mtm_route_assignments\"")
    expect(migration).toContain("'SCOPE_REMOVED'")
    expect(migration).toContain('"audienceAgentId"')
    expect(migration).toContain("mtm_mobile_sync_route_visible_to_agent")
    expect(migration).toContain("mtm_mobile_sync_lock_route")
    expect(migration).toContain("mtm_mobile_sync_lock_route_pair")
    expect(migration).toContain("mtm_mobile_sync_assert_route_tenant")
    expect(migration).toContain("pg_advisory_xact_lock")
    expect(migration).toContain("mtm_mobile_sync_bump_agent_scope")
    expect(migration).toContain("cannot move across tenants")
    expect(migration).toContain("mtm route cannot move across tenants")
    expect(migration).toContain("mtm route child must belong to the same tenant")
    // Assignment loss is isolated to the revoked Field principal; unrelated
    // tenant devices never receive a scope revision bump.
    expect(migration).toContain("per-agent fence")
  })

  it("binds snapshots and their immutable items to the same tenant", () => {
    expect(migration).toContain('UNIQUE ("organizationId", "id")')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "snapshotId") REFERENCES "mtm_mobile_sync_snapshots"("organizationId", "id")')
    expect(migration).toContain('"mtm_mobile_sync_agent_scopes_stream_fkey"')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "stream") REFERENCES "mtm_mobile_sync_streams"("organizationId", "stream")')
  })

  it("uses an expiring tenant-scoped lease before materialising a snapshot", () => {
    expect(migration).toContain('CREATE TABLE "mtm_mobile_sync_snapshot_leases"')
    expect(migration).toContain('PRIMARY KEY ("organizationId", "stream", "agentId", "deviceId", "horizonKey")')
    expect(migration).toContain('"mtm_mobile_sync_snapshot_leases_stream_fkey"')
    expect(migration).toContain('"mtm_mobile_sync_snapshot_leases_expiresAt_idx"')
  })

  it("addresses every journal record to one actor before a delta is read", () => {
    expect(migration).toContain('"audienceAgentId" TEXT NOT NULL')
    expect(migration).toContain('"mtm_mobile_sync_changes_audience_agent_nonempty"')
    expect(migration).toContain("p_audience_agent_id TEXT,")
    expect(migration).toContain("mtm_mobile_sync_emit_route_tombstones")
    expect(migration).toContain("mtm_mobile_sync_emit_route_upserts")
    expect(migration).toContain("'SCOPE_OR_HORIZON_CHANGED'")
  })

  it("repairs both route projections when a point or assignment is transferred", () => {
    expect(migration).toContain('OLD."routeId" IS DISTINCT FROM NEW."routeId"')
    expect(migration).toContain("old viewers must receive an UPSERT without this point")
    expect(migration).toContain("NEW-only trigger leaves behind")
    expect(migration).toContain("SCOPE_REMOVED")
  })

  it("keeps tombstones beyond the approved offline horizon and has a recovery floor", () => {
    expect(migration).toContain("INTERVAL '14 days'")
    expect(migration).toContain('"retentionFloorRevision"')
    expect(migration).toContain('"mtm_mobile_sync_changes_organizationId_stream_revision_key"')
    expect(migration).toContain('"mtm_mobile_sync_snapshot_items_snapshotId_ordinal_key"')
  })

  it("keeps legacy-table index builds out of the transactional migration", () => {
    expect(migration).not.toContain('CREATE INDEX "mtm_routes_mobile_sync_v2_primary_idx"')
    expect(migration).not.toContain('CREATE INDEX "mtm_route_assignments_mobile_sync_v2_active_idx"')
    expect(migration).toContain("do NOT run inside this transactional migration")
    expect(rolloutRunbook).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS "mtm_routes_mobile_sync_v2_primary_idx"')
    expect(rolloutRunbook).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS "mtm_route_assignments_mobile_sync_v2_active_idx"')
  })
})
