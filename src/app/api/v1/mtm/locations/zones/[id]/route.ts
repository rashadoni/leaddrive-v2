import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { MapZoneUpdateSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { checkRateLimit } from "@/lib/rate-limit"
import {
  MAP_ZONE_SELECT,
  mapZoneAccessFor,
  mapZoneNotFound,
  mapZoneRateLimited,
  mapZoneShapeColumns,
  mapZoneWriteDenied,
} from "@/lib/mtm/map-zone-access"

// One allowance with drawing (../route.ts): the key is the same.
const WRITE_RATE_LIMIT = { maxRequests: 60, windowMs: 60_000 }

/**
 * PUT /api/v1/mtm/locations/zones/:id
 *
 * Renames, recolours or redraws a zone — any zone of the organization, not
 * only one's own. A new shape is sent whole, with its kind; a request without
 * a kind changes the name or the colour and nothing else.
 *
 * A zone of another organization and a removed one answer the same 404, and
 * every statement below carries the organization and «not removed» itself:
 * nothing here leans on the row having been found a moment ago.
 */
export const PUT = withRouteFieldWebRlsAuth("write", async (
  req,
  auth,
  { params }: { params: Promise<{ id: string }> },
) => {
  const orgId = auth.orgId
  try {
    // Authorization first (403), then the zone (404), then content (400).
    const denied = mapZoneWriteDenied(await mapZoneAccessFor(auth))
    if (denied) return denied
    if (!checkRateLimit(`mtm-live-map-zones-write:${orgId}:${auth.userId}`, WRITE_RATE_LIMIT)) return mapZoneRateLimited()
    const { id } = await params
    const kept = { id, organizationId: orgId, deletedAt: null }
    const existing = await prisma.mtmMapZone.findFirst({ where: kept, select: MAP_ZONE_SELECT })
    if (!existing) return mapZoneNotFound()

    const parsed = parseBody(MapZoneUpdateSchema, await req.json().catch(() => null))
    if (!parsed.ok) return parsed.response
    const body = parsed.data

    const changed = await prisma.mtmMapZone.updateMany({
      where: kept,
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        // null takes the colour off; absent leaves it as it was.
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.kind === "CIRCLE" || body.kind === "POLYGON" ? mapZoneShapeColumns(body) : {}),
      },
    })
    // Removed by somebody else between the two statements.
    if (changed.count === 0) return mapZoneNotFound()
    const zone = await prisma.mtmMapZone.findFirst({ where: kept, select: MAP_ZONE_SELECT })
    if (!zone) return mapZoneNotFound()

    await writeMtmAudit({
      organizationId: orgId,
      agentId: null,
      action: "MAP_ZONE_UPDATE",
      entity: "map_zone",
      entityId: id,
      metadataKind: "map_zone_change",
      oldData: existing,
      newData: zone,
      req,
    }).catch((error) => console.warn("[MTM/locations/zones/[id] PUT] audit failed", error))

    return NextResponse.json({ success: true, data: zone })
  } catch (e) {
    console.error("[MTM/locations/zones/[id] PUT]", e)
    return NextResponse.json({ error: "Failed to save the zone", code: "MTM_MAP_ZONE_FAILED" }, { status: 500 })
  }
})

/**
 * DELETE /api/v1/mtm/locations/zones/:id
 *
 * Takes a zone off the map. The row is kept and marked: the journal says who
 * removed what, and that entry has to keep pointing at something.
 */
export const DELETE = withRouteFieldWebRlsAuth("write", async (
  req,
  auth,
  { params }: { params: Promise<{ id: string }> },
) => {
  const orgId = auth.orgId
  try {
    const denied = mapZoneWriteDenied(await mapZoneAccessFor(auth))
    if (denied) return denied
    if (!checkRateLimit(`mtm-live-map-zones-write:${orgId}:${auth.userId}`, WRITE_RATE_LIMIT)) return mapZoneRateLimited()
    const { id } = await params
    const kept = { id, organizationId: orgId, deletedAt: null }
    const existing = await prisma.mtmMapZone.findFirst({ where: kept, select: MAP_ZONE_SELECT })
    if (!existing) return mapZoneNotFound()

    const deletedAt = new Date()
    const removed = await prisma.mtmMapZone.updateMany({ where: kept, data: { deletedAt } })
    // Somebody else removed it first: there is nothing of ours to record.
    if (removed.count === 0) return mapZoneNotFound()

    await writeMtmAudit({
      organizationId: orgId,
      agentId: null,
      action: "MAP_ZONE_DELETE",
      entity: "map_zone",
      entityId: id,
      metadataKind: "map_zone_change",
      oldData: existing,
      // The zone as it was, with the moment it was removed: the journal names
      // a row by what `newData` says, and a removal must still say which zone.
      newData: { ...existing, deletedAt: deletedAt.toISOString() },
      req,
    }).catch((error) => console.warn("[MTM/locations/zones/[id] DELETE] audit failed", error))

    return NextResponse.json({ success: true, data: { id } })
  } catch (e) {
    console.error("[MTM/locations/zones/[id] DELETE]", e)
    return NextResponse.json({ error: "Failed to remove the zone", code: "MTM_MAP_ZONE_FAILED" }, { status: 500 })
  }
})
