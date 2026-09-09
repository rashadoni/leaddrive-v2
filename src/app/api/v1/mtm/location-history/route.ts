import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone, localDateTimeToUtc } from "@/lib/timezone"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { workforceEnabledForMixedSurface } from "@/lib/workforce-capability"
import {
  LOCATION_HISTORY_DISTANCE_FORMULA,
  LOCATION_HISTORY_MAX_OUTPUT_POINTS,
  LOCATION_HISTORY_MAX_RAW_POINTS,
  buildHistoryCsv,
  buildHistoryTimeline,
  calculateHistoryDistance,
  detectHistoryAnomalies,
  detectHistoryGaps,
  detectHistoryStops,
  downsampleHistoryPoints,
  prepareHistoryPoints,
  type HistoryLocationPoint,
  type HistoryVisit,
} from "@/lib/mtm/location-history"

const TIME = /^\d{2}:\d{2}$/

function denied(code: string, status = 403) {
  return NextResponse.json({ error: status === 403 ? "Forbidden" : "Invalid request", code }, { status })
}

function boundedNumber(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value == null || value === "" ? fallback : Number(value)
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback
}

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return denied("MTM_GPS_ACTOR_NOT_FOUND")
  const workforceEnabled = await workforceEnabledForMixedSurface(
    auth.orgId,
    "MTM/location-history GET",
  )

  const settings = await getMtmSettings(auth.orgId)
  const policyAccuracyMeters = boundedNumber(null, settings.historyMaxAccuracyMeters, 5, 1_000)
  const policyStopRadiusMeters = boundedNumber(null, settings.historyStopRadiusMeters, 10, 1_000)
  const policyStopMinimumMinutes = boundedNumber(null, settings.historyStopMinimumMinutes, 1, 240)
  const tenantTimezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const { searchParams } = new URL(req.url)
  const agentId = searchParams.get("agentId")?.trim() ?? ""

  const agentWhere = {
    organizationId: auth.orgId,
    status: "ACTIVE" as const,
    ...(actor.scopedAgentIds === null ? {} : { id: { in: [...actor.scopedAgentIds] } }),
  }

  // The first request supplies the server-scoped roster and the tenant
  // calculation policy. It deliberately never returns an org-wide roster to
  // a manager/supervisor outside their resolved territory scope.
  if (!agentId) {
    const agents = await prisma.mtmAgent.findMany({
      where: agentWhere,
      orderBy: { name: "asc" },
      take: 500,
      select: {
        id: true,
        name: true,
        role: true,
        team: { select: { id: true, name: true } },
      },
    })
    return NextResponse.json({
      success: true,
      data: {
        agents,
        timezone: tenantTimezone,
        policy: {
          maxAccuracyMeters: policyAccuracyMeters,
          stopRadiusMeters: policyStopRadiusMeters,
          stopMinimumMinutes: policyStopMinimumMinutes,
          autoTrackingSupported: false,
        },
        capabilities: { workforce: workforceEnabled },
      },
    })
  }

  if (actor.scopedAgentIds !== null && !actor.scopedAgentIds.includes(agentId)) {
    return denied("MTM_GPS_AGENT_OUT_OF_SCOPE")
  }

  const selectedAgent = await prisma.mtmAgent.findFirst({
    where: { ...agentWhere, id: agentId },
    select: { id: true, name: true, role: true, team: { select: { id: true, name: true } } },
  })
  if (!selectedAgent) return denied("MTM_GPS_AGENT_NOT_FOUND", 404)

  const date = searchParams.get("date") ?? ""
  const fromTime = searchParams.get("from") ?? "00:00"
  const toTime = searchParams.get("to") ?? "23:59"
  const requestedTimezone = searchParams.get("timezone")
  if (requestedTimezone && requestedTimezone !== tenantTimezone) {
    return denied("MTM_GPS_TIMEZONE_FIXED", 409)
  }
  if (!isDateKey(date) || !TIME.test(fromTime) || !TIME.test(toTime)) {
    return denied("MTM_GPS_INVALID_RANGE", 400)
  }

  let from: Date
  let to: Date
  try {
    from = localDateTimeToUtc(`${date}T${fromTime}`, tenantTimezone)
    to = localDateTimeToUtc(`${date}T${toTime}`, tenantTimezone)
  } catch {
    return denied("MTM_GPS_INVALID_RANGE", 400)
  }
  // Include the final minute selected in the time input.
  to = new Date(to.getTime() + 59_999)
  if (to <= from || to.getTime() - from.getTime() > 26 * 60 * 60 * 1_000) {
    return denied("MTM_GPS_INVALID_RANGE", 400)
  }

  const maxAccuracyMeters = boundedNumber(
    searchParams.get("accuracy"),
    policyAccuracyMeters,
    5,
    1_000,
  )
  const outputLimit = Math.floor(boundedNumber(
    searchParams.get("limit"),
    LOCATION_HISTORY_MAX_OUTPUT_POINTS,
    100,
    LOCATION_HISTORY_MAX_OUTPUT_POINTS,
  ))

  const [rawLocationRows, workday, visits, routes] = await Promise.all([
    prisma.mtmAgentLocation.findMany({
      where: {
        organizationId: auth.orgId,
        agentId,
        recordedAt: { gte: from, lte: to },
      },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
      take: LOCATION_HISTORY_MAX_RAW_POINTS,
      select: {
        id: true,
        latitude: true,
        longitude: true,
        accuracy: true,
        speed: true,
        heading: true,
        battery: true,
        isMoving: true,
        recordedAt: true,
        ...(workforceEnabled ? { workdayId: true } : {}),
      },
    }),
    workforceEnabled ? prisma.mtmAgentWorkday.findFirst({
      where: {
        organizationId: auth.orgId,
        agentId,
        workDate: new Date(`${date}T00:00:00.000Z`),
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        pausedAt: true,
        completedAt: true,
        totalPausedSeconds: true,
        startLatitude: true,
        startLongitude: true,
        endLatitude: true,
        endLongitude: true,
      },
    }) : Promise.resolve(null),
    prisma.mtmVisit.findMany({
      where: {
        organizationId: auth.orgId,
        agentId,
        deletedAt: null,
        checkInAt: { lte: to },
        OR: [{ checkOutAt: null }, { checkOutAt: { gte: from } }],
      },
      orderBy: { checkInAt: "asc" },
      select: {
        id: true,
        customerId: true,
        routeId: true,
        routePointId: true,
        status: true,
        checkInAt: true,
        checkOutAt: true,
        checkInLat: true,
        checkInLng: true,
        customer: {
          select: {
            name: true,
            address: true,
            latitude: true,
            longitude: true,
          },
        },
      },
    }),
    prisma.mtmRoute.findMany({
      where: {
        organizationId: auth.orgId,
        date: new Date(`${date}T00:00:00.000Z`),
        deletedAt: null,
        OR: [
          { agentId },
          {
            assignments: {
              some: {
                agentId,
                assignedAt: { lte: to },
                OR: [{ removedAt: null }, { removedAt: { gte: from } }],
              },
            },
          },
        ],
      },
      orderBy: [{ publishedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        status: true,
        version: true,
        publishedVersion: true,
        publishedAt: true,
        startedAt: true,
        completedAt: true,
        points: {
          where: { deletedAt: null },
          orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
          select: {
            id: true,
            orderIndex: true,
            status: true,
            plannedTime: true,
            visitedAt: true,
            customerId: true,
            contactId: true,
            customer: {
              select: {
                name: true,
                address: true,
                latitude: true,
                longitude: true,
              },
            },
            contact: { select: { displayName: true } },
          },
        },
      },
    }),
  ])

  const rawLocations: HistoryLocationPoint[] = rawLocationRows.map((row) => ({
    ...row,
    workdayId: workforceEnabled && "workdayId" in row
      ? row.workdayId as string | null
      : null,
  }))

  const prepared = prepareHistoryPoints(
    rawLocations,
    maxAccuracyMeters,
  )
  const rawTruncated = rawLocations.length === LOCATION_HISTORY_MAX_RAW_POINTS
  const distanceMeters = rawTruncated ? null : calculateHistoryDistance(prepared.points)
  const gapThresholdSeconds = Math.max(settings.offlineThresholdSeconds, settings.gpsInterval * 3)
  const gaps = detectHistoryGaps(prepared.points, gapThresholdSeconds)
  const stops = detectHistoryStops({
    points: prepared.points,
    visits: visits as HistoryVisit[],
    radiusMeters: policyStopRadiusMeters,
    minimumSeconds: policyStopMinimumMinutes * 60,
    offlineThresholdSeconds: settings.offlineThresholdSeconds,
  })
  const anomalies = detectHistoryAnomalies({
    acceptedPoints: prepared.points,
    rawPoints: rawLocations,
    gaps,
    maxAccuracyMeters,
    impossibleSpeedKmh: 180,
  })
  const plannedStops = routes.flatMap((route) => route.points.map((point) => ({
    ...point,
    routeId: route.id,
    routeName: route.name,
    routeStatus: route.status,
    label: point.contact?.displayName || point.customer.name,
  })))
  const timeline = buildHistoryTimeline({
    workday,
    plannedStops: plannedStops.map((point) => ({
      id: point.id,
      plannedTime: point.plannedTime,
      label: point.label,
    })),
    visits: visits as HistoryVisit[],
    stops,
    gaps,
    anomalies,
  })
  const points = downsampleHistoryPoints(prepared.points, outputLimit)
  const exportCsv = searchParams.get("format") === "csv"

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: exportCsv ? "GPS_HISTORY_EXPORT" : "GPS_HISTORY_VIEW",
    entity: "agent",
    entityId: agentId,
    metadataKind: "gps_history_access",
    newData: {
      targetAgentId: agentId,
      from: from.toISOString(),
      to: to.toISOString(),
      timezone: tenantTimezone,
      maxAccuracyMeters,
      rawPointCount: rawLocations.length,
      acceptedPointCount: prepared.points.length,
    },
    req,
  }).catch((error) => console.warn("[MTM/location-history] audit failed", error))

  if (exportCsv) {
    const csv = buildHistoryCsv({
      agentName: selectedAgent.name,
      timezone: tenantTimezone,
      date,
      distanceMeters,
      timeline,
    })
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="mtm-day-${date}.csv"`,
        "cache-control": "private, no-store",
      },
    })
  }

  return NextResponse.json({
    success: true,
    data: {
      agent: selectedAgent,
      range: { date, from: from.toISOString(), to: to.toISOString(), timezone: tenantTimezone },
      policy: {
        maxAccuracyMeters,
        stopRadiusMeters: policyStopRadiusMeters,
        stopMinimumMinutes: policyStopMinimumMinutes,
        gapThresholdSeconds,
        distanceFormula: LOCATION_HISTORY_DISTANCE_FORMULA,
        impossibleSpeedKmh: 180,
        autoTrackingSupported: false,
      },
      capabilities: { workforce: workforceEnabled },
      quality: {
        rawPointCount: rawLocations.length,
        acceptedPointCount: prepared.points.length,
        returnedPointCount: points.length,
        rejectedByAccuracy: prepared.rejectedByAccuracy,
        rejectedInvalid: prepared.rejectedInvalid,
        duplicateCount: prepared.duplicateCount,
        rawTruncated,
        downsampled: points.length < prepared.points.length,
      },
      summary: {
        distanceMeters,
        firstPointAt: prepared.points[0]?.recordedAt ?? null,
        lastPointAt: prepared.points.at(-1)?.recordedAt ?? null,
        stopCount: stops.length,
        visitCount: visits.length,
        gapCount: gaps.length,
        anomalyCount: anomalies.length,
      },
      workday,
      evidencePack: {
        id: workday?.id ?? `day:${agentId}:${date}`,
        workdayId: workday?.id ?? null,
        routeIds: routes.map((route) => route.id),
        locationWorkdayIds: [...new Set(prepared.points.flatMap((point) => point.workdayId ? [point.workdayId] : []))],
        visitIds: visits.map((visit) => visit.id),
      },
      points,
      stops,
      gaps,
      anomalies,
      plannedRoutes: routes.map((route) => ({
        ...route,
        points: route.points.map((point) => ({
          ...point,
          label: point.contact?.displayName || point.customer.name,
        })),
      })),
      timeline,
      visits: (visits as HistoryVisit[]).map((visit) => ({
        ...visit,
        confirmed: true,
      })),
    },
  })
})
