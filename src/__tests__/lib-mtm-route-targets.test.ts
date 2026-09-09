import { describe, expect, it, vi } from "vitest"
import {
  mtmRouteTargetKey,
  validateMtmMobileRouteTargetEligibility,
  validateMtmRouteTargets,
} from "@/lib/mtm/route-targets"

function client(input: {
  customers?: Array<{ id: string }>
  contacts?: Array<{ id: string; workplaces: Array<{ customerId: string }> }>
}) {
  return {
    mtmCustomer: { findMany: vi.fn().mockResolvedValue(input.customers ?? []) },
    mtmContact: { findMany: vi.fn().mockResolvedValue(input.contacts ?? []) },
  } as never
}

function mobileClient(input: {
  customers?: Array<{ id: string; agentAssignments?: Array<{ id: string }> }>
  /**
   * Rows the SHARED eligibility query returns — assignment or actionable
   * route. The validator asks mtmCustomer twice and the two questions are not
   * the same one, so the mock must not answer both with the same list.
   */
  eligibleCustomers?: Array<{ id: string }>
  contacts?: Array<{
    id: string
    agentAssignments?: Array<{ id: string }>
    workplaces: Array<{ customerId: string }>
  }>
}) {
  return {
    mtmCustomer: {
      findMany: vi.fn().mockImplementation((args: { where?: { AND?: unknown } }) =>
        Promise.resolve(args?.where?.AND ? (input.eligibleCustomers ?? []) : (input.customers ?? [])),
      ),
    },
    mtmContact: { findMany: vi.fn().mockResolvedValue(input.contacts ?? []) },
  }
}

describe("MTM route targets", () => {
  it("uses contact identity when a stop names a doctor", () => {
    expect(mtmRouteTargetKey({ customerId: "clinic-1", contactId: "doctor-1" })).toBe("contact:doctor-1")
    expect(mtmRouteTargetKey({ customerId: "pharmacy-1" })).toBe("customer:pharmacy-1")
  })

  it("accepts an active contact at the selected workplace", async () => {
    const result = await validateMtmRouteTargets(client({
      customers: [{ id: "clinic-1" }],
      contacts: [{ id: "doctor-1", workplaces: [{ customerId: "clinic-1" }] }],
    }), {
      organizationId: "org-1",
      routeDate: new Date("2026-07-15T00:00:00.000Z"),
      points: [{ customerId: "clinic-1", contactId: "doctor-1" }],
    })

    expect(result).toEqual({
      ok: true,
      missingCustomerIds: [],
      missingContactIds: [],
      invalidContactWorkplaces: [],
    })
  })

  it("rejects a contact whose workplace does not match the route stop", async () => {
    const result = await validateMtmRouteTargets(client({
      customers: [{ id: "clinic-1" }],
      contacts: [{ id: "doctor-1", workplaces: [{ customerId: "clinic-2" }] }],
    }), {
      organizationId: "org-1",
      routeDate: new Date("2026-07-15T00:00:00.000Z"),
      points: [{ customerId: "clinic-1", contactId: "doctor-1" }],
    })

    expect(result.ok).toBe(false)
    expect(result.invalidContactWorkplaces).toEqual([{ contactId: "doctor-1", customerId: "clinic-1" }])
  })

  it("requires an active effective assignment for a mobile customer stop", async () => {
    const prisma = mobileClient({
      customers: [{ id: "customer-1", agentAssignments: [{ id: "assignment-1" }] }],
      eligibleCustomers: [{ id: "customer-1" }],
    })
    const result = await validateMtmMobileRouteTargetEligibility(prisma as never, {
      organizationId: "org-1",
      primaryAgentId: "agent-1",
      routeDate: new Date("2026-07-15T00:00:00.000Z"),
      points: [{ customerId: "customer-1" }],
    })

    expect(result).toEqual({ ok: true })
    expect(prisma.mtmCustomer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        status: "ACTIVE",
        deletedAt: null,
      }),
      select: expect.objectContaining({
        id: true,
        agentAssignments: expect.objectContaining({
          where: expect.objectContaining({
            agentId: "agent-1",
            deletedAt: null,
            effectiveFrom: { lte: new Date("2026-07-15T00:00:00.000Z") },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date("2026-07-15T00:00:00.000Z") } }],
          }),
          take: 1,
          select: { id: true },
        }),
      }),
    }))
  })

  it("rejects an unassigned customer at an assignment handover boundary", async () => {
    const result = await validateMtmMobileRouteTargetEligibility(mobileClient({
      customers: [{ id: "customer-1", agentAssignments: [] }],
    }) as never, {
      organizationId: "org-1",
      primaryAgentId: "agent-1",
      routeDate: new Date("2026-07-15T00:00:00.000Z"),
      points: [{ customerId: "customer-1" }],
    })

    expect(result).toEqual({ ok: false })
  })

  it("accepts a stop the picker offered through a route, not an assignment", async () => {
    // A2: the picker offers points reachable through an actionable route. A
    // validator that still demanded an assignment would reject exactly what
    // the agent was just shown — the refused promise, moved one step later.
    const result = await validateMtmMobileRouteTargetEligibility(mobileClient({
      customers: [{ id: "customer-1", agentAssignments: [] }],
      eligibleCustomers: [{ id: "customer-1" }],
    }) as never, {
      organizationId: "org-1",
      primaryAgentId: "agent-1",
      routeDate: new Date("2026-07-15T00:00:00.000Z"),
      points: [{ customerId: "customer-1" }],
    })

    expect(result).toEqual({ ok: true })
  })

  it("still refuses a doctor whose only tie is a route, matching the picker", async () => {
    // Doctors were deliberately left assignment-only: the picker does not
    // offer route-only doctors, and accepting one here would grant a write
    // the interface never showed.
    const result = await validateMtmMobileRouteTargetEligibility(mobileClient({
      customers: [{ id: "clinic-1", agentAssignments: [] }],
      eligibleCustomers: [{ id: "clinic-1" }],
      contacts: [{ id: "doctor-1", agentAssignments: [], workplaces: [{ customerId: "clinic-1" }] }],
    }) as never, {
      organizationId: "org-1",
      primaryAgentId: "agent-1",
      routeDate: new Date("2026-07-15T00:00:00.000Z"),
      points: [{ customerId: "clinic-1", contactId: "doctor-1" }],
    })

    expect(result).toEqual({ ok: false })
  })

  it("allows a mobile doctor stop through a direct contact assignment", async () => {
    const result = await validateMtmMobileRouteTargetEligibility(mobileClient({
      customers: [{ id: "clinic-1", agentAssignments: [] }],
      contacts: [{
        id: "doctor-1",
        agentAssignments: [{ id: "contact-assignment-1" }],
        workplaces: [{ customerId: "clinic-1" }],
      }],
    }) as never, {
      organizationId: "org-1",
      primaryAgentId: "agent-1",
      routeDate: new Date("2026-07-15T00:00:00.000Z"),
      points: [{ customerId: "clinic-1", contactId: "doctor-1" }],
    })

    expect(result).toEqual({ ok: true })
  })

  it("rejects a mobile doctor stop without a current matching workplace", async () => {
    const result = await validateMtmMobileRouteTargetEligibility(mobileClient({
      customers: [{ id: "clinic-1", agentAssignments: [{ id: "assignment-1" }] }],
      eligibleCustomers: [{ id: "clinic-1" }],
      contacts: [{
        id: "doctor-1",
        agentAssignments: [{ id: "contact-assignment-1" }],
        workplaces: [{ customerId: "clinic-2" }],
      }],
    }) as never, {
      organizationId: "org-1",
      primaryAgentId: "agent-1",
      routeDate: new Date("2026-07-15T00:00:00.000Z"),
      points: [{ customerId: "clinic-1", contactId: "doctor-1" }],
    })

    expect(result).toEqual({ ok: false })
  })
})
