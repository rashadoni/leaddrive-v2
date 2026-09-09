import { describe, expect, it } from "vitest"
import { buildAdvisorBriefing, type AdvisorBriefingLabels } from "@/lib/ai/advisor/briefing"
import type { AdvisorSignal } from "@/lib/ai/advisor/types"

const labels: AdvisorBriefingLabels = {
  briefingCritical: "Critical/high",
  briefingMoney: "Money",
  briefingRoutes: "Routes/field",
  briefingSla: "SLA",
  briefingKpi: "Manager plan",
  revenueAtRisk: "Revenue at risk",
}

describe("Advisor daily briefing builder", () => {
  it("summarizes urgent money, route and KPI signals from typed signal metrics", () => {
    const items = buildAdvisorBriefing([
      signal({
        id: "finance:invoice-1",
        domain: "finance",
        entityType: "invoice",
        entityId: "invoice-1",
        title: "INV-001 is overdue",
        severity: "high",
        amount: 1200,
        currency: "AZN",
        detectedAt: "2026-06-27T08:00:00.000Z",
        metric: { kind: "money", label: "Money at risk", value: 1200, unit: "AZN", formatted: "1,200 AZN" },
      }),
      signal({
        id: "routes:route-1",
        domain: "routes",
        entityType: "mtm_route",
        entityId: "route-1",
        title: "City route missed a stop",
        severity: "critical",
        detectedAt: "2026-06-27T10:00:00.000Z",
        metric: { kind: "minutes", label: "Delay minutes", value: 50, unit: "minutes", formatted: "50 min" },
        facts: [{ label: "Delay minutes", value: "50" }],
      }),
      signal({
        id: "kpi:user-1",
        domain: "kpi",
        entityType: "user",
        entityId: "user-1",
        title: "Leyla is behind monthly plan",
        severity: "medium",
        detectedAt: "2026-06-27T09:00:00.000Z",
        metric: { kind: "percent", label: "Completion rate", value: 38, unit: "%", formatted: "38%" },
      }),
    ], labels)

    expect(items.map((item) => item.key)).toEqual(["critical", "money", "routes", "kpi"])
    expect(items.find((item) => item.key === "critical")).toMatchObject({
      value: "2",
      detail: "City route missed a stop",
      signalId: "routes:route-1",
      tone: "critical",
    })
    expect(items.find((item) => item.key === "money")).toMatchObject({
      value: "1,200 AZN",
      detail: "INV-001 is overdue",
      signalId: "finance:invoice-1",
    })
    expect(items.find((item) => item.key === "routes")).toMatchObject({
      value: "50 min",
      detail: "City route missed a stop",
    })
    expect(items.find((item) => item.key === "kpi")).toMatchObject({
      value: "38%",
      detail: "Leyla is behind monthly plan",
    })
  })

  it("detects support SLA risks from searchable signal evidence", () => {
    const items = buildAdvisorBriefing([
      signal({
        id: "support:ticket-1",
        domain: "support",
        entityType: "ticket",
        entityId: "ticket-1",
        title: "Ticket is near SLA breach",
        severity: "high",
        facts: [{ label: "SLA due", value: "2026-06-27T11:00:00.000Z" }],
      }),
    ], labels)

    expect(items.map((item) => item.key)).toEqual(["critical", "sla"])
    expect(items.find((item) => item.key === "sla")).toMatchObject({
      value: "1",
      detail: "Ticket is near SLA breach",
      signalId: "support:ticket-1",
    })
  })

  it("adds change items when a previous persisted snapshot is available", () => {
    const previous = [
      signal({
        id: "finance:invoice-old",
        domain: "finance",
        entityType: "invoice",
        entityId: "invoice-old",
        title: "Old invoice risk",
        severity: "high",
        amount: 1000,
        currency: "AZN",
        metric: { kind: "money", label: "Money at risk", value: 1000, unit: "AZN", formatted: "1,000 AZN" },
      }),
      signal({
        id: "routes:old-route",
        domain: "routes",
        entityType: "mtm_route",
        entityId: "old-route",
        title: "Old route risk",
        severity: "medium",
      }),
    ]
    const current = [
      ...previous,
      signal({
        id: "finance:invoice-new",
        domain: "finance",
        entityType: "invoice",
        entityId: "invoice-new",
        title: "New invoice risk",
        severity: "critical",
        amount: 500,
        currency: "AZN",
        detectedAt: "2026-06-27T11:00:00.000Z",
        metric: { kind: "money", label: "Money at risk", value: 500, unit: "AZN", formatted: "500 AZN" },
      }),
      signal({
        id: "routes:new-route",
        domain: "routes",
        entityType: "mtm_route",
        entityId: "new-route",
        title: "New route risk",
        severity: "high",
        detectedAt: "2026-06-27T10:00:00.000Z",
        metric: { kind: "minutes", label: "Delay minutes", value: 35, unit: "minutes", formatted: "35 min" },
      }),
    ]

    const items = buildAdvisorBriefing(current, labels, { previousSignals: previous })

    expect(items.map((item) => item.key).slice(0, 3)).toEqual(["new_critical", "money_delta", "route_delta"])
    expect(items.find((item) => item.key === "new_critical")).toMatchObject({
      value: "+2",
      detail: "New invoice risk",
      signalId: "finance:invoice-new",
    })
    expect(items.find((item) => item.key === "money_delta")).toMatchObject({
      value: "+500 AZN",
      detail: "New invoice risk",
    })
    expect(items.find((item) => item.key === "route_delta")).toMatchObject({
      value: "+1",
      detail: "New route risk",
    })
  })
})

function signal(overrides: Partial<AdvisorSignal>): AdvisorSignal {
  return {
    id: "signal-1",
    domain: "sales",
    domainLabel: "Sales",
    entityType: "deal",
    entityId: "deal-1",
    title: "Risk",
    summary: "Risk summary",
    severity: "medium",
    detectedAt: "2026-06-27T00:00:00.000Z",
    facts: [],
    sources: [{ label: "Record", entityType: "deal", entityId: "deal-1", href: "/deals/deal-1" }],
    recommendedActions: [],
    ...overrides,
  }
}
