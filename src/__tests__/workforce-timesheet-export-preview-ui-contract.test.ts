import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const workbench = readFileSync("src/components/workforce/workforce-workbench.tsx", "utf8")

describe("Workforce approved-export preview UI boundary", () => {
  it("loads only a just-recorded immutable approval with the fixed HR purpose", () => {
    expect(workbench).toContain("if (!record || previewingExport) return")
    expect(workbench).toContain("encodeURIComponent(approvalId)")
    expect(workbench).toContain("/preview?purpose=HR_RECORD_REVIEW")
    expect(workbench).toContain('cache: "no-store"')
  })

  it("does not infer export permission from a browser role", () => {
    expect(workbench).not.toContain("canPreviewTimesheetExport")
    expect(workbench).toContain("timesheetExportCustodianRequired")
  })

  it("allowlist-parses the bounded scope, correction revision, rows and warnings", () => {
    expect(workbench).toContain("parseTimesheetExportPreview(result.data)")
    expect(workbench).toContain("TIMESHEET_EXPORT_WARNING_CODES")
    expect(workbench).toContain('siteScope !== "EXCLUDED_FROM_ORDINARY_EXPORT"')
    expect(workbench).toContain('delivery.artifactPersistence !== "NONE"')
    expect(workbench).toContain("value.rows.length !== scope.rowCount")
    expect(workbench).toContain("value.warningCodes.length !== TIMESHEET_EXPORT_WARNING_CODES.size")
    expect(workbench).toContain("row.agentId !== scope.employee.id")
    expect(workbench).toContain("approvedExportCorrectionRevision")
    expect(workbench).toContain("approvedExportSiteScopeExcluded")
    expect(workbench).toContain("approvedExportDirectSessionOnly")
  })
})
