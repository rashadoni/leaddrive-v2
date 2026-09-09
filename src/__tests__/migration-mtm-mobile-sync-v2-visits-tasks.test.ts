import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260829100000_mtm_mobile_sync_v2_visits_tasks_readonly/migration.sql",
), "utf8")
const rolloutRunbook = readFileSync(join(
  process.cwd(), "docs/mobile-sync-v2-rollout-runbook.md"), "utf8")

describe("MTM mobile sync v2 visits/tasks read-only migration", () => {
  it("is additive to v1 and reuses the already RLS-protected v2 journal", () => {
    expect(migration).not.toContain('ALTER TABLE "mtm_sync_operations"')
    expect(migration).not.toContain('DROP TABLE "mtm_sync_operations"')
    expect(migration).not.toContain('CREATE TABLE "mtm_mobile_sync')
    expect(migration).toContain("Protocol v1 pull/push, idempotency rows and all mutations stay")
  })

  it("records only primary-agent active visits/tasks and never adds participant or event payload triggers", () => {
    expect(migration).toContain("'visits', 'UPSERT', 'visit'")
    expect(migration).toContain("'tasks', 'UPSERT', 'task'")
    expect(migration).toContain('v."status" = \'CHECKED_IN\'')
    expect(migration).toContain("t.\"status\" IN ('PENDING', 'IN_PROGRESS', 'OVERDUE')")
    expect(migration).not.toContain('ON "mtm_visit_participants"')
    expect(migration).not.toContain('ON "mtm_task_events"')
    expect(migration).toContain("Participant workspaces remain on the existing v1")
  })

  it("emits a targeted tombstone and scope fence for deletion, horizon exit and reassignment", () => {
    for (const table of ["mtm_visits", "mtm_tasks"]) {
      expect(migration).toContain(`BEFORE DELETE ON "${table}"`)
      expect(migration).toContain(`AFTER INSERT OR UPDATE ON "${table}"`)
    }
    expect(migration).toContain("'DELETED'")
    expect(migration).toContain("'SCOPE_REMOVED'")
    expect(migration).toContain("'HORIZON_EXIT'")
    expect(migration).toContain("mtm_mobile_sync_bump_agent_scope")
    expect(migration).toContain("pg_advisory_xact_lock")
  })

  it("fails closed on a tenant move and keeps legacy-table indexes out of the transaction", () => {
    expect(migration).toContain("mtm visit cannot move across tenants")
    expect(migration).toContain("mtm task cannot move across tenants")
    expect(migration).not.toContain("CREATE INDEX")
    expect(rolloutRunbook).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS "mtm_visits_mobile_sync_v2_primary_idx"')
    expect(rolloutRunbook).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS "mtm_tasks_mobile_sync_v2_primary_idx"')
  })
})
