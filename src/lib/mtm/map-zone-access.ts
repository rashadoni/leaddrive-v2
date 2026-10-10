import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { checkPermission, type Role } from "@/lib/permissions"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import type { LiveMapZoneShapeBody } from "@/lib/mtm/live-map-zones"

/**
 * Who sees and who changes the zones drawn on the live map — one answer for
 * the list and for every write (routes under /api/v1/mtm/locations/zones).
 *
 * A zone belongs to the organization, not to the person who drew it:
 *
 *   - nobody — a field employee, and a web user without an MTM card. The live
 *     map is the managers' screen, and the zones are a layer of it;
 *   - reader — a supervisor: he sees every zone and changes none, the same
 *     split as the visit rules (visit-policy-access.ts). Also anything that is
 *     not a person at a browser: an integration key reads the zones — they
 *     are places, not people — but a zone is drawn by somebody, and the
 *     journal has to be able to say who;
 *   - writer — an administrator or a manager at a browser: any zone of the
 *     organization, not only his own.
 *
 * Server only — it reads the database. What the page and the server share
 * about a zone is in live-map-zones.ts.
 */
export type MapZoneAccess =
  | { kind: "none" }
  | { kind: "reader"; because: "supervisor" | "not-a-person" | "web-role" }
  | { kind: "writer" }

export async function mapZoneAccessFor(auth: {
  orgId: string
  userId: string
  role: Role
  principalType?: "session" | "api_key"
}): Promise<MapZoneAccess> {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    // The web-only wrapper has already rejected mobile JWTs.
    agentId: null,
  })
  if (!actor || actor.role === "AGENT") return { kind: "none" }
  // Compared to its exact value, never «not a key»: a caller whose provenance
  // is unknown does not write either.
  if (auth.principalType !== "session") return { kind: "reader", because: "not-a-person" }
  if (actor.role !== "ADMIN" && actor.role !== "MANAGER") return { kind: "reader", because: "supervisor" }
  // What the wrapper asks of a write before the handler is entered. Asked
  // here as well so that the list does not offer a button — `canWrite` — to
  // somebody whose web role the wrapper would then refuse.
  if (!checkPermission(auth.role, "mtm", "write")) return { kind: "reader", because: "web-role" }
  return { kind: "writer" }
}

/** 403 for a caller who may not open the zones at all. */
export function mapZoneReadDenied(): Response {
  return NextResponse.json({ error: "Manager access required", code: "MTM_MAP_ZONE_MANAGER_REQUIRED" }, { status: 403 })
}

/** 403 unless the caller may create, change and remove zones; null for one who may. */
export function mapZoneWriteDenied(access: MapZoneAccess): Response | null {
  if (access.kind === "writer") return null
  if (access.kind === "none") return mapZoneReadDenied()
  if (access.because === "not-a-person") {
    return NextResponse.json(
      { error: "A zone is drawn by a person signed in at a browser", code: "MTM_MAP_ZONE_SESSION_REQUIRED" },
      { status: 403 },
    )
  }
  return NextResponse.json({ error: "Map zones are read-only for you", code: "MTM_MAP_ZONE_READ_ONLY" }, { status: 403 })
}

export function mapZoneNotFound(): Response {
  return NextResponse.json({ error: "Zone not found", code: "MTM_MAP_ZONE_NOT_FOUND" }, { status: 404 })
}

export function mapZoneRateLimited(): Response {
  return NextResponse.json(
    { error: "Too many requests. Try again in a minute.", code: "MTM_MAP_ZONE_RATE_LIMITED", retryAfterSeconds: 60 },
    { status: 429, headers: { "Retry-After": "60" } },
  )
}

/**
 * What of a zone leaves the server, and what the journal keeps of it: the
 * name, the colour and the shape. Not who drew it and not the organization.
 */
export const MAP_ZONE_SELECT = {
  id: true,
  name: true,
  kind: true,
  color: true,
  centerLatitude: true,
  centerLongitude: true,
  radiusMeters: true,
  polygon: true,
} as const

/**
 * How long after a zone was drawn the very same drawing, sent again by the
 * same person, is taken for the same press of «Сохранить» repeated — see
 * isSameMapZoneDrawing. Long enough for a request that timed out at a proxy
 * and a person who then pressed the button again; short enough that nobody
 * meets it who means to draw a second zone.
 */
export const MAP_ZONE_REPEAT_WINDOW_MS = 2 * 60_000

/** A row as MAP_ZONE_SELECT reads it. */
interface KeptMapZone {
  kind: string
  color: string | null
  centerLatitude: number | null
  centerLongitude: number | null
  radiusMeters: number | null
  polygon: unknown
}

/** The rings of a stored outline; a JSON column is read back as anything at all. */
function ringsOf(polygon: unknown): unknown {
  return polygon && typeof polygon === "object" && !Array.isArray(polygon)
    ? (polygon as { coordinates?: unknown }).coordinates
    : undefined
}

/**
 * Whether a kept zone is, colour and shape, the drawing a request asks for.
 *
 * The answer to a drawing can be lost on its way back — the connection drops,
 * a proxy gives up — after the row has been written. The form then says «нет
 * связи, попробуйте ещё раз», the person does, and without this the zone was
 * kept twice: two rows of one name lying on each other, the second seen only
 * after a reload. So a drawing that repeats one the same person made a moment
 * ago (the route asks for the name, the kind and the moment) is answered with
 * the zone that is already there.
 *
 * Compared here and not in the query: the ring is a JSON column, and how the
 * database would compare two of those is not something to lean on. Numbers
 * are compared as they are — a repeat sends the same bytes.
 */
export function isSameMapZoneDrawing(kept: KeptMapZone, asked: LiveMapZoneShapeBody & { color?: string | null }): boolean {
  if (kept.kind !== asked.kind || kept.color !== (asked.color ?? null)) return false
  if (asked.kind === "CIRCLE") {
    return kept.centerLatitude === asked.centerLatitude
      && kept.centerLongitude === asked.centerLongitude
      && kept.radiusMeters === asked.radiusMeters
  }
  const rings = ringsOf(kept.polygon)
  return rings !== undefined && JSON.stringify(rings) === JSON.stringify(asked.polygon.coordinates)
}

/**
 * A validated shape as the table's columns. Each kind clears the other's: a
 * circle redrawn as an outline must not keep its radius, and the table's own
 * constraint would refuse the row if it did.
 *
 * A circle's outline is cleared with `Prisma.DbNull` — the column itself
 * empty. Prisma's other null for a JSON column, `Prisma.JsonNull`, stores the
 * JSON value `null`, and to Postgres that is a value: `"polygon" IS NULL` is
 * false for it, so mtm_map_zones_shape_check would refuse every circle.
 */
export function mapZoneShapeColumns(shape: LiveMapZoneShapeBody) {
  if (shape.kind === "CIRCLE") {
    return {
      kind: shape.kind,
      centerLatitude: shape.centerLatitude,
      centerLongitude: shape.centerLongitude,
      radiusMeters: shape.radiusMeters,
      polygon: Prisma.DbNull,
    }
  }
  return {
    kind: shape.kind,
    centerLatitude: null,
    centerLongitude: null,
    radiusMeters: null,
    polygon: shape.polygon,
  }
}
