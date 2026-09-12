import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260830173000_workforce_exception_case_subject_integrity/migration.sql",
), "utf8")

describe("Workforce C6 exception-case subject integrity migration", () => {
  it("requires linked evidence to belong to the same tenant employee and workday", () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION workforce_validate_exception_case_insert()')
    expect(migration).toContain('FROM "workforce_attendance_evidence" AS evidence')
    expect(migration).toContain("evidence must belong to its tenant employee")
    expect(migration).toContain("evidence must match its linked workday")
    expect(migration).toContain('COALESCE(event."agentId", transition."agentId")')
  })

  it("requires a day-linked segment to be present in that immutable schedule snapshot", () => {
    expect(migration).toContain('FROM "workforce_workday_schedule_snapshots" AS snapshot')
    expect(migration).toContain('jsonb_array_elements(snapshot."segments"::jsonb)')
    expect(migration).toContain("segment must be pinned in its employee workday snapshot")
    expect(migration).toContain('subject_workday_id := COALESCE(NEW."workdayId", linked_workday_id, evidence_workday_id)')
  })

  it("does not add a mutable case state, detector, or automated outcome", () => {
    expect(migration).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"workforce_exception_cases"/i)
    expect(migration).not.toMatch(/\b(?:payroll|disciplin)/i)
  })
})
