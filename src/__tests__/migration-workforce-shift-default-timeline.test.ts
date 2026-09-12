import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260830110000_workforce_shift_default_timeline/migration.sql",
), "utf8")

describe("Workforce shift default timeline migration", () => {
  it("adds a tenant-scoped effective timeline and binds an immutable snapshot to it", () => {
    expect(schema).toContain("model WorkforceShiftDefaultAssignment {")
    expect(schema).toContain("defaultAssignmentId")
    expect(migration).toContain('CREATE TABLE "workforce_shift_default_assignments"')
    expect(migration).toContain('ADD COLUMN "defaultAssignmentId" TEXT')
    expect(migration).toContain('workforce_shift_default_assignments_no_overlap')
    expect(migration).toContain('workforce_validate_shift_snapshot_default_assignment')
  })

  it("uses RLS and does not guess or backfill a historical isDefault window", () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('FORCE ROW LEVEL SECURITY')
    expect(migration).toContain("current_setting('app.org_id', true)")
    expect(migration).toMatch(/no historical default is guessed or backfilled/i)
    expect(migration).not.toMatch(/\bINSERT\s+INTO\s+"workforce_shift_default_assignments"/i)
  })
})
