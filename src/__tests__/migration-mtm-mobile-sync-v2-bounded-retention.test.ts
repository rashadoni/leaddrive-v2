import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260829120000_mtm_mobile_sync_v2_bounded_retention/migration.sql",
), "utf8")
const rolloutRunbook = readFileSync(join(
  process.cwd(),
  "docs/mobile-sync-v2-rollout-runbook.md",
), "utf8")

describe("MTM mobile sync v2 bounded-retention migration", () => {
  it("is additive and does not alter v1 idempotency or Field mutation state", () => {
    expect(migration).toContain('CREATE TABLE "mtm_mobile_sync_retention_cursors"')
    expect(migration).not.toContain('"mtm_sync_operations"')
    expect(migration).not.toContain('DELETE FROM "mtm_sync_operations"')
    expect(migration).not.toContain("DROP TABLE")
  })

  it("seeds each schema-before-code cursor and makes it bypass-only under forced RLS", () => {
    for (const jobName of ["changes", "snapshots", "leases"]) {
      expect(migration).toContain(`('${jobName}')`)
    }
    expect(migration).toContain('ALTER TABLE "mtm_mobile_sync_retention_cursors" ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE "mtm_mobile_sync_retention_cursors" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain("CREATE POLICY mtm_mobile_sync_retention_cursor_bypass_only")
    expect(migration).toContain("current_setting('app.rls_bypass', true) = 'on'")
    expect(migration).not.toContain("app.org_id")
  })

  it("keeps live-table indexes out of the transactional migration and names concurrent rollout commands", () => {
    expect(migration).not.toMatch(/^CREATE INDEX/m)
    for (const indexName of [
      "mtm_mobile_sync_changes_retention_scan_idx",
      "mtm_mobile_sync_snapshots_retention_scan_idx",
      "mtm_mobile_sync_snapshot_leases_retention_scan_idx",
    ]) {
      expect(rolloutRunbook).toContain(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${indexName}"`)
      expect(rolloutRunbook).toContain(`'${indexName}'::regclass`)
    }
    expect(rolloutRunbook).toContain("before deploying any code that calls")
    expect(rolloutRunbook).toContain("/api/cron/mtm-cleanup")
  })
})
