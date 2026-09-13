import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const schema = readFileSync("prisma/schema.prisma", "utf8")
const migration = readFileSync("prisma/migrations/20260830160000_workforce_time_decision_retention_hold/migration.sql", "utf8")

describe("Workforce legal-hold migration contract", () => {
  it("adds a tenant-wide time/decision hold with an immutable one-way release", () => {
    expect(schema).toContain("model WorkforceLegalHold")
    expect(schema).toContain("enum WorkforceLegalHoldScope")
    expect(schema).toContain("enum WorkforceLegalHoldStatus")
    expect(schema).toContain("scope             WorkforceLegalHoldScope   @default(TIME_DECISION)")
    expect(schema).toContain("status            WorkforceLegalHoldStatus  @default(ACTIVE)")
    expect(migration).toContain('CREATE TABLE "workforce_legal_holds"')
    expect(migration).toContain("workforce_guard_legal_hold_mutation")
    expect(migration).toContain("'Workforce legal hold cannot be deleted'")
    expect(migration).toContain('NEW."status" = \'RELEASED\'')
  })

  it("enables forced RLS and does not introduce a retention delete executor", () => {
    expect(migration).toContain('ALTER TABLE "workforce_legal_holds" ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE "workforce_legal_holds" FORCE ROW LEVEL SECURITY')
    expect(migration).not.toMatch(/DELETE FROM\s+"?(?:mtm_agent_workdays|mtm_agent_workday_events|mtm_hrm_requests|workforce_time_corrections|workforce_timesheet_approvals)/i)
  })
})
