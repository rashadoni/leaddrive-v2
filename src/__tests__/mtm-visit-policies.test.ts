import { describe, expect, it, vi } from "vitest"
import { policyWindowsOverlap, resolveMtmVisitPolicy } from "@/lib/mtm/visit-policies"

function client(policies: Array<Record<string, unknown>>) {
  return {
    mtmAgent: {
      findFirst: vi.fn(() => Promise.resolve({ id: "agent-1", teamId: "team-1" })),
    },
    mtmCustomer: {
      findFirst: vi.fn(() => Promise.resolve({ id: "customer-1", category: "A", objectType: "DOCTOR" })),
    },
    mtmVisitPolicy: {
      findMany: vi.fn(() => Promise.resolve(policies)),
    },
  }
}

describe("MTM visit policy resolution", () => {
  it("prefers lower priority and snapshots every action", async () => {
    const broad = {
      id: "policy-broad",
      name: "Organization default",
      teamId: null,
      visitType: "DEFAULT",
      priority: 100,
      effectiveFrom: new Date("2026-01-01"),
      actions: [{ actionKey: "PHOTO", mode: "OPTIONAL", minCount: 1, conditions: null, allowWaiver: false }],
    }
    const medical = {
      id: "policy-medical",
      name: "Medical representatives",
      teamId: "team-1",
      visitType: "DOCTOR_VISIT",
      priority: 10,
      effectiveFrom: new Date("2026-02-01"),
      actions: [{ actionKey: "PRESENTATION", mode: "REQUIRED", minCount: 1, conditions: null, allowWaiver: false }],
    }

    const result = await resolveMtmVisitPolicy(client([broad, medical]) as never, {
      organizationId: "org-1",
      agentId: "agent-1",
      customerId: "customer-1",
      visitType: "DOCTOR_VISIT",
      at: new Date("2026-07-13"),
    })

    expect(result.sourcePolicyId).toBe("policy-medical")
    expect(result.requirements).toHaveLength(7)
    expect(result.requirements.find((item) => item.actionKey === "PRESENTATION")).toMatchObject({ mode: "REQUIRED", minCount: 1 })
    expect(result.requirements.find((item) => item.actionKey === "PHOTO")).toMatchObject({ mode: "OPTIONAL" })
  })

  it("hides a conditioned action when the customer does not match", async () => {
    const result = await resolveMtmVisitPolicy(client([{
      id: "policy-1",
      name: "Pharmacy policy",
      teamId: "team-1",
      visitType: "DEFAULT",
      priority: 1,
      effectiveFrom: new Date("2026-01-01"),
      actions: [{
        actionKey: "STOCK_CHECK",
        mode: "REQUIRED",
        minCount: 1,
        conditions: { objectTypes: ["PHARMACY"] },
        allowWaiver: false,
      }],
    }]) as never, {
      organizationId: "org-1",
      agentId: "agent-1",
      customerId: "customer-1",
    })

    expect(result.requirements.find((item) => item.actionKey === "STOCK_CHECK")?.mode).toBe("HIDDEN")
  })

  it("returns an optional compatibility policy when no policy exists", async () => {
    const result = await resolveMtmVisitPolicy(client([]) as never, {
      organizationId: "org-1",
      agentId: "agent-1",
      customerId: "customer-1",
    })

    expect(result.sourcePolicyId).toBeNull()
    expect(result.requirements.every((item) => item.mode === "OPTIONAL")).toBe(true)
  })

  it("detects overlapping effective windows", () => {
    expect(policyWindowsOverlap(
      { effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-06-30") },
      { effectiveFrom: new Date("2026-06-30"), effectiveTo: null },
    )).toBe(true)
    expect(policyWindowsOverlap(
      { effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-05-31") },
      { effectiveFrom: new Date("2026-06-01"), effectiveTo: null },
    )).toBe(false)
  })
})
