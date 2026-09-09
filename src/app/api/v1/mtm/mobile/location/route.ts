import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { hasMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { calculateDistance, distanceToPolyline } from "@/lib/geo-utils"
import { checkRateLimit, hashForRateLimit } from "@/lib/rate-limit"
import { notifyAgent } from "@/lib/mtm-notify"
import { getMtmSettings } from "@/lib/mtm-settings"
import {
  addDateKeyDays,
  currentDateKey,
  isDateKey,
  localDateKeyToUtc,
} from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { mtmMobileLocationPayloadSha256 } from "@/lib/mtm/mobile-location-idempotency"
import { advanceMtmAgentLatestLocation } from "@/lib/mtm/mobile-location-latest"
import { isDuringMtmWorkdayPause, mtmWorkdayPauses, serializeMtmWorkdayPauses } from "@/lib/mtm/workday-pauses"
import { mtmAlertMessage } from "@/lib/mtm/alert-messages"

// gpsInterval (org setting, default 30s) is what mobile should use. The
// server limit leaves room for retries and clock skew without accepting a
// runaway client that uploads hundreds of points per second.
const LOCATION_RATE_LIMIT = { maxRequests: 30, windowMs: 60_000 }
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

class MobileLocationActorUnavailableError extends Error {}
class MobileLocationWorkdayUnavailableError extends Error {}

type LocationWorkdayWindow = {
  id: string
  status: "STARTED" | "PAUSED" | "COMPLETED"
  startedAt: Date
  completedAt: Date | null
}

function isRecordedInsideWorkday(recordedAt: Date, workday: LocationWorkdayWindow): boolean {
  if (recordedAt < workday.startedAt) return false
  if (workday.status !== "COMPLETED") return true
  return workday.completedAt !== null && recordedAt <= workday.completedAt
}

function finiteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
}

function isValidLatLng(lat: unknown, lng: unknown): lat is number {
  return finiteInRange(lat, -90, 90) && finiteInRange(lng, -180, 180)
}

function validOptionalMetric(value: unknown, min: number, max: number): boolean {
  return value == null || finiteInRange(value, min, max)
}

function parseRecordedAt(value: unknown, now: Date): Date | null {
  if (value == null) return now
  if (typeof value !== "string" && typeof value !== "number") return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) return null
  return parsed
}

function travelledDistance(locations: Array<{ latitude: number; longitude: number }>): number {
  let total = 0
  for (let index = 1; index < locations.length; index += 1) {
    total += calculateDistance(
      locations[index - 1].latitude,
      locations[index - 1].longitude,
      locations[index].latitude,
      locations[index].longitude,
    )
  }
  return Math.round(total)
}

function locationForEnabledProducts<T extends { workdayId?: unknown }>(
  location: T,
  workforceEnabled: boolean,
): T | Omit<T, "workdayId"> {
  if (workforceEnabled) return location
  const routeLocation = { ...location } as Partial<T>
  delete routeLocation.workdayId
  return routeLocation as Omit<T, "workdayId">
}

/**
 * POST /api/v1/mtm/mobile/location
 * Submit a live or offline-captured GPS point from the authenticated agent.
 * `clientLocationId` makes a retry replay-safe; `recordedAt` keeps the real
 * capture time instead of rewriting offline history to upload time. Team
 * roles must use `mode: "SELF_SHARE"`; that narrow contract stores only their
 * own point and never associates it with a field workday or route deviation.
 */
export const POST = withMobileRls(async (req, auth) => {
  try {
    const workforceEnabled = auth.tenantCapabilities?.workforceHrm === true
    const body = await req.json()
    const selfLocationShare = body.mode === "SELF_SHARE"
    const forbidden = requireMobileCapability(
      auth,
      selfLocationShare ? "SELF_LOCATION_SHARE" : "FIELD_TRACK",
    )
    if (forbidden) return forbidden
    const {
      latitude,
      longitude,
      accuracy,
      speed,
      heading,
      altitude,
      battery,
    } = body
    const now = new Date()
    const recordedAt = parseRecordedAt(body.recordedAt, now)
    const clientLocationId = body.clientLocationId == null ? null : String(body.clientLocationId).trim()
    // Team roles may share only their own current device location through the
    // explicit SELF_SHARE contract. It never attaches to a field workday,
    // even if a compromised/stale client includes a workdayId.
    const workdayId = selfLocationShare || body.workdayId == null
      ? null
      : String(body.workdayId).trim()

    if (latitude == null || longitude == null) {
      return NextResponse.json({ error: "latitude and longitude required" }, { status: 400 })
    }
    if (!isValidLatLng(latitude, longitude)) {
      return NextResponse.json(
        { error: "Invalid coordinates: latitude must be -90..90, longitude must be -180..180" },
        { status: 400 },
      )
    }
    if (!recordedAt) {
      return NextResponse.json({ error: "recordedAt must be a valid date and not in the future" }, { status: 400 })
    }
    if (clientLocationId != null && (clientLocationId.length === 0 || clientLocationId.length > 100)) {
      return NextResponse.json({ error: "clientLocationId must be 1-100 characters" }, { status: 400 })
    }
    if (workdayId != null && workdayId.length === 0) {
      return NextResponse.json({ error: "workdayId must be a non-empty identifier" }, { status: 400 })
    }
    if (!validOptionalMetric(accuracy, 0, 100_000) ||
        !validOptionalMetric(speed, 0, 500) ||
        !validOptionalMetric(heading, 0, 360) ||
        !validOptionalMetric(altitude, -1_000, 100_000) ||
        !validOptionalMetric(battery, 0, 100)) {
      return NextResponse.json({ error: "Invalid location telemetry" }, { status: 400 })
    }

    if (clientLocationId) {
      const existing = await prisma.mtmAgentLocation.findFirst({
        where: { organizationId: auth.orgId, agentId: auth.agentId, clientLocationId },
      })
      if (existing) {
        return NextResponse.json({
          success: true,
          data: { location: locationForEnabledProducts(existing, workforceEnabled), replayed: true },
        })
      }
    }

    const rateKey = await hashForRateLimit(`mtm-location:${auth.agentId}`)
    if (!checkRateLimit(rateKey, LOCATION_RATE_LIMIT)) {
      return NextResponse.json(
        { error: "Location updates too frequent. Respect gpsInterval setting." },
        { status: 429, headers: { "Retry-After": "60" } },
      )
    }

    let resolvedWorkday: LocationWorkdayWindow | null = null
    if (!selfLocationShare) {
      if (workdayId) {
        resolvedWorkday = await prisma.mtmAgentWorkday.findFirst({
          where: {
            id: workdayId,
            organizationId: auth.orgId,
            agentId: auth.agentId,
          },
          select: { id: true, status: true, startedAt: true, completedAt: true },
        })
        if (!resolvedWorkday) {
          return NextResponse.json(
            { error: "workdayId must belong to the authenticated agent", code: "MTM_LOCATION_WORKDAY_INVALID" },
            { status: 409 },
          )
        }
      } else {
        resolvedWorkday = await prisma.mtmAgentWorkday.findFirst({
          where: {
            organizationId: auth.orgId,
            agentId: auth.agentId,
            status: { in: ["STARTED", "PAUSED"] },
          },
          orderBy: { startedAt: "desc" },
          select: { id: true, status: true, startedAt: true, completedAt: true },
        })
      }
      if (!resolvedWorkday) {
        return NextResponse.json(
          { error: "An active workday is required before location tracking starts", code: "MTM_LOCATION_WORKDAY_REQUIRED" },
          { status: 409 },
        )
      }
      if (!isRecordedInsideWorkday(recordedAt, resolvedWorkday)) {
        return NextResponse.json(
          { error: "recordedAt is outside the supplied workday", code: "MTM_LOCATION_OUTSIDE_WORKDAY" },
          { status: 409 },
        )
      }
      // A7: a break is not work. The check is on WHEN the point was taken, not
      // on the shift's status right now — a point captured before the break and
      // delivered from the offline queue during it is still work, and the same
      // point captured at lunch is not, however late it arrives.
      const pauseEvents = await prisma.mtmAgentWorkdayEvent.findMany({
        where: {
          organizationId: auth.orgId,
          agentId: auth.agentId,
          workdayId: resolvedWorkday.id,
          type: { in: ["PAUSE", "RESUME", "FINISH"] },
        },
        orderBy: { occurredAt: "asc" },
        select: { type: true, occurredAt: true },
      })
      if (isDuringMtmWorkdayPause(recordedAt, mtmWorkdayPauses(pauseEvents))) {
        return NextResponse.json(
          { error: "recordedAt falls inside a workday break", code: "MTM_LOCATION_WORKDAY_PAUSED" },
          { status: 409 },
        )
      }
    }
    const selectedWorkday = resolvedWorkday
    const isMoving = (speed ?? 0) > 1
    const payloadSha256 = mtmMobileLocationPayloadSha256({
      workdayId: selectedWorkday?.id ?? null,
      latitude,
      longitude,
      accuracy: accuracy ?? null,
      speed: speed ?? null,
      heading: heading ?? null,
      altitude: altitude ?? null,
      battery: battery ?? null,
      recordedAt,
    })

    let location
    try {
      location = await prisma.$transaction(async (tx) => {
        // Workday state can change between the preflight and the write. Repeat
        // the temporal check in the same transaction so a live point cannot
        // slip in after FINISH, while a queued point captured before FINISH
        // remains valid when it carries its explicit workday id.
        let persistedWorkdayId: string | null = null
        if (selectedWorkday) {
          const currentWorkday = await tx.mtmAgentWorkday.findFirst({
            where: {
              id: selectedWorkday.id,
              organizationId: auth.orgId,
              agentId: auth.agentId,
            },
            select: { id: true, status: true, startedAt: true, completedAt: true },
          })
          if (!currentWorkday || !isRecordedInsideWorkday(recordedAt, currentWorkday)) {
            throw new MobileLocationWorkdayUnavailableError()
          }
          persistedWorkdayId = currentWorkday.id
        }

        // Auth was freshly revoked/scoped by withMobileRls. Repeat the tenant +
        // ACTIVE predicate in the write transaction so a deactivation race or
        // impossible cross-tenant token pair cannot create a coordinate.
        const updatedAgent = await tx.mtmAgent.updateMany({
          where: {
            id: auth.agentId,
            organizationId: auth.orgId,
            status: "ACTIVE",
          },
          data: { isOnline: true, lastSeenAt: now },
        })
        if (updatedAgent.count !== 1) throw new MobileLocationActorUnavailableError()

        const created = await tx.mtmAgentLocation.create({
          data: {
            organizationId: auth.orgId,
            agentId: auth.agentId,
            workdayId: persistedWorkdayId,
            clientLocationId,
            payloadSha256,
            latitude,
            longitude,
            accuracy: accuracy ?? null,
            speed: speed ?? null,
            heading: heading ?? null,
            altitude: altitude ?? null,
            battery: battery ?? null,
            isMoving,
            recordedAt,
          },
        })
        await advanceMtmAgentLatestLocation(tx, {
          organizationId: auth.orgId,
          agentId: auth.agentId,
          sourceLocationId: created.id,
          payloadSha256,
          latitude,
          longitude,
          accuracy: accuracy ?? null,
          speed: speed ?? null,
          heading: heading ?? null,
          altitude: altitude ?? null,
          battery: battery ?? null,
          isMoving,
          recordedAt,
          receivedAt: now,
        })
        return created
      })
    } catch (error) {
      if (error instanceof MobileLocationActorUnavailableError) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
      if (error instanceof MobileLocationWorkdayUnavailableError) {
        return NextResponse.json(
          { error: "The workday closed before this point could be recorded", code: "MTM_LOCATION_OUTSIDE_WORKDAY" },
          { status: 409 },
        )
      }
      if (clientLocationId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await prisma.mtmAgentLocation.findFirst({
          where: { organizationId: auth.orgId, agentId: auth.agentId, clientLocationId },
        })
        if (winner) {
          return NextResponse.json({
            success: true,
            data: { location: locationForEnabledProducts(winner, workforceEnabled), replayed: true },
          })
        }
      }
      throw error
    }

    // Historical backlog points must not create a fresh route-deviation alert.
    // The point is still stored and visible in the agent's own history.
    if (!selfLocationShare) {
      try {
        const settings = await getMtmSettings(auth.orgId)
        const freshWindowMs = Math.max(5 * 60_000, settings.gpsInterval * 3_000)
        if (now.getTime() - recordedAt.getTime() <= freshWindowMs) {
          const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
          const todayKey = currentDateKey(recordedAt, timezone)
          const routeStart = new Date(`${todayKey}T00:00:00.000Z`)
          const routeEnd = new Date(`${addDateKeyDays(todayKey, 1)}T00:00:00.000Z`)
          const route = await prisma.mtmRoute.findFirst({
            where: {
              organizationId: auth.orgId,
              status: { in: ["IN_PROGRESS", "PLANNED"] },
              date: { gte: routeStart, lt: routeEnd },
              deletedAt: null,
              OR: [
                { agentId: auth.agentId },
                { assignments: { some: { agentId: auth.agentId, removedAt: null, role: { not: "OBSERVER" } } } },
              ],
            },
            orderBy: { date: "desc" },
            select: {
              id: true,
              points: {
                where: { deletedAt: null },
                orderBy: { orderIndex: "asc" },
                select: { customer: { select: { latitude: true, longitude: true, name: true } } },
              },
            },
          })
          if (route && route.points.length >= 2) {
            // A stop whose customer predates the coordinates migration can
            // still hold (0, 0). Accepting it as a vertex would run the
            // corridor from the city to the Gulf of Guinea, and every real
            // position would then read as a deviation: an OUT_OF_ZONE alert
            // and a push telling the agent they are off route while they
            // stand at the door (src/lib/mtm/geo-coordinates.ts).
            const corridor = route.points.flatMap((point: {
              customer: { latitude: number | null; longitude: number | null } | null
            }) => hasMtmCoordinates(point.customer)
              ? [{ lat: point.customer.latitude, lng: point.customer.longitude }]
              : [])

            if (corridor.length >= 2) {
              const deviationMeters = distanceToPolyline(latitude, longitude, corridor)
              if (deviationMeters > settings.deviationThresholdMeters && settings.alertOutOfZone) {
                const throttleCutoff = new Date(now.getTime() - settings.deviationAlertThrottleMinutes * 60_000)
                const recentAlert = await prisma.mtmAlert.findFirst({
                  where: {
                    agentId: auth.agentId,
                    organizationId: auth.orgId,
                    type: "OUT_OF_ZONE",
                    createdAt: { gte: throttleCutoff },
                    isResolved: false,
                  },
                })
                if (!recentAlert) {
                  const roundedDistance = Math.round(deviationMeters)
                  await prisma.mtmAlert.create({
                    data: {
                      organizationId: auth.orgId,
                      agentId: auth.agentId,
                      type: "OUT_OF_ZONE",
                      category: "WARNING",
                      title: "Route deviation detected",
                      description: `Agent is ${roundedDistance}m away from planned route (max ${settings.deviationThresholdMeters}m)`,
                      metadata: {
                        routeId: route.id,
                        deviationMeters: roundedDistance,
                        threshold: settings.deviationThresholdMeters,
                        agentLat: latitude,
                        agentLng: longitude,
                        ...mtmAlertMessage("routeDeviation", {
                          deviationMeters: roundedDistance,
                          thresholdMeters: settings.deviationThresholdMeters,
                        }),
                      },
                    },
                  })
                  notifyAgent({
                    organizationId: auth.orgId,
                    agentId: auth.agentId,
                    type: "warning",
                    title: "Route deviation",
                    body: `You're ${roundedDistance}m off the planned route.`,
                    metadata: {
                      routeId: route.id,
                      deviationMeters: roundedDistance,
                      ...mtmAlertMessage("agentRouteDeviation", { deviationMeters: roundedDistance }),
                    },
                  }).catch((error) => console.warn("[MTM/mobile/location] notify failed", error))
                }
              }
            }
          }
        }
      } catch (error) {
        console.warn("[MTM/mobile/location] deviation check failed", error)
      }
    }

    return NextResponse.json({
      success: true,
      data: { location: locationForEnabledProducts(location, workforceEnabled), replayed: false },
    })
  } catch (error) {
    console.error("[MTM/mobile/location POST]", error)
    return NextResponse.json({ error: "Failed to save location" }, { status: 500 })
  }
})

/** GET /api/v1/mtm/mobile/location?date=YYYY-MM-DD — own local-day history. */
export const GET = withMobileRls(async (req, auth) => {
  const forbidden = requireMobileCapability(auth, "FIELD_TRACK")
  if (forbidden) return forbidden
  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const requestedDate = new URL(req.url).searchParams.get("date") ?? currentDateKey(new Date(), timezone)
    if (!isDateKey(requestedDate)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 })
    }
    const from = localDateKeyToUtc(requestedDate, timezone)
    const to = localDateKeyToUtc(addDateKeyDays(requestedDate, 1), timezone)
    const [locations, pauseEvents] = await Promise.all([
      prisma.mtmAgentLocation.findMany({
        where: {
          organizationId: auth.orgId,
          agentId: auth.agentId,
          recordedAt: { gte: from, lt: to },
        },
        orderBy: { recordedAt: "asc" },
        take: 2_000,
      }),
      // A7: the breaks of that day, so the map can say why the track stops
      // instead of leaving a hole the agent reads as "the app lost me".
      prisma.mtmAgentWorkdayEvent.findMany({
        where: {
          organizationId: auth.orgId,
          agentId: auth.agentId,
          occurredAt: { gte: from, lt: to },
          type: { in: ["PAUSE", "RESUME", "FINISH"] },
        },
        orderBy: { occurredAt: "asc" },
        select: { type: true, occurredAt: true },
      }),
    ])
    const workforceEnabled = auth.tenantCapabilities?.workforceHrm === true

    return NextResponse.json({
      success: true,
      data: {
        date: requestedDate,
        timezone,
        gpsIntervalSeconds: settings.gpsInterval,
        distanceMeters: travelledDistance(locations),
        pauses: serializeMtmWorkdayPauses(mtmWorkdayPauses(pauseEvents)),
        locations: locations.map((location) => locationForEnabledProducts(location, workforceEnabled)),
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/location GET]", error)
    return NextResponse.json({ error: "Failed to load locations" }, { status: 500 })
  }
})
