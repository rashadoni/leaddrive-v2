import type { MtmRouteStatus, Prisma } from "@prisma/client"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"

export function activeFieldAssignmentWindow(date: Date) {
  return {
    deletedAt: null,
    effectiveFrom: { lte: date },
    // effectiveTo is an exclusive boundary so ownership can hand over at
    // midnight without two assignments being active on the same workday.
    OR: [{ effectiveTo: null }, { effectiveTo: { gt: date } }],
  }
}

/**
 * How far back a route keeps a customer inside an agent's field scope.
 *
 * Without a bound, one route point from any year made a customer permanently
 * "mine": on prod an agent's Customers and Visits lists carried people whose
 * only tie was a cancelled route from months earlier, while check-in refused
 * them, so the list was promising work the app would not accept. Thirty days
 * comfortably covers the fourteen-day visit window the offline pull sends plus
 * a month of context, and it lets an old route fall out of scope by itself.
 */
export const MTM_FIELD_ROUTE_SCOPE_DAYS = 30

/** Routes on which the agent can still do something: check in, or finish a late push. */
const ACTIONABLE_ROUTE_STATUSES: readonly MtmRouteStatus[] = ["PLANNED", "IN_PROGRESS", "INCOMPLETE"]

/**
 * Routes that still explain a customer's presence on the agent's own screens.
 * COMPLETED is here and not in the mutation set: yesterday's finished visit must
 * keep its customer name, but nobody may check into it again.
 */
const VISIBLE_ROUTE_STATUSES: readonly MtmRouteStatus[] = [...ACTIONABLE_ROUTE_STATUSES, "COMPLETED"]

/**
 * DRAFT and CANCELLED are in neither set. An unpublished plan has not been given
 * to anyone, and a cancelled route was called off; treating either as ownership
 * is how the lists filled up with work that did not exist.
 */
function recentRouteWindow(
  date: Date,
  statuses: readonly MtmRouteStatus[],
): Pick<Prisma.MtmRouteWhereInput, "status" | "date"> {
  return {
    status: { in: [...statuses] },
    date: { gte: new Date(date.getTime() - MTM_FIELD_ROUTE_SCOPE_DAYS * 86_400_000) },
  }
}

function agentIds(actor: MtmRouteActor): string[] {
  if (actor.role === "AGENT") return actor.agentId ? [actor.agentId] : []
  return actor.scopedAgentIds ? [...actor.scopedAgentIds] : []
}

/** Scope used for agent/mobile organization reads: explicit ownership or a route assignment. */
export function customerScopeForActor(
  actor: MtmRouteActor,
  date: Date,
): Prisma.MtmCustomerWhereInput {
  if (actor.role === "ADMIN" || actor.scopedAgentIds === null) return {}
  const scopedAgentIds = agentIds(actor)
  if (scopedAgentIds.length === 0) return { id: "__no_field_scope__" }

  return {
    OR: [
      {
        agentAssignments: {
          some: {
            agentId: { in: scopedAgentIds },
            ...activeFieldAssignmentWindow(date),
          },
        },
      },
      {
        routePoints: {
          some: {
            deletedAt: null,
            route: {
              deletedAt: null,
              ...recentRouteWindow(date, VISIBLE_ROUTE_STATUSES),
              OR: [
                { agentId: { in: scopedAgentIds } },
                { assignments: { some: { agentId: { in: scopedAgentIds }, removedAt: null } } },
              ],
            },
          },
        },
      },
    ],
  }
}

/**
 * Scope for field mutations. Observer-only route assignments grant visibility,
 * but they must never grant permission to create or retarget operational data.
 */
export function customerMutationScopeForActor(
  actor: MtmRouteActor,
  date: Date,
): Prisma.MtmCustomerWhereInput {
  if (actor.role === "ADMIN" || actor.scopedAgentIds === null) return {}
  const scopedAgentIds = agentIds(actor)
  if (scopedAgentIds.length === 0) return { id: "__no_field_scope__" }

  return {
    OR: [
      {
        agentAssignments: {
          some: {
            agentId: { in: scopedAgentIds },
            ...activeFieldAssignmentWindow(date),
          },
        },
      },
      {
        routePoints: {
          some: {
            deletedAt: null,
            route: {
              deletedAt: null,
              ...recentRouteWindow(date, ACTIONABLE_ROUTE_STATUSES),
              OR: [
                { agentId: { in: scopedAgentIds } },
                {
                  assignments: {
                    some: {
                      agentId: { in: scopedAgentIds },
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
  }
}

/** Contacts are visible through direct assignment or an accessible active workplace. */
export function contactScopeForActor(
  actor: MtmRouteActor,
  date: Date,
): Prisma.MtmContactWhereInput {
  if (actor.role === "ADMIN" || actor.scopedAgentIds === null) return {}
  const scopedAgentIds = agentIds(actor)
  if (scopedAgentIds.length === 0) return { id: "__no_field_scope__" }

  return {
    OR: [
      {
        agentAssignments: {
          some: {
            agentId: { in: scopedAgentIds },
            ...activeFieldAssignmentWindow(date),
          },
        },
      },
      {
        workplaces: {
          some: {
            deletedAt: null,
            endedOn: null,
            customer: customerScopeForActor(actor, date),
          },
        },
      },
    ],
  }
}

/** Contact mutation scope paired with customerMutationScopeForActor. */
export function contactMutationScopeForActor(
  actor: MtmRouteActor,
  date: Date,
): Prisma.MtmContactWhereInput {
  if (actor.role === "ADMIN" || actor.scopedAgentIds === null) return {}
  const scopedAgentIds = agentIds(actor)
  if (scopedAgentIds.length === 0) return { id: "__no_field_scope__" }

  return {
    OR: [
      {
        agentAssignments: {
          some: {
            agentId: { in: scopedAgentIds },
            ...activeFieldAssignmentWindow(date),
          },
        },
      },
      {
        workplaces: {
          some: {
            deletedAt: null,
            endedOn: null,
            customer: customerMutationScopeForActor(actor, date),
          },
        },
      },
    ],
  }
}

export function canManageFieldMasterData(actor: MtmRouteActor): boolean {
  return actor.role === "ADMIN" || actor.role === "MANAGER" || actor.role === "SUPERVISOR"
}

export function contactDisplayName(input: {
  firstName: string
  lastName: string
  middleName?: string | null
  displayName?: string | null
}): string {
  return input.displayName?.trim()
    || [input.lastName, input.firstName, input.middleName].filter(Boolean).join(" ")
}
