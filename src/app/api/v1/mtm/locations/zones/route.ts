import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { MapZoneCreateSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { checkRateLimit } from "@/lib/rate-limit"
import { LIVE_MAP_ZONE_LIMIT } from "@/lib/mtm/live-map-zones"
import {
  MAP_ZONE_REPEAT_WINDOW_MS,
  MAP_ZONE_SELECT,
  isSameMapZoneDrawing,
  mapZoneAccessFor,
  mapZoneRateLimited,
  mapZoneReadDenied,
  mapZoneShapeColumns,
  mapZoneWriteDenied,
} from "@/lib/mtm/map-zone-access"

// Asked for when the layer is switched on, on «Обновить», and once when the
// ruler or a point is first taken up (the answer says who may draw) — never on
// the roster's timer, and not after a change: the page draws what the change
// itself answered. The same allowance as the roster itself.
const READ_RATE_LIMIT = { maxRequests: 30, windowMs: 60_000 }
// Drawing, renaming, recolouring and removing share one allowance: a person
// tidying the map makes a change every few seconds, a script makes hundreds.
const WRITE_RATE_LIMIT = { maxRequests: 60, windowMs: 60_000 }

/**
 * GET /api/v1/mtm/locations/zones
 *
 * The zones the organization has drawn on the live map — «Свои зоны»: every
 * one of them, whoever drew it, for everybody who may open the map. Of each
 * only what the map draws: the name, the colour and the shape. `access.canWrite`
 * tells the page whether this viewer may change them, so that it does not
 * draw a button the server would refuse.
 *
 * Oldest first, by the moment of drawing. The page orders the list by name
 * in the viewer's own language; the database's collation is not his.
 */
export const GET = withRouteFieldWebRlsAuth("read", async (_req, auth) => {
  const orgId = auth.orgId
  try {
    const access = await mapZoneAccessFor(auth)
    if (access.kind === "none") return mapZoneReadDenied()
    if (!checkRateLimit(`mtm-live-map-zones:${orgId}:${auth.userId}`, READ_RATE_LIMIT)) return mapZoneRateLimited()

    const zones = await prisma.mtmMapZone.findMany({
      // Removed zones stay in the table; nothing filters them out but this.
      where: { organizationId: orgId, deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: LIVE_MAP_ZONE_LIMIT,
      select: MAP_ZONE_SELECT,
    })
    return NextResponse.json({ success: true, data: { zones, access: { canWrite: access.kind === "writer" } } })
  } catch (e) {
    console.error("[MTM/locations/zones GET]", e)
    return NextResponse.json({ error: "Failed to load zones", code: "MTM_MAP_ZONE_FAILED" }, { status: 500 })
  }
})

/**
 * POST /api/v1/mtm/locations/zones
 *
 * Draws a zone: a name, optionally a colour of the employees' palette, and a
 * circle or one closed outline. An administrator or a manager at a browser.
 *
 * Safe to send again: the same drawing from the same person within a couple
 * of minutes is the zone that is already kept. It is answered with that zone
 * (200, not 201) and nothing is written — no second row, no second line in
 * the journal.
 */
export const POST = withRouteFieldWebRlsAuth("write", async (req, auth) => {
  const orgId = auth.orgId
  try {
    // Authorization first (403), then content (400).
    const denied = mapZoneWriteDenied(await mapZoneAccessFor(auth))
    if (denied) return denied
    if (!checkRateLimit(`mtm-live-map-zones-write:${orgId}:${auth.userId}`, WRITE_RATE_LIMIT)) return mapZoneRateLimited()
    const parsed = parseBody(MapZoneCreateSchema, await req.json().catch(() => null))
    if (!parsed.ok) return parsed.response
    const body = parsed.data

    // A repeat of a drawing whose answer never arrived (isSameMapZoneDrawing).
    // Before the limit is counted: when the lost answer was to the last zone
    // the organization may keep, the repeat is still that zone and not a
    // refusal. Only this person's own, and only what is on the map now: a
    // colleague who draws the same circle draws his own zone, and a zone
    // removed and drawn again is drawn again. The organization is named in
    // the statement itself, like everywhere in these routes.
    const recent = await prisma.mtmMapZone.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        createdBy: auth.userId,
        name: body.name,
        kind: body.kind,
        createdAt: { gte: new Date(Date.now() - MAP_ZONE_REPEAT_WINDOW_MS) },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      // One person's zones of one name in two minutes: one, when there is any. The newest few are plenty.
      take: 20,
      select: MAP_ZONE_SELECT,
    })
    const already = recent.find((drawn) => isSameMapZoneDrawing(drawn, body))
    if (already) return NextResponse.json({ success: true, data: already })

    // The list is answered whole, so it has an end. Two people drawing the
    // last zone at the same moment may both get in; the list still stops at
    // the limit, and neither of them can add another.
    const kept = await prisma.mtmMapZone.count({ where: { organizationId: orgId, deletedAt: null } })
    if (kept >= LIVE_MAP_ZONE_LIMIT) {
      return NextResponse.json(
        { error: `An organization can keep at most ${LIVE_MAP_ZONE_LIMIT} zones`, code: "MTM_MAP_ZONE_LIMIT_REACHED", limit: LIVE_MAP_ZONE_LIMIT },
        { status: 409 },
      )
    }

    const zone = await prisma.mtmMapZone.create({
      data: {
        organizationId: orgId,
        name: body.name,
        color: body.color ?? null,
        ...mapZoneShapeColumns(body),
        createdBy: auth.userId,
      },
      select: MAP_ZONE_SELECT,
    })

    await writeMtmAudit({
      organizationId: orgId,
      agentId: null,
      action: "MAP_ZONE_CREATE",
      entity: "map_zone",
      entityId: zone.id,
      metadataKind: "map_zone_change",
      newData: zone,
      req,
    }).catch((error) => console.warn("[MTM/locations/zones POST] audit failed", error))

    return NextResponse.json({ success: true, data: zone }, { status: 201 })
  } catch (e) {
    console.error("[MTM/locations/zones POST]", e)
    return NextResponse.json({ error: "Failed to save the zone", code: "MTM_MAP_ZONE_FAILED" }, { status: 500 })
  }
})
