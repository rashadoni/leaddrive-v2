import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260830170000_workforce_exception_case_lifecycle/migration.sql",
), "utf8")

describe("Workforce C6 exception case/decision migration", () => {
  it("adds tenant-scoped immutable cases with explicit safe subject links", () => {
    const caseSchema = schema.slice(schema.indexOf("model WorkforceExceptionCase {"))

    expect(caseSchema).toMatch(/deduplicationKey\s+String\s+@db\.VarChar\(64\)/)
    expect(caseSchema).toMatch(/workdayEventId\s+String\?/) // immutable claim link
    expect(caseSchema).toMatch(/evidenceId\s+String\?/) // restricted evidence link
    expect(caseSchema).toMatch(/segmentId\s+String\?/) // published schedule segment link
    expect(caseSchema).toMatch(/@@unique\(\[organizationId, deduplicationKey\]\)/)
    expect(migration).toContain('CREATE TABLE "workforce_exception_cases"')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "workdayEventId")')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "evidenceId")')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "segmentId")')
    expect(migration).toContain('CREATE TRIGGER workforce_exception_cases_validate_insert')
  })

  it("keeps case facts and manager decisions append-only with RLS", () => {
    const decisionSchema = schema.slice(schema.indexOf("model WorkforceExceptionDecision {"))

    expect(decisionSchema).toMatch(/operationId\s+String\s+@db\.VarChar\(100\)/)
    expect(decisionSchema).toMatch(/reason\s+String\s+@db\.VarChar\(1000\)/)
    expect(decisionSchema).toMatch(/@@unique\(\[organizationId, operationId\]\)/)
    expect(migration).toContain('CREATE TRIGGER workforce_exception_cases_append_only')
    expect(migration).toContain('CREATE TRIGGER workforce_exception_decisions_append_only')
    expect(migration).toContain('ALTER TABLE "workforce_exception_cases" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE "workforce_exception_decisions" FORCE ROW LEVEL SECURITY')
    expect(migration).not.toMatch(/\b(?:TRUNCATE|DROP)\s+(?:TABLE|TYPE)\b/i)
  })
})
