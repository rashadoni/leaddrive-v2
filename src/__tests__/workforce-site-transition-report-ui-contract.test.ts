import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const component = readFileSync(
  "src/components/workforce/workforce-site-transition-report.tsx",
  "utf8",
)

describe("Workforce site-transition report UI boundary", () => {
  it("allowlist-parses and reconciles the complete server projection", () => {
    expect(component).toContain("parseReportData(result.data)")
    expect(component).not.toContain("result.data as ReportData")
    expect(component).toContain('report.source !== "APPEND_ONLY_SITE_TRANSITION_CLAIMS"')
    expect(component).toContain('report.boundaries.physicalPresence !== "CLAIMS_ARE_NOT_PHYSICAL_PRESENCE"')
    expect(component).toContain("bySite.reduce((sum, row) => sum + row[key], 0)")
    expect(component).toContain("byEmployee.reduce((sum, row) => sum + row[key], 0)")
  })

  it("keeps employee and site filters mutually exclusive", () => {
    expect(component).toContain('disabled={loading || filters.siteId !== ""}')
    expect(component).toContain('setFilters({ ...filters, agentId, siteId: "" })')
    expect(component).toContain('disabled={loading || filters.agentId !== ""}')
    expect(component).toContain('setFilters({ ...filters, siteId, agentId: "" })')
  })

  it("uses server-selected tenant dates and contains stale requests", () => {
    expect(component).toContain("useState<ReportFilter | null>(null)")
    expect(component).toContain("start: next.start, end: next.end")
    expect(component).toContain("if (!controller.signal.aborted) setLoading(false)")
    expect(component).toContain("controller.abort()")
  })

  it("provides keyboard-scrollable tables and 44px controls", () => {
    expect(component).toContain('role="region"')
    expect(component).toContain("tabIndex={0}")
    expect(component).toContain("min-h-11")
    expect(component).toContain('role="alert"')
  })
})
