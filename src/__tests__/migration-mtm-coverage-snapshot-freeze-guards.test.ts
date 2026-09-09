import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260808090000_mtm_coverage_snapshot_freeze_guards/migration.sql",
), "utf8")

describe("SWM15 frozen coverage snapshot guards", () => {
  it("makes frozen and failed snapshot envelopes terminal", () => {
    expect(migration).toContain('OLD."status" IN (\'FROZEN\', \'FAILED\')')
    expect(migration).toContain('BEFORE UPDATE ON "mtm_coverage_snapshots"')
    expect(migration).toContain("USING ERRCODE = 'check_violation'")
  })

  it("allows subject rows only while the tenant-bound parent is building", () => {
    expect(migration).toContain('WHERE "id" = NEW."snapshotId" AND "organizationId" = NEW."organizationId"')
    expect(migration).toContain("parent_status <> 'BUILDING'")
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON "mtm_coverage_snapshot_rows"')
  })
})
