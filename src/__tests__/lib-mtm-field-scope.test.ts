import { describe, expect, it } from "vitest"
import {
  activeFieldAssignmentWindow,
  contactDisplayName,
  contactMutationScopeForActor,
  contactScopeForActor,
  customerMutationScopeForActor,
  customerScopeForActor,
  MTM_FIELD_ROUTE_SCOPE_DAYS,
} from "@/lib/mtm/field-scope"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"

const DATE = new Date("2026-07-15T00:00:00.000Z")
const AGENT: MtmRouteActor = { agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] }

type RouteMembershipArm = {
  routePoints: { some: { route: { status: { in: string[] }; date: { gte: Date } } } }
}
type WorkplaceArm = { workplaces: { some: { customer: { OR: RouteMembershipArm[] } } } }

/** The second arm of a field scope is always the route-membership one. */
function routeArm(scope: { OR?: unknown }): RouteMembershipArm["routePoints"]["some"]["route"] {
  return ((scope.OR as RouteMembershipArm[])[1]).routePoints.some.route
}

describe("MTM field ownership scope", () => {
  it("treats effectiveTo as an exclusive handover boundary", () => {
    expect(activeFieldAssignmentWindow(DATE)).toEqual({
      deletedAt: null,
      effectiveFrom: { lte: DATE },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: DATE } }],
    })
  })

  it("allows an agent to see an organization through ownership or route participation", () => {
    const scope = customerScopeForActor(AGENT, DATE)
    expect(scope).toMatchObject({
      OR: [
        { agentAssignments: { some: { agentId: { in: ["agent-1"] } } } },
        {
          routePoints: {
            some: {
              route: {
                OR: [
                  { agentId: { in: ["agent-1"] } },
                  { assignments: { some: { agentId: { in: ["agent-1"] }, removedAt: null } } },
                ],
              },
            },
          },
        },
      ],
    })
  })

  it("stops an old or cancelled route from making a customer permanently visible", () => {
    // A single route point used to be forever: prod agents carried customers
    // whose only tie was a cancelled route from months back, while check-in
    // refused them. The list was promising work the app would not accept.
    const route = routeArm(customerScopeForActor(AGENT, DATE))
    expect(route.status.in).toEqual(["PLANNED", "IN_PROGRESS", "INCOMPLETE", "COMPLETED"])
    expect(route.status.in).not.toContain("DRAFT")
    expect(route.status.in).not.toContain("CANCELLED")
    expect(route.date.gte).toEqual(new Date(DATE.getTime() - MTM_FIELD_ROUTE_SCOPE_DAYS * 86_400_000))
  })

  it("lets an agent act only where a check-in could actually land", () => {
    // COMPLETED keeps yesterday's customer name readable, but nobody may check
    // into a finished route, so the mutation scope must not offer it.
    const route = routeArm(customerMutationScopeForActor(AGENT, DATE))
    expect(route.status.in).toEqual(["PLANNED", "IN_PROGRESS", "INCOMPLETE"])
    expect(route.status.in).not.toContain("COMPLETED")
  })

  it("carries the same bound into contact scope, which is built from the customer scope", () => {
    const read = (contactScopeForActor(AGENT, DATE).OR as WorkplaceArm[])[1].workplaces.some.customer
    expect(routeArm(read).status.in).toContain("COMPLETED")
    const write = (contactMutationScopeForActor(AGENT, DATE).OR as WorkplaceArm[])[1].workplaces.some.customer
    expect(routeArm(write).status.in).not.toContain("COMPLETED")
  })

  it("allows a contact through direct ownership or an accessible active workplace", () => {
    expect(contactScopeForActor(AGENT, DATE)).toMatchObject({
      OR: [
        { agentAssignments: { some: { agentId: { in: ["agent-1"] } } } },
        { workplaces: { some: { endedOn: null, customer: { OR: expect.any(Array) } } } },
      ],
    })
  })

  it("keeps observer route visibility read-only for customer and contact mutations", () => {
    const customerScope = customerMutationScopeForActor(AGENT, DATE)
    expect(customerScope).toMatchObject({
      OR: [
        { agentAssignments: { some: { agentId: { in: ["agent-1"] } } } },
        {
          routePoints: {
            some: {
              route: {
                OR: [
                  { agentId: { in: ["agent-1"] } },
                  {
                    assignments: {
                      some: {
                        agentId: { in: ["agent-1"] },
                        removedAt: null,
                        role: { not: "OBSERVER" },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    })
    expect(contactMutationScopeForActor(AGENT, DATE)).toMatchObject({
      OR: [
        { agentAssignments: { some: { agentId: { in: ["agent-1"] } } } },
        {
          workplaces: {
            some: {
              customer: customerScope,
            },
          },
        },
      ],
    })
  })

  it("does not constrain an administrator", () => {
    const admin: MtmRouteActor = { agentId: null, role: "ADMIN", scopedAgentIds: null }
    expect(customerScopeForActor(admin, DATE)).toEqual({})
    expect(contactScopeForActor(admin, DATE)).toEqual({})
    expect(customerMutationScopeForActor(admin, DATE)).toEqual({})
    expect(contactMutationScopeForActor(admin, DATE)).toEqual({})
  })

  it("builds a stable display name when no explicit display name is supplied", () => {
    expect(contactDisplayName({ firstName: "Farid", lastName: "Mammadov", middleName: "Rashad" }))
      .toBe("Mammadov Farid Rashad")
    expect(contactDisplayName({ firstName: "Farid", lastName: "Mammadov", displayName: "Dr Farid" }))
      .toBe("Dr Farid")
  })
})
