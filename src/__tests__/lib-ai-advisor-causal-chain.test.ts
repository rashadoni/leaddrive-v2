import { describe, expect, it } from "vitest"
import { buildAdvisorCausalChain, classifyAdvisorCausalChain } from "@/lib/ai/advisor/causal-chain"
import type { AdvisorSignal } from "@/lib/ai/advisor/types"

describe("Advisor causal chain templates", () => {
  it("links contract blockers to invoice money risk and manager task", () => {
    const contract = signal({
      id: "contracts:signature:contract-1",
      domain: "contracts",
      entityType: "contract",
      entityId: "contract-1",
      sources: [{ label: "Contract", entityType: "contract", entityId: "contract-1", href: "/contracts/contract-1" }],
    })
    const invoice = signal({
      id: "finance:invoice:invoice-1",
      domain: "finance",
      entityType: "invoice",
      entityId: "invoice-1",
      amount: 1500,
      sources: [
        { label: "Invoice", entityType: "invoice", entityId: "invoice-1", href: "/invoices/invoice-1" },
        { label: "Contract", entityType: "contract", entityId: "contract-1", href: "/contracts/contract-1" },
      ],
      recommendedActions: [{ actionType: "create_task", label: "Task", risk: "low", payload: { relatedType: "contract", relatedId: "contract-1" } }],
    })
    const task = signal({
      id: "tasks:overdue:task-1",
      domain: "tasks",
      entityType: "task",
      entityId: "task-1",
      sources: [{ label: "Task", entityType: "task", entityId: "task-1", href: "/tasks/task-1" }],
      recommendedActions: [{ actionType: "create_task", label: "Task", risk: "low", payload: { relatedType: "contract", relatedId: "contract-1" } }],
    })

    const chain = buildAdvisorCausalChain(contract, [contract, invoice, task])

    expect(chain.map((item) => [item.signal.id, item.template])).toEqual([
      ["finance:invoice:invoice-1", "contract_invoice_task"],
      ["tasks:overdue:task-1", "contract_invoice_task"],
    ])
  })

  it("links support SLA and task/KPI risks by owner workload", () => {
    const support = signal({ id: "support:sla:ticket-1", domain: "support", entityType: "ticket", entityId: "ticket-1", ownerId: "user-1" })
    const task = signal({ id: "tasks:overdue:task-1", domain: "tasks", entityType: "task", entityId: "task-1", ownerId: "user-1" })
    const kpi = signal({ id: "kpi:owner:user-1", domain: "kpi", entityType: "user", entityId: "user-1", ownerId: "user-1" })

    const chain = buildAdvisorCausalChain(support, [support, task, kpi])

    expect(chain.map((item) => [item.signal.id, item.template])).toEqual([
      ["tasks:overdue:task-1", "owner_workload_sla"],
      ["kpi:owner:user-1", "owner_workload_sla"],
    ])
  })

  it("links route execution and field/MTM evidence", () => {
    const route = signal({
      id: "routes:deviation:route-1",
      domain: "routes",
      entityType: "mtm_route",
      entityId: "route-1",
      sources: [{ label: "Route", entityType: "mtm_route", entityId: "route-1", href: "/mtm/routes?routeId=route-1" }],
    })
    const photo = signal({
      id: "mtm:photo_review:photo-1",
      domain: "mtm",
      entityType: "mtm_photo",
      entityId: "photo-1",
      sources: [
        { label: "Route", entityType: "mtm_route", entityId: "route-1", href: "/mtm/routes?routeId=route-1" },
        { label: "Photo", entityType: "mtm_photo", entityId: "photo-1", href: "/mtm/photos?photoId=photo-1" },
      ],
    })

    expect(classifyAdvisorCausalChain(route, photo)).toBe("route_field_execution")
    expect(buildAdvisorCausalChain(route, [route, photo])[0]).toMatchObject({
      signal: { id: "mtm:photo_review:photo-1" },
      template: "route_field_execution",
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
    severity: "high",
    detectedAt: "2026-06-27T00:00:00.000Z",
    facts: [],
    sources: [{ label: "Record", entityType: "deal", entityId: "deal-1", href: "/deals/deal-1" }],
    recommendedActions: [],
    ...overrides,
  }
}
