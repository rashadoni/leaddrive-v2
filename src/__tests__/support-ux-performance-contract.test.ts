import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("Support UX performance contract", () => {
  it("debounces every remote list search and cancels stale requests", () => {
    const complaints = read("src/app/(dashboard)/complaints/page.tsx")
    const voip = read("src/app/(dashboard)/support/voip/page.tsx")
    const portalUsers = read("src/app/(dashboard)/settings/portal-users/page.tsx")
    const tickets = read("src/app/(dashboard)/tickets/page.tsx")

    expect(tickets).toContain("window.setTimeout(() => updateWorkspaceParams")
    expect(complaints).toContain("window.setTimeout(() => setRequestFilters(filters), 250)")
    expect(complaints).toContain("const controller = new AbortController()")
    expect(complaints).toContain("void fetchRows(controller.signal)")
    expect(complaints).toContain("{ headers, signal }")
    expect(voip).toContain("setSearchQuery(searchInput.trim())")
    expect(voip).toContain("const controller = new AbortController()")
    expect(voip).toContain("signal: controller.signal")
    expect(portalUsers).toContain("setDebouncedSearch(searchInput.trim())")
    expect(portalUsers).toContain("const controller = new AbortController()")
    expect(portalUsers).toContain("loadData(controller.signal)")
  })

  it("keeps recordings lazy and secondary editors/details conditionally mounted", () => {
    const recording = read("src/components/voip/call-recording-player.tsx")
    const templates = read("src/app/(dashboard)/settings/entitlement-templates/page.tsx")
    const categories = read("src/app/(dashboard)/settings/ticket-categories/page.tsx")
    const routing = read("src/app/(dashboard)/support/skill-routing/page.tsx")

    expect(recording).toContain('preload="none"')
    expect(templates).toContain("definition.key === expandedRuleKey")
    expect(templates).toContain("{expanded && (")
    expect(categories).toContain("<Sheet open={editorOpen}")
    expect(routing).toContain("selectedQueueId")
    expect(routing).toContain("mobileView === \"agents\"")
  })

  it("keeps list volume bounded or paginated at the server boundary", () => {
    const tickets = read("src/app/(dashboard)/tickets/page.tsx")
    const complaints = read("src/app/(dashboard)/complaints/page.tsx")
    const voip = read("src/app/(dashboard)/support/voip/page.tsx")
    const portal = read("src/app/api/v1/public/portal-tickets/route.ts")

    expect(tickets).toContain("/api/v1/tickets?limit=200")
    expect(complaints).toContain('new URLSearchParams({ limit: "200" })')
    expect(voip).toContain('limit: "25"')
    expect(voip).toContain("totalPages")
    expect(portal).toContain("take: 100")
  })

  it("defines measured relative gates and a documented exception process", () => {
    const contract = read("docs/support-ux-performance-and-rollout.md")
    expect(contract).toContain("p75 load must not regress by more than 10% or 100 ms")
    expect(contract).toContain("p50 interaction/filter feedback")
    expect(contract).toContain("data-contract exception")
    expect(contract).toContain("before/after")
    expect(contract).toContain("expiry/review date")
  })

  it("makes the relative gates executable against a same-matrix baseline", () => {
    const runner = read("scripts/support-ux-browser-evidence.mjs")
    const comparator = read("scripts/support-ux-performance-compare.mjs")
    expect(runner).toContain("baselineEvidence.dataProfile === dataProfile")
    expect(comparator).toContain('compareUpperBound("loadP75", currentPerformance.loadP75, baselineResult.performance.loadP75, 100)')
    expect(comparator).toContain('compareUpperBound("filterP50", currentPerformance.filterP50, baselineResult.performance.filterP50, 50)')
    expect(comparator).toContain('status: regressions.length > 0 ? "regressed" : "matched"')
    expect(runner).toContain('comparedPerformance.status !== "matched"')
  })

  it("pins Service Desk budgets to the recorded production repeatability study", () => {
    const runner = read("scripts/support-ux-browser-evidence.mjs")
    const contract = read("docs/support-ux-performance-and-rollout.md")

    expect(runner).toContain("performanceBudget: { loadP75: 650, filterP50: 200, interactionP75: 250 }")
    expect(runner).toContain("performanceBudget: { loadP75: 600 }")
    expect(runner).toContain("performanceBudget: { loadP75: 700, filterP50: 200, interactionP75: 150 }")
    expect(contract).toContain("34241690941")
    expect(contract).toContain("34247698584")
    expect(contract).toContain("Review/expiry date: 2026-10-08")
  })
})
