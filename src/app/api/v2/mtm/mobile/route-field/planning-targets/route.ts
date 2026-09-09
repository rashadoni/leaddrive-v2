import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { activeFieldAssignmentWindow } from "@/lib/mtm/field-scope"
import {
  eligibleFieldCustomerWhere,
  fieldEligibilityEmptyReason,
  type MtmFieldEligibilityReason,
} from "@/lib/mtm/field-eligibility"
import type { WorkCalendarOverride } from "@/lib/mtm/work-calendar"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import {
  issueRouteFieldPlanningTargetPage,
  readRouteFieldPlanningTargetPage,
  RouteFieldPlanningTargetPageCursorError,
} from "@/lib/mtm/route-field-planning-target-page"

const ROUTE_FIELD_PLANNING_TARGET_DEFAULT_LIMIT = 25
const ROUTE_FIELD_PLANNING_TARGET_MAX_LIMIT = 50
const ROUTE_FIELD_PLANNING_TARGET_SEARCH_MAX_LENGTH = 120
const ROUTE_FIELD_PLANNING_TARGET_KIND_MAX_LENGTH = 120
const ROUTE_FIELD_PLANNING_OBJECT_TYPES = new Set(["PHARMACY", "CLINIC", "STORE", "OTHER"])

type PlanningTargetKind = "organization" | "contact"

type PlanningWorkplace = {
  customerId: string
  isPrimary: boolean
  customer: { name: string; address: string | null; city: string | null }
}

type PlanningContact = {
  id: string
  displayName: string
  workplaces: PlanningWorkplace[]
}

const routeFieldPlanningOrganizationSelect = {
  id: true,
  name: true,
  address: true,
  city: true,
} satisfies Prisma.MtmCustomerSelect

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set("Cache-Control", "no-store")
  return NextResponse.json(body, { ...init, headers })
}

function normaliseSearch(value: string | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ")
}

function pageSize(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return ROUTE_FIELD_PLANNING_TARGET_DEFAULT_LIMIT
  return Math.min(ROUTE_FIELD_PLANNING_TARGET_MAX_LIMIT, Math.max(1, Number(value)))
}

function planningTargetKind(value: string | null): PlanningTargetKind | null {
  return value === "organization" || value === "contact" ? value : null
}

function optionalObjectType(value: string | null): "PHARMACY" | "CLINIC" | "STORE" | "OTHER" | null {
  return value && ROUTE_FIELD_PLANNING_OBJECT_TYPES.has(value)
    ? value as "PHARMACY" | "CLINIC" | "STORE" | "OTHER"
    : null
}

function activeWorkplaceWindow(date: Date) {
  return {
    deletedAt: null,
    AND: [
      { OR: [{ startedOn: null }, { startedOn: { lte: date } }] },
      { OR: [{ endedOn: null }, { endedOn: { gt: date } }] },
    ],
  }
}

function planningContactSearchWhere(search: string): Prisma.MtmContactWhereInput | null {
  if (!search) return null
  return {
    OR: [
      { displayName: { contains: search, mode: "insensitive" } },
      { specialtyName: { contains: search, mode: "insensitive" } },
    ],
  }
}

function customerKeysetFilter(page: { lastName: string | null; lastId: string | null } | null): Prisma.MtmCustomerWhereInput | null {
  if (!page || page.lastName === null || page.lastId === null) return null
  return {
    OR: [
      { name: { gt: page.lastName } },
      { name: page.lastName, id: { gt: page.lastId } },
    ],
  }
}

function contactKeysetFilter(page: { lastName: string | null; lastId: string | null } | null): Prisma.MtmContactWhereInput | null {
  if (!page || page.lastName === null || page.lastId === null) return null
  return {
    OR: [
      { displayName: { gt: page.lastName } },
      { displayName: page.lastName, id: { gt: page.lastId } },
    ],
  }
}

function selectPlanningWorkplace(workplaces: PlanningWorkplace[]): PlanningWorkplace | null {
  if (workplaces.length === 1) return workplaces[0]
  // Relation rows are ordered primary-first and capped at two. Therefore a
  // first primary plus a non-primary proves uniqueness; two primaries or no
  // primary are ambiguous and must never be guessed by the mobile planner.
  const primary = workplaces.filter((workplace) => workplace.isPrimary)
  return primary.length === 1 ? primary[0] : null
}

function projectPlanningContact(source: PlanningContact) {
  const workplace = selectPlanningWorkplace(source.workplaces)
  if (!workplace) return null
  return {
    kind: "contact" as const,
    contactId: source.id,
    name: source.displayName,
    customerId: workplace.customerId,
    organizationName: workplace.customer.name,
    address: workplace.customer.address ?? workplace.customer.city,
  }
}

function planningContactSelect(
  agentId: string,
  organizationId: string,
  routeDate: Date,
  customerAssignmentRequired: boolean,
) {
  const assignmentWindow = activeFieldAssignmentWindow(routeDate)
  return {
    id: true,
    displayName: true,
    workplaces: {
      where: {
        ...activeWorkplaceWindow(routeDate),
        customer: {
          organizationId,
          deletedAt: null,
          status: "ACTIVE",
          ...(customerAssignmentRequired
            ? { agentAssignments: { some: { agentId, ...assignmentWindow } } }
            : {}),
        },
      },
      orderBy: [{ isPrimary: "desc" }, { startedOn: "desc" }, { id: "asc" }],
      take: 2,
      select: {
        customerId: true,
        isPrimary: true,
        customer: { select: { name: true, address: true, city: true } },
      },
    },
  } satisfies Prisma.MtmContactSelect
}

/**
 * GET /api/v2/mtm/mobile/route-field/planning-targets
 *
 * Date-specific candidate lookup for the self planner. It uses no offset or
 * total and is not a sync stream. Every opaque continuation is bound to the
 * tenant, authenticated AGENT, route date and normalized filters. Contact
 * candidates are intentionally scanned in two disjoint phases: direct contact
 * assignments first, then customer assignments only where no direct contact
 * assignment exists. That preserves the write validator's eligibility rules
 * without ever choosing a workplace for an ambiguous direct assignment.
 */
export const GET = withMobileRls(async (req, auth) => {
  const permission = requireMobilePermission(auth, "ROUTE_EXECUTE")
  if (permission) {
    permission.headers.set("Cache-Control", "no-store")
    return permission
  }

  const [actor, settings] = await Promise.all([
    resolveMtmRouteActor(prisma, {
      organizationId: auth.orgId,
      userId: auth.userId,
      webRole: auth.role,
      agentId: auth.agentId,
    }),
    getMtmSettings(auth.orgId),
  ])
  if (!actor || actor.role !== "AGENT" || !actor.agentId || actor.agentId !== auth.agentId) {
    return noStoreJson({ error: "Forbidden", code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" }, { status: 403 })
  }
  if (actor.canPlanOwnRoutes === false) {
    return noStoreJson({ error: "Planning routes is not allowed", code: "MTM_ROUTE_FIELD_PLAN_PERMISSION_REQUIRED" }, { status: 403 })
  }

  const params = new URL(req.url).searchParams
  const kind = planningTargetKind(params.get("kind"))
  if (!kind) {
    return noStoreJson({ error: "Planning target kind is required", code: "MTM_ROUTE_FIELD_PLANNING_TARGET_KIND_INVALID" }, { status: 400 })
  }
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const today = currentDateKey(new Date(), timezone)
  const date = params.get("date")?.trim() ?? ""
  if (!isDateKey(date) || date < today) {
    return noStoreJson({ error: "Planning date must be today or later", code: "MTM_ROUTE_FIELD_PLANNING_DATE_INVALID" }, { status: 400 })
  }
  const search = normaliseSearch(params.get("search"))
  if (search.length > ROUTE_FIELD_PLANNING_TARGET_SEARCH_MAX_LENGTH) {
    return noStoreJson({ error: "Search is too long", code: "MTM_ROUTE_FIELD_PLANNING_TARGET_SEARCH_TOO_LONG" }, { status: 400 })
  }
  const organizationKind = normaliseSearch(params.get("organizationKind")) || null
  if (organizationKind && organizationKind.length > ROUTE_FIELD_PLANNING_TARGET_KIND_MAX_LENGTH) {
    return noStoreJson({ error: "Organization kind is too long", code: "MTM_ROUTE_FIELD_PLANNING_TARGET_KIND_TOO_LONG" }, { status: 400 })
  }
  const rawObjectType = normaliseSearch(params.get("objectType")) || null
  const objectType = optionalObjectType(rawObjectType)
  if ((rawObjectType && !objectType) || (kind === "contact" && (rawObjectType || organizationKind))) {
    return noStoreJson({ error: "Planning target filter is invalid", code: "MTM_ROUTE_FIELD_PLANNING_TARGET_FILTER_INVALID" }, { status: 400 })
  }

  const context = {
    organizationId: auth.orgId,
    agentId: actor.agentId,
    date,
    kind,
    search,
    objectType,
    organizationKind,
  }
  const rawPage = params.get("page")
  let page: ReturnType<typeof readRouteFieldPlanningTargetPage> | null = null
  if (rawPage) {
    try {
      page = readRouteFieldPlanningTargetPage(rawPage, context)
    } catch (error) {
      if (error instanceof RouteFieldPlanningTargetPageCursorError) {
        return noStoreJson({ error: "Invalid planning target page", code: "MTM_ROUTE_FIELD_PLANNING_TARGET_PAGE_INVALID" }, { status: 400 })
      }
      throw error
    }
  }

  const limit = pageSize(params.get("limit"))
  const routeDate = new Date(`${date}T00:00:00.000Z`)
  const assignmentWindow = activeFieldAssignmentWindow(routeDate)

  if (kind === "organization") {
    // The same scope the write validator uses (A2: one source of "points this
    // agent may work on"). Filtering on assignments alone made the planner
    // offer strictly LESS than the server accepts: a customer reachable
    // through an actionable route saves fine but never appeared in the list.
    // Doctors stay assignment-only on purpose — see the note in
    // validateMtmMobileRouteTargetEligibility — and that branch is untouched.
    const filters: Prisma.MtmCustomerWhereInput[] = [
      eligibleFieldCustomerWhere({ agentId: actor.agentId, date: routeDate }),
    ]
    const afterPage = customerKeysetFilter(page)
    if (afterPage) filters.push(afterPage)
    if (search) {
      filters.push({
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { code: { contains: search, mode: "insensitive" } },
          { address: { contains: search, mode: "insensitive" } },
        ],
      })
    }
    if (organizationKind) {
      filters.push({ organizationKind: { equals: organizationKind, mode: "insensitive" } })
    }
    const rows = await prisma.mtmCustomer.findMany({
      where: {
        organizationId: auth.orgId,
        deletedAt: null,
        status: "ACTIVE",
        objectType: objectType ?? { not: "DOCTOR" },
        AND: filters,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: routeFieldPlanningOrganizationSelect,
    })
    const pageRows = rows.slice(0, limit)
    const last = pageRows.at(-1)
    const nextPage = rows.length > limit && last
      ? issueRouteFieldPlanningTargetPage(context, { phase: "organization", last: { name: last.name, id: last.id } })
      : null
    // Why the list is empty, when the answer is honest. Runs only on the empty
    // path, so the extra reads never touch the common one (A2).
    //
    // Deliberately silent when the caller's own filters could explain it: a
    // search or a type that matched nothing is not "no assignments" and not
    // "territory", and the shared vocabulary has no word for it. A wrong
    // reason sends the agent to a manager over a typo; no reason lets the
    // screen say the plain thing.
    const callerNarrowed = Boolean(search || organizationKind || objectType)
    let eligibility: { reason: MtmFieldEligibilityReason } | null = null
    if (pageRows.length === 0 && !page && !callerNarrowed) {
      const [agentRow, eligibleTotal] = await Promise.all([
        prisma.mtmAgent.findFirst({
          where: { id: actor.agentId, organizationId: auth.orgId },
          select: { teamId: true },
        }),
        prisma.mtmCustomer.count({
          where: {
            organizationId: auth.orgId,
            deletedAt: null,
            status: "ACTIVE",
            AND: [eligibleFieldCustomerWhere({ agentId: actor.agentId, date: routeDate })],
          },
        }),
      ])
      const calendarOverrides = settings.enforceWorkCalendarForRoutes
        ? await prisma.mtmWorkCalendarDay.findMany({
            where: {
              organizationId: auth.orgId,
              date: routeDate,
              deletedAt: null,
              OR: [
                { teamId: null, agentId: null },
                ...(agentRow?.teamId ? [{ teamId: agentRow.teamId, agentId: null }] : []),
                { teamId: null, agentId: actor.agentId },
              ],
            },
            select: {
              id: true, date: true, kind: true, name: true,
              teamId: true, agentId: true, movedToDate: true, routePlanningAllowed: true,
            },
          })
        : []
      eligibility = {
        reason: fieldEligibilityEmptyReason({
          date: routeDate,
          dateKey: date,
          workCalendarEnforced: settings.enforceWorkCalendarForRoutes,
          calendarOverrides: calendarOverrides as WorkCalendarOverride[],
          teamId: agentRow?.teamId ?? null,
          agentId: actor.agentId,
          hasAnyEligibleSource: eligibleTotal > 0,
          // Nothing the caller typed narrowed this, so a non-empty eligible
          // set that still shows nothing was narrowed by scope.
          narrowedByTerritory: eligibleTotal > 0,
        }),
      }
    }

    return noStoreJson({
      success: true,
      data: {
        targets: pageRows.map((row) => ({
          kind: "organization" as const,
          customerId: row.id,
          name: row.name,
          address: row.address ?? row.city,
        })),
        nextPage,
        limit,
        date,
        timezone,
        eligibility,
      },
    })
  }

  const phase = page?.phase ?? "direct"
  if (phase !== "direct" && phase !== "customer") {
    return noStoreJson({ error: "Invalid planning target page", code: "MTM_ROUTE_FIELD_PLANNING_TARGET_PAGE_INVALID" }, { status: 400 })
  }
  const contactFilters: Prisma.MtmContactWhereInput[] = []
  const searchWhere = planningContactSearchWhere(search)
  if (searchWhere) contactFilters.push(searchWhere)
  const afterPage = contactKeysetFilter(page)
  if (afterPage) contactFilters.push(afterPage)
  const commonWhere: Prisma.MtmContactWhereInput = {
    organizationId: auth.orgId,
    deletedAt: null,
    status: "ACTIVE",
    type: "DOCTOR",
    ...(contactFilters.length > 0 ? { AND: contactFilters } : {}),
  }
  const directAssignment = { agentId: actor.agentId, ...assignmentWindow }
  const directWhere: Prisma.MtmContactWhereInput = {
    ...commonWhere,
    agentAssignments: { some: directAssignment },
    workplaces: {
      some: {
        ...activeWorkplaceWindow(routeDate),
        customer: { organizationId: auth.orgId, deletedAt: null, status: "ACTIVE" },
      },
    },
  }
  const customerAssignedWhere: Prisma.MtmContactWhereInput = {
    ...commonWhere,
    // This `none` is essential: a directly assigned contact must be evaluated
    // against every active workplace, never fall through to a narrower
    // customer-owned subset where a different workplace might be guessed.
    agentAssignments: { none: directAssignment },
    workplaces: {
      some: {
        ...activeWorkplaceWindow(routeDate),
        customer: {
          organizationId: auth.orgId,
          deletedAt: null,
          status: "ACTIVE",
          agentAssignments: { some: directAssignment },
        },
      },
    },
  }
  const rows = await prisma.mtmContact.findMany({
    where: phase === "direct" ? directWhere : customerAssignedWhere,
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    take: limit + 1,
    select: planningContactSelect(actor.agentId, auth.orgId, routeDate, phase === "customer"),
  }) as unknown as PlanningContact[]
  const pageRows = rows.slice(0, limit)
  const targets = pageRows
    .map(projectPlanningContact)
    .filter((target): target is NonNullable<ReturnType<typeof projectPlanningContact>> => target !== null)
  const last = pageRows.at(-1)
  const nextPage = rows.length > limit && last
    ? issueRouteFieldPlanningTargetPage(context, { phase, last: { name: last.displayName, id: last.id } })
    : phase === "direct"
      ? issueRouteFieldPlanningTargetPage(context, { phase: "customer" })
      : null

  // Doctors are scanned in two phases, so an empty `direct` page is not the
  // end of the list — `nextPage` still points at the customer-assigned phase.
  // Explaining emptiness there would say "no assignments" to an agent whose
  // second phase is about to return people. Only an exhausted search speaks.
  let contactEligibility: { reason: MtmFieldEligibilityReason } | null = null
  if (targets.length === 0 && nextPage === null && !Boolean(search)) {
    const [agentRow, eligibleTotal] = await Promise.all([
      prisma.mtmAgent.findFirst({
        where: { id: actor.agentId, organizationId: auth.orgId },
        select: { teamId: true },
      }),
      // Both arms, without the caller's filters: doctors stay assignment-only
      // by design, so "any eligible source" means an assignment of either
      // shape — the contact's own, or the workplace's customer.
      prisma.mtmContact.count({
        where: {
          organizationId: auth.orgId,
          deletedAt: null,
          status: "ACTIVE",
          type: "DOCTOR",
          OR: [
            { agentAssignments: { some: directAssignment } },
            {
              workplaces: {
                some: {
                  ...activeWorkplaceWindow(routeDate),
                  customer: {
                    organizationId: auth.orgId,
                    deletedAt: null,
                    status: "ACTIVE",
                    agentAssignments: { some: directAssignment },
                  },
                },
              },
            },
          ],
        },
      }),
    ])
    const calendarOverrides = settings.enforceWorkCalendarForRoutes
      ? await prisma.mtmWorkCalendarDay.findMany({
          where: {
            organizationId: auth.orgId,
            date: routeDate,
            deletedAt: null,
            OR: [
              { teamId: null, agentId: null },
              ...(agentRow?.teamId ? [{ teamId: agentRow.teamId, agentId: null }] : []),
              { teamId: null, agentId: actor.agentId },
            ],
          },
          select: {
            id: true, date: true, kind: true, name: true,
            teamId: true, agentId: true, movedToDate: true, routePlanningAllowed: true,
          },
        })
      : []
    contactEligibility = {
      reason: fieldEligibilityEmptyReason({
        date: routeDate,
        dateKey: date,
        workCalendarEnforced: settings.enforceWorkCalendarForRoutes,
        calendarOverrides: calendarOverrides as WorkCalendarOverride[],
        teamId: agentRow?.teamId ?? null,
        agentId: actor.agentId,
        hasAnyEligibleSource: eligibleTotal > 0,
        narrowedByTerritory: eligibleTotal > 0,
      }),
    }
  }

  return noStoreJson({
    success: true,
    data: { targets, nextPage, limit, date, timezone, eligibility: contactEligibility },
  })
}, { requiredCapability: "route-field" })
