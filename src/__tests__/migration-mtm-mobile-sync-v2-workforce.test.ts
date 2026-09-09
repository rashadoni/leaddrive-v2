import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260829110000_mtm_mobile_sync_v2_workforce_workdays_readonly/migration.sql",
), "utf8")

describe("MTM mobile sync v2 active-workday workforce migration", () => {
  it("is additive to v1 workday/HRM authority and reuses the protected v2 journal", () => {
    expect(migration).not.toContain('ALTER TABLE "mtm_sync_operations"')
    expect(migration).not.toContain('DROP TABLE "mtm_sync_operations"')
    expect(migration).not.toContain('CREATE TABLE "mtm_mobile_sync')
    expect(migration).toContain("does not alter protocol-v1 workforce pull/push")
    expect(migration).toContain("v1 retains all write authority")
  })

  it("journals only active own workdays and never adds HRM/event payload triggers", () => {
    expect(migration).toContain("'workforce', 'UPSERT', 'workday'")
    expect(migration).toContain("'STARTED'::\"MtmWorkdayStatus\"")
    expect(migration).toContain("'PAUSED'::\"MtmWorkdayStatus\"")
    expect(migration).not.toContain('ON "mtm_hrm_requests"')
    expect(migration).not.toContain('ON "mtm_agent_workday_events"')
    expect(migration).toContain("no GPS coordinates, event notes, completed history")
  })

  it("uses a targeted tombstone and scope fence for close, deletion and reassignment", () => {
    expect(migration).toContain('BEFORE DELETE ON "mtm_agent_workdays"')
    expect(migration).toContain('AFTER INSERT OR UPDATE ON "mtm_agent_workdays"')
    expect(migration).toContain("'DELETED'")
    expect(migration).toContain("'SCOPE_REMOVED'")
    expect(migration).toContain("'ACTIVE_STATE_EXIT'")
    expect(migration).toContain("mtm_mobile_sync_bump_agent_scope")
    expect(migration).toContain("pg_advisory_xact_lock")
  })

  it("fails closed on a tenant move and leaves legacy indexing to a staged EXPLAIN", () => {
    expect(migration).toContain("mtm workday cannot move across tenants")
    expect(migration).not.toContain("CREATE INDEX")
    expect(migration).toContain("Reassess with EXPLAIN on staging")
  })
})
