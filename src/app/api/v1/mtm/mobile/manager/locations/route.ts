import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { classifyGpsFreshness, GPS_FRESHNESS } from "@/lib/mtm/live-location"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"

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
  const agents = await prisma.mtmAgent.findMany({
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
        take: 1,
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
    },
  })
  const generatedAt = new Date()
  const locations = agents.map(({ locations: agentLocations, latestLocation, ...agent }) => {
    const rawLatestLocation = agentLocations[0] ?? null
    // During a rolling server upgrade an older process can still append raw
    // v1 GPS without the projection update. Choose the newest read-only
    // evidence, so enabling the projection never makes a map move backwards.
    const lastKnownLocation = latestLocation
      && (!rawLatestLocation || latestLocation.recordedAt >= rawLatestLocation.recordedAt)
      ? latestLocation
      : rawLatestLocation
    const freshness = classifyGpsFreshness(lastKnownLocation?.recordedAt, generatedAt)
    // Keep the legacy `location` key, but make its semantics safe: it is a
    // current/live coordinate only. Delayed and stale points remain available
    // as explicitly timestamped last-known evidence and must not move a live
    // map marker.
    const liveLocation = freshness === "ONLINE" ? lastKnownLocation : null

    return {
      ...agent,
      freshness,
      hasLiveLocation: liveLocation !== null,
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
