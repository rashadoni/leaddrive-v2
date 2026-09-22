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
  LOCATION_HISTORY_MAX_RANGE_DAYS,
  LOCATION_HISTORY_MAX_RAW_POINTS,
  buildHistoryCsv,
  buildHistoryTimeline,
  calculateHistoryDistance,
  detectHistoryAnomalies,
  detectHistoryGaps,
  type HistoryPauseInterval,
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
  // Owner 2026-09-22: «where was he these days and his path» — a range of up
  // to seven days. Without `toDate` the window is the single day, as before.
  const toDate = searchParams.get("toDate") || date
  const fromTime = searchParams.get("from") ?? "00:00"
  const toTime = searchParams.get("to") ?? "23:59"
  const requestedTimezone = searchParams.get("timezone")
  if (requestedTimezone && requestedTimezone !== tenantTimezone) {
    return denied("MTM_GPS_TIMEZONE_FIXED", 409)
  }
  if (!isDateKey(date) || !isDateKey(toDate) || toDate < date || !TIME.test(fromTime) || !TIME.test(toTime)) {
    return denied("MTM_GPS_INVALID_RANGE", 400)
  }

  let from: Date
  let to: Date
  try {
    from = localDateTimeToUtc(`${date}T${fromTime}`, tenantTimezone)
    to = localDateTimeToUtc(`${toDate}T${toTime}`, tenantTimezone)
  } catch {
    return denied("MTM_GPS_INVALID_RANGE", 400)
  }
  // Include the final minute selected in the time input.
  to = new Date(to.getTime() + 59_999)
  const rangeDays = Math.round((Date.parse(`${toDate}T00:00:00.000Z`) - Date.parse(`${date}T00:00:00.000Z`)) / 86_400_000) + 1
  const multiDay = rangeDays > 1
  if (rangeDays > LOCATION_HISTORY_MAX_RANGE_DAYS || to <= from || to.getTime() - from.getTime() > (rangeDays * 24 + 2) * 60 * 60 * 1_000) {
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
    workforceEnabled && !multiDay ? prisma.mtmAgentWorkday.findFirst({
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
        // With the customer's radius these answer "was the visit recorded at
        // the door" — the page used to print «confirmed» for every row.
        checkOutLat: true,
        checkOutLng: true,
        checkInCustomerLat: true,
        checkInCustomerLng: true,
        checkInGeofenceRadius: true,
        customer: {
          select: {
            name: true,
            address: true,
            latitude: true,
            longitude: true,
            geofenceRadius: true,
          },
        },
      },
    }),
    prisma.mtmRoute.findMany({
      where: {
        organizationId: auth.orgId,
        date: multiDay
          ? { gte: new Date(`${date}T00:00:00.000Z`), lte: new Date(`${toDate}T00:00:00.000Z`) }
          : new Date(`${date}T00:00:00.000Z`),
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

  // A workday is dated by the day it started. One opened the previous evening
  // and still open (or closed during this day) has no row for the selected
  // date, and the page said "no workday" while the live map showed it active
  // (audit 2026-09-14). Look for such a carried-over workday only when the
  // selected date has none; it is shown as a note and does not feed the
  // timeline or the evidence pack, which stay tied to this date's own row.
  const carriedOverCandidate = workforceEnabled && !workday && !multiDay
    ? await prisma.mtmAgentWorkday.findFirst({
      where: {
        organizationId: auth.orgId,
        agentId,
        workDate: { lt: new Date(`${date}T00:00:00.000Z`) },
        startedAt: { lte: to },
        OR: [{ completedAt: null }, { completedAt: { gte: from } }],
      },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        status: true,
        workDate: true,
        startedAt: true,
        completedAt: true,
      },
    }) ?? null
    : null
  // The query already requires it; re-checked so a workday closed before the
  // window can never be reported as covering the date.
  const carriedOverWorkday = carriedOverCandidate
    && carriedOverCandidate.startedAt <= to
    && (!carriedOverCandidate.completedAt || carriedOverCandidate.completedAt >= from)
    ? carriedOverCandidate
    : null

  // A range lists each day's shift; the single-day card stays as it was.
  const workdays = workforceEnabled && multiDay
    ? await prisma.mtmAgentWorkday.findMany({
      where: {
        organizationId: auth.orgId,
        agentId,
        workDate: { gte: new Date(`${date}T00:00:00.000Z`), lte: new Date(`${toDate}T00:00:00.000Z`) },
      },
      orderBy: { workDate: "asc" },
      select: { id: true, status: true, workDate: true, startedAt: true, completedAt: true },
    })
    : []

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
  /**
   * The workday's own PAUSE/RESUME events, so a break is not reported as a
   * telemetry failure. The app stops tracking while the workday is on hold —
   * the silence that follows is expected, and the day's card should say which
   * silence was which.
   */
  const pauseEvents = workforceEnabled
    ? await prisma.mtmAgentWorkdayEvent.findMany({
      where: {
        organizationId: auth.orgId,
        agentId,
        type: { in: ["PAUSE", "RESUME"] },
        occurredAt: { gte: from, lte: to },
      },
      orderBy: { occurredAt: "asc" },
      select: { type: true, occurredAt: true },
    })
    : []
  const pauses: HistoryPauseInterval[] = []
  for (const event of pauseEvents) {
    if (event.type === "PAUSE") {
      // A second PAUSE without a RESUME cannot open a second interval.
      if (!pauses.length || pauses[pauses.length - 1].endedAt) {
        pauses.push({ startedAt: event.occurredAt, endedAt: null })
      }
    } else if (pauses.length && !pauses[pauses.length - 1].endedAt) {
      pauses[pauses.length - 1].endedAt = event.occurredAt
    }
  }
  const gaps = detectHistoryGaps(prepared.points, gapThresholdSeconds, pauses)
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
        "content-disposition": `attachment; filename="mtm-${multiDay ? `${date}_${toDate}` : `day-${date}`}.csv"`,
        "cache-control": "private, no-store",
      },
    })
  }

  return NextResponse.json({
    success: true,
    data: {
      agent: selectedAgent,
      range: { date, toDate, days: rangeDays, from: from.toISOString(), to: to.toISOString(), timezone: tenantTimezone },
      policy: {
        maxAccuracyMeters,
        stopRadiusMeters: policyStopRadiusMeters,
        stopMinimumMinutes: policyStopMinimumMinutes,
        gapThresholdSeconds,
        distanceFormula: LOCATION_HISTORY_DISTANCE_FORMULA,
        impossibleSpeedKmh: 180,
        autoTrackingSupported: false,
        geofenceRadiusMeters: settings.geofenceRadius,
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
        // Only unexplained silence: a pause is reported as a pause.
        gapCount: gaps.filter((gap) => gap.reason === "TELEMETRY_GAP").length,
        pausedGapCount: gaps.filter((gap) => gap.reason === "WORKDAY_PAUSED").length,
        anomalyCount: anomalies.length,
      },
      workday,
      carriedOverWorkday,
      workdays: workdays.map((row) => ({ ...row, workDate: row.workDate.toISOString().slice(0, 10) })),
      evidencePack: {
        id: workday?.id ?? (multiDay ? `range:${agentId}:${date}:${toDate}` : `day:${agentId}:${date}`),
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
