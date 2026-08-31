import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260901003000_workforce_no_show_expected_date/migration.sql",
), "utf8")

describe("Workforce C6 no-show expected-date migration", () => {
  it("adds an additive immutable expected date only for a segment-only subject", () => {
    expect(migration).toContain('ADD COLUMN "expectedWorkDate" DATE')
    expect(migration).toContain('"expectedWorkDate" IS NULL OR (')
    expect(migration).toContain('"segmentId" IS NOT NULL')
    expect(migration).toContain('"workdayId" IS NULL')
    expect(migration).toContain('"workdayEventId" IS NULL')
    expect(migration).toContain('"evidenceId" IS NULL')
    expect(migration).toContain('CREATE INDEX "workforce_exception_cases_org_expected_date_idx"')
  })

  it("retains the tenant/employee/evidence and immutable snapshot validation boundary", () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION workforce_validate_exception_case_insert()')
    expect(migration).toContain('evidence must belong to its tenant employee')
    expect(migration).toContain('segment must be pinned in its employee workday snapshot')
    expect(migration).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"workforce_exception_cases"/i)
    expect(migration).not.toMatch(/\b(?:payroll|disciplin|notification)\b/i)
  })
})
