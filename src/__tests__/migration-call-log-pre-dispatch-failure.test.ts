import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260810190000_call_log_pre_dispatch_failure_terminal/migration.sql",
  ),
  "utf8",
)

describe("pre-dispatch call failure backfill", () => {
  it("closes only attempts the provider never accepted", () => {
    // Without a provider call id nothing reached the provider, so there is no
    // in-flight call to protect and no redial risk. An attempt that did reach
    // the provider must keep its fence.
    expect(migration).toContain('cl."providerCallId" IS NULL')
    expect(migration).toContain("cl.\"status\" = 'failed'")
    expect(migration).toContain("cl.\"direction\" = 'outbound'")
    expect(migration).toContain('cl."providerOutcome" IS NULL')
    expect(migration).toContain('cl."endedAt" IS NULL')
  })

  it("writes exactly the terminal shape the dispatch path already writes", () => {
    expect(migration).toContain("\"providerOutcome\" = 'failed'")
    // A July attempt must not be stamped with a fresh end time.
    expect(migration).toContain('"endedAt" = COALESCE(cl."startedAt", cl."createdAt")')
    expect(migration).not.toMatch(/"endedAt"\s*=\s*(now\(\)|CURRENT_TIMESTAMP)/i)
  })

  it("survives forced tenant RLS and restores the original state", () => {
    // Migrations run without app.org_id, so a plain UPDATE would silently match
    // zero rows under fail-closed tenant RLS.
    expect(migration).toContain("SELECT relrowsecurity, relforcerowsecurity")
    expect(migration).toContain('ALTER TABLE "call_logs" DISABLE ROW LEVEL SECURITY')
    expect(migration).toContain("IF had_rls THEN")
    expect(migration).toContain("IF had_force_rls THEN")
    expect(migration).toContain('FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('NO FORCE ROW LEVEL SECURITY')
  })

  it("fails the deploy instead of leaving rows behind", () => {
    expect(migration).toContain("RAISE EXCEPTION")
    expect(migration).toContain("remaining_count")
  })
})
