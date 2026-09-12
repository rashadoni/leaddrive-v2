import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260830130000_workforce_employee_team_membership_history/migration.sql",
), "utf8")

describe("Workforce employee team-membership history migration", () => {
  it("adds tenant-scoped immutable membership facts and captures future directory changes", () => {
    expect(schema).toContain("model WorkforceEmployeeTeamMembership {")
    expect(schema).toContain("workforceTeamMemberships WorkforceEmployeeTeamMembership[]")
    expect(migration).toContain('CREATE TABLE "workforce_employee_team_memberships"')
    expect(migration).toContain('AFTER INSERT OR UPDATE OF "teamId" ON "mtm_agents"')
    expect(migration).toContain("workforce_reject_employee_team_membership_mutation")
    expect(migration).toContain("workforce_employee_team_memberships_agent_effective_key")
  })

  it("does not invent pre-migration history and rebinds snapshots to workday-start membership", () => {
    expect(migration).toMatch(/only from the migration instant onward/i)
    expect(migration).toMatch(/must not be resolved from current team/i)
    expect(migration).toContain("workforce_validate_policy_snapshot_team_history")
    expect(migration).toContain("workforce_validate_shift_snapshot_team_history")
    expect(migration).toContain("workforce_validate_workday_schedule_snapshot")
    expect(migration).toContain('"effectiveAt" <= workday_row."startedAt"')
    expect(migration).toContain('ALTER COLUMN "schemaVersion" SET DEFAULT 2')
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS "workforce_workday_schedule_snapshots_shape_check"')
    expect(migration).toContain('ADD CONSTRAINT "workforce_workday_schedule_snapshots_shape_check" CHECK')
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY")
    expect(migration).toContain("FORCE ROW LEVEL SECURITY")
  })
})
