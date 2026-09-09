import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260829000000_workforce_current_team_policy_resolution/migration.sql",
), "utf8")
const h3Foundation = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260828223000_workforce_h3_foundation/migration.sql",
), "utf8")

describe("Workforce current-team policy resolution migration", () => {
  it("replaces only the insert validator and uses the team current at server processing", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION workforce_validate_policy_snapshot_current_team()")
    expect(migration).toContain("CREATE OR REPLACE TRIGGER workforce_policy_snapshots_validate_insert")
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION workforce_validate_h3_insert()")
    expect(migration).not.toContain("workforce_shift_snapshots_validate_insert")
    expect(migration).toContain('FROM "mtm_agents"')
    expect(migration).toContain("FOR SHARE")
    expect(migration).toContain('policy_row."teamId" IS DISTINCT FROM current_team_id')
    expect(migration).toContain("Team-scoped Workforce policy must match the employee current team at server processing")
    expect(migration).toContain("Team-scoped Workforce policy must be active at server processing")
    expect(migration).toContain("Organization Workforce policy cannot bypass an applicable current-team policy")
    expect(migration).toContain('team_policy."activatedAt" <= (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\')')
    expect(migration).toContain('policy_row."activatedAt" > (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\')')
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(migration).not.toMatch(/\bUPDATE\s+"/i)
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(migration).not.toMatch(/\bTRUNCATE\s+(?:TABLE\s+)?"/i)
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|INDEX|TYPE|CONSTRAINT)\b/i)
  })

  it("does not extend the transfer rule to unapproved default team shifts", () => {
    expect(h3Foundation).toContain("Team-scoped default Workforce shift resolution requires an explicit historical team rule")
    expect(migration).not.toContain("workforce_shift_snapshots_validate_insert")
  })
})
