import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260828224500_workforce_h3_legacy_fact_guard/migration.sql",
), "utf8")
const requestDecision = readFileSync(join(root, "src/lib/workforce/request-decision.ts"), "utf8")

describe("Workforce H3 legacy fact guard migration", () => {
  it("makes canonical workday events append-only and denies ordinary deletes", () => {
    expect(migration).toContain('CREATE TRIGGER workforce_workday_events_append_only')
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "mtm_agent_workday_events"')
    expect(migration).toContain('workforce_reject_immutable_mutation()')
    expect(migration).toContain('CREATE POLICY workforce_workday_events_tenant_select')
    expect(migration).toContain('CREATE POLICY workforce_workday_events_tenant_insert')
    expect(migration).not.toContain('FOR DELETE')
  })

  it("allows a completed workday change only through the current correction ledger fact", () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION workforce_guard_completed_workday()')
    expect(migration).toContain("current_setting('app.workforce_correction_id', true)")
    expect(migration).toContain('CREATE OR REPLACE FUNCTION workforce_workday_fact_matches(')
    expect(migration).toContain("(facts->>'startedAt')::timestamptz AT TIME ZONE 'UTC'")
    expect(migration).toContain('workforce_workday_fact_matches(correction_row."beforeFacts", OLD)')
    expect(migration).toContain('workforce_workday_fact_matches(correction_row."afterFacts", NEW)')
    expect(migration).toContain('Completed Workforce workday cannot reopen or become invalid')
    expect(migration).toContain('CREATE POLICY workforce_workdays_tenant_update')
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE)\s+TABLE\b/i)
  })

  it("sets the transaction-local correction id before mutating the legacy projection", () => {
    const ledgerWrite = requestDecision.indexOf("const correction = await tx.workforceTimeCorrection.create")
    const correctionContext = requestDecision.indexOf("set_config('app.workforce_correction_id'")
    const legacyUpdate = requestDecision.indexOf("await tx.mtmAgentWorkday.update")

    expect(ledgerWrite).toBeGreaterThanOrEqual(0)
    expect(correctionContext).toBeGreaterThan(ledgerWrite)
    expect(legacyUpdate).toBeGreaterThan(correctionContext)
    expect(requestDecision).toContain("set_config('TimeZone', 'UTC', true)")
    expect(requestDecision).toContain('lockMtmWorkdayTransitions(tx, { organizationId, agentId: request.agentId })')
  })
})
