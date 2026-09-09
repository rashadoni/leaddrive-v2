import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const ui = readFileSync("src/components/mtm/operational-week-home.tsx", "utf8")

describe("SWM-15A operational-week base coverage UI contract", () => {
  it("requests the selected calendar month and employee scope", () => {
    expect(ui).toContain("function monthWindow(dateKey: string)")
    expect(ui).toContain("periodStart: period.start")
    expect(ui).toContain("periodEnd: period.end")
    expect(ui).toContain('`/api/v1/mtm/coverage?${params.toString()}`')
    expect(ui).toContain('const agentId = facts?.selectedAgent.id || ""')
  })

  it("renders signed frozen totals without deriving screenshot metrics in the browser", () => {
    expect(ui).toContain('data-testid="mtm-base-coverage"')
    expect(ui).toContain('baseCoveragePhase === "ready" && baseCoverage?.available && baseCoverage.totals')
    expect(ui).toContain("baseCoverage.totals.groups.map")
    expect(ui).toContain("group.labels?.[baseCoverageLabelLocale] || group.label")
    expect(ui).toContain("group.requiredCoverage")
    expect(ui).toContain("group.actualMoi")
    expect(ui).toContain("group.target")
    expect(ui).toContain("group.actualCoverage")
    expect(ui).toContain("group.uncoveredMoi")
    expect(ui).not.toMatch(/requiredCoverage\s*-\s*(?:group\.)?actualCoverage/)
  })

  it("withholds values for every policy and snapshot integrity failure", () => {
    for (const state of [
      "UNSIGNED_COVERAGE_POLICY",
      "NO_COVERAGE_SNAPSHOT",
      "COVERAGE_POLICY_SIGNATURE_INVALID",
      "COVERAGE_SNAPSHOT_INCOMPLETE",
    ]) {
      expect(ui).toContain(state)
    }
    expect(ui).toContain('t("baseCoverageOffline")')
    expect(ui).toContain('t("baseCoverageLoadFailed")')
    expect(ui).toContain('t("baseCoverageUnavailable")')
  })

  it("keeps the previous result only for a refresh of the same employee-month", () => {
    expect(ui).toContain("coverageKeyRef.current !== coverageKey")
    expect(ui).toContain("if (coverageSelectionChanged) setBaseCoverage(null)")
  })

  it("drills into verified uncovered rows and builds only local planning links", () => {
    expect(ui).toContain("/api/v1/mtm/coverage-snapshots/${encodeURIComponent(snapshotId)}/rows")
    expect(ui).toContain('uncoveredOnly: "true"')
    expect(ui).toContain("row.explanation.summary[baseCoverageLabelLocale]")
    expect(ui).toContain("row.planningTarget.customerId")
    expect(ui).toContain("withReturnTo(planningPath, baseCoverageReturnTo)")
    expect(ui).not.toContain("row.sourceEvidence")
  })
})
