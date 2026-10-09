import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { customerScopeForActor } from "@/lib/mtm/field-scope"
import { checkRateLimit } from "@/lib/rate-limit"
import { isValidTimezone } from "@/lib/timezone"

/**
 * What one response carries. A base larger than this is cut, and the answer
 * says so — the map then states «N из M», it never looks complete.
 */
const MAX_LIVE_MAP_CLIENTS = 10_000
// Asked for when the layer is switched on and on a manual refresh, never on the roster's timer.
const RATE_LIMIT = { maxRequests: 6, windowMs: 60_000 }

type ClientRow = Prisma.MtmCustomerGetPayload<{
  select: { id: true; name: true; latitude: true; longitude: true; category: true; objectType: true; geofenceRadius: true }
}>

/**
 * GET /api/v1/mtm/locations/clients
 *
 * The client base as points for the live map's «Клиенты» layer: the
 * institutions the viewer may see that have a place on the map — id, name,
 * coordinates, class, kind and their own check-in radius, nothing else of the
 * card — plus how many there are in all and how many have no coordinates, so
 * the layer can say what it does not show.
 *
 * Scope is the one the institutions list for a field actor already uses
 * (`customerScopeForActor`): an administrator sees the organization, a manager
 * or supervisor the institutions of the employees he sees on this map. People
 * (the legacy DOCTOR kind) are not institutions and are left out, as on the
 * «Учреждения» screen; closed ones (INACTIVE) are left out as well.
 */
export const GET = withRouteFieldWebRlsAuth("read", async (_req, auth) => {
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
    if (!checkRateLimit(`mtm-live-map-clients:${orgId}:${auth.userId}`, RATE_LIMIT)) {
      return NextResponse.json(
        { error: "Refresh rate limit exceeded", retryAfterSeconds: 30 },
        { status: 429, headers: { "Retry-After": "30" } },
      )
    }

    const settings = await getMtmSettings(orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const asOf = new Date(`${currentDateKey(new Date(), timezone)}T00:00:00.000Z`)

    const scope: Prisma.MtmCustomerWhereInput = {
      organizationId: orgId,
      deletedAt: null,
      objectType: { not: "DOCTOR" },
      status: { in: ["ACTIVE", "PROSPECT"] },
      ...(actor.role !== "ADMIN" ? { AND: [customerScopeForActor(actor, asOf)] } : {}),
    }
    // The table's own constraint rejects half a pair and (0, 0) but not a
    // latitude of 500: the range is checked here, as the roster does.
    const placed: Prisma.MtmCustomerWhereInput = {
      ...scope,
      latitude: { gte: -90, lte: 90 },
      longitude: { gte: -180, lte: 180 },
    }

    const [rows, total, onMap] = await Promise.all([
      prisma.mtmCustomer.findMany({
        where: placed,
        orderBy: { id: "asc" },
        take: MAX_LIVE_MAP_CLIENTS + 1,
        select: { id: true, name: true, latitude: true, longitude: true, category: true, objectType: true, geofenceRadius: true },
      }),
      prisma.mtmCustomer.count({ where: scope }),
      prisma.mtmCustomer.count({ where: placed }),
    ])

    const truncated = rows.length > MAX_LIVE_MAP_CLIENTS
    const clients = (rows as ClientRow[]).slice(0, MAX_LIVE_MAP_CLIENTS).flatMap((row) => {
      if (typeof row.latitude !== "number" || typeof row.longitude !== "number") return []
      return [{
        id: row.id,
        name: row.name,
        latitude: row.latitude,
        longitude: row.longitude,
        category: row.category,
        objectType: row.objectType,
        geofenceRadius: row.geofenceRadius,
      }]
    })

    return NextResponse.json({
      success: true,
      data: {
        clients,
        total,
        // Institutions the viewer may see that have no usable place on the map.
        withoutCoordinates: Math.max(0, total - onMap),
        truncated,
      },
    })
  } catch (e) {
    console.error("[MTM/locations/clients GET]", e)
    return NextResponse.json({ error: "Failed to load clients", code: "MTM_LIVE_MAP_CLIENTS_FAILED" }, { status: 500 })
  }
})
