import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const workbench = readFileSync("src/components/workforce/workforce-workbench.tsx", "utf8")
const messages = ["en", "ru", "az"].map((locale) => (
  JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as {
    workforcePage: Record<string, unknown>
  }
))

describe("Workforce timesheet approval blocker UI contract", () => {
  it("validates and renders server-derived blocking rows", () => {
    expect(workbench).toContain("parseTimesheetApprovalBlockers(result.blockers)")
    expect(workbench).toContain("timesheetApprovalBlockingRows")
    expect(workbench).toContain("blocker.caseReference")
    expect(workbench).toContain("blocker.exceptionStage")
  })

  it("labels every blocker, exception type and lifecycle stage in all supported locales", () => {
    for (const { workforcePage } of messages) {
      expect(workforcePage.timesheetApprovalBlocker).toMatchObject({
        WORKDAY_NOT_FINAL: expect.any(String),
        SNAPSHOT_MISSING: expect.any(String),
        HISTORY_INVALID: expect.any(String),
        UNRESOLVED_EXCEPTION: expect.any(String),
      })
      expect(workforcePage.timesheetApprovalException).toMatchObject({
        NO_SHOW: expect.any(String),
        MISSED_FINISH: expect.any(String),
        DEVICE_SECURITY_REVIEW: expect.any(String),
      })
      expect(workforcePage.timesheetApprovalStage).toMatchObject({
        OPEN: expect.any(String),
        AWAITING_EMPLOYEE_RESPONSE: expect.any(String),
        HR_REVIEW: expect.any(String),
        DATA_INTEGRITY_REVIEW: expect.any(String),
      })
    }
  })
})
