import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260829010000_workforce_current_team_shift_resolution/migration.sql",
), "utf8")
const h3Foundation = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260828223000_workforce_h3_foundation/migration.sql",
), "utf8")
const policyMigration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260829000000_workforce_current_team_policy_resolution/migration.sql",
), "utf8")

describe("Workforce current-team shift resolution migration", () => {
  it("rebinds only the shift insert validator for a selected team default", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION workforce_validate_shift_snapshot_current_team()")
    expect(migration).toContain("CREATE OR REPLACE TRIGGER workforce_shift_snapshots_validate_insert")
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION workforce_validate_h3_insert()")
    expect(migration).not.toContain("workforce_policy_snapshots_validate_insert")
    expect(migration).toContain('NEW."assignmentId" IS NULL AND template_row."teamId" IS NOT NULL')
    expect(migration).toContain('FROM "mtm_agents"')
    expect(migration).toContain("FOR SHARE")
    expect(migration).toContain('template_row."teamId" IS DISTINCT FROM current_team_id')
    expect(migration).toContain("Team-scoped default Workforce shift must match the employee current team at server processing")
    expect(migration).toContain("Team-scoped default Workforce shift must be active at server processing")
    expect(migration).toContain('template_row."activatedAt" > (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\')')
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(migration).not.toMatch(/\bUPDATE\s+"/i)
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(migration).not.toMatch(/\bTRUNCATE\s+(?:TABLE\s+)?"/i)
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|INDEX|TYPE|CONSTRAINT)\b/i)
  })

  it("preserves historical organization-default and explicit-assignment validation", () => {
    expect(migration).toContain('IF NEW."assignmentId" IS NOT NULL THEN')
    expect(migration).toContain('assignment_row."effectiveFrom" > NEW."workDate"')
    expect(migration).toContain('workday_row."startedAt" < template_row."activatedAt"')
    expect(migration).toContain("The owner decision")
    expect(h3Foundation).toContain("Team-scoped default Workforce shift resolution requires an explicit historical team rule")
    expect(policyMigration).not.toContain("workforce_shift_snapshots_validate_insert")
  })
})
