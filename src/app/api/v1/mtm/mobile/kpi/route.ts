import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import {
  buildMobileKpi,
  resolveMobileKpiPeriod,
  type MobileKpiPeriodKind,
} from "@/lib/mtm/mobile-kpi"
import { addDateKeyDays, currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { MTM_KPI_FORMULA_VERSION } from "@/lib/mtm/explainable-kpi"

const MAX_LOCATION_ROWS = 50_000
const MAX_ROUTE_ROWS = 400
const MAX_FACT_ROWS = 10_000
const MAX_ADJUSTMENT_ROWS = 10_000

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

type MobileKpiAdjustment = {
  factType: "PLAN_POINT" | "GPS_VISIT"
  factId: string
  action: "EXCLUDE" | "RESTORE"
  reason: string
  createdAt: string
  auditId: string
}

function kpiAdjustment(row: { id: string; action: string; entityId: string | null; newData: unknown; createdAt: Date }): MobileKpiAdjustment | null {
  const data = record(row.newData)
  const factType = data?.factType
  if (!row.entityId || data?.formulaVersion !== MTM_KPI_FORMULA_VERSION ||
      (factType !== "PLAN_POINT" && factType !== "GPS_VISIT")) return null
  return {
    factType,
    factId: row.entityId,
    action: row.action === "KPI_FACT_RESTORED" ? "RESTORE" : "EXCLUDE",
    reason: typeof data.reason === "string" ? data.reason : "",
    createdAt: row.createdAt.toISOString(),
    auditId: row.id,
  }
}

function routeAssignmentActiveOnDate(
  assignment: { assignedAt: Date; removedAt: Date | null },
  date: Date,
  timezone: string,
): boolean {
  const routeDateKey = date.toISOString().slice(0, 10)
  const dayStart = localDateKeyToUtc(routeDateKey, timezone).getTime()
  const dayEnd = localDateKeyToUtc(addDateKeyDays(routeDateKey, 1), timezone).getTime()
  return assignment.assignedAt.getTime() < dayEnd &&
    (!assignment.removedAt || assignment.removedAt.getTime() >= dayStart)
}

function visitParticipantActiveAt(
  participant: { joinedAt: Date; leftAt: Date | null },
  at: Date,
): boolean {
  return participant.joinedAt <= at && (!participant.leftAt || participant.leftAt >= at)
}

/**
 * GET /api/v1/mtm/mobile/kpi?period=day|week|month&anchor=YYYY-MM-DD
 *
 * `day` backs the mobile home dashboard, whose widgets are phrased around the
 * agent's current day; week and month back the period selector. All three run
 * the same formulas, so a widget and the web report never disagree.
 *
 * Personal, agent-scoped KPI built exclusively from route, visit, coverage,
 * task and GPS evidence held by LeadDrive.
 */
export const GET = withMobileRls(async (req, auth) => {
  try {
    const workforceEnabled = auth.tenantCapabilities?.workforceHrm === true
    const url = new URL(req.url)
    const rawPeriod = url.searchParams.get("period") ?? "week"
    if (rawPeriod !== "day" && rawPeriod !== "week" && rawPeriod !== "month") {
      return NextResponse.json({ error: "period must be day, week or month", code: "MTM_KPI_PERIOD_INVALID" }, { status: 400 })
    }
    const periodKind: MobileKpiPeriodKind = rawPeriod
    const [settings, agent] = await Promise.all([
      getMtmSettings(auth.orgId),
      prisma.mtmAgent.findFirst({
        where: { id: auth.agentId, organizationId: auth.orgId, status: "ACTIVE" },
        select: { id: true },
      }),
    ])
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 })

    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const now = new Date()
    const today = currentDateKey(now, timezone)
    const anchor = url.searchParams.get("anchor") ?? today
    const period = resolveMobileKpiPeriod(anchor, periodKind, timezone)
    if (!period) {
      return NextResponse.json({ error: "anchor must be YYYY-MM-DD", code: "MTM_KPI_ANCHOR_INVALID" }, { status: 400 })
    }

    const [routeRows, visitRows, taskRows, workdayRows, locationsRaw, totalLocationCount] = await Promise.all([
      prisma.mtmRoute.findMany({
        where: {
          organizationId: auth.orgId,
          deletedAt: null,
          status: { notIn: ["DRAFT", "CANCELLED"] },
          date: { gte: period.routeFrom, lt: period.routeTo },
          OR: [
            { agentId: auth.agentId },
            { assignments: { some: { agentId: auth.agentId, role: { not: "OBSERVER" } } } },
          ],
        },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: MAX_ROUTE_ROWS + 1,
        select: {
          id: true,
          agentId: true,
          date: true,
          status: true,
          assignments: {
            where: { agentId: auth.agentId, role: { not: "OBSERVER" } },
            orderBy: { assignedAt: "asc" },
            select: { assignedAt: true, removedAt: true },
          },
        },
      }),
      prisma.mtmVisit.findMany({
        where: {
          organizationId: auth.orgId,
          deletedAt: null,
          checkInAt: { gte: period.activityFrom, lt: period.activityTo },
          OR: [
            { agentId: auth.agentId },
            { participants: { some: { agentId: auth.agentId, role: { not: "OBSERVER" } } } },
          ],
        },
        orderBy: [{ checkInAt: "asc" }, { id: "asc" }],
        take: MAX_FACT_ROWS + 1,
        select: {
          id: true,
          agentId: true,
          customerId: true,
          contactId: true,
          routePointId: true,
          status: true,
          checkInAt: true,
          checkInLat: true,
          checkInLng: true,
          checkOutLat: true,
          checkOutLng: true,
          customer: { select: { name: true, objectType: true } },
          participants: {
            where: { agentId: auth.agentId, role: { not: "OBSERVER" } },
            orderBy: { joinedAt: "asc" },
            select: { joinedAt: true, leftAt: true },
          },
        },
      }),
      prisma.mtmTask.findMany({
        where: {
          organizationId: auth.orgId,
          agentId: auth.agentId,
          deletedAt: null,
          OR: [
            { createdAt: { gte: period.activityFrom, lt: period.activityTo } },
            { dueDate: { gte: period.activityFrom, lt: period.activityTo } },
            { completedAt: { gte: period.activityFrom, lt: period.activityTo } },
          ],
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        take: MAX_FACT_ROWS + 1,
        select: { id: true, status: true, dueDate: true, completedAt: true },
      }),
      workforceEnabled ? prisma.mtmAgentWorkday.findMany({
        where: {
          organizationId: auth.orgId,
          agentId: auth.agentId,
          workDate: { gte: period.routeFrom, lt: period.routeTo },
        },
        orderBy: { workDate: "asc" },
        take: MAX_FACT_ROWS + 1,
        select: {
          id: true,
          workDate: true,
          status: true,
          startedAt: true,
          pausedAt: true,
          completedAt: true,
          totalPausedSeconds: true,
        },
      }) : Promise.resolve([]),
      prisma.mtmAgentLocation.findMany({
        where: {
          organizationId: auth.orgId,
          agentId: auth.agentId,
          recordedAt: { gte: period.activityFrom, lt: period.activityTo },
        },
        orderBy: { recordedAt: "asc" },
        take: MAX_LOCATION_ROWS + 1,
        select: { latitude: true, longitude: true, accuracy: true, recordedAt: true },
      }),
      prisma.mtmAgentLocation.count({
        where: {
          organizationId: auth.orgId,
          agentId: auth.agentId,
          recordedAt: { gte: period.activityFrom, lt: period.activityTo },
        },
      }),
    ])
    const routeHeaders = routeRows.slice(0, MAX_ROUTE_ROWS).filter((route) =>
      route.agentId === auth.agentId || route.assignments.some((assignment) =>
        routeAssignmentActiveOnDate(assignment, route.date, timezone)),
    )
    const routePointsRaw = routeHeaders.length > 0
      ? await prisma.mtmRoutePoint.findMany({
          where: { routeId: { in: routeHeaders.map((route) => route.id) }, deletedAt: null },
          orderBy: [{ routeId: "asc" }, { orderIndex: "asc" }, { id: "asc" }],
          take: MAX_FACT_ROWS + 1,
          select: {
            id: true,
            routeId: true,
            customerId: true,
            contactId: true,
            status: true,
            customer: { select: { name: true, objectType: true } },
          },
        })
      : []
    const pointsByRoute = new Map<string, typeof routePointsRaw>()
    for (const point of routePointsRaw.slice(0, MAX_FACT_ROWS)) {
      const points = pointsByRoute.get(point.routeId) ?? []
      points.push(point)
      pointsByRoute.set(point.routeId, points)
    }
    const routes = routeHeaders.map((route) => ({
      id: route.id,
      date: route.date,
      status: route.status,
      points: (pointsByRoute.get(route.id) ?? []).map((point) => ({
        id: point.id,
        customerId: point.customerId,
        contactId: point.contactId,
        status: point.status,
        customer: point.customer,
      })),
    }))
    const visits = visitRows.slice(0, MAX_FACT_ROWS).filter((visit) =>
      visit.agentId === auth.agentId || visit.participants.some((participant) =>
        visitParticipantActiveAt(participant, visit.checkInAt)),
    ).map((visit) => ({
      id: visit.id,
      customerId: visit.customerId,
      contactId: visit.contactId,
      routePointId: visit.routePointId,
      status: visit.status,
      checkInLat: visit.checkInLat,
      checkInLng: visit.checkInLng,
      checkOutLat: visit.checkOutLat,
      checkOutLng: visit.checkOutLng,
      customer: visit.customer,
    }))
    const tasks = taskRows.slice(0, MAX_FACT_ROWS)
    const workdays = workdayRows.slice(0, MAX_FACT_ROWS)
    const factIds = [
      ...routes.flatMap((route) => route.points.map((point) => point.id)),
      ...visits.map((visit) => visit.id),
    ]
    const adjustmentRowsRaw = factIds.length > 0 ? await prisma.mtmAuditLog.findMany({
      where: {
        organizationId: auth.orgId,
        entity: "kpi_fact",
        entityId: { in: factIds },
        action: { in: ["KPI_FACT_EXCLUDED", "KPI_FACT_RESTORED"] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_ADJUSTMENT_ROWS + 1,
      select: { id: true, action: true, entityId: true, newData: true, createdAt: true },
    }) : []
    const adjustmentRows = adjustmentRowsRaw.slice(0, MAX_ADJUSTMENT_ROWS)
    const latest = new Map<string, MobileKpiAdjustment>()
    const adjustmentHistory: MobileKpiAdjustment[] = []
    for (const row of adjustmentRows) {
      const adjustment = kpiAdjustment(row)
      if (!adjustment) continue
      adjustmentHistory.push(adjustment)
      const key = `${adjustment.factType}:${adjustment.factId}`
      if (!latest.has(key)) latest.set(key, adjustment)
    }
    const latestAdjustments = [...latest.values()]
    const excludedPlan = new Set(latestAdjustments.filter((item) => item.factType === "PLAN_POINT" && item.action === "EXCLUDE").map((item) => item.factId))
    const excludedGpsEvidence = new Set(latestAdjustments.filter((item) => item.factType === "GPS_VISIT" && item.action === "EXCLUDE").map((item) => item.factId))
    const adjustedVisits = visits.map((visit) => ({ ...visit, gpsEvidenceExcluded: excludedGpsEvidence.has(visit.id) }))
    const locationsTruncated = locationsRaw.length > MAX_LOCATION_ROWS || totalLocationCount > MAX_LOCATION_ROWS
    const locations = locationsRaw.slice(0, MAX_LOCATION_ROWS)
    const factsTruncated = routeRows.length > MAX_ROUTE_ROWS || routePointsRaw.length > MAX_FACT_ROWS ||
      visitRows.length > MAX_FACT_ROWS || taskRows.length > MAX_FACT_ROWS || workdayRows.length > MAX_FACT_ROWS ||
      adjustmentRowsRaw.length > MAX_ADJUSTMENT_ROWS
    const completeness = factsTruncated || locationsTruncated ? "PARTIAL" as const : "COMPLETE" as const
    const metrics = buildMobileKpi({
      routes,
      visits: adjustedVisits,
      tasks,
      workdays,
      locations,
      totalLocationCount,
      locationsTruncated,
      timezone,
      today,
      now,
      planPointExclusionIds: [...excludedPlan],
      completeness,
      adjustments: adjustmentHistory.sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.auditId.localeCompare(right.auditId)),
    })

    return NextResponse.json({
      success: true,
      data: {
        protocolVersion: 2,
        source: "LEADDRIVE",
        generatedAt: now.toISOString(),
        timezone,
        period: {
          kind: period.kind,
          anchor: period.anchor,
          start: period.start,
          endExclusive: period.endExclusive,
          from: period.activityFrom.toISOString(),
          to: period.activityTo.toISOString(),
        },
        ...metrics,
        contract: {
          workforceEnabled,
          maxRoutes: MAX_ROUTE_ROWS,
          maxFactsPerCohort: MAX_FACT_ROWS,
          maxAdjustments: MAX_ADJUSTMENT_ROWS,
          maxLocations: MAX_LOCATION_ROWS,
          truncated: completeness === "PARTIAL",
          historicalAttribution: "primary ownership or non-observer assignment/participation active on the route date or visit timestamp",
          adjustmentSemantics: {
            PLAN_POINT: "plan formula only; coverage and missed-stop facts remain unchanged",
            GPS_VISIT: "GPS numerator evidence only; completed-visit denominator remains unchanged",
          },
        },
      },
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("[MTM/mobile/kpi GET]", error)
    return NextResponse.json({ error: "Failed to load personal KPI" }, { status: 500 })
  }
})
