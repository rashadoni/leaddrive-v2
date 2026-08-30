import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260830120000_workforce_workday_schedule_snapshots/migration.sql",
), "utf8")

describe("Workforce workday schedule snapshot migration", () => {
  it("binds one immutable calendar/segment/site context to the existing policy and shift facts", () => {
    expect(schema).toContain("model WorkforceWorkdayScheduleSnapshot {")
    expect(schema).toContain("calendarSnapshot Json")
    expect(schema).toContain("segments         Json")
    expect(schema).toContain("sites            Json")
    expect(migration).toContain('CREATE TABLE "workforce_workday_schedule_snapshots"')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "policySnapshotId") REFERENCES "workforce_policy_snapshots"')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "shiftSnapshotId") REFERENCES "workforce_shift_snapshots"')
    expect(migration).toContain("workforce_validate_workday_schedule_snapshot")
    expect(migration).toContain("workforce_reject_workday_schedule_snapshot_mutation")
  })

  it("is tenant-RLS-protected and does not reconstruct historical pairs in SQL", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY")
    expect(migration).toContain("FORCE ROW LEVEL SECURITY")
    expect(migration).toContain("current_setting('app.org_id', true)")
    expect(migration).toMatch(/Existing policy\/shift snapshot pairs are deliberately\s+-- left untouched/i)
    expect(migration).not.toMatch(/\bINSERT\s+INTO\s+"workforce_workday_schedule_snapshots"/i)
  })
})
