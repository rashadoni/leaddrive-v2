import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { getMtmSettings } from "@/lib/mtm-settings"
import { addDateKeyDays, currentDateKey, isDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { dateInputValueInTimezone, isValidTimezone } from "@/lib/timezone"
import {
  buildExplainableKpi,
  isValidKpiCoordinatePair,
  type ExplainableKpiAdjustment,
  type ExplainableKpiFact,
  type ExplainableKpiPlanPoint,
  type ExplainableKpiVisitType,
} from "@/lib/mtm/explainable-kpi"
import { KpiPolicyDefinitionSchema, kpiPolicySignatureIsCoherent } from "@/lib/mtm/kpi-policy"
import { workforceEnabledForMixedSurface } from "@/lib/workforce-capability"

const MAX_RANGE_DAYS = 366
const MAX_FACTS = 10_000
const MAX_AGENTS = 500
const VISIT_TYPES = new Set<ExplainableKpiVisitType>(["ALL", "DOUBLE", "INDEPENDENT"])

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function normalizeVisitType(raw: string | null | undefined, hasParticipant: boolean): "DOUBLE" | "INDEPENDENT" {
  const value = raw?.toUpperCase()
  if (value === "DOUBLE" || value === "JOINT") return "DOUBLE"
  if (value === "INDEPENDENT" || value === "SELF") return "INDEPENDENT"
  return hasParticipant ? "DOUBLE" : "INDEPENDENT"
}

function creditedFactAgents(
  primary: { id: string; name: string },
  participants: Array<{ agentId: string; agent: { name: string } }>,
  selectedAgentIds: ReadonlySet<string>,
): Array<{ id: string; name: string }> {
  const agents = new Map<string, { id: string; name: string }>()
  if (selectedAgentIds.has(primary.id)) agents.set(primary.id, primary)
  for (const participant of participants) {
    if (selectedAgentIds.has(participant.agentId)) {
      agents.set(participant.agentId, { id: participant.agentId, name: participant.agent.name })
    }
  }
  const creditedPrimary = agents.get(primary.id)
  const collaborators = [...agents.values()]
    .filter((agent) => agent.id !== primary.id)
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
  return creditedPrimary ? [creditedPrimary, ...collaborators] : collaborators
}

function isVisibleAgent(agentId: string, visibleAgentIds: ReadonlySet<string> | null): boolean {
  return !visibleAgentIds || visibleAgentIds.has(agentId)
}

function routeAssignmentsAtDate<T extends { assignedAt: Date; removedAt: Date | null }>(
  assignments: T[],
  date: Date,
  timezone: string,
): T[] {
  const routeDateKey = dateKey(date)
  const dayStart = localDateKeyToUtc(routeDateKey, timezone).getTime()
  const dayEnd = localDateKeyToUtc(addDateKeyDays(routeDateKey, 1), timezone).getTime()
  return assignments.filter((item) => item.assignedAt.getTime() < dayEnd && (!item.removedAt || item.removedAt.getTime() >= dayStart))
}

function visitParticipantsAtTime<T extends { joinedAt: Date; leftAt: Date | null }>(participants: T[], at: Date): T[] {
  return participants.filter((item) => item.joinedAt <= at && (!item.leftAt || item.leftAt >= at))
}

function gpsEvidenceState(input: {
  status: string
  checkInLat: number | null
  checkInLng: number | null
  checkOutLat: number | null
  checkOutLng: number | null
}): ExplainableKpiFact["gpsEvidenceState"] {
  if (input.checkInLat == null || input.checkInLng == null) return "MISSING_CHECK_IN"
  if (!isValidKpiCoordinatePair(input.checkInLat, input.checkInLng)) return "INVALID_CHECK_IN"
  if (input.checkOutLat == null || input.checkOutLng == null) return "MISSING_CHECK_OUT"
  if (!isValidKpiCoordinatePair(input.checkOutLat, input.checkOutLng)) return "INVALID_CHECK_OUT"
  return input.status === "CHECKED_OUT" ? "CONFIRMED" : "MISSING_CHECK_OUT"
}

function brandIdsFromEvidence(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  const record = value as Record<string, unknown>
  const ids = new Set<string>()
  if (typeof record.brandId === "string" && record.brandId.trim()) ids.add(record.brandId.trim())
  if (Array.isArray(record.brandIds)) {
    for (const id of record.brandIds) if (typeof id === "string" && id.trim()) ids.add(id.trim())
  }
  return [...ids]
}

type PotentialBrandEvidence = {
  id: string
  supersedesPotentialId: string | null
  brandId: string
  status: string
  periodStart: string | null
  periodEnd: string | null
}

function potentialActiveOnDate(evidence: PotentialBrandEvidence, factDate: string): boolean {
  return (evidence.status === "VERIFIED" || evidence.status === "ENDED") &&
    (!evidence.periodStart || evidence.periodStart <= factDate) &&
    (!evidence.periodEnd || evidence.periodEnd >= factDate)
}

function potentialStartedOnDate(evidence: PotentialBrandEvidence, factDate: string): boolean {
  return (evidence.status === "VERIFIED" || evidence.status === "ENDED") &&
    (!evidence.periodStart || evidence.periodStart <= factDate)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function adjustmentFromAudit(row: {
  id: string
  action: string
  entityId: string | null
  agentId: string | null
  newData: unknown
  createdAt: Date
}): ExplainableKpiAdjustment | null {
  const data = record(row.newData)
  const factType = data?.factType
  if (!row.entityId || data?.formulaVersion !== "SWM_PLAN_GPS_V1" ||
      (factType !== "PLAN_POINT" && factType !== "GPS_VISIT")) return null
  return {
    factType,
    factId: row.entityId,
    action: row.action === "KPI_FACT_RESTORED" ? "RESTORE" : "EXCLUDE",
    reason: typeof data?.reason === "string" ? data.reason : "",
    createdAt: row.createdAt.toISOString(),
    actorAgentId: row.agentId,
    auditId: row.id,
  }
}

export const GET = withRouteFieldWebRlsAuth("read", async (req, session) => {
  const orgId = session.orgId
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: orgId,
    userId: session.userId,
    webRole: session.role,
  })
  if (!actor || actor.role === "AGENT") {
    return NextResponse.json({ error: "Manager access required" }, { status: 403 })
  }
  const workforceEnabled = await workforceEnabledForMixedSurface(orgId, "MTM/kpi GET")

  const url = new URL(req.url)
  const now = new Date()
  const settings = await getMtmSettings(orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const today = currentDateKey(now, timezone)
  const fromKey = url.searchParams.get("from") ?? `${today.slice(0, 7)}-01`
  const toKey = url.searchParams.get("to") ?? addDateKeyDays(today, 1)
  const visitType = (url.searchParams.get("visitType") ?? "ALL").toUpperCase() as ExplainableKpiVisitType
  const agentId = url.searchParams.get("agentId")?.trim() || null
  const teamId = url.searchParams.get("teamId")?.trim() || null
  const brandId = url.searchParams.get("brandId")?.trim() || null
  if (!isDateKey(fromKey) || !isDateKey(toKey)) {
    return NextResponse.json({ error: "Invalid date range (maximum 366 days)" }, { status: 400 })
  }
  const from = utcDate(fromKey)
  const to = utcDate(toKey)
  const activityFrom = localDateKeyToUtc(fromKey, timezone)
  const activityTo = localDateKeyToUtc(toKey, timezone)
  if (to <= from || (to.getTime() - from.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: "Invalid date range (maximum 366 days)" }, { status: 400 })
  }
  if (!VISIT_TYPES.has(visitType)) {
    return NextResponse.json({ error: "visitType must be ALL, DOUBLE or INDEPENDENT" }, { status: 400 })
  }

  const inclusiveTo = utcDate(addDateKeyDays(toKey, -1))
  const policyRow = await prisma.mtmKpiPolicy.findFirst({
    where: {
      organizationId: orgId,
      status: { in: ["ACTIVE", "RETIRED"] },
      effectiveFrom: { lte: from },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: inclusiveTo } }],
    },
    orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
  })
  const policyDefinition = policyRow ? KpiPolicyDefinitionSchema.safeParse(policyRow.definition) : null
  const approvedPolicy = policyRow && policyDefinition?.success && kpiPolicySignatureIsCoherent(policyRow)
    ? {
        id: policyRow.id,
        code: policyRow.code,
        // The three names exist on every policy and were not being sent, so the
        // dashboard had nothing to show but the code (task T14). The reader
        // picks by locale; the server stays locale-agnostic.
        nameRu: policyRow.nameRu,
        nameAz: policyRow.nameAz,
        nameEn: policyRow.nameEn,
        version: policyRow.version,
        definitionHash: policyRow.definitionHash,
        approvalReference: policyRow.approvalReference!,
        effectiveFrom: dateKey(policyRow.effectiveFrom),
        effectiveTo: policyRow.effectiveTo ? dateKey(policyRow.effectiveTo) : null,
      }
    : null

  const scopedIds = actor.scopedAgentIds
  if (agentId && scopedIds && !scopedIds.includes(agentId)) {
    return NextResponse.json({ success: true, data: { agents: [], teams: [], report: null, outOfScope: true } })
  }
  const agentRows = await prisma.mtmAgent.findMany({
    where: {
      organizationId: orgId,
      ...(agentId ? { id: agentId } : scopedIds ? { id: { in: scopedIds } } : {}),
      ...(teamId ? { teamId } : {}),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: MAX_AGENTS + 1,
    select: { id: true, name: true, status: true, teamId: true, team: { select: { name: true } } },
  })
  const rosterTruncated = agentRows.length > MAX_AGENTS
  const agents = agentRows.slice(0, MAX_AGENTS)
  const selectedAgents = agents
  const factAgentIds = selectedAgents.map((agent) => agent.id)
  // Visibility is actor-scoped, not filter-scoped. This keeps the displayed
  // primary owner stable when the same joint fact is opened through team and
  // employee filters. `attributedAgentIds` records every visible participant.
  const managerVisibleAgentIds = scopedIds ? new Set(scopedIds) : null
  const factScope: Prisma.MtmRouteWhereInput = factAgentIds.length
    ? { OR: [
        { agentId: { in: factAgentIds } },
        { assignments: { some: { agentId: { in: factAgentIds }, role: { not: "OBSERVER" } } } },
      ] }
    : { agentId: "__no_access__" }
  const visitFactScope: Prisma.MtmVisitWhereInput = factAgentIds.length
    ? { OR: [
        { agentId: { in: factAgentIds } },
        { participants: { some: { agentId: { in: factAgentIds }, role: { not: "OBSERVER" } } } },
      ] }
    : { agentId: "__no_access__" }
  const [routePoints, visits] = await Promise.all([
    prisma.mtmRoutePoint.findMany({
      where: {
        deletedAt: null,
        route: {
          organizationId: orgId, deletedAt: null, status: { notIn: ["DRAFT", "CANCELLED"] },
          date: { gte: from, lt: to }, ...factScope,
        },
      },
      orderBy: [{ routeId: "asc" }, { orderIndex: "asc" }, { id: "asc" }],
      take: MAX_FACTS + 1,
      select: {
        id: true, customerId: true, contactId: true, status: true, visitedAt: true,
        customer: { select: { name: true } },
        route: {
          select: {
            id: true, date: true, updatedAt: true, agentId: true, agent: { select: { name: true } },
            assignments: {
              where: { role: { not: "OBSERVER" } },
              orderBy: [{ agentId: "asc" }, { assignedAt: "asc" }],
              select: { agentId: true, role: true, assignedAt: true, removedAt: true, agent: { select: { name: true } } },
            },
          },
        },
      },
    }),
    prisma.mtmVisit.findMany({
      where: { organizationId: orgId, deletedAt: null, checkInAt: { gte: activityFrom, lt: activityTo }, ...visitFactScope },
      orderBy: [{ checkInAt: "asc" }, { id: "asc" }],
      take: MAX_FACTS + 1,
      select: {
        id: true, agentId: true, customerId: true, contactId: true, routePointId: true,
        status: true, checkInAt: true, updatedAt: true, checkInLat: true, checkInLng: true, checkOutLat: true, checkOutLng: true,
        agent: { select: { name: true } }, customer: { select: { name: true } },
        requirementSnapshot: { select: { sourcePolicy: { select: { visitType: true } } } },
        participants: {
          where: { role: { not: "OBSERVER" } },
          orderBy: [{ agentId: "asc" }, { joinedAt: "asc" }],
          select: { agentId: true, joinedAt: true, leftAt: true, agent: { select: { name: true } } },
        },
        actionResults: { where: { status: "COMPLETED" }, select: { evidence: true, updatedAt: true } },
      },
    }),
  ])
  const selectedAgentIds = new Set(factAgentIds)
  const scopedRoutePoints = routePoints.slice(0, MAX_FACTS).filter((point) => {
    const activeAssignments = routeAssignmentsAtDate(point.route.assignments, point.route.date, timezone)
    return selectedAgentIds.has(point.route.agentId) ||
      activeAssignments.some((item) => selectedAgentIds.has(item.agentId))
  })
  const scopedVisits = visits.slice(0, MAX_FACTS).filter((visit) => {
    const activeParticipants = visitParticipantsAtTime(visit.participants, visit.checkInAt)
    return selectedAgentIds.has(visit.agentId) ||
      activeParticipants.some((item) => selectedAgentIds.has(item.agentId))
  })
  const customerIds = new Set<string>()
  const contactIds = new Set<string>()
  for (const point of scopedRoutePoints) {
    customerIds.add(point.customerId)
    if (point.contactId) contactIds.add(point.contactId)
  }
  for (const visit of scopedVisits) {
    customerIds.add(visit.customerId)
    if (visit.contactId) contactIds.add(visit.contactId)
  }
  // Per-agent brand potential follows the agents credited by the applied
  // cohort, never an out-of-scope primary owner of a joint fact.
  const potentialOwnerIds = new Set<string>()
  for (const point of scopedRoutePoints) {
    const activeAssignments = routeAssignmentsAtDate(point.route.assignments, point.route.date, timezone)
    for (const agent of creditedFactAgents(
      { id: point.route.agentId, name: point.route.agent.name },
      activeAssignments,
      selectedAgentIds,
    )) potentialOwnerIds.add(agent.id)
  }
  for (const visit of scopedVisits) {
    const activeParticipants = visitParticipantsAtTime(visit.participants, visit.checkInAt)
    for (const agent of creditedFactAgents(
      { id: visit.agentId, name: visit.agent.name },
      activeParticipants,
      selectedAgentIds,
    )) potentialOwnerIds.add(agent.id)
  }
  const potentials = customerIds.size || contactIds.size
    ? await prisma.mtmFieldPotential.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          brandExternalId: { not: null },
          AND: [
            settings.brandPotentialPerAgentEnabled
              ? { agentId: { in: [...potentialOwnerIds] } }
              : { agentId: null },
            { OR: [
              ...(customerIds.size ? [{ customerId: { in: [...customerIds] } }] : []),
              ...(contactIds.size ? [{ contactId: { in: [...contactIds] } }] : []),
            ] },
          ],
        },
        // Keep the newest revisions when the safety cap is reached. The
        // result is marked PARTIAL, so omitted history is never authoritative.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MAX_FACTS + 1,
        select: {
          id: true, supersedesPotentialId: true, status: true, agentId: true,
          customerId: true, contactId: true, brandExternalId: true, brandName: true,
          periodStart: true, periodEnd: true, updatedAt: true,
        },
      })
    : []
  const brandsBySubject = new Map<string, PotentialBrandEvidence[]>()
  const brandNames = new Map<string, string>()
  for (const potential of potentials.slice(0, MAX_FACTS)) {
    if (!potential.brandExternalId) continue
    if (!brandNames.has(potential.brandExternalId)) {
      brandNames.set(potential.brandExternalId, potential.brandName ?? potential.brandExternalId)
    }
    const ownerKey = potential.agentId ?? "shared"
    for (const key of [
      potential.contactId ? `${ownerKey}:contact:${potential.contactId}` : null,
      potential.customerId ? `${ownerKey}:customer:${potential.customerId}` : null,
    ]) {
      if (!key) continue
      const values = brandsBySubject.get(key) ?? []
      values.push({
        id: potential.id,
        supersedesPotentialId: potential.supersedesPotentialId,
        brandId: potential.brandExternalId,
        status: potential.status,
        periodStart: potential.periodStart ? dateKey(potential.periodStart) : null,
        periodEnd: potential.periodEnd ? dateKey(potential.periodEnd) : null,
      })
      brandsBySubject.set(key, values)
    }
  }
  const potentialById = new Map(potentials.slice(0, MAX_FACTS).map((potential) => [potential.id, potential]))
  const evaluatedPotentialIds = new Set<string>()
  const brandResolutionCache = new Map<string, { brandIds: string[]; evaluatedPotentialIds: string[] }>()
  const subjectBrands = (
    customerId: string,
    contactId: string | null,
    creditedAgentIds: string[],
    factDate: string,
  ) => {
    const keys = [
      ...(contactId ? [`shared:contact:${contactId}`] : []),
      `shared:customer:${customerId}`,
      ...creditedAgentIds.flatMap((creditedAgentId) => [
        ...(contactId ? [`${creditedAgentId}:contact:${contactId}`] : []),
        `${creditedAgentId}:customer:${customerId}`,
      ]),
    ]
    const uniqueKeys = [...new Set(keys)].sort()
    const cacheKey = `${factDate}\0${uniqueKeys.join("\0")}`
    const cached = brandResolutionCache.get(cacheKey)
    if (cached) {
      for (const potentialId of cached.evaluatedPotentialIds) evaluatedPotentialIds.add(potentialId)
      return cached.brandIds
    }
    const candidates = new Map(uniqueKeys.flatMap((key) => brandsBySubject.get(key) ?? [])
      .map((evidence) => [evidence.id, evidence]))
    // Every candidate attached to a fact's eligible subject/owner cohort is a
    // freshness source. A status or validity edit can make a row cease to be
    // effective; looking only at today's effective rows would then hide the
    // very update that changed the KPI.
    for (const potentialId of candidates.keys()) evaluatedPotentialIds.add(potentialId)
    const startedCandidates = [...candidates.values()].filter((evidence) => potentialStartedOnDate(evidence, factDate))
    const startedIds = new Set(startedCandidates.map((evidence) => evidence.id))
    const supersededStartedIds = new Set<string>()
    const nearestStartedAncestorCache = new Map<string, string | null>()
    const nearestStartedAncestor = (initialId: string | null): string | null => {
      if (!initialId) return null
      const path: string[] = []
      const seen = new Set<string>()
      let currentId: string | null = initialId
      while (currentId && !seen.has(currentId)) {
        if (startedIds.has(currentId)) {
          for (const pathId of path) nearestStartedAncestorCache.set(pathId, currentId)
          return currentId
        }
        if (nearestStartedAncestorCache.has(currentId)) {
          const resolved = nearestStartedAncestorCache.get(currentId) ?? null
          for (const pathId of path) nearestStartedAncestorCache.set(pathId, resolved)
          return resolved
        }
        seen.add(currentId)
        path.push(currentId)
        currentId = potentialById.get(currentId)?.supersedesPotentialId ?? null
      }
      for (const pathId of path) nearestStartedAncestorCache.set(pathId, null)
      return null
    }
    for (const candidate of startedCandidates) {
      const ancestorId = nearestStartedAncestor(candidate.supersedesPotentialId)
      if (ancestorId) supersededStartedIds.add(ancestorId)
    }
    const effectiveCandidates = startedCandidates
      .filter((evidence) => !supersededStartedIds.has(evidence.id))
      .filter((evidence) => potentialActiveOnDate(evidence, factDate))
    const resolved = {
      brandIds: effectiveCandidates.map((evidence) => evidence.brandId),
      evaluatedPotentialIds: [...candidates.keys()],
    }
    brandResolutionCache.set(cacheKey, resolved)
    return resolved.brandIds
  }
  const visitActionBrandIds = new Map(scopedVisits.map((visit) => [
    visit.id,
    [...new Set(visit.actionResults.flatMap((result) => brandIdsFromEvidence(result.evidence)))],
  ]))
  const truncationReasons: Array<{ cohort: string; limit: number }> = []
  if (rosterTruncated) truncationReasons.push({ cohort: "agents", limit: MAX_AGENTS })
  if (routePoints.length > MAX_FACTS) truncationReasons.push({ cohort: "routePoints", limit: MAX_FACTS })
  if (visits.length > MAX_FACTS) truncationReasons.push({ cohort: "visits", limit: MAX_FACTS })
  if (potentials.length > MAX_FACTS) truncationReasons.push({ cohort: "brandPotentials", limit: MAX_FACTS })
  let truncated = truncationReasons.length > 0
  const visitFacts: ExplainableKpiFact[] = scopedVisits.flatMap((visit) => {
    const activeParticipants = visitParticipantsAtTime(visit.participants, visit.checkInAt)
    if (!selectedAgentIds.has(visit.agentId) && !activeParticipants.some((item) => selectedAgentIds.has(item.agentId))) return []
    const creditedAgents = creditedFactAgents(
      { id: visit.agentId, name: visit.agent.name },
      activeParticipants,
      selectedAgentIds,
    )
    const creditedAgent = creditedAgents[0]
    if (!creditedAgent) return []
    const attributedAgentIds = creditedAgents.map((agent) => agent.id)
    const factDate = dateInputValueInTimezone(visit.checkInAt, timezone)
    const evidenceState = gpsEvidenceState(visit)
    return [{
      visitId: visit.id,
      agentId: creditedAgent.id,
      agentName: creditedAgent.name,
      sourceAgentId: isVisibleAgent(visit.agentId, managerVisibleAgentIds) ? visit.agentId : null,
      sourceAgentName: isVisibleAgent(visit.agentId, managerVisibleAgentIds) ? visit.agent.name : null,
      customerId: visit.customerId,
      customerName: visit.customer.name,
      contactId: visit.contactId,
      routePointId: visit.routePointId,
      date: factDate,
      visitType: normalizeVisitType(visit.requirementSnapshot?.sourcePolicy?.visitType, activeParticipants.length > 0),
      brandIds: [...new Set([
        ...subjectBrands(visit.customerId, visit.contactId, attributedAgentIds, factDate),
        ...(visitActionBrandIds.get(visit.id) ?? []),
      ])],
      completed: visit.status === "CHECKED_OUT",
      gpsConfirmed: visit.status === "CHECKED_OUT" && evidenceState === "CONFIRMED",
      gpsEvidenceState: evidenceState,
      attributedAgentIds,
      attributedAgents: creditedAgents,
      adjustable: actor.role === "ADMIN" || scopedIds === null || scopedIds.includes(visit.agentId),
    }]
  })
  for (const brandIdValue of visitFacts.flatMap((visit) => visit.brandIds)) {
    if (!brandNames.has(brandIdValue)) brandNames.set(brandIdValue, brandIdValue)
  }
  const workdayDatesByAgent = new Map<string, Set<string>>()
  for (const visit of visitFacts) {
    if (!visit.completed) continue
    const dates = workdayDatesByAgent.get(visit.agentId) ?? new Set<string>()
    dates.add(visit.date)
    workdayDatesByAgent.set(visit.agentId, dates)
  }
  // GPS-day enrichment is exact and bounded by the completed visit cohort.
  // Querying every roster member for every calendar day would make a normal
  // 400-person month partial even when only a handful of agents have visits.
  const workdays = workforceEnabled && workdayDatesByAgent.size
    ? await prisma.mtmAgentWorkday.findMany({
        where: {
          organizationId: orgId,
          OR: [...workdayDatesByAgent.entries()].map(([workdayAgentId, dates]) => ({
            agentId: workdayAgentId,
            workDate: { in: [...dates].map(utcDate) },
          })),
        },
        orderBy: [{ workDate: "asc" }, { agentId: "asc" }],
        take: MAX_FACTS + 1,
        select: { id: true, agentId: true, workDate: true, status: true, updatedAt: true },
      })
    : []
  const visitsByPoint = new Map<string, ExplainableKpiFact[]>()
  for (const visit of visitFacts) {
    if (!visit.routePointId) continue
    const linked = visitsByPoint.get(visit.routePointId) ?? []
    linked.push(visit)
    visitsByPoint.set(visit.routePointId, linked)
  }
  const planPoints: ExplainableKpiPlanPoint[] = scopedRoutePoints.flatMap((point) => {
    const linkedVisits = visitsByPoint.get(point.id) ?? []
    // A route point is complete when any linked visit completed. For the
    // point's visit-type evidence, prefer a completed visit, then valid GPS,
    // then the lexicographically smallest immutable visit id. Brand evidence
    // comes from date-valid potential plus explicit actions across linked
    // visits instead of depending on row order.
    const visit = [...linkedVisits].sort((left, right) =>
      Number(right.completed) - Number(left.completed) ||
      Number(right.gpsConfirmed) - Number(left.gpsConfirmed) ||
      left.visitId.localeCompare(right.visitId))[0]
    const activeAssignments = routeAssignmentsAtDate(point.route.assignments, point.route.date, timezone)
    if (!selectedAgentIds.has(point.route.agentId) && !activeAssignments.some((item) => selectedAgentIds.has(item.agentId))) return []
    const creditedAgents = creditedFactAgents(
      { id: point.route.agentId, name: point.route.agent.name },
      activeAssignments,
      selectedAgentIds,
    )
    const creditedAgent = creditedAgents[0]
    if (!creditedAgent) return []
    const attributedAgentIds = creditedAgents.map((agent) => agent.id)
    const factDate = dateKey(point.route.date)
    return [{
      routePointId: point.id, routeId: point.route.id, agentId: creditedAgent.id, agentName: creditedAgent.name,
      sourceAgentId: isVisibleAgent(point.route.agentId, managerVisibleAgentIds) ? point.route.agentId : null,
      sourceAgentName: isVisibleAgent(point.route.agentId, managerVisibleAgentIds) ? point.route.agent.name : null,
      customerId: point.customerId, customerName: point.customer.name, contactId: point.contactId,
      date: factDate, visitType: visit?.visitType ?? normalizeVisitType(
        null,
        activeAssignments.some((assignment) => assignment.role === "PARTICIPANT"),
      ),
      brandIds: [...new Set([
        ...subjectBrands(point.customerId, point.contactId, attributedAgentIds, factDate),
        ...linkedVisits.flatMap((item) => visitActionBrandIds.get(item.visitId) ?? []),
      ])],
      completed: point.status === "VISITED" || linkedVisits.some((item) => item.completed),
      attributedAgentIds,
      attributedAgents: creditedAgents,
      adjustable: actor.role === "ADMIN" || scopedIds === null || scopedIds.includes(point.route.agentId),
    }]
  })
  const adjustmentRowsRaw = await prisma.mtmAuditLog.findMany({
    where: {
      organizationId: orgId,
      entity: "kpi_fact",
      action: { in: ["KPI_FACT_EXCLUDED", "KPI_FACT_RESTORED"] },
      entityId: { in: [...planPoints.map((point) => point.routePointId), ...visitFacts.map((visit) => visit.visitId)] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_FACTS + 1,
    select: { id: true, action: true, entityId: true, agentId: true, newData: true, createdAt: true },
  })
  if (adjustmentRowsRaw.length > MAX_FACTS) {
    truncated = true
    truncationReasons.push({ cohort: "adjustments", limit: MAX_FACTS })
  }
  const adjustmentRows = adjustmentRowsRaw.slice(0, MAX_FACTS)
  const adjustments = adjustmentRows.flatMap((row) => {
    const adjustment = adjustmentFromAudit(row)
    return adjustment ? [adjustment] : []
  })
  const sourceDates = [
    ...scopedRoutePoints.flatMap((point) => [point.route.updatedAt, ...(point.visitedAt ? [point.visitedAt] : [])]),
    ...scopedVisits.flatMap((visit) => [
      visit.updatedAt,
      ...visit.actionResults.map((result) => result.updatedAt).filter((value): value is Date => value instanceof Date),
    ]),
    ...workdays.slice(0, MAX_FACTS).map((workday) => workday.updatedAt),
    ...potentials.slice(0, MAX_FACTS).filter((potential) => evaluatedPotentialIds.has(potential.id)).map((potential) => potential.updatedAt),
    ...adjustmentRows.map((adjustment) => adjustment.createdAt),
  ]
  const sourceUpdatedAt = sourceDates.length
    ? new Date(Math.max(...sourceDates.map((value) => value.getTime())))
    : null
  const includesToday = fromKey <= today && today < toKey
  const sourceFreshness = !sourceUpdatedAt
    ? "NO_SOURCE" as const
    : !includesToday
      ? "HISTORICAL" as const
      : now.getTime() - sourceUpdatedAt.getTime() > 15 * 60_000
        ? "LATE" as const
        : "CURRENT" as const
  const calculatedReport = buildExplainableKpi({
    planPoints,
    visits: visitFacts,
    visitType,
    brandId,
    generatedAt: new Date(),
    adjustments,
    sourceUpdatedAt,
    sourceFreshness,
    completeness: truncated ? "PARTIAL" : "COMPLETE",
    workdays: workdays.slice(0, MAX_FACTS).map((workday) => ({
      id: workday.id,
      agentId: workday.agentId,
      date: dateKey(workday.workDate),
      state: workday.status,
    })),
    includeWorkforce: workforceEnabled,
  })
  const report = {
    ...calculatedReport,
    formula: {
      ...calculatedReport.formula,
      authoritative: calculatedReport.formula.authoritative && Boolean(approvedPolicy),
      policy: approvedPolicy,
      authorityReason: approvedPolicy
        ? calculatedReport.formula.authoritative ? "SIGNED_POLICY" as const : "PARTIAL_DATA" as const
        : "UNSIGNED_POLICY" as const,
    },
  }
  const teams = Array.from(new Map(agents.filter((agent) => agent.teamId).map((agent) => [agent.teamId!, { id: agent.teamId!, name: agent.team?.name ?? "—" }])).values())
  const availableBrandIds = new Set([
    ...planPoints.flatMap((point) => point.brandIds),
    ...visitFacts.flatMap((visit) => visit.brandIds),
  ])
  const brands = [...brandNames.entries()]
    .filter(([id]) => availableBrandIds.has(id))
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
  const scope = { from: fromKey, toExclusive: toKey, timezone, teamId, agentId, visitType, brandId }
  const contract = {
    workforceEnabled,
    maxFacts: MAX_FACTS,
    maxAgents: MAX_AGENTS,
    truncated,
    truncationReasons,
    partialLimit: truncationReasons.length ? Math.min(...truncationReasons.map((reason) => reason.limit)) : null,
    brandSource: "effective verified/ended period-overlapping field potential or explicit visit action evidence",
    visitTypeSource: "policy snapshot; otherwise non-observer participant assignment",
    aggregationSemantics: "team totals count each fact once; an employee filter credits a joint fact to every active non-observer participant, so employee totals are intentionally non-additive",
    displayAttributionSemantics: "the selected primary owner is displayed first; otherwise the name/id-sorted credited participant is displayed, while attributedAgents lists the complete credited cohort",
    brandAttributionSemantics: "shared potential or date-valid potential for an agent credited by the applied cohort; explicit completed visit-action evidence remains fact-bound",
    teamScopeSemantics: "authorization and team filters use the current roster; fact attribution inside that scope uses route-date and visit-time assignments",
    routePointVisitResolution: "any completed linked visit completes the point; completed then GPS-confirmed then immutable visit id selects visit-type evidence; brand evidence is unioned",
    sourceFreshnessSemantics: "age of the latest candidate business-fact change in the tenant/manager/date scope before visit-type and brand filtering; not a collector heartbeat",
    snapshotReadConsistency: "READ_COMMITTED_BEST_EFFORT; snapshotId identifies the exact assembled response and export rejects a changed snapshot",
    adjustmentSemantics: {
      PLAN_POINT: "excluded from plan numerator and denominator",
      GPS_VISIT: "GPS evidence excluded from numerator; completed visit remains in denominator",
    },
    policySemantics: "authoritative only when one coherent signed KPI policy covers the complete requested period and all fact cohorts are complete",
  }
  const stableFormula = Object.fromEntries(
    Object.entries(report.formula).filter(([key]) => key !== "generatedAt"),
  )
  const snapshotId = createHash("sha256").update(JSON.stringify({
    scope,
    agents,
    teams,
    brands,
    contract,
    report: { ...report, formula: stableFormula },
  })).digest("hex")

  return NextResponse.json({
    success: true,
    data: {
      scope, agents, teams, brands, report, contract, snapshotId,
    },
  }, { headers: { "Cache-Control": "private, no-store" } })
})

export const POST = withRouteFieldWebRlsAuth("write", async (req, session) => {
  const orgId = session.orgId
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: orgId,
    userId: session.userId,
    webRole: session.role,
  })
  if (!actor || actor.role === "AGENT") {
    return NextResponse.json({ error: "Manager access required" }, { status: 403 })
  }
  const body = record(await req.json().catch(() => null))
  const factType = body?.factType
  const factId = typeof body?.factId === "string" ? body.factId.trim() : ""
  const action = body?.action
  const reason = typeof body?.reason === "string" ? body.reason.trim() : ""
  if ((factType !== "PLAN_POINT" && factType !== "GPS_VISIT") || !factId ||
      (action !== "EXCLUDE" && action !== "RESTORE") || reason.length < 10 || reason.length > 500) {
    return NextResponse.json({ error: "factType, factId, action and a 10-500 character reason are required" }, { status: 400 })
  }
  const scopedAgentIds = actor.scopedAgentIds
  // Adjustments are global evidence decisions, so joint visibility is not
  // sufficient authority. A manager may adjust only a fact whose immutable
  // primary owner is in their scope; tenant admins remain unrestricted.
  const routeScope = scopedAgentIds ? { agentId: { in: [...scopedAgentIds] } } : {}
  const visitScope = scopedAgentIds ? { agentId: { in: [...scopedAgentIds] } } : {}
  const fact = factType === "PLAN_POINT"
    ? await prisma.mtmRoutePoint.findFirst({
        where: { id: factId, deletedAt: null, route: { organizationId: orgId, deletedAt: null, ...routeScope } },
        select: { id: true },
      })
    : await prisma.mtmVisit.findFirst({
        where: { id: factId, organizationId: orgId, deletedAt: null, ...visitScope },
        select: { id: true },
      })
  if (!fact) return NextResponse.json({ error: "Fact not found in manager scope" }, { status: 404 })

  await writeMtmAudit({
    organizationId: orgId,
    agentId: actor.agentId,
    action: action === "EXCLUDE" ? "KPI_FACT_EXCLUDED" : "KPI_FACT_RESTORED",
    entity: "kpi_fact",
    entityId: factId,
    metadataKind: "kpi_adjustment",
    newData: { factType, reason, formulaVersion: "SWM_PLAN_GPS_V1", actorUserId: session.userId },
    req,
  })
  return NextResponse.json({ success: true, data: { factType, factId, action, reason } }, { status: 201 })
})
