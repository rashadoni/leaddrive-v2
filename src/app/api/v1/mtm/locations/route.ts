import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { getMtmSettings } from "@/lib/mtm-settings"
import { addDateKeyDays, currentDateKey, isDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { classifyGpsFreshness, explainMissingLocation, mapWorkdayState } from "@/lib/mtm/live-location"
import { isLiveMapAgentPositionVisible, isLiveMapPositionVisible } from "@/lib/mtm-types"
import { checkRateLimit } from "@/lib/rate-limit"
import { isValidTimezone } from "@/lib/timezone"
import { advanceMtmAgentLatestLocation } from "@/lib/mtm/mobile-location-latest"
import { workforceEnabledForMixedSurface } from "@/lib/workforce-capability"

const MAX_FUTURE_LOCATION_SKEW_MS = 5 * 60 * 1000
const MAX_WEB_LOCATION_AGE_MS = 5 * 60 * 1000
const MAX_LIVE_ROSTER_SIZE = 500

class LocationAgentUnavailableError extends Error {}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string" || value.trim().length === 0) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function optionalMetric(
  value: unknown,
  min: number,
  max: number,
): { ok: true; value: number | null } | { ok: false } {
  if (value == null) return { ok: true, value: null }
  const parsed = finiteNumber(value)
  return parsed !== null && parsed >= min && parsed <= max
    ? { ok: true, value: parsed }
    : { ok: false }
}

function locationRecordedAt(value: unknown, now: Date): Date | null {
  if (value == null) return now
  if (typeof value !== "string" && typeof value !== "number") return null
  if ((typeof value === "string" && value.trim().length === 0) ||
      (typeof value === "number" && !Number.isFinite(value))) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime() + MAX_FUTURE_LOCATION_SKEW_MS) {
    return null
  }
  return parsed
}

function locationBadRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function locationAgentNotFound() {
  return NextResponse.json({ error: "Agent not found" }, { status: 404 })
}

function hourInTimezone(at: Date, timezone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at).find((part) => part.type === "hour")?.value
  const parsed = Number(hour)
  return Number.isInteger(parsed) ? parsed : at.getUTCHours()
}

type AgentWithLocations = Prisma.MtmAgentGetPayload<{
  select: {
    id: true
    name: true
    isOnline: true
    lastSeenAt: true
    teamId: true
    team: { select: { name: true } }
    locations: true
    workdays: { select: { status: true; workDate: true; startedAt: true } }
  }
}>

type AgentLocationRow = Prisma.MtmAgentLocationGetPayload<true>

type TodayRouteRow = Prisma.MtmRouteGetPayload<{
  select: { agentId: true; totalPoints: true; visitedPoints: true; status: true }
}>

type ActiveVisitRow = Prisma.MtmVisitGetPayload<{ select: { agentId: true } }>

export const GET = withRouteFieldWebRlsAuth("read", async (req, auth) => {
  const orgId = auth.orgId
  const { searchParams } = new URL(req.url)
  const agentId = searchParams.get("agentId") || ""
  const teamId = searchParams.get("teamId")?.trim() || ""
  const employeeQuery = searchParams.get("employee")?.trim().slice(0, 100) || ""

  try {
    const actor = await resolveMtmRouteActor(prisma, {
      organizationId: orgId,
      userId: auth.userId,
      webRole: auth.role,
      // The web-only wrapper has already rejected mobile JWTs. Preserve the
      // former web branch's null agent identity for route-scope resolution.
      agentId: null,
    })
    if (!actor || actor.role === "AGENT") {
      return NextResponse.json({ error: "Manager access required" }, { status: 403 })
    }
    const workforceEnabled = await workforceEnabledForMixedSurface(orgId, "MTM/locations GET")
    // This Route & Field-only endpoint requires a confirmed field session for
    // a live marker. The session reuses the canonical workday state machine
    // but does not disclose any Workforce-only record outside its operational
    // state/date/start boundary.
    const fieldSessionEnabled = true
    if (!checkRateLimit(`mtm-live-map:${orgId}:${auth.userId}`, { maxRequests: 30, windowMs: 60_000 })) {
      return NextResponse.json(
        { error: "Refresh rate limit exceeded", retryAfterSeconds: 15 },
        { status: 429, headers: { "Retry-After": "15" } },
      )
    }
    const scopedAgentIds = actor.scopedAgentIds

    // Single agent history (for replay)
    if (agentId) {
      if (scopedAgentIds && !scopedAgentIds.includes(agentId)) {
        return NextResponse.json({ success: true, data: { locations: [] } })
      }
      const historySettings = await getMtmSettings(orgId)
      const historyTimezone = isValidTimezone(historySettings.timezone) ? historySettings.timezone : "UTC"
      const historyToday = currentDateKey(new Date(), historyTimezone)
      const requestedDate = searchParams.get("date")?.trim() || historyToday
      if (!isDateKey(requestedDate)) {
        return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 })
      }
      const historyTomorrow = addDateKeyDays(requestedDate, 1)
      const historyStart = localDateKeyToUtc(requestedDate, historyTimezone)
      const historyEnd = localDateKeyToUtc(historyTomorrow, historyTimezone)
      const historyMaxAccuracyMeters = Math.min(1_000, Math.max(5, historySettings.historyMaxAccuracyMeters))
      const locations = await prisma.mtmAgentLocation.findMany({
        where: {
          organizationId: orgId,
          agentId,
          recordedAt: { gte: historyStart, lt: historyEnd },
          latitude: { gte: -90, lte: 90 },
          longitude: { gte: -180, lte: 180 },
          OR: [
            { accuracy: null },
            { accuracy: { gte: 0, lte: historyMaxAccuracyMeters } },
          ],
        },
        take: 200,
        orderBy: { recordedAt: "desc" },
      })
      const admissibleLocations = locations.filter((location) =>
        Number.isFinite(location.latitude) && location.latitude >= -90 && location.latitude <= 90 &&
        Number.isFinite(location.longitude) && location.longitude >= -180 && location.longitude <= 180 &&
        (location.accuracy == null || (
          Number.isFinite(location.accuracy) && location.accuracy >= 0 && location.accuracy <= historyMaxAccuracyMeters
        )),
      )
      const scopedLocations = workforceEnabled
        ? admissibleLocations
        : admissibleLocations.map((location) => ({ ...location, workdayId: null }))
      return NextResponse.json({
        success: true,
        data: {
          locations: scopedLocations,
          contract: {
            date: requestedDate,
            timezone: historyTimezone,
            maxPoints: 200,
            maxAccuracyMeters: historyMaxAccuracyMeters,
            workforceEnabled,
          },
        },
      })
    }

    // F-11: org-scoped tunables instead of hardcoded magic numbers
    const settings = await getMtmSettings(orgId)
    const now = new Date()
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const todayKey = currentDateKey(now, timezone)
    const tomorrowKey = addDateKeyDays(todayKey, 1)
    const routeToday = new Date(`${todayKey}T00:00:00.000Z`)
    const routeTomorrow = new Date(`${tomorrowKey}T00:00:00.000Z`)
    const activityToday = localDateKeyToUtc(todayKey, timezone)
    const activityTomorrow = localDateKeyToUtc(tomorrowKey, timezone)
    const tenantHour = hourInTimezone(now, timezone)

    const maxAccuracyMeters = Math.min(1_000, Math.max(5, settings.historyMaxAccuracyMeters))

    // Fetch one extra row so the response can disclose a bounded large-team
    // result without ever claiming that a 500-row roster is complete.
    const rosterCandidates = await prisma.mtmAgent.findMany({
      where: {
        organizationId: orgId,
        status: "ACTIVE",
        ...(scopedAgentIds ? { id: { in: scopedAgentIds } } : {}),
        ...(teamId ? { teamId } : {}),
        ...(employeeQuery ? { name: { contains: employeeQuery, mode: "insensitive" } } : {}),
      },
      orderBy: { name: "asc" },
      take: MAX_LIVE_ROSTER_SIZE + 1,
      select: {
        id: true,
        name: true,
        isOnline: true,
        lastSeenAt: true,
        teamId: true,
        team: { select: { name: true } },
        // The live marker is the newest admissible coordinate. Accuracy is a
        // quality gate/metadata field, never a reason to replace a newer point
        // with an older, prettier one. Defensive JS validation below also
        // protects against legacy non-finite rows.
        locations: {
          where: {
            latitude: { gte: -90, lte: 90 },
            longitude: { gte: -180, lte: 180 },
            OR: [
              { accuracy: null },
              { accuracy: { gte: 0, lte: maxAccuracyMeters } },
            ],
          },
          take: 5,
          orderBy: { recordedAt: "desc" },
        },
        ...(fieldSessionEnabled ? { workdays: {
          // Keep an unfinished prior-day shift visible. Calling it "not
          // started" would hide the exact anomaly the operator must resolve.
          where: {
            OR: [
              { status: { in: ["STARTED", "PAUSED"] } },
              { workDate: routeToday },
            ],
          },
          take: 2,
          orderBy: [{ startedAt: "desc" }, { workDate: "desc" }],
          select: { status: true, workDate: true, startedAt: true },
        } } : {}),
      },
    })
    const rosterTruncated = rosterCandidates.length > MAX_LIVE_ROSTER_SIZE
    const agents = rosterCandidates.slice(0, MAX_LIVE_ROSTER_SIZE)
    const returnedAgentIds = agents.map((agent: AgentWithLocations) => agent.id)
    const scopedWhere = returnedAgentIds.length ? { agentId: { in: returnedAgentIds } } : { agentId: "__no_access__" }

    // Get today's route completion per agent
    const todayRoutes = await prisma.mtmRoute.findMany({
      where: { organizationId: orgId, date: { gte: routeToday, lt: routeTomorrow }, deletedAt: null, ...scopedWhere },
      select: { agentId: true, totalPoints: true, visitedPoints: true, status: true },
    })
    const routeMap = Object.fromEntries(
      todayRoutes.map((r: TodayRouteRow) => [r.agentId, {
        completion: r.totalPoints > 0 ? Math.round((r.visitedPoints / r.totalPoints) * 100) : 0,
        routeStatus: r.status,
      }])
    )

    // Get today's active visits (checked in but not out) for check-in status
    const activeVisits = await prisma.mtmVisit.findMany({
      where: { organizationId: orgId, status: "CHECKED_IN", checkInAt: { gte: activityToday, lt: activityTomorrow }, deletedAt: null, ...scopedWhere },
      select: { agentId: true },
    })
    const checkedInAgents = new Set(activeVisits.map((v: ActiveVisitRow) => v.agentId))

    // Determine field status per agent
    const agentLocations = (agents as AgentWithLocations[]).map((a) => {
      const loc = a.locations.find((candidate: AgentLocationRow) =>
        Number.isFinite(candidate.latitude) && candidate.latitude >= -90 && candidate.latitude <= 90 &&
        Number.isFinite(candidate.longitude) && candidate.longitude >= -180 && candidate.longitude <= 180 &&
        (candidate.accuracy == null || (
          Number.isFinite(candidate.accuracy) && candidate.accuracy >= 0 && candidate.accuracy <= maxAccuracyMeters
        )),
      ) ?? null
      const route = routeMap[a.id]
      const isCheckedIn = checkedInAgents.has(a.id)
      const workdays = fieldSessionEnabled ? a.workdays ?? [] : []
      const activeWorkday = workdays.find((workday) => workday.status === "STARTED" || workday.status === "PAUSED")
      const todayWorkday = workdays.find((workday) => workday.workDate.getTime() === routeToday.getTime())
      const effectiveWorkday = activeWorkday ?? todayWorkday

      const freshness = classifyGpsFreshness(loc?.recordedAt, now, {
        onlineSeconds: settings.offlineThresholdSeconds,
        delayedSeconds: Math.max(settings.offlineThresholdSeconds, settings.locationWindowMinutes * 60),
      })
      const workdayState = fieldSessionEnabled ? mapWorkdayState(effectiveWorkday?.status) : "NOT_STARTED"
      const workdayCarryover = fieldSessionEnabled && Boolean(
        activeWorkday && activeWorkday.workDate.getTime() !== routeToday.getTime(),
      )

      // Field activity remains separate from GPS freshness and workday state.
      let fieldStatus: string
      if (freshness === "STALE" || freshness === "NO_LOCATION") {
        fieldStatus = "OFFLINE"
      } else if (isCheckedIn) {
        fieldStatus = "CHECKED_IN"
      } else if (route?.routeStatus === "IN_PROGRESS" && loc?.isMoving) {
        fieldStatus = "ON_ROAD"
      } else if (route?.routeStatus === "PLANNED" && a.isOnline) {
        // Has route but hasn't started — check if late
        fieldStatus = tenantHour >= settings.lateAfterHour ? "LATE" : "ON_ROAD"
      } else if (a.isOnline) {
        fieldStatus = "ON_ROAD"
      } else {
        fieldStatus = "OFFLINE"
      }

      return {
        agentId: a.id,
        name: a.name,
        isOnline: a.isOnline,
        lastSeenAt: a.lastSeenAt,
        teamId: a.teamId,
        teamName: a.team?.name ?? null,
        fieldStatus,
        freshness,
        workdayState,
        workdayDate: fieldSessionEnabled ? effectiveWorkday?.workDate ?? null : null,
        workdayStartedAt: fieldSessionEnabled ? effectiveWorkday?.startedAt ?? null : null,
        workdayCarryover,
        locationState: explainMissingLocation({ hasLocation: Boolean(loc), lastSeenAt: a.lastSeenAt }),
        routeCompletion: route?.completion ?? 0,
        ...(loc ? {
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy: loc.accuracy,
          speed: loc.speed,
          heading: loc.heading,
          battery: loc.battery,
          isMoving: loc.isMoving,
          recordedAt: loc.recordedAt,
        } : {}),
      }
    })

    // Status counts
    const statusCounts = {
      total: agentLocations.length,
      checkedIn: agentLocations.filter((a) => a.fieldStatus === "CHECKED_IN").length,
      onRoad: agentLocations.filter((a) => a.fieldStatus === "ON_ROAD").length,
      late: agentLocations.filter((a) => a.fieldStatus === "LATE").length,
      offline: agentLocations.filter((a) => a.fieldStatus === "OFFLINE").length,
    }
    const freshnessCounts = {
      online: agentLocations.filter((a) => a.freshness === "ONLINE").length,
      delayed: agentLocations.filter((a) => a.freshness === "DELAYED").length,
      stale: agentLocations.filter((a) => a.freshness === "STALE").length,
      noLocation: agentLocations.filter((a) => a.freshness === "NO_LOCATION").length,
    }
    const teams = Array.from(new Map(agentLocations.filter((a) => a.teamId).map((a) => [a.teamId, { id: a.teamId, name: a.teamName }])).values())

    // Recent events for live feed — only meaningful actions (visits, alerts)
    const recentVisits = await prisma.mtmVisit.findMany({
      where: { organizationId: orgId, checkInAt: { gte: activityToday, lt: activityTomorrow }, deletedAt: null, ...scopedWhere },
      take: 15,
      orderBy: { checkInAt: "desc" },
      include: {
        agent: { select: { name: true } },
        customer: { select: { name: true } },
      },
    })

    const visitEvents = recentVisits.map((v) => ({
      id: v.id,
      type: v.status === "CHECKED_IN" ? "CHECK_IN" : "CHECK_OUT",
      agent: v.agent.name,
      customer: v.customer.name,
      time: v.status === "CHECKED_IN" ? v.checkInAt : v.checkOutAt || v.checkInAt,
    }))

    // Recent alerts (route deviation, late start, etc.)
    const recentAlerts = await prisma.mtmAlert.findMany({
      where: { organizationId: orgId, createdAt: { gte: activityToday, lt: activityTomorrow }, ...scopedWhere },
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { agent: { select: { name: true } } },
    })

    const alertEvents = recentAlerts.map((a) => ({
      id: `alert-${a.id}`,
      type: "ALERT",
      agent: a.agent?.name || "System",
      customer: a.title,
      time: a.createdAt,
    }))

    // Merge: visits + alerts, sorted by time, max 15
    const liveFeed = [...visitEvents, ...alertEvents]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 15)

    return NextResponse.json({
      success: true,
      data: {
        agentLocations,
        statusCounts,
        freshnessCounts,
        liveFeed,
        teams,
        contract: {
          scope: scopedAgentIds ? "TEAM_OR_REGION" : "ORGANIZATION",
          today: todayKey,
          timezone,
          maxRosterSize: MAX_LIVE_ROSTER_SIZE,
          returnedAgents: agentLocations.length,
          rosterTruncated,
          markerCount: agentLocations.filter((agent) =>
            agent.locationState === "AVAILABLE" &&
            (fieldSessionEnabled
              ? isLiveMapAgentPositionVisible(agent.freshness, agent.workdayState)
              : isLiveMapPositionVisible(agent.freshness)),
          ).length,
          workforceEnabled,
          fieldSessionEnabled,
          generatedAt: now,
          polling: { minimumIntervalSeconds: 15 },
          freshnessThresholds: {
            onlineSeconds: settings.offlineThresholdSeconds,
            delayedSeconds: Math.max(settings.offlineThresholdSeconds, settings.locationWindowMinutes * 60),
          },
          maxAccuracyMeters,
        },
      },
    })
  } catch (e) {
    console.error("[MTM/locations GET]", e)
    return NextResponse.json({ error: "Failed to load locations" }, { status: 500 })
  }
})

export const POST = withRouteFieldWebRlsAuth("write", async (req, auth) => {
  // `/mtm/locations` is a web-only fleet surface. The field app keeps using
  // `/mtm/mobile/location`, whose authenticated agentId and replay contract are
  // intentionally independent from this endpoint.
  const rawBody = await req.json().catch(() => null)
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return locationBadRequest("Invalid location payload")
  }
  const body = rawBody as Record<string, unknown>
  const requestedAgentId = typeof body.agentId === "string" ? body.agentId.trim() : ""
  if (!requestedAgentId || requestedAgentId.length > 191) {
    return locationBadRequest("agentId is required")
  }

  const latitude = finiteNumber(body.latitude)
  const longitude = finiteNumber(body.longitude)
  if (latitude === null || latitude < -90 || latitude > 90 ||
      longitude === null || longitude < -180 || longitude > 180) {
    return locationBadRequest("Invalid coordinates: latitude must be -90..90, longitude must be -180..180")
  }

  const accuracy = optionalMetric(body.accuracy, 0, 100_000)
  const speed = optionalMetric(body.speed, 0, 500)
  const heading = optionalMetric(body.heading, 0, 360)
  const altitude = optionalMetric(body.altitude, -1_000, 100_000)
  const battery = optionalMetric(body.battery, 0, 100)
  if (!accuracy.ok || !speed.ok || !heading.ok || !altitude.ok || !battery.ok) {
    return locationBadRequest("Invalid location telemetry")
  }
  const isMoving = body.isMoving == null ? false : body.isMoving
  if (typeof isMoving !== "boolean") {
    return locationBadRequest("isMoving must be a boolean")
  }

  const now = new Date()
  const recordedAt = locationRecordedAt(body.recordedAt, now)
  if (!recordedAt) {
    return locationBadRequest("recordedAt must be a valid date and not in the future")
  }
  if (recordedAt.getTime() < now.getTime() - MAX_WEB_LOCATION_AGE_MS) {
    return locationBadRequest("recordedAt is too far in the past for web submission")
  }

  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    // See the GET handler: this wrapper is web/API-key-only.
    agentId: null,
  })
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const targetAllowed = actor.role === "ADMIN"
    ? true
    : actor.role === "AGENT"
      ? actor.agentId === requestedAgentId
      : isAgentInRouteScope(actor, requestedAgentId)
  // Keep both out-of-scope and unknown targets indistinguishable. In
  // particular, do not disclose whether a cross-tenant agent ID exists.
  if (!targetAllowed) return locationAgentNotFound()

  try {
    const location = await prisma.$transaction(async (tx) => {
      // The conditional update is the final tenant/existence guard. Creating
      // the coordinate only after it succeeds prevents a body-supplied foreign
      // agentId from ever reaching the location table, even for ADMIN actors.
      const updatedAgent = await tx.mtmAgent.updateMany({
        where: {
          id: requestedAgentId,
          organizationId: auth.orgId,
          status: "ACTIVE",
        },
        data: { isOnline: true, lastSeenAt: now },
      })
      if (updatedAgent.count !== 1) throw new LocationAgentUnavailableError()

      const location = await tx.mtmAgentLocation.create({
        data: {
          organizationId: auth.orgId,
          agentId: requestedAgentId,
          latitude,
          longitude,
          accuracy: accuracy.value,
          speed: speed.value,
          heading: heading.value,
          altitude: altitude.value,
          battery: battery.value,
          isMoving,
          recordedAt,
        },
      })
      // The raw row remains the historical source of truth. Keep its derived
      // live-map projection in the same transaction so the web-only writer
      // cannot leave a permanently stale marker while mobile writers advance
      // it. `advance…` is monotonic and preserves a newer concurrent point.
      await advanceMtmAgentLatestLocation(tx, {
        organizationId: auth.orgId,
        agentId: requestedAgentId,
        sourceLocationId: location.id,
        payloadSha256: null,
        latitude,
        longitude,
        accuracy: accuracy.value,
        speed: speed.value,
        heading: heading.value,
        altitude: altitude.value,
        battery: battery.value,
        isMoving,
        recordedAt,
        receivedAt: now,
      })

      return location
    })

    return NextResponse.json({ success: true, data: location }, { status: 201 })
  } catch (error) {
    if (error instanceof LocationAgentUnavailableError) return locationAgentNotFound()
    console.error("[MTM/locations POST]", error)
    return NextResponse.json({ error: "Failed to save location" }, { status: 500 })
  }
})
