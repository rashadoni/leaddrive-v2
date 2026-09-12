import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260831113000_workforce_exception_correction_request_link/migration.sql",
), "utf8")

describe("Workforce C6 immutable correction-request exception link migration", () => {
  it("adds only an optional tenant-scoped request source link", () => {
    const requestSchema = schema.slice(
      schema.indexOf("model MtmHrmRequest {"),
      schema.indexOf("\n// A tenant-owned work location/context", schema.indexOf("model MtmHrmRequest {")),
    )
    const caseSchema = schema.slice(
      schema.indexOf("model WorkforceExceptionCase {"),
      schema.indexOf("\n/// One append-only accountable action", schema.indexOf("model WorkforceExceptionCase {")),
    )

    expect(requestSchema).toMatch(/exceptionCaseId\s+String\?/)
    expect(requestSchema).toContain('WorkforceExceptionCorrectionRequest')
    expect(requestSchema).toContain('@@index([organizationId, exceptionCaseId])')
    expect(caseSchema).toContain('correctionRequests MtmHrmRequest[]')
    expect(migration).toContain('ADD COLUMN "exceptionCaseId" TEXT')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "exceptionCaseId")')
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE)\s+(?:TABLE|TYPE)\b/i)
  })

  it("requires the exact employee case/workday and prevents link reassignment", () => {
    expect(migration).toContain("NEW.\"type\"::TEXT <> 'TIME_CORRECTION'")
    expect(migration).toContain('case_agent_id <> NEW."agentId"')
    expect(migration).toContain('case_workday_id <> NEW."correctionWorkdayId"')
    expect(migration).toContain('OLD."exceptionCaseId" IS DISTINCT FROM NEW."exceptionCaseId"')
    expect(migration).toContain('CREATE TRIGGER workforce_hrm_requests_validate_exception_link')
  })
})
