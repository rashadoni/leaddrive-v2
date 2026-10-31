import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { classifyGpsFreshness, GPS_FRESHNESS, mapWorkdayState } from "@/lib/mtm/live-location"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"
import { readMtmLastBreakEnds, type MtmBreakEndsWorkday } from "@/lib/mtm/live-break-ends"
import { isMtmPositionHeldByBreak, mtmFreshnessAcrossBreak } from "@/lib/mtm-types"
import { liveMtmMovement } from "@/lib/mtm/movement-mode"

/**
 * How many of his newest fixes are read to tell a car in a jam from a walk
 * (movement-mode.ts): the phone uploads one every ~30 s, so about six minutes.
 */
const MOVEMENT_FIXES = 12

/** A coordinate as it is read here, from the projection or the raw table. */
interface LocationEvidence {
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number | null
  heading: number | null
  battery: number | null
  isMoving: boolean | null
  recordedAt: Date
}

/** A row of the roster as it is read here; typed where it is read, the database client being untyped. */
interface ManagerLocationRow {
  id: string
  name: string
  role: string
  isOnline: boolean
  lastSeenAt: Date | null
  latestLocation?: LocationEvidence | null
  locations: LocationEvidence[]
  workdays?: MtmBreakEndsWorkday[]
}

/** GET /api/v1/mtm/mobile/manager/locations — scoped latest field positions. */
export const GET = withMobileRls(async (req, auth) => {
  const forbidden = requireMobileCapability(auth, "TEAM_READ")
  if (forbidden) return forbidden
  const { searchParams } = new URL(req.url)
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 200), 1), 500)
  const scope = await resolveAgentScope(prisma, {
    organizationId: auth.orgId,
    agentId: auth.agentId,
    role: auth.role as "ADMIN" | "MANAGER" | "SUPERVISOR" | "AGENT",
  })
  const agents: ManagerLocationRow[] = await prisma.mtmAgent.findMany({
    where: {
      organizationId: auth.orgId,
      status: "ACTIVE",
      ...(scope.agentIds ? { id: { in: scope.agentIds } } : {}),
    },
    orderBy: { name: "asc" },
    take: limit,
    select: {
      id: true,
      name: true,
      role: true,
      isOnline: true,
      lastSeenAt: true,
      // Prefer the projection written with GPS ingestion. Keep the raw-table
      // relation as a temporary fallback for pre-migration rows and rolling
      // deploys; it is read-only dual-read, never dual-write.
      latestLocation: {
        select: {
          latitude: true,
          longitude: true,
          accuracy: true,
          speed: true,
          heading: true,
          battery: true,
          isMoving: true,
          recordedAt: true,
        },
      },
      locations: {
        take: MOVEMENT_FIXES,
        orderBy: { recordedAt: "desc" },
        select: {
          latitude: true,
          longitude: true,
          accuracy: true,
          speed: true,
          heading: true,
          battery: true,
          isMoving: true,
          recordedAt: true,
        },
      },
      // The shift he is in — the open one, as the managers' live map picks
      // it (liveMapWorkdayOf) — only to tell whether his newest point is
      // still where a break began. Nothing of it goes out.
      workdays: {
        where: { status: { in: ["STARTED", "PAUSED"] } },
        orderBy: [{ startedAt: "desc" }, { workDate: "desc" }],
        take: 1,
        select: { id: true, status: true, totalPausedSeconds: true },
      },
    },
  })
  const generatedAt = new Date()
  const lastBreakEndByWorkday = await readMtmLastBreakEnds({
    organizationId: auth.orgId,
    workdays: agents.map((agent) => agent.workdays?.[0]),
  })
  const locations = agents.map(({ locations: agentLocations, latestLocation, workdays, ...agent }) => {
    const rawLatestLocation = agentLocations[0] ?? null
    // During a rolling server upgrade an older process can still append raw
    // v1 GPS without the projection update. Choose the newest read-only
    // evidence, so enabling the projection never makes a map move backwards.
    const lastKnownLocation = latestLocation
      && (!rawLatestLocation || latestLocation.recordedAt >= rawLatestLocation.recordedAt)
      ? latestLocation
      : rawLatestLocation
    // On a break, and back from one until the first fix after it, the newest
    // point is where the work stopped, not where he is: the last known point
    // (isMtmPositionHeldByBreak), as the web map shows him. Until 2026-10-20
    // the phone was handed it as his live position for the first five
    // minutes of every break.
    const shift = workdays?.[0] ?? null
    const freshness = mtmFreshnessAcrossBreak(classifyGpsFreshness(lastKnownLocation?.recordedAt, generatedAt), isMtmPositionHeldByBreak({
      workdayState: mapWorkdayState(shift?.status),
      recordedAt: lastKnownLocation?.recordedAt,
      lastBreakEndedAt: shift ? lastBreakEndByWorkday.get(shift.id) : null,
    }))
    // Keep the legacy `location` key, but make its semantics safe: it is a
    // current/live coordinate only. Delayed and stale points remain available
    // as explicitly timestamped last-known evidence and must not move a live
    // map marker.
    const liveLocation = freshness === "ONLINE" ? lastKnownLocation : null
    // Car, on foot or standing, and which way (owner 2026-11-01, the mockup's
    // step 3) — only for a live position, and read only from the fixes after
    // his last break: what he did before it is not his trip now.
    const breakEndedAt = shift ? lastBreakEndByWorkday.get(shift.id) ?? null : null
    const movement = liveLocation
      ? liveMtmMovement({
          freshness,
          latitude: liveLocation.latitude,
          longitude: liveLocation.longitude,
          recordedAt: liveLocation.recordedAt.toISOString(),
          speed: liveLocation.speed,
          heading: liveLocation.heading,
          trail: agentLocations
            .filter((fix) => fix.recordedAt < liveLocation.recordedAt && (!breakEndedAt || fix.recordedAt > breakEndedAt))
            .reverse()
            .map((fix) => ({ latitude: fix.latitude, longitude: fix.longitude, recordedAt: fix.recordedAt.toISOString() })),
        })
      : null

    return {
      ...agent,
      freshness,
      hasLiveLocation: liveLocation !== null,
      movement: movement ? { mode: movement.mode, course: movement.heading == null ? null : Math.round(movement.heading) } : null,
      location: liveLocation,
      liveLocation,
      lastKnownLocation,
    }
  })

  return NextResponse.json({
    success: true,
    data: {
      scope: scope.agentIds ? "TEAM_OR_REGION" : "ORGANIZATION",
      locations,
      contract: {
        generatedAt,
        freshnessThresholds: GPS_FRESHNESS,
        locationSemantics: "LIVE_ONLY",
        lastKnownLocationSemantics: "LAST_RECORDED",
      },
    },
  })
})
