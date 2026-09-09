import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260829114500_workforce_future_only_lifecycle/migration.sql",
), "utf8")

describe("Workforce future-only lifecycle migration", () => {
  it("allows only non-overlapping published policy windows", () => {
    expect(migration).toContain('DROP INDEX IF EXISTS "workforce_policies_one_active_org_key"')
    expect(migration).toContain('DROP INDEX IF EXISTS "workforce_policies_one_active_team_key"')
    expect(migration).toContain('ADD CONSTRAINT "workforce_policies_active_org_no_overlap"')
    expect(migration).toContain('ADD CONSTRAINT "workforce_policies_active_team_no_overlap"')
    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS btree_gist")
    expect(migration).toContain("EXCLUDE USING gist")
    expect(migration).toContain("daterange(\"effectiveFrom\", COALESCE(\"effectiveTo\" + 1, 'infinity'::date), '[)')")
    expect(migration).toContain('WHERE ("status" = \'ACTIVE\' AND "teamId" IS NULL)')
    expect(migration).toContain('WHERE ("status" = \'ACTIVE\' AND "teamId" IS NOT NULL)')
  })

  it("allows a future boundary but rejects rewrites that would exclude a fact", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION workforce_guard_published_policy_definition()")
    expect(migration).toContain("effective window can only be narrowed")
    expect(migration).toContain('FROM "workforce_policy_snapshots"')
    expect(migration).toContain('AND "workDate" > NEW."effectiveTo"')
    expect(migration).toContain("CREATE OR REPLACE FUNCTION workforce_guard_shift_assignment()")
    expect(migration).toContain('FROM "workforce_shift_snapshots"')
    expect(migration).toContain('AND "workDate" > NEW."effectiveTo"')
  })

  it("does not mutate tenant workdays or immutable Workforce facts", () => {
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(migration).not.toMatch(/\bUPDATE\s+"?(?:mtm_agent_workdays|workforce_(?:policy|shift)_snapshots|attendance_exceptions|timesheet_approvals)/i)
    expect(migration).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE)\b/i)
  })
})
