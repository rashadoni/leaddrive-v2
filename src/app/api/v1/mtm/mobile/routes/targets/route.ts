import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { normalizeMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { activeFieldAssignmentWindow } from "@/lib/mtm/field-scope"
import {
  eligibleFieldCustomerWhere,
  fieldEligibilityEmptyReason,
  LEGACY_EMPTY_REASON,
  type MtmFieldEligibilityReason,
} from "@/lib/mtm/field-eligibility"
import { isDateKey } from "@/lib/mtm/mobile-week"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { canCreateMtmRouteFor, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import type { MtmRouteTargetType } from "@/lib/mtm/route-target-types"
import { getMtmSettings } from "@/lib/mtm-settings"
import type { WorkCalendarOverride } from "@/lib/mtm/work-calendar"
import { withMobileRls } from "@/lib/with-mobile-rls"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const MAX_PAGE = 1_000
const MAX_SEARCH_LENGTH = 120

type AssignmentWindowRow = {
  effectiveFrom: Date
  effectiveTo: Date | null
}

function routeDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

function publicTargetType(target: MtmRouteTargetType) {
  return {
    id: target.id,
    labels: target.labels,
    direction: target.direction,
    objectType: target.objectType,
    organizationKind: target.organizationKind,
  }
}

function assignmentAvailability(
  source:
    | "CUSTOMER_ASSIGNMENT"
    | "DIRECT_CONTACT_ASSIGNMENT"
    | "WORKPLACE_ASSIGNMENT"
    // The point is workable because the employee already has an actionable
    // route to it, not because anyone assigned it. There is no window to
    // report, and the picker must still offer it: Visits and Customers do.
    | "ROUTE_MEMBERSHIP",
  assignment: AssignmentWindowRow | null | undefined,
) {
  return {
    source,
    validFrom: assignment?.effectiveFrom.toISOString().slice(0, 10) ?? null,
    // `effectiveTo` is exclusive. Return the last inclusive work day so the
    // picker can describe the selected date without exposing other owners.
    validThrough: assignment?.effectiveTo
      ? new Date(assignment.effectiveTo.getTime() - 86_400_000).toISOString().slice(0, 10)
      : null,
  }
}

function inputError() {
  return NextResponse.json({
    error: "agentId, date, page, limit, and search are invalid",
    code: "MTM_MOBILE_ROUTE_TARGET_INPUT_INVALID",
  }, { status: 400 })
}

function scopeDenied() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_MOBILE_ROUTE_TARGET_SCOPE_DENIED" }, { status: 403 })
}

function routeTargetTypeError() {
  return NextResponse.json({ error: "Route target type is unavailable", code: "MTM_MOBILE_ROUTE_TARGET_TYPE_INVALID" }, { status: 400 })
}

function positiveInteger(value: string | null, fallback: number, maximum: number): number | null {
  if (value === null || value === "") return fallback
  if (!/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null
}

/**
 * GET /api/v1/mtm/mobile/routes/targets
 *
 * A deliberately small, mobile-only route target picker. It evaluates both
 * assignment and workplace validity for the selected employee and selected
 * route date. It must not expose the broader CRM catalogue, ownership of
 * other agents, coverage facts, or route history.
 */
export const GET = withMobileRls(async (req, auth) => {
  const params = new URL(req.url).searchParams
  const agentId = params.get("agentId")?.trim() ?? ""
  const date = params.get("date")?.trim() ?? ""
  const targetTypeId = params.get("targetTypeId")?.trim().toLowerCase() ?? ""
  const search = params.get("search")?.trim() ?? ""
  const page = positiveInteger(params.get("page"), 1, MAX_PAGE)
  const limit = positiveInteger(params.get("limit"), DEFAULT_LIMIT, MAX_LIMIT)

  if (!agentId || !isDateKey(date) || !page || !limit || search.length > MAX_SEARCH_LENGTH) {
    return inputError()
  }

  // A field agent may use the picker for their own draft; leaders need the
  // already-gated team read surface before their precise route scope is
  // checked below. Unknown roles fail closed in `requireMobileCapability`.
  const requiredCapability = auth.role === "AGENT" ? "FIELD_EXECUTE" : "TEAM_READ"
  const capabilityDenied = requireMobileCapability(auth, requiredCapability)
  if (capabilityDenied) return capabilityDenied

  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || !canCreateMtmRouteFor(actor, agentId)) return scopeDenied()

  const targetAgent = await prisma.mtmAgent.findFirst({
    where: { id: agentId, organizationId: auth.orgId, status: "ACTIVE" },
    select: { id: true, name: true, teamId: true },
  })
  if (!targetAgent) {
    return NextResponse.json({ error: "Selected employee is unavailable", code: "MTM_MOBILE_ROUTE_TARGET_AGENT_NOT_FOUND" }, { status: 404 })
  }

  const settings = await getMtmSettings(auth.orgId)
  const targetTypes = settings.routeTargetTypes.filter((type) => type.enabled)
  const targetType = targetTypes.find((type) => type.id === targetTypeId) ?? (!targetTypeId ? targetTypes[0] : null)
  if (!targetType) return routeTargetTypeError()

  const effectiveOn = routeDate(date)
  const assignmentWindow = activeFieldAssignmentWindow(effectiveOn)
  // The single definition of "a point this employee may work on this date",
  // shared with Visits and Customers. The picker used to demand an effective
  // assignment while those two also accepted route membership, so one agent
  // read 0 here and 3 there on the very same day.
  const eligibleCustomer = eligibleFieldCustomerWhere({ agentId, date: effectiveOn })

  /**
   * Runs only when the list came back empty, so the extra count and calendar
   * read never touch the common path. Both branches call it, which is what
   * makes the planner blame the same thing Visits and Customers blame.
   */
  const resolveEmptyReason = async (eligibleTotal: number): Promise<MtmFieldEligibilityReason> => {
    const calendarOverrides = await (
      settings.enforceWorkCalendarForRoutes
        ? prisma.mtmWorkCalendarDay.findMany({
            where: {
              organizationId: auth.orgId,
              date: effectiveOn,
              deletedAt: null,
              OR: [
                { teamId: null, agentId: null },
                ...(targetAgent.teamId ? [{ teamId: targetAgent.teamId, agentId: null }] : []),
                { teamId: null, agentId },
              ],
            },
            select: {
              id: true,
              date: true,
              kind: true,
              name: true,
              teamId: true,
              agentId: true,
              movedToDate: true,
              routePlanningAllowed: true,
            },
          })
        : Promise.resolve([] as WorkCalendarOverride[])
    )
    return fieldEligibilityEmptyReason({
      date: effectiveOn,
      dateKey: date,
      workCalendarEnforced: settings.enforceWorkCalendarForRoutes,
      calendarOverrides: calendarOverrides as WorkCalendarOverride[],
      teamId: targetAgent.teamId,
      agentId,
      hasAnyEligibleSource: eligibleTotal > 0,
      narrowedByTerritory: eligibleTotal > 0,
    })
  }
  const skip = (page - 1) * limit
  const customerBase: Prisma.MtmCustomerWhereInput = {
    organizationId: auth.orgId,
    deletedAt: null,
    status: "ACTIVE",
  }
  const searchCustomer: Prisma.MtmCustomerWhereInput = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { code: { contains: search, mode: "insensitive" } },
          { address: { contains: search, mode: "insensitive" } },
          { city: { contains: search, mode: "insensitive" } },
        ],
      }
    : {}

  const common = {
    success: true,
    targetAgent,
    date,
    targetTypes: targetTypes.map(publicTargetType),
    targetType: publicTargetType(targetType),
    selectionScope: {
      // The legacy `mode` stays on the wire for the shipped app; the truthful
      // flag below is the one that changed. Organizations now also accept an
      // actionable route as the reason a point is workable, doctors do not yet.
      mode: "EFFECTIVE_ASSIGNMENTS" as const,
      assignmentRequired: targetType.direction === "DOCTOR",
      agentId,
      effectiveOn: date,
    },
  }

  if (targetType.direction !== "DOCTOR") {
    const customerWhere: Prisma.MtmCustomerWhereInput = {
      ...customerBase,
      ...(targetType.objectType
        ? { objectType: targetType.objectType }
        : { objectType: { not: "DOCTOR" } }),
      ...(targetType.organizationKind
        ? { organizationKind: { equals: targetType.organizationKind, mode: "insensitive" } }
        : {}),
      AND: [searchCustomer, eligibleCustomer],
    }
    const customers = await prisma.mtmCustomer.findMany({
      where: customerWhere,
      skip,
      take: limit + 1,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
        objectType: true,
        category: true,
        address: true,
        city: true,
        phone: true,
        latitude: true,
        longitude: true,
        agentAssignments: {
          where: { agentId, ...assignmentWindow },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
          select: { effectiveFrom: true, effectiveTo: true },
        },
      },
    })
    const items = customers.slice(0, limit).map((customer) => ({
      targetKey: `customer:${customer.id}`,
      subjectType: "ORGANIZATION" as const,
      customer: {
        id: customer.id,
        name: customer.name,
        code: customer.code,
        objectType: customer.objectType,
        category: customer.category,
        address: customer.address,
        city: customer.city,
        phone: customer.phone,
        ...normalizeMtmCoordinates(customer),
      },
      contact: null,
      availability: customer.agentAssignments[0]
        ? assignmentAvailability("CUSTOMER_ASSIGNMENT", customer.agentAssignments[0])
        : assignmentAvailability("ROUTE_MEMBERSHIP", null),
    }))
    const eligibility = items.length === 0
      ? {
          reason: await resolveEmptyReason(
            // Without the target type and the search box, so an agent who owns
            // nothing is told something different from one whose filter is wrong.
            await prisma.mtmCustomer.count({ where: { ...customerBase, AND: [eligibleCustomer] } }),
          ),
        }
      : null
    return NextResponse.json({
      success: common.success,
      data: {
        ...common,
        items,
        page: { number: page, limit, hasMore: customers.length > limit },
        emptyReason: items.length === 0 ? LEGACY_EMPTY_REASON : null,
        eligibility,
      },
    })
  }

  const workplaceWhere: Prisma.MtmContactWorkplaceWhereInput = {
    deletedAt: null,
    AND: [
      { OR: [{ startedOn: null }, { startedOn: { lte: effectiveOn } }] },
      { OR: [{ endedOn: null }, { endedOn: { gt: effectiveOn } }] },
    ],
    customer: customerBase,
  }
  // Deliberately still assignment-only. A doctor card names ONE workplace, and
  // the row below picks it by "this customer is assigned to the employee".
  // Widening the query without rewriting that pick would let the card surface a
  // workplace at a customer outside the employee's scope. Doctors move to the
  // shared definition together with that rewrite; the empty reason is shared
  // from today, so the screens still agree on WHY a list is empty.
  const assignedCustomer: Prisma.MtmCustomerWhereInput = {
    ...customerBase,
    agentAssignments: { some: { agentId, ...assignmentWindow } },
  }
  const contactSearch: Prisma.MtmContactWhereInput = search
    ? {
        OR: [
          { displayName: { contains: search, mode: "insensitive" } },
          { externalCode: { contains: search, mode: "insensitive" } },
          { specialtyName: { contains: search, mode: "insensitive" } },
          {
            workplaces: {
              some: {
                ...workplaceWhere,
                customer: { ...customerBase, ...searchCustomer },
              },
            },
          },
        ],
      }
    : {}
  const contacts = await prisma.mtmContact.findMany({
    where: {
      organizationId: auth.orgId,
      deletedAt: null,
      status: "ACTIVE",
      type: "DOCTOR",
      AND: [
        { workplaces: { some: workplaceWhere } },
        {
          OR: [
            { agentAssignments: { some: { agentId, ...assignmentWindow } } },
            { workplaces: { some: { ...workplaceWhere, customer: assignedCustomer } } },
          ],
        },
        contactSearch,
      ],
    },
    skip,
    take: limit + 1,
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    select: {
      id: true,
      displayName: true,
      type: true,
      specialtyName: true,
      phone: true,
      agentAssignments: {
        where: { agentId, ...assignmentWindow },
        orderBy: { effectiveFrom: "desc" },
        take: 1,
        select: { effectiveFrom: true, effectiveTo: true },
      },
      workplaces: {
        where: workplaceWhere,
        orderBy: [{ isPrimary: "desc" }, { startedOn: "desc" }, { id: "asc" }],
        select: {
          id: true,
          customer: {
            select: {
              id: true,
              name: true,
              code: true,
              objectType: true,
              category: true,
              address: true,
              city: true,
              phone: true,
              latitude: true,
              longitude: true,
              agentAssignments: {
                where: { agentId, ...assignmentWindow },
                orderBy: { effectiveFrom: "desc" },
                take: 1,
                select: { effectiveFrom: true, effectiveTo: true },
              },
            },
          },
        },
      },
    },
  })
  const items = contacts.slice(0, limit).flatMap((contact) => {
    const directAssignment = contact.agentAssignments[0]
    // A route can contain a doctor only once. Keep pagination truthful by
    // choosing the first eligible current workplace in the deterministic
    // Prisma order instead of emitting duplicate `contact:<id>` cards.
    const workplace = contact.workplaces.find((candidate) =>
      Boolean(directAssignment || candidate.customer.agentAssignments[0]),
    )
    if (!workplace) return []
    const customerAssignment = workplace.customer.agentAssignments[0]
    // A direct contact assignment grants the selected employee access to a
    // current workplace; otherwise the workplace's customer must be assigned
    // to that same employee on the selected date.
    return [{
      targetKey: `contact:${contact.id}`,
      subjectType: "CONTACT" as const,
      customer: {
        id: workplace.customer.id,
        name: workplace.customer.name,
        code: workplace.customer.code,
        objectType: workplace.customer.objectType,
        category: workplace.customer.category,
        address: workplace.customer.address,
        city: workplace.customer.city,
        phone: workplace.customer.phone,
        ...normalizeMtmCoordinates(workplace.customer),
      },
      contact: {
        id: contact.id,
        displayName: contact.displayName,
        type: contact.type,
        specialtyName: contact.specialtyName,
        phone: contact.phone,
      },
      availability: directAssignment
        ? assignmentAvailability("DIRECT_CONTACT_ASSIGNMENT", directAssignment)
        : assignmentAvailability("WORKPLACE_ASSIGNMENT", customerAssignment),
    }]
  })
  const eligibility = items.length === 0
    ? {
        reason: await resolveEmptyReason(
          // Counted in doctors, not organizations: an agent can hold direct
          // contact assignments and no customers at all, and telling them
          // "no assignments" then would be simply false.
          await prisma.mtmContact.count({
            where: {
              organizationId: auth.orgId,
              deletedAt: null,
              status: "ACTIVE",
              type: "DOCTOR",
              AND: [
                { workplaces: { some: workplaceWhere } },
                {
                  OR: [
                    { agentAssignments: { some: { agentId, ...assignmentWindow } } },
                    { workplaces: { some: { ...workplaceWhere, customer: assignedCustomer } } },
                  ],
                },
              ],
            },
          }),
        ),
      }
    : null
  return NextResponse.json({
    success: common.success,
    data: {
      ...common,
      items,
      page: { number: page, limit, hasMore: contacts.length > limit },
      emptyReason: items.length === 0 ? LEGACY_EMPTY_REASON : null,
      eligibility,
    },
  })
})
