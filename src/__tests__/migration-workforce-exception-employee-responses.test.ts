import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260830200000_workforce_exception_employee_responses/migration.sql",
), "utf8")

describe("Workforce C6 immutable employee response migration", () => {
  it("adds a tenant-scoped exact-case/workday/segment response reference", () => {
    const start = schema.indexOf("model WorkforceExceptionEmployeeResponse {")
    const responseSchema = schema.slice(start, schema.indexOf("\nmodel MtmMessageThread", start))

    expect(responseSchema).toMatch(/caseId\s+String/)
    expect(responseSchema).toMatch(/workdayId\s+String/)
    expect(responseSchema).toMatch(/segmentId\s+String\?/)
    expect(responseSchema).toMatch(/correctionRequestId\s+String\?/)
    expect(responseSchema).toMatch(/@@unique\(\[organizationId, agentId, clientResponseId\]\)/)
    expect(migration).toContain('CREATE TABLE "workforce_exception_employee_responses"')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "caseId")')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "workdayId")')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "segmentId")')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "correctionRequestId")')
    expect(migration).toContain('CREATE TRIGGER workforce_exception_employee_responses_validate_insert')
  })

  it("admits only acknowledgement/correction links and preserves append-only tenant isolation", () => {
    expect(migration).toContain("'ACKNOWLEDGED', 'CORRECTION_REQUESTED'")
    expect(migration).toContain('workforce_exception_employee_responses_request_shape_check')
    expect(migration).toContain('CREATE TRIGGER workforce_exception_employee_responses_append_only')
    expect(migration).toContain('ALTER TABLE "workforce_exception_employee_responses" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('CREATE POLICY workforce_exception_employee_responses_tenant_insert')
    expect(migration).not.toMatch(/\b(?:TRUNCATE|DROP)\s+(?:TABLE|TYPE)\b/i)
  })

  it("uses the linked employee user and exact correction-workday check rather than a caller-supplied owner", () => {
    const start = schema.indexOf("model WorkforceExceptionEmployeeResponse {")
    const responseSchema = schema.slice(start, schema.indexOf("\nmodel MtmMessageThread", start))

    expect(migration).toContain('linked_user_id <> NEW."actorUserId"')
    expect(migration).toContain('request_agent_id <> NEW."agentId"')
    expect(migration).toContain('request_workday_id <> NEW."workdayId"')
    expect(responseSchema).not.toMatch(/reason|latitude|longitude|qr|device/i)
  })
})
