import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260808080000_mtm_coverage_policy_snapshots/migration.sql",
), "utf8")

describe("SWM15 coverage policy snapshot migration", () => {
  it("enforces RLS on every new tenant table", () => {
    for (const table of [
      "mtm_coverage_policies",
      "mtm_coverage_snapshots",
      "mtm_coverage_snapshot_rows",
    ]) {
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`)
      expect(migration).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`)
    }
  })

  it("uses tenant-bound foreign keys even under service bypass", () => {
    expect(migration).toContain('FOREIGN KEY ("organizationId", "policyId")')
    expect(migration).toContain('REFERENCES "mtm_coverage_policies"("organizationId", "id")')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "snapshotId")')
    expect(migration).toContain('REFERENCES "mtm_coverage_snapshots"("organizationId", "id")')
  })

  it("allows only one active policy and coherent signed/frozen states", () => {
    expect(migration).toContain('WHERE "status" = \'ACTIVE\'')
    expect(migration).toContain('CONSTRAINT "mtm_cov_policy_signature_check"')
    expect(migration).toContain('CONSTRAINT "mtm_cov_snapshot_freeze_check"')
  })

  it("does not seed guessed policy formulas or screenshot totals", () => {
    expect(migration).not.toMatch(/INSERT\s+INTO/i)
  })
})
