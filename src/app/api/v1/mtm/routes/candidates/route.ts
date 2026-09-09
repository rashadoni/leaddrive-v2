import { Prisma, type MtmCustomerCategory } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { activeFieldAssignmentWindow, contactScopeForActor } from "@/lib/mtm/field-scope"
import { CoverageSnapshotExplanationSchema } from "@/lib/mtm/coverage-policy"
import { readGovernedCoverage, type GovernedCoverageRead } from "@/lib/mtm/coverage-read"
import { resolveMtmRouteActor, isAgentInRouteScope } from "@/lib/mtm/route-permissions"
import { resolveWorkCalendarDay, type WorkCalendarOverride } from "@/lib/mtm/work-calendar"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  createMtmRouteCandidateCursor,
  isMtmRouteCandidateKeysetSort,
  MtmRouteCandidateCursorError,
  mtmRouteCandidateCursorBinding,
  MTM_ROUTE_CANDIDATE_KEYSET_DEFAULT_LIMIT,
  MTM_ROUTE_CANDIDATE_KEYSET_MAX_LIMIT,
  readMtmRouteCandidateCursor,
} from "@/lib/mtm/route-candidate-cursor"

type Direction = "DOCTOR" | "PHARMACY" | "ORGANIZATION"
type Period = "5_DAYS" | "7_DAYS" | "MONTH"
type CandidateSort = "NAME" | "PRIORITY" | "LAST_VISIT" | "COVERAGE_GAP"
type CandidateCoverageRow = {
  groupKey: string
  requiredCoverage: string
  actualMoi: string
  target: string
  actualCoverage: string
  uncoveredMoi: string
  explanation: { summary: { ru: string; az: string; en: string } }
}
type CandidateCoverageResult = {
  preview: {
    available: boolean
    state: string
    reason?: string
    period: { start: string; end: string }
    policy?: { version: number; approvalReference: string | null }
    snapshot?: { id: string; frozenAt: Date | null }
    groups?: Array<{
      key: string
      label: string
      labels?: { ru: string; az: string; en: string }
      order: number
      subjectType: "DOCTOR" | "PHARMACY"
      populationCount: number
      requiredCoverage: string
      actualMoi: string
      target: string
      actualCoverage: string
      uncoveredMoi: string
    }>
  }
  rows: Map<string, CandidateCoverageRow>
}
type CandidateAvailabilitySource =
  | "DIRECT_CONTACT_ASSIGNMENT"
  | "WORKPLACE_ASSIGNMENT"
  | "ORGANIZATION_ASSIGNMENT"
  | "ACTIVE_CATALOG"
type CandidateAvailability = {
  source: CandidateAvailabilitySource
  validFrom: string | null
  validThrough: string | null
}
type CandidateSelectionScope = {
  mode: "AGENT_ASSIGNMENTS" | "ACTIVE_CATALOG"
  activeOnly: true
  assignmentRequired: boolean
  agentId: string
  effectiveOn: string
}

type CandidatePaginationRequest = {
  requested: boolean
  limit: number
  cursor: string | null
}

const legacyCandidateLimit = 500
const mtmCustomerCategoryOrder: readonly MtmCustomerCategory[] = ["A", "B", "C", "D"]

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/

function mtmCustomerCategoryCursorBoundary(value: string | undefined): {
  category: MtmCustomerCategory
  categoriesAfter: MtmCustomerCategory[]
} | null {
  const categoryIndex = mtmCustomerCategoryOrder.indexOf(value as MtmCustomerCategory)
  if (categoryIndex < 0) return null
  return {
    category: mtmCustomerCategoryOrder[categoryIndex],
    categoriesAfter: [...mtmCustomerCategoryOrder.slice(categoryIndex + 1)],
  }
}

function utcDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`)
}

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function candidateAvailability(
  source: CandidateAvailabilitySource,
  assignment?: { effectiveFrom: Date; effectiveTo: Date | null } | null,
): CandidateAvailability {
  if (!assignment) {
    return { source, validFrom: null, validThrough: null }
  }

  return {
    source,
    validFrom: assignment.effectiveFrom.toISOString().slice(0, 10),
    // Assignment effectiveTo is exclusive in the data model. Expose the last
    // included workday so the planner can explain the period in plain language.
    validThrough: assignment.effectiveTo
      ? addUtcDays(assignment.effectiveTo, -1).toISOString().slice(0, 10)
      : null,
  }
}

function planningDateKeys(startDate: string, period: Period): string[] {
  const start = utcDate(startDate)
  if (period !== "MONTH") {
    const count = period === "5_DAYS" ? 5 : 7
    return Array.from({ length: count }, (_, index) => addUtcDays(start, index).toISOString().slice(0, 10))
  }

  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
  const dates: string[] = []
  for (let cursor = start; cursor < end; cursor = addUtcDays(cursor, 1)) {
    dates.push(cursor.toISOString().slice(0, 10))
  }
  return dates
}

function strings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right))
}

function organizations(values: Array<{ id: string; name: string }>): Array<{ id: string; name: string }> {
  return [...new Map(values.map((value) => [value.id, value])).values()]
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
}

function coverageValueScale4(value: string): bigint {
  const [whole, fraction = ""] = value.split(".")
  return (BigInt(whole) * 10_000n) + BigInt((fraction + "0000").slice(0, 4))
}

function forbidden() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
}

function candidatePaginationBadRequest(code: string, error: string) {
  return NextResponse.json({
    error,
    code,
    messageKey: "candidatePaginationInvalid",
    current: null,
    remedies: ["RELOAD_CANDIDATES"],
  }, { status: 400 })
}

function readCandidatePagination(params: URLSearchParams): CandidatePaginationRequest | Response {
  const mode = params.get("pagination")
  const cursor = params.get("cursor")
  if (!mode) {
    if (cursor) return candidatePaginationBadRequest("MTM_ROUTE_CANDIDATE_CURSOR_INVALID", "A candidate cursor requires pagination=keyset")
    return { requested: false, limit: legacyCandidateLimit, cursor: null }
  }
  if (mode !== "keyset") {
    return candidatePaginationBadRequest("MTM_ROUTE_CANDIDATE_PAGINATION_INVALID", "Unsupported candidate pagination mode")
  }

  const rawLimit = params.get("limit")
  const limit = rawLimit === null || rawLimit === ""
    ? MTM_ROUTE_CANDIDATE_KEYSET_DEFAULT_LIMIT
    : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > MTM_ROUTE_CANDIDATE_KEYSET_MAX_LIMIT) {
    return candidatePaginationBadRequest("MTM_ROUTE_CANDIDATE_PAGINATION_INVALID", "Candidate pagination limit is invalid")
  }
  return { requested: true, limit, cursor: cursor || null }
}

function candidatePaginationMetadata(input: {
  requested: boolean
  supported: boolean
  limit: number
  hasMore?: boolean
  nextCursor?: string | null
}) {
  if (!input.requested) return undefined
  if (!input.supported) {
    return {
      schemaVersion: 1,
      mode: "LEGACY_CAP" as const,
      supported: false,
      sortIntegrity: "PARTIAL" as const,
      limit: legacyCandidateLimit,
      hasMore: false,
      nextCursor: null,
      reason: "GLOBAL_KEYSET_NOT_AVAILABLE" as const,
    }
  }
  return {
    schemaVersion: 1,
    mode: "KEYSET" as const,
    supported: true,
    sortIntegrity: "FULL" as const,
    limit: input.limit,
    hasMore: Boolean(input.hasMore),
    nextCursor: input.nextCursor ?? null,
  }
}

async function loadCandidateCoverage(
  coverage: GovernedCoverageRead,
  organizationId: string,
  subjectType: Direction,
  subjectIds: string[],
): Promise<CandidateCoverageResult> {
  if (!coverage.available || !coverage.snapshot || !coverage.policy || !coverage.totals) {
    return {
      preview: {
        available: false,
        state: coverage.state,
        reason: coverage.state,
        period: coverage.period,
        ...(coverage.policy ? { policy: { version: coverage.policy.version, approvalReference: coverage.policy.approvalReference } } : {}),
      },
      rows: new Map<string, CandidateCoverageRow>(),
    }
  }

  const storedRows = subjectIds.length ? await prisma.mtmCoverageSnapshotRow.findMany({
    where: {
      organizationId,
      snapshotId: coverage.snapshot.id,
      subjectType,
      subjectId: { in: subjectIds },
    },
    select: {
      subjectId: true,
      groupKey: true,
      requiredCoverage: true,
      actualMoi: true,
      target: true,
      actualCoverage: true,
      uncoveredMoi: true,
      explanation: true,
    },
  }) : []
  const rows = new Map<string, CandidateCoverageRow>()
  for (const row of storedRows) {
    const explanation = CoverageSnapshotExplanationSchema.safeParse(row.explanation)
    if (!explanation.success) {
      return {
        preview: { available: false, state: "COVERAGE_ROW_EXPLANATION_INVALID", reason: "COVERAGE_ROW_EXPLANATION_INVALID", period: coverage.period },
        rows: new Map<string, CandidateCoverageRow>(),
      }
    }
    rows.set(row.subjectId, {
      groupKey: row.groupKey,
      requiredCoverage: row.requiredCoverage.toString(),
      actualMoi: row.actualMoi.toString(),
      target: row.target.toString(),
      actualCoverage: row.actualCoverage.toString(),
      uncoveredMoi: row.uncoveredMoi.toString(),
      explanation: explanation.data,
    })
  }
  return {
    preview: {
      available: true,
      state: "READY",
      period: coverage.period,
      policy: { version: coverage.policy.version, approvalReference: coverage.policy.approvalReference },
      snapshot: { id: coverage.snapshot.id, frozenAt: coverage.snapshot.frozenAt },
      groups: coverage.totals.groups.filter((group) => group.subjectType === subjectType),
    },
    rows,
  }
}

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return forbidden()

  const params = new URL(req.url).searchParams
  const agentId = params.get("agentId")?.trim() ?? ""
  const startDate = params.get("startDate")?.trim() ?? ""
  const requestedDirection = params.get("direction")
  const direction: Direction = requestedDirection === "DOCTOR" || requestedDirection === "PHARMACY"
    ? requestedDirection
    : "ORGANIZATION"
  const period = ["5_DAYS", "7_DAYS", "MONTH"].includes(params.get("period") ?? "")
    ? params.get("period") as Period
    : "5_DAYS"
  const sort = ["NAME", "PRIORITY", "LAST_VISIT", "COVERAGE_GAP"].includes(params.get("sort") ?? "")
    ? params.get("sort") as CandidateSort
    : "NAME"
  const search = params.get("search")?.trim() ?? ""
  const region = params.get("region")?.trim() ?? ""
  const administrativeDistrict = params.get("administrativeDistrict")?.trim() ?? ""
  const locality = params.get("locality")?.trim() ?? ""
  const cityDistrict = params.get("cityDistrict")?.trim() ?? ""
  const organizationKind = params.get("organizationKind")?.trim() ?? ""
  const objectType = params.get("objectType")?.trim() ?? ""
  const customerId = params.get("customerId")?.trim() ?? ""
  const specialtyCode = params.get("specialtyCode")?.trim() ?? ""
  const psychotype = params.get("psychotype")?.trim() ?? ""
  const excludeRouteId = params.get("excludeRouteId")?.trim() ?? ""
  const paginationRequest = readCandidatePagination(params)
  if (paginationRequest instanceof Response) return paginationRequest
  const keysetSort = isMtmRouteCandidateKeysetSort(sort) ? sort : "NAME"
  const keysetPaginationActive = paginationRequest.requested && isMtmRouteCandidateKeysetSort(sort)
  if (!keysetPaginationActive && paginationRequest.cursor) {
    return candidatePaginationBadRequest(
      "MTM_ROUTE_CANDIDATE_CURSOR_UNSUPPORTED_SORT",
      "The selected candidate sort does not support a keyset cursor",
    )
  }

  if (!agentId || !dateKeyPattern.test(startDate)) {
    return NextResponse.json({
      error: "agentId and a valid startDate are required",
      code: "MTM_PLANNING_CANDIDATE_INPUT_INVALID",
    }, { status: 400 })
  }
  if (!isAgentInRouteScope(actor, agentId)) return forbidden()

  const dateKeys = planningDateKeys(startDate, period)
  const rangeStart = utcDate(dateKeys[0])
  const rangeEnd = addUtcDays(utcDate(dateKeys[dateKeys.length - 1]), 1)
  const monthStart = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), 1))
  const monthEnd = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth() + 1, 1))
  const coveragePeriodEnd = addUtcDays(monthEnd, -1)
  const assignmentWindow = activeFieldAssignmentWindow(rangeStart)

  const targetAgent = await prisma.mtmAgent.findFirst({
    where: { id: agentId, organizationId: auth.orgId, status: "ACTIVE" },
    select: { id: true, name: true, teamId: true },
  })
  if (!targetAgent) {
    return NextResponse.json({ error: "Agent is inactive or unavailable", code: "MTM_PLANNING_AGENT_INVALID" }, { status: 404 })
  }
  const coveragePromise = readGovernedCoverage(prisma, {
    organizationId: auth.orgId,
    agentId,
    periodStart: monthStart,
    periodEnd: coveragePeriodEnd,
    periodStartKey: monthStart.toISOString().slice(0, 10),
    periodEndKey: coveragePeriodEnd.toISOString().slice(0, 10),
  })

  const workplaceCustomerFilter: Prisma.MtmCustomerWhereInput = {
    organizationId: auth.orgId,
    deletedAt: null,
    status: "ACTIVE",
    ...(customerId ? { id: customerId } : {}),
    ...(region ? { region: { equals: region, mode: "insensitive" } } : {}),
    ...(administrativeDistrict ? { administrativeDistrict: { equals: administrativeDistrict, mode: "insensitive" } } : {}),
    ...(locality ? { locality: { equals: locality, mode: "insensitive" } } : {}),
    ...(cityDistrict ? { cityDistrict: { equals: cityDistrict, mode: "insensitive" } } : {}),
    ...(organizationKind ? { organizationKind: { equals: organizationKind, mode: "insensitive" } } : {}),
    ...(objectType && ["PHARMACY", "CLINIC", "STORE", "OTHER"].includes(objectType)
      ? { objectType: objectType as "PHARMACY" | "CLINIC" | "STORE" | "OTHER" }
      : {}),
  }
  const targetContactScope: Prisma.MtmContactWhereInput = {
    OR: [
      { agentAssignments: { some: { agentId, ...assignmentWindow } } },
      {
        workplaces: {
          some: {
            deletedAt: null,
            endedOn: null,
            customer: {
              ...workplaceCustomerFilter,
              agentAssignments: { some: { agentId, ...assignmentWindow } },
            },
          },
        },
      },
    ],
  }
  const targetCustomerScope: Prisma.MtmCustomerWhereInput = {
    agentAssignments: { some: { agentId, ...assignmentWindow } },
  }
  const selectionScope: CandidateSelectionScope = {
    mode: direction === "ORGANIZATION" && actor.role === "ADMIN"
      ? "ACTIVE_CATALOG"
      : "AGENT_ASSIGNMENTS",
    activeOnly: true,
    assignmentRequired: direction !== "ORGANIZATION" || actor.role !== "ADMIN",
    agentId,
    effectiveOn: startDate,
  }
  const cursorBinding = keysetPaginationActive
    ? mtmRouteCandidateCursorBinding({
        organizationId: auth.orgId,
        userId: auth.userId,
        principal: auth.principal,
        authAgentId: auth.agentId,
        actorRole: actor.role,
        actorAgentId: actor.agentId,
        scopedAgentIds: actor.scopedAgentIds,
        query: {
          agentId,
          startDate,
          direction,
          period,
          sort,
          search,
          region,
          administrativeDistrict,
          locality,
          cityDistrict,
          organizationKind,
          objectType,
          customerId,
          specialtyCode,
          psychotype,
          excludeRouteId,
        },
      })
    : null
  let candidateCursor: ReturnType<typeof readMtmRouteCandidateCursor> | null = null
  if (keysetPaginationActive && paginationRequest.cursor && cursorBinding) {
    try {
      candidateCursor = readMtmRouteCandidateCursor({ token: paginationRequest.cursor, binding: cursorBinding })
    } catch (error) {
      const code = error instanceof MtmRouteCandidateCursorError && error.code === "EXPIRED"
        ? "MTM_ROUTE_CANDIDATE_CURSOR_EXPIRED"
        : "MTM_ROUTE_CANDIDATE_CURSOR_INVALID"
      return candidatePaginationBadRequest(code, "The candidate cursor is invalid or no longer matches this query")
    }
  }
  const candidatePageLimit = keysetPaginationActive ? paginationRequest.limit : legacyCandidateLimit
  const candidateCursorKind = direction === "DOCTOR" ? "CONTACT" : "CUSTOMER"
  if (candidateCursor && (candidateCursor.kind !== candidateCursorKind || candidateCursor.sort !== sort)) {
    return candidatePaginationBadRequest("MTM_ROUTE_CANDIDATE_CURSOR_INVALID", "The candidate cursor does not match this result type")
  }

  const calendarPromise = prisma.mtmWorkCalendarDay.findMany({
    where: {
      organizationId: auth.orgId,
      date: { gte: rangeStart, lt: rangeEnd },
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
  const routesPromise = prisma.mtmRoute.findMany({
    where: {
      organizationId: auth.orgId,
      deletedAt: null,
      ...(excludeRouteId ? { id: { not: excludeRouteId } } : {}),
      date: { gte: rangeStart, lt: rangeEnd },
      status: { in: ["DRAFT", "PLANNED", "IN_PROGRESS"] },
      OR: [
        { agentId },
        { assignments: { some: { agentId, removedAt: null } } },
      ],
    },
    select: {
      id: true,
      date: true,
      status: true,
      version: true,
      points: {
        where: { deletedAt: null },
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          customerId: true,
          contactId: true,
          orderIndex: true,
          plannedTime: true,
          customer: {
            select: {
              id: true,
              name: true,
              address: true,
              objectType: true,
              organizationKind: true,
            },
          },
          contact: {
            select: {
              id: true,
              displayName: true,
              specialtyName: true,
            },
          },
        },
      },
    },
  })

  if (direction === "DOCTOR") {
    const contactAnd: Prisma.MtmContactWhereInput[] = [targetContactScope]
    if (actor.role !== "ADMIN") contactAnd.push(contactScopeForActor(actor, rangeStart))
    if (search) {
      contactAnd.push({
        OR: [
          { displayName: { contains: search, mode: "insensitive" } },
          { externalCode: { contains: search, mode: "insensitive" } },
          { specialtyName: { contains: search, mode: "insensitive" } },
          {
            workplaces: {
              some: {
                deletedAt: null,
                endedOn: null,
                customer: {
                  OR: [
                    { name: { contains: search, mode: "insensitive" } },
                    { code: { contains: search, mode: "insensitive" } },
                    { address: { contains: search, mode: "insensitive" } },
                  ],
                },
              },
            },
          },
        ],
      })
    }
    if (Object.keys(workplaceCustomerFilter).length > 3) {
      contactAnd.push({
        workplaces: {
          some: { deletedAt: null, endedOn: null, customer: workplaceCustomerFilter },
        },
      })
    }
    // The legacy result can count a directly assigned contact with no active
    // workplace and then omit it during projection. Keyset pages make that
    // routable-target requirement part of the query so total/hasMore stay true.
    if (keysetPaginationActive) {
      contactAnd.push({
        workplaces: {
          some: { deletedAt: null, endedOn: null, customer: workplaceCustomerFilter },
        },
      })
    }

    const contactBaseWhere: Prisma.MtmContactWhereInput = {
      organizationId: auth.orgId,
      deletedAt: null,
      type: "DOCTOR",
      status: "ACTIVE",
      ...(specialtyCode ? { specialtyCode } : {}),
      ...(psychotype ? {
        doctorAssessments: { some: { status: "VERIFIED", psychotype } },
      } : {}),
      AND: contactAnd,
    }
    const contactAfterWhere: Prisma.MtmContactWhereInput | null = candidateCursor
      ? sort === "PRIORITY"
        ? (() => {
            const boundary = mtmCustomerCategoryCursorBoundary(candidateCursor.values.category)
            if (!boundary) return { id: { in: [] } }
            return {
              OR: [
                { category: { in: boundary.categoriesAfter } },
                { category: boundary.category, displayName: { gt: candidateCursor.values.name } },
                { category: boundary.category, displayName: candidateCursor.values.name, id: { gt: candidateCursor.values.id } },
              ],
            }
          })()
        : {
            OR: [
              { displayName: { gt: candidateCursor.values.name } },
              { displayName: candidateCursor.values.name, id: { gt: candidateCursor.values.id } },
            ],
          }
      : null
    const contactWhere: Prisma.MtmContactWhereInput = contactAfterWhere
      ? { ...contactBaseWhere, AND: [...contactAnd, contactAfterWhere] }
      : contactBaseWhere

    const [contacts, total, calendarOverrides, existingRoutes, governedCoverage] = await Promise.all([
      prisma.mtmContact.findMany({
        where: contactWhere,
        take: keysetPaginationActive ? candidatePageLimit + 1 : candidatePageLimit,
        orderBy: sort === "PRIORITY"
          ? [{ category: "asc" }, { displayName: "asc" }, { id: "asc" }]
          : [{ displayName: "asc" }, { id: "asc" }],
        include: {
          agentAssignments: {
            where: { agentId, ...assignmentWindow },
            orderBy: { effectiveFrom: "desc" },
            take: 1,
            select: { effectiveFrom: true, effectiveTo: true },
          },
          workplaces: {
            where: { deletedAt: null, endedOn: null, customer: workplaceCustomerFilter },
            orderBy: [{ isPrimary: "desc" }, { startedOn: "desc" }],
            include: {
              customer: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  objectType: true,
                  organizationKind: true,
                  address: true,
                  region: true,
                  administrativeDistrict: true,
                  locality: true,
                  cityDistrict: true,
                  city: true,
                  district: true,
                  territoryCode: true,
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
          doctorAssessments: {
            where: { status: "VERIFIED" },
            orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
            take: 1,
            select: { psychotype: true, actualScore: true, formulaVersion: true, reviewedAt: true },
          },
          visits: {
            where: { organizationId: auth.orgId, deletedAt: null, status: "CHECKED_OUT" },
            orderBy: { checkInAt: "desc" },
            take: 25,
            select: {
              id: true,
              checkInAt: true,
              agent: { select: { id: true, name: true } },
              customer: { select: { id: true, name: true } },
            },
          },
          _count: {
            select: {
              visits: {
                where: {
                  organizationId: auth.orgId,
                  deletedAt: null,
                  status: "CHECKED_OUT",
                  checkInAt: { gte: monthStart, lt: monthEnd },
                },
              },
            },
          },
          routePoints: {
            where: {
              deletedAt: null,
              route: {
                organizationId: auth.orgId,
                deletedAt: null,
                status: { in: ["DRAFT", "PLANNED", "IN_PROGRESS"] },
                date: { gte: rangeStart, lt: rangeEnd },
                OR: [
                  { agentId },
                  { assignments: { some: { agentId, removedAt: null } } },
                ],
              },
            },
            orderBy: [{ route: { date: "asc" } }, { orderIndex: "asc" }],
            select: {
              id: true,
              routeId: true,
              route: { select: { date: true, status: true, version: true } },
            },
          },
        },
      }),
      prisma.mtmContact.count({ where: contactBaseWhere }),
      calendarPromise,
      routesPromise,
      coveragePromise,
    ])

    const pageContacts = keysetPaginationActive ? contacts.slice(0, candidatePageLimit) : contacts
    const hasMore = keysetPaginationActive && contacts.length > candidatePageLimit
    const baseCandidates = pageContacts.flatMap((contact) => {
      const directAssignment = contact.agentAssignments[0]
      const workplace = directAssignment
        ? contact.workplaces[0]
        : contact.workplaces.find((item) => item.customer.agentAssignments.length > 0)
      if (!workplace) return []
      const assessment = contact.doctorAssessments[0]
      const {
        agentAssignments: workplaceAssignments,
        ...candidateCustomer
      } = workplace.customer
      const workplaceAssignment = workplaceAssignments[0]
      return [{
        id: `contact:${contact.id}`,
        kind: "DOCTOR" as const,
        customerId: workplace.customer.id,
        contactId: contact.id,
        name: contact.displayName,
        code: contact.externalCode,
        category: contact.category,
        specialtyCode: contact.specialtyCode,
        specialtyName: contact.specialtyName,
        psychotype: assessment?.psychotype ?? null,
        score: assessment?.actualScore?.toString() ?? null,
        scoreFormulaVersion: assessment?.formulaVersion ?? null,
        lastVisitAt: contact.visits[0]?.checkInAt?.toISOString() ?? null,
        monthlyVisitCount: contact._count?.visits ?? 0,
        monthlyVisitSources: contact.visits
          .filter((visit) => visit.checkInAt >= monthStart && visit.checkInAt < monthEnd)
          .map((visit) => ({
            id: visit.id,
            checkInAt: visit.checkInAt.toISOString(),
            agent: visit.agent,
            customer: visit.customer,
          })),
        plannedRoute: contact.routePoints[0]?.route
          ? {
              id: contact.routePoints[0].routeId,
              date: contact.routePoints[0].route.date.toISOString().slice(0, 10),
              status: contact.routePoints[0].route.status,
            }
          : null,
        plannedRoutes: contact.routePoints.map((point) => ({
          pointId: point.id,
          id: point.routeId,
          date: point.route.date.toISOString().slice(0, 10),
          status: point.route.status,
          version: point.route.version,
        })),
        availability: directAssignment
          ? candidateAvailability("DIRECT_CONTACT_ASSIGNMENT", directAssignment)
          : candidateAvailability("WORKPLACE_ASSIGNMENT", workplaceAssignment),
        customer: candidateCustomer,
      }]
    })
    const candidateCoverage = await loadCandidateCoverage(
      governedCoverage,
      auth.orgId,
      "DOCTOR",
      baseCandidates.map((candidate) => candidate.contactId),
    )
    const candidates = baseCandidates.map((candidate) => ({
      ...candidate,
      coverage: candidateCoverage.rows.get(candidate.contactId) ?? null,
    }))
    if (sort === "LAST_VISIT") {
      candidates.sort((left, right) => {
        if (!left.lastVisitAt && !right.lastVisitAt) return left.name.localeCompare(right.name)
        if (!left.lastVisitAt) return -1
        if (!right.lastVisitAt) return 1
        return left.lastVisitAt.localeCompare(right.lastVisitAt) || left.name.localeCompare(right.name)
      })
    } else if (sort === "COVERAGE_GAP") {
      candidates.sort((left, right) => {
        const leftGap = left.coverage ? coverageValueScale4(left.coverage.uncoveredMoi) : -1n
        const rightGap = right.coverage ? coverageValueScale4(right.coverage.uncoveredMoi) : -1n
        return leftGap === rightGap ? left.name.localeCompare(right.name) : leftGap > rightGap ? -1 : 1
      })
    }
    const nextCursor = keysetPaginationActive && hasMore && cursorBinding && pageContacts.length
      ? createMtmRouteCandidateCursor({
          binding: cursorBinding,
          kind: "CONTACT",
          sort: keysetSort,
          values: {
            name: pageContacts[pageContacts.length - 1].displayName,
            id: pageContacts[pageContacts.length - 1].id,
            ...(sort === "PRIORITY" ? { category: pageContacts[pageContacts.length - 1].category } : {}),
          },
        })
      : null
    const pagination = candidatePaginationMetadata({
      requested: paginationRequest.requested,
      supported: keysetPaginationActive,
      limit: candidatePageLimit,
      hasMore,
      nextCursor,
    })

    return NextResponse.json({
      success: true,
      data: {
        candidates,
        total,
        limited: total > legacyCandidateLimit,
        ...(pagination ? { pagination } : {}),
        direction,
        period,
        agent: targetAgent,
        selectionScope,
        planningDays: buildPlanningDays(dateKeys, calendarOverrides as WorkCalendarOverride[], existingRoutes, targetAgent.teamId, agentId),
        facets: {
          region: strings(candidates.map((candidate) => candidate.customer.region)),
          administrativeDistrict: strings(candidates.map((candidate) => candidate.customer.administrativeDistrict)),
          locality: strings(candidates.map((candidate) => candidate.customer.locality)),
          cityDistrict: strings(candidates.map((candidate) => candidate.customer.cityDistrict)),
          organizationKind: strings(candidates.map((candidate) => candidate.customer.organizationKind)),
          objectType: strings(candidates.map((candidate) => candidate.customer.objectType)),
          organization: organizations(candidates.map((candidate) => ({
            id: candidate.customer.id,
            name: candidate.customer.name,
          }))),
          specialtyCode: strings(candidates.map((candidate) => candidate.specialtyCode)),
          psychotype: strings(candidates.map((candidate) => candidate.psychotype)),
        },
        coverage: candidateCoverage.preview,
      },
    })
  }

  const organizationAnd: Prisma.MtmCustomerWhereInput[] = []
  // A web administrator may build an explicit route from the active organization
  // catalogue before a long-lived ownership assignment exists. The route itself
  // becomes the scoped access path for its assigned agents. Manager/agent reads
  // remain limited to the selected agent's effective assignment base.
  if (direction !== "ORGANIZATION" || actor.role !== "ADMIN") {
    organizationAnd.push(targetCustomerScope)
  }
  if (search) {
    organizationAnd.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { address: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ],
    })
  }
  const organizationBaseWhere: Prisma.MtmCustomerWhereInput = {
    ...workplaceCustomerFilter,
    ...(direction === "PHARMACY" ? { objectType: "PHARMACY" as const } : {}),
    ...(organizationAnd.length ? { AND: organizationAnd } : {}),
  }
  const organizationAfterWhere: Prisma.MtmCustomerWhereInput | null = candidateCursor
    ? sort === "PRIORITY"
      ? (() => {
          const boundary = mtmCustomerCategoryCursorBoundary(candidateCursor.values.category)
          if (!boundary) return { id: { in: [] } }
          return {
            OR: [
              { category: { in: boundary.categoriesAfter } },
              { category: boundary.category, name: { gt: candidateCursor.values.name } },
              { category: boundary.category, name: candidateCursor.values.name, id: { gt: candidateCursor.values.id } },
            ],
          }
        })()
      : {
          OR: [
            { name: { gt: candidateCursor.values.name } },
            { name: candidateCursor.values.name, id: { gt: candidateCursor.values.id } },
          ],
        }
    : null
  const organizationWhere: Prisma.MtmCustomerWhereInput = organizationAfterWhere
    ? { ...organizationBaseWhere, AND: [...organizationAnd, organizationAfterWhere] }
    : organizationBaseWhere
  const [customerOrganizations, total, calendarOverrides, existingRoutes, governedCoverage] = await Promise.all([
    prisma.mtmCustomer.findMany({
      where: organizationWhere,
      take: keysetPaginationActive ? candidatePageLimit + 1 : candidatePageLimit,
      orderBy: sort === "PRIORITY"
        ? [{ category: "asc" }, { name: "asc" }, { id: "asc" }]
        : [{ name: "asc" }, { id: "asc" }],
      include: {
        agentAssignments: {
          where: { agentId, ...assignmentWindow },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
          select: { effectiveFrom: true, effectiveTo: true },
        },
        visits: {
          where: { organizationId: auth.orgId, deletedAt: null, status: "CHECKED_OUT" },
          orderBy: { checkInAt: "desc" },
          take: 25,
          select: {
            id: true,
            checkInAt: true,
            agent: { select: { id: true, name: true } },
            customer: { select: { id: true, name: true } },
          },
        },
        _count: {
          select: {
            visits: {
              where: {
                organizationId: auth.orgId,
                deletedAt: null,
                status: "CHECKED_OUT",
                checkInAt: { gte: monthStart, lt: monthEnd },
              },
            },
          },
        },
        routePoints: {
          where: {
            deletedAt: null,
            contactId: null,
            route: {
              organizationId: auth.orgId,
              deletedAt: null,
              status: { in: ["DRAFT", "PLANNED", "IN_PROGRESS"] },
              date: { gte: rangeStart, lt: rangeEnd },
              OR: [
                { agentId },
                { assignments: { some: { agentId, removedAt: null } } },
              ],
            },
          },
          orderBy: [{ route: { date: "asc" } }, { orderIndex: "asc" }],
          select: {
            id: true,
            routeId: true,
            route: { select: { date: true, status: true, version: true } },
          },
        },
      },
    }),
    prisma.mtmCustomer.count({ where: organizationBaseWhere }),
    calendarPromise,
    routesPromise,
    coveragePromise,
  ])
  const pageCustomerOrganizations = keysetPaginationActive
    ? customerOrganizations.slice(0, candidatePageLimit)
    : customerOrganizations
  const hasMore = keysetPaginationActive && customerOrganizations.length > candidatePageLimit
  const baseCandidates = pageCustomerOrganizations.map((customer) => {
    const { agentAssignments, ...candidateCustomer } = customer
    return {
      id: `customer:${customer.id}`,
      kind: direction,
      customerId: customer.id,
      contactId: null,
      name: customer.name,
      code: customer.code,
      category: customer.category,
      specialtyCode: null,
      specialtyName: null,
      psychotype: null,
      score: null,
      scoreFormulaVersion: null,
      lastVisitAt: customer.visits[0]?.checkInAt?.toISOString() ?? null,
      monthlyVisitCount: customer._count?.visits ?? 0,
      monthlyVisitSources: customer.visits
        .filter((visit) => visit.checkInAt >= monthStart && visit.checkInAt < monthEnd)
        .map((visit) => ({
          id: visit.id,
          checkInAt: visit.checkInAt.toISOString(),
          agent: visit.agent,
          customer: visit.customer,
        })),
      plannedRoute: customer.routePoints[0]?.route
        ? {
            id: customer.routePoints[0].routeId,
            date: customer.routePoints[0].route.date.toISOString().slice(0, 10),
            status: customer.routePoints[0].route.status,
          }
        : null,
      plannedRoutes: customer.routePoints.map((point) => ({
        pointId: point.id,
        id: point.routeId,
        date: point.route.date.toISOString().slice(0, 10),
        status: point.route.status,
        version: point.route.version,
      })),
      availability: agentAssignments[0]
        ? candidateAvailability("ORGANIZATION_ASSIGNMENT", agentAssignments[0])
        : candidateAvailability("ACTIVE_CATALOG"),
      customer: candidateCustomer,
    }
  })
  const candidateCoverage = direction === "PHARMACY"
    ? await loadCandidateCoverage(
        governedCoverage,
        auth.orgId,
        "PHARMACY",
        baseCandidates.map((candidate) => candidate.customerId),
      )
    : { preview: null, rows: new Map<string, CandidateCoverageRow>() }
  const candidates = baseCandidates.map((candidate) => ({
    ...candidate,
    coverage: candidateCoverage.rows.get(candidate.customerId) ?? null,
  }))
  if (sort === "LAST_VISIT") {
    candidates.sort((left, right) => {
      if (!left.lastVisitAt && !right.lastVisitAt) return left.name.localeCompare(right.name)
      if (!left.lastVisitAt) return -1
      if (!right.lastVisitAt) return 1
      return left.lastVisitAt.localeCompare(right.lastVisitAt) || left.name.localeCompare(right.name)
    })
  } else if (sort === "COVERAGE_GAP") {
    candidates.sort((left, right) => {
      const leftGap = left.coverage ? coverageValueScale4(left.coverage.uncoveredMoi) : -1n
      const rightGap = right.coverage ? coverageValueScale4(right.coverage.uncoveredMoi) : -1n
      return leftGap === rightGap ? left.name.localeCompare(right.name) : leftGap > rightGap ? -1 : 1
    })
  }
  const nextCursor = keysetPaginationActive && hasMore && cursorBinding && pageCustomerOrganizations.length
    ? createMtmRouteCandidateCursor({
        binding: cursorBinding,
        kind: "CUSTOMER",
        sort: keysetSort,
        values: {
          name: pageCustomerOrganizations[pageCustomerOrganizations.length - 1].name,
          id: pageCustomerOrganizations[pageCustomerOrganizations.length - 1].id,
          ...(sort === "PRIORITY" ? { category: pageCustomerOrganizations[pageCustomerOrganizations.length - 1].category } : {}),
        },
      })
    : null
  const pagination = candidatePaginationMetadata({
    requested: paginationRequest.requested,
    supported: keysetPaginationActive,
    limit: candidatePageLimit,
    hasMore,
    nextCursor,
  })

  return NextResponse.json({
    success: true,
    data: {
      candidates,
      total,
      limited: total > legacyCandidateLimit,
      ...(pagination ? { pagination } : {}),
      direction,
      period,
      agent: targetAgent,
      selectionScope,
      planningDays: buildPlanningDays(dateKeys, calendarOverrides as WorkCalendarOverride[], existingRoutes, targetAgent.teamId, agentId),
      facets: {
        region: strings(candidates.map((candidate) => candidate.customer.region)),
        administrativeDistrict: strings(candidates.map((candidate) => candidate.customer.administrativeDistrict)),
        locality: strings(candidates.map((candidate) => candidate.customer.locality)),
        cityDistrict: strings(candidates.map((candidate) => candidate.customer.cityDistrict)),
        organizationKind: strings(candidates.map((candidate) => candidate.customer.organizationKind)),
        objectType: strings(candidates.map((candidate) => candidate.customer.objectType)),
        organization: organizations(candidates.map((candidate) => ({
          id: candidate.customer.id,
          name: candidate.customer.name,
        }))),
        specialtyCode: [],
        psychotype: [],
      },
      coverage: candidateCoverage.preview,
    },
  })
})

function buildPlanningDays(
  dateKeys: string[],
  calendarOverrides: WorkCalendarOverride[],
  routes: Array<{
    id: string
    date: Date
    status: string
    version: number
    points: Array<{
      id: string
      customerId: string
      contactId: string | null
      orderIndex: number
      plannedTime: Date | null
      customer: {
        id: string
        name: string
        address: string | null
        objectType: string
        organizationKind: string | null
      }
      contact: { id: string; displayName: string; specialtyName: string | null } | null
    }>
  }>,
  teamId: string | null,
  agentId: string,
) {
  return dateKeys.map((date) => {
    const calendar = resolveWorkCalendarDay({ date, overrides: calendarOverrides, teamId, agentId })
    const dateRoutes = routes.filter((route) => route.date.toISOString().slice(0, 10) === date)
    return {
      ...calendar,
      routeCount: dateRoutes.length,
      plannedStops: dateRoutes.reduce((sum, route) => sum + route.points.length, 0),
      hasRouteConflict: dateRoutes.some((route) => route.status === "PLANNED" || route.status === "IN_PROGRESS"),
      routes: dateRoutes.map((route) => ({
        id: route.id,
        status: route.status,
        version: route.version,
        points: route.points,
      })),
    }
  })
}
