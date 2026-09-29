import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const workbench = readFileSync("src/components/workforce/workforce-workbench.tsx", "utf8")
const route = readFileSync("src/app/api/v1/workforce/timesheet/route.ts", "utf8")
const messages = ["en", "ru", "az"].map((locale) => (
  JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as {
    workforcePage: Record<string, unknown>
  }
))

describe("Workforce complete timesheet UI contract", () => {
  it("renders plan, fact, evidence review, exceptions and verified immutable revisions", () => {
    for (const marker of [
      "calculation.plan.plannedStartAt",
      "calculation.fact.workedSeconds",
      "row.review.evidenceReview.state",
      "row.review.exceptions.map",
      "data.approvalHistory.revisions.map",
      "timesheetRevisionHistoryVerified",
    ]) expect(workbench).toContain(marker)
  })

  it("keeps approval readiness bound to final reproducible server facts", () => {
    expect(workbench).toContain('row.status === "COMPLETED" && row.calculationStatus === "WORKFORCE_TIMESHEET_CALCULATED"')
    expect(workbench).toContain("snapshotMissing")
    expect(workbench).toContain("historyInvalid")
    expect(workbench).not.toContain("physicalPresence")
  })

  it("uses minimized tenant-scoped reads and excludes sensitive revision fields from the response model", () => {
    expect(route).toContain('where: { organizationId: auth.orgId, workdayId: { in: workdayIds } }')
    expect(route).toContain("select: { workdayId: true, attendanceReviewState: true }")
    expect(route).toContain("summarizeWorkforceTimesheetApprovalRevisions(approvalRevisions)")
    expect(route).toContain("MAX_TIMESHEET_APPROVAL_REVISIONS + 1")
    expect(workbench).not.toContain("approvalHistory.correctionReason")
    expect(workbench).not.toContain("approvalHistory.approvedByUserId")
    expect(workbench).not.toContain("approvalHistory.rowsHash")
  })

  it("has equivalent finite review and revision labels in every supported locale", () => {
    for (const { workforcePage } of messages) {
      expect(workforcePage.timesheetEvidenceReviewState).toMatchObject({
        NOT_RECORDED: expect.any(String),
        NOT_REQUIRED: expect.any(String),
        PENDING_REVIEW: expect.any(String),
        LEGACY_UNKNOWN: expect.any(String),
      })
      expect(workforcePage.timesheetExceptionStatus).toMatchObject({
        OPEN: expect.any(String),
        ACKNOWLEDGED: expect.any(String),
        AWAITING_EMPLOYEE_RESPONSE: expect.any(String),
        HR_REVIEW: expect.any(String),
        RESOLVED: expect.any(String),
        DATA_INTEGRITY_REVIEW: expect.any(String),
      })
      for (const key of [
        "evidenceReview",
        "timesheetExceptions",
        "timesheetRevisionHistoryTitle",
        "timesheetRevisionHistoryHint",
        "timesheetRevisionHistoryVerified",
        "timesheetNoApprovalRevisions",
        "timesheetApprovalRevision",
        "timesheetCorrectionRevision",
        "timesheetCalculationVersion",
      ]) expect(workforcePage[key]).toEqual(expect.any(String))
    }
  })
})
