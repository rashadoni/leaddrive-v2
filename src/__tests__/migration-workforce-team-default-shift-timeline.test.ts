import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260901080000_workforce_team_default_shift_timeline/migration.sql",
), "utf8")

describe("Workforce team default shift timeline migration", () => {
  it("adds a team-scoped effective timeline, immutable receipt and snapshot source link", () => {
    expect(schema).toContain("model WorkforceShiftTeamDefaultAssignment {")
    expect(schema).toContain("model WorkforceShiftTeamDefaultOperation {")
    expect(schema).toMatch(/teamDefaultAssignmentId\s+String\?/)
    expect(migration).toContain('CREATE TABLE "workforce_shift_team_default_assignments"')
    expect(migration).toContain('"teamId" TEXT NOT NULL')
    expect(migration).toContain('workforce_shift_team_default_assignments_no_overlap')
    expect(migration).toContain('CREATE TABLE "workforce_shift_team_default_operations"')
    expect(migration).toContain('ADD COLUMN "teamDefaultAssignmentId" TEXT')
    expect(migration).toContain('workforce_shift_snapshots_team_default_assignment_fkey')
  })

  it("requires active matching-team templates, workday-start membership and tenant isolation", () => {
    expect(migration).toContain('workforce_guard_shift_team_default_assignment')
    expect(migration).toContain('template_row."teamId" IS DISTINCT FROM NEW."teamId"')
    expect(migration).toContain('workforce_employee_team_memberships')
    expect(migration).toContain('Workforce shift snapshot team default must match immutable workday-start membership')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('FORCE ROW LEVEL SECURITY')
    expect(migration).toContain("current_setting('app.org_id', true)")
    expect(migration).not.toMatch(/\bINSERT\s+INTO\s+"workforce_shift_team_default_assignments"/i)
  })

  it("does not backfill team membership, employee assignments or raw proof", () => {
    expect(migration).toMatch(/No historical default or membership is inferred/i)
    expect(migration).not.toMatch(/"(latitude|longitude|qr|deviceId|evidenceId)"/i)
  })
})
