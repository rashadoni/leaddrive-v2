import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { getMtmSettings } from "@/lib/mtm-settings"
import { addDateKeyDays, currentDateKey, isDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import {
  classifyGpsFreshness,
  explainMissingLocation,
  isLiveMapAdmissibleLocation,
  liveMapAdmissibleLocationWhere,
  liveMapMaxAccuracyMeters,
  liveMapWorkdayOf,
  liveMapWorkdayRead,
  mapWorkdayState,
} from "@/lib/mtm/live-location"
import { isLiveMapAgentPositionVisible, isLiveMapPositionVisible, isMtmPositionHeldByBreak, mtmFreshnessAcrossBreak } from "@/lib/mtm-types"
import { readMtmLastBreakEnds } from "@/lib/mtm/live-break-ends"
import { checkRateLimit } from "@/lib/rate-limit"
import { isValidTimezone } from "@/lib/timezone"
import { advanceMtmAgentLatestLocation } from "@/lib/mtm/mobile-location-latest"
import { workforceEnabledForMixedSurface } from "@/lib/workforce-capability"
import {
  combineMtmDayRoutes,
  deriveMtmLiveFieldStatus,
  isMtmAgentMoving,
  MTM_STOPPED_DWELL_MS,
  type MtmLiveRouteFact,
} from "@/lib/mtm/live-field-status"
import { groupMtmLiveFeedAlerts } from "@/lib/mtm/live-feed-alerts"
import { shownMtmStationarySince } from "@/lib/mtm/stationary-anchor"
import { MTM_MOVING_MIN_STORED_SPEED } from "@/lib/mtm/gps-speed"
import { MTM_AGENT_WEB_ONLY_SELECT, mtmAgentNotesReader, readsMtmAgentNotes } from "@/lib/mtm/agent-tags"
import { foldRosterText } from "@/lib/mtm/live-map-roster"
import { locationShareLinkAccessOf, locationShareLinkContract } from "@/lib/mtm/location-share-access"
import {
  isDuringMtmWorkdayPause,
  MTM_WORKDAY_PAUSE_EVENT_TYPES,
  mtmWorkdayPauses,
  type MtmWorkdayPauseEvent,
} from "@/lib/mtm/workday-pauses"

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
    managerId: true
    manager: { select: { name: true } }
    tags: true
    mapColor: true
    locations: true
    workdays: { select: { id: true; status: true; workDate: true; startedAt: true; pausedAt: true; completedAt: true; totalPausedSeconds: true } }
  }
}>

type AgentLocationRow = Prisma.MtmAgentLocationGetPayload<true>

type TodayRouteRow = Prisma.MtmRouteGetPayload<{
  select: { agentId: true; totalPoints: true; visitedPoints: true; status: true }
}>

type ActiveVisitRow = Prisma.MtmVisitGetPayload<{ select: { agentId: true; checkInAt: true } }>

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
    // The labels and the map colour on a card are the managers' notes about
    // the person. This wrapper also admits an integration key, so they are
    // behind an exact «browser session» check (as on the leaderboard: a key,
    // or a fixture without the field, reads none) — and behind the person:
    // a manager or a supervisor is on his own roster, and what was noted
    // about him is not his to read. An administrator reads every row.
    const notesReader = mtmAgentNotesReader({ webSession: auth.principalType === "session", actor })
    const readsNotes = notesReader.kind !== "nobody"
    const ownCardId = notesReader.kind === "all-but-own" ? notesReader.ownAgentId : null

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

    const maxAccuracyMeters = liveMapMaxAccuracyMeters(settings.historyMaxAccuracyMeters)
    // «Ссылка на местоположение» in an employee's card: named in the contract
    // only while the organization has the links switched on, and only to a
    // person at a browser — this wrapper also admits an integration key, and
    // a key is let in to none of it. Absent, the page draws no block.
    const shareLinks = locationShareLinkContract(
      settings.locationShareLinksEnabled,
      locationShareLinkAccessOf({ principalType: auth.principalType, role: auth.role, actor }),
    )

    // The search above the list finds a person by his name — or by a label on
    // his card («стажёр», «ночная смена»). The database matches a label only
    // letter for letter, and people type «vip» for «VIP» and «sukur» for
    // «Şükür». So, only while something is being searched, the labels in use
    // among the people this viewer may see are read first, the ones that read
    // like the search are picked here, and the roster is asked for those
    // exact words beside the name.
    //
    // A search is also a way to read: whoever is not shown the labels would
    // learn them by typing words and watching who comes back. So a caller who
    // reads none gets the name search alone, and a manager's own card is left
    // out of the words that can match and of the label match itself — he is
    // still found by his name.
    const notOwnCard = ownCardId ? { NOT: { id: ownCardId } } : {}
    let labelsLikeSearch: string[] = []
    const sought = employeeQuery ? foldRosterText(employeeQuery) : ""
    if (sought && readsNotes) {
      const labelled = await prisma.mtmAgent.findMany({
        where: {
          organizationId: orgId,
          status: "ACTIVE",
        fieldDeletedAt: null,
          ...(scopedAgentIds ? { id: { in: scopedAgentIds } } : {}),
          ...(teamId ? { teamId } : {}),
          tags: { isEmpty: false },
          ...notOwnCard,
        },
        select: { tags: true },
      })
      const inUse = new Set<string>()
      for (const row of labelled) {
        for (const label of row.tags ?? []) inUse.add(label)
      }
      labelsLikeSearch = [...inUse].filter((label) => foldRosterText(label).includes(sought))
    }
    // With no label like it the search is the name search it has always been.
    const searchWhere: Prisma.MtmAgentWhereInput = !employeeQuery
      ? {}
      : labelsLikeSearch.length === 0
        ? { name: { contains: employeeQuery, mode: "insensitive" } }
        : { OR: [{ name: { contains: employeeQuery, mode: "insensitive" } }, { tags: { hasSome: labelsLikeSearch }, ...notOwnCard }] }

    // Fetch one extra row so the response can disclose a bounded large-team
    // result without ever claiming that a 500-row roster is complete.
    const rosterCandidates = await prisma.mtmAgent.findMany({
      where: {
        organizationId: orgId,
        status: "ACTIVE",
        fieldDeletedAt: null,
        ...(scopedAgentIds ? { id: { in: scopedAgentIds } } : {}),
        ...(teamId ? { teamId } : {}),
        ...searchWhere,
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
        // Whom he reports to — the grouping a dispatcher can actually use:
        // the card has a «Руководитель» field, and nothing in the product
        // fills in a team.
        managerId: true,
        manager: { select: { name: true } },
        // The labels and the map colour a manager put on the card: the list
        // shows and filters by them, the marker is ringed with the colour.
        // The phone never reads them here (requireAuth refuses its token, and
        // the path is in MTM_WEB_ONLY_PREFIXES), but an integration key does
        // reach this handler — so they are read only for somebody who is
        // given them (notesReader above).
        ...(readsNotes ? MTM_AGENT_WEB_ONLY_SELECT : {}),
        // The live marker is the newest admissible coordinate. Accuracy is a
        // quality gate/metadata field, never a reason to replace a newer point
        // with an older, prettier one. Defensive JS validation below also
        // protects against legacy non-finite rows. The filter and the reading
        // of the workdays are shared with the public answer of a «ссылка на
        // местоположение» (src/lib/mtm/live-location.ts).
        locations: {
          where: liveMapAdmissibleLocationWhere(maxAccuracyMeters),
          take: 5,
          orderBy: { recordedAt: "desc" },
        },
        ...(fieldSessionEnabled ? { workdays: {
          // Keep an unfinished prior-day shift visible. Calling it "not
          // started" would hide the exact anomaly the operator must resolve.
          ...liveMapWorkdayRead(routeToday),
          select: { id: true, status: true, workDate: true, startedAt: true, pausedAt: true, completedAt: true, totalPausedSeconds: true },
        } } : {}),
      },
    })
    const rosterTruncated = rosterCandidates.length > MAX_LIVE_ROSTER_SIZE
    const agents = rosterCandidates.slice(0, MAX_LIVE_ROSTER_SIZE)
    const returnedAgentIds = agents.map((agent: AgentWithLocations) => agent.id)
    const scopedWhere = returnedAgentIds.length ? { agentId: { in: returnedAgentIds } } : { agentId: "__no_access__" }

    // Get today's route completion per agent. An agent can hold several
    // routes a day; they are combined, never "whichever row came last"
    // (src/lib/mtm/live-field-status.ts, review of #205).
    const todayRoutes = await prisma.mtmRoute.findMany({
      where: { organizationId: orgId, date: { gte: routeToday, lt: routeTomorrow }, deletedAt: null, ...scopedWhere },
      select: { agentId: true, totalPoints: true, visitedPoints: true, status: true },
    })
    const routesByAgent = new Map<string, MtmLiveRouteFact[]>()
    for (const r of todayRoutes as TodayRouteRow[]) {
      const list = routesByAgent.get(r.agentId) ?? []
      list.push({ status: r.status, totalPoints: r.totalPoints, visitedPoints: r.visitedPoints })
      routesByAgent.set(r.agentId, list)
    }
    const dayRoutesByAgent = new Map(
      [...routesByAgent.entries()].map(([agentId, routes]) => [agentId, combineMtmDayRoutes(routes)]),
    )

    // The newest moving sample per agent within the dwell window. One
    // motionless point at a red light must not read «Dayanıb».
    const movementSince = new Date(now.getTime() - MTM_STOPPED_DWELL_MS)
    const recentMovement = returnedAgentIds.length
      ? await prisma.mtmAgentLocation.groupBy({
          by: ["agentId"],
          where: {
            organizationId: orgId,
            agentId: { in: returnedAgentIds },
            recordedAt: { gte: movementSince, lte: now },
            OR: [{ isMoving: true }, { speed: { gte: MTM_MOVING_MIN_STORED_SPEED } }],
          },
          _max: { recordedAt: true },
        })
      : []
    const lastMovingAtByAgent = new Map(
      (recentMovement as unknown as Array<{ agentId: string; _max: { recordedAt: Date | null } | null }>)
        .map((row) => [row.agentId, row._max?.recordedAt ?? null]),
    )

    // Where and when each standing employee's current stop began — «стоит N
    // минут». Kept with his latest position by the writer of every GPS point
    // (src/lib/mtm/stationary-anchor.ts); one narrow read by the table's own
    // unique index, for the people who are standing only.
    const stationaryAnchors = returnedAgentIds.length
      ? await prisma.mtmAgentLatestLocation.findMany({
          where: { organizationId: orgId, agentId: { in: returnedAgentIds }, stationarySince: { not: null } },
          select: {
            agentId: true, recordedAt: true,
            stationarySince: true, stationaryLatitude: true, stationaryLongitude: true, stationaryConfirmedAt: true,
          },
        })
      : []
    const stationaryAnchorByAgent = new Map(
      ((stationaryAnchors ?? []) as Array<{
        agentId: string
        recordedAt: Date
        stationarySince: Date | null
        stationaryLatitude: number | null
        stationaryLongitude: number | null
        stationaryConfirmedAt: Date | null
      }>).map((row) => [row.agentId, row]),
    )

    // Every visit that is open right now, whatever day it was opened on.
    // Until 2026-10-08 only visits opened today counted. The owner's agent
    // checked in at 22:14 and was still in that visit the next morning: his
    // app showed the open visit, the server refused him any other check-in
    // because of it (that check has no date in it) — and the map counted him
    // «Gecikir», with zero on «Yerində». A visit does not close at midnight,
    // so the map may not pretend it did; when it was opened goes out with it.
    const activeVisits = await prisma.mtmVisit.findMany({
      where: { organizationId: orgId, status: "CHECKED_IN", deletedAt: null, ...scopedWhere },
      select: { agentId: true, checkInAt: true },
    })
    const openVisitSinceByAgent = new Map<string, Date | null>()
    for (const visit of activeVisits as ActiveVisitRow[]) {
      const known = openVisitSinceByAgent.get(visit.agentId)
      const opened = visit.checkInAt instanceof Date ? visit.checkInAt : null
      // One open visit per agent is the rule; should there be two, the older says how long.
      if (!openVisitSinceByAgent.has(visit.agentId) || (opened && (!known || opened < known))) {
        openVisitSinceByAgent.set(visit.agentId, opened)
      }
    }
    const checkedInAgents = new Set(openVisitSinceByAgent.keys())

    // The shift each employee is in, and — for whoever has come back from a
    // break — when his latest break ended, from the shift's own journal: the
    // newest point may still be the one he left before it.
    const shiftByAgent = new Map((agents as AgentWithLocations[]).map((a) => [
      a.id,
      liveMapWorkdayOf(fieldSessionEnabled ? a.workdays ?? [] : [], routeToday),
    ]))
    const lastBreakEndByWorkday = await readMtmLastBreakEnds({
      organizationId: orgId,
      workdays: [...shiftByAgent.values()].map((shift) => shift.effective),
    })

    // Determine field status per agent
    const agentLocations = (agents as AgentWithLocations[]).map((a) => {
      const loc = a.locations.find((candidate: AgentLocationRow) => isLiveMapAdmissibleLocation(candidate, maxAccuracyMeters)) ?? null
      const dayRoutes = dayRoutesByAgent.get(a.id) ?? null
      const isCheckedIn = checkedInAgents.has(a.id)
      const { active: activeWorkday, effective: effectiveWorkday } = shiftByAgent.get(a.id) ?? { active: undefined, effective: undefined }

      const workdayState = fieldSessionEnabled ? mapWorkdayState(effectiveWorkday?.status) : "NOT_STARTED"
      // A break is the employee's own time: the point he left before it is
      // where the work stopped, not where he is — the last known point, from
      // the first second of the break until his first fix after it. So it is
      // in this answer too, for every reader of it: the marker count, the
      // counts by status and by signal, and an integration's key, not only
      // the page that presents the row again (isMtmPositionHeldByBreak).
      const freshness = mtmFreshnessAcrossBreak(classifyGpsFreshness(loc?.recordedAt, now, {
        onlineSeconds: settings.offlineThresholdSeconds,
        delayedSeconds: Math.max(settings.offlineThresholdSeconds, settings.locationWindowMinutes * 60),
      }), isMtmPositionHeldByBreak({
        workdayState,
        recordedAt: loc?.recordedAt,
        lastBreakEndedAt: effectiveWorkday ? lastBreakEndByWorkday.get(effectiveWorkday.id) : null,
      }))
      const workdayCarryover = fieldSessionEnabled && Boolean(
        activeWorkday && activeWorkday.workDate.getTime() !== routeToday.getTime(),
      )

      // Field activity remains separate from GPS freshness and workday state.
      // «Yolda» now requires movement, and a closed route says so instead of
      // falling through to "on the road" (src/lib/mtm/live-field-status.ts).
      const fieldStatus = deriveMtmLiveFieldStatus({
        freshness,
        isCheckedIn,
        isOnline: a.isOnline,
        isMoving: loc ? isMtmAgentMoving({
          samples: a.locations.filter((candidate: AgentLocationRow) =>
            Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude)),
          lastMovingAt: lastMovingAtByAgent.get(a.id) ?? null,
          now,
        }) : false,
        dayRoutes,
        tenantHour,
        lateAfterHour: settings.lateAfterHour,
      })

      return {
        agentId: a.id,
        name: a.name,
        isOnline: a.isOnline,
        lastSeenAt: a.lastSeenAt,
        teamId: a.teamId,
        teamName: a.team?.name ?? null,
        managerId: a.managerId ?? null,
        managerName: a.manager?.name ?? null,
        // Always a list and always a key or null, so the page never has to
        // guess what an absent field means — also for a caller who is not
        // given them, and on the viewer's own row. The colour goes out as the
        // stored key: the palette that turns it into a hex is the browser's.
        tags: readsMtmAgentNotes(notesReader, a.id) ? a.tags ?? [] : [],
        mapColor: readsMtmAgentNotes(notesReader, a.id) ? a.mapColor ?? null : null,
        fieldStatus,
        freshness,
        workdayState,
        workdayDate: fieldSessionEnabled ? effectiveWorkday?.workDate ?? null : null,
        workdayStartedAt: fieldSessionEnabled ? effectiveWorkday?.startedAt ?? null : null,
        // When the break began and when the shift was closed: the card says
        // «перерыв с 13:05», not only that the map went quiet (src/lib/mtm/live-map-state-since.ts).
        // Workforce facts: a Routes-only tenant's field session discloses its
        // state, date and start, and nothing more of the workday.
        workdayPausedAt: workforceEnabled && effectiveWorkday?.status === "PAUSED" ? effectiveWorkday.pausedAt ?? null : null,
        workdayCompletedAt: workforceEnabled && effectiveWorkday?.status === "COMPLETED" ? effectiveWorkday.completedAt ?? null : null,
        // The breaks already over, in seconds: it grows when one ends, so the
        // page's tail is cut at a break no answer of the roster fell inside.
        workdayPausedSeconds: workforceEnabled && effectiveWorkday ? effectiveWorkday.totalPausedSeconds ?? null : null,
        workdayCarryover,
        locationState: explainMissingLocation({ hasLocation: Boolean(loc), lastSeenAt: a.lastSeenAt }),
        routeCompletion: dayRoutes?.completion ?? 0,
        // «2 of 4» on the card, before anybody is selected: the day's stops
        // across all of the agent's routes that count (no drafts, no cancelled).
        routeVisited: dayRoutes ? Math.min(dayRoutes.visitedPoints, dayRoutes.totalPoints) : 0,
        routeTotal: dayRoutes?.totalPoints ?? 0,
        // Only with the status it explains: an old GPS point says «offline»
        // first, and then nothing is claimed about a visit either.
        openVisitSince: fieldStatus === "CHECKED_IN" ? openVisitSinceByAgent.get(a.id) ?? null : null,
        // Only with the status it explains, only for a position the map
        // shows — never on a break, whose last point is where the work
        // stopped — and only when the anchor is about that very point:
        // whenever the two disagree the duration is left out, never guessed.
        stationarySince: fieldStatus === "STOPPED" && loc && isLiveMapAgentPositionVisible(freshness, workdayState)
          ? shownMtmStationarySince(loc, stationaryAnchorByAgent.get(a.id), now)
          : null,
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
      stopped: agentLocations.filter((a) => a.fieldStatus === "STOPPED").length,
      routeFinished: agentLocations.filter((a) => a.fieldStatus === "ROUTE_FINISHED").length,
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
      agentId: v.agentId,
      visitId: v.id,
      agent: v.agent.name,
      customer: v.customer.name,
      time: v.status === "CHECKED_IN" ? v.checkInAt : v.checkOutAt || v.checkInAt,
    }))

    // Recent alerts (route deviation, late start, etc.). One drifting agent
    // writes an alert per throttle window, so read a wider slice and collapse
    // repeats per agent, kind and local hour before they reach the feed —
    // ten identical rows used to push every visit out of it (audit 2026-09-14).
    const recentAlerts = await prisma.mtmAlert.findMany({
      where: { organizationId: orgId, createdAt: { gte: activityToday, lt: activityTomorrow }, ...scopedWhere },
      take: 60,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        agentId: true,
        type: true,
        title: true,
        metadata: true,
        createdAt: true,
        agent: { select: { name: true } },
      },
    })

    const alertEvents = groupMtmLiveFeedAlerts(
      recentAlerts.map((a) => ({
        id: a.id,
        agentId: a.agentId,
        agentName: a.agent?.name ?? null,
        type: a.type,
        title: a.title,
        createdAt: a.createdAt,
        metadata: a.metadata,
      })),
      timezone,
    )

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
          // The radius a check-in is accepted in where the client has none of
          // its own: the live map draws client zones with it.
          geofenceRadiusMeters: settings.geofenceRadius,
          ...(shareLinks ? { shareLinks } : {}),
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

  // A break is the employee's own time: where it is spent is not stored,
  // whoever sends the point (owner, 2026-10-12). The phone has been refused
  // such a point since A7 and the batch route since 2026-10-11; this entry — a
  // web session or an integration's key writing for an employee — looked at no
  // workday at all, and its point moved the marker on the live map while the
  // break ran. Only the break is asked about: a point for somebody who has no
  // shift at that moment is written as before.
  //
  // The shift is the last one begun by then, its breaks come from its own
  // journal with the reader the phone's routes use (workday-pauses.ts), and
  // the question is when the point was taken. A foreign or unknown agentId
  // finds no shift here and is still refused by the conditional update below.
  const workdayThen: { id: string } | null = await prisma.mtmAgentWorkday.findFirst({
    where: { organizationId: auth.orgId, agentId: requestedAgentId, startedAt: { lte: recordedAt } },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  })
  if (workdayThen) {
    const pauseEvents: MtmWorkdayPauseEvent[] = await prisma.mtmAgentWorkdayEvent.findMany({
      where: {
        organizationId: auth.orgId,
        agentId: requestedAgentId,
        workdayId: workdayThen.id,
        type: { in: [...MTM_WORKDAY_PAUSE_EVENT_TYPES] },
      },
      orderBy: { occurredAt: "asc" },
      select: { type: true, occurredAt: true, appliedAt: true },
    })
    if (isDuringMtmWorkdayPause(recordedAt, mtmWorkdayPauses(pauseEvents))) {
      return NextResponse.json(
        { error: "recordedAt falls inside a workday break", code: "MTM_LOCATION_WORKDAY_PAUSED" },
        { status: 409 },
      )
    }
  }

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
        fieldDeletedAt: null,
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
