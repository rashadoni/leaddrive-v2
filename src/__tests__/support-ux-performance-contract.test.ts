import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("Service Desk performance contract", () => {
  it("debounces workspace query changes instead of refetching on every keystroke", () => {
    const tickets = read("src/app/(dashboard)/tickets/page.tsx")

    expect(tickets).toContain("window.setTimeout(() => updateWorkspaceParams")
    expect(tickets).toContain("return () => window.clearTimeout(timeout)")
  })

  it("keeps the initial queue volume bounded", () => {
    const tickets = read("src/app/(dashboard)/tickets/page.tsx")

    expect(tickets).toContain("/api/v1/tickets?limit=200")
    expect(tickets).toContain("const KANBAN_COLLAPSE_LIMIT = 8")
  })

  it("makes relative gates executable against a same-matrix baseline", () => {
    const runner = read("scripts/support-ux-browser-evidence.mjs")
    const comparator = read("scripts/support-ux-performance-compare.mjs")

    expect(runner).toContain("baselineEvidence.dataProfile === dataProfile")
    expect(comparator).toContain('compareUpperBound("loadP75", currentPerformance.loadP75, baselineResult.performance.loadP75, 100)')
    expect(comparator).toContain('compareUpperBound("filterP50", currentPerformance.filterP50, baselineResult.performance.filterP50, 50)')
    expect(comparator).toContain('status: regressions.length > 0 ? "regressed" : "matched"')
    expect(runner).toContain('comparedPerformance.status !== "matched"')
  })

  it("pins each Service Desk surface to an explicit performance budget", () => {
    const runner = read("scripts/support-ux-browser-evidence.mjs")

    expect(runner).toContain("performanceBudget: { loadP75: 650, filterP50: 200, interactionP75: 250 }")
    expect(runner).toContain("performanceBudget: { loadP75: 600 }")
    expect(runner).toContain("performanceBudget: { loadP75: 700, filterP50: 200, interactionP75: 150 }")
  })
})
