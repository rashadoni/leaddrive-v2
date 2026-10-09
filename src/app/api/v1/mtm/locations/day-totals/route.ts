import { NextResponse } from "next/server"
import { liveMapDayTotalsCacheKey, readLiveMapDayTotalsCache, writeLiveMapDayTotalsCache } from "@/lib/mtm/live-map-day-totals-cache"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { getMtmSettings } from "@/lib/mtm-settings"
import { addDateKeyDays, currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { checkRateLimit } from "@/lib/rate-limit"
import { isValidTimezone } from "@/lib/timezone"
import { workforceEnabledForMixedSurface } from "@/lib/workforce-capability"
import { LOCATION_HISTORY_MAX_RAW_POINTS, type HistoryLocationPoint, type HistoryVisit } from "@/lib/mtm/location-history"
import { mapMatchingBaseUrl, matchRoads } from "@/lib/mtm/map-matching"
import { distanceBasis, type DistanceBasis } from "@/lib/mtm/road-distance"
import { liveMapDayPauses, liveMapDayPolicy, liveMapDayTotals, liveMapDayTrack } from "@/lib/mtm/live-map-day-totals"

// Asked for when an employee is selected and then every couple of minutes
// while his card is open — never on the roster's timer. Thirty a minute lets a
// dispatcher click down the list.
const RATE_LIMIT = { maxRequests: 60, windowMs: 60_000 }
/**
 * How long the road server may take. History waits five seconds for a page
 * somebody opened on purpose; a block of a card waits half of that. What the
 * road server has not answered by then is counted in straight lines, and the
 * answer says so.
 */
const ROAD_DEADLINE_MS = 2_500
interface DayTotalsAnswer {
  date: string
  timezone: string
  distanceMeters: number | null
  /** What the kilometres were counted along; null when they were not counted. */
  distanceBasis: DistanceBasis | null
  movingSeconds: number | null
  unknownSeconds: number | null
  firstPointAt: string | null
  lastPointAt: string | null
  /** False when the day has more fixes than one reading holds: nothing was counted. */
  complete: boolean
  generatedAt: string
}

type LocationRow = Prisma.MtmAgentLocationGetPayload<{
  select: { id: true; latitude: true; longitude: true; accuracy: true; recordedAt: true }
}>

type VisitRow = Prisma.MtmVisitGetPayload<{
  select: {
    id: true
    customerId: true
    status: true
    checkInAt: true
    checkOutAt: true
    checkInLat: true
    checkInLng: true
    customer: { select: { latitude: true; longitude: true } }
  }
}>

type WorkdayRow = Prisma.MtmAgentWorkdayGetPayload<{ select: { startedAt: true; completedAt: true } }>

type PauseEventRow = Prisma.MtmAgentWorkdayEventGetPayload<{ select: { type: true; occurredAt: true } }>

// Out of his team and unknown read the same: the answer must not tell a
// manager whether an employee id of another team, or another company, exists.
function agentNotFound() {
  return NextResponse.json({ error: "Agent not found" }, { status: 404 })
}

/**
 * GET /api/v1/mtm/locations/day-totals?agentId=
 *
 * «Пробег сегодня» and «В движении» for the selected employee's card on the
 * live map: how far he has gone today, for how long he was driving, for how
 * long the phone said nothing — three numbers and when the first and the
 * last fix came.
 *
 * The live map promises that a day's GPS track is loaded only when «История»
 * is opened (SWM-12, the page's own sentence `historyOnlyExplicit`). That
 * stays true: the day's fixes are read here, on the server, and counted by
 * the rule «История за день» counts by (src/lib/mtm/live-map-day-totals.ts);
 * only the numbers leave. No coordinate, no point, no stop, no client.
 *
 * No audit row is written. The audit log answers «who looked at whose
 * location», and its rows are written where the coordinates of a named
 * person leave the server (GPS_HISTORY_VIEW, WEEK_GPS_LATEST_READ). This
 * answer carries none — the same kind of read as GET /api/v1/mtm/agent-period,
 * which returns every day's kilometres and writes none either. A row for
 * every card opened would bury the rows that are evidence.
 *
 * «Today» is the organization's own day and is worked out here. The browser
 * is not asked for a date, so the card cannot be used to read another day
 * past History's audit.
 *
 * The managers' web screen only, as the live map itself: no mobile token, no
 * field agent; a manager or supervisor — for the employees of his team.
 */
export const GET = withRouteFieldWebRlsAuth("read", async (req, auth) => {
  const orgId = auth.orgId
  try {
    const actor = await resolveMtmRouteActor(prisma, {
      organizationId: orgId,
      userId: auth.userId,
      webRole: auth.role,
      // The web-only wrapper has already rejected mobile JWTs.
      agentId: null,
    })
    // The live map itself is the managers' screen (see GET /api/v1/mtm/locations).
    if (!actor || actor.role === "AGENT") {
      return NextResponse.json({ error: "Manager access required" }, { status: 403 })
    }

    const agentId = new URL(req.url).searchParams.get("agentId")?.trim() ?? ""
    if (!agentId) {
      return NextResponse.json({ error: "agentId is required", code: "MTM_LIVE_MAP_DAY_TOTALS_INVALID" }, { status: 400 })
    }
    // Whose day it is comes first: nothing below — not the remembered answer,
    // not a single row — is reached for an employee outside the viewer's team.
    if (!isAgentInRouteScope(actor, agentId)) return agentNotFound()
    const agent = await prisma.mtmAgent.findFirst({
      where: { id: agentId, organizationId: orgId, status: "ACTIVE" },
      select: { id: true },
    })
    if (!agent) return agentNotFound()

    const settings = await getMtmSettings(orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const now = new Date()
    const todayKey = currentDateKey(now, timezone)
    // One counted day is kept for a minute (src/lib/mtm/live-map-day-totals-cache.ts).
    const cacheKey = liveMapDayTotalsCacheKey(orgId, agentId, todayKey)
    const known = readLiveMapDayTotalsCache<DayTotalsAnswer>(cacheKey, now.getTime())
    if (known) return NextResponse.json({ success: true, data: known })
    // The allowance is spent on days that are really counted, not on answers
    // already kept: a dispatcher going down the list and back does not lock
    // himself out of the block.
    if (!checkRateLimit(`mtm-live-map-day-totals:${orgId}:${auth.userId}`, RATE_LIMIT)) {
      return NextResponse.json(
        { error: "Refresh rate limit exceeded", retryAfterSeconds: 60 },
        { status: 429, headers: { "Retry-After": "60" } },
      )
    }

    const dayStart = localDateKeyToUtc(todayKey, timezone)
    const dayEnd = localDateKeyToUtc(addDateKeyDays(todayKey, 1), timezone)
    const policy = liveMapDayPolicy(settings)
    // The shift and its breaks are Workforce records: a tenant without the
    // module gets a day that begins at its first fix, as in History.
    const workforceEnabled = await workforceEnabledForMixedSurface(orgId, "MTM/locations/day-totals GET")

    const [locationRows, visitRows, workday, pauseEvents] = await Promise.all([
      prisma.mtmAgentLocation.findMany({
        where: { organizationId: orgId, agentId, recordedAt: { gte: dayStart, lt: dayEnd } },
        orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
        // History's own cap for one day. A day that fills it is not counted at all.
        take: LOCATION_HISTORY_MAX_RAW_POINTS,
        // Only what the count reads. Speed and the «moving» flag are left in
        // the table on purpose: see live-map-day-totals.ts.
        select: { id: true, latitude: true, longitude: true, accuracy: true, recordedAt: true },
      }),
      prisma.mtmVisit.findMany({
        where: {
          organizationId: orgId,
          agentId,
          deletedAt: null,
          // Today's visits are the ones begun today, as the period view takes
          // them. History's window also takes in a visit begun on an earlier
          // day and still open, and the day's trip starts at its earliest
          // anchor: one visit forgotten open three days ago turned a
          // fifty-minute day into seventy hours «в движении».
          checkInAt: { gte: dayStart, lt: dayEnd },
        },
        orderBy: { checkInAt: "asc" },
        // Where and when the visit was. The client's name and address are
        // History's to show; the numbers do not need them.
        select: {
          id: true,
          customerId: true,
          status: true,
          checkInAt: true,
          checkOutAt: true,
          checkInLat: true,
          checkInLng: true,
          customer: { select: { latitude: true, longitude: true } },
        },
      }),
      workforceEnabled
        ? prisma.mtmAgentWorkday.findFirst({
          where: { organizationId: orgId, agentId, workDate: new Date(`${todayKey}T00:00:00.000Z`) },
          select: { startedAt: true, completedAt: true },
        })
        : Promise.resolve(null),
      workforceEnabled
        ? prisma.mtmAgentWorkdayEvent.findMany({
          where: {
            organizationId: orgId,
            agentId,
            type: { in: ["PAUSE", "RESUME"] },
            occurredAt: { gte: dayStart, lt: dayEnd },
          },
          orderBy: { occurredAt: "asc" },
          select: { type: true, occurredAt: true },
        })
        : Promise.resolve([]),
    ])

    const rows: HistoryLocationPoint[] = (locationRows as LocationRow[]).map((row) => ({
      ...row,
      speed: null,
      heading: null,
      battery: null,
      isMoving: false,
      workdayId: null,
    }))
    const visits: HistoryVisit[] = (visitRows as VisitRow[]).map((visit) => ({
      ...visit,
      customer: { name: "", address: null, latitude: visit.customer.latitude, longitude: visit.customer.longitude },
    }))
    const shift = workday as WorkdayRow | null
    const truncated = rows.length === LOCATION_HISTORY_MAX_RAW_POINTS

    // The kilometres along the roads, from the company's own road server —
    // without them the card would show a second, smaller figure for the day
    // History shows. Its answers are kept per stretch of a hundred fixes, so
    // a day that grew since the last question costs one request.
    const track = liveMapDayTrack(rows, policy.maxAccuracyMeters)
    const road = truncated ? null : await matchRoads(track, { deadlineMs: ROAD_DEADLINE_MS }).catch(() => null)
    const roadServerSilent = !truncated && road === null && track.length >= 2 && mapMatchingBaseUrl() !== null
    const totals = liveMapDayTotals({
      rows,
      visits,
      workday: shift ? { startedAt: shift.startedAt, completedAt: shift.completedAt } : null,
      pauses: liveMapDayPauses(pauseEvents as PauseEventRow[]),
      policy,
      roadSteps: road?.stepMeters,
      truncated,
    })

    const answer: DayTotalsAnswer = {
      date: todayKey,
      timezone,
      distanceMeters: totals.distanceMeters,
      distanceBasis: truncated ? null : distanceBasis(road),
      movingSeconds: totals.movingSeconds,
      unknownSeconds: totals.unknownSeconds,
      firstPointAt: totals.firstPointAt?.toISOString() ?? null,
      lastPointAt: totals.lastPointAt?.toISOString() ?? null,
      complete: !truncated,
      generatedAt: now.toISOString(),
    }

    // A day the road server answered only in part is not kept: the next
    // question finds more of its stretches already answered, and a minute of
    // the smaller figure would be shown to everybody who opens the card. The
    // same goes for a day it did not answer at all though it was there to be
    // asked — down, or resting after a failure: those straight lines are a
    // failed answer, and «История за день» a minute later would show more.
    if (answer.distanceBasis !== "PARTIAL" && !roadServerSilent) writeLiveMapDayTotalsCache(cacheKey, answer, now.getTime())

    return NextResponse.json({ success: true, data: answer })
  } catch (e) {
    console.error("[MTM/locations/day-totals GET]", e)
    return NextResponse.json({ error: "Failed to load the day's totals", code: "MTM_LIVE_MAP_DAY_TOTALS_FAILED" }, { status: 500 })
  }
})
