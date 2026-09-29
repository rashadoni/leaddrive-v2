import { describe, expect, it } from "vitest"

import { filterEntitlements, type EntitlementFilters } from "@/lib/entitlement-process/presentation"

const emptyFilters: EntitlementFilters = {
  companyId: "",
  status: "",
  supportLevel: "",
  slaPolicyId: "",
  risk: "",
}

function records(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `ent-${index}`,
    companyId: `company-${index}`,
    status: index % 2 === 0 ? "active" : "draft",
    supportLevel: index % 3 === 0 ? "premium" : "standard",
    slaPolicyId: index % 2 === 0 ? "sla-a" : "sla-b",
    isExpiringSoon: index % 10 === 0,
    milestones: { overdue: index % 20 === 0 ? 2 : 0, atRisk: index % 10 === 1 ? 3 : 0 },
    definitions: Array.from({ length: index % 8 }, (_, definition) => ({ id: `${index}-${definition}` })),
  }))
}

describe("entitlement list presentation", () => {
  it.each([0, 1, 20, 100])("keeps all %i records independent of milestone-definition count", (count) => {
    expect(filterEntitlements(records(count), emptyFilters)).toHaveLength(count)
  })

  it("combines overdue and due-soon milestones in the attention filter", () => {
    const result = filterEntitlements(records(30), { ...emptyFilters, risk: "attention" })
    expect(result.map((item) => item.id)).toEqual(["ent-0", "ent-1", "ent-11", "ent-20", "ent-21"])
  })

  it("combines company, lifecycle, support, SLA and risk filters deterministically", () => {
    const result = filterEntitlements(records(100), {
      companyId: "company-30",
      status: "active",
      supportLevel: "premium",
      slaPolicyId: "sla-a",
      risk: "expiring",
    })
    expect(result.map((item) => item.id)).toEqual(["ent-30"])
  })
})
