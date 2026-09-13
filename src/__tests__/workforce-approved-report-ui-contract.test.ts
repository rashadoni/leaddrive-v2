import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const report = readFileSync("src/components/workforce/workforce-approved-report.tsx", "utf8")

describe("Workforce approved-time report UI boundary", () => {
  it("uses the server-selected tenant period for its first request", () => {
    expect(report).toContain("useState<ReportFilter | null>(null)")
    expect(report).toContain("return { ...current, start: nextData.report.start, end: nextData.report.end }")
    expect(report).toContain('t("approvedReportTimezone", { timezone: data.timezone })')
  })

  it("applies only a server-validated employee ID from the scoped report options", () => {
    expect(report).toContain('parameters.set("agentId", applied.agentId)')
    expect(report).toContain('id="workforce-report-agent"')
    expect(report).toContain('t("approvedReportAllEmployees")')
    expect(report).toContain("setEmployeeOptions(nextData.report.byEmployee.map")
  })

  it("allowlist-parses and reconciles every immutable aggregate before rendering", () => {
    expect(report).toContain("parseApprovedReportData(result.data)")
    expect(report).not.toContain("result.data as ReportData")
    expect(report).toContain('report.source !== "HASH_VERIFIED_IMMUTABLE_APPROVALS"')
    expect(report).toContain("report.summary.employees !== byEmployee.length")
    expect(report).toContain("byEmployee.reduce((sum, employee) => sum + employee[key], 0)")
    expect(report).toContain('report.unavailable.siteTransitions !== "EXCLUDED_FROM_APPROVED_TIMESHEET_FACTS"')
  })

  it("does not surface server error detail or raw proof vocabulary", () => {
    expect(report).toContain('setError(t("approvedReportLoadFailed"))')
    expect(report).not.toContain("result.error")
    expect(report).not.toMatch(/latitude|longitude|rawEnvelopeCiphertext|qrToken|devicePublicKey|decisionNote/)
  })
})
