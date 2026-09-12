import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260830020000_workforce_c1_review_cases/migration.sql",
), "utf8")

describe("Workforce C1 delayed-claim review migration", () => {
  it("keeps legacy evidence unknown and gives new delayed claims a tenant-scoped review case", () => {
    const eventSchema = schema.slice(
      schema.indexOf("model MtmAgentWorkdayEvent {"),
      schema.indexOf("model MtmAgentWorkdayEvent {") + 2_500,
    )
    const reviewSchema = schema.slice(schema.indexOf("model WorkforceAttendanceReviewCase {"))

    expect(schema).toMatch(/enum WorkforceAttendanceClaimReviewState\s*{[\s\S]*?LEGACY_UNKNOWN\s*NOT_REQUIRED\s*PENDING_REVIEW\s*}/)
    expect(eventSchema).toMatch(/attendanceReviewState\s+WorkforceAttendanceClaimReviewState\s+@default\(LEGACY_UNKNOWN\)/)
    expect(eventSchema).toMatch(/attendanceReviewReasonCode\s+String\?\s+@db\.VarChar\(64\)/)
    expect(reviewSchema).toMatch(/workdayEventId\s+String/)
    expect(reviewSchema).toMatch(/@@unique\(\[organizationId, workdayEventId\]\)/)
    expect(migration).toContain("'LEGACY_UNKNOWN'")
    expect(migration).toContain('CREATE TABLE "workforce_attendance_review_cases"')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "workdayEventId")')
  })

  it("requires a pending immutable event match and does not rewrite historical attendance", () => {
    expect(migration).toContain('event_row."attendanceReviewState" <> \'PENDING_REVIEW\'')
    expect(migration).toContain('CREATE TRIGGER workforce_attendance_review_cases_validate_insert')
    expect(migration).toContain('CREATE TRIGGER workforce_attendance_review_cases_append_only')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('FORCE ROW LEVEL SECURITY')
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE)\s+"mtm_agent_workday_events"/i)
  })
})
