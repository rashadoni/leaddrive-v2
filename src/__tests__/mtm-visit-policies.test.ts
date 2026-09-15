import { describe, expect, it, vi } from "vitest"
import { photoMinCountAboveMax, policyWindowsOverlap, resolveMtmVisitPolicy, visitPoliciesEnabled } from "@/lib/mtm/visit-policies"

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
    expect(result.requirements).toHaveLength(8)
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

const requiredPresentationPolicy = {
  id: "policy-required",
  name: "Strict",
  teamId: null,
  visitType: "DEFAULT",
  priority: 1,
  effectiveFrom: new Date("2026-01-01"),
  actions: [{ actionKey: "PRESENTATION", mode: "REQUIRED", minCount: 1, conditions: null, allowWaiver: false }],
}

function clientWithSettings(policies: Array<Record<string, unknown>>, settings: Record<string, unknown>) {
  const base = client(policies)
  return {
    ...base,
    mtmSetting: {
      findFirst: vi.fn(({ where }: { where: { key: string } }) => Promise.resolve(
        where.key in settings ? { value: settings[where.key] } : null,
      )),
    },
  }
}

describe("visitPoliciesEnabled switch in the resolver", () => {
  const input = { organizationId: "org-1", agentId: "agent-1", customerId: "customer-1" }

  it("selects no rule while the switch is off — identical to an organization without rules", async () => {
    for (const off of [false, "false"]) {
      for (const photoRequired of [true, false]) {
        const disabled = clientWithSettings([requiredPresentationPolicy], { visitPoliciesEnabled: off, photoRequired })
        const withoutRules = clientWithSettings([], { photoRequired })
        const resultOff = await resolveMtmVisitPolicy(disabled as never, input)
        const resultEmpty = await resolveMtmVisitPolicy(withoutRules as never, input)
        expect(resultOff).toEqual(resultEmpty)
        expect(resultOff.sourcePolicyId).toBeNull()
        // Stored rules are not even read, let alone touched.
        expect(disabled.mtmVisitPolicy.findMany).not.toHaveBeenCalled()
      }
    }
  })

  it("keeps the legacy photoRequired fallback while the switch is off", async () => {
    const result = await resolveMtmVisitPolicy(clientWithSettings([requiredPresentationPolicy], {
      visitPoliciesEnabled: false,
      photoRequired: true,
    }) as never, input)
    expect(result.requirements.find((item) => item.actionKey === "PHOTO")?.mode).toBe("REQUIRED")
    expect(result.requirements.find((item) => item.actionKey === "PRESENTATION")?.mode).toBe("OPTIONAL")
  })

  it("applies rules when the switch is on or was never stored", async () => {
    for (const settings of [{}, { visitPoliciesEnabled: true }, { visitPoliciesEnabled: "true" }]) {
      const result = await resolveMtmVisitPolicy(clientWithSettings([requiredPresentationPolicy], settings) as never, input)
      expect(result.sourcePolicyId).toBe("policy-required")
    }
    expect(visitPoliciesEnabled(undefined)).toBe(true)
    expect(visitPoliciesEnabled(null)).toBe(true)
    expect(visitPoliciesEnabled(false)).toBe(false)
  })
})

describe("PHOTO minimum vs maxPhotosPerVisit", () => {
  it("flags only a visible PHOTO minimum above the upload cap", () => {
    expect(photoMinCountAboveMax([{ actionKey: "PHOTO", mode: "REQUIRED", minCount: 11 }], 10)).toBe(11)
    expect(photoMinCountAboveMax([{ actionKey: "PHOTO", mode: "OPTIONAL", minCount: 11 }], 10)).toBe(11)
    expect(photoMinCountAboveMax([{ actionKey: "PHOTO", mode: "REQUIRED", minCount: 10 }], 10)).toBeNull()
    expect(photoMinCountAboveMax([{ actionKey: "PHOTO", mode: "HIDDEN", minCount: 50 }], 10)).toBeNull()
    expect(photoMinCountAboveMax([{ actionKey: "PRESENTATION", mode: "REQUIRED", minCount: 50 }], 10)).toBeNull()
    expect(photoMinCountAboveMax(undefined, 10)).toBeNull()
  })
})
